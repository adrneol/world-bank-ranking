/**
 * YoY ENGINE TESTS (specification sections 9, 13).
 *
 * Formula: ((current / previous) - 1) * 100, always on raw values. A missing or
 * non-positive base yields null with an explicit reason - NEVER a 0% change and
 * never a silent zero.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { YOY_NA_REASONS, buildYoySeries, computeYoy, computeYoyFromMap } from '../src/domain/yoy.js';

test('the formula is ((current / previous) - 1) * 100 on raw values', () => {
  const result = computeYoy({ current: 800.125, previous: 700.75 });
  assert.equal(result.yoyPercent, ((800.125 / 700.75) - 1) * 100);
  assert.equal(result.computable, true);
  assert.equal(result.reason, null);
});

test('a decreasing value yields a negative percentage, not an absolute difference', () => {
  const result = computeYoy({ current: 50, previous: 100 });
  assert.equal(result.yoyPercent, -50);
});

test('missing current value yields null with a reason', () => {
  const result = computeYoy({ current: null, previous: 100 });
  assert.equal(result.yoyPercent, null);
  assert.equal(result.reason, YOY_NA_REASONS.CURRENT_MISSING);
  assert.equal(result.computable, false);
  assert.ok(result.description.length > 0);
});

test('missing previous value yields null with a reason', () => {
  const result = computeYoy({ current: 100, previous: undefined });
  assert.equal(result.yoyPercent, null);
  assert.equal(result.reason, YOY_NA_REASONS.PREVIOUS_MISSING);
});

test('both years missing is reported distinctly', () => {
  const result = computeYoy({ current: null, previous: null });
  assert.equal(result.yoyPercent, null);
  assert.equal(result.reason, YOY_NA_REASONS.BOTH_MISSING);
});

test('a zero or negative base never produces a percentage', () => {
  const zeroBase = computeYoy({ current: 5, previous: 0 });
  assert.equal(zeroBase.yoyPercent, null);
  assert.equal(zeroBase.reason, YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);

  const negativeBase = computeYoy({ current: 5, previous: -10 });
  assert.equal(negativeBase.yoyPercent, null);
  assert.equal(negativeBase.reason, YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);
});

test('BOTH ZERO is null, not 0% (regression: invalid YoY must never look valid)', () => {
  const result = computeYoy({ current: 0, previous: 0 });
  assert.equal(result.yoyPercent, null, 'a zero base has no defined growth rate');
  assert.equal(result.reason, YOY_NA_REASONS.BOTH_ZERO);
  assert.equal(result.computable, false);
  assert.match(result.description, /zero base/);
});

test('no input combination returns 0 for an incalculable YoY', () => {
  const cases = [
    { current: 0, previous: 0 },
    { current: 0, previous: null },
    { current: null, previous: 0 },
    { current: 1, previous: 0 },
    { current: 1, previous: -1 },
    { current: null, previous: null },
    { current: Number.NaN, previous: 1 },
    { current: 1, previous: Number.POSITIVE_INFINITY },
  ];
  for (const input of cases) {
    const result = computeYoy(input);
    assert.equal(result.yoyPercent, null, `expected null for ${JSON.stringify(input)}`);
    assert.equal(result.computable, false);
    assert.ok(result.reason, 'every incalculable case carries a reason code');
  }
});

test('a valid 0% change (equal non-zero values) is still reported as 0', () => {
  const result = computeYoy({ current: 900, previous: 900 });
  assert.equal(result.yoyPercent, 0);
  assert.equal(result.computable, true);
  assert.equal(result.reason, null);
});

test('a non-finite stored value is reported as non-finite, not as missing', () => {
  const result = computeYoy({ current: Number.NaN, previous: 100 });
  assert.equal(result.yoyPercent, null);
  assert.equal(result.reason, YOY_NA_REASONS.NON_FINITE_VALUE);
});

test('computeYoyFromMap reads a Map or a plain object keyed by year', () => {
  assert.equal(computeYoyFromMap(new Map([[2004, 100], [2005, 110]]), 2005).yoyPercent, 10.000000000000009);
  assert.equal(computeYoyFromMap({ 2004: 100, 2005: 110 }, 2005).yoyPercent, 10.000000000000009);
  assert.equal(computeYoyFromMap(new Map(), 2005).reason, YOY_NA_REASONS.BOTH_MISSING);
});

test('buildYoySeries covers the whole range and explains the first year', () => {
  const series = buildYoySeries(
    [
      { year: 2003, value: 700.75 },
      { year: 2004, value: 800.125 },
    ],
    2003,
    2005,
  );
  assert.deepEqual(series.map((entry) => entry.year), [2003, 2004, 2005]);

  assert.equal(series[0].yoyPercent, null);
  assert.equal(series[0].reason, YOY_NA_REASONS.PREVIOUS_MISSING);
  assert.equal(series[0].previousValue, null);

  assert.equal(series[1].previousValue, 700.75);
  assert.equal(series[1].yoyPercent, ((800.125 / 700.75) - 1) * 100);

  assert.equal(series[2].value, null);
  assert.equal(series[2].yoyPercent, null);
  assert.equal(series[2].reason, YOY_NA_REASONS.CURRENT_MISSING);
});

test('buildYoySeries uses raw stored precision without pre-rounding', () => {
  const series = buildYoySeries(
    [
      { year: 2024, value: 2702.47987141553 },
      { year: 2025, value: 2886.12345678901 },
    ],
    2025,
    2025,
  );
  assert.equal(series[0].previousValue, 2702.47987141553);
  assert.equal(series[0].value, 2886.12345678901);
  assert.equal(series[0].yoyPercent, ((2886.12345678901 / 2702.47987141553) - 1) * 100);
});