import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { createDotLayer } from './dots.js';
import { createPlaceFinder } from './places.js';
import { renderSourceNote } from './sourcelist.js';
import { computeInteriorPoint } from './callout-logic.js';
import { buildContextMap, clampCameraPan } from './context-map.js';
import './custom-select.js';

const easeQuint = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

const isBR = STATE.slug === 'br';
const UNIT_CAP = isBR ? 'Estado' : (STATE.slug === 'df' ? 'Região Administrativa' : 'Município');
const unitLow = isBR ? 'estado' : (STATE.slug === 'df' ? 'região administrativa' : 'município');

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

const framedSuffix = isFramed ? '&framed=1' : '';
document.title = `Onde os Eleitores de ${STATE.name} Moram — Densidade de Pontos`;
document.getElementById('title').textContent = `Onde os eleitores de ${STATE.name} moram`;
document.getElementById('views').innerHTML =
  `<a class="view-link" href="${STATE.results.href}${framedSuffix}">Colunas 3D</a>` +
  `<a class="view-link active" href="${STATE.dots}${framedSuffix}">Pontos</a>`;
const mc = document.getElementById('modeCols');
const md = document.getElementById('modeDots');
if (mc) mc.href = `${STATE.results.href}${framedSuffix}`;
if (md) md.href = `${STATE.dots}${framedSuffix}`;
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
clampCameraPan(controls, camera, 105, true);

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
    dragModeBtn.textContent = panMode ? 'Mover' : 'Girar';
    dragModeBtn.classList.toggle('active', !panMode);
    syncHint();
  };
}
syncHint();

const group = new THREE.Group();
scene.add(group);

buildContextMap({
  uf: STATE.slug,
  proj: ll => {
    const p = proj(ll);
    return p ? [p[0] - W / 2, -(p[1] - H / 2)] : [NaN, NaN];
  },
  BASE_H: 0.3,
  yUp: true
}).then(grp => {
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
const fillMat = new THREE.MeshBasicMaterial({ color: 0x0b1924 });
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

  const g = new THREE.ShapeGeometry(shapes);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, fillMat);
  m.position.y = 0.05;
  group.add(m);

  counties.push({ name: rawName, key: rawName.toUpperCase(), area, cx, cy, span, shapes, polys: rawPolys, targetH: 0.3 });
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
  const placed = [];
  for (const it of labelItems) {
    const v = it.world.clone().project(camera);
    if (v.z > 1) { it.el.style.display = 'none'; continue; }
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    if (sx < 20 || sx > rect.width - 20 || sy < 20 || sy > rect.height - 40) {
      it.el.style.display = 'none';
      continue;
    }
    const collides = placed.some(p => Math.abs(p.x - sx) < 92 && Math.abs(p.y - sy) < 24);
    if (collides) {
      it.el.style.display = 'none';
      continue;
    }
    placed.push({ x: sx, y: sy });
    it.el.style.display = 'flex';
    it.el.style.left = sx + 'px';
    it.el.style.top  = sy + 'px';
  }
}

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
      title: `1 · Todo o território de ${STATE.name}`,
      body: `Olhe onde os pontos realmente estão. Grandes extensões rurais têm baixa densidade eleitoral, enquanto a maior parte dos votos se concentra nas manchas urbanas brilhantes.`,
      target: [0, 0, 4], pos: [0, 335, 20],
    },
    {
      title: `2 · Região de ${c0 ? c0.name : STATE.capital}`,
      body: `O maior polo eleitoral (${c0 ? c0.name : STATE.capital}). No centro denso, os votos do PT e do PL aparecem lado a lado, formando dezenas de milhares de votos em poucos quilômetros.`,
      target: [x0, 0, z0], pos: [x0, 118, z0 + 26],
    },
    {
      title: `3 · Polo de ${c1 ? c1.name : STATE.secondCity}`,
      body: `A segunda maior concentração (${c1 ? c1.name : STATE.secondCity}). Mesmo quando um lado vence, o outro partido soma um volume expressivo de eleitores que o mapa plano esconde.`,
      target: [x1, 0, z1], pos: [x1, 122, z1 + 28],
    },
    {
      title: `4 · Eixo ${c2 ? c2.name : 'Regional'} e ${c3 ? c3.name : 'Interior'}`,
      body: `As cidades médias do interior formam ilhas luminosas cercadas por áreas rurais de baixa densidade. Os pontos seguem o traçado das rodovias e sedes municipais.`,
      target: [(x2 + x3) / 2, 0, (z2 + z3) / 2], pos: [(x2 + x3) / 2, 145, (z2 + z3) / 2 + 30],
    },
    {
      title: `5 · Interior profundo e zonas rurais`,
      body: `Nos locais menos populosos (como ${STATE.smallMun}), grandes extensões territoriais abrigam poucos pontos. No mapa plano tradicional, essas áreas parecem dominar o território inteiro.`,
      target: [0, 0, 0], pos: [0, 215, 48],
    },
    {
      title: `6 · A leitura completa de ${STATE.name}`,
      body: `Juntando tudo: o Brasil não é dividido em blocos monolíticos vermelhos ou azuis — cada região combina núcleos urbanos densos e plurais com áreas rurais extensas.`,
      target: [0, 0, 4], pos: [0, 335, 20],
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

const tourSectionEl = document.getElementById('tourSection');
const tourCloseBtn = document.getElementById('tourCloseBtn');
const tourReopenPill = document.getElementById('tourReopenPill');
const tourReopenBtn = document.getElementById('tourReopenBtn');
if (tourCloseBtn && tourSectionEl) {
  tourCloseBtn.onclick = () => {
    stopAuto();
    tourSectionEl.hidden = true;
    if (tourReopenPill) tourReopenPill.style.display = 'flex';
  };
}
if (tourReopenBtn && tourSectionEl) {
  tourReopenBtn.onclick = () => {
    tourSectionEl.hidden = false;
    if (tourReopenPill) tourReopenPill.style.display = 'none';
  };
}

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
let pinnedCounty = null;
let pinnedMeta = null;

function syncUrl() {
  const params = new URLSearchParams();
  params.set('uf', STATE.slug);
  if (activeId && activeId !== STATE.defaultRace) params.set('race', activeId);
  if (pinnedCounty) params.set('mun', pinnedCounty.name);
  if (document.body.classList.contains('framed')) params.set('framed', '1');
  history.replaceState(null, '', location.pathname + '?' + params.toString());

  const cmp = document.getElementById('compareLink');
  if (cmp) {
    const cmpParams = new URLSearchParams();
    cmpParams.set('uf', STATE.slug);
    if (activeId) cmpParams.set('race', activeId);
    if (pinnedCounty) cmpParams.set('mun', pinnedCounty.name);
    cmp.href = 'compare.html?' + cmpParams.toString();
  }
}

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
      <div class="mun-race-row ${id === activeId ? 'active' : ''}" data-race="${id}">
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

  cardEl.style.display = 'block';
  cardEl.innerHTML = `
    <div class="mun-head">
      <div>
        <div class="kicker">Raio-X Municipal · ${STATE.code}</div>
        <h3>${c.name}</h3>
      </div>
      <div class="mun-actions">
        <button type="button" id="munShareBtn" title="Copiar link direto para este município">Compartilhar</button>
        <button type="button" id="munCloseBtn" title="Fechar Raio-X">✕</button>
      </div>
    </div>
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
    <div class="mun-subhead">Todos os cargos em 2026 neste ${unitLow}</div>
    <div class="mun-races">${races26Html}</div>
  `;
  cardEl.querySelectorAll('.mun-race-row[data-race]').forEach(el => {
    el.onclick = () => selectRace(el.dataset.race);
  });
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
  const closeBtn = document.getElementById('munCloseBtn');
  if (closeBtn) closeBtn.onclick = () => { if (places) places.clearAll(); };
}

function getPublicShareUrl() {
  const page = location.pathname.split('/').pop() || 'voters.html';
  const params = new URLSearchParams(location.search);
  params.delete('framed');
  const qs = params.toString();
  const rel = `${page}${qs ? '?' + qs : ''}${location.hash || ''}`;
  if (/\.run\.app$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) {
    return `https://guumachadooo.github.io/usavote/${rel}`;
  }
  return new URL(rel, location.href).href;
}

function copyTextToClipboard(text) {
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
  document.getElementById('kicker').textContent =
    `Densidade de pontos · ${r.office} ${r.year}` + (r.tag ? ` (${r.tag})` : '');
  document.getElementById('raceLine').textContent =
    `${r.rep} vs. ${r.dem}` + (r.note ? ` — ${r.note}` : '');

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

  if (isBR) {
    dotScale = 250;
  } else {
    dotScale = Math.max(10, Math.ceil(totAll / 120000));
    if (dotScale > 100 && dotScale <= 250) dotScale = 250;
    else if (dotScale > 50 && dotScale <= 100) dotScale = 100;
    else if (dotScale > 25 && dotScale <= 50) dotScale = 50;
    else if (dotScale > 10 && dotScale <= 25) dotScale = 25;
  }

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
  renderMunicipalityCard();
  syncUrl();
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

const tooltip = document.getElementById('tooltip');
let pinnedTooltipOpen = false;
let hoveredDotCounty = null;

function showPinnedDotTooltip() {
  if (!pinnedCounty || !pinnedTooltipOpen || !pinnedCounty.cur) return;
  tooltip.innerHTML = buildDotTooltipHtml(pinnedCounty, true);
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
  const shareAct = tooltip.querySelector('.t-share-btn');
  if (shareAct) {
    shareAct.onclick = e => {
      e.stopPropagation();
      syncUrl();
      copyTextToClipboard(getPublicShareUrl()).then(() => {
        shareAct.textContent = 'Copiado!';
        setTimeout(() => { shareAct.textContent = 'Copiar link'; }, 1500);
      });
    };
  }
  updatePinnedDotTooltipPosition();
}

const _projDotVec = new THREE.Vector3();
function updatePinnedDotTooltipPosition() {
  if (!pinnedCounty || !pinnedTooltipOpen || hoveredDotCounty) return;
  if (!tooltip.classList.contains('pinned') || tooltip.style.display === 'none') return;
  const stageRect = stage.getBoundingClientRect();
  if (stageRect.width < 10 || stageRect.height < 10) return;

  const c = pinnedCounty;
  _projDotVec.set(c.cx, 0.3, -c.cy);
  _projDotVec.project(camera);

  if (_projDotVec.z > 1) {
    tooltip.style.opacity = '0';
    return;
  }
  tooltip.style.opacity = '1';

  const sx = stageRect.left + (_projDotVec.x * 0.5 + 0.5) * stageRect.width;
  const sy = stageRect.top + (-_projDotVec.y * 0.5 + 0.5) * stageRect.height;

  const tw = tooltip.offsetWidth || 235;
  const th = tooltip.offsetHeight || 110;

  const controlsEl = document.querySelector('.map-area .controls');
  const controlsTop = controlsEl ? controlsEl.getBoundingClientRect().top : (stageRect.bottom - 76);
  const minTop = stageRect.top + 10;
  const maxTop = Math.max(minTop, Math.min(stageRect.bottom - th - 10, controlsTop - th - 12));

  const gap = 18;
  const roomRight = (stageRect.right - 10) - (sx + gap);
  const roomLeft = (sx - gap) - (stageRect.left + 10);

  tooltip.classList.remove('side-right', 'side-left', 'side-top');

  let left, top;
  if (roomRight >= tw || (roomRight >= roomLeft && roomRight >= 180)) {
    left = Math.min(stageRect.right - tw - 10, sx + gap);
    top = Math.max(minTop, Math.min(maxTop, sy - th * 0.5));
    tooltip.classList.add('side-right');
    const arrowY = Math.max(14, Math.min(th - 14, sy - top));
    tooltip.style.setProperty('--arrow-y', `${arrowY}px`);
  } else if (roomLeft >= 180) {
    left = Math.max(stageRect.left + 10, sx - tw - gap);
    top = Math.max(minTop, Math.min(maxTop, sy - th * 0.5));
    tooltip.classList.add('side-left');
    const arrowY = Math.max(14, Math.min(th - 14, sy - top));
    tooltip.style.setProperty('--arrow-y', `${arrowY}px`);
  } else {
    left = Math.max(stageRect.left + 10, Math.min(stageRect.right - tw - 10, sx - tw * 0.5));
    top = Math.max(minTop, Math.min(maxTop, sy - th - 16));
    tooltip.classList.add('side-top');
    const arrowX = Math.max(18, Math.min(tw - 18, sx - left));
    tooltip.style.setProperty('--arrow-x', `${arrowX}px`);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

const places = createPlaceFinder({
  counties, group, camera, controls,
  proj: ll => { const p = proj(ll); return p ? [p[0] - W / 2, -(p[1] - H / 2)] : null; },
  cityUrl: STATE.data.cities,
  precinctUrl: STATE.data.precincts,
  precinctShapesUrl: STATE.data.precinctShapes,
  onSelectCounty: (c, meta) => {
    pinnedCounty = c;
    pinnedMeta = meta;
    pinnedTooltipOpen = !!c;
    const qs = document.getElementById('munQuickSearch');
    if (qs) qs.value = c ? c.name : '';
    dotLayer.setHover(c ? counties.indexOf(c) : null);
    renderMunicipalityCard();
    syncUrl();
    if (c) showPinnedDotTooltip();
  },
  onClearCounty: () => {
    pinnedCounty = null;
    pinnedMeta = null;
    pinnedTooltipOpen = false;
    const qs = document.getElementById('munQuickSearch');
    if (qs) qs.value = '';
    dotLayer.setHover(null);
    tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
    tooltip.style.display = 'none';
    renderMunicipalityCard();
    syncUrl();
  },
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

const fmtCandName = (name, party) => {
  if (!name) return party;
  return name.includes('(') ? name : `${name} (${party})`;
};

function buildDotTooltipHtml(c, isPinned = false) {
  const { r, d, o, tot, m } = c.cur;
  const rPct = tot ? ((r / tot) * 100).toFixed(1) : '0.0';
  const dPct = tot ? ((d / tot) * 100).toFixed(1) : '0.0';
  const sign = m >= 0 ? 'PL+' : 'PT+';
  const closeHtml = isPinned ? `<button type="button" class="t-close" title="Fechar cartão" aria-label="Fechar">×</button>` : '';
  const actionsHtml = isPinned ? `
    <div class="t-actions">
      <button type="button" class="t-act-btn t-share-btn" title="Copiar link direto deste município">Copiar link</button>
    </div>
  ` : '';
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

renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  let c = null;
  if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
    c = findCountyAt(hitPt.x, -hitPt.z);
  }
  if (c && c.cur && c !== pinnedCounty) {
    hoveredDotCounty = c;
    if (!pinnedCounty) dotLayer.setHover(counties.indexOf(c));
    tooltip.classList.remove('pinned', 'side-right', 'side-left', 'side-top');
    tooltip.style.opacity = '1';
    tooltip.style.display = 'block';
    const controlsEl = document.querySelector('.map-area .controls');
    const maxY = (controlsEl ? controlsEl.getBoundingClientRect().top : window.innerHeight - 76) - 130;
    tooltip.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
    tooltip.style.top = Math.min(maxY, e.clientY + 14) + 'px';
    tooltip.innerHTML = buildDotTooltipHtml(c, false);
  } else {
    hoveredDotCounty = null;
    if (!pinnedCounty) dotLayer.setHover(null);
    if (pinnedCounty && pinnedTooltipOpen) showPinnedDotTooltip();
    else tooltip.style.display = 'none';
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  hoveredDotCounty = null;
  if (!pinnedCounty) dotLayer.setHover(null);
  if (pinnedCounty && pinnedTooltipOpen) showPinnedDotTooltip();
  else tooltip.style.display = 'none';
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
    if (c && places) {
      hoveredDotCounty = null;
      places.pickCountyFromMap(c);
      showPinnedDotTooltip();
    }
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

// Busca Instantânea de Município (#munQuickSearch + #munSearchList)
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
    }
  });
}

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
    if (!d || d.type !== 'setCam') return;
    suppressCamBroadcast = true;
    camAnim = null;
    camera.position.set(d.px, d.py, d.pz);
    controls.target.set(d.tx, d.ty, d.tz);
    controls.update();
    suppressCamBroadcast = false;
  });
}

let lastVoterFrame = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastVoterFrame) / 1000);
  lastVoterFrame = now;
  dotLayer.tick(dt);
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.start) / camAnim.dur);
    const e = easeQuint(t);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, e);
    if (t >= 1) camAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
  updatePinnedDotTooltipPosition();
  requestAnimationFrame(tick);
}

const wantRace = initParams.get('race');
const wantMun = initParams.get('mun');
const initId = (wantRace && races[wantRace] && !races[wantRace].isShift)
  ? wantRace
  : (STATE.defaultRace && races[STATE.defaultRace] ? STATE.defaultRace : selectableOrder[0]);
selectRace(initId);
if (wantMun && places) {
  places.selectCountyByName(wantMun, true);
}
requestAnimationFrame(tick);
