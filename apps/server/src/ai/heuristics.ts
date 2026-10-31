import type { Address } from '../lib/address';
import { evaluateAuth } from '../mail/auth';
import { detectPhishing } from './phishing';
import type { AttachmentMeta, Priority, UnsubscribeInfo } from '../types';
import { FREE_MAIL_DOMAINS, domainOf } from '../lib/address';
import { findOtp } from './otp';
import { t } from '../lib/i18n';

export type MailFeatures = {
  subject: string;
  text: string;
  html: string;
  from: Address;
  to: Address[];
  cc: Address[];
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  spamHeader: string | null;
  /** Authentication-Results from the receiving provider (mail/auth.ts). */
  authResults?: string | null;
  attachments: AttachmentMeta[];
};

export type HeuristicResult = {
  tags: string[];
  priority: Priority;
  spam: boolean;
  spamReason: string | null;
  spamCertain: boolean;
  opportunity: boolean;
  opportunityReason: string | null;
  newsletter: boolean;
  bulk: boolean;
  otp: string | null;
  /** A service warns that one of the user's accounts will be suspended, blocked or closed. */
  accountAlert: boolean;
  unsubscribe: UnsubscribeInfo | null;
  summary: string;
};

const has = (re: RegExp, ...texts: string[]) => texts.some((t) => re.test(t));

const RE = {
  otpStrict: /(\bcode\b(?! promo)|\botp\b|passcode|one[- ]time|v[ée]rification|verification|\b2fa\b|\bmfa\b|authenti|connexion|sign[- ]?in|log[- ]?in|login|s[ée]curit[ée]|security code)/i,
  automatedSender: /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|mailer|bounce|info|news(letter)?|updates?|hello|team|support|marketing|promo)[@+]/i,
  promo: /(\bpromo(tion)?s?\b|\bsoldes?\b|\b\d{1,2}\s?%\s?(off|de r[ée]duction|offerts?)|-\d{1,2}\s?%|black friday|cyber monday|\bdeal\b|\bcoupon|code promo|offre (sp[ée]ciale|exclusive|limit[ée]e)|derniers? jours|last chance|flash sale|\bsale\b|livraison offerte|free shipping)/i,
  newsletterWords: /(newsletter|digest|weekly|hebdo|[ée]dition|this week in|la lettre|bulletin)/i,
  // A service is about to cut the user off: suspension, block, closure, or an identity check
  // (KYC) demanded to keep the account. Always worth seeing first, robot sender or not.
  accountThreat:
    /(suspension (de|du) (votre |ton )?compte|(votre|ton) compte (sera|va [êe]tre|est|a [ée]t[ée]|risque d['’][êe]tre) (suspendu|bloqu[ée]|ferm[ée]|cl[ôo]tur[ée]|d[ée]sactiv[ée]|restreint|limit[ée]|gel[ée])|(blocage|fermeture|cl[ôo]ture|d[ée]sactivation|restriction|gel) (de|du) (votre |ton )?compte|(v[ée]rification|justificatif)s? d['’]identit[ée]|(compl[ée]ter?|finaliser) (la |votre )?v[ée]rification|\bkyc\b|anti-?blanchiment|(your|the) account (will be|has been|is|may be) (suspended|closed|restricted|locked|limited|deactivated|disabled|frozen)|(suspension|closure|restriction|deactivation) of your account|verify your identity|identity verification|(account|service) (suspension|restriction) notice)/i,
  accountDeadline: /(aujourd['’]hui|sous (24|48) ?h|dans (24|48) ?h|imm[ée]diatement|d[èe]s maintenant|dernier (rappel|d[ée]lai)|today|within (24|48) hours|immediately|final (notice|reminder))/i,
  security: /(alerte de s[ée]curit[ée]|security alert|nouvelle connexion|new (sign[- ]?in|login)|password reset|r[ée]initialis(er|ation) (de )?(votre )?mot de passe|suspicious|activit[ée] inhabituelle|unusual activity|2fa|two[- ]factor)/i,
  /** An amount next to the words of a bill: what a real receipt or invoice contains. */
  amountDue: /\b(total|montant|amount|subtotal|sous-total|tva|vat|ttc|ht|factur\w*|invoice\w*|re[çc]u|receipt|pay[ée]e?|paid|charged|d[ée]bit[ée]e?)\b[^\n]{0,40}?(\d[\d\s.,]*\s?(€|eur\b|\$|usd\b|£|gbp\b|chf\b)|(€|\$|£)\s?\d)/i,
  finance: /\b(factures?|invoices?|re[çc]us?|receipts?|paiements?|payments?|r[èe]glements?|abonnements?|subscription renew\w*|relev[ée]s?|statements?|virements?|transfers?|payouts?|versements?|avoirs?|credit notes?|[ée]ch[ée]ances?)\b/i,
  paymentProblem: /(payment failed|[ée]chec (du|de) paiement|paiement refus[ée]|card declined|carte refus[ée]e|impay[ée]|overdue|en retard|dernier rappel|final notice|mise en demeure)/i,
  chargeback: /(chargeback|charge-back|r[ée]trofacturation|dispute|litige|contestation (de|du) paiement|opposition bancaire|disputed|inquiry opened|r[ée]clamation (de|du) paiement)/i,
  meeting: /(invitation|meeting|r[ée]union|rendez-vous|\brdv\b|calendar|calendrier|zoom\.us|meet\.google|teams\.microsoft|webinar|call (de|pr[ée]vu)|invited you)/i,
  delivery: /(exp[ée]di[ée]e?|shipped|livraison|delivery|delivered|livr[ée]|colis|parcel|tracking|suivi de (votre )?commande|order (has )?shipped|en cours d'acheminement)/i,
  order: /(confirmation de commande|order confirmation|votre commande|your order)/i,
  opportunity: /(partenariat|partnership|collaborat|sponsor|devis|quote|quotation|proposal|proposition commerciale|appel d'offres|\brfp\b|\brfq\b|demande de (prix|tarif|renseignement|devis)|tarifs?|pricing request|int[ée]ress[ée]e? par (vos|votre|ton|tes)|interested in (your|working)|work(ing)? (with|together)|travailler (avec|ensemble)|budget|lead|opportunit|acquisition|investissement|investor|rachat|white[- ]label|distribut(eur|or)|revendeur|reseller|affiliation|projet (pour|avec)|mission (freelance)?|recrutement de (votre|vos)|hire you|vous embaucher)/i,
  urgent: /(\burgent\b|\basap\b|imm[ée]diatement|dans les plus brefs d[ée]lais|today|aujourd'hui avant|deadline|date limite|action requise|action required|time[- ]sensitive)/i,
  question: /\?\s*(\n|$)|(pouvez-vous|pourriez-vous|peux-tu|could you|can you|would you|merci de (me|nous) (dire|confirmer|r[ée]pondre)|let me know|tenez-moi au courant|qu'en pensez-vous|what do you think)/i,
  // Short words need boundaries: « cialis » must not match « Socialist Republic ».
  // Pushes to type credentials or card details through a link: what a real service never asks by mail.
  spamLinkBait: /(click (here|below|the link)|cliquez (ici|sur (le|ce) lien)|log ?in (here|now)|connectez-vous (ici|maintenant|sur ce lien)|confirm your (details|information)|(saisi(r|ssant|ssez)|entr(er|ez|ant)|renseign(er|ez|ant)|confirm(er|ez|ant)) (vos|votre) (identifiants|mot de passe|coordonn[ée]es bancaires|carte)|enter your (password|credentials|card)|(sur|via) ce lien|https?:\/\/\S*(login|verif|secure|signin|account-update)\S*)/i,
  spam: /(you('ve| have)? won|vous avez gagn[ée]|lottery|loterie|jackpot|inheritance|h[ée]ritage|bitcoin (doubl|giveaway)|crypto giveaway|wire transfer urgently|western union|nigerian prince|\bviagra\b|\bcialis\b|\bcasino\b|get rich|enlarge|weight loss miracle|claim your (prize|reward)|r[ée]clamez votre (prix|r[ée]compense)|act now!|100% free|risk[- ]free|congratulations!{1,}|f[ée]licitations!{1,}.*(gagn|prix)|verify your account (now|immediately))/i,
};

/** Words that name an unsubscribe link, in the languages ZMail meets most. */
const UNSUB_LABEL =
  /(unsubscrib|d[ée]sinscri|d[ée]sabonn|se d[ée]sinscrire|opt[- ]?out|ne (plus|pas) recevoir|stop (receiving|these emails)|no longer (wish|want) to receive|abmelden|abbestellen|darse de baja|cancelar (la )?suscripci|annulla(re)? (l'?)?iscrizione|disiscriviti|uitschrijven|afmelden|manage (your )?(e-?mail |subscription |notification )?(preferences|subscriptions?|settings)|update (your )?(e-?mail )?preferences|e-?mail preferences|g[ée]rer (mes|vos) (pr[ée]f[ée]rences|abonnements|notifications)|pr[ée]f[ée]rences (de communication|e-?mail|d'abonnement))/i;
/** The words that really mean « unsubscribe », preferred over a « preferences » page. */
const UNSUB_STRONG = /(unsubscrib|d[ée]sinscri|d[ée]sabonn|opt[- ]?out|abmelden|abbestellen|darse de baja|disiscriviti|uitschrijven|afmelden)/i;
const UNSUB_HREF = /unsub|d[ée]sinscri|desinscri|desabonn|opt-?out|optout|abmeld|manage-subscription/i;
/** « To unsubscribe, click here »: the words are next to the link, not in it. */
const CLICK_HERE = /^\s*(click here|here|ici|cliquez ici|cliquez|this link|ce lien|hier|aqu[íi]|qui)\s*\.?\s*$/i;

const decodeHref = (href: string) => href.replace(/&amp;/g, '&').replace(/&#x3d;|&#61;/gi, '=').trim();
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

/**
 * Unsubscribe targets: the List-Unsubscribe header (RFC 2369 / 8058) first, else the body,
 * in HTML (a link named « Unsubscribe », a link to an unsubscribe page, or « click here » right
 * after « to unsubscribe ») or in plain text (« Unsubscribe: https://… »).
 */
export function extractUnsubscribe(features: Pick<MailFeatures, 'listUnsubscribe' | 'listUnsubscribePost' | 'html' | 'text'>): UnsubscribeInfo | null {
  const info: UnsubscribeInfo = {};
  if (features.listUnsubscribe) {
    for (const match of features.listUnsubscribe.matchAll(/<([^>]+)>/g)) {
      const target = match[1]!.trim();
      if (/^mailto:/i.test(target)) info.mailto ??= target;
      else if (/^https?:/i.test(target)) {
        if (features.listUnsubscribePost && /one-click/i.test(features.listUnsubscribePost)) info.oneClick ??= target;
        else info.http ??= target;
      }
    }
  }
  if (info.oneClick || info.http || info.mailto) return info;

  // From the body: every candidate gets a score, the most explicit one wins.
  let best: { href: string; score: number } | null = null;
  const consider = (href: string, score: number) => {
    if (score > 0 && (!best || score > best.score)) best = { href, score };
  };
  if (features.html) {
    for (const match of features.html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = decodeHref(match[1] ?? match[2] ?? match[3] ?? '');
      if (!/^(https?|mailto):/i.test(href)) continue;
      const text = plain(match[4]!);
      const before = plain(features.html.slice(Math.max(0, match.index! - 400), match.index!)).slice(-90);
      let score = 0;
      if (UNSUB_STRONG.test(text)) score = 5;
      else if (UNSUB_LABEL.test(text)) score = 3;
      else if (CLICK_HERE.test(text) && UNSUB_STRONG.test(before)) score = 4;
      if (UNSUB_HREF.test(href)) score += score ? 1 : 2;
      if (/^mailto:/i.test(href)) {
        if (score) info.mailto ??= href;
        continue;
      }
      consider(href, score);
    }
  }
  if (!best && features.text) {
    for (const match of features.text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      const before = features.text.slice(Math.max(0, match.index! - 120), match.index!).split(/\n\s*\n/).at(-1) ?? '';
      consider(match[0], (UNSUB_STRONG.test(before) ? 4 : UNSUB_LABEL.test(before) ? 2 : 0) + (UNSUB_HREF.test(match[0]) ? 2 : 0));
    }
  }
  const found = best as { href: string; score: number } | null;
  if (found) {
    info.http = found.href;
    info.fromBody = true;
  } else if (info.mailto) info.fromBody = true;
  return info.http || info.mailto ? info : null;
}

const firstSentence = (text: string) => {
  const clean = text
    .replace(/\[[^\]]*\]|https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = clean.match(/^(.{20,160}?[.!?])(\s|$)/)?.[1] ?? clean.slice(0, 140);
  return sentence.length < clean.length && !/[.!?]$/.test(sentence) ? `${sentence}…` : sentence;
};

export function classifyHeuristically(features: MailFeatures): HeuristicResult {
  const subject = features.subject;
  const body = features.text.slice(0, 8000);
  const sender = features.from.email;
  const senderDomain = domainOf(sender);
  const tags = new Set<string>();

  // A way to unsubscribe, even only in the body, means a mailing (newsletter, promo, alerts).
  const unsubscribe = extractUnsubscribe(features);
  const bulk =
    Boolean(features.listUnsubscribe || features.listId || unsubscribe) ||
    /bulk|list|junk/i.test(features.precedence ?? '') ||
    RE.automatedSender.test(sender);
  const automated = Boolean(features.autoSubmitted && !/^no$/i.test(features.autoSubmitted)) || RE.automatedSender.test(sender);
  const promo = has(RE.promo, subject, body.slice(0, 2000));
  const newsletter = Boolean(features.listUnsubscribe || features.listId) && !automated ? true : bulk && (promo || has(RE.newsletterWords, subject, sender));

  const otpContext = `${subject}\n${body.slice(0, 1200)}`;
  const otp = !(promo && bulk) && RE.otpStrict.test(otpContext) ? findOtp(`${subject}\n${body}`) : null;
  if (otp) tags.add('security');
  if (has(RE.security, subject, body.slice(0, 1500))) tags.add('security');
  if (has(RE.chargeback, subject, body.slice(0, 3000))) tags.add('chargeback');
  // A mass mailing (newsletter, promo, product news from a no-reply address) that talks about
  // payments is not an invoice: there, only the subject or a real amount (« Total : 49,90 € »)
  // makes it one.
  const financeInBody = has(RE.finance, body.slice(0, 1500)) && !promo && (!bulk || has(RE.amountDue, body.slice(0, 3000)));
  if (has(RE.finance, subject) || financeInBody) tags.add('finance');
  if (has(RE.meeting, subject) || features.attachments.some((a) => /calendar|ics/i.test(a.contentType + a.filename))) tags.add('meeting');
  if (has(RE.delivery, subject) || has(RE.order, subject)) tags.add('delivery');
  if (newsletter && !promo) tags.add('newsletter');
  if (promo && bulk) tags.add('marketing');
  if (automated && !newsletter && !promo && tags.size === 0) tags.add('notification');

  const personalSender = !bulk && !automated;
  const opportunity = personalSender && has(RE.opportunity, subject, body.slice(0, 3000));
  if (opportunity) tags.add('opportunity');
  if (personalSender && FREE_MAIL_DOMAINS.has(senderDomain) && !opportunity && !has(RE.finance, subject)) tags.add('personal');
  if (personalSender && has(RE.question, body.slice(0, 3000))) tags.add('to-respond');

  const spamHeader = /^yes|score=([5-9]|\d{2})/i.test(features.spamHeader ?? '');
  const spamText = has(RE.spam, subject, body.slice(0, 3000));
  const shouty = subject.length > 12 && subject === subject.toUpperCase() && /[A-Z]{6}/.test(subject) && (subject.match(/!/g)?.length ?? 0) >= 2;
  const phishing = detectPhishing({ fromName: features.from.name, fromEmail: sender, to: features.to.map((a) => a.email), subject, text: body });
  // DMARC failed: the provider could not confirm the mail comes from the sender's domain. Official
  // senders publish DMARC, so a failure there is the classic sign of a spoofed « official » mail.
  const auth = evaluateAuth(features.authResults ?? null, sender);
  const spoofed = auth.dmarc === 'fail';
  // « Your account will be suspended » is the classic scam line, and also what real services
  // write: it only counts as spam when the sender's domain did not sign the mail (no DMARC pass).
  const threat = has(RE.accountThreat, subject, body.slice(0, 3000));
  const unsignedThreat = threat && auth.dmarc !== 'pass' && has(RE.spamLinkBait, body.slice(0, 3000));
  const spam = spamHeader || spamText || shouty || phishing.phishing || spoofed || unsignedThreat;

  let priority: Priority = 1;
  if (tags.has('marketing') || tags.has('newsletter') || (tags.has('notification') && !tags.has('security'))) priority = 0;
  if (tags.has('opportunity') || tags.has('to-respond') || otp) priority = 2;
  if (tags.has('finance') && has(RE.paymentProblem, subject, body.slice(0, 2000))) priority = 3;
  if (tags.has('chargeback')) priority = 3;
  if (tags.has('security') && !otp && has(RE.security, subject)) priority = Math.max(priority, 2) as Priority;
  if (personalSender && has(RE.urgent, subject)) priority = 3;
  // An account about to be cut off comes first: high, urgent when the delay is short.
  const accountAlert = threat && !spam;
  if (accountAlert) {
    priority = Math.max(priority, has(RE.accountDeadline, subject, body.slice(0, 3000)) ? 3 : 2) as Priority;
    tags.delete('notification');
    if (!tags.has('finance')) tags.add('security');
  }
  if (spam) priority = 0;
  if (priority >= 2 && !spam) tags.add('important');

  return {
    tags: [...tags],
    priority,
    spam,
    spamReason: phishing.phishing ? phishing.reason : spoofed ? t('Expéditeur non authentifié : le domaine {domain} n’a pas signé ce mail (usurpation probable)', { domain: sender.split('@')[1] ?? '' }) : spamHeader ? t('Marqué comme spam par le serveur') : spamText ? t('Formulations typiques d’arnaque ou de spam') : shouty ? t('Objet agressif en majuscules') : null,
    spamCertain: spamHeader || phishing.phishing || spoofed,
    opportunity,
    opportunityReason: opportunity ? t('Demande commerciale ou proposition détectée') : null,
    newsletter: newsletter || (promo && bulk),
    bulk,
    otp: spam ? null : otp,
    accountAlert,
    unsubscribe,
    summary: firstSentence(body || subject),
  };
}
