# ZMail — Cahier des charges

> Client mail macOS **agentique, IA‑first**.
> Document de référence : chaque exigence porte un identifiant (`F-xx`) repris dans
> [`AUDIT.md`](./AUDIT.md) avec sa preuve (test, capture d'écran, commande).

## 1. Problème

L'utilisateur gère 5 à 10 boîtes mail réparties chez plusieurs hébergeurs (Gmail et ses
alias, IMAP self‑hosted sur VPS, mailbox.org, Namecheap Private Email…) pour plusieurs
activités (« business »). Trier tout ça prend 1 à 2 h par jour et casse le deep work.

## 2. Objectif

Une seule app desktop macOS qui :

1. agrège **toutes** les boîtes dans une inbox unifiée ;
2. fait trier, classer, prioriser et nettoyer les mails **par un agent IA** ;
3. apprend des actions de l'utilisateur pour **proposer des règles** automatiquement ;
4. ne notifie que ce qui compte (OTP, haute priorité, opportunités business, règles perso) ;
5. utilise **gratuitement l'IA embarquée de macOS** (Apple Foundation Models), avec en
   option n'importe quel fournisseur compatible OpenAI via clé API (ZenMux, OpenRouter,
   OpenAI, Ollama…).

## 3. Contraintes techniques

| ID | Contrainte |
|----|-----------|
| C-01 | Pile front : React Router 7, Tailwind 4, shadcn/Radix, Geist. |
| C-02 | **Local‑first** : aucune dépendance cloud obligatoire (ni base de données distante, ni compte, ni télémétrie). Données dans SQLite local (`~/Library/Application Support/ZMail`). |
| C-03 | App macOS native (Swift/AppKit + WKWebView) qui embarque le moteur mail Node et l'UI. |
| C-04 | Secrets (mots de passe IMAP/SMTP, clés API) chiffrés AES‑256‑GCM avec une clé maîtresse stockée dans le **Trousseau macOS**. |
| C-05 | IA par défaut **on‑device** (Apple Foundation Models via le pont Swift) → coût 0 €. Fournisseurs OpenAI‑compatibles optionnels. Fallback heuristique si aucune IA n'est dispo (l'app reste utilisable). |
| C-06 | Protocoles standards : IMAP (IDLE pour le temps réel) + SMTP. Gmail via IMAP (mot de passe d'application). |

## 4. Exigences fonctionnelles

### 4.1 Comptes & agrégation
| ID | Exigence |
|----|---------|
| F-01 | Connecter un nombre illimité de comptes IMAP/SMTP (cible 5‑10) avec **préréglages** : Gmail, Google Workspace, mailbox.org, Namecheap Private Email, iCloud, Outlook/Office 365, Fastmail, Zoho, IMAP personnalisé (VPS). |
| F-02 | Test de connexion IMAP **et** SMTP avant enregistrement, avec message d'erreur lisible. |
| F-03 | Synchronisation initiale (N derniers jours) puis **temps réel via IMAP IDLE** + resynchro périodique ; statut de synchro par compte. |
| F-04 | **Inbox unifiée** regroupant tous les comptes, triée par priorité puis date ; filtre par compte. |
| F-05 | Dossiers standards par compte (Inbox, Envoyés, Brouillons, Archive, Spam, Corbeille) et actions : lire/non lu, étoile, archiver, supprimer, déplacer, spam. Les actions sont répercutées sur le serveur IMAP. |
| F-06 | Lecture de fil (threading Message‑ID/References), rendu HTML sécurisé, pièces jointes. |
| F-07 | Rédaction, réponse, transfert via SMTP depuis le bon compte (choix de l'expéditeur), copie dans « Envoyés ». |
| F-08 | Recherche plein texte locale sur tous les comptes. |

### 4.2 Business
| ID | Exigence |
|----|---------|
| F-10 | Créer des **business** (nom, couleur, icône/emoji, description). |
| F-11 | Rattacher automatiquement chaque mail à un business d'après sa provenance : compte de réception, adresse/alias destinataire (`To`/`Delivered-To`), domaine. Règles de correspondance éditables. |
| F-12 | Naviguer par business dans l'inbox unifiée (sidebar + compteurs non lus). |

### 4.3 Classification & priorisation IA (« pipeline d'arrivée »)
Chaque mail entrant passe automatiquement dans le pipeline :

| ID | Exigence |
|----|---------|
| F-20 | **Tags génériques** : Important, À répondre, Opportunité, Facture/Paiement, Chargeback/Litige, Sécurité/OTP, Newsletter, Marketing, Notification, Réunion, Personnel, Livraison. |
| F-21 | **Tags personnalisés** créés par l'utilisateur (nom + description en langage naturel utilisée par l'IA + couleur). |
| F-22 | **Score de priorité** (urgent / haute / normale / basse) ; l'inbox est triée par priorité. |
| F-23 | **Spam** détecté → sort de l'inbox principale (vue « Spam IA »), avec possibilité de corriger. |
| F-24 | **Opportunité business** (demande commerciale, offre, partenariat, devis) détectée **par business** et mise en avant (vue dédiée + notification). |
| F-25 | Résumé court (une ligne) de chaque mail, affiché dans la liste. |
| F-26 | Tout est re‑traitable manuellement (« Re‑classer ») et corrigeable ; les corrections nourrissent l'apprentissage. |

### 4.4 OTP
| ID | Exigence |
|----|---------|
| F-30 | Pré‑filtre rapide (mots‑clés + motifs) puis extraction du code par le LLM connecté. |
| F-31 | **Notification push macOS native** avec le code et un bouton **« Copier le code »** (CTA) ; copie aussi possible depuis l'app (carte OTP en haut du mail). |
| F-32 | Les OTP expirent visuellement (ancienneté) et ne polluent pas l'inbox prioritaire. |

### 4.5 Notifications
| ID | Exigence |
|----|---------|
| F-40 | Notifications natives macOS (Centre de notifications) : OTP, priorité urgente/haute, opportunité business, mails correspondant à une **règle de notification perso** (ex. « tous les chargebacks »). Tout le reste est silencieux. |
| F-41 | Réglages par type (on/off), par business, et règles en langage naturel créées via l'agent. |
| F-42 | Notification d'échec quand l'agent n'arrive pas à se désinscrire (cf. F-61). |

### 4.6 Apprentissage des actions & règles suggérées
| ID | Exigence |
|----|---------|
| F-50 | **Chaque action** utilisateur est journalisée (archiver, supprimer, lire, étoile, déplacer, spam, tag, désinscription, ouverture) avec ses caractéristiques (expéditeur, domaine, tags, business, compte). Journal consultable. |
| F-51 | Détecteur de **motifs répétitifs** (même action sur même expéditeur/domaine/tag ≥ seuil). |
| F-52 | À chaque motif détecté, l'agent **propose une règle** dans une **modale** : « Voulez‑vous qu'à partir de maintenant ces mails soient automatiquement … ? » — Accepter / Plus tard / Jamais. |
| F-53 | Moteur de **règles** (conditions : expéditeur, domaine, tag, business, compte, sujet contient, texte libre IA ; actions : archiver, supprimer, marquer lu, déplacer en spam, ajouter tag, notifier, se désinscrire). Appliqué à chaque mail entrant ; règles éditables / désactivables. |
| F-54 | Règle appliquée rétroactivement aux mails existants à l'acceptation (optionnel). |

### 4.7 Désinscription automatique
| ID | Exigence |
|----|---------|
| F-60 | Détection newsletter / marketing (`List-Unsubscribe`, `List-Id`, contenu) et extraction du lien ou de l'adresse de désinscription (en‑tête **et** corps du mail). |
| F-61 | Bouton **« Se désinscrire » en un clic** : l'agent exécute la désinscription (RFC 8058 One‑Click POST, `mailto:` via SMTP, sinon lien HTTP visité et page analysée par l'IA pour confirmer). Succès → toast ; échec → **notification push** + lien manuel. |
| F-62 | Si l'utilisateur se désinscrit / supprime souvent un type de mail, l'agent **suggère** de se désinscrire des newsletters jamais ouvertes (vue « Abonnements » avec statistiques ouvert/supprimé). |

### 4.8 Agent IA conversationnel
| ID | Exigence |
|----|---------|
| F-70 | Panneau de chat avec l'agent : questions sur la boîte (« quels mails importants aujourd'hui ? »), et **création de règles/tags/notifications en langage naturel** (« notifie‑moi de tous les chargebacks »). |
| F-71 | L'agent agit via des outils typés (créer règle, créer tag, rechercher, résumer) et affiche ce qu'il a fait. |

### 4.9 Fournisseurs IA
| ID | Exigence |
|----|---------|
| F-80 | **Apple Intelligence on‑device** (Foundation Models) par défaut, gratuit, via le pont natif. Détection de disponibilité. |
| F-81 | Services **OpenAI‑compatibles** connectables avec une simple clé : ZenMux, OpenRouter, OpenAI, Ollama, personnalisé. **L'utilisateur ne choisit pas de modèle** à la connexion. Test de connexion. |
| F-82 | **Orchestration par capacité** (tri, agent, désinscription) : ZMail choisit le modèle d'après ses propres benchmarks (qualité, puis coût et latence), avec modèles relais et repli heuristique. Personnalisation par capacité possible, en option. |
| F-83 | **Benchmarks** reproductibles des modèles avec les prompts de production sur un jeu étiqueté ; un modèle sous 80/100 n'est jamais recommandé. |
| F-84 | **Prévisionnel de coût** par capacité et par modèle, calculé sur le volume réel de mails des comptes connectés (simulable), et suivi de la consommation réelle. |

### 4.10 UI/UX
| ID | Exigence |
|----|---------|
| F-90 | Langage visuel : sidebar, liste dense, panneau de lecture, Geist, thème sombre/clair, raccourcis clavier, palette de commandes. |
| F-91 | Sidebar : Inbox unifiée, Prioritaires, Opportunités, OTP, Newsletters, Spam IA, Business (avec couleurs/compteurs), Tags, Comptes. |
| F-92 | Ligne de mail : expéditeur, badge business, tags colorés, indicateur de priorité, résumé IA, compte. |
| F-93 | Réglages : Comptes, Business, Tags, Règles, Notifications, IA, Activité (journal), Apparence, Raccourcis. En réglages, la barre latérale des mails devient le menu des réglages sans rien déplacer à l'écran ; une barre de recherche mène directement à n'importe quel réglage. |
| F-94 | Onboarding vide soigné (aucun compte → assistant de connexion). |
| F-99 | Destinataires en pastilles : une adresse complète suivie d'un espace devient une pastille ; clic pour la modifier, × pour la retirer. |
| F-100 | Signatures : bibliothèque, signature par défaut par compte (nouveaux mails / réponses), accès rapide à côté d'« Envoyer ». |
| F-95 | Aucune incohérence visuelle : vérifiée par captures d'écran clair/sombre dans l'audit. |

## 5. Architecture cible

```
ZMail.app (Swift, AppKit)
 ├─ WKWebView ──────────────► UI (apps/mail, build statique servi par le moteur)
 ├─ Pont natif (HTTP 127.0.0.1, token)
 │    ├─ /ai/generate   → Apple Foundation Models (on‑device)
 │    ├─ /notify        → UNUserNotificationCenter (+ action « Copier le code »)
 │    └─ /keychain      → clé maîtresse
 └─ lance le moteur Node (apps/server)
        ├─ Hono + tRPC
        ├─ SQLite (node:sqlite)
        ├─ Sync IMAP (imapflow, IDLE) / envoi SMTP (nodemailer) / parsing (mailparser)
        ├─ Pipeline IA (classification, priorité, spam, OTP, opportunités, désinscription)
        ├─ Journal d'actions + détecteur de motifs + moteur de règles
        └─ Fournisseurs IA : Apple (pont) | OpenAI‑compatible | heuristique
```

## 6. Critères d'acceptation

- Toutes les exigences `F-xx` ont une preuve dans `docs/AUDIT.md`.
- Tests automatisés du moteur (pipeline, règles, motifs, OTP, désinscription, sync IMAP
  contre un vrai serveur IMAP/SMTP de test) au vert.
- Captures d'écran de chaque écran clé, clair et sombre, sans incohérence.
- L'app macOS se construit et se lance (`ZMail.app`).
