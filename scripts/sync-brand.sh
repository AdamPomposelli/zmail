#!/usr/bin/env bash
# Projects the active logo (Brand/ACTIVE) everywhere the app shows it: favicon, web icons,
# boot screen, onboarding (all read apps/mail/public/brand/), and the macOS icon at build time.
# Switch logo: echo envelope-z > Brand/ACTIVE && pnpm brand
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIANT="$(tr -d '[:space:]' < "$ROOT/Brand/ACTIVE")"
SRC="$ROOT/Brand/variants/$VARIANT"
[[ -f "$SRC/icon.svg" ]] || { echo "sync-brand: unknown variant '$VARIANT' (see Brand/variants/)" >&2; exit 1; }

OUT="$ROOT/apps/mail/public/brand"
mkdir -p "$OUT"
for f in icon.svg favicon.svg favicon.ico apple-touch-icon.png icon-192.png icon-512.png maskable-512.png; do
  cp "$SRC/$f" "$OUT/$f"
done
cp "$SRC/favicon.ico" "$ROOT/apps/mail/public/favicon.ico"
echo "$SRC"
