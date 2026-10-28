/**
 * Labelled mails used to benchmark models per capability. Each case states what a correct
 * triage must contain; tags are graded on `mustTag` (recall) and `mustNotTag` (precision).
 * Everything here is fictional.
 */
export type TriageCase = {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  bulk?: boolean;
  business?: string;
  /** Recipient address (defaults to adam@nordlys.studio). */
  to?: string;
  expect: {
    priority: 0 | 1 | 2 | 3;
    spam: boolean;
    opportunity: boolean;
    otp: string | null;
    mustTag?: string[];
    mustNotTag?: string[];
  };
};

export type ChatCase = { id: string; message: string; tool: string; check?: (args: Record<string, unknown>) => boolean };

const STUDIO = 'Nordlys Studio — agence de développement web et mobile';
const SHOP = 'Maison Velours — boutique e-commerce de linge de maison';

export const TRIAGE_CASES: TriageCase[] = [
  // ── OTP ──
  { id: 'otp-fr', from: 'no-reply@paylane.test', fromName: 'Paylane', subject: 'Votre code de vérification', text: 'Bonjour,\nVotre code de vérification est : 482913\nIl expire dans 10 minutes.', expect: { priority: 2, spam: false, opportunity: false, otp: '482913', mustTag: ['security'] } },
  { id: 'otp-en-spaced', from: 'security@cloudforge.test', fromName: 'CloudForge', subject: 'Sign-in code', text: 'Use this one-time code to finish signing in: 715 264\nIf you did not try to sign in, reset your password.', expect: { priority: 2, spam: false, opportunity: false, otp: '715264', mustTag: ['security'] } },
  { id: 'otp-alnum', from: 'login@vaultly.test', fromName: 'Vaultly', subject: 'Code de connexion', text: 'Votre code de connexion : A7K29Q. Valable 5 minutes. Ne le communiquez à personne.', expect: { priority: 2, spam: false, opportunity: false, otp: 'A7K29Q', mustTag: ['security'] } },
  { id: 'otp-with-order', from: 'auth@shopcloud.test', fromName: 'ShopCloud', subject: 'Confirmez votre connexion', text: 'Commande n° 104820 du 12/10/2026.\nPour confirmer la connexion à votre espace marchand, saisissez le code 093125.', expect: { priority: 2, spam: false, opportunity: false, otp: '093125', mustTag: ['security'] } },
  { id: 'otp-de-4', from: 'noreply@bankhaus.test', fromName: 'Bankhaus', subject: 'Ihr Bestätigungscode', text: 'Ihr Bestätigungscode lautet 8841. Er ist 3 Minuten gültig.', expect: { priority: 2, spam: false, opportunity: false, otp: '8841', mustTag: ['security'] } },
  // ── Faux OTP ──
  { id: 'promo-code', from: 'offres@deco-maison.test', fromName: 'Déco Maison', subject: '-40 % avec le code AUTOMNE40', bulk: true, text: 'Soldes d’automne : utilisez le code promo AUTOMNE40 pour -40 % sur tout le site. Offre limitée.', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustTag: ['marketing'], mustNotTag: ['security', 'important'] } },
  { id: 'tracking-number', from: 'suivi@colis-express.test', fromName: 'Colis Express', subject: 'Votre colis est en route', text: 'Votre colis a été expédié. Numéro de suivi : 849302 7731. Livraison prévue jeudi.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['delivery'], mustNotTag: ['security'] } },
  { id: 'invoice-number', from: 'factures@nimbus.test', fromName: 'Nimbus Cloud', subject: 'Facture F-2026-4471', text: 'Votre facture n° 447102 d’un montant de 64,80 € est disponible. Prélèvement le 2 novembre.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['finance'], mustNotTag: ['security'] } },
  // ── Faux OTP vus en production (anonymisés) ──
  { id: 'id-in-link', from: 'noreply@email.meta.com', fromName: 'Meta', subject: 'We updated you to a Meta Account on Meta apps', text: 'Your Meta Account is here\n[https://scontent.xx.fbcdn.net/v/t39.30808-6/img.png?_nc_cat=1&oh=00_AQOIGU_JSqHq&oe=6AE58424]\nYour updated account works across Meta apps and devices, making it easier to log in, control settings and keep your info secure.\nMeta Account: adam.pzz', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustNotTag: ['important'] } },
  { id: 'postal-code-receipt', from: 'support@namecheap.com', fromName: 'Namecheap support', subject: 'Your receipt from Namecheap.com.', text: 'RECEIPT #26358259\nDate: 23 Oct, 2026 Billed to: Adam Pomposelli, 112 Rue Rambuteau, PARIS, 75001\nPayment source: card. Total: 12,98 USD. Security tip: never share your password.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['finance'], mustNotTag: ['security'] } },
  { id: 'postal-code-footer', from: 'kevin@updates.voicecheap.test', fromName: 'Kevin de VoiceCheap', subject: 'VoiceCheap arrive dans ton assistant IA', bulk: true, text: 'Utilise le code BIENVENUE pour un mois offert. Connecte ton compte en un clic.\n---\nVoiceCheap · 60 rue François 1er, 75008 Paris, France\nSe désinscrire', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustNotTag: ['security', 'important'] } },
  { id: 'secure-link-address', from: 'no-reply@mail.anthropic.com', fromName: 'Anthropic', subject: 'Your secure link to Claude is here', text: 'Click the secure link below to sign in to Claude. This link expires in 1 hour.\n[https://claude.ai/magic-link#abc]\nAnthropic, PBC\n548 Market St, PMB 90375, San Francisco, CA 94104', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['security'] } },
  // ── Phishing vu en production (anonymisé) ──
  { id: 'phishing-dpd', from: 'sbgfj2hh@sbgfj2hh.fr', fromName: 'DPD', subject: 'Votre colis est prêt pour la livraison', text: 'Service de livraison DPD France\nVous avez 1 colis en attente de livraison\nCher client,\nPlanifiez votre livraison et abonnez-vous à notre calendrier pour recevoir des notifications.\nCode de suivi 29194773\nRecevez votre colis', expect: { priority: 0, spam: true, opportunity: false, otp: null, mustNotTag: ['security', 'important', 'delivery'] } },
  { id: 'phishing-greeting', from: 'eeaejtol@0srkrupm0srkrupm.fr', fromName: 'suivre votre colis', to: 'jdupont2003@gmail.com', subject: 'jdupont2003, Vous avez (1) colis en attente de livraison', text: 'jdupont2003, votre colis n° 29194773 est en attente. Confirmez votre adresse et réglez les frais de livraison de 1,99 € sous 24 h.', expect: { priority: 0, spam: true, opportunity: false, otp: null, mustNotTag: ['security', 'important'] } },
  { id: 'phishing-obfuscated-brand', from: 'pnkfongi@axofonsfk.fr', fromName: 'A•M•A•Z•O•N', to: 'jdupont2003@gmail.com', subject: 'jdupont2003,Votre iPhone 18 Pro est prêt', text: 'Félicitations ! Votre code unique pour découvrir l’offre qui vous est réservée.\nVotre code AMZ84958\nIl vous suffit de confirmer votre code ci-dessous.', expect: { priority: 0, spam: true, opportunity: false, otp: null, mustNotTag: ['security', 'important'] } },
  // ── Urgent ──
  { id: 'chargeback-fr', from: 'disputes@paylane.test', fromName: 'Paylane Disputes', subject: 'Litige ouvert : chargeback de 249,00 €', business: SHOP, text: 'Un client a contesté un paiement de 249,00 € (commande #10482). Motif : produit non reçu. Fournissez des preuves avant le 4 novembre.', expect: { priority: 3, spam: false, opportunity: false, otp: null, mustTag: ['chargeback'] } },
  { id: 'chargeback-en', from: 'disputes@stripe-like.test', fromName: 'Payments', subject: 'A dispute was opened on a $89 payment', business: SHOP, text: 'A customer disputed a charge of $89.00. Reason: fraudulent. Respond by Nov 2 or you will lose the dispute.', expect: { priority: 3, spam: false, opportunity: false, otp: null, mustTag: ['chargeback'] } },
  { id: 'payment-failed', from: 'billing@shopcloud.test', fromName: 'ShopCloud', subject: 'Échec de paiement — action requise', business: SHOP, text: 'Le paiement de votre abonnement (79 €) a échoué : carte refusée. Mettez à jour votre moyen de paiement avant le 31 octobre pour éviter la suspension de la boutique.', expect: { priority: 3, spam: false, opportunity: false, otp: null, mustTag: ['finance'] } },
  { id: 'angry-client', from: 'marc.dubois@gmail.test', fromName: 'Marc Dubois', subject: 'Site en panne depuis ce matin !!', business: STUDIO, text: 'Bonjour, notre site est inaccessible depuis 8 h, nous perdons des ventes. Pouvez-vous intervenir en urgence ?', expect: { priority: 3, spam: false, opportunity: false, otp: null, mustTag: ['to-respond'] } },
  { id: 'security-alert', from: 'security@codehub.test', fromName: 'CodeHub', subject: 'New sign-in from an unrecognized device', text: 'We noticed a new sign-in to your account from Chrome on Windows in Lagos, Nigeria. If this was not you, secure your account now.', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['security'] } },
  // ── Opportunités ──
  { id: 'lead-devis', from: 'claire.martin@atelier-boreal.test', fromName: 'Claire Martin', subject: 'Demande de devis — application mobile', business: STUDIO, text: 'Bonjour, nous cherchons une agence pour développer une application de réservation pour nos 3 restaurants. Budget 35 à 45 k€. Pouvez-vous nous envoyer un devis ?', expect: { priority: 2, spam: false, opportunity: true, otp: null, mustTag: ['opportunity'] } },
  { id: 'lead-partner-en', from: 'jonas@helio-ventures.test', fromName: 'Jonas Weber', subject: 'Partnership on white-label dashboards', business: STUDIO, text: 'Hi Adam, we run a venture studio with 14 SaaS companies and would like to work with your team on white-label analytics dashboards. Open to a call next week?', expect: { priority: 2, spam: false, opportunity: true, otp: null, mustTag: ['opportunity'] } },
  { id: 'lead-wholesale', from: 'achats@hotel-tilleuls.test', fromName: 'Hôtel Les Tilleuls', subject: 'Commande en gros : 120 parures de lit', business: SHOP, text: 'Nous rénovons notre hôtel de 60 chambres et souhaitons commander 120 parures en lin. Pouvez-vous nous faire une offre avec remise sur volume ?', expect: { priority: 2, spam: false, opportunity: true, otp: null, mustTag: ['opportunity'] } },
  { id: 'cold-outreach', from: 'growth@leadmachine.test', fromName: 'LeadMachine', subject: 'Boostez vos ventes x10 avec notre IA', bulk: true, business: SHOP, text: 'Bonjour, nous aidons les e-commerçants à multiplier leurs ventes par 10 grâce à notre IA. -50 % ce mois-ci. Réservez une démo.', expect: { priority: 0, spam: true, opportunity: false, otp: null, mustNotTag: ['opportunity', 'important'] } },
  { id: 'seo-spam', from: 'seo.expert.rank@freemail.test', fromName: 'SEO Expert', subject: 'Your website is not ranking on Google', text: 'Dear Website Owner, I checked your site and it has 37 SEO errors. I can put you on page 1 of Google guaranteed for $99. Reply now!', expect: { priority: 0, spam: true, opportunity: false, otp: null, mustNotTag: ['opportunity'] } },
  // ── Spam / phishing ──
  { id: 'lottery', from: 'winner@lucky-prize.test', fromName: 'Service Clients', subject: 'FÉLICITATIONS !!! VOUS AVEZ GAGNÉ UN IPHONE', text: 'Vous avez gagné un iPhone 17. Réclamez votre prix en confirmant vos coordonnées bancaires.', expect: { priority: 0, spam: true, opportunity: false, otp: null } },
  { id: 'phishing-bank', from: 'service@banque-azur-secure.test', fromName: 'Banque Azur', subject: 'Votre compte sera suspendu', text: 'Suite à une activité inhabituelle, votre compte sera suspendu sous 24 h. Vérifiez votre identité en saisissant vos identifiants sur ce lien : http://banque-azur-verif.test/login', expect: { priority: 0, spam: true, opportunity: false, otp: null } },
  { id: 'crypto', from: 'elon.giveaway@crypto-x.test', fromName: 'Crypto Giveaway', subject: 'Double your Bitcoin today', text: 'Send 0.1 BTC and receive 0.2 BTC back instantly. Limited bitcoin giveaway for verified users.', expect: { priority: 0, spam: true, opportunity: false, otp: null } },
  // ── Newsletters / notifications ──
  { id: 'newsletter-tech', from: 'digest@devpulse.test', fromName: 'DevPulse Weekly', subject: 'DevPulse #212 — React 20 et Bun 2', bulk: true, text: 'Cette semaine : React 20 en bêta, Bun 2 arrive, et pourquoi les frameworks CSS reculent. Bonne lecture !', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustTag: ['newsletter'], mustNotTag: ['finance', 'security'] } },
  { id: 'newsletter-media', from: 'lettre@media-libre.test', fromName: 'Le Média Libre', subject: 'La lettre du dimanche', bulk: true, text: 'Chaque dimanche, notre sélection d’articles : climat, économie et culture.', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustTag: ['newsletter'] } },
  { id: 'deploy-notif', from: 'notifications@codehub.test', fromName: 'CodeHub', subject: '[nordlys/app] Deploy succeeded', bulk: true, text: 'The deployment of nordlys/app to production succeeded (commit 8f2c1a9).', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustTag: ['notification'] } },
  { id: 'new-order', from: 'no-reply@shopcloud.test', fromName: 'ShopCloud', subject: 'Nouvelle commande #10519 — 89,90 €', business: SHOP, text: 'Vous avez reçu une nouvelle commande #10519 de 89,90 € (2 articles).', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustNotTag: ['opportunity', 'spam'] } },
  { id: 'payout', from: 'payouts@paylane.test', fromName: 'Paylane', subject: 'Virement de 1 240,50 € en cours', business: SHOP, text: 'Un virement de 1 240,50 € vers votre compte se terminant par 4417 est en cours. Arrivée prévue sous 2 jours ouvrés.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['finance'], mustNotTag: ['security'] } },
  // ── Personnel / réunions / à répondre ──
  { id: 'friend-dinner', from: 'julie.pomme@gmail.test', fromName: 'Julie', subject: 'Dîner samedi ?', text: 'Coucou ! On organise un dîner samedi soir à la maison, tu es dispo ?', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['personal'] } },
  { id: 'client-question', from: 'thomas@fermes-du-lac.test', fromName: 'Thomas Rey', subject: 'Retours sur la maquette v2', business: STUDIO, text: 'Salut Adam, on adore la page d’accueil. Peut-on passer le panier sur une seule page ? Et la mise en ligne reste prévue le 15 ?', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['to-respond'] } },
  { id: 'meeting-invite', from: 'agenda@visio-meet.test', fromName: 'Lucie Garnier', subject: 'Invitation : point projet jeudi 14:00', text: 'Lucie Garnier vous invite à une réunion : Point projet Fermes du Lac, jeudi 14:00–14:30. Rejoindre : https://visio-meet.test/abc', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['meeting'] } },
  { id: 'password-reset', from: 'no-reply@notion-like.test', fromName: 'Pagebook', subject: 'Réinitialisation de votre mot de passe', text: 'Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le lien ci-dessous (valable 1 heure). Si ce n’est pas vous, ignorez ce message.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['security'] } },
  // ── Cas difficiles ──
  { id: 'unpaid-reminder', from: 'compta@imprimerie-lumen.test', fromName: 'Imprimerie Lumen', subject: 'Dernier rappel : facture F-889 impayée', business: SHOP, text: 'Bonjour, malgré nos relances, la facture F-889 de 1 380 € reste impayée. Sans règlement sous 48 h, nous transmettrons le dossier au recouvrement.', expect: { priority: 3, spam: false, opportunity: false, otp: null, mustTag: ['finance'] } },
  { id: 'rfq-en', from: 'procurement@nordic-hotels.test', fromName: 'Nordic Hotels Procurement', subject: 'RFQ: 500 linen duvet covers', business: SHOP, text: 'Hello, we are sourcing 500 linen duvet covers for our hotel group. Please send your best unit price for this volume and lead times.', expect: { priority: 2, spam: false, opportunity: true, otp: null, mustTag: ['opportunity'] } },
  { id: 'out-of-office', from: 'thomas@fermes-du-lac.test', fromName: 'Thomas Rey', subject: 'Réponse automatique : absent jusqu’au 3 novembre', text: 'Je suis absent jusqu’au 3 novembre avec un accès limité à mes mails. Pour toute urgence, contactez Lucie.', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustNotTag: ['to-respond', 'important'] } },
  { id: 'newsletter-partnership', from: 'news@saas-weekly.test', fromName: 'SaaS Weekly', subject: 'Les 10 meilleurs partenariats SaaS de l’année', bulk: true, text: 'Cette semaine : comment les partenariats entre SaaS accélèrent la croissance, et 10 exemples à suivre. Lire la suite sur notre blog.', expect: { priority: 0, spam: false, opportunity: false, otp: null, mustTag: ['newsletter'], mustNotTag: ['opportunity'] } },
  { id: 'otp-ride', from: 'uber.test@mail.uber-like.test', fromName: 'Rides', subject: 'Welcome back', text: 'Hi! Your Rides account code is 4821. Enter it in the app to continue. Questions? Visit help.rides.test or call 01 84 88 25 62.', expect: { priority: 2, spam: false, opportunity: false, otp: '4821', mustTag: ['security'] } },
  { id: 'refund-request', from: 'sophie.l@outlook.test', fromName: 'Sophie L.', subject: 'Demande de remboursement commande #10433', business: SHOP, text: 'Bonjour, j’ai reçu une housse abîmée. Pouvez-vous me rembourser ou me renvoyer un article ? Merci de votre retour rapide.', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['to-respond'], mustNotTag: ['chargeback'] } },
  { id: 'booking-confirmed', from: 'notifications@calendly-like.test', fromName: 'Agenda', subject: 'Nouveau rendez-vous : Claire Martin — jeudi 10:00', business: STUDIO, text: 'Claire Martin a réservé un créneau « Découverte projet » jeudi à 10:00. Lien visio inclus dans l’invitation.', expect: { priority: 1, spam: false, opportunity: false, otp: null, mustTag: ['meeting'] } },
  { id: 'fake-invoice-phish', from: 'billing@0vh-factures.test', fromName: 'OVH Facturation', subject: 'Facture impayée — votre domaine sera supprimé', text: 'Votre nom de domaine sera supprimé aujourd’hui. Réglez 4,99 € immédiatement en entrant votre carte bancaire ici : http://0vh-paiement.test', expect: { priority: 0, spam: true, opportunity: false, otp: null } },
  { id: 'job-candidate', from: 'lea.dev@protonmail.test', fromName: 'Léa Moreau', subject: 'Candidature spontanée — développeuse React', business: STUDIO, text: 'Bonjour, je suis développeuse React avec 4 ans d’expérience et j’aimerais rejoindre votre agence. Vous trouverez mon CV en pièce jointe. Seriez-vous disponible pour un échange ?', expect: { priority: 2, spam: false, opportunity: false, otp: null, mustTag: ['to-respond'] } },
  { id: 'otp-in-reset', from: 'no-reply@pagebook.test', fromName: 'Pagebook', subject: 'Code de réinitialisation', text: 'Pour réinitialiser votre mot de passe, saisissez le code 552 019. Ce code expire dans 15 minutes. Référence de la demande : 20261027-8841.', expect: { priority: 2, spam: false, opportunity: false, otp: '552019', mustTag: ['security'] } },
];

export const CHAT_CASES: ChatCase[] = [
  { id: 'notify-chargebacks', message: 'Notifie-moi de tous les chargebacks', tool: 'notify_on' },
  { id: 'important', message: 'Quels sont mes mails importants aujourd’hui ?', tool: 'list_important' },
  { id: 'archive-domain', message: 'Archive automatiquement tout ce qui vient de @devpulse.test', tool: 'create_rule', check: (a) => JSON.stringify(a).includes('devpulse') && JSON.stringify(a).includes('archive') },
  { id: 'create-tag', message: 'Crée un tag Fournisseurs pour les factures de nos fournisseurs', tool: 'create_tag' },
  { id: 'search', message: 'Retrouve la facture Nimbus d’octobre', tool: 'search_mail' },
  { id: 'unsubscribe', message: 'Désinscris-moi de news@voyages-horizon.test', tool: 'unsubscribe_from' },
  { id: 'business', message: 'Crée un business « Atelier Céramique » pour les mails reçus sur le domaine atelier-ceramique.fr', tool: 'create_business' },
  { id: 'summary', message: 'Fais-moi un résumé de ma boîte', tool: 'summarize_inbox' },
];
