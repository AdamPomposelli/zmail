import type { Database } from '../db';
import type { RuleInput, RuleStore } from './engine';
import type { ActionLogEntry } from './patterns';
import { json } from '../db';
import { FREE_MAIL_DOMAINS, domainOf } from '../lib/address';
import { SPACE_EXPR, SPACE_JOINS } from '../mail/spaces';
import { GUARDS, SENSITIVE_TAGS, isCriticalDomain } from './patterns';
import { t } from '../lib/i18n';

/**
 * The user's habits, read the way a data analyst would: not the log line by line, but per kind
 * of mail (sender, domain, list, category, business, account, space), what share is opened, read
 * for how long, then archived, deleted, filed in which folder… A share above a threshold, on
 * enough mails, is a habit worth a rule.
 *
 * Built from two sources: the mail received (so « never touched » counts too) and the action log
 * with the context of each gesture (opened first or not, time spent reading, see db.ts).
 */

/** What finally happened to a conversation. */
export type Outcome = 'archive' | 'trash' | 'spam' | 'folder' | 'space' | 'tag' | 'read' | 'markRead' | 'untouched';
export const OUTCOMES: Outcome[] = ['archive', 'trash', 'spam', 'folder', 'space', 'tag', 'read', 'markRead', 'untouched'];

export type Dimension = 'sender' | 'domain' | 'list' | 'category' | 'business' | 'account' | 'space' | 'newsletter' | 'priority';
export const DIMENSIONS: Dimension[] = ['sender', 'domain', 'list', 'category', 'business', 'account', 'space', 'newsletter', 'priority'];

/** One conversation, from arrival to what the user did with it. */
export type Fact = {
  threadId: string;
  from: string;
  domain: string;
  listId: string | null;
  tags: string[];
  businessId: string | null;
  accountId: string | null;
  spaceId: string | null;
  newsletter: boolean;
  priority: number | null;
  otp: boolean;
  receivedAt: number | null;
  opened: boolean;
  /** Total time on screen, all readings together. */
  dwellMs: number;
  /** How far down it was read, 0–1 (the deepest reading). */
  depth: number;
  outcome: Outcome;
  /** The folder (mailbox id), space id or category the outcome went to. */
  target: string | null;
  /** From arrival to the decision. */
  decidedAfterMs: number | null;
  /** Opened before being archived, deleted, filed… (null: no decision). */
  openedBeforeDecision: boolean | null;
  replied: boolean;
  starred: boolean;
  /** Put back after a decision (taken out of the trash or spam): the decision was wrong once. */
  undone: boolean;
};

export type Group = {
  dimension: Dimension;
  key: string;
  label: string;
  n: number;
  openedShare: number;
  avgDwellMs: number;
  medianDecisionMs: number | null;
  outcomes: Record<Outcome, number>;
  shares: Record<Outcome, number>;
  /** Of those archived, deleted, filed…: the share never opened. */
  decidedUnopenedShare: number | null;
  repliedShare: number;
  starredShare: number;
  /** The most frequent destination for « folder » and « space ». */
  topTarget: { outcome: 'folder' | 'space'; target: string; label: string; n: number } | null;
  /** Mails in the group that must never be thrown away (invoices, disputes, codes, important). */
  sensitive: number;
  /** Replied to or starred: mail the user engages with. */
  engaged: number;
  /** Newsletters and mailing lists, as a share. */
  bulkShare: number;
  /** Old enough to have been dealt with (a week), and of those, never opened. */
  settled: number;
  settledUnopened: number;
};

/** A mail younger than this may simply not have been dealt with yet. */
const SETTLED_MS = 7 * 86400_000;

export type Habit = {
  id: string;
  dimension: Dimension;
  key: string;
  label: string;
  outcome: Outcome | 'neverOpened';
  target: string | null;
  targetLabel: string | null;
  /** Mails of the group that went this way, out of `total`. */
  support: number;
  total: number;
  share: number;
  /** Lower bound of the 95 % Wilson interval: 3 out of 3 is not as sure as 30 out of 31. */
  confidence: number;
  /** How much more often than across the whole mailbox (1 = as usual). */
  lift: number;
  openedShare: number;
  avgDwellMs: number;
  safe: boolean;
  reason: string | null;
  rule: RuleInput | null;
  /** An enabled rule already does it. */
  covered: boolean;
};

export type GraphNode = { id: string; kind: 'source' | 'category' | 'outcome' | 'folder' | 'space'; label: string; n: number };
export type GraphEdge = { from: string; to: string; n: number; share: number };

export type Analytics = {
  days: number;
  generatedAt: number;
  overview: {
    threads: number;
    openedShare: number;
    decidedShare: number;
    shares: Record<Outcome, number>;
    /** Of the mails deleted or sent to spam, the share never opened. */
    deletedUnopenedShare: number | null;
    medianDecisionMs: number | null;
    /** Median time spent reading before each decision. */
    medianDwellBefore: Partial<Record<Outcome, number>>;
    undone: number;
  };
  dimensions: Record<Dimension, Group[]>;
  habits: Habit[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
};

const DECISIVE: Record<string, Outcome> = { archive: 'archive', trash: 'trash', deleteForever: 'trash', spam: 'spam', moveToFolder: 'folder', moveToSpace: 'space' };
/** Outcomes a rule can reproduce. */
const ACTIONABLE: Outcome[] = ['archive', 'trash', 'spam', 'folder', 'space', 'markRead'];
const DESTRUCTIVE = new Set<Outcome | 'neverOpened'>(['archive', 'trash', 'spam', 'markRead', 'neverOpened']);
/** Dimensions a habit (and a rule) can be about, the most precise first. */
const HABIT_DIMENSIONS: Dimension[] = ['list', 'sender', 'domain', 'category', 'business'];

export const HABIT_THRESHOLD = 0.7;
export const HABIT_MIN_SUPPORT = 3;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

/** Wilson score interval, lower bound at 95 %. */
export function wilson(successes: number, total: number) {
  if (!total) return 0;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
}

const emptyOutcomes = () => Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
const round = (value: number) => Math.round(value * 1000) / 1000;

export class BehaviorAnalytics {
  private cache: { days: number; at: number; facts: Fact[] } | null = null;

  constructor(
    private readonly db: Database,
    private readonly rules: RuleStore,
  ) {}

  /** A new gesture changes the picture (the log calls this before looking for a habit). */
  invalidate() {
    this.cache = null;
  }

  /** Every conversation of the last `days`, received or acted upon, with what happened to it. */
  facts(days = 90): Fact[] {
    if (this.cache && this.cache.days === days && Date.now() - this.cache.at < 5000) return this.cache.facts;
    const since = Date.now() - days * 86400_000;
    const byThread = new Map<string, Fact>();
    const received = this.db.all<{ thread_id: string; from_email: string; list_id: string | null; account_id: string; date: number; tags: string | null; business_id: string | null; newsletter: number | null; priority: number | null; otp: string | null; space: string }>(
      `SELECT m.thread_id, m.from_email, m.list_id, m.account_id, MAX(m.date) AS date, t.tags, t.business_id, t.newsletter, t.priority, t.otp, ${SPACE_EXPR} AS space
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id ${SPACE_JOINS}
       WHERE m.date > ? AND COALESCE(mb.special_use, '') NOT IN ('sent', 'drafts')
       GROUP BY m.thread_id`,
      since,
    );
    for (const r of received) {
      const from = r.from_email.toLowerCase();
      byThread.set(r.thread_id, {
        threadId: r.thread_id,
        from,
        domain: domainOf(from),
        listId: r.list_id,
        tags: json<string[]>(r.tags, []),
        businessId: r.business_id,
        accountId: r.account_id,
        spaceId: r.space,
        newsletter: r.newsletter === 1,
        priority: r.priority,
        otp: Boolean(r.otp),
        receivedAt: r.date,
        opened: false,
        dwellMs: 0,
        depth: 0,
        outcome: 'untouched',
        target: null,
        decidedAfterMs: null,
        openedBeforeDecision: null,
        replied: false,
        starred: false,
        undone: false,
      });
    }

    const rows = this.db.all<{ at: number; action: string; thread_id: string; from_email: string | null; list_id: string | null; account_id: string | null; business_id: string | null; tags: string; newsletter: number; meta: string; opened: number | null; dwell_ms: number | null; space_id: string | null; priority: number | null; age_ms: number | null }>(
      `SELECT at, action, thread_id, from_email, list_id, account_id, business_id, tags, newsletter, meta, opened, dwell_ms, space_id, priority, age_ms
       FROM action_log WHERE at > ? AND thread_id IS NOT NULL ORDER BY at`,
      since,
    );
    // Per conversation, what was decided last (a restore cancels it) and what was seen.
    const state = new Map<string, { decision: Outcome | null; target: string | null; at: number | null; openedThen: boolean | null; tagged: string | null; markRead: boolean }>();
    for (const r of rows) {
      let fact = byThread.get(r.thread_id);
      if (!fact) {
        // Received before the window (or deleted for good since): described by the log itself.
        if (!r.from_email) continue;
        fact = {
          threadId: r.thread_id,
          from: r.from_email,
          domain: domainOf(r.from_email),
          listId: r.list_id,
          tags: json<string[]>(r.tags, []),
          businessId: r.business_id,
          accountId: r.account_id,
          spaceId: r.space_id,
          newsletter: r.newsletter === 1,
          priority: r.priority,
          otp: false,
          receivedAt: r.age_ms !== null ? r.at - r.age_ms : null,
          opened: false,
          dwellMs: 0,
          depth: 0,
          outcome: 'untouched',
          target: null,
          decidedAfterMs: null,
          openedBeforeDecision: null,
          replied: false,
          starred: false,
          undone: false,
        };
        byThread.set(r.thread_id, fact);
      }
      const s = state.get(r.thread_id) ?? { decision: null, target: null, at: null, openedThen: null, tagged: null, markRead: false };
      state.set(r.thread_id, s);
      const meta = json<Record<string, unknown>>(r.meta, {});
      if (r.action === 'open' || r.action === 'view') {
        // The app sends a reading just before the decision it led to; arriving a moment after
        // it (two requests in flight), it still came first.
        if (s.decision && s.openedThen === false && s.at !== null && r.at - s.at < 10_000) s.openedThen = true;
        fact.opened = true;
        if (r.action === 'view') {
          fact.dwellMs += r.dwell_ms ?? 0;
          if (typeof meta.depth === 'number') fact.depth = Math.max(fact.depth, Math.min(1, meta.depth));
        }
      } else if (r.action === 'reply') fact.replied = true;
      else if (r.action === 'star') fact.starred = true;
      else if (r.action === 'markRead') s.markRead = true;
      else if (r.action === 'addTag' && typeof meta.tag === 'string') s.tagged = meta.tag;
      else if (r.action === 'restore' || r.action === 'notSpam') {
        if (s.decision) fact.undone = true;
        s.decision = null;
        s.target = null;
      } else if (DECISIVE[r.action]) {
        s.decision = DECISIVE[r.action]!;
        s.target = r.action === 'moveToFolder' ? String(meta.mailboxId ?? meta.folder ?? '') || null : r.action === 'moveToSpace' ? String(meta.spaceId ?? '') || null : null;
        s.at = r.at;
        s.openedThen = r.opened === null ? fact.opened : r.opened === 1 || fact.opened;
      }
    }
    for (const [threadId, s] of state) {
      const fact = byThread.get(threadId)!;
      if (s.decision) {
        fact.outcome = s.decision;
        fact.target = s.target;
        fact.decidedAfterMs = fact.receivedAt !== null && s.at !== null ? Math.max(0, s.at - fact.receivedAt) : null;
        fact.openedBeforeDecision = s.openedThen;
      } else if (s.tagged) {
        fact.outcome = 'tag';
        fact.target = s.tagged;
      } else if (fact.opened) fact.outcome = 'read';
      else if (s.markRead) fact.outcome = 'markRead';
    }
    // Conversations never opened in ZMail but read elsewhere stay « untouched »: nothing was decided here.
    const facts = [...byThread.values()];
    this.cache = { days, at: Date.now(), facts };
    return facts;
  }

  private keys(fact: Fact, dimension: Dimension): string[] {
    switch (dimension) {
      case 'sender':
        return [fact.from];
      case 'domain':
        return fact.domain ? [fact.domain] : [];
      case 'list':
        return fact.listId ? [fact.listId] : [];
      case 'category':
        return fact.tags;
      case 'business':
        return fact.businessId ? [fact.businessId] : [];
      case 'account':
        return fact.accountId ? [fact.accountId] : [];
      case 'space':
        return fact.spaceId ? [fact.spaceId] : [];
      case 'newsletter':
        return [fact.newsletter ? 'yes' : 'no'];
      case 'priority':
        return [fact.priority === null ? 'none' : String(fact.priority)];
    }
  }

  /** Names for ids: categories, businesses, accounts, spaces, folders. */
  private namer() {
    const map = (sql: string) => new Map(this.db.all<{ id: string; name: string }>(sql).map((r) => [r.id, r.name]));
    const tags = map('SELECT id, name FROM tags');
    const businesses = map('SELECT id, name FROM businesses');
    const accounts = map("SELECT id, COALESCE(NULLIF(label, ''), email) AS name FROM accounts");
    const spaces = map('SELECT id, name FROM spaces');
    const folders = map('SELECT id, path AS name FROM mailboxes');
    return {
      key: (dimension: Dimension, key: string) =>
        dimension === 'category' ? t(tags.get(key) ?? key) : dimension === 'business' ? (businesses.get(key) ?? key) : dimension === 'account' ? (accounts.get(key) ?? key) : dimension === 'space' ? t(spaces.get(key) ?? key) : dimension === 'domain' ? `@${key}` : key,
      target: (outcome: Outcome, target: string) => (outcome === 'folder' ? (folders.get(target) ?? target) : outcome === 'space' ? t(spaces.get(target) ?? target) : outcome === 'tag' ? t(tags.get(target) ?? target) : target),
    };
  }

  private group(dimension: Dimension, key: string, label: string, facts: Fact[], names: ReturnType<BehaviorAnalytics['namer']>): Group {
    const outcomes = emptyOutcomes();
    for (const f of facts) outcomes[f.outcome]++;
    const n = facts.length;
    const decided = facts.filter((f) => f.openedBeforeDecision !== null);
    const targets = new Map<string, { outcome: 'folder' | 'space'; target: string; n: number }>();
    for (const f of facts) {
      if ((f.outcome === 'folder' || f.outcome === 'space') && f.target) {
        const k = `${f.outcome}:${f.target}`;
        const entry = targets.get(k) ?? { outcome: f.outcome, target: f.target, n: 0 };
        entry.n++;
        targets.set(k, entry);
      }
    }
    const top = [...targets.values()].sort((a, b) => b.n - a.n)[0];
    const settled = facts.filter((f) => f.outcome !== 'untouched' || f.receivedAt === null || Date.now() - f.receivedAt > SETTLED_MS);
    return {
      dimension,
      key,
      label,
      n,
      openedShare: round(facts.filter((f) => f.opened).length / n),
      avgDwellMs: Math.round(facts.reduce((sum, f) => sum + f.dwellMs, 0) / n),
      medianDecisionMs: median(facts.map((f) => f.decidedAfterMs).filter((v): v is number => v !== null)),
      outcomes,
      shares: Object.fromEntries(OUTCOMES.map((o) => [o, round(outcomes[o] / n)])) as Record<Outcome, number>,
      decidedUnopenedShare: decided.length ? round(decided.filter((f) => !f.openedBeforeDecision).length / decided.length) : null,
      repliedShare: round(facts.filter((f) => f.replied).length / n),
      starredShare: round(facts.filter((f) => f.starred).length / n),
      topTarget: top ? { ...top, label: names.target(top.outcome, top.target) } : null,
      sensitive: facts.filter((f) => f.otp || (f.priority ?? 0) >= 2 || f.tags.some((tag) => SENSITIVE_TAGS.includes(tag))).length,
      engaged: facts.filter((f) => f.replied || f.starred).length,
      bulkShare: round(facts.filter((f) => f.newsletter || f.listId).length / n),
      settled: settled.length,
      settledUnopened: settled.filter((f) => !f.opened).length,
    };
  }

  /** Every group of every dimension (at least `minN` conversations), largest first. */
  groups(days = 90, minN = 2, facts = this.facts(days)) {
    const names = this.namer();
    const result = {} as Record<Dimension, Group[]>;
    for (const dimension of DIMENSIONS) {
      const buckets = new Map<string, Fact[]>();
      for (const fact of facts) for (const key of this.keys(fact, dimension)) buckets.set(key, [...(buckets.get(key) ?? []), fact]);
      result[dimension] = [...buckets.entries()]
        .filter(([, list]) => list.length >= minN)
        .map(([key, list]) => this.group(dimension, key, names.key(dimension, key), list, names))
        .sort((a, b) => b.n - a.n);
    }
    return result;
  }

  /**
   * The habits: within a group of at least `minSupport` conversations, one outcome (with the same
   * destination for folders and spaces) reaches `threshold`. Each comes with a ready rule when it
   * is safe to automate (nothing sensitive in the group, no bank or administration sender).
   */
  habits(options: { days?: number; threshold?: number; minSupport?: number } = {}, facts?: Fact[]): Habit[] {
    const days = options.days ?? 90;
    const threshold = options.threshold ?? HABIT_THRESHOLD;
    const minSupport = options.minSupport ?? HABIT_MIN_SUPPORT;
    const all = facts ?? this.facts(days);
    if (!all.length) return [];
    const baseline = emptyOutcomes();
    for (const f of all) baseline[f.outcome]++;
    const groups = this.groups(days, minSupport, all);
    const names = this.namer();
    const rules = this.rules.list().filter((r) => r.enabled);
    const habits: Habit[] = [];

    for (const dimension of HABIT_DIMENSIONS) {
      for (const g of groups[dimension]) {
        const candidates: { outcome: Outcome | 'neverOpened'; target: string | null; support: number; total?: number; base: number }[] = [];
        for (const outcome of ACTIONABLE) {
          if (outcome === 'folder' || outcome === 'space') {
            if (g.topTarget?.outcome === outcome) candidates.push({ outcome, target: g.topTarget.target, support: g.topTarget.n, base: baseline[outcome] });
          } else candidates.push({ outcome, target: null, support: g.outcomes[outcome], base: baseline[outcome] });
        }
        // Never opened, whatever was done with them: only mail old enough to have been dealt with
        // (a mail of yesterday is not ignored, just not read yet), at least 5 of them.
        if (dimension !== 'category' && g.settled >= Math.max(5, minSupport))
          candidates.push({ outcome: 'neverOpened', target: null, support: g.settledUnopened, total: g.settled, base: all.filter((f) => !f.opened).length });
        for (const c of candidates) {
          const total = c.total ?? g.n;
          const share = c.support / total;
          if (c.support < minSupport || share < threshold) continue;
          const destructive = DESTRUCTIVE.has(c.outcome);
          const domain = dimension === 'sender' ? domainOf(g.key) : dimension === 'domain' ? g.key : null;
          const reason = !destructive
            ? null
            : g.engaged > 0
              ? t('Vous répondez à ces mails ou les suivez : à ne pas automatiser.')
              : c.outcome === 'neverOpened' && g.bulkShare < 0.5
                ? t('Ni newsletter ni liste de diffusion : jamais ouverts ne veut pas dire inutiles.')
                : g.sensitive > 0
              ? t('{n} de ces mails comptent (facture, litige, code, important) : à ne pas automatiser.', { n: g.sensitive })
              : domain && isCriticalDomain(domain)
                ? t('Banque, paiement ou administration : à ne pas automatiser en bloc.')
                : dimension === 'category' && SENSITIVE_TAGS.includes(g.key)
                  ? t('Catégorie sensible : à ne pas automatiser.')
                  : null;
          const rule = reason ? null : this.ruleFor(dimension, g, c.outcome, c.target);
          const habit: Habit = {
            id: `${dimension}:${g.key}:${c.outcome}:${c.target ?? ''}`,
            dimension,
            key: g.key,
            label: g.label,
            outcome: c.outcome,
            target: c.target,
            targetLabel: c.target && (c.outcome === 'folder' || c.outcome === 'space') ? names.target(c.outcome, c.target) : null,
            support: c.support,
            total,
            share: round(share),
            confidence: round(wilson(c.support, total)),
            lift: round(share / Math.max(c.base / all.length, 1e-6)),
            openedShare: g.openedShare,
            avgDwellMs: g.avgDwellMs,
            safe: !reason,
            reason,
            rule,
            covered: rule ? rules.some((r) => JSON.stringify(r.conditions) === JSON.stringify(rule.conditions) && rule.actions.every((a) => r.actions.some((b) => b.type === a.type && (b.value ?? null) === (a.value ?? null)))) : false,
          };
          habits.push(habit);
        }
      }
    }
    // The same habit seen for a sender and for its domain: the domain only when it covers more
    // mail than that one sender (several senders), otherwise the sender, more precise.
    const twin = (h: Habit, dimension: Dimension, key: string) => habits.find((o) => o.dimension === dimension && o.key === key && o.outcome === h.outcome && o.target === h.target);
    const kept = habits.filter((h) => {
      if (h.dimension === 'sender') {
        const domain = twin(h, 'domain', domainOf(h.key));
        return !(domain && !FREE_MAIL_DOMAINS.has(domain.key) && domain.total > h.total && domain.confidence >= h.confidence);
      }
      if (h.dimension === 'domain') return !habits.some((o) => o.dimension === 'sender' && domainOf(o.key) === h.key && o.outcome === h.outcome && o.target === h.target && o.total === h.total);
      return true;
    });
    return kept.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
  }

  private ruleFor(dimension: Dimension, g: Group, outcome: Outcome | 'neverOpened', target: string | null): RuleInput | null {
    const conditions: RuleInput['conditions'] =
      dimension === 'list'
        ? [{ field: 'listId', op: 'equals', value: g.key }]
        : dimension === 'sender'
          ? [{ field: 'from', op: 'equals', value: g.key }]
          : dimension === 'domain'
            ? FREE_MAIL_DOMAINS.has(g.key)
              ? []
              : [{ field: 'fromDomain', op: 'equals', value: g.key }]
            : dimension === 'category'
              ? [{ field: 'tag', op: 'is', value: g.key }]
              : [{ field: 'business', op: 'equals', value: g.key }];
    if (!conditions.length) return null;
    let actions: RuleInput['actions'];
    if (outcome === 'folder' && target) {
      const folder = this.db.get<{ account_id: string }>('SELECT account_id FROM mailboxes WHERE id = ?', target);
      if (!folder) return null;
      // A folder belongs to one account: only that account's mail can go there.
      conditions.push({ field: 'account', op: 'equals', value: folder.account_id });
      actions = [{ type: 'moveToFolder', value: target }];
    } else if (outcome === 'space' && target) actions = [{ type: 'setSpace', value: target }];
    else if (outcome === 'neverOpened') actions = [{ type: 'markRead' }, { type: 'archive' }];
    else if (outcome === 'archive' || outcome === 'trash' || outcome === 'spam' || outcome === 'markRead') actions = [{ type: outcome }];
    else return null;
    const destructive = DESTRUCTIVE.has(outcome);
    return {
      name: t('Habitude — {label}', { label: g.label }),
      enabled: true,
      match: 'all',
      conditions: destructive ? [...conditions, ...GUARDS] : conditions,
      actions,
    };
  }

  /** Who sends what, and where it ends: sources and categories linked to outcomes, weighted. */
  graph(days = 90, facts = this.facts(days)) {
    const names = this.namer();
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge & { total: number }>();
    const node = (id: string, kind: GraphNode['kind'], label: string) => {
      const existing = nodes.get(id) ?? { id, kind, label, n: 0 };
      existing.n++;
      nodes.set(id, existing);
      return id;
    };
    const destination = (f: Fact) =>
      f.outcome === 'folder' && f.target
        ? node(`folder:${f.target}`, 'folder', names.target('folder', f.target))
        : f.outcome === 'space' && f.target
          ? node(`space:${f.target}`, 'space', names.target('space', f.target))
          : node(`outcome:${f.outcome}`, 'outcome', f.outcome);
    // Sources: the domain, or the address for webmail senders.
    const sourceOf = (f: Fact) => (FREE_MAIL_DOMAINS.has(f.domain) || !f.domain ? f.from : f.domain);
    const counts = new Map<string, number>();
    for (const f of facts) counts.set(sourceOf(f), (counts.get(sourceOf(f)) ?? 0) + 1);
    const topSources = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k));
    const link = (from: string, to: string, total: number) => {
      const k = `${from}>${to}`;
      const e = edges.get(k) ?? { from, to, n: 0, share: 0, total };
      e.n++;
      edges.set(k, e);
    };
    for (const f of facts) {
      const to = destination(f);
      const source = sourceOf(f);
      if (topSources.has(source)) link(node(`source:${source}`, 'source', FREE_MAIL_DOMAINS.has(f.domain) ? source : `@${source}`), to, counts.get(source)!);
      for (const tag of f.tags) link(node(`category:${tag}`, 'category', names.key('category', tag)), to, 0);
    }
    const categoryTotals = new Map<string, number>();
    for (const e of edges.values()) if (e.from.startsWith('category:')) categoryTotals.set(e.from, (categoryTotals.get(e.from) ?? 0) + e.n);
    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()].map(({ total, ...e }) => ({ ...e, share: round(e.n / (total || categoryTotals.get(e.from) || e.n)) })).sort((a, b) => b.n - a.n),
    };
  }

  /** Everything at once: the overview, the probability tables, the habits and the graph. */
  analyze(options: { days?: number; threshold?: number; minSupport?: number } = {}): Analytics {
    const days = options.days ?? 90;
    const facts = this.facts(days);
    const outcomes = emptyOutcomes();
    for (const f of facts) outcomes[f.outcome]++;
    const n = facts.length || 1;
    const decided = facts.filter((f) => f.openedBeforeDecision !== null);
    const deleted = facts.filter((f) => (f.outcome === 'trash' || f.outcome === 'spam') && f.openedBeforeDecision !== null);
    const medianDwellBefore: Partial<Record<Outcome, number>> = {};
    for (const o of ['archive', 'trash', 'spam', 'folder', 'space'] as Outcome[]) {
      const m = median(facts.filter((f) => f.outcome === o).map((f) => f.dwellMs));
      if (m !== null) medianDwellBefore[o] = m;
    }
    return {
      days,
      generatedAt: Date.now(),
      overview: {
        threads: facts.length,
        openedShare: round(facts.filter((f) => f.opened).length / n),
        decidedShare: round(decided.length / n),
        shares: Object.fromEntries(OUTCOMES.map((o) => [o, round(outcomes[o] / n)])) as Record<Outcome, number>,
        deletedUnopenedShare: deleted.length ? round(deleted.filter((f) => !f.openedBeforeDecision).length / deleted.length) : null,
        medianDecisionMs: median(decided.map((f) => f.decidedAfterMs).filter((v): v is number => v !== null)),
        medianDwellBefore,
        undone: facts.filter((f) => f.undone).length,
      },
      dimensions: this.groups(days, 2, facts),
      habits: this.habits(options, facts),
      graph: this.graph(days, facts),
    };
  }

  /**
   * One kind of mail seen against one gesture (the rule suggestions quote it): how many came,
   * how many got that gesture, how many of those were never opened.
   */
  profile(scope: { from?: string; domain?: string; listId?: string; subject?: string }, action: string, days = 30) {
    const outcome = DECISIVE[action] ?? (action === 'markRead' ? 'markRead' : null);
    const facts = this.facts(days).filter(
      (f) => (!scope.from || f.from === scope.from) && (!scope.domain || f.domain === scope.domain || f.domain.endsWith(`.${scope.domain}`)) && (!scope.listId || f.listId === scope.listId),
    );
    const acted = outcome ? facts.filter((f) => f.outcome === outcome) : [];
    return {
      received: facts.length,
      acted: acted.length,
      share: facts.length ? acted.length / facts.length : 0,
      unopened: acted.length ? acted.filter((f) => f.openedBeforeDecision === false).length / acted.length : 0,
    };
  }

  /**
   * After a conversation is filed into a folder: if most mails of that list, sender or domain go
   * to the same folder, the rule that would do it (the rule suggestions offer it).
   */
  folderHabit(entry: ActionLogEntry) {
    const mailboxId = typeof entry.meta?.mailboxId === 'string' ? entry.meta.mailboxId : null;
    const from = entry.fromEmail?.toLowerCase();
    if (!mailboxId || !from) return null;
    const keys: Partial<Record<Dimension, string>> = { list: entry.listId ?? undefined, sender: from, domain: domainOf(from) };
    return (
      this.habits({ days: 90 }).find((h) => h.outcome === 'folder' && h.target === mailboxId && h.rule && !h.covered && keys[h.dimension] === h.key) ?? null
    );
  }
}
