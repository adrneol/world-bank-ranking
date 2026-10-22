/**
 * DATABASE FALLBACK AND RECOVERY — EXPLICIT MATRIX WITH INJECTED HANDLES.
 *
 * Every handle in this file is created in-process (a disposable SQLite file
 * or a wrapper that simulates a dead Turso primary). No production
 * credentials, no remote endpoint, no real network.
 *
 * Covered:
 *   1. PRIMARY FAILURE   -> a transport-class failure on the primary.
 *   2. SAFE FALLBACK     -> the fallback serves the request, the dataset is
 *                           intact, and the status names the active target.
 *   3. WRITE FAILURE     -> a refresh that fails publishes nothing, leaves no
 *                           partial rows on either database, and frees the
 *                           refresh lock.
 *   4. PRIMARY RECOVERY  -> once the primary is healthy again it is
 *                           revalidated and promoted; the data converge.
 *   5. CONCURRENT ACCESS -> concurrent failing GETs share ONE failover, and
 *                           concurrent refreshes are serialised by the lock.
 *   6. BOTH UNAVAILABLE  -> the request fails with the transport error; the
 *                           service never answers 200 with an empty dataset.
 */

import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';
// Recovery policy knobs, set BEFORE any src/ import (configuration freezes at
// import time): the promotion must happen on the first healthy probe, and the
// re-probe must not be rate-limited.
process.env.WB_RECOVERY_CONFIRM_MS = '0';
process.env.WB_RECOVERY_REPROBE_MS = '0';
process.env.WB_RECOVERY_PROBE_TIMEOUT_MS = '5000';
process.env.WB_FAILOVER_COOLDOWN_MS = '0';
process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '0';
// Keep the refresh-level transport retry short (the publish is failed on
// purpose below, and the retry ladder must not make the test slow).
process.env.WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS = '10,20';

let stub = null;
/** When true the stub serves slightly different values, forcing a real publish. */
let mutateValues = false;

/** Bump the first value-bearing row of every series (forces a real write). */
function bumpRows(baseRows) {
  let bumped = false;
  return baseRows.map((row) => {
    if (bumped || row.value === null || row.value === undefined) return row;
    bumped = true;
    const n = Number(row.value);
    return { ...row, value: typeof row.value === 'string' ? String(n + 1) : n + 1 };
  });
}

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) => (mutateValues ? bumpRows(baseRows) : baseRows),
  });
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

/** A transport-class failure shaped like a dead Turso connection. */
function transportError() {
  const error = new Error('SERVER_ERROR: Server returned HTTP status 404');
  error.name = 'LibsqlError';
  error.code = 'SERVER_ERROR';
  return error;
}

/** Wrap a handle so its statements fail like a dead primary. */
function deadPrimary(handle, { match = '' } = {}) {
  const wrap = (target) => {
    const origExec = target.execute.bind(target);
    target.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? '';
      if (match === '' || sql.includes(match)) return Promise.reject(transportError());
      return origExec(...args);
    };
    if (target.batch) {
      const origBatch = target.batch.bind(target);
      target.batch = (...args) => {
        const sql = String(args[0]?.[0]?.sql ?? args[0]?.sql ?? '');
        if (match === '' || sql.includes(match)) return Promise.reject(transportError());
        return origBatch(...args);
      };
    }
    if (target.transaction) {
      const origTx = target.transaction.bind(target);
      target.transaction = async (...args) => wrap(await origTx(...args));
    }
    return target;
  };
  return wrap(handle);
}

/**
 * Fail every write to the OBSERVATIONS table like a dying database.
 *
 * The audit bookkeeping (fetch_runs / dataset_state) keeps working, so the
 * failed attempt is still recorded - the failure mode is a publish that dies
 * mid-transaction, not a database that cannot record anything.
 */
function failWrites(handle) {
  const isObservationWrite = (sql) =>
    /^\s*(insert|update|delete|replace)\b/i.test(String(sql ?? '')) && /observations/i.test(String(sql ?? ''));
  const wrap = (target) => {
    const origExec = target.execute.bind(target);
    target.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? '';
      if (isObservationWrite(sql)) return Promise.reject(transportError());
      return origExec(...args);
    };
    if (target.batch) {
      const origBatch = target.batch.bind(target);
      target.batch = (...args) => {
        const sql = String(args[0]?.[0]?.sql ?? args[0]?.sql ?? '');
        if (isObservationWrite(sql)) return Promise.reject(transportError());
        return origBatch(...args);
      };
    }
    if (target.transaction) {
      const origTx = target.transaction.bind(target);
      target.transaction = async (...args) => wrap(await origTx(...args));
    }
    return target;
  };
  return wrap(handle);
}

/** A populated, disposable database. */
async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

async function appWithShared(shared) {
  const { createApp } = await import('../src/server.js');
  return createApp({ shared, autoRefresh: false });
}

async function listen(app) {
  let server = null;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('1/2. primary failure: the safe fallback serves and the status names it', async () => {
  const primary = await seedDb();
  const fallback = await seedDb();
  const { countObservations } = await import('../src/db/repository.js');
  const expected = await countObservations(fallback);
  assert.ok(expected > 0, 'the fallback holds a dataset');

  const dead = deadPrimary(primary);
  let opened = 0;
  const shared = {
    current: dead,
    provider: 'turso',
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opened += 1;
        return { handle: fallback };
      },
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const years = await fetch(`${base}/api/years`);
    assert.equal(years.status, 200, 'the request is served');
    const body = await years.json();
    assert.ok(Array.isArray(body.years) && body.years.length > 0, 'the fallback data are served (not an empty dataset)');
    assert.equal(shared.isFallback, true, 'the fallback is active');
    assert.equal(shared.current, fallback, 'the active handle is the fallback');
    assert.equal(opened, 1, 'the fallback was validated and opened once');

    const status = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(status.database?.fallback, true, 'the status reports the fallback');
    assert.match(String(status.database?.label), /Local SQLite/, 'the fallback is labelled');
    assert.equal(status.observations, expected, 'the served observation count is the fallback\'s');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('3. write failure: a refresh publishes nothing, on either database, and frees the lock', async () => {
  const primary = await seedDb();
  const { countObservations, refreshLockStatus, getLatestFetchRun } = await import(
    '../src/db/repository.js'
  );
  try {
    const before = await countObservations(primary);
    assert.ok(before > 0, 'the dataset is populated');

    // The PUBLISH transaction fails: every write to the observations table
    // must be rolled back, so no row may be added, removed or left half-
    // written. The values are changed first, so the refresh really tries to
    // write (an unchanged payload would skip the writes entirely).
    const { refreshData } = await import('../src/wb/ingest.js');
    stub.reset();
    mutateValues = true;
    const failing = failWrites(primary);
    let thrown = null;
    try {
      await refreshData({ db: failing, startYear: 2024, endYear: 2025, trigger: 'test-write-fail' });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, 'the refresh failed');
    assert.equal(thrown.datasetPreserved, true, 'the previous dataset is preserved');

    assert.equal(await countObservations(primary), before, 'no row was added or removed');
    const lock = await refreshLockStatus(primary);
    assert.equal(Boolean(lock?.locked), false, 'the refresh lock is free');
    const run = await getLatestFetchRun(primary, { status: null });
    assert.ok(['partial', 'failed'].includes(run.status), 'the attempt is auditable');
  } finally {
    mutateValues = false;
    primary.close();
  }
});

test('4. primary recovery: a healthy primary is revalidated and promoted', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, resetRecoveryConfirmation } = await import(
    '../src/server.js'
  );
  const primary = await seedDb();
  const fallback = await seedDb();
  const { countObservations } = await import('../src/db/repository.js');
  try {
    const primaryCount = await countObservations(primary);
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    resetRecoveryConfirmation();
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    // The primary is healthy: recovery validates it (the documented seam:
    // createProbe supplies the primary handle, configuredMode the policy) and
    // promotes it.
    const outcome = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(outcome.recovered, true, `the primary was promoted (${outcome.reason})`);
    assert.equal(shared.isFallback, false, 'the service is back on the primary');
    assert.equal(shared.current, primary, 'the active handle is the primary again');
    assert.equal(await countObservations(shared.current), primaryCount, 'the primary data are intact');
  } finally {
    primary.close();
    fallback.close();
  }
});

test('5. concurrent access: failing GETs share ONE failover; refreshes are serialised', async () => {
  const primary = await seedDb();
  const fallback = await seedDb();
  let opened = 0;
  const shared = {
    current: deadPrimary(primary),
    provider: 'turso',
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opened += 1;
        return { handle: fallback };
      },
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => fetch(`${base}/api/years`)),
    );
    for (const response of responses) {
      assert.equal(response.status, 200, 'every concurrent request is served');
    }
    assert.equal(opened, 1, 'the fallback was validated and opened exactly once (no storm)');
    assert.equal(shared.isFallback, true, 'the fallback is active');

    // Concurrent REFRESHES are serialised by the cross-process lock: the
    // second one is rejected, never interleaved with the first.
    const { refreshData } = await import('../src/wb/ingest.js');
    stub.reset();
    const [a, b] = await Promise.allSettled([
      refreshData({ db: fallback, startYear: 2024, endYear: 2025, trigger: 'test-concurrent' }),
      refreshData({ db: fallback, startYear: 2024, endYear: 2025, trigger: 'test-concurrent' }),
    ]);
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    assert.ok(rejected.length >= 1, 'the overlapping refresh was rejected');
    assert.match(
      String(rejected[0]?.reason?.code ?? ''),
      /REFRESH_IN_PROGRESS/,
      'the rejection names the refresh lock',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('5b. a request arriving DURING the failover validation is still served (single-flight await)', async () => {
  // The failover validation is single-flight and CONCURRENT CALLERS AWAIT
  // the same in-flight validation (server.js: `if (failoverFlight) return
  // failoverFlight`). A request that reaches the dead primary while the
  // validation is still running therefore waits for it and is retried on the
  // fallback: the validation window is NOT visible to the caller.
  const primary = await seedDb();
  const fallback = await seedDb();
  let opened = 0;
  const shared = {
    current: deadPrimary(primary),
    provider: 'turso',
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opened += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { handle: fallback };
      },
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const during = await fetch(`${base}/api/years`);
    assert.equal(during.status, 200, 'the request waits for the validation and is served');
    const body = await during.json();
    assert.ok(Array.isArray(body.years) && body.years.length > 0, 'the fallback data are served');
    assert.equal(opened, 1, 'the fallback was validated exactly once');

    const after = await fetch(`${base}/api/years`);
    assert.equal(after.status, 200, 'the service stays on the fallback');
    assert.equal(shared.isFallback, true);
    assert.equal(opened, 1, 'no extra failover was triggered');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('6. both databases unavailable: the request fails, it never serves an empty dataset', async () => {
  const primary = await seedDb();
  const fallback = await seedDb();
  const shared = {
    current: deadPrimary(primary),
    provider: 'turso',
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: deadPrimary(fallback) }),
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const response = await fetch(`${base}/api/years`);
    assert.notEqual(response.status, 200, 'the request does not succeed');
    assert.ok(response.status >= 500, `the failure is a server error (${response.status})`);
    const body = await response.json().catch(() => null);
    assert.ok(body?.error?.message, 'the error is explicit');
    assert.ok(!Array.isArray(body?.years), 'no empty year list is served as if it were data');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});
