import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { createTestEngine } from './helpers';
import { OpenAiCompatibleClient, routePicks } from '../src/ai/providers';
import { JEV_CATALOG } from '../src/ai/jev';
import { presetRoute, type Provider } from '../src/ai/presets';
import { agree, voteTriage } from '../src/ai/consensus';
import { recommendedModels, rankBenchmarks } from '../src/ai/recommendations';

/**
 * The model path, against a fake OpenAI-compatible endpoint (the protocol ZenMux, OpenRouter,
 * OpenAI and Ollama share). Checks routing, JSON parsing, and that model output is validated.
 */
let engine: EngineContext;
let server: Server;
const requests: { model: string; system: string; prompt: string; auth?: string; keys: string[] }[] = [];
let nextReply: (prompt: string) => string = () => '{}';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            data: [
              { id: 'acme/large', display_name: 'Acme Large', output_modalities: ['text'], pricings: { prompt: [{ value: 2 }], completion: [{ value: 8 }] } },
              { id: 'acme/small', display_name: 'Acme Small', output_modalities: ['text'], pricings: { prompt: [{ value: 0.1 }], completion: [{ value: 0.4 }] } },
              { id: 'acme/embed', display_name: 'Acme Embed', output_modalities: ['embeddings'], pricings: { prompt: [{ value: 0.01 }], completion: [] } },
            ],
          }),
        );
      }
      const payload = JSON.parse(body);
      if (payload.model === 'strict/no-temperature' && 'temperature' in payload) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: '`temperature` is deprecated for this model.' } }));
      }
      const system = payload.messages[0].content as string;
      const prompt = payload.messages[1].content as string;
      requests.push({ model: payload.model, system, prompt, auth: req.headers.authorization, keys: Object.keys(payload) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: nextReply(prompt) } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(47950, '127.0.0.1', () => r()));

  ({ engine } = await createTestEngine());
  const settings = engine.ai.settings();
  engine.ai.saveSettings({
    ...settings,
    providers: [
      ...settings.providers,
      { id: 'zen', type: 'openai', kind: 'custom', name: 'ZenMux', baseUrl: 'http://127.0.0.1:47950/api/v1', apiKey: engine.secrets.encrypt('sk-zen-test'), enabled: true },
    ],
  });
  await engine.ai.catalog.models('custom', 'http://127.0.0.1:47950/api/v1', 'sk-zen-test', true);
  // These tests are about a paid service; « Gratuit » (the default) would rightly never call it.
  engine.ai.setPreset('balanced');

  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc1', 'me@studio.test', 'Me', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', 's', '#000', 0)`,
  );
  engine.db.run(`INSERT INTO mailboxes (id, account_id, path, name, special_use) VALUES ('mb1', 'acc1', 'INBOX', 'INBOX', 'inbox')`);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const insert = (id: string, subject: string, text: string, from = 'client@corp.test') =>
  engine.store.upsert(
    {
      accountId: 'acc1',
      mailboxId: 'mb1',
      uid: Number(id.replace(/\D/g, '')),
      messageId: `<${id}@t>`,
      inReplyTo: null,
      references: [],
      subject,
      from: { name: 'Client', email: from },
      to: [{ email: 'me@studio.test' }],
      cc: [],
      replyTo: null,
      deliveredTo: null,
      date: Date.now(),
      text,
      html: '',
      attachments: [],
      unread: true,
      starred: false,
      listUnsubscribe: null,
      listUnsubscribePost: null,
      listId: null,
      precedence: null,
      autoSubmitted: null,
      spamHeader: null,
      size: 100,
      isNew: false,
    },
    '1',
  ).id;

describe('OpenAI-compatible provider (ZenMux)', () => {
  it('routes each capability to a model without the user choosing one', async () => {
    const plan = await engine.ai.plan('triage');
    // Unbenchmarked service: its cheapest text models, embeddings excluded, Apple skipped (unavailable).
    expect(plan.candidates.map((c) => `${c.providerId}:${c.model}:${c.source}`)).toEqual(['zen:acme/small:recommended', 'zen:acme/large:recommended']);
  });

  it('lets a per-capability override win, keeping the automatic picks as relays', async () => {
    const settings = engine.ai.settings();
    engine.ai.saveSettings({ ...settings, overrides: { chat: { providerId: 'zen', model: 'acme/large' } } });
    expect((await engine.ai.plan('chat')).candidates.map((c) => c.model)).toEqual(['acme/large', 'acme/small']);
    expect((await engine.ai.plan('triage')).candidates[0]!.model).toBe('acme/small');
    engine.ai.saveSettings({ ...settings, overrides: {} });
  });

  it('records real usage and cost from the catalog price', async () => {
    nextReply = () => '{"tags":[],"priority":"low","spam":false,"opportunity":false,"otp":null,"summary":"Test."}';
    await engine.ai.complete('triage', { system: 's', prompt: 'p', json: true });
    const row = engine.ai.usageSummary(1).find((u) => u.model === 'acme/small');
    expect(row?.calls).toBeGreaterThanOrEqual(1);
  });

  it('classifies with the model, sending tags and business context', async () => {
    nextReply = () =>
      '```json\n{"tags":["opportunity","made-up-tag"],"priority":"high","spam":false,"opportunity":true,"opportunityReason":"Demande de refonte avec budget","otp":null,"summary":"Demande un devis pour refondre son site."}\n```';
    const id = insert('m1', 'Refonte de notre site', 'Bonjour, pouvez-vous chiffrer la refonte de notre site ? Budget 12k.');
    const triage = await engine.pipeline.process(id);
    expect(triage).toMatchObject({ engine: 'acme/small', priority: 2, opportunity: true, summary: 'Demande un devis pour refondre son site.' });
    expect(triage!.tags).toEqual(expect.arrayContaining(['opportunity', 'important']));
    expect(triage!.tags).not.toContain('made-up-tag');
    const last = requests.at(-1)!;
    expect(last.model).toBe('acme/small');
    expect(last.auth).toBe('Bearer sk-zen-test');
    expect(last.system).toContain('- chargeback :');
    expect(last.prompt).toContain('Objet : Refonte de notre site');
  });

  it('rejects an OTP the model invented', async () => {
    nextReply = () => '{"tags":["security"],"priority":"high","spam":false,"opportunity":false,"otp":"000111","summary":"Code de connexion."}';
    const id = insert('m2', 'Votre code', 'Votre code de connexion est 734920.');
    const triage = await engine.pipeline.process(id);
    expect(triage!.otp).toBe('734920');
  });

  it('falls back to heuristics when the provider fails', async () => {
    nextReply = () => 'not json at all';
    const id = insert('m3', 'Litige ouvert : chargeback', 'Un client a contesté un paiement de 80 €.');
    const triage = await engine.pipeline.process(id);
    expect(triage!.engine).toBe('heuristic');
    expect(triage!.priority).toBe(3);
  });

  it('lets the chat agent call tools', async () => {
    nextReply = () =>
      JSON.stringify({
        reply: 'C’est fait, je vous préviendrai pour chaque facture fournisseur.',
        actions: [{ tool: 'create_tag', args: { name: 'Fournisseurs', description: 'Factures et échanges avec nos fournisseurs' } }],
      });
    const reply = await engine.agent.chat('Crée un tag fournisseurs', []);
    expect(reply.engine).toBe('acme/small');
    expect(reply.steps).toEqual([expect.objectContaining({ tool: 'create_tag', ok: true })]);
    expect(engine.catalog.tags().some((t) => t.name === 'Fournisseurs' && t.kind === 'custom')).toBe(true);
  });

  it('reports provider health', async () => {
    nextReply = () => 'OK';
    const result = await engine.ai.test(engine.ai.settings().providers.find((p) => p.id === 'zen')!);
    expect(result).toMatchObject({ ok: true, reply: 'OK', model: 'acme/small', models: 2 });
  });

  it('drops a parameter the model rejects instead of failing (Claude Haiku on ZenMux)', async () => {
    nextReply = () => 'OK';
    const client = new OpenAiCompatibleClient('zen', 'ZenMux', 'http://127.0.0.1:47950/api/v1', 'strict/no-temperature', 'k', 'zenmux');
    const { text } = await client.complete({ system: 's', prompt: 'p', reasoning: 'off' });
    expect(text).toBe('OK');
    const last = requests.at(-1)!;
    expect(last.model).toBe('strict/no-temperature');
    expect(last.keys).not.toContain('temperature');
    expect(last.keys).toEqual(expect.arrayContaining(['reasoning', 'reasoning_effort']));
  });
});

describe('benchmark-driven routing', () => {
  const catalog = ['google/gemini-2.5-flash-lite', 'deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'openai/gpt-4.1-mini'].map((id) => ({ id, name: id, inputPrice: 0.1, outputPrice: 0.4, contextLength: null, reasoning: false }));

  it('never recommends a model that failed the benchmark', () => {
    const picks = recommendedModels('zenmux', 'triage', catalog);
    // The winner changes when benchmarks.json is regenerated; the rule does not.
    const best = rankBenchmarks('zenmux', 'triage').find((r) => catalog.some((m) => m.id === r.model))!;
    expect(picks[0]).toBe(best.model);
    expect(best.score).toBeGreaterThanOrEqual(80);
    expect(picks).not.toContain('z-ai/glm-5.3-flash');
    expect(rankBenchmarks('zenmux', 'triage').at(-1)!.score).toBeLessThan(80);
  });

  it('sorts with Jev on ZenMux, with an LLM (not another Jev) as the relay', () => {
    const picks = recommendedModels('zenmux', 'triage', [...catalog, ...JEV_CATALOG]);
    expect(picks[0]).toMatch(/^typesafe\/jev/);
    const route = routePicks(picks);
    expect(route).toHaveLength(2);
    expect(route[1]).not.toMatch(/^typesafe\//);
    // Jev writes no text: never picked for the agent.
    expect(recommendedModels('zenmux', 'chat', [...catalog, ...JEV_CATALOG])).not.toContain('typesafe/jev-1.13');
  });

  it('falls back to vetted models on a service without benchmarks', () => {
    expect(recommendedModels('openrouter', 'triage', [{ ...catalog[0]!, id: 'qwen/qwen3.7-flash' }, { ...catalog[0]!, id: 'free/unknown', inputPrice: 0, outputPrice: 0 }])).toEqual(['qwen/qwen3.7-flash']);
  });
});

describe('modes (Gratuit, Équilibré, Maximum)', () => {
  const price = (id: string, p: number) => ({ id, name: id, inputPrice: p, outputPrice: p, contextLength: null, reasoning: false });
  const zen: Provider = {
    id: 'zen',
    name: 'ZenMux',
    kind: 'zenmux',
    available: [price('deepseek/deepseek-v4.1-flash', 0.3), price('qwen/qwen3.8-flash', 0.4), price('inclusionai/ling-3.1-flash', 0), ...JEV_CATALOG],
  };
  const models = (r: ReturnType<typeof presetRoute>) => r.candidates.map((c) => c.model);

  it('Gratuit never routes to a paid model', () => {
    const route = presetRoute('free', 'triage', { apple: true, providers: [zen], appleMeasures: { triage: { score: 95, latencyP50: 5000 } } });
    expect(models(route)).toEqual(expect.arrayContaining(['inclusionai/ling-3.1-flash', 'apple-on-device']));
    expect(models(route).every((m) => m === 'apple-on-device' || m === 'inclusionai/ling-3.1-flash')).toBe(true);
    expect(models(presetRoute('free', 'triage', { apple: true, providers: [], appleMeasures: { triage: { score: 95, latencyP50: 5000 } } }))).toEqual(['apple-on-device']);
  });

  it('Équilibré picks the best value paid model, with a different kind of model as relay', () => {
    const route = presetRoute('balanced', 'triage', { apple: false, providers: [zen] });
    expect(models(route)[0]).toMatch(/^typesafe\/jev/);
    expect(models(route)[1]).not.toMatch(/^typesafe\//);
  });

  it('Maximum double-checks sorting with two kinds of model and an arbiter', () => {
    const route = presetRoute('max', 'triage', { apple: false, providers: [zen] });
    expect(route.consensus?.pair.map((c) => c.model)[0]).toMatch(/^typesafe\/jev/);
    expect(route.consensus?.pair[1].model).not.toMatch(/^typesafe\//);
    expect(route.consensus?.arbiter).toBeDefined();
    expect(presetRoute('max', 'chat', { apple: false, providers: [zen] }).consensus).toBeUndefined();
  });

  it('settles a disagreement by majority', () => {
    const jev = { spam: false, priority: 'high', otp: '482913', tags: ['security'] };
    const llm = { spam: true, priority: 'low', otp: null, tags: [] };
    expect(agree(jev, llm)).toBe(false);
    const third = { spam: false, priority: 'high', otp: '482913', tags: ['security'], summary: 'Code de connexion.' };
    expect(voteTriage([jev, llm, third])).toMatchObject({ spam: false, priority: 'high', otp: '482913', tags: ['security'], summary: 'Code de connexion.' });
  });
});
