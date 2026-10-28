import { describe, expect, it } from 'vitest';
import { evaluateAuth, orgDomain, parseAuthResults } from '../src/mail/auth';
import { classifyHeuristically } from '../src/ai/heuristics';

/** Sender authentication from the provider's Authentication-Results (as Gmail writes it). */
const GMAIL_PASS =
  'mx.google.com; dkim=pass header.i=@e.fiverr.com header.s=s1 header.b=abc; spf=pass (google.com: domain of bounce@e.fiverr.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=bounce@e.fiverr.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=fiverr.com';
const VIA_SENDGRID = 'mx.google.com; dkim=pass header.i=@sendgrid.net header.s=smtpapi; spf=pass smtp.mailfrom=bounces@sendgrid.net; dmarc=none header.from=petit-shop.fr';
const SPOOF = 'mx.google.com; spf=fail (google.com: domain of x@paypal.com does not designate 6.6.6.6) smtp.mailfrom=x@paypal.com; dmarc=fail (p=REJECT) header.from=paypal.com';

describe('sender authentication', () => {
  it('reads SPF, DKIM, DMARC and who checked', () => {
    expect(parseAuthResults(GMAIL_PASS)).toMatchObject({ checkedBy: 'mx.google.com', spf: 'pass', dkim: 'pass', dmarc: 'pass', signedBy: 'e.fiverr.com', mailFrom: 'e.fiverr.com' });
  });

  it('verified when the sender’s own domain signed', () => {
    expect(evaluateAuth(GMAIL_PASS, 'noreply@e.fiverr.com')).toMatchObject({ status: 'verified', signedBy: 'e.fiverr.com' });
  });

  it('only « signed » when a mailing service signed for someone else', () => {
    expect(evaluateAuth(VIA_SENDGRID, 'news@petit-shop.fr')).toMatchObject({ status: 'signed', signedBy: 'sendgrid.net' });
  });

  it('failed when DMARC fails (spoofed « official » sender)', () => {
    expect(evaluateAuth(SPOOF, 'service@paypal.com').status).toBe('failed');
  });

  it('none without a result header (sent mail, internal mail)', () => {
    expect(evaluateAuth(null, 'me@x.com').status).toBe('none');
  });

  it('aligns subdomains on the organizational domain', () => {
    expect(orgDomain('mail.e.fiverr.com')).toBe('fiverr.com');
    expect(orgDomain('news.shop.co.uk')).toBe('shop.co.uk');
  });

  it('sends a mail that fails DMARC to spam, with the reason', () => {
    // A plain-looking mail: only the failed authentication gives it away.
    const base = { subject: 'Votre relevé du mois', text: 'Bonjour, votre relevé est disponible dans votre espace.', html: '', from: { name: 'Ma Banque', email: 'releves@ma-banque.fr' }, to: [{ email: 'me@x.com' }], cc: [], listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, attachments: [] };
    const spoofed = classifyHeuristically({ ...base, authResults: SPOOF.replace(/paypal/g, 'ma-banque') });
    expect(spoofed.spam).toBe(true);
    expect(spoofed.spamReason).toMatch(/non authentifié/);
    expect(classifyHeuristically({ ...base, authResults: GMAIL_PASS.replace(/e\.fiverr\.com|fiverr\.com/g, 'ma-banque.fr') }).spam).toBe(false);
  });
});
