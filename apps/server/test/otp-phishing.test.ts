import { describe, expect, it } from 'vitest';
import { findOtp, validateOtp } from '../src/ai/otp';
import { detectPhishing, looksRandomDomain } from '../src/ai/phishing';
import { classifyHeuristically, type MailFeatures } from '../src/ai/heuristics';
import { mergeTriage } from '../src/ai/merge';

/** Cases taken from real mis-sorted mail (anonymised). */
const mail = (over: Partial<MailFeatures> & { subject: string; text: string }): MailFeatures => ({
  html: '',
  from: { email: 'noreply@example.test' },
  to: [{ email: 'jdupont2003@gmail.com' }],
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

describe('a code is only an OTP when the mail presents it as one', () => {
  it('ignores ids inside links', () => {
    const text = 'Your Meta Account is here\n[https://scontent.xx.fbcdn.net/img.png?oh=00_AQ&oe=6AE58424]\nkeep your info secure, log in';
    expect(validateOtp('6AE58424', text)).toBeNull();
    expect(findOtp(text)).toBeNull();
  });

  it('ignores postal codes in addresses', () => {
    expect(validateOtp('75001', 'Billed to: Adam, 112 Rue Rambuteau, PARIS, PARIS, 75001,\nSecurity tip: never share your password.')).toBeNull();
    expect(validateOtp('75008', 'Utilise le code BIENVENUE.\nVoiceCheap · 60 rue François 1er, 75008 Paris, France')).toBeNull();
    expect(validateOtp('94104', 'Click the secure link to sign in.\nAnthropic, PBC\n548 Market St, PMB 90375, San Francisco, CA 94104')).toBeNull();
    expect(validateOtp('10400', 'Phone No.\n+33 749022639\nPost Code\n10400\nAccommodation')).toBeNull();
  });

  it('ignores tracking, order and file numbers', () => {
    expect(validateOtp('29194773', 'Vous avez 1 colis en attente.\nCode de suivi 29194773\nRecevez votre colis')).toBeNull();
    expect(validateOtp('2F2003', 'search?email=x&maHoSo=E26&ngaySinh=26%2F03%2F2003]. Thank you!')).toBeNull();
  });

  it('keeps real codes', () => {
    expect(validateOtp('4238', 'Ne pas partager : 4238\nVous aurez besoin de ce code pour finaliser votre connexion.')).toBe('4238');
    expect(validateOtp('482913', 'Votre code de vérification est : 482 913')).toBe('482913');
    expect(validateOtp('A7K29Q', 'Votre code de connexion : A7K29Q. Valable 5 minutes.')).toBe('A7K29Q');
    expect(findOtp('Use this one-time code to finish signing in: 715 264')).toBe('715264');
  });
});

describe('phishing', () => {
  it('spots generated sender domains', () => {
    for (const d of ['umuxmzn5umuxmzn5.fr', '0srkrupm0srkrupm.fr', 'lkn0b4vy.fr', 'jx92cl5bjx92cl5b.ca', 'ksfdl0hu.us']) expect(looksRandomDomain(d), d).toBe(true);
    for (const d of ['gmail.com', 'namecheap.com', 'mail.anthropic.com', 'email.meta.com', 'nordlys.studio', 'maisonvelours.shop', 'immigration.gov.vn']) expect(looksRandomDomain(d), d).toBe(false);
  });

  it('flags brand impersonation, including obfuscated names', () => {
    const v = (fromName: string, fromEmail: string, subject = 'Votre colis', text = '') => detectPhishing({ fromName, fromEmail, to: ['jdupont2003@gmail.com'], subject, text }).phishing;
    expect(v('DPD', 'sbgfj2hh@sbgfj2hh.fr')).toBe(true);
    expect(v('A•M•A•Z•O•N', 'pnkfongi@axofonsfk.fr')).toBe(true);
    expect(v("'UPS--express'", 'sprkokrx@ntlvxhpei.fr')).toBe(true);
    expect(v('ups.france®', 'noreply-x@irhcjvntirhcjvnt.fr')).toBe(true);
    // The real ones are fine.
    expect(v('DPD France', 'notification@dpd.fr')).toBe(false);
    expect(v('Amazon.fr', 'commandes@amazon.fr')).toBe(false);
    expect(v('Meta', 'noreply@email.meta.com', 'We updated you to a Meta Account')).toBe(false);
  });

  it('flags a lure that calls you by your address', () => {
    expect(detectPhishing({ fromName: 'suivre votre colis', fromEmail: 'a@b.fr', to: ['jdupont2003@gmail.com'], subject: 'jdupont2003, Vous avez (1) colis en attente de livraison', text: '' }).phishing).toBe(true);
  });

  it('flags a fake Lidl gift sent from a random domain', () => {
    const lure = { fromName: 'Air-Fryer', fromEmail: 'jwbfnjyu@vltinqh.us', to: ['jdupont2003@gmail.com'], subject: 'jdupont2003 !! 🎁 Récupérez votre cadeau Lidl', text: 'Bonjour jdupont2003,\nVotre récompense a été validée. Confirmez votre adresse.' };
    expect(looksRandomDomain('vltinqh.us')).toBe(true);
    expect(detectPhishing(lure)).toMatchObject({ phishing: true });
    expect(detectPhishing(lure).reason).toMatch(/LIDL/);
    expect(detectPhishing({ ...lure, fromName: 'Lidl France', fromEmail: 'newsletter@news.lidl.fr', subject: 'Les offres de la semaine', text: 'Bonjour Jean,' }).phishing).toBe(false);
  });
});

describe('final verdict', () => {
  const known = new Set(['security', 'delivery', 'notification', 'marketing', 'important']);

  it('drops the code and the categories of a phishing mail, even when the model believed it', () => {
    const features = mail({ from: { name: 'DPD', email: 'sbgfj2hh@sbgfj2hh.fr' }, subject: 'Votre colis est prêt pour la livraison', text: 'Vous avez 1 colis en attente de livraison.\nCode de suivi 29194773' });
    const merged = mergeTriage({ heuristic: classifyHeuristically(features), model: { tags: ['delivery', 'security'], priority: 'high', spam: false, otp: '29194773' }, text: `${features.subject}\n${features.text}`, knownTags: known });
    expect(merged).toMatchObject({ spam: true, otp: null, priority: 0, tags: [] });
  });

  it('treats what the provider filed as spam as spam', () => {
    const features = mail({ subject: 'Ne pas partager : 4238', text: 'Votre code de connexion : 4238' });
    const merged = mergeTriage({ heuristic: classifyHeuristically(features), model: { priority: 'high', spam: false, otp: '4238' }, text: `${features.subject}\n${features.text}`, knownTags: known, folder: 'junk' });
    expect(merged).toMatchObject({ spam: true, otp: null, priority: 0 });
  });

  it('rejects a model OTP taken from a link', () => {
    const features = mail({ from: { name: 'Meta', email: 'noreply@email.meta.com' }, subject: 'We updated you to a Meta Account', text: '[https://x.fbcdn.net/i.png?oe=6AE58424]\nlog in and keep your info secure' });
    const merged = mergeTriage({ heuristic: classifyHeuristically(features), model: { priority: 'high', spam: false, otp: '6AE58424', tags: ['security'] }, text: `${features.subject}\n${features.text}`, knownTags: known });
    expect(merged.otp).toBeNull();
  });
});
