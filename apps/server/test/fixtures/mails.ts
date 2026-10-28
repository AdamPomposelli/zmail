/**
 * Realistic demo mailboxes used by the end-to-end tests and `pnpm testmail:seed`.
 * Every brand and person here is fictional.
 */
export type FixtureAccount = { email: string; name: string; business: 'studio' | 'shop' | 'perso' };

export const ACCOUNTS: FixtureAccount[] = [
  { email: 'adam@nordlys.studio', name: 'Adam — Nordlys Studio', business: 'studio' },
  { email: 'contact@nordlys.studio', name: 'Nordlys Studio', business: 'studio' },
  { email: 'support@maisonvelours.shop', name: 'Maison Velours', business: 'shop' },
  { email: 'adam.perso@gmail.test', name: 'Adam', business: 'perso' },
  { email: 'adam@mailbox.test', name: 'Adam (mailbox.org)', business: 'perso' },
];

export const BUSINESSES = [
  { key: 'studio', name: 'Nordlys Studio', emoji: '🛰️', color: '#6366F1', description: 'Agence de développement web et mobile : devis, clients, partenariats.', domains: ['nordlys.studio'] },
  { key: 'shop', name: 'Maison Velours', emoji: '🛍️', color: '#EC4899', description: 'Boutique e-commerce de linge de maison : commandes, paiements, litiges.', domains: ['maisonvelours.shop'] },
  { key: 'perso', name: 'Perso', emoji: '🏡', color: '#10B981', description: 'Vie personnelle, banque, achats.', domains: ['gmail.test', 'mailbox.test'] },
] as const;

export type FixtureMail = {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  html?: string;
  hoursAgo: number;
  headers?: Record<string, string>;
  seen?: boolean;
  /** Logical thread key: mails with the same key reply to each other. */
  thread?: string;
  /** Within its thread, the index of the mail this one answers (default: the previous one). */
  answers?: number;
  folder?: 'INBOX' | 'Sent' | 'Archive';
};

export const UNSUB_BASE = 'http://127.0.0.1:47900';

export const newsletter = (list: string, mode: 'one-click' | 'form' | 'captcha' | 'mailto'): Record<string, string> => {
  if (mode === 'mailto') return { 'List-Unsubscribe': `<mailto:unsubscribe@${list}.test?subject=unsubscribe>`, 'List-Id': `<news.${list}.test>` };
  const url = `${UNSUB_BASE}/${mode}/${list}`;
  return mode === 'one-click'
    ? { 'List-Unsubscribe': `<${url}>, <mailto:leave@${list}.test>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'List-Id': `<news.${list}.test>` }
    : { 'List-Unsubscribe': `<${url}>`, 'List-Id': `<news.${list}.test>` };
};

export const html = (body: string, footer = '') =>
  `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:600px">${body}${footer}</div>`;

export const MAILS: FixtureMail[] = [
  // ── OTP ─────────────────────────────────────────────────────────────
  {
    to: 'adam@nordlys.studio',
    from: 'no-reply@paylane.test',
    fromName: 'Paylane',
    subject: 'Votre code de vérification Paylane',
    text: 'Bonjour,\n\nVotre code de vérification est : 482913\n\nIl expire dans 10 minutes. Ne le partagez avec personne.\n\nL’équipe Paylane',
    html: html('<p>Bonjour,</p><p>Votre code de vérification est&nbsp;:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">482913</p><p>Il expire dans 10 minutes. Ne le partagez avec personne.</p><p>L’équipe Paylane</p>'),
    hoursAgo: 0.2,
  },
  {
    to: 'adam.perso@gmail.test',
    from: 'account-security@cloudforge.test',
    fromName: 'CloudForge',
    subject: 'Sign-in code for CloudForge',
    text: 'Use this one-time code to finish signing in: K7Q-29X\n\nWait, sorry — the correct code is shown below.\n\nYour code: 715 264\n\nIf you did not try to sign in, reset your password.',
    hoursAgo: 5,
    seen: true,
  },
  // ── Business opportunities ─────────────────────────────────────────
  {
    to: 'contact@nordlys.studio',
    from: 'claire.martin@atelier-boreal.test',
    fromName: 'Claire Martin',
    subject: 'Demande de devis — application mobile de réservation',
    text: 'Bonjour,\n\nJe suis directrice de l’Atelier Boréal (3 restaurants à Lyon). Nous cherchons une agence pour développer une application mobile de réservation et de fidélité. Budget prévu : 35 000 € à 45 000 €, lancement souhaité en mars.\n\nPourriez-vous nous envoyer un devis et vos disponibilités pour un appel cette semaine ?\n\nBien à vous,\nClaire Martin\nAtelier Boréal',
    hoursAgo: 1.5,
    thread: 'boreal',
  },
  {
    to: 'adam@nordlys.studio',
    from: 'jonas@helio-ventures.test',
    fromName: 'Jonas Weber',
    subject: 'Partnership: white-label dashboards for our portfolio',
    text: 'Hi Adam,\n\nWe run a venture studio with 14 SaaS companies and are interested in working with your team on white-label analytics dashboards. Would you be open to a 30-minute call next week to discuss a partnership?\n\nBest,\nJonas',
    hoursAgo: 20,
  },
  {
    to: 'support@maisonvelours.shop',
    from: 'achats@hotel-les-tilleuls.test',
    fromName: 'Hôtel Les Tilleuls',
    subject: 'Commande en gros : 120 parures de lit pour notre hôtel',
    text: 'Bonjour,\n\nNous rénovons notre hôtel (60 chambres) et souhaiterions commander 120 parures de lit en lin. Pouvez-vous nous faire une proposition tarifaire avec remise sur volume ?\n\nCordialement,\nService achats — Hôtel Les Tilleuls',
    hoursAgo: 3,
  },
  // ── Chargeback / urgent ─────────────────────────────────────────────
  {
    to: 'support@maisonvelours.shop',
    from: 'disputes@paylane.test',
    fromName: 'Paylane Disputes',
    subject: 'Litige ouvert : chargeback de 249,00 € sur la commande #10482',
    text: 'Un client a contesté un paiement de 249,00 € (commande #10482). Motif : produit non reçu.\n\nVous avez jusqu’au 4 novembre pour fournir des preuves (suivi de livraison, échanges client). Sans réponse, le litige sera perdu automatiquement.',
    hoursAgo: 0.6,
  },
  {
    to: 'support@maisonvelours.shop',
    from: 'billing@shopcloud.test',
    fromName: 'ShopCloud',
    subject: 'Échec de paiement de votre abonnement — action requise',
    text: 'Le paiement de votre abonnement ShopCloud Pro (79 €) a échoué : carte refusée. Mettez à jour votre moyen de paiement avant le 31 octobre pour éviter la suspension de votre boutique.',
    hoursAgo: 7,
  },
  // ── To respond / clients ───────────────────────────────────────────
  {
    to: 'adam@nordlys.studio',
    from: 'thomas@fermes-du-lac.test',
    fromName: 'Thomas Rey',
    subject: 'Retours sur la maquette v2',
    text: 'Salut Adam,\n\nOn a regardé la maquette v2 avec l’équipe : on adore la page d’accueil. Deux questions : peut-on passer le panier sur une seule page ? Et est-ce que la mise en ligne reste prévue pour le 15 ?\n\nMerci !\nThomas',
    hoursAgo: 4,
    thread: 'fermes',
  },
  {
    to: 'thomas@fermes-du-lac.test',
    from: 'adam@nordlys.studio',
    fromName: 'Adam',
    subject: 'Re: Retours sur la maquette v2',
    text: 'Hello Thomas,\n\nOui pour le panier en une page, je vous montre ça jeudi. Mise en ligne toujours prévue le 15.\n\nAdam',
    hoursAgo: 3,
    thread: 'fermes',
    folder: 'Sent',
    seen: true,
  },
  {
    to: 'adam@nordlys.studio',
    from: 'thomas@fermes-du-lac.test',
    fromName: 'Thomas Rey',
    subject: 'Re: Retours sur la maquette v2',
    text: 'Parfait, merci ! Jeudi 14 h ça te va ?\n\nThomas',
    hoursAgo: 2.2,
    thread: 'fermes',
  },
  // ── Finance / invoices ─────────────────────────────────────────────
  {
    to: 'adam@nordlys.studio',
    from: 'factures@hebergeur-nimbus.test',
    fromName: 'Nimbus Cloud',
    subject: 'Votre facture Nimbus Cloud n° F-2026-10-4471',
    text: 'Bonjour,\n\nVotre facture d’octobre est disponible : 64,80 € TTC. Le prélèvement aura lieu le 2 novembre.\n\nMerci de votre confiance.',
    hoursAgo: 26,
    seen: true,
  },
  {
    to: 'adam.perso@gmail.test',
    from: 'notifications@banque-azur.test',
    fromName: 'Banque Azur',
    subject: 'Virement reçu : 2 400,00 €',
    text: 'Vous avez reçu un virement de 2 400,00 € de NORDLYS STUDIO. Il est disponible sur votre compte courant.',
    hoursAgo: 30,
    seen: true,
  },
  // ── Delivery / meeting ─────────────────────────────────────────────
  {
    to: 'adam.perso@gmail.test',
    from: 'suivi@colis-express.test',
    fromName: 'Colis Express',
    subject: 'Votre colis a été expédié',
    text: 'Bonne nouvelle : votre commande a été expédiée. Suivi : CX849302FR. Livraison prévue jeudi.',
    hoursAgo: 12,
  },
  {
    to: 'adam@nordlys.studio',
    from: 'agenda@visio-meet.test',
    fromName: 'Lucie Garnier (via Visio)',
    subject: 'Invitation : Point projet Fermes du Lac — jeudi 14:00',
    text: 'Lucie Garnier vous invite à une réunion : Point projet Fermes du Lac\nJeudi 14:00 – 14:30\nRejoindre : https://visio-meet.test/abc-defg-hij',
    hoursAgo: 9,
  },
  // ── Personal ───────────────────────────────────────────────────────
  {
    to: 'adam.perso@gmail.test',
    from: 'julie.pomme@gmail.test',
    fromName: 'Julie',
    subject: 'Dîner samedi ?',
    text: 'Coucou ! On organise un dîner samedi soir à la maison, tu es dispo ? Dis-moi si tu viens avec quelqu’un 😊',
    hoursAgo: 6,
  },
  // ── Newsletters & marketing ────────────────────────────────────────
  {
    to: 'adam@nordlys.studio',
    from: 'digest@devpulse.test',
    fromName: 'DevPulse Weekly',
    subject: 'DevPulse #212 — React 20, Bun 2 et la fin des frameworks CSS',
    text: 'Cette semaine dans DevPulse : React 20 en bêta, Bun 2 arrive, et pourquoi les frameworks CSS reculent. Bonne lecture !',
    html: html('<h2>DevPulse #212</h2><p>React 20 en bêta, Bun 2 arrive, et pourquoi les frameworks CSS reculent.</p>', `<p style="font-size:12px;color:#888">Vous recevez cet e-mail car vous êtes abonné. <a href="${UNSUB_BASE}/one-click/devpulse">Se désinscrire</a></p>`),
    hoursAgo: 8,
    headers: newsletter('devpulse', 'one-click'),
  },
  {
    to: 'adam@nordlys.studio',
    from: 'digest@devpulse.test',
    fromName: 'DevPulse Weekly',
    subject: 'DevPulse #211 — Les nouveautés de TypeScript 6',
    text: 'TypeScript 6 est là. Voici ce qui change pour vos projets.',
    hoursAgo: 176,
    headers: newsletter('devpulse', 'one-click'),
  },
  {
    to: 'adam.perso@gmail.test',
    from: 'offres@deco-maison.test',
    fromName: 'Déco Maison',
    subject: '🔥 -40 % sur tout le site : derniers jours !',
    text: 'Soldes d’automne : -40 % sur tout le site avec le code promo AUTOMNE40. Livraison offerte dès 50 €. Offre limitée.',
    html: html('<h1 style="color:#c2410c">-40 % sur tout le site</h1><p>Code promo <b>AUTOMNE40</b> — livraison offerte dès 50 €.</p>', `<p style="font-size:12px"><a href="${UNSUB_BASE}/form/deco-maison">Se désabonner</a></p>`),
    hoursAgo: 2,
    headers: newsletter('deco-maison', 'form'),
  },
  {
    to: 'adam.perso@gmail.test',
    from: 'offres@deco-maison.test',
    fromName: 'Déco Maison',
    subject: 'Nouvelle collection : plaids et coussins',
    text: 'Découvrez notre nouvelle collection automne. Soldes jusqu’à -30 %, offre exclusive.',
    hoursAgo: 50,
    headers: newsletter('deco-maison', 'form'),
  },
  {
    to: 'adam@mailbox.test',
    from: 'news@voyages-horizon.test',
    fromName: 'Voyages Horizon',
    subject: 'Flash sale : Lisbonne dès 39 €',
    text: 'Flash sale ce week-end seulement : vols pour Lisbonne dès 39 €. Offre exclusive pour nos abonnés.',
    html: html('<h2>Lisbonne dès 39 €</h2><p>Flash sale ce week-end seulement.</p>', `<p><a href="${UNSUB_BASE}/captcha/horizon">Unsubscribe</a></p>`),
    hoursAgo: 14,
    headers: newsletter('horizon', 'captcha'),
  },
  {
    to: 'adam@mailbox.test',
    from: 'lettre@le-media-libre.test',
    fromName: 'Le Média Libre',
    subject: 'La lettre du dimanche : ce qu’il faut retenir de la semaine',
    text: 'Chaque dimanche, notre sélection d’articles. Cette semaine : climat, économie et culture.',
    hoursAgo: 40,
    headers: newsletter('media-libre', 'mailto'),
  },
  {
    to: 'support@maisonvelours.shop',
    from: 'growth@leadmachine.test',
    fromName: 'LeadMachine',
    subject: 'Boostez vos ventes x10 avec notre IA',
    text: 'Bonjour, nous aidons les e-commerçants à multiplier leurs ventes par 10 grâce à notre IA. Promo spéciale : -50 % ce mois-ci. Réservez une démo.',
    hoursAgo: 18,
    headers: newsletter('leadmachine', 'one-click'),
  },
  // ── Notifications ──────────────────────────────────────────────────
  {
    to: 'adam@nordlys.studio',
    from: 'notifications@codehub.test',
    fromName: 'CodeHub',
    subject: '[nordlys/app] Deploy succeeded on production',
    text: 'The deployment of nordlys/app to production succeeded (commit 8f2c1a9).',
    hoursAgo: 11,
    headers: { 'Auto-Submitted': 'auto-generated', 'List-Id': '<app.nordlys.codehub.test>' },
    seen: true,
  },
  {
    to: 'support@maisonvelours.shop',
    from: 'no-reply@shopcloud.test',
    fromName: 'ShopCloud',
    subject: 'Nouvelle commande #10519 — 89,90 €',
    text: 'Vous avez reçu une nouvelle commande #10519 de 89,90 € (2 articles).',
    hoursAgo: 1,
    headers: { 'Auto-Submitted': 'auto-generated' },
  },
  // ── Spam ───────────────────────────────────────────────────────────
  {
    to: 'adam.perso@gmail.test',
    from: 'winner@lucky-prize.test',
    fromName: 'Service Clients',
    subject: 'FÉLICITATIONS !!! VOUS AVEZ GAGNÉ UN IPHONE 17',
    text: 'Félicitations !!! Vous avez gagné un iPhone 17. Réclamez votre prix maintenant en confirmant vos coordonnées bancaires. Offre 100% free, risk-free !',
    hoursAgo: 3.5,
  },
  {
    to: 'contact@nordlys.studio',
    from: 'security@verify-acc0unt.test',
    fromName: 'Support Technique',
    subject: 'Your account will be suspended',
    text: 'Your account will be suspended within 24 hours. Verify your account now by sending your password. Bitcoin giveaway for verified users.',
    hoursAgo: 15,
    headers: { 'X-Spam-Flag': 'YES' },
  },
];
