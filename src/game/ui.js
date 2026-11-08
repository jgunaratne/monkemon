// Monkemon Game UI & Overlay Controller
// Zero CSS `backdrop-filter` over the WebGL canvas (ensures 60 FPS on Steam Deck & headless Chrome).
// Implements:
//   - Title & 7-Type Starter Picker (`ALEX` default)
//   - Overworld Party & Resource HUD + Context Prompt
//   - Sticky-Note Battle Split HUD (`Monk 1` vs `Monk 2`, `Fight / Monkeball / Switch / Run`,
//     and live `[A] Monk Run · [B] Fake Out · [X] Eat · [Y] Jump · [RB] Special` cards)
//   - Sticky-Note 20-Monkemon Board (`#01`–`#18` Perimeter -> `#19 Titanape` -> `#20 King Monkezilla`) + 3D Turntable
//   - 5-Houses Archipelago Fast-Travel Map (`[M]`)
//   - TRELLIS.2 Live 3D `.glb` Monkemon Sanctuary Forge (`[P]`)
//   - Daikon Voice Subtitle Banner + Champion Ending Screen.

import { ELEMENTS, MOVES, TYPE_CHART } from '../data/moves.js';
import { CORE_SPECIES, getAllSpecies, getSpecies, registerForgedSpecies } from '../data/species.js';
import { ZONE_LIST } from '../data/zones.js';
import { resolveMoveElement } from './combat_math.js';

export class UIManager {
  constructor({ renderer, modelBank, audio, input, state, callbacks }) {
    this.renderer = renderer;
    this.modelBank = modelBank;
    this.audio = audio;
    this.input = input;
    this.state = state;
    this.cb = callbacks;

    this.modal = null; // null | 'title' | 'dex' | 'map' | 'forge' | 'ending'
    this.selectedStarter = 'mugchimp';
    this.selectedDexId = 'mugchimp';
    this.toastTimer = null;

    this._bindStaticElements();
  }

  _bindStaticElements() {
    this.elTitle = document.getElementById('title-screen');
    this.elHud = document.getElementById('overworld-hud');
    this.elBattle = document.getElementById('battle-hud');
    this.elModal = document.getElementById('modal-layer');
    this.elVoice = document.getElementById('voice-banner');
    this.elToast = document.getElementById('toast-banner');
    this.elFloats = document.getElementById('float-layer');
    this.elPrompt = document.getElementById('context-prompt');

    // Hook Daikon voice subtitle updates
    this.audio.onVoiceEvent = (ev) => {
      if (!this.elVoice) return;
      if (!ev.active || !ev.line) {
        this.elVoice.classList.add('hidden');
        return;
      }
      this.elVoice.classList.remove('hidden');
      this.elVoice.querySelector('#voice-speaker').textContent = `🎙️ ${ev.speaker}`;
      this.elVoice.querySelector('#voice-line').textContent = `“${ev.line}”`;
    };

    const skipBtn = document.getElementById('voice-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => this.audio.stopVoice());
    }

    // Top-right toolbar buttons
    const bindClick = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bindClick('btn-open-dex', () => this.toggleModal('dex'));
    bindClick('btn-open-map', () => this.toggleModal('map'));
    bindClick('btn-open-forge', () => this.toggleModal('forge'));
    bindClick('btn-toggle-tilt', () => {
      const on = this.renderer.toggleTiltShift();
      this.showToast(`📷 Miniature Tilt-Shift Lens: ${on ? 'ON' : 'OFF'}`);
    });
    bindClick('btn-toggle-mute', () => {
      const muted = this.audio.toggleMute();
      const b = document.getElementById('btn-toggle-mute');
      if (b) b.textContent = muted ? '🔇 Muted [N]' : '🔊 Audio [N]';
    });

    // Battle command deck buttons
    bindClick('bcmd-fight', () => this.cb.onBattleMove(0));
    bindClick('bcmd-ball', () => this.cb.onBattleMonkeball());
    bindClick('bcmd-switch', () => this.cb.onBattleSwitch());
    bindClick('bcmd-run', () => this.cb.onBattleRun());
  }

  showToast(msg, ms = 3100) {
    if (!this.elToast) return;
    this.elToast.textContent = msg;
    this.elToast.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.elToast.classList.add('hidden');
    }, ms);
  }

  spawnFloatingText(x, y, text, color = '#fbbf24') {
    if (!this.elFloats) return;
    const div = document.createElement('div');
    div.className = 'float-popup';
    div.style.left = `${Math.round(x)}px`;
    div.style.top = `${Math.round(y)}px`;
    div.style.color = color;
    div.textContent = text;
    this.elFloats.appendChild(div);
    setTimeout(() => div.remove(), 950);
  }

  // ---------------------------------------------------------------------------
  // 1. TITLE & 7-TYPE STARTER PICKER
  // ---------------------------------------------------------------------------
  openTitleScreen(hasSavedGame = false) {
    this.modal = 'title';
    this.renderer.turntableTargetCanvas = null;
    this.elHud.classList.add('hidden');
    this.elBattle.classList.add('hidden');
    this.elModal.classList.add('hidden');
    this.elTitle.classList.remove('hidden');

    const starters = CORE_SPECIES.filter((s) => s.starter);
    const cardsHtml = starters
      .map((sp) => {
        const el = ELEMENTS[sp.element] || ELEMENTS.mug;
        const sel = sp.id === this.selectedStarter ? 'selected' : '';
        return `
          <button type="button" class="starter-card ${sel}" data-starter="${sp.id}">
            <img src="${sp.concept}" alt="${sp.name}" loading="eager" />
            <div class="starter-num">#${String(sp.dexNum).padStart(2, '0')}</div>
            <div class="starter-name">${sp.name}</div>
            <div class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">
              ${el.icon} ${el.label}
            </div>
          </button>
        `;
      })
      .join('');

    const chosenSp = getSpecies(this.selectedStarter);
    this.elTitle.innerHTML = `
      <div class="title-panel">
        <div class="title-badge-row">
          <span class="pill-chip">2.5D TOY-DIORAMA RPG</span>
          <span class="pill-chip">TRELLIS.2 3D PIPELINE</span>
          <span class="pill-chip">LYRIA 3 + DAIKON VOICE</span>
          <span class="pill-chip">STEAM DECK READY</span>
        </div>
        <h1 class="game-logo">MONKEMON</h1>
        <p class="game-sub">Explore all 5 Houses · Hurl Smiling Monkeballs · Tame #01–#20 King Monkezilla!</p>

        <div class="title-form-row">
          <label for="hero-name-input">HERO TAMER NAME:</label>
          <input id="hero-name-input" type="text" maxlength="12" value="${this.state.playerName || 'ALEX'}" />
        </div>

        <div class="starter-heading">CHOOSE YOUR PARTNER MONKEMON (7 OFFICIAL TYPES):</div>
        <div class="starter-grid">${cardsHtml}</div>
        <div class="starter-bio-bar">
          <strong>${chosenSp.name}</strong> — <em>${chosenSp.title}</em>: ${chosenSp.bio}
        </div>

        <div class="title-cta-row">
          ${
            hasSavedGame
              ? `<button id="btn-continue-save" class="cta-btn cta-secondary">▶ CONTINUE JOURNEY (${this.state.playerName})</button>`
              : ''
          }
          <button id="btn-new-adventure" class="cta-btn cta-primary">🐵 START ADVENTURE [A / ENTER]</button>
        </div>
      </div>
    `;

    for (const card of this.elTitle.querySelectorAll('[data-starter]')) {
      card.addEventListener('click', () => {
        this.selectedStarter = card.getAttribute('data-starter');
        this.audio.playSfx('menu');
        this.openTitleScreen(hasSavedGame);
      });
    }

    const nameInput = this.elTitle.querySelector('#hero-name-input');
    if (nameInput) {
      nameInput.addEventListener('focus', () => { this.input.typing = true; });
      nameInput.addEventListener('blur', () => { this.input.typing = false; });
    }

    const startBtn = this.elTitle.querySelector('#btn-new-adventure');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const rawName = (nameInput && nameInput.value.trim()) || 'ALEX';
        this.input.typing = false;
        this.closeAllModals();
        this.cb.onStartNewGame(rawName, this.selectedStarter);
      });
    }

    const contBtn = this.elTitle.querySelector('#btn-continue-save');
    if (contBtn) {
      contBtn.addEventListener('click', () => {
        this.input.typing = false;
        this.closeAllModals();
        this.cb.onContinueGame();
      });
    }
  }

  closeAllModals() {
    this.modal = null;
    this.input.typing = false;
    this.renderer.turntableTargetCanvas = null;
    this.elTitle.classList.add('hidden');
    this.elModal.classList.add('hidden');
  }

  toggleModal(kind) {
    if (this.modal === kind) {
      this.closeAllModals();
      this.audio.playSfx('menu');
      return;
    }
    this.audio.playSfx('confirm');
    if (kind === 'dex') this.openMonkeBoardModal();
    else if (kind === 'map') this.openWorldMapModal();
    else if (kind === 'forge') this.openForgeModal();
    else if (kind === 'ending') this.openEndingModal();
  }

  // ---------------------------------------------------------------------------
  // 2. STICKY-NOTE 20-MONKEMON BOARD & 3D TURNTABLE MONKEDEX (`[B]`)
  // ---------------------------------------------------------------------------
  openMonkeBoardModal() {
    this.modal = 'dex';
    this.elModal.classList.remove('hidden');

    const allSpecies = getAllSpecies();
    const activePartner = this.state.party[this.state.activeIndex];
    if (!this.selectedDexId && activePartner) {
      this.selectedDexId = activePartner.speciesId;
    }
    const sp = getSpecies(this.selectedDexId);
    const el = ELEMENTS[sp.element] || ELEMENTS.mug;
    const isCaught = this.state.caughtDex.includes(sp.id);
    const isSeen = isCaught || this.state.seenDex.includes(sp.id);

    // Sticky Note 5 Layout: #1-#18 Perimeter Ring + #19 Guardian + #20 Giant Center Boss!
    // Arrange a clean 6x5 board grid where perimeter cells are #01..#18 and center cells hold #19 & #20!
    const perimeterOrder = [
      [1, 2, 3, 4, 5, 6],
      [18, null, 19, 20, null, 7],
      [17, null, null, null, null, 8],
      [16, 15, 14, 13, 12, 9],
    ];
    // Notice 10 & 11 fit cleanly if we use a 6x4 ring:
    // Top row (6): 1, 2, 3, 4, 5, 6
    // Right col (2): 7, 8, 9 -> Bottom row (6): 15, 14, 13, 12, 11, 10 -> Left col: 18, 17, 16!
    // Let's build an exact 6x5 Sticky-Note Perimeter Board so all 1..18 sit continuously clockwise!
    const boardCells = [
      // Row 0 (Top: #01 -> #06)
      { num: 1, r: 1, c: 1 }, { num: 2, r: 1, c: 2 }, { num: 3, r: 1, c: 3 },
      { num: 4, r: 1, c: 4 }, { num: 5, r: 1, c: 5 }, { num: 6, r: 1, c: 6 },
      // Right edge (#07 -> #09)
      { num: 7, r: 2, c: 6 }, { num: 8, r: 3, c: 6 }, { num: 9, r: 4, c: 6 },
      // Bottom row (#10 -> #15 right-to-left)
      { num: 10, r: 5, c: 6 }, { num: 11, r: 5, c: 5 }, { num: 12, r: 5, c: 4 },
      { num: 13, r: 5, c: 3 }, { num: 14, r: 5, c: 2 }, { num: 15, r: 5, c: 1 },
      // Left edge (#16 -> #18 bottom-to-top)
      { num: 16, r: 4, c: 1 }, { num: 17, r: 3, c: 1 }, { num: 18, r: 2, c: 1 },
      // Inner Sanctum (#19 Titanape & Giant Center #20 King Monkezilla!)
      { num: 19, r: 3, c: 2, spanC: 1, spanR: 2, boss19: true },
      { num: 20, r: 2, c: 3, spanC: 3, spanR: 3, boss20: true },
    ];

    const byDex = new Map(allSpecies.map((s) => [s.dexNum, s]));
    const boardTilesHtml = boardCells
      .map((cell) => {
        const entry = byDex.get(cell.num);
        if (!entry) return '';
        const caught = this.state.caughtDex.includes(entry.id);
        const seen = caught || this.state.seenDex.includes(entry.id);
        const elem = ELEMENTS[entry.element] || ELEMENTS.mug;
        const activeCls = entry.id === sp.id ? 'selected' : '';
        const statusCls = caught ? 'caught' : seen ? 'seen' : 'unseen';
        const bossCls = cell.boss20 ? 'tile-boss20' : cell.boss19 ? 'tile-boss19' : '';
        const gridStyle = `grid-row: ${cell.r} / span ${cell.spanR || 1}; grid-column: ${cell.c} / span ${cell.spanC || 1};`;
        return `
          <button type="button" class="board-tile ${activeCls} ${statusCls} ${bossCls}" style="${gridStyle}" data-dex-id="${entry.id}">
            <span class="bt-num">#${String(cell.num).padStart(2, '0')}</span>
            <img src="${entry.concept}" alt="${entry.name}" />
            <span class="bt-name">${entry.name}</span>
            <span class="bt-badge">${caught ? '🐵' : elem.icon}</span>
          </button>
        `;
      })
      .join('');

    // Any extra TRELLIS.2 Forged Monkemon (#21+)
    const forgedList = allSpecies.filter((s) => (s.dexNum || 99) > 20);
    const forgedHtml = forgedList.length
      ? `<div class="forged-strip">
          <span>✨ SANCTUARY FORGED:</span>
          ${forgedList
            .map(
              (f) =>
                `<button type="button" class="pill-btn" data-dex-id="${f.id}">#${f.dexNum} ${f.name}</button>`,
            )
            .join('')}
        </div>`
      : '';

    // Strong against / weak against summary
    const strongVs = Object.entries(TYPE_CHART[sp.element] || {})
      .filter(([, m]) => m > 1.1)
      .map(([k]) => `${ELEMENTS[k]?.icon || ''} ${ELEMENTS[k]?.label || k}`)
      .join(', ') || 'Balanced';

    this.elModal.innerHTML = `
      <div class="modal-card modal-wide">
        <div class="modal-header">
          <div>
            <h2>📋 MONKEMON 20-BOARD & 3D MONKEDEX</h2>
            <p>Caught: <strong>${this.state.caughtDex.length} / ${allSpecies.length}</strong> · Seen: <strong>${this.state.seenDex.length}</strong> · Perimeter #01–#18 → #19 Titanape → #20 King Monkezilla</p>
          </div>
          <button class="close-btn" id="modal-close-btn">✕ Close [Esc]</button>
        </div>

        <div class="dex-layout">
          <div>
            <div class="sticky-board-grid">${boardTilesHtml}</div>
            ${forgedHtml}
          </div>

          <div class="dex-inspector">
            <div class="turntable-wrap">
              <canvas id="dex-turntable-canvas" width="260" height="260"></canvas>
              <div class="tt-caption">LIVE TRELLIS.2 3D MESH</div>
            </div>
            <div class="dex-title-row">
              <span class="dex-num">#${String(sp.dexNum || 21).padStart(2, '0')}</span>
              <h3>${sp.name}</h3>
              <span class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">
                ${el.icon} ${el.label}
              </span>
            </div>
            <div class="dex-subtitle">${sp.title || 'Island Monkemon'} · ${isCaught ? '🐵 CAUGHT' : isSeen ? '👀 SEEN' : '🔎 WILD'}</div>
            <p class="dex-bio">${sp.bio || ''}</p>
            <div class="dex-stats">
              <div><span>HP</span><strong>${sp.baseStats.hp}</strong></div>
              <div><span>ATK</span><strong>${sp.baseStats.atk}</strong></div>
              <div><span>DEF</span><strong>${sp.baseStats.def}</strong></div>
              <div><span>SPD</span><strong>${sp.baseStats.spd}</strong></div>
            </div>
            <div class="dex-matchup"><strong>Super Effective vs:</strong> ${strongVs}</div>
            <div class="dex-moves">
              ${(sp.moves || [])
                .map((mId) => {
                  const m = MOVES[mId];
                  return m ? `<span class="move-chip">${m.slotKey ? `[${m.slotKey}] ` : '[RB] '}${m.name}</span>` : '';
                })
                .join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    this.elModal.querySelector('#modal-close-btn').addEventListener('click', () => this.closeAllModals());
    for (const tile of this.elModal.querySelectorAll('[data-dex-id]')) {
      tile.addEventListener('click', () => {
        this.selectedDexId = tile.getAttribute('data-dex-id');
        this.audio.playSfx('menu');
        this.openMonkeBoardModal();
      });
    }

    // Mount selected Monkemon's real 3D `.glb` into `renderer.turntableMount`!
    const ttCanvas = this.elModal.querySelector('#dex-turntable-canvas');
    this.renderer.turntableTargetCanvas = ttCanvas;
    while (this.renderer.turntableMount.children.length > 0) {
      this.renderer.turntableMount.remove(this.renderer.turntableMount.children[0]);
    }
    const previewActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: 1.35,
      primaryColor: sp.palette?.primary || '#f59e0b',
      secondaryColor: sp.palette?.secondary || '#fef3c7',
      shadowRadius: 0.5,
    });
    this.renderer.turntableMount.add(previewActor.root);
  }

  // ---------------------------------------------------------------------------
  // 3. 5-ZONES & 5-HOUSES ARCHIPELAGO FAST-TRAVEL MAP (`[M]`)
  // ---------------------------------------------------------------------------
  openWorldMapModal() {
    this.modal = 'map';
    this.renderer.turntableTargetCanvas = null;
    this.elModal.classList.remove('hidden');

    const zoneCards = ZONE_LIST.map((z) => {
      const cur = z.id === this.state.zoneId ? 'current' : '';
      const mainHouse = (z.houses && z.houses[0] && z.houses[0].label) || 'Sanctuary';
      return `
        <div class="zone-map-card ${cur}">
          <div class="zm-badge">ZONE ${z.index} · ${mainHouse}</div>
          <h3>${z.name}</h3>
          <p>${z.subtitle}</p>
          <div class="zm-wilds">
            ${(z.wildPool || [])
              .slice(0, 4)
              .map((w) => {
                const s = getSpecies(w.speciesId);
                return `<span class="mini-mon-chip">${s.name}</span>`;
              })
              .join('')}
            ${(z.apexSpawns || []).map((a) => `<span class="mini-mon-chip apex">👑 ${getSpecies(a.speciesId).name}</span>`).join('')}
          </div>
          <button type="button" class="cta-btn cta-primary zm-travel-btn" data-zone="${z.id}">
            ${cur ? '📍 CURRENT ISLAND (Respawn at Plaza)' : `✈️ FAST TRAVEL TO ${mainHouse}`}
          </button>
        </div>
      `;
    }).join('');

    this.elModal.innerHTML = `
      <div class="modal-card modal-wide">
        <div class="modal-header">
          <div>
            <h2>🗺️ ARCHIPELAGO MAP — ALL 5 CONCEPT SPEC HOUSES</h2>
            <p>Badges Earned: <strong>${this.state.badges.length} / 4</strong> · Instant Toy-Glider Fast Travel Unlocked!</p>
          </div>
          <button class="close-btn" id="modal-close-btn">✕ Close [Esc]</button>
        </div>
        <div class="zone-map-grid">${zoneCards}</div>
      </div>
    `;

    this.elModal.querySelector('#modal-close-btn').addEventListener('click', () => this.closeAllModals());
    for (const btn of this.elModal.querySelectorAll('[data-zone]')) {
      btn.addEventListener('click', () => {
        const zId = btn.getAttribute('data-zone');
        this.closeAllModals();
        this.cb.onFastTravel(zId);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. TRELLIS.2 SANCTUARY LIVE 3D `.GLB` MONKEMON FORGE (`[P]`)
  // ---------------------------------------------------------------------------
  openForgeModal() {
    this.modal = 'forge';
    this.renderer.turntableTargetCanvas = null;
    this.elModal.classList.remove('hidden');

    const typeOpts = Object.values(ELEMENTS)
      .map((e) => `<option value="${e.id}">${e.icon} ${e.label}</option>`)
      .join('');

    this.elModal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <h2>⚒️ TRELLIS.2 SANCTUARY 3D MONKEMON FORGE</h2>
            <p>Design a brand-new 3D Monkemon! Synthesizes a glossy toy concept image + real PBR <code>.glb</code> mesh via TRELLIS.2-4B.</p>
          </div>
          <button class="close-btn" id="modal-close-btn">✕ Close [Esc]</button>
        </div>

        <form id="forge-form" class="forge-form">
          <div class="forge-row">
            <label>Monkemon Name</label>
            <input id="forge-name" type="text" maxlength="18" value="Wafflemonk" required />
          </div>
          <div class="forge-row">
            <label>Official Monkemon Type</label>
            <select id="forge-element">${typeOpts}</select>
          </div>
          <div class="forge-row">
            <label>3D Toy Appearance Prompt</label>
            <textarea id="forge-prompt" rows="3">Cute cheerful golden waffle-hat capuchin monkey carrying a tiny maple syrup mug, glossy miniature vinyl figurine</textarea>
          </div>
          <div id="forge-status" class="forge-status">Ready to synthesize via TRELLIS.2 pipeline (~60s on TPU/GPU).</div>
          <div class="forge-actions">
            <button type="submit" class="cta-btn cta-primary" id="forge-submit-btn">✨ FORGE 3D MONKEMON (.GLB)</button>
          </div>
        </form>
      </div>
    `;

    this.elModal.querySelector('#modal-close-btn').addEventListener('click', () => this.closeAllModals());
    const form = this.elModal.querySelector('#forge-form');
    const statusEl = this.elModal.querySelector('#forge-status');
    const submitBtn = this.elModal.querySelector('#forge-submit-btn');

    for (const inp of form.querySelectorAll('input, textarea, select')) {
      inp.addEventListener('focus', () => { this.input.typing = true; });
      inp.addEventListener('blur', () => { this.input.typing = false; });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.querySelector('#forge-name').value.trim() || 'Wafflemonk';
      const element = form.querySelector('#forge-element').value || 'mug';
      const prompt = form.querySelector('#forge-prompt').value.trim();

      submitBtn.disabled = true;
      statusEl.textContent = `Submitting "${name}" to TRELLIS.2 Sanctuary Forge...`;
      try {
        const res = await fetch('/api/forge/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, element, prompt }),
        });
        const data = await res.json();
        const jobId = data.jobId || (data.job && data.job.job_id);
        if (!res.ok || !jobId) {
          statusEl.textContent = `Forge unavailable: ${data.error || res.statusText}`;
          submitBtn.disabled = false;
          return;
        }
        const poll = async () => {
          const stRes = await fetch(`/api/forge/status?id=${encodeURIComponent(jobId)}`);
          const stData = await stRes.json();
          const job =
            (Array.isArray(stData.jobs) && stData.jobs.find((j) => j.job_id === jobId)) || stData;
          statusEl.textContent = `[${(job.status || 'RUNNING').toUpperCase()}] ${job.message || job.step || 'Generating 3D PBR mesh...'}`;
          if ((job.status === 'complete' || job.status === 'done') && job.species) {
            registerForgedSpecies(job.species);
            this.audio.playSfx('catch_fanfare');
            this.cb.onSpawnForgedSpecies(job.species);
            this.closeAllModals();
            return;
          }
          if (job.status === 'failed' || job.status === 'error') {
            submitBtn.disabled = false;
            return;
          }
          setTimeout(poll, 2200);
        };
        setTimeout(poll, 1800);
      } catch (err) {
        statusEl.textContent = `Forge request error: ${err.message}`;
        submitBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 5. CHAMPION VICTORY ENDING MODAL (`#20 KING MONKEZILLA` TAMED / DEFEATED!)
  // ---------------------------------------------------------------------------
  openEndingModal() {
    this.modal = 'ending';
    this.renderer.turntableTargetCanvas = null;
    this.elModal.classList.remove('hidden');
    this.audio.playMusic('ending', true);
    this.audio.playVoice('narrator_ending', {
      speaker: 'ARCHIPELAGO CHRONICLER',
      line: 'Congratulations, Champion Alex! From Alex’s House to King Monkezilla’s Sanctum, every Monkemon celebrates your legendary bond!',
    });

    this.elModal.innerHTML = `
      <div class="modal-card ending-card">
        <div class="pill-chip">🏆 GRAND ARCHIPELAGO CHAMPION 🏆</div>
        <h2>CONGRATULATIONS, ${this.state.playerName}!</h2>
        <p class="ending-lead">
          You journeyed from <strong>Alex House</strong> across the <strong>Peanut Butter House</strong>,
          <strong>Fish House</strong>, <strong>Pork House</strong>, and <strong>Beef House</strong>, and triumphed over
          <strong>Boss #20 — King Monkezilla</strong>!
        </p>
        <div class="ending-party-showcase">
          ${this.state.party
            .map((m) => {
              const sp = getSpecies(m.speciesId);
              return `
                <div class="ending-mon-card">
                  <img src="${sp.concept}" alt="${m.nickname}" />
                  <strong>${m.nickname}</strong>
                  <span>Lv.${m.level}</span>
                </div>
              `;
            })
            .join('')}
        </div>
        <div class="ending-stats-bar">
          <span>MonkeDex Caught: <strong>${this.state.caughtDex.length} / 20</strong></span>
          <span>House Badges: <strong>${this.state.badges.length} / 4</strong></span>
          <span>Coins: <strong>🪙 ${this.state.coins}</strong></span>
        </div>
        <button class="cta-btn cta-primary" id="ending-continue-btn">🌟 KEEP EXPLORING & CATCH ALL 20!</button>
      </div>
    `;

    this.elModal.querySelector('#ending-continue-btn').addEventListener('click', () => {
      this.closeAllModals();
      this.cb.onResumeZoneMusic();
    });
  }

  // ---------------------------------------------------------------------------
  // 6. FRAME-BY-FRAME LIVE HUD SYNC (OVERWORLD & REAL-TIME ARENA BATTLE)
  // ---------------------------------------------------------------------------
  updateHUD({ inBattle, zone, world, battle, onlineCount }) {
    if (this.modal === 'title') return;

    if (inBattle && battle && battle.active) {
      this.elHud.classList.add('hidden');
      this.elBattle.classList.remove('hidden');
      this.elPrompt.classList.add('hidden');
      this._syncBattleHUD(battle);
    } else {
      this.elBattle.classList.add('hidden');
      this.elHud.classList.remove('hidden');
      this._syncOverworldHUD(zone, world, onlineCount);
    }
  }

  _syncOverworldHUD(zone, world, onlineCount) {
    const zTitle = document.getElementById('hud-zone-name');
    const zSub = document.getElementById('hud-zone-sub');
    if (zTitle && zone && zTitle.textContent !== zone.name) zTitle.textContent = zone.name;
    if (zSub && zone && zSub.textContent !== zone.subtitle) zSub.textContent = zone.subtitle;

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    setTxt('hud-balls', String(this.state.monkeballs));
    setTxt('hud-berries', String(this.state.berries));
    setTxt('hud-badges', `${this.state.badges.length}/4`);
    setTxt('hud-dex-count', `${this.state.caughtDex.length}/20`);
    setTxt('hud-online', String(onlineCount || 1));

    // Party Belt
    const partyStrip = document.getElementById('hud-party-strip');
    if (partyStrip) {
      const sig = this.state.party
        .map((m, i) => `${m.uid}:${m.hp}/${m.maxHp}:${m.level}:${i === this.state.activeIndex ? 1 : 0}`)
        .join('|');
      if (partyStrip.dataset.sig !== sig) {
        partyStrip.dataset.sig = sig;
        partyStrip.innerHTML = this.state.party
          .map((m, idx) => {
            const sp = getSpecies(m.speciesId);
            const el = ELEMENTS[sp.element] || ELEMENTS.mug;
            const pct = Math.max(0, Math.min(100, Math.round((m.hp / Math.max(1, m.maxHp)) * 100)));
            const act = idx === this.state.activeIndex ? 'active' : '';
            return `
              <button type="button" class="party-slot ${act}" data-party-idx="${idx}">
                <span class="ps-icon">${el.icon}</span>
                <div class="ps-info">
                  <div class="ps-top"><strong>${m.nickname}</strong><span>Lv.${m.level}</span></div>
                  <div class="hp-track"><div class="hp-fill" style="width:${pct}%"></div></div>
                </div>
              </button>
            `;
          })
          .join('');
        for (const btn of partyStrip.querySelectorAll('[data-party-idx]')) {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-party-idx'), 10);
            this.state.activeIndex = idx;
            this.audio.playSfx('menu');
            world.refreshPartnerActor();
          });
        }
      }
    }

    // Context Interaction Prompt
    if (this.elPrompt) {
      if (world && world.promptText && !this.modal) {
        this.elPrompt.classList.remove('hidden');
        if (this.elPrompt.textContent !== world.promptText) {
          this.elPrompt.textContent = world.promptText;
        }
      } else {
        this.elPrompt.classList.add('hidden');
      }
    }
  }

  _syncBattleHUD(battle) {
    const p = battle.playerUnit;
    const e = battle.enemyUnit;
    if (!p || !e) return;

    const pEl = ELEMENTS[p.species.element] || ELEMENTS.mug;
    const eEl = ELEMENTS[e.species.element] || ELEMENTS.mug;

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };

    setTxt('bf-p-coach', `${this.state.playerName} · MONK 1`);
    setTxt('bf-p-name', `${pEl.icon} ${p.mon.nickname}`);
    setTxt('bf-p-lv', `Lv.${p.mon.level}`);
    setTxt('bf-p-hp-txt', `${p.mon.hp} / ${p.mon.maxHp}`);
    const pPct = Math.max(0, Math.min(100, (p.mon.hp / Math.max(1, p.mon.maxHp)) * 100));
    const pBar = document.getElementById('bf-p-hp-bar');
    if (pBar) {
      pBar.style.width = `${pPct.toFixed(1)}%`;
      pBar.style.background = pPct < 26 ? '#ef4444' : pPct < 55 ? '#f59e0b' : '#22c55e';
    }

    const rivalHeader =
      battle.mode === 'trainer' && battle.trainerDef
        ? `${battle.trainerDef.name.toUpperCase()} · MONK 2 (${battle.enemyTeam.length - battle.enemyIndex} left)`
        : e.mon.isAlpha
          ? '👑 APEX GUARDIAN'
          : '🌿 WILD MONKEMON';
    setTxt('bf-e-coach', rivalHeader);
    setTxt('bf-e-name', `${eEl.icon} ${e.mon.nickname}`);
    setTxt('bf-e-lv', `Lv.${e.mon.level}`);
    setTxt('bf-e-hp-txt', `${e.mon.hp} / ${e.mon.maxHp}`);
    const ePct = Math.max(0, Math.min(100, (e.mon.hp / Math.max(1, e.mon.maxHp)) * 100));
    const eBar = document.getElementById('bf-e-hp-bar');
    if (eBar) {
      eBar.style.width = `${ePct.toFixed(1)}%`;
      eBar.style.background = ePct < 26 ? '#ef4444' : ePct < 55 ? '#f59e0b' : '#22c55e';
    }

    setTxt('battle-banner-txt', battle.bannerText || 'Move with Left Stick / WASD · Cast Moves with [A] [B] [X] [Y] [RB]!');
    setTxt('bcmd-ball-count', `🐵 Monkeball (${this.state.monkeballs}) [LB/C]`);

    // Sync the 5 Real-Time Controller Move Cards ([A], [B], [X], [Y], [RB])
    const moveRow = document.getElementById('battle-moves-row');
    if (moveRow) {
      const slotLabels = [
        { badge: 'A', keyHint: 'Space / 1' },
        { badge: 'B', keyHint: 'K / 2' },
        { badge: 'X', keyHint: 'E / 3' },
        { badge: 'Y', keyHint: 'J / 4' },
        { badge: 'RB', keyHint: 'L / 5' },
      ];
      if (moveRow.dataset.uid !== p.mon.uid) {
        moveRow.dataset.uid = p.mon.uid;
        moveRow.innerHTML = p.mon.moves
          .slice(0, 5)
          .map((mId, idx) => {
            const m = MOVES[mId];
            if (!m) return '';
            const mElem = resolveMoveElement(m, p.species);
            const em = ELEMENTS[mElem] || ELEMENTS.mug;
            const sl = slotLabels[idx] || { badge: 'RB', keyHint: '5' };
            return `
              <button type="button" class="bmove-card" data-mslot="${idx}" style="--mcolor:${em.color}">
                <div class="bm-top">
                  <span class="bm-btn-glyph bm-glyph-${sl.badge.toLowerCase()}">${sl.badge}</span>
                  <span class="bm-type">${em.icon} ${em.label}</span>
                </div>
                <div class="bm-name">${m.name}</div>
                <div class="bm-key">${sl.keyHint}</div>
                <div class="bm-cd-bar" id="bm-cd-${idx}"></div>
              </button>
            `;
          })
          .join('');
        for (const card of moveRow.querySelectorAll('[data-mslot]')) {
          card.addEventListener('click', () => {
            const idx = parseInt(card.getAttribute('data-mslot'), 10);
            this.cb.onBattleMove(idx);
          });
        }
      }

      // Live cooldown progress bars
      p.mon.moves.slice(0, 5).forEach((mId, idx) => {
        const m = MOVES[mId];
        const cdEl = document.getElementById(`bm-cd-${idx}`);
        if (m && cdEl) {
          const rem = p.cooldowns[mId] || 0;
          const pct = rem > 0 ? Math.min(100, (rem / (m.cooldown || 1)) * 100) : 0;
          cdEl.style.width = `${pct.toFixed(1)}%`;
        }
      });
    }
  }
}
