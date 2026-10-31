import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../lib/log';
import type { AppleDiagnostics } from '../ai/apple';

const run = promisify(execFile);

/**
 * Client for the native bridge served by ZMail.app (Apple Foundation Models, notifications,
 * Keychain). Every call degrades gracefully when the engine runs without the app (dev mode).
 */
export class NativeBridge {
  constructor(
    readonly url = process.env.ZMAIL_BRIDGE_URL,
    private readonly token = process.env.ZMAIL_BRIDGE_TOKEN,
  ) {}

  get connected() {
    return Boolean(this.url && this.token);
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 60_000) {
    if (!this.connected) throw new BridgeError('bridge_unavailable', 0);
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
    if (!res.ok) throw new BridgeError(data.reason ?? data.error ?? `http_${res.status}`, res.status);
    return data;
  }

  async health(): Promise<{ ai: { available: boolean; reason: string | null; diagnostics?: AppleDiagnostics }; notifications: string } | null> {
    if (!this.connected) return null;
    try {
      return await this.request('GET', '/health', undefined, 3000);
    } catch {
      return null;
    }
  }

  async generate(input: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) {
    const { text } = await this.request<{ text: string }>('POST', '/ai/generate', input, 120_000);
    return text;
  }

  async notify(input: {
    id: string;
    title: string;
    subtitle?: string;
    body: string;
    kind: string;
    otp?: string | null;
    threadId?: string | null;
  }): Promise<'native' | 'card' | 'denied' | 'osascript' | 'failed'> {
    if (this.connected) {
      try {
        const reply = (await this.request('POST', '/notify', input, 5000)) as { delivered?: string } | undefined;
        // A code goes on ZMail's floating card; the rest is a macOS notification.
        return reply?.delivered === 'card' ? 'card' : 'native';
      } catch (error) {
        // macOS has ZMail's notifications turned off: say so (the app shows them in-app instead).
        if (String((error as Error).message).includes('notifications_denied')) return 'denied';
        log.warn('bridge', 'notify failed, falling back to osascript', error);
      }
    }
    // Only the macOS app shows notifications. The osascript fallback is opt-in (ZMAIL_OSASCRIPT=1):
    // it posts as "Script Editor", has no copy button, and its "Show" just opens Script Editor.
    if (process.platform !== 'darwin' || !process.env.ZMAIL_OSASCRIPT) return 'failed';
    try {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const body = input.otp ? `${input.body} — code ${input.otp}` : input.body;
      await run('osascript', [
        '-e',
        `display notification "${esc(body)}" with title "${esc(input.title)}"${input.subtitle ? ` subtitle "${esc(input.subtitle)}"` : ''}`,
      ]);
      return 'osascript';
    } catch {
      return 'failed';
    }
  }

  async setBadge(count: number) {
    if (!this.connected) return;
    await this.request('POST', '/badge', { count }, 2000).catch(() => undefined);
  }

  /**
   * The app answers once the person has unlocked ZMail (Touch ID), however long that takes:
   * a request that times out (fetch gives up after a few minutes) is simply asked again.
   * An answer with an error (Keychain refused, unlock failed) is final: null.
   */
  async masterKey(): Promise<string | null> {
    while (this.connected) {
      try {
        const { key } = await this.request<{ key: string }>('GET', '/keychain/master-key', undefined, 4 * 60_000);
        return key;
      } catch (error) {
        if (error instanceof BridgeError) return null;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return null;
  }
}

export class BridgeError extends Error {
  constructor(
    readonly reason: string,
    readonly status: number,
  ) {
    super(`native bridge: ${reason}`);
  }
}
