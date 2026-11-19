#!/usr/bin/env bash
# Generates expressive Gemini TTS voice clips for Professor Macaque and the
# House Masters of Peanut Butter House, Fish House, Pork House, and Beef House.
set -euo pipefail

GENAI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/genai.py"
genai() { python3 "$GENAI" "$@"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/assets/voice"
mkdir -p "${OUT_DIR}"

gen_voice() {
  local key="$1"
  local voice="$2"
  local lang="$3"
  local style="$4"
  local text="$5"
  local wav="/tmp/monkemon_voice_${key}.wav"
  local mp3="${OUT_DIR}/${key}.mp3"

  if [ -s "${mp3}" ]; then
    echo "= ${key}.mp3 exists"
    return
  fi

  if [ ! -s "${wav}" ]; then
    genai tts --timeout=90 --out="${wav}" --voice="${voice}" --style="${style}" "${text}" || true
  fi

  if [ -s "${wav}" ]; then
    ffmpeg -y -hide_banner -loglevel error -i "${wav}" \
      -af "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.18:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11" \
      -codec:a libmp3lame -qscale:a 4 "${mp3}"
    echo "+ wrote ${mp3}"
  fi
}

gen_voice "prof_welcome" "Charon" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: warm grandfatherly naturalist professor\nDirection: Warm chuckle, cheerful island researcher welcoming Alex.\nEmotion: Warm, enthusiastic, wise\nPacing: Brisk\nExpressivity: High' \
  "<chuckle> Welcome to the Banana Archipelago, young Tamer! Bond with your Monkemon partner, explore all five island zones, and earn the Solar Crown!"

gen_voice "house_pb" "Orus" "en-US" \
  $'Language: English\nRegion: United States\nVoice: upbeat playful chef-tamer\nDirection: Friendly laugh, energetic peanut-butter dojo challenge.\nEmotion: Playful, confident, cheerful\nPacing: Fast\nExpressivity: High' \
  "<chuckle> Welcome to the Peanut Butter House, Alex! Careful—things get crunchy and sticky in my battle ring!"

gen_voice "house_fish" "Aoede" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: lively harbor captain woman\nDirection: Cheerful laugh, spirited seaside arena challenge.\nEmotion: Lively, focused, adventurous\nPacing: Dynamic\nExpressivity: High' \
  "<chuckle> Ahoy from the Fish House! My Rubber Duck Monkemon are ready to make a giant splash!"

gen_voice "house_pork" "Algenib" "en-US" \
  $'Language: English\nRegion: United States\nVoice: theatrical cozy lodge master\nDirection: Hearty chuckle, warm yet competitive challenge.\nEmotion: Spirited, proud, theatrical\nPacing: Brisk\nExpressivity: High' \
  "<laugh> Step right up to the Pork House! Let's see if your Monkemon can handle our Bob and Stuffie squad!"

gen_voice "house_beef" "Enceladus" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: booming heroic grand champion\nDirection: Hearty laugh, majestic booming championship proclamation.\nEmotion: Heroic, commanding, joyful\nPacing: Grand\nExpressivity: High' \
  "<laugh> Welcome to the Beef House Championship! Defeat my team and unseal Boss Twenty—King Monkezilla himself!"

gen_voice "alex_mom" "Aoede" "en-US" \
  $'Language: English\nRegion: United States\nVoice: warm loving mother\nDirection: Gentle warm laugh, caring encouraging greeting.\nEmotion: Loving, proud, cheerful\nPacing: Warm\nExpressivity: High' \
  "<chuckle> Welcome home, Alex! Have some warm Peanut-Butter Banana toast—your Monkemon are all healed up and ready!"

gen_voice "scout_milo" "Orus" "en-US" \
  $'Language: English\nRegion: United States\nVoice: excited young boy scout\nDirection: Energetic laugh, friendly rookie battle callout.\nEmotion: Excited, playful\nPacing: Fast\nExpressivity: High' \
  "<chuckle> Hey Alex! My Puppuchin learned Monk Run—let's have our first Monkemon battle!"

gen_voice "scout_pippa" "Aoede" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: bubbly cheerful picnicker\nDirection: Happy giggle, spirited challenge.\nEmotion: Joyful, enthusiastic\nPacing: Brisk\nExpressivity: High' \
  "<chuckle> My Plushaki is the softest Stuffie-type on the beach! Ready, set, battle!"

gen_voice "tamer_bobby" "Charon" "en-US" \
  $'Language: English\nRegion: United States\nVoice: deadpan friendly office guy\nDirection: Polite chuckle, confident dad-joke tone.\nEmotion: Calm, amused, proud\nPacing: Measured\nExpressivity: High' \
  "<chuckle> Never underestimate a Bob-type Monkemon wearing a freshly ironed necktie!"

gen_voice "tamer_daisy" "Aoede" "en-US" \
  $'Language: English\nRegion: United States\nVoice: lively swimmer tamer\nDirection: Playful laugh, splashy challenge.\nEmotion: Playful, bright\nPacing: Fast\nExpressivity: High' \
  "<laugh> Squeak squeak! My Rubber Duck Monkemon bounce right over Monster attacks!"

gen_voice "tamer_rex" "Alnilam" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: disciplined martial arts master\nDirection: Focused shout, honorable martial greeting.\nEmotion: Noble, intense\nPacing: Brisk\nExpressivity: High' \
  "Our Fake Out and Jump combos were perfected in the steaming snow springs! En garde!"

gen_voice "boss19_titanape" "Charon" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: deep ancient celestial guardian\nDirection: Thunderous rumbling laugh, majestic booming trial challenge.\nEmotion: Ancient, noble, mighty\nTexture: Deep, resonant\nPitch: Low\nExpressivity: High' \
  "<laugh> Guardian Nineteen, Titanape, awakens! Prove your bond before the Throne of Twenty, young Alex!"

gen_voice "boss20_monkezilla" "Enceladus" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: colossal monster king boss\nDirection: Earth-shaking roar-laugh, dramatic booming kaiju proclamation.\nEmotion: Fierce, theatrical, monumental\nTexture: Deep, gravelly, thunderous\nPitch: Low\nExpressivity: High' \
  "<laugh> BEHOLD NUMBER TWENTY—KING MONKEZILLA! Let's see if your Monkeball can tame the Crowned Monster King!"

gen_voice "narrator_ending" "Charon" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: warm storybook narrator\nDirection: Uplifting, proud, heartwarming celebration.\nEmotion: Triumphant, warm, joyful\nPacing: Graceful\nExpressivity: High' \
  "From Alex's House to the Peanut Butter, Fish, Pork, and Beef Houses, Alex and their Monkemon conquered all twenty trials and became Grand Champions of the Archipelago!"
