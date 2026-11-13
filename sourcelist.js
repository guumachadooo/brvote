// Renderizador de notas de fontes e créditos original do usavote
export function renderSourceNote(el, state) {
  if (!el || !state || !state.sources) return;
  el.textContent = '';
  const b = document.createElement('b');
  b.textContent = 'Fontes. ';
  el.appendChild(b);
  state.sources.forEach((s, i) => {
    if (i > 0) el.appendChild(document.createTextNode('; '));
    el.appendChild(document.createTextNode(s.label + ': '));
    const a = document.createElement('a');
    a.href = s.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = s.text;
    el.appendChild(a);
    if (s.tail) el.appendChild(document.createTextNode(s.tail));
  });
  el.appendChild(document.createTextNode('. '));
  const more = document.createElement('a');
  more.href = 'sources.html#' + state.slug;
  more.textContent = 'Todas as fontes e créditos →';
  el.appendChild(more);
}
