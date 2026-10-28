export type Address = { name?: string; email: string };

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

/** Webmail domains say nothing about the sender's organisation. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.fr', 'orange.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'wanadoo.fr', 'aol.com',
  'mailbox.org', 'fastmail.com', 'zoho.com',
]);

export const parseAddressList = (value: string | null | undefined): Address[] => {
  if (!value) return [];
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => {
      const match = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
      if (match) return { name: match[1]!.trim() || undefined, email: match[2]!.trim().toLowerCase() };
      const email = part.trim().toLowerCase();
      return email.includes('@') ? { email } : null;
    })
    .filter((a): a is Address => a !== null);
};
