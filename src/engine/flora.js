// Procedural Complex Trees & Forest Instancing for Monkemon 2.5D
// - `buildBroadleafTree`: recursive tapered-tube trunk + 3-level branch system, full canopy of hundreds of
//   crossed alpha-tested leaf cards whose normals point away from the crown centre (soft, volumetric shading)
// - `buildConiferTree`: leaning trunk, 5–7 noise-eroded needle tiers, drooping branch cards, optional snow caps
// - `buildDeadTree`: gnarled charred branch system (volcanic groves)
// - `makeLeafClusterTexture` / `makeBarkTexture`: canvas-painted leaf-cluster alpha atlases & bark grain
// - `TreeForest`: packs every tree of a biome into a handful of `InstancedMesh` draw calls (one per variant/part)
//   with per-tree tint, and supports zero-scale hiding for battle clearance.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REFLECTION_LAYER } from './reflection.js';

const _texCache = new Map();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------------------------

const LEAF_PALETTES = {
  broad: { base: [46, 125, 50], light: [122, 196, 72], dark: [22, 78, 34], vein: [160, 214, 120] },
  tropical: { base: [34, 139, 64], light: [110, 205, 96], dark: [18, 86, 44], vein: [190, 230, 150] },
  autumn: { base: [214, 120, 32], light: [244, 184, 60], dark: [150, 62, 22], vein: [250, 220, 140] },
  birch: { base: [120, 180, 60], light: [200, 230, 110], dark: [70, 120, 40], vein: [220, 240, 170] },
  frost: { base: [86, 140, 120], light: [190, 225, 220], dark: [40, 90, 80], vein: [230, 245, 245] },
};

function rgba(c, a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Leaf-cluster alpha atlas: overlapping pointed leaves with midribs on a transparent background. */
export function makeLeafClusterTexture(kind = 'broad') {
  const key = `leaf:${kind}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const pal = LEAF_PALETTES[kind] || LEAF_PALETTES.broad;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const leafCount = kind === 'tropical' ? 5 : 9;
  for (let i = 0; i < leafCount; i++) {
    const t = i / leafCount;
    const ang = t * Math.PI * 2 + hash1(i * 3.1) * 0.9;
    const dist = (kind === 'tropical' ? 30 : 42) + hash1(i * 7.7) * 34;
    const cx = size / 2 + Math.cos(ang) * dist;
    const cy = size / 2 + Math.sin(ang) * dist;
    const len = (kind === 'tropical' ? 92 : 60) + hash1(i * 1.3) * 28;
    const wid = (kind === 'tropical' ? 44 : 30) + hash1(i * 2.9) * 14;
    const rot = ang + Math.PI * 0.5 + (hash1(i * 5.3) - 0.5) * 0.8;
    const shade = hash1(i * 9.1);
    const col = mixRgb(mixRgb(pal.dark, pal.base, Math.min(1, shade * 1.4)), pal.light, Math.max(0, shade - 0.55) * 2.0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, -len * 0.5, 0, len * 0.5);
    g.addColorStop(0, rgba(mixRgb(col, pal.light, 0.35)));
    g.addColorStop(1, rgba(mixRgb(col, pal.dark, 0.3)));
    ctx.fillStyle = g;
    ctx.beginPath();
    // Pointed leaf: two quadratic curves meeting at the tip and the stem
    ctx.moveTo(0, -len * 0.5);
    ctx.quadraticCurveTo(wid * 0.75, -len * 0.1, 0, len * 0.5);
    ctx.quadraticCurveTo(-wid * 0.75, -len * 0.1, 0, -len * 0.5);
    ctx.closePath();
    ctx.fill();
    // Midrib + side veins
    ctx.strokeStyle = rgba(pal.vein, 0.55);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.46);
    ctx.lineTo(0, len * 0.44);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    for (let v = 0; v < 4; v++) {
      const vy = -len * 0.3 + v * len * 0.17;
      ctx.beginPath();
      ctx.moveTo(0, vy);
      ctx.lineTo(wid * 0.42, vy + len * 0.08);
      ctx.moveTo(0, vy);
      ctx.lineTo(-wid * 0.42, vy + len * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _texCache.set(key, tex);
  return tex;
}

/** Tileable conifer needle texture (dense dark-green strokes with lighter tips). */
export function makeNeedleTexture(frosted = false) {
  const key = `needle:${frosted ? 1 : 0}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = frosted ? '#1f4d3a' : '#15482a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = hash1(i * 1.7) * size;
    const y = hash1(i * 2.3) * size;
    const l = 8 + hash1(i * 3.9) * 14;
    const a = -0.9 + (hash1(i * 4.1) - 0.5) * 0.8;
    const bright = hash1(i * 5.7);
    const col = frosted
      ? `rgba(${120 + bright * 110},${170 + bright * 70},${150 + bright * 60},0.9)`
      : `rgba(${30 + bright * 60},${110 + bright * 90},${40 + bright * 40},0.9)`;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2 + bright;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _texCache.set(key, tex);
  return tex;
}

/** Tileable bark albedo: vertical grain streaks, knots and crevices. */
export function makeBarkTexture(variant = 'oak') {
  const key = `bark:${variant}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const base = variant === 'charred' ? [36, 28, 26] : variant === 'birch' ? [214, 208, 196] : [94, 66, 44];
  ctx.fillStyle = rgba(base);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 520; i++) {
    const x = hash1(i * 1.1) * size;
    const y = hash1(i * 2.7) * size;
    const l = 20 + hash1(i * 3.3) * 70;
    const w = 1 + hash1(i * 4.9) * 3;
    const d = hash1(i * 6.1);
    const col = variant === 'charred'
      ? `rgba(${10 + d * 30},${8 + d * 18},${8 + d * 14},0.85)`
      : variant === 'birch'
        ? `rgba(${40 + d * 60},${36 + d * 50},${30 + d * 40},${0.5 + d * 0.4})`
        : `rgba(${50 + d * 70},${32 + d * 48},${18 + d * 30},0.8)`;
    ctx.fillStyle = col;
    for (const oy of [0, size, -size]) {
      ctx.fillRect(x, y + oy, w, l);
    }
  }
  if (variant === 'birch') {
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(30,26,24,0.85)';
      const x = hash1(i * 7.3) * size;
      const y = hash1(i * 8.9) * size;
      ctx.fillRect(x, y, 22 + hash1(i) * 40, 3 + hash1(i * 2) * 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Tapered open tube from p0 to p1 (radii r0 at p0, r1 at p1) with bark UVs scaled by length. */
function tubeSegment(p0, p1, r0, r1, radial = 7) {
  const dir = _v0.subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 0.6));
  _q.setFromUnitVectors(_up, dir.clone().normalize());
  _m.makeRotationFromQuaternion(_q);
  geo.applyMatrix4(_m);
  geo.translate((p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5);
  return geo;
}

/**
 * Recursive branch system. Returns merged trunk geometry and the branch tips (for leaf clusters).
 */
function buildBranchSystem(rand, {
  height = 2.0,
  baseRadius = 0.17,
  lean = 0.08,
  primaries = 4,
  startFrac = 0.55,
  branchLen = 1.3,
  spread = 0.72,
  levels = 3,
  gnarl = 0.25,
} = {}) {
  const parts = [];
  const tips = [];
  const trunkSegs = 3;
  let p = new THREE.Vector3(0, 0, 0);
  let d = new THREE.Vector3((rand() - 0.5) * lean, 1, (rand() - 0.5) * lean).normalize();
  const trunkPts = [p.clone()];
  for (let s = 0; s < trunkSegs; s++) {
    const segLen = height / trunkSegs;
    const np = p.clone().addScaledVector(d, segLen);
    const r0 = baseRadius * (1 - (s / trunkSegs) * 0.55);
    const r1 = baseRadius * (1 - ((s + 1) / trunkSegs) * 0.55);
    const g = tubeSegment(p, np, r0, r1, 8);
    if (g) parts.push(g);
    p = np;
    d = new THREE.Vector3(d.x + (rand() - 0.5) * lean * 1.4, 1, d.z + (rand() - 0.5) * lean * 1.4).normalize();
    trunkPts.push(p.clone());
  }
  const trunkTop = p.clone();
  const trunkTopR = baseRadius * 0.45;

  const grow = (origin, dir, len, radius, level, azimuth) => {
    const segs = 2;
    let o = origin.clone();
    let dd = dir.clone();
    for (let s = 0; s < segs; s++) {
      const segLen = len / segs;
      const no = o.clone().addScaledVector(dd, segLen);
      const r0 = radius * (1 - (s / segs) * 0.45);
      const r1 = radius * (1 - ((s + 1) / segs) * 0.45);
      const g = tubeSegment(o, no, r0, Math.max(0.012, r1), level === 1 ? 7 : 5);
      if (g) parts.push(g);
      o = no;
      // Gnarled drift + gravity sag + upward tip curl
      dd = new THREE.Vector3(
        dd.x + (rand() - 0.5) * gnarl,
        dd.y + 0.18 * (level >= 2 ? 1 : 0.4) + (rand() - 0.5) * gnarl * 0.5,
        dd.z + (rand() - 0.5) * gnarl,
      ).normalize();
    }
    tips.push({ pos: o.clone(), dir: dd.clone(), level });
    if (level < levels) {
      const children = level === 1 ? 2 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2);
      for (let cI = 0; cI < children; cI++) {
        const az = azimuth + (rand() - 0.5) * 2.2;
        const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const cd = dd.clone().multiplyScalar(0.55).addScaledVector(outward, 0.55).add(new THREE.Vector3(0, 0.25, 0)).normalize();
        grow(o, cd, len * (0.6 + rand() * 0.15), radius * 0.58, level + 1, az);
      }
    }
  };

  for (let b = 0; b < primaries; b++) {
    const frac = startFrac + (rand() * (1 - startFrac)) * 0.9;
    const idx = Math.min(trunkPts.length - 2, Math.floor(frac * trunkSegs));
    const t = frac * trunkSegs - idx;
    const origin = trunkPts[idx].clone().lerp(trunkPts[idx + 1], t);
    const az = (b / primaries) * Math.PI * 2 + rand() * 0.9;
    const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const dir = outward.multiplyScalar(spread).add(new THREE.Vector3(0, 1 - spread * 0.6, 0)).normalize();
    grow(origin, dir, branchLen * (0.8 + rand() * 0.4), trunkTopR * (1.05 - frac * 0.3), 1, az);
  }
  // Leader tip
  tips.push({ pos: trunkTop.clone(), dir: d.clone(), level: 0 });

  const trunk = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return { trunk, tips, trunkTop };
}

/**
 * Leaf-card canopy: `count` crossed card pairs sampled in an ellipsoid shell around `center`
 * plus clusters at each branch tip. Normals point away from the crown centre; vertex colours add tonal depth.
 */
function buildLeafCards(rand, { center, radii, count, tips, cardSize = 0.8, tipCards = 3, colorJitter = 0.18, droop = 0.0 }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vBase = 0;
  const addCard = (c, size, nrm, shade) => {
    // Two crossed quads at a random orientation
    const yaw = rand() * Math.PI * 2;
    const tilt = (rand() - 0.5) * 1.2 + droop;
    for (let k = 0; k < 2; k++) {
      const a = yaw + k * Math.PI * 0.5;
      const u = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const v = new THREE.Vector3(-Math.sin(a) * Math.sin(tilt), Math.cos(tilt), Math.cos(a) * Math.sin(tilt));
      const flipU = rand() < 0.5 ? -1 : 1;
      const corners = [
        c.clone().addScaledVector(u, -size).addScaledVector(v, -size * 0.7),
        c.clone().addScaledVector(u, size).addScaledVector(v, -size * 0.7),
        c.clone().addScaledVector(u, size).addScaledVector(v, size * 0.7),
        c.clone().addScaledVector(u, -size).addScaledVector(v, size * 0.7),
      ];
      const uvSet = flipU > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]];
      for (let i = 0; i < 4; i++) {
        positions.push(corners[i].x, corners[i].y, corners[i].z);
        normals.push(nrm.x, nrm.y, nrm.z);
        uvs.push(uvSet[i][0], uvSet[i][1]);
        colors.push(shade[0], shade[1], shade[2]);
      }
      indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      vBase += 4;
    }
  };
  const shadeFor = (c) => {
    // Brighter on top/outside, darker deep inside the crown
    const rel = _v1.subVectors(c, center);
    const depth = Math.min(1, Math.hypot(rel.x / radii.x, rel.y / radii.y, rel.z / radii.z));
    const top = THREE.MathUtils.clamp(rel.y / radii.y * 0.5 + 0.5, 0, 1);
    const base = 0.62 + depth * 0.3 + top * 0.18 + (rand() - 0.5) * colorJitter;
    return [base, base * (1.0 + (rand() - 0.5) * 0.08), base * (0.92 + (rand() - 0.5) * 0.1)];
  };
  for (let i = 0; i < count; i++) {
    // Bias samples towards the outer shell so the silhouette is full and the inside stays airy
    const r = 0.5 + 0.5 * Math.sqrt(rand());
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    const c = new THREE.Vector3(
      center.x + radii.x * r * Math.sin(ph) * Math.cos(th),
      center.y + radii.y * r * Math.cos(ph),
      center.z + radii.z * r * Math.sin(ph) * Math.sin(th),
    );
    const nrm = c.clone().sub(center).normalize().lerp(_up, 0.25).normalize();
    addCard(c, cardSize * (0.8 + rand() * 0.4), nrm, shadeFor(c));
  }
  for (const tip of tips) {
    for (let k = 0; k < tipCards; k++) {
      const c = tip.pos.clone().addScaledVector(tip.dir, k * cardSize * 0.35).add(
        new THREE.Vector3((rand() - 0.5) * cardSize, (rand() - 0.3) * cardSize * 0.6, (rand() - 0.5) * cardSize),
      );
      const nrm = c.clone().sub(center).normalize().lerp(_up, 0.3).normalize();
      addCard(c, cardSize * (0.7 + rand() * 0.35), nrm, shadeFor(c));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Tree builders
// ---------------------------------------------------------------------------------------------

export function buildBroadleafTree(rand, { height = 3.8, crownRadius = 1.7, leafCards = 140, tall = false } = {}) {
  const trunkH = tall ? height * 0.58 : height * 0.5;
  const { trunk, tips, trunkTop } = buildBranchSystem(rand, {
    height: trunkH,
    baseRadius: 0.16 + height * 0.012,
    lean: 0.12,
    primaries: 4 + Math.floor(rand() * 2),
    startFrac: tall ? 0.7 : 0.5,
    branchLen: crownRadius * 0.95,
    spread: tall ? 0.6 : 0.74,
    levels: 3,
    gnarl: 0.3,
  });
  const center = new THREE.Vector3(trunkTop.x, trunkTop.y + crownRadius * 0.62, trunkTop.z);
  const leaves = buildLeafCards(rand, {
    center,
    radii: new THREE.Vector3(crownRadius, crownRadius * (tall ? 1.05 : 0.82), crownRadius),
    count: leafCards,
    tips,
    cardSize: crownRadius * 0.42,
    tipCards: 2,
  });
  return { trunk, leaves, radius: crownRadius, height: center.y + crownRadius * 0.85 };
}

export function buildConiferTree(rand, { height = 4.2, baseRadius = 1.35, tiers = 6, snow = false, frosted = false } = {}) {
  const parts = [];
  const caps = [];
  const trunkTopY = height * 0.98;
  const lean = (rand() - 0.5) * 0.08;
  const p0 = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(lean * height * 0.5, height * 0.55, 0);
  const p2 = new THREE.Vector3(lean * height, trunkTopY, 0);
  const tr = 0.12 + height * 0.012;
  const t1 = tubeSegment(p0, p1, tr, tr * 0.6, 8);
  const t2 = tubeSegment(p1, p2, tr * 0.6, 0.03, 7);
  const trunk = mergeGeometries([t1, t2], false);
  t1.dispose();
  t2.dispose();

  const tierGeos = [];
  const y0 = height * 0.26;
  const y1 = height * 0.96;
  for (let i = 0; i < tiers; i++) {
    const t = i / Math.max(1, tiers - 1);
    const y = y0 + (y1 - y0) * t;
    const r = baseRadius * Math.pow(1 - t, 0.85) + 0.14;
    const h = (y1 - y0) / tiers * 1.55 + 0.25;
    const cone = new THREE.ConeGeometry(r, h, 9, 2, true);
    const pos = cone.attributes.position;
    const seed = rand() * 40;
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vz = pos.getZ(v);
      const rr = Math.hypot(vx, vz);
      if (rr < 1e-4) continue;
      const ang = Math.atan2(vz, vx);
      const jitter = 1 + (hash1(Math.floor(ang * 3.2) + seed) - 0.5) * 0.28 + Math.sin(ang * 7 + seed) * 0.05;
      pos.setX(v, (vx / rr) * rr * jitter);
      pos.setZ(v, (vz / rr) * rr * jitter);
      // Droop the rim
      pos.setY(v, pos.getY(v) - (rr / Math.max(r, 0.01)) * 0.12);
    }
    pos.needsUpdate = true;
    const uv = cone.attributes.uv;
    for (let v = 0; v < uv.count; v++) uv.setXY(v, uv.getX(v) * 4.0, uv.getY(v) * 1.6);
    cone.computeVertexNormals();
    cone.translate(lean * y, y, 0);
    tierGeos.push(cone);
    if (snow) {
      const cap = new THREE.ConeGeometry(r * 0.9, h * 0.42, 9, 1, false);
      cap.translate(lean * y, y + h * 0.3, 0);
      caps.push(cap);
    }
  }
  // Tip spire
  const spire = new THREE.ConeGeometry(0.16, 0.5, 7, 1, true);
  spire.translate(lean * height, trunkTopY + 0.1, 0);
  const uvS = spire.attributes.uv;
  for (let v = 0; v < uvS.count; v++) uvS.setXY(v, uvS.getX(v) * 2.0, uvS.getY(v));
  tierGeos.push(spire);
  const needles = mergeGeometries(tierGeos, false);
  for (const g of tierGeos) g.dispose();
  // vertex colours: darker lower tiers
  const cnt = needles.attributes.position.count;
  const cols = new Float32Array(cnt * 3);
  for (let v = 0; v < cnt; v++) {
    const yy = needles.attributes.position.getY(v);
    const s = 0.72 + 0.4 * THREE.MathUtils.clamp(yy / height, 0, 1);
    cols[v * 3] = s;
    cols[v * 3 + 1] = s;
    cols[v * 3 + 2] = s;
  }
  needles.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  let capGeo = null;
  if (caps.length) {
    capGeo = mergeGeometries(caps, false);
    for (const g of caps) g.dispose();
  }
  void parts;
  void frosted;
  return { trunk, leaves: needles, caps: capGeo, radius: baseRadius, height };
}

export function buildDeadTree(rand, { height = 3.4 } = {}) {
  const { trunk, trunkTop } = buildBranchSystem(rand, {
    height: height * 0.62,
    baseRadius: 0.17,
    lean: 0.22,
    primaries: 4,
    startFrac: 0.45,
    branchLen: height * 0.42,
    spread: 0.82,
    levels: 3,
    gnarl: 0.55,
  });
  return { trunk, leaves: null, radius: height * 0.35, height: trunkTop.y + height * 0.4 };
}

/**
 * Biome tree variant sets. `density` (0..1+) scales leaf-card counts for the low tier.
 */
const _variantCache = new Map();
export function createTreeVariants(theme, rand, { density = 1.0 } = {}) {
  const cacheKey = `${theme}:${density.toFixed(2)}`;
  if (_variantCache.has(cacheKey)) return _variantCache.get(cacheKey);
  const variants = buildTreeVariants(theme, rand, density);
  _variantCache.set(cacheKey, variants);
  return variants;
}

function buildTreeVariants(theme, rand, density) {
  const cards = (n) => Math.max(40, Math.round(n * density));
  const variants = [];
  const push = (kind, built, tint) => variants.push({ kind, ...built, tint });
  if (theme === 'forest') {
    push('broad', buildBroadleafTree(rand, { height: 4.4, crownRadius: 1.9, leafCards: cards(170) }), '#ffffff');
    push('broad', buildBroadleafTree(rand, { height: 3.6, crownRadius: 1.5, leafCards: cards(130) }), '#eaffd6');
    push('broad', buildBroadleafTree(rand, { height: 5.0, crownRadius: 1.7, leafCards: cards(150), tall: true }), '#ffffff');
    push('autumn', buildBroadleafTree(rand, { height: 4.0, crownRadius: 1.6, leafCards: cards(140) }), '#ffffff');
    push('conifer', buildConiferTree(rand, { height: 5.2, baseRadius: 1.45, tiers: 7 }), '#ffffff');
    push('conifer', buildConiferTree(rand, { height: 4.2, baseRadius: 1.2, tiers: 6 }), '#dcfce7');
  } else if (theme === 'snow') {
    push('conifer', buildConiferTree(rand, { height: 5.4, baseRadius: 1.5, tiers: 7, snow: true }), '#ffffff');
    push('conifer', buildConiferTree(rand, { height: 4.4, baseRadius: 1.25, tiers: 6, snow: true }), '#f1f5f9');
    push('conifer', buildConiferTree(rand, { height: 3.6, baseRadius: 1.05, tiers: 5, snow: true }), '#ffffff');
    push('frost', buildBroadleafTree(rand, { height: 3.6, crownRadius: 1.35, leafCards: cards(90) }), '#ffffff');
  } else if (theme === 'volcano') {
    push('dead', buildDeadTree(rand, { height: 3.6 }), '#ffffff');
    push('dead', buildDeadTree(rand, { height: 2.9 }), '#d6d3d1');
    push('dead', buildDeadTree(rand, { height: 4.2 }), '#ffffff');
  } else {
    // tropical / harbor / default: lush broadleaf mix with one tall emergent
    push('tropical', buildBroadleafTree(rand, { height: 4.2, crownRadius: 1.85, leafCards: cards(160) }), '#ffffff');
    push('broad', buildBroadleafTree(rand, { height: 3.5, crownRadius: 1.45, leafCards: cards(125) }), '#f0ffe0');
    push('tropical', buildBroadleafTree(rand, { height: 5.2, crownRadius: 1.75, leafCards: cards(150), tall: true }), '#ffffff');
    push('broad', buildBroadleafTree(rand, { height: 3.9, crownRadius: 1.65, leafCards: cards(140) }), '#e6f7c8');
  }
  return variants;
}

// ---------------------------------------------------------------------------------------------
// Forest instancer
// ---------------------------------------------------------------------------------------------

export class TreeForest {
  /**
   * @param variants from `createTreeVariants`
   * @param materials `{ bark, leaves: { broad, tropical, autumn, frost, conifer }, caps, deadBark }`
   */
  constructor(variants, materials, { castShadows = true } = {}) {
    this.variants = variants;
    this.materials = materials;
    this.castShadows = castShadows;
    this.group = new THREE.Group();
    this.group.name = 'MonkeForest';
    this.records = variants.map(() => []); // [{ x, y, z, yaw, scale, tint }]
    this.meshes = []; // { mesh, variantIdx }
    this.hidden = [];
    this.trees = []; // flattened { variantIdx, slot, x, z, r }
    this._dummy = new THREE.Object3D();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  add(variantIdx, x, y, z, yaw = 0, scale = 1, tint = null) {
    const v = this.variants[variantIdx % this.variants.length];
    const slot = this.records[variantIdx % this.variants.length].length;
    this.records[variantIdx % this.variants.length].push({ x, y, z, yaw, scale, tint: tint || v.tint || '#ffffff' });
    this.trees.push({ variantIdx: variantIdx % this.variants.length, slot, x, z, r: v.radius * scale });
    return slot;
  }

  get count() {
    return this.trees.length;
  }

  finalize() {
    const col = new THREE.Color();
    this.variants.forEach((v, vi) => {
      const recs = this.records[vi];
      if (!recs.length) return;
      const parts = [];
      if (v.trunk) parts.push({ geo: v.trunk, mat: v.kind === 'dead' ? this.materials.deadBark : this.materials.bark, shadow: true });
      if (v.leaves) {
        const leafMat = v.kind === 'conifer' ? this.materials.leaves.conifer : this.materials.leaves[v.kind] || this.materials.leaves.broad;
        parts.push({ geo: v.leaves, mat: leafMat, shadow: true });
      }
      if (v.caps && this.materials.caps) parts.push({ geo: v.caps, mat: this.materials.caps, shadow: false });
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, recs.length);
        inst.castShadow = this.castShadows && part.shadow;
        inst.receiveShadow = false;
        inst.frustumCulled = true;
        recs.forEach((r, i) => {
          this._dummy.position.set(r.x, r.y, r.z);
          this._dummy.rotation.set(0, r.yaw, 0);
          this._dummy.scale.setScalar(r.scale);
          this._dummy.updateMatrix();
          inst.setMatrixAt(i, this._dummy.matrix);
          inst.setColorAt(i, col.set(r.tint));
        });
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.layers.enable(REFLECTION_LAYER);
        inst.userData.keepInBattle = true;
        this.group.add(inst);
        this.meshes.push({ mesh: inst, variantIdx: vi });
      }
    });
    return this.group;
  }

  /** Zero-scales every tree within `radius` of (cx, cz) – used for battle clearance. */
  setClearance(cx, cz, radius) {
    this.clearClearance();
    for (const t of this.trees) {
      if (Math.hypot(t.x - cx, t.z - cz) >= radius + t.r) continue;
      for (const m of this.meshes) {
        if (m.variantIdx !== t.variantIdx) continue;
        const saved = new THREE.Matrix4();
        m.mesh.getMatrixAt(t.slot, saved);
        m.mesh.setMatrixAt(t.slot, this._zero);
        m.mesh.instanceMatrix.needsUpdate = true;
        this.hidden.push({ mesh: m.mesh, slot: t.slot, saved });
      }
    }
  }

  clearClearance() {
    for (const h of this.hidden) {
      h.mesh.setMatrixAt(h.slot, h.saved);
      h.mesh.instanceMatrix.needsUpdate = true;
    }
    this.hidden.length = 0;
  }
}
