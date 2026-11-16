// custom-select.js — In-site editorial dropdown menus replacing native OS <select> pickers
const enhancedSelects = new WeakMap();

export function initCustomSelects(root = document) {
  const selects = root.querySelectorAll('select:not([data-csel-ignore])');
  selects.forEach(enhanceSelect);
}

export function enhanceSelect(selectEl) {
  if (!selectEl || enhancedSelects.has(selectEl)) return;

  const wrap = document.createElement('div');
  wrap.className = 'csel-wrap';
  if (selectEl.id) wrap.dataset.for = selectEl.id;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'csel-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'csel-label';

  const caretSpan = document.createElement('span');
  caretSpan.className = 'csel-caret';
  caretSpan.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  btn.append(labelSpan, caretSpan);

  const menu = document.createElement('div');
  menu.className = 'csel-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'csel-search';
  searchInput.placeholder = 'Filtrar...';
  searchInput.autocomplete = 'off';
  searchInput.hidden = true;

  const list = document.createElement('div');
  list.className = 'csel-list';

  menu.append(searchInput, list);

  // Hide native select visually while keeping it functional for scripts & events
  selectEl.classList.add('csel-native-hidden');
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.append(selectEl, btn, menu);

  function rebuildOptions() {
    const opts = Array.from(selectEl.options);
    const selOpt = opts[selectEl.selectedIndex] || opts[0];
    labelSpan.textContent = selOpt ? selOpt.textContent : 'Selecionar';
    wrap.hidden = selectEl.hidden || selectEl.style.display === 'none';

    searchInput.hidden = opts.length <= 10;
    const q = (searchInput.value || '').trim().toLowerCase();

    list.innerHTML = '';
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      if (q && !o.textContent.toLowerCase().includes(q)) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'csel-item' + (i === selectEl.selectedIndex ? ' is-selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === selectEl.selectedIndex ? 'true' : 'false');
      item.dataset.index = String(i);
      item.dataset.value = o.value;
      item.textContent = o.textContent;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectEl.selectedIndex !== i) {
          selectEl.selectedIndex = i;
          selectEl.value = o.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        rebuildOptions();
        closeMenu();
      });
      list.appendChild(item);
    }
  }

  function positionMenu() {
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 230 && rect.top > spaceBelow) {
      menu.classList.add('csel-drop-up');
    } else {
      menu.classList.remove('csel-drop-up');
    }
  }

  function openMenu() {
    closeAllCustomSelects(wrap);
    rebuildOptions();
    menu.hidden = false;
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    positionMenu();
    if (!searchInput.hidden) {
      searchInput.value = '';
      rebuildOptions();
      setTimeout(() => searchInput.focus({ preventScroll: true }), 15);
    }
    const activeItem = list.querySelector('.csel-item.is-selected');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }

  function closeMenu() {
    menu.hidden = true;
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  searchInput.addEventListener('click', (e) => e.stopPropagation());
  searchInput.addEventListener('input', () => rebuildOptions());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  selectEl.addEventListener('change', () => rebuildOptions());

  const obs = new MutationObserver(() => rebuildOptions());
  obs.observe(selectEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value', 'selected', 'hidden', 'style']
  });

  rebuildOptions();
  enhancedSelects.set(selectEl, { wrap, rebuildOptions, closeMenu });
}

function closeAllCustomSelects(exceptWrap = null) {
  document.querySelectorAll('.csel-wrap.is-open').forEach((w) => {
    if (w === exceptWrap) return;
    w.classList.remove('is-open');
    const m = w.querySelector('.csel-menu');
    const b = w.querySelector('.csel-btn');
    if (m) m.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', () => closeAllCustomSelects());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllCustomSelects();
  });

  const boot = () => {
    initCustomSelects(document);
    const bodyObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'SELECT') enhanceSelect(node);
            else if (node.querySelectorAll) initCustomSelects(node);
          }
        }
      }
    });
    if (document.body) {
      bodyObs.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
