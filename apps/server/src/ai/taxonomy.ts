import { t } from '../lib/i18n';
/**
 * Built-in categories, seeded on first launch. Ids are stable: rules and heuristics refer to them.
 * Each one has a narrow scope, written for the AI: a mail gets one topic at most (see
 * `TOPIC_ORDER`), plus the « attention » tags (important, to-respond, opportunity).
 */
export const SYSTEM_TAGS = [
  { id: 'important', name: 'Important', color: '#F43F5E', icon: 'flame', description: 'Mail qui demande une vraie attention : décision, échéance, personne importante. Jamais pour un mail automatique.' },
  { id: 'to-respond', name: 'À répondre', color: '#3B82F6', icon: 'reply', description: "Une vraie personne attend une réponse de l'utilisateur. Jamais pour du marketing ou des notifications automatiques." },
  { id: 'opportunity', name: 'Opportunité', color: '#10B981', icon: 'sparkles', description: 'Demande commerciale, devis, proposition de partenariat, offre de collaboration, lead entrant, sponsoring.' },
  { id: 'finance', name: 'Facture & paiement', color: '#F59E0B', icon: 'receipt', description: 'Factures, reçus, paiements, prélèvements, abonnements, relevés, virements. Pas les codes de connexion ni les alertes de sécurité.' },
  { id: 'chargeback', name: 'Chargeback & litige', color: '#DC2626', icon: 'shield-alert', description: 'Rétrofacturation, litige de paiement, contestation, dispute Stripe/PayPal/Shopify.' },
  { id: 'security', name: 'Sécurité & OTP', color: '#8B5CF6', icon: 'key', description: 'Codes de vérification, connexion inhabituelle, réinitialisation de mot de passe : uniquement la sécurité d’un compte. Un reçu, une facture ou un suivi de colis n’en fait pas partie.' },
  { id: 'newsletter', name: 'Newsletter', color: '#06B6D4', icon: 'newspaper', description: 'Lettres d’information, digests, contenus éditoriaux envoyés en masse.' },
  { id: 'marketing', name: 'Marketing', color: '#EC4899', icon: 'megaphone', description: 'Promotions, soldes, offres commerciales envoyées en masse, prospection automatisée.' },
  { id: 'notification', name: 'Autres notifications', color: '#64748B', icon: 'bell', description: "Message automatique d'un service (rapport, mise à jour de statut, activité d'un compte) qui n'entre dans aucune autre catégorie. Jamais en plus d'une autre catégorie." },
  { id: 'meeting', name: 'Réunion', color: '#6366F1', icon: 'calendar', description: 'Invitations, rendez-vous, calendrier, visioconférences.' },
  { id: 'personal', name: 'Personnel', color: '#84CC16', icon: 'user', description: 'Échanges personnels avec la famille et les amis, hors travail.' },
  { id: 'delivery', name: 'Livraison', color: '#F97316', icon: 'package', description: 'Commandes, expéditions, suivi de colis, livraisons. Pas une facture seule.' },
  { id: 'admin', name: 'Administratif', color: '#0EA5E9', icon: 'landmark', description: 'Démarches de la vie courante : impôts, CAF, sécurité sociale, contrats d’assurance ou de mutuelle, logement, énergie, attestations. Jamais un paiement, une facture, un virement ni une alerte bancaire (c’est Facture & paiement).' },
  { id: 'travel', name: 'Voyages', color: '#14B8A6', icon: 'plane', description: 'Billets de train ou d’avion, réservations d’hôtel, location de voiture, cartes d’embarquement.' },
] as const;

/** Earlier built-in scopes, replaced on upgrade unless the user rewrote them. */
export const PREVIOUS_DESCRIPTIONS: Record<string, string[]> = {
  important: ['Mail qui demande une attention réelle : décision, échéance, personne importante.'],
  finance: ['Factures, reçus, paiements, abonnements, relevés, virements.'],
  security: ['Codes de vérification, connexions, réinitialisation de mot de passe, alertes de sécurité.'],
  notification: ["Notifications automatiques d'un service (alertes, rapports, mises à jour de statut)."],
  personal: ['Échanges personnels (famille, amis), hors travail.'],
  delivery: ['Commandes, expéditions, suivi de colis, livraisons.'],
};

/** The name built-in categories had before; renamed on upgrade when the user kept it. */
export const RENAMED_TAGS: Record<string, { from: string; to: string }> = { notification: { from: 'Notification', to: 'Autres notifications' } };

/**
 * One topic per mail: when the AI gives several, the first in this order wins (custom
 * categories come right after chargebacks, they are the most specific). `security` only ranks
 * high when the mail carries a one-time code; otherwise a payment or a parcel wins.
 */
// Measured on the benchmark: a friend's dinner is « Personnel » before « Réunion », an order
// confirmation « Livraison » before « Facture », a supplier's promo « Marketing » before
// « Newsletter », and a service report the model also called a newsletter is a notification.
export const TOPIC_ORDER = ['chargeback', '*custom', 'security', 'personal', 'meeting', 'travel', 'delivery', 'finance', 'admin', 'marketing', 'notification', 'newsletter'] as const;
export const ATTENTION_TAGS = new Set(['important', 'to-respond', 'opportunity']);

/**
 * Categories a new install starts with: the few everyone needs, nothing tied to one trade or
 * one life. The others (parcels, family, chargebacks, leads…) are templates in Settings →
 * Categories, grouped in packs, that the user turns on when they need them.
 */
export type Usage = 'personal' | 'business' | 'both';
const CORE = ['important', 'to-respond', 'finance', 'security', 'newsletter', 'marketing', 'notification'];
const USAGE_EXTRAS: Record<Usage, string[]> = { personal: ['admin'], business: ['meeting'], both: ['admin', 'meeting'] };
export const PACK_EXTRAS = { personal: ['personal', 'admin', 'travel', 'delivery'], business: ['opportunity', 'chargeback', 'meeting'] } as const;
export const packFor = (usage: Usage): Set<string> => new Set([...CORE, ...USAGE_EXTRAS[usage]]);

const BUILTIN_IDS = new Set<string>(SYSTEM_TAGS.map((t) => t.id));

/** Keeps the attention tags and the single best topic (see TOPIC_ORDER). */
export function scopeTags(tags: string[], opts: { securityStrong: boolean }): string[] {
  const rank = (tag: string) => {
    if (tag === 'security' && !opts.securityStrong) return TOPIC_ORDER.indexOf('finance') + 0.5;
    return TOPIC_ORDER.indexOf((BUILTIN_IDS.has(tag) ? tag : '*custom') as (typeof TOPIC_ORDER)[number]);
  };
  const unique = [...new Set(tags)];
  const topic = unique.filter((t) => !ATTENTION_TAGS.has(t)).sort((a, b) => rank(a) - rank(b))[0];
  return [...unique.filter((t) => ATTENTION_TAGS.has(t)), ...(topic ? [topic] : [])];
}

export type SystemTagId = (typeof SYSTEM_TAGS)[number]['id'];

export const PRIORITY_NAMES = ['basse', 'normale', 'haute', 'urgente'] as const;

/** A priority's name in the user's language. */
export const priorityName = (priority: number) => [t('basse'), t('normale'), t('haute'), t('urgente')][priority];

/** A tag's name as shown to the user: built-in tags are stored in French and translated on display. */
export const tagLabel = (tag: { name: string; kind?: string }) => (tag.kind === 'system' ? t(tag.name) : tag.name);
