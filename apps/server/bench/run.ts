/**
 * Benchmarks models per capability with the exact production prompts, then writes
 * src/ai/benchmarks.json (drives routing and forecasts) and docs/benchmarks/RESULTS.md.
 *
 *   tsx bench/run.ts --kind zenmux --from-app --models a,b,c [--concurrency 4]
 *   ZMAIL_BENCH_KEY=… tsx bench/run.ts --kind zenmux --models a,b
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CHAT_CASES, TRIAGE_CASES, type TriageCase } from './dataset';
import { scoreChat, scoreTriage, type TriageScore } from './score';
import { OpenAiCompatibleClient, parseJsonReply, type CompletionRequest } from '../src/ai/providers';
import { PROVIDER_KINDS, parseCatalog, costUsd, type CatalogModel, type ProviderKind } from '../src/ai/catalog';
import { mergeTriage, type ModelTriage } from '../src/ai/merge';
import { JEV_CATALOG, buildJevTriage, callJev, isJevModel, parseJevTriage } from '../src/ai/jev';
import { buildChatRequest, buildTriageRequest } from '../src/ai/prompts';
import { classifyHeuristically, type MailFeatures } from '../src/ai/heuristics';
import { SYSTEM_TAGS } from '../src/ai/taxonomy';
import { Secrets } from '../src/lib/secrets';
import type { BenchmarkFile, BenchmarkResult } from '../src/ai/recommendations';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? 'true' : process.argv[++i]!);
}
const kind = (args.get('kind') ?? 'zenmux') as ProviderKind;
const models = (args.get('models') ?? '').split(',').filter(Boolean);
const concurrency = Number(args.get('concurrency') ?? 4);
const baseUrl = PROVIDER_KINDS[kind].baseUrl;

/** The key the user saved in ZMail: decrypted in memory with the Keychain master key, never printed. */
function keyFromApp(): string {
  const dataDir = join(homedir(), 'Library', 'Application Support', 'ZMail');
  const master = execFileSync('security', ['find-generic-password', '-s', 'com.zippy.zmail', '-a', 'master-key', '-w']).toString().trim();
  const db = new DatabaseSync(join(dataDir, 'zmail.db'), { readOnly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get() as { value: string } | undefined;
  const providers = (JSON.parse(row?.value ?? '{}').providers ?? []) as { baseUrl?: string; apiKey?: string }[];
  const provider = providers.find((p) => p.baseUrl?.startsWith(baseUrl) && p.apiKey);
  if (!provider?.apiKey) throw new Error(`Aucune clé ${kind} enregistrée dans ZMail.`);
  // ZMail.app stores the raw 32 bytes; `security -w` prints binary items as hex.
  const base64 = /^[0-9a-f]{64}$/.test(master) ? Buffer.from(master, 'hex').toString('base64') : master;
  return Secrets.fromKey(base64).decrypt(provider.apiKey);
}

const apiKey = args.has('from-app') ? keyFromApp() : process.env.ZMAIL_BENCH_KEY;
if (!apiKey && PROVIDER_KINDS[kind].needsKey) throw new Error('Clé manquante : --from-app ou ZMAIL_BENCH_KEY.');

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

/** What ZMail ends up showing for a case: same merge as the pipeline. A failed call scores 0. */
const final = (c: TriageCase, model: ModelTriage | null, failed = false) => {
  if (failed) return null;
  const m = mergeTriage({ heuristic: classifyHeuristically(features(c)), model, text: `${c.subject}\n${c.text}`, knownTags: new Set(SYSTEM_TAGS.map((t) => t.id)) });
  return { tags: m.tags, priority: ['low', 'normal', 'high', 'urgent'][m.priority], spam: m.spam, opportunity: m.opportunity, otp: m.otp };
};

const tags = SYSTEM_TAGS.map((t) => ({ id: t.id, name: t.name, description: t.description }));
const businesses = [
  { name: 'Nordlys Studio', description: 'Agence de développement web et mobile : devis, clients, partenariats.' },
  { name: 'Maison Velours', description: 'Boutique e-commerce de linge de maison : commandes, paiements, litiges.' },
];

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

type Call = { ok: boolean; latency: number; prompt: number; completion: number; data: unknown; error?: string };

async function call(client: OpenAiCompatibleClient, request: CompletionRequest): Promise<Call> {
  const started = Date.now();
  try {
    const { text, usage } = await client.complete(request);
    const latency = Date.now() - started;
    let data: unknown = null;
    try {
      data = parseJsonReply(text);
    } catch {
      data = null;
    }
    return { ok: data !== null && typeof data === 'object', latency, prompt: usage?.promptTokens ?? 0, completion: usage?.completionTokens ?? 0, data };
  } catch (error) {
    return { ok: false, latency: Date.now() - started, prompt: 0, completion: 0, data: null, error: (error as Error).message.slice(0, 160) };
  }
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

async function main() {
  const catalogRes = await fetch(`${baseUrl}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
  const catalog = [...parseCatalog(await catalogRes.json()), ...JEV_CATALOG];
  const priceOf = (id: string): CatalogModel | undefined => catalog.find((m) => m.id === id);

  const results: BenchmarkResult[] = [];
  const failures: Record<string, string[]> = {};

  // Reference: the local heuristic engine, scored on the same cases.
  const local = TRIAGE_CASES.map((c) => scoreTriage(c, final(c, null)));

  for (const model of models) {
    if (isJevModel(model)) {
      // Jev answers typed questions, not prompts: triage only, through /systemone.
      process.stdout.write(`${model} … `);
      const calls = await pool(TRIAGE_CASES, concurrency, async (c): Promise<Call> => {
        const started = Date.now();
        try {
          const request = buildJevTriage({ model, features: features(c), bulk: Boolean(c.bulk), tags, business: c.business ? businesses.find((b) => c.business!.startsWith(b.name)) : undefined, businesses });
          const response = await callJev(baseUrl, apiKey!, request);
          return { ok: true, latency: Date.now() - started, prompt: response.usage?.input_tokens ?? 0, completion: response.usage?.output_tokens ?? 0, data: parseJevTriage(response) };
        } catch (error) {
          return { ok: false, latency: Date.now() - started, prompt: 0, completion: 0, data: null, error: (error as Error).message.slice(0, 160) };
        }
      });
      const scores = calls.map((r, i) => scoreTriage(TRIAGE_CASES[i]!, final(TRIAGE_CASES[i]!, r.ok ? (r.data as ModelTriage) : null, !r.ok)));
      const raw = calls.map((r, i) => scoreTriage(TRIAGE_CASES[i]!, r.ok ? (r.data as Record<string, unknown>) : null));
      failures[model] = [...calls.flatMap((r, i) => (r.error ? [`${TRIAGE_CASES[i]!.id}: ${r.error}`] : [])), ...scores.flatMap((s, i) => s.mistakes.map((m) => `${TRIAGE_CASES[i]!.id}: ${m}`))];
      const ok = calls.filter((c) => c.prompt > 0);
      const promptTokens = Math.round(mean(ok.map((c) => c.prompt)));
      const price = priceOf(model);
      const perCall = price ? costUsd(price, promptTokens, 0) : null;
      results.push({
        kind,
        model,
        capability: 'triage',
        score: Math.round(mean(scores.map((s) => s.total)) * 10) / 10,
        validJson: calls.filter((c) => c.ok).length / calls.length,
        latencyP50: percentile(calls.map((c) => c.latency), 0.5),
        latencyP95: percentile(calls.map((c) => c.latency), 0.95),
        promptTokens,
        completionTokens: Math.round(mean(ok.map((c) => c.completion))),
        costPer1k: perCall === null ? null : Math.round(perCall * 1000 * 10000) / 10000,
        details: {
          priority: mean(scores.map((s) => s.priority)),
          spam: mean(scores.map((s) => s.spam)),
          opportunity: mean(scores.map((s) => s.opportunity)),
          otp: mean(scores.map((s) => s.otp)),
          tags: mean(scores.map((s) => s.tags)),
          raw: mean(raw.map((s) => s.total)),
        },
      });
      const t = results.at(-1)!;
      console.log(`tri ${t.score} (réponses ${Math.round(t.validJson * 100)} %, p50 ${t.latencyP50} ms) · agent n/a`);
      continue;
    }
    const client = new OpenAiCompatibleClient('bench', PROVIDER_KINDS[kind].name, baseUrl, model, apiKey, kind);
    process.stdout.write(`${model} … `);
    const triageCalls = await pool(TRIAGE_CASES, concurrency, (c) =>
      call(client, buildTriageRequest({ features: features(c), bulk: Boolean(c.bulk), tags, business: c.business ? businesses.find((b) => c.business!.startsWith(b.name)) : undefined, businesses })),
    );
    // Scored on what ZMail shows (model inside its guardrails); the raw answer is kept for reference.
    const triageScores: TriageScore[] = triageCalls.map((r, i) => scoreTriage(TRIAGE_CASES[i]!, final(TRIAGE_CASES[i]!, r.ok ? (r.data as ModelTriage) : null, !r.ok)));
    const rawScores: TriageScore[] = triageCalls.map((r, i) => scoreTriage(TRIAGE_CASES[i]!, r.ok ? (r.data as Record<string, unknown>) : null));
    const chatCalls = await pool(CHAT_CASES, concurrency, (c) =>
      call(client, buildChatRequest({ message: c.message, history: [], tags: tags.map((t) => `${t.id} (${t.name})`).join(', '), businesses: businesses.map((b) => b.name).join(', ') })),
    );
    const chatScores = chatCalls.map((r, i) => (r.ok ? scoreChat(CHAT_CASES[i]!, r.data) : 0));
    failures[model] = [
      ...triageCalls.flatMap((r, i) => (r.error ? [`${TRIAGE_CASES[i]!.id}: ${r.error}`] : !r.ok ? [`${TRIAGE_CASES[i]!.id}: JSON invalide`] : [])),
      ...triageScores.flatMap((s, i) => s.mistakes.map((m) => `${TRIAGE_CASES[i]!.id}: ${m}`)),
      ...chatCalls.flatMap((r, i) => (chatScores[i]! < 100 ? [`chat ${CHAT_CASES[i]!.id}: ${r.error ?? JSON.stringify(r.data)?.slice(0, 120)}`] : [])),
    ];
    const price = priceOf(model);
    const push = (capability: 'triage' | 'chat', calls: Call[], scores: number[], details: Record<string, number>) => {
      const ok = calls.filter((c) => c.prompt > 0);
      const promptTokens = Math.round(mean(ok.map((c) => c.prompt)));
      const completionTokens = Math.round(mean(ok.map((c) => c.completion)));
      const perCall = price ? costUsd(price, promptTokens, completionTokens) : null;
      results.push({
        kind,
        model,
        capability,
        score: Math.round(mean(scores) * 10) / 10,
        validJson: calls.filter((c) => c.ok).length / calls.length,
        latencyP50: percentile(calls.map((c) => c.latency), 0.5),
        latencyP95: percentile(calls.map((c) => c.latency), 0.95),
        promptTokens,
        completionTokens,
        costPer1k: perCall === null ? null : Math.round(perCall * 1000 * 10000) / 10000,
        details,
      });
    };
    push('triage', triageCalls, triageScores.map((s) => s.total), {
      priority: mean(triageScores.map((s) => s.priority)),
      spam: mean(triageScores.map((s) => s.spam)),
      opportunity: mean(triageScores.map((s) => s.opportunity)),
      otp: mean(triageScores.map((s) => s.otp)),
      tags: mean(triageScores.map((s) => s.tags)),
      raw: mean(rawScores.map((s) => s.total)),
    });
    push('chat', chatCalls, chatScores, {});
    const t = results.at(-2)!;
    const c = results.at(-1)!;
    console.log(`tri ${t.score} (JSON ${Math.round(t.validJson * 100)} %, p50 ${t.latencyP50} ms) · agent ${c.score}`);
  }

  // The unsubscribe capability reads short pages: triage quality and price are the right proxy.
  for (const t of results.filter((r) => r.capability === 'triage' && !isJevModel(r.model))) {
    const price = priceOf(t.model);
    const perCall = price ? costUsd(price, 750, 40) : null;
    results.push({ ...t, capability: 'unsubscribe', promptTokens: 750, completionTokens: 40, costPer1k: perCall === null ? null : Math.round(perCall * 1000 * 10000) / 10000 });
  }

  const file = join(import.meta.dirname, '../src/ai/benchmarks.json');
  const previous = JSON.parse(readFileSync(file, 'utf8')) as BenchmarkFile;
  const merged: BenchmarkFile = {
    generatedAt: new Date().toISOString(),
    dataset: { triage: TRIAGE_CASES.length, chat: CHAT_CASES.length },
    results: [...previous.results.filter((r) => !(r.kind === kind && models.includes(r.model))), ...results],
  };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  writeReport(merged, mean(local.map((s) => s.total)), local, failures, catalog);
  console.log(`\nmoteur local (heuristiques) : tri ${Math.round(mean(local.map((s) => s.total)) * 10) / 10}`);
}

function writeReport(file: BenchmarkFile, localScore: number, local: TriageScore[], failures: Record<string, string[]>, catalog: CatalogModel[]) {
  const dir = join(import.meta.dirname, '../../../docs/benchmarks');
  mkdirSync(dir, { recursive: true });
  const triage = file.results.filter((r) => r.capability === 'triage').sort((a, b) => b.score - a.score);
  const chat = new Map(file.results.filter((r) => r.capability === 'chat').map((r) => [`${r.kind}/${r.model}`, r]));
  const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v)}`);
  const money = (v: number | null) => (v === null ? '—' : v < 0.01 ? `${(v * 100).toFixed(3)} ¢` : `${v.toFixed(3)} $`);
  const price = (id: string) => {
    const m = catalog.find((x) => x.id === id);
    return m ? `${m.inputPrice} / ${m.outputPrice}` : '—';
  };
  const lines = [
    '# Benchmarks des modèles',
    '',
    `Généré le ${file.generatedAt} — ${file.dataset?.triage} mails étiquetés (tri) et ${file.dataset?.chat} commandes (agent), avec les prompts de production. Script : \`apps/server/bench/run.ts\`.`,
    '',
    'Score de tri sur 100 par mail : priorité 30 (exacte, ou 15 à un cran près), spam 20, OTP exact 20, opportunité 15, tags 15. Un JSON invalide vaut 0. Score agent : bon outil choisi (et bons arguments quand vérifiés).',
    '',
    '| Modèle | Tri | Priorité | Spam | Opport. | OTP | Tags | JSON valide | Latence p50 / p95 | Agent | Prix $/M (entrée / sortie) | Coût / 1 000 mails |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...triage.map((r) => {
      const c = chat.get(`${r.kind}/${r.model}`);
      return `| \`${r.model}\` | **${r.score}** | ${pct(r.details.priority)} | ${pct(r.details.spam)} | ${pct(r.details.opportunity)} | ${pct(r.details.otp)} | ${pct(r.details.tags)} | ${Math.round(r.validJson * 100)} % | ${(r.latencyP50 / 1000).toFixed(1)} s / ${(r.latencyP95 / 1000).toFixed(1)} s | ${c ? c.score : '—'} | ${price(r.model)} | ${money(r.costPer1k)} |`;
    }),
    `| _Moteur local (sans IA)_ | **${Math.round(localScore * 10) / 10}** | ${pct(mean(local.map((s) => s.priority)))} | ${pct(mean(local.map((s) => s.spam)))} | ${pct(mean(local.map((s) => s.opportunity)))} | ${pct(mean(local.map((s) => s.otp)))} | ${pct(mean(local.map((s) => s.tags)))} | — | < 1 ms | — | gratuit | 0 |`,
    '',
    '## Erreurs par modèle',
    '',
    ...Object.entries(failures).flatMap(([model, errors]) => [`### \`${model}\``, '', ...(errors.length ? errors.slice(0, 15).map((e) => `- ${e}`) : ['- aucune']), '']),
  ];
  writeFileSync(join(dir, 'RESULTS.md'), `${lines.join('\n')}\n`);
}

await main();
