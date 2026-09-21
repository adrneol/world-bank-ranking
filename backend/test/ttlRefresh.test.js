/**
 * AUTOMATIC TTL-REFRESH TESTS (specification section 14).
 *
 * The stub World Bank API stands in for the live API, so no test touches the
 * network. Every test uses its own in-memory database with auto-refresh
 * explicitly ENABLED (server.test.js covers the disabled path).
 *
 *   a. fresh cache -> no refresh
 *   b. expired cache -> exactly one refresh
 *   c. concurrent stale requests -> only one refresh
 *   d. failed refresh -> old valid data remain usable (+ cooldown, no loop)
 *   e. request after successful refresh -> no duplicate refresh
 *   f. empty DB -> boot ingestion still works
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

// Keep retry backoff tiny for the failure-path tests (set before src import).
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

async function seedViaStub(db) {
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  return refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
}

function runCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM fetch_runs').get().n;
}

function backdateLatestRun(db, hoursAgo) {
  const iso = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  db.prepare('UPDATE fetch_runs SET started_at = ?, completed_at = ? WHERE id = (SELECT MAX(id) FROM fetch_runs)').run(iso, iso);
}

async function serve(db) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: async (path) => {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, header: res.headers.get('x-auto-refresh'), body: await res.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitForIdle(timeoutMs = 60000) {
  const { isRefreshInProgress } = await import('../src/wb/ingest.js');
  const deadline = Date.now() + timeoutMs;
  while (isRefreshInProgress()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for background refresh to finish.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function indiaNominal2025(db) {
  return db
    .prepare(
      `SELECT o.value AS value FROM observations o
       JOIN indicators i ON i.id = o.indicator_id
       WHERE o.country_id = 'IND' AND i.metric_key = 'nominal_current' AND o.year = 2025`,
    )
    .get();
}

// a. fresh cache -> no refresh is triggered.
test('a. fresh cache serves requests without triggering a refresh', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = createMemoryDb();
  await seedViaStub(db);
  const before = runCount(db);

  const api = await serve(db);
  try {
    const res = await api.get('/api/india/gdp-ranking?startYear=2024&endYear=2025');
    assert.equal(res.status, 200);
    assert.equal(res.header, null, 'no background refresh on a fresh cache');
    assert.equal(runCount(db), before, 'no new fetch_runs row');
  } finally {
    await api.close();
    db.close();
  }
});

// b. expired cache -> exactly one background refresh restores freshness.
test('b. expired cache triggers exactly one background refresh', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = createMemoryDb();
  await seedViaStub(db);
  backdateLatestRun(db, 48);
  const before = runCount(db);

  const api = await serve(db);
  try {
    const res = await api.get('/api/years');
    assert.equal(res.status, 200);
    assert.equal(res.header, 'stale', 'stale request announces the triggered refresh');
    await waitForIdle();
    assert.equal(runCount(db), before + 1, 'exactly one refresh ran');

    const status = await api.get('/api/data-status');
    assert.equal(status.body.fresh, true, 'cache is fresh again after the refresh');
    assert.equal(status.body.inProgress, false);
  } finally {
    await api.close();
    db.close();
  }
});

// c. concurrent stale requests -> only one refresh runs.
test('c. concurrent stale requests produce a single refresh', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = createMemoryDb();
  await seedViaStub(db);
  backdateLatestRun(db, 48);
  const before = runCount(db);

  const api = await serve(db);
  try {
    const responses = await Promise.all([
      api.get('/api/years'),
      api.get('/api/india/gdp-ranking?startYear=2024&endYear=2025'),
      api.get('/api/ranking?indicator=nominal_current&year=2025'),
      api.get('/api/coverage?year=2025'),
      api.get('/api/countries'),
    ]);
    for (const res of responses) assert.equal(res.status, 200, 'stale requests still serve current data');
    await waitForIdle();
    assert.equal(runCount(db), before + 1, 'concurrent stale requests share one refresh');
  } finally {
    await api.close();
    db.close();
  }
});

// d. failed refresh -> old valid data remain usable; no retry loop.
test('d. failed refresh preserves old data and backs off automatically', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  await seedViaStub(db);
  const goodValue = indiaNominal2025(db);
  assert.ok(goodValue, 'seeded India 2025 nominal observation exists');
  const goodCount = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;

  // Total failure AFTER writes began: arm the stub outage once country
  // metadata has been received (countries upsert proceeds, then every
  // indicator series fails). The refresh must throw with datasetRestored and
  // leave the previous dataset byte-identical.
  stub.reset();
  let armed = false;
  await assert.rejects(
    refreshData({
      db,
      startYear: 2024,
      endYear: 2025,
      trigger: 'test-restore',
      onProgress: (p) => {
        if (!armed && p && p.stage === 'country-metadata') {
          armed = true;
          stub.failNext({ status: 500, times: 500, body: 'down' });
        }
      },
    }),
    (error) => error.datasetRestored === true,
  );
  stub.reset();
  assert.equal(armed, true, 'outage was armed after the metadata stage');

  const failed = db.prepare('SELECT status FROM fetch_runs ORDER BY id DESC LIMIT 1').get();
  assert.equal(failed.status, 'failed', 'the failed run stays recorded for provenance');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observations').get().n, goodCount);
  assert.deepEqual(indiaNominal2025(db), goodValue);

  // HTTP level: while the API is down, old rankings stay served and the
  // post-failure cooldown suppresses an automatic retry loop.
  // Backdate EVERY run: freshness follows the latest SUCCESS run, so leaving
  // the seed success recent would (correctly) count as fresh.
  stub.failNext({ status: 500, times: 200, body: 'down' });
  const oldIso = new Date(Date.now() - 48 * 3_600_000).toISOString();
  db.prepare('UPDATE fetch_runs SET started_at = ?, completed_at = ?').run(oldIso, oldIso);
  const before = runCount(db);
  const api = await serve(db);
  try {
    const res = await api.get('/api/ranking?indicator=nominal_current&year=2025');
    assert.equal(res.status, 200, 'old rankings stay served while the refresh fails');
    await waitForIdle();
    stub.reset();

    assert.equal(runCount(db), before + 1, 'the failed run is recorded in fetch_runs');
    const latest = db.prepare('SELECT status FROM fetch_runs ORDER BY id DESC LIMIT 1').get();
    assert.equal(latest.status, 'failed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observations').get().n, goodCount);
    assert.deepEqual(indiaNominal2025(db), goodValue);

    const again = await api.get('/api/years');
    assert.equal(again.status, 200);
    assert.equal(again.header, null, 'post-failure cooldown suppresses automatic retries');
    assert.equal(runCount(db), before + 1, 'no retry loop while the API is down');
  } finally {
    await api.close();
    db.close();
  }
});

// e. request after successful refresh -> no duplicate refresh.
test('e. no duplicate refresh once the cache is fresh again', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = createMemoryDb();
  await seedViaStub(db);
  backdateLatestRun(db, 48);

  const api = await serve(db);
  try {
    await api.get('/api/years');
    await waitForIdle();
    const afterRefresh = runCount(db);

    const res = await api.get('/api/india/gdp-ranking?startYear=2024&endYear=2025');
    assert.equal(res.status, 200);
    assert.equal(res.header, null);
    assert.equal(runCount(db), afterRefresh, 'fresh cache triggers nothing further');
  } finally {
    await api.close();
    db.close();
  }
});

// f. empty DB -> boot ingestion still works.
test('f. empty database ingests on demand via ensureDataPresent', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { ensureDataPresent } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  stub.reset();

  const result = await ensureDataPresent(db, { trigger: 'boot' });
  assert.equal(result.ingested, true);
  assert.ok(result.observations > 0);

  const again = await ensureDataPresent(db, { trigger: 'boot' });
  assert.equal(again.ingested, false, 'non-empty database is left alone');

  db.close();
});
