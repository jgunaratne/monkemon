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
  computeCoastRadiusNorm,
  computeComboMultiplier,
  createMonkemonInstance,
  getBattleMoves,
  gradeTimingRing,
  grantExpToMon,
} from '../src/game/combat_math.js';
import {
  addCaughtMonToState,
  buyShopItem,
  claimChestReward,
  createInitialGameState,
  healAllParty,
  loadGameFromStorage,
  saveGameToStorage,
  setLeadPartyIndex,
  swapPartyWithStorage,
  useBerryOnPartyMon,
} from '../src/game/save_store.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('All 7 official Types, 4 core moves, and 4-move Turn-Based rosters exist for all 20 Monkemon', () => {
  const expectedTypes = ['mug', 'monster', 'dog', 'rubber_duck', 'stuffie', 'bob', 'cow'];
  for (const t of expectedTypes) {
    assert.ok(ELEMENTS[t], `Missing official type ${t}`);
  }
  assert.equal(MOVES.monk_run.slotKey, 'A');
  assert.equal(MOVES.fake_out.slotKey, 'B');
  assert.equal(MOVES.eat_snack.slotKey, 'X');
  assert.equal(MOVES.sky_jump.slotKey, 'Y');

  for (const sp of CORE_SPECIES) {
    const mon = createMonkemonInstance(sp.id, 8);
    const bMoves = getBattleMoves(mon, sp);
    assert.equal(bMoves.length, 4, `Expected 4 turn-based battle moves for ${sp.id}`);
    const ids = new Set(bMoves.map((m) => m.id));
    assert.equal(ids.size, 4, `Expected 4 unique moves on ${sp.id}`);
  }
});

test('All 20 Monkemon (#01–#20) and all 10 TRELLIS.2 environment & flora .glb models exist on disk', () => {
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

  const envGlbs = [
    'env_palm_tree.glb',
    'env_canopy_oak.glb',
    'env_alpine_pine.glb',
    'env_tropical_flora.glb',
    'env_berry_bush.glb',
    'env_harbor_lighthouse.glb',
    'env_onsen_gazebo.glb',
    'env_volcano_obelisk.glb',
    'env_treasure_chest.glb',
    'env_plaza_fountain.glb',
  ];
  for (const f of envGlbs) {
    const p = path.join(ROOT, 'assets', 'models', f);
    assert.ok(fs.existsSync(p), `Missing TRELLIS.2 environment .glb: ${p}`);
    assert.ok(fs.statSync(p).size > 100_000, `Expected rich PBR .glb >100KB for ${f}`);
  }
});

test('All 5 Organic Curved Archipelago Islands have Houses, WorldMapNodes, Terraces, Bridges, Chests & Pickups', () => {
  assert.equal(ZONE_LIST.length, 5);
  const allHouseIds = new Set();
  for (const z of ZONE_LIST) {
    assert.ok(Array.isArray(z.coastParams) && z.coastParams.length === 4, `Missing coastParams on ${z.id}`);
    // Verify coastline radius genuinely varies across angles (non-square curved island!)
    const radii = Array.from({ length: 32 }, (_, i) =>
      computeCoastRadiusNorm((i / 32) * Math.PI * 2, z.coastParams),
    );
    const minR = Math.min(...radii);
    const maxR = Math.max(...radii);
    assert.ok(maxR - minR > 0.18, `Expected non-uniform organic coast contour on ${z.id}`);

    assert.ok(z.worldMapNode && typeof z.worldMapNode.x === 'number', `Missing worldMapNode on ${z.id}`);
    assert.ok(Array.isArray(z.chests) && z.chests.length >= 2, `Expected supply chests on ${z.id}`);
    assert.ok(Array.isArray(z.ballPickups) && z.ballPickups.length >= 2, `Expected Monkeball pickups on ${z.id}`);

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

test('Save store manages 6-slot squad, storage box, berry healing, supply chests, and shop items', () => {
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

  state.party[0].hp = 5;
  const berryHeal = useBerryOnPartyMon(state, 0);
  assert.ok(berryHeal.ok);
  assert.ok(state.party[0].hp > 5);

  healAllParty(state);
  assert.equal(state.party[0].hp, state.party[0].maxHp);

  const ballsBeforeChest = state.monkeballs;
  const chestRes = claimChestReward(state, { id: 'test_chest_1', balls: 6, superBalls: 1, coins: 50 });
  assert.ok(chestRes.ok);
  assert.equal(state.monkeballs, ballsBeforeChest + 6);
  const dupChest = claimChestReward(state, { id: 'test_chest_1', balls: 6 });
  assert.equal(dupChest.ok, false);
  assert.equal(dupChest.alreadyOpened, true);

  assert.ok(saveGameToStorage(state, mockStorage));
  const loaded = loadGameFromStorage(mockStorage);
  assert.equal(loaded.playerName, 'ALEX');
  assert.equal(loaded.party.length, 6);
  assert.ok(loaded.openedChests.includes('test_chest_1'));
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

test('All 16 PBR textures, 22 ElevenLabs SFX, bundled fonts, and 11 GLSL shaders (including Battle Shader Suite) exist', () => {
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

  const sfxDir = path.join(ROOT, 'assets', 'sfx');
  const sfxFiles = fs.readdirSync(sfxDir).filter((f) => f.endsWith('.mp3'));
  assert.ok(sfxFiles.length >= 22, `Expected >=22 ElevenLabs .mp3 SFX in assets/sfx, got ${sfxFiles.length}`);

  const shaderSrc = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'shaders.js'), 'utf8');
  for (const fn of [
    'computeCoastRadiusNorm',
    'createOceanMagmaShaderMaterial',
    'attachTerrainDetailShader',
    'attachCliffWetnessShader',
    'attachWindGrassShader',
    'attachFoliageSubsurfaceShader',
    'createSunbeamShaderMaterial',
    'createHoloArenaShaderMaterial',
    'createBattleBarrierDomeShaderMaterial',
    'createCombatantPadShaderMaterial',
    'createElementalBeamShaderMaterial',
    'createBattleImpactWaveShaderMaterial',
  ]) {
    assert.ok(shaderSrc.includes(`export function ${fn}`), `Missing shader builder ${fn}`);
  }

  for (const fontFile of ['LuckiestGuy-Regular.ttf', 'LilitaOne-Regular.ttf', 'Fredoka-Variable.ttf']) {
    const fp = path.join(ROOT, 'assets', 'fonts', fontFile);
    assert.ok(fs.existsSync(fp), `Missing bundled UI font: ${fp}`);
    assert.ok(fs.statSync(fp).size > 20_000, `Expected non-empty bundled UI font: ${fp}`);
  }
});
