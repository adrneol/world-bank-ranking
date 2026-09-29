/**
 * PHASE-1 R-04/R-12 INTEGRATION TESTS: dataset fingerprint on
 * GET /api/data-status and generation-keyed integrity behavior.
 *
 * Uses an in-memory database and never touches the live World Bank API:
 * success runs are recorded directly through the repository, which is
 * exactly what advances the published generation in production.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedEdgeCaseDb } from './helpers/testDb.js';
import { resetIntegrityCache } from '../src/services/statusCache.js';

let db = null;
let repository = null;
let server = null;
let base = null;

test.before(async () => {
  const seeded = await seedEdgeCaseDb();
  db = seeded.db;
  repository = seeded.repository;
  resetIntegrityCache();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function getStatus() {
  const res = await fetch(`${base}/api/data-status`);
  assert.equal(res.status, 200);
  return res.json();
}

async function recordSuccess(trigger) {
  const runId = await repository.startFetchRun(db, {
    trigger,
    endpoint: 'stub://world-bank',
    requestedStartYear: 2003,
    requestedEndYear: 2005,
    fetchedStartYear: 2002,
    fetchedEndYear: 2005,
    indicators: ['NY.GDP.PCAP.CD'],
  });
  await repository.finishFetchRun(db, runId, { status: 'success', wbLastUpdated: '2026-09-28' });
  return runId;
}

test('data-status exposes a fingerprint identifying the published generation', async () => {
  const runId = await recordSuccess('test-seed');
  const body = await getStatus();
  assert.ok(body.fingerprint, 'fingerprint object present');
  assert.equal(body.fingerprint.runId, runId);
  assert.equal(typeof body.fingerprint.observationCount, 'number');
  assert.equal(body.lastSuccessAt != null, true);
});

test('fingerprint runId strictly advances when a new success run publishes', async () => {
  const before = (await getStatus()).fingerprint?.runId;
  const newRunId = await recordSuccess('test-publish');
  const after = await getStatus();
  assert.equal(after.fingerprint?.runId, newRunId);
  assert.ok(newRunId > before, 'generation strictly advances');
});

test('integrity payload stays shaped across generations (memo never alters semantics)', async () => {
  const body = await getStatus();
  assert.ok(body.integrity, 'integrity present');
  assert.equal(typeof body.integrity.passed, 'boolean');
  assert.ok(Array.isArray(body.integrity.checks) || body.integrity.error !== undefined);
});
