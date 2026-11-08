// 2.5D Realistic Archipelago Toy-Diorama Builder
// Constructs each of the 5 interconnected non-square islands with:
// - Organic multi-bay / peninsula coastlines (`computeCoastRadiusNorm` + `ExtrudeGeometry`)
// - Sloping sandy beaches, wet mossy coastal cliffs, elevated walkable terraces & 3D stone stairs
// - Flowing rivers / harbor canals / magma rifts spanned by walkable arched 3D bridges & piers
// - TRELLIS.2-4B `.glb` 3D trees, flora, fountains, lighthouses, gazebos, obelisks & supply chests
// - 1,150+ wind-swaying 5-blade curved 3D grass clumps (dense tall-grass wild habitats!)
// - Multi-layered Reactive GLSL Battle Stadium Shader Suite (`buildBattleArenaGroup`)

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSET_VERSION } from './audio.js';
import { makeLabelSprite } from './model_loader.js';
import { getSunDirection, getZoneAtmosphere } from './atmosphere.js';
import { QUALITY_PRESETS } from './renderer.js';
import { createCloudField, createDistantIslands } from './sky.js';
import { REFLECTION_LAYER, markReflective } from './reflection.js';
import { TreeForest, createTreeVariants, makeBarkTexture, makeLeafClusterTexture, makeNeedleTexture } from './flora.js';
import {
  attachCliffWetnessShader,
  attachFoliageSubsurfaceShader,
  attachTerrainDetailShader,
  attachTriplanarRockShader,
  attachWindGrassShader,
  computeCoastRadiusNorm,
  createBattleBarrierDomeShaderMaterial,
  createCombatantPadShaderMaterial,
  createHoloArenaShaderMaterial,
  createOceanMagmaShaderMaterial,
  createStreamChannelShaderMaterial,
  createSunbeamShaderMaterial,
  createWaterfallShaderMaterial,
  attachRibbonEdgeShader,
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
const _ormUsers = new Map(); // ormTexture -> [materials] so a missing packed map degrades gracefully
let _cachedGrassClumpGeo = null;
let _cachedFernGeo = null;
let _cachedFlowerGeo = null;

function withVer(url) {
  return `${url}?v=${ASSET_VERSION}`;
}

/**
 * Loads a PBR texture set: `<name>.jpg` albedo, `<name>_normal.jpg` tangent-space normals and the
 * packed `<name>_orm.jpg` (R = ambient occlusion, G = roughness, B = height). All maps share the
 * primary UV channel so `aoMap` works on plain `ExtrudeGeometry` / `BoxGeometry` without `uv1`.
 */
function loadDedicatedPair(baseName, rx = 1, rz = 1) {
  const key = `ded:${_textureDir}:${baseName}:${rx}:${rz}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const map = _texLoader.load(withVer(texUrl(`${baseName}.jpg`)));
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, rz);
  map.anisotropy = 16;

  const normalMap = _texLoader.load(withVer(texUrl(`${baseName}_normal.jpg`)));
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, rz);
  normalMap.anisotropy = 8;

  const ormMap = _texLoader.load(withVer(texUrl(`${baseName}_orm.jpg`)), undefined, undefined, () => {
    // Packed map missing: strip it from every material that referenced it so roughness/AO fall back to constants
    for (const m of _ormUsers.get(ormMap) || []) {
      if (m.roughnessMap === ormMap) m.roughnessMap = null;
      if (m.aoMap === ormMap) m.aoMap = null;
      m.needsUpdate = true;
    }
    pair.ormMap = null;
  });
  ormMap.colorSpace = THREE.NoColorSpace;
  ormMap.wrapS = THREE.RepeatWrapping;
  ormMap.wrapT = THREE.RepeatWrapping;
  ormMap.repeat.set(rx, rz);
  ormMap.channel = 0;
  ormMap.anisotropy = 4;

  const pair = { map, normalMap, ormMap };
  _texCache.set(key, pair);
  return pair;
}

/** Builds `MeshStandardMaterial` params for a texture set (map + normal + packed roughness/AO). */
let _useOrmMaps = true; // software/mobile tiers skip packed AO/roughness maps
let _textureDir = ''; // '' = 2048² sets, '1k' = downscaled sets for phones / software GL
const texUrl = (file) => `assets/textures/${_textureDir ? `${_textureDir}/` : ''}${file}`;
function pbrParams(pair, extra = {}) {
  const params = { map: pair.map, normalMap: pair.normalMap, ...extra };
  if (pair.ormMap && _useOrmMaps) {
    params.roughnessMap = pair.ormMap;
    params.aoMap = pair.ormMap;
    params.aoMapIntensity = extra.aoMapIntensity ?? 0.85;
  }
  return params;
}

function pbrMaterial(pair, extra = {}) {
  const mat = new THREE.MeshStandardMaterial(pbrParams(pair, extra));
  if (pair.ormMap && _useOrmMaps) {
    if (!_ormUsers.has(pair.ormMap)) _ormUsers.set(pair.ormMap, []);
    _ormUsers.get(pair.ormMap).push(mat);
  }
  return mat;
}

function loadSingleTexture(url, { srgb = false, repeat = true } = {}) {
  const key = `single:${url}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const entry = { texture: null, ready: false, failed: false, onReady: [] };
  entry.texture = _texLoader.load(
    withVer(url),
    () => {
      entry.ready = true;
      for (const fn of entry.onReady) fn(entry.texture);
    },
    undefined,
    () => {
      entry.failed = true;
    },
  );
  entry.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    entry.texture.wrapS = THREE.RepeatWrapping;
    entry.texture.wrapT = THREE.RepeatWrapping;
  }
  entry.texture.anisotropy = 8;
  _texCache.set(key, entry);
  return entry;
}

function whenTextureReady(entry, fn) {
  if (entry.ready) fn(entry.texture);
  else if (!entry.failed) entry.onReady.push(fn);
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

/** Soft-edged grass blade alpha texture (tapered silhouette, light central vein, darker root). */
function makeGrassBladeTexture() {
  const key = '__grass_blade__';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 32;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = 1 - y / (h - 1); // 1 at the tip (row 0), 0 at the root
    const halfWidth = 0.5 * (0.18 + 0.82 * Math.pow(1 - v, 0.55)); // narrow tip, full root
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5;
      const edge = 1 - Math.min(1, Math.abs(u) / Math.max(halfWidth, 0.02));
      const alpha = Math.max(0, Math.min(1, edge * 2.4));
      const vein = Math.exp(-(u * u) / 0.012) * 0.35;
      const shade = 0.78 + 0.22 * v + vein - (1 - edge) * 0.18;
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, shade * 0.95));
      img.data[i + 1] = Math.round(255 * Math.min(1, shade));
      img.data[i + 2] = Math.round(255 * Math.min(1, shade * 0.8));
      img.data[i + 3] = Math.round(255 * alpha);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  _texCache.set(key, tex);
  return tex;
}

/**
 * Builds a dense 12-blade grass tuft: thin, 4-segment, individually arched blades with UVs for the
 * soft-alpha blade texture, so meadows read as real grass instead of flat paddles.
 */
const _cachedGrassLiteGeo = { geo: null };
function getCurvedGrassClumpGeometry(lite = false) {
  if (!lite && _cachedGrassClumpGeo) return _cachedGrassClumpGeo;
  if (lite && _cachedGrassLiteGeo.geo) return _cachedGrassLiteGeo.geo;

  const positions = [];
  const normals = [];
  const uvs = [];
  const bladeCount = lite ? 7 : 12;
  const segs = lite ? 3 : 4;
  let seed = 7;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let b = 0; b < bladeCount; b++) {
    const angle = (b / bladeCount) * Math.PI * 2 + r() * 0.6;
    const lean = 0.14 + r() * 0.2;
    const hgt = 0.42 + r() * 0.42;
    const wid = 0.03 + r() * 0.016;
    const ox = (r() - 0.5) * 0.2;
    const oz = (r() - 0.5) * 0.2;
    const twist = (r() - 0.5) * 0.8;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const wx = -sa;
    const wz = ca;

    for (let sIdx = 0; sIdx < segs; sIdx++) {
      const t0 = sIdx / segs;
      const t1 = (sIdx + 1) / segs;
      const y0 = t0 * hgt;
      const y1 = t1 * hgt;
      const curve0 = t0 * t0 * lean;
      const curve1 = t1 * t1 * lean;
      const w0 = wid * (1.0 - t0 * 0.8);
      const w1 = wid * (1.0 - t1 * 0.97);
      const tw0 = Math.cos(twist * t0);
      const tw1 = Math.cos(twist * t1);
      const cx0 = ox + ca * curve0;
      const cz0 = oz + sa * curve0;
      const cx1 = ox + ca * curve1;
      const cz1 = oz + sa * curve1;
      const p0L = [cx0 - wx * w0 * tw0, y0, cz0 - wz * w0 * tw0];
      const p0R = [cx0 + wx * w0 * tw0, y0, cz0 + wz * w0 * tw0];
      const p1L = [cx1 - wx * w1 * tw1, y1, cz1 - wz * w1 * tw1];
      const p1R = [cx1 + wx * w1 * tw1, y1, cz1 + wz * w1 * tw1];
      // Normals lean outward along the arch and upward for soft, grounded shading
      const nx = ca * (0.3 + 0.3 * t0);
      const ny = 0.9 - 0.25 * t0;
      const nz = sa * (0.3 + 0.3 * t0);
      positions.push(...p0L, ...p0R, ...p1R, ...p0L, ...p1R, ...p1L);
      for (let k = 0; k < 6; k++) normals.push(nx, ny, nz);
      uvs.push(0, t0, 1, t0, 1, t1, 0, t0, 1, t1, 0, t1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (lite) _cachedGrassLiteGeo.geo = geo;
  else _cachedGrassClumpGeo = geo;
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

function hashNoise3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hashNoise3(xi, yi, zi), hashNoise3(xi + 1, yi, zi), u), l(hashNoise3(xi, yi + 1, zi), hashNoise3(xi + 1, yi + 1, zi), u), v),
    l(l(hashNoise3(xi, yi, zi + 1), hashNoise3(xi + 1, yi, zi + 1), u), l(hashNoise3(xi, yi + 1, zi + 1), hashNoise3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/**
 * Noise-displaced icosphere boulder with a flattened, slightly buried base – replaces the old
 * plastic-looking dodecahedra. Smooth normals + triplanar rock shading = convincing stone.
 */
/**
 * Weld a non-indexed polyhedron (Icosahedron/Dodecahedron…) into a smooth-shaded indexed mesh. Per-face
 * normals/uvs are dropped first (mergeVertices hashes every attribute, so they would block the weld);
 * a planar uv is regenerated so materials with a `map` still have a channel.
 */
function weldSmooth(geometry) {
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  const welded = mergeVertices(geometry, 1e-4);
  geometry.dispose();
  const pos = welded.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 0.5;
    uv[i * 2 + 1] = pos.getZ(i) * 0.5;
  }
  welded.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  welded.computeVertexNormals();
  return welded;
}

/** Smooth, gently lumpy foliage clump (welded icosphere + low-frequency noise) for sculpted tree crowns. */
function makeFoliageTuftGeometry(rand, radius = 0.92) {
  const geo = weldSmooth(new THREE.IcosahedronGeometry(radius, 2));
  const pos = geo.attributes.position;
  const seed = rand() * 60;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const n = smoothNoise3((x / len) * 2.4 + seed, (y / len) * 2.4, (z / len) * 2.4);
    const n2 = smoothNoise3((x / len) * 5.2, (y / len) * 5.2 + seed, (z / len) * 5.2);
    const d = 1.0 + (n - 0.5) * 0.22 + (n2 - 0.5) * 0.1;
    pos.setXYZ(i, x * d, y * d, z * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeRockGeometry(rand, radius = 0.7, detail = 2) {
  // Weld the polyhedron's per-face vertices first: smooth rounded shading instead of hard low-poly facets
  const geo = weldSmooth(new THREE.IcosahedronGeometry(radius, detail));
  const pos = geo.attributes.position;
  const seed = rand() * 50;
  const squash = 0.72 + rand() * 0.25;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const n1 = smoothNoise3(nx * 1.9 + seed, ny * 1.9, nz * 1.9);
    const n2 = smoothNoise3(nx * 4.6, ny * 4.6 + seed, nz * 4.6);
    const n3 = smoothNoise3(nx * 9.5 + seed * 0.3, ny * 9.5, nz * 9.5);
    const disp = 1.0 + (n1 - 0.5) * 0.46 + (n2 - 0.5) * 0.2 + (n3 - 0.5) * 0.08;
    x = nx * radius * disp;
    y = ny * radius * disp * squash;
    z = nz * radius * disp;
    if (y < -radius * 0.25) y = -radius * 0.25 + (y + radius * 0.25) * 0.3;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Craggy mountain peak: a multi-ring cone whose rings are noise-eroded into ledges and ridges. */
function makeCragGeometry(rand, radius = 1.4, height = 2.4) {
  // 16 × 10 segments, a blunt rounded summit and a convex shoulder profile: silhouettes read as weathered
  // rock rather than 12-sided tents
  const geo = new THREE.CylinderGeometry(radius * 0.14, radius, height, 16, 10, false);
  const pos = geo.attributes.position;
  const seed = rand() * 40;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const ang = Math.atan2(z, x);
    const t = (y + height * 0.5) / height; // 0 base .. 1 tip
    const n = smoothNoise3(Math.cos(ang) * 2.2 + seed, t * 3.1, Math.sin(ang) * 2.2);
    const n2 = smoothNoise3(Math.cos(ang) * 5.5, t * 7.0 + seed, Math.sin(ang) * 5.5);
    const bulge = 1.0 + 0.2 * Math.sin(t * Math.PI) * (1.0 - t * 0.5);
    const scale = (1.0 + (n - 0.5) * 0.4 + (n2 - 0.5) * 0.1) * bulge;
    const ledge = Math.sin(t * Math.PI * 3.2 + n * 2.0) * 0.035 * (1.0 - t);
    // Dome the summit: pull the top ring down at its rim so the cap is a rounded knob, not a flat disc
    const dome = t > 0.98 ? -height * 0.03 * (r / Math.max(radius * 0.14, 1e-3)) : 0;
    pos.setXYZ(i, Math.cos(ang) * r * scale, y + ledge * height + dome, Math.sin(ang) * r * scale);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeFlowerTexture() {
  const key = '__flower_blossom__';
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.translate(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15);
    ctx.rotate(a);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(236,236,236,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const cg = ctx.createRadialGradient(32, 32, 1, 32, 32, 9);
  cg.addColorStop(0, '#fde68a');
  cg.addColorStop(1, '#f59e0b');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(32, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

/** Blossom head (textured disc) on a thin green stem; instanced per wildflower. */
function getFlowerGeometry() {
  if (_cachedFlowerGeo) return _cachedFlowerGeo;
  const head = new THREE.PlaneGeometry(0.3, 0.3);
  head.rotateX(-Math.PI / 2 + 0.28);
  head.translate(0, 0.19, 0);
  const headUv = head.attributes.uv;
  const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.2, 5);
  stem.translate(0, 0.1, 0);
  // Stem samples the yellow center of the blossom texture (u,v ≈ 0.5) so it reads greenish once tinted
  const stemUv = stem.attributes.uv;
  for (let i = 0; i < stemUv.count; i++) stemUv.setXY(i, 0.5, 0.5);
  const merged = mergeGeometries([head, stem], false);
  head.dispose();
  stem.dispose();
  void headUv;
  _cachedFlowerGeo = merged;
  return merged;
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
  edgeNoise = 0.0,
}) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    // Periodic multi-frequency wobble roughens the cliff/shelf outlines (the walkable lawn keeps edgeNoise 0)
    const wob = edgeNoise * (Math.sin(theta * 9.0 + 1.3) * 0.5 + Math.sin(theta * 17.0 + 0.4) * 0.3 + Math.sin(theta * 29.0 + 2.2) * 0.2);
    const rNorm = computeCoastRadiusNorm(theta, coastParams, lobeDirs) * scaleFactor * (1.0 + wob);
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
  const boxColliders = []; // { minX, maxX, minZ, maxZ } axis-aligned wall obstacles
  const animated = []; // (timeSec, dt) => void
  const labelSprites = [];
  const loadPromises = [];

  const { halfW, halfD } = zone.bounds;
  const coastParams = zone.coastParams || [0.1, 0.08, 0.05, 0.7];
  const lobeDirs = (zone.gateways || []).map((gw) => Math.atan2(gw.z / halfD, gw.x / halfW));

  const rand = seededRand((zone.index || 1) * 98765 + 1337);
  const theme = zone.theme || 'tropical';
  const isSoftwareGl = Boolean(modelBank && modelBank.isSoftwareGl);
  const quality = (modelBank && modelBank.quality) || (isSoftwareGl ? 'low' : 'high');
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
  const hexTiling = Boolean(preset.hexTiling);
  _useOrmMaps = preset.ormMaps !== false && quality !== 'low';
  _textureDir = preset.textureDir || '';
  const isMobileTier = quality === 'mobile';
  const shadowsOn = !isSoftwareGl || quality !== 'low';
  const atmo = getZoneAtmosphere(theme);
  const sunDir = getSunDirection(theme);
  const areaScale = Math.max(1.0, Math.min(2.8, Math.pow((halfW * halfD) / (31 * 26), 0.72)));
  const maxSpan = Math.max(halfW, halfD);
  const oceanFogNear = Math.max(preset.fogNear + 4, Math.round(maxSpan * 1.85));
  const oceanFogFar = Math.max(preset.fogFar + 8, Math.round(maxSpan * 4.1));

  const sharedTime = { value: 0 };
  const sharedHeroPos = { value: new THREE.Vector3(0, -99, 0) };

  // Static batching: meshes tagged with `markStatic` are merged per material into a single draw call at the
  // end of the build (planks, rails, curbs, road segments, steps, crags, walls, islets...). Mobile GPUs and
  // the Steam Deck are draw-call bound, so this is the single biggest frame-time win on the island.
  const markStatic = (mesh) => {
    mesh.userData.staticBatch = true;
    return mesh;
  };
  const flushStaticBatches = () => {
    const byMaterial = new Map();
    const victims = [];
    group.updateMatrixWorld(true);
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.userData.staticBatch || obj.isInstancedMesh) return;
      if (Array.isArray(obj.material)) return;
      const key = obj.material.uuid;
      if (!byMaterial.has(key)) {
        byMaterial.set(key, { material: obj.material, geos: [], castShadow: false, receiveShadow: false, reflective: false });
      }
      const entry = byMaterial.get(key);
      let geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      // Drop attributes that would make geometries un-mergeable (uv1/tangent/color only on some meshes), but
      // keep custom per-vertex shader inputs (e.g. `aRibbonEnd`) — every mesh sharing that material has them.
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && !/^a[A-Z]/.test(name)) geo.deleteAttribute(name);
      }
      geo.applyMatrix4(obj.matrixWorld);
      entry.geos.push(geo);
      entry.castShadow = entry.castShadow || obj.castShadow;
      entry.receiveShadow = entry.receiveShadow || obj.receiveShadow;
      entry.reflective = entry.reflective || obj.layers.isEnabled(REFLECTION_LAYER);
      victims.push(obj);
    });
    for (const v of victims) {
      if (v.parent) v.parent.remove(v);
    }
    let merged = 0;
    for (const entry of byMaterial.values()) {
      if (entry.geos.length === 0) continue;
      const geo = entry.geos.length === 1 ? entry.geos[0] : mergeGeometries(entry.geos, false);
      if (!geo) continue;
      if (entry.geos.length > 1) for (const g of entry.geos) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, entry.material);
      mesh.castShadow = entry.castShadow;
      mesh.receiveShadow = entry.receiveShadow;
      mesh.userData.keepInBattle = true;
      mesh.userData.staticMerged = true;
      if (entry.reflective) mesh.layers.enable(REFLECTION_LAYER);
      group.add(mesh);
      merged++;
    }
    // Drop sub-groups that became empty
    const empties = [];
    group.traverse((obj) => {
      if (obj !== group && obj.isGroup && obj.children.length === 0 && !obj.userData.keepGroup) empties.push(obj);
    });
    for (const e of empties) if (e.parent) e.parent.remove(e);
    return { merged, sourceMeshes: victims.length };
  };

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
  const biomePatches = zone.biomePatches || [];
  const bridges = zone.bridges || [];
  const waterChannels = zone.waterChannels || [];
  const roads = zone.roads || [];

  const getTerraceStairSpec = (t) => {
    const dir = t.stairDir || 'south';
    const stairLen = 2.35;
    if (dir === 'north') {
      return {
        dir,
        cx: t.x,
        cz: t.z - t.rz * 0.92 - stairLen * 0.42,
        startX: t.x,
        startZ: t.z - t.rz * 0.84,
        stepDX: 0,
        stepDZ: -1,
        stairLen,
      };
    }
    if (dir === 'east') {
      return {
        dir,
        cx: t.x + t.rx * 0.92 + stairLen * 0.42,
        cz: t.z,
        startX: t.x + t.rx * 0.84,
        startZ: t.z,
        stepDX: 1,
        stepDZ: 0,
        stairLen,
      };
    }
    if (dir === 'west') {
      return {
        dir,
        cx: t.x - t.rx * 0.92 - stairLen * 0.42,
        cz: t.z,
        startX: t.x - t.rx * 0.84,
        startZ: t.z,
        stepDX: -1,
        stepDZ: 0,
        stairLen,
      };
    }
    return {
      dir: 'south',
      cx: t.x,
      cz: t.z + t.rz * 0.92 + stairLen * 0.42,
      startX: t.x,
      startZ: t.z + t.rz * 0.84,
      stepDX: 0,
      stepDZ: 1,
      stairLen,
    };
  };

  const sampleBiomePatchAt = (x, z) => {
    for (let i = biomePatches.length - 1; i >= 0; i--) {
      const bp = biomePatches[i];
      const ca = Math.cos(-(bp.rot || 0));
      const sa = Math.sin(-(bp.rot || 0));
      const lx = (x - bp.x) * ca - (z - bp.z) * sa;
      const lz = (x - bp.x) * sa + (z - bp.z) * ca;
      const ang = Math.atan2(lz, lx);
      const wob = 1.0 + 0.1 * Math.cos(3 * ang + i * 1.3) + 0.06 * Math.sin(5 * ang - i * 0.7);
      const d = Math.hypot(lx / ((bp.rx || 10) * wob), lz / ((bp.rz || 8) * wob));
      if (d <= 1.0) return bp;
    }
    return null;
  };

  // ---- Terrain relief: rolling hills, mountain massifs & forest patches are placed procedurally in the
  //      "open" parts of the island. `openness(x, z)` is a smooth 0..1 mask that is 0 on/near every authored
  //      feature (roads, streams, bridges, houses, landmarks, plaza, spawns, terraces, walls, coast) so paths,
  //      buildings and set-pieces always stay on flat ground while the countryside between them undulates.
  const flatCircles = [];
  const flatSegments = [];
  const addFlat = (x, z, r) => flatCircles.push({ x, z, r });
  addFlat(zone.playerSpawn.x, zone.playerSpawn.z, 4.0);
  const plazaLm = zone.landmarks && zone.landmarks[0];
  const plazaCX = plazaLm ? plazaLm.x : 0;
  const plazaCZ = plazaLm ? plazaLm.z : 2.0;
  if (Math.hypot(plazaCX, plazaCZ) < 12) addFlat(plazaCX, plazaCZ, 6.0);
  for (const lm of zone.landmarks || []) addFlat(lm.x, lm.z, (lm.scale || 3.0) * 0.7 + 1.8);
  for (const h of zone.houses || []) {
    addFlat(h.x, h.z, (h.scale || 4.4) * 0.62 + 1.6);
    addFlat(h.x, h.z + 2.8, 3.0);
  }
  for (const gw of zone.gateways || []) addFlat(gw.x, gw.z, 4.5);
  for (const tr of zone.trainers || []) addFlat(tr.x, tr.z, 2.6);
  for (const ap of zone.apexSpawns || []) addFlat(ap.x, ap.z, 6.0);
  for (const sh of zone.shrines || []) addFlat(sh.x, sh.z, 2.6);
  for (const bt of zone.berryTrees || []) addFlat(bt.x, bt.z, 2.2);
  for (const ch of zone.chests || []) addFlat(ch.x, ch.z, 2.0);
  for (const bp of zone.ballPickups || []) addFlat(bp.x, bp.z, 1.6);
  for (const sp of zone.skyPillars || []) addFlat(sp.x, sp.z, 4.2);
  for (const t of terraces) {
    const st = getTerraceStairSpec(t);
    addFlat(t.x, t.z, Math.max(t.rx, t.rz) + 1.6);
    addFlat(st.cx, st.cz, 2.9);
  }
  for (const br of bridges) addFlat(br.x, br.z, (br.length || 5.2) * 0.65);
  for (const pr of zone.piers || []) addFlat(pr.x, pr.z, (pr.length || 6) * 0.5);
  // Roads are draped over the relief as spline ribbons, so they only constrain placement (not hill height)
  const roadSegments = [];
  for (const poly of roads) {
    for (let i = 0; i < poly.length - 1; i++) roadSegments.push({ x0: poly[i][0], z0: poly[i][1], x1: poly[i + 1][0], z1: poly[i + 1][1], pad: 1.9 });
  }
  for (const ch of waterChannels) flatSegments.push({ x0: ch.x0, z0: ch.z0, x1: ch.x1, z1: ch.z1, pad: (ch.width || 2.8) * 0.62 + 1.5 });
  for (const mw of zone.mountainWalls || []) flatSegments.push({ x0: mw.x0, z0: mw.z0, x1: mw.x1, z1: mw.z1, pad: (mw.width || 2.4) * 0.75 + 1.4 });
  for (const cw of zone.cityWalls || []) flatSegments.push({ x0: cw.x0, z0: cw.z0, x1: cw.x1, z1: cw.z1, pad: 2.2 });
  const softStep = (edge0, edge1, v) => {
    const t = Math.max(0, Math.min(1, (v - edge0) / Math.max(1e-4, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  const coastInsetMeters = (x, z) => {
    const rMax = getCoastMaxRadiusFactor(x, z);
    const effW = Math.max(4, halfW * rMax);
    const effD = Math.max(4, halfD * rMax);
    const norm = Math.hypot(x / effW, z / effD);
    return (1 - norm) * 0.5 * (effW + effD);
  };
  // `ramp` = metres over which the mask eases from 0 to 1; `wobble` meanders every boundary with
  // low-frequency noise so no cut-out is ever a straight corridor or a perfect circle.
  const maskValue = (x, z, ramp, wobble, segmentLists) => {
    const wob = wobble > 0 ? (smoothNoise3(x * 0.11 + 2.0, 0.5, z * 0.11) - 0.5) * wobble + (smoothNoise3(x * 0.31, 1.5, z * 0.31 + 4.0) - 0.5) * wobble * 0.4 : 0;
    let o = softStep(1.8, 4.6, coastInsetMeters(x, z));
    if (o <= 0) return 0;
    for (const c of flatCircles) {
      const d = Math.hypot(x - c.x, z - c.z) + wob;
      if (d < c.r + ramp) {
        o *= softStep(c.r, c.r + ramp, d);
        if (o <= 0.0005) return 0;
      }
    }
    for (const list of segmentLists) {
      for (const sg of list) {
        const d = distToSegment2D(x, z, sg.x0, sg.z0, sg.x1, sg.z1) + wob;
        if (d < sg.pad + ramp) {
          o *= softStep(sg.pad, sg.pad + ramp, d);
          if (o <= 0.0005) return 0;
        }
      }
    }
    return o;
  };
  // Placement mask (trees, forests, hill centres): tight ramp, includes roads
  const openness = (x, z) => maskValue(x, z, 1.6, 0.0, [flatSegments, roadSegments]);
  // Relief mask (hill height): wide gentle valleys with meandering boundaries, roads excluded
  const reliefMask = (x, z) => maskValue(x, z, 3.6, 2.2, [flatSegments]);
  const proceduralObstacles = []; // { x, z, r } crags & massif rocks added by the terrain generator

  // Rolling hills (explicit `zone.hills` first, then procedural mounds in open countryside)
  const hillList = [];
  const hillScale = theme === 'harbor' ? 0.7 : theme === 'snow' ? 1.15 : theme === 'volcano' ? 1.25 : 1.0;
  for (const h of zone.hills || []) hillList.push({ x: h.x, z: h.z, rx: h.rx || 7, rz: h.rz || h.rx || 6, h: h.h ?? 1.0, rot: h.rot || 0 });
  // Mountain massifs: a walkable mound crowned with craggy peaks, preferring the far side from the spawn
  const massifs = [];
  const explicitMountains = zone.mountains || [];
  for (const m of explicitMountains) massifs.push({ x: m.x, z: m.z, r: m.r || 7.5, h: m.h ?? 1.8, peaks: m.peaks || 4 });
  const wantMassifs = explicitMountains.length
    ? Math.max(0, Math.round(2 * areaScale) - explicitMountains.length)
    : Math.round((theme === 'harbor' ? 2 : theme === 'sky' ? 2 : 3) * Math.sqrt(areaScale));
  // Mountains may hug the coastline (natural sea cliffs), so they use the feature mask without the coast inset
  const featureOpenness = (x, z) => {
    let o = 1;
    for (const c of flatCircles) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r + 1.6) o *= softStep(c.r, c.r + 1.6, d);
    }
    for (const sg of flatSegments.concat(roadSegments)) {
      const d = distToSegment2D(x, z, sg.x0, sg.z0, sg.x1, sg.z1);
      if (d < sg.pad + 1.6) o *= softStep(sg.pad, sg.pad + 1.6, d);
    }
    return o;
  };
  const massifCandidates = [];
  for (let i = 0; i < 140 && wantMassifs > 0; i++) {
    const mx = (rand() * 2 - 1) * (halfW - 5);
    const mz = (rand() * 2 - 1) * (halfD - 5);
    if (coastInsetMeters(mx, mz) < 2.2) continue;
    const r = 5.2 + rand() * 2.8;
    let minOpen = featureOpenness(mx, mz);
    for (let k = 0; k < 8 && minOpen > 0.4; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = mx + Math.cos(a) * r * 0.55;
      const sz = mz + Math.sin(a) * r * 0.55;
      minOpen = Math.min(minOpen, isInsideCoast(sx, sz, 1.4) ? featureOpenness(sx, sz) : 0.0);
    }
    if (minOpen < 0.6) continue;
    const spawnDist = Math.hypot(mx - zone.playerSpawn.x, mz - zone.playerSpawn.z);
    massifCandidates.push({ x: mx, z: mz, r, score: minOpen * 10 + spawnDist * 0.25 + rand() * 2 });
  }
  massifCandidates.sort((a, b) => b.score - a.score);
  for (const c of massifCandidates) {
    if (massifs.length >= wantMassifs) break;
    if (massifs.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < m.r + c.r + 6)) continue;
    massifs.push({ x: c.x, z: c.z, r: c.r, h: (1.5 + rand() * 0.9) * hillScale, peaks: 4 + Math.floor(rand() * 3) });
  }
  for (const m of massifs) {
    hillList.push({ x: m.x, z: m.z, rx: m.r * 1.2, rz: m.r * 1.2, h: m.h, rot: 0 });
    m.crags = [];
    const peakCount = m.peaks;
    for (let k = 0; k < peakCount; k++) {
      const isCenter = k === 0;
      const a = rand() * Math.PI * 2;
      const dist = isCenter ? 0 : m.r * (0.28 + rand() * 0.34);
      const cx = m.x + Math.cos(a) * dist;
      const cz = m.z + Math.sin(a) * dist;
      if (!isCenter && !isInsideCoast(cx, cz, 1.2)) continue;
      const cr = isCenter ? 2.5 + rand() * 1.0 : 1.4 + rand() * 1.2;
      const chh = isCenter ? 7.5 + rand() * 3.0 : 3.8 + rand() * 3.0;
      m.crags.push({ x: cx, z: cz, r: cr, h: chh });
      proceduralObstacles.push({ x: cx, z: cz, r: cr * 0.85 });
      colliders.push({ x: cx, z: cz, r: cr * 0.66 });
    }
  }

  const wantHills = Math.max(hillList.length + 3, Math.round((theme === 'harbor' ? 5 : 8) * areaScale));
  for (let attempt = 0; attempt < 220 && hillList.length < wantHills; attempt++) {
    const hx = (rand() * 2 - 1) * (halfW - 6);
    const hz = (rand() * 2 - 1) * (halfD - 6);
    if (openness(hx, hz) < 0.72) continue;
    const rx = 5.2 + rand() * 6.5;
    const rz = 4.4 + rand() * 5.6;
    if (hillList.some((o) => Math.hypot(o.x - hx, o.z - hz) < 0.62 * (Math.max(o.rx, o.rz) + Math.max(rx, rz)))) continue;
    if (massifs.some((m) => Math.hypot(m.x - hx, m.z - hz) < m.r * 1.15 + Math.max(rx, rz) * 0.55)) continue;
    hillList.push({ x: hx, z: hz, rx, rz, h: (0.75 + rand() * 1.45) * hillScale, rot: rand() * Math.PI });
  }


  const hillHeight = (x, z) => {
    let h = 0;
    for (const hl of hillList) {
      const dx = x - hl.x;
      const dz = z - hl.z;
      const c = Math.cos(-hl.rot);
      const sn = Math.sin(-hl.rot);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const d = Math.hypot(lx / hl.rx, lz / hl.rz);
      if (d < 1) h += hl.h * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    // Multi-octave countryside rolling ridges + broad low valley meadows
    // (smoothstep ramps instead of hard max() clamps so bumps meet the flats without creases)
    const nBroad = smoothNoise3(x * 0.048 + 1.9, 0.23, z * 0.048 - 2.4);
    const nMed = smoothNoise3(x * 0.095 + 3.1, 0.37, z * 0.095) * 0.7 + smoothNoise3(x * 0.19, 0.91, z * 0.19 + 5.0) * 0.3;
    h += softStep(0.4, 0.82, nBroad) * 1.25 + softStep(0.42, 0.8, nMed) * 0.6;
    if (h <= 0) return 0;
    return h * reliefMask(x, z);
  };

  // Smooth elevation sampler for hills + terraces + multi-directional stair ramps + arched bridges!
  const getHeightAt = (x, z) => {
    let hOut = hillHeight(x, z);
    for (const t of terraces) {
      const dx = x - t.x;
      const dz = z - t.z;
      const th = t.h || 0.72;
      const ellip = Math.hypot(dx / t.rx, dz / t.rz);
      if (ellip <= 1.0) {
        hOut = Math.max(hOut, th);
        continue;
      }
      const st = getTerraceStairSpec(t);
      if (st.dir === 'south' || st.dir === 'north') {
        const along = (z - st.startZ) * st.stepDZ;
        if (Math.abs(x - st.startX) <= 1.9 && along >= -0.25 && along <= st.stairLen + 0.15) {
          const u = 1.0 - Math.max(0, along) / Math.max(0.2, st.stairLen);
          hOut = Math.max(hOut, Math.max(0, Math.min(1, u)) * th);
        }
      } else {
        const along = (x - st.startX) * st.stepDX;
        if (Math.abs(z - st.startZ) <= 1.9 && along >= -0.25 && along <= st.stairLen + 0.15) {
          const u = 1.0 - Math.max(0, along) / Math.max(0.2, st.stairLen);
          hOut = Math.max(hOut, Math.max(0, Math.min(1, u)) * th);
        }
      }
    }
    for (const br of bridges) {
      const ca = Math.cos(-(br.yaw || 0));
      const sa = Math.sin(-(br.yaw || 0));
      const lx = (x - br.x) * ca - (z - br.z) * sa;
      const lz = (x - br.x) * sa + (z - br.z) * ca;
      const hw = (br.width || 3.4) * 0.52;
      const hl = (br.length || 5.2) * 0.55;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hl) {
        const arch = 0.08 + Math.cos((lz / hl) * Math.PI * 0.5) * 0.36;
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
    for (const sp of zone.skyPillars || []) {
      if (Math.hypot(x - sp.x, z - sp.z) < 4.4) return false;
    }
    for (const mw of zone.mountainWalls || []) {
      if (distToSegment2D(x, z, mw.x0, mw.z0, mw.x1, mw.z1) < (mw.width || 2.4) * 0.75 + 1.4) return false;
    }
    for (const cw of zone.cityWalls || []) {
      if (distToSegment2D(x, z, cw.x0, cw.z0, cw.x1, cw.z1) < 2.2) return false;
    }
    for (const t of terraces) {
      const st = getTerraceStairSpec(t);
      if (Math.hypot(x - st.cx, z - st.cz) < 3.1) return false;
      // Keep rim clean so trees don't float half off terrace edge
      const ellip = Math.hypot((x - t.x) / t.rx, (z - t.z) / t.rz);
      if (ellip > 0.84 && ellip < 1.2) return false;
    }
    for (const ob of proceduralObstacles) {
      if (Math.hypot(x - ob.x, z - ob.z) < ob.r + minClear * 0.5) return false;
    }
    return true;
  };

  // 1. Custom GLSL Ocean: Gerstner swell + tileable ripple normal map, refracted sandy seabed with caustics,
  //    Beer-Lambert depth tint, planar scene reflections (GPU tiers), whitecaps, organic surf foam & cloud shadows.
  const waterSegs = preset.waterSegs || (isSoftwareGl ? 40 : 110);
  const oceanPlaneSpan = Math.max(260, Math.round(maxSpan * 5.8));
  const waterGeo = new THREE.PlaneGeometry(oceanPlaneSpan, oceanPlaneSpan, waterSegs, waterSegs);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = createOceanMagmaShaderMaterial({
    waterColor: zone.waterColor || '#1496c8',
    deepColor: theme === 'harbor' ? '#073b66' : theme === 'snow' ? '#1e567c' : '#0a4f80',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || zone.skyColor || '#9be4ff',
    fogNear: Math.max(88, oceanFogNear),
    fogFar: Math.max(175, oceanFogFar),
    sunDir,
    sunColor: atmo.sunColor,
    islandHalfW: halfW,
    islandHalfD: halfD,
    coastParams,
    lobeDirs,
    theme,
    seabedColor: theme === 'snow' ? '#cfe3ef' : theme === 'harbor' ? '#b9a98a' : '#e9d5a4',
    cloudCoverage: atmo.cloudCoverage,
    cloudShadowStrength: hexTiling ? 0.3 : 0.0,
    reflectionStrength: theme === 'snow' ? 0.72 : 0.85,
    quality: preset.waterQuality ?? 2,
  });
  if (theme !== 'volcano' && (hexTiling || isMobileTier)) {
    whenTextureReady(loadSingleTexture(texUrl('water_normal.jpg')), (tex) => waterMat.userData.setNormalMap(tex));
    whenTextureReady(loadSingleTexture(texUrl('sand_beach.jpg'), { srgb: true }), (tex) => waterMat.userData.setSeabedMap(tex));
  }
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.82;
  water.userData.isMonkeOcean = true;
  water.userData.planeY = -0.82;
  water.userData.reflectionHide = [];
  water.userData.keepInBattle = true;
  group.add(water);

  // 2. Non-Square Organic Multi-Tiered Island Geometry (`ExtrudeGeometry` + Beaches + Wet Cliffs + Lush Lawn)
  const cliffTexName =
    theme === 'volcano' ? 'volcano_basalt' : theme === 'desert' ? 'sand_beach' : 'cliff_rock';
  const cliffPair = loadDedicatedPair(cliffTexName, 1, 1);
  const cliffTint =
    theme === 'snow' || theme === 'sky'
      ? '#e2e8f0'
      : theme === 'volcano'
        ? '#d6d3d1'
        : theme === 'desert'
          ? '#fcd34d'
          : theme === 'harbor'
            ? '#e2e8f0'
            : '#ffedd5';

  // World-space triplanar cliff shading: crisp 2048² rock on every bevel, wall and crag with zero UV stretching
  const cliffLowerMat = pbrMaterial(cliffPair, {
    normalScale: new THREE.Vector2(1.15, 1.15),
    color: new THREE.Color(cliffTint).multiplyScalar(0.76),
    roughness: 0.84,
  });
  attachTriplanarRockShader(cliffLowerMat, { uTime: sharedTime, scale: 3.6, isVolcano: theme === 'volcano' });
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
      segments: 140,
      tileScale: 5.5,
      edgeNoise: 0.03,
    }),
    cliffLowerMat,
  );
  cliffLower.position.y = -1.42;
  cliffLower.receiveShadow = shadowsOn;
  markReflective(cliffLower);
  group.add(cliffLower);

  // Sloping Golden Sandy Beach / Snow / Basalt Shore Shelf around the curved coves & bays!
  const beachTexName = theme === 'volcano' ? 'volcano_basalt' : theme === 'snow' ? 'snow_alpine' : 'sand_beach';
  const beachPair = loadDedicatedPair(beachTexName, 1, 1);
  const shoreMat = pbrMaterial(beachPair, {
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: theme === 'volcano' ? '#78716c' : theme === 'snow' ? '#e2e8f0' : '#fde9b4',
    roughness: 0.8,
  });
  attachTerrainDetailShader(shoreMat, {
    uTime: sharedTime,
    islandHalfW: halfW,
    islandHalfD: halfD,
    dappleStrength: 0.12,
    coastParams,
    lobeDirs,
    hexTiling,
    hexGridScale: 1.0,
    cloudCoverage: atmo.cloudCoverage,
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
      segments: 140,
      tileScale: 4.2,
      edgeNoise: 0.022,
    }),
    shoreMat,
  );
  shoreShelf.position.y = -0.98;
  shoreShelf.receiveShadow = shadowsOn;
  markReflective(shoreShelf);
  group.add(shoreShelf);

  const cliffBaseMat = pbrMaterial(cliffPair, {
    normalScale: new THREE.Vector2(1.25, 1.25),
    color: cliffTint,
    roughness: 0.76,
  });
  attachTriplanarRockShader(cliffBaseMat, { uTime: sharedTime, scale: 3.2, isVolcano: theme === 'volcano' });
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
      segments: 140,
      tileScale: 4.8,
      edgeNoise: 0.012,
    }),
    cliffBaseMat,
  );
  // Top cap = -0.83 + (0.68 + 0.09) = -0.06m (cleanly below y=0.000 lawn!)
  cliffBase.position.y = -0.83;
  cliffBase.receiveShadow = shadowsOn;
  markReflective(cliffBase);
  group.add(cliffBase);

  const groundTexName =
    theme === 'volcano'
      ? 'volcano_basalt'
      : theme === 'snow' || theme === 'sky'
        ? 'snow_alpine'
        : theme === 'desert'
          ? 'sand_beach'
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
        : theme === 'desert'
          ? '#fde68a'
          : theme === 'snow' || theme === 'sky'
            ? '#f8fafc'
            : '#ffffff';

  // Second splat layer blended by world FBM patches (+ sandy fringe along the coastline on grassy islands)
  const splatSpec =
    theme === 'tropical'
      ? { pair: loadDedicatedPair('sand_beach', 1, 1), scale: 1.15, threshold: 0.67, coastFringe: 3.4, tint: '#f1dfae' }
      : theme === 'forest'
        ? { pair: loadDedicatedPair('dirt_path', 1, 1), scale: 1.05, threshold: 0.57, coastFringe: 2.2, tint: '#c7a883' }
        : theme === 'harbor'
          ? { pair: loadDedicatedPair('sand_beach', 1, 1), scale: 1.1, threshold: 0.64, coastFringe: 2.6, tint: '#e8d8b0' }
          : theme === 'snow'
            ? { pair: cliffPair, scale: 1.0, threshold: 0.62, coastFringe: 0, tint: '#cbd5e1' }
            : theme === 'volcano'
              ? { pair: loadDedicatedPair('cliff_rock', 1, 1), scale: 1.0, threshold: 0.6, coastFringe: 0, tint: '#4b3a36' }
              : null;

  const lawnMat = pbrMaterial(lawnPair, {
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
    coastParams,
    lobeDirs,
    hexTiling,
    hexGridScale: 1.15,
    cloudCoverage: atmo.cloudCoverage,
    splat: splatSpec
      ? {
          map: splatSpec.pair.map,
          normalMap: splatSpec.pair.normalMap,
          ormMap: splatSpec.pair.ormMap,
          scale: splatSpec.scale,
          noiseScale: 0.085,
          threshold: splatSpec.threshold,
          coastFringe: splatSpec.coastFringe,
          tint: splatSpec.tint,
        }
      : null,
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
  // ExtrudeGeometry top cap sits at local +(depth + bevelThickness) = +0.34 => position.y = -0.34 puts top at exact y = 0.000!
  lawn.position.y = -0.34;
  lawn.receiveShadow = shadowsOn;
  markReflective(lawn);
  group.add(lawn);

  // 2a. Rolling-hill relief: a dense grid displaced by `hillHeight`, sharing the lawn material/UV space so the
  //     hex-tiled grass continues seamlessly up every slope. Only cells with relief are emitted (no z-fighting).
  let hillMesh = null;
  const dbgNoHills = typeof location !== 'undefined' && /nohills/.test(location.search || '');
  if (hillList.length > 0 && !dbgNoHills) {
    const cell = hexTiling ? 0.7 : 1.0;
    const x0 = -halfW - 2;
    const z0 = -halfD - 2;
    const nx = Math.ceil(((halfW + 2) * 2) / cell) + 1;
    const nz = Math.ceil(((halfD + 2) * 2) / cell) + 1;
    const verts = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const heights = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const vx = x0 + i * cell;
        const vz = z0 + j * cell;
        const h = hillHeight(vx, vz);
        const idx = j * nx + i;
        heights[idx] = h;
        verts[idx * 3] = vx;
        verts[idx * 3 + 1] = h + 0.006;
        verts[idx * 3 + 2] = vz;
        uvs[idx * 2] = vx / 4.4;
        uvs[idx * 2 + 1] = vz / 4.4;
      }
    }
    const indices = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        if (Math.max(heights[a], heights[b], heights[c], heights[d]) < 0.004) continue;
        indices.push(a, c, b, b, c, d);
      }
    }
    if (indices.length > 0) {
      const hillGeo = new THREE.BufferGeometry();
      hillGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      hillGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      hillGeo.setIndex(indices);
      hillGeo.computeVertexNormals();
      hillGeo.computeBoundingSphere();
      hillMesh = new THREE.Mesh(hillGeo, lawnMat);
      hillMesh.receiveShadow = shadowsOn;
      hillMesh.castShadow = shadowsOn;
      hillMesh.userData.keepInBattle = true;
      markReflective(hillMesh);
      group.add(hillMesh);
    }
  }

  // 2a-bis. Multi-Biome Surface Sub-Regions (`zone.biomePatches`: sand dunes, alpine snowfields, volcanic basalt,
  //         ancient ruin stone, deep mossy groves, turquoise wetlands & blossom meadows) conformed to hill relief!
  const cobblePair = loadDedicatedPair('cobble_path', 1, 1);
  const woodPair = loadDedicatedPair('wood_timber', 1, 1);
  const biomeMatCache = new Map();
  // `feather` = ground patch variant (alpha-feathered, noise-eroded boundary read from the `aPatchEdge` vertex
  // attribute). Terrace caps and other solid geometry without that attribute must use the opaque variant.
  const getBiomeSurfaceMaterial = (kind, withPolyOffset = true, feather = withPolyOffset) => {
    const cacheKey = `${kind}:${withPolyOffset ? 1 : 0}:${feather ? 1 : 0}`;
    if (biomeMatCache.has(cacheKey)) return biomeMatCache.get(cacheKey);
    const specMap = {
      sand: { tex: 'sand_beach', color: '#f6e4b4', roughness: 0.82, metalness: 0.01 },
      snow: { tex: 'snow_alpine', color: '#f1f5f9', roughness: 0.56, metalness: 0.02 },
      basalt: { tex: 'volcano_basalt', color: '#57534e', roughness: 0.86, metalness: 0.05 },
      stone: { tex: 'harbor_stone', color: '#cbd5e1', roughness: 0.68, metalness: 0.06 },
      grove: { tex: 'grass_grove', color: '#bef264', roughness: 0.76, metalness: 0.02 },
      wetland: { tex: 'grass_grove', color: '#5eead4', roughness: 0.42, metalness: 0.08 },
      flowerfield: { tex: 'grass_meadow', color: '#dcfce7', roughness: 0.74, metalness: 0.02 },
    };
    const sp = specMap[kind] || specMap.grove;
    const pair = loadDedicatedPair(sp.tex, 1, 1);
    const mat = pbrMaterial(pair, {
      normalScale: new THREE.Vector2(0.95, 0.95),
      color: sp.color,
      roughness: sp.roughness,
      metalness: sp.metalness,
      ...(withPolyOffset
        ? {
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }
        : {}),
    });
    if (feather) {
      // Feathered, noise-eroded boundary (alpha-blended over the lawn) instead of hard grid-cell edges
      mat.transparent = true;
      mat.depthWrite = false;
    }
    attachTerrainDetailShader(mat, {
      uTime: sharedTime,
      islandHalfW: halfW,
      islandHalfD: halfD,
      dappleStrength: kind === 'basalt' ? 0.06 : 0.16,
      coastParams,
      lobeDirs,
      hexTiling,
      hexGridScale: 1.1,
      cloudCoverage: atmo.cloudCoverage,
      patchFeather: feather,
      featherWidth: 1.2,
      featherWobble: 1.6,
    });
    biomeMatCache.set(cacheKey, mat);
    return mat;
  };

  for (let bIdx = 0; bIdx < biomePatches.length; bIdx++) {
    const bp = biomePatches[bIdx];
    const rx = bp.rx || 10;
    const rz = bp.rz || 8;
    const rot = bp.rot || 0;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const span = Math.max(rx, rz) * 1.18;
    const cell = hexTiling ? 0.95 : 1.25;
    const xMin = bp.x - span;
    const zMin = bp.z - span;
    const nx = Math.max(4, Math.ceil((span * 2) / cell) + 1);
    const nz = Math.max(4, Math.ceil((span * 2) / cell) + 1);
    const verts = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const edges = new Float32Array(nx * nz); // signed inside-distance to the wobbly ellipse (metres)
    const insideMask = new Uint8Array(nx * nz);
    const yLayer = 0.011 + bIdx * 0.0015;
    const featherPad = 1.8; // metres of extra skirt so the shader has room to feather/erode the edge

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const vx = xMin + i * cell;
        const vz = zMin + j * cell;
        const idx = j * nx + i;
        const lx = (vx - bp.x) * ca + (vz - bp.z) * sa;
        const lz = -(vx - bp.x) * sa + (vz - bp.z) * ca;
        const ang = Math.atan2(lz, lx);
        const wob = 1.0 + 0.1 * Math.cos(3 * ang + bIdx * 1.3) + 0.06 * Math.sin(5 * ang - bIdx * 0.7);
        const norm = Math.hypot(lx / (rx * wob), lz / (rz * wob));
        const edgeMeters = (1.0 - norm) * Math.min(rx, rz) * wob;
        edges[idx] = isInsideCoast(vx, vz, 0.45) ? edgeMeters : Math.min(edgeMeters, -featherPad);
        if (edgeMeters > -featherPad && isInsideCoast(vx, vz, 0.45)) {
          insideMask[idx] = 1;
        }
        const hy = hillHeight(vx, vz);
        verts[idx * 3] = vx;
        verts[idx * 3 + 1] = hy + yLayer;
        verts[idx * 3 + 2] = vz;
        uvs[idx * 2] = vx / 4.2;
        uvs[idx * 2 + 1] = vz / 4.2;
      }
    }

    const indices = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        if (insideMask[a] + insideMask[b] + insideMask[c] + insideMask[d] < 1) continue;
        indices.push(a, c, b, b, c, d);
      }
    }
    if (indices.length > 0) {
      const bpGeo = new THREE.BufferGeometry();
      bpGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      bpGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      bpGeo.setAttribute('aPatchEdge', new THREE.BufferAttribute(edges, 1));
      bpGeo.setIndex(indices);
      bpGeo.computeVertexNormals();
      bpGeo.computeBoundingSphere();
      const bpMesh = new THREE.Mesh(bpGeo, getBiomeSurfaceMaterial(bp.kind || 'sand', true));
      bpMesh.receiveShadow = shadowsOn;
      bpMesh.userData.keepInBattle = true;
      markReflective(bpMesh);
      group.add(bpMesh);
    }
  }

  // 2b. Elevated Walkable Cliff Terraces + Multi-Directional 3D Stone Staircases!
  for (const t of terraces) {
    const th = t.h || 0.72;
    const st = getTerraceStairSpec(t);
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
      depth: Math.max(0.18, th - 0.1),
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
    tWall.castShadow = shadowsOn;
    tWall.receiveShadow = shadowsOn;
    tWall.userData.keepInBattle = true;
    markReflective(tWall);
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
    const capMat = t.topKind ? getBiomeSurfaceMaterial(t.topKind, false, false) : lawnMat;
    const tCap = new THREE.Mesh(capGeo, capMat);
    // ExtrudeGeometry top sits at +(depth + bevelThickness) = +0.16 => position.y = h - 0.16 puts top at exact t.h!
    tCap.position.set(t.x, th - 0.16, t.z);
    tCap.receiveShadow = shadowsOn;
    tCap.userData.keepInBattle = true;
    markReflective(tCap);
    group.add(tCap);

    // 5-step walkable 3D Stone Staircase on `south | north | east | west` edge of the terrace!
    const stepsCount = Math.max(5, Math.round(th * 6.5));
    const stepMat = pbrMaterial(cobblePair, {
      color: t.topKind === 'basalt' ? '#a8a29e' : t.topKind === 'snow' ? '#e2e8f0' : '#fef3c7',
      roughness: 0.66,
    });
    for (let s = 0; s < stepsCount; s++) {
      const stepH = th * (1.0 - s / stepsCount);
      const stepW = 3.05 + s * 0.05;
      const stepRun = st.stairLen / stepsCount + 0.08;
      const boxGeo =
        st.dir === 'east' || st.dir === 'west'
          ? new THREE.BoxGeometry(stepRun, stepH, stepW)
          : new THREE.BoxGeometry(stepW, stepH, stepRun);
      const stepMesh = new THREE.Mesh(boxGeo, stepMat);
      const dist = (s + 0.5) * (st.stairLen / stepsCount);
      stepMesh.position.set(st.startX + st.stepDX * dist, stepH * 0.5, st.startZ + st.stepDZ * dist);
      stepMesh.receiveShadow = shadowsOn;
      stepMesh.castShadow = shadowsOn;
      stepMesh.userData.keepInBattle = true;
      markReflective(stepMesh);
      group.add(markStatic(stepMesh));
    }

    // Add cliff-edge rim colliders around the terrace EXCEPT at the active staircase opening
    const rimDots = Math.max(24, Math.round((t.rx + t.rz) * 1.55));
    for (let i = 0; i < rimDots; i++) {
      const a = (i / rimDots) * Math.PI * 2;
      const rx = t.x + Math.cos(a) * t.rx * 1.02;
      const rz = t.z + Math.sin(a) * t.rz * 1.02;
      if (st.dir === 'south' && Math.abs(rx - t.x) < 2.3 && rz > t.z + t.rz * 0.55) continue;
      if (st.dir === 'north' && Math.abs(rx - t.x) < 2.3 && rz < t.z - t.rz * 0.55) continue;
      if (st.dir === 'east' && Math.abs(rz - t.z) < 2.3 && rx > t.x + t.rx * 0.55) continue;
      if (st.dir === 'west' && Math.abs(rz - t.z) < 2.3 && rx < t.x - t.rx * 0.55) continue;
      colliders.push({ x: rx, z: rz, r: 0.72 });
    }
  }

  // 2c. Flowing Island Streams / Harbor Canals / Magma Rifts + Walkable Arched 3D Bridges & Piers!
  // Uses dedicated `createStreamChannelShaderMaterial` (micro-ripples <= 3mm so water NEVER clips below ground,
  // directional downstream caustics, organic coastline clipping, and soft under-bridge arch shadows!).
  const streamMat = createStreamChannelShaderMaterial({
    waterColor: theme === 'volcano' ? '#f97316' : theme === 'snow' ? '#2dd4bf' : '#38bdf8',
    deepColor: theme === 'volcano' ? '#7c2d12' : '#0369a1',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || '#9be4ff',
    fogNear: Math.max(92, oceanFogNear),
    fogFar: Math.max(185, oceanFogFar),
    islandHalfW: halfW,
    islandHalfD: halfD,
    coastParams,
    lobeDirs,
    bridges,
    clipToCoast: true,
    theme: theme === 'volcano' ? 'volcano' : 'tropical',
  });
  animated.push((t) => {
    streamMat.uniforms.uTime.value = t * 1.25;
  });

  const riverbedMat = pbrMaterial(cliffPair, {
    color: theme === 'volcano' ? '#291510' : '#0f3a5d',
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  attachRibbonEdgeShader(riverbedMat, {
    shoulderColor: theme === 'volcano' ? '#3b2a24' : theme === 'snow' ? '#9fb3bf' : '#8f7a52',
    edgeWidth: 0.06,
    shoulderWidth: 0.3,
    wobble: 0.2,
    noiseScale: 1.3,
    roughen: 0.05,
  });

  // Two-step cascade: sheet from the stream lip (y=0.062) onto the shore shelf (~y=-0.42), a shallow run-off
  // ribbon across the shelf, then a second sheet + churning plunge-pool foam on the open sea (y=-0.82).
  const waterfallSheetMat = createWaterfallShaderMaterial({
    color: theme === 'snow' ? '#a5f3fc' : '#7dd3fc',
    foamColor: '#f0fbff',
    mode: 0,
  });
  const waterfallFoamMat = createWaterfallShaderMaterial({
    color: theme === 'snow' ? '#a5f3fc' : '#67e8f9',
    foamColor: '#ffffff',
    mode: 1,
  });
  const runoffMat = createStreamChannelShaderMaterial({
    waterColor: theme === 'snow' ? '#2dd4bf' : '#38bdf8',
    deepColor: '#0369a1',
    skyColor: zone.skyColor || '#87dcff',
    fogColor: zone.fogColor || '#9be4ff',
    fogNear: Math.max(92, oceanFogNear),
    fogFar: Math.max(185, oceanFogFar),
    islandHalfW: halfW,
    islandHalfD: halfD,
    coastParams,
    lobeDirs,
    bridges: [],
    clipToCoast: false,
    theme: 'tropical',
  });
  animated.push((t) => {
    waterfallSheetMat.uniforms.uTime.value = t;
    waterfallFoamMat.uniforms.uTime.value = t;
    runoffMat.uniforms.uTime.value = t * 1.6;
  });
  const addCascadeSheet = (x, z, dirX, dirZ, width, topY, bottomY) => {
    const h = Math.max(0.15, topY - bottomY);
    const geo = new THREE.PlaneGeometry(width, h, 6, 10);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Curve the sheet outward as it falls (plane y: +h/2 lip .. -h/2 pool) and flare the base slightly
      const v = 0.5 - pos.getY(i) / h;
      pos.setZ(i, Math.sin(v * Math.PI * 0.5) * h * 0.42);
      pos.setX(i, pos.getX(i) * (1.0 + v * 0.22));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const sheet = new THREE.Mesh(geo, waterfallSheetMat);
    sheet.position.set(x, (topY + bottomY) * 0.5, z);
    sheet.rotation.y = Math.atan2(dirX, dirZ);
    sheet.renderOrder = 3;
    sheet.userData.keepInBattle = true;
    group.add(sheet);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.9, width * 1.35), waterfallFoamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(x + dirX * h * 0.42, bottomY + 0.035, z + dirZ * h * 0.42);
    foam.renderOrder = 3;
    foam.userData.keepInBattle = true;
    group.add(foam);
  };
  const addStreamCascade = (ex, ez, dirX, dirZ, width) => {
    const lipY = 0.062;
    const shelfY = -0.405;
    const seaY = -0.8;
    const shelfRun = 2.6;
    addCascadeSheet(ex, ez, dirX, dirZ, width * 0.92, lipY, shelfY);
    const run = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.8, shelfRun, 4, 12), runoffMat);
    run.geometry.rotateX(-Math.PI / 2);
    run.position.set(ex + dirX * shelfRun * 0.5, shelfY + 0.012, ez + dirZ * shelfRun * 0.5);
    run.rotation.y = Math.atan2(dirX, dirZ);
    run.userData.keepInBattle = true;
    group.add(run);
    addCascadeSheet(ex + dirX * shelfRun, ez + dirZ * shelfRun, dirX, dirZ, width * 0.85, shelfY, seaY);
    water.userData.reflectionHide.push(run);
  };

  // Helper: clip a 2D line segment so its endpoints stay inside the organic island coast
  const clipSegmentInsideCoast = (ax, az, bx, bz, margin = -0.3) => {
    const N = 48;
    let firstT = null;
    let lastT = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      if (isInsideCoast(px, pz, margin)) {
        if (firstT === null) firstT = t;
        lastT = t;
      }
    }
    if (firstT === null || lastT === null || lastT - firstT < 0.04) return null;
    return [
      ax + (bx - ax) * firstT,
      az + (bz - az) * firstT,
      ax + (bx - ax) * lastT,
      az + (bz - az) * lastT,
    ];
  };

  // Helper: split a 2D segment around any bridge footprint so banks & roads never cut across bridge ramps/water!
  const splitSegmentAroundBridges = (ax, az, bx, bz, extraClear = 0.0) => {
    let intervals = [[0, 1]];
    const segLen = Math.hypot(bx - ax, bz - az);
    if (segLen < 0.2) return [];

    for (const br of bridges) {
      const clearR = Math.max(br.width || 3.4, (br.length || 5.2) * 0.5) * 0.56 + extraClear;
      const next = [];
      for (const [t0, t1] of intervals) {
        const steps = 32;
        let curStart = null;
        for (let s = 0; s <= steps; s++) {
          const t = t0 + ((t1 - t0) * s) / steps;
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          const insideBridge = Math.hypot(px - br.x, pz - br.z) < clearR;
          if (!insideBridge && curStart === null) {
            curStart = t;
          } else if (insideBridge && curStart !== null) {
            if ((t - curStart) * segLen > 0.35) next.push([curStart, t]);
            curStart = null;
          }
        }
        if (curStart !== null && (t1 - curStart) * segLen > 0.35) {
          next.push([curStart, t1]);
        }
      }
      intervals = next;
    }

    return intervals.map(([t0, t1]) => [
      ax + (bx - ax) * t0,
      az + (bz - az) * t0,
      ax + (bx - ax) * t1,
      az + (bz - az) * t1,
    ]);
  };

  for (const ch of waterChannels) {
    const clipped = clipSegmentInsideCoast(ch.x0, ch.z0, ch.x1, ch.z1, -0.45);
    if (!clipped) continue;
    const [cx0, cz0, cx1, cz1] = clipped;
    const dx = cx1 - cx0;
    const dz = cz1 - cz0;
    const len = Math.hypot(dx, dz);
    const w = ch.width || 2.8;
    const ang = Math.atan2(dx, dz);

    const chGroup = new THREE.Group();
    chGroup.position.set((cx0 + cx1) * 0.5, 0, (cz0 + cz1) * 0.5);
    chGroup.rotation.y = ang;

    // Dark submerged pebbled riverbed liner safely above y=0.000 lawn; wider than the water so a muddy,
    // noise-eroded shore band shows along both banks instead of straight stone kerbs
    const bedGeo = new THREE.PlaneGeometry(w + 1.4, len * 0.98, 2, 12);
    bedGeo.rotateX(-Math.PI / 2);
    const bedUv = bedGeo.attributes.uv;
    for (let i = 0; i < bedUv.count; i++) bedUv.setY(i, bedUv.getY(i) * Math.max(1, len / 3.2));
    const bed = new THREE.Mesh(bedGeo, riverbedMat);
    bed.position.y = 0.015;

    // Continuous directional flowing stream surface at y=0.062 (flows smoothly right underneath every bridge!).
    // 12% wider than the nominal channel: the shader erodes the banks back with noise.
    const ribbonGeo = new THREE.PlaneGeometry(w * 1.12, len, 10, 48);
    ribbonGeo.rotateX(-Math.PI / 2);
    const ribbon = new THREE.Mesh(ribbonGeo, streamMat);
    ribbon.position.y = 0.062;

    chGroup.add(bed, ribbon);
    chGroup.userData.keepInBattle = true;
    group.add(chGroup);

    // Block walking straight into deep water/magma EXCEPT across arched bridges!
    const samples = Math.max(8, Math.floor(len / 1.8));
    for (let s = 0; s <= samples; s++) {
      const u = s / samples;
      const sx = cx0 + dx * u;
      const sz = cz0 + dz * u;
      if (!isInsideCoast(sx, sz, 0.5)) continue;
      const coveredByBridge = bridges.some((br) => Math.hypot(sx - br.x, sz - br.z) < (br.width || 3.4) * 0.76);
      if (!coveredByBridge) {
        colliders.push({ x: sx, z: sz, r: w * 0.44 });
      }
    }

    // Cascading waterfalls where the stream spills off the island: lawn lip -> shore shelf -> open sea
    if (theme !== 'volcano') {
      const ux = dx / Math.max(len, 1e-4);
      const uz = dz / Math.max(len, 1e-4);
      for (const [ex, ez, sx, sz] of [
        [cx1, cz1, ux, uz],
        [cx0, cz0, -ux, -uz],
      ]) {
        if (isInsideCoast(ex, ez, 1.0)) continue; // channel ends inland: no drop
        addStreamCascade(ex, ez, sx, sz, w);
      }
    }

    // Round spring pools where a channel starts/ends inland, so the stream rises from a pond with a meandering
    // bank instead of stopping in a square-cut rectangle. Polar UVs feed the same bank/shoulder shaders:
    //   water: uv.x = 0.5 + 0.5·(r/R) → stream shader bankDist 0 (centre) … 1 (noisy rim)
    //   bed:   uv.x = min(0.5, 0.5·(R−r)/bedHalf) → ribbon-edge shader sees the same metres-to-edge as a bank
    for (const [ex, ez] of [
      [cx0, cz0],
      [cx1, cz1],
    ]) {
      if (!isInsideCoast(ex, ez, 2.4)) continue;
      if (bridges.some((br) => Math.hypot(ex - br.x, ez - br.z) < Math.max(br.width || 3.4, br.length || 5.2) * 0.6 + 1.0)) continue;
      const R = w * 0.78 + 1.05;
      const bedHalf = (w + 1.4) * 0.5;
      const makePondGeometry = (radius, uvFor) => {
        const segs = 44;
        const rings = 4;
        const pos = [];
        const uv = [];
        const idx = [];
        pos.push(0, 0, 0);
        uv.push(uvFor(0), 0.5);
        for (let ring = 1; ring <= rings; ring++) {
          const rr = (ring / rings) * radius;
          for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
            uv.push(uvFor(rr), 0.5 + 0.5 * Math.sin(a));
          }
        }
        for (let s = 0; s < segs; s++) {
          const n = (s + 1) % segs;
          idx.push(0, 1 + n, 1 + s);
        }
        for (let ring = 1; ring < rings; ring++) {
          const base = 1 + (ring - 1) * segs;
          const nextBase = base + segs;
          for (let s = 0; s < segs; s++) {
            const n = (s + 1) % segs;
            idx.push(base + s, nextBase + n, nextBase + s, base + s, base + n, nextBase + n);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };
      const pondBed = new THREE.Mesh(
        makePondGeometry(R + 0.7, (r) => Math.min(0.5, (0.5 * (R + 0.7 - r)) / bedHalf)),
        riverbedMat,
      );
      pondBed.position.set(ex, 0.02, ez);
      pondBed.rotation.y = rand() * Math.PI * 2;
      pondBed.receiveShadow = shadowsOn;
      pondBed.userData.keepInBattle = true;
      const pondWater = new THREE.Mesh(makePondGeometry(R, (r) => 0.5 + (0.5 * r) / R), streamMat);
      pondWater.position.set(ex, 0.066, ez);
      pondWater.userData.keepInBattle = true;
      group.add(pondBed, pondWater);
      colliders.push({ x: ex, z: ez, r: R * 0.78 });
    }
  }

  // Walkable Arched 3D Bridges (0.38m sunlit air gap above y=0.062 flowing water + zero coplanar plank faces!)
  const bridgeTimberMat = pbrMaterial(woodPair, {
    color: '#d97706',
    roughness: 0.55,
  });
  const bridgeStoneMat = pbrMaterial(cobblePair, {
    color: theme === 'volcano' ? '#78716c' : '#e2e8f0',
    roughness: 0.62,
  });

  for (const br of bridges) {
    const bw = br.width || 3.4;
    const bl = br.length || 5.4;
    const isStone = br.style === 'stone';
    const deckMat = isStone ? bridgeStoneMat : bridgeTimberMat;
    const railMat = isStone ? cliffBaseMat : bridgeTimberMat;

    const bg = new THREE.Group();
    bg.position.set(br.x, 0, br.z);
    bg.rotation.y = br.yaw || 0;

    // Solid stone abutment foundations on both banks outside the stream channel
    for (const endSign of [-1, 1]) {
      const abut = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.24, 0.14, 0.55), cliffBaseMat);
      abut.position.set(0, 0.07, endSign * (bl * 0.5 + 0.12));
      bg.add(markStatic(abut));
    }

    const planks = 11;
    const plankStep = bl / planks;
    for (let i = 0; i < planks; i++) {
      const u = (i + 0.5) / planks - 0.5; // -0.5..0.5
      const lz = u * bl;
      const archY = 0.08 + Math.cos(u * Math.PI) * 0.36;
      // Crisp 0.03m gap between planks eliminates coplanar side-face z-fighting and shows real timber/stone joints!
      const plank = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.11, plankStep - 0.03), deckMat);
      plank.position.set(0, archY, lz);
      plank.rotation.x = Math.sin(u * Math.PI) * 0.19;
      if (shadowsOn) {
        plank.castShadow = true;
        plank.receiveShadow = true;
      }
      bg.add(markStatic(plank));
    }

    // Arched side posts & segmented arched handrails following the bridge curve
    for (const side of [-1, 1]) {
      const postUs = [-0.46, -0.23, 0, 0.23, 0.46];
      for (const u of postUs) {
        const archY = 0.08 + Math.cos(u * Math.PI) * 0.36;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.16), railMat);
        post.position.set(side * (bw * 0.5 - 0.09), archY + 0.31, u * bl);
        bg.add(markStatic(post));
      }
      for (let r = 0; r < postUs.length - 1; r++) {
        const u0 = postUs[r];
        const u1 = postUs[r + 1];
        const y0 = 0.08 + Math.cos(u0 * Math.PI) * 0.36 + 0.58;
        const y1 = 0.08 + Math.cos(u1 * Math.PI) * 0.36 + 0.58;
        const z0 = u0 * bl;
        const z1 = u1 * bl;
        const rLen = Math.hypot(z1 - z0, y1 - y0);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, rLen + 0.04), railMat);
        rail.position.set(side * (bw * 0.5 - 0.09), (y0 + y1) * 0.5, (z0 + z1) * 0.5);
        rail.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
        bg.add(markStatic(rail));
      }
    }
    bg.userData.keepInBattle = true;
    markReflective(bg);
    group.add(bg);
  }

  // Coastal Wooden Boardwalk Piers jutting out into the bay!
  for (const p of piers) {
    const pw = p.width || 3.0;
    const pl = p.length || 6.0;
    const pg = new THREE.Group();
    pg.position.set(p.x, 0, p.z);
    pg.rotation.y = p.yaw || 0;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.15, pl), bridgeTimberMat);
    deck.position.y = 0.095;
    deck.receiveShadow = shadowsOn;
    deck.castShadow = shadowsOn;
    pg.add(markStatic(deck));

    for (const side of [-1, 1]) {
      for (const uz of [-0.42, 0.0, 0.42]) {
        const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.45, 8), bridgeTimberMat);
        piling.position.set(side * (pw * 0.46), -0.32, uz * pl);
        pg.add(markStatic(piling));
      }
    }
    pg.userData.keepInBattle = true;
    markReflective(pg);
    group.add(pg);
  }

  // 3. Winding Cobblestone Avenues + Town Plaza Mosaic: Catmull-Rom spline ribbons draped over the relief, with
  //    shader-eroded dirt shoulders and ends (no box segments, kerbs or junction discs), staggered a few mm so
  //    overlapping ribbons at junctions never z-fight.
  const pathTint =
    theme === 'volcano' ? '#a8a29e' : theme === 'snow' ? '#e2e8f0' : '#fff7ed';

  const plazaX = (zone.landmarks && zone.landmarks[0]) ? zone.landmarks[0].x : 0;
  const plazaZ = (zone.landmarks && zone.landmarks[0]) ? zone.landmarks[0].z : 2.0;
  const hasCentralPlaza = Math.hypot(plazaX, plazaZ) < 12;

  const juncPair = loadDedicatedPair('cobble_path', 1, 1);
  const roadSegMat = pbrMaterial(juncPair, {
    normalScale: new THREE.Vector2(1.08, 1.08),
    color: pathTint,
    roughness: 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  attachRibbonEdgeShader(roadSegMat, {
    shoulderColor: theme === 'volcano' ? '#4a3a33' : theme === 'snow' ? '#b9c3cc' : theme === 'harbor' ? '#9a8e78' : '#8a6d46',
    edgeWidth: 0.075,
    shoulderWidth: 0.2,
    wobble: 0.16,
    noiseScale: 1.7,
    roughen: 0.18,
    endFade: true,
    endScale: 1 / 3.6, // ribbons are 2.5 m + 2 × 0.55 m shoulder wide
  });

  // Catmull-Rom spline ribbons that follow the terrain relief; broken only around bridge footprints and the coast.
  let ribbonIdx = 0;
  const emitRoadRibbon = (run, width) => {
    if (run.length < 2) return;
    const lift = 0.03 + (ribbonIdx++ % 7) * 0.0035; // staggered so overlapping ribbons at junctions never z-fight
    const half = width * 0.5 + 0.55; // outer 0.55m is the eroded dirt shoulder
    const positions = [];
    const uvs = [];
    const indices = [];
    const dists = [];
    let dist = 0;
    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      const prev = run[Math.max(0, i - 1)];
      const next = run[Math.min(run.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = -tz;
      const nz = tx;
      if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      dists.push(dist);
      const lx = p.x - nx * half;
      const lz = p.z - nz * half;
      const rx = p.x + nx * half;
      const rz = p.z + nz * half;
      positions.push(lx, getHeightAt(lx, lz) + lift, lz, rx, getHeightAt(rx, rz) + lift, rz);
      uvs.push(0, dist / 2.6, 1, dist / 2.6);
      if (i > 0) {
        // CCW seen from above (+Y) so the FrontSide material is not back-face culled
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // Metres to the nearest ribbon end: lets the shader round off / erode the ends like the sides
    const ends = new Float32Array(run.length * 2);
    for (let i = 0; i < run.length; i++) {
      const e = Math.min(dists[i], dist - dists[i]);
      ends[i * 2] = e;
      ends[i * 2 + 1] = e;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aRibbonEnd', new THREE.BufferAttribute(ends, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, roadSegMat);
    mesh.receiveShadow = shadowsOn;
    mesh.userData.keepInBattle = true;
    group.add(markStatic(mesh));
  };
  const buildRoadRibbon = (points, width = 2.5) => {
    const pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (pts.length < 2) return;
    const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const length = curve.getLength();
    const samples = Math.max(6, Math.ceil(length / 0.5));
    const spaced = curve.getSpacedPoints(samples);
    let run = [];
    const flush = () => {
      emitRoadRibbon(run, width);
      run = [];
    };
    for (const p of spaced) {
      const nearBridge = bridges.some((br) => Math.hypot(p.x - br.x, p.z - br.z) < Math.max(br.width || 3.4, (br.length || 5.2) * 0.5) * 0.56 + 0.15);
      if (nearBridge || !isInsideCoast(p.x, p.z, 0.3)) {
        flush();
        continue;
      }
      run.push(p);
    }
    flush();
  };
  for (const poly of roads) buildRoadRibbon(poly, 2.5);

  // Central Town Plaza Stone Circle (elevated cleanly above road segments so zero z-fighting!)
  if (hasCentralPlaza) {
    const plazaPair = loadDedicatedPair('cobble_path', 3, 3);
    const plazaMat = pbrMaterial(plazaPair, {
      normalScale: new THREE.Vector2(1.05, 1.05),
      color: pathTint,
      roughness: 0.68,
    });
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.85, 0.056, 40), plazaMat);
    plaza.position.set(plazaX, 0.036, plazaZ);
    plaza.receiveShadow = shadowsOn;
    plaza.userData.keepInBattle = true;
    group.add(plaza);

    const plazaRim = new THREE.Mesh(
      new THREE.TorusGeometry(4.62, 0.12, 10, 48),
      new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.38, metalness: 0.18 }),
    );
    plazaRim.rotation.x = Math.PI / 2;
    plazaRim.position.set(plazaX, 0.072, plazaZ);
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
    pl.layers.enable(REFLECTION_LAYER);
    group.add(pl);
  };

  const addStreetLamp = (lx, lz) => {
    const ly = getHeightAt(lx, lz);
    const lampActor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_street_lamp.glb',
      scale: 2.95,
      primaryColor: '#f59e0b',
      secondaryColor: '#452711',
      shadowRadius: 0.55,
      standInKind: 'prop',
    });
    lampActor.root.position.set(lx, ly, lz);
    markReflective(lampActor.root);
    group.add(lampActor.root);
    loadPromises.push(lampActor.readyPromise);
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

  // 5. Dense Wind-Swaying 7-Blade 3D Grass Clumps + Biome-Aware Regional Palettes + Tall-Grass Wild Meadows!
  const baseGrassCount =
    theme === 'harbor'
      ? 620
      : theme === 'volcano' || theme === 'desert' || theme === 'sky'
        ? 440
        : 1280;
  const grassCount = Math.round(
    baseGrassCount * areaScale * (isSoftwareGl && quality === 'low' ? 0.42 : preset.grassScale || 1.0),
  );
  const clumpGeo = getCurvedGrassClumpGeometry(preset.grassBlades === 'lite');
  const grassMat = new THREE.MeshStandardMaterial({
    map: makeGrassBladeTexture(),
    alphaTest: 0.38,
    roughness: 0.78,
    metalness: 0.0,
    envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  attachWindGrassShader(grassMat, {
    uTime: sharedTime,
    uHeroPos: sharedHeroPos,
    windStrength: theme === 'snow' ? 0.16 : 0.26,
  });

  const grassInst = new THREE.InstancedMesh(clumpGeo, grassMat, grassCount);
  grassInst.castShadow = shadowsOn && preset.grassShadows === true;
  grassInst.receiveShadow = false;
  const grassPalette =
    theme === 'snow' || theme === 'sky'
      ? ['#a5d8f0', '#cfe8f6', '#7cc4e8', '#e8e3a0']
      : theme === 'desert'
        ? ['#c9a227', '#b08a1e', '#7f9a2a', '#d9bd4a']
        : theme === 'volcano'
          ? ['#d9743a', '#c25f2c', '#d9a33a', '#b7501f']
          : theme === 'forest'
            ? ['#2f8f3f', '#267a35', '#49a44e', '#6fa33a', '#86b04a']
            : ['#2f9440', '#3aa44a', '#55b35a', '#287d36', '#78bf63'];

  const biomeGrassPalettes = {
    sand: ['#d9bd4a', '#c9a227', '#84a93c', '#eab308'],
    snow: ['#bae6fd', '#e0f2fe', '#7dd3fc', '#cbd5e1'],
    basalt: ['#ea580c', '#d97706', '#b45309', '#f59e0b'],
    stone: ['#65a30d', '#84cc16', '#4d7c0f', '#a3e635'],
    grove: ['#15803d', '#16a34a', '#22c55e', '#4d7c0f'],
    wetland: ['#0d9488', '#14b8a6', '#10b981', '#2dd4bf'],
    flowerfield: ['#22c55e', '#4ade80', '#84cc16', '#16a34a'],
  };
  const pickGrassHex = (gx, gz, idx) => {
    const bp = sampleBiomePatchAt(gx, gz);
    const pal = (bp && biomeGrassPalettes[bp.kind]) || grassPalette;
    return pal[idx % pal.length];
  };

  const dummy = new THREE.Object3D();
  const gCol = new THREE.Color();
  let placedGrass = 0;

  // 5a. First seed dense, waist-high rustling Tall-Grass Habitat Patches (`zone.tallGrassPatches`)!
  const patches = zone.tallGrassPatches || [];
  const tallQuota = Math.min(Math.floor(grassCount * 0.48), patches.length * 165);
  for (let i = 0; i < tallQuota * 3 && placedGrass < tallQuota && patches.length > 0; i++) {
    const patch = patches[i % patches.length];
    // Uniform disc fill plus a ragged ±18% rim so the habitat has no crisp elliptical outline
    const r = Math.sqrt(rand()) * (0.82 + rand() * 0.36);
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
    gCol.set(pickGrassHex(gx, gz, placedGrass)).multiplyScalar(0.92);
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
    const bpHere = sampleBiomePatchAt(gx, gz);
    if (bpHere && (bpHere.kind === 'sand' || bpHere.kind === 'basalt' || bpHere.kind === 'snow') && rand() < 0.62) continue;

    const gy = getHeightAt(gx, gz);
    dummy.position.set(gx, gy, gz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.82 + rand() * 0.75;
    dummy.scale.set(s, s * (0.9 + rand() * 0.42), s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass, dummy.matrix);
    gCol.set(pickGrassHex(gx, gz, placedGrass));
    grassInst.setColorAt(placedGrass, gCol);
    placedGrass++;
  }
  grassInst.count = placedGrass;
  if (grassInst.instanceColor) grassInst.instanceColor.needsUpdate = true;
  group.add(grassInst);

  // 5c. Woodland Fern Rosettes (`InstancedMesh`) + Wildflower Blossoms!
  if (theme !== 'volcano') {
    const fernCount = Math.round((theme === 'forest' ? 140 : theme === 'tropical' ? 115 : 70) * areaScale);
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

  const flowerCount = Math.round(210 * areaScale * (preset.grassScale || 1.0));
  const flowerGeo = getFlowerGeometry();
  const flowerMat = new THREE.MeshStandardMaterial({
    map: makeFlowerTexture(),
    roughness: 0.55,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
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
    dummy.position.set(fx, fy + 0.005, fz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.82 + rand() * 0.7;
    dummy.scale.set(s, s * (0.9 + rand() * 0.5), s);
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
  const rockMat = pbrMaterial(cliffPair, {
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: theme === 'snow' ? '#e2e8f0' : theme === 'volcano' ? '#57534e' : '#d6c7b2',
    roughness: 0.78,
  });
  attachTriplanarRockShader(rockMat, { uTime: sharedTime, scale: 2.4, isVolcano: theme === 'volcano' });

  // 6a. Mountain massifs: craggy noise-eroded peaks on their walkable mound, snow-capped on alpine peaks,
  //     ringed with tumbled boulders. (Positions were chosen with the openness mask above.)
  const snowCapMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.55, metalness: 0.0 });
  for (const m of massifs) {
    const mg = new THREE.Group();
    mg.userData.keepInBattle = true;
    for (const cg of m.crags) {
      const baseY = getHeightAt(cg.x, cg.z);
      const crag = new THREE.Mesh(makeCragGeometry(rand, cg.r, cg.h), rockMat);
      crag.position.set(cg.x, baseY + cg.h * 0.42, cg.z);
      crag.rotation.y = rand() * Math.PI * 2;
      if (shadowsOn) {
        crag.castShadow = true;
        crag.receiveShadow = true;
      }
      mg.add(markStatic(crag));
      if (theme === 'snow' || (cg.h > 6.4 && theme !== 'volcano')) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(cg.r * 0.46, cg.h * 0.26, 8), snowCapMat);
        cap.position.set(cg.x, baseY + cg.h * 0.92 - cg.h * 0.1, cg.z);
        cap.rotation.y = crag.rotation.y;
        if (shadowsOn) cap.castShadow = true;
        mg.add(markStatic(cap));
      }
    }
    const boulderCount = 3 + Math.floor(rand() * 3);
    for (let b = 0; b < boulderCount; b++) {
      const a = rand() * Math.PI * 2;
      const dist = m.r * (0.55 + rand() * 0.45);
      const bx = m.x + Math.cos(a) * dist;
      const bz = m.z + Math.sin(a) * dist;
      if (!isInsideCoast(bx, bz, 2.0) || isNearRoadOrRiver(bx, bz, 1.8)) continue;
      const sc = 0.55 + rand() * 0.5;
      const rock = new THREE.Mesh(makeRockGeometry(rand, 0.6 * sc), rockMat);
      rock.position.set(bx, getHeightAt(bx, bz) + 0.22 * sc, bz);
      rock.rotation.y = rand() * Math.PI * 2;
      if (shadowsOn) rock.castShadow = true;
      mg.add(markStatic(rock));
      colliders.push({ x: bx, z: bz, r: 0.55 * sc });
      proceduralObstacles.push({ x: bx, z: bz, r: 0.7 * sc });
    }
    markReflective(mg);
    group.add(mg);
  }

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
        : theme === 'desert'
          ? [
              { glb: 'assets/models/env_desert_cactus.glb', scale: 2.95, r: 0.78 },
              { glb: 'assets/models/env_desert_cactus.glb', scale: 2.35, r: 0.68 },
              { glb: 'assets/models/env_palm_tree.glb', scale: 3.6, r: 0.82 },
            ]
          : theme === 'sky'
            ? [
                { glb: 'assets/models/env_sky_crystal_tree.glb', scale: 3.55, r: 0.9 },
                { glb: 'assets/models/env_sky_crystal_tree.glb', scale: 2.9, r: 0.78 },
                { glb: 'assets/models/env_alpine_pine.glb', scale: 3.3, r: 0.82 },
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
                    { glb: 'assets/models/env_volcano_obelisk.glb', scale: 2.75, r: 0.85 },
                    { glb: 'assets/models/env_mossy_boulder.glb', scale: 1.95, r: 0.78 },
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

  // Place TRELLIS.2 3D `.glb` trees & tropical flora clusters along scenic bays, rivers, groves & sub-biomes!
  const targetGlbCount = Math.round((theme === 'volcano' ? 10 : 20) * areaScale);
  const biomeGlbMap = {
    sand: { glb: 'assets/models/env_desert_cactus.glb', scale: 2.85, r: 0.76 },
    snow: { glb: 'assets/models/env_alpine_pine.glb', scale: 3.7, r: 0.88 },
    basalt: { glb: 'assets/models/env_volcano_obelisk.glb', scale: 2.55, r: 0.82 },
    stone: { glb: 'assets/models/env_mossy_boulder.glb', scale: 2.05, r: 0.78 },
    grove: { glb: 'assets/models/env_canopy_oak.glb', scale: 3.9, r: 0.96 },
    wetland: { glb: 'assets/models/env_tropical_flora.glb', scale: 2.15, r: 0.68 },
    flowerfield: { glb: 'assets/models/env_canopy_oak.glb', scale: 3.4, r: 0.88 },
  };
  // First seed 2–4 signature `.glb` regional props inside each sub-biome patch so every biome looks unmistakable!
  for (const bp of biomePatches) {
    const bpSpec = biomeGlbMap[bp.kind];
    if (!bpSpec) continue;
    let bpPlaced = 0;
    const ca = Math.cos(bp.rot || 0);
    const sa = Math.sin(bp.rot || 0);
    for (let attempt = 0; attempt < 36 && bpPlaced < 3; attempt++) {
      const rr = 0.25 + 0.62 * Math.sqrt(rand());
      const aa = rand() * Math.PI * 2;
      const lx = Math.cos(aa) * (bp.rx || 10) * rr;
      const lz = Math.sin(aa) * (bp.rz || 8) * rr;
      const tx = bp.x + lx * ca - lz * sa;
      const tz = bp.z + lx * sa + lz * ca;
      if (!canPlaceTree(tx, tz, 4.0)) continue;
      spawnTrellisTree(tx, tz, bpSpec);
      bpPlaced++;
    }
  }
  for (let attempt = 0; attempt < 320 && placedTreeCoords.length < targetGlbCount; attempt++) {
    const theta = rand() * Math.PI * 2;
    const radialBias = 0.35 + 0.6 * Math.sqrt(rand());
    const rCoast = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
    const tx = Math.cos(theta) * (halfW - 2.6) * rCoast * radialBias;
    const tz = Math.sin(theta) * (halfD - 2.6) * rCoast * radialBias;
    if (!canPlaceTree(tx, tz, 3.8)) continue;
    const bpHere = sampleBiomePatchAt(tx, tz);
    const spec = (bpHere && biomeGlbMap[bpHere.kind]) || treeGlbPool[placedTreeCoords.length % treeGlbPool.length];
    spawnTrellisTree(tx, tz, spec);
  }

  // Complementary Multi-Limb Sculpted Botanical Trees (zero plastic spheres — uses faceted normal-mapped boughs & roots!)
  const addComplexGroveTree = (tx, tz, kindOverride = null) => {
    const ty = getHeightAt(tx, tz);
    const tg = new THREE.Group();
    tg.position.set(tx, ty, tz);
    const effTheme = kindOverride || theme;

    const barkMat = new THREE.MeshStandardMaterial({
      map: woodPair.map,
      normalMap: woodPair.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: effTheme === 'snow' ? '#5c4033' : '#78350f',
      roughness: 0.72,
    });

    if (effTheme === 'desert' || effTheme === 'sand') {
      // Sculpted Saguaro Desert Cactus with two classic arms + golden flower!
      const cactusMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.55 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 2.4, 10), cactusMat);
      stem.position.y = 1.2;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), cactusMat);
      top.position.y = 2.4;
      const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.95, 8), cactusMat);
      armL.position.set(-0.48, 1.55, 0);
      const elbowL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.28), cactusMat);
      elbowL.position.set(-0.3, 1.15, 0);
      const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.85, 8), cactusMat);
      armR.position.set(0.48, 1.75, 0);
      const elbowR = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.28), cactusMat);
      elbowR.position.set(0.3, 1.38, 0);
      const bloom = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18, 0),
        new THREE.MeshBasicMaterial({ color: '#fde047' }),
      );
      bloom.position.y = 2.68;
      tg.add(stem, top, armL, elbowL, armR, elbowR, bloom);
    } else if (effTheme === 'sky') {
      // Celestial Cloud-Puff Column + Starlight Crystal!
      const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
      for (const [ox, oy, oz, rad] of [
        [0, 0.55, 0, 0.78],
        [-0.45, 0.42, 0.25, 0.55],
        [0.48, 0.45, -0.22, 0.58],
      ]) {
        const puff = new THREE.Mesh(weldSmooth(new THREE.IcosahedronGeometry(rad, 2)), cloudMat);
        puff.position.set(ox, oy, oz);
        tg.add(puff);
      }
      const starSpire = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshStandardMaterial({ color: '#fde047', emissive: '#facc15', emissiveIntensity: 0.75 }),
      );
      starSpire.scale.set(0.8, 2.2, 0.8);
      starSpire.position.y = 1.65;
      tg.add(starSpire);
    } else if (effTheme === 'volcano' || effTheme === 'basalt') {
      const base = new THREE.Mesh(makeRockGeometry(rand, 0.95), rockMat);
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
    } else if (effTheme === 'snow') {
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
        if (shadowsOn) cone.castShadow = true;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(tier.r * 0.84, tier.h * 0.52, 9), snowCapMat);
        cap.position.y = tier.y + tier.h * 0.24;
        tg.add(cone, cap);
      }
    } else {
      // Gnarled multi-root trunk + 3 spreading branches + 6 overlapping faceted foliage boughs!
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.44, 1.85, 9), barkMat);
      trunk.position.y = 0.92;
      trunk.rotation.z = (rand() - 0.5) * 0.14;
      if (shadowsOn) trunk.castShadow = true;
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
        const tuft = new THREE.Mesh(makeFoliageTuftGeometry(rand, 0.92), mat);
        tuft.position.set(bx, by, bz);
        tuft.scale.set(sx, sy, sz);
        tuft.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
        if (shadowsOn) tuft.castShadow = true;
        tg.add(tuft);
      }
    }

    markReflective(tg);
    group.add(tg);
    colliders.push({ x: tx, z: tz, r: 0.92 });
    placedTreeCoords.push([tx, tz]);
  };

  // Seed 2–3 sculpted regional props (saguaro cacti, snow-capped pines, glowing magma spires, or canopy oaks) inside each biome patch!
  for (const bp of biomePatches) {
    const sculptKind =
      bp.kind === 'sand'
        ? 'sand'
        : bp.kind === 'snow'
          ? 'snow'
          : bp.kind === 'basalt'
            ? 'basalt'
            : bp.kind === 'grove'
              ? 'grove'
              : null;
    if (!sculptKind) continue;
    let count = 0;
    const ca = Math.cos(bp.rot || 0);
    const sa = Math.sin(bp.rot || 0);
    for (let attempt = 0; attempt < 35 && count < 3; attempt++) {
      const rr = 0.25 + 0.65 * Math.sqrt(rand());
      const aa = rand() * Math.PI * 2;
      const lx = Math.cos(aa) * (bp.rx || 10) * rr;
      const lz = Math.sin(aa) * (bp.rz || 8) * rr;
      const tx = bp.x + lx * ca - lz * sa;
      const tz = bp.z + lx * sa + lz * ca;
      if (!canPlaceTree(tx, tz, 4.2)) continue;
      addComplexGroveTree(tx, tz, sculptKind);
      count++;
    }
  }

  // 6b. Procedural complex trees (branching trunks + leaf-card canopies / needle-tier conifers / charred
  //     snags) packed into instanced forests: 2–4 woodland patches in open countryside plus scattered singles.
  let forest = null;
  const usesProceduralForest = !['desert', 'sky'].includes(theme);
  if (usesProceduralForest) {
    const treeRand = seededRand((zone.index || 1) * 4241 + 77);
    const variants = createTreeVariants(theme, treeRand, { density: preset.treeDensity ?? 1.0 });
    const barkMat = new THREE.MeshStandardMaterial({
      map: makeBarkTexture(theme === 'snow' ? 'birch' : 'oak'),
      normalMap: woodPair.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.9,
      color: theme === 'snow' ? '#e7e5e4' : '#c9a27c',
    });
    const deadBarkMat = new THREE.MeshStandardMaterial({ map: makeBarkTexture('charred'), roughness: 0.95, color: '#6b5a55' });
    const leafMatFor = (kind, alphaTest = 0.42) => {
      const m = new THREE.MeshStandardMaterial({
        map: makeLeafClusterTexture(kind),
        alphaTest,
        side: THREE.DoubleSide,
        roughness: 0.62,
        metalness: 0.0,
        vertexColors: true,
        envMapIntensity: 0.4,
      });
      attachFoliageSubsurfaceShader(m, { uTime: sharedTime, windAmp: 0.075, sssColor: kind === 'autumn' ? '#fde68a' : '#bef264', sightFade: true });
      return m;
    };
    const coniferMat = new THREE.MeshStandardMaterial({
      map: makeNeedleTexture(theme === 'snow'),
      roughness: 0.75,
      vertexColors: true,
      side: THREE.DoubleSide,
      envMapIntensity: 0.35,
    });
    attachFoliageSubsurfaceShader(coniferMat, { uTime: sharedTime, windAmp: 0.035, sssColor: '#86efac', sightFade: true });
    forest = new TreeForest(
      variants,
      {
        bark: barkMat,
        deadBark: deadBarkMat,
        leaves: {
          broad: leafMatFor('broad'),
          tropical: leafMatFor('tropical'),
          autumn: leafMatFor('autumn'),
          frost: leafMatFor('frost'),
          conifer: coniferMat,
        },
        caps: snowCapMat,
      },
      { castShadows: shadowsOn },
    );
    const addForestTree = (tx, tz, minSpacing, scaleMul = 1.0) => {
      if (!canPlaceTree(tx, tz, minSpacing)) return false;
      if (openness(tx, tz) < 0.25) return false;
      const vi = Math.floor(treeRand() * variants.length);
      const sc = (0.82 + treeRand() * 0.42) * scaleMul;
      forest.add(vi, tx, getHeightAt(tx, tz), tz, treeRand() * Math.PI * 2, sc);
      colliders.push({ x: tx, z: tz, r: 0.46 * sc });
      placedTreeCoords.push([tx, tz]);
      return true;
    };
    // Woodland patches
    const patchTarget = Math.max((zone.forests || []).length + 2, Math.round((theme === 'forest' ? 6 : theme === 'harbor' ? 4 : 5) * Math.sqrt(areaScale)));
    const patches = [];
    for (const f of zone.forests || []) patches.push({ x: f.x, z: f.z, rx: f.rx || 8, rz: f.rz || f.rx || 6.5, rot: f.rot || 0, dense: f.dense });
    for (let attempt = 0; attempt < 180 && patches.length < patchTarget; attempt++) {
      const px = (rand() * 2 - 1) * (halfW - 6.5);
      const pz = (rand() * 2 - 1) * (halfD - 6);
      const rx = 5.0 + rand() * 5.2;
      const rz = 4.2 + rand() * 4.2;
      if (openness(px, pz) < 0.6) continue;
      const bpAt = sampleBiomePatchAt(px, pz);
      if (bpAt && (bpAt.kind === 'sand' || bpAt.kind === 'basalt')) continue;
      let ringOpen = 1;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ringOpen = Math.min(ringOpen, openness(px + Math.cos(a) * rx * 0.55, pz + Math.sin(a) * rz * 0.55));
      }
      if (ringOpen < 0.4) continue;
      if (massifs.some((m) => Math.hypot(m.x - px, m.z - pz) < m.r + rx * 0.5)) continue;
      if (patches.some((o) => Math.hypot(o.x - px, o.z - pz) < (o.rx + rx) * 0.68)) continue;
      patches.push({ x: px, z: pz, rx, rz, rot: rand() * Math.PI, dense: theme === 'forest' });
    }
    const forestPatches = [];
    for (const pt of patches) {
      const spacing = pt.dense ? 2.3 : 2.65;
      let placed = 0;
      const maxTrees = pt.dense ? 26 : 20;
      const ca = Math.cos(pt.rot);
      const sa = Math.sin(pt.rot);
      for (let attempt = 0; attempt < 110 && placed < maxTrees; attempt++) {
        const r = Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        const lx = Math.cos(a) * pt.rx * r;
        const lz = Math.sin(a) * pt.rz * r;
        const tx = pt.x + lx * ca - lz * sa;
        const tz = pt.z + lx * sa + lz * ca;
        if (addForestTree(tx, tz, spacing, 0.9 + r * 0.22)) placed++;
      }
      if (placed > 0) forestPatches.push({ ...pt, trees: placed });
    }
    // Scattered singles along bays, hills and groves
    const singlesTarget = Math.round((theme === 'volcano' ? 11 : 22) * areaScale);
    let singles = 0;
    for (let attempt = 0; attempt < 260 && singles < singlesTarget; attempt++) {
      const theta = rand() * Math.PI * 2;
      const rCoast = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
      const rad = 0.42 + rand() * 0.52;
      const bx = Math.cos(theta) * (halfW - 2.4) * rCoast * rad;
      const bz = Math.sin(theta) * (halfD - 2.4) * rCoast * rad;
      const bpAt = sampleBiomePatchAt(bx, bz);
      if (bpAt && (bpAt.kind === 'sand' || bpAt.kind === 'basalt')) continue;
      if (addForestTree(bx, bz, 3.5)) singles++;
    }
    forest.finalize();
    group.add(forest.group);

    // Forest-floor undergrowth: extra fern rosettes beneath the woodland canopies
    if (forestPatches.length > 0 && theme !== 'volcano') {
      const floorFernCount = Math.round(forestPatches.length * 22 * (preset.grassScale || 1));
      const floorFernMat = attachFoliageSubsurfaceShader(
        new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide }),
        { uTime: sharedTime, windAmp: 0.05, sssColor: '#a3e635' },
      );
      const floorFerns = new THREE.InstancedMesh(getFernRosetteGeometry(), floorFernMat, floorFernCount);
      const fernTints = theme === 'snow' ? ['#5eead4', '#99f6e4', '#2dd4bf'] : ['#166534', '#15803d', '#3f6212', '#4d7c0f'];
      let placedFloor = 0;
      for (let i = 0; i < floorFernCount * 3 && placedFloor < floorFernCount; i++) {
        const pt = forestPatches[i % forestPatches.length];
        const r = Math.sqrt(rand());
        const a = rand() * Math.PI * 2;
        const fx = pt.x + Math.cos(a) * pt.rx * r;
        const fz = pt.z + Math.sin(a) * pt.rz * r;
        if (!isInsideCoast(fx, fz, 2.0) || isNearRoadOrRiver(fx, fz, 1.6)) continue;
        if (proceduralObstacles.some((ob) => Math.hypot(ob.x - fx, ob.z - fz) < ob.r + 0.4)) continue;
        dummy.position.set(fx, getHeightAt(fx, fz), fz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        const s = 0.7 + rand() * 0.7;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        floorFerns.setMatrixAt(placedFloor, dummy.matrix);
        floorFerns.setColorAt(placedFloor, gCol.set(fernTints[placedFloor % fernTints.length]));
        placedFloor++;
      }
      floorFerns.count = placedFloor;
      if (floorFerns.instanceColor) floorFerns.instanceColor.needsUpdate = true;
      group.add(floorFerns);
    }
  } else {
    const extraSpec =
      theme === 'desert'
        ? { glb: 'assets/models/env_desert_cactus.glb', scale: 2.55, r: 0.72 }
        : { glb: 'assets/models/env_sky_crystal_tree.glb', scale: 3.15, r: 0.82 };
    for (let attempt = 0; attempt < 90 && placedTreeCoords.length < targetGlbCount + 9; attempt++) {
      const theta = rand() * Math.PI * 2;
      const rCoast = computeCoastRadiusNorm(theta, coastParams, lobeDirs);
      const rad = 0.74 + rand() * 0.2;
      const bx = Math.cos(theta) * (halfW - 2.2) * rCoast * rad;
      const bz = Math.sin(theta) * (halfD - 2.2) * rCoast * rad;
      if (canPlaceTree(bx, bz, 3.6)) spawnTrellisTree(bx, bz, extraSpec);
    }
  }

  // TRELLIS.2 Sculpted Mossy Boulders (`env_mossy_boulder.glb`) along coves & trails
  const targetBoulders = Math.round(14 * areaScale);
  for (let i = 0; i < targetBoulders; i++) {
    const rx = (rand() * 2 - 1) * (halfW - 3.0);
    const rz = (rand() * 2 - 1) * (halfD - 3.0);
    if (!canPlaceTree(rx, rz, 3.2)) continue;
    const ry = getHeightAt(rx, rz);
    const sc = 1.45 + rand() * 0.75;
    const boulderActor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_mossy_boulder.glb',
      scale: sc,
      primaryColor: '#64748b',
      secondaryColor: '#22c55e',
      shadowRadius: sc * 0.45,
      standInKind: 'prop',
    });
    boulderActor.root.position.set(rx, ry, rz);
    boulderActor.animRoot.rotation.y = rand() * Math.PI * 2;
    markReflective(boulderActor.root);
    group.add(boulderActor.root);
    loadPromises.push(boulderActor.readyPromise);
    colliders.push({ x: rx, z: rz, r: 0.48 * sc });
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
    const mound = new THREE.Mesh(makeRockGeometry(rand, sc), rockMat);
    mound.scale.set(1.35, 0.72, 1.15);
    mound.position.y = sc * 0.18;
    mound.rotation.y = rand() * Math.PI * 2;
    if (shadowsOn) mound.castShadow = true;
    const topPatch = new THREE.Mesh(new THREE.CylinderGeometry(sc * 0.78, sc * 0.95, 0.25, 12), lawnMat);
    topPatch.position.y = sc * 0.62;
    islet.add(markStatic(mound), markStatic(topPatch));
    markReflective(islet);
    group.add(islet);
  }

  // Drifting 3D cumulus field (casts real shadows across the island) + fogged horizon islands
  const cloudField = createCloudField({
    theme,
    halfW,
    halfD,
    rand,
    count: Math.max(3, Math.round(atmo.cloudMeshCount * (isMobileTier ? 0.55 : 1))),
    castShadows: shadowsOn,
    detail: preset.cloudDetail >= 3 ? 3 : isMobileTier ? 1 : 2,
  });
  cloudField.setSunDir(sunDir);
  markReflective(cloudField.group);
  group.add(cloudField.group);
  animated.push((t, dt) => cloudField.update(t, dt));

  const horizonIslands = createDistantIslands({
    theme,
    halfW,
    halfD,
    rand,
    count: 6,
    waterY: -0.82,
    cliffColor: theme === 'harbor' ? '#8a8f99' : '#9a7b5a',
    topColor: theme === 'forest' ? '#3f7a2f' : theme === 'harbor' ? '#5f9a4e' : '#4f9b45',
  });
  markReflective(horizonIslands);
  horizonIslands.traverse((o) => {
    if (o.isMesh) markStatic(o);
  });
  group.add(horizonIslands);

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
      new THREE.CylinderGeometry(1.18, 1.3, 0.05, 24),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.55,
        roughness: 0.28,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    matRing.position.set(h.x, doorY + 0.082, doorZ);
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
      new THREE.TorusGeometry(1.26, 0.075, 10, 28),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.72,
        roughness: 0.24,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(sh.x, sy + 0.085, sh.z);
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
      new THREE.TorusGeometry(0.96, 0.068, 10, 24),
      new THREE.MeshStandardMaterial({
        color: isOpened ? '#64748b' : '#fde047',
        emissive: isOpened ? '#1e293b' : '#f59e0b',
        emissiveIntensity: isOpened ? 0.2 : 0.75,
        roughness: 0.26,
      }),
    );
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.set(ch.x, cy + 0.082, ch.z);
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
      new THREE.TorusGeometry(0.58, 0.055, 10, 22),
      new THREE.MeshStandardMaterial({
        color: isSuper ? '#fde047' : '#fb7185',
        emissive: isSuper ? '#f59e0b' : '#e11d48',
        emissiveIntensity: 0.72,
        roughness: 0.24,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.078;
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
      new THREE.MeshBasicMaterial({
        color: '#7dd3fc',
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    innerPad.rotation.x = -Math.PI / 2;
    innerPad.position.y = 0.088;
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

  // 12b. Map-Inspired Rocky Mountain Ridge Chains (`zone.mountainWalls`)!
  //      Rendered as a staggered, size-varied double row of crags with a scree of foothill boulders so the
  //      ridge reads as weathered rock rather than a straight fence of identical cones. (Colliders unchanged.)
  const mountainWalls = zone.mountainWalls || [];
  for (const mw of mountainWalls) {
    const dx = mw.x1 - mw.x0;
    const dz = mw.z1 - mw.z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const w = mw.width || 2.3;
    const h = mw.height || 2.35;
    const ax = dx / len;
    const az = dz / len;
    const nx = -az;
    const nz = ax;
    const peaks = Math.max(3, Math.ceil(len / 1.65));
    const ridgeGroup = new THREE.Group();
    const addCrag = (px, pz, radius, height, tilt) => {
      const py = getHeightAt(px, pz);
      const crag = new THREE.Mesh(makeCragGeometry(rand, radius, height), rockMat);
      crag.position.set(px, py + height * 0.44, pz);
      crag.rotation.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt);
      if (shadowsOn) {
        crag.castShadow = true;
        crag.receiveShadow = true;
      }
      ridgeGroup.add(markStatic(crag));
    };
    for (let i = 0; i <= peaks; i++) {
      const u = i / peaks;
      const px = mw.x0 + dx * u;
      const pz = mw.z0 + dz * u;
      // Main spine: alternate sides of the axis, drift along it, and vary every peak's bulk
      const side = (i % 2 === 0 ? 1 : -1) * w * (0.12 + rand() * 0.2);
      const drift = (rand() - 0.5) * 0.6;
      const hVar = h * (0.72 + 0.42 * rand()) * (0.9 + 0.2 * Math.sin(i * 2.1 + 0.6));
      addCrag(px + nx * side + ax * drift, pz + nz * side + az * drift, w * (0.56 + rand() * 0.18), hVar, 0.16);
      // Secondary shoulder crags fill the gaps on the opposite side so no straight baseline shows through
      if (i < peaks && rand() < 0.75) {
        const su = u + (0.5 / peaks) * (0.7 + rand() * 0.6);
        const sSide = -Math.sign(side) * w * (0.28 + rand() * 0.22);
        addCrag(mw.x0 + dx * su + nx * sSide, mw.z0 + dz * su + nz * sSide, w * (0.34 + rand() * 0.16), hVar * (0.42 + rand() * 0.25), 0.26);
      }
      // Foothill scree: small boulders tumbled along both feet of the ridge
      for (const fs of [-1, 1]) {
        if (rand() < 0.45) continue;
        const fu = u + (rand() - 0.5) * (0.9 / peaks);
        const fx = mw.x0 + dx * fu + nx * fs * w * (0.62 + rand() * 0.3);
        const fz = mw.z0 + dz * fu + nz * fs * w * (0.62 + rand() * 0.3);
        if (!isInsideCoast(fx, fz, 0.8)) continue;
        const bs = 0.22 + rand() * 0.3;
        const boulder = new THREE.Mesh(makeRockGeometry(rand, bs), rockMat);
        boulder.position.set(fx, getHeightAt(fx, fz) + bs * 0.35, fz);
        boulder.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
        if (shadowsOn) {
          boulder.castShadow = true;
          boulder.receiveShadow = true;
        }
        ridgeGroup.add(markStatic(boulder));
      }
      colliders.push({ x: px, z: pz, r: w * 0.46 });
    }
    markReflective(ridgeGroup);
    group.add(ridgeGroup);
    if (Math.abs(dx) < 0.4 || Math.abs(dz) < 0.4) {
      boxColliders.push({
        minX: Math.min(mw.x0, mw.x1) - w * 0.42,
        maxX: Math.max(mw.x0, mw.x1) + w * 0.42,
        minZ: Math.min(mw.z0, mw.z1) - w * 0.42,
        maxZ: Math.max(mw.z0, mw.z1) + w * 0.42,
      });
    }
  }

  // 12c. Crenellated Walled-City / Colossus-Estate Stone Ramparts (`zone.cityWalls`)!
  const cityWalls = zone.cityWalls || [];
  for (const cw of cityWalls) {
    const dx = cw.x1 - cw.x0;
    const dz = cw.z1 - cw.z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const h = cw.height || 1.95;
    const thick = cw.thickness || 1.05;
    const wallMat = pbrMaterial(cobblePair, {
      color: cw.color || '#e2e8f0',
      roughness: 0.62,
    });
    const wg = new THREE.Group();
    const midX = (cw.x0 + cw.x1) * 0.5;
    const midZ = (cw.z0 + cw.z1) * 0.5;
    const baseY = getHeightAt(midX, midZ);
    wg.position.set(midX, baseY, midZ);
    wg.rotation.y = Math.atan2(dx, dz);

    const body = new THREE.Mesh(new THREE.BoxGeometry(thick, h, len), wallMat);
    body.position.y = h * 0.5;
    wg.add(markStatic(body));

    const merlons = Math.max(2, Math.floor(len / 1.55));
    for (let m = 0; m < merlons; m++) {
      const mz = ((m + 0.5) / merlons - 0.5) * len;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(thick * 1.08, 0.34, 0.65), wallMat);
      merlon.position.set(0, h + 0.17, mz);
      wg.add(markStatic(merlon));
    }
    markReflective(wg);
    if (shadowsOn) {
      body.castShadow = true;
      body.receiveShadow = true;
    }
    group.add(wg);

    if (Math.abs(dx) < 0.35 || Math.abs(dz) < 0.35) {
      boxColliders.push({
        minX: Math.min(cw.x0, cw.x1) - thick * 0.5,
        maxX: Math.max(cw.x0, cw.x1) + thick * 0.5,
        minZ: Math.min(cw.z0, cw.z1) - thick * 0.5,
        maxZ: Math.max(cw.z0, cw.z1) + thick * 0.5,
      });
    } else {
      const steps = Math.max(3, Math.ceil(len / 1.4));
      for (let s = 0; s <= steps; s++) {
        colliders.push({
          x: cw.x0 + (dx * s) / steps,
          z: cw.z0 + (dz * s) / steps,
          r: thick * 0.55,
        });
      }
    }
  }

  // 12d. Iconic Celestial Sky-Vine Pillars Connecting the 10 Realms (`env_sky_vine_pillar.glb`)!
  const skyPillarInteractables = [];
  for (const sp of zone.skyPillars || []) {
    const py = getHeightAt(sp.x, sp.z);
    const holder = new THREE.Group();
    holder.position.set(sp.x, py, sp.z);

    const pillarActor = modelBank.spawnActor({
      glbUrl: 'assets/models/env_sky_vine_pillar.glb',
      scale: 7.4,
      primaryColor: '#22c55e',
      secondaryColor: '#fde047',
      shadowRadius: 1.85,
      standInKind: 'prop',
    });
    holder.add(pillarActor.root);
    loadPromises.push(pillarActor.readyPromise);

    const warpRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.95, 0.14, 12, 32),
      new THREE.MeshStandardMaterial({
        color: '#4ade80',
        emissive: '#22c55e',
        emissiveIntensity: 1.15,
        roughness: 0.2,
      }),
    );
    warpRing.rotation.x = Math.PI / 2;
    warpRing.position.y = 0.35;
    holder.add(warpRing);

    const sign = makeLabelSprite({
      title: sp.label || 'SKY-VINE PILLAR',
      subtitle: 'Walk In or press [A] to Ascend!',
      badgeText: '🌿 SKY PILLAR',
      badgeColor: '#4ade80',
      widthWorld: 4.1,
    });
    sign.position.set(0, 3.85, 1.35);
    holder.add(sign);
    labelSprites.push(sign);

    markReflective(holder);
    group.add(holder);
    addSunbeam(sp.x, sp.z, 2.2, 13.5);
    animated.push((t) => {
      warpRing.rotation.z = t * 1.2;
      warpRing.scale.setScalar(1.0 + Math.sin(t * 3.4) * 0.06);
    });

    skyPillarInteractables.push({
      ...sp,
      y: py,
      holder,
    });
  }

  const batchStats = flushStaticBatches();
  const terrainProtected = new Set([water, cliffLower, shoreShelf, cliffBase, lawn, grassInst]);
  if (hillMesh) terrainProtected.add(hillMesh);
  {
    let inside = 0;
    let open = 0;
    for (let gz = -halfD; gz <= halfD; gz += 2) {
      for (let gx = -halfW; gx <= halfW; gx += 2) {
        if (!isInsideCoast(gx, gz, 1.0)) continue;
        inside++;
        if (openness(gx, gz) > 0.5) open++;
      }
    }
    console.info(
      `[Monkemon] terrain ${zone.id}: open ${(100 * open / Math.max(1, inside)).toFixed(0)}% of island, hills ${hillList.length}, massifs ${massifs.map((m) => `(${m.x.toFixed(1)},${m.z.toFixed(1)})`).join(' ') || 'none'}, forest trees ${forest ? forest.count : 0}, features ${flatCircles.length}c/${flatSegments.length}s, batched ${batchStats.sourceMeshes} meshes -> ${batchStats.merged} draws`,
    );
  }
  const hiddenByBattle = [];
  let _lastT = 0;
  return {
    isInterior: false,
    group,
    colliders,
    boxColliders,
    coastOutline,
    terraces,
    waterChannels,
    bridges,
    piers,
    roads,
    mountainWalls,
    cityWalls,
    skyPillarInteractables,
    tallGrassPatches: patches,
    hills: hillList,
    massifs,
    openness,
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
      if (forest) forest.setClearance(cx, cz, clearRadius * 0.92);
    },
    clearBattleClearance() {
      while (hiddenByBattle.length > 0) {
        const obj = hiddenByBattle.pop();
        obj.visible = true;
      }
      if (forest) forest.clearClearance();
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
