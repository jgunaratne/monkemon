// Monkemon 2.5D Main Bootstrapper & Game Loop
// Orchestrates Three.js r170 Toy-Diorama rendering, TRELLIS.2 PBR `.glb` assets,
// Lyria 3 music, Daikon TTS voices, Steam Deck Gamepad + Keyboard + Touch controls,
// WebSocket Archipelago multiplayer, Overworld Monkeball catching, and Real-Time Arena Battles!

import { CORE_SPECIES, registerForgedSpecies } from './data/species.js';
import { ZONES } from './data/zones.js';
import { AudioSys } from './engine/audio.js';
import { Input } from './engine/input.js';
import { ModelBank } from './engine/model_loader.js';
import { NetClient } from './engine/net.js';
import { DioramaRenderer } from './engine/renderer.js';
import { setupTouchControls } from './engine/touch.js';
import { BattleController } from './game/battle.js';
import { createMonkemonInstance } from './game/combat_math.js';
import {
  createInitialGameState,
  healAllParty,
  loadGameFromStorage,
  saveGameToStorage,
} from './game/save_store.js';
import { UIManager } from './game/ui.js';
import { WorldController } from './game/world.js';

async function loadForgedCatalog() {
  try {
    const res = await fetch('/api/forged_species');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.species)) {
      for (const s of data.species) registerForgedSpecies(s);
    }
  } catch {
    // offline safe
  }
}

async function boot() {
  await loadForgedCatalog();

  const params = new URLSearchParams(window.location.search);
  const canvas = document.getElementById('game-canvas');
  const renderer = new DioramaRenderer(canvas);
  const modelBank = new ModelBank(renderer.isSoftwareGl);
  const audio = new AudioSys();
  const input = new Input(canvas);
  const touch = setupTouchControls(document.getElementById('touch-controls'), input, params);

  input.onFirstGesture = () => {
    audio.unlock();
  };

  // Load saved game or initialize fresh state (`ALEX` + `Mugchimp`)
  const saved = loadGameFromStorage();
  const hasSavedGame = Boolean(saved && saved.starterChosen);
  const state = saved || createInitialGameState('ALEX', 'mugchimp');

  let ui = null;
  let battle = null;
  let world = null;

  const net = new NetClient(modelBank, renderer.scene);

  world = new WorldController({
    sceneRoot: renderer.scene,
    modelBank,
    renderer,
    audio,
    state,
    onToast: (m) => ui && ui.showToast(m),
    onFloatText: (x, y, t, c) => ui && ui.spawnFloatingText(x, y, t, c),
    onStartWildBattle: (wildEnt, centerPos) => {
      world.entitiesGroup.visible = false;
      battle.startWildBattle(wildEnt, centerPos);
      touch.updateMode(true);
    },
    onStartTrainerBattle: (trainerDef, centerPos) => {
      world.entitiesGroup.visible = false;
      battle.startTrainerBattle(trainerDef, centerPos);
      touch.updateMode(true);
    },
    onZoneChanged: (zone) => {
      saveGameToStorage(state);
      if (ui && ui.modal !== 'title') {
        ui.showToast(`🌴 Entered ${zone.name} — ${zone.subtitle}`);
      }
    },
    onApexVictory: () => {
      saveGameToStorage(state);
      if (ui) ui.openEndingModal();
    },
  });

  battle = new BattleController({
    sceneRoot: renderer.scene,
    modelBank,
    renderer,
    audio,
    state,
    onToast: (m) => ui && ui.showToast(m),
    onFloatText: (x, y, t, c) => ui && ui.spawnFloatingText(x, y, t, c),
    onBattleEnd: (res) => {
      world.entitiesGroup.visible = true;
      touch.updateMode(false);

      if (res.outcome === 'caught' && res.wildRef) {
        world.removeWildEntity(res.wildRef);
        ui.showToast(`🎉 Caught ${res.capturedMon.nickname} inside a smiling Monkeball!`);
      } else if (res.outcome === 'won') {
        if (res.wildRef) world.removeWildEntity(res.wildRef);
        world.refreshTrainerLabels();
        if (res.badgeAwarded) {
          ui.showToast(`🏅 Earned the ${res.badgeAwarded}! (${state.badges.length}/4 House Badges)`);
        } else {
          ui.showToast('🏆 Victory! Your Monkemon grew stronger!');
        }
      } else if (res.outcome === 'lost') {
        // Cozy hometown rescue back to nearest House with full heal!
        healAllParty(state);
        const house = (world.zone && world.zone.houses && world.zone.houses[0]) || null;
        if (house) {
          world.heroX = house.x;
          world.heroZ = house.z + 3.0;
        }
        ui.showToast('🏠 Rested safely at the House — your Monkemon are back to 100% HP!');
      } else if (res.outcome === 'ran') {
        ui.showToast('💨 Dashed safely out of the arena!');
      }

      saveGameToStorage(state);
      renderer.setCameraFraming(world.heroX, 0.7, world.heroZ, 'overworld', false);

      if (res.beatFinalBoss) {
        ui.openEndingModal();
      } else if (world.zone) {
        audio.playMusic(world.zone.music || 'sunpalm', true);
      }
    },
  });

  ui = new UIManager({
    renderer,
    modelBank,
    audio,
    input,
    state,
    callbacks: {
      onStartNewGame: (heroName, starterId) => {
        const fresh = createInitialGameState(heroName, starterId);
        fresh.starterChosen = true;
        Object.assign(state, fresh);
        saveGameToStorage(state);
        world.initHeroActors();
        world.loadZone('sunpalm');
        net.sendName(state.playerName);
        audio.playVoice('prof_welcome', {
          speaker: 'PROF. MACAQUE',
          line: 'Welcome to the Monkemon Archipelago, Alex! Visit all five Houses and tame Boss Twenty—King Monkezilla!',
        });
      },
      onContinueGame: () => {
        world.initHeroActors();
        world.loadZone(state.zoneId || 'sunpalm', state.pos);
        net.sendName(state.playerName);
      },
      onFastTravel: (zoneId) => {
        if (battle.active) return;
        world.loadZone(zoneId);
      },
      onSpawnForgedSpecies: (sp) => {
        const forgedMon = createMonkemonInstance(sp.id, Math.max(8, state.party[0]?.level || 8), {
          caughtZone: state.zoneId,
        });
        if (state.party.length < 6) state.party.push(forgedMon);
        else state.storage.push(forgedMon);
        if (!state.seenDex.includes(sp.id)) state.seenDex.push(sp.id);
        if (!state.caughtDex.includes(sp.id)) state.caughtDex.push(sp.id);
        world._createWildEntity({
          speciesId: sp.id,
          level: forgedMon.level,
          homeX: world.heroX + 2.4,
          homeZ: world.heroZ + 0.6,
          isAlpha: false,
        });
        saveGameToStorage(state);
        ui.showToast(`✨ Forged 3D ${sp.name} (.glb) joined your squad & appeared beside you!`);
      },
      onResumeZoneMusic: () => {
        if (world.zone) audio.playMusic(world.zone.music || 'sunpalm', true);
      },
      onBattleMove: (slotIdx) => battle.triggerPlayerMoveSlot(slotIdx),
      onBattleMonkeball: () => battle.tryThrowBattleMonkeball(),
      onBattleSwitch: () => battle.cyclePartySwitch(),
      onBattleRun: () => battle.tryRunAway(),
    },
  });

  // Boot diorama in background right away so even the Title Screen shows a live lush 3D Cove!
  const initialZone = ZONES[params.get('zone')] ? params.get('zone') : state.zoneId || 'sunpalm';
  world.initHeroActors();
  world.loadZone(initialZone);
  net.connect(state.playerName || 'ALEX');

  // Optional deterministic URL query parameters for testing & deep links
  if (params.get('dex') === 'all') {
    state.seenDex = CORE_SPECIES.map((s) => s.id);
    state.caughtDex = CORE_SPECIES.map((s) => s.id);
  }
  const screenParam = params.get('screen');
  if (screenParam === 'play') {
    state.starterChosen = true;
    ui.closeAllModals();
    if (params.get('house') === '1' && world.zone.houses && world.zone.houses[0]) {
      const h = world.zone.houses[0];
      world.heroX = h.x;
      world.heroZ = h.z + (h.scale || 4.4) * 0.56;
      world.partnerX = world.heroX - 1.4;
      world.partnerZ = world.heroZ + 0.9;
      renderer.setCameraFraming(world.heroX, 0.7, world.heroZ, 'overworld', true);
    }
    if (params.get('aim') === '1' && world.wildEntities[0]) {
      const w = world.wildEntities[0];
      world.heroX = w.x - 2.6;
      world.heroZ = w.z + 2.2;
      renderer.setCameraFraming(w.x, 0.7, w.z, 'catch', true);
      world.startOrReleaseAimRing();
    }
  } else if (screenParam === 'battle') {
    state.starterChosen = true;
    ui.closeAllModals();
    const tr = (world.zone.trainers && world.zone.trainers[0]) || ZONES.sunpalm.trainers[0];
    world.entitiesGroup.visible = false;
    battle.startTrainerBattle(tr, { x: 0, z: 2 });
  } else if (screenParam === 'boss20') {
    state.starterChosen = true;
    state.party = [
      createMonkemonInstance('mugchimp', 28),
      createMonkemonInstance('bobmonk', 28),
      createMonkemonInstance('duckaque', 28),
    ];
    ui.closeAllModals();
    world.loadZone('cinderpeak');
    const bossEnt = world.wildEntities.find((w) => w.isFinalBoss) || world.wildEntities[0];
    world.entitiesGroup.visible = false;
    battle.startWildBattle(bossEnt, { x: 8, z: -6 });
  } else if (screenParam === 'dex') {
    state.starterChosen = true;
    ui.openMonkeBoardModal();
  } else if (screenParam === 'map') {
    state.starterChosen = true;
    ui.openWorldMapModal();
  } else if (screenParam === 'forge') {
    state.starterChosen = true;
    ui.openForgeModal();
  } else if (screenParam === 'ending') {
    state.starterChosen = true;
    ui.openEndingModal();
  } else {
    audio.playMusic('title', true);
    ui.openTitleScreen(hasSavedGame);
  }

  // Expose debug handle for automated verification
  window.__MONKEMON__ = { state, world, battle, ui, renderer, audio };

  let lastTs = performance.now();
  let saveAccum = 0;

  async function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
    lastTs = now;

    input.update();

    // Global hotkeys & gamepad shortcuts
    if (input.pressed.mute) {
      const m = audio.toggleMute();
      const b = document.getElementById('btn-toggle-mute');
      if (b) b.textContent = m ? '🔇 Muted [N]' : '🔊 Audio [N]';
    }
    if (input.pressed.tilt) {
      const on = renderer.toggleTiltShift();
      ui.showToast(`📷 Miniature Tilt-Shift Lens: ${on ? 'ON' : 'OFF'}`);
    }

    // Voice skip on Space / Gamepad A while voice banner is active
    if (audio.activeVoice && (input.pressed.back || (ui.modal === null && input.pressed.btnA && !battle.active))) {
      // Allow skipping long voice lines cleanly with Back/Esc
      if (input.pressed.back) audio.stopVoice();
    }

    if (ui.modal === 'title') {
      renderer.setCameraFraming(
        Math.sin(now * 0.00035) * 4.5,
        0.9,
        2.5 + Math.cos(now * 0.00035) * 3.0,
        'title',
        false,
      );
      if (world.diorama) world.diorama.update(now * 0.001, dt);
      if (!input.typing && input.pressed.btnA) {
        const startBtn = document.getElementById('btn-continue-save') || document.getElementById('btn-new-adventure');
        if (startBtn) startBtn.click();
      }
    } else if (ui.modal) {
      if (input.pressed.back || (ui.modal === 'dex' && input.pressed.dex) || (ui.modal === 'map' && input.pressed.map)) {
        ui.closeAllModals();
      }
    } else {
      if (input.pressed.dex && !battle.active) ui.toggleModal('dex');
      else if (input.pressed.map && !battle.active) ui.toggleModal('map');
      else if (input.pressed.forge && !battle.active) ui.toggleModal('forge');
      else if (battle.active) {
        battle.update(dt, input);
      } else {
        world.update(dt, input);
      }
    }

    const activeMon = state.party[state.activeIndex] || state.party[0];
    net.update(
      dt,
      {
        zoneId: state.zoneId,
        x: world.heroX,
        z: world.heroZ,
        yaw: world.heroYaw,
        moving: world.heroMoving,
        inBattle: battle.active,
        partnerId: activeMon ? activeMon.speciesId : 'mugchimp',
        partnerLv: activeMon ? activeMon.level : 5,
        badges: state.badges.length,
      },
      state.zoneId,
    );

    ui.updateHUD({
      inBattle: battle.active,
      zone: world.zone,
      world,
      battle,
      onlineCount: net.onlineCount,
    });

    state.playSeconds = (state.playSeconds || 0) + dt;
    saveAccum += dt;
    if (saveAccum >= 8.0 && state.starterChosen) {
      saveAccum = 0;
      saveGameToStorage(state);
    }

    renderer.render(dt);
    await renderer.afterDraw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot();
