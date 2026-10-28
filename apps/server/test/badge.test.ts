import { describe, expect, it } from 'vitest';
import { createTestEngine, waitFor } from './helpers';

describe('Dock badge', () => {
  it('sums unread inbox conversations of the counted accounts, and follows the settings', async () => {
    const { engine, bridge } = await createTestEngine();
    const counts = engine.store.counts.bind(engine.store);
    engine.store.counts = () => ({ ...counts(), accounts: { perso: 120, pro: 7, shop: 3 } });

    await engine.refreshBadge();
    expect(bridge.badge).toBe(130); // the app draws "99+"

    // Changing the preference updates the badge on its own (no other trigger needed).
    engine.db.setSetting('ui', { badge: { enabled: true, excludedAccounts: ['perso'] } });
    await waitFor(() => bridge.badge === 10);

    engine.db.setSetting('ui', { badge: { enabled: false, excludedAccounts: [] } });
    await waitFor(() => bridge.badge === 0);
    expect(bridge.badge).toBe(0);
  });
});
