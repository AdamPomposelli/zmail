import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import { createTestEngine } from './helpers';

/** Importing a whole mailbox must never delay the mail that just arrived (a bank code…). */
let engine: EngineContext;
let uid = 0;

const add = (subject: string, opts: { isNew: boolean; daysAgo: number }) => {
  const msg: IncomingMessage = {
    accountId: 'acc', mailboxId: 'mb', uid: ++uid, messageId: `<q${uid}@test>`, inReplyTo: null, references: [], subject,
    from: { name: 'Bank', email: `bank${uid}@bank.test` }, to: [{ email: 'me@zmail.test' }], cc: [], replyTo: null,
    deliveredTo: null, date: Date.now() - opts.daysAgo * 86_400_000, text: subject, html: '', attachments: [], unread: true, starred: false, listUnsubscribe: null,
    listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 10, isNew: opts.isNew,
  };
  return engine.store.upsert(msg, '1').id;
};

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

describe('AI queue', () => {
  it('reads a mail that just arrived before the backlog of an import, and the backlog newest first', async () => {
    const order: string[] = [];
    engine.pipeline.concurrency = 1;
    engine.pipeline.process = (async (id: string) => (order.push(id), await new Promise((r) => setTimeout(r, 5)), null)) as typeof engine.pipeline.process;
    const backlog = [5, 9, 7, 30].map((d) => add(`Ancien ${d}`, { isNew: false, daysAgo: d }));
    engine.pipeline.enqueue(backlog);
    const code = add('354517 is your Slash verification code', { isNew: true, daysAgo: 0 });
    engine.pipeline.enqueue([code]);
    await engine.pipeline.idle();
    // The first backlog mail was already being read; the code comes right after it.
    expect(order[1]).toBe(code);
    expect(order).toHaveLength(5);
    // Then the import, newest first.
    expect(order.slice(2)).toEqual([backlog[2], backlog[1], backlog[3]]);
  });
});
