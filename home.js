// Mapa da página inicial do usavote adaptado para a malha oficial do IBGE das 27 UFs + Placar Nacional TSE 2026
import { geoMercator, geoPath } from 'd3-geo';
import { STATES } from './state.js';
import { marginColorHex, leadColorHex, shiftColorHex, REP_C, DEM_C } from './colors.js';

const fmt = n => Math.round(n).toLocaleString('pt-BR');

const readyByCode = new Map(STATES.map(s => [s.code, s]));
const sortedStates = [...STATES].sort((a, b) => {
  if (a.code === 'BR') return -1;
  if (b.code === 'BR') return 1;
  return a.name.localeCompare(b.name, 'pt-BR');
});

const [geo, nat] = await Promise.all([
  fetch('data/br-ufs.json').then(r => r.json()),
  fetch('data/national-summary.json').then(r => r.json()).catch(() => null),
]);

// Renderiza Placar Nacional 2026 (2º Turno Presidencial Oficial TSE)
const natScoreEl = document.getElementById('natScore');
if (nat && natScoreEl) {
  const r2t = nat.totals.pres2t.R;
  const d2t = nat.totals.pres2t.D;
  const tot2t = r2t + d2t;
  const rPct = (r2t / tot2t) * 100;
  const dPct = (d2t / tot2t) * 100;
  natScoreEl.innerHTML = `
    <div class="nat-score-head">
      <span><b>Brasil 2026 · Presidente (2º Turno)</b> — ${fmt(tot2t)} votos válidos em 5.570 municípios</span>
      <span><b class="dem-t">Lula (PT) ${dPct.toFixed(1)}%</b> (${fmt(d2t)}) · <b class="rep-t">Flávio Bolsonaro (PL) ${rPct.toFixed(1)}%</b> (${fmt(r2t)})</span>
    </div>
    <div class="bar">
      <div class="r" style="width:${rPct.toFixed(2)}%">${rPct.toFixed(1)}% Flávio Bolsonaro (PL)</div>
      <div class="d" style="width:${dPct.toFixed(2)}%">Lula (PT) ${dPct.toFixed(1)}%</div>
    </div>
  `;
}

let activeColorMode = 'margin'; // 'margin' | 'lead' | 'shift' | 'gold'
let activeRegion = 'all';
let selectedState = readyByCode.get('BR') || readyByCode.get('MG') || STATES[0];

const readyEl = document.getElementById('ready');
readyEl.innerHTML = `
  <div class="state-picker-bar">
    <label for="homeStateSelect">Recorte em destaque</label>
    <select id="homeStateSelect" aria-label="Escolher Brasil inteiro ou estado em destaque">
      ${sortedStates.map(s => `<option value="${s.code}" ${s.code === selectedState.code ? 'selected' : ''}>${s.code === 'BR' ? 'Brasil (Nacional)' : `${s.name} (${s.code})`}</option>`).join('')}
    </select>
  </div>
  <div id="featuredCard"></div>
`;

const homeStateSelect = document.getElementById('homeStateSelect');
const featuredCardEl = document.getElementById('featuredCard');

function renderFeaturedCard(s) {
  selectedState = s;
  if (homeStateSelect && homeStateSelect.value !== s.code) {
    homeStateSelect.value = s.code;
  }
  const isBR = s.code === 'BR';
  const stNat = isBR ? null : (nat && nat.states && nat.states[s.code]);
  let metricsHtml = '';
  let govLine = '';

  if (isBR && nat && nat.totals) {
    const r = nat.totals.pres2t.R || 0;
    const d = nat.totals.pres2t.D || 0;
    const tot = r + d || 1;
    const rWin = r >= d;
    const winPct = ((Math.max(r, d) / tot) * 100).toFixed(1);
    const winLabel = rWin ? `<span class="rep-t">PL ${winPct}%</span>` : `<span class="dem-t">PT ${winPct}%</span>`;
    const totalAptos = Object.values(nat.states || {}).reduce((acc, st) => acc + (st.aptos || 0), 0);
    metricsHtml = `
      <div class="state-metrics">
        <div class="state-metric">
          <span>Pres. 2026 (2ºT)</span>
          <b>${winLabel}</b>
        </div>
        <div class="state-metric">
          <span>Eleitores aptos</span>
          <b>${fmt(totalAptos || 156454011)}</b>
        </div>
        <div class="state-metric">
          <span>Unidades no 3D</span>
          <b>27 UFs (5.570 mun.)</b>
        </div>
      </div>
    `;
    govLine = `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Mapa 3D nacional completo: compare os 27 estados em colunas 3D, pontos de eleitores, jarros 3D ou tour guiado.</div>`;
  } else if (stNat) {
    const p2t = stNat.pres2t;
    const tot = (p2t.R || 0) + (p2t.D || 0);
    const rWin = p2t.R >= p2t.D;
    const winPct = tot ? ((Math.max(p2t.R, p2t.D) / tot) * 100).toFixed(1) : '0.0';
    const winLabel = rWin ? `<span class="rep-t">PL ${winPct}%</span>` : `<span class="dem-t">PT ${winPct}%</span>`;
    metricsHtml = `
      <div class="state-metrics">
        <div class="state-metric">
          <span>Pres. 2026 (2ºT)</span>
          <b>${winLabel}</b>
        </div>
        <div class="state-metric">
          <span>Eleitores aptos</span>
          <b>${fmt(stNat.aptos)}</b>
        </div>
        <div class="state-metric">
          <span>${s.slug === 'df' ? 'Zonas Eleitorais' : 'Municípios'}</span>
          <b>${fmt(s.counties)}</b>
        </div>
      </div>
    `;
    if (stNat.gov) {
      const gTot = (stNat.gov.R || 0) + (stNat.gov.D || 0) + (stNat.gov.O || 0) || 1;
      const gWin = stNat.gov.R >= stNat.gov.D ? stNat.gov.rep : stNat.gov.dem;
      const gCls = stNat.gov.R >= stNat.gov.D ? 'rep-t' : 'dem-t';
      const gPct = ((Math.max(stNat.gov.R, stNat.gov.D) / gTot) * 100).toFixed(1);
      govLine = `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Governador 2026: <b class="${gCls}">${gWin}</b> (${gPct}% dos votos válidos)</div>`;
    }
  }

  featuredCardEl.innerHTML = `
    <div class="state-card">
      <div class="kicker">${s.results.kicker}${stNat ? ` · Região ${stNat.region}` : ''}</div>
      <h2>${s.code === 'BR' ? 'Brasil (Nacional)' : `${s.name} (${s.code})`}</h2>
      <p class="summary">${s.results.summary}</p>
      ${metricsHtml}
      ${govLine}
      <a class="view first" href="${s.results.href}">
        <div class="view-title"><span>${s.results.title}</span><span class="go">Abrir 3D →</span></div>
        <p>${s.results.desc}</p>
      </a>
      <a class="view" href="${s.dots}">
        <div class="view-title"><span>Onde os eleitores moram (densidade de pontos)</span><span class="go">Abrir →</span></div>
        <p>Cada ponto é um grupo real de eleitores em ${s.name}, com tour guiado pelas regiões.</p>
      </a>
      <div class="state-quick-links">
        <a href="story.html?uf=${s.slug}">Tour 60s</a>
        <a href="volume.html?uf=${s.slug}&step=fill">Volume / Jarros 3D</a>
        <a href="misread.html?uf=${s.slug}">Erros do mapa plano</a>
        <a href="shade-by-votes.html?uf=${s.slug}">Pintar por saldo</a>
        <a href="compare.html?uf=${s.slug}">Comparar ⇆</a>
      </div>
    </div>
  `;

  document.querySelectorAll('#map .st').forEach(el => {
    el.classList.toggle('selected', el.dataset.code === s.code);
  });
}

homeStateSelect.onchange = () => {
  const s = readyByCode.get(homeStateSelect.value);
  if (s) renderFeaturedCard(s);
};

const listEl = document.getElementById('list');
const allTitleEl = document.getElementById('allTitle');

function renderStateList() {
  const filtered = sortedStates.filter(s => {
    if (activeRegion === 'all') return true;
    if (s.code === 'BR') return false;
    const stNat = nat && nat.states && nat.states[s.code];
    return stNat && stNat.region === activeRegion;
  });
  if (allTitleEl) {
    allTitleEl.textContent = activeRegion === 'all'
      ? 'Brasil Inteiro + todos os 27 estados e o Distrito Federal'
      : `Estados da Região ${activeRegion} (${filtered.length})`;
  }
  listEl.innerHTML = filtered.map(s => {
    let badge = '';
    if (s.code === 'BR' && nat && nat.totals) {
      const r = nat.totals.pres2t.R || 0, d = nat.totals.pres2t.D || 0;
      const tot = r + d || 1;
      const m = ((r - d) / tot) * 100;
      const rWin = m >= 0;
      badge = `<span class="st-badge ${rWin ? 'pill-r' : 'pill-d'}">${rWin ? 'PL+' : 'PT+'}${Math.abs(m).toFixed(1)}%</span>`;
    } else {
      const stNat = nat && nat.states && nat.states[s.code];
      if (stNat && stNat.pres2t) {
        const r = stNat.pres2t.R || 0, d = stNat.pres2t.D || 0;
        const tot = r + d || 1;
        const m = ((r - d) / tot) * 100;
        const rWin = m >= 0;
        badge = `<span class="st-badge ${rWin ? 'pill-r' : 'pill-d'}">${rWin ? 'PL+' : 'PT+'}${Math.abs(m).toFixed(1)}%</span>`;
      }
    }
    return `<li class="on"><a href="${s.results.href}">${s.code === 'BR' ? 'Brasil (Nacional)' : `${s.name} (${s.code})`}</a>${badge}</li>`;
  }).join('');
}

const status = document.getElementById('status');
const defaultStatus = 'Passe o mouse em um estado para ver o resumo · Clique no estado para abrir seus municípios em 3D, ou use os botões acima para o Brasil inteiro em 3D.';
status.textContent = defaultStatus;

const states = geo.features || [];
const W = 720, H = 680;
const proj = geoMercator().fitSize([W - 24, H - 24], { type: 'FeatureCollection', features: states });
proj.translate([proj.translate()[0] + 12, proj.translate()[1] + 12]);
const path = geoPath(proj);

const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Mapa eleitoral dos estados do Brasil');

const labelQueue = [];
const pathByCode = new Map();
const labelByCode = new Map();

let maxStateLead = 1;
if (nat && nat.states) {
  for (const st of Object.values(nat.states)) {
    const lead = Math.abs((st.pres2t.R || 0) - (st.pres2t.D || 0));
    if (lead > maxStateLead) maxStateLead = lead;
  }
}

for (const f of states) {
  const code = (f.properties?.sigla || f.id || '').toUpperCase();
  const s = readyByCode.get(code);
  const d = path(f);
  if (!d) continue;
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', 'st on');
  p.dataset.uf = s ? s.slug : code.toLowerCase();
  p.dataset.code = code;

  if (s) {
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    p.setAttribute('aria-label', `${s.name} — ver resultados`);

    p.addEventListener('click', e => {
      if (window.innerWidth <= 860 && selectedState.code !== s.code) {
        e.preventDefault();
        renderFeaturedCard(s);
        status.innerHTML = `<b>${s.name} (${s.code})</b> selecionado — toque novamente no estado ou clique em "Abrir 3D →" abaixo.`;
        return;
      }
      location.href = s.results.href;
    });
    p.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.href = s.results.href;
      }
    });
    p.addEventListener('mouseenter', () => {
      renderFeaturedCard(s);
      const stNat = nat && nat.states && nat.states[code];
      if (stNat && stNat.pres2t) {
        const r = stNat.pres2t.R, dV = stNat.pres2t.D, tot = r + dV || 1;
        const win = r >= dV ? `Flávio Bolsonaro (PL) ${((r / tot) * 100).toFixed(1)}%` : `Lula (PT) ${((dV / tot) * 100).toFixed(1)}%`;
        status.innerHTML = `<b>${s.name} (${s.code})</b> · 2026 2ºT: <b>${win}</b> · ${s.counties} ${s.slug === 'df' ? 'zonas' : 'municípios'} — clique para abrir o mapa 3D`;
      } else {
        status.innerHTML = `<b>${s.name} (${s.code})</b> — ${s.counties} municípios · clique para abrir o mapa 3D`;
      }
    });
    const c = path.centroid(f);
    if (c && isFinite(c[0]) && isFinite(c[1])) {
      labelQueue.push({ code: s.code, x: c[0], y: c[1] });
    }
  }
  p.addEventListener('mouseleave', () => { status.textContent = defaultStatus; });
  svg.appendChild(p);
  pathByCode.set(code, p);
}

for (const l of labelQueue) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'st-name');
  t.setAttribute('x', l.x);
  t.setAttribute('y', l.y);
  t.textContent = l.code;
  svg.appendChild(t);
  labelByCode.set(l.code, t);
}

document.getElementById('map').appendChild(svg);

const mapLegendEl = document.getElementById('mapLegend');

function updateMapColors() {
  for (const [code, p] of pathByCode.entries()) {
    const stNat = nat && nat.states && nat.states[code];
    const inRegion = activeRegion === 'all' || (stNat && stNat.region === activeRegion);
    p.classList.toggle('dim', !inRegion);
    const lbl = labelByCode.get(code);
    if (lbl) {
      lbl.classList.toggle('dim', !inRegion);
      lbl.classList.toggle('dark', activeColorMode === 'gold');
    }

    if (!stNat) {
      p.style.fill = '#252c38';
      continue;
    }
    const r = stNat.pres2t.R || 0;
    const d = stNat.pres2t.D || 0;
    if (activeColorMode === 'gold') {
      p.style.fill = '#10b981';
    } else if (activeColorMode === 'lead') {
      p.style.fill = leadColorHex(r, d, maxStateLead);
    } else if (activeColorMode === 'shift') {
      const r22 = stNat.pres2022?.R || 0, d22 = stNat.pres2022?.D || 0;
      const m26 = (r + d) ? (r - d) / (r + d) : 0;
      const m22 = (r22 + d22) ? (r22 - d22) / (r22 + d22) : 0;
      p.style.fill = shiftColorHex(m26 - m22);
    } else {
      p.style.fill = marginColorHex(r, d);
    }
  }

  if (mapLegendEl) {
    if (activeColorMode === 'gold') {
      mapLegendEl.innerHTML = `<span>Todos os 27 estados prontos com dados oficiais TSE (2018–2026) e malha IBGE</span>`;
    } else if (activeColorMode === 'lead') {
      mapLegendEl.innerHTML = `
        <span class="map-legend-sw"><i style="background:${REP_C[3]}"></i> Maior saldo PL</span>
        <span>Intensidade = vantagem absoluta de votos no estado (2º Turno 2026)</span>
        <span class="map-legend-sw"><i style="background:${DEM_C[3]}"></i> Maior saldo PT</span>
      `;
    } else if (activeColorMode === 'shift') {
      mapLegendEl.innerHTML = `
        <span class="map-legend-sw"><i style="background:${REP_C[3]}"></i> Giro para o PL (2022→2026)</span>
        <span>Mudança na margem presidencial estadual desde 2022</span>
        <span class="map-legend-sw"><i style="background:${DEM_C[3]}"></i> Giro para o PT (2022→2026)</span>
      `;
    } else {
      mapLegendEl.innerHTML = `
        <span class="map-legend-sw"><i style="background:${REP_C[3]}"></i> Vantagem Flávio Bolsonaro (PL)</span>
        <span>Margem no 2º Turno Presidencial de 2026</span>
        <span class="map-legend-sw"><i style="background:${DEM_C[3]}"></i> Vantagem Lula (PT)</span>
      `;
    }
  }
}

document.querySelectorAll('#mapColorSwitch button').forEach(btn => {
  btn.onclick = () => {
    activeColorMode = btn.dataset.mode;
    document.querySelectorAll('#mapColorSwitch button').forEach(b => b.classList.toggle('active', b === btn));
    updateMapColors();
  };
});

document.querySelectorAll('#regionSwitch button').forEach(btn => {
  btn.onclick = () => {
    activeRegion = btn.dataset.reg;
    document.querySelectorAll('#regionSwitch button').forEach(b => b.classList.toggle('active', b === btn));
    updateMapColors();
    renderStateList();
    if (activeRegion !== 'all') {
      const firstInReg = sortedStates.find(s => nat?.states?.[s.code]?.region === activeRegion);
      if (firstInReg && nat?.states?.[selectedState.code]?.region !== activeRegion) {
        renderFeaturedCard(firstInReg);
      }
    } else {
      const brState = readyByCode.get('BR');
      if (brState) renderFeaturedCard(brState);
    }
  };
});

renderFeaturedCard(selectedState);
renderStateList();
updateMapColors();
