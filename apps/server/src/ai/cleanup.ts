import type { EngineContext } from '../context';
import type { ThreadListItem } from '../types';
import { newId } from '../lib/ids';
import { bus } from '../lib/events';
import { t, tp } from '../lib/i18n';
import { ReplyDrafter } from './drafts';

/**
 * The inbox cleaner: goes through the unread inbox and tidies what it is sure about (newsletters,
 * promotions, automatic notifications, used codes, senders the user always archives), leaves the
 * mails that matter to the user, and asks about the rest — in the AI chat, with a notification.
 * Nothing is deleted: tidied mails are archived and read, and a run can be undone.
 */

export type CleanupItem = { threadId: string; subject: string; from: string; date: number; summary: string };
export type CleanupDecision = 'archive' | 'keep' | 'trash';
export type CleanupQuestion = CleanupItem & { proposal: CleanupDecision; reason: string; resolved: CleanupDecision | null };
/** A reply the AI drafts for the user to send, rewrite, skip or archive from the overview. */
export type ReplyStatus = 'drafting' | 'ready' | 'sent' | 'skipped' | 'archived' | 'failed';
export type ReplyItem = CleanupItem & { draft: string | null; confident: boolean; reason: string; status: ReplyStatus };
export type CleanupRun = {
  id: string;
  at: number;
  tidied: (CleanupItem & { reason: string })[];
  questions: CleanupQuestion[];
  mine: CleanupItem[];
  /** « Trier et répondre »: the conversations waiting for a reply, with the AI's draft. */
  replies?: ReplyItem[];
  undone: boolean;
};

/** What ZMail has done so far, as plain counts (and the time it spared, conservatively). */
export type Savings = {
  sorted: number;
  spam: number;
  otp: number;
  unsubscribed: number;
  tidied: number;
  replied: number;
  /** Estimated time saved, in seconds (see SECONDS). */
  seconds: number;
};

export type Remaining = {
  unread: number;
  /** Mails the user has to handle themself. */
  mine: number;
  /** Mails the cleaner can tidy on its own. */
  tidy: number;
  /** Mails it would ask about. */
  ask: number;
  /** Time it takes to go through them by hand, and what is left with the cleaner. */
  manualSeconds: number;
  withAiSeconds: number;
  top: { id: string; label: string; count: number }[];
};

/**
 * Seconds of work one automatic action spares, deliberately conservative: reading a subject and
 * deciding where it goes (sorting), opening and deleting a spam, copying a code from a mail,
 * finding and using an unsubscribe link, archiving a mail by hand.
 */
export const SECONDS = { sorted: 4, spam: 8, otp: 20, unsubscribed: 90, tidied: 6, replied: 90, manual: 25, ask: 6 };

const QUIET_TAGS = new Set(['newsletter', 'marketing', 'notification']);
const MINE_TAGS = new Set(['important', 'to-respond', 'opportunity', 'chargeback', 'personal']);
const RUNS_KEY = 'cleanup:runs';
const KEEP_KEY = 'cleanup:keepSenders';

type Verdict = { kind: 'mine' } | { kind: 'tidy'; reason: string } | { kind: 'ask'; proposal: CleanupDecision; reason: string };

export class InboxCleaner {
  readonly drafter: ReplyDrafter;
  constructor(private readonly ctx: EngineContext) {
    this.drafter = new ReplyDrafter(ctx);
  }

  savings(): Savings {
    const n = (sql: string) => this.ctx.db.get<{ n: number }>(sql)?.n ?? 0;
    const sorted = n('SELECT COUNT(*) AS n FROM triage');
    const spam = n('SELECT COUNT(*) AS n FROM triage WHERE spam = 1');
    const otp = n('SELECT COUNT(*) AS n FROM triage WHERE otp IS NOT NULL AND spam = 0');
    const unsubscribed = n("SELECT COUNT(*) AS n FROM unsubscribes WHERE status = 'success'");
    const tidied = this.ctx.db.getSetting<number>('cleanup:tidied', 0);
    const replied = this.ctx.db.getSetting<number>('cleanup:replied', 0);
    const seconds = sorted * SECONDS.sorted + spam * SECONDS.spam + otp * SECONDS.otp + unsubscribed * SECONDS.unsubscribed + tidied * SECONDS.tidied + replied * SECONDS.replied;
    return { sorted, spam, otp, unsubscribed, tidied, replied, seconds };
  }

  /**
   * One sentence per group of unread mail (what the AI files, what it will ask, what needs
   * the user), written by the model; a plain list of senders when no model answers.
   */
  async recap() {
    const groups = { tidy: [] as ThreadListItem[], ask: [] as ThreadListItem[], mine: [] as ThreadListItem[] };
    for (const thread of this.unread()) groups[this.classify(thread).kind].push(thread);
    const tagName = (id: string) => this.ctx.catalog.tags().find((x) => x.id === id)?.name ?? id;
    const brief = (list: ThreadListItem[]) => list.map((m) => ({ from: m.from.name || m.from.email, subject: m.subject, tags: m.tags.map(tagName) }));
    const written = await this.drafter.recap({ tidy: brief(groups.tidy), ask: brief(groups.ask), mine: brief(groups.mine) }).catch(() => null);
    const fallback = (list: ThreadListItem[]) => {
      const senders = [...new Set(list.map((m) => m.from.name || m.from.email))];
      return senders.length ? `${senders.slice(0, 3).join(', ')}${senders.length > 3 ? t(' et {n} autres', { n: senders.length - 3 }) : ''}` : '';
    };
    return {
      tidy: written?.tidy || fallback(groups.tidy),
      ask: written?.ask || fallback(groups.ask),
      mine: written?.mine || fallback(groups.mine),
      byAi: Boolean(written),
    };
  }

  remaining(): Remaining {
    const threads = this.unread();
    const verdicts = threads.map((t) => this.classify(t));
    const count = (kind: Verdict['kind']) => verdicts.filter((v) => v.kind === kind).length;
    const mine = count('mine');
    const tidy = count('tidy');
    const ask = count('ask');
    const tags = new Map<string, number>();
    for (const t of threads) for (const tag of t.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const top = [...tags]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, c]) => ({ id, label: this.ctx.catalog.tags().find((x) => x.id === id)?.name ?? id, count: c }));
    return { unread: threads.length, mine, tidy, ask, manualSeconds: threads.length * SECONDS.manual, withAiSeconds: mine * SECONDS.manual + ask * SECONDS.ask, top };
  }

  runs(): CleanupRun[] {
    return this.ctx.db.getSetting<CleanupRun[]>(RUNS_KEY, []);
  }

  run(id: string) {
    return this.runs().find((r) => r.id === id) ?? null;
  }

  /** The last « Trier et répondre » of the day still open, so the overview resumes it after a reload. */
  latest() {
    const run = this.runs()[0];
    return run && !run.undone && Date.now() - run.at < 12 * 3_600_000 ? run : null;
  }

  /** Tidies what it is sure about and returns the run (questions included). */
  async start(): Promise<CleanupRun> {
    const run: CleanupRun = { id: newId('cln'), at: Date.now(), tidied: [], questions: [], mine: [], undone: false };
    for (const t of this.unread()) {
      const verdict = this.classify(t);
      const item = toItem(t);
      if (verdict.kind === 'mine') run.mine.push(item);
      else if (verdict.kind === 'tidy') run.tidied.push({ ...item, reason: verdict.reason });
      else run.questions.push({ ...item, proposal: verdict.proposal, reason: verdict.reason, resolved: null });
    }
    const ids = run.tidied.map((t) => t.threadId);
    if (ids.length) {
      await this.ctx.actions.markRead(ids, true, 'agent');
      await this.ctx.actions.archive(ids, 'agent');
      this.ctx.db.setSetting('cleanup:tidied', this.ctx.db.getSetting<number>('cleanup:tidied', 0) + ids.length);
    }
    // The conversations waiting for an answer get a drafted reply, in the background.
    run.replies = this.unread()
      .filter((t) => run.mine.some((m) => m.threadId === t.id) && this.needsReply(t))
      .map((t) => ({ ...toItem(t), draft: null, confident: true, reason: '', status: 'drafting' as const }));
    this.save(run);
    void this.draftAll(run.id);
    if (run.questions.length) {
      const n = run.questions.length;
      await this.ctx.notifier.send({
        kind: 'agent',
        title: tp(n, 'J’ai besoin de vous pour {n} mail', 'J’ai besoin de vous pour {n} mails'),
        subtitle: tp(run.tidied.length, '{n} rangé automatiquement', '{n} rangés automatiquement'),
        body: run.questions
          .slice(0, 2)
          .map((q) => `${q.from} : ${q.subject}`)
          .join(' · '),
        // Opens the AI chat on this run rather than a conversation.
        threadId: `agent:${run.id}`,
      });
    }
    return run;
  }

  /** The user's answer to one question; `remember` turns it into a habit for that sender. */
  async resolve(input: { runId: string; threadId: string; decision: CleanupDecision; remember?: boolean; context?: string }) {
    const run = this.run(input.runId);
    const question = run?.questions.find((q) => q.threadId === input.threadId);
    if (!run || !question) throw new Error(t('Question introuvable'));
    if (input.decision === 'archive') {
      await this.ctx.actions.markRead([input.threadId], true, 'agent');
      await this.ctx.actions.archive([input.threadId], 'user');
    }
    if (input.decision === 'trash') await this.ctx.actions.trash([input.threadId], 'user');
    question.resolved = input.decision;
    this.save(run);

    let note = '';
    const sender = this.ctx.store.threadMessages(input.threadId).at(-1)?.from_email;
    if (input.remember && sender) {
      if (input.decision === 'keep') {
        this.ctx.db.setSetting(KEEP_KEY, [...new Set([...this.ctx.db.getSetting<string[]>(KEEP_KEY, []), sender])]);
        note = t('Je ne rangerai plus les mails de {sender}.', { sender });
      } else {
        const rule = this.ctx.rules.create(
          { name: input.decision === 'trash' ? t('Supprimer — {sender}', { sender }) : t('Archiver — {sender}', { sender }), enabled: true, match: 'all', conditions: [{ field: 'from', op: 'equals', value: sender }], actions: [{ type: input.decision }] },
          'agent',
        );
        note = t('Règle « {name} » créée : ce sera automatique.', { name: rule.name });
      }
    }
    // Free context ("les factures OVH je les garde toujours") goes to the agent, which can turn it into a rule.
    if (input.context?.trim()) {
      const reply = await this.ctx.agent.chat(`À propos des mails de ${sender ?? question.from} (« ${question.subject} ») : ${input.context.trim()}`, []);
      note = [note, reply.reply, ...reply.steps.map((s) => s.summary)].filter(Boolean).join('\n');
    }
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: [input.threadId] });
    return { run, note };
  }

  /** Does this conversation wait for an answer from the user? */
  private needsReply(thread: ThreadListItem) {
    return thread.opportunity || ['to-respond', 'opportunity', 'personal'].some((tag) => thread.tags.includes(tag));
  }

  private async draftAll(runId: string) {
    const pending = this.run(runId)?.replies?.filter((r) => r.status === 'drafting') ?? [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < pending.length) {
          const item = pending[next++]!;
          const draft = await this.drafter.draft(item.threadId).catch(() => null);
          this.patchReply(runId, item.threadId, draft ? { draft: draft.text, confident: draft.confident, reason: draft.reason, status: 'ready' } : { status: 'failed', reason: t('Aucun modèle d’IA n’a pu rédiger cette réponse.') });
        }
      }),
    );
  }

  private patchReply(runId: string, threadId: string, patch: Partial<ReplyItem>) {
    const run = this.run(runId);
    const item = run?.replies?.find((r) => r.threadId === threadId);
    if (!run || !item) return null;
    Object.assign(item, patch);
    this.save(run);
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: [threadId] });
    return item;
  }

  /** The user's decision on one drafted reply. */
  async reply(input: { runId: string; threadId: string; action: 'send' | 'rewrite' | 'skip' | 'archive'; text?: string; instruction?: string }) {
    const item = this.run(input.runId)?.replies?.find((r) => r.threadId === input.threadId);
    if (!item) throw new Error(t('Réponse introuvable'));
    if (input.action === 'rewrite') {
      this.patchReply(input.runId, input.threadId, { status: 'drafting' });
      const draft = await this.drafter.draft(input.threadId, input.instruction, input.text ?? item.draft ?? undefined).catch(() => null);
      return this.patchReply(input.runId, input.threadId, draft ? { draft: draft.text, confident: draft.confident, reason: draft.reason, status: 'ready' } : { status: 'ready', reason: t('Impossible de réécrire maintenant, réessayez.') });
    }
    if (input.action === 'send') {
      const text = (input.text ?? item.draft ?? '').trim();
      if (!text) throw new Error(t('La réponse est vide.'));
      const last = this.ctx.store.threadMessages(input.threadId).filter((m) => m.special_use !== 'sent' && m.special_use !== 'drafts').at(-1);
      if (!last) throw new Error(t('Conversation introuvable'));
      const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await this.ctx.actions.send({
        accountId: last.account_id,
        to: [last.reply_to || last.from_email],
        subject: /^re\s*:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`,
        html: text.split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join(''),
        text,
        inReplyToMessageId: last.id,
        threadId: input.threadId,
      });
      await this.ctx.actions.markRead([input.threadId], true, 'agent');
      this.ctx.db.setSetting('cleanup:replied', this.ctx.db.getSetting<number>('cleanup:replied', 0) + 1);
      return this.patchReply(input.runId, input.threadId, { draft: text, status: 'sent' });
    }
    if (input.action === 'archive') {
      await this.ctx.actions.markRead([input.threadId], true, 'agent');
      await this.ctx.actions.archive([input.threadId], 'user');
      return this.patchReply(input.runId, input.threadId, { status: 'archived' });
    }
    return this.patchReply(input.runId, input.threadId, { status: 'skipped' });
  }

  /** Puts every mail the run tidied back in the inbox, unread. */
  async undo(runId: string) {
    const run = this.run(runId);
    if (!run || run.undone) return run;
    const ids = run.tidied.map((t) => t.threadId);
    if (ids.length) {
      await this.ctx.actions.restore(ids, 'agent');
      await this.ctx.actions.markRead(ids, false, 'agent');
      this.ctx.db.setSetting('cleanup:tidied', Math.max(0, this.ctx.db.getSetting<number>('cleanup:tidied', 0) - ids.length));
    }
    run.undone = true;
    this.save(run);
    return run;
  }

  private save(run: CleanupRun) {
    this.ctx.db.setSetting(RUNS_KEY, [run, ...this.runs().filter((r) => r.id !== run.id)].slice(0, 10));
  }

  private unread(): ThreadListItem[] {
    return this.ctx.store.listThreads({ view: 'unread', sort: 'date', limit: 500 }).items;
  }

  /** What to do with one unread conversation. */
  classify(thread: ThreadListItem): Verdict {
    const tags = new Set(thread.tags);
    const sender = thread.from.email.toLowerCase();
    if (this.ctx.db.getSetting<string[]>(KEEP_KEY, []).includes(sender)) return { kind: 'mine' };
    if (thread.priority >= 2 || thread.opportunity || [...tags].some((x) => MINE_TAGS.has(x))) return { kind: 'mine' };

    // The user's own habit with this sender weighs most: archived or deleted several times, never kept.
    const habit = this.ctx.db.all<{ action: string; n: number }>(
      `SELECT action, COUNT(*) AS n FROM action_log WHERE from_email = ? AND at > ? GROUP BY action`,
      sender,
      Date.now() - 90 * 86_400_000,
    );
    const did = (a: string) => habit.find((h) => h.action === a)?.n ?? 0;
    if (did('archive') + did('trash') >= 2 && did('star') + did('reply') === 0) return { kind: 'tidy', reason: t('Vous rangez toujours les mails de cet expéditeur') };

    if (thread.otp && Date.now() - thread.date > 30 * 60_000) return { kind: 'tidy', reason: t('Code de vérification déjà expiré') };
    if (thread.newsletter || (tags.size > 0 && [...tags].every((x) => QUIET_TAGS.has(x)))) {
      const what = thread.newsletter || tags.has('newsletter') ? t('Newsletter') : tags.has('marketing') ? t('Promotion') : t('Notification automatique');
      return { kind: 'tidy', reason: t('{what}, rien à faire', { what }) };
    }
    if (tags.has('security')) return { kind: 'ask', proposal: 'archive', reason: t('Alerte de sécurité : à vérifier si ce n’était pas vous') };
    if (tags.has('finance')) return { kind: 'ask', proposal: 'archive', reason: t('Facture ou paiement : je l’archive, il reste trouvable') };
    if (tags.has('meeting')) return { kind: 'ask', proposal: 'keep', reason: t('Invitation : je vous la laisse si vous devez répondre') };
    if (tags.has('delivery')) return { kind: 'ask', proposal: 'archive', reason: t('Suivi de livraison : utile tant que le colis n’est pas arrivé') };
    return { kind: 'ask', proposal: 'keep', reason: t('Je ne suis pas sûr de ce mail') };
  }
}

const toItem = (t: ThreadListItem): CleanupItem => ({ threadId: t.id, subject: t.subject, from: t.from.name || t.from.email, date: t.date, summary: t.summary || t.snippet });
