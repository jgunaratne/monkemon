// Classic Turn-Based 2.5D Command-Menu Battle Engine for Monkemon!
// - Calm, unhurried handheld RPG pacing: zero enemy attacks while reading or picking menus!
// - Root Menu (`2×2`): `1: ⚔️ FIGHT`, `2: 🐵 CATCH / BAG`, `3: 🐾 MONKEMON`, `4: 🏃 RUN`
// - Sub-Menus (`fight`, `bag`, `party`) navigable via Keyboard (`WASD / Arrows / 1-4 / Enter / Esc`),
//   Steam Deck Controller (`D-Pad / Stick / (A) / (B)`), or Mouse / Touch!
// - Powered by the Multi-Layered Reactive GLSL Battle Shader Suite:
//     • Split-Elemental Nebula + Hex Lattice + Sacred Glyph + Shockwave Arena Floor
//     • 3D Fresnel Hexagonal Forcefield Stadium Cylinder
//     • Spinning Elemental Summon Pedestals under both combatants
//     • Twisted 3D Helical Plasma Beams, Rising Aura Pillars & Supersonic Impact Wave Shaders!

import * as THREE from 'three';
import { ELEMENTS, MOVES } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import { buildBattleArenaGroup } from '../engine/diorama_builder.js';
import {
  createBattleImpactWaveShaderMaterial,
  createElementalBeamShaderMaterial,
} from '../engine/shaders.js';
import {
  calculateHitDamage,
  computeCatchProbability,
  computeComboMultiplier,
  createMonkemonInstance,
  grantExpToMon,
  resolveMoveElement,
} from './combat_math.js';
import { addCaughtMonToState, markDexSeen, useBerryOnPartyMon } from './save_store.js';

const ARENA_RADIUS = 6.6;
const PLAYER_SLOT = { x: -3.15, z: 0.85 };
const ENEMY_SLOT = { x: 3.15, z: -0.85 };

const SHARED_SPARK_GEO = new THREE.SphereGeometry(1, 8, 8);
const SHARED_STAR_GEO = new THREE.OctahedronGeometry(1, 0);
const SHARED_WAVE_GEO = new THREE.PlaneGeometry(1, 1);
const SHARED_BEAM_GEO = new THREE.CylinderGeometry(0.32, 0.42, 1.0, 20, 16, true);
SHARED_BEAM_GEO.translate(0, 0.5, 0); // origin at start `(0,0,0)` extending `+Y` to `1.0`

/**
 * Returns the 4 curated Turn-Based Battle Moves for `mon`:
 * `[Signature Type Special, Monk Run, Sky Jump, Eat Snack]` (or species specials).
 */
export function getBattleMoves(mon, species) {
  const sp = species || getSpecies(mon ? mon.speciesId : 'mugchimp');
  const rawIds = [
    ...(Array.isArray(mon && mon.moves) ? mon.moves : []),
    ...(Array.isArray(sp && sp.moves) ? sp.moves : []),
  ];
  const specialId =
    rawIds.find((id) => MOVES[id] && !['monk_run', 'fake_out', 'eat_snack', 'sky_jump'].includes(id)) ||
    'espresso_geyser';

  const ordered = [specialId, 'monk_run', 'sky_jump', 'eat_snack', 'fake_out'];
  const unique = [];
  for (const id of ordered) {
    if (MOVES[id] && !unique.includes(id)) unique.push(id);
    if (unique.length === 4) break;
  }
  return unique.map((id) => MOVES[id]);
}

export class BattleController {
  constructor({ sceneRoot, modelBank, renderer, audio, state, onToast, onFloatText, onBattleEnd }) {
    this.sceneRoot = sceneRoot;
    this.modelBank = modelBank;
    this.renderer = renderer;
    this.audio = audio;
    this.state = state;
    this.onToast = onToast;
    this.onFloatText = onFloatText;
    this.onBattleEnd = onBattleEnd;

    this.active = false;
    this.pendingEnd = null; // { timer, result }
    this.mode = 'wild'; // 'wild' | 'trainer'
    this.center = { x: 0, y: 0, z: 0 };
    this.arenaGroup = null;
    this.fxGroup = null;

    this.heroCoachActor = null;
    this.rivalCoachActor = null;
    this.playerActor = null;
    this.enemyActor = null;

    this.playerUnit = null;
    this.enemyUnit = null;
    this.enemyTeam = [];
    this.enemyIndex = 0;
    this.trainerDef = null;
    this.wildRef = null;
    this.wildBerryFed = false;

    // Turn-Based Menu & Step Choreography State
    this.menuState = 'root'; // 'intro' | 'root' | 'fight' | 'bag' | 'party' | 'animating'
    this.rootCursor = 0;
    this.subCursor = 0;
    this.stepQueue = [];
    this.activeStep = null;
    this.bannerText = '';
    this.narrationSub = '';

    // Active 3D Shader VFX Lists
    this.shaderBeams = [];
    this.shaderWaves = [];
    this.shaderPillars = [];
    this.particles = [];
    this.catchAnim = null;

    this.playerCombo = 0;
    this.heroCheerTimer = 0;
    this.rivalCheerTimer = 0;
    this.time = 0;
  }

  startWildBattle(wildEntity, centerPos = { x: 0, y: 0, z: 0 }) {
    const mon = createMonkemonInstance(wildEntity.speciesId, wildEntity.level, {
      isAlpha: Boolean(wildEntity.isAlpha),
      caughtZone: this.state.zoneId,
    });
    if (typeof wildEntity.hpFrac === 'number') {
      mon.hp = Math.max(1, Math.round(mon.maxHp * wildEntity.hpFrac));
    }
    this.wildRef = wildEntity;
    this.wildBerryFed = Boolean(wildEntity.berryFed);
    this.trainerDef = null;
    this.mode = 'wild';

    const headline = wildEntity.isFinalBoss
      ? `👑 BOSS #20 — KING MONKEZILLA Lv.${mon.level} appeared!`
      : wildEntity.isAlpha
        ? `⚡ GUARDIAN #19 — ${mon.nickname} Lv.${mon.level} challenges you!`
        : `🌿 A wild ${mon.nickname} (Lv.${mon.level}) leaped out!`;

    this._setupEncounter({
      centerPos,
      enemyTeam: [mon],
      music: wildEntity.music || (wildEntity.isAlpha ? 'warden' : 'battle'),
      headline,
      isBoss: Boolean(wildEntity.isAlpha || wildEntity.isFinalBoss),
    });
  }

  startTrainerBattle(trainerDef, centerPos = { x: 0, y: 0, z: 0 }) {
    const team = (trainerDef.team || []).map((entry) =>
      createMonkemonInstance(entry.speciesId, entry.level, { caughtZone: this.state.zoneId }),
    );
    this.wildRef = null;
    this.wildBerryFed = false;
    this.trainerDef = trainerDef;
    this.mode = 'trainer';

    this._setupEncounter({
      centerPos,
      enemyTeam: team,
      music: trainerDef.isWarden ? 'warden' : 'battle',
      headline: `⚔️ ${trainerDef.name} (${trainerDef.role}) sent out ${team[0].nickname}!`,
      isBoss: Boolean(trainerDef.isWarden),
    });
  }

  _pickHealthyPartyIndex() {
    const cur = this.state.party[this.state.activeIndex];
    if (cur && cur.hp > 0) return this.state.activeIndex;
    const idx = this.state.party.findIndex((m) => m.hp > 0);
    if (idx >= 0) {
      this.state.activeIndex = idx;
      return idx;
    }
    this.state.party[0].hp = this.state.party[0].maxHp;
    this.state.activeIndex = 0;
    return 0;
  }

  _setupEncounter({ centerPos, enemyTeam, music, headline, isBoss = false }) {
    this.cleanupSceneObjects();

    this.active = true;
    this.pendingEnd = null;
    this.center = {
      x: centerPos?.x || 0,
      y: (centerPos?.y || 0) + 0.44,
      z: centerPos?.z || 0,
    };
    this.enemyTeam = enemyTeam;
    this.enemyIndex = 0;
    this.playerCombo = 0;
    this.time = 0;
    this.rootCursor = 0;
    this.subCursor = 0;
    this.stepQueue = [];
    this.activeStep = null;
    this.catchAnim = null;

    const pIdx = this._pickHealthyPartyIndex();
    const pMon = this.state.party[pIdx];
    const pSp = getSpecies(pMon.speciesId);
    const eMon = this.enemyTeam[0];
    const eSp = getSpecies(eMon.speciesId);
    markDexSeen(this.state, eMon.speciesId);

    const pElemColor = (ELEMENTS[pSp.element] || ELEMENTS.mug).color;
    const eElemColor = (ELEMENTS[eSp.element] || ELEMENTS.monster).color;

    this.arenaGroup = buildBattleArenaGroup(this.center.x, this.center.z, ARENA_RADIUS, {
      playerColor: pElemColor,
      enemyColor: eElemColor,
      baseY: this.center.y,
      isBoss,
    });
    this.sceneRoot.add(this.arenaGroup);

    this.fxGroup = new THREE.Group();
    this.fxGroup.position.set(this.center.x, this.center.y, this.center.z);
    this.sceneRoot.add(this.fxGroup);

    // Spawn Hero Coach ALEX on Left Rim + Rival Coach on Right Rim
    this.heroCoachActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/hero_tamer.glb',
      scale: 1.55,
      primaryColor: '#38bdf8',
      secondaryColor: '#fef08a',
      shadowRadius: 0.55,
      animateRig: true,
    });
    this.heroCoachActor.root.position.set(
      this.center.x - ARENA_RADIUS - 0.8,
      this.center.y,
      this.center.z + 1.35,
    );
    this.sceneRoot.add(this.heroCoachActor.root);

    if (this.mode === 'trainer' && this.trainerDef) {
      const glb =
        this.trainerDef.modelId === 'trainer_warden'
          ? 'assets/models/trainer_warden.glb'
          : 'assets/models/trainer_scout.glb';
      this.rivalCoachActor = this.modelBank.spawnActor({
        glbUrl: glb,
        scale: this.trainerDef.isWarden ? 1.8 : 1.58,
        primaryColor: this.trainerDef.isWarden ? '#f59e0b' : '#fb7185',
        secondaryColor: '#fef3c7',
        shadowRadius: 0.6,
        animateRig: true,
      });
      this.rivalCoachActor.root.position.set(
        this.center.x + ARENA_RADIUS + 0.8,
        this.center.y,
        this.center.z - 1.35,
      );
      this.sceneRoot.add(this.rivalCoachActor.root);
    }

    this._spawnPlayerUnit(pMon);
    this._spawnEnemyUnit(eMon);

    this.renderer.setCameraFraming(this.center.x, this.center.y + 0.85, this.center.z + 0.4, 'battle', true);
    this.audio.playMusic(music || 'battle', true);

    // Brief dramatic intro beat (`0.85s`) with shader summon flare, then open Root Command Menu!
    this.bannerText = headline;
    this.narrationSub =
      this.mode === 'wild'
        ? 'Pick 1 action below: ⚔️ Attack, ✨ Special, 🐵 Catch, or 🏃 Run Away anytime!'
        : `Duel vs ${this.trainerDef.name} — pick ⚔️ Attack, ✨ Special, 🍌 Heal, or 🏃 Run Away anytime!`;

    if (this.arenaGroup.userData.flareCombatant) {
      this.arenaGroup.userData.flareCombatant('player', 1.2);
      this.arenaGroup.userData.flareCombatant('enemy', 1.2);
    }
    this._spawnAuraPillar(PLAYER_SLOT.x, PLAYER_SLOT.z, pElemColor, 0.65);
    this._spawnAuraPillar(ENEMY_SLOT.x, ENEMY_SLOT.z, eElemColor, 0.65);

    // Open the 1-screen action bar immediately after a brief 0.45s summon flare so commands work right away!
    this.menuState = 'animating';
    this.stepQueue.push({
      duration: 0.45,
      text: headline,
      sub: this.narrationSub,
      onDone: () => {
        this._enterRootMenu();
      },
    });
  }

  _spawnPlayerUnit(mon) {
    if (this.playerActor) this.sceneRoot.remove(this.playerActor.root);
    const sp = getSpecies(mon.speciesId);
    this.playerActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: (sp.scale || 1.08) * 1.15,
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: 0.68,
      animateRig: true,
    });
    const wx = this.center.x + PLAYER_SLOT.x;
    const wz = this.center.z + PLAYER_SLOT.z;
    this.playerActor.root.position.set(wx, this.center.y, wz);
    this.sceneRoot.add(this.playerActor.root);

    this.playerUnit = {
      side: 'player',
      mon,
      species: sp,
      actor: this.playerActor,
      homeX: PLAYER_SLOT.x,
      homeZ: PLAYER_SLOT.z,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      yaw: Math.atan2(ENEMY_SLOT.x - PLAYER_SLOT.x, ENEMY_SLOT.z - PLAYER_SLOT.z),
      displayHp: mon.hp,
      atkBuffTurns: 0,
      hitFlash: 0,
    };
    this._syncArenaColors();
  }

  _spawnEnemyUnit(mon) {
    if (this.enemyActor) this.sceneRoot.remove(this.enemyActor.root);
    const sp = getSpecies(mon.speciesId);
    markDexSeen(this.state, mon.speciesId);
    const isBoss = Boolean(mon.isAlpha || (this.wildRef && this.wildRef.isFinalBoss));
    this.enemyActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: (sp.scale || 1.08) * (isBoss ? 1.48 : 1.16),
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: isBoss ? 1.15 : 0.68,
      animateRig: true,
    });
    const wx = this.center.x + ENEMY_SLOT.x;
    const wz = this.center.z + ENEMY_SLOT.z;
    this.enemyActor.root.position.set(wx, this.center.y, wz);
    this.sceneRoot.add(this.enemyActor.root);

    this.enemyUnit = {
      side: 'enemy',
      mon,
      species: sp,
      actor: this.enemyActor,
      homeX: ENEMY_SLOT.x,
      homeZ: ENEMY_SLOT.z,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      yaw: Math.atan2(PLAYER_SLOT.x - ENEMY_SLOT.x, PLAYER_SLOT.z - ENEMY_SLOT.z),
      displayHp: mon.hp,
      atkBuffTurns: 0,
      hitFlash: 0,
    };
    this._syncArenaColors();
  }

  _syncArenaColors() {
    if (!this.arenaGroup || !this.arenaGroup.userData.setElementColors) return;
    const pCol = this.playerUnit
      ? (ELEMENTS[this.playerUnit.species.element] || ELEMENTS.mug).color
      : '#f59e0b';
    const eCol = this.enemyUnit
      ? (ELEMENTS[this.enemyUnit.species.element] || ELEMENTS.monster).color
      : '#ef4444';
    this.arenaGroup.userData.setElementColors(pCol, eCol);
  }

  _enterRootMenu() {
    if (!this.active || this.pendingEnd) return;
    this.menuState = 'root';
    const pName = this.playerUnit ? this.playerUnit.mon.nickname : 'Partner';
    this.bannerText = `Your Turn — Choose ${pName}’s Action!`;
    this.narrationSub =
      this.mode === 'wild'
        ? `1-click commands: ⚔️ Attack · ✨ Special · 🐵 Catch (${this.getLiveCatchPercent(false)}%) · 🏃 Run Away`
        : `1-click commands: ⚔️ Attack · ✨ Special · 🍌 Heal (+40% HP) · 🏃 Run Away`;
  }

  // =========================================================================
  // PUBLIC MENU & ACTION API (Simple 1-Screen Direct Commands — Zero Sub-Menus!)
  // =========================================================================

  getPlayerMoves() {
    if (!this.playerUnit) return [];
    return getBattleMoves(this.playerUnit.mon, this.playerUnit.species);
  }

  getQuickStrikeMove() {
    const moves = this.getPlayerMoves();
    return moves[1] || moves[0];
  }

  getSpecialMove() {
    const moves = this.getPlayerMoves();
    return moves[0];
  }

  getLiveCatchPercent(isSuper = false) {
    if (!this.enemyUnit || this.mode !== 'wild') return 0;
    const prob = computeCatchProbability({
      species: this.enemyUnit.species,
      currentHp: this.enemyUnit.mon.hp,
      maxHp: this.enemyUnit.mon.maxHp,
      ringMult: isSuper ? 1.85 : 1.18,
      berryFed: this.wildBerryFed,
      badgesCount: this.state.badges.length,
    });
    return Math.round(prob * 100);
  }

  _interruptIntroIfReady() {
    if (
      this.menuState === 'animating' &&
      this.activeStep &&
      !this.activeStep.attackerSide &&
      !this.catchAnim &&
      !this.pendingEnd &&
      this.enemyUnit &&
      this.enemyUnit.mon.hp > 0 &&
      this.playerUnit &&
      this.playerUnit.mon.hp > 0
    ) {
      this.stepQueue = [];
      this.activeStep = null;
      this.menuState = 'root';
    }
  }

  selectRootOption(idx) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (idx === 3) {
      this.rootCursor = 3;
      this.tryRunAway();
      return;
    }
    if (this.menuState !== 'root' && this.menuState !== 'fight' && this.menuState !== 'bag') return;
    this.rootCursor = idx;
    if (idx === 0) {
      // 1-Click Quick Attack (`Monk Run` / Fast Strike)
      const quickMove = this.getQuickStrikeMove();
      if (quickMove) {
        this.audio.playSfx('confirm');
        this._executePlayerMoveTurn(quickMove);
      }
    } else if (idx === 1) {
      // 1-Click Signature Elemental Shader Special (`Cocoa Splash`, etc.)
      const specMove = this.getSpecialMove();
      if (specMove) {
        this.audio.playSfx('confirm');
        this._executePlayerMoveTurn(specMove);
      }
    } else if (idx === 2) {
      // 1-Click Catch (Wild) or Berry Heal (Trainer)
      if (this.mode === 'wild') {
        const useSuper = (this.state.monkeballs || 0) <= 0 && (this.state.superBalls || 0) > 0;
        this._executeThrowBallTurn(useSuper);
      } else {
        this._executeUseBerryTurn();
      }
    }
  }

  advanceOrSkipStep() {
    if (!this.active || this.pendingEnd || this.catchAnim) return;
    if (this.menuState === 'animating' && this.activeStep) {
      // If attack hasn't applied its damage yet, apply it immediately before finishing step!
      if (this.activeStep.attackerSide && !this.activeStep.impactApplied) {
        const atkUnit = this.activeStep.attackerSide === 'player' ? this.playerUnit : this.enemyUnit;
        const defUnit = this.activeStep.attackerSide === 'player' ? this.enemyUnit : this.playerUnit;
        this.activeStep.impactApplied = true;
        this._applyMoveImpact(atkUnit, defUnit, this.activeStep.move, this.activeStep._elemColor || '#fde047');
      }
      const finished = this.activeStep;
      this.activeStep = null;
      if (finished.onDone) finished.onDone();
    }
  }

  cancelSubMenu() {
    if (!this.active) return;
    if (this.menuState === 'fight' || this.menuState === 'bag' || this.menuState === 'party') {
      this.audio.playSfx('cancel');
      this._enterRootMenu();
    }
  }

  selectFightMove(slotIdx) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (this.menuState !== 'fight' && this.menuState !== 'root') return;
    const moves = this.getPlayerMoves();
    const move = moves[slotIdx] || moves[0];
    if (!move) return;
    this.audio.playSfx('confirm');
    this._executePlayerMoveTurn(move);
  }

  selectBagItem(slotIdx) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (slotIdx === 3) {
      this.cancelSubMenu();
      return;
    }
    if (this.menuState !== 'bag' && this.menuState !== 'root') return;
    if (slotIdx === 0) {
      this._executeThrowBallTurn(false);
    } else if (slotIdx === 1) {
      this._executeThrowBallTurn(true);
    } else if (slotIdx === 2) {
      this._executeUseBerryTurn();
    }
  }

  selectPartySlot(partyIdx) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (this.menuState !== 'party' && this.menuState !== 'root') return;
    const targetMon = this.state.party[partyIdx];
    if (!targetMon) return;
    if (partyIdx === this.state.activeIndex) {
      this.onToast(`${targetMon.nickname} is already battling in the ring!`);
      return;
    }
    if (targetMon.hp <= 0) {
      this.audio.playSfx('cancel');
      this.onToast(`${targetMon.nickname} has 0 HP! Heal at a House or feed a Berry!`);
      return;
    }
    this.audio.playSfx('confirm');
    this._executeSwitchPartyTurn(partyIdx);
  }

  // Backwards-compatible helpers for URL test hooks (`?screen=battle&action=cast`) & direct triggers
  triggerPlayerMoveSlot(slotIdx = 0) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    const moves = this.getPlayerMoves();
    const picked = moves[Math.min(moves.length - 1, Math.max(0, slotIdx === 4 ? 0 : slotIdx))];
    if (picked) this._executePlayerMoveTurn(picked);
  }

  tryThrowBattleMonkeball(useSuper = false) {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    this._executeThrowBallTurn(useSuper);
  }

  useBerryInBattle() {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (this.menuState !== 'root' && this.menuState !== 'bag') return;
    this._executeUseBerryTurn();
  }

  cyclePartySwitch() {
    if (!this.active || this.pendingEnd) return;
    this._interruptIntroIfReady();
    if (this.menuState !== 'root' && this.menuState !== 'party') return;
    if (this.state.party.length <= 1) {
      this.onToast('Catch more wild Monkemon first to switch squad members!');
      return;
    }
    for (let offset = 1; offset < this.state.party.length; offset++) {
      const idx = (this.state.activeIndex + offset) % this.state.party.length;
      if (this.state.party[idx].hp > 0) {
        this._executeSwitchPartyTurn(idx);
        return;
      }
    }
    this.onToast('No other healthy Monkemon available in your squad!');
  }

  tryRunAway() {
    if (!this.active || this.pendingEnd) return;
    // Player can ALWAYS run away from ANY battle (Wild, Scout Tamer, House Leader, or Boss)!
    if (this.catchAnim && this.catchAnim.ballActor) {
      this.sceneRoot.remove(this.catchAnim.ballActor.root);
      this.catchAnim = null;
    }
    this.audio.playSfx('monk_run');
    const foeLabel =
      this.mode === 'trainer' && this.trainerDef
        ? this.trainerDef.name
        : `wild ${this.enemyUnit ? this.enemyUnit.mon.nickname : 'Monkemon'}`;
    this.menuState = 'animating';
    this.stepQueue = [
      {
        duration: 0.45,
        text: `🏃 Stepped back safely from ${foeLabel}!`,
        sub: 'Returning to the island...',
        onDone: () => {
          this.pendingEnd = { timer: 0.04, result: { outcome: 'ran', wildRef: this.wildRef } };
        },
      },
    ];
    this.activeStep = null;
  }

  _bumpPlayerCombo(delta = 1) {
    this.playerCombo = Math.min(12, (this.playerCombo || 0) + delta);
  }

  getComboMultiplier() {
    return computeComboMultiplier(this.playerCombo || 0);
  }

  // =========================================================================
  // TURN RESOLUTION & STEP CHOREOGRAPHY
  // =========================================================================

  _pickEnemyMove() {
    const moves = getBattleMoves(this.enemyUnit.mon, this.enemyUnit.species);
    const hpRatio = this.enemyUnit.mon.hp / Math.max(1, this.enemyUnit.mon.maxHp);
    if (hpRatio < 0.38 && Math.random() < 0.32) {
      const healM = moves.find((m) => m.healPct);
      if (healM) return healM;
    }
    // Prefer signature special ~42% of the time, otherwise core moves
    if (Math.random() < 0.42) return moves[0];
    return moves[Math.floor(Math.random() * moves.length)];
  }

  _executePlayerMoveTurn(playerMove) {
    if (!this.playerUnit || !this.enemyUnit) return;
    this.menuState = 'animating';
    this.stepQueue = [];
    this.activeStep = null;

    const enemyMove = this._pickEnemyMove();
    const playerFirst = (this.playerUnit.mon.spd || 10) >= (this.enemyUnit.mon.spd || 10);

    if (playerFirst) {
      this._enqueueAttackStep('player', playerMove);
      this.stepQueue.push({
        duration: 0.01,
        instantCheck: true,
        onStart: () => {
          if (this.enemyUnit.mon.hp > 0 && !this.pendingEnd) {
            this._enqueueAttackStep('enemy', enemyMove);
            this._enqueueReturnToMenu();
          }
        },
      });
    } else {
      this._enqueueAttackStep('enemy', enemyMove);
      this.stepQueue.push({
        duration: 0.01,
        instantCheck: true,
        onStart: () => {
          if (this.playerUnit.mon.hp > 0 && !this.pendingEnd) {
            this._enqueueAttackStep('player', playerMove);
            this._enqueueReturnToMenu();
          }
        },
      });
    }
  }

  _enqueueReturnToMenu() {
    this.stepQueue.push({
      duration: 0.02,
      instantCheck: true,
      onDone: () => {
        if (!this.pendingEnd && this.active && this.enemyUnit.mon.hp > 0 && this.playerUnit.mon.hp > 0) {
          this._enterRootMenu();
        }
      },
    });
  }

  _enqueueAttackStep(attackerSide, move) {
    this.stepQueue.push({
      duration: 0.84,
      attackerSide,
      move,
      elapsed: 0,
      impactApplied: false,
      onStart: (step) => {
        const atkUnit = attackerSide === 'player' ? this.playerUnit : this.enemyUnit;
        const defUnit = attackerSide === 'player' ? this.enemyUnit : this.playerUnit;
        const prefix = attackerSide === 'player' ? '★ ' : this.mode === 'trainer' ? '⚔️ Foe ' : '🌿 Wild ';
        this.bannerText = `${prefix}${atkUnit.mon.nickname} used ${move.name}!`;
        this.narrationSub = move.desc || '';

        const moveElem = resolveMoveElement(move, atkUnit.species);
        const elemColor = (ELEMENTS[moveElem] || ELEMENTS.mug).color;

        if (attackerSide === 'player') this.heroCheerTimer = 1.0;
        else this.rivalCheerTimer = 1.0;

        if (this.arenaGroup && this.arenaGroup.userData.flareCombatant) {
          this.arenaGroup.userData.flareCombatant(attackerSide, 1.35);
        }

        // Launch complex 3D GLSL shader attack beam / pillar!
        if (move.healPct) {
          this.audio.playSfx('eat_snack');
          this._spawnAuraPillar(atkUnit.homeX, atkUnit.homeZ, '#4ade80', 0.85);
        } else if (move.id === 'monk_run') {
          this.audio.playSfx('monk_run');
          this._spawnShaderBeam(atkUnit.homeX, atkUnit.homeZ, defUnit.homeX, defUnit.homeZ, '#fef08a', elemColor);
        } else if (move.id === 'sky_jump') {
          this.audio.playSfx('sky_jump');
        } else if (move.id === 'fake_out') {
          this.audio.playSfx('fake_out');
          this._spawnShaderBeam(atkUnit.homeX, atkUnit.homeZ, defUnit.homeX, defUnit.homeZ, '#e9d5ff', '#a855f7');
        } else {
          this.audio.playSfx('special');
          this._spawnShaderBeam(atkUnit.homeX, atkUnit.homeZ, defUnit.homeX, defUnit.homeZ, '#ffffff', elemColor);
          this._spawnAuraPillar(atkUnit.homeX, atkUnit.homeZ, elemColor, 0.72);
        }

        step._elemColor = elemColor;
      },
      onUpdate: (step, dt) => {
        const atkUnit = attackerSide === 'player' ? this.playerUnit : this.enemyUnit;
        const defUnit = attackerSide === 'player' ? this.enemyUnit : this.playerUnit;
        const u = Math.min(1, step.elapsed / step.duration);

        // Animate expressive 3D Lunge / Sky Jump Arc on Attacker!
        if (u < 0.58) {
          const swing = Math.sin((u / 0.58) * Math.PI);
          const dx = (defUnit.homeX - atkUnit.homeX) * 0.62;
          const dz = (defUnit.homeZ - atkUnit.homeZ) * 0.62;
          if (move.pattern === 'dash_strike' || move.pattern === 'chomp_heal') {
            atkUnit.offsetX = dx * swing;
            atkUnit.offsetZ = dz * swing;
          } else if (move.pattern === 'jump_slam') {
            atkUnit.offsetX = dx * swing * 0.85;
            atkUnit.offsetZ = dz * swing * 0.85;
            atkUnit.offsetY = Math.sin((u / 0.58) * Math.PI) * 2.55;
          } else {
            atkUnit.offsetX = dx * swing * 0.34;
            atkUnit.offsetZ = dz * swing * 0.34;
          }
        } else {
          atkUnit.offsetX *= Math.max(0, 1 - dt * 14);
          atkUnit.offsetY *= Math.max(0, 1 - dt * 14);
          atkUnit.offsetZ *= Math.max(0, 1 - dt * 14);
        }

        // Apply Damage & Impact Shader Wave at `u >= 0.34`!
        if (!step.impactApplied && u >= 0.34) {
          step.impactApplied = true;
          this._applyMoveImpact(atkUnit, defUnit, move, step._elemColor);
        }
      },
      onDone: () => {
        const atkUnit = attackerSide === 'player' ? this.playerUnit : this.enemyUnit;
        if (atkUnit) {
          atkUnit.offsetX = 0;
          atkUnit.offsetY = 0;
          atkUnit.offsetZ = 0;
        }
      },
    });
  }

  _applyMoveImpact(atkUnit, defUnit, move, elemColor) {
    // 1. Self-heal + ATK Up if `move.healPct` (`Eat`)
    if (move.healPct) {
      const healAmt = Math.max(8, Math.round(atkUnit.mon.maxHp * move.healPct));
      atkUnit.mon.hp = Math.min(atkUnit.mon.maxHp, atkUnit.mon.hp + healAmt);
      atkUnit.atkBuffTurns = 2;
      const pHeal = this.renderer.projectToScreen(
        new THREE.Vector3(this.center.x + atkUnit.homeX, this.center.y + 1.8, this.center.z + atkUnit.homeZ),
      );
      if (pHeal.visible && this.onFloatText) {
        this.onFloatText(pHeal.x, pHeal.y, `+${healAmt} HP · ATK UP!`, '#4ade80');
      }
    }

    // 2. Calculate & apply hit damage
    if (atkUnit.side === 'player') this._bumpPlayerCombo(1);
    const comboMult = atkUnit.side === 'player' ? Math.min(1.3, this.getComboMultiplier()) : 1.0;
    const hit = calculateHitDamage({
      attacker: atkUnit.mon,
      attackerSpecies: atkUnit.species,
      defender: defUnit.mon,
      defenderSpecies: defUnit.species,
      move,
      comboMult,
      atkBuffed: atkUnit.atkBuffTurns > 0,
    });
    if (atkUnit.atkBuffTurns > 0) atkUnit.atkBuffTurns -= 1;

    // Gentle safety cushion on enemy hits vs crisp punchy player damage
    const dmg =
      defUnit.side === 'player'
        ? Math.max(2, Math.round(hit.damage * 0.78))
        : Math.max(4, Math.round(hit.damage * 1.15));
    defUnit.mon.hp = Math.max(0, defUnit.mon.hp - dmg);
    defUnit.hitFlash = 0.42;
    if (defUnit.actor && defUnit.actor.setHitFlash) {
      defUnit.actor.setHitFlash(1.0, 0xff4d4d);
    }

    if (defUnit.side === 'enemy' && this.wildRef) {
      this.wildRef.hpFrac = Math.max(0.05, defUnit.mon.hp / Math.max(1, defUnit.mon.maxHp));
    }

    const isSuperEff = hit.effectiveness >= 1.35;
    const isResist = hit.effectiveness <= 0.75;

    // 3. Trigger Supersonic Shader Impact Wave + Arena Floor Shockwave + Sparks + Camera Shake!
    this._spawnImpactWave(
      defUnit.homeX,
      defUnit.homeZ,
      elemColor,
      isSuperEff ? '#fde047' : '#ffffff',
      isSuperEff ? 4.4 : 3.4,
    );
    if (this.arenaGroup && this.arenaGroup.userData.triggerShockwave) {
      this.arenaGroup.userData.triggerShockwave(defUnit.homeX, defUnit.homeZ, elemColor);
    }
    if (isSuperEff) {
      this._spawnAuraPillar(defUnit.homeX, defUnit.homeZ, '#fde047', 0.8);
      this.audio.playSfx('super_hit');
      if (this.renderer.triggerShake) this.renderer.triggerShake(0.28, 0.24);
      this.narrationSub = `★ IT'S SUPER EFFECTIVE! (-${dmg} HP · ${defUnit.mon.hp}/${defUnit.mon.maxHp} left)`;
    } else if (isResist) {
      this.audio.playSfx('hit');
      if (this.renderer.triggerShake) this.renderer.triggerShake(0.12, 0.16);
      this.narrationSub = `Not very effective... (-${dmg} HP · ${defUnit.mon.hp}/${defUnit.mon.maxHp} left)`;
    } else {
      this.audio.playSfx('hit');
      if (this.renderer.triggerShake) this.renderer.triggerShake(0.18, 0.2);
      this.narrationSub = `Direct hit for -${dmg} HP! (${defUnit.mon.hp}/${defUnit.mon.maxHp} HP left)`;
    }

    this._spawnBurstParticles(defUnit.homeX, 0.9, defUnit.homeZ, elemColor, isSuperEff ? 18 : 12);

    const pDef = this.renderer.projectToScreen(
      new THREE.Vector3(this.center.x + defUnit.homeX, this.center.y + 1.9, this.center.z + defUnit.homeZ),
    );
    if (pDef.visible && this.onFloatText) {
      const label = isSuperEff
        ? `★ SUPER! -${dmg} HP`
        : hit.isCrit
          ? `CRIT! -${dmg} HP`
          : `-${dmg} HP`;
      const col = isSuperEff ? '#fde047' : isResist ? '#cbd5e1' : '#fb7185';
      this.onFloatText(pDef.x, pDef.y, label, col);
    }

    // 4. Check Fainting!
    if (defUnit.mon.hp <= 0) {
      if (defUnit.side === 'enemy') {
        this._handleEnemyFainted();
      } else {
        this._handlePlayerFainted();
      }
    }
  }

  _executeThrowBallTurn(useSuper = false) {
    if (this.mode !== 'wild') {
      this.audio.playSfx('cancel');
      this.onToast('You can only catch Wild Monkemon — Trainer Monkemon already have a partner!');
      return;
    }
    const count = useSuper ? this.state.superBalls || 0 : this.state.monkeballs || 0;
    if (count <= 0) {
      this.audio.playSfx('cancel');
      this.onToast(
        useSuper
          ? 'No Golden Super Balls left! Open Island Supply Chests or visit Monkeball Mart!'
          : 'No Monkeballs left! Collect glowing Monkeballs, open Chests, or visit any House!',
      );
      return;
    }

    if (useSuper) this.state.superBalls -= 1;
    else this.state.monkeballs -= 1;

    const prob = computeCatchProbability({
      species: this.enemyUnit.species,
      currentHp: this.enemyUnit.mon.hp,
      maxHp: this.enemyUnit.mon.maxHp,
      ringMult: useSuper ? 1.85 : 1.18,
      berryFed: this.wildBerryFed,
      badgesCount: this.state.badges.length,
    });
    const caught = Math.random() < prob;

    this.menuState = 'animating';
    this.stepQueue = [];
    this.activeStep = null;

    const ballActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.78,
      primaryColor: useSuper ? '#facc15' : '#ef4444',
      secondaryColor: '#fef9c3',
      shadowRadius: 0.36,
    });
    ballActor.root.position.set(this.center.x + PLAYER_SLOT.x - 1.5, this.center.y, this.center.z + PLAYER_SLOT.z);
    this.sceneRoot.add(ballActor.root);

    this.audio.playSfx('throw_ball');
    this.heroCheerTimer = 1.2;

    this.catchAnim = {
      ballActor,
      useSuper,
      prob,
      caught,
      phase: 'fly',
      t: 0,
      wigglesDone: 0,
      wigglesTotal: caught ? 3 : 1 + Math.floor(Math.random() * 2),
    };
    this.bannerText = `${this.state.playerName || 'ALEX'} threw a ${useSuper ? '🌟 Golden Super Ball' : '🐵 Smiling Monkeball'}!`;
    this.narrationSub = `Lock-On Catch Chance: ${Math.round(prob * 100)}%`;
  }

  _executeUseBerryTurn() {
    if ((this.state.berries || 0) <= 0) {
      this.audio.playSfx('cancel');
      this.onToast('Out of Berries! Shake Berry Bushes outdoors or buy at Monkeball Mart!');
      return;
    }
    this.state.berries -= 1;
    this.audio.playSfx('berry');

    const mon = this.playerUnit.mon;
    const healAmt = Math.max(12, Math.round(mon.maxHp * 0.4));
    mon.hp = Math.min(mon.maxHp, mon.hp + healAmt);
    if (this.mode === 'wild') this.wildBerryFed = true;

    this._spawnAuraPillar(PLAYER_SLOT.x, PLAYER_SLOT.z, '#4ade80', 1.0);
    if (this.mode === 'wild') {
      this._spawnAuraPillar(ENEMY_SLOT.x, ENEMY_SLOT.z, '#fde047', 0.85);
    }

    this.menuState = 'animating';
    this.stepQueue = [
      {
        duration: 1.15,
        text:
          this.mode === 'wild'
            ? `🍌 Shared a Sweet Berry! ${mon.nickname} +${healAmt} HP & wild ${this.enemyUnit.mon.nickname} Catch Rate +42%!`
            : `🍌 Fed ${mon.nickname} a Sweet Berry (+${healAmt} HP restored)!`,
        sub: '',
        onDone: () => {
          const enemyMove = this._pickEnemyMove();
          this._enqueueAttackStep('enemy', enemyMove);
          this._enqueueReturnToMenu();
        },
      },
    ];
    this.activeStep = null;
  }

  _executeSwitchPartyTurn(newIdx) {
    const oldName = this.playerUnit.mon.nickname;
    this.state.activeIndex = newIdx;
    const nextMon = this.state.party[newIdx];

    this.menuState = 'animating';
    this.stepQueue = [
      {
        duration: 1.05,
        text: `🐾 Come back, ${oldName}! Go get ’em, ${nextMon.nickname}!`,
        sub: `Lv.${nextMon.level} · HP ${nextMon.hp}/${nextMon.maxHp}`,
        onStart: () => {
          this._spawnPlayerUnit(nextMon);
          const col = (ELEMENTS[this.playerUnit.species.element] || ELEMENTS.mug).color;
          this._spawnAuraPillar(PLAYER_SLOT.x, PLAYER_SLOT.z, col, 0.95);
          if (this.arenaGroup && this.arenaGroup.userData.flareCombatant) {
            this.arenaGroup.userData.flareCombatant('player', 1.4);
          }
        },
        onDone: () => {
          const enemyMove = this._pickEnemyMove();
          this._enqueueAttackStep('enemy', enemyMove);
          this._enqueueReturnToMenu();
        },
      },
    ];
    this.activeStep = null;
  }

  _handleEnemyFainted() {
    this.audio.playSfx('faint');
    const faintedMon = this.enemyUnit.mon;
    const expGain = Math.round((this.mode === 'trainer' ? 34 : 24) + faintedMon.level * 9);
    const lvInfo = grantExpToMon(this.playerUnit.mon, expGain);
    this.playerUnit.displayHp = Math.min(this.playerUnit.mon.maxHp, this.playerUnit.mon.hp);

    // Clear any remaining queued attacks from this turn
    this.stepQueue = [];

    if (lvInfo.levelsGained > 0) {
      this.audio.playSfx('level_up');
      this._spawnAuraPillar(PLAYER_SLOT.x, PLAYER_SLOT.z, '#fde047', 1.2);
    }

    const expLine =
      lvInfo.levelsGained > 0
        ? `🎉 ${faintedMon.nickname} fainted! ${this.playerUnit.mon.nickname} gained +${expGain} EXP and reached Lv.${lvInfo.newLevel}!`
        : `✨ ${faintedMon.nickname} fainted! ${this.playerUnit.mon.nickname} gained +${expGain} EXP!`;

    this.stepQueue.push({
      duration: 1.35,
      text: expLine,
      sub: '',
      onStart: () => {
        if (this.enemyActor) this.enemyActor.root.visible = false;
      },
      onDone: () => {
        // Does rival Trainer have another Monkemon?
        if (this.mode === 'trainer' && this.enemyIndex + 1 < this.enemyTeam.length) {
          this.enemyIndex += 1;
          const nextFoe = this.enemyTeam[this.enemyIndex];
          this._spawnEnemyUnit(nextFoe);
          const eCol = (ELEMENTS[this.enemyUnit.species.element] || ELEMENTS.monster).color;
          this._spawnAuraPillar(ENEMY_SLOT.x, ENEMY_SLOT.z, eCol, 0.95);
          this.stepQueue.push({
            duration: 1.05,
            text: `⚔️ ${this.trainerDef.name} sent out ${nextFoe.nickname} (Lv.${nextFoe.level})!`,
            sub: `${this.enemyTeam.length - this.enemyIndex} opponent Monkemon remaining`,
            onDone: () => this._enterRootMenu(),
          });
          return;
        }

        // Victory! Award Coins & House Badge if House Leader!
        let badgeAwarded = null;
        if (this.mode === 'trainer' && this.trainerDef) {
          const coins = this.trainerDef.rewardCoins || 150;
          this.state.coins = (this.state.coins || 0) + coins;
          if (!this.state.defeatedTrainers.includes(this.trainerDef.id)) {
            this.state.defeatedTrainers.push(this.trainerDef.id);
          }
          if (this.trainerDef.badgeId && !this.state.badges.includes(this.trainerDef.badgeId)) {
            this.state.badges.push(this.trainerDef.badgeId);
            badgeAwarded = this.trainerDef.badgeName || 'House Badge';
          }
        } else {
          this.state.coins = (this.state.coins || 0) + 35 + faintedMon.level * 4;
        }

        const beatFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
        this.pendingEnd = {
          timer: 0.25,
          result: {
            outcome: 'won',
            wildRef: this.wildRef,
            badgeAwarded,
            beatFinalBoss,
          },
        };
      },
    });
  }

  _handlePlayerFainted() {
    this.audio.playSfx('faint');
    const faintedName = this.playerUnit.mon.nickname;
    this.stepQueue = [];

    const nextIdx = this.state.party.findIndex((m) => m.hp > 0);
    if (nextIdx >= 0) {
      this.stepQueue.push({
        duration: 1.25,
        text: `${faintedName} fainted! Sending out ${this.state.party[nextIdx].nickname}!`,
        sub: '',
        onStart: () => {
          if (this.playerActor) this.playerActor.root.visible = false;
        },
        onDone: () => {
          this.state.activeIndex = nextIdx;
          this._spawnPlayerUnit(this.state.party[nextIdx]);
          this._enterRootMenu();
        },
      });
    } else {
      this.stepQueue.push({
        duration: 1.35,
        text: `${faintedName} fainted! Hurrying back to the Sanctuary House to rest...`,
        sub: 'All party Monkemon will be restored to 100% HP!',
        onDone: () => {
          this.pendingEnd = {
            timer: 0.1,
            result: { outcome: 'lost' },
          };
        },
      });
    }
  }

  // =========================================================================
  // 3D GLSL SHADER VFX HELPERS (Beams, Impact Shockwaves, Aura Pillars, Sparks)
  // =========================================================================

  _spawnShaderBeam(x0, z0, x1, z1, coreColor = '#ffffff', glowColor = '#38bdf8') {
    if (!this.fxGroup) return;
    const start = new THREE.Vector3(x0, 0.95, z0);
    const end = new THREE.Vector3(x1, 0.95, z1);
    const dir = new THREE.Vector3().subVectors(end, start);
    const dist = Math.max(0.5, dir.length());

    const mat = createElementalBeamShaderMaterial({ coreColor, glowColor, twist: 6.5 });
    const mesh = new THREE.Mesh(SHARED_BEAM_GEO, mat);
    mesh.position.copy(start);
    mesh.scale.set(1.15, dist, 1.15);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.fxGroup.add(mesh);

    this.shaderBeams.push({ mesh, mat, t: 0, dur: 0.58 });
  }

  _spawnImpactWave(lx, lz, color = '#fde047', accentColor = '#ffffff', maxRadius = 3.6) {
    if (!this.fxGroup) return;
    const mat = createBattleImpactWaveShaderMaterial({ color, accentColor });
    const mesh = new THREE.Mesh(SHARED_WAVE_GEO, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(lx, 0.09, lz);
    mesh.scale.setScalar(maxRadius * 2);
    this.fxGroup.add(mesh);

    this.shaderWaves.push({ mesh, mat, t: 0, dur: 0.62 });
  }

  _spawnAuraPillar(lx, lz, glowColor = '#4ade80', dur = 0.85) {
    if (!this.fxGroup) return;
    const mat = createElementalBeamShaderMaterial({
      coreColor: '#ffffff',
      glowColor,
      twist: 4.0,
    });
    const geo = new THREE.CylinderGeometry(1.05, 1.25, 2.8, 24, 10, true);
    geo.translate(0, 1.4, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(lx, 0.05, lz);
    this.fxGroup.add(mesh);

    this.shaderPillars.push({ mesh, geo, mat, t: 0, dur });
  }

  _spawnBurstParticles(lx, ly, lz, colorHex = '#fde047', count = 12) {
    if (!this.fxGroup) return;
    for (let i = 0; i < count; i++) {
      const isStar = i % 2 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isStar ? '#fef08a' : colorHex,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(isStar ? SHARED_STAR_GEO : SHARED_SPARK_GEO, mat);
      const scale = isStar ? 0.16 : 0.12;
      mesh.scale.setScalar(scale);
      mesh.position.set(lx, ly, lz);
      this.fxGroup.add(mesh);

      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 2.4 + Math.random() * 3.8;
      this.particles.push({
        mesh,
        mat,
        vx: Math.cos(ang) * spd,
        vy: 1.8 + Math.random() * 3.2,
        vz: Math.sin(ang) * spd,
        t: 0,
        dur: 0.55 + Math.random() * 0.25,
      });
    }
  }

  // =========================================================================
  // MAIN FRAME UPDATE (`update(dt, input)`)
  // =========================================================================

  _updateCatchAnim(dt) {
    const ca = this.catchAnim;
    if (!ca) return;
    ca.t += dt;

    const startX = this.center.x + PLAYER_SLOT.x - 1.2;
    const startZ = this.center.z + PLAYER_SLOT.z;
    const targetX = this.center.x + ENEMY_SLOT.x;
    const targetZ = this.center.z + ENEMY_SLOT.z;

    if (ca.phase === 'fly') {
      const dur = 0.48;
      const u = Math.min(1, ca.t / dur);
      const x = startX + (targetX - startX) * u;
      const z = startZ + (targetZ - startZ) * u;
      const arcY = 0.8 * (1 - u) + Math.sin(u * Math.PI) * 2.85 + 0.25;
      ca.ballActor.root.position.set(x, this.center.y, z);
      ca.ballActor.animRoot.position.y = arcY;
      ca.ballActor.animRoot.rotation.x += dt * 13;

      if (u >= 1) {
        ca.phase = 'wiggle';
        ca.t = 0;
        this.audio.playSfx('ball_bounce');
        if (this.enemyActor) this.enemyActor.root.visible = false;
        this._spawnImpactWave(ENEMY_SLOT.x, ENEMY_SLOT.z, '#fde047', '#ffffff', 3.4);
        if (this.arenaGroup && this.arenaGroup.userData.triggerShockwave) {
          this.arenaGroup.userData.triggerShockwave(ENEMY_SLOT.x, ENEMY_SLOT.z, '#fde047');
        }
      }
      return;
    }

    if (ca.phase === 'wiggle') {
      ca.ballActor.animRoot.position.y = 0.16;
      ca.ballActor.animRoot.rotation.x = 0;
      ca.ballActor.animRoot.rotation.z = Math.sin(ca.t * 16) * 0.35 * Math.exp(-ca.t * 2.3);

      if (ca.t >= 0.65) {
        ca.t = 0;
        ca.wigglesDone += 1;
        if (ca.wigglesDone <= ca.wigglesTotal) {
          this.audio.playSfx('ball_wiggle');
          this.narrationSub = `Wiggle ${ca.wigglesDone}...`;
        } else if (ca.caught) {
          this.audio.playSfx('catch_fanfare');
          this._spawnAuraPillar(ENEMY_SLOT.x, ENEMY_SLOT.z, '#fde047', 1.1);
          this._spawnBurstParticles(ENEMY_SLOT.x, 0.8, ENEMY_SLOT.z, '#fde047', 22);

          const capturedMon = this.enemyUnit.mon;
          capturedMon.hp = capturedMon.maxHp;
          const slotInfo = addCaughtMonToState(this.state, capturedMon);
          for (const pm of this.state.party) {
            if (pm.hp > 0) grantExpToMon(pm, 22 + capturedMon.level * 7);
          }

          this.sceneRoot.remove(ca.ballActor.root);
          this.catchAnim = null;

          const beatFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
          this.stepQueue = [
            {
              duration: 1.4,
              text: `🎉 GOTCHA! ${capturedMon.nickname} (Lv.${capturedMon.level}) was caught!`,
              sub: slotInfo.inParty
                ? `Added to Squad Slot #${slotInfo.slot + 1} & registered in MonkeDex!`
                : `Sent to Sanctuary Box & registered in MonkeDex!`,
              onDone: () => {
                this.pendingEnd = {
                  timer: 0.1,
                  result: {
                    outcome: 'caught',
                    capturedMon,
                    wildRef: this.wildRef,
                    beatFinalBoss,
                  },
                };
              },
            },
          ];
          this.activeStep = null;
        } else {
          this.audio.playSfx('break_free');
          if (this.enemyActor) this.enemyActor.root.visible = true;
          this.sceneRoot.remove(ca.ballActor.root);
          this.catchAnim = null;

          this.stepQueue = [
            {
              duration: 1.1,
              text: `😣 Oh no! Wild ${this.enemyUnit.mon.nickname} popped free!`,
              sub: 'Tip: Weaken its HP further with ⚔️ FIGHT or feed a 🍌 Berry!',
              onDone: () => {
                const enemyMove = this._pickEnemyMove();
                this._enqueueAttackStep('enemy', enemyMove);
                this._enqueueReturnToMenu();
              },
            },
          ];
          this.activeStep = null;
        }
      }
    }
  }

  _handleMenuNavigation(input) {
    const nav = input.menuNav || { left: false, right: false, up: false, down: false };

    if (this.menuState === 'root') {
      const prev = this.rootCursor;
      if (nav.left && this.rootCursor % 2 === 1) this.rootCursor -= 1;
      if (nav.right && this.rootCursor % 2 === 0) this.rootCursor += 1;
      if (nav.up && this.rootCursor >= 2) this.rootCursor -= 2;
      if (nav.down && this.rootCursor < 2) this.rootCursor += 2;
      if (this.rootCursor !== prev) this.audio.playSfx('menu');

      // Escape / Backspace / (B) or [4] ALWAYS runs away cleanly from any battle!
      if (input.pressed.back || input.pressed.btnB || input.pressed.slot4) {
        return this.tryRunAway();
      }
      if (input.pressed.slot1) return this.selectRootOption(0);
      if (input.pressed.slot2 || input.pressed.btnX) return this.selectRootOption(1);
      if (input.pressed.slot3 || input.pressed.btnY) return this.selectRootOption(2);
      if (input.pressed.btnLB) return this.useBerryInBattle();
      if (input.pressed.btnLT) return this.cyclePartySwitch();
      if (input.pressed.btnA) return this.selectRootOption(this.rootCursor);
      return;
    }

    if (this.menuState === 'fight') {
      const moves = this.getPlayerMoves();
      const prev = this.subCursor;
      if (nav.left && this.subCursor % 2 === 1) this.subCursor -= 1;
      if (nav.right && this.subCursor % 2 === 0 && this.subCursor + 1 < moves.length) this.subCursor += 1;
      if (nav.up && this.subCursor >= 2) this.subCursor -= 2;
      if (nav.down && this.subCursor + 2 < moves.length) this.subCursor += 2;
      if (this.subCursor !== prev) this.audio.playSfx('menu');

      if (input.pressed.back || input.pressed.btnB) return this.cancelSubMenu();
      if (input.pressed.slot1) return this.selectFightMove(0);
      if (input.pressed.slot2) return this.selectFightMove(1);
      if (input.pressed.slot3) return this.selectFightMove(2);
      if (input.pressed.slot4) return this.selectFightMove(3);
      if (input.pressed.btnA) return this.selectFightMove(this.subCursor);
      return;
    }

    if (this.menuState === 'bag') {
      const prev = this.subCursor;
      if (nav.left && this.subCursor % 2 === 1) this.subCursor -= 1;
      if (nav.right && this.subCursor % 2 === 0) this.subCursor += 1;
      if (nav.up && this.subCursor >= 2) this.subCursor -= 2;
      if (nav.down && this.subCursor < 2) this.subCursor += 2;
      if (this.subCursor !== prev) this.audio.playSfx('menu');

      if (input.pressed.back || input.pressed.btnB) return this.cancelSubMenu();
      if (input.pressed.slot1) return this.selectBagItem(0);
      if (input.pressed.slot2) return this.selectBagItem(1);
      if (input.pressed.slot3) return this.selectBagItem(2);
      if (input.pressed.slot4) return this.selectBagItem(3);
      if (input.pressed.btnA) return this.selectBagItem(this.subCursor);
      return;
    }

    if (this.menuState === 'party') {
      const count = this.state.party.length;
      const prev = this.subCursor;
      if (nav.up || nav.left) this.subCursor = (this.subCursor - 1 + count) % count;
      if (nav.down || nav.right) this.subCursor = (this.subCursor + 1) % count;
      if (this.subCursor !== prev) this.audio.playSfx('menu');

      if (input.pressed.back || input.pressed.btnB) return this.cancelSubMenu();
      if (input.pressed.slot1 && count >= 1) return this.selectPartySlot(0);
      if (input.pressed.slot2 && count >= 2) return this.selectPartySlot(1);
      if (input.pressed.slot3 && count >= 3) return this.selectPartySlot(2);
      if (input.pressed.slot4 && count >= 4) return this.selectPartySlot(3);
      if (input.pressed.btnA) return this.selectPartySlot(this.subCursor);
    }
  }

  update(dt, input) {
    if (!this.active) return;
    this.time += dt;

    if (this.arenaGroup && this.arenaGroup.userData.update) {
      this.arenaGroup.userData.update(this.time);
    }

    // Smoothly tween displayed HP values on both plaques!
    for (const unit of [this.playerUnit, this.enemyUnit]) {
      if (!unit) continue;
      const targetHp = unit.mon.hp;
      const diff = targetHp - unit.displayHp;
      if (Math.abs(diff) > 0.05) {
        const speed = Math.max(24, unit.mon.maxHp * 1.25);
        unit.displayHp += Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
      } else {
        unit.displayHp = targetHp;
      }

      // Position & animate 3D Combatant Rig + Hit Flash & Flinch
      const prevFlash = unit.hitFlash || 0;
      unit.hitFlash = Math.max(0, prevFlash - dt);
      if (unit.actor) {
        if (prevFlash > 0 && unit.actor.setHitFlash) {
          unit.actor.setHitFlash(unit.hitFlash > 0 ? unit.hitFlash / 0.42 : 0, 0xff4d4d);
        }
        const shakeX = unit.hitFlash > 0 ? Math.sin(this.time * 55) * 0.18 : 0;
        unit.actor.root.position.set(
          this.center.x + unit.homeX + unit.offsetX + shakeX,
          this.center.y + unit.offsetY,
          this.center.z + unit.homeZ + unit.offsetZ,
        );
        if (unit.actor.updateMotion) {
          unit.actor.updateMotion(dt, {
            targetYaw: unit.yaw,
            moveSpeed: Math.hypot(unit.offsetX, unit.offsetZ) > 0.15 ? 8.5 : 0,
            hitRecoil: Math.min(1, unit.hitFlash * 2.2),
            inBattle: true,
          });
        }
      }
    }

    // Animate Rim Coaches (`ALEX` & Rival Trainer)
    this.heroCheerTimer = Math.max(0, this.heroCheerTimer - dt);
    this.rivalCheerTimer = Math.max(0, this.rivalCheerTimer - dt);
    if (this.heroCoachActor && this.heroCoachActor.updateMotion) {
      this.heroCoachActor.updateMotion(dt, {
        targetYaw: Math.PI * 0.42,
        moveSpeed: 0,
        cheer: this.heroCheerTimer > 0 ? 1.0 : 0.2,
      });
    }
    if (this.rivalCoachActor && this.rivalCoachActor.updateMotion) {
      this.rivalCoachActor.updateMotion(dt, {
        targetYaw: -Math.PI * 0.42,
        moveSpeed: 0,
        cheer: this.rivalCheerTimer > 0 ? 1.0 : 0.2,
      });
    }

    // Update Active 3D Shader Beams, Shockwaves, Aura Pillars & Particles!
    for (let i = this.shaderBeams.length - 1; i >= 0; i--) {
      const b = this.shaderBeams[i];
      b.t += dt;
      b.mat.uniforms.uTime.value = this.time;
      b.mat.uniforms.uProgress.value = Math.min(1, b.t / b.dur);
      if (b.t >= b.dur) {
        if (this.fxGroup) this.fxGroup.remove(b.mesh);
        b.mat.dispose();
        this.shaderBeams.splice(i, 1);
      }
    }

    for (let i = this.shaderWaves.length - 1; i >= 0; i--) {
      const w = this.shaderWaves[i];
      w.t += dt;
      w.mat.uniforms.uProgress.value = Math.min(1, w.t / w.dur);
      if (w.t >= w.dur) {
        if (this.fxGroup) this.fxGroup.remove(w.mesh);
        w.mat.dispose();
        this.shaderWaves.splice(i, 1);
      }
    }

    for (let i = this.shaderPillars.length - 1; i >= 0; i--) {
      const p = this.shaderPillars[i];
      p.t += dt;
      p.mat.uniforms.uTime.value = this.time;
      p.mat.uniforms.uProgress.value = Math.min(1, p.t / p.dur);
      if (p.t >= p.dur) {
        if (this.fxGroup) this.fxGroup.remove(p.mesh);
        p.geo.dispose();
        p.mat.dispose();
        this.shaderPillars.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.t += dt;
      pt.vy -= 9.5 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.05, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.rotation.x += dt * 7;
      pt.mat.opacity = Math.max(0, 1 - pt.t / pt.dur);
      if (pt.t >= pt.dur) {
        if (this.fxGroup) this.fxGroup.remove(pt.mesh);
        pt.mat.dispose();
        this.particles.splice(i, 1);
      }
    }

    // Frame-safe battle end transition
    if (this.pendingEnd) {
      this.pendingEnd.timer -= dt;
      if (this.pendingEnd.timer <= 0) {
        const res = this.pendingEnd.result;
        this.pendingEnd = null;
        this.active = false;
        this.cleanupSceneObjects();
        if (this.onBattleEnd) this.onBattleEnd(res);
      }
      return;
    }

    // Allow Escape / Backspace / (B) / [4] to flee immediately even during catch or attack animations!
    if (input && input.pressed && (input.pressed.back || input.pressed.btnB || input.pressed.slot4)) {
      this.tryRunAway();
      return;
    }

    // Catch animation in flight
    if (this.catchAnim) {
      this._updateCatchAnim(dt);
      return;
    }

    // Step Queue Choreography
    if (this.menuState === 'animating') {
      if (!this.activeStep && this.stepQueue.length > 0) {
        this.activeStep = this.stepQueue.shift();
        this.activeStep.elapsed = 0;
        if (this.activeStep.text) this.bannerText = this.activeStep.text;
        if (this.activeStep.sub !== undefined) this.narrationSub = this.activeStep.sub;
        if (this.activeStep.onStart) this.activeStep.onStart(this.activeStep);
      }

      if (this.activeStep) {
        // If player presses 1–4 while the opening summon banner is still showing, execute immediately!
        if (!this.activeStep.attackerSide && input && input.pressed) {
          if (input.pressed.slot4) return this.tryRunAway();
          if (input.pressed.slot1) return this.selectRootOption(0);
          if (input.pressed.slot2) return this.selectRootOption(1);
          if (input.pressed.slot3) return this.selectRootOption(2);
        }

        this.activeStep.elapsed += dt;
        if (this.activeStep.onUpdate) this.activeStep.onUpdate(this.activeStep, dt);

        const canSkip =
          this.activeStep.elapsed > 0.28 &&
          input &&
          input.pressed &&
          input.pressed.btnA;

        if (this.activeStep.elapsed >= (this.activeStep.duration || 0.85) || canSkip) {
          this.advanceOrSkipStep();
        }
      } else if (this.stepQueue.length === 0 && !this.pendingEnd) {
        this._enterRootMenu();
      }
      return;
    }

    // Player is calmly browsing the 1-Screen Action Bar!
    if (input) {
      this._handleMenuNavigation(input);
    }
  }

  cleanupSceneObjects() {
    for (const obj of [
      this.arenaGroup,
      this.fxGroup,
      this.heroCoachActor && this.heroCoachActor.root,
      this.rivalCoachActor && this.rivalCoachActor.root,
      this.playerActor && this.playerActor.root,
      this.enemyActor && this.enemyActor.root,
      this.catchAnim && this.catchAnim.ballActor && this.catchAnim.ballActor.root,
    ]) {
      if (obj) this.sceneRoot.remove(obj);
    }
    this.arenaGroup = null;
    this.fxGroup = null;
    this.heroCoachActor = null;
    this.rivalCoachActor = null;
    this.playerActor = null;
    this.enemyActor = null;
    this.catchAnim = null;
    this.shaderBeams = [];
    this.shaderWaves = [];
    this.shaderPillars = [];
    this.particles = [];
  }
}
