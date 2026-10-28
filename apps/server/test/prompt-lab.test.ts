import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { CompletionRequest, LlmClient } from '../src/ai/providers';
import { DEFAULT_TRIAGE_PROMPT } from '../src/ai/prompt-config';
import { buildTriageRequest } from '../src/ai/prompts';
import { buildJevTriage, jevQuestionTexts } from '../src/ai/jev';
import { createTestEngine } from './helpers';

let engine: EngineContext;

/** A fake triage model: says « spam » when the instructions contain the word FLAGALL. */
class FakeTriage implements LlmClient {
  readonly id = 'fake';
  readonly label = 'Fake';
  readonly model = 'fake/model';
  requests: CompletionRequest[] = [];
  async complete(request: CompletionRequest) {
    this.requests.push(request);
    const spam = request.system.includes('FLAGALL');
    return { text: JSON.stringify({ tags: [], priority: 'normal', spam, opportunity: false, otp: null, summary: 'ok' }) };
  }
}
const fake = new FakeTriage();

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.ai.override = () => [fake];
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc1', 'me@studio.test', 'Me', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', 's', '#000', 0)`,
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use) VALUES ('mb1', 'acc1', 'INBOX', 'INBOX', 'inbox')`);
  const id = engine.store.upsert(
    {
      accountId: 'acc1', mailboxId: 'mb1', uid: 1, messageId: '<m1@t>', inReplyTo: null, references: [], subject: 'Promo du jour', from: { name: 'Shop', email: 'deals@shop.test' },
      to: [{ email: 'me@studio.test' }], cc: [], replyTo: null, deliveredTo: null, date: Date.now(), text: 'Soldes : -30 % sur tout.', html: '', attachments: [], unread: true, starred: false,
      listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, size: 100, isNew: false,
    },
    '1',
  ).id;
  await engine.pipeline.process(id);
  // The user takes it out of spam: that correction becomes a check.
  await engine.actions.notSpam([engine.store.message(id)!.thread_id]).catch(() => undefined);
});

describe('editable prompts', () => {
  it('keeps the reply contract fixed and fills the variables', () => {
    const req = buildTriageRequest(
      { features: { subject: 's', text: 't', html: '', from: { email: 'a@b.test' }, to: [], cc: [], listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, attachments: [] }, bulk: false, tags: [{ id: 'finance', name: 'Finance', description: 'Factures' }], businesses: [] },
      { triage: { llm: 'MES CONSIGNES\n{{tags}}', jev: { questions: {}, thresholds: { yes: 0.8, lean: 0.6 } } } },
    );
    expect(req.system).toMatch(/^Réponds en JSON strict/);
    expect(req.system).toContain('MES CONSIGNES\n- finance : Factures');
    expect(req.jevThresholds).toEqual({ yes: 0.8, lean: 0.6 });
  });

  it('validates, versions and restores', () => {
    expect(() => engine.prompts.save('triage', 'llm', 'Trie bien les mails, merci beaucoup.', { by: 'user' })).toThrow(/\{\{tags\}\}/);
    engine.prompts.save('triage', 'llm', `${DEFAULT_TRIAGE_PROMPT}\nRègle maison.`, { by: 'user', note: 'test' });
    expect(engine.prompts.get().triage.llm).toContain('Règle maison.');
    expect(engine.prompts.customised().triage.llm).toBe(true);
    const previous = engine.prompts.history()[0]!;
    expect(previous.value).toBe(DEFAULT_TRIAGE_PROMPT);
    engine.prompts.restore(previous.id);
    expect(engine.prompts.get().triage.llm).toBe(DEFAULT_TRIAGE_PROMPT);
    expect(engine.prompts.customised().triage.llm).toBe(false);
  });

  it('applies edited Jev questions and stores only what differs', () => {
    const setup = engine.prompts.get().triage.jev;
    const edited = { ...setup, questions: { ...setup.questions, is_promotion: { instructions: 'Is it an ad?', yes: 'An ad.', no: 'Not an ad.' } } };
    engine.prompts.save('triage', 'jev', edited, { by: 'user' });
    const req = buildJevTriage({ model: 'typesafe/jev-1.13', features: { subject: 's', text: 't', html: '', from: { name: 'X', email: 'a@b.test' }, to: [], cc: [], listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null, spamHeader: null, attachments: [] }, bulk: false, tags: [], businesses: [] }, engine.prompts.get().triage.jev);
    expect(req.questions.is_promotion).toMatchObject({ instructions: 'Is it an ad?', criteria: { true: 'An ad.', false: 'Not an ad.' } });
    expect(req.questions.is_security_notice).toMatchObject({ instructions: jevQuestionTexts().is_security_notice!.instructions });
    expect(() => engine.prompts.save('triage', 'jev', { ...setup, questions: { nope: { instructions: 'a', yes: 'b', no: 'c' } } }, { by: 'user' })).toThrow(/inconnue/);
    engine.prompts.reset('triage', 'jev');
    expect(engine.prompts.customised().triage.jev).toBe(false);
  });
});

describe('prompt lab', () => {
  it('turns the user’s corrections into checks', () => {
    const checks = engine.lab.userChecks();
    expect(checks).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'Promo du jour', expect: { spam: false }, because: 'Vous l’avez sorti du spam' })]));
  });

  it('measures a version on the reference set and on the user’s corrections, without saving it', async () => {
    const good = await engine.lab.evaluate();
    const current = engine.prompts.get();
    const bad = await engine.lab.evaluate({ prompts: { ...current, triage: { ...current.triage, llm: `${current.triage.llm}\nFLAGALL` } } });
    expect(good.reference.cases).toBe(85);
    expect(good.yours.total).toBeGreaterThan(0);
    expect(bad.yours.failures.some((f) => f.subject === 'Promo du jour')).toBe(true);
    expect(bad.overall).toBeLessThan(good.overall);
    expect(engine.prompts.get().triage.llm).not.toContain('FLAGALL');
  });

  it('reports the corrections, and the agent explains them', async () => {
    expect(engine.lab.report().corrections[0]).toMatchObject({ subject: 'Promo du jour', action: 'notSpam' });
    const plan = engine.agent.planWithoutModel('Quelles sont les erreurs de tri récentes ?');
    expect(plan.actions[0]?.tool).toBe('triage_report');
    expect(engine.agent.planWithoutModel('Améliore le tri de mes mails').actions[0]?.tool).toBe('improve_triage');
    expect(engine.agent.planWithoutModel('Applique la proposition').actions[0]?.tool).toBe('apply_triage_draft');
  });

  it('exposes the setup with the active format per action', async () => {
    const setup = await engine.lab.setup();
    const triage = setup.actions.find((a) => a.id === 'triage')!;
    expect(triage.formats).toEqual(['llm', 'jev']);
    expect(triage.llm.contract).toMatch(/JSON strict/);
    expect(triage.jev!.questions.length).toBeGreaterThan(20);
    expect(setup.actions.find((a) => a.id === 'chat')!.jev).toBeNull();
  });
});
