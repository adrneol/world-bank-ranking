/**
 * PHASE-1 R-12 TESTS: generation-keyed integrity memo for GET /api/data-status.
 *
 * The memo must: compute on first use, reuse within one refresh generation
 * (no rescan on rapid polls), and recompute exactly when the published
 * generation advances. Integrity semantics are unchanged — only the
 * redundant scans go away.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expensiveIntegrityKey,
  getCachedIntegrity,
  getCachedExpensiveIntegrity,
  integrityCacheKey,
  resetIntegrityCache,
  storedReportMatchesCurrentVintage,
} from '../src/services/statusCache.js';

test.beforeEach(() => {
  resetIntegrityCache();
});

test('integrityCacheKey is stable within a generation and changes across it', () => {
  const gen1 = { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z', observationCount: 228776 };
  const same = { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z', observationCount: 228776 };
  const next = { runId: 23, lastSuccessAt: '2026-09-28T18:55:14.493Z', observationCount: 228800 };
  assert.equal(integrityCacheKey(gen1), integrityCacheKey(same));
  assert.notEqual(integrityCacheKey(gen1), integrityCacheKey(next));
  assert.notEqual(integrityCacheKey(null), integrityCacheKey(gen1));
});

test('first call computes, second call with the same key reuses (no rescan)', async () => {
  let scans = 0;
  const compute = () => {
    scans += 1;
    return { passed: true, checks: [] };
  };
  const key = integrityCacheKey({ runId: 1, lastSuccessAt: '2026-01-01T00:00:00.000Z', observationCount: 10 });
  const first = await getCachedIntegrity(key, compute);
  assert.equal(first.fromCache, false);
  assert.equal(scans, 1);
  const second = await getCachedIntegrity(key, compute);
  assert.equal(second.fromCache, true);
  assert.equal(scans, 1, 'rapid poll within one generation must not rescan');
  assert.deepEqual(second.report, first.report);
});

test('a new published generation invalidates the memo exactly once', async () => {
  let scans = 0;
  const compute = () => {
    scans += 1;
    return { passed: scans > 1, checks: [] };
  };
  const oldKey = integrityCacheKey({ runId: 1, lastSuccessAt: '2026-01-01T00:00:00.000Z', observationCount: 10 });
  const newKey = integrityCacheKey({ runId: 2, lastSuccessAt: '2026-01-02T00:00:00.000Z', observationCount: 12 });
  await getCachedIntegrity(oldKey, compute);
  const afterPublish = await getCachedIntegrity(newKey, compute);
  assert.equal(afterPublish.fromCache, false);
  assert.equal(scans, 2);
  assert.equal(afterPublish.report.passed, true, 'recomputed report reflects the new generation');
  const repeat = await getCachedIntegrity(newKey, compute);
  assert.equal(repeat.fromCache, true);
  assert.equal(scans, 2);
});

test('the expensive memo key changes when the derived vintage changes', () => {
  // The L.vintage_provenance check compares the derived dataset_state row
  // with the stored observations. The derived row can change WITHOUT the
  // observations changing, so the memo key must cover it: otherwise a
  // memoized report would hide exactly the divergence the check detects.
  assert.equal(
    expensiveIntegrityKey(3, '2026-10-08'),
    expensiveIntegrityKey(3, '2026-10-08'),
    'stable within one derived vintage',
  );
  assert.notEqual(
    expensiveIntegrityKey(3, '2026-10-08'),
    expensiveIntegrityKey(3, '2026-07-13'),
    'a corrected derived vintage invalidates the memo',
  );
  assert.notEqual(
    expensiveIntegrityKey(3, '2026-10-08'),
    expensiveIntegrityKey(4, '2026-10-08'),
    'a new content generation invalidates the memo',
  );
});

test('the expensive memo recomputes when the derived vintage changes', async () => {
  let scans = 0;
  const compute = () => {
    scans += 1;
    return { passed: true, checks: [] };
  };
  const before = await getCachedExpensiveIntegrity(expensiveIntegrityKey(3, '2026-10-08'), compute);
  assert.equal(before.fromCache, false);
  const same = await getCachedExpensiveIntegrity(expensiveIntegrityKey(3, '2026-10-08'), compute);
  assert.equal(same.fromCache, true);
  assert.equal(scans, 1, 'rapid poll within one generation must not rescan');
  const corrected = await getCachedExpensiveIntegrity(expensiveIntegrityKey(3, '2026-07-13'), compute);
  assert.equal(corrected.fromCache, false, 'a corrected derived vintage forces a rescan');
  assert.equal(scans, 2);
});

test('a persisted report is reusable only for the derived vintage it verified', () => {
  const report = [
    { check: 'C.unknown_iso3', status: 'pass', detail: { orphanRows: 0 } },
    { check: 'L.vintage_provenance', status: 'pass', detail: { cachedVintage: '2026-10-08' } },
  ];
  assert.equal(storedReportMatchesCurrentVintage(report, '2026-10-08'), true, 'same vintage: reusable');
  assert.equal(storedReportMatchesCurrentVintage(report, '2026-07-13'), false, 'corrected vintage: rescan');
  assert.equal(storedReportMatchesCurrentVintage(report, null), false, 'unknown vintage: rescan');
  assert.equal(storedReportMatchesCurrentVintage([], '2026-10-08'), false, 'no vintage check: rescan');
  assert.equal(storedReportMatchesCurrentVintage(null, '2026-10-08'), false, 'no report: rescan');
  // A report whose check recorded a null vintage matches a null current one.
  const nullVintage = [
    { check: 'L.vintage_provenance', status: 'pass', detail: { cachedVintage: null } },
  ];
  assert.equal(storedReportMatchesCurrentVintage(nullVintage, null), true);
});
