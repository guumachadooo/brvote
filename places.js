// Barra de busca rápida original do usavote: Ir para Cidade / Município / Zona Eleitoral
import * as THREE from 'three';

const fmt = n => Math.round(n).toLocaleString('pt-BR');

export function createPlaceFinder({
  counties, group, camera, controls, proj,
  cityUrl, precinctUrl, precinctShapesUrl,
  onSelectCounty, onClearCounty, onSelectPrecinct,
  getRaceInfo, onCameraChange,
}) {
  const goCity = document.getElementById('goCity');
  const goCounty = document.getElementById('goCounty');
  const goPrecinct = document.getElementById('goPrecinct');
  const infoEl = document.getElementById('placeInfo');

  const sortedCounties = [...counties].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  goCounty.innerHTML = `<option value="">Ir para município (${counties.length})…</option>` +
    sortedCounties.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

  const byUpper = new Map(counties.map(c => [c.name.toUpperCase(), c]));

  let cities = [];
  if (cityUrl) {
    fetch(cityUrl).then(r => r.json()).then(list => {
      cities = list.filter(c => {
        const p = proj([c.lon, c.lat]);
        return p && isFinite(p[0]) && isFinite(p[1]);
      });
      goCity.innerHTML = `<option value="">Ir para cidade (${cities.length})…</option>` +
        cities.map((c, i) =>
          `<option value="${i}">${c.name} (${fmt(c.pop)})</option>`
        ).join('');
    }).catch(() => { goCity.style.display = 'none'; });
  } else {
    goCity.style.display = 'none';
  }

  let prData = null;
  let prShapes = null;
  if (precinctUrl) {
    fetch(precinctUrl).then(r => r.json()).then(d => {
      prData = d;
      if (goCounty.value) populatePrecincts(goCounty.value);
    }).catch(() => {});
  }
  if (precinctShapesUrl) {
    fetch(precinctShapesUrl).then(r => r.json()).then(d => { prShapes = d; }).catch(() => {});
  }

  const pinGroup = new THREE.Group();
  pinGroup.visible = false;
  pinGroup.renderOrder = 5;
  const stemGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 10);
  stemGeo.translate(0, 0.5, 0);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  const headGeo = new THREE.SphereGeometry(0.95, 16, 12);
  const head = new THREE.Mesh(headGeo, stemMat);
  const ringGeo = new THREE.RingGeometry(1.4, 2.1, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.25;
  pinGroup.add(stem, head, ring);
  group.add(pinGroup);

  function showPin(x, z, baseY) {
    const stemH = 14;
    pinGroup.position.set(x, 0, z);
    stem.position.y = baseY;
    stem.scale.set(1, stemH, 1);
    head.position.y = baseY + stemH;
    ring.position.y = Math.max(0.25, baseY + 0.15);
    pinGroup.visible = true;
  }
  function hidePin() { pinGroup.visible = false; }

  const prHighlight = new THREE.Group();
  prHighlight.visible = false;
  prHighlight.renderOrder = 6;
  const prFillMat = new THREE.MeshBasicMaterial({
    color: 0xf2c14e, transparent: true, opacity: 0.32,
    side: THREE.DoubleSide, depthTest: false,
  });
  const prLineMat = new THREE.LineBasicMaterial({ color: 0xf2c14e, depthTest: false });
  group.add(prHighlight);

  function clearPrecinctHighlight() {
    while (prHighlight.children.length) {
      const ch = prHighlight.children.pop();
      if (ch.geometry) ch.geometry.dispose();
    }
    prHighlight.visible = false;
  }

  function showPrecinctHighlight(polys, topY) {
    clearPrecinctHighlight();
    if (!polys || !polys.length) return;
    let cx = 0, cy = 0, n = 0;
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
      for (const r of rings) {
        const pts = r.map(([x, y]) => { cx += x; cy += y; n++; return new THREE.Vector3(x, 0, -y); });
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        prHighlight.add(new THREE.Line(lg, prLineMat));
      }
    }
    if (shapes.length) {
      const fg = new THREE.ShapeGeometry(shapes);
      fg.rotateX(-Math.PI / 2);
      prHighlight.add(new THREE.Mesh(fg, prFillMat));
    }
    prHighlight.position.y = (topY || 0.4) + 0.25;
    prHighlight.visible = true;
    return n ? [cx / n, -cy / n] : null;
  }

  let anim = null;
  function flyTo(tx, tz, dist, heightRatio = 0.62) {
    onCameraChange();
    const fromTarget = controls.target.clone();
    const fromPos = camera.position.clone();
    const toTarget = new THREE.Vector3(tx, 0, tz);
    const toPos = new THREE.Vector3(tx, dist * heightRatio, tz + dist * 0.78);
    const t0 = performance.now();
    const dur = 650;
    if (anim) cancelAnimationFrame(anim);
    function step(now) {
      const u = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - u, 3);
      controls.target.lerpVectors(fromTarget, toTarget, e);
      camera.position.lerpVectors(fromPos, toPos, e);
      controls.update();
      if (u < 1) anim = requestAnimationFrame(step);
      else anim = null;
    }
    anim = requestAnimationFrame(step);
  }

  function populatePrecincts(countyName) {
    const key = countyName ? countyName.toUpperCase() : '';
    const list = prData && key && prData.counties[key];
    if (!list || !list.length) {
      goPrecinct.disabled = true;
      goPrecinct.innerHTML = `<option value="">Zona Eleitoral (escolha um município)…</option>`;
      return;
    }
    goPrecinct.disabled = false;
    goPrecinct.innerHTML =
      `<option value="">Todas as ${list.length} zonas eleitorais em ${countyName}…</option>` +
      list.map((p, i) =>
        `<option value="${i}">Zona ${p[0]} (${fmt(p[1])} eleitores)</option>`
      ).join('');
  }

  let activeCity = null;
  let activeCounty = null;
  let activePrecinctIdx = null;

  function renderInfo() {
    if (!activeCounty && !activeCity) {
      infoEl.innerHTML = '';
      return;
    }
    const { raceKey, rName, dName } = getRaceInfo();
    const parts = [];
    if (activeCity) {
      parts.push(`<b>${activeCity.name}</b> (pop. ${fmt(activeCity.pop)}) · Município de ${activeCity.county}`);
    } else if (activeCounty) {
      parts.push(`<b>Município de ${activeCounty.name}</b>`);
    }
    const cname = activeCounty ? activeCounty.name.toUpperCase() : '';
    const pList = prData && cname && prData.counties[cname];
    if (activePrecinctIdx != null && pList && pList[activePrecinctIdx]) {
      const p = pList[activePrecinctIdx];
      const rIdx = prData.races[raceKey];
      const v = rIdx != null ? p[3][rIdx] : null;
      let s = `Zona <b>${p[0]}</b>: ${fmt(p[1])} eleitores`;
      if (v && (v[0] + v[1] + v[2]) > 0) {
        const tot = v[0] + v[1] + v[2];
        const rPct = ((v[0] / tot) * 100).toFixed(1);
        const dPct = ((v[1] / tot) * 100).toFixed(1);
        s += ` · <span class="rep-t">${rName} ${fmt(v[0])} (${rPct}%)</span>` +
             ` vs. <span class="dem-t">${dName} ${fmt(v[1])} (${dPct}%)</span>`;
      }
      parts.push(s);
    } else if (activeCounty && activeCounty.cur) {
      const { r, d, tot } = activeCounty.cur;
      if (tot > 0) {
        const rPct = ((r / tot) * 100).toFixed(1);
        const dPct = ((d / tot) * 100).toFixed(1);
        parts.push(
          `<span class="rep-t">${rName} ${fmt(r)} (${rPct}%)</span> vs. ` +
          `<span class="dem-t">${dName} ${fmt(d)} (${dPct}%)</span>` +
          (pList ? ` · ${pList.length} zonas` : '')
        );
      }
    }
    infoEl.innerHTML = parts.join(' — ') +
      ` <button class="pi-clear" id="piClear" title="Limpar seleção">✕</button>`;
    document.getElementById('piClear').onclick = clearAll;
  }

  function selectCountyInternal(c, fly = true) {
    activeCounty = c;
    activePrecinctIdx = null;
    clearPrecinctHighlight();
    if (!c) {
      goCounty.value = '';
      populatePrecincts('');
      onClearCounty();
      renderInfo();
      return;
    }
    goCounty.value = c.name;
    populatePrecincts(c.name);
    onSelectCounty(c);
    if (fly) {
      const span = Math.max(c.span || 12, 10);
      flyTo(c.cx, -c.cy, Math.max(55, span * 3.2));
    }
    renderInfo();
  }

  function clearAll() {
    activeCity = null;
    activeCounty = null;
    activePrecinctIdx = null;
    goCity.value = '';
    goCounty.value = '';
    populatePrecincts('');
    hidePin();
    clearPrecinctHighlight();
    onClearCounty();
    onSelectPrecinct(null);
    renderInfo();
  }

  goCity.onchange = () => {
    const idx = goCity.value === '' ? null : +goCity.value;
    if (idx == null) { activeCity = null; hidePin(); renderInfo(); return; }
    const city = cities[idx];
    activeCity = city;
    const [x, y] = proj([city.lon, city.lat]);
    const c = byUpper.get(city.county.toUpperCase()) || null;
    selectCountyInternal(c, false);
    const baseY = c ? (c.targetH || 0.4) : 0.4;
    showPin(x, -y, baseY);
    flyTo(x, -y, 68, 0.55);
    renderInfo();
  };

  goCounty.onchange = () => {
    activeCity = null;
    hidePin();
    const name = goCounty.value;
    if (!name) { selectCountyInternal(null); return; }
    const c = counties.find(k => k.name === name) || null;
    selectCountyInternal(c, true);
  };

  goPrecinct.onchange = () => {
    activePrecinctIdx = goPrecinct.value === '' ? null : +goPrecinct.value;
    if (activePrecinctIdx != null && activeCounty && prData) {
      const cname = activeCounty.name.toUpperCase();
      const pRow = prData.counties[cname] && prData.counties[cname][activePrecinctIdx];
      const pCode = pRow ? pRow[0] : null;
      const did3d = onSelectPrecinct && onSelectPrecinct(
        pCode != null ? { countyUpper: cname, code: pCode } : null
      );
      const sList = prShapes && prShapes[ cname ];
      const polys = sList && sList[activePrecinctIdx];
      if (polys && polys.length) {
        if (did3d) clearPrecinctHighlight();
        const topY = activeCounty.targetH || 0.4;
        const center = did3d ? centroidOfPolys(polys) : showPrecinctHighlight(polys, topY);
        if (center) flyTo(center[0], center[1], 38, 0.52);
      } else {
        clearPrecinctHighlight();
      }
    } else {
      clearPrecinctHighlight();
      if (onSelectPrecinct) onSelectPrecinct(null);
    }
    renderInfo();
  };

  function centroidOfPolys(polys) {
    let cx = 0, cy = 0, n = 0;
    for (const rings of polys) for (const r of rings) for (const [x, y] of r) { cx += x; cy += y; n++; }
    return n ? [cx / n, -cy / n] : null;
  }

  return {
    refresh() {
      if (activeCity && activeCounty) {
        const [x, y] = proj([activeCity.lon, activeCity.lat]);
        showPin(x, -y, activeCounty.targetH || 0.4);
      }
      if (activePrecinctIdx != null && activeCounty && prShapes) {
        const cname = activeCounty.name.toUpperCase();
        const polys = prShapes[cname] && prShapes[cname][activePrecinctIdx];
        if (polys) showPrecinctHighlight(polys, activeCounty.targetH || 0.4);
      }
      renderInfo();
    },
    pickCountyFromMap(c) {
      activeCity = null;
      hidePin();
      if (activeCounty === c) clearAll();
      else selectCountyInternal(c, false);
    },
    clearAll,
  };
}
