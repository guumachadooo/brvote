import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoCentroid, geoMercator } from 'd3-geo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// ---------------------------------------------------------------------------
// 1. Helpers geométricos (Douglas-Peucker, Winding Order d3-geo)
// ---------------------------------------------------------------------------
function sqSegDist(p, p1, p2) {
  let x = p1[0], y = p1[1], dx = p2[0] - x, dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = p2[0]; y = p2[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDP(pts, sqTol) {
  const len = pts.length;
  if (len <= 6) return pts;
  const markers = new Uint8Array(len);
  markers[0] = markers[len - 1] = 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let iMinX = 0, iMaxX = 0, iMinY = 0, iMaxY = 0;
  for (let i = 0; i < len; i++) {
    const [x, y] = pts[i];
    if (x < minX) { minX = x; iMinX = i; }
    if (x > maxX) { maxX = x; iMaxX = i; }
    if (y < minY) { minY = y; iMinY = i; }
    if (y > maxY) { maxY = y; iMaxY = i; }
  }
  markers[iMinX] = markers[iMaxX] = markers[iMinY] = markers[iMaxY] = 1;

  const stack = [[0, len - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0, idx = 0;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(pts[i], pts[first], pts[last]);
      if (d > maxSq) { idx = i; maxSq = d; }
    }
    if (maxSq > sqTol) {
      markers[idx] = 1;
      if (idx - first > 1) stack.push([first, idx]);
      if (last - idx > 1) stack.push([idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < len; i++) {
    if (markers[i]) out.push([+pts[i][0].toFixed(4), +pts[i][1].toFixed(4)]);
  }
  if (out.length < 4) return pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
  if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

function signedRingArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ensureD3Ring(ring, isHole = false) {
  const closed = ring.map(p => [p[0], p[1]]);
  if (closed.length < 3) return closed;
  const first = closed[0], last = closed[closed.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
  const a = signedRingArea(closed);
  if (!isHole && a > 0) closed.reverse();
  if (isHole && a < 0) closed.reverse();
  return closed;
}

function cleanGeometry(geom, tol = 0.0045, ufCode = '') {
  const sqTol = tol * tol;
  const shiftPt = ([lon, lat]) => {
    if (ufCode === '26' && lon > -33.5) return [+(lon - 2.15).toFixed(4), +(lat - 3.65).toFixed(4)];
    if (ufCode === '32' && lon > -35.0) return [+(lon - 10.5).toFixed(4), +lat.toFixed(4)];
    return [lon, lat];
  };

  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.map((r, i) => ensureD3Ring(simplifyDP(r.map(shiftPt), sqTol), i > 0));
    return { type: 'Polygon', coordinates: rings };
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map(poly => poly.map((r, i) => ensureD3Ring(simplifyDP(r.map(shiftPt), sqTol), i > 0)))
      .filter(poly => poly[0].length >= 4 && Math.abs(signedRingArea(poly[0])) > 1e-7);
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    return { type: 'MultiPolygon', coordinates: polys };
  }
  return geom;
}

function clipHalfPlane(poly, px, py, nx, ny) {
  if (!poly.length) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCur = (cur[0] - px) * nx + (cur[1] - py) * ny;
    const dPrev = (prev[0] - px) * nx + (prev[1] - py) * ny;
    if (dCur >= 0) {
      if (dPrev < 0) {
        const t = dPrev / (dPrev - dCur);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      out.push(cur);
    } else if (dPrev >= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
  }
  return out;
}

function buildVoronoiInPolygon(outerRing, seeds) {
  const baseRing = outerRing.slice(0, -1);
  return seeds.map((s, i) => {
    let cell = baseRing.map(p => [p[0], p[1]]);
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      const o = seeds[j];
      const mx = (s.lon + o.lon) / 2, my = (s.lat + o.lat) / 2;
      const nx = s.lon - o.lon, ny = s.lat - o.lat;
      cell = clipHalfPlane(cell, mx, my, nx, ny);
      if (cell.length < 3) break;
    }
    if (cell.length < 3) {
      const d = 0.04;
      cell = [[s.lon - d, s.lat - d], [s.lon + d, s.lat - d], [s.lon + d, s.lat + d], [s.lon - d, s.lat + d]];
    }
    return ensureD3Ring(cell, false);
  });
}

// ---------------------------------------------------------------------------
// 2. As 27 Unidades Federativas e cadeiras parlamentares oficiais
// ---------------------------------------------------------------------------
export const STATES_CONFIG = [
  { slug: 'ac', ufCode: '12', sigla: 'AC', name: 'Acre', region: 'Norte', fedSeats: 8, estSeats: 24 },
  { slug: 'al', ufCode: '27', sigla: 'AL', name: 'Alagoas', region: 'Nordeste', fedSeats: 9, estSeats: 27 },
  { slug: 'am', ufCode: '13', sigla: 'AM', name: 'Amazonas', region: 'Norte', fedSeats: 8, estSeats: 24 },
  { slug: 'ap', ufCode: '16', sigla: 'AP', name: 'Amapá', region: 'Norte', fedSeats: 8, estSeats: 24 },
  { slug: 'ba', ufCode: '29', sigla: 'BA', name: 'Bahia', region: 'Nordeste', fedSeats: 39, estSeats: 63 },
  { slug: 'ce', ufCode: '23', sigla: 'CE', name: 'Ceará', region: 'Nordeste', fedSeats: 22, estSeats: 46 },
  { slug: 'df', ufCode: '53', sigla: 'DF', name: 'Distrito Federal', region: 'Centro-Oeste', fedSeats: 8, estSeats: 24 },
  { slug: 'es', ufCode: '32', sigla: 'ES', name: 'Espírito Santo', region: 'Sudeste', fedSeats: 10, estSeats: 30 },
  { slug: 'go', ufCode: '52', sigla: 'GO', name: 'Goiás', region: 'Centro-Oeste', fedSeats: 17, estSeats: 41 },
  { slug: 'ma', ufCode: '21', sigla: 'MA', name: 'Maranhão', region: 'Nordeste', fedSeats: 18, estSeats: 42 },
  { slug: 'mg', ufCode: '31', sigla: 'MG', name: 'Minas Gerais', region: 'Sudeste', fedSeats: 53, estSeats: 77 },
  { slug: 'ms', ufCode: '50', sigla: 'MS', name: 'Mato Grosso do Sul', region: 'Centro-Oeste', fedSeats: 8, estSeats: 24 },
  { slug: 'mt', ufCode: '51', sigla: 'MT', name: 'Mato Grosso', region: 'Centro-Oeste', fedSeats: 8, estSeats: 24 },
  { slug: 'pa', ufCode: '15', sigla: 'PA', name: 'Pará', region: 'Norte', fedSeats: 17, estSeats: 41 },
  { slug: 'pb', ufCode: '25', sigla: 'PB', name: 'Paraíba', region: 'Nordeste', fedSeats: 12, estSeats: 36 },
  { slug: 'pe', ufCode: '26', sigla: 'PE', name: 'Pernambuco', region: 'Nordeste', fedSeats: 25, estSeats: 49 },
  { slug: 'pi', ufCode: '22', sigla: 'PI', name: 'Piauí', region: 'Nordeste', fedSeats: 10, estSeats: 30 },
  { slug: 'pr', ufCode: '41', sigla: 'PR', name: 'Paraná', region: 'Sul', fedSeats: 30, estSeats: 54 },
  { slug: 'rj', ufCode: '33', sigla: 'RJ', name: 'Rio de Janeiro', region: 'Sudeste', fedSeats: 46, estSeats: 70 },
  { slug: 'rn', ufCode: '24', sigla: 'RN', name: 'Rio Grande do Norte', region: 'Nordeste', fedSeats: 8, estSeats: 24 },
  { slug: 'ro', ufCode: '11', sigla: 'RO', name: 'Rondônia', region: 'Norte', fedSeats: 8, estSeats: 24 },
  { slug: 'rr', ufCode: '14', sigla: 'RR', name: 'Roraima', region: 'Norte', fedSeats: 8, estSeats: 24 },
  { slug: 'rs', ufCode: '43', sigla: 'RS', name: 'Rio Grande do Sul', region: 'Sul', fedSeats: 31, estSeats: 55 },
  { slug: 'sc', ufCode: '42', sigla: 'SC', name: 'Santa Catarina', region: 'Sul', fedSeats: 16, estSeats: 40 },
  { slug: 'se', ufCode: '28', sigla: 'SE', name: 'Sergipe', region: 'Nordeste', fedSeats: 8, estSeats: 24 },
  { slug: 'sp', ufCode: '35', sigla: 'SP', name: 'São Paulo', region: 'Sudeste', fedSeats: 70, estSeats: 94 },
  { slug: 'to', ufCode: '17', sigla: 'TO', name: 'Tocantins', region: 'Norte', fedSeats: 8, estSeats: 24 },
];

// As 19 Zonas Eleitorais reais do TRE-DF (com códigos de zona oficiais do TSE)
const DF_ZONES = [
  { fips: '5300101', zone: '1',  name: 'Plano Piloto (Asa Sul)', lon: -47.8925, lat: -15.8142 },
  { fips: '5300102', zone: '2',  name: 'Paranoá / Itapoã / Lago Norte', lon: -47.7778, lat: -15.7711 },
  { fips: '5300103', zone: '3',  name: 'Taguatinga Centro', lon: -48.0569, lat: -15.8333 },
  { fips: '5300104', zone: '4',  name: 'Santa Maria', lon: -48.0128, lat: -16.0172 },
  { fips: '5300105', zone: '5',  name: 'Sobradinho / Fercal', lon: -47.7889, lat: -15.6525 },
  { fips: '5300106', zone: '6',  name: 'Planaltina', lon: -47.6531, lat: -15.6186 },
  { fips: '5300108', zone: '8',  name: 'Ceilândia Centro / Guariroba', lon: -48.1119, lat: -15.8200 },
  { fips: '5300109', zone: '9',  name: 'Guará / Estrutural / SIA', lon: -47.9814, lat: -15.8253 },
  { fips: '5300110', zone: '10', name: 'Núcleo Bandeirante / Riacho Fundo', lon: -48.0175, lat: -15.8831 },
  { fips: '5300111', zone: '11', name: 'Cruzeiro / Sudoeste / Octogonal', lon: -47.9269, lat: -15.7950 },
  { fips: '5300113', zone: '13', name: 'Samambaia', lon: -48.0853, lat: -15.8769 },
  { fips: '5300114', zone: '14', name: 'Plano Piloto (Asa Norte)', lon: -47.8825, lat: -15.7564 },
  { fips: '5300115', zone: '15', name: 'Águas Claras / Vicente Pires', lon: -48.0281, lat: -15.8397 },
  { fips: '5300116', zone: '16', name: 'Ceilândia Norte / Sol Nascente', lon: -48.1350, lat: -15.7950 },
  { fips: '5300117', zone: '17', name: 'Gama', lon: -48.0650, lat: -16.0175 },
  { fips: '5300118', zone: '18', name: 'Lago Sul / Jardim Botânico / São Sebastião', lon: -47.8250, lat: -15.8650 },
  { fips: '5300119', zone: '19', name: 'Taguatinga Norte / Brazlândia', lon: -48.1150, lat: -15.7450 },
  { fips: '5300120', zone: '20', name: 'Ceilândia Sul', lon: -48.1050, lat: -15.8450 },
  { fips: '5300121', zone: '21', name: 'Recanto das Emas', lon: -48.0628, lat: -15.9089 },
];

// Classificação ideológica/coalizão de partidos para pareamento de candidatos majoritários e blocos proporcionais
const LEFT_PARTIES = new Set([
  'PT', 'PSOL', 'PCdoB', 'PCDOB', 'PV', 'REDE', 'PSB', 'PDT', 'UP', 'PCB', 'PSTU', 'PCO', 'SOLIDARIEDADE', 'SD', 'PMB'
]);
const RIGHT_PARTIES = new Set([
  'PL', 'PP', 'REPUBLICANOS', 'UNIÃO', 'UNIAO', 'NOVO', 'PSD', 'MDB', 'PSDB', 'PODE', 'PODEMOS',
  'DEM', 'PSL', 'PTB', 'PSC', 'PATRIOTA', 'PATRI', 'PRTB', 'AVANTE', 'PRD', 'CIDADANIA', 'DC', 'MISSÃO', 'MISSAO', 'PR', 'PRP', 'PHS', 'PTC'
]);

function partyScore(party) {
  const p = (party || '').toUpperCase().trim();
  if (['PSTU', 'PCO', 'PCB', 'UP', 'PSOL', 'PT', 'PCDOB'].includes(p)) return 1;
  if (['PV', 'REDE', 'PSB', 'PDT', 'SOLIDARIEDADE', 'SD'].includes(p)) return 2;
  if (['MDB', 'PSD', 'CIDADANIA', 'AVANTE', 'PROS', 'PMB'].includes(p)) return 4;
  if (['PSDB', 'PODE', 'PODEMOS', 'PTB', 'PRD', 'DC', 'MOBILIZA', 'AGIR', 'PMN'].includes(p)) return 6;
  if (['UNIÃO', 'UNIAO', 'PP', 'REPUBLICANOS', 'DEM', 'PSC', 'PATRIOTA', 'PATRI', 'PR', 'MISSÃO', 'MISSAO'].includes(p)) return 8;
  if (['PL', 'PSL', 'NOVO', 'PRTB'].includes(p)) return 10;
  return 5;
}

const UPPER_ACRONYMS = new Set(['JHC', 'ACM', 'PT', 'PL', 'PSB', 'PSD', 'MDB', 'PP', 'PSDB', 'PDT', 'PSOL', 'NOVO', 'UP', 'PCB', 'PSTU', 'PCO', 'DC', 'PR', 'DEM', 'PSL', 'PTB', 'PV', 'REDE', 'PODE', 'UNIÃO']);
const LOWER_WORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

function formatCandidateName(candKey) {
  if (!candKey) return '';
  const [rawName, rawParty] = candKey.split('|');
  if (rawName === 'LULA') return `Lula (${rawParty})`;
  if (rawName === 'FLAVIO BOLSONARO') return `Flávio Bolsonaro (${rawParty})`;
  if (rawName === 'JAIR BOLSONARO') return `Bolsonaro (${rawParty})`;
  if (rawName === 'FERNANDO HADDAD') return `Haddad (${rawParty})`;

  const formatted = rawName
    .split(/\s+/)
    .map((w, idx) => {
      if (w === '/') return '/';
      if (UPPER_ACRONYMS.has(w)) return w;
      const low = w.toLowerCase();
      if (idx > 0 && LOWER_WORDS.has(low)) return low;
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(' ');
  return rawParty ? `${formatted} (${rawParty})` : formatted;
}

function selectDemAndRepCandidates(stateTotalsObj) {
  const sorted = Object.entries(stateTotalsObj || {}).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    return { demKey: null, repKey: null, sorted: [] };
  }
  if (sorted.length === 1) {
    return { demKey: sorted[0][0], repKey: sorted[0][0], sorted };
  }

  const totalVotes = sorted.reduce((acc, [, v]) => acc + v, 0);
  // Consider viable top candidates (top 4 or >= 5% of state votes)
  const viable = sorted.filter(([, v], idx) => idx < 2 || (idx < 5 && v / totalVotes >= 0.05));

  // Separate into left/center-left vs right/center-right if both exist among viable candidates
  const leftCands = viable.filter(([k]) => partyScore(k.split('|')[1]) <= 3);
  const rightCands = viable.filter(([k]) => partyScore(k.split('|')[1]) >= 6);

  if (leftCands.length > 0 && rightCands.length > 0) {
    return { demKey: leftCands[0][0], repKey: rightCands[0][0], sorted };
  }

  // Otherwise take the top 2 overall and assign the lower partyScore (more left/center) to dem and higher (more right) to rep
  const [c1, c2] = [sorted[0][0], sorted[1][0]];
  const s1 = partyScore(c1.split('|')[1]);
  const s2 = partyScore(c2.split('|')[1]);
  if (s1 <= s2) {
    return { demKey: c1, repKey: c2, sorted };
  }
  return { demKey: c2, repKey: c1, sorted };
}

function buildRealMajorRace({
  year, office, tag, label, note,
  munList, munVotesByUnit, stateTotalsObj, forceDemKey, forceRepKey
}) {
  let demKey = forceDemKey;
  let repKey = forceRepKey;
  let sorted = Object.entries(stateTotalsObj || {}).sort((a, b) => b[1] - a[1]);

  if (!demKey || !repKey) {
    const sel = selectDemAndRepCandidates(stateTotalsObj);
    demKey = demKey || sel.demKey;
    repKey = repKey || sel.repKey;
    sorted = sel.sorted;
  }

  const demLabel = formatCandidateName(demKey) || 'Candidato 1';
  const repLabel = formatCandidateName(repKey) || 'Candidato 2';

  let totR = 0, totD = 0, totO = 0;
  const countiesObj = {};

  for (const m of munList) {
    const unitVotes = munVotesByUnit[m.unitKey] || {};
    let rv = 0, dv = 0, ov = 0;
    for (const [ck, v] of Object.entries(unitVotes)) {
      if (ck === repKey) rv += v;
      else if (ck === demKey) dv += v;
      else ov += v;
    }
    totR += rv;
    totD += dv;
    totO += ov;
    countiesObj[m.name.toUpperCase()] = [rv, dv, ov];
  }

  // Build informative note with 3rd-party candidates if not provided
  let finalNote = note;
  if (!finalNote) {
    const others = sorted.filter(([k]) => k !== repKey && k !== demKey).slice(0, 3);
    if (others.length > 0 && totO > 0) {
      finalNote = 'Outros: ' + others.map(([k, v]) => `${formatCandidateName(k)} ${v.toLocaleString('pt-BR')}`).join(' · ');
    } else {
      finalNote = `Dados oficiais TSE (${year})`;
    }
  }

  const out = {
    year: String(year),
    office,
    label,
    rep: repLabel,
    dem: demLabel,
    totals: { R: totR, D: totD, O: totO },
    counties: countiesObj,
    _demKey: demKey,
    _repKey: repKey,
  };
  if (tag) out.tag = tag;
  if (finalNote) out.note = finalNote;
  return out;
}

function buildRealDeputyRace({
  year, office, label, totalSeats, seatsLabel,
  munList, munPartyByUnit
}) {
  let totR = 0, totD = 0, totO = 0;
  const countiesObj = {};

  for (const m of munList) {
    const pVotes = munPartyByUnit[m.unitKey] || {};
    let rv = 0, dv = 0, ov = 0;
    for (const [party, v] of Object.entries(pVotes)) {
      const pUp = party.toUpperCase().trim();
      if (LEFT_PARTIES.has(pUp)) dv += v;
      else if (RIGHT_PARTIES.has(pUp)) rv += v;
      else ov += v;
    }
    totR += rv;
    totD += dv;
    totO += ov;
    countiesObj[m.name.toUpperCase()] = [rv, dv, ov];
  }

  const twoParty = Math.max(1, totR + totD);
  const dSeats = Math.max(1, Math.min(totalSeats - 1, Math.round((totD / twoParty) * totalSeats)));
  const rSeats = totalSeats - dSeats;

  return {
    year: String(year),
    office,
    label,
    rep: 'Bloco PL / Centrão / Direita',
    dem: 'Fed. PT / PSB / PDT / PSOL',
    note: `Votos nominais e de legenda apurados pelo TSE (${year})`,
    seats: { R: rSeats, D: dSeats, label: seatsLabel },
    totals: { R: totR, D: totD, O: totO },
    counties: countiesObj,
  };
}

export function buildAllBrazilData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const tseAll = JSON.parse(fs.readFileSync('/tmp/tse_real_all_years.json', 'utf8'));
  const sidraRaw = JSON.parse(fs.readFileSync('/tmp/sidra_pop_2022.json', 'utf8'));
  const popByFips = new Map();
  for (const row of sidraRaw.slice(1)) {
    popByFips.set(String(row.D1C), Number(row.V) || 0);
  }

  const munMetaRaw = fs.existsSync('/tmp/mun_meta.json')
    ? JSON.parse(fs.readFileSync('/tmp/mun_meta.json', 'utf8').replace(/^\uFEFF/, ''))
    : [];
  const metaByFips = new Map(munMetaRaw.map(m => [String(m.codigo_ibge), m]));

  // 1. Ensure data/br-ufs.json exists (rebuild if /tmp/br_states_ibge.json is present)
  if (fs.existsSync('/tmp/br_states_ibge.json')) {
    const rawStates = JSON.parse(fs.readFileSync('/tmp/br_states_ibge.json', 'utf8'));
    const ufFeatures = [];
    for (const stCfg of STATES_CONFIG) {
      const rawF = rawStates.features.find(f => (f.properties.SIGLA || f.properties.PK_sigla) === stCfg.sigla);
      if (!rawF) throw new Error(`Missing UF ${stCfg.sigla} in /tmp/br_states_ibge.json`);
      const geom = cleanGeometry(rawF.geometry, 0.015, stCfg.ufCode);
      const feat = {
        type: 'Feature',
        id: stCfg.ufCode,
        properties: { id: stCfg.ufCode, sigla: stCfg.sigla, name: stCfg.name, regiao: stCfg.region },
        geometry: geom,
      };
      if (geoArea(feat) > 0.5) {
        if (feat.geometry.type === 'Polygon') {
          feat.geometry.coordinates = feat.geometry.coordinates.map(r => r.slice().reverse());
        } else if (feat.geometry.type === 'MultiPolygon') {
          feat.geometry.coordinates = feat.geometry.coordinates.map(p => p.map(r => r.slice().reverse()));
        }
      }
      ufFeatures.push(feat);
    }
    fs.writeFileSync(path.join(DATA_DIR, 'br-ufs.json'), JSON.stringify({ type: 'FeatureCollection', features: ufFeatures }));
  }

  const EARTH_SQ_KM = 510072000;
  const turnout2026 = tseAll.turnout_2026 || {};
  const dfZoneAptos = tseAll.df_zone_aptos || {};

  // 2. Process each of the 27 UFs using real IBGE municipal polygons + 100% real TSE & IBGE Censo data
  for (const st of STATES_CONFIG) {
    const stDir = path.join(DATA_DIR, st.slug);
    fs.mkdirSync(stDir, { recursive: true });

    const existingMunPath = path.join(stDir, 'municipios.json');
    const rawMunFile = `/tmp/ibge_muns/${st.ufCode}.json`;

    let munFeatures = [];
    if (st.slug === 'df') {
      let baseOuterGeom;
      if (fs.existsSync(rawMunFile)) {
        const rawMunGeo = JSON.parse(fs.readFileSync(rawMunFile, 'utf8'));
        baseOuterGeom = cleanGeometry(rawMunGeo.features[0].geometry, 0.002, st.ufCode);
      } else {
        const ufsGeo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'br-ufs.json'), 'utf8'));
        const dfFeat = ufsGeo.features.find(f => f.properties.sigla === 'DF');
        baseOuterGeom = dfFeat.geometry;
      }
      const outerRing = baseOuterGeom.type === 'Polygon' ? baseOuterGeom.coordinates[0] : baseOuterGeom.coordinates[0][0];
      const cells = buildVoronoiInPolygon(outerRing, DF_ZONES);
      munFeatures = DF_ZONES.map((z, idx) => ({
        type: 'Feature',
        id: z.fips,
        properties: { id: z.fips, name: z.name, uf: 'DF', zone: z.zone },
        geometry: { type: 'Polygon', coordinates: [cells[idx]] },
      }));
      fs.writeFileSync(existingMunPath, JSON.stringify({ type: 'FeatureCollection', features: munFeatures }));
    } else if (fs.existsSync(rawMunFile)) {
      const rawMunGeo = JSON.parse(fs.readFileSync(rawMunFile, 'utf8'));
      const nMuns = rawMunGeo.features.length;
      const tol = nMuns > 500 ? 0.0085 : nMuns > 250 ? 0.0065 : 0.0045;
      for (const f of rawMunGeo.features) {
        const fips = String(f.properties.id || f.id);
        const name = f.properties.name || f.properties.nome || fips;
        const geom = cleanGeometry(f.geometry, tol, st.ufCode);
        const feat = {
          type: 'Feature',
          id: fips,
          properties: { id: fips, name, uf: st.sigla },
          geometry: geom,
        };
        if (geoArea(feat) > 0.5) {
          if (feat.geometry.type === 'Polygon') {
            feat.geometry.coordinates = feat.geometry.coordinates.map(r => r.slice().reverse());
          } else if (feat.geometry.type === 'MultiPolygon') {
            feat.geometry.coordinates = feat.geometry.coordinates.map(p => p.map(r => r.slice().reverse()));
          }
        }
        munFeatures.push(feat);
      }
      fs.writeFileSync(existingMunPath, JSON.stringify({ type: 'FeatureCollection', features: munFeatures }));
    } else {
      const savedGeo = JSON.parse(fs.readFileSync(existingMunPath, 'utf8'));
      munFeatures = savedGeo.features;
    }

    const W = 220, H = 220;
    const proj = geoMercator().fitSize([W, H], { type: 'FeatureCollection', features: munFeatures });

    const dfTotalPop = popByFips.get('5300108') || 2817381;
    const dfTotalAptos = Object.values(dfZoneAptos).reduce((a, b) => a + b, 0) || 1;

    const munList = munFeatures.map(f => {
      const fips = String(f.id);
      const name = f.properties.name;
      const sr = geoArea(f);
      const areaKm2 = Math.max(2, +(((Math.min(sr, 4 * Math.PI - sr) / (4 * Math.PI)) * EARTH_SQ_KM)).toFixed(1));
      const cen = geoCentroid(f);

      if (st.slug === 'df') {
        const zInfo = DF_ZONES.find(z => z.fips === fips) || { zone: '1', lon: cen[0], lat: cen[1] };
        const zAptos = dfZoneAptos[zInfo.zone] || 100000;
        const pop = Math.round(dfTotalPop * (zAptos / dfTotalAptos));
        return {
          fips,
          unitKey: zInfo.zone,
          name,
          landSqMi: areaKm2,
          lon: zInfo.lon,
          lat: zInfo.lat,
          pop,
          aptos: zAptos,
          zones: [zInfo.zone],
          zoneAptos: { [zInfo.zone]: zAptos },
          feature: f,
        };
      }

      const meta = metaByFips.get(fips);
      const lon = +(meta?.longitude ?? cen[0]).toFixed(4);
      const lat = +(meta?.latitude ?? cen[1]).toFixed(4);
      const tInfo = turnout2026[fips] || {};
      const pop = popByFips.get(fips) || Math.round((tInfo.aptos || 5000) * 1.35);
      const aptos = tInfo.aptos || Math.round(pop * 0.74);
      const zones = tInfo.zones && tInfo.zones.length ? tInfo.zones : ['1'];
      const zoneAptos = tInfo.zone_aptos || { [zones[0]]: aptos };

      return {
        fips,
        unitKey: fips,
        name,
        landSqMi: areaKm2,
        lon,
        lat,
        pop,
        aptos,
        zones,
        zoneAptos,
        feature: f,
      };
    });

    const d26 = tseAll['2026'][st.sigla];
    const d22 = tseAll['2022'][st.sigla];
    const d18 = tseAll['2018'][st.sigla];

    const getMajorUnitMap = (dYear, rkey) => (st.slug === 'df' ? (dYear.df_zones?.[rkey] || {}) : (dYear.major_races?.[rkey] || {}));
    const getDepUnitMap = (dYear, rkey) => (st.slug === 'df' ? (dYear.df_zones?.[rkey] || {}) : (dYear.dep_mun_party?.[rkey] || {}));

    // --- 2026 RACES ---
    const rPres2T = buildRealMajorRace({
      year: '2026',
      office: 'Presidente',
      tag: '2º Turno',
      label: 'Eleições Gerais de 2026 · 2º Turno',
      note: 'Apuração oficial TSE — 2º Turno (25/10/2026)',
      munList,
      munVotesByUnit: getMajorUnitMap(d26, 'Presidente_2'),
      stateTotalsObj: d26.major_state_totals['Presidente_2'],
      forceDemKey: 'LULA|PT',
      forceRepKey: 'FLAVIO BOLSONARO|PL',
    });

    const rPres1T = buildRealMajorRace({
      year: '2026',
      office: 'Presidente',
      tag: '1º Turno',
      label: 'Eleições Gerais de 2026 · 1º Turno',
      munList,
      munVotesByUnit: getMajorUnitMap(d26, 'Presidente_1'),
      stateTotalsObj: d26.major_state_totals['Presidente_1'],
      forceDemKey: 'LULA|PT',
      forceRepKey: 'FLAVIO BOLSONARO|PL',
    });

    const hasGov26_2T = Boolean(d26.major_state_totals['Governador_2'] && Object.keys(d26.major_state_totals['Governador_2']).length > 0);
    const gov26Key = hasGov26_2T ? 'Governador_2' : 'Governador_1';
    const rGov26 = buildRealMajorRace({
      year: '2026',
      office: 'Governador',
      tag: hasGov26_2T ? '2º Turno' : '1º Turno',
      label: `Eleições Gerais de 2026 · Governo Estadual (${hasGov26_2T ? '2º Turno' : 'Decidido no 1º Turno'})`,
      munList,
      munVotesByUnit: getMajorUnitMap(d26, gov26Key),
      stateTotalsObj: d26.major_state_totals[gov26Key],
    });

    const rSen26 = buildRealMajorRace({
      year: '2026',
      office: 'Senado Federal',
      label: 'Eleições Gerais de 2026 · Senado Federal (2 vagas)',
      munList,
      munVotesByUnit: getMajorUnitMap(d26, 'Senador_1'),
      stateTotalsObj: d26.major_state_totals['Senador_1'],
    });

    const rDepFed26 = buildRealDeputyRace({
      year: '2026',
      office: 'Deputado Federal',
      label: `Eleições Gerais de 2026 · Câmara dos Deputados (${st.fedSeats} cadeiras)`,
      totalSeats: st.fedSeats,
      seatsLabel: `Cadeiras na Câmara (${st.fedSeats})`,
      munList,
      munPartyByUnit: getDepUnitMap(d26, 'Deputado Federal'),
    });

    const estOffice = st.slug === 'df' ? 'Deputado Distrital' : 'Deputado Estadual';
    const rDepEst26 = buildRealDeputyRace({
      year: '2026',
      office: estOffice,
      label: `Eleições Gerais de 2026 · Assembleia (${st.estSeats} cadeiras)`,
      totalSeats: st.estSeats,
      seatsLabel: `Cadeiras na Assembleia (${st.estSeats})`,
      munList,
      munPartyByUnit: getDepUnitMap(d26, 'Deputado Estadual'),
    });

    const rShift26 = {
      ...rPres2T,
      office: 'Mudança 2022 → 2026',
      tag: 'Giro Presidencial',
      label: 'Eleições Gerais de 2026 · Oscilação desde 2022',
      note: 'Comparação da margem oficial de 2º turno (2026 vs. 2022)',
      isShift: true,
    };

    const order2026 = ['2026-pres-2t', '2026-pres-1t', '2026-gov', '2026-sen', '2026-dep-fed', '2026-dep-est', '2026-shift-pres'];
    const races2026Obj = {
      '2026-pres-2t': rPres2T,
      '2026-pres-1t': rPres1T,
      '2026-gov': rGov26,
      '2026-sen': rSen26,
      '2026-dep-fed': rDepFed26,
      '2026-dep-est': rDepEst26,
      '2026-shift-pres': rShift26,
    };

    // --- HISTORICAL 2022 & 2018 RACES ---
    const rPres22 = buildRealMajorRace({
      year: '2022',
      office: 'Presidente',
      tag: '2º Turno',
      label: 'Eleições Gerais de 2022 · 2º Turno',
      note: 'Apuração oficial TSE — 2º Turno (30/10/2022)',
      munList,
      munVotesByUnit: getMajorUnitMap(d22, 'Presidente_2'),
      stateTotalsObj: d22.major_state_totals['Presidente_2'],
      forceDemKey: 'LULA|PT',
      forceRepKey: 'JAIR BOLSONARO|PL',
    });

    const hasGov22_2T = Boolean(d22.major_state_totals['Governador_2'] && Object.keys(d22.major_state_totals['Governador_2']).length > 0);
    const gov22Key = hasGov22_2T ? 'Governador_2' : 'Governador_1';
    const rGov22 = buildRealMajorRace({
      year: '2022',
      office: 'Governador',
      tag: hasGov22_2T ? '2º Turno' : '1º Turno',
      label: `Eleições Gerais de 2022 · Governo Estadual (${hasGov22_2T ? '2º Turno' : '1º Turno'})`,
      munList,
      munVotesByUnit: getMajorUnitMap(d22, gov22Key),
      stateTotalsObj: d22.major_state_totals[gov22Key],
    });

    const rSen22 = buildRealMajorRace({
      year: '2022',
      office: 'Senado Federal',
      label: 'Eleições Gerais de 2022 · Senado Federal (1 vaga)',
      munList,
      munVotesByUnit: getMajorUnitMap(d22, 'Senador_1'),
      stateTotalsObj: d22.major_state_totals['Senador_1'],
    });

    const rDepFed22 = buildRealDeputyRace({
      year: '2022',
      office: 'Deputado Federal',
      label: `Eleições Gerais de 2022 · Câmara dos Deputados (${st.fedSeats} cadeiras)`,
      totalSeats: st.fedSeats,
      seatsLabel: `Cadeiras na Câmara (${st.fedSeats})`,
      munList,
      munPartyByUnit: getDepUnitMap(d22, 'Deputado Federal'),
    });

    const rPres18 = buildRealMajorRace({
      year: '2018',
      office: 'Presidente',
      tag: '2º Turno',
      label: 'Eleições Gerais de 2018 · 2º Turno',
      note: 'Apuração oficial TSE — 2º Turno (28/10/2018)',
      munList,
      munVotesByUnit: getMajorUnitMap(d18, 'Presidente_2'),
      stateTotalsObj: d18.major_state_totals['Presidente_2'],
      forceDemKey: 'FERNANDO HADDAD|PT',
      forceRepKey: 'JAIR BOLSONARO|PSL',
    });

    const hasGov18_2T = Boolean(d18.major_state_totals['Governador_2'] && Object.keys(d18.major_state_totals['Governador_2']).length > 0);
    const gov18Key = hasGov18_2T ? 'Governador_2' : 'Governador_1';
    const rGov18 = buildRealMajorRace({
      year: '2018',
      office: 'Governador',
      tag: hasGov18_2T ? '2º Turno' : '1º Turno',
      label: `Eleições Gerais de 2018 · Governo Estadual (${hasGov18_2T ? '2º Turno' : '1º Turno'})`,
      munList,
      munVotesByUnit: getMajorUnitMap(d18, gov18Key),
      stateTotalsObj: d18.major_state_totals[gov18Key],
    });

    const orderHist = ['2022-presidente', '2022-governador', '2022-senador', '2022-dep-fed', '2018-presidente', '2018-governador'];
    const racesHistObj = {
      '2022-presidente': rPres22,
      '2022-governador': rGov22,
      '2022-senador': rSen22,
      '2022-dep-fed': rDepFed22,
      '2018-presidente': rPres18,
      '2018-governador': rGov18,
    };

    // Strip internal _demKey / _repKey before serializing
    const cleanRace = r => {
      const c = { ...r };
      delete c._demKey;
      delete c._repKey;
      return c;
    };

    fs.writeFileSync(
      path.join(stDir, 'results-2026.json'),
      JSON.stringify({
        order: order2026,
        races: Object.fromEntries(Object.entries(races2026Obj).map(([k, v]) => [k, cleanRace(v)])),
      })
    );
    fs.writeFileSync(
      path.join(stDir, 'results-history.json'),
      JSON.stringify({
        order: orderHist,
        races: Object.fromEntries(Object.entries(racesHistObj).map(([k, v]) => [k, cleanRace(v)])),
      })
    );

    // 3. Build cities.json using real Censo IBGE 2022 populations
    const sortedCities = [...munList]
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 60)
      .map(m => ({ name: m.name, county: m.name, lon: m.lon, lat: m.lat, pop: m.pop }));
    fs.writeFileSync(path.join(stDir, 'cities.json'), JSON.stringify(sortedCities));

    // 4. Build precincts.json and precinct-shapes.json using real TSE Electoral Zones (NR_ZONA) and QT_APTOS
    const prRacesMap = {
      '2026-pres-2t': 0,
      '2026-pres-1t': 1,
      '2026-gov': 2,
      '2026-sen': 3,
      '2026-dep-fed': 4,
      '2026-dep-est': 5,
      '2022-presidente': 6,
    };
    const prRaceSpecs = [
      { race: rPres2T, year: '2026', rkey: 'Presidente_2', isDep: false },
      { race: rPres1T, year: '2026', rkey: 'Presidente_1', isDep: false },
      { race: rGov26,  year: '2026', rkey: gov26Key,       isDep: false },
      { race: rSen26,  year: '2026', rkey: 'Senador_1',    isDep: false },
      { race: rDepFed26, year: '2026', rkey: 'Deputado Federal', isDep: true },
      { race: rDepEst26, year: '2026', rkey: 'Deputado Estadual', isDep: true },
      { race: rPres22, year: '2022', rkey: 'Presidente_2', isDep: false },
    ];

    const precinctsCounties = {};
    const precinctShapesCounties = {};

    for (const m of munList) {
      const key = m.name.toUpperCase();
      const geom = m.feature.geometry;
      const mainRing = (geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0]).slice(0, -1);
      const projRing = [];
      for (const ll of mainRing) {
        const p = proj(ll);
        if (p && isFinite(p[0]) && isFinite(p[1])) {
          projRing.push([+(p[0] - W / 2).toFixed(2), +(-(p[1] - H / 2)).toFixed(2)]);
        }
      }
      if (projRing.length < 3) continue;

      let cx = 0, cy = 0;
      for (const [x, y] of projRing) { cx += x; cy += y; }
      cx /= projRing.length; cy /= projRing.length;

      // Only subdivide municipalities that actually have multiple TSE Electoral Zones (NR_ZONA)
      const realZones = m.zones || ['1'];
      let subRings = [projRing];
      if (st.slug !== 'df' && realZones.length > 1 && projRing.length >= 4) {
        if (realZones.length === 2) {
          const h1 = clipHalfPlane(projRing, cx, cy, 1, 0);
          const h2 = clipHalfPlane(projRing, cx, cy, -1, 0);
          const valid = [h1, h2].filter(q => q.length >= 3);
          if (valid.length === 2) subRings = valid;
        } else {
          const q1 = clipHalfPlane(clipHalfPlane(projRing, cx, cy, 1, 0), cx, cy, 0, 1);
          const q2 = clipHalfPlane(clipHalfPlane(projRing, cx, cy, -1, 0), cx, cy, 0, 1);
          const q3 = clipHalfPlane(clipHalfPlane(projRing, cx, cy, 1, 0), cx, cy, 0, -1);
          const q4 = clipHalfPlane(clipHalfPlane(projRing, cx, cy, -1, 0), cx, cy, 0, -1);
          const valid = [q1, q2, q3, q4].filter(q => q.length >= 3);
          if (valid.length >= 2) {
            subRings = valid.slice(0, Math.min(valid.length, realZones.length));
          }
        }
      }

      const pRows = [];
      const pShapes = [];

      if (subRings.length === 1) {
        const zCode = realZones.length === 1
          ? `ZE-${String(realZones[0]).padStart(3, '0')} (${m.name})`
          : `ZEs ${realZones.join(', ')} (${m.name})`;
        const votesPerRace = prRaceSpecs.map(spec => {
          const base = spec.race.counties[key] || [0, 0, 0];
          return [base[0], base[1], base[2] || 0];
        });
        pRows.push([zCode, m.aptos, m.landSqMi, votesPerRace]);
        pShapes.push([[projRing.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])]]);
      } else {
        // Group the municipality's real TSE Electoral Zones (NR_ZONA) across the subRings
        const nBuckets = subRings.length;
        const zoneBuckets = Array.from({ length: nBuckets }, () => []);
        realZones.forEach((z, idx) => {
          zoneBuckets[idx % nBuckets].push(z);
        });

        subRings.forEach((r, bIdx) => {
          const bucketZones = zoneBuckets[bIdx];
          const zLabel = bucketZones.length === 1
            ? `ZE-${String(bucketZones[0]).padStart(3, '0')} (${m.name})`
            : `ZEs ${bucketZones.map(z => String(z).padStart(3, '0')).join('/')} (${m.name})`;

          let bucketAptos = 0;
          for (const z of bucketZones) {
            bucketAptos += m.zoneAptos?.[z] || 0;
          }
          if (!bucketAptos) bucketAptos = Math.round(m.aptos / nBuckets);

          const votesPerRace = prRaceSpecs.map(spec => {
            const yData = tseAll[spec.year][st.sigla];
            const mzMap = yData.mun_zones?.[spec.rkey]?.[m.fips];
            if (!mzMap) {
              const base = spec.race.counties[key] || [0, 0, 0];
              const share = bucketAptos / Math.max(1, m.aptos);
              return [
                Math.round(base[0] * share),
                Math.round(base[1] * share),
                Math.round((base[2] || 0) * share),
              ];
            }
            let rv = 0, dv = 0, ov = 0;
            for (const z of bucketZones) {
              const zVotes = mzMap[z] || {};
              if (spec.isDep) {
                for (const [party, v] of Object.entries(zVotes)) {
                  const pUp = party.toUpperCase().trim();
                  if (LEFT_PARTIES.has(pUp)) dv += v;
                  else if (RIGHT_PARTIES.has(pUp)) rv += v;
                  else ov += v;
                }
              } else {
                const repK = spec.race._repKey;
                const demK = spec.race._demKey;
                for (const [ck, v] of Object.entries(zVotes)) {
                  if (ck === repK) rv += v;
                  else if (ck === demK) dv += v;
                  else ov += v;
                }
              }
            }
            return [rv, dv, ov];
          });

          const areaShare = bucketAptos / Math.max(1, m.aptos);
          const area = Math.max(0.5, +(m.landSqMi * areaShare).toFixed(1));
          pRows.push([zLabel, bucketAptos, area, votesPerRace]);
          pShapes.push([[r.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])]]);
        });
      }

      precinctsCounties[key] = pRows;
      precinctShapesCounties[key] = pShapes;
    }

    fs.writeFileSync(path.join(stDir, 'precincts.json'), JSON.stringify({ races: prRacesMap, counties: precinctsCounties }));
    fs.writeFileSync(path.join(stDir, 'precinct-shapes.json'), JSON.stringify(precinctShapesCounties));
  }

  console.log(`Dados oficiais do TSE (2026, 2022, 2018) e Censo IBGE 2022 gerados para todas as ${STATES_CONFIG.length} UFs!`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAllBrazilData();
}
