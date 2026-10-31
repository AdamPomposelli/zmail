import type { Database } from '../db';
import { newId } from '../lib/ids';
import { intlLocale, t } from '../lib/i18n';

/**
 * The editable part of every AI action, with versions. Each action keeps a fixed « contract »
 * (the reply format ZMail parses) outside the user's reach, so an edit can change how a model
 * judges, never break how ZMail reads its answer.
 *
 * Two formats exist for triage: a prompt for LLMs, and typed questions for Jev (which reads
 * no prompt). Both are stored; the model the route picks decides which one is used.
 */

export type PromptAction = 'triage' | 'chat' | 'unsubscribe';
export type PromptFormat = 'llm' | 'jev';

/** A Jev question as the user edits it: the question and what counts as yes / no. */
export type JevQuestionText = { instructions: string; yes: string; no: string };
export type JevSetup = { questions: Record<string, JevQuestionText>; thresholds: { yes: number; lean: number } };

export type PromptSet = {
  triage: { llm: string; jev: JevSetup };
  chat: { llm: string };
  unsubscribe: { llm: string };
};

/** Placeholders an LLM prompt may use; ZMail fills them for each mail. */
export const PROMPT_VARIABLES: Record<PromptAction, { name: string; description: string; required?: boolean }[]> = {
  triage: [
    {
      name: 'tags',
      get description() {
        return t('La liste de vos tags (identifiant : description), à laquelle le modèle doit se limiter.');
      },
      required: true,
    },
    {
      name: 'opportunity_scope',
      get description() {
        return t('Le business concerné par le mail, ou la liste de vos business.');
      },
    },
  ],
  chat: [],
  unsubscribe: [],
};

export const DEFAULT_TRIAGE_PROMPT = [
  "Tu es le moteur de tri de ZMail. Tu analyses UN e-mail reçu par l'utilisateur.",
  'tags : 0 à 3 identifiants pris UNIQUEMENT dans cette liste :',
  '{{tags}}',
  'priority : urgent = action requise aujourd’hui (litige, chargeback, paiement échoué, client mécontent ou bloqué, sécurité compromise, compte suspendu ou fermé dans les 48 h) ; high = un service menace de suspendre, bloquer ou fermer un compte de l’utilisateur ou exige une vérification d’identité pour le garder (même envoyé par un robot, sauf phishing), une vraie personne attend une réponse, opportunité commerciale, échéance proche, code OTP, alerte de connexion ; normal = utile sans urgence (factures, commandes, livraisons, réunions) ; low = newsletters, marketing, notifications automatiques, spam.',
  'spam : true pour arnaques, phishing, faux gains, cryptomonnaies douteuses, prospection de masse non sollicitée (SEO, « boostez vos ventes »). Phishing typique : un expéditeur qui se présente comme DPD, UPS, Amazon, La Poste, une banque ou un service public mais écrit depuis un domaine sans rapport ou aléatoire, un faux colis en attente, un message qui vous appelle par votre adresse e-mail. En cas de doute, spam = true : l’utilisateur préfère vérifier son dossier spam qu’avoir du bruit dans sa boîte. Une newsletter légitime ou une notification d’un service dont le domaine correspond n’est pas du spam.',
  'opportunity : true seulement si une vraie personne ou entreprise demande un devis, un partenariat, une commande en gros ou une collaboration{{opportunity_scope}}. La prospection commerciale envoyée en masse n’est pas une opportunité.',
  'otp : le code de vérification à usage unique exact (sans espaces), seulement si le mail le présente explicitement comme tel (code de connexion, de vérification, à ne pas partager), sinon null. Ne sont jamais des OTP : un code promo, un numéro de commande, de facture, de suivi de colis, de dossier ou de passeport, un code postal, un identifiant présent dans un lien. Si le mail est un spam, otp = null.',
  'summary : une phrase en français, 15 mots maximum, qui dit ce que veut l’expéditeur.',
].join('\n');

export const TRIAGE_CONTRACT =
  'Réponds en JSON strict : {"tags": string[], "priority": "urgent"|"high"|"normal"|"low", "spam": boolean, "spamReason": string|null, "opportunity": boolean, "opportunityReason": string|null, "otp": string|null, "summary": string}';

export const DEFAULT_CHAT_PROMPT = [
  "Tu es l'agent de ZMail, le client mail de l'utilisateur. Tu tries, ranges et automatises sa boîte. Tu parles français, de façon brève et chaleureuse.",
  "N'invente pas de contenu de mail : utilise search_mail ou list_important pour en montrer.",
  'Pour améliorer le tri, commence par triage_report pour voir les erreurs, puis improve_triage pour proposer et mesurer une meilleure version ; ne l’applique (apply_triage_draft) que si l’utilisateur le demande.',
].join('\n');

export const CHAT_CONTRACT = 'Réponds TOUJOURS en JSON : {"reply": string, "actions": [{"tool": string, "args": object}]}.';

export const DEFAULT_UNSUBSCRIBE_PROMPT =
  'Tu analyses la page web affichée après une tentative de désinscription d’une newsletter. « success » seulement si la page confirme clairement que la désinscription est faite.';

export const UNSUBSCRIBE_CONTRACT = 'Réponds en JSON {"status":"success"|"needs_action","reason":string}.';

export const DEFAULT_JEV_THRESHOLDS = { yes: 0.7, lean: 0.5 };

/** Fills {{placeholders}}; unknown ones are left visible so a typo shows in the test results. */
export const renderPrompt = (template: string, vars: Record<string, string>) => template.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, name: string) => vars[name] ?? all);

export type PromptVersion = { id: string; at: number; action: PromptAction; format: PromptFormat; by: 'user' | 'agent' | 'mcp' | 'reset'; note: string; value: unknown; score?: number | null };

type Saved = { triage?: { llm?: string; jev?: Partial<JevSetup> }; chat?: { llm?: string }; unsubscribe?: { llm?: string } };

const KEY = 'ai.prompts';
const HISTORY_KEY = 'ai.prompts.history';
const DRAFT_KEY = 'ai.prompts.draft';

export class PromptStore {
  /** Jev's default questions come from jev.ts; injected to avoid a circular import. */
  constructor(
    private readonly db: Database,
    private readonly jevDefaults: () => Record<string, JevQuestionText>,
  ) {}

  defaults(): PromptSet {
    return {
      triage: { llm: DEFAULT_TRIAGE_PROMPT, jev: { questions: this.jevDefaults(), thresholds: { ...DEFAULT_JEV_THRESHOLDS } } },
      chat: { llm: DEFAULT_CHAT_PROMPT },
      unsubscribe: { llm: DEFAULT_UNSUBSCRIBE_PROMPT },
    };
  }

  private saved(): Saved {
    return this.db.getSetting<Saved>(KEY, {});
  }

  /** What ZMail runs now: the defaults with the user's edits on top. */
  get(): PromptSet {
    const d = this.defaults();
    const s = this.saved();
    return {
      triage: {
        llm: s.triage?.llm ?? d.triage.llm,
        jev: {
          questions: { ...d.triage.jev.questions, ...(s.triage?.jev?.questions ?? {}) },
          thresholds: { ...d.triage.jev.thresholds, ...(s.triage?.jev?.thresholds ?? {}) },
        },
      },
      chat: { llm: s.chat?.llm ?? d.chat.llm },
      unsubscribe: { llm: s.unsubscribe?.llm ?? d.unsubscribe.llm },
    };
  }

  /** Which parts differ from ZMail's defaults. */
  customised() {
    const s = this.saved();
    return {
      triage: { llm: s.triage?.llm !== undefined, jev: Boolean(s.triage?.jev && (Object.keys(s.triage.jev.questions ?? {}).length || s.triage.jev.thresholds)) },
      chat: { llm: s.chat?.llm !== undefined },
      unsubscribe: { llm: s.unsubscribe?.llm !== undefined },
    };
  }

  validate(action: PromptAction, format: PromptFormat, value: unknown): string[] {
    const problems: string[] = [];
    if (format === 'llm') {
      if (typeof value !== 'string' || value.trim().length < 20) problems.push(t('Le prompt est vide ou trop court.'));
      else for (const v of PROMPT_VARIABLES[action]) if (v.required && !value.includes(`{{${v.name}}}`)) problems.push(t('Il manque {{{name}}} : {description}', { name: v.name, description: v.description }));
    } else {
      const setup = value as Partial<JevSetup>;
      const known = this.jevDefaults();
      for (const [id, q] of Object.entries(setup.questions ?? {})) {
        if (!(id in known)) problems.push(t('Question inconnue : {id}', { id }));
        else if (!q.instructions?.trim() || !q.yes?.trim() || !q.no?.trim()) problems.push(t('La question {id} doit avoir un énoncé, un « oui » et un « non ».', { id }));
      }
      const th = setup.thresholds;
      if (th && (th.yes < 0.5 || th.yes > 0.95 || th.lean < 0.3 || th.lean > th.yes)) problems.push(t('Seuils attendus : 0,3 ≤ « plutôt oui » ≤ « oui » ≤ 0,95.'));
    }
    return problems;
  }

  save(action: PromptAction, format: PromptFormat, value: string | JevSetup, meta: { by: PromptVersion['by']; note?: string; score?: number | null }) {
    const problems = this.validate(action, format, value);
    if (problems.length) throw new Error(problems.join(' '));
    const saved = this.saved();
    const previous = this.get();
    this.pushHistory({ action, format, by: meta.by, note: meta.note ?? '', value: format === 'jev' ? previous.triage.jev : previous[action].llm, score: meta.score ?? null });
    if (format === 'jev') {
      // Only what differs from the defaults is stored, so later improvements to the defaults still apply.
      const defaults = this.defaults().triage.jev;
      const setup = value as JevSetup;
      const questions = Object.fromEntries(Object.entries(setup.questions).filter(([id, q]) => JSON.stringify(q) !== JSON.stringify(defaults.questions[id])));
      const thresholds = JSON.stringify(setup.thresholds) === JSON.stringify(defaults.thresholds) ? undefined : setup.thresholds;
      saved.triage = { ...saved.triage, jev: { questions, ...(thresholds ? { thresholds } : {}) } };
    } else {
      const text = value as string;
      const isDefault = text === this.defaults()[action].llm;
      saved[action] = { ...saved[action], llm: isDefault ? undefined : text } as never;
    }
    this.db.setSetting(KEY, saved);
    return this.get();
  }

  reset(action: PromptAction, format: PromptFormat) {
    const d = this.defaults();
    return this.save(action, format, format === 'jev' ? d.triage.jev : d[action].llm, { by: 'reset', note: t('Valeurs par défaut de ZMail') });
  }

  history(limit = 30): PromptVersion[] {
    return this.db.getSetting<PromptVersion[]>(HISTORY_KEY, []).slice(0, limit);
  }

  /** Puts back a version from the history (the current one is kept in the history too). */
  restore(id: string) {
    const version = this.history(200).find((v) => v.id === id);
    if (!version) throw new Error(t('Version introuvable'));
    return this.save(version.action, version.format, version.value as string | JevSetup, { by: 'user', note: t('Retour à la version du {date}', { date: new Date(version.at).toLocaleString(intlLocale()) }) });
  }

  private pushHistory(entry: Omit<PromptVersion, 'id' | 'at'>) {
    const list = this.db.getSetting<PromptVersion[]>(HISTORY_KEY, []);
    this.db.setSetting(HISTORY_KEY, [{ ...entry, id: newId('pv'), at: Date.now() }, ...list].slice(0, 100));
  }

  /** A proposal waiting for the user's go-ahead (from the agent or the « Améliorer » button). */
  draft(): PromptDraft | null {
    return this.db.getSetting<PromptDraft | null>(DRAFT_KEY, null);
  }
  setDraft(draft: PromptDraft | null) {
    this.db.setSetting(DRAFT_KEY, draft);
  }
}

export type PromptDraft = {
  at: number;
  format: PromptFormat;
  value: string | JevSetup;
  rationale: string;
  model: string;
  before: number;
  after: number;
  /** Score on the held-out mails the writer never saw: the proof a change generalises. */
  controlBefore?: number | null;
  controlAfter?: number | null;
  by: 'user' | 'agent' | 'mcp';
};
