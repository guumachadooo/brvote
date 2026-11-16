import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pointInRing, computeInteriorPoint, computeCalloutPlacements } from './callout-logic.js';

test('computeInteriorPoint returns exact center even when one edge has dense river vertices', () => {
  // Quadrado 0..100 onde a borda esquerda tem 50 vértices densos e a direita tem apenas 2
  const ring = [];
  for (let i = 0; i <= 50; i++) {
    ring.push({ x: 0, y: (i / 50) * 100 });
  }
  ring.push({ x: 100, y: 100 });
  ring.push({ x: 100, y: 0 });

  const pt = computeInteriorPoint(ring);
  assert.ok(Math.abs(pt.cx - 50) < 0.01, `expected cx ~ 50, got ${pt.cx}`);
  assert.ok(Math.abs(pt.cy - 50) < 0.01, `expected cy ~ 50, got ${pt.cy}`);
  assert.equal(pointInRing(pt.cx, pt.cy, ring), true);
});

test('computeInteriorPoint falls back to interior point on concave C-shaped polygon', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 20 },
    { x: 20, y: 20 },
    { x: 20, y: 80 },
    { x: 100, y: 80 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const pt = computeInteriorPoint(ring);
  assert.equal(pointInRing(pt.cx, pt.cy, ring), true, 'interior point must lie inside C-shaped ring');
});

test('computeCalloutPlacements keeps two close pins horizontally centered (dx = 0) by placing one above and one below', () => {
  const res = computeCalloutPlacements([
    { sx: 400, sy: 290, w: 150, h: 42 },
    { sx: 412, sy: 305, w: 150, h: 42 },
  ], 800, 600);
  assert.equal(res[0].place, 'above');
  assert.equal(res[1].place, 'below');
  assert.equal(res[0].dx, 0);
  assert.equal(res[1].dx, 0);
});

import { createCartogramWarper } from './cartogram.js';

test('Brazil full-country 3D dataset (data/br) has all 27 UFs, unified Brasília (DF), and national races', () => {
  const geo = JSON.parse(fs.readFileSync('./data/br/municipios.json', 'utf8'));
  const r2026 = JSON.parse(fs.readFileSync('./data/br/results-2026.json', 'utf8'));
  const rHist = JSON.parse(fs.readFileSync('./data/br/results-history.json', 'utf8'));
  const cities = JSON.parse(fs.readFileSync('./data/br/cities.json', 'utf8'));
  const precincts = JSON.parse(fs.readFileSync('./data/br/precincts.json', 'utf8'));

  assert.equal(geo.features.length, 27);
  assert.ok(cities.length >= 27);
  assert.ok(cities.some(c => c.name.includes('Brasília')), 'Brasília (DF) must be in data/br/cities.json');
  assert.ok(Object.keys(r2026.races['2026-pres-2t'].counties).length === 27);
  assert.ok(Object.keys(rHist.races['2022-presidente'].counties).length === 27);
  assert.equal(Object.keys(precincts.counties).length, 27);

  // Verify Distrito Federal is 1 unified municipality (Brasília) with > 1.8M votes
  const dfMuns = precincts.counties['DISTRITO FEDERAL'];
  assert.equal(dfMuns.length, 1, 'Distrito Federal in br/precincts.json must be 1 unified Brasília entry');
  assert.ok(dfMuns[0][1] > 1800000, `Expected Brasília total votes > 1.8M, got ${dfMuns[0][1]}`);
});

test('createCartogramWarper expands high-vote density regions and preserves identity at mix=0', () => {
  const mockCounties = [
    { cx: -20, cy: 0, area: 100, cur: { tot: 1000000 } },
    { cx: 20, cy: 0, area: 100, cur: { tot: 10000 } },
  ];
  const warper = createCartogramWarper(mockCounties);
  warper.prepareTargets();

  assert.equal(warper.getMix(), 0);

  // Point just to the right of the heavy (-20, 0) center should have positive dx displacement (+X)
  const [dx, dy] = warper.evalDisplacement(-15, 0);
  assert.ok(dx > 0, `Expected high-weight center at -20 to push x=-15 outward (dx > 0), got ${dx}`);
  assert.ok(Math.abs(dy) < 1e-6);
});

