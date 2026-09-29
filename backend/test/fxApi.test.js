/**
 * EXCHANGE RATE API TESTS (service + HTTP, read-only against stored vintage).
 *
 * Verifies: 3 canonical bases (CAGR never a basis), endpoint-only periods,
 * t−1/t annual eligibility, LFL intersections, DESC competition, LOO median
 * (never mean), country−median pp gaps, group filter, missing-data states.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getDb } from '../src/db/index.js';
import { queryGet } from '../src/db/driver.js';
import { createApp } from '../src/server.js';
import { buildFxMovement, listFxCountryGroups } from '../src/services/fxMovementService.js';

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

test('FX rejects invalid basis, CAGR-as-basis, non-FX metric (400)', async () => {
  let r = await get('/api/movement/fx?indicator=fx_official&basis=fx_cagr&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/fx?indicator=fx_official&basis=growth&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/fx?indicator=fx_official&basis=period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/fx?indicator=nominal_current&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
});

test('Basis A: raw levels, never ranked/benchmarked', async () => {
  const db = getDb();
  const r = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_annual_rate', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.equal(r.available, true);
  for (const o of r.observed) {
    assert.equal(o.rankable, false);
    assert.deepEqual(o.ranking, []);
    assert.equal(o.focus.benchmark, undefined);
    const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fx_official'");
    const raw = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', o.year])).value;
    assert.ok(Math.abs(o.focus.value - raw) < 1e-9, 'raw passthrough');
  }
});

test('Basis B: annual change needs t−1 and t (India 2004 = 45.316/46.583 − 1)', async () => {
  const db = getDb();
  const r = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_annual_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  assert.deepEqual(o.requiredYears, [2003, 2004]);
  const expected = (45.3164666666666 / 46.5832841666667 - 1) * 100;
  assert.ok(Math.abs(o.focus.value - expected) < 1e-9, `got ${o.focus.value}`);
  assert.equal(o.focus.gapUnit, 'percentage points');
});

test('Basis C: period change endpoints-only (India 2004→2014 ≈ +34.67%)', async () => {
  const db = getDb();
  const r = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_period_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  assert.deepEqual(o.requiredYears, [2004, 2014]);
  const expected = (61.0295144607843 / 45.3164666666666 - 1) * 100;
  assert.ok(Math.abs(o.focus.value - expected) < 1e-9, `got ${o.focus.value}`);
  // CAGR display-only secondary present, same ordering (no separate rank).
  assert.ok(o.focus.cagr !== undefined && o.focus.cagr !== null);
  const cagrExpected = (Math.pow(61.0295144607843 / 45.3164666666666, 1 / 10) - 1) * 100;
  assert.ok(Math.abs(o.focus.cagr - cagrExpected) < 1e-9);
});

test('Median (not mean): benchmark recomputed as LOO median', async () => {
  const db = getDb();
  const r = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_period_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  const others = o.ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value).sort((a, b) => a - b);
  const mid = Math.floor(others.length / 2);
  const expectedMedian = others.length % 2 === 1 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
  assert.ok(Math.abs(o.focus.benchmark - expectedMedian) < 1e-9, `got ${o.focus.benchmark} expected ${expectedMedian}`);
  assert.ok(Math.abs(o.focus.gap - (o.focus.value - expectedMedian)) < 1e-9, 'gap = country − median');
  // Mean would differ materially (skewed right tail).
  const mean = others.reduce((s, v) => s + v, 0) / others.length;
  assert.ok(Math.abs(mean - expectedMedian) > 0.5, `mean ${mean} vs median ${expectedMedian} must differ`);
});

test('DESC competition rank from full cross-section (no ASC leakage)', async () => {
  const db = getDb();
  const r = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_period_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  const top = [...o.ranking].sort((a, b) => b.value - a.value)[0];
  assert.equal(top.rank, 1);
  assert.ok(top.value >= o.focus.value, 'rank 1 is max depreciation');
  assert.ok(o.ranking.every((x) => x.rank >= 1 && x.rank <= o.eligibleCount));
});

test('LFL: period needs S&M&E; annual needs every t−1/t pair', async () => {
  const db = getDb();
  const p = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_period_change', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(p.likeForLike.map((o) => o.eligibleCount), [p.likeForLike[0].eligibleCount, p.likeForLike[0].eligibleCount, p.likeForLike[0].eligibleCount]);
  const a = await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_annual_change', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(a.likeForLike.map((o) => o.eligibleCount), [a.likeForLike[0].eligibleCount, a.likeForLike[0].eligibleCount, a.likeForLike[0].eligibleCount]);
  assert.deepEqual(a.observed[0].requiredYears, [2003, 2004]);
});

test('Country groups: dynamic, no Developed labels; unknown fails closed', async () => {
  const db = getDb();
  const g = await listFxCountryGroups(db);
  assert.ok(g.supported.income_level.length >= 4);
  assert.equal(g.unsupportedRequestedLabels.status, 'NOT_SUPPORTED');
  assert.ok(g.continuityNote.includes('no authoritative'));
  await assert.rejects(
    async () => await buildFxMovement(db, { metricKey: 'fx_official', basis: 'fx_period_change', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'Developed' } }),
    /Unknown income_level/,
  );
});

test('HTTP: movement/fx + fx/country-groups + indicators fxBases', async () => {
  let r = await get('/api/movement/fx?indicator=fx_official&basis=fx_period_change&yearA=2004&yearB=2024&yearMid=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.observed.length, 3);
  assert.equal(r.body.basis.rankDirection, 'DESC');
  assert.equal(r.body.basis.benchmarkType, 'median');
  r = await get('/api/fx/country-groups');
  assert.equal(r.status, 200);
  assert.ok(r.body.supported.income_level.length >= 4);
  assert.ok(!r.body.members);
  r = await get('/api/indicators');
  const fx = r.body.production.find((p) => p.key === 'fx_official');
  assert.deepEqual(fx.fxBases.map((b) => b.id), ['fx_annual_rate', 'fx_annual_change', 'fx_period_change']);
  for (const k of ['nominal_current', 'inflation_cpi', 'exports_current', 'fdi_inflows']) {
    assert.ok(!('fxBases' in r.body.production.find((p) => p.key === k)), `no fxBases on ${k}`);
  }
});

test('GDP + Prices + Trade + Capital routes still work beside FX', async () => {
  let r = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.comparison.available, true);
  for (const [ind, basis] of [
    ['inflation_cpi', 'cpi_inflation_average'],
    ['exports_current', 'exp_period_total'],
    ['fdi_inflows', 'fdi_period_cumulative'],
  ]) {
    r = await get(`/api/movement/${ind.startsWith('inflation') ? 'prices' : ind.startsWith('exp') ? 'trade' : 'capital'}?indicator=${ind}&basis=${basis}&yearA=2004&yearB=2014&country=IND`);
    assert.equal(r.status, 200, ind);
    assert.equal(r.body.available, true, ind);
  }
});
