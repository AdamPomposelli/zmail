# Les trois modes de l'IA : Free, Business, Ultra

Identifiants internes : `free`, `balanced`, `max`.

Date : 28 octobre 2026. Réglages → Intelligence artificielle → « Comment l’IA range vos mails ».

Un mode choisit seul les modèles et la façon dont ils travaillent ensemble : Apple Intelligence, ZenMux, Jev, double vérification. Un choix fait dans la section « Avancé » reste prioritaire. Le mode par défaut est **Free**.

## Résultat

Mesure de bout en bout sur les 85 mails étiquetés, avec la même route que dans l'app (relais et moteur local compris) et les mêmes garde-fous. Script : `apps/server/bench/presets.ts`.

| Mode | Tri | Bonnes décisions | Spam | Codes OTP | Opportunités | Par mail | Coût / 1 000 mails |
|---|---|---|---|---|---|---|---|
| **Free** | Ling 3.1 Flash (gratuit via ZenMux), puis moteur local | **98,3 %** | 97,6 | 100 | 98,8 | 2,5 s | 0 |
| **Business** | Jev 1.13, relais DeepSeek V4.1 Flash | **98,8 %** | 100 | 100 | 100 | 0,4 s | 0,085 $ |
| **Ultra** | Jev 1.13 + DeepSeek V4.1 Flash en parallèle ; Claude Haiku 5.5 tranche en cas de désaccord (23 fois sur 85) | **99,2 %** | 100 | 100 | 100 | 1,8 s | 0,23 $ |

Le coût mensuel s'affiche pour le volume réel de la boîte. À environ 9 mails par jour, Business coûte environ 0,02 $ par mois et Ultra environ 0,07 $ par mois.

## Apple Intelligence, mesurée

Apple Intelligence a été mesurée hors de l'app, avec le même appel que le pont natif (`bench/apple/main.swift`, `bench/apple-client.ts`).

| Usage | Méthode | Résultat | Par requête |
|---|---|---|---|
| Tri | consignes habituelles | 72,0 / 100 | 4,6 s |
| Tri | questions oui/non de Jev, décision en code | 81,9 / 100 | 16 s (avec file d'attente) |
| Chat IA | 8 commandes de référence | **100 %** | **2,0 s** |
| _Moteur local ZMail (sans IA)_ | — | 92,4 / 100 | instantané |

Pour trier, le petit modèle sur le Mac fait moins bien que le moteur local gratuit de ZMail. Il répond « oui » à « demande-t-il de renvoyer un code ? » dès qu'un mail donne un code, et juge non officiels tous les domaines. Corriger ces réponses une par une reviendrait à ajuster les règles aux tests.

**Règle adoptée :** Apple Intelligence n'entre dans une route que là où elle fait mieux que le moteur local.

- **Tri :** non utilisée, puisque le moteur local fait mieux.
- **Chat IA :** utilisée en Business quand elle est disponible (100 %, 2 s, gratuite et privée). En Free, elle est classée selon sa précision et sa vitesse, à égalité avec Ling.

## Comment chaque mode choisit (`apps/server/src/ai/presets.ts`)

- **Free.** Uniquement ce qui ne coûte rien : les modèles gratuits mesurés et Apple Intelligence quand elle bat le moteur local. Le meilleur passe en premier, puis le moteur local. Aucun modèle payant n'est jamais appelé, même si un service payant est connecté.
- **Business.** Apple Intelligence passe en premier si elle est à 3 points au plus du meilleur modèle payant et assez rapide (tri ≤ 8 s, chat ≤ 4 s). Sinon, c'est le modèle payant au meilleur rapport qualité-prix, avec un relais d'une autre famille. Les offres gratuites temporaires du cloud, qui ont des quotas, n'y sont pas utilisées.
- **Ultra.** Les meilleurs modèles. Pour le tri, deux modèles de familles différentes (Jev et le meilleur LLM) répondent en parallèle. S'ils divergent sur le spam, la priorité, le code ou l'opportunité, un troisième tranche à la majorité, champ par champ (`ai/consensus.ts`).

## Vérification dans l'app

Sur la boîte de démo, en mode Ultra, l'action « Reclasser tous les mails » a donné ceci :

- les 38 mails sont triés par la double vérification ;
- 28 ont été tranchés par l'accord entre Jev et DeepSeek, et 10 par l'arbitrage de Claude Haiku ;
- chaque appel est compté dans « Consommation réelle ».

La mesure de la section « Avancé » évalue aussi la double vérification quand le mode est Ultra.

## Limites

- **Ling 3.1 Flash :** il est gratuit grâce à une offre de ZenMux, avec des quotas. Quand il ne répond pas, le mode Free retombe sur le moteur local (92,4) ; sans clé ZenMux, Free utilise aussi le moteur local.
- **Priorité :** aucun mode n'atteint 100 % sur la priorité de quelques mails ambigus (alerte bancaire, réinitialisation de mot de passe), où le libellé lui-même se discute.
