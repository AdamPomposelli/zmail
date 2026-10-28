import { ImapFlow, type ListResponse } from 'imapflow';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineContext } from '../context';
import type { AccountRecord } from './accounts';
import { hashId } from '../lib/ids';
import { parseEmail } from './parse';
import { bus } from '../lib/events';
import { log } from '../lib/log';
import { LABEL_ROOT } from './server-sync';
import { t } from '../lib/i18n';

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all';

/** Folders mirrored locally, with how many recent messages the first sync imports. */
const SYNCED: Record<SpecialUse | 'custom', number> = {
  inbox: 500,
  junk: 150,
  sent: 200,
  archive: 200,
  all: 200,
  trash: 100,
  drafts: 50,
  /** The user's own folders and Gmail labels. */
  custom: 100,
};

/** ZMail's mirror of its tags on the server: already shown as tags, not as folders. */
export const isZmailFolder = (path: string, delimiter: string | null) => path === LABEL_ROOT || path.startsWith(`${LABEL_ROOT}${delimiter ?? '/'}`);

const NAME_HINTS: [SpecialUse, RegExp][] = [
  ['sent', /^(sent|sent items|sent messages|sent mail|envoy[ée]s|[ée]l[ée]ments envoy[ée]s|messages envoy[ée]s)$/i],
  ['trash', /^(trash|deleted|deleted items|deleted messages|corbeille|bin|papierkorb)$/i],
  ['junk', /^(junk|spam|junk e-?mail|courrier ind[ée]sirable|ind[ée]sirables|bulk mail)$/i],
  ['drafts', /^(drafts|brouillons|entw[üu]rfe)$/i],
  ['archive', /^(archive|archives)$/i],
];

/** "ZMail/Facture & paiement" → "ZMail_Facture_paiement": IMAP keywords are plain ASCII atoms. */
export const keywordOf = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9$_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

export function specialUseOf(box: Pick<ListResponse, 'path' | 'name' | 'specialUse'>): SpecialUse | null {
  if (box.path.toUpperCase() === 'INBOX') return 'inbox';
  const flag = box.specialUse?.replace('\\', '').toLowerCase();
  if (flag && ['sent', 'drafts', 'trash', 'junk', 'archive', 'all'].includes(flag)) return flag as SpecialUse;
  const leaf = box.name || box.path.split(/[/.]/).pop() || '';
  return NAME_HINTS.find(([, re]) => re.test(leaf))?.[0] ?? null;
}

export function createImapClient(account: Pick<AccountRecord, 'imapHost' | 'imapPort' | 'imapSecure' | 'username'>, password: string) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: password },
    logger: false,
    tls: { rejectUnauthorized: process.env.ZMAIL_INSECURE_TLS !== '1' },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30 * 60_000,
    maxIdleTime: 4 * 60_000,
  });
}

// imapflow reads `readOnly`; its published typings spell it `readonly`.
const READ_ONLY = { readOnly: true } as unknown as { readonly?: boolean };

type MailboxRow = { id: string; path: string; special_use: SpecialUse | null; delimiter: string | null; uidvalidity: string | null; last_uid: number; synced: number };

/**
 * One connected account: an IDLE connection on INBOX for push, plus an operations connection
 * used (serially) for syncing folders and mirroring user actions to the server.
 */
export class AccountWorker {
  private idleClient: ImapFlow | null = null;
  private opClient: ImapFlow | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private timers: NodeJS.Timeout[] = [];
  private reconnectDelay = 5_000;
  private stopped = false;
  private syncing: Promise<void> | null = null;
  private pendingInboxSync = false;

  constructor(
    private readonly ctx: EngineContext,
    public account: AccountRecord,
  ) {}

  private get password() {
    return this.ctx.secrets.decrypt(this.account.secret);
  }

  private setStatus(status: string, error: string | null = null) {
    this.ctx.db.run(
      'UPDATE accounts SET status = ?, last_error = ?, last_sync_at = CASE WHEN ? = \'idle\' THEN ? ELSE last_sync_at END WHERE id = ?',
      status,
      error,
      status,
      Date.now(),
      this.account.id,
    );
    bus.emitEvent({ type: 'sync', accountId: this.account.id, status, error });
  }

  async start() {
    this.stopped = false;
    await this.sync({ refreshFolders: true }).catch(() => undefined);
    void this.startIdle();
    // IDLE already pushes new mail: the minute poll only runs while IDLE is down (it reconnects).
    this.timers.push(setInterval(() => void (this.idleClient?.usable ? undefined : this.sync({ only: ['inbox'] }).catch(() => undefined)), 60_000));
    this.timers.push(setInterval(() => void this.sync({ refreshFolders: true }).catch(() => undefined), 5 * 60_000));
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    await Promise.allSettled([this.idleClient?.logout(), this.opClient?.logout()]);
    this.idleClient = null;
    this.opClient = null;
  }

  private async startIdle() {
    if (this.stopped) return;
    try {
      const client = createImapClient(this.account, this.password);
      client.on('error', (error: Error) => log.warn('imap', this.account.email, 'idle error', error.message));
      client.on('exists', () => this.scheduleInboxSync());
      client.on('expunge', () => this.scheduleInboxSync());
      client.on('flags', () => this.scheduleInboxSync());
      client.on('close', () => {
        if (this.stopped) return;
        this.idleClient = null;
        setTimeout(() => void this.startIdle(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60_000);
      });
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      this.idleClient = client;
      this.reconnectDelay = 5_000;
      log.info('imap', this.account.email, 'IDLE on INBOX');
      // imapflow only auto-IDLEs after 15 s of silence; keep the push channel open from the start.
      void (async () => {
        while (!this.stopped && this.idleClient === client && client.usable) {
          await client.idle().catch(() => undefined);
        }
      })();
    } catch (error) {
      log.warn('imap', this.account.email, 'cannot start IDLE', (error as Error).message);
      setTimeout(() => void this.startIdle(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60_000);
    }
  }

  private scheduleInboxSync() {
    if (this.pendingInboxSync) return;
    this.pendingInboxSync = true;
    setTimeout(() => {
      this.pendingInboxSync = false;
      void this.sync({ only: ['inbox'] }).catch(() => undefined);
    }, 400);
  }

  /** Runs `fn` on the operations connection, one at a time, reconnecting when needed. */
  run<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      if (!this.opClient?.usable) {
        await this.opClient?.logout().catch(() => undefined);
        const client = createImapClient(this.account, this.password);
        client.on('error', (error: Error) => log.warn('imap', this.account.email, 'op error', error.message));
        await client.connect();
        this.opClient = client;
      }
      return fn(this.opClient);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  mailboxes(): MailboxRow[] {
    return this.ctx.db.all<MailboxRow>('SELECT * FROM mailboxes WHERE account_id = ?', this.account.id);
  }

  mailboxFor(special: SpecialUse): MailboxRow | undefined {
    return this.mailboxes().find((m) => m.special_use === special);
  }

  async refreshFolders(client: ImapFlow) {
    const boxes = await client.list();
    const seen = new Set<SpecialUse>();
    const present = new Set<string>();
    for (const box of boxes) {
      if (box.flags?.has('\\Noselect') || box.flags?.has('\\NonExistent')) continue;
      present.add(box.path);
      let special = specialUseOf(box);
      if (special && seen.has(special)) special = null;
      if (special) seen.add(special);
      this.ctx.db.run(
        `INSERT INTO mailboxes (id, account_id, path, name, special_use, delimiter) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, path) DO UPDATE SET name = excluded.name, special_use = excluded.special_use, delimiter = excluded.delimiter`,
        hashId('mb', this.account.id, box.path),
        this.account.id,
        box.path,
        box.name,
        special,
        box.delimiter ?? null,
      );
    }
    // Folders deleted or renamed on the server disappear here too.
    for (const stale of this.mailboxes().filter((m) => !present.has(m.path) && !m.special_use)) {
      this.ctx.db.run('DELETE FROM messages WHERE mailbox_id = ?', stale.id);
      this.ctx.db.run('DELETE FROM mailboxes WHERE id = ?', stale.id);
    }
    bus.emitEvent({ type: 'mail', reason: 'folders', threadIds: [] });
  }

  async sync(options: { refreshFolders?: boolean; only?: SpecialUse[] } = {}) {
    if (this.syncing) {
      await this.syncing;
      if (!options.refreshFolders && !options.only) return;
    }
    this.syncing = this.doSync(options).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** Fetches one folder now (opening a folder in the sidebar), without waiting for the 5-minute sync. */
  async syncFolder(mailboxId: string) {
    const box = this.mailboxes().find((m) => m.id === mailboxId);
    if (!box) return;
    const created = await this.run((client) => this.syncMailbox(client, box, false));
    if (created.length) await this.ctx.onMessagesStored(created);
  }

  private async doSync(options: { refreshFolders?: boolean; only?: SpecialUse[] }) {
    const initial = !this.account.initialSyncDone;
    this.setStatus('syncing');
    try {
      const created: string[] = [];
      await this.run(async (client) => {
        if (options.refreshFolders || this.mailboxes().length === 0) await this.refreshFolders(client);
        // Standard folders first (inbox leading), then the user's folders and labels, so a Gmail
        // label usually finds its message already triaged in INBOX or All Mail.
        const rank = (m: MailboxRow) => (m.special_use === 'inbox' ? 0 : m.special_use ? 1 : 2);
        const boxes = this.mailboxes()
          .filter((m) => (m.special_use ? SYNCED[m.special_use] !== undefined : !isZmailFolder(m.path, m.delimiter)))
          .filter((m) => !options.only || (m.special_use !== null && options.only.includes(m.special_use)))
          .sort((a, b) => rank(a) - rank(b));
        for (const box of boxes) created.push(...(await this.syncMailbox(client, box, initial)));
      });
      if (initial && !options.only) {
        this.ctx.db.run('UPDATE accounts SET initial_sync_done = 1 WHERE id = ?', this.account.id);
        this.account = { ...this.account, initialSyncDone: true };
      }
      this.setStatus('idle');
      if (created.length > 0) await this.ctx.onMessagesStored(created);
    } catch (error) {
      const message = (error as { responseText?: string }).responseText ?? (error as Error).message;
      log.error('imap', this.account.email, 'sync failed', message);
      this.setStatus('error', message);
      throw error;
    }
  }

  private async syncMailbox(client: ImapFlow, box: MailboxRow, initialAccount: boolean): Promise<string[]> {
    const lock = await client.getMailboxLock(box.path, READ_ONLY);
    const created: string[] = [];
    try {
      const status = client.mailbox;
      if (!status || status === true) return created;
      const uidvalidity = String(status.uidValidity);
      let lastUid = box.last_uid;
      if (box.uidvalidity && box.uidvalidity !== uidvalidity) {
        this.ctx.db.run('DELETE FROM messages WHERE mailbox_id = ?', box.id);
        lastUid = 0;
      }

      let uids: number[] = [];
      if (status.exists > 0) {
        if (lastUid === 0) {
          const since = new Date(Date.now() - this.account.syncDays * 86400_000);
          const found = (await client.search({ since }, { uid: true })) || [];
          uids = found.slice(-SYNCED[box.special_use ?? 'custom']);
        } else {
          const found = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [];
          uids = found.filter((uid) => uid > lastUid);
        }
      }

      const isNewMail = !initialAccount && box.uidvalidity !== null && ['inbox', 'junk'].includes(box.special_use!);
      const rawDir = join(this.ctx.dataDir, 'raw', this.account.id);
      await mkdir(rawDir, { recursive: true });

      for (let i = 0; i < uids.length; i += 50) {
        const batch = uids.slice(i, i + 50);
        for await (const msg of client.fetch(batch, { uid: true, flags: true, source: true, size: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await parseEmail(msg.source);
          const result = this.ctx.store.upsert(
            {
              ...parsed,
              accountId: this.account.id,
              mailboxId: box.id,
              uid: msg.uid,
              unread: !msg.flags?.has('\\Seen'),
              starred: Boolean(msg.flags?.has('\\Flagged')),
              size: msg.size ?? msg.source.length,
              isNew: isNewMail,
            },
            uidvalidity,
          );
          if (result.inserted) {
            await writeFile(join(rawDir, `${result.id}.eml`), msg.source);
            created.push(result.id);
          }
          lastUid = Math.max(lastUid, msg.uid);
        }
      }

      await this.reconcileFlags(client, box, uidvalidity);
      this.ctx.db.run(
        'UPDATE mailboxes SET uidvalidity = ?, last_uid = ?, synced = 1 WHERE id = ?',
        uidvalidity,
        Math.max(lastUid, box.uidvalidity === uidvalidity ? box.last_uid : 0),
        box.id,
      );
      if (created.length) bus.emitEvent({ type: 'mail', reason: 'new', threadIds: [] });
      return created;
    } finally {
      lock.release();
    }
  }

  /** Mirrors flag changes and expunges made by other clients for locally known messages. */
  private async reconcileFlags(client: ImapFlow, box: MailboxRow, uidvalidity: string) {
    const local = this.ctx.db.all<{ id: string; uid: number; unread: number; starred: number }>(
      'SELECT id, uid, unread, starred FROM messages WHERE mailbox_id = ?',
      box.id,
    );
    if (local.length === 0) return;
    const remote = new Map<number, Set<string>>();
    for await (const msg of client.fetch(local.map((m) => m.uid), { uid: true, flags: true }, { uid: true })) {
      remote.set(msg.uid, msg.flags ?? new Set());
    }
    const gone: string[] = [];
    let changed = false;
    for (const row of local) {
      const flags = remote.get(row.uid);
      if (!flags) {
        gone.push(row.id);
        continue;
      }
      const unread = flags.has('\\Seen') ? 0 : 1;
      const starred = flags.has('\\Flagged') ? 1 : 0;
      if (unread !== row.unread || starred !== row.starred) {
        this.ctx.db.run('UPDATE messages SET unread = ?, starred = ? WHERE id = ?', unread, starred, row.id);
        changed = true;
      }
    }
    if (gone.length) this.ctx.store.deleteMessages(gone);
    if (gone.length || changed) bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: [] });
    void uidvalidity;
  }

  async ensureMailbox(special: SpecialUse, fallbackName: string): Promise<MailboxRow> {
    const existing = this.mailboxFor(special) ?? (special === 'archive' ? this.mailboxFor('all') : undefined);
    if (existing) return existing;
    await this.run(async (client) => {
      await client.mailboxCreate(fallbackName).catch(() => undefined);
      await this.refreshFolders(client);
    });
    const created = this.mailboxes().find((m) => m.path === fallbackName);
    if (!created) throw new Error(t('Impossible de créer le dossier {name}', { name: fallbackName }));
    this.ctx.db.run('UPDATE mailboxes SET special_use = ? WHERE id = ?', special, created.id);
    return { ...created, special_use: special };
  }

  /** Moves messages to another folder; returns old uid → new uid when the server reports it (UIDPLUS). */
  async move(messages: { mailboxId: string; uid: number }[], target: MailboxRow) {
    const byBox = Map.groupBy(messages, (m) => m.mailboxId);
    const moved = new Map<string, Map<number, number>>();
    await this.run(async (client) => {
      for (const [mailboxId, items] of byBox) {
        if (mailboxId === target.id) continue;
        const box = this.mailboxes().find((m) => m.id === mailboxId);
        if (!box) continue;
        const lock = await client.getMailboxLock(box.path);
        try {
          const result = await client.messageMove(items.map((i) => i.uid), target.path, { uid: true });
          moved.set(mailboxId, result && result.uidMap ? result.uidMap : new Map());
        } finally {
          lock.release();
        }
      }
    });
    return moved;
  }

  async setFlags(messages: { mailboxId: string; uid: number }[], flag: '\\Seen' | '\\Flagged', on: boolean) {
    const byBox = Map.groupBy(messages, (m) => m.mailboxId);
    await this.run(async (client) => {
      for (const [mailboxId, items] of byBox) {
        const box = this.mailboxes().find((m) => m.id === mailboxId);
        if (!box) continue;
        const lock = await client.getMailboxLock(box.path);
        try {
          const uids = items.map((i) => i.uid);
          if (on) await client.messageFlagsAdd(uids, [flag], { uid: true });
          else await client.messageFlagsRemove(uids, [flag], { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  }

  /**
   * Gmail: real labels (X-GM-LABELS, created on the fly). Elsewhere: IMAP keywords, which
   * Thunderbird and most webmails show as tags, when the folder accepts custom keywords.
   * Returns false when the server can store neither.
   */
  async setLabels(messages: { mailboxId: string; uid: number }[], add: string[], remove: string[]) {
    const byBox = Map.groupBy(messages, (m) => m.mailboxId);
    let stored = false;
    await this.run(async (client) => {
      const gmail = client.capabilities.has('X-GM-EXT-1');
      for (const [mailboxId, items] of byBox) {
        const box = this.mailboxes().find((m) => m.id === mailboxId);
        if (!box) continue;
        const lock = await client.getMailboxLock(box.path);
        try {
          const uids = items.map((i) => i.uid);
          const permanent = (typeof client.mailbox === 'object' && client.mailbox.permanentFlags) || new Set<string>();
          if (!gmail && !permanent.has('\\*')) continue;
          const names = (list: string[]) => (gmail ? list : list.map(keywordOf));
          const options = { uid: true, useLabels: gmail };
          if (add.length) await client.messageFlagsAdd(uids, names(add), options);
          if (remove.length) await client.messageFlagsRemove(uids, names(remove), options);
          stored = true;
        } finally {
          lock.release();
        }
      }
    });
    return stored;
  }

  async expunge(messages: { mailboxId: string; uid: number }[]) {
    const byBox = Map.groupBy(messages, (m) => m.mailboxId);
    await this.run(async (client) => {
      for (const [mailboxId, items] of byBox) {
        const box = this.mailboxes().find((m) => m.id === mailboxId);
        if (!box) continue;
        const lock = await client.getMailboxLock(box.path);
        try {
          await client.messageDelete(items.map((i) => i.uid), { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  }

  async append(special: SpecialUse, raw: Buffer, flags: string[]) {
    const box = this.mailboxFor(special);
    if (!box) return;
    await this.run((client) => client.append(box.path, raw, flags));
  }

  async source(messageId: string): Promise<Buffer | null> {
    const file = join(this.ctx.dataDir, 'raw', this.account.id, `${messageId}.eml`);
    try {
      return await readFile(file);
    } catch {
      const row = this.ctx.store.message(messageId);
      if (!row) return null;
      return this.run(async (client) => {
        const lock = await client.getMailboxLock(row.path, READ_ONLY);
        try {
          const msg = await client.fetchOne(String(row.uid), { source: true }, { uid: true });
          return msg ? msg.source ?? null : null;
        } finally {
          lock.release();
        }
      });
    }
  }
}
