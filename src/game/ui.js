// Monkemon Game UI, Turn-Based Battle Command Deck, Live Mini-Map & Tamer Menu Hub!
// Zero CSS `backdrop-filter` over the WebGL canvas (ensures smooth 60 FPS on Steam Deck & headless Chrome).
// Implements:
//   1. Title & 7-Type Starter Picker (`ALEX` default)
//   2. Overworld HUD: labelled resource bar, Menu / Squad / MonkeDex / Map buttons with key caps,
//      Hero + Partner HP Plaque, 6-Slot Party Strip, Live Mini-Map and a two-row controls legend
//   3. Turn-Based Command-Menu Battle HUD (`ATTACK` / `SPECIAL` / `CATCH or HEAL` / `RUN`) + HP Cards
//   4. Tamer Menu Hub (`[Tab / Start]`): Menu home + 5 screens, one header (title · tabs · Close),
//      one footer legend, and a shared spatial D-pad / arrow-key cursor across every screen:
//        • `☰ Menu`     overview tiles, Save & settings (sound, lens, return to title), How to play
//        • `🐾 Squad`    Active squad 1–6 + Storage box + 3D view + Make lead / Feed Berry / Swap
//        • `📖 MonkeDex` All / Caught / Seen, List & Progress board, habitat + type matchups
//        • `🎒 Bag`      Your items (with how-to-use), Feed a Berry, Shop, Story progress
//        • `🗺️ Map`      Illustrated SVG atlas of all realms + Fast travel
//        • `⚒️ 3D Forge` Live TRELLIS.2-4B `.glb` custom Monkemon creator
//      Every shortcut is rendered via `keyLabel()` so keyboard and gamepad players each see their
//      own buttons; key caps are hidden entirely in touch mode.
//   5. Daikon Voice Subtitle Banner + Grand Champion Ending Screen.

import { INTERIOR_MAPS } from '../data/interior_maps.js';
import { ELEMENTS, MOVES, TYPE_CHART } from '../data/moves.js';
import { CORE_SPECIES, getAllSpecies, getSpecies, registerForgedSpecies } from '../data/species.js';
import {
  KEY_ITEMS_META,
  TOTAL_BANANA_RELICS,
  getActiveStoryChapter,
  getGuestCompanion,
  getZoneRelicStatus,
} from '../data/storyline.js';
import { ZONES, ZONE_LIST } from '../data/zones.js';
import { computeCoastRadiusNorm } from '../engine/shaders.js';
import { getBattleMoves } from './battle.js';
import { expRequiredForLevel, getTypeMultiplier, resolveMoveElement } from './combat_math.js';
import {
  SHOP_CATALOG,
  buyShopItem,
  saveGameToStorage,
  setLeadPartyIndex,
  swapPartyWithStorage,
  useBerryOnPartyMon,
} from './save_store.js';

// Menu screens, in tab order. `home` is the landing screen opened by Menu / Start / Tab;
// the direct shortcuts (V / B / M / P) jump straight to their screen.
const HUB_TABS = [
  { id: 'home', icon: '☰', label: 'Menu', desc: 'Overview, save and settings' },
  { id: 'party', icon: '🐾', label: 'Squad', desc: 'Heal, reorder and inspect your team' },
  { id: 'dex', icon: '📖', label: 'MonkeDex', desc: 'All 20 Monkemon and where they live' },
  { id: 'bag', icon: '🎒', label: 'Bag', desc: 'Items, shop and story progress' },
  { id: 'map', icon: '🗺️', label: 'Map', desc: 'World map and fast travel' },
  { id: 'forge', icon: '⚒️', label: '3D Forge', desc: 'Create a custom Monkemon' },
];

// One label per action for each input mode. Every shortcut shown anywhere in the UI goes
// through `keyLabel()` so keyboard players never see gamepad glyphs and vice versa.
const KEY_LABELS = {
  confirm: { keyboard: 'Enter', gamepad: 'A' },
  back: { keyboard: 'Esc', gamepad: 'B' },
  menu: { keyboard: 'Tab', gamepad: 'Start' },
  party: { keyboard: 'V', gamepad: '' },
  dex: { keyboard: 'B', gamepad: '' },
  map: { keyboard: 'M', gamepad: 'Select' },
  forge: { keyboard: 'P', gamepad: '' },
  tabPrev: { keyboard: '[', gamepad: 'LB' },
  tabNext: { keyboard: ']', gamepad: 'RB' },
  nav: { keyboard: '↑↓←→', gamepad: 'D-pad' },
  move: { keyboard: 'WASD', gamepad: 'Stick' },
  throw: { keyboard: 'F', gamepad: 'Y' },
  berry: { keyboard: 'E', gamepad: 'X' },
  sprint: { keyboard: 'Shift', gamepad: 'B' },
  swap: { keyboard: 'Q', gamepad: 'LT' },
  berryBattle: { keyboard: 'C', gamepad: 'LB' },
  mute: { keyboard: 'N', gamepad: 'R3' },
  tilt: { keyboard: 'G', gamepad: 'L3' },
  slot1: { keyboard: '1', gamepad: 'A' },
  slot2: { keyboard: '2', gamepad: 'X' },
  slot3: { keyboard: '3', gamepad: 'Y' },
  slot4: { keyboard: '4', gamepad: 'B' },
};

// Everything the menu cursor can land on. SVG map islands are included (they have no `.click()`),
// so activation goes through `_activateEl()` which dispatches a real click event.
const NAV_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [data-atlas-zone]';

// Cards that are "selected" just by moving the cursor onto them (one key press per item).
const AUTO_SELECT_SELECTOR = '[data-dex-id], [data-col-loc], [data-atlas-zone]';

// Scroll containers whose position is preserved across same-screen re-renders.
const SCROLL_MEMO_SELECTORS = ['.hub-body', '.dex-encyclo-grid', '.storage-box-grid'];

// UI preferences live outside the save file so they apply to every save slot.
const HUD_PREF_KEY = 'monkemon.ui.hud';
// Read by the renderer at boot (see engine/renderer.js); 'auto' means "remove the key".
const GFX_PREF_KEY = 'monkemon.gfx';
const GFX_TIERS = ['auto', 'low', 'mobile', 'medium', 'high', 'ultra'];

function readUiPref(key, fallback) {
  try {
    const v = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeUiPref(key, value) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable (private mode) — preference just won't persist */
  }
}

export class UIManager {
  constructor({ renderer, modelBank, audio, input, state, callbacks }) {
    this.renderer = renderer;
    this.modelBank = modelBank;
    this.audio = audio;
    this.input = input;
    this.state = state;
    this.cb = callbacks;

    this.modal = null; // null | 'title' | 'home' | 'party' | 'dex' | 'bag' | 'map' | 'forge' | 'ending'
    this.selectedStarter = 'mugchimp';

    // Squad screen state
    this.selectedCollectionRef = { location: 'party', index: 0 };

    // MonkeDex screen state
    this.selectedDexId = 'mugchimp';
    this.dexFilter = 'all'; // 'all' | 'caught' | 'seen'
    this.dexViewMode = 'grid'; // 'grid' | 'board'

    // Map screen state
    this.selectedMapZoneId = 'sunpalm';

    // Shared D-pad / arrow-key cursor inside menus (survives re-renders via a stable key)
    this.navFocusKey = null;
    this.confirmReturnToTitle = false;

    // Overworld HUD: 'minimal' (just a menu chip — the default) or 'full' (map, resources, squad…)
    this.hudMode = readUiPref(HUD_PREF_KEY, 'minimal') === 'full' ? 'full' : 'minimal';

    this.toastTimer = null;
    this._habitatCache = null;
    this._hudKeyMode = null;

    this._bindStaticElements();
  }

  // ---------------------------------------------------------------------------
  // KEY HINT HELPERS (keyboard vs. gamepad labels)
  // ---------------------------------------------------------------------------
  inputMode() {
    const m = this.input && this.input.mode;
    return m === 'gamepad' || m === 'touch' ? m : 'keyboard';
  }

  keyLabel(action) {
    const def = KEY_LABELS[action];
    if (!def) return '';
    const mode = this.inputMode();
    return mode === 'gamepad' || mode === 'touch' ? def.gamepad : def.keyboard;
  }

  // `<kbd>` cap for templates; renders nothing if the action has no binding in this mode.
  kbd(action) {
    const label = this.keyLabel(action);
    return label ? `<kbd class="key" data-key="${action}">${label}</kbd>` : '';
  }

  _syncKeyCaps(root) {
    if (!root) return;
    for (const el of root.querySelectorAll('kbd.key[data-key]')) {
      const label = this.keyLabel(el.getAttribute('data-key'));
      if (el.textContent !== label) el.textContent = label;
      el.classList.toggle('hidden-key', !label);
    }
  }

  // Static HUD / battle markup is written for keyboard; relabel it whenever the input mode flips.
  _syncInputModeCaps() {
    const mode = this.inputMode();
    if (this._hudKeyMode === mode) return;
    this._hudKeyMode = mode;
    document.body.dataset.inputMode = mode;
    this._syncKeyCaps(this.elHud);
    this._syncKeyCaps(this.elBattle);
  }

  _bindStaticElements() {
    this.elTitle = document.getElementById('title-screen');
    this.elHud = document.getElementById('overworld-hud');
    this.elBattle = document.getElementById('battle-hud');
    this.elModal = document.getElementById('modal-layer');
    this.elStory = document.getElementById('story-dialogue-overlay');
    this.elVoice = document.getElementById('voice-banner');
    this.elToast = document.getElementById('toast-banner');
    this.elFloats = document.getElementById('float-layer');
    this.elPrompt = document.getElementById('context-prompt');
    this.minimapCanvas = document.getElementById('hud-minimap-canvas');

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

    const bindClick = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    bindClick('hud-minimap-btn', () => this.toggleMenuHub('map'));
    bindClick('hud-partner-card', () => this.toggleMenuHub('party'));
    bindClick('btn-open-menu', () => this.toggleMenuHub('home'));
    bindClick('hud-menu-chip', () => this.toggleMenuHub('home'));
    bindClick('btn-open-party', () => this.toggleMenuHub('party'));
    bindClick('btn-open-dex', () => this.toggleMenuHub('dex'));
    bindClick('btn-open-map', () => this.toggleMenuHub('map'));
    bindClick('btn-toggle-mute', () => {
      this.audio.toggleMute();
      this._syncMuteButton();
    });

    // Inside menus the focus cursor follows the mouse, so hover and D-pad share one highlight —
    // but only when the pointer genuinely moved (see `_pointerMovedRecently`).
    window.addEventListener(
      'pointermove',
      (ev) => {
        const lp = this._lastPointer;
        if (!lp || Math.abs(ev.clientX - lp.x) > 1.5 || Math.abs(ev.clientY - lp.y) > 1.5) {
          this._lastPointer = { x: ev.clientX, y: ev.clientY, t: performance.now() };
        }
      },
      { passive: true },
    );
    if (this.elModal) {
      this.elModal.addEventListener('pointerover', (ev) => {
        if (!this._pointerMovedRecently()) return;
        const target = ev.target && ev.target.closest ? ev.target.closest(NAV_SELECTOR) : null;
        if (target && this.elModal.contains(target)) this._setNavFocus(target, { scroll: false });
      });
      // Esc inside a text field just leaves the field (the game's Esc handler is paused while typing).
      this.elModal.addEventListener('keydown', (ev) => {
        const tag = ev.target && ev.target.tagName;
        if (ev.key === 'Escape' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) {
          ev.target.blur();
          ev.stopPropagation();
        }
      });
    }
  }

  _syncMuteButton() {
    const b = document.getElementById('btn-toggle-mute');
    if (!b) return;
    const txt = this.audio.muted ? '🔇' : '🔊';
    if (b.textContent !== txt) b.textContent = txt;
    const tip = this.audio.muted
      ? `Sound is off — turn on (${this.keyLabel('mute')})`
      : `Sound is on — mute (${this.keyLabel('mute')})`;
    if (b.title !== tip) b.title = tip;
  }

  // True only if the mouse / trackpad moved within the last ~250 ms. `pointerover` also fires when
  // the page re-renders or re-flows under a resting pointer; those must not move the cursor.
  _pointerMovedRecently() {
    const lp = this._lastPointer;
    return Boolean(lp) && performance.now() - lp.t < 250;
  }

  showToast(msg, ms = 3200) {
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

  _getSpeciesHabitats(speciesId) {
    if (!this._habitatCache) {
      this._habitatCache = new Map();
      for (const z of ZONE_LIST) {
        for (const w of z.wildPool || []) {
          if (!this._habitatCache.has(w.speciesId)) this._habitatCache.set(w.speciesId, []);
          const arr = this._habitatCache.get(w.speciesId);
          if (!arr.includes(z.name)) arr.push(z.name);
        }
        for (const ap of z.apexSpawns || []) {
          if (!this._habitatCache.has(ap.speciesId)) this._habitatCache.set(ap.speciesId, []);
          const arr = this._habitatCache.get(ap.speciesId);
          const tag = `${z.name} (Apex)`;
          if (!arr.includes(tag)) arr.push(tag);
        }
      }
      for (const spec of Object.values(INTERIOR_MAPS)) {
        for (const ws of spec.wildSpawns || []) {
          if (!this._habitatCache.has(ws.speciesId)) this._habitatCache.set(ws.speciesId, []);
          const arr = this._habitatCache.get(ws.speciesId);
          const tag = ws.isFinalBoss ? `${spec.title} (Boss #20)` : spec.title;
          if (!arr.includes(tag)) arr.push(tag);
        }
      }
    }
    const list = this._habitatCache.get(speciesId);
    return list && list.length ? list.join(' · ') : 'Sanctuary 3D Forge / Special Partner';
  }

  _mountTurntableSpecies(sp, isSilhouetted = false) {
    const ttCanvas = this.elModal ? this.elModal.querySelector('#dex-turntable-canvas') : null;
    if (!ttCanvas || !sp) {
      this.renderer.turntableTargetCanvas = null;
      return;
    }
    this.renderer.turntableTargetCanvas = ttCanvas;
    while (this.renderer.turntableMount.children.length > 0) {
      this.renderer.turntableMount.remove(this.renderer.turntableMount.children[0]);
    }
    const previewActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: 1.35,
      primaryColor: isSilhouetted ? '#0f172a' : sp.palette?.primary || '#f59e0b',
      secondaryColor: isSilhouetted ? '#1e293b' : sp.palette?.secondary || '#fef3c7',
      shadowRadius: 0.5,
    });
    if (isSilhouetted) {
      previewActor.root.traverse((c) => {
        if (c.isMesh && c.material) {
          c.material = c.material.clone();
          if (c.material.color) c.material.color.set('#09111e');
          if (c.material.emissive) c.material.emissive.set('#0f172a');
        }
      });
    }
    this.renderer.turntableMount.add(previewActor.root);
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
          <span class="pill-chip">🏝️ EXPLORE 10 REALMS</span>
          <span class="pill-chip">🐵 CATCH ALL 20 MONKEMON</span>
          <span class="pill-chip">⚔️ TURN-BASED BATTLES</span>
          <span class="pill-chip">🎮 KEYBOARD · GAMEPAD · STEAM DECK</span>
        </div>
        <h1 class="game-logo">MONKEMON</h1>
        <p class="game-sub">Explore 10 Extensive Multi-Biome Worlds · 46 Walkable Towns, Grottos &amp; Dungeons · Collect 77 Golden Relics &amp; All 20 Monkemon!</p>

        <div class="title-form-row">
          <label for="hero-name-input">Your name:</label>
          <input id="hero-name-input" type="text" maxlength="12" value="${this.state.playerName || 'ALEX'}" />
        </div>

        <div class="starter-heading">CHOOSE YOUR PARTNER ${this.kbd('nav')}</div>
        <div class="starter-grid">${cardsHtml}</div>
        <div class="starter-bio-bar">
          <strong>${chosenSp.name}</strong> — <em>${chosenSp.title}</em>: ${chosenSp.bio}
        </div>

        <div class="title-cta-row">
          ${
            hasSavedGame
              ? `<button id="btn-continue-save" class="cta-btn cta-secondary">▶ Continue as ${this.state.playerName} ${this.kbd('confirm')}</button>`
              : ''
          }
          <button id="btn-new-adventure" class="cta-btn cta-primary">🐵 ${hasSavedGame ? 'New adventure' : 'Start adventure'} ${hasSavedGame ? '' : this.kbd('confirm')}</button>
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
    this.activeStory = null;
    this.input.typing = false;
    this.confirmReturnToTitle = false;
    this.renderer.turntableTargetCanvas = null;
    this.elTitle.classList.add('hidden');
    this.elModal.classList.add('hidden');
    if (this.elStory) this.elStory.classList.add('hidden');
  }

  openStoryDialogue(scene, { choices = null, onChoice = null, onComplete = null } = {}) {
    if (!scene || !Array.isArray(scene.pages) || scene.pages.length === 0 || !this.elStory) {
      if (onComplete) onComplete();
      return;
    }
    this.elTitle.classList.add('hidden');
    this.elModal.classList.add('hidden');
    this.modal = 'story';
    this.activeStory = {
      scene,
      pageIdx: 0,
      choiceIdx: 0,
      choices: Array.isArray(choices) && choices.length ? choices : null,
      onChoice,
      onComplete,
    };
    this.elStory.classList.remove('hidden');
    this.audio.playSfx('confirm');
    this._renderStoryPage();
  }

  _renderStoryPage() {
    const st = this.activeStory;
    if (!st || !this.elStory) return;
    const pages = st.scene.pages;
    const isLast = st.pageIdx >= pages.length - 1;
    const p = pages[st.pageIdx];
    const showChoices = isLast && st.choices && st.choices.length > 0;

    const choicesHtml = showChoices
      ? `<div class="story-choices">${st.choices
          .map(
            (c, idx) => `
          <button type="button" class="story-choice-btn ${idx === st.choiceIdx ? 'focused' : ''}" data-story-choice="${idx}" ${c.disabled ? 'disabled style="opacity:0.55;cursor:not-allowed;"' : ''}>
            <span>${c.label}</span>
            <span style="color:#fde047;font-size:16px;">${c.tag || ''}</span>
          </button>`,
          )
          .join('')}</div>`
      : '';

    this.elStory.innerHTML = `
      <div class="story-box">
        <div class="story-box-top">
          <span class="story-chapter-pill">${st.scene.chapterTag || 'STORY EVENT'}</span>
          <span class="story-title">${st.scene.title || ''}</span>
          <span style="font-size:15px;color:#94a3b8;font-weight:800;">Beat ${st.pageIdx + 1} / ${pages.length}</span>
        </div>
        <div class="story-speaker-row">
          <div class="story-speaker-avatar">${p.icon || '💬'}</div>
          <div>
            <div class="story-speaker-name">${p.speaker || 'NARRATOR'}</div>
            <div class="story-speaker-role">${p.role || ''}</div>
          </div>
        </div>
        <div class="story-body-text">${p.text || ''}</div>
        ${choicesHtml}
        <div class="story-footer">
          <button type="button" class="mini-action-btn" id="story-skip-btn">Skip ${this.kbd('back')}</button>
          ${
            showChoices
              ? `<span style="font-size:16px;color:#bae6fd;font-weight:700;">Choose an option above ${this.kbd('nav')} · ${this.kbd('confirm')}</span>`
              : `<button type="button" class="cta-btn cta-primary" style="padding:7px 18px;font-size:18px;" id="story-next-btn">${isLast ? 'Continue' : 'Next'} ${this.kbd('confirm')}</button>`
          }
        </div>
      </div>
    `;

    const finishStory = () => {
      const done = st.onComplete;
      this.closeAllModals();
      if (done) done();
    };

    const skipBtn = this.elStory.querySelector('#story-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.audio.playSfx('cancel');
        finishStory();
      });
    }

    const nextBtn = this.elStory.querySelector('#story-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (!isLast) {
          st.pageIdx += 1;
          this.audio.playSfx('menu');
          this._renderStoryPage();
        } else {
          this.audio.playSfx('confirm');
          finishStory();
        }
      });
    }

    for (const cBtn of this.elStory.querySelectorAll('[data-story-choice]')) {
      cBtn.addEventListener('click', () => {
        const idx = parseInt(cBtn.getAttribute('data-story-choice'), 10);
        const picked = st.choices && st.choices[idx];
        if (!picked || picked.disabled) {
          this.audio.playSfx('cancel');
          return;
        }
        const cbChoice = st.onChoice;
        const done = st.onComplete;
        this.audio.playSfx('confirm');
        this.closeAllModals();
        if (cbChoice) cbChoice(picked);
        if (done) done();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. TAMER MENU HUB (`home` | `party` | `dex` | `bag` | `map` | `forge`)
  // ---------------------------------------------------------------------------
  toggleModal(kind) {
    this.toggleMenuHub(kind);
  }

  toggleMenuHub(tab = 'home', opts = {}) {
    if (tab === 'ending') {
      this.openEndingModal();
      return;
    }
    if (this.modal === tab) {
      this.closeAllModals();
      this.audio.playSfx('cancel');
      return;
    }
    this.audio.playSfx('confirm');
    this.openMenuHub(tab, opts);
  }

  openMonkeBoardModal(opts = {}) {
    if (opts.board) this.dexViewMode = 'board';
    this.openMenuHub('dex', opts);
  }

  openWorldMapModal() {
    this.openMenuHub('map');
  }

  openForgeModal() {
    this.openMenuHub('forge');
  }

  _tabBadge(tabId) {
    if (tabId === 'party') return String((this.state.party?.length || 0) + (this.state.storage?.length || 0));
    if (tabId === 'dex') return `${this.state.caughtDex.length}/20`;
    if (tabId === 'bag') return `🐵 ${this.state.monkeballs}`;
    return '';
  }

  openMenuHub(tab = 'home', opts = {}) {
    const validTab = HUB_TABS.some((t) => t.id === tab) ? tab : 'home';
    const switchedTab = this.modal !== validTab;
    const scrollMemo = switchedTab ? {} : this._captureScroll();
    this.modal = validTab;
    if (switchedTab) {
      this.confirmReturnToTitle = false;
      this.navFocusKey = null; // start the cursor on the new screen's first item
    }
    this.elTitle.classList.add('hidden');
    this.elModal.classList.remove('hidden');

    if (validTab === 'map' && !opts.keepSelection) {
      this.selectedMapZoneId = this.state.zoneId || 'sunpalm';
    }
    if (validTab === 'party') {
      const loc = this.selectedCollectionRef.location;
      const arr = loc === 'storage' ? this.state.storage : this.state.party;
      if (!arr || !arr[this.selectedCollectionRef.index]) {
        this.selectedCollectionRef = { location: 'party', index: this.state.activeIndex || 0 };
      }
    }

    const tabsHtml = HUB_TABS.map((t) => {
      const badge = this._tabBadge(t.id);
      const act = t.id === validTab ? 'active' : '';
      return `<button type="button" class="hub-tab-btn ${act}" data-hub-tab="${t.id}" title="${t.desc}">
        ${t.icon} ${t.label}${badge ? `<span class="tab-badge">${badge}</span>` : ''}
      </button>`;
    }).join('');

    let bodyHtml = '';
    let screenHint = '';
    if (validTab === 'home') {
      bodyHtml = this._buildHomeTabHtml();
      screenHint = 'Pick a screen, or use the tabs above';
    } else if (validTab === 'party') {
      bodyHtml = this._buildPartyTabHtml();
      screenHint = `Select a Monkemon to see its details · ${this.keyLabel('confirm')} again makes it the lead`;
    } else if (validTab === 'dex') {
      bodyHtml = this._buildDexTabHtml();
      screenHint = 'Select an entry to see where it lives';
    } else if (validTab === 'bag') {
      bodyHtml = this._buildBagTabHtml(opts);
      screenHint = 'Items on the left, shop on the right';
    } else if (validTab === 'map') {
      bodyHtml = this._buildWorldMapTabHtml();
      screenHint = `Select a realm · ${this.keyLabel('confirm')} again to fast travel`;
    } else if (validTab === 'forge') {
      bodyHtml = this._buildForgeTabHtml();
      screenHint = 'Describe a Monkemon and forge it in 3D';
    }

    this.elModal.innerHTML = `
      <div class="modal-card">
        <div class="hub-topbar">
          <div class="hub-title">TAMER MENU</div>
          <div class="hub-tabs">${tabsHtml}</div>
          <button type="button" class="close-btn" id="modal-close-btn" title="Close the menu">✕ Close ${this.kbd('back')}</button>
        </div>
        <div class="hub-body">${bodyHtml}</div>
        <div class="hub-footer">
          <span class="legend-item">${this.kbd('nav')} <span>Move cursor</span></span>
          <span class="legend-item">${this.kbd('confirm')} <span>Select</span></span>
          <span class="legend-item">${this.kbd('tabPrev')}${this.kbd('tabNext')} <span>Switch screen</span></span>
          <span class="legend-item">${this.kbd('back')} <span>Close</span></span>
          <span class="hub-screen-hint">${screenHint}</span>
        </div>
      </div>
    `;

    this.elModal.querySelector('#modal-close-btn').addEventListener('click', () => {
      this.audio.playSfx('cancel');
      this.closeAllModals();
    });

    for (const btn of this.elModal.querySelectorAll('[data-hub-tab]')) {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-hub-tab');
        this.audio.playSfx('menu');
        this.navFocusKey = null; // start the cursor on the new screen's first item
        this.openMenuHub(nextTab);
      });
    }

    if (validTab === 'home') this._wireHomeTabEvents();
    else if (validTab === 'party') this._wirePartyTabEvents();
    else if (validTab === 'dex') this._wireDexTabEvents();
    else if (validTab === 'bag') this._wireBagTabEvents();
    else if (validTab === 'map') this._wireWorldMapTabEvents();
    else if (validTab === 'forge') this._wireForgeTabEvents();

    // Re-renders replace the DOM: put scroll positions and the cursor back where they were.
    if (!switchedTab) this._restoreScroll(scrollMemo);
    this._restoreNavFocus();
  }

  _captureScroll() {
    const memo = {};
    if (!this.elModal) return memo;
    for (const sel of SCROLL_MEMO_SELECTORS) {
      const el = this.elModal.querySelector(sel);
      if (el && el.scrollTop > 0) memo[sel] = el.scrollTop;
    }
    return memo;
  }

  _restoreScroll(memo) {
    for (const [sel, top] of Object.entries(memo || {})) {
      const el = this.elModal.querySelector(sel);
      if (el) el.scrollTop = top;
    }
  }

  // ---- MENU HOME: OVERVIEW TILES, SAVE & SETTINGS, HOW TO PLAY ----
  _buildHomeTabHtml() {
    this.renderer.turntableTargetCanvas = null;
    const party = this.state.party || [];
    const hurt = party.filter((m) => m.hp < m.maxHp).length;
    const fainted = party.filter((m) => m.hp <= 0).length;
    const lead = party[this.state.activeIndex] || party[0];
    const zone = ZONES[this.state.zoneId] || ZONES.sunpalm;
    const soundOn = !this.audio.muted;
    const lensOn = Boolean(this.renderer.tiltShiftEnabled);

    const tileStatus = {
      party: fainted
        ? `⚠️ ${fainted} fainted — heal at a House or feed Berries`
        : hurt
          ? `${hurt} of ${party.length} need healing`
          : `${party.length} ready · lead: ${lead ? lead.nickname : '—'}`,
      dex: `${this.state.caughtDex.length} caught · ${this.state.seenDex.length} seen · of 20`,
      bag: `${this.state.monkeballs} Monkeballs · ${this.state.berries} Berries · 🪙 ${this.state.coins}`,
      map: `You are in ${zone.name}`,
      forge: 'Needs the TRELLIS.2 forge server',
    };
    const tileKeys = { party: 'party', dex: 'dex', bag: '', map: 'map', forge: 'forge' };

    const tiles = HUB_TABS.filter((t) => t.id !== 'home')
      .map(
        (t) => `
        <button type="button" class="menu-tile" data-home-tile="${t.id}">
          <span class="tile-icon">${t.icon}</span>
          <span style="flex:1;min-width:0;">
            <span class="tile-name">${t.label} ${tileKeys[t.id] ? this.kbd(tileKeys[t.id]) : ''}</span>
            <div class="tile-desc">${t.desc}</div>
            <div class="tile-status">${tileStatus[t.id] || ''}</div>
          </span>
        </button>`,
      )
      .join('');

    const activeChap = getActiveStoryChapter(this.state);
    const prismHere = getZoneRelicStatus(this.state, this.state.zoneId || 'sunpalm');
    const guest = getGuestCompanion(this.state);
    const fullHud = this.hudMode === 'full';
    // Graphics tier: the renderer reads `monkemon.gfx` at boot ('auto' = detect from the GPU).
    const gfxChoice = GFX_TIERS.includes(readUiPref(GFX_PREF_KEY, 'auto')) ? readUiPref(GFX_PREF_KEY, 'auto') : 'auto';
    const gfxCurrent = (this.renderer && this.renderer.quality) || 'unknown';
    const gfxLabel = gfxChoice === 'auto' ? `auto (${gfxCurrent})` : gfxChoice;
    const gfxNeedsReload = gfxChoice !== 'auto' && gfxChoice !== gfxCurrent;

    return `
      <div class="hub-two-col" style="grid-template-columns: 1.6fr 1fr;">
        <div>
          <div class="guide-step-card" style="border-left-color:#fbbf24;background:#162844;margin-bottom:10px;">
            <strong style="color:#fde047;">📜 ${activeChap.title}</strong> — ${activeChap.objective}
            <div style="margin-top:5px;font-size:15px;color:#a5f3fc;font-weight:700;">
              💎 Dad’s Prism Detector (${zone.name}): <strong>${prismHere.remaining === 0 ? 'All Relics found here!' : `${prismHere.remaining} Relic${prismHere.remaining === 1 ? '' : 's'} remaining`}</strong> (${prismHere.found}/${prismHere.total}) · Total: <strong>${this.state.bananaRelics || 0}/${TOTAL_BANANA_RELICS}</strong>
              ${guest ? `<br />🤝 Active Guest Companion: <strong style="color:#fbcfe8;">${guest.icon} ${guest.name}</strong> (<em>${guest.assistName}</em>)` : ''}
            </div>
          </div>
          <div class="section-head"><h4>Where do you want to go?</h4></div>
          <div class="menu-home-grid">${tiles}</div>

          <div class="section-head"><h4>Save &amp; settings</h4><span class="help">The game also auto-saves as you play.</span></div>
          <div class="settings-row">
            <button type="button" class="setting-btn" id="btn-save-now">💾 Save game now</button>
            <button type="button" class="setting-btn ${soundOn ? 'on' : ''}" id="btn-setting-sound">${soundOn ? '🔊 Sound: on' : '🔇 Sound: off'} ${this.kbd('mute')}</button>
            <button type="button" class="setting-btn ${lensOn ? 'on' : ''}" id="btn-setting-lens">📷 Miniature lens: ${lensOn ? 'on' : 'off'} ${this.kbd('tilt')}</button>
            <button type="button" class="setting-btn ${fullHud ? 'on' : ''}" id="btn-setting-hud" title="Minimal keeps the overworld clean (just a menu chip); Full shows map, items and squad on screen">🖥️ Overworld HUD: ${fullHud ? 'full' : 'minimal'}</button>
            <button type="button" class="setting-btn" id="btn-setting-gfx" title="Graphics quality tier. Auto picks one for your GPU; a chosen tier takes effect after a reload.">✨ Graphics: ${gfxLabel}</button>
            ${gfxNeedsReload ? `<button type="button" class="setting-btn confirm" id="btn-setting-gfx-apply">↻ Apply graphics &amp; reload</button>` : ''}
            <button type="button" class="setting-btn ${this.confirmReturnToTitle ? 'confirm' : 'danger'}" id="btn-return-title">
              ${this.confirmReturnToTitle ? '⚠️ Press again to save & return to title' : '🏠 Return to title'}
            </button>
          </div>
        </div>

        <div class="help-panel">
          <div class="section-head"><h4>How to play</h4></div>
          <div class="help-step"><span class="step-no">1</span><div><strong>Explore.</strong> Walk with ${this.kbd('move')}. Press ${this.kbd('confirm')} to talk, open chests, or enter a House.</div></div>
          <div class="help-step"><span class="step-no">2</span><div><strong>Catch.</strong> Near a wild Monkemon, toss a Berry ${this.kbd('berry')} then throw a Monkeball ${this.kbd('throw')} — press again when the ring is small. Or battle it and pick <em>Catch</em> once its HP is low.</div></div>
          <div class="help-step"><span class="step-no">3</span><div><strong>Battle.</strong> Face a Monkemon and press ${this.kbd('confirm')}. Then choose Attack, Special, Catch/Heal, or Run — one press each.</div></div>
          <div class="help-step"><span class="step-no">4</span><div><strong>Heal.</strong> Enter any House for a free full heal, or feed Berries from the Squad screen.</div></div>
          <div class="key-table">
            <span class="keys">${this.kbd('menu')}</span><span>Open / close this menu</span>
            ${
              this.inputMode() === 'keyboard'
                ? `<span class="keys">${this.kbd('party')}${this.kbd('dex')}${this.kbd('map')}</span><span>Jump to Squad / MonkeDex / Map</span>`
                : `<span class="keys">${this.kbd('map')}</span><span>Jump to the World Map</span>`
            }
            <span class="keys">${this.kbd('swap')}</span><span>Switch lead Monkemon</span>
            <span class="keys">${this.kbd('sprint')}</span><span>Sprint${this.inputMode() === 'keyboard' ? '' : ' (hold)'}</span>
          </div>
        </div>
      </div>
    `;
  }

  _wireHomeTabEvents() {
    for (const tile of this.elModal.querySelectorAll('[data-home-tile]')) {
      tile.addEventListener('click', () => {
        this.audio.playSfx('menu');
        this.navFocusKey = null;
        this.openMenuHub(tile.getAttribute('data-home-tile'));
      });
    }

    const saveBtn = this.elModal.querySelector('#btn-save-now');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const ok = saveGameToStorage(this.state);
        this.audio.playSfx(ok === false ? 'cancel' : 'confirm');
        this.showToast(ok === false ? '⚠️ Could not save (storage unavailable)' : '💾 Game saved!');
      });
    }

    const soundBtn = this.elModal.querySelector('#btn-setting-sound');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        this.audio.toggleMute();
        this._syncMuteButton();
        this.openMenuHub('home');
      });
    }

    const lensBtn = this.elModal.querySelector('#btn-setting-lens');
    if (lensBtn) {
      lensBtn.addEventListener('click', () => {
        this.renderer.toggleTiltShift();
        this.audio.playSfx('menu');
        this.openMenuHub('home');
      });
    }

    const hudBtn = this.elModal.querySelector('#btn-setting-hud');
    if (hudBtn) {
      hudBtn.addEventListener('click', () => {
        this.setHudMode(this.hudMode === 'full' ? 'minimal' : 'full');
        this.audio.playSfx('menu');
        this.openMenuHub('home');
      });
    }

    const gfxBtn = this.elModal.querySelector('#btn-setting-gfx');
    if (gfxBtn) {
      gfxBtn.addEventListener('click', () => {
        const cur = readUiPref(GFX_PREF_KEY, 'auto');
        const idx = Math.max(0, GFX_TIERS.indexOf(cur));
        const next = GFX_TIERS[(idx + 1) % GFX_TIERS.length];
        if (next === 'auto') {
          try {
            if (globalThis.localStorage) globalThis.localStorage.removeItem(GFX_PREF_KEY);
          } catch {
            /* ignore */
          }
        } else {
          writeUiPref(GFX_PREF_KEY, next);
        }
        this.audio.playSfx('menu');
        this.openMenuHub('home');
      });
    }

    const gfxApplyBtn = this.elModal.querySelector('#btn-setting-gfx-apply');
    if (gfxApplyBtn) {
      gfxApplyBtn.addEventListener('click', () => {
        saveGameToStorage(this.state);
        this.audio.playSfx('confirm');
        window.location.reload();
      });
    }

    const titleBtn = this.elModal.querySelector('#btn-return-title');
    if (titleBtn) {
      titleBtn.addEventListener('click', () => {
        if (!this.confirmReturnToTitle) {
          this.confirmReturnToTitle = true;
          this.audio.playSfx('menu');
          this.openMenuHub('home');
          return;
        }
        saveGameToStorage(this.state);
        this.audio.playSfx('confirm');
        window.location.reload();
      });
    }
  }

  // ---- SQUAD: ACTIVE TEAM + STORAGE BOX ----
  _buildPartyTabHtml() {
    const partyCards = this.state.party
      .map((m, idx) => {
        const sp = getSpecies(m.speciesId);
        const el = ELEMENTS[sp.element] || ELEMENTS.mug;
        const pct = Math.max(0, Math.min(100, Math.round((m.hp / Math.max(1, m.maxHp)) * 100)));
        const hpColor = pct < 28 ? '#ef4444' : pct < 56 ? '#f59e0b' : '#22c55e';
        const isSel = this.selectedCollectionRef.location === 'party' && this.selectedCollectionRef.index === idx;
        const isLead = idx === this.state.activeIndex;
        const status = m.hp <= 0 ? '<span style="color:#fca5a5;">Fainted</span>' : pct < 56 ? '<span style="color:#fde047;">Needs healing</span>' : 'Ready';
        return `
          <button type="button" class="mon-collection-card ${isSel ? 'selected' : ''}" data-col-loc="party" data-col-idx="${idx}">
            <img src="${sp.concept}" alt="${m.nickname}" />
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
                <strong style="font-family:var(--font-display);font-size:20px;color:#fff;">${el.icon} ${m.nickname}</strong>
                <span style="font-size:16px;color:#7dd3fc;font-weight:800;">Lv.${m.level}</span>
              </div>
              <div style="font-size:15px;color:#cbd5e1;margin:1px 0 4px;display:flex;gap:6px;align-items:center;">
                ${isLead ? '<span class="card-lead-tag">★ LEAD</span>' : `<span>Slot ${idx + 1}</span>`} <span>· ${status}</span>
              </div>
              <div class="hp-track" style="height:7px;"><div class="hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:15px;color:#e2e8f0;margin-top:3px;font-weight:800;">
                <span>HP ${m.hp} / ${m.maxHp}</span>
                <span>${el.label}</span>
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    const storageCards = this.state.storage.length
      ? this.state.storage
          .map((m, idx) => {
            const sp = getSpecies(m.speciesId);
            const el = ELEMENTS[sp.element] || ELEMENTS.mug;
            const isSel =
              this.selectedCollectionRef.location === 'storage' && this.selectedCollectionRef.index === idx;
            return `
              <button type="button" class="mon-collection-card ${isSel ? 'selected' : ''}" style="padding:6px 8px;" data-col-loc="storage" data-col-idx="${idx}">
                <img src="${sp.concept}" alt="${m.nickname}" style="width:38px;height:38px;" />
                <div style="min-width:0;">
                  <div style="font-family:var(--font-display);font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${el.icon} ${m.nickname}</div>
                  <div style="font-size:15px;color:#93c5fd;">Lv.${m.level} · HP ${m.hp}/${m.maxHp}</div>
                </div>
              </button>
            `;
          })
          .join('')
      : `<div style="grid-column:1/-1;color:#94a3b8;font-size:16px;padding:12px;text-align:center;">
           Empty. Once your squad has 6 Monkemon, new catches are stored here.
         </div>`;

    const selArr = this.selectedCollectionRef.location === 'storage' ? this.state.storage : this.state.party;
    const selMon = selArr[this.selectedCollectionRef.index] || this.state.party[0];
    const sp = getSpecies(selMon.speciesId);
    const el = ELEMENTS[sp.element] || ELEMENTS.mug;
    const nextExp = expRequiredForLevel(selMon.level);
    const caughtZoneName = (ZONES[selMon.caughtZone] && ZONES[selMon.caughtZone].name) || 'Hometown Cove';
    const bMoves = getBattleMoves(selMon, sp);
    const isParty = this.selectedCollectionRef.location === 'party';
    const isLead = isParty && this.selectedCollectionRef.index === this.state.activeIndex;
    const leadMon = this.state.party[this.state.activeIndex] || this.state.party[0];
    const fullHp = selMon.hp >= selMon.maxHp;
    const noBerries = (this.state.berries || 0) <= 0;

    return `
      <div class="hub-two-col">
        <div>
          <div class="section-head">
            <h4>Active squad</h4>
            <span class="count">${this.state.party.length} / 6</span>
            <span class="help">The ★ lead walks beside you and fights first.</span>
          </div>
          <div class="caught-party-grid">${partyCards}</div>

          <div class="section-head">
            <h4>Storage box</h4>
            <span class="count">${this.state.storage.length}</span>
            <span class="help">Select one to swap it into your squad.</span>
          </div>
          <div class="storage-box-grid">${storageCards}</div>
        </div>

        <div class="dex-inspector">
          <div class="turntable-wrap">
            <canvas id="dex-turntable-canvas" width="248" height="228"></canvas>
            <div class="tt-caption">3D VIEW</div>
          </div>
          <div class="dex-title-row">
            <span class="dex-num">#${String(sp.dexNum || 21).padStart(2, '0')}</span>
            <h3>${selMon.nickname}</h3>
            <span class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">
              ${el.icon} ${el.label}
            </span>
          </div>
          <div class="dex-subtitle">
            Lv.${selMon.level} · HP <strong style="color:#fde047;">${selMon.hp} / ${selMon.maxHp}</strong> · EXP ${selMon.exp || 0} / ${nextExp}
          </div>
          <div style="font-size:16px;color:#cbd5e1;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>${sp.name} · caught in <strong>${caughtZoneName}</strong></span>
            <button type="button" class="inline-link-btn" id="btn-inspect-in-dex" title="Habitat and type matchups">📖 Open in MonkeDex</button>
          </div>
          <div class="dex-stats">
            <div><span>HP</span><strong>${selMon.maxHp}</strong></div>
            <div><span>ATK</span><strong>${selMon.atk}</strong></div>
            <div><span>DEF</span><strong>${selMon.def}</strong></div>
            <div><span>SPD</span><strong>${selMon.spd}</strong></div>
          </div>
          <div class="section-head" style="margin-top:4px;"><h4 style="font-size:18px;">Moves</h4></div>
          <div class="dex-moves">
            ${bMoves
              .map((m) => {
                const mElem = ELEMENTS[resolveMoveElement(m, sp)] || el;
                return `<span class="move-chip">${mElem.icon} ${m.name} <span style="color:#94a3b8;">· ${m.healPct ? `heals ${Math.round(m.healPct * 100)}%` : `power ${m.power}`}</span></span>`;
              })
              .join('')}
          </div>

          <div class="inspector-actions">
            ${
              isParty
                ? isLead
                  ? `<button type="button" class="mini-action-btn gold" disabled>★ This is your lead Monkemon</button>`
                  : `<button type="button" class="mini-action-btn gold" id="btn-set-lead">★ Make lead <small>walks with you · fights first</small></button>`
                : `<button type="button" class="mini-action-btn gold" id="btn-swap-storage">🔄 Swap into squad <small>replaces ${leadMon ? leadMon.nickname : 'your lead'}</small></button>`
            }
            ${
              isParty
                ? `<button type="button" class="mini-action-btn" id="btn-feed-berry" ${fullHp || noBerries ? 'disabled' : ''}>🍌 Feed a Berry <small>${noBerries ? 'none left' : fullHp ? 'HP is already full' : `+40% HP · ${this.state.berries} left`}</small></button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  _wirePartyTabEvents() {
    const selArr = this.selectedCollectionRef.location === 'storage' ? this.state.storage : this.state.party;
    const selMon = selArr[this.selectedCollectionRef.index] || this.state.party[0];
    if (selMon) this._mountTurntableSpecies(getSpecies(selMon.speciesId), false);

    for (const card of this.elModal.querySelectorAll('[data-col-loc]')) {
      card.addEventListener('click', () => {
        this.selectedCollectionRef = {
          location: card.getAttribute('data-col-loc'),
          index: parseInt(card.getAttribute('data-col-idx'), 10) || 0,
        };
        this.audio.playSfx('menu');
        this.openMenuHub('party');
      });
    }

    const leadBtn = this.elModal.querySelector('#btn-set-lead');
    if (leadBtn) {
      leadBtn.addEventListener('click', () => {
        if (setLeadPartyIndex(this.state, this.selectedCollectionRef.index)) {
          this.audio.playSfx('confirm');
          saveGameToStorage(this.state);
          if (this.cb.onPartyChanged) this.cb.onPartyChanged();
          this.showToast(`★ ${this.state.party[this.state.activeIndex].nickname} is now your Active Lead Partner!`);
          this.openMenuHub('party');
        }
      });
    }

    const berryBtn = this.elModal.querySelector('#btn-feed-berry');
    if (berryBtn) {
      berryBtn.addEventListener('click', () => {
        const res = useBerryOnPartyMon(this.state, this.selectedCollectionRef.index);
        this.audio.playSfx(res.ok ? 'heal_chime' : 'cancel');
        this.showToast(res.message);
        if (res.ok) {
          saveGameToStorage(this.state);
          this.openMenuHub('party');
        }
      });
    }

    const swapBtn = this.elModal.querySelector('#btn-swap-storage');
    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        if (swapPartyWithStorage(this.state, this.state.activeIndex, this.selectedCollectionRef.index)) {
          this.audio.playSfx('confirm');
          saveGameToStorage(this.state);
          if (this.cb.onPartyChanged) this.cb.onPartyChanged();
          this.showToast(`🔄 Swapped ${this.state.party[this.state.activeIndex].nickname} into your Active Squad!`);
          this.selectedCollectionRef = { location: 'party', index: this.state.activeIndex };
          this.openMenuHub('party');
        }
      });
    }

    const dexJumpBtn = this.elModal.querySelector('#btn-inspect-in-dex');
    if (dexJumpBtn && selMon) {
      dexJumpBtn.addEventListener('click', () => {
        this.selectedDexId = selMon.speciesId;
        this.audio.playSfx('menu');
        this.openMenuHub('dex');
      });
    }
  }

  // ---- TAB 2: MONKEDEX ENCYCLOPEDIA & 20-BOSS BOARD ----
  _buildDexTabHtml() {
    const allSpecies = getAllSpecies();
    const filtered = allSpecies.filter((s) => {
      if (this.dexFilter === 'caught') return this.state.caughtDex.includes(s.id);
      if (this.dexFilter === 'seen') return this.state.seenDex.includes(s.id) || this.state.caughtDex.includes(s.id);
      return true;
    });

    if (!this.selectedDexId || !allSpecies.some((s) => s.id === this.selectedDexId)) {
      this.selectedDexId = (filtered[0] && filtered[0].id) || 'mugchimp';
    }

    const sp = getSpecies(this.selectedDexId);
    const el = ELEMENTS[sp.element] || ELEMENTS.mug;
    const isCaught = this.state.caughtDex.includes(sp.id);
    const isSeen = isCaught || this.state.seenDex.includes(sp.id);
    const ownedCount =
      this.state.party.filter((m) => m.speciesId === sp.id).length +
      this.state.storage.filter((m) => m.speciesId === sp.id).length;
    const habitatStr = this._getSpeciesHabitats(sp.id);

    let leftCollectionHtml = '';
    if (this.dexViewMode === 'board') {
      const boardCells = [
        { num: 1, r: 1, c: 1 }, { num: 2, r: 1, c: 2 }, { num: 3, r: 1, c: 3 },
        { num: 4, r: 1, c: 4 }, { num: 5, r: 1, c: 5 }, { num: 6, r: 1, c: 6 },
        { num: 7, r: 2, c: 6 }, { num: 8, r: 3, c: 6 }, { num: 9, r: 4, c: 6 },
        { num: 10, r: 5, c: 6 }, { num: 11, r: 5, c: 5 }, { num: 12, r: 5, c: 4 },
        { num: 13, r: 5, c: 3 }, { num: 14, r: 5, c: 2 }, { num: 15, r: 5, c: 1 },
        { num: 16, r: 4, c: 1 }, { num: 17, r: 3, c: 1 }, { num: 18, r: 2, c: 1 },
        { num: 19, r: 3, c: 2, spanC: 1, spanR: 2, boss19: true },
        { num: 20, r: 2, c: 3, spanC: 3, spanR: 3, boss20: true },
      ];
      const byDex = new Map(allSpecies.map((s) => [s.dexNum, s]));
      leftCollectionHtml = `<div class="sticky-board-grid">${boardCells
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
              <img src="${entry.concept}" alt="${seen ? entry.name : 'Unknown'}" />
              <span class="bt-name">${seen ? entry.name : '???'}</span>
              <span class="bt-badge">${caught ? '🐵' : seen ? elem.icon : '❓'}</span>
            </button>
          `;
        })
        .join('')}</div>`;
    } else {
      leftCollectionHtml = filtered.length
        ? `<div class="dex-encyclo-grid">${filtered
            .map((entry) => {
              const caught = this.state.caughtDex.includes(entry.id);
              const seen = caught || this.state.seenDex.includes(entry.id);
              const elem = ELEMENTS[entry.element] || ELEMENTS.mug;
              const statusCls = caught ? 'caught' : seen ? 'seen' : 'unseen';
              const selCls = entry.id === sp.id ? 'selected' : '';
              const statusTag = caught ? '🐵 Caught' : seen ? '👀 Seen' : '❓ Not found yet';
              return `
                <button type="button" class="dex-card ${statusCls} ${selCls}" data-dex-id="${entry.id}">
                  <div style="width:100%;display:flex;justify-content:space-between;font-size:13px;font-weight:800;color:#94a3b8;">
                    <span>#${String(entry.dexNum || 21).padStart(2, '0')}</span>
                    <span>${caught ? '🐵' : seen ? elem.icon : '❓'}</span>
                  </div>
                  <img src="${entry.concept}" alt="${seen ? entry.name : 'Unknown'}" />
                  <div style="font-family:var(--font-display);font-size:17px;color:#fff;">${seen ? entry.name : '???'}</div>
                  <div style="font-size:13px;font-weight:800;color:${caught ? '#4ade80' : seen ? '#7dd3fc' : '#64748b'};">${statusTag}</div>
                </button>
              `;
            })
            .join('')}</div>`
        : `<div style="padding:28px;text-align:center;background:#132238;border-radius:14px;color:#cbd5e1;">
             No Monkemon match this filter yet — explore tall grass or throw a Smiling Monkeball!
           </div>`;
    }

    const strongVs =
      Object.entries(TYPE_CHART[sp.element] || {})
        .filter(([, m]) => m > 1.1)
        .map(([k]) => `${ELEMENTS[k]?.icon || ''} ${ELEMENTS[k]?.label || k}`)
        .join(', ') || 'Balanced';

    return `
      <div class="dex-filter-bar">
        <div class="filter-pill-group" title="Show">
          <button type="button" class="filter-pill ${this.dexFilter === 'all' ? 'active' : ''}" data-dex-filter="all">
            All <span style="color:#94a3b8;">${allSpecies.length}</span>
          </button>
          <button type="button" class="filter-pill ${this.dexFilter === 'caught' ? 'active' : ''}" data-dex-filter="caught">
            🐵 Caught <span style="color:#94a3b8;">${this.state.caughtDex.length}</span>
          </button>
          <button type="button" class="filter-pill ${this.dexFilter === 'seen' ? 'active' : ''}" data-dex-filter="seen">
            👀 Seen <span style="color:#94a3b8;">${this.state.seenDex.length}</span>
          </button>
        </div>
        <div class="filter-pill-group" title="Layout">
          <button type="button" class="filter-pill ${this.dexViewMode === 'grid' ? 'active' : ''}" data-dex-view="grid">
            ▦ List
          </button>
          <button type="button" class="filter-pill ${this.dexViewMode === 'board' ? 'active' : ''}" data-dex-view="board">
            🏆 Progress board
          </button>
        </div>
      </div>

      <div class="hub-two-col">
        <div>${leftCollectionHtml}</div>

        <div class="dex-inspector">
          <div class="turntable-wrap">
            <canvas id="dex-turntable-canvas" width="248" height="228"></canvas>
            <div class="tt-caption">${isSeen ? '3D VIEW' : 'NOT YET DISCOVERED'}</div>
          </div>
          <div class="dex-title-row">
            <span class="dex-num">#${String(sp.dexNum || 21).padStart(2, '0')}</span>
            <h3>${isSeen ? sp.name : '???'}</h3>
            ${
              isSeen
                ? `<span class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">${el.icon} ${el.label}</span>`
                : `<span class="type-pill" style="background:#1e293b;border-color:#64748b;color:#cbd5e1;">❓ Unknown type</span>`
            }
          </div>
          <div class="dex-subtitle">
            ${
              isCaught
                ? `🐵 Caught · you own ${ownedCount} · ${sp.title}`
                : isSeen
                  ? `👀 Seen in the wild · base catch chance ${Math.round((sp.catchRate || 0.5) * 100)}%`
                  : `❓ Not met yet — visit its habitat to find it`
            }
          </div>
          <div style="font-size:16px;color:#fde047;background:#15253e;border:1px solid #334155;border-radius:10px;padding:6px 10px;margin-bottom:8px;">
            🗺️ <strong>Where to find it:</strong> ${habitatStr}
          </div>
          <p class="dex-bio">
            ${
              isCaught
                ? sp.bio
                : isSeen
                  ? 'You have met this Monkemon. Lower its HP in battle (or toss a Berry), then throw a Monkeball to catch it and unlock its full entry.'
                  : 'Explore tall grass and shrines in the realm listed above to encounter this Monkemon.'
            }
          </p>
          ${
            isSeen
              ? `
                <div class="dex-stats">
                  <div><span>HP</span><strong>${sp.baseStats.hp}</strong></div>
                  <div><span>ATK</span><strong>${sp.baseStats.atk}</strong></div>
                  <div><span>DEF</span><strong>${sp.baseStats.def}</strong></div>
                  <div><span>SPD</span><strong>${sp.baseStats.spd}</strong></div>
                </div>
                <div style="font-size:16px;color:#bae6fd;margin-bottom:8px;"><strong>Strong against:</strong> ${strongVs}</div>
                <div class="dex-moves">
                  ${(sp.moves || [])
                    .map((mId) => {
                      const m = MOVES[mId];
                      return m ? `<span class="move-chip">${m.name}</span>` : '';
                    })
                    .join('')}
                </div>
              `
              : ''
          }
        </div>
      </div>
    `;
  }

  _wireDexTabEvents() {
    const sp = getSpecies(this.selectedDexId);
    const isSeen = this.state.caughtDex.includes(sp.id) || this.state.seenDex.includes(sp.id);
    this._mountTurntableSpecies(sp, !isSeen);

    for (const tile of this.elModal.querySelectorAll('[data-dex-id]')) {
      tile.addEventListener('click', () => {
        this.selectedDexId = tile.getAttribute('data-dex-id');
        this.audio.playSfx('menu');
        this.openMenuHub('dex');
      });
    }
    for (const btn of this.elModal.querySelectorAll('[data-dex-filter]')) {
      btn.addEventListener('click', () => {
        this.dexFilter = btn.getAttribute('data-dex-filter');
        this.audio.playSfx('menu');
        this.openMenuHub('dex');
      });
    }
    for (const btn of this.elModal.querySelectorAll('[data-dex-view]')) {
      btn.addEventListener('click', () => {
        this.dexViewMode = btn.getAttribute('data-dex-view');
        this.audio.playSfx('menu');
        this.openMenuHub('dex');
      });
    }
  }

  // ---- BAG: YOUR ITEMS (LEFT) · SHOP + STORY PROGRESS (RIGHT) ----
  _buildBagTabHtml() {
    this.renderer.turntableTargetCanvas = null;
    const coins = this.state.coins || 0;

    const shopRows = SHOP_CATALOG.map((item) => {
      const canAfford = coins >= item.cost;
      return `
        <div class="shop-row" style="${canAfford ? '' : 'opacity:0.72;'}">
          <span class="shop-icon">${item.icon}</span>
          <div class="shop-info">
            <div class="shop-name">${item.name}</div>
            <div class="shop-desc">${item.desc}</div>
          </div>
          <button type="button" class="mini-action-btn ${canAfford ? 'gold' : ''}" data-buy-item="${item.id}" ${canAfford ? '' : 'disabled'} title="${canAfford ? `Buy for ${item.cost} coins` : `You need ${item.cost - coins} more coins`}">
            🪙 ${item.cost}
          </button>
        </div>
      `;
    }).join('');

    const noBerries = (this.state.berries || 0) <= 0;
    const partyHealBtns = this.state.party
      .map((m, idx) => {
        const needsHeal = m.hp < m.maxHp;
        const disabled = !needsHeal || noBerries;
        return `
          <button type="button" class="mini-action-btn ${needsHeal && !noBerries ? 'gold' : ''}" data-bag-heal="${idx}" ${disabled ? 'disabled' : ''}>
            🍌 ${m.nickname} <small>${m.hp}/${m.maxHp} HP${needsHeal ? '' : ' · full'}</small>
          </button>
        `;
      })
      .join('');

    const activeChap = getActiveStoryChapter(this.state);
    const ownedKeyIds = this.state.keyItems || [];
    const keyItemsHtml = ownedKeyIds.length
      ? ownedKeyIds
          .map((kId) => {
            const meta = KEY_ITEMS_META[kId] || { icon: '🔑', name: kId, desc: 'Key Story Artifact' };
            return `
              <div style="background:#0f1f36;border:1px solid #fbbf24;border-radius:10px;padding:7px 10px;">
                <div style="font-size:16px;font-weight:800;color:#fde047;">${meta.icon} ${meta.name}</div>
                <div style="font-size:15px;color:#cbd5e1;margin-top:2px;">${meta.desc}</div>
              </div>
            `;
          })
          .join('')
      : `<div style="font-size:16px;color:#94a3b8;padding:6px 2px;">None yet — explore Shrines, Towers, the Giant’s Manor and Dungeons to find key story artifacts.</div>`;

    return `
      <div class="hub-two-col" style="grid-template-columns: 1.25fr 1fr;">
        <div>
          <div class="section-head"><h4>Your items</h4><span class="help">Catching items are used from the field or in battle.</span></div>
          <div class="bag-cards-grid">
            <div class="bag-item-card" style="border-color:#fbbf24;">
              <div class="item-title"><span>🐵 Monkeballs</span><span class="item-qty">×${this.state.monkeballs}</span></div>
              <div class="item-desc">Throw at a wild Monkemon to catch it. Works best when its HP is low.</div>
              <div class="item-how">Use: ${this.kbd('throw')} in the field · <em>Catch</em> in battle</div>
            </div>
            <div class="bag-item-card" style="border-color:#f59e0b;">
              <div class="item-title"><span>🌟 Super Balls</span><span class="item-qty">×${this.state.superBalls}</span></div>
              <div class="item-desc">1.85× catch chance. Used automatically in the field when you run out of Monkeballs.</div>
              <div class="item-how">Use: <em>Super Ball</em> button in battle</div>
            </div>
            <div class="bag-item-card" style="border-color:#4ade80;">
              <div class="item-title"><span>🍌 Berries</span><span class="item-qty">×${this.state.berries}</span></div>
              <div class="item-desc">Heals +40% HP, or toss one at a wild Monkemon for +42% catch chance.</div>
              <div class="item-how">Use: ${this.kbd('berry')} in the field · below to heal</div>
            </div>
            <div class="bag-item-card" style="border-color:#38bdf8;">
              <div class="item-title"><span>✨ Relics &amp; 🏅 Badges</span><span class="item-qty">${this.state.bananaRelics || 0}/${TOTAL_BANANA_RELICS} · ${this.state.badges.length}/4</span></div>
              <div class="item-desc">Golden Banana Relics awaken Sky-Vine Pillars. Each House Badge makes every Monkeball a little more accurate.</div>
            </div>
          </div>

          <div class="section-head">
            <h4>Feed a Berry</h4>
            <span class="count">${this.state.berries} left</span>
            <span class="help">${noBerries ? 'Buy more in the shop →' : 'Pick who to heal (+40% HP).'}</span>
          </div>
          <div class="heal-list">${partyHealBtns}</div>
        </div>

        <div>
          <div class="shop-panel" style="margin-bottom:12px;">
            <div class="section-head"><h4>🏪 Shop</h4><span class="help">Earn coins by winning battles.</span></div>
            <div class="shop-balance"><span>Your coins</span><strong>🪙 ${coins}</strong></div>
            ${shopRows}
          </div>

          <div class="help-panel">
            <div class="section-head"><h4>📜 Story progress</h4></div>
            <div class="guide-step-card" style="border-left-color:#fbbf24;background:#162844;margin-bottom:8px;">
              <strong style="color:#fde047;">${activeChap.title}</strong><br />
              ${activeChap.objective}
              ${(() => {
                const pr = getZoneRelicStatus(this.state, this.state.zoneId || 'sunpalm');
                const gc = getGuestCompanion(this.state);
                return `<div style="margin-top:5px;font-size:15px;color:#a5f3fc;font-weight:700;">
                  🧭 Banana Compass: ${pr.remaining === 0 ? 'World Clear!' : `${pr.remaining} Relic${pr.remaining === 1 ? '' : 's'} left in this World`} (${pr.found}/${pr.total})
                  ${gc ? ` · 🤝 ${gc.icon} ${gc.name}` : ''}
                </div>`;
              })()}
            </div>
            <div class="section-head"><h4 style="font-size:18px;">Key items</h4><span class="count">${ownedKeyIds.length} / ${Object.keys(KEY_ITEMS_META).length}</span></div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto;">
              ${keyItemsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _wireBagTabEvents() {
    for (const btn of this.elModal.querySelectorAll('[data-buy-item]')) {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-buy-item');
        const res = buyShopItem(this.state, itemId);
        this.audio.playSfx(res.ok ? 'catch_fanfare' : 'cancel');
        this.showToast(res.message);
        if (res.ok) {
          saveGameToStorage(this.state);
          this.openMenuHub('bag');
        }
      });
    }
    for (const btn of this.elModal.querySelectorAll('[data-bag-heal]')) {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-bag-heal'), 10);
        const res = useBerryOnPartyMon(this.state, idx);
        this.audio.playSfx(res.ok ? 'heal_chime' : 'cancel');
        this.showToast(res.message);
        if (res.ok) {
          saveGameToStorage(this.state);
          this.openMenuHub('bag');
        }
      });
    }
  }

  // ---- TAB 4: ILLUSTRATED CARTOGRAPHIC ARCHIPELAGO WORLD MAP ----
  _buildIslandSvgPolygon(zone, cx, cy, rx, ry) {
    const pts = [];
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const rNorm = computeCoastRadiusNorm(th, zone.coastParams || [0.1, 0.07, 0.04, 0.4]);
      const px = cx + Math.cos(th) * rx * rNorm;
      const py = cy + Math.sin(th) * ry * rNorm;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return pts.join(' ');
  }

  _buildWorldMapTabHtml() {
    this.renderer.turntableTargetCanvas = null;
    const selZone = ZONES[this.selectedMapZoneId] || ZONES[this.state.zoneId] || ZONES.sunpalm;
    const activeChap = getActiveStoryChapter(this.state);

    // Sky-Vine Spire connectors between `worldMapNode` centers across all 10 Realms
    const drawnPairs = new Set();
    const routeLines = [];
    for (const z of ZONE_LIST) {
      const n1 = z.worldMapNode;
      if (!n1) continue;
      for (const r of n1.seaRoutes || []) {
        const target = ZONES[r.to];
        if (!target || !target.worldMapNode) continue;
        const key = [z.id, target.id].sort().join('--');
        if (drawnPairs.has(key)) continue;
        drawnPairs.add(key);
        const n2 = target.worldMapNode;
        const mx = (n1.x + n2.x) * 0.5;
        const my = (n1.y + n2.y) * 0.5 - 14;
        routeLines.push(`
          <path d="M ${n1.x} ${n1.y} Q ${mx} ${my} ${n2.x} ${n2.y}"
            fill="none" stroke="#10b981" stroke-width="6.5" stroke-linecap="round" opacity="0.34" />
          <path d="M ${n1.x} ${n1.y} Q ${mx} ${my} ${n2.x} ${n2.y}"
            fill="none" stroke="#fbbf24" stroke-width="2.8" stroke-dasharray="7 5" opacity="0.92" />
        `);
      }
    }

    const islandSvgNodes = ZONE_LIST.map((z) => {
      const n = z.worldMapNode || { x: 240, y: 380, icon: '🏝️', regionTag: 'REALM' };
      const rx = z.id === 'cinderpeak' ? 52 : 45;
      const ry = z.id === 'cinderpeak' ? 35 : 30;
      const foamPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx + 6, ry + 5);
      const sandPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx + 2, ry + 1.8);
      const landPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx - 2.5, ry - 2.5);
      const isHere = z.id === this.state.zoneId;
      const isSelected = z.id === selZone.id;
      const isQuestRealm = activeChap.zoneId === z.id;
      const sandFill =
        z.theme === 'volcano'
          ? '#57534e'
          : z.theme === 'snow' || z.theme === 'sky'
            ? '#e2e8f0'
            : '#fde68a';
      const riverStroke = z.theme === 'volcano' ? '#f97316' : z.theme === 'sky' ? '#facc15' : '#38bdf8';
      const shortName = z.name.length > 17 ? `${z.name.slice(0, 16)}…` : z.name;

      return `
        <g class="atlas-island-node" data-atlas-zone="${z.id}">
          <polygon points="${foamPts}" fill="rgba(186,230,253,0.24)" stroke="${isQuestRealm ? '#4ade80' : '#bae6fd'}" stroke-width="1.3" stroke-dasharray="4 3" />
          <polygon points="${sandPts}" fill="${sandFill}" stroke="${isSelected ? '#facc15' : '#0f172a'}" stroke-width="${isSelected ? '3.2' : '1.6'}" />
          <polygon points="${landPts}" fill="${z.groundColor}" />
          <path d="M ${n.x - 10} ${n.y - ry * 0.58} Q ${n.x + 4} ${n.y} ${n.x + 9} ${n.y + ry * 0.6}"
            fill="none" stroke="${riverStroke}" stroke-width="3" stroke-linecap="round" opacity="0.85" />
          <circle cx="${n.x - rx + 6}" cy="${n.y - ry + 6}" r="10" fill="#0f172a" stroke="#fbbf24" stroke-width="1.5" />
          <text x="${n.x - rx + 6}" y="${n.y - ry + 9.5}" text-anchor="middle" fill="#fde047" font-size="9.5" font-weight="900">${z.index}</text>
          <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="16">${n.icon}</text>
          <rect x="${n.x - 54}" y="${n.y + ry * 0.62}" width="108" height="18" rx="9" fill="#0f172af0" stroke="${isSelected ? '#fbbf24' : '#38bdf8'}" stroke-width="1.4" />
          <text x="${n.x}" y="${n.y + ry * 0.62 + 12.5}" text-anchor="middle" fill="#fef3c7" font-family="Lilita One, Fredoka, sans-serif" font-size="10">${shortName}</text>
          ${
            isHere
              ? `
                <g>
                  <rect x="${n.x - 42}" y="${n.y - ry - 20}" width="84" height="16" rx="8" fill="#facc15" stroke="#0f172a" stroke-width="1.6" />
                  <text x="${n.x}" y="${n.y - ry - 9}" text-anchor="middle" fill="#0f172a" font-weight="900" font-size="9">📍 HERE</text>
                </g>
              `
              : isQuestRealm
                ? `
                  <g>
                    <rect x="${n.x - 36}" y="${n.y - ry - 19}" width="72" height="15" rx="7.5" fill="#10b981" stroke="#0f172a" stroke-width="1.4" />
                    <text x="${n.x}" y="${n.y - ry - 8.5}" text-anchor="middle" fill="#052e16" font-weight="900" font-size="8.5">★ QUEST</text>
                  </g>
                `
                : ''
          }
        </g>
      `;
    }).join('');

    // Selected Realm Inspector stats (including wilds inside this Realm's enterable dungeons!)
    const houseInteriorWildIds = [];
    for (const h of selZone.houses || []) {
      const spec = INTERIOR_MAPS[h.id];
      for (const ws of (spec && spec.wildSpawns) || []) {
        houseInteriorWildIds.push(ws.speciesId);
      }
    }
    const zoneSpeciesIds = [
      ...new Set([
        ...(selZone.wildPool || []).map((w) => w.speciesId),
        ...(selZone.apexSpawns || []).map((a) => a.speciesId),
        ...houseInteriorWildIds,
      ]),
    ];
    const caughtHere = zoneSpeciesIds.filter((id) => this.state.caughtDex.includes(id)).length;
    const chestsTotal = (selZone.chests || []).length;
    const chestsOpened = (selZone.chests || []).filter((c) => (this.state.openedChests || []).includes(c.id)).length;
    const housesHtml = (selZone.houses || [])
      .map((h) => `<span class="move-chip" style="border-color:#fbbf24;">🏛️ ${h.label}</span>`)
      .join('');
    const wildsHtml = zoneSpeciesIds
      .map((id) => {
        const s = getSpecies(id);
        const caught = this.state.caughtDex.includes(id);
        const seen = caught || this.state.seenDex.includes(id);
        return `<span class="mini-mon-chip" style="border-color:${caught ? '#22c55e' : '#38bdf8'};">
          ${caught ? '🐵' : seen ? '👀' : '❓'} ${seen ? s.name : `#${String(s.dexNum).padStart(2, '0')} ???`}
        </span>`;
      })
      .join('');

    return `
      <div class="hub-two-col" style="grid-template-columns: 1.54fr 1fr;">
        <div class="world-atlas-wrap">
          <svg viewBox="0 0 920 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkemon 10-Realm Sky-Vine Atlas">
            <defs>
              <radialGradient id="oceanGrad" cx="55%" cy="38%" r="72%">
                <stop offset="0%" stop-color="#155e8a" />
                <stop offset="58%" stop-color="#0c3959" />
                <stop offset="100%" stop-color="#061a2e" />
              </radialGradient>
            </defs>
            <rect width="920" height="470" fill="url(#oceanGrad)" />
            <!-- Cartographic Sky-Vine Graticule -->
            <g stroke="rgba(125,211,252,0.11)" stroke-width="1">
              <line x1="0" y1="118" x2="920" y2="118" /><line x1="0" y1="235" x2="920" y2="235" /><line x1="0" y1="352" x2="920" y2="352" />
              <line x1="184" y1="0" x2="184" y2="470" /><line x1="368" y1="0" x2="368" y2="470" /><line x1="552" y1="0" x2="552" y2="470" /><line x1="736" y1="0" x2="736" y2="470" />
            </g>
            <!-- Title Banner -->
            <text x="22" y="32" fill="#fef3c7" font-family="Lilita One, Fredoka, sans-serif" font-size="19" letter-spacing="0.8">10-REALM SKY-VINE SPIRE ATLAS</text>
            <text x="22" y="50" fill="#7dd3fc" font-size="11.5" font-weight="700">Select a realm to see what lives there, then Fast Travel · ✨ Relics ${this.state.bananaRelics || 0}/${TOTAL_BANANA_RELICS}</text>
            ${routeLines.join('')}
            ${islandSvgNodes}
          </svg>
        </div>

        <div class="dex-inspector">
          <div class="pill-chip" style="margin-bottom:6px;">${selZone.worldMapNode?.regionTag || `REALM ${selZone.index}`}${selZone.id === this.state.zoneId ? ' · 📍 YOU ARE HERE' : ''}</div>
          <div class="dex-title-row">
            <h3>${selZone.worldMapNode?.icon || '🏝️'} ${selZone.name}</h3>
          </div>
          <div class="dex-subtitle">${selZone.subtitle}</div>
          <p class="dex-bio">${selZone.worldMapNode?.summary || ''}</p>

          <div class="dex-stats" style="grid-template-columns: repeat(4, 1fr);">
            <div><span>🧭 Banana Relics</span><strong>${(() => {
              const pr = getZoneRelicStatus(this.state, selZone.id);
              return `${pr.found}/${pr.total}`;
            })()}</strong></div>
            <div><span>Caught here</span><strong>${caughtHere}/${zoneSpeciesIds.length}</strong></div>
            <div><span>Chests opened</span><strong>${chestsOpened}/${chestsTotal}</strong></div>
            <div><span>Places to enter</span><strong>${(selZone.houses || []).length}</strong></div>
          </div>

          <div class="section-head"><h4 style="font-size:18px;">Places to enter</h4></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${housesHtml}</div>

          <div class="section-head"><h4 style="font-size:18px;">Monkemon living here</h4><span class="help">🐵 caught · 👀 seen · ❓ not found yet</span></div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">${wildsHtml}</div>

          <button type="button" class="cta-btn cta-primary" style="width:100%;" id="btn-atlas-travel" data-zone="${selZone.id}">
            ${
              selZone.id === this.state.zoneId
                ? `📍 Return to ${selZone.name} entrance`
                : `✈️ Fast travel to ${selZone.name}`
            } ${this.kbd('confirm')}
          </button>
        </div>
      </div>
    `;
  }

  _wireWorldMapTabEvents() {
    for (const node of this.elModal.querySelectorAll('[data-atlas-zone]')) {
      node.addEventListener('click', () => {
        const zId = node.getAttribute('data-atlas-zone');
        this.selectedMapZoneId = zId;
        this.audio.playSfx('menu');
        this.openMenuHub('map', { keepSelection: true });
      });
    }
    const travelBtn = this.elModal.querySelector('#btn-atlas-travel');
    if (travelBtn) {
      travelBtn.addEventListener('click', () => {
        const zId = travelBtn.getAttribute('data-zone');
        this.audio.playSfx('confirm');
        this.closeAllModals();
        this.cb.onFastTravel(zId);
      });
    }
  }

  // ---- TAB 5: TRELLIS.2 SANCTUARY LIVE 3D `.GLB` MONKEMON FORGE ----
  _buildForgeTabHtml() {
    this.renderer.turntableTargetCanvas = null;
    const typeOpts = Object.values(ELEMENTS)
      .map((e) => `<option value="${e.id}">${e.icon} ${e.label}</option>`)
      .join('');

    return `
      <form id="forge-form" class="forge-form">
        <div class="section-head"><h4>⚒️ 3D Forge</h4><span class="help">Describe a Monkemon and the TRELLIS.2 pipeline builds a 3D model that joins your squad (about a minute).</span></div>
        <div class="forge-row">
          <label for="forge-name">Name</label>
          <input id="forge-name" type="text" maxlength="18" value="Wafflemonk" required />
        </div>
        <div class="forge-row">
          <label for="forge-element">Type</label>
          <select id="forge-element">${typeOpts}</select>
        </div>
        <div class="forge-row">
          <label for="forge-prompt">What does it look like?</label>
          <textarea id="forge-prompt" rows="3">Cute cheerful golden waffle-hat capuchin monkey carrying a tiny maple syrup mug, glossy miniature vinyl figurine</textarea>
        </div>
        <div id="forge-status" class="forge-status">Ready. Forging takes about 60 seconds.</div>
        <div class="forge-actions">
          <button type="submit" class="cta-btn cta-primary" id="forge-submit-btn">✨ Forge this Monkemon</button>
        </div>
      </form>
    `;
  }

  _wireForgeTabEvents() {
    const form = this.elModal.querySelector('#forge-form');
    if (!form) return;
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

  // ---- KEYBOARD & STEAM DECK NAVIGATION INSIDE MODALS ----
  handleModalInput(input) {
    if (!input || input.typing) return;

    if (this.modal === 'title') {
      const starters = CORE_SPECIES.filter((s) => s.starter);
      if (input.menuNav.left || input.menuNav.right) {
        const curIdx = Math.max(0, starters.findIndex((s) => s.id === this.selectedStarter));
        const nextIdx = (curIdx + (input.menuNav.right ? 1 : -1) + starters.length) % starters.length;
        this.selectedStarter = starters[nextIdx].id;
        this.audio.playSfx('menu');
        const hasSave = Boolean(this.elTitle.querySelector('#btn-continue-save'));
        this.openTitleScreen(hasSave);
        return;
      }
      if (input.pressed.btnA) {
        const startBtn = document.getElementById('btn-continue-save') || document.getElementById('btn-new-adventure');
        if (startBtn) startBtn.click();
      }
      return;
    }

    if (this.modal === 'story' && this.activeStory) {
      const st = this.activeStory;
      const isLast = st.pageIdx >= st.scene.pages.length - 1;
      const hasChoices = isLast && st.choices && st.choices.length > 0;
      if (input.pressed.back || input.pressed.btnB) {
        const skip = this.elStory && this.elStory.querySelector('#story-skip-btn');
        if (skip) skip.click();
        return;
      }
      if (hasChoices && (input.menuNav.up || input.menuNav.down)) {
        const len = st.choices.length;
        st.choiceIdx = (st.choiceIdx + (input.menuNav.down ? 1 : -1) + len) % len;
        this.audio.playSfx('menu');
        this._renderStoryPage();
        return;
      }
      if (input.pressed.btnA) {
        if (hasChoices) {
          const btn = this.elStory && this.elStory.querySelector(`[data-story-choice="${st.choiceIdx}"]`);
          if (btn) btn.click();
        } else {
          const next = this.elStory && this.elStory.querySelector('#story-next-btn');
          if (next) next.click();
        }
      }
      return;
    }

    if (this.modal === 'ending') {
      if (input.pressed.btnA || input.pressed.back || input.pressed.btnB) {
        const btn = document.getElementById('ending-continue-btn');
        if (btn) btn.click();
      }
      return;
    }

    // Close on Esc / (B) / the Menu key / the same shortcut that opened this screen
    if (
      input.pressed.back ||
      input.pressed.btnB ||
      input.pressed.menu ||
      (this.modal === 'party' && input.pressed.party) ||
      (this.modal === 'dex' && input.pressed.dex) ||
      (this.modal === 'map' && input.pressed.map) ||
      (this.modal === 'forge' && input.pressed.forge)
    ) {
      this.closeAllModals();
      this.audio.playSfx('cancel');
      return;
    }

    // Direct shortcuts (V / B / M / P) jump between screens while the menu is open
    for (const [action, tabId] of [['party', 'party'], ['dex', 'dex'], ['map', 'map'], ['forge', 'forge']]) {
      if (input.pressed[action] && this.modal !== tabId) {
        this.audio.playSfx('menu');
        this.openMenuHub(tabId);
        return;
      }
    }

    // Previous / next screen with `[` `]` or LB / RB
    if (input.pressed.tabPrev || input.pressed.tabNext) {
      const idx = Math.max(0, HUB_TABS.findIndex((t) => t.id === this.modal));
      const next = (idx + (input.pressed.tabNext ? 1 : -1) + HUB_TABS.length) % HUB_TABS.length;
      this.audio.playSfx('menu');
      this.openMenuHub(HUB_TABS[next].id);
      return;
    }

    // Every screen uses the same cursor: arrows / D-pad move it spatially, A / Enter activates.
    // Landing on a selectable card (Monkemon, Dex entry, map realm) selects it immediately, so
    // browsing stays a single key press per item.
    const dir = ['left', 'right', 'up', 'down'].find((d) => input.menuNav[d]);
    if (dir) {
      if (this._moveNavFocus(dir)) {
        this.audio.playSfx('menu');
        const el = this._focusedNavEl();
        if (el && el.matches(AUTO_SELECT_SELECTOR)) this._activateEl(el);
      }
      return;
    }

    if (input.pressed.btnA) {
      const el = this._focusedNavEl();
      if (!el) {
        this._restoreNavFocus();
        return;
      }
      // A on the card that is already selected fires the screen's main action for it
      // (Map: fast travel, Squad: make lead / swap in) instead of re-selecting it.
      this._activateEl(this._primaryActionFor(el) || el);
    }
  }

  _primaryActionFor(cardEl) {
    if (!cardEl || !cardEl.matches(AUTO_SELECT_SELECTOR)) return null;
    let isSelected = false;
    let btn = null;
    if (this.modal === 'map') {
      isSelected = cardEl.getAttribute('data-atlas-zone') === this.selectedMapZoneId;
      btn = this.elModal.querySelector('#btn-atlas-travel');
    } else if (this.modal === 'party') {
      isSelected = cardEl.classList.contains('selected');
      btn = this.elModal.querySelector('#btn-set-lead') || this.elModal.querySelector('#btn-swap-storage');
    }
    return isSelected && btn && !btn.disabled ? btn : null;
  }

  // ---- SHARED MENU CURSOR (arrows / D-pad / mouse hover share one highlight) ----
  _navKeyOf(el) {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    const ds = el.dataset || {};
    const parts = Object.keys(ds)
      .filter((k) => k !== 'sig')
      .sort()
      .map((k) => `${k}=${ds[k]}`);
    if (parts.length) return parts.join('&');
    return `txt:${(el.textContent || '').trim().slice(0, 40)}`;
  }

  _navTargets() {
    if (!this.elModal || this.elModal.classList.contains('hidden')) return [];
    const out = [];
    for (const el of this.elModal.querySelectorAll(NAV_SELECTOR)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // collapsed or display:none
      out.push(el);
    }
    return out;
  }

  _focusedNavEl() {
    return this.elModal ? this.elModal.querySelector('.nav-focus') : null;
  }

  _setNavFocus(el, { scroll = true } = {}) {
    if (!this.elModal) return;
    const prev = this.elModal.querySelector('.nav-focus');
    if (prev && prev !== el) prev.classList.remove('nav-focus');
    if (!el) {
      this.navFocusKey = null;
      return;
    }
    el.classList.add('nav-focus');
    this.navFocusKey = this._navKeyOf(el);
    if (scroll && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // After a re-render, put the cursor back on the same item (by stable key); otherwise start on
  // the selected card, or the first item of the screen body rather than the tab bar.
  _restoreNavFocus() {
    const targets = this._navTargets();
    if (!targets.length) return;
    let el = this.navFocusKey ? targets.find((t) => this._navKeyOf(t) === this.navFocusKey) : null;
    if (!el) {
      const body = this.elModal.querySelector('.hub-body');
      const selected = body
        ? body.querySelector('.mon-collection-card.selected, .dex-card.selected, .board-tile.selected')
        : null;
      el =
        (selected && targets.includes(selected) ? selected : null) ||
        targets.find((t) => body && body.contains(t) && !t.disabled) ||
        targets[0];
    }
    this._setNavFocus(el, { scroll: true });
  }

  // Pick the next element in `dir`. Pass 1: elements that share the current row / column
  // (their cross-axis extents overlap) — nearest wins, ties broken by centre alignment.
  // Pass 2: anything inside a 45° cone in that direction. Otherwise the cursor stays put.
  _moveNavFocus(dir) {
    const targets = this._navTargets();
    if (!targets.length) return false;
    const cur = this._focusedNavEl();
    if (!cur || !targets.includes(cur)) {
      this._restoreNavFocus();
      return true;
    }
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    const horizontal = dir === 'left' || dir === 'right';
    let bestAligned = null;
    let bestAlignedScore = Infinity;
    let bestCone = null;
    let bestConeScore = Infinity;
    for (const t of targets) {
      if (t === cur) continue;
      const r = t.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      const primary = horizontal ? (dir === 'right' ? dx : -dx) : dir === 'down' ? dy : -dy;
      if (primary <= 2) continue;
      // Gap between the cross-axis extents (0 when the two elements overlap on that axis).
      const crossCentre = horizontal ? Math.abs(dy) : Math.abs(dx);
      const crossGap = Math.max(0, crossCentre - (horizontal ? (cr.height + r.height) / 2 : (cr.width + r.width) / 2));
      if (crossGap <= 0) {
        const score = primary + crossCentre * 0.25;
        if (score < bestAlignedScore) {
          bestAlignedScore = score;
          bestAligned = t;
        }
      } else if (crossGap <= primary) {
        const score = primary + crossGap * 2;
        if (score < bestConeScore) {
          bestConeScore = score;
          bestCone = t;
        }
      }
    }
    const best = bestAligned || bestCone;
    if (!best) return false;
    this._setNavFocus(best, { scroll: true });
    return true;
  }

  _activateEl(el) {
    if (!el) return;
    if (el.disabled) {
      this.audio.playSfx('cancel');
      return;
    }
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      el.focus();
      return;
    }
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // ---------------------------------------------------------------------------
  // 3. CHAMPION VICTORY ENDING MODAL (`#20 KING MONKEZILLA` TAMED / DEFEATED!)
  // ---------------------------------------------------------------------------
  openEndingModal() {
    this.modal = 'ending';
    this.renderer.turntableTargetCanvas = null;
    if (this.elStory) this.elStory.classList.add('hidden');
    this.elModal.classList.remove('hidden');
    this.audio.playMusic('ending', true);
    this.audio.playVoice('narrator_ending', {
      speaker: 'SAGE LIANA & EXPLORER DAD',
      line: 'King Monkezilla is calm again, all 77 Golden Banana Relics shine along the Sky-Vine Tree, and Mom and Explorer Dad are ready for your next big family adventure!',
    });

    this.elModal.innerHTML = `
      <div class="modal-card ending-card">
        <div class="pill-chip">🌟 SKY-VINE TREE RESTORED · EPILOGUE 🌟</div>
        <h2>WELCOME HOME, ${this.state.playerName}!</h2>
        <p class="ending-lead">
          With <strong>#20 King Monkezilla</strong> calmed at the top of Mount Cinderpeak, <strong>Sage Liana</strong>
          and the <strong>Golden Banana Relics</strong> heal the quakes across all <strong>10 Worlds</strong>!
          <strong>Explorer Dad</strong>, <strong>Sensei Bob</strong>, and <strong>Scout Kai</strong> celebrate your return to Hometown Cove,
          <strong>Mom</strong> serves everyone hot peanut-butter toast—and when Dad spots a new island beyond the horizon,
          <strong>both Mom &amp; Dad pack their bags to set off on a brand-new family adventure with you!</strong>
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
          <span>Golden Relics: <strong>✨ ${this.state.bananaRelics || 0} / ${TOTAL_BANANA_RELICS}</strong></span>
          <span>Key Artifacts: <strong>💎 ${(this.state.keyItems || []).length} / ${Object.keys(KEY_ITEMS_META).length}</strong></span>
          <span>House Badges: <strong>${this.state.badges.length} / 4</strong></span>
        </div>
        <button class="cta-btn cta-primary" id="ending-continue-btn">🌟 CONTINUE ADVENTURING WITH MOM &amp; DAD!</button>
      </div>
    `;

    this.elModal.querySelector('#ending-continue-btn').addEventListener('click', () => {
      this.closeAllModals();
      this.cb.onResumeZoneMusic();
    });
  }

  // ---------------------------------------------------------------------------
  // 4. FRAME-BY-FRAME LIVE HUD SYNC (OVERWORLD + MINI-MAP & TURN-BASED BATTLE)
  // ---------------------------------------------------------------------------
  updateHUD({ inBattle, zone, world, battle }) {
    if (this.modal === 'title') return;

    if (inBattle && battle && battle.active) {
      this.elHud.classList.add('hidden');
      this.elBattle.classList.remove('hidden');
      this.elPrompt.classList.add('hidden');
      this._syncBattleHUD(battle);
    } else {
      this.elBattle.classList.add('hidden');
      this.elHud.classList.remove('hidden');
      this._syncOverworldHUD(zone, world);
    }
  }

  setHudMode(mode) {
    this.hudMode = mode === 'full' ? 'full' : 'minimal';
    writeUiPref(HUD_PREF_KEY, this.hudMode);
    if (this.elHud) this.elHud.classList.toggle('hud-minimal', this.hudMode !== 'full');
  }

  _syncOverworldHUD(zone, world) {
    // Key caps / mute state / context prompt are needed in both modes
    this._syncInputModeCaps();
    this._syncMuteButton();
    this._syncContextPrompt(world);

    const minimal = this.hudMode !== 'full';
    if (this.elHud.classList.contains('hud-minimal') !== minimal) {
      this.elHud.classList.toggle('hud-minimal', minimal);
    }
    // Minimal mode: the game is the UI — nothing else to update (saves the per-frame mini-map draw).
    if (minimal) return;

    const zTitle = document.getElementById('hud-zone-name');
    const zSub = document.getElementById('hud-zone-sub');
    if (world && world.isInsideHouse && world.activeHouse) {
      const spec = world.interiorDiorama && world.interiorDiorama.mapSpec;
      const hTitle = `🏛️ ${(spec && spec.title) || world.activeHouse.label}`;
      const hSub = (spec && spec.subtitle) || `${zone ? zone.name : 'Realm'} · Walk South Mat to Exit`;
      if (zTitle && zTitle.textContent !== hTitle) zTitle.textContent = hTitle;
      if (zSub && zSub.textContent !== hSub) zSub.textContent = hSub;
    } else if (zone) {
      const sub = world && world.currentSubregion;
      const outTitle = sub ? `${zone.name} · ${sub.name}` : zone.name;
      const outSub = sub && sub.subtitle ? sub.subtitle : zone.subtitle;
      if (zTitle && zTitle.textContent !== outTitle) zTitle.textContent = outTitle;
      if (zSub && zSub.textContent !== outSub) zSub.textContent = outSub;
    }

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    setTxt('hud-relics', `${this.state.bananaRelics || 0}/${TOTAL_BANANA_RELICS}`);
    const prism = getZoneRelicStatus(this.state, (zone && zone.id) || this.state.zoneId || 'sunpalm');
    setTxt('hud-prism-here', prism.remaining === 0 ? 'Clear!' : `${prism.remaining} left`);
    const guest = getGuestCompanion(this.state);
    const compChip = document.getElementById('hud-companion-chip');
    if (compChip) {
      compChip.style.display = guest ? 'inline-flex' : 'none';
      if (guest) setTxt('hud-companion-name', guest.name);
    }
    setTxt('hud-balls', String(this.state.monkeballs || 0));
    setTxt('hud-superballs', String(this.state.superBalls || 0));
    setTxt('hud-berries', String(this.state.berries || 0));
    setTxt('hud-coins', String(this.state.coins || 0));
    setTxt('hud-badges', `${this.state.badges.length}/4`);
    setTxt('hud-dex-count', `${this.state.caughtDex.length}/20`);

    const activeChap = getActiveStoryChapter(this.state);
    setTxt('hud-story-title', `📜 ${activeChap.title}`);
    setTxt('hud-story-obj', activeChap.objective);

    // Prominent Hero & Active Partner HP Plaque
    const lead = this.state.party[this.state.activeIndex] || this.state.party[0];
    if (lead) {
      const sp = getSpecies(lead.speciesId);
      const el = ELEMENTS[sp.element] || ELEMENTS.mug;
      const leadImg = document.getElementById('hud-lead-img');
      if (leadImg && leadImg.getAttribute('data-sp') !== sp.id) {
        leadImg.setAttribute('data-sp', sp.id);
        leadImg.src = sp.concept;
      }
      setTxt('hud-tamer-tag', `${(this.state.playerName || 'ALEX').toUpperCase()}’S PARTNER`);
      setTxt('hud-lead-name', `${el.icon} ${lead.nickname}`);
      setTxt('hud-lead-lv', `Lv.${lead.level}`);
      setTxt('hud-lead-hp-num', `HP ${lead.hp} / ${lead.maxHp}`);
      const pct = Math.max(0, Math.min(100, (lead.hp / Math.max(1, lead.maxHp)) * 100));
      const fill = document.getElementById('hud-lead-hp-fill');
      if (fill) {
        fill.style.width = `${pct.toFixed(1)}%`;
        fill.style.background = pct < 26 ? '#ef4444' : pct < 55 ? '#f59e0b' : '#22c55e';
      }
    }

    // 6-Slot Party Strip with numerical HP mini readout (shown when Squad has 2+ Monkemon)
    const partyStrip = document.getElementById('hud-party-strip');
    if (partyStrip) {
      partyStrip.style.display = this.state.party.length > 1 ? 'flex' : 'none';
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
            const hpCol = pct < 26 ? '#ef4444' : pct < 55 ? '#f59e0b' : '#4ade80';
            const act = idx === this.state.activeIndex ? 'active' : '';
            return `
              <button type="button" class="party-slot ${act}" data-party-idx="${idx}">
                <span class="ps-icon">${el.icon}</span>
                <div class="ps-info">
                  <div class="ps-top"><strong>${m.nickname}</strong><span>Lv.${m.level}</span></div>
                  <div class="hp-track"><div class="hp-fill" style="width:${pct}%;background:${hpCol}"></div></div>
                  <div class="ps-hp-mini">HP ${m.hp}/${m.maxHp}</div>
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
            if (world) world.refreshPartnerActor();
          });
        }
      }
    }

    // Live Corner Island / Interior Mini-Map Radar
    if (zone && world && this.minimapCanvas) {
      this._drawMiniMap(zone, world);
    }
  }

  // "Press Enter to enter ALEX HOUSE" style prompt — the one piece of overworld UI kept in minimal mode.
  // Prompts arrive as plain text with `[Key / (Button)]` pairs; render the pair as a single key cap
  // for the active input mode so it matches the rest of the UI.
  _syncContextPrompt(world) {
    if (!this.elPrompt) return;
    if (world && world.promptText && !this.modal) {
      this.elPrompt.classList.remove('hidden');
      const mode = this.inputMode();
      const sig = `${mode}|${world.promptText}`;
      if (this.elPrompt.dataset.sig !== sig) {
        this.elPrompt.dataset.sig = sig;
        const escaped = String(world.promptText)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        this.elPrompt.innerHTML = escaped.replace(
          /\[\s*([^\]/()]+?)\s*\/\s*\(([^)]+)\)\s*\]/g,
          (_m, keyboardKey, padBtn) => `<kbd class="key">${mode === 'keyboard' ? keyboardKey.trim() : padBtn.trim()}</kbd>`,
        );
      }
    } else {
      this.elPrompt.classList.add('hidden');
    }
  }

  _drawMiniMap(zone, world) {
    const cv = this.minimapCanvas;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;
    const h = cv.height;

    if (world.isInsideHouse && world.interiorDiorama) {
      const idio = world.interiorDiorama;
      const spec = idio.mapSpec;
      ctx.fillStyle = '#09111e';
      ctx.fillRect(0, 0, w, h);

      if (spec && Array.isArray(spec.grid) && idio.cols > 0 && idio.rows > 0) {
        const pad = 6;
        const cellSz = Math.min((w - pad * 2) / idio.cols, (h - pad * 2) / idio.rows);
        const gridW = cellSz * idio.cols;
        const gridH = cellSz * idio.rows;
        const ox = (w - gridW) * 0.5;
        const oy = (h - gridH) * 0.5;

        for (let r = 0; r < idio.rows; r++) {
          const rowStr = spec.grid[r] || '';
          for (let c = 0; c < idio.cols; c++) {
            const ch = rowStr[c] || '#';
            if (ch === '#') ctx.fillStyle = '#334155';
            else if (ch === 'P') ctx.fillStyle = '#64748b';
            else if (ch === '~') ctx.fillStyle = '#0284c7';
            else if (ch === '^') ctx.fillStyle = '#ea580c';
            else if (ch === '=') ctx.fillStyle = '#d97706';
            else if (ch === '+') ctx.fillStyle = '#22c55e';
            else if (ch === '>') ctx.fillStyle = '#facc15';
            else if (ch === 'D') ctx.fillStyle = '#a855f7';
            else ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(ox + c * cellSz, oy + r * cellSz, Math.ceil(cellSz), Math.ceil(cellSz));
          }
        }

        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(ox, oy, gridW, gridH);

        const toCellPt = (wx, wz) => {
          const hw = idio.cols * idio.tileSize * 0.5;
          const hd = idio.rows * idio.tileSize * 0.5;
          return {
            x: ox + ((wx + hw) / (idio.cols * idio.tileSize)) * gridW,
            y: oy + ((wz + hd) / (idio.rows * idio.tileSize)) * gridH,
          };
        };

        // South Exit Mat
        if (idio.exitZone) {
          const ep = toCellPt(idio.exitZone.x, idio.exitZone.z);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(ep.x - 5, ep.y - 2, 10, 4);
        }

        // Sub-area Warps / Stairs (Cyan)
        for (const wp of idio.warpInteractables || []) {
          const p = toCellPt(wp.x, wp.z);
          ctx.fillStyle = '#22d3ee';
          ctx.fillRect(p.x - 2.6, p.y - 2.6, 5.2, 5.2);
        }

        // Unopened Interior Chests (Gold)
        for (const ch of idio.chestInteractables || []) {
          if (!ch.opened) {
            const p = toCellPt(ch.x, ch.z);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(p.x - 2.2, p.y - 2.2, 4.4, 4.4);
          }
        }

        // NPC / Boss Stations
        for (const st of idio.stations || []) {
          const p = toCellPt(st.x, st.z);
          ctx.fillStyle =
            st.kind === 'trainer' ? '#ef4444' : st.kind === 'heal' || st.kind === 'mom' ? '#22c55e' : '#3b82f6';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Roaming Dungeon Wilds / Bosses
        for (const we of world.interiorWildEntities || []) {
          const p = toCellPt(we.x, we.z);
          ctx.fillStyle = we.isFinalBoss || we.isAlpha ? '#dc2626' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(p.x, p.y, we.isFinalBoss ? 3.5 : 2.3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Pulsing Hero Marker
        const hp = toCellPt(world.heroX, world.heroZ);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        return;
      }
    }

    // Outdoor Curved Realm Radar
    ctx.fillStyle = zone.theme === 'volcano' ? '#2c0f0c' : zone.theme === 'sky' ? '#09152b' : '#0c4a6e';
    ctx.fillRect(0, 0, w, h);

    const hw = (zone.bounds?.halfW || 30) * 1.12;
    const hd = (zone.bounds?.halfD || 26) * 1.12;
    const toMini = (wx, wz) => ({
      x: w * 0.5 + (wx / hw) * (w * 0.46),
      y: h * 0.5 + (wz / hd) * (h * 0.46),
    });

    const outline = world.outdoorDiorama && world.outdoorDiorama.coastOutline;
    if (outline && outline.length > 3) {
      ctx.beginPath();
      outline.forEach((pt, i) => {
        const p = toMini(pt.x, pt.z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = zone.groundColor || '#67c956';
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = zone.theme === 'volcano' ? '#fb923c' : zone.theme === 'sky' ? '#bae6fd' : '#fde68a';
      ctx.stroke();
    }

    // Sub-biome terrain patches on the outdoor radar (sand, snow, basalt, stone, grove, wetland, flowerfield)
    const biomeColors = {
      sand: 'rgba(253, 224, 138, 0.52)',
      snow: 'rgba(241, 245, 249, 0.58)',
      basalt: 'rgba(68, 64, 60, 0.55)',
      stone: 'rgba(148, 163, 184, 0.48)',
      grove: 'rgba(22, 101, 52, 0.45)',
      wetland: 'rgba(14, 165, 233, 0.36)',
      flowerfield: 'rgba(244, 114, 182, 0.38)',
    };
    for (const bp of zone.biomePatches || []) {
      const p = toMini(bp.x, bp.z);
      const rx = ((bp.rx || 12) / hw) * (w * 0.46);
      const rz = ((bp.rz || 10) / hd) * (h * 0.46);
      ctx.fillStyle = biomeColors[bp.kind] || 'rgba(253, 224, 138, 0.4)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(2, rx), Math.max(2, rz), bp.rot || 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Water / Magma channels
    for (const ch of zone.waterChannels || []) {
      const p0 = toMini(ch.x0, ch.z0);
      const p1 = toMini(ch.x1, ch.z1);
      ctx.strokeStyle = zone.theme === 'volcano' ? '#f97316' : '#38bdf8';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    // Mountain Ridge Walls (Slate/Brown Bars)
    for (const mw of zone.mountainWalls || []) {
      const p0 = toMini(mw.x0, mw.z0);
      const p1 = toMini(mw.x1, mw.z1);
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    // Walled Estate / Metropolis Ramparts (Gold-Trimmed Stone)
    for (const cw of zone.cityWalls || []) {
      const p0 = toMini(cw.x0, cw.z0);
      const p1 = toMini(cw.x1, cw.z1);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    // Enterable Towns, Houses, Shrines & Dungeons (Gold Squares)
    for (const hs of zone.houses || []) {
      const p = toMini(hs.x, hs.z);
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.1;
      ctx.fillRect(p.x - 3.2, p.y - 3.2, 6.4, 6.4);
      ctx.strokeRect(p.x - 3.2, p.y - 3.2, 6.4, 6.4);
    }

    // Sky-Vine Pillars (Glowing Emerald/Gold Portals)
    for (const sp of (world.outdoorDiorama && world.outdoorDiorama.skyPillarInteractables) || []) {
      const p = toMini(sp.x, sp.z);
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Unopened Supply Chests (Cyan Diamonds)
    for (const ch of (world.outdoorDiorama && world.outdoorDiorama.chestInteractables) || []) {
      if (!ch.opened) {
        const p = toMini(ch.x, ch.z);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(p.x - 2.1, p.y - 2.1, 4.2, 4.2);
      }
    }

    // Roaming Wild Monkemon
    for (const we of world.wildEntities || []) {
      const p = toMini(we.x, we.z);
      ctx.fillStyle = we.isAlpha ? '#ef4444' : '#fef08a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, we.isAlpha ? 3.2 : 2.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pulsing Hero ALEX Marker
    const heroP = toMini(world.heroX, world.heroZ);
    const pulse = 3.8 + Math.sin(performance.now() * 0.007) * 1.1;
    ctx.fillStyle = 'rgba(250, 204, 21, 0.38)';
    ctx.beginPath();
    ctx.arc(heroP.x, heroP.y, pulse + 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(heroP.x, heroP.y, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // 5. TURN-BASED COMMAND-MENU BATTLE HUD SYNC
  // ---------------------------------------------------------------------------
  _syncBattleHUD(battle) {
    const p = battle.playerUnit;
    const e = battle.enemyUnit;
    if (!p || !e) return;
    this._syncInputModeCaps();

    const pEl = ELEMENTS[p.species.element] || ELEMENTS.mug;
    const eEl = ELEMENTS[e.species.element] || ELEMENTS.mug;

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };

    // Portraits
    const pImg = document.getElementById('bf-p-img');
    if (pImg && pImg.getAttribute('data-sp') !== p.species.id) {
      pImg.setAttribute('data-sp', p.species.id);
      pImg.src = p.species.concept;
    }
    const eImg = document.getElementById('bf-e-img');
    if (eImg && eImg.getAttribute('data-sp') !== e.species.id) {
      eImg.setAttribute('data-sp', e.species.id);
      eImg.src = e.species.concept;
    }

    // Player Status Plaque
    const activeGuest = getGuestCompanion(this.state);
    setTxt(
      'bf-p-coach',
      activeGuest
        ? `★ ${this.state.playerName || 'ALEX'} · 🤝 ${activeGuest.name.toUpperCase()}`
        : `★ ${this.state.playerName || 'ALEX'}’S PARTNER`,
    );
    setTxt('bf-p-name', `${pEl.icon} ${p.mon.nickname}`);
    setTxt('bf-p-lv', `Lv.${p.mon.level}`);
    setTxt('bf-p-type-tag', `${pEl.icon} ${pEl.label.toUpperCase()} TYPE`);
    const rawPDisp = p.displayHp ?? p.mon.hp;
    const pDispHp =
      p.mon.hp <= 0 && rawPDisp < 0.5
        ? 0
        : Math.max(p.mon.hp > 0 ? 1 : 0, Math.min(p.mon.maxHp, Math.round(rawPDisp)));
    setTxt('bf-p-hp-txt', `HP: ${pDispHp} / ${p.mon.maxHp}`);
    const pPct = Math.max(0, Math.min(100, (rawPDisp / Math.max(1, p.mon.maxHp)) * 100));
    const pBar = document.getElementById('bf-p-hp-bar');
    if (pBar) {
      pBar.style.width = `${pPct.toFixed(1)}%`;
      pBar.style.background = pPct < 26 ? '#ef4444' : pPct < 55 ? '#f59e0b' : '#22c55e';
    }
    const expBar = document.getElementById('bf-p-exp-bar');
    if (expBar) {
      const expPct = Math.max(4, Math.min(100, ((p.mon.exp || 0) / Math.max(1, expRequiredForLevel(p.mon.level))) * 100));
      expBar.style.width = `${expPct.toFixed(1)}%`;
    }

    // Player Party Pips (6 slots)
    const pPips = document.getElementById('bf-p-pips');
    if (pPips) {
      const pSig = this.state.party.map((m) => (m.hp > 0 ? '1' : '0')).join('');
      if (pPips.dataset.sig !== pSig) {
        pPips.dataset.sig = pSig;
        pPips.innerHTML = Array.from({ length: 6 }, (_, i) => {
          const m = this.state.party[i];
          const cls = !m ? '' : m.hp > 0 ? 'alive' : 'fainted';
          return `<span class="tb-pip ${cls}"></span>`;
        }).join('');
      }
    }

    // Opponent Status Plaque
    const alreadyCaught = battle.mode === 'wild' && this.state.caughtDex.includes(e.species.id);
    const caughtBadge = alreadyCaught ? ' · 🐵 CAUGHT' : '';
    const rivalHeader =
      battle.mode === 'trainer' && battle.trainerDef
        ? `⚔️ ${battle.trainerDef.name.toUpperCase()}`
        : battle.wildRef && battle.wildRef.isFinalBoss
          ? `👑 BOSS #20${caughtBadge}`
          : e.mon.isAlpha
            ? `👑 APEX GUARDIAN${caughtBadge}`
            : `🌿 WILD MONKEMON${caughtBadge}`;
    setTxt('bf-e-coach', rivalHeader);
    setTxt('bf-e-name', `${eEl.icon} ${e.mon.nickname}`);
    setTxt('bf-e-lv', `Lv.${e.mon.level}`);
    setTxt('bf-e-type-tag', `${eEl.icon} ${eEl.label.toUpperCase()} TYPE`);
    const rawEDisp = e.displayHp ?? e.mon.hp;
    const eDispHp =
      e.mon.hp <= 0 && rawEDisp < 0.5
        ? 0
        : Math.max(e.mon.hp > 0 ? 1 : 0, Math.min(e.mon.maxHp, Math.round(rawEDisp)));
    setTxt('bf-e-hp-txt', `HP: ${eDispHp} / ${e.mon.maxHp}`);
    const ePct = Math.max(0, Math.min(100, (rawEDisp / Math.max(1, e.mon.maxHp)) * 100));
    const eBar = document.getElementById('bf-e-hp-bar');
    if (eBar) {
      eBar.style.width = `${ePct.toFixed(1)}%`;
      eBar.style.background = ePct < 26 ? '#ef4444' : ePct < 55 ? '#f59e0b' : '#22c55e';
    }

    const ePips = document.getElementById('bf-e-pips');
    if (ePips) {
      const eSig = (battle.enemyTeam || []).map((m) => (m.hp > 0 ? '1' : '0')).join('');
      if (ePips.dataset.sig !== eSig) {
        ePips.dataset.sig = eSig;
        ePips.innerHTML = (battle.enemyTeam || [])
          .map((m) => `<span class="tb-pip ${m.hp > 0 ? 'alive' : 'fainted'}"></span>`)
          .join('');
      }
    }

    // Narration Headline & Sub-Prompt
    const headline = battle.bannerText || `Your Turn — Choose ${p.mon.nickname}’s Action!`;
    const subText = battle.narrationSub || '';
    setTxt('battle-banner-txt', headline);
    setTxt('battle-sub-txt', subText);

    // Command deck (`#battle-menu-grid`): a FIXED 2×2 grid. Each command keeps its position and
    // meaning for the whole battle; while a turn plays out the buttons are disabled in place (Run
    // Away stays live) and a "▶ Next" button appears in its own fixed slot in the narration box.
    // The DOM is only rebuilt when the content changes (counts, catch %), never on cursor moves.
    const grid = document.getElementById('battle-menu-grid');
    if (!grid) return;
    this._battleRef = battle;

    if (!grid._delegatedBound) {
      grid._delegatedBound = true;
      const fireBtn = (btn) => {
        const b = this._battleRef;
        if (!btn || !b || !b.active || btn.disabled) return;
        if (btn.hasAttribute('data-broot')) {
          b.selectRootOption(parseInt(btn.getAttribute('data-broot'), 10));
        } else if (btn.id === 'btn-battle-superball') {
          b.tryThrowBattleMonkeball(true);
        } else if (btn.id === 'btn-battle-berry') {
          b.useBerryInBattle();
        } else if (btn.id === 'btn-battle-swap') {
          b.cyclePartySwitch();
        }
      };

      grid.addEventListener('pointerdown', (ev) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn) return;
        ev.preventDefault();
        grid._handledPointerDownTs = performance.now();
        fireBtn(btn);
      });

      grid.addEventListener('click', (ev) => {
        if (grid._handledPointerDownTs && performance.now() - grid._handledPointerDownTs < 380) return;
        const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn) return;
        fireBtn(btn);
      });

      // Hover moves the cursor only when the pointer really moved — a re-render or layout change
      // under a resting pointer must not steal focus from the D-pad / keyboard.
      grid.addEventListener('pointerover', (ev) => {
        const b = this._battleRef;
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-broot]') : null;
        if (btn && b && b.menuState === 'root' && !btn.disabled && this._pointerMovedRecently()) {
          b.rootCursor = parseInt(btn.getAttribute('data-broot'), 10);
        }
      });

      const nextBtn = document.getElementById('btn-battle-advance');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          const b = this._battleRef;
          if (b && b.active) b.advanceOrSkipStep();
        });
      }
    }

    const animating = battle.menuState === 'animating';
    const catchPct = battle.getLiveCatchPercent(false);
    const superPct = battle.getLiveCatchPercent(true);
    const quickMove = battle.getQuickStrikeMove();
    const specMove = battle.getSpecialMove();
    const gridSig = [
      battle.mode,
      p.mon.uid,
      e.species.id,
      this.state.monkeballs,
      this.state.superBalls,
      this.state.berries,
      catchPct,
      superPct,
      this.state.party.length,
      this.inputMode(),
    ].join('|');

    if (grid.dataset.sig !== gridSig) {
      grid.dataset.sig = gridSig;

      // One key cap per button: keyboard shows the number key, gamepad shows the face button.
      const cap = (action) => this.keyLabel(action);
      const effTag = (mult, basePower) =>
        mult >= 1.35
          ? '<span class="tb-eff-tag">★ Super effective</span>'
          : mult <= 0.75
            ? '<span style="color:#fca5a5;">Not very effective</span>'
            : `Power ${basePower}`;

      const qElem = quickMove ? resolveMoveElement(quickMove, p.species) : p.species.element;
      const qMult = getTypeMultiplier(qElem, e.species.element, e.species.secondaryElement);
      const sElem = specMove ? resolveMoveElement(specMove, p.species) : p.species.element;
      const sMeta = ELEMENTS[sElem] || ELEMENTS.mug;
      const sMult = getTypeMultiplier(sElem, e.species.element, e.species.secondaryElement);

      const itemBtn =
        battle.mode === 'wild'
          ? {
              title: `🐵 CATCH`,
              key: cap('slot3'),
              sub: `${catchPct}% chance · ${this.state.monkeballs} Monkeball${this.state.monkeballs === 1 ? '' : 's'} left`,
            }
          : {
              title: `🍌 HEAL`,
              key: cap('slot3'),
              sub: `+40% HP · ${this.state.berries} Berr${this.state.berries === 1 ? 'y' : 'ies'} left`,
            };

      // Fixed positions: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right (Run Away).
      const rootItems = [
        {
          title: `⚔️ ATTACK`,
          key: cap('slot1'),
          sub: `${quickMove ? quickMove.name : 'Strike'} · ${effTag(qMult, quickMove ? quickMove.power : 45)}`,
        },
        {
          title: `${sMeta.icon} ${specMove ? specMove.name.toUpperCase() : 'SPECIAL'}`,
          key: cap('slot2'),
          sub: `${sMeta.label} special · ${effTag(sMult, specMove ? specMove.power : 65)}`,
        },
        itemBtn,
        {
          title: '🏃 RUN AWAY',
          key: cap('slot4'),
          sub: 'Leave the battle — always works',
        },
      ];

      const extras = [];
      if (battle.mode === 'wild' && (this.state.superBalls || 0) > 0) {
        extras.push(
          `<button type="button" class="tb-extra-btn" id="btn-battle-superball" title="Throw a Golden Super Ball (1.85× catch rate)">🌟 Super Ball <span style="color:#fde047;">${superPct}%</span> · ×${this.state.superBalls}</button>`,
        );
      }
      if (battle.mode === 'wild' && (this.state.berries || 0) > 0) {
        extras.push(
          `<button type="button" class="tb-extra-btn" id="btn-battle-berry" title="Feed a Berry: +40% HP for you and the wild Monkemon becomes easier to catch">🍌 Berry · ×${this.state.berries} <kbd class="key">${cap('berryBattle')}</kbd></button>`,
        );
      }
      if (this.state.party.length > 1) {
        extras.push(
          `<button type="button" class="tb-extra-btn" id="btn-battle-swap" title="Send out your next Monkemon">🐾 Swap Monkemon <kbd class="key">${cap('swap')}</kbd></button>`,
        );
      }
      // The extras row is always present (reserved height) so the deck never resizes.
      const extrasRow = `<div class="tb-extras-row">${extras.length ? `<span class="tb-extras-label">ALSO</span>${extras.join('')}` : ''}</div>`;

      grid.innerHTML =
        rootItems
          .map(
            (item, idx) => `
            <button type="button" class="tb-menu-btn" data-broot="${idx}">
              <div class="tb-btn-top">
                <span>${item.title}</span>
                <span class="tb-key-badge">${item.key}</span>
              </div>
              <div class="tb-btn-sub">${item.sub}</div>
            </button>
          `,
          )
          .join('') + extrasRow;
    }

    // Per-frame state applied IN PLACE (no DOM rebuild): enable/disable, focus ring, Next button.
    for (const btn of grid.querySelectorAll('[data-broot]')) {
      const idx = parseInt(btn.getAttribute('data-broot'), 10);
      const live = !animating || idx === 3; // Run Away is always available
      if (btn.disabled === live) btn.disabled = !live;
      btn.classList.toggle('focused', !animating && battle.rootCursor === idx);
    }
    for (const btn of grid.querySelectorAll('.tb-extra-btn')) {
      if (btn.disabled !== animating) btn.disabled = animating;
    }

    const nextBtn = document.getElementById('btn-battle-advance');
    const showNext = animating && Boolean(battle.activeStep) && !battle.catchAnim && !battle.pendingEnd;
    if (nextBtn && nextBtn.classList.contains('hidden') === showNext) nextBtn.classList.toggle('hidden', !showNext);
    const footer = document.getElementById('battle-controls-footer');
    if (footer) {
      for (const lg of footer.querySelectorAll('.battle-legend')) {
        if (lg.classList.contains('hidden') !== showNext) lg.classList.toggle('hidden', showNext);
      }
    }
  }
}
