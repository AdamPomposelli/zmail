import { z } from 'zod';
import type { EngineContext } from '../context';
import type { ThreadListItem } from '../types';
import { ActionSchema, ConditionSchema, describeAction } from '../rules/engine';
import { buildChatRequest } from './prompts';
import { t, tp } from '../lib/i18n';
import { tagLabel } from './taxonomy';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type AgentStep = { tool: string; summary: string; ok: boolean };

export type AgentReply = { reply: string; steps: AgentStep[]; threads: ThreadListItem[]; engine: string };

export const ToolCall = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('search_mail'), args: z.object({ query: z.string() }) }),
  z.object({ tool: z.literal('list_important'), args: z.object({}).passthrough().optional() }),
  z.object({ tool: z.literal('summarize_inbox'), args: z.object({}).passthrough().optional() }),
  z.object({ tool: z.literal('create_tag'), args: z.object({ name: z.string(), description: z.string().default(''), color: z.string().optional() }) }),
  z.object({ tool: z.literal('notify_on'), args: z.object({ topic: z.string(), description: z.string().optional() }) }),
  z.object({
    tool: z.literal('create_rule'),
    args: z.object({ name: z.string(), match: z.enum(['all', 'any']).default('all'), conditions: z.array(ConditionSchema), actions: z.array(ActionSchema) }),
  }),
  z.object({
    tool: z.literal('create_business'),
    args: z.object({
      name: z.string(),
      description: z.string().default(''),
      emoji: z.string().optional(),
      color: z.string().optional(),
      domains: z.array(z.string()).default([]),
      addresses: z.array(z.string()).default([]),
    }),
  }),
  z.object({ tool: z.literal('unsubscribe_from'), args: z.object({ sender: z.string() }) }),
  z.object({ tool: z.literal('triage_report'), args: z.object({}).passthrough().optional() }),
  z.object({ tool: z.literal('improve_triage'), args: z.object({ goal: z.string().optional() }).passthrough().optional() }),
  z.object({ tool: z.literal('apply_triage_draft'), args: z.object({}).passthrough().optional() }),
]);
type ToolCall = z.infer<typeof ToolCall>;

const PALETTE = ['#F43F5E', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16'];

export class MailAgent {
  constructor(private readonly ctx: EngineContext) {}

  async chat(message: string, history: ChatTurn[]): Promise<AgentReply> {
    const plan = await this.plan(message, history);
    const steps: AgentStep[] = [];
    const threads: ThreadListItem[] = [];
    for (const call of plan.actions) {
      try {
        const result = await this.execute(call);
        steps.push({ tool: call.tool, summary: result.summary, ok: true });
        threads.push(...(result.threads ?? []));
      } catch (error) {
        steps.push({ tool: call.tool, summary: (error as Error).message, ok: false });
      }
    }
    // Without a written reply, the step cards already say what happened.
    const reply = plan.reply || (steps.length ? '' : this.help());
    return { reply, steps, threads: dedupe(threads).slice(0, 10), engine: plan.engine };
  }

  private async plan(message: string, history: ChatTurn[]): Promise<{ reply: string; actions: ToolCall[]; engine: string }> {
    const tags = this.ctx.catalog.tags().map((t) => `${t.id} (${t.name})`).join(', ');
    const businesses = this.ctx.catalog.businesses().map((b) => `${b.id} (${b.name})`).join(', ');
    const result = await this.ctx.ai.complete('chat', buildChatRequest({ message, history, tags, businesses }, this.ctx.prompts.get().chat.llm));
    if (result?.data && typeof result.data === 'object') {
      const data = result.data as { reply?: unknown; actions?: unknown };
      const actions = (Array.isArray(data.actions) ? data.actions : []).flatMap((a) => {
        const parsed = ToolCall.safeParse(a);
        return parsed.success ? [parsed.data] : [];
      });
      return { reply: typeof data.reply === 'string' ? data.reply : '', actions, engine: result.provider === 'apple' ? 'apple' : result.model };
    }
    return { ...this.planWithoutModel(message), engine: 'heuristic' };
  }

  /** Understands the common requests when no model is available. */
  planWithoutModel(message: string): { reply: string; actions: ToolCall[] } {
    const text = message.trim();
    const lower = text.toLowerCase();
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    const domain = text.match(/@([\w-]+\.[\w.-]+)/)?.[1] ?? text.match(/\b([\w-]+\.(com|fr|io|net|org|co|app|dev|eu))\b/)?.[1];

    const notify = lower.match(/(?:notifi\w*|pr[ée]vien\w*|alerte\w*|notify|ping)[^.]*?(?:pour|de|des|du|sur|quand|à chaque|when|about|on)\s+(?:les |la |le |l'|tous les |toutes les |chaque |nouveaux? |mails? |e-?mails? |de |d')*([\p{L}\d][\p{L}\d\s-]{1,40})/u);
    if (notify) {
      const topic = notify[1]!.replace(/\b(mails?|e-?mails?|messages?|re[çc]us?|stp|svp|please)\b/g, '').trim();
      return { reply: '', actions: [{ tool: 'notify_on', args: { topic } }] };
    }
    const unsubscribe = /(d[ée]sinscri|d[ée]sabonn|unsubscribe)/.test(lower);
    if (unsubscribe && (email || domain)) return { reply: '', actions: [{ tool: 'unsubscribe_from', args: { sender: email ?? domain! } }] };

    const autoAction = lower.match(/\b(archive|archiver|supprime|supprimer|corbeille|marque comme lu|spam)\b/);
    if (autoAction && (email || domain) && /(toujours|automatiquement|tous|toutes|chaque|à l'avenir|désormais)/.test(lower)) {
      const type = /archiv/.test(autoAction[1]!) ? 'archive' : /lu/.test(autoAction[1]!) ? 'markRead' : /spam/.test(autoAction[1]!) ? 'spam' : 'trash';
      const condition = email ? { field: 'from' as const, op: 'equals' as const, value: email } : { field: 'fromDomain' as const, op: 'equals' as const, value: domain! };
      return {
        reply: '',
        actions: [{ tool: 'create_rule', args: { name: `${describeAction({ type })} — ${condition.value}`, match: 'all', conditions: [condition], actions: [{ type }] } }],
      };
    }
    // Improving the sorting itself: report, propose, apply.
    if (/(applique|valide|garde).*(proposition|brouillon|version|prompt)/.test(lower)) return { reply: '', actions: [{ tool: 'apply_triage_draft', args: {} }] };
    if (/(am[ée]liore|optimise|corrige|r[ée]gle|it[èe]re).*(tri|classement|classification|prompt)/.test(lower)) return { reply: '', actions: [{ tool: 'improve_triage', args: { goal: text } }] };
    if (/(erreurs?|incoh[ée]rences?|bugs?|probl[èe]mes?).*(tri|classement|classification)|(tri|classement).*(erreurs?|incoh[ée]rences?)/.test(lower)) return { reply: '', actions: [{ tool: 'triage_report', args: {} }] };
    const tag = text.match(/(?:cr[ée]e|ajoute|nouveau|nouvelle)\s+(?:un\s+|une\s+)?(?:tag|cat[ée]gorie)\s+[«"']?([^»"',.]+)[»"']?(?:\s+pour\s+(.+))?/i);
    if (tag) return { reply: '', actions: [{ tool: 'create_tag', args: { name: tag[1]!.trim(), description: tag[2]?.trim() ?? '' } }] };

    const search = text.match(/(?:cherche|trouve|recherche|search|find|o[uù] est|retrouve)\s+(?:moi\s+)?(?:les?\s+|la\s+|des\s+|le mail\s+|mails?\s+)?(.+)/i);
    if (search) return { reply: '', actions: [{ tool: 'search_mail', args: { query: search[1]!.replace(/[?.!]$/, '') } }] };
    if (/(important|prioritaire|urgent|priorit|à traiter|a traiter)/.test(lower)) return { reply: '', actions: [{ tool: 'list_important', args: {} }] };
    if (/(r[ée]sum|quoi de neuf|[ée]tat|bilan|overview|summary)/.test(lower)) return { reply: '', actions: [{ tool: 'summarize_inbox', args: {} }] };
    return { reply: this.help(), actions: [] };
  }

  private help() {
    return [
      t('Je peux par exemple :'),
      t('• « Notifie-moi de tous les chargebacks »'),
      t('• « Quels sont mes mails importants ? »'),
      t('• « Archive automatiquement tout ce qui vient de @medium.com »'),
      t('• « Crée une catégorie Fournisseurs pour les mails de mes fournisseurs »'),
      t('• « Désinscris-moi de news@exemple.com »'),
      t('• « Cherche la facture OVH »'),
    ].join('\n');
  }

  private async execute(call: ToolCall): Promise<{ summary: string; threads?: ThreadListItem[] }> {
    const { store, catalog, rules } = this.ctx;
    switch (call.tool) {
      case 'search_mail': {
        const { items } = store.listThreads({ view: 'inbox', query: call.args.query, limit: 10 });
        const archived = items.length ? [] : store.listThreads({ view: 'archive', query: call.args.query, limit: 10 }).items;
        const threads = [...items, ...archived];
        return {
          summary: threads.length
            ? tp(threads.length, '{n} conversation trouvée pour « {query} ».', '{n} conversations trouvées pour « {query} ».', { query: call.args.query })
            : t('Rien trouvé pour « {query} ».', { query: call.args.query }),
          threads,
        };
      }
      case 'list_important': {
        const threads = store.listThreads({ view: 'priority', limit: 10 }).items.filter((t) => t.unread);
        return { summary: threads.length ? tp(threads.length, '{n} mail prioritaire non lu.', '{n} mails prioritaires non lus.') : t('Aucun mail prioritaire en attente. 🎉'), threads };
      }
      case 'summarize_inbox': {
        const counts = store.counts();
        const v = counts.views;
        return {
          summary: t('Non lus — inbox : {inbox}, prioritaires : {priority}, opportunités : {opportunities}, newsletters : {newsletters}, spam écarté : {spam}.', {
            inbox: v.inbox ?? 0,
            priority: v.priority ?? 0,
            opportunities: v.opportunities ?? 0,
            newsletters: v.newsletters ?? 0,
            spam: v.spam ?? 0,
          }),
          threads: store.listThreads({ view: 'priority', limit: 5 }).items,
        };
      }
      case 'create_tag': {
        const tag = catalog.saveTag({ name: call.args.name, description: call.args.description, color: call.args.color ?? PALETTE[catalog.tags().length % PALETTE.length]! });
        return { summary: t('Catégorie « {name} » créée. Les prochains mails y seront classés.', { name: tag.name }) };
      }
      case 'notify_on': {
        const topic = call.args.topic.toLowerCase().replace(/(?<=\w{3})[sx]$/, '');
        const existing =
          catalog.findTag(topic) ??
          catalog.tags().find((t) => t.name.toLowerCase().includes(topic)) ??
          catalog.tags().find((t) => t.kind === 'system' && t.description.toLowerCase().includes(topic));
        const tag =
          existing ??
          catalog.saveTag({
            name: call.args.topic.charAt(0).toUpperCase() + call.args.topic.slice(1),
            description: call.args.description ?? `Mails qui parlent de ${call.args.topic}, ${call.args.topic}`,
            color: PALETTE[catalog.tags().length % PALETTE.length]!,
          });
        const rule = rules.create(
          { name: t('Notifier : {name}', { name: tagLabel(tag) }), enabled: true, match: 'any', conditions: [{ field: 'tag', op: 'is', value: tag.id }, { field: 'subject', op: 'contains', value: topic }], actions: [{ type: 'notify' }] },
          'agent',
        );
        return { summary: t('C’est noté : vous recevrez une notification macOS pour chaque nouveau mail « {tag} » (règle « {rule} »).', { tag: tagLabel(tag), rule: rule.name }) };
      }
      case 'create_rule': {
        const rule = rules.create({ ...call.args, enabled: true }, 'agent');
        return { summary: t('Règle « {name} » créée : {actions}.', { name: rule.name, actions: rule.actions.map(describeAction).join(', ') }) };
      }
      case 'create_business': {
        const business = catalog.saveBusiness({
          name: call.args.name,
          description: call.args.description,
          emoji: call.args.emoji ?? null,
          color: call.args.color ?? PALETTE[catalog.businesses().length % PALETTE.length]!,
          matchers: [...call.args.domains.map((value) => ({ type: 'domain' as const, value })), ...call.args.addresses.map((value) => ({ type: 'address' as const, value }))],
        });
        return { summary: t('Business « {name} » créé.', { name: business.name }) };
      }
      case 'triage_report': {
        const r = this.ctx.lab.report(30);
        const engines = r.engines.map((e) => `${engineName(e.engine)} (${e.n})`).join(', ') || t('aucun');
        if (!r.corrections.length) return { summary: t('Sur 30 jours : {sorted} mails triés ({engines}), aucune correction de votre part. Rien d’incohérent à signaler.', { sorted: r.sorted, engines }) };
        const lines = r.corrections.slice(0, 8).map((c) => `• « ${c.subject} » (${c.from}) : ${c.what}${c.engine ? t(' — tri par {engine}', { engine: engineName(c.engine) }) : ''}`);
        return {
          summary: [
            tp(r.corrections.length, 'Sur 30 jours : {sorted} mails triés ({engines}), {n} correction de votre part ({rate} %).', 'Sur 30 jours : {sorted} mails triés ({engines}), {n} corrections de votre part ({rate} %).', {
              sorted: r.sorted,
              engines,
              rate: (r.errorRate * 100).toFixed(1),
            }), ...lines, t('Dites « améliore le tri » pour que je propose et mesure une meilleure version.')].join('\n'),
        };
      }
      case 'improve_triage': {
        const result = await this.ctx.lab.improve({ goal: call.args?.goal, by: 'agent' });
        if (!result.draft) return { summary: result.message };
        const better = result.after && result.after.overall > result.before.overall;
        return {
          summary: [
            result.message,
            t('Mesuré sur {reference} mails de référence et {yours} de vos mails (vos corrections font foi), avec {model}.', { reference: result.before.reference.cases, yours: result.before.yours.total, model: result.before.model }),
            better ? t('Dites « applique la proposition » pour la mettre en service, ou ouvrez Réglages → IA → Avancé pour la relire.') : '',
          ].filter(Boolean).join('\n'),
        };
      }
      case 'apply_triage_draft': {
        const draft = this.ctx.prompts.draft();
        this.ctx.lab.applyDraft('agent');
        return { summary: t('Nouvelle version des consignes de tri en service ({before} → {after}/100). L’ancienne reste dans l’historique : Réglages → IA → Avancé.', { before: String(draft?.before), after: String(draft?.after) }) };
      }
      case 'unsubscribe_from': {
        const sender = call.args.sender.toLowerCase();
        const row = this.ctx.db.get<{ thread_id: string; from_email: string }>(
          `SELECT thread_id, from_email FROM messages WHERE from_email = ? OR from_email LIKE ? ORDER BY date DESC LIMIT 1`,
          sender,
          `%@${sender.replace(/^@/, '')}`,
        );
        if (!row) throw new Error(t('Aucun mail de {sender} trouvé.', { sender }));
        const outcome = await this.ctx.subscriptions.unsubscribe(row.thread_id, 'user');
        return {
          summary:
            outcome.status === 'success'
              ? t('Désinscrit de {sender}. {detail}', { sender: row.from_email, detail: outcome.detail })
              : t('Impossible de vous désinscrire de {sender} : {detail}', { sender: row.from_email, detail: outcome.detail }),
        };
      }
    }
  }
}

/** « typesafe/jev-1.13 » → « Jev 1.13 », « heuristic » → « moteur local ». */
const engineName = (engine: string) =>
  engine === 'heuristic' ? t('moteur local') : engine === 'apple' ? 'Apple Intelligence' : engine.startsWith('typesafe/') ? `Jev ${engine.replace(/^typesafe\/jev-/, '')}` : engine.replace(/^[^/]+\//, '');

const dedupe = (threads: ThreadListItem[]) => [...new Map(threads.map((t) => [t.id, t])).values()];
