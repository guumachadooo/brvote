import * as THREE from 'three';
import { STATE } from './state.js';
import { createMap3D } from './map3d.js';

document.title = `Tour Guiado por ${STATE.name} — Como o Brasil Vota`;
document.getElementById('brand').innerHTML = `<b>${STATE.name}</b> · Um passeio de 60 segundos pelos municípios`;
document.getElementById('linkMisread').href = `misread.html?uf=${STATE.slug}`;
document.getElementById('linkExplore').href = STATE.results.href;

const stage = document.getElementById('stage');
const callouts = document.getElementById('callouts');
const map = await createMap3D(stage, { interactive: true });

const fmt = n => Math.round(n).toLocaleString('pt-BR');

// Encontrar o maior município (capital), o segundo maior e os 2 menores em votos
const raceId = STATE.defaultRace || '2026-pres-2t';
map.applyState({ raceId, raise: 0, colorMode: 'winner', split: false, dur: 10 });
const sortedByVotes = [...map.counties].filter(c => c.cur.tot > 0).sort((a, b) => b.cur.tot - a.cur.tot);
const big1 = sortedByVotes[0] || map.counties[0];
const big2 = sortedByVotes[1] || big1;
const small1 = sortedByVotes[sortedByVotes.length - 1] || big1;
const small2 = sortedByVotes[sortedByVotes.length - 2] || small1;

const totStateVotes = sortedByVotes.reduce((s, c) => s + c.cur.tot, 0);
const rCounties = sortedByVotes.filter(c => c.cur.r >= c.cur.d).length;
const dCounties = sortedByVotes.length - rCounties;

const STEPS = [
  {
    tag: 'Passo 1 de 6 · O mapa plano',
    headline: `Em um mapa plano, cada município de ${STATE.name} tem o mesmo peso visual.`,
    body: `${STATE.name} possui ${map.counties.length} ${STATE.slug === 'df' ? 'regiões administrativas' : 'municípios'}. Em um mapa tradicional pintado pelo vencedor, áreas extensas com poucos moradores ocupam a maior parte da tela.`,
    stats: [
      { k: 'Unidades vencidas pelo PL', v: `${rCounties} de ${sortedByVotes.length}`, cls: 'rep' },
      { k: 'Unidades vencidas pelo PT', v: `${dCounties} de ${sortedByVotes.length}`, cls: 'dem' },
      { k: 'Total de votos válidos', v: fmt(totStateVotes) },
    ],
    state: { raceId, raise: 0, colorMode: 'winner', split: false },
    cam:   { pos: [0, 285, 0.01], target: [0, 0, 0] },
    pins:  [],
  },
  {
    tag: `Passo 2 de 6 · Os menores colégios eleitorais`,
    headline: `${small1.name} registrou apenas ${fmt(small1.cur.tot)} votos válidos.`,
    body: `No mapa plano, municípios pequenos como ${small1.name} (${fmt(small1.cur.tot)} votos) e ${small2.name} (${fmt(small2.cur.tot)} votos) aparecem com a mesma intensidade de cor que uma metrópole inteira.`,
    stats: [
      { k: small1.name, v: `${fmt(small1.cur.tot)} votos` },
      { k: small2.name, v: `${fmt(small2.cur.tot)} votos` },
      { k: `Juntos em relação a ${big1.name}`, v: `${(( (small1.cur.tot + small2.cur.tot) / Math.max(1, big1.cur.tot) ) * 100).toFixed(2)}%` },
    ],
    state: { raceId, raise: 0, colorMode: 'margin', focus: [small1.name, small2.name], dimOthers: true },
    cam:   { pos: [small1.cx, 120, -small1.cy + 50], target: [small1.cx, 0, -small1.cy] },
    pins: [
      { county: small1.name, sub: `${fmt(small1.cur.tot)} votos no total` },
      { county: small2.name, sub: `${fmt(small2.cur.tot)} votos no total` },
    ],
  },
  {
    tag: `Passo 3 de 6 · O maior polo eleitoral (${big1.name})`,
    headline: `Um único município — ${big1.name} — concentrou ${fmt(big1.cur.tot)} votos.`,
    body: `${big1.name} sozinho representa ${((big1.cur.tot / Math.max(1, totStateVotes)) * 100).toFixed(1)}% de todos os votos do estado — mais do que dezenas de municípios do interior somados.`,
    stats: [
      { k: `Votos em ${big1.name}`, v: fmt(big1.cur.tot) },
      { k: 'Votos no PL', v: fmt(big1.cur.r), cls: 'rep' },
      { k: 'Votos no PT', v: fmt(big1.cur.d), cls: 'dem' },
    ],
    state: { raceId, raise: 0, colorMode: 'margin', focus: [big1.name, big2.name], dimOthers: true },
    cam:   { pos: [big1.cx, 115, -big1.cy + 55], target: [big1.cx, 0, -big1.cy] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
      { county: big2.name, sub: `${fmt(big2.cur.tot)} votos` },
    ],
  },
  {
    tag: 'Passo 4 de 6 · Erguendo o mapa pelos votos',
    headline: `Agora erguemos cada município pelo total de votos que depositou na urna.`,
    body: `Quando a altura passa a refletir o número de eleitores, a geografia real do voto aparece: grandes picos metropolitanos cercados por colinas regionais.`,
    stats: [
      { k: `Pico mais alto (${big1.name})`, v: `${fmt(big1.cur.tot)} votos` },
      { k: `Segundo pico (${big2.name})`, v: `${fmt(big2.cur.tot)} votos` },
      { k: `Menor coluna (${small1.name})`, v: `${fmt(small1.cur.tot)} votos` },
    ],
    state: { raceId, raise: 1, colorMode: 'margin', split: false },
    cam:   { pos: [18, 175, 215], target: [8, 12, 8] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
      { county: big2.name, sub: `${fmt(big2.cur.tot)} votos` },
    ],
  },
  {
    tag: 'Passo 5 de 6 · Nenhum município é 100% de um lado só',
    headline: `Divida cada coluna em dois e os eleitores da minoria local aparecem.`,
    body: `O candidato vencedor fica no topo de cada barra e o segundo colocado fica na base. Mesmo onde um partido vence com folga, centenas de milhares de vizinhos votaram no outro lado.`,
    stats: [
      { k: `PT em ${big1.name}`, v: fmt(big1.cur.d), cls: 'dem' },
      { k: `PL em ${big1.name}`, v: fmt(big1.cur.r), cls: 'rep' },
      { k: `Total estadual`, v: fmt(totStateVotes) },
    ],
    state: { raceId, raise: 1, colorMode: 'margin', split: true },
    cam:   { pos: [-25, 165, 210], target: [10, 14, 10] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.d)} PT · ${fmt(big1.cur.r)} PL` },
    ],
  },
  {
    tag: 'Passo 6 de 6 · Explore livremente',
    headline: `Gire, aproxime ou troque para qualquer disputa de 2026, 2022 ou 2018.`,
    body: `Arraste para girar o mapa em 3D, role para dar zoom, ou clique em "Explorar todos os cargos" para comparar Presidente, Governador, Senado e Deputados em todas as 27 UFs.`,
    stats: [
      { k: 'UFs disponíveis', v: 'Todas as 27 UFs' },
      { k: 'Eleições incluídas', v: '2026, 2022 e 2018' },
      { k: 'Malha geográfica', v: 'IBGE Oficial' },
    ],
    state: { raceId, raise: 1, colorMode: 'lead', split: true },
    cam:   { pos: [0, 205, 225], target: [0, 8, 6] },
    pins:  [],
  },
];

const dotsEl = document.getElementById('dots');
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
  activePins = (pins || []).map(p => {
    const c = map.getCounty(p.county);
    if (!c) return null;
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `
      <div class="box">${c.name}<span class="sub">${p.sub || ''}</span></div>
      <div class="stem"></div>
      <div class="dot-pin"></div>
    `;
    callouts.appendChild(el);
    return { c, el };
  }).filter(Boolean);
}

map.onTick(() => {
  for (const p of activePins) {
    const topY = p.c.curBot + p.c.curMid + p.c.curTop;
    const s = map.projectToScreen(new THREE.Vector3(p.c.cx, topY, -p.c.cy));
    p.el.style.display = s.visible ? 'block' : 'none';
    p.el.style.left = s.x + 'px';
    p.el.style.top  = s.y + 'px';
  }
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
  document.getElementById('prev').disabled = idx === 0;
  const nextBtn = document.getElementById('next');
  if (idx === STEPS.length - 1) {
    nextBtn.textContent = 'Abrir explorador completo →';
  } else {
    nextBtn.textContent = 'Próximo →';
  }
  map.applyState(s.state);
  map.setCamera(s.cam);
  rebuildPins(s.pins);
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
  playBtn.textContent = '▶ Reproduzir automaticamente';
}
playBtn.onclick = () => timer ? stopAuto() : startAuto();

document.getElementById('prev').onclick = () => { stopAuto(); go(idx - 1); };
document.getElementById('next').onclick = () => {
  stopAuto();
  if (idx === STEPS.length - 1) location.href = STATE.results.href;
  else go(idx + 1);
};
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ') { stopAuto(); go(idx + 1); }
  if (e.key === 'ArrowLeft') { stopAuto(); go(idx - 1); }
});

go(0);
