/**
 * PHASE 8F — DATABASE TARGET STATE + RECOVERY + RUN-LIMIT 5.
 *
 * The public Status payload reports the ACTUAL active handle with a safe
 * logical label (never hostnames/secrets); the visible history is exactly
 * the latest 5 runs (history preserved in the database); and a guarded
 * fallback promotes back to a revalidated primary without hot-swapping
 * under load. No test touches the live World Bank API (stub) or Turso.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
  process.env.WB_RECOVERY_REPROBE_MS = '0';
  process.env.WB_RECOVERY_PROBE_TIMEOUT_MS = '5000';
  // Existing tests below assert immediate promotion; the confirmation
  // window (Phase 8L) is covered by dedicated tests with explicit windows.
  process.env.WB_RECOVERY_CONFIRM_MS = '0';
});

test.after(async () => {
  delete process.env.WB_RECOVERY_REPROBE_MS;
  delete process.env.WB_RECOVERY_PROBE_TIMEOUT_MS;
  delete process.env.WB_RECOVERY_CONFIRM_MS;
  await stub?.close();
  stub = null;
});

test('public labels never expose hostnames, URLs, or secrets', async () => {
  const { publicDatabaseTarget } = await import('../src/server.js');
  assert.deepEqual(publicDatabaseTarget({ provider: 'turso', isProduction: true }), {
    provider: 'turso',
    context: 'production',
    label: 'Turso (production)',
    fallback: false,
  });
  assert.deepEqual(publicDatabaseTarget({ provider: 'sqlite', isProduction: false }), {
    provider: 'sqlite',
    context: 'local',
    label: 'Local SQLite',
    fallback: false,
  });
  assert.deepEqual(publicDatabaseTarget({ provider: 'sqlite', isFallback: true, isProduction: true }), {
    provider: 'sqlite',
    context: 'production-fallback',
    label: 'Local SQLite (production fallback)',
    fallback: true,
  });
  // Even a hostile info object carrying network details stays private.
  const hostile = publicDatabaseTarget({
    provider: 'turso',
    isProduction: true,
    host: 'wdi-analytics-xyz.turso.io',
    url: 'libsql://secret.turso.io',
    authToken: 'sekret',
  });
  assert.equal(hostile.label, 'Turso (production)');
  const serialized = JSON.stringify(hostile);
  assert.ok(!/turso\.io/i.test(serialized), 'no hostname leaks');
  assert.ok(!/sekret|token|libsql:\/\//i.test(serialized), 'no secrets leak');
});

test('data-status label follows the ACTIVE handle via the documented seam', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const { createApp, setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  stub.reset();
  const db = await createMemoryDb();
  try {
    await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
    const previous = getActiveDbInfo();
    try {
      const app = createApp({ db, autoRefresh: false });
      let server = null;
      try {
        await new Promise((resolve) => {
          server = app.listen(0, '127.0.0.1', resolve);
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        const labelOf = async () => (await (await fetch(`${base}/api/data-status`)).json()).database;

        setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false, isProduction: true });
        assert.equal((await labelOf()).label, 'Turso (production)');

        setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
        assert.equal((await labelOf()).label, 'Local SQLite (production fallback)');

        setActiveDbInfo({ provider: 'sqlite', isFallback: false, isDegraded: false, isProduction: false });
        assert.equal((await labelOf()).label, 'Local SQLite');

        const payload = JSON.stringify(await (await fetch(`${base}/api/data-status`)).json());
        assert.ok(!/turso\.io/i.test(payload), 'no hostname anywhere on the public payload');
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      setActiveDbInfo(previous);
    }
  } finally {
    db.close();
  }
});

test('visible history is exactly the latest 5 runs; history is preserved', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const { createApp } = await import('../src/server.js');
  stub.reset();
  const db = await createMemoryDb();
  let server = null;
  try {
    for (let i = 0; i < 7; i += 1) {
      stub.reset();
      const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' });
      assert.equal(summary.status, 'success');
    }
    const all = await repository.listFetchRuns(db, 20);
    assert.equal(all.length, 7, 'all 7 runs preserved in the database');
    const app = createApp({ db, autoRefresh: false });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(body.latestRuns.length, 5, 'payload carries exactly 5 runs');
    const expected = all.slice(0, 5).map((r) => r.id);
    assert.deepEqual(
      body.latestRuns.map((r) => r.id),
      expected,
      'the five newest (N..N-4); older runs not rendered',
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('recovery promotes a revalidated primary and flips the label', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { maybeRecoverPrimary, setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  const fallbackDb = await createMemoryDb();
  const primaryDb = await createMemoryDb();
  const previous = getActiveDbInfo();
  try {
    setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction: true });
    const shared = { current: fallbackDb, isFallback: true, isDegraded: false };
    const result = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primaryDb,
    });
    assert.equal(result.recovered, true);
    assert.equal(shared.current, primaryDb, 'future traffic serves the primary');
    assert.equal(shared.isFallback, false);
    assert.equal(getActiveDbInfo().provider, 'turso');
  } finally {
    setActiveDbInfo(previous);
    fallbackDb.close();
    primaryDb.close();
  }
});

test('recovery never swaps during an active refresh or held lock', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { maybeRecoverPrimary } = await import('../src/server.js');
  const fallbackDb = await createMemoryDb();
  try {
    // Held fallback lock: a refresh owns the handle — stay put.
    const held = await repository.acquireRefreshLock(fallbackDb, { holder: 'test-holder' });
    assert.equal(held, true);
    try {
      const shared = { current: fallbackDb, isFallback: true, isDegraded: false };
      const result = await maybeRecoverPrimary(shared, {
        configuredMode: 'turso',
        createProbe: async () => ({ marker: 'primary' }),
      });
      assert.equal(result.recovered, false);
      assert.equal(result.reason, 'lock-held');
      assert.equal(shared.current, fallbackDb, 'handle untouched');
      assert.equal(shared.isFallback, true);
    } finally {
      await repository.forceReleaseRefreshLock(fallbackDb, 'test release');
    }
  } finally {
    fallbackDb.close();
  }
});

test('recovery stays on fallback when the primary is unavailable', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { maybeRecoverPrimary } = await import('../src/server.js');
  const fallbackDb = await createMemoryDb();
  try {
    const shared = { current: fallbackDb, isFallback: true, isDegraded: false };
    const unreachable = await maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => null,
    });
    assert.equal(unreachable.recovered, false);
    assert.equal(unreachable.reason, 'primary-unavailable');
    assert.equal(shared.current, fallbackDb);
    // Non-Turso configuration has nothing to recover to.
    const localOnly = await maybeRecoverPrimary(shared, { configuredMode: 'local' });
    assert.equal(localOnly.recovered, false);
    assert.equal(localOnly.reason, 'primary-not-turso');
    // Degraded mode is out of scope for hot recovery (restart path owns it).
    const degraded = await maybeRecoverPrimary(
      { current: fallbackDb, isFallback: false, isDegraded: true },
      { configuredMode: 'turso' },
    );
    assert.equal(degraded.recovered, false);
  } finally {
    fallbackDb.close();
  }
});
