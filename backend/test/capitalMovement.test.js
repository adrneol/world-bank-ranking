/**
 * CAPITAL FLOW MOVEMENT TESTS (canonical 3+3 methodology, pure domain).
 *
 * Authority: capitalflow/capitalflowmethod.txt. No DB, no services.
 * Oracles use the spec's own examples (10+5 over 100+200 = 5%;
 * 1.5%→2.2% = +0.7pp; ties 1,1,3).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPITAL_BASES,
  CAPITAL_BASES_BY_METRIC,
  capitalBasesForMetric,
  capitalBasisInfo,
  capitalCumulativeShare,
  capitalEndpointDiagnostic,
  capitalLeaveOneOut,
  capitalPeriodAverage,
  capitalPeriodSum,
  capitalRequiredYears,
  capitalYears,
  isRatioBasis,
  rankCapitalDesc,
} from '../src/domain/capitalMovement.js';

test('Capital registry exposes exactly 3 FDI + 3 ratio bases (diagnostics excluded)', () => {
  assert.deepEqual(capitalBasesForMetric('fdi_inflows'), [
    CAPITAL_BASES.FDI_ANNUAL, CAPITAL_BASES.FDI_CUMULATIVE, CAPITAL_BASES.FDI_AVERAGE,
  ]);
  assert.deepEqual(capitalBasesForMetric('fdi_inflows_pct_gdp'), [
    CAPITAL_BASES.RATIO_ANNUAL, CAPITAL_BASES.RATIO_AVERAGE, CAPITAL_BASES.RATIO_CUMULATIVE,
  ]);
  assert.equal(new Set(Object.values(CAPITAL_BASES)).size, 6);
  assert.ok(!capitalBasesForMetric('fdi_inflows').includes(CAPITAL_BASES.RATIO_AVERAGE));
});

test('All Capital bases rank descending (highest first)', () => {
  for (const b of Object.values(CAPITAL_BASES)) {
    assert.equal(capitalBasisInfo(b).rankDirection, 'DESC', b);
    assert.equal(capitalBasisInfo(b).rankable, true, b);
  }
});

test('Gap units: USD for FDI, pp for ratios', () => {
  assert.equal(capitalBasisInfo(CAPITAL_BASES.FDI_ANNUAL).gapUnit, 'current US$');
  assert.equal(capitalBasisInfo(CAPITAL_BASES.FDI_AVERAGE).gapUnit, 'current US$/year');
  assert.equal(capitalBasisInfo(CAPITAL_BASES.RATIO_ANNUAL).gapUnit, 'percentage points');
  assert.equal(capitalBasisInfo(CAPITAL_BASES.RATIO_CUMULATIVE).gapUnit, 'percentage points');
});

test('Capital periods use S+1..E: 2004→2014 = 2005..2014 (10 obs)', () => {
  assert.deepEqual(capitalYears(2004, 2014), [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.deepEqual(capitalYears(2004, 2024).length, 20);
  assert.deepEqual(capitalRequiredYears(CAPITAL_BASES.FDI_CUMULATIVE, 2004, 2014).length, 10);
  assert.ok(!capitalRequiredYears(CAPITAL_BASES.FDI_CUMULATIVE, 2004, 2014).includes(2004), 'boundary year excluded');
  assert.ok(capitalRequiredYears(CAPITAL_BASES.FDI_CUMULATIVE, 2004, 2014).includes(2014), 'end year included');
});

test('Negative and zero flows are DATA (summed, never clamped)', () => {
  const vals = new Map([[2005, -5], [2006, 0], [2007, 10]]);
  const r = capitalPeriodSum(vals, [2005, 2006, 2007]);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - 5) < 1e-9, `got ${r.value}`);
});

test('Missing year excludes cumulative and average (never partial)', () => {
  const vals = new Map([[2005, 10], [2006, 5]]);
  const t = capitalPeriodSum(vals, [2005, 2006, 2007]);
  assert.equal(t.computable, false);
  assert.equal(t.reason, 'incomplete_period');
  assert.deepEqual(t.missingYears, [2007]);
  const a = capitalPeriodAverage(vals, [2005, 2006, 2007]);
  assert.equal(a.computable, false);
});

test('Average = cumulative / N (10 for a decade)', () => {
  const vals = new Map([[2005, 10], [2006, 20]]);
  const r = capitalPeriodAverage(vals, [2005, 2006]);
  assert.ok(Math.abs(r.value - 15) < 1e-9);
});

test('Cumulative share oracle: (10+5)/(100+200)*100 = 5% (spec example)', () => {
  const fdi = new Map([[1, 10], [2, 5]]);
  const gdp = new Map([[1, 100], [2, 200]]);
  const r = capitalCumulativeShare(fdi, gdp, [1, 2]);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - 5) < 1e-9, `got ${r.value}`);
});

test('Cumulative share never sums percentages (10%+2.5% would be 12.5%, correct is 5%)', () => {
  const fdi = new Map([[1, 10], [2, 5]]);
  const gdp = new Map([[1, 100], [2, 200]]);
  const r = capitalCumulativeShare(fdi, gdp, [1, 2]);
  assert.ok(Math.abs(r.value - 12.5) > 1, 'must not equal summed percentages');
});

test('Cumulative share requires BOTH legs every year', () => {
  const fdi = new Map([[2005, 10], [2006, 5]]);
  const gdp = new Map([[2005, 100]]); // 2006 missing
  const r = capitalCumulativeShare(fdi, gdp, [2005, 2006]);
  assert.equal(r.computable, false);
  assert.deepEqual(r.missingGdpYears, [2006]);
});

test('Cumulative share: zero GDP base unavailable (never divide by zero)', () => {
  const r = capitalCumulativeShare(new Map([[2005, 10]]), new Map([[2005, 0]]), [2005]);
  assert.equal(r.computable, false);
});

test('Endpoint diagnostics are unranked helpers: FDI Δ and ratio Δ', () => {
  assert.ok(Math.abs(capitalEndpointDiagnostic(100, 300).value - 200) < 1e-9);
  assert.ok(Math.abs(capitalEndpointDiagnostic(1.5, 2.2).value - 0.7) < 1e-9);
  assert.equal(capitalEndpointDiagnostic(null, 5).computable, false);
});

test('DESC competition: 100,50,10,-5,-20 rank 1..5 in order', () => {
  const { ranked } = rankCapitalDesc([
    { iso3: 'E', value: -20 }, { iso3: 'D', value: -5 }, { iso3: 'C', value: 10 },
    { iso3: 'B', value: 50 }, { iso3: 'A', value: 100 },
  ]);
  assert.deepEqual(ranked.map((r) => r.iso3), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('DESC ties share rank: 1,1,3 + full precision distinctness', () => {
  const { ranked } = rankCapitalDesc([
    { iso3: 'A', value: 10 }, { iso3: 'B', value: 10 }, { iso3: 'C', value: 5 },
  ]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3]);
  const p = rankCapitalDesc([{ iso3: 'A', value: 7.431827 }, { iso3: 'B', value: 7.432102 }]);
  assert.equal(p.ranked[0].iso3, 'B');
});

test('Capital gap = COUNTRY − BENCHMARK (positive = above)', () => {
  const r = capitalLeaveOneOut(
    [{ iso3: 'A', value: 100 }, { iso3: 'IND', value: 450 }, { iso3: 'C', value: 500 }],
    'IND',
  );
  assert.ok(Math.abs(r.benchmark - 300) < 1e-9);
  assert.ok(Math.abs(r.gap - 150) < 1e-9, `got ${r.gap}`);
  assert.ok(r.gap > 0);
  const r2 = capitalLeaveOneOut(
    [{ iso3: 'A', value: 8 }, { iso3: 'IND', value: 11.61 }, { iso3: 'C', value: 8 }],
    'IND',
  );
  assert.ok(r2.gap > 0, 'above-average ratio gives positive gap');
});

test('Single-economy universe: benchmark unavailable, never fabricated', () => {
  const r = capitalLeaveOneOut([{ iso3: 'IND', value: 5 }], 'IND');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});

test('Ratio basis detection', () => {
  assert.equal(isRatioBasis(CAPITAL_BASES.RATIO_AVERAGE), true);
  assert.equal(isRatioBasis(CAPITAL_BASES.FDI_CUMULATIVE), false);
});
