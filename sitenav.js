// Barra superior de navegação original do usavote com Brasil Inteiro + todas as 27 UFs + Alternador de Layout (Modo Simples vs. Avançado)
import { STATES, STATE } from './state.js';

function checkIsFramed() {
  if (/^pane[AB]$|^frame[AB]$/i.test(window.name || '')) return true;
  if (new URLSearchParams(location.search).get('framed') === '1') return true;
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

const ready = [...STATES].sort((a, b) => {
  if (a.slug === 'br') return -1;
  if (b.slug === 'br') return 1;
  return a.name.localeCompare(b.name, 'pt-BR');
});

const bar = document.createElement('div');
bar.className = 'site-nav';

const options = ready.map(s => {
  const lbl = s.slug === 'br' ? 'Brasil (Nacional)' : `${s.name} (${s.code})`;
  return `<option value="${s.slug}" ${s.slug === STATE.slug ? 'selected' : ''}>${lbl}</option>`;
}).join('');

const savedMode = (() => {
  try { return localStorage.getItem('brvote_ui_mode') || 'simple'; } catch { return 'simple'; }
})();

function applyUiMode(mode) {
  const m = mode === 'advanced' ? 'advanced' : 'simple';
  document.body.classList.toggle('ui-simple', m === 'simple');
  document.body.classList.toggle('ui-advanced', m === 'advanced');
  try { localStorage.setItem('brvote_ui_mode', m); } catch {}
  document.querySelectorAll('.ui-mode-btn').forEach(btn => {
    const on = btn.dataset.uimode === m;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  window.dispatchEvent(new CustomEvent('brvote-uimode', { detail: { mode: m } }));
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
window.setBrVoteUiMode = applyUiMode;

bar.innerHTML =
  `<a class="home-link" href="index.html">← Mapa do Brasil</a>` +
  `<span class="nav-sep">·</span>` +
  `<label class="state-Jump"><span>Recorte</span><select aria-label="Pular para estado ou Brasil inteiro">${options}</select></label>` +
  `<div class="ui-mode-switch" role="group" aria-label="Nível de detalhe da interface" title="Escolha entre o layout Simples (intuitivo, sem excesso de botões) ou Avançado (com filtros e personalização completa)">` +
    `<span class="ui-mode-lbl">Layout:</span>` +
    `<button type="button" class="ui-mode-btn" data-uimode="simple">Simples</button>` +
    `<button type="button" class="ui-mode-btn" data-uimode="advanced">Avançado</button>` +
  `</div>` +
  `<a class="volume-top" href="volume.html?uf=${STATE.slug}" title="Ver experimento Votos como Volume 3D e Jarros despejando votos">Volume &amp; Jarros 3D →</a>` +
  `<a class="why-top" href="why.html">Por que mapear votos assim? →</a>`;

const sel = bar.querySelector('select');
sel.onchange = () => {
  const target = ready.find(s => s.slug === sel.value);
  if (!target) return;
  const onVoters = /voters\.html$/.test(location.pathname);
  location.href = (onVoters && target.dots) ? target.dots : target.results.href;
};

bar.querySelectorAll('.ui-mode-btn').forEach(btn => {
  btn.onclick = () => applyUiMode(btn.dataset.uimode);
});

const host = document.getElementById('races');
if (host && !isFramed) host.prepend(bar);

// Verifica se a URL pediu modo avançado ou aplica o modo salvo
const urlMode = new URLSearchParams(location.search).get('layout');
applyUiMode(urlMode === 'advanced' || urlMode === 'simple' ? urlMode : savedMode);
