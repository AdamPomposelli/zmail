import { t } from '../lib/i18n';

/**
 * What ZMail asks models to do. Each capability is routed to a model on its own: the
 * orchestrator picks the benchmarked recommendation unless the user overrides it.
 */
export const CAPABILITIES = {
  triage: {
    get label() {
      return t('Tri des mails');
    },
    get description() {
      return t('Tags, priorité, spam, opportunités, extraction OTP et résumé — un appel par mail reçu.');
    },
    /** Fallback token sizes when no measurement exists yet. */
    promptTokens: 1100,
    completionTokens: 110,
  },
  chat: {
    get label() {
      return t('Agent conversationnel');
    },
    get description() {
      return t('Vos demandes en langage naturel et les outils qu’il déclenche.');
    },
    promptTokens: 900,
    completionTokens: 160,
  },
  unsubscribe: {
    get label() {
      return t('Désinscription');
    },
    get description() {
      return t('Lecture de la page de désinscription quand elle est ambiguë.');
    },
    promptTokens: 750,
    completionTokens: 40,
  },
} as const;

export type Capability = keyof typeof CAPABILITIES;
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as Capability[];
