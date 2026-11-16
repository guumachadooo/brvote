// Colunas 3D por zona eleitoral ou por todos os 5.570 municípios do Brasil (geometria em lote de alta performance)
import * as THREE from 'three';
import { marginColorHex, leadColorHex, OTHER_HEX } from './colors.js';
import { computeInteriorPoint } from './callout-logic.js';

const easeQuint = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export function createPrecinctColumns({ group, precinctUrl, precinctShapesUrl, baseH = 0.35, maxH = 75 }) {
  const prGroup = new THREE.Group();
  prGroup.visible = false;
  group.add(prGroup);

  let prData = null;
  let prShapes = null;
  let loadPromise = null;
  let built = false;
  const items = [];
  const byKey = new Map();
  const byCodeNorm = new Map();

  let curRaise = 1.0;
  let curColorByLead = true;
  let maxLead = 1;
  let highlightedItem = null;
  let isolatedItem = null;
  let filterWinner = 'all';
  let heightAnim = null;

  // Buffers mesclados para renderizar até 5.582 municípios em apenas 3 draw calls a 60fps
  let totalVerts = 0;
  let unitY = null;
  let vertToItem = null;
  let winPosArr = null;
  let losePosArr = null;
  let winColArr = null;
  let loseColArr = null;
  let winGeo = null;
  let loseGeo = null;
  let winMesh = null;
  let loseMesh = null;

  let edgeLines = null;
  let edgePosArr = null;
  let edgeUnitY = null;
  let edgeItemIdx = null;

  const normStr = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

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

    const itemGeos = [];
    const itemEdges = [];
    let sumVerts = 0;
    let sumEdgeVerts = 0;

    for (const [cname, list] of Object.entries(prData.counties)) {
      const sList = prShapes[cname];
      if (!sList) continue;
      for (let i = 0; i < list.length; i++) {
        const polys = sList[i];
        if (!polys || !polys.length) continue;
        const shapes = [];
        let area2 = 0, nPts = 0;
        let bestRing = null, bestRingArea = -1;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;

        for (const rings of polys) {
          const outer = rings[0];
          if (!outer || outer.length < 3) continue;
          const pts = [];
          let rArea2 = 0;
          for (let k = 0; k < outer.length; k++) {
            const x = outer[k][0], y = outer[k][1];
            const nx = outer[(k + 1) % outer.length][0], ny = outer[(k + 1) % outer.length][1];
            const cross = (x * ny - nx * y);
            area2 += cross;
            rArea2 += cross;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            const prev = pts[pts.length - 1];
            if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-5) {
              pts.push(new THREE.Vector2(x, y));
            }
          }
          if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 1e-5) {
            pts.pop();
          }
          if (pts.length < 3 || Math.abs(rArea2) < 1e-6) continue;
          nPts += pts.length;
          if (Math.abs(rArea2) > bestRingArea) {
            bestRingArea = Math.abs(rArea2);
            bestRing = outer;
          }
          const sh = new THREE.Shape(pts);
          for (let h = 1; h < rings.length; h++) {
            const hRing = rings[h];
            if (!hRing || hRing.length < 3) continue;
            const hPts = [];
            let hArea2 = 0;
            for (let k = 0; k < hRing.length; k++) {
              const x = hRing[k][0], y = hRing[k][1];
              const nx = hRing[(k + 1) % hRing.length][0], ny = hRing[(k + 1) % hRing.length][1];
              hArea2 += (x * ny - nx * y);
              const prev = hPts[hPts.length - 1];
              if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-5) {
                hPts.push(new THREE.Vector2(x, y));
              }
            }
            if (hPts.length > 2 && Math.hypot(hPts[0].x - hPts[hPts.length - 1].x, hPts[0].y - hPts[hPts.length - 1].y) <= 1e-5) {
              hPts.pop();
            }
            if (hPts.length >= 3 && Math.abs(hArea2) > 1e-5 && Math.abs(hArea2) < Math.abs(rArea2) * 0.95) {
              sh.holes.push(new THREE.Path(hPts));
            }
          }
          shapes.push(sh);
        }
        if (!shapes.length || !nPts) continue;
        const [cx, cy] = computeInteriorPoint(bestRing || polys[0][0]);
        const span = Math.max(0.4, Math.max(x1 - x0, y1 - y0));

        let ext = null;
        try {
          ext = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
        } catch {
          try {
            for (const sh of shapes) sh.holes = [];
            ext = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
          } catch {
            continue;
          }
        }
        ext.rotateX(-Math.PI / 2);
        const nonIdx = ext.index ? ext.toNonIndexed() : ext;
        const vCount = nonIdx.attributes.position.count;
        if (!vCount) {
          ext.dispose();
          continue;
        }

        // Constrói arestas diretamente a partir dos anéis externos (100x mais rápido que EdgesGeometry em 5.570 municípios)
        let eCount = 0;
        for (const sh of shapes) {
          eCount += sh.curves.length * 2;
        }
        const edgeArr = new Float32Array(eCount * 3);
        let ew = 0;
        for (const sh of shapes) {
          const curves = sh.curves;
          for (let c = 0; c < curves.length; c++) {
            const v1 = curves[c].v1;
            const v2 = curves[c].v2;
            edgeArr[ew++] = v1.x; edgeArr[ew++] = 1; edgeArr[ew++] = -v1.y;
            edgeArr[ew++] = v2.x; edgeArr[ew++] = 1; edgeArr[ew++] = -v2.y;
          }
        }
        const edges = new THREE.BufferGeometry();
        edges.setAttribute('position', new THREE.BufferAttribute(edgeArr, 3));

        const row = list[i];
        const idx = items.length;
        const item = {
          idx,
          county: cname,
          code: row[0],
          reg: row[1],
          area: row[2] || Math.abs(area2) * 0.5,
          votesByRace: row[3],
          cx,
          cy,
          span,
          vStart: sumVerts,
          vCount,
          eStart: sumEdgeVerts,
          eCount,
          targetH: baseH,
          currentH: baseH,
          animFromH: baseH,
          animToH: baseH,
          r: 0, d: 0, o: 0, tot: 0,
          winHex: 0x334155,
          loseHex: 0x1e293b,
        };
        items.push(item);
        itemGeos.push(nonIdx);
        itemEdges.push(edges);
        sumVerts += vCount;
        sumEdgeVerts += eCount;

        const keyUpper = `${cname.toUpperCase()}::${String(row[0]).toUpperCase()}`;
        byKey.set(keyUpper, item);
        byKey.set(`${cname.toUpperCase()}::${row[0]}`, item);
        const cNorm = normStr(row[0]);
        if (cNorm && !byCodeNorm.has(cNorm)) {
          byCodeNorm.set(cNorm, item);
        }
        byCodeNorm.set(`${normStr(cname)}::${cNorm}`, item);
        if (nonIdx !== ext) ext.dispose();
      }
    }

    totalVerts = sumVerts;
    if (!totalVerts) return;

    unitY = new Float32Array(totalVerts);
    vertToItem = new Int32Array(totalVerts);
    winPosArr = new Float32Array(totalVerts * 3);
    losePosArr = new Float32Array(totalVerts * 3);
    const normArr = new Float32Array(totalVerts * 3);
    winColArr = new Float32Array(totalVerts * 3);
    loseColArr = new Float32Array(totalVerts * 3);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const g = itemGeos[i];
      const p = g.attributes.position.array;
      const n = g.attributes.normal.array;
      const start3 = it.vStart * 3;
      winPosArr.set(p, start3);
      losePosArr.set(p, start3);
      normArr.set(n, start3);
      for (let v = 0; v < it.vCount; v++) {
        const gv = it.vStart + v;
        unitY[gv] = p[v * 3 + 1];
        vertToItem[gv] = i;
      }
      g.dispose();
    }

    winGeo = new THREE.BufferGeometry();
    winGeo.setAttribute('position', new THREE.BufferAttribute(winPosArr, 3));
    winGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    winGeo.setAttribute('color', new THREE.BufferAttribute(winColArr, 3));

    loseGeo = new THREE.BufferGeometry();
    loseGeo.setAttribute('position', new THREE.BufferAttribute(losePosArr, 3));
    loseGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    loseGeo.setAttribute('color', new THREE.BufferAttribute(loseColArr, 3));

    const winMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const loseMat = new THREE.MeshLambertMaterial({ vertexColors: true });

    loseMesh = new THREE.Mesh(loseGeo, loseMat);
    winMesh = new THREE.Mesh(winGeo, winMat);
    loseMesh.frustumCulled = false;
    winMesh.frustumCulled = false;
    prGroup.add(loseMesh);
    prGroup.add(winMesh);

    if (sumEdgeVerts > 0) {
      edgePosArr = new Float32Array(sumEdgeVerts * 3);
      edgeUnitY = new Float32Array(sumEdgeVerts);
      edgeItemIdx = new Int32Array(sumEdgeVerts);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const eg = itemEdges[i];
        const ep = eg.attributes.position.array;
        edgePosArr.set(ep, it.eStart * 3);
        for (let v = 0; v < it.eCount; v++) {
          const ev = it.eStart + v;
          edgeUnitY[ev] = ep[v * 3 + 1];
          edgeItemIdx[ev] = i;
        }
        eg.dispose();
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePosArr, 3));
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x07131a,
        transparent: true,
        opacity: items.length > 1500 ? 0.24 : 0.42,
      });
      edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      edgeLines.frustumCulled = false;
      prGroup.add(edgeLines);
    }
  }

  function matchesFilter(it) {
    if (isolatedItem) return it === isolatedItem;
    if (filterWinner === 'all') return true;
    const { r, d, tot } = it;
    if (filterWinner === 'rep') return r >= d;
    if (filterWinner === 'dem') return d > r;
    if (filterWinner === 'close') {
      const m = (r + d) ? Math.abs((r - d) / (r + d)) * 100 : 100;
      return tot > 0 && m < 5;
    }
    return true;
  }

  function writeVertexHeights() {
    if (!totalVerts || !winGeo || !loseGeo) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const h = Math.max(baseH, it.currentH);
      const { r, d, tot } = it;
      const rWins = r >= d;
      const winV = rWins ? r : d;
      const loseV = rWins ? d : r;
      let bot, top;
      if (h > baseH + 0.04 && tot > 0 && winV > 0 && loseV > 0) {
        bot = Math.max(0.02, h * (loseV / tot));
        top = Math.max(0.02, h - bot);
      } else {
        bot = 0.01;
        top = Math.max(0.02, h - 0.01);
      }
      it._bot = bot;
      it._top = top;

      const end = it.vStart + it.vCount;
      for (let v = it.vStart; v < end; v++) {
        const uy = unitY[v];
        const idxY = v * 3 + 1;
        losePosArr[idxY] = uy * bot;
        winPosArr[idxY] = bot + uy * top;
      }
    }
    loseGeo.attributes.position.needsUpdate = true;
    winGeo.attributes.position.needsUpdate = true;

    if (edgeLines && edgePosArr) {
      for (let v = 0; v < edgeUnitY.length; v++) {
        const it = items[edgeItemIdx[v]];
        const totH = it._bot + it._top;
        edgePosArr[v * 3 + 1] = edgeUnitY[v] * totH;
      }
      edgeLines.geometry.attributes.position.needsUpdate = true;
    }
  }

  function applyHeights(animate = true, dur = 640) {
    if (!totalVerts || !winGeo || !loseGeo) return;
    const k = curRaise;
    let anyDiff = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const effK = matchesFilter(it) ? k : 0;
      const goalH = baseH + (it.targetH - baseH) * effK;
      if (!animate) {
        it.currentH = goalH;
        it.animFromH = goalH;
        it.animToH = goalH;
      } else {
        it.animFromH = it.currentH ?? baseH;
        it.animToH = goalH;
        if (Math.abs(it.animToH - it.animFromH) > 0.01) anyDiff = true;
      }
    }
    if (!animate || !anyDiff) {
      heightAnim = null;
      writeVertexHeights();
      loseGeo.computeBoundingSphere();
      winGeo.computeBoundingSphere();
    } else {
      heightAnim = { t0: performance.now(), dur };
    }
  }

  function tick(now = performance.now()) {
    if (!heightAnim) return false;
    const u = Math.min(1, (now - heightAnim.t0) / heightAnim.dur);
    const e = easeQuint(u);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.currentH = it.animFromH + (it.animToH - it.animFromH) * e;
    }
    writeVertexHeights();
    if (u >= 1) {
      heightAnim = null;
      loseGeo.computeBoundingSphere();
      winGeo.computeBoundingSphere();
    }
    return true;
  }

  const _tmpCol = new THREE.Color();
  const _loseCol = new THREE.Color();

  function paintItemColors(it, isHi = false) {
    const { r, d } = it;
    const rWins = r >= d;
    const winHex = curColorByLead ? leadColorHex(r, d, maxLead) : marginColorHex(r, d);
    const loseHex = rWins
      ? (curColorByLead ? leadColorHex(0, d, maxLead) : marginColorHex(0, 1))
      : (curColorByLead ? leadColorHex(r, 0, maxLead) : marginColorHex(1, 0));
    it.winHex = winHex;
    it.loseHex = loseHex;

    _tmpCol.set(winHex);
    _loseCol.set(loseHex);
    if (isHi) {
      _tmpCol.lerp(new THREE.Color(0x34d399), 0.45);
      _loseCol.lerp(new THREE.Color(0x34d399), 0.35);
    }
    const wr = _tmpCol.r, wg = _tmpCol.g, wb = _tmpCol.b;
    const lr = _loseCol.r, lg = _loseCol.g, lb = _loseCol.b;
    const end = it.vStart + it.vCount;
    for (let v = it.vStart; v < end; v++) {
      const c3 = v * 3;
      winColArr[c3] = wr;
      winColArr[c3 + 1] = wg;
      winColArr[c3 + 2] = wb;
      loseColArr[c3] = lr;
      loseColArr[c3 + 1] = lg;
      loseColArr[c3 + 2] = lb;
    }
  }

  function applyColors() {
    if (!totalVerts || !winGeo || !loseGeo) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      paintItemColors(it, it === highlightedItem);
    }
    winGeo.attributes.color.needsUpdate = true;
    loseGeo.attributes.color.needsUpdate = true;
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
      if (it.tot <= 0) {
        it.targetH = baseH;
      } else {
        it.targetH = baseH + (it.tot / maxVotes) * maxH;
      }
    }
    const firstShow = !prGroup.visible;
    prGroup.visible = true;
    applyColors();
    applyHeights(!firstShow, 640);
    if (firstShow) {
      // Anima suavemente da base até a altura 3D ao abrir a malha de municípios/zonas
      for (const it of items) it.currentH = baseH;
      applyHeights(true, 720);
    }
    return { count: items.length };
  }

  return {
    loadOnce,
    hasRace: id => !!(prData && prData.races && prData.races[id] != null),
    showRace,
    getRawCodes: () => {
      if (!prData || !prData.counties) return [];
      const out = [];
      for (const list of Object.values(prData.counties)) {
        for (const row of list) if (row && row[0]) out.push(row[0]);
      }
      return out;
    },
    getItems: () => { ensureBuilt(); return items; },
    findItemByQuery(q) {
      ensureBuilt();
      const nq = normStr(q);
      if (!nq) return null;
      if (byCodeNorm.has(nq)) return byCodeNorm.get(nq);
      // Remove sufixo de UF se o usuário escolheu "Uberaba (MG)"
      const clean = nq.replace(/\s*\([a-z]{2}\)\s*$/, '').trim();
      if (byCodeNorm.has(clean)) return byCodeNorm.get(clean);
      return items.find(it => normStr(it.code) === clean) ||
             items.find(it => normStr(it.code).startsWith(clean)) ||
             items.find(it => normStr(it.code).includes(clean)) || null;
    },
    setVisible: v => { prGroup.visible = v; },
    setRaise: (k, animate = false) => { curRaise = k; applyHeights(animate, 560); },
    setColorMode: byLead => { curColorByLead = byLead; applyColors(); },
    setFilterWinner: mode => { filterWinner = mode || 'all'; applyHeights(true, 580); },
    setIsolatedItem: it => { isolatedItem = it || null; applyHeights(true, 580); },
    getIsolatedItem: () => isolatedItem,
    tick,
    raycast(raycaster) {
      if (!prGroup.visible || !winMesh || !loseMesh) return null;
      const hits = raycaster.intersectObjects([winMesh, loseMesh], false);
      if (!hits.length) return null;
      const hit = hits[0];
      if (!hit.face) return null;
      const idx = vertToItem[hit.face.a];
      return items[idx] || null;
    },
    highlight(spec) {
      const prev = highlightedItem;
      highlightedItem = null;
      if (prev && winGeo && loseGeo) {
        paintItemColors(prev, false);
      }
      if (!spec || !prGroup.visible) {
        if (prev && winGeo && loseGeo) {
          winGeo.attributes.color.needsUpdate = true;
          loseGeo.attributes.color.needsUpdate = true;
        }
        return false;
      }
      const it = spec.idx != null
        ? spec
        : (byKey.get(`${String(spec.countyUpper || '').toUpperCase()}::${String(spec.code || '').toUpperCase()}`) ||
           byKey.get(`${spec.countyUpper}::${spec.code}`));
      if (!it) {
        if (prev && winGeo && loseGeo) {
          winGeo.attributes.color.needsUpdate = true;
          loseGeo.attributes.color.needsUpdate = true;
        }
        return false;
      }
      highlightedItem = it;
      if (winGeo && loseGeo) {
        paintItemColors(it, true);
        winGeo.attributes.color.needsUpdate = true;
        loseGeo.attributes.color.needsUpdate = true;
      }
      return true;
    },
  };
}
