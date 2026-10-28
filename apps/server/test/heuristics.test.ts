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

  it('extracts an unsubscribe link from the body when the header is missing', () => {
    const info = extractUnsubscribe({ listUnsubscribe: null, listUnsubscribePost: null, text: '', html: '<p>Bye <a href="https://n.test/out?u=1&amp;x=2">Se désinscrire</a></p>' });
    expect(info).toEqual({ http: 'https://n.test/out?u=1&x=2', fromBody: true });
  });
});
