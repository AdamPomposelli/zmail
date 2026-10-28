import type { Database } from '../db';
import { JEV_CATALOG } from './jev';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

/** Services a user can connect with an API key. The model is never asked: ZMail picks it. */
export const PROVIDER_KINDS = {
  zenmux: { name: 'ZenMux', baseUrl: 'https://zenmux.ai/api/v1', needsKey: true, editableUrl: false, keyUrl: 'https://zenmux.ai/settings/keys' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, editableUrl: false, keyUrl: 'https://openrouter.ai/keys' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, editableUrl: false, keyUrl: 'https://platform.openai.com/api-keys' },
  ollama: { name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false, editableUrl: true, keyUrl: null },
  custom: {
    get name() {
      return t('Compatible OpenAI');
    },
    baseUrl: '', needsKey: false, editableUrl: true, keyUrl: null },
} as const;

export type ProviderKind = keyof typeof PROVIDER_KINDS;

export type CatalogModel = {
  id: string;
  name: string;
  /** USD per million tokens; null when the service publishes no price. */
  inputPrice: number | null;
  outputPrice: number | null;
  contextLength: number | null;
  reasoning: boolean;
};

type Cached = { fetchedAt: number; models: CatalogModel[] };

const DAY = 86400_000;

/** OpenAI does not publish prices through its API: the few models worth using, by hand. */
const OPENAI_STATIC: CatalogModel[] = [
  { id: 'gpt-5-nano', name: 'GPT-5 nano', inputPrice: 0.05, outputPrice: 0.4, contextLength: 400000, reasoning: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', inputPrice: 0.15, outputPrice: 0.6, contextLength: 128000, reasoning: false },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', inputPrice: 0.4, outputPrice: 1.6, contextLength: 1047576, reasoning: false },
];

const lowestTier = (tiers: unknown): number | null => {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const values = tiers.map((t: { value?: number }) => t.value).filter((v): v is number => typeof v === 'number');
  return values.length ? Math.min(...values) : null;
};

/** Normalises the /models listing of ZenMux (per-M tiered pricing) and OpenRouter (per-token strings). */
export function parseCatalog(payload: unknown): CatalogModel[] {
  const items = (Array.isArray(payload) ? payload : (payload as { data?: unknown[] })?.data) ?? [];
  return (items as Record<string, unknown>[])
    .map((m) => {
      const pricings = m.pricings as Record<string, unknown> | undefined;
      const pricing = m.pricing as Record<string, string> | undefined;
      const perToken = (v: string | undefined) => (v === undefined || v === null ? null : Number(v) * 1_000_000);
      const outputs = (m.output_modalities as string[] | undefined) ?? (m.architecture as { output_modalities?: string[] } | undefined)?.output_modalities;
      return {
        id: String(m.id),
        name: String(m.display_name ?? m.name ?? m.id),
        inputPrice: pricings ? lowestTier(pricings.prompt) : perToken(pricing?.prompt),
        outputPrice: pricings ? lowestTier(pricings.completion) : perToken(pricing?.completion),
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        reasoning: Boolean((m.capabilities as { reasoning?: boolean } | undefined)?.reasoning ?? (m.supported_parameters as string[] | undefined)?.includes('reasoning')),
        textOnly: !outputs || (outputs.includes('text') && outputs.length === 1),
      };
    })
    .filter((m) => m.textOnly && !/embedding|rerank|image|tts|whisper|audio/i.test(m.id))
    .map(({ textOnly: _t, ...m }) => m);
}

export class ModelCatalog {
  constructor(private readonly db: Database) {}

  cached(kind: ProviderKind, baseUrl: string): CatalogModel[] {
    if (kind === 'openai') return OPENAI_STATIC;
    return withJev(kind, this.db.getSetting<Cached | null>(`ai.catalog.${kind}.${baseUrl}`, null)?.models ?? []);
  }

  /** Lists the service's models (with prices), refreshed at most once a day. */
  async models(kind: ProviderKind, baseUrl: string, apiKey?: string, force = false): Promise<CatalogModel[]> {
    if (kind === 'openai') return OPENAI_STATIC;
    const key = `ai.catalog.${kind}.${baseUrl}`;
    const cached = this.db.getSetting<Cached | null>(key, null);
    if (cached && !force && Date.now() - cached.fetchedAt < DAY) return withJev(kind, cached.models);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const models = parseCatalog(await res.json());
      if (kind === 'ollama' || kind === 'custom') models.forEach((m) => ((m.inputPrice ??= kind === 'ollama' ? 0 : null), (m.outputPrice ??= kind === 'ollama' ? 0 : null)));
      this.db.setSetting(key, { fetchedAt: Date.now(), models } satisfies Cached);
      return withJev(kind, models);
    } catch (error) {
      log.warn('catalog', `${kind}: ${(error as Error).message}`);
      return withJev(kind, cached?.models ?? []);
    }
  }
}

/** ZenMux serves Jev on /systemone, so its /models never lists it. */
const withJev = (kind: ProviderKind, models: CatalogModel[]) => (kind === 'zenmux' ? [...models.filter((m) => !JEV_CATALOG.some((j) => j.id === m.id)), ...JEV_CATALOG] : models);

export const costUsd = (model: Pick<CatalogModel, 'inputPrice' | 'outputPrice'>, promptTokens: number, completionTokens: number) =>
  model.inputPrice === null || model.outputPrice === null ? null : (promptTokens * model.inputPrice + completionTokens * model.outputPrice) / 1_000_000;
