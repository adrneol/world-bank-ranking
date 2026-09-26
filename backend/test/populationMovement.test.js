/**
 * POPULATION MOVEMENT TESTS (canonical 3-basis methodology, pure domain).
 *
 * Authority: population/pop.txt. Stock semantics: endpoints only, never
 * summed/averaged/sequenced. DESC competition, mean LOO, country−benchmark.
 * No DB, no services.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POPULATION_BASES,
  POPULATION_BASES_BY_METRIC,
  isAnnualPopulationBasis,
  populationBasesForMetric,
  populationBasisInfo,
  populationCagr,
  populationChange,
  populationGrowth,
  populationLeaveOneOut,
  rankPopulationDesc,
} from '../src/domain/populationMovement.js';

test('Population registry exposes exactly 3 bases (CAGR display-only, never a basis)', () => {
  assert.deepEqual(populationBasesForMetric('population_total'), [
    POPULATION_BASES.ANNUAL, POPULATION_BASES.CHANGE, POPULATION_BASES.GROWTH,
  ]);
  assert.equal(new Set(Object.values(POPULATION_BASES)).size, 3);
  assert.equal(populationBasisInfo(POPULATION_BASES.ANNUAL).rankable, true);
});

test('All Population bases rank descending with mean benchmark', () => {
  for (const b of Object.values(POPULATION_BASES)) {
    assert.equal(populationBasisInfo(b).rankDirection, 'DESC', b);
    assert.equal(populationBasisInfo(b).benchmarkType, 'mean', b);
  }
});

test('Gap units: people, people, pp', () => {
  assert.equal(populationBasisInfo(POPULATION_BASES.ANNUAL).gapUnit, 'people');
  assert.equal(populationBasisInfo(POPULATION_BASES.CHANGE).gapUnit, 'people');
  assert.equal(populationBasisInfo(POPULATION_BASES.GROWTH).gapUnit, 'percentage points');
});

test('Change oracle: 1.10B→1.30B = +200M (spec)', () => {
  const r = populationChange(1100000000, 1300000000);
  assert.ok(Math.abs(r.value - 200000000) < 1, `got ${r.value}`);
});

test('Growth oracle: 100M→125M = +25% (spec)', () => {
  const r = populationGrowth(100000000, 125000000);
  assert.ok(Math.abs(r.value - 25) < 1e-9, `got ${r.value}`);
});

test('CAGR display oracle: 100M→125M over 10y ≈ +2.25%/year (spec)', () => {
  const r = populationCagr(100000000, 125000000, 10);
  assert.ok(Math.abs(r.value - 2.256) < 0.01, `got ${r.value}`);
});

test('Negative change is valid data (decline ranks below)', () => {
  const r = populationChange(100, 98);
  assert.equal(r.computable, true);
  assert.ok(Math.abs(r.value - -2) < 1e-9);
  const g = populationGrowth(100, 98);
  assert.ok(Math.abs(g.value - -2) < 1e-9);
});

test('Missing/non-positive guards (no division by zero)', () => {
  assert.equal(populationChange(null, 5).reason, 'missing_endpoint');
  assert.equal(populationGrowth(100, null).reason, 'missing_endpoint');
  assert.equal(populationGrowth(0, 5).reason, 'non_positive_base');
  assert.equal(populationCagr(0, 5, 10).reason, 'non_positive_base');
});

test('DESC competition: 100,90,90,70 → 1,2,2,4 (spec)', () => {
  const { ranked } = rankPopulationDesc([
    { iso3: 'A', value: 100 }, { iso3: 'B', value: 90 }, { iso3: 'C', value: 90 }, { iso3: 'D', value: 70 },
  ]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4]);
});

test('DESC ordering: +200M > +50M > +5M > −2M (spec)', () => {
  const { ranked } = rankPopulationDesc([
    { iso3: 'D', value: -2000000 }, { iso3: 'C', value: 5000000 },
    { iso3: 'B', value: 50000000 }, { iso3: 'A', value: 200000000 },
  ]);
  assert.deepEqual(ranked.map((r) => r.iso3), ['A', 'B', 'C', 'D']);
});

test('Full precision: close values distinctly ranked', () => {
  const { ranked } = rankPopulationDesc([{ iso3: 'A', value: 100.000001 }, { iso3: 'B', value: 100.000002 }]);
  assert.equal(ranked[0].iso3, 'B');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test('Mean LOO gap = country − benchmark (India 1.46B vs 180M → +1.28B)', () => {
  const r = populationLeaveOneOut(
    [{ iso3: 'IND', value: 1460000000 }, { iso3: 'A', value: 100000000 }, { iso3: 'B', value: 260000000 }],
    'IND',
  );
  assert.ok(Math.abs(r.benchmark - 180000000) < 1, `got ${r.benchmark}`);
  assert.ok(Math.abs(r.gap - 1280000000) < 1, `got ${r.gap}`);
  assert.ok(r.gap > 0);
  assert.equal(r.peerCount, 2);
});

test('Growth gap oracle: 18 vs 10 → +8 pp (spec)', () => {
  const r = populationLeaveOneOut(
    [{ iso3: 'IND', value: 18 }, { iso3: 'A', value: 8 }, { iso3: 'B', value: 12 }],
    'IND',
  );
  assert.ok(Math.abs(r.benchmark - 10) < 1e-9);
  assert.ok(Math.abs(r.gap - 8) < 1e-9);
});

test('Single-economy universe: benchmark unavailable, never fabricated', () => {
  const r = populationLeaveOneOut([{ iso3: 'IND', value: 5 }], 'IND');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});

test('Annual basis detection', () => {
  assert.equal(isAnnualPopulationBasis(POPULATION_BASES.ANNUAL), true);
  assert.equal(isAnnualPopulationBasis(POPULATION_BASES.CHANGE), false);
});
