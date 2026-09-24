/**
 * REFRESH SECURITY TESTS (manual-refresh auth, CORS allowlist, health hygiene).
 *
 * Uses ONLY in-memory databases and never triggers a real refresh: authorized
 * requests carry deliberately invalid bodies (400 proves authentication passed
 * without ingesting anything). The admin token and CORS list are injected via
 * environment before any src import; this file runs in its own process.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.REFRESH_ADMIN_TOKEN = 'hardening-test-admin-token';
process.env.CORS_ORIGINS = 'http://allowed.test.local';
process.env.WB_RETRY_BASE_MS = '20';

import { seedEdgeCaseDb } from './helpers/testDb.js';

const TOKEN = 'hardening-test-admin-token';

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
  await new Promise((resolve) => server.close(resolve));
});

async function post(path, payload, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

async function get(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test('J. manual refresh without a token is rejected', async () => {
  const res = await post('/api/data/refresh', { startYear: 2020, endYear: 2010 });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'REFRESH_UNAUTHORIZED');
});

test('J. manual refresh with a wrong token is rejected', async () => {
  const res = await post(
    '/api/data/refresh',
    { startYear: 2020, endYear: 2010 },
    { Authorization: 'Bearer wrong-token' },
  );
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'REFRESH_UNAUTHORIZED');
});

test('J. manual refresh with the correct token reaches validation (no ingest)', async () => {
  // Invalid bodies prove authentication passed (400 from validation) without
  // ever starting a refresh against any World Bank endpoint.
  const badRange = await post(
    '/api/data/refresh',
    { startYear: 2020, endYear: 2010 },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(badRange.status, 400);

  const badIndicator = await post(
    '/api/data/refresh',
    { indicators: ['NOPE'] },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(badIndicator.status, 400);
});

test('K. health exposes status but never the database filesystem path', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.databaseFile, undefined);
  assert.equal(body.database, 'ok');
  assert.ok(body.methodology);
});

test('L. configured CORS origin is allowed; unconfigured origins get no access', async () => {
  const allowed = await get('/api/health', { Origin: 'http://allowed.test.local' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://allowed.test.local');

  const denied = await get('/api/health', { Origin: 'http://evil.test' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.ok(!String(denied.headers.get('access-control-allow-origin')).includes('*'));

  // Non-browser requests without an Origin header keep working.
  const plain = await get('/api/health');
  assert.equal(plain.status, 200);
});
