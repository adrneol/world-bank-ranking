/**
 * WORLD BANK SOURCE OUTAGE — EXPLICIT HTTP 502 BEHAVIOUR.
 *
 * The production incident of 2026-10-21 was an HTTP 502 from the World Bank
 * API (fetch_runs.id=39: nine indicators failed with "HTTP 502" and the
 * refresh was recorded as 'partial'). These tests make that exact failure
 * mode explicit and deterministic:
 *
 *   1. HTTP 502 followed by success  -> the client retries and the refresh
 *      publishes normally.
 *   2. Retry exhaustion              -> the request budget is BOUNDED
 *      (WB_MAX_RETRIES + 1 attempts) and the failure is classified as a
 *      World Bank failure, never as a database transport failure.
 *   3. Lock release                  -> a failed or partial refresh leaves
 *      no held refresh lock and no partially published dataset.
 *   4. Recovery                      -> once the source is healthy again, the
 *      next refresh publishes and freshness advances.
 *
 * No production credentials, no production database, no live API: the stub
 * World Bank server stands in for the source.
 */

import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';
process.env.WB_MAX_RETRIES = '2'; // 3 attempts per request (1 + 2 retries)

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
  delete process.env.WB_MAX_RETRIES;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

/** The refresh lock row (single row, id = 1). */
async function lockState(db) {
  const { refreshLockStatus } = await import('../src/db/repository.js');
  const row = await refreshLockStatus(db);
  return { locked: Boolean(row?.locked), runId: row?.runId ?? null };
}

test('HTTP 502 followed by success: the client retries and the refresh publishes', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    stub.reset();
    // The first request (country metadata) fails with 502; the retry succeeds.
    stub.failNext({ status: 502, times: 1 });
    const before = stub.requestCount();
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-recover' });
    const after = stub.requestCount();
    assert.equal(summary.status, 'success', 'the refresh succeeded after the 502');
    assert.ok(summary.rowsUpserted > 0, 'the dataset was published');
    assert.ok(after - before >= 2, 'the 502 was retried (more than one HTTP request was made)');
    const { countObservations } = await import('../src/db/repository.js');
    assert.ok((await countObservations(db)) > 0, 'observations are stored');
    const { locked } = await lockState(db);
    assert.equal(locked, false, 'the refresh lock was released');
  } finally {
    db.close();
  }
});

test('HTTP 502 exhaustion is bounded and never classified as a database failure', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { isTransportError } = await import('../src/db/driver.js');
  const db = await freshDb();
  try {
    // Baseline: a healthy refresh of the same range, to measure the exact
    // request budget the outage adds.
    stub.reset();
    const healthy = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-baseline' });
    assert.equal(healthy.status, 'success');
    const baseline = stub.requestCount();
    const seriesPath = '/country/all/indicator/NY.GDP.MKTP.KD';
    const { countObservations } = await import('../src/db/repository.js');
    const publishedBefore = await countObservations(db);
    assert.ok(publishedBefore > 0, 'the baseline refresh published a dataset');

    // One indicator's series always answers 502.
    stub.reset();
    stub.failNextMatching({ status: 502, times: 500, substring: seriesPath });
    const before = stub.requestCount();
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-exhaust' });
    const requests = stub.requestCount() - before;

    assert.equal(summary.status, 'partial', 'the refresh is partial: one indicator failed');
    // The failing endpoint is tried 1 + WB_MAX_RETRIES times, and only that
    // endpoint: the request budget is bounded, never an unbounded loop.
    const maxRetries = Number(process.env.WB_MAX_RETRIES ?? '5');
    assert.equal(
      stub.requestsFor(seriesPath),
      1 + maxRetries,
      'the failing series is tried exactly 1 + WB_MAX_RETRIES times',
    );
    assert.equal(
      requests - baseline,
      maxRetries,
      'the outage costs exactly the retry budget over a healthy run',
    );
    // The failure is a World Bank failure, NOT a transport failure: a 502 must
    // never trigger the database-failover path.
    const error = new Error('HTTP 502 for https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD');
    error.status = 502;
    assert.equal(isTransportError(error), false, 'an HTTP 502 is not a database transport failure');

    // Nothing NEW was published, and no lock is held.
    assert.equal(
      await countObservations(db),
      publishedBefore,
      'a partial refresh publishes nothing on top of the previous dataset',
    );
    const { locked } = await lockState(db);
    assert.equal(locked, false, 'the refresh lock was released after the partial run');
    const { getLatestFetchRun } = await import('../src/db/repository.js');
    const run = await getLatestFetchRun(db, { status: null });
    assert.equal(run.status, 'partial', 'the partial run is auditable');
    assert.match(run.error_message, /HTTP 502/, 'the source failure is recorded verbatim');
  } finally {
    db.close();
  }
});

test('a total HTTP 502 outage fails the run, publishes nothing and frees the lock', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    stub.reset();
    stub.failNext({ status: 502, times: 5000 });
    // A total outage REJECTS: every indicator failed, so nothing is staged
    // and nothing may be published. The error carries the dataset-preserved
    // contract flags.
    let thrown = null;
    try {
      await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-total' });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, 'the refresh rejected');
    assert.equal(thrown.datasetPreserved, true, 'the previous dataset is preserved');
    assert.equal(thrown.datasetRestored, true, 'the previous dataset is intact');
    assert.match(String(thrown.message), /HTTP 502|Every indicator failed/, 'the failure names the source outage');

    const { countObservations, getLatestFetchRun } = await import('../src/db/repository.js');
    assert.equal(await countObservations(db), 0, 'nothing was published');
    const { locked } = await lockState(db);
    assert.equal(locked, false, 'the refresh lock was released');
    const run = await getLatestFetchRun(db, { status: null });
    assert.equal(run.status, 'failed', 'the failed run is auditable');
    assert.equal(await getLatestFetchRun(db, { status: 'success' }), null, 'no successful run was recorded');
  } finally {
    db.close();
  }
});

test('after the source recovers, the next refresh publishes and freshness advances', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    // 1. Outage: the run fails and nothing is published.
    stub.reset();
    stub.failNext({ status: 502, times: 5000 });
    await assert.rejects(
      refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-outage' }),
      /HTTP 502|Every indicator failed/,
    );
    assert.equal(await repository.countObservations(db), 0);
    assert.equal(await repository.getLastSuccessfulFetchTime(db), null, 'freshness did not advance');
    const { locked } = await lockState(db);
    assert.equal(locked, false, 'the lock is free before the recovery attempt');

    // 2. The source is healthy again.
    stub.reset();
    const recovered = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-502-recovered' });
    assert.equal(recovered.status, 'success', 'the recovery attempt succeeds');
    assert.ok(recovered.rowsUpserted > 0, 'the dataset is published');
    assert.ok((await repository.countObservations(db)) > 0, 'observations are stored');
    assert.ok(await repository.getLastSuccessfulFetchTime(db), 'freshness advanced');
    const { locked: lockedAfter } = await lockState(db);
    assert.equal(lockedAfter, false, 'the lock is free again');
  } finally {
    db.close();
  }
});

test('a World Bank outage never triggers the database failover path', async () => {
  // A 502 must be classified as a source failure, so the database is never
  // failed over and the dataset keeps serving from the primary.
  const { isTransportError } = await import('../src/db/driver.js');
  const { WorldBankApiError, WorldBankPayloadError } = await import('../src/wb/client.js');
  for (const error of [
    new WorldBankApiError('source error'),
    new WorldBankPayloadError('bad payload'),
  ]) {
    assert.equal(isTransportError(error), false, 'World Bank errors never fail the database over');
  }
  const http502 = new Error('HTTP 502 for https://api.worldbank.org/v2/...');
  http502.status = 502;
  assert.equal(isTransportError(http502), false, 'an HTTP 502 never fails the database over');
});
