import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineContext } from '../src/context';
import { Secrets } from '../src/lib/secrets';
import { NativeBridge } from '../src/native/bridge';

export class FakeBridge extends NativeBridge {
  notifications: { kind: string; title: string; body: string; otp?: string | null; threadId?: string | null }[] = [];
  badge = 0;
  constructor() {
    super(undefined, undefined);
  }
  override async notify(input: Parameters<NativeBridge['notify']>[0]) {
    this.notifications.push(input);
    return 'native' as const;
  }
  override async setBadge(count: number) {
    this.badge = count;
  }
}

/**
 * A fresh engine. Sorting tests need every built-in category, so they are all turned on unless
 * `sober` asks for what a new install really starts with.
 */
export async function createTestEngine({ sober = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zmail-test-'));
  const bridge = new FakeBridge();
  const engine = await EngineContext.create(dir, { bridge, secrets: Secrets.forTests() });
  if (!sober) engine.db.run("UPDATE tags SET hidden = 0 WHERE kind = 'system'");
  return { engine, bridge, dir };
}

export async function waitFor<T>(fn: () => T | Promise<T>, { timeout = 20_000, interval = 150 } = {}): Promise<NonNullable<T>> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value as NonNullable<T>;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out${last ? `: ${(last as Error).message}` : ''}`);
}
