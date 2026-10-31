import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import type { Triage } from '../src/types';
import { createTestEngine } from './helpers';

/** Subscriptions are per mailbox: the same list on two accounts is two lines, each mail counted once. */
let engine: EngineContext;
let uid = 0;

const newsletter = (accountId: string, mailboxId: string, id: string, unread: boolean) => {
  const msg: IncomingMessage = {
    accountId, mailboxId, uid: ++uid, messageId: `<${id}@news.test>`, inReplyTo: null, references: [], subject: `Digest ${id}`,
    from: { name: 'DevPulse', email: 'news@devpulse.test' }, to: [{ email: 'me@test' }], cc: [], replyTo: null, deliveredTo: null,
    date: Date.now() - uid * 3_600_000, text: 'digest', html: '', attachments: [], unread, starred: false,
    listUnsubscribe: '<https://devpulse.test/u>', listUnsubscribePost: null, listId: 'devpulse', precedence: 'bulk', autoSubmitted: null,
    spamHeader: null, size: 10, isNew: false,
  };
  const { id: rowId } = engine.store.upsert(msg, '1');
  engine.store.saveTriage(rowId, {
    businessId: null, priority: 0, tags: ['newsletter'], spam: false, spamReason: null, otp: null, opportunity: false, opportunityReason: null,
    newsletter: true, unsubscribe: { method: 'one-click', url: 'https://devpulse.test/u' }, summary: '', engine: 'test', userOverride: false, rulesApplied: [],
  } as unknown as Triage);
};

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  for (const [id, email] of [['work', 'me@work.test'], ['perso', 'me@perso.test']]) {
    engine.db.run(
      `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
       VALUES (?, ?, 'Me', 'gmail', '127.0.0.1', 1, 0, '127.0.0.1', 1, 0, 'me', ?, '#3B82F6', ?)`,
      id, email, engine.secrets.encrypt('x'), Date.now(),
    );
    engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES (?, ?, 'INBOX', 'INBOX', 'inbox', '1')`, `${id}-in`, id);
    engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES (?, ?, '[Gmail]/All Mail', 'All Mail', 'all', '1')`, `${id}-all`, id);
  }
  // Work: two mails, the first one also in All Mail (Gmail labels); one opened.
  newsletter('work', 'work-in', 'w1', false);
  newsletter('work', 'work-all', 'w1', false);
  newsletter('work', 'work-in', 'w2', true);
  // Perso: the same list, one unread mail.
  newsletter('perso', 'perso-in', 'p1', true);
});

describe('subscriptions', () => {
  it('lists the same list once per mailbox, each mail counted once', () => {
    const rows = engine.subscriptions.list();
    const work = rows.find((r) => r.accountId === 'work')!;
    const perso = rows.find((r) => r.accountId === 'perso')!;
    expect(rows).toHaveLength(2);
    expect(work).toMatchObject({ fromEmail: 'news@devpulse.test', total: 2, opened: 1 });
    expect(perso).toMatchObject({ fromEmail: 'news@devpulse.test', total: 1, opened: 0 });
    expect(work.threadId).not.toBe(perso.threadId);
  });

  it('keeps an unsubscribe on one mailbox from showing on the other', () => {
    engine.db.run(`INSERT INTO unsubscribes (id, at, account_id, from_email, method, target, status) VALUES ('u1', ?, 'work', 'news@devpulse.test', 'one-click', 'x', 'success')`, Date.now());
    const rows = engine.subscriptions.list();
    expect(rows.find((r) => r.accountId === 'work')!.status).toBe('success');
    expect(rows.find((r) => r.accountId === 'perso')!.status).toBe('subscribed');
  });

  it('counts the mails still kept, and deletes all of one sender on one mailbox only', async () => {
    expect(engine.subscriptions.list().find((r) => r.accountId === 'work')!.kept).toBe(2);
    // The preview lists exactly those mails, once each, newest first.
    const preview = engine.subscriptions.senderMails('work', 'news@devpulse.test');
    expect(preview.map((m) => m.subject)).toEqual(['Digest w1', 'Digest w2']);
    expect(engine.subscriptions.senderMails('perso', 'news@devpulse.test')).toHaveLength(1);
    let trashed: string[] = [];
    // No IMAP server here: record the conversations instead of moving them.
    (engine.actions as unknown as { trash: (ids: string[]) => Promise<void> }).trash = async (ids) => void (trashed = ids);
    const { threadIds } = await engine.subscriptions.trashFromSender('work', 'news@devpulse.test');
    const workThreads = engine.db.all<{ thread_id: string }>(`SELECT DISTINCT thread_id FROM messages WHERE account_id = 'work'`).map((r) => r.thread_id);
    expect(threadIds.sort()).toEqual(workThreads.sort());
    expect(trashed.sort()).toEqual(workThreads.sort());
    // Moved to the trash folder, they no longer count as kept; the other mailbox is untouched.
    engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('work-trash', 'work', 'Trash', 'Trash', 'trash', '1')`);
    engine.db.run(`UPDATE messages SET mailbox_id = 'work-trash' WHERE account_id = 'work'`);
    const rows = engine.subscriptions.list();
    expect(rows.find((r) => r.accountId === 'work')!.kept).toBe(0);
    expect(rows.find((r) => r.accountId === 'perso')!.kept).toBe(1);
  });
});
