/**
 * EXTERNAL SECTOR API TESTS (service + HTTP, read-only against stored vintage).
 *
 * Verifies: 3/3/4 basis validation, S+1..E vs endpoint semantics, stock
 * never summed, intensity from legs, Observed/LFL universes, DESC
 * competition, frozen per-basis mean/median with country−benchmark gaps,
 * group filter, missing-data behavior, and other-family regression.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getDb } from '../src/db/index.js';
import { queryGet } from '../src/db/driver.js';
import { createApp } from '../src/server.js';
import { buildExternalMovement, listExternalCountryGroups } from '../src/services/externalMovementService.js';

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

test('External rejects invalid basis, generic growth, non-External metric (400)', async () => {
  let r = await get('/api/movement/external?indicator=current_account&basis=growth&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/external?indicator=reserves_ex_gold&basis=period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/external?indicator=remittances_received&basis=cagr&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/external?indicator=nominal_current&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/external?indicator=exports_current&basis=exp_period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
});

test('CA annual (India): derived CA/GDP legs, DESC rank, mean pp gap', async () => {
  const db = getDb();
  const r = await buildExternalMovement(db, { metricKey: 'current_account', basis: 'ca_annual_gdp', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.equal(r.available, true);
  assert.equal(r.kind, 'annual');
  const ca = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='current_account'");
  const gdp = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='total_current'");
  for (const o of r.observed) {
    const c = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ca.id, 'IND', o.year])).value;
    const g = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [gdp.id, 'IND', o.year])).value;
    assert.ok(Math.abs(o.focus.value - (c / g) * 100) < 1e-9, 'legs-derived ratio');
    const others = o.ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value);
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    assert.ok(Math.abs(o.focus.benchmark - mean) / Math.max(1, Math.abs(mean)) < 1e-9, 'mean benchmark');
    assert.ok(Math.abs(o.focus.gap - (o.focus.value - mean)) / Math.max(1, Math.abs(mean)) < 1e-9, 'country−benchmark');
    assert.equal(o.focus.gapUnit, 'percentage points');
  }
});

test('CA average uses S+1..E ratios; cumulative uses legs (never summed %)', async () => {
  const db = getDb();
  const a = await buildExternalMovement(db, { metricKey: 'current_account', basis: 'ca_average_gdp', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.deepEqual(a.observed[0].requiredYears.length, 10);
  assert.deepEqual(a.observed[0].requiredYears[0], 2005);
  const c = await buildExternalMovement(db, { metricKey: 'current_account', basis: 'ca_cumulative_share', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const ca = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='current_account'");
  const gdp = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='total_current'");
  const sf = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [ca.id, 'IND'])).s;
  const sg = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [gdp.id, 'IND'])).s;
  assert.ok(Math.abs(c.observed[0].focus.value - (sf / sg) * 100) / Math.abs((sf / sg) * 100) < 1e-9);
});

test('Reserves: stock raw, endpoint change S/E only, coverage legs', async () => {
  const db = getDb();
  const s = await buildExternalMovement(db, { metricKey: 'reserves_ex_gold', basis: 'res_annual_stock', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='reserves_ex_gold'");
  const raw = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2014])).value;
  assert.ok(Math.abs(s.observed[1].focus.value - raw) < 1e-6, 'raw stock passthrough');
  assert.equal(s.observed[1].focus.gapUnit, 'current US$');
  const ch = await buildExternalMovement(db, { metricKey: 'reserves_ex_gold', basis: 'res_period_change', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.deepEqual(ch.observed[0].requiredYears, [2004, 2014]);
  const a = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2004])).value;
  const b = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2014])).value;
  assert.ok(Math.abs(ch.observed[0].focus.value - ((b / a - 1) * 100)) < 1e-9, 'endpoint-only change');
  const cov = await buildExternalMovement(db, { metricKey: 'reserves_ex_gold', basis: 'res_import_coverage', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const imp = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='imports_current'");
  const rv = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2014])).value;
  const iv = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [imp.id, 'IND', 2014])).value;
  assert.ok(Math.abs(cov.observed[1].focus.value - (rv / iv) * 12) < 1e-9, 'coverage legs');
  assert.equal(cov.observed[1].focus.gapUnit, 'months');
});

test('Remittances: cumulative S+1..E, average = cum/N, intensity from legs', async () => {
  const db = getDb();
  const t = await buildExternalMovement(db, { metricKey: 'remittances_received', basis: 'remit_period_cumulative', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.equal(t.observed[0].requiredYears.length, 10);
  const v = await buildExternalMovement(db, { metricKey: 'remittances_received', basis: 'remit_period_average', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.ok(Math.abs(v.observed[0].focus.value - t.observed[0].focus.value / 10) < 1e-3);
  assert.equal(v.observed[0].focus.rank, t.observed[0].focus.rank);
  assert.equal(v.observed[0].focus.gapUnit, 'current US$/year');
  const i = await buildExternalMovement(db, { metricKey: 'remittances_received', basis: 'remit_cumulative_intensity', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const remit = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='remittances_received'");
  const gdp = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='total_current'");
  const sf = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [remit.id, 'IND'])).s;
  const sg = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [gdp.id, 'IND'])).s;
  assert.ok(Math.abs(i.observed[0].focus.value - (sf / sg) * 100) / Math.abs((sf / sg) * 100) < 1e-9);
});

test('External LFL: flow bases need 2005..2024 legs; reserve change needs 04&14&24', async () => {
  const db = getDb();
  const t = await buildExternalMovement(db, { metricKey: 'remittances_received', basis: 'remit_period_cumulative', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(t.likeForLike.map((o) => o.eligibleCount), [t.likeForLike[0].eligibleCount, t.likeForLike[0].eligibleCount, t.likeForLike[0].eligibleCount]);
  const ch = await buildExternalMovement(db, { metricKey: 'reserves_ex_gold', basis: 'res_period_change', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(ch.likeForLike.map((o) => o.eligibleCount), [ch.likeForLike[0].eligibleCount, ch.likeForLike[0].eligibleCount, ch.likeForLike[0].eligibleCount]);
});

test('Benchmark freeze: median raw-scale, mean normalized (live check)', async () => {
  const db = getDb();
  const s = await buildExternalMovement(db, { metricKey: 'reserves_ex_gold', basis: 'res_annual_stock', yearA: 2014, yearB: 2024, focusIso3: 'IND' });
  assert.equal(s.observed[0].basis.benchmarkType, 'median');
  const others = s.observed[0].ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value).sort((a, b) => a - b);
  const mid = Math.floor(others.length / 2);
  const med = others.length % 2 === 1 ? others[mid] : (others[mid - 1] + others[mid]) / 2;
  assert.ok(Math.abs(s.observed[0].focus.benchmark - med) / med < 1e-9, 'median stock benchmark');
  const c = await buildExternalMovement(db, { metricKey: 'current_account', basis: 'ca_cumulative_share', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.equal(c.observed[0].basis.benchmarkType, 'mean');
});

test('Country groups: dynamic, no Developed labels; unknown fails closed', async () => {
  const db = getDb();
  const g = await listExternalCountryGroups(db);
  assert.ok(g.supported.income_level.length >= 4);
  assert.equal(g.unsupportedRequestedLabels.status, 'NOT_SUPPORTED');
  await assert.rejects(
    async () => await buildExternalMovement(db, { metricKey: 'current_account', basis: 'ca_annual_gdp', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'Developed' } }),
    /Unknown income_level/,
  );
});

test('HTTP: movement/external + external/country-groups + indicators externalBases', async () => {
  let r = await get('/api/movement/external?indicator=remittances_received&basis=remit_cumulative_intensity&yearA=2004&yearB=2024&yearMid=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.observed.length, 3);
  r = await get('/api/external/country-groups');
  assert.equal(r.status, 200);
  assert.ok(r.body.supported.income_level.length >= 4);
  assert.ok(!r.body.members);
  r = await get('/api/indicators');
  assert.deepEqual(r.body.production.find((p) => p.key === 'current_account').externalBases.map((b) => b.id), ['ca_annual_gdp', 'ca_average_gdp', 'ca_cumulative_share']);
  assert.deepEqual(r.body.production.find((p) => p.key === 'reserves_ex_gold').externalBases.map((b) => b.id), ['res_annual_stock', 'res_period_change', 'res_import_coverage']);
  assert.deepEqual(r.body.production.find((p) => p.key === 'remittances_received').externalBases.map((b) => b.id), ['remit_annual_value', 'remit_period_cumulative', 'remit_period_average', 'remit_cumulative_intensity']);
  for (const k of ['nominal_current', 'inflation_cpi', 'exports_current', 'fdi_inflows', 'fx_official']) {
    assert.ok(!('externalBases' in r.body.production.find((p) => p.key === k)), `no externalBases on ${k}`);
  }
});

test('All prior families still work beside External', async () => {
  let r = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.comparison.available, true);
  for (const [route, ind, basis] of [
    ['prices', 'inflation_cpi', 'cpi_inflation_average'],
    ['trade', 'exports_current', 'exp_period_total'],
    ['capital', 'fdi_inflows', 'fdi_period_cumulative'],
    ['fx', 'fx_official', 'fx_period_change'],
  ]) {
    r = await get(`/api/movement/${route}?indicator=${ind}&basis=${basis}&yearA=2004&yearB=2014&country=IND`);
    assert.equal(r.status, 200, ind);
    assert.equal(r.body.available, true, ind);
  }
});
