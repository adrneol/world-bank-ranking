/**
 * HTTP API TESTS (specification sections 15-20).
 *
 * The Express app is exercised over an ephemeral port against the seeded
 * edge-case database. No test touches the live World Bank API or the real
 * cache file. POST /api/data/refresh success is NOT tested here (it would
 * ingest live data); validation errors and the refresh contract are covered,
 * while successful ingestion is covered in ingest.test.js via the stub.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedEdgeCaseDb } from './helpers/testDb.js';

let baseUrl = null;
let server = null;
let db = null;

test.before(async () => {
  const seeded = await seedEdgeCaseDb();
  db = seeded.db;
  const { createApp } = await import('../src/server.js');
  // Auto-refresh stays OFF here: the seeded edge database has no fetch_runs
  // history (hence "stale"), and a background refresh would hit the live API
  // and rewrite this fixture mid-test. ttlRefresh.test.js covers the enabled
  // path against the stub API.
  const app = createApp({ db, autoRefresh: false });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path, payload) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/health reports status and methodology without stack traces', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(body.methodology.rankWording);
  assert.ok(body.methodology.numericalRepresentation);
  assert.equal(body.stack, undefined);
});

test('GET /api/years derives the range from stored data', async () => {
  const { status, body } = await get('/api/years');
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2002, 2003, 2004, 2005]);
  assert.equal(body.minYear, 2002);
  assert.equal(body.maxYear, 2005);
});

test('GET /api/india/gdp-ranking returns one row per year with four metric groups', async () => {
  const { status, body } = await get('/api/india/gdp-ranking?startYear=2003&endYear=2005');
  assert.equal(status, 200);
  assert.equal(body.rows.length, 3);
  const y2005 = body.rows.find((r) => r.year === 2005);
  assert.equal(y2005.nominal_current.indiaRank, 5);
  assert.equal(y2005.nominal_current.total, 6);
  assert.equal(y2005.nominal_current.indiaValue, 800.125);
  assert.ok(y2005.nominal_current.indiaYoY !== null || y2005.nominal_current.indiaYoYReason);
});

test('GET /api/india/gdp-ranking defaults to the stored range', async () => {
  const { status, body } = await get('/api/india/gdp-ranking');
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2002, 2003, 2004, 2005]);
});

test('GET /api/india/gdp-ranking rejects an inverted range', async () => {
  const { status, body } = await get('/api/india/gdp-ranking?startYear=2005&endYear=2003');
  assert.equal(status, 400);
  assert.ok(body.error.message);
  assert.equal(body.stack, undefined, 'no stack traces in error responses');
});

test('GET /api/ranking returns the full ordered list with pagination', async () => {
  const { status, body } = await get('/api/ranking?indicator=nominal_current&year=2005&page=1&pageSize=4');
  assert.equal(status, 200);
  assert.equal(body.total, 6);
  assert.deepEqual(body.rows.map((r) => r.rank), [1, 2, 3, 4]);
  assert.ok(body.rows[0].rawValueText, 'raw decimal string exposed for audit');
});

test('GET /api/ranking search preserves rank numbers', async () => {
  const { status, body } = await get('/api/ranking?indicator=nominal_current&year=2005&search=IND');
  assert.equal(status, 200);
  assert.equal(body.search.matchCount, 1);
  assert.equal(body.search.matches[0].rank, 5);
});

test('GET /api/ranking rejects unknown indicators and years', async () => {
  const badIndicator = await get('/api/ranking?indicator=NOPE&year=2005');
  assert.equal(badIndicator.status, 400);
  const badYear = await get('/api/ranking?indicator=nominal_current&year=1492');
  assert.equal(badYear.status, 400);
});

test('GET /api/ranking/verify returns focus plus neighbors from one ranking', async () => {
  const { status, body } = await get('/api/ranking/verify?indicator=nominal_current&year=2005&country=IND&neighbors=2');
  assert.equal(status, 200);
  assert.equal(body.focus.rank, 5);
  assert.equal(body.focus.total, 6);
  assert.equal(body.above.length, 2);
  assert.equal(body.below.length, 1);
  assert.equal(body.focus.rowsAbove, 4);
});

test('GET /api/yoy-ranking and /api/yoy-ranking/verify use the YoY denominator', async () => {
  const full = await get('/api/yoy-ranking?indicator=nominal_current&year=2005');
  assert.equal(full.status, 200);
  assert.equal(full.body.total, 5);

  const verify = await get('/api/yoy-ranking/verify?indicator=nominal_current&year=2005&country=IND&neighbors=2');
  assert.equal(verify.status, 200);
  assert.equal(verify.body.focus.rank, 1);
  assert.equal(verify.body.denominator, 5);
  assert.ok(verify.body.coverage);
});

test('GET /api/coverage explains changing totals with evidence only', async () => {
  const { status, body } = await get('/api/coverage?year=2005&fromYear=2004&toYear=2005&indicator=nominal_current');
  assert.equal(status, 200);
  const nominal = body.metrics.find((m) => m.metric.key === 'nominal_current');
  assert.equal(nominal.validObservations, 6);
  assert.ok(body.explanation, 'changing-totals explanation present');
  assert.ok(['A', 'B', 'C', 'D', 'NONE'].includes(body.explanation.case));
});

test('GET /api/observations returns source rows with provenance, never invented data', async () => {
  const single = await get('/api/observations?indicator=nominal_current&year=2005&country=IND');
  assert.equal(single.status, 200);
  assert.equal(single.body.available, true);
  assert.equal(single.body.observation.value, 800.125);
  assert.equal(single.body.observation.valueRaw, '800.125');

  const list = await get('/api/observations?indicator=nominal_current&year=2005');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 6);
});

test('GET /api/countries, /api/metadata, /api/data-status, /api/integrity', async () => {
  const countries = await get('/api/countries');
  assert.equal(countries.status, 200);
  assert.equal(countries.body.eligibleCount, 7);

  const metadata = await get('/api/metadata');
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.universe.eligible, 7);

  const dataStatus = await get('/api/data-status');
  assert.equal(dataStatus.status, 200);
  assert.equal(dataStatus.body.observations > 0, true);

  const integrity = await get('/api/integrity');
  assert.equal(integrity.status, 200);
  assert.ok(Array.isArray(integrity.body.checks));
});

test('POST /api/data/refresh validates input without ingesting', async () => {
  const badRange = await post('/api/data/refresh', { startYear: 2020, endYear: 2010 });
  assert.equal(badRange.status, 400);

  const badIndicator = await post('/api/data/refresh', { indicators: ['NOPE'] });
  assert.equal(badIndicator.status, 400);
});

test('unknown endpoints return JSON 404 without stack traces', async () => {
  const { status, body } = await get('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.stack, undefined);
});

test.after(() => {
  void db;
});
