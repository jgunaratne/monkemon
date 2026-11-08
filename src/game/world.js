// 2.5D Overworld Exploration, Partner Follower, Wild Roaming Monkemon,
// Shrinking Timing-Ring Monkeball Catch Mechanic, Berry Feeding, House Visits & Trainer Challenges!

import * as THREE from 'three';
import { ELEMENTS } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import { ZONES } from '../data/zones.js';
import { buildZoneDiorama } from '../engine/diorama_builder.js';
import { makeLabelSprite } from '../engine/model_loader.js';
import {
  computeCatchProbability,
  createMonkemonInstance,
  gradeTimingRing,
  grantExpToMon,
} from './combat_math.js';
import { addCaughtMonToState, healAllParty, markDexSeen } from './save_store.js';

export class WorldController {
  constructor({
    sceneRoot,
    modelBank,
    renderer,
    audio,
    state,
    onToast,
    onFloatText,
    onStartWildBattle,
    onStartTrainerBattle,
    onZoneChanged,
    onApexVictory,
  }) {
    this.sceneRoot = sceneRoot;
    this.modelBank = modelBank;
    this.renderer = renderer;
    this.audio = audio;
    this.state = state;
    this.onToast = onToast;
    this.onFloatText = onFloatText;
    this.onStartWildBattle = onStartWildBattle;
    this.onStartTrainerBattle = onStartTrainerBattle;
    this.onZoneChanged = onZoneChanged;
    this.onApexVictory = onApexVictory;

    this.zone = null;
    this.diorama = null;
    this.entitiesGroup = new THREE.Group();
    this.sceneRoot.add(this.entitiesGroup);

    this.heroActor = null;
    this.partnerActor = null;
    this.partnerSpeciesId = null;

    this.heroX = -6;
    this.heroZ = 7.5;
    this.heroYaw = 0;
    this.heroMoving = false;
    this.partnerX = -7.2;
    this.partnerZ = 8.4;
    this.partnerYaw = 0;

    this.wildEntities = [];
    this.trainerEntities = [];
    this.aimRing = null;        // { target, radiusNorm, dir, meshRing, meshOuter }
    this.overworldThrow = null; // active flying `monkeball.glb` sequence in overworld
    this.promptText = '';
    this.time = 0;
    this.gateCooldown = 0;
  }

  initHeroActors() {
    if (this.heroActor) this.entitiesGroup.remove(this.heroActor.root);
    this.heroActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/hero_tamer.glb',
      scale: 1.62,
      primaryColor: '#38bdf8',
      secondaryColor: '#fef08a',
      shadowRadius: 0.55,
      animateRig: true,
    });
    const badge = makeLabelSprite({
      title: this.state.playerName || 'ALEX',
      badgeText: 'HERO',
      badgeColor: '#38bdf8',
      widthWorld: 2.35,
    });
    badge.position.set(0, 2.1, 0);
    this.heroActor.root.add(badge);
    this.entitiesGroup.add(this.heroActor.root);
    this.refreshPartnerActor();
  }

  refreshPartnerActor() {
    const activeMon = this.state.party[this.state.activeIndex] || this.state.party[0];
    if (!activeMon) return;
    if (this.partnerActor && this.partnerSpeciesId === activeMon.speciesId) return;
    if (this.partnerActor) this.entitiesGroup.remove(this.partnerActor.root);

    const sp = getSpecies(activeMon.speciesId);
    this.partnerSpeciesId = sp.id;
    this.partnerActor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale: (sp.scale || 1.05) * 0.96,
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: 0.5,
      animateRig: true,
    });
    this.partnerX = this.heroX - 1.35;
    this.partnerZ = this.heroZ + 1.05;
    this.partnerActor.root.position.set(this.partnerX, 0, this.partnerZ);
    this.entitiesGroup.add(this.partnerActor.root);
  }

  loadZone(zoneId, spawnOverride = null) {
    const zone = ZONES[zoneId] || ZONES.sunpalm;
    this.zone = zone;
    this.state.zoneId = zone.id;

    if (this.diorama) {
      this.sceneRoot.remove(this.diorama.group);
    }
    this._clearZoneEntities();

    this.diorama = buildZoneDiorama(zone, this.modelBank);
    this.sceneRoot.add(this.diorama.group);
    this.renderer.setZoneAtmosphere(zone);

    const sx = spawnOverride ? spawnOverride.x : zone.playerSpawn.x;
    const sz = spawnOverride ? spawnOverride.z : zone.playerSpawn.z;
    this.heroX = sx;
    this.heroZ = sz;
    this.partnerX = sx - 1.3;
    this.partnerZ = sz + 1.0;
    this.state.pos = { x: sx, z: sz };
    this.gateCooldown = 0.85;

    if (!this.heroActor) this.initHeroActors();
    this.heroActor.root.position.set(this.heroX, 0, this.heroZ);
    if (this.partnerActor) this.partnerActor.root.position.set(this.partnerX, 0, this.partnerZ);

    this._spawnZoneTrainers(zone);
    this._spawnZoneWildMonkemon(zone);

    this.renderer.setCameraFraming(this.heroX, 0.7, this.heroZ, 'overworld', true);
    this.audio.playMusic(zone.music || 'sunpalm', true);

    // Prefetch upcoming battle & zone voice clips so playback has zero lag!
    this.audio.prefetch('battle');
    this.audio.prefetch('warden');
    for (const h of zone.houses || []) {
      if (h.voiceKey) this.audio.prefetchVoice(h.voiceKey);
    }
    for (const tr of zone.trainers || []) {
      if (tr.voiceKey) this.audio.prefetchVoice(tr.voiceKey);
    }
    for (const ap of zone.apexSpawns || []) {
      if (ap.voiceKey) this.audio.prefetchVoice(ap.voiceKey);
      if (ap.music) this.audio.prefetch(ap.music);
    }

    if (this.onZoneChanged) this.onZoneChanged(zone);
  }

  _clearZoneEntities() {
    for (const w of this.wildEntities) {
      this.entitiesGroup.remove(w.actor.root);
    }
    for (const tr of this.trainerEntities) {
      this.entitiesGroup.remove(tr.actor.root);
    }
    if (this.aimRing) {
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
    }
    if (this.overworldThrow) {
      this.entitiesGroup.remove(this.overworldThrow.ballActor.root);
      this.overworldThrow = null;
    }
    this.wildEntities = [];
    this.trainerEntities = [];
  }

  _pickWeightedWild(pool) {
    const total = pool.reduce((acc, p) => acc + (p.weight || 1), 0);
    let r = Math.random() * total;
    for (const entry of pool) {
      r -= entry.weight || 1;
      if (r <= 0) {
        const lv = entry.minLv + Math.floor(Math.random() * (entry.maxLv - entry.minLv + 1));
        return { speciesId: entry.speciesId, level: lv };
      }
    }
    const first = pool[0];
    return { speciesId: first.speciesId, level: first.minLv || 3 };
  }

  _spawnZoneWildMonkemon(zone) {
    // 1. Regular roaming wild Monkemon
    for (const spot of zone.wildSpots || []) {
      const picked = this._pickWeightedWild(zone.wildPool || []);
      this._createWildEntity({
        speciesId: picked.speciesId,
        level: picked.level,
        homeX: spot.x,
        homeZ: spot.z,
        isAlpha: false,
      });
    }

    // 2. Guaranteed Apex Boss Spawns (#19 Titanape & #20 King Monkezilla in Cinderpeak!)
    for (const ap of zone.apexSpawns || []) {
      this._createWildEntity({
        id: ap.id,
        speciesId: ap.speciesId,
        level: ap.level,
        homeX: ap.x,
        homeZ: ap.z,
        isAlpha: true,
        isFinalBoss: Boolean(ap.isFinalBoss),
        music: ap.music,
        voiceKey: ap.voiceKey,
        introLine: ap.introLine,
      });
    }
  }

  _createWildEntity(cfg) {
    const sp = getSpecies(cfg.speciesId);
    const elemMeta = ELEMENTS[sp.element] || ELEMENTS.mug;
    const scale = (sp.scale || 1.05) * (cfg.isAlpha ? 1.42 : 1.0);
    const actor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale,
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: cfg.isAlpha ? 1.15 : 0.55,
      animateRig: true,
    });
    actor.root.position.set(cfg.homeX, 0, cfg.homeZ);

    const label = makeLabelSprite({
      title: `${cfg.isAlpha ? '👑 ' : ''}${sp.name} Lv.${cfg.level}`,
      subtitle: cfg.isFinalBoss ? 'BOSS #20 · [Y] Ball / [RB] Battle' : cfg.isAlpha ? 'GUARDIAN #19' : '',
      badgeText: `${elemMeta.icon} ${elemMeta.label}`,
      badgeColor: elemMeta.color,
      borderColor: cfg.isAlpha ? '#facc15' : '#cbd5e1',
      widthWorld: cfg.isAlpha ? 4.3 : 3.05,
    });
    label.position.set(0, scale + 0.85, 0);
    actor.root.add(label);

    this.entitiesGroup.add(actor.root);

    const ent = {
      ...cfg,
      species: sp,
      actor,
      label,
      x: cfg.homeX,
      z: cfg.homeZ,
      yaw: Math.random() * Math.PI * 2,
      wanderTimer: Math.random() * 2.5,
      vx: 0,
      vz: 0,
      berryFed: false,
      hpFrac: 1.0,
      beingCaught: false,
    };
    this.wildEntities.push(ent);
    return ent;
  }

  removeWildEntity(ent) {
    if (!ent) return;
    this.entitiesGroup.remove(ent.actor.root);
    this.wildEntities = this.wildEntities.filter((w) => w !== ent);
  }

  _spawnZoneTrainers(zone) {
    for (const tr of zone.trainers || []) {
      const glb =
        tr.modelId === 'trainer_warden'
          ? 'assets/models/trainer_warden.glb'
          : 'assets/models/trainer_scout.glb';
      const actor = this.modelBank.spawnActor({
        glbUrl: glb,
        scale: tr.isWarden ? 1.85 : 1.62,
        primaryColor: tr.isWarden ? '#f59e0b' : '#fb7185',
        secondaryColor: '#fef3c7',
        shadowRadius: 0.62,
        animateRig: true,
      });
      actor.root.position.set(tr.x, 0, tr.z);
      actor.animRoot.rotation.y = tr.yaw || 0;

      const defeated = this.state.defeatedTrainers.includes(tr.id);
      const label = makeLabelSprite({
        title: tr.name,
        subtitle: defeated ? '✓ Defeated · [A] Rematch' : `${tr.role} · [A] Battle!`,
        badgeText: tr.isWarden ? '🏅 LEADER' : '⚔️ TAMER',
        badgeColor: defeated ? '#4ade80' : tr.isWarden ? '#fbbf24' : '#f87171',
        widthWorld: 3.6,
      });
      label.position.set(0, 2.35, 0);
      actor.root.add(label);

      this.entitiesGroup.add(actor.root);
      this.trainerEntities.push({
        def: tr,
        actor,
        label,
        x: tr.x,
        z: tr.z,
        yaw: tr.yaw || 0,
      });
    }
  }

  refreshTrainerLabels() {
    for (const tr of this.trainerEntities) {
      tr.actor.root.remove(tr.label);
      const defeated = this.state.defeatedTrainers.includes(tr.def.id);
      tr.label = makeLabelSprite({
        title: tr.def.name,
        subtitle: defeated ? '✓ Defeated · [A] Rematch' : `${tr.def.role} · [A] Battle!`,
        badgeText: tr.def.isWarden ? '🏅 LEADER' : '⚔️ TAMER',
        badgeColor: defeated ? '#4ade80' : tr.def.isWarden ? '#fbbf24' : '#f87171',
        widthWorld: 3.6,
      });
      tr.label.position.set(0, 2.35, 0);
      tr.actor.root.add(tr.label);
    }
  }

  pushNearbyWildsAway(minDist = 3.0) {
    if (!this.zone) return;
    const { halfW, halfD } = this.zone.bounds;
    for (const w of this.wildEntities) {
      if (w.isFinalBoss) continue;
      const dx = w.x - this.heroX;
      const dz = w.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (d < minDist) {
        const ang = d > 0.01 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
        w.x = Math.max(-halfW + 1.5, Math.min(halfW - 1.5, this.heroX + Math.sin(ang) * (minDist + 0.5)));
        w.z = Math.max(-halfD + 1.5, Math.min(halfD - 1.5, this.heroZ + Math.cos(ang) * (minDist + 0.5)));
        w.vx = 0;
        w.vz = 0;
        w.actor.root.position.set(w.x, 0, w.z);
      }
    }
  }

  _findNearestWild(maxDist = 8.8) {
    let best = null;
    let bestD = maxDist;
    for (const w of this.wildEntities) {
      if (w.beingCaught) continue;
      const d = Math.hypot(w.x - this.heroX, w.z - this.heroZ);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  // [Y] / `F` / `J`: Opens or releases the Shrinking Timing-Ring Monkeball Throw!
  startOrReleaseAimRing() {
    if (this.overworldThrow) return;
    if (this.aimRing) {
      const target = this.aimRing.target;
      const rNorm = this.aimRing.radiusNorm;
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
      this.throwOverworldMonkeball(target, rNorm);
      return;
    }

    const target = this._findNearestWild(9.5);
    if (!target) {
      this.onToast('Move closer to a wild Monkemon to aim a Monkeball!');
      return;
    }
    if (this.state.monkeballs <= 0) {
      this.onToast('Out of Monkeballs! Visit any House or Pavilion to restock!');
      return;
    }

    markDexSeen(this.state, target.speciesId);
    const g = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(1.18, 1.26, 36),
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.18, 36),
      new THREE.MeshBasicMaterial({ color: '#4ade80', side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    g.position.set(target.x, 0.85, target.z);
    g.add(outer, inner);
    this.entitiesGroup.add(g);

    this.aimRing = {
      target,
      radiusNorm: 1.0,
      group: g,
      inner,
      outer,
    };
    this.audio.playSfx('menu');
  }

  // [LB] / `C` / Right-Click: Quick-throw Monkeball (or release active Timing Ring)
  quickThrowMonkeball() {
    if (this.aimRing) {
      this.startOrReleaseAimRing();
      return;
    }
    const target = this._findNearestWild(9.5);
    if (!target) {
      this.onToast('Step near a wild Monkemon to throw a smiling Monkeball!');
      return;
    }
    this.throwOverworldMonkeball(target, 0.52);
  }

  throwOverworldMonkeball(target, radiusNorm = 0.55) {
    if (!target || this.overworldThrow) return;
    if (this.state.monkeballs <= 0) {
      this.onToast('No Monkeballs left! Visit a House to restock for free!');
      return;
    }
    this.state.monkeballs -= 1;
    markDexSeen(this.state, target.speciesId);

    const ringGrade = gradeTimingRing(radiusNorm);
    const prob = computeCatchProbability({
      species: target.species,
      currentHp: target.hpFrac * 100,
      maxHp: 100,
      ringMult: ringGrade.mult,
      berryFed: target.berryFed,
      badgesCount: this.state.badges.length,
    });
    const caught = Math.random() < prob;

    this.audio.playSfx('throw_ball');
    target.beingCaught = true;

    const pScreen = this.renderer.projectToScreen(new THREE.Vector3(target.x, 1.8, target.z));
    if (pScreen.visible && this.onFloatText) {
      this.onFloatText(pScreen.x, pScreen.y, `${ringGrade.grade} (${Math.round(prob * 100)}%)`, ringGrade.color);
    }

    const ballActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.72,
      primaryColor: '#ef4444',
      secondaryColor: '#fef3c7',
      shadowRadius: 0.35,
    });
    ballActor.root.position.set(this.heroX, 0, this.heroZ);
    this.entitiesGroup.add(ballActor.root);

    this.overworldThrow = {
      target,
      ballActor,
      startX: this.heroX,
      startZ: this.heroZ,
      targetX: target.x,
      targetZ: target.z,
      phase: 'fly',
      t: 0,
      wigglesDone: 0,
      wigglesTotal: caught ? 3 : 1 + Math.floor(Math.random() * 2),
      caught,
    };
  }

  // [X] / `E`: Toss a Peanut-Butter Berry to make wild Monkemon much easier to catch!
  tossBerryAtNearestWild() {
    const target = this._findNearestWild(8.8);
    if (!target) {
      this.onToast('Move near a wild Monkemon to toss a Peanut-Butter Berry!');
      return;
    }
    if (target.berryFed) {
      this.onToast(`${target.species.name} is already happily munching a Berry (+42% Catch)!`);
      return;
    }
    if (this.state.berries <= 0) {
      this.onToast('Out of Berries! Shake any golden Berry Tree with [A]!');
      return;
    }
    this.state.berries -= 1;
    target.berryFed = true;
    this.audio.playSfx('berry');
    const p = this.renderer.projectToScreen(new THREE.Vector3(target.x, 1.8, target.z));
    if (p.visible && this.onFloatText) {
      this.onFloatText(p.x, p.y, '🍓 BERRY FED! Catch Rate ↑', '#4ade80');
    }
  }

  // [RB] / `L`: Command Partner Monkemon to engage nearest wild/Boss Monkemon in Real-Time Arena Battle!
  engageNearestWildBattle() {
    const target = this._findNearestWild(8.5);
    if (!target) {
      this.onToast('Approach a wild Monkemon or Trainer to start an Arena Battle!');
      return;
    }
    if (target.voiceKey) {
      this.audio.playVoice(target.voiceKey, {
        speaker: target.species.name.toUpperCase(),
        line: target.introLine || '',
      });
    }
    this.onStartWildBattle(target, {
      x: (this.heroX + target.x) * 0.5,
      z: (this.heroZ + target.z) * 0.5,
    });
  }

  // [A] / `Space`: Context-sensitive interact (Houses, Trainers, Banana Shrines, Berry Trees, Wild Monkemon)
  interact() {
    if (!this.diorama) return;

    // 1. Check House Doorsteps
    for (const h of this.diorama.houseInteractables) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.1) {
        healAllParty(this.state);
        if (h.restockBalls && this.state.monkeballs < 20) {
          this.state.monkeballs = Math.min(30, this.state.monkeballs + h.restockBalls);
        } else if (this.state.monkeballs < 10) {
          this.state.monkeballs = 12;
        }
        this.audio.playSfx('heal');
        if (h.voiceKey) {
          this.audio.playVoice(h.voiceKey, {
            speaker: h.label,
            line: h.voiceLine || `Welcome to ${h.label}! Your Monkemon are fully healed!`,
          });
        }
        this.onToast(`🏠 ${h.label}: Party fully healed & Monkeballs topped up!`);
        return;
      }
    }

    // 2. Check Trainers
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.4) {
        this.audio.playSfx('trainer_spot');
        if (tr.def.voiceKey) {
          this.audio.playVoice(tr.def.voiceKey, {
            speaker: tr.def.name,
            line: tr.def.introLine || '',
          });
        }
        this.onStartTrainerBattle(tr.def, {
          x: (this.heroX + tr.x) * 0.5,
          z: (this.heroZ + tr.z) * 0.5,
        });
        return;
      }
    }

    // 3. Check Banana Shrines
    for (const sh of this.diorama.shrineInteractables) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.8) {
        healAllParty(this.state);
        this.state.berries = Math.min(30, this.state.berries + 3);
        this.audio.playSfx('heal');
        this.onToast('✨ Golden Banana Shrine blessed your party (+Full HP & +3 Berries)!');
        return;
      }
    }

    // 4. Check Berry Trees
    for (const bt of this.diorama.berryInteractables) {
      if (bt.cooldown <= 0 && Math.hypot(bt.x - this.heroX, bt.z - this.heroZ) < 2.6) {
        bt.cooldown = 18;
        this.state.berries += 4;
        this.audio.playSfx('berry');
        this.onToast('🍌 Shook the Peanut-Butter Berry Tree (+4 Berries)!');
        return;
      }
    }

    // 5. Fallback: engage nearest wild Monkemon if right beside one
    const nearWild = this._findNearestWild(3.5);
    if (nearWild) {
      this.engageNearestWildBattle();
    }
  }

  _updateOverworldThrow(dt) {
    const th = this.overworldThrow;
    if (!th) return;
    th.t += dt;

    if (th.phase === 'fly') {
      const dur = 0.44;
      const u = Math.min(1, th.t / dur);
      const x = th.startX + (th.targetX - th.startX) * u;
      const z = th.startZ + (th.targetZ - th.startZ) * u;
      const y = 1.0 * (1 - u) + Math.sin(u * Math.PI) * 2.9 + 0.25;
      th.ballActor.root.position.set(x, 0, z);
      th.ballActor.animRoot.position.y = y;
      th.ballActor.animRoot.rotation.x += dt * 13;
      this.renderer.setCameraFraming(th.targetX, 0.7, th.targetZ, 'catch', false);

      if (u >= 1) {
        th.phase = 'wiggle';
        th.t = 0;
        this.audio.playSfx('ball_bounce');
        th.target.actor.root.visible = false;
      }
      return;
    }

    if (th.phase === 'wiggle') {
      th.ballActor.animRoot.position.y = 0.12;
      th.ballActor.animRoot.rotation.x = 0;
      th.ballActor.animRoot.rotation.z = Math.sin(th.t * 16) * 0.34 * Math.exp(-th.t * 2.4);
      if (th.t >= 0.62) {
        th.t = 0;
        th.wigglesDone += 1;
        if (th.wigglesDone <= th.wigglesTotal) {
          this.audio.playSfx('ball_wiggle');
        } else if (th.caught) {
          this.audio.playSfx('catch_fanfare');
          const mon = createMonkemonInstance(th.target.speciesId, th.target.level, {
            isAlpha: Boolean(th.target.isAlpha),
            caughtZone: this.state.zoneId,
          });
          const slotInfo = addCaughtMonToState(this.state, mon);
          for (const pm of this.state.party) {
            if (pm.hp > 0) grantExpToMon(pm, 18 + mon.level * 7);
          }
          const p = this.renderer.projectToScreen(new THREE.Vector3(th.targetX, 1.5, th.targetZ));
          if (p.visible && this.onFloatText) {
            this.onFloatText(p.x, p.y, `GOTCHA! ${mon.nickname} Caught! ★`, '#fbbf24');
          }
          this.onToast(
            slotInfo.inParty
              ? `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Added to Party Slot #${slotInfo.slot + 1}!`
              : `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Sent to Sanctuary Storage!`,
          );
          const wasFinalBoss = Boolean(th.target.isFinalBoss);
          this.removeWildEntity(th.target);
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(this.heroX, 0.7, this.heroZ, 'overworld', false);
          if (wasFinalBoss && this.onApexVictory) {
            setTimeout(() => this.onApexVictory(mon), 900);
          }
        } else {
          this.audio.playSfx('break_free');
          th.target.actor.root.visible = true;
          th.target.beingCaught = false;
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(this.heroX, 0.7, this.heroZ, 'overworld', false);
          this.onToast(
            `${th.target.species.name} popped out! Toss a [X] Berry or press [RB] to battle & weaken it!`,
          );
        }
      }
    }
  }

  update(dt, input) {
    if (!this.zone || !this.diorama) return;
    this.time += dt;
    this.gateCooldown = Math.max(0, this.gateCooldown - dt);
    this.diorama.update(this.time, dt);
    this.refreshPartnerActor();

    // Update Shrinking Timing Ring if aiming
    if (this.aimRing) {
      this.aimRing.radiusNorm -= dt * 0.92;
      if (this.aimRing.radiusNorm < 0.2) this.aimRing.radiusNorm = 1.0;
      const tPos = this.aimRing.target;
      this.aimRing.group.position.set(tPos.x, 0.9, tPos.z);
      this.aimRing.group.lookAt(this.renderer.camera.position);
      this.aimRing.inner.scale.setScalar(this.aimRing.radiusNorm);
      const grade = gradeTimingRing(this.aimRing.radiusNorm);
      this.aimRing.inner.material.color.set(grade.color);

      if (input.pressed.btnY || input.pressed.btnLB || input.pressed.btnA || input.released.btnY) {
        this.startOrReleaseAimRing();
        return;
      }
      if (input.pressed.back || input.pressed.btnB) {
        this.entitiesGroup.remove(this.aimRing.group);
        this.aimRing = null;
      }
    } else {
      if (input.pressed.btnY) this.startOrReleaseAimRing();
      if (input.pressed.btnLB) this.quickThrowMonkeball();
      if (input.pressed.btnX) this.tossBerryAtNearestWild();
      if (input.pressed.btnRB) this.engageNearestWildBattle();
      if (input.pressed.btnA) this.interact();
      if (input.pressed.btnLT && this.state.party.length > 1) {
        this.state.activeIndex = (this.state.activeIndex + 1) % this.state.party.length;
        this.audio.playSfx('menu');
        this.refreshPartnerActor();
        this.onToast(`Partner Monkemon: ${this.state.party[this.state.activeIndex].nickname}!`);
      }
    }

    if (this.overworldThrow) {
      this._updateOverworldThrow(dt);
      return;
    }

    // Hero 2.5D movement + Sprint ([B] / Shift)
    const sprinting = input.down.btnB;
    const speed = sprinting ? 9.2 : 6.4;
    const mx = input.moveX;
    const mz = input.moveZ;
    this.heroMoving = Math.hypot(mx, mz) > 0.08;

    if (this.heroMoving) {
      let nx = this.heroX + mx * speed * dt;
      let nz = this.heroZ + mz * speed * dt;
      const { halfW, halfD } = this.zone.bounds;
      nx = Math.max(-halfW + 1.1, Math.min(halfW - 1.1, nx));
      nz = Math.max(-halfD + 1.1, Math.min(halfD - 1.1, nz));

      // Smooth sliding circle collisions against Houses, Trees, Shrines
      for (const c of this.diorama.colliders) {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const d = Math.hypot(dx, dz);
        const minR = c.r + 0.55;
        if (d < minR && d > 0.001) {
          nx = c.x + (dx / d) * minR;
          nz = c.z + (dz / d) * minR;
        }
      }

      this.heroX = nx;
      this.heroZ = nz;
      this.heroYaw = Math.atan2(mx, mz);
      this.state.pos = { x: this.heroX, z: this.heroZ };
    }

    // Expressive 3D leg-stride / arm-swing walk & sprint rig on Hero!
    if (this.heroActor) {
      this.heroActor.root.position.set(this.heroX, 0, this.heroZ);
      if (this.heroActor.updateMotion) {
        this.heroActor.updateMotion(dt, {
          targetYaw: this.heroYaw,
          moveSpeed: this.heroMoving ? speed : 0,
        });
      }
    }
    if (this.diorama && this.diorama.setHeroPosition) {
      this.diorama.setHeroPosition(this.heroX, this.heroZ);
    }

    // Following Partner Monkemon AI with animated stride!
    if (this.partnerActor) {
      const targetPx = this.heroX - Math.sin(this.heroYaw) * 1.45;
      const targetPz = this.heroZ - Math.cos(this.heroYaw) * 1.45;
      const pdx = targetPx - this.partnerX;
      const pdz = targetPz - this.partnerZ;
      const pDist = Math.hypot(pdx, pdz);
      let pMoveSpd = 0;
      if (pDist > 0.25) {
        pMoveSpd = sprinting ? 9.8 : 7.0;
        const step = Math.min(pDist, pMoveSpd * dt);
        this.partnerX += (pdx / pDist) * step;
        this.partnerZ += (pdz / pDist) * step;
        this.partnerYaw = Math.atan2(pdx, pdz);
      }
      this.partnerActor.root.position.set(this.partnerX, 0, this.partnerZ);
      if (this.partnerActor.updateMotion) {
        this.partnerActor.updateMotion(dt, {
          targetYaw: this.partnerYaw,
          moveSpeed: pDist > 0.3 ? pMoveSpd : 0,
        });
      }
    }

    // Animate Trainers (turn toward Alex & wave/cheer gently when nearby!)
    for (const tr of this.trainerEntities) {
      const distTr = Math.hypot(tr.x - this.heroX, tr.z - this.heroZ);
      const faceYaw = distTr < 5.5 ? Math.atan2(this.heroX - tr.x, this.heroZ - tr.z) : tr.yaw;
      if (tr.actor && tr.actor.updateMotion) {
        tr.actor.updateMotion(dt, {
          targetYaw: faceYaw,
          moveSpeed: 0,
          cheer: distTr < 3.6 && !this.state.defeatedTrainers.includes(tr.def.id) ? 0.5 : 0,
        });
      }
    }

    this.renderer.setCameraFraming(this.heroX, 0.7, this.heroZ, 'overworld', false);

    // Check Inter-Zone Gateways
    if (this.gateCooldown <= 0) {
      for (const gw of this.zone.gateways || []) {
        if (Math.hypot(gw.x - this.heroX, gw.z - this.heroZ) < 1.85) {
          this.audio.playSfx('confirm');
          this.loadZone(gw.toZone, { x: gw.spawnX, z: gw.spawnZ });
          return;
        }
      }
    }

    // Update Wild Roaming Monkemon + Touch-Encounter Check
    for (const w of this.wildEntities) {
      if (w.beingCaught) continue;
      w.wanderTimer -= dt;
      if (w.wanderTimer <= 0) {
        w.wanderTimer = 1.6 + Math.random() * 2.4;
        if (Math.random() < 0.55 && !w.isAlpha) {
          const ang = Math.random() * Math.PI * 2;
          w.vx = Math.sin(ang) * 1.65;
          w.vz = Math.cos(ang) * 1.65;
          w.yaw = ang;
        } else {
          w.vx = 0;
          w.vz = 0;
        }
      }
      const nextX = w.x + w.vx * dt;
      const nextZ = w.z + w.vz * dt;
      if (Math.hypot(nextX - w.homeX, nextZ - w.homeZ) < 3.6) {
        w.x = nextX;
        w.z = nextZ;
      } else {
        w.vx *= -0.6;
        w.vz *= -0.6;
        if (Math.hypot(w.vx, w.vz) > 0.1) w.yaw = Math.atan2(w.vx, w.vz);
      }
      w.actor.root.position.set(w.x, 0, w.z);
      if (w.actor.updateMotion) {
        const wSpd = Math.hypot(w.vx, w.vz);
        w.actor.updateMotion(dt, {
          targetYaw: w.yaw,
          moveSpeed: wSpd > 0.15 ? wSpd * 2.4 : 0,
          inBattle: Boolean(w.isAlpha),
        });
      }

      // Direct bump into wild Monkemon launches real-time arena battle!
      if (this.gateCooldown <= 0 && Math.hypot(w.x - this.heroX, w.z - this.heroZ) < (w.isAlpha ? 1.75 : 1.15)) {
        markDexSeen(this.state, w.speciesId);
        if (w.voiceKey) {
          this.audio.playVoice(w.voiceKey, {
            speaker: w.species.name.toUpperCase(),
            line: w.introLine || '',
          });
        }
        this.onStartWildBattle(w, { x: (this.heroX + w.x) * 0.5, z: (this.heroZ + w.z) * 0.5 });
        return;
      }
    }

    // Update Context Prompt Banner (`this.promptText`)
    this.promptText = this._computeContextPrompt();
  }

  _computeContextPrompt() {
    if (this.aimRing) {
      return '🎯 TIMING RING: Press [Y] / [A] when the glowing ring shrinks to GOLD for EXCELLENT Catch!';
    }
    for (const h of this.diorama.houseInteractables) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.1) {
        return `🏠 [A / Space] Visit ${h.label} — Full Heal & Restock Monkeballs`;
      }
    }
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.4) {
        return `⚔️ [A / Space] Challenge ${tr.def.name} (${tr.def.role})`;
      }
    }
    for (const sh of this.diorama.shrineInteractables) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.8) {
        return '✨ [A / Space] Pray at Golden Banana Shrine (Full Heal + Berries)';
      }
    }
    for (const bt of this.diorama.berryInteractables) {
      if (bt.cooldown <= 0 && Math.hypot(bt.x - this.heroX, bt.z - this.heroZ) < 2.6) {
        return '🍌 [A / Space] Shake Peanut-Butter Berry Tree (+4 Berries)';
      }
    }
    const nearW = this._findNearestWild(7.5);
    if (nearW) {
      return `🐒 ${nearW.species.name} Lv.${nearW.level}: [Y / F] Aim Monkeball · [X / E] Berry · [RB / L] Arena Battle`;
    }
    return '';
  }
}
