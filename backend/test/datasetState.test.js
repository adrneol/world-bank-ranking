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

/** Legacy scan-derived truth, independent of dataset_state. */
async function scanTruth(db, repository) {
  const count = await repository.countObservations(db);
  const maxFetchedRow = await db.execute({ sql: 'SELECT MAX(fetched_at) AS t FROM observations', args: [] });
  const maxVintage = await repository.getMaxWbLastUpdated(db);
  const years = await repository.listAvailableYears(db);
  return {
    count,
    maxFetchedAt: maxFetchedRow.rows[0]?.t ?? null,
    maxWbLastUpdated: maxVintage,
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
      ['C.unknown_iso3', 'D.duplicate_observation', 'E.invalid_year', 'F.non_finite_value', 'F.raw_round_trip'].sort(),
    );
  } finally {
    await svc.close();
    db.close();
  }
});

test('stored checks from an old version are never served', async () => {
  const { db, repository, refreshData } = await seedDb();
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
