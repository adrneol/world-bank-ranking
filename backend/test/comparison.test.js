/**
 * RANK-MOVEMENT COMPARISON TESTS (domain + invariant sweep + oracle cross-check).
 *
 * What is proven here:
 *   * the set algebra (Common is a true intersection; Entered/Exited are true
 *     differences; the partitions |A| = |Common| + |Exited|, |B| = |Common| + |Entered|)
 *   * "above the focus economy" is decided by RANKING POSITION, not by raw value
 *     (a tie resolved by the ISO3 tie-break must not be mis-classified)
 *   * the decomposition  F_B − F_A = (K_B − K_A) + EnteredAbove_B − ExitedAbove_A
 *     holds exactly, for synthetic cases AND for every metric and every year pair
 *     of the stored World Bank vintage
 *   * the invariants are verified against an INDEPENDENT oracle implementation
 *     written differently on purpose (so a shared bug cannot hide)
 *   * verification fails closed: a tampered comparison is reported as failing
 *   * India missing in one or both years never produces a decomposition
 *   * the YoY comparison universe is the YoY pair universe, never the level one
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPARISON_REASONS,
  ECONOMY_RELATION,
  ECONOMY_STATUS,
  POSITION_EFFECT,
  buildLevelComparison,
  buildYoyComparison,
  verifyComparison,
} from '../src/domain/comparison.js';
import { buildRankVerification } from '../src/services/rankVerification.js';
import { rankByValue } from '../src/domain/ranking.js';
import { EDGE_EXPECTATIONS } from './fixtures/edgeCases.js';
import { seedEdgeCaseDb, seedSnapshotDb } from './helpers/testDb.js';

/** Row in the shape the repository returns for eligible observations. */
const row = (iso3, value, name = iso3) => ({ iso3, name, value, valueRaw: String(value) });

/**
 * INDEPENDENT ORACLE. Deliberately implemented in a different style from
 * domain/comparison.js (explicit sorted arrays, char-code comparison instead of
 * the shared comparator) so agreement is real evidence rather than a tautology.
 */
function oracle(rowsA, rowsB, focusIso3) {
  const code = (iso3) => iso3.split('').reduce((acc, ch) => acc * 256 + ch.charCodeAt(0), 0);
  const keyA = new Map(rowsA.map((r) => [r.iso3, r.value]));
  const keyB = new Map(rowsB.map((r) => [r.iso3, r.value]));
  const sortKeys = (entries) =>
    [...entries].sort((left, right) => (right[1] - left[1]) || (code(left[0]) - code(right[0])));

  const orderA = sortKeys([...keyA.entries()]).map((entry) => entry[0]);
  const orderB = sortKeys([...keyB.entries()]).map((entry) => entry[0]);
  const common = orderA.filter((iso3) => keyB.has(iso3)).sort();
  const exited = orderA.filter((iso3) => !keyB.has(iso3)).sort();
  const entered = orderB.filter((iso3) => !keyA.has(iso3)).sort();
  const commonA = sortKeys(common.map((iso3) => [iso3, keyA.get(iso3)])).map((e) => e[0]);
  const commonB = sortKeys(common.map((iso3) => [iso3, keyB.get(iso3)])).map((e) => e[0]);

  const canRank = keyA.has(focusIso3) && keyB.has(focusIso3);
  const before = (order, iso3) => order.indexOf(iso3);
  return {
    totals: { a: orderA.length, b: orderB.length, common: common.length, exited: exited.length, entered: entered.length },
    fullRankA: keyA.has(focusIso3) ? before(orderA, focusIso3) + 1 : null,
    fullRankB: keyB.has(focusIso3) ? before(orderB, focusIso3) + 1 : null,
    commonRankA: canRank ? before(commonA, focusIso3) + 1 : null,
    commonRankB: canRank ? before(commonB, focusIso3) + 1 : null,
    exitedAboveA: canRank ? exited.filter((iso3) => before(orderA, iso3) < before(orderA, focusIso3)).length : null,
    enteredAboveB: canRank ? entered.filter((iso3) => before(orderB, iso3) < before(orderB, focusIso3)).length : null,
    identity: canRank
      ? (before(orderB, focusIso3) + 1) - (before(orderA, focusIso3) + 1) ===
        ((before(commonB, focusIso3) + 1) - (before(commonA, focusIso3) + 1)) +
          entered.filter((iso3) => before(orderB, iso3) < before(orderB, focusIso3)).length -
          exited.filter((iso3) => before(orderA, iso3) < before(orderA, focusIso3)).length
      : null,
  };
}

test('set algebra: Common is the intersection, Exited/Entered are the differences', () => {
  const rowsA = [row('USA', 100), row('IND', 50), row('BRA', 40), row('TUV', 30)];
  const rowsB = [row('USA', 110), row('IND', 55), row('BRA', 45), row('PSE', 35)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.deepEqual(result.members.common, ['BRA', 'IND', 'USA']);
  assert.deepEqual(result.members.exited, ['TUV']);
  assert.deepEqual(result.members.entered, ['PSE']);
  assert.equal(result.totals.a, result.totals.common + result.totals.exited);
  assert.equal(result.totals.b, result.totals.common + result.totals.entered);

  const expected = oracle(rowsA, rowsB, 'IND');
  assert.deepEqual(result.totals, expected.totals);
  assert.equal(result.focus.fullRankA, expected.fullRankA);
  assert.equal(result.focus.fullRankB, expected.fullRankB);
  assert.equal(result.focus.commonRankA, expected.commonRankA);
  assert.equal(result.focus.commonRankB, expected.commonRankB);
  assert.equal(result.focus.exitedAboveA, expected.exitedAboveA);
  assert.equal(result.focus.enteredAboveB, expected.enteredAboveB);
  assert.equal(expected.identity, true);
  assert.equal(verifyComparison(result).passed, true);
});

test('above/below is decided by ranking position, not by raw value (ISO3 tie-break)', () => {
  // AAA and ZZZ hold EXACTLY India's value in year B. The tie-break places AAA
  // before IND and ZZZ after it, so only AAA may affect India's position.
  const rowsA = [row('IND', 100), row('USA', 200)];
  const rowsB = [row('IND', 100), row('USA', 200), row('AAA', 100), row('ZZZ', 100)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  const aaa = result.economies.find((economy) => economy.iso3 === 'AAA');
  const zzz = result.economies.find((economy) => economy.iso3 === 'ZZZ');

  assert.equal(aaa.status, ECONOMY_STATUS.ENTERED);
  assert.equal(aaa.relationToFocusB, ECONOMY_RELATION.ABOVE);
  assert.equal(aaa.affectsFocusPosition, true);
  assert.equal(aaa.positionEffect, POSITION_EFFECT.AFFECTS_POSITION);
  assert.equal(aaa.tiedWithFocusB, true);

  assert.equal(zzz.relationToFocusB, ECONOMY_RELATION.BELOW);
  assert.equal(zzz.affectsFocusPosition, false);
  assert.equal(zzz.positionEffect, POSITION_EFFECT.DENOMINATOR_ONLY);
  assert.equal(zzz.tiedWithFocusB, true);

  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankB, 3);
  assert.equal(result.focus.enteredAboveB, 1);
  assert.equal(result.focus.enteredBelowB, 1);
  assert.equal(result.focus.positionNumberChange, 1);
  assert.equal(result.focus.commonEffect, 0);
  assert.equal(result.focus.observedSetEffect, 1);
  assert.equal(result.focus.placesGained, -1);
  assert.equal(verifyComparison(result).passed, true);
});

test('an exited economy below the focus economy changes only the denominator', () => {
  const rowsA = [row('IND', 100), row('LOW', 50)];
  const rowsB = [row('IND', 100)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.deepEqual(result.members.exited, ['LOW']);
  assert.equal(result.members.entered.length, 0);
  assert.equal(result.focus.exitedAboveA, 0);
  assert.equal(result.focus.exitedBelowA, 1);
  assert.equal(result.focus.positionNumberChange, 0);
  assert.equal(result.focus.observedSetEffect, 0);
  assert.equal(result.focus.denominatorA, 2);
  assert.equal(result.focus.denominatorB, 1);
  assert.equal(
    result.economies.find((economy) => economy.iso3 === 'LOW').positionEffect,
    POSITION_EFFECT.DENOMINATOR_ONLY,
  );
  assert.equal(verifyComparison(result).passed, true);
});

test('an exited economy above the focus economy improves the position number', () => {
  const rowsA = [row('IND', 100), row('HIGH', 150)];
  const rowsB = [row('IND', 100)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankB, 1);
  assert.equal(result.focus.exitedAboveA, 1);
  assert.equal(result.focus.commonRankA, 1);
  assert.equal(result.focus.commonRankB, 1);
  assert.equal(result.focus.positionNumberChange, -1);
  assert.equal(result.focus.commonEffect, 0);
  assert.equal(result.focus.observedSetEffect, -1);
  assert.equal(result.focus.placesGained, 1);
  assert.equal(verifyComparison(result).passed, true);
});

test('focus economy missing in year A: no decomposition, sets still reported', () => {
  const rowsA = [row('USA', 100), row('BRA', 40)];
  const rowsB = [row('USA', 110), row('BRA', 45), row('IND', 55)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.equal(result.focus.available, false);
  assert.equal(result.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_A);
  assert.equal(result.focus.fullRankA, null);
  assert.equal(result.focus.fullRankB, 2);
  assert.equal(result.focus.positionNumberChange, null);
  assert.equal(result.focus.commonEffect, null);
  assert.equal(result.focus.observedSetEffect, null);
  assert.equal(result.focus.placesGained, null);
  assert.deepEqual(result.members.entered, ['IND']);
  assert.equal(result.totals.entered, 1);
  assert.equal(result.totals.exited, 0);
  assert.equal(verifyComparison(result).passed, true, 'checks are skipped, never failed');
});

test('focus economy missing in year B, and missing in both years', () => {
  const onlyB = buildLevelComparison({
    rowsA: [row('IND', 100), row('USA', 200)],
    rowsB: [row('USA', 210)],
    focusIso3: 'IND',
  });
  assert.equal(onlyB.focus.available, false);
  assert.equal(onlyB.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_B);
  assert.equal(onlyB.focus.fullRankA, 2);
  assert.equal(onlyB.focus.fullRankB, null);
  assert.equal(onlyB.focus.denominatorA, 2);
  assert.equal(onlyB.focus.denominatorB, 1);

  const neither = buildLevelComparison({
    rowsA: [row('USA', 200)],
    rowsB: [row('BRA', 210)],
    focusIso3: 'IND',
  });
  assert.equal(neither.focus.available, false);
  assert.equal(neither.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_BOTH);
  assert.equal(neither.focus.fullRankA, null);
  assert.equal(neither.focus.fullRankB, null);
  assert.equal(neither.totals.common, 0);
  assert.equal(neither.totals.exited, 1);
  assert.equal(neither.totals.entered, 1);
  assert.equal(verifyComparison(neither).passed, true);
});

test('a common universe containing only the focus economy is handled explicitly', () => {
  const result = buildLevelComparison({
    rowsA: [row('IND', 100), row('GONE', 300)],
    rowsB: [row('IND', 120), row('NEW', 300)],
    focusIso3: 'IND',
  });
  assert.equal(result.totals.common, 1);
  assert.equal(result.focus.commonRankA, 1);
  assert.equal(result.focus.commonRankB, 1);
  assert.equal(result.focus.commonEffect, 0);
  assert.equal(result.focus.exitedAboveA, 1);
  assert.equal(result.focus.enteredAboveB, 1);
  assert.equal(result.focus.observedSetEffect, 0);
  assert.equal(result.focus.positionNumberChange, 0);
  assert.equal(verifyComparison(result).passed, true);
});

test('zero and negative level values are rankable observations, never missing data', () => {
  const rowsA = [row('IND', 0), row('NEG', -5), row('POS', 10)];
  const rowsB = [row('IND', 0), row('NEG', -1), row('POS', 10)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.equal(result.totals.a, 3);
  assert.equal(result.totals.b, 3);
  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankB, 2);
  assert.equal(result.focus.positionNumberChange, 0);
  assert.equal(verifyComparison(result).passed, true);
});

test('empty inputs yield empty sets and no decomposition, but still verify', () => {
  const result = buildLevelComparison({ rowsA: [], rowsB: [], focusIso3: 'IND' });

  assert.deepEqual(result.totals, { a: 0, b: 0, common: 0, exited: 0, entered: 0 });
  assert.equal(result.focus.available, false);
  assert.equal(result.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_BOTH);
  assert.equal(result.focus.denominatorA, 0);
  assert.equal(result.focus.denominatorB, 0);
  assert.equal(result.focus.denominatorCommon, 0);
  assert.equal(verifyComparison(result).passed, true);
});

test('identical sets produce zero movement and zero observed-set effect', () => {
  const rows = [row('USA', 100), row('IND', 50), row('BRA', 40)];
  const result = buildLevelComparison({ rowsA: rows, rowsB: rows, focusIso3: 'IND' });

  assert.deepEqual(result.totals, { a: 3, b: 3, common: 3, exited: 0, entered: 0 });
  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankB, 2);
  assert.equal(result.focus.commonRankA, 2);
  assert.equal(result.focus.commonRankB, 2);
  assert.equal(result.focus.positionNumberChange, 0);
  assert.equal(result.focus.commonEffect, 0);
  assert.equal(result.focus.observedSetEffect, 0);
  assert.equal(result.focus.placesGained, 0);
  assert.equal(verifyComparison(result).passed, true);
});

test('duplicate ISO3 rows fail verification closed rather than publishing', () => {
  const rowsA = [row('USA', 100), row('IND', 50), row('IND', 50)];
  const rowsB = [row('USA', 110), row('IND', 55)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });
  const report = verifyComparison(result);

  assert.equal(report.passed, false);
  assert.ok(
    report.checks.some(
      (check) =>
        (check.check === 'members.unique_and_partitioned' ||
          check.check === 'members.disjoint' ||
          check.check === 'A.ranking_matches_engine_order') &&
        check.status === 'fail',
    ),
  );
});

test('verification fails closed when an analytic value is tampered with', () => {
  const rowsA = [row('USA', 100), row('IND', 50), row('TUV', 30)];
  const rowsB = [row('USA', 110), row('IND', 55), row('PSE', 35)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });

  assert.equal(verifyComparison(result).passed, true);

  const tampered = {
    ...result,
    focus: { ...result.focus, observedSetEffect: result.focus.observedSetEffect + 1 },
  };
  const report = verifyComparison(tampered);
  assert.equal(report.passed, false);
  assert.ok(report.checks.some((check) => check.check === 'decomposition.identity' && check.status === 'fail'));

  const wrongSets = { ...result, members: { ...result.members, common: ['IND'] } };
  const wrongReport = verifyComparison(wrongSets);
  assert.equal(wrongReport.passed, false);
  assert.ok(
    wrongReport.checks.some(
      (check) =>
        (check.check === 'common.is_exact_intersection' ||
          check.check === 'members.unique_and_partitioned') &&
        check.status === 'fail',
    ),
  );

  // TUV exited below India, so affectsFocusPosition is false. Flipping it to
  // true must fail the position-based classification check.
  const misclassified = {
    ...result,
    economies: result.economies.map((economy) =>
      economy.iso3 === 'TUV'
        ? {
            ...economy,
            affectsFocusPosition: true,
            positionEffect: POSITION_EFFECT.AFFECTS_POSITION,
            relationToFocusA: ECONOMY_RELATION.ABOVE,
          }
        : economy,
    ),
  };
  assert.equal(verifyComparison(misclassified).passed, false);
});

// ---------------------------------------------------------------
// Stored-vintage (World Bank snapshot fixture) verification
// ---------------------------------------------------------------

let fixture = null;
/** Seed once per file: the fixture holds 4 metrics × 22 years of real WDI rows. */
async function snapshotFixture() {
  if (!fixture) fixture = await seedSnapshotDb();
  return fixture;
}

/** Eligible stored rows for one metric and year, via the existing repository. */
function rowsForYear(db, repository, metricKey, year) {
  const indicator = repository.getIndicatorByMetricKey(db, metricKey);
  return repository.getEligibleObservations(db, indicator.id, year);
}

test('the seeded snapshot reproduces the stored denominators of the real vintage', async () => {
  const { db, repository } = await snapshotFixture();
  assert.equal(repository.countEligibleCountries(db), 217);

  const expected = {
    nominal_current: { 2004: 209, 2014: 213, 2024: 200 },
    nominal_constant: { 2004: 203, 2014: 210, 2024: 199 },
    ppp_current: { 2004: 195, 2014: 199, 2024: 195 },
    ppp_constant: { 2004: 193, 2014: 199, 2024: 195 },
  };
  for (const [metricKey, years] of Object.entries(expected)) {
    for (const [year, total] of Object.entries(years)) {
      const { ranked } = rankByValue(rowsForYear(db, repository, metricKey, Number(year)));
      assert.equal(ranked.length, total, `${metricKey} ${year}`);
    }
  }
});

test('report case: nominal_current 2004 to 2014 decomposes exactly', async () => {
  const { db, repository } = await snapshotFixture();
  const result = buildLevelComparison({
    rowsA: rowsForYear(db, repository, 'nominal_current', 2004),
    rowsB: rowsForYear(db, repository, 'nominal_current', 2014),
    focusIso3: 'IND',
  });

  assert.deepEqual(result.totals, { a: 209, b: 213, common: 208, exited: 1, entered: 5 });
  assert.equal(result.focus.fullRankA, 171);
  assert.equal(result.focus.fullRankB, 172);
  assert.equal(result.focus.commonRankA, 171);
  assert.equal(result.focus.commonRankB, 168);
  assert.equal(result.focus.exitedAboveA, 0);
  assert.equal(result.focus.enteredAboveB, 4);
  assert.equal(result.focus.positionNumberChange, 1);
  assert.equal(result.focus.commonEffect, -3);
  assert.equal(result.focus.observedSetEffect, 4);
  assert.equal(result.focus.placesGained, -1);
  assert.equal(verifyComparison(result).passed, true);
});

test('report case: nominal_current 2014 to 2024 decomposes exactly', async () => {
  const { db, repository } = await snapshotFixture();
  const result = buildLevelComparison({
    rowsA: rowsForYear(db, repository, 'nominal_current', 2014),
    rowsB: rowsForYear(db, repository, 'nominal_current', 2024),
    focusIso3: 'IND',
  });

  assert.deepEqual(result.totals, { a: 213, b: 200, common: 200, exited: 13, entered: 0 });
  assert.equal(result.focus.fullRankA, 172);
  assert.equal(result.focus.fullRankB, 155);
  assert.equal(result.focus.commonRankA, 162);
  assert.equal(result.focus.commonRankB, 155);
  assert.equal(result.focus.exitedAboveA, 10);
  assert.equal(result.focus.exitedBelowA, 3);
  assert.equal(result.focus.enteredAboveB, 0);
  assert.equal(result.focus.positionNumberChange, -17);
  assert.equal(result.focus.commonEffect, -7);
  assert.equal(result.focus.observedSetEffect, -10);
  assert.equal(result.focus.placesGained, 17);
  assert.equal(verifyComparison(result).passed, true);
});

test('report cases: one verified year pair for each of the four indicators', async () => {
  const { db, repository } = await snapshotFixture();
  const cases = [
    {
      metricKey: 'nominal_constant',
      yearA: 2004,
      yearB: 2014,
      totals: { a: 203, b: 210, common: 202, exited: 1, entered: 8 },
      focus: {
        fullRankA: 173,
        fullRankB: 167,
        commonRankA: 173,
        commonRankB: 160,
        exitedAboveA: 0,
        enteredAboveB: 7,
        positionNumberChange: -6,
        commonEffect: -13,
        observedSetEffect: 7,
      },
    },
    {
      metricKey: 'ppp_current',
      yearA: 2004,
      yearB: 2014,
      totals: { a: 195, b: 199, common: 192, exited: 3, entered: 7 },
      focus: {
        fullRankA: 148,
        fullRankB: 146,
        commonRankA: 146,
        commonRankB: 141,
        exitedAboveA: 2,
        enteredAboveB: 5,
        positionNumberChange: -2,
        commonEffect: -5,
        observedSetEffect: 3,
      },
    },
    {
      metricKey: 'ppp_constant',
      yearA: 2014,
      yearB: 2024,
      totals: { a: 199, b: 195, common: 195, exited: 4, entered: 0 },
      focus: {
        fullRankA: 145,
        fullRankB: 133,
        commonRankA: 142,
        commonRankB: 133,
        exitedAboveA: 3,
        enteredAboveB: 0,
        positionNumberChange: -12,
        commonEffect: -9,
        observedSetEffect: -3,
      },
    },
  ];

  for (const entry of cases) {
    const result = buildLevelComparison({
      rowsA: rowsForYear(db, repository, entry.metricKey, entry.yearA),
      rowsB: rowsForYear(db, repository, entry.metricKey, entry.yearB),
      focusIso3: 'IND',
    });
    const label = `${entry.metricKey} ${entry.yearA}-${entry.yearB}`;
    assert.deepEqual(result.totals, entry.totals, `${label} totals`);
    for (const [field, value] of Object.entries(entry.focus)) {
      assert.equal(result.focus[field], value, `${label} ${field}`);
    }
    assert.equal(verifyComparison(result).passed, true, `${label} verified`);
  }
});

test('invariant sweep: every metric and every year pair of the stored vintage reconciles', async () => {
  const { db, repository, snapshot } = await snapshotFixture();
  const { METRIC_KEYS } = await import('../src/config.js');
  const years = [];
  for (let year = snapshot.yearRange.startYear; year <= snapshot.yearRange.endYear; year += 1) {
    years.push(year);
  }

  let checked = 0;
  for (const metricKey of METRIC_KEYS) {
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    const rowsByYear = new Map(
      years.map((year) => [year, repository.getEligibleObservations(db, indicator.id, year)]),
    );

    for (const yearA of years) {
      for (const yearB of years) {
        if (yearA === yearB) continue;
        const rowsA = rowsByYear.get(yearA);
        const rowsB = rowsByYear.get(yearB);
        const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });
        const report = verifyComparison(result);
        assert.equal(
          report.passed,
          true,
          `${metricKey} ${yearA} vs ${yearB}: ${JSON.stringify(report.checks.filter((c) => c.status === 'fail'))}`,
        );

        // Independent oracle agreement (deliberately different implementation).
        const expected = oracle(rowsA, rowsB, 'IND');
        assert.deepEqual(result.totals, expected.totals, `${metricKey} ${yearA} vs ${yearB} totals`);
        if (expected.identity === true) {
          assert.equal(result.focus.available, true);
          assert.equal(result.focus.fullRankA, expected.fullRankA, `${metricKey} ${yearA} vs ${yearB}`);
          assert.equal(result.focus.fullRankB, expected.fullRankB, `${metricKey} ${yearA} vs ${yearB}`);
          assert.equal(result.focus.commonRankA, expected.commonRankA, `${metricKey} ${yearA} vs ${yearB}`);
          assert.equal(result.focus.commonRankB, expected.commonRankB, `${metricKey} ${yearA} vs ${yearB}`);
          assert.equal(result.focus.exitedAboveA, expected.exitedAboveA, `${metricKey} ${yearA} vs ${yearB}`);
          assert.equal(result.focus.enteredAboveB, expected.enteredAboveB, `${metricKey} ${yearA} vs ${yearB}`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 4 * 22 * 21, `expected a large sweep, checked ${checked}`);
});

test('full ranks agree with the existing ranking services for the same metric and year', async () => {
  const { db, repository } = await snapshotFixture();
  const checks = [
    { metricKey: 'nominal_current', year: 2004 },
    { metricKey: 'nominal_current', year: 2024 },
    { metricKey: 'ppp_constant', year: 2014 },
    { metricKey: 'nominal_constant', year: 2025 },
  ];

  for (const { metricKey, year } of checks) {
    const rows = rowsForYear(db, repository, metricKey, year);
    const engine = rankByValue(rows);
    const engineFocus = engine.ranked.find((entry) => entry.iso3 === 'IND');
    const verification = buildRankVerification(db, { metricKey, year, focusIso3: 'IND' });
    const comparison = buildLevelComparison({ rowsA: rows, rowsB: rows, focusIso3: 'IND' });

    assert.equal(comparison.focus.fullRankA, engineFocus.rank, `${metricKey} ${year} engine rank`);
    assert.equal(comparison.focus.denominatorA, engine.total, `${metricKey} ${year} engine total`);
    if (verification.focus) {
      assert.equal(comparison.focus.fullRankA, verification.focus.rank, `${metricKey} ${year} service rank`);
      assert.equal(comparison.focus.denominatorA, verification.focus.total, `${metricKey} ${year} service total`);
    }
  }
});

// ---------------------------------------------------------------
// YoY comparison universe (strictly separate from the level universe)
// ---------------------------------------------------------------

test('YoY comparison uses the YoY pair universe, never the level universe', async () => {
  const { db, repository } = await seedEdgeCaseDb();
  // Period A ends in 2004 (2003 -> 2004); period B ends in 2005 (2004 -> 2005).
  const result = buildYoyComparison({
    currentA: rowsForYear(db, repository, 'nominal_current', 2004),
    previousA: rowsForYear(db, repository, 'nominal_current', 2003),
    currentB: rowsForYear(db, repository, 'nominal_current', 2005),
    previousB: rowsForYear(db, repository, 'nominal_current', 2004),
    focusIso3: 'IND',
  });

  // Level denominators for the same years are 7 and 6 (edge fixture).
  const level2004 = rankByValue(rowsForYear(db, repository, 'nominal_current', 2004)).total;
  const level2005 = rankByValue(rowsForYear(db, repository, 'nominal_current', 2005)).total;
  assert.equal(level2004, EDGE_EXPECTATIONS.levelDenominator[2004]);
  assert.equal(level2005, EDGE_EXPECTATIONS.levelDenominator[2005]);

  // YoY pair denominators are 3 and 5: CIV has a zero base in 2005 and the
  // economies without a 2003 observation cannot form a pair.
  assert.deepEqual(result.totals, { a: 3, b: 5, common: 3, exited: 0, entered: 2 });
  assert.notEqual(result.totals.a, level2004);
  assert.notEqual(result.totals.b, level2005);

  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankB, 1);
  assert.equal(result.focus.commonRankA, 2);
  assert.equal(result.focus.commonRankB, 1);
  assert.equal(result.focus.exitedAboveA, 0);
  assert.equal(result.focus.enteredAboveB, 0);
  assert.equal(result.focus.positionNumberChange, -1);
  assert.equal(result.focus.commonEffect, -1);
  assert.equal(result.focus.observedSetEffect, 0);
  assert.equal(verifyComparison(result).passed, true);

  // A period with no base year yields no YoY universe and no decomposition.
  const noBase = buildYoyComparison({
    currentA: rowsForYear(db, repository, 'nominal_current', 2004),
    previousA: [],
    currentB: rowsForYear(db, repository, 'nominal_current', 2005),
    previousB: rowsForYear(db, repository, 'nominal_current', 2004),
    focusIso3: 'IND',
  });
  assert.equal(noBase.totals.a, 0);
  assert.equal(noBase.focus.available, false);
  assert.equal(noBase.focus.reason, COMPARISON_REASONS.NO_YOY_PAIR_IN_A);
  assert.equal(verifyComparison(noBase).passed, true);
});

test('YoY invariant sweep: every metric and period pair of the stored vintage reconciles', async () => {
  const { db, repository, snapshot } = await snapshotFixture();
  const { METRIC_KEYS } = await import('../src/config.js');
  const periods = [];
  for (let year = snapshot.yearRange.startYear + 1; year <= snapshot.yearRange.endYear; year += 1) {
    periods.push(year);
  }

  let checked = 0;
  for (const metricKey of METRIC_KEYS) {
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    // Include the base year before the first period: period P needs rows for
    // P (current) and P-1 (previous). Mapping only `periods` would leave
    // previousA/B undefined for the earliest period.
    const allYears = [];
    for (let year = snapshot.yearRange.startYear; year <= snapshot.yearRange.endYear; year += 1) {
      allYears.push(year);
    }
    const rowsByYear = new Map(
      allYears.map((year) => [year, repository.getEligibleObservations(db, indicator.id, year)]),
    );

    for (const periodA of periods) {
      for (const periodB of periods) {
        if (periodA === periodB) continue;
        const result = buildYoyComparison({
          currentA: rowsByYear.get(periodA) ?? [],
          previousA: rowsByYear.get(periodA - 1) ?? [],
          currentB: rowsByYear.get(periodB) ?? [],
          previousB: rowsByYear.get(periodB - 1) ?? [],
          focusIso3: 'IND',
        });
        const report = verifyComparison(result);
        assert.equal(
          report.passed,
          true,
          `YoY ${metricKey} ${periodA} vs ${periodB}: ${JSON.stringify(report.checks.filter((c) => c.status === 'fail'))}`,
        );
        if (result.focus.available) {
          assert.equal(
            result.focus.positionNumberChange,
            result.focus.commonEffect + result.focus.observedSetEffect,
            `YoY ${metricKey} ${periodA} vs ${periodB} identity`,
          );
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 4 * 21 * 20, `expected a large YoY sweep, checked ${checked}`);
});
