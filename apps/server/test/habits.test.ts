import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import type { Triage } from '../src/types';
import { commonSubject } from '../src/rules/patterns';
import { createTestEngine } from './helpers';

/** A habit becomes a rule only if the rule can never throw away a mail that matters. */
let engine: EngineContext;
let uid = 0;

const add = (from: string, subject: string, triage: Partial<Triage>) => {
  const msg: IncomingMessage = {
    accountId: 'acc', mailboxId: 'mb', uid: ++uid, messageId: `<h${uid}@test>`, inReplyTo: null, references: [], subject,
    from: { name: from, email: from }, to: [{ email: 'me@zmail.test' }], cc: [], replyTo: null,
    deliveredTo: null, date: Date.now() - uid * 3_600_000, text: subject, html: '', attachments: [], unread: true, starred: false, listUnsubscribe: null,
    listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 10, isNew: false,
  };
  const { id, threadId } = engine.store.upsert(msg, '1');
  engine.store.saveTriage(id, {
    businessId: null, priority: 1, tags: [], spam: false, spamReason: null, otp: null, opportunity: false, opportunityReason: null, newsletter: false,
    unsubscribe: null, summary: subject, engine: 'test', userOverride: false, rulesApplied: [], ...triage,
  } as Triage);
  return { from, subject, threadId, tags: triage.tags ?? [] };
};
const trash = (m: ReturnType<typeof add>) => engine.patterns.log({ action: 'trash', threadId: m.threadId, fromEmail: m.from, subject: m.subject, tags: m.tags });

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc', 'me@zmail.test', 'Me', 'custom', '127.0.0.1', 1, 0, '127.0.0.1', 1, 0, 'me', ?, '#3B82F6', ?)`,
    engine.secrets.encrypt('x'),
    Date.now(),
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('mb', 'acc', 'INBOX', 'INBOX', 'inbox', '1')`);
});

describe('habits that become rules', () => {
  it('never offers to trash a whole payment provider, even after several deletions', () => {
    // Stripe also sends disputes: that one must never be deleted by a rule.
    add('notifications@stripe.com', 'A payment dispute was opened', { tags: ['chargeback'], priority: 3 });
    const deleted = [
      add('notifications@stripe.com', 'Your weekly summary for Brilisse', { tags: ['notification'] }),
      add('notifications@stripe.com', 'Your weekly summary for Brilisse', { tags: ['notification'] }),
      add('marketing@stripe.com', 'Stripe Sessions 2026: register now', { tags: ['marketing'] }),
      add('marketing@stripe.com', 'New in Stripe: tax for creators', { tags: ['marketing'] }),
    ];
    const made = deleted.map(trash).filter(Boolean);
    const keys = engine.patterns.pending().map((s) => s.patternKey);
    expect(keys.some((k) => k.includes('domain:stripe.com') || k.includes('sender:notifications@stripe.com'))).toBe(false);
    expect(made.every((s) => !s || s.patternKey.startsWith('trash:subject:'))).toBe(true);
  });

  it('offers a precise rule (sender + repeated subject) with exceptions for what matters', () => {
    const weekly = add('notifications@stripe.com', 'Your weekly summary for Brilisse', { tags: ['notification'] });
    const suggestion = trash(weekly);
    expect(suggestion?.patternKey).toBe('trash:subject:notifications@stripe.com:your weekly summary for brilisse');
    const fields = suggestion!.rule.conditions.map((c) => `${c.field}:${c.op}:${c.value}`);
    expect(fields).toEqual(expect.arrayContaining(['from:equals:notifications@stripe.com', 'subject:contains:Your weekly summary for Brilisse', 'tag:isNot:chargeback', 'tag:isNot:finance', 'otp:isNot:true']));
    expect(suggestion!.description).toMatch(/aucun litige/);
  });

  it('still offers a whole sender when nothing it sends can matter', () => {
    const promos = ['-60 % ce soir', 'Vente flash montres', 'Dernière chance'].map((s) => add('deals@promo.test', s, { tags: ['marketing'] }));
    const suggestion = promos.map(trash).filter(Boolean).at(-1);
    expect(suggestion?.patternKey).toBe('trash:sender:deals@promo.test');
  });

  it('finds the shared subject, numbers and dates aside', () => {
    expect(commonSubject(['[Brilisse] Commande #1162 placée', '[Brilisse] Commande #1170 placée'], '[Brilisse] Commande #1180 placée')).toEqual({ text: '[Brilisse] Commande', count: 2 });
    expect(commonSubject(['Hello'], 'Hi there')).toBeNull();
  });
});
