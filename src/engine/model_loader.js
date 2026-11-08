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
    const readyPromise = this.loadPrototype(glbUrl).then((proto) => {
      if (proto) {
        meshHolder.remove(standIn);
        const inst = proto.clone(true);
        meshHolder.add(inst);
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
      get isReady() {
        return ready;
      },
    };
  }
}

/**
 * Builds a crisp rounded floating 3D `Sprite` label (House signboards, Wild Monkemon pills, Trainer names).
 */
export function makeLabelSprite({
  title,
  subtitle = '',
  badgeText = '',
  badgeColor = '#f59e0b',
  bg = 'rgba(15, 23, 42, 0.88)',
  borderColor = '#fde68a',
  widthWorld = 3.2,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = subtitle ? 148 : 104;
  const ctx = canvas.getContext('2d');

  const pad = 12;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const r = 28;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.roundRect(pad, pad, w, h, r);
  ctx.fill();
  ctx.stroke();

  let textX = canvas.width / 2;
  if (badgeText) {
    ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
    const bw = Math.min(180, ctx.measureText(badgeText).width + 28);
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(pad + 14, pad + 16, bw, 46, 16);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, pad + 14 + bw / 2, pad + 39);
    textX = pad + 18 + bw + (w - bw - 26) / 2;
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, textX, subtitle ? pad + 42 : canvas.height / 2);

  if (subtitle) {
    ctx.fillStyle = '#fde68a';
    ctx.font = '600 23px system-ui, -apple-system, sans-serif';
    ctx.fillText(subtitle, canvas.width / 2, pad + 92);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.height / canvas.width;
  sprite.scale.set(widthWorld, widthWorld * aspect, 1);
  sprite.renderOrder = 12;
  return sprite;
}
