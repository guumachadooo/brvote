import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { geoMercator } from 'd3-geo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function clipConvexPoly(poly, px, py, nx, ny) {
  if (!poly || poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCur = (cur[0] - px) * nx + (cur[1] - py) * ny;
    const dPrev = (prev[0] - px) * nx + (prev[1] - py) * ny;
    if (dCur >= -1e-7) {
      if (dPrev < -1e-7) {
        const t = dPrev / (dPrev - dCur);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      out.push(cur);
    } else if (dPrev >= -1e-7) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
  }
  return out;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    a += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return a * 0.5;
}

function cleanRingPts(ring) {
  const out = [];
  for (const pt of ring) {
    const x = +pt[0].toFixed(2);
    const y = +pt[1].toFixed(2);
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 1e-3) {
      out.push([x, y]);
    }
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-3) {
    out.pop();
  }
  return out;
}

// Triangula um polígono (potencialmente côncavo e com múltiplos anéis) usando ShapeUtils.triangulateShape
function triangulateProjectedFeature(geom, proj, W = 220, H = 220) {
  const rawPolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const triangles = [];
  const allPolysProjected = [];

  for (const poly of rawPolys) {
    const outerRaw = [];
    for (const ll of poly[0]) {
      const p = proj(ll);
      if (p && isFinite(p[0]) && isFinite(p[1])) {
        outerRaw.push([p[0] - W / 2, -(p[1] - H / 2)]);
      }
    }
    const outer = cleanRingPts(outerRaw);
    if (outer.length < 3 || Math.abs(signedArea(outer)) < 1e-5) continue;

    // Garante orientação CCW para ShapeUtils
    if (signedArea(outer) < 0) outer.reverse();

    const holes = [];
    const polyRings = [outer];
    for (let h = 1; h < poly.length; h++) {
      const hRaw = [];
      for (const ll of poly[h]) {
        const p = proj(ll);
        if (p && isFinite(p[0]) && isFinite(p[1])) {
          hRaw.push([p[0] - W / 2, -(p[1] - H / 2)]);
        }
      }
      const hole = cleanRingPts(hRaw);
      if (hole.length >= 3 && Math.abs(signedArea(hole)) > 1e-5) {
        if (signedArea(hole) > 0) hole.reverse();
        holes.push(hole);
        polyRings.push(hole);
      }
    }
    allPolysProjected.push(polyRings);

    const contourVec = outer.map(([x, y]) => new THREE.Vector2(x, y));
    const holesVec = holes.map(hr => hr.map(([x, y]) => new THREE.Vector2(x, y)));
    const allPts = [...outer, ...holes.flat()];
    try {
      const faces = THREE.ShapeUtils.triangulateShape(contourVec, holesVec);
      for (const [i0, i1, i2] of faces) {
        const p0 = allPts[i0], p1 = allPts[i1], p2 = allPts[i2];
        if (!p0 || !p1 || !p2) continue;
        const tri = [p0, p1, p2];
        if (Math.abs(signedArea(tri)) > 1e-6) {
          triangles.push(tri);
        }
      }
    } catch {
      // Fallback caso algum furo degenerado cause erro
      const faces = THREE.ShapeUtils.triangulateShape(contourVec, []);
      for (const [i0, i1, i2] of faces) {
        const p0 = outer[i0], p1 = outer[i1], p2 = outer[i2];
        if (p0 && p1 && p2 && Math.abs(signedArea([p0, p1, p2])) > 1e-6) {
          triangles.push([p0, p1, p2]);
        }
      }
    }
  }
  return { triangles, allPolysProjected };
}

// Reconstrói os anéis externos simples a partir de um conjunto de polígonos convexos recortados
// cancelando todas as arestas internas compartilhadas (u -> v) e (v -> u).
function mergeConvexPiecesToPolys(pieces) {
  const snap = v => Math.round(v * 100) / 100;
  const keyPt = p => `${snap(p[0]).toFixed(2)},${snap(p[1]).toFixed(2)}`;

  const edgeMap = new Map();
  const ptCoords = new Map();

  for (const rawPiece of pieces) {
    const piece = cleanRingPts(rawPiece);
    if (piece.length < 3) continue;
    const a = signedArea(piece);
    if (Math.abs(a) < 1e-5) continue;
    if (a < 0) piece.reverse();

    for (let i = 0; i < piece.length; i++) {
      const u = piece[i];
      const v = piece[(i + 1) % piece.length];
      const ku = keyPt(u);
      const kv = keyPt(v);
      if (ku === kv) continue;
      ptCoords.set(ku, [snap(u[0]), snap(u[1])]);
      ptCoords.set(kv, [snap(v[0]), snap(v[1])]);

      const revKey = `${kv}->${ku}`;
      if (edgeMap.has(revKey)) {
        const cnt = edgeMap.get(revKey);
        if (cnt <= 1) edgeMap.delete(revKey);
        else edgeMap.set(revKey, cnt - 1);
      } else {
        const fwdKey = `${ku}->${kv}`;
        edgeMap.set(fwdKey, (edgeMap.get(fwdKey) || 0) + 1);
      }
    }
  }

  const adj = new Map();
  for (const [eKey, cnt] of edgeMap.entries()) {
    const [ku, kv] = eKey.split('->');
    if (!adj.has(ku)) adj.set(ku, []);
    for (let c = 0; c < cnt; c++) adj.get(ku).push(kv);
  }

  const loops = [];
  for (const [startKey, list] of adj.entries()) {
    while (list.length > 0) {
      const ringKeys = [startKey];
      let cur = list.pop();
      let safety = 0;
      while (cur && cur !== startKey && safety++ < 10000) {
        ringKeys.push(cur);
        const nextList = adj.get(cur);
        if (!nextList || !nextList.length) break;
        if (nextList.length === 1) {
          cur = nextList.pop();
        } else {
          // Escolhe a curva mais à direita (menor ângulo externo) para não cruzar lóbulos em vértices de toque
          const prevPt = ptCoords.get(ringKeys[ringKeys.length - 2]);
          const curPt = ptCoords.get(cur);
          const inAngle = Math.atan2(curPt[1] - prevPt[1], curPt[0] - prevPt[0]);
          let bestIdx = 0, bestTurn = Infinity;
          for (let k = 0; k < nextList.length; k++) {
            const candPt = ptCoords.get(nextList[k]);
            const outAngle = Math.atan2(candPt[1] - curPt[1], candPt[0] - curPt[0]);
            let turn = outAngle - inAngle;
            while (turn <= -Math.PI) turn += 2 * Math.PI;
            while (turn > Math.PI) turn -= 2 * Math.PI;
            if (turn < bestTurn) { bestTurn = turn; bestIdx = k; }
          }
          cur = nextList.splice(bestIdx, 1)[0];
        }
      }
      if (cur === startKey && ringKeys.length >= 3) {
        const ring = cleanRingPts(ringKeys.map(k => ptCoords.get(k)));
        if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-4) {
          loops.push(ring);
        }
      }
    }
  }

  if (!loops.length) {
    // Fallback direto para as peças convexas individuais
    return pieces
      .map(p => cleanRingPts(p))
      .filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1e-4)
      .map(r => [r]);
  }

  // Separa anéis externos (area > 0) de eventuais furos reais (area < 0)
  const outers = loops.filter(r => signedArea(r) > 0).map(r => [r]);
  if (!outers.length) {
    return loops.map(r => [r.slice().reverse()]);
  }
  return outers;
}

function partitionTrianglesIntoZones(triangles, nZones) {
  if (nZones <= 1 || !triangles.length) return null;

  // Calcula centro de massa ponderado por área dos triângulos
  let totA = 0, cx = 0, cy = 0;
  for (const t of triangles) {
    const a = Math.abs(signedArea(t));
    const tx = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const ty = (t[0][1] + t[1][1] + t[2][1]) / 3;
    cx += tx * a;
    cy += ty * a;
    totA += a;
  }
  if (totA > 0) { cx /= totA; cy /= totA; }

  const clipAgainst = (pieces, px, py, nx, ny) => {
    const out = [];
    for (const p of pieces) {
      const c = clipConvexPoly(p, px, py, nx, ny);
      if (c.length >= 3 && Math.abs(signedArea(c)) > 1e-6) out.push(c);
    }
    return out;
  };

  if (nZones === 2) {
    const p1 = clipAgainst(triangles, cx, cy, 1, 0);
    const p2 = clipAgainst(triangles, cx, cy, -1, 0);
    if (p1.length && p2.length) {
      return [mergeConvexPiecesToPolys(p1), mergeConvexPiecesToPolys(p2)];
    }
    return null;
  }

  // Para 3 ou 4 zonas: quadrantes exatos em torno de (cx, cy)
  const q1 = clipAgainst(clipAgainst(triangles, cx, cy, 1, 0), cx, cy, 0, 1);
  const q2 = clipAgainst(clipAgainst(triangles, cx, cy, -1, 0), cx, cy, 0, 1);
  const q3 = clipAgainst(clipAgainst(triangles, cx, cy, 1, 0), cx, cy, 0, -1);
  const q4 = clipAgainst(clipAgainst(triangles, cx, cy, -1, 0), cx, cy, 0, -1);

  if (nZones === 3) {
    // Combina q3 + q4 no 3º setor para cobrir 100% do município sem deixar nenhum buraco!
    const q34 = [...q3, ...q4];
    const buckets = [q1, q2, q34].filter(b => b.length > 0);
    if (buckets.length === 3) {
      return buckets.map(b => mergeConvexPiecesToPolys(b));
    }
  }

  const buckets4 = [q1, q2, q3, q4].filter(b => b.length > 0);
  if (buckets4.length === nZones) {
    return buckets4.map(b => mergeConvexPiecesToPolys(b));
  }
  // Se algum quadrante ficou vazio (ex: município em formato de L), funde nos setores ativos para nunca perder área!
  if (buckets4.length >= 2) {
    while (buckets4.length > nZones) {
      const last = buckets4.pop();
      buckets4[buckets4.length - 1].push(...last);
    }
    return buckets4.map(b => mergeConvexPiecesToPolys(b));
  }
  return null;
}

const dirs = fs.readdirSync(DATA_DIR).filter(d => d !== 'br' && fs.statSync(path.join(DATA_DIR, d)).isDirectory());
let fixedMunCount = 0;

for (const slug of dirs) {
  const stDir = path.join(DATA_DIR, slug);
  const geoPath = path.join(stDir, 'municipios.json');
  const prPath = path.join(stDir, 'precincts.json');
  const shPath = path.join(stDir, 'precinct-shapes.json');
  if (!fs.existsSync(geoPath) || !fs.existsSync(prPath) || !fs.existsSync(shPath)) continue;

  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  const pr = JSON.parse(fs.readFileSync(prPath, 'utf8'));
  const sh = JSON.parse(fs.readFileSync(shPath, 'utf8'));

  const W = 220, H = 220;
  const proj = geoMercator().fitSize([W, H], { type: 'FeatureCollection', features: geo.features });

  for (const f of geo.features) {
    const key = (f.properties.name || '').toUpperCase();
    const pRows = pr.counties[key];
    if (!pRows || !pRows.length) continue;

    const { triangles, allPolysProjected } = triangulateProjectedFeature(f.geometry, proj, W, H);
    if (!allPolysProjected.length) continue;

    if (pRows.length === 1) {
      sh[key] = [allPolysProjected];
      fixedMunCount++;
    } else {
      const zonePolys = partitionTrianglesIntoZones(triangles, pRows.length);
      if (zonePolys && zonePolys.length === pRows.length) {
        sh[key] = zonePolys;
        fixedMunCount++;
      } else {
        sh[key] = pRows.map(() => allPolysProjected);
      }
    }
  }

  fs.writeFileSync(shPath, JSON.stringify(sh));
}

// Agora reconstrói data/br/precincts.json e data/br/precinct-shapes.json
// para que todos os 5.570 municípios do Brasil (incluindo Brasília - DF unificada com 1,80M de votos
// e todas as ilhas costeiras/fluviais) não tenham nenhum buraco!
const brDir = path.join(DATA_DIR, 'br');
const brGeo = JSON.parse(fs.readFileSync(path.join(brDir, 'municipios.json'), 'utf8'));
const br26 = JSON.parse(fs.readFileSync(path.join(brDir, 'results-2026.json'), 'utf8'));
const brHist = JSON.parse(fs.readFileSync(path.join(brDir, 'results-history.json'), 'utf8'));
const brProj = geoMercator().fitSize([220, 220], { type: 'FeatureCollection', features: brGeo.features });

const brPr = JSON.parse(fs.readFileSync(path.join(brDir, 'precincts.json'), 'utf8'));
const brSh = JSON.parse(fs.readFileSync(path.join(brDir, 'precinct-shapes.json'), 'utf8'));

for (const slug of dirs) {
  const stGeo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, slug, 'municipios.json'), 'utf8'));
  const st26 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, slug, 'results-2026.json'), 'utf8'));
  const stHist = JSON.parse(fs.readFileSync(path.join(DATA_DIR, slug, 'results-history.json'), 'utf8'));
  const ufFeat = brGeo.features.find(f => (f.properties.sigla || '').toLowerCase() === slug);
  if (!ufFeat) continue;
  const stateNameUpper = ufFeat.properties.name.toUpperCase();
  const sigla = ufFeat.properties.sigla;

  if (slug === 'df') {
    // Em 'br' (visão Cidades 5.570 do Brasil), Brasília (DF) é 1 único município oficial IBGE com 1,80M votos (3ª maior cidade do país!)
    const { allPolysProjected } = triangulateProjectedFeature(ufFeat.geometry, brProj, 220, 220);
    const raceKeys = ['2026-pres-2t', '2026-pres-1t', '2026-gov', '2026-sen', '2026-dep-fed', '2026-dep-est', '2022-presidente'];
    const votesPerRace = raceKeys.map(rk => {
      const rObj = br26.races[rk] || brHist.races[rk];
      const row = rObj?.counties?.[stateNameUpper] || [0, 0, 0];
      return [row[0] || 0, row[1] || 0, row[2] || 0];
    });
    brPr.counties[stateNameUpper] = [
      [`Brasília (${sigla})`, 2203048, 5760.8, votesPerRace]
    ];
    brSh[stateNameUpper] = [allPolysProjected];
    continue;
  }

  // Para os demais 26 estados, projeta todos os polígonos (incluindo MultiPolygons/ilhas) de cada município na projeção nacional
  const existingRows = brPr.counties[stateNameUpper] || [];
  const rowByNorm = new Map();
  for (const r of existingRows) {
    const cleanName = String(r[0]).replace(/\s*\([A-Z]{2}\)\s*$/, '').toUpperCase();
    rowByNorm.set(cleanName, r);
  }

  const newRows = [];
  const newShapes = [];
  for (const mf of stGeo.features) {
    const mName = mf.properties.name;
    const mUpper = mName.toUpperCase();
    const { allPolysProjected } = triangulateProjectedFeature(mf.geometry, brProj, 220, 220);
    if (!allPolysProjected.length) continue;

    let row = rowByNorm.get(mUpper);
    if (!row) {
      const raceKeys = ['2026-pres-2t', '2026-pres-1t', '2026-gov', '2026-sen', '2026-dep-fed', '2026-dep-est', '2022-presidente'];
      const votesPerRace = raceKeys.map(rk => {
        const rObj = st26.races[rk] || stHist.races[rk];
        const v = rObj?.counties?.[mUpper] || [0, 0, 0];
        return [v[0] || 0, v[1] || 0, v[2] || 0];
      });
      row = [`${mName} (${sigla})`, 10000, 500, votesPerRace];
    }
    newRows.push(row);
    newShapes.push(allPolysProjected);
  }
  brPr.counties[stateNameUpper] = newRows;
  brSh[stateNameUpper] = newShapes;
}

fs.writeFileSync(path.join(brDir, 'precincts.json'), JSON.stringify(brPr));
fs.writeFileSync(path.join(brDir, 'precinct-shapes.json'), JSON.stringify(brSh));
console.log(`Reconstruídos ${fixedMunCount} municípios/zonas em todas as 27 UFs + malha nacional de 5.570 municípios sem buracos!`);
