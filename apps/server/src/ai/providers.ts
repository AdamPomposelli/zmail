import { jsonrepair } from 'jsonrepair';
import { callJev, isJevModel, parseJevTriage, type JevRequest } from './jev';
import { DEFAULT_PRESET, PRESET_MEASURES, presetRoute, type Preset, type PresetRoute } from './presets';
import { agree, voteTriage } from './consensus';
import { atomicRequest, parseAtomicReply } from './atomic';
import type { ModelTriage } from './merge';
import type { Database } from '../db';
import type { Secrets } from '../lib/secrets';
import type { NativeBridge } from '../native/bridge';
import { CAPABILITY_IDS, type Capability } from './capabilities';
import { ModelCatalog, PROVIDER_KINDS, costUsd, type ProviderKind } from './catalog';
import { recommendedModels } from './recommendations';
import { log } from '../lib/log';
import type { AppleDiagnostics } from './apple';
import { t } from '../lib/i18n';

/** A connection to a model service. It carries credentials only: models are routed per capability. */
export type ProviderConfig = {
  id: string;
  type: 'apple' | 'openai';
  kind?: ProviderKind;
  name: string;
  baseUrl?: string;
  /** Encrypted API key. */
  apiKey?: string;
  enabled: boolean;
  /** Legacy field from the first version (one model per provider); ignored. */
  model?: string;
};

/** A user override: this capability always uses this model of this connection. */
export type ModelOverride = { providerId: string; model: string };

export type AiSettings = {
  providers: ProviderConfig[];
  /** Empty by default: the orchestrator decides. */
  overrides: Partial<Record<Capability, ModelOverride>>;
  /** Capabilities the user turned off (local engine only). */
  disabled: Capability[];
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  get providers() {
    return [{ id: 'apple', type: 'apple' as const, name: t('Apple Intelligence (sur l’appareil)'), enabled: true }];
  },
  overrides: {},
  disabled: [],
};

export type CompletionRequest = {
  system: string;
  prompt: string;
  /** Ask for a JSON object; the reply is parsed (and repaired) before returning. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Thinking budget for reasoning models: classification needs none, the agent a little. */
  reasoning?: 'off' | 'low';
  /** The same task as typed questions, for System One models (Jev); others ignore it. */
  jev?: Omit<JevRequest, 'model'>;
  /** Set by atomicRequest: the reply is true/false answers to these questions, read through Jev's truth table. */
  atomicOf?: Omit<JevRequest, 'model'>;
  /** Decision thresholds applied to Jev's answers (advanced settings). */
  jevThresholds?: { yes: number; lean: number };
};

export type Usage = { promptTokens: number; completionTokens: number };
export type Completion = { text: string; provider: string; model: string; data?: unknown; usage?: Usage; latencyMs: number };

/** Pulls the first JSON object out of a model reply (code fences, prose around it…). */
export function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  return JSON.parse(jsonrepair(candidate));
}

export interface LlmClient {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<{ text: string; usage?: Usage }>;
}

export class AppleClient implements LlmClient {
  readonly id = 'apple';
  readonly label = 'Apple Intelligence';
  readonly model = 'apple-on-device';
  constructor(private readonly bridge: NativeBridge) {}
  async complete(request: CompletionRequest) {
    // Sorting: the small on-device model answers Jev's yes/no questions far better than the
    // whole-mail prompt (measured), and ZMail's truth table decides.
    if (request.jev && PRESET_MEASURES.apple.triageFormat === 'atomic') {
      const atomic = atomicRequest(request.jev, request.jevThresholds);
      const text = await this.bridge.generate({ system: `${atomic.system}\nRéponds uniquement avec un objet JSON valide, sans texte autour.`, prompt: atomic.prompt, temperature: 0, maxTokens: atomic.maxTokens });
      return { text: JSON.stringify(parseAtomicReply(text, request.jev, request.jevThresholds)) };
    }
    const system = request.json ? `${request.system}\nRéponds uniquement avec un objet JSON valide, sans texte autour.` : request.system;
    const text = await this.bridge.generate({ system, prompt: request.prompt, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens });
    return { text };
  }
}

/** TypeSafe Jev through ZenMux: answers the request's typed questions, never free text. */
export class JevClient implements LlmClient {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string | undefined,
  ) {}

  async complete(request: CompletionRequest) {
    if (!request.jev) throw new Error(t('Jev ne répond qu’à des questions typées (tri uniquement)'));
    if (!this.apiKey) throw new Error(t('Clé ZenMux manquante'));
    const response = await callJev(this.baseUrl.replace(/\/$/, ''), this.apiKey, { ...request.jev, model: this.model });
    // Output tokens are free on Jev: only input is billed.
    return { text: JSON.stringify(parseJevTriage(response, request.jevThresholds)), usage: { promptTokens: response.usage?.input_tokens ?? 0, completionTokens: 0 } };
  }
}

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly kind: ProviderKind = 'custom',
  ) {}

  private reasoningParams(request: CompletionRequest): Record<string, unknown> {
    // ZenMux and OpenRouter share this extension; plain OpenAI-compatible servers would reject it.
    if (!request.reasoning || (this.kind !== 'zenmux' && this.kind !== 'openrouter')) return {};
    // `enabled: false` stops hybrid models; always-on reasoners (GPT-5…) need `minimal` instead.
    return request.reasoning === 'off' ? { reasoning: { enabled: false }, reasoning_effort: 'minimal' } : { reasoning_effort: 'low' };
  }

  async complete(request: CompletionRequest) {
    // Optional parameters, dropped one by one when a model rejects them (HTTP 400).
    const optional: Record<string, unknown> = {
      ...this.reasoningParams(request),
      temperature: request.temperature ?? 0.2,
      ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const send = () =>
      fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), 'x-title': 'ZMail' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens ?? 800,
          ...optional,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    let res = await send();
    while (res.status === 400) {
      const detail = await res.clone().text().catch(() => '');
      const named = Object.keys(optional).find((key) => detail.includes(key));
      const drop = named ?? ['reasoning_effort', 'reasoning', 'response_format', 'temperature'].find((key) => key in optional);
      if (!drop) break;
      delete optional[drop];
      res = await send();
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${this.label} (${this.model}): HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : undefined,
    };
  }
}

export type RoutePlan = {
  capability: Capability;
  preset: Preset;
  candidates: { providerId: string; providerName: string; model: string; source: 'override' | 'recommended' | 'apple' }[];
  /** « Ultra » mode: two models answer in parallel, a third decides when they disagree. */
  consensus?: PresetRoute['consensus'];
};

/** The two models a service contributes to a route. The fallback must not share the first pick's failure mode: after Jev, an LLM. */
export const routePicks = (ranked: string[]) => (isJevModel(ranked[0] ?? '') ? [ranked[0]!, ...ranked.filter((m) => !isJevModel(m)).slice(0, 1)] : ranked.slice(0, 2));

export class AiRouter {
  private appleState: { available: boolean; reason: string | null; checkedAt: number; diagnostics?: AppleDiagnostics } = { available: false, reason: 'not_checked', checkedAt: 0 };
  readonly catalog: ModelCatalog;
  /** Test hook: replaces provider resolution. */
  override: ((task: Capability) => LlmClient[]) | null = null;
  /** Called when a capability is left with no model at all in the chosen mode (e.g. the free model became paid). */
  onNoModel: ((capability: Capability, preset: Preset) => void) | null = null;

  constructor(
    private readonly db: Database,
    private readonly secrets: Secrets,
    private readonly bridge: NativeBridge,
  ) {
    this.catalog = new ModelCatalog(db);
  }

  settings(): AiSettings {
    const saved = this.db.getSetting<Partial<AiSettings> & { routing?: unknown }>('ai', {});
    const providers = (saved.providers?.length ? saved.providers : DEFAULT_AI_SETTINGS.providers).map((p) =>
      p.type === 'openai' && !p.kind ? { ...p, kind: inferKind(p.baseUrl) } : p,
    );
    if (!providers.some((p) => p.type === 'apple')) providers.unshift(DEFAULT_AI_SETTINGS.providers[0]!);
    return { providers, overrides: saved.overrides ?? {}, disabled: saved.disabled ?? [] };
  }

  saveSettings(settings: AiSettings) {
    this.db.setSetting('ai', settings);
  }

  async appleStatus(force = false) {
    if (!force && Date.now() - this.appleState.checkedAt < 60_000) return this.appleState;
    const health = await this.bridge.health();
    this.appleState = health
      ? { available: health.ai.available, reason: health.ai.reason, checkedAt: Date.now(), diagnostics: health.ai.diagnostics }
      : { available: false, reason: 'app_not_running', checkedAt: Date.now() };
    return this.appleState;
  }

  apiKey(config: ProviderConfig) {
    return config.apiKey ? this.secrets.decrypt(config.apiKey) : undefined;
  }

  clientFor(config: ProviderConfig, model: string): LlmClient | null {
    if (config.type === 'apple') return new AppleClient(this.bridge);
    if (!config.baseUrl || !model) return null;
    if (isJevModel(model)) return new JevClient(config.id, config.name, config.baseUrl, model, this.apiKey(config));
    return new OpenAiCompatibleClient(config.id, config.name, config.baseUrl, model, this.apiKey(config), config.kind ?? inferKind(config.baseUrl));
  }

  /** The models each capability will try, in order: user override, Apple on-device, benchmarked picks. */
  preset(): Preset {
    return this.db.getSetting<Preset>('ai.preset', DEFAULT_PRESET);
  }

  setPreset(preset: Preset) {
    this.db.setSetting('ai.preset', preset);
  }

  /** The models each capability will try, in order: the user's own choice (advanced settings), then the mode's route. */
  async plan(capability: Capability, preset = this.preset()): Promise<RoutePlan> {
    const settings = this.settings();
    if (settings.disabled.includes(capability)) return { capability, preset, candidates: [] };
    const enabled = settings.providers.filter((p) => p.enabled);
    const override = settings.overrides[capability];
    const overrideProvider = override && enabled.find((p) => p.id === override.providerId);
    const apple = Boolean(enabled.find((p) => p.type === 'apple')) && (await this.appleStatus()).available;
    const providers = enabled
      .filter((p) => p.type === 'openai')
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? ('custom' as const), available: this.catalog.cached(p.kind ?? 'custom', p.baseUrl ?? '') }));
    const route = presetRoute(preset, capability, { apple, providers });
    // Services without benchmarks (custom, Ollama…) still get their vetted picks, after the measured ones.
    for (const provider of providers.filter((p) => !route.candidates.some((c) => c.providerId === p.id) && preset !== 'free')) {
      for (const model of routePicks(recommendedModels(provider.kind, capability, provider.available))) route.candidates.push({ providerId: provider.id, providerName: provider.name, model, source: 'recommended' });
    }
    if (override && overrideProvider) {
      const pinned = { providerId: overrideProvider.id, providerName: overrideProvider.name, model: override.model, source: 'override' as const };
      // A manual choice replaces the double check: the user asked for that model.
      return { capability, preset, candidates: [pinned, ...route.candidates.filter((c) => !(c.providerId === pinned.providerId && c.model === pinned.model))] };
    }
    // A cloud service is connected but no model fits this mode: ZMail falls back to its engine
    // without AI. Say so instead of degrading in silence.
    if (!route.candidates.length && providers.length) this.onNoModel?.(capability, preset);
    return { capability, preset, candidates: route.candidates, consensus: route.consensus };
  }

  async chain(capability: Capability): Promise<LlmClient[]> {
    if (this.override) return this.override(capability);
    const { providers } = this.settings();
    const { candidates } = await this.plan(capability);
    return candidates
      .map((c) => {
        const provider = providers.find((p) => p.id === c.providerId);
        return provider ? this.clientFor(provider, c.model) : null;
      })
      .filter((c): c is LlmClient => c !== null);
  }

  async complete(capability: Capability, request: CompletionRequest): Promise<Completion | null> {
    if (!this.override) {
      const plan = await this.plan(capability);
      if (plan.consensus && request.json) {
        const verified = await this.completeVerified(capability, request, plan.consensus);
        if (verified) return verified;
      }
    }
    for (const client of await this.chain(capability)) {
      const done = await this.tryClient(capability, client, request);
      if (done) return done;
    }
    return null;
  }

  private async tryClient(capability: Capability, client: LlmClient, request: CompletionRequest): Promise<Completion | null> {
    const started = Date.now();
    try {
      const { text, usage } = await client.complete(request);
      const latencyMs = Date.now() - started;
      this.recordUsage(capability, client, usage, latencyMs);
      const completion: Completion = { text, provider: client.id, model: client.model, usage, latencyMs };
      if (request.json) completion.data = parseJsonReply(text);
      return completion;
    } catch (error) {
      log.warn('ai', `${client.label} ${client.model} failed for ${capability}:`, (error as Error).message);
      return null;
    }
  }

  /** The « Ultra » double check as one client, for the prompt lab. */
  verifiedClient(capability: Capability, consensus: NonNullable<RoutePlan['consensus']>): LlmClient {
    return {
      id: 'consensus',
      label: t('Double vérification'),
      model: `consensus:${consensus.pair.map((c) => c.model).join('+')}`,
      complete: async (request) => {
        const done = await this.completeVerified(capability, request, consensus);
        if (!done) throw new Error(t('Double vérification impossible : aucun des deux modèles n’a répondu.'));
        return { text: done.text };
      },
    };
  }

  /** Two models in parallel; a third settles what they disagree on (spam, priority, code, opportunity). */
  private async completeVerified(capability: Capability, request: CompletionRequest, consensus: NonNullable<RoutePlan['consensus']>): Promise<Completion | null> {
    const { providers } = this.settings();
    const client = (c: { providerId: string; model: string }) => {
      const provider = providers.find((p) => p.id === c.providerId);
      return provider ? this.clientFor(provider, c.model) : null;
    };
    const [a, b] = consensus.pair.map(client);
    if (!a || !b) return null;
    const started = Date.now();
    const [ra, rb] = await Promise.all([this.tryClient(capability, a, request), this.tryClient(capability, b, request)]);
    const answers = [ra, rb].filter((r): r is Completion => Boolean(r?.data && typeof r.data === 'object'));
    if (answers.length < 2) return answers[0] ?? null;
    let votes = answers.map((r) => r.data as ModelTriage);
    let models = answers.map((r) => r.model);
    if (!agree(votes[0]!, votes[1]!) && consensus.arbiter) {
      const arbiter = client(consensus.arbiter);
      const rc = arbiter ? await this.tryClient(capability, arbiter, request) : null;
      if (rc?.data && typeof rc.data === 'object') {
        votes = [...votes, rc.data as ModelTriage];
        models = [...models, rc.model];
      }
    }
    const data = voteTriage(votes);
    return { text: JSON.stringify(data), data, provider: 'consensus', model: `consensus:${models.join('+')}`, latencyMs: Date.now() - started };
  }

  private recordUsage(capability: Capability, client: LlmClient, usage: Usage | undefined, latencyMs: number) {
    const provider = this.settings().providers.find((p) => p.id === client.id);
    const model = provider?.kind ? this.catalog.cached(provider.kind, provider.baseUrl ?? '').find((m) => m.id === client.model) : undefined;
    const cost = usage && model ? costUsd(model, usage.promptTokens, usage.completionTokens) : client.id === 'apple' ? 0 : null;
    this.db.run(
      'INSERT INTO ai_usage (at, capability, provider_id, model, prompt_tokens, completion_tokens, latency_ms, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      Date.now(),
      capability,
      client.id,
      client.model,
      usage?.promptTokens ?? 0,
      usage?.completionTokens ?? 0,
      latencyMs,
      cost,
    );
  }

  /** Spend and volume actually observed over the last `days`. */
  usageSummary(days = 30) {
    return this.db.all<{ capability: string; model: string; calls: number; prompt: number; completion: number; cost: number | null; latency: number }>(
      `SELECT capability, model, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt, SUM(completion_tokens) AS completion,
         SUM(cost_usd) AS cost, AVG(latency_ms) AS latency
       FROM ai_usage WHERE at > ? GROUP BY capability, model ORDER BY calls DESC`,
      Date.now() - days * 86400_000,
    );
  }

  async test(config: ProviderConfig) {
    if (config.type === 'apple') {
      const status = await this.appleStatus(true);
      return status.available ? { ok: true, reply: 'OK', latencyMs: 0 } : { ok: false, error: status.reason ?? 'unavailable' };
    }
    const kind = config.kind ?? inferKind(config.baseUrl);
    const models = await this.catalog.models(kind, config.baseUrl ?? '', this.apiKey(config), true);
    const model = recommendedModels(kind, 'triage', models)[0];
    if (!model) return { ok: false, error: t('Aucun modèle utilisable trouvé sur ce service.') };
    const client = this.clientFor({ ...config, enabled: true }, model);
    if (!client) return { ok: false, error: t('Configuration incomplète.') };
    try {
      const started = Date.now();
      const { text } = await client.complete({ system: 'Tu es un test de connexion.', prompt: 'Réponds exactement : OK', maxTokens: 5 });
      return { ok: true, reply: text.trim().slice(0, 40), latencyMs: Date.now() - started, model, models: models.length };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}

export function inferKind(baseUrl: string | undefined): ProviderKind {
  const url = baseUrl ?? '';
  const found = (Object.entries(PROVIDER_KINDS) as [ProviderKind, (typeof PROVIDER_KINDS)[ProviderKind]][]).find(([, k]) => k.baseUrl && url.startsWith(k.baseUrl));
  return found?.[0] ?? (/11434/.test(url) ? 'ollama' : 'custom');
}

export { CAPABILITY_IDS };
