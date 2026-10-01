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
    // Age the primary a generation behind the fallback (same rows, older
    // retrieval evidence) without touching fallback.
    await primary.execute({ sql: "UPDATE fetch_runs SET started_at = '2020-01-01T00:00:00.000Z', completed_at = '2020-01-01T00:00:10.000Z'", args: [] });
    await primary.execute({ sql: "UPDATE observations SET fetched_at = '2020-01-01T00:00:10.000Z'", args: [] });
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
