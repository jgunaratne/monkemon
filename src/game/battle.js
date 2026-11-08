// Real-Time Tactical 2.5D Holo-Arena Battle Engine for Monkemon!
// Implements the Concept Spec Battle Layout:
//   - Left Rim: Hero ALEX cheering on `Monk 1` (animated limb & cheer rig)
//   - Right Rim: Rival Trainer / House Leader commanding `Monk 2` (or Wild / Alpha Boss #19 & #20)
//   - Split Battle Deck (`Fight` / `Monkeball` / `Switch` / `Run`) + Live Gamepad Action Diamond:
//       [A] Monk Run  ·  [B] Fake Out  ·  [X] Eat  ·  [Y] Jump  ·  [RB] Type Special
//   - Lockup-proof frame-synchronized `pendingEnd` transition state (never mutates/nulls scene groups mid-frame!).

import * as THREE from 'three';
import { ELEMENTS, MOVES } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import {
  calculateHitDamage,
  computeCatchProbability,
  computeComboMultiplier,
  createMonkemonInstance,
  grantExpToMon,
  resolveMoveElement,
} from './combat_math.js';
import { addCaughtMonToState, markDexSeen } from './save_store.js';
import { buildBattleArenaGroup } from '../engine/diorama_builder.js';

const ARENA_RADIUS = 6.5;
const SHARED_SPARK_GEO = new THREE.SphereGeometry(1, 8, 8);
const SHARED_STAR_GEO = new THREE.OctahedronGeometry(1, 0);

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
    this.pendingEnd = null; // { timer, result } — frame-safe battle completion!
    this.mode = 'wild'; // 'wild' | 'trainer'
    this.center = { x: 0, z: 0 };
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

    this.projectiles = [];
    this.telegraphs = [];
    this.shockwaves = [];
    this.particles = [];
    this.catchAnim = null;
    this.bannerText = '';
    this.playerCombo = 0;
    this.comboDecayTimer = 0;
    this.heroCheerTimer = 0;
    this.rivalCheerTimer = 0;
    this.time = 0;
  }

  startWildBattle(wildEntity, centerPos) {
    const mon = createMonkemonInstance(wildEntity.speciesId, wildEntity.level, {
      isAlpha: Boolean(wildEntity.isAlpha),
      caughtZone: this.state.zoneId,
    });
    if (typeof wildEntity.hpFrac === 'number') {
      mon.hp = Math.max(1, Math.round(mon.maxHp * wildEntity.hpFrac));
    }
    this.wildRef = wildEntity;
    this.trainerDef = null;
    this.mode = 'wild';
    this._setupEncounter({
      centerPos,
      enemyTeam: [mon],
      music: wildEntity.music || (wildEntity.isAlpha ? 'warden' : 'battle'),
      headline: wildEntity.isFinalBoss
        ? 'APEX BOSS #20 — KING MONKEZILLA APPEARED!'
        : wildEntity.isAlpha
          ? `GUARDIAN #19 — ${mon.nickname.toUpperCase()} CHALLENGES YOU!`
          : `Wild ${mon.nickname} (Lv.${mon.level}) leaped into the ring!`,
    });
  }

  startTrainerBattle(trainerDef, centerPos) {
    const team = (trainerDef.team || []).map((entry) =>
      createMonkemonInstance(entry.speciesId, entry.level, { caughtZone: this.state.zoneId }),
    );
    this.wildRef = null;
    this.trainerDef = trainerDef;
    this.mode = 'trainer';
    this._setupEncounter({
      centerPos,
      enemyTeam: team,
      music: trainerDef.isWarden ? 'warden' : 'battle',
      headline: `${trainerDef.name} (${trainerDef.role}) wants to battle!`,
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

  _setupEncounter({ centerPos, enemyTeam, music, headline }) {
    this.cleanupMeshes();
    this.active = true;
    this.pendingEnd = null;
    this.time = 0;
    this.center = { x: centerPos.x, z: centerPos.z };
    this.enemyTeam = enemyTeam;
    this.enemyIndex = 0;
    this.projectiles = [];
    this.telegraphs = [];
    this.shockwaves = [];
    this.particles = [];
    this.catchAnim = null;
    this.playerCombo = 0;
    this.comboDecayTimer = 0;
    this.heroCheerTimer = 0.55;
    this.rivalCheerTimer = 0.55;
    this.bannerText = headline;

    this.arenaGroup = buildBattleArenaGroup(this.center.x, this.center.z, ARENA_RADIUS);
    this.fxGroup = new THREE.Group();
    this.sceneRoot.add(this.arenaGroup, this.fxGroup);

    // Hero Trainer ALEX cheering on the left rim (animated character rig!)
    this.heroCoachActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/hero_tamer.glb',
      scale: 1.65,
      primaryColor: '#38bdf8',
      secondaryColor: '#fef08a',
      animateRig: true,
    });
    this.heroCoachActor.root.position.set(this.center.x - ARENA_RADIUS - 1.05, 0, this.center.z + 0.6);
    this.sceneRoot.add(this.heroCoachActor.root);

    // Rival Trainer / House Master on the right rim (animated character rig!)
    if (this.mode === 'trainer' && this.trainerDef) {
      const coachGlb =
        this.trainerDef.modelId === 'trainer_warden'
          ? 'assets/models/trainer_warden.glb'
          : 'assets/models/trainer_scout.glb';
      this.rivalCoachActor = this.modelBank.spawnActor({
        glbUrl: coachGlb,
        scale: this.trainerDef.isWarden ? 1.85 : 1.65,
        primaryColor: '#ef4444',
        secondaryColor: '#fde68a',
        animateRig: true,
      });
      this.rivalCoachActor.root.position.set(this.center.x + ARENA_RADIUS + 1.05, 0, this.center.z - 0.5);
      this.sceneRoot.add(this.rivalCoachActor.root);
    }

    const pIdx = this._pickHealthyPartyIndex();
    this._spawnPlayerUnit(this.state.party[pIdx], this.center.x - 3.1, this.center.z + 0.4);
    this._spawnEnemyUnit(this.enemyTeam[0], this.center.x + 3.1, this.center.z - 0.4);
    this._spawnBurst({
      x: this.center.x - 3.1,
      y: 0.6,
      z: this.center.z + 0.4,
      color: '#38bdf8',
      count: 14,
      speed: 3.8,
      star: true,
    });
    this._spawnBurst({
      x: this.center.x + 3.1,
      y: 0.6,
      z: this.center.z - 0.4,
      color: '#fbbf24',
      count: 14,
      speed: 3.8,
      star: true,
    });

    this.renderer.setCameraFraming(this.center.x, 0.75, this.center.z + 0.5, 'battle', false);
    this.audio.playMusic(music, true);
  }

  _createCombatUnitState(side, mon, sp, actor, x, z, yaw) {
    return {
      side,
      mon,
      species: sp,
      actor,
      x,
      z,
      y: 0,
      yaw,
      cooldowns: {},
      invuln: 0.35,
      stun: 0,
      atkBuff: 0,
      dashTimer: 0,
      dashVx: 0,
      dashVz: 0,
      jumpTimer: 0,
      jumpDur: 0.52,
      jumpMove: null,
      spinTimer: 0,
      spinDur: 0.32,
      chompTimer: 0,
      chompDur: 0.46,
      specialTimer: 0,
      specialDur: 0.44,
      recoilTimer: 0,
      hitFlash: 0,
      hitFlashHex: 0xffffff,
      kbVx: 0,
      kbVz: 0,
      trailTimer: 0,
      aiThink: 0.75,
      strafeDir: 1,
      _faintedHandled: false,
    };
  }

  _spawnPlayerUnit(mon, x, z) {
    if (this.playerActor) this.sceneRoot.remove(this.playerActor.root);
    const sp = getSpecies(mon.speciesId);
    this.playerActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: (sp.scale || 1.08) * (mon.isAlpha ? 1.25 : 1.08),
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: 0.65,
      animateRig: true,
    });
    this.playerActor.root.position.set(x, 0, z);
    this.sceneRoot.add(this.playerActor.root);
    this.playerUnit = this._createCombatUnitState('player', mon, sp, this.playerActor, x, z, Math.PI * 0.5);
  }

  _spawnEnemyUnit(mon, x, z) {
    if (this.enemyActor) this.sceneRoot.remove(this.enemyActor.root);
    markDexSeen(this.state, mon.speciesId);
    const sp = getSpecies(mon.speciesId);
    this.enemyActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: (sp.scale || 1.08) * (mon.isAlpha ? 1.32 : 1.08),
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: mon.isAlpha ? 1.05 : 0.65,
      animateRig: true,
    });
    this.enemyActor.root.position.set(x, 0, z);
    this.sceneRoot.add(this.enemyActor.root);
    this.enemyUnit = this._createCombatUnitState('enemy', mon, sp, this.enemyActor, x, z, -Math.PI * 0.5);
  }

  cleanupMeshes() {
    for (const pt of this.particles) {
      if (pt.mesh && pt.mesh.material) {
        try { pt.mesh.material.dispose(); } catch {}
      }
    }
    for (const obj of [
      this.arenaGroup,
      this.fxGroup,
      this.heroCoachActor && this.heroCoachActor.root,
      this.rivalCoachActor && this.rivalCoachActor.root,
      this.playerActor && this.playerActor.root,
      this.enemyActor && this.enemyActor.root,
    ]) {
      if (obj) this.sceneRoot.remove(obj);
    }
    this.arenaGroup = null;
    this.fxGroup = null;
    this.heroCoachActor = null;
    this.rivalCoachActor = null;
    this.playerActor = null;
    this.enemyActor = null;
    this.projectiles = [];
    this.telegraphs = [];
    this.shockwaves = [];
    this.particles = [];
    this.catchAnim = null;
  }

  _queueBattleEnd(result, delaySec = 0.05) {
    if (this.pendingEnd) return;
    this.pendingEnd = {
      timer: Math.max(0.01, delaySec),
      result,
    };
  }

  getComboMultiplier() {
    return computeComboMultiplier(this.playerCombo);
  }

  _bumpPlayerCombo(delta = 1) {
    this.playerCombo = Math.min(12, this.playerCombo + delta);
    this.comboDecayTimer = 6.5;
  }

  _spawnBurst({
    x,
    y = 0.65,
    z,
    color = '#fbbf24',
    count = 14,
    speed = 4.4,
    up = 3.2,
    gravity = 9.2,
    size = 0.16,
    life = 0.52,
    star = false,
  }) {
    if (!this.fxGroup) return;
    const geo = star ? SHARED_STAR_GEO : SHARED_SPARK_GEO;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 160) break;
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = speed * (0.45 + Math.random() * 0.75);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const s = size * (0.7 + Math.random() * 0.65);
      mesh.scale.setScalar(s);
      mesh.position.set(x, y + Math.random() * 0.25, z);
      this.fxGroup.add(mesh);
      this.particles.push({
        mesh,
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        vx: Math.cos(ang) * spd,
        vy: up * (0.55 + Math.random() * 0.7),
        vz: Math.sin(ang) * spd,
        gravity,
        baseScale: s,
        t: 0,
        life: life * (0.8 + Math.random() * 0.35),
      });
    }
  }

  triggerPlayerMoveSlot(slotIndex) {
    if (!this.active || this.pendingEnd || !this.playerUnit || !this.enemyUnit || this.catchAnim) return;
    const moveId = this.playerUnit.mon.moves[slotIndex];
    if (!moveId) return;
    this._castMove(this.playerUnit, this.enemyUnit, moveId);
  }

  cyclePartySwitch() {
    if (!this.active || this.pendingEnd || this.catchAnim) return;
    const len = this.state.party.length;
    if (len <= 1) {
      this.onToast('Catch more Monkemon with Monkeballs to build a 6-party squad!');
      return;
    }
    for (let step = 1; step < len; step++) {
      const idx = (this.state.activeIndex + step) % len;
      if (this.state.party[idx].hp > 0) {
        this.state.activeIndex = idx;
        const px = this.playerUnit ? this.playerUnit.x : this.center.x - 2.8;
        const pz = this.playerUnit ? this.playerUnit.z : this.center.z;
        this._spawnPlayerUnit(this.state.party[idx], px, pz);
        this.audio.playSfx('confirm');
        this._spawnShockwave(px, pz, 1.8, '#38bdf8');
        this.bannerText = `Go, ${this.state.party[idx].nickname}! Show your Monk Run!`;
        return;
      }
    }
    this.onToast('No other healthy Monkemon ready to switch!');
  }

  tryThrowBattleMonkeball(useSuperBall = false) {
    if (!this.active || this.pendingEnd || this.catchAnim || !this.enemyUnit || !this.fxGroup) return;
    if (this.mode === 'trainer') {
      this.audio.playSfx('break_free');
      this.bannerText = 'Haha! You cannot Monkeball another Trainer’s Monkemon!';
      return;
    }
    const superReady = useSuperBall && (this.state.superBalls || 0) > 0;
    if (!superReady && this.state.monkeballs <= 0 && (this.state.superBalls || 0) <= 0) {
      this.onToast('Out of Monkeballs! Restock at any House or Toy Shop!');
      return;
    }

    let ballBonus = 1.28;
    if (superReady || (this.state.monkeballs <= 0 && (this.state.superBalls || 0) > 0)) {
      this.state.superBalls -= 1;
      ballBonus = 1.85;
    } else {
      this.state.monkeballs -= 1;
    }
    this.audio.playSfx('throw_ball');

    const ballActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.72,
      primaryColor: ballBonus > 1.5 ? '#facc15' : '#ef4444',
      secondaryColor: '#fef3c7',
      shadowRadius: 0.35,
    });
    const startX = this.heroCoachActor ? this.heroCoachActor.root.position.x : this.center.x - 6;
    const startZ = this.heroCoachActor ? this.heroCoachActor.root.position.z : this.center.z;
    ballActor.root.position.set(startX, 1.2, startZ);
    this.fxGroup.add(ballActor.root);

    const prob = computeCatchProbability({
      species: this.enemyUnit.species,
      currentHp: this.enemyUnit.mon.hp,
      maxHp: this.enemyUnit.mon.maxHp,
      ringMult: ballBonus,
      berryFed: Boolean(this.wildRef && this.wildRef.berryFed),
      badgesCount: this.state.badges.length,
    });
    const caught = Math.random() < prob;
    const wiggles = caught ? 3 : 1 + Math.floor(Math.random() * 2);

    this.catchAnim = {
      ballActor,
      startX,
      startZ,
      targetX: this.enemyUnit.x,
      targetZ: this.enemyUnit.z,
      phase: 'fly',
      t: 0,
      wigglesDone: 0,
      wigglesTotal: wiggles,
      caught,
      prob,
    };
    this.heroCheerTimer = 0.55;
    this.bannerText = `${this.state.playerName} hurled a ${ballBonus > 1.5 ? 'GOLDEN SUPER ' : ''}MONKEBALL! (${Math.round(prob * 100)}% lock-on)`;
  }

  tryRunAway() {
    if (!this.active || this.pendingEnd || this.catchAnim) return;
    if (this.mode === 'trainer') {
      this.onToast('Can’t run from an official Trainer challenge!');
      return;
    }
    this.audio.playSfx('menu');
    // Queue clean end-of-tick exit so `battle.update()` never hits `null` meshes!
    this._queueBattleEnd({ outcome: 'ran' }, 0.02);
  }

  _castMove(caster, target, moveId) {
    if (!caster || !target || this.pendingEnd) return false;
    const move = MOVES[moveId];
    if (!move || caster.stun > 0 || caster.jumpTimer > 0) return false;
    if ((caster.cooldowns[moveId] || 0) > 0) return false;

    caster.cooldowns[moveId] = move.cooldown || 2.5;
    const dx = target.x - caster.x;
    const dz = target.z - caster.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / dist;
    const nz = dz / dist;
    caster.yaw = Math.atan2(nx, nz);

    const elem = resolveMoveElement(move, caster.species);
    const elemColor = (ELEMENTS[elem] && ELEMENTS[elem].color) || move.color || '#fbbf24';
    if (caster.side === 'player') this.heroCheerTimer = 0.5;
    else this.rivalCheerTimer = 0.5;

    if (this.renderer && this.renderer.flashLight) {
      this.renderer.flashLight(caster.x, 1.6, caster.z, elemColor, 3.8, 0.22);
    }

    if (move.pattern === 'dash_strike') {
      this.audio.playSfx('monk_run');
      caster.invuln = Math.max(caster.invuln, move.invulnSec || 0.35);
      caster.dashTimer = 0.24;
      caster.dashVx = nx * ((move.dashDist || 5.5) / 0.24);
      caster.dashVz = nz * ((move.dashDist || 5.5) / 0.24);
      caster.dashHitDone = false;
      caster.dashMove = move;
      this._spawnShockwave(caster.x, caster.z, 1.2, elemColor);
      this._spawnBurst({ x: caster.x, y: 0.4, z: caster.z, color: elemColor, count: 12, speed: 3.6 });
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} zoomed in with MONK RUN!`;
      }
      return true;
    }

    if (move.pattern === 'feint_stun') {
      this.audio.playSfx('fake_out');
      caster.spinDur = 0.34;
      caster.spinTimer = 0.34;
      this._spawnBurst({
        x: caster.x + nx * 0.6,
        y: 0.75,
        z: caster.z + nz * 0.6,
        color: '#c084fc',
        count: 14,
        speed: 4.2,
        star: true,
      });
      this._spawnProjectile({
        owner: caster,
        target,
        x: caster.x + nx * 0.7,
        z: caster.z + nz * 0.7,
        vx: nx * (move.speed || 17.5),
        vz: nz * (move.speed || 17.5),
        radius: move.radius || 1.1,
        maxLife: (move.range || 7.5) / (move.speed || 17.5),
        move,
        color: '#a78bfa',
        stunSec: move.stunSec || 1.2,
      });
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} clapped a cheeky FAKE OUT!`;
      }
      return true;
    }

    if (move.pattern === 'chomp_heal') {
      this.audio.playSfx('eat_snack');
      caster.chompDur = 0.48;
      caster.chompTimer = 0.48;
      const healAmt = Math.max(4, Math.round(caster.mon.maxHp * (move.healPct || 0.26)));
      caster.mon.hp = Math.min(caster.mon.maxHp, caster.mon.hp + healAmt);
      caster.atkBuff = move.atkBuffSec || 6.0;
      this._spawnShockwave(caster.x, caster.z, move.radius || 2.3, '#4ade80');
      this._spawnBurst({
        x: caster.x,
        y: 0.5,
        z: caster.z,
        color: '#4ade80',
        count: 18,
        speed: 2.6,
        up: 3.8,
        gravity: 2.2,
        star: true,
      });
      this._emitUnitPopup(caster, `+${healAmt} HP 🍌`, '#4ade80');
      if (dist <= (move.radius || 2.3) + 0.7) {
        this._applyHit(caster, target, move);
      }
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} chomped a snack (+${healAmt} HP & ATK UP)!`;
      }
      return true;
    }

    if (move.pattern === 'jump_slam') {
      this.audio.playSfx('sky_jump');
      caster.invuln = Math.max(caster.invuln, move.invulnSec || 0.52);
      caster.jumpDur = 0.5;
      caster.jumpTimer = 0.5;
      caster.jumpMove = move;
      const leap = Math.min(dist * 0.88, move.leapDist || 4.8);
      caster.jumpVx = (nx * leap) / 0.5;
      caster.jumpVz = (nz * leap) / 0.5;
      this._spawnBurst({ x: caster.x, y: 0.2, z: caster.z, color: '#e2e8f0', count: 10, speed: 3.0, up: 2.0 });
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} vaulted sky-high with JUMP!`;
      }
      return true;
    }

    caster.specialDur = 0.45;
    caster.specialTimer = 0.45;

    if (move.pattern === 'aoe_self') {
      this.audio.playSfx('special');
      this._spawnShockwave(caster.x, caster.z, move.radius || 3.2, elemColor);
      this._spawnBurst({
        x: caster.x,
        y: 0.6,
        z: caster.z,
        color: elemColor,
        count: 22,
        speed: 5.5,
        up: 3.6,
        star: true,
      });
      if (dist <= (move.radius || 3.2) + 0.6) {
        this._applyHit(caster, target, move);
      }
      this.bannerText = `${caster.mon.nickname} unleashed ${move.name}!`;
      return true;
    }

    if (move.pattern === 'aoe_target') {
      this.audio.playSfx('special');
      this._spawnTelegraph({
        owner: caster,
        target,
        x: target.x,
        z: target.z,
        radius: move.radius || 2.4,
        delay: move.telegraphSec || 0.6,
        move,
        color: elemColor,
      });
      this.bannerText = `${caster.mon.nickname} called down ${move.name}!`;
      return true;
    }

    if (move.pattern === 'triple_fan' || move.pattern === 'projectile') {
      this.audio.playSfx('special');
      const angles = move.pattern === 'triple_fan' ? [-0.26, 0, 0.26] : [0];
      const baseAngle = Math.atan2(nx, nz);
      const spd = move.speed || 14.5;
      for (const off of angles) {
        const a = baseAngle + off;
        this._spawnProjectile({
          owner: caster,
          target,
          x: caster.x + Math.sin(a) * 0.75,
          z: caster.z + Math.cos(a) * 0.75,
          vx: Math.sin(a) * spd,
          vz: Math.cos(a) * spd,
          radius: move.radius || 0.9,
          maxLife: (move.range || 9.5) / spd,
          move,
          color: elemColor,
        });
      }
      this.bannerText = `${caster.mon.nickname} fired ${move.name}!`;
      return true;
    }

    return false;
  }

  _spawnProjectile({ owner, target, x, z, vx, vz, radius, maxLife, move, color, stunSec = 0 }) {
    if (!this.fxGroup) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.48, 14, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.35,
        roughness: 0.14,
      }),
    );
    mesh.position.set(x, 0.65, z);
    this.fxGroup.add(mesh);
    this.projectiles.push({ owner, target, x, z, vx, vz, radius, life: maxLife, move, stunSec, mesh });
  }

  _spawnTelegraph({ owner, target, x, z, radius, delay, move, color }) {
    if (!this.fxGroup) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.84, radius, 36),
      new THREE.MeshBasicMaterial({
        color: owner.side === 'enemy' ? '#ef4444' : color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);

    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.1, 32),
      new THREE.MeshBasicMaterial({
        color: owner.side === 'enemy' ? '#ef4444' : color,
        transparent: true,
        opacity: 0.32,
      }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(x, 0.05, z);
    this.fxGroup.add(ring, fill);

    this.telegraphs.push({
      owner,
      target,
      x,
      z,
      radius,
      elapsed: 0,
      delay,
      move,
      color,
      ring,
      fill,
    });
  }

  _spawnShockwave(x, z, maxRadius, color = '#fbbf24') {
    if (!this.fxGroup) return;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.09, 10, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0.14, z);
    this.fxGroup.add(mesh);
    this.shockwaves.push({ mesh, t: 0, dur: 0.34, maxRadius });
  }

  _emitUnitPopup(unit, text, color = '#ffffff') {
    if (!this.onFloatText || !unit) return;
    const p = this.renderer.projectToScreen(new THREE.Vector3(unit.x, 1.7, unit.z));
    if (p.visible) {
      this.onFloatText(p.x, p.y, text, color);
    }
  }

  _applyHit(attacker, defender, move, extraStun = 0) {
    if (!this.active || this.pendingEnd || !attacker || !defender || defender.mon.hp <= 0) return;
    if (defender.invuln > 0) {
      if (defender.side === 'player' && (defender.dashTimer > 0 || defender.jumpTimer > 0)) {
        this._bumpPlayerCombo(2);
        this._spawnBurst({ x: defender.x, y: 0.7, z: defender.z, color: '#38bdf8', count: 12, star: true });
        this._emitUnitPopup(defender, `PERFECT DODGE! ×${this.playerCombo} ✨`, '#38bdf8');
      } else {
        this._emitUnitPopup(defender, 'DODGED! ✨', '#38bdf8');
      }
      return;
    }

    const res = calculateHitDamage(attacker.mon, defender.mon, move, {
      attackerBuffed: attacker.atkBuff > 0,
      comboCount: attacker.side === 'player' ? this.playerCombo : 0,
    });
    defender.mon.hp = Math.max(0, defender.mon.hp - res.damage);
    defender.invuln = 0.18;
    defender.recoilTimer = 0.24;

    defender.hitFlash = 0.2;
    defender.hitFlashHex = res.effectiveness >= 1.35 ? 0xfde047 : 0xffffff;
    const kdx = defender.x - attacker.x;
    const kdz = defender.z - attacker.z;
    const kd = Math.max(0.01, Math.hypot(kdx, kdz));
    const kbPower = res.effectiveness >= 1.35 ? 6.5 : 4.2;
    defender.kbVx = (kdx / kd) * kbPower;
    defender.kbVz = (kdz / kd) * kbPower;

    if (this.renderer && this.renderer.flashLight) {
      this.renderer.flashLight(
        defender.x,
        1.5,
        defender.z,
        res.elementColor || '#fbbf24',
        res.effectiveness >= 1.35 ? 6.2 : 4.2,
        0.24,
      );
    }

    this._spawnBurst({
      x: defender.x,
      y: 0.75,
      z: defender.z,
      color: res.elementColor || '#fbbf24',
      count: res.effectiveness >= 1.35 ? 20 : 12,
      speed: res.effectiveness >= 1.35 ? 5.6 : 4.0,
      star: res.effectiveness >= 1.35 || extraStun > 0,
    });

    if (attacker.side === 'player') {
      this._bumpPlayerCombo(extraStun > 0 || res.effectiveness >= 1.35 ? 2 : 1);
      this.heroCheerTimer = 0.42;
    } else if (defender.side === 'player') {
      this.playerCombo = 0;
      this.comboDecayTimer = 0;
    }

    if (extraStun > 0) {
      defender.stun = Math.max(defender.stun, extraStun);
      if (defender.side === 'enemy' && this.fxGroup) {
        for (const tg of this.telegraphs) {
          if (tg.owner === defender) {
            this.fxGroup.remove(tg.ring, tg.fill);
            tg.cancelled = true;
          }
        }
        this.telegraphs = this.telegraphs.filter((t) => !t.cancelled);
      }
      this._emitUnitPopup(defender, `-${res.damage} STUNNED! 💫`, '#c084fc');
    } else if (res.effectiveness >= 1.35) {
      this.audio.playSfx('super_hit');
      this.renderer.triggerShake(0.28, 0.22);
      this._emitUnitPopup(defender, `-${res.damage} SUPER!`, '#fbbf24');
    } else {
      this.audio.playSfx('hit');
      this.renderer.triggerShake(0.14, 0.14);
      this._emitUnitPopup(
        defender,
        `-${res.damage}${res.isCrit ? ' CRIT!' : ''}`,
        res.elementColor || '#f8fafc',
      );
    }

    if (defender.mon.hp <= 0) {
      this._handleUnitFainted(defender);
    }
  }

  _handleUnitFainted(fainted) {
    if (!fainted || fainted._faintedHandled || this.pendingEnd) return;
    fainted._faintedHandled = true;
    this.audio.playSfx('faint');

    if (fainted.side === 'enemy') {
      const defeatedMon = fainted.mon;
      const expGain = Math.round(28 + defeatedMon.level * 16 * (defeatedMon.isAlpha ? 1.8 : 1.0));
      if (this.playerUnit && this.playerUnit.mon) {
        const lvInfo = grantExpToMon(this.playerUnit.mon, expGain);
        for (const m of this.state.party) {
          if (m !== this.playerUnit.mon && m.hp > 0) {
            grantExpToMon(m, Math.round(expGain * 0.45));
          }
        }
        this._emitUnitPopup(
          this.playerUnit,
          lvInfo.levelsGained > 0 ? `+${expGain} EXP · LV UP ${lvInfo.newLevel}!` : `+${expGain} EXP`,
          '#fde047',
        );
      }

      if (this.enemyIndex + 1 < this.enemyTeam.length) {
        this.enemyIndex += 1;
        const nextMon = this.enemyTeam[this.enemyIndex];
        this._spawnEnemyUnit(nextMon, this.center.x + 3.2, this.center.z);
        this.bannerText = `${this.trainerDef ? this.trainerDef.name : 'Rival'} sent out ${nextMon.nickname} (Lv.${nextMon.level})!`;
        return;
      }

      // Battle won!
      this.audio.playMusic('victory', false);
      this._spawnBurst({
        x: fainted.x,
        y: 0.7,
        z: fainted.z,
        color: '#facc15',
        count: 24,
        speed: 5.2,
        up: 4.2,
        star: true,
      });
      if (this.enemyActor) this.enemyActor.root.visible = false;

      let badgeAwarded = null;
      if (this.mode === 'trainer' && this.trainerDef) {
        if (!this.state.defeatedTrainers.includes(this.trainerDef.id)) {
          this.state.defeatedTrainers.push(this.trainerDef.id);
        }
        this.state.coins += this.trainerDef.rewardCoins || 150;
        if (this.trainerDef.badgeId && !this.state.badges.includes(this.trainerDef.badgeId)) {
          this.state.badges.push(this.trainerDef.badgeId);
          badgeAwarded = this.trainerDef.badgeName;
        }
      } else {
        this.state.coins += 45 + defeatedMon.level * 5;
      }

      this.heroCheerTimer = 1.2;
      this.bannerText = `VICTORY! ${this.playerUnit ? this.playerUnit.mon.nickname : 'Your squad'} won the arena match!`;
      const beatFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
      this._queueBattleEnd(
        {
          outcome: 'won',
          badgeAwarded,
          beatFinalBoss,
          wildRef: this.wildRef,
          trainerDef: this.trainerDef,
        },
        0.92,
      );
    } else {
      const nextIdx = this.state.party.findIndex((m) => m.hp > 0);
      if (nextIdx >= 0) {
        this.state.activeIndex = nextIdx;
        this._spawnPlayerUnit(this.state.party[nextIdx], this.center.x - 3.0, this.center.z);
        this.bannerText = `Come on, ${this.state.party[nextIdx].nickname}! Keep fighting!`;
      } else {
        if (this.playerActor) this.playerActor.root.visible = false;
        this.bannerText = 'Your squad needs a breather — heading safely back to the House!';
        this._queueBattleEnd({ outcome: 'lost' }, 0.65);
      }
    }
  }

  _clampToArena(unit) {
    const dx = unit.x - this.center.x;
    const dz = unit.z - this.center.z;
    const d = Math.hypot(dx, dz);
    const maxR = ARENA_RADIUS - 0.55;
    if (d > maxR) {
      unit.x = this.center.x + (dx / d) * maxR;
      unit.z = this.center.z + (dz / d) * maxR;
    }
  }

  _updateUnitKinematics(unit, moveVx, moveVz, dt) {
    if (!unit || !unit.actor) return;
    for (const k of Object.keys(unit.cooldowns)) {
      unit.cooldowns[k] = Math.max(0, unit.cooldowns[k] - dt);
    }
    unit.invuln = Math.max(0, unit.invuln - dt);
    unit.stun = Math.max(0, unit.stun - dt);
    unit.atkBuff = Math.max(0, unit.atkBuff - dt);
    unit.spinTimer = Math.max(0, (unit.spinTimer || 0) - dt);
    unit.chompTimer = Math.max(0, (unit.chompTimer || 0) - dt);
    unit.specialTimer = Math.max(0, (unit.specialTimer || 0) - dt);
    unit.recoilTimer = Math.max(0, (unit.recoilTimer || 0) - dt);

    if (unit.hitFlash > 0) {
      unit.hitFlash = Math.max(0, unit.hitFlash - dt);
      if (unit.actor.setHitFlash) {
        unit.actor.setHitFlash(unit.hitFlash / 0.2, unit.hitFlashHex);
      }
    }

    if (Math.hypot(unit.kbVx || 0, unit.kbVz || 0) > 0.08) {
      unit.x += unit.kbVx * dt;
      unit.z += unit.kbVz * dt;
      const damp = Math.exp(-12 * dt);
      unit.kbVx *= damp;
      unit.kbVz *= damp;
    }

    let currentMoveSpeed = 0;
    let jumpProg = 0;
    let justLanded = false;

    if (unit.dashTimer > 0) {
      unit.dashTimer = Math.max(0, unit.dashTimer - dt);
      unit.x += unit.dashVx * dt;
      unit.z += unit.dashVz * dt;
      currentMoveSpeed = 14.0;
      unit.trailTimer = (unit.trailTimer || 0) - dt;
      if (unit.trailTimer <= 0) {
        unit.trailTimer = 0.055;
        this._spawnBurst({ x: unit.x, y: 0.25, z: unit.z, color: '#fef08a', count: 3, speed: 1.8, up: 1.4, size: 0.12 });
      }
      const foe = unit.side === 'player' ? this.enemyUnit : this.playerUnit;
      if (!unit.dashHitDone && foe && Math.hypot(foe.x - unit.x, foe.z - unit.z) < 1.55) {
        unit.dashHitDone = true;
        this._applyHit(unit, foe, unit.dashMove);
      }
    } else if (unit.jumpTimer > 0) {
      unit.jumpTimer = Math.max(0, unit.jumpTimer - dt);
      unit.x += unit.jumpVx * dt;
      unit.z += unit.jumpVz * dt;
      jumpProg = 1.0 - unit.jumpTimer / Math.max(0.05, unit.jumpDur);
      unit.y = Math.sin(jumpProg * Math.PI) * 2.85;
      if (unit.jumpTimer <= 0) {
        unit.y = 0;
        justLanded = true;
        const m = unit.jumpMove || MOVES.sky_jump;
        const elem = resolveMoveElement(m, unit.species);
        const cHex = (ELEMENTS[elem] && ELEMENTS[elem].color) || '#38bdf8';
        this._spawnShockwave(unit.x, unit.z, m.radius || 2.45, cHex);
        this._spawnBurst({ x: unit.x, y: 0.25, z: unit.z, color: cHex, count: 18, speed: 5.2, up: 3.0, star: true });
        this.renderer.triggerShake(0.2, 0.16);
        const foe = unit.side === 'player' ? this.enemyUnit : this.playerUnit;
        if (foe && Math.hypot(foe.x - unit.x, foe.z - unit.z) <= (m.radius || 2.45) + 0.5) {
          this._applyHit(unit, foe, m);
        }
      }
    } else if (unit.stun <= 0) {
      const spd = 5.4 + (unit.mon.spd || 60) * 0.025;
      const inputMag = Math.min(1, Math.hypot(moveVx, moveVz));
      unit.x += moveVx * spd * dt;
      unit.z += moveVz * spd * dt;
      currentMoveSpeed = inputMag * spd;
      if (inputMag > 0.12) {
        unit.yaw = Math.atan2(moveVx, moveVz);
      }
      unit.y = 0;
    } else {
      unit.y = 0;
    }

    this._clampToArena(unit);
    unit.actor.root.position.set(unit.x, 0, unit.z);

    if (unit.actor.updateMotion) {
      unit.actor.updateMotion(dt, {
        targetYaw: unit.yaw,
        moveSpeed: currentMoveSpeed,
        inBattle: true,
        jumpHeight: unit.y,
        jumpProg,
        dashActive: unit.dashTimer > 0,
        spinProg: unit.spinTimer > 0 ? 1.0 - unit.spinTimer / unit.spinDur : 0,
        chompProg: unit.chompTimer > 0 ? 1.0 - unit.chompTimer / unit.chompDur : 0,
        specialProg: unit.specialTimer > 0 ? 1.0 - unit.specialTimer / unit.specialDur : 0,
        stun: unit.stun,
        hitRecoil: unit.recoilTimer > 0 ? unit.recoilTimer / 0.24 : 0,
        landedImpact: justLanded,
      });
    }
  }

  _updateEnemyAI(dt) {
    const e = this.enemyUnit;
    const p = this.playerUnit;
    if (!e || !p || this.pendingEnd || e.mon.hp <= 0) return;

    if (e.stun > 0) {
      this._updateUnitKinematics(e, 0, 0, dt);
      return;
    }

    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / dist;
    const nz = dz / dist;

    let mx = -nz * e.strafeDir * 0.65;
    let mz = nx * e.strafeDir * 0.65;
    if (dist > 4.6) {
      mx += nx * 0.75;
      mz += nz * 0.75;
    } else if (dist < 2.2) {
      mx -= nx * 0.55;
      mz -= nz * 0.55;
    }

    e.aiThink -= dt;
    if (e.aiThink <= 0) {
      e.aiThink = 1.05 + Math.random() * 0.75;
      if (Math.random() < 0.35) e.strafeDir *= -1;

      const moves = e.mon.moves;
      const specialId = moves[4] || moves[0];
      if ((e.cooldowns[specialId] || 0) <= 0 && Math.random() < 0.52) {
        this._castMove(e, p, specialId);
      } else if (e.mon.hp < e.mon.maxHp * 0.42 && (e.cooldowns.eat_snack || 0) <= 0 && Math.random() < 0.45) {
        this._castMove(e, p, 'eat_snack');
      } else if (dist < 4.8 && (e.cooldowns.sky_jump || 0) <= 0 && Math.random() < 0.45) {
        this._castMove(e, p, 'sky_jump');
      } else if ((e.cooldowns.monk_run || 0) <= 0) {
        this._castMove(e, p, 'monk_run');
      }
    }

    if (!this.pendingEnd && this.enemyUnit === e) {
      this._updateUnitKinematics(e, mx, mz, dt);
    }
  }

  _updateCatchSequence(dt) {
    const c = this.catchAnim;
    if (!c || this.pendingEnd) return;
    c.t += dt;

    if (c.phase === 'fly') {
      const dur = 0.48;
      const u = Math.min(1, c.t / dur);
      const x = c.startX + (c.targetX - c.startX) * u;
      const z = c.startZ + (c.targetZ - c.startZ) * u;
      const y = 1.1 * (1 - u) + Math.sin(u * Math.PI) * 3.1 + 0.35;
      c.ballActor.root.position.set(x, 0, z);
      c.ballActor.animRoot.position.y = y;
      c.ballActor.animRoot.rotation.x += dt * 12;
      if (u >= 1) {
        c.phase = 'wiggle';
        c.t = 0;
        this.audio.playSfx('ball_bounce');
        this._spawnShockwave(c.targetX, c.targetZ, 1.9, '#fde047');
        if (this.enemyActor) this.enemyActor.root.visible = false;
      }
      return;
    }

    if (c.phase === 'wiggle') {
      c.ballActor.animRoot.position.y = 0.12;
      c.ballActor.animRoot.rotation.x = 0;
      c.ballActor.animRoot.rotation.z = Math.sin(c.t * 16) * 0.32 * Math.exp(-c.t * 2.5);
      if (c.t >= 0.65) {
        c.t = 0;
        c.wigglesDone += 1;
        if (c.wigglesDone <= c.wigglesTotal) {
          this.audio.playSfx('ball_wiggle');
          this._spawnShockwave(c.targetX, c.targetZ, 1.1, '#38bdf8');
        } else if (c.caught) {
          this.audio.playSfx('catch_fanfare');
          if (this.renderer && this.renderer.flashLight) {
            this.renderer.flashLight(c.targetX, 1.8, c.targetZ, '#facc15', 7.0, 0.55);
          }
          this._spawnShockwave(c.targetX, c.targetZ, 2.8, '#fbbf24');
          this._spawnBurst({
            x: c.targetX,
            y: 0.45,
            z: c.targetZ,
            color: '#facc15',
            count: 28,
            speed: 5.5,
            up: 5.2,
            size: 0.2,
            life: 0.78,
            star: true,
          });
          const capturedMon = this.enemyUnit.mon;
          capturedMon.hp = capturedMon.maxHp;
          const slotInfo = addCaughtMonToState(this.state, capturedMon);
          if (this.playerUnit && this.playerUnit.mon) {
            grantExpToMon(this.playerUnit.mon, 35 + capturedMon.level * 12);
          }
          const caughtFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
          this.bannerText = `GOTCHA!! ${capturedMon.nickname} was caught in the Monkeball!`;
          this.heroCheerTimer = 1.2;
          c.phase = 'done';
          this._queueBattleEnd(
            {
              outcome: 'caught',
              capturedMon,
              slotInfo,
              beatFinalBoss: caughtFinalBoss,
              wildRef: this.wildRef,
            },
            0.9,
          );
        } else {
          this.audio.playSfx('break_free');
          if (this.enemyActor) this.enemyActor.root.visible = true;
          if (this.fxGroup) this.fxGroup.remove(c.ballActor.root);
          this.catchAnim = null;
          this.bannerText = `Oh no! ${this.enemyUnit.mon.nickname} popped out—weaken it more and try again!`;
        }
      }
    }
  }

  _updateEffects(dt) {
    if (!this.fxGroup) return;

    // Update projectiles
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      pr.mesh.position.set(pr.x, 0.65, pr.z);
      if (
        !this.pendingEnd &&
        pr.target &&
        pr.target.mon.hp > 0 &&
        pr.target.y < 1.35 &&
        Math.hypot(pr.target.x - pr.x, pr.target.z - pr.z) <= pr.radius + 0.45
      ) {
        this._applyHit(pr.owner, pr.target, pr.move, pr.stunSec || 0);
        pr.life = -1;
      }
      if (pr.life <= 0 && this.fxGroup) {
        this.fxGroup.remove(pr.mesh);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);

    // Update ground AoE telegraphs
    for (const tg of this.telegraphs) {
      tg.elapsed += dt;
      const u = Math.min(1, tg.elapsed / tg.delay);
      tg.fill.scale.setScalar(Math.max(0.05, u * 10));
      if (tg.elapsed >= tg.delay) {
        this._spawnShockwave(tg.x, tg.z, tg.radius, tg.color);
        this._spawnBurst({ x: tg.x, y: 0.35, z: tg.z, color: tg.color, count: 18, speed: 5.0, up: 3.4, star: true });
        if (
          !this.pendingEnd &&
          tg.target &&
          tg.target.mon.hp > 0 &&
          tg.target.y < 1.2 &&
          Math.hypot(tg.target.x - tg.x, tg.target.z - tg.z) <= tg.radius + 0.35
        ) {
          this._applyHit(tg.owner, tg.target, tg.move);
        }
        if (this.fxGroup) this.fxGroup.remove(tg.ring, tg.fill);
        tg.done = true;
      }
    }
    this.telegraphs = this.telegraphs.filter((t) => !t.done);

    // Update expanding shockwaves
    for (const sw of this.shockwaves) {
      sw.t += dt;
      const u = Math.min(1, sw.t / sw.dur);
      sw.mesh.scale.setScalar(0.35 + u * sw.maxRadius);
      sw.mesh.material.opacity = 0.92 * (1 - u);
      if (sw.t >= sw.dur && this.fxGroup) {
        this.fxGroup.remove(sw.mesh);
      }
    }
    this.shockwaves = this.shockwaves.filter((s) => s.t < s.dur);

    // Update 3D burst particles
    for (const pt of this.particles) {
      pt.t += dt;
      pt.vy -= pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y = Math.max(0.04, pt.y + pt.vy * dt);
      pt.z += pt.vz * dt;
      const u = Math.min(1, pt.t / pt.life);
      pt.mesh.position.set(pt.x, pt.y, pt.z);
      pt.mesh.rotation.y += dt * 7;
      pt.mesh.rotation.x += dt * 5;
      pt.mesh.scale.setScalar(pt.baseScale * (1 - u * 0.72));
      pt.mesh.material.opacity = 0.95 * (1 - u);
      if (pt.t >= pt.life) {
        if (this.fxGroup) this.fxGroup.remove(pt.mesh);
        pt.mesh.material.dispose();
      }
    }
    this.particles = this.particles.filter((pt) => pt.t < pt.life);
  }

  _finishBattle(result) {
    this.pendingEnd = null;
    this.cleanupMeshes();
    this.active = false;
    if (this.onBattleEnd) this.onBattleEnd(result);
  }

  update(dt, input) {
    if (!this.active) return;
    this.time += dt;

    if (this.arenaGroup && this.arenaGroup.userData.update) {
      this.arenaGroup.userData.update(this.time);
    }

    if (this.comboDecayTimer > 0) {
      this.comboDecayTimer = Math.max(0, this.comboDecayTimer - dt);
      if (this.comboDecayTimer <= 0) this.playerCombo = 0;
    }

    if (this.heroCheerTimer > 0) this.heroCheerTimer = Math.max(0, this.heroCheerTimer - dt);
    if (this.rivalCheerTimer > 0) this.rivalCheerTimer = Math.max(0, this.rivalCheerTimer - dt);

    if (this.heroCoachActor && this.heroCoachActor.updateMotion) {
      this.heroCoachActor.updateMotion(dt, {
        targetYaw: Math.PI * 0.5,
        inBattle: true,
        cheer: this.heroCheerTimer > 0 ? 1 : 0,
      });
    }
    if (this.rivalCoachActor && this.rivalCoachActor.updateMotion) {
      this.rivalCoachActor.updateMotion(dt, {
        targetYaw: -Math.PI * 0.5,
        inBattle: true,
        cheer: this.rivalCheerTimer > 0 ? 1 : 0,
      });
    }

    // Frame-safe completion countdown: animates celebration & finishes cleanly at top of tick!
    if (this.pendingEnd) {
      if (this.playerUnit && this.playerUnit.actor && this.playerUnit.actor.updateMotion && this.playerUnit.mon.hp > 0) {
        this.playerUnit.actor.updateMotion(dt, {
          targetYaw: 0,
          inBattle: true,
          cheer: this.pendingEnd.result.outcome === 'won' || this.pendingEnd.result.outcome === 'caught' ? 1 : 0,
        });
      }
      this._updateEffects(dt);
      this.pendingEnd.timer -= dt;
      if (this.pendingEnd.timer <= 0) {
        const finalRes = this.pendingEnd.result;
        this._finishBattle(finalRes);
      }
      return;
    }

    // Gamepad & Keyboard Battle Bindings ([A] Monk Run, [B] Fake Out, [X] Eat, [Y] Jump, [RB] Special)
    if (!this.catchAnim) {
      if (input.pressed.btnA) this.triggerPlayerMoveSlot(0);
      if (input.pressed.btnB) this.triggerPlayerMoveSlot(1);
      if (input.pressed.btnX) this.triggerPlayerMoveSlot(2);
      if (input.pressed.btnY) this.triggerPlayerMoveSlot(3);
      if (input.pressed.btnRB) this.triggerPlayerMoveSlot(4);
      if (input.pressed.btnLB) this.tryThrowBattleMonkeball();
      if (input.pressed.btnLT) this.cyclePartySwitch();
      if (input.pressed.back && this.mode === 'wild') this.tryRunAway();
    }

    if (this.pendingEnd) return;

    if (this.catchAnim) {
      this._updateCatchSequence(dt);
    } else {
      if (this.playerUnit && this.playerUnit.mon.hp > 0) {
        this._updateUnitKinematics(this.playerUnit, input.moveX, input.moveZ, dt);
      }
      if (!this.pendingEnd) {
        this._updateEnemyAI(dt);
      }
    }

    this._updateEffects(dt);
  }
}
