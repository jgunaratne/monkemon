import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS, MOVES } from '../src/data/moves.js';
import { CORE_SPECIES, getAllSpecies, getSpecies } from '../src/data/species.js';
import { ZONE_LIST, ZONES } from '../src/data/zones.js';
import {
  calculateHitDamage,
  computeCatchProbability,
  computeComboMultiplier,
  createMonkemonInstance,
  gradeTimingRing,
  grantExpToMon,
} from '../src/game/combat_math.js';
import {
  addCaughtMonToState,
  buyShopItem,
  createInitialGameState,
  healAllParty,
  loadGameFromStorage,
  saveGameToStorage,
  setLeadPartyIndex,
  swapPartyWithStorage,
} from '../src/game/save_store.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('All 7 official Sticky-Note Types and 4 core A/B/X/Y moves exist', () => {
  const expectedTypes = ['mug', 'monster', 'dog', 'rubber_duck', 'stuffie', 'bob', 'cow'];
  for (const t of expectedTypes) {
    assert.ok(ELEMENTS[t], `Missing official type ${t}`);
  }
  assert.equal(MOVES.monk_run.slotKey, 'A');
  assert.equal(MOVES.fake_out.slotKey, 'B');
  assert.equal(MOVES.eat_snack.slotKey, 'X');
  assert.equal(MOVES.sky_jump.slotKey, 'Y');
});

test('All 20 Monkemon (#01 through #20) have unique TRELLIS.2 .glb files on disk', () => {
  assert.equal(CORE_SPECIES.length, 20);
  const seenGlbs = new Set();
  const seenDexNums = new Set();
  for (const sp of CORE_SPECIES) {
    assert.ok(sp.dexNum >= 1 && sp.dexNum <= 20);
    assert.ok(!seenDexNums.has(sp.dexNum), `Duplicate dexNum ${sp.dexNum}`);
    seenDexNums.add(sp.dexNum);

    assert.ok(ELEMENTS[sp.element], `Invalid element ${sp.element} on ${sp.id}`);
    assert.ok(!seenGlbs.has(sp.glb), `Duplicate .glb ${sp.glb}`);
    seenGlbs.add(sp.glb);

    const absGlb = path.join(ROOT, sp.glb);
    assert.ok(fs.existsSync(absGlb), `Missing .glb file on disk: ${absGlb}`);
    assert.ok(fs.statSync(absGlb).size > 100_000, `Expected real PBR .glb >100KB for ${sp.id}`);
  }
});

test('All 5 Concept-Spec Houses & Monkeball .glb files exist across the 5 zones', () => {
  assert.equal(ZONE_LIST.length, 5);
  const allHouseIds = new Set();
  for (const z of ZONE_LIST) {
    for (const h of z.houses) {
      allHouseIds.add(h.id);
      const absGlb = path.join(ROOT, h.glb);
      assert.ok(fs.existsSync(absGlb), `Missing house .glb: ${absGlb}`);
    }
    for (const gw of z.gateways) {
      assert.ok(ZONES[gw.toZone], `Gateway from ${z.id} points to unknown zone ${gw.toZone}`);
    }
  }
  for (const reqHouse of ['alex_house', 'peanut_butter_house', 'fish_house', 'pork_house', 'beef_house']) {
    assert.ok(allHouseIds.has(reqHouse), `Missing required spec house: ${reqHouse}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/models/monkeball.glb')));
});

test('Type effectiveness, damage math, Monkeball capture ring, and party leveling work cleanly', () => {
  const duck = createMonkemonInstance('duckaque', 10); // Rubber Duck
  const mon = createMonkemonInstance('chimpark', 10);  // Monster

  const superHit = calculateHitDamage(duck, mon, MOVES.squeak_tsunami, { rng: 0.5 });
  const resistHit = calculateHitDamage(mon, duck, MOVES.kaiju_roar, { rng: 0.5 });
  assert.ok(superHit.effectiveness > 1.3);
  assert.equal(superHit.label, 'SUPER EFFECTIVE!');
  assert.ok(superHit.damage > resistHit.damage);

  const ringExc = gradeTimingRing(0.25);
  assert.equal(ringExc.grade, 'EXCELLENT!');

  const fullHpProb = computeCatchProbability({
    species: getSpecies('chimpark'),
    currentHp: 60,
    maxHp: 60,
    ringMult: 1.0,
    berryFed: false,
  });
  const weakExcProb = computeCatchProbability({
    species: getSpecies('chimpark'),
    currentHp: 6,
    maxHp: 60,
    ringMult: ringExc.mult,
    berryFed: true,
    badgesCount: 2,
  });
  assert.ok(weakExcProb > fullHpProb);

  const lvRes = grantExpToMon(duck, 5000);
  assert.ok(lvRes.levelsGained >= 1);
  assert.ok(duck.level > 10);

  assert.equal(computeComboMultiplier(0), 1.0);
  assert.equal(computeComboMultiplier(1), 1.0);
  assert.ok(computeComboMultiplier(4) > 1.2);
  assert.equal(computeComboMultiplier(12), 1.5);
  const comboHit = calculateHitDamage(duck, mon, MOVES.squeak_tsunami, { rng: 0.5, comboCount: 5 });
  const baseHit = calculateHitDamage(duck, mon, MOVES.squeak_tsunami, { rng: 0.5, comboCount: 0 });
  assert.ok(comboHit.damage > baseHit.damage);
});

test('Save store initializes ALEX, manages 6-slot party + overflow storage, and round-trips JSON', () => {
  const mem = new Map();
  const mockStorage = {
    getItem: (k) => mem.get(k) || null,
    setItem: (k, v) => mem.set(k, v),
  };

  const state = createInitialGameState('ALEX', 'mugchimp');
  assert.equal(state.playerName, 'ALEX');
  assert.equal(state.party.length, 1);

  for (let i = 0; i < 7; i++) {
    addCaughtMonToState(state, createMonkemonInstance('puppuchin', 4 + i));
  }
  assert.equal(state.party.length, 6);
  assert.equal(state.storage.length, 2);

  state.party[0].hp = 3;
  healAllParty(state);
  assert.equal(state.party[0].hp, state.party[0].maxHp);

  assert.ok(saveGameToStorage(state, mockStorage));
  const loaded = loadGameFromStorage(mockStorage);
  assert.equal(loaded.playerName, 'ALEX');
  assert.equal(loaded.party.length, 6);
  assert.equal(getAllSpecies().length, 20);

  assert.ok(setLeadPartyIndex(state, 2));
  assert.equal(state.activeIndex, 2);

  const oldParty1 = state.party[1].speciesId;
  const oldStorage0 = state.storage[0].speciesId;
  assert.ok(swapPartyWithStorage(state, 1, 0));
  assert.equal(state.party[1].speciesId, oldStorage0);
  assert.equal(state.storage[0].speciesId, oldParty1);

  const startBalls = state.monkeballs;
  const buyRes = buyShopItem(state, 'monkeball_pack');
  assert.ok(buyRes.ok);
  assert.equal(state.monkeballs, startBalls + 5);
});

test('All 16 Nano Banana PBR surface albedo & tangent-space normal maps and 7 GLSL shaders exist', () => {
  const texBases = [
    'grass_meadow',
    'grass_grove',
    'cobble_path',
    'cliff_rock',
    'harbor_stone',
    'snow_alpine',
    'volcano_basalt',
    'wood_timber',
  ];
  for (const base of texBases) {
    for (const suffix of ['', '_normal']) {
      const p = path.join(ROOT, 'assets', 'textures', `${base}${suffix}.jpg`);
      assert.ok(fs.existsSync(p), `Missing PBR texture map: ${p}`);
      assert.ok(fs.statSync(p).size > 25_000, `Expected rich PBR texture >25KB: ${p}`);
    }
  }

  const shaderSrc = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'shaders.js'), 'utf8');
  for (const fn of [
    'createOceanMagmaShaderMaterial',
    'attachTerrainDetailShader',
    'attachCliffWetnessShader',
    'attachWindGrassShader',
    'attachFoliageSubsurfaceShader',
    'createSunbeamShaderMaterial',
    'createHoloArenaShaderMaterial',
  ]) {
    assert.ok(shaderSrc.includes(`export function ${fn}`), `Missing shader builder ${fn}`);
  }
});
