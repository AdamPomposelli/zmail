import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { createTestEngine } from './helpers';

/**
 * Spaces: a business's mail lives in its space, personal mail in another, nothing mixes in
 * « Principal ». Two accounts: a personal one and a shop's support address.
 */
let engine: EngineContext;
const ids: Record<string, string> = {};

const mail = (id: string, account: 'perso' | 'pro', subject: string, from: string, extra: Partial<{ listUnsubscribe: string; text: string }> = {}) => {
  const r = engine.store.upsert(
    {
      accountId: account, mailboxId: `${account}-inbox`, uid: Object.keys(ids).length + 1, messageId: `<${id}@t>`, inReplyTo: null, references: [], subject,
      from: { name: from.split('@')[0], email: from }, to: [{ email: account === 'pro' ? 'contact@brilisse.test' : 'adam@gmail.test' }], cc: [], replyTo: null, deliveredTo: null,
      date: Date.now() - Object.keys(ids).length * 1000, text: extra.text ?? `${subject}.`, html: '', attachments: [], unread: true, starred: false,
      listUnsubscribe: extra.listUnsubscribe ?? null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 100, isNew: false,
    },
    '1',
  );
  ids[id] = r.threadId;
  return r.id;
};
const subjects = (spaceId: string, view: 'inbox' | 'starred' = 'inbox') => engine.store.listThreads({ view, spaceId, limit: 50 }).items.map((t) => t.subject).sort();

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  for (const [id, email] of [['perso', 'adam@gmail.test'], ['pro', 'contact@brilisse.test']] as const) {
    engine.db.run(
      `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
       VALUES (?, ?, 'Adam', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', 's', '#000', 0)`,
      id,
      email,
    );
    engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use) VALUES (?, ?, 'INBOX', 'INBOX', 'inbox')`, `${id}-inbox`, id);
  }
  engine.catalog.saveBusiness({ name: 'Brilisse', emoji: '💎', color: '#8B5CF6', description: 'Bijoux en ligne', matchers: [{ type: 'account', value: 'pro' }] });
  const msgs = [
    mail('sav', 'pro', 'Can you ship to Miami?', 'wumi@gmail.com'),
    mail('order', 'pro', 'Commande #1162', 'shop@shopify.test'),
    mail('mom', 'perso', 'Photos de dimanche', 'maman@gmail.test'),
    mail('news', 'perso', 'La lettre du dimanche', 'news@media.test', { listUnsubscribe: '<https://media.test/u>' }),
  ];
  for (const id of msgs) await engine.pipeline.process(id);
});

describe('spaces', () => {
  it('starts with « Principal » holding everything', () => {
    expect(engine.spaces.list().map((s) => s.id)).toEqual(['main']);
    expect(subjects('main')).toHaveLength(4);
  });

  it('a business space takes its mail out of « Principal », past mail included', () => {
    const business = engine.catalog.businesses().find((b) => b.name === 'Brilisse')!;
    const brilisse = engine.spaces.save({ name: 'Brilisse', color: '#8B5CF6', businessIds: [business.id] });
    expect(subjects(brilisse.id)).toEqual(['Can you ship to Miami?', 'Commande #1162']);
    expect(subjects('main')).toEqual(['La lettre du dimanche', 'Photos de dimanche']);
    const counts = engine.store.counts(brilisse.id);
    expect(counts.views.inbox).toBe(2);
    expect(counts.spaces).toMatchObject({ [brilisse.id]: 2, main: 2 });
  });

  it('an account can feed a space too', () => {
    const perso = engine.spaces.save({ name: 'Personnel', icon: 'emoji:🏠', color: '#10B981', accountIds: ['perso'] });
    expect(subjects(perso.id)).toEqual(['La lettre du dimanche', 'Photos de dimanche']);
    expect(subjects('main')).toEqual([]);
  });

  it('moves a conversation by hand, and moving it back removes the exception', () => {
    const [brilisse, perso] = [engine.spaces.list().find((s) => s.name === 'Brilisse')!, engine.spaces.list().find((s) => s.name === 'Personnel')!];
    engine.actions.moveToSpace([ids.sav!], perso.id);
    expect(engine.spaces.spaceOf(ids.sav!)).toBe(perso.id);
    expect(subjects(perso.id)).toContain('Can you ship to Miami?');
    engine.actions.moveToSpace([ids.sav!], brilisse.id);
    expect(engine.db.get('SELECT 1 FROM space_overrides WHERE thread_id = ?', ids.sav)).toBeUndefined();
    expect(engine.spaces.spaceOf(ids.sav!)).toBe(brilisse.id);
  });

  it('suggests a rule after the same sender is moved to a space twice, and the rule moves new mail', async () => {
    const perso = engine.spaces.list().find((s) => s.name === 'Personnel')!;
    const a = mail('promo1', 'pro', 'Votre avis compte', 'avis@trustpilot.test');
    const b = mail('promo2', 'pro', 'Encore un avis', 'avis@trustpilot.test');
    await engine.pipeline.process(a);
    await engine.pipeline.process(b);
    engine.actions.moveToSpace([ids.promo1!], perso.id);
    engine.actions.moveToSpace([ids.promo2!], perso.id);
    const suggestion = engine.patterns.pending().find((s) => s.rule.actions[0]?.type === 'setSpace');
    expect(suggestion?.rule.actions[0]).toEqual({ type: 'setSpace', value: perso.id });
    engine.rules.create({ ...suggestion!.rule }, 'suggestion');
    const c = mail('promo3', 'pro', 'Dernier rappel avis', 'avis@trustpilot.test');
    await engine.pipeline.process(c);
    expect(engine.spaces.spaceOf(ids.promo3!)).toBe(perso.id);
  });

  it('keeps categories and subscriptions per space', () => {
    const brilisse = engine.spaces.list().find((s) => s.name === 'Brilisse')!;
    const perso = engine.spaces.list().find((s) => s.name === 'Personnel')!;
    const sav = engine.catalog.saveTag({ name: 'SAV', color: '#F59E0B', description: 'Questions de clients', spaceId: brilisse.id });
    expect(engine.catalog.tagsForSpace(brilisse.id).map((t) => t.id)).toContain(sav.id);
    expect(engine.catalog.tagsForSpace(perso.id).map((t) => t.id)).not.toContain(sav.id);
    expect(engine.subscriptions.list(perso.id).map((s) => s.fromEmail)).toContain('news@media.test');
    expect(engine.subscriptions.list(brilisse.id).map((s) => s.fromEmail)).not.toContain('news@media.test');
  });

  it('a category marked « hide from inbox » leaves the inbox but stays in its category and count', () => {
    const perso = engine.spaces.list().find((s) => s.name === 'Personnel')!;
    const newsletter = engine.catalog.tags().find((tg) => tg.id === 'newsletter')!;
    const tagged = engine.store.listThreads({ view: 'inbox', spaceId: perso.id, tagId: newsletter.id, limit: 50 }).items.map((th) => th.subject);
    expect(tagged).toContain('La lettre du dimanche');
    engine.catalog.setHideFromInbox(newsletter.id, true);
    expect(engine.catalog.tag(newsletter.id)?.hideFromInbox).toBe(true);
    expect(subjects(perso.id)).not.toContain('La lettre du dimanche');
    expect(engine.store.listThreads({ view: 'inbox', spaceId: perso.id, tagId: newsletter.id, limit: 50 }).items.map((th) => th.subject)).toContain('La lettre du dimanche');
    expect(engine.store.listThreads({ view: 'inbox', spaceId: perso.id, query: 'lettre', limit: 50 }).items).toHaveLength(1);
    const counts = engine.store.counts(perso.id);
    expect(counts.tags[newsletter.id]).toBeGreaterThan(0);
    engine.catalog.setHideFromInbox(newsletter.id, false);
    expect(subjects(perso.id)).toContain('La lettre du dimanche');
  });

  it('deleting a space sends its mail back and drops its own categories', () => {
    const brilisse = engine.spaces.list().find((s) => s.name === 'Brilisse')!;
    engine.spaces.remove(brilisse.id);
    expect(subjects('main')).toContain('Commande #1162');
    expect(engine.catalog.tags().some((t) => t.name === 'SAV')).toBe(false);
    expect(() => engine.spaces.remove('main')).toThrow();
  });

  it('creates one space per business in one click', () => {
    const created = engine.spaces.createPerBusiness();
    expect(created.map((s) => s.name)).toEqual(['Brilisse']);
    expect(created[0]!.icon).toBe('emoji:💎');
    expect(engine.spaces.createPerBusiness()).toEqual([]);
  });

  it('a space takes the businesses of the accounts chosen for it, and lets them go with them', () => {
    const business = engine.catalog.businesses().find((b) => b.name === 'Brilisse')!;
    engine.catalog.setAccountBusiness('pro', business.id);
    const spaceOfBusiness = () => engine.spaces.list().find((s) => s.businessIds.includes(business.id))?.id ?? null;
    const shop = engine.spaces.save({ name: 'Boutique', color: '#F59E0B', accountIds: ['pro'] });
    expect(spaceOfBusiness()).toBe(shop.id);
    engine.spaces.save({ id: shop.id, name: 'Boutique', color: '#F59E0B', accountIds: [] });
    expect(spaceOfBusiness()).toBeNull();
    engine.spaces.remove(shop.id);
  });
});
