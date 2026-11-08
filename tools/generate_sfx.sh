#!/usr/bin/env bash
# Generates Monkemon's sample-based sound-effect set with the ElevenLabs Sound
# Effects API and writes normalized, silence-trimmed MP3s to assets/sfx/<name>.mp3.
# AudioSys plays these sample buffers when present and falls back to Web Audio synth otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${ELEVENLABS_API_KEY:-}" ] && [ -f "${ROOT}/.env" ]; then
  set -a; . "${ROOT}/.env"; set +a
fi
if [ -z "${ELEVENLABS_API_KEY:-}" ] && [ -f "/usr/local/google/home/junius/git/gothic/.env" ]; then
  set -a; . "/usr/local/google/home/junius/git/gothic/.env"; set +a
fi
ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-${ELEVENLABS:-}}"
: "${ELEVENLABS_API_KEY:?Set ELEVENLABS_API_KEY in .env}"

OUT="${ROOT}/assets/sfx"
mkdir -p "${OUT}"

# name | duration_seconds | prompt (punchy, clean, game-ready creature-adventure foley & chimes)
SFX=(
  "menu|0.5|crisp cheerful wooden toy UI cursor tick click, tactile handheld RPG menu navigation sound, clean dry"
  "confirm|0.55|warm cheerful two-note wooden marimba and bell UI confirm chime, handheld adventure RPG menu select, clean"
  "cancel|0.5|soft gentle low wooden two-tone back cancel click, cozy RPG menu close sound, dry"
  "throw_ball|0.65|playful whistle whoosh of tossing a glossy capture sphere through the air, crisp arc foley, dry"
  "ball_bounce|0.55|hollow glossy capsule bouncing and clicking open with a light magical pop on grass, crisp foley"
  "ball_wiggle|0.6|cute suspenseful capsule wobble rattle with a soft glowing chime pulse, single shake, clean"
  "catch_fanfare|1.6|joyful triumphant four-note adventure capture fanfare on bright celesta, bells, and warm brass sparkle"
  "break_free|0.75|capsule popping open with an energetic springy whoosh as a creature escapes, short game sound"
  "berry|0.65|crunchy sweet fruit bite followed by a bright cheerful sparkle chime, cute creature treat sound"
  "heal|1.3|warm soothing ascending five-note healing chime on glowing bells and harp shimmer, restorative RPG jingle"
  "trainer_spot|0.8|energetic dramatic exclamation chime sting with crisp snare hit, rival challenger spotted in RPG"
  "door_open|0.65|cozy wooden cottage door latch click and warm welcoming creak open, miniature diorama foley, short"
  "chest_open|1.2|wooden treasure chest latch unlocking with a bright golden coin and magical chime flourish"
  "monk_run|0.65|fast agile monkey dash whoosh with quick paw steps and punchy impact wind burst, dry game foley"
  "fake_out|0.6|sharp playful hand clap slap with a dizzy cartoon star chime pop, crisp punchy game foley"
  "eat_snack|0.85|happy cartoon chomp chomp munching a banana snack followed by a warm power-up sparkle"
  "sky_jump|0.8|springy high leap whoosh followed by a heavy cushioned ground slam thud, punchy game foley"
  "special|1.0|magical elemental energy charge swirl releasing a shimmering arcane splash burst, crisp RPG spell"
  "super_hit|0.75|powerful heavy critical strike impact thud with bright golden crystal shatter resonance, punchy RPG hit"
  "hit|0.5|clean punchy creature tackle impact thwack, tactile handheld RPG battle hit foley, dry"
  "faint|1.0|playful dizzy descending slide whistle and soft cushioned thud as creature faints, cozy RPG foley"
  "level_up|1.5|bright celebratory ascending RPG level-up fanfare on bells, chiptune sparkle, and warm chimes"
)

for entry in "${SFX[@]}"; do
  IFS='|' read -r name dur prompt <<< "${entry}"
  dst="${OUT}/${name}.mp3"
  if [ -s "${dst}" ]; then echo "= ${name} exists"; continue; fi
  tmp="/tmp/monkemon_sfx_${name}.mp3"
  dur="$(python3 -c 'import sys; print(max(0.5, min(22.0, float(sys.argv[1]))))' "${dur}")"
  echo "> ${name} (${dur}s)"
  curl -sS --fail-with-body -X POST "https://api.elevenlabs.io/v1/sound-generation" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "duration_seconds": float(sys.argv[2]), "prompt_influence": 0.58}))' "${prompt}" "${dur}")" \
    -o "${tmp}" || { echo "ERROR ${name}: $(head -c 300 "${tmp}" 2>/dev/null || true)"; rm -f "${tmp}"; continue; }
  ffmpeg -y -hide_banner -loglevel error -i "${tmp}" \
    -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.08:start_threshold=-50dB,areverse,loudnorm=I=-17:TP=-1.5:LRA=9" \
    -codec:a libmp3lame -qscale:a 4 "${dst}"
  rm -f "${tmp}"
done
ls -lh "${OUT}"
echo "MONKEMON_SFX_DONE"
