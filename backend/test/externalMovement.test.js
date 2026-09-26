/**
 * EXTERNAL SECTOR MOVEMENT TESTS (canonical 3/3/4 methodology, pure domain).
 *
 * Authority: ExternalSector/externalsector.txt. Benchmark freeze SPLIT:
 * median for raw-scale bases, mean for normalized ratios (see
 * EXTERNAL_SECTOR_BENCHMARK_DECISION.md). No DB, no services.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_BASES,
  EXTERNAL_BASES_BY_METRIC,
  caGdpRatio,
  cumulativeIntensity,
  externalBasesForMetric,
  externalBasisInfo,
  externalLeaveOneOut,
  externalPeriodAverage,
  externalPeriodSum,
  externalSequenceYears,
  median,
  rankExternalDesc,
  reserveCoverage,
  reserveStockChange,
} from '../src/domain/externalMovement.js';

test('External registry exposes exactly CA 3 / reserves 3 / remittances 4', () => {
  assert.deepEqual(externalBasesForMetric('current_account'), [
    EXTERNAL_BASES.CA_ANNUAL, EXTERNAL_BASES.CA_AVERAGE, EXTERNAL_BASES.CA_CUMULATIVE,
  ]);
  assert.deepEqual(externalBasesForMetric('reserves_ex_gold'), [
    EXTERNAL_BASES.RES_STOCK, EXTERNAL_BASES.RES_CHANGE, EXTERNAL_BASES.RES_COVERAGE,
  ]);
  assert.deepEqual(externalBasesForMetric('remittances_received'), [
    EXTERNAL_BASES.REMIT_ANNUAL, EXTERNAL_BASES.REMIT_CUMULATIVE,
    EXTERNAL_BASES.REMIT_AVERAGE, EXTERNAL_BASES.REMIT_INTENSITY,
  ]);
  assert.equal(new Set(Object.values(EXTERNAL_BASES)).size, 10);
});

test('All External bases rank descending (higher numerical first)', () => {
  for (const b of Object.values(EXTERNAL_BASES)) {
    assert.equal(externalBasisInfo(b).rankDirection, 'DESC', b);
    assert.equal(externalBasisInfo(b).rankable, true, b);
  }
});

test('Frozen benchmark split: median raw-scale, mean normalized', () => {
  for (const b of [EXTERNAL_BASES.RES_STOCK, EXTERNAL_BASES.RES_CHANGE, EXTERNAL_BASES.REMIT_ANNUAL, EXTERNAL_BASES.REMIT_CUMULATIVE, EXTERNAL_BASES.REMIT_AVERAGE]) {
    assert.equal(externalBasisInfo(b).benchmarkType, 'median', b);
  }
  for (const b of [EXTERNAL_BASES.CA_ANNUAL, EXTERNAL_BASES.CA_AVERAGE, EXTERNAL_BASES.CA_CUMULATIVE, EXTERNAL_BASES.REMIT_INTENSITY, EXTERNAL_BASES.RES_COVERAGE]) {
    assert.equal(externalBasisInfo(b).benchmarkType, 'mean', b);
  }
});

test('Gap units per basis (USD, USD/year, pp, months)', () => {
  assert.equal(externalBasisInfo(EXTERNAL_BASES.RES_STOCK).gapUnit, 'current US$');
  assert.equal(externalBasisInfo(EXTERNAL_BASES.REMIT_AVERAGE).gapUnit, 'current US$/year');
  assert.equal(externalBasisInfo(EXTERNAL_BASES.CA_ANNUAL).gapUnit, 'percentage points');
  assert.equal(externalBasisInfo(EXTERNAL_BASES.REMIT_INTENSITY).gapUnit, 'percentage points');
  assert.equal(externalBasisInfo(EXTERNAL_BASES.RES_CHANGE).gapUnit, 'percentage points');
  assert.equal(externalBasisInfo(EXTERNAL_BASES.RES_COVERAGE).gapUnit, 'months');
});

test('Flow sequences use S+1..E (10 obs for a decade)', () => {
  assert.deepEqual(externalSequenceYears(2004, 2014), [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.deepEqual(externalSequenceYears(2004, 2024).length, 20);
});

test('CA/GDP ratio oracle: signed ratios preserved (no abs)', () => {
  const pos = caGdpRatio(4, 100);
  assert.ok(Math.abs(pos.value - 4) < 1e-9);
  const neg = caGdpRatio(-8, 100);
  assert.ok(Math.abs(neg.value - -8) < 1e-9, 'deficit stays negative');
  assert.equal(caGdpRatio(5, 0).reason, 'non_positive_gdp_base');
  assert.equal(caGdpRatio(null, 100).reason, 'missing_leg');
});

test('CA average oracle: (−1−2−1+1+2)/5 = −0.2% (spec)', () => {
  const vals = new Map([[2021, -1], [2022, -2], [2023, -1], [2024, 1], [2025, 2]]);
  const r = externalPeriodAverage(vals, [2021, 2022, 2023, 2024, 2025]);
  assert.ok(Math.abs(r.value - -0.2) < 1e-9, `got ${r.value}`);
});

test('CA cumulative oracle: (5−4+6)/(100+200+250)*100 = 1.27% (spec)', () => {
  const ca = new Map([[2021, 5], [2022, -4], [2023, 6]]);
  const gdp = new Map([[2021, 100], [2022, 200], [2023, 250]]);
  const r = cumulativeIntensity(ca, gdp, [2021, 2022, 2023]);
  assert.ok(Math.abs(r.value - 1.2727) < 0.01, `got ${r.value}`);
});

test('Never sum percentages: cumulative ≠ summed ratios', () => {
  const ca = new Map([[1, 10], [2, 5]]);
  const gdp = new Map([[1, 100], [2, 200]]);
  const r = cumulativeIntensity(ca, gdp, [1, 2]);
  assert.ok(Math.abs(r.value - 5) < 1e-9);
  assert.ok(Math.abs(r.value - 12.5) > 1);
});

test('Cumulative intensity requires both legs every year', () => {
  const r = cumulativeIntensity(new Map([[2005, 10], [2006, 5]]), new Map([[2005, 100]]), [2005, 2006]);
  assert.equal(r.computable, false);
  assert.deepEqual(r.missingGdpYears, [2006]);
});

test('Reserve change oracle: 100→150 = +50%; 500→400 = −20% (spec)', () => {
  assert.ok(Math.abs(reserveStockChange(100, 150).value - 50) < 1e-9);
  assert.ok(Math.abs(reserveStockChange(500, 400).value - -20) < 1e-9);
  assert.equal(reserveStockChange(0, 150).reason, 'non_positive_base');
});

test('Coverage oracle: 60/120*12 = 6 months; 100/600*12 = 2 (spec)', () => {
  assert.ok(Math.abs(reserveCoverage(60, 120).value - 6) < 1e-9);
  assert.ok(Math.abs(reserveCoverage(100, 600).value - 2) < 1e-9);
  assert.equal(reserveCoverage(60, 0).reason, 'non_positive_imports_base');
});

test('Remittance cumulative oracle: 20+22+24 = 66 (spec)', () => {
  const r = externalPeriodSum(new Map([[2022, 20], [2023, 22], [2024, 24]]), [2022, 2023, 2024]);
  assert.ok(Math.abs(r.value - 66) < 1e-9);
});

test('Remittance intensity oracle: 36/360*100 = 10% (spec)', () => {
  const remit = new Map([[2022, 10], [2023, 12], [2024, 14]]);
  const gdp = new Map([[2022, 100], [2023, 120], [2024, 140]]);
  const r = cumulativeIntensity(remit, gdp, [2022, 2023, 2024]);
  assert.ok(Math.abs(r.value - 10) < 1e-9, `got ${r.value}`);
});

test('Missing year excludes (never partial/zero-filled)', () => {
  const r = externalPeriodSum(new Map([[2005, 10]]), [2005, 2006]);
  assert.equal(r.computable, false);
  assert.deepEqual(r.missingYears, [2006]);
});

test('DESC competition with signed values: +6>+2>0>−3>−8', () => {
  const { ranked } = rankExternalDesc([
    { iso3: 'E', value: -8 }, { iso3: 'D', value: -3 }, { iso3: 'C', value: 0 },
    { iso3: 'B', value: 2 }, { iso3: 'A', value: 6 },
  ]);
  assert.deepEqual(ranked.map((r) => r.iso3), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('Ties share rank with skip (100,90,90,70 → 1,2,2,4)', () => {
  const { ranked } = rankExternalDesc([
    { iso3: 'A', value: 100 }, { iso3: 'B', value: 90 }, { iso3: 'C', value: 90 }, { iso3: 'D', value: 70 },
  ]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4]);
});

test('Gap = COUNTRY − BENCHMARK with frozen per-basis statistic', () => {
  const mean = externalLeaveOneOut(
    [{ iso3: 'A', value: 1 }, { iso3: 'IND', value: 5 }, { iso3: 'C', value: 9 }], 'IND', 'mean',
  );
  assert.ok(Math.abs(mean.benchmark - 5) < 1e-9);
  assert.ok(Math.abs(mean.gap - 0) < 1e-9);
  const med = externalLeaveOneOut(
    [{ iso3: 'A', value: -10 }, { iso3: 'B', value: 5 }, { iso3: 'IND', value: 18 }, { iso3: 'C', value: 8 }, { iso3: 'D', value: 12 }],
    'IND', 'median',
  );
  assert.ok(Math.abs(med.benchmark - 6.5) < 1e-9, `got ${med.benchmark}`);
  assert.ok(Math.abs(med.gap - 11.5) < 1e-9);
  assert.equal(med.method, 'median');
});

test('Median helper: odd/even/empty', () => {
  assert.ok(Math.abs(median([-10, 5, 8, 12, 1500]) - 8) < 1e-9);
  assert.ok(Math.abs(median([5, 8, 12, 1500]) - 10) < 1e-9);
  assert.equal(median([]), null);
});

test('Single-economy universe: benchmark unavailable, never fabricated', () => {
  const r = externalLeaveOneOut([{ iso3: 'IND', value: 5 }], 'IND', 'mean');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});
