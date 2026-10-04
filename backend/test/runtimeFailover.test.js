/**
 * PHASE 8I — RUNTIME TURSO→SQLITE FAILOVER MATRIX (controlled tests).
 *
 * A genuine transport failure against a Turso primary (after the existing
 * bounded retries) promotes validated local SQLite for FUTURE requests;
 * idempotent GETs retry once, writes propagate their (already rolled back)
 * failure. Only transport-class errors fail over — never app/SQL/WB errors —
 * and DB_MODE=local / fallback-disabled configurations never switch.
 * No test touches live Turso or the live World Bank API (stub + memory DBs).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;
let previousTarget = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
  process.env.WB_RETRY_BASE_MS = '20';
  process.env.WB_READ_RETRY_DELAY_MS = '5';
  process.env.WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS = '10,20';
  process.env.WB_FAILOVER_COOLDOWN_MS = '0';
  process.env.WB_RECOVERY_REPROBE_MS = '0';
  process.env.WB_RECOVERY_PROBE_TIMEOUT_MS = '5000';
  // Existing promotion tests assert immediate switch-back; confirmation
  // windows (Phase 8L) are covered by dedicated tests with explicit windows.
  process.env.WB_RECOVERY_CONFIRM_MS = '0';
  const { getActiveDbInfo } = await import('../src/server.js');
  previousTarget = getActiveDbInfo();
});

test.after(async () => {
  delete process.env.WB_RETRY_BASE_MS;
  delete process.env.WB_READ_RETRY_DELAY_MS;
  delete process.env.WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS;
  delete process.env.WB_FAILOVER_COOLDOWN_MS;
  delete process.env.WB_RECOVERY_REPROBE_MS;
  delete process.env.WB_RECOVERY_PROBE_TIMEOUT_MS;
  delete process.env.WB_RECOVERY_CONFIRM_MS;
  const { setActiveDbInfo } = await import('../src/server.js');
  setActiveDbInfo(previousTarget);
  await stub?.close();
  stub = null;
});

function transportError() {
  const error = new Error('SERVER_ERROR: Server returned HTTP status 404');
  error.name = 'LibsqlError';
  error.code = 'SERVER_ERROR';
  return error;
}

/** Wrap a handle so matching execute()/batch() calls fail like dead Turso. */
function deadTurso(handle, { match = '', failTimes = 100000 } = {}) {
  let remaining = failTimes;
  let opens = 0;
  const wrap = (target) => {
    const origExec = target.execute.bind(target);
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
      target.batch = (...args) => {
        const sql = String(args[0]?.[0]?.sql ?? args[0]?.sql ?? '');
        if (remaining > 0 && (match === '' || sql.includes(match))) {
          remaining -= 1;
          return Promise.reject(transportError());
        }
        return origBatch(...args);
      };
    }
    if (target.transaction) {
      const origTx = target.transaction.bind(target);
      target.transaction = async (...args) => wrap(await origTx(...args));
    }
    return target;
  };
  const wrapped = wrap(handle);
  wrapped.failoverOpens = () => opens;
  wrapped.countOpen = () => {
    opens += 1;
  };
  return wrapped;
}

async function seedDb(range = {}) {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({
    db,
    startYear: range.start ?? 2024,
    endYear: range.end ?? 2025,
    trigger: 'test-seed',
  });
  assert.equal(summary.status, 'success');
  return db;
}

function appWithShared(shared) {
  return import('../src/server.js').then(({ createApp }) => createApp({ shared, autoRefresh: false }));
}

async function listen(app) {
  let server = null;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function authHeaders() {
  const { default: runtimeConfig } = await import('../src/config.js');
  const headers = { 'Content-Type': 'application/json' };
  if (runtimeConfig.refreshAdminToken) headers.Authorization = `Bearer ${runtimeConfig.refreshAdminToken}`;
  return headers;
}

test('1. healthy Turso primary serves normally with no failover', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  let opens = 0;
  const shared = {
    current: primary,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opens += 1;
        return { handle: fallback };
      },
    },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    for (const path of ['/api/years', '/api/countries', '/api/indicators']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
    assert.equal(shared.current, primary, 'handle untouched');
    assert.equal(opens, 0, 'no fallback validation while healthy');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('2/3. DB_MODE=local and fallback-disabled never switch targets', async () => {
  const primary = await seedDb();
  for (const policy of [
    { mode: 'local', allowFallback: true },
    { mode: 'turso', allowFallback: false },
  ]) {
    let opens = 0;
    const dead = deadTurso(primary, {});
    const shared = {
      current: dead,
      isFallback: false,
      isDegraded: false,
      failoverPolicy: { ...policy, openFallback: async () => ({ handle: primary }) },
    };
    void opens;
    const app = await appWithShared(shared);
    const { server, base } = await listen(app);
    try {
      const res = await fetch(`${base}/api/years`);
      assert.equal(res.status, 500, `${policy.mode}/fallback=${policy.allowFallback}: error surfaces`);
      assert.equal(shared.isFallback, false, 'no promotion under local primary or disabled fallback');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  primary.close();
});

test('4. application errors never trigger failover', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const primary = await seedDb();
  let opens = 0;
  const shared = {
    current: primary,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opens += 1;
        return { handle: primary };
      },
    },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/ranking?indicator=nope&year=2025`);
    assert.equal(res.status, 400);
    assert.equal(opens, 0, 'validation failure validates nothing');
    assert.equal(shared.isFallback, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
  }
});

test('5. World Bank outage never triggers database failover', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const primary = await seedDb();
  let opens = 0;
  const shared = {
    current: primary,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opens += 1;
        return { handle: primary };
      },
    },
    // Recovery must never touch the network in this test: WB outage first.
    recoveryPolicy: { configuredMode: 'local' },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    stub.reset();
    stub.failNext({ status: 500, times: 500 });
    const res = await fetch(`${base}/api/data/refresh`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 500, 'WB failure surfaces as refresh failure');
    assert.equal(opens, 0, 'a World Bank outage never fails over the database');
    assert.equal(shared.current, primary);
    assert.equal(shared.isFallback, false);
  } finally {
    stub.reset();
    await new Promise((resolve) => server.close(resolve));
    primary.close();
  }
});

test('6/7/8. missing or unusable local DB means no failover; valid DB promotes', async () => {
  const { maybeFailoverToFallback } = await import('../src/server.js');
  const primary = await seedDb();
  const validFallback = await seedDb();
  try {
    for (const [name, openFallback] of [
      ['missing', async () => null],
      ['unreadable', async () => {
        throw new Error('EACCES');
      }],
    ]) {
      const shared = { current: primary, isFallback: false, isDegraded: false };
      const outcome = await maybeFailoverToFallback(shared, {
        mode: 'turso',
        allowFallback: true,
        openFallback,
      });
      assert.equal(outcome.failedOver, false, name);
      assert.equal(shared.current, primary, `${name}: handle untouched`);
    }
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const outcome = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: validFallback }),
    });
    assert.equal(outcome.failedOver, true);
    assert.equal(shared.current, validFallback);
    assert.equal(shared.isFallback, true);
  } finally {
    primary.close();
    validFallback.close();
  }
});

test('3/9/19. transport failure on GET fails over; fallback serves; status reports it', async () => {
  const { setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const dead = deadTurso(primary, {});
  let opens = 0;
  const shared = {
    current: dead,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opens += 1;
        return { handle: fallback };
      },
    },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const years = await fetch(`${base}/api/years`);
    assert.equal(years.status, 200, 'same GET succeeds on fallback after failover');
    const body = await years.json();
    assert.ok(Array.isArray(body.years) && body.years.length > 0);
    assert.equal(shared.isFallback, true);
    assert.equal(shared.current, fallback);
    assert.equal(getActiveDbInfo().provider, 'sqlite');
    assert.equal(getActiveDbInfo().isFallback, true);
    // Further analytical GETs serve from fallback; validation runs once.
    for (const path of ['/api/countries', '/api/indicators', '/api/data-status']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
    assert.equal(opens, 1, 'single validation, no per-request re-probing');
    const status = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(status.database?.label, 'Local SQLite (production fallback)');
    assert.ok(!/turso\.io/i.test(JSON.stringify(status.database)), 'no hostname leaks');
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, 'server stays alive');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('8K-immediate: the first status after failover already reports fallback', async () => {
  const { setActiveTarget, getActiveDbInfo, publicDatabaseTarget, activeTargetOf } = await import(
    '../src/server.js'
  );
  const primary = await seedDb();
  const fallback = await seedDb();
  const previous = getActiveDbInfo();
  try {
    // One authoritative transition updates cell and mirror together.
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const record = setActiveTarget(shared, { handle: fallback, provider: 'sqlite', isFallback: true, isDegraded: false });
    assert.equal(shared.current, fallback);
    assert.equal(shared.provider, 'sqlite');
    assert.equal(record.provider, 'sqlite');
    assert.deepEqual(getActiveDbInfo().provider, 'sqlite');
    assert.equal(publicDatabaseTarget(activeTargetOf(shared)).label, 'Local SQLite (production fallback)');
    // And back: a single transition restores Turso on both.
    setActiveTarget(shared, { handle: primary, provider: 'turso', isFallback: false, isDegraded: false });
    assert.equal(publicDatabaseTarget(activeTargetOf(shared)).label, 'Turso');
  } finally {
    const { setActiveDbInfo } = await import('../src/server.js');
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('8K-immediate: failover then data-status with no request in between', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const dead = deadTurso(primary, {});
  const shared = {
    current: dead,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    // The request that detects the outage fails over; the VERY NEXT request
    // — a status poll — must already report fallback. Never Turso.
    const dying = await fetch(`${base}/api/observations?indicator=nominal_current&year=2025&country=IND`);
    assert.equal(dying.status, 200, 'detecting GET retries once on fallback');
    assert.equal(shared.isFallback, true);
    const status = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(status.database?.label, 'Local SQLite (production fallback)');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('8K-immediacy ignores the recovery cooldown (failover is never probe-gated)', async () => {
  const { maybeFailoverToFallback, maybeRecoverPrimary } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previousReprobe = process.env.WB_RECOVERY_REPROBE_MS;
  process.env.WB_RECOVERY_REPROBE_MS = '3600000';
  try {
    // Arm a recent recovery probe timestamp first.
    await maybeRecoverPrimary(
      { current: fallback, isFallback: true, isDegraded: false },
      { configuredMode: 'turso', createProbe: async () => null },
    );
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const outcome = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    });
    assert.equal(outcome.failedOver, true, 'failover stays immediate under recovery cooldown');
    assert.equal(shared.current, fallback);
  } finally {
    process.env.WB_RECOVERY_REPROBE_MS = previousReprobe ?? '0';
    primary.close();
    fallback.close();
  }
});

test('8K-background: transport death in TTL refresh offers failover; validation does not', async () => {
  const { maybeAutoRefresh, cancelScheduledRefreshRetry } = await import('../src/wb/ingest.js');
  const { isTransportError } = await import('../src/db/driver.js');
  // NOTE: config.cacheTtlHours freezes at first import, so staleness is
  // forced via the explicit ttlHours option (env changes mid-file are inert).
  const db = await seedDb();
  const db2 = await seedDb();
  const flaky = deadTurso(db, { match: 'indicator_id', failTimes: 100000 });
  const { isRefreshInProgress } = await import('../src/wb/ingest.js');
  const waitFor = async (condition, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await condition();
  };
  try {
    const seen = [];
    const decision = await maybeAutoRefresh(flaky, {
      ttlHours: 0,
      onTransportFailure: (error) => {
        seen.push(error);
      },
    });
    assert.equal(decision.triggered, true, `triggered (${decision.reason})`);
    // The background attempt fails asynchronously (after bounded inline
    // retries); wait until it settles and released the process lock.
    assert.equal(
      await waitFor(() => seen.length === 1 && !isRefreshInProgress(), 20000),
      true,
      'background transport death signals exactly once, then releases',
    );
    assert.equal(seen.length, 1, 'exactly one transport-failure signal per failed attempt');
    assert.equal(isTransportError(seen[0]), true);
    // A per-indicator World Bank failure is not a database outage: the run
    // goes partial (no throw) and offers no failover signal. Uses the
    // UNWRAPPED handle: the flaky wrapper above would poison O10 reads.
    const seenValidation = [];
    stub.reset();
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.PCAP.CD' });
    const partial = await maybeAutoRefresh(db2, {
      ttlHours: 0,
      onTransportFailure: (error) => {
        seenValidation.push(error);
      },
    });
    assert.equal(partial.triggered, true);
    const repository = await import('../src/db/repository.js');
    assert.equal(
      await waitFor(async () => {
        const latest = await repository.listFetchRuns(db2, 1);
        return latest.length > 0 && latest[0].status === 'partial' && !isRefreshInProgress();
      }, 40000),
      true,
      'partial run recorded and settled',
    );
    assert.equal(seenValidation.length, 0, 'no failover signal for WB failures');
  } finally {
    stub.reset();
    cancelScheduledRefreshRetry();
    db.close();
    db2.close();
  }
});

test('concurrent failing GETs share one failover validation', async () => {
  const primary = await seedDb();
  const fallback = await seedDb();
  const dead = deadTurso(primary, {});
  let opens = 0;
  const shared = {
    current: dead,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => {
        opens += 1;
        return { handle: fallback };
      },
    },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => fetch(`${base}/api/years`).then((r) => r.status)),
    );
    assert.deepEqual(results, [200, 200, 200, 200, 200]);
    assert.equal(opens, 1, 'single-flight validation under concurrency');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('10/11/12. stale fallback refreshes; unchanged writes nothing; changed is selective', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const fallback = await seedDb();
  const shared = {
    current: fallback,
    isFallback: true,
    isDegraded: false,
    // Recovery must never touch the network in this test.
    recoveryPolicy: { configuredMode: 'local' },
  };
  setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const headers = await authHeaders();
    const stateBefore = await repository.getDatasetState(fallback);
    const countBefore = await repository.countObservations(fallback);
    // Manual refresh on the active fallback handle succeeds.
    const first = await (
      await fetch(`${base}/api/data/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ startYear: 2024, endYear: 2025 }),
      })
    ).json();
    assert.equal(first.status, 'success');
    // Unchanged refresh: zero observation writes, version frozen.
    const second = await (
      await fetch(`${base}/api/data/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ startYear: 2024, endYear: 2025 }),
      })
    ).json();
    assert.equal(second.status, 'success');
    assert.equal(second.rowsUpserted, 0, 'O10 holds on fallback');
    assert.equal(await repository.countObservations(fallback), countBefore);
    assert.deepEqual(await repository.getDatasetState(fallback), stateBefore, 'content_version frozen');
    // Changed refresh: exactly the touched indicator rewrites, rest skip.
    await fallback.execute({
      sql: 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    const third = await (
      await fetch(`${base}/api/data/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ startYear: 2024, endYear: 2025 }),
      })
    ).json();
    assert.equal(third.status, 'success');
    assert.ok(third.rowsUpserted > 0, 'changed indicator published');
    assert.ok(third.rowsSkippedUnchanged > 0, 'unchanged indicators still skipped');
    assert.equal(await repository.countObservations(fallback), countBefore, 'row count restored exactly');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fallback.close();
  }
});

test('17. refresh-transaction failure fails over afterward with locks clean', async () => {
  const { setActiveDbInfo } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const dead = deadTurso(primary, {});
  const shared = {
    current: dead,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    },
    // Recovery must never touch the network in this test.
    recoveryPolicy: { configuredMode: 'local' },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    // The refresh itself fails (nothing staged can publish); the error
    // middleware then promotes fallback for FUTURE requests — the failed
    // attempt is never misreported as success.
    const res = await fetch(`${base}/api/data/refresh`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ startYear: 2024, endYear: 2025 }),
    });
    assert.equal(res.status, 500, 'failed primary transaction surfaces');
    assert.equal(shared.isFallback, true, 'fallback active afterward');
    assert.equal(shared.current, fallback);
    assert.equal((await repository.refreshLockStatus(fallback)).locked, 0, 'fallback lock free');
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    // The NEXT refresh transparently runs against fallback.
    const next = await (
      await fetch(`${base}/api/data/refresh`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ startYear: 2024, endYear: 2025 }),
      })
    ).json();
    assert.equal(next.status, 'success');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('18. in-flight handles survive the switch; old handle never closed', async () => {
  const { maybeFailoverToFallback } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  try {
    const captured = primary;
    const before = await repository.countObservations(captured);
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const outcome = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    });
    assert.equal(outcome.failedOver, true);
    assert.equal(await repository.countObservations(captured), before, 'captured handle still readable');
    assert.equal(await repository.countObservations(shared.current), before);
  } finally {
    primary.close();
    fallback.close();
  }
});

test('15. older primary never regresses fresher fallback; catch-up reconciles', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previous = getActiveDbInfo();
  try {
    // Age the primary a generation behind the fallback AND diverge one
    // stored value, so only a real catch-up refresh can reconcile.
    await primary.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await primary.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await fallback.execute({
      sql: 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    const fbCount = await repository.countObservations(fallback);
    const fbState = await repository.getDatasetState(fallback);
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    // Fast path refuses to regress.
    const fast = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
      reconcile: false,
    });
    assert.equal(fast.recovered, false);
    assert.equal(fast.reason, 'primary-behind');
    assert.equal(shared.current, fallback, 'still serving fallback');
    // Reconciling path refreshes Turso through the normal pipeline, then promotes.
    const slow = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(slow.recovered, true);
    assert.equal(shared.current, primary);
    assert.equal(getActiveDbInfo().provider, 'turso');
    // Fallback dataset untouched; primary caught up without regression.
    assert.equal(await repository.countObservations(fallback), fbCount);
    assert.deepEqual(await repository.getDatasetState(fallback), fbState);
    const primaryFp = await repository.getDatasetFingerprint(primary);
    assert.ok(primaryFp.lastSuccessAt > '2020-06-01T00:00:00.000Z', 'primary evidence renewed by catch-up');
  } finally {
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('15b. identical content promotes with zero fetch and zero writes', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previous = getActiveDbInfo();
  try {
    // Same stored content, only older retrieval stamps on the primary: the
    // fast path must promote with no World Bank fetch and no writes at all.
    await primary.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await primary.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
    const runsBefore = (await repository.listFetchRuns(primary, 100)).length;
    stub.reset();
    const wbBefore = stub.requestCount();
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    const result = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(result.recovered, true);
    assert.equal(shared.current, primary);
    assert.equal(getActiveDbInfo().provider, 'turso');
    assert.equal(stub.requestCount(), wbBefore, 'no World Bank fetch during fast-path promotion');
    assert.equal(
      (await repository.listFetchRuns(primary, 100)).length,
      runsBefore,
      'no fetch_runs bookkeeping written during fast-path promotion',
    );
  } finally {
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('16. cooldowns prevent oscillation in both directions', async () => {
  const { maybeFailoverToFallback, maybeRecoverPrimary } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previousEnv = process.env.WB_FAILOVER_COOLDOWN_MS;
  const previousReprobe = process.env.WB_RECOVERY_REPROBE_MS;
  process.env.WB_FAILOVER_COOLDOWN_MS = '60000';
  process.env.WB_RECOVERY_REPROBE_MS = '60000';
  try {
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const first = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => null,
    });
    // Either a fresh validation (no usable fallback) or the cooldown from an
    // earlier validation in this file — both mean "no promotion, no storm".
    assert.ok(['no-valid-fallback', 'cooldown'].includes(first.reason), first.reason);
    const second = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    });
    assert.equal(second.reason, 'cooldown', 'no repeated validation inside the window');
    assert.equal(shared.isFallback, false);
    const rec = await maybeRecoverPrimary(
      { current: fallback, isFallback: true, isDegraded: false },
      { configuredMode: 'turso', createProbe: async () => primary },
    );
    assert.equal(rec.reason, 'cooldown', 'no probe storm either direction');
  } finally {
    process.env.WB_FAILOVER_COOLDOWN_MS = previousEnv ?? '0';
    process.env.WB_RECOVERY_REPROBE_MS = previousReprobe ?? '0';
    primary.close();
    fallback.close();
  }
});

test('8L-confirmation: healthy primary promotes only after the stability window', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo, resetRecoveryConfirmation } =
    await import('../src/server.js');
  // Seed fallback FIRST so the primary is never newer: the generations stay
  // equivalent and the test exercises the window, not the reconcile path.
  // Reconcile cooldown is disabled so leftover state cannot interfere.
  const fallback = await seedDb();
  const primary = await seedDb();
  const previous = getActiveDbInfo();
  const previousConfirm = process.env.WB_RECOVERY_CONFIRM_MS;
  const previousReconcileWindow = process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
  process.env.WB_RECOVERY_CONFIRM_MS = '400';
  process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '0';
  resetRecoveryConfirmation();
  try {
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    // First healthy probe starts the window but must NOT promote yet.
    const first = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(first.reason, 'confirming');
    assert.equal(first.recovered, false);
    assert.equal(shared.current, fallback, 'still serving fallback mid-window');
    assert.equal(shared.isFallback, true);
    // Inside the window a further healthy probe still waits.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const mid = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(mid.reason, 'confirming');
    assert.equal(shared.isFallback, true);
    // Past the window with continued health: promote with the Turso label.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const done = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(done.recovered, true);
    assert.equal(shared.current, primary);
    assert.equal(shared.isFallback, false);
    assert.equal(getActiveDbInfo().provider, 'turso');
  } finally {
    if (previousConfirm === undefined) delete process.env.WB_RECOVERY_CONFIRM_MS;
    else process.env.WB_RECOVERY_CONFIRM_MS = previousConfirm;
    resetRecoveryConfirmation();
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('8L-confirmation: unhealthy probe during the window cancels promotion', async () => {
  const { maybeRecoverPrimary, resetRecoveryConfirmation } = await import('../src/server.js');
  const fallback = await seedDb();
  const primary = await seedDb();
  const previousConfirm = process.env.WB_RECOVERY_CONFIRM_MS;
  const previousReconcileWindow = process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
  // Short window: the confirmation tick is max(50 ms, window/4), so a brief
  // sleep crosses into the next probe slot deterministically.
  process.env.WB_RECOVERY_CONFIRM_MS = '400';
  process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '0';
  resetRecoveryConfirmation();
  try {
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    const probe = { calls: 0 };
    const flappingProbe = async () => {
      probe.calls += 1;
      return probe.calls === 1 ? primary : null;
    };
    assert.equal(
      (await maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe: flappingProbe })).reason,
      'confirming',
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      (await maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe: flappingProbe })).reason,
      'primary-unavailable',
      'unhealthy probe cancels the window instead of promoting later',
    );
    assert.equal(shared.current, fallback);
    assert.equal(shared.isFallback, true);
  } finally {
    if (previousConfirm === undefined) delete process.env.WB_RECOVERY_CONFIRM_MS;
    else process.env.WB_RECOVERY_CONFIRM_MS = previousConfirm;
    if (previousReconcileWindow === undefined) delete process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
    else process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = previousReconcileWindow;
    resetRecoveryConfirmation();
    primary.close();
    fallback.close();
  }
});

test('8L-logs: failover emits the full terminal state sequence', async () => {
  const { maybeFailoverToFallback } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const lines = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    const shared = { current: primary, isFallback: false, isDegraded: false };
    const cause = Object.assign(new Error('SERVER_ERROR: Server returned HTTP status 503'), {
      name: 'LibsqlError',
      code: 'SERVER_ERROR',
    });
    const outcome = await maybeFailoverToFallback(shared, {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
      cause,
    });
    assert.equal(outcome.failedOver, true);
    const text = lines.join('\n');
    assert.ok(text.includes('Primary database unavailable: Turso (production)'), 'unavailable line');
    assert.ok(text.includes('Reason: SERVER_ERROR: Server returned HTTP status 503'), 'reason line');
    assert.ok(text.includes('Fallback enabled: yes'), 'policy line');
    assert.ok(text.includes('Valid local backup found: yes'), 'validation line');
    assert.ok(text.includes('Switching to: Local SQLite (production fallback)'), 'switch line');
    assert.ok(
      text.includes('Database failover complete: Local SQLite (production fallback)'),
      'completion line',
    );
    assert.ok(!/turso\.io|libsql:\/\/|Bearer|token/i.test(text), 'no hosts, URLs, or secrets in logs');
  } finally {
    console.warn = origWarn;
    primary.close();
    fallback.close();
  }
});

test('8M-harness: dev endpoints absent unless explicitly enabled outside production', async () => {
  const primary = await seedDb();
  // Neutralize the ambient developer .env (which enables the harness) so
  // this test proves the default-off behavior hermetically.
  const savedAmbientFlag = process.env.ALLOW_DEV_HOOKS;
  delete process.env.ALLOW_DEV_HOOKS;
  try {
    const app = await appWithShared({ current: primary, isFallback: false, isDegraded: false });
    const { server, base } = await listen(app);
    try {
      assert.equal((await fetch(`${base}/api/dev/db-state`)).status, 404);
      assert.equal(
        (await fetch(`${base}/api/dev/db-fail-primary`, { method: 'POST' })).status,
        404,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const savedNodeEnv = process.env.NODE_ENV;
    const savedFlag = process.env.ALLOW_DEV_HOOKS;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_HOOKS = '1';
    try {
      const prodApp = await appWithShared({ current: primary, isFallback: false, isDegraded: false });
      const started = await listen(prodApp);
      try {
        assert.equal((await fetch(`${started.base}/api/dev/db-state`)).status, 404);
      } finally {
        await new Promise((resolve) => started.server.close(resolve));
      }
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
      if (savedFlag === undefined) delete process.env.ALLOW_DEV_HOOKS;
      else process.env.ALLOW_DEV_HOOKS = savedFlag;
    }
  } finally {
    if (savedAmbientFlag === undefined) delete process.env.ALLOW_DEV_HOOKS;
    else process.env.ALLOW_DEV_HOOKS = savedAmbientFlag;
    primary.close();
  }
});

test('8M-harness: arm breaks the live primary, heal restores it', async () => {
  const savedFlag = process.env.ALLOW_DEV_HOOKS;
  process.env.ALLOW_DEV_HOOKS = '1';
  const primary = await seedDb();
  const fallback = await seedDb();
  const { setActiveDbInfo } = await import('../src/server.js');
  const shared = {
    current: primary,
    provider: 'turso',
    isFallback: false,
    isDegraded: false,
    failoverPolicy: {
      mode: 'turso',
      allowFallback: true,
      openFallback: async () => ({ handle: fallback }),
    },
    recoveryPolicy: { configuredMode: 'local' },
  };
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: false });
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  try {
    const state = await (await fetch(`${base}/api/dev/db-state`)).json();
    assert.equal(state.active.provider, 'turso');
    assert.equal(state.armed, false);
    assert.equal(state.policyMode, 'turso');
    // Arm: the LIVE handle now throws transport errors on every statement.
    assert.equal((await (await fetch(`${base}/api/dev/db-fail-primary`, { method: 'POST' })).json()).armed, true);
    // A normal GET fails over through the real middleware and serves fallback.
    const years = await fetch(`${base}/api/years`);
    assert.equal(years.status, 200);
    assert.equal(shared.isFallback, true);
    assert.equal(shared.current, fallback);
    const status = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(status.database?.label, 'Local SQLite (production fallback)');
    // Heal: original methods restored; primary serves again on demand.
    assert.equal((await (await fetch(`${base}/api/dev/db-heal-primary`, { method: 'POST' })).json()).healed, true);
    assert.equal((await (await fetch(`${base}/api/dev/db-state`)).json()).armed, false);
  } finally {
    delete process.env.ALLOW_DEV_HOOKS;
    if (savedFlag !== undefined) process.env.ALLOW_DEV_HOOKS = savedFlag;
    await new Promise((resolve) => server.close(resolve));
    primary.close();
    fallback.close();
  }
});

test('8M-diagnostic: skipped failover names its reason without spamming', async () => {
  const primary = await seedDb();
  const lines = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    lines.push(args.join(' '));
  };
  // Fallback disabled: transport errors must say exactly why nothing switched.
  const shared = {
    current: primary,
    isFallback: false,
    isDegraded: false,
    failoverPolicy: { mode: 'turso', allowFallback: false },
  };
  const app = await appWithShared(shared);
  const { server, base } = await listen(app);
  const { setActiveDbInfo } = await import('../src/server.js');
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: false });
  // Break the handle directly (same shape the harness injects).
  const origExec = primary.execute.bind(primary);
  primary.execute = () => {
    const error = new Error('SERVER_ERROR: boom');
    error.name = 'LibsqlError';
    error.code = 'SERVER_ERROR';
    return Promise.reject(error);
  };
  try {
    assert.equal((await fetch(`${base}/api/years`)).status, 500);
    assert.equal((await fetch(`${base}/api/years`)).status, 500);
    const text = lines.join('\n');
    assert.ok(text.includes('Database transport error detected'), 'detection line');
    assert.ok(text.includes('Failover not triggered: reason = fallback-disabled'), 'exact reason');
    assert.equal(shared.isFallback, false, 'policy honored: no switch');
  } finally {
    console.warn = origWarn;
    primary.execute = origExec;
    await new Promise((resolve) => server.close(resolve));
    primary.close();
  }
});

test('8M-reconcile: failed catch-up backs off instead of hot-looping', async () => {
  const { maybeRecoverPrimary, resetRecoveryConfirmation } = await import('../src/server.js');
  const fallback = await seedDb();
  resetRecoveryConfirmation();
  const previousReconcile = process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
  process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '0';
  const backdate = async (db) => {
    await db.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await db.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
  };
  try {
    // Age the primary behind fallback AND diverge one stored value, so the
    // fast path cannot apply and the catch-up refresh actually runs — then
    // make it fail fast with a transport error (lock acquisition dies
    // immediately). NOTE: a failed candidate is closed during cleanup, so
    // each phase uses a freshly seeded primary (createMemoryDb removes its
    // files on close).
    const primary = await seedDb();
    await backdate(primary);
    await fallback.execute({
      sql: 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    const dead = deadTurso(primary, { match: 'refresh_locks' });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    const first = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => dead,
    });
    assert.equal(first.reason, 'reconcile-failed');
    assert.equal(shared.isFallback, true, 'still serving fallback');
    // Immediate re-probe inside the cooldown window: the gate returns before
    // any catch-up refresh is attempted (no new recovery work started).
    const primary2 = await seedDb();
    await backdate(primary2);
    const dead2 = deadTurso(primary2, { match: 'refresh_locks' });
    process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '3600000';
    const second = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => dead2,
    });
    assert.equal(second.reason, 'reconcile-cooldown');
    assert.equal(shared.isFallback, true, 'still serving fallback');
    primary2.close();
  } finally {
    if (previousReconcile === undefined) delete process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
    else process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = previousReconcile;
    resetRecoveryConfirmation();
    fallback.close();
  }
});

test('8N-window: identical content advances one window across probes, then promotes', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo, resetRecoveryConfirmation } =
    await import('../src/server.js');
  // Backdated stamps but byte-identical content: the fast path applies, and
  // the confirmation window must SURVIVE repeated behind-determinations
  // instead of restarting on every probe (the live 8M stall).
  const primary = await seedDb();
  const fallback = await seedDb();
  const previous = getActiveDbInfo();
  const previousConfirm = process.env.WB_RECOVERY_CONFIRM_MS;
  process.env.WB_RECOVERY_CONFIRM_MS = '400';
  resetRecoveryConfirmation();
  try {
    await primary.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await primary.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    const probe = { calls: 0 };
    const createProbe = async () => {
      probe.calls += 1;
      return primary;
    };
    // First probe opens the window but must not promote yet.
    const first = await maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe });
    assert.equal(first.reason, 'confirming');
    assert.equal(shared.isFallback, true);
    // Keep probing until the window completes: intermediate probes must keep
    // returning 'confirming' (window advances, never restarts) and the final
    // one promotes. Polling avoids brittle fixed sleeps around probe work.
    const seen = new Set(['confirming']);
    let result = first;
    const deadline = Date.now() + 15000;
    while (!result.recovered && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = await maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe });
      seen.add(result.reason);
    }
    assert.equal(result.recovered, true);
    assert.equal(result.reason, 'promoted');
    assert.ok(seen.has('confirming'), 'window observed before promotion');
    assert.equal(shared.isFallback, false);
    assert.equal(getActiveDbInfo().provider, 'turso');
  } finally {
    if (previousConfirm === undefined) delete process.env.WB_RECOVERY_CONFIRM_MS;
    else process.env.WB_RECOVERY_CONFIRM_MS = previousConfirm;
    resetRecoveryConfirmation();
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('8N-window: diverged content resets the window instead of promoting', async () => {
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo, resetRecoveryConfirmation } =
    await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previous = getActiveDbInfo();
  const previousConfirm = process.env.WB_RECOVERY_CONFIRM_MS;
  const previousReconcile = process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
  process.env.WB_RECOVERY_CONFIRM_MS = '400';
  process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '3600000';
  resetRecoveryConfirmation();
  try {
    await primary.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await primary.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
    // Diverge exactly one stored value so the fast path must refuse.
    await fallback.execute({
      sql: 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    // reconcile:false keeps the test fast: no catch-up, just the verdict.
    const verdict = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
      reconcile: false,
    });
    assert.equal(verdict.reason, 'primary-behind');
    assert.equal(shared.isFallback, true, 'stays on fallback with diverged content');
    // The diverted cycle must not have left a stale window that a later
    // equivalent probe could ride: a fresh equivalent probe starts over.
    await fallback.execute({
      sql: 'UPDATE observations SET value = value - 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    const equivalent = await repository.compareDatasetContent(primary, fallback);
    assert.equal(equivalent.identical, true);
    const next = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary,
    });
    assert.equal(next.reason, 'confirming', 'fresh window starts after divergence clears');
    assert.equal(shared.isFallback, true);
  } finally {
    if (previousConfirm === undefined) delete process.env.WB_RECOVERY_CONFIRM_MS;
    else process.env.WB_RECOVERY_CONFIRM_MS = previousConfirm;
    if (previousReconcile === undefined) delete process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS;
    else process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = previousReconcile;
    resetRecoveryConfirmation();
    setActiveDbInfo(previous);
    primary.close();
    fallback.close();
  }
});

test('8N-single-flight: concurrent recoveries share one attempt', async () => {
  const { maybeRecoverPrimary, resetRecoveryConfirmation } = await import('../src/server.js');
  const primary = await seedDb();
  const fallback = await seedDb();
  const previousConfirm = process.env.WB_RECOVERY_CONFIRM_MS;
  process.env.WB_RECOVERY_CONFIRM_MS = '0';
  resetRecoveryConfirmation();
  try {
    let probes = 0;
    let release = null;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const createProbe = async () => {
      probes += 1;
      await gate;
      return primary;
    };
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    const pending = [
      maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe }),
      maybeRecoverPrimary(shared, { configuredMode: 'turso', createProbe }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const [first, second] = await Promise.all(pending);
    assert.equal(probes, 1, 'one probe serves all concurrent callers');
    assert.equal(first, second, 'concurrent callers share the identical outcome');
    assert.equal(first.recovered, true);
  } finally {
    if (previousConfirm === undefined) delete process.env.WB_RECOVERY_CONFIRM_MS;
    else process.env.WB_RECOVERY_CONFIRM_MS = previousConfirm;
    resetRecoveryConfirmation();
    primary.close();
    fallback.close();
  }
});

test('8L-config: .env edits never hot-reload the running configuration', async () => {
  const runtimeConfig = (await import('../src/config.js')).default;
  const { resolveDbMode } = await import('../src/db/index.js');
  const frozenMode = runtimeConfig.dbMode;
  const frozenResolved = resolveDbMode();
  const savedDbMode = process.env.DB_MODE;
  const savedUrl = process.env.TURSO_DATABASE_URL;
  try {
    // Simulate "I edited .env while the process runs": mutating the
    // environment after import must not move the frozen configuration.
    process.env.DB_MODE = savedDbMode === 'local' ? 'turso' : 'local';
    process.env.TURSO_DATABASE_URL = 'libsql://edited-while-running.example.com';
    assert.equal(runtimeConfig.dbMode, frozenMode, 'config object frozen at import');
    assert.equal(resolveDbMode(), frozenResolved, 'resolved backend unchanged without restart');
  } finally {
    if (savedDbMode === undefined) delete process.env.DB_MODE;
    else process.env.DB_MODE = savedDbMode;
    if (savedUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = savedUrl;
  }
});
