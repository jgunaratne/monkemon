// 2.5D Overworld & Map-Inspired Dungeon/Town/House Exploration Controller!
// Supports 10 Sky-Vine Realms, 36 bespoke walkable interior/town/dungeon layouts,
// Sub-Area Staircase & Portal Warps, Key-Artifact Gates, Oasis Heal Pads (`+`),
// Derby Turbo Boost Strips (`>`), Sky-Vine Pillars, 3D Chests, Partner Follower,
// Wild Roaming Monkemon (outdoors & inside dungeons!), Timing-Ring Catching & Turn-Based Battles!

import * as THREE from 'three';
import { INTERIOR_MAPS } from '../data/interior_maps.js';
import { ELEMENTS } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import { KEY_ITEMS_META, getGuestCompanion } from '../data/storyline.js';
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
  grantStoryProgress,
  healAllParty,
  markDexSeen,
  recruitSchoolClassmates,
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
    onOpenStoryScene,
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
    this.onOpenStoryScene = onOpenStoryScene || null;

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
    this.companionActor = null;
    this.companionId = null;

    this.heroX = 28.0;
    this.heroY = 0;
    this.heroZ = 31.5;
    this.heroYaw = 0;
    this.heroMoving = false;
    this.partnerX = 26.7;
    this.partnerY = 0;
    this.partnerZ = 32.5;
    this.partnerYaw = 0;
    this.companionX = 25.5;
    this.companionY = 0;
    this.companionZ = 33.5;
    this.companionYaw = 0;
    this.currentSubregion = null;
    this.quakeTimer = 3.5;

    this.wildEntities = [];
    this.interiorWildEntities = [];
    this.trainerEntities = [];
    this.aimRing = null;
    this.overworldThrow = null;
    this.promptText = '';
    this.time = 0;
    this.gateCooldown = 0;
    this.doorCooldown = 0;
    this.boostTimer = 0;
    this.healPadCooldown = 0;
  }

  get isInsideHouse() {
    return Boolean(this.interiorDiorama && this.activeHouse);
  }

  get activeWildEntities() {
    return this.isInsideHouse ? this.interiorWildEntities : this.wildEntities;
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
    this.refreshCompanionActor();
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

  refreshCompanionActor() {
    const guest = getGuestCompanion(this.state);
    if (!guest) {
      if (this.companionActor) {
        this.entitiesGroup.remove(this.companionActor.root);
        this.companionActor = null;
      }
      this.companionId = null;
      return;
    }
    if (this.companionActor && this.companionId === guest.id) return;
    if (this.companionActor) this.entitiesGroup.remove(this.companionActor.root);

    this.companionId = guest.id;
    this.companionActor = this.modelBank.spawnActor({
      glbUrl: guest.modelGlb || 'assets/models/trainer_warden.glb',
      scale: guest.scale || 1.56,
      primaryColor: guest.color || '#38bdf8',
      secondaryColor: '#fef3c7',
      shadowRadius: 0.52,
      animateRig: true,
    });
    const badge = makeLabelSprite({
      title: guest.name,
      subtitle: guest.role,
      badgeText: `${guest.icon || '🤝'} GUEST`,
      badgeColor: guest.color || '#38bdf8',
      widthWorld: 3.15,
    });
    badge.position.set(0, 2.22, 0);
    this.companionActor.root.add(badge);

    this.companionX = this.partnerX - 1.15;
    this.companionZ = this.partnerZ + 0.95;
    this.companionY = this.diorama ? this.diorama.getHeightAt(this.companionX, this.companionZ) : 0;
    this.companionActor.root.position.set(this.companionX, this.companionY, this.companionZ);
    this.entitiesGroup.add(this.companionActor.root);
  }

  _getRawSkyPillar(sp) {
    const raw = (this.zone?.skyPillars || []).find((p) => p.id === sp.id || p.toZone === sp.toZone);
    return raw ? { ...raw, ...sp } : sp;
  }

  _getRawHouse(h) {
    const raw = (this.zone?.houses || []).find((item) => item.id === h.id);
    return raw ? { ...raw, ...h } : h;
  }

  _isUnlocked(def) {
    if (!def) return { ok: true };
    if (def.requireFlag && !(this.state.storyFlags || []).includes(def.requireFlag)) {
      return {
        ok: false,
        hint: def.lockedHint || '🔒 Complete this realm’s active quest first!',
      };
    }
    if (def.requireKeyItem && !(this.state.keyItems || []).includes(def.requireKeyItem)) {
      return {
        ok: false,
        hint: def.lockedHint || '🔒 A special Key Artifact is required to unlock this!',
      };
    }
    return { ok: true };
  }

  loadZone(zoneId, spawnOverride = null) {
    const zone = ZONES[zoneId] || ZONES.sunpalm;
    this.zone = zone;
    this.state.zoneId = zone.id;

    if (this.interiorDiorama) {
      this._clearInteriorWilds();
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
    this.boostTimer = 0;

    if (!this.heroActor) this.initHeroActors();
    this.refreshCompanionActor();
    this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    if (this.partnerActor) {
      this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    }
    if (this.companionActor) {
      this.companionX = sx - 2.35;
      this.companionZ = sz + 1.85;
      this.companionY = this.diorama.getHeightAt(this.companionX, this.companionZ);
      this.companionActor.root.position.set(this.companionX, this.companionY, this.companionZ);
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
    if (found) {
      this.enterHouse(found);
      return true;
    }
    if (INTERIOR_MAPS[houseId]) {
      this.enterHouse({
        id: houseId,
        interiorMapId: houseId,
        label: INTERIOR_MAPS[houseId].title,
        x: this.heroX,
        z: this.heroZ,
      });
      return true;
    }
    return false;
  }

  enterHouse(houseDef) {
    if (!houseDef || !this.zone) return;
    if (this.interiorDiorama) {
      this._clearInteriorWilds();
      this.sceneRoot.remove(this.interiorDiorama.group);
      this.interiorDiorama = null;
    }
    this.audio.playSfx('door_open');

    const doorX = houseDef.doorX !== undefined ? houseDef.doorX : houseDef.x;
    const doorZ =
      houseDef.doorZ !== undefined ? houseDef.doorZ : houseDef.z + (houseDef.scale || 4.4) * 0.56;
    if (!this.outdoorReturnPos) {
      this.outdoorReturnPos = { x: doorX, z: doorZ + 1.2 };
    }

    this._mountInterior(houseDef);

    // Auto-heal & top up Monkeballs when entering Sanctuary / Home if low!
    if (houseDef.healsParty) {
      healAllParty(this.state);
      if (houseDef.restockBalls && this.state.monkeballs < 18) {
        this.state.monkeballs = Math.min(30, this.state.monkeballs + houseDef.restockBalls);
      } else if (this.state.monkeballs < 10) {
        this.state.monkeballs = 12;
      }
    }

    this.onToast(`🏠 Entered ${houseDef.label || this.interiorDiorama.mapSpec.title}!`);
    if (this.onZoneChanged) this.onZoneChanged(this.zone);
  }

  enterSubInterior(interiorId) {
    const spec = INTERIOR_MAPS[interiorId];
    if (!spec || !this.zone) return;
    this.audio.playSfx('door_open');

    if (this.interiorDiorama) {
      this._clearInteriorWilds();
      this.sceneRoot.remove(this.interiorDiorama.group);
      this.interiorDiorama = null;
    }

    const subDef = {
      id: interiorId,
      interiorMapId: interiorId,
      label: spec.title,
    };
    this._mountInterior(subDef);
    this.onToast(`🪜 Entered ${spec.title}!`);
    if (this.onZoneChanged) this.onZoneChanged(this.zone);
  }

  _mountInterior(houseDef) {
    if (this.outdoorDiorama) this.outdoorDiorama.group.visible = false;
    for (const w of this.wildEntities) w.actor.root.visible = false;
    for (const tr of this.trainerEntities) tr.actor.root.visible = false;
    if (this.aimRing) {
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
    }

    this.activeHouse = houseDef;
    this.interiorDiorama = buildHouseInteriorDiorama(houseDef, this.zone, this.modelBank, this.state);
    this.diorama = this.interiorDiorama;
    this.sceneRoot.add(this.interiorDiorama.group);
    this.renderer.setZoneAtmosphere({
      skyColor: this.interiorDiorama.skyColor,
      fogColor: this.interiorDiorama.fogColor,
    });

    this.heroX = this.interiorDiorama.entrySpawn.x;
    this.heroZ = this.interiorDiorama.entrySpawn.z;
    this.heroY = this.interiorDiorama.getHeightAt(this.heroX, this.heroZ);
    this.heroYaw = Math.PI; // face north into the area!
    this.partnerX = this.heroX - 0.9;
    this.partnerZ = this.heroZ + 0.35;
    this.partnerY = this.heroY;
    this.doorCooldown = 0.85;
    this.boostTimer = 0;

    if (this.heroActor) this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    if (this.partnerActor) this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    this.refreshCompanionActor();
    if (this.companionActor) {
      this.companionX = this.heroX + 0.85;
      this.companionZ = this.heroZ + 0.35;
      this.companionY = this.heroY;
      this.companionActor.root.position.set(this.companionX, this.companionY, this.companionZ);
    }
    this.renderer.setCameraFraming(
      this.heroX * 0.45,
      this.heroY + 0.85,
      this.heroZ * 0.38 + 0.5,
      'interior',
      true,
    );

    this._spawnInteriorWilds();
  }

  _clearInteriorWilds() {
    for (const iw of this.interiorWildEntities) {
      this.entitiesGroup.remove(iw.actor.root);
    }
    this.interiorWildEntities = [];
  }

  _spawnInteriorWilds() {
    this._clearInteriorWilds();
    if (!this.interiorDiorama) return;
    for (const ws of this.interiorDiorama.wildSpawns || []) {
      const pos = this.interiorDiorama.tileToWorld(ws.col, ws.row);
      const ent = this._createWildEntity(
        {
          id: ws.id,
          speciesId: ws.speciesId,
          level: ws.level || 5,
          homeX: pos.x,
          homeZ: pos.z,
          isAlpha: Boolean(ws.isAlpha),
          isFinalBoss: Boolean(ws.isFinalBoss),
          music: ws.music,
          voiceKey: ws.voiceKey,
          introLine: ws.introLine,
        },
        this.interiorDiorama,
        this.interiorWildEntities,
      );
      if (ent && ws.voiceKey) this.audio.prefetchVoice(ws.voiceKey);
    }
  }

  exitHouse(overrideOutdoorPos = null) {
    if (!this.interiorDiorama) return;
    this.audio.playSfx('door_open');
    const prevLabel = this.activeHouse ? this.activeHouse.label : 'Area';

    this._clearInteriorWilds();
    if (this.aimRing) {
      this.entitiesGroup.remove(this.aimRing.group);
      this.aimRing = null;
    }
    this.sceneRoot.remove(this.interiorDiorama.group);
    this.interiorDiorama = null;
    this.activeHouse = null;

    this.diorama = this.outdoorDiorama;
    if (this.outdoorDiorama) this.outdoorDiorama.group.visible = true;
    for (const w of this.wildEntities) w.actor.root.visible = true;
    for (const tr of this.trainerEntities) tr.actor.root.visible = true;
    this.renderer.setZoneAtmosphere(this.zone);

    const ret = overrideOutdoorPos || this.outdoorReturnPos || this.zone.playerSpawn;
    this.outdoorReturnPos = null;
    let rx = ret.x;
    let rz = ret.z;
    if (this.diorama && this.diorama.clampToCoast) {
      const clamped = this.diorama.clampToCoast(rx, rz, 1.25);
      rx = clamped.x;
      rz = clamped.z;
    }
    this.heroX = rx;
    this.heroZ = rz;
    this.heroY = this.diorama ? this.diorama.getHeightAt(this.heroX, this.heroZ) : 0;
    this.heroYaw = 0;
    this.partnerX = this.heroX - 1.3;
    this.partnerZ = this.heroZ + 0.9;
    this.partnerY = this.diorama ? this.diorama.getHeightAt(this.partnerX, this.partnerZ) : 0;
    this.state.pos = { x: this.heroX, z: this.heroZ };
    this.doorCooldown = 0.9;
    this.boostTimer = 0;

    if (this.heroActor) this.heroActor.root.position.set(this.heroX, this.heroY, this.heroZ);
    if (this.partnerActor) this.partnerActor.root.position.set(this.partnerX, this.partnerY, this.partnerZ);
    this.refreshCompanionActor();
    if (this.companionActor) {
      this.companionX = this.heroX + 0.85;
      this.companionZ = this.heroZ + 0.35;
      this.companionY = this.heroY;
      this.companionActor.root.position.set(this.companionX, this.companionY, this.companionZ);
    }
    this.renderer.setCameraFraming(this.heroX, this.heroY + 0.7, this.heroZ, 'overworld', true);
    this.onToast(`🌤️ Emerged from ${prevLabel} into ${this.zone.name}.`);
    if (this.onZoneChanged) this.onZoneChanged(this.zone);
  }

  _triggerInteriorWarp(wp) {
    if (!wp) return;
    if (
      (wp.requireKeyItem && !(this.state.keyItems || []).includes(wp.requireKeyItem)) ||
      (wp.requireFlag && !(this.state.storyFlags || []).includes(wp.requireFlag))
    ) {
      this.audio.playSfx('menu');
      this.onToast(wp.lockedHint || '🔒 A special Key Artifact is needed to open this passage!');
      this.doorCooldown = 0.7;
      return;
    }
    if (wp.grantRelics || wp.grantFlag || wp.grantKeyItem) {
      const res = grantStoryProgress(this.state, {
        relics: wp.grantRelics || 0,
        relicId: wp.relicId || `warp:${wp.id}`,
        keyItem: wp.grantKeyItem,
        flag: wp.grantFlag,
      });
      if (res.addedRelics > 0) {
        this.onToast(`🍌 Discovered +${res.addedRelics} Golden Banana Relic (${this.state.bananaRelics}/77)!`);
      }
    }
    if (wp.toOverworldPos) {
      this.exitHouse(wp.toOverworldPos);
      return;
    }
    const nextInterior = wp.toInteriorId || wp.toInterior;
    if (nextInterior) {
      this.enterSubInterior(nextInterior);
    }
  }

  _clearZoneEntities() {
    this._clearInteriorWilds();
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

  _createWildEntity(cfg, targetDiorama = this.outdoorDiorama, targetList = this.wildEntities) {
    const sp = getSpecies(cfg.speciesId);
    const elemMeta = ELEMENTS[sp.element] || ELEMENTS.mug;
    const scale = (sp.scale || 1.05) * (cfg.isAlpha ? 1.42 : 1.0);
    const wy = targetDiorama ? targetDiorama.getHeightAt(cfg.homeX, cfg.homeZ) : 0;

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
    targetList.push(ent);
    return ent;
  }

  removeWildEntity(ent) {
    if (!ent) return;
    this.entitiesGroup.remove(ent.actor.root);
    this.wildEntities = this.wildEntities.filter((w) => w !== ent);
    this.interiorWildEntities = this.interiorWildEntities.filter((w) => w !== ent);
  }

  _spawnZoneTrainers(zone) {
    for (const tr of zone.trainers || []) {
      if (tr.indoorOnly) continue;
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

  pushNearbyWildsAway(minDist = 3.0) {
    if (!this.zone) return;
    for (const w of this.activeWildEntities) {
      if (w.isFinalBoss) continue;
      const dx = w.x - this.heroX;
      const dz = w.z - this.heroZ;
      const d = Math.hypot(dx, dz);
      if (d < minDist) {
        const ang = d > 0.01 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
        let nx = this.heroX + Math.sin(ang) * (minDist + 0.5);
        let nz = this.heroZ + Math.cos(ang) * (minDist + 0.5);
        if (this.isInsideHouse && this.interiorDiorama && this.interiorDiorama.resolveTileWalk) {
          const res = this.interiorDiorama.resolveTileWalk(w.x, w.z, nx, nz, 0.34);
          nx = res.x;
          nz = res.z;
        } else if (this.outdoorDiorama && this.outdoorDiorama.clampToCoast) {
          const cl = this.outdoorDiorama.clampToCoast(nx, nz, 1.6);
          nx = cl.x;
          nz = cl.z;
        }
        w.x = nx;
        w.z = nz;
        w.y = this.diorama ? this.diorama.getHeightAt(w.x, w.z) : 0;
        w.vx = 0;
        w.vz = 0;
        w.actor.root.position.set(w.x, w.y, w.z);
      }
    }
  }

  _findNearestWild(maxDist = 9.0) {
    let best = null;
    let bestD = maxDist;
    for (const w of this.activeWildEntities) {
      if (w.beingCaught) continue;
      const d = Math.hypot(w.x - this.heroX, w.z - this.heroZ);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

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

  _handleChestOpen(ch) {
    const res = claimChestReward(this.state, ch);
    if (!res.ok) return false;
    ch.opened = true;
    if (ch.glowRing) {
      ch.glowRing.material.color.set('#64748b');
      if (ch.glowRing.material.emissive) {
        ch.glowRing.material.emissive.set('#1e293b');
        ch.glowRing.material.emissiveIntensity = 0.2;
      }
      ch.glowRing.material.opacity = 0.25;
    }
    if (ch.sign) ch.sign.visible = false;
    this.audio.playSfx('chest_open');
    const keyMeta = ch.keyItem ? KEY_ITEMS_META[ch.keyItem] : null;
    const summaryText = keyMeta
      ? `${keyMeta.icon} ${keyMeta.name} · ${res.summary}`
      : res.summary;
    const p = this.renderer.projectToScreen(new THREE.Vector3(ch.x, (ch.y || 0) + 1.8, ch.z));
    if (p.visible && this.onFloatText) {
      this.onFloatText(p.x, p.y, `🎁 ${summaryText}!`, '#fde047');
    }
    this.onToast(`🎁 Opened ${ch.label || 'Relic Chest'}: ${summaryText}!`);
    return true;
  }

  interact() {
    if (!this.diorama) return;

    // A. Inside Map-Driven Interior / Town / Shrine / Cave / Castle / Dungeon!
    if (this.isInsideHouse) {
      const ez = this.interiorDiorama.exitZone;
      if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r + 0.85) {
        this.exitHouse();
        return;
      }

      // 1. Sub-area warps / staircases / portals
      for (const wp of this.interiorDiorama.warpInteractables || []) {
        if (Math.hypot(wp.x - this.heroX, wp.z - this.heroZ) <= (wp.r || 1.6) + 0.75) {
          this._triggerInteriorWarp(wp);
          return;
        }
      }

      // 2. Interior 3D Treasure & Relic Chests!
      for (const ch of this.interiorDiorama.chestInteractables || []) {
        if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.45) {
          if (this._handleChestOpen(ch)) return;
        }
      }

      // 3. Stations, Jukebox, Story NPCs, House Leaders & Bosses!
      for (const st of this.interiorDiorama.stations || []) {
        if (Math.hypot(st.x - this.heroX, st.z - this.heroZ) <= (st.r || 2.4)) {
          if (st.kind === 'heal' || st.kind === 'mom') {
            healAllParty(this.state);
            if (st.kind === 'mom') {
              this.state.berries = Math.min(40, (this.state.berries || 0) + 4);
              if (st.voiceKey) {
                this.audio.playVoice(st.voiceKey, { speaker: "ALEX'S MOM", line: st.voiceLine || '' });
              }
              if ((this.state.storyFlags || []).includes('defeated_king_monkezilla') && this.onOpenStoryScene) {
                this.onOpenStoryScene('epilogue_family_adventure');
              } else if (st.storyScene && this.onOpenStoryScene) {
                this.onOpenStoryScene(st.storyScene);
              } else {
                this.onToast(st.voiceLine || '🧁 Mom served warm Peanut-Butter Toast! Full Party HP healed & +4 Berries!');
              }
            } else {
              if ((this.state.monkeballs || 0) < 15) this.state.monkeballs = 15;
              this.onToast(`💚 ${st.label || 'Healing Station'}: 100% Party HP restored & Monkeballs topped up!`);
            }
            this.audio.playSfx('heal');
            return;
          }

          if (st.kind === 'mount_rental') {
            this.audio.playSfx('confirm');
            const coins = this.state.coins || 0;
            const currentMount = this.state.derbyMount || 'none';
            if (this.onOpenStoryScene) {
              this.onOpenStoryScene('derby_stable_rental', {
                choices: [
                  {
                    id: 'tortoise',
                    label: '🐢 Free Pokey Tortoise (Steady Pace)',
                    tag: currentMount === 'tortoise' ? 'ACTIVE · FREE' : '0 Coins',
                  },
                  {
                    id: 'gale',
                    label: '⚡ Fleet Gale-Strider (+35% Circuit Speed)',
                    tag: currentMount === 'gale' ? 'ACTIVE' : `80 Coins (Have ${coins})`,
                  },
                  {
                    id: 'gold',
                    label: '👑 Champion Gold-Strider (+65% Speed & Skips Track Ambushes!)',
                    tag: currentMount === 'gold' ? 'ACTIVE' : `160 Coins (Have ${coins})`,
                  },
                ],
                onChoice: (choice) => {
                  if (!choice) return;
                  if (choice.id === 'gold') {
                    if (this.state.derbyMount === 'gold') {
                      this.onToast('👑 Champion Gold-Strider is saddled & ready at the East Circuit Gate!');
                    } else if ((this.state.coins || 0) >= 160) {
                      this.state.coins -= 160;
                      this.state.derbyMount = 'gold';
                      this.audio.playSfx('catch_fanfare');
                      this.onToast('👑 Rented the Champion Gold-Strider (+65% Speed & Wild Ambush Immunity on the Circuit)!');
                    } else {
                      this.state.derbyMount = 'tortoise';
                      this.onToast(`Need 160 Coins for Gold-Strider (you have ${this.state.coins || 0})—saddled the Free Pokey Tortoise for now!`);
                    }
                  } else if (choice.id === 'gale') {
                    if (this.state.derbyMount === 'gale') {
                      this.onToast('⚡ Fleet Gale-Strider is saddled & ready at the East Circuit Gate!');
                    } else if ((this.state.coins || 0) >= 80) {
                      this.state.coins -= 80;
                      this.state.derbyMount = 'gale';
                      this.audio.playSfx('catch_fanfare');
                      this.onToast('⚡ Rented the Fleet Gale-Strider (+35% Circuit Speed)!');
                    } else {
                      this.state.derbyMount = 'tortoise';
                      this.onToast(`Need 80 Coins for Gale-Strider (you have ${this.state.coins || 0})—saddled the Free Pokey Tortoise for now!`);
                    }
                  } else {
                    this.state.derbyMount = 'tortoise';
                    this.onToast('🐢 Saddled the Free Pokey Tortoise! Aim for the glowing > Turbo Strips on the Circuit!');
                  }
                },
              });
            } else {
              this.state.derbyMount = 'gale';
              this.onToast('⚡ Saddled a Derby Strider for the Grand Circuit!');
            }
            return;
          }

          if (st.kind === 'prof' || st.kind === 'npc' || st.kind === 'jukebox') {
            const prog = grantStoryProgress(this.state, {
              relics: st.grantRelics || 0,
              relicId: st.relicId || `st:${st.id}`,
              keyItem: st.grantKeyItem,
              flag: st.grantFlag,
            });
            const extras = [];
            if (st.grantStarterSquad) {
              const addedCount = recruitSchoolClassmates(this.state);
              if (addedCount > 0) {
                extras.push(`🎓 +${addedCount} Classmate Monkemon joined your 4-Member Squad`);
              }
            }
            if (st.clearCompanion && (st.clearCompanion === true || this.state.guestCompanion === st.clearCompanion)) {
              this.state.guestCompanion = null;
              this.refreshCompanionActor();
            }
            if (
              st.joinCompanion &&
              (!st.joinUnlessFlag || !(this.state.storyFlags || []).includes(st.joinUnlessFlag)) &&
              this.state.guestCompanion !== st.joinCompanion
            ) {
              this.state.guestCompanion = st.joinCompanion;
              this.refreshCompanionActor();
              const guest = getGuestCompanion(this.state);
              if (guest) extras.push(`🤝 ${guest.name} joined`);
            }
            if (st.kind === 'prof' || st.healParty) {
              healAllParty(this.state);
              if (st.kind === 'prof') {
                this.state.monkeballs = (this.state.monkeballs || 0) + 6;
                this.state.superBalls = (this.state.superBalls || 0) + 1;
              }
            }
            if (st.kind === 'jukebox') {
              // Unlock secret bunker stairs visually right away!
              for (const wp of this.interiorDiorama.warpInteractables || []) {
                if (wp.requireKeyItem === st.grantKeyItem && wp.padMat) {
                  wp.padMat.color.set('#38bdf8');
                  wp.padMat.emissive.set('#0ea5e9');
                  wp.padMat.emissiveIntensity = 0.9;
                }
              }
              this.audio.playSfx('catch_fanfare');
            } else {
              this.audio.playSfx(st.healParty || st.kind === 'prof' ? 'heal' : 'confirm');
            }
            if (st.voiceKey) {
              this.audio.playVoice(st.voiceKey, {
                speaker: (st.name || 'SENSEI').toUpperCase(),
                line: st.voiceLine || st.line || '',
              });
            }
            if (prog.addedRelics > 0) extras.push(`+${prog.addedRelics} 🍌 Relic (${this.state.bananaRelics}/77)`);
            if (prog.newKeyItem) {
              extras.push(`${prog.newKeyItem.icon} ${prog.newKeyItem.name}`);
            }
            const suffix = extras.length ? ` [${extras.join(' · ')}]` : '';
            this.onToast(`${st.name ? `${st.name}: ` : ''}${st.line || st.voiceLine || 'Safe travels!'}${suffix}`);

            const sceneToPlay =
              st.healedStoryScene && (this.state.storyFlags || []).includes('healed_mystic_liana')
                ? st.healedStoryScene
                : st.storyScene;
            if (sceneToPlay && this.onOpenStoryScene) {
              this.onOpenStoryScene(sceneToPlay);
            }
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
            this.onToast(st.loreText || 'Explore every realm for Golden Banana Relics & rare Monkemon!');
            return;
          }
          if (st.kind === 'trainer' && st.trainerDef) {
            const launchBattle = () => {
              this.audio.playSfx('trainer_spot');
              if (st.trainerDef.voiceKey) {
                this.audio.playVoice(st.trainerDef.voiceKey, {
                  speaker: st.trainerDef.name,
                  line: st.trainerDef.introLine || '',
                });
              }
              const cx = (this.heroX + st.x) * 0.5;
              const cz = (this.heroZ + st.z) * 0.5;
              const cy = this.interiorDiorama ? this.interiorDiorama.getHeightAt(cx, cz) : 0;
              this.onStartTrainerBattle(st.trainerDef, { x: cx, y: cy, z: cz });
            };
            if (
              st.trainerDef.preBattleScene &&
              !(this.state.seenStoryScenes || []).includes(st.trainerDef.preBattleScene) &&
              this.onOpenStoryScene
            ) {
              this.onOpenStoryScene(st.trainerDef.preBattleScene, { onComplete: launchBattle });
            } else {
              launchBattle();
            }
            return;
          }
        }
      }

      const nearDungeonWild = this._findNearestWild(4.2);
      if (nearDungeonWild) {
        this.engageNearestWildBattle();
      }
      return;
    }

    // B. Outdoors on the Sky-Vine Realm!
    // 1. Sky-Vine Pillars (inter-world warp columns!)
    for (const sp of this.diorama.skyPillarInteractables || []) {
      if (Math.hypot(sp.x - this.heroX, sp.z - this.heroZ) < 3.4) {
        const check = this._isUnlocked(this._getRawSkyPillar(sp));
        if (!check.ok) {
          this.audio.playSfx('menu');
          this.onToast(check.hint);
          return;
        }
        this.audio.playSfx('catch_fanfare');
        this.loadZone(sp.toZone, { x: sp.spawnX, z: sp.spawnZ });
        return;
      }
    }

    // 2. Enter House / Town / Cave / Shrine / Tower / Castle Doorstep
    for (const h of this.diorama.houseInteractables || []) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.3) {
        const rawH = this._getRawHouse(h);
        const check = this._isUnlocked(rawH);
        if (!check.ok) {
          this.audio.playSfx('menu');
          this.onToast(check.hint);
          return;
        }
        this.enterHouse(rawH);
        return;
      }
    }

    // 3. Open Outdoor Supply & Relic Chests!
    for (const ch of this.diorama.chestInteractables || []) {
      if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.8) {
        if (this._handleChestOpen(ch)) return;
      }
    }

    // 4. Challenge Outdoor Trainers
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.5) {
        const launchOutdoorBattle = () => {
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
        };
        if (
          tr.def.preBattleScene &&
          !(this.state.seenStoryScenes || []).includes(tr.def.preBattleScene) &&
          this.onOpenStoryScene
        ) {
          this.onOpenStoryScene(tr.def.preBattleScene, { onComplete: launchOutdoorBattle });
        } else {
          launchOutdoorBattle();
        }
        return;
      }
    }

    // 5. Golden Banana Shrines (100% Squad Heal + Sweet Berries!)
    for (const sh of this.diorama.shrineInteractables || []) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.9) {
        healAllParty(this.state);
        this.state.berries = Math.min(40, (this.state.berries || 0) + 3);
        this.audio.playSfx('heal');
        this.onToast('✨ Golden Banana Shrine blessed your squad (100% Party HP & +3 Sweet Berries)!');
        return;
      }
    }

    // 6. Shakeable Berry Bushes
    for (const bt of this.diorama.berryInteractables || []) {
      if (bt.cooldown <= 0 && Math.hypot(bt.x - this.heroX, bt.z - this.heroZ) < 2.7) {
        bt.cooldown = 18;
        this.state.berries = (this.state.berries || 0) + 4;
        this.audio.playSfx('berry');
        this.onToast('🍌 Shook the Berry Bush (+4 Sweet Berries)!');
        return;
      }
    }

    // 7. Engage nearby Wild Monkemon in Turn-Based Battle!
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
      this.renderer.setCameraFraming(
        th.targetX,
        th.targetY + 0.7,
        th.targetZ,
        this.isInsideHouse ? 'interior' : 'catch',
        false,
      );

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
              ? `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Added to Squad Slot #${slotInfo.slot + 1}!`
              : `🎉 Caught ${mon.nickname} (Lv.${mon.level})! Sent to Sanctuary Box!`,
          );
          const wasFinalBoss = Boolean(th.target.isFinalBoss);
          this.removeWildEntity(th.target);
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(
            this.heroX,
            this.heroY + 0.7,
            this.heroZ,
            this.isInsideHouse ? 'interior' : 'overworld',
            false,
          );
          if (wasFinalBoss && this.onApexVictory) {
            setTimeout(() => this.onApexVictory(mon), 900);
          }
        } else {
          this.audio.playSfx('break_free');
          th.target.actor.root.visible = true;
          th.target.beingCaught = false;
          this.entitiesGroup.remove(th.ballActor.root);
          this.overworldThrow = null;
          this.renderer.setCameraFraming(
            this.heroX,
            this.heroY + 0.7,
            this.heroZ,
            this.isInsideHouse ? 'interior' : 'overworld',
            false,
          );
          this.onToast(
            `${th.target.species.name} broke free! Toss a [E/(X)] Berry or press [Enter/(A)] to weaken it in Battle!`,
          );
        }
      }
    }
  }

  _updateWildList(list, dt) {
    for (const w of list) {
      if (w.beingCaught) continue;
      w.wanderTimer -= dt;
      if (w.wanderTimer <= 0) {
        w.wanderTimer = 1.8 + Math.random() * 2.5;
        if (Math.random() < 0.48 && !w.isAlpha) {
          const ang = Math.random() * Math.PI * 2;
          const wanderSpd = this.isInsideHouse ? 0.95 : 1.45;
          w.vx = Math.sin(ang) * wanderSpd;
          w.vz = Math.cos(ang) * wanderSpd;
          w.yaw = ang;
        } else {
          w.vx = 0;
          w.vz = 0;
        }
      }
      const nextX = w.x + w.vx * dt;
      const nextZ = w.z + w.vz * dt;
      const maxRoam = this.isInsideHouse ? 1.8 : 3.6;
      if (this.isInsideHouse && this.interiorDiorama && this.interiorDiorama.resolveTileWalk) {
        const stepped = this.interiorDiorama.resolveTileWalk(w.x, w.z, nextX, nextZ, 0.36);
        if (Math.hypot(stepped.x - w.homeX, stepped.z - w.homeZ) < maxRoam) {
          w.x = stepped.x;
          w.z = stepped.z;
        } else {
          w.vx *= -0.6;
          w.vz *= -0.6;
        }
      } else if (
        Math.hypot(nextX - w.homeX, nextZ - w.homeZ) < maxRoam &&
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

      const onChampionCircuit =
        this.isInsideHouse &&
        this.interiorDiorama?.mapSpec?.id === 'race_course' &&
        this.state.derbyMount === 'gold' &&
        !w.isAlpha;
      if (
        !onChampionCircuit &&
        this.gateCooldown <= 0 &&
        Math.hypot(w.x - this.heroX, w.z - this.heroZ) < (w.isAlpha ? 1.65 : 1.05)
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
        return true;
      }
    }
    return false;
  }

  update(dt, input) {
    if (!this.zone || !this.diorama) return;
    this.time += dt;
    this.gateCooldown = Math.max(0, this.gateCooldown - dt);
    this.doorCooldown = Math.max(0, this.doorCooldown - dt);
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    this.healPadCooldown = Math.max(0, this.healPadCooldown - dt);
    this.diorama.update(this.time, dt);
    this.refreshPartnerActor();
    this.refreshCompanionActor();

    // Endgame multi-world earthquakes after Solar Patron's meltdown until the Prime Core (#20) is silenced!
    if (
      (this.state.storyFlags || []).includes('defeated_solar_patron') &&
      !(this.state.storyFlags || []).includes('defeated_king_monkezilla')
    ) {
      this.quakeTimer -= dt;
      if (this.quakeTimer <= 0) {
        this.quakeTimer = 4.2 + Math.random() * 2.2;
        if (this.renderer && this.renderer.triggerShake) {
          this.renderer.triggerShake(0.11, 0.36);
        }
      }
    }

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

    // Hero 2.5D movement + Sprint ([Shift] / [B]) + Derby Turbo Boost + Strider Mount!
    const sprinting = input.down.btnB;
    const boostMult = this.boostTimer > 0 ? 1.55 : 1.0;
    const inRaceCourse = this.isInsideHouse && this.interiorDiorama?.mapSpec?.id === 'race_course';
    const mountMult = inRaceCourse
      ? this.state.derbyMount === 'gold'
        ? 1.65
        : this.state.derbyMount === 'gale'
          ? 1.35
          : this.state.derbyMount === 'tortoise'
            ? 0.94
            : 1.0
      : 1.0;
    const speed = (sprinting ? 9.2 : 6.4) * boostMult * mountMult;
    const mx = input.moveX;
    const mz = input.moveZ;
    this.heroMoving = Math.hypot(mx, mz) > 0.08;

    if (this.heroMoving) {
      let nx = this.heroX + mx * speed * dt;
      let nz = this.heroZ + mz * speed * dt;

      if (this.isInsideHouse) {
        const { halfW, halfD } = this.interiorDiorama.bounds;
        nx = Math.max(-halfW, Math.min(halfW, nx));
        nz = Math.max(-halfD, Math.min(halfD + 0.65, nz));
        if (this.interiorDiorama.resolveTileWalk) {
          const walked = this.interiorDiorama.resolveTileWalk(this.heroX, this.heroZ, nx, nz, 0.34);
          nx = walked.x;
          nz = walked.z;
        }
      } else if (this.diorama.clampToCoast) {
        const cl = this.diorama.clampToCoast(nx, nz, 1.15);
        nx = cl.x;
        nz = cl.z;
      } else {
        const { halfW, halfD } = this.zone.bounds;
        nx = Math.max(-halfW + 1.1, Math.min(halfW - 1.1, nx));
        nz = Math.max(-halfD + 1.1, Math.min(halfD - 1.1, nz));
      }

      // Axis-aligned Box Colliders (city walls & canyon ridges on overworld!)
      if (!this.isInsideHouse && this.diorama.boxColliders) {
        const hPad = 0.52;
        for (const b of this.diorama.boxColliders) {
          if (nx + hPad > b.minX && nx - hPad < b.maxX && nz + hPad > b.minZ && nz - hPad < b.maxZ) {
            const overlapL = nx + hPad - b.minX;
            const overlapR = b.maxX - (nx - hPad);
            const overlapT = nz + hPad - b.minZ;
            const overlapB = b.maxZ - (nz - hPad);
            const minOverlap = Math.min(overlapL, overlapR, overlapT, overlapB);
            if (minOverlap === overlapL) nx = b.minX - hPad;
            else if (minOverlap === overlapR) nx = b.maxX + hPad;
            else if (minOverlap === overlapT) nz = b.minZ - hPad;
            else nz = b.maxZ + hPad;
          }
        }
      }

      const heroRad = this.isInsideHouse ? 0.36 : 0.55;
      for (const c of this.diorama.colliders) {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const d = Math.hypot(dx, dz);
        const minR = c.r + heroRad;
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
      const followDist = this.isInsideHouse ? 1.05 : 1.45;
      const targetPx = this.heroX - Math.sin(this.heroYaw) * followDist;
      const targetPz = this.heroZ - Math.cos(this.heroYaw) * followDist;
      const pdx = targetPx - this.partnerX;
      const pdz = targetPz - this.partnerZ;
      const pDist = Math.hypot(pdx, pdz);
      let pMoveSpd = 0;
      if (pDist > 0.25) {
        pMoveSpd = (sprinting ? 9.8 : 7.0) * boostMult;
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

    // Following Guest Companion AI (`Sensei Bob`, `Mystic Liana`, `Kai`, `Dad`, `Hana`, `Goddess Liana`)
    if (this.companionActor) {
      const anchorX = this.partnerActor ? this.partnerX : this.heroX;
      const anchorZ = this.partnerActor ? this.partnerZ : this.heroZ;
      const anchorYaw = this.partnerActor ? this.partnerYaw : this.heroYaw;
      const cFollowDist = this.isInsideHouse ? 1.0 : 1.42;
      const targetCx = anchorX - Math.sin(anchorYaw) * cFollowDist;
      const targetCz = anchorZ - Math.cos(anchorYaw) * cFollowDist;
      const cdx = targetCx - this.companionX;
      const cdz = targetCz - this.companionZ;
      const cDist = Math.hypot(cdx, cdz);
      let cMoveSpd = 0;
      if (cDist > 0.25) {
        cMoveSpd = (sprinting ? 9.8 : 7.0) * boostMult * mountMult;
        const step = Math.min(cDist, cMoveSpd * dt);
        this.companionX += (cdx / cDist) * step;
        this.companionZ += (cdz / cDist) * step;
        this.companionYaw = Math.atan2(cdx, cdz);
      }
      this.companionY = this.diorama.getHeightAt(this.companionX, this.companionZ);
      this.companionActor.root.position.set(this.companionX, this.companionY, this.companionZ);
      if (this.companionActor.updateMotion) {
        this.companionActor.updateMotion(dt, {
          targetYaw: this.companionYaw,
          moveSpeed: cDist > 0.3 ? cMoveSpd : 0,
        });
      }
    }

    // Inside Map-Driven Interior / Town / Dungeon!
    if (this.isInsideHouse) {
      this.renderer.setCameraFraming(
        this.heroX * 0.45,
        this.heroY + 0.85,
        this.heroZ * 0.38 + 0.5,
        'interior',
        false,
      );

      // Oasis Heal Pads (`+`)
      if (this.healPadCooldown <= 0) {
        for (const hp of this.interiorDiorama.healPads || []) {
          if (Math.hypot(hp.x - this.heroX, hp.z - this.heroZ) < hp.r) {
            this.healPadCooldown = 4.5;
            healAllParty(this.state);
            this.audio.playSfx('heal');
            const p = this.renderer.projectToScreen(new THREE.Vector3(this.heroX, this.heroY + 1.8, this.heroZ));
            if (p.visible && this.onFloatText) {
              this.onFloatText(p.x, p.y, '💚 OASIS FULL HEAL!', '#4ade80');
            }
            this.onToast('💚 Sacred Oasis Tile restored 100% HP to your entire squad!');
            break;
          }
        }
      }

      // Derby Turbo Boost Strips (`>`)
      for (const bp of this.interiorDiorama.boostPads || []) {
        if (Math.hypot(bp.x - this.heroX, bp.z - this.heroZ) < bp.r) {
          if (this.boostTimer < 1.8) {
            this.audio.playSfx('confirm');
            const p = this.renderer.projectToScreen(new THREE.Vector3(this.heroX, this.heroY + 1.8, this.heroZ));
            if (p.visible && this.onFloatText) {
              this.onFloatText(p.x, p.y, '⚡ TURBO BOOST!', '#38bdf8');
            }
          }
          this.boostTimer = 2.4;
          break;
        }
      }

      // Walk-onto Sub-Area Warps
      if (this.doorCooldown <= 0 && this.heroMoving) {
        for (const wp of this.interiorDiorama.warpInteractables || []) {
          if (Math.hypot(wp.x - this.heroX, wp.z - this.heroZ) < 0.72) {
            this._triggerInteriorWarp(wp);
            return;
          }
        }
      }

      // South Exit Doormat
      if (this.doorCooldown <= 0 && this.heroMoving && mz > 0.1) {
        const ez = this.interiorDiorama.exitZone;
        if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r) {
          this.exitHouse();
          return;
        }
      }

      // Interior Dungeon Wild Roaming & Touch-Encounters
      if (this._updateWildList(this.interiorWildEntities, dt)) return;

      this.promptText = this._computeContextPrompt();
      return;
    }

    // Outdoors: Walk onto glowing House doorstep mat while walking North to enter seamlessly!
    if (this.doorCooldown <= 0 && this.heroMoving && mz < -0.1) {
      for (const h of this.diorama.houseInteractables || []) {
        if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 1.35) {
          const rawH = this._getRawHouse(h);
          const check = this._isUnlocked(rawH);
          if (!check.ok) {
            this.doorCooldown = 1.25;
            this.audio.playSfx('menu');
            this.onToast(check.hint);
            return;
          }
          this.enterHouse(rawH);
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

    // Track current named frontier subregion & announce newly explored regions!
    let activeSub = null;
    let bestSubRatio = 1.0;
    for (const sr of this.zone.subregions || []) {
      const ratio = Math.hypot(this.heroX - sr.x, this.heroZ - sr.z) / Math.max(6, sr.r || 16);
      if (ratio <= bestSubRatio) {
        bestSubRatio = ratio;
        activeSub = sr;
      }
    }
    this.currentSubregion = activeSub;
    if (activeSub && activeSub.id) {
      if (!Array.isArray(this.state.discoveredSubregions)) this.state.discoveredSubregions = [];
      if (!this.state.discoveredSubregions.includes(activeSub.id)) {
        this.state.discoveredSubregions.push(activeSub.id);
        this.onToast(`🧭 Discovered: ${activeSub.name}!`);
      }
    }

    // Inter-Zone Peninsula Gateways & Sky-Vine Pillar Portals!
    if (this.gateCooldown <= 0) {
      for (const gw of this.zone.gateways || []) {
        if (Math.hypot(gw.x - this.heroX, gw.z - this.heroZ) < 1.95) {
          this.audio.playSfx('confirm');
          this.loadZone(gw.toZone, { x: gw.spawnX, z: gw.spawnZ });
          return;
        }
      }
      for (const sp of this.diorama.skyPillarInteractables || []) {
        if (Math.hypot(sp.x - this.heroX, sp.z - this.heroZ) < 1.85) {
          const check = this._isUnlocked(this._getRawSkyPillar(sp));
          if (!check.ok) {
            this.gateCooldown = 1.4;
            this.audio.playSfx('menu');
            this.onToast(check.hint);
            return;
          }
          this.audio.playSfx('catch_fanfare');
          this.loadZone(sp.toZone, { x: sp.spawnX, z: sp.spawnZ });
          return;
        }
      }
    }

    // Update Outdoor Wild Roaming Monkemon + Touch-Encounter Check
    if (this._updateWildList(this.wildEntities, dt)) return;

    this.promptText = this._computeContextPrompt();
  }

  _computeContextPrompt() {
    if (this.isInsideHouse) {
      for (const wp of this.interiorDiorama.warpInteractables || []) {
        if (Math.hypot(wp.x - this.heroX, wp.z - this.heroZ) <= (wp.r || 1.6) + 0.75) {
          return `🪜 [Enter / Space / (A)] ${wp.label || 'Use Passage'}`;
        }
      }
      for (const ch of this.interiorDiorama.chestInteractables || []) {
        if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.45) {
          return `🎁 [Enter / Space / (A)] Open ${ch.label || 'Relic Chest'}`;
        }
      }
      for (const st of this.interiorDiorama.stations || []) {
        if (Math.hypot(st.x - this.heroX, st.z - this.heroZ) <= (st.r || 2.4)) {
          return st.prompt;
        }
      }
      const nearDungeonWild = this._findNearestWild(6.5);
      if (nearDungeonWild) {
        return `⚔️ Wild ${nearDungeonWild.species.name} Lv.${nearDungeonWild.level} — [Enter/(A)] Battle · [F/(Y)] Throw Monkeball (${this.state.monkeballs})`;
      }
      const ez = this.interiorDiorama.exitZone;
      if (ez && Math.hypot(ez.x - this.heroX, ez.z - this.heroZ) < ez.r + 0.9) {
        return `🚪 [Enter / (A)] or Walk South to Exit to ${this.zone.name}`;
      }
      return `🗺️ ${this.interiorDiorama.mapSpec.title} — Explore & press [Enter / Space / (A)] to interact`;
    }

    if (this.aimRing) {
      return '🎯 TIMING RING: Press [F / Enter / (Y) / (A)] when the glowing ring shrinks to GOLD for EXCELLENT Catch!';
    }
    for (const sp of this.diorama.skyPillarInteractables || []) {
      if (Math.hypot(sp.x - this.heroX, sp.z - this.heroZ) < 3.4) {
        const check = this._isUnlocked(this._getRawSkyPillar(sp));
        return check.ok
          ? `🌿✨ [Enter / Space / (A)] Ascend Sky-Vine Pillar → ${sp.label}`
          : check.hint;
      }
    }
    for (const h of this.diorama.houseInteractables || []) {
      if (Math.hypot(h.doorX - this.heroX, h.doorZ - this.heroZ) < 3.3) {
        const rawH = this._getRawHouse(h);
        const check = this._isUnlocked(rawH);
        return check.ok
          ? `🚪 Walk In or press [Enter / (A)] to Enter ${h.label}`
          : check.hint;
      }
    }
    for (const ch of this.diorama.chestInteractables || []) {
      if (!ch.opened && Math.hypot(ch.x - this.heroX, ch.z - this.heroZ) < 2.8) {
        return `🎁 [Enter / Space / (A)] Open ${ch.label || 'Relic Chest'}`;
      }
    }
    for (const tr of this.trainerEntities) {
      if (Math.hypot(tr.x - this.heroX, tr.z - this.heroZ) < 3.5) {
        return `⚔️ [Enter / Space / (A)] Battle ${tr.def.name} (${tr.def.role})`;
      }
    }
    for (const sh of this.diorama.shrineInteractables || []) {
      if (Math.hypot(sh.x - this.heroX, sh.z - this.heroZ) < 2.9) {
        return '✨ [Enter / Space / (A)] Pray at Golden Banana Shrine (100% Party Heal + 3 Berries)';
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
