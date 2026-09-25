/**
 * PHASE 7C-1 TESTS — core methodology: period aggregation, strict
 * completeness, signed-flow safety, semantic operation identity.
 *
 * P-items from the phase brief: PERIOD_SUM (1-12), PERIOD_AVG (13-16),
 * PERIOD_SUM_PERCENT_CHANGE (17-20), SIGNED YOY (21-28), ROUTE CONSISTENCY
 * (29-33), plus GDP differential regression (Q) and GDP period refusal (R).
 *
 * Import discipline: no static src/* imports (src/config.js freezes
 * WORLD_BANK_API_BASE_URL at import time); every src module is imported
 * dynamically inside tests, after the stub is installed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE_EXPECTATIONS } from './fixtures/edgeCases.js';
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

const decade = () => Array.from({ length: 10 }, (_, i) => ({ year: 2004 + i, value: (i + 1) * 10 }));

// ---------------------------------------------------------------------------
// [A,B) interval rule (P: 4-9)
// ---------------------------------------------------------------------------
test('Phase 7C-1.1: half-open [A,B) boundaries, adjacency, no double-count', async () => {
  const { periodYears } = await import('../src/domain/transforms.js');
  assert.deepEqual(periodYears(2004, 2014).years, [2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013]);
  assert.equal(periodYears(2004, 2014).size, 10);
  assert.deepEqual(periodYears(2014, 2024).years[0], 2014);
  assert.deepEqual(periodYears(2014, 2024).years.at(-1), 2023);
  assert.equal(periodYears(2014, 2024).size, 10);
  // Adjacent periods are disjoint and jointly cover the span.
  const a = new Set(periodYears(2004, 2014).years);
  const b = new Set(periodYears(2014, 2024).years);
  assert.equal([...a].filter((y) => b.has(y)).length, 0, 'no boundary double-count');
  assert.equal(new Set([...a, ...b]).size, 20, 'joint coverage 2004...2023');
  // 2004 -> 2015 holds 11 annual observations.
  assert.equal(periodYears(2004, 2015).size, 11);
  assert.deepEqual(periodYears(2004, 2015).years.at(-1), 2014);
  // Empty or inverted intervals fail closed with INVALID_PERIOD.
  for (const [s, e] of [[2014, 2014], [2015, 2014], [2004.5, 2014], [null, 2014]]) {
    assert.throws(() => periodYears(s, e), (err) => err?.code === 'invalid_period_interval', `${s},${e}`);
  }
});

// ---------------------------------------------------------------------------
// PERIOD_SUM (P: 1-3, 10-12)
// ---------------------------------------------------------------------------
test('Phase 7C-1.2: PERIOD_SUM exact sum/years/size; missing year refuses, never zero-fills', async () => {
  const { METRICS } = await import('../src/config.js');
  const { computeTransform, TRANSFORMS } = await import('../src/domain/transforms.js');
  const FDI = METRICS.fdi_inflows;
  const full = computeTransform(FDI, TRANSFORMS.PERIOD_SUM, { values: decade(), startYear: 2004, endYear: 2014 });
  assert.equal(full.computable, true);
  assert.equal(full.value, 550, '10+20+...+100');
  assert.deepEqual(full.years, periodYearsOf(2004, 2014));
  assert.equal(full.size, 10);
  // One missing year: unavailable, reason + missing-year list, value null
  // (not the 540 partial sum, not zero).
  const gappy = computeTransform(FDI, TRANSFORMS.PERIOD_SUM, {
    values: decade().filter((r) => r.year !== 2007),
    startYear: 2004,
    endYear: 2014,
  });
  assert.equal(gappy.computable, false);
  assert.equal(gappy.reason, 'incomplete_period');
  assert.deepEqual(gappy.missingYears, [2007]);
  assert.equal(gappy.value, null);
  assert.ok((gappy.description ?? '').length > 0, 'reason explained, not a bare code');
  // Capability gate: GDP LEVEL refuses PERIOD_SUM before any arithmetic.
  const GDP = METRICS.nominal_current;
  const refused = computeTransform(GDP, TRANSFORMS.PERIOD_SUM, { values: decade(), startYear: 2004, endYear: 2014 });
  assert.equal(refused.computable, false);
  assert.equal(refused.reason, 'unsupported_transformation_for_metric');
  // Unknown metric refuses without touching math.
  const unknown = computeTransform(null, TRANSFORMS.PERIOD_SUM, { values: decade(), startYear: 2004, endYear: 2014 });
  assert.equal(unknown.reason, 'unknown_metric');

  function periodYearsOf(s, e) {
    const years = [];
    for (let y = s; y < e; y += 1) years.push(y);
    return years;
  }
});

// ---------------------------------------------------------------------------
// PERIOD_AVG (P: 13-16)
// ---------------------------------------------------------------------------
test('Phase 7C-1.3: PERIOD_AVG is sum/N with the same strict completeness', async () => {
  const { METRICS } = await import('../src/config.js');
  const { computeTransform, TRANSFORMS } = await import('../src/domain/transforms.js');
  const FDI = METRICS.fdi_inflows;
  const avg = computeTransform(FDI, TRANSFORMS.PERIOD_AVG, { values: decade(), startYear: 2004, endYear: 2014 });
  assert.equal(avg.computable, true);
  assert.equal(avg.value, 55, '550 / 10');
  assert.equal(avg.size, 10, 'N exposed');
  assert.equal(avg.sum, 550, 'sum travels with the average, never silently substituted');
  // Missing year: unavailable (an average over a gappy period would
  // silently redefine the period).
  const gappy = computeTransform(FDI, TRANSFORMS.PERIOD_AVG, {
    values: decade().filter((r) => r.year !== 2013),
    startYear: 2004,
    endYear: 2014,
  });
  assert.equal(gappy.computable, false);
  assert.equal(gappy.reason, 'incomplete_period');
  assert.deepEqual(gappy.missingYears, [2013]);
  assert.equal(gappy.average, null);
  // Signed values sum normally (a net position over a period is meaningful).
  const signed = computeTransform(FDI, TRANSFORMS.PERIOD_AVG, {
    values: [{ year: 2004, value: 10 }, { year: 2005, value: -4 }],
    startYear: 2004,
    endYear: 2006,
  });
  assert.equal(signed.computable, true);
  assert.equal(signed.value, 3, '(10 + -4) / 2');
  // GDP refuses AVG as well as SUM.
  assert.equal(
    computeTransform(METRICS.total_current, TRANSFORMS.PERIOD_AVG, { values: decade(), startYear: 2004, endYear: 2014 }).reason,
    'unsupported_transformation_for_metric',
  );
});

// ---------------------------------------------------------------------------
// PERIOD_SUM_PERCENT_CHANGE (P: 17-20)
// ---------------------------------------------------------------------------
test('Phase 7C-1.4: period-total percent change with base/sign guards', async () => {
  const { METRICS } = await import('../src/config.js');
  const { computeTransform, TRANSFORMS } = await import('../src/domain/transforms.js');
  const FDI = METRICS.fdi_inflows;
  const ok = computeTransform(FDI, TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, { sumA: 100, sumB: 150 });
  assert.equal(ok.computable, true);
  assert.equal(ok.value, 50);
  assert.equal(ok.unit, '%');
  for (const [sums, reason] of [
    [{ sumA: 0, sumB: 50 }, 'zero_base_for_percent_change'],
    [{ sumA: 0, sumB: 0 }, 'zero_base_for_percent_change'],
    [{ sumA: -100, sumB: 50 }, 'negative_base_for_percent_change'],
    [{ sumA: -100, sumB: -50 }, 'negative_base_for_percent_change'],
    [{ sumA: 100, sumB: -20 }, 'sign_change_across_endpoints'],
  ]) {
    const refused = computeTransform(FDI, TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, sums);
    assert.equal(refused.computable, false, JSON.stringify(sums));
    assert.equal(refused.reason, reason, JSON.stringify(sums));
    assert.equal(refused.value, null);
  }
  // Gated by SUM capability: GDP cannot percent-change period totals.
  assert.equal(
    computeTransform(METRICS.nominal_current, TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, { sumA: 100, sumB: 150 }).reason,
    'unsupported_transformation_for_metric',
  );
});

// ---------------------------------------------------------------------------
// SIGNED YOY matrix (P: 21-27)
// ---------------------------------------------------------------------------
test('Phase 7C-1.5: signed-flow YoY validity matrix (one rule, legacy engine)', async () => {
  const { computeYoy } = await import('../src/domain/yoy.js');
  // +10 -> +20 valid.
  assert.equal(computeYoy({ current: 20, previous: 10 }).yoyPercent, 100);
  // +10 -> 0 valid (-100%); zero current is a value, not a sign change.
  const toZero = computeYoy({ current: 0, previous: 10 });
  assert.equal(toZero.yoyPercent, -100);
  assert.equal(toZero.reason, null, '10 -> 0 must not trigger sign-change');
  // +10 -> -5 unavailable with the shared sign-change code.
  const flip = computeYoy({ current: -5, previous: 10 });
  assert.equal(flip.yoyPercent, null);
  assert.equal(flip.reason, 'sign_change_across_endpoints');
  assert.equal(flip.computable, false);
  // 0 -> 10 unavailable (zero base, legacy code preserved).
  assert.equal(computeYoy({ current: 10, previous: 0 }).reason, 'previous_year_value_not_positive');
  // -10 -> +10 unavailable (negative base checked first, as in generic).
  assert.equal(computeYoy({ current: 10, previous: -10 }).reason, 'previous_year_value_not_positive');
  // -10 -> -5 unavailable (negative base, never automatic "growth").
  assert.equal(computeYoy({ current: -5, previous: -10 }).reason, 'previous_year_value_not_positive');
});

// ---------------------------------------------------------------------------
// LEGACY AGREEMENT (P: 28)
// ---------------------------------------------------------------------------
test('Phase 7C-1.6: every legacy consumer agrees on sign-invalid pairs', async () => {
  const { computeYoy } = await import('../src/domain/yoy.js');
  const { buildYoyRows } = await import('../src/domain/yoyRanking.js');
  const { METRICS } = await import('../src/config.js');
  const { computeTransform, TRANSFORMS, percentChange, periodSumPercentChange } = await import('../src/domain/transforms.js');
  const FDI = METRICS.fdi_inflows;
  // The flip pair +10 -> -5: refused by all four layers with sign language.
  assert.equal(computeYoy({ current: -5, previous: 10 }).reason, 'sign_change_across_endpoints');
  const pairs = buildYoyRows([{ iso3: 'FLP', value: -5 }], [{ iso3: 'FLP', value: 10 }]);
  assert.equal(pairs.pairs, 0, 'flip pair excluded from the ranked universe');
  assert.equal(percentChange({ a: 10, b: -5 }, FDI).reason, 'sign_change_across_endpoints');
  assert.equal(periodSumPercentChange({ sumA: 10, sumB: -5 }, FDI).reason, 'sign_change_across_endpoints');
  // And a valid pair still flows through all layers identically.
  assert.equal(computeYoy({ current: 20, previous: 10 }).yoyPercent, 100);
  assert.equal(buildYoyRows([{ iso3: 'OK', value: 20 }], [{ iso3: 'OK', value: 10 }]).rows[0].yoyPercent, 100);
  assert.equal(percentChange({ a: 10, b: 20 }, FDI).value, 100);
  // Capability matrix still refuses PERCENT where undeclared (unchanged).
  assert.equal(
    computeTransform(FDI, TRANSFORMS.PERCENT_CHANGE, { a: 10, b: 20 }).reason,
    'unsupported_transformation_for_metric',
  );
});

// ---------------------------------------------------------------------------
// SEMANTIC OPERATION IDENTITY + REGISTRY (G, H)
// ---------------------------------------------------------------------------
test('Phase 7C-1.7: semantic operation vocabulary and periodAggregation contract', async () => {
  const { SEMANTIC_OPERATIONS, SEMANTIC_OPERATION_INFO } = await import('../src/domain/periods.js');
  for (const code of ['ANNUAL_YOY', 'ANNUAL_ENDPOINT_PERCENT_CHANGE', 'PERIOD_SUM', 'PERIOD_SUM_PERCENT_CHANGE', 'PERIOD_AVERAGE']) {
    assert.ok(SEMANTIC_OPERATIONS[code], code);
    assert.ok(SEMANTIC_OPERATION_INFO[code]?.label, `${code} label`);
    assert.ok(SEMANTIC_OPERATION_INFO[code]?.formula, `${code} formula`);
  }
  const { METRICS, PRODUCTION_METRIC_KEYS, assertSemanticFields } = await import('../src/config.js');
  const { describeMeasure } = await import('../src/domain/format.js');
  const flows = ['exports_current', 'imports_current', 'fdi_inflows', 'current_account', 'remittances_received'];
  assert.deepEqual(
    PRODUCTION_METRIC_KEYS.filter((k) => METRICS[k].periodAggregation.length > 0).sort(),
    flows.sort(),
    'only the five FLOW metrics declare period aggregation',
  );
  for (const key of flows) assert.deepEqual([...METRICS[key].periodAggregation], ['SUM', 'AVG'], key);
  for (const key of PRODUCTION_METRIC_KEYS) {
    if (!flows.includes(key)) assert.deepEqual([...METRICS[key].periodAggregation], [], `${key} declares NONE`);
    assertSemanticFields(key, METRICS[key]);
  }
  // Validator fails closed on unknown period ops.
  assert.throws(
    () => assertSemanticFields('x', { ...METRICS.fdi_inflows, periodAggregation: ['SUM', 'MEDIAN'] }),
    /periodAggregation/,
  );
  assert.throws(() => assertSemanticFields('x', { ...METRICS.fdi_inflows, periodAggregation: 'SUM' }), /periodAggregation/);
  // describeMeasure echoes the contract; frozen describeMetric untouched (7B).
  assert.deepEqual(describeMeasure(METRICS.fdi_inflows).periodAggregation, ['SUM', 'AVG']);
});

// ---------------------------------------------------------------------------
// ROUTE CONSISTENCY on a forced sign flip (P: 29-33)
// ---------------------------------------------------------------------------
test('Phase 7C-1.8: no route serves a sign-flip percent (yoy, ranking, growth, coverage, yearly)', async () => {
  const db = await freshDb();
  // Force IND fdi_inflows 2025 negative: +27.14B (2024) -> -5B (2025).
  stub.reset();
  stub.state.seriesRowsFor = (metricKey, baseRows) =>
    metricKey === 'fdi_inflows'
      ? baseRows.map((row) =>
        row.countryiso3code === 'IND' && row.date === '2025' ? { ...row, value: -5000000000 } : row,
      )
      : baseRows;
  const { refreshData } = await import('../src/wb/ingest.js');
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  stub.state.seriesRowsFor = null;
  const { base, close } = await startApp(db);
  try {
    // YoY verification: focus unavailable, flip absent from every ranked row.
    const yoy = await (await fetch(`${base}/api/yoy-ranking/verify?indicator=fdi_inflows&year=2025&country=IND`)).json();
    assert.equal(yoy.available, false);
    assert.equal(yoy.focus, null);
    assert.ok(!JSON.stringify(yoy).includes('-118.'), 'no -118.4% flip percent anywhere in YoY verification');
    // Full YoY ranking: IND excluded from the pairs universe.
    const ranking = await (await fetch(`${base}/api/yoy-ranking?indicator=fdi_inflows&year=2025`)).json();
    assert.ok(!(ranking.rows ?? []).some((r) => r.iso3 === 'IND'), 'IND excluded from YoY ranking');
    for (const row of ranking.rows ?? []) {
      assert.ok(row.yoyPercent > -100, `no sign-flip percent ranked (${row.iso3}: ${row.yoyPercent})`);
    }
    // Movement growth: AB unavailable for the focus; pair-level reason exact.
    const growth = await (
      await fetch(`${base}/api/comparison/level?indicator=fdi_inflows&yearA=2024&yearB=2025&mode=yoy&country=IND`)
    ).json();
    assert.equal(growth.comparison.available, false);
    assert.ok(!JSON.stringify(growth.focusMovement.growth.AB).includes('-118.'), 'no flip percent in growth AB');
    // Coverage focus: not calculable, exact reason, null percent.
    const coverage = await (await fetch(`${base}/api/coverage?subject=capital_flows&year=2025`)).json();
    const fdi = coverage.yoy.metrics.find((m) => m.metric.key === 'fdi_inflows');
    assert.equal(fdi.focus.yoyCalculable, false);
    assert.equal(fdi.focus.yoyPercent, null);
    assert.equal(fdi.focus.yoyReason, 'sign_change_across_endpoints');
    // Yearly cell: null YoY with the exact reason (raw values preserved).
    const yearly = await (
      await fetch(`${base}/api/focus/yearly?country=IND&subject=capital_flows&startYear=2024&endYear=2025`)
    ).json();
    const row2025 = yearly.rows.find((r) => r.year === 2025);
    assert.equal(row2025.fdi_inflows.indiaValue, -5000000000, 'raw negative stored value preserved, not hidden');
    assert.equal(row2025.fdi_inflows.indiaYoY, null);
    assert.equal(row2025.fdi_inflows.indiaYoYReason, 'sign_change_across_endpoints');
    // Compare percent_change: refused at capability (consistent refusal).
    const pct = await fetch(
      `${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=fdi_inflows&yearA=2024&yearB=2025&operation=percent_change`,
    );
    assert.equal(pct.status, 400);
    assert.equal((await pct.json()).error.code, 'UNSUPPORTED_TRANSFORMATION');
  } finally {
    await close();
  }
  db.close();
  stub.reset();
});

// ---------------------------------------------------------------------------
// PERIOD SERVICE contract
// ---------------------------------------------------------------------------
test('Phase 7C-1.9: period summary builder (identity, completeness, capability)', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { buildPeriodSummary } = await import('../src/services/periodService.js');
  // Exports 2024 -> 2026 = [2024, 2025], both present for IND.
  const sum = buildPeriodSummary(db, { metricKey: 'exports_current', startYear: 2024, endYear: 2026, operation: 'SUM' });
  assert.equal(sum.available, true);
  assert.equal(sum.operation, 'PERIOD_SUM');
  assert.equal(sum.semantic.code, 'PERIOD_SUM');
  assert.deepEqual(sum.period.years, [2024, 2025]);
  assert.equal(sum.period.size, 2);
  const expected = liveIndia2024('exports_current') * (1 + 1.06);
  assert.ok(Math.abs(sum.sum - expected) < 1, `decade-free two-year sum, got ${sum.sum}`);
  assert.deepEqual(sum.missingYears, []);
  assert.equal(sum.provenance.kind, 'APP_DERIVED');
  assert.equal(sum.provenance.transform, 'PERIOD_SUM');
  assert.ok((sum.sumDisplay ?? '').length > 0, 'display string travels alongside the raw sum');
  const avg = buildPeriodSummary(db, { metricKey: 'exports_current', startYear: 2024, endYear: 2026, operation: 'AVG' });
  assert.equal(avg.available, true);
  assert.equal(avg.operation, 'PERIOD_AVG');
  assert.ok(Math.abs(avg.average - expected / 2) < 1, 'typical annual scale');
  assert.equal(avg.sum, sum.sum, 'average carries its sum, never substitutes for it');
  // Missing year 2023: unavailable with reason + missing-year evidence.
  const gappy = buildPeriodSummary(db, { metricKey: 'exports_current', startYear: 2023, endYear: 2025, operation: 'SUM' });
  assert.equal(gappy.available, false);
  assert.equal(gappy.reason, 'incomplete_period');
  assert.deepEqual(gappy.missingYears, [2023]);
  assert.equal(gappy.sum, null);
  // GDP LEVEL: capability refusal, never a summed GDP.
  const gdp = buildPeriodSummary(db, { metricKey: 'nominal_current', startYear: 2024, endYear: 2026, operation: 'SUM' });
  assert.equal(gdp.available, false);
  assert.equal(gdp.reason, 'unsupported_transformation_for_metric');
  // Unknown metric + unknown operation fail closed.
  assert.throws(() => buildPeriodSummary(db, { metricKey: 'nope', startYear: 2024, endYear: 2026 }), /Unknown metric/);
  assert.throws(
    () => buildPeriodSummary(db, { metricKey: 'exports_current', startYear: 2024, endYear: 2026, operation: 'MEDIAN' }),
    (err) => err?.code === 'INVALID_OPERATION',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Q — GDP DIFFERENTIAL REGRESSION (exact frozen-fixture pins)
// ---------------------------------------------------------------------------
test('Phase 7C-1.10: GDP analytical outputs identical on the frozen edge fixture', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db } = await seedEdgeCaseDb();
  const { buildFullRanking } = await import('../src/services/fullRanking.js');
  const { buildRankVerification } = await import('../src/services/rankVerification.js');
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');
  const { buildGrowthComparisonResponse } = await import('../src/services/growthComparisonService.js');
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
  const { buildYoyCoveragePanel } = await import('../src/services/coverageService.js');
  // Ranking: exact order, ranks, denominators (nominal_current, DESC).
  const ranking = buildFullRanking(db, { metricKey: 'nominal_current', year: 2005 });
  assert.deepEqual(ranking.rows.map((r) => r.iso3), EDGE_EXPECTATIONS.levelOrder[2005]);
  assert.equal(ranking.total, EDGE_EXPECTATIONS.levelDenominator[2005]);
  assert.equal(ranking.rows.find((r) => r.iso3 === 'IND').rank, EDGE_EXPECTATIONS.indiaRank[2005]);
  assert.match(ranking.notes.join(' '), /descending/);
  // Verification: exact rank focus + YoY percent + denominator.
  const verify = buildRankVerification(db, { metricKey: 'nominal_current', year: 2005 });
  assert.equal(verify.focus.rank, EDGE_EXPECTATIONS.indiaRank[2005]);
  assert.equal(verify.total, EDGE_EXPECTATIONS.levelDenominator[2005]);
  const { buildFullYoyRanking } = await import('../src/services/yoyVerification.js');
  const yoy = buildFullYoyRanking(db, { metricKey: 'nominal_current', year: 2005 });
  assert.equal(yoy.focus.yoyPercent, EDGE_EXPECTATIONS.indiaYoyPercent[2005]);
  assert.equal(yoy.total, EDGE_EXPECTATIONS.yoyPairs[2005]);
  // Level comparison 2004 -> 2005: available, verified, identity holds.
  const level = buildLevelComparisonResponse(db, { metricKey: 'nominal_current', yearA: 2004, yearB: 2005 });
  assert.equal(level.comparison.available, true);
  assert.equal(level.verification.passed, true);
  // Growth comparison: available, verified (endpoint percent, DESC growth rank).
  const growth = buildGrowthComparisonResponse(db, { metricKey: 'nominal_current', yearA: 2004, yearB: 2005 });
  assert.equal(growth.comparison.available, true);
  assert.equal(growth.verification.passed, true);
  assert.equal('flowSemantics' in growth, false, 'no flow fields leak into GDP payloads');
  // Yearly cells: exact value/rank/YoY.
  const yearly = buildIndiaYearlyRows(db, { metricKeys: ['nominal_current'], startYear: 2003, endYear: 2005 });
  for (const row of yearly.rows) {
    const cell = row.nominal_current;
    assert.equal(cell.indiaValue, EDGE_EXPECTATIONS.indiaValue[row.year]);
    assert.equal(cell.indiaRank, EDGE_EXPECTATIONS.indiaRank[row.year]);
    assert.equal(cell.indiaYoY, EDGE_EXPECTATIONS.indiaYoyPercent[row.year]);
  }
  // Coverage YoY: GDP pairs intact.
  const coverage = buildYoyCoveragePanel(db, { metricKeys: ['nominal_current'], year: 2005 });
  const entry = coverage.metrics[0];
  assert.equal(entry.available, true);
  assert.equal(entry.validYoyPairs, EDGE_EXPECTATIONS.yoyPairs[2005]);
  assert.equal(entry.focus.yoyPercent, EDGE_EXPECTATIONS.indiaYoyPercent[2005]);
  db.close();
});

// ---------------------------------------------------------------------------
// R — GDP never receives period semantics; endpoint + CAGR unchanged
// ---------------------------------------------------------------------------
test('Phase 7C-1.11: GDP period refusal with endpoint comparison and CAGR intact', async () => {
  const { METRICS } = await import('../src/config.js');
  const { canTransform, TRANSFORMS, cagr } = await import('../src/domain/transforms.js');
  for (const key of ['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant', 'total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant']) {
    assert.deepEqual([...METRICS[key].periodAggregation], [], `${key} declares NONE`);
    assert.equal(canTransform(METRICS[key], TRANSFORMS.PERIOD_SUM).allowed, false, key);
    assert.equal(canTransform(METRICS[key], TRANSFORMS.PERIOD_AVG).allowed, false, key);
    assert.equal(canTransform(METRICS[key], TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE).allowed, false, key);
  }
  // Endpoint comparison and CAGR on GDP nulls/values unchanged.
  const { buildCompareResponse } = await import('../src/services/entityCompare.js');
  const db = await freshDb();
  await ingestFull(db);
  const pct = await buildCompareResponse(db, {
    entityA: 'country:IND',
    entityB: 'country:USA',
    metricKey: 'nominal_current',
    yearA: 2024,
    yearB: 2025,
    operation: 'percent_change',
  });
  assert.equal(pct.results.comparison.a.computable, true, 'GDP endpoint percent still computes (B vs A, not a sum)');
  const cagrRes = cagr({ a: 100, b: 121, years: 2 }, METRICS.nominal_current);
  assert.equal(cagrRes.computable, true);
  assert.ok(Math.abs(cagrRes.value - 10) < 1e-9, 'GDP CAGR formula untouched');
  db.close();
});
