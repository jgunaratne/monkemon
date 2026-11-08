// 2.5D Toy-Diorama WebGL Renderer (Three.js r170)
// - Elevated 2.5D tabletop-miniature perspective camera (`FOV 30°`) with smooth damping
// - `RoomEnvironment` PBR studio bounce lighting so TRELLIS.2 glossy ceramic/vinyl/plush meshes shine
// - Custom Tilt-Shift Miniature Depth-of-Field ShaderPass on hardware GPUs (skipped automatically
//   on SwiftShader software WebGL + `fenceSync` pacing so headless Chrome renders fast and never blanks).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShiftMiniatureShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 800) },
    uFocusY: { value: 0.48 },
    uFocusBand: { value: 0.21 },
    uBlurStrength: { value: 3.6 },
    uSaturation: { value: 1.12 },
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
      float coc = smoothstep(uFocusBand, 0.54, dist);
      vec2 texel = (uBlurStrength * coc) / uResolution;

      vec4 sum = vec4(0.0);
      if (coc < 0.015) {
        sum = texture2D(tDiffuse, vUv);
      } else {
        // 9-tap circular miniature bokeh kernel
        sum += texture2D(tDiffuse, vUv) * 0.24;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)) * 0.12;
        sum += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)) * 0.12;
        sum += texture2D(tDiffuse, vUv + vec2(0.0, texel.y)) * 0.12;
        sum += texture2D(tDiffuse, vUv - vec2(0.0, texel.y)) * 0.12;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y) * 0.8) * 0.07;
        sum += texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y) * 0.8) * 0.07;
      }

      // Gentle toy-diorama saturation & soft corner vignette
      float luma = dot(sum.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 vivid = mix(vec3(luma), sum.rgb, uSaturation);
      float vig = 1.0 - smoothstep(0.45, 0.95, length(vUv - vec2(0.5)) * 1.15) * 0.14;
      gl_FragColor = vec4(vivid * vig, sum.a);
    }
  `,
};

export class DioramaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
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
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#87dcff');
    this.scene.fog = new THREE.Fog('#9be4ff', 38, 82);

    // Studio RoomEnvironment makes TRELLIS.2 PBR baseColor + metallicRoughness pop like vinyl toys!
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.78;
    pmrem.dispose();

    // Signature 2.5D elevated toy-island camera (narrow FOV = charming isometric-like miniature look)
    this.camera = new THREE.PerspectiveCamera(
      30,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.5,
      160,
    );
    this.camTarget = new THREE.Vector3(0, 0.8, 0);
    this.camDesiredTarget = new THREE.Vector3(0, 0.8, 0);
    this.camOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.camDesiredOffset = new THREE.Vector3(0, 17.5, 20.5);
    this.shakeTime = 0;
    this.shakeAmp = 0;

    // Warm golden sun + cool sky bounce light
    this.hemiLight = new THREE.HemisphereLight(0xdff4ff, 0x74a35c, 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6e0, 2.05);
    this.sunLight.position.set(16, 28, 18);
    if (!this.isSoftwareGl) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      const d = 28;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 2;
      this.sunLight.shadow.camera.far = 78;
      this.sunLight.shadow.bias = -0.0005;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Optional hardware Tilt-Shift Miniature Postprocessing
    this.tiltShiftEnabled = !this.isSoftwareGl;
    this.composer = null;
    this.tiltPass = null;
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.tiltPass = new ShaderPass(TiltShiftMiniatureShader);
      this.tiltPass.uniforms.uResolution.value.set(
        window.innerWidth * this.renderer.getPixelRatio(),
        window.innerHeight * this.renderer.getPixelRatio(),
      );
      this.composer.addPass(this.tiltPass);
      this.composer.addPass(new OutputPass());
    }

    // Mini 3D Turntable Scene for the 20-Monkemon Board / MonkeDex inspector
    this.turntableScene = new THREE.Scene();
    this.turntableScene.background = new THREE.Color('#132338');
    this.turntableScene.environment = this.envTexture;
    this.turntableScene.environmentIntensity = 0.9;
    const ttHemi = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.1);
    const ttKey = new THREE.DirectionalLight(0xfffbeb, 2.1);
    ttKey.position.set(3, 5, 4);
    this.turntableScene.add(ttHemi, ttKey);
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.08, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.3, metalness: 0.35 }),
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
      this.tiltPass.uniforms.uResolution.value.set(w * pr, h * pr);
    }
  }

  toggleTiltShift() {
    if (this.isSoftwareGl) return false;
    this.tiltShiftEnabled = !this.tiltShiftEnabled;
    if (this.tiltPass) this.tiltPass.enabled = this.tiltShiftEnabled;
    return this.tiltShiftEnabled;
  }

  setZoneAtmosphere(zone) {
    this.scene.background.set(zone.skyColor || '#87dcff');
    this.scene.fog.color.set(zone.fogColor || zone.skyColor || '#9be4ff');
    if (zone.theme === 'volcano') {
      this.hemiLight.color.set('#ffe4e6');
      this.hemiLight.groundColor.set('#7c2d12');
      this.sunLight.color.set('#ffedd5');
    } else if (zone.theme === 'snow') {
      this.hemiLight.color.set('#e0f2fe');
      this.hemiLight.groundColor.set('#94a3b8');
      this.sunLight.color.set('#ffffff');
    } else {
      this.hemiLight.color.set('#dff4ff');
      this.hemiLight.groundColor.set('#74a35c');
      this.sunLight.color.set('#fff6e0');
    }
  }

  triggerShake(amp = 0.28, duration = 0.24) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  setCameraFraming(targetX, targetY, targetZ, mode = 'overworld', snap = false) {
    this.camDesiredTarget.set(targetX, targetY, targetZ);
    if (mode === 'battle') {
      this.camDesiredOffset.set(0, 13.8, 17.4);
    } else if (mode === 'catch') {
      this.camDesiredOffset.set(0, 9.2, 12.6);
    } else if (mode === 'title') {
      this.camDesiredOffset.set(4.5, 13.5, 17.5);
    } else {
      this.camDesiredOffset.set(0, 17.2, 20.2);
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

    // Optional live 3D MonkeDex turntable render into a 2D `<canvas>` without a second WebGL context
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

    if (this.composer && this.tiltShiftEnabled) {
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
