# ZMail brand

ZMail's logo lives here, and only here. Everything the app shows is projected from it.

## Switch the logo

`Brand/ACTIVE` names the variant in use. Change it, then sync:

```bash
echo envelope-z > Brand/ACTIVE
```

```bash
pnpm brand
```

`pnpm build:app` syncs on its own, so the macOS icon always follows `Brand/ACTIVE`.

| Variant | What it is |
|---|---|
| `zippy` | **Active.** The Zippy suite icon: the brand Z on the ZMail red tile (`#FD4545 → #FC2832 → #FC051E`), straight from `Zippy/brand-kit/apps/zmail`. |
| `envelope-z` | The first ZMail icon, kept as a backup: an envelope whose top edge, diagonal and bottom edge read as a Z. `make-icon.swift` is its source; `icon.svg` is its vector twin. |

## Where the logo goes

`scripts/sync-brand.sh` copies the active variant into `apps/mail/public/brand/` (and `public/favicon.ico`). From there:

| Place | Reads |
|---|---|
| Browser tab, home-screen icon | `app/root.tsx`, through `lib/app-brand.ts` |
| Boot screen (macOS and web) | `public/boot.js` |
| Onboarding, and any other in-app spot | `<ZMailLogo>` (`components/zmail-logo.tsx`) |
| macOS app icon (`AppIcon.icns`) | `scripts/build-macos-app.sh`, from `icon-macos-1024.png` |

Don't hard-code a logo path anywhere else: use `APP_BRAND` or `<ZMailLogo>`.

## Add a variant

Create `Brand/variants/<name>/` with the same files as `zippy/`: `icon.svg`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `icon-macos-1024.png`.

## Kit

`kit/` holds the other official ZMail files from the Zippy brand kit (lockups, glyphs, maskable, macOS SVG) for documents and the README. Don't redraw them: take them from `Zippy/brand-kit`.
