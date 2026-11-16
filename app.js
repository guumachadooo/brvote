import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATES, STATE } from './state.js';
import { createDotLayer } from './dots.js';
import { createPlaceFinder } from './places.js';
import { createPrecinctColumns } from './precinct-columns.js';
import { createCityMarkers } from './cities.js';
import { DEM_C, REP_C, OTHER_HEX, marginColorHex, leadColorHex, shiftColorHex } from './colors.js';
import { renderSourceNote } from './sourcelist.js';
import { withBusy } from './busy.js';
import { computeInteriorPoint } from './callout-logic.js';
import { buildContextMap, clampCameraPan } from './context-map.js';
import { createCartogramWarper } from './cartogram.js';
import './custom-select.js';

const easeQuint = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

const isBR = STATE.slug === 'br';
const UNIT_CAP = isBR ? 'Estado' : (STATE.slug === 'df' ? 'Região Administrativa' : 'Município');
const UNITS_CAP = isBR ? 'Estados' : (STATE.slug === 'df' ? 'Regiões Administrativas' : 'Municípios');
const unitLow = isBR ? 'estado' : (STATE.slug === 'df' ? 'região administrativa' : 'município');
const unitsLow = isBR ? 'estados' : (STATE.slug === 'df' ? 'regiões administrativas' : 'municípios');

const initParams = new URLSearchParams(location.search);
function checkIsFramed() {
  if (/^pane[AB]$|^frame[AB]$/i.test(window.name || '')) return true;
  if (initParams.get('framed') === '1') return true;
  try {
    return window.self !== window.top &&
      Boolean(window.parent && window.parent.location && /compare\.html/i.test(window.parent.location.pathname));
  } catch {
    return false;
  }
}
const isFramed = checkIsFramed();
if (isFramed) {
  document.documentElement.classList.add('framed-html');
  document.body.classList.add('framed');
} else {
  document.documentElement.classList.remove('framed-html');
  document.body.classList.remove('framed');
}

document.title = `Eleições em ${STATE.name} — Como o Brasil Vota`;
document.getElementById('countyCount').textContent = STATE.counties;
document.getElementById('method').textContent = STATE.method;
renderSourceNote(document.getElementById('sources'), STATE);

if (isBR) {
  const uc = document.getElementById('unitCounty');
  const up = document.getElementById('unitPrecinct');
  const rs = document.getElementById('reset');
  const qs = document.getElementById('munQuickSearch');
  const gc = document.getElementById('goCounty');
  const ab = document.getElementById('aloneBtn');
  const at = document.getElementById('aloneTopBtn');
  if (uc) uc.textContent = 'Estados (27)';
  if (up) up.textContent = 'Cidades (5.570)';
  if (rs) rs.textContent = 'País inteiro';
  if (qs) qs.placeholder = 'Buscar cidade ou estado (ex: Campinas, Minas Gerais)…';
  if (gc && gc.options[0]) gc.options[0].textContent = 'Estado (UF)…';
  if (ab) ab.textContent = 'Só este local';
  if (at) at.textContent = 'Só este local';
}

const viewsEl = document.getElementById('views');
if (STATE.dots) {
  viewsEl.innerHTML =
    `<a class="view-link active" href="${STATE.results.href}">Colunas 3D</a>` +
    `<a class="view-link" href="${STATE.dots}">Pontos</a>`;
  const md = document.getElementById('modeDots');
  if (md) md.href = STATE.dots;
} else {
  viewsEl.style.display = 'none';
}

const flightsEl = document.getElementById('flights');
if (STATE.flights && STATE.flights.length) {
  flightsEl.innerHTML = STATE.flights.map(f =>
    `<a class="flight-link" href="${f.href}">${f.title}<span>${f.desc}</span></a>`
  ).join('');
} else {
  document.getElementById('flightsBlock').style.display = 'none';
}

const legR = document.getElementById('legR');
const legD = document.getElementById('legD');
REP_C.forEach(c => { const d = document.createElement('div'); d.className = 'sw'; d.style.background = c; legR.appendChild(d); });
DEM_C.forEach(c => { const d = document.createElement('div'); d.className = 'sw'; d.style.background = c; legD.appendChild(d); });

const [geo, r2026, rHist] = await Promise.all([
  fetch(STATE.data.geo).then(r => r.json()),
  fetch(STATE.data.r2026).then(r => r.json()),
  STATE.data.history ? fetch(STATE.data.history).then(r => r.json()) : Promise.resolve({ order: [], races: {} }),
]);

const races = {};
const order = [];
for (const id of r2026.order) {
  races[id] = { year: '2026', office: r2026.races[id].office || id, ...r2026.races[id] };
  order.push(id);
}
for (const id of rHist.order) {
  races[id] = rHist.races[id];
  order.push(id);
}

const features = geo.features || [];

const W = 220, H = 220;
const proj = geoMercator().fitSize([W, H], { type: 'FeatureCollection', features });

const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07131a);

const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
camera.position.set(0, 215, 225);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 6);
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 8;
controls.maxDistance = 650;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = THREE.TOUCH.PAN;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
clampCameraPan(controls, camera, 105, true);

let panMode = true;
const dragModeBtn = document.getElementById('dragMode');
function syncHint() {
  const h = document.getElementById('hint');
  if (!h) return;
  h.textContent = panMode
    ? `Arraste para mover · Clique direito (ou 2 dedos) para girar · Role para aproximar · Clique em um ${unitLow}`
    : `Arraste para girar · Clique direito para mover · Role para aproximar · Clique em um ${unitLow}`;
}
if (dragModeBtn) {
  dragModeBtn.onclick = () => {
    panMode = !panMode;
    controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = panMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    dragModeBtn.textContent = panMode ? 'Mover' : 'Girar';
    dragModeBtn.classList.toggle('active', !panMode);
    syncHint();
  };
}
syncHint();

let userMovedCamera = false;
let camAnim = null;
function animateCameraTo(toPos, toTarget, dur = 780) {
  camAnim = {
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    t0: performance.now(),
    dur,
  };
}
renderer.domElement.addEventListener('pointerdown', () => { userMovedCamera = true; camAnim = null; });
renderer.domElement.addEventListener('wheel', () => { userMovedCamera = true; camAnim = null; }, { passive: true });
renderer.domElement.addEventListener('touchstart', () => { userMovedCamera = true; camAnim = null; }, { passive: true });

scene.add(new THREE.AmbientLight(0xffffff, 0.74));
const sun = new THREE.DirectionalLight(0xffffff, 0.78);
sun.position.set(80, 180, 100);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8be2b8, 0.24);
fill.position.set(-100, 90, -80);
scene.add(fill);

const group = new THREE.Group();
scene.add(group);

const baseGeo = new THREE.PlaneGeometry(1200, 1200);
baseGeo.rotateX(-Math.PI / 2);
const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ color: 0x07131a }));
baseMesh.position.y = -0.05;
scene.add(baseMesh);

let contextMapGroup = null;
buildContextMap({
  uf: STATE.slug,
  proj: ll => {
    const p = proj(ll);
    return p ? [p[0] - W / 2, -(p[1] - H / 2)] : [NaN, NaN];
  },
  BASE_H: 0.35,
  yUp: true
}).then(grp => {
  contextMapGroup = grp;
  scene.add(grp);
});

function ringToVec2(ring) {
  const pts = [];
  for (const ll of ring) {
    const p = proj(ll);
    if (p && isFinite(p[0]) && isFinite(p[1])) {
      pts.push(new THREE.Vector2(p[0] - W / 2, -(p[1] - H / 2)));
    }
  }
  return pts;
}

const counties = [];
const meshToCounty = new Map();
const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.55 });
const otherMat = new THREE.MeshLambertMaterial({ color: OTHER_HEX });

for (const f of features) {
  const rawName = (f.properties && f.properties.name) || '';
  const geom = f.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const shapes = [];
  const rawPolys = [];
  let area = 0, nPts = 0;
  let bestRingPts = null, bestRingArea = -1;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;

  for (const poly of polys) {
    const outer = ringToVec2(poly[0]);
    if (outer.length < 3) continue;
    let rArea = 0;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const cross = (a.x * b.y - b.x * a.y);
      area += cross;
      rArea += cross;
      nPts++;
      if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
      if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y;
    }
    const outerArr = outer.map(v => [v.x, v.y]);
    if (Math.abs(rArea) > bestRingArea) {
      bestRingArea = Math.abs(rArea);
      bestRingPts = outerArr;
    }
    const sh = new THREE.Shape(outer);
    const ringsArr = [outerArr];
    for (let h = 1; h < poly.length; h++) {
      const hole = ringToVec2(poly[h]);
      if (hole.length >= 3) {
        sh.holes.push(new THREE.Path(hole));
        ringsArr.push(hole.map(v => [v.x, v.y]));
      }
    }
    shapes.push(sh);
    rawPolys.push(ringsArr);
  }
  if (!shapes.length || !nPts) continue;
  area = Math.abs(area) * 0.5;
  const [cx, cy] = computeInteriorPoint(bestRingPts || rawPolys[0][0]);
  const span = Math.max(x1 - x0, y1 - y0);

  const extrude = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
  extrude.rotateX(-Math.PI / 2);

  const lowerMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const lower = new THREE.Mesh(extrude, lowerMat);
  group.add(lower);

  const middle = new THREE.Mesh(extrude, otherMat);
  middle.visible = false;
  group.add(middle);

  const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const mesh = new THREE.Mesh(extrude, mat);
  const edges = new THREE.EdgesGeometry(extrude, 25);
  const line = new THREE.LineSegments(edges, edgeMat);
  mesh.add(line);
  group.add(mesh);

  const c = {
    name: rawName,
    key: rawName.toUpperCase(),
    area, cx, cy, span,
    shapes,
    polys: rawPolys,
    mesh, mat, lower, lowerMat, middle,
    targetH: 0.3, currentH: 0.3,
    fromBot: 0.01, fromMid: 0, fromTop: 0.29,
    toBot: 0.01, toMid: 0, toTop: 0.29,
  };
  counties.push(c);
  meshToCounty.set(mesh, c);
  meshToCounty.set(lower, c);
  meshToCounty.set(middle, c);
}

const cartoWarper = createCartogramWarper(counties);

const MAX_H = 75;
const BASE_H = 0.35;
let raiseAmount = 1.0;
let activeRace = null;
let activeId = null;
let viewMode = 'columns';
let unitMode = 'county';
let dotScale = 250;
let maxLead = 1;
let colorByLead = true;
const SHIFT_BASE_ID = STATE.base && STATE.base.raceId;
const baseRace = SHIFT_BASE_ID ? races[SHIFT_BASE_ID] : null;
const baseLabel = (STATE.base && STATE.base.label) || '2022';
let baseMaxVotes = 1;
if (baseRace) {
  for (const c of counties) {
    const row = baseRace.counties[c.key] || baseRace.counties[c.name];
    if (row) {
      const t = (row[0] || 0) + (row[1] || 0) + (row[2] || 0);
      if (t > baseMaxVotes) baseMaxVotes = t;
    }
  }
}

const dotLayer = createDotLayer({
  counties,
  group,
  getHeight: c => BASE_H + (c.targetH - BASE_H) * raiseAmount,
  getPixelRatio: () => Math.min(window.devicePixelRatio, 2),
});
if (STATE.data.precincts && STATE.data.precinctShapes) {
  dotLayer.configurePrecincts(STATE.data.precincts, STATE.data.precinctShapes);
}

const prCols = (STATE.data.precincts && STATE.data.precinctShapes)
  ? createPrecinctColumns({
      group,
      precinctUrl: STATE.data.precincts,
      precinctShapesUrl: STATE.data.precinctShapes,
      baseH: BASE_H,
      maxH: MAX_H,
    })
  : null;

const cityMarkers = STATE.data.cities
  ? createCityMarkers({
      group,
      proj: ll => { const p = proj(ll); return p ? [p[0] - W / 2, -(p[1] - H / 2)] : null; },
      cityUrl: STATE.data.cities,
      counties,
      getTopY: c => {
        if (!c || viewMode === 'dots') {
          return { baseY: BASE_H, lift: 0, visible: !aloneMode || c === pinnedCounty };
        }
        const match = countyMatchesFilter(c);
        const effK = match ? raiseAmount : 0;
        const baseY = unitMode === 'precinct'
          ? (BASE_H + (c.targetH - BASE_H) * effK)
          : (c.currentH || BASE_H);
        const targetDelta = Math.max(0.01, (c.targetH || BASE_H) - BASE_H);
        const curLift = unitMode === 'precinct'
          ? effK
          : Math.max(0, Math.min(1, ((c.currentH || BASE_H) - BASE_H) / targetDelta));
        return {
          baseY,
          lift: curLift,
          visible: !aloneMode || c === pinnedCounty,
        };
      },
    })
  : null;

const fmt = n => Math.round(n).toLocaleString('pt-BR');
const pct = x => (x * 100).toFixed(1) + '%';

let pinnedCounty = null;
let pinnedMeta = null;
let pinnedPrecinct = null;
let aloneMode = false;
let filterWinner = 'all'; // 'all' | 'rep' | 'dem' | 'close'

function syncAloneButtons() {
  const hasSelection = unitMode === 'precinct' ? !!pinnedPrecinct : !!pinnedCounty;
  const canAlone = hasSelection && viewMode === 'columns' && raiseAmount >= 0.05;
  const active = aloneMode && canAlone;
  const aloneWrap = document.getElementById('aloneWrap');
  const aloneBtn = document.getElementById('aloneBtn');
  const aloneTopBtn = document.getElementById('aloneTopBtn');
  const munAloneBtn = document.getElementById('munAloneBtn');
  if (aloneWrap) {
    aloneWrap.style.display = (viewMode === 'columns' && raiseAmount >= 0.05) ? 'flex' : 'none';
  }
  const selName = unitMode === 'precinct'
    ? (pinnedPrecinct ? pinnedPrecinct.code : '')
    : (pinnedCounty ? pinnedCounty.name : '');
  const unitName = (isBR && unitMode === 'precinct') ? 'cidade' : unitLow;
  const unitsName = (isBR && unitMode === 'precinct') ? 'cidades' : unitsLow;
  const titleTxt = !hasSelection
    ? `Escolha um ${unitName} na busca ou clicando no mapa e pressione aqui para ver apenas a coluna dele erguida`
    : active
    ? `Erguer novamente todos os ${unitsName}`
    : `Abaixar os outros ${unitsName} e ver a coluna de ${selName} isolada`;
  for (const btn of [aloneBtn, aloneTopBtn, munAloneBtn]) {
    if (!btn) continue;
    btn.disabled = !canAlone;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.title = titleTxt;
    if (btn === munAloneBtn) {
      btn.textContent = active ? 'Mostrar todos' : 'Isolar coluna 3D';
    }
  }
}

function frameCountyColumn(c) {
  if (!c) return;
  userMovedCamera = true;
  const isFlatView = viewMode !== 'dots' && raiseAmount < 0.05;
  const h = isFlatView ? BASE_H : (BASE_H + (c.targetH - BASE_H) * Math.max(0.25, raiseAmount));
  const dist = Math.max(72, Math.min(150, (c.span || 8) * 3.4 + h * 1.15));
  const toPos = isFlatView
    ? new THREE.Vector3(c.cx, Math.max(110, dist * 1.25), -c.cy + 0.01)
    : new THREE.Vector3(c.cx + dist * 0.24, Math.max(42, h * 0.85 + dist * 0.58), -c.cy + dist * 0.88);
  const toTarget = new THREE.Vector3(c.cx, isFlatView ? 0 : h * 0.32, -c.cy);
  animateCameraTo(toPos, toTarget, 840);
}

function toggleAloneMode(forceVal) {
  const hasSelection = unitMode === 'precinct' ? !!pinnedPrecinct : !!pinnedCounty;
  const next = typeof forceVal === 'boolean' ? forceVal : !aloneMode;
  if (next && !hasSelection) return;
  aloneMode = next;
  if (aloneMode && raiseAmount < 0.2) {
    raiseAmount = 1;
    const rs = document.getElementById('raise');
    if (rs) rs.value = '100';
  }
  if (prCols) {
    prCols.setIsolatedItem(aloneMode && unitMode === 'precinct' ? pinnedPrecinct : null);
  }
  applyHeights();
  syncAloneButtons();
  renderMunicipalityCard();
  if (unitMode === 'precinct' && pinnedPrecinct && pinnedTooltipOpen) {
    showPinnedPrecinctTooltip();
    if (aloneMode) frameCountyColumn(pinnedPrecinct);
  } else if (pinnedCounty && pinnedTooltipOpen) {
    showPinnedTooltip();
    if (aloneMode) frameCountyColumn(pinnedCounty);
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set('uf', STATE.slug);
  if (activeId && activeId !== STATE.defaultRace) params.set('race', activeId);
  if (viewMode === 'dots') {
    params.set('look', 'dots');
    if (dotScale !== 250) params.set('voters', String(dotScale));
  } else {
    if (isBR) {
      if (unitMode === 'county') params.set('unit', 'county');
    } else if (unitMode === 'precinct') {
      params.set('unit', 'precinct');
    }
    if (!colorByLead) params.set('color', 'margin');
  }
  if (raiseAmount < 0.05 && viewMode !== 'dots') params.set('flat', '1');
  if (pinnedCounty) params.set('mun', pinnedCounty.name);
  if (aloneMode && (pinnedCounty || pinnedPrecinct)) params.set('alone', '1');
  if (document.body.classList.contains('framed')) params.set('framed', '1');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));

  const cmp = document.getElementById('compareLink');
  if (cmp) {
    const cmpParams = new URLSearchParams();
    cmpParams.set('uf', STATE.slug);
    if (activeId) cmpParams.set('race', activeId);
    if (pinnedCounty) cmpParams.set('mun', pinnedCounty.name);
    cmp.href = 'compare.html?' + cmpParams.toString();
  }
  const vol = document.getElementById('volumeLink');
  if (vol) {
    vol.href = `volume.html?uf=${STATE.slug}${activeId ? `&race=${encodeURIComponent(activeId)}` : ''}`;
  }
}

let animStart = 0;

function countyMatchesFilter(c) {
  if (aloneMode && pinnedCounty) return c === pinnedCounty;
  if (filterWinner === 'all') return true;
  const { r = 0, d = 0, m = 0 } = c.cur || {};
  if (filterWinner === 'rep') return r >= d;
  if (filterWinner === 'dem') return d > r;
  if (filterWinner === 'close') return Math.abs(m) < 5;
  return true;
}

function applyHeights() {
  const k = raiseAmount;
  for (const c of counties) {
    const match = countyMatchesFilter(c);
    const effK = match ? k : 0;
    const h = BASE_H + (c.targetH - BASE_H) * effK;
    const { r = 0, d = 0, o = 0, tot = 0 } = c.cur || {};
    const rWins = r >= d;
    const winVotes = rWins ? r : d;
    const loseVotes = rWins ? d : r;
    c.fromBot = c.lower.scale.y || 0.01;
    c.fromMid = c.middle.visible ? c.middle.scale.y : 0;
    c.fromTop = c.mesh.scale.y || 0.29;
    const split = !activeRace?.isShift && effK > 0.02 && tot > 0 && winVotes > 0 && loseVotes > 0;
    if (split) {
      c.toBot = Math.max(0.02, h * (loseVotes / tot));
      c.toMid = o > 0 ? h * (o / tot) : 0;
      c.toTop = Math.max(0.02, h - c.toBot - c.toMid);
    } else {
      c.toBot = 0.01;
      c.toMid = 0;
      c.toTop = Math.max(0.02, h - 0.01);
    }
  }
  const raiseEl = document.getElementById('raiseText');
  if (raiseEl) {
    if (activeRace && activeRace.isShift) {
      raiseEl.innerHTML = `. ${STATE.base.note}`;
    } else {
      raiseEl.style.display = k > 0.02 ? 'inline' : 'none';
    }
  }
  if (prCols && unitMode === 'precinct') prCols.setRaise(viewMode === 'dots' ? 0 : k, true);
  if (cityMarkers) cityMarkers.refreshHeights();
  syncAloneButtons();
  animStart = performance.now();
}

function applyColors() {
  const isShift = !!(activeRace && activeRace.isShift);
  for (const c of counties) {
    const { r = 0, d = 0, shift = 0 } = c.cur || {};
    let winHex, loseHex;
    if (isShift) {
      winHex = shiftColorHex(shift);
      loseHex = winHex;
    } else {
      const rWins = r >= d;
      winHex = colorByLead ? leadColorHex(r, d, maxLead) : marginColorHex(r, d);
      loseHex = rWins
        ? (colorByLead ? leadColorHex(0, d, maxLead) : marginColorHex(0, 1))
        : (colorByLead ? leadColorHex(r, 0, maxLead) : marginColorHex(1, 0));
    }
    c.mat.color.set(winHex);
    c.lowerMat.color.set(loseHex);
  }
  const legHead = document.getElementById('legHead');
  const sr = document.getElementById('legScaleR');
  const sd = document.getElementById('legScaleD');
  const leadBtn = document.getElementById('leadColor');
  const leadHelp = document.getElementById('leadHelp');
  if (isShift) {
    if (legHead) legHead.textContent = `Cor = mudança na margem desde ${baseLabel} (pts)`;
    const labels = ['+2', '+5', '+10', '+15', '+20+'];
    if (sr) sr.innerHTML = labels.map(s => `<span>${s}</span>`).join('');
    if (sd) sd.innerHTML = labels.map(s => `<span>${s}</span>`).join('');
    if (leadBtn) leadBtn.style.display = 'none';
    if (leadHelp && leadHelp.parentElement) leadHelp.parentElement.style.display = 'none';
  } else if (colorByLead) {
    if (leadBtn) leadBtn.style.display = '';
    if (leadHelp && leadHelp.parentElement) leadHelp.parentElement.style.display = '';
    const k = v => v >= 1000 ? Math.round(v / 1000) + ' mil' : String(Math.round(v));
    const stops = [0.02, 0.12, 0.32, 0.62, 1.0].map(t => k(maxLead * t));
    if (legHead) legHead.textContent = `Cor = saldo líquido de votos (vantagem no ${unitLow})`;
    if (sr) sr.innerHTML = stops.map(s => `<span>+${s}</span>`).join('');
    if (sd) sd.innerHTML = stops.map(s => `<span>+${s}</span>`).join('');
  } else {
    if (leadBtn) leadBtn.style.display = '';
    if (leadHelp && leadHelp.parentElement) leadHelp.parentElement.style.display = '';
    if (legHead) legHead.textContent = 'Cor = margem de vitória (pontos percentuais)';
    const def = '<span>&lt;5</span><span>10</span><span>20</span><span>30</span><span>40+</span>';
    if (sr) sr.innerHTML = def;
    if (sd) sd.innerHTML = def;
  }
  if (prCols && unitMode === 'precinct') prCols.setColorMode(colorByLead);
}

// Renderiza o cartão de Raio-X Municipal completo quando um município está selecionado
function renderMunicipalityCard() {
  const cardEl = document.getElementById('munCard');
  if (!cardEl) return;
  if (!pinnedCounty || !activeRace) {
    cardEl.style.display = 'none';
    cardEl.innerHTML = '';
    return;
  }
  const c = pinnedCounty;
  const meta = pinnedMeta || { pop: null, aptos: 0, zonesCount: 0 };
  const curRow = activeRace.counties[c.key] || activeRace.counties[c.name] || [0, 0, 0];
  const curTot = (curRow[0] || 0) + (curRow[1] || 0) + (curRow[2] || 0);
  const turnoutPct = meta.aptos > 0 ? Math.min(100, (curTot / meta.aptos) * 100) : null;

  // Todas as disputas de 2026 no município
  const races26Ids = ['2026-pres-2t', '2026-pres-1t', '2026-gov', '2026-sen', '2026-dep-fed', '2026-dep-est'].filter(id => races[id]);
  const races26Html = races26Ids.map(id => {
    const rr = races[id];
    const row = rr.counties[c.key] || rr.counties[c.name] || [0, 0, 0];
    const rv = row[0] || 0, dv = row[1] || 0, ov = row[2] || 0;
    const t = rv + dv + ov || 1;
    const rp = (rv / t) * 100, dp = (dv / t) * 100, op = (ov / t) * 100;
    const shortLabel = rr.office === 'Presidente' ? `Pres. ${rr.tag === '2º Turno' ? '2ºT' : '1ºT'}` :
      rr.office === 'Governador' ? 'Governador' :
      rr.office.startsWith('Senad') ? 'Senado' :
      rr.office === 'Deputado Federal' ? 'Dep. Federal' : 'Dep. Estadual';
    const winTxt = rv >= dv
      ? `<span class="rep-t">PL ${rp.toFixed(1)}%</span>`
      : `<span class="dem-t">PT ${dp.toFixed(1)}%</span>`;
    return `
      <div class="mun-race-row ${id === activeId ? 'active' : ''}" data-race="${id}" title="Clique para ver ${rr.office} no mapa">
        <span>${shortLabel}</span>
        <div class="mun-race-bar">
          <div class="r" style="width:${rp.toFixed(1)}%"></div>
          <div class="o" style="width:${op.toFixed(1)}%"></div>
          <div class="d" style="width:${dp.toFixed(1)}%"></div>
        </div>
        <span>${winTxt}</span>
      </div>
    `;
  }).join('');

  // Histórico Presidencial 2018 -> 2022 -> 2026 no município
  const histIds = ['2018-presidente', '2022-presidente', '2026-pres-2t'].filter(id => races[id]);
  const histHtml = histIds.map(id => {
    const rr = races[id];
    const row = rr.counties[c.key] || rr.counties[c.name] || [0, 0, 0];
    const rv = row[0] || 0, dv = row[1] || 0, ov = row[2] || 0;
    const t = rv + dv + ov || 1;
    const rp = (rv / t) * 100, dp = (dv / t) * 100;
    const winTxt = rv >= dv
      ? `<span class="rep-t">PL ${rp.toFixed(1)}%</span> (${fmt(rv)})`
      : `<span class="dem-t">PT ${dp.toFixed(1)}%</span> (${fmt(dv)})`;
    return `
      <div class="mun-race-row ${id === activeId ? 'active' : ''}" data-race="${id}">
        <span>Pres. ${rr.year}</span>
        <div class="mun-race-bar">
          <div class="r" style="width:${rp.toFixed(1)}%"></div>
          <div class="d" style="width:${dp.toFixed(1)}%"></div>
        </div>
        <span>${winTxt}</span>
      </div>
    `;
  }).join('');

  const stDrill = isBR ? STATES.find(s => s.slug !== 'br' && s.name.toUpperCase() === c.key) : null;
  const drillHtml = stDrill
    ? `<a class="flight-link" style="margin-bottom:10px;text-align:center" href="estado.html?uf=${stDrill.slug}">Explorar os ${stDrill.counties} municípios de ${stDrill.name} em 3D →</a>`
    : '';

  cardEl.style.display = 'block';
  cardEl.innerHTML = `
    <div class="mun-head">
      <div>
        <div class="kicker">Raio-X ${isBR ? 'Estadual' : 'Municipal'} · ${STATE.code}</div>
        <h3>${c.name}</h3>
      </div>
      <div class="mun-actions">
        <button type="button" id="munAloneBtn" title="Isolar a coluna 3D deste ${unitLow}">${aloneMode ? 'Mostrar todos' : 'Isolar coluna 3D'}</button>
        <button type="button" id="munShareBtn" title="Copiar link direto para este ${unitLow}">Compartilhar</button>
        <button type="button" id="munCloseBtn" title="Fechar Raio-X">✕</button>
      </div>
    </div>
    ${drillHtml}
    <div class="mun-stats">
      <div class="mun-stat">
        <span>Votos válidos (${activeRace.year})</span>
        <b>${fmt(curTot)}</b>
      </div>
      <div class="mun-stat">
        <span>Eleitores aptos (TSE)</span>
        <b>${meta.aptos ? fmt(meta.aptos) : '—'}</b>
      </div>
      <div class="mun-stat">
        <span>${meta.pop ? 'Pop. Censo 2022' : 'Comp. válido'}</span>
        <b>${meta.pop ? fmt(meta.pop) : (turnoutPct ? turnoutPct.toFixed(1) + '%' : '—')}</b>
      </div>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">
      <b class="rep-t">${activeRace.rep}: ${fmt(curRow[0] || 0)}</b> vs.
      <b class="dem-t">${activeRace.dem}: ${fmt(curRow[1] || 0)}</b>
      ${meta.zonesCount ? ` · <b>${meta.zonesCount}</b> ${meta.zonesCount === 1 ? 'zona eleitoral' : 'zonas eleitorais'}` : ''}
      ${turnoutPct ? ` · Comparecimento válido: <b>${turnoutPct.toFixed(1)}%</b>` : ''}
    </div>
    <div class="mun-subhead">Todos os cargos em 2026 neste ${unitLow}</div>
    <div class="mun-races">${races26Html}</div>
    <div class="mun-subhead">Evolução presidencial (2018 → 2022 → 2026)</div>
    <div class="mun-races">${histHtml}</div>
  `;

  cardEl.querySelectorAll('.mun-race-row[data-race]').forEach(el => {
    el.onclick = () => selectRace(el.dataset.race);
  });
  const munAloneBtn = document.getElementById('munAloneBtn');
  if (munAloneBtn) munAloneBtn.onclick = () => toggleAloneMode();
  const closeBtn = document.getElementById('munCloseBtn');
  if (closeBtn) closeBtn.onclick = () => { if (places) places.clearAll(); };
  const shareBtn = document.getElementById('munShareBtn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      syncUrl();
      const url = getPublicShareUrl();
      copyTextToClipboard(url).then(() => {
        shareBtn.textContent = 'Link copiado!';
        setTimeout(() => { shareBtn.textContent = 'Compartilhar'; }, 1800);
      });
    };
  }
  syncAloneButtons();
}

export function getPublicShareUrl() {
  const page = location.pathname.split('/').pop() || 'estado.html';
  const params = new URLSearchParams(location.search);
  params.delete('framed');
  const qs = params.toString();
  const rel = `${page}${qs ? '?' + qs : ''}${location.hash || ''}`;
  if (/\.run\.app$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
    return `https://guumachadooo.github.io/usavote/${rel}`;
  }
  return new URL(rel, location.href).href;
}

export function copyTextToClipboard(text) {
  window.__lastCopiedUrl = text;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
  }
  return fallbackCopyText(text);
}

function fallbackCopyText(text) {
  return new Promise(resolve => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

function setRace(id) {
  activeId = id;
  const r = races[id];
  activeRace = r;
  document.getElementById('kicker').textContent = (r.label ? r.label.split(' · ')[0] : '') || `Eleições ${r.year}`;
  document.getElementById('title').textContent =
    `${STATE.name} · ${r.office} ${r.year}` + (r.tag ? ` (${r.tag})` : '');
  document.getElementById('raceLine').textContent =
    `${r.rep} vs. ${r.dem}` + (r.note ? ` — ${r.note}` : '');

  let maxVotes = 0;
  maxLead = 1;
  let rCounties = 0, dCounties = 0;
  let rLand = 0, dLand = 0;
  let maxCounty = null;

  for (const c of counties) {
    const row = r.counties[c.key] || r.counties[c.name] || [0, 0, 0];
    const rv = row[0] || 0, dv = row[1] || 0, ov = row[2] || 0;
    const tot = rv + dv + ov;
    if (tot > maxVotes) { maxVotes = tot; maxCounty = { c, tot }; }
  }

  let shiftToR = 0, shiftToD = 0, shiftLandR = 0, shiftLandD = 0;
  let maxShiftR = null, maxShiftD = null;

  for (const c of counties) {
    const row = r.counties[c.key] || r.counties[c.name] || [0, 0, 0];
    const rv = row[0] || 0, dv = row[1] || 0, ov = row[2] || 0;
    const tot = rv + dv + ov;
    const twoParty = rv + dv;
    const m = twoParty ? ((rv - dv) / twoParty) * 100 : 0;

    let shift = 0, baseM = 0, curM = 0, baseTot = 0;
    if (r.isShift && baseRace) {
      const brow = baseRace.counties[c.key] || baseRace.counties[c.name] || [0, 0, 0];
      const br = brow[0] || 0, bd = brow[1] || 0, bo = brow[2] || 0;
      baseTot = br + bd + bo;
      const bTwo = br + bd;
      baseM = bTwo ? (br - bd) / bTwo : 0;
      curM  = twoParty ? (rv - dv) / twoParty : 0;
      shift = (twoParty && bTwo) ? (curM - baseM) : 0;
      c.targetH = baseTot > 0 ? BASE_H + (baseTot / baseMaxVotes) * MAX_H : BASE_H;
      if (shift >= 0) { shiftToR++; shiftLandR += c.area; if (!maxShiftR || shift > maxShiftR.shift) maxShiftR = { c, shift }; }
      else            { shiftToD++; shiftLandD += c.area; if (!maxShiftD || shift < maxShiftD.shift) maxShiftD = { c, shift }; }
    } else {
      c.targetH = tot > 0 ? BASE_H + (tot / maxVotes) * MAX_H : BASE_H;
    }

    const lead = Math.abs(rv - dv);
    if (lead > maxLead) maxLead = lead;

    c.cur = {
      r: rv, d: dv, o: ov, tot, m, win: rv >= dv ? 'R' : 'D',
      shift, baseM: baseM * 100, curM: curM * 100,
    };

    if (tot > 0) {
      if (rv >= dv) { rCounties++; rLand += c.area; }
      else          { dCounties++; dLand += c.area; }
    }
  }

  applyColors();
  applyHeights();

  const totR = r.totals.R, totD = r.totals.D, totO = r.totals.O || 0;
  const totAll = totR + totD + totO;
  const rPct = totAll ? totR / totAll : 0;
  const dPct = totAll ? totD / totAll : 0;
  const oPct = totAll ? totO / totAll : 0;
  const winner = totR >= totD ? r.rep : r.dem;
  const winCls = totR >= totD ? 'rep-t' : 'dem-t';
  const margin = totAll ? Math.abs(totR - totD) / totAll : 0;
  const lead = Math.abs(totR - totD);

  if (r.isShift && baseRace) {
    const bTotR = baseRace.totals.R, bTotD = baseRace.totals.D;
    const bTwo = bTotR + bTotD, cTwo = totR + totD;
    const stateShift = ((totR - totD) / cTwo - (bTotR - bTotD) / bTwo) * 100;
    const dir = stateShift >= 0 ? 'PL' : 'PT';
    const dirCls = stateShift >= 0 ? 'rep-t' : 'dem-t';
    const pts = Math.abs(stateShift).toFixed(1);
    document.getElementById('headline').innerHTML = `
      O estado de ${STATE.name} moveu <b class="${dirCls}">${pts} pontos em direção ao ${dir}</b> em relação a ${baseLabel}.
      <b>${shiftToR}</b> de ${counties.length} ${unitsLow} oscilaram para o PL;
      <b>${shiftToD}</b> oscilaram para o PT.
      <div class="big">
        <span><b class="rep-t">→ PL em ${shiftToR}</b> ${unitsLow}</span>
        <span><b class="dem-t">→ PT em ${shiftToD}</b> ${unitsLow}</span>
      </div>
    `;
  } else {
    document.getElementById('headline').innerHTML = `
      <b class="${winCls}">${winner}</b> venceu em ${STATE.name} por
      <b>${ (margin * 100).toFixed(1) } pontos</b> (${fmt(lead)} votos de vantagem),
      enquanto o PL levou <b>${rCounties} de ${rCounties + dCounties} ${unitsLow}</b>
      (${ Math.round((rCounties / Math.max(1, rCounties + dCounties)) * 100) }%).
      <div class="big">
        <span><b class="rep-t">${r.rep}</b> ${fmt(totR)} (${pct(rPct)})</span>
        <span><b class="dem-t">${r.dem}</b> ${fmt(totD)} (${pct(dPct)})</span>
      </div>
    `;
  }

  const landTot = rLand + dLand || 1;
  const cTot = rCounties + dCounties || 1;
  let bars = [
    {
      label: `${UNITS_CAP} vencidos`,
      right: `${rCounties} PL · ${dCounties} PT`,
      r: rCounties / cTot, d: dCounties / cTot, o: 0,
    },
    {
      label: 'Área territorial vencida',
      right: `${pct(rLand / landTot)} PL · ${pct(dLand / landTot)} PT`,
      r: rLand / landTot, d: dLand / landTot, o: 0,
    },
    {
      label: 'Votos reais (eleitores)',
      right: `${pct(rPct)} PL · ${pct(dPct)} PT`,
      r: rPct, d: dPct, o: oPct,
    },
  ];
  if (r.seats) {
    const sTot = r.seats.R + r.seats.D || 1;
    bars.push({
      label: r.seats.label || `Cadeiras obtidas (${sTot})`,
      right: `${r.seats.R} PL (${pct(r.seats.R / sTot)}) · ${r.seats.D} PT (${pct(r.seats.D / sTot)})`,
      r: r.seats.R / sTot, d: r.seats.D / sTot, o: 0,
    });
  }
  document.getElementById('bars').innerHTML = bars.map(b => {
    const rW = b.r * 100, dW = b.d * 100, oW = b.o * 100;
    return `
      <div class="bar-block">
        <div class="bar-label"><span>${b.label}</span><span>${b.right}</span></div>
        <div class="bar">
          <div class="r" style="width:${rW.toFixed(2)}%">${rW >= 18 ? Math.round(rW) + '% PL' : ''}</div>
          <div class="o" style="width:${oW.toFixed(2)}%"></div>
          <div class="d" style="width:${dW.toFixed(2)}%">${dW >= 18 ? Math.round(dW) + '% PT' : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  if (r.isShift && maxShiftR && maxShiftD) {
    document.getElementById('harris').innerHTML =
      `Maior giro para o PL: <b>${maxShiftR.c.name}</b> (+${(maxShiftR.shift * 100).toFixed(1)} pts). ` +
      `Maior giro para o PT: <b>${maxShiftD.c.name}</b> (${(maxShiftD.shift * 100).toFixed(1)} pts).`;
  } else if (maxCounty) {
    const share = totAll ? ((maxCounty.tot / totAll) * 100).toFixed(1) : '0';
    document.getElementById('harris').innerHTML =
      `O pico mais alto é <b>${maxCounty.c.name}</b> (${fmt(maxCounty.tot)} votos — ${share}% de todo o estado).`;
  }

  cartoWarper.prepareTargets();
  renderTables(id);
  refreshDots(id);
  // Pre-compute dot buffer in background worker so switching to Pontos is instantaneous
  if (viewMode !== 'dots' && r && r.counties) {
    const votesByCounty = counties.map(c => r.counties[c.key] || r.counties[c.name] || [0, 0, 0]);
    setTimeout(() => {
      dotLayer.preload({ votesByCounty, scale: dotScale, seedSalt: hashStr(id), raceKey: id });
    }, 120);
  }
  syncUnitAvailability(id);
  if (unitMode === 'precinct') applyPrecinctUnit();
  if (places) places.refresh();
  renderMunicipalityCard();
  syncUrl();
}

const yearSelect = document.getElementById('yearSelect');
const raceSelect = document.getElementById('raceSelect');
const years = [...new Set(order.map(id => races[id].year))];
yearSelect.innerHTML = years.map(y =>
  `<option value="${y}">${y === '2026' ? '2026 (Gerais)' : y}</option>`
).join('');

function populateRaceSelect(year, pickId) {
  const inYear = order.filter(id => races[id].year === year);
  raceSelect.innerHTML = inYear.map(id => {
    const r = races[id];
    const tag = r.tag ? ` (${r.tag})` : '';
    return `<option value="${id}">${r.office}${tag} — ${r.rep} vs. ${r.dem}</option>`;
  }).join('');
  const target = (pickId && inYear.includes(pickId)) ? pickId : inYear[0];
  raceSelect.value = target;
  return target;
}

yearSelect.onchange = () => {
  const nextId = populateRaceSelect(yearSelect.value);
  withBusy('Trocando disputa…', () => setRace(nextId));
};
raceSelect.onchange = () => withBusy('Trocando disputa…', () => setRace(raceSelect.value));

function selectRace(id, immediate = false) {
  const r = races[id];
  if (!r) return;
  activeId = id;
  activeRace = r;
  yearSelect.value = r.year;
  populateRaceSelect(r.year, id);
  if (immediate) {
    setRace(id);
  } else {
    withBusy('Trocando disputa…', () => setRace(id));
  }
}

function rowHtml(id, labelCol) {
  const r = races[id];
  const tot = r.totals.R + r.totals.D + (r.totals.O || 0);
  if (!tot) return '';
  const m = ((r.totals.R - r.totals.D) / tot) * 100;
  const rWin = m >= 0;
  const sign = rWin ? 'PL+' : 'PT+';
  return `
    <tr data-id="${id}" class="${id === activeId ? 'current' : ''}">
      <td>${labelCol}</td>
      <td><span class="pill-win ${rWin ? 'pill-r' : 'pill-d'}">${rWin ? r.rep : r.dem}</span></td>
      <td class="num">${sign}${Math.abs(m).toFixed(1)}%</td>
      <td class="num">${(tot / 1e6).toFixed(2)}M</td>
    </tr>
  `;
}

function bindTableClicks(tbl) {
  tbl.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.onclick = () => selectRace(tr.dataset.id);
  });
}

function renderTables(activeId) {
  const cur = races[activeId];

  document.getElementById('yearTitle').textContent =
    `Todos os cargos em ${cur.year}`;
  const sameYear = order.filter(id => races[id].year === cur.year);
  const yearTbl = document.getElementById('yearTable');
  yearTbl.innerHTML = `
    <thead><tr><th>Cargo</th><th>Vencedor</th><th class="num">Margem</th><th class="num">Votos</th></tr></thead>
    <tbody>${sameYear.map(id => {
      const r = races[id];
      return rowHtml(id, r.office + (r.tag ? ` <span style="color:var(--muted)">(${r.tag})</span>` : ''));
    }).join('')}</tbody>
  `;
  bindTableClicks(yearTbl);

  const sameOffice = order.filter(id => races[id].office === cur.office && !races[id].isShift);
  const officeBlock = document.getElementById('officeBlock');
  if (sameOffice.length > 1) {
    officeBlock.style.display = '';
    document.getElementById('officeTitle').textContent =
      `${cur.office} ao longo dos anos`;
    const offTbl = document.getElementById('officeTable');
    offTbl.innerHTML = `
      <thead><tr><th>Ano</th><th>Vencedor</th><th class="num">Margem</th><th class="num">Votos</th></tr></thead>
      <tbody>${sameOffice.map(id => {
        const r = races[id];
        return rowHtml(id, r.year + (r.tag ? ` <span style="color:var(--muted)">(${r.tag})</span>` : ''));
      }).join('')}</tbody>
    `;
    bindTableClicks(offTbl);
  } else {
    officeBlock.style.display = 'none';
  }
}

const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

function refreshDots(id = activeId) {
  if (viewMode !== 'dots') return;
  const r = races[id] || activeRace || races[order[0]];
  if (!r || !r.counties) return;
  const votesByCounty = counties.map(c => r.counties[c.key] || r.counties[c.name] || [0, 0, 0]);
  dotLayer.setScaleAppearance(dotScale);
  dotLayer.setRaise(0);
  const busyEl = document.getElementById('busy');
  const busyText = document.getElementById('busyText');
  if (busyText) busyText.textContent = 'Posicionando pontos de eleitores…';
  if (busyEl) { busyEl.classList.add('on'); busyEl.setAttribute('aria-busy', 'true'); }
  dotLayer.generate(
    { votesByCounty, scale: dotScale, seedSalt: hashStr(id), raceKey: id },
    ({ totalDots }) => {
      document.getElementById('dotCount').textContent = `${fmt(totalDots)} pontos`;
      if (busyEl) { busyEl.classList.remove('on'); busyEl.setAttribute('aria-busy', 'false'); }
    }
  );
}

function setCountyMeshesVisible(v) {
  for (const c of counties) {
    c.mesh.visible = v;
    c.lower.visible = v;
    if (!v) c.middle.visible = false;
  }
}

function syncUnitAvailability(id = activeId) {
  const sw = document.getElementById('unitSwitch');
  if (!prCols || !sw) return;
  prCols.loadOnce().then(() => {
    const ok = viewMode === 'columns' && prCols.hasRace(id);
    sw.style.display = ok ? 'inline-flex' : 'none';
    if (!ok && unitMode === 'precinct') setUnitMode('county');
    if (isBR && munSearchList && !munSearchList.dataset.hasCities) {
      const cityNames = prCols.getRawCodes ? prCols.getRawCodes() : [];
      if (cityNames.length) {
        munSearchList.dataset.hasCities = '1';
        const stateNames = counties.map(c => c.name);
        const allNames = [...new Set([...stateNames, ...cityNames])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        munSearchList.innerHTML = allNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
      }
    }
  });
}

function applyPrecinctUnit() {
  if (!prCols) return;
  prCols.loadOnce().then(() => {
    if (viewMode === 'dots' || unitMode !== 'precinct') return;
    const info = prCols.showRace(activeId, raiseAmount, colorByLead);
    if (!info) return;
    setCountyMeshesVisible(false);
    if (cityMarkers && cityMarkers.setUnitMode) {
      cityMarkers.setUnitMode('precinct', prCols);
    }
    document.getElementById('scale').textContent = isBR
      ? `Cada uma das ${fmt(info.count)} colunas é um município brasileiro (com Brasília unificada no DF); a altura reflete o total de votos da cidade`
      : `Cada uma das ${fmt(info.count)} barras é uma zona eleitoral; a altura é proporcional ao total de votos da zona`;
  });
}

function setUnitMode(mode) {
  if (!prCols) mode = 'county';
  unitMode = mode;
  document.getElementById('unitCounty').classList.toggle('active', mode === 'county');
  document.getElementById('unitPrecinct').classList.toggle('active', mode === 'precinct');
  if (mode === 'precinct') {
    if (cartoMode) {
      cartoMode = false;
      cartoWarper.setTargetMix(0);
    }
    if (aloneMode && !pinnedPrecinct) {
      aloneMode = false;
      prCols.setIsolatedItem(null);
    }
    const busyMsg = isBR ? 'Construindo os 5.570 municípios do Brasil em 3D…' : 'Construindo colunas das zonas eleitorais…';
    withBusy(busyMsg, () => applyPrecinctUnit());
  } else {
    if (prCols) {
      prCols.setIsolatedItem(null);
      prCols.setVisible(false);
    }
    if (cityMarkers && cityMarkers.setUnitMode) {
      cityMarkers.setUnitMode('county', null);
    }
    pinnedPrecinct = null;
    if (viewMode !== 'dots') setCountyMeshesVisible(true);
    document.getElementById('scale').textContent = 'A altura é proporcional ao total de votos válidos';
    applyHeights();
  }
  syncAloneButtons();
  syncUrl();
}

document.getElementById('unitCounty').onclick = () => setUnitMode('county');
document.getElementById('unitPrecinct').onclick = () => setUnitMode('precinct');

let modeFadeTimer = null;
let modeStageTimer = null;
let cartoMode = false;

function syncModeButtonsUI() {
  const isDots = viewMode === 'dots';
  const isFlat = !isDots && !cartoMode && raiseAmount < 0.05;
  const is3d = !isDots && !cartoMode && raiseAmount >= 0.05;
  document.getElementById('modeCols')?.classList.toggle('active', !isDots && !cartoMode);
  document.getElementById('modeCartoBtn')?.classList.toggle('active', cartoMode && !isDots);
  document.getElementById('modeDotsBtn')?.classList.toggle('active', isDots);
  document.getElementById('viewDots')?.classList.toggle('active', isDots);
  document.getElementById('viewCarto')?.classList.toggle('active', cartoMode && !isDots);
  document.getElementById('viewFlat')?.classList.toggle('active', isFlat);
  document.getElementById('view3d')?.classList.toggle('active', is3d);
}

function setViewMode(mode, immediate = false) {
  const prevMode = viewMode;
  const wasCarto = cartoMode;
  if (mode === 'carto') {
    cartoMode = true;
    viewMode = 'columns';
    if (unitMode === 'precinct') setUnitMode('county');
  } else {
    cartoMode = false;
    viewMode = mode;
  }

  if (modeFadeTimer) { clearTimeout(modeFadeTimer); modeFadeTimer = null; }
  if (modeStageTimer) { clearTimeout(modeStageTimer); modeStageTimer = null; }

  cartoWarper.setTargetMix(cartoMode ? 1.0 : 0.0, immediate);
  syncModeButtonsUI();

  const isDots = viewMode === 'dots';
  const showPrecincts = !isDots && unitMode === 'precinct';

  if (isDots) {
    // Mirrored transition:
    // - From 3D (raiseAmount >= 0.05): Dots fade in AT 3D column height first, then compress down together with columns!
    // - From Plano (raiseAmount < 0.05): Smooth cross-fade at ground level without hard cut!
    const from3D = !immediate && prevMode === 'columns' && raiseAmount >= 0.05;
    dotLayer.setRaise(from3D ? raiseAmount : 0, true);
    dotLayer.setVisible(true, immediate);
    refreshDots();

    if (!immediate && prevMode === 'columns') {
      if (from3D) {
        // Phase 1: Let dots materialize on the 3D columns for 160ms, then compress columns + dots to ground together
        modeStageTimer = setTimeout(() => {
          if (viewMode !== 'dots') return;
          dotLayer.setRaise(0, false);
          for (const c of counties) {
            c.fromBot = c.lower.scale.y || 0.01;
            c.fromMid = c.middle.visible ? c.middle.scale.y : 0;
            c.fromTop = c.mesh.scale.y || 0.29;
            c.toBot = 0.01;
            c.toMid = 0;
            c.toTop = BASE_H - 0.01;
          }
          animStart = performance.now();
          if (prCols && unitMode === 'precinct') prCols.setRaise(0, true);
        }, 160);
        modeFadeTimer = setTimeout(() => {
          if (viewMode === 'dots') {
            setCountyMeshesVisible(false);
            if (prCols) prCols.setVisible(false);
          }
        }, 680);
      } else {
        // Plano -> Pontos: smooth 460ms cross-fade before hiding flat county meshes
        modeFadeTimer = setTimeout(() => {
          if (viewMode === 'dots') {
            setCountyMeshesVisible(false);
            if (prCols) prCols.setVisible(false);
          }
        }, 460);
      }
    } else {
      setCountyMeshesVisible(false);
      if (prCols) prCols.setVisible(false);
    }
  } else {
    setCountyMeshesVisible(!showPrecincts);
    if (prCols) {
      if (showPrecincts) applyPrecinctUnit();
      else prCols.setVisible(false);
    }

    if (!immediate && prevMode === 'dots') {
      const to3D = raiseAmount >= 0.05;
      if (to3D) {
        // Pontos -> 3D (Mirrored!): Columns start at flat ground and rise UP together with dots,
        // then dots smoothly fade out once at 3D height!
        for (const c of counties) {
          c.lower.scale.y = 0.01;
          c.middle.scale.y = 0;
          c.mesh.position.y = 0.01;
          c.mesh.scale.y = BASE_H - 0.01;
        }
        applyHeights();
        dotLayer.setRaise(raiseAmount, false);
        modeFadeTimer = setTimeout(() => {
          if (viewMode !== 'dots') {
            dotLayer.setVisible(false, false);
          }
        }, 320);
      } else {
        // Pontos -> Plano: Smooth cross-fade at ground level
        applyHeights();
        dotLayer.setRaise(0, true);
        dotLayer.setVisible(false, false);
      }
    } else {
      dotLayer.setVisible(false, immediate);
      applyHeights();
    }
  }

  if (cityMarkers) cityMarkers.refreshHeights();
  document.getElementById('dotScalePill').style.display = isDots ? 'flex' : 'none';
  document.getElementById('colorPill').style.display = isDots ? 'none' : 'flex';
  document.getElementById('scale').textContent = isDots
    ? `Cada ponto representa ${fmt(dotScale)} eleitores daquele partido, com brilho modulado pela densidade eleitoral local`
    : cartoMode
    ? 'Cartograma eleitoral: os municípios mais populosos se expandem proporcionalmente ao seu peso no total de votos'
    : 'A altura é proporcional ao total de votos válidos';
  syncTurnVisibility();
  syncUnitAvailability();
  syncAloneButtons();
  syncUrl();
}

const modeColsBtn = document.getElementById('modeCols');
if (modeColsBtn) modeColsBtn.onclick = () => {
  if (raiseAmount < 0.05) raiseAmount = 1;
  document.getElementById('raise').value = String(Math.round(raiseAmount * 100));
  setViewMode('columns');
};
const modeCartoBtn = document.getElementById('modeCartoBtn');
if (modeCartoBtn) modeCartoBtn.onclick = () => {
  setViewMode('carto');
  animateCameraTo(new THREE.Vector3(0, 265, 95), new THREE.Vector3(0, 0, 2), 780);
};
const viewCartoBtn = document.getElementById('viewCarto');
if (viewCartoBtn) viewCartoBtn.onclick = () => {
  setViewMode('carto');
  animateCameraTo(new THREE.Vector3(0, 265, 95), new THREE.Vector3(0, 0, 2), 780);
};
const modeDotsBtn = document.getElementById('modeDotsBtn');
if (modeDotsBtn) modeDotsBtn.onclick = () => setViewMode('dots');
const viewDotsBtn = document.getElementById('viewDots');
if (viewDotsBtn) viewDotsBtn.onclick = () => setViewMode('dots');

const dotScaleSel = document.getElementById('dotScale');
if (dotScaleSel) dotScaleSel.onchange = (e) => {
  dotScale = +e.target.value;
  document.getElementById('scale').textContent =
    `Cada ponto representa ${fmt(dotScale)} eleitores daquele partido, posicionados dentro de cada zona eleitoral`;
  refreshDots();
  syncUrl();
};

const raiseSlider = document.getElementById('raise');
const btnFlat = document.getElementById('viewFlat');
const btn3d = document.getElementById('view3d');
const turnWrap = document.getElementById('turnWrap');
const turnSlider = document.getElementById('turn');
let spinSpeed = isFramed ? 0 : 0.25;

function syncTurnVisibility() {
  if (!turnWrap) return;
  turnWrap.style.display = (viewMode === 'columns' && raiseAmount > 0.05) ? 'flex' : 'none';
}

function setRaise(v, keepCarto = false) {
  raiseAmount = v;
  raiseSlider.value = Math.round(v * 100);
  if (!keepCarto && cartoMode) {
    cartoMode = false;
    cartoWarper.setTargetMix(0);
  }
  if (viewMode === 'dots') {
    setViewMode('columns');
  } else {
    syncModeButtonsUI();
    if (v < 0.05) aloneMode = false;
    applyHeights();
    dotLayer.setRaise(v);
    syncTurnVisibility();
    syncAloneButtons();
    syncUrl();
  }
}
raiseSlider.oninput = e => setRaise(+e.target.value / 100, cartoMode);
btnFlat.onclick = () => {
  setRaise(0, false);
  animateCameraTo(new THREE.Vector3(0, 290, 0.01), new THREE.Vector3(0, 0, 0), 780);
};
btn3d.onclick = () => {
  setRaise(1, false);
  animateCameraTo(new THREE.Vector3(0, 215, 225), new THREE.Vector3(0, 0, 6), 780);
};
if (turnSlider) {
  turnSlider.oninput = e => {
    spinSpeed = +e.target.value / 100;
    if (spinSpeed > 0) userMovedCamera = false;
  };
}
const leadColorBtn = document.getElementById('leadColor');
const shareColorBtn = document.getElementById('colorShare');
function setLeadColorMode(byLead) {
  colorByLead = byLead;
  leadColorBtn?.classList.toggle('active', colorByLead);
  shareColorBtn?.classList.toggle('active', !colorByLead);
  withBusy('Recolorindo…', () => {
    applyColors();
    syncUrl();
  });
}
if (leadColorBtn) leadColorBtn.onclick = () => setLeadColorMode(true);
if (shareColorBtn) shareColorBtn.onclick = () => setLeadColorMode(false);

const aloneBtn = document.getElementById('aloneBtn');
const aloneTopBtn = document.getElementById('aloneTopBtn');
if (aloneBtn) aloneBtn.onclick = () => toggleAloneMode();
if (aloneTopBtn) aloneTopBtn.onclick = () => toggleAloneMode();

document.getElementById('reset').onclick = () => {
  userMovedCamera = false;
  aloneMode = false;
  pinnedPrecinct = null;
  if (prCols) {
    prCols.setIsolatedItem(null);
    prCols.highlight(null);
    prCols.setFilterWinner('all');
  }
  filterWinner = 'all';
  const fw = document.getElementById('filterWinner');
  if (fw) fw.value = 'all';
  if (places) places.clearAll();
  const qs = document.getElementById('munQuickSearch');
  if (qs) qs.value = '';
  // Preserva o modo atual (2D Plano, 3D, Pontos, Estados ou Municípios) e centraliza com animação fluida
  applyHeights();
  const isFlatNow = viewMode !== 'dots' && raiseAmount < 0.05;
  if (isFlatNow) {
    animateCameraTo(new THREE.Vector3(0, 290, 0.01), new THREE.Vector3(0, 0, 0), 820);
  } else {
    animateCameraTo(new THREE.Vector3(0, 215, 225), new THREE.Vector3(0, 0, 6), 820);
  }
  syncAloneButtons();
  syncUrl();
};

let pinnedTooltipOpen = false;

function buildPrecinctTooltipHtml(pHit, isPinned = false) {
  const { r, d, o, tot } = pHit;
  const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
  const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
  const sign = r >= d ? 'PL+' : 'PT+';
  const m = (r + d) ? Math.abs(((r - d) / (r + d)) * 100).toFixed(1) : '0.0';
  const closeHtml = isPinned ? `<button type="button" class="t-close" title="Fechar cartão" aria-label="Fechar">×</button>` : '';
  const stDrill = isBR ? STATES.find(s => s.slug !== 'br' && s.name.toUpperCase() === String(pHit.county || '').toUpperCase()) : null;
  const canIsolate = viewMode === 'columns' && unitMode === 'precinct' && raiseAmount >= 0.05;
  const actionsHtml = isPinned
    ? `<div class="t-actions">` +
      (stDrill ? `<button type="button" class="t-drill-btn" data-uf="${stDrill.slug}" data-mun="${pHit.code.replace(/\s*\([A-Z]{2}\)\s*$/, '')}">Ver estado (${stDrill.code}) →</button>` : '') +
      (canIsolate ? `<button type="button" class="t-alone-btn">${aloneMode ? 'Mostrar todas' : (isBR ? 'Só esta cidade' : 'Só esta zona')}</button>` : '') +
      `<button type="button" class="t-share-btn" title="Copiar link direto">Copiar link</button>` +
      `</div>`
    : '';
  const titleLine = isBR ? `${pHit.code} · ${pHit.county}` : `${pHit.county} · ${pHit.code}`;
  return `
    ${closeHtml}
    <div class="t-name">${titleLine}</div>
    <div class="t-row"><span class="rep-t">${fmtCandName(activeRace.rep, 'PL')}</span><span>${fmt(r)} (${rPct}%)</span></div>
    <div class="t-row"><span class="dem-t">${fmtCandName(activeRace.dem, 'PT')}</span><span>${fmt(d)} (${dPct}%)</span></div>
    ${o ? `<div class="t-row" style="color:var(--muted)"><span>Outros</span><span>${fmt(o)}</span></div>` : ''}
    <div class="t-sub">Total ${fmt(tot)} · Margem <b>${sign}${m}%</b> · ${fmt(pHit.reg)} aptos</div>
    ${actionsHtml}
  `;
}

function showPinnedPrecinctTooltip() {
  if (!pinnedPrecinct || !pinnedTooltipOpen || !activeRace) return;
  tooltip.innerHTML = buildPrecinctTooltipHtml(pinnedPrecinct, true);
  tooltip.classList.add('pinned');
  tooltip.style.display = 'block';
  const closeBtn = tooltip.querySelector('.t-close');
  if (closeBtn) {
    closeBtn.onclick = e => {
      e.stopPropagation();
      pinnedTooltipOpen = false;
      pinnedPrecinct = null;
      aloneMode = false;
      if (prCols) {
        prCols.setIsolatedItem(null);
        prCols.highlight(null);
      }
      syncAloneButtons();
      tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
      tooltip.style.display = 'none';
    };
  }
  const aloneAct = tooltip.querySelector('.t-alone-btn');
  if (aloneAct) {
    aloneAct.onclick = e => {
      e.stopPropagation();
      toggleAloneMode();
      showPinnedPrecinctTooltip();
    };
  }
  const shareAct = tooltip.querySelector('.t-share-btn');
  if (shareAct) {
    shareAct.onclick = e => {
      e.stopPropagation();
      syncUrl();
      copyTextToClipboard(getPublicShareUrl()).then(() => {
        shareAct.textContent = 'Link copiado!';
        setTimeout(() => {
          if (shareAct.isConnected) shareAct.textContent = 'Copiar link';
        }, 1600);
      });
    };
  }
  const drillAct = tooltip.querySelector('.t-drill-btn');
  if (drillAct && drillAct.dataset.uf) {
    drillAct.onclick = e => {
      e.stopPropagation();
      const munQ = drillAct.dataset.mun ? `&mun=${encodeURIComponent(drillAct.dataset.mun)}` : '';
      location.href = `estado.html?uf=${drillAct.dataset.uf}${munQ}${isFramed ? '&framed=1' : ''}`;
    };
  }
  updatePinnedTooltipPosition();
}

function selectPrecinctItem(pHit, fly = false) {
  pinnedPrecinct = pHit;
  pinnedTooltipOpen = !!pHit;
  if (!pHit) aloneMode = false;
  if (prCols) {
    prCols.highlight(pHit);
    if (!pHit) prCols.setIsolatedItem(null);
  }
  const qs = document.getElementById('munQuickSearch');
  if (qs && pHit) qs.value = pHit.code;
  syncAloneButtons();
  if (pHit) {
    showPinnedPrecinctTooltip();
    if (fly) frameCountyColumn(pHit);
  } else {
    tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
    tooltip.style.display = 'none';
  }
}

function showPinnedTooltip() {
  if (!pinnedCounty || !pinnedTooltipOpen || !activeRace) return;
  tooltip.innerHTML = buildCountyTooltipHtml(pinnedCounty, true);
  tooltip.classList.add('pinned');
  tooltip.style.display = 'block';
  const closeBtn = tooltip.querySelector('.t-close');
  if (closeBtn) {
    closeBtn.onclick = e => {
      e.stopPropagation();
      pinnedTooltipOpen = false;
      tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
      tooltip.style.display = 'none';
    };
  }
  const aloneAct = tooltip.querySelector('.t-alone-btn');
  if (aloneAct) {
    aloneAct.onclick = e => {
      e.stopPropagation();
      toggleAloneMode();
      showPinnedTooltip();
    };
  }
  const shareAct = tooltip.querySelector('.t-share-btn');
  if (shareAct) {
    shareAct.onclick = e => {
      e.stopPropagation();
      syncUrl();
      copyTextToClipboard(getPublicShareUrl()).then(() => {
        shareAct.textContent = 'Link copiado!';
        setTimeout(() => {
          if (shareAct.isConnected) shareAct.textContent = 'Copiar link';
        }, 1600);
      });
    };
  }
  const drillAct = tooltip.querySelector('.t-drill-btn');
  if (drillAct && drillAct.dataset.uf) {
    drillAct.onclick = e => {
      e.stopPropagation();
      const nextUrl = `estado.html?uf=${drillAct.dataset.uf}${isFramed ? '&framed=1' : ''}`;
      location.href = nextUrl;
    };
  }
  updatePinnedTooltipPosition();
}

function setPinnedHighlight(c, meta = null) {
  if (pinnedCounty && pinnedCounty !== c) {
    pinnedCounty.mat.emissive.setHex(0x000000);
    pinnedCounty.lowerMat.emissive.setHex(0x000000);
  }
  pinnedCounty = c;
  pinnedMeta = meta;
  pinnedTooltipOpen = !!c;
  if (!c) aloneMode = false;
  if (c) {
    c.mat.emissive.setHex(0x28220f);
    c.lowerMat.emissive.setHex(0x28220f);
  }
  const qs = document.getElementById('munQuickSearch');
  if (qs) qs.value = c ? c.name : '';
  const idx = c ? counties.indexOf(c) : null;
  dotLayer.setHover(idx);
  applyHeights();
  renderMunicipalityCard();
  syncAloneButtons();
  syncUrl();
  if (c) showPinnedTooltip();
  else {
    tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
    tooltip.style.display = 'none';
  }
  if (aloneMode && c) frameCountyColumn(c);
}

const places = createPlaceFinder({
  counties, group, camera, controls,
  proj: ll => { const p = proj(ll); return p ? [p[0] - W / 2, -(p[1] - H / 2)] : null; },
  cityUrl: STATE.data.cities,
  precinctUrl: STATE.data.precincts,
  precinctShapesUrl: STATE.data.precinctShapes,
  onSelectCounty: (c, meta) => setPinnedHighlight(c, meta),
  onClearCounty: () => {
    setPinnedHighlight(null, null);
  },
  onSelectPrecinct: key => prCols ? prCols.highlight(key) : false,
  getRaceInfo: () => ({
    raceKey: activeId,
    rName: activeRace ? activeRace.rep : 'PL',
    dName: activeRace ? activeRace.dem : 'PT',
  }),
  onCameraChange: () => { userMovedCamera = true; },
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hovered = null;

function setHoverHighlight(c, on) {
  if (c === pinnedCounty) return;
  const hex = on ? 0x222a3a : 0x000000;
  c.mat.emissive.setHex(hex);
  c.lowerMat.emissive.setHex(hex);
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BASE_H);
const hitPt = new THREE.Vector3();
function pip2(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}
function findCountyAt(x, y) {
  for (const c of counties) {
    for (const rings of c.polys) {
      if (!pip2(x, y, rings[0])) continue;
      let inHole = false;
      for (let h = 1; h < rings.length; h++) if (pip2(x, y, rings[h])) { inHole = true; break; }
      if (!inHole) return c;
    }
  }
  return null;
}

const fmtCandName = (name, party) => {
  if (!name) return party;
  return name.includes('(') ? name : `${name} (${party})`;
};

function buildCountyTooltipHtml(c, isPinned = false) {
  const { r, d, o, tot, m, shift, baseM, curM } = c.cur;
  const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
  const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
  const closeHtml = isPinned ? `<button type="button" class="t-close" title="Fechar cartão" aria-label="Fechar">×</button>` : '';
  const canIsolate = viewMode === 'columns' && unitMode === 'county' && raiseAmount >= 0.05;
  const stDrill = isBR ? STATES.find(s => s.slug !== 'br' && s.name.toUpperCase() === c.key) : null;
  const actionsHtml = isPinned
    ? `<div class="t-actions">` +
      (stDrill ? `<button type="button" class="t-drill-btn" data-uf="${stDrill.slug}">Ver municípios 3D →</button>` : '') +
      (canIsolate ? `<button type="button" class="t-alone-btn">${aloneMode ? 'Mostrar todos' : `Só este ${unitLow}`}</button>` : '') +
      `<button type="button" class="t-share-btn" title="Copiar link do GitHub Pages para este ${unitLow}">Copiar link</button>` +
      `</div>`
    : '';
  if (activeRace.isShift) {
    const sPts = (shift * 100);
    const sSign = sPts >= 0 ? `PL+${sPts.toFixed(1)}` : `PT+${(-sPts).toFixed(1)}`;
    const bSign = baseM >= 0 ? `PL+${baseM.toFixed(1)}` : `PT+${(-baseM).toFixed(1)}`;
    const cSign = curM  >= 0 ? `PL+${curM.toFixed(1)}`  : `PT+${(-curM).toFixed(1)}`;
    return `
      ${closeHtml}
      <div class="t-name">${UNIT_CAP} de ${c.name}</div>
      <div class="t-row"><span>Mudança desde ${baseLabel}</span><b>${sSign} pts</b></div>
      <div class="t-row" style="color:var(--muted)"><span>${baseLabel} (${STATE.base.rep}/${STATE.base.dem})</span><span>${bSign}%</span></div>
      <div class="t-row" style="color:var(--muted)"><span>${activeRace.year} (${activeRace.rep}/${activeRace.dem})</span><span>${cSign}%</span></div>
      <div class="t-sub">Votos em ${activeRace.year}: ${fmt(tot)}</div>
      ${actionsHtml}
    `;
  }
  const sign = m >= 0 ? 'PL+' : 'PT+';
  return `
    ${closeHtml}
    <div class="t-name">${UNIT_CAP} de ${c.name}</div>
    <div class="t-row"><span class="rep-t">${fmtCandName(activeRace.rep, 'PL')}</span><span>${fmt(r)} (${rPct}%)</span></div>
    <div class="t-row"><span class="dem-t">${fmtCandName(activeRace.dem, 'PT')}</span><span>${fmt(d)} (${dPct}%)</span></div>
    ${o ? `<div class="t-row" style="color:var(--muted)"><span>Outros</span><span>${fmt(o)}</span></div>` : ''}
    <div class="t-sub">Total ${fmt(tot)} · Margem <b>${sign}${Math.abs(m).toFixed(1)}%</b></div>
    ${actionsHtml}
  `;
}

const _projVec = new THREE.Vector3();
function updatePinnedTooltipPosition() {
  const targetObj = (unitMode === 'precinct' && pinnedPrecinct) ? pinnedPrecinct : pinnedCounty;
  if (!targetObj || !pinnedTooltipOpen || hovered) return;
  if (!tooltip.classList.contains('pinned') || tooltip.style.display === 'none') return;
  const stageRect = stage.getBoundingClientRect();
  if (stageRect.width < 10 || stageRect.height < 10) return;

  const anchorY = (viewMode === 'dots' || raiseAmount < 0.05)
    ? BASE_H
    : Math.max(BASE_H, (targetObj.currentH || BASE_H) * 0.55);
  _projVec.set(targetObj.cx, anchorY, -targetObj.cy);
  _projVec.project(camera);

  if (_projVec.z > 1) {
    tooltip.style.opacity = '0';
    return;
  }
  tooltip.style.opacity = '1';

  const sx = stageRect.left + (_projVec.x * 0.5 + 0.5) * stageRect.width;
  const sy = stageRect.top + (-_projVec.y * 0.5 + 0.5) * stageRect.height;

  const tw = tooltip.offsetWidth || 224;
  const th = tooltip.offsetHeight || 112;

  const controlsEl = document.querySelector('.map-area .controls');
  const controlsTop = (controlsEl && controlsEl.offsetParent !== null)
    ? controlsEl.getBoundingClientRect().top
    : (stageRect.bottom - 10);
  const minTop = stageRect.top + 10;
  const maxTop = Math.max(minTop, Math.min(stageRect.bottom - th - 10, controlsTop - th - 12));

  const gap = 22;
  const roomRight = (stageRect.right - 10) - (sx + gap);
  const roomLeft = (sx - gap) - (stageRect.left + 10);

  tooltip.classList.remove('side-right', 'side-left', 'side-top');

  let left, top;
  if (roomRight >= tw || (roomRight >= roomLeft && roomRight >= 170)) {
    left = Math.min(stageRect.right - tw - 10, sx + gap);
    top = Math.max(minTop, Math.min(maxTop, sy - th * 0.5));
    tooltip.classList.add('side-right');
    const arrowY = Math.max(14, Math.min(th - 14, sy - top));
    tooltip.style.setProperty('--arrow-y', `${arrowY}px`);
  } else if (roomLeft >= 170) {
    left = Math.max(stageRect.left + 10, sx - tw - gap);
    top = Math.max(minTop, Math.min(maxTop, sy - th * 0.5));
    tooltip.classList.add('side-left');
    const arrowY = Math.max(14, Math.min(th - 14, sy - top));
    tooltip.style.setProperty('--arrow-y', `${arrowY}px`);
  } else {
    left = Math.max(stageRect.left + 10, Math.min(stageRect.right - tw - 10, sx - tw * 0.5));
    top = Math.max(minTop, Math.min(maxTop, sy - th - 18));
    tooltip.classList.add('side-top');
    const arrowX = Math.max(18, Math.min(tw - 18, sx - left));
    tooltip.style.setProperty('--arrow-x', `${arrowX}px`);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function raycastCounty(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (cityMarkers) {
    const pinHit = cityMarkers.raycast(raycaster);
    if (pinHit) return pinHit;
  }
  if (viewMode === 'columns') {
    const hits = raycaster.intersectObjects(group.children, false);
    const hit = hits.find(h => meshToCounty.has(h.object));
    if (hit) return meshToCounty.get(hit.object);
  } else if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
    return findCountyAt(hitPt.x, -hitPt.z);
  }
  return null;
}

let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => {
  downXY = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY) return;
  const dx = e.clientX - downXY[0], dy = e.clientY - downXY[1];
  downXY = null;
  if (dx * dx + dy * dy > 25) return;
  if (viewMode === 'columns' && unitMode === 'precinct' && prCols) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const pHit = prCols.raycast(raycaster);
    if (pHit) {
      selectPrecinctItem(pHit, false);
      return;
    }
  }
  const hitC = hovered || raycastCounty(e.clientX, e.clientY);
  if (hitC && places) {
    if (hovered) {
      setHoverHighlight(hovered, false);
      hovered = null;
    }
    places.pickCountyFromMap(hitC);
    showPinnedTooltip();
  }
});

renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (viewMode === 'columns' && unitMode === 'precinct' && prCols) {
    const pHit = prCols.raycast(raycaster);
    if (pHit && pHit !== pinnedPrecinct) {
      hovered = pHit;
      tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
      tooltip.style.opacity = '1';
      tooltip.style.display = 'block';
      const controlsEl = document.querySelector('.map-area .controls');
      const maxY = (controlsEl ? controlsEl.getBoundingClientRect().top : window.innerHeight - 76) - 135;
      tooltip.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
      tooltip.style.top = Math.min(maxY, e.clientY + 14) + 'px';
      tooltip.innerHTML = buildPrecinctTooltipHtml(pHit, false);
      return;
    }
    hovered = null;
    if (pinnedPrecinct && pinnedTooltipOpen) showPinnedPrecinctTooltip();
    else if (pinnedCounty && pinnedTooltipOpen) showPinnedTooltip();
    else tooltip.style.display = 'none';
    return;
  }

  let c = null;
  if (cityMarkers) {
    c = cityMarkers.raycast(raycaster);
  }
  if (!c) {
    if (viewMode === 'columns') {
      const hits = raycaster.intersectObjects(group.children, false);
      const hit = hits.find(h => meshToCounty.has(h.object));
      if (hit) c = meshToCounty.get(hit.object);
    } else {
      if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
        c = findCountyAt(hitPt.x, -hitPt.z);
      }
    }
  }

  if (c && c !== pinnedCounty) {
    if (hovered !== c) {
      if (hovered) setHoverHighlight(hovered, false);
      hovered = c;
      setHoverHighlight(hovered, true);
      if (!pinnedCounty) dotLayer.setHover(counties.indexOf(c));
    }
    tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
    tooltip.style.opacity = '1';
    tooltip.style.display = 'block';
    const controlsEl = document.querySelector('.map-area .controls');
    const maxY = (controlsEl ? controlsEl.getBoundingClientRect().top : window.innerHeight - 76) - 135;
    tooltip.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
    tooltip.style.top = Math.min(maxY, e.clientY + 14) + 'px';
    tooltip.innerHTML = buildCountyTooltipHtml(c, false);
  } else {
    if (hovered) setHoverHighlight(hovered, false);
    hovered = null;
    if (!pinnedCounty) dotLayer.setHover(null);
    if (pinnedCounty && pinnedTooltipOpen) {
      showPinnedTooltip();
    } else {
      tooltip.style.display = 'none';
    }
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  if (hovered) setHoverHighlight(hovered, false);
  hovered = null;
  if (!pinnedCounty) dotLayer.setHover(null);
  if (pinnedCounty && pinnedTooltipOpen) {
    showPinnedTooltip();
  } else {
    tooltip.style.display = 'none';
  }
});

function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dotLayer.onResize();
}
window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => resize()).observe(stage);
}
resize();

// Botões Ocultar Painel / Detalhes (idênticos ao usavote original)
const panelCloseBtn = document.getElementById('panelClose');
const panelToggleBtn = document.getElementById('panelToggle');
if (panelCloseBtn) {
  panelCloseBtn.onclick = () => {
    document.body.classList.add('panel-hidden');
    resize();
  };
}
if (panelToggleBtn) {
  panelToggleBtn.onclick = () => {
    document.body.classList.remove('panel-hidden');
    resize();
  };
}

// Guia Rápido ("Como ler este mapa em 10 segundos")
const quickGuideCard = document.getElementById('quickGuideCard');
const qgCloseBtn = document.getElementById('qgCloseBtn');
const qgGoAdvanced = document.getElementById('qgGoAdvanced');
try {
  if (localStorage.getItem('brvote_hide_guide') === '1' && quickGuideCard) {
    quickGuideCard.style.display = 'none';
  }
} catch {}
if (qgCloseBtn && quickGuideCard) {
  qgCloseBtn.onclick = () => {
    quickGuideCard.style.display = 'none';
    try { localStorage.setItem('brvote_hide_guide', '1'); } catch {}
  };
}
if (qgGoAdvanced) {
  qgGoAdvanced.onclick = () => {
    if (window.setBrVoteUiMode) {
      window.setBrVoteUiMode('advanced');
    } else {
      document.body.classList.remove('ui-simple');
      document.body.classList.add('ui-advanced');
      try { localStorage.setItem('brvote_ui_mode', 'advanced'); } catch {}
      document.querySelectorAll('.ui-mode-btn').forEach(b => {
        const on = b.dataset.uimode === 'advanced';
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    resize();
  };
}

window.addEventListener('brvote-uimode', e => {
  const mode = e.detail && e.detail.mode;
  if (mode === 'simple' && filterWinner !== 'all') {
    filterWinner = 'all';
    const fw = document.getElementById('filterWinner');
    if (fw) fw.value = 'all';
    applyHeights();
  }
  resize();
});

// Busca Instantânea de Município / Cidade (#munQuickSearch + #munSearchList)
const munQuickSearch = document.getElementById('munQuickSearch');
const munSearchList = document.getElementById('munSearchList');
if (munSearchList && counties.length) {
  const sortedNames = counties.map(c => c.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  munSearchList.innerHTML = sortedNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
}
if (munQuickSearch && places) {
  const normSearch = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const trySelectMun = (raw, fly) => {
    const q = normSearch(raw);
    if (!q) return false;
    // Se estamos na visão de 5.570 cidades do Brasil, busca também entre os municípios
    if (isBR && unitMode === 'precinct' && prCols) {
      const pMatch = prCols.findItemByQuery(raw);
      if (pMatch && (normSearch(pMatch.code) === q || (fly && q.length >= 4))) {
        selectPrecinctItem(pMatch, fly);
        return true;
      }
    }
    const exact = counties.find(c => normSearch(c.name) === q);
    if (exact) {
      places.selectCountyByName(exact.name, fly);
      return true;
    }
    if (fly && q.length >= 3) {
      const partial = counties.find(c => normSearch(c.name).startsWith(q)) ||
                      counties.find(c => normSearch(c.name).includes(q));
      if (partial) {
        munQuickSearch.value = partial.name;
        places.selectCountyByName(partial.name, true);
        return true;
      }
      if (isBR && prCols) {
        const pPartial = prCols.findItemByQuery(raw);
        if (pPartial) {
          if (unitMode !== 'precinct') setUnitMode('precinct');
          selectPrecinctItem(pPartial, true);
          return true;
        }
      }
    }
    return false;
  };
  munQuickSearch.addEventListener('input', () => {
    trySelectMun(munQuickSearch.value, true);
  });
  munQuickSearch.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      trySelectMun(munQuickSearch.value, true);
    } else if (e.key === 'Escape') {
      munQuickSearch.value = '';
      places.clear();
      if (pinnedPrecinct) selectPrecinctItem(null, false);
    }
  });
}

const scrollToAsideBtn = document.getElementById('scrollToAsideBtn');
if (scrollToAsideBtn) {
  scrollToAsideBtn.onclick = () => {
    const asideEl = document.querySelector('aside');
    if (asideEl) asideEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

// Barra de Personalização Avançada (#filterWinner e #mapThemeSelect)
const filterWinnerSel = document.getElementById('filterWinner');
if (filterWinnerSel) {
  filterWinnerSel.onchange = () => {
    filterWinner = filterWinnerSel.value || 'all';
    if (prCols) prCols.setFilterWinner(filterWinner);
    applyHeights();
  };
}
const mapThemeSel = document.getElementById('mapThemeSelect');
function applyThreeTheme(val) {
  document.body.classList.remove('theme-contrast', 'theme-light');
  if (val === 'contrast') {
    document.body.classList.add('theme-contrast');
    scene.background = new THREE.Color(0x020408);
    baseMesh.material.color.setHex(0x020408);
    edgeMat.color.setHex(0x24344d);
  } else if (val === 'light') {
    document.body.classList.add('theme-light');
    scene.background = new THREE.Color(0xf6f3ec);
    // Match baseMesh exactly to scene.background so there is NO dark rectangle around the map!
    baseMesh.material.color.setHex(0xf6f3ec);
    edgeMat.color.setHex(0x8c8577);
  } else {
    scene.background = new THREE.Color(0x07131a);
    baseMesh.material.color.setHex(0x07131a);
    edgeMat.color.setHex(0x162b38);
  }
  if (contextMapGroup?.userData?.updateTheme) {
    contextMapGroup.userData.updateTheme(val);
  }
}
if (mapThemeSel) {
  mapThemeSel.onchange = () => {
    const val = mapThemeSel.value;
    if (window.setBrVoteTheme) window.setBrVoteTheme(val);
    else applyThreeTheme(val);
  };
}
window.addEventListener('themechange', e => {
  const th = (e.detail && e.detail.theme) || 'dark';
  if (mapThemeSel && mapThemeSel.value !== th) mapThemeSel.value = th;
  applyThreeTheme(th);
});
try {
  const savedTheme = localStorage.getItem('brvote_theme');
  if (savedTheme && savedTheme !== 'dark') {
    if (mapThemeSel) mapThemeSel.value = savedTheme;
    applyThreeTheme(savedTheme);
  }
} catch {}

// Sincronização de câmera com compare.html via postMessage (PR #13)
let suppressCamBroadcast = false;
let canBroadcastCam = false;
renderer.domElement.addEventListener('pointerdown', () => { canBroadcastCam = true; });
renderer.domElement.addEventListener('wheel', () => { canBroadcastCam = true; }, { passive: true });
renderer.domElement.addEventListener('touchstart', () => { canBroadcastCam = true; }, { passive: true });

if (window.parent && window.parent !== window) {
  controls.addEventListener('change', () => {
    if (suppressCamBroadcast || !canBroadcastCam) return;
    window.parent.postMessage({
      type: 'cam',
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
    }, '*');
  });
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d) return;
    if (d.type === 'forceResize') {
      resize();
      renderer.render(scene, camera);
      return;
    }
    if (d.type === 'selectMun' && places) {
      if (d.mun) {
        places.selectCountyByName(d.mun, true);
      } else {
        places.clearAll();
      }
      return;
    }
    if (d.type !== 'setCam') return;
    suppressCamBroadcast = true;
    userMovedCamera = true;
    camera.position.set(d.px, d.py, d.pz);
    controls.target.set(d.tx, d.ty, d.tz);
    controls.update();
    suppressCamBroadcast = false;
  });
}
setTimeout(() => resize(), 120);
setTimeout(() => resize(), 400);

let lastFrame = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = Math.min(1, (now - animStart) / 620);
  const ease = easeQuint(t);
  for (const c of counties) {
    const bot = c.fromBot + (c.toBot - c.fromBot) * ease;
    const mid = c.fromMid + (c.toMid - c.fromMid) * ease;
    const top = c.fromTop + (c.toTop - c.fromTop) * ease;
    c.lower.scale.y = bot;
    if (mid > 0.005) {
      c.middle.visible = (viewMode === 'columns' && unitMode === 'county');
      c.middle.position.y = bot;
      c.middle.scale.y = mid;
    } else {
      c.middle.visible = false;
    }
    c.mesh.position.y = bot + mid;
    c.mesh.scale.y = top;
    c.currentH = bot + mid + top;
  }
  if (prCols) prCols.tick(now);
  if (cartoWarper.tick(dt) && cityMarkers && cityMarkers.applyCartogramOffset) {
    cityMarkers.applyCartogramOffset(cartoWarper.evalDisplacement, cartoWarper.getMix());
  }
  dotLayer.tick(dt);
  if (cityMarkers) cityMarkers.refreshHeights();
  if (camAnim) {
    const u = Math.min(1, (now - camAnim.t0) / camAnim.dur);
    const k = easeQuint(u);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, k);
    controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, k);
    if (u >= 1) camAnim = null;
  } else if (!userMovedCamera && spinSpeed > 0 && raiseAmount > 0.05 && viewMode === 'columns') {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), spinSpeed * 0.45 * dt);
    camera.position.copy(controls.target).add(off);
  }
  controls.update();
  if (cityMarkers) cityMarkers.updateFade(camera);
  renderer.render(scene, camera);
  updatePinnedTooltipPosition();
  requestAnimationFrame(tick);
}

const wantRace = initParams.get('race');
const wantVoters = initParams.get('voters');
const wantLook = initParams.get('look');
const wantFlat = initParams.get('flat') === '1' || wantLook === 'flat';
const wantUnit = initParams.get('unit');
const wantMarginColor = initParams.get('color') === 'margin' || isFramed;
const wantMun = initParams.get('mun');
const wantAlone = initParams.get('alone') === '1';

if (wantMarginColor && initParams.get('color') !== 'lead') {
  colorByLead = false;
  leadColorBtn?.classList.remove('active');
  shareColorBtn?.classList.add('active');
}
const initRace = (wantRace && races[wantRace]) ? wantRace : (STATE.defaultRace && races[STATE.defaultRace] ? STATE.defaultRace : order[0]);
selectRace(initRace, true);
if (wantVoters || wantLook === 'dots') {
  const s = +wantVoters;
  if ([10, 25, 100, 250, 1000].includes(s)) {
    dotScale = s;
    document.getElementById('dotScale').value = String(s);
  }
  setViewMode('dots', true);
} else if (wantUnit === 'precinct') {
  setUnitMode('precinct');
}
if (wantFlat) {
  setRaise(0);
  camera.position.set(0, 290, 0.01);
  controls.target.set(0, 0, 0);
  controls.update();
}
if (wantMun && places) {
  places.selectCountyByName(wantMun, true);
  if (wantAlone && pinnedCounty) {
    aloneMode = true;
    syncAloneButtons();
    applyHeights();
    frameCountyColumn(pinnedCounty);
  }
}
syncTurnVisibility();

requestAnimationFrame(tick);
