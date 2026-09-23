/**
 * GROWTH COMPARISON TESTS (YoY % growth rank movement).
 *
 * Pure-domain tests with synthetic fixtures (never production data):
 * formula, absolute change, ranking + tie-break, validity rules, universes,
 * peer averages (India excluded), pp differences, decomposition, verifier.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GROWTH_REASONS,
  buildGrowthComparison,
  peerAverageGrowth,
  verifyGrowthComparison,
} from '../src/domain/growthComparison.js';
import { rankByYoy } from '../src/domain/yoyRanking.js';
import { YOY_NA_REASONS } from '../src/domain/yoy.js';

/** Level row in the shape the service feeds the domain. */
const lvl = (iso3, value, name = iso3) => ({ iso3, name, value, valueRaw: String(value) });

/** Full-precision arithmetic never rounds: compare with tolerance. */
function approx(actual, expected, eps = 1e-9) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < eps,
    `expected ${actual} to approximate ${expected}`,
  );
}

/** Spec §45 fixture: India +50%, A +20%, B +30%. */
const baseA = () => [lvl('IND', 1000, 'India'), lvl('AAA', 1000), lvl('BBB', 1000)];
const baseB = () => [lvl('IND', 1500, 'India'), lvl('AAA', 1200), lvl('BBB', 1300)];

test('formula: hand-calculated growth percentages and absolute changes', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const ab = c.intervals.AB;
  assert.equal(ab.available, true);
  approx(ab.indiaGrowthPercent, 50);
  assert.equal(ab.absoluteChange, 500);
  assert.equal(ab.startValue, 1000);
  assert.equal(ab.endValue, 1500);
  const rows = new Map(c.economies.map((e) => [e.iso3, e]));
  approx(rows.get('AAA').intervals.AB.growthPercent, 20);
  assert.equal(rows.get('AAA').intervals.AB.absoluteChange, 200);
  approx(rows.get('BBB').intervals.AB.growthPercent, 30);
  assert.equal(verifyGrowthComparison(c).passed, true);
});

test('ranking: growth DESC with ISO3 tie-break; absolute change never ranks', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const rankOf = new Map(c.economies.map((e) => [e.iso3, e.intervals.AB.obsRank]));
  // India +50% first; BBB +30% before AAA +20% even though AAA's absolute
  // change is smaller — rank follows growthPercent alone.
  assert.deepEqual([rankOf.get('IND'), rankOf.get('BBB'), rankOf.get('AAA')], [1, 2, 3]);
  assert.equal(c.intervals.AB.fullGrowthRank, 1);

  // Tie: AAA also grows +50% and sorts before IND by ISO3.
  const tied = buildGrowthComparison({
    rowsA: baseA(),
    rowsMid: null,
    rowsB: [lvl('IND', 1500, 'India'), lvl('AAA', 1500), lvl('BBB', 1300)],
    focusIso3: 'IND',
    yearA: 2004,
    yearMid: null,
    yearB: 2024,
  });
  const tiedRanks = new Map(tied.economies.map((e) => [e.iso3, e.intervals.AB.obsRank]));
  assert.deepEqual([tiedRanks.get('AAA'), tiedRanks.get('IND')], [1, 2]);
  assert.equal(tied.intervals.AB.fullGrowthRank, 2);
  assert.equal(verifyGrowthComparison(tied).passed, true);
});

test('peer average excludes India; difference is plain pp subtraction', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const ab = c.intervals.AB;
  // (20 + 30) / 2 = 25, not (50 + 20 + 30) / 3 = 33.33.
  approx(ab.peerAvgObserved, 25);
  assert.equal(ab.peerCountObserved, 2);
  approx(ab.peerAvgCommon, 25);
  assert.equal(ab.peerCountCommon, 2);
  // 50 − 25 = 25 pp (never (50−25)/25 = 100%).
  approx(ab.vsPeerObservedPp, 25);
  approx(ab.vsPeerCommonPp, 25);
  assert.equal(ab.peerAvgReasonObserved, null);
  assert.equal(ab.vsPeerReasonObserved, null);
});

test('validity: zero base, negative base and missing values are excluded with reasons', () => {
  const rowsA = [...baseA(), lvl('ZERO', 0), lvl('NEG', -100)];
  const rowsB = [...baseB(), lvl('ZERO', 500), lvl('NEG', -50), lvl('ONLYB', 700)];
  const c = buildGrowthComparison({ rowsA, rowsMid: null, rowsB, focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const byIso = new Map(c.economies.map((e) => [e.iso3, e]));
  // None of the invalid economies may hold a rank.
  for (const iso of ['ZERO', 'NEG', 'ONLYB']) {
    assert.equal(byIso.get(iso).intervals.AB.valid, false, iso);
    assert.equal(byIso.get(iso).intervals.AB.obsRank, null, iso);
    assert.equal(byIso.get(iso).intervals.AB.growthPercent, null, iso);
  }
  assert.equal(byIso.get('ZERO').intervals.AB.reason, YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);
  assert.equal(byIso.get('NEG').intervals.AB.reason, YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);
  assert.equal(byIso.get('ONLYB').intervals.AB.reason, YOY_NA_REASONS.PREVIOUS_MISSING);
  // Missing start (present only at end) and missing end both excluded.
  const missingEnd = buildGrowthComparison({
    rowsA: [...baseA(), lvl('GONE', 900)],
    rowsMid: null,
    rowsB: baseB(),
    focusIso3: 'IND',
    yearA: 2004,
    yearMid: null,
    yearB: 2024,
  });
  const gone = missingEnd.economies.find((e) => e.iso3 === 'GONE');
  assert.equal(gone.intervals.AB.valid, false);
  assert.equal(gone.intervals.AB.reason, YOY_NA_REASONS.CURRENT_MISSING);
  // Valid set untouched: still India/AAA/BBB ranked 1..3.
  assert.equal(c.totals.AB, 3);
  assert.equal(verifyGrowthComparison(c).passed, true);
  assert.equal(verifyGrowthComparison(missingEnd).passed, true);
});

test('two-year universe: single interval, observed and like-for-like coincide', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  assert.deepEqual(c.totals, { AB: 3, AM: 0, MB: 0, common: 3, outsideAB: 0, outsideAM: 0, outsideMB: 0 });
  assert.equal(c.intervals.AM, null);
  assert.equal(c.intervals.MB, null);
  const ab = c.intervals.AB;
  assert.equal(ab.denominatorObserved, ab.denominatorCommon);
  assert.equal(ab.fullGrowthRank, ab.commonGrowthRank);
  assert.equal(ab.outsideAbove, 0);
});

test('three-year U is the intersection of interval growth sets, shared by all intervals', () => {
  // AAA valid AM+MB+AB; BBB valid AB only (missing Mid); CCC valid AM only.
  const y2004 = [lvl('IND', 1000, 'India'), lvl('AAA', 1000), lvl('BBB', 1000), lvl('CCC', 1000)];
  const y2014 = [lvl('IND', 1200, 'India'), lvl('AAA', 1100), lvl('CCC', 900)];
  const y2024 = [lvl('IND', 1500, 'India'), lvl('AAA', 1300), lvl('BBB', 1400)];
  const c = buildGrowthComparison({ rowsA: y2004, rowsMid: y2014, rowsB: y2024, focusIso3: 'IND', yearA: 2004, yearMid: 2014, yearB: 2024 });
  assert.deepEqual(c.members.common, ['AAA', 'IND']);
  assert.equal(c.totals.common, 2);
  // BBB (no Mid observation) cannot join U even though it holds AB growth.
  const bbb = c.economies.find((e) => e.iso3 === 'BBB');
  assert.equal(bbb.status, 'outside');
  assert.equal(bbb.intervals.AB.valid, true);
  assert.equal(bbb.intervals.AM.valid, false);
  // AB uses raw A and B values directly: BBB (1000→1400) = +40%.
  approx(bbb.intervals.AB.growthPercent, 40);
  // Every interval's like-for-like ranking uses the identical U.
  for (const k of ['AM', 'MB', 'AB']) {
    assert.ok(c.intervals[k].available, k);
    assert.equal(c.intervals[k].denominatorCommon, 2, k);
  }
  // Per-interval partial identities hold with the shared universe.
  for (const k of ['AM', 'MB', 'AB']) {
    const iv = c.intervals[k];
    assert.equal(iv.fullGrowthRank - iv.outsideAbove, iv.commonGrowthRank, k);
  }
  assert.equal(verifyGrowthComparison(c).passed, true);
});

test('peer average null when India is the sole member; no fabricated difference', () => {
  const c = buildGrowthComparison({
    rowsA: [lvl('IND', 1000, 'India')],
    rowsMid: null,
    rowsB: [lvl('IND', 1500, 'India')],
    focusIso3: 'IND',
    yearA: 2004,
    yearMid: null,
    yearB: 2024,
  });
  const ab = c.intervals.AB;
  assert.equal(ab.available, true);
  assert.equal(ab.peerCountObserved, 0);
  assert.equal(ab.peerAvgObserved, null);
  assert.equal(ab.peerAvgReasonObserved, 'no_peer_economies_after_excluding_focus');
  assert.equal(ab.vsPeerObservedPp, null);
  assert.ok(ab.vsPeerReasonObserved !== null);
  assert.equal(verifyGrowthComparison(c).passed, true);
});

test('missing India publishes no comparison and no ranks', () => {
  const c = buildGrowthComparison({
    rowsA: [lvl('AAA', 1000)],
    rowsMid: null,
    rowsB: [lvl('AAA', 1200)],
    focusIso3: 'IND',
    yearA: 2004,
    yearMid: null,
    yearB: 2024,
  });
  const ab = c.intervals.AB;
  assert.equal(ab.available, false);
  assert.equal(ab.indiaGrowthPercent, null);
  assert.equal(ab.fullGrowthRank, null);
  assert.equal(ab.vsPeerObservedPp, null);
  // The peer average itself remains computable over the peers.
  approx(ab.peerAvgObserved, 20);
  assert.equal(ab.peerCountObserved, 1);
  assert.equal(verifyGrowthComparison(c).passed, true);
});

test('swap yields identical growth (chronological intervals)', () => {
  const fwd = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const rev = buildGrowthComparison({ rowsA: baseB(), rowsMid: null, rowsB: baseA(), focusIso3: 'IND', yearA: 2024, yearMid: null, yearB: 2004 });
  assert.equal(rev.intervals.AB.indiaGrowthPercent, fwd.intervals.AB.indiaGrowthPercent);
  assert.equal(rev.intervals.AB.startYear, 2004);
  assert.equal(rev.intervals.AB.endYear, 2024);
  assert.deepEqual(
    rev.economies.map((e) => e.intervals.AB.growthPercent),
    fwd.economies.map((e) => e.intervals.AB.growthPercent),
  );
});

test('averages cannot affect ranking: ranks recomputed from growth alone agree', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  const intervalRows = c.economies
    .filter((e) => e.intervals.AB.valid)
    .map((e) => ({
      iso3: e.iso3,
      previousValue: e.intervals.AB.startValue,
      currentValue: e.intervals.AB.endValue,
      yoyPercent: e.intervals.AB.growthPercent,
    }));
  const { ranked } = rankByYoy(intervalRows);
  for (const r of ranked) {
    const row = c.economies.find((e) => e.iso3 === r.iso3);
    assert.equal(row.intervals.AB.obsRank, r.rank, r.iso3);
  }
  // Tampering an average breaks verification (fail-closed), while the
  // rank-only recomputation above stays green: averages are downstream.
  const tampered = {
    ...c,
    intervals: { ...c.intervals, AB: { ...c.intervals.AB, peerAvgObserved: 999 } },
  };
  assert.equal(verifyGrowthComparison(tampered).passed, false);
});

test('peerAverageGrowth sums deterministically excluding focus', () => {
  const { mean, count } = peerAverageGrowth(
    [
      { iso3: 'BBB', yoyPercent: 30 },
      { iso3: 'IND', yoyPercent: 50 },
      { iso3: 'AAA', yoyPercent: 20 },
    ],
    'IND',
  );
  assert.equal(mean, 25);
  assert.equal(count, 2);
  assert.deepEqual(peerAverageGrowth([], 'IND'), { mean: null, count: 0 });
  assert.deepEqual(peerAverageGrowth([{ iso3: 'IND', yoyPercent: 50 }], 'IND'), { mean: null, count: 0 });
});

test('verifier rejects inconsistent universes and ranks', () => {
  const c = buildGrowthComparison({ rowsA: baseA(), rowsMid: null, rowsB: baseB(), focusIso3: 'IND', yearA: 2004, yearMid: null, yearB: 2024 });
  assert.equal(verifyGrowthComparison(c).passed, true);
  const badRanks = {
    ...c,
    economies: c.economies.map((e) =>
      e.iso3 === 'BBB' ? { ...e, intervals: { ...e.intervals, AB: { ...e.intervals.AB, obsRank: 99 } } } : e,
    ),
  };
  assert.equal(verifyGrowthComparison(badRanks).passed, false);
  const badDiff = {
    ...c,
    intervals: { ...c.intervals, AB: { ...c.intervals.AB, vsPeerObservedPp: 0 } },
  };
  assert.equal(verifyGrowthComparison(badDiff).passed, false);
});
