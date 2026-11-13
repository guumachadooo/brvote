// Colunas 3D por zona eleitoral ("Agrupar por: Por zona eleitoral")
import * as THREE from 'three';
import { marginColorHex, leadColorHex } from './colors.js';

export function createPrecinctColumns({ group, precinctUrl, precinctShapesUrl, baseH = 0.35, maxH = 75 }) {
  const prGroup = new THREE.Group();
  prGroup.visible = false;
  group.add(prGroup);

  let prData = null;
  let prShapes = null;
  let loadPromise = null;
  let built = false;
  const items = [];
  const meshToItem = new Map();
  const byKey = new Map();

  let curRaise = 1.0;
  let curColorByLead = true;
  let maxLead = 1;
  let highlightedItem = null;

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.4 });

  function loadOnce() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetch(precinctUrl).then(r => r.ok ? r.json() : null),
      fetch(precinctShapesUrl).then(r => r.ok ? r.json() : null),
    ]).then(([d, s]) => {
      prData = d;
      prShapes = s;
      return prData;
    }).catch(() => null);
    return loadPromise;
  }

  function ensureBuilt() {
    if (built || !prData || !prShapes) return;
    built = true;
    for (const [cname, list] of Object.entries(prData.counties)) {
      const sList = prShapes[cname];
      if (!sList) continue;
      for (let i = 0; i < list.length; i++) {
        const polys = sList[i];
        if (!polys || !polys.length) continue;
        const shapes = [];
        for (const rings of polys) {
          const outer = rings[0];
          if (!outer || outer.length < 3) continue;
          const sh = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
          for (let h = 1; h < rings.length; h++) {
            if (rings[h].length >= 3) {
              sh.holes.push(new THREE.Path(rings[h].map(([x, y]) => new THREE.Vector2(x, y))));
            }
          }
          shapes.push(sh);
        }
        if (!shapes.length) continue;

        const ext = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
        ext.rotateX(-Math.PI / 2);

        const lowerMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const lower = new THREE.Mesh(ext, lowerMat);
        prGroup.add(lower);

        const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const mesh = new THREE.Mesh(ext, mat);
        const edges = new THREE.EdgesGeometry(ext, 28);
        mesh.add(new THREE.LineSegments(edges, edgeMat));
        prGroup.add(mesh);

        const row = list[i];
        const item = {
          county: cname,
          code: row[0],
          reg: row[1],
          area: row[2],
          votesByRace: row[3],
          mesh, mat, lower, lowerMat,
          targetH: baseH,
          r: 0, d: 0, o: 0, tot: 0,
        };
        items.push(item);
        meshToItem.set(mesh, item);
        meshToItem.set(lower, item);
        byKey.set(`${cname.toUpperCase()}::${row[0]}`, item);
      }
    }
  }

  function applyHeights() {
    const k = curRaise;
    for (const it of items) {
      const h = baseH + (it.targetH - baseH) * k;
      const { r, d, tot } = it;
      const rWins = r >= d;
      const winV = rWins ? r : d;
      const loseV = rWins ? d : r;
      if (k > 0.02 && tot > 0 && winV > 0 && loseV > 0) {
        const bot = Math.max(0.02, h * (loseV / tot));
        const top = Math.max(0.02, h - bot);
        it.lower.scale.y = bot;
        it.mesh.position.y = bot;
        it.mesh.scale.y = top;
      } else {
        it.lower.scale.y = 0.01;
        it.mesh.position.y = 0.01;
        it.mesh.scale.y = Math.max(0.02, h - 0.01);
      }
    }
  }

  function applyColors() {
    for (const it of items) {
      const { r, d } = it;
      const rWins = r >= d;
      const winHex = curColorByLead ? leadColorHex(r, d, maxLead) : marginColorHex(r, d);
      const loseHex = rWins
        ? (curColorByLead ? leadColorHex(0, d, maxLead) : marginColorHex(0, 1))
        : (curColorByLead ? leadColorHex(r, 0, maxLead) : marginColorHex(1, 0));
      it.mat.color.set(winHex);
      it.lowerMat.color.set(loseHex);
    }
  }

  function showRace(raceId, raise, colorByLead) {
    ensureBuilt();
    if (!prData || prData.races[raceId] == null) return null;
    const rIdx = prData.races[raceId];
    curRaise = raise;
    curColorByLead = colorByLead;

    let maxVotes = 1;
    maxLead = 1;
    for (const it of items) {
      const v = it.votesByRace[rIdx] || [0, 0, 0];
      it.r = v[0] || 0;
      it.d = v[1] || 0;
      it.o = v[2] || 0;
      it.tot = it.r + it.d + it.o;
      if (it.tot > maxVotes) maxVotes = it.tot;
      const lead = Math.abs(it.r - it.d);
      if (lead > maxLead) maxLead = lead;
    }
    for (const it of items) {
      it.targetH = it.tot > 0 ? baseH + (it.tot / maxVotes) * maxH : baseH;
    }
    applyColors();
    applyHeights();
    prGroup.visible = true;
    return { count: items.length };
  }

  return {
    loadOnce,
    hasRace: id => !!(prData && prData.races && prData.races[id] != null),
    showRace,
    setVisible: v => { prGroup.visible = v; },
    setRaise: k => { curRaise = k; applyHeights(); },
    setColorMode: byLead => { curColorByLead = byLead; applyColors(); },
    raycast(raycaster) {
      if (!prGroup.visible) return null;
      const hits = raycaster.intersectObjects(prGroup.children, false);
      const hit = hits.find(h => meshToItem.has(h.object));
      return hit ? meshToItem.get(hit.object) : null;
    },
    highlight(spec) {
      if (highlightedItem) {
        highlightedItem.mat.emissive.setHex(0x000000);
        highlightedItem.lowerMat.emissive.setHex(0x000000);
        highlightedItem = null;
      }
      if (!spec || !prGroup.visible) return false;
      const it = byKey.get(`${spec.countyUpper}::${spec.code}`);
      if (!it) return false;
      highlightedItem = it;
      it.mat.emissive.setHex(0x3a2e10);
      it.lowerMat.emissive.setHex(0x3a2e10);
      return true;
    },
  };
}
