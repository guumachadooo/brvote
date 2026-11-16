// context-map.js — Geographic context basemap (neighboring Brazilian states + South American borders) & camera pan clamping
// Supports both Y-up (XZ ground plane in app.js/voters.js) and Z-up (XY ground plane in volume.js)
import * as THREE from 'three';

let cachedBrGeo = null;

async function getBrGeo() {
  if (cachedBrGeo) return cachedBrGeo;
  try {
    const res = await fetch('data/br/municipios.json');
    cachedBrGeo = await res.json();
    return cachedBrGeo;
  } catch (e) {
    return null;
  }
}

export function createContextMap({ group, proj, uf, BASE_H = 0.08, yUp = false }) {
  return buildContextMap({ uf, proj, BASE_H, yUp }).then((g) => {
    if (group && g) group.add(g);
    return g;
  });
}

const SA_NEIGHBOR_LINES = [
  [[-53.4, -33.7], [-54.5, -34.9], [-58.4, -34.6], [-57.5, -38.0], [-62.0, -39.0], [-65.0, -43.0], [-68.5, -52.0], [-70.5, -52.5], [-72.0, -46.0], [-71.5, -36.0], [-70.0, -27.0], [-68.5, -22.0], [-62.6, -22.2], [-57.6, -25.3], [-57.6, -30.2], [-58.0, -34.4]],
  [[-54.6, -25.5], [-57.6, -25.3], [-58.2, -22.1], [-62.6, -22.2], [-62.3, -19.8], [-58.0, -20.1], [-54.6, -25.5]],
  [[-57.8, -19.0], [-62.3, -19.8], [-65.0, -22.0], [-68.5, -22.0], [-69.1, -17.5], [-71.4, -17.7], [-75.5, -14.0], [-78.0, -10.0], [-81.3, -4.7], [-79.9, -3.4], [-75.2, -0.1], [-70.0, -4.2], [-69.9, -11.0]],
  [[-75.2, -0.1], [-78.8, 1.5], [-77.5, 5.5], [-75.5, 10.5], [-71.5, 12.2], [-67.0, 10.6], [-61.0, 10.0], [-58.2, 6.8], [-54.0, 5.8], [-51.6, 4.1]]
];

export async function buildContextMap({ uf, proj, BASE_H = 0.08, yUp = false }) {
  const group = new THREE.Group();
  group.name = 'contextMapGroup';

  const isLight = typeof document !== 'undefined' && document.body.classList.contains('theme-light');
  const isContrast = typeof document !== 'undefined' && document.body.classList.contains('theme-contrast');

  const fillMat = new THREE.MeshBasicMaterial({
    color: isLight ? 0xe4dfd3 : (isContrast ? 0x050914 : 0x0c1622),
    transparent: true,
    opacity: isLight ? 0.68 : 0.62,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const lineMat = new THREE.LineBasicMaterial({
    color: isLight ? 0xb5ac9b : (isContrast ? 0x26324d : 0x1d3142),
    transparent: true,
    opacity: isLight ? 0.72 : 0.56,
    depthWrite: false
  });

  const gridMat = new THREE.LineBasicMaterial({
    color: isLight ? 0xd2c9b8 : 0x132432,
    transparent: true,
    opacity: isLight ? 0.35 : 0.28,
    depthWrite: false
  });

  function mapLL(lon, lat) {
    // Support both proj(lon, lat) and d3 proj([lon, lat])
    const res = proj.length >= 2 ? proj(lon, lat) : proj([lon, lat]);
    if (!res) return [NaN, NaN];
    return res;
  }

  const linePos = [];
  const targetNameUpper = getUfNameUpper(uf);
  const targetCode = getUfIbgePrefix(uf);

  if (uf && uf.toLowerCase() !== 'br') {
    const brGeo = await getBrGeo();
    if (brGeo && brGeo.features) {
      for (const f of brGeo.features) {
        const idStr = String(f.id || f.properties?.id || '');
        const fName = String(f.properties?.name || '').toUpperCase();
        if (idStr === targetCode || (targetNameUpper && fName === targetNameUpper)) continue;
        const g = f.geometry;
        if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
          const outer = poly[0];
          if (!outer || outer.length < 3) continue;
          const pts2 = [];
          let valid = true;
          for (let i = 0; i < outer.length; i++) {
            const [x, y] = mapLL(outer[i][0], outer[i][1]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 520) {
              valid = false;
              break;
            }
            pts2.push(new THREE.Vector2(x, y));
          }
          if (!valid || pts2.length < 3) continue;

          try {
            const shape = new THREE.Shape(pts2);
            const geom = new THREE.ShapeGeometry(shape);
            if (yUp) {
              geom.rotateX(-Math.PI / 2);
              const mesh = new THREE.Mesh(geom, fillMat);
              mesh.position.y = 0.02;
              group.add(mesh);
            } else {
              const mesh = new THREE.Mesh(geom, fillMat);
              mesh.position.z = -BASE_H - 0.12;
              group.add(mesh);
            }
          } catch (_) {}

          for (let i = 0; i < pts2.length - 1; i++) {
            if (yUp) {
              linePos.push(pts2[i].x, 0.04, -pts2[i].y, pts2[i + 1].x, 0.04, -pts2[i + 1].y);
            } else {
              linePos.push(pts2[i].x, pts2[i].y, -BASE_H - 0.08, pts2[i + 1].x, pts2[i + 1].y, -BASE_H - 0.08);
            }
          }
        }
      }
    }
  } else {
    for (const arc of SA_NEIGHBOR_LINES) {
      for (let i = 0; i < arc.length - 1; i++) {
        const [x0, y0] = mapLL(arc[i][0], arc[i][1]);
        const [x1, y1] = mapLL(arc[i + 1][0], arc[i + 1][1]);
        if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) {
          if (yUp) {
            linePos.push(x0, 0.04, -y0, x1, 0.04, -y1);
          } else {
            linePos.push(x0, y0, -BASE_H - 0.08, x1, y1, -BASE_H - 0.08);
          }
        }
      }
    }
  }

  if (linePos.length > 0) {
    const lGeom = new THREE.BufferGeometry();
    lGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    group.add(new THREE.LineSegments(lGeom, lineMat));
  }

  const gridPos = [];
  const R = 240;
  const step = 22;
  for (let v = -R; v <= R; v += step) {
    if (yUp) {
      gridPos.push(-R, 0.01, v, R, 0.01, v);
      gridPos.push(v, 0.01, -R, v, 0.01, R);
    } else {
      gridPos.push(-R, v, -BASE_H - 0.16, R, v, -BASE_H - 0.16);
      gridPos.push(v, -R, -BASE_H - 0.16, v, R, -BASE_H - 0.16);
    }
  }
  const gGeom = new THREE.BufferGeometry();
  gGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
  group.add(new THREE.LineSegments(gGeom, gridMat));

  group.userData = {
    updateTheme(themeName) {
      const light = themeName === 'light';
      const contrast = themeName === 'contrast';
      fillMat.color.setHex(light ? 0xe4dfd3 : (contrast ? 0x050914 : 0x0c1622));
      fillMat.opacity = light ? 0.68 : 0.62;
      lineMat.color.setHex(light ? 0xb5ac9b : (contrast ? 0x26324d : 0x1d3142));
      lineMat.opacity = light ? 0.72 : 0.56;
      gridMat.color.setHex(light ? 0xd2c9b8 : 0x132432);
      gridMat.opacity = light ? 0.35 : 0.28;
    }
  };

  return group;
}

// Clamp OrbitControls target so the user cannot pan the active map off-screen
export function clampCameraPan(controls, camera, maxPan = 95, yUp = false) {
  controls.addEventListener('change', () => {
    const t = controls.target;
    const horizA = t.x;
    const horizB = yUp ? t.z : t.y;
    const dist = Math.hypot(horizA, horizB);
    if (dist > maxPan) {
      const ratio = maxPan / dist;
      const na = horizA * ratio;
      const nb = horizB * ratio;
      const da = na - horizA;
      const db = nb - horizB;
      t.x = na;
      camera.position.x += da;
      if (yUp) {
        t.z = nb;
        camera.position.z += db;
      } else {
        t.y = nb;
        camera.position.y += db;
      }
    }
  });
}

function getUfIbgePrefix(uf) {
  const map = {
    ro: '11', ac: '12', am: '13', rr: '14', pa: '15', ap: '16', to: '17',
    ma: '21', pi: '22', ce: '23', rn: '24', pb: '25', pe: '26', al: '27', se: '28', ba: '29',
    mg: '31', es: '32', rj: '33', sp: '35',
    pr: '41', sc: '42', rs: '43',
    ms: '50', mt: '51', go: '52', df: '53'
  };
  return map[String(uf || '').toLowerCase()] || '';
}

function getUfNameUpper(uf) {
  const map = {
    ac: 'ACRE', al: 'ALAGOAS', am: 'AMAZONAS', ap: 'AMAPÁ', ba: 'BAHIA', ce: 'CEARÁ',
    df: 'DISTRITO FEDERAL', es: 'ESPÍRITO SANTO', go: 'GOIÁS', ma: 'MARANHÃO',
    mg: 'MINAS GERAIS', ms: 'MATO GROSSO DO SUL', mt: 'MATO GROSSO', pa: 'PARÁ',
    pb: 'PARAÍBA', pe: 'PERNAMBUCO', pi: 'PIAUÍ', pr: 'PARANÁ', rj: 'RIO DE JANEIRO',
    rn: 'RIO GRANDE DO NORTE', ro: 'RONDÔNIA', rr: 'RORAIMA', rs: 'RIO GRANDE DO SUL',
    sc: 'SANTA CATARINA', se: 'SERGIPE', sp: 'SÃO PAULO', to: 'TOCANTINS'
  };
  return map[String(uf || '').toLowerCase()] || '';
}
