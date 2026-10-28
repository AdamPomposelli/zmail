import { t } from '../lib/i18n';
/** Generic tags seeded on first launch. Ids are stable: rules and heuristics refer to them. */
export const SYSTEM_TAGS = [
  { id: 'important', name: 'Important', color: '#F43F5E', icon: 'flame', description: 'Mail qui demande une attention réelle : décision, échéance, personne importante.' },
  { id: 'to-respond', name: 'À répondre', color: '#3B82F6', icon: 'reply', description: "Une vraie personne attend une réponse de l'utilisateur. Jamais pour du marketing ou des notifications automatiques." },
  { id: 'opportunity', name: 'Opportunité', color: '#10B981', icon: 'sparkles', description: 'Demande commerciale, devis, proposition de partenariat, offre de collaboration, lead entrant, sponsoring.' },
  { id: 'finance', name: 'Facture & paiement', color: '#F59E0B', icon: 'receipt', description: 'Factures, reçus, paiements, abonnements, relevés, virements.' },
  { id: 'chargeback', name: 'Chargeback & litige', color: '#DC2626', icon: 'shield-alert', description: 'Rétrofacturation, litige de paiement, contestation, dispute Stripe/PayPal/Shopify.' },
  { id: 'security', name: 'Sécurité & OTP', color: '#8B5CF6', icon: 'key', description: 'Codes de vérification, connexions, réinitialisation de mot de passe, alertes de sécurité.' },
  { id: 'newsletter', name: 'Newsletter', color: '#06B6D4', icon: 'newspaper', description: 'Lettres d’information, digests, contenus éditoriaux envoyés en masse.' },
  { id: 'marketing', name: 'Marketing', color: '#EC4899', icon: 'megaphone', description: 'Promotions, soldes, offres commerciales envoyées en masse, prospection automatisée.' },
  { id: 'notification', name: 'Notification', color: '#64748B', icon: 'bell', description: "Notifications automatiques d'un service (alertes, rapports, mises à jour de statut)." },
  { id: 'meeting', name: 'Réunion', color: '#6366F1', icon: 'calendar', description: 'Invitations, rendez-vous, calendrier, visioconférences.' },
  { id: 'personal', name: 'Personnel', color: '#84CC16', icon: 'user', description: 'Échanges personnels (famille, amis), hors travail.' },
  { id: 'delivery', name: 'Livraison', color: '#F97316', icon: 'package', description: 'Commandes, expéditions, suivi de colis, livraisons.' },
] as const;

export type SystemTagId = (typeof SYSTEM_TAGS)[number]['id'];

export const PRIORITY_NAMES = ['basse', 'normale', 'haute', 'urgente'] as const;

/** A priority's name in the user's language. */
export const priorityName = (priority: number) => [t('basse'), t('normale'), t('haute'), t('urgente')][priority];

/** A tag's name as shown to the user: built-in tags are stored in French and translated on display. */
export const tagLabel = (tag: { name: string; kind?: string }) => (tag.kind === 'system' ? t(tag.name) : tag.name);
