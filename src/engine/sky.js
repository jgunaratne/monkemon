// Procedural Sky, Volumetric-Look Cumulus Clouds & Horizon Islands for Monkemon 2.5D
// - `createSkyDome`: camera-following BackSide sphere with zenith/horizon gradient, sun disc + Mie halo,
//   and a domain-warped FBM cumulus layer (self-shadowed towards the sun) projected at cloud altitude.
//   Also used as the PMREM environment source so PBR reflections match each island's sky.
// - `createCloudField`: drifting low-poly "cotton" cumulus meshes (merged noise-displaced icospheres)
//   with wrap lighting, silver-lining rim and real shadow casting onto the island below.
// - `createDistantIslands`: fogged silhouette islets ringing the horizon for aerial-perspective depth.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, getZoneAtmosphere } from './atmosphere.js';

const SKY_RADIUS = 150;

/** Camera -> hero sight line shared by every cloud material (updated once per frame by the renderer). */
export const CLOUD_SIGHT_UNIFORMS = {
  a: { value: new THREE.Vector3(0, 50, 0) },
  b: { value: new THREE.Vector3(0, 50, 1) },
};

export function createSkyDome(theme = 'tropical') {
  const atmo = getZoneAtmosphere(theme);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // Drawn LAST among opaques at depth 1.0 so early-z rejects every pixel already covered by the island:
    // the expensive FBM cloud shader only runs on visible sky pixels.
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new THREE.Color(atmo.zenith) },
      uHorizon: { value: new THREE.Color(atmo.horizon) },
      uFogColor: { value: new THREE.Color(atmo.horizon) },
      uSunGlow: { value: new THREE.Color(atmo.sunGlow) },
      uCloudTint: { value: new THREE.Color(atmo.cloudTint) },
      uCloudShade: { value: new THREE.Color(atmo.cloudShade) },
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
      uCoverage: { value: atmo.cloudCoverage },
      uCloudHeight: { value: atmo.cloudHeight },
      uCloudDetail: { value: 1.0 },
      uEnvCapture: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = wp.xyz - cameraPosition;
        vec4 clip = projectionMatrix * viewMatrix * wp;
        // Pin the dome to the far plane so it never fights with scene depth
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uFogColor;
      uniform vec3 uSunGlow;
      uniform vec3 uCloudTint;
      uniform vec3 uCloudShade;
      uniform vec3 uSunDir;
      uniform float uCoverage;
      uniform float uCloudHeight;
      uniform float uCloudDetail;
      uniform float uEnvCapture;
      varying vec3 vWorldDir;
      ${GLSL_NOISE}

      void main() {
        vec3 d = normalize(vWorldDir);
        float h = d.y;

        // Rayleigh-ish gradient: bright haze at the horizon, saturated zenith overhead
        float t = pow(clamp(h, 0.0, 1.0), 0.58);
        vec3 col = mix(uHorizon, uZenith, t);
        // Warm scattering band around the sun azimuth near the horizon
        float sunAz = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
        col = mix(col, uSunGlow, pow(sunAz, 6.0) * (1.0 - smoothstep(0.0, 0.32, h)) * 0.28);
        // Below the horizon fade into the fog colour so the ocean plane edge is invisible
        col = mix(uFogColor, col, smoothstep(-0.03, 0.05, h));

        // Sun disc + Mie halo
        float sd = max(dot(d, uSunDir), 0.0);
        // (the sun disc is dimmed while baking the PMREM so IBL stays soft and the DirectionalLight owns the key light)
        float sunScale = mix(1.0, 0.12, uEnvCapture);
        col += uSunGlow * (pow(sd, 1600.0) * 9.0 * sunScale + pow(sd, 64.0) * 0.6 * sunScale + pow(sd, 7.0) * 0.14);

        // Cumulus layer projected onto the plane y = uCloudHeight
        if (h > 0.012) {
          float dist = uCloudHeight / h;
          vec2 cp = d.xz * dist;
          float dens = mkCloudDensity(cp, uTime, uCoverage);
          if (dens > 0.001) {
            // Cheap self-shadowing: denser cloud between this point and the sun => darker base
            vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 46.0;
            float densSun = mkCloudDensity(cp + toSun, uTime, uCoverage);
            float shade = clamp(densSun * 0.75 - dens * 0.25, 0.0, 1.0);
            float puff = mkFbm3(cp * 0.05 + uTime * 0.02) * uCloudDetail;
            vec3 cloudCol = mix(uCloudTint, uCloudShade, shade * 0.85);
            cloudCol *= 0.92 + 0.16 * puff;
            // Silver lining when looking towards the sun through thin edges
            float thin = (1.0 - dens) * dens * 4.0;
            cloudCol += uSunGlow * pow(sd, 12.0) * thin * 0.9;
            float horizonFade = smoothstep(0.012, 0.11, h);
            col = mix(col, cloudCol, dens * horizonFade);
          }
        }

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 28), mat);
  dome.name = 'MonkeSkyDome';
  dome.frustumCulled = false;
  dome.renderOrder = 1000;
  dome.matrixAutoUpdate = true;
  dome.userData.isSkyDome = true;
  dome.userData.keepInBattle = true;

  dome.userData.applyAtmosphere = (atmoIn, { skyColor, fogColor, sunDir } = {}) => {
    const a = atmoIn || atmo;
    const u = mat.uniforms;
    u.uZenith.value.set(a.zenith);
    u.uHorizon.value.set(skyColor || a.horizon);
    u.uFogColor.value.set(fogColor || skyColor || a.horizon);
    u.uSunGlow.value.set(a.sunGlow);
    u.uCloudTint.value.set(a.cloudTint);
    u.uCloudShade.value.set(a.cloudShade);
    u.uCoverage.value = a.cloudCoverage;
    u.uCloudHeight.value = a.cloudHeight;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
  };
  dome.userData.setTime = (t) => {
    mat.uniforms.uTime.value = t;
  };
  dome.userData.setDetail = (v) => {
    mat.uniforms.uCloudDetail.value = v;
  };
  dome.userData.setEnvCapture = (on) => {
    mat.uniforms.uEnvCapture.value = on ? 1.0 : 0.0;
  };
  return dome;
}

// ---------------------------------------------------------------------------------------------
// 3D Cumulus Cloud Meshes
// ---------------------------------------------------------------------------------------------

function hash3(x, y, z) {
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
  const lerp = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/**
 * Builds one cumulus cloud: 6–10 overlapping icospheres along an elongated axis, flattened base,
 * noise-displaced along normals for cauliflower fluff. Returns a merged, smooth-normal geometry.
 */
export function makeCumulusGeometry(rand, detail = 2) {
  const parts = [];
  const puffCount = 6 + Math.floor(rand() * 5);
  const length = 2.6 + rand() * 2.2;
  for (let i = 0; i < puffCount; i++) {
    const u = puffCount === 1 ? 0.5 : i / (puffCount - 1);
    const along = (u - 0.5) * length;
    const envelope = Math.sin(u * Math.PI) * 0.6 + 0.4;
    const r = (0.75 + rand() * 0.65) * envelope + 0.35;
    const geo = new THREE.IcosahedronGeometry(r, detail);
    geo.translate(along + (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.35 + r * 0.28, (rand() - 0.5) * 0.9);
    parts.push(geo);
  }
  // Extra top-knot puffs for a billowing silhouette
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const r = 0.55 + rand() * 0.5;
    const geo = new THREE.IcosahedronGeometry(r, detail);
    geo.translate((rand() - 0.5) * length * 0.6, 0.55 + rand() * 0.6, (rand() - 0.5) * 0.6);
    parts.push(geo);
  }
  // Polyhedron geometries are non-indexed (flat per-face normals): weld shared vertices first so the puffs get
  // smooth rounded shading and the noise displacement below cannot crack the surface between faces.
  // (mergeVertices hashes every attribute, so the per-face normals/uvs must go first; the cloud shader uses neither.)
  const raw = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const merged = mergeVertices(raw, 1e-4);
  raw.dispose();
  merged.computeVertexNormals();

  const pos = merged.attributes.position;
  const nrm = merged.attributes.normal;
  const seed = rand() * 100;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // Flatten the underside so clouds sit on an invisible "air shelf"
    if (y < -0.1) y = -0.1 + (y + 0.1) * 0.28;
    const n = smoothNoise3(x * 1.7 + seed, y * 1.7, z * 1.7) * 0.6 + smoothNoise3(x * 4.1, y * 4.1 + seed, z * 4.1) * 0.4;
    const disp = (n - 0.5) * 0.34;
    x += nrm.getX(i) * disp;
    y += nrm.getY(i) * disp * 0.8;
    z += nrm.getZ(i) * disp;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function createCloudMaterial(theme = 'tropical') {
  const atmo = getZoneAtmosphere(theme);
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(atmo.cloudTint) },
        uShade: { value: new THREE.Color(atmo.cloudShade) },
        uSunColor: { value: new THREE.Color(atmo.sunGlow) },
        uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
        uSightA: { value: new THREE.Vector3(0, 50, 0) },
        uSightB: { value: new THREE.Vector3(0, 50, 1) },
        uSightFade: { value: 1.0 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vWp;
      varying vec3 vLocal;
      void main() {
        vec3 p = position;
        float breathe = sin(uTime * 0.7 + position.x * 1.4 + position.z * 0.9) * 0.5 + 0.5;
        p += normal * breathe * 0.05;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWp = wp.xyz;
        vLocal = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uTint;
      uniform vec3 uShade;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uSightA;
      uniform vec3 uSightB;
      uniform float uSightFade;
      varying vec3 vN;
      varying vec3 vWp;
      varying vec3 vLocal;
      ${GLSL_NOISE}

      float mkSegDist(vec3 p, vec3 a, vec3 b) {
        vec3 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
        return length(p - (a + ab * t));
      }

      void main() {
        // Dithered fade-out when a cloud drifts across the camera -> hero sight line (shadows keep casting)
        if (uSightFade > 0.5) {
          float sd = mkSegDist(vWp, uSightA, uSightB);
          float keep = smoothstep(3.2, 8.5, sd);
          if (keep < 0.999 && mkHash21(gl_FragCoord.xy + fract(vWp.x) * 17.0) > keep) discard;
        }
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWp);
        float ndl = dot(N, uSunDir);
        // Wrap lighting approximates multiple scattering inside the puff
        float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
        float upness = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        float heightShade = smoothstep(-0.6, 1.2, vLocal.y);
        float tex = mkFbm3(vWp.xz * 0.85 + vWp.y * 0.6);
        vec3 base = mix(uShade, uTint, clamp(upness * 0.55 + heightShade * 0.45, 0.0, 1.0));
        vec3 col = base * (0.58 + 0.42 * wrap) * (0.9 + 0.22 * tex);
        col += uSunColor * pow(wrap, 3.0) * 0.32;
        // Silver lining rim when the sun is behind the cloud relative to the viewer
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
        float back = clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        col += uSunColor * rim * (0.25 + back * 0.95);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  // Share (not clone) the sight-line uniforms so the renderer can update all cloud materials at once
  material.uniforms.uSightA = CLOUD_SIGHT_UNIFORMS.a;
  material.uniforms.uSightB = CLOUD_SIGHT_UNIFORMS.b;
  return material;
}

/**
 * Drifting cumulus field above an island. Returns `{ group, update(t, dt), material }`.
 */
export function createCloudField({
  theme = 'tropical',
  halfW = 30,
  halfD = 26,
  rand = Math.random,
  count = null,
  minY = 8.5,
  maxY = 14.5,
  castShadows = true,
  detail = 2,
}) {
  const atmo = getZoneAtmosphere(theme);
  const group = new THREE.Group();
  group.name = 'MonkeCloudField';
  group.userData.keepInBattle = true;
  const material = createCloudMaterial(theme);
  const n = count == null ? atmo.cloudMeshCount : count;
  const spanX = halfW + 26;
  const spanZ = halfD + 22;
  const windDir = new THREE.Vector2(Math.cos(0.42), Math.sin(0.42)).normalize();
  const clouds = [];
  for (let i = 0; i < n; i++) {
    const geo = makeCumulusGeometry(rand, detail);
    const mesh = new THREE.Mesh(geo, material);
    const s = 1.35 + rand() * 1.45;
    mesh.scale.set(s * (1.0 + rand() * 0.5), s * 0.78, s * (0.85 + rand() * 0.3));
    mesh.position.set((rand() * 2 - 1) * spanX, minY + rand() * (maxY - minY), (rand() * 2 - 1) * spanZ);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.castShadow = castShadows;
    mesh.receiveShadow = false;
    mesh.userData.keepInBattle = true;
    mesh.userData.isCloud = true;
    group.add(mesh);
    clouds.push({ mesh, speed: 0.28 + rand() * 0.24, bob: rand() * Math.PI * 2 });
  }

  const update = (t, dt) => {
    material.uniforms.uTime.value = t;
    for (const c of clouds) {
      const m = c.mesh;
      m.position.x += windDir.x * c.speed * dt;
      m.position.z += windDir.y * c.speed * dt;
      m.position.y += Math.sin(t * 0.35 + c.bob) * 0.0025;
      if (m.position.x > spanX) m.position.x = -spanX;
      if (m.position.z > spanZ) m.position.z = -spanZ;
      if (m.position.x < -spanX) m.position.x = spanX;
      if (m.position.z < -spanZ) m.position.z = spanZ;
    }
  };

  const setSunDir = (dir) => {
    material.uniforms.uSunDir.value.copy(dir).normalize();
  };
  const setSightLine = (camPos, target) => {
    material.uniforms.uSightA.value.copy(camPos);
    material.uniforms.uSightB.value.copy(target);
  };

  return { group, update, material, setSunDir, setSightLine };
}

// ---------------------------------------------------------------------------------------------
// Horizon Islands (aerial perspective depth for the title / low cinematic camera)
// ---------------------------------------------------------------------------------------------

export function createDistantIslands({
  theme = 'tropical',
  halfW = 30,
  halfD = 26,
  rand = Math.random,
  count = 6,
  waterY = -0.82,
  cliffColor = '#9a7b5a',
  topColor = '#4f9b45',
}) {
  const group = new THREE.Group();
  group.name = 'MonkeHorizonIslands';
  group.userData.keepInBattle = true;
  const isVolcano = theme === 'volcano';
  const isSnow = theme === 'snow';
  const rockMat = new THREE.MeshStandardMaterial({
    color: isVolcano ? '#4a3a36' : isSnow ? '#8fa3b8' : cliffColor,
    roughness: 0.92,
    flatShading: true,
  });
  const topMat = new THREE.MeshStandardMaterial({
    color: isVolcano ? '#6b3f2a' : isSnow ? '#eef4ff' : topColor,
    roughness: 0.88,
    flatShading: true,
  });

  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rand() * 0.6;
    const radius = 78 + rand() * 42;
    const cx = Math.cos(ang) * radius;
    const cz = Math.sin(ang) * radius;
    const w = 9 + rand() * 13;
    const d = 7 + rand() * 10;
    const pts = [];
    const segs = 22;
    const a2 = 0.08 + rand() * 0.12;
    const a3 = 0.06 + rand() * 0.1;
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const r = 0.95 + a2 * Math.cos(2 * th + rand() * 0.3) + a3 * Math.sin(3 * th);
      pts.push(new THREE.Vector2(Math.cos(th) * w * r, -Math.sin(th) * d * r));
    }
    const shape = new THREE.Shape(pts);
    shape.closePath();
    const baseGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.4 + rand() * 1.2, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 0.6, bevelSegments: 2 });
    baseGeo.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(baseGeo, rockMat);
    base.position.set(cx, waterY - 0.3, cz);
    group.add(base);

    const peaks = 2 + Math.floor(rand() * 3);
    for (let p = 0; p < peaks; p++) {
      const ph = 3.5 + rand() * (isVolcano ? 11 : 7.5);
      const pr = Math.min(w, d) * (0.35 + rand() * 0.35);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(pr, ph, 7), p === 0 && !isVolcano ? topMat : rockMat);
      peak.position.set(cx + (rand() - 0.5) * w * 0.9, waterY + ph * 0.45, cz + (rand() - 0.5) * d * 0.9);
      peak.rotation.y = rand() * Math.PI;
      group.add(peak);
      if (!isVolcano) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(pr * 0.72, ph * 0.5, 7), topMat);
        cap.position.copy(peak.position);
        cap.position.y += ph * 0.3;
        cap.rotation.y = peak.rotation.y;
        group.add(cap);
      }
    }
  }
  return group;
}
