#!/bin/bash
# Builds PharmaDesk-Mac.pkg on a Mac (used by GitHub Actions). Usage: build-mac.sh <app dir> <out dir>
set -euo pipefail
APP_SRC="$1"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"
V="$(node -p process.version)"
WORK="$(mktemp -d)"
# One Node that runs on both Apple-chip and Intel Macs.
for a in arm64 x64; do curl -fsSL "https://nodejs.org/dist/$V/node-$V-darwin-$a.tar.gz" | tar xz -C "$WORK"; done
lipo -create "$WORK/node-$V-darwin-arm64/bin/node" "$WORK/node-$V-darwin-x64/bin/node" -output "$WORK/node"
codesign --verify "$WORK/node" 2>/dev/null || codesign --force -s - "$WORK/node"
# Free Cloudflare connector (both chip types) for a secure address phones can use from anywhere.
for a in arm64 amd64; do mkdir -p "$WORK/cf-$a"; curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$a.tgz" | tar xz -C "$WORK/cf-$a"; done
lipo -create "$WORK/cf-arm64/cloudflared" "$WORK/cf-amd64/cloudflared" -output "$WORK/cloudflared" 2>/dev/null || cp "$WORK/cf-arm64/cloudflared" "$WORK/cloudflared"
ROOT="$WORK/root"; APP="$ROOT/Applications/PharmaDesk.app/Contents"
mkdir -p "$APP/MacOS" "$APP/Resources"
cp "$HERE/Info.plist" "$APP/"
cp "$HERE/PharmaDesk" "$APP/MacOS/"
cp "$HERE/PharmaDesk.icns" "$APP/Resources/"
cp "$WORK/node" "$APP/Resources/node"
cp "$WORK/cloudflared" "$APP/Resources/cloudflared" && chmod +x "$APP/Resources/cloudflared"
cp -R "$APP_SRC/server" "$APP_SRC/dist" "$APP/Resources/"
chmod +x "$APP/MacOS/PharmaDesk" "$APP/Resources/node"
mkdir -p "$OUT"
cp -R "$HERE/scripts" "$WORK/scripts" && chmod +x "$WORK/scripts/"*
pkgbuild --root "$ROOT" --scripts "$WORK/scripts" --identifier pk.pharmadesk.app --version "${VERSION:-1.0.0}" --install-location / "$OUT/PharmaDesk-Mac.pkg"
ls -la "$OUT"
