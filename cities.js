// Marcadores 3D de cidades no mapa (esferas douradas + hastes finas no topo das colunas)
import * as THREE from 'three';

const MIN_POP_FOR_MARKER = 50000;
const MAX_MARKERS = 35;

export function createCityMarkers({ group, proj, cityUrl, counties, getTopY }) {
  const markerGroup = new THREE.Group();
  markerGroup.renderOrder = 4;
  group.add(markerGroup);

  const byUpper = new Map(counties.map(c => [c.name.toUpperCase(), c]));
  const items = [];

  const stemGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 8);
  stemGeo.translate(0, 0.5, 0);
  const headGeo = new THREE.SphereGeometry(0.55, 12, 10);
  const ringGeo = new THREE.RingGeometry(0.75, 1.15, 24);
  ringGeo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xf2c14e, transparent: true, opacity: 0.85,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf2c14e, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });

  if (cityUrl) {
    fetch(cityUrl).then(r => r.json()).then(list => {
      let count = 0;
      for (const c of list) {
        if (c.pop < MIN_POP_FOR_MARKER && count >= 10) break;
        if (count >= MAX_MARKERS) break;
        const p = proj([c.lon, c.lat]);
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
        const county = byUpper.get((c.county || c.name).toUpperCase()) || null;
        const node = new THREE.Group();
        node.position.set(p[0], 0, -p[1]);

        const sizeScale = Math.min(1.6, Math.max(0.75, Math.log10(Math.max(10000, c.pop)) - 4.0));
        const stemH = 3.2 + sizeScale * 2.4;

        const stem = new THREE.Mesh(stemGeo, mat);
        stem.scale.set(sizeScale, stemH, sizeScale);
        const head = new THREE.Mesh(headGeo, mat);
        head.scale.setScalar(sizeScale);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.scale.setScalar(sizeScale);

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
      const baseY = getTopY(it.county);
      it.stem.position.y = baseY;
      it.head.position.y = baseY + it.stemH;
      it.ring.position.y = baseY + 0.08;
    }
  }

  function updateFade(camera) {
    const d = camera.position.length();
    const op = d < 120 ? 0.92 : d > 360 ? 0.45 : 0.92 - ((d - 120) / 240) * 0.47;
    mat.opacity = op;
    ringMat.opacity = op * 0.65;
  }

  return { refreshHeights, updateFade };
}
