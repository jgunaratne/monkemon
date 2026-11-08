#!/usr/bin/env bash
# Generates expressive Daikon TTS voice clips for Professor Macaque and the
# House Masters of Peanut Butter House, Fish House, Pork House, and Beef House.
set -euo pipefail

G=/google/bin/releases/gemini-agents-generate/generate
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/assets/voice"
mkdir -p "${OUT_DIR}"

gen_daikon() {
  local key="$1"
  local voice="$2"
  local lang="$3"
  local style="$4"
  local text="$5"
  local wav="/tmp/monkemon_daikon_${key}.wav"
  local req="/tmp/monkemon_daikon_${key}.textproto"
  local mp3="${OUT_DIR}/${key}.mp3"

  if [ -s "${mp3}" ]; then
    echo "= ${key}.mp3 exists"
    return
  fi

  if [ ! -s "${wav}" ]; then
    python3 - "${req}" "${voice}" "${lang}" "${style}" "${text}" << 'PY'
import json, sys
req_path, voice, lang, style, text = sys.argv[1:6]
esc = lambda s: json.dumps(s)
proto = f'''model: "models/gemini-v4s-tts-nlm-daikon"
contents {{
  role: "user"
  parts {{
    text: {esc(text)}
    part_metadata {{
      fields {{ key: "level" value {{ number_value: 0 }} }}
      fields {{ key: "speaker" value {{ string_value: "0" }} }}
      fields {{ key: "contain_backchannel" value {{ bool_value: false }} }}
      fields {{ key: "style" value {{ string_value: {esc(style)} }} }}
    }}
  }}
}}
generation_config {{
  response_modalities: AUDIO
  stop_sequences: "<end_of_audio>"
  speech_config {{
    language_code: {esc(lang)}
    voice_config {{
      prebuilt_voice_config {{
        voice_name: {esc(voice)}
      }}
    }}
  }}
}}
'''
with open(req_path, 'w', encoding='utf-8') as f:
    f.write(proto)
PY
    "${G}" -prod -timeout=90s -output="${wav}" -request="${req}" || true
  fi

  if [ -s "${wav}" ]; then
    ffmpeg -y -hide_banner -loglevel error -i "${wav}" \
      -af "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.18:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11" \
      -codec:a libmp3lame -qscale:a 4 "${mp3}"
    echo "+ wrote ${mp3}"
  fi
}

gen_daikon "prof_welcome" "msm00001" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: warm grandfatherly naturalist professor\nDirection: Warm chuckle, cheerful island researcher welcoming Alex.\nEmotion: Warm, enthusiastic, wise\nPacing: Brisk\nExpressivity: High' \
  "<|chuckle|> Welcome to the Banana Archipelago, young Tamer! Bond with your Monkemon partner, explore all five island zones, and earn the Solar Crown!"

gen_daikon "house_pb" "star09" "en-US" \
  $'Language: English\nRegion: United States\nVoice: upbeat playful chef-tamer\nDirection: Friendly laugh, energetic peanut-butter dojo challenge.\nEmotion: Playful, confident, cheerful\nPacing: Fast\nExpressivity: High' \
  "<|chuckle|> Welcome to the Peanut Butter House, Alex! Careful—things get crunchy and sticky in my battle ring!"

gen_daikon "house_fish" "star02" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: lively harbor captain woman\nDirection: Cheerful laugh, spirited seaside arena challenge.\nEmotion: Lively, focused, adventurous\nPacing: Dynamic\nExpressivity: High' \
  "<|chuckle|> Ahoy from the Fish House! My Rubber Duck Monkemon are ready to make a giant splash!"

gen_daikon "house_pork" "star07" "en-US" \
  $'Language: English\nRegion: United States\nVoice: theatrical cozy lodge master\nDirection: Hearty chuckle, warm yet competitive challenge.\nEmotion: Spirited, proud, theatrical\nPacing: Brisk\nExpressivity: High' \
  "<|laughter|> Step right up to the Pork House! Let's see if your Monkemon can handle our Bob and Stuffie squad!"

gen_daikon "house_beef" "star13" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: booming heroic grand champion\nDirection: Hearty laugh, majestic booming championship proclamation.\nEmotion: Heroic, commanding, joyful\nPacing: Grand\nExpressivity: High' \
  "<|laughter|> Welcome to the Beef House Championship! Defeat my team and unseal Boss Twenty—King Monkezilla himself!"

gen_daikon "alex_mom" "star02" "en-US" \
  $'Language: English\nRegion: United States\nVoice: warm loving mother\nDirection: Gentle warm laugh, caring encouraging greeting.\nEmotion: Loving, proud, cheerful\nPacing: Warm\nExpressivity: High' \
  "<|chuckle|> Welcome home, Alex! Have some warm Peanut-Butter Banana toast—your Monkemon are all healed up and ready!"

gen_daikon "scout_milo" "star09" "en-US" \
  $'Language: English\nRegion: United States\nVoice: excited young boy scout\nDirection: Energetic laugh, friendly rookie battle callout.\nEmotion: Excited, playful\nPacing: Fast\nExpressivity: High' \
  "<|chuckle|> Hey Alex! My Puppuchin learned Monk Run—let's have our first Monkemon battle!"

gen_daikon "scout_pippa" "star02" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: bubbly cheerful picnicker\nDirection: Happy giggle, spirited challenge.\nEmotion: Joyful, enthusiastic\nPacing: Brisk\nExpressivity: High' \
  "<|chuckle|> My Plushaki is the softest Stuffie-type on the beach! Ready, set, battle!"

gen_daikon "tamer_bobby" "msm00001" "en-US" \
  $'Language: English\nRegion: United States\nVoice: deadpan friendly office guy\nDirection: Polite chuckle, confident dad-joke tone.\nEmotion: Calm, amused, proud\nPacing: Measured\nExpressivity: High' \
  "<|chuckle|> Never underestimate a Bob-type Monkemon wearing a freshly ironed necktie!"

gen_daikon "tamer_daisy" "star02" "en-US" \
  $'Language: English\nRegion: United States\nVoice: lively swimmer tamer\nDirection: Playful laugh, splashy challenge.\nEmotion: Playful, bright\nPacing: Fast\nExpressivity: High' \
  "<|laughter|> Squeak squeak! My Rubber Duck Monkemon bounce right over Monster attacks!"

gen_daikon "tamer_rex" "star15" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: disciplined martial arts master\nDirection: Focused shout, honorable martial greeting.\nEmotion: Noble, intense\nPacing: Brisk\nExpressivity: High' \
  "Our Fake Out and Jump combos were perfected in the steaming snow springs! En garde!"

gen_daikon "boss19_titanape" "msm00001" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: deep ancient celestial guardian\nDirection: Thunderous rumbling laugh, majestic booming trial challenge.\nEmotion: Ancient, noble, mighty\nTexture: Deep, resonant\nPitch: Low\nExpressivity: High' \
  "<|laughter|> Guardian Nineteen, Titanape, awakens! Prove your bond before the Throne of Twenty, young Alex!"

gen_daikon "boss20_monkezilla" "star13" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: colossal monster king boss\nDirection: Earth-shaking roar-laugh, dramatic booming kaiju proclamation.\nEmotion: Fierce, theatrical, monumental\nTexture: Deep, gravelly, thunderous\nPitch: Low\nExpressivity: High' \
  "<|laughter|> BEHOLD NUMBER TWENTY—KING MONKEZILLA! Let's see if your Monkeball can tame the Crowned Monster King!"

gen_daikon "narrator_ending" "msm00001" "en-GB" \
  $'Language: English\nRegion: United Kingdom\nVoice: warm storybook narrator\nDirection: Uplifting, proud, heartwarming celebration.\nEmotion: Triumphant, warm, joyful\nPacing: Graceful\nExpressivity: High' \
  "From Alex's House to the Peanut Butter, Fish, Pork, and Beef Houses, Alex and their Monkemon conquered all twenty trials and became Grand Champions of the Archipelago!"
