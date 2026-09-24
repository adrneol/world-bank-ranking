/**
 * PHASE-2 MEASURE REGISTRY TESTS (semantic metadata + lifecycle, no ingestion).
 *
 * Phase 2 adds meaning to the registry without changing any calculation:
 * every measure declares its observation type, valid change types, ranking
 * direction, aggregation and comparison capabilities, and every measure sits
 * in exactly one lifecycle state (PRODUCTION vs SUPPORTED-defined).
 *
 * The eight GDP metrics are regression anchors: keys, codes, order, labels,
 * units and analytical behavior are frozen, and the production set is still
 * exactly those eight. Disabled future definitions must be visible as
 * metadata but invisible to ingestion, integrity, resolution and ranking.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGGREGATION_MODES,
  ALL_METRIC_KEYS,
  CANONICAL_INDICATOR_CODES,
  CHANGE_TYPES,
  ENTITY_KINDS,
  FUTURE_METRIC_DEFINITIONS,
  FUTURE_METRIC_KEYS,
  LIFECYCLE_STATES,
  MEASURE_INTERPRETATIONS,
  METRICS,
  METRIC_KEYS,
  OBSERVATION_TYPES,
  PRODUCTION_METRIC_KEYS,
  RANKING_DIRECTIONS,
  SIGN_DOMAINS,
  TOTAL_GDP_METRIC_KEYS,
  assertFutureDefinitions,
  assertRegistryIntegrity,
  assertSemanticFields,
  getDefinedMetric,
  getMetric,
  isProductionMetric,
} from '../src/config.js';
import { describeMeasure, describeMetric } from '../src/domain/format.js';
import { seedEdgeCaseDb } from './helpers/testDb.js';

const FROZEN_PRODUCTION_KEYS = [
  'nominal_current',
  'nominal_constant',
  'ppp_current',
  'ppp_constant',
  'total_current',
  'total_constant',
  'total_ppp_current',
  'total_ppp_constant',
];

const FROZEN_CODES = {
  nominal_current: 'NY.GDP.PCAP.CD',
  nominal_constant: 'NY.GDP.PCAP.KD',
  ppp_current: 'NY.GDP.PCAP.PP.CD',
  ppp_constant: 'NY.GDP.PCAP.PP.KD',
  total_current: 'NY.GDP.MKTP.CD',
  total_constant: 'NY.GDP.MKTP.KD',
  total_ppp_current: 'NY.GDP.MKTP.PP.CD',
  total_ppp_constant: 'NY.GDP.MKTP.PP.KD',
};

test('Phase 2.1: the eight GDP metric keys, codes and order are unchanged', () => {
  assert.deepEqual([...PRODUCTION_METRIC_KEYS], FROZEN_PRODUCTION_KEYS);
  assert.deepEqual([...ALL_METRIC_KEYS], FROZEN_PRODUCTION_KEYS);
  assert.deepEqual([...METRIC_KEYS].sort(), FROZEN_PRODUCTION_KEYS.slice(0, 4).sort());
  assert.deepEqual([...TOTAL_GDP_METRIC_KEYS].sort(), FROZEN_PRODUCTION_KEYS.slice(4).sort());
  for (const [key, code] of Object.entries(FROZEN_CODES)) {
    assert.equal(METRICS[key].indicatorCode, code, key);
    assert.equal(CANONICAL_INDICATOR_CODES[key], code, key);
  }
});

test('Phase 2.2: existing labels, units and defaults are untouched', () => {
  assert.equal(METRICS.nominal_current.label, 'Nominal — Current US$');
  assert.equal(METRICS.total_constant.label, 'Total GDP — Real — Constant 2015 US$');
  assert.equal(METRICS.ppp_constant.unitLong, 'constant 2021 international $');
  assert.equal(METRICS.total_current.unit, 'current US$');
  // Legacy descriptor shape is frozen (guardrails §26: no silent growth).
  assert.deepEqual(describeMetric(METRICS.nominal_current), {
    key: 'nominal_current',
    subject: 'gdp_per_capita',
    indicatorCode: 'NY.GDP.PCAP.CD',
    label: 'Nominal — Current US$',
    shortLabel: 'Nominal Current',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'nominal',
    priceBasis: 'current',
    ppp: false,
    baseYear: null,
    displayScale: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD',
  });
});

test('Phase 2.3: production metrics declare the full semantic contract', () => {
  for (const key of PRODUCTION_METRIC_KEYS) {
    const metric = METRICS[key];
    assert.equal(metric.lifecycle, 'PRODUCTION', key);
    assert.ok(isProductionMetric(key), key);
    assert.equal(metric.observationType, 'LEVEL', `${key} is a level`);
    assert.equal(metric.frequency, 'ANNUAL', key);
    // GDP keeps its exact historical change semantics: no PP, no INDEX_POINT.
    assert.deepEqual([...metric.validChangeTypes], ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'], key);
    assert.equal(metric.rankingDirection, 'DESC', key);
    assert.equal(metric.derivation.kind, 'RAW', key);
    assert.equal(metric.quotation, null, key);
    assertSemanticFields(key, metric);
  }
  // Aggregation is the per-capita/total split the engine already honors.
  for (const key of METRIC_KEYS) assert.equal(METRICS[key].aggregation, 'NOT_AGGREGATABLE', key);
  for (const key of TOTAL_GDP_METRIC_KEYS) assert.equal(METRICS[key].aggregation, 'SUM', key);
});

test('Phase 2.4: future definitions are verified, disabled and fully described', () => {
  assert.deepEqual([...FUTURE_METRIC_KEYS], [
    'inflation_cpi',
    'inflation_cpi_index',
    'inflation_deflator',
    'fx_official',
    'exports_current',
    'imports_current',
    'fdi_inflows',
    'fdi_inflows_pct_gdp',
  ]);
  assert.equal(assertFutureDefinitions(), true);
  assert.equal(assertRegistryIntegrity(), true);
  for (const key of FUTURE_METRIC_KEYS) {
    const def = FUTURE_METRIC_DEFINITIONS[key];
    assert.ok(!isProductionMetric(key), `${key} must not be production-enabled`);
    assert.ok(!ALL_METRIC_KEYS.includes(key), `${key} must not widen the production registry`);
    assert.equal(def.lifecycle, 'SUPPORTED', key);
    assert.ok(def.verified?.date && def.verified?.method && def.verified?.name, `${key} needs evidence`);
    assertSemanticFields(key, def, { prospectiveSubject: true });
  }
  // Exact verified codes (anchors the live verification; Phase 5 re-verifies).
  assert.equal(FUTURE_METRIC_DEFINITIONS.inflation_cpi.indicatorCode, 'FP.CPI.TOTL.ZG');
  assert.equal(FUTURE_METRIC_DEFINITIONS.inflation_cpi_index.indicatorCode, 'FP.CPI.TOTL');
  assert.equal(FUTURE_METRIC_DEFINITIONS.inflation_deflator.indicatorCode, 'NY.GDP.DEFL.KD.ZG');
  assert.equal(FUTURE_METRIC_DEFINITIONS.fx_official.indicatorCode, 'PA.NUS.FCRF');
  assert.equal(FUTURE_METRIC_DEFINITIONS.exports_current.indicatorCode, 'NE.EXP.GNFS.CD');
  assert.equal(FUTURE_METRIC_DEFINITIONS.imports_current.indicatorCode, 'NE.IMP.GNFS.CD');
  assert.equal(FUTURE_METRIC_DEFINITIONS.fdi_inflows.indicatorCode, 'BX.KLT.DINV.CD.WD');
  assert.equal(FUTURE_METRIC_DEFINITIONS.fdi_inflows_pct_gdp.indicatorCode, 'BX.KLT.DINV.WD.GD.ZS');
});

test('Phase 2.5: percent vs pp vs index-point semantics are encoded, not collapsed', () => {
  // Rates change in percentage points, never relative percent by default.
  for (const key of ['inflation_cpi', 'inflation_deflator', 'fdi_inflows_pct_gdp']) {
    const def = FUTURE_METRIC_DEFINITIONS[key];
    assert.ok(def.validChangeTypes.includes('PP'), `${key} declares PP`);
    assert.ok(!def.validChangeTypes.includes('PERCENT'), `${key} must not declare PERCENT`);
    assert.ok(!def.validChangeTypes.includes('INDEX_POINT'), `${key} must not declare INDEX_POINT`);
  }
  // Index movement is index points, never percentage points.
  const index = FUTURE_METRIC_DEFINITIONS.inflation_cpi_index;
  assert.ok(index.validChangeTypes.includes('INDEX_POINT'));
  assert.ok(!index.validChangeTypes.includes('PP'), 'index movement is not percentage-point change');
  assert.equal(index.observationType, 'INDEX');
  assert.equal(index.baseYear, 2010);
  // Quoted FX carries its convention exactly once.
  const fx = FUTURE_METRIC_DEFINITIONS.fx_official;
  assert.equal(fx.observationType, 'QUOTED_RATE');
  assert.deepEqual({ ...fx.quotation }, { convention: 'LCU_PER_USD', base: 'USD' });
  assert.equal(fx.rankingDirection, 'NEUTRAL');
  // Signed flows refuse silent percent semantics.
  assert.equal(FUTURE_METRIC_DEFINITIONS.fdi_inflows.signDomain, 'SIGNED');
  assert.ok(!FUTURE_METRIC_DEFINITIONS.fdi_inflows.validChangeTypes.includes('PERCENT'));
});

test('Phase 2.6: vocabularies are closed and every registered measure is valid', () => {
  assert.deepEqual([...LIFECYCLE_STATES].sort(), ['DEFINED', 'PRODUCTION', 'SUPPORTED'].sort());
  const all = [
    ...PRODUCTION_METRIC_KEYS.map((k) => [k, METRICS[k], false]),
    ...FUTURE_METRIC_KEYS.map((k) => [k, FUTURE_METRIC_DEFINITIONS[k], true]),
  ];
  for (const [key, entry, prospective] of all) {
    assert.ok(OBSERVATION_TYPES.includes(entry.observationType), key);
    assert.ok(RANKING_DIRECTIONS.includes(entry.rankingDirection), key);
    assert.ok(MEASURE_INTERPRETATIONS.includes(entry.interpretation), key);
    assert.ok(AGGREGATION_MODES.includes(entry.aggregation), key);
    assert.ok(SIGN_DOMAINS.includes(entry.signDomain), key);
    for (const change of entry.validChangeTypes) assert.ok(CHANGE_TYPES.includes(change), `${key}:${change}`);
    for (const kind of entry.comparisonCapability) assert.ok(ENTITY_KINDS.includes(kind), `${key}:${kind}`);
    assertSemanticFields(key, entry, { prospectiveSubject: prospective });
  }
  // The validator itself rejects bad metadata (capability gate fails closed).
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, observationType: 'LEVELS' }), /observationType/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, aggregation: 'AVERAGE' }), /aggregation/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, quotation: { convention: 'LCU_PER_USD' } }), /quotation/);
  assert.throws(
    () => assertSemanticFields('x', { ...FUTURE_METRIC_DEFINITIONS.fx_official, quotation: null }),
    /quotation/,
  );
});

test('Phase 2.7: no duplicate keys or codes anywhere (production + defined)', () => {
  const keys = [...PRODUCTION_METRIC_KEYS, ...FUTURE_METRIC_KEYS];
  assert.equal(new Set(keys).size, keys.length, 'measure keys must be unique');
  const codes = keys.map((k) => getDefinedMetric(k).indicatorCode.toUpperCase());
  assert.equal(new Set(codes).size, codes.length, 'indicator codes must be unique');
  // Growth-percentage and local-currency series exist in WDI but must never
  // enter any registry map as levels.
  for (const forbidden of ['NY.GDP.MKTP.KD.ZG', 'NY.GDP.PCAP.KD.ZG', 'NY.GDP.MKTP.KN', 'NY.GDP.MKTP.CN']) {
    assert.ok(!codes.includes(forbidden), `${forbidden} must stay out of every registry map`);
  }
});

test('Phase 2.8: disabled keys resolve as metadata but never as metrics', () => {
  assert.equal(getDefinedMetric('inflation_cpi').indicatorCode, 'FP.CPI.TOTL.ZG');
  assert.equal(getDefinedMetric('PA.NUS.FCRF').key, 'fx_official');
  assert.throws(() => getMetric('inflation_cpi'), /Unknown metric/);
  assert.throws(() => getMetric('FP.CPI.TOTL.ZG'), /Unknown metric/);
  assert.throws(() => getMetric('fx_official'), /Unknown metric/);
});

test('Phase 2.9: disabled definitions break neither integrity nor ingestion', async () => {
  const { db } = await seedEdgeCaseDb();
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  const report = runIntegrityChecks(db);
  const h = report.checks.find((c) => c.check === 'H.registry_indicators');
  // Edge-case DB seeds one indicator; H fails loudly for the partial set
  // exactly as before (proves H still measures the production universe).
  assert.equal(h.status, 'fail');
  assert.deepEqual(h.detail.expectedMetricKeys, [...PRODUCTION_METRIC_KEYS].sort());
  assert.ok(!h.detail.expectedMetricKeys.includes('inflation_cpi'));

  const { refreshData } = await import('../src/wb/ingest.js');
  await assert.rejects(
    refreshData({ indicators: ['inflation_cpi'], trigger: 'test', db }),
    (error) => error.code === 'INVALID_INDICATOR' && error.httpStatus === 400,
  );
  await assert.rejects(
    refreshData({ indicators: ['nominal_current', 'inflation_cpi'], trigger: 'test', db }),
    /not production-enabled/,
  );
  // No fetch_runs row was recorded for the rejected attempts (guard runs
  // before bookkeeping) and no lock was left behind.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fetch_runs').get().n, 0);
  const { isRefreshInProgress } = await import('../src/wb/ingest.js');
  assert.equal(isRefreshInProgress(), false);
});

test('Phase 2.10: HTTP layer — /api/indicators catalog, lifecycle and no secrets', async () => {
  const seeded = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db: seeded.db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/indicators`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 16);
    assert.equal(body.productionCount, 8);
    assert.equal(body.definedCount, 8);
    assert.deepEqual(body.production.map((m) => m.key), FROZEN_PRODUCTION_KEYS);
    for (const m of body.production) {
      assert.equal(m.productionEnabled, true);
      assert.equal(m.lifecycle, 'PRODUCTION');
      assert.equal(m.observationType, 'LEVEL');
      assert.deepEqual(m.validChangeTypes, ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']);
    }
    const cpi = body.defined.find((m) => m.key === 'inflation_cpi');
    assert.equal(cpi.indicatorCode, 'FP.CPI.TOTL.ZG');
    assert.equal(cpi.observationType, 'RATE');
    assert.equal(cpi.productionEnabled, false);
    const fx = body.defined.find((m) => m.key === 'fx_official');
    assert.deepEqual(fx.quotation, { convention: 'LCU_PER_USD', base: 'USD' });
    // Disabled keys have no ingested rows in this fixture DB.
    for (const m of body.defined) assert.equal(m.ingested, false, m.key);
    // Legacy /api/metadata is byte-identical in shape (production only).
    const meta = await (await fetch(`${base}/api/metadata`)).json();
    assert.equal(meta.expectedIndicators.length, 8);
    assert.deepEqual(meta.subjects.map((s) => s.key), ['gdp_per_capita', 'gdp_total']);
    assert.equal(meta.subjects[0].metrics.length, 4);
    assert.equal(meta.subjects[1].metrics.length, 4);
    // No secret material anywhere in the new metadata surface.
    const payload = JSON.stringify(body);
    assert.ok(!/REFRESH_ADMIN_TOKEN/i.test(payload));
    assert.ok(!/Bearer\s+[A-Za-z0-9]/i.test(payload));
    assert.ok(!/CORS_ORIGINS/i.test(payload));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 2.11: disabled keys stay unknown to analytical routes (fail closed)', async () => {
  const seeded = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db: seeded.db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of [
      '/api/ranking?indicator=inflation_cpi&year=2005',
      '/api/ranking?indicator=FP.CPI.TOTL.ZG&year=2005',
      '/api/comparison/level?indicator=exports_current&yearA=2004&yearB=2005',
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 400, path);
      assert.equal((await res.json()).error.code, 'INVALID_INDICATOR', path);
    }
    // /api/coverage ignores a stray indicator param without fromYear/toYear:
    // it still serves the production panel only (no disabled key can leak in).
    const coverage = await fetch(`${base}/api/coverage?year=2005&indicator=fx_official`);
    assert.equal(coverage.status, 200);
    const coverageBody = await coverage.json();
    assert.equal(coverageBody.metrics.length, 4);
    assert.ok(!coverageBody.metrics.some((m) => m.metric.key === 'fx_official'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 2.12: substitution protection still fails closed for production codes', async () => {
  // CANONICAL map is frozen at eight entries; overrides stay test-gated.
  assert.equal(Object.keys(CANONICAL_INDICATOR_CODES).length, 8);
  const { indicatorCodeFor } = await import('../src/config.js');
  assert.equal(indicatorCodeFor('total_current'), 'NY.GDP.MKTP.CD');
  assert.throws(() => indicatorCodeFor('inflation_cpi'), /No canonical World Bank indicator/);
});
