import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { createDotLayer } from './dots.js';
import { createPlaceFinder } from './places.js';
import { renderSourceNote } from './sourcelist.js';

const UNIT_CAP = STATE.slug === 'df' ? 'Região Administrativa' : 'Município';
const unitLow = STATE.slug === 'df' ? 'região administrativa' : 'município';
const unitsLow = STATE.slug === 'df' ? 'regiões administrativas' : 'municípios';

document.title = `Onde os Eleitores de ${STATE.name} Moram — Densidade de Pontos`;
document.getElementById('title').textContent = `Onde os eleitores de ${STATE.name} moram`;
document.getElementById('views').innerHTML =
  `<a class="view-link" href="${STATE.results.href}">Mapa de resultados</a>` +
  `<a class="view-link active" href="${STATE.dots}">Densidade de pontos</a>`;
const mc = document.getElementById('modeCols');
const md = document.getElementById('modeDots');
if (mc) mc.href = STATE.results.href;
if (md) md.href = STATE.dots;
document.getElementById('method').textContent = STATE.method;
renderSourceNote(document.getElementById('sources'), STATE);

const [geo, r2026, rHist, citiesList] = await Promise.all([
  fetch(STATE.data.geo).then(r => r.json()),
  fetch(STATE.data.r2026).then(r => r.json()),
  STATE.data.history ? fetch(STATE.data.history).then(r => r.json()) : Promise.resolve({ order: [], races: {} }),
  STATE.data.cities ? fetch(STATE.data.cities).then(r => r.json()) : Promise.resolve([]),
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
scene.background = new THREE.Color(0x06080d);

const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
camera.position.set(0, 305, 18);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 4);
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 8;
controls.maxDistance = 620;
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
    ? 'Arraste para mover · Role para aproximar · Clique direito (ou 2 dedos) para inclinar'
    : 'Arraste para inclinar · Role para aproximar · Clique direito para mover';
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

const group = new THREE.Group();
scene.add(group);

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
const fillMat = new THREE.MeshBasicMaterial({ color: 0x0b0f18 });
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

  const g = new THREE.ShapeGeometry(shapes);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, fillMat);
  m.position.y = 0.05;
  group.add(m);

  counties.push({ name: rawName, key: rawName.toUpperCase(), area, cx, cy, span, polys: rawPolys, targetH: 0.3 });
}

const dotLayer = createDotLayer({
  counties,
  group,
  getHeight: () => 0.3,
  getPixelRatio: () => Math.min(window.devicePixelRatio, 2),
});
if (STATE.data.precincts && STATE.data.precinctShapes) {
  dotLayer.configurePrecincts(STATE.data.precincts, STATE.data.precinctShapes);
}
dotLayer.setVisible(true);
dotLayer.setRaise(0);

const outlineGroup = group.children.find(ch => ch.isGroup);

// Rótulos dinâmicos das principais cidades do estado
const topCities = citiesList.slice(0, 8);
const labelsRoot = document.getElementById('labels');
const labelItems = topCities.map(c => {
  const p = proj([c.lon, c.lat]);
  const x = p ? p[0] - W / 2 : 0;
  const z = p ? (p[1] - H / 2) : 0;
  const el = document.createElement('div');
  el.className = 'city-label';
  el.innerHTML = `<span class="pin"></span><span>${c.name}</span>`;
  labelsRoot.appendChild(el);
  return { name: c.name, world: new THREE.Vector3(x, 0.4, z), el };
});
let showLabels = true;
function updateLabels() {
  if (!showLabels) return;
  const rect = renderer.domElement.getBoundingClientRect();
  for (const it of labelItems) {
    const v = it.world.clone().project(camera);
    if (v.z > 1) { it.el.style.display = 'none'; continue; }
    it.el.style.display = 'flex';
    it.el.style.left = ((v.x * 0.5 + 0.5) * rect.width) + 'px';
    it.el.style.top  = ((-v.y * 0.5 + 0.5) * rect.height) + 'px';
  }
}

// Construir paradas do tour guiado dinamicamente para o estado atual
function buildStops() {
  const c0 = topCities[0];
  const c1 = topCities[1] || c0;
  const c2 = topCities[2] || c1;
  const c3 = topCities[3] || c2;

  const pt = c => {
    if (!c) return [0, 0];
    const p = proj([c.lon, c.lat]);
    return p ? [p[0] - W / 2, p[1] - H / 2] : [0, 0];
  };
  const [x0, z0] = pt(c0);
  const [x1, z1] = pt(c1);
  const [x2, z2] = pt(c2);
  const [x3, z3] = pt(c3);

  return [
    {
      title: `1 · Todo o estado de ${STATE.name}`,
      body: `Olhe onde os pontos realmente estão. Grandes extensões rurais têm baixa densidade eleitoral, enquanto a maior parte dos votos se concentra nas manchas urbanas brilhantes.`,
      target: [0, 0, 4], pos: [0, 305, 18],
    },
    {
      title: `2 · Região de ${c0 ? c0.name : STATE.capital}`,
      body: `O maior polo eleitoral do estado (${c0 ? c0.name : STATE.capital}). No centro denso, os votos do PT e do PL aparecem lado a lado, formando dezenas de milhares de votos em poucos quilômetros.`,
      target: [x0, 0, z0], pos: [x0, 82, z0 + 18],
    },
    {
      title: `3 · Polo de ${c1 ? c1.name : STATE.secondCity}`,
      body: `A segunda maior concentração urbana (${c1 ? c1.name : STATE.secondCity}). Mesmo quando um lado vence no município, o outro partido soma um volume expressivo de eleitores que o mapa plano esconde.`,
      target: [x1, 0, z1], pos: [x1, 85, z1 + 20],
    },
    {
      title: `4 · Eixo ${c2 ? c2.name : 'Regional'} e ${c3 ? c3.name : 'Interior'}`,
      body: `As cidades médias do interior formam ilhas luminosas cercadas por áreas rurais de baixa densidade. Os pontos seguem o traçado das rodovias e sedes municipais.`,
      target: [(x2 + x3) / 2, 0, (z2 + z3) / 2], pos: [(x2 + x3) / 2, 115, (z2 + z3) / 2 + 24],
    },
    {
      title: `5 · Interior profundo e zonas rurais`,
      body: `Nos municípios menos populosos (como ${STATE.smallMun}), grandes extensões territoriais abrigam poucos pontos. No mapa plano tradicional, essas áreas parecem dominar o estado inteiro.`,
      target: [0, 0, 0], pos: [0, 185, 45],
    },
    {
      title: `6 · A leitura completa de ${STATE.name}`,
      body: `Juntando tudo: o Brasil não é dividido em blocos monolíticos vermelhos ou azuis — cada região combina núcleos urbanos densos e plurais com áreas rurais extensas.`,
      target: [0, 0, 4], pos: [0, 305, 18],
    },
  ];
}

const STOPS = buildStops();

let stopIdx = 0;
let playing = false;
let playTimer = null;
let camAnim = null;

function flyTo(stop, dur = 1500) {
  const fromPos = camera.position.clone();
  const fromTgt = controls.target.clone();
  const toPos = new THREE.Vector3(...stop.pos);
  const toTgt = new THREE.Vector3(...stop.target);
  camAnim = { fromPos, fromTgt, toPos, toTgt, start: performance.now(), dur };
}

const dotsNav = document.getElementById('tourDots');
STOPS.forEach((_, i) => {
  const b = document.createElement('span');
  b.className = 'tdot' + (i === 0 ? ' on' : '');
  b.onclick = () => { stopAuto(); goStop(i); };
  dotsNav.appendChild(b);
});

function goStop(i) {
  stopIdx = (i + STOPS.length) % STOPS.length;
  const s = STOPS[stopIdx];
  document.getElementById('tourStep').textContent = `Parada ${stopIdx + 1} de ${STOPS.length}`;
  document.getElementById('tourTitle').textContent = s.title;
  document.getElementById('tourBody').textContent = s.body;
  [...dotsNav.children].forEach((el, k) => el.classList.toggle('on', k === stopIdx));
  flyTo(s);
}
function stopAuto() {
  playing = false;
  clearTimeout(playTimer);
  const btn = document.getElementById('tourPlay');
  btn.textContent = '▶ Reproduzir tour';
  btn.classList.remove('active');
}
function stepAuto() {
  if (!playing) return;
  playTimer = setTimeout(() => {
    if (!playing) return;
    goStop(stopIdx + 1);
    stepAuto();
  }, 5500);
}
document.getElementById('tourPlay').onclick = () => {
  if (playing) { stopAuto(); }
  else {
    playing = true;
    const btn = document.getElementById('tourPlay');
    btn.textContent = '❚❚ Pausar tour';
    btn.classList.add('active');
    goStop(stopIdx);
    stepAuto();
  }
};
document.getElementById('tourPrev').onclick = () => { stopAuto(); goStop(stopIdx - 1); };
document.getElementById('tourNext').onclick = () => { stopAuto(); goStop(stopIdx + 1); };
renderer.domElement.addEventListener('pointerdown', stopAuto);
renderer.domElement.addEventListener('wheel', stopAuto, { passive: true });
goStop(0);

const fmt = n => Math.round(n).toLocaleString('pt-BR');
const pct = x => (x * 100).toFixed(1) + '%';
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

let activeId = null;
let activeRace = null;
let dotScale = 250;
let sizeMult = 1.0;

function setRace(id) {
  activeId = id;
  const r = races[id];
  activeRace = r;
  document.getElementById('kicker').textContent =
    `Densidade de pontos · ${r.office} ${r.year}` + (r.tag ? ` (${r.tag})` : '');
  document.getElementById('raceLine').textContent =
    `${r.rep} (PL/Conservador) vs. ${r.dem} (PT/Trabalhista)` + (r.note ? ` — ${r.note}` : '');

  for (const c of counties) {
    const row = r.counties[c.key] || r.counties[c.name] || [0, 0, 0];
    const rv = row[0] || 0, dv = row[1] || 0, ov = row[2] || 0;
    const tot = rv + dv + ov;
    const m = (rv + dv) ? ((rv - dv) / (rv + dv)) * 100 : 0;
    c.cur = { r: rv, d: dv, o: ov, tot, m };
  }

  const totR = r.totals.R, totD = r.totals.D, totO = r.totals.O || 0;
  const totAll = totR + totD + totO;
  const winner = totR >= totD ? r.rep : r.dem;
  const winCls = totR >= totD ? 'rep-t' : 'dem-t';
  const margin = totAll ? Math.abs(totR - totD) / totAll : 0;
  const lead = Math.abs(totR - totD);

  // Escala automática para manter ~100k-140k pontos rápidos na tela
  dotScale = Math.max(10, Math.ceil(totAll / 120000));
  if (dotScale > 100 && dotScale <= 250) dotScale = 250;
  else if (dotScale > 50 && dotScale <= 100) dotScale = 100;
  else if (dotScale > 25 && dotScale <= 50) dotScale = 50;
  else if (dotScale > 10 && dotScale <= 25) dotScale = 25;

  document.getElementById('headline').innerHTML = `
    <b class="${winCls}">${winner}</b> venceu em ${STATE.name} por
    <b>${(margin * 100).toFixed(1)} pontos</b> (${fmt(lead)} votos de ${fmt(totAll)} votos válidos).
    <div class="big">
      <span><b class="rep-t">${r.rep}</b> ${fmt(totR)} (${pct(totAll ? totR / totAll : 0)})</span>
      <span><b class="dem-t">${r.dem}</b> ${fmt(totD)} (${pct(totAll ? totD / totAll : 0)})</span>
    </div>
  `;

  renderTables(id);
  regenerate();
  if (places) places.refresh();
  const params = new URLSearchParams();
  params.set('uf', STATE.slug);
  if (id !== STATE.defaultRace) params.set('race', id);
  history.replaceState(null, '', location.pathname + '?' + params.toString());
}

function regenerate() {
  const r = races[activeId];
  const votesByCounty = counties.map(c => r.counties[c.key] || r.counties[c.name] || [0, 0, 0]);
  dotLayer.setScaleAppearance(dotScale / sizeMult);
  const per = dotScale;
  document.getElementById('scaleNote').textContent = per === 1
    ? `Cada ponto representa 1 voto válido — posicionado dentro da zona eleitoral onde foi registrado.`
    : `Cada ponto representa ${fmt(per)} votos daquele partido — posicionado dentro da zona eleitoral onde os votos foram registrados.`;
  const busyEl = document.getElementById('busy');
  const busyText = document.getElementById('busyText');
  if (busyText) busyText.textContent = 'Posicionando pontos de eleitores…';
  if (busyEl) { busyEl.classList.add('on'); busyEl.setAttribute('aria-busy', 'true'); }
  dotLayer.generate(
    { votesByCounty, scale: dotScale, seedSalt: hashStr(activeId), raceKey: activeId },
    ({ totalDots }) => {
      document.getElementById('dotCount').textContent =
        per === 1 ? `${fmt(totalDots)} eleitores` : `${fmt(totalDots)} pontos (1 = ${fmt(per)} votos)`;
      if (busyEl) { busyEl.classList.remove('on'); busyEl.setAttribute('aria-busy', 'false'); }
    }
  );
}

const yearSelect = document.getElementById('yearSelect');
const raceSelect = document.getElementById('raceSelect');
const selectableOrder = order.filter(id => !races[id].isShift);
const years = [...new Set(selectableOrder.map(id => races[id].year))];
yearSelect.innerHTML = years.map(y =>
  `<option value="${y}">${y === '2026' ? '2026 (Gerais)' : y}</option>`
).join('');

function populateRaceSelect(year, pickId) {
  const inYear = selectableOrder.filter(id => races[id].year === year);
  raceSelect.innerHTML = inYear.map(id => {
    const r = races[id];
    const tag = r.tag ? ` (${r.tag})` : '';
    return `<option value="${id}">${r.office}${tag} — ${r.rep} vs. ${r.dem}</option>`;
  }).join('');
  const target = (pickId && inYear.includes(pickId)) ? pickId : inYear[0];
  raceSelect.value = target;
  return target;
}
function selectRace(id) {
  const r = races[id];
  if (!r || r.isShift) return;
  yearSelect.value = r.year;
  populateRaceSelect(r.year, id);
  setRace(id);
}
yearSelect.onchange = () => setRace(populateRaceSelect(yearSelect.value));
raceSelect.onchange = () => setRace(raceSelect.value);

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
function renderTables(id) {
  const cur = races[id];
  document.getElementById('yearTitle').textContent = `Todos os cargos em ${cur.year}`;
  const sameYear = selectableOrder.filter(k => races[k].year === cur.year);
  const yearTbl = document.getElementById('yearTable');
  yearTbl.innerHTML = `
    <thead><tr><th>Cargo</th><th>Vencedor</th><th class="num">Margem</th><th class="num">Votos</th></tr></thead>
    <tbody>${sameYear.map(k => {
      const r = races[k];
      return rowHtml(k, r.office + (r.tag ? ` <span style="color:var(--muted)">(${r.tag})</span>` : ''));
    }).join('')}</tbody>
  `;
  bindTableClicks(yearTbl);

  const sameOffice = selectableOrder.filter(k => races[k].office === cur.office);
  const officeBlock = document.getElementById('officeBlock');
  if (sameOffice.length > 1) {
    officeBlock.style.display = '';
    document.getElementById('officeTitle').textContent = `${cur.office} ao longo dos anos`;
    const offTbl = document.getElementById('officeTable');
    offTbl.innerHTML = `
      <thead><tr><th>Ano</th><th>Vencedor</th><th class="num">Margem</th><th class="num">Votos</th></tr></thead>
      <tbody>${sameOffice.map(k => {
        const r = races[k];
        return rowHtml(k, r.year + (r.tag ? ` <span style="color:var(--muted)">(${r.tag})</span>` : ''));
      }).join('')}</tbody>
    `;
    bindTableClicks(offTbl);
  } else {
    officeBlock.style.display = 'none';
  }
}

document.getElementById('dotSize').oninput = e => {
  sizeMult = +e.target.value / 100;
  dotLayer.setScaleAppearance(dotScale / sizeMult);
};
document.getElementById('toggleLines').onclick = e => {
  const on = e.currentTarget.classList.toggle('active');
  if (outlineGroup) outlineGroup.visible = on;
};
document.getElementById('toggleLabels').onclick = e => {
  showLabels = e.currentTarget.classList.toggle('active');
  labelsRoot.style.display = showLabels ? 'block' : 'none';
};
document.getElementById('reset').onclick = () => {
  stopAuto();
  if (places) places.clearAll();
  goStop(0);
};

let pinnedCounty = null;
const places = createPlaceFinder({
  counties, group, camera, controls,
  proj: ll => { const p = proj(ll); return p ? [p[0] - W / 2, -(p[1] - H / 2)] : null; },
  cityUrl: STATE.data.cities,
  precinctUrl: STATE.data.precincts,
  precinctShapesUrl: STATE.data.precinctShapes,
  onSelectCounty: c => { pinnedCounty = c; dotLayer.setHover(c ? counties.indexOf(c) : null); },
  onClearCounty: () => { pinnedCounty = null; dotLayer.setHover(null); },
  onSelectPrecinct: () => false,
  getRaceInfo: () => ({
    raceKey: activeId,
    rName: activeRace ? activeRace.rep : 'PL',
    dName: activeRace ? activeRace.dem : 'PT',
  }),
  onCameraChange: () => stopAuto(),
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
const hitPt = new THREE.Vector3();
const tooltip = document.getElementById('tooltip');

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
      let hole = false;
      for (let h = 1; h < rings.length; h++) if (pip2(x, y, rings[h])) { hole = true; break; }
      if (!hole) return c;
    }
  }
  return null;
}

renderer.domElement.addEventListener('pointermove', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  let c = null;
  if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
    c = findCountyAt(hitPt.x, -hitPt.z);
  }
  if (c && c.cur) {
    if (!pinnedCounty) dotLayer.setHover(counties.indexOf(c));
    const { r, d, o, tot, m } = c.cur;
    const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
    const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
    const sign = m >= 0 ? 'PL+' : 'PT+';
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
    tooltip.innerHTML = `
      <div class="t-name">${UNIT_CAP} de ${c.name}</div>
      <div class="t-row"><span class="rep-t">${activeRace.rep} (PL)</span><span>${fmt(r)} (${rPct}%)</span></div>
      <div class="t-row"><span class="dem-t">${activeRace.dem} (PT)</span><span>${fmt(d)} (${dPct}%)</span></div>
      ${o ? `<div class="t-row" style="color:var(--muted)"><span>Outros</span><span>${fmt(o)}</span></div>` : ''}
      <div class="t-sub">Total ${fmt(tot)} · Margem <b>${sign}${Math.abs(m).toFixed(1)}%</b></div>
    `;
  } else {
    if (!pinnedCounty) dotLayer.setHover(null);
    tooltip.style.display = 'none';
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  if (!pinnedCounty) dotLayer.setHover(null);
  tooltip.style.display = 'none';
});

let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY) return;
  const dx = e.clientX - downXY[0], dy = e.clientY - downXY[1];
  downXY = null;
  if (dx * dx + dy * dy > 25) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
    const c = findCountyAt(hitPt.x, -hitPt.z);
    if (c && places) places.pickCountyFromMap(c);
  }
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

function tick(now) {
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.start) / camAnim.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, e);
    if (t >= 1) camAnim = null;
  }
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

const initParams = new URLSearchParams(location.search);
const wantRace = initParams.get('race');
const initId = (wantRace && races[wantRace] && !races[wantRace].isShift)
  ? wantRace
  : (STATE.defaultRace && races[STATE.defaultRace] ? STATE.defaultRace : selectableOrder[0]);
selectRace(initId);
requestAnimationFrame(tick);
