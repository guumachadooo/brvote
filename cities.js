// cities.js — 3D City Callout Pins (Y-up coordinate system for estado.html) with dynamic support
// for switching between Estados (27) and Cidades (5.570) on uf=br
import * as THREE from 'three';
import { clampPinPosition } from './callout-logic.js';

function normStr(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\([a-z]{2}\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

function pip(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function makeLabelSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const padX = 18, padY = 10;
  const font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = tw + padX * 2;
  const h = 44;
  canvas.width = w;
  canvas.height = h;

  ctx.font = font;
  ctx.fillStyle = 'rgba(10, 15, 26, 0.86)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.lineWidth = 2;
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(w - r, 1);
  ctx.quadraticCurveTo(w - 1, 1, w - 1, r);
  ctx.lineTo(w - 1, h - r);
  ctx.quadraticCurveTo(w - 1, h - 1, w - r, h - 1);
  ctx.lineTo(r, h - 1);
  ctx.quadraticCurveTo(1, h - 1, 1, h - r);
  ctx.lineTo(1, r);
  ctx.quadraticCurveTo(1, 1, r, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = w / h;
  const spriteH = 2.85;
  sprite.scale.set(spriteH * aspect, spriteH, 1);
  sprite.renderOrder = 12;
  return { sprite, mat };
}

export function createCityMarkers({ group, proj, cityUrl, counties, getTopY }) {
  const markersGroup = new THREE.Group();
  group.add(markersGroup);

  const markers = [];
  const hitMeshes = [];
  const meshToCounty = new Map();
  let curUnitMode = 'county';

  function findCountyForCity(rawX, rawY, cityName) {
    // 1. Check exact polygon containment first
    for (const c of counties) {
      for (const rings of c.polys) {
        if (!pip(rawX, rawY, rings[0])) continue;
        let inHole = false;
        for (let h = 1; h < rings.length; h++) {
          if (pip(rawX, rawY, rings[h])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return c;
      }
    }
    // 2. Fallback by normalized name
    const target = normStr(cityName);
    for (const c of counties) {
      if (normStr(c.name) === target) return c;
    }
    // 3. Nearest interior point
    let best = null;
    let bestD = Infinity;
    for (const c of counties) {
      const d = (c.cx - rawX) ** 2 + (c.cy - rawY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  const STEM_H = 6.2;
  const stemGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, STEM_H, 0)
  ]);
  const headGeom = new THREE.SphereGeometry(0.52, 12, 12);

  fetch(cityUrl)
    .then((r) => (r.ok ? r.json() : []))
    .then((cities) => {
      cities.forEach((city, idx) => {
        const p = proj([city.lon, city.lat]);
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
        const rawX = p[0];
        const rawY = p[1];
        const county = findCountyForCity(rawX, rawY, city.name);
        const [clampedX, clampedY] = clampPinPosition(rawX, rawY, county);

        const pinGroup = new THREE.Group();
        pinGroup.position.set(clampedX, 0.35, -clampedY);

        const stemMat = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.78
        });
        const stem = new THREE.Line(stemGeom, stemMat);

        const headMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.95
        });
        const head = new THREE.Mesh(headGeom, headMat);
        head.position.y = STEM_H;

        const { sprite, mat: spriteMat } = makeLabelSprite(city.name);
        sprite.position.set(0, STEM_H + 2.1, 0);

        pinGroup.add(stem, head, sprite);
        markersGroup.add(pinGroup);

        const mObj = {
          city,
          rank: city.rank || (idx < 8 ? 1 : idx < 18 ? 2 : 3),
          rawX,
          rawY,
          clampedX,
          clampedY,
          curX: clampedX,
          curY: clampedY,
          targetX: clampedX,
          targetY: clampedY,
          county,
          prItem: null,
          pinGroup,
          stemMat,
          head,
          headMat,
          sprite,
          spriteMat
        };
        markers.push(mObj);
        hitMeshes.push(head, sprite);
        meshToCounty.set(head, county);
        meshToCounty.set(sprite, county);
      });
      refreshHeights();
    })
    .catch(() => {});

  function refreshHeights() {
    for (const m of markers) {
      // Smoothly interpolate X/Z pin position when switching between Estados (27) and Cidades (5.570)
      m.curX += (m.targetX - m.curX) * 0.25;
      m.curY += (m.targetY - m.curY) * 0.25;
      m.pinGroup.position.x = m.curX;
      m.pinGroup.position.z = -m.curY;

      if (curUnitMode === 'precinct' && m.prItem) {
        const baseY = m.prItem.currentH || 0.35;
        m.pinGroup.position.y = baseY;
        m.pinGroup.visible = true;
      } else {
        const info = getTopY ? getTopY(m.county) : { baseY: 0.35, lift: 1, visible: true };
        m.pinGroup.position.y = info.baseY;
        m.pinGroup.visible = info.visible !== false;
      }
    }
  }

  return {
    refreshHeights,

    // Switch pin anchor between State interior point ('county') and exact City column ('precinct') on uf=br
    setUnitMode(mode, prCols = null) {
      curUnitMode = mode;
      if (mode === 'precinct' && prCols && prCols.findItemByQuery) {
        for (const m of markers) {
          const item = prCols.findItemByQuery(m.city.name);
          m.prItem = item || null;
          m.targetX = item && Number.isFinite(item.cx) ? item.cx : m.rawX;
          m.targetY = item && Number.isFinite(item.cy) ? item.cy : m.rawY;
        }
      } else {
        for (const m of markers) {
          m.prItem = null;
          m.targetX = m.clampedX;
          m.targetY = m.clampedY;
        }
      }
      refreshHeights();
    },

    // Shift city pins along with Cartogram deformation when Cartogram mode is active
    applyCartogramOffset(evalDispFn, mix) {
      for (const m of markers) {
        const baseX = curUnitMode === 'precinct' ? m.rawX : m.clampedX;
        const baseY = curUnitMode === 'precinct' ? m.rawY : m.clampedY;
        if (mix > 0.001 && evalDispFn) {
          const [dx, dy] = evalDispFn(baseX, baseY);
          m.targetX = baseX + dx * mix;
          m.targetY = baseY + dy * mix;
        } else {
          m.targetX = baseX;
          m.targetY = baseY;
        }
      }
    },

    updateFade(camera) {
      const dist = camera.position.length();
      for (const m of markers) {
        if (!m.pinGroup.visible) continue;
        // Smoothly step pin visibility by zoom level & city rank
        let alpha = 1.0;
        if (m.rank === 2) {
          alpha = THREE.MathUtils.clamp((285 - dist) / 55, 0, 1);
        } else if (m.rank >= 3) {
          alpha = THREE.MathUtils.clamp((215 - dist) / 45, 0, 1);
        }
        m.stemMat.opacity = 0.76 * alpha;
        m.headMat.opacity = 0.95 * alpha;
        m.spriteMat.opacity = alpha;
        m.sprite.visible = alpha > 0.04;
        m.head.visible = alpha > 0.04;
      }
    },

    raycast(raycaster) {
      const hits = raycaster.intersectObjects(hitMeshes, false);
      if (!hits.length) return null;
      return meshToCounty.get(hits[0].object) || null;
    }
  };
}
