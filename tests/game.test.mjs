import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERIOR_MAPS, getInteriorMapSpec } from '../src/data/interior_maps.js';
import { ELEMENTS, MOVES } from '../src/data/moves.js';
import { CORE_SPECIES, getAllSpecies, getSpecies } from '../src/data/species.js';
import {
  GUEST_COMPANIONS,
  KEY_ITEMS_META,
  STORY_CHAPTERS,
  TOTAL_BANANA_RELICS,
  WORLD_RELIC_LEDGER,
  buildStoryScene,
  getActiveStoryChapter,
  getGuestCompanion,
  getZoneRelicStatus,
} from '../src/data/storyline.js';
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
  grantStoryProgress,
  healAllParty,
  loadGameFromStorage,
  recruitSchoolClassmates,
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

test('All 10 Sky-Vine Realms have Houses, Sky-Vine Pillars, WorldMapNodes, Chests, Pickups & valid species', () => {
  assert.equal(ZONE_LIST.length, 10, `Expected 10 Sky-Vine Realms, got ${ZONE_LIST.length}`);
  const validSpecies = new Set(CORE_SPECIES.map((s) => s.id));
  const allHouseIds = new Set();
  for (const z of ZONE_LIST) {
    assert.ok(Array.isArray(z.coastParams) && z.coastParams.length === 4, `Missing coastParams on ${z.id}`);
    // Verify coastline radius genuinely varies across angles (non-square curved island!)
    const radii = Array.from({ length: 32 }, (_, i) =>
      computeCoastRadiusNorm((i / 32) * Math.PI * 2, z.coastParams),
    );
    const minR = Math.min(...radii);
    const maxR = Math.max(...radii);
    assert.ok(maxR - minR > 0.14, `Expected non-uniform organic coast contour on ${z.id}`);

    assert.ok(z.bounds && z.bounds.halfW >= 56 && z.bounds.halfD >= 48, `Expected extensive open-world bounds on ${z.id}`);
    assert.ok(Array.isArray(z.subregions) && z.subregions.length >= 5, `Expected >=5 named subregions on ${z.id}`);
    assert.ok(Array.isArray(z.biomePatches) && z.biomePatches.length >= 5, `Expected >=5 multi-biome terrain patches on ${z.id}`);
    assert.ok(Array.isArray(z.terraces) && z.terraces.length >= 2, `Expected >=2 elevated walkable terraces on ${z.id}`);
    assert.ok(Array.isArray(z.wildSpots) && z.wildSpots.length >= 10, `Expected >=10 wild spots on ${z.id}`);
    assert.ok(z.worldMapNode && typeof z.worldMapNode.x === 'number', `Missing worldMapNode on ${z.id}`);
    assert.ok(Array.isArray(z.skyPillars) && z.skyPillars.length >= 1, `Expected skyPillars on ${z.id}`);
    assert.ok(Array.isArray(z.chests) && z.chests.length >= 1, `Expected supply chests on ${z.id}`);
    assert.ok(Array.isArray(z.ballPickups) && z.ballPickups.length >= 1, `Expected Monkeball pickups on ${z.id}`);

    const assertInsideIsland = (pt, label) => {
      const nx = pt.x / z.bounds.halfW;
      const nz = pt.z / z.bounds.halfD;
      const rNorm = Math.hypot(nx, nz);
      const ang = Math.atan2(nz, nx);
      const coastR = computeCoastRadiusNorm(ang, z.coastParams);
      assert.ok(rNorm < coastR - 0.03, `${label} (${pt.x}, ${pt.z}) outside coastline of ${z.id} (r=${rNorm.toFixed(3)} >= ${coastR.toFixed(3)})`);
    };
    assertInsideIsland(z.playerSpawn, 'playerSpawn');
    for (const h of z.houses) assertInsideIsland(h, `house ${h.id}`);
    for (const sp of z.skyPillars) assertInsideIsland(sp, `skyPillar ${sp.id}`);
    for (const ch of z.chests) assertInsideIsland(ch, `chest ${ch.id}`);
    for (const tr of z.trainers || []) {
      if (!tr.indoorOnly) assertInsideIsland(tr, `trainer ${tr.id}`);
    }
    for (const ws of z.wildSpots) assertInsideIsland(ws, 'wildSpot');

    for (const sp of z.skyPillars) {
      assert.ok(ZONES[sp.toZone], `Sky-Vine Pillar on ${z.id} points to unknown zone ${sp.toZone}`);
    }
    for (const w of z.wildPool || []) {
      assert.ok(validSpecies.has(w.speciesId), `Unknown wild species ${w.speciesId} in ${z.id}`);
    }
    for (const a of z.apexSpawns || []) {
      assert.ok(validSpecies.has(a.speciesId), `Unknown apex species ${a.speciesId} in ${z.id}`);
    }
    for (const h of z.houses) {
      allHouseIds.add(h.id);
      const absGlb = path.join(ROOT, h.glb);
      assert.ok(fs.existsSync(absGlb), `Missing house .glb: ${absGlb}`);
      const spec = getInteriorMapSpec(h);
      assert.ok(spec && Array.isArray(spec.grid) && spec.grid.length >= 8, `Missing interior grid for ${h.id}`);
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

test('All 46 bespoke enterable Interior/Town/Shrine/Dungeon maps are rectangular & 100% BFS-reachable, and Storyline + Generic Descriptors pass', () => {
  const mapEntries = Object.entries(INTERIOR_MAPS);
  assert.equal(mapEntries.length, 46, `Expected 46 bespoke enterable areas, got ${mapEntries.length}`);
  const blocked = new Set(['#', 'P', '~', '^']);
  const validSpecies = new Set(CORE_SPECIES.map((s) => s.id));

  for (const [id, spec] of mapEntries) {
    const rows = spec.grid.length;
    const cols = spec.grid[0].length;
    for (let r = 0; r < rows; r++) {
      assert.equal(spec.grid[r].length, cols, `Non-rectangular row ${r} in ${id}`);
    }
    const [sc, sr] = spec.entryTile;
    assert.ok(!blocked.has(spec.grid[sr][sc]), `Blocked entryTile in ${id}`);

    // BFS reachability from entryTile
    const visited = new Set([`${sc},${sr}`]);
    const queue = [[sc, sr]];
    while (queue.length > 0) {
      const [c, r] = queue.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const k = `${nc},${nr}`;
        if (visited.has(k) || blocked.has(spec.grid[nr][nc])) continue;
        visited.add(k);
        queue.push([nc, nr]);
      }
    }
    const canTouch = (tc, tr) => {
      if (visited.has(`${tc},${tr}`)) return true;
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => visited.has(`${tc + dc},${tr + dr}`));
    };
    for (const ch of spec.chests || []) {
      assert.ok(canTouch(ch.col, ch.row), `Unreachable chest ${ch.id} in ${id}`);
    }
    for (const wp of spec.warps || []) {
      assert.ok(canTouch(wp.col, wp.row), `Unreachable warp ${wp.id} in ${id}`);
      if (wp.toInterior) assert.ok(INTERIOR_MAPS[wp.toInterior], `Unknown toInterior ${wp.toInterior} in ${id}`);
    }
    for (const st of spec.stations || []) {
      assert.ok(canTouch(st.col, st.row), `Unreachable station ${st.id} in ${id}`);
      for (const tm of st.trainerDef?.team || []) {
        assert.ok(validSpecies.has(tm.speciesId), `Unknown trainer species ${tm.speciesId} in ${id}`);
      }
    }
    for (const ws of spec.wildSpawns || []) {
      assert.ok(validSpecies.has(ws.speciesId), `Unknown dungeon wild species ${ws.speciesId} in ${id}`);
    }
  }

  // Storyline, Exact 77-Relic Ledger, Prism Detector, 4-Member Classmate Squad & Guest Companions checks
  assert.equal(TOTAL_BANANA_RELICS, 77);
  assert.equal(STORY_CHAPTERS.length, 13);
  const ledgerTotal = WORLD_RELIC_LEDGER.reduce((acc, item) => acc + item.count, 0);
  assert.equal(ledgerTotal, 77, `Expected WORLD_RELIC_LEDGER to total 77 Relics, got ${ledgerTotal}`);

  // Verify world + interior obtainable Relics match WORLD_RELIC_LEDGER 100%
  const actualRelicMap = new Map([
    ['relic:dad_prism', 1],
    ['boss:king_monkezilla', 3],
  ]);
  for (const z of ZONE_LIST) {
    for (const ch of z.chests || []) {
      if (ch.relics) actualRelicMap.set(`chest:${ch.id}`, ch.relics);
    }
    for (const tr of z.trainers || []) {
      const r = tr.victoryRelics !== undefined ? tr.victoryRelics : tr.isWarden ? 2 : 0;
      if (r > 0) actualRelicMap.set(`trainer:${tr.id}`, r);
    }
  }
  for (const [, spec] of mapEntries) {
    for (const ch of spec.chests || []) {
      if (ch.relics) actualRelicMap.set(`chest:${ch.id}`, ch.relics);
    }
    for (const wp of spec.warps || []) {
      if (wp.grantRelics) actualRelicMap.set(wp.relicId || `warp:${wp.id}`, wp.grantRelics);
    }
    for (const st of spec.stations || []) {
      if (st.grantRelics) actualRelicMap.set(st.relicId || `st:${st.id}`, st.grantRelics);
      if (st.storyScene) assert.ok(buildStoryScene(st.storyScene, 'ALEX'), `Missing scene ${st.storyScene}`);
      if (st.healedStoryScene) {
        assert.ok(buildStoryScene(st.healedStoryScene, 'ALEX'), `Missing scene ${st.healedStoryScene}`);
      }
      if (st.joinCompanion) assert.ok(GUEST_COMPANIONS[st.joinCompanion], `Missing companion ${st.joinCompanion}`);
      if (st.trainerDef) {
        const tr = st.trainerDef;
        const r = tr.victoryRelics !== undefined ? tr.victoryRelics : tr.isWarden ? 2 : 0;
        if (r > 0) actualRelicMap.set(`trainer:${tr.id}`, r);
        if (tr.preBattleScene) assert.ok(buildStoryScene(tr.preBattleScene, 'ALEX'), `Missing scene ${tr.preBattleScene}`);
        if (tr.postVictoryScene) assert.ok(buildStoryScene(tr.postVictoryScene, 'ALEX'), `Missing scene ${tr.postVictoryScene}`);
        if (tr.postVictoryJoinCompanion) {
          assert.ok(GUEST_COMPANIONS[tr.postVictoryJoinCompanion], `Missing companion ${tr.postVictoryJoinCompanion}`);
        }
      }
    }
  }
  const actualTotal = [...actualRelicMap.values()].reduce((a, b) => a + b, 0);
  assert.equal(actualTotal, 77, `Expected obtainable Relics across Worlds to equal 77, got ${actualTotal}`);
  for (const entry of WORLD_RELIC_LEDGER) {
    assert.equal(
      actualRelicMap.get(entry.id),
      entry.count,
      `Ledger mismatch on ${entry.id}: expected ${entry.count}, got ${actualRelicMap.get(entry.id)}`,
    );
  }

  const st = createInitialGameState('ALEX', 'mugchimp');
  assert.equal(st.bananaRelics, 1, 'New Game starts with Dad’s Night-1 Prism Relic (#1/77)');
  assert.ok(st.collectedRelicIds.includes('relic:dad_prism'));
  assert.ok(st.keyItems.includes('prism_detector'));
  assert.equal(getActiveStoryChapter(st).chapter, 1);

  const sunpalmStatus = getZoneRelicStatus(st, 'sunpalm');
  assert.equal(sunpalmStatus.total, 14);
  assert.equal(sunpalmStatus.found, 1);
  assert.equal(sunpalmStatus.remaining, 13);

  const addedClassmates = recruitSchoolClassmates(st);
  assert.equal(addedClassmates, 3);
  assert.equal(st.party.length, 4, 'Sensei Bob recruits 3 classmates for a 4-Monkemon squad');

  st.guestCompanion = 'sensei_bob';
  assert.equal(getGuestCompanion(st).name, 'Sensei Bob');

  const prog = grantStoryProgress(st, {
    relics: 3,
    relicId: 'test_relic_1',
    keyItem: 'mini_shrinker',
    flag: 'cleared_north_cave',
  });
  assert.equal(prog.addedRelics, 3);
  assert.equal(st.bananaRelics, 4);
  assert.ok(st.keyItems.includes('mini_shrinker'));
  assert.ok(KEY_ITEMS_META.mini_shrinker);
  assert.ok(KEY_ITEMS_META.goddess_heart);
  assert.ok(KEY_ITEMS_META.seven_blade);
  assert.equal(getActiveStoryChapter(st).chapter, 2);
  // Idempotent relicId guard
  const dupProg = grantStoryProgress(st, { relics: 3, relicId: 'test_relic_1' });
  assert.equal(dupProg.addedRelics, 0);
  assert.equal(st.bananaRelics, 4);

  // Generic genre descriptors check: zero trademarked franchise/boss titles in tracked source files
  const pat = Buffer.from('XGIoZmluYWxccypmYW50YXN5fGZmbDI/fHNhZ2F8c3F1YXJlXHMqZW5peHxhc2h1cmF8YXBvbGxvfG9kaW58dmFsaGFsbGF8ZXhjYWxpYnVyKVxi', 'base64').toString('utf8');
  const forbidden = new RegExp(pat, 'i');
  const checkFiles = [
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'src', 'main.js'),
    ...fs.readdirSync(path.join(ROOT, 'src', 'data')).map((f) => path.join(ROOT, 'src', 'data', f)),
    ...fs.readdirSync(path.join(ROOT, 'src', 'engine')).map((f) => path.join(ROOT, 'src', 'engine', f)),
    ...fs.readdirSync(path.join(ROOT, 'src', 'game')).map((f) => path.join(ROOT, 'src', 'game', f)),
  ].filter((p) => p.endsWith('.js') || p.endsWith('.html'));
  for (const fp of checkFiles) {
    const txt = fs.readFileSync(fp, 'utf8');
    const m = txt.match(forbidden);
    assert.equal(m, null, `Forbidden reference term "${m && m[0]}" found in ${path.relative(ROOT, fp)}`);
  }
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
    'createStreamChannelShaderMaterial',
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

test('Attack damage math reliably reduces HP for both positional and object call signatures', () => {
  const attacker = createMonkemonInstance('mugchimp', 8);
  const defender = createMonkemonInstance('puppuchin', 6);
  const initialEnemyHp = defender.hp;

  for (const move of getBattleMoves(attacker)) {
    const posHit = calculateHitDamage(attacker, defender, move, {
      rng: 0.45,
      comboMult: 1.08,
      attackerBuffed: true,
    });
    const objHit = calculateHitDamage({
      attacker,
      defender,
      move,
      rng: 0.45,
      comboMult: 1.08,
      atkBuffed: true,
    });
    assert.ok(Number.isFinite(posHit.damage) && posHit.damage >= 2, `Invalid positional damage for ${move.id}`);
    assert.equal(posHit.damage, objHit.damage, `Positional and object damage must match for ${move.id}`);
  }

  const strike = calculateHitDamage(attacker, defender, MOVES.monk_run, { rng: 0.5 });
  const dmg = Math.max(4, Math.round(strike.damage * 1.15));
  defender.hp = Math.max(0, Math.round(defender.hp - dmg));
  assert.ok(defender.hp < initialEnemyHp, 'Defender HP must decrease after taking an attack');
});

test('All 63 TRELLIS.2-4B .glb 3D assets exist at hero quality (2048px PBR textures) and every source .glb reference resolves', () => {
  const manifestFiles = [
    'monkemon_assets_manifest.json',
    'monkemon_sticky_spec_manifest.json',
    'monkemon_environment_manifest.json',
    'monkemon_props_interiors_manifest.json',
  ];
  const manifestIds = new Set();
  for (const mf of manifestFiles) {
    const manifestPath = path.join(ROOT, 'tools', mf);
    assert.ok(fs.existsSync(manifestPath), `Missing TRELLIS.2 manifest: ${mf}`);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const asset of parsed.assets || []) {
      manifestIds.add(asset.id);
      assert.equal(asset.preset, 'hero', `Expected hero preset for ${asset.id} in ${mf}`);
      assert.ok((asset.texture_size || 2048) >= 2048, `Expected >=2048px texture_size for ${asset.id}`);

      const glbPath = path.join(ROOT, 'assets', 'models', `${asset.id}.glb`);
      const metaPath = path.join(ROOT, 'assets', 'models', `${asset.id}.meta.json`);
      assert.ok(fs.existsSync(glbPath), `Missing TRELLIS.2 .glb on disk: ${glbPath}`);
      assert.ok(fs.statSync(glbPath).size > 200_000, `Expected high-quality PBR .glb >200KB for ${asset.id}`);
      assert.ok(fs.existsSync(metaPath), `Missing TRELLIS.2 .meta.json for ${asset.id}`);

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const metaPreset = meta.preset || meta.params?.preset;
      const metaTexSize = meta.postprocessing?.texture_size || meta.texture_size || 0;
      const metaTris = meta.glb?.triangle_count || meta.triangles || 0;
      assert.equal(meta.model, 'microsoft/TRELLIS.2-4B', `Expected TRELLIS.2-4B model on ${asset.id}`);
      assert.equal(metaPreset, 'hero', `Expected .meta.json preset="hero" on ${asset.id}, got ${metaPreset}`);
      assert.ok(metaTexSize >= 2048, `Expected .meta.json texture_size >= 2048 on ${asset.id}, got ${metaTexSize}`);
      assert.ok(metaTris >= 8000, `Expected high-detail mesh triangles on ${asset.id}, got ${metaTris}`);
    }
  }
  assert.equal(manifestIds.size, 63, `Expected 63 total bespoke TRELLIS.2 3D assets, got ${manifestIds.size}`);

  // Verify every `assets/models/*.glb` reference across src/ exists on disk
  const srcDirs = ['data', 'engine', 'game'];
  const glbRefRegex = /assets\/models\/([a-z0-9_]+\.glb)/g;
  const referencedGlbs = new Set();
  for (const dir of srcDirs) {
    for (const f of fs.readdirSync(path.join(ROOT, 'src', dir))) {
      if (!f.endsWith('.js')) continue;
      const content = fs.readFileSync(path.join(ROOT, 'src', dir, f), 'utf8');
      for (const match of content.matchAll(glbRefRegex)) {
        referencedGlbs.add(match[1]);
      }
    }
  }
  assert.ok(referencedGlbs.size >= 55, `Expected comprehensive .glb coverage in src/, found ${referencedGlbs.size}`);
  for (const glbName of referencedGlbs) {
    const p = path.join(ROOT, 'assets', 'models', glbName);
    assert.ok(fs.existsSync(p), `Broken .glb reference in src/: assets/models/${glbName}`);
  }
});
