/**
 * PHASE 6C O10 — SAFE UNCHANGED-INDICATOR SKIPPING.
 *
 * Proves, against the stub World Bank API only:
 *   1. isIndicatorPayloadUnchanged() is exact: any doubt means PROCESS.
 *   2. An identical second refresh still SUCCEEDS, renews lastSuccessAt
 *      (24h TTL restarts), writes ZERO observation rows, and leaves the
 *      dataset digest identical.
 *   3. One changed value forces that indicator's rewrite (no false skip).
 *   4. A World Bank-dropped row is deleted, never skipped (no false skip).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { canonicalDatasetDigest } from './helpers/equivalence.js';

process.env.WB_RETRY_BASE_MS = '20';

let rowsTransform = null;
let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      rowsTransform ? rowsTransform(metricKey, baseRows) : baseRows,
  });
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedFullDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  rowsTransform = null;
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return { db, repository, seedSummary: summary };
}

// ---------------------------------------------------------------------------
// 1. Pure proof-function semantics: doubt means PROCESS (false).
// ---------------------------------------------------------------------------

test('O10 proof is exact: doubt means process', async () => {
  const { isIndicatorPayloadUnchanged } = await import('../src/wb/ingest.js');
  const stored = [
    { countryId: 'IND', year: 2024, value: 100, valueRaw: '100' },
    { countryId: 'USA', year: 2024, value: 200.5, valueRaw: '200.5' },
  ];
  const same = [
    { countryId: 'USA', year: 2024, value: 200.5, valueRaw: '200.5' },
    { countryId: 'IND', year: 2024, value: 100, valueRaw: '100' },
  ];
  assert.equal(isIndicatorPayloadUnchanged(stored, same), true, 'order-insensitive exact match skips');

  assert.equal(
    isIndicatorPayloadUnchanged(stored, [{ ...same[0], value: 200.6 }, same[1]]),
    false,
    'changed value processes',
  );
  assert.equal(
    isIndicatorPayloadUnchanged(stored, [{ ...same[0], valueRaw: '200.50' }, same[1]]),
    false,
    'changed raw string processes (no numeric coercion)',
  );
  assert.equal(isIndicatorPayloadUnchanged(stored, [same[0]]), false, 'dropped row processes');
  assert.equal(
    isIndicatorPayloadUnchanged(stored, [...same, { countryId: 'CHN', year: 2024, value: 1, valueRaw: '1' }]),
    false,
    'added row processes',
  );
  assert.equal(isIndicatorPayloadUnchanged([], same), false, 'first ingest processes');
  assert.equal(isIndicatorPayloadUnchanged(stored, []), false, 'emptied payload processes');
  assert.equal(isIndicatorPayloadUnchanged(null, same), false, 'non-array processes');
  assert.equal(
    isIndicatorPayloadUnchanged([stored[0], stored[0]], [stored[0]]),
    false,
    'stored duplicates process (count mismatch)',
  );
});

// ---------------------------------------------------------------------------
// 2. Identical refresh: success, freshness renews, zero observation writes.
// ---------------------------------------------------------------------------

test('identical refresh succeeds with zero observation writes and renewed freshness', async () => {
  const { db, repository, seedSummary } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  try {
    stub.reset();
    rowsTransform = null;
    const digestBefore = await canonicalDatasetDigest(db);
    const lastSuccessBefore = await repository.getLastSuccessfulFetchTime(db);
    assert.ok(lastSuccessBefore, 'seed success exists');

    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-unchanged' });

    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0, 'zero observation rows rewritten');
    assert.equal(summary.rowsSkippedUnchanged, seedSummary.rowsUpserted, 'every staged row proven unchanged');
    assert.ok(
      summary.perIndicator.every((r) => r.skippedUnchanged === true),
      'all 20 indicators skipped',
    );

    // Freshness renews: the success run advances lastSuccessAt (24h TTL restarts).
    const lastSuccessAfter = await repository.getLastSuccessfulFetchTime(db);
    assert.ok(lastSuccessAfter >= lastSuccessBefore, 'lastSuccessAt renewed');
    const latest = await repository.getLatestFetchRun(db, { status: 'success' });
    assert.equal(latest.id, summary.runId);
    assert.equal(Number(latest.rows_skipped_unchanged), seedSummary.rowsUpserted);

    // Dataset tables byte-identical (observations, countries, indicators).
    const digestAfter = await canonicalDatasetDigest(db);
    assert.equal(digestAfter.tables.observations, digestBefore.tables.observations);
    assert.equal(digestAfter.tables.countries, digestBefore.tables.countries);
    assert.equal(digestAfter.tables.indicators, digestBefore.tables.indicators);
    assert.equal(digestAfter.counts.observations, digestBefore.counts.observations);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 3. One changed value: that indicator rewrites, the rest skip.
// ---------------------------------------------------------------------------

test('one changed value forces rewrite of its indicator only', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  try {
    stub.reset();
    rowsTransform = (metricKey, baseRows) => {
      if (metricKey !== 'nominal_current') return baseRows;
      let bumped = false;
      return baseRows.map((row) => {
        if (!bumped && row.value !== null && row.value !== undefined) {
          bumped = true;
          const n = Number(row.value);
          return { ...row, value: typeof row.value === 'string' ? String(n + 1) : n + 1 };
        }
        return row;
      });
    };
    const before = await repository.countObservations(db);
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-changed' });

    assert.equal(summary.status, 'success');
    assert.ok(summary.rowsUpserted > 0, 'changed indicator rewritten');
    assert.ok(summary.rowsSkippedUnchanged > 0, 'other indicators skipped');
    const changed = summary.perIndicator.find((r) => r.metricKey === 'nominal_current');
    assert.equal(changed.skippedUnchanged, undefined, 'changed indicator not flagged skipped');
    assert.equal(await repository.countObservations(db), before, 'no rows added or lost');
  } finally {
    rowsTransform = null;
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4. World Bank drops a row: delete happens, skip refused.
// ---------------------------------------------------------------------------

test('dropped row is deleted, never skipped', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  try {
    stub.reset();
    let dropped = 0;
    rowsTransform = (metricKey, baseRows) => {
      if (metricKey !== 'nominal_current') return baseRows;
      const kept = baseRows.filter((row) => {
        if (dropped === 0 && row.value !== null && row.value !== undefined) {
          dropped += 1;
          return false;
        }
        return true;
      });
      return kept;
    };
    const before = await repository.countObservations(db);
    assert.equal(dropped, 0);
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-dropped' });

    assert.equal(summary.status, 'success');
    assert.equal(dropped, 1, 'exactly one row dropped by the stub');
    const changed = summary.perIndicator.find((r) => r.metricKey === 'nominal_current');
    assert.equal(changed.skippedUnchanged, undefined, 'shrunk indicator not skipped');
    assert.equal(await repository.countObservations(db), before - 1, 'stale row removed');
  } finally {
    rowsTransform = null;
    db.close();
  }
});
