/**
 * MEASURE REGISTRY TESTS (semantic metadata + lifecycle).
 *
 * Phase 2 added meaning to the registry without changing any calculation;
 * Phase 5 promoted twelve live-verified measures to production (twenty
 * metrics across eight subjects). The eight GDP metrics remain regression
 * anchors: keys, codes, order, labels, units and analytical behavior frozen.
 * Disabled-definition machinery (FUTURE_METRIC_DEFINITIONS, currently empty)
 * is still validated so a future SUPPORTED entry cannot widen production.
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

const FROZEN_GDP_KEYS = [
  'nominal_current',
  'nominal_constant',
  'ppp_current',
  'ppp_constant',
  'total_current',
  'total_constant',
  'total_ppp_current',
  'total_ppp_constant',
];

const FROZEN_GDP_CODES = {
  nominal_current: 'NY.GDP.PCAP.CD',
  nominal_constant: 'NY.GDP.PCAP.KD',
  ppp_current: 'NY.GDP.PCAP.PP.CD',
  ppp_constant: 'NY.GDP.PCAP.PP.KD',
  total_current: 'NY.GDP.MKTP.CD',
  total_constant: 'NY.GDP.MKTP.KD',
  total_ppp_current: 'NY.GDP.MKTP.PP.CD',
  total_ppp_constant: 'NY.GDP.MKTP.PP.KD',
};

// Phase-5 promotion order (registry order after the eight GDP metrics).
const PROMOTED_KEYS = [
  'inflation_cpi',
  'inflation_cpi_index',
  'inflation_deflator',
  'exports_current',
  'imports_current',
  'fdi_inflows',
  'fdi_inflows_pct_gdp',
  'fx_official',
  'current_account',
  'reserves_ex_gold',
  'remittances_received',
  'population_total',
];

const PROMOTED_CODES = {
  inflation_cpi: 'FP.CPI.TOTL.ZG',
  inflation_cpi_index: 'FP.CPI.TOTL',
  inflation_deflator: 'NY.GDP.DEFL.KD.ZG',
  fx_official: 'PA.NUS.FCRF',
  exports_current: 'NE.EXP.GNFS.CD',
  imports_current: 'NE.IMP.GNFS.CD',
  fdi_inflows: 'BX.KLT.DINV.CD.WD',
  fdi_inflows_pct_gdp: 'BX.KLT.DINV.WD.GD.ZS',
  current_account: 'BN.CAB.XOKA.CD',
  reserves_ex_gold: 'FI.RES.XGLD.CD',
  remittances_received: 'BX.TRF.PWKR.CD.DT',
  population_total: 'SP.POP.TOTL',
};

test('Phase 5.1: the eight GDP metric keys, codes and order are unchanged', () => {
  assert.deepEqual([...PRODUCTION_METRIC_KEYS].slice(0, 8), FROZEN_GDP_KEYS);
  assert.deepEqual([...METRIC_KEYS].sort(), FROZEN_GDP_KEYS.slice(0, 4).sort());
  assert.deepEqual([...TOTAL_GDP_METRIC_KEYS].sort(), FROZEN_GDP_KEYS.slice(4).sort());
  for (const [key, code] of Object.entries(FROZEN_GDP_CODES)) {
    assert.equal(METRICS[key].indicatorCode, code, key);
    assert.equal(CANONICAL_INDICATOR_CODES[key], code, key);
  }
  // Promotion order is pinned: GDP first, then Phase-5 families.
  assert.deepEqual([...PRODUCTION_METRIC_KEYS], [...FROZEN_GDP_KEYS, ...PROMOTED_KEYS]);
  assert.deepEqual([...ALL_METRIC_KEYS], [...FROZEN_GDP_KEYS, ...PROMOTED_KEYS]);
  assert.equal(ALL_METRIC_KEYS.length, 20);
});

test('Phase 5.2: existing GDP labels, units and descriptor shape are untouched', () => {
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

test('Phase 5.3: every production metric declares the full semantic contract', () => {
  for (const key of PRODUCTION_METRIC_KEYS) {
    const metric = METRICS[key];
    assert.equal(metric.lifecycle, 'PRODUCTION', key);
    assert.ok(isProductionMetric(key), key);
    assert.equal(metric.frequency, 'ANNUAL', key);
    assert.equal(metric.derivation.kind, 'RAW', key);
    assertSemanticFields(key, metric);
  }
  // GDP keeps its exact historical change semantics: no PP, no INDEX_POINT.
  for (const key of FROZEN_GDP_KEYS) {
    assert.equal(METRICS[key].observationType, 'LEVEL', key);
    assert.deepEqual([...METRICS[key].validChangeTypes], ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'], key);
    assert.equal(METRICS[key].rankingDirection, 'DESC', key);
    assert.equal(METRICS[key].quotation, null, key);
  }
  // Aggregation is the per-capita/total split the engine already honors.
  for (const key of METRIC_KEYS) assert.equal(METRICS[key].aggregation, 'NOT_AGGREGATABLE', key);
  for (const key of TOTAL_GDP_METRIC_KEYS) assert.equal(METRICS[key].aggregation, 'SUM', key);
  // Promoted families carry their verified codes and evidence.
  for (const [key, code] of Object.entries(PROMOTED_CODES)) {
    assert.equal(METRICS[key].indicatorCode, code, key);
    assert.equal(CANONICAL_INDICATOR_CODES[key], code, key);
    assert.ok(METRICS[key].verified?.date && METRICS[key].verified?.method && METRICS[key].verified?.name, `${key} needs evidence`);
  }
});

test('Phase 5.4: disabled-definition machinery survives promotion (empty map)', () => {
  assert.deepEqual([...FUTURE_METRIC_KEYS], []);
  assert.deepEqual(FUTURE_METRIC_DEFINITIONS, {});
  assert.equal(assertFutureDefinitions(), true);
  assert.equal(assertRegistryIntegrity(), true);
});

test('Phase 5.5: percent vs pp vs index-point semantics are encoded, not collapsed', () => {
  // Rates change in percentage points, never relative percent by default.
  for (const key of ['inflation_cpi', 'inflation_deflator', 'fdi_inflows_pct_gdp']) {
    const def = METRICS[key];
    assert.ok(def.validChangeTypes.includes('PP'), `${key} declares PP`);
    assert.ok(!def.validChangeTypes.includes('PERCENT'), `${key} must not declare PERCENT`);
    assert.ok(!def.validChangeTypes.includes('INDEX_POINT'), `${key} must not declare INDEX_POINT`);
  }
  // Index movement is index points, never percentage points.
  const index = METRICS.inflation_cpi_index;
  assert.ok(index.validChangeTypes.includes('INDEX_POINT'));
  assert.ok(!index.validChangeTypes.includes('PP'), 'index movement is not percentage-point change');
  assert.equal(index.observationType, 'INDEX');
  assert.equal(index.baseYear, 2010);
  // Quoted FX carries its convention exactly once.
  const fx = METRICS.fx_official;
  assert.equal(fx.observationType, 'QUOTED_RATE');
  assert.deepEqual({ ...fx.quotation }, { convention: 'LCU_PER_USD', base: 'USD' });
  assert.equal(fx.rankingDirection, 'NEUTRAL');
  // Signed flows refuse silent percent semantics.
  assert.equal(METRICS.fdi_inflows.signDomain, 'SIGNED');
  assert.ok(!METRICS.fdi_inflows.validChangeTypes.includes('PERCENT'));
  assert.equal(METRICS.current_account.signDomain, 'SIGNED');
});

test('Phase 5.6: vocabularies are closed and every registered measure is valid', () => {
  assert.deepEqual([...LIFECYCLE_STATES].sort(), ['DEFINED', 'PRODUCTION', 'SUPPORTED'].sort());
  for (const key of PRODUCTION_METRIC_KEYS) {
    const entry = METRICS[key];
    assert.ok(OBSERVATION_TYPES.includes(entry.observationType), key);
    assert.ok(RANKING_DIRECTIONS.includes(entry.rankingDirection), key);
    assert.ok(MEASURE_INTERPRETATIONS.includes(entry.interpretation), key);
    assert.ok(AGGREGATION_MODES.includes(entry.aggregation), key);
    assert.ok(SIGN_DOMAINS.includes(entry.signDomain), key);
    for (const change of entry.validChangeTypes) assert.ok(CHANGE_TYPES.includes(change), `${key}:${change}`);
    for (const kind of entry.comparisonCapability) assert.ok(ENTITY_KINDS.includes(kind), `${key}:${kind}`);
    assertSemanticFields(key, entry);
  }
  // The validator itself rejects bad metadata (capability gate fails closed).
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, observationType: 'LEVELS' }), /observationType/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, aggregation: 'AVERAGE' }), /aggregation/);
  assert.throws(() => assertSemanticFields('x', { ...METRICS.nominal_current, quotation: { convention: 'LCU_PER_USD' } }), /quotation/);
  assert.throws(
    () => assertSemanticFields('x', { ...METRICS.fx_official, quotation: null }),
    /quotation/,
  );
});

test('Phase 5.7: no duplicate keys or codes in the production registry', () => {
  assert.equal(new Set(PRODUCTION_METRIC_KEYS).size, PRODUCTION_METRIC_KEYS.length, 'measure keys must be unique');
  const codes = PRODUCTION_METRIC_KEYS.map((k) => getDefinedMetric(k).indicatorCode.toUpperCase());
  assert.equal(new Set(codes).size, codes.length, 'indicator codes must be unique');
  // Growth-percentage and local-currency series exist in WDI but must never
  // enter the registry as levels.
  for (const forbidden of ['NY.GDP.MKTP.KD.ZG', 'NY.GDP.PCAP.KD.ZG', 'NY.GDP.MKTP.KN', 'NY.GDP.MKTP.CN']) {
    assert.ok(!codes.includes(forbidden), `${forbidden} must stay out of the registry`);
  }
});

test('Phase 5.8: promoted keys resolve as metrics; unknown keys fail closed', () => {
  assert.equal(getDefinedMetric('inflation_cpi').indicatorCode, 'FP.CPI.TOTL.ZG');
  assert.equal(getDefinedMetric('PA.NUS.FCRF').key, 'fx_official');
  assert.equal(getMetric('inflation_cpi').indicatorCode, 'FP.CPI.TOTL.ZG');
  assert.equal(getMetric('FP.CPI.TOTL').key, 'inflation_cpi_index');
  assert.throws(() => getMetric('nope_not_a_metric'), /Unknown metric/);
  assert.throws(() => getMetric('NY.GDP.TOTAL.CD'), /Unknown metric/);
});

test('Phase 5.9: integrity measures the twenty-metric production universe', async () => {
  const { db } = await seedEdgeCaseDb();
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  const report = runIntegrityChecks(db);
  const h = report.checks.find((c) => c.check === 'H.registry_indicators');
  // Edge-case DB seeds one indicator; H fails loudly for the partial set
  // exactly as before (proves H still measures the production universe).
  assert.equal(h.status, 'fail');
  assert.deepEqual(h.detail.expectedMetricKeys, [...PRODUCTION_METRIC_KEYS].sort());
  assert.ok(h.detail.expectedMetricKeys.includes('inflation_cpi'));

  const { refreshData } = await import('../src/wb/ingest.js');
  await assert.rejects(
    refreshData({ indicators: ['not_a_metric'], trigger: 'test', db }),
    (error) => error.code === 'INVALID_INDICATOR' && error.httpStatus === 400,
  );
  await assert.rejects(
    refreshData({ indicators: ['nominal_current', 'not_a_metric'], trigger: 'test', db }),
    /not production-enabled/,
  );
  // No fetch_runs row was recorded for the rejected attempts (guard runs
  // before bookkeeping) and no lock was left behind.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fetch_runs').get().n, 0);
  const { isRefreshInProgress } = await import('../src/wb/ingest.js');
  assert.equal(isRefreshInProgress(), false);
});

test('Phase 5.10: HTTP layer — /api/indicators catalog, lifecycle and no secrets', async () => {
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
    assert.equal(body.count, 20);
    assert.equal(body.productionCount, 20);
    assert.equal(body.definedCount, 0);
    assert.deepEqual(body.production.map((m) => m.key), [...FROZEN_GDP_KEYS, ...PROMOTED_KEYS]);
    for (const m of body.production) {
      assert.equal(m.productionEnabled, true);
      assert.equal(m.lifecycle, 'PRODUCTION');
    }
    const cpi = body.production.find((m) => m.key === 'inflation_cpi');
    assert.equal(cpi.indicatorCode, 'FP.CPI.TOTL.ZG');
    assert.equal(cpi.observationType, 'RATE');
    const fx = body.production.find((m) => m.key === 'fx_official');
    assert.deepEqual(fx.quotation, { convention: 'LCU_PER_USD', base: 'USD' });
    // Rich measure view carries semantics the legacy descriptor never had.
    const measure = body.production.find((m) => m.key === 'fdi_inflows_pct_gdp');
    assert.deepEqual(measure.validChangeTypes, ['ABSOLUTE', 'PP']);
    assert.equal(measure.aggregation, 'WEIGHTED_RATIO');
    // Legacy /api/metadata keeps its shape with the production set.
    const meta = await (await fetch(`${base}/api/metadata`)).json();
    assert.equal(meta.expectedIndicators.length, 20);
    assert.deepEqual(meta.subjects.map((s) => s.key), ['gdp_per_capita', 'gdp_total', 'prices', 'trade', 'capital_flows', 'exchange', 'external', 'population']);
    // No secret material anywhere in the metadata surface.
    const payload = JSON.stringify(body);
    assert.ok(!/REFRESH_ADMIN_TOKEN/i.test(payload));
    assert.ok(!/Bearer\s+[A-Za-z0-9]/i.test(payload));
    assert.ok(!/CORS_ORIGINS/i.test(payload));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 5.11: promoted keys resolve over HTTP; unknown keys fail closed', async () => {
  const seeded = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db: seeded.db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    // Promoted but un-ingested in this fixture: valid request, missing data
    // (available:false), never INVALID_INDICATOR.
    const res = await fetch(`${base}/api/ranking?indicator=inflation_cpi&year=2005`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.available, false);
    assert.equal(body.reason, 'metric_not_ingested');
    for (const path of [
      '/api/ranking?indicator=NOPE&year=2005',
      '/api/comparison/level?indicator=exports_current_typo&yearA=2004&yearB=2005',
    ]) {
      const bad = await fetch(`${base}${path}`);
      assert.equal(bad.status, 400, path);
      assert.equal((await bad.json()).error.code, 'INVALID_INDICATOR', path);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 5.12: substitution protection still fails closed for production codes', async () => {
  // CANONICAL map covers all twenty production entries; overrides stay test-gated.
  assert.equal(Object.keys(CANONICAL_INDICATOR_CODES).length, 20);
  const { indicatorCodeFor } = await import('../src/config.js');
  assert.equal(indicatorCodeFor('total_current'), 'NY.GDP.MKTP.CD');
  assert.equal(indicatorCodeFor('inflation_cpi'), 'FP.CPI.TOTL.ZG');
  assert.throws(() => indicatorCodeFor('not_a_metric'), /No canonical World Bank indicator/);
});
