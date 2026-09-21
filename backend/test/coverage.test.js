/**
 * COVERAGE EXPLANATION TESTS (specification section 6, CASE A/B/C/D).
 *
 * Precedence under test: B > C > A > D. Every statement must be assembled
 * from observed counts only — containsInventedCause() proves no inferred
 * reporting-behavior claim leaks into the output.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COVERAGE_CASES,
  COVERAGE_PRECEDENCE,
  containsInventedCause,
  explainCoverageChange,
  summarizeCoverage,
} from '../src/domain/coverage.js';

function coverage(eligible, valid) {
  return summarizeCoverage({ eligibleUniverse: eligible, validObservations: valid });
}

function filtering({ received = 0, aggregate = 0, blank = 0, unknown = 0 } = {}) {
  return {
    rows_received: received,
    rows_aggregate_excluded: aggregate,
    rows_blank_iso3_skipped: blank,
    rows_unknown_country: unknown,
  };
}

test('precedence order is explicitly B > C > A > D', () => {
  assert.deepEqual([...COVERAGE_PRECEDENCE], ['B', 'C', 'A', 'D']);
});

test('CASE NONE when nothing changed', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 6), filtering: filtering({ received: 10 }), runId: 1 },
    to: { year: 2005, coverage: coverage(7, 6), filtering: filtering({ received: 10 }), runId: 1 },
    metadataChange: { comparable: true, changed: false, added: [], removed: [] },
  });
  assert.equal(result.case, COVERAGE_CASES.NONE);
  assert.equal(result.changed, false);
  assert.equal(containsInventedCause(result.statement), false);
});

test('CASE A: stable universe with changed observation coverage', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: filtering({ received: 12 }), runId: 1 },
    to: { year: 2005, coverage: coverage(7, 6), filtering: filtering({ received: 12 }), runId: 1 },
    metadataChange: { comparable: true, changed: false, added: [], removed: [] },
  });
  assert.equal(result.case, COVERAGE_CASES.A);
  assert.match(result.statement, /valid observations for 6 eligible countries\/economies for this indicator in 2005/);
  assert.equal(containsInventedCause(result.statement), false);
});

test('CASE B: metadata universe itself changed, with actual diff', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: filtering({ received: 12 }), runId: 1 },
    to: { year: 2005, coverage: coverage(8, 6), filtering: filtering({ received: 13 }), runId: 2 },
    metadataChange: { comparable: true, changed: true, added: ['NEW'], removed: [], fromRunId: 1, toRunId: 2 },
  });
  assert.equal(result.case, COVERAGE_CASES.B);
  assert.match(result.statement, /metadata universe changed/);
  assert.match(result.statement, /NEW/);
  assert.equal(containsInventedCause(result.statement), false);
});

test('CASE B takes precedence over C when both could apply', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: filtering({ received: 12, aggregate: 2 }), runId: 1 },
    to: { year: 2005, coverage: coverage(8, 6), filtering: filtering({ received: 15, aggregate: 5 }), runId: 2 },
    metadataChange: { comparable: true, changed: true, added: ['NEW'], removed: [], fromRunId: 1, toRunId: 2 },
  });
  assert.equal(result.case, COVERAGE_CASES.B);
});

test('CASE C: filtering difference alongside raw-row difference', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: filtering({ received: 12, aggregate: 2, blank: 1 }), runId: 1 },
    to: { year: 2005, coverage: coverage(7, 6), filtering: filtering({ received: 15, aggregate: 5, blank: 2 }), runId: 1 },
    metadataChange: { comparable: true, changed: false, added: [], removed: [] },
  });
  assert.equal(result.case, COVERAGE_CASES.C);
  assert.match(result.statement, /Aggregate entities are excluded/);
  assert.equal(containsInventedCause(result.statement), false);
});

test('CASE C takes precedence over A when both could apply', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: filtering({ received: 12, aggregate: 1 }), runId: 1 },
    to: { year: 2005, coverage: coverage(7, 5), filtering: filtering({ received: 14, aggregate: 3 }), runId: 1 },
    metadataChange: { comparable: true, changed: false, added: [], removed: [] },
  });
  // Both filtering and denominator changed: C wins over A per B > C > A > D.
  assert.equal(result.case, COVERAGE_CASES.C);
});

test('CASE D: different retrievals without comparable snapshots', () => {
  const result = explainCoverageChange({
    metricKey: 'nominal_current',
    from: { year: 2004, coverage: coverage(7, 7), filtering: null, runId: 11 },
    to: { year: 2005, coverage: coverage(7, 6), filtering: null, runId: 22 },
    metadataChange: { comparable: false, added: [], removed: [] },
  });
  assert.equal(result.case, COVERAGE_CASES.D);
  assert.match(result.statement, /does not infer a cause beyond the World Bank data/);
  assert.equal(containsInventedCause(result.statement), false);
});

test('no explanation invents a reporting cause', () => {
  const cases = ['A', 'B', 'C', 'D', 'NONE'];
  assert.ok(cases.length > 0);
  for (const phrase of ['did not report', 'failed to report', 'forgot', 'only has', 'countries in the world']) {
    assert.equal(containsInventedCause(`prefix ${phrase} suffix`), true);
  }
  assert.equal(containsInventedCause('World Bank WDI has valid observations for 6 eligible countries/economies.'), false);
});

// ---------- service-level: snapshots, latest-run selection ----------

test('buildMetadataChange: same run is comparable and unchanged', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db, repository } = await seedEdgeCaseDb();
  const { buildMetadataChange } = await import('../src/services/coverageService.js');
  const { recordSuccessRun } = await import('./helpers/testDb.js');

  const runId = await recordSuccessRun(db, repository, {
    universeSnapshot: { eligibleCount: 7, eligibleIds: ['IND'], aggregateIds: ['WLD'] },
  });
  const change = buildMetadataChange(db, runId, runId);
  assert.equal(change.comparable, true);
  assert.equal(change.changed, false);
  assert.deepEqual(change.added, []);
});

test('buildMetadataChange: lists actual added/removed entities', async () => {
  const { seedEdgeCaseDb, recordSuccessRun } = await import('./helpers/testDb.js');
  const { db, repository } = await seedEdgeCaseDb();
  const { buildMetadataChange } = await import('../src/services/coverageService.js');

  const runA = await recordSuccessRun(db, repository, {
    universeSnapshot: { eligibleCount: 2, eligibleIds: ['IND', 'USA'], aggregateIds: [] },
  });
  const runB = await recordSuccessRun(db, repository, {
    universeSnapshot: { eligibleCount: 2, eligibleIds: ['IND', 'BRA'], aggregateIds: [] },
  });

  const change = buildMetadataChange(db, runA, runB);
  assert.equal(change.comparable, true);
  assert.equal(change.changed, true);
  assert.deepEqual(change.added, ['BRA']);
  assert.deepEqual(change.removed, ['USA']);
});

test('buildMetadataChange: missing snapshot is not comparable', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db } = await seedEdgeCaseDb();
  const { buildMetadataChange } = await import('../src/services/coverageService.js');

  const change = buildMetadataChange(db, null, 9999);
  assert.equal(change.comparable, false);
});

test('latest-run selection is deterministic (highest fetch_run_id wins)', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db, repository } = await seedEdgeCaseDb();

  const run1 = repository.startFetchRun(db, {
    trigger: 'test', endpoint: 'stub://x', requestedStartYear: 2004, requestedEndYear: 2005,
    fetchedStartYear: 2003, fetchedEndYear: 2005, indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, run1, { status: 'success' });
  const run2 = repository.startFetchRun(db, {
    trigger: 'test', endpoint: 'stub://x', requestedStartYear: 2004, requestedEndYear: 2005,
    fetchedStartYear: 2003, fetchedEndYear: 2005, indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, run2, { status: 'success' });

  repository.upsertIngestYearStats(db, run1, [
    { metricKey: 'nominal_current', indicatorCode: 'NY.GDP.PCAP.CD', year: 2005, rowsReceived: 10 },
  ]);
  repository.upsertIngestYearStats(db, run2, [
    { metricKey: 'nominal_current', indicatorCode: 'NY.GDP.PCAP.CD', year: 2005, rowsReceived: 99 },
  ]);

  assert.ok(run2 > run1);
  const latest = repository.getLatestIngestYearStat(db, 'nominal_current', 2005);
  assert.equal(latest.fetch_run_id, run2);
  assert.equal(latest.rows_received, 99);

  const all = repository.getIngestYearStats(db, 'nominal_current', { year: 2005 });
  assert.equal(all[0].fetch_run_id, run2, 'single-year list is latest-first');
});

test('explainTotalChange uses each run own snapshot universe, not the current count', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db, repository } = await seedEdgeCaseDb();
  const { explainTotalChange } = await import('../src/services/coverageService.js');

  // Edge DB holds 7 eligible entities with 2004 total=7 and 2005 total=6.
  // Both runs snapshot eligibleCount 9 (deliberately different from the live
  // table count of 7) with identical ids, so the test proves each year's
  // coverage used its own run snapshot rather than the current count.
  const snapshotIds = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];
  const runFrom = repository.startFetchRun(db, {
    trigger: 'test', endpoint: 'stub://x', requestedStartYear: 2004, requestedEndYear: 2004,
    fetchedStartYear: 2003, fetchedEndYear: 2004, indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, runFrom, {
    status: 'success',
    universeSnapshot: { eligibleCount: 9, eligibleIds: snapshotIds, aggregateIds: [] },
  });
  const runTo = repository.startFetchRun(db, {
    trigger: 'test', endpoint: 'stub://x', requestedStartYear: 2005, requestedEndYear: 2005,
    fetchedStartYear: 2004, fetchedEndYear: 2005, indicators: ['NY.GDP.PCAP.CD'],
  });
  repository.finishFetchRun(db, runTo, {
    status: 'success',
    universeSnapshot: { eligibleCount: 9, eligibleIds: [...snapshotIds], aggregateIds: [] },
  });
  repository.upsertIngestYearStats(db, runFrom, [
    { metricKey: 'nominal_current', indicatorCode: 'NY.GDP.PCAP.CD', year: 2004, rowsReceived: 12 },
  ]);
  repository.upsertIngestYearStats(db, runTo, [
    { metricKey: 'nominal_current', indicatorCode: 'NY.GDP.PCAP.CD', year: 2005, rowsReceived: 12 },
  ]);

  const result = explainTotalChange(db, { metricKey: 'nominal_current', fromYear: 2004, toYear: 2005 });
  assert.equal(result.available, true);
  assert.equal(result.fromEligibleUniverse, 9);
  assert.equal(result.toEligibleUniverse, 9);
  assert.equal(result.case, 'A', 'same filtering, stable snapshots, denominator changed');
  assert.match(result.statement, /In 2004 the equivalent count was 7/);
});
