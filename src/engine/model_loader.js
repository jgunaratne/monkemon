// TRELLIS.2 PBR `.glb` Model Loader, Toy-Material Polisher, Nameplate Sprites & Squash-Stretch Actor Rig.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_VERSION } from './audio.js';

function withVer(url) {
  if (!url) return url;
  return url.includes('?') ? url : `${url}?v=${ASSET_VERSION}`;
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
    g.addColorStop(0, 'rgba(10, 18, 28, 0.52)');
    g.addColorStop(0.65, 'rgba(10, 18, 28, 0.22)');
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
                if ('envMapIntensity' in m) m.envMapIntensity = 1.05;
                if ('roughness' in m && typeof m.roughness === 'number') {
                  m.roughness = Math.min(0.78, Math.max(0.22, m.roughness * 0.88));
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

  // Multi-part glossy toy figurine stand-in shown only for the few frames before `.glb` arrives
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
   * Creates a normalized 3D actor rig with contact blob shadow, squash-stretch `animRoot`,
   * and automatic async swap from toy stand-in to the real TRELLIS.2 `.glb` mesh.
   */
  spawnActor({ glbUrl, scale = 1.2, primaryColor = '#f59e0b', secondaryColor = '#fef3c7', shadowRadius = 0.55 }) {
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

    const standIn = this._buildToyStandIn(primaryColor, secondaryColor);
    meshHolder.add(standIn);
    animRoot.add(meshHolder);
    root.add(animRoot);

    let ready = false;
    let materialsCloned = false;
    const origEmissive = new Map();

    const ensureUniqueMaterials = () => {
      if (materialsCloned) return;
      materialsCloned = true;
      meshHolder.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m ? m.clone() : m));
          } else {
            child.material = child.material.clone();
          }
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (m && m.emissive) {
              origEmissive.set(m.uuid, {
                hex: m.emissive.getHex(),
                intensity: m.emissiveIntensity ?? 0,
              });
            }
          }
        }
      });
    };

    const setHitFlash = (strength = 0, hex = 0xffffff) => {
      if (strength <= 0.001 && !materialsCloned) return;
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
        meshHolder.add(inst);
        materialsCloned = false;
        origEmissive.clear();
        ready = true;
      }
      return root;
    });

    return {
      root,
      animRoot,
      meshHolder,
      shadow,
      baseScale: scale,
      readyPromise,
      setHitFlash,
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
    // Divider hairline
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
