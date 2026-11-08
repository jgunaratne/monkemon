// Map-Inspired 2.5D Cutaway Interior, Town, Shrine, Cave, Tower, Castle & Dungeon Builder!
// Converts every floorplan in `src/data/interior_maps.js` into a rich walkable 3D diorama
// with cutaway outer walls, low interior corridor partitions, animated GLSL water & magma,
// bridges, raised daises, Oasis Heal Pads (`+`), Derby Turbo Strips (`>`), 3D Chests,
// Sub-Area Stair/Portal Warps, Jukeboxes, Bosses, Story NPCs, and Battle Clearance!

import * as THREE from 'three';
import { getInteriorMapSpec } from '../data/interior_maps.js';
import { makeLabelSprite } from './model_loader.js';
import { createStreamChannelShaderMaterial, createSunbeamShaderMaterial } from './shaders.js';

const ASSET_VERSION = '20261108hq';
const _texLoader = new THREE.TextureLoader();

function loadTexPair(baseName, rx = 4, ry = 4) {
  const map = _texLoader.load(`assets/textures/${baseName}.jpg?v=${ASSET_VERSION}`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, ry);
  map.anisotropy = 8;

  const normalMap = _texLoader.load(`assets/textures/${baseName}_normal.jpg?v=${ASSET_VERSION}`);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, ry);
  normalMap.anisotropy = 8;
  return { map, normalMap };
}

const THEME_STYLES = {
  cottage: {
    floorTex: 'wood_timber',
    floorTint: '#f3d5b5',
    wallColor: '#fef3c7',
    partColor: '#d97706',
    trimColor: '#92400e',
    rugColor: '#dc2626',
    rugTrim: '#fde047',
    daisColor: '#b45309',
    bgSky: '#10192b',
    lightColor: '#fde68a',
    waterColor: '#0ea5e9',
    hasWindows: true,
  },
  school: {
    floorTex: 'wood_timber',
    floorTint: '#f6dfbe',
    wallColor: '#fef9c3',
    partColor: '#b45309',
    trimColor: '#1e3a8a',
    rugColor: '#2563eb',
    rugTrim: '#fde047',
    daisColor: '#78350f',
    bgSky: '#0f172a',
    lightColor: '#fef08a',
    waterColor: '#38bdf8',
    hasWindows: true,
  },
  town: {
    floorTex: 'grass_meadow',
    floorTint: '#bbf7d0',
    wallColor: '#e2e8f0',
    partColor: '#94a3b8',
    trimColor: '#475569',
    rugColor: '#cbd5e1',
    rugTrim: '#fde68a',
    daisColor: '#64748b',
    bgSky: '#0c2438',
    lightColor: '#fef3c7',
    waterColor: '#0ea5e9',
    hasWindows: false,
  },
  cave: {
    floorTex: 'cliff_rock',
    floorTint: '#a8a29e',
    wallColor: '#44403c',
    partColor: '#57534e',
    trimColor: '#292524',
    rugColor: '#78716c',
    rugTrim: '#d6d3d1',
    daisColor: '#57534e',
    bgSky: '#0c0a09',
    lightColor: '#fdba74',
    waterColor: '#0284c7',
    isRockWall: true,
  },
  shrine: {
    floorTex: 'harbor_stone',
    floorTint: '#f0f9ff',
    wallColor: '#e0f2fe',
    partColor: '#bae6fd',
    trimColor: '#0284c7',
    rugColor: '#0ea5e9',
    rugTrim: '#fde047',
    daisColor: '#e2e8f0',
    bgSky: '#081e36',
    lightColor: '#7dd3fc',
    waterColor: '#2dd4bf',
    hasWindows: true,
  },
  biosanctum: {
    floorTex: 'sand_beach',
    floorTint: '#fbcfe8',
    wallColor: '#9d174d',
    partColor: '#be185d',
    trimColor: '#500724',
    rugColor: '#f472b6',
    rugTrim: '#fde047',
    daisColor: '#db2777',
    bgSky: '#240515',
    lightColor: '#f9a8d4',
    waterColor: '#34d399',
  },
  ruins: {
    floorTex: 'sand_beach',
    floorTint: '#fde68a',
    wallColor: '#d97706',
    partColor: '#b45309',
    trimColor: '#78350f',
    rugColor: '#92400e',
    rugTrim: '#facc15',
    daisColor: '#b45309',
    bgSky: '#191106',
    lightColor: '#fcd34d',
    waterColor: '#0ea5e9',
  },
  fortress: {
    floorTex: 'cliff_rock',
    floorTint: '#cbd5e1',
    wallColor: '#475569',
    partColor: '#64748b',
    trimColor: '#1e293b',
    rugColor: '#b91c1c',
    rugTrim: '#facc15',
    daisColor: '#334155',
    bgSky: '#0f172a',
    lightColor: '#fca5a5',
    waterColor: '#0284c7',
  },
  peanut_dojo: {
    floorTex: 'wood_timber',
    floorTint: '#f5cb86',
    wallColor: '#fde68a',
    partColor: '#d97706',
    trimColor: '#78350f',
    rugColor: '#d97706',
    rugTrim: '#fef08a',
    daisColor: '#92400e',
    bgSky: '#17120b',
    lightColor: '#fbbf24',
    waterColor: '#0ea5e9',
    hasWindows: true,
  },
  desert_tower: {
    floorTex: 'sand_beach',
    floorTint: '#fed7aa',
    wallColor: '#ea580c',
    partColor: '#c2410c',
    trimColor: '#7c2d12',
    rugColor: '#b91c1c',
    rugTrim: '#fde047',
    daisColor: '#9a3412',
    bgSky: '#1e0f07',
    lightColor: '#fdba74',
    waterColor: '#0ea5e9',
  },
  giant_house: {
    floorTex: 'harbor_stone',
    floorTint: '#fde68a',
    wallColor: '#fef3c7',
    partColor: '#92400e',
    trimColor: '#78350f',
    rugColor: '#f59e0b',
    rugTrim: '#ffffff',
    daisColor: '#78350f',
    bgSky: '#161108',
    lightColor: '#fde047',
    waterColor: '#38bdf8',
    hasWindows: true,
    isGiant: true,
  },
  palace: {
    floorTex: 'harbor_stone',
    floorTint: '#ffffff',
    wallColor: '#fef9c3',
    partColor: '#fde047',
    trimColor: '#ca8a04',
    rugColor: '#dc2626',
    rugTrim: '#facc15',
    daisColor: '#fef08a',
    bgSky: '#17152b',
    lightColor: '#fef08a',
    waterColor: '#38bdf8',
    hasWindows: true,
  },
  fish_dojo: {
    floorTex: 'harbor_stone',
    floorTint: '#bae6fd',
    wallColor: '#e0f2fe',
    partColor: '#0284c7',
    trimColor: '#0369a1',
    rugColor: '#0284c7',
    rugTrim: '#7dd3fc',
    daisColor: '#075985',
    bgSky: '#081a2c',
    lightColor: '#38bdf8',
    waterColor: '#0ea5e9',
    hasWindows: true,
  },
  volcano_dungeon: {
    floorTex: 'volcano_basalt',
    floorTint: '#78716c',
    wallColor: '#292524',
    partColor: '#44403c',
    trimColor: '#991b1b',
    rugColor: '#7f1d1d',
    rugTrim: '#fb923c',
    daisColor: '#451a03',
    bgSky: '#1a0606',
    lightColor: '#fb923c',
    waterColor: '#f97316',
    isRockWall: true,
  },
  sewer: {
    floorTex: 'cliff_rock',
    floorTint: '#94a3b8',
    wallColor: '#334155',
    partColor: '#475569',
    trimColor: '#1e293b',
    rugColor: '#64748b',
    rugTrim: '#cbd5e1',
    daisColor: '#475569',
    bgSky: '#061318',
    lightColor: '#67e8f9',
    waterColor: '#10b981',
  },
  race_track: {
    floorTex: 'volcano_basalt',
    floorTint: '#94a3b8',
    wallColor: '#e2e8f0',
    partColor: '#ef4444',
    trimColor: '#dc2626',
    rugColor: '#f8fafc',
    rugTrim: '#1e293b',
    daisColor: '#facc15',
    bgSky: '#0c2340',
    lightColor: '#f8fafc',
    waterColor: '#38bdf8',
  },
  pork_dojo: {
    floorTex: 'wood_timber',
    floorTint: '#e7c6a5',
    wallColor: '#ffedd5',
    partColor: '#9a3412',
    trimColor: '#7c2d12',
    rugColor: '#ea580c',
    rugTrim: '#fed7aa',
    daisColor: '#7c2d12',
    bgSky: '#141926',
    lightColor: '#fdba74',
    waterColor: '#2dd4bf',
    hasWindows: true,
  },
  moon_rooftop: {
    floorTex: 'volcano_basalt',
    floorTint: '#64748b',
    wallColor: '#1e293b',
    partColor: '#334155',
    trimColor: '#991b1b',
    rugColor: '#475569',
    rugTrim: '#fde047',
    daisColor: '#1e293b',
    bgSky: '#070b1e',
    lightColor: '#bae6fd',
    waterColor: '#1d4ed8',
    isMoonlit: true,
  },
  cloud_palace: {
    floorTex: 'harbor_stone',
    floorTint: '#f8fafc',
    wallColor: '#f1f5f9',
    partColor: '#e2e8f0',
    trimColor: '#60a5fa',
    rugColor: '#3b82f6',
    rugTrim: '#fde047',
    daisColor: '#dbeafe',
    bgSky: '#090d26',
    lightColor: '#bfdbfe',
    waterColor: '#1e3a8a',
    isCelestial: true,
  },
  beef_dojo: {
    floorTex: 'volcano_basalt',
    floorTint: '#a8a29e',
    wallColor: '#44403c',
    partColor: '#57534e',
    trimColor: '#b91c1c',
    rugColor: '#991b1b',
    rugTrim: '#facc15',
    daisColor: '#7f1d1d',
    bgSky: '#1a0909',
    lightColor: '#fb923c',
    waterColor: '#f97316',
    hasWindows: true,
  },
  starlight_shrine: {
    floorTex: 'harbor_stone',
    floorTint: '#e0f2fe',
    wallColor: '#c7d2fe',
    partColor: '#818cf8',
    trimColor: '#facc15',
    rugColor: '#6366f1',
    rugTrim: '#fef08a',
    daisColor: '#fef08a',
    bgSky: '#050616',
    lightColor: '#fef08a',
    waterColor: '#1e1b4b',
    isCelestial: true,
  },
};

const WALKABLE_TILES = new Set(['.', '=', 'D', '+', '>']);

export function buildHouseInteriorDiorama(houseDef, zone, modelBank, state = null) {
  const spec = getInteriorMapSpec(houseDef);
  const cfg = THEME_STYLES[spec.theme] || THEME_STYLES.cottage;
  const rows = spec.grid.length;
  const cols = spec.grid[0].length;
  const ts = spec.tileSize || 1.26;
  const halfW = (cols * ts) * 0.5;
  const halfD = (rows * ts) * 0.5;
  const isSoftwareGl = Boolean(modelBank && modelBank.isSoftwareGl);

  const group = new THREE.Group();
  const colliders = [];
  const animated = [];
  const labelSprites = [];
  const stations = [];
  const chestInteractables = [];
  const warpInteractables = [];
  const healPads = [];
  const boostPads = [];
  const clearableProps = [];
  const loadPromises = [];

  const registerClearable = (obj, x, z) => {
    clearableProps.push({ obj, x, z });
  };

  const tileToWorld = (col, row) => ({
    x: (col + 0.5 - cols * 0.5) * ts,
    z: (row + 0.5 - rows * 0.5) * ts,
  });

  const worldToTile = (x, z) => ({
    col: Math.floor(x / ts + cols * 0.5),
    row: Math.floor(z / ts + rows * 0.5),
  });

  const getTileChar = (col, row) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return '#';
    return spec.grid[row][col];
  };

  const isWalkableTile = (col, row) => WALKABLE_TILES.has(getTileChar(col, row));

  const floorPair = loadTexPair(cfg.floorTex, Math.max(3, Math.round(cols * 0.45)), Math.max(3, Math.round(rows * 0.45)));
  const woodPair = loadTexPair('wood_timber', 2, 2);
  const stonePair = loadTexPair('cliff_rock', 2, 2);

  // 1. Base Plinth & Main Floor Slab
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 1.2, 0.9, halfD * 2 + 1.2),
    new THREE.MeshStandardMaterial({
      map: stonePair.map,
      normalMap: stonePair.normalMap,
      color: cfg.trimColor,
      roughness: 0.72,
    }),
  );
  plinth.position.y = -0.52;
  group.add(plinth);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2, 0.22, halfD * 2),
    new THREE.MeshStandardMaterial({
      map: floorPair.map,
      normalMap: floorPair.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: cfg.floorTint,
      roughness: cfg.isGiant ? 0.38 : 0.58,
      metalness: cfg.isCelestial ? 0.1 : 0.02,
    }),
  );
  floor.position.y = -0.11;
  floor.receiveShadow = !isSoftwareGl;
  group.add(floor);

  // Giant Manor oversized checkerboard floor overlay!
  if (cfg.isGiant) {
    const checkDark = new THREE.MeshStandardMaterial({ color: '#d97706', roughness: 0.45 });
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if ((r + c) % 2 === 0 && WALKABLE_TILES.has(getTileChar(c, r))) {
          const p = tileToWorld(c, r);
          const tileMesh = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.96, 0.024, ts * 0.96), checkDark);
          tileMesh.position.set(p.x, 0.018, p.z);
          group.add(tileMesh);
        }
      }
    }
  }

  // Shared Tile Materials
  const outerWallMat = new THREE.MeshStandardMaterial({ color: cfg.wallColor, roughness: 0.76 });
  const partWallMat = new THREE.MeshStandardMaterial({
    map: cfg.isRockWall ? stonePair.map : null,
    normalMap: cfg.isRockWall ? stonePair.normalMap : null,
    color: cfg.partColor,
    roughness: 0.68,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    map: woodPair.map,
    normalMap: woodPair.normalMap,
    color: cfg.trimColor,
    roughness: 0.55,
  });
  const rugMat = new THREE.MeshStandardMaterial({ color: cfg.rugColor, roughness: 0.74 });
  const rugTrimMat = new THREE.MeshStandardMaterial({ color: cfg.rugTrim, roughness: 0.55 });
  const daisMat = new THREE.MeshStandardMaterial({
    map: stonePair.map,
    normalMap: stonePair.normalMap,
    color: cfg.daisColor,
    roughness: 0.5,
  });

  let waterShaderMat = null;
  let lavaShaderMat = null;

  const ensureWaterMat = () => {
    if (!waterShaderMat) {
      waterShaderMat = createStreamChannelShaderMaterial({
        waterColor: cfg.waterColor || '#0ea5e9',
        deepColor: cfg.isCelestial ? '#090d26' : '#082f49',
        skyColor: '#bae6fd',
        fogColor: cfg.bgSky,
        fogNear: 130,
        fogFar: 240,
        clipToCoast: false,
        theme: 'tropical',
      });
      animated.push((t) => {
        waterShaderMat.uniforms.uTime.value = t;
      });
    }
    return waterShaderMat;
  };

  const ensureLavaMat = () => {
    if (!lavaShaderMat) {
      lavaShaderMat = createStreamChannelShaderMaterial({
        waterColor: '#f97316',
        deepColor: '#450a0a',
        skyColor: '#fdba74',
        fogColor: cfg.bgSky,
        fogNear: 130,
        fogFar: 240,
        clipToCoast: false,
        theme: 'volcano',
      });
      animated.push((t) => {
        lavaShaderMat.uniforms.uTime.value = t;
      });
    }
    return lavaShaderMat;
  };

  const healPadMat = new THREE.MeshStandardMaterial({
    color: '#4ade80',
    emissive: '#22c55e',
    emissiveIntensity: 0.9,
    roughness: 0.25,
  });
  const boostPadMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#0ea5e9',
    emissiveIntensity: 0.95,
    roughness: 0.2,
  });
  animated.push((t) => {
    const pulse = 0.65 + 0.45 * Math.sin(t * 4.2);
    healPadMat.emissiveIntensity = pulse;
    boostPadMat.emissiveIntensity = 0.75 + 0.45 * Math.cos(t * 6.0);
  });

  // 2. Render Every Tile in `spec.grid`!
  const outerWallH = cfg.isMoonlit || cfg.isCelestial ? 1.15 : 3.65;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = spec.grid[r][c];
      const { x, z } = tileToWorld(c, r);
      const isNorthEdge = r === 0;
      const isSouthEdge = r === rows - 1;
      const isSideEdge = c === 0 || c === cols - 1;

      if (ch === '#') {
        if (isSouthEdge) {
          // Low cutaway front curb so the 2.5D camera has unobstructed framing!
          const curb = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.01, 0.44, ts * 0.52), trimMat);
          curb.position.set(x, 0.22, z + ts * 0.2);
          group.add(curb);
        } else if (isNorthEdge || isSideEdge) {
          const wMesh = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.02, outerWallH, ts * 1.02), outerWallMat);
          wMesh.position.set(x, outerWallH * 0.5, z);
          const crown = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.06, 0.24, ts * 1.06), trimMat);
          crown.position.set(x, outerWallH + 0.06, z);
          group.add(wMesh, crown);
        } else if (cfg.isRockWall) {
          // TRELLIS.2 sculpted cavern boulder / stalagmite formation (`int_rock_boulder.glb`)!
          const rockActor = modelBank.spawnActor({
            glbUrl: 'assets/models/int_rock_boulder.glb',
            scale: ts * 1.18,
            primaryColor: '#57534e',
            secondaryColor: '#f59e0b',
            shadowRadius: ts * 0.45,
            standInKind: 'prop',
          });
          rockActor.root.position.set(x, 0, z);
          rockActor.animRoot.rotation.y = ((r * 7 + c * 13) % 8) * (Math.PI * 0.25);
          group.add(rockActor.root);
          loadPromises.push(rockActor.readyPromise);
          registerClearable(rockActor.root, x, z);
        } else if (spec.theme === 'race_track') {
          // Red & White Grand Prix Chicane Tire/Curb Barrier!
          const barrier = new THREE.Mesh(
            new THREE.BoxGeometry(ts * 0.94, 0.68, ts * 0.94),
            (r + c) % 2 === 0 ? partWallMat : outerWallMat,
          );
          barrier.position.set(x, 0.34, z);
          group.add(barrier);
          registerClearable(barrier, x, z);
        } else {
          // Interior architectural partition wall / moat parapet
          const partH = 1.42;
          const part = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.96, partH, ts * 0.96), partWallMat);
          part.position.set(x, partH * 0.5, z);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.0, 0.16, ts * 1.0), trimMat);
          cap.position.set(x, partH + 0.04, z);
          const holder = new THREE.Group();
          holder.add(part, cap);
          group.add(holder);
          registerClearable(holder, x, z);
        }
      } else if (ch === '=') {
        // Walkable Carpet / Bridge / Giant Bookcase Step-Ramp!
        const overLiquid =
          getTileChar(c - 1, r) === '~' ||
          getTileChar(c + 1, r) === '~' ||
          getTileChar(c, r - 1) === '~' ||
          getTileChar(c, r + 1) === '~' ||
          getTileChar(c - 1, r) === '^' ||
          getTileChar(c + 1, r) === '^';
        if (cfg.isGiant && c >= 11 && r <= 3) {
          // Giant Manor climbable wooden bookcase step-ramp!
          const stepH = r === 3 ? 0.34 : 0.68;
          const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.96, stepH, ts * 0.96), trimMat);
          stepMesh.position.set(x, stepH * 0.5, z);
          group.add(stepMesh);
        } else if (overLiquid) {
          const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.98, 0.14, ts * 0.98), trimMat);
          bridgeDeck.position.set(x, 0.08, z);
          const railTrim = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.88, 0.04, ts * 0.88), rugTrimMat);
          railTrim.position.set(x, 0.16, z);
          group.add(bridgeDeck, railTrim);
        } else {
          const trimPad = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.98, 0.026, ts * 0.98), rugTrimMat);
          trimPad.position.set(x, 0.018, z);
          const innerPad = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.84, 0.026, ts * 0.84), rugMat);
          innerPad.position.set(x, 0.046, z);
          group.add(trimPad, innerPad);
        }
      } else if (ch === 'D') {
        const dais = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.0, 0.24, ts * 1.0), daisMat);
        dais.position.set(x, 0.12, z);
        const topRug = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.88, 0.028, ts * 0.88), rugTrimMat);
        topRug.position.set(x, 0.258, z);
        group.add(dais, topRug);
      } else if (ch === '~') {
        const basin = new THREE.Mesh(
          new THREE.BoxGeometry(ts * 1.0, 0.05, ts * 1.0),
          new THREE.MeshStandardMaterial({ color: '#082f49', roughness: 0.9 }),
        );
        basin.position.set(x, 0.01, z);
        const surf = new THREE.Mesh(new THREE.PlaneGeometry(ts * 0.99, ts * 0.99, 2, 2), ensureWaterMat());
        surf.rotation.x = -Math.PI / 2;
        surf.position.set(x, 0.09, z);
        group.add(basin, surf);
      } else if (ch === '^') {
        const basin = new THREE.Mesh(
          new THREE.BoxGeometry(ts * 1.0, 0.05, ts * 1.0),
          new THREE.MeshStandardMaterial({ color: '#450a0a', roughness: 0.9 }),
        );
        basin.position.set(x, 0.01, z);
        const surf = new THREE.Mesh(new THREE.PlaneGeometry(ts * 0.99, ts * 0.99, 2, 2), ensureLavaMat());
        surf.rotation.x = -Math.PI / 2;
        surf.position.set(x, 0.09, z);
        group.add(basin, surf);
      } else if (ch === '+') {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(ts * 0.44, ts * 0.48, 0.08, 20), healPadMat);
        ring.position.set(x, 0.05, z);
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.24, 0),
          new THREE.MeshBasicMaterial({ color: '#bbf7d0' }),
        );
        core.position.set(x, 0.36, z);
        animated.push((t) => {
          core.rotation.y = t * 2.2;
          core.position.y = 0.36 + Math.sin(t * 3.4) * 0.08;
        });
        group.add(ring, core);
        healPads.push({ x, z, r: ts * 0.55 });
      } else if (ch === '>') {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(ts * 0.88, 0.05, ts * 0.72), boostPadMat);
        pad.position.set(x, 0.032, z);
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(ts * 0.45, 0.028, ts * 0.28),
          new THREE.MeshBasicMaterial({ color: '#fde047' }),
        );
        stripe.position.set(x, 0.074, z);
        group.add(pad, stripe);
        boostPads.push({ x, z, r: ts * 0.62 });
      } else if (ch === 'P') {
        const pillarActor = modelBank.spawnActor({
          glbUrl: 'assets/models/int_temple_pillar.glb',
          scale: cfg.isGiant ? 2.85 : 2.18,
          primaryColor: '#f8fafc',
          secondaryColor: '#facc15',
          shadowRadius: ts * 0.36,
          standInKind: 'prop',
        });
        pillarActor.root.position.set(x, 0, z);
        group.add(pillarActor.root);
        loadPromises.push(pillarActor.readyPromise);
        registerClearable(pillarActor.root, x, z);
      } else if (ch === 'T') {
        const plantActor = modelBank.spawnActor({
          glbUrl: 'assets/models/int_potted_plant.glb',
          scale: 1.52,
          primaryColor: '#22c55e',
          secondaryColor: '#9a3412',
          shadowRadius: 0.45,
          standInKind: 'prop',
        });
        plantActor.root.position.set(x, 0, z);
        plantActor.animRoot.rotation.y = ((r * 5 + c * 3) % 4) * (Math.PI * 0.5);
        group.add(plantActor.root);
        loadPromises.push(plantActor.readyPromise);
        registerClearable(plantActor.root, x, z);
      } else if (ch === 'B') {
        const bedActor = modelBank.spawnActor({
          glbUrl: 'assets/models/int_cozy_bed.glb',
          scale: cfg.isGiant ? 2.15 : 1.48,
          primaryColor: '#ef4444',
          secondaryColor: '#fef3c7',
          shadowRadius: ts * 0.48,
          standInKind: 'prop',
        });
        bedActor.root.position.set(x, 0, z);
        group.add(bedActor.root);
        loadPromises.push(bedActor.readyPromise);
        registerClearable(bedActor.root, x, z);
      } else if (ch === 'K') {
        const bookcaseActor = modelBank.spawnActor({
          glbUrl: 'assets/models/int_bookcase.glb',
          scale: cfg.isGiant ? 2.95 : 2.12,
          primaryColor: '#92400e',
          secondaryColor: '#38bdf8',
          shadowRadius: ts * 0.46,
          standInKind: 'prop',
        });
        bookcaseActor.root.position.set(x, 0, z);
        bookcaseActor.animRoot.rotation.y = -Math.PI * 0.5;
        group.add(bookcaseActor.root);
        loadPromises.push(bookcaseActor.readyPromise);
        registerClearable(bookcaseActor.root, x, z);
      }
    }
  }

  // 3. Atmospheric Windows / Moonlit Sky / Celestial Spires!
  const sunbeamMat = createSunbeamShaderMaterial({ color: cfg.lightColor, opacity: 0.11 });
  if (cfg.hasWindows) {
    for (const wx of [-halfW * 0.52, halfW * 0.52]) {
      const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.16), trimMat);
      winFrame.position.set(wx, 2.35, -halfD + 0.14);
      const winPane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.85, 1.28),
        new THREE.MeshBasicMaterial({ color: spec.theme === 'beef_dojo' ? '#fb923c' : '#bae6fd' }),
      );
      winPane.position.set(wx, 2.35, -halfD + 0.24);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.35, 4.8, 14, 1, true), sunbeamMat);
      beam.position.set(wx + 0.35, 1.55, -halfD + 1.8);
      beam.rotation.z = -0.2;
      beam.rotation.x = 0.4;
      group.add(winFrame, winPane, beam);
    }
  }

  if (cfg.isMoonlit || cfg.isCelestial) {
    // Glowing Crescent Moon or Twin Starlight Spires on the Northern Horizon!
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 32),
      new THREE.MeshBasicMaterial({ color: '#fef08a' }),
    );
    moon.position.set(cfg.isMoonlit ? 4.2 : 0, 5.2, -halfD - 3.2);
    group.add(moon);

    if (cfg.isCelestial) {
      for (const side of [-1, 1]) {
        const spireActor = modelBank.spawnActor({
          glbUrl: 'assets/models/env_sky_vine_pillar.glb',
          scale: 5.2,
          primaryColor: '#fef08a',
          secondaryColor: '#facc15',
          shadowRadius: 1.2,
          standInKind: 'prop',
        });
        spireActor.root.position.set(side * (halfW * 0.62), 0, -halfD - 0.8);
        group.add(spireActor.root);
        loadPromises.push(spireActor.readyPromise);
      }
    }
  }

  const roomLight = new THREE.PointLight(cfg.lightColor, 2.6, Math.max(26, halfW * 2.6), 1.25);
  roomLight.position.set(0, 4.2, 0);
  group.add(roomLight);

  // 4. Entry Spawn & South Exit Doormat!
  const entryPos = tileToWorld(spec.entryTile[0], spec.entryTile[1]);
  const exitPos = tileToWorld(spec.exitTile[0], spec.exitTile[1]);

  // Only show outdoor Exit Doormat if `exitTile` does NOT already have a sub-area return warp
  const exitCoveredByWarp = (spec.warps || []).some(
    (wp) => wp.col === spec.exitTile[0] && wp.row === spec.exitTile[1],
  );
  let exitZone = null;
  if (!exitCoveredByWarp) {
    const exitBorder = new THREE.Mesh(new THREE.BoxGeometry(ts * 2.1, 0.028, ts * 1.1), rugTrimMat);
    exitBorder.position.set(exitPos.x, 0.018, exitPos.z);
    const exitMat = new THREE.Mesh(new THREE.BoxGeometry(ts * 1.9, 0.028, ts * 0.95), rugMat);
    exitMat.position.set(exitPos.x, 0.048, exitPos.z);
    group.add(exitBorder, exitMat);

    const exitSign = makeLabelSprite({
      title: `Exit to ${zone.name}`,
      subtitle: 'Walk South or press [A]',
      badgeText: '🚪 EXIT',
      badgeColor: '#fbbf24',
      widthWorld: 3.0,
    });
    exitSign.position.set(exitPos.x, 1.05, exitPos.z + 0.35);
    labelSprites.push(exitSign);
    group.add(exitSign);
    exitZone = { x: exitPos.x, z: exitPos.z, r: ts * 0.95 };
  }

  // 5. Sub-Area Staircase / Portal Warps (`spec.warps`)!
  for (const wp of spec.warps || []) {
    const pos = tileToWorld(wp.col, wp.row);
    const wy = getTileChar(wp.col, wp.row) === 'D' ? 0.24 : 0;
    const isLocked = Boolean(
      (wp.requireKeyItem && !(state?.keyItems || []).includes(wp.requireKeyItem)) ||
        (wp.requireFlag && !(state?.storyFlags || []).includes(wp.requireFlag)),
    );
    const padMat = new THREE.MeshStandardMaterial({
      color: isLocked ? '#94a3b8' : '#38bdf8',
      emissive: isLocked ? '#475569' : '#0ea5e9',
      emissiveIntensity: isLocked ? 0.3 : 0.85,
      roughness: 0.25,
    });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(ts * 0.54, ts * 0.6, 0.12, 24), padMat);
    pad.position.set(pos.x, wy + 0.06, pos.z);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(ts * 0.48, 0.08, 10, 24, Math.PI), trimMat);
    arch.position.set(pos.x, wy + 0.1, pos.z);
    group.add(pad, arch);

    const sign = makeLabelSprite({
      title: wp.label || 'Passage',
      subtitle: isLocked ? '🔒 Artifact Needed · [A] Inspect' : 'Walk In or press [A]',
      badgeText: wp.badgeText || '🪜 WARP',
      badgeColor: isLocked ? '#94a3b8' : '#38bdf8',
      widthWorld: 3.25,
    });
    sign.position.set(pos.x, wy + 1.45, pos.z);
    labelSprites.push(sign);
    group.add(sign);

    warpInteractables.push({
      ...wp,
      x: pos.x,
      z: pos.z,
      r: ts * 1.15,
      padMat,
      sign,
    });
  }

  // 6. 3D Treasure Chests (`spec.chests`)!
  for (const ch of spec.chests || []) {
    const pos = tileToWorld(ch.col, ch.row);
    const cy =
      cfg.isGiant && ch.col >= 11 && ch.row <= 3
        ? ch.row === 3
          ? 0.34
          : 0.68
        : getTileChar(ch.col, ch.row) === 'D'
          ? 0.24
          : 0;
    const alreadyOpened = Boolean((state?.openedChests || []).includes(ch.id));
    const chestActor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_treasure_chest.glb',
      scale: 1.25,
      primaryColor: ch.keyItem ? '#facc15' : '#f59e0b',
      secondaryColor: '#fde047',
      shadowRadius: 0.65,
    });
    chestActor.root.position.set(pos.x, cy, pos.z);
    group.add(chestActor.root);
    loadPromises.push(chestActor.readyPromise);
    registerClearable(chestActor.root, pos.x, pos.z);

    const glowMat = new THREE.MeshStandardMaterial({
      color: alreadyOpened ? '#64748b' : '#fde047',
      emissive: alreadyOpened ? '#1e293b' : '#f59e0b',
      emissiveIntensity: alreadyOpened ? 0.2 : 0.72,
      roughness: 0.26,
    });
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.062, 10, 26), glowMat);
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.set(pos.x, cy + 0.078, pos.z);
    group.add(glowRing);

    const sign = makeLabelSprite({
      title: ch.label || 'Relic Chest',
      subtitle: ch.relics ? `[A] Open (+${ch.relics} 🍌 Relic${ch.relics > 1 ? 's' : ''})` : '[A] Open Supply Chest',
      badgeText: ch.keyItem ? '🌟 KEY RELIC' : '🎁 CHEST',
      badgeColor: '#facc15',
      widthWorld: 3.1,
    });
    sign.position.set(pos.x, cy + 1.65, pos.z);
    sign.visible = !alreadyOpened;
    labelSprites.push(sign);
    group.add(sign);

    colliders.push({ x: pos.x, z: pos.z, r: 0.45 });
    chestInteractables.push({
      ...ch,
      x: pos.x,
      y: cy,
      z: pos.z,
      opened: alreadyOpened,
      glowRing,
      sign,
    });
  }

  // 7. Interactive Stations, Jukeboxes, Story NPCs, House Leaders & Dungeon Bosses (`spec.stations`)!
  for (const st of spec.stations || []) {
    const pos = tileToWorld(st.col, st.row);
    const sy = getTileChar(st.col, st.row) === 'D' ? 0.24 : 0;

    if (st.kind === 'heal' || st.kind === 'heal_station') {
      const holder = new THREE.Group();
      const healActor = modelBank.spawnActor({
        glbUrl: 'assets/models/int_healing_station.glb',
        scale: 1.98,
        primaryColor: '#4ade80',
        secondaryColor: '#f8fafc',
        shadowRadius: 0.88,
        standInKind: 'prop',
      });
      holder.add(healActor.root);
      loadPromises.push(healActor.readyPromise);

      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 10, 26), healPadMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.075;
      holder.add(halo);

      holder.position.set(pos.x, sy, pos.z);
      group.add(holder);
      registerClearable(holder, pos.x, pos.z);

      const lbl = makeLabelSprite({
        title: st.label || 'HEALING STATION',
        subtitle: '[A] Full Party Heal & Monkeballs',
        badgeText: '💚 HEAL',
        badgeColor: '#4ade80',
        widthWorld: 3.1,
      });
      lbl.position.set(pos.x, sy + 2.25, pos.z);
      labelSprites.push(lbl);
      group.add(lbl);

      colliders.push({ x: pos.x, z: pos.z, r: 0.68 });
      stations.push({
        ...st,
        id: st.id || `heal_${st.col}_${st.row}`,
        kind: 'heal',
        x: pos.x,
        z: pos.z,
        r: 2.35,
        prompt: `💚 [A / Space] Use ${st.label || 'Healing Station'} (100% HP & Monkeball Restock)`,
      });
    } else if (st.kind === 'pc') {
      const holder = new THREE.Group();
      const pcActor = modelBank.spawnActor({
        glbUrl: 'assets/models/int_party_pc.glb',
        scale: 1.85,
        primaryColor: '#38bdf8',
        secondaryColor: '#1e3a8a',
        shadowRadius: 0.65,
        standInKind: 'prop',
      });
      holder.add(pcActor.root);
      loadPromises.push(pcActor.readyPromise);
      holder.position.set(pos.x, sy, pos.z);
      group.add(holder);
      registerClearable(holder, pos.x, pos.z);

      const lbl = makeLabelSprite({
        title: 'PARTY & STORAGE PC',
        subtitle: '[A] Swap Squad & Lead Monkemon',
        badgeText: '💻 PC BOX',
        badgeColor: '#38bdf8',
        widthWorld: 3.0,
      });
      lbl.position.set(pos.x, sy + 2.2, pos.z);
      labelSprites.push(lbl);
      group.add(lbl);

      colliders.push({ x: pos.x, z: pos.z, r: 0.55 });
      stations.push({
        ...st,
        id: `pc_${st.col}_${st.row}`,
        kind: 'pc',
        x: pos.x,
        z: pos.z,
        r: 2.25,
        prompt: '💻 [A / Space] Access Sanctuary Party & Storage PC',
      });
    } else if (st.kind === 'shop') {
      const holder = new THREE.Group();
      const counterActor = modelBank.spawnActor({
        glbUrl: 'assets/models/int_mart_counter.glb',
        scale: 1.95,
        primaryColor: '#f59e0b',
        secondaryColor: '#ef4444',
        shadowRadius: 0.88,
        standInKind: 'prop',
      });
      holder.add(counterActor.root);
      loadPromises.push(counterActor.readyPromise);
      const clerk = modelBank.spawnActor({
        glbUrl: 'assets/models/trainer_scout.glb',
        scale: 1.48,
        primaryColor: '#38bdf8',
        secondaryColor: '#fde047',
        animateRig: true,
      });
      clerk.root.position.set(0, 0, -0.58);
      holder.add(clerk.root);
      loadPromises.push(clerk.readyPromise);
      holder.position.set(pos.x, sy, pos.z);
      group.add(holder);
      registerClearable(holder, pos.x, pos.z);
      animated.push((t, dt = 0.016) => {
        if (clerk.updateMotion) clerk.updateMotion(dt, { targetYaw: 0, moveSpeed: 0 });
      });

      const lbl = makeLabelSprite({
        title: 'MONKEBALL MART',
        subtitle: '[A] Super Balls, Berries & Treats',
        badgeText: '🛍️ SHOP',
        badgeColor: '#fbbf24',
        widthWorld: 3.0,
      });
      lbl.position.set(pos.x, sy + 2.45, pos.z);
      labelSprites.push(lbl);
      group.add(lbl);

      colliders.push({ x: pos.x, z: pos.z, r: 0.68 });
      stations.push({
        ...st,
        id: `shop_${st.col}_${st.row}`,
        kind: 'shop',
        x: pos.x,
        z: pos.z,
        r: 2.35,
        prompt: '🛍️ [A / Space] Browse Monkeball Mart & Treats Counter',
      });
    } else if (st.kind === 'jukebox') {
      const holder = new THREE.Group();
      const jukeActor = modelBank.spawnActor({
        glbUrl: 'assets/models/int_jukebox.glb',
        scale: 1.92,
        primaryColor: '#ef4444',
        secondaryColor: '#fde047',
        shadowRadius: 0.68,
        standInKind: 'prop',
      });
      holder.add(jukeActor.root);
      loadPromises.push(jukeActor.readyPromise);
      holder.position.set(pos.x, sy, pos.z);
      group.add(holder);
      registerClearable(holder, pos.x, pos.z);

      const lbl = makeLabelSprite({
        title: 'GUARDIAN JUKEBOX',
        subtitle: '[A] Play Heroic Anthem!',
        badgeText: '🎵 MUSIC',
        badgeColor: '#f472b6',
        widthWorld: 3.1,
      });
      lbl.position.set(pos.x, sy + 2.35, pos.z);
      labelSprites.push(lbl);
      group.add(lbl);

      colliders.push({ x: pos.x, z: pos.z, r: 0.52 });
      stations.push({
        ...st,
        id: 'guardian_jukebox',
        kind: 'jukebox',
        x: pos.x,
        z: pos.z,
        r: 2.35,
        prompt: '🎵 [A / Space] Play Guardian Anthem on the Jukebox!',
      });
    } else if (st.kind === 'lore') {
      const lecternActor = modelBank.spawnActor({
        glbUrl: 'assets/models/int_lore_lectern.glb',
        scale: 1.56,
        primaryColor: '#92400e',
        secondaryColor: '#fde047',
        shadowRadius: 0.52,
        standInKind: 'prop',
      });
      lecternActor.root.position.set(pos.x, sy, pos.z);
      group.add(lecternActor.root);
      loadPromises.push(lecternActor.readyPromise);
      registerClearable(lecternActor.root, pos.x, pos.z);
      const lbl = makeLabelSprite({
        title: st.label || 'TAMER JOURNAL',
        subtitle: '[A] Read Entry',
        badgeText: '📖 LORE',
        badgeColor: '#fde047',
        widthWorld: 2.8,
      });
      lbl.position.set(pos.x, sy + 1.95, pos.z);
      labelSprites.push(lbl);
      group.add(lbl);
      colliders.push({ x: pos.x, z: pos.z, r: 0.42 });
      stations.push({
        ...st,
        id: `lore_${st.col}_${st.row}`,
        kind: 'lore',
        x: pos.x,
        z: pos.z,
        r: 2.2,
        prompt: `📖 [A / Space] Read ${st.label || 'Journal'}`,
      });
    } else if (st.kind === 'mom' || st.kind === 'prof' || st.kind === 'npc' || st.kind === 'mount_rental') {
      const glbUrl =
        st.modelGlb ||
        (st.kind === 'mom' || st.kind === 'prof'
          ? 'assets/models/trainer_warden.glb'
          : 'assets/models/trainer_scout.glb');
      const actor = modelBank.spawnActor({
        glbUrl,
        scale: st.scale || (st.kind === 'mom' ? 1.64 : 1.66),
        primaryColor:
          st.kind === 'mom'
            ? '#f472b6'
            : st.kind === 'prof'
              ? '#38bdf8'
              : st.kind === 'mount_rental'
                ? '#f59e0b'
                : '#34d399',
        secondaryColor: '#fef3c7',
        animateRig: true,
      });
      actor.root.position.set(pos.x, sy, pos.z);
      const title =
        st.name || (st.kind === 'mom' ? "Alex's Mom" : st.kind === 'prof' ? 'Sensei Bob & Prof. Macaque' : 'Villager');
      const lbl = makeLabelSprite({
        title,
        subtitle: st.kind === 'mount_rental' ? '[A] Rent Derby Strider' : '[A] Talk',
        badgeText:
          st.badgeText ||
          (st.kind === 'mom'
            ? '🏠 MOM'
            : st.kind === 'prof'
              ? '🎓 SENSEI'
              : st.kind === 'mount_rental'
                ? '🐎 MOUNTS'
                : '💬 ALLY'),
        badgeColor: st.kind === 'mom' ? '#f472b6' : st.kind === 'mount_rental' ? '#f59e0b' : '#38bdf8',
        widthWorld: 3.3,
      });
      lbl.position.set(0, 2.3, 0);
      labelSprites.push(lbl);
      actor.root.add(lbl);
      group.add(actor.root);
      loadPromises.push(actor.readyPromise);
      registerClearable(actor.root, pos.x, pos.z);
      colliders.push({ x: pos.x, z: pos.z, r: 0.55 });
      animated.push((t, dt = 0.016) => {
        if (actor.updateMotion) actor.updateMotion(dt, { targetYaw: 0, moveSpeed: 0, cheer: 0.25 });
      });

      stations.push({
        ...st,
        id: st.id || `npc_${st.col}_${st.row}`,
        x: pos.x,
        z: pos.z,
        r: 2.5,
        prompt:
          st.kind === 'mount_rental'
            ? `🐎 [A / Space] Rent a Derby Strider Mount from ${title}`
            : `💬 [A / Space] Talk to ${title}`,
      });
    } else if (st.kind === 'warden' || st.kind === 'trainer') {
      let trainerDef = st.trainerDef;
      if (st.kind === 'warden') {
        const baseWarden =
          (zone.trainers || []).find((tr) => tr.id === st.wardenId) ||
          (zone.trainers || []).find((tr) => tr.isWarden);
        if (baseWarden) {
          trainerDef = {
            ...baseWarden,
            victoryRelics: st.victoryRelics || baseWarden.victoryRelics || 2,
          };
        }
      }
      if (trainerDef) {
        const defeated = Boolean((state?.defeatedTrainers || []).includes(trainerDef.id));
        const wActor = modelBank.spawnActor({
          glbUrl: 'assets/models/trainer_warden.glb',
          scale: 1.85,
          primaryColor: st.kind === 'warden' ? '#f59e0b' : '#ef4444',
          secondaryColor: '#fef3c7',
          animateRig: true,
        });
        wActor.root.position.set(pos.x, sy, pos.z);
        const wLbl = makeLabelSprite({
          title: trainerDef.name,
          subtitle: defeated ? '✓ Defeated · [A] Rematch!' : `${trainerDef.role || 'Boss'} · [A] Battle!`,
          badgeText: st.kind === 'warden' ? '🏅 HOUSE LEADER' : '👑 BOSS',
          badgeColor: defeated ? '#4ade80' : '#fbbf24',
          widthWorld: 3.7,
        });
        wLbl.position.set(0, 2.4, 0);
        labelSprites.push(wLbl);
        wActor.root.add(wLbl);
        group.add(wActor.root);
        loadPromises.push(wActor.readyPromise);
        registerClearable(wActor.root, pos.x, pos.z);
        colliders.push({ x: pos.x, z: pos.z, r: 0.62 });

        animated.push((t, dt = 0.016) => {
          if (wActor.updateMotion) wActor.updateMotion(dt, { targetYaw: 0, moveSpeed: 0, cheer: 0.35 });
        });

        stations.push({
          id: `boss_${trainerDef.id}`,
          kind: 'trainer',
          trainerDef,
          x: pos.x,
          z: pos.z,
          r: 2.75,
          prompt: `⚔️ [A / Space] Battle ${trainerDef.name} (${trainerDef.role || 'Leader'})!`,
        });
      }
    }
  }

  // Axis-separated smooth grid walkability resolver for 1-tile & multi-tile corridors!
  const isPointClearOnGrid = (wx, wz, pad = 0.34) => {
    const corners = [
      [wx - pad, wz - pad],
      [wx + pad, wz - pad],
      [wx - pad, wz + pad],
      [wx + pad, wz + pad],
    ];
    for (const [cx, cz] of corners) {
      const { col, row } = worldToTile(cx, cz);
      // Allow stepping half a tile south onto exitTile
      if (col === spec.exitTile[0] && row === spec.exitTile[1]) continue;
      if (!isWalkableTile(col, row)) return false;
    }
    return true;
  };

  const resolveTileWalk = (prevX, prevZ, nextX, nextZ, pad = 0.34) => {
    let rx = prevX;
    let rz = prevZ;
    if (isPointClearOnGrid(nextX, rz, pad)) {
      rx = nextX;
    }
    if (isPointClearOnGrid(rx, nextZ, pad)) {
      rz = nextZ;
    }
    return { x: rx, z: rz };
  };

  let _lastT = 0;
  return {
    isInterior: true,
    houseDef,
    mapSpec: spec,
    tileSize: ts,
    cols,
    rows,
    tileToWorld,
    worldToTile,
    resolveTileWalk,
    bounds: { halfW: halfW - 0.45, halfD: halfD - 0.35 },
    entrySpawn: { x: entryPos.x, z: entryPos.z },
    exitZone,
    skyColor: cfg.bgSky,
    fogColor: cfg.bgSky,
    group,
    colliders,
    stations,
    warpInteractables,
    healPads,
    boostPads,
    wildSpawns: spec.wildSpawns || [],
    houseInteractables: [],
    shrineInteractables: [],
    berryInteractables: [],
    chestInteractables,
    loadPromises,
    getHeightAt(x, z) {
      const { col, row } = worldToTile(x, z);
      const ch = getTileChar(col, row);
      if (cfg.isGiant && ch === '=' && col >= 11 && row <= 3) {
        return row === 3 ? 0.34 : 0.68;
      }
      if (ch === 'D') return 0.24;
      return 0;
    },
    setBattleClearance(cx, cz, radius = 6.2) {
      for (const item of clearableProps) {
        if (Math.hypot(item.x - cx, item.z - cz) < radius) {
          item.obj.visible = false;
        }
      }
    },
    clearBattleClearance() {
      for (const item of clearableProps) {
        item.obj.visible = true;
      }
    },
    setLabelsVisible(visible) {
      for (const sp of labelSprites) {
        if (sp === undefined) continue;
        sp.visible = visible;
      }
      // Keep opened chest labels hidden
      for (const ch of chestInteractables) {
        if (ch.opened && ch.sign) ch.sign.visible = false;
      }
    },
    setHeroPosition() {},
    update(timeSec, dt) {
      const stepDt = dt || Math.max(0.001, timeSec - _lastT);
      _lastT = timeSec;
      sunbeamMat.uniforms.uTime.value = timeSec;
      for (const fn of animated) fn(timeSec, stepDt);
    },
  };
}
