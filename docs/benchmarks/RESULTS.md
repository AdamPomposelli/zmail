# Benchmarks des modèles

Généré le 2026-10-27T22:50:36.780Z — 47 mails étiquetés (tri) et 8 commandes (agent), avec les prompts de production. Script : `apps/server/bench/run.ts`.

Score de tri sur 100 par mail : priorité 30 (exacte, ou 15 à un cran près), spam 20, OTP exact 20, opportunité 15, tags 15. Un JSON invalide vaut 0. Score agent : bon outil choisi (et bons arguments quand vérifiés).

| Modèle | Tri | Priorité | Spam | Opport. | OTP | Tags | JSON valide | Latence p50 / p95 | Agent | Prix $/M (entrée / sortie) | Coût / 1 000 mails |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `inclusionai/ling-3.1-flash` | **99** | 97 | 100 | 100 | 100 | 100 | 100 % | 2.2 s / 3.2 s | 100 | 0 / 0 | 0.000 ¢ |
| `deepseek/deepseek-v4.1-flash` | **98.9** | 97 | 100 | 100 | 100 | 99 | 100 % | 1.4 s / 2.3 s | 100 | 0.075 / 0.3 | 0.094 $ |
| `anthropic/claude-haiku-5.5` | **98.6** | 97 | 98 | 100 | 100 | 100 | 100 % | 2.1 s / 3.6 s | 100 | 0.1 / 0.5 | 0.200 $ |
| `typesafe/jev-1.13` | **98.4** | 96 | 100 | 100 | 100 | 98 | 100 % | 0.4 s / 1.1 s | — | 0.042 / 0 | 0.085 $ |
| `typesafe/jev-1.14` | **98.4** | 96 | 100 | 100 | 100 | 98 | 100 % | 0.4 s / 0.8 s | — | 0.042 / 0 | 0.085 $ |
| `bytedance/doubao-seed-2.0-lite` | **98.3** | 97 | 98 | 98 | 100 | 100 | 100 % | 3.3 s / 4.4 s | 100 | 0.09 / 0.51 | 0.135 $ |
| `google/gemma-4-26b-a4b-it` | **98.3** | 97 | 98 | 98 | 100 | 100 | 100 % | 3.7 s / 11.7 s | 100 | 0.15 / 0.6 | 0.175 $ |
| `google/gemini-2.5-flash-lite` | **98.1** | 97 | 98 | 98 | 100 | 99 | 100 % | 1.2 s / 2.2 s | 100 | 0.1 / 0.4 | 0.122 $ |
| `qwen/qwen3.8-flash` | **98** | 97 | 98 | 98 | 100 | 98 | 100 % | 2.8 s / 3.8 s | 100 | 0.16 / 0.47 | 0.187 $ |
| `bytedance/doubao-seed-2.0-mini` | **97.7** | 94 | 98 | 100 | 100 | 100 | 100 % | 1.7 s / 2.8 s | 100 | 0.03 / 0.28 | 0.053 $ |
| `x-ai/grok-4.2-fast-non-reasoning` | **97.6** | 95 | 100 | 98 | 100 | 97 | 100 % | 3.3 s / 4.1 s | 100 | 2 / 6 | 2.536 $ |
| `deepseek/deepseek-v4-flash` | **97.5** | 94 | 98 | 100 | 100 | 99 | 100 % | 2.6 s / 3.8 s | 87.5 | 0.22 / 0.66 | 0.263 $ |
| `google/gemini-3.5-flash-lite` | **97.5** | 95 | 98 | 98 | 100 | 99 | 100 % | 1.5 s / 2.5 s | 100 | 0.3 / 2.5 | 0.499 $ |
| `openai/gpt-5-mini` | **97.5** | 95 | 98 | 98 | 100 | 99 | 100 % | 2.4 s / 3.4 s | 100 | 0.25 / 2 | 0.393 $ |
| `google/gemini-3.1-flash-lite` | **97.2** | 95 | 96 | 98 | 100 | 100 | 100 % | 1.8 s / 2.7 s | 100 | 0.25 / 1.5 | 0.356 $ |
| `z-ai/glm-4.5-air` | **96.9** | 93 | 98 | 98 | 100 | 99 | 100 % | 2.1 s / 2.9 s | 100 | 0.1165 / 0.2911 | 0.136 $ |
| `meituan/longcat-2.0` | **96.9** | 95 | 98 | 98 | 98 | 98 | 100 % | 3.3 s / 5.0 s | 100 | 0.75 / 2.95 | 0.967 $ |
| `openai/gpt-5.4-mini` | **96.8** | 95 | 96 | 96 | 100 | 99 | 100 % | 3.6 s / 4.6 s | 100 | 0.75 / 4.5 | 0.927 $ |
| `openai/gpt-4.1-mini` | **96.6** | 94 | 98 | 98 | 98 | 98 | 100 % | 3.3 s / 4.3 s | 100 | 0.4 / 1.6 | 0.428 $ |
| `openai/gpt-5.6-luna` | **96.2** | 94 | 94 | 98 | 100 | 98 | 100 % | 4.3 s / 6.8 s | 100 | 0.2 / 1.2 | 0.334 $ |
| `z-ai/glm-4.7-flashx` | **95.3** | 91 | 98 | 98 | 98 | 94 | 100 % | 2.4 s / 32.8 s | 62.5 | 0.0728 / 0.4367 | 0.109 $ |
| `openai/gpt-4.1-nano` | **95.1** | 91 | 94 | 96 | 100 | 97 | 100 % | 3.1 s / 5.3 s | 93.8 | null / null | — |
| `openai/gpt-4o-mini` | **95.1** | 93 | 94 | 98 | 98 | 96 | 100 % | 3.5 s / 4.5 s | 93.8 | 0.15 / 0.6 | 0.170 $ |
| `openai/gpt-5.4-nano` | **93.8** | 88 | 94 | 100 | 98 | 94 | 100 % | 3.9 s / 5.1 s | 100 | 0.2 / 1.25 | 0.257 $ |
| `qwen/qwen3.6-flash` | **92.2** | 87 | 91 | 98 | 96 | 93 | 100 % | 2.0 s / 3.6 s | 100 | 0.25 / 1.5 | 0.366 $ |
| `qwen/qwen3.7-flash` | **92.2** | 87 | 91 | 98 | 96 | 93 | 100 % | 2.1 s / 2.9 s | 100 | 0.03 / 0.13 | 0.039 $ |
| `openai/gpt-6-luna` | **91.2** | 89 | 89 | 94 | 94 | 91 | 96 % | 4.2 s / 6.7 s | 100 | 0.1 / 0.5 | 0.162 $ |
| `openai/gpt-5-nano` | **91.1** | 87 | 87 | 94 | 98 | 93 | 100 % | 2.4 s / 3.3 s | 87.5 | 0.05 / 0.4 | 0.079 $ |
| `xiaomi/mimo-v2.6-flash` | **87.8** | 80 | 83 | 100 | 96 | 87 | 100 % | 11.3 s / 19.5 s | 100 | 0.14 / 0.28 | 0.168 $ |
| `minimax/minimax-m3.1-flash` | **86.2** | 84 | 77 | 98 | 94 | 82 | 98 % | 2.7 s / 8.3 s | 100 | 0.15 / 0.6 | 0.247 $ |
| `z-ai/glm-5.3-flashx` | **17** | 17 | 17 | 17 | 17 | 17 | 17 % | 5.3 s / 6.8 s | 100 | 0.375 / 1.25 | 0.707 $ |
| `google/gemini-3.5-flash` | **5** | 4 | 6 | 6 | 4 | 4 | 6 % | 5.4 s / 17.1 s | 100 | 1.5 / 9 | 3.955 $ |
| `z-ai/glm-5.3-flash` | **0** | 0 | 0 | 0 | 0 | 0 | 0 % | 1.7 s / 3.5 s | 0 | 0.075 / 0.25 | 0.000 ¢ |
| `z-ai/glm-4.7-flash-free` | **0** | 0 | 0 | 0 | 0 | 0 | 0 % | 0.6 s / 1.0 s | 0 | 0 / 0 | 0.000 ¢ |
| `stepfun/step-3.7-flash` | **0** | 0 | 0 | 0 | 0 | 0 | 0 % | 4.4 s / 55.0 s | 100 | 0.2 / 1.15 | 0.537 $ |
| `sapiens-ai/agnes-2.5-flash` | **0** | 0 | 0 | 0 | 0 | 0 | 0 % | 0.4 s / 1.6 s | 0 | 0 / 0 | 0.000 ¢ |
| _Moteur local (sans IA)_ | **92.4** | 87 | 91 | 98 | 98 | 91 | — | < 1 ms | — | gratuit | 0 |

## Erreurs par modèle

### `typesafe/jev-1.13`

- id-in-link: priorité low au lieu de normal
- secure-link-address: priorité normal au lieu de high
- secure-link-address: tags [] sans security
- new-order: priorité low au lieu de normal
- password-reset: priorité low au lieu de normal

### `typesafe/jev-1.14`

- id-in-link: priorité low au lieu de normal
- secure-link-address: priorité normal au lieu de high
- secure-link-address: tags [] sans security
- new-order: priorité low au lieu de normal
- password-reset: priorité low au lieu de normal

### `deepseek/deepseek-v4.1-flash`

- id-in-link: priorité low au lieu de normal
- password-reset: priorité high au lieu de normal
- refund-request: priorité urgent au lieu de high
- refund-request: tags interdits chargeback

### `google/gemini-2.5-flash-lite`

- postal-code-receipt: tags interdits security
- cold-outreach: spam false
- deploy-notif: priorité normal au lieu de low
- password-reset: priorité high au lieu de normal
- out-of-office: priorité normal au lieu de low
- job-candidate: opportunité true

### `anthropic/claude-haiku-5.5`

- cold-outreach: spam false
- password-reset: priorité high au lieu de normal
- refund-request: priorité urgent au lieu de high
- booking-confirmed: priorité high au lieu de normal

### `inclusionai/ling-3.1-flash`

- id-in-link: priorité low au lieu de normal
- friend-dinner: priorité normal au lieu de high
- password-reset: priorité high au lieu de normal

### `qwen/qwen3.8-flash`

- chargeback-en: priorité low au lieu de urgent
- chargeback-en: spam true
- chargeback-en: tags [] sans chargeback
- password-reset: priorité high au lieu de normal
- job-candidate: opportunité true

### `openai/gpt-4.1-mini`

- security-alert: priorité urgent au lieu de high
- friend-dinner: priorité normal au lieu de high
- password-reset: priorité high au lieu de normal
- otp-ride: priorité low au lieu de high
- otp-ride: spam true
- otp-ride: OTP null au lieu de 4821
- otp-ride: tags [] sans security
- booking-confirmed: priorité high au lieu de normal
- job-candidate: opportunité true

### `bytedance/doubao-seed-2.0-mini`

- payment-failed: priorité high au lieu de urgent
- cold-outreach: spam false
- friend-dinner: priorité normal au lieu de high
- password-reset: priorité high au lieu de normal
- unpaid-reminder: priorité high au lieu de urgent
- out-of-office: priorité normal au lieu de low
- job-candidate: priorité normal au lieu de high

