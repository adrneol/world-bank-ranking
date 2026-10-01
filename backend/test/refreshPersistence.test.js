/**
 * PHASE 8E — PERSISTED REFRESH SUMMARY + STATUS ENRICHMENT + CONCURRENCY.
 *
 * The terminal per-refresh indicator summary is persisted ONCE as metadata
 * inside the existing fetch_runs final UPDATE (no extra statement, no
 * per-indicator writes, never observation data): it must survive remount and
 * reload via GET /api/data-status, carry UTC timestamps + duration, expose a
 * safe database target, and leave O10/O7/O8 untouched. A concurrent refresh
 * attempt while the lock is held must serialize-or-reject (409) without
 * harming the server. No test touches the live World Bank API or Turso.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { seedEdgeCaseDb } from './helpers/testDb.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

test('successful refresh persists one terminal indicator summary as metadata', async () => {
  const db = await seedDb();
  try {
    const repository = await import('../src/db/repository.js');
    const runs = await repository.listFetchRuns(db, 1);
    assert.equal(runs.length, 1);
    const summary = repository.parseProgressSummary(runs[0].progress_summary);
    assert.ok(summary, 'progress_summary persisted');
    assert.equal(summary.version, 1);
    assert.equal(summary.status, 'success');
    assert.equal(summary.metricKeys.length, 20, 'all 20 indicators recorded');
    assert.equal(summary.steps.length, 20);
    const { counts } = summary;
    assert.equal(counts.total, 20);
    assert.equal(counts.updated + counts.unchanged + counts.failed + counts.notAttempted, 20);
    assert.ok(summary.startedAt && summary.completedAt, 'UTC timestamps present');
    assert.ok(new Date(summary.completedAt).getTime() >= new Date(summary.startedAt).getTime());
    for (const step of summary.steps) {
      assert.ok(step.metricKey && step.label && step.status);
    }
  } finally {
    db.close();
  }
});

test('unchanged refresh still persists the summary without touching observations', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    const before = await repository.getDatasetState(db);
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' });
    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0, 'O10: zero observation writes');
    assert.deepEqual(await repository.getDatasetState(db), before, 'content_version frozen');
    const latest = (await repository.listFetchRuns(db, 1))[0];
    const persisted = repository.parseProgressSummary(latest.progress_summary);
    assert.ok(persisted && persisted.status === 'success');
    assert.equal(persisted.counts.unchanged, 20, 'all 20 proven unchanged');
    assert.equal(persisted.counts.updated, 0);
  } finally {
    db.close();
  }
});

test('partial refresh persists failed steps with the rollback note', async () => {
  const db = await seedDb();
  try {
    const { refreshData } = await import('../src/wb/ingest.js');
    const repository = await import('../src/db/repository.js');
    stub.reset();
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'ttl' });
    assert.equal(summary.status, 'partial');
    const latest = (await repository.listFetchRuns(db, 1))[0];
    assert.equal(latest.status, 'partial');
    const persisted = repository.parseProgressSummary(latest.progress_summary);
    assert.ok(persisted && persisted.status === 'partial');
    const failed = persisted.steps.filter((s) => s.status === 'failed');
    assert.ok(failed.length >= 1, 'failed indicator recorded');
    assert.ok(failed[0].error, 'per-indicator error recorded');
  } finally {
    stub.reset();
    db.close();
  }
});

test('parseProgressSummary rejects missing/corrupt values without throwing', async () => {
  const repository = await import('../src/db/repository.js');
  assert.equal(repository.parseProgressSummary(null), null);
  assert.equal(repository.parseProgressSummary(undefined), null);
  assert.equal(repository.parseProgressSummary('not-json'), null);
  assert.equal(repository.parseProgressSummary('{"metricKeys":[]}'), null);
});

test('data-status exposes database target, lastRefresh and enriched history', async () => {
  const db = await seedDb();
  const { createApp, setActiveDbInfo, getActiveDbInfo } = await import('../src/server.js');
  // Deterministic target regardless of ambient backend/.env (which may point
  // at production Turso): the seam mirrors what boot() records for a local
  // development handle.
  const previousTarget = getActiveDbInfo();
  setActiveDbInfo({ provider: 'sqlite', isFallback: false, isDegraded: false, isProduction: false });
  const app = createApp({ db, autoRefresh: false });
  let server = null;
  try {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/data-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // Safe PUBLIC database target: logical label only, never host/secrets.
    assert.equal(body.database?.provider, 'sqlite');
    assert.equal(body.database?.label, 'Local SQLite');
    assert.equal(body.database?.fallback, false);
    const serialized = JSON.stringify(body);
    assert.ok(!/turso\.io/i.test(serialized), 'no Turso hostname on the public payload');
    assert.ok(!/token/i.test(serialized), 'no token in database descriptor');
    assert.ok(!/secret|credential|password/i.test(serialized), 'no secrets in database descriptor');
    // Persisted last refresh with UTC ISO timestamps + duration.
    assert.ok(body.lastRefresh, 'lastRefresh present');
    assert.equal(body.lastRefresh.status, 'success');
    assert.ok(body.lastRefresh.startedAt && body.lastRefresh.completedAt);
    assert.ok(Number.isFinite(body.lastRefresh.durationMs) && body.lastRefresh.durationMs >= 0);
    assert.ok(body.lastRefresh.summary && body.lastRefresh.summary.counts.total === 20);
    // Enriched history: duration + counts derived server-side, no extra scan.
    assert.ok(Array.isArray(body.latestRuns) && body.latestRuns.length >= 1);
    const run = body.latestRuns[0];
    assert.ok(run.started_at && run.completed_at, 'UTC timestamps per run');
    assert.ok(run.duration_ms === null || Number.isFinite(run.duration_ms));
    assert.ok(run.summary_counts && run.summary_counts.total === 20);
    assert.ok('rows_retrieved' in run && 'rows_upserted' in run && 'rows_skipped_unchanged' in run);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    setActiveDbInfo(previousTarget);
    db.close();
  }
});

test('concurrent refresh while locked: 409 without harming the server', async () => {
  const seeded = await seedEdgeCaseDb();
  const { db } = seeded;
  const { createApp } = await import('../src/server.js');
  const repository = await import('../src/db/repository.js');
  const app = createApp({ db, autoRefresh: false });
  let server = null;
  try {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    // Simulate the running server's held refresh (second-terminal case):
    // hold the cross-process database lock directly.
    const held = await repository.acquireRefreshLock(db, { holder: 'test-holder' });
    assert.equal(held, true);
    try {
      const { default: runtimeConfig } = await import('../src/config.js');
      const headers = { 'Content-Type': 'application/json' };
      if (runtimeConfig.refreshAdminToken) headers.Authorization = `Bearer ${runtimeConfig.refreshAdminToken}`;
      const refreshRes = await fetch(`${base}/api/data/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      assert.equal(refreshRes.status, 409, 'duplicate refresh cleanly rejected');
      // Server remains alive: health + status keep serving.
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 200);
      const status = await fetch(`${base}/api/data-status`);
      assert.equal(status.status, 200);
    } finally {
      await repository.forceReleaseRefreshLock(db, 'testooled');
    }
    const statusAfter = await fetch(`${base}/api/data-status`);
    assert.equal(statusAfter.status, 200, 'status serves after lock release');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
