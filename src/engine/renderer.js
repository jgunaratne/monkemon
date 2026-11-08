// 2.5D Toy-Diorama Realistic WebGL Renderer (Three.js r170)
// - Elevated 2.5D tabletop-miniature perspective camera (`FOV 30°`, wide 42° cinematic title lens) with smooth damping
// - Realistic lighting rig:
//     1. PMREM environment generated LIVE from the procedural zone sky dome (reflections match each island's sky)
//     2. `HemisphereLight` sky/ground ambient bounce
//     3. `DirectionalLight` golden sun with texel-snapped `PCFSoftShadowMap` (2048², 4096² on ultra) tracking the player
//     4. `DirectionalLight` cool rim backlight (`rimLight`) + dynamic `PointLight` (`fxLight`) for spells & shrines
// - Quality tiers (`?gfx=low|high|ultra`, auto: `low` on SwiftShader, `high` on GPUs):
//     low   : direct render, MSAA, no post (unchanged headless-safe path)
//     high  : HDR scene target + depth → UnrealBloom → MonkeGradePass (depth-based bokeh DoF fused with the
//             miniature tilt band, impact radial blur, analytic exponential height fog & sun-tinted aerial haze,
//             chromatic aberration, split-toning, vignette, grain, ACES) → SMAA → screen, plus half-res planar
//             ocean reflections and 3D cloud shadows
//     ultra : + GTAO ambient occlusion, 4096² shadows, 75% reflections, denser foliage
// - Automatically paces SwiftShader software WebGL with `fenceSync`-style readbacks so headless Chrome renders fast.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLSL_NOISE, getZoneAtmosphere } from './atmosphere.js';
import { FOLIAGE_SIGHT_UNIFORMS } from './shaders.js';
import { CLOUD_SIGHT_UNIFORMS, createSkyDome } from './sky.js';
import { PlanarReflection, REFLECTION_LAYER } from './reflection.js';

export const QUALITY_PRESETS = {
  low: {
    post: false,
    bloom: false,
    dof: false,
    fog: false,
    smaa: false,
    gtao: false,
    reflections: false,
    reflectionScale: 0,
    shadowRes: 2048,
    hexTiling: false,
    ormMaps: false,
    textureDir: '1k',
    grassScale: 1.0,
    grassBlades: 'lite',
    treeDensity: 0.55,
    cloudDetail: 1,
    waterSegs: 40,
    waterQuality: 0,
    maxPixelRatio: 1,
    dofTaps: 0,
    fogNear: 95,
    fogFar: 195,
  },
  // Phones / tablets: direct render (no post chain), 1k textures, single-sample terrain, light foliage, 1024 PCF shadows
  mobile: {
    post: false,
    bloom: false,
    dof: false,
    fog: false,
    smaa: false,
    gtao: false,
    reflections: false,
    reflectionScale: 0,
    shadowRes: 1024,
    softShadows: false,
    hexTiling: false,
    ormMaps: false,
    textureDir: '1k',
    grassScale: 0.5,
    grassBlades: 'lite',
    treeDensity: 0.5,
    cloudDetail: 1,
    waterSegs: 48,
    waterQuality: 0,
    maxPixelRatio: 1.25,
    dofTaps: 0,
    fogNear: 95,
    fogFar: 195,
  },
  // Steam Deck / integrated GPUs: full look at reduced cost (lighter DoF, 40% reflections, 2048 textures)
  medium: {
    post: true,
    bloom: true,
    dof: true,
    fog: true,
    smaa: true,
    gtao: false,
    reflections: true,
    reflectionScale: 0.4,
    shadowRes: 2048,
    hexTiling: true,
    ormMaps: true,
    textureDir: '',
    grassScale: 0.85,
    grassBlades: 'full',
    grassShadows: false,
    treeDensity: 0.8,
    cloudDetail: 2,
    waterSegs: 72,
    waterQuality: 1,
    maxPixelRatio: 1.0,
    dofTaps: 12,
    fogNear: 115,
    fogFar: 240,
  },
  high: {
    post: true,
    bloom: true,
    dof: true,
    fog: true,
    smaa: true,
    gtao: false,
    reflections: true,
    reflectionScale: 0.5,
    shadowRes: 2048,
    hexTiling: true,
    ormMaps: true,
    textureDir: '',
    grassScale: 1.25,
    grassBlades: 'full',
    grassShadows: true,
    treeDensity: 1.0,
    cloudDetail: 2,
    waterSegs: 110,
    waterQuality: 2,
    maxPixelRatio: 1.5,
    dofTaps: 16,
    fogNear: 115,
    fogFar: 240,
  },
  ultra: {
    post: true,
    bloom: true,
    dof: true,
    fog: true,
    smaa: true,
    gtao: true,
    reflections: true,
    reflectionScale: 0.75,
    shadowRes: 4096,
    hexTiling: true,
    ormMaps: true,
    textureDir: '',
    grassScale: 1.7,
    grassBlades: 'full',
    grassShadows: true,
    treeDensity: 1.2,
    cloudDetail: 3,
    waterSegs: 128,
    waterQuality: 2,
    maxPixelRatio: 2,
    dofTaps: 20,
    fogNear: 115,
    fogFar: 240,
  },
};

/** Ordered from cheapest to most expensive for the adaptive controller. */
export const QUALITY_ORDER = ['low', 'mobile', 'medium', 'high', 'ultra'];

/**
 * Picks a tier from the GL renderer string + platform hints:
 * SwiftShader -> low, phones/tablets -> mobile, Steam Deck / integrated GPUs -> medium, otherwise high.
 */
export function detectDeviceTier(isSoftwareGl, rendererStr = '') {
  if (isSoftwareGl) return 'low';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const uaData = typeof navigator !== 'undefined' ? navigator.userAgentData : null;
  const isMobileUa = (uaData && uaData.mobile) || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1); // iPadOS desktop UA
  if (isMobileUa) return 'mobile';
  if (/Apple GPU|Apple M\d/i.test(rendererStr)) return 'high'; // Apple Silicon Macs (Safari reports "Apple GPU")
  if (/Adreno|Mali|PowerVR|Immortalis|Xclipse/i.test(rendererStr)) return 'mobile'; // ARM tablets / ChromeOS with desktop UA
  const deckGpu = /AMD Custom GPU 0405|VANGOGH|RADV VANGOGH|Sephiroth|Steam/i.test(rendererStr);
  const integrated = /Intel\(R\) (UHD|HD|Iris)|Intel.*Graphics|llvmpipe|Radeon\(TM\) Graphics|Vega \d/i.test(rendererStr);
  const smallScreen = typeof window !== 'undefined' && window.screen && window.screen.width * window.screen.height <= 1280 * 800;
  if (deckGpu || integrated || (smallScreen && /Linux/.test(ua))) return 'medium';
  return 'high';
}

export function resolveQualityTier(isSoftwareGl, rendererStr = '') {
  let forced = null;
  try {
    const params = new URLSearchParams(window.location.search);
    forced = params.get('gfx');
    if (!forced && params.get('fx') === '1') forced = 'high';
    if (!forced && typeof localStorage !== 'undefined') forced = localStorage.getItem('monkemon.gfx');
  } catch (_) {
    forced = null;
  }
  if (forced && QUALITY_PRESETS[forced]) return forced;
  return detectDeviceTier(isSoftwareGl, rendererStr);
}

/** Optional `?dbg=nosmaa,nodof,nofog,nobloom,noreflect,direct` switches for bisecting the pipeline. */
export function resolveDebugFlags() {
  try {
    const params = new URLSearchParams(window.location.search);
    return new Set((params.get('dbg') || '').split(',').map((s) => s.trim()).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

/**
 * Single fullscreen pass that fuses the whole "miniature lens" look:
 * depth-based bokeh DoF (scatter-as-gather with CoC coverage weights), tilt-band shaping,
 * impact radial blur, analytic exponential height fog + sun-tinted aerial haze, chromatic
 * aberration, split-toning, vignette, grain, ACES tone mapping and sRGB output encoding.
 */
const MonkeGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 800) },
    uCameraNear: { value: 2.0 },
    uCameraFar: { value: 160.0 },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.42).normalize() },
    uTime: { value: 0 },
    uFogEnabled: { value: 1.0 },
    uHazeColor: { value: new THREE.Color('#9be4ff') },
    uHazeDensity: { value: 0.0022 },
    uFogSunTint: { value: new THREE.Color('#ffe6b0') },
    uMistColor: { value: new THREE.Color('#e4f6ff') },
    uMistDensity: { value: 0.009 },
    uMistHeight: { value: 0.7 },
    uMistBaseY: { value: -0.82 },
    uDofEnabled: { value: 1.0 },
    uFocusDist: { value: 26.0 },
    uSharpRel: { value: 0.13 },
    uBlurRel: { value: 0.74 },
    uMaxCoc: { value: 8.5 },
    uFocusY: { value: 0.5 },
    uFocusBand: { value: 0.2 },
    uRadial: { value: 0.0 },
    uRadialCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.18 },
    uAberration: { value: 1.1 },
    uGrain: { value: 0.012 },
    toneMappingExposure: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform vec3 uSunDir;
    uniform float uTime;
    uniform float uFogEnabled;
    uniform vec3 uHazeColor;
    uniform float uHazeDensity;
    uniform vec3 uFogSunTint;
    uniform vec3 uMistColor;
    uniform float uMistDensity;
    uniform float uMistHeight;
    uniform float uMistBaseY;
    uniform float uDofEnabled;
    uniform float uFocusDist;
    uniform float uSharpRel;
    uniform float uBlurRel;
    uniform float uMaxCoc;
    uniform float uFocusY;
    uniform float uFocusBand;
    uniform float uRadial;
    uniform vec2 uRadialCenter;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uGrain;

    #include <packing>
    #include <tonemapping_pars_fragment>
    ${GLSL_NOISE}

    varying vec2 vUv;

    float linearDepth(float rawDepth) {
      return -perspectiveDepthToViewZ(rawDepth, uCameraNear, uCameraFar);
    }
    float cocAt(float z) {
      float rel = abs(z - uFocusDist) / max(uFocusDist, 0.1);
      return smoothstep(uSharpRel, uBlurRel, rel);
    }


    void main() {
      vec2 texel = 1.0 / uResolution;
      float rawDepth = texture2D(tDepth, vUv).x;
      bool isSky = rawDepth > 0.99995;
      float centerZ = linearDepth(rawDepth);

      // --- Depth-based circle of confusion shaped by the miniature focus band ---
      float cocC = cocAt(centerZ) * uDofEnabled;
      float band = smoothstep(uFocusBand, 0.58, abs(vUv.y - uFocusY));
      cocC *= mix(0.7, 1.0, band);
      float radiusPx = max(cocC, 0.4) * uMaxCoc;

      // Chromatic aberration on the sharp center tap (radial, stronger towards the frame edge)
      vec2 fromC = vUv - 0.5;
      vec2 caOff = fromC * uAberration * texel * (0.7 + 3.4 * dot(fromC, fromC));
      vec3 center;
      center.r = texture2D(tDiffuse, vUv + caOff).r;
      center.g = texture2D(tDiffuse, vUv).g;
      center.b = texture2D(tDiffuse, vUv - caOff).b;

      vec3 sum = center;
      float wsum = 1.0;
      if (uDofEnabled > 0.5) {
        for (int i = 0; i < DOF_TAPS; i++) {
          float fi = float(i) + 0.5;
          float r = sqrt(fi / float(DOF_TAPS));
          float a = fi * 2.39996323 + mkHash21(vUv * 311.7) * 0.6;
          float distPx = r * radiusPx;
          vec2 suv = vUv + vec2(cos(a), sin(a)) * distPx * texel;
          float tapZ = linearDepth(texture2D(tDepth, suv).x);
          float tapCoc = cocAt(tapZ);
          float tapR = tapCoc * uMaxCoc;
          // Does the tap's own blur disc reach this pixel?
          float covers = smoothstep(distPx - 1.5, distPx + 1.0, tapR);
          // Nearer blurry objects bleed over us; farther ones only if we are blurry too
          float w = covers * ((tapZ < centerZ - 0.35) ? 1.0 : smoothstep(0.0, 0.12, cocC));
          sum += texture2D(tDiffuse, suv).rgb * w;
          wsum += w;
        }
      }
      vec3 col = sum / wsum;

      // In-focus micro-clarity (keeps the hero & toys crisp inside the focal band)
      if (cocC < 0.03) {
        vec2 s = 0.75 * texel;
        vec3 n = (
          texture2D(tDiffuse, vUv + vec2(s.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv - vec2(s.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0, s.y)).rgb +
          texture2D(tDiffuse, vUv - vec2(0.0, s.y)).rgb
        ) * 0.25;
        col += (col - n) * 0.12;
      }

      // --- Impact / dash radial blur pulse ---
      if (uRadial > 0.002) {
        vec2 dir = (uRadialCenter - vUv) * uRadial * 0.16;
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) {
          acc += texture2D(tDiffuse, vUv + dir * (float(i) / 6.0)).rgb;
        }
        col = mix(col, acc / 7.0, clamp(uRadial, 0.0, 1.0));
      }

      // --- Subtle distant horizon haze + far-shore mist (keeps the playable island 100% crisp) ---
      if (uFogEnabled > 0.5) {
        vec4 clip = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
        vec4 vp = uProjInv * clip;
        vp.xyz /= vp.w;
        vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
        vec3 ray = wp - uCamPos;
        float dist = length(ray);
        vec3 rd = ray / max(dist, 1e-3);
        float fogDist = max(dist - 52.0, 0.0);
        float haze = isSky ? 0.0 : 1.0 - exp(-fogDist * uHazeDensity);
        float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 8.0);
        vec3 hazeCol = mix(uHazeColor, uFogSunTint, sunAmt * 0.45);
        float b = 1.0 / max(uMistHeight, 0.2);
        float camH = uCamPos.y - uMistBaseY;
        float rdy = rd.y;
        if (abs(rdy) < 1e-3) rdy = 1e-3;
        float mistInt = (uMistDensity / b) * exp(-camH * b) * (1.0 - exp(-dist * rdy * b)) / rdy;
        float mistNoise = 0.5 + 0.8 * mkFbm3(wp.xz * 0.07 + vec2(uTime * 0.05, -uTime * 0.03));
        float mist = (1.0 - exp(-max(mistInt, 0.0) * mistNoise)) * smoothstep(54.0, 105.0, dist);
        if (isSky) mist *= 0.2;
        col = mix(col, hazeCol, clamp(haze, 0.0, 0.28));
        col = mix(col, uMistColor, clamp(mist, 0.0, 0.16));
      }

      // --- Golden-hour grade: saturation, split toning, vignette ---
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      vec3 shadowTint = vec3(0.96, 0.99, 1.04);
      vec3 highlightTint = vec3(1.03, 1.01, 0.97);
      col *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));
      float vig = 1.0 - smoothstep(0.46, 0.96, length(fromC) * 1.15) * uVignette;
      col *= vig;

      col = ACESFilmicToneMapping(col);
      float grain = (mkHash21(vUv * uResolution + fract(uTime * 13.1) * 97.0) - 0.5) * uGrain;
      col += grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    }
  `,
};

export class DioramaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const isHeadless = typeof navigator !== 'undefined' && /HeadlessChrome/i.test(navigator.userAgent || '');

    // Probe the GL implementation on a throwaway canvas (never the game canvas, whose first context
    // would otherwise pin the wrong attributes) so we can pick the quality tier before allocating the renderer
    let probeSoftware = false;
    try {
      const probeCanvas = document.createElement('canvas');
      const probe = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      const dbg = probe && probe.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = dbg ? String(probe.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      this.gpuName = rendererStr;
      probeSoftware = /SwiftShader|llvmpipe|Software/i.test(rendererStr);
      const lose = probe && probe.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (_) {
      probeSoftware = false;
    }
    this.isSoftwareGl = probeSoftware;
    this.quality = resolveQualityTier(this.isSoftwareGl, this.gpuName || '');
    this.preset = { ...QUALITY_PRESETS[this.quality] };
    this.debugFlags = resolveDebugFlags();
    if (this.debugFlags.has('nosmaa')) this.preset.smaa = false;
    if (this.debugFlags.has('nodof')) this.preset.dof = false;
    if (this.debugFlags.has('nofog')) this.preset.fog = false;
    if (this.debugFlags.has('nobloom')) this.preset.bloom = false;
    if (this.debugFlags.has('noreflect')) this.preset.reflections = false;
    if (this.debugFlags.has('nogtao')) this.preset.gtao = false;
    if (this.debugFlags.has('direct')) this.preset.post = false;
    const usePost = this.preset.post;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isHeadless && !usePost,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    this.basePixelRatio = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio || 2);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.info.autoReset = false;
    // Adaptive quality: frame-time EMA drives a render-scale + feature step ladder (see `_adaptQuality`)
    this.renderScale = 1.0;
    this.adaptLevel = 0;
    this.adaptiveEnabled = !this.isSoftwareGl && !this.debugFlags.has('noadapt');
    this._ftEma = 16;
    this._adaptTimer = 0;
    this._adaptCooldown = 4;
    this._lastFrameStamp = 0;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    // Shadows: on for every GPU tier, and also when a tier is forced on software GL (verification shots)
    this.shadowsEnabled = !this.isSoftwareGl || this.quality !== 'low';
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    this.renderer.shadowMap.type = this.preset.softShadows === false ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // Render shadow maps exactly once per frame (shared by the reflection + main passes)
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#7ed4fc');
    this.scene.fog = new THREE.Fog('#9be4ff', this.preset.fogNear, this.preset.fogFar);
    this.time = 0;

    // Procedural sky dome (gradient + sun + FBM cumulus) that follows the camera and feeds the IBL
    this.skyDome = createSkyDome('tropical');
    this.skyDome.layers.enable(REFLECTION_LAYER);
    this.skyDome.userData.setDetail(this.preset.cloudDetail >= 2 ? 1.0 : 0.6);
    if (this.debugFlags.has('nosky')) this.skyDome.visible = false;
    this.scene.add(this.skyDome);
    this.skyEnvScene = new THREE.Scene();
    this.skyEnvDome = new THREE.Mesh(this.skyDome.geometry, this.skyDome.material);
    this.skyEnvDome.frustumCulled = false;
    this.skyEnvScene.add(this.skyEnvDome);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.roomEnvTexture = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.skyEnvTexture = null;
    this.envTexture = this.roomEnvTexture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.72;

    // Signature 2.5D elevated toy-island camera (near=2.0 maximizes 24-bit depth precision, eliminating z-fighting)
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / Math.max(1, window.innerHeight), 2.0, 160);
    this.camTarget = new THREE.Vector3(0, 0.8, 0);
    this.camDesiredTarget = new THREE.Vector3(0, 0.8, 0);
    this.camOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.camDesiredOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.camFov = 30;
    this.camDesiredFov = 30;
    this.shakeTime = 0;
    this.shakeAmp = 0;
    this.radialBlur = 0;

    // 1. Sky/Ground Hemisphere bounce light
    this.hemiLight = new THREE.HemisphereLight(0xdff4ff, 0x5c8c46, 0.88);
    this.scene.add(this.hemiLight);

    // 2. Primary Golden Directional Sun with texel-stabilized PCFSoft shadows (zero shadow shimmer!)
    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 2.25);
    this.sunOffset = new THREE.Vector3(16, 28, 18);
    this.sunDir = this.sunOffset.clone().normalize();
    this.sunLight.position.copy(this.sunOffset);
    this.shadowFrustumHalf = 25;
    this.shadowMapRes = this.preset.shadowRes;
    if (this.shadowsEnabled) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(this.shadowMapRes, this.shadowMapRes);
      const d = this.shadowFrustumHalf;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 2;
      this.sunLight.shadow.camera.far = 78;
      this.sunLight.shadow.bias = -0.0012;
      this.sunLight.shadow.normalBias = 0.048;
    }
    this._sunForward = new THREE.Vector3();
    this._sunRight = new THREE.Vector3();
    this._sunUp = new THREE.Vector3();
    this._recomputeSunBasis();
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 3. Cool Rim / Backlight so 3D characters & trees get crisp silhouette separation!
    this.rimLight = new THREE.DirectionalLight(0xbae6fd, 0.68);
    this.rimLight.position.set(-15, 14, -18);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // 4. Dynamic Combat / Shrine / Capture FX PointLight
    this.fxLight = new THREE.PointLight(0xfbbf24, 0, 14, 1.6);
    this.fxLight.position.set(0, 2.2, 0);
    this.scene.add(this.fxLight);
    this.fxLightTimer = 0;
    this.fxLightDuration = 0.25;
    this.fxLightPeak = 0;
    for (const l of [this.hemiLight, this.sunLight, this.rimLight, this.fxLight]) l.layers.enable(REFLECTION_LAYER);

    // ---- Post-processing chain (explicit, depth-aware) ----
    this.tiltShiftEnabled = usePost && this.preset.dof;
    this.composer = null;
    this.bloomPass = null;
    this.gradePass = null;
    this.smaaPass = null;
    this.gtaoPass = null;
    this.rtScene = null;
    this.rtAux = null;
    this.rtLdr = null;
    this.reflection = null;
    this._ocean = null;
    this._fsQuad = null;
    if (usePost) this._buildPostChain();
    if (this.preset.reflections) {
      const pr = this.renderer.getPixelRatio();
      this.reflection = new PlanarReflection(this.renderer, {
        width: window.innerWidth * pr,
        height: window.innerHeight * pr,
        scale: this.preset.reflectionScale,
      });
    }

    // Mini 3D Turntable Scene for Starter Showcase & 20-Monkemon Board
    this.turntableScene = new THREE.Scene();
    this.turntableScene.background = new THREE.Color('#132338');
    this.turntableScene.environment = this.roomEnvTexture;
    this.turntableScene.environmentIntensity = 0.92;
    const ttHemi = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.15);
    const ttKey = new THREE.DirectionalLight(0xfffbeb, 2.25);
    ttKey.position.set(3, 5, 4);
    const ttRim = new THREE.DirectionalLight(0x38bdf8, 0.9);
    ttRim.position.set(-3, 3, -4);
    this.turntableScene.add(ttHemi, ttKey, ttRim);
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.08, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.28, metalness: 0.38 }),
    );
    pedestal.position.y = -0.11;
    const pedRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.98, 0.04, 12, 36),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    pedRim.rotation.x = Math.PI / 2;
    pedRim.position.y = 0.01;
    this.turntablePedestal = new THREE.Group();
    this.turntablePedestal.add(pedestal, pedRim);
    this.turntableMount = new THREE.Group();
    this.turntableScene.add(this.turntablePedestal, this.turntableMount);
    this.turntableCamera = new THREE.PerspectiveCamera(30, 1, 0.2, 30);
    this.turntableCamera.position.set(0, 1.55, 3.85);
    this.turntableCamera.lookAt(0, 0.62, 0);
    this.turntableTargetCanvas = null;

    window.addEventListener('resize', () => this.onResize());
    console.info(`[Monkemon] Graphics tier: ${this.quality}${this.isSoftwareGl ? ' (software GL)' : ''} on "${this.gpuName || 'unknown GPU'}" @${this.basePixelRatio.toFixed(2)}x`);
  }

  _recomputeSunBasis() {
    this.sunDir.copy(this.sunOffset).normalize();
    this._sunForward.copy(this.sunOffset).negate().normalize();
    this._sunRight.crossVectors(new THREE.Vector3(0, 1, 0), this._sunForward).normalize();
    this._sunUp.crossVectors(this._sunForward, this._sunRight).normalize();
  }

  _buildPostChain() {
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(2, Math.round(window.innerWidth * pr));
    const h = Math.max(2, Math.round(window.innerHeight * pr));

    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.format = THREE.DepthFormat;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this.rtScene.texture.name = 'MonkeSceneHDR';
    this.rtAux = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtAux.texture.name = 'MonkeAuxHDR';
    this.rtLdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.rtLdr.texture.name = 'MonkeGradedLDR';

    if (this.preset.bloom) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.22, // subtle atmospheric bloom strength
        0.46, // radius
        0.86, // high threshold so only lamps, shrines, lava, cloud silver-linings & spell bursts bloom
      );
      this.bloomPass.renderToScreen = false;
    }

    this.gradeMaterial = new THREE.ShaderMaterial({
      defines: { DOF_TAPS: String(Math.max(6, this.preset.dofTaps || 16)) },
      uniforms: THREE.UniformsUtils.clone(MonkeGradeShader.uniforms),
      vertexShader: MonkeGradeShader.vertexShader,
      fragmentShader: MonkeGradeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.gradeMaterial.uniforms.tDepth.value = depthTexture;
    this.gradeMaterial.uniforms.uResolution.value.set(w, h);
    this.gradeMaterial.uniforms.uFogEnabled.value = this.preset.fog ? 1.0 : 0.0;
    this.gradeMaterial.uniforms.uDofEnabled.value = this.preset.dof ? 1.0 : 0.0;
    this._fsQuad = new FullScreenQuad(this.gradeMaterial);

    if (this.preset.smaa) {
      this.smaaPass = new SMAAPass(w, h);
      this.smaaPass.renderToScreen = true;
    }

    if (this.preset.gtao) {
      this.gtaoPass = new GTAOPass(this.scene, this.camera, w, h);
      this.gtaoPass.output = GTAOPass.OUTPUT.Default;
      this.gtaoPass.blendIntensity = 0.85;
      this.gtaoPass.updateGtaoMaterial({
        radius: 0.55,
        distanceExponent: 1.2,
        thickness: 1.0,
        scale: 1.1,
        samples: 16,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      });
      this.gtaoPass.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 4,
        radiusExponent: 1,
        rings: 2,
        samples: 16,
      });
      this.gtaoPass.renderToScreen = false;
    }
  }

  onResize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio() * (this.rtScene ? this.renderScale : 1);
    const pw = Math.max(2, Math.round(w * pr));
    const ph = Math.max(2, Math.round(h * pr));
    if (this.rtScene) {
      this.rtScene.setSize(pw, ph);
      this.rtAux.setSize(pw, ph);
      this.rtLdr.setSize(pw, ph);
      this.gradeMaterial.uniforms.uResolution.value.set(pw, ph);
      if (this.bloomPass) this.bloomPass.setSize(w, h);
      if (this.smaaPass) this.smaaPass.setSize(pw, ph);
      if (this.gtaoPass) this.gtaoPass.setSize(pw, ph);
    }
    if (this.reflection) this.reflection.setSize(pw, ph);
  }

  toggleTiltShift() {
    if (!this.gradeMaterial || !this.preset.dof) return false;
    this.tiltShiftEnabled = !this.tiltShiftEnabled;
    this.gradeMaterial.uniforms.uDofEnabled.value = this.tiltShiftEnabled ? 1.0 : 0.0;
    return this.tiltShiftEnabled;
  }

  flashLight(x, y, z, color = '#fbbf24', intensity = 5.5, duration = 0.28) {
    this.fxLight.position.set(x, y, z);
    this.fxLight.color.set(color);
    this.fxLightPeak = intensity;
    this.fxLightDuration = Math.max(0.05, duration);
    this.fxLightTimer = this.fxLightDuration;
    this.fxLight.intensity = intensity;
  }

  /** Quick screen-space radial blur pulse (dash strikes, slams, super-effective hits). */
  pulseRadialBlur(strength = 0.6) {
    this.radialBlur = Math.max(this.radialBlur, Math.min(1.0, strength));
  }

  setZoneAtmosphere(zone) {
    const theme = zone.theme || null;
    const isInterior = !theme;
    const atmo = getZoneAtmosphere(theme || 'tropical');
    const skyHex = zone.skyColor || atmo.horizon;
    const fogHex = zone.fogColor || zone.skyColor || atmo.horizon;

    this.scene.background.set(skyHex);
    this.scene.fog.color.set(fogHex);
    if (isInterior) {
      this.scene.fog.near = 140;
      this.scene.fog.far = 260;
    } else {
      this.scene.fog.near = this.preset.fogNear;
      this.scene.fog.far = this.preset.fogFar;
    }

    // Lighting rig per biome (outdoor) – interiors keep the previous outdoor rig values
    if (!isInterior) {
      this.hemiLight.color.set(atmo.hemiSky);
      this.hemiLight.groundColor.set(atmo.hemiGround);
      this.sunLight.color.set(atmo.sunColor);
      this.sunLight.intensity = atmo.sunIntensity;
      this.rimLight.color.set(atmo.rimColor);
      this.rimLight.intensity = atmo.rimIntensity;
      this.sunOffset.set(atmo.sunOffset[0], atmo.sunOffset[1], atmo.sunOffset[2]);
      this._recomputeSunBasis();
      this.renderer.toneMappingExposure = atmo.exposure;
    }

    // Sky dome + live PMREM environment so PBR reflections match the island sky
    this.skyDome.visible = !isInterior && !this.debugFlags.has('nosky');
    if (!isInterior) {
      this.skyDome.userData.applyAtmosphere(atmo, { skyColor: skyHex, fogColor: fogHex, sunDir: this.sunDir });
      if (this.quality === 'low') {
        // Software GL: skip the (slow) sky PMREM bake and keep the studio environment
        this.envTexture = this.roomEnvTexture;
        this.scene.environment = this.roomEnvTexture;
        this.scene.environmentIntensity = 0.72;
      } else {
        const prev = this.skyEnvTexture;
        this.skyEnvDome.position.set(0, 0, 0);
        this.skyDome.userData.setEnvCapture(true);
        this.skyEnvTexture = this.pmrem.fromScene(this.skyEnvScene, 0.035, 1, 400).texture;
        this.skyDome.userData.setEnvCapture(false);
        if (prev) prev.dispose();
        this.envTexture = this.skyEnvTexture;
        this.scene.environment = this.envTexture;
        this.scene.environmentIntensity = atmo.environmentIntensity * 0.72;
      }
    } else {
      this.envTexture = this.roomEnvTexture;
      this.scene.environment = this.roomEnvTexture;
      this.scene.environmentIntensity = 0.72;
    }

    if (this.gradeMaterial) {
      const u = this.gradeMaterial.uniforms;
      u.uHazeColor.value.set(fogHex);
      u.uFogSunTint.value.set(atmo.fogSunTint);
      u.uMistColor.value.set(atmo.mistColor);
      u.uHazeDensity.value = isInterior ? 0.0 : atmo.hazeDensity;
      u.uMistDensity.value = isInterior ? 0.0 : atmo.mistDensity;
      u.uMistHeight.value = atmo.mistHeight;
      u.uSunDir.value.copy(this.sunDir);
      u.uFogEnabled.value = this.preset.fog && !isInterior ? 1.0 : 0.0;
    }
  }

  triggerShake(amp = 0.28, duration = 0.24) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.pulseRadialBlur(Math.min(0.9, amp * 2.0));
  }

  /**
   * Frames the camera on a target. `mode` picks a preset offset / FOV / depth-of-field band; the optional
   * `override` object lets gameplay code tune a preset without touching renderer internals:
   *   `{ offset: [x, y, z] | Vector3, fov, dofSharpRel, dofBlurRel }`
   * e.g. the Pokémon-style close battle camera: `setCameraFraming(x, y, z, 'battle', true, { offset: [0, 4.2, 9.4], fov: 30 })`.
   * The DoF focus distance always follows |camera - target|; `dofSharpRel` / `dofBlurRel` are fractions of that
   * distance that stay crisp / reach full blur (battle & catch presets keep both combatants sharp).
   */
  setCameraFraming(targetX, targetY, targetZ, mode = 'overworld', snap = false, override = null) {
    if (this.debugFlags.has('titlecam')) mode = 'title'; // verification: cinematic horizon framing in play mode
    this.camDesiredTarget.set(targetX, targetY, targetZ);
    this.camDesiredFov = 30;
    let dofSharpRel = 0.13;
    let dofBlurRel = 0.74;
    if (mode === 'battle') {
      this.camDesiredOffset.set(0, 13.6, 17.2);
      dofSharpRel = 0.3;
      dofBlurRel = 1.05;
    } else if (mode === 'interior') {
      this.camDesiredOffset.set(0, 14.0, 15.8);
      dofSharpRel = 0.18;
      dofBlurRel = 0.8;
    } else if (mode === 'catch') {
      this.camDesiredOffset.set(0, 9.2, 12.6);
      dofSharpRel = 0.22;
      dofBlurRel = 0.85;
    } else if (mode === 'title') {
      // Low, wide cinematic establishing shot: horizon, cumulus & distant islands enter the frame
      this.camDesiredOffset.set(6.0, 8.6, 27.5);
      this.camDesiredFov = 42;
    } else {
      this.camDesiredOffset.set(0, 17.0, 20.0);
    }
    if (override) {
      if (override.offset) {
        if (Array.isArray(override.offset)) this.camDesiredOffset.fromArray(override.offset);
        else this.camDesiredOffset.copy(override.offset);
      }
      if (Number.isFinite(override.fov)) this.camDesiredFov = override.fov;
      if (Number.isFinite(override.dofSharpRel)) dofSharpRel = override.dofSharpRel;
      if (Number.isFinite(override.dofBlurRel)) dofBlurRel = override.dofBlurRel;
    }
    if (this.gradeMaterial) {
      this.gradeMaterial.uniforms.uSharpRel.value = dofSharpRel;
      this.gradeMaterial.uniforms.uBlurRel.value = dofBlurRel;
    }
    if (snap) {
      this.camTarget.copy(this.camDesiredTarget);
      this.camOffset.copy(this.camDesiredOffset);
      this.camFov = this.camDesiredFov;
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateCamera(dt) {
    const k = 1 - Math.exp(-7.5 * dt);
    this.camTarget.lerp(this.camDesiredTarget, k);
    this.camOffset.lerp(this.camDesiredOffset, k);
    const fovK = 1 - Math.exp(-4.0 * dt);
    const nextFov = this.camFov + (this.camDesiredFov - this.camFov) * fovK;
    if (Math.abs(nextFov - this.camFov) > 0.01) {
      this.camFov = nextFov;
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const a = this.shakeAmp * (this.shakeTime / 0.25);
      sx = (Math.random() - 0.5) * 2 * a;
      sy = (Math.random() - 0.5) * 2 * a;
      if (this.shakeTime <= 0) this.shakeAmp = 0;
    }
    this.radialBlur = Math.max(0, this.radialBlur - dt * 3.2);

    this.camera.position.set(
      this.camTarget.x + this.camOffset.x + sx,
      this.camTarget.y + this.camOffset.y + sy,
      this.camTarget.z + this.camOffset.z,
    );
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);

    // Texel-snapped sun placement: move the shadow frustum only in whole shadow-map texels => zero shimmer
    const texel = (2 * this.shadowFrustumHalf) / Math.max(1, this.shadowMapRes);
    const tx = this.camTarget.x;
    const tz = this.camTarget.z;
    let r = tx * this._sunRight.x + tz * this._sunRight.z;
    let u = tx * this._sunUp.x + tz * this._sunUp.z;
    const f = tx * this._sunForward.x + tz * this._sunForward.z;
    r = Math.round(r / texel) * texel;
    u = Math.round(u / texel) * texel;
    const snapX = this._sunRight.x * r + this._sunUp.x * u + this._sunForward.x * f;
    const snapY = this._sunRight.y * r + this._sunUp.y * u + this._sunForward.y * f;
    const snapZ = this._sunRight.z * r + this._sunUp.z * u + this._sunForward.z * f;
    this.sunLight.target.position.set(snapX, snapY, snapZ);
    this.sunLight.position.set(snapX + this.sunOffset.x, snapY + this.sunOffset.y, snapZ + this.sunOffset.z);

    this.rimLight.position.set(this.camTarget.x - 15, 14, this.camTarget.z - 18);
    this.rimLight.target.position.set(this.camTarget.x, 0.8, this.camTarget.z);

    if (this.fxLightTimer > 0) {
      this.fxLightTimer = Math.max(0, this.fxLightTimer - dt);
      this.fxLight.intensity = this.fxLightPeak * (this.fxLightTimer / this.fxLightDuration);
    } else {
      this.fxLight.intensity = 0;
    }

    this.skyDome.position.copy(this.camera.position);
    CLOUD_SIGHT_UNIFORMS.a.value.copy(this.camera.position);
    CLOUD_SIGHT_UNIFORMS.b.value.copy(this.camTarget);
    FOLIAGE_SIGHT_UNIFORMS.a.value.copy(this.camera.position);
    FOLIAGE_SIGHT_UNIFORMS.b.value.set(this.camTarget.x, this.camTarget.y - 0.4, this.camTarget.z);
  }

  projectToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1.0,
    };
  }

  _findOcean() {
    if (this._ocean && this._ocean.parent) return this._ocean;
    this._ocean = null;
    this.scene.traverse((o) => {
      if (!this._ocean && o.userData && o.userData.isMonkeOcean) this._ocean = o;
    });
    return this._ocean;
  }

  _isWorldVisible(obj) {
    let o = obj;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }

  _renderReflection() {
    const ocean = this._findOcean();
    if (!ocean || !this.reflection || !this._isWorldVisible(ocean)) return;
    const mat = ocean.material;
    const hidden = [ocean];
    if (ocean.userData.reflectionHide) hidden.push(...ocean.userData.reflectionHide);
    const ok = this.reflection.render(this.scene, this.camera, ocean.userData.planeY ?? ocean.position.y, hidden);
    if (mat && mat.uniforms && mat.uniforms.uReflectionMap) {
      mat.uniforms.uReflectionMap.value = this.reflection.renderTarget.texture;
      mat.uniforms.uReflectionMatrix.value.copy(this.reflection.textureMatrix);
      mat.uniforms.uHasReflection.value = ok ? 1.0 : 0.0;
    }
  }

  _renderPostChain() {
    const renderer = this.renderer;
    const u = this.gradeMaterial.uniforms;

    // 1. HDR scene + depth
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    let current = this.rtScene;

    // 2. GTAO (ultra) – copies scene into rtAux and multiplies denoised AO
    if (this.gtaoPass) {
      this.gtaoPass.render(renderer, this.rtAux, this.rtScene);
      current = this.rtAux;
    }

    // 3. Bloom (composited additively in place)
    if (this.bloomPass) {
      this.bloomPass.render(renderer, null, current, 0, false);
    }

    // 4. Fused DoF / fog / grade / tone map → LDR
    u.tDiffuse.value = current.texture;
    u.uCameraNear.value = this.camera.near;
    u.uCameraFar.value = this.camera.far;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.copy(this.camera.position);
    u.uTime.value = this.time;
    u.uFocusDist.value = this.camera.position.distanceTo(this.camTarget);
    u.uRadial.value = this.radialBlur;
    u.toneMappingExposure.value = this.renderer.toneMappingExposure;
    const toScreen = !this.smaaPass;
    renderer.setRenderTarget(toScreen ? null : this.rtLdr);
    this._fsQuad.render(renderer);

    // 5. SMAA → screen
    if (this.smaaPass) {
      this.smaaPass.render(renderer, null, this.rtLdr, 0, false);
    }
    renderer.setRenderTarget(null);
  }

  /** Draw calls / triangles of the last complete frame (all passes). */
  getPerfStats() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, frameMs: this._ftEma, renderScale: this.renderScale, adaptLevel: this.adaptLevel, tier: this.quality };
  }

  /** Live quality ladder (cheap -> expensive is reversed): 0 full, 1 no reflections, 2 85% scale, 3 70% scale, 4 55% scale + no SMAA. */
  _applyAdaptLevel(level) {
    this.adaptLevel = level;
    const scales = [1.0, 1.0, 0.85, 0.7, 0.55];
    const scale = scales[Math.min(level, scales.length - 1)];
    if (this.reflection) this.reflection.enabled = level < 1;
    if (this.smaaPass) this.smaaPass.enabled = level < 4;
    if (this.rtScene && Math.abs(scale - this.renderScale) > 0.001) {
      this.renderScale = scale;
      this.onResize();
    } else {
      this.renderScale = scale;
    }
    if (!this.rtScene && !this.isSoftwareGl) {
      // Direct-render tiers (mobile): scale the whole canvas backing store instead
      this.renderer.setPixelRatio(this.basePixelRatio * scale);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  _adaptQuality(dt) {
    if (!this.adaptiveEnabled) return;
    const now = performance.now();
    if (this._lastFrameStamp > 0) {
      const ft = Math.min(100, now - this._lastFrameStamp);
      this._ftEma += (ft - this._ftEma) * 0.08;
    }
    this._lastFrameStamp = now;
    this._adaptTimer += dt;
    if (this._adaptTimer < this._adaptCooldown) return;
    const maxLevel = 4;
    if (this._ftEma > 24 && this.adaptLevel < maxLevel) {
      this._applyAdaptLevel(this.adaptLevel + 1);
      this._adaptTimer = 0;
      this._adaptCooldown = 3;
      console.info(`[Monkemon] adaptive quality: frame ${this._ftEma.toFixed(1)}ms -> level ${this.adaptLevel} (scale ${this.renderScale})`);
    } else if (this._ftEma < 12.5 && this.adaptLevel > 0) {
      this._applyAdaptLevel(this.adaptLevel - 1);
      this._adaptTimer = 0;
      this._adaptCooldown = 8;
    }
  }

  render(dt = 0.016) {
    this.time += dt;
    this.renderer.info.reset();
    this._adaptQuality(dt);
    this.updateCamera(dt);
    this.skyDome.userData.setTime(this.time);
    if (this.shadowsEnabled) this.renderer.shadowMap.needsUpdate = true;

    // Optional live 3D MonkeDex / Starter turntable render into a 2D `<canvas>` without a second WebGL context
    if (this.turntableTargetCanvas && this.turntableMount.children.length > 0) {
      this.turntableMount.rotation.y += dt * 1.15;
      const cw = 260;
      const ch = 260;
      const pr = this.renderer.getPixelRatio();
      const fullW = window.innerWidth;
      const fullH = window.innerHeight;
      if (fullW >= cw && fullH >= ch) {
        this.renderer.setRenderTarget(null);
        this.renderer.setScissorTest(true);
        this.renderer.setViewport(0, 0, cw, ch);
        this.renderer.setScissor(0, 0, cw, ch);
        this.renderer.render(this.turntableScene, this.turntableCamera);
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, fullW, fullH);

        const ctx2d = this.turntableTargetCanvas.getContext('2d');
        if (ctx2d) {
          const srcW = Math.round(cw * pr);
          const srcH = Math.round(ch * pr);
          const srcY = Math.max(0, this.renderer.domElement.height - srcH);
          ctx2d.clearRect(0, 0, this.turntableTargetCanvas.width, this.turntableTargetCanvas.height);
          ctx2d.drawImage(
            this.renderer.domElement,
            0,
            srcY,
            srcW,
            srcH,
            0,
            0,
            this.turntableTargetCanvas.width,
            this.turntableTargetCanvas.height,
          );
        }
      }
    }

    if (this.reflection) this._renderReflection();

    if (this.gradeMaterial) {
      this._renderPostChain();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    this._frameCount = (this._frameCount || 0) + 1;
    if (this._frameCount === 8 || this._frameCount === 120) {
      const r = this.renderer.info.render;
      const m = this.renderer.info.memory;
      console.info(`[Monkemon] perf@${this._frameCount}: ${r.calls} draw calls, ${r.triangles} tris, ${m.geometries} geometries, ${m.textures} textures, ${this.renderer.info.programs.length} programs, tier ${this.quality}, scale ${this.renderScale}`);
    }
    if (!this._loggedFirstFrame) {
      this._loggedFirstFrame = true;
      const gl = this.renderer.getContext();
      console.info(
        `[Monkemon] first frame rendered (tier ${this.quality}, post ${this.gradeMaterial ? 'on' : 'off'}, glError ${gl ? gl.getError() : 'n/a'})`,
      );
    }
  }

  // Pace software WebGL (SwiftShader in headless Chrome) so compositor snapshot never starves!
  afterDraw() {
    if (!this.isSoftwareGl) return Promise.resolve();
    const gl = this.renderer.getContext();
    if (gl) {
      if (!this._syncPixel) this._syncPixel = new Uint8Array(4);
      gl.flush();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._syncPixel);
    }
    return new Promise((r) => setTimeout(r, 80));
  }
}
