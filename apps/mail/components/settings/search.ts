import { solar, type IconComponent } from '@/components/ui/solar-icon';
import { settingsAnchor } from '@/components/settings/ui';
import { t } from '@/lib/i18n';

export type SettingsPageId = 'accounts' | 'tags' | 'rules' | 'notifications' | 'businesses' | 'ai' | 'mcp' | 'signatures' | 'appearance' | 'security' | 'api' | 'activity';

/** Ordered by how often people come back to each page: accounts first, developer pages last. */
const Mail = solar('_accounts');
const Tag = solar('_tags');
const Wand2 = solar('_rules');
const Bell = solar('_notifications');
const Briefcase = solar('_business');
const Bot = solar('_ai');
const Plug = solar('_mcp');
const PenLine = solar('_signatures');
const Palette = solar('_appearance');
const Shield = solar('_security');
const Braces = solar('_api');
const Activity = solar('_activity');

export const SETTINGS_PAGES: { id: SettingsPageId; label: string; icon: IconComponent }[] = [
  { id: 'accounts', label: t('Comptes'), icon: Mail },
  { id: 'tags', label: t('Catégories'), icon: Tag },
  { id: 'rules', label: t('Règles'), icon: Wand2 },
  { id: 'notifications', label: t('Notifications'), icon: Bell },
  { id: 'businesses', label: t('Business'), icon: Briefcase },
  { id: 'ai', label: t('Intelligence artificielle'), icon: Bot },
  { id: 'mcp', label: t('Connecteurs IA (MCP)'), icon: Plug },
  { id: 'signatures', label: t('Signatures'), icon: PenLine },
  { id: 'appearance', label: t('Apparence et langue'), icon: Palette },
  { id: 'security', label: t('Sécurité'), icon: Shield },
  { id: 'api', label: t('API'), icon: Braces },
  { id: 'activity', label: t('Journal d’activité'), icon: Activity },
];

type Entry = { page: SettingsPageId; title: string; hint: string; anchor?: string; query?: string; keywords: string };

/**
 * Everything a newcomer may look for, in their words rather than ours: "mot de passe",
 * "clé API", "mode sombre"… `anchor` defaults to the card or row carrying that title.
 */
const ENTRIES: Entry[] = [
  { page: 'accounts', title: t('Comptes mail'), anchor: '', hint: t('Boîtes connectées, état de la synchronisation'), keywords: t('boite mail adresse email imap smtp gmail icloud outlook mailbox.org namecheap ovh zoho fastmail serveur') },
  { page: 'accounts', title: t('Ajouter une boîte mail'), anchor: '', query: 'add=1', hint: t('Assistant de connexion pas à pas'), keywords: t('ajouter nouveau compte connecter boite adresse mot de passe d’application identifiant login imap smtp port') },
  { page: 'accounts', title: t('Resynchroniser ou déconnecter un compte'), anchor: '', hint: t('Actions sur chaque compte'), keywords: t('resync synchronisation supprimer retirer déconnecter erreur connexion') },
  { page: 'accounts', title: t('Comment ça marche'), hint: t('IMAP IDLE, temps réel'), keywords: t('temps réel idle push synchronisation serveur') },
  { page: 'signatures', title: t('Mes signatures'), hint: t('Créer et modifier vos signatures'), keywords: t('signature bas de mail pied de page nom fonction téléphone coordonnées') },
  { page: 'signatures', title: t('Nouvelle signature'), anchor: '', query: 'new=1', hint: t('Ajouter une signature'), keywords: t('créer ajouter signature') },
  { page: 'signatures', title: t('Signature par défaut'), hint: t('Par compte : nouveaux mails, réponses'), keywords: t('signature défaut automatique compte réponse transfert') },
  { page: 'businesses', title: t('Business'), anchor: '', hint: t('Regrouper les mails par activité'), keywords: t('entreprise société activité client projet marque domaine provenance catégorie') },
  { page: 'businesses', title: t('Nouveau business'), anchor: '', hint: t('Créer une activité et ses critères'), keywords: t('créer ajouter entreprise domaine adresse expéditeur critère emoji couleur') },
  { page: 'tags', title: t('Mes catégories'), hint: t('Catégories personnalisées décrites en langage naturel'), keywords: t('tag étiquette label catégorie personnalisé créer consigne') },
  { page: 'tags', title: t('Catégories génériques'), hint: t('Facture, livraison, sécurité…'), keywords: t('tag étiquette label facture livraison sécurité voyage finance par défaut') },
  { page: 'tags', title: t('Reclasser tous les mails'), anchor: '', hint: t('Relancer le tri IA'), keywords: t('retrier reclasser retriage tri') },
  { page: 'rules', title: t('Règles'), anchor: '', hint: t('Automatiser archivage, catégories, notifications'), keywords: t('automatisation filtre action condition archiver supprimer déplacer marquer lu expéditeur') },
  { page: 'rules', title: t('Nouvelle règle'), anchor: '', hint: t('Si… alors…'), keywords: t('créer filtre automatisation condition action') },
  { page: 'rules', title: t('Suggestions de l’agent'), hint: t('Règles proposées d’après vos habitudes'), keywords: t('habitude apprentissage proposition suggestion agent') },
  { page: 'notifications', title: t('Notifications macOS'), hint: t('Interrupteur général'), keywords: t('alerte push centre de notifications désactiver activer son') },
  { page: 'notifications', title: t('Pastille de l’icône ZMail'), anchor: 'pastille-du-dock', hint: t('Nombre de non-lus sur l’icône du Dock'), keywords: t('pastille badge dock compteur non lus nombre icône rouge') },
  { page: 'notifications', title: t('Codes OTP'), hint: t('Code à usage unique avec bouton Copier'), keywords: t('otp 2fa code vérification authentification double facteur copier') },
  { page: 'notifications', title: t('Mails urgents'), hint: t('Litiges, chargebacks, paiements échoués'), keywords: t('urgent chargeback litige paiement échoué client mécontent') },
  { page: 'notifications', title: t('Opportunités business'), hint: t('Devis, partenariats, leads'), keywords: t('opportunité devis lead partenariat demande offre prospect') },
  { page: 'notifications', title: t('Priorité haute'), hint: t('Réponses attendues, échéances'), keywords: t('prioritaire important échéance') },
  { page: 'notifications', title: t('Échecs de désinscription'), hint: t('Quand l’agent échoue à vous désinscrire'), keywords: t('désabonnement newsletter unsubscribe échec') },
  { page: 'notifications', title: t('Par business'), hint: t('Couper les notifications d’une activité'), keywords: t('silencieux muet couper entreprise') },
  { page: 'notifications', title: t('Historique'), hint: t('Notifications envoyées'), keywords: t('historique passé envoyées') },
  { page: 'ai', title: t('Apple Intelligence'), anchor: 'apple-intelligence', hint: t('Modèle on-device gratuit'), keywords: t('apple ia locale on-device gratuit siri langue privé') },
  { page: 'ai', title: t('Services connectés'), hint: t('Clé API ZenMux, OpenRouter, OpenAI, Ollama'), keywords: t('clé api key token zenmux openrouter openai ollama connecter fournisseur llm') },
  { page: 'ai', title: t('Orchestration des modèles'), hint: t('Modèle choisi pour chaque tâche'), keywords: t('modèle llm gpt claude gemini deepseek choisir personnaliser tri chat benchmark qualité') },
  { page: 'ai', title: t('Prévisionnel'), hint: t('Coût estimé selon votre volume de mails'), keywords: t('coût prix budget estimation tarif simulation volume mois') },
  { page: 'ai', title: t('Consommation réelle (30 derniers jours)'), hint: t('Appels, jetons et coût mesurés'), keywords: t('consommation usage tokens jetons facture dépense coût réel') },
  { page: 'ai', title: t('Reclasser tous les mails'), anchor: '', hint: t('Relancer le tri avec l’IA actuelle'), keywords: t('retrier reclasser retriage tri') },
  { page: 'activity', title: t('Journal d’activité'), anchor: '', hint: t('Toutes vos actions, enregistrées localement'), keywords: t('historique log actions journal habitudes') },
  { page: 'security', title: t('Déverrouiller avec Touch ID'), hint: t('Touch ID au lieu d’un mot de passe à l’ouverture'), keywords: t('sécurité verrou verrouiller touch id empreinte doigt passkey mot de passe trousseau déverrouiller') },
  { page: 'appearance', title: t('Bibliothèque d’icônes'), anchor: 'icones', hint: t('Akar, Lucide, Phosphor, Iconoir…'), keywords: t('icônes icones pictogrammes bibliothèque style akar lucide phosphor iconoir feather solar duotone contour') },
  { page: 'appearance', title: t('Langue'), anchor: 'langue', hint: t('Français ou anglais'), keywords: 'langue language english anglais français french traduction translate' },
  { page: 'appearance', title: t('Mode'), hint: t('Clair, sombre ou système'), keywords: t('mode sombre dark light clair apparence nuit') },
  { page: 'appearance', title: t('Thème de couleurs'), anchor: 'theme', hint: t('43 thèmes shadcn / tweakcn'), keywords: t('thème couleur palette tweakcn shadcn design style police') },
  { page: 'appearance', title: t('Importer un thème tweakcn'), anchor: 'importer-un-theme', hint: t('Coller le CSS exporté'), keywords: t('importer thème tweakcn css personnalisé') },
  { page: 'mcp', title: t('Connecteurs IA (MCP)'), anchor: '', hint: t('Claude, ChatGPT, Cursor, VS Code…'), keywords: t('mcp claude chatgpt codex cursor vscode windsurf connecteur agent ide model context protocol') },
  { page: 'api', title: t('Clés API'), anchor: '', hint: t('Créer, révoquer des clés pour vos scripts'), keywords: t('api rest clé token bearer développeur curl openapi script automatisation webhook intégration') },
  { page: 'api', title: t('Adresse de l’API'), anchor: '', hint: t('URL locale et documentation OpenAPI'), keywords: t('url port localhost openapi swagger documentation endpoint') },
  { page: 'appearance', title: t('Raccourcis clavier'), hint: t('Liste des raccourcis'), keywords: t('raccourci clavier touche shortcut hotkey') },
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export type SettingsResult = Entry & { href: string; pageLabel: string; icon: IconComponent };

export function searchSettings(query: string): SettingsResult[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ENTRIES.map((entry) => {
    const page = SETTINGS_PAGES.find((p) => p.id === entry.page)!;
    const title = fold(entry.title);
    const haystack = `${title} ${fold(entry.hint)} ${fold(entry.keywords)} ${fold(page.label)}`;
    if (!words.every((w) => haystack.includes(w))) return null;
    const score = words.reduce((s, w) => s + (title.startsWith(w) ? 4 : title.includes(w) ? 2 : 1), 0);
    const anchor = entry.anchor ?? settingsAnchor(entry.title);
    return { ...entry, score, pageLabel: page.label, icon: page.icon, href: `/settings/${entry.page}${entry.query ? `?${entry.query}` : ''}${anchor ? `#${anchor}` : ''}` };
  })
    .filter((r): r is SettingsResult & { score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
