import { createHash, randomBytes } from 'node:crypto';
import { json, type Database } from '../db';
import { newId } from '../lib/ids';
import { t } from '../lib/i18n';

export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
};

type Row = {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
};

const KEY_PREFIX = 'zm_live_';
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const toKey = (row: Row): ApiKey => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: json<Scope[]>(row.scopes, []).filter((s) => (SCOPES as readonly string[]).includes(s)),
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

/** Developer API keys: only a SHA-256 hash is kept, the full key is returned once at creation. */
export class ApiKeys {
  constructor(private readonly db: Database) {}

  list(): ApiKey[] {
    return this.db.all<Row>('SELECT * FROM api_keys ORDER BY created_at DESC').map(toKey);
  }

  create(name: string, scopes: Scope[]): { key: string; apiKey: ApiKey } {
    const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const id = newId('key');
    // `read` is implied by `write`: an agent that can act must be able to see what it acts on.
    const granted = [...new Set<Scope>(['read', ...scopes])];
    this.db.run(
      'INSERT INTO api_keys (id, name, prefix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name.trim() || t('Clé sans nom'),
      key.slice(0, KEY_PREFIX.length + 4),
      hash(key),
      JSON.stringify(granted),
      Date.now(),
    );
    return { key, apiKey: toKey(this.db.get<Row>('SELECT * FROM api_keys WHERE id = ?', id)!) };
  }

  revoke(id: string) {
    return this.db.run('DELETE FROM api_keys WHERE id = ?', id).changes > 0;
  }

  /** The key behind a bearer token, or null. Records the last use (at most once a minute). */
  verify(token: string | null | undefined): ApiKey | null {
    if (!token || !token.startsWith(KEY_PREFIX)) return null;
    const row = this.db.get<Row>('SELECT * FROM api_keys WHERE hash = ?', hash(token));
    if (!row) return null;
    const now = Date.now();
    if (!row.last_used_at || now - row.last_used_at > 60_000) {
      this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now, row.id);
      row.last_used_at = now;
    }
    return toKey(row);
  }
}

export const bearerToken = (header: string | null | undefined) =>
  header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null;
