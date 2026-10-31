import type { Priority } from '../types';
import type { HeuristicResult } from './heuristics';
import { validateOtp } from './otp';
import { t } from '../lib/i18n';
import { scopeTags } from './taxonomy';

export type ModelTriage = {
  tags?: unknown;
  priority?: unknown;
  spam?: unknown;
  spamReason?: unknown;
  opportunity?: unknown;
  opportunityReason?: unknown;
  otp?: unknown;
  summary?: unknown;
};

const PRIORITY_FROM_MODEL: Record<string, Priority> = { low: 0, normal: 1, high: 2, urgent: 3, basse: 0, normale: 1, haute: 2, urgente: 3 };

/** Tags the heuristics detect reliably enough to keep even when a model disagrees. */
const HARD_TAGS = new Set(['security', 'newsletter', 'marketing', 'chargeback']);

export type MergedTriage = {
  tags: string[];
  priority: Priority;
  spam: boolean;
  spamReason: string | null;
  opportunity: boolean;
  opportunityReason: string | null;
  otp: string | null;
  summary: string;
};

/**
 * What ZMail finally decides for a mail: the model's verdict (when there is one) inside the
 * guardrails that hold whatever it says. Shared by the pipeline and the benchmark, so the
 * benchmark measures exactly what the user sees.
 */
export function mergeTriage(input: {
  heuristic: HeuristicResult;
  model: ModelTriage | null;
  /** Subject + text, to check a model's OTP really is one. */
  text: string;
  knownTags: Set<string>;
  /** Tags from the user's own keyword rules, used when no model answered. */
  customTags?: string[];
  /** The folder the server filed it in. */
  folder?: string | null;
}): MergedTriage {
  const { heuristic, model: data } = input;
  let tags: string[];
  let priority: Priority;
  let spam = heuristic.spam;
  let spamReason = heuristic.spamReason;
  let opportunity = heuristic.opportunity;
  let opportunityReason = heuristic.opportunityReason;
  let otp = heuristic.otp;
  let summary = heuristic.summary;

  if (data) {
    const modelTags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string' && input.knownTags.has(t)) : [];
    tags = [...new Set([...modelTags, ...heuristic.tags.filter((t) => HARD_TAGS.has(t))])];
    priority = PRIORITY_FROM_MODEL[String(data.priority).toLowerCase()] ?? heuristic.priority;
    // In doubt, out of the inbox: any spam signal wins over a model that missed it.
    spam = data.spam === true || heuristic.spam;
    spamReason = spam ? heuristic.spamReason || (typeof data.spamReason === 'string' && data.spamReason) || t('Détecté par l’IA') : null;
    opportunity = data.opportunity === true && !heuristic.bulk;
    opportunityReason = opportunity ? (typeof data.opportunityReason === 'string' && data.opportunityReason) || t('Opportunité détectée par l’IA') : null;
    // A model's code only counts if the mail really presents it as a one-time code.
    otp = validateOtp(data.otp, input.text) ?? heuristic.otp;
    if (typeof data.summary === 'string' && data.summary.trim()) summary = data.summary.trim().slice(0, 200);
  } else {
    tags = [...heuristic.tags, ...(input.customTags ?? [])];
    priority = heuristic.priority;
  }

  // The provider already filed it as spam (Gmail's Spam folder…): trust it.
  if (input.folder === 'junk' && !spam) {
    spam = true;
    spamReason = t('Classé en spam par votre fournisseur de messagerie');
  }
  // A spam's code is never shown, and a spam belongs to no category.
  if (spam) {
    otp = null;
    opportunity = false;
    opportunityReason = null;
    tags = tags.filter((t) => t === 'marketing');
  }

  // Floors that hold whatever the model says.
  if (tags.includes('chargeback')) priority = 3;
  // A service about to suspend or close one of the user's accounts is never « low ».
  if (heuristic.accountAlert && priority < 2) priority = 2;
  if (otp) {
    priority = Math.max(priority, 2) as Priority;
    if (!tags.includes('security')) tags.push('security');
  }
  if (opportunity && !tags.includes('opportunity')) tags.push('opportunity');
  if (spam) priority = 0;
  if (priority >= 2 && !spam && !tags.includes('important') && !otp) tags.push('important');
  if (priority < 2) tags = tags.filter((t) => t !== 'important');

  // Only categories the user has (a hidden one must not win the topic and leave none).
  tags = tags.filter((t) => input.knownTags.has(t));
  // One topic per mail, no pile-ups like « Facture + Notification + Sécurité ».
  tags = scopeTags(tags, { securityStrong: Boolean(otp) });

  return { tags, priority, spam, spamReason, opportunity, opportunityReason, otp, summary };
}
