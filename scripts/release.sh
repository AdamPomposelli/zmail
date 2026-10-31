#!/usr/bin/env bash
# Publishes a ZMail release on GitHub, the one installed apps update themselves to.
#   scripts/release.sh 0.1.1 [notes.md]
# Sets the version in package.json, builds ZMail.app at that version, then uploads:
#   ZMail.zip  what the in-app updater downloads (Updater.swift prefers it)
#   ZMail.dmg  what the README's download button gives
# Commit and push the version bump first, so the release tag points at the right code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:?usage: release.sh <version> [notes.md]}"
NOTES="${2:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release: version must look like 1.2.3" >&2; exit 1; }
gh release view "v$VERSION" >/dev/null 2>&1 && { echo "release: v$VERSION already exists" >&2; exit 1; }

node -e "const f='$ROOT/package.json',p=require(f);p.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
# Built apart from dist/ZMail.app, which may be the copy running right now.
OUT="$ROOT/dist/release"
rm -rf "$OUT" && mkdir -p "$OUT/dmg"
ZMAIL_DIST="$OUT/build" ZMAIL_VERSION="$VERSION" bash "$ROOT/scripts/build-macos-app.sh" --with-web
/usr/bin/ditto -c -k --keepParent "$OUT/build/ZMail.app" "$OUT/ZMail.zip"
cp -R "$OUT/build/ZMail.app" "$OUT/dmg/" && ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname ZMail -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/ZMail.dmg" >/dev/null
rm -rf "$OUT/dmg"

ARGS=(--title "ZMail $VERSION" --target main)
if [[ -n "$NOTES" ]]; then ARGS+=(--notes-file "$NOTES"); else ARGS+=(--generate-notes); fi
gh release create "v$VERSION" "$OUT/ZMail.zip" "$OUT/ZMail.dmg" "${ARGS[@]}"
echo "Released v$VERSION: installed apps pick it up within four hours, or at once from ZMail → Check for Updates…"
