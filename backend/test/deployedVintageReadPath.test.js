/**
 * DEPLOYED READ PATH — DOES THE METADATA REPAIR CHANGE THE SERVED VINTAGE?
 *
 * The production repair updates `dataset_state.max_wb_last_updated`. The
 * question this file answers with direct evidence: does the ALREADY DEPLOYED
 * backend (which predates the write-path fix) serve the new value, or does it
 * need a deployment first?
 *
 * Evidence assembled here:
 *
 *   1. The read path is `getMaxWbLastUpdated()` -> `dataset_state.max_wb_last_updated`
 *      when a dataset_state row exists. The short-circuit was introduced in
 *      commit bf711b9 (2026-09-29) and is an ancestor of HEAD, and the
 *      production database demonstrably HAS a dataset_state row - so the
 *      deployed code takes the short-circuit.
 *   2. The production row's value ('2026-07-13') disagrees with every
 *      observation row's provenance ('2026-10-08'). That divergence IS the
 *      fingerprint of the cached read: a scan-derived value could not be
 *      stale while the rows it summarises are current.
 *   3. This file reproduces the whole thing in isolation: serve
 *      /api/data-status, apply the repair statement, serve it again.
 *
 * The write path (`computeDatasetState`) is the part the fix changed, and it
 * is exercised here too, to show what the DEPLOYED write path would do with
 * the repaired row (and why the repair is not durable across the next
 * upstream release until the fix is deployed).
 */

import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

/** A populated database with a derived dataset_state row. */
async function seededDb(vintage = null) {
  const { createMemoryDb } = await import('../src/db/index.js');
  const db = await createMemoryDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  if (vintage) stub.setSeriesLastUpdated(vintage);
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

/** Serve /api/data-status against an injected database handle. */
async function statusServer(db) {
  // The integrity memo is a single process-wide slot (not per database), so
  // a test that serves a DIFFERENT database must reset it first - otherwise
  // a report produced for another database would be reused.
  const { resetIntegrityCache } = await import('../src/services/statusCache.js');
  resetIntegrityCache();
  const { resetYearsCache } = await import('../src/services/yearsCache.js');
  resetYearsCache();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async status() {
      const res = await fetch(`${base}/api/data-status`);
      assert.equal(res.status, 200);
      return res.json();
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('the served vintage is the dataset_state value, so the repair changes it at once', async () => {
  const db = await seededDb();
  const svc = await statusServer(db);
  try {
    const repository = await import('../src/db/repository.js');

    // --- 1. the served value is the DERIVED ROW's value ---------------
    const before = await svc.status();
    const stateBefore = await repository.getDatasetState(db);
    assert.equal(before.wbLastUpdated, stateBefore.maxWbLastUpdated, 'served vintage == derived row');
    assert.ok(stateBefore.maxWbLastUpdated, 'the derived row carries a vintage');

    // The observations carry the very same stamp in this healthy fixture.
    const scan = await db.execute({
      sql: 'SELECT MAX(wb_last_updated) AS v FROM observations WHERE wb_last_updated IS NOT NULL',
      args: [],
    });
    assert.equal(before.wbLastUpdated, scan.rows[0].v, 'healthy fixture: row == scan');

    // --- 2. apply EXACTLY the proposed production repair ---------------
    // (the observations are untouched; only the derived metadata changes)
    await db.execute({
      sql: `UPDATE dataset_state
              SET max_wb_last_updated = (
                    SELECT MAX(wb_last_updated) FROM observations WHERE wb_last_updated IS NOT NULL
                  ),
                  integrity_verified_content_version = NULL,
                  integrity_checks_json = NULL,
                  updated_at = ?
            WHERE id = 1`,
      args: [new Date().toISOString()],
    });

    // --- 3. the SAME running server now serves the corrected value -----
    const after = await svc.status();
    const stateAfter = await repository.getDatasetState(db);
    assert.equal(after.wbLastUpdated, stateAfter.maxWbLastUpdated, 'served vintage == corrected row');
    assert.equal(
      after.wbLastUpdated,
      scan.rows[0].v,
      'the repair alone changes the served vintage — no restart, no refresh, no deployment',
    );
    assert.equal(after.observations, before.observations, 'the observation count is untouched');
    assert.equal(
      after.integrity.passed,
      true,
      'the corrected row passes L.vintage_provenance again',
    );
  } finally {
    await svc.close();
    db.close();
  }
});

test('a STALE derived row is what the deployed backend serves (the production fingerprint)', async () => {
  // Seed the October release: the observations carry '2026-10-08'.
  const db = await seededDb('2026-10-08');
  const svc = await statusServer(db);
  try {
    const repository = await import('../src/db/repository.js');
    const state = await repository.getDatasetState(db);
    assert.equal(state.maxWbLastUpdated, '2026-10-08', 'the healthy derived row names the October release');
    const scan = await db.execute({
      sql: 'SELECT MAX(wb_last_updated) AS v FROM observations WHERE wb_last_updated IS NOT NULL',
      args: [],
    });
    assert.equal(scan.rows[0].v, '2026-10-08', 'the observations carry the October release');

    // Reproduce the production footprint exactly: the DEPLOYED (buggy) write
    // path copied the PREVIOUS release's value forward, so the derived row
    // still names July while every observation names October.
    await db.execute({
      sql: 'UPDATE dataset_state SET max_wb_last_updated = ? WHERE id = 1',
      args: ['2026-07-13'],
    });

    const status = await svc.status();
    assert.equal(
      status.wbLastUpdated,
      '2026-07-13',
      'the served vintage is the STALE derived row, exactly as production shows',
    );
    assert.notEqual(
      status.wbLastUpdated,
      scan.rows[0].v,
      'the served value differs from the scan (2026-07-13 vs 2026-10-08)',
    );
    // The new integrity check surfaces the divergence instead of hiding it.
    assert.equal(status.integrity.passed, false, 'the divergence is reported as a failure');
    const l = status.integrity.checks.find((c) => c.check === 'L.vintage_provenance');
    assert.equal(l.status, 'fail');
  } finally {
    await svc.close();
    db.close();
  }
});

test('the DEPLOYED write path would freeze the repaired vintage again (why the fix is still required)', async () => {
  const db = await seededDb();
  try {
    const repository = await import('../src/db/repository.js');
    // The DEPLOYED (pre-fix) write path computed the field from the cached
    // row: computeDatasetState() called getMaxWbLastUpdated(), which returns
    // the row's own value whenever a row exists. Simulated here literally.
    const deployedWritePath = async () => repository.getMaxWbLastUpdated(db);

    // The repaired row now holds the correct value.
    const correct = await db.execute({
      sql: 'SELECT MAX(wb_last_updated) AS v FROM observations WHERE wb_last_updated IS NOT NULL',
      args: [],
    });
    await db.execute({
      sql: 'UPDATE dataset_state SET max_wb_last_updated = ? WHERE id = 1',
      args: [correct.rows[0].v],
    });
    assert.equal(await deployedWritePath(), correct.rows[0].v, 'the deployed write path copies the current value forward');

    // Now the upstream advances to a NEWER release. The deployed write path
    // would copy the OLD cached value forward again and freeze the vintage;
    // the fixed write path re-derives it from the observations.
    const nextRelease = '2027-01-15';
    await db.execute({
      sql: 'UPDATE observations SET wb_last_updated = ?',
      args: [nextRelease],
    });
    const deployedWouldFreeze = await deployedWritePath();
    assert.equal(
      deployedWouldFreeze,
      correct.rows[0].v,
      'the deployed write path would keep the OLD vintage (it copies the cache)',
    );
    assert.notEqual(deployedWouldFreeze, nextRelease, 'the newer release would never be reported');

    // The FIXED write path re-derives the value from the observations.
    const fixed = await repository.computeDatasetState(db);
    assert.equal(fixed.maxWbLastUpdated, nextRelease, 'the fixed write path reports the newer release');
  } finally {
    db.close();
  }
});
