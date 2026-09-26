/**
 * EXCHANGE RATE MOVEMENT TESTS (canonical 3-basis methodology, pure domain).
 *
 * Authority: ExchangeRate/exchangerate.txt. Rank direction DESCENDING frozen
 * by the methodology owner (see EXCHANGE_RATE_RANK_DIRECTION_DECISION.md).
 * No DB, no services.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FX_BASES,
  FX_BASES_BY_METRIC,
  FX_RANK_DIRECTION,
  fxAnnualChange,
  fxBasesForMetric,
  fxBasisInfo,
  fxCagr,
  fxLeaveOneOutMedian,
  fxPeriodChange,
  median,
  rankFxDirected,
} from '../src/domain/fxMovement.js';

test('FX registry exposes exactly 3 bases (CAGR display-only, never a basis)', () => {
  assert.deepEqual(fxBasesForMetric('fx_official'), [
    FX_BASES.LEVEL, FX_BASES.ANNUAL_CHANGE, FX_BASES.PERIOD_CHANGE,
  ]);
  assert.equal(new Set(Object.values(FX_BASES)).size, 3);
  assert.equal(fxBasisInfo(FX_BASES.LEVEL).rankable, false);
  assert.equal(fxBasisInfo(FX_BASES.ANNUAL_CHANGE).rankable, true);
  assert.equal(fxBasisInfo(FX_BASES.PERIOD_CHANGE).rankable, true);
});

test('Frozen rank direction is DESCENDING', () => {
  assert.equal(FX_RANK_DIRECTION, 'DESC');
  assert.equal(fxBasisInfo(FX_BASES.ANNUAL_CHANGE).rankDirection, 'DESC');
  assert.equal(fxBasisInfo(FX_BASES.PERIOD_CHANGE).rankDirection, 'DESC');
});

test('Annual change oracle: 80→82 = +2.5% depreciation (spec)', () => {
  const r = fxAnnualChange(80, 82);
  assert.ok(Math.abs(r.value - 2.5) < 1e-9, `got ${r.value}`);
});

test('Annual change oracle: 110→105 = −4.54545% appreciation (spec)', () => {
  const r = fxAnnualChange(110, 105);
  assert.ok(Math.abs(r.value - -4.5454545) < 1e-5, `got ${r.value}`);
});

test('Period change oracle: 45→61 = +35.555…% (spec)', () => {
  const r = fxPeriodChange(45, 61);
  assert.ok(Math.abs(r.value - 35.5555556) < 1e-5, `got ${r.value}`);
});

test('Period change oracle: 2.0→1.6 = −20% appreciation (spec)', () => {
  const r = fxPeriodChange(2.0, 1.6);
  assert.ok(Math.abs(r.value - -20) < 1e-9);
});

test('CAGR display oracle: 80→100 over 10y = +25% cumulative, ≈+2.26% annualized', () => {
  const p = fxPeriodChange(80, 100);
  assert.ok(Math.abs(p.value - 25) < 1e-9);
  const c = fxCagr(80, 100, 10);
  assert.ok(Math.abs(c.value - 2.256) < 0.01, `got ${c.value}`);
});

test('Denomination invariance: 45→61 equals 4.5→6.1', () => {
  const a = fxPeriodChange(45, 61);
  const b = fxPeriodChange(4.5, 6.1);
  assert.ok(Math.abs(a.value - b.value) < 1e-9);
});

test('Missing/non-positive guards (no division by zero)', () => {
  assert.equal(fxAnnualChange(null, 82).reason, 'missing_endpoint');
  assert.equal(fxAnnualChange(80, null).reason, 'missing_endpoint');
  assert.equal(fxAnnualChange(0, 82).reason, 'non_positive_base');
  assert.equal(fxPeriodChange(45, null).reason, 'missing_endpoint');
  assert.equal(fxPeriodChange(0, 61).reason, 'non_positive_base');
});

test('Median benchmark (never mean): −10,5,8,12,1500 → median 8', () => {
  assert.ok(Math.abs(median([-10, 5, 8, 12, 1500]) - 8) < 1e-9);
  assert.ok(Math.abs(median([5, 8, 12, 1500]) - 10) < 1e-9, 'even-N average of middles');
  assert.equal(median([]), null);
});

test('Leave-one-out median excludes focus; gap = country − median', () => {
  const r = fxLeaveOneOutMedian(
    [{ iso3: 'A', value: -10 }, { iso3: 'B', value: 5 }, { iso3: 'IND', value: 18 }, { iso3: 'C', value: 8 }, { iso3: 'D', value: 12 }],
    'IND',
  );
  // others: -10,5,8,12 → median (5+8)/2 = 6.5; gap = 18 − 6.5
  assert.ok(Math.abs(r.benchmark - 6.5) < 1e-9, `got ${r.benchmark}`);
  assert.ok(Math.abs(r.gap - 11.5) < 1e-9, `got ${r.gap}`);
  assert.equal(r.peerCount, 4);
});

test('Spec gap oracle: 18 vs median 6 → +12 pp', () => {
  const r = fxLeaveOneOutMedian(
    [{ iso3: 'A', value: 2 }, { iso3: 'B', value: 6 }, { iso3: 'IND', value: 18 }, { iso3: 'C', value: 6 }, { iso3: 'D', value: 10 }],
    'IND',
  );
  // others sorted: 2,6,6,10 → median 6
  assert.ok(Math.abs(r.benchmark - 6) < 1e-9);
  assert.ok(Math.abs(r.gap - 12) < 1e-9);
});

test('DESC competition: 100,90,90,70 → 1,2,2,4 (spec structure)', () => {
  const { ranked, direction } = rankFxDirected([
    { iso3: 'A', value: 100 }, { iso3: 'B', value: 90 }, { iso3: 'C', value: 90 }, { iso3: 'D', value: 70 },
  ]);
  assert.equal(direction, 'DESC');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 2, 4]);
});

test('Full precision: close values distinctly ranked, never tied by display', () => {
  const { ranked } = rankFxDirected([{ iso3: 'A', value: 2.499999 }, { iso3: 'B', value: 2.500001 }]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  assert.equal(ranked[0].iso3, 'B');
});

test('Single-economy universe: median unavailable, never fabricated', () => {
  const r = fxLeaveOneOutMedian([{ iso3: 'IND', value: 5 }], 'IND');
  assert.equal(r.computable, false);
  assert.equal(r.reason, 'insufficient_comparison_universe');
});

test('Two-economy universe: median is the other value', () => {
  const r = fxLeaveOneOutMedian([{ iso3: 'IND', value: 5 }, { iso3: 'USA', value: 3 }], 'IND');
  assert.ok(Math.abs(r.benchmark - 3) < 1e-9);
  assert.ok(Math.abs(r.gap - 2) < 1e-9);
});
