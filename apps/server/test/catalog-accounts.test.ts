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

describe('an account’s business, set from its settings', () => {
  it('replaces the « receiving account » criteria and can make it personal again', () => {
    const studio = engine.catalog.saveBusiness({ name: 'Studio', color: '#000', emoji: null, description: '', matchers: [{ type: 'account', value: 'acc1' }] });
    const shop = engine.catalog.saveBusiness({ name: 'Shop', color: '#111', emoji: null, description: '', matchers: [] });
    const resolve = () => engine.catalog.resolveBusiness({ accountId: 'acc1', from: { email: 'x@y.test' }, to: [], cc: [], deliveredTo: null });
    expect(resolve()).toBe(studio.id);
    engine.catalog.setAccountBusiness('acc1', shop.id);
    expect(resolve()).toBe(shop.id);
    engine.catalog.setAccountBusiness('acc1', null);
    expect(resolve()).toBeNull();
  });
});

describe('account groups and icons', () => {
  it('starts as business when linked to a business, personal otherwise, and can leave both groups', async () => {
    const shop = engine.catalog.saveBusiness({ name: 'Shop2', color: '#111', emoji: null, description: '', matchers: [] });
    const base = { name: 'Me', provider: 'custom', imapHost: '127.0.0.1', imapPort: 1, imapSecure: false, smtpHost: '127.0.0.1', smtpPort: 1, smtpSecure: false, password: 'pw' };
    const pro = await engine.accounts.create({ ...base, email: 'pro@shop.test', username: 'pro@shop.test', businessId: shop.id });
    const perso = await engine.accounts.create({ ...base, email: 'me@perso.test', username: 'me@perso.test' });
    expect(engine.accounts.get(pro.id)?.kind).toBe('business');
    expect(engine.accounts.get(perso.id)?.kind).toBe('personal');
    engine.accounts.setKind(pro.id, null);
    expect(engine.accounts.get(pro.id)?.kind).toBeNull();
    await engine.accounts.stopAll();
  });

  it('accepts only icons, brand logos and small images', () => {
    engine.accounts.setIcon('acc1', 'icon:briefcase');
    expect(engine.accounts.get('acc1')?.icon).toBe('icon:briefcase');
    engine.accounts.setIcon('acc1', 'image:data:image/png;base64,iVBORw0KGgo=');
    expect(() => engine.accounts.setIcon('acc1', 'image:javascript:alert(1)')).toThrow();
    expect(() => engine.accounts.setIcon('acc1', '<svg onload=x>')).toThrow();
    engine.accounts.setIcon('acc1', null);
    expect(engine.accounts.get('acc1')?.icon).toBeNull();
  });

  it('fetches a company logo from its own website', async () => {
    const png = Buffer.alloc(400, 1);
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      if (String(url) === 'https://brilisse.com') return new Response('<html><head><link rel="icon" sizes="192x192" href="/logo-192.png"></head></html>', { status: 200 });
      if (String(url) === 'https://brilisse.com/logo-192.png') return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    try {
      const logo = await engine.accounts.siteLogo('brilisse.com');
      expect(logo).toMatch(/^data:image\/png;base64,/);
      expect(seen.every((u) => u.includes('brilisse.com'))).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('company logo by default', () => {
  it('gives a mailbox on its own domain the company logo, never a webmail address, never over a picked icon', async () => {
    const png = Buffer.alloc(400, 2);
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      String(url) === 'https://acme-logo.test/apple-touch-icon.png' ? new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 })) as typeof fetch;
    try {
      const base = { name: 'Me', provider: 'custom', imapHost: '127.0.0.1', imapPort: 1, imapSecure: false, smtpHost: '127.0.0.1', smtpPort: 1, smtpSecure: false, password: 'pw' };
      const pro = await engine.accounts.create({ ...base, email: 'contact@acme-logo.test', username: 'contact@acme-logo.test' });
      const webmail = await engine.accounts.create({ ...base, email: 'someone@gmail.com', username: 'someone@gmail.com' });
      await expect.poll(() => engine.accounts.get(pro.id)?.icon).toMatch(/^image:data:image\/png;base64,/);
      expect(await engine.accounts.autoLogo(webmail.id)).toBeNull();
      expect(engine.accounts.get(webmail.id)?.icon).toBeNull();

      const picked = await engine.accounts.create({ ...base, email: 'hello@acme-logo.test', username: 'hello@acme-logo.test' });
      engine.accounts.setIcon(picked.id, 'icon:briefcase');
      await new Promise((r) => setTimeout(r, 50));
      expect(engine.accounts.get(picked.id)?.icon).toBe('icon:briefcase');
    } finally {
      globalThis.fetch = real;
      await engine.accounts.stopAll();
    }
  });
});
