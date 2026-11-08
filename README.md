# Monkemon — 2.5D Toy-Diorama Creature-Taming & Real-Time Arena RPG

**Monkemon** is a browser-based and Steam Deck-ready **2.5D miniature toy-diorama creature-taming and real-time arena battle RPG** powered by the **TRELLIS.2-4B 3D asset pipeline**, **Lyria 3** full-length music, and **Daikon TTS** voice acting.

Step into the shoes of **Alex**, pick your partner Monkemon from the **7 official Monkemon Types**, explore **5 interconnected miniature island zones**, visit all **5 Concept-Spec Houses**, catch roaming wild Monkemon `#01`–`#18` with smiling **Monkeballs**, earn all 4 House Badges, and challenge **Guardian `#19` Titanape** and **Apex Boss `#20` King Monkezilla**!

---

## Core Features

- **32 Real TRELLIS.2-4B PBR 3D `.glb` Assets (`assets/models/*.glb`)**:
  - **All 20 Numbered Monkemon (`#01`–`#20`)**: `Mugchimp`, `Puppuchin`, `Mooboon`, `Duckaque`, `Plushaki`, `Mossaki`, `Lemuripple`, `Bobmonk`, `Voltamarin`, `Chimpark`, `Geartail`, `Frostgibbon`, `Senseibob`, `Bamboon`, `Proboscrown`, `Mysticlangur`, `Howlshade`, `Pyrodril`, `Titanape` (`#19`), and `King Monkezilla` (`#20`).
  - **5 Named Archipelago Houses**: `Alex House`, `Peanut Butter House`, `Fish House`, `Pork House`, and `Beef House`, plus `Healing Pavilions` and `Golden Banana Shrines`.
  - **Smiling Monkey-Face `Monkeball` (`monkeball.glb`)** + Tamer, Scout, and House Leader 3D figurines.
- **Glossy 2.5D Miniature Toy-Diorama Engine (Three.js `0.170.0`, 100% Vendored Offline)**:
  - Elevated 2.5D tabletop island perspective (`FOV 30°`) with studio `RoomEnvironment` PBR bounce reflections, soft sun shadows, instanced grass tufts, glistening animated water/hot-springs/magma, and a toggleable **Tilt-Shift Miniature Lens (`[G]` / `L3`)**.
- **7 Official Monkemon Types**:
  - `Mug` ☕ · `Monster` 👹 · `Dog` 🐶 · `Rubber Duck` 🦆 · `Stuffie` 🧸 · `Bob` 😎 · `Cow` 🐮
- **Dual Gameplay Loop**:
  1. **Overworld Exploration & Timing-Ring Catching**: Roam alongside your following Partner Monkemon, toss Peanut-Butter Berries (`[X]` / `E`) to pacify wild creatures, and press `[Y]` / `F` to aim a **shrinking target timing ring (`NICE! / GREAT! / EXCELLENT!`)** before hurling a 3D `Monkeball`!
  2. **Real-Time Circular Holo-Arena Battles (`Alex + Monk 1` vs `Trainer + Monk 2`)**: Move freely around the holo-court to dodge telegraphed ground AoE rings and projectiles while chaining real-time controller face-button moves:
     - **`[A]` / `Space` / `1` — Monk Run**: High-speed dash strike with brief invulnerability frames.
     - **`[B]` / `K` / `2` — Fake Out**: Cheeky clap shockwave that interrupts enemy casts and stuns (`1.25s`).
     - **`[X]` / `E` / `3` — Eat**: Chomps a Peanut-Butter Banana snack (`+26% HP` + Attack Up buff) + bite shockwave.
     - **`[Y]` / `J` / `4` — Jump**: Vaults sky-high over ground hazards and slams down with a Type shockwave.
     - **`[RB]` / `L` / `5` — Signature Type Special**: Unique elemental ultimate per species (`Cocoa Splash`, `Puppy Zoomies`, `Cowbell Quake`, `Duckie Splash`, `Stuffie Hug-Burst`, `Bob Briefcase Toss`, `Monster Roar`, etc.).
     - **`[LB]` / `C` — Mid-Battle Monkeball Capture** (on weakened wild & Alpha `#19`/`#20` Bosses) · **`[LT]` / `Q` — Live Party Switch**.
- **20-Monkemon Progression Board & Live 3D Turntable (`[B]`)**:
  - Inspect the perimeter `#01`–`#18` loop leading into `#19 Titanape` and center `#20 King Monkezilla`, complete with a live rotating 3D `.glb` turntable!
- **Live In-Game TRELLIS.2 Sanctuary 3D Forge (`[P]`)**:
  - Synthesize brand-new custom PBR `.glb` Monkemon directly inside the game via `tools/trellis_forge_server.py`.
- **Lyria 3 Soundtrack & Daikon TTS Voices**:
  - 11 full-length crossfaded **Lyria 3** tracks (`assets/music/*.mp3`) and **Daikon TTS** character/House Leader/Boss voice clips (`assets/voice/*.mp3`) routed through stereo room acoustics with automatic `0.36×` music ducking.
- **WebSocket Archipelago Multiplayer (`/ws`)**:
  - Zero-dependency Node HTTP + RFC 6455 WebSocket server (`server.mjs`) renders online Tamers and their following Partner Monkemon across all 5 zones in real time.

---

## Quick Start

```bash
# Start HTTP + WebSocket multiplayer (:8731) and TRELLIS.2 Sanctuary Forge (:8732)
./serve.sh
```

Then open:
- **Desktop / Cloudtop Proxy**: `http://<hostname>:8731/`
- **Steam Deck Kiosk (`1280×800`, Gamepad Mode)**: `http://127.0.0.1:8731/?touch=0` (see [`STEAMDECK_SETUP.md`](./STEAMDECK_SETUP.md) for the full local NVMe SSD edge-cache & Gaming Mode Home installer!)

---

## Controls Reference (Steam Deck Gamepad & Keyboard)

| Action | Steam Deck / Gamepad | Keyboard / Mouse |
| :--- | :--- | :--- |
| **Move (Overworld & Arena)** | Left Stick / D-Pad | `WASD` or Arrow Keys |
| **Talk / Heal / `[A] Monk Run`** | `A` (Bottom Face) | `Space` / `Enter` / `1` |
| **Sprint / `[B] Fake Out` (Stun)** | `B` (Right Face) | `Shift` (Sprint) / `K` / `2` |
| **Toss Berry / `[X] Eat` (Heal+Buff)** | `X` (Left Face) | `E` / `3` |
| **Aim Monkeball / `[Y] Jump` (Slam)** | `Y` (Top Face) | `F` or `J` / `4` |
| **Engage Battle / `[RB] Type Special`** | `RB` or `RT` | `L` / `5` |
| **Quick Throw Monkeball** | `LB` | `C` or Right-Click |
| **Switch Active Party Monkemon** | `LT` | `Q` or `R` |
| **20-Monkemon Board & 3D Dex** | `Menu / Start` | `B` or `Tab` |
| **5-Houses Archipelago Fast-Travel Map** | `View / Select` | `M` |
| **TRELLIS.2 Sanctuary 3D Forge** | Click `⚒️ 3D Forge` | `P` |
| **Toggle Tilt-Shift Miniature Lens** | `L3` (Left Stick Click) | `G` |
| **Mute / Unmute Audio** | `R3` (Right Stick Click) | `N` |

---

## Verification & Asset Regeneration Scripts

```bash
npm run check          # Syntax-check server.mjs, all ES modules, and trellis_forge_server.py
npm test               # Run pure combat/capture/save/asset unit tests
npm run smoke          # Headless Chrome WebGL smoke test across all 13 game scenes
bash tools/generate_3d_assets.sh   # Regenerate .glb meshes via TRELLIS.2 pipeline
bash tools/generate_music.sh       # Regenerate Lyria 3 music tracks
bash tools/generate_voices.sh      # Regenerate Daikon TTS voice clips
```
