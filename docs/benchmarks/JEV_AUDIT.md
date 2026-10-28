# Audit — Jev (TypeSafe) pour le tri des mails

Date : 28 octobre 2026. Objectif fixé : faire passer Jev au-dessus de 98 % de réussite et le prouver.

## Résultat en une ligne

Jev 1.13 trie maintenant à **98,8 / 100 sur 85 mails étiquetés** (90,1 avant). Il obtient **99,2 sur 38 mails jamais utilisés pour le réglage**, avec **0 faux spam sur vos 189 vrais mails**. Il répond en **0,4 s**, 3 à 8 fois plus vite que les LLM, et coûte 0,085 $ pour 1 000 mails. ZMail l'utilise désormais par défaut pour le tri.

## 1. Ce qu'est Jev, et pourquoi le premier essai plafonnait

Jev n'est pas un modèle de chat : il ne lit pas de prompt, il répond à des **questions typées** (oui/non avec probabilité, choix parmi des options, note sur une échelle), via `POST /systemone` chez ZenMux. Il n'écrit aucun texte.

La première intégration ne respectait pas les règles de la doc TypeSafe (guide officiel « Build with TypeSafe » et page des faiblesses connues de Jev 1.13) :

| Règle TypeSafe | Première version | Version actuelle |
|---|---|---|
| Une seule judgment simple par question ; la décision se prend dans le code (« truth table ») | « Ce mail est-il du spam ? » (une décision complexe) | 23 questions atomiques, décisions en code |
| État structuré en JSON avec des champs nommés | un bloc de texte | `sender.name`, `sender.domain`, `subject`, `body`, faits connus (`sent_to_a_mailing_list`…) |
| Critères oui/non décrits comme des situations concrètes | aucun critère | chaque question a ses critères `true`/`false` |
| Choice accompagné d'un Noul « y a-t-il quelque chose ? » plutôt qu'une option « aucun » | option `none` | `gives_a_one_time_code` + choix parmi les codes, chacun montré avec son contexte |
| Ne pas poser une question qu'aucune personne ne pourrait trancher | domaine officiel demandé même sans nom d'expéditeur | question retirée quand il n'y a pas de nom |
| Vérifier sur des cas jamais utilisés pour régler | — | jeu « holdout » de 38 mails écrit avant tout réglage |

Toutes les questions et tous les seuils sont dans un seul bloc : `apps/server/src/ai/jev.ts` (`JEV_QUESTIONS`, `JEV_THRESHOLDS`, `parseJevTriage`).

## 2. Méthode

- **Jeu de réglage** : `bench/dataset.ts`, 47 mails de tri (OTP, faux codes, phishing, opportunités, urgences, newsletters…).
- **Jeu de contrôle** : `bench/holdout.ts`, 38 nouveaux mails écrits *avant* de modifier Jev, jamais utilisés pour choisir une formulation ou un seuil.
- **Vraie boîte** : `scripts/jev-real-replay.ts` relit vos 189 mails (lecture seule). Le dossier n'est jamais montré au modèle, et le dossier Spam de Gmail sert de vérité de terrain.
- **Même mesure pour tous** : chaque modèle passe par les mêmes garde-fous ZMail (`ai/merge.ts`), on note donc ce que vous voyez réellement. Scripts : `bench/eval.ts` (mesure sans rien écrire) et `bench/run.ts` (alimente le routage).

### Corrections de libellés (transparence)

Deux erreurs d'étiquetage de ma part ont été corrigées pendant l'audit. Tous les modèles ont été remesurés sur les jeux corrigés.

- `cold-outreach` (« Boostez vos ventes x10 avec notre IA », envoyé en masse) était étiqueté « pas spam », contrairement à la règle de ZMail (la prospection de masse est du spam).
- `h-dispute-paypal` prétendait venir de PayPal depuis `paypal-like.test` : c'était donc une usurpation. L'expéditeur est corrigé en `paypal.com`.

## 3. Progression de Jev

| Étape | Réglage (47) | Contrôle (38) |
|---|---|---|
| Première intégration (une question « spam ? », texte brut) | 90,1 | 90,8 |
| Questions atomiques + état structuré + critères (doc TypeSafe) | 96,1 | — |
| Table de décision : enregistrements d'achats = « normal », prise de contrôle de compte = mot de passe réellement changé, phishing = identifiants demandés depuis un domaine qui n'est pas celui de l'expéditeur | **98,4** | **99,2** |
| Sur la vraie boîte : question « domaine officiel » retirée sans nom d'expéditeur ; un cadeau n'est une arnaque qu'avec une demande de paiement/données ou un domaine usurpé | 98,4 | 99,2 |

Sur les 85 mails, **deux exécutions successives donnent exactement 98,8** : Jev est déterministe. Jev 1.13 et 1.14 donnent les mêmes résultats.

## 4. Comparatif sur les 85 mails étiquetés

Mêmes garde-fous ZMail pour tous. Coût mesuré sur les jetons réels, aux prix ZenMux.

| Modèle | Qualité | Priorité | Spam | Opportunité | OTP | Tags | Vitesse (médiane) | Coût / 1 000 mails |
|---|---|---|---|---|---|---|---|---|
| DeepSeek V4.1 Flash | 99,5 | 98,2 | 100 | 100 | 100 | 100 | 1,7 s | 0,094 $ |
| Qwen 3.8 Flash | 99,1 | 98,2 | 100 | 97,6 | 100 | 100 | 2,6 s | 0,187 $ |
| **Jev 1.13** | **98,8** | 96,5 | **100** | **100** | **100** | 98,8 | **0,4 s** | **0,085 $** |
| Ling 3.1 Flash | 98,6 | 95,9 | 100 | 98,8 | 100 | 100 | 2,3 s | gratuit (offre temporaire) |
| Claude Haiku 5.5 | 98,1 | 97,1 | 97,6 | 96,5 | 100 | 100 | 2,3 s | 0,200 $ |
| GPT-4.1 mini | 97,1 | 92,4 | 98,8 | 100 | 98,8 | 98,8 | 3,2 s | 0,428 $ |
| Gemini 2.5 Flash Lite (avant) | 96,9 | 94,7 | 96,5 | 96,5 | 98,8 | 100 | 1,4 s | 0,122 $ |
| Moteur local ZMail (sans IA) | 92,4 | — | — | — | — | — | instantané | 0 |

Lecture :
- Jev est **parfait sur ce qui coûte cher quand on se trompe** : spam, codes OTP, opportunités.
- Ses écarts portent uniquement sur la **priorité de mails ambigus** (par exemple une alerte bancaire classée haute au lieu de normale).
- DeepSeek garde 0,7 point d'avance sur ces cas, mais il est 4 fois plus lent et un peu plus cher.

## 5. Vraie boîte (189 mails, lecture seule, dossier caché au modèle)

| | Moteur précédent (Gemini/Apple) | DeepSeek V4.1 Flash | **Jev 1.13** |
|---|---|---|---|
| Spams de Gmail repérés | 70 / 106 | 98 / 106 | 97 / 106 |
| Mails légitimes classés spam | 2 / 83 | **5 / 83** (Assurance Maladie, WY Filing, carte d'arrivée Thaïlande) | **0 / 83** |
| Faux codes OTP affichés | 14 | 0 | 0 |

Dans l'app, tout mail que Gmail range dans Spam est de toute façon traité comme spam : les 9 spams que Jev ne repère pas seul (newsletters Coinbase, prospection « GenAI Fund »…) sont donc écartés aussi.

## 6. Coût réel pour vous

Environ 9 mails par jour :

| | Par mois | Par an |
|---|---|---|
| Jev 1.13 | 0,024 $ | 0,29 $ |
| DeepSeek V4.1 Flash | 0,027 $ | 0,32 $ |
| Gemini 2.5 Flash Lite (avant) | 0,034 $ | 0,41 $ |

Les 23 questions font lire environ 2 000 jetons à Jev par mail (seule l'entrée est facturée, 0,042 $ par million). L'écart de prix avec DeepSeek est donc faible ; l'avantage décisif de Jev est la vitesse et le zéro faux spam.

## 7. Bugs ZMail trouvés pendant l'audit (corrigés pour tous les modèles)

- **OTP en espagnol :** le contrôle anti-faux-code ne connaissait pas « código » ni « verificación ». Le bon code était rejeté.
- **Codes avec tiret :** les codes écrits avec un tiret (`K7P-29X`) n'étaient pas reconnus.
- **Filtre local :** le mot « cialis » était trouvé dans « So**cialis**t Republic of Vietnam », ce qui classait en spam un reçu officiel VNPay.

## 8. Ce que Jev ne fait pas, et comment ZMail le gère

- **Pas de texte.** Pour un mail trié par Jev, le bloc s'appelle « En bref » (première phrase du mail) au lieu de « Résumé IA ».
- **Pas de chat.** Le chat IA et la désinscription restent confiés à un LLM. Jev refuse ces demandes et la route passe au modèle suivant.
- **Secours.** Si TypeSafe ne répond pas, le tri bascule sur un LLM (DeepSeek), jamais sur un autre Jev.

## 9. Fichiers

- `apps/server/src/ai/jev.ts` : questions, seuils, table de décision.
- `apps/server/src/ai/providers.ts` : `JevClient`, `routePicks`.
- `apps/server/src/ai/catalog.ts` : Jev ajouté au catalogue ZenMux.
- `apps/server/bench/holdout.ts`, `bench/eval.ts` : jeu de contrôle et mesure.
- `apps/server/scripts/jev-real-replay.ts` : rejeu sur la vraie boîte.
- Tests : `test/jev.test.ts` (7), `test/ai-provider.test.ts` (routage). 87 tests sur 87.
