/**
 * PHASE-7B METHODOLOGY FIX TESTS (P0 defects from the Phase-7A audit).
 *
 * F-P0-1 display precision: registry displayDecimals drives every formatter.
 * F-P0-2 CPI rank: ASC (lower values first) with ISO3 tie-break.
 * F-P0-3 coverage YoY: gated on declared YOY, never a fullRanking inference.
 * F-P0-4 flow period: growth over FLOW metrics is an "Annual flow: B vs A"
 *         endpoint comparison, never a period sum.
 * F-P0-5 comparison growth gate: PERCENT refused where undeclared.
 * F-P0-6 FX: quoted nominal LCU per US$; raw levels never ranked.
 *
 * GDP anchors: the eight GDP metrics keep DESC ordering, integer display for
 * per-capita levels, and identical analytical behavior throughout.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// NOTE: no static src/* imports in this file. src/config.js freezes
// WORLD_BANK_API_BASE_URL at import time, so every src module is imported
// dynamically inside the tests — after test.before() points the client at
// the stub. (Static src imports here silently ingested the LIVE API.)
import { liveIndia2024 } from './fixtures/phase5.js';
import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
  process.env.WB_RETRY_BASE_MS = '5';
  process.env.WB_MAX_RETRIES = '2';
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return await createMemoryDb();
}

async function ingestFull(db, years = { startYear: 2024, endYear: 2025 }) {
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  return await refreshData({ db, startYear: years.startYear, endYear: years.endYear, trigger: 'test' });
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
// 7B.1: displayDecimals registry contract
// ---------------------------------------------------------------------------
test('Phase 7B.1: every production metric pins displayDecimals; validator enforces it', async () => {
  const { METRICS, PRODUCTION_METRIC_KEYS } = await import('../src/config.js');
  const { assertSemanticFields } = await import('../src/config.js');
  const { describeMeasure, describeMetric } = await import('../src/domain/format.js');
  const expected = {
    nominal_current: 0,
    nominal_constant: 0,
    ppp_current: 0,
    ppp_constant: 0,
    total_current: 2,
    total_constant: 2,
    total_ppp_current: 2,
    total_ppp_constant: 2,
    inflation_cpi: 2,
    inflation_cpi_index: 1,
    inflation_deflator: 2,
    exports_current: 2,
    imports_current: 2,
    fdi_inflows: 2,
    fdi_inflows_pct_gdp: 2,
    fx_official: 2,
    current_account: 2,
    reserves_ex_gold: 2,
    remittances_received: 2,
    population_total: 2,
  };
  assert.deepEqual([...PRODUCTION_METRIC_KEYS].sort(), Object.keys(expected).sort());
  for (const [key, decimals] of Object.entries(expected)) {
    assert.equal(METRICS[key].displayDecimals, decimals, key);
    assertSemanticFields(key, METRICS[key]);
  }
  // The validator fails closed on a missing, negative or fractional precision.
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, displayDecimals: undefined }), /displayDecimals/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, displayDecimals: -1 }), /displayDecimals/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, displayDecimals: 1.5 }), /displayDecimals/);
  // describeMeasure carries the contract; the frozen legacy descriptor does not grow.
  assert.equal(describeMeasure(METRICS.inflation_cpi).displayDecimals, 2);
  assert.equal(describeMeasure(METRICS.inflation_cpi_index).displayDecimals, 1);
  assert.equal('displayDecimals' in describeMetric(METRICS.inflation_cpi), false);
});

// ---------------------------------------------------------------------------
// 7B.2: formatValue honors registry precision; raw values untouched
// ---------------------------------------------------------------------------
test('Phase 7B.2: RATE/RATIO/FX show 2dp, INDEX 1dp, GDP anchors unchanged', async () => {
  const { METRICS } = await import('../src/config.js');
  const { formatValue } = await import('../src/domain/format.js');
  const cpi = formatValue(4.95303550973661, METRICS.inflation_cpi);
  assert.equal(cpi.formatted, '4.95');
  assert.equal(cpi.decimals, 2);
  assert.equal(cpi.raw, 4.95303550973661);
  const index = formatValue(227.603278134168, METRICS.inflation_cpi_index);
  assert.equal(index.formatted, '227.6');
  assert.equal(index.decimals, 1);
  const fx = formatValue(83.669281580941, METRICS.fx_official);
  assert.equal(fx.formatted, '83.67');
  assert.equal(fx.decimals, 2);
  const ratio = formatValue(0.721648483526777, METRICS.fdi_inflows_pct_gdp);
  assert.equal(ratio.formatted, '0.72');
  // GDP anchors: per-capita integer display, scaled totals 2dp — byte-identical.
  assert.equal(formatValue(2702.49, METRICS.nominal_current).formatted, '$2,702');
  assert.equal(formatValue(2702.49, METRICS.nominal_current).decimals, 0);
  assert.equal(formatValue(2481.6, METRICS.ppp_constant).formatted, '$2,482');
  assert.equal(formatValue(3.956e12, METRICS.total_current).formatted, '$3.96 trillion');
  assert.equal(formatValue(null, METRICS.inflation_cpi).formatted, null);
});

// ---------------------------------------------------------------------------
// 7B.3: directional ranking engine (pure domain)
// ---------------------------------------------------------------------------
test('Phase 7B.3: ASC orders lower-first with ISO3 tie-break; default stays DESC', async () => {
  const { METRICS } = await import('../src/config.js');
  const {
    RANK_DIRECTIONS,
    comparatorFor,
    compareByValueAsc,
    directionFor,
    rankAndLocate,
    rankByValue,
  } = await import('../src/domain/ranking.js');
  const rows = [
    { iso3: 'USA', value: 37.64 },
    { iso3: 'DEU', value: 5.7 },
    { iso3: 'IND', value: 4.95 },
    { iso3: 'PAK', value: 0.45 },
    { iso3: 'XKX', value: 0.0124 },
  ];
  const asc = rankByValue(rows, 'ASC');
  assert.deepEqual(asc.ranked.map((r) => r.iso3), ['XKX', 'PAK', 'IND', 'DEU', 'USA']);
  assert.equal(asc.ranked.find((r) => r.iso3 === 'IND').rank, 3);
  const desc = rankByValue(rows);
  assert.deepEqual(desc.ranked.map((r) => r.iso3), ['USA', 'DEU', 'IND', 'PAK', 'XKX']);
  // Unknown direction strings fail safe to DESC (frozen default).
  assert.deepEqual(rankByValue(rows, 'SIDEWAYS').ranked.map((r) => r.iso3), desc.ranked.map((r) => r.iso3));
  // Ties: numeric equality only (raw values, never strings), ISO3 decides.
  const tied = rankByValue(
    [
      { iso3: 'BBB', value: 5 },
      { iso3: 'AAA', value: 5 },
    ],
    'ASC',
  );
  assert.deepEqual(tied.ranked.map((r) => r.iso3), ['AAA', 'BBB']);
  assert.ok(compareByValueAsc({ iso3: 'AAA', value: 5 }, { iso3: 'BBB', value: 5 }) < 0);
  assert.ok(comparatorFor('ASC')({ iso3: 'X', value: 1 }, { iso3: 'Y', value: 2 }) < 0);
  assert.ok(comparatorFor('DESC')({ iso3: 'X', value: 1 }, { iso3: 'Y', value: 2 }) > 0);
  const located = rankAndLocate(rows, 'ind', 'ASC');
  assert.equal(located.target.rank, 3);
  assert.equal(located.total, 5);
  // Registry direction: GDP DESC, inflation-family ASC, FX refusal.
  assert.equal(directionFor(METRICS.nominal_current), RANK_DIRECTIONS.DESC);
  assert.equal(directionFor(METRICS.total_current), RANK_DIRECTIONS.DESC);
  assert.equal(directionFor(METRICS.inflation_cpi), RANK_DIRECTIONS.ASC);
  assert.equal(directionFor(METRICS.inflation_deflator), RANK_DIRECTIONS.ASC);
  // Index levels are not ranked across countries (an index number has no
  // cross-country meaning), so the CPI index refuses like FX does.
  assert.equal(directionFor(METRICS.inflation_cpi_index), null);
  assert.equal(directionFor(METRICS.fx_official), null);
});

// ---------------------------------------------------------------------------
// 7B.4: ASC full ranking + FX RANK_UNSUPPORTED over HTTP
// ---------------------------------------------------------------------------
test('Phase 7B.4: CPI ranks lower-first; FX levels refuse ranking as quoted nominal', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const ranking = await (await fetch(`${base}/api/ranking?indicator=inflation_cpi&year=2024`)).json();
    assert.equal(ranking.available, true);
    assert.deepEqual(ranking.rows.map((r) => r.iso3), ['XKX', 'PAK', 'IND', 'DEU', 'USA']);
    assert.equal(ranking.rows.find((r) => r.iso3 === 'IND').rank, 3);
    assert.match(ranking.notes.join(' '), /ascending/);
    // Rank verification inherits the ASC engine: India 3 of 5.
    const verify = await (await fetch(`${base}/api/ranking/verify?indicator=inflation_cpi&year=2024&country=IND`)).json();
    assert.equal(verify.available, true);
    assert.equal(verify.focus.rank, 3);
    assert.equal(verify.total, 5);
    // FX: no cross-currency rank; the refusal names the nominal quotation.
    const fx = await (await fetch(`${base}/api/ranking?indicator=fx_official&year=2024`)).json();
    assert.equal(fx.available, false);
    assert.equal(fx.reason, 'RANK_UNSUPPORTED');
    assert.match(fx.detail, /nominal rate \(local currency units per US\$/);
    const fxVerify = await (await fetch(`${base}/api/ranking/verify?indicator=fx_official&year=2024&country=IND`)).json();
    assert.equal(fxVerify.available, false);
    assert.equal(fxVerify.reason, 'RANK_UNSUPPORTED');
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7B.5: coverage YoY gates on declared YOY
// ---------------------------------------------------------------------------
test('Phase 7B.5: rates/indexes report unsupported YoY coverage; GDP keeps pairs', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const prices = await (await fetch(`${base}/api/coverage?subject=prices&year=2025`)).json();
    for (const key of ['inflation_cpi', 'inflation_cpi_index', 'inflation_deflator']) {
      const entry = prices.yoy.metrics.find((m) => m.metric.key === key);
      assert.ok(entry, `${key} present in YoY panel`);
      assert.equal(entry.available, false, key);
      assert.equal(entry.reason, 'unsupported_transformation_for_metric', key);
    }
    const gdp = await (await fetch(`${base}/api/coverage?subject=gdp_per_capita&year=2005`)).json();
    void gdp;
    const live = await (await fetch(`${base}/api/coverage?subject=gdp_per_capita&year=2025`)).json();
    const nominal = live.yoy.metrics.find((m) => m.metric.key === 'nominal_current');
    assert.ok(nominal, 'nominal_current present in YoY panel');
    assert.equal(nominal.available, true);
    assert.equal(nominal.reason, null);
    assert.equal(nominal.focus.yoyCalculable, true);
    assert.ok(Number.isFinite(nominal.focus.yoyPercent), 'GDP keeps a real YoY number');
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7B.6: GDP DESC regression anchors
// ---------------------------------------------------------------------------
test('Phase 7B.6: GDP rankings stay value-DESC with integer per-capita display', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const ranking = await (await fetch(`${base}/api/ranking?indicator=nominal_current&year=2024&pageSize=500`)).json();
    assert.equal(ranking.available, true);
    const values = ranking.rows.map((r) => r.rawValue);
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i - 1] >= values[i], 'GDP rows descend by raw value');
    }
    assert.match(ranking.notes.join(' '), /descending/);
    const ind = ranking.rows.find((r) => r.iso3 === 'IND');
    assert.ok(ind, 'India ranked for nominal GDP per capita');
    assert.ok(ind.rank >= 1 && ind.rank <= ranking.total);
    assert.match(ind.displayValue, /^\$[\d,]+$/);
    const level = await (
      await fetch(`${base}/api/comparison/level?indicator=nominal_current&yearA=2024&yearB=2025&country=IND`)
    ).json();
    assert.match(level.comparisonMethodology.ranking, /value DESC/);
    assert.match(level.comparisonMethodology.ranking, /rank\(India,A\) = 1 \+/);
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7B.7: FLOW growth is an endpoint comparison, never a period sum
// ---------------------------------------------------------------------------
test('Phase 7B.7: exports growth carries Annual-flow endpoint semantics; GDP has none', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { buildGrowthComparisonResponse } = await import('../src/services/growthComparisonService.js');
  const flow = await buildGrowthComparisonResponse(db, { metricKey: 'exports_current', yearA: 2024, yearB: 2025 });
  assert.equal(flow.comparison.available, true);
  assert.equal(flow.flowSemantics.intervalMeaning, 'Annual flow: B vs A — endpoint comparison of annual flows, never a period sum.');
  assert.equal(flow.focusMovement.growth.AB.endpointMeaning, 'Annual flow: 2025 vs 2024 — endpoint comparison, not a period sum.');
  assert.match(flow.comparisonMethodology.growth, /Annual flow: B vs A/);
  assert.match(flow.comparisonMethodology.growth, /never a sum/i);
  // Endpoint math on raw values: IND 2024 x 1.06 drift = +6%.
  const ab = flow.focusMovement.growth.AB;
  assert.equal(ab.startValue, liveIndia2024('exports_current'));
  assert.ok(Math.abs(ab.indiaGrowthPercent - 6) < 1e-9);
  const level = await buildGrowthComparisonResponse(db, { metricKey: 'nominal_current', yearA: 2024, yearB: 2025 });
  assert.equal('flowSemantics' in level, false);
  assert.equal('endpointMeaning' in (level.focusMovement.growth.AB ?? {}), false);
  db.close();
});

// ---------------------------------------------------------------------------
// 7B.8: PERCENT change refused where the registry does not declare it
// ---------------------------------------------------------------------------
test('Phase 7B.8: percent_change on CPI and FDI ratio fails closed with the registry reason', async () => {
  // Domain level: the gated dispatcher refuses with the registry reason.
  const { computeTransform, TRANSFORMS } = await import('../src/domain/transforms.js');
  const { METRICS } = await import('../src/config.js');
  for (const key of ['inflation_cpi', 'fdi_inflows_pct_gdp']) {
    const refused = computeTransform(METRICS[key], TRANSFORMS.PERCENT_CHANGE, { a: 6, b: 3 });
    assert.equal(refused.computable, false, key);
    assert.equal(refused.reason, 'unsupported_transformation_for_metric', key);
  }
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // HTTP: the capability matrix rejects the undeclared operation (400),
    // matching the existing cross_rate-on-GDP contract.
    for (const indicator of ['inflation_cpi', 'fdi_inflows_pct_gdp']) {
      const res = await fetch(
        `${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=${indicator}&yearA=2024&yearB=2025&operation=percent_change`,
      );
      assert.equal(res.status, 400, indicator);
      assert.equal((await res.json()).error.code, 'UNSUPPORTED_TRANSFORMATION', indicator);
    }
    // Declared PERCENT still computes (exports endpoints differ by drift).
    const ok = await (
      await fetch(
        `${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=exports_current&yearA=2024&yearB=2025&operation=percent_change`,
      )
    ).json();
    assert.equal(ok.results.comparison.a.computable, true);
    assert.ok(Math.abs(ok.results.comparison.a.value - 6) < 1e-9);
  } finally {
    await close();
  }
  db.close();
});
