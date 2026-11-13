// Barra superior de navegação original do usavote com todas as 27 UFs
import { STATES, STATE } from './state.js';

const ready = [...STATES].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

const bar = document.createElement('div');
bar.className = 'site-nav';

const options = ready.map(s =>
  `<option value="${s.slug}" ${s.slug === STATE.slug ? 'selected' : ''}>${s.name} (${s.code})</option>`
).join('');

bar.innerHTML =
  `<a class="home-link" href="index.html">← Todos os estados</a>` +
  `<span class="nav-sep">·</span>` +
  `<label class="state-Jump"><span>Estado</span><select aria-label="Pular para estado">${options}</select></label>` +
  `<a class="why-top" href="why.html">Por que mapear votos assim? →</a>`;

const sel = bar.querySelector('select');
sel.onchange = () => {
  const target = ready.find(s => s.slug === sel.value);
  if (!target) return;
  const onVoters = /voters\.html$/.test(location.pathname);
  location.href = (onVoters && target.dots) ? target.dots : target.results.href;
};

const host = document.getElementById('races');
if (host) host.prepend(bar);
