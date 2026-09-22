/**
 * POINT-BREAKER TESTS (optional intermediate year for rank movement).
 *
 * Covers the eight data-integrity cases from the implementation prompt:
 *  1. no-breaker mode is identical to the two-year implementation
 *  2. three-year intersection (mandatory synthetic case)
 *  3. ranking consistency (one shared universe for all three years)
 *  4. India present in all three years (stored snapshot values)
 *  5. India missing at one selected year
 *  6. invalid breaker rejected / impossible
 *  7. adjacent years (only one valid breaker)
 *  8. swapped endpoints (breaker stays between, movements negate)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPARISON_REASONS,
  buildLevelComparison,
  buildThreeYearLevelComparison,
  verifyThreeYearComparison,
} from '../src/domain/comparison.js';
import { COMPARISON_ERROR_CODES } from '../src/services/comparisonService.js';
import { seedSnapshotDb } from './helpers/testDb.js';

const row = (iso3, value, name = iso3) => ({ iso3, name, value, valueRaw: String(value) });

let fixture = null;
async function snapshotFixture() {
  if (!fixture) fixture = await seedSnapshotDb();
  return fixture;
}
function rowsForYear(db, repository, metricKey, year) {
  const indicator = repository.getIndicatorByMetricKey(db, metricKey);
  return repository.getEligibleObservations(db, indicator.id, year);
}

// ---------------------------------------------------------------
// Test 1 — existing two-year mode unchanged (None == omitted)
// ---------------------------------------------------------------
test('Test 1: Point breaker None behaves exactly like the two-year implementation', async () => {
  const { db } = await snapshotFixture();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');

  const base = buildLevelComparisonResponse(db, {
    metricKey: 'nominal_current',
    yearA: 2004,
    yearB: 2014,
    focusIso3: 'IND',
    detail: 'full',
  });
  for (const none of [undefined, null, '', 'none', 'None', 'NONE']) {
    const candidate = buildLevelComparisonResponse(db, {
      metricKey: 'nominal_current',
      yearA: 2004,
      yearB: 2014,
      yearMid: none,
      focusIso3: 'IND',
      detail: 'full',
    });
    assert.deepEqual(candidate.universe, base.universe, `universe identical for yearMid=${String(none)}`);
    assert.deepEqual(candidate.focusMovement, base.focusMovement, `movement identical for yearMid=${String(none)}`);
    assert.equal(candidate.years.mid, undefined, 'two-year shape carries no mid year');
    assert.equal(candidate.comparison.pointBreaker, undefined, 'two-year shape carries no pointBreaker flag');
  }
  // Frozen two-year regression integers (must not drift).
  assert.deepEqual(
    [base.universe.setA, base.universe.setB, base.universe.common, base.universe.exited, base.universe.entered],
    [209, 213, 208, 1, 5],
  );
  assert.equal(base.focusMovement.fullRankA, 171);
  assert.equal(base.focusMovement.fullRankB, 172);
  assert.equal(base.verification.passed, true);
});

// ---------------------------------------------------------------
// Test 2 — three-year intersection (MANDATORY synthetic case)
// ---------------------------------------------------------------
test('Test 2: only economies present in all three years belong to COMMON_3', () => {
  const rowsA = [row('AAA', 100), row('BBB', 90), row('CCC', 80), row('IND', 70)];
  const rowsMid = [row('AAA', 100), row('CCC', 80), row('DDD', 60), row('IND', 70)];
  const rowsB = [row('AAA', 100), row('BBB', 90), row('DDD', 60), row('IND', 70)];
  // AAA: all three. BBB: A+B only. CCC: A+MID only. DDD: MID+B only.
  const result = buildThreeYearLevelComparison({ rowsA, rowsMid, rowsB, focusIso3: 'IND' });

  assert.deepEqual(result.members.common, ['AAA', 'IND']);
  assert.equal(result.totals.common, 2);
  assert.deepEqual(result.members.outsideInA, ['BBB', 'CCC']);
  assert.deepEqual(result.members.outsideInMid, ['CCC', 'DDD']);
  assert.deepEqual(result.members.outsideInB, ['BBB', 'DDD']);
  assert.equal(result.totals.a, 4);
  assert.equal(result.totals.mid, 4);
  assert.equal(result.totals.b, 4);
  // BBB (missing MID) must NOT be in the common universe even though it is in
  // the pairwise 2004∩2024-style intersection.
  assert.ok(!result.members.common.includes('BBB'));
  assert.ok(!result.members.common.includes('CCC'));
  assert.ok(!result.members.common.includes('DDD'));
  assert.equal(verifyThreeYearComparison(result).passed, true);
});

// ---------------------------------------------------------------
// Test 3 — ranking consistency (one shared universe)
// ---------------------------------------------------------------
test('Test 3: all three rankings use exactly the same universe', async () => {
  const { db, repository } = await snapshotFixture();
  const result = buildThreeYearLevelComparison({
    rowsA: rowsForYear(db, repository, 'nominal_current', 2004),
    rowsMid: rowsForYear(db, repository, 'nominal_current', 2014),
    rowsB: rowsForYear(db, repository, 'nominal_current', 2024),
    focusIso3: 'IND',
  });
  assert.deepEqual([...result.orders.commonA].sort(), [...result.members.common].sort());
  assert.deepEqual([...result.orders.commonMid].sort(), [...result.members.common].sort());
  assert.deepEqual([...result.orders.commonB].sort(), [...result.members.common].sort());
  assert.equal(result.ranks.commonA.size, result.totals.common);
  assert.equal(result.ranks.commonMid.size, result.totals.common);
  assert.equal(result.ranks.commonB.size, result.totals.common);
  assert.equal(verifyThreeYearComparison(result).passed, true);
});

// ---------------------------------------------------------------
// Test 4 — India present in all three years (stored snapshot)
// ---------------------------------------------------------------
test('Test 4: three-year snapshot values for nominal_current 2004/2014/2024', async () => {
  const { db, repository } = await snapshotFixture();
  const result = buildThreeYearLevelComparison({
    rowsA: rowsForYear(db, repository, 'nominal_current', 2004),
    rowsMid: rowsForYear(db, repository, 'nominal_current', 2014),
    rowsB: rowsForYear(db, repository, 'nominal_current', 2024),
    focusIso3: 'IND',
  });
  assert.deepEqual(
    [result.totals.a, result.totals.mid, result.totals.b, result.totals.common],
    [209, 213, 200, 197],
  );
  assert.equal(result.focus.available, true);
  assert.equal(result.focus.fullRankA, 171);
  assert.equal(result.focus.fullRankMid, 172);
  assert.equal(result.focus.fullRankB, 155);
  assert.equal(result.focus.commonRankA, 160);
  assert.equal(result.focus.commonRankMid, 159);
  assert.equal(result.focus.commonRankB, 152);
  assert.equal(result.focus.denominatorCommon, 197);
  // Segments use the same universe and add up to the overall movement.
  assert.equal(result.focus.positionNumberChangeAM, 1);
  assert.equal(result.focus.positionNumberChangeMB, -17);
  assert.equal(result.focus.positionNumberChange, -16);
  assert.equal(result.focus.commonEffectAM, -1);
  assert.equal(result.focus.commonEffectMB, -7);
  assert.equal(result.focus.commonEffect, -8);
  assert.equal(
    result.focus.positionNumberChange,
    result.focus.positionNumberChangeAM + result.focus.positionNumberChangeMB,
  );
  assert.equal(result.focus.commonEffect, result.focus.commonEffectAM + result.focus.commonEffectMB);
  assert.equal(verifyThreeYearComparison(result).passed, true);
});

// ---------------------------------------------------------------
// Test 5 — India missing at one selected year
// ---------------------------------------------------------------
test('Test 5: focus missing in the middle year yields no decomposition', () => {
  const rowsA = [row('IND', 100), row('USA', 200)];
  const rowsMid = [row('USA', 210)];
  const rowsB = [row('IND', 110), row('USA', 220)];
  const result = buildThreeYearLevelComparison({ rowsA, rowsMid, rowsB, focusIso3: 'IND' });

  assert.equal(result.focus.available, false);
  assert.equal(result.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_MID);
  assert.equal(result.focus.fullRankA, 2);
  assert.equal(result.focus.fullRankMid, null);
  assert.equal(result.focus.fullRankB, 2);
  assert.equal(result.focus.commonRankA, null);
  assert.equal(result.focus.positionNumberChange, null);
  // Sets are still reported; verification is skipped, never failed.
  assert.equal(result.totals.common, 1);
  assert.equal(verifyThreeYearComparison(result).passed, true);

  const missingTwo = buildThreeYearLevelComparison({
    rowsA: [row('USA', 200)],
    rowsMid: [row('USA', 210)],
    rowsB: [row('USA', 220)],
    focusIso3: 'IND',
  });
  assert.equal(missingTwo.focus.available, false);
  assert.equal(missingTwo.focus.reason, COMPARISON_REASONS.FOCUS_MISSING_IN_BOTH);
  assert.equal(verifyThreeYearComparison(missingTwo).passed, true);
});

// ---------------------------------------------------------------
// Test 6 — invalid breaker rejected
// ---------------------------------------------------------------
test('Test 6: breaker equal to an endpoint or outside the interval is rejected', async () => {
  const { db } = await snapshotFixture();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');
  const invalid = [
    { yearA: 2004, yearB: 2024, yearMid: 2004, label: 'breaker = start' },
    { yearA: 2004, yearB: 2024, yearMid: 2024, label: 'breaker = end' },
    { yearA: 2004, yearB: 2024, yearMid: 2003, label: 'breaker < start' },
    { yearA: 2004, yearB: 2024, yearMid: 2025, label: 'breaker > end' },
    { yearA: 2024, yearB: 2004, yearMid: 2024, label: 'swapped: breaker = endpoint' },
    { yearA: 2024, yearB: 2004, yearMid: 1999, label: 'swapped: breaker outside' },
  ];
  for (const entry of invalid) {
    assert.throws(
      () =>
        buildLevelComparisonResponse(db, {
          metricKey: 'nominal_current',
          yearA: entry.yearA,
          yearB: entry.yearB,
          yearMid: entry.yearMid,
        }),
      (error) => error.code === COMPARISON_ERROR_CODES.INVALID_BREAKER,
      entry.label,
    );
  }
});

// ---------------------------------------------------------------
// Test 7 — adjacent years (only one valid breaker)
// ---------------------------------------------------------------
test('Test 7: adjacent endpoints admit exactly one breaker year', async () => {
  const { db } = await snapshotFixture();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');
  // 2004→2006: only 2005 lies strictly between.
  const ok = buildLevelComparisonResponse(db, {
    metricKey: 'nominal_current',
    yearA: 2004,
    yearB: 2006,
    yearMid: 2005,
  });
  assert.equal(ok.comparison.available, true);
  assert.equal(ok.years.mid, 2005);
  assert.equal(ok.verification.passed, true);
  assert.equal(ok.universe.common <= Math.min(ok.universe.setA, ok.universe.setMid, ok.universe.setB), true);

  for (const bad of [2004, 2006]) {
    assert.throws(
      () =>
        buildLevelComparisonResponse(db, {
          metricKey: 'nominal_current',
          yearA: 2004,
          yearB: 2006,
          yearMid: bad,
        }),
      (error) => error.code === COMPARISON_ERROR_CODES.INVALID_BREAKER,
      `breaker ${bad} must be rejected`,
    );
  }
});

// ---------------------------------------------------------------
// Test 8 — swapped endpoints
// ---------------------------------------------------------------
test('Test 8: swapped endpoints keep the breaker between and negate movements', async () => {
  const { db } = await snapshotFixture();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');
  const forward = buildLevelComparisonResponse(db, {
    metricKey: 'nominal_current',
    yearA: 2004,
    yearB: 2024,
    yearMid: 2014,
  });
  const swapped = buildLevelComparisonResponse(db, {
    metricKey: 'nominal_current',
    yearA: 2024,
    yearB: 2004,
    yearMid: 2014,
  });
  assert.equal(forward.comparison.available, true);
  assert.equal(swapped.comparison.available, true);
  assert.deepEqual({ a: swapped.years.a, mid: swapped.years.mid, b: swapped.years.b }, { a: 2024, mid: 2014, b: 2004 });
  // Same shared universe regardless of requested direction.
  assert.equal(swapped.universe.common, forward.universe.common);
  assert.equal(swapped.focusMovement.denominatorCommon, forward.focusMovement.denominatorCommon);
  assert.deepEqual(
    [swapped.focusMovement.commonRankA, swapped.focusMovement.commonRankMid, swapped.focusMovement.commonRankB],
    [forward.focusMovement.commonRankB, forward.focusMovement.commonRankMid, forward.focusMovement.commonRankA],
  );
  // Movements negate when the direction flips (same sign convention as two-year Swap A/B).
  assert.equal(swapped.focusMovement.positionNumberChange, -forward.focusMovement.positionNumberChange);
  assert.equal(swapped.focusMovement.commonEffect, -forward.focusMovement.commonEffect);
  assert.equal(swapped.focusMovement.observedSetEffect, -forward.focusMovement.observedSetEffect);
  assert.equal(swapped.verification.passed, true);
});

// ---------------------------------------------------------------
// API contract: breaker param, three-year shape, invalid breaker 400
// ---------------------------------------------------------------
test('API: yearMid=None matches omitted param; valid breaker returns three-year shape; invalid breaker is 400', async () => {
  const { db } = await seedSnapshotDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (path) => {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json() };
    };
    const plain = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&country=IND');
    const noneParam = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&country=IND&yearMid=None');
    assert.equal(plain.status, 200);
    assert.equal(noneParam.status, 200);
    assert.deepEqual(noneParam.body.universe, plain.body.universe);
    assert.deepEqual(noneParam.body.focusMovement, plain.body.focusMovement);

    const three = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&yearMid=2014&country=IND');
    assert.equal(three.status, 200);
    assert.equal(three.body.comparison.available, true);
    assert.equal(three.body.comparison.pointBreaker.active, true);
    assert.equal(three.body.years.mid, 2014);
    assert.equal(three.body.universe.common, 197);
    assert.equal(three.body.universe.setA, 209);
    assert.equal(three.body.universe.setMid, 213);
    assert.equal(three.body.universe.setB, 200);
    assert.equal(three.body.focusMovement.commonRankA, 160);
    assert.equal(three.body.focusMovement.commonRankMid, 159);
    assert.equal(three.body.focusMovement.commonRankB, 152);
    assert.equal(three.body.verification.passed, true);

    const bad = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&yearMid=2004');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_POINT_BREAKER');

    const outside = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&yearMid=2003');
    assert.equal(outside.status, 400);
    assert.equal(outside.body.error.code, 'INVALID_POINT_BREAKER');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Two-year domain behaviour is untouched by the three-year addition.
test('Two-year domain regression: 2004->2024 integers unchanged', async () => {
  const { db, repository } = await snapshotFixture();
  const rowsA = rowsForYear(db, repository, 'nominal_current', 2004);
  const rowsB = rowsForYear(db, repository, 'nominal_current', 2024);
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });
  assert.deepEqual(result.totals, { a: 209, b: 200, common: 197, exited: 12, entered: 3 });
  assert.equal(result.focus.fullRankA, 171);
  assert.equal(result.focus.fullRankB, 155);
});
