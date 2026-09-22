/**
 * COMPARISON API TESTS (level mode, V1).
 *
 * Ephemeral Express app against the versioned snapshot DB. Covers the
 * read-only contract: validation, reason codes, 200 shape with
 * verification.passed === true, fail-closed behaviour, and frozen
 * regression integers from the stored vintage.
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

test('GET /api/comparison/level decomposes nominal_current 2004->2014 exactly', async () => {
  const { status, body } = await get(
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&country=IND&detail=full',
  );
  assert.equal(status, 200);
  assert.equal(body.comparison.available, true);
  assert.equal(body.comparison.mode, 'level');
  assert.equal(body.verification.passed, true);
  assert.deepEqual(
    [body.universe.setA, body.universe.setB, body.universe.common, body.universe.exited, body.universe.entered],
    [209, 213, 208, 1, 5],
  );
  const fm = body.focusMovement;
  assert.equal(fm.fullRankA, 171);
  assert.equal(fm.fullRankB, 172);
  assert.equal(fm.commonRankA, 171);
  assert.equal(fm.commonRankB, 168);
  assert.equal(fm.exitedAboveA, 0);
  assert.equal(fm.enteredAboveB, 4);
  assert.equal(fm.positionNumberChange, 1);
  assert.equal(fm.commonEffect, -3);
  assert.equal(fm.observedSetEffect, 4);
  assert.equal(fm.placesGained, -1);
  assert.equal(fm.positionNumberChange, fm.commonEffect + fm.observedSetEffect);
  assert.ok(typeof fm.identityText === 'string' && fm.identityText.length > 0);
  assert.ok(body.methodology);
  assert.ok(body.source);
  assert.ok(body.evidence);
  assert.ok(Array.isArray(body.evidence.limits) && body.evidence.limits.length > 0);
  assert.ok(body.economies.rows.length > 0);
});

test('GET /api/comparison/level frozen cases for all four metrics', async () => {
  const cases = [
    {
      indicator: 'nominal_current',
      yearA: 2014,
      yearB: 2024,
      fullRankA: 172,
      fullRankB: 155,
      positionNumberChange: -17,
      commonEffect: -7,
      observedSetEffect: -10,
    },
    {
      indicator: 'nominal_constant',
      yearA: 2004,
      yearB: 2014,
      fullRankA: 173,
      fullRankB: 167,
      positionNumberChange: -6,
      commonEffect: -13,
      observedSetEffect: 7,
    },
    {
      indicator: 'ppp_current',
      yearA: 2004,
      yearB: 2014,
      fullRankA: 148,
      fullRankB: 146,
      positionNumberChange: -2,
      commonEffect: -5,
      observedSetEffect: 3,
    },
    {
      indicator: 'ppp_constant',
      yearA: 2014,
      yearB: 2024,
      fullRankA: 145,
      fullRankB: 133,
      positionNumberChange: -12,
      commonEffect: -9,
      observedSetEffect: -3,
    },
  ];
  for (const c of cases) {
    const { status, body } = await get(
      `/api/comparison/level?indicator=${c.indicator}&yearA=${c.yearA}&yearB=${c.yearB}&country=IND`,
    );
    assert.equal(status, 200, `${c.indicator} status`);
    assert.equal(body.verification.passed, true, `${c.indicator} verified`);
    assert.equal(body.focusMovement.fullRankA, c.fullRankA, `${c.indicator} fullRankA`);
    assert.equal(body.focusMovement.fullRankB, c.fullRankB, `${c.indicator} fullRankB`);
    assert.equal(body.focusMovement.positionNumberChange, c.positionNumberChange, `${c.indicator} dF`);
    assert.equal(body.focusMovement.commonEffect, c.commonEffect, `${c.indicator} dK`);
    assert.equal(body.focusMovement.observedSetEffect, c.observedSetEffect, `${c.indicator} pool`);
  }
});

test('GET /api/comparison/level detail=summary omits common rows but keeps counts', async () => {
  const full = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&detail=full');
  const summary = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2014&detail=summary');
  assert.equal(full.status, 200);
  assert.equal(summary.status, 200);
  assert.equal(full.body.economies.totalRows, summary.body.economies.totalRows);
  assert.ok(full.body.economies.rows.length > summary.body.economies.rows.length);
  assert.ok(summary.body.economies.rows.every((r) => r.status !== 'common' || r.iso3 === 'IND'));
  assert.deepEqual(full.body.universe, summary.body.universe);
  assert.deepEqual(full.body.focusMovement, summary.body.focusMovement);
});

test('GET /api/comparison/level validation: missing indicator, same year, unknown indicator', async () => {
  const missing = await get('/api/comparison/level?yearA=2004&yearB=2014');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'INVALID_INDICATOR');

  const same = await get('/api/comparison/level?indicator=nominal_current&yearA=2014&yearB=2014');
  assert.equal(same.status, 400);
  assert.equal(same.body.error.code, 'SAME_YEAR_SELECTED');

  const unknown = await get('/api/comparison/level?indicator=nope&yearA=2004&yearB=2014');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'INVALID_INDICATOR');

  const missingYear = await get('/api/comparison/level?indicator=nominal_current&yearA=2004');
  assert.equal(missingYear.status, 400);
});

test('GET /api/comparison/level year without stored data returns available:false', async () => {
  const { status, body } = await get('/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=1990');
  assert.equal(status, 200);
  assert.equal(body.comparison.available, false);
  assert.equal(body.comparison.reason, 'no_stored_observations_for_metric_and_year');
});
