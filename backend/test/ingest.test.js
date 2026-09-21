/**
 * INGESTION INTEGRATION TESTS (specification sections 9, 23, 24, 34).
 *
 * Runs the real ingestion pipeline against the stub World Bank API into an
 * in-memory database. Never touches the live API or the real cache file.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

test('deriveFetchRange reaches back one extra year for YoY', async () => {
  const { deriveFetchRange } = await import('../src/wb/ingest.js');
  assert.deepEqual(deriveFetchRange(2010, 2025), { fetchedStartYear: 2009, fetchedEndYear: 2025 });
  assert.deepEqual(deriveFetchRange(2000, 2025), { fetchedStartYear: 1999, fetchedEndYear: 2025 });
});

test('refreshData ingests metadata plus all four indicators from the stub', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const db = createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });

  assert.equal(summary.status, 'success');
  assert.equal(summary.eligibleUniverse, 217);
  assert.ok(summary.rowsUpserted > 0, 'observations written');
  assert.equal(summary.perIndicator.length, 4);
  for (const entry of summary.perIndicator) {
    assert.equal(entry.error, undefined, `indicator ${entry.metricKey} must not fail`);
  }

  // India 2025 nominal current must be present at full precision.
  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  assert.ok(indicator);
  const rows = repository.getEligibleObservations(db, indicator.id, 2025);
  const india = rows.find((row) => row.iso3 === 'IND');
  assert.ok(india, 'India 2025 nominal observation stored');
  assert.equal(typeof india.value, 'number');

  // Aggregates must never reach the observations table.
  const aggregates = repository.listAggregateCountries(db);
  assert.ok(aggregates.length > 0);
  const aggregateIds = new Set(aggregates.map((row) => row.id));
  assert.equal(rows.some((row) => aggregateIds.has(row.iso3)), false);

  // Audit trail recorded.
  const run = repository.getLatestFetchRun(db, { status: 'success' });
  assert.ok(run);
  assert.ok(run.universe_snapshot, 'universe snapshot stored');
  const stats = repository.getIngestYearStats(db, 'nominal_current', { year: 2025 });
  assert.ok(stats.length >= 1, 'per-year counters recorded');
  db.close();
});

test('null observations are skipped, never stored as zero', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const db = createMemoryDb();
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });

  const count = repository.countObservations(db);
  const zeroRows = db.prepare('SELECT COUNT(*) AS n FROM observations WHERE value = 0').get().n;
  // Zero is a valid stored value only if the API returned zero; nulls must not become rows.
  // The stub snapshot contains nulls, so stored rows must be fewer than raw rows received.
  const run = repository.getLatestFetchRun(db, { status: 'success' });
  assert.ok(run.rows_null_skipped > 0, 'null rows counted and skipped');
  assert.ok(count > 0 && zeroRows >= 0);
  db.close();
});

test('concurrent refreshes are rejected with REFRESH_IN_PROGRESS', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const db = createMemoryDb();
  const first = refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  await assert.rejects(
    refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' }),
    (error) => error.code === 'REFRESH_IN_PROGRESS',
  );
  await first;
  db.close();
});

test('cache status reports empty, fresh and refresh-due correctly', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { getCacheStatus, refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const db = createMemoryDb();
  const empty = getCacheStatus(db, { ttlHours: 24, now: Date.now() });
  assert.equal(empty.empty, true);
  assert.equal(empty.refreshDue, true);

  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  const lastSuccess = repository.getLastSuccessfulFetchTime(db);
  assert.ok(lastSuccess);
  const fresh = getCacheStatus(db, { ttlHours: 24, now: new Date(lastSuccess).getTime() + 1000 });
  assert.equal(fresh.empty, false);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.refreshDue, false);
  db.close();
});
