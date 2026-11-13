// Renderizador WebGL de Pontos original do usavote (adaptado para PT vermelho / PL azul e até 2047 municípios)
import * as THREE from 'three';

const DOT_C = {
  rep:   '#6c7dff',
  dem:   '#ff3b3b',
  other: '#9aa6b8',
};

const VERT = /* glsl */`
  precision highp float;
  attribute vec4 position;
  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
  uniform sampler2D uCounty;
  uniform float uCountyW;
  uniform float uHasHeight;
  uniform float uPointBase;
  uniform float uPixelRatio;
  varying float vParty;
  varying float vDim;
  void main() {
    vec3 pos = vec3(position.x, 0.0, position.z) / 300.0;
    float yNorm = position.y / 30000.0;
    float wVal = floor(position.w + 0.5);
    float party = floor(wVal / 2048.0);
    float cix = wVal - party * 2048.0;
    vec2 cinfo = texture2D(uCounty, vec2((cix + 0.5) / uCountyW, 0.5)).rg;
    float colH = cinfo.r * 80.0;
    vDim = cinfo.g;
    pos.y = 0.22 + yNorm * colH * uHasHeight;
    vParty = party;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = uPointBase * uPixelRatio * (170.0 / max(40.0, -mv.z));
    gl_PointSize = clamp(s, 1.25 * uPixelRatio, 6.0 * uPixelRatio);
  }
`;

const FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uColorR;
  uniform vec3 uColorD;
  uniform vec3 uColorO;
  uniform float uAlpha;
  varying float vParty;
  varying float vDim;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float r2 = dot(p, p);
    if (r2 > 0.25) discard;
    float edge = smoothstep(0.25, 0.08, r2);
    vec3 col = vParty < 0.5 ? uColorR : (vParty < 1.5 ? uColorD : uColorO);
    col *= mix(1.0, 0.22, vDim);
    float a = uAlpha * edge * mix(1.0, 0.28, vDim);
    gl_FragColor = vec4(col, a);
  }
`;

export function createDotLayer({ counties, group, getHeight, getPixelRatio }) {
  const nC = counties.length;
  const texW = Math.max(2048, nC);
  const countyData = new Uint8Array(texW * 4);
  for (let i = 0; i < nC; i++) countyData[i * 4] = 4;
  const countyTex = new THREE.DataTexture(countyData, texW, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  countyTex.minFilter = THREE.NearestFilter;
  countyTex.magFilter = THREE.NearestFilter;
  countyTex.needsUpdate = true;

  const uniforms = {
    uCounty:     { value: countyTex },
    uCountyW:    { value: texW },
    uHasHeight:  { value: 0 },
    uPointBase:  { value: 2.3 },
    uPixelRatio: { value: getPixelRatio() },
    uColorR:     { value: new THREE.Color(DOT_C.rep) },
    uColorD:     { value: new THREE.Color(DOT_C.dem) },
    uColorO:     { value: new THREE.Color(DOT_C.other) },
    uAlpha:      { value: 0.82 },
  };

  const mat = new THREE.RawShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
  });

  const geo = new THREE.BufferGeometry();
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 2;
  group.add(points);

  const outlineGroup = new THREE.Group();
  outlineGroup.visible = false;
  outlineGroup.position.y = 0.18;
  const lineMat = new THREE.LineBasicMaterial({ color: 0x263149, transparent: true, opacity: 0.75 });
  for (const c of counties) {
    for (const rings of c.polys) {
      for (const r of rings) {
        const pts = r.map(([x, y]) => new THREE.Vector3(x, 0, -y));
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        outlineGroup.add(new THREE.Line(g, lineMat));
      }
    }
  }
  group.add(outlineGroup);

  const worker = new Worker(new URL('./dots-worker.js', import.meta.url));
  let workerReady = false;
  let pendingMsg = null;
  let reqId = 0;
  let onDone = null;
  let lastGenArgs = null;
  let precinctCache = null;
  let precinctPromise = null;
  let activePrRace = null;
  let prFileUrl = null;
  let prShapesUrl = null;

  function loadPrecinctsOnce() {
    if (precinctPromise) return precinctPromise;
    if (!prFileUrl || !prShapesUrl) return Promise.resolve(null);
    const nameToCi = new Map(counties.map((c, i) => [c.name.toUpperCase(), i]));
    precinctPromise = Promise.all([
      fetch(prFileUrl).then(r => r.ok ? r.json() : null),
      fetch(prShapesUrl).then(r => r.ok ? r.json() : null),
    ]).then(([pr, shapes]) => {
      if (!pr || !shapes) return null;
      const byCounty = new Map();
      for (const [cname, list] of Object.entries(pr.counties)) {
        const ci = nameToCi.get(cname.toUpperCase());
        const sList = shapes[cname];
        if (ci == null || !sList) continue;
        byCounty.set(ci, { list, sList });
      }
      precinctCache = { races: pr.races, byCounty };
      return precinctCache;
    }).catch(() => null);
    return precinctPromise;
  }

  function applyPrecinctRace(raceKey) {
    if (!precinctCache || precinctCache.races[raceKey] == null) {
      if (activePrRace !== null) {
        worker.postMessage({ type: 'clearPrecincts' });
        activePrRace = null;
      }
      return false;
    }
    const idx = precinctCache.races[raceKey];
    const prs = counties.map((_, ci) => {
      const entry = precinctCache.byCounty.get(ci);
      if (!entry) return null;
      const out = [];
      const { list, sList } = entry;
      for (let i = 0; i < list.length; i++) {
        const polys = sList[i];
        if (!polys || !polys.length) continue;
        const v = list[i][3][idx];
        const r = v ? v[0] : 0, d = v ? v[1] : 0, o = v ? v[2] : 0;
        out.push([r, d, o, polys]);
      }
      return out.length ? out : null;
    });
    worker.postMessage({ type: 'setPrecincts', prs });
    activePrRace = raceKey;
    return true;
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') {
      workerReady = true;
      if (pendingMsg) {
        const fn = pendingMsg;
        pendingMsg = null;
        fn();
      }
    } else if (m.type === 'dots') {
      if (m.reqId !== reqId) return;
      let total = 0;
      for (const b of m.buffers) total += b.length;
      const merged = new Int16Array(total);
      const starts = new Int32Array(nC);
      const counts = new Int32Array(nC);
      let off = 0;
      for (let ci = 0; ci < nC; ci++) {
        const b = m.buffers[ci];
        starts[ci] = off >> 2;
        counts[ci] = b.length >> 2;
        merged.set(b, off);
        off += b.length;
      }
      for (let i = 0, n = merged.length >> 2; i < n; i++) {
        const j = (Math.random() * (i + 1)) | 0;
        const a = i * 4, b = j * 4;
        const ciA = merged[a + 3] & 2047, ciB = merged[b + 3] & 2047;
        if (ciA === ciB) continue;
        for (let k = 0; k < 4; k++) { const t = merged[a + k]; merged[a + k] = merged[b + k]; merged[b + k] = t; }
      }
      const attr = new THREE.Int16BufferAttribute(merged, 4, false);
      geo.setAttribute('position', attr);
      syncHeights();
      if (onDone) onDone({ totalDots: total >> 2, counts });
    }
  };

  worker.postMessage({
    type: 'init',
    counties: counties.map(c => ({ polys: c.polys })),
  });

  function syncHeights() {
    for (let i = 0; i < nC; i++) {
      countyData[i * 4] = Math.max(1, Math.min(255, Math.round((getHeight(counties[i]) / 80.0) * 255)));
    }
    countyTex.needsUpdate = true;
  }

  function setHover(ci) {
    for (let i = 0; i < nC; i++) {
      countyData[i * 4 + 1] = (ci != null && i !== ci) ? 255 : 0;
    }
    countyTex.needsUpdate = true;
  }

  function configurePrecincts(fileUrl, shapesUrl) {
    prFileUrl = fileUrl;
    prShapesUrl = shapesUrl;
  }

  function generate({ votesByCounty, scale, seedSalt, raceKey }, cb) {
    onDone = cb;
    lastGenArgs = { votesByCounty, scale, seedSalt, raceKey };
    const dispatchToWorker = () => {
      if (raceKey && precinctCache) applyPrecinctRace(raceKey);
      else if (activePrRace !== null) { worker.postMessage({ type: 'clearPrecincts' }); activePrRace = null; }
      worker.postMessage({ type: 'generate', reqId: ++reqId, votes: votesByCounty, scale, seedSalt });
    };
    const send = () => {
      if (workerReady) dispatchToWorker();
      else pendingMsg = dispatchToWorker;
    };
    if (raceKey && !precinctCache && prFileUrl) {
      loadPrecinctsOnce().then(send);
    } else {
      send();
    }
  }
  function regenerate() {
    if (lastGenArgs) generate(lastGenArgs, onDone);
  }

  function setVisible(v) {
    points.visible = v;
    outlineGroup.visible = v;
  }
  function setRaise(v) {
    uniforms.uHasHeight.value = v;
  }
  function setScaleAppearance(scale) {
    if (scale <= 10)      { uniforms.uPointBase.value = 1.45; uniforms.uAlpha.value = 0.62; }
    else if (scale <= 25) { uniforms.uPointBase.value = 1.75; uniforms.uAlpha.value = 0.72; }
    else if (scale <= 100){ uniforms.uPointBase.value = 2.25; uniforms.uAlpha.value = 0.82; }
    else if (scale <= 250){ uniforms.uPointBase.value = 2.65; uniforms.uAlpha.value = 0.86; }
    else                  { uniforms.uPointBase.value = 3.1;  uniforms.uAlpha.value = 0.90; }
  }
  function onResize() {
    uniforms.uPixelRatio.value = getPixelRatio();
  }

  return {
    generate, setVisible, setRaise, setScaleAppearance,
    syncHeights, setHover, onResize, configurePrecincts,
  };
}
