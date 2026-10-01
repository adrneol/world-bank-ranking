/**
 * PHASE 8G — READINESS (liveness vs readiness) GATE TESTS.
 *
 * listen() succeeds before database initialization completes: /api/health
 * answers liveness immediately while every other /api route serves an
 * explicit machine-readable 503 DATA_SERVICE_STARTING until the service is
 * marked ready. The gate is a process-state flag: zero database work, zero
 * scans, zero writes. No test touches the live World Bank API or Turso.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedEdgeCaseDb } from './helpers/testDb.js';

let baseUrl = null;
let server = null;

test.before(async () => {
  const seeded = await seedEdgeCaseDb();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db: seeded.db, autoRefresh: false });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  const { markServiceReady } = await import('../src/server.js');
  markServiceReady('ready');
  await new Promise((resolve) => server.close(resolve));
});

async function fetchJson(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

test('pre-ready: data routes serve 503 DATA_SERVICE_STARTING, health stays live', async () => {
  const { setServiceReadiness } = await import('../src/server.js');
  setServiceReadiness({ ready: false, state: 'starting' });
  try {
    const years = await fetchJson('/api/years');
    assert.equal(years.status, 503);
    assert.equal(years.body?.error?.code, 'DATA_SERVICE_STARTING');
    assert.equal(years.body?.ready, false);

    const status = await fetchJson('/api/data-status');
    assert.equal(status.status, 503);
    assert.equal(status.body?.error?.code, 'DATA_SERVICE_STARTING');

    const refresh = await fetchJson('/api/data/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(refresh.status, 503);
    assert.equal(refresh.body?.error?.code, 'DATA_SERVICE_STARTING');

    const health = await fetchJson('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body?.status, 'ok');
    assert.equal(health.body?.ready, false);
    assert.equal(health.body?.state, 'starting');
    assert.ok(health.body?.methodology, 'health contract intact');
  } finally {
    const { markServiceReady } = await import('../src/server.js');
    markServiceReady('ready');
  }
});

test('marking ready resumes normal serving with zero gate overhead', async () => {
  const { markServiceReady, getServiceReadiness } = await import('../src/server.js');
  markServiceReady('ready');
  assert.equal(getServiceReadiness().ready, true);
  const years = await fetchJson('/api/years');
  assert.equal(years.status, 200);
  assert.deepEqual(years.body?.years, [2002, 2003, 2004, 2005]);
  const health = await fetchJson('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body?.ready, true);
  assert.equal(health.body?.state, 'ready');
});
