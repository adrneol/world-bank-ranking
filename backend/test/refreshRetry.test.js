/**
 * PHASE 6C PART 7 — REFRESH RETRY BEHAVIOR.
 *
 * Proves, with stub-only databases:
 *   1. The retry ladder is 5m → 15m → 30m → 60m, capped at 60m.
 *   2. Scheduling is single-flight (one pending timer max).
 *   3. A failed AUTOMATIC refresh schedules a retry; the timer fires through
 *      maybeAutoRefresh guards (no overlap, no storm).
 *   4. Any success resets the chain (no retry pending, count zero).
 *   5. Manual refresh failures never schedule (explicit callers own retrying).
 *
 * Timers use WB_REFRESH_RETRY_DELAYS_MS overrides so no test waits minutes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';
process.env.WB_REFRESH_RETRY_DELAYS_MS = '50,60,70';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
  delete process.env.WB_REFRESH_RETRY_DELAYS_MS;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

/** Wait until no in-process refresh is running (background timers settled). */
async function waitForIdle(timeoutMs = 15000) {
  const { isRefreshInProgress } = await import('../src/wb/ingest.js');
  const start = Date.now();
  while (isRefreshInProgress()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for refresh idle');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('retry ladder maps 5m/15m/30m/60m capped', async () => {
  const saved = process.env.WB_REFRESH_RETRY_DELAYS_MS;
  delete process.env.WB_REFRESH_RETRY_DELAYS_MS;
  try {
    const { getRefreshRetryDelayMs } = await import('../src/wb/ingest.js');
    assert.equal(getRefreshRetryDelayMs(0), 5 * 60 * 1000);
    assert.equal(getRefreshRetryDelayMs(1), 15 * 60 * 1000);
    assert.equal(getRefreshRetryDelayMs(2), 30 * 60 * 1000);
    assert.equal(getRefreshRetryDelayMs(3), 60 * 60 * 1000);
    assert.equal(getRefreshRetryDelayMs(4), 60 * 60 * 1000);
    assert.equal(getRefreshRetryDelayMs(99), 60 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.WB_REFRESH_RETRY_DELAYS_MS = saved;
  }
});

test('scheduling is single-flight and cancellable', async () => {
  const { scheduleRefreshRetry, cancelScheduledRefreshRetry, getRefreshRetryState } =
    await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    cancelScheduledRefreshRetry();
    const first = scheduleRefreshRetry(db, { trigger: 'ttl' });
    assert.equal(first.scheduled, true);
    assert.equal(first.consecutiveFailures, 1);
    const second = scheduleRefreshRetry(db, { trigger: 'ttl' });
    assert.equal(second.consecutiveFailures, 1, 'second schedule is a no-op while pending');
    assert.deepEqual(getRefreshRetryState(), second);
    cancelScheduledRefreshRetry();
    assert.equal(getRefreshRetryState().scheduled, false);
  } finally {
    const { cancelScheduledRefreshRetry: cancel } = await import('../src/wb/ingest.js');
    cancel();
    db.close();
  }
});

test('failed automatic refresh schedules a retry that fires guarded', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    // Fail every request far beyond the client retry budget: the background
    // automatic refresh must fail and arm the retry timer.
    stub.failNext({ status: 500, times: 500 });
    const warnings = [];
    const decision = await ingest.maybeAutoRefresh(db, { onWarn: (w) => warnings.push(w) });
    assert.equal(decision.triggered, true, 'empty stale cache triggers');
    // Wait for the background failure (client backoff is ~20ms base).
    const start = Date.now();
    let failedRun = null;
    while (Date.now() - start < 15000) {
      failedRun = await repository.getLatestFetchRun(db, { status: null });
      if (failedRun?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(failedRun?.status, 'failed', 'background automatic refresh failed');
    assert.ok(warnings.length > 0, 'failure surfaced via onWarn');
    // The failure armed exactly one retry (single-flight).
    const state = ingest.getRefreshRetryState();
    assert.equal(state.scheduled, true, 'retry scheduled after automatic failure');
    assert.equal(state.consecutiveFailures >= 1, true);
    // Freshness never advances on failure.
    assert.equal(await repository.getLastSuccessfulFetchTime(db), null);
    // The 50ms timer fires back through maybeAutoRefresh guards: a second
    // attempt is launched (and fails against the still-down stub) without
    // ever overlapping the first — single-flight enforced by the locks.
    const start2 = Date.now();
    let runs = [];
    while (Date.now() - start2 < 15000) {
      runs = await repository.listFetchRuns(db, 10);
      if (runs.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(runs.length >= 2, 'scheduled retry fired a second guarded attempt');
  } finally {
    // Break the retry chain deterministically, then settle.
    process.env.WB_REFRESH_RETRY_DISABLED = '1';
    try {
      ingest.cancelScheduledRefreshRetry();
      await waitForIdle();
    } finally {
      delete process.env.WB_REFRESH_RETRY_DISABLED;
    }
    stub.reset();
    db.close();
  }
});

test('any success resets the retry chain', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    stub.reset();
    ingest.scheduleRefreshRetry(db, { trigger: 'ttl' });
    assert.equal(ingest.getRefreshRetryState().scheduled, true);
    const summary = await ingest.refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' });
    assert.equal(summary.status, 'success');
    assert.deepEqual(ingest.getRefreshRetryState(), {
      scheduled: false,
      consecutiveFailures: 0,
      nextDelayMs: null,
    });
  } finally {
    ingest.cancelScheduledRefreshRetry();
    db.close();
  }
});

test('failed attempt followed by successful retry ends the stale state', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    // Fail only the first request (country metadata of attempt #1): the
    // background refresh fails, the 50ms retry fires into a healthy stub
    // and fully succeeds — lastSuccessAt advances and the chain resets.
    stub.failNext({ status: 500, times: 1 });
    const decision = await ingest.maybeAutoRefresh(db, { onWarn: () => {} });
    assert.equal(decision.triggered, true);
    const start = Date.now();
    let lastSuccess = null;
    while (Date.now() - start < 30000) {
      lastSuccess = await repository.getLastSuccessfulFetchTime(db);
      if (lastSuccess) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(lastSuccess, 'retry succeeded and renewed freshness');
    assert.ok((await repository.countObservations(db)) > 0, 'dataset published by the retry');
    assert.deepEqual(ingest.getRefreshRetryState(), {
      scheduled: false,
      consecutiveFailures: 0,
      nextDelayMs: null,
    });
  } finally {
    process.env.WB_REFRESH_RETRY_DISABLED = '1';
    try {
      ingest.cancelScheduledRefreshRetry();
      await waitForIdle();
    } finally {
      delete process.env.WB_REFRESH_RETRY_DISABLED;
    }
    stub.reset();
    db.close();
  }
});

test('manual refresh failure schedules nothing', async () => {  const ingest = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    stub.failNext({ status: 500, times: 500 });
    await assert.rejects(
      ingest.refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'manual' }),
      /./,
    );
    assert.equal(ingest.getRefreshRetryState().scheduled, false, 'manual failures do not arm retries');
  } finally {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    db.close();
  }
});
