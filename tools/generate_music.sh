#!/usr/bin/env bash
# Generates full-length Lyria 3 music tracks for Monkemon's 5 diorama zones,
# title screen, real-time trainer battles, warden duels, and victory fanfare.
set -u
G=/google/bin/releases/gemini-agents-generate/generate
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/assets/music"
mkdir -p "${OUT_DIR}"

STYLE="Full-length instrumental video game music (about two minutes, with a memorable intro, joyful main melody, contrasting bridge and seamless loopable return) for a charming miniature toy-diorama island creature-taming adventure game, acoustic orchestral chamber instruments blended with bright marimba, woodwinds, pizzicato strings, warm French horns and crisp percussion. No vocals, no lyrics, instrumental only."

gen() {
  local name="$1"; shift
  if [ -s "${OUT_DIR}/${name}.mp3" ]; then echo "= ${name} exists"; return; fi
  local tmp="/tmp/monkemon_song_${name}.mp3"
  if [ ! -s "${tmp}" ]; then
    "$G" -prod -timeout=600s -output="${tmp}" music -model=lyria-3-full-song-mp3 "$* ${STYLE}" 2>&1 | grep -E "Successfully|rror|denied" | tail -2 || true
  fi
  if [ -s "${tmp}" ]; then
    cp "${tmp}" "${OUT_DIR}/${name}.mp3"
    chmod 644 "${OUT_DIR}/${name}.mp3"
    echo "+ wrote ${OUT_DIR}/${name}.mp3"
  fi
}

gen title "Title screen theme for a sunny miniature island creature-taming adventure: warm uplifting orchestral overture in F major at 116 BPM, sparkling celesta and wooden marimba arpeggios, expressive solo flute and oboe melody, lush pizzicato and arco strings, gentle ocean-breeze harp glissandos, building to a heroic French horn statement of the island adventure theme."
gen sunpalm "Zone 1 Sunpalm Cove theme: breezy joyful tropical seaside village music in G major at 122 BPM, bouncy wooden marimba and steel-pan accents, cheerful clarinet and flute duet, plucked acoustic guitar and upright bass, light shaker and conga groove, sunny carefree exploration."
gen canopy "Zone 2 Emerald Canopy Woods theme: whimsical enchanted bamboo forest adventure in D major shifting to E minor phrases at 126 BPM, playful bassoon and piccolo call-and-response, wooden xylophone and kalimba ostinatos, lush warm string harmonies, mysterious dappled sunlight mood."
gen sparkstone "Zone 3 Sparkstone Plaza and Clockwork Promenade theme: lively bustling cobblestone lantern town square in C major at 132 BPM, crisp ticking clockwork woodblocks,accordion and bright brass quintet, nimble pizzicato violin melody, jazzy walking bassline, energetic and charming."
gen frostpeak "Zone 4 Frostpeak Hot-Springs theme: serene yet adventurous snowy alpine mountain sanctuary in A major at 114 BPM, crystalline glockenspiel and celesta chimes, warm lyrical cello and French horn melody evoking steaming hot springs in crisp winter air, gentle sleigh-like percussion and harp."
gen cinderpeak "Zone 5 Cinderpeak Temple and Solar Sanctum theme: grand ancient volcanic summit temple march in D minor at 138 BPM, resonant taiko and orchestral timpani, dramatic brass fanfares, urgent staccato strings, exotic bamboo flute flourishes, epic ascent toward the final sanctuary."
gen battle "Trainer and wild creature arena battle theme: exciting upbeat tactical arena battle music in A minor shifting to heroic C major chorus at 158 BPM, driving orchestral snare and timpani, nimble staccato strings, punchy brass stabs, rapid xylophone and synth-lead counter-melodies, energetic, competitive and fun."
gen warden "Zone Warden and Grand Champion boss battle theme: high-stakes symphonic championship duel in E minor at 168 BPM, blazing orchestral brass fanfares, relentless spiccato string ostinatos, thunderous timpani, sparkling piano and marimba runs, triumphant heroic bridge, pure exhilarating championship energy."
gen victory "Battle victory and creature capture celebration fanfare: bright jubilant orchestral fanfare in G major at 136 BPM, opening immediately on beat one with triumphant trumpets and horns, sparkling harp and glockenspiel flourishes, bouncy celebratory strings and crisp snare rolls."
gen monkezilla "Final Boss Number Twenty King Monkezilla championship battle theme: colossal epic symphonic orchestral kaiju boss music in C minor shifting to heroic C major chorus at 172 BPM, thunderous taiko and orchestral timpani, blazing French horn and trombone fanfares, furious spiccato violin ostinatos, sparkling xylophone runs, exhilarating climactic finale."
gen ending "Ending celebration credits theme for completing the Monkemon Archipelago: heartwarming joyful sunlit island orchestra in F major at 108 BPM, expressive solo flute and piano, warm lush strings, cheerful marimba and celesta chimes, building to a grand celebratory brass horizon."
