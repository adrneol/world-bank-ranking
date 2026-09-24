/**
 * REFRESH RATE-LIMIT TESTS (abuse protection for manual refresh only).
 *
 * A tight limit is injected via environment (this file runs in its own
 * process). Ranking/data GET endpoints must never be limited.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.REFRESH_ADMIN_TOKEN = 'rate-limit-test-token';
process.env.REFRESH_RATE_LIMIT_MAX = '3';
process.env.REFRESH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.WB_RETRY_BASE_MS = '20';

import { seedEdgeCaseDb } from './helpers/testDb.js';

const TOKEN = 'rate-limit-test-token';

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

async function postRefresh(payload) {
  const res = await fetch(`${baseUrl}/api/data/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test('manual refresh beyond the budget is rejected with 429 and Retry-After', async () => {
  // Invalid bodies (400) still count as attempts without ingesting anything.
  for (let i = 0; i < 3; i += 1) {
    const res = await postRefresh({ startYear: 2020, endYear: 2010 });
    assert.equal(res.status, 400);
  }
  const limited = await postRefresh({ startYear: 2020, endYear: 2010 });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'REFRESH_RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1, 'Retry-After advertised');
});

test('ranking/data GET endpoints are never rate-limited', async () => {
  for (let i = 0; i < 6; i += 1) {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
  }
  const ranking = await fetch(`${baseUrl}/api/ranking?indicator=nominal_current&year=2005`);
  assert.equal(ranking.status, 200);
});
