// Web Worker original usavote para posicionamento de pontos dentro dos polígonos (suportando até 2047 municípios por UF)
function pip(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
function inPoly(x, y, rings) {
  if (!pip(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pip(x, y, rings[h])) return false;
  }
  return true;
}
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
  }
  return Math.abs(a) * 0.5;
}
function prepMulti(polys) {
  const parts = [];
  let tot = 0;
  for (const rings of polys) {
    const outer = rings[0];
    if (!outer || outer.length < 3) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outer) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const w = Math.max(1e-6, ringArea(outer));
    tot += w;
    parts.push({ rings, x0, y0, x1, y1, cum: tot });
  }
  return { parts, tot };
}
function sampleIn(prep, rand) {
  if (!prep.parts.length) return [0, 0];
  const r = rand() * prep.tot;
  let part = prep.parts[prep.parts.length - 1];
  for (const p of prep.parts) { if (r <= p.cum) { part = p; break; } }
  const { rings, x0, y0, x1, y1 } = part;
  const w = x1 - x0, h = y1 - y0;
  for (let k = 0; k < 12; k++) {
    const x = x0 + rand() * w;
    const y = y0 + rand() * h;
    if (inPoly(x, y, rings)) return [x, y];
  }
  let cx = 0, cy = 0;
  const o = rings[0];
  for (const [x, y] of o) { cx += x; cy += y; }
  return [cx / o.length, cy / o.length];
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counties = null;
let bgCounties = null;
let prCounties = null;

function buildCounty(ci, [rVotes, dVotes, oVotes], scale, seedSalt) {
  const c = counties[ci];
  const nR = Math.round(rVotes / scale);
  const nD = Math.round(dVotes / scale);
  const nO = Math.round(oVotes / scale);
  const nTot = nR + nD + nO;
  if (!nTot) return new Int16Array(0);

  const rand = mulberry32(((ci + 1) * 10007 + seedSalt) | 0);
  const bg = bgCounties && bgCounties[ci];
  const pr = prCounties && prCounties[ci];

  const out = new Int16Array(nTot * 4);
  let p = 0;
  function emit(x, z, party) {
    out[p++] = Math.max(-32767, Math.min(32767, Math.round(x * 300)));
    out[p++] = Math.round(rand() * 30000);
    out[p++] = Math.max(-32767, Math.min(32767, Math.round(z * 300)));
    // Codifica party nos bits superiores (>> 11) e ci nos 11 bits inferiores (& 2047)
    out[p++] = (party << 11) | (ci & 2047);
  }

  if (pr && pr.length) {
    let sumR = 0, sumD = 0, sumO = 0;
    for (let i = 0; i < pr.length; i++) {
      sumR += pr[i].r; sumD += pr[i].d; sumO += pr[i].o;
    }
    const usePrR = sumR > 0, usePrD = sumD > 0, usePrO = sumO > 0;
    let accR = 0, accD = 0, accO = 0;
    let emittedR = 0, emittedD = 0, emittedO = 0;
    for (let i = 0; i < pr.length; i++) {
      const cell = pr[i];
      accR += usePrR ? cell.r : 1;
      accD += usePrD ? cell.d : 1;
      accO += usePrO ? cell.o : 1;
      const totR = usePrR ? sumR : pr.length;
      const totD = usePrD ? sumD : pr.length;
      const totO = usePrO ? sumO : pr.length;
      const targetR = Math.round((accR / totR) * nR);
      const targetD = Math.round((accD / totD) * nD);
      const targetO = Math.round((accO / totO) * nO);
      const kR = targetR - emittedR;
      const kD = targetD - emittedD;
      const kO = targetO - emittedO;
      emittedR = targetR; emittedD = targetD; emittedO = targetO;
      for (let k = 0; k < kR; k++) { const [x, y] = sampleIn(cell.prep, rand); emit(x, -y, 0); }
      for (let k = 0; k < kD; k++) { const [x, y] = sampleIn(cell.prep, rand); emit(x, -y, 1); }
      for (let k = 0; k < kO; k++) { const [x, y] = sampleIn(cell.prep, rand); emit(x, -y, 2); }
    }
  } else {
    let cum = null, bgTot = 0;
    if (bg && bg.length) {
      cum = new Float64Array(bg.length);
      for (let i = 0; i < bg.length; i++) { bgTot += bg[i].w; cum[i] = bgTot; }
      if (bgTot <= 0) cum = null;
    }
    function pickPrep() {
      if (!cum) return c.prep;
      const r = rand() * bgTot;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r <= cum[mid]) hi = mid; else lo = mid + 1;
      }
      return bg[lo].prep;
    }
    function emitParty(count, party) {
      for (let i = 0; i < count; i++) {
        const [x, y] = sampleIn(pickPrep(), rand);
        emit(x, -y, party);
      }
    }
    emitParty(nR, 0);
    emitParty(nD, 1);
    emitParty(nO, 2);
  }

  for (let i = nTot - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const a = i * 4, b = j * 4;
    for (let k = 0; k < 4; k++) { const t = out[a + k]; out[a + k] = out[b + k]; out[b + k] = t; }
  }
  return out;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    counties = m.counties.map(c => ({ prep: prepMulti(c.polys) }));
    bgCounties = m.bgs ? m.bgs.map(list => list ? list.map(([w, polys]) => ({ w, prep: prepMulti(polys) })) : null) : null;
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'setGroups') {
    bgCounties = m.bgs.map(list => list ? list.map(([w, polys]) => ({ w, prep: prepMulti(polys) })) : null);
    self.postMessage({ type: 'groupsReady' });
  } else if (m.type === 'setPrecincts') {
    prCounties = m.prs.map(list => list ? list.map(([r, d, o, polys]) => ({ r, d, o, prep: prepMulti(polys) })) : null);
  } else if (m.type === 'clearPrecincts') {
    prCounties = null;
  } else if (m.type === 'generate') {
    const { reqId, votes, scale, seedSalt } = m;
    const buffers = [];
    const transfers = [];
    for (let ci = 0; ci < counties.length; ci++) {
      const buf = buildCounty(ci, votes[ci] || [0, 0, 0], scale, seedSalt);
      buffers.push(buf);
      if (buf.byteLength) transfers.push(buf.buffer);
    }
    self.postMessage({ type: 'dots', reqId, buffers }, transfers);
  }
};
