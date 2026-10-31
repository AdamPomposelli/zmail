import type { CompletionRequest } from './providers';
import type { MailFeatures } from './heuristics';
import { buildJevTriage } from './jev';
import { getLocale } from '../lib/i18n';
import { CHAT_CONTRACT, DEFAULT_CHAT_PROMPT, DEFAULT_JEV_THRESHOLDS, DEFAULT_TRIAGE_PROMPT, TRIAGE_CONTRACT, renderPrompt, type PromptSet } from './prompt-config';

type TagRef = { id: string; name: string; description: string };

/**
 * The prompts are written (and benchmarked) in French; only the language of what people read
 * follows the app's: summaries, reasons and chat replies come out in English when ZMail is.
 */
export function inUserLanguage(instructions: string): string {
  if (getLocale() === 'fr') return instructions;
  return `${instructions.replace(/en français/g, 'en anglais').replace(/Tu parles français/g, 'Tu parles anglais')}\nLangue de l’utilisateur : anglais. Écris summary, spamReason, opportunityReason et tout texte destiné à l’utilisateur en anglais, quelle que soit la langue du mail.`;
}
type BusinessRef = { name: string; description: string };

/** The one triage call made per received mail. Shared by the pipeline, the benchmark and the prompt lab. */
export function buildTriageRequest(
  input: { features: MailFeatures; bulk: boolean; tags: TagRef[]; business?: BusinessRef; businesses: BusinessRef[] },
  prompts: Pick<PromptSet, 'triage'> = { triage: { llm: DEFAULT_TRIAGE_PROMPT, jev: { questions: {}, thresholds: DEFAULT_JEV_THRESHOLDS } } },
): CompletionRequest {
  const { features, bulk, tags, business, businesses } = input;
  const opportunityScope = business ? ` pour le business « ${business.name} » (${business.description || 'sans description'})` : businesses.length ? ` pour l’un des business : ${businesses.map((b) => b.name).join(', ')}` : '';
  const system = [TRIAGE_CONTRACT, renderPrompt(inUserLanguage(prompts.triage.llm), { tags: tags.map((t) => `- ${t.id} : ${t.description || t.name}`).join('\n'), opportunity_scope: opportunityScope })].join('\n');
  const prompt = [
    business ? `Business : ${business.name}` : null,
    `De : ${features.from.name ?? ''} <${features.from.email}>`,
    `À : ${features.to.map((a) => a.email).join(', ')}`,
    `Objet : ${features.subject}`,
    `Envoi de masse : ${bulk ? 'oui' : 'non'}${features.listUnsubscribe ? ' (lien de désinscription présent)' : ''}`,
    '',
    features.text.replace(/\s+\n/g, '\n').slice(0, 2500),
  ]
    .filter((l) => l !== null)
    .join('\n');
  // The same questions in typed form, for when the route picks Jev.
  const { model: _model, ...jev } = buildJevTriage({ ...input, model: '' }, prompts.triage.jev);
  return { system, prompt, json: true, maxTokens: 300, reasoning: 'off', jev, jevThresholds: prompts.triage.jev.thresholds };
}

export const CHAT_TOOL_DOCS = `Outils disponibles (dans "actions") :
- search_mail {query} : recherche plein texte dans tous les comptes.
- list_important {} : mails prioritaires non lus.
- summarize_inbox {} : état général de la boîte.
- create_tag {name, description} : crée un tag personnalisé (la description guide le classement IA).
- notify_on {topic, description?} : notifie l'utilisateur pour chaque nouveau mail sur ce sujet (ex. "chargeback"). Réutilise un tag existant si possible.
- create_rule {name, match:"all"|"any", conditions:[{field, op, value}], actions:[{type, value?}]}
    field ∈ from, fromDomain, to, subject, body, tag, business, account, listId, newsletter, priority, opportunity, otp
    op ∈ equals, contains, notContains, is, isNot, gte
    type ∈ archive, trash, markRead, star, spam, addTag, setPriority(0-3), setBusiness, setSpace, moveToFolder (value: id du dossier), notify, unsubscribe
- create_business {name, description, emoji?, domains[], addresses[]} : crée un business rattaché à des domaines/adresses de réception.
- unsubscribe_from {sender} : se désinscrire de la newsletter d'un expéditeur.
- triage_report {} : les erreurs de tri des 30 derniers jours (mails que l'utilisateur a corrigés) et le modèle utilisé.
- improve_triage {goal?} : propose une meilleure version des consignes de tri à partir de ces erreurs, la mesure sur les mails de l'utilisateur et sur le jeu de référence, et la garde en brouillon.
- apply_triage_draft {} : applique le brouillon proposé par improve_triage (seulement si l'utilisateur le demande).
- behavior_report {days?} : analyse les habitudes de l'utilisateur (par expéditeur, domaine, liste, catégorie…) : part ouverte, temps de lecture, part archivée, supprimée, rangée dans tel dossier ; liste les habitudes au-dessus de 70 % avec la règle qui les automatiserait. Utilise-le avant de proposer des règles.`;

export function buildChatRequest(input: { message: string; history: { role: 'user' | 'assistant'; content: string }[]; tags: string; businesses: string }, instructions = DEFAULT_CHAT_PROMPT): CompletionRequest {
  return {
    system: [inUserLanguage(instructions), CHAT_CONTRACT, CHAT_TOOL_DOCS, `Tags existants : ${input.tags}.`, `Business existants : ${input.businesses || 'aucun'}.`].join('\n'),
    prompt: [...input.history.slice(-6).map((t) => `${t.role === 'user' ? 'Utilisateur' : 'Agent'} : ${t.content}`), `Utilisateur : ${input.message}`].join('\n'),
    json: true,
    maxTokens: 600,
    reasoning: 'low',
  };
}
