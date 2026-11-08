#!/usr/bin/env bash
# Headless Chrome screenshot tool for Monkemon 2.5D (expects serve.sh on :8721).
# Usage: tools/screenshot.sh "screen=play&zone=sunpalm&house=1" /tmp/monkemon_shot.png 5000
set -euo pipefail
QUERY="${1:-}"
OUT="${2:-/tmp/monkemon_shot.png}"
BUDGET="${3:-5000}"
PORT="${PORT:-8731}"
CHROME="${CHROME:-google-chrome}"
TMP_PROFILE="$(mktemp -d)"
trap 'rm -rf "$TMP_PROFILE"' EXIT

"$CHROME" --headless=new --disable-extensions \
  --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --no-first-run \
  --user-data-dir="$TMP_PROFILE" \
  --window-size=1280,800 --screenshot="$OUT" --virtual-time-budget="$BUDGET" \
  --enable-logging=stderr --v=0 --autoplay-policy=no-user-gesture-required \
  --proxy-server='direct://' --proxy-bypass-list='*' \
  "http://127.0.0.1:${PORT}/?touch=0&${QUERY}" 2>&1 \
  | grep -E "CONSOLE|Uncaught|Error|error" | grep -v -E "gpu|GPU|dbus|DBus|bluez|fontconfig|Fontconfig|swiftshader|Vulkan|ANGLE" || true
echo "wrote $OUT"
