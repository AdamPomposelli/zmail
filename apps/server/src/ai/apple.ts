import { t } from '../lib/i18n';
/** Language settings reported by ZMail.app (FoundationModels itself only says "not ready"). */
export type AppleDiagnostics = {
  systemLanguage?: string;
  systemLanguageName?: string;
  systemLanguageSupported?: boolean;
  siriLanguage?: string | null;
  siriLanguageName?: string;
  languagesMatch?: boolean | null;
};

export type AppleGuidance = {
  cause: 'language_mismatch' | 'language_unsupported' | 'not_enabled' | 'downloading' | 'device' | 'browser' | 'unknown';
  /** True when ZMail checked the cause itself; false when it is the likely explanation only. */
  detected: boolean;
  title: string;
  message: string;
  steps: string[];
  settingsUrl: string | null;
};

const SIRI_SETTINGS = 'x-apple.systempreferences:com.apple.Siri-Settings.extension';
const LANGUAGE_SETTINGS = 'x-apple.systempreferences:com.apple.Localization-Settings.extension';

const mismatchSteps = () => [
  t('Ouvrez Réglages Système → Apple Intelligence et Siri.'),
  t('Dans « Langue », choisissez la même langue que celle du Mac (ou changez la langue du Mac dans Général → Langue et région).'),
  t('Laissez le Mac branché et connecté au Wi-Fi : macOS télécharge alors le modèle (quelques Go, de quelques minutes à quelques heures).'),
  t('ZMail l’utilisera automatiquement dès qu’il sera prêt, sans rien redémarrer.'),
];

/** Turns FoundationModels' terse reason plus our own checks into an explanation a user can act on. */
export function appleGuidance(reason: string | null, diagnostics: AppleDiagnostics | undefined): AppleGuidance | null {
  if (reason === null) return null;
  const d = diagnostics ?? {};

  if (reason === 'app_not_running') {
    return {
      cause: 'browser',
      detected: true,
      title: t('Disponible uniquement dans l’app ZMail pour Mac'),
      message: t('Vous utilisez ZMail dans un navigateur : l’IA intégrée à macOS n’y est pas accessible. Ouvrez ZMail.app pour l’utiliser.'),
      steps: [],
      settingsUrl: null,
    };
  }
  if (reason === 'deviceNotEligible') {
    return {
      cause: 'device',
      detected: true,
      title: t('Ce Mac n’est pas compatible Apple Intelligence'),
      message: t('Apple Intelligence demande un Mac avec puce Apple (M1 ou plus récent). ZMail utilise à la place vos services connectés ou son moteur local.'),
      steps: [],
      settingsUrl: null,
    };
  }
  if (d.languagesMatch === false) {
    return {
      cause: 'language_mismatch',
      detected: true,
      title: t('Siri et votre Mac ne sont pas dans la même langue'),
      message: t('Votre Mac est en {system} mais Siri est en {siri}. macOS désactive Apple Intelligence (et ne télécharge pas son modèle) tant que les deux langues diffèrent. C’est la cause la plus fréquente.', {
        system: d.systemLanguageName ?? d.systemLanguage ?? '',
        siri: d.siriLanguageName ?? d.siriLanguage ?? '',
      }),
      steps: mismatchSteps(),
      settingsUrl: SIRI_SETTINGS,
    };
  }
  if (d.systemLanguageSupported === false) {
    return {
      cause: 'language_unsupported',
      detected: true,
      title: t('La langue de votre Mac n’est pas prise en charge'),
      message: t('Apple Intelligence n’est pas encore disponible en {language}. Passez le Mac et Siri dans une langue prise en charge (français, anglais…).', { language: d.systemLanguageName ?? d.systemLanguage ?? '' }),
      steps: [t('Ouvrez Réglages Système → Général → Langue et région.'), t('Placez une langue prise en charge en tête de liste, puis réglez Siri dans la même langue.')],
      settingsUrl: LANGUAGE_SETTINGS,
    };
  }
  if (reason === 'appleIntelligenceNotEnabled') {
    return {
      cause: 'not_enabled',
      detected: true,
      title: t('Apple Intelligence est désactivée'),
      message: t('Activez-la pour que ZMail trie vos mails gratuitement et en local.'),
      steps: [t('Ouvrez Réglages Système → Apple Intelligence et Siri.'), t('Activez Apple Intelligence, puis laissez macOS télécharger le modèle (Mac branché, Wi-Fi).')],
      settingsUrl: SIRI_SETTINGS,
    };
  }
  if (reason === 'modelNotReady') {
    const checked = d.languagesMatch === true;
    return {
      cause: checked ? 'downloading' : 'unknown',
      detected: checked,
      title: checked ? t('Le modèle est en cours de téléchargement') : t('Le modèle d’Apple Intelligence n’est pas prêt'),
      message: checked
        ? t('Vos langues sont cohérentes : macOS télécharge ou prépare le modèle. Laissez le Mac branché et connecté au Wi-Fi, avec quelques Go d’espace libre.')
        : t('macOS ne précise pas la raison à ZMail, et ZMail n’a pas pu lire la langue de Siri. Cause la plus fréquente : Siri et le Mac ne sont pas dans la même langue. Sinon, le modèle est encore en téléchargement.'),
      steps: checked ? [t('Gardez le Mac branché et sur le Wi-Fi.'), t('Vérifiez qu’il reste au moins 7 Go libres.')] : mismatchSteps(),
      settingsUrl: SIRI_SETTINGS,
    };
  }
  return {
    cause: 'unknown',
    detected: false,
    title: t('Apple Intelligence est indisponible'),
    message: t('macOS a répondu « {reason} ». Vérifiez Réglages Système → Apple Intelligence et Siri ; la cause la plus fréquente est une langue de Siri différente de celle du Mac.', { reason }),
    steps: mismatchSteps(),
    settingsUrl: SIRI_SETTINGS,
  };
}
