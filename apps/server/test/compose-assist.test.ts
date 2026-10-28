import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import type { IncomingMessage } from '../src/mail/store';
import { createTestEngine } from './helpers';

/** The composer's assistant: context gathering, and no address the model was not given. */
let engine: EngineContext;
let threadId = '';

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc', 'me@zmail.test', 'Me', 'custom', '127.0.0.1', 1, 0, '127.0.0.1', 1, 0, 'me', ?, '#3B82F6', ?)`,
    engine.secrets.encrypt('x'),
    Date.now(),
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('mb', 'acc', 'INBOX', 'INBOX', 'inbox', '1')`);
  const msg: IncomingMessage = {
    accountId: 'acc', mailboxId: 'mb', uid: -1, messageId: '<devis@acme.test>', inReplyTo: null, references: [],
    subject: 'Devis application mobile', from: { name: 'Claire Martin', email: 'claire@acme.test' }, to: [{ email: 'me@zmail.test' }], cc: [],
    replyTo: null, deliveredTo: null, date: Date.now() - 3_600_000, text: 'Pouvez-vous nous envoyer un devis ?', html: '', attachments: [],
    unread: true, starred: false, listUnsubscribe: null, listUnsubscribePost: null, listId: null, precedence: null, autoSubmitted: null,
    spamHeader: null, size: 100, isNew: true,
  };
  threadId = engine.store.upsert(msg, '1').threadId;
});

describe('compose assistant', () => {
  it('gives the model the matching contacts and threads, and keeps only real addresses', async () => {
    let seen = '';
    engine.ai.complete = (async (_capability: string, request: { prompt: string }) => {
      seen = request.prompt;
      return { text: '', provider: 'test', model: 'test-model', latencyMs: 1, data: { to: ['claire@acme.test', 'invente@nulle-part.test'], subject: 'Re: Devis application mobile', body: 'Bonjour Claire,\n\nVoici le devis.', replyToThreadId: threadId, fileQueries: [], note: 'Réponse prête.' } };
    }) as unknown as EngineContext['ai']['complete'];
    const draft = await engine.composeAssistant.draft({ instruction: 'réponds à Claire de chez Acme que le devis arrive demain' });
    expect(seen).toContain('claire@acme.test');
    expect(seen).toContain(`id=${threadId}`);
    expect(draft.to).toEqual(['claire@acme.test']);
    expect(draft.replyToThreadId).toBe(threadId);
    expect(draft.body).toContain('Bonjour Claire');
    expect(draft.engine).toBe('test-model');
  });

  it('includes the thread history when replying from a thread', async () => {
    let seen = '';
    engine.ai.complete = (async (_c: string, request: { prompt: string }) => ((seen = request.prompt), { text: '', provider: 't', model: 't', latencyMs: 1, data: { body: 'ok' } })) as unknown as EngineContext['ai']['complete'];
    const draft = await engine.composeAssistant.draft({ instruction: 'dis-lui oui', threadId });
    expect(seen).toContain('Pouvez-vous nous envoyer un devis ?');
    expect(draft.replyToThreadId).toBe(threadId);
  });

  it('says clearly when no AI can write', async () => {
    engine.ai.complete = (async () => null) as unknown as EngineContext['ai']['complete'];
    await expect(engine.composeAssistant.draft({ instruction: 'écris à Claire' })).rejects.toThrow(/Aucune IA/);
  });

  it('refuses to read a file it did not propose', async () => {
    await expect(engine.composeAssistant.readOffered('att_unknown')).rejects.toThrow(/inconnue/);
  });
});
