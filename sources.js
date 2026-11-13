import { STATES } from './state.js';

const root = document.getElementById('stateList');

for (const st of STATES) {
  const card = document.createElement('article');
  card.className = 'src-card';
  card.id = st.slug;

  const head = document.createElement('div');
  head.className = 'src-head';

  const h3 = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = st.results.href;
  titleLink.textContent = `${st.name} (${st.code})`;
  h3.appendChild(titleLink);
  head.appendChild(h3);

  const links = document.createElement('div');
  links.className = 'src-links';
  const mapA = document.createElement('a');
  mapA.href = st.results.href;
  mapA.textContent = 'Mapa de resultados →';
  links.appendChild(mapA);
  if (st.dots) {
    const dotA = document.createElement('a');
    dotA.href = st.dots;
    dotA.textContent = 'Mapa de pontos →';
    links.appendChild(dotA);
  }
  head.appendChild(links);
  card.appendChild(head);

  const ul = document.createElement('ul');
  for (const s of (st.sources || [])) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = s.label + ': ';
    li.appendChild(b);
    const a = document.createElement('a');
    a.href = s.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = s.text;
    li.appendChild(a);
    if (s.tail) li.appendChild(document.createTextNode(s.tail));
    ul.appendChild(li);
  }
  card.appendChild(ul);

  if (st.method) {
    const p = document.createElement('p');
    p.className = 'src-method';
    p.textContent = st.method;
    card.appendChild(p);
  }

  root.appendChild(card);
}
