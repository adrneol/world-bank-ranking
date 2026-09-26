/**
 * PRICES MOVEMENT TESTS (canonical 8-basis methodology).
 *
 * Authority: prices/method-cpiindex.txt, prices/cpiInflationmethodology.txt,
 * prices/gdpDeflator.txt. Pure domain functions only (no DB).
 * Hand-verification oracles use the canonical files' India examples.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRICES_BASES,
  PRICES_BASES_BY_METRIC,
  basesForMetric,
  basisInfo,
  cpiIndexPeriodChange,
  cpiIndexPointChange,
  cumulativeInflation,
  leaveOneOutBenchmark,
  periodAverageInflation,
  rankCompetitionAsc,
  requiredYearsForPeriod,
} from '../src/domain/pricesMovement.js';

// ---------- registry: exactly 2 / 3 / 3, metric-specific ----------

test('Prices registry exposes exactly 2 CPI-index, 3 CPI-inflation, 3 deflator bases', () => {
  assert.deepEqual(basesForMetric('inflation_cpi_index'), [
    PRICES_BASES.CPI_INDEX_ANNUAL,
    PRICES_BASES.CPI_INDEX_PERIOD_CHANGE,
  ]);
  assert.deepEqual(basesForMetric('inflation_cpi'), [
    PRICES_BASES.CPI_INFLATION_ANNUAL,
    PRICES_BASES.CPI_INFLATION_AVERAGE,
    PRICES_BASES.CPI_INFLATION_CUMULATIVE,
  ]);
  assert.deepEqual(basesForMetric('inflation_deflator'), [
    PRICES_BASES.DEFLATOR_ANNUAL,
    PRICES_BASES.DEFLATOR_AVERAGE,
    PRICES_BASES.DEFLATOR_CUMULATIVE,
  ]);
  const total = new Set(Object.values(PRICES_BASES)).size;
  assert.equal(total, 8);
  // Not one shared list of 8: each metric sees only its subset.
  assert.ok(!basesForMetric('inflation_cpi_index').includes(PRICES_BASES.CPI_INFLATION_AVERAGE));
  assert.ok(!basesForMetric('inflation_cpi').includes(PRICES_BASES.CPI_INDEX_PERIOD_CHANGE));
});

test('CPI annual index basis is explicitly unranked', () => {
  assert.equal(basisInfo(PRICES_BASES.CPI_INDEX_ANNUAL).rankable, false);
  assert.equal(basisInfo(PRICES_BASES.CPI_INDEX_PERIOD_CHANGE).rankable, true);
});

// ---------- CPI Index ----------

test('CPI Index period change: India 2004→2014 ≈ +120.66% on rounded inputs', () => {
  const r = cpiIndexPeriodChange(63.4, 139.9);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - 120.66) < 0.05, `got ${r.value}`);
});

test('CPI Index period change: 2014→2024 ≈ +62.6%, 2004→2024 ≈ +259% (rounded)', () => {
  // Spec display values: ≈62.62% / ≈258.99%; recomputation from the same
  // rounded inputs gives 62.69% / 259.0% — tolerance covers display rounding.
  assert.ok(Math.abs(cpiIndexPeriodChange(139.9, 227.6).value - 62.62) < 0.15);
  assert.ok(Math.abs(cpiIndexPeriodChange(63.4, 227.6).value - 258.99) < 0.15);
});

test('CPI Index endpoint-only: required years are [S,E], never a sequence', () => {
  assert.deepEqual(requiredYearsForPeriod(PRICES_BASES.CPI_INDEX_PERIOD_CHANGE, 2004, 2014), [2004, 2014]);
});

test('CPI Index point change is descriptive (76.5 / 87.7 / 164.2)', () => {
  assert.ok(Math.abs(cpiIndexPointChange(63.4, 139.9).value - 76.5) < 1e-9);
  assert.ok(Math.abs(cpiIndexPointChange(139.9, 227.6).value - 87.7) < 1e-9);
  assert.ok(Math.abs(cpiIndexPointChange(63.4, 227.6).value - 164.2) < 1e-9);
});

test('CPI Index period change guards: missing/zero base', () => {
  assert.equal(cpiIndexPeriodChange(null, 139.9).computable, false);
  assert.equal(cpiIndexPeriodChange(0, 139.9).reason, 'zero_base');
});

// ---------- CPI Inflation intervals: S+1..E ----------

test('Inflation average requires S+1..E (2004→2014 = 2005..2014, 10 obs)', () => {
  assert.deepEqual(requiredYearsForPeriod(PRICES_BASES.CPI_INFLATION_AVERAGE, 2004, 2014), [
    2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014,
  ]);
  assert.deepEqual(requiredYearsForPeriod(PRICES_BASES.CPI_INFLATION_CUMULATIVE, 2014, 2024), [
    2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
  ]);
});

test('Inflation average: India 2004→2014 ≈ 8.27% on displayed values', () => {
  const vals = new Map([
    [2005, 4.25], [2006, 5.8], [2007, 6.37], [2008, 8.35], [2009, 10.88],
    [2010, 11.99], [2011, 8.91], [2012, 9.48], [2013, 10.02], [2014, 6.67],
  ]);
  const r = periodAverageInflation(vals, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - 8.272) < 0.005, `got ${r.value}`);
});

test('Inflation cumulative compounds (never sums): 10,0,10 → 21% not 20%', () => {
  const vals = new Map([[2005, 10], [2006, 0], [2007, 10]]);
  const cum = cumulativeInflation(vals, [2005, 2006, 2007]);
  assert.ok(Math.abs(cum.value - 21) < 1e-9, `got ${cum.value}`);
  const avg = periodAverageInflation(vals, [2005, 2006, 2007]);
  assert.ok(Math.abs(avg.value - 6.6666667) < 1e-5);
});

test('Inflation cumulative: India 2004→2014 ≈ 120.88% on displayed values', () => {
  const annual = [4.25, 5.8, 6.37, 8.35, 10.88, 11.99, 8.91, 9.48, 10.02, 6.67];
  const vals = new Map(annual.map((v, i) => [2005 + i, v]));
  const r = cumulativeInflation(vals, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.ok(Math.abs(r.value - 120.88) < 0.15, `got ${r.value}`);
});

test('Missing required year invalidates average and cumulative (never partial)', () => {
  const vals = new Map([[2005, 4], [2006, 5]]); // 2007 missing
  const a = periodAverageInflation(vals, [2005, 2006, 2007]);
  assert.equal(a.computable, false);
  assert.equal(a.reason, 'incomplete_period');
  assert.deepEqual(a.missingYears, [2007]);
  const c = cumulativeInflation(vals, [2005, 2006, 2007]);
  assert.equal(c.computable, false);
  assert.deepEqual(c.missingYears, [2007]);
});

// ---------- Deflator mirrors inflation structure ----------

test('Deflator average: India 2004→2014 ≈ 7.39% on displayed values', () => {
  const annual = [5.62, 8.4, 6.94, 9.19, 7.04, 10.53, 8.73, 7.93, 6.19, 3.33];
  const vals = new Map(annual.map((v, i) => [2005 + i, v]));
  const r = periodAverageInflation(vals, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.ok(Math.abs(r.value - 7.39) < 0.01, `got ${r.value}`);
});

test('Deflator cumulative: 5,0,10 → 15.5% (not 15%)', () => {
  const vals = new Map([[2005, 5], [2006, 0], [2007, 10]]);
  const r = cumulativeInflation(vals, [2005, 2006, 2007]);
  assert.ok(Math.abs(r.value - 15.5) < 1e-9, `got ${r.value}`);
});

test('Deflator cumulative: India 2004→2014 ≈ 103.67% on displayed values', () => {
  const annual = [5.62, 8.4, 6.94, 9.19, 7.04, 10.53, 8.73, 7.93, 6.19, 3.33];
  const vals = new Map(annual.map((v, i) => [2005 + i, v]));
  const r = cumulativeInflation(vals, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.ok(Math.abs(r.value - 103.67) < 0.3, `got ${r.value}`);
});

test('Negative annual rates compound normally (deflation)', () => {
  const vals = new Map([[2005, -2], [2006, 5]]);
  const r = cumulativeInflation(vals, [2005, 2006]);
  assert.ok(Math.abs(r.value - ((0.98 * 1.05 - 1) * 100)) < 1e-9);
});

// ---------- Ranking: competition ASC, full precision ----------

test('Competition ranking: ties share rank, next skips (1,1,3)', () => {
  const { ranked, total } = rankCompetitionAsc([
    { iso3: 'AAA', value: 0 },
    { iso3: 'BBB', value: 0 },
    { iso3: 'CCC', value: 0.5 },
    { iso3: 'DDD', value: 1 },
  ]);
  assert.equal(total, 4);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3, 4]);
  assert.equal(ranked[0].iso3, 'AAA');
});

test('Ranking is ascending (lower first) with full precision (1e-9 not a tie)', () => {
  const { ranked } = rankCompetitionAsc([
    { iso3: 'BBB', value: 5.431912 },
    { iso3: 'AAA', value: 5.431827 },
  ]);
  assert.equal(ranked[0].iso3, 'AAA');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

// ---------- Benchmark: leave-one-out, PP sign ----------

test('Leave-one-out benchmark excludes focus; PP = benchmark - focus', () => {
  const vals = [
    { iso3: 'A', value: 2 },
    { iso3: 'B', value: 3 },
    { iso3: 'C', value: 6 },
    { iso3: 'IND', value: 5 },
    { iso3: 'E', value: 7 },
  ];
  const r = leaveOneOutBenchmark(vals, 'IND');
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.benchmark - 4.5) < 1e-9);
  assert.ok(Math.abs(r.pp - -0.5) < 1e-9);
  assert.equal(r.peerCount, 4);
});

test('Positive PP means focus lower than benchmark', () => {
  const r = leaveOneOutBenchmark(
    [
      { iso3: 'A', value: 2 },
      { iso3: 'B', value: 3 },
      { iso3: 'IND', value: 4 },
      { iso3: 'C', value: 6 },
      { iso3: 'E', value: 7 },
    ],
    'IND',
  );
  assert.ok(r.pp > 0);
});

test('Benchmark with single-economy universe is unavailable (never fabricated)', () => {
  const r = leaveOneOutBenchmark([{ iso3: 'IND', value: 5 }], 'IND');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});

test('Prohibited formulas are absent: no period-total/average/annualized CPI-index basis', () => {
  assert.equal(typeof cumulativeInflation, 'function');
  // CPI Index registry has no period-total / period-average / annualized basis.
  assert.ok(!basesForMetric('inflation_cpi_index').some((b) => /total|average|annualiz/i.test(b)));
  assert.equal(PRICES_BASES_BY_METRIC.inflation_cpi_index.length, 2);
});
