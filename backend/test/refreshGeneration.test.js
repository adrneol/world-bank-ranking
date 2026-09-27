/**
 * PHASE-1 R-04 TESTS: frontend refresh-generation comparator.
 *
 * The helper is a dependency-free frontend module (no JSX, no Vite
 * features), imported here by relative path so the contract the App
 * background watcher relies on is pinned: adopt-on-first-sight, advance
 * only on strictly newer generations, never revalidate on degraded or
 * identical payloads.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintOf, isNewerGeneration } from '../../frontend/src/utils/refreshGeneration.js';

test('fingerprintOf extracts the backend fingerprint null-safely', () => {
  assert.equal(fingerprintOf(null), null);
  assert.equal(fingerprintOf(undefined), null);
  assert.deepEqual(fingerprintOf({ fingerprint: null, lastSuccessAt: '2026-09-27T18:55:14.493Z', observations: 5 }), {
    runId: null,
    lastSuccessAt: '2026-09-27T18:55:14.493Z',
    maxFetchedAt: null,
    observationCount: 5,
  });
  assert.deepEqual(
    fingerprintOf({
      fingerprint: { runId: 22, lastSuccessAt: 't', maxFetchedAt: 'm', observationCount: 228776 },
    }),
    { runId: 22, lastSuccessAt: 't', maxFetchedAt: 'm', observationCount: 228776 },
  );
});

test('first observation never counts as newer (adopt, do not revalidate)', () => {
  const next = { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z' };
  assert.equal(isNewerGeneration(null, next), false);
  assert.equal(isNewerGeneration(undefined, next), false);
  assert.equal(isNewerGeneration(next, null), false);
});

test('a higher success runId counts as newer; same or lower does not', () => {
  const prev = { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z' };
  assert.equal(isNewerGeneration(prev, { runId: 23, lastSuccessAt: '2026-09-28T18:55:14.493Z' }), true);
  assert.equal(isNewerGeneration(prev, { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z' }), false);
  assert.equal(isNewerGeneration(prev, { runId: 21, lastSuccessAt: '2026-09-26T18:55:14.493Z' }), false);
});

test('without runIds, a newer lastSuccessAt counts as newer', () => {
  const prev = { runId: null, lastSuccessAt: '2026-09-27T18:55:14.493Z' };
  assert.equal(isNewerGeneration(prev, { runId: null, lastSuccessAt: '2026-09-28T18:55:14.493Z' }), true);
  assert.equal(isNewerGeneration(prev, { runId: null, lastSuccessAt: '2026-09-27T18:55:14.493Z' }), false);
});

test('degraded payloads never trigger revalidation (no loops)', () => {
  const prev = { runId: 22, lastSuccessAt: '2026-09-27T18:55:14.493Z' };
  assert.equal(isNewerGeneration(prev, { runId: null, lastSuccessAt: null }), false);
  assert.equal(isNewerGeneration({ runId: null, lastSuccessAt: null }, prev), false);
});
