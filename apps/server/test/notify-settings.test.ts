import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { createTestEngine } from './helpers';

/** Réglages → Notifications: the code card and the other notifications can be turned off. */
let engine: EngineContext;

beforeAll(async () => {
  ({ engine } = await createTestEngine());
});

describe('notification settings', () => {
  it('shows codes by default, and never once « Codes OTP » or all notifications are off', () => {
    expect(engine.notifier.allows('otp')).toBe(true);
    engine.notifier.saveSettings({ ...engine.notifier.settings(), otp: false });
    expect(engine.notifier.allows('otp')).toBe(false);
    expect(engine.notifier.allows('opportunity')).toBe(true);
    engine.notifier.saveSettings({ ...engine.notifier.settings(), otp: true, enabled: false });
    expect(engine.notifier.allows('otp')).toBe(false);
  });
});
