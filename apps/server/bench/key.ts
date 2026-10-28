import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Secrets } from '../src/lib/secrets';

/** The key the user saved in ZMail for `baseUrl`: decrypted in memory with the Keychain master key, never printed. */
export function keyFromApp(baseUrl: string, label = baseUrl): string {
  const dataDir = join(homedir(), 'Library', 'Application Support', 'ZMail');
  const master = execFileSync('security', ['find-generic-password', '-s', 'com.zippy.zmail', '-a', 'master-key', '-w']).toString().trim();
  const db = new DatabaseSync(join(dataDir, 'zmail.db'), { readOnly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get() as { value: string } | undefined;
  const providers = (JSON.parse(row?.value ?? '{}').providers ?? []) as { baseUrl?: string; apiKey?: string }[];
  const provider = providers.find((p) => p.baseUrl?.startsWith(baseUrl) && p.apiKey);
  if (!provider?.apiKey) throw new Error(`Aucune clé ${label} enregistrée dans ZMail.`);
  // ZMail.app stores the raw 32 bytes; `security -w` prints binary items as hex.
  const base64 = /^[0-9a-f]{64}$/.test(master) ? Buffer.from(master, 'hex').toString('base64') : master;
  return Secrets.fromKey(base64).decrypt(provider.apiKey);
}
