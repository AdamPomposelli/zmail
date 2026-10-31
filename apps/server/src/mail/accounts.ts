import nodemailer from 'nodemailer';
import type { EngineContext } from '../context';
import { AccountWorker, createImapClient } from './imap';
import type { MailAuth } from './oauth';
import { json } from '../db';
import { newId } from '../lib/ids';
import { log } from '../lib/log';
import { t } from '../lib/i18n';
import { bus } from '../lib/events';
import { FREE_MAIL_DOMAINS, domainOf } from '../lib/address';
import { isIconValue } from '../lib/icons';

export type AccountRecord = {
  id: string;
  email: string;
  /** The name the user gave the account in ZMail; null shows the address. */
  label: string | null;
  /** Sidebar group: business, personal, or null (neither). */
  kind: AccountKind | null;
  /** 'icon:<name>', 'brand:<logo>', 'image:data:…', or null for the provider's logo. */
  icon: string | null;
  name: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  secret: string;
  color: string;
  businessId: string | null;
  aliases: string[];
  signature: string;
  syncDays: number;
  status: string;
  lastError: string | null;
  lastSyncAt: number | null;
  initialSyncDone: boolean;
  createdAt: number;
};

export type AccountKind = 'business' | 'personal';

export type AccountInput = {
  email: string;
  name: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  color?: string;
  businessId?: string | null;
  kind?: AccountKind | null;
  aliases?: string[];
  syncDays?: number;
};

const ACCOUNT_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444', '#84CC16', '#F97316', '#6366F1'];

type AccountRow = {
  id: string;
  email: string;
  label: string | null;
  kind: string | null;
  icon: string | null;
  name: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  username: string;
  secret: string;
  color: string;
  business_id: string | null;
  aliases: string;
  signature: string;
  sync_days: number;
  status: string;
  last_error: string | null;
  last_sync_at: number | null;
  initial_sync_done: number;
  created_at: number;
};

const fromRow = (row: AccountRow): AccountRecord => ({
  id: row.id,
  email: row.email,
  label: row.label?.trim() || null,
  kind: row.kind === 'business' || row.kind === 'personal' ? row.kind : null,
  icon: row.icon,
  name: row.name,
  provider: row.provider,
  imapHost: row.imap_host,
  imapPort: row.imap_port,
  imapSecure: row.imap_secure === 1,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  smtpSecure: row.smtp_secure === 1,
  username: row.username,
  secret: row.secret,
  color: row.color,
  businessId: row.business_id,
  aliases: json<string[]>(row.aliases, []),
  signature: row.signature,
  syncDays: row.sync_days,
  status: row.status,
  lastError: row.last_error,
  lastSyncAt: row.last_sync_at,
  initialSyncDone: row.initial_sync_done === 1,
  createdAt: row.created_at,
});

export const publicAccount = ({ secret: _secret, ...account }: AccountRecord) => account;

export const smtpTransport = (account: Pick<AccountRecord, 'smtpHost' | 'smtpPort' | 'smtpSecure' | 'username'>, auth: string | MailAuth) =>
  nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    requireTLS: !account.smtpSecure && account.smtpPort === 587,
    auth:
      typeof auth === 'string' || 'pass' in auth
        ? { user: account.username, pass: typeof auth === 'string' ? auth : auth.pass }
        : { type: 'OAuth2', user: account.username, accessToken: auth.accessToken },
    tls: { rejectUnauthorized: process.env.ZMAIL_INSECURE_TLS !== '1' },
    connectionTimeout: 20_000,
  });

const readableError = (error: unknown) => {
  const e = error as { responseText?: string; response?: string; code?: string; message?: string; authenticationFailed?: boolean };
  if (e.authenticationFailed || /auth/i.test(e.responseText ?? e.response ?? '')) {
    return t('Identifiants refusés. Vérifiez l\'identifiant et le mot de passe (d\'application).');
  }
  if (e.code === 'ENOTFOUND') return t('Serveur introuvable : vérifiez le nom d’hôte.');
  if (e.code === 'ECONNREFUSED') return t('Connexion refusée : vérifiez le port.');
  if (e.code === 'ETIMEDOUT' || e.code === 'ETIMEOUT') return t('Délai dépassé : serveur injoignable.');
  return e.responseText ?? e.response ?? e.message ?? t('Erreur inconnue');
};

export class AccountManager {
  private workers = new Map<string, AccountWorker>();

  constructor(private readonly ctx: EngineContext) {}

  list(): AccountRecord[] {
    return this.ctx.db.all<AccountRow>('SELECT * FROM accounts ORDER BY created_at').map(fromRow);
  }

  get(id: string): AccountRecord | undefined {
    const row = this.ctx.db.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', id);
    return row ? fromRow(row) : undefined;
  }

  /**
   * Where each mailbox stands: downloading its mail (IMAP sync), then the AI sorting it.
   * `ai.pending` counts the mails not sorted yet; `etaSeconds` comes from the recent pace.
   */
  progress() {
    const counts = new Map(
      this.ctx.db
        .all<{ account_id: string; total: number; pending: number }>(
          `SELECT m.account_id, COUNT(*) AS total, SUM(t.message_id IS NULL) AS pending FROM messages m
           JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
           WHERE mb.special_use IN ('inbox', 'junk', 'archive', 'all') GROUP BY m.account_id`,
        )
        .map((r) => [r.account_id, r]),
    );
    const rate = this.ctx.pipeline.rate();
    return this.list().map((account) => {
      const c = counts.get(account.id);
      const pending = c?.pending ?? 0;
      return {
        id: account.id,
        sync: this.workers.get(account.id)?.progress ?? null,
        ai: { total: c?.total ?? 0, done: (c?.total ?? 0) - pending, pending, etaSeconds: pending && rate ? Math.round(pending / rate) : null },
      };
    });
  }

  worker(id: string): AccountWorker {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(t('Compte introuvable ou arrêté'));
    return worker;
  }

  /** What to store: the password, or the Microsoft sign-in when the wizard passes `oauth:<state>`. */
  private plainSecret(password: string) {
    return password.startsWith('oauth:') ? this.ctx.oauth.secretFor(password.slice(6)) : password;
  }

  async test(input: Omit<AccountInput, 'email' | 'name' | 'provider'>) {
    const result = { imap: { ok: false, error: null as string | null }, smtp: { ok: false, error: null as string | null } };
    // « Se connecter avec Microsoft »: the wizard passes the sign-in it followed, not a password.
    const auth = await this.ctx.oauth.resolve(this.plainSecret(input.password));
    const imap = createImapClient(input, auth);
    imap.on('error', () => undefined);
    try {
      await imap.connect();
      result.imap.ok = true;
    } catch (error) {
      result.imap.error = readableError(error);
    } finally {
      await imap.logout().catch(() => undefined);
    }
    try {
      await smtpTransport(input, auth).verify();
      result.smtp.ok = true;
    } catch (error) {
      result.smtp.error = readableError(error);
    }
    return result;
  }

  /** Tests an existing account with changed settings; an empty password means « the saved one ». */
  async testExisting(id: string, patch: Partial<Pick<AccountInput, 'imapHost' | 'imapPort' | 'imapSecure' | 'smtpHost' | 'smtpPort' | 'smtpSecure' | 'username' | 'password'>>) {
    const current = this.get(id);
    if (!current) throw new Error(t('Compte introuvable'));
    const { password, ...rest } = patch;
    return this.test({ ...current, ...rest, password: password || this.ctx.secrets.decrypt(current.secret) });
  }

  async create(input: AccountInput) {
    const id = newId('acc');
    const color = input.color ?? ACCOUNT_COLORS[this.list().length % ACCOUNT_COLORS.length]!;
    this.ctx.db.run(
      `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
         username, secret, color, business_id, aliases, sync_days, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.email.toLowerCase(),
      input.name,
      input.provider,
      input.imapHost,
      input.imapPort,
      input.imapSecure ? 1 : 0,
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure ? 1 : 0,
      input.username,
      this.ctx.secrets.encrypt(this.plainSecret(input.password)),
      color,
      input.businessId ?? null,
      JSON.stringify(input.aliases ?? []),
      input.syncDays ?? 30,
      Date.now(),
    );
    // Its sidebar group: what the wizard said, else business when linked to one, else what the
    // user said ZMail is for (onboarding).
    const usage = this.ctx.catalog.usage();
    this.setKind(id, input.kind !== undefined ? input.kind : input.businessId || usage === 'business' ? 'business' : 'personal');
    this.startWorker(this.get(id)!);
    void this.autoLogo(id).catch(() => undefined);
    return this.get(id)!;
  }

  /** Moves an account between the sidebar groups; null takes it out of both. */
  setKind(id: string, kind: AccountKind | null) {
    this.ctx.db.run('UPDATE accounts SET kind = ? WHERE id = ?', kind, id);
  }

  /**
   * The logo of a company's own website (apple-touch-icon, then the <link rel=icon> of its home
   * page, then favicon.ico), as a data URL. Fetched from that site only: no third-party service.
   */
  async siteLogo(domain: string): Promise<string | null> {
    const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    const get = async (url: string) => {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) ZMail' } });
      return res.ok ? res : null;
    };
    const asImage = async (url: string) => {
      const res = await get(url).catch(() => null);
      const type = res?.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!res || !/^image\/(png|jpeg|svg\+xml|webp|x-icon|vnd\.microsoft\.icon)$/.test(type)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 280_000) return null;
      return `data:${type};base64,${bytes.toString('base64')}`;
    };
    for (const base of [`https://${host}`, `https://www.${host}`]) {
      const touch = await asImage(`${base}/apple-touch-icon.png`);
      if (touch) return touch;
      const page = await get(base).then((r) => r?.text()).catch(() => null);
      if (page) {
        // The biggest icon the page declares.
        const links = [...page.matchAll(/<link[^>]+rel=["'][^"']*(apple-touch-icon|icon)[^"']*["'][^>]*>/gi)].map((m) => m[0]);
        const sized = links
          .map((tag) => ({ href: /href=["']([^"']+)["']/i.exec(tag)?.[1], size: Number(/sizes=["'](\d+)/i.exec(tag)?.[1] ?? (/apple-touch/i.test(tag) ? 180 : /\.svg/i.test(tag) ? 512 : 32)) }))
          .filter((l): l is { href: string; size: number } => Boolean(l.href))
          .sort((a, b) => b.size - a.size);
        for (const link of sized) {
          const image = await asImage(new URL(link.href, base + '/').toString());
          if (image) return image;
        }
      }
      const favicon = await asImage(`${base}/favicon.ico`);
      if (favicon) return favicon;
    }
    return null;
  }

  /** The account's icon (null: the provider's logo). Images are kept small, as data URLs. */
  setIcon(id: string, icon: string | null) {
    if (icon && !isIconValue(icon, { prefixed: true })) throw new Error(t('Icône invalide'));
    if (icon && icon.length > 400_000) throw new Error(t('Image trop lourde (300 Ko maximum)'));
    this.ctx.db.run('UPDATE accounts SET icon = ? WHERE id = ?', icon, id);
  }

  async update(id: string, patch: Partial<AccountInput> & { signature?: string; label?: string | null }) {
    const current = this.get(id);
    if (!current) throw new Error(t('Compte introuvable'));
    const next = { ...current, ...patch };
    const reconnect =
      patch.password !== undefined ||
      ['imapHost', 'imapPort', 'imapSecure', 'username'].some((k) => k in patch && patch[k as keyof typeof patch] !== current[k as keyof AccountRecord]);
    this.ctx.db.run(
      `UPDATE accounts SET label = ?, name = ?, imap_host = ?, imap_port = ?, imap_secure = ?, smtp_host = ?, smtp_port = ?, smtp_secure = ?,
         username = ?, secret = ?, color = ?, business_id = ?, aliases = ?, sync_days = ?, signature = ? WHERE id = ?`,
      next.label?.trim() || null,
      next.name,
      next.imapHost,
      next.imapPort,
      next.imapSecure ? 1 : 0,
      next.smtpHost,
      next.smtpPort,
      next.smtpSecure ? 1 : 0,
      next.username,
      patch.password ? this.ctx.secrets.encrypt(this.plainSecret(patch.password)) : current.secret,
      next.color,
      next.businessId ?? null,
      JSON.stringify(next.aliases ?? []),
      next.syncDays,
      next.signature ?? '',
      id,
    );
    const updated = this.get(id)!;
    if (reconnect) {
      await this.workers.get(id)?.stop();
      this.startWorker(updated);
    } else {
      const worker = this.workers.get(id);
      if (worker) worker.account = updated;
    }
    return updated;
  }

  async remove(id: string) {
    await this.workers.get(id)?.stop();
    this.workers.delete(id);
    this.ctx.db.run('DELETE FROM accounts WHERE id = ?', id);
    this.ctx.db.run('DELETE FROM messages_fts WHERE message_pk NOT IN (SELECT id FROM messages)');
  }

  startAll() {
    for (const account of this.list()) this.startWorker(account);
    // Accounts added before company logos existed get theirs once (a few seconds after startup).
    setTimeout(() => void Promise.all(this.list().map((a) => this.autoLogo(a.id))).catch(() => undefined), 5000).unref?.();
  }

  /**
   * A mailbox on a company's own domain (contact@brilisse.com, not @gmail.com) wears that
   * company's logo, fetched from its website, unless the user picked an icon. Tried once per
   * account; quietly does nothing if the site has no usable logo.
   */
  async autoLogo(id: string) {
    const account = this.get(id);
    const key = `logo:auto:${id}`;
    if (!account || account.icon || this.ctx.db.getSetting<boolean>(key, false)) return null;
    const domain = domainOf(account.email);
    if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null;
    this.ctx.db.setSetting(key, true);
    const logo = await this.siteLogo(domain).catch(() => null);
    // The user may have picked an icon meanwhile: never overwrite it.
    if (!logo || this.get(id)?.icon) return null;
    this.setIcon(id, `image:${logo}`);
    bus.emitEvent({ type: 'sync', accountId: id, status: account.status });
    return logo;
  }

  private startWorker(account: AccountRecord) {
    const worker = new AccountWorker(this.ctx, account);
    this.workers.set(account.id, worker);
    worker.start().catch((error) => log.error('accounts', account.email, (error as Error).message));
  }

  async resync(id?: string) {
    const targets = id ? [this.worker(id)] : [...this.workers.values()];
    await Promise.allSettled(targets.map((w) => w.sync({ refreshFolders: true })));
  }

  async stopAll() {
    await Promise.allSettled([...this.workers.values()].map((w) => w.stop()));
    this.workers.clear();
  }
}
