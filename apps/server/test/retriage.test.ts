import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import type { Triage } from '../src/types';
import { createTestEngine } from './helpers';

/** « Relancer le tri IA »: every mail re-read, with a progress the settings can follow. */
let engine: EngineContext;
let uid = 0;

const add = (subject: string, triage: Partial<Triage>) => {
  const msg: IncomingMessage = {
    accountId: 'acc', mailboxId: 'mb', uid: ++uid, messageId: `<r${uid}@test>`, inReplyTo: null, references: [], subject,
    from: { name: 'Shop', email: `news${uid}@shop.test` }, to: [{ email: 'me@zmail.test' }], cc: [], replyTo: null,
    deliveredTo: null, date: Date.now() - uid * 60_000, text: subject, html: '', attachments: [], unread: true, starred: false, listUnsubscribe: null,
    listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 10, isNew: true,
  };
  const { id } = engine.store.upsert(msg, '1');
  engine.store.saveTriage(id, {
    businessId: null, priority: 1, tags: [], spam: false, spamReason: null, otp: null, opportunity: false, opportunityReason: null, newsletter: false,
    unsubscribe: null, summary: subject, engine: 'heuristic', userOverride: false, rulesApplied: [], ...triage,
  } as Triage);
  return id;
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
  for (let i = 0; i < 6; i++) add(`Soldes -50 % ce week-end ${i}`, { tags: ['finance', 'notification'], priority: 2 });
  add('Corrigé à la main', { tags: ['personal'], userOverride: true });
  // Sorted by an AI model: with no model available now, re-sorting must not downgrade it.
  add('Trié par l’IA', { tags: ['marketing'], engine: 'inclusionai/ling-3.1-flash' });
});

describe('re-running the AI sorting', () => {
  it('re-reads every mail except the ones the user corrected, and counts what changed', async () => {
    const sent: string[] = [];
    engine.notifier.send = (async (input: { title: string }) => (sent.push(input.title), { id: 'n', delivered: 'native' })) as EngineContext['notifier']['send'];
    const run = await engine.pipeline.retriageAll();
    expect(run).toMatchObject({ total: 6, done: 0, finishedAt: null });
    // A second click while it runs follows the same run.
    expect(await engine.pipeline.retriageAll()).toBe(run);
    await engine.pipeline.idle();
    expect(engine.pipeline.retriageStatus()).toMatchObject({ total: 6, done: 6, changed: 6, cancelled: false });
    expect(engine.pipeline.retriageStatus()!.finishedAt).not.toBeNull();
    // Mails that arrived live are not notified a second time.
    expect(sent).toEqual([]);
  });

  it('can be stopped: what is done stays done', async () => {
    await engine.pipeline.retriageAll();
    const run = engine.pipeline.cancelRetriage()!;
    await engine.pipeline.idle();
    expect(run.cancelled).toBe(true);
    expect(run.done).toBeLessThan(6);
    expect(engine.pipeline.retriageStatus()!.finishedAt).not.toBeNull();
  });
});
