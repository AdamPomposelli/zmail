# ZMail — Backlog

Idées retenues pour plus tard. Notes internes, pas encore planifiées.

## Signaux d'intérêt : temps de lecture et clics

**Idée** : mesurer l'intérêt réel pour chaque mail et l'enregistrer dans le journal d'activité, pour que l'IA ait des signaux plus fiables que « lu / archivé » (tri, priorité, nettoyage, règles suggérées).

- **Temps passé dans un mail** : chronométrer le temps où la conversation est ouverte et visible (fenêtre au premier plan, pas en arrière-plan). Quelques secondes = survolé, plus d'une minute = lu avec attention.
- **Clics dans le mail** : savoir si on a cliqué sur un bouton d'action (CTA) ou un lien qui redirige, avec le domaine visé. Un clic est un signal d'intérêt fort.
- **Où ça va** : une ligne dans `action_log` (ex. `read_time` avec la durée, `link_click` avec le domaine), au même titre que archiver ou répondre.
- **À quoi ça sert** :
  - priorité plus haute pour les expéditeurs qu'on lit longtemps ou dont on clique les liens ;
  - newsletters jamais ouvertes plus longtemps que 2 s → proposition de désinscription ;
  - le nettoyage de l'IA (« Trier et répondre ») ne range plus seul un expéditeur qu'on lit vraiment.
- **Limites** : rien ne sort du Mac. Les liens de désinscription et les pixels de suivi ne comptent pas. Le temps doit s'arrêter quand la fenêtre perd le focus.
