/**
 * DATA INTEGRITY CHECK TESTS (specification section 27, checks A-J).
 *
 * Each check must actually exercise its failure mode: a dedicated dirty
 * database per failing case, plus the clean seeded and empty databases.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryTestDb, seedEdgeCaseDb } from './helpers/testDb.js';

async function run(db) {
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  return runIntegrityChecks(db);
}

function statusOf(report, check) {
  return report.checks.find((c) => c.check === check)?.status ?? null;
}

test('clean database passes null/aggregate/orphan/duplicate/year/finite checks', async () => {
  // NOTE: seedEdgeCaseDb deliberately stores WLD/HIC aggregate observations
  // to prove query-level exclusion, so it is NOT clean for check B. Build a
  // production-like database holding only eligible observations instead.
  const { db } = await createMemoryTestDb();
  const repository = await import('../src/db/repository.js');
  const { METRICS } = await import('../src/config.js');
  const { buildUniverse } = await import('../src/domain/universe.js');
  const { EDGE_METADATA, EDGE_BLANK_METADATA, EDGE_OBSERVATIONS } = await import('./fixtures/edgeCases.js');

  const universe = buildUniverse([...EDGE_METADATA, ...EDGE_BLANK_METADATA]);
  repository.upsertCountries(db, universe.countries);
  const { ALL_METRIC_KEYS } = await import('../src/config.js');
  const eligibleIds = new Set(universe.eligible.map((c) => c.id));
  const eligibleRows = EDGE_OBSERVATIONS.filter((r) => r.value !== null && eligibleIds.has(r.iso3));
  // A production-like database holds EVERY configured metric, both subjects.
  for (const metricKey of ALL_METRIC_KEYS) {
    repository.upsertIndicator(db, { ...METRICS[metricKey], name: 'x', unit: 'u', source: 'WDI' });
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    repository.upsertObservations(
      db,
      eligibleRows.map((r) => ({
        countryId: r.iso3,
        indicatorId: indicator.id,
        year: r.year,
        value: r.value,
      })),
    );
  }

  const report = await run(db);
  for (const check of ['A.null_value', 'B.aggregate_observation', 'C.unknown_iso3', 'D.duplicate_observation', 'E.invalid_year', 'F.non_finite_value', 'F.raw_round_trip', 'J.metadata_consistency']) {
    assert.equal(statusOf(report, check), 'pass', check);
  }
  assert.equal(report.passed, true);
});

test('partial indicator set fails H loudly instead of silently ranking a subset', async () => {
  // seedEdgeCaseDb ingests exactly one indicator.
  const { db } = await seedEdgeCaseDb();
  const report = await run(db);
  assert.equal(statusOf(report, 'H.registry_indicators'), 'fail');
  assert.match(JSON.stringify(report.checks.find((c) => c.check === 'H.registry_indicators').detail.found), /NY\.GDP\.PCAP\.CD/);
  assert.equal(report.passed, false);
});

test('an unexpected indicator fails H (no series is silently accepted)', async () => {
  const { db, repository } = await seedEdgeCaseDb();
  // Smuggle in a series that is NOT part of the curated registry.
  repository.upsertIndicator(db, {
    key: 'unregistered_series',
    indicatorCode: 'NY.GDP.MKTP.KN',
    label: 'GDP (constant LCU)',
    unit: 'constant LCU',
    group: 'usd',
    priceBasis: 'constant',
  });
  const report = await run(db);
  const check = report.checks.find((c) => c.check === 'H.registry_indicators');
  assert.equal(check.status, 'fail');
  assert.match(JSON.stringify(check.detail.found), /NY\.GDP\.MKTP\.KN/);
  assert.match(JSON.stringify(check.detail.expected), /NY\.GDP\.MKTP\.CD/);
});

test('empty database passes vacuously (nothing ingested yet)', async () => {
  const { db } = await createMemoryTestDb();
  const report = await run(db);
  assert.equal(report.passed, true);
  for (const check of ['G.pagination_provenance', 'H.registry_indicators', 'I.india_observations', 'K.registry_consistency']) {
    assert.equal(statusOf(report, check), 'pass', check);
  }
});

test('B detects an aggregate observation smuggled past the ingest filter', async () => {
  const { db, repository, indicator } = await seedEdgeCaseDb();
  // Bypass the ingest filter on purpose: WLD is stored as an aggregate.
  repository.upsertObservation(db, { countryId: 'WLD', indicatorId: indicator.id, year: 2005, value: 13500.5 });
  const report = await run(db);
  assert.equal(statusOf(report, 'B.aggregate_observation'), 'fail');
  assert.equal(report.passed, false);
});

test('E detects an implausible year', async () => {
  const { db, repository, indicator } = await seedEdgeCaseDb();
  repository.upsertObservation(db, { countryId: 'IND', indicatorId: indicator.id, year: 1700, value: 100 });
  const report = await run(db);
  assert.equal(statusOf(report, 'E.invalid_year'), 'fail');
});

test('I detects a missing India series for an ingested indicator', async () => {
  const { db } = await createMemoryTestDb();
  const repository = await import('../src/db/repository.js');
  const { METRICS } = await import('../src/config.js');
  const { buildUniverse } = await import('../src/domain/universe.js');
  const { EDGE_METADATA, EDGE_BLANK_METADATA } = await import('./fixtures/edgeCases.js');

  const universe = buildUniverse([...EDGE_METADATA, ...EDGE_BLANK_METADATA]);
  repository.upsertCountries(db, universe.countries);
  repository.upsertIndicator(db, { ...METRICS.nominal_current, name: 'x', unit: 'current US$', source: 'WDI' });
  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  // Only USA holds data: India is missing for the only ingested indicator.
  repository.upsertObservation(db, { countryId: 'USA', indicatorId: indicator.id, year: 2005, value: 43000 });

  const report = await run(db);
  assert.equal(statusOf(report, 'I.india_observations'), 'fail');
  assert.deepEqual(
    report.checks.find((c) => c.check === 'I.india_observations').detail.missingIndia,
    ['nominal_current'],
  );
});
