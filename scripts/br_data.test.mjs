import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STATES, getState } from '../state.js';
import { computeMargin, marginColor, voteLeadColor, PT_RED, PL_BLUE } from '../colors.js';
import { computeInteriorPoint, computeCalloutPlacements } from '../callout-logic.js';

test('Color encoding: PT (red) vs PL (blue) margins and vote-lead shading', () => {
  assert.equal(computeMargin(600, 400, 0), 0.2);
  assert.equal(computeMargin(300, 700, 0), -0.4);
  assert.equal(computeMargin(0, 0, 0), 0);

  const ptHex = marginColor(750, 250, 0);
  const plHex = marginColor(250, 750, 0);
  assert.notEqual(ptHex, plHex);
  assert.ok(PT_RED.startsWith('#'));
  assert.ok(PL_BLUE.startsWith('#'));

  const leadSmall = voteLeadColor(550, 450, 100000);
  const leadLarge = voteLeadColor(85000, 15000, 100000);
  assert.notEqual(leadSmall, leadLarge);
});

test('All 27 Brazilian UFs and national Brasil entry are configured in state.js with clean naming', () => {
  assert.equal(STATES.length, 28);
  assert.equal(getState('br').name, 'Brasil');
  for (const st of STATES) {
    assert.ok(st.slug, 'state has slug');
    assert.ok(st.results && st.results.href, `state ${st.slug} has results.href`);
    assert.ok(st.dots, `state ${st.slug} has dots link`);
    assert.ok(Array.isArray(st.flights) && st.flights.length === 4, `state ${st.slug} has 4 guided flights`);
    assert.ok(st.flights.some(f => f.href.startsWith('volume.html')), `state ${st.slug} links to volume.html`);
    assert.equal(getState(st.slug).code, st.code);
  }
});

test('No holes in the middle of Amazonas or coastal municipalities (Novo Airão, Presidente Figueiredo, Rio de Janeiro)', () => {
  const amGeo = JSON.parse(fs.readFileSync('data/am/municipios.json', 'utf8'));
  const amShapes = JSON.parse(fs.readFileSync('data/am/precinct-shapes.json', 'utf8'));

  for (const name of ['NOVO AIRÃO', 'PRESIDENTE FIGUEIREDO', 'MANAUS']) {
    const feat = amGeo.features.find(f => (f.properties.name || f.properties.NAME || '').toUpperCase() === name);
    assert.ok(feat, `${name} exists in Amazonas GeoJSON`);
    const firstRing = feat.geometry.type === 'Polygon'
      ? feat.geometry.coordinates[0]
      : feat.geometry.coordinates[0][0];
    assert.ok(firstRing.length >= 15, `${name} primary outer ring has full mainland boundary (${firstRing.length} pts)`);
    assert.ok(Array.isArray(amShapes[name]) && amShapes[name].length > 0, `${name} has precinct shapes`);
  }
});

test('computeInteriorPoint places pin inside concave L-shaped polygon and computeCalloutPlacements prevents overlap', () => {
  const lRing = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 },
    { x: 2, y: 2 }, { x: 2, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }
  ];
  const { cx, cy } = computeInteriorPoint(lRing);
  assert.ok(cx >= 0 && cx <= 10 && cy >= 0 && cy <= 10, 'interior point within bounds');
  assert.ok(cx < 2.5 || cy < 2.5, `interior point (${cx.toFixed(2)}, ${cy.toFixed(2)}) is inside the L-shape, not in the empty cutout`);

  const placed = computeCalloutPlacements([
    { name: 'a', sx: 400, sy: 300, w: 160, h: 48 },
    { name: 'b', sx: 405, sy: 305, w: 160, h: 48 },
  ], 800, 600);
  assert.equal(placed.length, 2);
  assert.notEqual(placed[0].place, placed[1].place, 'Close callouts separate into above and below');
});

test('Official IBGE GeoJSON mesh and 2026 + 2018-2022 election data exist for all 27 UFs', () => {
  const ufsGeo = JSON.parse(fs.readFileSync('data/br-ufs.json', 'utf8'));
  assert.equal(ufsGeo.features.length, 27);

  let totalMunicipalities = 0;
  for (const st of STATES) {
    const geo = JSON.parse(fs.readFileSync(st.data.geo, 'utf8'));
    const r2026 = JSON.parse(fs.readFileSync(st.data.r2026, 'utf8'));
    const rHist = JSON.parse(fs.readFileSync(st.data.history, 'utf8'));
    const cities = JSON.parse(fs.readFileSync(st.data.cities, 'utf8'));
    const precincts = JSON.parse(fs.readFileSync(st.data.precincts, 'utf8'));
    const prShapes = JSON.parse(fs.readFileSync(st.data.precinctShapes, 'utf8'));

    assert.ok(geo.features.length > 0, `${st.slug} has IBGE municipality features`);
    totalMunicipalities += geo.features.length;

    assert.ok(r2026.order.includes('2026-pres-2t'), `${st.slug} has 2026 presidential runoff`);
    assert.ok(r2026.order.includes('2026-gov'), `${st.slug} has 2026 governor race`);
    assert.ok(r2026.order.includes('2026-shift-pres'), `${st.slug} has 2026 shift race`);
    assert.ok(rHist.order.includes('2022-presidente'), `${st.slug} has 2022 presidential race`);
    assert.ok(rHist.order.includes('2018-presidente'), `${st.slug} has 2018 presidential race`);
    assert.ok(cities.length > 0, `${st.slug} has cities`);
    assert.ok(Object.keys(precincts.counties).length > 0, `${st.slug} has precincts`);
    assert.ok(Object.keys(prShapes).length > 0, `${st.slug} has precinct shapes`);
  }
  assert.ok(totalMunicipalities >= 5560, `Expected >= 5560 real IBGE municipalities, got ${totalMunicipalities}`);

  // Verify real TSE 2026 numbers and Censo 2022 populations for Minas Gerais (Uberaba & Uberlândia)
  const mg2026 = JSON.parse(fs.readFileSync('data/mg/results-2026.json', 'utf8'));
  const mgPres2T = mg2026.races['2026-pres-2t'];
  assert.equal(mgPres2T.dem, 'Lula (PT)');
  assert.equal(mgPres2T.rep, 'Flávio Bolsonaro (PL)');

  const ubaVotes = mgPres2T.counties['UBERABA'];
  const udiVotes = mgPres2T.counties['UBERLÂNDIA'];
  assert.deepEqual(ubaVotes, [98581, 87606, 0]);
  assert.deepEqual(udiVotes, [224129, 204001, 0]);

  const mgCities = JSON.parse(fs.readFileSync('data/mg/cities.json', 'utf8'));
  const ubaCity = mgCities.find(c => c.name === 'Uberaba');
  const udiCity = mgCities.find(c => c.name === 'Uberlândia');
  assert.equal(ubaCity.pop, 337836);
  assert.equal(udiCity.pop, 713224);
});


