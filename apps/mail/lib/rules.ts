import type { Rule } from './trpc';
import { t } from '@/lib/i18n';

type Condition = Rule['conditions'][number];
type Action = Rule['actions'][number];

export const FIELD_LABELS: Record<Condition['field'], string> = {
  from: t('l’expéditeur'),
  fromDomain: t('le domaine de l’expéditeur'),
  to: t('le destinataire'),
  subject: t('l’objet'),
  body: t('le contenu'),
  tag: t('la catégorie'),
  business: t('le business'),
  account: t('le compte'),
  listId: t('la liste de diffusion'),
  newsletter: t('c’est une newsletter'),
  priority: t('la priorité'),
  opportunity: t('c’est une opportunité'),
  otp: t('contient un code OTP'),
};

export const OP_LABELS: Record<Condition['op'], string> = {
  equals: t('est'),
  is: t('est'),
  isNot: t('n’est pas'),
  contains: t('contient'),
  notContains: t('ne contient pas'),
  gte: t('est au moins'),
};

export const ACTION_LABELS: Record<Action['type'], string> = {
  archive: t('archiver'),
  trash: t('mettre à la corbeille'),
  markRead: t('marquer comme lu'),
  star: t('suivre (étoile)'),
  spam: t('classer en spam'),
  addTag: t('ajouter la catégorie'),
  setPriority: t('définir la priorité'),
  setBusiness: t('rattacher au business'),
  setSpace: t('ranger dans l’espace'),
  moveToFolder: t('ranger dans le dossier'),
  notify: t('m’envoyer une notification'),
  unsubscribe: t('me désinscrire'),
};

const BOOLEAN_FIELDS = new Set(['newsletter', 'opportunity', 'otp']);
const PRIORITIES = [t('basse'), t('normale'), t('haute'), t('urgente')];
/** The negated form of the yes/no fields (« ce n’est pas une newsletter »). */
const NOT_LABELS: Record<string, string> = {
  newsletter: t('ce n’est pas une newsletter'),
  opportunity: t('ce n’est pas une opportunité'),
  otp: t('ce n’est pas un code OTP'),
};

export function describeCondition(condition: Condition, names?: { tag?: (id: string) => string | undefined; business?: (id: string) => string | undefined }) {
  if (BOOLEAN_FIELDS.has(condition.field)) return (condition.value === 'false') !== (condition.op === 'isNot') ? (NOT_LABELS[condition.field] ?? FIELD_LABELS[condition.field]) : FIELD_LABELS[condition.field];
  let value = condition.value;
  if (condition.field === 'tag') value = t(names?.tag?.(value) ?? value);
  if (condition.field === 'business') value = names?.business?.(value) ?? value;
  if (condition.field === 'priority') value = PRIORITIES[Number(value)] ?? value;
  return t('{field} {op} « {value} »', { field: FIELD_LABELS[condition.field], op: OP_LABELS[condition.op], value });
}

export function describeRuleAction(action: Action, names?: { tag?: (id: string) => string | undefined; business?: (id: string) => string | undefined; space?: (id: string) => string | undefined; folder?: (id: string) => string | undefined }) {
  let value = action.value;
  if (action.type === 'moveToFolder' && value) value = names?.folder?.(value) ?? value;
  if (action.type === 'setSpace' && value) value = t(names?.space?.(value) ?? value);
  if (action.type === 'addTag' && value) value = t(names?.tag?.(value) ?? value);
  if (action.type === 'setBusiness' && value) value = names?.business?.(value) ?? value;
  if (action.type === 'setPriority' && value) value = PRIORITIES[Number(value)] ?? value;
  return value ? t('{action} « {value} »', { action: ACTION_LABELS[action.type], value }) : ACTION_LABELS[action.type];
}
