import type { CatalogModel } from './catalog';
import type { MailFeatures } from './heuristics';
import type { ModelTriage } from './merge';
import { otpCandidates } from './otp';
import type { JevSetup, JevQuestionText } from './prompt-config';

/**
 * TypeSafe Jev (via ZenMux `POST /systemone`): a "System One" model that answers typed
 * questions (yes/no probabilities, choices, scores) instead of writing text. One request
 * asks every triage question at once; the answers are turned into the same shape an LLM
 * returns, so the guardrails in merge.ts apply unchanged. Jev writes no summary.
 */
export const isJevModel = (model: string) => /^typesafe\/jev/i.test(model);

/** ZenMux's /models omits Jev (it is not a chat model); prices from docs.typesafe.ai/models. */
export const JEV_CATALOG: CatalogModel[] = [
  { id: 'typesafe/jev-1.14', name: 'TypeSafe: Jev 1.14', inputPrice: 0.042, outputPrice: 0, contextLength: 32_000, reasoning: false },
  { id: 'typesafe/jev-1.13', name: 'TypeSafe: Jev 1.13', inputPrice: 0.042, outputPrice: 0, contextLength: 32_000, reasoning: false },
];

/** One System One call through ZenMux. */
export async function callJev(baseUrl: string, apiKey: string, request: JevRequest, timeoutMs = 20_000): Promise<JevResponse> {
  const res = await fetch(`${baseUrl}/systemone`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as JevResponse;
}

type TagRef = { id: string; name: string; description: string };
type BusinessRef = { name: string; description: string };

type Criteria = { true: string; false: string };
type Question =
  | { type: 'noul'; instructions: string; criteria?: Criteria }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type JevState = {
  sender: { name: string; address: string; domain: string };
  recipient: string;
  subject: string;
  body: string;
  /** Facts ZMail already knows from the headers. */
  sent_to_a_mailing_list: boolean;
  has_unsubscribe_link: boolean;
};
export type JevRequest = { model: string; state: JevState; questions: Record<string, Question> };
export type JevResponse = {
  answers: Record<string, { type: string; noul?: number; choice?: string; score?: number; confidence?: number; probabilities?: Record<string, number> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Everything Jev is asked, in one place. Each question is ONE judgment a person could make at
// a glance (TypeSafe's guidance); the decisions (spam, priority, tags) are made in code below.
// ─────────────────────────────────────────────────────────────────────────────

const q = (instructions: string, yes: string, no: string): Question => ({ type: 'noul', instructions, criteria: { true: yes, false: no } });

export const JEV_QUESTIONS = {
  // Who wrote it
  written_by_a_person: q(
    'Did a person write `body` personally to the recipient?',
    'A client, prospect, colleague, friend or relative wrote this message to the recipient.',
    'A company system, a mailing list or a mass campaign sent this message.',
  ),
  expects_a_reply: q('Is the sender waiting for the recipient to answer a question or a request?', 'The sender asks something and expects an answer from the recipient.', 'The message only informs; nobody waits for an answer.'),
  from_friend_or_family: q('Is the sender a friend or a relative of the recipient?', 'A friend or a family member writes about private life.', 'The sender is a company, a client or a work contact.'),

  // Scam and spam signals
  claims_to_be_known_company: q('Does `sender.name` present the sender as a well-known company or public body?', 'The sender name is a known brand, bank, carrier, streaming service or government agency.', 'The sender name is a person or a small business.'),
  domain_is_official: q('Is `sender.domain` the official domain of the company named in `sender.name`?', 'The domain belongs to that company, like dhl.com for DHL or paypal.com for PayPal.', 'The domain is unrelated, misspelled or made of random letters, like netf1ix-billing.test for Netflix.'),
  asks_to_pay_or_give_details: q('Does the message ask the recipient to pay a small fee or to enter card, bank or login details through a link?', 'The recipient is told to pay a fee or type card, bank or password details on a page.', 'The message asks for no payment and no personal details.'),
  promises_unexpected_money: q('Does the message promise the recipient a prize, a gift, an inheritance or money they were not expecting?', 'The recipient supposedly won something or is owed unexpected money.', 'No prize, gift or unexpected money is promised.'),
  asks_to_send_back_a_code: q('Does the message ask the recipient to send back or share a code they received?', 'The recipient is asked to reply with, or share, a code.', 'The recipient is only told to type a code themselves, or there is no code.'),
  pitches_services_to_the_business: q('Is the sender selling a service to grow or run the recipient’s business?', 'A cold pitch for marketing, SEO, leads, developers, software or AI tools.', 'A shop advertising its own products, a newsletter, or a personal or transactional message.'),

  // Kind of message
  gives_a_one_time_code: q('Does the message give the recipient a one-time code to type in to sign in, verify or confirm something?', 'There is a verification, login or confirmation code for the recipient to enter.', 'Numbers in the message are order, booking, tracking, invoice or postal numbers, a promo code, or there are none.'),
  is_security_notice: q('Is the message a security alert about activity on one of the recipient’s accounts?', 'A new sign-in, a new device, or a new access token or key was added.', 'A password reset link the recipient asked for, or nothing about account activity.'),
  is_purchase_or_payment_record: q('Is the message a record of an order, payment, invoice, refund, bank transaction or subscription of the recipient?', 'An order confirmation, invoice, receipt, payout, card payment or renewal notice.', 'The message is not about one of the recipient’s purchases or payments.'),
  is_about_a_delivery: q('Is the message about the shipping or delivery of a parcel or an order?', 'A shipment, tracking update or delivery slot.', 'No parcel or order delivery is involved.'),
  is_about_a_meeting: q('Is the message about a meeting, an appointment or a call with the recipient?', 'An invitation, a booking, a rescheduling or a call request.', 'No meeting, appointment or call is involved.'),
  is_editorial_newsletter: q('Is the message an editorial newsletter or digest of articles?', 'A regular issue of articles, links or news sent to subscribers.', 'The message is a promotion, a notification or a personal message.'),
  is_promotion: q('Is the message a promotion for products or a sale?', 'Discounts, sales, promo codes or a product catalogue sent to customers.', 'Nothing is being sold or advertised.'),
  is_automated_status: q('Is the message an automated status report from a service?', 'A robot reports a deployment, a backup, an account update or an out-of-office reply.', 'A person wrote it, or it is a promotion or a newsletter.'),

  // What it asks for
  asks_for_quote_or_partnership: q('Is the sender asking the recipient’s business for a quote, a price, a partnership, a collaboration or a bulk order?', 'A potential client or partner wants to buy from or work with the recipient’s business.', 'The sender sells something to the recipient, or makes no business request.'),
  reports_payment_dispute: q('Does the message report a payment dispute or a chargeback opened by a customer?', 'A customer contested a payment and the recipient must respond.', 'No customer contested a payment.'),
  reports_failed_or_overdue_payment: q('Does the message say a payment from the recipient failed or is overdue?', 'A card was declined, or an invoice of the recipient is unpaid past its due date.', 'Payments are fine, or the message is not about the recipient owing money.'),
  reports_service_down: q('Does the message report that a site, a shop or a service of the recipient is down or broken?', 'A site is unreachable, a checkout fails or customers cannot use the service right now.', 'Everything works, or the message is not about an outage.'),
  reports_account_takeover: q('Does the message say the password or the email address of one of the recipient’s accounts was changed?', 'The password or the email address of the account has already been changed.', 'Only a sign-in or a device was noticed, or a reset was merely offered, or nothing was changed.'),
  threatens_account_access: q('Does the message warn that one of the recipient’s accounts will be suspended, blocked, closed or restricted unless they act?', 'The service says the account will be cut off or limited, or demands an identity check or an update to keep it.', 'No account of the recipient is at risk of being suspended, blocked or closed.'),
  sets_a_near_deadline: q('Does the sender ask the recipient to do something within the next few days?', 'A person asks for an action or a document before a date this week or next.', 'There is no near deadline for the recipient.'),
} satisfies Record<string, Question>;

type Signal = keyof typeof JEV_QUESTIONS;

/** The questions as the advanced settings show them (question, what yes means, what no means). */
export const jevQuestionTexts = (): Record<string, JevQuestionText> =>
  Object.fromEntries(
    Object.entries(JEV_QUESTIONS).map(([id, q]) => [id, { instructions: q.instructions, yes: q.type === 'noul' ? (q.criteria?.true ?? '') : '', no: q.type === 'noul' ? (q.criteria?.false ?? '') : '' }]),
  );

/** How the decisions use each signal, for the settings (Jev answers, ZMail decides). */
export const JEV_SIGNAL_USE: Record<Signal, { group: string; use: string }> = {
  written_by_a_person: { group: 'Qui écrit', use: 'Distingue une vraie personne d’un envoi automatique : priorité haute si elle attend une réponse.' },
  expects_a_reply: { group: 'Qui écrit', use: 'Tag « À répondre » et priorité haute quand une personne attend une réponse.' },
  from_friend_or_family: { group: 'Qui écrit', use: 'Tag « Personnel ».' },
  claims_to_be_known_company: { group: 'Arnaques', use: 'Contexte pour repérer une usurpation de marque.' },
  domain_is_official: { group: 'Arnaques', use: 'Phishing si des identifiants ou un paiement sont demandés depuis un domaine qui n’est pas celui de l’expéditeur. Non posée sans nom d’expéditeur.' },
  asks_to_pay_or_give_details: { group: 'Arnaques', use: 'Phishing combiné au domaine ; arnaque combiné à un gain promis.' },
  promises_unexpected_money: { group: 'Arnaques', use: 'Arnaque seulement avec une demande d’argent ou de données, ou un domaine usurpé.' },
  asks_to_send_back_a_code: { group: 'Arnaques', use: 'Spam : on ne renvoie jamais un code.' },
  pitches_services_to_the_business: { group: 'Arnaques', use: 'Spam (prospection), sauf si c’est une vraie demande de devis.' },
  gives_a_one_time_code: { group: 'Nature du mail', use: 'Sans ce « oui », aucun code OTP n’est retenu.' },
  is_security_notice: { group: 'Nature du mail', use: 'Tag « Sécurité » et priorité haute.' },
  is_purchase_or_payment_record: { group: 'Nature du mail', use: 'Tag « Facture & paiement » ; garde la priorité « normale ».' },
  is_about_a_delivery: { group: 'Nature du mail', use: 'Tag « Livraison » ; garde la priorité « normale ».' },
  is_about_a_meeting: { group: 'Nature du mail', use: 'Tag « Réunion » ; garde la priorité « normale ».' },
  is_editorial_newsletter: { group: 'Nature du mail', use: 'Tag « Newsletter », priorité basse.' },
  is_promotion: { group: 'Nature du mail', use: 'Tag « Marketing », priorité basse.' },
  is_automated_status: { group: 'Nature du mail', use: 'Tag « Notification », priorité basse.' },
  asks_for_quote_or_partnership: { group: 'Ce qui est demandé', use: 'Opportunité business (si une personne écrit), priorité haute.' },
  reports_payment_dispute: { group: 'Urgences', use: 'Tag « Chargeback & litige », priorité urgente.' },
  reports_failed_or_overdue_payment: { group: 'Urgences', use: 'Priorité urgente.' },
  reports_service_down: { group: 'Urgences', use: 'Priorité urgente.' },
  reports_account_takeover: { group: 'Urgences', use: 'Priorité urgente, tag « Sécurité ».' },
  threatens_account_access: { group: 'Urgences', use: 'Priorité haute (urgente avec une échéance proche) : un compte va être suspendu, bloqué ou fermé.' },
  sets_a_near_deadline: { group: 'Ce qui est demandé', use: 'Priorité haute quand une personne fixe une échéance proche.' },
};

/** Probability thresholds: 0.7 means yes, as TypeSafe recommends; 0.5 where a miss costs more than a false alarm. */
export const JEV_THRESHOLDS = { yes: 0.7, lean: 0.5, customTag: 0.7, maxTags: 4 };

/** Codes are picked, never written: the companion `gives_a_one_time_code` says whether one exists. */
function otpQuestion(candidates: string[], text: string): Question {
  const around = (code: string) => {
    const at = text.replace(/\s/g, ' ').search(new RegExp(code.split('').join('[ -]?')));
    return at < 0 ? code : `${code} — « …${text.slice(Math.max(0, at - 60), at + code.length + 30).replace(/\s+/g, ' ')}… »`;
  };
  return {
    type: 'choice',
    instructions: 'Which of these strings is the one-time code the recipient must type in?',
    criteria: Object.fromEntries(candidates.map((c) => [c, around(c)])),
  };
}

export function buildJevTriage(input: { model: string; features: MailFeatures; bulk: boolean; tags: TagRef[]; business?: BusinessRef; businesses: BusinessRef[] }, setup?: JevSetup): JevRequest {
  const { features } = input;
  const state: JevState = {
    sender: { name: features.from.name ?? '', address: features.from.email, domain: features.from.email.split('@')[1] ?? '' },
    recipient: features.to.map((a) => a.email).join(', '),
    subject: features.subject,
    body: features.text.replace(/\s+\n/g, '\n').slice(0, 2500),
    sent_to_a_mailing_list: input.bulk,
    has_unsubscribe_link: Boolean(features.listUnsubscribe),
  };
  const questions: Record<string, Question> = { ...JEV_QUESTIONS };
  // The user's wording (advanced settings) replaces the default one, question by question.
  for (const [id, text] of Object.entries(setup?.questions ?? {})) if (id in questions) questions[id] = q(text.instructions, text.yes, text.no);
  // Without a sender name there is no claimed identity to check the domain against: no person
  // could answer, so the question is left out rather than answered with noise.
  if (!state.sender.name.trim()) delete questions.domain_is_official;
  const text = `${features.subject}\n${features.text}`;
  const candidates = otpCandidates(text);
  if (candidates.length) questions.otp = otpQuestion(candidates, text);
  // The user's own tags get a question each; built-in tags are derived from the signals above.
  for (const tag of input.tags.filter((t) => !BUILTIN_TAGS.has(t.id))) {
    questions[`tag:${tag.id}`] = q(`Does this message belong to the category « ${tag.name} »?`, tag.description || tag.name, `The message is not about ${tag.name}.`);
  }
  return { model: input.model, state, questions };
}

const BUILTIN_TAGS = new Set(['important', 'to-respond', 'opportunity', 'finance', 'chargeback', 'security', 'newsletter', 'marketing', 'notification', 'meeting', 'personal', 'delivery']);

/** The truth table: Jev's judgments in, ZMail's triage out (same shape an LLM returns). */
export function parseJevTriage(response: JevResponse, thresholds: { yes: number; lean: number } = JEV_THRESHOLDS): ModelTriage {
  const a = response.answers ?? {};
  const p = (id: Signal | string) => a[id]?.noul ?? 0;
  const { yes, lean } = thresholds;
  const is = (id: Signal) => p(id) >= yes;
  const leans = (id: Signal) => p(id) >= lean;

  const person = leans('written_by_a_person');
  // Asking for money or credentials from a domain that does not belong to the claimed sender.
  const impersonation = 'domain_is_official' in a && is('asks_to_pay_or_give_details') && p('domain_is_official') < lean;
  // A promised gift or windfall is a scam when it comes with a request for money or details, or
  // from a domain that is not the sender's (an official « free eSIM » from a ministry is not).
  const domainNotTheirs = 'domain_is_official' in a && p('domain_is_official') < yes;
  const bait = is('promises_unexpected_money') && (leans('asks_to_pay_or_give_details') || domainNotTheirs || person);
  const scam = bait || is('asks_to_send_back_a_code') || impersonation;
  const spam = scam || (is('pitches_services_to_the_business') && !is('asks_for_quote_or_partnership'));

  const otpPick = a.otp?.choice;
  const otp = otpPick && is('gives_a_one_time_code') ? otpPick : null;
  const opportunity = is('asks_for_quote_or_partnership') && person;
  const dispute = leans('reports_payment_dispute');

  let priority: (typeof PRIORITY)[number] = 'normal';
  // Records of the recipient's own purchases, deliveries and meetings stay « normal », even when sent by a robot.
  const record = is('is_purchase_or_payment_record') || leans('is_about_a_delivery') || leans('is_about_a_meeting');
  if (!record && (is('is_promotion') || is('is_editorial_newsletter') || (is('is_automated_status') && !person))) priority = 'low';
  if (otp || leans('is_security_notice') || opportunity || (person && (leans('expects_a_reply') || leans('sets_a_near_deadline')))) priority = 'high';
  // A service about to cut the recipient off: high, urgent with a near deadline (never for a scam).
  if (!spam && leans('threatens_account_access')) priority = leans('sets_a_near_deadline') ? 'urgent' : 'high';
  if (dispute || leans('reports_failed_or_overdue_payment') || leans('reports_service_down') || is('reports_account_takeover')) priority = 'urgent';

  const tags: string[] = [];
  const add = (cond: boolean, tag: string) => cond && !tags.includes(tag) && tags.push(tag);
  add(dispute, 'chargeback');
  add(Boolean(otp) || leans('is_security_notice') || is('reports_account_takeover'), 'security');
  add(opportunity, 'opportunity');
  add(person && leans('expects_a_reply'), 'to-respond');
  add(is('is_purchase_or_payment_record') || leans('reports_failed_or_overdue_payment'), 'finance');
  add(leans('is_about_a_delivery'), 'delivery');
  add(leans('is_about_a_meeting'), 'meeting');
  add(is('from_friend_or_family'), 'personal');
  add(is('is_editorial_newsletter'), 'newsletter');
  add(is('is_promotion'), 'marketing');
  add(is('is_automated_status') && !person && tags.length === 0, 'notification');
  for (const key of Object.keys(a).filter((k) => k.startsWith('tag:') && p(k) >= JEV_THRESHOLDS.customTag)) add(true, key.slice(4));

  return { tags: tags.slice(0, JEV_THRESHOLDS.maxTags), priority, spam, opportunity, otp };
}
