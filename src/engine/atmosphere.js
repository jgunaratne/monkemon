// Shared Atmosphere Presets + GLSL Noise / Cloud Chunks for Monkemon 2.5D
// - `ZONE_ATMOSPHERES`: per-theme sun direction, sky gradient, cloud, fog & exposure presets
//   consumed by `DioramaRenderer`, `sky.js`, the terrain shaders and the ocean shader so that
//   sun glints, cloud shadows, fog colour and the sky dome all agree with each other.
// - `GLSL_NOISE`: hash / value noise / fbm / domain-warped cloud density shared by every shader.

import * as THREE from 'three';

export const ZONE_ATMOSPHERES = {
  tropical: {
    sunOffset: [16, 28, 18],
    sunColor: '#fff4d6',
    sunIntensity: 2.28,
    hemiSky: '#dff4ff',
    hemiGround: '#5c8c46',
    rimColor: '#bae6fd',
    rimIntensity: 0.68,
    zenith: '#2f7fd8',
    horizon: '#bfe9ff',
    sunGlow: '#fff1c2',
    cloudTint: '#ffffff',
    cloudShade: '#8ea2c8',
    cloudCoverage: 0.46,
    cloudHeight: 420,
    cloudMeshCount: 9,
    hazeDensity: 0.0022,
    mistDensity: 0.009,
    mistHeight: 0.7,
    mistColor: '#e4f6ff',
    fogSunTint: '#ffe6b0',
    exposure: 1.08,
    environmentIntensity: 0.78,
  },
  forest: {
    sunOffset: [14, 26, 20],
    sunColor: '#fef08a',
    sunIntensity: 2.3,
    hemiSky: '#fef9c3',
    hemiGround: '#3f6212',
    rimColor: '#86efac',
    rimIntensity: 0.72,
    zenith: '#3b86cf',
    horizon: '#d6f2d8',
    sunGlow: '#fff4b8',
    cloudTint: '#fffdf2',
    cloudShade: '#9aa89c',
    cloudCoverage: 0.4,
    cloudHeight: 380,
    cloudMeshCount: 7,
    hazeDensity: 0.0025,
    mistDensity: 0.012,
    mistHeight: 0.8,
    mistColor: '#eaf7d8',
    fogSunTint: '#ffe9a8',
    exposure: 1.1,
    environmentIntensity: 0.74,
  },
  harbor: {
    sunOffset: [18, 24, 16],
    sunColor: '#fff7e6',
    sunIntensity: 2.22,
    hemiSky: '#dbeafe',
    hemiGround: '#64748b',
    rimColor: '#93c5fd',
    rimIntensity: 0.7,
    zenith: '#2563b8',
    horizon: '#c7e4fb',
    sunGlow: '#ffeec9',
    cloudTint: '#ffffff',
    cloudShade: '#8b9bb5',
    cloudCoverage: 0.52,
    cloudHeight: 450,
    cloudMeshCount: 10,
    hazeDensity: 0.0024,
    mistDensity: 0.01,
    mistHeight: 0.7,
    mistColor: '#e2f0fb',
    fogSunTint: '#ffe2b8',
    exposure: 1.06,
    environmentIntensity: 0.76,
  },
  snow: {
    sunOffset: [10, 30, 20],
    sunColor: '#ffffff',
    sunIntensity: 2.15,
    hemiSky: '#e0f2fe',
    hemiGround: '#94a3b8',
    rimColor: '#7dd3fc',
    rimIntensity: 0.78,
    zenith: '#4d8fd6',
    horizon: '#e8f4ff',
    sunGlow: '#ffffff',
    cloudTint: '#ffffff',
    cloudShade: '#a9b8cf',
    cloudCoverage: 0.5,
    cloudHeight: 400,
    cloudMeshCount: 8,
    hazeDensity: 0.0028,
    mistDensity: 0.014,
    mistHeight: 0.85,
    mistColor: '#eef6ff',
    fogSunTint: '#fff6e0',
    exposure: 1.02,
    environmentIntensity: 0.82,
  },
  volcano: {
    sunOffset: [22, 17, 14],
    sunColor: '#ffd9b0',
    sunIntensity: 2.05,
    hemiSky: '#ffe4e6',
    hemiGround: '#7c2d12',
    rimColor: '#fb923c',
    rimIntensity: 0.92,
    zenith: '#6d3a5a',
    horizon: '#ffb4a8',
    sunGlow: '#ffb070',
    cloudTint: '#ffd3c2',
    cloudShade: '#5c3340',
    cloudCoverage: 0.58,
    cloudHeight: 360,
    cloudMeshCount: 7,
    hazeDensity: 0.0032,
    mistDensity: 0.014,
    mistHeight: 0.8,
    mistColor: '#ffd1c4',
    fogSunTint: '#ffa860',
    exposure: 1.05,
    environmentIntensity: 0.7,
  },
  desert: {
    sunOffset: [20, 28, 14],
    sunColor: '#fff2c6',
    sunIntensity: 2.35,
    hemiSky: '#fef3c7',
    hemiGround: '#b45309',
    rimColor: '#fde68a',
    rimIntensity: 0.72,
    zenith: '#2563eb',
    horizon: '#fde68a',
    sunGlow: '#fde047',
    cloudTint: '#fffbeb',
    cloudShade: '#b49a78',
    cloudCoverage: 0.24,
    cloudHeight: 460,
    cloudMeshCount: 5,
    hazeDensity: 0.002,
    mistDensity: 0.006,
    mistHeight: 0.6,
    mistColor: '#fef3c7',
    fogSunTint: '#fde047',
    exposure: 1.08,
    environmentIntensity: 0.8,
  },
  sky: {
    sunOffset: [14, 30, 18],
    sunColor: '#fef9c3',
    sunIntensity: 2.25,
    hemiSky: '#e0e7ff',
    hemiGround: '#4338ca',
    rimColor: '#a5b4fc',
    rimIntensity: 0.85,
    zenith: '#0f172a',
    horizon: '#312e81',
    sunGlow: '#fef08a',
    cloudTint: '#f8fafc',
    cloudShade: '#6366f1',
    cloudCoverage: 0.36,
    cloudHeight: 440,
    cloudMeshCount: 8,
    hazeDensity: 0.0018,
    mistDensity: 0.006,
    mistHeight: 0.6,
    mistColor: '#c7d2fe',
    fogSunTint: '#fef08a',
    exposure: 1.08,
    environmentIntensity: 0.82,
  },
};

export function getZoneAtmosphere(theme) {
  return ZONE_ATMOSPHERES[theme] || ZONE_ATMOSPHERES.tropical;
}

export function getSunDirection(theme, target = new THREE.Vector3()) {
  const a = getZoneAtmosphere(theme);
  return target.set(a.sunOffset[0], a.sunOffset[1], a.sunOffset[2]).normalize();
}

/**
 * Shared GLSL noise toolkit. Prefixed `mk` so it never collides with Three.js chunk symbols.
 * Inject with `${GLSL_NOISE}` at the top of a fragment/vertex shader body.
 */
export const GLSL_NOISE = /* glsl */ `
  float mkHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec2 mkHash22(vec2 p) {
    float n = mkHash21(p);
    return vec2(n, mkHash21(p + n + 17.17));
  }
  float mkNoise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mkHash21(i);
    float b = mkHash21(i + vec2(1.0, 0.0));
    float c = mkHash21(i + vec2(0.0, 1.0));
    float d = mkHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float mkFbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += amp * mkNoise2D(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }
  float mkFbm3(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += amp * mkNoise2D(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }
  // Domain-warped cumulus cloud density in [0,1] for a world-space XZ position on the cloud layer.
  // The SAME function drives the sky dome clouds and the drifting cloud-dapple on terrain & water.
  float mkCloudDensity(vec2 xz, float t, float coverage) {
    vec2 p = xz * 0.0105 + vec2(t * 0.0115, t * 0.0048);
    vec2 warp = vec2(mkFbm3(p * 1.9 + 3.1), mkFbm3(p * 1.9 - 2.3)) - 0.5;
    float n = mkFbm(p + warp * 0.42);
    float edge0 = 1.0 - coverage * 0.95;
    return smoothstep(edge0, edge0 + 0.33, n);
  }
`;

/** Returns a 0..1 shadow factor from the cloud layer (1 = fully sunlit). */
export const GLSL_CLOUD_SHADOW = /* glsl */ `
  float mkCloudShadow(vec2 worldXZ, float t, float coverage, float strength) {
    float d = mkCloudDensity(worldXZ, t, coverage);
    return 1.0 - d * strength;
  }
`;
