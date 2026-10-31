import { ImapFlow, type ListResponse } from 'imapflow';
import type { MailAuth } from './oauth';
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
  /** The user's own folders and Gmail labels: their latest mails, however old (see syncMailbox). */
  custom: 200,
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

/** `auth`: a password, or a Microsoft access token (XOAUTH2) for Outlook / Microsoft 365. */
export function createImapClient(account: Pick<AccountRecord, 'imapHost' | 'imapPort' | 'imapSecure' | 'username'>, auth: string | MailAuth) {
  const login = typeof auth === 'string' ? { pass: auth } : auth;
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, ...login },
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
  /** Where the current sync stands, for Settings → Accounts. */
  progress: { folder: string; folderIndex: number; folders: number; fetched: number; toFetch: number } | null = null;

  constructor(
    private readonly ctx: EngineContext,
    public account: AccountRecord,
  ) {}

  /** The password, or a fresh access token for an account signed in with Microsoft (read from the database: tokens get renewed). */
  private async auth() {
    const row = this.ctx.db.get<{ secret: string }>('SELECT secret FROM accounts WHERE id = ?', this.account.id);
    return this.ctx.oauth.resolve(this.ctx.secrets.decrypt(row?.secret ?? this.account.secret), this.account.id);
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
      const client = createImapClient(this.account, await this.auth());
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
        const client = createImapClient(this.account, await this.auth());
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

  /** A new folder's id comes from its path, unless a folder moved away from that path still has it. */
  private mailboxIdFor(path: string) {
    const known = this.ctx.db.get<{ id: string }>('SELECT id FROM mailboxes WHERE account_id = ? AND path = ?', this.account.id, path);
    if (known) return known.id;
    const id = hashId('mb', this.account.id, path);
    return this.ctx.db.get('SELECT 1 FROM mailboxes WHERE id = ?', id) ? hashId('mb', this.account.id, path, String(Date.now())) : id;
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
        this.mailboxIdFor(box.path),
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
    // Folders first synced by an older ZMail only got their last 30 days (often nothing): scan
    // them again once; already stored messages are skipped by uid.
    const rescanKey = `folders:rescan:${this.account.id}`;
    if (!this.ctx.db.getSetting<boolean>(rescanKey, false)) {
      this.ctx.db.run('UPDATE mailboxes SET last_uid = 0 WHERE account_id = ? AND special_use IS NULL', this.account.id);
      this.ctx.db.setSetting(rescanKey, true);
    }
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
        for (const [index, box] of boxes.entries()) {
          this.progress = { folder: box.special_use ?? box.path.split(box.delimiter ?? "/").at(-1) ?? box.path, folderIndex: index + 1, folders: boxes.length, fetched: 0, toFetch: 0 };
          const got = await this.syncMailbox(client, box, initial);
          created.push(...got);
          // The AI starts on each folder as soon as it is downloaded, not after the whole account.
          if (got.length) await this.ctx.onMessagesStored(got);
        }
      });
      this.progress = null;
      if (initial && !options.only) {
        this.ctx.db.run('UPDATE accounts SET initial_sync_done = 1 WHERE id = ?', this.account.id);
        this.account = { ...this.account, initialSyncDone: true };
      }
      this.setStatus('idle');
    } catch (error) {
      this.progress = null;
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
          // Standard folders: the recent window (sync days). The user's own folders and labels are
          // filed on purpose, often long ago (an accounting label whose last mail is months old):
          // their latest mails come whatever their date, or the folder would stay empty forever.
          const window = box.special_use ? { since: new Date(Date.now() - this.account.syncDays * 86400_000) } : { all: true };
          const found = (await client.search(window, { uid: true })) || [];
          uids = found.slice(-SYNCED[box.special_use ?? 'custom']);
        } else {
          const found = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || [];
          uids = found.filter((uid) => uid > lastUid);
        }
      }

      const isNewMail = !initialAccount && box.uidvalidity !== null && ['inbox', 'junk'].includes(box.special_use!);
      created.push(...(await this.fetchInto(client, box, uids, uidvalidity, isNewMail)));
      if (uids.length) lastUid = Math.max(lastUid, ...uids);

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

  /** Downloads these messages of a folder and stores them (raw copy kept for details/attachments). */
  private async fetchInto(client: ImapFlow, box: MailboxRow, uids: number[], uidvalidity: string, isNew: boolean) {
    const created: string[] = [];
    const rawDir = join(this.ctx.dataDir, 'raw', this.account.id);
    await mkdir(rawDir, { recursive: true });
    if (this.progress) this.progress.toFetch += uids.length;
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
            isNew,
          },
          uidvalidity,
        );
        if (this.progress) this.progress.fetched++;
        if (result.inserted) {
          await writeFile(join(rawDir, `${result.id}.eml`), msg.source);
          created.push(result.id);
        }
      }
    }
    return created;
  }

  /**
   * The next older page of a folder, straight from the server (scrolling to the bottom of a folder
   * past what the sync keeps). `more` says whether the server still has older mails.
   */
  async loadOlder(mailboxId: string, count = 100): Promise<{ fetched: number; more: boolean }> {
    const box = this.mailboxes().find((m) => m.id === mailboxId);
    if (!box) return { fetched: 0, more: false };
    const oldest = this.ctx.db.get<{ uid: number | null }>('SELECT MIN(uid) AS uid FROM messages WHERE mailbox_id = ? AND uid > 0', mailboxId)?.uid ?? null;
    const result = await this.run(async (client) => {
      const lock = await client.getMailboxLock(box.path, READ_ONLY);
      try {
        const status = client.mailbox;
        if (!status || status === true || status.exists === 0) return { created: [] as string[], more: false };
        const uidvalidity = String(status.uidValidity);
        const range = oldest ? `1:${oldest - 1}` : '1:*';
        const older = oldest === 1 ? [] : (await client.search({ uid: range }, { uid: true })) || [];
        const page = older.slice(-count);
        const created = await this.fetchInto(client, box, page, uidvalidity, false);
        return { created, more: older.length > page.length };
      } finally {
        lock.release();
      }
    });
    if (result.created.length) {
      bus.emitEvent({ type: 'mail', reason: 'new', threadIds: [] });
      await this.ctx.onMessagesStored(result.created);
    }
    return { fetched: result.created.length, more: result.more };
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

  /**
   * Moves one of the user's folders under another one (or to the top level) on the server: an
   * IMAP RENAME, so every other mail app sees the new place. Its subfolders follow; the local
   * copy keeps its mails and ids, only the paths change.
   */
  async moveFolder(mailboxId: string, parentId: string | null) {
    const box = this.userFolder(mailboxId);
    const parent = parentId ? this.mailboxes().find((m) => m.id === parentId) : null;
    if (parentId && !parent) throw new Error(t('Dossier introuvable'));
    const delimiter = box.delimiter ?? parent?.delimiter ?? '/';
    const leaf = box.path.split(delimiter).at(-1) ?? box.path;
    if (parent && this.inside(box, parent.path)) throw new Error(t('Un dossier ne peut pas aller dans un de ses sous-dossiers.'));
    return this.relocate(box, parent ? `${parent.path}${delimiter}${leaf}` : leaf);
  }

  /** Renames one of the user's folders on the server (IMAP RENAME); it stays where it is. */
  async renameFolder(mailboxId: string, name: string) {
    const box = this.userFolder(mailboxId);
    const delimiter = box.delimiter ?? '/';
    const clean = this.folderName(name, delimiter);
    const parts = box.path.split(delimiter);
    return this.relocate(box, [...parts.slice(0, -1), clean].join(delimiter));
  }

  /** Creates a folder on the server (IMAP CREATE), at the top level or inside another one. */
  async createFolder(parentId: string | null, name: string) {
    const parent = parentId ? this.mailboxes().find((m) => m.id === parentId) : null;
    if (parentId && !parent) throw new Error(t('Dossier introuvable'));
    const delimiter = parent?.delimiter ?? this.mailboxes().find((m) => m.delimiter)?.delimiter ?? '/';
    const clean = this.folderName(name, delimiter);
    return this.run(async (client) => {
      const wanted = parent ? `${parent.path}${delimiter}${clean}` : clean;
      if (this.mailboxes().some((m) => m.path.toLowerCase() === wanted.toLowerCase())) throw new Error(t('Un dossier « {name} » existe déjà à cet endroit.', { name: clean }));
      const created = (await client.mailboxCreate(wanted)).path || wanted;
      await client.mailboxSubscribe(created).catch(() => undefined);
      await this.refreshFolders(client);
      const row = this.mailboxes().find((m) => m.path === created);
      if (!row) throw new Error(t('Le serveur n’a pas créé le dossier.'));
      return { id: row.id, path: created };
    });
  }

  /**
   * Deletes one of the user's folders and its subfolders on the server (IMAP DELETE). Their mails
   * go to the Trash first unless `toTrash` is false: an IMAP DELETE erases them for good.
   */
  async deleteFolder(mailboxId: string, { toTrash = true }: { toTrash?: boolean } = {}) {
    const box = this.userFolder(mailboxId);
    const doomed = this.mailboxes()
      .filter((m) => this.inside(box, m.path))
      .sort((x, y) => y.path.length - x.path.length);
    const trash = toTrash ? await this.ensureMailbox('trash', 'Trash') : null;
    // 1. Their mails to the Trash. 2. The folders, deepest first, from a connection that has none
    // of them open: some servers cut the connection on a DELETE right after working in that folder.
    let moved = 0;
    if (trash) {
      moved = await this.run(async (client) => {
        let count = 0;
        for (const folder of doomed) {
          const lock = await client.getMailboxLock(folder.path);
          try {
            const exists = typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
            if (exists) {
              await client.messageMove('1:*', trash.path);
              count += exists;
            }
          } finally {
            lock.release();
          }
        }
        if (client.mailbox) await client.mailboxClose().catch(() => undefined);
        return count;
      });
    }
    // On its own short-lived connection: some servers (GreenMail) cut the one that has just read
    // or flagged the folder when it is deleted.
    const remove = async () => {
      const client = createImapClient(this.account, await this.auth());
      client.on('error', (error: Error) => log.warn('imap', this.account.email, 'delete error', error.message));
      await client.connect();
      try {
        const present = new Set((await client.list()).map((m) => m.path));
        for (const folder of doomed) {
          if (!present.has(folder.path)) continue;
          // Out of the subscriptions first, so no client keeps showing a ghost folder.
          await client.mailboxUnsubscribe(folder.path).catch(() => undefined);
          await client.mailboxDelete(folder.path);
        }
        const left = new Set((await client.list()).map((m) => m.path));
        if (doomed.some((f) => left.has(f.path))) throw new Error(t('Le serveur n’a pas supprimé le dossier.'));
      } finally {
        await client.logout().catch(() => undefined);
      }
    };
    await remove();
    // Their mails leave the local copy too; those moved to the Trash come back with its next sync.
    await this.run((client) => this.refreshFolders(client));
    if (trash && moved) await this.syncFolder(trash.id).catch(() => undefined);
    return { deleted: doomed.length, moved };
  }

  /** Marks every mail of a folder as read, on the server and here. */
  async markFolderRead(mailboxId: string) {
    const box = this.mailboxes().find((m) => m.id === mailboxId);
    if (!box) throw new Error(t('Dossier introuvable'));
    await this.run(async (client) => {
      const lock = await client.getMailboxLock(box.path);
      try {
        if (typeof client.mailbox === 'object' && client.mailbox.exists) await client.messageFlagsAdd('1:*', ['\\Seen']);
      } finally {
        lock.release();
      }
      // Leave the folder: a connection parked in it keeps some servers from deleting it later.
      await client.mailboxClose().catch(() => undefined);
    });
    const threads = this.ctx.db.all<{ thread_id: string }>('SELECT DISTINCT thread_id FROM messages WHERE mailbox_id = ? AND unread = 1', box.id).map((r) => r.thread_id);
    this.ctx.db.run('UPDATE messages SET unread = 0 WHERE mailbox_id = ?', box.id);
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: threads });
    return { threads: threads.length };
  }

  /** A folder the user made (not Inbox, Sent, Trash…), or an error. */
  private userFolder(mailboxId: string) {
    const box = this.mailboxes().find((m) => m.id === mailboxId);
    if (!box) throw new Error(t('Dossier introuvable'));
    if (box.special_use) throw new Error(t('Les dossiers système (Boîte de réception, Envoyés…) ne se modifient pas.'));
    return box;
  }

  private inside(box: MailboxRow, path: string) {
    return path === box.path || path.startsWith(`${box.path}${box.delimiter ?? '/'}`);
  }

  private folderName(name: string, delimiter: string) {
    const clean = name.trim();
    if (!clean) throw new Error(t('Le nom du dossier est vide.'));
    if (clean.includes(delimiter)) throw new Error(t('Le nom ne peut pas contenir « {delimiter} ».', { delimiter }));
    return clean;
  }

  /** Moves a folder (and its subfolders) to `wanted` with an IMAP RENAME; ids and mails stay. */
  private relocate(box: MailboxRow, wanted: string) {
    const delimiter = box.delimiter ?? '/';
    const leaf = wanted.split(delimiter).at(-1) ?? wanted;
    return this.run(async (client) => {
      if (wanted === box.path) return { path: box.path };
      // Renaming only the case (« spam » → « Spam ») is the same folder, not a clash.
      if (this.mailboxes().some((m) => m.id !== box.id && m.path.toLowerCase() === wanted.toLowerCase())) throw new Error(t('Un dossier « {name} » existe déjà à cet endroit.', { name: leaf }));
      if (typeof client.mailbox === 'object' && this.inside(box, client.mailbox.path)) await client.mailboxClose().catch(() => undefined);
      // imapflow adds the server's prefix (« INBOX. ») when it needs one: its answer is the real path.
      const target = (await client.mailboxRename(box.path, wanted)).newPath || wanted;
      // Some servers answer OK without moving anything: only what the server now lists counts.
      if (!(await client.list()).some((m) => m.path === target)) throw new Error(t('Le serveur n’a pas déplacé le dossier : il est resté à sa place.'));
      this.ctx.db.tx(() => {
        for (const m of this.mailboxes().filter((x) => this.inside(box, x.path))) {
          const path = target + m.path.slice(box.path.length);
          this.ctx.db.run('UPDATE mailboxes SET path = ?, name = ? WHERE id = ?', path, path.split(delimiter).at(-1) ?? path, m.id);
        }
      });
      await this.refreshFolders(client);
      return { path: target };
    });
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
