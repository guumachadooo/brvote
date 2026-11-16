import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoMercator } from 'd3-geo';
import { STATE } from './state.js';
import { PL_BLUE, PT_RED, OTHER_HEX, marginColorHex } from './colors.js';
import { createContextMap, clampCameraPan } from './context-map.js';

const REP_C = new THREE.Color(PL_BLUE);
const DEM_C = new THREE.Color(PT_RED);
const OTH_C = new THREE.Color(OTHER_HEX);
const BG_C = new THREE.Color(0x080c14);

const mapArea = document.querySelector('.map-area');
const tooltip = document.getElementById('tooltip');
const yearSelect = document.getElementById('yearSelect');
const raceSelect = document.getElementById('raceSelect');
const modeToggle = document.getElementById('modeToggle');
const totD = document.getElementById('totD');
const totR = document.getElementById('totR');
const legD = document.getElementById('legD');
const legR = document.getElementById('legR');

const detailPanel = document.getElementById('detailPanel');
const dpClose = document.getElementById('dpClose');
const dpName = document.getElementById('dpName');
const dpSub = document.getElementById('dpSub');
const dpWinner = document.getElementById('dpWinner');
const dpRows = document.getElementById('dpRows');
const dpTotal = document.getElementById('dpTotal');

const titleH1 = document.querySelector('.title-block h1');
if (titleH1 && STATE?.name) {
  titleH1.textContent = `${STATE.name} — Volume Eleitoral 3D`;
}

const scene = new THREE.Scene();
scene.background = BG_C.clone();

const camera = new THREE.PerspectiveCamera(36, 1, 1, 2000);
const CAM_3D_POS = new THREE.Vector3(0, -195, 165);
const CAM_2D_POS = new THREE.Vector3(0, -0.01, 275);
camera.position.copy(CAM_3D_POS);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
mapArea.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 40;
controls.maxDistance = 600;
controls.target.set(0, 0, 0);
clampCameraPan(controls, camera, 145, false);

const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0b1120, 0.85);
scene.add(hemi);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
dirLight.position.set(85, -120, 210);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -150;
dirLight.shadow.camera.right = 150;
dirLight.shadow.camera.top = 150;
dirLight.shadow.camera.bottom = -150;
dirLight.shadow.camera.near = 20;
dirLight.shadow.camera.far = 480;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.42);
rimLight.position.set(-110, 95, 90);
scene.add(rimLight);

function syncThemeColors() {
  const isLight = document.documentElement.dataset.theme === 'editorial-light';
  scene.background.set(isLight ? 0xf8fafc : 0x080c14);
}
window.addEventListener('brvote:themechange', syncThemeColors);
syncThemeColors();

const mapGroup = new THREE.Group();
scene.add(mapGroup);

let counties = [];
let racesByYear = {};
let allRaces = {};
let curRace = null;
let selectedCounty = null;
let hoveredCounty = null;

const urlParams = new URLSearchParams(window.location.search);
const initStep = urlParams.get('step') || urlParams.get('mode');
let mode = (initStep === 'fill' || initStep === 'pour') ? 'pour' : 'prism';
let targetPrismMix = mode === 'flat' ? 0 : 1;
let prismMix = targetPrismMix;

let camTween = null;
function startCamTween(toPos, toTarget = new THREE.Vector3(0, 0, 0), dur = 0.65) {
  camTween = {
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    t: 0,
    dur,
  };
}

// ============================================================================
// Modern Studio Glass & Brushed Metal Carafe Pitcher ("Balde / Jarro 3D")
// ============================================================================
function makePitcher(liquidColor) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  // Sleek tapered laboratory/studio carafe profile
  const profile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(5.4, 0.0),
    new THREE.Vector2(5.8, 1.2),
    new THREE.Vector2(5.2, 8.5),
    new THREE.Vector2(4.4, 13.5),
    new THREE.Vector2(5.1, 16.2),
    new THREE.Vector2(6.0, 17.5),
  ];
  const glassGeo = new THREE.LatheGeometry(profile, 36);
  glassGeo.rotateX(Math.PI / 2); // Z-up

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0.05,
    reflectivity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  tilt.add(glassMesh);

  // Brushed metallic collar ring & base ring
  const collarGeo = new THREE.TorusGeometry(4.65, 0.38, 16, 36);
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.85,
    roughness: 0.22,
  });
  const collar = new THREE.Mesh(collarGeo, metalMat);
  collar.position.z = 13.5;
  tilt.add(collar);

  const baseRingGeo = new THREE.CylinderGeometry(5.55, 5.55, 0.9, 32);
  baseRingGeo.rotateX(Math.PI / 2);
  const baseRing = new THREE.Mesh(baseRingGeo, metalMat);
  baseRing.position.z = 0.45;
  tilt.add(baseRing);

  // Inner glowing liquid volume
  const liqProfile = [
    new THREE.Vector2(0.0, 0.6),
    new THREE.Vector2(5.0, 0.6),
    new THREE.Vector2(4.8, 7.8),
    new THREE.Vector2(4.1, 13.2),
    new THREE.Vector2(0.0, 13.2),
  ];
  const liqGeo = new THREE.LatheGeometry(liqProfile, 32);
  liqGeo.rotateX(Math.PI / 2);
  const liqMat = new THREE.MeshStandardMaterial({
    color: liquidColor,
    emissive: liquidColor,
    emissiveIntensity: 0.28,
    roughness: 0.18,
    metalness: 0.08,
  });
  const liqMesh = new THREE.Mesh(liqGeo, liqMat);
  tilt.add(liqMesh);

  // Ergonomic curved brushed-metal handle on -X side
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.5, 0, 13.2),
    new THREE.Vector3(-8.4, 0, 12.0),
    new THREE.Vector3(-8.8, 0, 6.2),
    new THREE.Vector3(-5.2, 0, 2.5),
  ]);
  const handleGeo = new THREE.TubeGeometry(handleCurve, 24, 0.52, 12, false);
  const handleMesh = new THREE.Mesh(handleGeo, metalMat);
  tilt.add(handleMesh);

  // Precision pouring lip on +X side
  const lipGeo = new THREE.CylinderGeometry(1.1, 2.0, 3.2, 20, 1, true, -Math.PI * 0.38, Math.PI * 0.76);
  lipGeo.rotateZ(-Math.PI / 4);
  const lipMesh = new THREE.Mesh(lipGeo, metalMat);
  lipMesh.position.set(5.4, 0, 16.8);
  tilt.add(lipMesh);

  // Spout local marker (+X lip tip)
  const spoutMarker = new THREE.Object3D();
  spoutMarker.position.set(6.5, 0, 17.5);
  tilt.add(spoutMarker);

  // Dynamic liquid stream (tapered glowing tube + droplets)
  const streamMat = new THREE.MeshStandardMaterial({
    color: liquidColor,
    emissive: liquidColor,
    emissiveIntensity: 0.45,
    roughness: 0.15,
    transparent: true,
    opacity: 0.92,
  });
  const streamGeo = new THREE.CylinderGeometry(0.42, 1.05, 1, 16);
  streamGeo.translate(0, -0.5, 0);
  streamGeo.rotateX(Math.PI / 2);
  const streamMesh = new THREE.Mesh(streamGeo, streamMat);
  streamMesh.visible = false;
  scene.add(streamMesh);

  // Splash ring at impact point
  const splashGeo = new THREE.RingGeometry(0.5, 2.1, 24);
  const splashMat = new THREE.MeshBasicMaterial({
    color: liquidColor,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const splashMesh = new THREE.Mesh(splashGeo, splashMat);
  splashMesh.visible = false;
  scene.add(splashMesh);

  root.visible = false;
  scene.add(root);

  return {
    root,
    tilt,
    liqMesh,
    spoutMarker,
    streamMesh,
    splashMesh,
    color: liquidColor,
  };
}

const pitcherR = makePitcher(REP_C);
const pitcherD = makePitcher(DEM_C);
const pitcherO = makePitcher(OTH_C);

// ============================================================================
// Five-Stage Two-Pass Pitcher Pour Choreography
// ============================================================================
// Why 5 stages?
// Pass 1 pours the 2nd-place base layers so they sit at the bottom.
// Pass 2 pours the winning layers so they land ON TOP of the 2nd-place base!
// Every drop poured ALWAYS lands on the very top of the column.
const POUR_STAGES = [
  { id: 'O',      pitcher: pitcherO, dur: 1.05, label: 'Outros / 3ª Via (Base)' },
  { id: 'R_base', pitcher: pitcherR, dur: 2.30, label: 'PL / Direita — 1ª Passada (Base onde PT venceu)' },
  { id: 'D_base', pitcher: pitcherD, dur: 2.30, label: 'PT / Esquerda — 1ª Passada (Base onde PL venceu)' },
  { id: 'R_win',  pitcher: pitcherR, dur: 2.50, label: 'PL / Direita — 2ª Passada (Topo vencedor)' },
  { id: 'D_win',  pitcher: pitcherD, dur: 2.50, label: 'PT / Esquerda — 2ª Passada (Topo vencedor)' },
];

const pour = {
  active: false,
  stageIdx: 0,
  stageT: 0,
  fillO: new Float32Array(0),
  fillR: new Float32Array(0),
  fillD: new Float32Array(0),
  done: true,
};

function resetPourArrays(n, filled = true) {
  pour.fillO = new Float32Array(n);
  pour.fillR = new Float32Array(n);
  pour.fillD = new Float32Array(n);
  if (filled) {
    pour.fillO.fill(1);
    pour.fillR.fill(1);
    pour.fillD.fill(1);
    pour.active = false;
    pour.done = true;
  } else {
    pour.active = true;
    pour.done = false;
    pour.stageIdx = 0;
    pour.stageT = 0;
  }
}

function hideAllPitchers() {
  for (const p of [pitcherR, pitcherD, pitcherO]) {
    p.root.visible = false;
    p.streamMesh.visible = false;
    p.splashMesh.visible = false;
  }
}

function startPourAnimation() {
  if (!counties.length) return;
  resetPourArrays(counties.length, false);
  hideAllPitchers();
  // Immediately update stack to empty neutral slate so the map starts blank and paints progressively
  for (const c of counties) {
    stack(c);
  }
}

// ============================================================================
// Stack & Layer Positioning (Eliminates 2D Z-fighting & Flicker)
// ============================================================================
const NEUTRAL_EMPTY_C = new THREE.Color(0x1e293b);

function stack(c) {
  const idx = c.idx;
  const fO = mode === 'pour' ? pour.fillO[idx] : 1;
  const fR = mode === 'pour' ? pour.fillR[idx] : 1;
  const fD = mode === 'pour' ? pour.fillD[idx] : 1;

  // Interpolate smoothly between flat 2D height (0.36) and full 3D volume height
  const flatH = 0.36;
  const hO = THREE.MathUtils.lerp(flatH * (c.shO || 0), c.hO || 0, prismMix) * fO;
  const hR = THREE.MathUtils.lerp(flatH * (c.shR || 0), c.hR || 0, prismMix) * fR;
  const hD = THREE.MathUtils.lerp(flatH * (c.shD || 0), c.hD || 0, prismMix) * fD;

  // Order of stacking from bottom to top:
  // O is always at the bottom (0 .. hO).
  // Then the 2nd-place party is in the middle.
  // Then the winning party is at the very top!
  const rWins = (c.rVotes || 0) >= (c.dVotes || 0);

  let zO = 0, lenO = hO;
  let zR = 0, lenR = hR;
  let zD = 0, lenD = hD;

  if (rWins) {
    // D is 2nd place (middle), R is winner (top)
    zD = lenO;
    zR = lenO + lenD;
  } else {
    // R is 2nd place (middle), D is winner (top)
    zR = lenO;
    zD = lenO + lenR;
  }

  const totalPourFill = fO * (c.shO || 0) + fR * (c.shR || 0) + fD * (c.shD || 0);

  // Base neutral plinth when pour hasn't filled this county yet
  if (mode === 'pour') {
    c.baseMesh.visible = true;
    c.baseMesh.scale.z = 0.22;
    c.baseMesh.position.z = 0;
  } else {
    c.baseMesh.visible = false;
  }

  // Strictly hide zero-height layers (len <= 1e-4) so coplanar caps NEVER z-fight in 2D or during pour!
  if (lenO > 1e-4) {
    c.meshO.visible = true;
    c.meshO.position.z = zO;
    c.meshO.scale.z = lenO;
  } else {
    c.meshO.visible = false;
  }

  if (lenR > 1e-4) {
    c.meshR.visible = true;
    c.meshR.position.z = zR;
    c.meshR.scale.z = lenR;
  } else {
    c.meshR.visible = false;
  }

  if (lenD > 1e-4) {
    c.meshD.visible = true;
    c.meshD.position.z = zD;
    c.meshD.scale.z = lenD;
  } else {
    c.meshD.visible = false;
  }

  const totalZ = lenO + lenR + lenD;
  c.currentTopZ = Math.max(0.22, totalZ);

  // In 2D mode (prismMix < 0.25), blend top cap toward smooth margin choropleth color so 2D looks crisp
  const capColorR = prismMix < 0.25 ? c.marginColor.clone().lerp(REP_C, prismMix * 4) : REP_C;
  const capColorD = prismMix < 0.25 ? c.marginColor.clone().lerp(DEM_C, prismMix * 4) : DEM_C;

  c.matR[0].color.copy(capColorR);
  c.matD[0].color.copy(capColorD);

  // Keep border outline neatly sitting just above the current top surface
  if (c.borderLine) {
    c.borderLine.position.z = c.currentTopZ + 0.08;
    const isSel = c === selectedCounty || c === hoveredCounty;
    c.borderLine.material.opacity = isSel ? 0.95 : (totalPourFill > 0.02 || mode !== 'pour' ? 0.38 : 0.18);
  }
}

// ============================================================================
// Synchronized Swirling Pitcher Trajectory & Pouring Engine
// ============================================================================
function stepPour(dt) {
  if (!pour.active || pour.done) return;

  const stage = POUR_STAGES[pour.stageIdx];
  if (!stage) {
    pour.active = false;
    pour.done = true;
    hideAllPitchers();
    return;
  }

  pour.stageT += dt / stage.dur;
  const u = Math.min(1, pour.stageT);

  // Identify active counties for this stage, sorted in a smooth spatial sweep (West-to-East + North-to-South)
  const activeCounties = stage.counties || [];
  hideAllPitchers();

  if (activeCounties.length > 0) {
    const p = stage.pitcher;
    p.root.visible = true;

    // Progress along the sorted spatial path of counties
    const exactIdx = u * (activeCounties.length - 1);
    const i0 = Math.floor(exactIdx);
    const i1 = Math.min(activeCounties.length - 1, i0 + 1);
    const frac = exactIdx - i0;

    const c0 = activeCounties[i0];
    const c1 = activeCounties[i1];

    const cx = THREE.MathUtils.lerp(c0.cx, c1.cx, frac);
    const cy = THREE.MathUtils.lerp(c0.cy, c1.cy, frac);
    const topZ = THREE.MathUtils.lerp(c0.currentTopZ || 4, c1.currentTopZ || 4, frac);

    // Expressive swirling orbit ("efeito legal de girar") around the target point while pouring
    const swirlAngle = u * Math.PI * 10;
    const swirlRadius = 3.2 * Math.sin(u * Math.PI);
    const targetX = cx + Math.cos(swirlAngle) * swirlRadius;
    const targetY = cy + Math.sin(swirlAngle) * swirlRadius;

    // Position pitcher so its spout is directly above (targetX, targetY)
    const hoverZ = Math.max(26, topZ + 22);
    // Because spout is at +X in local space and tilted down, offset root in -X
    p.root.position.set(targetX - 9.5, targetY, hoverZ);

    // Smoothly tilt carafe forward to pour, and add subtle swirl roll
    const pourTilt = Math.sin(Math.min(1, u * 5) * Math.PI * 0.5) * 0.92;
    p.tilt.rotation.set(
      Math.sin(swirlAngle) * 0.14,
      pourTilt,
      Math.cos(swirlAngle) * 0.10
    );

    p.root.updateMatrixWorld(true);
    const spoutWorld = new THREE.Vector3();
    p.spoutMarker.getWorldPosition(spoutWorld);

    const streamLen = Math.max(1.0, spoutWorld.z - topZ);
    p.streamMesh.visible = true;
    p.streamMesh.position.copy(spoutWorld);
    p.streamMesh.scale.set(1, 1, streamLen);

    p.splashMesh.visible = true;
    p.splashMesh.position.set(spoutWorld.x, spoutWorld.y, topZ + 0.15);
    const pulse = 0.85 + 0.35 * Math.sin(u * 45);
    p.splashMesh.scale.set(pulse, pulse, 1);

    // Synchronize county fill 100% with the pitcher's progression along the sweep!
    const windowWidth = Math.max(1.5, activeCounties.length * 0.14);
    for (let k = 0; k < activeCounties.length; k++) {
      const c = activeCounties[k];
      const localProg = THREE.MathUtils.clamp((exactIdx - k + windowWidth) / windowWidth, 0, 1);
      // Smoothstep easing for liquid rising
      const smoothProg = localProg * localProg * (3 - 2 * localProg);
      if (stage.id === 'O') {
        pour.fillO[c.idx] = Math.max(pour.fillO[c.idx], smoothProg);
      } else if (stage.id === 'R_base' || stage.id === 'R_win') {
        pour.fillR[c.idx] = Math.max(pour.fillR[c.idx], smoothProg);
      } else if (stage.id === 'D_base' || stage.id === 'D_win') {
        pour.fillD[c.idx] = Math.max(pour.fillD[c.idx], smoothProg);
      }
      stack(c);
    }
  }

  if (pour.stageT >= 1) {
    // Ensure 100% fill for all counties in the finished stage
    for (const c of activeCounties) {
      if (stage.id === 'O') pour.fillO[c.idx] = 1;
      else if (stage.id === 'R_base' || stage.id === 'R_win') pour.fillR[c.idx] = 1;
      else if (stage.id === 'D_base' || stage.id === 'D_win') pour.fillD[c.idx] = 1;
      stack(c);
    }
    pour.stageIdx++;
    pour.stageT = 0;
    if (pour.stageIdx >= POUR_STAGES.length) {
      pour.active = false;
      pour.done = true;
      hideAllPitchers();
    }
  }
}

function buildPourSchedule() {
  // Spatial sweep key: West-to-East primary, North-to-South secondary
  const sweepSort = (a, b) => (a.cx - b.cx) + (b.cy - a.cy) * 0.35;

  POUR_STAGES[0].counties = counties.filter(c => (c.hO || 0) > 0.01).sort(sweepSort);
  // Pass 1 (R_base): counties where PT won (so R is 2nd-place base layer)
  POUR_STAGES[1].counties = counties.filter(c => (c.rVotes || 0) < (c.dVotes || 0) && (c.hR || 0) > 0.01).sort(sweepSort);
  // Pass 1 (D_base): counties where PL won (so D is 2nd-place base layer)
  POUR_STAGES[2].counties = counties.filter(c => (c.rVotes || 0) >= (c.dVotes || 0) && (c.hD || 0) > 0.01).sort(sweepSort);
  // Pass 2 (R_win): counties where PL won (so R lands ON TOP of D_base)
  POUR_STAGES[3].counties = counties.filter(c => (c.rVotes || 0) >= (c.dVotes || 0) && (c.hR || 0) > 0.01).sort(sweepSort);
  // Pass 2 (D_win): counties where PT won (so D lands ON TOP of R_base)
  POUR_STAGES[4].counties = counties.filter(c => (c.rVotes || 0) < (c.dVotes || 0) && (c.hD || 0) > 0.01).sort(sweepSort);
}

// ============================================================================
// Geometry Construction & Race Application
// ============================================================================
function ringArea2D(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a * 0.5;
}

function applyRace(raceKey) {
  const race = allRaces[raceKey];
  if (!race) return;
  curRace = race;

  legD.textContent = race.dem || 'PT / Esquerda';
  legR.textContent = race.rep || 'PL / Direita';

  const fmt = new Intl.NumberFormat('pt-BR');
  totD.textContent = fmt.format(race.totals?.D || 0);
  totR.textContent = fmt.format(race.totals?.R || 0);

  // Compute maximum vote density (votes / area) so volume = area * height = total votes!
  let maxDensity = 0;
  for (const c of counties) {
    const [rV, dV, oV] = race.counties?.[c.key] || [0, 0, 0];
    const tot = rV + dV + oV;
    const dens = tot / Math.max(c.area, 12);
    if (dens > maxDensity) maxDensity = dens;
  }
  const MAX_H = 72;
  const scaleH = maxDensity > 0 ? MAX_H / maxDensity : 1;

  for (const c of counties) {
    const [rV, dV, oV] = race.counties?.[c.key] || [0, 0, 0];
    const tot = rV + dV + oV;
    c.rVotes = rV;
    c.dVotes = dV;
    c.oVotes = oV;
    c.totVotes = tot;

    c.shR = tot > 0 ? rV / tot : 0;
    c.shD = tot > 0 ? dV / tot : 0;
    c.shO = tot > 0 ? oV / tot : 0;

    const effArea = Math.max(c.area, 12);
    const totalH = (tot / effArea) * scaleH;
    c.hR = totalH * c.shR;
    c.hD = totalH * c.shD;
    c.hO = totalH * c.shO;

    c.marginColor = new THREE.Color(marginColorHex(rV, dV));
  }

  buildPourSchedule();

  if (mode === 'pour') {
    startPourAnimation();
  } else {
    resetPourArrays(counties.length, true);
    for (const c of counties) stack(c);
  }

  if (selectedCounty) showDetail(selectedCounty);
}

function setMode(newMode) {
  mode = newMode;
  for (const btn of modeToggle.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }

  if (mode === 'flat') {
    targetPrismMix = 0;
    pour.active = false;
    pour.done = true;
    hideAllPitchers();
    resetPourArrays(counties.length, true);
    startCamTween(CAM_2D_POS, new THREE.Vector3(0, 0, 0), 0.65);
  } else if (mode === 'prism') {
    targetPrismMix = 1;
    pour.active = false;
    pour.done = true;
    hideAllPitchers();
    resetPourArrays(counties.length, true);
    if (camera.position.distanceTo(CAM_2D_POS) < 35) {
      startCamTween(CAM_3D_POS, new THREE.Vector3(0, 0, 0), 0.7);
    }
    for (const c of counties) stack(c);
  } else if (mode === 'pour') {
    targetPrismMix = 1;
    prismMix = 1;
    if (camera.position.distanceTo(CAM_2D_POS) < 35) {
      startCamTween(CAM_3D_POS, new THREE.Vector3(0, 0, 0), 0.7);
    }
    startPourAnimation();
  }
}

modeToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  setMode(btn.dataset.mode);
});

// Sync initial active button in HUD
for (const btn of modeToggle.querySelectorAll('button')) {
  btn.classList.toggle('active', btn.dataset.mode === mode);
}

// ============================================================================
// Detail Panel & Tooltip
// ============================================================================
function showDetail(c) {
  selectedCounty = c;
  detailPanel.hidden = false;
  dpName.textContent = c.name;
  dpSub.textContent = `${curRace?.year || ''} · ${curRace?.office || ''}`;

  const fmt = new Intl.NumberFormat('pt-BR');
  const rWins = c.rVotes >= c.dVotes;
  const winName = rWins ? (curRace?.rep || 'PL') : (curRace?.dem || 'PT');
  const winPct = ((rWins ? c.shR : c.shD) * 100).toFixed(1);
  dpWinner.innerHTML = `<span class="${rWins ? 'r' : 'd'}">${winName} +${(Math.abs(c.shR - c.shD) * 100).toFixed(1)}% (${winPct}%)</span>`;

  dpRows.innerHTML = `
    <div class="dp-row"><span class="d">${curRace?.dem || 'PT'}</span><strong>${fmt.format(c.dVotes)} (${(c.shD * 100).toFixed(1)}%)</strong></div>
    <div class="dp-row"><span class="r">${curRace?.rep || 'PL'}</span><strong>${fmt.format(c.rVotes)} (${(c.shR * 100).toFixed(1)}%)</strong></div>
    ${c.oVotes > 0 ? `<div class="dp-row"><span>Outros</span><strong>${fmt.format(c.oVotes)} (${(c.shO * 100).toFixed(1)}%)</strong></div>` : ''}
  `;
  dpTotal.textContent = `Total: ${fmt.format(c.totVotes)} votos`;
}

dpClose.addEventListener('click', () => {
  detailPanel.hidden = true;
  selectedCounty = null;
});

// ============================================================================
// Camera Buttons & Raycasting
// ============================================================================
document.getElementById('zoomIn')?.addEventListener('click', () => {
  camera.position.lerp(controls.target, 0.22);
});
document.getElementById('zoomOut')?.addEventListener('click', () => {
  const dir = camera.position.clone().sub(controls.target).multiplyScalar(1.25);
  camera.position.copy(controls.target).add(dir);
});
document.getElementById('camReset')?.addEventListener('click', () => {
  startCamTween(CAM_3D_POS, new THREE.Vector3(0, 0, 0), 0.65);
});
document.getElementById('camTop')?.addEventListener('click', () => {
  setMode(mode === 'flat' ? 'prism' : 'flat');
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickMeshes = [];

renderer.domElement.addEventListener('pointermove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (hits.length > 0) {
    const c = hits[0].object.userData.county;
    if (c) {
      hoveredCounty = c;
      const fmt = new Intl.NumberFormat('pt-BR');
      tooltip.hidden = false;
      tooltip.style.left = `${e.clientX - rect.left + 14}px`;
      tooltip.style.top = `${e.clientY - rect.top + 14}px`;
      tooltip.innerHTML = `<strong>${c.name}</strong><br/>${fmt.format(c.totVotes)} votos`;
      return;
    }
  }
  hoveredCounty = null;
  tooltip.hidden = true;
});

let downPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;
  if (hoveredCounty) showDetail(hoveredCounty);
});

// ============================================================================
// Load Data via STATE & Build 3D Prisms
// ============================================================================
async function init() {
  const [geo, r2026, rHist] = await Promise.all([
    fetch(STATE.data.geo).then(r => r.json()),
    fetch(STATE.data.r2026).then(r => r.json()),
    STATE.data.history ? fetch(STATE.data.history).then(r => r.json()) : Promise.resolve({ order: [], races: {} }),
  ]);

  const features = (geo.features || []).filter(f => f.geometry);
  const proj = geoMercator().fitSize([220, 220], { type: 'FeatureCollection', features });

  // Add surrounding geographic context map (Z-up: yUp = false)
  createContextMap({
    group: scene,
    proj: (lon, lat) => {
      const p = proj([lon, lat]);
      return p ? [p[0] - 110, 110 - p[1]] : [NaN, NaN];
    },
    uf: STATE.uf,
    yUp: false,
  });

  counties = features.map((f, idx) => {
    const name = f.properties.name || `Município ${idx + 1}`;
    const key = name.toUpperCase();
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

    const shapes = [];
    const borderPts = [];
    let area = 0;
    let cx = 0;
    let cy = 0;
    let nPts = 0;

    for (const poly of polys) {
      const outer = poly[0].map(([lon, lat]) => {
        const [px, py] = proj([lon, lat]);
        return [px - 110, 110 - py];
      });
      if (outer.length < 3) continue;
      const a = Math.abs(ringArea2D(outer));
      area += a;

      const sh = new THREE.Shape();
      outer.forEach(([x, y], i) => {
        if (i === 0) sh.moveTo(x, y);
        else sh.lineTo(x, y);
        cx += x;
        cy += y;
        nPts++;
      });

      for (let h = 1; h < poly.length; h++) {
        const holeRing = poly[h].map(([lon, lat]) => {
          const [px, py] = proj([lon, lat]);
          return [px - 110, 110 - py];
        });
        if (holeRing.length >= 3) {
          const hp = new THREE.Path();
          holeRing.forEach(([x, y], i) => (i === 0 ? hp.moveTo(x, y) : hp.lineTo(x, y)));
          sh.holes.push(hp);
        }
      }
      shapes.push(sh);

      for (let i = 0; i < outer.length; i++) {
        const [x1, y1] = outer[i];
        const [x2, y2] = outer[(i + 1) % outer.length];
        borderPts.push(new THREE.Vector3(x1, y1, 0), new THREE.Vector3(x2, y2, 0));
      }
    }

    if (nPts > 0) {
      cx /= nPts;
      cy /= nPts;
    }

    const extGeo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });

    const makePartyMats = (col) => [
      new THREE.MeshStandardMaterial({ color: col.clone(), roughness: 0.35, metalness: 0.06 }),
      new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.78), roughness: 0.52, metalness: 0.08 }),
    ];

    const matR = makePartyMats(REP_C);
    const matD = makePartyMats(DEM_C);
    const matO = makePartyMats(OTH_C);
    const matBase = new THREE.MeshStandardMaterial({ color: NEUTRAL_EMPTY_C, roughness: 0.7, metalness: 0.1 });

    const meshR = new THREE.Mesh(extGeo, matR);
    const meshD = new THREE.Mesh(extGeo, matD);
    const meshO = new THREE.Mesh(extGeo, matO);
    const baseMesh = new THREE.Mesh(extGeo, matBase);
    baseMesh.visible = false;

    meshR.castShadow = true;
    meshR.receiveShadow = true;
    meshD.castShadow = true;
    meshD.receiveShadow = true;

    mapGroup.add(baseMesh, meshO, meshR, meshD);

    const lineGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.38 });
    const borderLine = new THREE.LineSegments(lineGeo, lineMat);
    mapGroup.add(borderLine);

    const countyObj = {
      idx,
      name,
      key,
      area: Math.max(area, 1),
      cx,
      cy,
      meshR,
      meshD,
      meshO,
      baseMesh,
      matR,
      matD,
      matO,
      borderLine,
      marginColor: OTH_C.clone(),
      currentTopZ: 1,
    };

    meshR.userData.county = countyObj;
    meshD.userData.county = countyObj;
    meshO.userData.county = countyObj;
    baseMesh.userData.county = countyObj;
    pickMeshes.push(meshR, meshD, meshO, baseMesh);

    return countyObj;
  });

  // Merge races from r2026 and rHist
  allRaces = { ...(rHist.races || {}), ...(r2026.races || {}) };
  const order = [...(r2026.order || []), ...(rHist.order || [])];

  racesByYear = {};
  for (const rk of order) {
    const r = allRaces[rk];
    if (!r) continue;
    const y = String(r.year);
    if (!racesByYear[y]) racesByYear[y] = [];
    racesByYear[y].push({ key: rk, label: r.office || rk });
  }

  const years = Object.keys(racesByYear).sort((a, b) => Number(b) - Number(a));
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  function populateRacesForYear(y) {
    const list = racesByYear[y] || [];
    raceSelect.innerHTML = list.map(item => `<option value="${item.key}">${item.label}</option>`).join('');
    if (list.length > 0) applyRace(list[0].key);
  }

  yearSelect.addEventListener('change', () => populateRacesForYear(yearSelect.value));
  raceSelect.addEventListener('change', () => applyRace(raceSelect.value));

  if (years.length > 0) {
    yearSelect.value = years[0];
    populateRacesForYear(years[0]);
  }
}

function onResize() {
  const w = mapArea.clientWidth || window.innerWidth;
  const h = mapArea.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

let lastT = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (camTween) {
    camTween.t += dt / camTween.dur;
    const k = Math.min(1, camTween.t);
    const ease = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, ease);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, ease);
    if (k >= 1) camTween = null;
  }

  if (Math.abs(prismMix - targetPrismMix) > 1e-4) {
    const step = dt * 2.8;
    if (prismMix < targetPrismMix) prismMix = Math.min(targetPrismMix, prismMix + step);
    else prismMix = Math.max(targetPrismMix, prismMix - step);
    for (const c of counties) stack(c);
  } else if (prismMix !== targetPrismMix) {
    prismMix = targetPrismMix;
    for (const c of counties) stack(c);
  }

  if (mode === 'pour' && pour.active) {
    stepPour(dt);
  }

  controls.update();
  renderer.render(scene, camera);
}

init().then(() => {
  requestAnimationFrame(animate);
});
