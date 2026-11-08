// Real-Time Tactical 2.5D Holo-Arena Battle Engine for Monkemon!
// Implements the Concept Spec Battle Layout:
//   - Left Rim: Hero ALEX cheering on `Monk 1`
//   - Right Rim: Rival Trainer / House Leader commanding `Monk 2` (or Wild / Alpha Boss #19 & #20)
//   - Split Battle Deck (`Fight` / `Monkeball` / `Switch` / `Run`) + Live Gamepad Action Diamond:
//       [A] Monk Run  ·  [B] Fake Out  ·  [X] Eat  ·  [Y] Jump  ·  [RB] Type Special

import * as THREE from 'three';
import { ELEMENTS, MOVES } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import {
  calculateHitDamage,
  computeCatchProbability,
  createMonkemonInstance,
  grantExpToMon,
  resolveMoveElement,
} from './combat_math.js';
import { addCaughtMonToState, markDexSeen } from './save_store.js';
import { buildBattleArenaGroup } from '../engine/diorama_builder.js';

const ARENA_RADIUS = 6.5;

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
    this.catchAnim = null; // active mid-battle Monkeball throw sequence
    this.bannerText = '';
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
    // Emergency safety mend so player can never softlock
    this.state.party[0].hp = this.state.party[0].maxHp;
    this.state.activeIndex = 0;
    return 0;
  }

  _setupEncounter({ centerPos, enemyTeam, music, headline }) {
    this.cleanupMeshes();
    this.active = true;
    this.time = 0;
    this.center = { x: centerPos.x, z: centerPos.z };
    this.enemyTeam = enemyTeam;
    this.enemyIndex = 0;
    this.projectiles = [];
    this.telegraphs = [];
    this.shockwaves = [];
    this.catchAnim = null;
    this.bannerText = headline;

    this.arenaGroup = buildBattleArenaGroup(this.center.x, this.center.z, ARENA_RADIUS);
    this.fxGroup = new THREE.Group();
    this.sceneRoot.add(this.arenaGroup, this.fxGroup);

    // Hero Trainer ALEX cheering on the left rim (Sticky Note 3 & 6!)
    this.heroCoachActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/hero_tamer.glb',
      scale: 1.65,
      primaryColor: '#38bdf8',
      secondaryColor: '#fef08a',
    });
    this.heroCoachActor.root.position.set(this.center.x - ARENA_RADIUS - 1.05, 0, this.center.z + 0.6);
    this.heroCoachActor.animRoot.rotation.y = Math.PI * 0.5;
    this.sceneRoot.add(this.heroCoachActor.root);

    // Rival Trainer / House Master on the right rim
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
      });
      this.rivalCoachActor.root.position.set(this.center.x + ARENA_RADIUS + 1.05, 0, this.center.z - 0.5);
      this.rivalCoachActor.animRoot.rotation.y = -Math.PI * 0.5;
      this.sceneRoot.add(this.rivalCoachActor.root);
    }

    const pIdx = this._pickHealthyPartyIndex();
    this._spawnPlayerUnit(this.state.party[pIdx], this.center.x - 3.1, this.center.z + 0.4);
    this._spawnEnemyUnit(this.enemyTeam[0], this.center.x + 3.1, this.center.z - 0.4);

    this.renderer.setCameraFraming(this.center.x, 0.75, this.center.z + 0.5, 'battle', false);
    this.audio.playMusic(music, true);
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
    });
    this.playerActor.root.position.set(x, 0, z);
    this.sceneRoot.add(this.playerActor.root);

    this.playerUnit = {
      side: 'player',
      mon,
      species: sp,
      actor: this.playerActor,
      x,
      z,
      y: 0,
      yaw: Math.PI * 0.5,
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
    };
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
    });
    this.enemyActor.root.position.set(x, 0, z);
    this.sceneRoot.add(this.enemyActor.root);

    this.enemyUnit = {
      side: 'enemy',
      mon,
      species: sp,
      actor: this.enemyActor,
      x,
      z,
      y: 0,
      yaw: -Math.PI * 0.5,
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
      aiThink: 0.75,
      strafeDir: 1,
    };
  }

  cleanupMeshes() {
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
    this.catchAnim = null;
  }

  // Triggered by Gamepad A/B/X/Y/RB or clicking a Move Card in the HUD
  triggerPlayerMoveSlot(slotIndex) {
    if (!this.active || !this.playerUnit || this.catchAnim) return;
    const moveId = this.playerUnit.mon.moves[slotIndex];
    if (!moveId) return;
    this._castMove(this.playerUnit, this.enemyUnit, moveId);
  }

  // Triggered by [LT] / `Q` / `Switch` button
  cyclePartySwitch() {
    if (!this.active || this.catchAnim) return;
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

  // Triggered by [LB] / `C` / `Monkeball` button in Battle
  tryThrowBattleMonkeball() {
    if (!this.active || this.catchAnim || !this.enemyUnit) return;
    if (this.mode === 'trainer') {
      this.audio.playSfx('break_free');
      this.bannerText = 'Haha! You cannot Monkeball another Trainer’s Monkemon!';
      return;
    }
    if (this.state.monkeballs <= 0) {
      this.onToast('Out of Monkeballs! Restock at any House or Pavilion!');
      return;
    }
    this.state.monkeballs -= 1;
    this.audio.playSfx('throw_ball');

    const ballActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.72,
      primaryColor: '#ef4444',
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
      ringMult: 1.28,
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
    this.bannerText = `ALEX hurled a smiling MONKEBALL! (${Math.round(prob * 100)}% lock-on)`;
  }

  tryRunAway() {
    if (!this.active || this.catchAnim) return;
    if (this.mode === 'trainer') {
      this.onToast('Can’t run from an official Trainer challenge!');
      return;
    }
    this.audio.playSfx('menu');
    this._finishBattle({ outcome: 'ran' });
  }

  _castMove(caster, target, moveId) {
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

    if (move.pattern === 'dash_strike') {
      // [A] MONK RUN: high-speed monkey dash with brief invulnerability!
      this.audio.playSfx('monk_run');
      caster.invuln = Math.max(caster.invuln, move.invulnSec || 0.35);
      caster.dashTimer = 0.24;
      caster.dashVx = nx * ((move.dashDist || 5.5) / 0.24);
      caster.dashVz = nz * ((move.dashDist || 5.5) / 0.24);
      caster.dashHitDone = false;
      caster.dashMove = move;
      this._spawnShockwave(caster.x, caster.z, 1.2, elemColor);
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} zoomed in with MONK RUN!`;
      }
      return true;
    }

    if (move.pattern === 'feint_stun') {
      // [B] FAKE OUT: fast clap shockwave projectile that interrupts & stuns!
      this.audio.playSfx('fake_out');
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
      // [X] EAT: restores 26% HP, buffs Attack, and chomps nearby foes!
      this.audio.playSfx('eat_snack');
      const healAmt = Math.max(4, Math.round(caster.mon.maxHp * (move.healPct || 0.26)));
      caster.mon.hp = Math.min(caster.mon.maxHp, caster.mon.hp + healAmt);
      caster.atkBuff = move.atkBuffSec || 6.0;
      this._spawnShockwave(caster.x, caster.z, move.radius || 2.3, '#4ade80');
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
      // [Y] JUMP: vaults high into the air (dodging ground hazards) & crashes down!
      this.audio.playSfx('sky_jump');
      caster.invuln = Math.max(caster.invuln, move.invulnSec || 0.52);
      caster.jumpDur = 0.5;
      caster.jumpTimer = 0.5;
      caster.jumpMove = move;
      const leap = Math.min(dist * 0.88, move.leapDist || 4.8);
      caster.jumpVx = (nx * leap) / 0.5;
      caster.jumpVz = (nz * leap) / 0.5;
      if (caster.side === 'player') {
        this.bannerText = `${caster.mon.nickname} vaulted sky-high with JUMP!`;
      }
      return true;
    }

    if (move.pattern === 'aoe_self') {
      this.audio.playSfx('special');
      this._spawnShockwave(caster.x, caster.z, move.radius || 3.2, elemColor);
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
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.48, 14, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        roughness: 0.18,
      }),
    );
    mesh.position.set(x, 0.65, z);
    this.fxGroup.add(mesh);
    this.projectiles.push({ owner, target, x, z, vx, vz, radius, life: maxLife, move, stunSec, mesh });
  }

  _spawnTelegraph({ owner, target, x, z, radius, delay, move, color }) {
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
    if (!this.onFloatText) return;
    const p = this.renderer.projectToScreen(new THREE.Vector3(unit.x, 1.7, unit.z));
    if (p.visible) {
      this.onFloatText(p.x, p.y, text, color);
    }
  }

  _applyHit(attacker, defender, move, extraStun = 0) {
    if (!defender || defender.mon.hp <= 0) return;
    if (defender.invuln > 0) {
      this._emitUnitPopup(defender, 'DODGED! ✨', '#38bdf8');
      return;
    }

    const res = calculateHitDamage(attacker.mon, defender.mon, move, {
      attackerBuffed: attacker.atkBuff > 0,
    });
    defender.mon.hp = Math.max(0, defender.mon.hp - res.damage);
    defender.invuln = 0.18;

    if (extraStun > 0) {
      defender.stun = Math.max(defender.stun, extraStun);
      // Fake Out interrupts enemy pending telegraphs!
      if (defender.side === 'enemy') {
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
    this.audio.playSfx('faint');
    if (fainted.side === 'enemy') {
      const defeatedMon = fainted.mon;
      const expGain = Math.round(28 + defeatedMon.level * 16 * (defeatedMon.isAlpha ? 1.8 : 1.0));
      const lvInfo = grantExpToMon(this.playerUnit.mon, expGain);
      // Share 45% party EXP with bench companions
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

      if (this.enemyIndex + 1 < this.enemyTeam.length) {
        this.enemyIndex += 1;
        const nextMon = this.enemyTeam[this.enemyIndex];
        this._spawnEnemyUnit(nextMon, this.center.x + 3.2, this.center.z);
        this.bannerText = `${this.trainerDef.name} sent out ${nextMon.nickname} (Lv.${nextMon.level})!`;
        return;
      }

      // Battle won!
      this.audio.playMusic('victory', false);
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

      const beatFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
      setTimeout(() => {
        if (!this.active) return;
        this._finishBattle({
          outcome: 'won',
          badgeAwarded,
          beatFinalBoss,
          wildRef: this.wildRef,
          trainerDef: this.trainerDef,
        });
      }, 950);
    } else {
      // Player's active Monkemon fainted — send out next healthy Monkemon if available!
      const nextIdx = this.state.party.findIndex((m) => m.hp > 0);
      if (nextIdx >= 0) {
        this.state.activeIndex = nextIdx;
        this._spawnPlayerUnit(this.state.party[nextIdx], this.center.x - 3.0, this.center.z);
        this.bannerText = `Come on, ${this.state.party[nextIdx].nickname}! Keep fighting!`;
      } else {
        this._finishBattle({ outcome: 'lost' });
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
    for (const k of Object.keys(unit.cooldowns)) {
      unit.cooldowns[k] = Math.max(0, unit.cooldowns[k] - dt);
    }
    unit.invuln = Math.max(0, unit.invuln - dt);
    unit.stun = Math.max(0, unit.stun - dt);
    unit.atkBuff = Math.max(0, unit.atkBuff - dt);

    if (unit.dashTimer > 0) {
      unit.dashTimer = Math.max(0, unit.dashTimer - dt);
      unit.x += unit.dashVx * dt;
      unit.z += unit.dashVz * dt;
      const foe = unit.side === 'player' ? this.enemyUnit : this.playerUnit;
      if (!unit.dashHitDone && foe && Math.hypot(foe.x - unit.x, foe.z - unit.z) < 1.55) {
        unit.dashHitDone = true;
        this._applyHit(unit, foe, unit.dashMove);
      }
    } else if (unit.jumpTimer > 0) {
      unit.jumpTimer = Math.max(0, unit.jumpTimer - dt);
      unit.x += unit.jumpVx * dt;
      unit.z += unit.jumpVz * dt;
      const prog = 1.0 - unit.jumpTimer / unit.jumpDur;
      unit.y = Math.sin(prog * Math.PI) * 2.85;
      if (unit.jumpTimer <= 0) {
        unit.y = 0;
        const m = unit.jumpMove || MOVES.sky_jump;
        const elem = resolveMoveElement(m, unit.species);
        this._spawnShockwave(unit.x, unit.z, m.radius || 2.45, (ELEMENTS[elem] && ELEMENTS[elem].color) || '#38bdf8');
        const foe = unit.side === 'player' ? this.enemyUnit : this.playerUnit;
        if (foe && Math.hypot(foe.x - unit.x, foe.z - unit.z) <= (m.radius || 2.45) + 0.5) {
          this._applyHit(unit, foe, m);
        }
      }
    } else if (unit.stun <= 0) {
      const spd = 5.4 + (unit.mon.spd || 60) * 0.025;
      unit.x += moveVx * spd * dt;
      unit.z += moveVz * spd * dt;
      if (Math.hypot(moveVx, moveVz) > 0.12) {
        unit.yaw = Math.atan2(moveVx, moveVz);
      }
      unit.y = Math.abs(Math.sin(this.time * (Math.hypot(moveVx, moveVz) > 0.1 ? 11 : 3.5))) *
        (Math.hypot(moveVx, moveVz) > 0.1 ? 0.22 : 0.06);
    } else {
      unit.y = 0;
    }

    this._clampToArena(unit);
    unit.actor.root.position.set(unit.x, 0, unit.z);
    unit.actor.animRoot.position.y = unit.y;
    unit.actor.animRoot.rotation.y = unit.yaw + (unit.stun > 0 ? Math.sin(this.time * 28) * 0.28 : 0);
    const squash = unit.dashTimer > 0 ? 1.18 : 1.0;
    unit.actor.animRoot.scale.set(1 / Math.sqrt(squash), squash, squash);
  }

  _updateEnemyAI(dt) {
    const e = this.enemyUnit;
    const p = this.playerUnit;
    if (!e || !p || e.stun > 0 || e.mon.hp <= 0) return;

    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / dist;
    const nz = dz / dist;

    // Strafe & keep dynamic arena spacing
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

    this._updateUnitKinematics(e, mx, mz, dt);
  }

  _updateCatchSequence(dt) {
    const c = this.catchAnim;
    if (!c) return;
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
      if (c.t >= 0.68) {
        c.t = 0;
        c.wigglesDone += 1;
        if (c.wigglesDone <= c.wigglesTotal) {
          this.audio.playSfx('ball_wiggle');
          this._spawnShockwave(c.targetX, c.targetZ, 1.1, '#38bdf8');
        } else if (c.caught) {
          this.audio.playSfx('catch_fanfare');
          this._spawnShockwave(c.targetX, c.targetZ, 2.8, '#fbbf24');
          const capturedMon = this.enemyUnit.mon;
          capturedMon.hp = capturedMon.maxHp;
          const slotInfo = addCaughtMonToState(this.state, capturedMon);
          grantExpToMon(this.playerUnit.mon, 35 + capturedMon.level * 12);
          const caughtFinalBoss = Boolean(this.wildRef && this.wildRef.isFinalBoss);
          this.bannerText = `GOTCHA!! ${capturedMon.nickname} was caught in the Monkeball!`;
          c.phase = 'done';
          setTimeout(() => {
            if (!this.active) return;
            this._finishBattle({
              outcome: 'caught',
              capturedMon,
              slotInfo,
              beatFinalBoss: caughtFinalBoss,
              wildRef: this.wildRef,
            });
          }, 950);
        } else {
          this.audio.playSfx('break_free');
          if (this.enemyActor) this.enemyActor.root.visible = true;
          this.fxGroup.remove(c.ballActor.root);
          this.catchAnim = null;
          this.bannerText = `Oh no! ${this.enemyUnit.mon.nickname} popped out—weaken it more and try again!`;
        }
      }
    }
  }

  _finishBattle(result) {
    this.cleanupMeshes();
    this.active = false;
    if (this.onBattleEnd) this.onBattleEnd(result);
  }

  update(dt, input) {
    if (!this.active) return;
    this.time += dt;

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

    if (this.catchAnim) {
      this._updateCatchSequence(dt);
    } else {
      if (this.playerUnit && this.playerUnit.mon.hp > 0) {
        this._updateUnitKinematics(this.playerUnit, input.moveX, input.moveZ, dt);
      }
      this._updateEnemyAI(dt);
    }

    // Update projectiles
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      pr.mesh.position.set(pr.x, 0.65, pr.z);
      if (
        pr.target &&
        pr.target.mon.hp > 0 &&
        pr.target.y < 1.35 &&
        Math.hypot(pr.target.x - pr.x, pr.target.z - pr.z) <= pr.radius + 0.45
      ) {
        this._applyHit(pr.owner, pr.target, pr.move, pr.stunSec || 0);
        pr.life = -1;
      }
      if (pr.life <= 0) {
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
        if (
          tg.target &&
          tg.target.mon.hp > 0 &&
          tg.target.y < 1.2 &&
          Math.hypot(tg.target.x - tg.x, tg.target.z - tg.z) <= tg.radius + 0.35
        ) {
          this._applyHit(tg.owner, tg.target, tg.move);
        }
        this.fxGroup.remove(tg.ring, tg.fill);
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
      if (sw.t >= sw.dur) {
        this.fxGroup.remove(sw.mesh);
      }
    }
    this.shockwaves = this.shockwaves.filter((s) => s.t < s.dur);
  }
}
