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
} satisfies Record<string, string>;
