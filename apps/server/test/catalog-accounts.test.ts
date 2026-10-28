import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { createTestEngine } from './helpers';

let engine: EngineContext;

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc1', 'me@studio.test', 'Me', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', ?, '#000', 0)`,
    engine.secrets.encrypt('pw'),
  );
});

describe('categories can be deleted', () => {
  it('hides a built-in category (the AI stops using it) and brings it back', () => {
    expect(engine.catalog.removeTag('marketing')).toEqual({ hidden: true });
    expect(engine.catalog.tags().map((t) => t.id)).not.toContain('marketing');
    expect(engine.catalog.hiddenTags().map((t) => t.id)).toEqual(['marketing']);
    engine.catalog.restoreTag('marketing');
    expect(engine.catalog.tags().map((t) => t.id)).toContain('marketing');
    expect(engine.catalog.hiddenTags()).toEqual([]);
  });

  it('deletes a custom category for good, renames and restyles any category', () => {
    const tag = engine.catalog.saveTag({ name: 'Fournisseurs', color: '#000', description: 'grossiste', icon: 'tag' });
    expect(engine.catalog.removeTag(tag.id)).toEqual({ hidden: false });
    expect(engine.catalog.tags().some((t) => t.id === tag.id)).toBe(false);
    const renamed = engine.catalog.saveTag({ id: 'important', name: 'Crucial', color: '#123456', description: 'x', icon: 'flame' });
    expect(renamed).toMatchObject({ id: 'important', name: 'Crucial', color: '#123456', kind: 'system' });
  });
});

describe('accounts', () => {
  it('can be given a name, and go back to showing the address', async () => {
    const updated = await engine.accounts.update('acc1', { label: 'Pro' });
    expect(updated.label).toBe('Pro');
    expect((await engine.accounts.update('acc1', { label: '  ' })).label).toBeNull();
  });

  it('tests an existing account with the saved password when none is typed', async () => {
    const result = await engine.accounts.testExisting('acc1', { imapHost: '127.0.0.1', imapPort: 1, imapSecure: false, smtpHost: '127.0.0.1', smtpPort: 1, smtpSecure: false });
    expect(result.imap.ok).toBe(false);
    expect(result.imap.error).toBeTruthy();
  });
});
