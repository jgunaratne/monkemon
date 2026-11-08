// 2.5D Realistic Archipelago Toy-Diorama Builder
// Constructs each of the 5 interconnected non-square islands with:
// - Organic multi-bay / peninsula coastlines (`computeCoastRadiusNorm` + `ExtrudeGeometry`)
// - Sloping sandy beaches, wet mossy coastal cliffs, elevated walkable terraces & 3D stone stairs
// - Flowing rivers / harbor canals / magma rifts spanned by walkable arched 3D bridges & piers
// - TRELLIS.2-4B `.glb` 3D trees, flora, fountains, lighthouses, gazebos, obelisks & supply chests
// - 1,150+ wind-swaying 5-blade curved 3D grass clumps (dense tall-grass wild habitats!)
// - Multi-layered Reactive GLSL Battle Stadium Shader Suite (`buildBattleArenaGroup`)

import * as THREE from 'three';
import { ASSET_VERSION } from './audio.js';
import { makeLabelSprite } from './model_loader.js';
import {
  attachCliffWetnessShader,
  attachFoliageSubsurfaceShader,
  attachTerrainDetailShader,
  attachWindGrassShader,
  computeCoastRadiusNorm,
  createBattleBarrierDomeShaderMaterial,
  createCombatantPadShaderMaterial,
  createHoloArenaShaderMaterial,
  createOceanMagmaShaderMaterial,
  createSunbeamShaderMaterial,
} from './shaders.js';

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
    return s / 0xffffffff;
  };
}

const _texLoader = new THREE.TextureLoader();
const _texCache = new Map();
let _cachedGrassClumpGeo = null;
let _cachedFernGeo = null;

function withVer(url) {
  return `${url}?v=${ASSET_VERSION}`;
}

function loadDedicatedPair(baseName, rx = 1, rz = 1) {
  const key = `ded:${baseName}:${rx}:${rz}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const map = _texLoader.load(withVer(`assets/textures/${baseName}.jpg`));
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, rz);
  map.anisotropy = 8;

  const normalMap = _texLoader.load(withVer(`assets/textures/${baseName}_normal.jpg`));
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, rz);
  normalMap.anisotropy = 4;

  const pair = { map, normalMap };
  _texCache.set(key, pair);
  return pair;
}

function makeParticleSpriteTexture() {
  const key = '__particle_dot__';
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 3, 32, 32, 30);
  g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.45, 'rgba(255, 255, 255, 0.78)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

/**
 * Builds a multi-blade curved 3D grass tuft `BufferGeometry` (7 arched tapered blades per clump)
 * so meadows and tall-grass patches look rich, full, and natural!
 */
function getCurvedGrassClumpGeometry() {
  if (_cachedGrassClumpGeo) return _cachedGrassClumpGeo;

  const positions = [];
  const normals = [];
  const bladeConfigs = [
    { angle: 0.0, lean: 0.17, h: 0.68, w: 0.062, ox: 0.0, oz: 0.0 },
    { angle: 0.9, lean: 0.25, h: 0.58, w: 0.056, ox: 0.08, oz: 0.04 },
    { angle: 1.85, lean: 0.23, h: 0.63, w: 0.058, ox: -0.06, oz: 0.07 },
    { angle: 2.75, lean: 0.28, h: 0.53, w: 0.052, ox: -0.08, oz: -0.04 },
    { angle: 3.68, lean: 0.22, h: 0.6, w: 0.055, ox: -0.02, oz: -0.08 },
    { angle: 4.55, lean: 0.26, h: 0.56, w: 0.052, ox: 0.07, oz: -0.06 },
    { angle: 5.42, lean: 0.2, h: 0.64, w: 0.058, ox: 0.05, oz: 0.07 },
  ];

  const segs = 3;
  for (const bc of bladeConfigs) {
    const ca = Math.cos(bc.angle);
    const sa = Math.sin(bc.angle);
    const wx = -sa;
    const wz = ca;

    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const y0 = t0 * bc.h;
      const y1 = t1 * bc.h;
      const curve0 = t0 * t0 * bc.lean;
      const curve1 = t1 * t1 * bc.lean;
      const w0 = bc.w * (1.0 - t0 * 0.76);
      const w1 = bc.w * (1.0 - t1 * 0.94);

      const cx0 = bc.ox + ca * curve0;
      const cz0 = bc.oz + sa * curve0;
      const cx1 = bc.ox + ca * curve1;
      const cz1 = bc.oz + sa * curve1;

      const p0L = [cx0 - wx * w0, y0, cz0 - wz * w0];
      const p0R = [cx0 + wx * w0, y0, cz0 + wz * w0];
      const p1L = [cx1 - wx * w1, y1, cz1 - wz * w1];
      const p1R = [cx1 + wx * w1, y1, cz1 + wz * w1];

      const nx = ca * 0.35;
      const ny = 0.88;
      const nz = sa * 0.35;

      if (s === segs - 1) {
        const tip = [cx1, y1 + 0.045, cz1];
        positions.push(...p0L, ...p0R, ...tip);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      } else {
        positions.push(...p0L, ...p0R, ...p1R, ...p0L, ...p1R, ...p1L);
        for (let k = 0; k < 6; k++) normals.push(nx, ny, nz);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  _cachedGrassClumpGeo = geo;
  return geo;
}

/**
 * Builds a 6-frond spreading 3D woodland fern rosette for forest & tropical undergrowth!
 */
function getFernRosetteGeometry() {
  if (_cachedFernGeo) return _cachedFernGeo;
  const positions = [];
  const normals = [];
  const frondCount = 6;
  for (let f = 0; f < frondCount; f++) {
    const ang = (f / frondCount) * Math.PI * 2 + 0.25;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const wx = -sa;
    const wz = ca;
    const len = 0.58;
    const archH = 0.28;
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const r0 = 0.06 + t0 * len;
      const r1 = 0.06 + t1 * len;
      const y0 = Math.sin(t0 * Math.PI * 0.82) * archH + 0.04;
      const y1 = Math.sin(t1 * Math.PI * 0.82) * archH + 0.04;
      const w0 = 0.13 * Math.sin(t0 * Math.PI * 0.85 + 0.25);
      const w1 = 0.13 * Math.sin(t1 * Math.PI * 0.85 + 0.25) * (s === segs - 1 ? 0.15 : 1.0);

      const p0L = [ca * r0 - wx * w0, y0, sa * r0 - wz * w0];
      const p0R = [ca * r0 + wx * w0, y0, sa * r0 + wz * w0];
      const p1L = [ca * r1 - wx * w1, y1, sa * r1 - wz * w1];
      const p1R = [ca * r1 + wx * w1, y1, sa * r1 + wz * w1];
      positions.push(...p0L, ...p0R, ...p1R, ...p0L, ...p1R, ...p1L);
      for (let k = 0; k < 6; k++) normals.push(ca * 0.25, 0.94, sa * 0.25);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  _cachedFernGeo = geo;
  return geo;
}

/**
 * Applies crisp world-space planar UVs on top/bottom faces and cylindrical UVs on cliff walls
 * so `ExtrudeGeometry` islands show Nano Banana PBR textures + normal maps cleanly without stretching.
 */
function applyWorldPlanarUVs(geo, tileScale = 4.6) {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !uv) return geo;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = norm ? Math.abs(norm.getY(i)) : 1.0;
    if (ny > 0.55) {
      uv.setXY(i, x / tileScale, z / tileScale);
    } else {
      const perim = Math.atan2(z, x) * 7.5;
      uv.setXY(i, perim, y / 1.8);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function buildOrganicIslandGeometry({
  halfW,
  halfD,
  coastParams,
  lobeDirs,
  scaleFactor = 1.0,
  depth = 0.45,
  bevelThickness = 0.08,
  bevelSize = 0.14,
  segments = 96,
  tileScale = 4.6,
}) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const rNorm = computeCoastRadiusNorm(theta, coastParams, lobeDirs) * scaleFactor;
    const px = Math.cos(theta) * halfW * rNorm;
    const pz = Math.sin(theta) * halfD * rNorm;
    // After `rotateX(-Math.PI / 2)`, `(x, y, z)` becomes `(x, z, -y)` => `(px, zExt, pz)`!
    pts.push(new THREE.Vector2(px, -pz));
  }
  const shape = new THREE.Shape(pts);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelSegments: 2,
    steps: 1,
    bevelSize,
    bevelThickness,
  });
  geo.rotateX(-Math.PI / 2);
  applyWorldPlanarUVs(geo, tileScale);
  return geo;
}

function distToSegment2D(px, pz, x0, z0, x1, z1) {
  const vx = x1 - x0;
  const vz = z1 - z0;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-5) return Math.hypot(px - x0, pz - z0);
  const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / lenSq));
  return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
}

export function buildZoneDiorama(zone, modelBank, state = null) {
  const group = new THREE.Group();
  const colliders = []; // { x, z, r } circular obstacles for smooth 2.5D sliding collision
  const animated = []; // (timeSec, dt) => void
  const labelSprites = [];
  const loadPromises = [];

  const { halfW, halfD } = zone.bounds;
  const coastParams = zone.coastParams || [0.1, 0.08, 0.05, 0.7];
  const lobeDirs = (zone.gateways || []).map((gw) => Math.atan2(gw.z / halfD, gw.x / halfW));

  const rand = seededRand((zone.index || 1) * 98765 + 1337);
  const theme = zone.theme || 'tropical';
  const isSoftwareGl = Boolean(modelBank && modelBank.isSoftwareGl);

  const sharedTime = { value: 0 };
  const sharedHeroPos = { value: new THREE.Vector3(0, -99, 0) };

  // Precompute 80-point organic coastline outline (used by HUD Mini-Map & coast helpers!)
  const coastOutline = [];
  const outlineSegs = 80;
  for (let i = 0; i < outlineSegs; i++) {
    const theta = (i / outlineSegs) * Math.PI * 2;
    const rNorm = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
    coastOutline.push({
      x: Math.cos(theta) * halfW * rNorm,
      z: Math.sin(theta) * halfD * rNorm,
    });
  }

  const piers = zone.piers || [];
  const isOnPier = (x, z) => {
    for (const p of piers) {
      const ca = Math.cos(-(p.yaw || 0));
      const sa = Math.sin(-(p.yaw || 0));
      const lx = (x - p.x) * ca - (z - p.z) * sa;
      const lz = (x - p.x) * sa + (z - p.z) * ca;
      if (Math.abs(lx) <= (p.width || 3.0) * 0.48 && Math.abs(lz) <= (p.length || 5.8) * 0.52) {
        return true;
      }
    }
    return false;
  };

  const getCoastMaxRadiusFactor = (x, z) => {
    const theta = Math.atan2(z / halfD, x / halfW);
    return computeCoastRadiusNorm(theta, coastParams, lobeDirs);
  };

  const isInsideCoast = (x, z, marginMeters = 1.4) => {
    if (isOnPier(x, z)) return true;
    const rMax = getCoastMaxRadiusFactor(x, z);
    const effW = Math.max(4, halfW * rMax - marginMeters);
    const effD = Math.max(4, halfD * rMax - marginMeters);
    const norm = Math.hypot(x / effW, z / effD);
    return norm <= 1.0;
  };

  const clampToCoast = (x, z, marginMeters = 1.15) => {
    if (isOnPier(x, z)) return { x, z };
    const rMax = getCoastMaxRadiusFactor(x, z);
    const effW = Math.max(4, halfW * rMax - marginMeters);
    const effD = Math.max(4, halfD * rMax - marginMeters);
    const norm = Math.hypot(x / effW, z / effD);
    if (norm <= 1.0 || norm < 1e-5) return { x, z };
    return { x: x / norm, z: z / norm };
  };

  const terraces = zone.terraces || [];
  const bridges = zone.bridges || [];
  const waterChannels = zone.waterChannels || [];
  const roads = zone.roads || [];

  // Smooth elevation sampler for terraces + stair ramps + arched bridges!
  const getHeightAt = (x, z) => {
    let hOut = 0;
    for (const t of terraces) {
      const dx = x - t.x;
      const dz = z - t.z;
      const ellip = Math.hypot(dx / t.rx, dz / t.rz);
      if (ellip <= 1.0) {
        hOut = Math.max(hOut, t.h || 0.68);
        continue;
      }
      // South stair ramp
      const stairX = t.x;
      const stairZ0 = t.z + t.rz * 0.82;
      const stairZ1 = t.z + t.rz + 2.3;
      if (Math.abs(x - stairX) <= 1.85 && z >= stairZ0 && z <= stairZ1) {
        const u = 1.0 - (z - stairZ0) / Math.max(0.2, stairZ1 - stairZ0);
        hOut = Math.max(hOut, Math.max(0, Math.min(1, u)) * (t.h || 0.68));
      }
    }
    for (const br of bridges) {
      const ca = Math.cos(-(br.yaw || 0));
      const sa = Math.sin(-(br.yaw || 0));
      const lx = (x - br.x) * ca - (z - br.z) * sa;
      const lz = (x - br.x) * sa + (z - br.z) * ca;
      const hw = (br.width || 3.4) * 0.52;
      const hl = (br.length || 5.2) * 0.52;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hl) {
        const arch = Math.cos((lz / hl) * Math.PI * 0.5) * 0.34;
        hOut = Math.max(hOut, arch);
      }
    }
    return hOut;
  };

  const isNearRoadOrRiver = (x, z, pad = 2.0) => {
    for (const poly of roads) {
      for (let i = 0; i < poly.length - 1; i++) {
        if (distToSegment2D(x, z, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]) < pad) {
          return true;
        }
      }
    }
    for (const ch of waterChannels) {
      if (distToSegment2D(x, z, ch.x0, ch.z0, ch.x1, ch.z1) < (ch.width || 2.8) * 0.62 + pad * 0.7) {
        return true;
      }
    }
    for (const br of bridges) {
      if (Math.hypot(x - br.x, z - br.z) < (br.length || 5.2) * 0.65) return true;
    }
    return false;
  };

  const isClearSpot = (x, z, minClear = 2.8) => {
    if (!isInsideCoast(x, z, 2.2)) return false;
    if (isNearRoadOrRiver(x, z, 2.15)) return false;
    if (Math.hypot(x - zone.playerSpawn.x, z - zone.playerSpawn.z) < 3.6) return false;
    for (const lm of zone.landmarks || []) {
      if (Math.hypot(x - lm.x, z - lm.z) < (lm.scale || 3.0) * 0.9 + minClear * 0.4) return false;
    }
    for (const h of zone.houses || []) {
      if (Math.hypot(x - h.x, z - h.z) < (h.scale || 4.4) * 0.78 + minClear * 0.45) return false;
      if (Math.hypot(x - h.x, z - (h.z + 2.8)) < 3.5) return false;
    }
    for (const gw of zone.gateways || []) {
      if (Math.hypot(x - gw.x, z - gw.z) < 5.0) return false;
    }
    for (const tr of zone.trainers || []) {
      if (Math.hypot(x - tr.x, z - tr.z) < 3.2) return false;
    }
    for (const ap of zone.apexSpawns || []) {
      if (Math.hypot(x - ap.x, z - ap.z) < 6.8) return false;
    }
    for (const sh of zone.shrines || []) {
      if (Math.hypot(x - sh.x, z - sh.z) < 3.0) return false;
    }
    for (const bt of zone.berryTrees || []) {
      if (Math.hypot(x - bt.x, z - bt.z) < 2.8) return false;
    }
    for (const ch of zone.chests || []) {
      if (Math.hypot(x - ch.x, z - ch.z) < 2.6) return false;
    }
    for (const bp of zone.ballPickups || []) {
      if (Math.hypot(x - bp.x, z - bp.z) < 2.0) return false;
    }
    for (const t of terraces) {
      // Keep stair approach unobstructed
      if (Math.abs(x - t.x) < 2.4 && z > t.z + t.rz * 0.65 && z < t.z + t.rz + 3.0) return false;
      // Keep rim clean so trees don't float half off terrace edge
      const ellip = Math.hypot((x - t.x) / t.rx, (z - t.z) / t.rz);
      if (ellip > 0.84 && ellip < 1.2) return false;
    }
    return true;
  };

  // 1. Custom GLSL Ocean / Caustics / Fresnel / Organic Coastline Surf Foam & Convective Magma Shader!
  const waterSegs = isSoftwareGl ? 40 : 88;
  const waterGeo = new THREE.PlaneGeometry(240, 240, waterSegs, waterSegs);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = createOceanMagmaShaderMaterial({
    waterColor: zone.waterColor || '#1496c8',
    deepColor: theme === 'harbor' ? '#073b66' : '#0a4f80',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || zone.skyColor || '#9be4ff',
    fogNear: 44,
    fogFar: 96,
    islandHalfW: halfW,
    islandHalfD: halfD,
    coastParams,
    lobeDirs,
    theme,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.82;
  group.add(water);

  // 2. Non-Square Organic Multi-Tiered Island Geometry (`ExtrudeGeometry` + Beaches + Wet Cliffs + Lush Lawn)
  const cliffTexName = theme === 'volcano' ? 'volcano_basalt' : 'cliff_rock';
  const cliffPair = loadDedicatedPair(cliffTexName, 1, 1);
  const cliffTint =
    theme === 'snow'
      ? '#cbd5e1'
      : theme === 'volcano'
        ? '#d6d3d1'
        : theme === 'harbor'
          ? '#e2e8f0'
          : '#ffedd5';

  const cliffLowerMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    color: new THREE.Color(cliffTint).multiplyScalar(0.76),
    roughness: 0.84,
  });
  attachCliffWetnessShader(cliffLowerMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });
  const cliffLower = new THREE.Mesh(
    buildOrganicIslandGeometry({
      halfW,
      halfD,
      coastParams,
      lobeDirs,
      scaleFactor: 1.105,
      depth: 0.85,
      bevelThickness: 0.1,
      bevelSize: 0.22,
      segments: 84,
      tileScale: 5.5,
    }),
    cliffLowerMat,
  );
  cliffLower.position.y = -1.42;
  group.add(cliffLower);

  // Sloping Golden Sandy Beach / Pebble Shore Shelf around the curved coves & bays!
  const beachTexName = theme === 'volcano' ? 'volcano_basalt' : theme === 'snow' ? 'snow_alpine' : 'cobble_path';
  const beachPair = loadDedicatedPair(beachTexName, 1, 1);
  const shoreMat = new THREE.MeshStandardMaterial({
    map: beachPair.map,
    normalMap: beachPair.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: theme === 'volcano' ? '#78716c' : theme === 'snow' ? '#e2e8f0' : '#fde68a',
    roughness: 0.76,
  });
  const shoreShelf = new THREE.Mesh(
    buildOrganicIslandGeometry({
      halfW,
      halfD,
      coastParams,
      lobeDirs,
      scaleFactor: 1.068,
      depth: 0.42,
      bevelThickness: 0.14,
      bevelSize: 0.45,
      segments: 88,
      tileScale: 4.2,
    }),
    shoreMat,
  );
  shoreShelf.position.y = -0.92;
  shoreShelf.receiveShadow = !isSoftwareGl;
  group.add(shoreShelf);

  const cliffBaseMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    color: cliffTint,
    roughness: 0.76,
  });
  attachCliffWetnessShader(cliffBaseMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });
  const cliffBase = new THREE.Mesh(
    buildOrganicIslandGeometry({
      halfW,
      halfD,
      coastParams,
      lobeDirs,
      scaleFactor: 1.022,
      depth: 0.68,
      bevelThickness: 0.09,
      bevelSize: 0.18,
      segments: 92,
      tileScale: 4.8,
    }),
    cliffBaseMat,
  );
  cliffBase.position.y = -0.78;
  cliffBase.receiveShadow = !isSoftwareGl;
  group.add(cliffBase);

  const groundTexName =
    theme === 'volcano'
      ? 'volcano_basalt'
      : theme === 'snow'
        ? 'snow_alpine'
        : theme === 'harbor'
          ? 'harbor_stone'
          : theme === 'forest'
            ? 'grass_grove'
            : 'grass_meadow';
  const lawnPair = loadDedicatedPair(groundTexName, 1, 1);
  const groundTint =
    theme === 'tropical'
      ? '#c8f7b8'
      : theme === 'forest'
        ? '#d9f99d'
        : theme === 'snow'
          ? '#f8fafc'
          : '#ffffff';

  const lawnMat = new THREE.MeshStandardMaterial({
    map: lawnPair.map,
    normalMap: lawnPair.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    color: groundTint,
    roughness: theme === 'snow' ? 0.58 : theme === 'harbor' ? 0.65 : 0.78,
    metalness: theme === 'harbor' ? 0.08 : 0.02,
  });
  attachTerrainDetailShader(lawnMat, {
    uTime: sharedTime,
    islandHalfW: halfW,
    islandHalfD: halfD,
    dappleStrength: theme === 'volcano' ? 0.08 : 0.2,
  });

  const lawn = new THREE.Mesh(
    buildOrganicIslandGeometry({
      halfW,
      halfD,
      coastParams,
      lobeDirs,
      scaleFactor: 1.0,
      depth: 0.28,
      bevelThickness: 0.06,
      bevelSize: 0.14,
      segments: 96,
      tileScale: 4.4,
    }),
    lawnMat,
  );
  lawn.position.y = -0.28;
  lawn.receiveShadow = !isSoftwareGl;
  group.add(lawn);

  // 2b. Elevated Walkable Cliff Terraces + 3D Stone Staircases!
  const cobblePair = loadDedicatedPair('cobble_path', 1, 1);
  const woodPair = loadDedicatedPair('wood_timber', 1, 1);

  for (const t of terraces) {
    const tPts = [];
    const tSegs = 48;
    for (let i = 0; i < tSegs; i++) {
      const a = (i / tSegs) * Math.PI * 2;
      const wob = 1.0 + 0.06 * Math.cos(3 * a + 0.7) + 0.04 * Math.sin(5 * a);
      tPts.push(new THREE.Vector2(Math.cos(a) * t.rx * wob, -Math.sin(a) * t.rz * wob));
    }
    const tShape = new THREE.Shape(tPts);
    tShape.closePath();

    const rockWallGeo = new THREE.ExtrudeGeometry(tShape, {
      depth: (t.h || 0.68) - 0.1,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.16,
      bevelThickness: 0.08,
    });
    rockWallGeo.rotateX(-Math.PI / 2);
    applyWorldPlanarUVs(rockWallGeo, 3.8);
    const tWall = new THREE.Mesh(rockWallGeo, cliffBaseMat);
    tWall.position.set(t.x, -0.02, t.z);
    tWall.castShadow = !isSoftwareGl;
    tWall.receiveShadow = !isSoftwareGl;
    tWall.userData.keepInBattle = true;
    group.add(tWall);

    const capGeo = new THREE.ExtrudeGeometry(tShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.08,
      bevelThickness: 0.04,
    });
    capGeo.rotateX(-Math.PI / 2);
    applyWorldPlanarUVs(capGeo, 4.2);
    const tCap = new THREE.Mesh(capGeo, lawnMat);
    tCap.position.set(t.x, (t.h || 0.68) - 0.12, t.z);
    tCap.receiveShadow = !isSoftwareGl;
    tCap.userData.keepInBattle = true;
    group.add(tCap);

    // 4-step walkable 3D Stone Staircase on the south edge of the terrace!
    const stepsCount = 5;
    const stairStartZ = t.z + t.rz * 0.84;
    const stairLen = 2.25;
    const stepMat = new THREE.MeshStandardMaterial({
      map: cobblePair.map,
      normalMap: cobblePair.normalMap,
      color: '#fef3c7',
      roughness: 0.66,
    });
    for (let s = 0; s < stepsCount; s++) {
      const frac = (s + 1) / stepsCount;
      const stepH = (t.h || 0.68) * (1.0 - s / stepsCount);
      const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(3.1, stepH, stairLen / stepsCount + 0.14), stepMat);
      stepMesh.position.set(t.x, stepH * 0.5, stairStartZ + (s + 0.5) * (stairLen / stepsCount));
      stepMesh.receiveShadow = !isSoftwareGl;
      stepMesh.userData.keepInBattle = true;
      group.add(stepMesh);
    }

    // Add cliff-edge rim colliders around the terrace EXCEPT at the south staircase opening
    const rimDots = 22;
    for (let i = 0; i < rimDots; i++) {
      const a = (i / rimDots) * Math.PI * 2;
      const rx = t.x + Math.cos(a) * t.rx * 1.02;
      const rz = t.z + Math.sin(a) * t.rz * 1.02;
      if (Math.abs(rx - t.x) < 2.25 && rz > t.z + t.rz * 0.55) continue;
      colliders.push({ x: rx, z: rz, r: 0.72 });
    }
  }

  // 2c. Flowing Island Streams / Harbor Canals / Magma Rifts + Walkable Arched 3D Bridges & Piers!
  const streamMat = createOceanMagmaShaderMaterial({
    waterColor: theme === 'volcano' ? '#f97316' : theme === 'snow' ? '#2dd4bf' : '#38bdf8',
    deepColor: theme === 'volcano' ? '#7c2d12' : '#0284c7',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || '#9be4ff',
    fogNear: 50,
    fogFar: 110,
    islandHalfW: 80,
    islandHalfD: 80,
    theme: theme === 'volcano' ? 'volcano' : 'tropical',
  });
  animated.push((t) => {
    streamMat.uniforms.uTime.value = t * 1.35;
  });

  for (const ch of waterChannels) {
    const dx = ch.x1 - ch.x0;
    const dz = ch.z1 - ch.z0;
    const len = Math.hypot(dx, dz);
    const w = ch.width || 2.8;
    const ang = Math.atan2(dx, dz);

    const chGroup = new THREE.Group();
    chGroup.position.set((ch.x0 + ch.x1) * 0.5, 0, (ch.z0 + ch.z1) * 0.5);
    chGroup.rotation.y = ang;

    // Stone/pebble banks flanking the flowing water ribbon
    const bankGeo = new THREE.BoxGeometry(0.45, 0.14, len);
    const bankL = new THREE.Mesh(bankGeo, shoreMat);
    bankL.position.set(-w * 0.5 - 0.15, 0.045, 0);
    const bankR = new THREE.Mesh(bankGeo, shoreMat);
    bankR.position.set(w * 0.5 + 0.15, 0.045, 0);

    const ribbonGeo = new THREE.PlaneGeometry(w, len, 8, 36);
    ribbonGeo.rotateX(-Math.PI / 2);
    const ribbon = new THREE.Mesh(ribbonGeo, streamMat);
    ribbon.position.y = 0.056;

    chGroup.add(bankL, bankR, ribbon);
    chGroup.userData.keepInBattle = true;
    group.add(chGroup);

    // Block walking straight into deep water/magma EXCEPT across arched bridges!
    const samples = Math.max(8, Math.floor(len / 1.9));
    for (let s = 0; s <= samples; s++) {
      const u = s / samples;
      const sx = ch.x0 + dx * u;
      const sz = ch.z0 + dz * u;
      if (!isInsideCoast(sx, sz, 0.5)) continue;
      const coveredByBridge = bridges.some((br) => Math.hypot(sx - br.x, sz - br.z) < (br.width || 3.4) * 0.72);
      if (!coveredByBridge) {
        colliders.push({ x: sx, z: sz, r: w * 0.44 });
      }
    }
  }

  // Walkable Arched 3D Bridges!
  const bridgeTimberMat = new THREE.MeshStandardMaterial({
    map: woodPair.map,
    normalMap: woodPair.normalMap,
    color: '#d97706',
    roughness: 0.55,
  });
  const bridgeStoneMat = new THREE.MeshStandardMaterial({
    map: cobblePair.map,
    normalMap: cobblePair.normalMap,
    color: theme === 'volcano' ? '#78716c' : '#e2e8f0',
    roughness: 0.62,
  });

  for (const br of bridges) {
    const bw = br.width || 3.4;
    const bl = br.length || 5.2;
    const isStone = br.style === 'stone';
    const deckMat = isStone ? bridgeStoneMat : bridgeTimberMat;
    const railMat = isStone ? cliffBaseMat : bridgeTimberMat;

    const bg = new THREE.Group();
    bg.position.set(br.x, 0, br.z);
    bg.rotation.y = br.yaw || 0;

    const planks = 9;
    for (let i = 0; i < planks; i++) {
      const u = (i + 0.5) / planks - 0.5; // -0.5..0.5
      const lz = u * bl;
      const archY = Math.cos(u * Math.PI) * 0.34;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, bl / planks + 0.05), deckMat);
      plank.position.set(0, archY, lz);
      plank.rotation.x = Math.sin(u * Math.PI) * 0.16;
      if (!isSoftwareGl) {
        plank.castShadow = true;
        plank.receiveShadow = true;
      }
      bg.add(plank);
    }

    // Side posts & arched handrails
    for (const side of [-1, 1]) {
      for (const u of [-0.46, 0, 0.46]) {
        const archY = Math.cos(u * Math.PI) * 0.34;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), railMat);
        post.position.set(side * (bw * 0.5 - 0.08), archY + 0.36, u * bl);
        bg.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, bl * 0.96), railMat);
      rail.position.set(side * (bw * 0.5 - 0.08), 0.78, 0);
      bg.add(rail);
    }
    bg.userData.keepInBattle = true;
    group.add(bg);
  }

  // Coastal Wooden Boardwalk Piers jutting out into the bay!
  for (const p of piers) {
    const pw = p.width || 3.0;
    const pl = p.length || 6.0;
    const pg = new THREE.Group();
    pg.position.set(p.x, 0, p.z);
    pg.rotation.y = p.yaw || 0;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.16, pl), bridgeTimberMat);
    deck.position.y = 0.04;
    deck.receiveShadow = !isSoftwareGl;
    pg.add(deck);

    for (const side of [-1, 1]) {
      for (const uz of [-0.42, 0.0, 0.42]) {
        const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.45, 8), bridgeTimberMat);
        piling.position.set(side * (pw * 0.46), -0.35, uz * pl);
        pg.add(piling);
      }
    }
    pg.userData.keepInBattle = true;
    group.add(pg);
  }

  // 3. Winding Multi-Point Cobblestone Avenues + Town Plaza Mosaic!
  const curbMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    color: theme === 'volcano' ? '#78716c' : '#fde68a',
    roughness: 0.65,
  });
  const pathTint =
    theme === 'volcano' ? '#a8a29e' : theme === 'snow' ? '#e2e8f0' : '#fff7ed';

  const addPathSegment = (x0, z0, x1, z1, width = 2.55) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const repY = Math.max(1, Math.round(len / 2.6));
    const pair = loadDedicatedPair('cobble_path', 1, repY);
    const segMat = new THREE.MeshStandardMaterial({
      map: pair.map,
      normalMap: pair.normalMap,
      normalScale: new THREE.Vector2(1.08, 1.08),
      color: pathTint,
      roughness: 0.72,
    });
    const segGroup = new THREE.Group();
    segGroup.position.set((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5);
    segGroup.rotation.y = Math.atan2(dx, dz);

    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, len + width * 0.38), segMat);
    seg.position.y = 0.016;
    seg.receiveShadow = !isSoftwareGl;
    segGroup.add(seg);

    const curbGeo = new THREE.BoxGeometry(0.14, 0.075, len + width * 0.22);
    const curbL = new THREE.Mesh(curbGeo, curbMat);
    curbL.position.set(-width * 0.5 - 0.04, 0.022, 0);
    const curbR = new THREE.Mesh(curbGeo, curbMat);
    curbR.position.set(width * 0.5 + 0.04, 0.022, 0);
    segGroup.add(curbL, curbR);
    segGroup.userData.keepInBattle = true;
    group.add(segGroup);
  };

  for (const poly of roads) {
    for (let i = 0; i < poly.length - 1; i++) {
      addPathSegment(poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1], 2.5);
    }
  }

  // Central Town Plaza Stone Circle
  const plazaX = (zone.landmarks && zone.landmarks[0]) ? zone.landmarks[0].x : 0;
  const plazaZ = (zone.landmarks && zone.landmarks[0]) ? zone.landmarks[0].z : 2.0;
  if (Math.hypot(plazaX, plazaZ) < 12) {
    const plazaPair = loadDedicatedPair('cobble_path', 3, 3);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: plazaPair.map,
      normalMap: plazaPair.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      color: pathTint,
      roughness: 0.68,
    });
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.85, 0.065, 40), plazaMat);
    plaza.position.set(plazaX, 0.02, plazaZ);
    plaza.receiveShadow = !isSoftwareGl;
    plaza.userData.keepInBattle = true;
    group.add(plaza);

    const plazaRim = new THREE.Mesh(
      new THREE.TorusGeometry(4.62, 0.13, 10, 48),
      new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.38, metalness: 0.18 }),
    );
    plazaRim.rotation.x = Math.PI / 2;
    plazaRim.position.set(plazaX, 0.055, plazaZ);
    plazaRim.userData.keepInBattle = true;
    group.add(plazaRim);
  }

  // Warm Streetlamps + PointLights
  let pointLightBudget = isSoftwareGl ? 0 : 4;
  const addWarmPointLight = (x, y, z, colorHex, intensity = 2.8, dist = 12.0) => {
    if (pointLightBudget <= 0) return;
    pointLightBudget -= 1;
    const pl = new THREE.PointLight(colorHex, intensity, dist, 1.7);
    pl.position.set(x, y, z);
    group.add(pl);
  };

  const addStreetLamp = (lx, lz) => {
    const ly = getHeightAt(lx, lz);
    const lg = new THREE.Group();
    lg.position.set(lx, ly, lz);
    const poleMat = new THREE.MeshStandardMaterial({
      color: theme === 'snow' || theme === 'harbor' ? '#334155' : '#452711',
      roughness: 0.4,
      metalness: 0.35,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.28, 12), poleMat);
    base.position.y = 0.14;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.4, 10), poleMat);
    pole.position.y = 1.32;
    if (!isSoftwareGl) pole.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 12), poleMat);
    cap.position.y = 2.78;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 14, 12),
      new THREE.MeshStandardMaterial({
        color: '#fef9c3',
        emissive: '#f59e0b',
        emissiveIntensity: 1.45,
        roughness: 0.12,
      }),
    );
    bulb.position.y = 2.5;
    lg.add(base, pole, cap, bulb);
    group.add(lg);
    addWarmPointLight(lx, ly + 2.6, lz, 0xffd166, 2.6, 11.5);
    colliders.push({ x: lx, z: lz, r: 0.42 });
  };
  addStreetLamp(plazaX - 4.8, plazaZ + 2.4);
  addStreetLamp(plazaX + 4.8, plazaZ + 2.4);

  // 4. TRELLIS.2-4B `.glb` Landmarks (`env_plaza_fountain`, `env_harbor_lighthouse`, `env_onsen_gazebo`, `env_volcano_obelisk`)!
  for (const lm of zone.landmarks || []) {
    const ly = getHeightAt(lm.x, lm.z);
    const actor = modelBank.spawnActor({
      glbUrl: lm.glb,
      scale: lm.scale || 3.2,
      primaryColor: '#38bdf8',
      secondaryColor: '#fde047',
      shadowRadius: (lm.scale || 3.2) * 0.38,
      standInKind: 'prop',
    });
    actor.root.position.set(lm.x, ly, lm.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);
    if (lm.colliderR) {
      colliders.push({ x: lm.x, z: lm.z, r: lm.colliderR });
    }
  }

  // 5. Dense Wind-Swaying 7-Blade 3D Grass Clumps (`1,180` tufts = `8,260` blades!) + Tall-Grass Wild Meadows!
  const baseGrassCount = theme === 'harbor' ? 540 : theme === 'volcano' ? 360 : 1180;
  const grassCount = isSoftwareGl ? Math.round(baseGrassCount * 0.44) : baseGrassCount;
  const clumpGeo = getCurvedGrassClumpGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    roughness: 0.44,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  attachWindGrassShader(grassMat, {
    uTime: sharedTime,
    uHeroPos: sharedHeroPos,
    windStrength: theme === 'snow' ? 0.16 : 0.26,
  });

  const grassInst = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
  const grassPalette =
    theme === 'snow'
      ? ['#bae6fd', '#e0f2fe', '#7dd3fc', '#a5f3fc']
      : theme === 'volcano'
        ? ['#fb923c', '#f97316', '#facc15', '#ea580c']
        : theme === 'forest'
          ? ['#22c55e', '#16a34a', '#4ade80', '#84cc16', '#a3e635']
          : ['#16a34a', '#22c55e', '#4ade80', '#15803d', '#86efac'];

  const dummy = new THREE.Object3D();
  const gCol = new THREE.Color();
  let placedGrass = 0;

  // 5a. First seed dense, waist-high rustling Tall-Grass Habitat Patches (`zone.tallGrassPatches`)!
  const patches = zone.tallGrassPatches || [];
  const tallQuota = Math.min(Math.floor(grassCount * 0.48), patches.length * 145);
  for (let i = 0; i < tallQuota * 3 && placedGrass < tallQuota && patches.length > 0; i++) {
    const patch = patches[i % patches.length];
    const r = Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const gx = patch.x + Math.cos(a) * patch.rx * r;
    const gz = patch.z + Math.sin(a) * patch.rz * r;
    if (!isInsideCoast(gx, gz, 1.5)) continue;
    if (isNearRoadOrRiver(gx, gz, 1.45)) continue;

    const gy = getHeightAt(gx, gz);
    dummy.position.set(gx, gy, gz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 1.15 + rand() * 0.72;
    dummy.scale.set(s, s * (1.28 + rand() * 0.48), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass, dummy.matrix);
    gCol.set(grassPalette[placedGrass % grassPalette.length]).multiplyScalar(0.92);
    grassInst.setColorAt(placedGrass, gCol);
    placedGrass++;
  }

  // 5b. Fill all curved meadows, coves & elevated terraces with rich lawn tufts!
  for (let i = 0; i < grassCount * 4 && placedGrass < grassCount; i++) {
    const gx = (rand() * 2 - 1) * (halfW - 1.2);
    const gz = (rand() * 2 - 1) * (halfD - 1.2);
    if (!isInsideCoast(gx, gz, 1.4)) continue;
    if (Math.hypot(gx - plazaX, gz - plazaZ) < 5.0) continue;
    if (isNearRoadOrRiver(gx, gz, 1.55)) continue;

    const gy = getHeightAt(gx, gz);
    dummy.position.set(gx, gy, gz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.82 + rand() * 0.75;
    dummy.scale.set(s, s * (0.9 + rand() * 0.42), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass, dummy.matrix);
    gCol.set(grassPalette[placedGrass % grassPalette.length]);
    grassInst.setColorAt(placedGrass, gCol);
    placedGrass++;
  }
  grassInst.count = placedGrass;
  if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
  group.add(grassInst);

  // 5c. Woodland Fern Rosettes (`InstancedMesh`) + Wildflower Blossoms!
  if (theme !== 'volcano') {
    const fernCount = theme === 'forest' ? 130 : theme === 'tropical' ? 110 : 65;
    const fernGeo = getFernRosetteGeometry();
    const fernMat = attachFoliageSubsurfaceShader(
      new THREE.MeshStandardMaterial({ roughness: 0.42, side: THREE.DoubleSide }),
      { uTime: sharedTime, windAmp: 0.055, sssColor: '#bef264' },
    );
    const fernInst = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);
    const fernColors = theme === 'snow' ? ['#0f766e', '#14b8a6', '#99f6e4'] : ['#15803d', '#16a34a', '#22c55e', '#4d7c0f'];
    let placedFerns = 0;
    for (let i = 0; i < fernCount * 4 && placedFerns < fernCount; i++) {
      const fx = (rand() * 2 - 1) * (halfW - 1.8);
      const fz = (rand() * 2 - 1) * (halfD - 1.8);
      if (!isClearSpot(fx, fz, 1.4)) continue;
      const fy = getHeightAt(fx, fz);
      dummy.position.set(fx, fy, fz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const s = 0.85 + rand() * 0.75;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      fernInst.setMatrixAt(placedFerns, dummy.matrix);
      gCol.set(fernColors[placedFerns % fernColors.length]);
      fernInst.setColorAt(placedFerns, gCol);
      placedFerns++;
    }
    fernInst.count = placedFerns;
    if (fernInst.instanceColor) fernInst.instanceColor.needsUpdate = true;
    group.add(fernInst);
  }

  const flowerCount = 185;
  const flowerGeo = new THREE.CylinderGeometry(0.22, 0.07, 0.12, 6);
  flowerGeo.translate(0, 0.09, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.28 });
  const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  const flowerPalette =
    theme === 'volcano'
      ? ['#fb923c', '#facc15', '#ef4444']
      : theme === 'snow'
        ? ['#e0f2fe', '#7dd3fc', '#c4b5fd']
        : ['#f472b6', '#facc15', '#38bdf8', '#fb7185', '#ffffff', '#c084fc'];
  const fColor = new THREE.Color();
  let placedFlowers = 0;
  for (let i = 0; i < flowerCount * 4 && placedFlowers < flowerCount; i++) {
    const fx = (rand() * 2 - 1) * (halfW - 1.8);
    const fz = (rand() * 2 - 1) * (halfD - 1.8);
    if (!isClearSpot(fx, fz, 1.5)) continue;
    const fy = getHeightAt(fx, fz);
    dummy.position.set(fx, fy + 0.015, fz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.82 + rand() * 0.7;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    flowerInst.setMatrixAt(placedFlowers, dummy.matrix);
    fColor.set(flowerPalette[placedFlowers % flowerPalette.length]);
    flowerInst.setColorAt(placedFlowers, fColor);
    placedFlowers++;
  }
  flowerInst.count = placedFlowers;
  if (flowerInst.instanceColor) flowerInst.instanceColor.needsUpdate = true;
  group.add(flowerInst);

  // 6. Rich TRELLIS.2 3D `.glb` Hero Trees, Tropical Flora Clusters & Normal-Mapped Sculpted Grove Trees!
  const rockMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: theme === 'snow' ? '#e2e8f0' : theme === 'volcano' ? '#57534e' : '#d6c7b2',
    roughness: 0.78,
  });
  attachCliffWetnessShader(rockMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });

  const foliageNormalPair = loadDedicatedPair('grass_grove', 2, 2);
  const leafCrownGreenMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({
      normalMap: foliageNormalPair.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: '#16a34a',
      roughness: 0.42,
    }),
    { uTime: sharedTime, windAmp: 0.065, sssColor: '#bef264' },
  );
  const leafCrownLushMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({
      normalMap: foliageNormalPair.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: theme === 'forest' ? '#eab308' : '#22c55e',
      roughness: 0.4,
    }),
    { uTime: sharedTime, windAmp: 0.075, sssColor: '#fde047' },
  );
  const pineBoughMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({
      normalMap: foliageNormalPair.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      color: '#0f766e',
      roughness: 0.48,
    }),
    { uTime: sharedTime, windAmp: 0.045, sssColor: '#7dd3fc' },
  );

  // Spawn TRELLIS.2 `.glb` Hero Trees & Botanical Clusters around the island!
  const treeGlbPool =
    theme === 'tropical'
      ? [
          { glb: 'assets/models/env_palm_tree.glb', scale: 3.85, r: 0.85 },
          { glb: 'assets/models/env_palm_tree.glb', scale: 3.35, r: 0.8 },
          { glb: 'assets/models/env_canopy_oak.glb', scale: 3.6, r: 0.95 },
          { glb: 'assets/models/env_tropical_flora.glb', scale: 1.95, r: 0.65 },
        ]
      : theme === 'forest'
        ? [
            { glb: 'assets/models/env_canopy_oak.glb', scale: 4.1, r: 1.05 },
            { glb: 'assets/models/env_canopy_oak.glb', scale: 3.55, r: 0.92 },
            { glb: 'assets/models/env_tropical_flora.glb', scale: 2.1, r: 0.68 },
          ]
        : theme === 'snow'
          ? [
              { glb: 'assets/models/env_alpine_pine.glb', scale: 4.0, r: 0.95 },
              { glb: 'assets/models/env_alpine_pine.glb', scale: 3.4, r: 0.85 },
            ]
          : theme === 'harbor'
            ? [
                { glb: 'assets/models/env_palm_tree.glb', scale: 3.5, r: 0.8 },
                { glb: 'assets/models/env_alpine_pine.glb', scale: 3.4, r: 0.85 },
                { glb: 'assets/models/env_tropical_flora.glb', scale: 1.85, r: 0.6 },
              ]
            : [
                { glb: 'assets/models/env_volcano_obelisk.glb', scale: 2.65, r: 0.85 },
              ];

  const placedTreeCoords = [];
  const canPlaceTree = (tx, tz, minSpacing = 3.6) => {
    if (!isClearSpot(tx, tz, 2.4)) return false;
    for (const [ox, oz] of placedTreeCoords) {
      if (Math.hypot(tx - ox, tz - oz) < minSpacing) return false;
    }
    return true;
  };

  const spawnTrellisTree = (tx, tz, spec) => {
    const ty = getHeightAt(tx, tz);
    const actor = modelBank.spawnActor({
      glbUrl: spec.glb,
      scale: spec.scale * (0.9 + rand() * 0.24),
      primaryColor: '#22c55e',
      secondaryColor: '#92400e',
      shadowRadius: spec.r * 1.15,
      standInKind: 'prop',
    });
    actor.root.position.set(tx, ty, tz);
    actor.animRoot.rotation.y = rand() * Math.PI * 2;
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);
    colliders.push({ x: tx, z: tz, r: spec.r });
    placedTreeCoords.push([tx, tz]);
  };

  // Place 16 TRELLIS.2 3D `.glb` trees & tropical flora clusters along scenic bays, rivers, and groves!
  const targetGlbCount = theme === 'volcano' ? 7 : 17;
  for (let attempt = 0; attempt < 160 && placedTreeCoords.length < targetGlbCount; attempt++) {
    const theta = rand() * Math.PI * 2;
    const radialBias = 0.45 + 0.5 * Math.sqrt(rand());
    const rCoast = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
    const tx = Math.cos(theta) * (halfW - 2.6) * rCoast * radialBias;
    const tz = Math.sin(theta) * (halfD - 2.6) * rCoast * radialBias;
    if (!canPlaceTree(tx, tz, 3.7)) continue;
    const spec = treeGlbPool[placedTreeCoords.length % treeGlbPool.length];
    spawnTrellisTree(tx, tz, spec);
  }

  // Complementary Multi-Limb Sculpted Botanical Trees (zero plastic spheres — uses faceted normal-mapped boughs & roots!)
  const addComplexGroveTree = (tx, tz) => {
    const ty = getHeightAt(tx, tz);
    const tg = new THREE.Group();
    tg.position.set(tx, ty, tz);

    const barkMat = new THREE.MeshStandardMaterial({
      map: woodPair.map,
      normalMap: woodPair.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: theme === 'snow' ? '#5c4033' : '#78350f',
      roughness: 0.72,
    });

    if (theme === 'volcano') {
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.88, 1), rockMat);
      base.position.y = 0.36;
      const crystalMat = new THREE.MeshStandardMaterial({
        color: '#fb923c',
        emissive: '#ea580c',
        emissiveIntensity: 1.05,
        roughness: 0.16,
      });
      for (const [ox, oy, oz, sx, sy, rz] of [
        [0, 1.55, 0, 0.72, 2.2, 0.08],
        [0.48, 1.05, 0.22, 0.52, 1.65, -0.34],
        [-0.42, 0.95, -0.25, 0.46, 1.45, 0.38],
      ]) {
        const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), crystalMat);
        sp.scale.set(sx, sy, sx);
        sp.position.set(ox, oy, oz);
        sp.rotation.z = rz;
        tg.add(sp);
      }
      tg.add(base);
    } else if (theme === 'snow') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.38, 1.35, 10), barkMat);
      trunk.position.y = 0.65;
      tg.add(trunk);
      const snowCapMat = new THREE.MeshStandardMaterial({
        map: beachPair.map,
        normalMap: beachPair.normalMap,
        color: '#f8fafc',
        roughness: 0.36,
      });
      const tiers = [
        { r: 1.38, h: 1.3, y: 1.42 },
        { r: 1.08, h: 1.15, y: 2.22 },
        { r: 0.78, h: 1.0, y: 2.95 },
        { r: 0.48, h: 0.78, y: 3.55 },
      ];
      for (const tier of tiers) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 9), pineBoughMat);
        cone.position.y = tier.y;
        cone.rotation.y = rand() * Math.PI;
        if (!isSoftwareGl) cone.castShadow = true;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(tier.r * 0.84, tier.h * 0.52, 9), snowCapMat);
        cap.position.y = tier.y + tier.h * 0.24;
        tg.add(cone, cap);
      }
    } else {
      // Gnarled multi-root trunk + 3 spreading branches + 6 overlapping faceted foliage boughs!
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.44, 1.85, 9), barkMat);
      trunk.position.y = 0.92;
      trunk.rotation.z = (rand() - 0.5) * 0.14;
      if (!isSoftwareGl) trunk.castShadow = true;
      tg.add(trunk);

      for (let rIdx = 0; rIdx < 3; rIdx++) {
        const ra = (rIdx / 3) * Math.PI * 2 + rand() * 0.5;
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.65, 7), barkMat);
        root.position.set(Math.cos(ra) * 0.32, 0.22, Math.sin(ra) * 0.32);
        root.rotation.z = -Math.cos(ra) * 0.55;
        root.rotation.x = Math.sin(ra) * 0.55;
        tg.add(root);

        const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.19, 1.15, 7), barkMat);
        limb.position.set(Math.cos(ra) * 0.42, 1.95, Math.sin(ra) * 0.42);
        limb.rotation.z = -Math.cos(ra) * 0.58;
        limb.rotation.x = Math.sin(ra) * 0.58;
        tg.add(limb);
      }

      const boughs = [
        [0, 2.55, 0, 1.32, 0.92, 1.28, leafCrownGreenMat],
        [0.72, 2.32, 0.42, 0.96, 0.78, 0.94, leafCrownLushMat],
        [-0.68, 2.38, 0.38, 0.94, 0.76, 0.92, leafCrownGreenMat],
        [0.15, 2.42, -0.72, 0.95, 0.75, 0.92, leafCrownLushMat],
        [-0.22, 3.05, -0.1, 0.98, 0.82, 0.95, leafCrownLushMat],
        [0.35, 2.92, 0.28, 0.78, 0.7, 0.78, leafCrownGreenMat],
      ];
      for (const [bx, by, bz, sx, sy, sz, mat] of boughs) {
        const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.92, 2), mat);
        tuft.position.set(bx, by, bz);
        tuft.scale.set(sx, sy, sz);
        tuft.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
        if (!isSoftwareGl) tuft.castShadow = true;
        tg.add(tuft);
      }
    }

    group.add(tg);
    colliders.push({ x: tx, z: tz, r: 0.92 });
    placedTreeCoords.push([tx, tz]);
  };

  for (let attempt = 0; attempt < 90 && placedTreeCoords.length < targetGlbCount + 9; attempt++) {
    const theta = rand() * Math.PI * 2;
    const rCoast = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
    const rad = 0.74 + rand() * 0.2;
    const bx = Math.cos(theta) * (halfW - 2.2) * rCoast * rad;
    const bz = Math.sin(theta) * (halfD - 2.2) * rCoast * rad;
    if (canPlaceTree(bx, bz, 3.6)) addComplexGroveTree(bx, bz);
  }

  // Mossy Boulders along coves & trails
  for (let i = 0; i < 12; i++) {
    const rx = (rand() * 2 - 1) * (halfW - 3.0);
    const rz = (rand() * 2 - 1) * (halfD - 3.0);
    if (!canPlaceTree(rx, rz, 3.2)) continue;
    const ry = getHeightAt(rx, rz);
    const sc = 0.75 + rand() * 0.45;
    const bg = new THREE.Group();
    bg.position.set(rx, ry, rz);
    const mainRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68 * sc, 1), rockMat);
    mainRock.scale.set(1.2, 0.76, 0.96);
    mainRock.position.y = 0.34 * sc;
    if (!isSoftwareGl) mainRock.castShadow = true;
    const subRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42 * sc, 1), rockMat);
    subRock.position.set(0.52 * sc, 0.22 * sc, 0.24 * sc);
    bg.add(mainRock, subRock);
    group.add(bg);
    colliders.push({ x: rx, z: rz, r: 0.72 * sc });
  }

  // Scenic Outer-Sea Rock Islets & Bobbing Buoys
  const outerIslets = [
    [-halfW - 8.5, -halfD + 4.0, 2.2],
    [halfW + 9.2, -halfD + 6.5, 1.9],
    [-halfW - 9.0, halfD - 3.5, 1.8],
    [halfW + 8.6, halfD - 4.5, 2.3],
  ];
  for (const [ix, iz, sc] of outerIslets) {
    const islet = new THREE.Group();
    islet.position.set(ix, -0.82, iz);
    const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 1), rockMat);
    mound.scale.set(1.35, 0.72, 1.15);
    mound.position.y = sc * 0.22;
    const topPatch = new THREE.Mesh(new THREE.CylinderGeometry(sc * 0.78, sc * 0.95, 0.25, 12), lawnMat);
    topPatch.position.y = sc * 0.62;
    islet.add(mound, topPatch);
    group.add(islet);
  }

  // Volumetric Sunbeam Shafts + Ambient Biome Particles
  const sunbeamMat = createSunbeamShaderMaterial({
    color: theme === 'volcano' ? '#fdba74' : theme === 'snow' ? '#e0f2fe' : '#fff3b0',
    opacity: theme === 'volcano' ? 0.09 : 0.11,
  });
  const addSunbeam = (sx, sz, radius = 1.8, height = 11.5) => {
    const geo = new THREE.CylinderGeometry(radius * 0.62, radius * 1.28, height, 18, 1, true);
    const beam = new THREE.Mesh(geo, sunbeamMat);
    beam.position.set(sx + 2.2, height * 0.45, sz + 2.0);
    beam.rotation.z = 0.34;
    beam.rotation.x = -0.28;
    group.add(beam);
  };
  addSunbeam(plazaX, plazaZ, 2.3, 12.5);
  for (const sh of zone.shrines || []) {
    addSunbeam(sh.x, sh.z, 1.6, 10.5);
  }

  const pCount = 96;
  const pPositions = new Float32Array(pCount * 3);
  const pSeeds = new Float32Array(pCount);
  for (let i = 0; i < pCount; i++) {
    pPositions[i * 3] = (rand() * 2 - 1) * (halfW + 1.5);
    pPositions[i * 3 + 1] = 0.4 + rand() * 5.8;
    pPositions[i * 3 + 2] = (rand() * 2 - 1) * (halfD + 1.5);
    pSeeds[i] = rand() * Math.PI * 2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  const pColor =
    theme === 'volcano'
      ? '#fb923c'
      : theme === 'snow'
        ? '#ffffff'
        : theme === 'harbor'
          ? '#bae6fd'
          : theme === 'forest'
            ? '#fde047'
            : '#fef9c3';
  const pMat = new THREE.PointsMaterial({
    color: pColor,
    map: makeParticleSpriteTexture(),
    size: theme === 'snow' ? 0.34 : 0.28,
    transparent: true,
    opacity: theme === 'snow' ? 0.88 : 0.74,
    depthWrite: false,
  });
  group.add(new THREE.Points(pGeo, pMat));
  const risesUp = theme === 'volcano' || theme === 'harbor';
  animated.push((t) => {
    const arr = pGeo.attributes.position.array;
    for (let i = 0; i < pCount; i++) {
      const seed = pSeeds[i];
      const baseY = (((seed * 3.1 + t * (risesUp ? 0.65 : -0.55)) % 6.0) + 6.0) % 6.0;
      arr[i * 3 + 1] = 0.35 + baseY;
      arr[i * 3] += Math.sin(t * 1.2 + seed) * 0.008;
    }
    pGeo.attributes.position.needsUpdate = true;
  });

  // 7. All Enterable Houses (`alex_house`, `peanut_butter_house`, `fish_house`, `pork_house`, `beef_house`, Sanctuaries)
  const houseInteractables = [];
  for (const h of zone.houses || []) {
    const hy = getHeightAt(h.x, h.z);
    const actor = modelBank.spawnActor({
      glbUrl: h.glb,
      scale: h.scale || 4.4,
      primaryColor: '#fb923c',
      secondaryColor: '#fef3c7',
      shadowRadius: (h.scale || 4.4) * 0.42,
    });
    actor.root.position.set(h.x, hy, h.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);

    const doorZ = h.z + (h.scale || 4.4) * 0.48;
    const doorY = getHeightAt(h.x, doorZ);
    const matRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.32, 0.06, 24),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.55,
        roughness: 0.28,
      }),
    );
    matRing.position.set(h.x, doorY + 0.035, doorZ);
    group.add(matRing);

    const sign = makeLabelSprite({
      title: h.label,
      subtitle: h.sublabel || 'Walk onto gold mat or press [A] to Enter!',
      badgeText: '🚪 ENTER',
      badgeColor: '#fbbf24',
      widthWorld: 3.9,
    });
    sign.position.set(h.x, hy + (h.scale || 4.4) * 0.68 + 0.65, h.z);
    group.add(sign);
    labelSprites.push(sign);

    colliders.push({ x: h.x, z: h.z, r: (h.scale || 4.4) * 0.35 });
    houseInteractables.push({
      ...h,
      doorX: h.x,
      doorZ,
      doorY,
      actor,
    });
  }

  // 8. Golden Banana Shrines (`banana_shrine.glb`)
  const shrineInteractables = [];
  for (const sh of zone.shrines || []) {
    const sy = getHeightAt(sh.x, sh.z);
    const actor = modelBank.spawnActor({
      glbUrl: 'assets/models/banana_shrine.glb',
      scale: 2.7,
      primaryColor: '#facc15',
      secondaryColor: '#fef08a',
      shadowRadius: 1.1,
    });
    actor.root.position.set(sh.x, sy, sh.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.38, 28),
      new THREE.MeshBasicMaterial({ color: '#fde047', side: THREE.DoubleSide, transparent: true, opacity: 0.68 }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(sh.x, sy + 0.04, sh.z);
    group.add(halo);
    addWarmPointLight(sh.x, sy + 2.2, sh.z, 0xfde047, 2.4, 9.5);

    const lbl = makeLabelSprite({
      title: 'BANANA SHRINE',
      subtitle: '[A] Blessing (Full Heal + Berries)',
      badgeText: '✨',
      badgeColor: '#facc15',
      widthWorld: 3.4,
    });
    lbl.position.set(sh.x, sy + 3.25, sh.z);
    group.add(lbl);
    labelSprites.push(lbl);
    colliders.push({ x: sh.x, z: sh.z, r: 1.0 });
    shrineInteractables.push({ x: sh.x, z: sh.z, y: sy, actor });
  }

  // 9. Shakeable TRELLIS.2 Berry Bushes (`env_berry_bush.glb`)
  const berryInteractables = [];
  for (const bt of zone.berryTrees || []) {
    const by = getHeightAt(bt.x, bt.z);
    const tg = new THREE.Group();
    tg.position.set(bt.x, by, bt.z);

    const bushActor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_berry_bush.glb',
      scale: 2.35,
      primaryColor: '#16a34a',
      secondaryColor: '#fbbf24',
      shadowRadius: 0.95,
      standInKind: 'prop',
    });
    tg.add(bushActor.root);
    loadPromises.push(bushActor.readyPromise);

    const berriesGroup = new THREE.Group();
    const berryMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#d97706',
      emissiveIntensity: 0.65,
      roughness: 0.18,
    });
    for (const [ox, oy, oz] of [
      [-0.48, 1.35, 0.55],
      [0.45, 1.5, 0.52],
      [0.0, 1.85, 0.62],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), berryMat);
      b.position.set(ox, oy, oz);
      berriesGroup.add(b);
    }
    tg.add(berriesGroup);
    group.add(tg);
    colliders.push({ x: bt.x, z: bt.z, r: 0.82 });
    berryInteractables.push({
      x: bt.x,
      z: bt.z,
      y: by,
      group: tg,
      berriesGroup,
      cooldown: 0,
    });
  }

  // 10. Monkeball & Super Ball Supply Chests (`env_treasure_chest.glb`)!
  const chestInteractables = [];
  const openedSet = new Set((state && state.openedChests) || []);
  for (const ch of zone.chests || []) {
    const cy = getHeightAt(ch.x, ch.z);
    const isOpened = openedSet.has(ch.id);
    const actor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_treasure_chest.glb',
      scale: 1.55,
      primaryColor: '#f59e0b',
      secondaryColor: '#dc2626',
      shadowRadius: 0.78,
      standInKind: 'prop',
    });
    actor.root.position.set(ch.x, cy, ch.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);

    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.08, 24),
      new THREE.MeshBasicMaterial({
        color: isOpened ? '#64748b' : '#fde047',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: isOpened ? 0.25 : 0.85,
      }),
    );
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.set(ch.x, cy + 0.04, ch.z);
    group.add(glowRing);

    const sign = makeLabelSprite({
      title: isOpened ? 'OPENED CHEST' : ch.label || 'SUPPLY CHEST',
      subtitle: isOpened ? '✓ Collected' : `[A] +${ch.balls || 5} Balls · +${ch.superBalls || 1} Super`,
      badgeText: isOpened ? '✓' : '🎁 CHEST',
      badgeColor: isOpened ? '#94a3b8' : '#facc15',
      widthWorld: 3.3,
    });
    sign.position.set(ch.x, cy + 1.95, ch.z);
    group.add(sign);
    labelSprites.push(sign);

    colliders.push({ x: ch.x, z: ch.z, r: 0.68 });
    chestInteractables.push({
      ...ch,
      y: cy,
      opened: isOpened,
      actor,
      glowRing,
      sign,
    });
  }

  // 11. Visible Glowing 3D Monkeball & Super Ball Overworld Pickups (`monkeball.glb`)!
  const ballPickupInteractables = [];
  const pickedSet = new Set((state && state.pickedUpBalls) || []);
  for (const bp of zone.ballPickups || []) {
    if (pickedSet.has(bp.id)) continue;
    const py = getHeightAt(bp.x, bp.z);
    const isSuper = bp.kind === 'superball';
    const holder = new THREE.Group();
    holder.position.set(bp.x, py, bp.z);

    const ballActor = modelBank.spawnActor({
      glbUrl: 'assets/models/monkeball.glb',
      scale: 0.72,
      primaryColor: isSuper ? '#facc15' : '#ef4444',
      secondaryColor: '#fef9c3',
      shadowRadius: 0.42,
      standInKind: 'prop',
    });
    holder.add(ballActor.root);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.68, 22),
      new THREE.MeshBasicMaterial({
        color: isSuper ? '#fde047' : '#fb7185',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    holder.add(ring);

    const lbl = makeLabelSprite({
      title: isSuper ? `Super Ball ×${bp.count || 1}` : `Monkeballs ×${bp.count || 3}`,
      subtitle: 'Walk over to collect!',
      badgeText: isSuper ? '🌟 SUPER' : '🐵 BALLS',
      badgeColor: isSuper ? '#facc15' : '#f87171',
      widthWorld: 2.65,
    });
    lbl.position.y = 1.42;
    holder.add(lbl);
    labelSprites.push(lbl);

    group.add(holder);
    const itemObj = {
      ...bp,
      y: py,
      collected: false,
      holder,
      ballActor,
    };
    ballPickupInteractables.push(itemObj);
    animated.push((t) => {
      if (itemObj.collected) return;
      ballActor.animRoot.position.y = 0.24 + Math.sin(t * 3.4 + bp.x) * 0.1;
      ballActor.animRoot.rotation.y = t * 1.8;
    });
  }

  // 12. Glowing Inter-Zone Peninsula Gateways
  for (const gw of zone.gateways || []) {
    const gy = getHeightAt(gw.x, gw.z);
    const portal = new THREE.Group();
    portal.position.set(gw.x, gy, gw.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.15, 12, 32),
      new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 1.2,
        roughness: 0.16,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    portal.add(ring);

    const innerPad = new THREE.Mesh(
      new THREE.CircleGeometry(1.42, 28),
      new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.34, depthWrite: false }),
    );
    innerPad.rotation.x = -Math.PI / 2;
    innerPad.position.y = 0.05;
    portal.add(innerPad);

    const sign = makeLabelSprite({
      title: gw.label,
      badgeText: '⛴️ ROUTE',
      badgeColor: '#38bdf8',
      widthWorld: 3.7,
    });
    sign.position.set(0, 2.3, 0);
    portal.add(sign);
    labelSprites.push(sign);
    group.add(portal);

    animated.push((t) => {
      ring.scale.setScalar(1.0 + Math.sin(t * 3.2) * 0.06);
    });
  }

  const terrainProtected = new Set([water, cliffLower, shoreShelf, cliffBase, lawn, grassInst]);
  const hiddenByBattle = [];
  let _lastT = 0;
  return {
    isInterior: false,
    group,
    colliders,
    coastOutline,
    terraces,
    waterChannels,
    bridges,
    piers,
    roads,
    tallGrassPatches: patches,
    houseInteractables,
    shrineInteractables,
    berryInteractables,
    chestInteractables,
    ballPickupInteractables,
    loadPromises,
    getHeightAt,
    isInsideCoast,
    clampToCoast,
    setLabelsVisible(visible) {
      for (const s of labelSprites) s.visible = Boolean(visible);
    },
    setBattleClearance(cx, cz, clearRadius = 10.6) {
      while (hiddenByBattle.length > 0) {
        const obj = hiddenByBattle.pop();
        obj.visible = true;
      }
      for (const child of group.children) {
        if (
          terrainProtected.has(child) ||
          child.isInstancedMesh ||
          child.isLight ||
          child.isPoints ||
          (child.userData && child.userData.keepInBattle)
        ) {
          continue;
        }
        const dist = Math.hypot(child.position.x - cx, child.position.z - cz);
        if (dist < clearRadius && child.visible) {
          child.visible = false;
          hiddenByBattle.push(child);
        }
      }
    },
    clearBattleClearance() {
      while (hiddenByBattle.length > 0) {
        const obj = hiddenByBattle.pop();
        obj.visible = true;
      }
    },
    setHeroPosition(x, z) {
      sharedHeroPos.value.set(x, getHeightAt(x, z), z);
    },
    update(timeSec, dt) {
      const stepDt = dt || Math.max(0.001, timeSec - _lastT);
      _lastT = timeSec;
      sharedTime.value = timeSec;
      waterMat.uniforms.uTime.value = timeSec;
      sunbeamMat.uniforms.uTime.value = timeSec;
      for (const fn of animated) fn(timeSec, stepDt);
      for (const b of berryInteractables) {
        if (b.cooldown > 0) {
          b.cooldown = Math.max(0, b.cooldown - stepDt);
          b.berriesGroup.visible = b.cooldown <= 0;
        }
      }
    },
  };
}

/**
 * Builds the Multi-Layered Reactive GLSL 3D Battle Stadium centered at `(cx, cz, baseY)`:
 *  1. Split Elemental Nebula + Hexagonal Lattice + Sacred Glyph + Reactive Shockwave Floor (`createHoloArenaShaderMaterial`)
 *  2. 3D Fresnel Hexagonal Stadium Forcefield Cylinder (`createBattleBarrierDomeShaderMaterial`)
 *  3. Dual Spinning Elemental Summon Pedestal Halos (`createCombatantPadShaderMaterial`) beneath both combatants
 *  4. 6 Orbiting Arcane/Holo Crystal Pylons around the arena perimeter
 */
export function buildBattleArenaGroup(
  cx,
  cz,
  radius = 6.6,
  { playerColor = '#f59e0b', enemyColor = '#ef4444', baseY = 0, isBoss = false } = {},
) {
  const g = new THREE.Group();
  g.position.set(cx, baseY, cz);

  // Elevated Dark Obsidian-Starlight 3D Stadium Dais (`height 0.44m`) so grass never pokes through
  // and the multi-layered GLSL arena shaders shine with rich jewel-toned contrast!
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 1.09, 0.44, 64),
    new THREE.MeshStandardMaterial({
      color: 0x071121,
      roughness: 0.32,
      metalness: 0.42,
    }),
  );
  dais.position.y = -0.23;
  g.add(dais);

  const daisBaseRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.06, 0.08, 10, 64),
    new THREE.MeshStandardMaterial({
      color: isBoss ? 0xf97316 : 0x38bdf8,
      emissive: isBoss ? 0xea580c : 0x0284c7,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    }),
  );
  daisBaseRing.rotation.x = Math.PI / 2;
  daisBaseRing.position.y = -0.38;
  g.add(daisBaseRing);

  const floorMat = createHoloArenaShaderMaterial({
    primaryColor: '#38bdf8',
    accentColor: isBoss ? '#fb923c' : '#fde047',
    playerColor,
    enemyColor,
    intensity: isBoss ? 1.45 : 1.15,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  g.add(floor);

  // 3D Fresnel Hexagonal Forcefield Dome Wall
  const domeMat = createBattleBarrierDomeShaderMaterial({
    playerColor,
    enemyColor,
    accentColor: isBoss ? '#fb923c' : '#fde047',
  });
  const domeWall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, isBoss ? 4.2 : 3.2, 48, 1, true),
    domeMat,
  );
  domeWall.position.y = (isBoss ? 4.2 : 3.2) * 0.5;
  g.add(domeWall);

  // Glowing containment rim torus
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.12, 12, 64),
    new THREE.MeshBasicMaterial({ color: isBoss ? 0xfb923c : 0xfde047 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  // Player & Enemy Spinning Summon Pedestals (matching BattleController slot offsets `(-3.2, 0.85)` & `(3.1, -0.85)`)
  const playerPadMat = createCombatantPadShaderMaterial({ color: playerColor });
  const playerPad = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), playerPadMat);
  playerPad.rotation.x = -Math.PI / 2;
  playerPad.position.set(-3.15, 0.02, 0.85);
  g.add(playerPad);

  const enemyPadMat = createCombatantPadShaderMaterial({ color: enemyColor });
  const enemyPad = new THREE.Mesh(new THREE.PlaneGeometry(isBoss ? 4.2 : 3.4, isBoss ? 4.2 : 3.4), enemyPadMat);
  enemyPad.rotation.x = -Math.PI / 2;
  enemyPad.position.set(3.15, 0.02, -0.85);
  g.add(enemyPad);

  // 6 Floating Rotating Holo-Crystals around the perimeter!
  const crystalPylons = [];
  const pylonGeo = new THREE.OctahedronGeometry(0.28, 0);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: isBoss ? 0xf97316 : 0x38bdf8,
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.scale.set(0.75, 1.65, 0.75);
    pylon.position.set(Math.cos(a) * radius, 0.72, Math.sin(a) * radius);
    g.add(pylon);
    crystalPylons.push({ mesh: pylon, baseAngle: a });
  }

  let shockTimer = -1;
  let playerFlare = 0;
  let enemyFlare = 0;
  let domePulse = 0;

  g.userData.setElementColors = (pHex, eHex) => {
    if (pHex) {
      floorMat.uniforms.uPlayerColor.value.set(pHex);
      domeMat.uniforms.uPlayerColor.value.set(pHex);
      playerPadMat.uniforms.uColor.value.set(pHex);
    }
    if (eHex) {
      floorMat.uniforms.uEnemyColor.value.set(eHex);
      domeMat.uniforms.uEnemyColor.value.set(eHex);
      enemyPadMat.uniforms.uColor.value.set(eHex);
    }
  };

  g.userData.flareCombatant = (side, amount = 1.0) => {
    if (side === 'player') playerFlare = Math.max(playerFlare, amount);
    else enemyFlare = Math.max(enemyFlare, amount);
    domePulse = Math.max(domePulse, amount * 0.7);
  };

  g.userData.triggerShockwave = (localX = 0, localZ = 0, colorHex = '#fde047') => {
    // Map local `(x, z)` into disk `vUv` (`-1..1`; note `CircleGeometry` rotated `-PI/2` around X has `uv.y` inverted along `-Z`)
    floorMat.uniforms.uShockOrigin.value.set(
      Math.max(-0.95, Math.min(0.95, localX / radius)),
      Math.max(-0.95, Math.min(0.95, -localZ / radius)),
    );
    floorMat.uniforms.uShockColor.value.set(colorHex);
    shockTimer = 0.0;
    domePulse = 1.0;
  };

  let lastTime = 0;
  g.userData.update = (timeSec) => {
    const dt = lastTime > 0 ? Math.min(0.05, Math.max(0.001, timeSec - lastTime)) : 0.016;
    lastTime = timeSec;

    floorMat.uniforms.uTime.value = timeSec;
    domeMat.uniforms.uTime.value = timeSec;
    playerPadMat.uniforms.uTime.value = timeSec;
    enemyPadMat.uniforms.uTime.value = timeSec;

    if (shockTimer >= 0) {
      shockTimer += dt * 1.45;
      if (shockTimer > 1.0) {
        shockTimer = -1;
        floorMat.uniforms.uShockProgress.value = -1.0;
      } else {
        floorMat.uniforms.uShockProgress.value = shockTimer;
      }
    }

    playerFlare = Math.max(0, playerFlare - dt * 1.8);
    enemyFlare = Math.max(0, enemyFlare - dt * 1.8);
    domePulse = Math.max(0, domePulse - dt * 1.6);
    playerPadMat.uniforms.uFlare.value = playerFlare;
    enemyPadMat.uniforms.uFlare.value = enemyFlare;
    domeMat.uniforms.uPulse.value = domePulse;

    for (let i = 0; i < crystalPylons.length; i++) {
      const cp = crystalPylons[i];
      cp.mesh.position.y = 0.68 + Math.sin(timeSec * 2.8 + i * 1.05) * 0.14;
      cp.mesh.rotation.y = timeSec * 1.9 + i;
    }
  };

  return g;
}
