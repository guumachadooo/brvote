import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { createDotLayer } from './dots.js';
import { createPlaceFinder } from './places.js';
import { createPrecinctColumns } from './precinct-columns.js';
import { createCityMarkers } from './cities.js';
import { DEM_C, REP_C, OTHER_HEX, marginColorHex, leadColorHex, shiftColorHex } from './colors.js';
import { renderSourceNote } from './sourcelist.js';
import { withBusy } from './busy.js';

const UNIT_CAP = STATE.slug === 'df' ? 'Região Administrativa' : 'Município';
const UNITS_CAP = STATE.slug === 'df' ? 'Regiões Administrativas' : 'Municípios';
const unitLow = STATE.slug === 'df' ? 'região administrativa' : 'município';
const unitsLow = STATE.slug === 'df' ? 'regiões administrativas' : 'municípios';

document.title = `Eleições em ${STATE.name} — Como o Brasil Vota`;
document.getElementById('countyCount').textContent = STATE.counties;
document.getElementById('method').textContent = STATE.method;
renderSourceNote(document.getElementById('sources'), STATE);

const viewsEl = document.getElementById('views');
if (STATE.dots) {
  viewsEl.innerHTML =
    `<a class="view-link active" href="${STATE.results.href}">Mapa de resultados</a>` +
    `<a class="view-link" href="${STATE.dots}">Densidade de pontos</a>`;
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
scene.background = new THREE.Color(0x0b0e14);

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

let panMode = true;
const dragModeBtn = document.getElementById('dragMode');
function syncHint() {
  const h = document.getElementById('hint');
  if (!h) return;
  h.textContent = panMode
    ? `Arraste para mover · Clique direito (ou 2 dedos) para girar · Role para aproximar · Passe o mouse em um ${unitLow}`
    : `Arraste para girar · Clique direito para mover · Role para aproximar · Passe o mouse em um ${unitLow}`;
}
if (dragModeBtn) {
  dragModeBtn.onclick = () => {
    panMode = !panMode;
    controls.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = panMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.touches.ONE = panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    dragModeBtn.textContent = panMode ? 'Arrastar move' : 'Arrastar gira';
    dragModeBtn.classList.toggle('active', !panMode);
    syncHint();
  };
}
syncHint();

let userMovedCamera = false;
renderer.domElement.addEventListener('pointerdown', () => { userMovedCamera = true; });
renderer.domElement.addEventListener('wheel', () => { userMovedCamera = true; }, { passive: true });

scene.add(new THREE.AmbientLight(0xffffff, 0.72));
const sun = new THREE.DirectionalLight(0xffffff, 0.75);
sun.position.set(80, 180, 100);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9ab3d9, 0.25);
fill.position.set(-100, 90, -80);
scene.add(fill);

const group = new THREE.Group();
scene.add(group);

const baseGeo = new THREE.PlaneGeometry(600, 600);
baseGeo.rotateX(-Math.PI / 2);
const baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ color: 0x0b0e14 }));
baseMesh.position.y = -0.05;
scene.add(baseMesh);

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
  let area = 0, cx = 0, cy = 0, nPts = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;

  for (const poly of polys) {
    const outer = ringToVec2(poly[0]);
    if (outer.length < 3) continue;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      area += (a.x * b.y - b.x * a.y);
      cx += a.x; cy += a.y; nPts++;
      if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
      if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y;
    }
    const sh = new THREE.Shape(outer);
    const ringsArr = [outer.map(v => [v.x, v.y])];
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
  if (!shapes.length) continue;
  area = Math.abs(area) * 0.5;
  cx /= nPts; cy /= nPts;
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
      getTopY: c => c ? (BASE_H + (c.targetH - BASE_H) * raiseAmount) : BASE_H,
    })
  : null;

const fmt = n => Math.round(n).toLocaleString('pt-BR');
const pct = x => (x * 100).toFixed(1) + '%';

function syncUrl() {
  const params = new URLSearchParams();
  params.set('uf', STATE.slug);
  if (activeId && activeId !== STATE.defaultRace) params.set('race', activeId);
  if (viewMode === 'dots') {
    params.set('voters', String(dotScale));
  } else {
    if (unitMode === 'precinct') params.set('unit', 'precinct');
    if (!colorByLead) params.set('color', 'margin');
  }
  if (raiseAmount < 0.05) params.set('flat', '1');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
}

let animStart = 0;

function applyHeights() {
  const k = raiseAmount;
  for (const c of counties) {
    const h = BASE_H + (c.targetH - BASE_H) * k;
    const { r = 0, d = 0, o = 0, tot = 0 } = c.cur || {};
    const rWins = r >= d;
    const winVotes = rWins ? r : d;
    const loseVotes = rWins ? d : r;
    c.fromBot = c.lower.scale.y || 0.01;
    c.fromMid = c.middle.visible ? c.middle.scale.y : 0;
    c.fromTop = c.mesh.scale.y || 0.29;
    const split = !activeRace?.isShift && k > 0.02 && tot > 0 && winVotes > 0 && loseVotes > 0;
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
  if (prCols && unitMode === 'precinct') prCols.setRaise(k);
  if (cityMarkers) cityMarkers.refreshHeights();
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

function setRace(id) {
  activeId = id;
  const r = races[id];
  activeRace = r;
  document.getElementById('kicker').textContent = r.label.split(' · ')[0] || `Eleições ${r.year}`;
  document.getElementById('title').textContent =
    `${STATE.name} · ${r.office} ${r.year}` + (r.tag ? ` (${r.tag})` : '');
  document.getElementById('raceLine').textContent =
    `${r.rep} (PL/Conservador) vs. ${r.dem} (PT/Trabalhista)` + (r.note ? ` — ${r.note}` : '');

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
      <b>${ (margin * 100).toFixed(1) } pontos</b> (${fmt(lead)} votos),
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
  document.getElementById('bars').innerHTML = bars.map(b => `
    <div class="bar-block">
      <div class="bar-label"><span>${b.label}</span><span>${b.right}</span></div>
      <div class="bar">
        <div class="r" style="width:${(b.r * 100).toFixed(2)}%"></div>
        <div class="o" style="width:${(b.o * 100).toFixed(2)}%"></div>
        <div class="d" style="width:${(b.d * 100).toFixed(2)}%"></div>
      </div>
    </div>
  `).join('');

  if (r.isShift && maxShiftR && maxShiftD) {
    document.getElementById('harris').innerHTML =
      `Maior giro para o PL: <b>${maxShiftR.c.name}</b> (+${(maxShiftR.shift * 100).toFixed(1)} pts). ` +
      `Maior giro para o PT: <b>${maxShiftD.c.name}</b> (${(maxShiftD.shift * 100).toFixed(1)} pts).`;
  } else if (maxCounty) {
    const share = totAll ? ((maxCounty.tot / totAll) * 100).toFixed(1) : '0';
    document.getElementById('harris').innerHTML =
      `O pico mais alto é <b>${maxCounty.c.name}</b> (${fmt(maxCounty.tot)} votos — ${share}% de todo o estado).`;
  }

  renderTables(id);
  refreshDots(id);
  syncUnitAvailability(id);
  if (unitMode === 'precinct') applyPrecinctUnit();
  if (places) places.refresh();
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

function selectRace(id) {
  const r = races[id];
  if (!r) return;
  yearSelect.value = r.year;
  populateRaceSelect(r.year, id);
  withBusy('Trocando disputa…', () => setRace(id));
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
  const r = races[id];
  const votesByCounty = counties.map(c => r.counties[c.key] || r.counties[c.name] || [0, 0, 0]);
  dotLayer.setScaleAppearance(dotScale);
  dotLayer.setRaise(raiseAmount);
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
  });
}

function applyPrecinctUnit() {
  if (!prCols) return;
  prCols.loadOnce().then(() => {
    const info = prCols.showRace(activeId, raiseAmount, colorByLead);
    if (!info) return;
    setCountyMeshesVisible(false);
    document.getElementById('scale').textContent =
      `Cada uma das ${fmt(info.count)} barras é uma zona eleitoral; a altura é proporcional ao total de votos da zona`;
  });
}

function setUnitMode(mode) {
  if (!prCols) mode = 'county';
  unitMode = mode;
  document.getElementById('unitCounty').classList.toggle('active', mode === 'county');
  document.getElementById('unitPrecinct').classList.toggle('active', mode === 'precinct');
  if (mode === 'precinct') {
    withBusy('Construindo colunas das zonas eleitorais…', () => applyPrecinctUnit());
  } else {
    if (prCols) prCols.setVisible(false);
    if (viewMode === 'columns') setCountyMeshesVisible(true);
    document.getElementById('scale').textContent = 'A altura é proporcional ao total de votos válidos';
    applyHeights();
  }
  syncUrl();
}

document.getElementById('unitCounty').onclick = () => setUnitMode('county');
document.getElementById('unitPrecinct').onclick = () => setUnitMode('precinct');

function setViewMode(mode) {
  viewMode = mode;
  const isDots = mode === 'dots';
  document.getElementById('modeCols').classList.toggle('active', !isDots);
  const showPrecincts = !isDots && unitMode === 'precinct';
  setCountyMeshesVisible(!isDots && !showPrecincts);
  if (prCols) prCols.setVisible(showPrecincts);
  dotLayer.setVisible(isDots);
  document.getElementById('dotScalePill').style.display = isDots ? 'flex' : 'none';
  document.getElementById('colorPill').style.display = isDots ? 'none' : 'flex';
  document.getElementById('scale').textContent = isDots
    ? `Cada ponto representa ${fmt(dotScale)} eleitores daquele partido, posicionados dentro de cada zona eleitoral`
    : 'A altura é proporcional ao total de votos válidos';
  if (isDots) refreshDots();
  syncUnitAvailability();
  syncUrl();
}

const modeColsBtn = document.getElementById('modeCols');
if (modeColsBtn) modeColsBtn.onclick = () => setViewMode('columns');
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
let spinSpeed = 0.25;

function syncTurnVisibility() {
  if (!turnWrap) return;
  turnWrap.style.display = raiseAmount > 0.05 ? 'flex' : 'none';
}

function setRaise(v) {
  raiseAmount = v;
  raiseSlider.value = Math.round(v * 100);
  btnFlat.classList.toggle('active', v < 0.05);
  btn3d.classList.toggle('active', v >= 0.05);
  applyHeights();
  dotLayer.setRaise(v);
  syncTurnVisibility();
  syncUrl();
}
raiseSlider.oninput = e => setRaise(+e.target.value / 100);
btnFlat.onclick = () => {
  setRaise(0);
  camera.position.set(0, 290, 0.01);
  controls.target.set(0, 0, 0);
};
btn3d.onclick = () => {
  setRaise(1);
  camera.position.set(0, 215, 225);
  controls.target.set(0, 0, 6);
};
if (turnSlider) {
  turnSlider.oninput = e => {
    spinSpeed = +e.target.value / 100;
    if (spinSpeed > 0) userMovedCamera = false;
  };
}
const leadColorBtn = document.getElementById('leadColor');
leadColorBtn.onclick = () => {
  colorByLead = !colorByLead;
  leadColorBtn.classList.toggle('active', colorByLead);
  withBusy('Recolorindo…', () => {
    applyColors();
    syncUrl();
  });
};
document.getElementById('reset').onclick = () => {
  userMovedCamera = false;
  setRaise(1);
  camera.position.set(0, 215, 225);
  controls.target.set(0, 0, 6);
  if (places) places.clearAll();
};

let pinnedCounty = null;
function setPinnedHighlight(c) {
  if (pinnedCounty && pinnedCounty !== c) {
    pinnedCounty.mat.emissive.setHex(0x000000);
    pinnedCounty.lowerMat.emissive.setHex(0x000000);
  }
  pinnedCounty = c;
  if (c) {
    c.mat.emissive.setHex(0x28220f);
    c.lowerMat.emissive.setHex(0x28220f);
  }
  const idx = c ? counties.indexOf(c) : null;
  dotLayer.setHover(idx);
}

const places = createPlaceFinder({
  counties, group, camera, controls,
  proj: ll => { const p = proj(ll); return p ? [p[0] - W / 2, -(p[1] - H / 2)] : null; },
  cityUrl: STATE.data.cities,
  precinctUrl: STATE.data.precincts,
  precinctShapesUrl: STATE.data.precinctShapes,
  onSelectCounty: c => setPinnedHighlight(c),
  onClearCounty: () => setPinnedHighlight(null),
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

let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => {
  downXY = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY) return;
  const dx = e.clientX - downXY[0], dy = e.clientY - downXY[1];
  downXY = null;
  if (dx * dx + dy * dy > 25) return;
  if (hovered && places) places.pickCountyFromMap(hovered);
});

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

renderer.domElement.addEventListener('pointermove', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (viewMode === 'columns' && unitMode === 'precinct' && prCols) {
    const pHit = prCols.raycast(raycaster);
    if (pHit) {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY + 14) + 'px';
      const { r, d, o, tot } = pHit;
      const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
      const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
      const sign = r >= d ? 'PL+' : 'PT+';
      const m = (r + d) ? Math.abs(((r - d) / (r + d)) * 100).toFixed(1) : '0.0';
      tooltip.innerHTML = `
        <div class="t-name">${pHit.county} · Zona ${pHit.code}</div>
        <div class="t-row"><span class="rep-t">${activeRace.rep} (PL)</span><span>${fmt(r)} (${rPct}%)</span></div>
        <div class="t-row"><span class="dem-t">${activeRace.dem} (PT)</span><span>${fmt(d)} (${dPct}%)</span></div>
        ${o ? `<div class="t-row" style="color:var(--muted)"><span>Outros</span><span>${fmt(o)}</span></div>` : ''}
        <div class="t-sub">Total ${fmt(tot)} · Margem <b>${sign}${m}%</b> · ${fmt(pHit.reg)} eleitores aptos</div>
      `;
      return;
    }
    tooltip.style.display = 'none';
    return;
  }

  let c = null;
  if (viewMode === 'columns') {
    const hits = raycaster.intersectObjects(group.children, false);
    const hit = hits.find(h => meshToCounty.has(h.object));
    if (hit) c = meshToCounty.get(hit.object);
  } else {
    if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
      c = findCountyAt(hitPt.x, -hitPt.z);
    }
  }

  if (c) {
    if (hovered !== c) {
      if (hovered) setHoverHighlight(hovered, false);
      hovered = c;
      setHoverHighlight(hovered, true);
      if (!pinnedCounty) dotLayer.setHover(counties.indexOf(c));
    }
    const { r, d, o, tot, m, shift, baseM, curM } = c.cur;
    const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
    const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
    if (activeRace.isShift) {
      const sPts = (shift * 100);
      const sSign = sPts >= 0 ? `PL+${sPts.toFixed(1)}` : `PT+${(-sPts).toFixed(1)}`;
      const bSign = baseM >= 0 ? `PL+${baseM.toFixed(1)}` : `PT+${(-baseM).toFixed(1)}`;
      const cSign = curM  >= 0 ? `PL+${curM.toFixed(1)}`  : `PT+${(-curM).toFixed(1)}`;
      tooltip.innerHTML = `
        <div class="t-name">${UNIT_CAP} de ${c.name}</div>
        <div class="t-row"><span>Mudança desde ${baseLabel}</span><b>${sSign} pts</b></div>
        <div class="t-row" style="color:var(--muted)"><span>${baseLabel} (${STATE.base.rep}/${STATE.base.dem})</span><span>${bSign}%</span></div>
        <div class="t-row" style="color:var(--muted)"><span>${activeRace.year} (${activeRace.rep}/${activeRace.dem})</span><span>${cSign}%</span></div>
        <div class="t-sub">Votos em ${activeRace.year}: ${fmt(tot)}</div>
      `;
    } else {
      const sign = m >= 0 ? 'PL+' : 'PT+';
      tooltip.innerHTML = `
        <div class="t-name">${UNIT_CAP} de ${c.name}</div>
        <div class="t-row"><span class="rep-t">${activeRace.rep} (PL)</span><span>${fmt(r)} (${rPct}%)</span></div>
        <div class="t-row"><span class="dem-t">${activeRace.dem} (PT)</span><span>${fmt(d)} (${dPct}%)</span></div>
        ${o ? `<div class="t-row" style="color:var(--muted)"><span>Outros</span><span>${fmt(o)}</span></div>` : ''}
        <div class="t-sub">Total ${fmt(tot)} · Margem <b>${sign}${Math.abs(m).toFixed(1)}%</b></div>
      `;
    }
  } else {
    if (hovered) setHoverHighlight(hovered, false);
    hovered = null;
    if (!pinnedCounty) dotLayer.setHover(null);
    tooltip.style.display = 'none';
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  if (hovered) setHoverHighlight(hovered, false);
  hovered = null;
  if (!pinnedCounty) dotLayer.setHover(null);
  tooltip.style.display = 'none';
});

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dotLayer.onResize();
}
window.addEventListener('resize', resize);
resize();

let lastFrame = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = Math.min(1, (now - animStart) / 420);
  const ease = 1 - Math.pow(1 - t, 3);
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
  if (!userMovedCamera && spinSpeed > 0 && raiseAmount > 0.05) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), spinSpeed * 0.45 * dt);
    camera.position.copy(controls.target).add(off);
  }
  controls.update();
  if (cityMarkers) cityMarkers.updateFade(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

const initParams = new URLSearchParams(location.search);
const wantRace = initParams.get('race');
const wantVoters = initParams.get('voters');
const wantFlat = initParams.get('flat') === '1';
const wantUnit = initParams.get('unit');
const wantMarginColor = initParams.get('color') === 'margin';

if (wantMarginColor) {
  colorByLead = false;
  leadColorBtn.classList.remove('active');
}
const initRace = (wantRace && races[wantRace]) ? wantRace : (STATE.defaultRace && races[STATE.defaultRace] ? STATE.defaultRace : order[0]);
selectRace(initRace);
if (wantVoters) {
  const s = +wantVoters;
  if ([10, 25, 100, 250, 1000].includes(s)) {
    dotScale = s;
    document.getElementById('dotScale').value = String(s);
  }
  setViewMode('dots');
} else if (wantUnit === 'precinct') {
  setUnitMode('precinct');
}
if (wantFlat) btnFlat.click();
syncTurnVisibility();

requestAnimationFrame(tick);
