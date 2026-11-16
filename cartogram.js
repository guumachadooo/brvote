// cartogram.js — Electoral Cartogram (Continuous Radial Density-Equalizing Deformation by Vote Weight)
// Works on Y-up (XZ ground plane) geometries in app.js
export function createCartogramWarper(counties) {
  for (const c of counties) {
    const geom = c.mesh?.geometry;
    if (geom && geom.attributes.position) {
      c._origPos = new Float32Array(geom.attributes.position.array);
    }
    const lineChild = c.mesh?.children?.[0];
    if (lineChild && lineChild.geometry?.attributes?.position) {
      c._origEdgePos = new Float32Array(lineChild.geometry.attributes.position.array);
    }
    c._baseCx = c.cx;
    c._baseCy = c.cy;
  }

  let dispField = null;
  let curMix = 0;
  let targetMix = 0;

  function computeField() {
    let totalVotes = 0;
    let totalArea = 0;
    const items = [];

    for (const c of counties) {
      const tot = c.cur?.tot || 0;
      const area = Math.max(0.15, c.area || 1);
      totalVotes += tot;
      totalArea += area;
      items.push({
        c,
        cx: c._baseCx,
        cy: c._baseCy,
        tot,
        area,
        radius: Math.max(3.0, Math.sqrt(area / Math.PI) * 2.2)
      });
    }

    if (totalVotes <= 0) return;

    for (const it of items) {
      const voteShare = it.tot / totalVotes;
      const areaShare = it.area / totalArea;
      // Positive pressure expands high-vote-density regions; negative contracts sparse regions
      const ratio = Math.log2((voteShare + 0.0008) / (areaShare + 0.0008));
      it.pressure = Math.max(-1.4, Math.min(2.3, ratio)) * Math.pow(areaShare + voteShare, 0.34) * 21.0;
    }

    dispField = items;
  }

  function evalDisplacement(x, y) {
    if (!dispField) return [0, 0];
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < dispField.length; i++) {
      const s = dispField[i];
      const rx = x - s.cx;
      const ry = y - s.cy;
      const d2 = rx * rx + ry * ry;
      const R2 = s.radius * s.radius + 42.0;
      const dist = Math.sqrt(d2) + 0.001;
      const falloff = (dist / Math.sqrt(R2)) * Math.exp(-d2 / (2.45 * R2));
      const mag = s.pressure * falloff;
      dx += (rx / dist) * mag;
      dy += (ry / dist) * mag;
    }
    return [dx, dy];
  }

  function prepareTargets() {
    computeField();
    if (!dispField) return;

    for (const c of counties) {
      if (c._origPos) {
        const orig = c._origPos;
        const target = new Float32Array(orig.length);
        for (let i = 0; i < orig.length; i += 3) {
          const ox = orig[i];
          const oy = -orig[i + 2]; // In Y-up XZ plane, z = -y
          const [dx, dy] = evalDisplacement(ox, oy);
          target[i] = ox + dx;
          target[i + 1] = orig[i + 1];
          target[i + 2] = -(oy + dy);
        }
        c._cartoPos = target;
      }

      if (c._origEdgePos) {
        const origE = c._origEdgePos;
        const targetE = new Float32Array(origE.length);
        for (let i = 0; i < origE.length; i += 3) {
          const ox = origE[i];
          const oy = -origE[i + 2];
          const [dx, dy] = evalDisplacement(ox, oy);
          targetE[i] = ox + dx;
          targetE[i + 1] = origE[i + 1];
          targetE[i + 2] = -(oy + dy);
        }
        c._cartoEdgePos = targetE;
      }

      const [cdx, cdy] = evalDisplacement(c._baseCx, c._baseCy);
      c._cartoCx = c._baseCx + cdx;
      c._cartoCy = c._baseCy + cdy;
    }
  }

  function applyMix(mix) {
    curMix = Math.max(0, Math.min(1, mix));
    for (const c of counties) {
      const geom = c.mesh?.geometry;
      if (geom && c._origPos) {
        const orig = c._origPos;
        const carto = c._cartoPos || orig;
        const attr = geom.attributes.position;
        const arr = attr.array;
        for (let i = 0; i < orig.length; i += 3) {
          arr[i] = orig[i] + (carto[i] - orig[i]) * curMix;
          arr[i + 2] = orig[i + 2] + (carto[i + 2] - orig[i + 2]) * curMix;
        }
        attr.needsUpdate = true;
      }

      const lineChild = c.mesh?.children?.[0];
      if (lineChild && c._origEdgePos) {
        const origE = c._origEdgePos;
        const cartoE = c._cartoEdgePos || origE;
        const attrE = lineChild.geometry.attributes.position;
        const arrE = attrE.array;
        for (let i = 0; i < origE.length; i += 3) {
          arrE[i] = origE[i] + (cartoE[i] - origE[i]) * curMix;
          arrE[i + 2] = origE[i + 2] + (cartoE[i + 2] - origE[i + 2]) * curMix;
        }
        attrE.needsUpdate = true;
      }

      c.cx = c._baseCx + ((c._cartoCx ?? c._baseCx) - c._baseCx) * curMix;
      c.cy = c._baseCy + ((c._cartoCy ?? c._baseCy) - c._baseCy) * curMix;
    }
  }

  return {
    prepareTargets,
    setTargetMix(m, immediate = false) {
      targetMix = Math.max(0, Math.min(1, m));
      if (immediate) {
        applyMix(targetMix);
      }
    },
    tick(dt) {
      if (Math.abs(curMix - targetMix) < 0.002) {
        if (curMix !== targetMix) applyMix(targetMix);
        return false;
      }
      const next = curMix + (targetMix - curMix) * Math.min(1, dt * 6.2);
      applyMix(Math.abs(next - targetMix) < 0.003 ? targetMix : next);
      return true;
    },
    evalDisplacement,
    getMix: () => curMix,
    getTargetMix: () => targetMix
  };
}
