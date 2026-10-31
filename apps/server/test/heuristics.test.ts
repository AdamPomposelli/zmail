import { describe, expect, it } from 'vitest';
import { classifyHeuristically, extractUnsubscribe, type MailFeatures } from '../src/ai/heuristics';
import { findOtp, validateOtp } from '../src/ai/otp';

const mail = (over: Partial<MailFeatures>): MailFeatures => ({
  subject: '',
  text: '',
  html: '',
  from: { email: 'someone@example.test' },
  to: [{ email: 'me@example.test' }],
  cc: [],
  listUnsubscribe: null,
  listUnsubscribePost: null,
  listId: null,
  precedence: null,
  autoSubmitted: null,
  spamHeader: null,
  attachments: [],
  ...over,
});

describe('OTP extraction', () => {
  it.each([
    ['Votre code de vérification est : 482913. Il expire dans 10 minutes.', '482913'],
    ['Your code: 715 264', '715264'],
    ['Use this one-time passcode to sign in: 8841', '8841'],
    ['Code de connexion : A7K29Q', 'A7K29Q'],
    ['Votre code est 093125 — commande n° 104820 du 12/10/2026', '093125'],
  ])('finds the code in %j', (text, code) => {
    expect(findOtp(text)).toBe(code);
  });

  it.each([
    'Votre facture de 2026 est disponible : 64,80 €',
    'Utilisez le code promo AUTOMNE40 pour -40 %',
    'Merci pour votre commande',
  ])('finds nothing in %j', (text) => {
    expect(classifyHeuristically(mail({ subject: 'Info', text })).otp).toBeNull();
  });

  it('only trusts a model answer that appears in the mail', () => {
    expect(validateOtp('482913', 'code : 482 913')).toBe('482913');
    expect(validateOtp('999999', 'code : 482913')).toBeNull();
    expect(validateOtp(42, 'code : 42')).toBeNull();
  });
});

describe('heuristic classification', () => {
  it('flags a chargeback as urgent', () => {
    const r = classifyHeuristically(mail({ subject: 'Litige ouvert : chargeback de 249,00 €', text: 'Un client a contesté un paiement.' }));
    expect(r.tags).toContain('chargeback');
    expect(r.priority).toBe(3);
  });

  it('detects a business opportunity from a real person', () => {
    const r = classifyHeuristically(
      mail({ from: { email: 'claire@atelier.test' }, subject: 'Demande de devis — application mobile', text: 'Budget 40 000 €. Pourriez-vous nous envoyer un devis ?' }),
    );
    expect(r.opportunity).toBe(true);
    expect(r.tags).toEqual(expect.arrayContaining(['opportunity', 'important']));
    expect(r.priority).toBe(2);
  });

  it('treats a bulk promo as low-priority marketing with an unsubscribe target', () => {
    const r = classifyHeuristically(
      mail({
        from: { email: 'offres@shop.test' },
        subject: '-40 % sur tout le site : derniers jours !',
        text: 'Soldes : code promo AUTOMNE40',
        listUnsubscribe: '<https://shop.test/u/1>, <mailto:leave@shop.test>',
        listUnsubscribePost: 'List-Unsubscribe=One-Click',
      }),
    );
    expect(r.tags).toContain('marketing');
    expect(r.newsletter).toBe(true);
    expect(r.priority).toBe(0);
    expect(r.otp).toBeNull();
    expect(r.unsubscribe).toEqual({ oneClick: 'https://shop.test/u/1', mailto: 'mailto:leave@shop.test' });
  });

  it('marks scams and server-flagged mail as spam', () => {
    expect(classifyHeuristically(mail({ subject: 'Vous avez gagné un iPhone', text: 'Réclamez votre prix' })).spam).toBe(true);
    const flagged = classifyHeuristically(mail({ subject: 'Hello', spamHeader: 'YES' }));
    expect(flagged.spam && flagged.spamCertain).toBe(true);
  });

  it('does not mistake words like « reculent » for a receipt (reçu)', () => {
    const r = classifyHeuristically(mail({ from: { email: 'digest@news.test' }, subject: 'DevPulse #212', text: 'React 20 en bêta, et pourquoi les frameworks CSS reculent.', listId: '<news.test>' }));
    expect(r.tags).not.toContain('finance');
    expect(classifyHeuristically(mail({ subject: 'Votre reçu de paiement', text: 'Merci.' })).tags).toContain('finance');
  });

  it('puts a service about to suspend an account first, never as a mere notification', () => {
    // Seen in production: Scalapay, sent by a robot, sorted « Autres notifications » / low.
    const kyc = classifyHeuristically(mail({ from: { name: 'Scalapay', email: 'notification@t.scalapay.com' }, subject: '🚨 La suspension de votre compte approche', text: 'Pour répondre aux exigences de la réglementation anti-blanchiment, vous devez compléter la vérification d’identité.', authResults: 'mx.test; dkim=pass header.d=t.scalapay.com; dmarc=pass header.from=t.scalapay.com' }));
    expect(kyc).toMatchObject({ priority: 2, spam: false, accountAlert: true });
    expect(kyc.tags).toContain('important');
    expect(kyc.tags).not.toContain('notification');
    // A short delay makes it urgent.
    expect(classifyHeuristically(mail({ from: { email: 'no-reply@banq.test' }, subject: 'Your account will be restricted within 48 hours', text: 'Upload a proof of address.', authResults: 'mx.test; dmarc=pass header.from=banq.test' })).priority).toBe(3);
    // The same words from a domain that did not sign the mail, with « click here »: a scam.
    const phish = classifyHeuristically(mail({ from: { email: 'support@acc-verif.test' }, subject: 'Your account will be suspended', text: 'Click here to verify your identity: http://acc-verif.test/login' }));
    expect(phish).toMatchObject({ spam: true, priority: 0, accountAlert: false });
  });

  it('extracts an unsubscribe link from the body when the header is missing', () => {
    const info = extractUnsubscribe({ listUnsubscribe: null, listUnsubscribePost: null, text: '', html: '<p>Bye <a href="https://n.test/out?u=1&amp;x=2">Se désinscrire</a></p>' });
    expect(info).toEqual({ http: 'https://n.test/out?u=1&x=2', fromBody: true });
  });

  it('finds unsubscribe links however they are written', () => {
    const none = { listUnsubscribe: null, listUnsubscribePost: null, text: '' };
    // IFTTT: the RFC 8058 one-click header wins over the body.
    expect(extractUnsubscribe({ ...none, listUnsubscribe: '<https://ifttt.com/unsubscribe?k=1>', listUnsubscribePost: 'List-Unsubscribe=One-Click', html: '<a href="https://ifttt.com/x">Unsubscribe</a>' })).toEqual({ oneClick: 'https://ifttt.com/unsubscribe?k=1' });
    // « Privacy policy | Unsubscribe | Update preferences »: the real unsubscribe link, not the first one.
    expect(extractUnsubscribe({ ...none, html: "<a href='https://s.test/privacy'>Privacy policy</a> | <a href='https://s.test/prefs'>Update preferences</a> | <a href=https://s.test/u/9>Unsubscribe</a>" })?.http).toBe('https://s.test/u/9');
    // « To unsubscribe, click here », and nested tags in the link.
    expect(extractUnsubscribe({ ...none, html: '<p>To unsubscribe from these emails, <a href="https://s.test/r?id=4"><span><b>click here</b></span></a>.</p>' })?.http).toBe('https://s.test/r?id=4');
    // Plain-text mail.
    expect(extractUnsubscribe({ ...none, html: '', text: 'Merci de votre lecture.\n\nPour vous désinscrire : https://lettre.test/stop?u=7\n' })?.http).toBe('https://lettre.test/stop?u=7');
    // Only a mailto.
    expect(extractUnsubscribe({ ...none, html: '<a href="mailto:leave@list.test?subject=unsubscribe">Unsubscribe</a>' })).toEqual({ mailto: 'mailto:leave@list.test?subject=unsubscribe', fromBody: true });
    // A personal mail with ordinary links has none.
    expect(extractUnsubscribe({ ...none, html: '<p>Voici <a href="https://drive.test/doc">le doc</a> et <a href="https://site.test/account/preferences">mes réglages</a>.</p>' })).toBeNull();
  });

  it('treats a mail with an unsubscribe link in its body as a mailing, even without the headers', () => {
    const r = classifyHeuristically(mail({ from: { name: 'Atelier', email: 'hello@atelier.test' }, subject: 'Nos nouveautés de novembre', text: 'Découvrez la collection.', html: '<p>Découvrez la collection.</p><a href="https://atelier.test/unsubscribe?u=2">Se désabonner</a>' }));
    expect(r.unsubscribe?.http).toBe('https://atelier.test/unsubscribe?u=2');
    expect(r.bulk).toBe(true);
  });

  it('does not file a newsletter or a product announcement that talks about payments as an invoice', () => {
    const news = classifyHeuristically(mail({ from: { name: 'Meydey', email: 'contact@meydey.com' }, subject: 'Une annonce IA par jour. Laquelle compte ?', text: 'Ce qu’un client te paie vraiment… les paiements de ton activité.', listUnsubscribe: '<https://meydey.com/u>' }));
    expect(news.tags).not.toContain('finance');
    const launch = classifyHeuristically(mail({ from: { name: 'Moreta', email: 'no-reply@mail.moreta.io' }, subject: 'Now on Moreta: send money to friends', text: 'With Moreta Send, you can also transfer money to bank accounts.', listUnsubscribe: '<https://moreta.io/u>' }));
    expect(launch.tags).not.toContain('finance');
  });

  it('still files a receipt from a no-reply address, thanks to its amount', () => {
    const receipt = classifyHeuristically(mail({ from: { name: 'Grab', email: 'no-reply@grab.com' }, subject: 'Your Grab E-Receipt', text: 'Thanks for riding. Total paid: 12,40 €', listUnsubscribe: '<https://grab.com/u>' }));
    expect(receipt.tags).toContain('finance');
    const payment = classifyHeuristically(mail({ from: { name: 'Stripe', email: 'notifications@stripe.com' }, subject: 'Your weekly summary', text: 'Payment received. Amount charged: $49.00', listUnsubscribe: '<https://stripe.com/u>' }));
    expect(payment.tags).toContain('finance');
  });
});
