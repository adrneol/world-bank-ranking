/**
 * GROWTH COMPARISON API TESTS (YoY % growth mode).
 *
 * Ephemeral Express app against the versioned snapshot DB. Covers the
 * read-only contract for ?mode=yoy: validation, reason codes, 200 shape with
 * verification.passed === true, growth/peer-average field presence, and the
 * level-mode backward-compatibility regression (omitted mode identical to
 * mode=level). Production numbers come only from the snapshot fixture.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedSnapshotDb } from './helpers/testDb.js';

let baseUrl = null;
let server = null;

test.before(async () => {
  const { db } = await seedSnapshotDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

function approx(actual, expected, eps = 1e-9, label = '') {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < eps,
    `${label}: expected ${actual} to approximate ${expected}`,
  );
}

test('mode omitted and mode=level return identical level responses', async () => {
  const plain = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&country=IND&detail=full');
  const explicit = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&country=IND&detail=full&mode=level');
  assert.equal(plain.status, 200);
  assert.equal(explicit.status, 200);
  // Wall-clock freshness differs between the two sequential requests; every
  // analytical field must otherwise be identical.
  for (const body of [plain.body, explicit.body]) {
    delete body.evidence.freshness.ageHours;
  }
  assert.deepEqual(explicit.body, plain.body);
  assert.equal(plain.body.comparison.mode, 'level');
});

test('invalid mode fails cleanly with INVALID_COMPARISON_MODE', async () => {
  const { status, body } = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&mode=bogus');
  assert.equal(status, 400);
  assert.equal(body.error.code, 'INVALID_COMPARISON_MODE');
});

test('two-year growth: shape, ranks, peer average and pp difference', async () => {
  const { status, body } = await get(
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&mode=yoy&country=IND&detail=full',
  );
  assert.equal(status, 200);
  assert.equal(body.comparison.available, true);
  assert.equal(body.comparison.mode, 'yoy');
  assert.equal(body.verification.passed, true);
  assert.deepEqual(body.universe.intervals, ['AB']);
  assert.ok(body.universe.common > 0);
  assert.equal(body.universe.AB.observed, body.universe.common);
  assert.equal(body.universe.AB.outside, 0);

  const ab = body.focusMovement.growth.AB;
  assert.equal(body.focusMovement.growth.AM, null);
  assert.equal(body.focusMovement.growth.MB, null);
  assert.equal(ab.available, true);
  assert.ok(Number.isFinite(ab.indiaGrowthPercent));
  assert.ok(typeof ab.indiaGrowthDisplay === 'string' && ab.indiaGrowthDisplay.endsWith('%'));
  assert.ok(Number.isFinite(ab.absoluteChange));
  assert.ok(typeof ab.absoluteDisplay === 'string' && ab.absoluteDisplay.startsWith('+'));
  assert.ok(Number.isInteger(ab.fullGrowthRank) && ab.fullGrowthRank >= 1 && ab.fullGrowthRank <= ab.denominatorObserved);
  assert.equal(ab.fullGrowthRank, ab.commonGrowthRank);
  assert.equal(ab.denominatorObserved, ab.denominatorCommon);
  // Peer average excludes India; difference is plain subtraction in pp.
  assert.equal(ab.peerCountObserved, ab.denominatorObserved - 1);
  approx(ab.vsPeerObservedPp, ab.indiaGrowthPercent - ab.peerAvgObserved, 1e-9, 'diff');
  assert.ok(ab.vsPeerObservedDisplay.endsWith('pp'));
  assert.ok(ab.peerAvgObservedDisplay.endsWith('%'));
  assert.ok(typeof ab.identityText === 'string' && ab.identityText.length > 0);

  // Every row carries per-interval growth blocks; ranks lie within denominators.
  assert.ok(body.economies.rows.length > 0);
  for (const r of body.economies.rows) {
    assert.ok(r.intervals && r.intervals.AB, 'row interval block');
    if (r.intervals.AB.valid) {
      assert.ok(r.intervals.AB.obsRank >= 1 && r.intervals.AB.obsRank <= ab.denominatorObserved, r.iso3);
    } else {
      assert.equal(r.intervals.AB.obsRank, null, r.iso3);
      assert.ok(typeof r.intervals.AB.reason === 'string', r.iso3);
    }
  }
  assert.ok(body.methodology);
  assert.ok(body.source);
  assert.ok(body.evidence);
  assert.ok(Array.isArray(body.evidence.limits) && body.evidence.limits.length > 0);
  assert.ok(body.comparisonMethodology);
});

test('three-year growth: shared universe across AM, MB and AB', async () => {
  const { status, body } = await get(
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&yearMid=2014&mode=yoy&country=IND&detail=full',
  );
  assert.equal(status, 200);
  assert.equal(body.comparison.available, true);
  assert.equal(body.comparison.mode, 'yoy');
  assert.equal(body.verification.passed, true);
  assert.deepEqual(body.universe.intervals, ['AM', 'MB', 'AB']);
  assert.deepEqual(body.years, { a: 2004, mid: 2014, b: 2024, order: 'a_is_earlier' });

  const { AM, MB, AB } = body.focusMovement.growth;
  for (const [key, iv] of [['AM', AM], ['MB', MB], ['AB', AB]]) {
    assert.equal(iv.available, true, key);
    // One shared like-for-like denominator across all three intervals.
    assert.equal(iv.denominatorCommon, body.universe.common, `${key} common denominator`);
    assert.ok(iv.commonGrowthRank >= 1 && iv.commonGrowthRank <= body.universe.common, `${key} rank bounds`);
    assert.ok(Number.isFinite(iv.indiaGrowthPercent), `${key} growth`);
    assert.ok(Number.isFinite(iv.peerAvgCommon), `${key} peer avg`);
    assert.equal(iv.peerCountCommon, body.universe.common - 1, `${key} peer count`);
    approx(iv.vsPeerCommonPp, iv.indiaGrowthPercent - iv.peerAvgCommon, 1e-9, `${key} diff`);
    assert.ok(iv.vsPeerCommonDisplay.endsWith('pp'), `${key} pp display`);
    // AB uses raw A/B values directly (compounds from AM then MB).
    if (key === 'AB') {
      approx(
        iv.indiaGrowthPercent,
        (1 + AM.indiaGrowthPercent / 100) * (1 + MB.indiaGrowthPercent / 100) * 100 - 100,
        1e-6,
        'AB compounds from AM and MB intermediate values',
      );
    }
  }
  // No inter-interval rank deltas anywhere in the response.
  const serialized = JSON.stringify(body.focusMovement);
  assert.ok(!serialized.includes('positionNumberChange'), 'no rank deltas in growth mode');
});

test('growth mode works for all four metrics with verified responses', async () => {
  for (const indicator of ['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant']) {
    const { status, body } = await get(
      `/api/comparison/level?indicator=${indicator}&yearA=2004&yearB=2024&mode=yoy&country=IND`,
    );
    assert.equal(status, 200, `${indicator} status`);
    assert.equal(body.comparison.mode, 'yoy', `${indicator} mode`);
    assert.equal(body.verification.passed, true, `${indicator} verified`);
    assert.equal(body.comparison.available, true, `${indicator} available`);
    const ab = body.focusMovement.growth.AB;
    assert.ok(Number.isFinite(ab.indiaGrowthPercent), `${indicator} growth`);
    assert.ok(ab.fullGrowthRank >= 1 && ab.fullGrowthRank <= ab.denominatorObserved, `${indicator} bounds`);
  }
});

test('growth mode validation mirrors level mode', async () => {
  const same = await get('/api/comparison/level?indicator=nominal_current&yearA=2014&yearB=2014&mode=yoy');
  assert.equal(same.status, 400);
  const badMid = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2024&yearMid=2004&mode=yoy');
  assert.equal(badMid.status, 400);
  assert.equal(badMid.body.error.code, 'INVALID_POINT_BREAKER');
  const noData = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=1990&mode=yoy');
  assert.equal(noData.status, 200);
  assert.equal(noData.body.comparison.available, false);
  assert.equal(noData.body.comparison.reason, 'no_stored_observations_for_metric_and_year');
});
