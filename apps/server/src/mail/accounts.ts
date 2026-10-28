import nodemailer from 'nodemailer';
import type { EngineContext } from '../context';
import { AccountWorker, createImapClient } from './imap';
import { json } from '../db';
import { newId } from '../lib/ids';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

export type AccountRecord = {
  id: string;
  email: string;
  /** The name the user gave the account in ZMail; null shows the address. */
  label: string | null;
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
  aliases?: string[];
  syncDays?: number;
};

const ACCOUNT_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444', '#84CC16', '#F97316', '#6366F1'];

type AccountRow = {
  id: string;
  email: string;
  label: string | null;
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

export const smtpTransport = (account: Pick<AccountRecord, 'smtpHost' | 'smtpPort' | 'smtpSecure' | 'username'>, password: string) =>
  nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    requireTLS: !account.smtpSecure && account.smtpPort === 587,
    auth: { user: account.username, pass: password },
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

  worker(id: string): AccountWorker {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(t('Compte introuvable ou arrêté'));
    return worker;
  }

  async test(input: Omit<AccountInput, 'email' | 'name' | 'provider'>) {
    const result = { imap: { ok: false, error: null as string | null }, smtp: { ok: false, error: null as string | null } };
    const imap = createImapClient(input, input.password);
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
      await smtpTransport(input, input.password).verify();
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
      this.ctx.secrets.encrypt(input.password),
      color,
      input.businessId ?? null,
      JSON.stringify(input.aliases ?? []),
      input.syncDays ?? 30,
      Date.now(),
    );
    this.startWorker(this.get(id)!);
    return this.get(id)!;
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
      patch.password ? this.ctx.secrets.encrypt(patch.password) : current.secret,
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
