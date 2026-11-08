// 2.5D Toy-Diorama Zone Builder
// Constructs each of the 5 interconnected islands with beveled cliffs, glistening animated water,
// rounded sandy/stone roads, `InstancedMesh` swaying grass, biome toy trees, Berry Trees,
// Banana Shrines, glowing Zone Gateways, and all 5 TRELLIS.2 Spec Houses!

import * as THREE from 'three';
import { makeLabelSprite } from './model_loader.js';

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
    return s / 0xffffffff;
  };
}

export function buildZoneDiorama(zone, modelBank) {
  const group = new THREE.Group();
  const colliders = []; // { x, z, r } circular obstacles for smooth 2.5D sliding collision
  const animated = [];  // (timeSec) => void
  const loadPromises = [];

  const { halfW, halfD } = zone.bounds;
  const rand = seededRand((zone.index || 1) * 98765 + 1337);

  // 1. Glistening outer sea / hot-spring / magma plane
  const waterGeo = new THREE.PlaneGeometry(190, 190, 28, 28);
  const waterMat = new THREE.MeshStandardMaterial({
    color: zone.waterColor || '#1fb6e8',
    roughness: 0.16,
    metalness: 0.18,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.85;
  group.add(water);

  // Gentle shoreline foam rim around the miniature island
  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 4.4, 0.3, halfD * 2 + 4.4),
    new THREE.MeshStandardMaterial({
      color: zone.theme === 'volcano' ? '#fb923c' : '#e0f7ff',
      roughness: 0.5,
    }),
  );
  foam.position.y = -0.78;
  group.add(foam);

  // 2. Multi-tiered beveled miniature tabletop cliff & grass top
  const cliffBase = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2.4, 1.5, halfD * 2 + 2.4),
    new THREE.MeshStandardMaterial({ color: zone.cliffColor || '#c98850', roughness: 0.72 }),
  );
  cliffBase.position.y = -0.82;
  cliffBase.receiveShadow = true;
  group.add(cliffBase);

  const lawn = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 0.8, 0.44, halfD * 2 + 0.8),
    new THREE.MeshStandardMaterial({ color: zone.groundColor || '#67c956', roughness: 0.65 }),
  );
  lawn.position.y = -0.22;
  lawn.receiveShadow = true;
  group.add(lawn);

  // 3. Rounded Toy Paths connecting Spawn -> Center Plaza -> Houses -> Gateways
  const pathMat = new THREE.MeshStandardMaterial({
    color: zone.pathColor || '#f3d89c',
    roughness: 0.75,
  });
  const addPathSegment = (x0, z0, x1, z1, width = 2.6) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, len + width * 0.5), pathMat);
    seg.position.set((x0 + x1) * 0.5, 0.015, (z0 + z1) * 0.5);
    seg.rotation.y = Math.atan2(dx, dz);
    seg.receiveShadow = true;
    group.add(seg);
  };

  // Central town plaza circle
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.06, 32), pathMat);
  plaza.position.set(0, 0.02, 2.0);
  plaza.receiveShadow = true;
  group.add(plaza);

  for (const h of zone.houses || []) {
    addPathSegment(0, 2.0, h.x, h.z + 2.4, 2.5);
  }
  for (const gw of zone.gateways || []) {
    addPathSegment(0, 2.0, gw.x * 0.92, gw.z * 0.92, 2.7);
  }

  // 4. Instanced Glossy Grass Tufts & Toy Wildflowers
  const grassCount = 220;
  const bladeGeo = new THREE.ConeGeometry(0.13, 0.52, 5);
  bladeGeo.translate(0, 0.26, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: zone.theme === 'snow' ? '#bae6fd' : zone.theme === 'volcano' ? '#fb923c' : '#34d399',
    roughness: 0.45,
  });
  const grassInst = new THREE.InstancedMesh(bladeGeo, bladeMat, grassCount);
  const dummy = new THREE.Object3D();
  let placedGrass = 0;
  for (let i = 0; i < grassCount * 2 && placedGrass < grassCount; i++) {
    const gx = (rand() * 2 - 1) * (halfW - 1.8);
    const gz = (rand() * 2 - 1) * (halfD - 1.8);
    if (Math.hypot(gx, gz - 2.0) < 4.5) continue;
    dummy.position.set(gx, 0, gz);
    dummy.rotation.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
    const s = 0.75 + rand() * 0.75;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    grassInst.setMatrixAt(placedGrass++, dummy.matrix);
  }
  grassInst.count = placedGrass;
  group.add(grassInst);

  // 5. Biome Toy Trees around the perimeter & groves
  const addToyTree = (tx, tz) => {
    const tg = new THREE.Group();
    tg.position.set(tx, 0, tz);
    if (zone.theme === 'volcano') {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.95, 0),
        new THREE.MeshStandardMaterial({
          color: '#f97316',
          emissive: '#9a3412',
          emissiveIntensity: 0.45,
          roughness: 0.22,
        }),
      );
      crystal.scale.set(0.85, 2.1, 0.85);
      crystal.position.y = 1.4;
      const base = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.75, 0),
        new THREE.MeshStandardMaterial({ color: '#292524', roughness: 0.7 }),
      );
      base.position.y = 0.35;
      tg.add(base, crystal);
    } else if (zone.theme === 'harbor') {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.3, 1.9, 12),
        new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.6 }),
      );
      post.position.y = 0.95;
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 14, 12),
        new THREE.MeshStandardMaterial({
          color: '#fef08a',
          emissive: '#f59e0b',
          emissiveIntensity: 0.55,
          roughness: 0.2,
        }),
      );
      lantern.position.y = 2.05;
      tg.add(post, lantern);
    } else {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.34, 1.85, 10),
        new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.65 }),
      );
      trunk.position.y = 0.92;
      const crownColor =
        zone.theme === 'snow' ? '#e0f2fe' : zone.theme === 'forest' ? '#22c55e' : '#4ade80';
      const crown1 = new THREE.Mesh(
        new THREE.SphereGeometry(1.18, 16, 14),
        new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.38 }),
      );
      crown1.position.y = 2.25;
      crown1.scale.set(1.1, 0.88, 1.1);
      const crown2 = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 14, 12),
        new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.35 }),
      );
      crown2.position.set(0.3, 2.95, -0.15);
      tg.add(trunk, crown1, crown2);
    }
    group.add(tg);
    colliders.push({ x: tx, z: tz, r: 0.95 });
  };

  const borderTrees = [
    [-halfW + 2.4, -halfD + 2.8],
    [halfW - 2.4, -halfD + 2.8],
    [-halfW + 2.4, halfD - 2.8],
    [halfW - 2.4, halfD - 2.8],
    [-halfW + 2.6, -6.5],
    [-halfW + 2.6, 8.5],
    [halfW - 2.6, -7.5],
    [halfW - 2.6, 9.5],
    [-9.5, -halfD + 2.8],
    [10.5, -halfD + 2.8],
  ];
  for (const [bx, bz] of borderTrees) {
    const nearGate = (zone.gateways || []).some((gw) => Math.hypot(gw.x - bx, gw.z - bz) < 4.5);
    if (!nearGate) addToyTree(bx, bz);
  }

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

    // Welcoming golden doorstep mat
    const matRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.06, 24),
      new THREE.MeshStandardMaterial({
        color: '#fde047',
        emissive: '#f59e0b',
        emissiveIntensity: 0.35,
        roughness: 0.35,
      }),
    );
    matRing.position.set(h.x, 0.03, h.z + (h.scale || 4.4) * 0.48);
    group.add(matRing);

    const sign = makeLabelSprite({
      title: h.label,
      subtitle: h.sublabel || '',
      badgeText: '🏠 HOUSE',
      badgeColor: '#fbbf24',
      widthWorld: 3.8,
    });
    sign.position.set(h.x, (h.scale || 4.4) * 0.68 + 0.55, h.z);
    group.add(sign);

    colliders.push({ x: h.x, z: h.z, r: (h.scale || 4.4) * 0.36 });
    houseInteractables.push({
      ...h,
      doorX: h.x,
      doorZ: h.z + (h.scale || 4.4) * 0.48,
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

    const lbl = makeLabelSprite({
      title: 'BANANA SHRINE',
      subtitle: '[A] Blessing (+ATK / Heal)',
      badgeText: '✨',
      badgeColor: '#facc15',
      widthWorld: 3.4,
    });
    lbl.position.set(sh.x, 3.2, sh.z);
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
      new THREE.SphereGeometry(1.05, 16, 14),
      new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.36 }),
    );
    foliage.position.y = 1.9;
    tg.add(trunk, foliage);

    const berriesGroup = new THREE.Group();
    const berryMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#d97706',
      emissiveIntensity: 0.35,
      roughness: 0.22,
    });
    for (const [bx, by, bz] of [
      [-0.45, 1.65, 0.72],
      [0.42, 1.85, 0.68],
      [0.0, 2.25, 0.76],
    ]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), berryMat);
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

  // 9. Glowing Inter-Zone Gateways
  for (const gw of zone.gateways || []) {
    const portal = new THREE.Group();
    portal.position.set(gw.x, 0, gw.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.14, 12, 32),
      new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0ea5e9',
        emissiveIntensity: 0.75,
        roughness: 0.2,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    portal.add(ring);

    const sign = makeLabelSprite({
      title: gw.label,
      badgeText: 'ZONE',
      badgeColor: '#38bdf8',
      widthWorld: 3.6,
    });
    sign.position.set(0, 2.15, 0);
    portal.add(sign);
    group.add(portal);

    animated.push((t) => {
      ring.scale.setScalar(1.0 + Math.sin(t * 3.2) * 0.06);
    });
  }

  animated.push((t) => {
    water.position.y = -0.85 + Math.sin(t * 1.6) * 0.05;
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
      opacity: 0.36,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.12, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  const innerRim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.42, 0.05, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.55 }),
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

  return g;
}
