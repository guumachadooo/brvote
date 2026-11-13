// Cena Three.js compartilhada para as páginas de storytelling (story, misread, shade-by-votes) usando a malha real do IBGE
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { marginColorHex, leadColorHex, OTHER_HEX } from './colors.js';

export const MAX_H = 75;
export const BASE_H = 0.35;

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
  scene.background = new THREE.Color(0x0b0e14);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 40;
  controls.maxDistance = 650;
  controls.enabled = interactive;

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(80, 180, 100);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9ab3d9, 0.25);
  fill.position.set(-100, 90, -80);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

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
    let cx = 0, cy = 0, n = 0, area = 0;
    for (const poly of polys) {
      const outer = ringToVec2(poly[0]);
      if (outer.length < 3) continue;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length];
        area += (a.x * b.y - b.x * a.y);
        cx += a.x; cy += a.y; n++;
      }
      const sh = new THREE.Shape(outer);
      for (let h = 1; h < poly.length; h++) {
        const hole = ringToVec2(poly[h]);
        if (hole.length >= 3) sh.holes.push(new THREE.Path(hole));
      }
      shapes.push(sh);
    }
    if (!shapes.length) continue;
    cx /= n; cy /= n;
    area = Math.abs(area) * 0.5;

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
  let animDur = 650;

  let camFromPos = new THREE.Vector3(0, 290, 0.01);
  let camToPos   = new THREE.Vector3(0, 290, 0.01);
  let camFromTgt = new THREE.Vector3(0, 0, 0);
  let camToTgt   = new THREE.Vector3(0, 0, 0);
  let camStart = 0, camDur = 900;
  camera.position.copy(camToPos);
  controls.target.copy(camToTgt);
  controls.update();

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
    dur = 700,
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

  function setCamera({ pos, target = [0, 0, 0], dur = 900 }) {
    camFromPos.copy(camera.position);
    camFromTgt.copy(controls.target);
    camToPos.set(pos[0], pos[1], pos[2]);
    camToTgt.set(target[0], target[1], target[2]);
    camStart = performance.now();
    camDur = dur;
  }

  function getCounty(name) {
    return byKey.get(name.toUpperCase());
  }

  function projectToScreen(worldVec) {
    const v = worldVec.clone().project(camera);
    const rect = stage.getBoundingClientRect();
    return {
      x: (v.x *  0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1,
    };
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let onTick = null;
  function tick(now) {
    const t = Math.min(1, (now - animStart) / animDur);
    const e = 1 - Math.pow(1 - t, 3);
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

    if (camDur > 0 && now - camStart <= camDur + 32) {
      const ct = Math.min(1, (now - camStart) / camDur);
      const ce = ct < 0.5 ? 4 * ct * ct * ct : 1 - Math.pow(-2 * ct + 2, 3) / 2;
      camera.position.lerpVectors(camFromPos, camToPos, ce);
      controls.target.lerpVectors(camFromTgt, camToTgt, ce);
    }
    controls.update();
    if (onTick) onTick();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    counties, races, byKey, group, camera, controls,
    applyState, setCamera, getCounty, projectToScreen,
    onTick(fn) { onTick = fn; },
    getMaxVotes: () => maxVotes,
  };
}
