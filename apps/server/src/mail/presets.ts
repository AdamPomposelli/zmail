import { resolveMx } from 'node:dns/promises';
import { domainOf } from '../lib/address';
import { t } from '../lib/i18n';

export type ServerSettings = { host: string; port: number; secure: boolean };

export type Preset = {
  id: string;
  name: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  /** Shown next to the password field. */
  help: string;
  helpUrl?: string;
  /** Account usernames are the bare local part instead of the full address. */
  localPartUsername?: boolean;
};

export const PRESETS: Preset[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    get help() {
      return t('Utilisez un mot de passe d\'application Google (validation en 2 étapes requise).');
    },
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    get help() {
      return t('Mot de passe d\'application Google ; l\'IMAP doit être autorisé par l\'admin du domaine.');
    },
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'mailbox-org',
    name: 'mailbox.org',
    imap: { host: 'imap.mailbox.org', port: 993, secure: true },
    smtp: { host: 'smtp.mailbox.org', port: 465, secure: true },
    get help() {
      return t('Mot de passe du compte mailbox.org (ou mot de passe d’application si la 2FA est active).');
    },
  },
  {
    id: 'namecheap',
    name: 'Namecheap Private Email',
    imap: { host: 'mail.privateemail.com', port: 993, secure: true },
    smtp: { host: 'mail.privateemail.com', port: 465, secure: true },
    get help() {
      return t('Mot de passe de la boîte Private Email.');
    },
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    get help() {
      return t('Mot de passe d\'application Apple (appleid.apple.com).');
    },
    helpUrl: 'https://appleid.apple.com/account/manage',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    get help() {
      return t('Mot de passe d\'application Microsoft (l\'authentification basique doit être autorisée).');
    },
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    imap: { host: 'imap.fastmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.fastmail.com', port: 465, secure: true },
    get help() {
      return t('Mot de passe d\'application Fastmail.');
    },
  },
  {
    id: 'ovh',
    name: 'OVHcloud',
    imap: { host: 'ssl0.ovh.net', port: 993, secure: true },
    smtp: { host: 'ssl0.ovh.net', port: 465, secure: true },
    get help() {
      return t('Mot de passe de la boîte OVH.');
    },
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    imap: { host: 'imap.zoho.eu', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.eu', port: 465, secure: true },
    get help() {
      return t('Mot de passe d\'application Zoho.');
    },
  },
  {
    id: 'custom',
    get name() {
      return t('IMAP personnalisé (VPS, self-hosted…)');
    },
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    get help() {
      return t('Serveurs de votre hébergeur (Mailcow, Mail-in-a-Box, Stalwart, Dovecot…).');
    },
  },
];

const BY_DOMAIN: Record<string, string> = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'mailbox.org': 'mailbox-org',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'mac.com': 'icloud',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'hotmail.fr': 'outlook',
  'live.com': 'outlook',
  'live.fr': 'outlook',
  'fastmail.com': 'fastmail',
  'zohomail.eu': 'zoho',
};

const BY_MX: [RegExp, string][] = [
  [/google(mail)?\.com\.?$|aspmx\.l\.google/i, 'google-workspace'],
  [/privateemail\.com\.?$|registrar-servers\.com\.?$/i, 'namecheap'],
  [/mailbox\.org\.?$/i, 'mailbox-org'],
  [/outlook\.com\.?$|protection\.outlook/i, 'outlook'],
  [/ovh\.net\.?$/i, 'ovh'],
  [/zoho\.(eu|com)\.?$/i, 'zoho'],
  [/messagingengine\.com\.?$/i, 'fastmail'],
  [/icloud\.com\.?$/i, 'icloud'],
];

/** Best guess of the provider for an address: known domains first, then the domain's MX. */
export async function detectPreset(email: string): Promise<{ preset: Preset; imapHost?: string; smtpHost?: string }> {
  const domain = domainOf(email);
  const byDomain = BY_DOMAIN[domain];
  if (byDomain) return { preset: PRESETS.find((p) => p.id === byDomain)! };
  try {
    const mx = await resolveMx(domain);
    for (const record of mx.sort((a, b) => a.priority - b.priority)) {
      const hit = BY_MX.find(([re]) => re.test(record.exchange));
      if (hit) return { preset: PRESETS.find((p) => p.id === hit[1])! };
    }
  } catch {
    // unknown domain or offline: fall back to a guess
  }
  return {
    preset: PRESETS.find((p) => p.id === 'custom')!,
    imapHost: domain ? `mail.${domain}` : undefined,
    smtpHost: domain ? `mail.${domain}` : undefined,
  };
}
