#!/bin/sh
# Builds the app and installs it to /Applications, replacing and relaunching the running copy.
set -eu

[ "$(uname)" = "Darwin" ] || { echo "install-local only supports macOS"; exit 0; }

cd "$(dirname "$0")/.."
APP_NAME="Focus"
DEST="/Applications/$APP_NAME.app"
LOCK_DIR="${TMPDIR:-/tmp}/focus-install-local.lock"

# Serialise overlapping runs so two builds never swap the app at the same time.
until mkdir "$LOCK_DIR" 2>/dev/null; do sleep 2; done
trap 'rmdir "$LOCK_DIR"' EXIT

VERSION=$(node -p "require('./package.json').version")
echo "Building ${APP_NAME} ${VERSION}..."
rm -rf dist/mac dist/mac-arm64 dist/mac-x64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
BUILT=$(find dist -maxdepth 2 -name "$APP_NAME.app" -type d | head -n 1)
[ -n "$BUILT" ] || { echo "Build output not found"; exit 1; }

# Quit needs the passcode and is disabled during sleep hours, so stop it hard. Bypass and history are on disk, so nothing is lost.
pkill -9 -x "$APP_NAME" || true
while pgrep -x "$APP_NAME" >/dev/null; do sleep 0.2; done

rm -rf "$DEST"
ditto "$BUILT" "$DEST"
open "$DEST"

osascript -e "display notification \"Updated to version $VERSION\" with title \"$APP_NAME\"" || true
echo "Installed $APP_NAME $VERSION to $DEST"
