import type { Database } from '../db';
import type { RuleInput, RuleStore } from './engine';
import { FREE_MAIL_DOMAINS, domainOf } from '../lib/address';
import { describeAction } from './engine';
import { bus } from '../lib/events';
import { newId } from '../lib/ids';
import { json } from '../db';
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
  | 'setPriority'
  | 'unsubscribe'
  | 'reply'
  | 'send';

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

type SuggestionRow = { id: string; pattern_key: string; status: Suggestion['status']; title: string; description: string; rule: string; evidence: number; matching: number; created_at: number; snooze_until: number | null };

export class PatternDetector {
  /** Minimum repetitions can be lowered in tests and from settings. */
  thresholdScale = 1;

  constructor(
    private readonly db: Database,
    private readonly rules: RuleStore,
  ) {}

  log(entry: ActionLogEntry) {
    const from = entry.fromEmail?.toLowerCase() ?? null;
    this.db.run(
      `INSERT INTO action_log (at, action, thread_id, message_id, account_id, from_email, from_domain, business_id, tags, list_id, newsletter, subject, meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    );
    return this.detect(entry);
  }

  history(limit = 200, offset = 0) {
    return this.db
      .all<{ id: number; at: number; action: UserAction; thread_id: string | null; from_email: string | null; business_id: string | null; tags: string; subject: string | null; meta: string }>(
        'SELECT id, at, action, thread_id, from_email, business_id, tags, subject, meta FROM action_log ORDER BY at DESC LIMIT ? OFFSET ?',
        limit,
        offset,
      )
      .map((r) => ({ ...r, tags: json<string[]>(r.tags, []), meta: json<Record<string, unknown>>(r.meta, {}) }));
  }

  stats() {
    return this.db.all<{ action: string; n: number }>(
      'SELECT action, COUNT(*) AS n FROM action_log WHERE at > ? GROUP BY action ORDER BY n DESC',
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

    if (entry.action === 'unsubscribe') return this.detectNewsletterCleanup();

    const spec = REPEATABLE[entry.action];
    if (!spec) return null;

    // Mails the user engages with (replies, stars, re-opens to read) are never auto-handled.
    const engaged = this.count(
      `SELECT COUNT(*) AS n FROM action_log WHERE from_email = ? AND at > ? AND action IN ('reply', 'star', 'restore', 'notSpam', 'markUnread')`,
      from,
      since,
    );
    if (engaged > 0 && entry.action !== 'star') return null;

    const bySender = this.count(
      'SELECT COUNT(DISTINCT COALESCE(thread_id, id)) AS n FROM action_log WHERE action = ? AND from_email = ? AND at > ?',
      entry.action,
      from,
      since,
    );
    const domain = domainOf(from);
    const byDomain = FREE_MAIL_DOMAINS.has(domain)
      ? 0
      : this.count(
          'SELECT COUNT(DISTINCT COALESCE(thread_id, id)) AS n FROM action_log WHERE action = ? AND from_domain = ? AND at > ?',
          entry.action,
          domain,
          since,
        );
    const domainSenders = FREE_MAIL_DOMAINS.has(domain)
      ? 0
      : this.count('SELECT COUNT(DISTINCT from_email) AS n FROM action_log WHERE action = ? AND from_domain = ? AND at > ?', entry.action, domain, since);

    const threshold = Math.max(1, Math.ceil(spec.threshold * this.thresholdScale));
    const actions = [...spec.rule];
    const unsubscribable = entry.newsletter && (entry.action === 'trash' || entry.action === 'archive');
    if (unsubscribable) actions.unshift({ type: 'unsubscribe' });
    const what = actions.map(describeAction).join(t(' puis '));
    const What = capitalize(what);
    const verb = spec.verb();

    if (domainSenders >= 2 && byDomain >= threshold + 1) {
      return this.propose(`${entry.action}:domain:${domain}`, {
        title: t('{What} automatiquement les mails de @{domain} ?', { What, what, domain }),
        description: t('Vous avez {verb} {n} mails venant de {senders} adresses @{domain} ces 30 derniers jours. À partir de maintenant, ZMail peut {what} automatiquement ces mails.', {
          verb,
          n: byDomain,
          senders: domainSenders,
          domain,
          what,
        }),
        evidence: byDomain,
        rule: { name: t('{What} — @{domain}', { What, domain }), enabled: true, match: 'all', conditions: [{ field: 'fromDomain', op: 'equals', value: domain }], actions },
      });
    }
    if (bySender >= threshold) {
      return this.propose(`${entry.action}:sender:${from}`, {
        title: t('{What} automatiquement les mails de {from} ?', { What, what, from }),
        description: unsubscribable
          ? t('Vous avez {verb} {n} mails de {from} ces 30 derniers jours et c’est une newsletter. À partir de maintenant, ZMail peut {what} automatiquement chaque nouveau mail de cet expéditeur.', { verb, n: bySender, from, what })
          : t('Vous avez {verb} {n} mails de {from} ces 30 derniers jours. À partir de maintenant, ZMail peut {what} automatiquement chaque nouveau mail de cet expéditeur.', { verb, n: bySender, from, what }),
        evidence: bySender,
        rule: { name: t('{What} — {from}', { What, from }), enabled: true, match: 'all', conditions: [{ field: 'from', op: 'equals', value: from }], actions },
      });
    }
    return null;
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

  private countMatching(rule: RuleInput) {
    const clauses = rule.conditions
      .map((c) => (c.field === 'from' ? 'm.from_email = ?' : c.field === 'fromDomain' ? "(m.from_email LIKE '%@' || ?)" : null))
      .filter((c) => c !== null);
    if (clauses.length === 0) return 0;
    const params = rule.conditions.filter((c) => c.field === 'from' || c.field === 'fromDomain').map((c) => c.value);
    return this.count(
      `SELECT COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE mb.special_use = 'inbox' AND (${clauses.join(rule.match === 'any' ? ' OR ' : ' AND ')})`,
      ...params,
    );
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
