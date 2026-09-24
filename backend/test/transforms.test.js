/**
 * PHASE-3 TRANSFORM TESTS (generic mathematical transformation layer).
 *
 * Every transform is exercised as a pure function plus through the central
 * canTransform/computeTransform gate, driven by real Phase-2 registry
 * entries — never by metric-name conditionals. GDP oracle tests prove the
 * generic layer reproduces the proven engines exactly; signed/zero/edge
 * cases prove it fails closed with explicit reasons instead of fabricating
 * numbers. No ingestion, no database, no services involved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { METRICS } from '../src/config.js';
import { formatIndexPoints, formatPercentagePoints, formatValue } from '../src/domain/format.js';
import {
  TRANSFORM_NA_REASONS,
  TRANSFORMS,
  absoluteChange,
  cagr,
  canTransform,
  computeTransform,
  crossRate,
  groupRatioFromSums,
  groupSum,
  indexPointChange,
  outputUnitFor,
  percentChange,
  percentagePointChange,
} from '../src/domain/transforms.js';
import { buildYoySeries, computeYoy } from '../src/domain/yoy.js';

const GDP = METRICS.nominal_current;
const GDP_TOTAL = METRICS.total_constant;
const CPI = METRICS.inflation_cpi;
const CPI_INDEX = METRICS.inflation_cpi_index;
const FX = METRICS.fx_official;
const EXPORTS = METRICS.exports_current;
const FDI_FLOW = METRICS.fdi_inflows;
const FDI_RATIO = METRICS.fdi_inflows_pct_gdp;

function assertUnavailable(result, reason, transform) {
  assert.equal(result.computable, false);
  assert.equal(result.value, null);
  assert.equal(result.reason, reason);
  assert.ok(result.description, 'unavailable results explain why');
  if (transform) assert.equal(result.transform, transform);
  assert.equal(result.provenance.kind, 'APP_DERIVED');
}

function assertAvailable(result, value, transform) {
  assert.equal(result.computable, true);
  assert.equal(result.reason, null);
  assert.ok(Math.abs(result.value - value) < 1e-9, `expected ${value}, got ${result.value}`);
  if (transform) assert.equal(result.transform, transform);
  assert.equal(result.provenance.kind, 'APP_DERIVED');
  assert.ok(result.provenance.formula, 'provenance carries the formula');
}

test('Phase 3.1: ABSOLUTE_CHANGE is B - A with raw precision', () => {
  assertAvailable(absoluteChange({ a: 100, b: 120 }, GDP), 20, 'ABSOLUTE');
  // Zero is a legitimate result, never confused with missingness.
  const zero = absoluteChange({ a: 50, b: 50 }, GDP);
  assertAvailable(zero, 0, 'ABSOLUTE');
  assertAvailable(absoluteChange({ a: 0.1, b: 0.3 }, GDP), 0.2, 'ABSOLUTE');
  assertAvailable(absoluteChange({ a: -5, b: 5 }, FDI_FLOW), 10, 'ABSOLUTE');
  assertUnavailable(absoluteChange({ a: null, b: 5 }, GDP), 'missing_base_value', 'ABSOLUTE');
  assertUnavailable(absoluteChange({ a: 5, b: undefined }, GDP), 'missing_current_value', 'ABSOLUTE');
  assertUnavailable(absoluteChange({ a: null, b: null }, GDP), 'both_values_missing', 'ABSOLUTE');
  assertUnavailable(absoluteChange({ a: NaN, b: 5 }, GDP), 'non_finite_value', 'ABSOLUTE');
  assertUnavailable(absoluteChange({ a: 5, b: Infinity }, GDP), 'non_finite_value', 'ABSOLUTE');
  assert.equal(absoluteChange({ a: 100, b: 120 }, GDP).unit, 'current US$');
});

test('Phase 3.2: PERCENT_CHANGE validity (zero/negative/sign-change refuse)', () => {
  assertAvailable(percentChange({ a: 100, b: 120 }, GDP), 20, 'PERCENT');
  // Equal positive values: 0% is valid.
  assertAvailable(percentChange({ a: 100, b: 100 }, GDP), 0, 'PERCENT');
  // Current value zero: -100% is defined (matches the legacy engine).
  assertAvailable(percentChange({ a: 100, b: 0 }, GDP), -100, 'PERCENT');
  assertUnavailable(percentChange({ a: 0, b: 50 }, GDP), 'zero_base_for_percent_change', 'PERCENT');
  assertUnavailable(percentChange({ a: 0, b: 0 }, GDP), 'zero_base_for_percent_change', 'PERCENT');
  assertUnavailable(percentChange({ a: -50, b: 50 }, FDI_FLOW), 'negative_base_for_percent_change', 'PERCENT');
  assertUnavailable(percentChange({ a: -50, b: -25 }, FDI_FLOW), 'negative_base_for_percent_change', 'PERCENT');
  // Sign change is refused even though it is numerically computable.
  assertUnavailable(percentChange({ a: 100, b: -20 }, FDI_FLOW), 'sign_change_across_endpoints', 'PERCENT');
  assertUnavailable(percentChange({ a: null, b: 5 }, GDP), 'missing_base_value', 'PERCENT');
  assertUnavailable(percentChange({ a: 5, b: null }, GDP), 'missing_current_value', 'PERCENT');
  assertUnavailable(percentChange({ a: 5, b: NaN }, GDP), 'non_finite_value', 'PERCENT');
  assert.equal(percentChange({ a: 100, b: 120 }, GDP).unit, '%');
});

test('Phase 3.3: PERCENT_CHANGE delegates numerics to the proven YoY engine', () => {
  const battery = [
    [2702.47987141553, 2500.111],
    [3956067115771.63, 3600000000000],
    [100, 100],
    [100, 0],
    [0.5, 0.75],
    [1e12, 1.2e12],
  ];
  for (const [a, b] of battery) {
    const generic = percentChange({ a, b }, GDP);
    const legacy = computeYoy({ current: b, previous: a });
    assert.equal(generic.computable, legacy.computable);
    assert.equal(generic.value, legacy.yoyPercent);
  }
  // buildYoySeries agreement on a multi-year GDP series.
  const series = buildYoySeries(
    [2019, 2020, 2021].map((year, i) => ({ year, value: [2500, 2600, 2575][i] })),
    2020,
    2021,
  );
  for (const entry of series) {
    const generic = percentChange({ a: entry.previousValue, b: entry.value }, GDP);
    assert.equal(generic.value, entry.yoyPercent);
  }
});

test('Phase 3.4: PP_CHANGE is B - A for rates, never relative percent', () => {
  // The canonical regression: 6% -> 3% is -3 pp, not -50%.
  const down = percentagePointChange({ a: 6, b: 3 }, CPI);
  assertAvailable(down, -3, 'PP');
  assert.equal(down.unit, 'percentage points');
  assertAvailable(percentagePointChange({ a: 3, b: 6 }, CPI), 3, 'PP');
  // Zero pp change is valid; negative (deflation) rates are fine.
  assertAvailable(percentagePointChange({ a: 4, b: 4 }, CPI), 0, 'PP');
  assertAvailable(percentagePointChange({ a: -1, b: -2.5 }, CPI), -1.5, 'PP');
  assertAvailable(percentagePointChange({ a: 2.5, b: 2.5 }, FDI_RATIO), 0, 'PP');
  assertUnavailable(percentagePointChange({ a: null, b: 3 }, CPI), 'missing_base_value', 'PP');
  assertUnavailable(percentagePointChange({ a: 3, b: null }, CPI), 'missing_current_value', 'PP');
  // And the contrast the architecture exists to enforce:
  assertAvailable(percentChange({ a: 6, b: 3 }, GDP), -50, 'PERCENT');
});

test('Phase 3.5: INDEX_POINT_CHANGE is distinct from PP_CHANGE', () => {
  const move = indexPointChange({ a: 105, b: 110 }, CPI_INDEX);
  assertAvailable(move, 5, 'INDEX_POINT');
  assert.equal(move.unit, 'index points');
  assert.ok(!/percentage/i.test(move.unit), 'index points are never percentage points');
  assertAvailable(indexPointChange({ a: 110, b: 110 }, CPI_INDEX), 0, 'INDEX_POINT');
  assertUnavailable(indexPointChange({ a: null, b: 110 }, CPI_INDEX), 'missing_base_value', 'INDEX_POINT');
  assertUnavailable(indexPointChange({ a: 105, b: NaN }, CPI_INDEX), 'non_finite_value', 'INDEX_POINT');
});

test('Phase 3.6: CAGR formula and invalid domains', () => {
  // 100 in 2004 -> 200 in 2014: ((200/100)^(1/10)-1)*100.
  const expected = (Math.pow(200 / 100, 1 / 10) - 1) * 100;
  const growth = cagr({ a: 100, b: 200, years: 10 }, GDP);
  assertAvailable(growth, expected, 'CAGR');
  assert.ok(Math.abs(expected - 7.177346253629313) < 1e-9);
  assert.equal(growth.unit, '%');
  assertAvailable(cagr({ a: 100, b: 100, years: 5 }, GDP), 0, 'CAGR');
  assertUnavailable(cagr({ a: 100, b: 200, years: 0 }, GDP), 'invalid_year_interval', 'CAGR');
  assertUnavailable(cagr({ a: 100, b: 200, years: -3 }, GDP), 'invalid_year_interval', 'CAGR');
  assertUnavailable(cagr({ a: 100, b: 200, years: NaN }, GDP), 'invalid_year_interval', 'CAGR');
  assertUnavailable(cagr({ a: 0, b: 200, years: 10 }, GDP), 'zero_base_for_percent_change', 'CAGR');
  assertUnavailable(cagr({ a: -100, b: 200, years: 10 }, FDI_FLOW), 'negative_base_for_percent_change', 'CAGR');
  assertUnavailable(cagr({ a: 100, b: -50, years: 10 }, FDI_FLOW), 'sign_change_across_endpoints', 'CAGR');
  assertUnavailable(cagr({ a: null, b: 200, years: 10 }, GDP), 'missing_base_value', 'CAGR');
  assertUnavailable(cagr({ a: 100, b: null, years: 10 }, GDP), 'missing_current_value', 'CAGR');
  assertUnavailable(cagr({ a: 100, b: Infinity, years: 10 }, GDP), 'non_finite_value', 'CAGR');
});

test('Phase 3.7: capability gating is metadata-driven (no metric-name branches)', () => {
  // GDP: point changes + CAGR allowed; rate/index/group/cross denied.
  for (const t of ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']) {
    assert.deepEqual(canTransform(GDP, t), { allowed: true, reason: null }, `GDP ${t}`);
  }
  for (const t of ['PP', 'INDEX_POINT', 'GROUP_SUM', 'GROUP_RATIO_FROM_SUMS', 'CROSS_RATE']) {
    assert.deepEqual(canTransform(GDP, t), { allowed: false, reason: 'unsupported_transformation_for_metric' }, `GDP ${t}`);
  }
  // Inflation rate: ABSOLUTE + PP only.
  assert.deepEqual(canTransform(CPI, 'PP'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(CPI, 'ABSOLUTE'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(CPI, 'PERCENT'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(CPI, 'YOY'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(CPI, 'CAGR'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(CPI, 'INDEX_POINT'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  // CPI index: INDEX_POINT, never PP.
  assert.deepEqual(canTransform(CPI_INDEX, 'INDEX_POINT'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(CPI_INDEX, 'PP'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  // FX: ABSOLUTE + PERCENT + CROSS_RATE (quotation); no groups, no PP.
  assert.deepEqual(canTransform(FX, 'CROSS_RATE'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(FX, 'PERCENT'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(FX, 'GROUP_SUM'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(FX, 'PP'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  // Additive flows: GROUP_SUM via SUM aggregation; per-capita refused.
  assert.deepEqual(canTransform(EXPORTS, 'GROUP_SUM'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(GDP_TOTAL, 'GROUP_SUM'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(GDP, 'GROUP_SUM'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(CPI, 'GROUP_SUM'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  // Ratios recompute from legs; plain sums of percentages are refused.
  assert.deepEqual(canTransform(FDI_RATIO, 'GROUP_RATIO_FROM_SUMS'), { allowed: true, reason: null });
  assert.deepEqual(canTransform(FDI_RATIO, 'GROUP_SUM'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  assert.deepEqual(canTransform(GDP, 'GROUP_RATIO_FROM_SUMS'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
  // Missing metric and unknown transform fail closed.
  assert.deepEqual(canTransform(null, 'ABSOLUTE'), { allowed: false, reason: 'unknown_metric' });
  assert.deepEqual(canTransform({}, 'ABSOLUTE'), { allowed: false, reason: 'unknown_metric' });
  assert.deepEqual(canTransform(GDP, 'SOMETHING_ELSE'), { allowed: false, reason: 'unsupported_transformation_for_metric' });
});

test('Phase 3.8: dispatcher never falls back to another transformation', () => {
  // GDP declares no PP: the dispatcher refuses even though B - A is computable.
  const refused = computeTransform(GDP, 'PP', { a: 6, b: 3 });
  assertUnavailable(refused, 'unsupported_transformation_for_metric', 'PP');
  assert.equal(refused.provenance.metricKey, 'nominal_current');
  // Declared transforms compute through the gate.
  assertAvailable(computeTransform(GDP, 'PERCENT', { a: 100, b: 120 }), 20, 'PERCENT');
  assertAvailable(computeTransform(CPI, 'PP', { a: 6, b: 3 }), -3, 'PP');
  assertAvailable(computeTransform(CPI_INDEX, 'INDEX_POINT', { a: 105, b: 110 }), 5, 'INDEX_POINT');
  assertAvailable(computeTransform(FX, 'CROSS_RATE', { aPerUsd: 83.669, bPerUsd: 0.92 }), 83.669 / 0.92, 'CROSS_RATE');
  // YOY accepts both {current, previous} and {a, b} input shapes.
  assertAvailable(computeTransform(GDP, 'YOY', { current: 120, previous: 100 }), 20, 'YOY');
  assertAvailable(computeTransform(GDP, 'YOY', { a: 100, b: 120 }), 20, 'YOY');
  const yoy = computeTransform(GDP, 'YOY', { a: 100, b: 120 });
  assert.equal(yoy.provenance.formula, '((current / previous) - 1) * 100');
  // Unknown metric / unknown transform surface explicit reasons with provenance.
  const noMetric = computeTransform(null, 'ABSOLUTE', { a: 1, b: 2 });
  assertUnavailable(noMetric, 'unknown_metric', 'ABSOLUTE');
  const noTransform = computeTransform(GDP, 'NOPE', { a: 1, b: 2 });
  assert.equal(noTransform.computable, false);
  assert.equal(noTransform.reason, 'unsupported_transformation_for_metric');
});

test('Phase 3.9: GROUP_SUM is strict (missing members stay missing)', () => {
  assertAvailable(groupSum([1, 2, 3], GDP_TOTAL), 6, 'GROUP_SUM');
  assertAvailable(groupSum([3956067115771.63], GDP_TOTAL), 3956067115771.63, 'GROUP_SUM');
  assertUnavailable(groupSum([], GDP_TOTAL), 'empty_input_set', 'GROUP_SUM');
  assertUnavailable(groupSum([1, null, 3], GDP_TOTAL), 'both_values_missing', 'GROUP_SUM');
  assertUnavailable(groupSum([1, undefined, 3], GDP_TOTAL), 'both_values_missing', 'GROUP_SUM');
  assertUnavailable(groupSum([1, NaN, 3], GDP_TOTAL), 'non_finite_value', 'GROUP_SUM');
  assertUnavailable(groupSum([1, Infinity, 3], GDP_TOTAL), 'non_finite_value', 'GROUP_SUM');
  assertAvailable(computeTransform(GDP_TOTAL, 'GROUP_SUM', { values: [10, 20] }), 30, 'GROUP_SUM');
  assertUnavailable(computeTransform(GDP, 'GROUP_SUM', { values: [10, 20] }), 'unsupported_transformation_for_metric', 'GROUP_SUM');
});

test('Phase 3.10: GROUP_RATIO_FROM_SUMS recomputes from legs', () => {
  // FDI 27bn + 28bn over GDP 3.9tn + 3.6tn legs.
  const ratio = groupRatioFromSums({ numerators: [27e9, 28e9], denominators: [3.9e12, 3.6e12] }, FDI_RATIO);
  assertAvailable(ratio, ((55e9 / 7.5e12) * 100), 'GROUP_RATIO_FROM_SUMS');
  assertUnavailable(groupRatioFromSums({ numerators: [], denominators: [1] }, FDI_RATIO), 'empty_input_set', 'GROUP_RATIO_FROM_SUMS');
  assertUnavailable(groupRatioFromSums({ numerators: [1], denominators: [] }, FDI_RATIO), 'empty_input_set', 'GROUP_RATIO_FROM_SUMS');
  assertUnavailable(groupRatioFromSums({ numerators: [1], denominators: [0] }, FDI_RATIO), 'zero_base_for_percent_change', 'GROUP_RATIO_FROM_SUMS');
  assertUnavailable(groupRatioFromSums({ numerators: [1], denominators: [-5] }, FDI_RATIO), 'negative_base_for_percent_change', 'GROUP_RATIO_FROM_SUMS');
  assertUnavailable(groupRatioFromSums({ numerators: [1], denominators: [NaN] }, FDI_RATIO), 'non_finite_value', 'GROUP_RATIO_FROM_SUMS');
});

test('Phase 3.11: CROSS_RATE primitive (INR per EUR = INR/USD / EUR/USD)', () => {
  // Verified 2024 legs: INR 83.669/USD; synthetic EUR leg for arithmetic proof.
  assertAvailable(crossRate({ aPerUsd: 83.669, bPerUsd: 0.92 }, FX), 83.669 / 0.92, 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: null, bPerUsd: null }, FX), 'both_values_missing', 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: null, bPerUsd: 0.92 }, FX), 'missing_base_value', 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: 83.669, bPerUsd: null }, FX), 'missing_current_value', 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: 83.669, bPerUsd: 0 }, FX), 'zero_base_for_percent_change', 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: -5, bPerUsd: 0.92 }, FX), 'negative_base_for_percent_change', 'CROSS_RATE');
  assertUnavailable(crossRate({ aPerUsd: 83.669, bPerUsd: NaN }, FX), 'non_finite_value', 'CROSS_RATE');
});

test('Phase 3.12: provenance and units on every result', () => {
  const ok = computeTransform(GDP, 'PERCENT', { a: 100, b: 120 });
  assert.equal(ok.provenance.kind, 'APP_DERIVED');
  assert.equal(ok.provenance.transform, 'PERCENT');
  assert.equal(ok.provenance.metricKey, 'nominal_current');
  assert.deepEqual(ok.provenance.inputs, { a: 100, b: 120 });
  assert.equal(ok.provenance.outputUnit, '%');
  assert.equal(ok.unit, '%');
  const pp = computeTransform(CPI, 'PP', { a: 6, b: 3 });
  assert.equal(pp.unit, 'percentage points');
  assert.equal(pp.provenance.outputUnit, 'percentage points');
  const bad = computeTransform(GDP, 'PERCENT', { a: 0, b: 5 });
  assert.equal(bad.provenance.kind, 'APP_DERIVED');
  assert.equal(bad.provenance.metricKey, 'nominal_current');
  assert.deepEqual(bad.provenance.inputs, { a: 0, b: 5 });
  assert.equal(outputUnitFor(GDP, 'ABSOLUTE'), 'current US$');
  assert.equal(outputUnitFor(FX, 'ABSOLUTE'), 'local currency units per US$ (period average)');
});

test('Phase 3.13: GDP oracle regression across five frozen metrics', () => {
  const cases = [
    ['nominal_current', 2702.47987141553, 2500.0],
    ['nominal_constant', 2400.5, 2300.25],
    ['ppp_current', 11747.9160436011, 11000.0],
    ['total_current', 3956067115771.63, 3600000000000],
    ['total_constant', 3693970992045.56, 3500000000000],
  ];
  for (const [key, b, a] of cases) {
    const metric = METRICS[key];
    const legacy = computeYoy({ current: b, previous: a });
    const generic = computeTransform(metric, 'PERCENT', { a, b });
    assert.equal(generic.value, legacy.yoyPercent, `${key} percent matches legacy YoY`);
    assert.equal(generic.computable, legacy.computable, `${key} computability matches`);
    assert.equal(computeTransform(metric, 'ABSOLUTE', { a, b }).value, b - a, `${key} absolute`);
    const years = 10;
    const cagrExpected = (Math.pow(b / a, 1 / years) - 1) * 100;
    assertAvailable(computeTransform(metric, 'CAGR', { a, b, years }), cagrExpected, 'CAGR');
    // GDP metrics never declare PP/INDEX_POINT: the gate holds for all five.
    for (const t of ['PP', 'INDEX_POINT']) {
      assert.deepEqual(canTransform(metric, t), { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION }, `${key} ${t}`);
    }
  }
});

test('Phase 3.14: index-point display helper is presentation-only', () => {
  assert.equal(formatIndexPoints(5), '+5.00 index pts');
  assert.equal(formatIndexPoints(-3), '-3.00 index pts');
  assert.equal(formatIndexPoints(0), '0.00 index pts');
  assert.equal(formatIndexPoints(null), null);
  assert.equal(formatIndexPoints(NaN), null);
  // Existing formatters pinned: GDP display and pp display do not move.
  assert.equal(formatValue(2702.49, METRICS.nominal_current).formatted, '$2,702');
  assert.equal(formatPercentagePoints(-3), '-3.00 pp');
});
