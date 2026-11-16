// volume.html: Municípios brasileiros em quatro etapas com animações fluidas estilo iOS/Apple:
//   1. Plano                  cada município colorido pelo vencedor, independente do total de eleitores
//   2. Altura = votos         cada município erguido pelo total de votos (como na página principal estado.html)
//   3. Volume = votos         cada município erguido por votos por km², para que o VOLUME 3D (área × altura) seja proporcional aos votos
//   4. Despejar (Jarros 3D)   o mapa começa 100% neutro/sem cor e os jarros 3D sobrevoam suavemente despejando e pintando os votos reais

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator, geoArea } from 'd3-geo';
import { STATES, STATE } from './state.js';
import { REP_C, DEM_C } from './colors.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('pt-BR');
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '–';
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

const EARTH_KM = 6371.0;
const H_MAX = 250, H_BASE = 1.4;
const TILT = { phi: 0.94, theta: -0.20 };
const BINS = [50, 55, 60, 65, 70, 75];
const PARTY_HEX = { R: '#3b5bdb', D: '#e03131', O: '#64748b' };
const NEUTRAL_BASE_HEX = '#142634';

const UNIT_CAP = STATE.slug === 'br' ? 'Estado' : (STATE.slug === 'df' ? 'Região Administrativa' : 'Município');
const unitsLow = STATE.slug === 'br' ? 'estados' : (STATE.slug === 'df' ? 'regiões administrativas' : 'municípios');

// Popula seletor de estados com Brasil (Nacional) no topo
const sortedStates = [...STATES].sort((a, b) => {
  if (a.slug === 'br') return -1;
  if (b.slug === 'br') return 1;
  return a.name.localeCompare(b.name, 'pt-BR');
});
$('ufSelect').innerHTML = sortedStates.map(s => {
  const lbl = s.slug === 'br' ? 'Brasil (Nacional)' : `${s.name} (${s.code})`;
  return `<option value="${s.slug}" ${s.slug === STATE.slug ? 'selected' : ''}>${lbl}</option>`;
}).join('');
$('ufSelect').onchange = e => {
  const q = new URLSearchParams(location.search);
  q.set('uf', e.target.value);
  location.search = q.toString();
};
$('pageTitle').textContent = `${STATE.name}: votos como volume 3D`;
$('backStateLink').href = `estado.html?uf=${STATE.slug}`;
document.title = `${STATE.name}: Votos como Volume 3D — Como o Brasil Vota`;

let r2026, geoData;
try {
  [r2026, geoData] = await Promise.all([
    getJSON(STATE.data.r2026),
    getJSON(STATE.data.geo),
  ]);
} catch (e) {
  $('loading').textContent = 'Não foi possível carregar os dados do estado. Recarregue a página.';
  throw e;
}

const races = r2026.order
  .map(id => ({ id, ...r2026.races[id] }))
  .filter(r => !r.isShift);

const features = geoData.features || [];
const P = geoMercator().fitExtent([[-470, -470], [470, 470]], { type: 'FeatureCollection', features });

// ---------- Cena 3D ----------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07131a');
scene.add(new THREE.AmbientLight(0xffffff, 0.68));
const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(-280, 620, 420);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(35, 1, 35, 8500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.maxPolarAngle = 1.35;

const map = new THREE.Group();
map.rotation.x = -Math.PI / 2;
scene.add(map);

const baseBorderMat = new THREE.LineBasicMaterial({ color: 0x2d4f66, transparent: true, opacity: 0.72 });
const colEdgeMat = new THREE.LineBasicMaterial({ color: 0x102330, transparent: true, opacity: 0.36 });

// Separa a geometria extrudada em dois grupos limpos:
//   Grupo 0 (material[0]): apenas a tampa horizontal superior (normal.z > 0.5)
//   Grupo 1 (material[1]): apenas as paredes laterais verticais (|normal.z| <= 0.5)
// A tampa inferior (normal.z < -0.5) é descartada.
// Além disso, em stack(c) apenas a camada MAIS ALTA visível tem seu material[0] (tampa superior) ativado!
// Como só existe UMA tampa horizontal por município em toda a cena, é matematicamente impossível haver Z-fighting (piscar vermelho/azul)!
function buildCleanColumnGeo(extGeo) {
  const nonIdx = extGeo.index ? extGeo.toNonIndexed() : extGeo;
  const pos = nonIdx.attributes.position.array;
  const norm = nonIdx.attributes.normal.array;
  const nTri = pos.length / 9;

  const topPos = [], topNorm = [];
  const sidePos = [], sideNorm = [];
  for (let t = 0; t < nTri; t++) {
    const base = t * 9;
    const nz = norm[base + 2];
    if (nz < -0.5) continue;
    const targetP = nz > 0.5 ? topPos : sidePos;
    const targetN = nz > 0.5 ? topNorm : sideNorm;
    for (let k = 0; k < 9; k++) {
      targetP.push(pos[base + k]);
      targetN.push(norm[base + k]);
    }
  }
  const finalPos = new Float32Array(topPos.length + sidePos.length);
  finalPos.set(topPos, 0);
  finalPos.set(sidePos, topPos.length);

  const finalNorm = new Float32Array(topNorm.length + sideNorm.length);
  finalNorm.set(topNorm, 0);
  finalNorm.set(sideNorm, topNorm.length);

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(finalNorm, 3));
  out.clearGroups();
  out.addGroup(0, topPos.length / 3, 0);
  out.addGroup(topPos.length / 3, sidePos.length / 3, 1);
  out.computeBoundingBox();
  return out;
}

// Extrai apenas o contorno superior (z = 1) para desenhar as divisas municipais com nitidez e sem linhas internas piscando
function buildTopOutlineGeo(shapes) {
  const linePts = [];
  for (const sh of shapes) {
    const rings = [sh.getPoints(), ...(sh.holes || []).map(h => h.getPoints())];
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        linePts.push(a.x, a.y, 1.002, b.x, b.y, 1.002);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
  return g;
}

const neutralColor = new THREE.Color(NEUTRAL_BASE_HEX);

const counties = features.map((f, idx) => {
  const rawName = (f.properties && f.properties.name) || `Mun ${idx}`;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const shapes = [];
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    const ring = r => r.map(p => {
      const pt = P(p);
      return pt ? new THREE.Vector2(pt[0], -pt[1]) : null;
    }).filter(Boolean);
    const outerPts = ring(outer);
    if (outerPts.length < 3) continue;
    const s = new THREE.Shape(outerPts);
    s.holes = holes.map(h => new THREE.Path(ring(h))).filter(p => p.getPoints().length >= 3);
    shapes.push(s);
  }
  if (!shapes.length) return null;

  let rawExt = null;
  try {
    rawExt = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
  } catch {
    try {
      for (const sh of shapes) sh.holes = [];
      rawExt = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    } catch {
      return null;
    }
  }
  const g = buildCleanColumnGeo(rawExt);
  const topOutlineGeo = buildTopOutlineGeo(shapes);
  rawExt.dispose();

  const ox = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
  const oy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;

  const realKm2 = Math.max(1.5, geoArea(f) * EARTH_KM * EARTH_KM);
  const screenArea = Math.max(
    4,
    shapes.reduce((acc, s) => acc + Math.abs(THREE.ShapeUtils.area(s.getPoints())), 0)
  );

  // Bandeja neutra (mapa sem cor de partido) para quando o município ainda não recebeu tinta
  const baseTopMat = new THREE.MeshBasicMaterial({ color: neutralColor.clone() });
  const baseSideMat = new THREE.MeshLambertMaterial({ color: neutralColor.clone().multiplyScalar(0.8) });
  const baseMesh = new THREE.Mesh(g, [baseTopMat, baseSideMat]);
  baseMesh.scale.z = H_BASE;
  const baseLine = new THREE.LineSegments(topOutlineGeo, baseBorderMat);
  baseMesh.add(baseLine);
  map.add(baseMesh);

  const makeLayer = () => {
    const topMat = new THREE.MeshBasicMaterial();
    const sideMat = new THREE.MeshLambertMaterial();
    const m = new THREE.Mesh(g, [topMat, sideMat]);
    const outline = new THREE.LineSegments(topOutlineGeo, colEdgeMat);
    m.add(outline);
    m.outline = outline;
    map.add(m);
    return m;
  };

  const lose = makeLayer();
  const oth  = makeLayer();
  const mesh = makeLayer();

  const c = {
    i: idx,
    name: rawName,
    key: rawName.toUpperCase(),
    km2: realKm2,
    screenArea,
    baseMesh,
    mesh, lose, oth,
    ox, oy,
    box: g.boundingBox,
    cur:  { D: 0, R: 0, O: 0 },
    from: { D: 0, R: 0, O: 0 },
    to:   { D: 0, R: 0, O: 0 },
    paintProgress: 1, // 0 = neutro sem cor, 1 = totalmente pintado
    fromPaint: 1,
    toPaint: 1,
    extra: 0,
    rep: 0, dem: 0, other: 0, total: 0,
  };
  for (const m of [baseMesh, mesh, lose, oth]) m.userData = c;
  return c;
}).filter(Boolean);

$('loading').remove();

const tmpCol = new THREE.Color();
const paintLayer = (m, hex, paintMix = 1) => {
  tmpCol.set(NEUTRAL_BASE_HEX).lerp(new THREE.Color(hex), Math.max(0, Math.min(1, paintMix)));
  m.material[0].color.copy(tmpCol);
  m.material[1].color.copy(tmpCol).multiplyScalar(0.82);
};

// Ordena as partes da coluna da menor votação (base) para a maior votação (topo)
function ranked(c) {
  const rWin = (c.rep ?? 0) >= (c.dem ?? 0);
  return [
    { m: c.lose, party: rWin ? 'D' : 'R', v: rWin ? (c.dem ?? 0) : (c.rep ?? 0) },
    { m: c.oth,  party: 'O',             v: c.other ?? 0 },
    { m: c.mesh, party: rWin ? 'R' : 'D', v: rWin ? (c.rep ?? 0) : (c.dem ?? 0) },
  ].sort((a, b) => a.v - b.v);
}

function colorOf(c) {
  if (!c.total) return '#273a4b';
  const share = 100 * Math.max(c.dem, c.rep) / c.total;
  let k = 0;
  for (let idx = BINS.length - 1; idx >= 0; idx--) {
    if (share >= BINS[idx]) { k = idx; break; }
  }
  const palette = c.rep >= c.dem ? REP_C : DEM_C;
  return palette[Math.min(k, palette.length - 1)];
}

function updateCountyMaterials(c, topColorBlend = 1) {
  const rWin = (c.rep ?? 0) >= (c.dem ?? 0);
  const winParty = rWin ? 'R' : 'D';
  const loseParty = rWin ? 'D' : 'R';
  const pm = c.paintProgress ?? 1;

  paintLayer(c.lose, PARTY_HEX[loseParty], pm);
  paintLayer(c.oth, PARTY_HEX.O, pm);

  const winHex = new THREE.Color(PARTY_HEX[winParty]).lerp(new THREE.Color(colorOf(c)), topColorBlend);
  tmpCol.set(NEUTRAL_BASE_HEX).lerp(winHex, Math.max(0, Math.min(1, pm)));
  c.mesh.material[0].color.copy(tmpCol);
  c.mesh.material[1].color.copy(tmpCol).multiplyScalar(0.82);
}

// Empilha as camadas ativas sem JAMAIS desenhar mais de uma tampa horizontal superior por município!
// Isso elimina 100% qualquer possibilidade de Z-fighting entre vermelho e azul.
function stack(c) {
  const parts = ranked(c);
  const active = [];
  for (const p of parts) {
    const len = Math.max(0, c.cur[p.party] || 0);
    if (len > 0.04 && (c.paintProgress ?? 1) > 0.01) {
      active.push({ ...p, len });
    } else {
      p.m.visible = false;
    }
  }

  if (!active.length) {
    // Município neutro (ainda sem tinta): exibe apenas a bandeja neutra
    c.baseMesh.visible = true;
    c.baseMesh.material[0].visible = true;
    return null;
  }

  // Oculta a bandeja neutra pois as camadas coloridas já cobrem o município desde z = 0
  c.baseMesh.visible = false;

  let z = 0;
  for (let i = 0; i < active.length; i++) {
    const item = active[i];
    const isTop = (i === active.length - 1);
    const len = isTop ? Math.max(0.1, item.len + (c.extra || 0)) : item.len;
    item.m.visible = true;
    // Apenas a camada do TOPO desenha a tampa horizontal superior (material[0]) e o contorno superior!
    // As camadas abaixo desenham exclusivamente as paredes laterais verticais (material[1]).
    item.m.material[0].visible = isTop;
    if (item.m.outline) item.m.outline.visible = isTop;
    item.m.position.z = z;
    item.m.scale.z = len;
    z += len;
  }
  return active[active.length - 1].m;
}

// ---------- Disputa, cores e as quatro etapas ----------
let race = null, step = 'flat', grow = null;

// Em "volume", cada unidade é erguida fielmente por votos por km² para que o volume (área × altura) seja proporcional ao total de votos
const densityOf = c => c.total / Math.max(18, c.km2);

const heightOf = (c, s) => s === 'flat' || !c.total ? H_BASE
  : Math.max(H_BASE * 1.25, H_MAX * (s === 'votes' ? c.total / race.maxTotal : densityOf(c) / race.maxDensity));

function targetLayersForStep(c, s) {
  if (!c.total || s === 'fill') {
    // Em 'fill' (Despejar), o mapa esvazia para 100% neutro/sem cor! Os jarros vão pintar cada município do zero.
    return { D: 0, R: 0, O: 0 };
  }
  const h = heightOf(c, s);
  if (s === 'flat') {
    const rWin = (c.rep ?? 0) >= (c.dem ?? 0);
    return {
      R: rWin ? h : 0,
      D: rWin ? 0 : h,
      O: 0,
    };
  }
  const t = c.total || 1;
  return {
    R: h * (c.rep / t),
    D: h * (c.dem / t),
    O: h * (c.other / t),
  };
}

function setRace(id) {
  race = races.find(r => r.id === id) || races[0];
  for (const c of counties) {
    const row = race.counties[c.key] || race.counties[c.name] || [0, 0, 0];
    const rep = row[0] || 0, dem = row[1] || 0, other = row[2] || 0;
    const total = rep + dem + other;
    Object.assign(c, { rep, dem, other, total });
  }
  race.maxTotal = Math.max(1, ...counties.map(c => c.total));
  race.maxDensity = Math.max(1, ...counties.map(c => densityOf(c)));
  for (const c of counties) {
    c.paintProgress = 1;
    updateCountyMaterials(c, 1);
  }
  $('race').value = race.id;
  setStep(step, true);
  syncUrl();
}

function syncUrl() {
  const q = new URLSearchParams();
  q.set('uf', STATE.slug);
  if (race && race.id !== '2026-pres-2t') q.set('race', race.id);
  if (step !== 'flat') q.set('step', step);
  try { history.replaceState(null, '', `?${q.toString()}`); } catch {}
}

function setStep(s, keepCamera = false) {
  const was = step;
  step = s;
  pour.stop(false);
  for (const id of ['flat', 'votes', 'volume', 'fill']) {
    $(id).setAttribute('aria-pressed', String(id === s));
  }
  const now = performance.now();
  for (const c of counties) {
    c.from = { ...c.cur };
    c.to = targetLayersForStep(c, s);
    c.fromPaint = c.paintProgress ?? 1;
    c.toPaint = s === 'fill' ? 0 : 1;
    c.extra = 0;
  }
  const dur = s === 'fill' ? 620 : 1100;
  grow = { start: now, dur };
  if (s === 'fill') {
    // Aguarda 900ms com o mapa 100% neutro (sem cor) antes do 1º jarro iniciar o despejo
    pour.start(now + 900);
  }
  if (!keepCamera && (was === 'flat') !== (s === 'flat')) {
    turnCamera(s === 'flat' ? { phi: 0.0001, theta: 0 } : TILT);
  }
  controls.enableRotate = s !== 'flat';
  writeNote();
  syncUrl();
}

function writeNote() {
  const tall = [...counties].sort((a, b) => heightOf(b, step === 'fill' ? 'volume' : step) - heightOf(a, step === 'fill' ? 'volume' : step))[0];
  const tallVotes = [...counties].sort((a, b) => b.total - a.total)[0];
  const total = counties.reduce((n, c) => n + c.total, 0);
  const totR = race.totals?.R || 0, totD = race.totals?.D || 0;
  const tag = race.tag ? ` (${race.tag})` : '';
  const head = `<b>${race.office} 2026${tag}</b> · ${fmt(total)} votos válidos · <span style="color:#8da8ff">${race.rep} ${pct(totR, total)}</span> vs. <span style="color:#ff7b7b">${race.dem} ${pct(totD, total)}</span>. `;

  $('note').innerHTML = head + (step === 'fill'
    ? `<b>Despejar por volume (Jarros 3D).</b> O mapa começa 100% neutro (sem cor) e os jarros sobrevoam suavemente ${STATE.name}, pintando e enchendo cada ${UNIT_CAP.toLowerCase()} do zero até sua altura por densidade eleitoral. ${pour.running ? 'Clique em <b>Despejar</b> novamente para concluir instantaneamente.' : 'Clique em <b>Despejar</b> para repetir a animação.'}`
    : step === 'flat'
    ? `Cada um dos ${counties.length} ${unitsLow} é pintado por quem venceu ali, não importa quantas pessoas votaram. Clique nos botões abaixo para erguer primeiro por <b>Altura = votos</b>, depois por <b>Volume = votos</b> ou <b>Despejar (Jarros 3D)</b>.`
    : step === 'votes'
    ? `<b>Altura = votos.</b> Cada coluna tem a altura proporcional ao total de votos do ${UNIT_CAP.toLowerCase()} (maior pico: <b>${tallVotes.name}</b>, ${fmt(tallVotes.total)} votos). Porém, uma unidade territorialmente extensa ocupa muito mais área na tela do que uma unidade compacta com a mesma votação.`
    : `<b>Volume = votos.</b> A altura de cada coluna passa a ser calculada por <b>votos por km²</b>, de modo que o <b>volume 3D</b> (área × altura) seja proporcional ao total de votos. Mais denso: <b>${tall.name}</b> (${fmt(tall.total / tall.km2)} votos/km²; ${tallVotes.name} distribui seus ${fmt(tallVotes.total)} votos por ${fmt(tallVotes.km2)} km²).`);
}

$('race').innerHTML = races.map(r => {
  const tag = r.tag ? ` (${r.tag})` : '';
  return `<option value="${r.id}">2026 · ${r.office}${tag} — ${r.rep} vs. ${r.dem}</option>`;
}).join('');
$('race').onchange = e => setRace(e.target.value);

for (const id of ['flat', 'votes', 'volume']) {
  $(id).onclick = () => { if (step !== id) setStep(id); };
}
$('fill').onclick = () => {
  if (pour.running) {
    pour.stop(true);
    writeNote();
  } else {
    setStep('fill');
  }
};

$('legend').innerHTML =
  `<div>${REP_C.map(c => `<i style="background:${c}"></i>`).join('')}<span>PL venceu no ${UNIT_CAP.toLowerCase()}</span></div>` +
  `<div>${DEM_C.map(c => `<i style="background:${c}"></i>`).join('')}<span>PT venceu no ${UNIT_CAP.toLowerCase()}</span></div>` +
  `<div style="margin-top:4px"><i style="background:${PARTY_HEX.R};width:10px"></i><i style="background:${PARTY_HEX.D};width:10px"></i><span>2º colocado na base</span>` +
  `<i style="background:${NEUTRAL_BASE_HEX};border:1px solid #2d4f66;width:10px;margin-left:8px"></i><span>Mapa neutro antes de pintar</span></div>`;

// ---------- Câmera ----------
let turn = null;
function fitDistance() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return 575 / (t * Math.min(1, w / h));
}
function place(phi, theta, r = camera.position.distanceTo(controls.target)) {
  const s = new THREE.Spherical(r, phi, theta);
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
  camera.lookAt(controls.target);
}
function turnCamera(to) {
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  turn = {
    from: { phi: s.phi, theta: s.theta },
    to,
    r0: s.radius,
    r1: to.phi > 0.1 ? fitDistance() * (stage.clientWidth < 600 ? 0.96 : 0.78) : fitDistance(),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(0, to.phi > 0.1 ? 26 : 0, to.phi > 0.1 ? 0 : 32),
    start: performance.now(),
  };
}
function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();
controls.target.set(0, 0, 32);
place(0.0001, 0, fitDistance());

// ---------- Tooltip ao passar o mouse ou tocar ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('tip');
let hovered = null;
function hover(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(counties.flatMap(c => [c.mesh, c.lose, c.oth, c.baseMesh]), false)[0];
  const c = hit?.object.userData;
  if (hovered && hovered !== c) updateCountyMaterials(hovered, 1);
  hovered = c || null;
  if (!c) { tip.style.display = 'none'; return; }
  c.mesh.material[0].color.lerp(new THREE.Color('#ffffff'), 0.25);
  const row = (a, b, m = true) => `<div class="r${m ? ' m' : ''}"><span>${a}</span><span>${b}</span></div>`;
  const dens = c.total / c.km2;
  tip.innerHTML = `<div class="n">${c.name}</div>` + (!c.total ? row('Sem votos apurados', '') :
    row(`<span style="color:#8da8ff">${race.rep}</span>`, `${fmt(c.rep)} · ${pct(c.rep, c.total)}`, false) +
    row(`<span style="color:#ff7b7b">${race.dem}</span>`, `${fmt(c.dem)} · ${pct(c.dem, c.total)}`, false) +
    (c.other ? row('Outros / 3ª Via', `${fmt(c.other)} · ${pct(c.other, c.total)}`) : '') +
    row('Total de votos válidos', fmt(c.total)) +
    row('Área territorial (IBGE)', `${fmt(c.km2)} km²`) +
    row('Densidade eleitoral', `${dens < 10 ? dens.toFixed(1) : fmt(dens)} votos/km²`));
  tip.style.display = 'block';
  const x = e.clientX - r.left, y = e.clientY - r.top;
  tip.style.left = Math.max(8, Math.min(x + 14, r.width - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.max(8, Math.min(y + 14, r.height - tip.offsetHeight - 8)) + 'px';
}
renderer.domElement.addEventListener('pointermove', hover);
renderer.domElement.addEventListener('pointerdown', hover);
renderer.domElement.addEventListener('pointerleave', () => {
  tip.style.display = 'none';
  if (hovered) updateCountyMaterials(hovered, 1);
  hovered = null;
});

// ---------- Loop de animação (curva quintic suave estilo iOS) ----------
const easeQuint = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
const smoothstep = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
  return u * u * (3 - 2 * u);
};

function frame(now) {
  if (grow) {
    const t = Math.min(1, (now - grow.start) / grow.dur);
    const k = easeQuint(t);
    for (const c of counties) {
      c.cur.D = c.from.D + (c.to.D - c.from.D) * k;
      c.cur.R = c.from.R + (c.to.R - c.from.R) * k;
      c.cur.O = c.from.O + (c.to.O - c.from.O) * k;
      c.paintProgress = c.fromPaint + (c.toPaint - c.fromPaint) * k;
      updateCountyMaterials(c, 1);
      stack(c);
    }
    if (t === 1) grow = null;
  }
  pour.update(now);
  if (turn) {
    const t = Math.min(1, (now - turn.start) / 1050);
    const k = easeQuint(t);
    controls.enabled = false;
    controls.target.lerpVectors(turn.fromTarget, turn.toTarget, k);
    place(
      turn.from.phi + (turn.to.phi - turn.from.phi) * k,
      turn.from.theta + (turn.to.theta - turn.from.theta) * k,
      turn.r0 + (turn.r1 - turn.r0) * k
    );
    if (t === 1) { turn = null; controls.enabled = true; }
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Despejar (Fill): O mapa começa 100% sem cor e os jarros 3D pintam cada município suavemente ----------
const pour = (() => {
  const PARTY = ['D', 'O', 'R'];
  const up = new THREE.Vector3(), tmp = new THREE.Vector3(), hit = new THREE.Vector3();
  const world = (x, y, z) => map.localToWorld(tmp.set(x, y, z)).clone();
  const SHELF = {
    D: { x: -165, y: 380, z: 110 },
    O: { x:    0, y: 380, z: 110 },
    R: { x:  165, y: 380, z: 110 },
  };

  const glass = new THREE.MeshStandardMaterial({
    color: 0xe6f2ff, transparent: true, opacity: 0.34, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false
  });
  const rim = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 });
  const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 36);
  const TIP = new THREE.Vector3(14.2, 27.6, 0);
  const flatQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  function makePitcher(party) {
    const g = new THREE.Group();
    g.scale.setScalar(2.75);
    g.visible = false;
    scene.add(g);
    g.add(new THREE.Mesh(lathe([[0, 0], [8, 0], [9.5, 1.5], [10, 8], [9, 16], [9.8, 22], [10.6, 26]]), glass));
    const lip = new THREE.Mesh(new THREE.TorusGeometry(10.6, 0.35, 6, 40), rim);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 26;
    g.add(lip);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.4, 6, 14, 1, true), glass);
    spout.position.set(11.2, 25.6, 0);
    spout.rotation.z = -1.05;
    g.add(spout);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(6.5, 1.2, 8, 24, Math.PI), glass);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(-9.6, 14, 0);
    g.add(handle);
    const mat = new THREE.MeshStandardMaterial({ color: PARTY_HEX[party], transparent: true, opacity: 0.94, roughness: 0.25 });
    const liquid = new THREE.Mesh(lathe([[0, 0], [7.6, 0], [9, 1.4], [9.5, 7.4], [8.8, 14.4]]), mat);
    liquid.position.y = 0.6;
    g.add(liquid);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(8.8, 36), mat);
    g.add(surface);
    const canvas = document.createElement('canvas');
    canvas.width = 380;
    canvas.height = 136;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.scale.set(29, 10.5, 1);
    label.position.set(0, 9.5, 0);
    label.renderOrder = 10;
    g.add(label);
    return { party, g, liquid, surface, canvas, tex, text: '', tilt: 0, pos: new THREE.Vector3() };
  }

  const pitchers = Object.fromEntries(PARTY.map(p => [p, makePitcher(p)]));

  function writeLabel(pi, name, left) {
    const kVal = fmt(left / 1000);
    const text = `${name}|${kVal}`;
    if (text === pi.text) return;
    pi.text = text;
    const x = pi.canvas.getContext('2d'), W = pi.canvas.width, Hh = pi.canvas.height;
    x.clearRect(0, 0, W, Hh);
    x.fillStyle = 'rgba(9, 22, 30, 0.92)';
    x.strokeStyle = PARTY_HEX[pi.party];
    x.lineWidth = 6;
    x.beginPath();
    x.roundRect(4, 4, W - 8, Hh - 8, 22);
    x.fill();
    x.stroke();
    x.textAlign = 'center';
    x.fillStyle = '#f2f7f5';
    x.font = '600 25px "Plus Jakarta Sans", system-ui, sans-serif';
    x.fillText(name, W / 2, 46);
    x.font = '700 40px "Outfit", system-ui, sans-serif';
    x.fillText(`${kVal} mil votos`, W / 2, 98);
    pi.tex.needsUpdate = true;
  }

  const streamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.85, 1, 16, 1, true), streamMat);
  stream.visible = false;
  scene.add(stream);

  const N = 160;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.8, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.frustumCulled = false;
  scene.add(drops);
  const dropList = Array.from({ length: N }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, floor: 0, size: 1 }));
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), ds = new THREE.Vector3();

  const rings = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    return { m, age: 9 };
  });

  let nextDrop = 0, nextRing = 0, ringClock = 0;
  function splash(at, color, flow, dt) {
    const n = Math.min(4, Math.round((24 + 45 * flow) * dt + Math.random() * 0.5));
    for (let k = 0; k < n; k++) {
      const d = dropList[nextDrop = (nextDrop + 1) % N];
      const a = Math.random() * Math.PI * 2, out = 9 + Math.random() * 24;
      d.live = true; d.age = 0; d.size = 0.45 + Math.random() * 0.6; d.floor = at.y;
      d.p.copy(at);
      d.v.set(Math.cos(a) * out, 22 + Math.random() * 38 * flow, Math.sin(a) * out);
      drops.setColorAt(nextDrop, color);
    }
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    if ((ringClock += dt) > 0.16) {
      ringClock = 0;
      const r = rings[nextRing = (nextRing + 1) % rings.length];
      r.age = 0; r.m.visible = true;
      r.m.material.color.copy(color).lerp(new THREE.Color('#ffffff'), 0.35);
      r.m.position.copy(at).add(up.set(0, 1.2, 0));
    }
  }

  function stepDrops(dt) {
    dropList.forEach((d, k) => {
      if (d.live) {
        d.age += dt;
        d.v.y -= 145 * dt;
        d.p.addScaledVector(d.v, dt);
        if ((d.v.y < 0 && d.p.y < d.floor) || d.age > 1.25) d.live = false;
      }
      ds.setScalar(d.live ? d.size * 4.0 * (1 - 0.55 * d.age) : 0);
      drops.setMatrixAt(k, dm.compose(d.p, dq, ds));
    });
    drops.instanceMatrix.needsUpdate = true;
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.age += dt;
      r.m.scale.setScalar(2.5 + r.age * 26);
      r.m.material.opacity = Math.max(0, 0.65 * (1 - r.age / 0.9));
      if (r.age > 0.9) r.m.visible = false;
    }
  }

  let job = null;
  const votesOf = (c, P) => P === 'D' ? c.dem : P === 'R' ? c.rep : c.other;

  // Constrói uma trajetória Catmull-Rom 3D super suave sobre os polos regionais de cada partido
  function buildPartyPass(P, startTime, H) {
    const active = counties.filter(c => votesOf(c, P) > 0);
    if (!active.length) return null;

    const byVotes = [...active].sort((a, b) => votesOf(b, P) - votesOf(a, P));
    const hubs = [];
    for (const cand of byVotes) {
      if (hubs.length >= 6) break;
      const tooClose = hubs.some(h => Math.hypot(h.ox - cand.ox, h.oy - cand.oy) < 95);
      if (!tooClose || hubs.length < 3) hubs.push(cand);
    }
    hubs.sort((a, b) => b.oy - a.oy);

    const cruiseZ = 115;
    const sh = SHELF[P];
    const pts = [
      new THREE.Vector3(sh.x, sh.y, sh.z),
      new THREE.Vector3(hubs[0].ox * 0.7 + sh.x * 0.3, hubs[0].oy + 60, cruiseZ),
      ...hubs.map(c => new THREE.Vector3(c.ox, c.oy, Math.max(cruiseZ, Math.min(185, H(c) * 0.55 + 75)))),
      new THREE.Vector3(hubs[hubs.length - 1].ox * 0.6 + sh.x * 0.4, hubs[hubs.length - 1].oy - 40, cruiseZ),
      new THREE.Vector3(sh.x, sh.y, sh.z),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.45);

    const samples = 80;
    const samplePts = [];
    for (let i = 0; i <= samples; i++) {
      const u = 0.12 + (0.76 * i) / samples;
      samplePts.push({ u, pt: curve.getPoint(u) });
    }

    const dur = P === 'O' ? 3.2 : 5.6;
    const items = active.map(c => {
      let bestU = 0.5, bestD = Infinity;
      for (const s of samplePts) {
        const d = Math.hypot(c.ox - s.pt.x, c.oy - s.pt.y);
        if (d < bestD) { bestD = d; bestU = s.u; }
      }
      const v = votesOf(c, P);
      const targetH = H(c) * (v / (c.total || 1));
      const tStart = startTime + (bestU - 0.06) * dur;
      const fillDur = Math.max(0.85, Math.min(1.4, dur * 0.25));
      return { c, P, votes: v, targetH, tStart, tEnd: tStart + fillDur };
    });

    return {
      P,
      curve,
      startTime,
      endTime: startTime + dur,
      dur,
      items,
    };
  }

  function plan(t0) {
    const H = c => heightOf(c, 'volume');
    const total = P => counties.reduce((n, c) => n + votesOf(c, P), 0);
    const grandTotal = Math.max(1, total('D') + total('R') + total('O'));
    const order = [];
    if (total('O') / grandTotal > 0.01) order.push('O');
    if (total('D') <= total('R')) order.push('D', 'R');
    else order.push('R', 'D');

    let t = 0;
    const passes = [];
    for (const P of order) {
      const pass = buildPartyPass(P, t, H);
      if (pass) {
        passes.push(pass);
        t = pass.endTime + 0.35;
      }
    }
    return {
      t0,
      passes,
      done: t + 0.5,
      H,
      totals: Object.fromEntries(PARTY.map(P => [P, total(P)])),
    };
  }

  const names = () => ({
    D: race.dem || 'PT',
    R: race.rep || 'PL',
    O: 'Outros / 3ª Via',
  });

  let last = 0;
  const yaw = new THREE.Quaternion(), tipQ = new THREE.Quaternion(), col = new THREE.Color(), tipPos = new THREE.Vector3();

  return {
    get running() { return !!job; },
    start(when) {
      job = plan(when);
      last = when;
      for (const pi of Object.values(pitchers)) {
        pi.tilt = 0;
        pi.text = '';
        pi.pos.set(0, 0, 0);
      }
    },
    stop(finish) {
      if (!job) return;
      if (finish) {
        for (const c of counties) {
          const h = job.H(c);
          const t = c.total || 1;
          c.cur = {
            R: c.total ? h * (c.rep / t) : 0,
            D: c.total ? h * (c.dem / t) : 0,
            O: c.total ? h * (c.other / t) : 0,
          };
          c.paintProgress = 1;
          c.extra = 0;
          updateCountyMaterials(c, 1);
          stack(c);
        }
      }
      job = null;
      stream.visible = false;
      for (const pi of Object.values(pitchers)) pi.g.visible = false;
      dropList.forEach(d => d.live = false);
      stepDrops(0);
      for (const r of rings) r.m.visible = false;
    },
    update(now) {
      if (!job) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = (now - job.t0) / 1000;

      // Posiciona os jarros na prateleira mesmo durante a contagem regressiva inicial (t < 0)
      const view = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      yaw.setFromAxisAngle(up.set(0, 1, 0), view.theta);
      const nm = names();

      if (t < 0) {
        for (const P of PARTY) {
          const pi = pitchers[P];
          const pass = job.passes.find(p => p.P === P);
          if (!pass || job.totals[P] <= 0) { pi.g.visible = false; continue; }
          pi.g.visible = true;
          pi.g.quaternion.copy(yaw);
          pi.g.position.set(0, 0, 0);
          pi.g.updateMatrixWorld(true);
          tipPos.copy(TIP).applyMatrix4(pi.g.matrixWorld);
          const sh = SHELF[P];
          pi.pos.copy(world(sh.x, sh.y, sh.z).sub(tipPos));
          pi.g.position.copy(pi.pos);
          pi.g.updateMatrixWorld(true);
          pi.liquid.scale.y = 1;
          pi.liquid.visible = pi.surface.visible = true;
          pi.surface.position.y = 15.0;
          pi.surface.quaternion.copy(pi.g.quaternion).invert().multiply(flatQ);
          writeLabel(pi, nm[P], job.totals[P]);
        }
        return;
      }

      const left = { ...job.totals };
      for (const c of counties) {
        c.cur.D = 0; c.cur.R = 0; c.cur.O = 0;
        c.paintProgress = 0;
        c.extra = 0;
      }

      let activePass = null;
      let activeU = 0;

      for (const pass of job.passes) {
        if (t >= pass.startTime && t <= pass.endTime) {
          activePass = pass;
          activeU = (t - pass.startTime) / pass.dur;
        }
        for (const it of pass.items) {
          const u = smoothstep(it.tStart, it.tEnd, t);
          if (u <= 0) continue;
          left[it.P] -= it.votes * u;
          it.c.cur[it.P] = it.targetH * u;
          it.c.paintProgress = Math.max(it.c.paintProgress, smoothstep(0, 0.45, u));
          if (u > 0 && u < 1) {
            const bell = Math.sin(u * Math.PI);
            it.c.extra = Math.max(it.c.extra, Math.min(2.0, it.targetH * 0.05) * bell);
          }
        }
      }

      const lastPass = job.passes[job.passes.length - 1];
      const blendProgress = lastPass ? smoothstep(lastPass.startTime + lastPass.dur * 0.35, lastPass.endTime + 0.25, t) : 1;

      for (const c of counties) {
        updateCountyMaterials(c, blendProgress);
        stack(c);
      }

      for (const P of PARTY) {
        const pi = pitchers[P];
        const pass = job.passes.find(p => p.P === P);
        if (!pass || job.totals[P] <= 0) {
          pi.g.visible = false;
          continue;
        }
        pi.g.visible = true;
        let pt;
        let targetTilt = 0;
        if (t <= pass.startTime) {
          pt = SHELF[P];
          targetTilt = 0;
        } else if (t >= pass.endTime) {
          pt = SHELF[P];
          targetTilt = 0;
        } else {
          const rawU = (t - pass.startTime) / pass.dur;
          const easedU = easeQuint(Math.max(0, Math.min(1, rawU)));
          pt = pass.curve.getPoint(easedU);
          const pourWindow = smoothstep(0.08, 0.20, rawU) * (1 - smoothstep(0.80, 0.94, rawU));
          targetTilt = 1.05 * pourWindow;
        }

        pi.tilt += (targetTilt - pi.tilt) * Math.min(1, dt * 10);
        tipQ.setFromAxisAngle(up.set(0, 0, 1), -pi.tilt);
        pi.g.quaternion.copy(yaw).multiply(tipQ);
        pi.g.position.set(0, 0, 0);
        pi.g.updateMatrixWorld(true);
        tipPos.copy(TIP).applyMatrix4(pi.g.matrixWorld);

        const worldTarget = world(pt.x, pt.y, pt.z).sub(tipPos);
        if (pi.pos.lengthSq() === 0) pi.pos.copy(worldTarget);
        else pi.pos.lerp(worldTarget, Math.min(1, dt * 14));
        pi.g.position.copy(pi.pos);
        pi.g.updateMatrixWorld(true);

        const frac = Math.max(0, left[P] / Math.max(1, job.totals[P]));
        pi.liquid.scale.y = Math.max(0.001, frac);
        pi.liquid.visible = pi.surface.visible = frac > 0.002;
        pi.surface.position.y = 0.6 + 14.4 * frac;
        pi.surface.quaternion.copy(pi.g.quaternion).invert().multiply(flatQ);
        writeLabel(pi, nm[P], Math.max(0, left[P]));
      }

      if (activePass) {
        const P = activePass.P;
        const pi = pitchers[P];
        const flow = smoothstep(0.08, 0.18, activeU) * (1 - smoothstep(0.82, 0.93, activeU));
        if (flow > 0.02) {
          tipPos.copy(TIP).applyMatrix4(pi.g.matrixWorld);
          col.set(PARTY_HEX[P]);
          streamMat.color.copy(col);

          const curvePt = activePass.curve.getPoint(easeQuint(activeU));
          let groundZ = H_BASE;
          let bestD = Infinity;
          for (const c of counties) {
            const d = Math.hypot(c.ox - curvePt.x, c.oy - curvePt.y);
            if (d < bestD) {
              bestD = d;
              groundZ = Math.max(H_BASE, c.cur.D + c.cur.R + c.cur.O);
            }
          }
          hit.copy(world(curvePt.x, curvePt.y, groundZ));
          hit.x = tipPos.x;
          hit.z = tipPos.z;
          const len = Math.max(0.1, tipPos.y - hit.y);
          const rad = 2.6 * flow * (1 + 0.04 * Math.sin(t * 16));
          stream.visible = true;
          stream.position.set(tipPos.x, (tipPos.y + hit.y) / 2, tipPos.z);
          stream.scale.set(rad, len, rad);
          splash(hit, col, flow, dt);
        } else {
          stream.visible = false;
        }
      } else {
        stream.visible = false;
      }

      stepDrops(dt);
      if (t > job.done) {
        this.stop(true);
        writeNote();
      }
    },
  };
})();

const q = new URLSearchParams(location.search);
setRace(q.get('race') || '2026-pres-2t');
if (['votes', 'volume', 'fill'].includes(q.get('step'))) setStep(q.get('step'));
requestAnimationFrame(frame);
