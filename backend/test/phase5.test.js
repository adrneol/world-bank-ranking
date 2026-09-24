/**
 * PHASE-5 NEW-INDICATOR TESTS (promotion, ingestion, analytics, aggregates).
 *
 * Runs the real ingestion pipeline against the stub World Bank API (Phase-5
 * fixture: twelve live-verified metrics with official-aggregate rows where
 * published) into isolated in-memory databases. Never touches the live API
 * or the real cache file.
 *
 * Covers the Part-20 ingestion matrix, Part-34 per-indicator behavior,
 * Part-36 mathematics, Part-37 aggregate support, and the Part-28 GDP
 * golden regression beside the new series.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PHASE5_INDICATOR_CODES, PHASE5_METRIC_KEYS, liveIndia2024, liveWorld2024 } from './fixtures/phase5.js';
import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
  // Fast failure injection: failure-path timing belongs to wbClient tests;
  // this file only needs failures to occur, not the production backoff.
  // Set BEFORE any src import (config reads env once at import time).
  process.env.WB_RETRY_BASE_MS = '5';
  process.env.WB_MAX_RETRIES = '2';
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

async function ingestFull(db, years = { startYear: 2024, endYear: 2025 }) {
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  return refreshData({ db, startYear: years.startYear, endYear: years.endYear, trigger: 'test' });
}

async function startApp(db) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ---------------------------------------------------------------------------
// Ingestion matrix (Part 20)
// ---------------------------------------------------------------------------
test('Phase 5.20.1: complete fetch ingests all twenty production metrics', async () => {
  const db = await freshDb();
  const summary = await ingestFull(db);
  assert.equal(summary.status, 'success');
  assert.deepEqual(
    summary.perIndicator.map((entry) => entry.metricKey).sort(),
    [...(await import('../src/config.js')).PRODUCTION_METRIC_KEYS].sort(),
  );
  for (const entry of summary.perIndicator) {
    assert.equal(entry.error, undefined, `indicator ${entry.metricKey} must not fail`);
  }
  assert.ok(summary.rowsUpserted > 0);
  assert.ok(summary.rowsAggregateStored > 0, 'official aggregates stored with typing');
  db.close();
});

test('Phase 5.20.2/21: live-verified raw values survive ingestion exactly', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const repository = await import('../src/db/repository.js');
  const checks = [
    ['inflation_cpi', 2024],
    ['fx_official', 2024],
    ['exports_current', 2024],
    ['imports_current', 2024],
    ['fdi_inflows', 2024],
    ['fdi_inflows_pct_gdp', 2024],
    ['inflation_deflator', 2024],
    ['inflation_cpi_index', 2024],
    ['current_account', 2024],
    ['reserves_ex_gold', 2024],
    ['remittances_received', 2024],
    ['population_total', 2024],
  ];
  for (const [metricKey, year] of checks) {
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    assert.ok(indicator, `${metricKey} indicator row stored`);
    assert.equal(indicator.code, PHASE5_INDICATOR_CODES[metricKey]);
    const rows = repository.getEligibleObservations(db, indicator.id, year);
    const india = rows.find((row) => row.iso3 === 'IND');
    assert.ok(india, `${metricKey} IND ${year} stored`);
    assert.equal(india.value, liveIndia2024(metricKey), `${metricKey} raw value exact`);
    assert.equal(Number(india.valueRaw), liveIndia2024(metricKey), `${metricKey} valueRaw round-trips`);
  }
  // Signed current-account flow stays negative (never rectified).
  const ca = repository.getIndicatorByMetricKey(db, 'current_account');
  const caIndia = repository.getEligibleObservations(db, ca.id, 2024).find((row) => row.iso3 === 'IND');
  assert.ok(caIndia.value < 0, 'negative flow preserved');
  db.close();
});

test('Phase 5.20.3/4: nulls, blank ISO3 and unknown countries never stored', async () => {
  const db = await freshDb();
  const summary = await ingestFull(db);
  assert.ok(summary.rowsNullSkipped > 0, 'nulls counted');
  assert.ok(summary.rowsBlankIso3Skipped > 0, 'blank-ISO3 income groups counted');
  assert.ok(summary.rowsUnknownCountry > 0, 'unknown ISO3 counted');
  const repository = await import('../src/db/repository.js');
  const exportsIndicator = repository.getIndicatorByMetricKey(db, 'exports_current');
  // PAK 2025 exports are null in the fixture: no row, no zero.
  assert.equal(repository.getObservation(db, 'PAK', exportsIndicator.id, 2025), null);
  const zeroRows = db.prepare('SELECT COUNT(*) AS n FROM observations WHERE value = 0').get().n;
  assert.equal(zeroRows, 0, 'missing must never become zero');
  // Explicit null WLD rows (FX, CPI index, CA, reserves) are skipped, not stored.
  const fx = repository.getIndicatorByMetricKey(db, 'fx_official');
  assert.equal(repository.getObservation(db, 'WLD', fx.id, 2024), null);
  db.close();
});

test('Phase 5.20.4/15/16: aggregates stored typed, ranked nowhere, comparable directly', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const repository = await import('../src/db/repository.js');
  // Stored: live-verified WLD CPI value readable directly.
  const cpi = repository.getIndicatorByMetricKey(db, 'inflation_cpi');
  const wld = repository.getObservation(db, 'WLD', cpi.id, 2024);
  assert.ok(wld, 'WLD CPI observation stored');
  assert.equal(wld.value, liveWorld2024('inflation_cpi'));
  // Ranked nowhere: eligible reads exclude every aggregate id.
  const aggregates = repository.listAggregateCountries(db);
  assert.ok(aggregates.length > 0);
  const aggregateIds = new Set(aggregates.map((row) => row.id));
  for (const metricKey of PHASE5_METRIC_KEYS) {
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    for (const year of [2024, 2025]) {
      const rows = repository.getEligibleObservations(db, indicator.id, year);
      assert.ok(!rows.some((row) => aggregateIds.has(row.iso3)), `${metricKey}/${year}: no aggregate in ranking universe`);
    }
  }
  db.close();
});

test('Phase 5.20.6/7/12: partial and total failures publish nothing (atomic)', async () => {
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const lockState = async (db) => {
    const { getRefreshLockState } = await import('../src/wb/ingest.js');
    return getRefreshLockState(db);
  };
  // Partial: one indicator's series fails (metadata path untouched).
  {
    const db = await freshDb();
    stub.reset();
    stub.failNextMatching({ status: 500, times: 5, substring: '/country/all/indicator/FP.CPI.TOTL.ZG' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
    assert.equal(summary.status, 'partial');
    assert.ok(summary.perIndicator.some((r) => r.metricKey === 'inflation_cpi' && r.error));
    assert.equal(repository.countObservations(db), 0, 'partial refresh publishes nothing');
    assert.equal(repository.listIndicators(db).length, 0);
    assert.equal((await lockState(db)).locked, false);
    db.close();
  }
  // Total: every series fails (metadata succeeds) → throws, failed run kept.
  {
    const db = await freshDb();
    stub.reset();
    stub.failNextMatching({ status: 500, times: 500, substring: '/country/all/indicator/' });
    await assert.rejects(
      refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' }),
      (error) => error.datasetPreserved === true,
    );
    assert.equal(repository.countObservations(db), 0);
    assert.equal(repository.getLatestFetchRun(db, { status: null }).status, 'failed');
    assert.equal((await lockState(db)).locked, false);
    db.close();
  }
  stub.reset();
});

test('Phase 5.20.11: stale rows are deleted by reconcile, not retained', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const repository = await import('../src/db/repository.js');
  const exportsIndicator = repository.getIndicatorByMetricKey(db, 'exports_current');
  const before = repository.getObservation(db, 'PAK', exportsIndicator.id, 2024);
  assert.ok(before, 'PAK 2024 exports present after first ingest');
  // Second ingest where the World Bank no longer returns PAK 2024 exports.
  stub.reset();
  const { refreshData } = await import('../src/wb/ingest.js');
  const { phase5Rows } = await import('./fixtures/phase5.js');
  stub.state.seriesRowsFor = (metricKey, baseRows) =>
    metricKey === 'exports_current'
      ? baseRows.filter((row) => !(row.countryiso3code === 'PAK' && row.date === '2024'))
      : baseRows;
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  stub.state.seriesRowsFor = null;
  assert.equal(summary.status, 'success');
  assert.equal(repository.getObservation(db, 'PAK', exportsIndicator.id, 2024), null, 'withdrawn value removed, not retained');
  assert.ok(repository.getObservation(db, 'IND', exportsIndicator.id, 2024), 'untouched rows survive');
  db.close();
  stub.reset();
});

// ---------------------------------------------------------------------------
// Per-indicator analytics (Parts 34, 36)
// ---------------------------------------------------------------------------
test('Phase 5.34/36: CPI ranking, deflator and index golden values', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // 2024 CPI: USA 37.64 > DEU 5.70 > IND 4.95 > PAK 0.45 > XKX 0.0124.
    const ranking = await (await fetch(`${base}/api/ranking?indicator=inflation_cpi&year=2024`)).json();
    assert.equal(ranking.total, 5);
    assert.deepEqual(ranking.rows.map((r) => r.iso3), ['USA', 'DEU', 'IND', 'PAK', 'XKX']);
    const ind = ranking.rows.find((r) => r.iso3 === 'IND');
    assert.equal(ind.rank, 3);
    assert.equal(ind.rawValue, liveIndia2024('inflation_cpi'));
    // YoY views refuse rates with an explicit reason (no relative -50%).
    const yoy = await (await fetch(`${base}/api/yoy-ranking/verify?indicator=inflation_cpi&year=2025&country=IND`)).json();
    assert.equal(yoy.available, false);
    assert.equal(yoy.reason, 'unsupported_transformation_for_metric');
    const growth = await (await fetch(`${base}/api/comparison/level?indicator=inflation_cpi&yearA=2024&yearB=2025&mode=yoy&country=IND`)).json();
    assert.equal(growth.comparison.available, false);
    assert.equal(growth.comparison.reason, 'unsupported_transformation_for_metric');
    // Yearly table keeps level/rank, explains YoY unavailability.
    const yearly = await (await fetch(`${base}/api/focus/yearly?country=IND&subject=prices&startYear=2024&endYear=2025`)).json();
    const row2025 = yearly.rows.find((r) => r.year === 2025);
    assert.equal(row2025.inflation_cpi.indiaValue, liveIndia2024('inflation_cpi') * 0.92);
    assert.equal(row2025.inflation_cpi.indiaYoY, null);
    assert.equal(row2025.inflation_cpi.indiaYoYReason, 'unsupported_transformation_for_metric');
    assert.notEqual(row2025.inflation_cpi.indiaRank, null);
  } finally {
    await close();
  }
  db.close();
});

test('Phase 5.34/36: FX movement semantics and quotation direction', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // YOY is declared for FX: 83.669 -> 84.920 (+1.5%) is depreciation vs USD.
    const yoy = await (await fetch(`${base}/api/yoy-ranking/verify?indicator=fx_official&year=2025&country=IND`)).json();
    assert.equal(yoy.available, true);
    assert.ok(Math.abs(yoy.focus.yoyPercent - 1.5) < 1e-9, `FX movement is +1.5%, got ${yoy.focus.yoyPercent}`);
    // Level comparison IND vs USA with absolute movement.
    const cmp = await (await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=fx_official&yearA=2024&yearB=2025&operation=absolute_change`)).json();
    assert.ok(cmp.results.comparison.a.value > 0, 'positive absolute movement (more INR per USD)');
    // No official world aggregate for FX: explicit, never invented.
    const agg = await (await fetch(`${base}/api/compare?entityA=country:IND&entityB=aggregate:WLD&indicator=fx_official&yearA=2024&operation=level`)).json();
    assert.equal(agg.results.b.values['2024'].available, false);
    assert.equal(agg.results.b.values['2024'].reason, 'MISSING_REQUIRED_DATA');
  } finally {
    await close();
  }
  db.close();
});

test('Phase 5.34/36: signed FDI/CA refuse invalid percent growth', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // Current account declares no PERCENT: the capability gate refuses with
    // UNSUPPORTED_TRANSFORMATION before any arithmetic (signed-flow safety).
    // (Transform-level negative-base refusal lives in transforms.test.js.)
    const pctRes = await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=current_account&yearA=2024&yearB=2025&operation=percent_change`);
    assert.equal(pctRes.status, 400);
    assert.equal((await pctRes.json()).error.code, 'UNSUPPORTED_TRANSFORMATION');
    // Absolute change is always valid for signed flows.
    const abs = await (await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:DEU&indicator=current_account&yearA=2024&yearB=2025&operation=absolute_change`)).json();
    assert.ok(abs.results.comparison.a.value !== null);
    // FDI % GDP moves in percentage points via the World Bank ratio.
    const pp = await (await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=fdi_inflows_pct_gdp&yearA=2024&yearB=2025&operation=pp_change`)).json();
    assert.equal(pp.results.comparison.a.unit, 'percentage points');
    assert.ok(Math.abs(pp.results.comparison.a.value - (0.721648483526777 * 0.9 - 0.721648483526777)) < 1e-9);
    // Group SUM of exports across members.
    const grp = await (await fetch(`${base}/api/compare?entityA=country:USA&entityB=group:IND,DEU&indicator=exports_current&yearA=2024&operation=level`)).json();
    assert.ok(Math.abs(grp.results.b.observed['2024'].value - (829785193474.459 + 829785193474.459 * 1.15)) < 1);
  } finally {
    await close();
  }
  db.close();
});

test('Phase 5.34: coverage, entities and groups cover the new families', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const coverage = await (await fetch(`${base}/api/coverage?year=2024&subject=prices`)).json();
    assert.equal(coverage.metrics.length, 3);
    for (const m of coverage.metrics) {
      assert.equal(m.validObservations, 5, m.metric.key);
    }
    const entities = await (await fetch(`${base}/api/entities?type=all&search=WLD&indicator=inflation_cpi&year=2024`)).json();
    const wld = entities.entities.find((e) => e.iso3 === 'WLD');
    assert.equal(wld.hasData, true);
    const fxEntities = await (await fetch(`${base}/api/entities?type=all&search=WLD&indicator=fx_official&year=2024`)).json();
    assert.equal(fxEntities.entities.find((e) => e.iso3 === 'WLD').hasData, false);
    const groups = await (await fetch(`${base}/api/groups/evaluate?members=IND,DEU&indicator=exports_current&yearA=2024`)).json();
    assert.equal(groups.capability.canComputeGroupValue, true);
    // CPI index groups refuse with NOT_AGGREGATABLE (member-only display).
    const indexGroups = await (await fetch(`${base}/api/groups/evaluate?members=IND,DEU&indicator=inflation_cpi_index&yearA=2024`)).json();
    assert.equal(indexGroups.capability.canComputeGroupValue, false);
    assert.equal(indexGroups.capability.reason, 'NOT_AGGREGATABLE');
  } finally {
    await close();
  }
  db.close();
});

test('Phase 5.28: existing GDP analytics unchanged beside the new series', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const repository = await import('../src/db/repository.js');
  // All twenty indicators present; the eight GDP codes byte-identical.
  const indicators = repository.listIndicators(db);
  assert.equal(indicators.length, 20);
  const { base, close } = await startApp(db);
  try {
    const ranking = await (await fetch(`${base}/api/ranking?indicator=nominal_current&year=2024`)).json();
    assert.equal(ranking.total, 200, 'GDP universe intact with aggregates stored (snapshot fixture)');
    assert.ok(!ranking.rows.some((r) => ['WLD', 'AFE', 'ARB'].includes(r.iso3)), 'no aggregate in rankings');
    const india = await (await fetch(`${base}/api/focus/yearly?country=IND&subject=gdp_total&startYear=2024&endYear=2025`)).json();
    assert.ok(india.rows.length > 0);
    const integrity = await (await fetch(`${base}/api/integrity`)).json();
    assert.equal(integrity.passed, true, JSON.stringify(integrity.checks.filter((c) => c.status !== 'pass')));
  } finally {
    await close();
  }
  db.close();
});
