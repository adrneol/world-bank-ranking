/**
 * POPULATION API TESTS (service + HTTP, read-only against stored vintage).
 *
 * Verifies: 3 canonical bases (CAGR never a basis), endpoint-only periods,
 * stock never summed, Observed/LFL endpoint intersections, DESC competition,
 * mean LOO with country−benchmark gaps, group filter, missing-data states.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getDb } from '../src/db/index.js';
import { createApp } from '../src/server.js';
import { buildPopulationMovement, listPopulationCountryGroups } from '../src/services/populationMovementService.js';

function app() {
  return createApp({ db: getDb(), autoRefresh: false });
}

async function get(path) {
  const a = app();
  return new Promise((resolve, reject) => {
    const server = a.listen(0, async () => {
      try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Accept: 'application/json' } });
        const body = await res.json();
        resolve({ status: res.status, body });
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test('Population rejects invalid basis, CAGR-as-basis, cumulative, non-Population metric (400)', async () => {
  for (const basis of ['pop_cagr', 'pop_cumulative', 'pop_average', 'growth', 'period_total']) {
    const r = await get(`/api/movement/population?indicator=population_total&basis=${basis}&yearA=2004&yearB=2014`);
    assert.equal(r.status, 400, basis);
  }
  const r = await get('/api/movement/population?indicator=nominal_current&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
});

test('Annual (India): raw stock, DESC rank, mean people gap', async () => {
  const db = getDb();
  const r = buildPopulationMovement(db, { metricKey: 'population_total', basis: 'pop_annual_value', yearA: 2004, yearB: 2024, focusIso3: 'IND' });
  assert.equal(r.available, true);
  assert.equal(r.kind, 'annual');
  const ind = db.prepare("SELECT id FROM indicators WHERE metric_key='population_total'").get();
  for (const o of r.observed) {
    const raw = db.prepare('SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?').get(ind.id, 'IND', o.year).value;
    assert.ok(Math.abs(o.focus.value - raw) < 1, 'raw passthrough');
    const others = o.ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value);
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    assert.ok(Math.abs(o.focus.benchmark - mean) / mean < 1e-9, 'mean benchmark');
    assert.ok(Math.abs(o.focus.gap - (o.focus.value - mean)) / Math.abs(mean) < 1e-9, 'country−benchmark');
    assert.equal(o.focus.gapUnit, 'people');
  }
});

test('Change uses endpoints only: 1312277191 − 1135991513 = 176285678', async () => {
  const db = getDb();
  const r = buildPopulationMovement(db, { metricKey: 'population_total', basis: 'pop_period_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  assert.deepEqual(o.requiredYears, [2004, 2014]);
  assert.ok(Math.abs(o.focus.value - 176285678) < 1, `got ${o.focus.value}`);
  assert.equal(o.focus.gapUnit, 'people');
});

test('Growth uses endpoints only with CAGR secondary (same rank, no separate basis)', async () => {
  const db = getDb();
  const r = buildPopulationMovement(db, { metricKey: 'population_total', basis: 'pop_period_growth', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  const expected = (1312277191 / 1135991513 - 1) * 100;
  assert.ok(Math.abs(o.focus.value - expected) < 1e-9, `got ${o.focus.value}`);
  const cagrExpected = (Math.pow(1312277191 / 1135991513, 1 / 10) - 1) * 100;
  assert.ok(Math.abs(o.focus.cagr - cagrExpected) < 1e-9, 'CAGR display present');
  assert.equal(o.focus.gapUnit, 'percentage points');
});

test('Population LFL: endpoint intersection (never sequences)', async () => {
  const db = getDb();
  const r = buildPopulationMovement(db, { metricKey: 'population_total', basis: 'pop_period_growth', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(r.likeForLike.map((o) => o.eligibleCount), [r.likeForLike[0].eligibleCount, r.likeForLike[0].eligibleCount, r.likeForLike[0].eligibleCount]);
  for (const o of r.likeForLike) {
    assert.deepEqual(o.requiredYears.length <= 2, true);
  }
});

test('Country groups: dynamic, no Developed labels; unknown fails closed', async () => {
  const db = getDb();
  const g = listPopulationCountryGroups(db);
  assert.ok(g.supported.income_level.length >= 4);
  assert.equal(g.unsupportedRequestedLabels.status, 'NOT_SUPPORTED');
  assert.ok(g.estimateNote.includes('estimates'));
  assert.throws(
    () => buildPopulationMovement(db, { metricKey: 'population_total', basis: 'pop_annual_value', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'Developed' } }),
    /Unknown income_level/,
  );
});

test('HTTP: movement/population + population/country-groups + indicators populationBases', async () => {
  let r = await get('/api/movement/population?indicator=population_total&basis=pop_period_growth&yearA=2004&yearB=2024&yearMid=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.observed.length, 3);
  assert.ok(r.body.estimateNote.includes('estimates'));
  r = await get('/api/population/country-groups');
  assert.equal(r.status, 200);
  assert.ok(r.body.supported.income_level.length >= 4);
  assert.ok(!r.body.members);
  r = await get('/api/indicators');
  assert.deepEqual(r.body.production.find((p) => p.key === 'population_total').populationBases.map((b) => b.id), ['pop_annual_value', 'pop_period_change', 'pop_period_growth']);
  for (const k of ['nominal_current', 'inflation_cpi', 'exports_current', 'fdi_inflows', 'fx_official', 'current_account']) {
    assert.ok(!('populationBases' in r.body.production.find((p) => p.key === k)), `no populationBases on ${k}`);
  }
});

test('All prior families still work beside Population', async () => {
  let r = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.comparison.available, true);
  for (const [route, ind, basis] of [
    ['prices', 'inflation_cpi', 'cpi_inflation_average'],
    ['trade', 'exports_current', 'exp_period_total'],
    ['capital', 'fdi_inflows', 'fdi_period_cumulative'],
    ['fx', 'fx_official', 'fx_period_change'],
    ['external', 'current_account', 'ca_cumulative_share'],
  ]) {
    r = await get(`/api/movement/${route}?indicator=${ind}&basis=${basis}&yearA=2004&yearB=2014&country=IND`);
    assert.equal(r.status, 200, ind);
    assert.equal(r.body.available, true, ind);
  }
});
