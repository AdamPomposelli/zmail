import type { Address } from '../lib/address';
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
  unsubscribe: UnsubscribeInfo | null;
  summary: string;
};

const has = (re: RegExp, ...texts: string[]) => texts.some((t) => re.test(t));

const RE = {
  otpStrict: /(\bcode\b(?! promo)|\botp\b|passcode|one[- ]time|v[ée]rification|verification|\b2fa\b|\bmfa\b|authenti|connexion|sign[- ]?in|log[- ]?in|login|s[ée]curit[ée]|security code)/i,
  automatedSender: /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|mailer|bounce|info|news(letter)?|updates?|hello|team|support|marketing|promo)[@+]/i,
  promo: /(\bpromo(tion)?s?\b|\bsoldes?\b|\b\d{1,2}\s?%\s?(off|de r[ée]duction|offerts?)|-\d{1,2}\s?%|black friday|cyber monday|\bdeal\b|\bcoupon|code promo|offre (sp[ée]ciale|exclusive|limit[ée]e)|derniers? jours|last chance|flash sale|\bsale\b|livraison offerte|free shipping)/i,
  newsletterWords: /(newsletter|digest|weekly|hebdo|[ée]dition|this week in|la lettre|bulletin)/i,
  security: /(alerte de s[ée]curit[ée]|security alert|nouvelle connexion|new (sign[- ]?in|login)|password reset|r[ée]initialis(er|ation) (de )?(votre )?mot de passe|suspicious|activit[ée] inhabituelle|unusual activity|2fa|two[- ]factor)/i,
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
  spam: /(you('ve| have)? won|vous avez gagn[ée]|lottery|loterie|jackpot|inheritance|h[ée]ritage|bitcoin (doubl|giveaway)|crypto giveaway|wire transfer urgently|western union|nigerian prince|\bviagra\b|\bcialis\b|\bcasino\b|get rich|enlarge|weight loss miracle|claim your (prize|reward)|r[ée]clamez votre (prix|r[ée]compense)|act now!|100% free|risk[- ]free|congratulations!{1,}|f[ée]licitations!{1,}.*(gagn|prix)|verify your account (now|immediately)|your account (will be|has been) suspended)/i,
};

/** Unsubscribe targets from the List-Unsubscribe header (RFC 2369 / 8058) or the body links. */
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
  if (!info.oneClick && !info.http && !info.mailto && features.html) {
    const label = /(unsubscribe|d[ée]sinscri|d[ée]sabonn|se d[ée]sinscrire|opt[- ]?out|ne plus recevoir|manage (your )?(email )?(preferences|subscription)|g[ée]rer (mes|vos) (pr[ée]f[ée]rences|abonnements))/i;
    for (const match of features.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = match[1]!.replace(/&amp;/g, '&');
      const text = match[2]!.replace(/<[^>]+>/g, ' ');
      if (/^https?:/i.test(href) && (label.test(text) || /unsubscribe|desinscri|optout|opt-out/i.test(href))) {
        info.http = href;
        info.fromBody = true;
        break;
      }
    }
  }
  return info.oneClick || info.http || info.mailto ? info : null;
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

  const bulk =
    Boolean(features.listUnsubscribe || features.listId) ||
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
  if (has(RE.finance, subject) || (has(RE.finance, body.slice(0, 1500)) && !promo)) tags.add('finance');
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
  const spam = spamHeader || spamText || shouty || phishing.phishing;

  let priority: Priority = 1;
  if (tags.has('marketing') || tags.has('newsletter') || (tags.has('notification') && !tags.has('security'))) priority = 0;
  if (tags.has('opportunity') || tags.has('to-respond') || otp) priority = 2;
  if (tags.has('finance') && has(RE.paymentProblem, subject, body.slice(0, 2000))) priority = 3;
  if (tags.has('chargeback')) priority = 3;
  if (tags.has('security') && !otp && has(RE.security, subject)) priority = Math.max(priority, 2) as Priority;
  if (personalSender && has(RE.urgent, subject)) priority = 3;
  if (spam) priority = 0;
  if (priority >= 2 && !spam) tags.add('important');

  return {
    tags: [...tags],
    priority,
    spam,
    spamReason: phishing.phishing ? phishing.reason : spamHeader ? t('Marqué comme spam par le serveur') : spamText ? t('Formulations typiques d’arnaque ou de spam') : shouty ? t('Objet agressif en majuscules') : null,
    spamCertain: spamHeader || phishing.phishing,
    opportunity,
    opportunityReason: opportunity ? t('Demande commerciale ou proposition détectée') : null,
    newsletter: newsletter || (promo && bulk),
    bulk,
    otp: spam ? null : otp,
    unsubscribe: bulk || newsletter ? extractUnsubscribe(features) : null,
    summary: firstSentence(body || subject),
  };
}
