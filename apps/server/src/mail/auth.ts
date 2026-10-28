/**
 * Who really sent a mail, from the `Authentication-Results` header the receiving provider
 * (Gmail, Outlook, Fastmail…) adds after checking SPF, DKIM and DMARC. ZMail does not re-run
 * those checks (the provider saw the original connection; ZMail only sees the stored copy).
 *
 * « Verified » means what Betterbird's DKIM Verifier shows: the domain that signed the mail is the
 * sender's own domain (DMARC pass, or a DKIM pass aligned with the From address).
 */

export type AuthCheck = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy' | 'unknown';

export type AuthVerdict = {
  /** verified: signed by the sender's domain · signed: signed by another domain (a mailing service) ·
   * failed: a check failed (possible spoofing) · none: no result header (internal or old mail). */
  status: 'verified' | 'signed' | 'failed' | 'none';
  spf: AuthCheck;
  dkim: AuthCheck;
  dmarc: AuthCheck;
  /** Domain of the passing DKIM signature, if any. */
  signedBy: string | null;
  /** The envelope sender's domain (smtp.mailfrom), where bounces go. */
  mailFrom: string | null;
  /** The server that checked (authserv-id), e.g. mx.google.com. */
  checkedBy: string | null;
  fromDomain: string;
};

const CHECKS = new Set<AuthCheck>(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy']);

// Public suffixes with two labels: the organizational domain of a.b.co.uk is b.co.uk.
const TWO_LEVEL = /\.(co|com|net|org|gov|edu|ac|ne|or)\.[a-z]{2}$/;

/** The organizational domain (mail.e.fiverr.com → fiverr.com), for DMARC-style alignment. */
export function orgDomain(domain: string) {
  const d = domain.toLowerCase().replace(/\.$/, '');
  const parts = d.split('.');
  return parts.slice(TWO_LEVEL.test(d) ? -3 : -2).join('.');
}

/** Parses one `Authentication-Results` value: `mx.google.com; dkim=pass header.i=@x.com …; spf=…`. */
export function parseAuthResults(raw: string | null) {
  if (!raw) return null;
  const [checkedBy, ...clauses] = raw.split(';').map((s) => s.trim());
  const result = { checkedBy: checkedBy?.split(/\s+/)[0] || null, spf: 'none' as AuthCheck, dkim: 'none' as AuthCheck, dmarc: 'none' as AuthCheck, signedBy: null as string | null, mailFrom: null as string | null, dkimDomains: [] as string[] };
  for (const clause of clauses) {
    const m = clause.match(/^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i);
    if (!m) continue;
    const method = m[1]!.toLowerCase() as 'spf' | 'dkim' | 'dmarc';
    const value = (CHECKS.has(m[2]!.toLowerCase() as AuthCheck) ? m[2]!.toLowerCase() : 'unknown') as AuthCheck;
    if (method === 'dkim') {
      const domain = clause.match(/header\.d=([^\s;]+)/i)?.[1] ?? clause.match(/header\.i=@?([^\s;]+)/i)?.[1]?.replace(/^.*@/, '');
      // Several signatures: one pass is enough; keep the passing domains.
      if (value === 'pass' && domain) result.dkimDomains.push(domain.toLowerCase());
      if (result.dkim !== 'pass') result.dkim = value;
    } else if (method === 'spf') {
      result.spf = value;
      result.mailFrom = clause.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1]?.replace(/^.*@/, '').toLowerCase() ?? null;
    } else {
      result.dmarc = value;
    }
  }
  result.signedBy = result.dkimDomains[0] ?? null;
  return result;
}

export function evaluateAuth(raw: string | null, fromEmail: string): AuthVerdict {
  const fromDomain = (fromEmail.split('@')[1] ?? '').toLowerCase();
  const parsed = parseAuthResults(raw);
  if (!parsed) return { status: 'none', spf: 'none', dkim: 'none', dmarc: 'none', signedBy: null, mailFrom: null, checkedBy: null, fromDomain };
  const org = orgDomain(fromDomain);
  const aligned = parsed.dkimDomains.find((d) => orgDomain(d) === org);
  const failed = parsed.dmarc === 'fail' || (parsed.dkim === 'fail' && !parsed.dkimDomains.length) || (parsed.spf === 'fail' && parsed.dkim !== 'pass');
  const status: AuthVerdict['status'] = parsed.dmarc === 'pass' || aligned ? 'verified' : failed ? 'failed' : parsed.dkim === 'pass' ? 'signed' : 'none';
  return {
    status,
    spf: parsed.spf,
    dkim: parsed.dkim,
    dmarc: parsed.dmarc,
    signedBy: aligned ?? parsed.signedBy,
    mailFrom: parsed.mailFrom,
    checkedBy: parsed.checkedBy,
    fromDomain,
  };
}
