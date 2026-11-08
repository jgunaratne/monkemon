// 2.5D Overworld Exploration, Walkable Cutaway House Interiors, Organic Coastlines,
// Elevated Terraces & Bridges, Supply Chests & 3D Monkeball Pickups, Partner Follower,
// Wild Roaming Monkemon, Timing-Ring Field Catching & Turn-Based Battle Triggers!

import * as THREE from 'three';
import { ELEMENTS } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import { ZONES } from '../data/zones.js';
import { buildZoneDiorama } from '../engine/diorama_builder.js';
import { buildHouseInteriorDiorama } from '../engine/interior_builder.js';
import { makeLabelSprite } from '../engine/model_loader.js';
import {
  computeCatchProbability,
  createMonkemonInstance,
  gradeTimingRing,
  grantExpToMon,
} from './combat_math.js';
import {
  addCaughtMonToState,
  claimChestReward,
  healAllParty,
  markDexSeen,
} from './save_store.js';

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
    onOpenShop,
    onOpenPartyBox,
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
    this.onOpenShop = onOpenShop;
    this.onOpenPartyBox = onOpenPartyBox;

    this.zone = null;
    this.diorama = null; // active diorama (outdoor or interior)
    this.outdoorDiorama = null;
    this.interiorDiorama = null;
    this.activeHouse = null;
    this.outdoorReturnPos = null;

    this.entitiesGroup = new THREE.Group();
    this.sceneRoot.add(this.entitiesGroup);

    this.heroActor = null;
    this.partnerActor = null;
    this.partnerSpeciesId = null;

    this.heroX = -6.5;
    this.heroY = 0;
    this.heroZ = 8.2;
    this.heroYaw = 0;
    this.heroMoving = false;
    this.partnerX = -7.8;
    this.partnerY = 0;
    this.partnerZ = 9.2;
    this.partnerYaw = 0;

    this.wildEntities = [];
    this.trainerEntities = [];
    this.aimRing = null;
    this.overworldThrow = null;
    this.promptText = '';
    this.time = 0;
    this.gateCooldown = 0;
    this.doorCooldown = 0;
  }

  get isInsideHouse() {
    return Boolean(this.interiorDiorama && this.activeHouse);
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
    this.partnerY = this.diorama ? this.diorama.getHeightAt(this.partnerX, this.partnerZ) : 0;
    this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    this.entitiesGroup.add(this.partnerActor.root);
  }

  loadZone(zoneId, spawnOverride = null) {
    const zone = ZONES[zoneId] || ZONES.sunpalm;
    this.zone = zone;
    this.state.zoneId = zone.id;

    if (this.interiorDiorama) {
      this.sceneRoot.remove(this.interiorDiorama.group);
      this.interiorDiorama = null;
      this.activeHouse = null;
      this.outdoorReturnPos = null;
    }
    if (this.outdoorDiorama) {
      this.sceneRoot.remove(this.outdoorDiorama.group);
    }
    this._clearZoneEntities();

    this.outdoorDiorama = buildZoneDiorama(zone, this.modelBank, this.state);
    this.diorama = this.outdoorDiorama;
    this.sceneRoot.add(this.outdoorDiorama.group);
    this.renderer.setZoneAtmosphere(zone);

    let sx = spawnOverride ? spawnOverride.x : zone.playerSpawn.x;
    let sz = spawnOverride ? spawnOverride.z : zone.playerSpawn.z;
    if (this.diorama.clampToCoast) {
      const clamped = this.diorama.clampToCoast(sx, sz, 1.3);
      sx = clamped.x;
      sz = clamped.z;
    }
    this.heroX = sx;
    this.heroZ = sz;
    this.heroY = this.diorama.getHeightAt(sx, sz);
    this.partnerX = sx - 1.3;
    this.partnerZ = sz + 1.0;
    this.partnerY = this.diorama.getHeightAt(this.partnerX, this.partnerZ);
    this.state.pos = { x: sx, z: sz };
    this.gateCooldown = 0.85;
    this.doorCooldown = 0.75;

    if (!this.heroActor) this.initHeroActors();
    this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    if (this.partnerActor) {
      this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    }

    this._spawnZoneTrainers(zone);
    this._spawnZoneWildMonkemon(zone);

    this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', true);
    this.audio.playMusic(zone.music || 'sunpalm', true);

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

  enterHouseById(houseId) {
    if (!this.zone || !this.outdoorDiorama) return false;
    const found =
      this.outdoorDiorama.houseInteractables.find((h) => h.id === houseId) ||
      (this.zone.houses || []).find((h) => h.id === houseId);
    if (!found) return false;
    this.enterHouse(found);
    return true;
  }

  enterHouse(houseDef) {
    if (!houseDef || !this.zone || this.interiorDiorama) return;
    this.audio.playSfx('door_open');

    const doorX = houseDef.doorX !== undefined ? houseDef.doorX : houseDef.x;
    const doorZ = houseDef.doorZ !== undefined ? houseDef.doorZ : houseDef.z + (houseDef.scale || 4.4) * 0.56;
    this.outdoorReturnPos = { x: doorX, z: doorZ + 1.2 };

    // Hide outdoor island + outdoor wilds/trainers cleanly while inside cutaway interior!
    if (this.outdoorDiorama) this.outdoorDiorama.group.visible = false;
    for (const w of this.wildEntities) w.actor.root.visible = false;
    for (const tr of this.trainerEntities) tr.actor.root.visible = false;
    if (this.aimRing) {
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
    }

    this.activeHouse = houseDef;
    this.interiorDiorama = buildHouseInteriorDiorama(houseDef, this.zone, this.modelBank);
    this.diorama = this.interiorDiorama;
    this.sceneRoot.add(this.interiorDiorama.group);
    this.renderer.setZoneAtmosphere({
      skyColor: this.interiorDiorama.skyColor,
      fogColor: this.interiorDiorama.fogColor,
    });

    this.heroX = this.interiorDiorama.entrySpawn.x;
    this.heroZ = this.interiorDiorama.entrySpawn.z;
    this.heroY = 0;
    this.heroYaw = Math.PI; // face north into the room!
    this.partnerX = this.heroX - 1.2;
    this.partnerZ = this.heroZ + 0.65;
    this.partnerY = 0;
    this.doorCooldown = 0.85;

    if (this.heroActor) this.heroActor.root.position.set(this.heroX, 0, this.heroZ);
    if (this.partnerActor) this.partnerActor.root.position.set(this.partnerX, 0, this.partnerZ);
    this.renderer.setCameraFraming(0, 0.9, 0.5, 'interior', true);

    // Auto-heal & top up Monkeballs when entering Sanctuary / Home if low!
    if (houseDef.healsParty) {
      healAllParty(this.state);
      if (houseDef.restockBalls && this.state.monkeballs < 18) {
        this.state.monkeballs = Math.min(30, this.state.monkeballs + houseDef.restockBalls);
      } else if (this.state.monkeballs < 10) {
        this.state.monkeballs = 12;
      }
    }

    this.onToast(`🏠 Entered ${houseDef.label}! Explore inside or step onto the South Mat to exit.`);
    if (this.onZoneChanged) this.onZoneChanged(this.zone);
  }

  exitHouse() {
    if (!this.interiorDiorama) return;
    this.audio.playSfx('door_open');
    const prevLabel = this.activeHouse ? this.activeHouse.label : 'House';

    this.sceneRoot.remove(this.interiorDiorama.group);
    this.interiorDiorama = null;
    this.activeHouse = null;

    this.diorama = this.outdoorDiorama;
    if (this.outdoorDiorama) this.outdoorDiorama.group.visible = true;
    for (const w of this.wildEntities) w.actor.root.visible = true;
    for (const tr of this.trainerEntities) tr.actor.root.visible = true;
    this.renderer.setZoneAtmosphere(this.zone);

    const ret = this.outdoorReturnPos || this.zone.playerSpawn;
    this.heroX = ret.x;
    this.heroZ = ret.z;
    this.heroY = this.diorama ? this.diorama.getHeightAt(this.heroX, this.heroZ) : 0;
    this.heroYaw = 0;
    this.partnerX = this.heroX - 1.3;
    this.partnerZ = this.heroZ + 0.9;
    this.partnerY = this.diorama ? this.diorama.getHeightAt(this.partnerX, this.partnerZ) : 0;
    this.state.pos = { x: this.heroX, z: this.heroZ };
    this.doorCooldown = 0.9;

    if (this.heroActor) this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    if (this.partnerActor) this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', true);
    this.onToast(`🌤️ Stepped back out from ${prevLabel} into ${this.zone.name}.`);
    if (this.onZoneChanged) this.onZoneChanged(this.zone);
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
    const wy = this.outdoorDiorama ? this.outdoorDiorama.getHeightAt(cfg.homeX, cfg.homeZ) : 0;

    const actor = this.modelBank.spawnActor({
      glbUrl: sp.glb,
      scale,
      primaryColor: sp.palette.primary,
      secondaryColor: sp.palette.secondary,
      shadowRadius: cfg.isAlpha ? 1.15 : 0.55,
      animateRig: true,
    });
    actor.root.position.set(cfg.homeX, wy, cfg.homeZ);

    const isCaughtSpecies = (this.state.caughtDex || []).includes(sp.id);
    const label = makeLabelSprite({
      title: `${cfg.isAlpha ? '👑 ' : ''}${sp.name} Lv.${cfg.level}${isCaughtSpecies ? ' 🐵' : ''}`,
      subtitle: cfg.isFinalBoss
        ? 'BOSS #20 · [A] Battle / [F/(Y)] Ball'
        : cfg.isAlpha
          ? 'GUARDIAN #19 · [A] Battle'
          : '[A] Battle · [F/(Y)] Throw Ball',
      badgeText: `${elemMeta.icon} ${elemMeta.label}`,
      badgeColor: elemMeta.color,
      borderColor: cfg.isAlpha ? '#facc15' : '#cbd5e1',
      widthWorld: cfg.isAlpha ? 4.35 : 3.25,
    });
    label.position.set(0, scale + 0.88, 0);
    actor.root.add(label);

    this.entitiesGroup.add(actor.root);

    const ent = {
      ...cfg,
      species: sp,
      actor,
      label,
      x: cfg.homeX,
      y: wy,
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
      const ty = this.outdoorDiorama ? this.outdoorDiorama.getHeightAt(tr.x, tr.z) : 0;
      const actor = this.modelBank.spawnActor({
        glbUrl: glb,
        scale: tr.isWarden ? 1.85 : 1.62,
        primaryColor: tr.isWarden ? '#f59e0b' : '#fb7185',
        secondaryColor: '#fef3c7',
        shadowRadius: 0.62,
        animateRig: true,
      });
      actor.root.position.set(tr.x, ty, tr.z);
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
        y: ty,
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

  pushNearbyWildsAway(minDist = 3.2) {
    if (!this.zone || this.isInsideHouse) return;
    for (const w of this.wildEntities) {
      if (w.isFinalBoss) continue;
      const dx = w.x - this.heroX;
      const dz = w.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (d < minDist) {
        const ang = d > 0.01 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
        let nx = this.heroX + Math.sin(ang) * (minDist + 0.6);
        let nz = this.heroZ + Math.cos(ang) * (minDist + 0.6);
        if (this.outdoorDiorama && this.outdoorDiorama.clampToCoast) {
          const cl = this.outdoorDiorama.clampToCoast(nx, nz, 1.6);
          nx = cl.x;
          nz = cl.z;
        }
        w.x = nx;
        w.z = nz;
        w.y = this.outdoorDiorama ? this.outdoorDiorama.getHeightAt(w.x, w.z) : 0;
        w.vx = 0;
        w.vz = 0;
        w.actor.root.position.set(w.x, w.y, w.z);
      }
    }
  }

  _findNearestWild(maxDist = 9.0) {
    if (this.isInsideHouse) return null;
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
    if (this.isInsideHouse || this.overworldThrow) return;
    if (this.aimRing) {
      const target = this.aimRing.target;
      const rNorm = this.aimRing.radiusNorm;
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
      this.throwOverworldMonkeball(target, rNorm);
      return;
    }

    const target = this._findNearestWild(9.8);
    if (!target) {
      this.onToast('Step closer to a wild Monkemon to aim & throw a Monkeball!');
      return;
    }
    if ((this.state.monkeballs || 0) <= 0 && (this.state.superBalls || 0) <= 0) {
      this.onToast('Out of Monkeballs! Collect glowing Monkeballs, open Supply Chests, or enter any House!');
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
    g.position.set(target.x, (target.y || 0) + 0.9, target.z);
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

  quickThrowMonkeball() {
    if (this.isInsideHouse) return;
    if (this.aimRing) {
      this.startOrReleaseAimRing();
      return;
    }
    const target = this._findNearestWild(9.8);
    if (!target) {
      this.onToast('Step near a wild Monkemon to throw a smiling Monkeball!');
      return;
    }
    this.throwOverworldMonkeball(target, 0.52);
  }

  throwOverworldMonkeball(target, radiusNorm = 0.55) {
    if (!target || this.overworldThrow) return;
    const useSuper = (this.state.monkeballs || 0) <= 0 && (this.state.superBalls || 0) > 0;
    if ((this.state.monkeballs || 0) <= 0 && !useSuper) {
      this.onToast('No Monkeballs left! Pick up glowing Monkeballs, open Supply Chests, or enter a House!');
      return;
    }
    if (useSuper) {
      this.state.superBalls -= 1;
    } else {
      this.state.monkeballs -= 1;
    }
    markDexSeen(this.state, target.speciesId);

    const ringGrade = gradeTimingRing(radiusNorm);
    const ballMult = useSuper ? 1.85 : 1.0;
    const prob = computeCatchProbability({
      species: target.species,
      currentHp: target.hpFrac * 100,
      maxHp: 100,
      ringMult: ringGrade.mult * ballMult,
      berryFed: target.berryFed,
      badgesCount: this.state.badges.length,
    });
    const caught = Math.random() < prob;

    this.audio.playSfx('throw_ball');
    target.beingCaught = true;

    const pScreen = this.renderer.projectToScreen(new THREE.Vector3(target.x, (target.y || 0) + 1.8, target.z));
    if (pScreen.visible && this.onFloatText) {
      this.onFloatText(
        pScreen.x,
        pScreen.y,
        `${useSuper ? '🌟 SUPER · ' : ''}${ringGrade.grade} (${Math.round(prob * 100)}%)`,
        ringGrade.color,
      );
    }

    const ballActor = this.modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.72,
      primaryColor: useSuper ? '#facc15' : '#ef4444',
      secondaryColor: '#fef3c7',
      shadowRadius: 0.35,
    });
    ballActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    this.entitiesGroup.add(ballActor.root);

    this.overworldThrow = {
      target,
      ballActor,
      startX: this.heroX,
      startY: this.heroY,
      startZ: this.heroZ,
      targetX: target.x,
      targetY: target.y || 0,
      targetZ: target.z,
      phase: 'fly',
      t: 0,
      wigglesDone: 0,
      wigglesTotal: caught ? 3 : 1 + Math.floor(Math.random() * 2),
      caught,
    };
  }

  tossBerryAtNearestWild() {
    if (this.isInsideHouse) return;
    const target = this._findNearestWild(9.0);
    if (!target) {
      this.onToast('Move near a wild Monkemon to toss a Sweet Berry (+42% Catch Rate)!');
      return;
    }
    if (target.berryFed) {
      this.onToast(`${target.species.name} is already happily munching a Berry (+42% Catch)!`);
      return;
    }
    if (this.state.berries <= 0) {
      this.onToast('Out of Berries! Shake any Berry Bush with [Enter / (A)] or open Supply Chests!');
      return;
    }
    this.state.berries -= 1;
    target.berryFed = true;
    this.audio.playSfx('berry');
    const p = this.renderer.projectToScreen(new THREE.Vector3(target.x, (target.y || 0) + 1.8, target.z));
    if (p.visible && this.onFloatText) {
      this.onFloatText(p.x, p.y, '🍌 BERRY FED! Catch Rate +42% ↑', '#4ade80');
    }
  }

  engageNearestWildBattle() {
    if (this.isInsideHouse) return;
    const target = this._findNearestWild(8.5);
    if (!target) {
      this.onToast('Approach a wild Monkemon or Trainer to start a Turn-Based Battle!');
      return;
    }
    markDexSeen(this.state, target.speciesId);
    if (target.voiceKey) {
      this.audio.playVoice(target.voiceKey, {
        speaker: target.species.name.toUpperCase(),
        line: target.introLine || '',
      });
    }
    const cx = (this.heroX + target.x) * 0.5;
    const cz = (this.heroZ + target.z) * 0.5;
    const cy = this.diorama ? this.diorama.getHeightAt(cx, cz) : 0;
    this.onStartWildBattle(target, { x: cx, y: cy, z: cz });
  }

  interact() {
    if (!this.diorama) return;

    // A. Inside Cutaway House Interior!
    if (this.isInsideHouse) {
      const ez = this.interiorDiorama.exitZone;
      if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r + 0.9) {
        this.exitHouse();
        return;
      }

      for (const st of this.interiorDiorama.stations || []) {
        if (Math.hypot(st.x - this.heroX, st.z - this.heroZ) <= (st.r || 2.3)) {
          if (st.kind === 'heal' || st.kind === 'mom') {
            healAllParty(this.state);
            if (st.kind === 'mom') {
              this.state.berries = Math.min(40, (this.state.berries || 0) + 4);
              if (st.voiceKey) {
                this.audio.playVoice(st.voiceKey, { speaker: "ALEX'S MOM", line: st.voiceLine || '' });
              }
              this.onToast('🧁 Mom served warm Peanut-Butter Toast! Full Party HP healed & +4 Berries!');
            } else {
              if ((this.state.monkeballs || 0) < 15) this.state.monkeballs = 15;
              this.onToast('💚 Healing Station: 100% Party HP restored & Monkeballs topped up!');
            }
            this.audio.playSfx('heal');
            return;
          }
          if (st.kind === 'prof') {
            healAllParty(this.state);
            this.state.monkeballs = (this.state.monkeballs || 0) + 8;
            this.state.superBalls = (this.state.superBalls || 0) + 1;
            this.audio.playSfx('heal');
            if (st.voiceKey) {
              this.audio.playVoice(st.voiceKey, { speaker: 'PROF. MACAQUE', line: st.voiceLine || '' });
            }
            this.onToast('🔬 Prof. Macaque gifted you +8 Monkeballs & +1 Golden Super Ball!');
            return;
          }
          if (st.kind === 'shop') {
            this.audio.playSfx('confirm');
            if (this.onOpenShop) this.onOpenShop();
            return;
          }
          if (st.kind === 'pc') {
            this.audio.playSfx('confirm');
            if (this.onOpenPartyBox) this.onOpenPartyBox();
            return;
          }
          if (st.kind === 'lore') {
            this.audio.playSfx('confirm');
            this.onToast(st.loreText || 'Explore every island for hidden Supply Chests & rare Monkemon!');
            return;
          }
          if (st.kind === 'trainer' && st.trainerDef) {
            this.audio.playSfx('trainer_spot');
            if (st.trainerDef.voiceKey) {
              this.audio.playVoice(st.trainerDef.voiceKey, {
                speaker: st.trainerDef.name,
                line: st.trainerDef.introLine || '',
              });
            }
            this.onStartTrainerBattle(st.trainerDef, { x: 0, y: 0, z: 0.4 });
            return;
          }
        }
      }
      return;
    }

    // B. Outdoors on the Island!
    // 1. Enter House Doorstep
    for (const h of this.diorama.houseInteractables || []) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.2) {
        this.enterHouse(h);
        return;
      }
    }

    // 2. Open Supply Chests (`env_treasure_chest.glb`)!
    for (const ch of this.diorama.chestInteractables || []) {
      if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.8) {
        const res = claimChestReward(this.state, ch);
        if (res.ok) {
          ch.opened = true;
          ch.glowRing.material.color.set('#64748b');
          ch.glowRing.material.opacity = 0.25;
          ch.sign.visible = false;
          this.audio.playSfx('chest_open');
          const p = this.renderer.projectToScreen(new THREE.Vector3(ch.x, (ch.y || 0) + 1.8, ch.z));
          if (p.visible && this.onFloatText) {
            this.onFloatText(p.x, p.y, `🎁 ${res.summary}!`, '#fde047');
          }
          this.onToast(`🎁 Opened ${ch.label || 'Supply Chest'}: ${res.summary}!`);
          return;
        }
      }
    }

    // 3. Challenge Outdoor Trainers
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.5) {
        this.audio.playSfx('trainer_spot');
        if (tr.def.voiceKey) {
          this.audio.playVoice(tr.def.voiceKey, {
            speaker: tr.def.name,
            line: tr.def.introLine || '',
          });
        }
        const cx = (this.heroX + tr.x) * 0.5;
        const cz = (this.heroZ + tr.z) * 0.5;
        const cy = this.diorama.getHeightAt(cx, cz);
        this.onStartTrainerBattle(tr.def, { x: cx, y: cy, z: cz });
        return;
      }
    }

    // 4. Golden Banana Shrines
    for (const sh of this.diorama.shrineInteractables || []) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.9) {
        healAllParty(this.state);
        this.state.berries = Math.min(40, (this.state.berries || 0) + 3);
        this.audio.playSfx('heal');
        this.onToast('✨ Golden Banana Shrine blessed your squad (100% HP & +3 Berries)!');
        return;
      }
    }

    // 5. Shakeable Berry Bushes
    for (const bt of this.diorama.berryInteractables || []) {
      if (bt.cooldown <= 0 && Math.hypot(bt.x - this.heroX, bt.z - this.heroZ) < 2.7) {
        bt.cooldown = 18;
        this.state.berries = (this.state.berries || 0) + 4;
        this.audio.playSfx('berry');
        this.onToast('🍌 Shook the Berry Bush (+4 Sweet Berries)!');
        return;
      }
    }

    // 6. Engage nearby Wild Monkemon in Turn-Based Battle!
    const nearWild = this._findNearestWild(4.2);
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
      const baseY = th.startY * (1 - u) + th.targetY * u;
      const arcY = 0.9 * (1 - u) + Math.sin(u * Math.PI) * 2.9 + 0.25;
      th.ballActor.root.position.set(x, baseY, z);
      th.ballActor.animRoot.position.y = arcY;
      th.ballActor.animRoot.rotation.x += dt * 13;
      this.renderer.setCameraFraming(th.targetX, th.targetY + 0.7, th.targetZ, 'catch', false);

      if (u >= 1) {
        th.phase = 'wiggle';
        th.t = 0;
        this.audio.playSfx('ball_bounce');
        th.target.actor.root.visible = false;
      }
      return;
    }

    if (th.phase === 'wiggle') {
      th.ballActor.animRoot.position.y = 0.14;
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
          const p = this.renderer.projectToScreen(
            new THREE.Vector3(th.targetX, th.targetY + 1.5, th.targetZ),
          );
          if (p.visible && this.onFloatText) {
            this.onFloatText(p.x, p.y, `GOTCHA! ${mon.nickname} Caught! ★`, '#fbbf24');
          }
          this.onToast(
            slotInfo.inParty
              ? `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Added to Squad Slot #${slotInfo.slot + 1} (View in ☰ MENU)!`
              : `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Sent to Sanctuary Box (View in ☰ MENU → My Monkemon)!`,
          );
          const wasFinalBoss = Boolean(th.target.isFinalBoss);
          this.removeWildEntity(th.target);
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', false);
          if (wasFinalBoss && this.onApexVictory) {
            setTimeout(() => this.onApexVictory(mon), 900);
          }
        } else {
          this.audio.playSfx('break_free');
          th.target.actor.root.visible = true;
          th.target.beingCaught = false;
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', false);
          this.onToast(
            `${th.target.species.name} broke free! Toss a [E/(X)] Berry or press [Enter/(A)] to weaken it in Battle!`,
          );
        }
      }
    }
  }

  update(dt, input) {
    if (!this.zone || !this.diorama) return;
    this.time += dt;
    this.gateCooldown = Math.max(0, this.gateCooldown - dt);
    this.doorCooldown = Math.max(0, this.doorCooldown - dt);
    this.diorama.update(this.time, dt);
    this.refreshPartnerActor();

    // Update Shrinking Timing Ring if aiming
    if (this.aimRing) {
      this.aimRing.radiusNorm -= dt * 0.92;
      if (this.aimRing.radiusNorm < 0.2) this.aimRing.radiusNorm = 1.0;
      const tPos = this.aimRing.target;
      this.aimRing.group.position.set(tPos.x, (tPos.y || 0) + 0.9, tPos.z);
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
        this.onToast(`Lead Partner: ${this.state.party[this.state.activeIndex].nickname}!`);
      }
    }

    if (this.overworldThrow) {
      this._updateOverworldThrow(dt);
      return;
    }

    // Hero 2.5D movement + Sprint ([Shift] / [B])
    const sprinting = input.down.btnB;
    const speed = sprinting ? 9.2 : 6.4;
    const mx = input.moveX;
    const mz = input.moveZ;
    this.heroMoving = Math.hypot(mx, mz) > 0.08;

    if (this.heroMoving) {
      let nx = this.heroX + mx * speed * dt;
      let nz = this.heroZ + mz * speed * dt;

      if (this.isInsideHouse) {
        const { halfW, halfD } = this.interiorDiorama.bounds;
        nx = Math.max(-halfW, Math.min(halfW, nx));
        nz = Math.max(-halfD, Math.min(halfD + 0.55, nz));
      } else if (this.diorama.clampToCoast) {
        const cl = this.diorama.clampToCoast(nx, nz, 1.15);
        nx = cl.x;
        nz = cl.z;
      } else {
        const { halfW, halfD } = this.zone.bounds;
        nx = Math.max(-halfW + 1.1, Math.min(halfW - 1.1, nx));
        nz = Math.max(-halfD + 1.1, Math.min(halfD - 1.1, nz));
      }

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
      this.heroY = this.diorama.getHeightAt(this.heroX, this.heroZ);
      this.heroYaw = Math.atan2(mx, mz);
      if (!this.isInsideHouse) {
        this.state.pos = { x: this.heroX, z: this.heroZ };
      }
    } else {
      this.heroY = this.diorama.getHeightAt(this.heroX, this.heroZ);
    }

    if (this.heroActor) {
      this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
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

    // Following Partner Monkemon AI
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
      this.partnerY = this.diorama.getHeightAt(this.partnerX, this.partnerZ);
      this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
      if (this.partnerActor.updateMotion) {
        this.partnerActor.updateMotion(dt, {
          targetYaw: this.partnerYaw,
          moveSpeed: pDist > 0.3 ? pMoveSpd : 0,
        });
      }
    }

    // Check House Walk-In / Walk-Out Doormats!
    if (this.isInsideHouse) {
      this.renderer.setCameraFraming(this.heroX * 0.25, 0.9, 0.5, 'interior', false);
      if (this.doorCooldown <= 0 && this.heroMoving && mz > 0.1) {
        const ez = this.interiorDiorama.exitZone;
        if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r) {
          this.exitHouse();
          return;
        }
      }
      this.promptText = this._computeContextPrompt();
      return;
    }

    // Outdoors: Walk onto glowing House doorstep mat while walking North to enter seamlessly!
    if (this.doorCooldown <= 0 && this.heroMoving && mz < -0.1) {
      for (const h of this.diorama.houseInteractables || []) {
        if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 1.35) {
          this.enterHouse(h);
          return;
        }
      }
    }

    // Outdoors: Walk over glowing 3D Monkeball Pickups (`ballPickupInteractables`) to collect!
    for (const bp of this.diorama.ballPickupInteractables || []) {
      if (bp.collected) continue;
      if (Math.hypot(bp.x - this.heroX, bp.z - this.heroZ) < 1.55) {
        bp.collected = true;
        bp.holder.visible = false;
        if (!Array.isArray(this.state.pickedUpBalls)) this.state.pickedUpBalls = [];
        if (!this.state.pickedUpBalls.includes(bp.id)) this.state.pickedUpBalls.push(bp.id);

        const isSuper = bp.kind === 'superball';
        const amt = bp.count || (isSuper ? 1 : 3);
        if (isSuper) {
          this.state.superBalls = (this.state.superBalls || 0) + amt;
        } else {
          this.state.monkeballs = (this.state.monkeballs || 0) + amt;
        }
        this.audio.playSfx('confirm');
        const p = this.renderer.projectToScreen(new THREE.Vector3(bp.x, (bp.y || 0) + 1.5, bp.z));
        if (p.visible && this.onFloatText) {
          this.onFloatText(
            p.x,
            p.y,
            isSuper ? `🌟 +${amt} Golden Super Ball!` : `🐵 +${amt} Monkeballs!`,
            isSuper ? '#fde047' : '#4ade80',
          );
        }
        this.onToast(
          isSuper
            ? `🌟 Picked up +${amt} Golden Super Ball (Total: ${this.state.superBalls})!`
            : `🐵 Picked up +${amt} Smiling Monkeballs (Total: ${this.state.monkeballs})!`,
        );
      }
    }

    // Animate Outdoor Trainers
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

    this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', false);

    // Inter-Zone Peninsula Gateways
    if (this.gateCooldown <= 0) {
      for (const gw of this.zone.gateways || []) {
        if (Math.hypot(gw.x - this.heroX, gw.z - this.heroZ) < 1.95) {
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
        w.wanderTimer = 1.8 + Math.random() * 2.5;
        if (Math.random() < 0.52 && !w.isAlpha) {
          const ang = Math.random() * Math.PI * 2;
          w.vx = Math.sin(ang) * 1.45;
          w.vz = Math.cos(ang) * 1.45;
          w.yaw = ang;
        } else {
          w.vx = 0;
          w.vz = 0;
        }
      }
      const nextX = w.x + w.vx * dt;
      const nextZ = w.z + w.vz * dt;
      if (
        Math.hypot(nextX - w.homeX, nextZ - w.homeZ) < 3.6 &&
        (!this.diorama.isInsideCoast || this.diorama.isInsideCoast(nextX, nextZ, 1.8))
      ) {
        w.x = nextX;
        w.z = nextZ;
      } else {
        w.vx *= -0.6;
        w.vz *= -0.6;
        if (Math.hypot(w.vx, w.vz) > 0.1) w.yaw = Math.atan2(w.vx, w.vz);
      }
      w.y = this.diorama.getHeightAt(w.x, w.z);
      w.actor.root.position.set(w.x, w.y, w.z);
      if (w.actor.updateMotion) {
        const wSpd = Math.hypot(w.vx, w.vz);
        w.actor.updateMotion(dt, {
          targetYaw: w.yaw,
          moveSpeed: wSpd > 0.15 ? wSpd * 2.2 : 0,
          inBattle: Boolean(w.isAlpha),
        });
      }

      if (
        this.gateCooldown <= 0 &&
        Math.hypot(w.x - this.heroX, w.z - this.heroZ) < (w.isAlpha ? 1.75 : 1.15)
      ) {
        markDexSeen(this.state, w.speciesId);
        if (w.voiceKey) {
          this.audio.playVoice(w.voiceKey, {
            speaker: w.species.name.toUpperCase(),
            line: w.introLine || '',
          });
        }
        const cx = (this.heroX + w.x) * 0.5;
        const cz = (this.heroZ + w.z) * 0.5;
        const cy = this.diorama.getHeightAt(cx, cz);
        this.onStartWildBattle(w, { x: cx, y: cy, z: cz });
        return;
      }
    }

    this.promptText = this._computeContextPrompt();
  }

  _computeContextPrompt() {
    if (this.isInsideHouse) {
      for (const st of this.interiorDiorama.stations || []) {
        if (Math.hypot(st.x - this.heroX, st.z - this.heroZ) <= (st.r || 2.3)) {
          return st.prompt;
        }
      }
      const ez = this.interiorDiorama.exitZone;
      if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r + 0.9) {
        return `🚪 [Enter / (A)] or Walk South to Exit to ${this.zone.name}`;
      }
      return `🏠 Inside ${this.activeHouse.label} — Walk to Stations & press [Enter / Space / (A)]`;
    }

    if (this.aimRing) {
      return '🎯 TIMING RING: Press [F / Enter / (Y) / (A)] when the glowing ring shrinks to GOLD for EXCELLENT Catch!';
    }
    for (const h of this.diorama.houseInteractables || []) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.2) {
        return `🚪 Walk In or press [Enter / (A)] to Enter ${h.label}`;
      }
    }
    for (const ch of this.diorama.chestInteractables || []) {
      if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.8) {
        return `🎁 [Enter / Space / (A)] Open ${ch.label || 'Supply Chest'} (+${ch.balls || 5} Monkeballs & +${ch.superBalls || 1} Super Ball!)`;
      }
    }
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.5) {
        return `⚔️ [Enter / Space / (A)] Battle ${tr.def.name} (${tr.def.role})`;
      }
    }
    for (const sh of this.diorama.shrineInteractables || []) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.9) {
        return '✨ [Enter / Space / (A)] Pray at Golden Banana Shrine (100% Party Heal + Berries)';
      }
    }
    for (const bt of this.diorama.berryInteractables || []) {
      if (bt.cooldown <= 0 && Math.hypot(bt.x - this.heroX, bt.z - this.heroZ) < 2.7) {
        return '🍌 [Enter / Space / (A)] Shake Berry Bush (+4 Sweet Berries)';
      }
    }
    const nearW = this._findNearestWild(8.2);
    if (nearW) {
      return `🌿 Wild ${nearW.species.name} Lv.${nearW.level} — [Enter/(A)] Battle & Catch · [F/(Y)] Throw Monkeball (${this.state.monkeballs}) · [E/(X)] Berry`;
    }
    return '';
  }
}
