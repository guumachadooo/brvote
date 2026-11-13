// Overlay de "Calculando…" para que tarefas síncronas pesadas mostrem feedback imediato
export function withBusy(label, fn) {
  const el = document.getElementById('busy');
  const txt = document.getElementById('busyText');
  if (!el) return Promise.resolve().then(fn);
  if (txt && label) txt.textContent = label;
  el.classList.add('on');
  el.setAttribute('aria-busy', 'true');
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        Promise.resolve().then(fn).finally(() => {
          el.classList.remove('on');
          el.setAttribute('aria-busy', 'false');
          resolve();
        });
      }, 16);
    });
  });
}
