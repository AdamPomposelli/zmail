# Journal du tri : critères et améliorations

Chaque remarque faite sur le tri des mails (priorité, spam, catégories, codes, désinscription…)
est consignée ici, avec **la logique** qui en découle, pas seulement le prompt final. Le but :
qu'on puisse refaire le même raisonnement avec un autre modèle, un autre prompt ou un autre
moteur, et ne jamais perdre une remarque.

## Comment s'en servir

À chaque remarque sur un mail mal trié :

1. **Retrouver la cause**, pas seulement le symptôme. Ce mail a-t-il été trié par l'IA ou par les
   règles locales ? La colonne `engine` de la table `triage` le dit, et la fiche du mail affiche
   « Moteur local » ou le nom du modèle. Quel signal a manqué, lequel a pris le dessus ?
2. **Écrire le critère** en une phrase qu'une personne pourrait appliquer à la main.
3. **L'appliquer partout où le tri décide** :
   - les règles locales (`ai/heuristics.ts`) ;
   - les planchers qui tiennent quoi que dise le modèle (`ai/merge.ts`) ;
   - le prompt LLM (`ai/prompt-config.ts`) ;
   - les questions Jev et la table de vérité (`ai/jev.ts`) ;
   - le choix du modèle (`ai/presets.ts`, `ai/providers.ts`).
4. **Ajouter un cas anonymisé** au benchmark (`apps/server/bench/dataset.ts`) et un test unitaire.
5. **Ajouter une entrée ci-dessous**.

Le benchmark compte chaque cas pour tous les moteurs : le moteur local (`pnpm bench` affiche son
score), chaque modèle et chaque mode. Un critère sans cas de benchmark n'est pas protégé.

## Critères en vigueur

| Domaine | Critère | Où c'est appliqué |
|---|---|---|
| Spam | Dans le doute, c'est un spam : le moindre signal de spam (règles, modèle, dossier Spam du fournisseur) l'emporte. | `merge.ts` |
| Spam | Un mail rangé par le fournisseur dans son dossier Spam est un spam. | `merge.ts` (`folder === 'junk'`) |
| Spam | Un spam n'a ni code, ni opportunité, ni catégorie (sauf Marketing), et sa priorité est basse. | `merge.ts` |
| Phishing | Une marque connue (transporteur, banque, enseigne, administration) qui écrit depuis un autre domaine que le sien, avec un appât (colis bloqué, cadeau, frais), est du phishing. | `phishing.ts` (`BRANDS`, `LURE`) |
| Phishing | Un mail qui vous appelle par la partie de votre adresse avant le @ (« jdupont2003 !! »), avec un appât ou depuis un domaine au nom aléatoire, est du phishing. | `phishing.ts` |
| Phishing | Un domaine sans voyelles ou répété (« vltinqh.us », « sbgfj2hh.fr ») n'est pas celui d'une entreprise. | `phishing.ts` (`looksRandomDomain`) |
| Phishing | « Votre compte sera suspendu » n'est un signe d'arnaque que si le domaine n'a pas signé le mail (pas de DMARC valide) et pousse à cliquer. | `heuristics.ts` |
| Codes | Un code n'est un code à usage unique que si le mail le présente comme tel (connexion, vérification, « ne le partagez pas »). Ne sont jamais des codes : un code promo, un numéro de suivi, de facture ou de commande, un identifiant dans un lien. | `otp.ts`, `merge.ts` (`validateOtp`), Jev `gives_a_one_time_code` |
| Priorité | Un service qui menace de suspendre, bloquer, fermer ou restreindre un compte, ou qui exige une vérification d'identité pour le garder, passe en priorité haute, ou urgente si le délai est de 48 h ou moins. C'est vrai même si le mail vient d'un robot, sauf si c'est du phishing. | `heuristics.ts` (`accountThreat`), plancher `merge.ts`, prompt LLM, Jev `threatens_account_access` |
| Priorité | Litige ou chargeback, paiement échoué, service en panne, mot de passe ou adresse changés : urgent. | `heuristics.ts`, `merge.ts`, Jev |
| Priorité | Code de connexion, alerte de sécurité, une vraie personne qui attend une réponse, opportunité : priorité haute. | `heuristics.ts`, prompt, Jev |
| Priorité | Newsletters, promotions, notifications automatiques sans enjeu : priorité basse. | `heuristics.ts`, prompt, Jev |
| Catégories | Un mail n'a qu'un seul sujet. Le plus précis gagne (`TOPIC_ORDER`), « Autres notifications » ne sert qu'en dernier recours. | `taxonomy.ts` (`scopeTags`) |
| Catégories | Une catégorie désactivée ne peut pas être le sujet retenu, sinon le mail se retrouve sans catégorie. | `merge.ts` |
| Catégories | Une nouvelle installation démarre sobre, avec 7 catégories. Les catégories propres à un métier ou à une vie (livraisons, litiges, opportunités, voyages, perso) sont des modèles à activer. | `taxonomy.ts` (`packFor`), `catalog.ts` (`seed`) |
| Désinscription | L'en-tête List-Unsubscribe (un clic, RFC 8058) d'abord ; sinon un lien dans le corps du mail, quel qu'il soit. Le lien le plus explicite gagne (« Unsubscribe » plutôt que « Préférences »). | `heuristics.ts` (`extractUnsubscribe`) |
| Désinscription | Un mail qui propose de se désinscrire est un envoi en masse. | `heuristics.ts` |
| Alertes | Les « Dernières alertes » ne montrent jamais un mail qui est (ou est devenu) un spam, ou qui est dans la corbeille. | `notify.ts` (`list`) |
| Modèles | Apple Intelligence ne trie pas : mesurée sous le moteur local (82 contre 92,4). Elle sert au chat. | `presets.ts` |
| Modèles | Quand aucun modèle ne peut trier dans le mode choisi, l'utilisateur est prévenu. Jamais de baisse de qualité silencieuse. | `providers.ts` (`onNoModel`), `context.ts` |
| Affichage | Une catégorie peut être « masquée de la boîte de réception » : ses mails quittent la boîte de réception de leur espace (et son compteur), restent dans la catégorie (et son compteur) et la recherche les trouve. Ce n'est pas un tri : le mail garde sa catégorie, sa priorité et son espace. | `store.ts` (`NOT_HIDDEN_FROM_INBOX`), `tags.hide_from_inbox` |
| Synchronisation | Ce que l'utilisateur range lui-même part toujours sur le serveur. Ce que l'IA range n'y part qu'une fois qu'elle est jugée fiable. | `mail/server-sync.ts` |

## Journal

Les entrées vont de la plus récente à la plus ancienne. Les mails sont anonymisés dans le
benchmark.

### 31/10/2026 : les règles apprises comptaient des gestes, pas des proportions

- **Cas.** Le journal d'activité ne disait pas si un mail avait été ouvert avant d'être supprimé ni
  combien de temps il avait été lu. Il n'enregistrait pas le rangement dans un dossier. Les
  suggestions de règles comptaient des répétitions (« 3 suppressions »), sans les rapporter au
  nombre de mails reçus de la même source.
- **Cause.** Chaque geste était enregistré seul, sans contexte. L'analyse lisait le journal ligne par
  ligne au lieu de proportions par type de mail.
- **Critère.**
  - Chaque geste garde son contexte :
    - ouvert avant ou non, temps lu et profondeur de lecture ;
    - âge du mail, dossier, espace, priorité de l'IA ;
    - nombre de conversations traitées d'un coup.
  - Une habitude, c'est un même devenir sur au moins 70 % d'un type de mail (liste, expéditeur,
    domaine, catégorie, business), sur au moins 3 mails. La confiance est la borne basse de
    Wilson, et le « lift » la compare à la moyenne de la boîte.
  - Jamais de règle destructrice dans quatre cas :
    - des mails sensibles dans le groupe ;
    - un expéditeur bancaire ou administratif ;
    - un expéditeur à qui l'on répond ou que l'on suit ;
    - « jamais ouverts » hors newsletters et listes, ou sur des mails de moins d'une semaine.
- **Appliqué.**
  - `rules/behavior.ts` (tables de probabilités, habitudes, graphe).
  - Contexte : colonnes `action_log.opened`, `dwell_ms`, `age_ms`, `mailbox`, `space_id`,
    `priority`, `batch`.
  - Nouveaux gestes : `moveToFolder`, `deleteForever`, `view`, `search`, `openLink`,
    `downloadAttachment`, `copyOtp`, `send`.
  - Nouvelle action de règle `moveToFolder`, avec la suggestion « ranger dans ce dossier ».
  - Outils agent et MCP : `behavior_report`, `behavior_analytics` et `activity_log`.
- **Cas de benchmark.** Aucun : le tri IA ne change pas. Test : `behavior.test.ts` (8).

### 31/10/2026 : des demandes SAV « importantes » dans la boîte de réception, mélangées au perso

- **Cas.** Des demandes de SAV du compte pro (« can you ship to Miami or Alabama? ») arrivaient en
  priorité haute et « Important » dans la boîte de réception principale. Elles sont bien
  importantes (un client sans réponse est une vente perdue), mais elles noyaient les mails
  personnels, et les catégories affichaient leurs mails dans la boîte de réception.
- **Cause.** Rien de faux dans le tri : la priorité est juste. Le problème est l'affichage. Une seule
  boîte de réception mélangeait toutes les activités, et une catégorie ne pouvait pas en sortir
  ses mails.
- **Critère.**
  - Les mails d'une activité vivent dans son espace, avec sa propre boîte de réception, ses favoris,
    ses abonnements et ses catégories.
  - Une catégorie peut être masquée de la boîte de réception : ses mails se lisent dans la
    catégorie. La priorité et les catégories ne changent pas.
- **Appliqué.**
  - Espaces : `mail/spaces.ts` (F‑154).
  - Option « Masquer de la boîte de réception » : double-clic ou clic droit sur une catégorie.
    Colonne `tags.hide_from_inbox` et filtre `NOT_HIDDEN_FROM_INBOX` dans `store.ts`, appliqué à la
    boîte de réception et à son compteur seulement, ni à la catégorie ni à la recherche.
- **Cas de benchmark.** Aucun : le tri lui-même ne change pas. Test : `spaces.test.ts` (« a category
  marked hide from inbox… »).

### 31/10/2026 : une menace de suspension de compte triée « Autres notifications », basse

- **Cas.** Scalapay, depuis `notification@t.scalapay.com` (signé, DMARC valide) : « 🚨 La suspension
  de votre compte approche ». Une vérification d'identité est exigée par la réglementation
  anti-blanchiment, sinon le service de paiement est coupé. Le mail est resté en « Autres
  notifications », priorité basse, même après « Reclassify ».
- **Cause 1 : aucun modèle ne triait.**
  - En mode Gratuit, le seul modèle gratuit mesuré pour le tri, `inclusionai/ling-3.1-flash` sur
    ZenMux, est devenu payant. Le dernier tri par IA date du 28/10.
  - Les modèles redevenus gratuits n'ont jamais été mesurés, et Apple Intelligence est exclue du
    tri.
  - Depuis, tous les mails étaient triés par les seules règles locales, sans que rien ne le
    signale. « Reclassify » refaisait le même tri local : la fiche affichait « Moteur local ».
- **Cause 2 : les règles locales ignoraient ce cas.** Expéditeur robot, aucun mot de paiement
  échoué ni de sécurité, donc « notification » et priorité basse. La seule règle sur « your account
  will be suspended » le classait même en spam, quel que soit l'expéditeur.
- **Critère.** Un compte menacé de suspension, de blocage ou de fermeture, ou une vérification
  d'identité exigée pour le garder, passe en priorité haute, ou urgente avec un délai de 48 h ou
  moins. Il n'est jamais une simple notification. Les mêmes mots ne sont une arnaque que s'ils
  viennent d'un domaine qui n'a pas signé le mail et poussent à cliquer.
- **Appliqué.**
  - Les règles locales repèrent la menace (`accountThreat`) et l'échéance (`accountDeadline`).
  - `merge.ts` impose un plancher : jamais sous « haute », même si le modèle dit « basse ».
  - Le prompt LLM définit ce cas pour high et urgent.
  - La question Jev `threatens_account_access` est ajoutée.
  - Quand le mode choisi n'a plus de modèle pour trier, une notification le dit (une fois par
    semaine au plus) et propose le mode Business.
- **Cas de benchmark.** `account-kyc-suspension`, `account-closure-48h`, `account-suspension-phish`.
  Test : `heuristics.test.ts`.
- **Mesure (moteur local, sans IA).**
  - Les 85 cas existants passent de 92,45 à 93,19. Le phishing bancaire « Votre compte sera
    suspendu… saisissez vos identifiants sur ce lien » passe maintenant en spam.
  - Les 3 nouveaux cas obtiennent 100.
  - Total : 93,6 sur 88 cas.

### 31/10/2026 : un lien de désinscription en clair, pourtant raté

- **Cas.** IFTTT : « Privacy policy | Unsubscribe | Update preferences » en pied de page. Ce mail-là
  était bien détecté (en-tête un clic), mais la relecture du code a montré des trous.
- **Causes.**
  - Le corps n'était lu que pour les mails déjà reconnus comme envois en masse.
  - Les mails en texte brut étaient ignorés.
  - « To unsubscribe, click here » n'était pas reconnu.
  - Le premier lien trouvé gagnait.
- **Critère.** Voir « Désinscription » dans le tableau des critères.
- **Cas.** Test : `heuristics.test.ts` (« finds unsubscribe links however they are written »).

### 31/10/2026 : catégories trop spécifiques par défaut

- **Critère.** Démarrage sobre avec 7 catégories. Une catégorie désactivée ne gagne jamais le
  sujet d'un mail.
- **Tests.** `categories.test.ts`.

### 28/10/2026 : un phishing Lidl dans les « Dernières alertes »

- **Cas.** « difallahadam2003 !! 🎁 Récupérez votre cadeau Lidl », depuis `jwbfnjyu@vltinqh.us`.
  Apple Intelligence l'avait trié Opportunité, Important, priorité haute. Après un reclassement
  manuel en spam, l'alerte restait affichée.
- **Causes.**
  - Lidl ne figurait pas parmi les marques surveillées, ni les appâts « cadeau » et « récompense ».
  - Le salut par l'adresse exigeait une virgule.
  - Le domaine sans voyelles n'était pas reconnu.
  - Les alertes n'étaient pas filtrées après un reclassement, et la page n'était pas rafraîchie.
- **Critères.** Voir « Phishing » et « Alertes » dans le tableau des critères.
- **Tests.** `otp-phishing.test.ts` (« flags a fake Lidl gift »).

### Octobre 2026 : choix des modèles de tri (benchmarks Jev et Apple)

- Jev, avec ses questions typées et sa table de vérité, dépasse 98 % sur le benchmark : 98,8 au
  total, 99,2 sur les mails mis de côté. Détail dans `JEV_AUDIT.md`.
- Apple Intelligence est mesurée sous le moteur local pour le tri, d'où le critère « Modèles ».
  Détail dans `MODES.md`.

### Octobre 2026 : faux codes, spams et phishing

- **Faux codes.** Un code promo, un numéro de suivi ou de facture, un identifiant dans une URL
  (Meta, `oe=6AE58424`) étaient pris pour des codes de connexion. D'où le critère « Codes ».
- **Codes dans des spams.** Ils ne doivent jamais apparaître.
- **Doute.** « Mettre un spam dans les spams s'il y a un doute » : le signal spam l'emporte. Le
  dossier Spam du fournisseur fait foi.
- **Phishing colis.** DPD, UPS, Colissimo depuis des domaines aléatoires, salut par l'adresse.
- **Tests.** `otp-phishing.test.ts`. Benchmark : `promo-code`, `tracking-number`,
  `invoice-number`, `id-in-link` et les cas de phishing.
