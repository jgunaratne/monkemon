// Monkemon Game UI, Turn-Based Battle Command Deck, Live Mini-Map & 5-Tab Tamer Menu Hub!
// Zero CSS `backdrop-filter` over the WebGL canvas (ensures smooth 60 FPS on Steam Deck & headless Chrome).
// Implements:
//   1. Title & 7-Type Starter Picker (`ALEX` default)
//   2. Overworld Hero + Partner HP Plaque (`HP: XX / YY`), 6-Slot Party Strip & Live Organic Island Mini-Map
//   3. Turn-Based Command-Menu Battle HUD (`FIGHT` / `CATCH / BAG` / `MONKEMON` / `RUN`) + Opponent & Player HP Cards
//   4. Unified 5-Tab Tamer Menu Hub (`[Tab / I / Start]`):
//        • Tab 1: `🐾 MY MONKEMON` (Active Squad 1–6 + Sanctuary Storage Box + 3D Turntable + Heal/Lead/Swap)
//        • Tab 2: `📖 MONKEDEX` (Browse All / Caught / Met, Encyclopedia Grid & 20-Boss Board + Habitat Hints)
//        • Tab 3: `🎒 BAG & CATCHING` (Inventory, Heal Squad, How-To-Catch & Where-To-Find-Monkeballs + Mart)
//        • Tab 4: `🗺️ WORLD MAP` (Illustrated Cartographic SVG Atlas of all 5 Curved Islands + Fast Travel)
//        • Tab 5: `⚒️ 3D FORGE` (Live TRELLIS.2-4B `.glb` Custom Monkemon Creator)
//   5. Daikon Voice Subtitle Banner + Grand Archipelago Champion Ending Screen.

import { ELEMENTS, MOVES, TYPE_CHART } from '../data/moves.js';
import { CORE_SPECIES, getAllSpecies, getSpecies, registerForgedSpecies } from '../data/species.js';
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

const HUB_TABS = [
  { id: 'party', label: '🐾 MY MONKEMON' },
  { id: 'dex', label: '📖 MONKEDEX' },
  { id: 'bag', label: '🎒 BAG & CATCHING' },
  { id: 'map', label: '🗺️ WORLD MAP' },
  { id: 'forge', label: '⚒️ 3D FORGE' },
];

export class UIManager {
  constructor({ renderer, modelBank, audio, input, state, callbacks }) {
    this.renderer = renderer;
    this.modelBank = modelBank;
    this.audio = audio;
    this.input = input;
    this.state = state;
    this.cb = callbacks;

    this.modal = null; // null | 'title' | 'party' | 'dex' | 'bag' | 'map' | 'forge' | 'ending'
    this.selectedStarter = 'mugchimp';

    // Tab 1 (`party`) state
    this.selectedCollectionRef = { location: 'party', index: 0 };

    // Tab 2 (`dex`) state
    this.selectedDexId = 'mugchimp';
    this.dexFilter = 'all'; // 'all' | 'caught' | 'seen'
    this.dexViewMode = 'grid'; // 'grid' | 'board'

    // Tab 4 (`map`) state
    this.selectedMapZoneId = 'sunpalm';

    this.toastTimer = null;
    this._habitatCache = null;

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
    bindClick('btn-open-menu', () => this.toggleMenuHub('party'));
    bindClick('btn-open-party', () => this.toggleMenuHub('party'));
    bindClick('btn-open-dex', () => this.toggleMenuHub('dex'));
    bindClick('btn-open-map', () => this.toggleMenuHub('map'));
    bindClick('btn-toggle-mute', () => {
      const muted = this.audio.toggleMute();
      const b = document.getElementById('btn-toggle-mute');
      if (b) b.textContent = muted ? '🔇 [N]' : '🔊 [N]';
    });
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
          <span class="pill-chip">2.5D TOY-DIORAMA RPG</span>
          <span class="pill-chip">TURN-BASED BATTLES + GLSL SHADERS</span>
          <span class="pill-chip">TRELLIS.2 3D ISLANDS</span>
          <span class="pill-chip">ELEVENLABS + LYRIA 3</span>
        </div>
        <h1 class="game-logo">MONKEMON</h1>
        <p class="game-sub">Explore 5 Curved Archipelago Islands · Enter Houses · Catch &amp; Browse All 20 Monkemon!</p>

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

  // ---------------------------------------------------------------------------
  // 2. UNIFIED 5-TAB TAMER MENU HUB (`party` | `dex` | `bag` | `map` | `forge`)
  // ---------------------------------------------------------------------------
  toggleModal(kind) {
    this.toggleMenuHub(kind);
  }

  toggleMenuHub(tab = 'party', opts = {}) {
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

  openMenuHub(tab = 'party', opts = {}) {
    const validTab = HUB_TABS.some((t) => t.id === tab) ? tab : 'party';
    this.modal = validTab;
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
      let badge = '';
      if (t.id === 'party') {
        const totalOwned = (this.state.party?.length || 0) + (this.state.storage?.length || 0);
        badge = ` (${totalOwned})`;
      } else if (t.id === 'dex') {
        badge = ` (${this.state.caughtDex.length}/20)`;
      } else if (t.id === 'bag') {
        badge = ` (🐵${this.state.monkeballs})`;
      }
      const act = t.id === validTab ? 'active' : '';
      return `<button type="button" class="hub-tab-btn ${act}" data-hub-tab="${t.id}">${t.label}${badge}</button>`;
    }).join('');

    let bodyHtml = '';
    if (validTab === 'party') bodyHtml = this._buildPartyTabHtml();
    else if (validTab === 'dex') bodyHtml = this._buildDexTabHtml();
    else if (validTab === 'bag') bodyHtml = this._buildBagTabHtml(opts);
    else if (validTab === 'map') bodyHtml = this._buildWorldMapTabHtml();
    else if (validTab === 'forge') bodyHtml = this._buildForgeTabHtml();

    this.elModal.innerHTML = `
      <div class="modal-card">
        <div class="hub-topbar">
          <div class="hub-tabs">${tabsHtml}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:11.5px;color:#94a3b8;font-weight:700;">Switch Tab: <strong style="color:#fbbf24;">[ / ]</strong> or <strong style="color:#fbbf24;">LB / RB</strong></span>
            <button type="button" class="close-btn" id="modal-close-btn">✕ Close [Esc / B]</button>
          </div>
        </div>
        ${bodyHtml}
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
        this.openMenuHub(nextTab);
      });
    }

    if (validTab === 'party') this._wirePartyTabEvents();
    else if (validTab === 'dex') this._wireDexTabEvents();
    else if (validTab === 'bag') this._wireBagTabEvents();
    else if (validTab === 'map') this._wireWorldMapTabEvents();
    else if (validTab === 'forge') this._wireForgeTabEvents();
  }

  // ---- TAB 1: MY MONKEMON (ACTIVE SQUAD + SANCTUARY STORAGE BOX) ----
  _buildPartyTabHtml() {
    const partyCards = this.state.party
      .map((m, idx) => {
        const sp = getSpecies(m.speciesId);
        const el = ELEMENTS[sp.element] || ELEMENTS.mug;
        const pct = Math.max(0, Math.min(100, Math.round((m.hp / Math.max(1, m.maxHp)) * 100)));
        const hpColor = pct < 28 ? '#ef4444' : pct < 56 ? '#f59e0b' : '#22c55e';
        const isSel = this.selectedCollectionRef.location === 'party' && this.selectedCollectionRef.index === idx;
        const isLead = idx === this.state.activeIndex;
        return `
          <button type="button" class="mon-collection-card ${isSel ? 'selected' : ''}" data-col-loc="party" data-col-idx="${idx}">
            <img src="${sp.concept}" alt="${m.nickname}" />
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
                <strong style="font-family:var(--font-display);font-size:16px;color:#fff;">${el.icon} ${m.nickname}</strong>
                <span style="font-size:12px;color:#7dd3fc;font-weight:800;">Lv.${m.level}</span>
              </div>
              <div style="font-size:11px;color:#fbbf24;margin:1px 0 4px;">
                ${isLead ? '★ ACTIVE LEAD PARTNER' : `Squad Slot #${idx + 1}`}
              </div>
              <div class="hp-track" style="height:7px;"><div class="hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:#e2e8f0;margin-top:3px;font-weight:800;">
                <span>HP: ${m.hp} / ${m.maxHp}</span>
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
                  <div style="font-family:var(--font-display);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${el.icon} ${m.nickname}</div>
                  <div style="font-size:11px;color:#93c5fd;">Lv.${m.level} · HP ${m.hp}/${m.maxHp}</div>
                </div>
              </button>
            `;
          })
          .join('')
      : `<div style="grid-column:1/-1;color:#94a3b8;font-size:12.5px;padding:12px;text-align:center;">
           Any Monkemon caught beyond your 6-slot Active Squad are safely stored here in your Sanctuary Box!
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

    return `
      <div class="hub-two-col">
        <div>
          <div class="section-label">ACTIVE SQUAD (${this.state.party.length} / 6 SLOTS) — TRAVELS WITH ${this.state.playerName}</div>
          <div class="caught-party-grid">${partyCards}</div>

          <div class="section-label">SANCTUARY STORAGE BOX (${this.state.storage.length} STORED MONKEMON)</div>
          <div class="storage-box-grid">${storageCards}</div>
        </div>

        <div class="dex-inspector">
          <div class="turntable-wrap">
            <canvas id="dex-turntable-canvas" width="248" height="228"></canvas>
            <div class="tt-caption">3D PARTNER TURNTABLE</div>
          </div>
          <div class="dex-title-row">
            <span class="dex-num">#${String(sp.dexNum || 21).padStart(2, '0')}</span>
            <h3>${selMon.nickname}</h3>
            <span class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">
              ${el.icon} ${el.label}
            </span>
          </div>
          <div class="dex-subtitle">
            Lv.${selMon.level} · HP: <strong style="color:#fde047;">${selMon.hp} / ${selMon.maxHp}</strong> · EXP: ${selMon.exp || 0}/${nextExp}
          </div>
          <div style="font-size:12px;color:#cbd5e1;margin-bottom:8px;">
            📍 Caught in: <strong>${caughtZoneName}</strong> · Species: <strong>${sp.name}</strong>
          </div>
          <div class="dex-stats">
            <div><span>HP</span><strong>${selMon.maxHp}</strong></div>
            <div><span>ATK</span><strong>${selMon.atk}</strong></div>
            <div><span>DEF</span><strong>${selMon.def}</strong></div>
            <div><span>SPD</span><strong>${selMon.spd}</strong></div>
          </div>
          <div class="section-label" style="margin-top:4px;">EQUIPPED TURN-BASED MOVES</div>
          <div class="dex-moves">
            ${bMoves
              .map((m, i) => {
                const mElem = ELEMENTS[resolveMoveElement(m, sp)] || el;
                return `<span class="move-chip">[${i + 1}] ${mElem.icon} ${m.name} (${m.healPct ? `Heal ${Math.round(m.healPct * 100)}%` : `Pwr ${m.power}`})</span>`;
              })
              .join('')}
          </div>

          <div class="inspector-actions">
            ${
              isParty && !isLead
                ? `<button type="button" class="mini-action-btn gold" id="btn-set-lead">★ Set Lead Partner</button>`
                : ''
            }
            ${
              isParty
                ? `<button type="button" class="mini-action-btn" id="btn-feed-berry">🍌 Feed Berry (+40% HP · ${this.state.berries} left)</button>`
                : `<button type="button" class="mini-action-btn gold" id="btn-swap-storage">🔄 Swap into Active Squad Lead</button>`
            }
            <button type="button" class="mini-action-btn" id="btn-inspect-in-dex">📖 View in MonkeDex</button>
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
              const statusTag = caught ? '🐵 Caught' : seen ? '👀 Met' : '❓ Unknown';
              return `
                <button type="button" class="dex-card ${statusCls} ${selCls}" data-dex-id="${entry.id}">
                  <div style="width:100%;display:flex;justify-content:space-between;font-size:10px;font-weight:800;color:#94a3b8;">
                    <span>#${String(entry.dexNum || 21).padStart(2, '0')}</span>
                    <span>${caught ? '🐵' : seen ? elem.icon : '❓'}</span>
                  </div>
                  <img src="${entry.concept}" alt="${seen ? entry.name : 'Unknown'}" />
                  <div style="font-family:var(--font-display);font-size:13.5px;color:#fff;">${seen ? entry.name : '???'}</div>
                  <div style="font-size:10px;font-weight:800;color:${caught ? '#4ade80' : seen ? '#7dd3fc' : '#64748b'};">${statusTag}</div>
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
        <div class="filter-pill-group">
          <button type="button" class="filter-pill ${this.dexFilter === 'all' ? 'active' : ''}" data-dex-filter="all">
            All Species (${allSpecies.length})
          </button>
          <button type="button" class="filter-pill ${this.dexFilter === 'caught' ? 'active' : ''}" data-dex-filter="caught">
            🐵 Caught (${this.state.caughtDex.length})
          </button>
          <button type="button" class="filter-pill ${this.dexFilter === 'seen' ? 'active' : ''}" data-dex-filter="seen">
            👀 Met (${this.state.seenDex.length})
          </button>
        </div>
        <div class="filter-pill-group">
          <button type="button" class="filter-pill ${this.dexViewMode === 'grid' ? 'active' : ''}" data-dex-view="grid">
            📖 Encyclopedia Grid
          </button>
          <button type="button" class="filter-pill ${this.dexViewMode === 'board' ? 'active' : ''}" data-dex-view="board">
            📋 20-Boss Board
          </button>
        </div>
      </div>

      <div class="hub-two-col">
        <div>${leftCollectionHtml}</div>

        <div class="dex-inspector">
          <div class="turntable-wrap">
            <canvas id="dex-turntable-canvas" width="248" height="228"></canvas>
            <div class="tt-caption">${isSeen ? 'LIVE TRELLIS.2 3D MESH' : 'UNDISCOVERED SILHOUETTE'}</div>
          </div>
          <div class="dex-title-row">
            <span class="dex-num">#${String(sp.dexNum || 21).padStart(2, '0')}</span>
            <h3>${isSeen ? sp.name : '???'}</h3>
            ${
              isSeen
                ? `<span class="type-pill" style="background:${el.badgeBg};border-color:${el.color};color:${el.glow}">${el.icon} ${el.label}</span>`
                : `<span class="type-pill" style="background:#1e293b;border-color:#64748b;color:#cbd5e1;">❓ Unknown Type</span>`
            }
          </div>
          <div class="dex-subtitle">
            ${
              isCaught
                ? `🐵 CAUGHT (Owned: ${ownedCount}) · ${sp.title}`
                : isSeen
                  ? `👀 MET IN THE WILD · Base Catch Rate: ${Math.round((sp.catchRate || 0.5) * 100)}%`
                  : `❓ NOT YET MET — Travel to its habitat below to discover!`
            }
          </div>
          <div style="font-size:12px;color:#fde047;background:#15253e;border:1px solid #334155;border-radius:10px;padding:6px 10px;margin-bottom:8px;">
            🗺️ <strong>Island Habitat:</strong> ${habitatStr}
          </div>
          <p class="dex-bio">
            ${
              isCaught
                ? sp.bio
                : isSeen
                  ? 'You have met this Monkemon! Weaken its HP in battle or toss a Sweet Berry, then throw a Smiling Monkeball to record its full bio!'
                  : 'Explore tall-grass meadows and island shrines on the World Map to encounter this mysterious Monkemon.'
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
                <div style="font-size:12px;color:#bae6fd;margin-bottom:8px;"><strong>Super Effective vs:</strong> ${strongVs}</div>
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

  // ---- TAB 3: BAG, HOW-TO-CATCH GUIDE & MONKEBALL MART ----
  _buildBagTabHtml() {
    this.renderer.turntableTargetCanvas = null;

    const shopRows = SHOP_CATALOG.map((item) => {
      const canAfford = (this.state.coins || 0) >= item.cost;
      return `
        <div class="bag-item-card" style="border-color:${canAfford ? '#38bdf8' : '#334155'};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-family:var(--font-display);font-size:15.5px;color:#fff;">${item.icon} ${item.name}</strong>
            <span style="font-weight:900;color:#fbbf24;font-size:13px;">🪙 ${item.cost}</span>
          </div>
          <div style="font-size:11.5px;color:#cbd5e1;line-height:1.35;margin:2px 0 6px;">${item.desc}</div>
          <button type="button" class="mini-action-btn ${canAfford ? 'gold' : ''}" data-buy-item="${item.id}">
            🛒 Buy (${item.cost} Coins)
          </button>
        </div>
      `;
    }).join('');

    const partyHealBtns = this.state.party
      .map((m, idx) => {
        const needsHeal = m.hp < m.maxHp;
        return `
          <button type="button" class="mini-action-btn ${needsHeal ? 'gold' : ''}" data-bag-heal="${idx}">
            🍌 Heal ${m.nickname} (${m.hp}/${m.maxHp} HP)
          </button>
        `;
      })
      .join('');

    return `
      <div class="hub-two-col">
        <div>
          <div class="section-label">YOUR TAMER SATCHEL &amp; BADGES (🪙 ${this.state.coins} COINS)</div>
          <div class="bag-cards-grid">
            <div class="bag-item-card" style="border-color:#fbbf24;">
              <div style="font-family:var(--font-display);font-size:17px;color:#fef3c7;">🐵 Smiling Monkeballs ×${this.state.monkeballs}</div>
              <div style="font-size:12px;color:#cbd5e1;">Standard capture spheres! Throw in the Overworld with <strong>[F / (Y)]</strong> or select <strong>2: CATCH / BAG</strong> in Turn-Based Battle!</div>
            </div>
            <div class="bag-item-card" style="border-color:#f59e0b;">
              <div style="font-family:var(--font-display);font-size:17px;color:#fde047;">🌟 Golden Super Balls ×${this.state.superBalls}</div>
              <div style="font-size:12px;color:#cbd5e1;"><strong>1.85× Catch Multiplier!</strong> Select inside Battle <strong>CATCH / BAG</strong> — auto-used in Overworld if regular Monkeballs hit 0!</div>
            </div>
            <div class="bag-item-card" style="border-color:#4ade80;">
              <div style="font-family:var(--font-display);font-size:17px;color:#bbf7d0;">🍌 Sweet Berries ×${this.state.berries}</div>
              <div style="font-size:12px;color:#cbd5e1;">Toss at wild Monkemon with <strong>[E / (X)]</strong> for <strong>+42% Catch Bonus</strong>, or feed to heal <strong>+40% HP</strong>!</div>
            </div>
            <div class="bag-item-card" style="border-color:#38bdf8;">
              <div style="font-family:var(--font-display);font-size:17px;color:#bae6fd;">🏅 House Badges: ${this.state.badges.length} / 4</div>
              <div style="font-size:12px;color:#cbd5e1;">Each House Leader badge boosts your Monkeball capture lock-on across every island!</div>
            </div>
          </div>

          <div class="section-label">QUICK-HEAL SQUAD WITH SWEET BERRIES (${this.state.berries} LEFT)</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;">${partyHealBtns}</div>

          <div class="section-label">🏪 MONKEBALL EXPRESS MART — RESTOCK ANYTIME</div>
          <div class="bag-cards-grid">${shopRows}</div>
        </div>

        <div class="dex-inspector">
          <div class="section-label">🎯 HOW TO CATCH OTHER MONKEMON (2 EASY WAYS!)</div>
          <div class="guide-step-card">
            <strong>Way 1 — Calm Turn-Based Battle Catch (Recommended!):</strong><br />
            Walk up to any wild Monkemon and press <strong>[Enter / Space / (A)]</strong> to start a turn-based battle. Use <strong>1: ⚔️ FIGHT</strong> to lower its HP into yellow/red, then pick <strong>2: 🐵 CATCH / BAG</strong> to see the live Catch % and throw a <strong>Monkeball</strong> or <strong>Golden Super Ball</strong>!
          </div>
          <div class="guide-step-card">
            <strong>Way 2 — Field Timing-Ring Catch (Direct Overworld!):</strong><br />
            Stand near a roaming wild Monkemon, press <strong>[E / (X)]</strong> to toss a <strong>🍌 Sweet Berry (+42% catch!)</strong>, then press <strong>[F / (Y)]</strong> to open the shrinking gold Timing Ring and press <strong>[F / (Y)]</strong> again when the ring is tight for <em>GREAT! / EXCELLENT!</em> lock-on!
          </div>

          <div class="section-label" style="margin-top:12px;">📍 WHERE TO FIND MORE MONKEBALLS</div>
          <div class="guide-step-card" style="border-left-color:#38bdf8;">
            • <strong>Glowing 3D Monkeballs on Islands:</strong> Walk right over shiny red/gold 3D Monkeballs along beaches, bridges &amp; trails (+3 Balls or +1 Super Ball!).<br />
            • <strong>3D Treasure Supply Chests:</strong> Open ornate chests on cliffs, piers &amp; groves with <strong>[Enter / (A)]</strong> for +5–8 Monkeballs, Super Balls &amp; Coins!<br />
            • <strong>Enter Houses &amp; Monkeball Lab:</strong> Walk inside <strong>Monkeball Lab</strong> (Hometown Cove) or any Sanctuary House for free Monkeball restocks &amp; 100% Party Healing!<br />
            • <strong>Monkeball Mart Counter:</strong> Spend Tamer Coins from battles right here in the Mart!
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

    // Sea lane connectors between `worldMapNode` centers
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
        const my = (n1.y + n2.y) * 0.5 - 16;
        const isBridge = /Bridge|Causeway/i.test(r.via);
        routeLines.push(`
          <path d="M ${n1.x} ${n1.y} Q ${mx} ${my} ${n2.x} ${n2.y}"
            fill="none"
            stroke="${isBridge ? '#fbbf24' : '#7dd3fc'}"
            stroke-width="${isBridge ? '4' : '2.6'}"
            stroke-dasharray="${isBridge ? '8 5' : '6 7'}"
            opacity="0.82" />
        `);
      }
    }

    const islandSvgNodes = ZONE_LIST.map((z) => {
      const n = z.worldMapNode || { x: 240, y: 380, icon: '🏝️', regionTag: 'ISLAND' };
      const rx = z.id === 'cinderpeak' ? 88 : 82;
      const ry = z.id === 'frostpeak' ? 54 : 58;
      const foamPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx + 9, ry + 7);
      const sandPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx + 3, ry + 2.5);
      const landPts = this._buildIslandSvgPolygon(z, n.x, n.y, rx - 4, ry - 4);
      const isHere = z.id === this.state.zoneId;
      const isSelected = z.id === selZone.id;
      const sandFill = z.theme === 'volcano' ? '#57534e' : z.theme === 'snow' ? '#cbd5e1' : '#fde68a';
      const riverStroke = z.theme === 'volcano' ? '#f97316' : '#38bdf8';

      return `
        <g class="atlas-island-node" data-atlas-zone="${z.id}">
          <polygon points="${foamPts}" fill="rgba(186,230,253,0.28)" stroke="#bae6fd" stroke-width="1.4" stroke-dasharray="5 4" />
          <polygon points="${sandPts}" fill="${sandFill}" stroke="${isSelected ? '#facc15' : '#0f172a'}" stroke-width="${isSelected ? '3.5' : '1.8'}" />
          <polygon points="${landPts}" fill="${z.groundColor}" />
          <path d="M ${n.x - 16} ${n.y - ry * 0.62} Q ${n.x + 6} ${n.y} ${n.x + 14} ${n.y + ry * 0.65}"
            fill="none" stroke="${riverStroke}" stroke-width="4.2" stroke-linecap="round" opacity="0.85" />
          <!-- Miniature House Roof Icons -->
          <rect x="${n.x - 24}" y="${n.y - 12}" width="13" height="10" rx="2" fill="#fef3c7" stroke="#7c2d12" stroke-width="1.5" />
          <polygon points="${n.x - 26},${n.y - 12} ${n.x - 17.5},${n.y - 19} ${n.x - 9},${n.y - 12}" fill="#ef4444" />
          <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="20">${n.icon}</text>
          <rect x="${n.x - 68}" y="${n.y + ry * 0.56}" width="136" height="22" rx="11" fill="#0f172ae8" stroke="${isSelected ? '#fbbf24' : '#38bdf8'}" stroke-width="1.6" />
          <text x="${n.x}" y="${n.y + ry * 0.56 + 15}" text-anchor="middle" fill="#fef3c7" font-family="Lilita One, Fredoka, sans-serif" font-size="12.5">${z.name}</text>
          ${
            isHere
              ? `
                <g>
                  <rect x="${n.x - 56}" y="${n.y - ry - 22}" width="112" height="20" rx="10" fill="#facc15" stroke="#0f172a" stroke-width="2" />
                  <text x="${n.x}" y="${n.y - ry - 8}" text-anchor="middle" fill="#0f172a" font-weight="900" font-size="10.5">📍 YOU ARE HERE</text>
                </g>
              `
              : ''
          }
        </g>
      `;
    }).join('');

    // Selected Island Inspector stats
    const zoneSpeciesIds = [
      ...new Set([
        ...(selZone.wildPool || []).map((w) => w.speciesId),
        ...(selZone.apexSpawns || []).map((a) => a.speciesId),
      ]),
    ];
    const caughtHere = zoneSpeciesIds.filter((id) => this.state.caughtDex.includes(id)).length;
    const chestsTotal = (selZone.chests || []).length;
    const chestsOpened = (selZone.chests || []).filter((c) => (this.state.openedChests || []).includes(c.id)).length;
    const housesHtml = (selZone.houses || [])
      .map((h) => `<span class="move-chip" style="border-color:#fbbf24;">🏠 ${h.label}</span>`)
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
      <div class="hub-two-col" style="grid-template-columns: 1.52fr 1fr;">
        <div class="world-atlas-wrap">
          <svg viewBox="0 0 920 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monkemon Archipelago World Map">
            <defs>
              <radialGradient id="oceanGrad" cx="48%" cy="48%" r="65%">
                <stop offset="0%" stop-color="#145882" />
                <stop offset="65%" stop-color="#0c3959" />
                <stop offset="100%" stop-color="#072238" />
              </radialGradient>
            </defs>
            <rect width="920" height="470" fill="url(#oceanGrad)" />
            <!-- Cartographic Latitude/Longitude Graticule -->
            <g stroke="rgba(125,211,252,0.12)" stroke-width="1">
              <line x1="0" y1="118" x2="920" y2="118" /><line x1="0" y1="235" x2="920" y2="235" /><line x1="0" y1="352" x2="920" y2="352" />
              <line x1="184" y1="0" x2="184" y2="470" /><line x1="368" y1="0" x2="368" y2="470" /><line x1="552" y1="0" x2="552" y2="470" /><line x1="736" y1="0" x2="736" y2="470" />
            </g>
            <!-- Title Banner & Compass Rose -->
            <text x="24" y="34" fill="#fef3c7" font-family="Lilita One, Fredoka, sans-serif" font-size="20" letter-spacing="1">MONKEMON ARCHIPELAGO ATLAS</text>
            <text x="24" y="52" fill="#7dd3fc" font-size="11.5" font-weight="700">Click any curved island to inspect habitats, Houses &amp; Fast Travel!</text>
            <g transform="translate(866, 56)">
              <circle r="28" fill="#0b1d33" stroke="#fbbf24" stroke-width="2" />
              <polygon points="0,-22 6,-4 0,-8 -6,-4" fill="#facc15" />
              <polygon points="0,22 5,4 0,8 -5,4" fill="#7dd3fc" />
              <text x="0" y="-29" text-anchor="middle" fill="#fde047" font-size="10" font-weight="900">N</text>
            </g>
            ${routeLines.join('')}
            ${islandSvgNodes}
          </svg>
        </div>

        <div class="dex-inspector">
          <div class="pill-chip" style="margin-bottom:6px;">${selZone.worldMapNode?.regionTag || `ISLAND ${selZone.index}`}</div>
          <div class="dex-title-row">
            <h3>${selZone.worldMapNode?.icon || '🏝️'} ${selZone.name}</h3>
          </div>
          <div class="dex-subtitle">${selZone.subtitle}</div>
          <p class="dex-bio">${selZone.worldMapNode?.summary || ''}</p>

          <div class="dex-stats" style="grid-template-columns: repeat(3, 1fr);">
            <div><span>Caught Here</span><strong>${caughtHere}/${zoneSpeciesIds.length}</strong></div>
            <div><span>Supply Chests</span><strong>${chestsOpened}/${chestsTotal}</strong></div>
            <div><span>Houses</span><strong>${(selZone.houses || []).length}</strong></div>
          </div>

          <div class="section-label">ENTERABLE 3D HOUSES ON THIS ISLAND</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${housesHtml}</div>

          <div class="section-label">WILD &amp; APEX MONKEMON HABITAT</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">${wildsHtml}</div>

          <button type="button" class="cta-btn cta-primary" style="width:100%;" id="btn-atlas-travel" data-zone="${selZone.id}">
            ${
              selZone.id === this.state.zoneId
                ? `📍 RETURN TO ${selZone.name.toUpperCase()} PLAZA`
                : `✈️ FAST TRAVEL TO ${selZone.name.toUpperCase()}`
            }
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
        <div class="section-label">⚒️ TRELLIS.2 SANCTUARY 3D MONKEMON FORGE — CREATE A CUSTOM PBR .GLB PARTNER</div>
        <div class="forge-row">
          <label for="forge-name">Monkemon Name</label>
          <input id="forge-name" type="text" maxlength="18" value="Wafflemonk" required />
        </div>
        <div class="forge-row">
          <label for="forge-element">Official Monkemon Type</label>
          <select id="forge-element">${typeOpts}</select>
        </div>
        <div class="forge-row">
          <label for="forge-prompt">3D Toy Appearance Prompt</label>
          <textarea id="forge-prompt" rows="3">Cute cheerful golden waffle-hat capuchin monkey carrying a tiny maple syrup mug, glossy miniature vinyl figurine</textarea>
        </div>
        <div id="forge-status" class="forge-status">Ready to synthesize via TRELLIS.2-4B pipeline (~60s on TPU/GPU).</div>
        <div class="forge-actions">
          <button type="submit" class="cta-btn cta-primary" id="forge-submit-btn">✨ FORGE 3D MONKEMON (.GLB)</button>
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

    if (this.modal === 'ending') {
      if (input.pressed.btnA || input.pressed.back || input.pressed.btnB) {
        const btn = document.getElementById('ending-continue-btn');
        if (btn) btn.click();
      }
      return;
    }

    // Close hub on Esc / (B) / matching shortcut toggle
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

    // Switch Hub Tabs with `[` / `]` or Steam Deck `LB` / `RB`
    if (input.pressed.tabPrev || input.pressed.tabNext) {
      const idx = Math.max(0, HUB_TABS.findIndex((t) => t.id === this.modal));
      const next = (idx + (input.pressed.tabNext ? 1 : -1) + HUB_TABS.length) % HUB_TABS.length;
      this.audio.playSfx('menu');
      this.openMenuHub(HUB_TABS[next].id);
      return;
    }

    // Directional navigation inside active tab
    const navDelta =
      (input.menuNav.right || input.menuNav.down ? 1 : 0) -
      (input.menuNav.left || input.menuNav.up ? 1 : 0);

    if (this.modal === 'map') {
      if (navDelta !== 0) {
        const curIdx = Math.max(0, ZONE_LIST.findIndex((z) => z.id === this.selectedMapZoneId));
        const nextIdx = (curIdx + navDelta + ZONE_LIST.length) % ZONE_LIST.length;
        this.selectedMapZoneId = ZONE_LIST[nextIdx].id;
        this.audio.playSfx('menu');
        this.openMenuHub('map', { keepSelection: true });
      } else if (input.pressed.btnA) {
        const travelBtn = this.elModal.querySelector('#btn-atlas-travel');
        if (travelBtn) travelBtn.click();
      }
    } else if (this.modal === 'dex' && navDelta !== 0) {
      const all = getAllSpecies();
      const curIdx = Math.max(0, all.findIndex((s) => s.id === this.selectedDexId));
      const nextIdx = (curIdx + navDelta + all.length) % all.length;
      this.selectedDexId = all[nextIdx].id;
      this.audio.playSfx('menu');
      this.openMenuHub('dex');
    } else if (this.modal === 'party') {
      if (navDelta !== 0 && this.state.party.length > 0) {
        const curIdx = this.selectedCollectionRef.index || 0;
        const nextIdx = (curIdx + navDelta + this.state.party.length) % this.state.party.length;
        this.selectedCollectionRef = { location: 'party', index: nextIdx };
        this.audio.playSfx('menu');
        this.openMenuHub('party');
      } else if (input.pressed.btnA) {
        const leadBtn = this.elModal.querySelector('#btn-set-lead') || this.elModal.querySelector('#btn-feed-berry');
        if (leadBtn) leadBtn.click();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CHAMPION VICTORY ENDING MODAL (`#20 KING MONKEZILLA` TAMED / DEFEATED!)
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
        <button class="cta-btn cta-primary" id="ending-continue-btn">🌟 KEEP EXPLORING &amp; CATCH ALL 20!</button>
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

  _syncOverworldHUD(zone, world) {
    const zTitle = document.getElementById('hud-zone-name');
    const zSub = document.getElementById('hud-zone-sub');
    if (world && world.isInsideHouse && world.activeHouse) {
      const hTitle = `🏠 ${world.activeHouse.label}`;
      const hSub = `${zone ? zone.name : 'Island'} · Walkable Interior (South Mat Exits)`;
      if (zTitle && zTitle.textContent !== hTitle) zTitle.textContent = hTitle;
      if (zSub && zSub.textContent !== hSub) zSub.textContent = hSub;
    } else if (zone) {
      if (zTitle && zTitle.textContent !== zone.name) zTitle.textContent = zone.name;
      if (zSub && zSub.textContent !== zone.subtitle) zSub.textContent = zone.subtitle;
    }

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    setTxt('hud-balls', String(this.state.monkeballs || 0));
    setTxt('hud-superballs', String(this.state.superBalls || 0));
    setTxt('hud-berries', String(this.state.berries || 0));
    setTxt('hud-coins', String(this.state.coins || 0));
    setTxt('hud-badges', `${this.state.badges.length}/4`);
    setTxt('hud-dex-count', `${this.state.caughtDex.length}/20`);

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
      setTxt('hud-tamer-tag', `HERO ${this.state.playerName || 'ALEX'} · ACTIVE PARTNER`);
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

  _drawMiniMap(zone, world) {
    const cv = this.minimapCanvas;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;
    const h = cv.height;

    if (world.isInsideHouse && world.interiorDiorama) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      const pad = 14;
      ctx.fillStyle = '#8b5a2b';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
      ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

      // Exit mat at bottom center
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(w * 0.5 - 12, h - pad - 5, 24, 5);

      const hw = world.interiorDiorama.bounds.halfW || 7.5;
      const hd = world.interiorDiorama.bounds.halfD || 6.0;
      const mapPt = (wx, wz) => ({
        x: w * 0.5 + (wx / (hw * 1.15)) * (w * 0.5 - pad),
        y: h * 0.5 + (wz / (hd * 1.15)) * (h * 0.5 - pad),
      });

      for (const st of world.interiorDiorama.stations || []) {
        const p = mapPt(st.x, st.z);
        ctx.fillStyle = st.kind === 'heal' || st.kind === 'mom' ? '#4ade80' : '#fde047';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const hp = mapPt(world.heroX, world.heroZ);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }

    // Outdoor Curved Island Radar
    ctx.fillStyle = zone.theme === 'volcano' ? '#2c0f0c' : '#0c4a6e';
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
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = zone.theme === 'volcano' ? '#fb923c' : '#fde68a';
      ctx.stroke();
    }

    // Water / Magma channels
    for (const ch of zone.waterChannels || []) {
      const p0 = toMini(ch.x0, ch.z0);
      const p1 = toMini(ch.x1, ch.z1);
      ctx.strokeStyle = zone.theme === 'volcano' ? '#f97316' : '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    // Houses (Gold Squares)
    for (const hs of zone.houses || []) {
      const p = toMini(hs.x, hs.z);
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
      ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
    }

    // Unopened Supply Chests (Cyan Diamonds)
    for (const ch of (world.outdoorDiorama && world.outdoorDiorama.chestInteractables) || []) {
      if (!ch.opened) {
        const p = toMini(ch.x, ch.z);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(p.x - 2.2, p.y - 2.2, 4.4, 4.4);
      }
    }

    // Roaming Wild Monkemon
    for (const we of world.wildEntities || []) {
      const p = toMini(we.x, we.z);
      ctx.fillStyle = we.isAlpha ? '#ef4444' : '#fef08a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, we.isAlpha ? 3.2 : 2.1, 0, Math.PI * 2);
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
    setTxt('bf-p-coach', `★ ${this.state.playerName || 'ALEX'}’S PARTNER`);
    setTxt('bf-p-name', `${pEl.icon} ${p.mon.nickname}`);
    setTxt('bf-p-lv', `Lv.${p.mon.level}`);
    setTxt('bf-p-type-tag', `${pEl.icon} ${pEl.label.toUpperCase()} TYPE`);
    const pDispHp = Math.max(0, Math.min(p.mon.maxHp, Math.ceil(p.displayHp ?? p.mon.hp)));
    setTxt('bf-p-hp-txt', `HP: ${pDispHp} / ${p.mon.maxHp}`);
    const pPct = Math.max(0, Math.min(100, ((p.displayHp ?? p.mon.hp) / Math.max(1, p.mon.maxHp)) * 100));
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
    const eDispHp = Math.max(0, Math.min(e.mon.maxHp, Math.ceil(e.displayHp ?? e.mon.hp)));
    setTxt('bf-e-hp-txt', `HP: ${eDispHp} / ${e.mon.maxHp}`);
    const ePct = Math.max(0, Math.min(100, ((e.displayHp ?? e.mon.hp) / Math.max(1, e.mon.maxHp)) * 100));
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
    let headline = battle.bannerText || `What will ${p.mon.nickname} do?`;
    let subText = battle.narrationSub || '';
    if (battle.menuState === 'fight') {
      const moves = battle.getPlayerMoves();
      const focusedMove = moves[battle.subCursor] || moves[0];
      headline = `Choose ${p.mon.nickname}’s Move:`;
      if (focusedMove) {
        const mElem = resolveMoveElement(focusedMove, p.species);
        const mult = focusedMove.healPct ? 1.0 : getTypeMultiplier(mElem, e.species.element, e.species.secondaryElement);
        const effTxt = focusedMove.healPct
          ? 'Restores Partner HP + Boosts ATK!'
          : mult >= 1.35
            ? '★ SUPER EFFECTIVE (1.5× Damage!)'
            : mult <= 0.75
              ? 'Resisted (0.67× Damage)'
              : 'Standard Matchup (1.0×)';
        subText = `${focusedMove.desc || ''} — ${effTxt}`;
      }
    } else if (battle.menuState === 'bag') {
      headline = battle.mode === 'wild' ? 'Choose a Monkeball or Berry:' : 'Choose an Item from Your Satchel:';
      subText =
        battle.mode === 'wild'
          ? `Tip: Lower HP or toss a 🍌 Sweet Berry (+42% bonus) to boost capture lock-on!`
          : `Monkeballs can only be thrown at wild Monkemon — use Berries to heal!`;
    } else if (battle.menuState === 'party') {
      headline = 'Switch Active Monkemon:';
      subText = 'Select a healthy teammate to send into the holographic battle ring.';
    }

    setTxt('battle-banner-txt', headline);
    setTxt('battle-sub-txt', subText);

    // Command Grid (`#battle-menu-grid`)
    const grid = document.getElementById('battle-menu-grid');
    if (!grid) return;

    const catchPct = battle.getLiveCatchPercent(false);
    const superPct = battle.getLiveCatchPercent(true);
    const gridSig = [
      battle.menuState,
      battle.rootCursor,
      battle.subCursor,
      p.mon.uid,
      e.species.id,
      this.state.monkeballs,
      this.state.superBalls,
      this.state.berries,
      catchPct,
      superPct,
      this.state.party.map((m) => `${m.uid}:${m.hp}`).join(','),
    ].join('|');

    if (grid.dataset.sig === gridSig) return;
    grid.dataset.sig = gridSig;

    if (battle.menuState === 'root') {
      const aliveCount = this.state.party.filter((m) => m.hp > 0).length;
      const rootItems = [
        {
          title: '⚔️ FIGHT',
          key: '1 / A',
          sub: '4 Turn-Based Moves & Specials',
        },
        {
          title: battle.mode === 'wild' ? '🐵 CATCH / BAG' : '🎒 BAG / HEAL',
          key: '2',
          sub:
            battle.mode === 'wild'
              ? `🐵 ${this.state.monkeballs} Balls (${catchPct}% Catch) · 🌟 ${this.state.superBalls}`
              : `🍌 ${this.state.berries} Sweet Berries (+40% HP)`,
        },
        {
          title: '🐾 MONKEMON',
          key: '3',
          sub: `Squad (${aliveCount}/${this.state.party.length} Healthy)`,
        },
        {
          title: '🏃 RUN',
          key: '4',
          sub: battle.mode === 'wild' ? 'Safely Leave Wild Battle' : 'Locked in Tamer Duel',
        },
      ];

      grid.innerHTML = rootItems
        .map(
          (item, idx) => `
          <button type="button" class="tb-menu-btn ${battle.rootCursor === idx ? 'focused' : ''}" data-broot="${idx}">
            <div class="tb-btn-top">
              <span>${item.title}</span>
              <span class="tb-key-badge">${item.key}</span>
            </div>
            <div class="tb-btn-sub">${item.sub}</div>
          </button>
        `,
        )
        .join('');

      for (const btn of grid.querySelectorAll('[data-broot]')) {
        const idx = parseInt(btn.getAttribute('data-broot'), 10);
        btn.addEventListener('mouseenter', () => { battle.rootCursor = idx; });
        btn.addEventListener('click', () => battle.selectRootOption(idx));
      }
    } else if (battle.menuState === 'fight') {
      const moves = battle.getPlayerMoves();
      grid.innerHTML = moves
        .map((m, idx) => {
          const mElem = resolveMoveElement(m, p.species);
          const em = ELEMENTS[mElem] || ELEMENTS.mug;
          const mult = m.healPct ? 1.0 : getTypeMultiplier(mElem, e.species.element, e.species.secondaryElement);
          const effBadge = m.healPct
            ? `<span class="tb-eff-tag">💚 Heal ${Math.round(m.healPct * 100)}%</span>`
            : mult >= 1.35
              ? `<span class="tb-eff-tag">★ Super Effective!</span>`
              : mult <= 0.75
                ? `<span style="color:#f87171;">Resisted</span>`
                : `Pwr ${m.power}`;
          return `
            <button type="button" class="tb-menu-btn ${battle.subCursor === idx ? 'focused' : ''}" data-bfight="${idx}">
              <div class="tb-btn-top">
                <span>${em.icon} ${m.name}</span>
                <span class="tb-key-badge">${idx + 1}</span>
              </div>
              <div class="tb-btn-sub">${em.label} · ${effBadge}</div>
            </button>
          `;
        })
        .join('');

      for (const btn of grid.querySelectorAll('[data-bfight]')) {
        const idx = parseInt(btn.getAttribute('data-bfight'), 10);
        btn.addEventListener('mouseenter', () => {
          battle.subCursor = idx;
          grid.dataset.sig = ''; // refresh move preview subtitle
        });
        btn.addEventListener('click', () => battle.selectFightMove(idx));
      }
    } else if (battle.menuState === 'bag') {
      const bagItems = [
        {
          title: `🐵 Monkeball (×${this.state.monkeballs})`,
          key: '1',
          sub: battle.mode === 'wild' ? `Live Lock-On: ${catchPct}% Catch` : 'Wild Monkemon Only',
        },
        {
          title: `🌟 Super Ball (×${this.state.superBalls})`,
          key: '2',
          sub: battle.mode === 'wild' ? `1.85× Lock-On: ${superPct}% Catch!` : 'Wild Monkemon Only',
        },
        {
          title: `🍌 Sweet Berry (×${this.state.berries})`,
          key: '3',
          sub: battle.mode === 'wild' ? '+40% HP or +42% Catch Bonus' : 'Heals +40% Partner HP',
        },
        {
          title: '↩ Back to Menu',
          key: 'Esc / B',
          sub: 'Return to Root Commands',
        },
      ];

      grid.innerHTML = bagItems
        .map(
          (it, idx) => `
          <button type="button" class="tb-menu-btn ${battle.subCursor === idx ? 'focused' : ''}" data-bbag="${idx}">
            <div class="tb-btn-top">
              <span>${it.title}</span>
              <span class="tb-key-badge">${it.key}</span>
            </div>
            <div class="tb-btn-sub">${it.sub}</div>
          </button>
        `,
        )
        .join('');

      for (const btn of grid.querySelectorAll('[data-bbag]')) {
        const idx = parseInt(btn.getAttribute('data-bbag'), 10);
        btn.addEventListener('mouseenter', () => { battle.subCursor = idx; });
        btn.addEventListener('click', () => battle.selectBagItem(idx));
      }
    } else if (battle.menuState === 'party') {
      const slotsHtml = this.state.party
        .map((m, idx) => {
          const sp = getSpecies(m.speciesId);
          const em = ELEMENTS[sp.element] || ELEMENTS.mug;
          const isAct = idx === this.state.activeIndex;
          return `
            <button type="button" class="tb-menu-btn ${battle.subCursor === idx ? 'focused' : ''}" data-bparty="${idx}">
              <div class="tb-btn-top">
                <span>${em.icon} ${m.nickname} Lv.${m.level}</span>
                <span class="tb-key-badge">${isAct ? 'ACTIVE' : idx + 1}</span>
              </div>
              <div class="tb-btn-sub">HP: ${m.hp} / ${m.maxHp}</div>
            </button>
          `;
        })
        .join('');
      const backBtn =
        this.state.party.length < 6
          ? `
            <button type="button" class="tb-menu-btn" id="btn-bparty-back">
              <div class="tb-btn-top"><span>↩ Back</span><span class="tb-key-badge">Esc / B</span></div>
              <div class="tb-btn-sub">Return to Commands</div>
            </button>
          `
          : '';
      grid.innerHTML = slotsHtml + backBtn;

      for (const btn of grid.querySelectorAll('[data-bparty]')) {
        const idx = parseInt(btn.getAttribute('data-bparty'), 10);
        btn.addEventListener('mouseenter', () => { battle.subCursor = idx; });
        btn.addEventListener('click', () => battle.selectPartySlot(idx));
      }
      const bBack = grid.querySelector('#btn-bparty-back');
      if (bBack) bBack.addEventListener('click', () => battle.cancelSubMenu());
    } else {
      // `animating` step beat
      grid.innerHTML = `
        <button type="button" class="tb-menu-btn focused" style="grid-column: 1 / -1; align-items: center; text-align: center;" id="btn-battle-advance">
          <div class="tb-btn-top" style="justify-content:center;">
            <span>⚡ Executing Turn...</span>
            <span class="tb-key-badge">Enter / (A)</span>
          </div>
          <div class="tb-btn-sub">Watch the 3D Elemental Shader Clash — or press [Enter / Space / (A)] to advance!</div>
        </button>
      `;
      const adv = grid.querySelector('#btn-battle-advance');
      if (adv) {
        adv.addEventListener('click', () => {
          this.input._latched.btnA = true;
        });
      }
    }
  }
}
