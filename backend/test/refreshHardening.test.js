/**
 * REFRESH/DATA-INTEGRITY HARDENING TESTS.
 *
 * Proves the fetch → validate → atomic-publish model with all-or-nothing
 * semantics, using ONLY the stub World Bank API and in-memory databases:
 *
 *   OLD VALID DATA + FAILED/PARTIAL REFRESH  =  EXACTLY THE SAME PUBLISHED DATA
 *   OLD DATA + SUCCESSFUL COMPLETE REFRESH   =  ONLY NEW VALID OBSERVATIONS
 *     (stale rows the World Bank dropped are removed, never zero-filled)
 *
 * Never touches the live API or the real cache file.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

// Keep retry backoff tiny for the failure-path tests (set before src import,
// mirroring refreshLock.test.js / ttlRefresh.test.js).
process.env.WB_RETRY_BASE_MS = '20';

// Dynamic row transform for the stale-removal test: null means "serve the
// committed fixtures verbatim".
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
  // Seeding must never inherit failure injection or row transforms from an
  // earlier test: a seed is defined as a clean full refresh.
  stub.reset();
  rowsTransform = null;
  const db = createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return { db, repository, seedRunId: summary.runId };
}

/** Baseline facts about the published dataset for before/after comparison. */
function datasetSnapshot(db) {
  const obs = db
    .prepare(
      `SELECT i.metric_key AS metricKey, o.country_id AS iso3, o.year AS year, o.value AS value
       FROM observations o JOIN indicators i ON i.id = o.indicator_id
       ORDER BY 1, 2, 3`,
    )
    .all();
  return {
    count: obs.length,
    rows: obs,
    indiaNominal2025: obs.find((r) => r.metricKey === 'nominal_current' && r.iso3 === 'IND' && r.year === 2025)?.value,
    indiaTotal2025: obs.find((r) => r.metricKey === 'total_current' && r.iso3 === 'IND' && r.year === 2025)?.value,
  };
}

function lockState(db, repository) {
  const s = repository.refreshLockStatus(db);
  return { locked: Boolean(s.locked), runId: s.runId ?? null };
}

// ---------------------------------------------------------------------------
// A. Partial refresh: 7 succeed + 1 fails → NOTHING published, run = partial.
// ---------------------------------------------------------------------------

test('A. partial refresh publishes nothing and records a partial run', async () => {
  const { db, repository, seedRunId } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const before = datasetSnapshot(db);
  assert.ok(before.count > 0, 'seeded dataset exists');
  const lastSuccessBefore = repository.getLastSuccessfulFetchTime(db);
  assert.ok(lastSuccessBefore, 'a successful run exists');

  // Fail ONLY total_constant's series (metadata path untouched, every other
  // indicator healthy). Attempts far exceed the retry budget.
  stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-partial' });

  // A partial refresh returns (never throws): it is a recorded attempt, and
  // the attempt status must say so explicitly.
  assert.equal(summary.status, 'partial');
  const failed = summary.perIndicator.filter((r) => r.error);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].metricKey, 'total_constant');
  assert.equal(summary.perIndicator.filter((r) => !r.error).length, 7);

  // The published dataset is EXACTLY the old one.
  const after = datasetSnapshot(db);
  assert.deepEqual(after, before);

  // The run is recorded as partial (with the failure stored), and freshness
  // still points at the previous success.
  const latest = repository.getLatestFetchRun(db, { status: null });
  assert.equal(latest.status, 'partial');
  assert.match(latest.error_message ?? '', /total_constant/);
  assert.equal(repository.getLastSuccessfulFetchTime(db), lastSuccessBefore);
  assert.equal(repository.getLatestFetchRun(db, { status: 'success' }).id, seedRunId);

  // Lock released with no run association left behind.
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// B. Total failure: every indicator fails → run = failed, dataset untouched.
// ---------------------------------------------------------------------------

test('B. total indicator failure publishes nothing and records a failed run', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const before = datasetSnapshot(db);
  const lastSuccessBefore = repository.getLastSuccessfulFetchTime(db);

  // Metadata succeeds; EVERY series fails (matches all series paths only).
  stub.failNextMatching({ status: 500, times: 500, substring: '/country/all/indicator/' });
  await assert.rejects(
    refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-total-fail' }),
    (error) => error.datasetRestored === true && error.datasetPreserved === true,
  );
  stub.reset();

  const after = datasetSnapshot(db);
  assert.deepEqual(after, before);

  const latest = repository.getLatestFetchRun(db, { status: null });
  assert.equal(latest.status, 'failed');
  assert.equal(repository.getLastSuccessfulFetchTime(db), lastSuccessBefore);
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// C. Country metadata failure → run = failed, dataset untouched.
// ---------------------------------------------------------------------------

test('C. country metadata failure publishes nothing and records a failed run', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const before = datasetSnapshot(db);
  stub.failNext({ status: 500, times: 500, body: 'down' });
  await assert.rejects(refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-meta-fail' }));
  stub.reset();

  assert.deepEqual(datasetSnapshot(db), before);
  assert.equal(repository.getLatestFetchRun(db, { status: null }).status, 'failed');
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// D. Stale-value removal: a newly absent World Bank value deletes the old
// row (never zero-fills); changed values are replaced verbatim.
// ---------------------------------------------------------------------------

test('D. successful refresh removes stale rows the World Bank dropped', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const beforeInd = repository
    .getEligibleObservations(db, indicator.id, 2024)
    .find((r) => r.iso3 === 'IND');
  assert.ok(beforeInd, 'precondition: IND 2024 nominal observation exists');
  const beforeUsa = repository
    .getEligibleObservations(db, indicator.id, 2025)
    .find((r) => r.iso3 === 'USA');
  assert.ok(beforeUsa, 'precondition: USA 2025 nominal observation exists');

  // New payload: IND 2024 nominal is missing; USA 2025 nominal changed by +1.
  rowsTransform = (metricKey, baseRows) => {
    if (metricKey !== 'nominal_current') return baseRows;
    return baseRows
      .filter((r) => !(r.countryiso3code === 'IND' && String(r.date) === '2024'))
      .map((r) =>
        r.countryiso3code === 'USA' && String(r.date) === '2025'
          ? { ...r, value: Number(r.value) + 1 }
          : r,
      );
  };
  try {
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-stale' });
    assert.equal(summary.status, 'success');
  } finally {
    rowsTransform = null;
  }

  // The dropped value is GONE (not zero, not stale).
  const gone = repository
    .getEligibleObservations(db, indicator.id, 2024)
    .find((r) => r.iso3 === 'IND');
  assert.equal(gone, undefined);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM observations WHERE value = 0').get().n,
    0,
    'no zero was invented for the missing observation',
  );
  // The changed value is replaced verbatim.
  const usaNow = repository
    .getEligibleObservations(db, indicator.id, 2025)
    .find((r) => r.iso3 === 'USA');
  assert.equal(usaNow.value, beforeUsa.value + 1);
  // Untouched series are byte-identical (Total GDP never refreshes here, but
  // prove the other metric in range is intact too).
  const total = repository.getIndicatorByMetricKey(db, 'total_current');
  const totalInd = repository
    .getEligibleObservations(db, total.id, 2024)
    .find((r) => r.iso3 === 'IND');
  assert.ok(totalInd, 'unrelated refreshed metric keeps its rows');
  db.close();
});

// ---------------------------------------------------------------------------
// E. Successful atomic publish: everything staged lands, run is authoritative.
// ---------------------------------------------------------------------------

test('E. successful refresh publishes the complete staged snapshot', async () => {
  const { db, repository, seedRunId } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-reseed' });
  assert.equal(summary.status, 'success');
  assert.ok(summary.runId > seedRunId);

  const latestSuccess = repository.getLatestFetchRun(db, { status: 'success' });
  assert.equal(latestSuccess.id, summary.runId);
  const stat = repository.getLatestSuccessfulIngestYearStat(db, 'nominal_current', 2025);
  assert.ok(stat, 'authoritative stat exists');
  assert.equal(stat.fetch_run_id, summary.runId);
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// F. Authoritative coverage reads ignore failed/partial runs; history keeps them.
// ---------------------------------------------------------------------------

test('F. failed/partial runs stay auditable but never describe current coverage', async () => {
  const { db, repository, seedRunId } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  // A partial run writes year stats for its 7 good indicators under its own id.
  stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
  const partial = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-partial-stats' });
  assert.equal(partial.status, 'partial');
  stub.reset();

  // The unscoped latest-stat lookup sees the partial attempt (this is exactly
  // why authoritative readers must NOT use it).
  const rawLatest = repository.getLatestIngestYearStat(db, 'nominal_current', 2025);
  assert.equal(rawLatest.fetch_run_id, partial.runId);

  // The authoritative lookup still points at the successful publish.
  const authoritative = repository.getLatestSuccessfulIngestYearStat(db, 'nominal_current', 2025);
  assert.ok(authoritative);
  assert.equal(authoritative.fetch_run_id, seedRunId);

  // Both runs remain visible in the audit history.
  const runs = repository.listFetchRuns(db, 5).map((r) => r.status);
  assert.ok(runs.includes('success'), 'success run retained');
  assert.ok(runs.includes('partial'), 'partial run retained');
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// G. Refresh lock run-id lifecycle.
// ---------------------------------------------------------------------------

test('G. lock carries the active run id and is cleared on release', async () => {
  const dbModule = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const db = dbModule.createMemoryDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  // Repository-level lifecycle first (deterministic, no timing involved).
  assert.equal(repository.acquireRefreshLock(db, { holder: 'g-test' }), true);
  const runId = repository.startFetchRun(db, { trigger: 'g-test' });
  repository.setRefreshLockRunId(db, runId);
  let status = repository.refreshLockStatus(db);
  assert.equal(Boolean(status.locked), true);
  assert.equal(status.runId, runId);
  repository.releaseRefreshLock(db);
  status = repository.refreshLockStatus(db);
  assert.equal(Boolean(status.locked), false);
  assert.equal(status.runId, null);

  // Full refresh: the lock row identifies the running run mid-flight and is
  // clean afterwards.
  let seenDuringRefresh = null;
  await refreshData({
    db,
    startYear: 2024,
    endYear: 2025,
    trigger: 'test-lock-runid',
    onProgress: (p) => {
      if (!seenDuringRefresh && p && String(p.stage ?? '').startsWith('indicator:')) {
        seenDuringRefresh = repository.refreshLockStatus(db);
      }
    },
  });
  assert.ok(seenDuringRefresh, 'observed the lock mid-refresh');
  assert.equal(Boolean(seenDuringRefresh.locked), true);
  const running = repository.getLatestFetchRun(db, { status: null });
  assert.equal(seenDuringRefresh.runId, running.id);
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// P. Publish-transaction failure rolls back delete+insert (failure AFTER the
// reconciliation DELETE and staged INSERTs, BEFORE commit).
// ---------------------------------------------------------------------------

test('P. a publish failure leaves no deleted rows and no staged rows behind', async () => {
  const { db, repository } = await seedFullDb();
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();

  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const beforeCount = repository.countObservations(db);
  const beforeInd = repository
    .getEligibleObservations(db, indicator.id, 2025)
    .find((r) => r.iso3 === 'IND');
  assert.ok(beforeInd, 'precondition: IND 2025 nominal observation exists');
  const beforeCountries = repository.countAllCountries(db);

  // Sabotage the publish transaction AFTER the observation reconciliation:
  // per-year stats cannot be written, so the whole publish (countries,
  // indicators, DELETE of old rows, INSERT of staged rows, stats, run status)
  // must roll back as one unit.
  db.exec('DROP TABLE ingest_year_stats');
  await assert.rejects(
    refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-publish-fail' }),
    (error) => error instanceof Error,
  );

  // Nothing from the publish survived: old rows are back (not deleted),
  // staged rows never landed, metadata untouched.
  assert.equal(repository.countObservations(db), beforeCount);
  const afterInd = repository
    .getEligibleObservations(db, indicator.id, 2025)
    .find((r) => r.iso3 === 'IND');
  assert.deepEqual(afterInd, beforeInd);
  assert.equal(repository.countAllCountries(db), beforeCountries);

  // The run itself is still recorded as failed (fetch_runs is audit history,
  // written outside the rolled-back transaction).
  assert.equal(repository.getLatestFetchRun(db, { status: null }).status, 'failed');
  assert.deepEqual(lockState(db, repository), { locked: false, runId: null });
  db.close();
});

// ---------------------------------------------------------------------------
// I. Production indicator substitution fails closed (fresh config imports).
// ---------------------------------------------------------------------------

test('I. production config rejects indicator substitution; test override is gated', async () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedOverride = process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR;
  const savedGate = process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES;
  const bust = () => `hardening-i-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  try {
    // Production + hostile override → import itself must throw.
    process.env.NODE_ENV = 'production';
    process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR = 'NY.GDP.MKTP.CD';
    delete process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES;
    await assert.rejects(
      import(`../src/config.js?${bust()}`),
      /Refusing to substitute/,
    );

    // Production + clean env → canonical codes.
    delete process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR;
    const prod = await import(`../src/config.js?${bust()}`);
    assert.equal(prod.METRICS.nominal_current.indicatorCode, 'NY.GDP.PCAP.CD');

    // Test mode + explicit gate + override → allowed (and only there).
    process.env.NODE_ENV = 'test';
    process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES = '1';
    process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR = 'NY.GDP.MKTP.KN';
    const gated = await import(`../src/config.js?${bust()}`);
    assert.equal(gated.METRICS.nominal_current.indicatorCode, 'NY.GDP.MKTP.KN');
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedOverride === undefined) delete process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR;
    else process.env.WORLD_BANK_NOMINAL_CURRENT_INDICATOR = savedOverride;
    if (savedGate === undefined) delete process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES;
    else process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES = savedGate;
  }
});
