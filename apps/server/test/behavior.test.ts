import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { wilson } from '../src/rules/behavior';
import { ActionSchema } from '../src/rules/engine';
import { createTestEngine } from './helpers';

/**
 * The habits analysis: every gesture keeps its context (opened first, time read, age), and the
 * analysis reads shares per kind of mail, not the log line by line.
 */
let engine: EngineContext;
let uid = 0;

const mail = (from: string, subject: string, extra: Partial<{ listId: string; ageDays: number }> = {}) => {
  uid++;
  const r = engine.store.upsert(
    {
      accountId: 'acc', mailboxId: 'acc-inbox', uid, messageId: `<b${uid}@t>`, inReplyTo: null, references: [], subject,
      from: { name: from.split('@')[0], email: from }, to: [{ email: 'adam@shop.test' }], cc: [], replyTo: null, deliveredTo: null,
      date: Date.now() - (extra.ageDays ?? 0) * 86400_000 - 3600_000 - uid * 1000, text: `${subject}.`, html: '', attachments: [], unread: true, starred: false,
      listUnsubscribe: null, listUnsubscribePost: null, listId: extra.listId ?? null, precedence: null, autoSubmitted: null, spamHeader: null, size: 100, isNew: false,
    },
    '1',
  );
  return { threadId: r.threadId, messageId: r.id };
};

/** A gesture as MailActions logs it (the IMAP side is not under test here). */
const gesture = (action: Parameters<EngineContext['patterns']['log']>[0]['action'], m: { threadId: string; messageId: string }, from: string, meta: Record<string, unknown> = {}, listId: string | null = null) =>
  engine.patterns.log({ action, threadId: m.threadId, messageId: m.messageId, accountId: 'acc', fromEmail: from, listId, subject: 's', meta });

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc', 'adam@shop.test', 'Adam', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', 's', '#000', 0)`,
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use) VALUES ('acc-inbox', 'acc', 'INBOX', 'INBOX', 'inbox')`);
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use) VALUES ('acc-receipts', 'acc', 'Receipts', 'Receipts', NULL)`);
});

describe('behaviour analytics', () => {
  it('logs whether a mail was opened, how long it was read and how old it was before a decision', () => {
    const m = mail('team@tool.test', 'Your weekly digest');
    engine.actions.track({ action: 'view', threadId: m.threadId, ms: 4200, meta: { depth: 0.9 } });
    gesture('archive', m, 'team@tool.test');
    const row = engine.db.get<{ opened: number; dwell_ms: number; age_ms: number; mailbox: string; batch: number }>(
      `SELECT opened, dwell_ms, age_ms, mailbox, batch FROM action_log WHERE thread_id = ? AND action = 'archive'`,
      m.threadId,
    )!;
    expect(row).toMatchObject({ opened: 1, dwell_ms: 4200, mailbox: 'inbox', batch: 1 });
    expect(row.age_ms).toBeGreaterThan(3000_000);
    // A reading that reaches the engine a moment after the decision it led to still counts for it.
    const late = mail('team@tool.test', 'Your monthly digest');
    gesture('trash', late, 'team@tool.test');
    engine.actions.track({ action: 'view', threadId: late.threadId, ms: 2500 });
    expect(engine.db.get(`SELECT opened, dwell_ms FROM action_log WHERE thread_id = ? AND action = 'trash'`, late.threadId)).toEqual({ opened: 1, dwell_ms: 2500 });
    // Readings are kept for the analysis but not shown in the user's log.
    expect(engine.patterns.history(50).some((e) => e.action === 'view')).toBe(false);
    expect(engine.patterns.history(50, 0, true).some((e) => e.action === 'view')).toBe(true);
  });

  it('turns « 4 out of 5 deleted without opening » into a habit with a guarded rule', () => {
    const from = 'news@deals.test';
    const list = 'deals.list.test';
    const mails = [1, 2, 3, 4, 5].map((i) => mail(from, `Deal ${i}`, { listId: list }));
    for (const m of mails.slice(0, 4)) gesture('trash', m, from, {}, list);
    const a = engine.behavior.analyze({ days: 30 });
    const habit = a.habits.find((h) => h.dimension === 'list' && h.key === list && h.outcome === 'trash')!;
    expect(habit).toMatchObject({ support: 4, total: 5, share: 0.8, safe: true });
    expect(habit.confidence).toBeCloseTo(wilson(4, 5), 3);
    expect(habit.lift).toBeGreaterThan(1);
    expect(habit.rule!.conditions[0]).toEqual({ field: 'listId', op: 'equals', value: list });
    expect(habit.rule!.conditions.some((c) => c.field === 'tag' && c.op === 'isNot')).toBe(true);
    const group = a.dimensions.list.find((g) => g.key === list)!;
    expect(group.decidedUnopenedShare).toBe(1);
    expect(a.overview.deletedUnopenedShare).toBe(0.8); // the digest read before being deleted is the fifth
    // A week has not gone by: the untouched ones may simply not have been read yet.
    expect(a.habits.some((h) => h.key === list && h.outcome === 'neverOpened')).toBe(false);
  });

  it('suggests filing a sender into the folder most of its mail goes to', () => {
    const from = 'billing@saas.test';
    const mails = [1, 2, 3].map((i) => mail(from, `Receipt #${i}`));
    let suggestion = null;
    for (const m of mails) suggestion = gesture('moveToFolder', m, from, { mailboxId: 'acc-receipts', folder: 'Receipts' }) ?? suggestion;
    const habit = engine.behavior.habits({ days: 30 }).find((h) => h.outcome === 'folder' && h.key === from)!;
    expect(habit).toMatchObject({ target: 'acc-receipts', targetLabel: 'Receipts', share: 1 });
    expect(habit.rule!.actions).toEqual([{ type: 'moveToFolder', value: 'acc-receipts' }]);
    expect(habit.rule!.conditions).toContainEqual({ field: 'account', op: 'equals', value: 'acc' });
    expect(suggestion?.rule.actions).toEqual([{ type: 'moveToFolder', value: 'acc-receipts' }]);
    expect(suggestion?.description).toContain('100');
    expect(ActionSchema.safeParse({ type: 'moveToFolder', value: 'acc-receipts' }).success).toBe(true);
  });

  it('never offers to automate deleting a bank’s mail, even when it is always deleted', () => {
    const from = 'notifications@stripe.com';
    for (const i of [1, 2, 3]) gesture('trash', mail(from, `Payout ${i}`), from);
    const habit = engine.behavior.habits({ days: 30 }).find((h) => (h.key === from || h.key === 'stripe.com') && h.outcome === 'trash')!;
    expect(habit.safe).toBe(false);
    expect(habit.rule).toBeNull();
  });

  it('calls mail « never opened » only after a week, and automates it only for newsletters', () => {
    const list = 'promo.list.test';
    for (const i of [1, 2, 3, 4, 5]) mail('promo@shopnews.test', `Promo week ${i}`, { listId: list, ageDays: 10 });
    for (const i of [1, 2, 3, 4, 5]) mail('julie@gmail.com', `Photos ${i}`, { ageDays: 10 });
    // New mail alone (no gesture) reaches the analysis within seconds; here, at once.
    engine.behavior.invalidate();
    const habits = engine.behavior.habits({ days: 30 });
    const newsletter = habits.find((h) => h.key === list && h.outcome === 'neverOpened')!;
    expect(newsletter).toMatchObject({ support: 5, total: 5, safe: true });
    expect(newsletter.rule!.actions).toEqual([{ type: 'markRead' }, { type: 'archive' }]);
    const friend = habits.find((h) => h.key === 'julie@gmail.com' && h.outcome === 'neverOpened')!;
    expect(friend.rule).toBeNull();
    expect(friend.safe).toBe(false);
  });

  it('never automates throwing away mail the user replies to', () => {
    const from = 'client@agency.test';
    const mails = [1, 2, 3, 4].map((i) => mail(from, `Brief ${i}`));
    gesture('reply', mails[0]!, from);
    for (const m of mails) gesture('archive', m, from);
    const habit = engine.behavior.habits({ days: 30 }).find((h) => (h.key === from || h.key === 'agency.test') && h.outcome === 'archive')!;
    expect(habit.rule).toBeNull();
  });

  it('links sources and categories to where their mail ends', () => {
    const { nodes, edges } = engine.behavior.graph(30);
    expect(nodes.some((n) => n.id === 'folder:acc-receipts')).toBe(true);
    const edge = edges.find((e) => e.from === 'source:saas.test' && e.to === 'folder:acc-receipts')!;
    expect(edge).toMatchObject({ n: 3, share: 1 });
  });
});
