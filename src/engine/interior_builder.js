// 2.5D Cutaway Dollhouse & Dojo 3D Interior Builder for Monkemon!
// Every House across all 5 islands can be entered and explored on foot:
//   - `alex_house`: Cozy two-area family cottage with bed, kitchen toast table, retro TV corner, bookshelf & Mom!
//   - `lab` / `rest`: Sanctuary Lab & Healing Center with 6-slot Monkeball Healing Machine, Shop Counter & Storage PC!
//   - `peanut_butter_house`: Golden Amber Dojo Hall with peanut-butter vats, elevated dais & House Master Skippy!
//   - `fish_house`: Aquarium Harbor Dojo with glowing indoor water pools, ship helm & Captain Marina!
//   - `pork_house`: Cozy Alpine Timber Dojo with steaming indoor hot-spring baths, lanterns & Master Truffle!
//   - `beef_house`: Grand Obsidian Championship Hall with magma braziers, golden pillars & Grand Champion Chuck!

import * as THREE from 'three';
import { makeLabelSprite } from './model_loader.js';
import { createStreamChannelShaderMaterial, createSunbeamShaderMaterial } from './shaders.js';

const ASSET_VERSION = '20261108a';
const _texLoader = new THREE.TextureLoader();

function loadTexPair(baseName, rx = 4, ry = 4) {
  const map = _texLoader.load(`assets/textures/${baseName}.jpg?v=${ASSET_VERSION}`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, ry);
  map.anisotropy = 4;

  const normalMap = _texLoader.load(`assets/textures/${baseName}_normal.jpg?v=${ASSET_VERSION}`);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(rx, ry);
  normalMap.anisotropy = 4;
  return { map, normalMap };
}

const INTERIOR_THEMES = {
  alex_house: {
    halfW: 8.5,
    halfD: 7.2,
    floorTex: 'wood_timber',
    floorTint: '#f3d5b5',
    wallColor: '#fef3c7',
    trimColor: '#92400e',
    rugColor: '#ef4444',
    rugTrim: '#fde047',
    bgSky: '#10192b',
    lightColor: '#fde68a',
  },
  peanut_butter_house: {
    halfW: 10.2,
    halfD: 8.8,
    floorTex: 'wood_timber',
    floorTint: '#f5cb86',
    wallColor: '#fde68a',
    trimColor: '#78350f',
    rugColor: '#d97706',
    rugTrim: '#fef08a',
    bgSky: '#17120b',
    lightColor: '#fbbf24',
    isDojo: true,
  },
  fish_house: {
    halfW: 10.4,
    halfD: 8.8,
    floorTex: 'harbor_stone',
    floorTint: '#bae6fd',
    wallColor: '#e0f2fe',
    trimColor: '#0369a1',
    rugColor: '#0284c7',
    rugTrim: '#7dd3fc',
    bgSky: '#081a2c',
    lightColor: '#38bdf8',
    isDojo: true,
  },
  pork_house: {
    halfW: 10.4,
    halfD: 8.8,
    floorTex: 'wood_timber',
    floorTint: '#e7c6a5',
    wallColor: '#ffedd5',
    trimColor: '#7c2d12',
    rugColor: '#ea580c',
    rugTrim: '#fed7aa',
    bgSky: '#141926',
    lightColor: '#fdba74',
    isDojo: true,
  },
  beef_house: {
    halfW: 11.0,
    halfD: 9.4,
    floorTex: 'volcano_basalt',
    floorTint: '#a8a29e',
    wallColor: '#44403c',
    trimColor: '#b91c1c',
    rugColor: '#991b1b',
    rugTrim: '#facc15',
    bgSky: '#1a0909',
    lightColor: '#fb923c',
    isDojo: true,
  },
  sanctuary: {
    halfW: 9.2,
    halfD: 7.6,
    floorTex: 'harbor_stone',
    floorTint: '#f8fafc',
    wallColor: '#f0f9ff',
    trimColor: '#0284c7',
    rugColor: '#0ea5e9',
    rugTrim: '#fde047',
    bgSky: '#0b192c',
    lightColor: '#7dd3fc',
  },
};

export function buildHouseInteriorDiorama(houseDef, zone, modelBank) {
  const group = new THREE.Group();
  const colliders = [];
  const animated = [];
  const labelSprites = [];
  const stations = []; // { id, kind, x, z, r, prompt, ... }

  const styleKey = INTERIOR_THEMES[houseDef.id] ? houseDef.id : 'sanctuary';
  const cfg = INTERIOR_THEMES[styleKey];
  const { halfW, halfD } = cfg;
  const isSoftwareGl = Boolean(modelBank && modelBank.isSoftwareGl);

  const floorPair = loadTexPair(cfg.floorTex, Math.round(halfW * 0.65), Math.round(halfD * 0.65));
  const woodPair = loadTexPair('wood_timber', 2, 2);
  const stonePair = loadTexPair('cliff_rock', 2, 2);

  // 1. Exterior Dark Velvet Diorama Plinth + Cutaway Room Floor & Walls
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 1.4, 0.9, halfD * 2 + 1.4),
    new THREE.MeshStandardMaterial({
      map: stonePair.map,
      normalMap: stonePair.normalMap,
      color: cfg.trimColor,
      roughness: 0.72,
    }),
  );
  plinth.position.y = -0.5;
  group.add(plinth);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2, 0.22, halfD * 2),
    new THREE.MeshStandardMaterial({
      map: floorPair.map,
      normalMap: floorPair.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: cfg.floorTint,
      roughness: styleKey === 'sanctuary' ? 0.35 : 0.58,
      metalness: styleKey === 'sanctuary' ? 0.08 : 0.02,
    }),
  );
  floor.position.y = -0.11;
  floor.receiveShadow = !isSoftwareGl;
  group.add(floor);

  const wallH = 4.2;
  const wallMat = new THREE.MeshStandardMaterial({ color: cfg.wallColor, roughness: 0.78 });
  const trimMat = new THREE.MeshStandardMaterial({
    map: woodPair.map,
    normalMap: woodPair.normalMap,
    color: cfg.trimColor,
    roughness: 0.55,
  });

  // Back (North) Wall
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.5, wallH, 0.42), wallMat);
  backWall.position.set(0, wallH * 0.5, -halfD - 0.15);
  group.add(backWall);

  // Wainscoting & top crown beam along back wall
  const wainscotBack = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.54, 1.05, 0.48), trimMat);
  wainscotBack.position.set(0, 0.52, -halfD - 0.14);
  const crownBack = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.62, 0.28, 0.56), trimMat);
  crownBack.position.set(0, wallH + 0.05, -halfD - 0.14);
  group.add(wainscotBack, crownBack);

  // Left & Right Cutaway Side Walls (tapered smoothly toward south camera edge!)
  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.42, wallH, halfD * 2 + 0.4), wallMat);
    sideWall.position.set(side * (halfW + 0.15), wallH * 0.5, 0);
    const sideTrim = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.05, halfD * 2 + 0.44), trimMat);
    sideTrim.position.set(side * (halfW + 0.14), 0.52, 0);
    const sideCrown = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, halfD * 2 + 0.5), trimMat);
    sideCrown.position.set(side * (halfW + 0.14), wallH + 0.05, 0);
    group.add(sideWall, sideTrim, sideCrown);
  }

  // Low front cutaway curb + open South Doorway Gap!
  const frontHalfSeg = (halfW - 1.9);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(frontHalfSeg, 0.46, 0.42), trimMat);
    curb.position.set(side * (1.9 + frontHalfSeg * 0.5), 0.23, halfD + 0.12);
    group.add(curb);
  }

  // Glowing Sunlit Windows on Back Wall + Volumetric Sunbeams!
  const sunbeamMat = createSunbeamShaderMaterial({ color: cfg.lightColor, opacity: 0.12 });
  for (const wx of [-halfW * 0.52, halfW * 0.52]) {
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.75, 0.16), trimMat);
    winFrame.position.set(wx, 2.45, -halfD + 0.08);
    const winPane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.95, 1.4),
      new THREE.MeshBasicMaterial({ color: styleKey === 'beef_house' ? '#fb923c' : '#bae6fd' }),
    );
    winPane.position.set(wx, 2.45, -halfD + 0.18);
    group.add(winFrame, winPane);

    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.45, 5.2, 16, 1, true), sunbeamMat);
    beam.position.set(wx + 0.4, 1.6, -halfD + 1.85);
    beam.rotation.z = -0.22;
    beam.rotation.x = 0.42;
    group.add(beam);
  }

  // Warm Interior PointLight
  const roomLight = new THREE.PointLight(cfg.lightColor, 2.6, 24, 1.3);
  roomLight.position.set(0, 3.6, 0);
  group.add(roomLight);

  // 2. South Glowing Exit Doormat!
  const exitZ = halfD - 0.95;
  const exitMat = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.06, 1.55),
    new THREE.MeshStandardMaterial({ color: cfg.rugColor, roughness: 0.8 }),
  );
  exitMat.position.set(0, 0.03, exitZ);
  const exitBorder = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 0.04, 1.78),
    new THREE.MeshStandardMaterial({ color: cfg.rugTrim, roughness: 0.55 }),
  );
  exitBorder.position.set(0, 0.015, exitZ);
  group.add(exitBorder, exitMat);

  const exitSign = makeLabelSprite({
    title: `Exit to ${zone.name}`,
    subtitle: 'Walk onto mat or press [A]',
    badgeText: '🚪 EXIT',
    badgeColor: '#fbbf24',
    widthWorld: 3.1,
  });
  exitSign.position.set(0, 0.95, exitZ + 0.55);
  labelSprites.push(exitSign);
  group.add(exitSign);

  // Helper props: Potted plant, Wooden Table, Lantern, Healing Machine, PC Terminal
  const addPottedPlant = (x, z) => {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.32, 0.55, 14),
      new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.65 }),
    );
    pot.position.set(x, 0.27, z);
    const bush = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.58, 1),
      new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.55 }),
    );
    bush.position.set(x, 0.85, z);
    group.add(pot, bush);
    colliders.push({ x, z, r: 0.58 });
  };

  const addHealingStation = (x, z, labelTxt = 'HEALING STATION') => {
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.05, 1.25),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.32, metalness: 0.1 }),
    );
    desk.position.set(x, 0.52, z);
    const topStrip = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.14, 1.35),
      new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.28 }),
    );
    topStrip.position.set(x, 1.08, z);
    group.add(desk, topStrip);

    // 6 Glowing Monkeball Healing Wells!
    const padMats = [];
    for (let i = 0; i < 6; i++) {
      const px = x - 0.75 + (i % 3) * 0.75;
      const pz = z - 0.22 + Math.floor(i / 3) * 0.44;
      const pMat = new THREE.MeshStandardMaterial({
        color: '#4ade80',
        emissive: '#22c55e',
        emissiveIntensity: 0.9,
        roughness: 0.2,
      });
      padMats.push(pMat);
      const well = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.08, 16), pMat);
      well.position.set(px, 1.18, pz);
      group.add(well);
    }
    animated.push((t) => {
      const pulse = 0.65 + 0.45 * Math.sin(t * 3.5);
      for (const m of padMats) m.emissiveIntensity = pulse;
    });

    const lbl = makeLabelSprite({
      title: labelTxt,
      subtitle: '[A] Full Party Heal & Monkeballs',
      badgeText: '💚 HEAL',
      badgeColor: '#4ade80',
      widthWorld: 3.2,
    });
    lbl.position.set(x, 2.25, z);
    labelSprites.push(lbl);
    group.add(lbl);

    colliders.push({ x, z, r: 1.35 });
    stations.push({
      id: 'heal_machine',
      kind: 'heal',
      x,
      z: z + 1.1,
      r: 2.3,
      prompt: '💚 [A / Space] Use Monkeball Healing Station (100% HP & Restock)',
    });
  };

  const addPcStation = (x, z) => {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.75, 0.95),
      new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.35, metalness: 0.25 }),
    );
    base.position.set(x, 0.88, z);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.66),
      new THREE.MeshBasicMaterial({ color: '#38bdf8' }),
    );
    screen.position.set(x, 1.28, z + 0.49);
    group.add(base, screen);

    const lbl = makeLabelSprite({
      title: 'PARTY & STORAGE PC',
      subtitle: '[A] Swap Squad & Lead Monkemon',
      badgeText: '💻 PC BOX',
      badgeColor: '#38bdf8',
      widthWorld: 3.1,
    });
    lbl.position.set(x, 2.35, z);
    labelSprites.push(lbl);
    group.add(lbl);

    colliders.push({ x, z, r: 0.85 });
    stations.push({
      id: 'pc_terminal',
      kind: 'pc',
      x,
      z: z + 0.95,
      r: 2.2,
      prompt: '💻 [A / Space] Access Sanctuary Party & Storage PC',
    });
  };

  const addShopCounter = (x, z) => {
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.05, 1.15),
      new THREE.MeshStandardMaterial({
        map: woodPair.map,
        normalMap: woodPair.normalMap,
        color: '#f59e0b',
        roughness: 0.48,
      }),
    );
    counter.position.set(x, 0.52, z);
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.22, 1.35),
      new THREE.MeshStandardMaterial({ color: '#2563eb', roughness: 0.4 }),
    );
    canopy.position.set(x, 2.35, z);
    group.add(counter, canopy);

    const clerk = modelBank.spawnActor({
      glbUrl: 'assets/models/trainer_scout.glb',
      scale: 1.52,
      primaryColor: '#38bdf8',
      secondaryColor: '#fde047',
      animateRig: true,
    });
    clerk.root.position.set(x, 0, z - 0.95);
    group.add(clerk.root);
    animated.push((t, dt = 0.016) => {
      if (clerk.updateMotion) clerk.updateMotion(dt, { targetYaw: 0, moveSpeed: 0 });
    });

    const lbl = makeLabelSprite({
      title: 'MONKEBALL MART',
      subtitle: '[A] Super Balls, Berries & Treats',
      badgeText: '🛍️ SHOP',
      badgeColor: '#fbbf24',
      widthWorld: 3.1,
    });
    lbl.position.set(x, 2.85, z);
    labelSprites.push(lbl);
    group.add(lbl);

    colliders.push({ x, z, r: 1.3 });
    stations.push({
      id: 'mart_counter',
      kind: 'shop',
      x,
      z: z + 1.05,
      r: 2.3,
      prompt: '🛍️ [A / Space] Browse Monkeball Mart & Treats Counter',
    });
  };

  addPottedPlant(-halfW + 1.15, halfD - 1.2);
  addPottedPlant(halfW - 1.15, halfD - 1.2);

  // 3. Archetype-Specific Interior Furnishings & Interactive Characters!
  if (styleKey === 'alex_house') {
    // Center Woven Rug
    const rug = new THREE.Mesh(
      new THREE.CylinderGeometry(2.85, 2.85, 0.03, 36),
      new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.88 }),
    );
    rug.position.set(-0.4, 0.02, 0.4);
    const rugInner = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 0.035, 36),
      new THREE.MeshStandardMaterial({ color: '#fef08a', roughness: 0.88 }),
    );
    rugInner.position.set(-0.4, 0.025, 0.4);
    group.add(rug, rugInner);

    // Alex's Cozy Bed (Left Bedroom Nook — Rest & Heal!)
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, 3.1), trimMat);
    bedFrame.position.set(-5.8, 0.28, -3.6);
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.35, 2.85),
      new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.72 }),
    );
    mattress.position.set(-5.8, 0.65, -3.55);
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.24, 0.75),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
    );
    pillow.position.set(-5.8, 0.88, -4.45);
    group.add(bedFrame, mattress, pillow);
    colliders.push({ x: -5.8, z: -3.6, r: 1.65 });

    const bedLbl = makeLabelSprite({
      title: "ALEX'S COZY BED",
      subtitle: '[A] Take a Nap (Full Party Heal)',
      badgeText: '🛏️ REST',
      badgeColor: '#f87171',
      widthWorld: 3.0,
    });
    bedLbl.position.set(-5.8, 2.05, -3.6);
    labelSprites.push(bedLbl);
    group.add(bedLbl);
    stations.push({
      id: 'alex_bed',
      kind: 'heal',
      x: -4.2,
      z: -3.4,
      r: 2.4,
      prompt: "🛏️ [A / Space] Rest in Alex's Bed (Full Party Heal!)",
    });

    // Bookshelf + PC Desk in top-center/right!
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 0.75), trimMat);
    shelf.position.set(-1.8, 1.25, -halfD + 0.55);
    group.add(shelf);
    colliders.push({ x: -1.8, z: -halfD + 0.55, r: 1.1 });
    stations.push({
      id: 'tamer_bookshelf',
      kind: 'lore',
      x: -1.8,
      z: -halfD + 1.6,
      r: 2.0,
      prompt: '📚 [A / Space] Read Archipelago Tamer Handbook',
      loreText:
        '📖 Tamer Tip: Explore side bridges & cliff stairs for hidden Treasure Chests! In battle, check move Type Badges for ★ SUPER EFFECTIVE hits!',
    });

    addPcStation(5.8, -halfD + 0.9);

    // Kitchen Toast Table + Alex's Mom!
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.14, 24),
      new THREE.MeshStandardMaterial({ map: woodPair.map, color: '#fde68a', roughness: 0.5 }),
    );
    table.position.set(3.2, 0.88, 0.8);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 0.88, 12), trimMat);
    tableLeg.position.set(3.2, 0.44, 0.8);
    group.add(table, tableLeg);
    colliders.push({ x: 3.2, z: 0.8, r: 1.35 });

    const momActor = modelBank.spawnActor({
      glbUrl: 'assets/models/trainer_warden.glb',
      scale: 1.66,
      primaryColor: '#f472b6',
      secondaryColor: '#fef3c7',
      animateRig: true,
    });
    momActor.root.position.set(1.2, 0, -1.2);
    const momLbl = makeLabelSprite({
      title: "Alex's Mom",
      subtitle: '[A] Chat & Homemade Toast Heal!',
      badgeText: '🏠 MOM',
      badgeColor: '#f472b6',
      widthWorld: 3.1,
    });
    momLbl.position.set(0, 2.3, 0);
    labelSprites.push(momLbl);
    momActor.root.add(momLbl);
    group.add(momActor.root);
    colliders.push({ x: 1.2, z: -1.2, r: 0.7 });
    animated.push((t, dt = 0.016) => {
      if (momActor.updateMotion) momActor.updateMotion(dt, { targetYaw: 0.25, moveSpeed: 0, cheer: 0.25 });
    });

    stations.push({
      id: 'mom_npc',
      kind: 'mom',
      x: 1.2,
      z: -0.6,
      r: 2.5,
      voiceKey: houseDef.voiceKey || 'alex_mom',
      voiceLine:
        houseDef.voiceLine ||
        'Welcome home, Alex! Have a warm Peanut-Butter Banana toast—your Monkemon are rested and ready!',
      prompt: "🧁 [A / Space] Talk to Mom (Full Party Heal + Fresh Berries!)",
    });
  } else if (cfg.isDojo) {
    // Grand Indoor House Dojo Arena Hall!
    // Center Tatami / Stone Battle Ring inside the Dojo
    const ringOuter = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.06, 6.2),
      new THREE.MeshStandardMaterial({ color: cfg.rugTrim, roughness: 0.65 }),
    );
    ringOuter.position.set(0, 0.03, 0.5);
    const ringInner = new THREE.Mesh(
      new THREE.BoxGeometry(8.0, 0.075, 5.6),
      new THREE.MeshStandardMaterial({ color: cfg.rugColor, roughness: 0.78 }),
    );
    ringInner.position.set(0, 0.038, 0.5);
    group.add(ringOuter, ringInner);

    // North Raised Leader Dais Platform
    const dais = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 0.36, 3.2),
      new THREE.MeshStandardMaterial({
        map: stonePair.map,
        normalMap: stonePair.normalMap,
        color: cfg.trimColor,
        roughness: 0.55,
      }),
    );
    dais.position.set(0, 0.18, -halfD + 2.2);
    group.add(dais);

    // Side Biome Features inside the Dojo (hollow pool border + non-clipping stream shader)!
    if (styleKey === 'fish_house' || styleKey === 'pork_house' || styleKey === 'beef_house') {
      const poolMat = createStreamChannelShaderMaterial({
        waterColor: styleKey === 'beef_house' ? '#f97316' : styleKey === 'pork_house' ? '#2dd4bf' : '#0ea5e9',
        deepColor: styleKey === 'beef_house' ? '#450a0a' : '#0369a1',
        skyColor: '#bae6fd',
        fogColor: '#bae6fd',
        fogNear: 60,
        fogFar: 120,
        clipToCoast: false,
        theme: styleKey === 'beef_house' ? 'volcano' : 'tropical',
      });
      animated.push((t) => {
        poolMat.uniforms.uTime.value = t;
      });
      for (const side of [-1, 1]) {
        const px = side * (halfW - 1.85);
        const pz = -0.4;
        const poolBase = new THREE.Mesh(
          new THREE.BoxGeometry(2.15, 0.04, 7.2),
          new THREE.MeshStandardMaterial({ color: '#082f49', roughness: 0.9 }),
        );
        poolBase.position.set(px, 0.02, pz);
        const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 7.6), trimMat);
        wallL.position.set(px - 1.14, 0.14, pz);
        const wallR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 7.6), trimMat);
        wallR.position.set(px + 1.14, 0.14, pz);
        const wallN = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 0.22), trimMat);
        wallN.position.set(px, 0.14, pz - 3.69);
        const wallS = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.28, 0.22), trimMat);
        wallS.position.set(px, 0.14, pz + 3.69);
        const liquid = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 7.16, 6, 18), poolMat);
        liquid.rotation.x = -Math.PI / 2;
        liquid.position.set(px, 0.21, pz);
        group.add(poolBase, wallL, wallR, wallN, wallS, liquid);
        colliders.push({ x: px, z: pz - 2.0, r: 1.25 });
        colliders.push({ x: px, z: pz + 2.0, r: 1.25 });
      }
    } else {
      // Peanut Butter House: Giant Golden Honey/Peanut-Butter Barrels & Pillars!
      for (const side of [-1, 1]) {
        for (const bz of [-3.2, 1.8]) {
          const jar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.72, 0.78, 1.55, 18),
            new THREE.MeshStandardMaterial({ color: '#d97706', roughness: 0.32, metalness: 0.12 }),
          );
          jar.position.set(side * (halfW - 1.9), 0.78, bz);
          const lid = new THREE.Mesh(
            new THREE.CylinderGeometry(0.76, 0.76, 0.24, 18),
            new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.35 }),
          );
          lid.position.set(side * (halfW - 1.9), 1.62, bz);
          group.add(jar, lid);
          colliders.push({ x: side * (halfW - 1.9), z: bz, r: 0.9 });
        }
      }
    }

    // Side Dojo Healing Shrine Bench so challengers can heal right inside the Dojo!
    addHealingStation(-5.4, halfD - 2.6, 'DOJO PREP BENCH');

    // Spawn the House Leader on the North Dais!
    const wardenDef = (zone.trainers || []).find((tr) => tr.id === houseDef.wardenId) ||
      (zone.trainers || []).find((tr) => tr.isWarden);
    if (wardenDef) {
      const wActor = modelBank.spawnActor({
        glbUrl: 'assets/models/trainer_warden.glb',
        scale: 1.9,
        primaryColor: '#f59e0b',
        secondaryColor: '#fef3c7',
        animateRig: true,
      });
      const wx = 0;
      const wz = -halfD + 2.4;
      wActor.root.position.set(wx, 0.36, wz);
      const wLbl = makeLabelSprite({
        title: wardenDef.name,
        subtitle: `${wardenDef.role} · [A] Title Match!`,
        badgeText: '🏅 HOUSE LEADER',
        badgeColor: '#fbbf24',
        widthWorld: 3.8,
      });
      wLbl.position.set(0, 2.4, 0);
      labelSprites.push(wLbl);
      wActor.root.add(wLbl);
      group.add(wActor.root);
      colliders.push({ x: wx, z: wz, r: 0.85 });

      animated.push((t, dt = 0.016) => {
        if (wActor.updateMotion) wActor.updateMotion(dt, { targetYaw: 0, moveSpeed: 0, cheer: 0.35 });
      });

      stations.push({
        id: `dojo_leader_${wardenDef.id}`,
        kind: 'trainer',
        trainerDef: wardenDef,
        x: 0,
        z: wz + 1.8,
        r: 2.8,
        prompt: `🏅 [A / Space] Challenge ${wardenDef.name} for the ${wardenDef.badgeName || 'House Badge'}!`,
      });
    }
  } else {
    // Sanctuary / Professor Monkeball Lab / Island Lodge Interior!
    const emblem = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 0.03, 36),
      new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.65 }),
    );
    emblem.position.set(0, 0.02, 0.8);
    const emblemCore = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 0.036, 36),
      new THREE.MeshStandardMaterial({ color: '#fde047', roughness: 0.55 }),
    );
    emblemCore.position.set(0, 0.025, 0.8);
    group.add(emblem, emblemCore);

    // Center-North Healing Machine + Right PC + Left Mart Counter!
    addHealingStation(0, -halfD + 2.1, houseDef.label || 'SANCTUARY HEAL');
    addShopCounter(-5.4, -0.8);
    addPcStation(5.8, -2.2);

    if (houseDef.id === 'cove_pavilion') {
      const prof = modelBank.spawnActor({
        glbUrl: 'assets/models/trainer_warden.glb',
        scale: 1.72,
        primaryColor: '#38bdf8',
        secondaryColor: '#ffffff',
        animateRig: true,
      });
      prof.root.position.set(3.4, 0, -3.4);
      const pLbl = makeLabelSprite({
        title: 'Prof. Macaque',
        subtitle: '[A] Research Tips & Free Monkeballs!',
        badgeText: '🔬 PROF',
        badgeColor: '#38bdf8',
        widthWorld: 3.4,
      });
      pLbl.position.set(0, 2.35, 0);
      labelSprites.push(pLbl);
      prof.root.add(pLbl);
      group.add(prof.root);
      colliders.push({ x: 3.4, z: -3.4, r: 0.72 });
      animated.push((t, dt = 0.016) => {
        if (prof.updateMotion) prof.updateMotion(dt, { targetYaw: -0.35, moveSpeed: 0, cheer: 0.25 });
      });
      stations.push({
        id: 'prof_npc',
        kind: 'prof',
        x: 3.4,
        z: -2.5,
        r: 2.3,
        voiceKey: houseDef.voiceKey || 'prof_welcome',
        voiceLine:
          houseDef.voiceLine ||
          'Welcome to my Monkeball Lab, Alex! Step inside all five Houses and study every Monkemon!',
        prompt: '🔬 [A / Space] Talk to Prof. Macaque (+Free Monkeball Supply!)',
      });
    }
  }

  let _lastT = 0;
  return {
    isInterior: true,
    houseDef,
    bounds: { halfW: halfW - 0.85, halfD: halfD - 0.65 },
    entrySpawn: { x: 0, z: exitZ - 1.35 },
    exitZone: { x: 0, z: exitZ + 0.25, r: 1.35 },
    skyColor: cfg.bgSky,
    fogColor: cfg.bgSky,
    group,
    colliders,
    stations,
    houseInteractables: [],
    shrineInteractables: [],
    berryInteractables: [],
    chestInteractables: [],
    getHeightAt() {
      return 0;
    },
    setLabelsVisible(visible) {
      for (const sp of labelSprites) sp.visible = visible;
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
