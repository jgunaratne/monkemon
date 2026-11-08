// 2.5D Realistic Toy-Diorama Zone Builder (Nano Banana PBR Textures + Custom GLSL Shaders)
// Constructs each of the 5 interconnected islands with:
// - Seamless Nano Banana PBR albedo + tangent-space normal maps (`assets/textures/*.jpg`)
// - Custom GLSL Ocean / Caustics / Fresnel / SDF Shoreline Surf Foam & Convective Magma Shader
// - Custom GLSL Terrain Anti-Tiling + Cloud-Dappled Sunlight Shader
// - Custom GLSL Wind-Swaying 5-Blade Curved 3D Grass Clumps (parting around the player!)
// - Volumetric Sunbeam Light Shafts + Warm Lamp/Shrine PointLights + Rich 3D Props & Waterfalls!

import * as THREE from 'three';
import { ASSET_VERSION } from './audio.js';
import { makeLabelSprite } from './model_loader.js';
import {
  attachCliffWetnessShader,
  attachFoliageSubsurfaceShader,
  attachTerrainDetailShader,
  attachWindGrassShader,
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

function withVer(url) {
  return `${url}?v=${ASSET_VERSION}`;
}

function loadRepeatTexture(url, isSRGB = true) {
  const key = `${url}:${isSRGB ? 'srgb' : 'lin'}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const tex = _texLoader.load(withVer(url));
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _texCache.set(key, tex);
  return tex;
}

function cloneRepeatPair(baseName, rx, rz) {
  const baseMap = loadRepeatTexture(`assets/textures/${baseName}.jpg`, true);
  const baseNormal = loadRepeatTexture(`assets/textures/${baseName}_normal.jpg`, false);

  const map = baseMap.clone();
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, rz);
  map.needsUpdate = true;
  if (baseMap.image) {
    map.image = baseMap.image;
  } else {
    baseMap.onUpdate = () => {
      map.image = baseMap.image;
      map.needsUpdate = true;
    };
  }

  const normalMap = baseNormal.clone();
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, rz);
  normalMap.needsUpdate = true;
  if (baseNormal.image) {
    normalMap.image = baseNormal.image;
  } else {
    baseNormal.onUpdate = () => {
      normalMap.image = baseNormal.image;
      normalMap.needsUpdate = true;
    };
  }

  // Simpler & guaranteed immediate sync: if `rx === 1 && rz === 1`, return shared directly!
  return { map: rx === 1 && rz === 1 ? baseMap : map, normalMap: rx === 1 && rz === 1 ? baseNormal : normalMap };
}

function loadDedicatedPair(baseName, rx, rz) {
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
 * Builds a multi-blade curved 3D grass tuft `BufferGeometry` (5 arched tapered blades per clump)
 * so meadows look lush and natural instead of spiky cones!
 */
function getCurvedGrassClumpGeometry() {
  if (_cachedGrassClumpGeo) return _cachedGrassClumpGeo;

  const positions = [];
  const normals = [];
  const bladeConfigs = [
    { angle: 0.0, lean: 0.16, h: 0.62, w: 0.058, ox: 0.0, oz: 0.0 },
    { angle: 1.25, lean: 0.24, h: 0.54, w: 0.052, ox: 0.07, oz: 0.04 },
    { angle: 2.51, lean: 0.22, h: 0.58, w: 0.054, ox: -0.06, oz: 0.06 },
    { angle: 3.77, lean: 0.26, h: 0.49, w: 0.048, ox: -0.07, oz: -0.05 },
    { angle: 5.02, lean: 0.2, h: 0.55, w: 0.05, ox: 0.06, oz: -0.06 },
  ];

  const segs = 3;
  for (const bc of bladeConfigs) {
    const ca = Math.cos(bc.angle);
    const sa = Math.sin(bc.angle);
    // Tangent along blade width (perpendicular to lean direction)
    const wx = -sa;
    const wz = ca;

    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const y0 = t0 * bc.h;
      const y1 = t1 * bc.h;
      const curve0 = t0 * t0 * bc.lean;
      const curve1 = t1 * t1 * bc.lean;
      const w0 = bc.w * (1.0 - t0 * 0.78);
      const w1 = bc.w * (1.0 - t1 * 0.94);

      const cx0 = bc.ox + ca * curve0;
      const cz0 = bc.oz + sa * curve0;
      const cx1 = bc.ox + ca * curve1;
      const cz1 = bc.oz + sa * curve1;

      const p0L = [cx0 - wx * w0, y0, cz0 - wz * w0];
      const p0R = [cx0 + wx * w0, y0, cz0 + wz * w0];
      const p1L = [cx1 - wx * w1, y1, cz1 - wz * w1];
      const p1R = [cx1 + wx * w1, y1, cz1 + wz * w1];

      // Upward-tilted normal so both sides catch warm sunlight smoothly
      const nx = ca * 0.35;
      const ny = 0.88;
      const nz = sa * 0.35;

      if (s === segs - 1) {
        const tip = [cx1, y1 + 0.04, cz1];
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

export function buildZoneDiorama(zone, modelBank) {
  const group = new THREE.Group();
  const colliders = []; // { x, z, r } circular obstacles for smooth 2.5D sliding collision
  const animated = [];  // (timeSec) => void
  const labelSprites = []; // hidden cleanly during Arena Battles so HUD stays 100% readable!
  const loadPromises = [];

  const { halfW, halfD } = zone.bounds;
  const rand = seededRand((zone.index || 1) * 98765 + 1337);
  const theme = zone.theme || 'tropical';
  const isSoftwareGl = Boolean(modelBank && modelBank.isSoftwareGl);

  const sharedTime = { value: 0 };
  const sharedHeroPos = { value: new THREE.Vector3(0, -99, 0) };

  // Helper to check if a decorative prop would sit on top of a path, plaza, house, trainer, boss, or gateway
  const isClearSpot = (x, z, minClear = 3.0) => {
    if (Math.hypot(x, z - 2.0) < 5.8) return false;
    if (Math.hypot(x - zone.playerSpawn.x, z - zone.playerSpawn.z) < 3.6) return false;
    for (const h of zone.houses || []) {
      if (Math.hypot(x - h.x, z - h.z) < (h.scale || 4.4) * 0.74 + minClear * 0.5) return false;
      if (Math.hypot(x - h.x, z - (h.z + 2.8)) < 3.4) return false;
    }
    for (const gw of zone.gateways || []) {
      if (Math.hypot(x - gw.x, z - gw.z) < 4.9) return false;
    }
    for (const tr of zone.trainers || []) {
      if (Math.hypot(x - tr.x, z - tr.z) < 3.2) return false;
    }
    for (const ap of zone.apexSpawns || []) {
      if (Math.hypot(x - ap.x, z - ap.z) < 7.2) return false;
    }
    for (const sh of zone.shrines || []) {
      if (Math.hypot(x - sh.x, z - sh.z) < 3.2) return false;
    }
    for (const bt of zone.berryTrees || []) {
      if (Math.hypot(x - bt.x, z - bt.z) < 2.8) return false;
    }
    return true;
  };

  // 1. Custom GLSL Ocean / Caustics / Fresnel / SDF Shoreline Surf Foam & Convective Magma Shader!
  const waterSegs = isSoftwareGl ? 36 : 84;
  const waterGeo = new THREE.PlaneGeometry(220, 220, waterSegs, waterSegs);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = createOceanMagmaShaderMaterial({
    waterColor: zone.waterColor || '#1496c8',
    deepColor: theme === 'harbor' ? '#073b66' : '#0a4f80',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || zone.skyColor || '#9be4ff',
    fogNear: 40,
    fogFar: 88,
    islandHalfW: halfW,
    islandHalfD: halfD,
    theme,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.82;
  group.add(water);

  // 2. Multi-Tiered Beveled Cliff Strata + Nano Banana PBR Normal-Mapped Island Terrain!
  const cliffTexName = theme === 'volcano' ? 'volcano_basalt' : 'cliff_rock';
  const cliffPair = loadDedicatedPair(cliffTexName, Math.round(halfW * 0.42), 2);
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
    normalScale: new THREE.Vector2(1.1, 1.1),
    color: new THREE.Color(cliffTint).multiplyScalar(0.78),
    roughness: 0.82,
  });
  attachCliffWetnessShader(cliffLowerMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });
  const cliffLower = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2.9, 0.95, halfD * 2 + 2.9),
    cliffLowerMat,
  );
  cliffLower.position.y = -0.96;
  group.add(cliffLower);

  const cliffBaseMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    color: cliffTint,
    roughness: 0.76,
  });
  attachCliffWetnessShader(cliffBaseMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });
  const cliffBase = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2.0, 1.18, halfD * 2 + 2.0),
    cliffBaseMat,
  );
  cliffBase.position.y = -0.68;
  cliffBase.receiveShadow = !isSoftwareGl;
  group.add(cliffBase);

  // Select Nano Banana PBR Ground Texture Pair per Biome
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
  const groundRx = Math.max(5, Math.round(halfW * 0.48));
  const groundRz = Math.max(5, Math.round(halfD * 0.48));
  const lawnPair = loadDedicatedPair(groundTexName, groundRx, groundRz);

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
    dappleStrength: theme === 'volcano' ? 0.08 : 0.18,
  });

  const lawn = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.85, 0.44, halfD * 2 + 0.85), lawnMat);
  lawn.position.y = -0.22;
  lawn.receiveShadow = !isSoftwareGl;
  group.add(lawn);

  // 3. Nano Banana Cobblestone Avenues with 3D Chiselled Stone Curbs & Central Monkeball Plaza!
  const curbMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    color: theme === 'volcano' ? '#78716c' : '#fde68a',
    roughness: 0.65,
  });

  const pathTint =
    theme === 'volcano'
      ? '#a8a29e'
      : theme === 'snow'
        ? '#e2e8f0'
        : '#fff7ed';

  const addPathSegment = (x0, z0, x1, z1, width = 2.65) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const repY = Math.max(1, Math.round(len / 2.6));
    const pair = loadDedicatedPair('cobble_path', 1, repY);
    const segMat = new THREE.MeshStandardMaterial({
      map: pair.map,
      normalMap: pair.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: pathTint,
      roughness: 0.72,
    });
    const segGroup = new THREE.Group();
    segGroup.position.set((x0 + x1) * 0.5, 0, (z0 + z1) * 0.5);
    segGroup.rotation.y = Math.atan2(dx, dz);

    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.065, len + width * 0.42), segMat);
    seg.position.y = 0.018;
    seg.receiveShadow = !isSoftwareGl;
    segGroup.add(seg);

    // Subtle 3D stone curb trim along both edges of the cobblestone road
    const curbGeo = new THREE.BoxGeometry(0.16, 0.085, len + width * 0.25);
    const curbL = new THREE.Mesh(curbGeo, curbMat);
    curbL.position.set(-width * 0.5 - 0.04, 0.025, 0);
    const curbR = new THREE.Mesh(curbGeo, curbMat);
    curbR.position.set(width * 0.5 + 0.04, 0.025, 0);
    segGroup.add(curbL, curbR);

    group.add(segGroup);
  };

  // Central town plaza with Nano Banana cobble_path + golden Monkeball mosaic
  const plazaPair = loadDedicatedPair('cobble_path', 3, 3);
  const plazaMat = new THREE.MeshStandardMaterial({
    map: plazaPair.map,
    normalMap: plazaPair.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    color: pathTint,
    roughness: 0.68,
  });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 5.1, 0.07, 40), plazaMat);
  plaza.position.set(0, 0.022, 2.0);
  plaza.receiveShadow = !isSoftwareGl;
  group.add(plaza);

  const plazaRim = new THREE.Mesh(
    new THREE.TorusGeometry(4.82, 0.14, 10, 48),
    new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.38, metalness: 0.18 }),
  );
  plazaRim.rotation.x = Math.PI / 2;
  plazaRim.position.set(0, 0.06, 2.0);
  group.add(plazaRim);

  const medallionOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 0.08, 28),
    new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.38, metalness: 0.12 }),
  );
  medallionOuter.position.set(0, 0.03, 2.0);
  const medallionBand = new THREE.Mesh(
    new THREE.BoxGeometry(3.52, 0.085, 0.26),
    new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4 }),
  );
  medallionBand.position.set(0, 0.032, 2.0);
  const medallionCenter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.64, 0.64, 0.095, 24),
    new THREE.MeshStandardMaterial({ color: '#fef9c3', roughness: 0.28, metalness: 0.15 }),
  );
  medallionCenter.position.set(0, 0.036, 2.0);
  group.add(medallionOuter, medallionBand, medallionCenter);

  for (const h of zone.houses || []) {
    addPathSegment(0, 2.0, h.x, h.z + 2.4, 2.6);
  }
  for (const gw of zone.gateways || []) {
    addPathSegment(0, 2.0, gw.x * 0.93, gw.z * 0.93, 2.75);
  }

  // Warm Toy Streetlamps + Real Dynamic PointLights!
  let pointLightBudget = isSoftwareGl ? 0 : 4;
  const addWarmPointLight = (x, y, z, colorHex, intensity = 2.8, dist = 11.5) => {
    if (pointLightBudget <= 0) return;
    pointLightBudget -= 1;
    const pl = new THREE.PointLight(colorHex, intensity, dist, 1.7);
    pl.position.set(x, y, z);
    group.add(pl);
  };

  const addStreetLamp = (lx, lz) => {
    const lg = new THREE.Group();
    lg.position.set(lx, 0, lz);
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
        emissiveIntensity: 1.45, // triggers subtle UnrealBloomPass halo!
        roughness: 0.12,
      }),
    );
    bulb.position.y = 2.5;
    lg.add(base, pole, cap, bulb);
    group.add(lg);
    addWarmPointLight(lx, 2.6, lz, 0xffd166, 2.6, 11.0);
    colliders.push({ x: lx, z: lz, r: 0.42 });
  };
  addStreetLamp(-4.9, 4.4);
  addStreetLamp(4.9, 4.4);

  // 3b. Handcrafted Timber Perimeter Fences (`wood_timber` Nano Banana PBR!)
  const woodPair = loadDedicatedPair('wood_timber', 2, 1);
  const fenceColor =
    theme === 'volcano'
      ? '#78716c'
      : theme === 'harbor'
        ? '#f8fafc'
        : theme === 'snow'
          ? '#e2e8f0'
          : '#fde68a';
  const fenceAccent = theme === 'volcano' ? '#f97316' : '#b45309';
  const fenceMat = new THREE.MeshStandardMaterial({
    map: woodPair.map,
    normalMap: woodPair.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: fenceColor,
    roughness: 0.58,
  });
  const fenceCapMat = new THREE.MeshStandardMaterial({ color: fenceAccent, roughness: 0.45, metalness: 0.1 });

  const nearAnyGateway = (x, z) =>
    (zone.gateways || []).some((gw) => Math.hypot(gw.x - x, gw.z - z) < 4.5);

  const addFenceSpan = (x0, z0, x1, z1) => {
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    if (nearAnyGateway(mx, mz) || nearAnyGateway(x0, z0) || nearAnyGateway(x1, z1)) return;
    const fg = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.22, 0.74, 0.22);
    const pA = new THREE.Mesh(postGeo, fenceMat);
    pA.position.set(x0, 0.37, z0);
    if (!isSoftwareGl) pA.castShadow = true;
    const capA = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), fenceCapMat);
    capA.position.set(x0, 0.78, z0);
    fg.add(pA, capA);

    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    for (const ry of [0.26, 0.53]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, len), fenceMat);
      rail.position.set(mx, ry, mz);
      rail.rotation.y = ang;
      fg.add(rail);
    }
    group.add(fg);
  };

  const fStep = 3.2;
  const fxEdge = halfW - 0.55;
  const fzEdge = halfD - 0.55;
  for (let x = -fxEdge + 1.2; x < fxEdge - 1.2; x += fStep) {
    const nx = Math.min(fxEdge - 1.2, x + fStep);
    addFenceSpan(x, -fzEdge, nx, -fzEdge);
    addFenceSpan(x, fzEdge, nx, fzEdge);
  }
  for (let z = -fzEdge + 1.2; z < fzEdge - 1.2; z += fStep) {
    const nz = Math.min(fzEdge - 1.2, z + fStep);
    addFenceSpan(-fxEdge, z, -fxEdge, nz);
    addFenceSpan(fxEdge, z, fxEdge, nz);
  }

  // 4. Custom GLSL Wind-Swaying Multi-Blade 3D Grass Clumps (520 tufts = 2,600 arched blades!)
  const grassCount = theme === 'harbor' ? 180 : theme === 'volcano' ? 160 : 520;
  const clumpGeo = getCurvedGrassClumpGeometry();
  const grassMat = new THREE.MeshStandardMaterial({
    roughness: 0.46,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  attachWindGrassShader(grassMat, {
    uTime: sharedTime,
    uHeroPos: sharedHeroPos,
    windStrength: theme === 'snow' ? 0.15 : 0.24,
  });

  const grassInst = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
  const grassPalette =
    theme === 'snow'
      ? ['#bae6fd', '#e0f2fe', '#93c5fd']
      : theme === 'volcano'
        ? ['#fb923c', '#f97316', '#facc15']
        : theme === 'forest'
          ? ['#4ade80', '#22c55e', '#84cc16', '#a3e635']
          : ['#22c55e', '#4ade80', '#16a34a', '#86efac'];

  const dummy = new THREE.Object3D();
  const gCol = new THREE.Color();
  let placedGrass = 0;
  for (let i = 0; i < grassCount * 3 && placedGrass < grassCount; i++) {
    const gx = (rand() * 2 - 1) * (halfW - 1.6);
    const gz = (rand() * 2 - 1) * (halfD - 1.6);
    if (Math.hypot(gx, gz - 2.0) < 5.3) continue;
    // Keep cobblestones clean
    let onRoad = false;
    for (const h of zone.houses || []) {
      const t = Math.max(0, Math.min(1, ((gx * h.x + (gz - 2) * (h.z + 0.4)) / (h.x * h.x + (h.z + 0.4) * (h.z + 0.4) + 0.01))));
      if (Math.hypot(gx - h.x * t, gz - (2 + (h.z + 0.4) * t)) < 1.6) onRoad = true;
    }
    if (onRoad) continue;

    dummy.position.set(gx, 0, gz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.78 + rand() * 0.78;
    dummy.scale.set(s, s * (0.85 + rand() * 0.4), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass, dummy.matrix);
    gCol.set(grassPalette[placedGrass % grassPalette.length]);
    grassInst.setColorAt(placedGrass, gCol);
    placedGrass++;
  }
  grassInst.count = placedGrass;
  if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
  group.add(grassInst);

  // Glossy Wildflower Blossoms / Snow-Crystals / Ember-Gems
  const flowerCount = 110;
  const flowerGeo = new THREE.CylinderGeometry(0.21, 0.07, 0.11, 6);
  flowerGeo.translate(0, 0.09, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.28 });
  const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  const flowerPalette =
    theme === 'volcano'
      ? ['#fb923c', '#facc15', '#ef4444']
      : theme === 'snow'
        ? ['#e0f2fe', '#7dd3fc', '#c4b5fd']
        : ['#f472b6', '#facc15', '#38bdf8', '#fb7185', '#ffffff'];
  const fColor = new THREE.Color();
  let placedFlowers = 0;
  for (let i = 0; i < flowerCount * 3 && placedFlowers < flowerCount; i++) {
    const fx = (rand() * 2 - 1) * (halfW - 2.0);
    const fz = (rand() * 2 - 1) * (halfD - 2.0);
    if (!isClearSpot(fx, fz, 1.8)) continue;
    dummy.position.set(fx, 0.015, fz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.8 + rand() * 0.65;
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

  // 4b. Rich Environment Scenery: Mossy 3D Boulders, Flowering Bushes, Wooden Benches & Crates!
  const rockMat = new THREE.MeshStandardMaterial({
    map: cliffPair.map,
    normalMap: cliffPair.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: theme === 'snow' ? '#e2e8f0' : theme === 'volcano' ? '#57534e' : '#d6c7b2',
    roughness: 0.78,
  });
  attachCliffWetnessShader(rockMat, { uTime: sharedTime, isVolcano: theme === 'volcano' });
  const bushMat = new THREE.MeshStandardMaterial({
    color: theme === 'snow' ? '#0f766e' : theme === 'forest' ? '#15803d' : '#16a34a',
    roughness: 0.48,
  });
  attachFoliageSubsurfaceShader(bushMat, { uTime: sharedTime, windAmp: 0.045 });

  // Shared wind-swaying + subsurface-translucency canopy foliage materials for island trees
  const palmFrondMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.36 }),
    { uTime: sharedTime, windAmp: 0.085, sssColor: '#bef264' },
  );
  const pineBoughMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({ color: '#0f766e', roughness: 0.48 }),
    { uTime: sharedTime, windAmp: 0.04, sssColor: '#7dd3fc' },
  );
  const groveGreenMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.38 }),
    { uTime: sharedTime, windAmp: 0.065, sssColor: '#bef264' },
  );
  const groveGoldMat = attachFoliageSubsurfaceShader(
    new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.36 }),
    { uTime: sharedTime, windAmp: 0.065, sssColor: '#fde047' },
  );

  const addBoulderCluster = (bx, bz, scale = 1.0) => {
    const bg = new THREE.Group();
    bg.position.set(bx, 0, bz);
    const mainRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68 * scale, 1), rockMat);
    mainRock.scale.set(1.18, 0.76, 0.96);
    mainRock.position.y = 0.34 * scale;
    if (!isSoftwareGl) {
      mainRock.castShadow = true;
      mainRock.receiveShadow = true;
    }
    const subRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42 * scale, 1), rockMat);
    subRock.position.set(0.52 * scale, 0.22 * scale, 0.24 * scale);
    bg.add(mainRock, subRock);

    if (theme !== 'volcano') {
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.42 * scale, 12, 10), bushMat);
      shrub.scale.set(1.2, 0.78, 1.1);
      shrub.position.set(-0.42 * scale, 0.28 * scale, 0.28 * scale);
      bg.add(shrub);
    }
    bg.rotation.y = rand() * Math.PI * 2;
    group.add(bg);
    colliders.push({ x: bx, z: bz, r: 0.75 * scale });
  };

  for (let i = 0; i < 10; i++) {
    const rx = (rand() * 2 - 1) * (halfW - 2.6);
    const rz = (rand() * 2 - 1) * (halfD - 2.6);
    if (isClearSpot(rx, rz, 3.2)) {
      addBoulderCluster(rx, rz, 0.8 + rand() * 0.45);
    }
  }

  // Cozy Wooden Park Benches flanking the Town Plaza (`wood_timber` PBR!)
  const benchTimberMat = new THREE.MeshStandardMaterial({
    map: woodPair.map,
    normalMap: woodPair.normalMap,
    color: '#d97706',
    roughness: 0.56,
  });
  const addParkBench = (bx, bz, rotY) => {
    if (!isClearSpot(bx, bz, 1.2) && Math.hypot(bx, bz - 2.0) < 4.5) return;
    const bg = new THREE.Group();
    bg.position.set(bx, 0, bz);
    bg.rotation.y = rotY;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 0.52), benchTimberMat);
    seat.position.y = 0.42;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 0.09), benchTimberMat);
    back.position.set(0, 0.68, -0.22);
    back.rotation.x = -0.14;
    const legGeo = new THREE.BoxGeometry(0.12, 0.42, 0.48);
    const legMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.45, metalness: 0.35 });
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-0.62, 0.21, 0);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(0.62, 0.21, 0);
    if (!isSoftwareGl) seat.castShadow = true;
    bg.add(seat, back, legL, legR);
    group.add(bg);
    colliders.push({ x: bx, z: bz, r: 0.65 });
  };
  addParkBench(-5.4, 2.0, Math.PI * 0.5);
  addParkBench(5.4, 2.0, -Math.PI * 0.5);

  // 5. Sculpted Multi-Part Biome Trees & Shoreline Landmarks
  const addToyTree = (tx, tz) => {
    const tg = new THREE.Group();
    tg.position.set(tx, 0, tz);

    if (theme === 'tropical') {
      const barkMat = new THREE.MeshStandardMaterial({
        map: woodPair.map,
        normalMap: woodPair.normalMap,
        color: '#b45309',
        roughness: 0.65,
      });
      const leanDir = rand() * Math.PI * 2;
      let px = 0;
      let pz = 0;
      for (let seg = 0; seg < 5; seg++) {
        const segMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24 - seg * 0.022, 0.28 - seg * 0.02, 0.56, 10),
          barkMat,
        );
        px += Math.cos(leanDir) * 0.09 * (seg + 1) * 0.35;
        pz += Math.sin(leanDir) * 0.09 * (seg + 1) * 0.35;
        segMesh.position.set(px, 0.28 + seg * 0.48, pz);
        segMesh.rotation.z = -Math.cos(leanDir) * 0.08 * seg;
        segMesh.rotation.x = Math.sin(leanDir) * 0.08 * seg;
        if (!isSoftwareGl) segMesh.castShadow = true;
        tg.add(segMesh);
      }
      const topY = 2.65;
      for (let f = 0; f < 5; f++) {
        const ang = (f / 5) * Math.PI * 2 + leanDir;
        const frond = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), palmFrondMat);
        frond.scale.set(1.55, 0.22, 0.55);
        frond.position.set(px + Math.cos(ang) * 0.82, topY - 0.08, pz + Math.sin(ang) * 0.82);
        frond.rotation.y = -ang;
        frond.rotation.z = -0.38;
        if (!isSoftwareGl) frond.castShadow = true;
        tg.add(frond);
      }
      const cocoMat = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.45 });
      for (let cIdx = 0; cIdx < 3; cIdx++) {
        const ca = (cIdx / 3) * Math.PI * 2;
        const coco = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), cocoMat);
        coco.position.set(px + Math.cos(ca) * 0.26, topY - 0.24, pz + Math.sin(ca) * 0.26);
        tg.add(coco);
      }
    } else if (theme === 'snow') {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.34, 1.1, 10),
        new THREE.MeshStandardMaterial({ map: woodPair.map, color: '#78350f', roughness: 0.65 }),
      );
      trunk.position.y = 0.55;
      tg.add(trunk);
      const snowCapMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.32 });
      const tiers = [
        { r: 1.25, h: 1.25, y: 1.35 },
        { r: 0.98, h: 1.1, y: 2.15 },
        { r: 0.68, h: 0.95, y: 2.85 },
      ];
      for (const tier of tiers) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 12), pineBoughMat);
        cone.position.y = tier.y;
        if (!isSoftwareGl) cone.castShadow = true;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(tier.r * 0.86, tier.h * 0.55, 12), snowCapMat);
        cap.position.y = tier.y + tier.h * 0.24;
        tg.add(cone, cap);
      }
    } else if (theme === 'volcano') {
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.82, 0), rockMat);
      base.position.y = 0.36;
      const crystalMat = new THREE.MeshStandardMaterial({
        color: '#fb923c',
        emissive: '#ea580c',
        emissiveIntensity: 0.95,
        roughness: 0.16,
      });
      const mainSpire = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), crystalMat);
      mainSpire.scale.set(0.75, 2.25, 0.75);
      mainSpire.position.y = 1.55;
      const sideSpire = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
      sideSpire.scale.set(0.7, 1.75, 0.7);
      sideSpire.position.set(0.48, 1.05, 0.22);
      sideSpire.rotation.z = -0.32;
      tg.add(base, mainSpire, sideSpire);
    } else if (theme === 'harbor') {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.3, 2.0, 12),
        new THREE.MeshStandardMaterial({ map: woodPair.map, color: '#92400e', roughness: 0.58 }),
      );
      post.position.y = 1.0;
      if (!isSoftwareGl) post.castShadow = true;
      const buoy = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.12, 10, 20),
        new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.35 }),
      );
      buoy.position.set(0, 1.15, 0.26);
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 14, 12),
        new THREE.MeshStandardMaterial({
          color: '#fef08a',
          emissive: '#f59e0b',
          emissiveIntensity: 1.25,
          roughness: 0.15,
        }),
      );
      lantern.position.y = 2.18;
      tg.add(post, buoy, lantern);
    } else {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.38, 1.9, 10),
        new THREE.MeshStandardMaterial({ map: woodPair.map, color: '#92400e', roughness: 0.62 }),
      );
      trunk.position.y = 0.95;
      if (!isSoftwareGl) trunk.castShadow = true;
      const crown1 = new THREE.Mesh(new THREE.SphereGeometry(1.22, 16, 14), groveGreenMat);
      crown1.position.y = 2.25;
      crown1.scale.set(1.12, 0.88, 1.12);
      if (!isSoftwareGl) crown1.castShadow = true;
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 12), groveGoldMat);
      crown2.position.set(0.38, 2.95, -0.18);
      const crown3 = new THREE.Mesh(new THREE.SphereGeometry(0.76, 14, 12), groveGreenMat);
      crown3.position.set(-0.42, 2.72, 0.28);
      tg.add(trunk, crown1, crown2, crown3);
    }

    group.add(tg);
    colliders.push({ x: tx, z: tz, r: 0.95 });
  };

  const borderTrees = [
    [-halfW + 2.5, -halfD + 2.9],
    [halfW - 2.5, -halfD + 2.9],
    [-halfW + 2.5, halfD - 2.9],
    [halfW - 2.5, halfD - 2.9],
    [-halfW + 2.7, -6.5],
    [-halfW + 2.7, 8.5],
    [halfW - 2.7, -7.5],
    [halfW - 2.7, 9.5],
    [-9.5, -halfD + 2.9],
    [10.5, -halfD + 2.9],
  ];
  for (const [bx, bz] of borderTrees) {
    if (!nearAnyGateway(bx, bz) && isClearSpot(bx, bz, 1.8)) addToyTree(bx, bz);
  }

  // 5b. Scenic Outer-Sea Rock Islets & Cliffside Waterfall!
  const outerIslets = [
    [-halfW - 8.5, -halfD + 4.0, 2.1],
    [halfW + 9.2, -halfD + 6.5, 1.8],
    [-halfW - 9.0, halfD - 3.5, 1.7],
    [halfW + 8.6, halfD - 4.5, 2.2],
  ];
  for (const [ix, iz, sc] of outerIslets) {
    const islet = new THREE.Group();
    islet.position.set(ix, -0.82, iz);
    const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 1), rockMat);
    mound.scale.set(1.35, 0.72, 1.15);
    mound.position.y = sc * 0.22;
    const topPatch = new THREE.Mesh(
      new THREE.CylinderGeometry(sc * 0.78, sc * 0.95, 0.25, 12),
      lawnMat,
    );
    topPatch.position.y = sc * 0.62;
    islet.add(mound, topPatch);
    group.add(islet);
  }

  // Animated Cliffside Waterfall Cascade on Tropical / Forest / Snow Islands
  if (theme === 'tropical' || theme === 'forest' || theme === 'snow') {
    const wfX = -halfW - 0.95;
    const wfZ = 2.2;
    if (!nearAnyGateway(wfX, wfZ)) {
      const wfGroup = new THREE.Group();
      wfGroup.position.set(wfX, -0.42, wfZ);
      const streamMat = new THREE.MeshBasicMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.82,
      });
      const chute = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 2.4), streamMat);
      chute.rotation.z = 0.22;
      const splashRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.18, 8, 24),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.72 }),
      );
      splashRing.rotation.x = Math.PI / 2;
      splashRing.position.set(-0.35, -0.36, 0);
      wfGroup.add(chute, splashRing);
      group.add(wfGroup);
      animated.push((t) => {
        splashRing.scale.setScalar(0.92 + Math.sin(t * 6.5) * 0.14);
        chute.material.opacity = 0.76 + Math.sin(t * 9.0) * 0.1;
      });
    }
  }

  // Biome Water/Shore Vignettes (Bobbing Buoys & Volcano Braziers placed cleanly outside Boss #20's arena!)
  if (theme === 'harbor' || theme === 'tropical') {
    const buoySpots = [
      [-halfW - 4.4, 6.5],
      [halfW + 4.6, -7.0],
      [-11.0, halfD + 4.4],
      [12.5, -halfD - 4.4],
    ];
    buoySpots.forEach(([wx, wz], idx) => {
      const duck = new THREE.Group();
      duck.position.set(wx, -0.76, wz);
      const yellowMat = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.24 });
      const beakMat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.3 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 12), yellowMat);
      body.scale.set(1.2, 0.82, 0.95);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), yellowMat);
      head.position.set(0.42, 0.52, 0);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 8), beakMat);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.84, 0.5, 0);
      duck.add(body, head, beak);
      duck.rotation.y = idx * 1.3;
      group.add(duck);
      animated.push((t) => {
        duck.position.y = -0.72 + Math.sin(t * 2.3 + idx * 1.7) * 0.1;
        duck.rotation.z = Math.sin(t * 1.9 + idx) * 0.08;
      });
    });
  } else if (theme === 'volcano') {
    // Champion Sanctum Flame Braziers framing Boss #20 King Monkezilla (`(8, -6)`) outside `ARENA_RADIUS`!
    for (const [bx, bz] of [
      [0.4, -13.8],
      [15.8, -13.8],
      [0.4, 1.4],
      [15.8, 1.4],
    ]) {
      const br = new THREE.Group();
      br.position.set(bx, 0, bz);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.52, 1.55, 10), rockMat);
      pillar.position.y = 0.77;
      const flame = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.46, 0),
        new THREE.MeshStandardMaterial({
          color: '#fde047',
          emissive: '#f97316',
          emissiveIntensity: 1.55,
          roughness: 0.12,
        }),
      );
      flame.scale.set(0.85, 1.6, 0.85);
      flame.position.y = 1.88;
      br.add(pillar, flame);
      group.add(br);
      addWarmPointLight(bx, 2.2, bz, 0xf97316, 2.8, 12.0);
      colliders.push({ x: bx, z: bz, r: 0.55 });
      animated.push((t) => {
        flame.scale.y = 1.45 + Math.sin(t * 7.5 + bx) * 0.25;
        flame.rotation.y = t * 1.8;
      });
    }
  }

  // 5c. Volumetric Golden Sunbeam Shafts (`createSunbeamShaderMaterial`)!
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
  addSunbeam(0, 2.0, 2.3, 12.5);
  for (const sh of zone.shrines || []) {
    addSunbeam(sh.x, sh.z, 1.6, 10.5);
  }

  // 5d. Ambient Drifting 3D Biome Particles (`THREE.Points`)
  const pCount = 92;
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
  const ambientParticles = new THREE.Points(pGeo, pMat);
  group.add(ambientParticles);

  const risesUp = theme === 'volcano' || theme === 'harbor';
  animated.push((t) => {
    const arr = pGeo.attributes.position.array;
    for (let i = 0; i < pCount; i++) {
      const seed = pSeeds[i];
      const baseY = ((seed * 3.1 + t * (risesUp ? 0.65 : -0.55)) % 6.0 + 6.0) % 6.0;
      arr[i * 3 + 1] = 0.35 + baseY;
      arr[i * 3] += Math.sin(t * 1.2 + seed) * 0.008;
    }
    pGeo.attributes.position.needsUpdate = true;
  });

  // 6. All Spec Houses (`alex_house.glb`, `peanut_butter_house.glb`, `fish_house.glb`, `pork_house.glb`, `beef_house.glb`)
  const houseInteractables = [];
  for (const h of zone.houses || []) {
    const actor = modelBank.spawnActor({
      glbUrl: h.glb,
      scale: h.scale || 4.4,
      primaryColor: '#fb923c',
      secondaryColor: '#fef3c7',
      shadowRadius: (h.scale || 4.4) * 0.42,
    });
    actor.root.position.set(h.x, 0, h.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);

    // Welcoming golden doorstep mat + cozy wooden supply crate beside House!
    const doorZ = h.z + (h.scale || 4.4) * 0.48;
    const matRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.06, 24),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.45,
        roughness: 0.3,
      }),
    );
    matRing.position.set(h.x, 0.03, doorZ);
    group.add(matRing);

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.68, 0.68),
      new THREE.MeshStandardMaterial({
        map: woodPair.map,
        normalMap: woodPair.normalMap,
        color: '#f59e0b',
        roughness: 0.62,
      }),
    );
    crate.position.set(h.x + (h.scale || 4.4) * 0.46, 0.34, h.z + 1.15);
    crate.rotation.y = 0.28;
    if (!isSoftwareGl) crate.castShadow = true;
    group.add(crate);

    const sign = makeLabelSprite({
      title: h.label,
      subtitle: h.sublabel || '',
      badgeText: '🏠 HOUSE',
      badgeColor: '#fbbf24',
      widthWorld: 3.8,
    });
    sign.position.set(h.x, (h.scale || 4.4) * 0.68 + 0.62, h.z);
    group.add(sign);
    labelSprites.push(sign);

    colliders.push({ x: h.x, z: h.z, r: (h.scale || 4.4) * 0.36 });
    houseInteractables.push({
      ...h,
      doorX: h.x,
      doorZ,
      actor,
    });
  }

  // 7. Golden Banana Shrines (`banana_shrine.glb`)
  const shrineInteractables = [];
  for (const sh of zone.shrines || []) {
    const actor = modelBank.spawnActor({
      glbUrl: 'assets/models/banana_shrine.glb',
      scale: 2.7,
      primaryColor: '#facc15',
      secondaryColor: '#fef08a',
      shadowRadius: 1.1,
    });
    actor.root.position.set(sh.x, 0, sh.z);
    group.add(actor.root);
    loadPromises.push(actor.readyPromise);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.38, 28),
      new THREE.MeshBasicMaterial({ color: '#fde047', side: THREE.DoubleSide, transparent: true, opacity: 0.65 }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(sh.x, 0.04, sh.z);
    group.add(halo);
    addWarmPointLight(sh.x, 2.2, sh.z, 0xfde047, 2.4, 9.5);

    const lbl = makeLabelSprite({
      title: 'BANANA SHRINE',
      subtitle: '[A] Blessing (+ATK / Heal)',
      badgeText: '✨',
      badgeColor: '#facc15',
      widthWorld: 3.4,
    });
    lbl.position.set(sh.x, 3.25, sh.z);
    group.add(lbl);
    labelSprites.push(lbl);
    colliders.push({ x: sh.x, z: sh.z, r: 1.0 });
    shrineInteractables.push({ x: sh.x, z: sh.z, actor });
  }

  // 8. Shakeable Peanut-Butter Berry Trees
  const berryInteractables = [];
  for (const bt of zone.berryTrees || []) {
    const tg = new THREE.Group();
    tg.position.set(bt.x, 0, bt.z);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.32, 1.5, 10),
      new THREE.MeshStandardMaterial({ map: woodPair.map, color: '#92400e', roughness: 0.6 }),
    );
    trunk.position.y = 0.75;
    if (!isSoftwareGl) trunk.castShadow = true;
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 16, 14),
      new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.36 }),
    );
    foliage.position.y = 1.92;
    if (!isSoftwareGl) foliage.castShadow = true;
    tg.add(trunk, foliage);

    const berriesGroup = new THREE.Group();
    const berryMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#d97706',
      emissiveIntensity: 0.55,
      roughness: 0.18,
    });
    for (const [bx, by, bz] of [
      [-0.45, 1.65, 0.72],
      [0.42, 1.85, 0.68],
      [0.0, 2.25, 0.76],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), berryMat);
      b.position.set(bx, by, bz);
      berriesGroup.add(b);
    }
    tg.add(berriesGroup);
    group.add(tg);
    colliders.push({ x: bt.x, z: bt.z, r: 0.8 });
    berryInteractables.push({
      x: bt.x,
      z: bt.z,
      group: tg,
      berriesGroup,
      cooldown: 0,
    });
  }

  // 9. Glowing Inter-Zone Gateways with Stone/Wood Arch Pillars
  for (const gw of zone.gateways || []) {
    const portal = new THREE.Group();
    portal.position.set(gw.x, 0, gw.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.15, 12, 32),
      new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 1.15,
        roughness: 0.16,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    portal.add(ring);

    const innerPad = new THREE.Mesh(
      new THREE.CircleGeometry(1.38, 28),
      new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.3, depthWrite: false }),
    );
    innerPad.rotation.x = -Math.PI / 2;
    innerPad.position.y = 0.05;
    portal.add(innerPad);

    const sign = makeLabelSprite({
      title: gw.label,
      badgeText: 'ZONE',
      badgeColor: '#38bdf8',
      widthWorld: 3.6,
    });
    sign.position.set(0, 2.25, 0);
    portal.add(sign);
    labelSprites.push(sign);
    group.add(portal);

    animated.push((t) => {
      ring.scale.setScalar(1.0 + Math.sin(t * 3.2) * 0.06);
    });
  }

  return {
    group,
    colliders,
    houseInteractables,
    shrineInteractables,
    berryInteractables,
    loadPromises,
    setLabelsVisible(visible) {
      for (const s of labelSprites) s.visible = Boolean(visible);
    },
    setHeroPosition(x, z) {
      sharedHeroPos.value.set(x, 0, z);
    },
    update(timeSec, dt) {
      sharedTime.value = timeSec;
      waterMat.uniforms.uTime.value = timeSec;
      sunbeamMat.uniforms.uTime.value = timeSec;
      for (const fn of animated) fn(timeSec);
      for (const b of berryInteractables) {
        if (b.cooldown > 0) {
          b.cooldown = Math.max(0, b.cooldown - dt);
          b.berriesGroup.visible = b.cooldown <= 0;
        }
      }
    },
  };
}

/**
 * Builds the glowing 2.5D Real-Time Tactical Holo-Arena Ring centered at `(cx, cz)`
 * powered by `createHoloArenaShaderMaterial`.
 */
export function buildBattleArenaGroup(cx, cz, radius = 6.6) {
  const g = new THREE.Group();
  g.position.set(cx, 0.04, cz);

  const floorMat = createHoloArenaShaderMaterial({
    primaryColor: '#38bdf8',
    accentColor: '#fde047',
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 56), floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.13, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  // Center line
  const centerLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, radius * 1.92),
    new THREE.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.y = 0.01;
  g.add(centerLine);

  // 4 corner holo-pylons around the arena perimeter
  const pylonGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.62, 10);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(Math.cos(a) * radius, 0.31, Math.sin(a) * radius);
    g.add(pylon);
  }

  g.userData.update = (timeSec) => {
    floorMat.uniforms.uTime.value = timeSec;
  };

  return g;
}
