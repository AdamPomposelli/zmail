import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import type { Triage } from '../src/types';
import { createTestEngine } from './helpers';

/** The inbox cleaner: tidies the sure things, keeps what matters, asks about the rest. */
let engine: EngineContext;
const done: { action: string; ids: string[] }[] = [];
const ids: Record<string, string> = {};
let uid = 0;

const add = (key: string, from: string, subject: string, triage: Partial<Triage>) => {
  const msg: IncomingMessage = {
    accountId: 'acc', mailboxId: 'mb', uid: ++uid, messageId: `<${key}@test>`, inReplyTo: null, references: [], subject,
    from: { name: from, email: `${key}@${from.toLowerCase().replace(/\W/g, '')}.test` }, to: [{ email: 'me@zmail.test' }], cc: [], replyTo: null,
    deliveredTo: null, date: Date.now() - 3 * 3_600_000, text: subject, html: '', attachments: [], unread: true, starred: false, listUnsubscribe: null,
    listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 10, isNew: false,
  };
  const { id, threadId } = engine.store.upsert(msg, '1');
  engine.store.saveTriage(id, {
    businessId: null, priority: 1, tags: [], spam: false, spamReason: null, otp: null, opportunity: false, opportunityReason: null, newsletter: false,
    unsubscribe: null, summary: subject, engine: 'test', userOverride: false, rulesApplied: [], ...triage,
  } as Triage);
  ids[key] = threadId;
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
  // No IMAP server here: record what the cleaner does instead of moving mail.
  for (const action of ['archive', 'markRead', 'trash', 'restore'] as const) {
    (engine.actions as unknown as Record<string, unknown>)[action] = async (threadIds: string[]) => void done.push({ action, ids: threadIds });
  }
  engine.notifier.send = (async (input: { title: string; threadId?: string | null }) => (done.push({ action: `notify:${input.title}:${input.threadId}`, ids: [] }), { id: 'n', delivered: 'native' })) as EngineContext['notifier']['send'];

  add('news', 'DevPulse', 'DevPulse #212', { tags: ['newsletter'], newsletter: true });
  add('promo', 'Promo Flash', '-60 % ce soir', { tags: ['marketing'] });
  add('otp', 'Paylane', 'Votre code', { tags: ['security'], otp: '123456' });
  add('client', 'Claire', 'Devis application', { tags: ['opportunity', 'to-respond'], priority: 2, opportunity: true });
  add('invoice', 'OVH', 'Facture mars', { tags: ['finance'] });
  add('mystery', 'Inconnu', 'Bonjour', { tags: [] });
});

describe('inbox cleaner', () => {
  it('splits the unread inbox: tidy, mine, ask', () => {
    const r = engine.cleaner.remaining();
    expect(r).toMatchObject({ unread: 6, tidy: 3, mine: 1, ask: 2 });
    expect(r.withAiSeconds).toBeLessThan(r.manualSeconds);
  });

  it('tidies only the sure ones, asks with a notification that opens the chat', async () => {
    const run = await engine.cleaner.start();
    expect(run.tidied.map((t) => t.threadId).sort()).toEqual([ids.news, ids.promo, ids.otp].sort());
    expect(run.mine.map((t) => t.threadId)).toEqual([ids.client]);
    expect(run.questions.map((q) => [q.threadId, q.proposal])).toEqual(expect.arrayContaining([[ids.invoice, 'archive'], [ids.mystery, 'keep']]));
    expect(done.find((d) => d.action === 'archive')!.ids.sort()).toEqual(run.tidied.map((t) => t.threadId).sort());
    expect(done.some((d) => d.action === `notify:J’ai besoin de vous pour 2 mails:agent:${run.id}`)).toBe(true);
    expect(engine.cleaner.savings().tidied).toBe(3);
  });

  it('drafts a reply to the conversation that waits for one, then sends what the user approved', async () => {
    const run = engine.cleaner.runs()[0]!;
    expect(run.replies?.map((r) => r.threadId)).toEqual([ids.client]);
    // No model in tests: the draft fails, the user writes it and sends it from the cockpit.
    await expect.poll(() => engine.cleaner.run(run.id)!.replies![0]!.status).toBe('failed');
    const sent: { to: string[]; subject: string; text: string; threadId?: string }[] = [];
    (engine.actions as unknown as Record<string, unknown>).send = async (input: (typeof sent)[number]) => void sent.push(input);
    const item = await engine.cleaner.reply({ runId: run.id, threadId: ids.client!, action: 'send', text: 'Bonjour Claire,\n\nC’est noté, je reviens vers vous jeudi.' });
    expect(item?.status).toBe('sent');
    expect(sent[0]).toMatchObject({ to: ['client@claire.test'], subject: 'Re: Devis application', threadId: ids.client });
    expect(engine.cleaner.savings().replied).toBe(1);
  });

  it('turns a remembered answer into a rule, and can undo a run', async () => {
    const run = engine.cleaner.runs()[0]!;
    const { note } = await engine.cleaner.resolve({ runId: run.id, threadId: ids.invoice!, decision: 'archive', remember: true });
    expect(note).toMatch(/Règle « Archiver — invoice@ovh\.test »/);
    expect(engine.cleaner.run(run.id)!.questions.find((q) => q.threadId === ids.invoice)!.resolved).toBe('archive');
    await engine.cleaner.undo(run.id);
    expect(done.some((d) => d.action === 'restore' && d.ids.length === 3)).toBe(true);
    expect(engine.cleaner.run(run.id)!.undone).toBe(true);
  });

  it('counts what ZMail did, without any money value', () => {
    const s = engine.cleaner.savings();
    expect(s.sorted).toBe(6);
    expect(s.seconds).toBeGreaterThan(0);
    expect(s).not.toHaveProperty('hourlyRate');
    expect(s.replied).toBe(1);
  });
});
