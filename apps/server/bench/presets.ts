/**
 * Measures each mode (Gratuit, Équilibré, Maximum) end to end, the way the app routes it:
 * same route (presetRoute), same fallbacks or double check, same guardrails, on the 85
 * labelled mails. Writes src/ai/presets.json, which the AI settings show.
 *
 *   tsx bench/presets.ts            (needs the ZenMux key saved in ZMail, and Apple Intelligence)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROVIDER_KINDS, parseCatalog } from '../src/ai/catalog';
import { JEV_CATALOG } from '../src/ai/jev';
import { BENCHMARKS } from '../src/ai/recommendations';
import { PRESET_IDS, presetRoute, PRESET_MEASURES, type Preset } from '../src/ai/presets';

const file = join(import.meta.dirname, '../src/ai/presets.json');
const current = JSON.parse(readFileSync(file, 'utf8')) as typeof PRESET_MEASURES;
const catalog = [...parseCatalog(await (await fetch(`${PROVIDER_KINDS.zenmux.baseUrl}/models`)).json()), ...JEV_CATALOG];
const providers = [{ id: 'zen', name: 'ZenMux', kind: 'zenmux' as const, available: catalog }];
const appleSpec = current.apple.triageFormat === 'atomic' ? 'apple+atomic' : 'apple';
const spec = (m: string) => (m === 'apple-on-device' ? appleSpec : m);
const costOf = (m: string) => (m.startsWith('apple') ? 0 : (BENCHMARKS.results.find((r) => r.kind === 'zenmux' && r.capability === 'triage' && r.model === m)?.costPer1k ?? 0));

const presets: typeof current.presets = {};
for (const preset of PRESET_IDS as Preset[]) {
  const route = presetRoute(preset, 'triage', { apple: true, providers });
  const models = route.consensus ? [...route.consensus.pair.map((c) => c.model), ...(route.consensus.arbiter ? [route.consensus.arbiter.model] : [])] : route.candidates.map((c) => c.model);
  // Every route ends with the local engine, as in the app.
  const id = route.consensus ? `consensus:${models.map(spec).join('|')}` : `chain:${[...models.map(spec), 'local'].join('|')}`;
  const out = join(tmpdir(), `zmail-preset-${preset}.json`);
  console.log(`${preset}: ${id}`);
  execFileSync('pnpm', ['exec', 'tsx', join(import.meta.dirname, 'eval.ts'), '--models', id, '--set', 'all', '--json', out], { stdio: ['ignore', 'inherit', 'ignore'] });
  const r = (JSON.parse(readFileSync(out, 'utf8')) as Record<string, { score: number; details: Record<string, number>; latencyP50: number; arbitrations: number; cases: number; answeredBy: Record<string, number> }>)[id]!;
  // What a thousand mails cost: each model that answers is paid; the arbiter only when called.
  const costPer1k = route.consensus
    ? costOf(models[0]!) + costOf(models[1]!) + (models[2] ? (r.arbitrations / r.cases) * costOf(models[2]) : 0)
    : Object.entries(r.answeredBy).reduce((t, [m, n]) => t + (n / r.cases) * (m === 'local' ? 0 : costOf(m.replace(/\+atomic$/, ''))), 0);
  presets[preset] = { score: r.score, latencyP50: r.latencyP50, costPer1k: Math.round(costPer1k * 10000) / 10000, details: r.details, models };
}
writeFileSync(file, `${JSON.stringify({ ...current, generatedAt: new Date().toISOString(), dataset: 85, presets }, null, 2)}\n`);
console.log(JSON.stringify(presets, null, 2));
