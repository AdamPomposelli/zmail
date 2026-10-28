import type { Capability } from './capabilities';
import type { CatalogModel, ProviderKind } from './catalog';
import { isJevModel } from './jev';
import { rankBenchmarks, type BenchmarkResult } from './recommendations';
import measured from './presets.json';

/**
 * The three modes of the AI settings, shown as Free (`free`), Business (`balanced`) and Ultra
 * (`max`). A mode only decides which models sort the mail and how they work together; the
 * user never has to know about ZenMux, Apple Intelligence or Jev.
 *
 * - free: only what costs nothing — Apple Intelligence on the Mac and free models, best
 *   measured first; the local engine when none answers.
 * - balanced: Apple Intelligence when it is about as good as the paid models, otherwise the
 *   paid model with the best quality for the price (Jev for sorting).
 * - max: the best models, and for sorting two of them check every mail; a third decides when
 *   they disagree.
 */
export type Preset = 'free' | 'balanced' | 'max';
export const PRESET_IDS: Preset[] = ['free', 'balanced', 'max'];
export const DEFAULT_PRESET: Preset = 'free';

/** Benchmarks of Apple Intelligence and of each mode end to end (bench/presets.ts). */
export type PresetMeasure = { score: number; latencyP50: number; costPer1k: number; details: Record<string, number>; models: string[] };
export const PRESET_MEASURES = measured as {
  generatedAt: string | null;
  dataset: number;
  /** ZMail's own engine, without any AI: a model that does worse is never worth calling. */
  localTriageScore?: number;
  apple: Partial<Record<Capability, { score: number; latencyP50: number }>> & { triageFormat?: 'atomic' | 'prompt' };
  presets: Partial<Record<Preset, PresetMeasure>>;
};

/** Apple Intelligence may lead « balanced » when within this many points of the best paid pick… */
const APPLE_TOLERANCE = 3;
/** …and fast enough for the task (sorting runs in the background; the chat is read live). */
const APPLE_MAX_LATENCY: Record<Capability, number> = { triage: 8000, chat: 4000, unsubscribe: 10000 };
const MIN_SCORE = 80;

export type Candidate = { providerId: string; providerName: string; model: string; source: 'override' | 'recommended' | 'apple' };
export type Provider = { id: string; name: string; kind: ProviderKind; available: CatalogModel[] };
export type PresetRoute = { candidates: Candidate[]; consensus?: { pair: [Candidate, Candidate]; arbiter?: Candidate } };

const APPLE: Candidate = { providerId: 'apple', providerName: 'Apple Intelligence', model: 'apple-on-device', source: 'apple' };

type Measured = BenchmarkResult & { provider: Provider; free: boolean };

/** Every measured model the user can reach, with whether it costs nothing. */
function reachable(capability: Capability, providers: Provider[]): Measured[] {
  return providers.flatMap((provider) => {
    const ids = new Map(provider.available.map((m) => [m.id, m]));
    return rankBenchmarks(provider.kind, capability)
      .filter((r) => r.score >= MIN_SCORE && (ids.size === 0 || ids.has(r.model)))
      .map((r) => {
        const price = ids.get(r.model);
        return { ...r, provider, free: provider.kind === 'ollama' || (price?.inputPrice === 0 && price?.outputPrice === 0) };
      });
  });
}

const asCandidate = (m: Measured): Candidate => ({ providerId: m.provider.id, providerName: m.provider.name, model: m.model, source: 'recommended' });
const value = (r: BenchmarkResult) => r.score - (r.costPer1k ?? 0) * 4 - r.latencyP50 / 1000;

export function presetRoute(preset: Preset, capability: Capability, input: { apple: boolean; providers: Provider[]; appleMeasures?: typeof PRESET_MEASURES.apple }): PresetRoute {
  const models = reachable(capability, input.providers);
  const appleMeasure = (input.appleMeasures ?? PRESET_MEASURES.apple)[capability];
  // Apple Intelligence only where it was measured, and better than ZMail's engine without AI
  // (measured: excellent at the chat, below the local engine at sorting mail).
  const floor = capability === 'triage' ? Math.max(MIN_SCORE, PRESET_MEASURES.localTriageScore ?? 0) : MIN_SCORE;
  const apple = input.apple && appleMeasure && appleMeasure.score >= floor ? { candidate: APPLE, score: appleMeasure.score, latency: appleMeasure.latencyP50 } : null;
  // Free cloud models are promotions with tight quotas: fine for « free », not something the paid modes rely on.
  const paid = models.filter((m) => !m.free);

  if (preset === 'free') {
    const free = [...models.filter((m) => m.free).map((m) => ({ candidate: asCandidate(m), score: m.score, latency: m.latencyP50 })), ...(apple ? [apple] : [])];
    free.sort((a, b) => b.score - a.score || a.latency - b.latency);
    const chain = free.map((f) => f.candidate);
    return { candidates: chain };
  }

  const byValue = [...paid].sort((a, b) => value(b) - value(a));
  if (preset === 'balanced') {
    const best = byValue[0];
    const appleFirst = apple && (!best || (apple.score >= best.score - APPLE_TOLERANCE && apple.latency <= APPLE_MAX_LATENCY[capability]));
    const relay = byValue.find((m) => !isJevModel(m.model) && m !== best);
    const chain = appleFirst ? [APPLE, ...(best ? [asCandidate(best)] : [])] : [...(best ? [asCandidate(best)] : []), ...(relay && best && isJevModel(best.model) ? [asCandidate(relay)] : byValue.slice(1, 2).map(asCandidate)), ...(apple ? [APPLE] : [])];
    return { candidates: dedupe(chain) };
  }

  // max: quality first, speed second.
  const byQuality = [...paid].sort((a, b) => b.score - a.score || a.latencyP50 - b.latencyP50);
  const llms = byQuality.filter((m) => !isJevModel(m.model));
  if (capability === 'triage') {
    // Two different kinds of model on every mail: Jev (typed questions) and the best LLM.
    const jev = byValue.find((m) => isJevModel(m.model));
    const [first, second, third] = jev ? [jev, llms[0], llms[1]] : [llms[0], llms[1], llms[2]];
    if (first && second) {
      const pair: [Candidate, Candidate] = [asCandidate(first), asCandidate(second)];
      return { candidates: dedupe([...pair, ...(third ? [asCandidate(third)] : []), ...(apple ? [APPLE] : [])]), consensus: { pair, arbiter: third ? asCandidate(third) : undefined } };
    }
  }
  return { candidates: dedupe([...llms.slice(0, 2).map(asCandidate), ...(apple ? [APPLE] : [])]) };
}

const dedupe = (list: Candidate[]) => list.filter((c, i) => list.findIndex((x) => x.providerId === c.providerId && x.model === c.model) === i);
