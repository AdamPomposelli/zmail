#!/usr/bin/env bash
# Ensures a stable local code-signing identity for ZMail and prints the keychain holding it.
#
# Why: an ad-hoc signature identifies the app by its exact hash, which changes on every
# build. The Keychain then treats each build as a new app and asks for the user's password
# before handing over the ZMail master key. Signed with the same certificate every time,
# the app keeps one identity (bundle id + certificate) and the "Always Allow" sticks.
#
# The certificate is self-signed, valid only on this Mac, and lives in its own keychain
# (~/Library/Keychains/zmail-signing.keychain-db) so the login keychain is left untouched.
set -euo pipefail

NAME="ZMail Local Signing"
KEYCHAIN="$HOME/Library/Keychains/zmail-signing.keychain-db"
# Protects only this throwaway signing key; it is not a user secret.
PASS="zmail-local-signing"

if [[ ! -f "$KEYCHAIN" ]]; then
  security create-keychain -p "$PASS" "$KEYCHAIN" >/dev/null
  security set-keychain-settings "$KEYCHAIN" # no auto-lock
fi
security unlock-keychain -p "$PASS" "$KEYCHAIN"

if ! security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -passout "pass:$PASS" -out "$TMP/id.p12" 2>/dev/null
  security import "$TMP/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
  # Let codesign use the key without a prompt.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KEYCHAIN" >/dev/null
fi

echo "$KEYCHAIN"
