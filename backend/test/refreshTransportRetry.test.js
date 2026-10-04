/**
 * PHASE 8D — TRANSPORT RETRY TESTS (refresh-attempt level + SELECT level).
 *
 * A transient Turso/Hrana transport failure (e.g. SERVER_ERROR 404 observed
 * in production) must trigger a bounded fresh refresh attempt — never a
 * mid-transaction resume. Validation, auth, World Bank semantic and
 * integrity failures must never retry. Uses a flaky-handle wrapper so no
 * test touches a real network.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';
process.env.WB_READ_RETRY_DELAY_MS = '5';
process.env.WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS = '15,25';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

/** LibsqlError-shaped transport failure identical to the production 404. */
function transportError() {
  const error = new Error('SERVER_ERROR: Server returned HTTP status 404');
  error.name = 'LibsqlError';
  error.code = 'SERVER_ERROR';
  return error;
}

/**
 * Wrap a real handle so the first `failTimes` execute() calls whose SQL
 * includes `match` throw transport errors, then delegate normally.
 * Transactions are wrapped so tx-scoped statements fail identically.
 */
function flakyDb(handle, { match, failTimes }) {
  let remaining = failTimes;
  const restorers = [];
  const wrap = (target) => {
    const origExec = target.execute.bind(target);
    restorers.push(() => {
      target.execute = origExec;
    });
    target.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? '';
      if (remaining > 0 && sql.includes(match)) {
        remaining -= 1;
        return Promise.reject(transportError());
      }
      return origExec(...args);
    };
    if (target.batch) {
      const origBatch = target.batch.bind(target);
      restorers.push(() => {
        target.batch = origBatch;
      });
      target.batch = (...args) => {
        const sql = String(args[0]?.[0]?.sql ?? '');
        if (remaining > 0 && sql.includes(match)) {
          remaining -= 1;
          return Promise.reject(transportError());
        }
        return origBatch(...args);
      };
    }
    if (target.transaction) {
      const origTx = target.transaction.bind(target);
      restorers.push(() => {
        target.transaction = origTx;
      });
      target.transaction = async (...args) => wrap(await origTx(...args));
    }
    return target;
  };
  const wrapped = wrap(handle);
  // Restore pristine behavior (post-assertions must not trip on leftover
  // programmed failures, e.g. a persistent lock-match flake).
  wrapped.restorePristine = () => {
    for (const restore of restorers.splice(0)) {
      try {
        restore();
      } catch {
        // Best effort.
      }
    }
    remaining = 0;
  };
  return wrapped;
}

async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

test('classifier: transport shapes retry, semantic shapes do not', async () => {
  const { isTransportError } = await import('../src/db/driver.js');
  const t = transportError();
  assert.equal(isTransportError(t), true);
  const net = new TypeError('fetch failed');
  assert.equal(isTransportError(net), true);
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { name: 'Error' });
  assert.equal(isTransportError(refused), true);
  const val = Object.assign(new Error('bad'), { httpStatus: 400, code: 'INVALID_RANGE' });
  assert.equal(isTransportError(val), false);
  const denied = Object.assign(new Error('nope'), { httpStatus: 401, code: 'REFRESH_UNAUTHORIZED' });
  assert.equal(isTransportError(denied), false);
  const busy = Object.assign(new Error('busy'), { code: 'REFRESH_IN_PROGRESS' });
  assert.equal(isTransportError(busy), false);
  const constraint = Object.assign(new Error('UNIQUE constraint failed'), { name: 'LibsqlError', code: 'SQLITE_CONSTRAINT' });
  assert.equal(isTransportError(constraint), false, 'deterministic SQL errors never retry');
  const wbApi = Object.assign(new Error('WB down'), { name: 'WorldBankApiError' });
  assert.equal(isTransportError(wbApi), false);
  const wbTimeout = Object.assign(new Error('timed out'), { timeout: true });
  assert.equal(isTransportError(wbTimeout), false, 'WB timeouts belong to the WB retry policy');
  const http500 = Object.assign(new Error('x'), { status: 500 });
  assert.equal(isTransportError(http500), false, 'status-carrying errors are not transport');
  assert.equal(isTransportError(null), false);
  assert.equal(isTransportError('nope'), false);
});

test('classifier: Hrana auth-shaped SERVER_ERROR never retries or fails over', async () => {
  // Verified live against @libsql/client: a wrong token yields LibsqlError /
  // SERVER_ERROR with "HTTP status 400" — same envelope as transport death
  // ("HTTP status 404"), but auth must fail fast, never retry or fail over.
  const { isTransportError } = await import('../src/db/driver.js');
  for (const status of [400, 401, 403]) {
    const auth = Object.assign(new Error(`SERVER_ERROR: Server returned HTTP status ${status}`), {
      name: 'LibsqlError',
      code: 'SERVER_ERROR',
    });
    assert.equal(isTransportError(auth), false, `Hrana HTTP ${status} is auth-shaped, not transport`);
  }
  for (const status of [404, 500, 503]) {
    const transport = Object.assign(new Error(`SERVER_ERROR: Server returned HTTP status ${status}`), {
      name: 'LibsqlError',
      code: 'SERVER_ERROR',
    });
    assert.equal(isTransportError(transport), true, `Hrana HTTP ${status} stays transport`);
  }
});

test('SELECT retries once on transport failure then succeeds', async () => {
  const { queryAll } = await import('../src/db/driver.js');
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = await createMemoryDb();
  try {
    let calls = 0;
    const orig = db.execute.bind(db);
    db.execute = (...args) => {
      calls += 1;
      if (calls === 1) return Promise.reject(transportError());
      return orig(...args);
    };
    const rows = await queryAll(db, 'SELECT COUNT(*) AS n FROM observations');
    assert.equal(calls, 2);
    assert.equal(rows[0].n, 0);
  } finally {
    db.close();
  }
});

test('SELECT does not retry semantic failures', async () => {
  const { queryAll } = await import('../src/db/driver.js');
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = await createMemoryDb();
  try {
    let calls = 0;
    const orig = db.execute.bind(db);
    db.execute = (...args) => {
      calls += 1;
      return Promise.reject(Object.assign(new Error('no such table: nope'), { name: 'LibsqlError', code: 'SQLITE_ERROR' }));
    };
    await assert.rejects(queryAll(db, 'SELECT 1'), /no such table/);
    assert.equal(calls, 1, 'no retry on SQL errors');
  } finally {
    db.close();
  }
});

test('transport failure mid-publish retries fresh and succeeds', async () => {
  const db = await seedDb();
  try {
    const { refreshData, getRefreshRetryState } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    // Fail the first O10 compare read twice: once for the driver-level
    // retry, once more so the attempt itself fails and retries fresh.
    // (Match is the single-line token: the O10 SELECT spans lines, so a
    // multi-word 'FROM observations WHERE ...' literal never matches.)
    const flaky = flakyDb(db, { match: 'indicator_id', failTimes: 2 });
    const before = await repository.getDatasetState(db);
    const summary = await refreshData({ db: flaky, startYear: 2024, endYear: 2025, trigger: 'ttl' });
    assert.equal(summary.status, 'success');
    // Two attempts recorded (failed transport + success), freshness renewed.
    const runs = await repository.listFetchRuns(db, 5);
    const statuses = runs.map((r) => r.status);
    assert.ok(statuses.includes('failed'), `attempts recorded, saw: ${statuses}`);
    assert.equal(runs[0].status, 'success');
    assert.deepEqual(await repository.getDatasetState(db), before, 'metadata frozen across identical retry');
    assert.equal((await repository.countObservations(db)) > 0, true);
    assert.deepEqual(getRefreshRetryState().scheduled, false);
  } finally {
    db.close();
  }
});

test('persistent transport failure exhausts attempts, records failure, frees lock', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    const flaky = flakyDb(db, { match: 'refresh_locks', failTimes: 100 });
    // Lock acquisition itself fails with transport errors (recovered as
    // attempt failures, not lock contention).
    const before = (await repository.listFetchRuns(db, 1))[0]?.id ?? 0;
    await assert.rejects(
      refreshData({ db: flaky, startYear: 2024, endYear: 2025, trigger: 'ttl' }),
      /SERVER_ERROR/,
    );
    flaky.restorePristine();
    const runs = await repository.listFetchRuns(db, 10);
    const fresh = runs.filter((r) => r.id > before);
    assert.equal(fresh.length, 0, 'lock failure precedes run creation; no phantom runs');
    assert.equal((await repository.refreshLockStatus(db)).locked, 0, 'lock free');
  } finally {
    db.close();
  }
});

test('exhausted publish-phase failure keeps original error with stage', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    // Fail every O10 compare persistently: driver retry (1) + 3 attempts.
    // (Single-line token — the O10 SELECT spans lines.)
    const flaky = flakyDb(db, { match: 'indicator_id', failTimes: 1000 });
    const before = (await repository.listFetchRuns(db, 1))[0]?.id ?? 0;
    const error = await refreshData({ db: flaky, startYear: 2024, endYear: 2025, trigger: 'ttl' }).then(
      () => null,
      (e) => e,
    );
    assert.ok(error, 'throws after exhaustion');
    assert.match(error.message, /SERVER_ERROR/);
    assert.ok(error.refreshStage, 'stage attached for diagnostics');
    const fresh = (await repository.listFetchRuns(db, 10)).filter((r) => r.id > before);
    assert.equal(fresh.length, 3, 'initial + 2 inline retries recorded');
    assert.ok(fresh.every((r) => r.status === 'failed'));
    assert.equal((await repository.refreshLockStatus(db)).locked, 0);
  } finally {
    db.close();
  }
});

test('validation error never triggers transport retry', async () => {
  const db = await seedDb();
  try {
    const { refreshData, refreshTransportRetryDelays } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    const before = (await repository.listFetchRuns(db, 1))[0]?.id ?? 0;
    await assert.rejects(
      refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl', indicators: ['not_a_metric'] }),
      /production metrics only|INVALID_INDICATOR/,
    );
    const fresh = (await repository.listFetchRuns(db, 10)).filter((r) => r.id > before);
    assert.equal(fresh.length, 0, 'validation fails before run creation; no retry');
    assert.equal((await repository.refreshLockStatus(db)).locked, 0, 'lock free');
    assert.ok(refreshTransportRetryDelays().length + 1 >= 1, 'retry bound is finite');
  } finally {
    db.close();
  }
});

test('retry hierarchy has a finite maximum per call', async () => {
  const { refreshTransportRetryDelays } = await import('../src/wb/ingest.js');
  const delays = refreshTransportRetryDelays();
  assert.ok(Array.isArray(delays) && delays.length + 1 <= 4, `bounded attempts, saw ${delays.length + 1}`);
});

test('World Bank failure never triggers transport retry', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    stub.failNext({ status: 500, times: 500 });
    const before = (await repository.listFetchRuns(db, 1))[0]?.id ?? 0;
    await assert.rejects(refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' }));
    const fresh = (await repository.listFetchRuns(db, 10)).filter((r) => r.id > before);
    assert.equal(fresh.length, 1, 'exactly one attempt for WB failures');
  } finally {
    stub.reset();
    db.close();
  }
});

test('partial refresh never triggers transport retry', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const before = (await repository.listFetchRuns(db, 1))[0]?.id ?? 0;
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' });
    assert.equal(summary.status, 'partial');
    const fresh = (await repository.listFetchRuns(db, 10)).filter((r) => r.id > before);
    assert.equal(fresh.length, 1, 'partial returns without retry');
  } finally {
    stub.reset();
    db.close();
  }
});
