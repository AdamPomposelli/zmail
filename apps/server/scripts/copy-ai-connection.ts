/**
 * Copies the ZenMux connection saved in ZMail.app into another data dir (e.g. the demo engine),
 * re-encrypting the key for that store. The key is never printed.
 *
 *   tsx scripts/copy-ai-connection.ts <targetDataDir>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db';
import { Secrets } from '../src/lib/secrets';

const target = process.argv[2];
if (!target) throw new Error('usage: copy-ai-connection.ts <targetDataDir>');

const master = execFileSync('security', ['find-generic-password', '-s', 'com.zippy.zmail', '-a', 'master-key', '-w']).toString().trim();
const appSecrets = Secrets.fromKey(/^[0-9a-f]{64}$/.test(master) ? Buffer.from(master, 'hex').toString('base64') : master);
const app = new Database(join(homedir(), 'Library', 'Application Support', 'ZMail', 'zmail.db'));
const appAi = app.getSetting<{ providers: { type: string; baseUrl?: string; apiKey?: string; name: string; id: string }[] }>('ai', { providers: [] });
const source = appAi.providers.find((p) => p.type === 'openai' && p.apiKey);
if (!source?.apiKey) throw new Error('Aucune connexion avec clé dans ZMail.app');

const targetSecrets = Secrets.fromKey(readFileSync(join(target, 'master.key'), 'utf8').trim());
const db = new Database(join(target, 'zmail.db'));
const ai = db.getSetting<{ providers: unknown[]; overrides?: unknown; disabled?: unknown }>('ai', { providers: [] });
const providers = [
  ...(ai.providers as { id: string }[]).filter((p) => p.id !== source.id),
  { id: source.id, type: 'openai', kind: 'zenmux', name: source.name, baseUrl: source.baseUrl, enabled: true, apiKey: targetSecrets.encrypt(appSecrets.decrypt(source.apiKey)) },
];
db.setSetting('ai', { providers, overrides: ai.overrides ?? {}, disabled: ai.disabled ?? [] });
console.log(`connexion ${source.name} copiée dans ${target}`);
