/**
 * COLD-START / SEEDING-GATE TESTS (Phase 1).
 *
 * boot() now listens before seeding, so the very first dataset arrives in
 * the background. While the database is empty AND the seed is running,
 * GET /api/years must say so explicitly (503 + DATA_LOADING) instead of
 * returning an empty year range the frontend could mistake for "no data".
 * Once published, years serve normally. Non-empty databases are unaffected
 * (200 even while a TTL refresh runs), and an empty database with no ingest
 * running keeps the previous 200-empty contract.
 *
 * The stub World Bank API stands in for the live API; no test touches the
 * network. Methodology is untouched — these tests assert only HTTP
 * status/code contracts and read stability.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

// Keep retry backoff tiny (set before src import).
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

async function serve(db, { autoRefresh = false } = {}) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh });
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

function backdateLatestRun(db, hoursAgo) {
  const iso = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  db.prepare('UPDATE fetch_runs SET started_at = ?, completed_at = ? WHERE id = (SELECT MAX(id) FROM fetch_runs)').run(iso, iso);
}

async function rankingSnapshot(api) {
  const res = await api.get('/api/ranking?indicator=nominal_current&year=2025');
  assert.equal(res.status, 200);
  return res.body;
}

// 1. Empty DB + running seed -> 503 DATA_LOADING; after publish -> 200.
test('1. years reports DATA_LOADING while the first ingest runs, then serves once published', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  stub.reset();

  // refreshData acquires the DB lock and raises the in-progress flag
  // synchronously, so the seed is observably running from this line on.
  const seed = refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-boot-seed' });
  const api = await serve(db);
  try {
    const loading = await api.get('/api/years');
    assert.equal(loading.status, 503, 'empty database with a running seed is explicit, not an empty range');
    assert.equal(loading.body?.error?.code, 'DATA_LOADING');

    await seed;
    const warm = await api.get('/api/years');
    assert.equal(warm.status, 200);
    assert.ok(Array.isArray(warm.body.years) && warm.body.years.length > 0, 'published years are served');
    assert.ok(warm.body.perMetric?.nominal_current?.length > 0, 'per-metric availability is preserved');
  } finally {
    await api.close();
    db.close();
  }
});

// 2. Empty DB + no ingest -> previous 200-empty contract is unchanged.
test('2. empty database without a running ingest keeps the 200-empty contract', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = createMemoryDb();

  const api = await serve(db);
  try {
    const res = await api.get('/api/years');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.years, []);
    assert.equal(res.body.minYear, null);
    assert.equal(res.body.maxYear, null);
  } finally {
    await api.close();
    db.close();
  }
});

// 3. Non-empty DB -> 200 during a background TTL refresh (never 503).
test('3. non-empty database serves years normally while a background refresh runs', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  stub.reset();
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  backdateLatestRun(db, 48);

  const api = await serve(db, { autoRefresh: true });
  try {
    const res = await api.get('/api/years');
    assert.equal(res.status, 200, 'stale-but-present data keeps serving during the refresh');
    assert.ok(res.body.years.length > 0);
    await waitForIdle();
    const after = await api.get('/api/years');
    assert.equal(after.status, 200);
    assert.ok(after.body.years.length > 0);
  } finally {
    await api.close();
    db.close();
  }
});

// 4. Reads stay byte-identical while a background refresh runs (atomic publish).
test('4. ranking reads stay identical before, during, and after a background refresh', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  stub.reset();
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });

  const api = await serve(db, { autoRefresh: true });
  try {
    const before = await rankingSnapshot(api);
    backdateLatestRun(db, 48);

    // This request trips the stale detector and launches the background
    // refresh; the stub is deterministic so any partial publish would show
    // up as a payload difference.
    const trigger = await api.get('/api/years');
    assert.equal(trigger.status, 200);
    assert.equal(trigger.header, 'stale');

    const during = await rankingSnapshot(api);
    assert.deepEqual(during, before, 'no intermediate dataset is exposed while the refresh runs');

    await waitForIdle();
    const after = await rankingSnapshot(api);
    assert.deepEqual(after, before, 'deterministic re-ingest publishes identical numbers');
  } finally {
    await api.close();
    db.close();
  }
});
