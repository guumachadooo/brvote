// Barra superior de navegação com Brasil Inteiro + 27 UFs + Alternador de Layout + Alternador Global de Tema Visual
import { STATES, STATE } from './state.js';
import { initCustomSelects } from './custom-select.js';

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

const savedTheme = (() => {
  try { return localStorage.getItem('brvote_theme') || 'dark'; } catch { return 'dark'; }
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

function applyTheme(theme) {
  const t = (theme === 'light' || theme === 'contrast') ? theme : 'dark';
  document.documentElement.classList.toggle('theme-light', t === 'light');
  document.documentElement.classList.toggle('theme-contrast', t === 'contrast');
  document.body.classList.toggle('theme-light', t === 'light');
  document.body.classList.toggle('theme-contrast', t === 'contrast');
  try { localStorage.setItem('brvote_theme', t); } catch {}
  document.querySelectorAll('#navThemeSelect, #mapThemeSelect, #homeThemeSelect').forEach(sel => {
    if (sel && sel.value !== t) sel.value = t;
  });
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
}
window.setBrVoteTheme = applyTheme;

bar.innerHTML =
  `<a class="home-link" href="index.html">← Mapa do Brasil</a>` +
  `<span class="nav-sep">·</span>` +
  `<label class="state-Jump"><span>Recorte</span><select id="navStateSelect" aria-label="Pular para estado ou Brasil inteiro">${options}</select></label>` +
  `<label class="state-Jump nav-theme-pick"><span>Tema</span>` +
    `<select id="navThemeSelect" aria-label="Escolher tema visual do site">` +
      `<option value="dark">Brasil Noite</option>` +
      `<option value="light">Claro Editorial</option>` +
      `<option value="contrast">Alto Contraste</option>` +
    `</select>` +
  `</label>` +
  `<div class="ui-mode-switch" role="group" aria-label="Nível de detalhe da interface" title="Escolha entre o layout Simples (intuitivo, sem excesso de botões) ou Avançado (com filtros e personalização completa)">` +
    `<span class="ui-mode-lbl">Layout:</span>` +
    `<button type="button" class="ui-mode-btn" data-uimode="simple">Simples</button>` +
    `<button type="button" class="ui-mode-btn" data-uimode="advanced">Avançado</button>` +
  `</div>` +
  `<a class="volume-top" href="volume.html?uf=${STATE.slug}" title="Ver experimento Votos como Volume 3D e Jarros despejando votos">Volume &amp; Jarros 3D →</a>` +
  `<a class="why-top" href="why.html">Por que mapear votos assim? →</a>`;

const sel = bar.querySelector('#navStateSelect');
sel.onchange = () => {
  const target = ready.find(s => s.slug === sel.value);
  if (!target) return;
  if (/volume\.html$/.test(location.pathname)) {
    location.href = `volume.html?uf=${target.slug}`;
    return;
  }
  const onVoters = /voters\.html$/.test(location.pathname);
  location.href = (onVoters && target.dots) ? target.dots : target.results.href;
};

const themeSel = bar.querySelector('#navThemeSelect');
themeSel.value = savedTheme;
themeSel.onchange = () => applyTheme(themeSel.value);

bar.querySelectorAll('.ui-mode-btn').forEach(btn => {
  btn.onclick = () => applyUiMode(btn.dataset.uimode);
});

const host = document.getElementById('races') || document.querySelector('header.Hud');
if (!isFramed) {
  if (host) host.prepend(bar);
  else document.body.prepend(bar);
}

initCustomSelects(bar);

const urlMode = new URLSearchParams(location.search).get('layout');
applyUiMode(urlMode === 'advanced' || urlMode === 'simple' ? urlMode : savedMode);
applyTheme(savedTheme);
