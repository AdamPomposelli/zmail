import { domainOf } from '../lib/address';
import { t } from '../lib/i18n';

/**
 * Brands phishing campaigns impersonate, with the domains their real mail comes from.
 * The name is matched against the sender's display name and the subject once the
 * obfuscation (A•M•A•Z•O•N, ups.france®, 'UPS--express') is stripped.
 */
const BRANDS: [RegExp, string[]][] = [
  [/\bdpd\b/, ['dpd.fr', 'dpd.com', 'dpd.de', 'dpdgroup.com', 'dpd.co.uk']],
  [/\bups\b/, ['ups.com']],
  [/\bdhl\b/, ['dhl.com', 'dhl.fr', 'dhl.de']],
  [/\bfedex\b/, ['fedex.com']],
  [/\bgls\b/, ['gls-group.eu', 'gls-france.com', 'gls-group.com']],
  [/colissimo/, ['laposte.fr', 'colissimo.fr', 'laposte.net']],
  [/chronopost/, ['chronopost.fr']],
  [/la ?poste/, ['laposte.fr', 'laposte.net']],
  [/mondial ?relay/, ['mondialrelay.fr', 'mondialrelay.com']],
  [/amazon/, ['amazon.fr', 'amazon.com', 'amazon.de', 'amazon.co.uk', 'amazon.es', 'amazon.it', 'amazonses.com', 'amazon.ca']],
  [/paypal/, ['paypal.com', 'paypal.fr']],
  [/netflix/, ['netflix.com']],
  [/apple|icloud/, ['apple.com', 'icloud.com', 'email.apple.com', 'insideapple.apple.com']],
  [/microsoft|outlook|office ?365/, ['microsoft.com', 'outlook.com', 'office.com', 'microsoftonline.com']],
  [/\bameli\b|assurance maladie/, ['ameli.fr', 'assurance-maladie.fr']],
  [/\bimpots?\b|dgfip/, ['impots.gouv.fr', 'dgfip.finances.gouv.fr']],
  [/\bants\b/, ['ants.gouv.fr']],
  [/\bcaf\b/, ['caf.fr']],
  [/vinted/, ['vinted.fr', 'vinted.com']],
  [/leboncoin/, ['leboncoin.fr']],
  [/\bcarrefour\b/, ['carrefour.fr', 'carrefour.com']],
  [/\bfnac\b/, ['fnac.com', 'fnacdarty.com']],
  [/\bcdiscount\b/, ['cdiscount.com']],
  [/\blidl\b/, ['lidl.fr', 'lidl.com', 'lidl.de', 'lidl-shop.fr', 'news.lidl.fr']],
  [/\bleclerc\b/, ['e.leclerc', 'leclerc.fr', 'e-leclerc.com']],
  [/\bauchan\b/, ['auchan.fr']],
  [/\bintermarche\b/, ['intermarche.com']],
  [/\bdecathlon\b/, ['decathlon.fr', 'decathlon.com']],
  [/\bikea\b/, ['ikea.com', 'ikea.fr']],
  [/\bdarty\b/, ['darty.com', 'fnacdarty.com']],
  [/\bboulanger\b/, ['boulanger.com']],
  [/\bdoctolib\b/, ['doctolib.fr', 'doctolib.com']],
  [/spotify/, ['spotify.com']],
  [/\b(free mobile|bouygues|sfr|orange)\b/, ['free.fr', 'free-mobile.fr', 'bouyguestelecom.fr', 'sfr.fr', 'orange.fr', 'orange.com']],
  [/\b(credit agricole|societe generale|bnp|lcl|la banque postale|boursorama)\b/, ['credit-agricole.fr', 'ca-paris.fr', 'societegenerale.fr', 'bnpparibas.com', 'mabanque.bnpparibas', 'lcl.fr', 'labanquepostale.fr', 'boursorama.com', 'boursobank.com']],
];

/** Delivery and account lures typical of these campaigns. */
const LURE =
  /(colis (est )?(en attente|bloqu|retenu|pr[êe]t)|livraison (en attente|suspendue|[ée]chou)|frais (de (livraison|douane|r[ée]exp[ée]dition))|confirmer? (votre|vos) (colis|adresse|livraison|coordonn)|dernier rappel|derniere rappel|votre (iphone|cadeau|r[ée]compense|colis) est pr[êe]t|r[ée]clamez|r[ée]cup[ée]rez (votre|vos|ton) (cadeau|r[ée]compense|lot|gain|prix)|(cadeau|r[ée]compense|lot|gain) (vous attend|a [ée]t[ée] (valid|attribu|r[ée]serv))|vous avez [ée]t[ée] (s[ée]lectionn|choisi|tir[ée])|f[ée]licitations?.{0,40}(gagn|cadeau|s[ée]lectionn)|enqu[êe]te (de satisfaction )?(r[ée]mun[ée]r|r[ée]compens)|package (on hold|waiting|pending)|confirm your (delivery|address|package))/i;

const normalise = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // A•M•A•Z•O•N, U.P.S, U-P-S → amazon, ups
    .replace(/\b(\w)(?:[•·.\-_*]\s?(\w)\b)+/g, (m) => m.replace(/[^a-z0-9]/g, ''))
    .replace(/[®™©'"]/g, ' ')
    .replace(/[-_]+/g, ' ');

/** "umuxmzn5umuxmzn5.fr", "0srkrupm0srkrupm.fr", "lkn0b4vy.fr": names no company picks. */
export function looksRandomDomain(domain: string) {
  const label = domain.split('.').slice(-2, -1)[0] ?? '';
  if (label.length < 6) return false;
  const half = label.length / 2;
  if (label.length % 2 === 0 && label.slice(0, half) === label.slice(half)) return true;
  const vowels = (label.match(/[aeiouy]/g) ?? []).length / label.length;
  const digitsInside = /[a-z]\d+[a-z]/.test(label);
  const consonantRun = /[bcdfghjklmnpqrstvwxz]{5,}/.test(label);
  // "vltinqh", "jwbfnjyu": almost no vowels at all.
  return (digitsInside && vowels < 0.34) || (consonantRun && vowels < 0.25) || (!/\d/.test(label) && vowels < 0.2);
}

export type PhishingVerdict = { phishing: boolean; reason: string | null };

export function detectPhishing(input: { fromName?: string; fromEmail: string; to: string[]; subject: string; text: string }): PhishingVerdict {
  const domain = domainOf(input.fromEmail);
  const display = normalise(`${input.fromName ?? ''} ${input.fromEmail.split('@')[0]}`);
  const subject = normalise(input.subject);
  const head = `${input.subject}\n${input.text.slice(0, 1500)}`;

  for (const [brand, domains] of BRANDS) {
    if (!brand.test(display) && !(brand.test(subject) && LURE.test(head))) continue;
    if (domains.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    const name = display.match(brand)?.[0] ?? subject.match(brand)?.[0];
    return { phishing: true, reason: t('Se fait passer pour {brand} depuis {domain}', { brand: name?.toUpperCase() ?? t('une marque connue'), domain }) };
  }

  // Real companies greet you by name, not by the part of your address before the @.
  const localParts = input.to.map((t) => t.split('@')[0]?.toLowerCase()).filter((l): l is string => Boolean(l && l.length >= 5));
  const greetsByAddress = localParts.some((l) => new RegExp(`(^|\\W)${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,|!|$)`, 'im').test(head));
  const random = looksRandomDomain(domain);
  const lure = LURE.test(head);
  if (greetsByAddress && (lure || random)) return { phishing: true, reason: t('Vous appelle par votre adresse e-mail, typique des campagnes de phishing') };
  if (random && lure) return { phishing: true, reason: t('Domaine d’envoi aléatoire ({domain}) et message typique d’arnaque', { domain }) };
  return { phishing: false, reason: null };
}
