import type { Capability } from './capabilities';
import type { CatalogModel, ProviderKind } from './catalog';
import benchmarks from './benchmarks.json';

/** One measured model, as written by `pnpm bench` (see bench/run.ts). */
export type BenchmarkResult = {
  kind: ProviderKind;
  model: string;
  capability: Capability;
  /** 0–100, see bench/score.ts. */
  score: number;
  /** Fraction of replies that parsed as the expected JSON. */
  validJson: number;
  latencyP50: number;
  latencyP95: number;
  promptTokens: number;
  completionTokens: number;
  /** USD per 1 000 calls at the provider's published price. */
  costPer1k: number | null;
  details: Record<string, number>;
};

export type BenchmarkFile = { generatedAt: string | null; dataset: { triage: number; chat: number } | null; results: BenchmarkResult[] };

export const BENCHMARKS = benchmarks as BenchmarkFile;

/** Below this score a model is not recommended, however cheap. */
const MIN_SCORE = 80;

/**
 * Ranks measured models for a capability: good enough first (score ≥ 80), then the best
 * quality per dollar with latency as a tie-breaker. Unmeasured services fall back to their catalog.
 */
export function rankBenchmarks(kind: ProviderKind, capability: Capability) {
  const measured = BENCHMARKS.results.filter((r) => r.kind === kind && r.capability === capability);
  const value = (r: BenchmarkResult) => r.score - (r.costPer1k ?? 0) * 4 - r.latencyP50 / 1000;
  return [...measured.filter((r) => r.score >= MIN_SCORE).sort((a, b) => value(b) - value(a)), ...measured.filter((r) => r.score < MIN_SCORE).sort((a, b) => b.score - a.score)];
}

/** Vetted picks used before a service has been benchmarked: never an unknown model. */
const SAFE_DEFAULTS: Partial<Record<ProviderKind, string[]>> = {
  zenmux: ['qwen/qwen3.7-flash', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini'],
  openrouter: ['qwen/qwen3.7-flash', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini'],
  openai: ['gpt-4.1-mini', 'gpt-4o-mini'],
};

export function recommendedModels(kind: ProviderKind, capability: Capability, available: CatalogModel[]): string[] {
  const ids = new Set(available.map((m) => m.id));
  const ranked = rankBenchmarks(kind, capability)
    .filter((r) => r.score >= MIN_SCORE)
    .map((r) => r.model)
    .filter((m) => ids.size === 0 || ids.has(m));
  if (ranked.length) return ranked;
  const safe = (SAFE_DEFAULTS[kind] ?? []).filter((m) => ids.size === 0 || ids.has(m));
  if (safe.length) return safe;
  // Self-hosted or custom endpoint: whatever it serves, cheapest first.
  return [...available]
    .sort((a, b) => (a.inputPrice ?? 0) + (a.outputPrice ?? 0) - ((b.inputPrice ?? 0) + (b.outputPrice ?? 0)))
    .slice(0, 3)
    .map((m) => m.id);
}
