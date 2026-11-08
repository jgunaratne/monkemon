// Battle attack VFX shaders for the side-view (Pokémon-style) battle camera.
// Everything here is a camera-facing quad ("billboard") driven by a small ShaderMaterial, so
// effects read clearly from the low, close battle camera and never draw rings on the floor:
//   • Hit burst   — flash core + expanding ring + starburst rays + sparks on the defender
//   • Energy orb  — glowing elemental projectile with a comet tail, flown attacker → defender
//   • Slash arc   — crescent swipe for physical strikes (Monk Run, Fake Out)
//   • Shock ring  — single expanding ring (clap / slam shock), vertical and camera-facing
// Each material exposes `uProgress` (0..1 lifetime), most also `uTime`; colours are passed in
// as hex strings. `orientBillboard()` keeps a mesh facing the camera each frame.

import * as THREE from 'three';

const SHARED_QUAD_GEO = new THREE.PlaneGeometry(1, 1);

const GLSL_NOISE = /* glsl */ `
  float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fxNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x),
      mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
`;

const BILLBOARD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function makeFxMaterial(uniforms, fragmentShader) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: BILLBOARD_VERT,
    fragmentShader,
  });
}

/** Flash + ring + rays burst that plays on the defender when a hit lands. */
export function createHitBurstShaderMaterial({ color = '#fde047', accentColor = '#ffffff', seed = 0 } = {}) {
  return makeFxMaterial(
    {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAccent: { value: new THREE.Color(accentColor) },
      uSeed: { value: seed },
    },
    /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uAccent;
      uniform float uSeed;
      varying vec2 vUv;

      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q);
        if (r > 1.0) discard;
        float a = atan(q.y, q.x);
        float p = clamp(uProgress, 0.0, 1.0);

        // 1. White-hot flash core that collapses in the first third
        float coreR = 0.55 * (1.0 - p) + 0.04;
        float core = smoothstep(coreR, 0.0, r) * (1.0 - smoothstep(0.0, 0.42, p));

        // 2. Expanding shock ring
        float ringR = 0.10 + p * 0.86;
        float ring = smoothstep(0.10, 0.0, abs(r - ringR)) * (1.0 - smoothstep(0.35, 1.0, p));

        // 3. Eight starburst rays that stretch out then fade
        float rays = pow(max(0.0, cos(a * 4.0 + uSeed)), 16.0)
          * smoothstep(0.2 + p * 0.9, 0.0, r) * (1.0 - smoothstep(0.2, 0.75, p));

        // 4. Sparks riding just inside the ring
        float sparks = pow(max(0.0, sin(a * 11.0 + uSeed * 3.1)), 28.0)
          * smoothstep(0.07, 0.0, abs(r - ringR * 0.9)) * (1.0 - smoothstep(0.25, 0.9, p));

        float alpha = core * 1.3 + ring * 1.05 + rays * 0.95 + sparks * 1.3;
        if (alpha < 0.01) discard;
        vec3 col = mix(uColor, uAccent, clamp(core * 1.4 + rays * 0.6, 0.0, 1.0));
        gl_FragColor = vec4(col * 1.6, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  );
}

/**
 * Glowing elemental projectile. `uDir` is the travel direction in the quad's own plane
 * (screen space, since the quad is billboarded) so the comet tail streams out behind it.
 */
export function createEnergyOrbShaderMaterial({ color = '#38bdf8', coreColor = '#ffffff' } = {}) {
  return makeFxMaterial(
    {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(coreColor) },
    },
    /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform vec2 uDir;
      uniform vec3 uColor;
      uniform vec3 uCore;
      varying vec2 vUv;
      ${GLSL_NOISE}

      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q);
        float along = dot(q, uDir);                 // > 0 ahead of the orb, < 0 behind it
        float across = dot(q, vec2(-uDir.y, uDir.x));

        float core = smoothstep(0.36, 0.0, r);
        float halo = smoothstep(0.95, 0.08, r) * 0.5;
        // Comet tail: narrow gaussian across, exponential falloff behind, flickering noise
        float behind = max(0.0, -along);
        float tail = exp(-across * across * 11.0) * exp(-behind * 2.1) * step(along, 0.0);
        float n = fxNoise(q * 4.5 + vec2(uTime * 7.0, -uTime * 5.0));
        float flicker = 0.78 + 0.22 * sin(uTime * 38.0 + n * 6.2832);
        float life = smoothstep(0.0, 0.08, uProgress) * (1.0 - smoothstep(0.88, 1.0, uProgress));

        float alpha = (core * 1.5 + halo + tail * (0.55 + 0.45 * n)) * flicker * life;
        if (alpha < 0.01) discard;
        vec3 col = mix(uColor, uCore, smoothstep(0.26, 0.0, r));
        gl_FragColor = vec4(col * 1.7, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  );
}

/** Crescent swipe for physical strikes. `flip` mirrors the sweep direction (-1 | 1). */
export function createSlashArcShaderMaterial({ color = '#fef08a', accentColor = '#ffffff', flip = 1 } = {}) {
  return makeFxMaterial(
    {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAccent: { value: new THREE.Color(accentColor) },
      uFlip: { value: flip },
    },
    /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uAccent;
      uniform float uFlip;
      varying vec2 vUv;

      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q);
        if (r > 1.0) discard;
        float a = atan(q.y, q.x);
        float p = clamp(uProgress, 0.0, 1.0);

        // The head of the slash sweeps from top-left to bottom-right (or mirrored)
        float head = mix(2.5, -2.5, p) * uFlip;
        float behindHead = (a - head) * uFlip;      // radians behind the head
        float band = smoothstep(0.17, 0.0, abs(r - 0.6)) + smoothstep(0.08, 0.0, abs(r - 0.6)) * 0.6;
        float trail = smoothstep(0.0, 0.05, behindHead) * smoothstep(2.1, 0.15, behindHead);
        float hot = smoothstep(2.1, 0.0, behindHead);
        float fade = 1.0 - smoothstep(0.5, 1.0, p);

        float alpha = band * trail * fade * (0.45 + 0.55 * hot);
        if (alpha < 0.01) discard;
        vec3 col = mix(uColor, uAccent, pow(hot, 3.0));
        gl_FragColor = vec4(col * 1.7, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  );
}

/** Single clean expanding ring (clap / slam shock), drawn vertically on a billboard. */
export function createShockRingShaderMaterial({ color = '#e9d5ff', accentColor = '#ffffff' } = {}) {
  return makeFxMaterial(
    {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAccent: { value: new THREE.Color(accentColor) },
    },
    /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uAccent;
      varying vec2 vUv;

      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q);
        if (r > 1.0) discard;
        float p = clamp(uProgress, 0.0, 1.0);
        float ringR = 0.05 + p * 0.92;
        float width = 0.05 + p * 0.1;
        float ring = smoothstep(width, 0.0, abs(r - ringR));
        float echo = smoothstep(width * 0.6, 0.0, abs(r - ringR * 0.72)) * 0.5;
        float fade = 1.0 - smoothstep(0.3, 1.0, p);
        float alpha = (ring * 1.2 + echo) * fade;
        if (alpha < 0.01) discard;
        vec3 col = mix(uColor, uAccent, ring * 0.6);
        gl_FragColor = vec4(col * 1.5, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  );
}

/** A unit quad mesh using `material`, scaled to `size` world units, ready to be billboarded. */
export function makeBillboardQuad(material, size = 1) {
  const mesh = new THREE.Mesh(SHARED_QUAD_GEO, material);
  mesh.scale.setScalar(size);
  mesh.renderOrder = 20;
  mesh.frustumCulled = false;
  return mesh;
}

/** Point a billboard at the camera (call every frame). */
export function orientBillboard(mesh, camera) {
  if (mesh && camera) mesh.quaternion.copy(camera.quaternion);
}

/** Direction from `fromWorld` to `toWorld` as seen on screen (x right, y up), for orb tails. */
export function screenSpaceDirection(fromWorld, toWorld, camera, out = new THREE.Vector2(1, 0)) {
  if (!camera) return out.set(1, 0);
  const a = fromWorld.clone().project(camera);
  const b = toWorld.clone().project(camera);
  out.set(b.x - a.x, b.y - a.y);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(1, 0);
}
