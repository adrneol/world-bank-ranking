/**
 * PHASE 8O — TRANSACTION-LIFETIME REGRESSION.
 *
 * Direct regression test for the production Turso failure
 * `SQLITE_UNKNOWN: stored sql reference is invalid` (+ `TRANSACTION_CLOSED`):
 * the pre-8O pipeline held ONE interactive transaction open across all twenty
 * World Bank fetches (tens of seconds of network idle between DB statements),
 * which Turso/Hrana invalidates server-side while local SQLite tolerates.
 *
 * Structural guarantees asserted here (stub World Bank API only, no network):
 *   1. No World Bank fetch starts, ends, or overlaps the publish
 *      transaction window — the publish is DB-writes-only and short.
 *   2. A successful refresh opens exactly one publish transaction.
 *   3. A partial refresh (indicator fetch failure) opens NO transaction.
 *   4. Changed payloads replay element-identically through the temp staging
 *      files (a follow-up identical refresh proves zero rewrites), staged
 *      rows are released from every summary, and no staging directory is
 *      left behind.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

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

/** Instrument a handle: record publish-transaction windows (performance.now). */
function trackTransactions(db) {
  const windows = [];
  const orig = db.transaction.bind(db);
  db.transaction = async (...args) => {
    const opened = performance.now();
    try {
      return await orig(...args);
    } finally {
      windows.push({ opened, closed: performance.now() });
    }
  };
  return windows;
}

/** Track World Bank fetch windows by wrapping global fetch (stub URLs only). */
function trackStubFetches(baseUrl) {
  const fetches = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = String(args[0]?.url ?? args[0] ?? '');
    if (!url.startsWith(baseUrl)) return origFetch(...args);
    const started = performance.now();
    try {
      return await origFetch(...args);
    } finally {
      fetches.push({ started, ended: performance.now() });
    }
  };
  return { fetches, restore: () => { globalThis.fetch = origFetch; } };
}

function ownStagingDirs() {
  const prefix = `wb-refresh-staging-p${process.pid}-`;
  try {
    return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix));
  } catch {
    return [];
  }
}

function assertNoOverlap(fetches, windows) {
  for (const f of fetches) {
    for (const w of windows) {
      assert.ok(
        !(f.started < w.closed && f.ended > w.opened),
        `World Bank fetch [${f.started.toFixed(2)}–${f.ended.toFixed(2)}] overlaps publish transaction [${w.opened.toFixed(2)}–${w.closed.toFixed(2)}]`,
      );
    }
  }
}

async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  rowsTransform = null;
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

test('8O: changed refresh fetches nothing inside the publish transaction', async () => {
  const db = await seedDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  try {
    stub.reset();
    // Force exactly one indicator to need publication.
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
    const windows = trackTransactions(db);
    const { fetches, restore } = trackStubFetches(stub.baseUrl);
    let summary = null;
    try {
      summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-8o' });
    } finally {
      restore();
    }
    assert.equal(summary.status, 'success');
    assert.ok(fetches.length > 0, 'World Bank fetches happened');
    assert.equal(windows.length, 1, 'exactly one short publish transaction');
    assertNoOverlap(fetches, windows);

    // The changed value landed verbatim through the staging files.
    const indicator = await repository.getIndicatorByMetricKey(db, 'nominal_current');
    const rows2025 = await repository.getEligibleObservations(db, indicator.id, 2025);
    assert.ok(rows2025.length > 0, 'changed indicator rows stored');

    // Every summary result released its staged rows (bounded memory, O2).
    for (const r of summary.perIndicator) {
      assert.ok(!r.stagedRows || r.stagedRows.length === 0, `${r.metricKey}: staged rows released`);
    }
    // No temp staging left behind.
    assert.deepEqual(ownStagingDirs(), [], 'staging directory cleaned');

    // Follow-up refresh with the SAME payload proves the replay was
    // element-identical: every row (value AND raw string through disk)
    // matches, zero rewrites. (The bump transform stays applied so the
    // source payload is identical to what was published.)
    stub.reset();
    const again = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-8o-again' });
    assert.equal(again.status, 'success');
    assert.equal(again.rowsUpserted, 0, 'replayed rows are element-identical (O10 skips all)');
    assert.deepEqual(ownStagingDirs(), [], 'staging directory cleaned on unchanged path');
  } finally {
    rowsTransform = null;
    stub.reset();
    db.close();
  }
});

test('8O: all-unchanged refresh still publishes short with zero observation writes', async () => {
  const db = await seedDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  try {
    stub.reset();
    rowsTransform = null;
    const windows = trackTransactions(db);
    const { fetches, restore } = trackStubFetches(stub.baseUrl);
    let summary = null;
    try {
      summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-8o-unchanged' });
    } finally {
      restore();
    }
    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0, 'O10: zero observation writes');
    assert.equal(windows.length, 1, 'exactly one short publish transaction');
    assertNoOverlap(fetches, windows);
    assert.deepEqual(ownStagingDirs(), [], 'no staging created for unchanged data');
  } finally {
    db.close();
  }
});

test('8O: partial refresh fetches nothing inside any transaction and spills nothing live', async () => {
  const db = await seedDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  try {
    stub.reset();
    const before = await repository.countObservations(db);
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const windows = trackTransactions(db);
    const { fetches, restore } = trackStubFetches(stub.baseUrl);
    let summary = null;
    try {
      summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-8o-partial' });
    } finally {
      restore();
    }
    assert.equal(summary.status, 'partial');
    // The only transaction a partial attempt may open is the short audit
    // write (ingest_year_stats); fetches never overlap any transaction.
    assertNoOverlap(fetches, windows);
    assert.equal(await repository.countObservations(db), before, 'nothing published');
    assert.deepEqual(ownStagingDirs(), [], 'staging cleaned on partial path');
  } finally {
    stub.reset();
    db.close();
  }
});
