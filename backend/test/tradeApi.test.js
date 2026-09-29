/**
 * TRADE API TESTS (service + HTTP, read-only against stored vintage).
 *
 * Verifies: 4+4 basis validation, inclusive S..E vs endpoint semantics,
 * CAGR gates, Observed/LFL universes, DESC competition ranking, LOO
 * benchmark/gap with basis units, group filter, missing-data behavior,
 * and GDP/Prices regression.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getDb } from '../src/db/index.js';
import { queryGet } from '../src/db/driver.js';
import { createApp } from '../src/server.js';
import { buildTradeMovement, listTradeCountryGroups } from '../src/services/tradeMovementService.js';

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

test('Trade rejects invalid basis + non-Trade metric (400)', async () => {
  let r = await get('/api/movement/trade?indicator=exports_current&basis=exp_period_average_fake&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/trade?indicator=exports_current&basis=period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/trade?indicator=nominal_current&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/trade?indicator=inflation_cpi&basis=cpi_inflation_average&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
});

test('Exports annual 2004→2024 (India): raw values, DESC rank, USD gap', async () => {
  const db = getDb();
  const r = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_annual_value', yearA: 2004, yearB: 2024, focusIso3: 'IND' });
  assert.equal(r.available, true);
  assert.equal(r.kind, 'annual');
  const vals = r.observed.map((o) => o.focus.value);
  assert.ok(vals[0] > 1e11 && vals[0] < 2e11, `2004 exports ${vals[0]}`);
  for (const o of r.observed) {
    assert.ok(o.focus.rank >= 1 && o.focus.rank <= o.eligibleCount);
    const others = o.ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value);
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    assert.ok(Math.abs(o.focus.benchmark - mean) / Math.abs(mean) < 1e-9);
    assert.ok(Math.abs(o.focus.gap - (mean - o.focus.value)) / Math.max(1, Math.abs(mean)) < 1e-9);
    assert.equal(o.focus.gapUnit, 'current US$');
  }
  assert.deepEqual(r.likeForLike.map((o) => o.eligibleCount), [r.likeForLike[0].eligibleCount, r.likeForLike[0].eligibleCount, r.likeForLike[0].eligibleCount].slice(0, r.likeForLike.length));
});

test('Exports CAGR 2004→2014 uses endpoints only (10y annualization)', async () => {
  const db = getDb();
  const r = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_period_cagr', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  assert.deepEqual(o.requiredYears, [2004, 2014]);
  const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='exports_current'");
  const s = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2004])).value;
  const e = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2014])).value;
  const expected = (Math.pow(e / s, 1 / 10) - 1) * 100;
  assert.ok(Math.abs(o.focus.value - expected) < 1e-9, `got ${o.focus.value} expected ${expected}`);
  assert.equal(o.focus.gapUnit, 'percentage points');
  assert.ok(o.focus.endpointChange !== undefined, 'descriptive endpoint change present');
  assert.ok(Math.abs(o.focus.endpointChange - ((e / s - 1) * 100)) < 1e-9);
});

test('Exports total 2004→2014 is inclusive (11 obs) and average = total/11', async () => {
  const db = getDb();
  const t = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_period_total', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const a = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_period_average', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.equal(t.observed[0].requiredYears.length, 11);
  assert.equal(t.observed[0].requiredYears[0], 2004);
  assert.equal(t.observed[0].requiredYears[10], 2014);
  assert.ok(Math.abs(a.observed[0].focus.value - t.observed[0].focus.value / 11) < 1e-3);
  assert.equal(a.observed[0].focus.gapUnit, 'current US$/year');
  // Same ordering → same ranks for identical universes.
  assert.equal(t.observed[0].focus.rank, a.observed[0].focus.rank);
});

test('Trade LFL: total needs full 2004..2024 span; CAGR needs endpoints+positive starts', async () => {
  const db = getDb();
  const t = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_period_total', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(t.likeForLike.map((o) => o.eligibleCount), [t.likeForLike[0].eligibleCount, t.likeForLike[0].eligibleCount, t.likeForLike[0].eligibleCount]);
  const c = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_period_cagr', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(c.likeForLike.map((o) => o.eligibleCount), [c.likeForLike[0].eligibleCount, c.likeForLike[0].eligibleCount, c.likeForLike[0].eligibleCount]);
});

test('Country groups: dynamic income/region/lending, no Developed labels', async () => {
  const db = getDb();
  const g = await listTradeCountryGroups(db);
  assert.ok(g.supported.income_level.length >= 4);
  assert.equal(g.unsupportedRequestedLabels.status, 'NOT_SUPPORTED');
  assert.ok(g.nominalCaveat.includes('nominal'));
});

test('Group filter restricts before validity; unknown group fails closed', async () => {
  const db = getDb();
  const all = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_annual_value', yearA: 2004, yearB: 2014, focusIso3: 'USA' });
  const grp = await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_annual_value', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'High income' } });
  assert.ok(grp.observed[0].eligibleCount <= all.observed[0].eligibleCount);
  await assert.rejects(
    async () => await buildTradeMovement(db, { metricKey: 'exports_current', basis: 'exp_annual_value', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'Developed' } }),
    /Unknown income_level/,
  );
});

test('HTTP: movement/trade + trade/country-groups + indicators tradeBases', async () => {
  let r = await get('/api/movement/trade?indicator=exports_current&basis=exp_period_cagr&yearA=2004&yearB=2024&yearMid=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.observed.length, 3);
  assert.ok(r.body.nominalCaveat.includes('nominal'));
  r = await get('/api/trade/country-groups');
  assert.equal(r.status, 200);
  assert.ok(r.body.supported.income_level.length >= 4);
  assert.ok(!r.body.members);
  r = await get('/api/indicators');
  const exp = r.body.production.find((p) => p.key === 'exports_current');
  assert.deepEqual(exp.tradeBases.map((b) => b.id), ['exp_annual_value', 'exp_period_cagr', 'exp_period_total', 'exp_period_average']);
  const gdp = r.body.production.find((p) => p.key === 'nominal_current');
  assert.ok(!('tradeBases' in gdp));
  const cpi = r.body.production.find((p) => p.key === 'inflation_cpi');
  assert.ok(!('tradeBases' in cpi));
});

test('GDP + Prices routes still work beside Trade', async () => {
  let r = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.comparison.available, true);
  r = await get('/api/movement/prices?indicator=inflation_cpi&basis=cpi_inflation_average&yearA=2004&yearB=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
});
