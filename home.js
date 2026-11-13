// Mapa da página inicial original do usavote adaptado para a malha oficial do IBGE das 27 UFs
import { geoMercator, geoPath, geoCentroid } from 'd3-geo';
import { STATES } from './state.js';

const readyByCode = new Map(STATES.map(s => [s.code, s]));

const readyEl = document.getElementById('ready');
for (const s of STATES) {
  const card = document.createElement('div');
  card.className = 'state-card';
  card.id = 'card-' + s.slug;
  let views = `
    <a class="view first" href="${s.results.href}">
      <div class="view-title"><span>${s.results.title}</span><span class="go">Abrir →</span></div>
      <p>${s.results.desc}</p>
    </a>`;
  if (s.dots) {
    views += `
    <a class="view" href="${s.dots}">
      <div class="view-title"><span>Onde os eleitores moram (densidade de pontos)</span><span class="go">Abrir →</span></div>
      <p>Cada ponto é um grupo de eleitores em ${s.name}${s.tour ? ', com tour guiado de densidade demográfica' : ''}.</p>
    </a>`;
  }
  card.innerHTML = `
    <div class="kicker">${s.results.kicker}</div>
    <h2>${s.name}</h2>
    <p class="summary">${s.results.summary}</p>
    ${views}
  `;
  readyEl.appendChild(card);
}

const listEl = document.getElementById('list');
const sortedStates = [...STATES].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
for (const s of sortedStates) {
  const li = document.createElement('li');
  li.className = 'on';
  li.innerHTML = `<a href="${s.results.href}">${s.name} (${s.code})</a>`;
  listEl.appendChild(li);
}

const status = document.getElementById('status');
const defaultStatus = 'Clique em qualquer estado para abrir o mapa 3D interativo (27 de 27 UFs prontas).';
status.textContent = defaultStatus;

const geo = await fetch('data/br-ufs.json').then(r => r.json());
const states = geo.features || [];

const W = 720, H = 680;
const proj = geoMercator().fitSize([W - 24, H - 24], { type: 'FeatureCollection', features: states });
proj.translate([proj.translate()[0] + 12, proj.translate()[1] + 12]);
const path = geoPath(proj);

const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Mapa dos estados do Brasil');

const labelQueue = [];

for (const f of states) {
  const code = (f.properties?.sigla || f.id || '').toUpperCase();
  const s = readyByCode.get(code);
  const d = path(f);
  if (!d) continue;
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', s ? 'st on' : 'st soon');
  p.dataset.uf = (s ? s.slug : code.toLowerCase());
  if (s) {
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'link');
    p.setAttribute('aria-label', `${s.name} — abrir mapa`);
    const go = () => { location.href = s.results.href; };
    p.addEventListener('click', go);
    p.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    p.addEventListener('mouseenter', () => {
      status.innerHTML = `<b>${s.name} (${s.code})</b> — ${s.counties} ${s.slug === 'df' ? 'regiões administrativas' : 'municípios'} · clique para abrir o mapa interativo`;
    });
    const c = path.centroid(f);
    if (c && isFinite(c[0]) && isFinite(c[1])) {
      labelQueue.push({ code: s.code, x: c[0], y: c[1] });
    }
  } else {
    const c = geoCentroid(f);
    if (c) p.dataset.lon = c[0];
  }
  p.addEventListener('mouseleave', () => { status.textContent = defaultStatus; });
  svg.appendChild(p);
}

for (const l of labelQueue) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'st-name');
  t.setAttribute('x', l.x);
  t.setAttribute('y', l.y + 4);
  t.textContent = l.code;
  svg.appendChild(t);
}

document.getElementById('map').appendChild(svg);
