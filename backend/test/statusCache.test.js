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
  getCachedIntegrity,
  integrityCacheKey,
  resetIntegrityCache,
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

test('first call computes, second call with the same key reuses (no rescan)', () => {
  let scans = 0;
  const compute = () => {
    scans += 1;
    return { passed: true, checks: [] };
  };
  const key = integrityCacheKey({ runId: 1, lastSuccessAt: '2026-01-01T00:00:00.000Z', observationCount: 10 });
  const first = getCachedIntegrity(key, compute);
  assert.equal(first.fromCache, false);
  assert.equal(scans, 1);
  const second = getCachedIntegrity(key, compute);
  assert.equal(second.fromCache, true);
  assert.equal(scans, 1, 'rapid poll within one generation must not rescan');
  assert.deepEqual(second.report, first.report);
});

test('a new published generation invalidates the memo exactly once', () => {
  let scans = 0;
  const compute = () => {
    scans += 1;
    return { passed: scans > 1, checks: [] };
  };
  const oldKey = integrityCacheKey({ runId: 1, lastSuccessAt: '2026-01-01T00:00:00.000Z', observationCount: 10 });
  const newKey = integrityCacheKey({ runId: 2, lastSuccessAt: '2026-01-02T00:00:00.000Z', observationCount: 12 });
  getCachedIntegrity(oldKey, compute);
  const afterPublish = getCachedIntegrity(newKey, compute);
  assert.equal(afterPublish.fromCache, false);
  assert.equal(scans, 2);
  assert.equal(afterPublish.report.passed, true, 'recomputed report reflects the new generation');
  const repeat = getCachedIntegrity(newKey, compute);
  assert.equal(repeat.fromCache, true);
  assert.equal(scans, 2);
});
