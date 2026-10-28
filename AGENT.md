# ZMail — notes pour agents

Monorepo pnpm. Lire `docs/CAHIER_DES_CHARGES.md` (exigences F‑xx) et `docs/AUDIT.md`.

- `apps/server` (`@zmail/engine`) : moteur local Node 22 (`node:sqlite`, imapflow, nodemailer, Hono + tRPC).
  Point d'entrée `src/main.ts` ; services câblés dans `src/context.ts`.
  `pnpm --filter @zmail/engine test` (les e2e nécessitent `pnpm testmail:up`).
- `apps/mail` (`@zmail/ui`) : React Router 7 en SPA, Tailwind 4, primitives shadcn/Radix.
  Le contrat d'API est le type `AppRouter` de `@zmail/engine/trpc`.
- `apps/macos` : app Swift (SwiftPM) ; `scripts/build-macos-app.sh --with-web` produit `dist/ZMail.app`.

Conventions : TypeScript strict, 2 espaces, guillemets simples, UI en français.
