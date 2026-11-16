// Marcadores 3D de cidades no mapa (esferas douradas + hastes finas no topo das colunas)
import * as THREE from 'three';

const MIN_POP_FOR_MARKER = 50000;
const MAX_MARKERS = 35;

const normKey = s => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .trim();

export function createCityMarkers({ group, proj, cityUrl, counties, getTopY }) {
  const markerGroup = new THREE.Group();
  markerGroup.renderOrder = 4;
  group.add(markerGroup);

  const byUpper = new Map();
  const byNorm = new Map();
  for (const c of counties) {
    byUpper.set(c.name.toUpperCase(), c);
    byNorm.set(normKey(c.name), c);
  }

  function findCountyForCity(c, x, y) {
    const raw = (c.county || c.name || '').toUpperCase();
    if (byUpper.has(raw)) return byUpper.get(raw);
    const nk = normKey(c.county || c.name);
    if (byNorm.has(nk)) return byNorm.get(nk);
    // Fallback geométrico pelo centroide mais próximo
    let best = null, bestD2 = Infinity;
    for (const co of counties) {
      const dx = co.cx - x, dy = co.cy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = co;
      }
    }
    return best;
  }

  const items = [];
  const meshToCounty = new Map();

  const stemGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 8);
  stemGeo.translate(0, 0.5, 0);
  const headGeo = new THREE.SphereGeometry(0.55, 12, 10);
  const ringGeo = new THREE.RingGeometry(0.75, 1.15, 24);
  ringGeo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x34d399, transparent: true, opacity: 0.88,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8, transparent: true, opacity: 0.58, side: THREE.DoubleSide,
  });

  if (cityUrl) {
    fetch(cityUrl).then(r => r.json()).then(list => {
      let count = 0;
      for (const c of list) {
        if (c.pop < MIN_POP_FOR_MARKER && count >= 10) break;
        if (count >= MAX_MARKERS) break;
        const p = proj([c.lon, c.lat]);
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
        const county = findCountyForCity(c, p[0], p[1]);
        const pinX = county ? county.cx : p[0];
        const pinY = county ? county.cy : p[1];
        const node = new THREE.Group();
        node.position.set(pinX, 0, -pinY);

        const sizeScale = Math.min(1.6, Math.max(0.75, Math.log10(Math.max(10000, c.pop)) - 4.0));
        const stemH = 3.2 + sizeScale * 2.4;

        const stem = new THREE.Mesh(stemGeo, mat);
        stem.scale.set(sizeScale, stemH, sizeScale);
        const head = new THREE.Mesh(headGeo, mat);
        head.scale.setScalar(sizeScale);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.scale.setScalar(sizeScale);

        if (county) {
          meshToCounty.set(head, county);
          meshToCounty.set(stem, county);
          meshToCounty.set(ring, county);
        }

        node.add(stem, head, ring);
        markerGroup.add(node);
        items.push({ city: c, county, node, stem, head, ring, stemH });
        count++;
      }
      refreshHeights();
    }).catch(() => {});
  }

  function refreshHeights() {
    for (const it of items) {
      const st = getTopY(it.county);
      const baseY = typeof st === 'object' ? st.baseY : st;
      const lift = typeof st === 'object' ? st.lift : 1;
      const vis = typeof st === 'object' ? st.visible : true;
      it.node.visible = vis;
      if (!vis) continue;
      const curStemH = it.stemH * (0.06 + 0.94 * lift);
      it.stem.position.y = baseY;
      it.stem.scale.set(it.stem.scale.x, curStemH, it.stem.scale.z);
      it.head.position.y = baseY + curStemH;
      it.ring.position.y = baseY + 0.08;
    }
  }

  function raycast(raycaster) {
    const hits = raycaster.intersectObjects(markerGroup.children, true);
    for (const h of hits) {
      if (!h.object.parent || !h.object.parent.visible) continue;
      const c = meshToCounty.get(h.object);
      if (c) return c;
    }
    return null;
  }

  function updateFade(camera) {
    const d = camera.position.length();
    const op = d < 120 ? 0.92 : d > 360 ? 0.45 : 0.92 - ((d - 120) / 240) * 0.47;
    mat.opacity = op;
    ringMat.opacity = op * 0.65;
  }

  return { refreshHeights, updateFade, raycast };
}
