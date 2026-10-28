// English names of the engine's built-in tags and priorities (apps/server/src/ai/taxonomy.ts).
// They are stored in French in the database and translated on display with t(tag.name).
export default {
  // Built-in tags
  'Important': 'Important',
  'À répondre': 'To reply',
  'Opportunité': 'Opportunity',
  'Facture & paiement': 'Invoices & payments',
  'Chargeback & litige': 'Chargebacks & disputes',
  'Sécurité & OTP': 'Security & OTP',
  'Newsletter': 'Newsletter',
  'Marketing': 'Marketing',
  'Notification': 'Notification',
  'Réunion': 'Meeting',
  'Personnel': 'Personal',
  'Livraison': 'Delivery',

  // Their descriptions (shown in Settings → Tags)
  'Mail qui demande une attention réelle : décision, échéance, personne importante.': 'Email that needs real attention: a decision, a deadline, an important person.',
  "Une vraie personne attend une réponse de l'utilisateur. Jamais pour du marketing ou des notifications automatiques.": 'A real person is waiting for a reply. Never for marketing or automated notifications.',
  'Demande commerciale, devis, proposition de partenariat, offre de collaboration, lead entrant, sponsoring.': 'Sales inquiry, quote, partnership proposal, collaboration offer, inbound lead, sponsorship.',
  'Factures, reçus, paiements, abonnements, relevés, virements.': 'Invoices, receipts, payments, subscriptions, statements, transfers.',
  'Rétrofacturation, litige de paiement, contestation, dispute Stripe/PayPal/Shopify.': 'Chargebacks, payment disputes, claims, Stripe/PayPal/Shopify disputes.',
  'Codes de vérification, connexions, réinitialisation de mot de passe, alertes de sécurité.': 'Verification codes, sign-ins, password resets, security alerts.',
  'Lettres d’information, digests, contenus éditoriaux envoyés en masse.': 'Newsletters, digests, editorial content sent in bulk.',
  'Promotions, soldes, offres commerciales envoyées en masse, prospection automatisée.': 'Promotions, sales, bulk commercial offers, automated outreach.',
  "Notifications automatiques d'un service (alertes, rapports, mises à jour de statut).": 'Automated notifications from a service (alerts, reports, status updates).',
  'Invitations, rendez-vous, calendrier, visioconférences.': 'Invitations, appointments, calendar, video calls.',
  'Échanges personnels (famille, amis), hors travail.': 'Personal conversations (family, friends), outside work.',
  'Commandes, expéditions, suivi de colis, livraisons.': 'Orders, shipments, package tracking, deliveries.',

  // Priorities
  'basse': 'low',
  'normale': 'normal',
  'haute': 'high',
  'urgente': 'urgent',
  'Autres notifications': 'Other notifications',
  'Administratif': 'Admin & paperwork',
  'Voyages': 'Travel',
  'Mail qui demande une vraie attention : décision, échéance, personne importante. Jamais pour un mail automatique.': 'Email that needs real attention: a decision, a deadline, a key person. Never for an automated email.',
  'Factures, reçus, paiements, prélèvements, abonnements, relevés, virements. Pas les codes de connexion ni les alertes de sécurité.': 'Invoices, receipts, payments, direct debits, subscriptions, statements, transfers. Not sign-in codes or security alerts.',
  'Codes de vérification, connexion inhabituelle, réinitialisation de mot de passe : uniquement la sécurité d’un compte. Un reçu, une facture ou un suivi de colis n’en fait pas partie.': 'Verification codes, unusual sign-ins, password resets: an account’s security only. A receipt, an invoice or a parcel update is not part of it.',
  'Message automatique d\'un service (rapport, mise à jour de statut, activité d\'un compte) qui n\'entre dans aucune autre catégorie. Jamais en plus d\'une autre catégorie.': 'Automated message from a service (report, status update, account activity) that fits no other category. Never on top of another category.',
  'Échanges personnels avec la famille et les amis, hors travail.': 'Personal conversations with family and friends, outside work.',
  'Commandes, expéditions, suivi de colis, livraisons. Pas une facture seule.': 'Orders, shipments, parcel tracking, deliveries. Not an invoice on its own.',
  'Démarches de la vie courante : impôts, CAF, sécurité sociale, contrats d’assurance ou de mutuelle, logement, énergie, attestations. Jamais un paiement, une facture, un virement ni une alerte bancaire (c’est Facture & paiement).': 'Everyday paperwork: taxes, benefits, social security, insurance or health cover contracts, housing, energy, certificates. Never a payment, an invoice, a transfer or a bank alert (that is Invoices & payments).',
  'Billets de train ou d’avion, réservations d’hôtel, location de voiture, cartes d’embarquement.': 'Train or plane tickets, hotel bookings, car rentals, boarding passes.',
} satisfies Record<string, string>;
