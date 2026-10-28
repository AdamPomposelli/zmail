import { z } from 'zod';
import type { Database } from '../db';
import type { Triage } from '../types';
import { domainOf } from '../lib/address';
import { json } from '../db';
import { newId } from '../lib/ids';
import { t } from '../lib/i18n';

export const ConditionSchema = z.object({
  field: z.enum(['from', 'fromDomain', 'to', 'subject', 'body', 'tag', 'business', 'account', 'listId', 'newsletter', 'priority', 'opportunity', 'otp']),
  op: z.enum(['equals', 'contains', 'notContains', 'is', 'isNot', 'gte']),
  value: z.string(),
});

export const ActionSchema = z.object({
  type: z.enum(['archive', 'trash', 'markRead', 'star', 'spam', 'addTag', 'setPriority', 'setBusiness', 'notify', 'unsubscribe']),
  value: z.string().optional(),
});

export const RuleInputSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(ConditionSchema).min(1),
  actions: z.array(ActionSchema).min(1),
});

export type Condition = z.infer<typeof ConditionSchema>;
export type RuleAction = z.infer<typeof ActionSchema>;
export type RuleInput = z.infer<typeof RuleInputSchema>;
export type Rule = RuleInput & { id: string; source: 'user' | 'suggestion' | 'agent'; hits: number; lastHitAt: number | null; createdAt: number };

/** What a rule can look at for one message. */
export type RuleSubject = {
  accountId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  listId: string | null;
  triage: Triage;
};

const normalize = (value: string) => value.toLowerCase().trim();

export function matchesCondition(condition: Condition, subject: RuleSubject): boolean {
  const value = normalize(condition.value);
  const text = (input: string) => {
    const hay = normalize(input);
    switch (condition.op) {
      case 'equals':
      case 'is':
        return hay === value;
      case 'isNot':
        return hay !== value;
      case 'contains':
        return hay.includes(value);
      case 'notContains':
        return !hay.includes(value);
      default:
        return false;
    }
  };
  const bool = (flag: boolean) => (condition.op === 'isNot' ? flag !== (value === 'true') : flag === (value === 'true'));

  switch (condition.field) {
    case 'from':
      return text(subject.from);
    case 'fromDomain': {
      const domain = domainOf(subject.from);
      if (condition.op === 'equals' || condition.op === 'is') return domain === value || domain.endsWith(`.${value}`);
      return text(domain);
    }
    case 'to':
      return condition.op === 'notContains' || condition.op === 'isNot'
        ? subject.to.every((t) => text(t))
        : subject.to.some((t) => text(t));
    case 'subject':
      return text(subject.subject);
    case 'body':
      return text(subject.body);
    case 'tag': {
      const has = subject.triage.tags.includes(condition.value);
      return condition.op === 'isNot' || condition.op === 'notContains' ? !has : has;
    }
    case 'business':
      return text(subject.triage.businessId ?? '');
    case 'account':
      return text(subject.accountId);
    case 'listId':
      return text(subject.listId ?? '');
    case 'newsletter':
      return bool(subject.triage.newsletter);
    case 'opportunity':
      return bool(subject.triage.opportunity);
    case 'otp':
      return bool(subject.triage.otp !== null);
    case 'priority':
      return condition.op === 'gte' ? subject.triage.priority >= Number(value) : text(String(subject.triage.priority));
  }
}

export const matchesRule = (rule: Pick<Rule, 'match' | 'conditions'>, subject: RuleSubject) =>
  rule.match === 'any' ? rule.conditions.some((c) => matchesCondition(c, subject)) : rule.conditions.every((c) => matchesCondition(c, subject));

type RuleRow = { id: string; name: string; enabled: number; source: Rule['source']; conditions: string; actions: string; hits: number; last_hit_at: number | null; created_at: number };

export class RuleStore {
  constructor(private readonly db: Database) {}

  private fromRow(row: RuleRow): Rule {
    const conditions = json<{ match?: 'all' | 'any'; items?: Condition[] }>(row.conditions, {});
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      source: row.source,
      match: conditions.match ?? 'all',
      conditions: conditions.items ?? [],
      actions: json<RuleAction[]>(row.actions, []),
      hits: row.hits,
      lastHitAt: row.last_hit_at,
      createdAt: row.created_at,
    };
  }

  list(): Rule[] {
    return this.db.all<RuleRow>('SELECT * FROM rules ORDER BY created_at DESC').map((r) => this.fromRow(r));
  }

  get(id: string) {
    const row = this.db.get<RuleRow>('SELECT * FROM rules WHERE id = ?', id);
    return row ? this.fromRow(row) : undefined;
  }

  create(input: RuleInput, source: Rule['source']) {
    const rule = RuleInputSchema.parse(input);
    const id = newId('rule');
    this.db.run(
      'INSERT INTO rules (id, name, enabled, source, conditions, actions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      rule.name,
      rule.enabled ? 1 : 0,
      source,
      JSON.stringify({ match: rule.match, items: rule.conditions }),
      JSON.stringify(rule.actions),
      Date.now(),
    );
    return this.get(id)!;
  }

  update(id: string, input: Partial<RuleInput>) {
    const current = this.get(id);
    if (!current) throw new Error(t('Règle introuvable'));
    const next = RuleInputSchema.parse({ ...current, ...input });
    this.db.run(
      'UPDATE rules SET name = ?, enabled = ?, conditions = ?, actions = ? WHERE id = ?',
      next.name,
      next.enabled ? 1 : 0,
      JSON.stringify({ match: next.match, items: next.conditions }),
      JSON.stringify(next.actions),
      id,
    );
    return this.get(id)!;
  }

  remove(id: string) {
    this.db.run('DELETE FROM rules WHERE id = ?', id);
  }

  recordHit(id: string) {
    this.db.run('UPDATE rules SET hits = hits + 1, last_hit_at = ? WHERE id = ?', Date.now(), id);
  }

  matching(subject: RuleSubject) {
    return this.list().filter((rule) => rule.enabled && matchesRule(rule, subject));
  }
}

const actionLabels = (): Record<RuleAction['type'], string> => ({
  archive: t('archiver'),
  trash: t('mettre à la corbeille'),
  markRead: t('marquer comme lu'),
  star: t('marquer d’une étoile'),
  spam: t('classer en spam'),
  addTag: t('ajouter le tag'),
  setPriority: t('définir la priorité'),
  setBusiness: t('rattacher au business'),
  notify: t('m’envoyer une notification'),
  unsubscribe: t('me désinscrire'),
});

export const describeAction = (action: RuleAction) => {
  const label = actionLabels()[action.type];
  return action.value ? t('{action} « {value} »', { action: label, value: action.value }) : label;
};
