/**
 * The Zippy suite, as promoted inside ZMail (top of the inbox, welcome page, discovery modal).
 * Every Zippy app ships the same catalogue and points to all the others. Icons are the official
 * brand-kit tiles (Github/Zippy/brand-kit), copied into public/zippy.
 * Links: the public repo when there is one, otherwise the author's GitHub until the repos are public.
 */
import { t } from '@/lib/i18n';

export const ZIPPY_GITHUB = 'https://github.com/AdamPomposelli';

export type ZippyApp = {
  id: string;
  name: string;
  /** "The free, open-source X": what people already know it replaces. */
  like: string;
  pitch: string;
  points: [string, string, string];
  icon: string;
  color: string;
  url: string;
  /** True while the link is the GitHub profile fallback. */
  placeholder?: boolean;
};

export const ZIPPY_APPS: ZippyApp[] = [
  {
    id: 'zpanel',
    name: 'ZPanel',
    like: 'Vercel',
    pitch: t('Déployez vos apps, bases de données et services sur vos propres serveurs, en un git push.'),
    points: [t('300+ services en un clic'), t('Previews de chaque PR, HTTPS automatique'), t('Sauvegardes, API, CLI et MCP')],
    icon: '/zippy/zpanel.svg',
    color: '#FC3033',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
  {
    id: 'znotes',
    name: 'ZNotes',
    like: 'Notion',
    pitch: t('Vos notes en blocs et vos bases de données, sur votre machine d’abord.'),
    points: [t('Tableau, galerie, kanban, calendrier'), t('Mac, Web et Android'), t('Serveur MCP intégré')],
    icon: '/zippy/znotes.png',
    color: '#111111',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
  {
    id: 'zpay',
    name: 'ZPay',
    like: 'Stripe',
    pitch: t('Encaissez en crypto comme avec Stripe : les fonds arrivent directement sur votre portefeuille.'),
    points: [t('21 blockchains, 32 stablecoins'), t('API compatible Stripe, checkout hébergé'), t('Abonnements et webhooks signés')],
    icon: '/zippy/zpay.svg',
    color: '#8544FA',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
  {
    id: 'zflow',
    name: 'ZFlow',
    like: 'Wispr Flow',
    pitch: t('Maintenez une touche, parlez : c’est tapé. La dictée pour Mac, privée et illimitée.'),
    points: [t('100 % gratuit, sans compte ni limite'), t('Tout reste sur votre Mac'), t('Apprend vos mots à vous')],
    icon: '/zippy/zflow.svg',
    color: '#6D28D9',
    url: 'https://github.com/AdamPomposelli/ZFlow',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    like: 'Claude Code',
    pitch: t('Un agent de code sur votre machine, avec une seule clé pour tous les modèles.'),
    points: [t('Web, bureau et serveur'), t('Tous les modèles via ZRouter'), t('Aucune clé de fournisseur stockée')],
    icon: '/zippy/zcode.svg',
    color: '#282828',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
  {
    id: 'zrouter',
    name: 'ZRouter',
    like: 'OpenRouter',
    pitch: t('Une clé, tous les modèles d’IA, routés automatiquement vers le meilleur pour chaque tâche.'),
    points: [t('API compatible OpenAI'), t('Suivi de consommation et solde prépayé'), t('Ne journalise jamais vos prompts')],
    icon: '/zippy/zrouter.svg',
    color: '#6D28D9',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
  {
    id: 'zosint',
    name: 'ZOSINT',
    like: 'Maltego',
    pitch: t('Un agent IA qui cartographie votre empreinte numérique à partir de sources publiques.'),
    points: [t('3 400+ sources publiques'), t('Rapport et graphe de preuves'), t('Tourne en local, avec vos clés')],
    icon: '/zippy/zosint.svg',
    color: '#6D28D9',
    url: ZIPPY_GITHUB,
    placeholder: true,
  },
];

export const ZIPPY_ORANGE = '#FD730C';
