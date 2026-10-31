import type { Database } from '../db';
import type { RuleInput, RuleStore } from './engine';
import type { BehaviorAnalytics } from './behavior';
import { FREE_MAIL_DOMAINS, domainOf } from '../lib/address';
import { describeAction } from './engine';
import { bus } from '../lib/events';
import { newId } from '../lib/ids';
import { json } from '../db';
import { SPACE_EXPR, SPACE_JOINS } from '../mail/spaces';
import { t, tp } from '../lib/i18n';

export type UserAction =
  | 'open'
  | 'markRead'
  | 'markUnread'
  | 'star'
  | 'unstar'
  | 'archive'
  | 'trash'
  | 'spam'
  | 'notSpam'
  | 'restore'
  | 'addTag'
  | 'removeTag'
  | 'setBusiness'
  | 'moveToSpace'
  | 'setPriority'
  | 'unsubscribe'
  | 'reply'
  | 'send'
  // Filed into one of the account's folders (drag onto the sidebar, « Déplacer vers »).
  | 'moveToFolder'
  | 'deleteForever'
  // Reading: one « view » per time a conversation is on screen, with how long and how far down.
  | 'view'
  | 'search'
  | 'openLink'
  | 'downloadAttachment'
  | 'copyOtp';

/** Gestures that decide what happens to a conversation (the rest is reading and engagement). */
export const DECISIONS: UserAction[] = ['archive', 'trash', 'spam', 'moveToFolder', 'moveToSpace', 'deleteForever'];

export type ActionLogEntry = {
  action: UserAction;
  threadId?: string | null;
  messageId?: string | null;
  accountId?: string | null;
  fromEmail?: string | null;
  businessId?: string | null;
  tags?: string[];
  listId?: string | null;
  newsletter?: boolean;
  subject?: string | null;
  meta?: Record<string, unknown>;
  /** Conversations handled by the same gesture (a selection of 40 archived at once: 40). */
  batch?: number;
  /** « view » only: how long the conversation was on screen. */
  dwellMs?: number;
};

export type Suggestion = {
  id: string;
  patternKey: string;
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  title: string;
  description: string;
  rule: RuleInput;
  evidence: number;
  matching: number;
  createdAt: number;
};

/** Actions that, repeated on the same kind of mail, are worth turning into a rule. */
const REPEATABLE: Partial<Record<UserAction, { threshold: number; verb: () => string; rule: RuleInput['actions'] }>> = {
  trash: { threshold: 3, verb: () => t('supprimé'), rule: [{ type: 'trash' }] },
  archive: { threshold: 3, verb: () => t('archivé'), rule: [{ type: 'archive' }] },
  spam: { threshold: 2, verb: () => t('classé en spam'), rule: [{ type: 'spam' }] },
  markRead: { threshold: 4, verb: () => t('marqué comme lu sans l’ouvrir'), rule: [{ type: 'markRead' }] },
  star: { threshold: 3, verb: () => t('marqué d’une étoile'), rule: [{ type: 'star' }, { type: 'setPriority', value: '2' }] },
};

const WINDOW_MS = 30 * 86400_000;

/** Actions that make a mail disappear: they are only ever automated on mail that cannot matter. */
const DESTRUCTIVE = new Set<UserAction>(['trash', 'spam', 'archive', 'markRead']);

/** Mail that must never be thrown away by a rule, whatever the sender. */
export const SENSITIVE_TAGS = ['finance', 'chargeback', 'security', 'important', 'to-respond', 'opportunity', 'meeting', 'personal', 'admin'];

/** Every automatic deletion/archiving rule carries these exceptions too, for the mails to come. */
export const GUARDS: RuleInput['conditions'] = [
  { field: 'tag', op: 'isNot', value: 'finance' },
  { field: 'tag', op: 'isNot', value: 'chargeback' },
  { field: 'tag', op: 'isNot', value: 'security' },
  { field: 'tag', op: 'isNot', value: 'important' },
  { field: 'otp', op: 'isNot', value: 'true' },
];

/**
 * Payment, banking, account and administration senders: one of their mails can be a dispute, a
 * fraud alert or a tax notice. Never deleted as a whole, only by precise subject.
 */
const CRITICAL_DOMAINS =
  /(^|\.)(stripe|paypal|shopify|squareup|square|adyen|mollie|lemonsqueezy|paddle|gocardless|wise|revolut|qonto|n26|boursorama|boursobank|bnpparibas|societegenerale|credit-agricole|ca-[a-z-]+|lcl|labanquepostale|caisse-epargne|banquepopulaire|cic|hsbc|amex|americanexpress|visa|mastercard|klarna|alma|scalapay|apple|icloud|google|microsoft|amazon|github|cloudflare|ovh|ovhcloud|contabo|hetzner|aws|impots|gouv|ameli|caf|urssaf|ants|docusign|yousign)\.[a-z.]+$/i;
export const isCriticalDomain = (domain: string) => CRITICAL_DOMAINS.test(domain) || /\.gouv\.[a-z]+$/.test(domain);

type Scope = { domain?: string; from?: string; listId?: string; subject?: string };

/**
 * The subject a series of mails shares once numbers, dates and amounts are set aside: the
 * longest common start of at least 2 words (e.g. « Your weekly summary for »). Null if none.
 */
export function commonSubject(subjects: string[], current: string): { text: string; count: number } | null {
  const clean = (v: string) => v.replace(/^(re|tr|fwd?)\s*:\s*/i, '').trim();
  const words = (v: string) => clean(v).split(/\s+/);
  const base = words(current);
  let best: { text: string; count: number } | null = null;
  for (let size = base.length; size >= 2; size--) {
    const prefix = base.slice(0, size);
    // Stop the shared part before the first word carrying a number (order #1162, 12,40 €, a date).
    const cut = prefix.findIndex((w) => /\d/.test(w));
    const stable = (cut === -1 ? prefix : prefix.slice(0, cut)).join(' ');
    if (stable.split(' ').length < 2 || stable.length < 8) continue;
    const count = subjects.filter((s) => clean(s).toLowerCase().startsWith(stable.toLowerCase())).length;
    if (count > 0 && (!best || count > best.count || (count === best.count && stable.length > best.text.length))) best = { text: stable, count };
  }
  return best;
}

type SuggestionRow = { id: string; pattern_key: string; status: Suggestion['status']; title: string; description: string; rule: string; evidence: number; matching: number; created_at: number; snooze_until: number | null };

export class PatternDetector {
  /** Minimum repetitions can be lowered in tests and from settings. */
  thresholdScale = 1;
  /** The habits analysis (set by the engine): shares and folder habits for the suggestions. */
  behavior?: BehaviorAnalytics;

  constructor(
    private readonly db: Database,
    private readonly rules: RuleStore,
  ) {}

  log(entry: ActionLogEntry) {
    const from = entry.fromEmail?.toLowerCase() ?? null;
    const context = entry.threadId ? this.context(entry.threadId, entry.messageId ?? null) : null;
    this.db.run(
      `INSERT INTO action_log (at, action, thread_id, message_id, account_id, from_email, from_domain, business_id, tags, list_id, newsletter, subject, meta,
         opened, was_unread, dwell_ms, age_ms, mailbox, space_id, priority, batch)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      Date.now(),
      entry.action,
      entry.threadId ?? null,
      entry.messageId ?? null,
      entry.accountId ?? null,
      from,
      from ? domainOf(from) : null,
      entry.businessId ?? null,
      JSON.stringify(entry.tags ?? []),
      entry.listId ?? null,
      entry.newsletter ? 1 : 0,
      entry.subject ?? null,
      JSON.stringify(entry.meta ?? {}),
      context ? (context.opened ? 1 : 0) : null,
      context?.wasUnread ?? null,
      entry.action === 'view' ? Math.round(entry.dwellMs ?? 0) : (context?.dwellMs ?? null),
      context?.ageMs ?? null,
      context?.mailbox ?? null,
      context?.spaceId ?? null,
      context?.priority ?? null,
      Math.max(1, entry.batch ?? 1),
    );
    // The app sends a reading just before the decision it led to, in the same breath; arriving
    // just after it, it still belongs to that decision's context.
    if (entry.action === 'view' && entry.threadId)
      this.db.run(
        `UPDATE action_log SET opened = 1, dwell_ms = COALESCE(dwell_ms, 0) + ?
         WHERE id = (SELECT id FROM action_log WHERE thread_id = ? AND action IN (${DECISIONS.map(() => '?').join(',')}) AND at > ? ORDER BY id DESC LIMIT 1)`,
        Math.round(entry.dwellMs ?? 0),
        entry.threadId,
        ...DECISIONS,
        Date.now() - 10_000,
      );
    this.behavior?.invalidate();
    return this.detect(entry);
  }

  /** The state of a conversation just before a gesture: read in ZMail or not, for how long, where. */
  private context(threadId: string, messageId: string | null) {
    const reads = this.db.get<{ opened: number; dwell: number | null }>(
      `SELECT COUNT(*) AS opened, SUM(CASE WHEN action = 'view' THEN dwell_ms END) AS dwell FROM action_log WHERE thread_id = ? AND action IN ('open', 'view')`,
      threadId,
    );
    const mail = this.db.get<{ date: number; unread: number; mailbox: string | null; priority: number | null; space: string | null }>(
      `SELECT m.date, m.unread, COALESCE(mb.special_use, mb.path) AS mailbox, t.priority, ${SPACE_EXPR} AS space
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id ${SPACE_JOINS}
       WHERE ${messageId ? 'm.id = ?' : 'm.thread_id = ?'} ORDER BY m.date DESC LIMIT 1`,
      messageId ?? threadId,
    );
    return {
      opened: (reads?.opened ?? 0) > 0,
      dwellMs: reads?.dwell ?? 0,
      wasUnread: mail ? mail.unread : null,
      ageMs: mail ? Math.max(0, Date.now() - mail.date) : null,
      mailbox: mail?.mailbox ?? null,
      spaceId: mail?.space ?? null,
      priority: mail?.priority ?? null,
    };
  }

  /** The log as the user reads it: decisions and engagement, not every reading (« view »). */
  history(limit = 200, offset = 0, includeReads = false) {
    return this.db
      .all<{ id: number; at: number; action: UserAction; thread_id: string | null; from_email: string | null; business_id: string | null; tags: string; subject: string | null; meta: string; opened: number | null; dwell_ms: number | null; age_ms: number | null; mailbox: string | null; batch: number }>(
        `SELECT id, at, action, thread_id, from_email, business_id, tags, subject, meta, opened, dwell_ms, age_ms, mailbox, batch FROM action_log
         ${includeReads ? '' : "WHERE action NOT IN ('view', 'search')"} ORDER BY at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      )
      .map((r) => ({ ...r, opened: r.opened === null ? null : r.opened === 1, tags: json<string[]>(r.tags, []), meta: json<Record<string, unknown>>(r.meta, {}) }));
  }

  stats() {
    return this.db.all<{ action: string; n: number }>(
      `SELECT action, COUNT(*) AS n FROM action_log WHERE at > ? AND action NOT IN ('view', 'search') GROUP BY action ORDER BY n DESC`,
      Date.now() - WINDOW_MS,
    );
  }

  private count(sql: string, ...params: (string | number)[]) {
    return this.db.get<{ n: number }>(sql, ...params)?.n ?? 0;
  }

  /** Evaluates the patterns touched by one action; returns the suggestion created, if any. */
  detect(entry: ActionLogEntry): Suggestion | null {
    this.reviveSnoozed();
    const from = entry.fromEmail?.toLowerCase();
    if (!from) return null;
    const since = Date.now() - WINDOW_MS;

    if (entry.action === 'addTag' && typeof entry.meta?.tag === 'string') {
      const tag = entry.meta.tag;
      const n = this.count(
        `SELECT COUNT(DISTINCT thread_id) AS n FROM action_log WHERE action = 'addTag' AND from_email = ? AND at > ? AND json_extract(meta, '$.tag') = ?`,
        from,
        since,
        tag,
      );
      if (n >= Math.ceil(3 * this.thresholdScale)) {
        return this.propose(`addTag:sender:${from}:${tag}`, {
          title: t('Taguer automatiquement les mails de {from} ?', { from }),
          description: t('Vous avez ajouté le tag « {tag} » à {n} mails de {from}. ZMail peut le faire pour vous à chaque nouveau mail.', { tag, n, from }),
          evidence: n,
          rule: { name: t('Catégorie « {tag} » pour {from}', { tag, from }), enabled: true, match: 'all', conditions: [{ field: 'from', op: 'equals', value: from }], actions: [{ type: 'addTag', value: tag }] },
        });
      }
      return null;
    }

    // A sender's mail moved to the same space twice: offer to always put it there.
    if (entry.action === 'moveToSpace' && typeof entry.meta?.spaceId === 'string') {
      const spaceId = entry.meta.spaceId;
      const space = typeof entry.meta.spaceName === 'string' ? entry.meta.spaceName : spaceId;
      const n = this.count(
        `SELECT COUNT(DISTINCT thread_id) AS n FROM action_log WHERE action = 'moveToSpace' AND from_email = ? AND at > ? AND json_extract(meta, '$.spaceId') = ?`,
        from,
        since,
        spaceId,
      );
      if (n >= Math.ceil(2 * this.thresholdScale)) {
        return this.propose(`moveToSpace:sender:${from}:${spaceId}`, {
          title: t('Ranger toujours les mails de {from} dans « {space} » ?', { from, space }),
          description: t('Vous avez déplacé {n} conversations de {from} vers l’espace « {space} ». ZMail peut y ranger les prochaines tout seul.', { n, from, space }),
          evidence: n,
          rule: { name: t('Espace « {space} » pour {from}', { space, from }), enabled: true, match: 'all', conditions: [{ field: 'from', op: 'equals', value: from }], actions: [{ type: 'setSpace', value: spaceId }] },
        });
      }
      return null;
    }

    if (entry.action === 'unsubscribe') return this.detectNewsletterCleanup();

    // Most of a list, sender or domain filed into the same folder: offer to file the next ones.
    if (entry.action === 'moveToFolder') {
      const habit = this.behavior?.folderHabit(entry);
      if (!habit?.rule || this.isDismissed(`moveToFolder:${habit.id}`)) return null;
      const pct = Math.round(habit.share * 100);
      // « de julie@… », « de @saas.com », « de la liste … »
      const of = habit.dimension === 'list' ? t('de la liste {label}', { label: habit.label }) : t('de {label}', { label: habit.dimension === 'domain' ? `@${habit.key}` : habit.label });
      return this.propose(`moveToFolder:${habit.id}`, {
        title: t('Ranger automatiquement les mails {of} dans « {folder} » ?', { of, folder: habit.targetLabel ?? '' }),
        description: t('Vous avez rangé {support} des {total} mails {of} de ces 3 derniers mois dans « {folder} » ({pct} %). ZMail peut y ranger les prochains tout seul.', {
          support: habit.support,
          total: habit.total,
          of,
          folder: habit.targetLabel ?? '',
          pct,
        }),
        evidence: habit.support,
        rule: { ...habit.rule, name: t('Dossier « {folder} » — {label}', { folder: habit.targetLabel ?? '', label: habit.label }) },
      });
    }

    const spec = REPEATABLE[entry.action];
    if (!spec) return null;

    // Mails the user engages with (replies, stars, re-opens to read) are never auto-handled.
    const engaged = this.count(
      `SELECT COUNT(*) AS n FROM action_log WHERE from_email = ? AND at > ? AND action IN ('reply', 'star', 'restore', 'notSpam', 'markUnread')`,
      from,
      since,
    );
    if (engaged > 0 && entry.action !== 'star') return null;

    const threshold = Math.max(1, Math.ceil(spec.threshold * this.thresholdScale));
    const actions = [...spec.rule];
    const unsubscribable = entry.newsletter && (entry.action === 'trash' || entry.action === 'archive');
    if (unsubscribable) actions.unshift({ type: 'unsubscribe' });
    // The title names the main action; the unsubscribe that comes with it is said in the text.
    const what = spec.rule.map(describeAction).join(t(' puis '));
    const What = capitalize(what);
    const verb = spec.verb();
    const destructive = DESTRUCTIVE.has(entry.action);
    const domain = domainOf(from);
    const freeDomain = FREE_MAIL_DOMAINS.has(domain);

    // What the user did with this kind of mail lately: one line per conversation.
    const acted = this.db
      .all<{ from_email: string; subject: string | null; tags: string; list_id: string | null }>(
        `SELECT from_email, subject, tags, list_id FROM action_log WHERE action = ? AND at > ? AND ${freeDomain ? 'from_email = ?' : 'from_domain = ?'}
         GROUP BY COALESCE(thread_id, id)`,
        entry.action,
        since,
        freeDomain ? from : domain,
      )
      .map((r) => ({ ...r, tags: json<string[]>(r.tags, []) }));
    const fromSender = acted.filter((a) => a.from_email === from);

    // From the broadest to the most precise; the first one that is both repeated enough and safe wins.
    type Candidate = { key: string; scope: Scope; evidence: number; conditions: RuleInput['conditions']; label: string };
    const candidates: Candidate[] = [];
    const senders = new Set(acted.map((a) => a.from_email)).size;
    if (!freeDomain && senders >= 2 && acted.length >= threshold + 1 && (!destructive || !isCriticalDomain(domain)))
      candidates.push({ key: `domain:${domain}`, scope: { domain }, evidence: acted.length, conditions: [{ field: 'fromDomain', op: 'equals', value: domain }], label: `@${domain}` });
    if (fromSender.length >= threshold && (!destructive || !isCriticalDomain(domain)))
      candidates.push({ key: `sender:${from}`, scope: { from }, evidence: fromSender.length, conditions: [{ field: 'from', op: 'equals', value: from }], label: from });
    const list = entry.listId ? fromSender.filter((a) => a.list_id === entry.listId) : [];
    if (entry.listId && list.length >= threshold)
      candidates.push({ key: `list:${entry.listId}`, scope: { from, listId: entry.listId }, evidence: list.length, conditions: [{ field: 'listId', op: 'equals', value: entry.listId }], label: from });
    const stem = commonSubject(fromSender.map((a) => a.subject ?? ''), entry.subject ?? '');
    if (stem && stem.count >= threshold)
      candidates.push({
        key: `subject:${from}:${stem.text.toLowerCase()}`,
        scope: { from, subject: stem.text },
        evidence: stem.count,
        conditions: [
          { field: 'from', op: 'equals', value: from },
          { field: 'subject', op: 'contains', value: stem.text },
        ],
        label: t('« {subject} » de {from}', { subject: stem.text, from }),
      });

    for (const candidate of candidates) {
      // Everything this pattern would have caught in the last months, not only what was deleted.
      const reach = this.reach(candidate.scope);
      if (destructive && (reach.sensitive > 0 || candidate.evidence < reach.total * 0.5 - 1)) continue;
      if (this.isDismissed(`${entry.action}:${candidate.key}`)) continue;
      const conditions = destructive ? [...candidate.conditions, ...GUARDS] : candidate.conditions;
      const safety = destructive
        ? reach.total > candidate.evidence
          ? t('Vérifié sur les {n} mails reçus de cette source : aucune facture, aucun litige, aucun code, rien d’important. Et la règle ne touchera jamais ces mails-là.', { n: reach.total })
          : t('Aucune facture, aucun litige, aucun code ni mail important parmi ces mails. Et la règle ne touchera jamais ces mails-là.')
        : '';
      return this.propose(`${entry.action}:${candidate.key}`, {
        title: t('{What} automatiquement {label} ?', { What, what, label: candidate.scope.subject ? t('les mails {label}', { label: candidate.label }) : t('les mails de {label}', { label: candidate.label }) }),
        // First paragraph: what was seen. Second: what was checked (shown apart in the dialog).
        description: [
          [t('Vous avez {verb} {n} de ces mails ces 30 derniers jours.', { verb, n: candidate.evidence }), this.shareOf(candidate.scope, entry.action), unsubscribable ? t('C’est une newsletter : ZMail peut aussi s’en désinscrire.') : ''].filter(Boolean).join(' '),
          safety,
        ]
          .filter(Boolean)
          .join('\n'),
        evidence: candidate.evidence,
        rule: { name: t('{What} — {label}', { What, label: candidate.label }), enabled: true, match: 'all', conditions, actions },
      });
    }
    return null;
  }

  /** « Soit 9 sur 10 reçus (90 %), dont 8 sans les ouvrir. » — the habit as a share, when known. */
  private shareOf(scope: Scope, action: UserAction) {
    if (scope.subject) return '';
    const p = this.behavior?.profile(scope, action);
    if (!p || p.received < 2 || !p.acted) return '';
    const unopened = Math.round(p.unopened * p.acted);
    return [
      t('Soit {acted} sur {received} reçus ({pct} %)', { acted: p.acted, received: p.received, pct: Math.round(p.share * 100) }),
      unopened ? t(', dont {n} sans les ouvrir.', { n: unopened }) : '.',
    ].join('');
  }

  /**
   * How many mails a pattern would have caught (last 6 months, every folder but sent and drafts),
   * and how many of them matter: invoices, disputes, codes, important, opportunities, replies due.
   */
  private reach(scope: Scope) {
    const where: string[] = [];
    const params: (string | number)[] = [Date.now() - 180 * 86400_000];
    if (scope.domain) (where.push("(m.from_email LIKE '%@' || ? OR m.from_email LIKE '%.' || ?)"), params.push(scope.domain, scope.domain));
    if (scope.from) (where.push('m.from_email = ?'), params.push(scope.from));
    if (scope.listId) (where.push('m.list_id = ?'), params.push(scope.listId));
    if (scope.subject) (where.push("LOWER(m.subject) LIKE '%' || LOWER(?) || '%'"), params.push(scope.subject));
    const row = this.db.get<{ total: number; sensitive: number }>(
      `SELECT COUNT(DISTINCT m.thread_id) AS total,
              COUNT(DISTINCT CASE WHEN t.otp IS NOT NULL OR t.opportunity = 1 OR t.priority >= 2
                OR EXISTS (SELECT 1 FROM json_each(t.tags) j WHERE j.value IN (${SENSITIVE_TAGS.map(() => '?').join(',')})) THEN m.thread_id END) AS sensitive
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
       WHERE m.date > ? AND COALESCE(mb.special_use, '') NOT IN ('sent', 'drafts') AND ${where.join(' AND ')}`,
      ...SENSITIVE_TAGS,
      ...params,
    );
    return { total: row?.total ?? 0, sensitive: row?.sensitive ?? 0 };
  }

  private isDismissed(patternKey: string) {
    return Boolean(this.db.get(`SELECT 1 FROM suggestions WHERE pattern_key = ? AND status = 'dismissed'`, patternKey));
  }

  /** After a few manual unsubscribes, offer to clean up the newsletters that are never opened. */
  private detectNewsletterCleanup(): Suggestion | null {
    const unsubscribes = this.count(`SELECT COUNT(*) AS n FROM action_log WHERE action = 'unsubscribe' AND at > ?`, Date.now() - WINDOW_MS);
    if (unsubscribes < Math.max(1, Math.ceil(2 * this.thresholdScale))) return null;
    const senders = this.db.all<{ from_email: string; total: number }>(
      `SELECT m.from_email, COUNT(*) AS total FROM messages m
       JOIN triage t ON t.message_id = m.id JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE t.newsletter = 1 AND t.unsubscribe IS NOT NULL AND mb.special_use = 'inbox'
         AND m.from_email NOT IN (SELECT from_email FROM unsubscribes WHERE status IN ('success', 'pending'))
       GROUP BY m.from_email
       HAVING SUM(CASE WHEN m.unread = 0 THEN 1 ELSE 0 END) = 0 AND COUNT(*) >= 2
       ORDER BY total DESC LIMIT 12`,
    );
    if (senders.length === 0) return null;
    const list = senders.map((s) => s.from_email);
    return this.propose(`unsubscribe:unread-newsletters:${list.slice(0, 3).join(',')}`, {
      title: tp(senders.length, 'Se désinscrire de {n} newsletter jamais ouverte ?', 'Se désinscrire de {n} newsletters jamais ouvertes ?'),
      description: t('Vous venez de vous désinscrire de plusieurs listes. Ces expéditeurs vous ont envoyé {total} mails que vous n’avez jamais ouverts : {list}. ZMail peut se désinscrire pour vous et archiver leurs prochains envois.', {
        total: senders.reduce((n, s) => n + s.total, 0),
        list: `${list.slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''}`,
      }),
      evidence: senders.length,
      rule: {
        name: t('Newsletters jamais ouvertes'),
        enabled: true,
        match: 'any',
        conditions: list.map((email) => ({ field: 'from' as const, op: 'equals' as const, value: email })),
        actions: [{ type: 'unsubscribe' }, { type: 'archive' }],
      },
    });
  }

  private reviveSnoozed() {
    this.db.run(`UPDATE suggestions SET status = 'pending', snooze_until = NULL WHERE status = 'snoozed' AND snooze_until < ?`, Date.now());
  }

  private propose(patternKey: string, input: { title: string; description: string; evidence: number; rule: RuleInput }): Suggestion | null {
    const existing = this.db.get<SuggestionRow>('SELECT * FROM suggestions WHERE pattern_key = ?', patternKey);
    if (existing) {
      if (existing.status === 'pending') this.db.run('UPDATE suggestions SET evidence = ?, description = ? WHERE id = ?', input.evidence, input.description, existing.id);
      return null;
    }
    // A rule already doing this exact thing makes the suggestion pointless.
    const covered = this.rules.list().some(
      (rule) =>
        rule.enabled &&
        JSON.stringify(rule.conditions) === JSON.stringify(input.rule.conditions) &&
        input.rule.actions.every((a) => rule.actions.some((b) => b.type === a.type)),
    );
    if (covered) return null;

    const id = newId('sug');
    const matching = this.countMatching(input.rule);
    this.db.run(
      `INSERT INTO suggestions (id, pattern_key, status, title, description, rule, evidence, matching, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      id,
      patternKey,
      input.title,
      input.description,
      JSON.stringify(input.rule),
      input.evidence,
      matching,
      Date.now(),
    );
    bus.emitEvent({ type: 'suggestion', id });
    return this.suggestion(id)!;
  }

  /** The rule's conditions as SQL (sender, domain, subject, list, exceptions), for counting and previewing. */
  private ruleWhere(rule: RuleInput) {
    const clauses: string[] = [];
    const params: string[] = [];
    for (const c of rule.conditions) {
      if (c.field === 'from') (clauses.push('m.from_email = ?'), params.push(c.value.toLowerCase()));
      else if (c.field === 'fromDomain') (clauses.push("(m.from_email LIKE '%@' || ? OR m.from_email LIKE '%.' || ?)"), params.push(c.value, c.value));
      else if (c.field === 'subject' && c.op === 'contains') (clauses.push("LOWER(m.subject) LIKE '%' || LOWER(?) || '%'"), params.push(c.value));
      else if (c.field === 'listId') (clauses.push('m.list_id = ?'), params.push(c.value));
      else if (c.field === 'tag' && c.op === 'isNot') (clauses.push('NOT EXISTS (SELECT 1 FROM json_each(t.tags) j WHERE j.value = ?)'), params.push(c.value));
      else if (c.field === 'otp' && c.op === 'isNot') clauses.push('t.otp IS NULL');
    }
    return clauses.length ? { sql: `(${clauses.join(rule.match === 'any' ? ' OR ' : ' AND ')})`, params } : null;
  }

  /** Conversations in the inbox the rule would catch now, with the same conditions as the rule. */
  private countMatching(rule: RuleInput) {
    const where = this.ruleWhere(rule);
    if (!where) return 0;
    return this.count(
      `SELECT COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
       WHERE mb.special_use = 'inbox' AND ${where.sql}`,
      ...where.params,
    );
  }

  /**
   * The mails a suggestion would act on, to look at before saying yes (an unsubscribe cannot be
   * taken back from here): the latest of each conversation, newest first, wherever it is —
   * even in the trash, since the habit is often born from deleting them.
   */
  samples(id: string, limit = 8) {
    const suggestion = this.suggestion(id);
    const where = suggestion ? this.ruleWhere(suggestion.rule) : null;
    if (!where) return [];
    return this.db.all<{ thread_id: string; from_name: string | null; from_email: string; subject: string; date: number; summary: string | null; unread: number; folder: string | null }>(
      `SELECT m.thread_id, m.from_name, m.from_email, m.subject, MAX(m.date) AS date, t.summary, MAX(m.unread) AS unread, mb.special_use AS folder
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
       WHERE COALESCE(mb.special_use, '') NOT IN ('sent', 'drafts') AND ${where.sql}
       GROUP BY m.thread_id ORDER BY MIN(CASE WHEN mb.special_use = 'trash' THEN 1 ELSE 0 END), date DESC LIMIT ?`,
      ...where.params,
      limit,
    ).map((r) => ({ threadId: r.thread_id, from: r.from_name || r.from_email, email: r.from_email, subject: r.subject, date: r.date, summary: r.summary ?? '', unread: r.unread === 1 }));
  }

  private toSuggestion(row: SuggestionRow): Suggestion {
    return {
      id: row.id,
      patternKey: row.pattern_key,
      status: row.status,
      title: row.title,
      description: row.description,
      rule: json<RuleInput>(row.rule, { name: '', enabled: true, match: 'all', conditions: [], actions: [] }),
      evidence: row.evidence,
      matching: row.matching,
      createdAt: row.created_at,
    };
  }

  suggestion(id: string) {
    const row = this.db.get<SuggestionRow>('SELECT * FROM suggestions WHERE id = ?', id);
    return row ? this.toSuggestion(row) : undefined;
  }

  pending(): Suggestion[] {
    this.reviveSnoozed();
    // Suggestions made before the safety checks (a whole domain to the trash, no exceptions)
    // are withdrawn: the detector proposes again only what is safe.
    for (const row of this.db.all<SuggestionRow>(`SELECT * FROM suggestions WHERE status IN ('pending', 'snoozed')`)) {
      const rule = this.toSuggestion(row).rule;
      const destructive = rule.actions.some((a) => ['trash', 'spam', 'archive', 'markRead'].includes(a.type));
      const guarded = rule.conditions.some((c) => c.field === 'tag' && c.op === 'isNot');
      if (destructive && !guarded && !row.pattern_key.startsWith('unsubscribe:')) this.db.run('DELETE FROM suggestions WHERE id = ?', row.id);
    }
    return this.db.all<SuggestionRow>(`SELECT * FROM suggestions WHERE status = 'pending' ORDER BY created_at`).map((r) => this.toSuggestion(r));
  }

  all(): Suggestion[] {
    return this.db.all<SuggestionRow>('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 100').map((r) => this.toSuggestion(r));
  }

  decide(id: string, status: 'accepted' | 'dismissed' | 'snoozed') {
    this.db.run(
      'UPDATE suggestions SET status = ?, decided_at = ?, snooze_until = ? WHERE id = ?',
      status,
      Date.now(),
      status === 'snoozed' ? Date.now() + 3 * 86400_000 : null,
      id,
    );
  }
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
