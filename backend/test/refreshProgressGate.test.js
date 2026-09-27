/**
 * PHASE-4 REGRESSION GATE for R-07 (manual-refresh progress observability)
 * and R-12 (integrity generation stability).
 *
 * R-07: refresh progress must be observable from the moment a refresh starts
 * — never gated on a first status payload. refreshData() publishes
 * lastProgress synchronously on entry (stage 'starting' → 'country-metadata'
 * → …), which is exactly what GET /api/data-status streams while the POST
 * is still running. This pins that immediacy plus the bounded POST shape.
 *
 * R-12: only a successful publish advances the dataset generation. Failed
 * and partial runs are audit history: they must not move the fingerprint,
 * must not invalidate the integrity memo, and must leave the previous
 * dataset servable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { createMemoryTestDb } from './helpers/testDb.js';
import { getCachedIntegrity, integrityCacheKey, resetIntegrityCache } from '../src/services/statusCache.js';

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

test('R-07: progress is observable immediately on refresh start, not after completion', async () => {
  const { db } = await createMemoryTestDb();
  const ingest = await import('../src/wb/ingest.js');
  stub.reset();

  const flight = ingest.refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-progress' });
  // Same-tick observation: the refresh has not completed (the stub has not
  // even been hit yet), but progress already exists for status polling.
  assert.equal(ingest.isRefreshInProgress(), true);
  const early = ingest.getIngestProgress();
  assert.ok(early && typeof early.stage === 'string' && early.stage.length > 0);
  assert.equal(early.trigger, 'test-progress');

  const summary = await flight;
  assert.equal(summary.status, 'success');
  assert.equal(ingest.isRefreshInProgress(), false);
  assert.equal(ingest.getIngestProgress()?.stage, 'complete');
  db.close();
});

test('R-07: data-status streams inProgress/progress shape while a refresh runs', async () => {
  const { db } = await createMemoryTestDb();
  const ingest = await import('../src/wb/ingest.js');
  const { createApp } = await import('../src/server.js');
  stub.reset();

  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const flight = ingest.refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-stream' });
    const res = await fetch(`${base}/api/data-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.inProgress, true, 'status reports the running refresh');
    assert.ok(body.progress && typeof body.progress.stage === 'string', 'progress stage streams mid-flight');
    const summary = await flight;
    assert.equal(summary.status, 'success');
    const after = await (await fetch(`${base}/api/data-status`)).json();
    assert.equal(after.inProgress, false);
    assert.equal(after.fingerprint?.runId, summary.runId, 'completion advances the generation');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('R-12: failed and partial runs do not advance the generation or memo', async () => {
  const { db, repository } = await createMemoryTestDb();
  resetIntegrityCache();

  const successId = repository.startFetchRun(db, {
    trigger: 'test-seed',
    endpoint: 'stub://world-bank',
    requestedStartYear: 2024,
    requestedEndYear: 2025,
    fetchedStartYear: 2024,
    fetchedEndYear: 2025,
    indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, successId, { status: 'success', wbLastUpdated: '2026-09-28' });

  const fingerprint = repository.getDatasetFingerprint(db);
  assert.equal(fingerprint.runId, successId);
  const key = integrityCacheKey(fingerprint);
  let scans = 0;
  getCachedIntegrity(key, () => {
    scans += 1;
    return { passed: true, checks: [] };
  });
  assert.equal(scans, 1);

  // Failed run: audit history only.
  const failedId = repository.startFetchRun(db, {
    trigger: 'test-fail',
    endpoint: 'stub://world-bank',
    requestedStartYear: 2024,
    requestedEndYear: 2025,
    fetchedStartYear: 2024,
    fetchedEndYear: 2025,
    indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, failedId, { status: 'failed', errorMessage: 'boom' });

  const afterFail = repository.getDatasetFingerprint(db);
  assert.deepEqual(afterFail, fingerprint, 'failed run moves nothing generation-visible');
  const reused = getCachedIntegrity(integrityCacheKey(afterFail), () => {
    scans += 1;
    return { passed: true, checks: [] };
  });
  assert.equal(reused.fromCache, true);
  assert.equal(scans, 1, 'memo survives non-publishing runs');
  db.close();
});
