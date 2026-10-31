import { DatabaseSync } from 'node:sqlite';

export type SQLInputValue = null | number | bigint | string | Uint8Array;
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Local SQLite store. Every schema change is a new entry in MIGRATIONS (never edit an
 * applied one); `user_version` records how many have run.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    emoji TEXT,
    description TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE business_matchers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL,          -- account | address | domain | sender
    value TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
    smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
    username TEXT NOT NULL,
    secret TEXT NOT NULL,
    color TEXT NOT NULL,
    business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    signature TEXT NOT NULL DEFAULT '',
    sync_days INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT,
    last_sync_at INTEGER,
    initial_sync_done INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE mailboxes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    special_use TEXT,
    uidvalidity TEXT,
    last_uid INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_id, path)
  );

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    uid INTEGER NOT NULL,
    message_id TEXT,
    thread_id TEXT NOT NULL,
    in_reply_to TEXT,
    refs TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    from_email TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    reply_to TEXT,
    delivered_to TEXT,
    date INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    text_body TEXT NOT NULL DEFAULT '',
    html_body TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    unread INTEGER NOT NULL DEFAULT 1,
    starred INTEGER NOT NULL DEFAULT 0,
    list_unsubscribe TEXT,
    list_unsubscribe_post TEXT,
    list_id TEXT,
    precedence TEXT,
    auto_submitted TEXT,
    spam_header TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    is_new INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(account_id, mailbox_id, uid)
  );
  CREATE INDEX messages_thread ON messages(thread_id);
  CREATE INDEX messages_msgid ON messages(account_id, message_id);
  CREATE INDEX messages_date ON messages(date DESC);
  CREATE INDEX messages_from ON messages(from_email);

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_pk UNINDEXED, subject, sender, body, tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE triage (
    message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    business_id TEXT,
    priority INTEGER NOT NULL DEFAULT 1,   -- 0 low, 1 normal, 2 high, 3 urgent
    tags TEXT NOT NULL DEFAULT '[]',
    spam INTEGER NOT NULL DEFAULT 0,
    spam_reason TEXT,
    otp TEXT,
    opportunity INTEGER NOT NULL DEFAULT 0,
    opportunity_reason TEXT,
    newsletter INTEGER NOT NULL DEFAULT 0,
    unsubscribe TEXT,
    summary TEXT NOT NULL DEFAULT '',
    engine TEXT NOT NULL,
    user_override INTEGER NOT NULL DEFAULT 0,
    rules_applied TEXT NOT NULL DEFAULT '[]',
    processed_at INTEGER NOT NULL
  );
  CREATE INDEX triage_business ON triage(business_id);

  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,           -- system | custom
    icon TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,         -- user | suggestion | agent
    conditions TEXT NOT NULL,
    actions TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    last_hit_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    thread_id TEXT,
    message_id TEXT,
    account_id TEXT,
    from_email TEXT,
    from_domain TEXT,
    business_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    list_id TEXT,
    newsletter INTEGER NOT NULL DEFAULT 0,
    subject TEXT,
    meta TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX action_log_at ON action_log(at DESC);
  CREATE INDEX action_log_from ON action_log(from_email, action);

  CREATE TABLE suggestions (
    id TEXT PRIMARY KEY,
    pattern_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,         -- pending | accepted | dismissed | snoozed
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    rule TEXT NOT NULL,
    evidence INTEGER NOT NULL,
    matching INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    snooze_until INTEGER
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    thread_id TEXT,
    otp TEXT,
    delivered TEXT NOT NULL DEFAULT 'none',
    read INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE unsubscribes (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    account_id TEXT,
    from_email TEXT NOT NULL,
    list_id TEXT,
    method TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  `,
  `
  CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    capability TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    cost_usd REAL
  );
  CREATE INDEX ai_usage_at ON ai_usage(at DESC);
  `,
  `
  ALTER TABLE mailboxes ADD COLUMN delimiter TEXT;
  `,
  `
  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,        -- first characters of the key, shown to recognise it
    hash TEXT NOT NULL UNIQUE,   -- SHA-256 of the full key; the key itself is never stored
    scopes TEXT NOT NULL,        -- JSON array: read | write
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  `,
  `
  -- A name the user gives an account (« Pro », « Perso »…); the address shows when it is empty.
  ALTER TABLE accounts ADD COLUMN label TEXT;
  -- Built-in categories the user removed: hidden everywhere and no longer assigned, restorable.
  ALTER TABLE tags ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- The receiving provider's SPF/DKIM/DMARC verdict (Authentication-Results), see mail/auth.ts.
  ALTER TABLE messages ADD COLUMN auth_results TEXT;
  `,
  `
  -- The sidebar groups accounts: 'business', 'personal', or NULL (neither). Existing accounts:
  -- business when linked to a business, personal otherwise.
  ALTER TABLE accounts ADD COLUMN kind TEXT;
  UPDATE accounts SET kind = CASE WHEN business_id IS NOT NULL THEN 'business' ELSE 'personal' END;
  -- The account's own icon: 'icon:<name>', 'brand:<logo>' or 'image:data:…' (a logo the user picked).
  ALTER TABLE accounts ADD COLUMN icon TEXT;
  `,
  `
  -- Spaces (as in Arc): each has its own inbox, favourites, subscriptions and categories.
  -- A mail's space is resolved when read (mail/spaces.ts): the conversation moved by hand,
  -- else its business's space, else its account's, else « main ».
  CREATE TABLE spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  INSERT INTO spaces (id, name, icon, color, sort, created_at) VALUES ('main', 'Principal', NULL, '#6366F1', 0, 0);
  CREATE TABLE space_overrides (
    thread_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    source TEXT NOT NULL,          -- user | rule | agent
    at INTEGER NOT NULL
  );
  ALTER TABLE accounts ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;
  ALTER TABLE businesses ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;
  -- A category made inside a space belongs to it; NULL: shown in every space.
  ALTER TABLE tags ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE;
  `,
  `
  -- « Masquer de la boîte de réception » : a category's mails skip the inbox (of their space)
  -- and are only seen in that category, like Gmail's « Skip the inbox ».
  ALTER TABLE tags ADD COLUMN hide_from_inbox INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- What surrounded each gesture, for the behaviour analysis (rules/behavior.ts): was the mail
  -- opened first, how long was it read, how old was it, where was it, what had the AI said.
  ALTER TABLE action_log ADD COLUMN opened INTEGER;        -- 1 opened in ZMail before the gesture, 0 not
  ALTER TABLE action_log ADD COLUMN was_unread INTEGER;    -- still unread at that moment
  ALTER TABLE action_log ADD COLUMN dwell_ms INTEGER;      -- « view »: that reading; others: all readings before
  ALTER TABLE action_log ADD COLUMN age_ms INTEGER;        -- time since the mail arrived
  ALTER TABLE action_log ADD COLUMN mailbox TEXT;          -- inbox, archive, junk… or the folder's path
  ALTER TABLE action_log ADD COLUMN space_id TEXT;
  ALTER TABLE action_log ADD COLUMN priority INTEGER;      -- the AI's priority then (0–3)
  ALTER TABLE action_log ADD COLUMN batch INTEGER NOT NULL DEFAULT 1; -- conversations in the same gesture
  CREATE INDEX action_log_thread ON action_log(thread_id, action);
  `,
];

export type Row = Record<string, unknown>;

export class Database {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
    const { user_version: version } = this.get<{ user_version: number }>('PRAGMA user_version')!;
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[i]!);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }

  /** Re-entrant transaction: nested calls join the outer one. */
  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  /** Called after any setting is written (the engine reacts to UI preferences, e.g. the Dock badge). */
  onSettingChanged?: (key: string) => void;

  setSetting(key: string, value: unknown) {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
    this.onSettingChanged?.(key);
  }
}

export const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
