#!/usr/bin/env bash
# Generates all 32 Monkemon 3D PBR .glb assets via the TRELLIS.2-4B pipeline:
# - 20 distinct Monkey-like creatures (#01 through #20, including Bosses #19 & #20)
# - Monkeball (smiling monkey-face capture ball) + Capture Capsule
# - Alex's House, Peanut Butter House, Fish House, Pork House, Beef House, Healing Pavilion & Banana Shrine
# - Hero Tamer Alex, Scout Trainers, and House Wardens
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRELLIS_BIN="${TRELLIS_BIN:-/usr/local/google/home/junius/git/trellis2-pipeline/bin/trellis2}"
CONCURRENCY="${CONCURRENCY:-5}"

echo "Running TRELLIS.2 batch asset pipeline (concurrency=${CONCURRENCY})..."
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_assets_manifest.json" -j "${CONCURRENCY}" --retries 2
"${TRELLIS_BIN}" batch "${ROOT}/tools/monkemon_sticky_spec_manifest.json" -j "${CONCURRENCY}" --retries 2
