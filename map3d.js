// Cena Three.js compartilhada para as páginas de storytelling (story, misread, shade-by-votes) usando a malha real do IBGE
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { marginColorHex, leadColorHex, OTHER_HEX } from './colors.js';

export const MAX_H = 75;
export const BASE_H = 0.35;

const easeQuint = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function computeInteriorPoint(ring) {
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
    return { cx, cy, area: Math.abs(area2) * 0.5 };
  }
  // Fallback para polígonos côncavos/arquipélagos: encontra o maior segmento interno na linha horizontal central
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
      return { cx: bestMid, cy: ty, area: Math.abs(area2) * 0.5 };
    }
  }
  return { cx, cy, area: Math.abs(area2) * 0.5 };
}

export async function createMap3D(stage, { interactive = false } = {}) {
  const [geo, r2026, rHist] = await Promise.all([
    fetch(STATE.data.geo).then(r => r.json()),
    fetch(STATE.data.r2026).then(r => r.json()),
    fetch(STATE.data.history).then(r => r.json()),
  ]);

  const races = { ...r2026.races, ...rHist.races };
  const features = geo.features || [];

  const W = 220, H = 220;
  const proj = geoMercator().fitSize([W, H], { type: 'FeatureCollection', features });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07131a);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 40;
  controls.maxDistance = 850;
  controls.enabled = interactive;

  scene.add(new THREE.AmbientLight(0xffffff, 0.74));
  const sun = new THREE.DirectionalLight(0xffffff, 0.78);
  sun.position.set(80, 180, 100);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8be2b8, 0.25);
  fill.position.set(-100, 90, -80);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

  const pinGroup = new THREE.Group();
  scene.add(pinGroup);

  function ringToVec2(ring) {
    const pts = [];
    for (const ll of ring) {
      const p = proj(ll);
      if (p && isFinite(p[0]) && isFinite(p[1])) pts.push(new THREE.Vector2(p[0] - W / 2, -(p[1] - H / 2)));
    }
    return pts;
  }

  const counties = [];
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.55 });
  const otherMat = new THREE.MeshLambertMaterial({ color: OTHER_HEX });

  for (const f of features) {
    const rawName = (f.properties && f.properties.name) || '';
    const geom = f.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const shapes = [];
    let bestRing = null;
    let bestRingArea = -1;
    let totalArea = 0;

    for (const poly of polys) {
      const outer = ringToVec2(poly[0]);
      if (outer.length < 3) continue;
      let ringArea2 = 0;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length];
        ringArea2 += (a.x * b.y - b.x * a.y);
      }
      const absArea = Math.abs(ringArea2) * 0.5;
      totalArea += absArea;
      if (absArea > bestRingArea) {
        bestRingArea = absArea;
        bestRing = outer;
      }
      const sh = new THREE.Shape(outer);
      for (let h = 1; h < poly.length; h++) {
        const hole = ringToVec2(poly[h]);
        if (hole.length >= 3) sh.holes.push(new THREE.Path(hole));
      }
      shapes.push(sh);
    }
    if (!shapes.length || !bestRing) continue;
    const { cx, cy } = computeInteriorPoint(bestRing);
    const area = totalArea;

    const ext = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    ext.rotateX(-Math.PI / 2);

    const lowerMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const lower = new THREE.Mesh(ext, lowerMat);
    group.add(lower);

    const mid = new THREE.Mesh(ext, otherMat);
    mid.visible = false;
    group.add(mid);

    const topMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const mesh = new THREE.Mesh(ext, topMat);
    const edges = new THREE.EdgesGeometry(ext, 25);
    mesh.add(new THREE.LineSegments(edges, edgeMat));
    group.add(mesh);

    counties.push({
      name: rawName, key: rawName.toUpperCase(),
      mesh, mat: topMat, lower, lowerMat, mid,
      cx, cy, area,
      fromBot: 0.01, fromMid: 0, fromTop: BASE_H,
      toBot: 0.01, toMid: 0, toTop: BASE_H,
      curBot: 0.01, curMid: 0, curTop: BASE_H,
      fromWinCol: new THREE.Color(0x333333), toWinCol: new THREE.Color(0x333333),
      fromLoseCol: new THREE.Color(0x333333), toLoseCol: new THREE.Color(0x333333),
      cur: { r: 0, d: 0, o: 0, tot: 0, m: 0, win: 'R' },
    });
  }

  const byKey = new Map(counties.map(c => [c.key, c]));

  let activeRace = null;
  let maxVotes = 1;
  let maxLead = 1;
  let animStart = 0;
  let animDur = 900;

  let camFromPos = new THREE.Vector3(0, 340, 0.01);
  let camToPos   = new THREE.Vector3(0, 340, 0.01);
  let camFromTgt = new THREE.Vector3(0, 0, 0);
  let camToTgt   = new THREE.Vector3(0, 0, 0);
  let camStart = 0, camDur = 1150;
  camera.position.copy(camToPos);
  controls.target.copy(camToTgt);
  controls.update();

  // Cancela animação automática de câmera assim que o usuário interage manualmente com o mapa
  const cancelCamAnim = () => { camDur = 0; };
  renderer.domElement.addEventListener('pointerdown', cancelCamAnim);
  renderer.domElement.addEventListener('wheel', cancelCamAnim, { passive: true });
  renderer.domElement.addEventListener('touchstart', cancelCamAnim, { passive: true });

  // Marcadores 3D reais fixados no centroide interno de cada município destacado
  const pinMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
  const pinRingMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  let pinMarkers = [];

  function setPins(countyNames = []) {
    while (pinGroup.children.length) {
      pinGroup.remove(pinGroup.children[0]);
    }
    pinMarkers = [];
    for (const raw of countyNames) {
      const c = getCounty(typeof raw === 'string' ? raw : raw.county);
      if (!c) continue;
      const holder = new THREE.Group();
      const baseRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.9, 24), pinRingMat);
      baseRing.rotation.x = -Math.PI / 2;
      baseRing.position.y = 0.15;
      holder.add(baseRing);

      const head = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 16), pinMat);
      head.position.y = 0.25;
      holder.add(head);

      const topY = c.curBot + c.curMid + c.curTop;
      holder.position.set(c.cx, topY, -c.cy);
      pinGroup.add(holder);
      pinMarkers.push({ c, holder });
    }
  }

  function loadRace(raceId) {
    activeRace = races[raceId];
    if (!activeRace) return;
    maxVotes = 1;
    maxLead = 1;
    for (const c of counties) {
      const row = activeRace.counties[c.key] || activeRace.counties[c.name] || [0, 0, 0];
      const r = row[0] || 0, d = row[1] || 0, o = row[2] || 0;
      const tot = r + d + o;
      const m = (r + d) ? ((r - d) / (r + d)) * 100 : 0;
      c.cur = { r, d, o, tot, m, win: r >= d ? 'R' : 'D' };
      if (tot > maxVotes) maxVotes = tot;
      const lead = Math.abs(r - d);
      if (lead > maxLead) maxLead = lead;
    }
  }

  function applyState({
    raceId = STATE.defaultRace || '2026-pres-2t',
    raise = 0,
    colorMode = 'margin',
    split = true,
    focus = null,
    dimOthers = false,
    dur = 900,
  }) {
    if (!activeRace || activeRace._id !== raceId) {
      loadRace(raceId);
      if (activeRace) activeRace._id = raceId;
    }
    const focusSet = focus ? new Set(focus.map(n => n.toUpperCase())) : null;

    for (const c of counties) {
      c.fromBot = c.curBot; c.fromMid = c.curMid; c.fromTop = c.curTop;
      c.fromWinCol.copy(c.mat.color);
      c.fromLoseCol.copy(c.lowerMat.color);

      const { r, d, o, tot } = c.cur;
      const fullH = tot > 0 ? BASE_H + (tot / maxVotes) * MAX_H : BASE_H;
      const h = BASE_H + (fullH - BASE_H) * raise;

      const isFocused = !focusSet || focusSet.has(c.key);
      const rWins = r >= d;
      const winVotes = rWins ? r : d;
      const loseVotes = rWins ? d : r;

      if (raise > 0.02 && split && tot > 0 && winVotes > 0 && loseVotes > 0) {
        c.toBot = Math.max(0.02, h * (loseVotes / tot));
        c.toMid = o > 0 ? h * (o / tot) : 0;
        c.toTop = Math.max(0.02, h - c.toBot - c.toMid);
      } else {
        c.toBot = 0.01;
        c.toMid = 0;
        c.toTop = Math.max(0.02, h - 0.01);
      }

      let winHex;
      if (colorMode === 'lead') {
        winHex = leadColorHex(r, d, maxLead);
      } else if (colorMode === 'winner') {
        winHex = r >= d ? '#3b5bdb' : '#d72f30';
      } else {
        winHex = marginColorHex(r, d);
      }
      const loseHex = rWins ? marginColorHex(0, 1) : marginColorHex(1, 0);

      const winCol = new THREE.Color(winHex);
      const loseCol = new THREE.Color(loseHex);
      if (dimOthers && !isFocused) {
        winCol.lerp(new THREE.Color(0x161c28), 0.78);
        loseCol.lerp(new THREE.Color(0x161c28), 0.78);
      }
      c.toWinCol.copy(winCol);
      c.toLoseCol.copy(loseCol);
    }
    animStart = performance.now();
    animDur = dur;
  }

  function setCamera({ pos, target = [0, 0, 0], dur = 1150 }) {
    const w = stage.clientWidth || 800;
    const h = stage.clientHeight || 600;
    const aspect = w / Math.max(1, h);
    // Afasta suavemente a câmera em telas estreitas ou baixas para nunca cortar o mapa
    const fitMult = aspect < 1.05 ? Math.min(1.42, 1.08 / Math.max(0.62, aspect)) : 1.08;
    const tx = target[0], ty = target[1], tz = target[2];
    const dx = (pos[0] - tx) * fitMult;
    const dy = (pos[1] - ty) * fitMult;
    const dz = (pos[2] - tz) * fitMult;
    camFromPos.copy(camera.position);
    camFromTgt.copy(controls.target);
    camToPos.set(tx + dx, ty + dy, tz + dz);
    camToTgt.set(tx, ty, tz);
    camStart = performance.now();
    camDur = dur;
  }

  function getCounty(name) {
    return byKey.get(String(name || '').toUpperCase());
  }

  function projectToScreen(worldVec) {
    camera.updateMatrixWorld();
    const v = worldVec.clone().project(camera);
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    const x = (v.x *  0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    const visible = v.z > -1 && v.z < 1 && x >= 8 && x <= w - 8 && y >= 8 && y <= h - 8;
    return { x, y, visible };
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(stage);
  }
  resize();

  let onTick = null;
  function tick(now) {
    const t = Math.min(1, (now - animStart) / Math.max(1, animDur));
    const e = easeQuint(t);
    for (const c of counties) {
      const bot = c.fromBot + (c.toBot - c.fromBot) * e;
      const mid = c.fromMid + (c.toMid - c.fromMid) * e;
      const top = c.fromTop + (c.toTop - c.fromTop) * e;
      c.curBot = bot; c.curMid = mid; c.curTop = top;
      c.lower.scale.y = bot;
      if (mid > 0.005) {
        c.mid.visible = true;
        c.mid.position.y = bot;
        c.mid.scale.y = mid;
      } else {
        c.mid.visible = false;
      }
      c.mesh.position.y = bot + mid;
      c.mesh.scale.y = top;
      c.mat.color.lerpColors(c.fromWinCol, c.toWinCol, e);
      c.lowerMat.color.lerpColors(c.fromLoseCol, c.toLoseCol, e);
    }

    for (const pm of pinMarkers) {
      const topY = pm.c.curBot + pm.c.curMid + pm.c.curTop;
      pm.holder.position.set(pm.c.cx, topY, -pm.c.cy);
    }

    if (camDur > 0 && now - camStart <= camDur + 32) {
      const ct = Math.min(1, (now - camStart) / camDur);
      const ce = easeQuint(ct);
      camera.position.lerpVectors(camFromPos, camToPos, ce);
      controls.target.lerpVectors(camFromTgt, camToTgt, ce);
    }
    controls.update();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    if (onTick) onTick();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    counties, races, byKey, group, camera, controls,
    applyState, setCamera, setPins, getCounty, projectToScreen,
    onTick(fn) { onTick = fn; },
    getMaxVotes: () => maxVotes,
  };
}
