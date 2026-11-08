#!/usr/bin/env bash
# Serves Monkemon: zero-dependency Node HTTP + real-time WebSocket multiplayer
# server (:8731) paired with the TRELLIS.2 Sanctuary 3D Forge API (:8732).
#   http://$(hostname -f):8731/   (or http://127.0.0.1:8731/?touch=0 on Steam Deck)
set -euo pipefail
cd "$(dirname "$0")"
export PORT="${PORT:-8731}"
export HOST="${HOST:-0.0.0.0}"
export FORGE_PORT="${FORGE_PORT:-8732}"

python3 tools/trellis_forge_server.py --port "${FORGE_PORT}" --host 127.0.0.1 &
FORGE_PID=$!
trap 'kill "${FORGE_PID}" 2>/dev/null || true' EXIT INT TERM

echo "Monkemon 2.5D (Archipelago Multiplayer + TRELLIS.2 Forge)  ->  http://$(hostname -f):${PORT}/"
node server.mjs
