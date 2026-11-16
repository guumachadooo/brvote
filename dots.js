// dots.js — High-density voter dot layer with background pre-caching, perceptual iso-luminance (PL vs PT),
// local density luminance modulation ("filosofia dos pontos"), and fluid mirrored 3D/2D transitions
import * as THREE from 'three';
import { DOT_REP_HEX, DOT_DEM_HEX, DOT_OTH_HEX } from './colors.js';

const REP_COL = new THREE.Color(DOT_REP_HEX);
const DEM_COL = new THREE.Color(DOT_DEM_HEX);
const OTH_COL = new THREE.Color(DOT_OTH_HEX);

export function createDotLayer({ counties, group, getHeight, getPixelRatio }) {
  const dotGroup = new THREE.Group();
  dotGroup.visible = false;
  group.add(dotGroup);

  // Subtle county boundary outlines visible in dot mode
  const outlineGroup = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x263549,
    transparent: true,
    opacity: 0.48,
    depthWrite: false
  });
  for (const c of counties) {
    const linePts = [];
    for (const rings of c.polys) {
      const outer = rings[0];
      if (!outer || outer.length < 2) continue;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        linePts.push(a[0], 0.36, -a[1], b[0], 0.36, -b[1]);
      }
    }
    if (linePts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      outlineGroup.add(new THREE.LineSegments(g, lineMat));
    }
  }
  dotGroup.add(outlineGroup);

  const N = Math.max(1, counties.length);
  // R = county height (Y), G = normalized log electoral density (0..1), B = reserved, A = reserved
  const countyTexData = new Float32Array(N * 4);
  const countyTex = new THREE.DataTexture(countyTexData, N, 1, THREE.RGBAFormat, THREE.FloatType);
  countyTex.minFilter = THREE.NearestFilter;
  countyTex.magFilter = THREE.NearestFilter;

  function syncCountyHeightsToTex() {
    for (let i = 0; i < counties.length; i++) {
      const c = counties[i];
      countyTexData[i * 4] = c.currentH !== undefined ? c.currentH : (getHeight ? getHeight(c) : 0.35);
    }
    countyTex.needsUpdate = true;
  }

  function updateDensityTex(votesByCounty) {
    if (!votesByCounty) return;
    const logs = new Float32Array(counties.length);
    let minL = Infinity;
    let maxL = -Infinity;
    for (let i = 0; i < counties.length; i++) {
      const v = votesByCounty[i] || [0, 0, 0];
      const tot = (v[0] || 0) + (v[1] || 0) + (v[2] || 0);
      const area = Math.max(0.05, counties[i].area || 1);
      const d = Math.log1p(tot / area);
      logs[i] = d;
      if (tot > 0) {
        if (d < minL) minL = d;
        if (d > maxL) maxL = d;
      }
    }
    const span = Math.max(0.001, maxL - minL);
    for (let i = 0; i < counties.length; i++) {
      const norm = Math.max(0, Math.min(1, (logs[i] - minL) / span));
      countyTexData[i * 4 + 1] = Math.pow(norm, 0.85);
    }
    countyTex.needsUpdate = true;
  }

  let curRaise = 0.0;
  let targetRaise = 0.0;
  let curFade = 0.0;
  let targetFade = 0.0;
  let curScaleApp = 250;
  let hoverIdx = -1;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCountyTex: { value: countyTex },
      uCountyN: { value: N },
      uRaise: { value: 0.0 },
      uFade: { value: 0.0 },
      uBaseY: { value: 0.38 },
      uHover: { value: -1.0 },
      uPointScale: { value: 1.0 },
      uPixelRatio: { value: getPixelRatio ? getPixelRatio() : 1.5 },
      uRepCol: { value: new THREE.Vector3(REP_COL.r, REP_COL.g, REP_COL.b) },
      uDemCol: { value: new THREE.Vector3(DEM_COL.r, DEM_COL.g, DEM_COL.b) },
      uOthCol: { value: new THREE.Vector3(OTH_COL.r, OTH_COL.g, OTH_COL.b) }
    },
    vertexShader: `
      attribute vec4 aPacked;
      uniform sampler2D uCountyTex;
      uniform float uCountyN;
      uniform float uRaise;
      uniform float uFade;
      uniform float uBaseY;
      uniform float uHover;
      uniform float uPointScale;
      uniform float uPixelRatio;
      uniform vec3 uRepCol;
      uniform vec3 uDemCol;
      uniform vec3 uOthCol;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float x = aPacked.x / 300.0;
        float randY = aPacked.y / 30000.0;
        float z = aPacked.z / 300.0;
        int meta = int(aPacked.w + 0.5);
        int party = meta / 2048;
        int ci = meta - party * 2048;

        vec4 cData = texture2D(uCountyTex, vec2((float(ci) + 0.5) / uCountyN, 0.5));
        float colH = max(uBaseY, cData.r);
        float density = cData.g;

        vec3 baseCol = (party == 0) ? uRepCol : ((party == 1) ? uDemCol : uOthCol);

        // Filosofia dos Pontos: modulate luminance by local electoral density so sparse rural regions
        // remain calm and dark-adapted while dense urban centers glow with crisp intensity
        float lumMod = 0.56 + 0.54 * density;
        vColor = clamp(baseCol * lumMod, 0.0, 1.0);

        bool isHovered = (uHover < -0.5) || (abs(float(ci) - uHover) < 0.25);
        float densityAlpha = 0.50 + 0.45 * density;
        vAlpha = (isHovered ? densityAlpha : 0.16) * uFade;

        // When uRaise > 0, dots ride inside/on top of the 3D column height!
        float y3d = uBaseY + (0.22 + 0.78 * randY) * max(0.0, colH - uBaseY) + 0.18;
        float y = mix(uBaseY + 0.06, y3d, uRaise);

        vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float densitySize = 0.84 + 0.34 * density;
        float distScale = 340.0 / max(20.0, -mvPosition.z);
        float rawSize = uPointScale * densitySize * distScale * uPixelRatio * (isHovered && uHover >= 0.0 ? 1.22 : 1.0);
        gl_PointSize = clamp(rawSize, 1.75, 9.0) * (0.45 + 0.55 * uFade);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d2 = dot(p, p);
        if (d2 > 0.25) discard;
        float alpha = smoothstep(0.25, 0.07, d2) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `
  });

  let pointsMesh = null;
  const worker = new Worker('./dots-worker.js', { type: 'module' });
  let workerReady = false;
  let reqSeq = 0;
  const pendingCallbacks = new Map();

  // In-memory cache of generated packed Int16 buffers keyed by `${raceKey}:${scale}:${precinctRaceKey}`
  const dotBufferCache = new Map();
  let activeCacheKey = null;

  let prUrl = null;
  let prShapesUrl = null;
  let prLoadPromise = null;
  let prData = null;
  let prShapes = null;
  let lastSentPrRace = null;

  worker.postMessage({
    type: 'init',
    counties: counties.map((c) => ({ polys: c.polys }))
  });

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') {
      workerReady = true;
    } else if (m.type === 'dots') {
      const cb = pendingCallbacks.get(m.reqId);
      pendingCallbacks.delete(m.reqId);
      if (!cb) return;

      let totalDots = 0;
      for (const b of m.buffers) totalDots += b.length >> 2;
      const merged = new Int16Array(totalDots * 4);
      let off = 0;
      for (const b of m.buffers) {
        merged.set(b, off);
        off += b.length;
      }

      const payload = { merged, totalDots };
      if (cb.cacheKey) {
        dotBufferCache.set(cb.cacheKey, payload);
      }
      if (cb.apply) {
        applyPackedDots(payload);
      }
      if (cb.onDone) {
        cb.onDone({ totalDots });
      }
    }
  };

  function applyPackedDots({ merged, totalDots }) {
    if (pointsMesh) {
      dotGroup.remove(pointsMesh);
      pointsMesh.geometry.dispose();
      pointsMesh = null;
    }
    if (!totalDots) return;
    const geom = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(merged, 4, false);
    geom.setAttribute('aPacked', attr);
    // Provide a dummy position attribute bounding sphere so Three.js knows vertex count
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalDots * 3), 3));
    pointsMesh = new THREE.Points(geom, mat);
    pointsMesh.frustumCulled = false;
    pointsMesh.renderOrder = 3;
    dotGroup.add(pointsMesh);
  }

  function ensurePrecinctsForRace(raceKey) {
    if (!prUrl || !prShapesUrl) return Promise.resolve();
    if (!prLoadPromise) {
      prLoadPromise = Promise.all([
        fetch(prUrl).then((r) => (r.ok ? r.json() : null)),
        fetch(prShapesUrl).then((r) => (r.ok ? r.json() : null))
      ])
        .then(([d, s]) => {
          prData = d;
          prShapes = s;
        })
        .catch(() => {});
    }
    return prLoadPromise.then(() => {
      if (!prData || !prShapes || !prData.races) return;
      const raceKeys = Array.isArray(prData.races) ? prData.races : Object.keys(prData.races);
      const useRace = raceKeys.includes(raceKey) ? raceKey : raceKeys[0];
      if (!useRace || useRace === lastSentPrRace) return;
      lastSentPrRace = useRace;
      const rIdx = !Array.isArray(prData.races) ? prData.races[useRace] : useRace;
      const prs = counties.map((c) => {
        const list = prData.counties[c.name] || prData.counties[c.key];
        const sList = prShapes[c.name] || prShapes[c.key];
        if (!list || !sList) return null;
        const out = [];
        for (let i = 0; i < list.length; i++) {
          const polys = sList[i];
          if (!polys || !polys.length) continue;
          const v = list[i][3]?.[rIdx] || list[i][3]?.[useRace] || [1, 1, 0];
          out.push([v[0] || 0, v[1] || 0, v[2] || 0, polys]);
        }
        return out.length ? out : null;
      });
      worker.postMessage({ type: 'setPrecincts', prs });
    });
  }

  return {
    configurePrecincts(pUrl, sUrl) {
      prUrl = pUrl;
      prShapesUrl = sUrl;
    },

    setScaleAppearance(scale) {
      curScaleApp = scale;
      // Scale point size smoothly with voter-per-dot ratio
      const s = Math.max(0.75, Math.min(2.3, Math.pow(scale / 180, 0.28)));
      mat.uniforms.uPointScale.value = s;
    },

    setRaise(v, immediate = false) {
      targetRaise = Math.max(0, Math.min(1, v));
      if (immediate) {
        curRaise = targetRaise;
        mat.uniforms.uRaise.value = curRaise;
      }
    },

    setVisible(v, immediate = false) {
      targetFade = v ? 1.0 : 0.0;
      if (v) {
        dotGroup.visible = true;
      }
      if (immediate) {
        curFade = targetFade;
        mat.uniforms.uFade.value = curFade;
        dotGroup.visible = curFade > 0.005;
      }
    },

    setHover(ci) {
      hoverIdx = ci == null || ci < 0 ? -1 : ci;
      mat.uniforms.uHover.value = hoverIdx;
    },

    onResize() {
      if (getPixelRatio) {
        mat.uniforms.uPixelRatio.value = getPixelRatio();
      }
    },

    generate({ votesByCounty, scale, seedSalt, raceKey }, onDone) {
      updateDensityTex(votesByCounty);
      syncCountyHeightsToTex();
      const cacheKey = `${raceKey || seedSalt}:${scale}`;

      // Instantaneous 0ms restore from cache if already generated!
      const cached = dotBufferCache.get(cacheKey);
      if (cached) {
        if (activeCacheKey !== cacheKey || !pointsMesh) {
          activeCacheKey = cacheKey;
          applyPackedDots(cached);
        }
        if (onDone) onDone({ totalDots: cached.totalDots, fromCache: true });
        return;
      }

      ensurePrecinctsForRace(raceKey).then(() => {
        const reqId = ++reqSeq;
        pendingCallbacks.set(reqId, {
          cacheKey,
          apply: true,
          onDone(res) {
            activeCacheKey = cacheKey;
            if (onDone) onDone(res);
          }
        });
        worker.postMessage({
          type: 'generate',
          reqId,
          votes: votesByCounty,
          scale,
          seedSalt
        });
      });
    },

    // Preload dot buffers silently in the background worker so switching to Pontos has zero lag
    preload({ votesByCounty, scale, seedSalt, raceKey }) {
      if (!votesByCounty) return;
      const cacheKey = `${raceKey || seedSalt}:${scale}`;
      if (dotBufferCache.has(cacheKey)) return;
      updateDensityTex(votesByCounty);
      ensurePrecinctsForRace(raceKey).then(() => {
        if (dotBufferCache.has(cacheKey)) return;
        const reqId = ++reqSeq;
        pendingCallbacks.set(reqId, {
          cacheKey,
          apply: false,
          onDone: null
        });
        worker.postMessage({
          type: 'generate',
          reqId,
          votes: votesByCounty,
          scale,
          seedSalt
        });
      });
    },

    isCached(raceKey, scale, seedSalt) {
      const cacheKey = `${raceKey || seedSalt}:${scale}`;
      return dotBufferCache.has(cacheKey);
    },

    tick(dt) {
      if (!dotGroup.visible && targetFade <= 0.001) return;

      const speed = 5.2;
      if (Math.abs(curFade - targetFade) > 0.002) {
        curFade += (targetFade - curFade) * Math.min(1, dt * speed);
        if (Math.abs(curFade - targetFade) < 0.004) curFade = targetFade;
        mat.uniforms.uFade.value = curFade;
        lineMat.opacity = 0.48 * curFade;
      }
      if (Math.abs(curRaise - targetRaise) > 0.002) {
        curRaise += (targetRaise - curRaise) * Math.min(1, dt * 5.8);
        if (Math.abs(curRaise - targetRaise) < 0.004) curRaise = targetRaise;
        mat.uniforms.uRaise.value = curRaise;
      }

      if (curRaise > 0.005) {
        syncCountyHeightsToTex();
      }

      if (curFade <= 0.005 && targetFade <= 0.005) {
        dotGroup.visible = false;
      }
    }
  };
}
