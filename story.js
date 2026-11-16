import * as THREE from 'three';
import { STATE } from './state.js';
import { createMap3D } from './map3d.js';

const isBR = STATE.slug === 'br';
const unitSing = isBR ? 'estado' : (STATE.slug === 'df' ? 'região administrativa' : 'município');
const unitPlur = isBR ? 'estados (27 UFs)' : (STATE.slug === 'df' ? 'regiões administrativas' : 'municípios');

document.title = `Tour Guiado por ${STATE.name} — Como o Brasil Vota`;
document.getElementById('brand').innerHTML = `<b>${STATE.name}</b> · Um passeio de 60 segundos pelos ${isBR ? 'estados' : 'municípios'}`;
document.getElementById('linkMisread').href = `misread.html?uf=${STATE.slug}`;
document.getElementById('linkExplore').href = STATE.results.href;
const exitBtn = document.getElementById('exitTourBtn');
const exitTop = document.getElementById('exitTourTop');
if (exitBtn) exitBtn.href = STATE.results.href;
if (exitTop) exitTop.href = STATE.results.href;

const stage = document.getElementById('stage');
const callouts = document.getElementById('callouts');
const map = await createMap3D(stage, { interactive: true });

const fmt = n => Math.round(n).toLocaleString('pt-BR');

// Encontrar o maior município/estado, o segundo maior e os 2 menores em votos
const raceId = STATE.defaultRace || '2026-pres-2t';
map.applyState({ raceId, raise: 0, colorMode: 'winner', split: false, dur: 10 });
const sortedByVotes = [...map.counties].filter(c => c.cur.tot > 0).sort((a, b) => b.cur.tot - a.cur.tot);
const big1 = sortedByVotes[0] || map.counties[0];
const big2 = sortedByVotes[1] || big1;
const small1 = sortedByVotes[sortedByVotes.length - 1] || big1;
// Entre os menores colégios eleitorais, escolhe o mais próximo de small1 para que ambos fiquem bem enquadrados
const smallPool = sortedByVotes.slice(-Math.min(12, sortedByVotes.length)).filter(c => c !== small1);
const small2 = smallPool.length
  ? smallPool.reduce((best, c) => {
      const d = Math.hypot(c.cx - small1.cx, c.cy - small1.cy);
      const db = Math.hypot(best.cx - small1.cx, best.cy - small1.cy);
      return d < db ? c : best;
    }, smallPool[0])
  : (sortedByVotes[sortedByVotes.length - 2] || small1);

function frameCountiesCam(list, baseHeight = 155) {
  const valid = (list || []).filter(Boolean);
  if (!valid.length) return { pos: [0, 325, 0.01], target: [0, 0, 0] };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of valid) {
    const z = -c.cy;
    if (c.cx < minX) minX = c.cx;
    if (c.cx > maxX) maxX = c.cx;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const midX = (minX + maxX) * 0.5;
  const midZ = (minZ + maxZ) * 0.5;
  const dx = maxX - minX;
  const dz = maxZ - minZ;
  const span = Math.max(dx * 1.25, dz * 1.45);
  const camY = Math.min(330, Math.max(baseHeight, span * 1.85 + 95));
  const camZOff = Math.min(150, Math.max(62, span * 0.62 + 44));
  return {
    pos: [midX, camY, midZ + camZOff],
    target: [midX, 0, midZ],
  };
}

const totStateVotes = sortedByVotes.reduce((s, c) => s + c.cur.tot, 0);
const rCounties = sortedByVotes.filter(c => c.cur.r >= c.cur.d).length;
const dCounties = sortedByVotes.length - rCounties;

const STEPS = [
  {
    tag: 'Passo 1 de 6 · O mapa plano',
    headline: `Em um mapa plano, cada ${unitSing} de ${STATE.name} tem o mesmo peso visual.`,
    body: `${STATE.name} possui ${map.counties.length} ${unitPlur}. Em um mapa tradicional pintado pelo vencedor, áreas extensas com poucos moradores ocupam a maior parte da tela.`,
    stats: [
      { k: 'Unidades vencidas pelo PL', v: `${rCounties} de ${sortedByVotes.length}`, cls: 'rep' },
      { k: 'Unidades vencidas pelo PT', v: `${dCounties} de ${sortedByVotes.length}`, cls: 'dem' },
      { k: 'Total de votos válidos', v: fmt(totStateVotes) },
    ],
    state: { raceId, raise: 0, colorMode: 'winner', split: false },
    cam:   { pos: [0, 325, 0.01], target: [0, 0, 0] },
    pins:  [],
  },
  {
    tag: `Passo 2 de 6 · Os menores colégios eleitorais`,
    headline: `${small1.name} registrou ${fmt(small1.cur.tot)} votos válidos.`,
    body: `No mapa plano, locais com menos eleitores como ${small1.name} (${fmt(small1.cur.tot)} votos) e ${small2.name} (${fmt(small2.cur.tot)} votos) aparecem com a mesma intensidade de cor que os maiores centros.`,
    stats: [
      { k: small1.name, v: `${fmt(small1.cur.tot)} votos` },
      { k: small2.name, v: `${fmt(small2.cur.tot)} votos` },
      { k: `Juntos em relação a ${big1.name}`, v: `${(((small1.cur.tot + small2.cur.tot) / Math.max(1, big1.cur.tot)) * 100).toFixed(2)}%` },
    ],
    state: { raceId, raise: 0, colorMode: 'margin', focus: [small1.name, small2.name], dimOthers: true },
    cam:   frameCountiesCam([small1, small2], 150),
    pins: [
      { county: small1.name, sub: `${fmt(small1.cur.tot)} votos no total` },
      { county: small2.name, sub: `${fmt(small2.cur.tot)} votos no total` },
    ],
  },
  {
    tag: `Passo 3 de 6 · Os maiores polos eleitorais (${big1.name} e ${big2.name})`,
    headline: `Um único ${unitSing} — ${big1.name} — concentrou ${fmt(big1.cur.tot)} votos.`,
    body: `${big1.name} sozinho representa ${((big1.cur.tot / Math.max(1, totStateVotes)) * 100).toFixed(1)}% de todos os votos — somado a ${big2.name} (${fmt(big2.cur.tot)} votos), concentra mais eleitores que dezenas de outras unidades juntas.`,
    stats: [
      { k: `Votos em ${big1.name}`, v: fmt(big1.cur.tot) },
      { k: 'Votos no PL', v: fmt(big1.cur.r), cls: 'rep' },
      { k: 'Votos no PT', v: fmt(big1.cur.d), cls: 'dem' },
    ],
    state: { raceId, raise: 0, colorMode: 'margin', focus: [big1.name, big2.name], dimOthers: true },
    cam:   frameCountiesCam([big1, big2], 160),
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
      { county: big2.name, sub: `${fmt(big2.cur.tot)} votos` },
    ],
  },
  {
    tag: 'Passo 4 de 6 · Erguendo o mapa pelos votos',
    headline: `Agora erguemos cada ${unitSing} pelo total de votos que depositou na urna.`,
    body: `Quando a altura passa a refletir o número de eleitores, a geografia real do voto aparece: grandes picos eleitorais cercados por colinas regionais.`,
    stats: [
      { k: `Pico mais alto (${big1.name})`, v: `${fmt(big1.cur.tot)} votos` },
      { k: `Segundo pico (${big2.name})`, v: `${fmt(big2.cur.tot)} votos` },
      { k: `Menor coluna (${small1.name})`, v: `${fmt(small1.cur.tot)} votos` },
    ],
    state: { raceId, raise: 1, colorMode: 'margin', split: false },
    cam:   { pos: [18, 215, 255], target: [4, 10, 6] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
      { county: big2.name, sub: `${fmt(big2.cur.tot)} votos` },
    ],
  },
  {
    tag: `Passo 5 de 6 · Nenhum ${unitSing} é 100% de um lado só`,
    headline: `Divida cada coluna em dois e os eleitores da minoria local aparecem.`,
    body: `O candidato vencedor fica no topo de cada barra e o segundo colocado fica na base. Mesmo onde um partido vence com folga, milhões ou centenas de milhares de vizinhos votaram no outro lado.`,
    stats: [
      { k: `PT em ${big1.name}`, v: fmt(big1.cur.d), cls: 'dem' },
      { k: `PL em ${big1.name}`, v: fmt(big1.cur.r), cls: 'rep' },
      { k: isBR ? 'Total nacional' : 'Total estadual', v: fmt(totStateVotes) },
    ],
    state: { raceId, raise: 1, colorMode: 'margin', split: true },
    cam:   { pos: [-22, 205, 250], target: [4, 12, 6] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.d)} PT · ${fmt(big1.cur.r)} PL` },
    ],
  },
  {
    tag: 'Passo 6 de 6 · Explore livremente',
    headline: `Gire, aproxime ou troque para qualquer disputa de 2026, 2022 ou 2018.`,
    body: `Arraste para girar o mapa em 3D, role para dar zoom, ou clique em "Explorar todos os cargos" para comparar Presidente, Governador, Senado e Deputados em todas as 27 UFs.`,
    stats: [
      { k: 'UFs disponíveis', v: 'Brasil + 27 UFs' },
      { k: 'Eleições incluídas', v: '2026, 2022 e 2018' },
      { k: 'Malha geográfica', v: 'IBGE Oficial' },
    ],
    state: { raceId, raise: 1, colorMode: 'lead', split: true },
    cam:   { pos: [0, 235, 255], target: [0, 8, 6] },
    pins:  [],
  },
];

const dotsEl = document.getElementById('dots');
const trackEl = document.getElementById('track');
const trackFill = document.getElementById('trackFill');
const trackMarks = document.getElementById('trackMarks');
const sceneCountEl = document.getElementById('sceneCount');

if (trackMarks && STEPS.length > 1) {
  trackMarks.innerHTML = STEPS.slice(1).map((_, i) => {
    const pctPos = ((i + 1) / (STEPS.length - 1)) * 100;
    return `<b style="left:${pctPos.toFixed(2)}%"></b>`;
  }).join('');
}

STEPS.forEach((_, i) => {
  const d = document.createElement('div');
  d.className = 'dot';
  d.onclick = () => { stopAuto(); go(i); };
  dotsEl.appendChild(d);
});

let idx = 0;
let activePins = [];

function rebuildPins(pins) {
  callouts.innerHTML = '';
  map.setPins(pins || []);
  activePins = (pins || []).map(p => {
    const c = map.getCounty(p.county);
    if (!c) return null;
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `
      <svg class="leader" viewBox="-200 -150 400 300" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="-22"></line></svg>
      <div class="box"><b>${c.name}</b><span class="sub">${p.sub || ''}</span></div>
      <div class="dot-pin"></div>
    `;
    callouts.appendChild(el);
    return {
      c,
      el,
      box: el.querySelector('.box'),
      line: el.querySelector('line'),
      sx: 0,
      sy: 0,
      visible: false,
    };
  }).filter(Boolean);
}

export function layoutCalloutPins(pins, stageEl, topPad = 10) {
  const sw = stageEl.clientWidth || 800;
  const sh = stageEl.clientHeight || 600;
  const vis = [];
  for (const p of pins) {
    if (!p.visible) {
      p.el.style.display = 'none';
      continue;
    }
    p.el.style.display = 'block';
    p.el.style.left = `${p.sx}px`;
    p.el.style.top = `${p.sy}px`;
    p.w = p.box.offsetWidth || 156;
    p.h = p.box.offsetHeight || 44;
    p.dx = 0;
    p.dy = -22;
    p.place = 'above';
    vis.push(p);
  }
  // Se houver 2 balões próximos, coloca o mais ao norte acima (dy = -22) e o mais ao sul abaixo (dy = +22), mantendo dx = 0 (alinhado ao centro do município)
  if (vis.length === 2) {
    const [a, b] = vis;
    const minSepX = (a.w + b.w) * 0.5 + 14;
    const minSepY = Math.max(a.h, b.h) + 28;
    const distX = Math.abs(a.sx - b.sx);
    const distY = Math.abs(a.sy - b.sy);
    if (distX < minSepX && distY < minSepY) {
      const upper = (a.sy < b.sy - 2 || (Math.abs(a.sy - b.sy) <= 2 && a.sx <= b.sx)) ? a : b;
      const lower = upper === a ? b : a;
      upper.place = 'above';
      upper.dy = -22;
      lower.place = 'below';
      lower.dy = 22;
    }
  }
  const pad = 10;
  const maxShiftX = 44;
  for (const p of vis) {
    if (p.place === 'above' && (p.sy + p.dy - p.h) < topPad) {
      p.place = 'below';
      p.dy = 22;
    } else if (p.place === 'below' && (p.sy + p.dy + p.h) > sh - pad) {
      p.place = 'above';
      p.dy = -22;
    }
    const leftEdge = p.sx + p.dx - p.w * 0.5;
    const rightEdge = p.sx + p.dx + p.w * 0.5;
    if (leftEdge < pad) p.dx = Math.min(maxShiftX, p.dx + (pad - leftEdge));
    if (rightEdge > sw - pad) p.dx = Math.max(-maxShiftX, p.dx - (rightEdge - (sw - pad)));
  }
  // Só afasta horizontalmente se ambos estiverem do mesmo lado vertical E ainda se sobrepuserem em Y
  if (vis.length === 2 && vis[0].place === vis[1].place) {
    const [a, b] = vis;
    if (Math.abs(a.sy - b.sy) < Math.max(a.h, b.h) + 8) {
      const minSepX = (a.w + b.w) * 0.5 + 12;
      const cxA = a.sx + a.dx;
      const cxB = b.sx + b.dx;
      const gap = Math.abs(cxA - cxB);
      if (gap < minSepX) {
        const push = Math.min(maxShiftX, (minSepX - gap) * 0.5);
        if (cxA <= cxB) { a.dx -= push; b.dx += push; }
        else { a.dx += push; b.dx -= push; }
      }
    }
  }
  for (const p of vis) {
    const boxTop = p.place === 'above' ? (p.dy - p.h) : p.dy;
    p.box.style.transform = `translate(${Math.round(p.dx - p.w * 0.5)}px, ${Math.round(boxTop)}px)`;
    if (p.line) {
      p.line.setAttribute('x2', String(Math.round(p.dx)));
      p.line.setAttribute('y2', String(Math.round(p.dy)));
    }
  }
}

map.onTick(() => {
  for (const p of activePins) {
    const topY = p.c.curBot + p.c.curMid + p.c.curTop;
    const s = map.projectToScreen(new THREE.Vector3(p.c.cx, topY, -p.c.cy));
    p.sx = s.x;
    p.sy = s.y;
    p.visible = s.visible;
  }
  layoutCalloutPins(activePins, stage, 10);
});

function go(newIdx) {
  idx = Math.max(0, Math.min(STEPS.length - 1, newIdx));
  const s = STEPS[idx];
  document.getElementById('stepTag').textContent = s.tag;
  document.getElementById('headline').textContent = s.headline;
  document.getElementById('body').textContent = s.body;
  document.getElementById('stats').innerHTML = s.stats.map(st => `
    <div class="stat">
      <div class="k">${st.k}</div>
      <div class="v ${st.cls || ''}">${st.v}</div>
    </div>
  `).join('');
  [...dotsEl.children].forEach((d, i) => d.classList.toggle('on', i === idx));
  if (trackFill) {
    trackFill.style.width = `${STEPS.length > 1 ? (idx / (STEPS.length - 1)) * 100 : 100}%`;
  }
  if (sceneCountEl) {
    sceneCountEl.textContent = `${idx + 1} / ${STEPS.length}`;
  }
  if (trackEl) {
    trackEl.setAttribute('aria-valuenow', String(idx + 1));
    trackEl.setAttribute('aria-valuetext', `Cena ${idx + 1} de ${STEPS.length}`);
  }
  document.getElementById('prev').disabled = idx === 0;
  const nextBtn = document.getElementById('next');
  if (idx === STEPS.length - 1) {
    nextBtn.textContent = 'Abrir explorador →';
  } else {
    nextBtn.textContent = 'Próximo →';
  }
  map.applyState(s.state);
  map.setCamera(s.cam);
  rebuildPins(s.pins);

  // Salva a cena no endereço (?scene=N), como no player.js do usavote
  const q = new URLSearchParams(location.search);
  q.set('uf', STATE.slug);
  q.set('scene', String(idx + 1));
  try { history.replaceState(null, '', `?${q.toString()}`); } catch {}
}

if (trackEl) {
  const stepFromEvent = e => {
    const r = trackEl.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    return Math.round(u * (STEPS.length - 1));
  };
  trackEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    stopAuto();
    trackEl.focus({ preventScroll: true });
    trackEl.setPointerCapture(e.pointerId);
    go(stepFromEvent(e));
  });
  trackEl.addEventListener('pointermove', e => {
    if (trackEl.hasPointerCapture(e.pointerId)) go(stepFromEvent(e));
  });
}

let timer = null;
const playBtn = document.getElementById('play');
function startAuto() {
  if (timer) return;
  playBtn.textContent = '⏸ Pausar';
  timer = setInterval(() => {
    if (idx < STEPS.length - 1) go(idx + 1);
    else stopAuto();
  }, 5500);
}
function stopAuto() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  playBtn.textContent = '▶ Auto';
}
playBtn.onclick = () => timer ? stopAuto() : startAuto();

document.getElementById('prev').onclick = () => { stopAuto(); go(idx - 1); };
document.getElementById('next').onclick = () => {
  stopAuto();
  if (idx === STEPS.length - 1) location.href = STATE.results.href;
  else go(idx + 1);
};
window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches?.('select, input, textarea')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stopAuto(); go(idx + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stopAuto(); go(idx - 1); }
  else if (e.key === 'Home') { e.preventDefault(); stopAuto(); go(0); }
  else if (e.key === 'End') { e.preventDefault(); stopAuto(); go(STEPS.length - 1); }
  else if (e.key === ' ' && (e.target === document.body || e.target === trackEl)) {
    e.preventDefault();
    playBtn.click();
  }
});

const cardToggleBtn = document.getElementById('cardToggleBtn');
const tourCard = document.getElementById('tourCard');
if (cardToggleBtn && tourCard) {
  cardToggleBtn.onclick = () => {
    const min = tourCard.classList.toggle('minimized');
    cardToggleBtn.textContent = min ? 'Expandir +' : 'Minimizar −';
    window.dispatchEvent(new Event('resize'));
  };
}

const startScene = parseInt(new URLSearchParams(location.search).get('scene') || '1', 10);
go(Number.isFinite(startScene) ? startScene - 1 : 0);
