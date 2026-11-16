import * as THREE from 'three';
import { STATE } from './state.js';
import { createMap3D } from './map3d.js';
import { marginColorHex, leadColorHex } from './colors.js';

document.title = `E se Pintarmos ${STATE.name} pelo Saldo de Votos?`;
document.getElementById('linkStory').href = `story.html?uf=${STATE.slug}`;
document.getElementById('linkMisread').href = `misread.html?uf=${STATE.slug}`;
document.getElementById('linkExplore').href = STATE.results.href;
document.getElementById('ctaExplore').href = STATE.results.href;

const stage = document.getElementById('stage');
const callouts = document.getElementById('callouts');
const captionBar = document.getElementById('captionBar');
const explain = document.getElementById('explain');
const liftBtn = document.getElementById('liftBtn');

const map = await createMap3D(stage, { interactive: true });
const fmt = n => Math.round(n).toLocaleString('pt-BR');

const raceId = STATE.defaultRace || '2026-pres-2t';
map.applyState({ raceId, raise: 0, colorMode: 'winner', split: false, dur: 10 });

const sortedByVotes = [...map.counties].filter(c => c.cur.tot > 0).sort((a, b) => b.cur.tot - a.cur.tot);
const big1 = sortedByVotes[0] || map.counties[0];
const small1 = sortedByVotes[sortedByVotes.length - 1] || big1;

let maxLead = 1;
for (const c of map.counties) {
  const l = Math.abs(c.cur.r - c.cur.d);
  if (l > maxLead) maxLead = l;
}

const smallLead = Math.abs(small1.cur.r - small1.cur.d);
const bigLead = Math.abs(big1.cur.r - big1.cur.d);
const smallPct = small1.cur.tot ? ((Math.max(small1.cur.r, small1.cur.d) / small1.cur.tot) * 100).toFixed(0) : '60';
const bigPct = big1.cur.tot ? ((Math.max(big1.cur.r, big1.cur.d) / big1.cur.tot) * 100).toFixed(0) : '55';

document.getElementById('pairCards').innerHTML = `
  <div class="ex">
    <div class="ex-head"><b>${small1.name}</b><span>${fmt(small1.cur.tot)} votos</span></div>
    <div class="ex-body">Venceu com <b>${smallPct}%</b> — uma margem percentual alta, mas que representa um saldo líquido de apenas <b>${fmt(smallLead)} votos</b>.</div>
    <div class="sw-row">
      <div><span>Vencedor</span><i id="sw-k-win"></i></div>
      <div><span>Margem %</span><i id="sw-k-mar"></i></div>
      <div><span>Saldo de votos</span><i id="sw-k-lead"></i></div>
    </div>
  </div>
  <div class="ex">
    <div class="ex-head"><b>${big1.name}</b><span>${fmt(big1.cur.tot)} votos</span></div>
    <div class="ex-body">Venceu com <b>${bigPct}%</b> — uma margem percentual moderada, mas que entrega um saldo líquido decisivo de <b>${fmt(bigLead)} votos</b>.</div>
    <div class="sw-row">
      <div><span>Vencedor</span><i id="sw-t-win"></i></div>
      <div><span>Margem %</span><i id="sw-t-mar"></i></div>
      <div><span>Saldo de votos</span><i id="sw-t-lead"></i></div>
    </div>
  </div>
`;

document.getElementById('sw-k-win').style.background  = small1.cur.r >= small1.cur.d ? '#3b5bdb' : '#d72f30';
document.getElementById('sw-k-mar').style.background  = marginColorHex(small1.cur.r, small1.cur.d);
document.getElementById('sw-k-lead').style.background = leadColorHex(small1.cur.r, small1.cur.d, maxLead);

document.getElementById('sw-t-win').style.background  = big1.cur.r >= big1.cur.d ? '#3b5bdb' : '#d72f30';
document.getElementById('sw-t-mar').style.background  = marginColorHex(big1.cur.r, big1.cur.d);
document.getElementById('sw-t-lead').style.background = leadColorHex(big1.cur.r, big1.cur.d, maxLead);

const MODES = {
  winner: {
    title: '1 · Vencedor leva a cor (o mapa padrão de TV)',
    body: `Todo município vencido pelo PL recebe o mesmo azul; todo município vencido pelo PT recebe o mesmo vermelho. Um município com ${fmt(small1.cur.tot)} votos grita tão alto quanto ${big1.name} com ${fmt(big1.cur.tot)} votos.`,
    caption: `<b>Mapa de vencedor único</b> — cada município recebe cor sólida de acordo com quem terminou em 1º lugar.`,
  },
  margin: {
    title: '2 · Pintado pela margem percentual (a tentativa comum que piora a distorção)',
    body: `Pintar pela margem em pontos percentuais dá os tons mais escuros e saturados aos menores municípios rurais e deixa os grandes centros urbanos pálidos — porque cidades grandes raramente votam 85–15.`,
    caption: `<b>Pintado pela margem %</b> — os municípios menos populosos ganham as cores mais fortes; as metrópoles desbotam.`,
  },
  lead: {
    title: '3 · Pintado pelo saldo líquido de votos (a correção em 2D)',
    body: `Aqui a saturação da cor é proporcional a <b>|votos do 1º − votos do 2º|</b>. Municípios onde o saldo líquido é de poucos milhares de votos ficam próximos ao neutro escuro; apenas os lugares onde um candidato acumulou dezenas ou centenas de milhares de votos de frente brilham em vermelho ou azul vivo.`,
    caption: `<b>Pintado pelo saldo de votos</b> — continua 100% plano, mas seu olhar vai direto para onde os votos de vantagem realmente estão.`,
  },
};

const PINS = [
  { county: small1.name, sub: `saldo de ${fmt(smallLead)} votos` },
  { county: big1.name,   sub: `saldo de ${fmt(bigLead)} votos` },
];

let curMode = 'winner';
let lifted = false;
let activePins = [];

function rebuildPins() {
  callouts.innerHTML = '';
  map.setPins(PINS);
  activePins = PINS.map(p => {
    const c = map.getCounty(p.county);
    if (!c) return null;
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<div class="box">${c.name}<span class="sub">${p.sub}</span></div>`;
    callouts.appendChild(el);
    return { c, el };
  }).filter(Boolean);
}
rebuildPins();

map.onTick(() => {
  for (const p of activePins) {
    const topY = p.c.curBot + p.c.curMid + p.c.curTop;
    const s = map.projectToScreen(new THREE.Vector3(p.c.cx, topY, -p.c.cy));
    p.el.style.display = s.visible ? 'block' : 'none';
    p.el.style.left = s.x + 'px';
    p.el.style.top  = s.y + 'px';
  }
});

function apply() {
  const m = MODES[curMode];
  explain.innerHTML = `<h3>${m.title}</h3><p>${m.body}</p>`;
  captionBar.innerHTML = m.caption;
  document.querySelectorAll('.mode').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === curMode);
  });
  map.applyState({
    raceId,
    raise: lifted ? 1 : 0,
    colorMode: curMode,
    split: false,
  });
}

document.querySelectorAll('.mode').forEach(btn => {
  btn.onclick = () => {
    curMode = btn.dataset.mode;
    apply();
  };
});

liftBtn.onclick = () => {
  lifted = !lifted;
  liftBtn.classList.toggle('on', lifted);
  liftBtn.textContent = lifted ? 'Voltar ao mapa plano 2D' : 'Inclinar para 3D';
  map.applyState({
    raceId,
    raise: lifted ? 1 : 0,
    colorMode: curMode,
    split: false,
  });
  map.setCamera(lifted
    ? { pos: [14, 215, 252], target: [4, 10, 6] }
    : { pos: [0, 325, 0.01], target: [0, 0, 0] });
};

apply();
map.setCamera({ pos: [0, 325, 0.01], target: [0, 0, 0], dur: 0 });
