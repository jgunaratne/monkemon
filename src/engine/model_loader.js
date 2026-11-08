// TRELLIS.2 PBR `.glb` Model Loader, Toy-Material Polisher, Nameplate Sprites,
// & 3D Character Walk / Idle / Battle Limb-and-Body Animation Rig!

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_VERSION } from './audio.js';

function withVer(url) {
  if (!url) return url;
  return url.includes('?') ? url : `${url}?v=${ASSET_VERSION}`;
}

export function lerpAngle(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, t);
}

/**
 * Attaches a GPU vertex-shader skeletal-style limb & torso animator (`onBeforeCompile`)
 * to a cloned character/creature mesh so static TRELLIS.2 `.glb` figurines visibly:
 *  - Stride their left & right legs alternately forward/back and lift feet off the ground when walking
 *  - Counter-swing their left & right arms
 *  - Breathe through the chest/belly and bob their head/ears when idle
 *  - Twist their upper torso during attacks & flourishes!
 */
function attachCharacterLimbShader(mesh, uniforms) {
  if (!mesh.geometry) return;
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const bMin = bb ? bb.min.clone() : new THREE.Vector3(-0.5, 0, -0.5);
  const bSize = new THREE.Vector3(1, 1, 1);
  if (bb) bb.getSize(bSize);
  bSize.x = Math.max(0.001, bSize.x);
  bSize.y = Math.max(0.001, bSize.y);
  bSize.z = Math.max(0.001, bSize.z);

  const patchMaterial = (mat) => {
    if (!mat || mat.userData._monkeRigPatched) return mat;
    const cloned = mat.clone();
    cloned.userData._monkeRigPatched = true;
    const localMin = bMin.clone();
    const localSize = bSize.clone();

    cloned.onBeforeCompile = (shader) => {
      shader.uniforms.uWalkPhase = uniforms.uWalkPhase;
      shader.uniforms.uWalkAmp = uniforms.uWalkAmp;
      shader.uniforms.uIdleTime = uniforms.uIdleTime;
      shader.uniforms.uAttackTwist = uniforms.uAttackTwist;
      shader.uniforms.uBBoxMin = { value: localMin };
      shader.uniforms.uBBoxSize = { value: localSize };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uWalkPhase;
          uniform float uWalkAmp;
          uniform float uIdleTime;
          uniform float uAttackTwist;
          uniform vec3 uBBoxMin;
          uniform vec3 uBBoxSize;
          varying float vCharHeightNorm;
          `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          {
            float ny = clamp((transformed.y - uBBoxMin.y) / uBBoxSize.y, 0.0, 1.0);
            vCharHeightNorm = ny;
            float cx = uBBoxMin.x + 0.5 * uBBoxSize.x;
            float cz = uBBoxMin.z + 0.5 * uBBoxSize.z;
            float nx = clamp((transformed.x - cx) / (0.5 * uBBoxSize.x), -1.0, 1.0);

            // Smooth left (-1) vs right (+1) limb weighting
            float side = clamp(nx * 2.1, -1.0, 1.0);

            // 1. Alternating Left/Right Leg Stride & Foot Lift (lower 44% of figurine)
            float legMask = smoothstep(0.44, 0.03, ny);
            float legSwing = sin(uWalkPhase) * side;
            float footLift = max(0.0, cos(uWalkPhase) * side);
            transformed.z += legSwing * legMask * uWalkAmp * (0.24 * uBBoxSize.z);
            transformed.y += footLift * legMask * uWalkAmp * (0.11 * uBBoxSize.y);

            // 2. Counter-Swinging Left/Right Arms (mid-body 26%..78%, outer sides)
            float armBand = smoothstep(0.24, 0.48, ny) * smoothstep(0.82, 0.54, ny);
            float armOuter = smoothstep(0.24, 0.78, abs(nx));
            float armMask = armBand * armOuter;
            float idleArmBob = sin(uIdleTime * 3.4 + side * 0.9) * 0.022 * uBBoxSize.y;
            transformed.z += (-legSwing * uWalkAmp * 0.20 * uBBoxSize.z + sin(uIdleTime * 2.8) * side * 0.02 * uBBoxSize.z) * armMask;
            transformed.y += idleArmBob * armMask;

            // 3. Chest Breathing & Head/Ear Playful Sway
            float chestMask = smoothstep(0.18, 0.55, ny) * smoothstep(0.95, 0.55, ny);
            float breath = sin(uIdleTime * 3.2) * 0.026 * chestMask;
            transformed.x += (transformed.x - cx) * breath;
            transformed.z += (transformed.z - cz) * breath;

            float headMask = smoothstep(0.58, 0.95, ny);
            transformed.x += sin(uIdleTime * 2.2) * headMask * (0.022 * uBBoxSize.x);

            // 4. Upper-Body Walk Counter-Twist & Battle Attack Twist
            float twistAngle = (sin(uWalkPhase) * 0.16 * uWalkAmp + uAttackTwist) * smoothstep(0.16, 0.88, ny);
            if (abs(twistAngle) > 0.0005) {
              float cs = cos(twistAngle);
              float sn = sin(twistAngle);
              float rx = transformed.x - cx;
              float rz = transformed.z - cz;
              transformed.x = cx + rx * cs - rz * sn;
              transformed.z = cz + rx * sn + rz * cs;
            }
          }
          `,
        );

      // Grazing-angle Fresnel rim highlight + lower-body ground contact occlusion for realistic 3D depth!
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying float vCharHeightNorm;
          `,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `
          #include <lights_fragment_end>
          {
            float ndv = clamp(dot(normalize(geometryNormal), normalize(geometryViewDir)), 0.0, 1.0);
            float fresnelRim = pow(1.0 - ndv, 3.2);
            reflectedLight.indirectDiffuse *= mix(0.76, 1.06, smoothstep(0.0, 0.34, vCharHeightNorm));
            reflectedLight.directSpecular += vec3(0.82, 0.93, 1.0) * fresnelRim * 0.22;
          }
          `,
        );
    };
    cloned.customProgramCacheKey = () => 'monkemon-char-rig-v2';
    return cloned;
  };

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(patchMaterial);
  } else {
    mesh.material = patchMaterial(mesh.material);
  }
}

export class ModelBank {
  constructor(isSoftwareGl = false) {
    this.loader = new GLTFLoader();
    this.isSoftwareGl = isSoftwareGl;
    this.cache = new Map();     // url -> normalized THREE.Group prototype
    this.inflight = new Map();  // url -> Promise<THREE.Group|null>
    this.shadowTex = this._makeBlobShadowTexture();
  }

  _makeBlobShadowTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(10, 18, 28, 0.56)');
    g.addColorStop(0.65, 'rgba(10, 18, 28, 0.24)');
    g.addColorStop(1, 'rgba(10, 18, 28, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  loadPrototype(glbUrl) {
    if (!glbUrl) return Promise.resolve(null);
    if (this.cache.has(glbUrl)) return Promise.resolve(this.cache.get(glbUrl));
    if (this.inflight.has(glbUrl)) return this.inflight.get(glbUrl);

    const p = new Promise((resolve) => {
      this.loader.load(
        withVer(glbUrl),
        (gltf) => {
          const raw = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!raw) {
            resolve(null);
            return;
          }
          raw.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(raw);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);

          const maxDim = Math.max(0.001, size.y, size.x * 0.85, size.z * 0.85);
          const normScale = 1.0 / maxDim;

          const wrapper = new THREE.Group();
          raw.scale.multiplyScalar(normScale);
          raw.position.set(
            -center.x * normScale,
            -box.min.y * normScale,
            -center.z * normScale,
          );

          raw.traverse((child) => {
            if (child.isMesh) {
              if (!this.isSoftwareGl) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) {
                if (!m) continue;
                if ('envMapIntensity' in m) m.envMapIntensity = 1.02;
                if ('roughness' in m && typeof m.roughness === 'number') {
                  m.roughness = Math.min(0.78, Math.max(0.24, m.roughness * 0.9));
                }
              }
            }
          });

          wrapper.add(raw);
          this.cache.set(glbUrl, wrapper);
          resolve(wrapper);
        },
        undefined,
        (err) => {
          console.warn('GLB load warning:', glbUrl, err);
          resolve(null);
        },
      );
    });

    this.inflight.set(glbUrl, p);
    return p;
  }

  _buildToyStandIn(primaryHex = '#f59e0b', accentHex = '#fef3c7') {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: primaryHex, roughness: 0.35, metalness: 0.08 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.42, metalness: 0.05 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.15 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), bodyMat);
    body.position.y = 0.32;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 14), bodyMat);
    head.position.y = 0.72;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), bellyMat);
    face.position.set(0, 0.7, 0.12);
    const earL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), bodyMat);
    earL.position.set(-0.26, 0.74, 0);
    const earR = earL.clone();
    earR.position.x = 0.26;
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), eyeMat);
    eyeL.position.set(-0.08, 0.74, 0.28);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.08;
    g.add(body, head, face, earL, earR, eyeL, eyeR);
    return g;
  }

  /**
   * Spawns a normalized 3D actor rig. Pass `animateRig: true` for characters & Monkemon
   * to enable alternating leg-stride / arm-swing vertex animation + procedural body rig!
   */
  spawnActor({
    glbUrl,
    scale = 1.2,
    primaryColor = '#f59e0b',
    secondaryColor = '#fef3c7',
    shadowRadius = 0.55,
    animateRig = false,
  }) {
    const root = new THREE.Group();
    const animRoot = new THREE.Group();
    const meshHolder = new THREE.Group();
    meshHolder.scale.setScalar(scale);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(shadowRadius * 2.2, shadowRadius * 2.2),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);

    const rigUniforms = {
      uWalkPhase: { value: Math.random() * Math.PI * 2 },
      uWalkAmp: { value: 0.0 },
      uIdleTime: { value: Math.random() * 10.0 },
      uAttackTwist: { value: 0.0 },
    };

    const standIn = this._buildToyStandIn(primaryColor, secondaryColor);
    if (animateRig) {
      standIn.traverse((c) => {
        if (c.isMesh) attachCharacterLimbShader(c, rigUniforms);
      });
    }
    meshHolder.add(standIn);
    animRoot.add(meshHolder);
    root.add(animRoot);

    let ready = false;
    let materialsCloned = animateRig;
    const origEmissive = new Map();

    const recordOrigEmissive = () => {
      origEmissive.clear();
      meshHolder.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m && m.emissive) {
            origEmissive.set(m.uuid, {
              hex: m.emissive.getHex(),
              intensity: m.emissiveIntensity ?? 0,
            });
          }
        }
      });
    };

    const ensureUniqueMaterials = () => {
      if (materialsCloned) {
        if (origEmissive.size === 0) recordOrigEmissive();
        return;
      }
      materialsCloned = true;
      meshHolder.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m ? m.clone() : m));
          } else {
            child.material = child.material.clone();
          }
        }
      });
      recordOrigEmissive();
    };

    const setHitFlash = (strength = 0, hex = 0xffffff) => {
      if (strength <= 0.001 && origEmissive.size === 0) return;
      ensureUniqueMaterials();
      meshHolder.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m || !m.emissive) continue;
          const base = origEmissive.get(m.uuid) || { hex: 0x000000, intensity: 0 };
          if (strength <= 0.001) {
            m.emissive.setHex(base.hex);
            m.emissiveIntensity = base.intensity;
          } else {
            m.emissive.setHex(hex);
            m.emissiveIntensity = base.intensity + strength * 1.15;
          }
        }
      });
    };

    const readyPromise = this.loadPrototype(glbUrl).then((proto) => {
      if (proto) {
        meshHolder.remove(standIn);
        const inst = proto.clone(true);
        if (animateRig) {
          inst.traverse((child) => {
            if (child.isMesh) attachCharacterLimbShader(child, rigUniforms);
          });
          materialsCloned = true;
        } else {
          materialsCloned = false;
        }
        meshHolder.add(inst);
        origEmissive.clear();
        if (animateRig) recordOrigEmissive();
        ready = true;
      }
      return root;
    });

    // Procedural + Shader Character Motion State
    const mState = {
      yaw: 0,
      yawInit: false,
      walkAmp: 0,
      landSquash: 0,
    };

    /**
     * Expressive character animation update for both Overworld walking & Battle combat!
     */
    const updateMotion = (
      dt,
      {
        targetYaw = 0,
        moveSpeed = 0, // world units / sec (0 = idle, ~6.4 = walk, ~9.2 = sprint)
        inBattle = false,
        jumpHeight = 0,
        jumpProg = 0, // 0..1 during [Y] Jump somersault
        dashActive = false, // [A] Monk Run dive-dash
        spinProg = 0, // 0..1 during [B] Fake Out 360° spin-clap
        chompProg = 0, // 0..1 during [X] Eat happy chomp bounce
        specialProg = 0, // 0..1 during [RB] Signature Special roar/cast
        stun = 0,
        hitRecoil = 0, // 0..1 backward flinch
        cheer = 0, // 0..1 coach/victory jump
        landedImpact = false,
      } = {},
    ) => {
      if (!mState.yawInit) {
        mState.yaw = targetYaw;
        mState.yawInit = true;
      } else {
        mState.yaw = lerpAngle(mState.yaw, targetYaw, dt * 14);
      }

      rigUniforms.uIdleTime.value += dt * (inBattle ? 1.45 : 1.0);

      // Desired limb-stride amplitude
      const targetWalkAmp = dashActive
        ? 1.55
        : moveSpeed > 0.25
          ? Math.min(1.38, 0.35 + moveSpeed * 0.115)
          : inBattle && stun <= 0
            ? 0.24 // lively boxer footwork in battle!
            : 0.0;
      mState.walkAmp += (targetWalkAmp - mState.walkAmp) * Math.min(1, dt * 12);
      rigUniforms.uWalkAmp.value = mState.walkAmp;

      // Advance leg-stride phase proportional to speed (or rhythmic footwork in battle)
      if (dashActive) {
        rigUniforms.uWalkPhase.value += dt * 24.0;
      } else if (moveSpeed > 0.25) {
        rigUniforms.uWalkPhase.value += dt * (4.2 + moveSpeed * 1.38);
      } else if (inBattle && stun <= 0) {
        rigUniforms.uWalkPhase.value += dt * 5.6;
      }

      if (landedImpact) {
        mState.landSquash = 0.34;
      } else if (mState.landSquash > 0) {
        mState.landSquash = Math.max(0, mState.landSquash - dt * 2.4);
      }

      const wp = rigUniforms.uWalkPhase.value;
      const idleT = rigUniforms.uIdleTime.value;

      // Vertical hop + squash-and-stretch + pitch/roll choreography
      let posY = jumpHeight;
      let pitchX = 0;
      let rollZ = 0;
      let extraYaw = 0;
      let scaleY = 1.0;
      let twist = 0;

      if (jumpHeight > 0.02 || jumpProg > 0) {
        // [Y] Sky Jump: full 360° forward somersault in the air!
        pitchX = jumpProg * Math.PI * 2;
        scaleY = 1.14;
      } else if (dashActive) {
        // [A] Monk Run: aerodynamic forward sprint-dive!
        posY = Math.abs(Math.sin(wp)) * 0.2;
        pitchX = 0.42;
        scaleY = 0.9;
        twist = Math.sin(wp) * 0.25;
      } else if (spinProg > 0) {
        // [B] Fake Out: cheeky 360° pirouette clap!
        extraYaw = spinProg * Math.PI * 2;
        posY = Math.sin(spinProg * Math.PI) * 0.42;
        scaleY = 1.08;
        twist = Math.sin(spinProg * Math.PI * 2) * 0.45;
      } else if (chompProg > 0) {
        // [X] Eat: 3 happy snack-chomp hops + plump belly squash!
        const hop = Math.abs(Math.sin(chompProg * Math.PI * 3));
        posY = hop * 0.32;
        scaleY = 0.88 + hop * 0.24;
        pitchX = Math.sin(chompProg * Math.PI * 6) * 0.16;
      } else if (specialProg > 0) {
        // [RB] Signature Special: crouch wind-up -> heroic roar!
        if (specialProg < 0.32) {
          const u = specialProg / 0.32;
          scaleY = 1.0 - u * 0.22;
          pitchX = 0.2 * u;
          twist = -0.35 * u;
        } else {
          const u = (specialProg - 0.32) / 0.68;
          posY = Math.sin(u * Math.PI) * 0.36;
          scaleY = 1.18 - u * 0.18;
          pitchX = -0.26 * (1 - u);
          twist = 0.45 * (1 - u);
        }
      } else if (moveSpeed > 0.25) {
        // Expressive Toy-Diorama Walk / Sprint Stride!
        const strideBounce = Math.abs(Math.sin(wp));
        const sprintFactor = Math.min(1, Math.max(0, (moveSpeed - 5.5) / 4.0));
        posY = strideBounce * (0.17 + sprintFactor * 0.08);
        rollZ = Math.sin(wp) * (0.095 + sprintFactor * 0.035); // charming left-right toy waddle
        pitchX = 0.11 + sprintFactor * 0.12; // forward lean into run
        scaleY = 0.94 + strideBounce * 0.11;
      } else if (cheer > 0) {
        const hop = Math.abs(Math.sin(idleT * 11.0));
        posY = hop * 0.32;
        scaleY = 0.92 + hop * 0.16;
        rollZ = Math.sin(idleT * 5.5) * 0.1;
      } else if (inBattle) {
        // Ready-to-brawl rhythmic boxer bounce!
        const b = Math.abs(Math.sin(idleT * 4.6));
        posY = b * 0.12;
        rollZ = Math.sin(idleT * 2.3) * 0.05;
        scaleY = 0.96 + b * 0.07;
      } else {
        // Cozy overworld breathing & gentle bob
        const b = Math.sin(idleT * 2.6);
        posY = Math.max(0, b) * 0.035;
        scaleY = 1.0 + b * 0.025;
        rollZ = Math.sin(idleT * 1.3) * 0.02;
      }

      if (mState.landSquash > 0) {
        scaleY *= 1.0 - mState.landSquash * 0.65;
      }
      if (hitRecoil > 0) {
        pitchX -= hitRecoil * 0.42;
        scaleY *= 1.0 - hitRecoil * 0.14;
      }
      if (stun > 0) {
        rollZ += Math.sin(idleT * 18.0) * 0.2;
        extraYaw += Math.cos(idleT * 14.0) * 0.16;
      }

      rigUniforms.uAttackTwist.value = twist;
      animRoot.position.y = posY;
      animRoot.rotation.set(pitchX, mState.yaw + extraYaw, rollZ, 'YXZ');

      const clampedScaleY = Math.max(0.66, Math.min(1.32, scaleY));
      const invXZ = 1.0 / Math.sqrt(clampedScaleY);
      animRoot.scale.set(invXZ, clampedScaleY, invXZ);

      // Dynamic contact shadow shrinks slightly as character jumps higher
      const shScale = Math.max(0.45, 1.0 - posY * 0.16);
      shadow.scale.setScalar(shScale);
    };

    return {
      root,
      animRoot,
      meshHolder,
      shadow,
      baseScale: scale,
      readyPromise,
      setHitFlash,
      updateMotion,
      rigUniforms,
      get isReady() {
        return ready;
      },
    };
  }
}

let _measureCtx = null;
function getMeasureCtx() {
  if (!_measureCtx) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    _measureCtx = c.getContext('2d');
  }
  return _measureCtx;
}

/**
 * Builds a crisp, auto-sized, collision-free floating 3D `Sprite` enamel signboard
 * (House signboards, Wild Monkemon pills, Trainer names, Gateway markers).
 */
export function makeLabelSprite({
  title,
  subtitle = '',
  badgeText = '',
  badgeColor = '#f59e0b',
  bg = 'rgba(15, 23, 42, 0.92)',
  borderColor = '#fde68a',
  widthWorld = 3.2,
}) {
  const mctx = getMeasureCtx();
  const titleFont = '800 33px system-ui, -apple-system, sans-serif';
  const badgeFont = '800 26px system-ui, -apple-system, sans-serif';
  const subFont = '600 22px system-ui, -apple-system, sans-serif';

  mctx.font = titleFont;
  const titleW = mctx.measureText(title || '').width;

  let badgeW = 0;
  if (badgeText) {
    mctx.font = badgeFont;
    badgeW = Math.ceil(mctx.measureText(badgeText).width + 30);
  }

  let subW = 0;
  if (subtitle) {
    mctx.font = subFont;
    subW = mctx.measureText(subtitle).width;
  }

  const pad = 12;
  const caretH = 14;
  const innerPadX = 24;
  const gap = badgeText ? 16 : 0;
  const topRowNeeded = innerPadX * 2 + badgeW + gap + titleW;
  const subRowNeeded = subtitle ? innerPadX * 2 + subW : 0;
  const neededW = Math.max(380, Math.ceil(Math.max(topRowNeeded, subRowNeeded) + pad * 2));
  const canvasW = Math.min(960, Math.ceil(neededW / 16) * 16);
  const boxH = subtitle ? 124 : 82;
  const canvasH = boxH + pad * 2 + caretH;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  const w = canvasW - pad * 2;
  const h = boxH;
  const r = 26;

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Drop shadow under enamel signboard
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
  ctx.beginPath();
  ctx.roundRect(pad + 2, pad + 5, w, h, r);
  ctx.fill();
  ctx.restore();

  // Main rounded enamel body
  ctx.fillStyle = bg;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.roundRect(pad, pad, w, h, r);
  ctx.fill();
  ctx.stroke();

  // Subtle top toy-gloss sheen
  const sheen = ctx.createLinearGradient(0, pad, 0, pad + h * 0.5);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.roundRect(pad + 3, pad + 3, w - 6, h * 0.48, r - 3);
  ctx.fill();

  // Cute bottom pointer caret
  const cx = canvasW / 2;
  ctx.fillStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(cx - 12, pad + h - 1);
  ctx.lineTo(cx + 12, pad + h - 1);
  ctx.lineTo(cx, pad + h + caretH);
  ctx.closePath();
  ctx.fill();

  const rowY = subtitle ? pad + 41 : pad + h / 2;
  if (badgeText) {
    const groupW = badgeW + gap + titleW;
    const startX = Math.max(pad + 16, (canvasW - groupW) / 2);
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(startX, rowY - 22, badgeW, 44, 15);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = badgeFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, startX + badgeW / 2, rowY + 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = titleFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, startX + badgeW + gap, rowY + 1);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = titleFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, canvasW / 2, rowY + 1);
  }

  if (subtitle) {
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad + 24, pad + 72);
    ctx.lineTo(pad + w - 24, pad + 72);
    ctx.stroke();

    ctx.fillStyle = '#fde68a';
    ctx.font = subFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(subtitle, canvasW / 2, pad + 98);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const baseHeightWorld = (subtitle ? 0.96 : 0.68) * Math.max(0.78, Math.min(1.18, widthWorld / 3.4));
  const computedWidthWorld = Math.max(widthWorld * 0.82, baseHeightWorld * (canvasW / canvasH));
  sprite.scale.set(computedWidthWorld, baseHeightWorld, 1);
  sprite.renderOrder = 12;
  return sprite;
}
