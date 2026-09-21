/**
 * DATABASE HELPERS FOR TESTS.
 *
 * Every helper creates an IN-MEMORY database, so a test run can never touch the
 * real SQLite cache in backend/data/.
 *
 * src/ modules are imported dynamically on purpose: a test file must be able to
 * set WORLD_BANK_API_BASE_URL (to the stub server) before the first src import,
 * because the configuration is read once at import time.
 */

import {
  EDGE_BLANK_METADATA,
  EDGE_INDICATOR_CODE,
  EDGE_METADATA,
  EDGE_METRIC_KEY,
  EDGE_OBSERVATIONS,
} from '../fixtures/edgeCases.js';

/** Fresh in-memory database with the schema applied, plus the repository. */
export async function createMemoryTestDb() {
  const { createMemoryDb } = await import('../../src/db/index.js');
  const repository = await import('../../src/db/repository.js');
  return { db: createMemoryDb(), repository };
}

/**
 * Seed the synthetic edge-case dataset through the repository layer.
 *
 * Two kinds of row cannot be stored at all and are reported back so a test can
 * assert the invariant instead of the seeding silently dropping them:
 *   - a value of null: observations.value is NOT NULL, so missing data can never
 *     be stored as zero
 *   - an ISO3 that is absent from countries: the foreign key rejects it
 *
 * Aggregates ARE stored here (WLD, HIC) because this helper bypasses the ingest
 * filter on purpose: that is what proves the services exclude aggregates at the
 * query level as well.
 */
export async function seedEdgeCaseDb() {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse } = await import('../../src/domain/universe.js');
  const { METRICS } = await import('../../src/config.js');

  const universe = buildUniverse([...EDGE_METADATA, ...EDGE_BLANK_METADATA]);
  repository.upsertCountries(db, universe.countries);

  repository.upsertIndicator(db, {
    ...METRICS[EDGE_METRIC_KEY],
    name: 'GDP per capita (current US$)',
    unit: 'current US$',
    source: 'World Development Indicators',
  });
  const indicator = repository.getIndicatorByMetricKey(db, EDGE_METRIC_KEY);

  const storableIds = new Set(universe.countries.map((row) => row.id));
  const storable = [];
  const nullValueObservations = [];
  const unstorableObservations = [];
  for (const row of EDGE_OBSERVATIONS) {
    if (row.value === null || row.value === undefined) {
      nullValueObservations.push(row);
      continue;
    }
    if (!row.iso3 || !storableIds.has(row.iso3)) {
      unstorableObservations.push(row);
      continue;
    }
    storable.push({
      countryId: row.iso3,
      indicatorId: indicator.id,
      year: row.year,
      value: row.value,
    });
  }
  repository.upsertObservations(db, storable);

  return {
    db,
    repository,
    universe,
    indicator,
    seededObservations: storable.length,
    nullValueObservations,
    unstorableObservations,
    indicatorCode: EDGE_INDICATOR_CODE,
  };
}

/** Record a successful run (with a universe snapshot) for the seeded database. */
export async function recordSuccessRun(db, repository, extras = {}) {
  const runId = repository.startFetchRun(db, {
    trigger: extras.trigger ?? 'test',
    endpoint: extras.endpoint ?? 'stub://world-bank',
    requestedStartYear: extras.requestedStartYear ?? 2003,
    requestedEndYear: extras.requestedEndYear ?? 2005,
    fetchedStartYear: extras.fetchedStartYear ?? 2002,
    fetchedEndYear: extras.fetchedEndYear ?? 2005,
    indicators: extras.indicators ?? [EDGE_INDICATOR_CODE],
  });
  repository.finishFetchRun(db, runId, {
    status: 'success',
    wbLastUpdated: extras.wbLastUpdated ?? '2026-07-13',
    countriesRows: extras.countriesRows ?? 0,
    universeSnapshot: extras.universeSnapshot ?? null,
    ...(extras.counters ?? {}),
  });
  return runId;
}

export default { createMemoryTestDb, seedEdgeCaseDb, recordSuccessRun };