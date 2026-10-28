import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import { buildReplyTree } from '../src/mail/reply-tree';
import { createTestEngine } from './helpers';

/** Conversations as Betterbird shows them: replies of replies, one conversation, one tree. */
let engine: EngineContext;
let uid = 0;

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 11, 17);

const mail = (mailboxId: string, id: string, inReplyTo: string | null, references: string[], day: number, subject = 'Re: tarifs fermeture'): IncomingMessage => ({
  accountId: 'acc', mailboxId, uid: ++uid, messageId: `<${id}@test>`, inReplyTo: inReplyTo ? `<${inReplyTo}@test>` : null,
  references: references.map((r) => `<${r}@test>`), subject, from: { name: 'Maxime Guerin', email: 'maxime@test' }, to: [{ email: 'me@zmail.test' }],
  cc: [], replyTo: null, deliveredTo: null, date: T0 + day * DAY, text: id, html: '', attachments: [], unread: false, starred: false,
  listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 10, isNew: false,
});

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc', 'me@zmail.test', 'Me', 'custom', '127.0.0.1', 1, 0, '127.0.0.1', 1, 0, 'me', ?, '#3B82F6', ?)`,
    engine.secrets.encrypt('x'),
    Date.now(),
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('compta', 'acc', 'Work/SNAPVID/Comptabilité', 'Comptabilité', NULL, '1')`);
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('all', 'acc', '[Gmail]/All Mail', 'All Mail', 'all', '1')`);
});

describe('reply tree', () => {
  it('nests replies of replies and keeps branches apart', () => {
    const at = (id: string, inReplyTo: string | null, references: string[], date: number) => ({ id, messageId: id, inReplyTo, references, date });
    const tree = buildReplyTree([
      at('a', null, [], 1),
      at('b', 'a', ['a'], 2),
      at('c', 'b', ['a', 'b'], 3),
      at('d', 'a', ['a'], 4), // a second answer to the first mail
      at('e', null, ['a', 'zz-missing', 'c'], 5), // no In-Reply-To: closest known reference wins
    ]);
    expect(tree.map((n) => `${n.id}:${n.depth}`)).toEqual(['a:0', 'b:1', 'c:2', 'e:3', 'd:1']);
    expect(tree.find((n) => n.id === 'b')).toMatchObject({ parentId: 'a', last: false });
    expect(tree.find((n) => n.id === 'd')).toMatchObject({ parentId: 'a', last: true });
    // c sits under b, which has a sibling (d) after it: the line of level 1 continues past c.
    expect(tree.find((n) => n.id === 'c')!.guides).toEqual([true]);
  });

  it('survives headers that answer each other', () => {
    const tree = buildReplyTree([
      { id: 'x', messageId: 'x', inReplyTo: 'y', references: [], date: 1 },
      { id: 'y', messageId: 'y', inReplyTo: 'x', references: [], date: 2 },
    ]);
    expect(tree).toHaveLength(2);
  });
});

describe('conversations', () => {
  it('joins a reply synced before the mails it answers, and draws the chain', () => {
    // The last reply arrives first and only names its direct parent: it starts a conversation of its own…
    const last = engine.store.upsert(mail('compta', 'f', 'e', [], 19), '1');
    engine.store.upsert(mail('compta', 'a', null, [], 0, 'tarifs fermeture'), '1');
    engine.store.upsert(mail('compta', 'b', 'a', ['a'], 7), '1');
    engine.store.upsert(mail('compta', 'c', 'b', ['a', 'b'], 7), '1');
    engine.store.upsert(mail('compta', 'd', 'c', ['a', 'b', 'c'], 8), '1');
    // …until the mail it answers shows up and links both.
    const { threadId } = engine.store.upsert(mail('compta', 'e', 'd', ['a', 'b', 'c', 'd'], 16), '1');
    // The same mails again in All Mail (Gmail labels): still one copy each.
    for (const [id, parent, day] of [['a', null, 0], ['b', 'a', 7]] as const) engine.store.upsert(mail('all', id, parent, parent ? [parent] : [], day), '1');

    expect(engine.store.message(last.id)!.thread_id).toBe(threadId);
    const tree = engine.store.replyTree(threadId);
    expect(tree.map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tree[0]).toMatchObject({ subject: 'tarifs fermeture', isReply: false });
    expect(tree[5]).toMatchObject({ isReply: true, last: true });

    const thread = engine.store.getThread(threadId)!;
    expect(thread.messages).toHaveLength(6);
    expect(thread.tree.map((n) => n.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(thread.messages.find((m) => m.text === 'c')!.parentId).toBe(thread.messages.find((m) => m.text === 'b')!.id);

    const list = engine.store.listThreads({ view: 'folder', mailboxId: 'compta' }).items;
    expect(list).toHaveLength(1);
    expect(list[0]!.count).toBe(6);
  });

  it('repairs conversations split by an older version', () => {
    const { threadId } = engine.store.upsert(mail('compta', 'r1', null, [], 30, 'Bilan 2025'), '1');
    const reply = engine.store.upsert(mail('compta', 'r2', 'r1', ['r1'], 31, 'Re: Bilan 2025'), '1');
    engine.db.run(`UPDATE messages SET thread_id = 't_split' WHERE id = ?`, reply.id);
    expect(engine.store.repairThreads()).toBe(1);
    expect(engine.store.message(reply.id)!.thread_id).toBe(threadId);
  });
});
