// 2.5D Toy-Diorama Realistic WebGL Renderer (Three.js r170)
// - Elevated 2.5D tabletop-miniature perspective camera (`FOV 30°`) with smooth damping
// - Realistic 4-layer lighting rig:
//     1. `RoomEnvironment` PMREM PBR bounce reflections
//     2. `HemisphereLight` sky/ground ambient bounce
//     3. `DirectionalLight` golden sun with `2048×2048` `PCFSoftShadowMap` tracking the player
//     4. `DirectionalLight` cool rim backlight (`rimLight`) + dynamic `PointLight` (`fxLight`) for spells & shrines
// - Hardware Post-Processing Shader Pipeline (`EffectComposer`):
//     `RenderPass` -> `UnrealBloomPass` -> `TiltShiftRealismShader` (`ShaderPass`) -> `OutputPass`
//   (Automatically skipped on SwiftShader software WebGL + `fenceSync` pacing so headless Chrome renders fast).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShiftRealismShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 800) },
    uFocusY: { value: 0.49 },
    uFocusBand: { value: 0.24 },
    uBlurStrength: { value: 3.2 },
    uSaturation: { value: 1.13 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocusY;
    uniform float uFocusBand;
    uniform float uBlurStrength;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      float dist = abs(vUv.y - uFocusY);
      float coc = smoothstep(uFocusBand, 0.56, dist);
      vec2 texel = (uBlurStrength * coc) / uResolution;

      vec4 center = texture2D(tDiffuse, vUv);
      vec4 sum = vec4(0.0);

      if (coc < 0.015) {
        // Subtle crisp local micro-clarity inside the in-focus toy-diorama band
        vec2 sharpStep = 0.75 / uResolution;
        vec3 n = (
          texture2D(tDiffuse, vUv + vec2(sharpStep.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv - vec2(sharpStep.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0, sharpStep.y)).rgb +
          texture2D(tDiffuse, vUv - vec2(0.0, sharpStep.y)).rgb
        ) * 0.25;
        sum = vec4(center.rgb + (center.rgb - n) * 0.14, center.a);
      } else {
        // 9-tap circular miniature bokeh kernel
        sum += center * 0.24;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)) * 0.12;
        sum += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)) * 0.12;
        sum += texture2D(tDiffuse, vUv + vec2(0.0, texel.y)) * 0.12;
        sum += texture2D(tDiffuse, vUv - vec2(0.0, texel.y)) * 0.12;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y) * 0.8) * 0.07;
      }

      // Natural golden-hour split toning + gentle saturation + soft optical vignette
      float luma = dot(sum.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 vivid = mix(vec3(luma), sum.rgb, uSaturation);
      vec3 shadowTint = vec3(0.96, 0.99, 1.04);
      vec3 highlightTint = vec3(1.03, 1.01, 0.97);
      vivid *= mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));

      float vig = 1.0 - smoothstep(0.46, 0.96, length(vUv - vec2(0.5)) * 1.15) * 0.16;
      gl_FragColor = vec4(vivid * vig, sum.a);
    }
  `,
};

export class DioramaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const isHeadless = typeof navigator !== 'undefined' && /HeadlessChrome/i.test(navigator.userAgent || '');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isHeadless,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    this.isSoftwareGl = /SwiftShader|llvmpipe|Software/i.test(rendererStr);

    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#7ed4fc');
    this.scene.fog = new THREE.Fog('#9be4ff', 40, 88);

    // Studio RoomEnvironment PBR bounce lighting makes TRELLIS.2 & Nano Banana surfaces shine
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.72;
    pmrem.dispose();

    // Signature 2.5D elevated toy-island camera (near=2.0 maximizes 24-bit depth precision, eliminating z-fighting)
    this.camera = new THREE.PerspectiveCamera(
      30,
      window.innerWidth / Math.max(1, window.innerHeight),
      2.0,
      160,
    );
    this.camTarget = new THREE.Vector3(0, 0.8, 0);
    this.camDesiredTarget = new THREE.Vector3(0, 0.8, 0);
    this.camOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.camDesiredOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.shakeTime = 0;
    this.shakeAmp = 0;

    // 1. Sky/Ground Hemisphere bounce light
    this.hemiLight = new THREE.HemisphereLight(0xdff4ff, 0x5c8c46, 0.88);
    this.scene.add(this.hemiLight);

    // 2. Primary Golden Directional Sun with tight PCFSoft shadows
    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 2.25);
    this.sunLight.position.set(16, 28, 18);
    if (!this.isSoftwareGl) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      const d = 25;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 2;
      this.sunLight.shadow.camera.far = 78;
      this.sunLight.shadow.bias = -0.0004;
      this.sunLight.shadow.normalBias = 0.024;
    }
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

    // Hardware Postprocessing: RenderPass -> UnrealBloomPass -> TiltShiftRealismShader -> OutputPass
    this.tiltShiftEnabled = !this.isSoftwareGl;
    this.composer = null;
    this.bloomPass = null;
    this.tiltPass = null;
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.24, // subtle atmospheric bloom strength
        0.42, // radius
        0.84, // high threshold so only lamps, shrines, lava & spell bursts bloom
      );
      this.composer.addPass(this.bloomPass);

      this.tiltPass = new ShaderPass(TiltShiftRealismShader);
      this.tiltPass.uniforms.uResolution.value.set(
        window.innerWidth * this.renderer.getPixelRatio(),
        window.innerHeight * this.renderer.getPixelRatio(),
      );
      this.composer.addPass(this.tiltPass);
      this.composer.addPass(new OutputPass());
    }

    // Mini 3D Turntable Scene for Starter Showcase & 20-Monkemon Board
    this.turntableScene = new THREE.Scene();
    this.turntableScene.background = new THREE.Color('#132338');
    this.turntableScene.environment = this.envTexture;
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
  }

  onResize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setSize(w, h);
      const pr = this.renderer.getPixelRatio();
      if (this.bloomPass) this.bloomPass.resolution.set(w, h);
      if (this.tiltPass) this.tiltPass.uniforms.uResolution.value.set(w * pr, h * pr);
    }
  }

  toggleTiltShift() {
    if (this.isSoftwareGl) return false;
    this.tiltShiftEnabled = !this.tiltShiftEnabled;
    if (this.tiltPass) this.tiltPass.enabled = this.tiltShiftEnabled;
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

  setZoneAtmosphere(zone) {
    this.scene.background.set(zone.skyColor || '#7ed4fc');
    this.scene.fog.color.set(zone.fogColor || zone.skyColor || '#9be4ff');
    if (zone.theme === 'volcano') {
      this.hemiLight.color.set('#ffe4e6');
      this.hemiLight.groundColor.set('#7c2d12');
      this.sunLight.color.set('#ffedd5');
      this.sunLight.intensity = 2.05;
      this.rimLight.color.set('#fb923c');
      this.rimLight.intensity = 0.92;
    } else if (zone.theme === 'snow') {
      this.hemiLight.color.set('#e0f2fe');
      this.hemiLight.groundColor.set('#94a3b8');
      this.sunLight.color.set('#ffffff');
      this.sunLight.intensity = 2.15;
      this.rimLight.color.set('#7dd3fc');
      this.rimLight.intensity = 0.78;
    } else if (zone.theme === 'forest') {
      this.hemiLight.color.set('#fef9c3');
      this.hemiLight.groundColor.set('#3f6212');
      this.sunLight.color.set('#fef08a');
      this.sunLight.intensity = 2.3;
      this.rimLight.color.set('#86efac');
      this.rimLight.intensity = 0.72;
    } else {
      this.hemiLight.color.set('#dff4ff');
      this.hemiLight.groundColor.set('#5c8c46');
      this.sunLight.color.set('#fff4d6');
      this.sunLight.intensity = 2.28;
      this.rimLight.color.set('#bae6fd');
      this.rimLight.intensity = 0.68;
    }
  }

  triggerShake(amp = 0.28, duration = 0.24) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  setCameraFraming(targetX, targetY, targetZ, mode = 'overworld', snap = false) {
    this.camDesiredTarget.set(targetX, targetY, targetZ);
    if (mode === 'battle') {
      this.camDesiredOffset.set(0, 13.6, 17.2);
    } else if (mode === 'interior') {
      this.camDesiredOffset.set(0, 14.0, 15.8);
    } else if (mode === 'catch') {
      this.camDesiredOffset.set(0, 9.2, 12.6);
    } else if (mode === 'title') {
      this.camDesiredOffset.set(4.2, 12.6, 16.4);
    } else {
      this.camDesiredOffset.set(0, 17.0, 20.0);
    }
    if (snap) {
      this.camTarget.copy(this.camDesiredTarget);
      this.camOffset.copy(this.camDesiredOffset);
    }
  }

  updateCamera(dt) {
    const k = 1 - Math.exp(-7.5 * dt);
    this.camTarget.lerp(this.camDesiredTarget, k);
    this.camOffset.lerp(this.camDesiredOffset, k);

    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const a = this.shakeAmp * (this.shakeTime / 0.25);
      sx = (Math.random() - 0.5) * 2 * a;
      sy = (Math.random() - 0.5) * 2 * a;
      if (this.shakeTime <= 0) this.shakeAmp = 0;
    }

    this.camera.position.set(
      this.camTarget.x + this.camOffset.x + sx,
      this.camTarget.y + this.camOffset.y + sy,
      this.camTarget.z + this.camOffset.z,
    );
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);

    this.sunLight.position.set(this.camTarget.x + 16, 28, this.camTarget.z + 18);
    this.sunLight.target.position.set(this.camTarget.x, 0, this.camTarget.z);

    this.rimLight.position.set(this.camTarget.x - 15, 14, this.camTarget.z - 18);
    this.rimLight.target.position.set(this.camTarget.x, 0.8, this.camTarget.z);

    if (this.fxLightTimer > 0) {
      this.fxLightTimer = Math.max(0, this.fxLightTimer - dt);
      this.fxLight.intensity = this.fxLightPeak * (this.fxLightTimer / this.fxLightDuration);
    } else {
      this.fxLight.intensity = 0;
    }
  }

  projectToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1.0,
    };
  }

  render(dt = 0.016) {
    this.updateCamera(dt);

    // Optional live 3D MonkeDex / Starter turntable render into a 2D `<canvas>` without a second WebGL context
    if (this.turntableTargetCanvas && this.turntableMount.children.length > 0) {
      this.turntableMount.rotation.y += dt * 1.15;
      const cw = 260;
      const ch = 260;
      const pr = this.renderer.getPixelRatio();
      const fullW = window.innerWidth;
      const fullH = window.innerHeight;
      if (fullW >= cw && fullH >= ch) {
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

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
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
