/**
 * Scores models on a labelled set without touching benchmarks.json: the loop used to tune a
 * model on `tune` (dataset.ts) and check it on `holdout` (holdout.ts), which is never tuned on.
 *
 *   tsx bench/eval.ts --models typesafe/jev-1.13,deepseek/deepseek-v4.1-flash --set holdout [--repeat 2]
 */
import { TRIAGE_CASES, type TriageCase } from './dataset';
import { HOLDOUT_CASES } from './holdout';
import { scoreTriage } from './score';
import { keyFromApp } from './key';
import { PROVIDER_KINDS } from '../src/ai/catalog';
import { OpenAiCompatibleClient, parseJsonReply } from '../src/ai/providers';
import { buildTriageRequest } from '../src/ai/prompts';
import { classifyHeuristically, type MailFeatures } from '../src/ai/heuristics';
import { mergeTriage, type ModelTriage } from '../src/ai/merge';
import { buildJevTriage, callJev, isJevModel, parseJevTriage } from '../src/ai/jev';
import { SYSTEM_TAGS } from '../src/ai/taxonomy';
import { AppleCliClient } from './apple-client';
import { atomicRequest, parseAtomicReply } from '../src/ai/atomic';
import { agree, voteTriage } from '../src/ai/consensus';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const models = (args.get('models') ?? 'typesafe/jev-1.13').split(',');
const set = args.get('set') ?? 'tune';
const repeat = Number(args.get('repeat') ?? 1);
/** Prints Jev's raw answers for these case ids. */
const debug = new Set((args.get('debug') ?? '').split(',').filter(Boolean));
const cases = set === 'holdout' ? HOLDOUT_CASES : set === 'all' ? [...TRIAGE_CASES, ...HOLDOUT_CASES] : TRIAGE_CASES;
const baseUrl = PROVIDER_KINDS.zenmux.baseUrl;
const apiKey = keyFromApp(baseUrl, 'ZenMux');

const features = (c: TriageCase): MailFeatures => ({
  subject: c.subject,
  text: c.text,
  html: '',
  from: { name: c.fromName, email: c.from },
  to: [{ email: c.to ?? 'adam@nordlys.studio' }],
  cc: [],
  listUnsubscribe: c.bulk ? '<https://example.test/u>' : null,
  listUnsubscribePost: null,
  listId: c.bulk ? '<list.example.test>' : null,
  precedence: null,
  autoSubmitted: null,
  spamHeader: null,
  attachments: [],
});
const tags = SYSTEM_TAGS.map((t) => ({ id: t.id, name: t.name, description: t.description }));
const businesses = [
  { name: 'Nordlys Studio', description: 'Agence de développement web et mobile : devis, clients, partenariats.' },
  { name: 'Maison Velours', description: 'Boutique e-commerce de linge de maison : commandes, paiements, litiges.' },
];
const businessOf = (c: TriageCase) => (c.business ? businesses.find((b) => c.business!.startsWith(b.name)) : undefined);

let apple: AppleCliClient | undefined;

/** Asks the third model only when the first two disagree. */
/** Marks « no model answered »: scored as the local engine alone. */
const LOCAL: ModelTriage = {};
let arbitrations = 0;
/** Which link of a chain answered, per model. */
const chainUse = new Map<string, number>();
const jsonOut = args.get('json');
const results: Record<string, unknown> = {};
async function ask(model: string, c: TriageCase): Promise<{ data: ModelTriage | null; ms: number; tokens: number }> {
  // The local engine (no model): what the app falls back to when every model of a route fails.
  if (model === 'local') return { data: LOCAL, ms: 0, tokens: 0 };
  if (model.startsWith('chain:')) {
    // A mode's fallback chain: the next model answers only when the previous one fails.
    let last = { data: null as ModelTriage | null, ms: 0, tokens: 0 };
    const started = Date.now();
    for (const m of model.slice('chain:'.length).split('|')) {
      last = await ask(m, c);
      if (last.data) {
        chainUse.set(m, (chainUse.get(m) ?? 0) + 1);
        return { ...last, ms: Date.now() - started };
      }
    }
    return last;
  }
  if (model.startsWith('consensus:')) {
    const [a, b, arbiter] = model.slice('consensus:'.length).split('|');
    const started = Date.now();
    const [ra, rb] = await Promise.all([ask(a!, c), ask(b!, c)]);
    if (!ra.data || !rb.data) return { data: ra.data ?? rb.data, ms: Date.now() - started, tokens: ra.tokens + rb.tokens };
    if (agree(ra.data, rb.data) || !arbiter) return { data: voteTriage([ra.data, rb.data]), ms: Date.now() - started, tokens: ra.tokens + rb.tokens };
    arbitrations++;
    const rc = await ask(arbiter, c);
    return { data: voteTriage([ra.data, rb.data, ...(rc.data ? [rc.data] : [])]), ms: Date.now() - started, tokens: ra.tokens + rb.tokens + rc.tokens };
  }
  const started = Date.now();
  try {
    if (isJevModel(model)) {
      const res = await callJev(baseUrl, apiKey, buildJevTriage({ model, features: features(c), bulk: Boolean(c.bulk), tags, business: businessOf(c), businesses }));
      if (debug.has(c.id)) console.log(`  ${c.id}`, Object.entries(res.answers).map(([k, v]) => `${k}=${v.noul ?? v.choice ?? v.score}`).join(' '));
      return { data: parseJevTriage(res), ms: Date.now() - started, tokens: res.usage?.input_tokens ?? 0 };
    }
    // « <model>+atomic »: Jev's questions asked to a generative model, Jev's truth table on the answers.
    const atomic = model.endsWith('+atomic');
    const base = model.replace(/\+atomic$/, '');
    const client = base === 'apple' ? (apple ??= new AppleCliClient()) : new OpenAiCompatibleClient('eval', 'ZenMux', baseUrl, base, apiKey, 'zenmux');
    if (atomic) {
      const { model: _m, ...jev } = buildJevTriage({ model: '', features: features(c), bulk: Boolean(c.bulk), tags, business: businessOf(c), businesses });
      const { text, usage } = await client.complete(atomicRequest(jev));
      return { data: parseAtomicReply(text, jev), ms: Date.now() - started, tokens: usage?.promptTokens ?? 0 };
    }
    const { text, usage } = await client.complete(buildTriageRequest({ features: features(c), bulk: Boolean(c.bulk), tags, business: businessOf(c), businesses }));
    return { data: parseJsonReply(text) as ModelTriage, ms: Date.now() - started, tokens: usage?.promptTokens ?? 0 };
  } catch (error) {
    console.error(`  ${c.id}: ${(error as Error).message.slice(0, 120)}`);
    return { data: null, ms: Date.now() - started, tokens: 0 };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } }));
  return out;
}

for (const model of models) {
  for (let run = 0; run < repeat; run++) {
    const answers = await pool(cases, model.startsWith('apple') ? 2 : 6, (c) => ask(model, c));
    const scores = cases.map((c, i) => {
      const a = answers[i]!;
      if (!a.data) return scoreTriage(c, null);
      const m = mergeTriage({ heuristic: classifyHeuristically(features(c)), model: a.data === LOCAL ? null : a.data, text: `${c.subject}\n${c.text}`, knownTags: new Set(tags.map((t) => t.id)) });
      return scoreTriage(c, { tags: m.tags, priority: ['low', 'normal', 'high', 'urgent'][m.priority], spam: m.spam, opportunity: m.opportunity, otp: m.otp });
    });
    const mean = (f: (s: (typeof scores)[number]) => number) => Math.round((scores.reduce((t, s) => t + f(s), 0) / scores.length) * 10) / 10;
    const ms = answers.map((a) => a.ms).sort((a, b) => a - b)[Math.floor(answers.length / 2)];
    console.log(`\n${model} [${set}, ${cases.length} cas${repeat > 1 ? `, essai ${run + 1}` : ''}] → ${mean((s) => s.total)} · priorité ${mean((s) => s.priority)} · spam ${mean((s) => s.spam)} · opportunité ${mean((s) => s.opportunity)} · OTP ${mean((s) => s.otp)} · tags ${mean((s) => s.tags)} · p50 ${ms} ms · ${Math.round(answers.reduce((t, a) => t + a.tokens, 0) / answers.length)} jetons/mail${arbitrations ? ` · ${arbitrations} arbitrages` : ''}`);
    scores.forEach((s, i) => s.mistakes.length && console.log(`  ${cases[i]!.id}: ${s.mistakes.join(' ; ')}`));
    results[model] = {
      score: mean((s) => s.total),
      details: { priority: mean((s) => s.priority), spam: mean((s) => s.spam), opportunity: mean((s) => s.opportunity), otp: mean((s) => s.otp), tags: mean((s) => s.tags) },
      latencyP50: ms,
      tokensPerMail: Math.round(answers.reduce((t, a) => t + a.tokens, 0) / answers.length),
      arbitrations,
      cases: cases.length,
      answeredBy: Object.fromEntries(chainUse),
    };
    chainUse.clear();
    arbitrations = 0;
  }
}

apple?.close();
if (jsonOut) (await import('node:fs')).writeFileSync(jsonOut, JSON.stringify(results, null, 2));
