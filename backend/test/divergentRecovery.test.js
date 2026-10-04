/**
 * PHASE 8P — ISOLATED DIVERGENT-CONTENT RECOVERY TEST.
 *
 * Proves the remaining unproven recovery branch WITHOUT touching any real
 * database:
 *
 *   - NO real Turso: TURSO_DATABASE_URL/TOKEN are blanked before config
 *     import, resolveDbMode() is asserted 'local', and recovery always
 *     receives an injected temp-file probe (createProbe). The production
 *     probe (defaultProbePrimary) would throw with the blanked config.
 *   - NO real local file: every handle is an explicitly-pathed temp SQLite
 *     file under os.tmpdir() (unique per run); the real
 *     backend/data/worldbank.db is only ever read via bare SELECTs (no
 *     initDatabase, no writes) to prove its fingerprint never changes.
 *   - NO live World Bank API: the local stub serves all payloads.
 *
 * The tests exercise the REAL production reconciliation logic
 * (maybeRecoverPrimary → compareDatasetContent → refreshData catch-up →
 * generation re-check → promote) with injected temp handles.
 *
 * Positive: divergent fallback → catch-up publishes atomically on the test
 * primary → primary converges → promotion allowed.
 * Negative: catch-up publication sabotaged mid-publish → O7 rollback →
 * primary intact → promotion blocked, fallback stays active.
 * Regression: identical content still takes the 8N fast path (0 WB fetch,
 * 0 writes) and promotes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

// ---------------------------------------------------------------------------
// Isolated-process environment. Set BEFORE any src import (config is read
// once at import time). All of these already exist; none are new.
// ---------------------------------------------------------------------------
process.env.INGEST_START_YEAR = '2024';
process.env.INGEST_END_YEAR = '2025';
// Disable every real remote endpoint: with a blank URL the config cannot
// construct a Turso client even if a code path forgot its injected seam.
process.env.TURSO_DATABASE_URL = '';
process.env.TURSO_AUTH_TOKEN = '';
process.env.DB_MODE = 'local';
process.env.WB_RETRY_BASE_MS = '20';
process.env.WB_RECOVERY_REPROBE_MS = '0';
process.env.WB_RECOVERY_CONFIRM_MS = '0';
process.env.WB_RECOVERY_RECONCILE_COOLDOWN_MS = '0';
process.env.WB_RECOVERY_PROBE_TIMEOUT_MS = '5000';

let rowsTransform = null;
let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      rowsTransform ? rowsTransform(metricKey, baseRows) : baseRows,
  });
  useStubBaseUrl(stub.baseUrl);
  assert.ok(
    String(stub.baseUrl).startsWith('http://127.0.0.1'),
    'stub World Bank must be loopback-only',
  );
});

test.after(async () => {
  rowsTransform = null;
  await stub?.close();
  stub = null;
});

// ---------------------------------------------------------------------------
// Isolated temp databases with EXPLICIT unique paths (never createMemoryDb,
// so the exact paths can be recorded and asserted under os.tmpdir()).
// ---------------------------------------------------------------------------
async function createIsolatedDb(tag) {
  const { createClient } = await import('@libsql/client');
  const { initDatabase } = await import('../src/db/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wb-8p-${tag}-`));
  const file = path.join(dir, 'test.db');
  assert.ok(
    file.startsWith(os.tmpdir()),
    `isolated test database must live under os.tmpdir(): ${file}`,
  );
  const handle = createClient({ url: `file:${file.replace(/\\/g, '/')}` });
  await initDatabase(handle, { localFile: true });
  return { handle, dir, file };
}

async function closeIsolatedDb(db) {
  // Best-effort cleanup that can never fail a test (same contract as the
  // established createMemoryDb helper): on Windows the native libsql
  // binding keeps the file locked past close(), so removal is attempted
  // briefly and then left to the OS/reporter — isolation never depends on
  // deletion, only on the explicit unique tmpdir paths asserted at creation.
  try {
    await db.handle.close();
  } catch {
    // Best effort: already closed.
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(db.dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/** Content digest: identity + exact value/raw/vintage (never fetched_at). */
async function contentDigest(db) {
  const { queryAll } = await import('../src/db/driver.js');
  const rows = await queryAll(
    db.handle ?? db,
    `SELECT country_id, indicator_id, year, value, value_raw, wb_last_updated
       FROM observations ORDER BY 1, 2, 3`,
  );
  return JSON.stringify(rows);
}

/** Read-only fingerprint of the REAL local database (bare SELECTs only:
 * no initDatabase, no migrations, no writes — pure evidence). */
async function readProductionFingerprint() {
  const config = (await import('../src/config.js')).default;
  const { createClient } = await import('@libsql/client');
  const realFile = config.databaseFile;
  assert.ok(typeof realFile === 'string' && realFile.length > 0);
  const handle = createClient({ url: `file:${String(realFile).replace(/\\/g, '/')}` });
  try {
    const countRows = await handle.execute('SELECT COUNT(*) AS n FROM observations');
    let contentVersion = null;
    try {
      const v = await handle.execute('SELECT content_version AS v FROM dataset_state WHERE id = 1');
      contentVersion = v.rows[0]?.v ?? null;
    } catch {
      contentVersion = null;
    }
    let lastSuccessAt = null;
    try {
      const s = await handle.execute("SELECT MAX(completed_at) AS t FROM fetch_runs WHERE status = 'success'");
      lastSuccessAt = s.rows[0]?.t ?? null;
    } catch {
      lastSuccessAt = null;
    }
    return { realFile, observations: Number(countRows.rows[0]?.n ?? -1), contentVersion, lastSuccessAt };
  } finally {
    try {
      handle.close();
    } catch {
      // Best effort.
    }
  }
}

async function seedDb(db, trigger) {
  const { refreshData } = await import('../src/wb/ingest.js');
  const summary = await refreshData({
    db: db.handle,
    startYear: 2024,
    endYear: 2025,
    trigger,
  });
  assert.equal(summary.status, 'success');
  return summary;
}

async function observeRow(db, metricKey, iso3, year) {
  const repository = await import('../src/db/repository.js');
  const indicator = await repository.getIndicatorByMetricKey(db.handle, metricKey);
  assert.ok(indicator, `indicator for ${metricKey} exists`);
  const { queryGet } = await import('../src/db/driver.js');
  const row = await queryGet(
    db.handle,
    'SELECT value, value_raw AS valueRaw FROM observations WHERE country_id = ? AND indicator_id = ? AND year = ?',
    [iso3, indicator.id, year],
  );
  return { indicator, row };
}

/** Surgical single-row World Bank divergence: exactly one known observation. */
function bumpOnly(metricKey, iso3, year) {
  return (key, baseRows) => {
    if (key !== metricKey) return baseRows;
    let bumped = false;
    return baseRows.map((row) => {
      if (!bumped && row?.countryiso3code === iso3 && String(row?.date) === String(year)) {
        if (row.value === null || row.value === undefined) return row;
        bumped = true;
        const n = Number(row.value);
        return { ...row, value: typeof row.value === 'string' ? String(n + 1) : n + 1 };
      }
      return row;
    });
  };
}

/** Count + time every transaction a handle opens (report metric; no behavior change). */
function trackTransactions(handle) {
  const windows = [];
  const orig = handle.transaction.bind(handle);
  handle.transaction = async (...args) => {
    const opened = performance.now();
    try {
      return await orig(...args);
    } finally {
      windows.push({ opened, closed: performance.now() });
    }
  };
  return windows;
}

/** Sabotage ONLY the first transaction a handle opens (the publish tx),
 * with the exact live-observed Turso shape. Later (audit) transactions
 * stay pristine so failure bookkeeping records normally. */
function sabotageFirstPublish(handle) {
  const origTransaction = handle.transaction.bind(handle);
  let txCount = 0;
  const restorers = [];
  handle.transaction = async (...args) => {
    txCount += 1;
    const tx = await origTransaction(...args);
    if (txCount === 1 && typeof tx.batch === 'function') {
      const origBatch = tx.batch.bind(tx);
      let calls = 0;
      restorers.push(() => {
        tx.batch = origBatch;
      });
      tx.batch = (...bargs) => {
        calls += 1;
        if (calls === 1) {
          const error = new Error('SQLITE_UNKNOWN: Input error: stored sql reference is invalid: 1');
          error.name = 'LibsqlError';
          error.code = 'SQLITE_UNKNOWN';
          return Promise.reject(error);
        }
        return origBatch(...bargs);
      };
    }
    return tx;
  };
  return () => {
    handle.transaction = origTransaction;
    for (const restore of restorers) {
      try {
        restore();
      } catch {
        // Best effort.
      }
    }
  };
}

function evidence(label, payload) {
  console.log(`8P-EVIDENCE ${label}: ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// POSITIVE: divergent content → catch-up → convergence → promotion.
// ---------------------------------------------------------------------------

test('8P positive: divergent fallback triggers catch-up, primary converges, promotion allowed', async () => {
  const repository = await import('../src/db/repository.js');
  const server = await import('../src/server.js');
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  const { compareDatasetContent } = repository;
  const prodBefore = await readProductionFingerprint();
  const previousActive = server.getActiveDbInfo();
  const primary = await createIsolatedDb(`primary-${Date.now()}`);
  const fallback = await createIsolatedDb(`fallback-${Date.now()}`);
  evidence('isolated-paths', { primary: primary.file, fallback: fallback.file, realFile: prodBefore.realFile });
  assert.notEqual(primary.file, prodBefore.realFile);
  assert.notEqual(fallback.file, prodBefore.realFile);

  try {
    stub.reset();
    rowsTransform = null;
    await seedDb(primary, 'test-8p-primary-seed');
    await seedDb(fallback, 'test-8p-fallback-seed');
    assert.equal((await compareDatasetContent(primary.handle, fallback.handle)).identical, true);

    // Victim: exactly one known observation (IND / nominal_current / 2025).
    const before = await observeRow(fallback, 'nominal_current', 'IND', 2025);
    assert.ok(before.row && before.row.value !== null, 'victim row exists with a value');
    evidence('victim-original', {
      metric: 'nominal_current',
      code: before.indicator.code,
      country: 'IND',
      year: 2025,
      value: before.row.value,
      valueRaw: before.row.valueRaw,
    });

    // Diverge the FALLBACK through the real pipeline (surgical stub bump).
    rowsTransform = bumpOnly('nominal_current', 'IND', 2025);
    const divergeSummary = await seedDb(fallback, 'test-8p-fallback-diverge');
    rowsTransform = null;
    assert.ok(divergeSummary.rowsUpserted > 0, 'fallback republished the bumped indicator');
    const changed = divergeSummary.perIndicator.find((r) => r.metricKey === 'nominal_current');
    assert.equal(changed?.skippedUnchanged, undefined, 'only nominal_current rewrote');
    assert.ok(
      divergeSummary.perIndicator.filter((r) => !r.error && !r.skippedUnchanged).length === 1,
      'exactly one indicator republished on fallback',
    );
    const after = await observeRow(fallback, 'nominal_current', 'IND', 2025);
    evidence('victim-mutated', { value: after.row.value, valueRaw: after.row.valueRaw });
    assert.notEqual(after.row.value, before.row.value);

    const diverged = await compareDatasetContent(primary.handle, fallback.handle);
    assert.equal(diverged.identical, false, 'recovery comparison detects the difference');
    assert.deepEqual(diverged.differingIndicators, [before.indicator.code]);
    assert.equal(diverged.countriesMatch, true);

    const primaryVersionBefore = (await repository.getDatasetState(primary.handle))?.contentVersion;
    const fallbackVersion = (await repository.getDatasetState(fallback.handle))?.contentVersion;
    const fallbackDigestBefore = await contentDigest(fallback);
    const primaryCountBefore = await repository.countObservations(primary.handle);
    assert.equal(primaryVersionBefore, 1);
    assert.equal(fallbackVersion, 2);

    // Run the REAL production recovery path with injected temp handles.
    // The stub still serves the diverged (bumped) payload, so catch-up
    // reproduces exactly the fallback difference on the test primary.
    rowsTransform = bumpOnly('nominal_current', 'IND', 2025);
    const txWindows = trackTransactions(primary.handle);
    stub.reset();
    const stubRequestsBefore = stub.requestCount();
    const shared = { current: fallback.handle, isFallback: true, isDegraded: false };
    server.resetRecoveryConfirmation();
    const result = await server.maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary.handle,
      onWarn: () => {},
    });
    rowsTransform = null;
    evidence('recovery-result', result);
    assert.equal(result.recovered, true, 'divergent primary reconciles and promotes');
    assert.equal(result.reason, 'promoted');
    assert.equal(shared.current, primary.handle, 'future traffic serves the reconciled primary');
    assert.equal(shared.isFallback, false);

    // Catch-up really ran the production pipeline (WB fetch + writes).
    const stubRequestsDuring = stub.requestCount() - stubRequestsBefore;
    assert.ok(stubRequestsDuring > 0, `catch-up fetched over the stub (${stubRequestsDuring} requests)`);
    const recoveryRuns = await repository.listFetchRuns(primary.handle, 5);
    const catchUpRun = recoveryRuns.find((r) => r.trigger === 'recovery' && r.status === 'success');
    assert.ok(catchUpRun, 'successful catch-up run recorded on the test primary');
    evidence('catch-up-run', {
      rowsRetrieved: catchUpRun.rows_retrieved,
      rowsUpserted: catchUpRun.rows_upserted,
      rowsSkippedUnchanged: catchUpRun.rows_skipped_unchanged,
      transactions: txWindows.length,
      txMs: txWindows.map((w) => Math.round(w.closed - w.opened)),
    });
    assert.ok(txWindows.length >= 1, 'publication went through the O7 transaction');

    // Primary converged; fallback untouched by the catch-up.
    const converged = await compareDatasetContent(primary.handle, fallback.handle);
    assert.equal(converged.identical, true, 'primary test DB now equivalent to fallback');
    const primaryVersionAfter = (await repository.getDatasetState(primary.handle))?.contentVersion;
    assert.equal(primaryVersionAfter, 2, 'content_version advanced exactly once (1 → 2)');
    assert.equal(primaryVersionAfter, fallbackVersion);
    assert.equal(await repository.countObservations(primary.handle), primaryCountBefore);
    assert.equal(await contentDigest(fallback), fallbackDigestBefore, 'fallback DB unmodified by catch-up');
    assert.equal((await repository.getDatasetState(fallback.handle))?.contentVersion, 2);

    // Integrity + locks.
    const integrity = await runIntegrityChecks(primary.handle);
    assert.equal(integrity.passed, true, 'integrity passes on the reconciled primary');
    assert.equal((await repository.refreshLockStatus(primary.handle))?.locked, 0);
    assert.equal((await repository.refreshLockStatus(fallback.handle))?.locked, 0);

    // Production untouched.
    const prodAfter = await readProductionFingerprint();
    assert.deepEqual(prodAfter, prodBefore, 'real local database byte-content unchanged');
    evidence('production-untouched', prodAfter);
  } finally {
    rowsTransform = null;
    stub.reset();
    server.setActiveDbInfo(previousActive);
    await closeIsolatedDb(primary);
    await closeIsolatedDb(fallback);
  }
});

// ---------------------------------------------------------------------------
// NEGATIVE: catch-up publication fails mid-publish → rollback, no promotion.
// ---------------------------------------------------------------------------

test('8P negative: failed catch-up rolls back atomically and blocks promotion', async () => {
  const repository = await import('../src/db/repository.js');
  const server = await import('../src/server.js');
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  const { compareDatasetContent } = repository;
  const prodBefore = await readProductionFingerprint();
  const previousActive = server.getActiveDbInfo();
  const primary = await createIsolatedDb(`negprimary-${Date.now()}`);
  const fallback = await createIsolatedDb(`negfallback-${Date.now()}`);

  try {
    stub.reset();
    rowsTransform = null;
    await seedDb(primary, 'test-8p-neg-primary-seed');
    await seedDb(fallback, 'test-8p-neg-fallback-seed');

    rowsTransform = bumpOnly('nominal_current', 'IND', 2025);
    await seedDb(fallback, 'test-8p-neg-fallback-diverge');
    rowsTransform = null;
    assert.equal((await compareDatasetContent(primary.handle, fallback.handle)).identical, false);

    const primaryDigestBefore = await contentDigest(primary);
    const primaryVersionBefore = (await repository.getDatasetState(primary.handle))?.contentVersion;
    const fallbackDigestBefore = await contentDigest(fallback);
    assert.equal(primaryVersionBefore, 1);

    // Sabotage the publish transaction only; audit bookkeeping stays live.
    // NOTE: production closes a failed candidate; here the temp file must
    // survive for post-assertions, so it is re-opened read/write after the
    // attempt (same isolated file, no production handle involved).
    const restoreSabotage = sabotageFirstPublish(primary.handle);
    rowsTransform = bumpOnly('nominal_current', 'IND', 2025);
    stub.reset();
    const shared = { current: fallback.handle, isFallback: true, isDegraded: false };
    server.resetRecoveryConfirmation();
    const result = await server.maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary.handle,
      onWarn: () => {},
    });
    rowsTransform = null;
    restoreSabotage();
    evidence('recovery-failure-result', result);
    assert.equal(result.recovered, false, 'failed primary is never promoted');
    assert.equal(result.reason, 'reconcile-failed');
    assert.equal(shared.current, fallback.handle, 'fallback remains the active source');
    assert.equal(shared.isFallback, true);

    // Re-open the same isolated temp file (production close semantics kept).
    const { createClient } = await import('@libsql/client');
    const { initDatabase } = await import('../src/db/index.js');
    const reopened = createClient({ url: `file:${primary.file.replace(/\\/g, '/')}` });
    try {
      assert.equal(await contentDigest(reopened), primaryDigestBefore, 'no partial live-table publication');
      assert.equal((await repository.getDatasetState(reopened))?.contentVersion, 1, 'content_version unmoved');
      assert.equal((await repository.refreshLockStatus(reopened))?.locked, 0, 'lock released');
      const runs = await repository.listFetchRuns(reopened, 5);
      const failed = runs.find((r) => r.trigger === 'recovery' && r.status === 'failed');
      assert.ok(failed, 'failed catch-up recorded as audit history on the test primary');
      const integrity = await runIntegrityChecks(reopened);
      assert.equal(integrity.passed, true, 'integrity remains valid after rollback');
    } finally {
      try {
        reopened.close();
      } catch {
        // Best effort.
      }
    }
    assert.equal(await contentDigest(fallback), fallbackDigestBefore, 'fallback unchanged');
    assert.equal((await repository.refreshLockStatus(fallback.handle))?.locked, 0);

    const prodAfter = await readProductionFingerprint();
    assert.deepEqual(prodAfter, prodBefore, 'real local database byte-content unchanged');
  } finally {
    rowsTransform = null;
    stub.reset();
    server.setActiveDbInfo(previousActive);
    await closeIsolatedDb(primary);
    await closeIsolatedDb(fallback);
  }
});

// ---------------------------------------------------------------------------
// REGRESSION: identical content keeps the 8N fast path (0 fetch, 0 writes).
// ---------------------------------------------------------------------------

test('8P regression: identical primary still recovers with 0 WB fetch and 0 writes', async () => {
  const repository = await import('../src/db/repository.js');
  const server = await import('../src/server.js');
  const { compareDatasetContent } = repository;
  const prodBefore = await readProductionFingerprint();
  const previousActive = server.getActiveDbInfo();
  const primary = await createIsolatedDb(`twin-a-${Date.now()}`);
  const fallback = await createIsolatedDb(`twin-b-${Date.now()}`);

  try {
    stub.reset();
    rowsTransform = null;
    await seedDb(primary, 'test-8p-twin-a');
    await seedDb(fallback, 'test-8p-twin-b');
    assert.equal((await compareDatasetContent(primary.handle, fallback.handle)).identical, true);
    const runsBefore = (await repository.listFetchRuns(primary.handle, 20)).length;

    stub.reset();
    const shared = { current: fallback.handle, isFallback: true, isDegraded: false };
    server.resetRecoveryConfirmation();
    const result = await server.maybeRecoverPrimary(shared, {
      configuredMode: 'turso',
      createProbe: async () => primary.handle,
      onWarn: () => {},
    });
    assert.equal(result.recovered, true);
    assert.equal(result.reason, 'promoted');
    assert.equal(shared.current, primary.handle);
    assert.equal(stub.requestCount(), 0, 'identical path performs 0 World Bank fetches');
    assert.equal(
      (await repository.listFetchRuns(primary.handle, 20)).length,
      runsBefore,
      'identical path performs 0 writes (no catch-up run recorded)',
    );
    assert.equal((await repository.getDatasetState(primary.handle))?.contentVersion, 1);

    const prodAfter = await readProductionFingerprint();
    assert.deepEqual(prodAfter, prodBefore, 'real local database byte-content unchanged');
  } finally {
    rowsTransform = null;
    stub.reset();
    server.setActiveDbInfo(previousActive);
    await closeIsolatedDb(primary);
    await closeIsolatedDb(fallback);
  }
});

// ---------------------------------------------------------------------------
// HARNESS SAFETY: the isolated process cannot reach production remotes.
// ---------------------------------------------------------------------------

test('8P harness: remote endpoints disabled and temp paths isolated', async () => {
  const config = (await import('../src/config.js')).default;
  const { resolveDbMode } = await import('../src/db/index.js');
  assert.equal(config.tursoDatabaseUrl ?? '', '', 'TURSO_DATABASE_URL disabled in the isolated test process');
  assert.equal(resolveDbMode(), 'local', 'no code path resolves a remote backend');
  assert.ok(
    String(config.databaseFile).length > 0 &&
      !String(config.databaseFile).startsWith(os.tmpdir()),
    'real local file is a distinct path outside tmpdir',
  );
  assert.ok(!String(config.databaseFile).includes('wb-8p-'), 'test files never alias the real file');
});
