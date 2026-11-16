// Lógica pura para cálculo de ponto interno de polígonos (IBGE) e posicionamento de balões no tour 3D
function normRing(input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  let r = input;
  // Se foi passado array de anéis [[[x,y], ...]], escolhe o anel de maior extensão
  if (Array.isArray(r[0]) && Array.isArray(r[0][0])) {
    r = r[0];
  }
  return r.map(p => (Array.isArray(p) ? { x: +p[0] || 0, y: +p[1] || 0 } : { x: +p.x || 0, y: +p.y || 0 }));
}

export function pointInRing(x, y, rawRing) {
  const ring = normRing(rawRing);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function makeInteriorResult(cx, cy, area) {
  return {
    cx,
    cy,
    area,
    0: cx,
    1: cy,
    length: 2,
    *[Symbol.iterator]() {
      yield cx;
      yield cy;
    }
  };
}

export function computeInteriorPoint(rawRing) {
  const ring = normRing(rawRing);
  if (!ring.length) return makeInteriorResult(0, 0, 0);
  let area2 = 0, sx = 0, sy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    sx += (a.x + b.x) * cross;
    sy += (a.y + b.y) * cross;
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
  }
  let cx = (minX + maxX) * 0.5;
  let cy = (minY + maxY) * 0.5;
  if (Math.abs(area2) > 1e-6) {
    cx = sx / (3 * area2);
    cy = sy / (3 * area2);
  }
  if (pointInRing(cx, cy, ring)) {
    return makeInteriorResult(cx, cy, Math.abs(area2) * 0.5);
  }
  const testYs = [cy, (minY + maxY) * 0.5, minY + (maxY - minY) * 0.35, minY + (maxY - minY) * 0.65];
  for (const ty of testYs) {
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.y <= ty && b.y > ty) || (b.y <= ty && a.y > ty)) {
        const t = (ty - a.y) / ((b.y - a.y) || 1e-12);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((a, b) => a - b);
    let bestSpan = -1, bestMid = cx;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const span = xs[k + 1] - xs[k];
      if (span > bestSpan) {
        bestSpan = span;
        bestMid = (xs[k] + xs[k + 1]) * 0.5;
      }
    }
    if (bestSpan > 0 && pointInRing(bestMid, ty, ring)) {
      return makeInteriorResult(bestMid, ty, Math.abs(area2) * 0.5);
    }
  }
  return makeInteriorResult(cx, cy, Math.abs(area2) * 0.5);
}

export function computeCalloutPlacements(items, sw = 800, sh = 600, topPad = 10) {
  const vis = items.map(p => ({
    ...p,
    w: p.w || 156,
    h: p.h || 44,
    dx: 0,
    dy: -22,
    place: 'above',
  }));
  if (vis.length === 2) {
    const [a, b] = vis;
    const minSepX = (a.w + b.w) * 0.5 + 14;
    const minSepY = Math.max(a.h, b.h) + 28;
    const distX = Math.abs(a.sx - b.sx);
    const distY = Math.abs(a.sy - b.sy);
    if (distX < minSepX && distY < minSepY) {
      const upper = (a.sy < b.sy - 2 || (Math.abs(a.sy - b.sy) <= 2 && a.sx <= b.sx)) ? a : b;
      const lower = upper === a ? b : a;
      upper.place = 'above';
      upper.dy = -22;
      lower.place = 'below';
      lower.dy = 22;
    }
  }
  const pad = 10;
  const maxShiftX = 44;
  for (const p of vis) {
    if (p.place === 'above' && (p.sy + p.dy - p.h) < topPad) {
      p.place = 'below';
      p.dy = 22;
    } else if (p.place === 'below' && (p.sy + p.dy + p.h) > sh - pad) {
      p.place = 'above';
      p.dy = -22;
    }
    const leftEdge = p.sx + p.dx - p.w * 0.5;
    const rightEdge = p.sx + p.dx + p.w * 0.5;
    if (leftEdge < pad) p.dx = Math.min(maxShiftX, p.dx + (pad - leftEdge));
    if (rightEdge > sw - pad) p.dx = Math.max(-maxShiftX, p.dx - (rightEdge - (sw - pad)));
  }
  if (vis.length === 2 && vis[0].place === vis[1].place) {
    const [a, b] = vis;
    if (Math.abs(a.sy - b.sy) < Math.max(a.h, b.h) + 8) {
      const minSepX = (a.w + b.w) * 0.5 + 12;
      const cxA = a.sx + a.dx;
      const cxB = b.sx + b.dx;
      const gap = Math.abs(cxA - cxB);
      if (gap < minSepX) {
        const push = Math.min(maxShiftX, (minSepX - gap) * 0.5);
        if (cxA <= cxB) { a.dx -= push; b.dx += push; }
        else { a.dx += push; b.dx -= push; }
      }
    }
  }
  return vis;
}
