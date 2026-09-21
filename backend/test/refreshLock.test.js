/**
 * REFRESH LOCK TESTS (specification section 14).
 *
 * The SQLite-backed mutex must: grant exactly one holder, reject concurrent
 * refreshes with REFRESH_IN_PROGRESS, release on success AND on failure
 * (lock recovery), and be recoverable after a simulated crash.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { createMemoryTestDb } from './helpers/testDb.js';

// Speed up the failure-path test: retry backoff base drops from 500ms to 20ms.
// Set before the first src import (configuration is read once at import time).
process.env.WB_RETRY_BASE_MS = '20';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

test('only one acquirer wins the SQLite lock', async () => {
  const { db } = await createMemoryTestDb();
  const repository = await import('../src/db/repository.js');

  assert.equal(repository.acquireRefreshLock(db, { holder: 'a' }), true);
  assert.equal(repository.acquireRefreshLock(db, { holder: 'b' }), false);

  const status = repository.refreshLockStatus(db);
  assert.equal(Boolean(status.locked), true);
  assert.equal(status.holder, 'a');

  repository.releaseRefreshLock(db);
  assert.equal(repository.acquireRefreshLock(db, { holder: 'b' }), true);
  repository.releaseRefreshLock(db);
});

test('concurrent refresh is rejected and the lock is free afterwards', async () => {
  const { db } = await createMemoryTestDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  stub.reset();

  const first = refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-lock' }).catch(() => null);
  await assert.rejects(
    refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-lock' }),
    (error) => error.code === 'REFRESH_IN_PROGRESS',
  );
  await first;

  // After completion the SQLite lock must be free again.
  const status = repository.refreshLockStatus(db);
  assert.equal(Boolean(status.locked), false);
});

test('failed refresh releases both locks (no permanent wedge)', async () => {
  const { db } = await createMemoryTestDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  stub.reset();

  // More failures than the retry budget: metadata fetch can never succeed,
  // so the whole refresh fails and must still release its locks.
  stub.failNext({ status: 500, times: 100, body: 'down' });
  await assert.rejects(
    refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-fail' }),
  );
  stub.reset();

  const status = repository.refreshLockStatus(db);
  assert.equal(Boolean(status.locked), false);

  const failed = repository.getLatestFetchRun(db, { status: 'failed' });
  assert.ok(failed, 'the failed run is recorded for the audit trail');
});

test('stale lock recovery frees a crashed holder', async () => {
  const { db } = await createMemoryTestDb();
  const repository = await import('../src/db/repository.js');
  const { recoverRefreshLock } = await import('../src/wb/ingest.js');

  assert.equal(repository.acquireRefreshLock(db, { holder: 'crashed-process' }), true);
  // Simulate the crash: in-memory flag is gone (new process), SQLite row stuck.
  const recovered = recoverRefreshLock(db, 'test recovery');
  assert.equal(recovered.previous.holder, 'crashed-process');
  assert.equal(repository.acquireRefreshLock(db, { holder: 'next' }), true);
  repository.releaseRefreshLock(db);
});
