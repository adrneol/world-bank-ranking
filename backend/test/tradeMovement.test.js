/**
 * TRADE MOVEMENT TESTS (canonical 4+4 methodology, pure domain).
 *
 * Authority: trade/tademethod.txt (§45 frozen spec). No DB, no services.
 * Hand oracles use the spec's own examples (100→300 over 10y = 11.61%;
 * 120→480 over 10y = 14.87%; 100+110+120+130=460, /4=115).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRADE_BASES,
  TRADE_BASES_BY_METRIC,
  isCagrBasis,
  rankTradeDesc,
  tradeBasesForMetric,
  tradeBasisInfo,
  tradeCagr,
  tradeEndpointChange,
  tradeLeaveOneOut,
  tradePeriodAverage,
  tradePeriodTotal,
  tradeRequiredYears,
  tradeYears,
} from '../src/domain/tradeMovement.js';

test('Trade registry exposes exactly 4 export + 4 import bases (metric-specific)', () => {
  assert.deepEqual(tradeBasesForMetric('exports_current'), [
    TRADE_BASES.EXP_ANNUAL, TRADE_BASES.EXP_CAGR, TRADE_BASES.EXP_TOTAL, TRADE_BASES.EXP_AVERAGE,
  ]);
  assert.deepEqual(tradeBasesForMetric('imports_current'), [
    TRADE_BASES.IMP_ANNUAL, TRADE_BASES.IMP_CAGR, TRADE_BASES.IMP_TOTAL, TRADE_BASES.IMP_AVERAGE,
  ]);
  assert.equal(new Set(Object.values(TRADE_BASES)).size, 8);
  assert.ok(!tradeBasesForMetric('exports_current').includes(TRADE_BASES.IMP_CAGR));
  assert.ok(!tradeBasesForMetric('imports_current').includes(TRADE_BASES.EXP_TOTAL));
});

test('All Trade bases rank descending (highest first)', () => {
  for (const b of Object.values(TRADE_BASES)) {
    assert.equal(tradeBasisInfo(b).rankDirection, 'DESC', b);
    assert.equal(tradeBasisInfo(b).rankable, true, b);
  }
});

test('Gap units: USD for levels, pp for CAGR', () => {
  assert.equal(tradeBasisInfo(TRADE_BASES.EXP_ANNUAL).gapUnit, 'current US$');
  assert.equal(tradeBasisInfo(TRADE_BASES.EXP_CAGR).gapUnit, 'percentage points');
  assert.equal(tradeBasisInfo(TRADE_BASES.EXP_TOTAL).gapUnit, 'current US$');
  assert.equal(tradeBasisInfo(TRADE_BASES.EXP_AVERAGE).gapUnit, 'current US$/year');
});

test('Inclusive years: 2004→2014 = 11 obs, 2004→2024 = 21 obs', () => {
  assert.deepEqual(tradeYears(2004, 2014).length, 11);
  assert.deepEqual(tradeYears(2004, 2014)[0], 2004);
  assert.deepEqual(tradeYears(2004, 2014)[10], 2014);
  assert.deepEqual(tradeYears(2004, 2024).length, 21);
  assert.deepEqual(tradeRequiredYears(TRADE_BASES.EXP_TOTAL, 2004, 2014).length, 11);
  assert.deepEqual(tradeRequiredYears(TRADE_BASES.EXP_CAGR, 2004, 2014), [2004, 2014]);
});

test('CAGR oracle: 100→300 over 10y ≈ 11.61% (spec §8)', () => {
  const r = tradeCagr(100, 300, 10);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - 11.61) < 0.01, `got ${r.value}`);
});

test('CAGR oracle: 120→480 over 10y ≈ 14.87% (spec §37)', () => {
  const r = tradeCagr(120, 480, 10);
  assert.ok(Math.abs(r.value - 14.87) < 0.01, `got ${r.value}`);
});

test('CAGR validity: zero/negative start excluded; end=0 valid as -100%', () => {
  assert.equal(tradeCagr(0, 300, 10).computable, false);
  assert.equal(tradeCagr(0, 300, 10).reason, 'zero_base_for_cagr');
  assert.equal(tradeCagr(-5, 300, 10).reason, 'negative_base_for_cagr');
  assert.equal(tradeCagr(null, 300, 10).reason, 'missing_endpoint');
  const z = tradeCagr(100, 0, 10);
  assert.equal(z.computable, true);
  assert.ok(Math.abs(z.value - -100) < 1e-9, `got ${z.value}`);
  assert.equal(tradeCagr(100, -5, 10).computable, false);
});

test('Period total oracle: 100+110+120+130 = 460 (spec §14)', () => {
  const vals = new Map([[2004, 100], [2005, 110], [2006, 120], [2007, 130]]);
  const r = tradePeriodTotal(vals, [2004, 2005, 2006, 2007]);
  assert.ok(Math.abs(r.value - 460) < 1e-9);
});

test('Period average oracle: 460/4 = 115 (spec §18)', () => {
  const vals = new Map([[2004, 100], [2005, 110], [2006, 120], [2007, 130]]);
  const r = tradePeriodAverage(vals, [2004, 2005, 2006, 2007]);
  assert.ok(Math.abs(r.value - 115) < 1e-9);
});

test('Missing year excludes total and average (never partial)', () => {
  const vals = new Map([[2004, 100], [2005, 110]]);
  const t = tradePeriodTotal(vals, [2004, 2005, 2006]);
  assert.equal(t.computable, false);
  assert.deepEqual(t.missingYears, [2006]);
  const a = tradePeriodAverage(vals, [2004, 2005, 2006]);
  assert.equal(a.computable, false);
});

test('Endpoint change is descriptive: 100→300 = +200% (spec §34)', () => {
  const r = tradeEndpointChange(100, 300);
  assert.ok(Math.abs(r.value - 200) < 1e-9);
});

test('DESC competition ranking: ties share, next skips (100,100,90,80 → 1,1,3,4)', () => {
  const { ranked, total } = rankTradeDesc([
    { iso3: 'A', value: 100 },
    { iso3: 'B', value: 100 },
    { iso3: 'C', value: 90 },
    { iso3: 'D', value: 80 },
  ]);
  assert.equal(total, 4);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3, 4]);
  assert.equal(ranked[0].value, 100);
});

test('DESC ranking: highest first with full precision', () => {
  const { ranked } = rankTradeDesc([
    { iso3: 'A', value: 7.431827 },
    { iso3: 'B', value: 7.432102 },
  ]);
  assert.equal(ranked[0].iso3, 'B');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test('Leave-one-out gap: 450 vs 300 avg = -150 (USD, spec §6)', () => {
  const r = tradeLeaveOneOut(
    [{ iso3: 'A', value: 100 }, { iso3: 'B', value: 200 }, { iso3: 'IND', value: 450 }, { iso3: 'C', value: 600 }],
    'IND',
  );
  assert.ok(Math.abs(r.benchmark - 300) < 1e-9, `got ${r.benchmark}`);
  assert.ok(Math.abs(r.gap - -150) < 1e-9, `got ${r.gap}`);
  assert.equal(r.peerCount, 3);
});

test('CAGR PP oracle: 8 − 11.61 = −3.61 pp (spec §11)', () => {
  const vals = [
    { iso3: 'A', value: 3 }, { iso3: 'B', value: 7 },
    { iso3: 'IND', value: 11.61 }, { iso3: 'C', value: 12 }, { iso3: 'D', value: 5 },
  ];
  const r = tradeLeaveOneOut(vals, 'IND');
  const meanOthers = (3 + 7 + 12 + 5) / 4;
  assert.ok(Math.abs(r.benchmark - meanOthers) < 1e-9);
  assert.ok(Math.abs(r.gap - (meanOthers - 11.61)) < 1e-9);
  assert.ok(r.gap < 0, 'higher CAGR than average gives negative gap');
});

test('Single-economy universe: benchmark unavailable, never fabricated', () => {
  const r = tradeLeaveOneOut([{ iso3: 'IND', value: 5 }], 'IND');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});

test('CAGR basis detection', () => {
  assert.equal(isCagrBasis(TRADE_BASES.EXP_CAGR), true);
  assert.equal(isCagrBasis(TRADE_BASES.EXP_TOTAL), false);
});
