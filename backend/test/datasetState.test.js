/**
 * PHASE 7B-1 — DATASET_STATE SHADOW EQUIVALENCE.
 *
 * Proves the derived metadata row always equals the legacy scan-derived
 * truth, across publish/unchanged/change/drop/failure/rollback, without any
 * production consumer switched yet:
 *   observation_count == COUNT(observations)
 *   maxFetchedAt     == MAX(fetched_at)
 *   maxWbLastUpdated == MAX(wb_last_updated) [stored rows]
 *   years_json       == listAvailableYears() payload (perMetric + union)
 *   content_version  advances iff observation content changed
 *   lastSuccessAt    advances independently (fetch_runs owned)
 *   partial/failed   leave the row exactly as before (atomic rollback)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';

let rowsTransform = null;
let countryRowsTransform = null;
let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      rowsTransform ? rowsTransform(metricKey, baseRows) : baseRows,
    countryRowsFor: (baseRows) => (countryRowsTransform ? countryRowsTransform(baseRows) : baseRows),
  });
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

async function seedDb() {
  const db = await freshDb();
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  rowsTransform = null;
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return { db, repository, refreshData, seedSummary: summary };
}

/**
 * Legacy scan-derived truth, independent of dataset_state.
 *
 * The vintage is read with an EXPLICIT SQL query, never through
 * repository.getMaxWbLastUpdated(): that function is part of the code under
 * test (it serves the cached dataset_state row), so using it as the oracle
 * made this comparison tautological and allowed a stale-vintage regression
 * to pass unnoticed.
 */
async function scanTruth(db, repository) {
  const count = await repository.countObservations(db);
  const maxFetchedRow = await db.execute({ sql: 'SELECT MAX(fetched_at) AS t FROM observations', args: [] });
  const maxVintageRow = await db.execute({
    sql: 'SELECT MAX(wb_last_updated) AS v FROM observations WHERE wb_last_updated IS NOT NULL',
    args: [],
  });
  const years = await repository.listAvailableYears(db);
  return {
    count,
    maxFetchedAt: maxFetchedRow.rows[0]?.t ?? null,
    maxWbLastUpdated: maxVintageRow.rows[0]?.v ?? null,
    years,
  };
}

async function assertShadowMatches(db, repository, label) {
  const state = await repository.getDatasetState(db);
  assert.ok(state, `${label}: dataset_state row exists after publish`);
  const truth = await scanTruth(db, repository);
  assert.equal(state.observationCount, truth.count, `${label}: observation_count`);
  assert.equal(state.maxFetchedAt, truth.maxFetchedAt, `${label}: maxFetchedAt`);
  assert.equal(state.maxWbLastUpdated, truth.maxWbLastUpdated, `${label}: maxWbLastUpdated`);
  const stored = repository.parseDatasetYears(state);
  assert.ok(stored, `${label}: years_json parses`);
  assert.deepEqual(stored.perMetric, truth.years.perMetric, `${label}: perMetric years`);
  assert.deepEqual(stored.years, truth.years.years, `${label}: global years union`);
  // Global is the union of per-metric sets (never one indicator's list).
  const union = [...new Set(Object.values(stored.perMetric).flat())].sort((a, b) => a - b);
  assert.deepEqual(stored.years, union, `${label}: global == union(perMetric)`);
  return { state, truth };
}

test('fresh publish bootstraps exact state at content_version 1', async () => {
  const { db, repository } = await seedDb();
  try {
    assert.equal(await repository.getDatasetState(db).then((s) => s && 1), 1);
    const { state } = await assertShadowMatches(db, repository, 'seed');
    assert.equal(state.contentVersion, 1);
    assert.equal(state.integrityVerifiedContentVersion, null);
    assert.equal(typeof state.updatedRunId, 'number');
  } finally {
    db.close();
  }
});

test('unchanged refresh: state frozen, version frozen, freshness advances', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const before = await repository.getDatasetState(db);
    const lastBefore = await repository.getLastSuccessfulFetchTime(db);
    stub.reset();
    rowsTransform = null;
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-unchanged' });
    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0);
    const after = await repository.getDatasetState(db);
    assert.deepEqual(after, before, 'row byte-identical after unchanged refresh');
    assert.equal(after.contentVersion, before.contentVersion);
    assert.ok((await repository.getLastSuccessfulFetchTime(db)) >= lastBefore);
    await assertShadowMatches(db, repository, 'unchanged');
  } finally {
    db.close();
  }
});

test('changed refresh: version +1, exact fields', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const before = await repository.getDatasetState(db);
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
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-changed' });
    assert.equal(summary.status, 'success');
    assert.ok(summary.rowsUpserted > 0);
    const after = await repository.getDatasetState(db);
    assert.equal(after.contentVersion, before.contentVersion + 1, 'exactly one bump');
    assert.equal(after.integrityVerifiedContentVersion, null, 'verification stale after change');
    await assertShadowMatches(db, repository, 'changed');
  } finally {
    rowsTransform = null;
    db.close();
  }
});

test('row deletion: version +1, count −1, union invariant holds', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const before = await repository.getDatasetState(db);
    const countBefore = await repository.countObservations(db);
    stub.reset();
    rowsTransform = (metricKey, baseRows) => {
      if (metricKey !== 'nominal_current') return baseRows;
      let dropped = false;
      return baseRows.filter((row) => {
        if (!dropped && row.value !== null && row.value !== undefined) {
          dropped = true;
          return false;
        }
        return true;
      });
    };
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-drop' });
    assert.equal(summary.status, 'success');
    const after = await repository.getDatasetState(db);
    assert.equal(after.contentVersion, before.contentVersion + 1);
    assert.equal(after.observationCount, countBefore - 1);
    await assertShadowMatches(db, repository, 'drop');
  } finally {
    rowsTransform = null;
    db.close();
  }
});

test('partial failure: state exactly restored by rollback', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const before = await repository.getDatasetState(db);
    const lastBefore = await repository.getLastSuccessfulFetchTime(db);
    stub.reset();
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-partial' });
    assert.equal(summary.status, 'partial');
    const after = await repository.getDatasetState(db);
    assert.deepEqual(after, before, 'rollback restored metadata row');
    assert.equal(await repository.getLastSuccessfulFetchTime(db), lastBefore);
    await assertShadowMatches(db, repository, 'partial');
  } finally {
    stub.reset();
    db.close();
  }
});

test('total failure: absent stays absent, present stays frozen', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  // Absent case: empty DB, WB down → failure before any publish.
  {
    const db = await freshDb();
    try {
      stub.reset();
      stub.failNext({ status: 500, times: 500 });
      await assert.rejects(refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-fail' }));
      assert.equal(await repository.getDatasetState(db), null, 'no row invented by failure');
    } finally {
      stub.reset();
      db.close();
    }
  }
  // Present case: seeded DB, WB down → row frozen.
  {
    const { db } = await seedDb();
    try {
      const before = await repository.getDatasetState(db);
      stub.reset();
      stub.failNext({ status: 500, times: 500 });
      await assert.rejects(refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-fail2' }));
      assert.deepEqual(await repository.getDatasetState(db), before);
    } finally {
      stub.reset();
      db.close();
    }
  }
});

test('buildYearsPayload union invariant (unit)', async () => {
  const { buildYearsPayload } = await import('../src/db/repository.js');
  const indicators = [{ metric_key: 'a' }, { metric_key: 'b' }];
  // A has 2000, B does not → global has 2000.
  let out = buildYearsPayload(indicators, [
    { metric_key: 'a', year: 2000 },
    { metric_key: 'a', year: 2001 },
    { metric_key: 'b', year: 2001 },
  ]);
  assert.deepEqual(out.perMetric, { a: [2000, 2001], b: [2001] });
  assert.deepEqual(out.years, [2000, 2001]);
  // A loses 2000 but B keeps 2001 → global keeps 2001 only.
  out = buildYearsPayload(indicators, [
    { metric_key: 'a', year: 2001 },
    { metric_key: 'b', year: 2001 },
  ]);
  assert.deepEqual(out.years, [2001]);
  // Empty → null min/max, empty lists (matches listAvailableYears contract).
  out = buildYearsPayload([], []);
  assert.deepEqual(out, { years: [], minYear: null, maxYear: null, perMetric: {} });
});

test('markIntegrityVerified is version-conditional', async () => {
  const { db, repository } = await seedDb();
  try {
    const state = await repository.getDatasetState(db);
    assert.equal(await repository.markIntegrityVerified(db, state.contentVersion + 99), false);
    assert.equal((await repository.getDatasetState(db)).integrityVerifiedContentVersion, null);
    assert.equal(await repository.markIntegrityVerified(db, state.contentVersion), true);
    assert.equal(
      (await repository.getDatasetState(db)).integrityVerifiedContentVersion,
      state.contentVersion,
    );
  } finally {
    db.close();
  }
});

test('out-of-band writes invalidate instead of going stale', async () => {  const { db, repository } = await seedDb();
  try {
    assert.ok(await repository.getDatasetState(db), 'row present after publish');
    const indicator = await repository.getIndicatorByMetricKey(db, 'nominal_current');
    const before = await repository.getDatasetFingerprint(db);
    // Direct write outside the publish path: the row must disappear
    // (fallback scans), never serve stale metadata.
    await repository.upsertObservation(db, {
      countryId: 'IND',
      indicatorId: indicator.id,
      year: 2024,
      value: 12345.678,
      wbLastUpdated: '2026-07-13',
    });
    assert.equal(await repository.getDatasetState(db), null, 'row invalidated');
    const after = await repository.getDatasetFingerprint(db);
    assert.equal(after.observationCount, before.observationCount, 'count stable (overwrite)');
    assert.notEqual(after.maxFetchedAt, before.maxFetchedAt, 'freshness reflects the write');
    // Metadata writes invalidate too.
    await repository.upsertCountry(db, {
      id: 'TST',
      iso2: 'TT',
      iso3: 'TST',
      name: 'Testland',
      isAggregate: false,
    });
    assert.equal(await repository.getDatasetState(db), null);
  } finally {
    db.close();
  }
});

test('parseDatasetYears rejects corrupt payloads', async () => {
  const { parseDatasetYears } = await import('../src/db/repository.js');
  assert.equal(parseDatasetYears(null), null);
  assert.equal(parseDatasetYears({ yearsJson: 'not json' }), null);
  assert.equal(parseDatasetYears({ yearsJson: '{"perMetric":{}}' }), null);
  assert.deepEqual(parseDatasetYears({ yearsJson: '{"perMetric":{"a":[2000]},"years":[2000]}' }), {
    perMetric: { a: [2000] },
    years: [2000],
  });
});

test('merged batteries deep-equal the full integrity report', async () => {
  const { db } = await seedDb();
  try {
    const integrity = await import('../src/services/integrity.js');
    const full = await integrity.runIntegrityChecks(db);
    const merged = integrity.mergeIntegrityChecks(
      await integrity.runCheapIntegrityChecks(db),
      await integrity.runExpensiveIntegrityChecks(db),
      await integrity.runMetadataIntegrityChecks(db),
    );
    assert.deepEqual(
      merged.map((c) => [c.check, c.status]),
      full.checks.map((c) => [c.check, c.status]),
    );
    assert.deepEqual(merged, full.checks);
    assert.equal(full.passed, merged.every((c) => c.status === 'pass'));
  } finally {
    db.close();
  }
});

test('metadata readers equal legacy scans (row present vs row deleted)', async () => {
  const { db, repository } = await seedDb();
  try {
    const withRow = {
      fingerprint: await repository.getDatasetFingerprint(db),
      vintage: await repository.getMaxWbLastUpdated(db),
    };
    const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
    resetYearsCache();
    withRow.years = await getCachedAvailableYears(db);
    // Remove the row: every reader must fall back to scans with identical values.
    await db.execute({ sql: 'DELETE FROM dataset_state WHERE id = 1', args: [] });
    resetYearsCache();
    const legacy = {
      fingerprint: await repository.getDatasetFingerprint(db),
      vintage: await repository.getMaxWbLastUpdated(db),
      years: await getCachedAvailableYears(db),
    };
    assert.deepEqual(legacy.fingerprint, withRow.fingerprint);
    assert.equal(legacy.vintage, withRow.vintage);
    assert.deepEqual(legacy.years, withRow.years);
  } finally {
    db.close();
  }
});

async function startStatusServer(db) {
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

test('status serves metadata fingerprint + years + merged integrity, marks verified', async () => {
  const { db, repository } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    const first = await svc.status();
    assert.equal(typeof first.observations, 'number');
    assert.ok(first.observations > 0);
    assert.ok(first.fingerprint);
    assert.equal(first.fingerprint.observationCount, first.observations);
    assert.ok(first.integrity.passed, JSON.stringify(first.integrity));
    assert.ok(Array.isArray(first.years.years) && first.years.years.length > 0);
    const state = await repository.getDatasetState(db);
    assert.equal(state.integrityVerifiedContentVersion, state.contentVersion);
    const second = await svc.status();
    assert.deepEqual(second.fingerprint, first.fingerprint);
    assert.deepEqual(second.integrity, first.integrity);
    // No recompute+mark on the second poll: the row is untouched.
    assert.deepEqual(await repository.getDatasetState(db), state);
  } finally {
    await svc.close();
    db.close();
  }
});

/**
 * The one-time production repair, rehearsed end to end.
 *
 * A stale derived vintage is detected, a FAILED vintage-provenance result is
 * never persisted as a verification, and the repair statement (which also
 * invalidates the persisted verification) makes the next status request
 * re-derive and re-persist the correct report.
 */
test('a failed vintage-provenance result is never cached; the repair invalidates the memo', async () => {
  const { db, repository } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    // 1. A healthy dataset verifies and persists its report.
    const healthy = await svc.status();
    assert.ok(healthy.integrity.passed, 'the healthy dataset passes');
    const verified = await repository.getDatasetState(db);
    assert.equal(verified.integrityVerifiedContentVersion, verified.contentVersion);
    assert.ok(
      JSON.parse(verified.integrityChecksJson).some((c) => c.check === 'L.vintage_provenance'),
      'the persisted report contains the vintage-provenance check',
    );

    // 2. Corrupt ONLY the derived row (the observations are untouched): this
    //    is the production defect's footprint.
    await db.execute({
      sql: 'UPDATE dataset_state SET max_wb_last_updated = ? WHERE id = 1',
      args: ['2019-01-01'],
    });

    // 3. The next status request must NOT report "pass" on a stale vintage.
    const corrupted = await svc.status();
    assert.equal(corrupted.integrity.passed, false, 'the stale vintage is reported as a failure');
    const failing = corrupted.integrity.checks.find((c) => c.check === 'L.vintage_provenance');
    assert.equal(failing.status, 'fail');
    assert.equal(failing.detail?.cachedVintage ?? null, null, 'the status payload carries no detail');
    const afterFailure = await repository.getDatasetState(db);
    // A FAILED report is never persisted as a verification: the stored report
    // is the previous (passing) one, and the verification mark is unchanged.
    assert.equal(
      afterFailure.integrityVerifiedContentVersion,
      verified.integrityVerifiedContentVersion,
      'a failed report does not advance the verification mark',
    );

    // 4. The repair: derive the vintage FROM the observations and invalidate
    //    the persisted verification so the next request recomputes it.
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

    // 5. The next status request re-derives, re-verifies and re-persists.
    const repaired = await svc.status();
    assert.ok(repaired.integrity.passed, 'the repaired dataset passes');
    const repairedState = await repository.getDatasetState(db);
    assert.equal(repairedState.integrityVerifiedContentVersion, repairedState.contentVersion);
    assert.ok(
      JSON.parse(repairedState.integrityChecksJson).some((c) => c.check === 'L.vintage_provenance'),
      'the re-persisted report contains the vintage-provenance check',
    );
  } finally {
    await svc.close();
    db.close();
  }
});

test('status separates the last successful check from the last data change', async () => {
  const { db, repository, refreshData } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    const first = await svc.status();
    // The successful CHECK time and the last DATA CHANGE are separate facts.
    assert.ok(first.lastSuccessAt, 'the successful check timestamp is served');
    assert.ok(first.lastDataChangeAt, 'the last data change timestamp is served');
    assert.notEqual(
      first.lastDataChangeAt,
      null,
      'the dataset state records when observations were last written',
    );
    // The refresh outcome distinguishes checked / changed / unchanged / failed.
    assert.ok(first.refreshOutcome, 'the terminal outcome is served');
    assert.equal(first.refreshOutcome.total, 20);
    assert.equal(first.refreshOutcome.checked, 20);
    assert.equal(first.refreshOutcome.updated, 20, 'the seed published every indicator');
    assert.equal(first.refreshOutcome.unchanged, 0);
    assert.equal(first.refreshOutcome.failed, 0);

    // A successful check that changed NOTHING keeps the data-change stamp but
    // advances the check stamp, and reports the run as unchanged.
    const dataChangeBefore = first.lastDataChangeAt;
    stub.reset();
    const unchanged = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-status-check' });
    assert.equal(unchanged.status, 'success');
    const second = await svc.status();
    assert.equal(second.lastDataChangeAt, dataChangeBefore, 'no data changed: the change stamp is unchanged');
    assert.ok(
      second.lastSuccessAt >= first.lastSuccessAt,
      'the successful check stamp advanced',
    );
    assert.equal(second.refreshOutcome.updated, 0, 'nothing was rewritten');
    assert.equal(second.refreshOutcome.unchanged, 20, 'every indicator was proven identical');
    assert.equal(second.refreshOutcome.checked, 20);
    assert.equal(second.refreshOutcome.failed, 0);
  } finally {
    await svc.close();
    db.close();
  }
});

test('unchanged refresh reuses expensive verification; changed refresh re-verifies', async () => {
  const { db, repository, refreshData } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    await svc.status();
    const v1 = (await repository.getDatasetState(db)).contentVersion;
    // Unchanged refresh: new success run, same content.
    stub.reset();
    rowsTransform = null;
    const unchanged = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-u' });
    assert.equal(unchanged.status, 'success');
    const afterUnchanged = await svc.status();
    assert.equal(afterUnchanged.fingerprint.runId, unchanged.runId, 'retrieval generation advances');
    const stateU = await repository.getDatasetState(db);
    assert.equal(stateU.contentVersion, v1, 'content generation frozen');
    assert.equal(stateU.integrityVerifiedContentVersion, v1, 'verification still valid, no rescan mark');
    // Changed refresh: version advances, verification goes stale until status re-verifies.
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
    const changed = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-c' });
    assert.equal(changed.status, 'success');
    // Immediately after publish, before any status: stale by design.
    assert.equal((await repository.getDatasetState(db)).integrityVerifiedContentVersion, null);
    const afterChanged = await svc.status();
    assert.ok(afterChanged.integrity.passed);
    const stateC = await repository.getDatasetState(db);
    assert.equal(stateC.contentVersion, v1 + 1);
    assert.equal(stateC.integrityVerifiedContentVersion, v1 + 1, 're-verified on first status');
  } finally {
    rowsTransform = null;
    stub.reset();
    await svc.close();
    db.close();
  }
});

test('restart simulation: verified content serves stored checks without rescanning', async () => {
  const { db, repository } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    const first = await svc.status();
    assert.ok(first.integrity.passed);
    const state = await repository.getDatasetState(db);
    assert.equal(state.integrityVerifiedContentVersion, state.contentVersion);
    assert.ok(state.integrityChecksJson, 'expensive checks persisted');

    // Simulate a process restart: drop both in-process memos, keep the DB.
    const statusCache = await import('../src/services/statusCache.js');
    const { resetYearsCache } = await import('../src/services/yearsCache.js');
    statusCache.resetIntegrityCache();
    resetYearsCache();

    const seen = [];
    const orig = db.execute.bind(db);
    db.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
      if (sql && /observations/i.test(sql)) seen.push(sql.replace(/\s+/g, ' ').slice(0, 80));
      return orig(...args);
    };
    let second;
    try {
      second = await svc.status();
    } finally {
      db.execute = orig;
    }
    assert.deepEqual(second.integrity, first.integrity, 'identical merged report');
    const fullScans = seen.filter((sql) => /COUNT\(\*\) AS n FROM observations$|MAX\(|GROUP BY|rowid/i.test(sql));
    assert.deepEqual(fullScans, [], `no full scans after restart, saw: ${JSON.stringify(fullScans)}`);
  } finally {
    await svc.close();
    db.close();
  }
});

test('corrupt stored checks fall back to a live rescan and self-heal', async () => {
  const { db, repository } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    await svc.status();
    const state = await repository.getDatasetState(db);
    assert.ok(state.integrityChecksJson);
    // Corrupt the persisted report but keep the version mark.
    await db.execute({ sql: 'UPDATE dataset_state SET integrity_checks_json = ? WHERE id = 1', args: ['bogus'] });
    const statusCache = await import('../src/services/statusCache.js');
    statusCache.resetIntegrityCache();
    const body = await svc.status();
    assert.ok(body.integrity.passed, 'live rescan passes');
    const healed = await repository.getDatasetState(db);
    assert.ok(healed.integrityChecksJson && healed.integrityChecksJson !== 'bogus', 'stored report repaired');
    assert.deepEqual(
      JSON.parse(healed.integrityChecksJson).map((c) => c.check).sort(),
      [
        'C.unknown_iso3',
        'D.duplicate_observation',
        'E.invalid_year',
        'F.non_finite_value',
        'F.raw_round_trip',
        'L.vintage_provenance',
      ].sort(),
    );
  } finally {
    await svc.close();
    db.close();
  }
});

test('stored checks from an old version are never served', async () => {  const { db, repository, refreshData } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    await svc.status();
    const v1 = (await repository.getDatasetState(db)).contentVersion;
    // Changed publish advances the version; the old stored report must not
    // be served for the new content even though it parses.
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
    const changed = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-oldver' });
    assert.equal(changed.status, 'success');
    const mid = await repository.getDatasetState(db);
    assert.equal(mid.contentVersion, v1 + 1);
    assert.equal(mid.integrityVerifiedContentVersion, null);
    // The previous version's stored checks are gone (nulled at publish).
    assert.equal(mid.integrityChecksJson, null);
    const body = await svc.status();
    assert.ok(body.integrity.passed);
    assert.equal((await repository.getDatasetState(db)).integrityVerifiedContentVersion, v1 + 1);
  } finally {
    rowsTransform = null;
    stub.reset();
    await svc.close();
    db.close();
  }
});

test('metadata-only change advances version without touching observations', async () => {
  const { db, repository, refreshData } = await seedDb();
  const svc = await startStatusServer(db);
  try {
    await svc.status();
    const v1 = (await repository.getDatasetState(db)).contentVersion;
    const obsBefore = await repository.countObservations(db);
    stub.reset();
    rowsTransform = null;
    countryRowsTransform = (baseRows) =>
      baseRows.map((row) => (row?.id === 'IND' ? { ...row, name: `${row.name} (renamed)` } : row));
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-metachange' });
    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0, 'zero observation writes on metadata-only change');
    const mid = await repository.getDatasetState(db);
    assert.equal(mid.contentVersion, v1 + 1, 'metadata change advances the generation');
    assert.equal(mid.integrityVerifiedContentVersion, null, 'verification stale after change');
    assert.equal(mid.observationCount, obsBefore);
    assert.equal((await repository.getCountry(db, 'IND')).name.includes('(renamed)'), true);
    await assertShadowMatches(db, repository, 'metadata-change');
    const body = await svc.status();
    assert.ok(body.integrity.passed);
    assert.equal((await repository.getDatasetState(db)).integrityVerifiedContentVersion, v1 + 1);
  } finally {
    rowsTransform = null;
    countryRowsTransform = null;
    stub.reset();
    await svc.close();
    db.close();
  }
});

test('countries proof: identical skips, any source difference writes', async () => {
  const { isCountriesPayloadUnchanged } = await import('../src/wb/ingest.js');
  const staged = [
    { id: 'IND', iso2: 'IN', iso3: 'IND', name: 'India', region: 'South Asia', regionId: 'SAS', adminRegion: null, incomeLevel: 'Lower middle income', lendingType: 'IBRD', capitalCity: 'New Delhi', isAggregate: false, aggregateReason: null },
    { id: 'WLD', iso2: null, iso3: 'WLD', name: 'World', region: 'Aggregates', regionId: 'NA', adminRegion: null, incomeLevel: null, lendingType: null, capitalCity: null, isAggregate: true, aggregateReason: 'region-na' },
  ];
  const storedSame = [
    { id: 'IND', iso2: 'IN', iso3: 'IND', name: 'India', region: 'South Asia', region_id: 'SAS', admin_region: null, income_level: 'Lower middle income', lending_type: 'IBRD', capital_city: 'New Delhi', is_aggregate: 0, aggregate_reason: null },
    { id: 'WLD', iso2: null, iso3: 'WLD', name: 'World', region: 'Aggregates', region_id: 'NA', admin_region: null, income_level: null, lending_type: null, capital_city: null, is_aggregate: 1, aggregate_reason: 'region-na' },
  ];
  assert.equal(isCountriesPayloadUnchanged(storedSame, staged), true, 'camel/snake + boolean/int forms match');
  // Every source column flip forces a write.
  const flips = [
    ['iso2', 'XX'], ['name', 'India!'], ['region', 'X'], ['regionId', 'X'], ['adminRegion', 'X'],
    ['incomeLevel', 'X'], ['lendingType', 'X'], ['capitalCity', 'X'], ['aggregateReason', 'X'],
  ];
  for (const [field, value] of flips) {
    const variant = structuredClone(staged);
    variant[0][field] = value;
    assert.equal(isCountriesPayloadUnchanged(storedSame, variant), false, `${field} flip writes`);
  }
  const flagFlip = structuredClone(staged);
  flagFlip[1].isAggregate = false;
  assert.equal(isCountriesPayloadUnchanged(storedSame, flagFlip), false, 'aggregate flag flip writes');
  // Missing staged rows still skip: the upsert never deletes, so stored
  // extras remain untouched under both paths (content-identical outcome;
  // updated_at is write-only bookkeeping no service reads).
  assert.equal(isCountriesPayloadUnchanged(storedSame, [staged[0]]), true, 'dropped entity still skips');
  assert.equal(
    isCountriesPayloadUnchanged([...storedSame, { ...storedSame[0], id: 'OLD' }], staged),
    true,
    'extra stored entity still skips',
  );
  assert.equal(isCountriesPayloadUnchanged([storedSame[0]], staged), false, 'new staged entity writes');
  // Null/undefined normalization matches the nz() builder.
  const undefStaged = structuredClone(staged);
  delete undefStaged[1].capitalCity;
  assert.equal(isCountriesPayloadUnchanged(storedSame, undefStaged), true, 'undefined == null');
  assert.equal(isCountriesPayloadUnchanged(null, staged), false);
  // Empty staged is unreachable in production (empty universe throws
  // before publish) and the upsert would be a no-op anyway: vacuous skip.
  assert.equal(isCountriesPayloadUnchanged(storedSame, []), true, 'empty staged skips vacuously');
});

test('unchanged refresh writes zero country statements', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    stub.reset();
    rowsTransform = null;
    const seen = [];
    const watch = (handle) => {
      const origExec = handle.execute.bind(handle);
      handle.execute = (...args) => {
        const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? '';
        seen.push(sql);
        return origExec(...args);
      };
      if (handle.batch) {
        const origBatch = handle.batch.bind(handle);
        handle.batch = (...args) => {
          for (const entry of args[0] ?? []) seen.push(entry.sql);
          return origBatch(...args);
        };
      }
    };
    const origTx = db.transaction.bind(db);
    db.transaction = async (...args) => {
      const tx = await origTx(...args);
      watch(tx);
      return tx;
    };
    const origExecDb = db.execute.bind(db);
    const origBatchDb = db.batch.bind(db);
    watch(db);
    let summary;
    try {
      summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-cskip' });
    } finally {
      db.execute = origExecDb;
      db.batch = origBatchDb;
      db.transaction = origTx;
    }
    assert.equal(summary.status, 'success');
    assert.ok(!seen.some((sql) => /INSERT INTO countries/i.test(sql)), 'no country writes when identical');
    assert.ok(seen.some((sql) => /FROM countries/i.test(sql)), 'stored metadata was compared');
    // Stored metadata byte-identical afterwards.
    const after = await repository.getDatasetState(db);
    assert.ok(after, 'state row intact');
  } finally {
    db.close();
  }
});

// ============================================================
// STALE-VINTAGE REGRESSION (the confirmed production defect).
//
// The derived dataset_state row used to be recomputed from the cached row
// itself, so an upstream release that changed the stored values left the
// reported vintage frozen at the previous release's date forever. Every
// assertion below compares against an EXPLICIT SQL query over the
// observations table - never against a repository getter that reads the
// cache under test.
// ============================================================

/** Every distinct provenance stamp currently stored, with its row count. */
async function storedVintageRows(db) {
  const rows = await db.execute({
    sql: 'SELECT wb_last_updated AS stamp, COUNT(*) AS n FROM observations GROUP BY 1 ORDER BY 1',
    args: [],
  });
  return rows.rows.map((r) => ({ stamp: r.stamp ?? null, n: Number(r.n) }));
}

test('recomputing an existing dataset_state row re-derives the vintage from observations', async () => {
  const { db, repository } = await seedDb();
  try {
    const truth = await scanTruth(db, repository);
    assert.ok(truth.maxWbLastUpdated, 'fixture rows carry a provenance stamp');

    // Poison the derived row with an intentionally older vintage: the exact
    // production shape of the defect (cached row = old release, observations
    // = newer release).
    const staleVintage = '2019-01-01';
    await db.execute({
      sql: 'UPDATE dataset_state SET max_wb_last_updated = ? WHERE id = 1',
      args: [staleVintage],
    });
    // The cached READER is unchanged: it still serves the cached row (the
    // read optimization stays intact).
    assert.equal(await repository.getMaxWbLastUpdated(db), staleVintage, 'reader still serves the cached row');

    // The WRITER must not copy that cached value forward.
    const recomputed = await repository.computeDatasetState(db);
    assert.equal(
      recomputed.maxWbLastUpdated,
      truth.maxWbLastUpdated,
      'recompute re-derives the vintage from the observations table',
    );
    assert.notEqual(recomputed.maxWbLastUpdated, staleVintage, 'the stale cached value is not copied forward');
  } finally {
    db.close();
  }
});

test('content-changing refresh publishes the new vintage and the derived row agrees', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const before = await repository.getDatasetState(db);
    const olderVintage = '2021-05-05';
    const newerVintage = '2026-10-08';

    stub.reset();
    stub.setSeriesLastUpdated(olderVintage);
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
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-vintage-change' });
    assert.equal(summary.status, 'success');
    assert.ok(summary.rowsUpserted > 0, 'values were rewritten');

    // Now the upstream release advances again (new vintage, same values for
    // the indicators that did not change).
    stub.reset();
    stub.setSeriesLastUpdated(newerVintage);
    const second = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-vintage-change-2' });
    assert.equal(second.status, 'success');

    const truth = await scanTruth(db, repository);
    const after = await repository.getDatasetState(db);
    assert.equal(after.maxWbLastUpdated, truth.maxWbLastUpdated, 'derived vintage equals the stored provenance');
    assert.equal(after.maxWbLastUpdated, newerVintage, 'derived vintage is the newest release');
    assert.ok(after.contentVersion > before.contentVersion, 'content version advanced');
    const stamps = await storedVintageRows(db);
    assert.deepEqual(
      stamps.map((s) => s.stamp),
      [newerVintage],
      'every stored row carries the newest release stamp',
    );
  } finally {
    rowsTransform = null;
    db.close();
  }
});

test('upstream metadata advancing without value changes updates provenance only', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const beforeState = await repository.getDatasetState(db);
    const beforeRows = await db.execute({
      sql: 'SELECT indicator_id AS i, country_id AS c, year AS y, value AS v, value_raw AS vr FROM observations ORDER BY i, c, y',
      args: [],
    });
    const beforeVintages = await storedVintageRows(db);
    assert.equal(beforeVintages.length, 1, 'fixture starts with one provenance stamp');

    const newerVintage = '2026-10-08';
    stub.reset();
    stub.setSeriesLastUpdated(newerVintage);
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-vintage-advance' });
    assert.equal(summary.status, 'success');
    assert.equal(summary.rowsUpserted, 0, 'no economic observation row was rewritten');
    assert.ok(summary.rowsSkippedUnchanged > 0, 'rows were proven identical');

    // Values and their raw decimal representation are untouched.
    const afterRows = await db.execute({
      sql: 'SELECT indicator_id AS i, country_id AS c, year AS y, value AS v, value_raw AS vr FROM observations ORDER BY i, c, y',
      args: [],
    });
    assert.deepEqual(afterRows.rows, beforeRows.rows, 'economic values and raw strings are unchanged');

    // The provenance stamp advanced to the new release.
    const afterVintages = await storedVintageRows(db);
    assert.deepEqual(
      afterVintages.map((s) => s.stamp),
      [newerVintage],
      'provenance advanced to the new release',
    );
    assert.equal(
      afterVintages[0].n,
      beforeVintages[0].n,
      'no row was added or removed by the metadata-only advance',
    );

    // The derived row agrees with the stored provenance and was recomputed.
    const truth = await scanTruth(db, repository);
    const afterState = await repository.getDatasetState(db);
    assert.equal(afterState.maxWbLastUpdated, truth.maxWbLastUpdated, 'derived vintage matches the scan');
    assert.equal(afterState.maxWbLastUpdated, newerVintage, 'derived vintage is the new release');
    assert.ok(
      afterState.contentVersion > beforeState.contentVersion,
      'a provenance advance is a content change (memo keys must advance)',
    );
  } finally {
    stub.reset();
    db.close();
  }
});

test('a generic older-to-newer vintage transition is followed (not hard-coded to any release)', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    // Deliberately arbitrary dates: the behaviour must follow whatever the
    // upstream reports, so every future World Bank release is covered.
    const genericOlder = '2018-03-04';
    const genericNewer = '2023-11-19';
    stub.reset();
    stub.setSeriesLastUpdated(genericOlder);
    const first = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-generic-older' });
    assert.equal(first.status, 'success');
    let truth = await scanTruth(db, repository);
    assert.equal((await repository.getDatasetState(db)).maxWbLastUpdated, genericOlder);
    assert.equal(truth.maxWbLastUpdated, genericOlder);

    stub.reset();
    stub.setSeriesLastUpdated(genericNewer);
    const second = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-generic-newer' });
    assert.equal(second.status, 'success');
    truth = await scanTruth(db, repository);
    assert.equal((await repository.getDatasetState(db)).maxWbLastUpdated, genericNewer);
    assert.equal(truth.maxWbLastUpdated, genericNewer);
  } finally {
    stub.reset();
    db.close();
  }
});

test('a failed refresh publishes no provenance advance', async () => {
  const { db, repository, refreshData } = await seedDb();
  try {
    const beforeState = await repository.getDatasetState(db);
    const beforeVintages = await storedVintageRows(db);

    stub.reset();
    stub.setSeriesLastUpdated('2026-10-08');
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-vintage-rollback' });
    assert.equal(summary.status, 'partial', 'the refresh failed and published nothing');

    const afterVintages = await storedVintageRows(db);
    assert.deepEqual(afterVintages, beforeVintages, 'no provenance was advanced by the failed run');
    const afterState = await repository.getDatasetState(db);
    assert.deepEqual(afterState, beforeState, 'the derived row is exactly as before');
  } finally {
    stub.reset();
    db.close();
  }
});
