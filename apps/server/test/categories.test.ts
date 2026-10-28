import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { scopeTags } from '../src/ai/taxonomy';
import { createTestEngine } from './helpers';

/** Scoped categories: one topic per mail, and starting categories that follow the use. */
let engine: EngineContext;

beforeAll(async () => {
  ({ engine } = await createTestEngine());
});

describe('one topic per mail', () => {
  it('drops the « Autres notifications » catch-all as soon as another category fits', () => {
    expect(scopeTags(['finance', 'notification'], { securityStrong: false })).toEqual(['finance']);
    expect(scopeTags(['notification'], { securityStrong: false })).toEqual(['notification']);
  });

  it('keeps « Sécurité » only for a real security mail', () => {
    expect(scopeTags(['delivery', 'notification', 'security'], { securityStrong: false })).toEqual(['delivery']);
    expect(scopeTags(['finance', 'security'], { securityStrong: true })).toEqual(['security']);
    // A bank card alert without a code is a payment.
    expect(scopeTags(['finance', 'security'], { securityStrong: false })).toEqual(['finance']);
  });

  it('keeps the attention tags, and a custom category beats a generic one', () => {
    expect(scopeTags(['to-respond', 'important', 'opportunity', 'meeting', 'personal'], { securityStrong: false })).toEqual(['to-respond', 'important', 'opportunity', 'personal']);
    expect(scopeTags(['finance', 'clients-shopify'], { securityStrong: false })).toEqual(['clients-shopify']);
    expect(scopeTags(['chargeback', 'clients-shopify'], { securityStrong: false })).toEqual(['chargeback']);
  });
});

describe('starting categories follow the use', () => {
  const visible = () => engine.catalog.tags().map((t) => t.id);

  it('a personal use hides the business categories and offers them as a template', () => {
    engine.catalog.applyUsage('personal');
    expect(visible()).toEqual(expect.arrayContaining(['personal', 'admin', 'travel', 'finance']));
    expect(visible()).not.toContain('chargeback');
    expect(engine.catalog.packs().find((p) => p.id === 'business')).toMatchObject({ missing: 3 });
  });

  it('adding the business template (e.g. a new business) shows them and switches to both', () => {
    engine.catalog.addPack('business');
    expect(visible()).toEqual(expect.arrayContaining(['opportunity', 'chargeback', 'meeting', 'personal']));
    expect(engine.catalog.usage()).toBe('both');
  });

  it('a business use hides the personal ones', () => {
    engine.catalog.applyUsage('business');
    expect(visible()).not.toContain('travel');
    expect(visible()).toContain('chargeback');
  });

  it('on an existing install, categories added by an update start hidden and old pile-ups are cleaned', () => {
    engine.db.run("DELETE FROM tags WHERE id IN ('admin', 'travel')");
    engine.db.run("UPDATE tags SET name = 'Notification', hidden = 0 WHERE id = 'notification'");
    engine.catalog.seed();
    expect(engine.catalog.hiddenTags().map((t) => t.id)).toEqual(expect.arrayContaining(['admin', 'travel']));
    expect(engine.catalog.tags().find((t) => t.id === 'notification')?.name).toBe('Autres notifications');
  });
});
