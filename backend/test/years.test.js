/**
 * AVAILABLE-YEARS TESTS (Phase 4, Part A).
 *
 * The single-GROUP-BY implementation must be semantically identical to the
 * previous 1 + N DISTINCT implementation, and the generation-keyed cache
 * must serve hits without ever exposing a stale or mixed generation.
 * Methodology is untouched — these tests assert only year availability
 * shapes, cache lifecycle and read stability. No test touches the live
 * World Bank API (the stub stands in where a refresh is needed).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

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

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

/** Reference implementation: the pre-optimization 1 + N DISTINCT algorithm. */
async function legacyAvailableYears(db) {
  const { listIndicators, listYearsWithData } = await import('../src/db/repository.js');
  const years = db
    .prepare(
      `
      SELECT DISTINCT o.year AS year
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE c.is_aggregate = 0 AND o.value IS NOT NULL
      ORDER BY o.year
    `,
    )
    .all()
    .map((r) => r.year);

  const perMetric = {};
  for (const indicator of listIndicators(db)) {
    perMetric[indicator.metric_key] = listYearsWithData(db, indicator.id);
  }

  return {
    years,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    perMetric,
  };
}

function seedCountry(db, id, iso2, iso3, name, isAggregate) {
  return { id, iso2, iso3, name, isAggregate: Boolean(isAggregate) };
}

async function seedSynthetic(db) {
  const { upsertCountry, upsertIndicator, upsertObservation, getIndicatorByMetricKey } =
    await import('../src/db/repository.js');
  // Three indicators with staggered coverage, nulls, an aggregate row that
  // must never leak into availability, and an unknown-iso row.
  for (const row of [
    seedCountry(db, 'AAA', 'AA', 'AAA', 'Alpha', false),
    seedCountry(db, 'BBB', 'BB', 'BBB', 'Beta', false),
    seedCountry(db, 'AGG', null, 'AGG', 'Aggregates', true),
  ]) {
    upsertCountry(db, row);
  }
  upsertIndicator(db, { indicatorCode: 'X.A', key: 'metric_a', name: 'A', unit: 'u' });
  upsertIndicator(db, { indicatorCode: 'X.B', key: 'metric_b', name: 'B', unit: 'u' });
  upsertIndicator(db, { indicatorCode: 'X.C', key: 'metric_c', name: 'C', unit: 'u' });
  const idA = getIndicatorByMetricKey(db, 'metric_a').id;
  const idB = getIndicatorByMetricKey(db, 'metric_b').id;
  const idC = getIndicatorByMetricKey(db, 'metric_c').id;
  const put = (countryId, indicatorId, year, value, wb = '2026-07-13') =>
    upsertObservation(db, { countryId, indicatorId, year, value, wbLastUpdated: wb });
  put('AAA', idA, 2000, 1);
  put('AAA', idA, 2001, 2);
  put('BBB', idA, 2001, 3);
  // Note: NULL values cannot occur here at all (observations.value is NOT
  // NULL); the IS NOT NULL predicate in the queries stays defensive.
  put('BBB', idB, 2001, 4, '2026-07-14');
  put('BBB', idB, 2005, 5);
  put('AGG', idA, 2000, 999);
  put('AGG', idB, 2001, 999);
  // metric_c stays empty: per-metric [] must survive.
}

// 1. Byte/semantic identity on a synthetic edge-case database.
test('1. grouped implementation is identical to the legacy N+1 implementation', async () => {
  const { listAvailableYears } = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    await seedSynthetic(db);
    const expected = await legacyAvailableYears(db);
    const actual = listAvailableYears(db);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.perMetric, {
      metric_a: [2000, 2001],
      metric_b: [2001, 2005],
      metric_c: [],
    });
    assert.deepEqual(actual.years, [2000, 2001, 2005]);
    assert.equal(actual.minYear, 2000);
    assert.equal(actual.maxYear, 2005);
  } finally {
    db.close();
  }
});

// 2. Identity on an empty database (null min/max contract preserved).
test('2. empty database keeps the empty contract', async () => {
  const { listAvailableYears, upsertIndicator } = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    upsertIndicator(db, { indicatorCode: 'X.A', key: 'metric_a', name: 'A', unit: 'u' });
    const expected = await legacyAvailableYears(db);
    assert.deepEqual(listAvailableYears(db), expected);
    assert.deepEqual(listAvailableYears(db), { years: [], minYear: null, maxYear: null, perMetric: { metric_a: [] } });
  } finally {
    db.close();
  }
});

// 3. Identity on a stub-seeded production-shape database.
test('3. grouped implementation matches legacy on ingested data', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { listAvailableYears } = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    stub.reset();
    await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-years' });
    assert.deepEqual(listAvailableYears(db), await legacyAvailableYears(db));
    assert.ok(listAvailableYears(db).years.length > 0);
  } finally {
    db.close();
  }
});

// 4. Single statement: prepare-call count stays flat as indicators grow.
test('4. availability resolves in a constant number of statements', async () => {
  const { listAvailableYears } = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    await seedSynthetic(db);
    const original = db.prepare.bind(db);
    let calls = 0;
    db.prepare = (...args) => {
      calls += 1;
      return original(...args);
    };
    try {
      listAvailableYears(db);
    } finally {
      db.prepare = original;
    }
    // listIndicators + one GROUP BY (legacy needed 1 + 1 + N).
    assert.ok(calls <= 3, `expected a constant statement count, saw ${calls}`);
  } finally {
    db.close();
  }
});

// 5. Cache hit returns the identical reference without recompute.
test('5. warm cache serves the same result reference', async () => {
  const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
  resetYearsCache();
  const db = await freshDb();
  try {
    await seedSynthetic(db);
    const first = getCachedAvailableYears(db);
    const second = getCachedAvailableYears(db);
    assert.equal(second, first, 'cache hit must return the identical reference');
    assert.deepEqual(first.years, [2000, 2001, 2005]);
  } finally {
    db.close();
    resetYearsCache();
  }
});

// 6. Publish invalidates: a new successful generation recomputes.
test('6. successful publish advances the generation and refreshes years', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
  const { upsertObservation, getIndicatorByMetricKey, startFetchRun, finishFetchRun } =
    await import('../src/db/repository.js');
  resetYearsCache();
  const db = await freshDb();
  try {
    stub.reset();
    await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-years-publish' });
    const before = getCachedAvailableYears(db);
    assert.equal(getCachedAvailableYears(db), before);

    // Simulate the next successful publish: one more year plus a recorded
    // success run (what refreshData's staged publish always produces).
    const indicatorId = getIndicatorByMetricKey(db, 'nominal_current').id;
    upsertObservation(db, { countryId: 'IND', indicatorId, year: 2026, value: 1, wbLastUpdated: '2026-07-13' });
    const runId = startFetchRun(db, { trigger: 'test', endpoint: 'test', requestedStartYear: 2026, requestedEndYear: 2026, fetchedStartYear: 2026, fetchedEndYear: 2026, indicators: 'x' });
    finishFetchRun(db, runId, { status: 'success' });

    const after = getCachedAvailableYears(db);
    assert.notEqual(after, before, 'new generation must recompute');
    assert.ok(after.years.includes(2026), 'newly published year is available');
    assert.deepEqual(after.perMetric.nominal_current.slice(-1), [2026]);
  } finally {
    db.close();
    resetYearsCache();
  }
});

// 7. Failed refresh preserves the previously valid cache entry.
test('7. failed run keeps serving the previous generation', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
  const { startFetchRun, finishFetchRun } = await import('../src/db/repository.js');
  resetYearsCache();
  const db = await freshDb();
  try {
    stub.reset();
    await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-years-fail' });
    const before = getCachedAvailableYears(db);

    const runId = startFetchRun(db, { trigger: 'test', endpoint: 'test', requestedStartYear: 2024, requestedEndYear: 2025, fetchedStartYear: 2024, fetchedEndYear: 2025, indicators: 'x' });
    finishFetchRun(db, runId, { status: 'failed', errorMessage: 'boom' });

    assert.equal(getCachedAvailableYears(db), before, 'failed run must not disturb the cache');
  } finally {
    db.close();
    resetYearsCache();
  }
});

// 8. Concurrent reads share one consistent result.
test('8. concurrent reads return identical results', async () => {
  const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
  resetYearsCache();
  const db = await freshDb();
  try {
    await seedSynthetic(db);
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => getCachedAvailableYears(db)),
    );
    for (const result of results) assert.deepEqual(result, results[0]);
  } finally {
    db.close();
    resetYearsCache();
  }
});

// 9. Upstream vintage derivation from stored rows.
test('9. max upstream vintage derives from observations', async () => {
  const { getMaxWbLastUpdated } = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    assert.equal(getMaxWbLastUpdated(db), null);
    await seedSynthetic(db);
    assert.equal(getMaxWbLastUpdated(db), '2026-07-14');
  } finally {
    db.close();
  }
});

// 10. data-status exposes the upstream vintage distinctly from retrieval time.
test('10. data-status carries wbLastUpdated alongside lastSuccessAt', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { createApp } = await import('../src/server.js');
  const db = await freshDb();
  stub.reset();
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-years-status' });
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/data-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.wbLastUpdated === 'string' && body.wbLastUpdated !== '', 'upstream vintage present');
    assert.ok(typeof body.lastSuccessAt === 'string' && body.lastSuccessAt !== '', 'retrieval time present');
    assert.notEqual(body.wbLastUpdated, body.lastSuccessAt, 'vintage and retrieval are distinct concepts');
    assert.ok(Array.isArray(body.years.years) && body.years.years.length > 0, 'cached years served in status');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
