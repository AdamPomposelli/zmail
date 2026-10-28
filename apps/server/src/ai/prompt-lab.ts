import type { EngineContext } from '../context';
import type { MessageRow } from '../mail/store';
import { TRIAGE_CASES, type TriageCase } from '../../bench/dataset';
import { HOLDOUT_CASES } from '../../bench/holdout';
import { scoreTriage } from '../../bench/score';
import { classifyHeuristically, type MailFeatures } from './heuristics';
import { mergeTriage, type MergedTriage, type ModelTriage } from './merge';
import { buildTriageRequest } from './prompts';
import { featuresOf } from './pipeline';
import { isJevModel, JEV_SIGNAL_USE } from './jev';
import { costUsd } from './catalog';
import { parseJsonReply, type LlmClient } from './providers';
import { CHAT_CONTRACT, PROMPT_VARIABLES, TRIAGE_CONTRACT, UNSUBSCRIBE_CONTRACT, type JevSetup, type PromptAction, type PromptFormat, type PromptSet } from './prompt-config';
import { CAPABILITIES } from './capabilities';
import { CHAT_TOOL_DOCS } from './prompts';
import { bus } from '../lib/events';
import { json } from '../db';
import { t } from '../lib/i18n';
import { priorityName, tagLabel } from './taxonomy';

/**
 * The prompt lab: measures a version of the triage instructions before it goes live, and
 * proposes better ones. Two kinds of evidence:
 * - ZMail's 85 labelled reference mails (bench/), the same ones the model benchmarks use;
 * - the user's own mail, where their corrections are the truth (« pas spam », a tag removed,
 *   a priority changed…) and their provider's Spam folder says what is spam.
 */

const PRIORITY_NAMES = ['low', 'normal', 'high', 'urgent'] as const;
const CORRECTIONS = ['notSpam', 'spam', 'addTag', 'removeTag', 'setPriority'] as const;
const DAY = 86_400_000;

type Located = MessageRow & { special_use: string | null; path: string };

/** One expectation taken from the user's behaviour. */
export type UserCheck = {
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  source: 'correction' | 'provider-spam';
  /** What the user did, in words (« Vous l’avez sorti du spam »). */
  because: string;
  expect: { spam?: boolean; hasTag?: string; lacksTag?: string; priority?: number };
};

export type LabResult = {
  model: string;
  format: PromptFormat;
  /** 0–100: reference score and the share of the user's corrections respected, weighted equally when both exist. */
  overall: number;
  /** `control`: the held-out mails, never shown to the model that writes improvements. */
  reference: { score: number; cases: number; control: number | null; mistakes: { id: string; subject: string; mistakes: string[]; control: boolean }[] };
  yours: { passed: number; total: number; failures: (UserCheck & { got: string })[] };
  latencyP50: number;
  tokensPerMail: number;
  costPer1k: number | null;
};

const BUSINESSES_FOR_REFERENCE = [
  { name: 'Nordlys Studio', description: 'Agence de développement web et mobile : devis, clients, partenariats.' },
  { name: 'Maison Velours', description: 'Boutique e-commerce de linge de maison : commandes, paiements, litiges.' },
];

const referenceFeatures = (c: TriageCase): MailFeatures => ({
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
  authResults: null,
  attachments: [],
});

async function pool<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export class PromptLab {
  constructor(private readonly ctx: EngineContext) {}

  /** Everything the advanced settings (and MCP clients) show: per action, the model the route
   *  uses, the editable instructions in the format that model reads, and the fixed contract. */
  async setup() {
    const prompts = this.ctx.prompts.get();
    const defaults = this.ctx.prompts.defaults();
    const custom = this.ctx.prompts.customised();
    const contracts: Record<PromptAction, string> = { triage: TRIAGE_CONTRACT, chat: `${CHAT_CONTRACT}\n${CHAT_TOOL_DOCS}`, unsubscribe: UNSUBSCRIBE_CONTRACT };
    const actions = await Promise.all(
      (['triage', 'chat', 'unsubscribe'] as const).map(async (id) => {
        const route = (await this.ctx.ai.plan(id)).candidates;
        const first = route[0]?.model ?? null;
        return {
          id,
          label: CAPABILITIES[id].label,
          description: CAPABILITIES[id].description,
          route,
          activeFormat: (first && isJevModel(first) ? 'jev' : 'llm') as PromptFormat,
          formats: (id === 'triage' ? ['llm', 'jev'] : ['llm']) as PromptFormat[],
          llm: { prompt: prompts[id].llm, defaultPrompt: defaults[id].llm, contract: contracts[id], variables: PROMPT_VARIABLES[id], custom: custom[id].llm },
          jev:
            id === 'triage'
              ? {
                  questions: Object.entries(prompts.triage.jev.questions).map(([qid, q]) => ({
                    id: qid,
                    ...q,
                    group: t(JEV_SIGNAL_USE[qid as keyof typeof JEV_SIGNAL_USE]?.group ?? 'Autres'),
                    use: t(JEV_SIGNAL_USE[qid as keyof typeof JEV_SIGNAL_USE]?.use ?? ''),
                    custom: JSON.stringify(q) !== JSON.stringify(defaults.triage.jev.questions[qid]),
                  })),
                  thresholds: prompts.triage.jev.thresholds,
                  defaultThresholds: defaults.triage.jev.thresholds,
                  custom: custom.triage.jev,
                }
              : null,
        };
      }),
    );
    return { actions, draft: this.ctx.prompts.draft(), history: this.ctx.prompts.history(30) };
  }

  /** What went wrong lately: every correction the user made to the AI's sorting. */
  report(days = 30) {
    const since = Date.now() - days * DAY;
    const engines = this.ctx.db.all<{ engine: string; n: number }>('SELECT engine, COUNT(*) AS n FROM triage WHERE processed_at >= ? GROUP BY engine ORDER BY n DESC', since);
    const rows = this.ctx.db.all<{ at: number; action: string; thread_id: string | null; message_id: string | null; from_email: string | null; subject: string | null; tags: string; meta: string }>(
      `SELECT at, action, thread_id, message_id, from_email, subject, tags, meta FROM action_log WHERE at >= ? AND action IN (${CORRECTIONS.map(() => '?').join(',')}) ORDER BY at DESC LIMIT 200`,
      since,
      ...CORRECTIONS,
    );
    const tagName = (id: unknown) => {
      const tag = this.ctx.catalog.tags().find((x) => x.id === id);
      return tag ? tagLabel(tag) : String(id);
    };
    const corrections = rows.map((r) => {
      const meta = json<Record<string, unknown>>(r.meta, {});
      const engine = r.message_id ? this.ctx.db.get<{ engine: string }>('SELECT engine FROM triage WHERE message_id = ?', r.message_id)?.engine : undefined;
      const what =
        r.action === 'notSpam'
          ? t('sorti du spam : l’IA l’avait jugé spam')
          : r.action === 'spam'
            ? t('signalé comme spam : l’IA l’avait laissé passer')
            : r.action === 'removeTag'
              ? t('tag « {tag} » retiré', { tag: tagName(meta.tag) })
              : r.action === 'addTag'
                ? t('tag « {tag} » ajouté', { tag: tagName(meta.tag) })
                : t('priorité changée en « {priority} »', { priority: priorityName(Number(meta.priority)) ?? String(meta.priority) });
      return { at: r.at, action: r.action, threadId: r.thread_id, subject: r.subject ?? '', from: r.from_email ?? '', aiTags: json<string[]>(r.tags, []).map(tagName), what, engine: engine ?? null };
    });
    const sorted = engines.reduce((t, e) => t + e.n, 0);
    const byAction = Object.fromEntries(CORRECTIONS.map((a) => [a, corrections.filter((c) => c.action === a).length]));
    return { days, sorted, engines, corrections, byAction, errorRate: sorted ? corrections.length / sorted : 0 };
  }

  /** Expectations drawn from the user's mail: their corrections, then their provider's Spam folder. */
  userChecks(limit = 40): UserCheck[] {
    const checks: UserCheck[] = [];
    const rows = this.ctx.db.all<{ action: string; thread_id: string; meta: string }>(
      `SELECT action, thread_id, meta FROM action_log WHERE thread_id IS NOT NULL AND action IN (${CORRECTIONS.map(() => '?').join(',')}) ORDER BY at DESC LIMIT 400`,
      ...CORRECTIONS,
    );
    const seen = new Set<string>();
    for (const r of rows) {
      const meta = json<Record<string, unknown>>(r.meta, {});
      const key = `${r.thread_id}:${r.action}:${String(meta.tag ?? meta.priority ?? '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const msg = this.latestIncoming(r.thread_id);
      if (!msg) continue;
      const base = { threadId: r.thread_id, messageId: msg.id, subject: msg.subject, from: msg.from_name || msg.from_email, source: 'correction' as const };
      if (r.action === 'notSpam') checks.push({ ...base, because: t('Vous l’avez sorti du spam'), expect: { spam: false } });
      if (r.action === 'spam') checks.push({ ...base, because: t('Vous l’avez signalé comme spam'), expect: { spam: true } });
      if (r.action === 'addTag' && typeof meta.tag === 'string') checks.push({ ...base, because: t('Vous avez ajouté le tag {tag}', { tag: meta.tag }), expect: { hasTag: meta.tag } });
      if (r.action === 'removeTag' && typeof meta.tag === 'string') checks.push({ ...base, because: t('Vous avez retiré le tag {tag}', { tag: meta.tag }), expect: { lacksTag: meta.tag } });
      if (r.action === 'setPriority' && meta.priority !== undefined) checks.push({ ...base, because: t('Vous avez changé la priorité'), expect: { priority: Number(meta.priority) } });
      if (checks.length >= limit) return checks;
    }
    // The provider's Spam folder, never shown to the model: can it find them on its own?
    const junk = this.ctx.db.all<Located>(
      `SELECT m.*, mb.special_use, mb.path FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE mb.special_use = 'junk' ORDER BY m.date DESC LIMIT ?`,
      Math.max(0, Math.min(15, limit - checks.length)),
    );
    for (const msg of junk) {
      checks.push({ threadId: msg.thread_id, messageId: msg.id, subject: msg.subject, from: msg.from_name || msg.from_email, source: 'provider-spam', because: t('Votre fournisseur l’a rangé dans Spam'), expect: { spam: true } });
    }
    return checks;
  }

  private latestIncoming(threadId: string) {
    return this.ctx.store.threadMessages(threadId).filter((m) => m.special_use !== 'sent' && m.special_use !== 'drafts').at(-1);
  }

  /** The client the triage route uses now, or the one asked for. */
  private async clientFor(route?: { providerId: string; model: string } | null): Promise<LlmClient> {
    const { providers } = this.ctx.ai.settings();
    if (route) {
      const provider = providers.find((p) => p.id === route.providerId);
      const client = provider && this.ctx.ai.clientFor(provider, route.model);
      if (!client) throw new Error(t('Ce modèle n’est pas disponible : vérifiez le service connecté.'));
      return client;
    }
    // « Ultra » mode: measure the double check itself, not just its first model.
    const plan = await this.ctx.ai.plan('triage');
    if (plan.consensus && !this.ctx.ai.override) return this.ctx.ai.verifiedClient('triage', plan.consensus);
    const [client] = await this.ctx.ai.chain('triage');
    if (!client) throw new Error(t('Aucun modèle disponible pour le tri : connectez un service ou activez Apple Intelligence.'));
    return client;
  }

  async evaluate(opts: { prompts?: PromptSet; route?: { providerId: string; model: string } | null; reference?: boolean; yours?: boolean; phase?: string } = {}): Promise<LabResult> {
    const prompts = opts.prompts ?? this.ctx.prompts.get();
    const client = await this.clientFor(opts.route);
    const tags = this.ctx.catalog.tags();
    const known = new Set(tags.map((t) => t.id));
    const reference = opts.reference === false ? [] : [...TRIAGE_CASES, ...HOLDOUT_CASES];
    const checks = opts.yours === false ? [] : this.userChecks();
    const total = reference.length + checks.length;
    let done = 0;
    const tick = () => bus.emitEvent({ type: 'lab', phase: opts.phase ?? t('Évaluation'), done: ++done, total });
    const latencies: number[] = [];
    let tokens = 0;
    let calls = 0;

    const run = async (features: MailFeatures, text: string, business?: { name: string; description: string }, businesses: { name: string; description: string }[] = this.ctx.catalog.businesses()): Promise<MergedTriage | null> => {
      const heuristic = classifyHeuristically(features);
      const request = buildTriageRequest({ features, bulk: heuristic.bulk, tags, business, businesses }, prompts);
      const started = Date.now();
      try {
        const { text: reply, usage } = await client.complete(request);
        latencies.push(Date.now() - started);
        tokens += usage?.promptTokens ?? 0;
        calls++;
        return mergeTriage({ heuristic, model: parseJsonReply(reply) as ModelTriage, text, knownTags: known });
      } catch {
        return null;
      } finally {
        tick();
      }
    };

    const refResults = await pool(reference, 6, async (c) => {
      const business = c.business ? BUSINESSES_FOR_REFERENCE.find((b) => c.business!.startsWith(b.name)) : undefined;
      const m = await run(referenceFeatures(c), `${c.subject}\n${c.text}`, business, BUSINESSES_FOR_REFERENCE);
      return scoreTriage(c, m ? { tags: m.tags, priority: PRIORITY_NAMES[m.priority], spam: m.spam, opportunity: m.opportunity, otp: m.otp } : null);
    });
    const userResults = await pool(checks, 6, async (check) => {
      const row = this.ctx.store.message(check.messageId);
      if (!row) return { check, ok: true, got: t('mail supprimé') };
      const m = await run(featuresOf(row), `${row.subject}\n${row.text_body}`);
      if (!m) return { check, ok: false, got: t('pas de réponse du modèle') };
      const e = check.expect;
      const ok =
        (e.spam === undefined || m.spam === e.spam) &&
        (e.hasTag === undefined || m.tags.includes(e.hasTag)) &&
        (e.lacksTag === undefined || !m.tags.includes(e.lacksTag)) &&
        (e.priority === undefined || m.priority === e.priority);
      const got = t('{spam}, priorité {priority}, tags {tags}', { spam: m.spam ? t('spam') : t('pas spam'), priority: priorityName(m.priority) ?? '', tags: m.tags.join(', ') || '—' });
      return { check, ok, got };
    });

    const refScore = refResults.length ? refResults.reduce((t, s) => t + s.total, 0) / refResults.length : 0;
    const controlIds = new Set(HOLDOUT_CASES.map((c) => c.id));
    const controlScores = refResults.filter((_, i) => controlIds.has(reference[i]!.id));
    const controlScore = controlScores.length ? controlScores.reduce((t, s) => t + s.total, 0) / controlScores.length : null;
    const passed = userResults.filter((r) => r.ok).length;
    const yoursRate = userResults.length ? (passed / userResults.length) * 100 : null;
    const overall = refResults.length && yoursRate !== null ? (refScore + yoursRate) / 2 : yoursRate ?? refScore;
    const providers = this.ctx.ai.settings().providers;
    const provider = providers.find((p) => p.id === client.id);
    const price = provider?.kind ? this.ctx.ai.catalog.cached(provider.kind, provider.baseUrl ?? '').find((m) => m.id === client.model) : undefined;
    const perMail = calls ? tokens / calls : 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    return {
      model: client.model,
      format: isJevModel(client.model) ? 'jev' : 'llm',
      overall: Math.round(overall * 10) / 10,
      reference: {
        score: Math.round(refScore * 10) / 10,
        cases: refResults.length,
        control: controlScore === null ? null : Math.round(controlScore * 10) / 10,
        mistakes: refResults.flatMap((s, i) => (s.mistakes.length ? [{ id: reference[i]!.id, subject: reference[i]!.subject, mistakes: s.mistakes, control: controlIds.has(reference[i]!.id) }] : [])),
      },
      yours: { passed, total: userResults.length, failures: userResults.filter((r) => !r.ok).map((r) => ({ ...r.check, got: r.got })) },
      latencyP50: sorted[Math.floor(sorted.length / 2)] ?? 0,
      tokensPerMail: Math.round(perMail),
      costPer1k: price ? (costUsd(price, perMail, isJevModel(client.model) ? 0 : 90) ?? 0) * 1000 : client.id === 'apple' ? 0 : null,
    };
  }

  /**
   * Asks a writing model for a better version of the current instructions, from the mistakes
   * the evaluation found, measures it the same way, and keeps it as a draft for the user.
   */
  async improve(opts: { goal?: string; by: 'user' | 'agent' | 'mcp'; route?: { providerId: string; model: string } | null }) {
    const current = this.ctx.prompts.get();
    const before = await this.evaluate({ prompts: current, route: opts.route, phase: t('Mesure de la version actuelle') });
    const format = before.format;
    const mistakes = [
      ...before.yours.failures.map((f) => `- [votre boîte] « ${f.subject} » de ${f.from} — attendu : ${f.because.toLowerCase()} ; obtenu : ${f.got}`),
      // The control mails stay hidden from the writer: they tell whether a proposal generalises.
      ...before.reference.mistakes.filter((m) => !m.control).map((m) => `- [référence] « ${m.subject} » — ${m.mistakes.join(' ; ')}`),
    ].slice(0, 40);
    if (!mistakes.length && !opts.goal) {
      return { draft: null, before, after: null, message: t('Aucune erreur à corriger : la version actuelle réussit tous les cas mesurés.') };
    }

    const rules = [
      'Corrige des RÈGLES générales, jamais un mail précis : ne cite aucun expéditeur, objet ou numéro des exemples.',
      'Garde ce qui marche : change le moins possible, une règle à la fois.',
      'Écris clairement et sans double négation.',
    ];
    const request =
      format === 'jev'
        ? {
            system: [
              'Tu améliores les questions posées à Jev, un modèle de décision (TypeSafe) qui répond à des questions oui/non avec une probabilité. ZMail combine ensuite les réponses en code.',
              'Règles TypeSafe : une seule judgment par question, énoncé littéral et concret, « oui » et « non » décrits comme des situations concrètes, pas de « ou » qui mélange deux idées.',
              ...rules,
              'Réponds en JSON {"questions": {"<id existant>": {"instructions": string, "yes": string, "no": string}}, "rationale": string}. Ne renvoie que les questions que tu modifies (5 au plus), avec leurs identifiants existants. rationale : 2 phrases en français.',
            ].join('\n'),
            prompt: [
              opts.goal ? `Objectif de l’utilisateur : ${opts.goal}` : null,
              'Questions actuelles (id : question | oui | non | usage par ZMail) :',
              ...Object.entries(current.triage.jev.questions).map(([id, q]) => `${id} : ${q.instructions} | oui = ${q.yes} | non = ${q.no} | ${JEV_SIGNAL_USE[id as keyof typeof JEV_SIGNAL_USE]?.use ?? ''}`),
              '',
              'Erreurs observées :',
              ...mistakes,
            ]
              .filter((l) => l !== null)
              .join('\n'),
            json: true,
            maxTokens: 1800,
            reasoning: 'low' as const,
          }
        : {
            system: [
              'Tu améliores les consignes de tri d’un client mail, données à un LLM qui classe chaque mail reçu (tags, priorité, spam, opportunité, OTP, résumé).',
              ...rules,
              'Garde les variables {{tags}} et {{opportunity_scope}} exactement à leur place, et une ligne par champ (tags, priority, spam, opportunity, otp, summary).',
              'Réponds en JSON {"prompt": string, "rationale": string}. rationale : 2 phrases en français.',
            ].join('\n'),
            prompt: [opts.goal ? `Objectif de l’utilisateur : ${opts.goal}` : null, 'Consignes actuelles :', '<<<', current.triage.llm, '>>>', '', 'Erreurs observées :', ...mistakes].filter((l) => l !== null).join('\n'),
            json: true,
            maxTokens: 2500,
            reasoning: 'low' as const,
          };
    bus.emitEvent({ type: 'lab', phase: t('Rédaction d’une meilleure version'), done: 0, total: 1 });
    const written = await this.ctx.ai.complete('chat', request);
    const data = written?.data as { prompt?: unknown; questions?: unknown; rationale?: unknown } | undefined;
    if (!data) throw new Error(t('Le modèle de rédaction n’a pas répondu : connectez un service d’IA (ZenMux, OpenAI…).'));

    let value: string | JevSetup;
    if (format === 'jev') {
      const changed = (data.questions && typeof data.questions === 'object' ? data.questions : {}) as JevSetup['questions'];
      const valid = Object.fromEntries(Object.entries(changed).filter(([id, q]) => id in current.triage.jev.questions && q?.instructions && q.yes && q.no));
      if (!Object.keys(valid).length) throw new Error(t('La proposition ne modifiait aucune question valide.'));
      value = { ...current.triage.jev, questions: { ...current.triage.jev.questions, ...valid } };
    } else {
      if (typeof data.prompt !== 'string') throw new Error(t('La proposition ne contenait pas de prompt.'));
      value = data.prompt;
    }
    const problems = this.ctx.prompts.validate('triage', format, value);
    if (problems.length) throw new Error(t('Proposition rejetée : {problems}', { problems: problems.join(' ') }));

    const candidate: PromptSet = format === 'jev' ? { ...current, triage: { ...current.triage, jev: value as JevSetup } } : { ...current, triage: { ...current.triage, llm: value as string } };
    const after = await this.evaluate({ prompts: candidate, route: opts.route, phase: t('Mesure de la proposition') });
    const draft = {
      at: Date.now(),
      format,
      value,
      rationale: typeof data.rationale === 'string' ? data.rationale : '',
      model: written!.model,
      before: before.overall,
      after: after.overall,
      controlBefore: before.reference.control,
      controlAfter: after.reference.control,
      by: opts.by,
    };
    this.ctx.prompts.setDraft(draft);
    const scores = { before: before.overall, after: after.overall, controlBefore: String(before.reference.control), controlAfter: String(after.reference.control) };
    const message =
      after.overall > before.overall && (after.reference.control ?? 0) >= (before.reference.control ?? 0)
        ? t('Proposition : {before} → {after}/100 (mails de contrôle jamais montrés au rédacteur : {controlBefore} → {controlAfter}). {rationale}', { ...scores, rationale: draft.rationale })
        : after.overall > before.overall
          ? t('Proposition : {before} → {after}/100, mais elle baisse sur les mails de contrôle ({controlBefore} → {controlAfter}) : elle risque d’avoir appris les exemples par cœur. À éviter.', scores)
          : t('La proposition ne fait pas mieux ({before} → {after}/100) : je vous conseille de garder la version actuelle.', scores);
    return { draft, before, after, message };
  }

  /** Puts the pending draft live. */
  applyDraft(by: 'user' | 'agent' | 'mcp') {
    const draft = this.ctx.prompts.draft();
    if (!draft) throw new Error(t('Aucune proposition en attente : lancez d’abord une amélioration.'));
    const saved = this.ctx.prompts.save('triage', draft.format, draft.value, { by, note: `${draft.rationale} (${draft.before} → ${draft.after})`, score: draft.after });
    this.ctx.prompts.setDraft(null);
    return saved;
  }
}
