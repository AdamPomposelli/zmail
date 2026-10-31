import type { EngineContext } from '../context';
import type { Priority, Triage } from '../types';
import { toTriage, type MessageRow } from '../mail/store';
import type { Rule, RuleSubject } from '../rules/engine';
import { classifyHeuristically, type HeuristicResult, type MailFeatures } from './heuristics';
import { PRIORITY_LABELS } from '../types';
import { mergeTriage, type ModelTriage } from './merge';
import { buildTriageRequest } from './prompts';
import { json } from '../db';
import { bus } from '../lib/events';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

type Located = MessageRow & { special_use: string | null; path: string };

export const featuresOf = (row: MessageRow): MailFeatures => ({
  subject: row.subject,
  text: row.text_body,
  html: row.html_body,
  from: { name: row.from_name || undefined, email: row.from_email },
  to: json(row.to_json, []),
  cc: json(row.cc_json, []),
  listUnsubscribe: row.list_unsubscribe,
  listUnsubscribePost: row.list_unsubscribe_post,
  listId: row.list_id,
  precedence: row.precedence,
  autoSubmitted: row.auto_submitted,
  spamHeader: row.spam_header,
  authResults: row.auth_results,
  attachments: json(row.attachments, []),
});

/**
 * The arrival pipeline every incoming mail goes through: business assignment, classification
 * (model when available, heuristics otherwise), OTP extraction, rules, then notifications.
 */
/** A « Relancer le tri IA » run: every mail re-read by the AI, followed from Settings. */
export type RetriageRun = {
  total: number;
  done: number;
  /** Mails whose category, priority, spam or code changed. */
  changed: number;
  startedAt: number;
  finishedAt: number | null;
  cancelled: boolean;
  /** No AI model could sort: only ZMail's local rules re-read the mails they had sorted. */
  localOnly: boolean;
};

export class TriagePipeline {
  private queue: { id: string; force: boolean }[] = [];
  private batch: { run: RetriageRun; ids: Set<string> } | null = null;
  private queued = new Set<string>();
  private urgent = new Set<string>();
  private finished: number[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];
  concurrency = 2;

  constructor(private readonly ctx: EngineContext) {}

  enqueue(ids: string[], force = false) {
    const fresh = ids.filter((id) => !this.queued.has(id));
    if (!fresh.length) return;
    // A mail that just arrived (a code, a reply) goes before any backlog: importing a whole
    // mailbox must never delay its notification. The rest is read newest first.
    const rows = this.ctx.db.all<{ id: string; date: number; is_new: number }>(`SELECT id, date, is_new FROM messages WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(fresh));
    const date = new Map(rows.map((r) => [r.id, r.date]));
    const urgent = new Set(rows.filter((r) => r.is_new === 1 || r.date > Date.now() - 6 * 3600_000).map((r) => r.id));
    const jobs = [...fresh].sort((a, b) => (date.get(b) ?? 0) - (date.get(a) ?? 0)).map((id) => ({ id, force }));
    for (const id of fresh) this.queued.add(id);
    const firstBacklog = this.queue.findIndex((job) => !this.urgent.has(job.id));
    const head = jobs.filter((job) => urgent.has(job.id));
    head.forEach((job) => this.urgent.add(job.id));
    this.queue.splice(firstBacklog === -1 ? this.queue.length : firstBacklog, 0, ...head);
    this.queue.push(...jobs.filter((job) => !urgent.has(job.id)));
    this.pump();
  }

  /** Mails read per second lately, for time estimates. */
  rate() {
    const recent = this.finished.filter((at) => Date.now() - at < 120_000);
    if (recent.length < 3) return null;
    return recent.length / Math.max((Date.now() - recent[0]!) / 1000, 1);
  }

  /**
   * Re-reads every mail the AI sorted (the user's own corrections are kept) with the current
   * mode, categories and rules: inbox first, newest first, so the visible part changes first.
   */
  async retriageAll(): Promise<RetriageRun> {
    if (this.batch && !this.batch.run.finishedAt) return this.batch.run;
    // With no model to sort (e.g. the free model became paid), re-reading everything would replace
    // the AI's sorting with the local engine's: only what the local engine sorted is redone.
    const plan = await this.ctx.ai.plan('triage');
    const localOnly = plan.candidates.length === 0 && !plan.consensus;
    const ids = this.ctx.db
      .all<{ message_id: string }>(
        `SELECT t.message_id FROM triage t JOIN messages m ON m.id = t.message_id JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE t.user_override = 0 AND COALESCE(mb.special_use, '') NOT IN ('sent', 'drafts') ${localOnly ? "AND t.engine = 'heuristic'" : ''}
         ORDER BY CASE mb.special_use WHEN 'inbox' THEN 0 ELSE 1 END, m.date DESC`,
      )
      .map((r) => r.message_id);
    const run: RetriageRun = { total: ids.length, done: 0, changed: 0, startedAt: Date.now(), finishedAt: ids.length ? null : Date.now(), cancelled: false, localOnly };
    this.batch = { run, ids: new Set(ids) };
    if (run.finishedAt) this.ctx.db.setSetting('retriage:last', run);
    this.enqueue(ids, true);
    return run;
  }

  /** The run in progress, or the last one (kept across restarts, so the settings can say when). */
  retriageStatus(): RetriageRun | null {
    return this.batch?.run ?? this.ctx.db.getSetting<RetriageRun | null>('retriage:last', null);
  }

  /** Stops a run: what is done stays done, the rest keeps its previous sorting. */
  cancelRetriage() {
    const batch = this.batch;
    if (!batch || batch.run.finishedAt) return batch?.run ?? null;
    this.queue = this.queue.filter((job) => {
      if (!batch.ids.has(job.id)) return true;
      this.queued.delete(job.id);
      batch.ids.delete(job.id);
      return false;
    });
    batch.run.cancelled = true;
    // Only the mails being read right now are left; it ends with them.
    if (batch.ids.size === 0) this.finishBatch();
    return batch.run;
  }

  private finishBatch() {
    if (!this.batch) return;
    this.batch.run.finishedAt = Date.now();
    this.ctx.db.setSetting('retriage:last', this.batch.run);
  }

  private batchProgress(id: string, changed: boolean) {
    const batch = this.batch;
    if (!batch || !batch.ids.has(id) || batch.run.finishedAt) return;
    batch.ids.delete(id);
    batch.run.done++;
    if (changed) batch.run.changed++;
    if (batch.ids.size === 0) this.finishBatch();
  }

  /** Resolves once the queue is drained (used by tests and the seed script). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      let changed = false;
      this.process(job.id, job.force, (c) => (changed = c))
        .catch((error) => log.error('pipeline', job.id, (error as Error).stack ?? error))
        .finally(() => {
          this.batchProgress(job.id, changed);
          this.running--;
          this.queued.delete(job.id);
          this.urgent.delete(job.id);
          this.finished.push(Date.now());
          if (this.finished.length > 60) this.finished.shift();
          if (this.running === 0 && this.queue.length === 0) {
            bus.emitEvent({ type: 'mail', reason: 'triaged', threadIds: [] });
            void this.ctx.refreshBadge();
            this.idleWaiters.splice(0).forEach((resolve) => resolve());
          }
          this.pump();
        });
    }
  }

  async process(messageId: string, force = false, onChanged?: (changed: boolean) => void): Promise<Triage | null> {
    const row = this.ctx.store.message(messageId);
    if (!row || row.special_use === 'sent' || row.special_use === 'drafts') return null;
    const existing = this.ctx.store.triage(messageId);
    if (existing && !force) return null;

    let triage = await this.classify(row);
    if (existing?.user_override && !force) return null;

    const fired: Rule[] = [];
    if (row.special_use === 'inbox') {
      const subject = this.ruleSubject(row, triage);
      for (const rule of this.ctx.rules.matching(subject)) {
        fired.push(rule);
        triage = this.applyTriageActions(rule, triage);
      }
      triage.rulesApplied = fired.map((r) => r.id);
    }
    this.ctx.store.saveTriage(messageId, triage);
    if (existing && onChanged) {
      const before = toTriage(existing);
      onChanged(Boolean(before) && (before!.priority !== triage.priority || before!.spam !== triage.spam || before!.otp !== triage.otp || [...before!.tags].sort().join() !== [...triage.tags].sort().join()));
    }
    await this.runMailboxActions(row, triage, fired);
    await this.ctx.serverSync.aiSorted(messageId, triage, toTriage(existing)).catch((error) => log.warn('pipeline', 'server sync', (error as Error).message));
    // Only the first sorting of a mail that just arrived notifies: re-sorting never does again.
    if (row.is_new === 1 && !existing) await this.notify(row, triage, fired);
    return triage;
  }

  ruleSubject(row: MessageRow, triage: Triage): RuleSubject {
    return {
      accountId: row.account_id,
      from: row.from_email,
      to: json<{ email: string }[]>(row.to_json, []).map((a) => a.email),
      subject: row.subject,
      body: row.text_body.slice(0, 5000),
      listId: row.list_id,
      triage,
    };
  }

  async classify(row: Located): Promise<Triage> {
    const features = featuresOf(row);
    const heuristic = classifyHeuristically(features);
    const businessId = this.ctx.catalog.resolveBusiness({
      accountId: row.account_id,
      from: features.from,
      to: features.to,
      cc: features.cc,
      deliveredTo: row.delivered_to,
    });

    // Only the categories of the space the mail lands in (and the shared ones).
    const spaceTags = this.ctx.catalog.tagsForSpace(this.ctx.spaces.spaceFor({ threadId: row.thread_id, businessId, accountId: row.account_id }));
    const model = await this.askModel(row, features, heuristic, businessId, spaceTags);
    const merged = mergeTriage({
      heuristic,
      model: model?.data ?? null,
      text: `${row.subject}\n${row.text_body}`,
      knownTags: new Set(spaceTags.map((t) => t.id)),
      customTags: model ? [] : this.ctx.catalog.matchCustomTags(`${row.subject}\n${row.from_email}\n${row.text_body.slice(0, 3000)}`),
      folder: row.special_use,
    });

    // A category the user removed never comes back through a floor or a heuristic.
    const visible = new Set(spaceTags.map((t) => t.id));
    merged.tags = merged.tags.filter((id) => visible.has(id));

    return {
      businessId,
      ...merged,
      newsletter: heuristic.newsletter,
      unsubscribe: heuristic.unsubscribe,
      engine: model?.provider ?? 'heuristic',
      userOverride: false,
      rulesApplied: [],
    };
  }

  private async askModel(row: Located, features: MailFeatures, heuristic: HeuristicResult, businessId: string | null, tags = this.ctx.catalog.tags()) {
    const businesses = this.ctx.catalog.businesses();
    const request = buildTriageRequest({
      features,
      bulk: heuristic.bulk,
      tags,
      business: businessId ? businesses.find((b) => b.id === businessId) : undefined,
      businesses,
    }, this.ctx.prompts.get());
    const result = await this.ctx.ai.complete('triage', request);
    if (!result || typeof result.data !== 'object' || result.data === null) return null;
    return { provider: result.provider === 'apple' ? 'apple' : result.model, data: result.data as ModelTriage };
  }

  private applyTriageActions(rule: Rule, triage: Triage): Triage {
    let next = { ...triage, tags: [...triage.tags] };
    for (const action of rule.actions) {
      if (action.type === 'addTag' && action.value && !next.tags.includes(action.value)) next.tags.push(action.value);
      if (action.type === 'setPriority' && action.value) next.priority = Math.max(0, Math.min(3, Number(action.value))) as Priority;
      if (action.type === 'setBusiness') next.businessId = action.value || null;
      if (action.type === 'spam') next = { ...next, spam: true, spamReason: t('Règle « {name} »', { name: rule.name }), priority: 0 };
    }
    return next;
  }

  /** Actions that touch the mailbox; they run after the triage is saved. */
  private async runMailboxActions(row: Located, triage: Triage, fired: Rule[]) {
    for (const rule of fired) {
      this.ctx.rules.recordHit(rule.id);
      for (const action of rule.actions) {
        try {
          if (action.type === 'archive') await this.ctx.actions.archive([row.thread_id], 'rule');
          if (action.type === 'trash') await this.ctx.actions.trash([row.thread_id], 'rule');
          if (action.type === 'markRead') await this.ctx.actions.markRead([row.thread_id], true, 'rule');
          if (action.type === 'star') await this.ctx.actions.star([row.thread_id], true, 'rule');
          if (action.type === 'setSpace' && action.value) this.ctx.spaces.move([row.thread_id], action.value, 'rule');
          // A folder of the same account (the rule says which account; another account's mail stays).
          if (action.type === 'moveToFolder' && action.value) await this.ctx.actions.moveToFolder([row.thread_id], action.value, 'rule');
          if (action.type === 'unsubscribe') {
            const done = this.ctx.db.get(`SELECT 1 FROM unsubscribes WHERE from_email = ? AND status IN ('success', 'pending')`, row.from_email);
            // This mail may lack the header; any earlier mail of the same sender carrying one will do.
            const source = triage.unsubscribe
              ? row.thread_id
              : this.ctx.db.get<{ thread_id: string }>(
                  `SELECT m.thread_id FROM messages m JOIN triage t ON t.message_id = m.id
                   WHERE m.from_email = ? AND t.unsubscribe IS NOT NULL ORDER BY m.date DESC LIMIT 1`,
                  row.from_email,
                )?.thread_id;
            if (!done && source) void this.ctx.subscriptions.unsubscribe(source, 'rule').catch(() => undefined);
          }
        } catch (error) {
          log.warn('rules', `${rule.name}: ${action.type} failed`, (error as Error).message);
        }
      }
    }
  }

  private async notify(row: Located, triage: Triage, fired: Rule[]) {
    if (triage.spam) return;
    const sender = row.from_name || row.from_email;
    const business = triage.businessId ? this.ctx.catalog.businesses().find((b) => b.id === triage.businessId) : undefined;
    const notifier = this.ctx.notifier;
    const base = { threadId: row.thread_id, subtitle: business ? `${business.emoji ?? ''} ${business.name}`.trim() : row.subject };

    if (triage.otp && notifier.allows('otp')) {
      await notifier.send({ ...base, kind: 'otp', title: t('Code {code}', { code: triage.otp }), subtitle: sender, body: t('{subject} — touchez « Copier le code »', { subject: row.subject || t('Code de vérification') }), otp: triage.otp });
      return;
    }
    const ruleNotify = fired.find((r) => r.actions.some((a) => a.type === 'notify'));
    if (ruleNotify && notifier.allows('rule', { businessId: triage.businessId })) {
      await notifier.send({ ...base, kind: 'rule', title: `${ruleNotify.name} · ${sender}`, body: triage.summary || row.subject });
      return;
    }
    if (triage.priority >= 3 && notifier.allows('priority', { priority: 3, businessId: triage.businessId })) {
      await notifier.send({ ...base, kind: 'priority', title: t('Urgent · {sender}', { sender }), body: triage.summary || row.subject });
      return;
    }
    if (triage.opportunity && notifier.allows('opportunity', { businessId: triage.businessId })) {
      await notifier.send({ ...base, kind: 'opportunity', title: business ? t('Opportunité · {business} · {sender}', { business: business.name, sender }) : t('Opportunité · {sender}', { sender }), body: triage.opportunityReason ?? triage.summary ?? row.subject });
      return;
    }
    if (triage.priority === 2 && notifier.allows('priority', { priority: 2, businessId: triage.businessId })) {
      await notifier.send({ ...base, kind: 'priority', title: t('Prioritaire · {sender}', { sender }), body: triage.summary || row.subject });
    }
  }

  /** Runs a rule over the mail already in the inbox (when a suggestion is accepted). */
  async applyRuleToExisting(rule: Rule) {
    const rows = this.ctx.db.all<Located>(
      `SELECT m.*, mb.special_use, mb.path FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE mb.special_use = 'inbox' ORDER BY m.date DESC LIMIT 2000`,
    );
    const threads = new Set<string>();
    for (const row of rows) {
      const triage = this.ctx.store.triage(row.id);
      if (!triage || threads.has(row.thread_id)) continue;
      const current = toTriage(triage)!;
      if (!this.ctx.rules.matching(this.ruleSubject(row, current)).some((r) => r.id === rule.id)) continue;
      threads.add(row.thread_id);
      this.ctx.store.saveTriage(row.id, { ...this.applyTriageActions(rule, current), rulesApplied: [...current.rulesApplied, rule.id] });
      await this.runMailboxActions(row, current, [rule]);
    }
    return threads.size;
  }

  /** A rule that unsubscribes acts at once on the senders it names, even with no mail left in the inbox. */
  unsubscribeSenders(rule: Rule) {
    for (const condition of rule.conditions.filter((c) => c.field === 'from' && (c.op === 'equals' || c.op === 'is'))) {
      const done = this.ctx.db.get(`SELECT 1 FROM unsubscribes WHERE from_email = ? AND status IN ('success', 'pending')`, condition.value);
      const source = this.ctx.db.get<{ thread_id: string }>(
        `SELECT m.thread_id FROM messages m JOIN triage t ON t.message_id = m.id WHERE m.from_email = ? AND t.unsubscribe IS NOT NULL ORDER BY m.date DESC LIMIT 1`,
        condition.value,
      );
      if (!done && source) void this.ctx.subscriptions.unsubscribe(source.thread_id, 'rule').catch(() => undefined);
    }
  }

  backfill() {
    const pending = this.ctx.store.untriaged(5000).map((r) => r.id);
    if (pending.length) log.info('pipeline', `triaging ${pending.length} messages`);
    this.enqueue(pending);
  }
}

export const priorityLabel = (p: Priority) => PRIORITY_LABELS[p];
