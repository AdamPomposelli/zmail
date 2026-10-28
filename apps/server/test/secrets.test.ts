import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseKey } from '../src/lib/secrets';

describe('master key parsing', () => {
  const raw = randomBytes(32);
  it('reads the 64 hex digits `security -w` prints for the raw Keychain item', () => {
    expect(parseKey(`${raw.toString('hex')}\n`).equals(raw)).toBe(true);
  });
  it('reads base64 (bridge, key file)', () => {
    expect(parseKey(raw.toString('base64')).equals(raw)).toBe(true);
  });
  it('refuses a key of the wrong length instead of crashing later in AES', () => {
    expect(() => parseKey(randomBytes(20).toString('base64'))).toThrow(/32/);
  });
});
