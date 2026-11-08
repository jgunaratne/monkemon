// 2.5D Tactile Miniature Toy-Diorama Zone Builder
// Constructs each of the 5 interconnected islands with procedural toy-craft textures,
// beveled cliffs, scrolling caustic water/magma, rounded cobblestone & sand roads,
// miniature perimeter picket fences, plaza Monkeball mosaic, warm streetlamps,
// `InstancedMesh` swaying grass & wildflowers, sculpted biome trees/buoys/braziers,
// drifting 3D biome particles, Berry Trees, Banana Shrines, Gateways & Spec Houses!

import * as THREE from 'three';
import { makeLabelSprite } from './model_loader.js';

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
    return s / 0xffffffff;
  };
}

const _texCache = new Map();

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

function makeLawnTexture(baseHex, theme, rx, rz) {
  const key = `lawn:${baseHex}:${theme}:${rx}:${rz}`;
  if (_texCache.has(key)) return _texCache.get(key);

  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(baseHex);
  const light = col.clone().offsetHSL(0.01, 0.04, 0.06);
  const dark = col.clone().offsetHSL(-0.01, 0.03, -0.06);

  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle toy-board checkerboard tiles (Link-diorama tabletop feel)
  ctx.fillStyle = `#${light.getHexString()}`;
  ctx.globalAlpha = 0.34;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if ((x + y) % 2 === 0) {
        ctx.beginPath();
        ctx.roundRect(x * 64 + 3, y * 64 + 3, 58, 58, 12);
        ctx.fill();
      }
    }
  }

  // Organic dappled clover / snow / basalt / plank details
  const r = seededRand(theme.length * 7919 + 42);
  ctx.globalAlpha = 0.42;
  for (let i = 0; i < 65; i++) {
    const px = r() * 256;
    const py = r() * 256;
    const rad = 4 + r() * 11;
    ctx.fillStyle = i % 2 === 0 ? `#${light.getHexString()}` : `#${dark.getHexString()}`;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  if (theme === 'harbor') {
    // Clean harbor stone-tile bevel lines
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    for (let k = 0; k <= 256; k += 64) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k, 256);
      ctx.moveTo(0, k);
      ctx.lineTo(256, k);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1.0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, rz);
  _texCache.set(key, tex);
  return tex;
}

function makePathTexture(baseHex, theme) {
  const key = `path:${baseHex}:${theme}`;
  if (_texCache.has(key)) return _texCache.get(key);

  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(baseHex);
  const stoneLight = col.clone().offsetHSL(0.0, 0.02, 0.08);
  const stoneWarm = col.clone().offsetHSL(0.02, 0.05, 0.03);
  const mortar = col.clone().offsetHSL(-0.01, -0.04, -0.11);

  ctx.fillStyle = `#${mortar.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  const r = seededRand(9001 + theme.charCodeAt(0));
  const rows = 4;
  const cols = 4;
  const cw = 256 / cols;
  const ch = 256 / rows;
  for (let ry = 0; ry < rows; ry++) {
    const xShift = (ry % 2) * (cw * 0.5);
    for (let cx = -1; cx <= cols; cx++) {
      const sx = cx * cw + xShift + 4;
      const sy = ry * ch + 4;
      ctx.fillStyle = r() > 0.5 ? `#${stoneLight.getHexString()}` : `#${stoneWarm.getHexString()}`;
      ctx.beginPath();
      ctx.roundRect(sx, sy, cw - 8, ch - 8, 16);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _texCache.set(key, tex);
  return tex;
}

function makeWaterTexture(baseHex, theme) {
  // Dedicated non-shared instance so `offset` animation per active zone is smooth
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(baseHex);
  const foamCol =
    theme === 'volcano'
      ? new THREE.Color('#fde047')
      : col.clone().offsetHSL(-0.02, 0.05, 0.24);
  const deepCol = col.clone().offsetHSL(0.01, 0.04, -0.08);

  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  const r = seededRand(5150 + theme.charCodeAt(0));
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `#${deepCol.getHexString()}`;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, 18 + r() * 28, 10 + r() * 14, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stylized glistening caustic rings
  ctx.globalAlpha = theme === 'volcano' ? 0.52 : 0.38;
  ctx.strokeStyle = `#${foamCol.getHexString()}`;
  ctx.lineWidth = 3.5;
  for (let i = 0; i < 22; i++) {
    const wx = r() * 256;
    const wy = r() * 256;
    const rx = 10 + r() * 22;
    const ry = 6 + r() * 12;
    ctx.beginPath();
    ctx.ellipse(wx, wy, rx, ry, (r() - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return tex;
}

export function buildZoneDiorama(zone, modelBank) {
  const group = new THREE.Group();
  const colliders = []; // { x, z, r } circular obstacles for smooth 2.5D sliding collision
  const animated = [];  // (timeSec) => void
  const loadPromises = [];

  const { halfW, halfD } = zone.bounds;
  const rand = seededRand((zone.index || 1) * 98765 + 1337);
  const theme = zone.theme || 'tropical';

  // Helper to check if a decorative prop would sit on top of a path, plaza, house, trainer, or gateway
  const isClearSpot = (x, z, minClear = 3.0) => {
    if (Math.hypot(x, z - 2.0) < 5.6) return false;
    if (Math.hypot(x - zone.playerSpawn.x, z - zone.playerSpawn.z) < 3.5) return false;
    for (const h of zone.houses || []) {
      if (Math.hypot(x - h.x, z - h.z) < (h.scale || 4.4) * 0.72 + minClear * 0.5) return false;
      if (Math.hypot(x - h.x, z - (h.z + 2.8)) < 3.2) return false;
    }
    for (const gw of zone.gateways || []) {
      if (Math.hypot(x - gw.x, z - gw.z) < 4.8) return false;
    }
    for (const tr of zone.trainers || []) {
      if (Math.hypot(x - tr.x, z - tr.z) < 3.0) return false;
    }
    for (const sh of zone.shrines || []) {
      if (Math.hypot(x - sh.x, z - sh.z) < 3.0) return false;
    }
    for (const bt of zone.berryTrees || []) {
      if (Math.hypot(x - bt.x, z - bt.z) < 2.6) return false;
    }
    return true;
  };

  // 1. Glistening outer sea / hot-spring / magma plane with scrolling toy caustics
  const waterTex = makeWaterTexture(zone.waterColor || '#1fb6e8', theme);
  const waterGeo = new THREE.PlaneGeometry(210, 210, 28, 28);
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterTex,
    color: '#ffffff',
    emissive: theme === 'volcano' ? '#ea580c' : '#0284c7',
    emissiveIntensity: theme === 'volcano' ? 0.32 : 0.08,
    roughness: theme === 'volcano' ? 0.32 : 0.14,
    metalness: theme === 'volcano' ? 0.08 : 0.18,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.85;
  group.add(water);

  // Double-ringed shoreline foam skirt around the miniature island
  const outerFoam = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 5.6, 0.24, halfD * 2 + 5.6),
    new THREE.MeshStandardMaterial({
      color: theme === 'volcano' ? '#fdba74' : '#bae6fd',
      transparent: true,
      opacity: 0.55,
      roughness: 0.45,
    }),
  );
  outerFoam.position.y = -0.82;
  group.add(outerFoam);

  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 4.1, 0.3, halfD * 2 + 4.1),
    new THREE.MeshStandardMaterial({
      color: theme === 'volcano' ? '#fb923c' : '#f0f9ff',
      roughness: 0.42,
    }),
  );
  foam.position.y = -0.77;
  group.add(foam);

  // 2. Multi-tiered beveled miniature tabletop cliff & textured grass top
  const cliffDark = new THREE.Color(zone.cliffColor || '#c98850').offsetHSL(0, 0.02, -0.08);
  const cliffLower = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2.8, 0.9, halfD * 2 + 2.8),
    new THREE.MeshStandardMaterial({ color: cliffDark, roughness: 0.76 }),
  );
  cliffLower.position.y = -0.95;
  group.add(cliffLower);

  const cliffBase = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2.0, 1.15, halfD * 2 + 2.0),
    new THREE.MeshStandardMaterial({ color: zone.cliffColor || '#c98850', roughness: 0.68 }),
  );
  cliffBase.position.y = -0.68;
  cliffBase.receiveShadow = true;
  group.add(cliffBase);

  const lawnTex = makeLawnTexture(
    zone.groundColor || '#67c956',
    theme,
    Math.round(halfW * 0.55),
    Math.round(halfD * 0.55),
  );
  const lawn = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 0.8, 0.44, halfD * 2 + 0.8),
    new THREE.MeshStandardMaterial({
      map: lawnTex,
      color: '#ffffff',
      roughness: 0.62,
    }),
  );
  lawn.position.y = -0.22;
  lawn.receiveShadow = true;
  group.add(lawn);

  // 3. Textured Cobblestone/Sand Toy Paths & Central Monkeball Mosaic Plaza
  const basePathTex = makePathTexture(zone.pathColor || '#f3d89c', theme);
  const addPathSegment = (x0, z0, x1, z1, width = 2.65) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const segTex = basePathTex.clone();
    segTex.needsUpdate = true;
    segTex.repeat.set(1, Math.max(1, Math.round(len / 2.8)));
    const segMat = new THREE.MeshStandardMaterial({
      map: segTex,
      color: '#ffffff',
      roughness: 0.72,
    });
    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, len + width * 0.45), segMat);
    seg.position.set((x0 + x1) * 0.5, 0.016, (z0 + z1) * 0.5);
    seg.rotation.y = Math.atan2(dx, dz);
    seg.receiveShadow = true;
    group.add(seg);
  };

  // Central town plaza with inlaid golden Monkeball medallion
  const plazaTex = basePathTex.clone();
  plazaTex.needsUpdate = true;
  plazaTex.repeat.set(3, 3);
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex, color: '#ffffff', roughness: 0.68 });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.05, 0.065, 36), plazaMat);
  plaza.position.set(0, 0.02, 2.0);
  plaza.receiveShadow = true;
  group.add(plaza);

  const plazaRim = new THREE.Mesh(
    new THREE.TorusGeometry(4.78, 0.14, 10, 48),
    new THREE.MeshStandardMaterial({ color: '#fde68a', roughness: 0.42, metalness: 0.12 }),
  );
  plazaRim.rotation.x = Math.PI / 2;
  plazaRim.position.set(0, 0.055, 2.0);
  group.add(plazaRim);

  const medallionOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 0.075, 28),
    new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.45 }),
  );
  medallionOuter.position.set(0, 0.025, 2.0);
  const medallionCenter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.085, 24),
    new THREE.MeshStandardMaterial({ color: '#fef9c3', roughness: 0.35 }),
  );
  medallionCenter.position.set(0, 0.03, 2.0);
  group.add(medallionOuter, medallionCenter);

  for (const h of zone.houses || []) {
    addPathSegment(0, 2.0, h.x, h.z + 2.4, 2.6);
  }
  for (const gw of zone.gateways || []) {
    addPathSegment(0, 2.0, gw.x * 0.93, gw.z * 0.93, 2.75);
  }

  // Warm Toy Streetlamps flanking the central plaza
  const addStreetLamp = (lx, lz) => {
    const lg = new THREE.Group();
    lg.position.set(lx, 0, lz);
    const poleMat = new THREE.MeshStandardMaterial({
      color: theme === 'snow' || theme === 'harbor' ? '#334155' : '#57361a',
      roughness: 0.45,
      metalness: 0.25,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.26, 12), poleMat);
    base.position.y = 0.13;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.35, 10), poleMat);
    pole.position.y = 1.3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.28, 12), poleMat);
    cap.position.y = 2.75;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 12),
      new THREE.MeshStandardMaterial({
        color: '#fef08a',
        emissive: '#f59e0b',
        emissiveIntensity: 0.85,
        roughness: 0.18,
      }),
    );
    bulb.position.y = 2.48;
    lg.add(base, pole, cap, bulb);
    group.add(lg);
    colliders.push({ x: lx, z: lz, r: 0.42 });
  };
  addStreetLamp(-4.9, 4.4);
  addStreetLamp(4.9, 4.4);

  // 3b. Miniature Perimeter Toy Picket Fences (auto-parted at every Gateway!)
  const fenceColor =
    theme === 'volcano'
      ? '#44403c'
      : theme === 'harbor'
        ? '#f8fafc'
        : theme === 'snow'
          ? '#e2e8f0'
          : '#fef3c7';
  const fenceAccent = theme === 'volcano' ? '#f97316' : '#b45309';
  const fenceMat = new THREE.MeshStandardMaterial({ color: fenceColor, roughness: 0.48 });
  const fenceCapMat = new THREE.MeshStandardMaterial({ color: fenceAccent, roughness: 0.52 });

  const nearAnyGateway = (x, z) =>
    (zone.gateways || []).some((gw) => Math.hypot(gw.x - x, gw.z - z) < 4.4);

  const addFenceSpan = (x0, z0, x1, z1) => {
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    if (nearAnyGateway(mx, mz) || nearAnyGateway(x0, z0) || nearAnyGateway(x1, z1)) return;
    const fg = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.22, 0.72, 0.22);
    const pA = new THREE.Mesh(postGeo, fenceMat);
    pA.position.set(x0, 0.36, z0);
    const capA = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), fenceCapMat);
    capA.position.set(x0, 0.76, z0);
    fg.add(pA, capA);

    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    for (const ry of [0.26, 0.52]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), fenceMat);
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

  // 4. Instanced Glossy Grass Tufts & Colorful Toy Wildflowers
  const grassCount = 240;
  const bladeGeo = new THREE.ConeGeometry(0.13, 0.52, 5);
  bladeGeo.translate(0, 0.26, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: theme === 'snow' ? '#bae6fd' : theme === 'volcano' ? '#fb923c' : '#34d399',
    roughness: 0.42,
  });
  const grassInst = new THREE.InstancedMesh(bladeGeo, bladeMat, grassCount);
  const dummy = new THREE.Object3D();
  let placedGrass = 0;
  for (let i = 0; i < grassCount * 2 && placedGrass < grassCount; i++) {
    const gx = (rand() * 2 - 1) * (halfW - 1.8);
    const gz = (rand() * 2 - 1) * (halfD - 1.8);
    if (Math.hypot(gx, gz - 2.0) < 5.0) continue;
    dummy.position.set(gx, 0, gz);
    dummy.rotation.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
    const s = 0.75 + rand() * 0.75;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass++, dummy.matrix);
  }
  grassInst.count = placedGrass;
  group.add(grassInst);

  // Glossy Toy Wildflower Blossoms / Snow-crystals / Ember-gems
  const flowerCount = 85;
  const flowerGeo = new THREE.CylinderGeometry(0.2, 0.08, 0.1, 6);
  flowerGeo.translate(0, 0.08, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.3 });
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
    const fx = (rand() * 2 - 1) * (halfW - 2.2);
    const fz = (rand() * 2 - 1) * (halfD - 2.2);
    if (!isClearSpot(fx, fz, 1.8)) continue;
    dummy.position.set(fx, 0.01, fz);
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

  // 5. Sculpted Multi-Part Biome Toy Trees & Shoreline Landmarks
  const addToyTree = (tx, tz) => {
    const tg = new THREE.Group();
    tg.position.set(tx, 0, tz);

    if (theme === 'tropical') {
      // Curved multi-segment Coconut Palm Tree with 5 arched fronds & golden coconuts!
      const barkMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.62 });
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
        tg.add(segMesh);
      }
      const topY = 2.65;
      const frondMat = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.34 });
      for (let f = 0; f < 5; f++) {
        const ang = (f / 5) * Math.PI * 2 + leanDir;
        const frond = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), frondMat);
        frond.scale.set(1.55, 0.22, 0.55);
        frond.position.set(px + Math.cos(ang) * 0.82, topY - 0.08, pz + Math.sin(ang) * 0.82);
        frond.rotation.y = -ang;
        frond.rotation.z = -0.38;
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
      // 3-Tier Snow-Frosted Alpine Pine Tree
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.34, 1.1, 10),
        new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.65 }),
      );
      trunk.position.y = 0.55;
      tg.add(trunk);
      const pineMat = new THREE.MeshStandardMaterial({ color: '#0f766e', roughness: 0.48 });
      const snowCapMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.32 });
      const tiers = [
        { r: 1.25, h: 1.25, y: 1.35 },
        { r: 0.98, h: 1.1, y: 2.15 },
        { r: 0.68, h: 0.95, y: 2.85 },
      ];
      for (const tier of tiers) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 12), pineMat);
        cone.position.y = tier.y;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(tier.r * 0.86, tier.h * 0.55, 12), snowCapMat);
        cap.position.y = tier.y + tier.h * 0.24;
        tg.add(cone, cap);
      }
    } else if (theme === 'volcano') {
      // Glowing Magma Crystal Cluster on Basalt Crag
      const base = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.82, 0),
        new THREE.MeshStandardMaterial({ color: '#292524', roughness: 0.72 }),
      );
      base.position.y = 0.36;
      const crystalMat = new THREE.MeshStandardMaterial({
        color: '#fb923c',
        emissive: '#ea580c',
        emissiveIntensity: 0.58,
        roughness: 0.18,
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
      // Nautical Bollard Post + Lifebuoy Ring + Brass Harbor Lantern
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.3, 2.0, 12),
        new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.58 }),
      );
      post.position.y = 1.0;
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
          emissiveIntensity: 0.65,
          roughness: 0.18,
        }),
      );
      lantern.position.y = 2.18;
      tg.add(post, buoy, lantern);
    } else {
      // Lush Golden-Grove Multi-Puff Canopy Tree (`canopy`)
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.38, 1.9, 10),
        new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.62 }),
      );
      trunk.position.y = 0.95;
      const leafGreen = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.36 });
      const leafGold = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.34 });
      const crown1 = new THREE.Mesh(new THREE.SphereGeometry(1.22, 16, 14), leafGreen);
      crown1.position.y = 2.25;
      crown1.scale.set(1.12, 0.88, 1.12);
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 12), leafGold);
      crown2.position.set(0.38, 2.95, -0.18);
      const crown3 = new THREE.Mesh(new THREE.SphereGeometry(0.76, 14, 12), leafGreen);
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
    if (!nearAnyGateway(bx, bz)) addToyTree(bx, bz);
  }

  // Biome Water/Shore Diorama Vignettes (Bobbing Rubber-Duck Buoys in Harbor, Steaming Rock Pools in Snow, Braziers in Volcano!)
  if (theme === 'harbor' || theme === 'tropical') {
    const buoySpots = [
      [-halfW - 4.2, 6.5],
      [halfW + 4.4, -7.0],
      [-11.0, halfD + 4.2],
      [12.5, -halfD - 4.2],
    ];
    buoySpots.forEach(([wx, wz], idx) => {
      const duck = new THREE.Group();
      duck.position.set(wx, -0.76, wz);
      const yellowMat = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.25 });
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
    // Champion Sanctum Flame Braziers framing Boss #20 King Monkezilla's arena!
    for (const [bx, bz] of [
      [7.2, -5.5],
      [15.8, -5.5],
      [7.2, -13.5],
      [15.8, -13.5],
    ]) {
      const br = new THREE.Group();
      br.position.set(bx, 0, bz);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.5, 1.5, 10),
        new THREE.MeshStandardMaterial({ color: '#1c1917', roughness: 0.65 }),
      );
      pillar.position.y = 0.75;
      const flame = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({
          color: '#fde047',
          emissive: '#f97316',
          emissiveIntensity: 1.1,
          roughness: 0.15,
        }),
      );
      flame.scale.set(0.85, 1.6, 0.85);
      flame.position.y = 1.85;
      br.add(pillar, flame);
      group.add(br);
      colliders.push({ x: bx, z: bz, r: 0.55 });
      animated.push((t) => {
        flame.scale.y = 1.45 + Math.sin(t * 7.5 + bx) * 0.25;
        flame.rotation.y = t * 1.8;
      });
    }
  }

  // 5b. Ambient Drifting 3D Biome Particles (`THREE.Points` — petals, bubbles, snowflakes, embers)
  const pCount = 84;
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
    size: theme === 'snow' ? 0.34 : 0.3,
    transparent: true,
    opacity: theme === 'snow' ? 0.88 : 0.76,
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

  // 6. All Spec Houses (`alex_house.glb`, `peanut_butter_house.glb`, `fish_house.glb`, `pork_house.glb`, `beef_house.glb`, etc.)
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

    // Welcoming golden doorstep mat + warm beacon ring
    const doorZ = h.z + (h.scale || 4.4) * 0.48;
    const matRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.06, 24),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.38,
        roughness: 0.32,
      }),
    );
    matRing.position.set(h.x, 0.03, doorZ);
    group.add(matRing);

    const sign = makeLabelSprite({
      title: h.label,
      subtitle: h.sublabel || '',
      badgeText: '🏠 HOUSE',
      badgeColor: '#fbbf24',
      widthWorld: 3.8,
    });
    sign.position.set(h.x, (h.scale || 4.4) * 0.68 + 0.62, h.z);
    group.add(sign);

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
      new THREE.MeshBasicMaterial({ color: '#fde047', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(sh.x, 0.04, sh.z);
    group.add(halo);

    const lbl = makeLabelSprite({
      title: 'BANANA SHRINE',
      subtitle: '[A] Blessing (+ATK / Heal)',
      badgeText: '✨',
      badgeColor: '#facc15',
      widthWorld: 3.4,
    });
    lbl.position.set(sh.x, 3.25, sh.z);
    group.add(lbl);
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
      new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.6 }),
    );
    trunk.position.y = 0.75;
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 16, 14),
      new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.34 }),
    );
    foliage.position.y = 1.92;
    tg.add(trunk, foliage);

    const berriesGroup = new THREE.Group();
    const berryMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#d97706',
      emissiveIntensity: 0.42,
      roughness: 0.2,
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

  // 9. Glowing Inter-Zone Gateways with Toy Wooden/Stone Arch Pillars
  for (const gw of zone.gateways || []) {
    const portal = new THREE.Group();
    portal.position.set(gw.x, 0, gw.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.15, 12, 32),
      new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 0.85,
        roughness: 0.18,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    portal.add(ring);

    const innerPad = new THREE.Mesh(
      new THREE.CircleGeometry(1.38, 28),
      new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.28, depthWrite: false }),
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
    group.add(portal);

    animated.push((t) => {
      ring.scale.setScalar(1.0 + Math.sin(t * 3.2) * 0.06);
    });
  }

  animated.push((t) => {
    water.position.y = -0.85 + Math.sin(t * 1.6) * 0.045;
    waterTex.offset.x = (t * 0.028) % 1;
    waterTex.offset.y = Math.sin(t * 0.45) * 0.06;
  });

  return {
    group,
    colliders,
    houseInteractables,
    shrineInteractables,
    berryInteractables,
    loadPromises,
    update(timeSec, dt) {
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
 * Builds the glowing 2.5D Real-Time Tactical Holo-Arena Ring centered at `(cx, cz)`.
 */
export function buildBattleArenaGroup(cx, cz, radius = 6.6) {
  const g = new THREE.Group();
  g.position.set(cx, 0.04, cz);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.13, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  const innerRim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.42, 0.055, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.6 }),
  );
  innerRim.rotation.x = Math.PI / 2;
  g.add(innerRim);

  // Holo-arena center line
  const centerLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, radius * 1.92),
    new THREE.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  centerLine.rotation.x = -Math.PI / 2;
  g.add(centerLine);

  // 4 corner holo-pylons around the arena perimeter
  const pylonGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.62, 10);
  const pylonMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(Math.cos(a) * radius, 0.31, Math.sin(a) * radius);
    g.add(pylon);
  }

  return g;
}
