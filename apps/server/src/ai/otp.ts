const KEYWORDS =
  /(code|otp|one[- ]time|passcode|pass code|verification|v[ée]rification|verify|v[ée]rifier|2fa|mfa|two[- ]factor|authenticat|authentification|connexion|sign[- ]?in|log[- ]?in|login|s[ée]curit[ée]|security|confirm|pin\b|token|jeton|cl[ée] d'acc[èe]s)/i;

// Grouped codes too: « 482 913 », « K7P-29X ».
const CANDIDATE = /(?<![\w€$£.,/-])(\d{3}[- ]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}|(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{2,5}-[A-Z0-9]{2,5})(?![\w€$£%/-]|[.,]\d)/g;

const looksLikeNoise = (token: string, before: string, after: string) => {
  const digits = token.replace(/\D/g, '');
  if (/^(19|20)\d{2}$/.test(token)) return true; // a year
  if (/^0[1-9]\d{8}$/.test(digits)) return true; // a phone number
  if (/(€|\$|£|eur|usd|n°|no\.|#)\s*$/i.test(before) || /^\s?(€|\$|£|eur\b|usd\b|%|h\d|:\d)/i.test(after)) return true;
  if (/^(\d)\1+$/.test(digits) && digits.length >= 4) return true; // 0000, 1111
  return false;
};

/** Every code-shaped token outside links, in order of appearance (for models that pick rather than write). */
export function otpCandidates(text: string, max = 12): string[] {
  const sample = text.replace(URLS, ' ').slice(0, 4000);
  const seen = new Set<string>();
  for (const match of sample.matchAll(CANDIDATE)) {
    const code = match[0].replace(/[\s-]/g, '');
    if (!/^(19|20)\d{2}$/.test(code)) seen.add(code);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Cheap gate run on every mail before asking a model: is there something code-shaped near a code keyword? */
export function looksLikeOtpMail(text: string) {
  return KEYWORDS.test(text.slice(0, 3000)) && findOtp(text) !== null;
}

/**
 * Heuristic OTP extraction: the code-shaped token closest to an OTP keyword, preferring
 * 6-digit numeric codes. Returns null when nothing convincing is found.
 */
export function findOtp(text: string): string | null {
  const sample = text.replace(URLS, ' ').slice(0, 4000);
  const keywordPositions = [...sample.matchAll(new RegExp(KEYWORDS.source, 'gi'))].map((m) => m.index ?? 0);
  if (keywordPositions.length === 0) return null;

  const candidates: { token: string; score: number }[] = [];
  for (const match of sample.matchAll(CANDIDATE)) {
    const token = match[0];
    const at = match.index ?? 0;
    const before = sample.slice(Math.max(0, at - 40), at);
    if (looksLikeNoise(token, before, sample.slice(at + token.length, at + token.length + 5))) continue;
    const distance = Math.min(...keywordPositions.map((p) => Math.abs(p - at)));
    if (distance > 220) continue;
    const digits = token.replace(/\D/g, '');
    let score = 300 - distance;
    if (/^\d{6}$/.test(digits) && digits.length === token.replace(/[- ]/g, '').length) score += 120;
    else if (/^\d+$/.test(token.replace(/[- ]/g, ''))) score += 60;
    if (/(code|otp|passcode|pin)\s*(est|is|:|-)?\s*$/i.test(before)) score += 150;
    if (/\n\s*$/.test(before) || /^\s*$/.test(sample.slice(at + token.length, at + token.length + 2))) score += 20;
    candidates.push({ token, score });
  }
  // Best-scored first; the first one the mail really presents as a code wins.
  for (const { token } of candidates.sort((a, b) => b.score - a.score)) {
    const code = token.replace(/[\s-]/g, '');
    if (isOtpInText(code, text)) return code;
  }
  return null;
}

/** Links carry long ids (`oe=6AE58424`) that look like codes: never search inside them. */
const URLS = /\[?(https?:\/\/|www\.)[^\s\]>)]+[\]>)]?/gi;

/** A real OTP is announced as such… */
const STRONG =
  /(code|c[óo]digo|codice|kod\b|otp|passcode|pin\b|one[- ]time|usage unique|einmal|verification|v[ée]rification|verificaci[óo]n|verifica|verify|best[äa]tigung|2fa|mfa|two[- ]factor|authenticat|authentific|ne (le )?partagez|do not share|don't share|ne pas partager|no lo compartas|nicht weiter)/i;

/** …and never right after one of these: tracking, order, postal, promo or file numbers. */
const NOT_OTP_BEFORE =
  /(suivi|tracking|track|colis|parcel|shipment|commande|order|facture|invoice|re[çc]u|receipt|r[ée]f[ée]rence|\bref\b|n°|num[ée]ro|number|\bno\.|passport|passeport|phone|t[ée]l[ée]phone|tva|vat|siret|siren|promo|coupon|r[ée]duction|discount|offre|offer|postal|post ?code|zip|cedex|client|customer|dossier|ticket|case|transaction|payment id|id\b)[^\d]{0,20}$/i;

/** Postal addresses: « 112 Rue Rambuteau, PARIS, 75001 », « 75008 Paris », « San Francisco, CA 94104 ». */
const ADDRESS_BEFORE = /\b(rue|avenue|av\.|boulevard|bd|all[ée]e|chemin|place|impasse|quai|cours|street|st\.?|road|rd\.?|suite|pmb|building|cedex)\b[^]{0,60}$|,\s*[A-Z]{2}\s*$/;
// Same line only: a code on its own line is often followed by a sentence.
const CITY_AFTER = /^[ \t]*,?[ \t]*[A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{2,}/;

/**
 * Is `code` presented as a one-time code somewhere in the text: as a standalone token
 * outside any link, announced by a code keyword, and not a tracking/postal/order number?
 */
export function isOtpInText(code: string, text: string): boolean {
  const clean = text.replace(URLS, ' ');
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // « 482 913 », « 482-913 » and « K7P-29X » are written in groups: allow a separator anywhere.
  const pattern = [...escaped.matchAll(/\\?./g)].map((m) => m[0]).join('[ -]?');
  for (const match of clean.matchAll(new RegExp(`(?<![\\w-])${pattern}(?![\\w-])`, 'g'))) {
    const at = match.index ?? 0;
    const before = clean.slice(Math.max(0, at - 160), at);
    const after = clean.slice(at + match[0].length, at + match[0].length + 80);
    if (NOT_OTP_BEFORE.test(before.slice(-50))) continue;
    if (/^\d{4,5}$/.test(code) && (ADDRESS_BEFORE.test(before.slice(-70)) || CITY_AFTER.test(after))) continue;
    if (!STRONG.test(before) && !STRONG.test(after.slice(0, 60))) continue;
    return true;
  }
  return false;
}

/** A model answer is only trusted if the mail really presents it as a one-time code. */
export function validateOtp(candidate: unknown, text: string): string | null {
  if (typeof candidate !== 'string') return null;
  const code = candidate.trim().replace(/[\s-]/g, '');
  if (code.length < 4 || code.length > 10) return null;
  return isOtpInText(code, text) ? code : null;
}
