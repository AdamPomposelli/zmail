#!/usr/bin/env bash
# Builds dist/ZMail.app: native shell (apps/macos) + Node engine + web UI + node binary.
#
# Usage: scripts/build-macos-app.sh [--with-web]
#   --with-web   also build @zmail/engine and @zmail/ui with pnpm first
#
# Env overrides (optional):
#   ZMAIL_ENGINE_SRC  directory containing engine.mjs   (default: apps/server/dist)
#   ZMAIL_UI_SRC      directory containing index.html   (default: apps/mail/build/client)
#   NODE_BIN          node binary to embed              (default: $(command -v node))
#   ZMAIL_VERSION     CFBundleShortVersionString         (default: 0.1.0)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/apps/macos"
DIST="$ROOT/dist"
APP="$DIST/ZMail.app"
ENGINE_SRC="${ZMAIL_ENGINE_SRC:-$ROOT/apps/server/dist}"
UI_SRC="${ZMAIL_UI_SRC:-$ROOT/apps/mail/build/client}"
VERSION="${ZMAIL_VERSION:-0.1.0}"
BUILD_NUMBER="$(date +%Y%m%d%H%M)"

WITH_WEB=0
for arg in "$@"; do
  case "$arg" in
    --with-web) WITH_WEB=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
step() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# The active logo (Brand/ACTIVE), projected into the web UI before it is built.
BRAND_SRC="$("$ROOT/scripts/sync-brand.sh")"
step "Logo: $(basename "$BRAND_SRC")"

if [[ $WITH_WEB -eq 1 ]]; then
  step "Building engine and UI (pnpm)"
  (cd "$ROOT" && pnpm --filter @zmail/engine build && pnpm --filter @zmail/ui build)
fi

step "Building Swift package (release)"
swift build -c release --package-path "$PKG"
BIN="$(swift build -c release --package-path "$PKG" --show-bin-path)/ZMail"

step "Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/ZMail"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>fr</string>
  <key>CFBundleExecutable</key><string>ZMail</string>
  <key>CFBundleIdentifier</key><string>com.zippy.zmail</string>
  <key>NSMicrophoneUsageDescription</key><string>ZMail écoute votre voix uniquement quand vous dictez un mail à l’assistant.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Pour transformer votre voix en texte quand vous dictez un mail, sur votre Mac.</string>
  <key>CFBundleName</key><string>ZMail</string>
  <key>CFBundleDisplayName</key><string>ZMail</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
printf 'APPL????' > "$APP/Contents/PkgInfo"

# Engine
if [[ -f "$ENGINE_SRC/engine.mjs" ]]; then
  mkdir -p "$APP/Contents/Resources/engine"
  cp -R "$ENGINE_SRC/." "$APP/Contents/Resources/engine/"
  # MCP stdio bridge (Claude Desktop, Codex CLI) — run by the bundled node, next to engine.mjs.
  if [[ ! -f "$APP/Contents/Resources/engine/zmail-mcp.mjs" ]]; then
    if [[ -f "$ROOT/apps/server/dist/zmail-mcp.mjs" ]]; then
      cp "$ROOT/apps/server/dist/zmail-mcp.mjs" "$APP/Contents/Resources/engine/"
    else
      warn "zmail-mcp.mjs not found — MCP install for Claude Desktop / Codex will be unavailable (pnpm --filter @zmail/engine build)."
    fi
  fi
else
  warn "engine not found at $ENGINE_SRC/engine.mjs — build it with: pnpm --filter @zmail/engine build (or pass --with-web)."
  warn "The app will show an error until Contents/Resources/engine/engine.mjs exists (or ZMAIL_ENGINE_PATH is set)."
fi

# UI
if [[ -f "$UI_SRC/index.html" ]]; then
  mkdir -p "$APP/Contents/Resources/ui"
  cp -R "$UI_SRC/." "$APP/Contents/Resources/ui/"
else
  warn "UI not found at $UI_SRC/index.html — build it with: pnpm --filter @zmail/ui build (or pass --with-web)."
fi

# Node runtime — must be self-contained: the app ships only this one file.
# A Homebrew node links @rpath/libnode.*.dylib and /opt/homebrew libraries: copied alone into the
# bundle it crashes at launch (dyld "Library not loaded"), and the engine never starts.
standalone_node() { ! otool -L "$1" | tail -n +2 | grep -qvE '^\s*(/usr/lib/|/System/)'; }
real_path() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
NODE_REAL=""
if [[ -n "${NODE_BIN:-}" ]]; then
  NODE_REAL="$(real_path "$NODE_BIN")"
  standalone_node "$NODE_REAL" || die "NODE_BIN=$NODE_BIN links non-system libraries; use an official nodejs.org / nvm build."
else
  # PATH first, then nvm installs (newest first): the first self-contained node >= 22 wins.
  for candidate in $(which -a node 2>/dev/null) $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -rV); do
    real="$(real_path "$candidate")"
    major="$("$real" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$major" -ge 22 ]] && standalone_node "$real"; then NODE_REAL="$real"; break; fi
  done
fi
if [[ -n "$NODE_REAL" ]]; then
  cp "$NODE_REAL" "$APP/Contents/Resources/node"
  chmod 755 "$APP/Contents/Resources/node"
  # Prove it starts from inside the bundle before shipping it.
  "$APP/Contents/Resources/node" -e 'process.exit(0)' || die "the embedded node does not start"
  step "Embedded node $("$NODE_REAL" --version) from $NODE_REAL"
else
  die "no self-contained node >= 22 found (install one with nvm, or pass NODE_BIN=/path/to/node)."
fi

# Icon
step "Generating AppIcon.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$BRAND_SRC/icon-macos-1024.png" "$TMP/icon-1024.png"
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$TMP/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$TMP/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Signing. A stable local identity keeps the app's Keychain access across rebuilds
# (scripts/signing-identity.sh explains why); ad-hoc is the fallback.
# The embedded node keeps its upstream signature when valid (--deep skips Resources).
SIGN_ARGS=(--sign -)
if SIGN_KEYCHAIN="$("$ROOT/scripts/signing-identity.sh" 2>/dev/null)"; then
  SIGN_ARGS=(--sign "ZMail Local Signing" --keychain "$SIGN_KEYCHAIN")
  step "Codesigning (ZMail Local Signing)"
else
  step "Codesigning (ad-hoc: no local identity, the Keychain will ask again after each build)"
fi
if [[ -f "$APP/Contents/Resources/node" ]] && ! codesign --verify "$APP/Contents/Resources/node" 2>/dev/null; then
  codesign --force "${SIGN_ARGS[@]}" "$APP/Contents/Resources/node"
fi
codesign --force --deep "${SIGN_ARGS[@]}" "$APP"
codesign --verify --deep --strict "$APP" && step "Signature OK"

echo
echo "Built: $APP"
