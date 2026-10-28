import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { NativeBridge } from '../native/bridge';
import { t } from './i18n';

const run = promisify(execFile);
const KEYCHAIN_SERVICE = 'com.zippy.zmail';
const KEYCHAIN_ACCOUNT = 'master-key';

/**
 * AES-256-GCM for mail passwords and API keys. The master key lives in the macOS Keychain
 * (through the app bridge, else the `security` CLI); a 0600 key file is the last resort.
 */
/**
 * The key as stored: the app writes 32 raw bytes, which `security -w` prints as 64 hex digits;
 * the bridge and key files use base64. Anything that is not 32 bytes is refused loudly.
 */
export function parseKey(text: string): Buffer {
  const value = text.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(t('Clé maître invalide ({n} octets au lieu de 32)', { n: key.length }));
  return key;
}

export class Secrets {
  private constructor(private readonly key: Buffer) {}

  static async load(dataDir: string, bridge: NativeBridge): Promise<Secrets> {
    if (process.env.ZMAIL_MASTER_KEY) return new Secrets(Buffer.from(process.env.ZMAIL_MASTER_KEY, 'base64'));

    // A store created without the Keychain keeps its key file, or its secrets would be unreadable.
    const file = join(dataDir, 'master.key');
    const existing = await readFile(file, 'utf8').catch(() => null);
    if (existing) return new Secrets(parseKey(existing));

    const fromBridge = await bridge.masterKey();
    if (fromBridge) return new Secrets(parseKey(fromBridge));
    // Inside the app, the key comes from the app only (it holds it until Touch ID): never go
    // around the lock through the `security` CLI.
    if (bridge.connected) throw new Error(t('ZMail n’a pas pu déverrouiller vos clés.'));

    if (process.platform === 'darwin' && !process.env.ZMAIL_NO_KEYCHAIN) {
      let stored: string | null = null;
      try {
        ({ stdout: stored } = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']));
      } catch (error) {
        // 44 = errSecItemNotFound. Anything else (access refused, locked keychain) must NOT mint a
        // new key: overwriting the existing one would make every saved password unreadable.
        if ((error as { code?: number }).code !== 44) throw new Error(t('Trousseau inaccessible : {error}', { error: (error as Error).message.split('\n')[0] ?? '' }));
      }
      if (stored) return new Secrets(parseKey(stored));
      const key = randomBytes(32).toString('base64');
      try {
        await run('security', ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', key]);
        return new Secrets(Buffer.from(key, 'base64'));
      } catch {
        // fall through to the key file
      }
    }

    await mkdir(dataDir, { recursive: true });
    const key = randomBytes(32);
    await writeFile(file, key.toString('base64'), { mode: 0o600 });
    return new Secrets(key);
  }

  static fromKey(base64: string) {
    return new Secrets(Buffer.from(base64, 'base64'));
  }

  static forTests() {
    return new Secrets(randomBytes(32));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
