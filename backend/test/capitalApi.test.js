/**
 * CAPITAL FLOW API TESTS (service + HTTP, read-only against stored vintage).
 *
 * Verifies: 3+3 basis validation (diagnostics NOT bases), S+1..E semantics,
 * negative/zero preservation, Observed/LFL universes, DESC competition
 * ranking, country−benchmark gaps with basis units, group filter,
 * missing-data behavior, and GDP/Prices/Trade regression.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getDb } from '../src/db/index.js';
import { queryAll, queryGet } from '../src/db/driver.js';
import { createApp } from '../src/server.js';
import { buildCapitalMovement, listCapitalCountryGroups } from '../src/services/capitalMovementService.js';

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

test('Capital rejects invalid basis, % growth, non-Capital metric (400)', async () => {
  let r = await get('/api/movement/capital?indicator=fdi_inflows&basis=fdi_growth&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/capital?indicator=fdi_inflows&basis=period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/capital?indicator=fdi_inflows&basis=fdi_period_cagr&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/capital?indicator=nominal_current&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
  r = await get('/api/movement/capital?indicator=exports_current&basis=exp_period_total&yearA=2004&yearB=2014');
  assert.equal(r.status, 400);
});

test('FDI annual (India): raw values, DESC rank, country−benchmark USD gap', async () => {
  const db = getDb();
  const r = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_annual_value', yearA: 2004, yearB: 2024, focusIso3: 'IND' });
  assert.equal(r.available, true);
  assert.equal(r.kind, 'annual');
  const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fdi_inflows'");
  for (const o of r.observed) {
    const raw = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', o.year])).value;
    assert.ok(Math.abs(o.focus.value - raw) < 1e-6, 'raw passthrough');
    const others = o.ranking.filter((x) => x.iso3 !== 'IND').map((x) => x.value);
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    assert.ok(Math.abs(o.focus.benchmark - mean) / Math.max(1, Math.abs(mean)) < 1e-9);
    assert.ok(Math.abs(o.focus.gap - (o.focus.value - mean)) / Math.max(1, Math.abs(mean)) < 1e-9, 'country−benchmark sign');
    assert.equal(o.focus.gapUnit, 'current US$');
  }
});

test('FDI cumulative 2004→2014 uses S+1..E (10 obs, boundary excluded)', async () => {
  const db = getDb();
  const r = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_period_cumulative', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  assert.deepEqual(o.requiredYears.length, 10);
  assert.deepEqual(o.requiredYears[0], 2005);
  const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fdi_inflows'");
  const rows = await queryAll(db, 'SELECT year,value FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014 ORDER BY year', [ind.id, 'IND']);
  const expected = rows.reduce((s, x) => s + x.value, 0);
  assert.ok(Math.abs(o.focus.value - expected) < 1e-3, `got ${o.focus.value} expected ${expected}`);
  assert.equal(o.focus.gapUnit, 'current US$');
});

test('FDI average = cumulative / 10 with identical rank ordering', async () => {
  const db = getDb();
  const c = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_period_cumulative', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const a = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_period_average', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.ok(Math.abs(a.observed[0].focus.value - c.observed[0].focus.value / 10) < 1e-3);
  assert.equal(a.observed[0].focus.rank, c.observed[0].focus.rank);
  assert.equal(a.observed[0].focus.gapUnit, 'current US$/year');
});

test('Cumulative FDI/GDP derives from FDI+GDP legs (never summed percentages)', async () => {
  const db = getDb();
  const r = await buildCapitalMovement(db, { metricKey: 'fdi_inflows_pct_gdp', basis: 'fdigdp_period_cumulative_share', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  const o = r.observed[0];
  const fdi = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fdi_inflows'");
  const gdp = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='total_current'");
  const sf = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [fdi.id, 'IND'])).s;
  const sg = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [gdp.id, 'IND'])).s;
  const expected = (sf / sg) * 100;
  assert.ok(Math.abs(o.focus.value - expected) / Math.abs(expected) < 1e-9, `got ${o.focus.value} expected ${expected}`);
  assert.equal(o.focus.gapUnit, 'percentage points');
  // And it must NOT equal the sum of annual percentages.
  const ratio = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fdi_inflows_pct_gdp'");
  const summed = (await queryGet(db, 'SELECT SUM(value) s FROM observations WHERE indicator_id=? AND country_id=? AND year BETWEEN 2005 AND 2014', [ratio.id, 'IND'])).s;
  assert.ok(Math.abs(o.focus.value - summed) > 0.5, 'cumulative share differs from summed percentages');
});

test('Diagnostics present but unranked (endpoint change only)', async () => {
  const db = getDb();
  const r = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_period_cumulative', yearA: 2004, yearB: 2014, focusIso3: 'IND' });
  assert.ok(r.descriptive && r.descriptive.diagnosticOnly === true);
  assert.ok(r.descriptive.periods.length === 1);
  const ind = await queryGet(db, "SELECT id FROM indicators WHERE metric_key='fdi_inflows'");
  const s = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2004])).value;
  const e = (await queryGet(db, 'SELECT value FROM observations WHERE indicator_id=? AND country_id=? AND year=?', [ind.id, 'IND', 2014])).value;
  assert.ok(Math.abs(r.descriptive.periods[0].endpointChange - (e - s)) < 1e-3);
});

test('Capital LFL: flow bases need complete 2005..2024; annual needs selected years', async () => {
  const db = getDb();
  const c = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_period_cumulative', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(c.likeForLike.map((o) => o.eligibleCount), [c.likeForLike[0].eligibleCount, c.likeForLike[0].eligibleCount, c.likeForLike[0].eligibleCount]);
  const a = await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_annual_value', yearA: 2004, yearB: 2024, yearMid: 2014, focusIso3: 'IND' });
  assert.deepEqual(a.likeForLike.map((o) => o.eligibleCount), [a.likeForLike[0].eligibleCount, a.likeForLike[0].eligibleCount, a.likeForLike[0].eligibleCount]);
});

test('Country groups: dynamic, no Developed labels; unknown fails closed', async () => {
  const db = getDb();
  const g = await listCapitalCountryGroups(db);
  assert.ok(g.supported.income_level.length >= 4);
  assert.equal(g.unsupportedRequestedLabels.status, 'NOT_SUPPORTED');
  assert.ok(g.flowNote.includes('flows, not stocks'));
  await assert.rejects(
    async () => await buildCapitalMovement(db, { metricKey: 'fdi_inflows', basis: 'fdi_annual_value', yearA: 2004, yearB: 2014, focusIso3: 'USA', group: { type: 'income_level', value: 'Developed' } }),
    /Unknown income_level/,
  );
});

test('HTTP: movement/capital + capital/country-groups + indicators capitalBases', async () => {
  let r = await get('/api/movement/capital?indicator=fdi_inflows&basis=fdi_period_cumulative&yearA=2004&yearB=2024&yearMid=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.observed.length, 3);
  assert.ok(r.body.flowNote.includes('flows, not stocks'));
  r = await get('/api/capital/country-groups');
  assert.equal(r.status, 200);
  assert.ok(r.body.supported.income_level.length >= 4);
  assert.ok(!r.body.members);
  r = await get('/api/indicators');
  const fdi = r.body.production.find((p) => p.key === 'fdi_inflows');
  assert.deepEqual(fdi.capitalBases.map((b) => b.id), ['fdi_annual_value', 'fdi_period_cumulative', 'fdi_period_average']);
  const ratio = r.body.production.find((p) => p.key === 'fdi_inflows_pct_gdp');
  assert.deepEqual(ratio.capitalBases.map((b) => b.id), ['fdigdp_annual_value', 'fdigdp_period_average', 'fdigdp_period_cumulative_share']);
  for (const k of ['nominal_current', 'inflation_cpi', 'exports_current']) {
    assert.ok(!('capitalBases' in r.body.production.find((p) => p.key === k)), `no capitalBases on ${k}`);
  }
});

test('GDP + Prices + Trade routes still work beside Capital', async () => {
  let r = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=summary');
  assert.equal(r.status, 200);
  assert.equal(r.body.comparison.available, true);
  r = await get('/api/movement/prices?indicator=inflation_cpi&basis=cpi_inflation_average&yearA=2004&yearB=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  r = await get('/api/movement/trade?indicator=exports_current&basis=exp_period_total&yearA=2004&yearB=2014&country=IND');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
});
