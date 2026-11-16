import * as THREE from 'three';
import { STATE } from './state.js';
import { createMap3D } from './map3d.js';

const isBR = STATE.slug === 'br';
const unitSing = isBR ? 'estado' : (STATE.slug === 'df' ? 'região administrativa' : 'município');

document.title = `Três Formas pelas Quais um Mapa Eleitoral Engana (${STATE.name})`;
document.getElementById('linkStory').href = `story.html?uf=${STATE.slug}`;
document.getElementById('linkShade').href = `shade-by-votes.html?uf=${STATE.slug}`;
document.getElementById('linkExplore').href = STATE.results.href;
document.getElementById('ctaExplore').href = STATE.results.href;

const stage = document.getElementById('stage');
const callouts = document.getElementById('callouts');
const captionBar = document.getElementById('captionBar');
const map = await createMap3D(stage, { interactive: true });

const fmt = n => Math.round(n).toLocaleString('pt-BR');
const raceId = STATE.defaultRace || '2026-pres-2t';
map.applyState({ raceId, raise: 0, colorMode: 'winner', split: false, dur: 10 });

const sortedByVotes = [...map.counties].filter(c => c.cur.tot > 0).sort((a, b) => b.cur.tot - a.cur.tot);
const big1 = sortedByVotes[0] || map.counties[0];
const big2 = sortedByVotes[1] || big1;
const small1 = sortedByVotes[sortedByVotes.length - 1] || big1;

document.getElementById('cmp0').innerHTML = `
  <div class="row"><span><b>${big1.name}</b> (maior ${unitSing})</span><b>${fmt(big1.cur.tot)} votos</b></div>
  <div class="row"><span><b>${small1.name}</b> (menor ${unitSing})</span><b>${fmt(small1.cur.tot)} votos</b></div>
`;
document.getElementById('cmp1').innerHTML = `
  <div class="row"><span>${big1.name} · Votos no PT</span><b class="dem">${fmt(big1.cur.d)}</b></div>
  <div class="row"><span>${big1.name} · Votos no PL</span><b class="rep">${fmt(big1.cur.r)}</b></div>
  <div class="row"><span>${big2.name} · Votos no PT / PL</span><b>${fmt(big2.cur.d)} / ${fmt(big2.cur.r)}</b></div>
`;
const leadBig = Math.abs(big1.cur.r - big1.cur.d);
const leadSmall = Math.abs(small1.cur.r - small1.cur.d);
document.getElementById('cmp2').innerHTML = `
  <div class="row"><span><b>${small1.name}</b> · saldo líquido</span><b>${fmt(leadSmall)} votos</b></div>
  <div class="row"><span><b>${big1.name}</b> · saldo líquido</span><b>${fmt(leadBig)} votos</b></div>
`;

const CONFIGS = [
  {
    caption: `<b>Mapa plano de vencedor único</b> — cada ${unitSing} recebe cor sólida pelo 1º colocado, independente de ter ${fmt(small1.cur.tot)} ou ${fmt(big1.cur.tot)} votos.`,
    state: { raceId, raise: 0, colorMode: 'winner', split: false },
    cam:   { pos: [0, 325, 0.01], target: [0, 0, 0] },
    pins: [
      { county: small1.name, sub: `${fmt(small1.cur.tot)} votos` },
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
    ],
  },
  {
    caption: `<b>Colunas erguidas e divididas</b> — o candidato vencedor fica no topo e os votos do 2º colocado ficam visíveis na base de cada ${unitSing}.`,
    state: { raceId, raise: 1, colorMode: 'winner', split: true },
    cam:   { pos: [-22, 205, 248], target: [4, 12, 6] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.d)} PT · ${fmt(big1.cur.r)} PL` },
      { county: big2.name, sub: `${fmt(big2.cur.d)} PT · ${fmt(big2.cur.r)} PL` },
    ],
  },
  {
    caption: `<b>Colorido pela margem % (padrão)</b> — clique no botão ao lado para trocar para <b>saldo absoluto de votos</b> e ver onde os votos realmente se acumulam.`,
    state: { raceId, raise: 0, colorMode: 'margin', split: false },
    cam:   { pos: [0, 325, 0.01], target: [0, 0, 0] },
    pins: [
      { county: small1.name, sub: `saldo de ${fmt(leadSmall)} votos` },
      { county: big1.name, sub: `saldo de ${fmt(leadBig)} votos` },
    ],
  },
  {
    caption: `<b>As três correções juntas</b> — altura = total de votos, coluna dividida = ambos os lados, intensidade da cor = saldo líquido de votos.`,
    state: { raceId, raise: 1, colorMode: 'lead', split: true },
    cam:   { pos: [14, 215, 252], target: [4, 10, 6] },
    pins: [
      { county: big1.name, sub: `${fmt(big1.cur.tot)} votos` },
      { county: big2.name, sub: `${fmt(big2.cur.tot)} votos` },
    ],
  },
];

let curStep = 0;
let curState = { ...CONFIGS[0].state };
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

map.onTick(() => {
  const sw = stage.clientWidth || 800;
  const sh = stage.clientHeight || 600;
  const vis = [];
  for (const p of activePins) {
    const topY = p.c.curBot + p.c.curMid + p.c.curTop;
    const s = map.projectToScreen(new THREE.Vector3(p.c.cx, topY, -p.c.cy));
    if (!s.visible) {
      p.el.style.display = 'none';
      continue;
    }
    p.sx = s.x;
    p.sy = s.y;
    p.el.style.display = 'block';
    p.el.style.left = `${s.x}px`;
    p.el.style.top  = `${s.y}px`;
    p.w = p.box.offsetWidth || 152;
    p.h = p.box.offsetHeight || 42;
    p.dx = 0;
    p.dy = -22;
    p.place = 'above';
    vis.push(p);
  }
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
  const topPad = 56;
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
});

const stepEls = [...document.querySelectorAll('.step')];

function selectStep(i) {
  curStep = i;
  stepEls.forEach((el, idx) => el.classList.toggle('on', idx === i));
  const cfg = CONFIGS[i];
  curState = { ...cfg.state };
  captionBar.innerHTML = cfg.caption;
  map.applyState(curState);
  map.setCamera(cfg.cam);
  rebuildPins(cfg.pins);
}

stepEls.forEach((el, i) => {
  el.addEventListener('click', e => {
    if (e.target.closest('button, a')) return;
    selectStep(i);
  });
});

document.querySelectorAll('button.try').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const act = btn.dataset.action;
    if (act === 'toggle-raise') {
      if (curStep !== 0) selectStep(0);
      const nextRaise = curState.raise > 0.5 ? 0 : 1;
      curState.raise = nextRaise;
      map.applyState(curState);
      map.setCamera(nextRaise > 0.5
        ? { pos: [16, 215, 252], target: [4, 10, 6] }
        : { pos: [0, 325, 0.01], target: [0, 0, 0] });
      captionBar.innerHTML = nextRaise > 0.5
        ? `<b>Erguido pelo total de votos</b> — as unidades com menos eleitores encolhem para sua escala real e ${big1.name} se ergue.`
        : CONFIGS[0].caption;
    } else if (act === 'toggle-split') {
      if (curStep !== 1) selectStep(1);
      curState.split = !curState.split;
      curState.raise = 1;
      map.applyState(curState);
      captionBar.innerHTML = curState.split
        ? CONFIGS[1].caption
        : `<b>Coluna de cor única</b> — toda a coluna recebe a cor do vencedor, escondendo os eleitores do 2º colocado.`;
    } else if (act === 'toggle-color') {
      if (curStep !== 2) selectStep(2);
      curState.colorMode = curState.colorMode === 'lead' ? 'margin' : 'lead';
      map.applyState(curState);
      captionBar.innerHTML = curState.colorMode === 'lead'
        ? `<b>Colorido pelo saldo líquido de votos</b> — locais com poucos votos ficam neutros; a cor viva destaca onde há grande vantagem em número absoluto de eleitores.`
        : CONFIGS[2].caption;
    }
  });
});

const rail = document.getElementById('rail');
rail.addEventListener('scroll', () => {
  const rect = rail.getBoundingClientRect();
  const mid = rect.top + rect.height * 0.38;
  let best = curStep, bestDist = Infinity;
  stepEls.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const c = (r.top + r.bottom) / 2;
    const d = Math.abs(c - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  if (best !== curStep) selectStep(best);
});

selectStep(0);
