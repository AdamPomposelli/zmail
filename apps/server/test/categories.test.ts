import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { scopeTags } from '../src/ai/taxonomy';
import { createTestEngine } from './helpers';

/** Scoped categories: one topic per mail, and starting categories that follow the use. */
let engine: EngineContext;

beforeAll(async () => {
  ({ engine } = await createTestEngine({ sober: true }));
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
  const NICHE = ['delivery', 'personal', 'chargeback', 'opportunity', 'travel'];

  it('a new install starts sober: no niche category until the user turns it on', () => {
    expect(visible()).toEqual(expect.arrayContaining(['important', 'to-respond', 'finance', 'security', 'newsletter', 'marketing', 'notification']));
    for (const id of NICHE) expect(visible()).not.toContain(id);
    expect(engine.catalog.hiddenTags().map((t) => t.id)).toEqual(expect.arrayContaining(NICHE));
  });

  it('a personal use adds only « Administratif », the rest stays a template', () => {
    engine.catalog.applyUsage('personal');
    expect(visible()).toContain('admin');
    for (const id of NICHE) expect(visible()).not.toContain(id);
    expect(engine.catalog.packs().find((p) => p.id === 'personal')).toMatchObject({ missing: 3 });
    expect(engine.catalog.packs().find((p) => p.id === 'business')).toMatchObject({ missing: 3 });
  });

  it('adding the business template (e.g. a new business) shows them and switches to both', () => {
    engine.catalog.addPack('business');
    expect(visible()).toEqual(expect.arrayContaining(['opportunity', 'chargeback', 'meeting', 'admin']));
    expect(engine.catalog.usage()).toBe('both');
  });

  it('a business use adds only « Réunion »', () => {
    engine.catalog.applyUsage('business');
    expect(visible()).toContain('meeting');
    expect(visible()).not.toContain('admin');
    expect(visible()).not.toContain('chargeback');
  });

  it('on an existing install, categories added by an update start hidden and old pile-ups are cleaned', () => {
    engine.db.run("DELETE FROM tags WHERE id IN ('admin', 'travel')");
    engine.db.run("UPDATE tags SET name = 'Notification', hidden = 0 WHERE id = 'notification'");
    engine.catalog.seed();
    expect(engine.catalog.hiddenTags().map((t) => t.id)).toEqual(expect.arrayContaining(['admin', 'travel']));
    expect(engine.catalog.tags().find((t) => t.id === 'notification')?.name).toBe('Autres notifications');
  });
});
