// Custom GLSL Realism & Atmospheric Shaders for Monkemon 2.5D
// - `createOceanMagmaShaderMaterial`: Gerstner vertex waves, dual-layer normal ripples, Schlick Fresnel
//   sky reflection, cellular shallow-water caustics, GGX solar specular glints, SDF island shoreline surf foam,
//   and convective glowing basalt-crust magma for Zone 5!
// - `attachTerrainDetailShader`: Enhances Nano Banana PBR `MeshStandardMaterial` (`map` + `normalMap`) with
//   anti-tiling macro variation, drifting overhead cloud-dappled sunlight, and edge ambient occlusion.
// - `attachWindGrassShader`: Rolling GPU wind-gust waves + interactive hero/creature grass parting +
//   root-to-tip ambient occlusion + warm sunlight subsurface scattering translucency.
// - `createSunbeamShaderMaterial`: Soft Fresnel-faded volumetric golden sun shafts.
// - `createHoloArenaShaderMaterial`: Animated tactical holographic battle field shader.

import * as THREE from 'three';

/**
 * Shared JS + GLSL Organic Island Coastline Radius (normalized around `(halfW, halfD)` ellipse).
 * Produces natural bays, coves, headlands, and gateway peninsulas instead of rectangular boxes!
 */
export function computeCoastRadiusNorm(theta, coastParams = [0.1, 0.08, 0.05, 0.7], lobeDirs = []) {
  const [a2 = 0.1, a3 = 0.08, a5 = 0.05, phase = 0.7] = coastParams;
  let r =
    0.96 +
    a2 * Math.cos(2.0 * theta + phase) +
    a3 * Math.sin(3.0 * theta - phase * 1.35) +
    a5 * Math.cos(5.0 * theta + phase * 2.1);

  for (const lAngle of lobeDirs) {
    let d = theta - lAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r = Math.max(r, 1.03 * Math.exp(-(d * d) / 0.11));
  }
  return Math.max(0.72, Math.min(1.16, r));
}

export function createOceanMagmaShaderMaterial({
  waterColor = '#1496c8',
  deepColor = '#0a4a78',
  skyColor = '#9be4ff',
  fogColor = '#9be4ff',
  fogNear = 38,
  fogFar = 86,
  sunDir = new THREE.Vector3(0.45, 0.78, 0.42).normalize(),
  islandHalfW = 24,
  islandHalfD = 20,
  coastParams = [0.1, 0.08, 0.05, 0.7],
  lobeDirs = [],
  theme = 'tropical',
}) {
  const isVolcano = theme === 'volcano';
  const isSnow = theme === 'snow';

  const shallow = new THREE.Color(waterColor);
  const deep = new THREE.Color(
    isVolcano ? '#290d06' : isSnow ? '#1e567c' : deepColor,
  );
  const sky = new THREE.Color(skyColor);
  const fogC = new THREE.Color(fogColor);
  const lobesPadded = [-99, -99, -99, -99];
  for (let i = 0; i < Math.min(4, lobeDirs.length); i++) lobesPadded[i] = lobeDirs[i];

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallowColor: { value: shallow },
      uDeepColor: { value: deep },
      uSkyColor: { value: sky },
      uFogColor: { value: fogC },
      uFogNear: { value: fogNear },
      uFogFar: { value: fogFar },
      uSunDir: { value: sunDir.clone().normalize() },
      uIslandHalf: { value: new THREE.Vector2(islandHalfW + 0.9, islandHalfD + 0.9) },
      uCoastParams: {
        value: new THREE.Vector4(
          coastParams[0] ?? 0.1,
          coastParams[1] ?? 0.08,
          coastParams[2] ?? 0.05,
          coastParams[3] ?? 0.7,
        ),
      },
      uLobeDirs: {
        value: new THREE.Vector4(lobesPadded[0], lobesPadded[1], lobesPadded[2], lobesPadded[3]),
      },
      uIsVolcano: { value: isVolcano ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIsVolcano;
      varying vec3 vWorldPos;
      varying vec3 vWaveNormal;
      varying float vFogDepth;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float speed = uIsVolcano > 0.5 ? 0.85 : 1.75;
        float amp = uIsVolcano > 0.5 ? 0.055 : 0.11;

        float w1 = sin(wp.x * 0.34 + uTime * speed) * cos(wp.z * 0.28 + uTime * speed * 0.82);
        float w2 = sin((wp.x * 0.62 - wp.z * 0.51) + uTime * speed * 1.35) * 0.5;
        wp.y += (w1 + w2) * amp;

        // Analytical wave slope for vertex normal base
        float dx = cos(wp.x * 0.34 + uTime * speed) * 0.34 * amp;
        float dz = -sin(wp.z * 0.28 + uTime * speed * 0.82) * 0.28 * amp;
        vWaveNormal = normalize(vec3(-dx, 1.0, -dz));
        vWorldPos = wp.xyz;

        vec4 mvPosition = viewMatrix * wp;
        vFogDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uSkyColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uSunDir;
      uniform vec2 uIslandHalf;
      uniform vec4 uCoastParams;
      uniform vec4 uLobeDirs;
      uniform float uIsVolcano;

      varying vec3 vWorldPos;
      varying vec3 vWaveNormal;
      varying float vFogDepth;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      // Fast cellular caustic / magma crack pattern
      float voronoiCaustic(vec2 uv, float t) {
        vec2 g = floor(uv);
        vec2 f = fract(uv);
        float minDist = 1.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 lattice = vec2(float(x), float(y));
            float h = hash21(g + lattice);
            vec2 offset = 0.5 + 0.42 * sin(t + 6.2831 * vec2(h, fract(h * 17.3)));
            float d = length(lattice + offset - f);
            minDist = min(minDist, d);
          }
        }
        return minDist;
      }

      float wrapAngleDiff(float a, float b) {
        float d = mod(a - b + 3.14159265, 6.2831853) - 3.14159265;
        return d;
      }

      float organicCoastShoreDist(vec2 xz) {
        vec2 normP = xz / max(vec2(1.0), uIslandHalf);
        float theta = atan(normP.y, normP.x);
        float rNorm = 0.96
          + uCoastParams.x * cos(2.0 * theta + uCoastParams.w)
          + uCoastParams.y * sin(3.0 * theta - uCoastParams.w * 1.35)
          + uCoastParams.z * cos(5.0 * theta + uCoastParams.w * 2.1);

        if (uLobeDirs.x > -50.0) {
          float d0 = wrapAngleDiff(theta, uLobeDirs.x);
          rNorm = max(rNorm, 1.03 * exp(-(d0 * d0) / 0.11));
        }
        if (uLobeDirs.y > -50.0) {
          float d1 = wrapAngleDiff(theta, uLobeDirs.y);
          rNorm = max(rNorm, 1.03 * exp(-(d1 * d1) / 0.11));
        }
        if (uLobeDirs.z > -50.0) {
          float d2 = wrapAngleDiff(theta, uLobeDirs.z);
          rNorm = max(rNorm, 1.03 * exp(-(d2 * d2) / 0.11));
        }
        if (uLobeDirs.w > -50.0) {
          float d3 = wrapAngleDiff(theta, uLobeDirs.w);
          rNorm = max(rNorm, 1.03 * exp(-(d3 * d3) / 0.11));
        }
        rNorm = clamp(rNorm, 0.72, 1.16);
        float avgScale = 0.5 * (uIslandHalf.x + uIslandHalf.y);
        return (length(normP) - rNorm) * avgScale;
      }

      void main() {
        vec2 xz = vWorldPos.xz;
        float shoreDist = organicCoastShoreDist(xz);

        if (uIsVolcano > 0.5) {
          // Convective glowing magma & dark cooling obsidian crust plates
          vec2 flowUv = xz * 0.28 + vec2(uTime * 0.06, -uTime * 0.045);
          float cell = voronoiCaustic(flowUv, uTime * 0.55);
          float crack = smoothstep(0.36, 0.04, cell);
          float pulse = 0.85 + 0.15 * sin(uTime * 2.6 + xz.x * 0.4);

          vec3 crust = vec3(0.11, 0.08, 0.07);
          vec3 lavaMid = vec3(0.94, 0.34, 0.06);
          vec3 lavaCore = vec3(1.0, 0.88, 0.32);

          vec3 col = mix(crust, lavaMid, smoothstep(0.12, 0.65, crack));
          col = mix(col, lavaCore, smoothstep(0.62, 0.96, crack) * pulse);

          // Glowing shoreline heat rim around volcanic island base
          float rimHeat = exp(-max(0.0, shoreDist) * 0.55);
          col += vec3(1.0, 0.48, 0.1) * rimHeat * (0.65 + 0.25 * sin(uTime * 3.2 - shoreDist * 2.0));

          float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
          col = mix(col, uFogColor, fogFactor * 0.85);
          gl_FragColor = vec4(col, 1.0);
          return;
        }

        // Dual scrolling micro-ripple normal perturbation
        vec2 uv1 = xz * 0.42 + vec2(uTime * 0.22, uTime * 0.16);
        vec2 uv2 = xz * 0.67 + vec2(-uTime * 0.18, uTime * 0.25);
        float n1x = sin(uv1.x * 3.1 + cos(uv1.y * 2.7));
        float n1z = cos(uv1.y * 3.3 + sin(uv1.x * 2.5));
        float n2x = cos(uv2.x * 4.1 - uv2.y * 2.9);
        float n2z = sin(uv2.y * 3.9 + uv2.x * 3.2);

        vec3 N = normalize(vWaveNormal + vec3((n1x + n2x * 0.6) * 0.11, 0.0, (n1z + n2z * 0.6) * 0.11));
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 H = normalize(uSunDir + V);

        // Shallow shelf -> deep ocean color absorption
        float shelfFactor = exp(-max(0.0, shoreDist) * 0.16);
        vec3 baseWater = mix(uDeepColor, uShallowColor, shelfFactor);

        // Animated cellular caustics visible in clear shallow shelf water
        float c1 = voronoiCaustic(xz * 0.52 + N.xz * 0.35, uTime * 0.95);
        float caustic = pow(clamp(c1 * 1.18, 0.0, 1.0), 3.6);
        baseWater += vec3(0.36, 0.88, 0.98) * caustic * (0.18 + 0.42 * shelfFactor);

        // Schlick Fresnel sky reflection
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.2);
        vec3 col = mix(baseWater, uSkyColor * 1.04, clamp(fresnel * 0.68, 0.0, 0.72));

        // Crisp sparkling solar specular highlights
        float specTight = pow(max(dot(N, H), 0.0), 140.0);
        float specBroad = pow(max(dot(N, H), 0.0), 26.0);
        col += vec3(1.0, 0.97, 0.86) * (specTight * 1.35 + specBroad * 0.16);

        // Animated multi-band breaking shoreline surf foam around island cliff!
        if (shoreDist > -0.8 && shoreDist < 4.2) {
          float waveOsc = sin(shoreDist * 3.4 - uTime * 3.1 + sin(xz.x * 0.8 + xz.y * 0.8) * 0.9);
          float primarySurf = smoothstep(0.65, 0.0, abs(shoreDist - 0.35 - 0.22 * sin(uTime * 2.1 + xz.x * 0.5)));
          float secondaryRipple = smoothstep(0.55, 0.92, waveOsc) * exp(-max(0.0, shoreDist) * 0.62);
          float foamMask = clamp(primarySurf * 0.92 + secondaryRipple * 0.68, 0.0, 1.0);
          col = mix(col, vec3(0.95, 0.99, 1.0), foamMask);
        }

        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fogFactor);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function attachTerrainDetailShader(
  material,
  {
    uTime,
    islandHalfW = 24,
    islandHalfD = 20,
    warmTint = '#fffbeb',
    coolShade = '#1e3a5f',
    dappleStrength = 0.15,
  } = {},
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime || { value: 0 };
    shader.uniforms.uIslandHalf = { value: new THREE.Vector2(islandHalfW, islandHalfD) };
    shader.uniforms.uWarmTint = { value: new THREE.Color(warmTint) };
    shader.uniforms.uCoolShade = { value: new THREE.Color(coolShade) };
    shader.uniforms.uDappleStrength = { value: dappleStrength };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vMonkeWorldPos;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vMonkeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform vec2 uIslandHalf;
        uniform vec3 uWarmTint;
        uniform vec3 uCoolShade;
        uniform float uDappleStrength;
        varying vec3 vMonkeWorldPos;
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        {
          // Anti-tiling macro organic lushness + drifting cloud-dappled sunlight
          vec2 wp = vMonkeWorldPos.xz;
          float macro = sin(wp.x * 0.23 + cos(wp.y * 0.19)) * cos(wp.y * 0.21 - sin(wp.x * 0.17));
          diffuseColor.rgb *= (0.95 + 0.09 * macro);

          float cloud1 = sin(wp.x * 0.14 + uTime * 0.28 + cos(wp.y * 0.12 - uTime * 0.18));
          float cloud2 = cos((wp.x - wp.y) * 0.11 + uTime * 0.21);
          float sunlit = smoothstep(-0.35, 0.55, cloud1 * 0.6 + cloud2 * 0.4);
          vec3 dappleTint = mix(mix(vec3(1.0), uCoolShade, 0.28), uWarmTint, sunlit);
          diffuseColor.rgb *= mix(vec3(1.0), dappleTint, uDappleStrength);

          // Subtle perimeter cliff-rim ambient grounding
          vec2 edgeRatio = abs(wp) / max(vec2(1.0), uIslandHalf);
          float edgeRim = smoothstep(0.84, 1.02, max(edgeRatio.x, edgeRatio.y));
          diffuseColor.rgb *= (1.0 - edgeRim * 0.14);
        }
        `,
      );
  };
  material.customProgramCacheKey = () => `monke-terrain-detail-${dappleStrength.toFixed(2)}`;
  return material;
}

export function attachCliffWetnessShader(
  material,
  { uTime, waterLevel = -0.82, mossColor = '#4d7c0f', isVolcano = false } = {},
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime || { value: 0 };
    shader.uniforms.uWaterLevel = { value: waterLevel };
    shader.uniforms.uMossColor = { value: new THREE.Color(mossColor) };
    shader.uniforms.uIsVolcano = { value: isVolcano ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vCliffWorldPos;
        varying vec3 vCliffWorldNormal;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vCliffWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCliffWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaterLevel;
        uniform vec3 uMossColor;
        uniform float uIsVolcano;
        varying vec3 vCliffWorldPos;
        varying vec3 vCliffWorldNormal;
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        {
          float heightAboveSea = vCliffWorldPos.y - uWaterLevel;
          float tideLine = 0.28 + 0.07 * sin(uTime * 1.9 + vCliffWorldPos.x * 0.6);
          float wetness = 1.0 - smoothstep(0.0, tideLine, heightAboveSea);

          if (uIsVolcano > 0.5) {
            // Glowing magma heat reflection along lower basalt cliff wall
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.42, 0.08), wetness * 0.58);
          } else {
            // Realistic dark wet coastal rock band along the surf line + mossy upper lip
            diffuseColor.rgb *= mix(1.0, 0.56, wetness);
            float upMask = smoothstep(0.35, 0.85, vCliffWorldNormal.y) * smoothstep(-0.35, 0.15, vCliffWorldPos.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, uMossColor, upMask * 0.24);
          }
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        {
          float heightAboveSea = vCliffWorldPos.y - uWaterLevel;
          float wetness = 1.0 - smoothstep(0.0, 0.34, heightAboveSea);
          roughnessFactor = mix(roughnessFactor, 0.16, wetness * (1.0 - uIsVolcano));
        }
        `,
      );
  };
  material.customProgramCacheKey = () => `monke-cliff-wet-${isVolcano ? 1 : 0}`;
  return material;
}

export function attachFoliageSubsurfaceShader(
  material,
  { uTime, windAmp = 0.065, sssColor = '#bef264' } = {},
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime || { value: 0 };
    shader.uniforms.uWindAmp = { value: windAmp };
    shader.uniforms.uSssColor = { value: new THREE.Color(sssColor) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindAmp;
        varying vec3 vFolWorldPos;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          float sway = sin(uTime * 2.1 + wp0.x * 0.65 + wp0.z * 0.52) * uWindAmp;
          transformed.x += sway;
          transformed.z += cos(uTime * 1.7 + wp0.z * 0.6) * (uWindAmp * 0.7);
        }
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vFolWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSssColor;
        varying vec3 vFolWorldPos;
        `,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          // Warm backlit foliage subsurface translucency + canopy height radiance
          vec3 viewDirW = normalize(cameraPosition - vFolWorldPos);
          vec3 sunDirW = normalize(vec3(0.45, 0.78, 0.42));
          float backScatter = pow(clamp(dot(viewDirW, -sunDirW) * 0.5 + 0.5, 0.0, 1.0), 2.4);
          reflectedLight.directDiffuse += uSssColor * diffuseColor.rgb * backScatter * 0.34;
        }
        `,
      );
  };
  material.customProgramCacheKey = () => `monke-foliage-sss-${windAmp.toFixed(3)}`;
  return material;
}

export function attachWindGrassShader(
  material,
  { uTime, uHeroPos, windStrength = 0.22, sunDir = new THREE.Vector3(0.45, 0.78, 0.42).normalize() } = {},
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime || { value: 0 };
    shader.uniforms.uHeroPos = uHeroPos || { value: new THREE.Vector3(0, -99, 0) };
    shader.uniforms.uWindStrength = { value: windStrength };
    shader.uniforms.uSunDir = { value: sunDir.clone().normalize() };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform vec3 uHeroPos;
        uniform float uWindStrength;
        varying float vBladeH;
        varying float vGust;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          float h = clamp(position.y / 0.62, 0.0, 1.0);
          vBladeH = h;
          float bendMask = h * h;

          vec4 instOrigin = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            instOrigin = instanceMatrix * instOrigin;
          #endif
          vec4 worldBase = modelMatrix * instOrigin;

          float gust = sin(worldBase.x * 0.42 + uTime * 2.55) * cos(worldBase.z * 0.36 + uTime * 1.95)
                     + 0.45 * sin((worldBase.x + worldBase.z) * 0.75 + uTime * 3.8);
          vGust = gust;

          transformed.x += gust * uWindStrength * bendMask;
          transformed.z += cos(worldBase.z * 0.48 + uTime * 2.15) * (uWindStrength * 0.65) * bendMask;
          transformed.y -= abs(gust) * 0.05 * bendMask;

          // Interactive player & follower creature grass parting!
          vec2 toBlade = worldBase.xz - uHeroPos.xz;
          float distHero = length(toBlade);
          if (distHero < 1.65 && distHero > 0.001) {
            float push = (1.0 - distHero / 1.65);
            vec2 dir = toBlade / distHero;
            transformed.x += dir.x * push * 0.42 * bendMask;
            transformed.z += dir.y * push * 0.42 * bendMask;
            transformed.y -= push * 0.14 * bendMask;
          }
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform vec3 uSunDir;
        varying float vBladeH;
        varying float vGust;
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          // Root-to-tip ambient occlusion + warm sunlit tip translucency!
          float ao = mix(0.46, 1.18, smoothstep(0.0, 0.92, vBladeH));
          vec3 tipGlow = vec3(0.95, 1.02, 0.65) * smoothstep(0.45, 1.0, vBladeH) * (0.16 + 0.08 * max(0.0, vGust));
          diffuseColor.rgb = diffuseColor.rgb * ao + tipGlow * diffuseColor.rgb;
        }
        `,
      );
  };
  material.customProgramCacheKey = () => 'monke-wind-grass-v2';
  return material;
}

export function createSunbeamShaderMaterial({ color = '#fff3b0', opacity = 0.13 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;

      void main() {
        // Soft vertical fade at both ends + cylindrical edge Fresnel fade so rays look volumetric
        float vFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.18, vUv.y);
        float edgeFade = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.75);
        float shimmer = 0.82 + 0.18 * sin(uTime * 1.4 + vUv.x * 12.566);
        float alpha = vFade * edgeFade * shimmer * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}

export function createHoloArenaShaderMaterial({
  primaryColor = '#38bdf8',
  accentColor = '#fde047',
  playerColor = '#f59e0b',
  enemyColor = '#ef4444',
  intensity = 1.0,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPrimary: { value: new THREE.Color(primaryColor) },
      uAccent: { value: new THREE.Color(accentColor) },
      uPlayerColor: { value: new THREE.Color(playerColor) },
      uEnemyColor: { value: new THREE.Color(enemyColor) },
      uIntensity: { value: intensity },
      uShockOrigin: { value: new THREE.Vector2(0, 0) },
      uShockProgress: { value: -1.0 },
      uShockColor: { value: new THREE.Color('#fde047') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv * 2.0 - 1.0; // -1..1 across arena disk
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uPrimary;
      uniform vec3 uAccent;
      uniform vec3 uPlayerColor;
      uniform vec3 uEnemyColor;
      uniform float uIntensity;
      uniform vec2 uShockOrigin;
      uniform float uShockProgress;
      uniform vec3 uShockColor;

      varying vec2 vUv;
      varying vec3 vWorldPos;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += amp * noise2D(p);
          p = rot * p * 2.04 + vec2(1.7, 9.2);
          amp *= 0.5;
        }
        return v;
      }

      // Distance to nearest hexagon edge for holographic honeycomb lattice
      float hexEdgeDist(vec2 p) {
        const vec2 s = vec2(1.0, 1.7320508);
        vec2 a = mod(p, s) - 0.5 * s;
        vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        vec2 ab = abs(gv);
        float hexR = max(ab.x, dot(ab, normalize(vec2(1.0, 1.7320508))));
        return abs(0.5 - hexR);
      }

      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;

        float theta = atan(vUv.y, vUv.x);

        // 1. Split Elemental Territory Nebula (Player Left vs Foe Right + clashing plasma fault line!)
        float warp = (fbm(vUv * 3.4 + vec2(0.0, uTime * 0.55)) - 0.5) * 0.22;
        float sideBlend = smoothstep(-0.18, 0.18, vUv.x + warp);
        vec3 sideColor = mix(uPlayerColor, uEnemyColor, sideBlend);

        float nebulaA = fbm(vUv * 2.8 + vec2(uTime * 0.22, -uTime * 0.18));
        float nebulaB = fbm(vUv * 5.4 - vec2(uTime * 0.31, uTime * 0.27));
        float plasma = smoothstep(0.28, 0.86, nebulaA * 0.62 + nebulaB * 0.48);

        // Crackling lightning seam along center duel line
        float centerFault = exp(-abs(vUv.x + warp * 0.65) * 26.0) * (0.55 + 0.45 * sin(vUv.y * 18.0 - uTime * 7.0));

        // 2. Holographic Hexagonal Energy Lattice
        float hexD = hexEdgeDist(vUv * 6.5);
        float hexWave = 0.5 + 0.5 * sin(r * 10.0 - uTime * 2.4 + nebulaA * 3.0);
        float hexLine = smoothstep(0.055, 0.008, hexD) * (0.16 + 0.26 * hexWave);

        // 3. Counter-Rotating Sacred Glyph / Telemetry Rings
        float outerGlyphBand = smoothstep(0.045, 0.006, abs(r - 0.90));
        float outerTicks = smoothstep(0.35, 0.85, sin(theta * 24.0 + uTime * 1.35)) * smoothstep(0.07, 0.01, abs(r - 0.855));

        float midGlyphBand = smoothstep(0.022, 0.003, abs(r - 0.62));
        float midRunes = step(0.35, sin(theta * 16.0 - uTime * 1.9)) * smoothstep(0.04, 0.008, abs(r - 0.62));

        float innerCoreRing = smoothstep(0.024, 0.003, abs(r - 0.26));
        float starSpokes = smoothstep(0.965, 0.998, cos(theta * 8.0 + uTime * 0.45)) * smoothstep(0.24, 0.88, r) * 0.28;

        // Traveling harmonic radar pulse
        float radarPhase = fract(r * 1.8 - uTime * 0.38);
        float radarRing = smoothstep(0.09, 0.0, abs(radarPhase - 0.5)) * (1.0 - r * 0.45) * 0.32;

        // Outer rim containment glow
        float rimGlow = smoothstep(0.80, 0.995, r);

        // 4. Live Reactive Attack / Catch Shockwave (uShockProgress in 0..1)
        float shockGlow = 0.0;
        if (uShockProgress >= 0.0 && uShockProgress <= 1.0) {
          float distShock = length(vUv - uShockOrigin);
          float shockRadius = uShockProgress * 1.45;
          float fade = 1.0 - smoothstep(0.55, 1.0, uShockProgress);
          float ringMain = smoothstep(0.11, 0.0, abs(distShock - shockRadius));
          float ringEcho = smoothstep(0.06, 0.0, abs(distShock - max(0.0, shockRadius - 0.16))) * 0.55;
          shockGlow = (ringMain + ringEcho) * fade;
        }

        // Compose rich high-contrast layered shader color over the dark obsidian stadium dais
        vec3 baseDark = vec3(0.03, 0.06, 0.14);
        vec3 col = mix(baseDark, sideColor * 0.92, 0.28 + plasma * 0.62);
        col += sideColor * (hexLine * 1.15 + radarRing * 1.05);
        col += uPrimary * (midGlyphBand * 0.95 + starSpokes * 1.25);
        col += uAccent * (outerGlyphBand * 1.15 + outerTicks * 1.0 + midRunes * 0.9 + innerCoreRing * 1.05 + centerFault * 1.45);
        col += mix(sideColor, uAccent, 0.48) * rimGlow * 1.1;
        col += uShockColor * shockGlow * 2.1;
        col *= (0.98 + 0.18 * uIntensity);

        float alpha = 0.82
          + plasma * 0.10
          + hexLine * 0.12
          + (outerGlyphBand + centerFault + rimGlow + shockGlow) * 0.15;

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.97));
      }
    `,
  });
}

/**
 * Translucent 3D Fresnel Hexagonal Stadium Forcefield Cylinder around the Battle Ring.
 * Clear in the center sightline, shimmering with elemental plasma & hex cells around the edges!
 */
export function createBattleBarrierDomeShaderMaterial({
  playerColor = '#f59e0b',
  enemyColor = '#38bdf8',
  accentColor = '#fde047',
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPlayerColor: { value: new THREE.Color(playerColor) },
      uEnemyColor: { value: new THREE.Color(enemyColor) },
      uAccent: { value: new THREE.Color(accentColor) },
      uPulse: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uPlayerColor;
      uniform vec3 uEnemyColor;
      uniform vec3 uAccent;
      uniform float uPulse;

      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;

      float hexWall(vec2 p) {
        const vec2 s = vec2(1.0, 1.7320508);
        vec2 a = mod(p, s) - 0.5 * s;
        vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        vec2 ab = abs(gv);
        float r = max(ab.x, dot(ab, normalize(vec2(1.0, 1.7320508))));
        return smoothstep(0.07, 0.012, abs(0.5 - r));
      }

      void main() {
        // Strong bottom anchor fading smoothly upward so sky & creatures remain crisp
        float hFade = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - clamp(vUv.y, 0.0, 1.0), 1.85);
        // Grazing-angle Fresnel glow on left/right curvature of cylinder
        float ndotv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float fresnel = mix(0.22, 1.0, pow(1.0 - ndotv, 2.1));

        float side = smoothstep(-2.0, 2.0, vLocalPos.x);
        vec3 sideCol = mix(uPlayerColor, uEnemyColor, side);

        float hex = hexWall(vec2(vUv.x * 28.0, vUv.y * 5.2 - uTime * 0.35));
        float scan = smoothstep(0.18, 0.0, abs(fract(vUv.y * 2.5 - uTime * 0.55) - 0.5));
        float baseBand = smoothstep(0.12, 0.0, vUv.y);

        vec3 col = sideCol * (0.55 + hex * 1.15 + scan * 0.85) + uAccent * (baseBand * 1.05 + uPulse * 0.85);
        float alpha = hFade * fresnel * (0.22 + hex * 0.34 + scan * 0.22 + baseBand * 0.38 + uPulse * 0.28);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.68));
      }
    `,
  });
}

/**
 * Spinning Elemental Summon Pedestal Halo placed directly beneath each Combatant in Battle!
 */
export function createCombatantPadShaderMaterial({ color = '#38bdf8' } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uFlare: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uFlare;
      varying vec2 vUv;

      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float a = atan(vUv.y, vUv.x);

        float outerRing = smoothstep(0.045, 0.008, abs(r - 0.88));
        float runeArcs = step(0.15, sin(a * 10.0 + uTime * 2.6)) * smoothstep(0.06, 0.012, abs(r - 0.74));
        float innerSpin = step(0.0, cos(a * 6.0 - uTime * 3.4)) * smoothstep(0.05, 0.01, abs(r - 0.48));
        float coreGlow = smoothstep(0.65, 0.0, r) * (0.32 + 0.12 * sin(uTime * 4.2));
        float flareWave = uFlare * smoothstep(0.16, 0.0, abs(r - fract(uTime * 2.2)));

        float intensity = outerRing * 1.1 + runeArcs * 0.85 + innerSpin * 0.7 + coreGlow + flareWave * 1.4;
        vec3 col = mix(uColor, vec3(1.0, 0.98, 0.88), clamp(outerRing * 0.55 + uFlare * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(col * (1.0 + uFlare * 0.8), clamp(intensity * 0.72, 0.0, 0.92));
      }
    `,
  });
}

/**
 * Twisted 3D Volumetric Elemental Beam / Vortex Shader for Signature Attacks & Healing Pillars!
 */
export function createElementalBeamShaderMaterial({
  coreColor = '#ffffff',
  glowColor = '#38bdf8',
  twist = 5.5,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0.5 },
      uCoreColor: { value: new THREE.Color(coreColor) },
      uGlowColor: { value: new THREE.Color(glowColor) },
      uTwist: { value: twist },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uTwist;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec3 p = position;
        float pulse = 1.0 + 0.22 * sin(uv.y * 16.0 - uTime * 22.0);
        float angle = uv.y * uTwist - uTime * 10.0;
        p.x *= pulse;
        p.z *= pulse;
        // Subtle helical spiral displacement
        p.x += cos(angle) * 0.08 * sin(uv.y * 3.14159);
        p.z += sin(angle) * 0.08 * sin(uv.y * 3.14159);

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uCoreColor;
      uniform vec3 uGlowColor;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;

      void main() {
        // Head-to-tail beam reveal & fade based on uProgress (0..1)
        float front = smoothstep(uProgress + 0.12, max(0.0, uProgress - 0.25), vUv.y);
        float endCaps = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
        float lifeFade = 1.0 - smoothstep(0.72, 1.0, uProgress);

        float centerAxis = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.35);
        float spiralA = 0.5 + 0.5 * sin(vUv.x * 18.849 + vUv.y * 20.0 - uTime * 26.0);
        float spiralB = 0.5 + 0.5 * cos(vUv.x * 12.566 - vUv.y * 14.0 - uTime * 18.0);
        float energy = 0.45 + 0.55 * spiralA * spiralB;

        vec3 col = mix(uGlowColor, uCoreColor, smoothstep(0.35, 0.92, centerAxis * energy));
        float alpha = front * endCaps * lifeFade * (0.35 + centerAxis * 0.75) * energy;
        gl_FragColor = vec4(col * 1.45, clamp(alpha, 0.0, 0.96));
      }
    `,
  });
}

/**
 * Expanding Supersonic Elemental Impact Shockwave Ring Shader on Hit / Super-Effective Strike / Catch!
 */
export function createBattleImpactWaveShaderMaterial({
  color = '#fde047',
  accentColor = '#ffffff',
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uProgress: { value: 0.0 },
      uColor: { value: new THREE.Color(color) },
      uAccent: { value: new THREE.Color(accentColor) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uAccent;
      varying vec2 vUv;

      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float theta = atan(vUv.y, vUv.x);

        float waveR = 0.15 + uProgress * 0.82;
        float mainRing = smoothstep(0.13, 0.0, abs(r - waveR));
        float innerEcho = smoothstep(0.08, 0.0, abs(r - max(0.05, waveR - 0.22))) * 0.65;
        float starburst = pow(max(0.0, cos(theta * 12.0 + uProgress * 8.0)), 6.0) * smoothstep(waveR + 0.08, 0.0, r) * 0.7;
        float fade = 1.0 - smoothstep(0.35, 1.0, uProgress);

        vec3 col = mix(uColor, uAccent, clamp(mainRing * 0.7 + starburst, 0.0, 1.0));
        float alpha = (mainRing * 1.15 + innerEcho + starburst) * fade;
        gl_FragColor = vec4(col * 1.5, clamp(alpha, 0.0, 0.95));
      }
    `,
  });
}
