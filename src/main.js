// Monkemon 2.5D Main Bootstrapper & Game Loop
// Orchestrates Three.js r170 Toy-Diorama rendering, TRELLIS.2 PBR `.glb` assets,
// Organic Non-Square Islands, Walkable Cutaway House Interiors, ElevenLabs SFX + Lyria 3 + Daikon TTS,
// Steam Deck Gamepad + Keyboard + Touch controls, Unified 5-Tab Tamer Menu + World Map,
// and Turn-Based Command-Menu Battles with Multi-Layered Reactive GLSL Shaders!

import { CORE_SPECIES, registerForgedSpecies } from './data/species.js';
import { buildStoryScene } from './data/storyline.js';
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
  grantStoryProgress,
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
  const maxAniso =
    renderer.renderer && renderer.renderer.capabilities
      ? renderer.renderer.capabilities.getMaxAnisotropy()
      : 8;
  const modelBank = new ModelBank(renderer.isSoftwareGl, maxAniso);
  modelBank.quality = renderer.quality;
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

  const playStoryScene = (sceneOrId, opts = {}) => {
    if (!ui || !sceneOrId) {
      if (opts.onComplete) opts.onComplete();
      return false;
    }
    const scene =
      typeof sceneOrId === 'string' ? buildStoryScene(sceneOrId, state.playerName) : sceneOrId;
    if (!scene) {
      if (opts.onComplete) opts.onComplete();
      return false;
    }
    if (typeof sceneOrId === 'string') {
      if (!Array.isArray(state.seenStoryScenes)) state.seenStoryScenes = [];
      if (!state.seenStoryScenes.includes(sceneOrId)) {
        state.seenStoryScenes.push(sceneOrId);
      }
      saveGameToStorage(state);
    }
    ui.openStoryDialogue(scene, opts);
    return true;
  };

  world = new WorldController({
    sceneRoot: renderer.scene,
    modelBank,
    renderer,
    audio,
    state,
    onToast: (m) => ui && ui.showToast(m),
    onFloatText: (x, y, t, c) => ui && ui.spawnFloatingText(x, y, t, c),
    onOpenShop: () => ui && ui.openMenuHub('bag', { shopFocus: true }),
    onOpenPartyBox: () => ui && ui.openMenuHub('party'),
    onOpenStoryScene: (sceneOrId, opts) => playStoryScene(sceneOrId, opts),
    onStartWildBattle: (wildEnt, centerPos) => {
      world.entitiesGroup.visible = false;
      if (world.diorama && world.diorama.setLabelsVisible) world.diorama.setLabelsVisible(false);
      if (world.diorama && world.diorama.setBattleClearance) {
        world.diorama.setBattleClearance(
          centerPos?.x || 0,
          centerPos?.z || 0,
          world.isInsideHouse ? 6.2 : 10.6,
        );
      }
      battle.startWildBattle(wildEnt, centerPos);
      touch.updateMode(true);
    },
    onStartTrainerBattle: (trainerDef, centerPos) => {
      world.entitiesGroup.visible = false;
      if (world.diorama && world.diorama.setLabelsVisible) world.diorama.setLabelsVisible(false);
      if (world.diorama && world.diorama.setBattleClearance) {
        world.diorama.setBattleClearance(
          centerPos?.x || 0,
          centerPos?.z || 0,
          world.isInsideHouse ? 6.2 : 10.6,
        );
      }
      battle.startTrainerBattle(trainerDef, centerPos);
      touch.updateMode(true);
    },
    onZoneChanged: (zone) => {
      saveGameToStorage(state);
      if (ui && ui.modal !== 'title' && !world.isInsideHouse) {
        ui.showToast(`🌴 Entered ${zone.name} — ${zone.subtitle}`);
      }
    },
    onApexVictory: () => {
      grantStoryProgress(state, {
        relics: 3,
        relicId: 'boss:king_monkezilla',
        flag: 'defeated_king_monkezilla',
      });
      state.guestCompanion = null;
      world.refreshCompanionActor();
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
    // Combatants stand on the real terrain (outdoor island or house interior floor)
    groundHeightAt: (x, z) => {
      const d = world && world.isInsideHouse ? world.interiorDiorama : world && world.diorama;
      return d && typeof d.getHeightAt === 'function' ? d.getHeightAt(x, z) : 0;
    },
    onToast: (m) => ui && ui.showToast(m),
    onFloatText: (x, y, t, c) => ui && ui.spawnFloatingText(x, y, t, c),
    onBattleEnd: (res) => {
      world.entitiesGroup.visible = true;
      if (world.diorama && world.diorama.setLabelsVisible) world.diorama.setLabelsVisible(true);
      if (world.diorama && world.diorama.clearBattleClearance) world.diorama.clearBattleClearance();
      world.gateCooldown = 3.2;
      touch.updateMode(false);
      input._latched = {};

      let pendingVictoryScene = null;
      if (res.outcome === 'caught' && res.wildRef) {
        world.removeWildEntity(res.wildRef);
        if (res.beatFinalBoss || res.wildRef.isFinalBoss) {
          grantStoryProgress(state, {
            relics: 3,
            relicId: 'boss:king_monkezilla',
            flag: 'defeated_king_monkezilla',
          });
          state.guestCompanion = null;
        }
        ui.showToast(`🎉 Caught ${res.capturedMon.nickname} inside a smiling Monkeball!`);
      } else if (res.outcome === 'won') {
        if (res.wildRef) world.removeWildEntity(res.wildRef);
        world.refreshTrainerLabels();

        let storySuffix = '';
        if (battle.trainerDef) {
          const td = battle.trainerDef;
          const prog = grantStoryProgress(state, {
            relics: td.victoryRelics !== undefined ? td.victoryRelics : td.isWarden ? 2 : 0,
            relicId: `trainer:${td.id}`,
            keyItem: td.victoryKeyItem,
            flag: td.victoryFlag,
          });
          if (
            td.postVictoryClearCompanion &&
            (td.postVictoryClearCompanion === true || state.guestCompanion === td.postVictoryClearCompanion)
          ) {
            state.guestCompanion = null;
          }
          if (td.postVictoryJoinCompanion) {
            state.guestCompanion = td.postVictoryJoinCompanion;
          }
          if (td.postVictoryScene) {
            pendingVictoryScene = td.postVictoryScene;
          }
          const parts = [];
          if (prog.addedRelics > 0) parts.push(`+${prog.addedRelics} 🍌 Relics (${state.bananaRelics}/77)`);
          if (prog.newKeyItem) {
            parts.push(`${prog.newKeyItem.icon} ${prog.newKeyItem.name}`);
          }
          if (parts.length) storySuffix = ` · ${parts.join(' & ')}`;
        }
        if (res.beatFinalBoss) {
          grantStoryProgress(state, {
            relics: 3,
            relicId: 'boss:king_monkezilla',
            flag: 'defeated_king_monkezilla',
          });
          state.guestCompanion = null;
        }

        if (res.badgeAwarded) {
          ui.showToast(
            `🏅 Earned the ${res.badgeAwarded}! (${state.badges.length}/4 House Badges)${storySuffix}`,
          );
        } else {
          ui.showToast(`🏆 Victory! Your Monkemon grew stronger!${storySuffix}`);
        }
      } else if (res.outcome === 'lost') {
        healAllParty(state);
        if (!state.storyFlags.includes('earned_cloud_aegis')) {
          pendingVictoryScene = 'skyfather_revival_pact';
          ui.showToast('⚡ Sky-Father Bamboon revived your squad to 100% HP — remember your Cloud Realm duel!');
        } else {
          if (!world.isInsideHouse) {
            const house = (world.zone && world.zone.houses && world.zone.houses[0]) || null;
            if (house) {
              world.heroX = house.x;
              world.heroZ = house.z + 3.4;
              world.heroY = world.diorama ? world.diorama.getHeightAt(world.heroX, world.heroZ) : 0;
            }
          }
          ui.showToast('🏠 Rested safely — your Monkemon are back to 100% HP!');
        }
      } else if (res.outcome === 'ran') {
        ui.showToast('🏃 Stepped away safely from battle!');
      }

      world.pushNearbyWildsAway(3.8);
      world.refreshPartnerActor();
      world.refreshCompanionActor();
      saveGameToStorage(state);
      if (world.isInsideHouse) {
        renderer.setCameraFraming(
          world.heroX * 0.45,
          world.heroY + 0.85,
          world.heroZ * 0.38 + 0.5,
          'interior',
          false,
        );
      } else {
        renderer.setCameraFraming(world.heroX, world.heroY + 0.7, world.heroZ, 'overworld', false);
      }
      if (canvas && canvas.focus) {
        try { canvas.focus({ preventScroll: true }); } catch {}
      }

      if (res.beatFinalBoss) {
        ui.openEndingModal();
      } else {
        if (world.zone) {
          audio.playMusic(world.zone.music || 'sunpalm', true);
        }
        if (pendingVictoryScene) {
          playStoryScene(pendingVictoryScene);
        }
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
        world.enterHouseById('alex_house');
        net.sendName(state.playerName);
        playStoryScene('opening_bedroom_night');
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
      onPartyChanged: () => {
        world.refreshPartnerActor();
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

  // Preload bundled creature-adventure display & UI fonts so 3D world signboards pick them up on frame 1
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load("400 35px 'Lilita One'"),
          document.fonts.load("600 22px 'Fredoka'"),
          document.fonts.load("400 48px 'Luckiest Guy'"),
        ]),
        new Promise((r) => setTimeout(r, 500)),
      ]);
    } catch {
      // font fallback safe
    }
  }

  // Boot diorama in background right away so even the Title Screen shows a live lush 3D Cove!
  const initialZone = ZONES[params.get('zone')] ? params.get('zone') : state.zoneId || 'sunpalm';
  world.initHeroActors();
  world.loadZone(initialZone);
  net.connect(state.playerName || 'ALEX');

  // Optional deterministic URL query parameters for testing & deep links
  if (params.get('dex') === 'all') {
    state.seenDex = CORE_SPECIES.map((s) => s.id);
    state.caughtDex = CORE_SPECIES.map((s) => s.id);
  } else if (params.get('dex') === 'sample') {
    state.caughtDex = CORE_SPECIES.slice(0, 6).map((s) => s.id);
    state.seenDex = CORE_SPECIES.slice(0, 13).map((s) => s.id);
    if (state.party.length < 3) {
      state.party = [
        createMonkemonInstance('mugchimp', 9, { caughtZone: 'sunpalm' }),
        createMonkemonInstance('puppuchin', 8, { hp: 28, caughtZone: 'sunpalm' }),
        createMonkemonInstance('duckaque', 10, { caughtZone: 'sparkstone' }),
      ];
      state.storage = [
        createMonkemonInstance('mooboon', 7, { caughtZone: 'canopy' }),
        createMonkemonInstance('plushaki', 8, { caughtZone: 'canopy' }),
      ];
    }
  }

  const screenParam = params.get('screen');
  if (screenParam === 'play') {
    state.starterChosen = true;
    ui.closeAllModals();
    const interiorId = params.get('interior');
    if (interiorId) {
      world.enterHouseById(interiorId);
    } else if (params.get('house') === '1' && world.zone.houses && world.zone.houses[0]) {
      const h = world.zone.houses[0];
      world.heroX = h.x;
      world.heroZ = h.z + (h.scale || 4.4) * 0.58;
      world.heroY = world.diorama ? world.diorama.getHeightAt(world.heroX, world.heroZ) : 0;
      world.partnerX = world.heroX - 1.4;
      world.partnerZ = world.heroZ + 0.9;
      world.partnerY = world.heroY;
      renderer.setCameraFraming(world.heroX, world.heroY + 0.7, world.heroZ, 'overworld', true);
    } else if (params.get('pos')) {
      const [px, pz] = params.get('pos').split(',').map(Number);
      if (!Number.isNaN(px) && !Number.isNaN(pz)) {
        world.heroX = px;
        world.heroZ = pz;
        world.heroY = world.diorama ? world.diorama.getHeightAt(px, pz) : 0;
        world.partnerX = px - 1.3;
        world.partnerZ = pz + 0.9;
        world.partnerY = world.diorama ? world.diorama.getHeightAt(world.partnerX, world.partnerZ) : 0;
        if (world.heroActor) world.heroActor.root.position.set(world.heroX, world.heroY, world.heroZ);
        if (world.partnerActor) world.partnerActor.root.position.set(world.partnerX, world.partnerY, world.partnerZ);
        renderer.setCameraFraming(world.heroX, world.heroY + 0.7, world.heroZ, 'overworld', true);
      }
    }
    if (params.get('aim') === '1' && world.wildEntities[0]) {
      const w = world.wildEntities[0];
      world.heroX = w.x - 2.6;
      world.heroZ = w.z + 2.2;
      world.heroY = world.diorama ? world.diorama.getHeightAt(world.heroX, world.heroZ) : 0;
      renderer.setCameraFraming(w.x, w.y + 0.7, w.z, 'catch', true);
      world.startOrReleaseAimRing();
    }
  } else if (screenParam === 'battle') {
    state.starterChosen = true;
    ui.closeAllModals();
    world.entitiesGroup.visible = false;
    if (world.diorama && world.diorama.setLabelsVisible) world.diorama.setLabelsVisible(false);
    if (world.diorama && world.diorama.setBattleClearance) world.diorama.setBattleClearance(0, 2, 10.6);

    const bCenterY = world.diorama ? world.diorama.getHeightAt(0, 2) : 0;
    if (params.get('mode') === 'wild' && world.wildEntities[0]) {
      battle.startWildBattle(world.wildEntities[0], { x: 0, y: bCenterY, z: 2 });
    } else {
      const tr = (world.zone.trainers && world.zone.trainers[0]) || ZONES.sunpalm.trainers[0];
      battle.startTrainerBattle(tr, { x: 0, y: bCenterY, z: 2 });
    }

    if (params.get('ready') === '1' || params.get('sub')) {
      battle.stepQueue = [];
      battle.activeStep = null;
      battle._enterRootMenu();
      const sub = params.get('sub');
      if (sub === 'fight') battle.selectRootOption(0);
      else if (sub === 'bag') battle.selectRootOption(1);
      else if (sub === 'party') battle.selectRootOption(2);
    } else if (params.get('action') === 'cast') {
      battle.stepQueue = [];
      battle.activeStep = null;
      battle._enterRootMenu();
      battle._bumpPlayerCombo(3);
      battle.triggerPlayerMoveSlot(0);
    }
  } else if (screenParam === 'boss20') {
    state.starterChosen = true;
    state.guestCompanion = 'goddess_liana';
    state.keyItems = ['prism_detector', 'banana_calibur', 'aegis_charm', 'goddess_heart'];
    state.party = [
      createMonkemonInstance('mugchimp', 28),
      createMonkemonInstance('bobmonk', 28),
      createMonkemonInstance('duckaque', 28),
      createMonkemonInstance('puppuchin', 28),
    ];
    ui.closeAllModals();
    world.loadZone('cinderpeak');
    world.enterHouseById('central_shrine');
    const bossEnt =
      world.interiorWildEntities.find((w) => w.isFinalBoss) ||
      world.wildEntities.find((w) => w.isFinalBoss) ||
      world.activeWildEntities[0];
    world.entitiesGroup.visible = false;
    if (world.diorama && world.diorama.setLabelsVisible) world.diorama.setLabelsVisible(false);
    if (world.diorama && world.diorama.setBattleClearance) world.diorama.setBattleClearance(0, -2, 8.0);
    battle.startWildBattle(bossEnt, { x: 0, y: 0, z: -2 });
    if (params.get('ready') === '1') {
      battle.stepQueue = [];
      battle.activeStep = null;
      battle._enterRootMenu();
    }
  } else if (screenParam === 'party') {
    state.starterChosen = true;
    ui.openMenuHub(params.get('home') === '1' ? 'home' : 'party');
  } else if (screenParam === 'dex') {
    state.starterChosen = true;
    if (params.get('view') === 'board') ui.dexViewMode = 'board';
    ui.openMenuHub('dex');
  } else if (screenParam === 'bag') {
    state.starterChosen = true;
    ui.openMenuHub('bag');
  } else if (screenParam === 'map') {
    state.starterChosen = true;
    ui.openMenuHub('map');
  } else if (screenParam === 'forge') {
    state.starterChosen = true;
    ui.openMenuHub('forge');
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
    try {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      input.update();

      // Global hotkeys & gamepad shortcuts
      if (input.pressed.mute) {
        const m = audio.toggleMute();
        const b = document.getElementById('btn-toggle-mute');
        if (b) b.textContent = m ? '🔇 [N]' : '🔊 [N]';
      }
      if (input.pressed.tilt) {
        const on = renderer.toggleTiltShift();
        ui.showToast(`📷 Miniature Tilt-Shift Lens: ${on ? 'ON' : 'OFF'}`);
      }

      if (audio.activeVoice && input.pressed.back && !ui.modal && !battle.active) {
        audio.stopVoice();
      }

      if (ui.modal === 'title') {
        renderer.setCameraFraming(
          Math.sin(now * 0.00032) * 5.2,
          0.9,
          2.2 + Math.cos(now * 0.00032) * 3.4,
          'title',
          false,
        );
        if (world.diorama) world.diorama.update(now * 0.001, dt);
        if (world.heroActor && world.heroActor.updateMotion) {
          world.heroActor.updateMotion(dt, { targetYaw: Math.sin(now * 0.0008) * 0.4, moveSpeed: 0 });
        }
        if (world.partnerActor && world.partnerActor.updateMotion) {
          world.partnerActor.updateMotion(dt, { targetYaw: 0.3, moveSpeed: 0, cheer: 0.4 });
        }
        for (const w of world.wildEntities) {
          if (w.actor && w.actor.updateMotion) {
            w.actor.updateMotion(dt, { targetYaw: w.yaw, moveSpeed: 0 });
          }
        }
        ui.handleModalInput(input);
      } else if (ui.modal) {
        if (world.diorama) world.diorama.update(now * 0.001, dt);
        ui.handleModalInput(input);
      } else {
        if (!battle.active && input.pressed.menu) ui.toggleMenuHub('home');
        else if (!battle.active && input.pressed.party) ui.toggleMenuHub('party');
        else if (!battle.active && input.pressed.dex) ui.toggleMenuHub('dex');
        else if (!battle.active && input.pressed.map) ui.toggleMenuHub('map');
        else if (!battle.active && input.pressed.forge) ui.toggleMenuHub('forge');
        else if (battle.active) {
          if (params.get('loopcast') === '1' && battle.menuState === 'root') {
            if (battle.playerUnit?.mon) battle.playerUnit.mon.hp = battle.playerUnit.mon.maxHp;
            if (battle.enemyUnit?.mon) battle.enemyUnit.mon.hp = battle.enemyUnit.mon.maxHp;
            battle.triggerPlayerMoveSlot(0);
          }
          if (world.diorama) world.diorama.update(now * 0.001, dt);
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
    } catch (err) {
      console.error('Monkemon frame error:', err);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

boot();
