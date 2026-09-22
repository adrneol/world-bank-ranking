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

/**
 * Seed an in-memory database from the VERSIONED World Bank snapshot fixture.
 *
 * Rows pass through the SAME eligibility rule the live ingestion uses
 * (domain/universe.classifyObservation), so a snapshot-seeded database has the
 * same semantics as a production cache: aggregates excluded, blank-ISO3 income
 * groups excluded, null values never stored. Per-year ingest counters and the
 * universe snapshot are recorded too, so services that explain coverage or
 * report vintage can be tested against realistic evidence.
 *
 * @param {{startYear?:number, endYear?:number, metricKeys?:string[]}} [options]
 */
export async function seedSnapshotDb(options = {}) {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse, classifyObservation, createUniverseIndex, OBSERVATION_REJECTIONS } =
    await import('../../src/domain/universe.js');
  const { METRICS, METRIC_KEYS } = await import('../../src/config.js');
  const { snapshot } = await import('../fixtures/snapshot.js');

  const startYear = options.startYear ?? snapshot.yearRange.startYear;
  const endYear = options.endYear ?? snapshot.yearRange.endYear;
  const metricKeys = options.metricKeys ?? METRIC_KEYS;

  const universe = buildUniverse(snapshot.countryMetadata.rows);
  repository.upsertCountries(db, universe.countries);
  const index = createUniverseIndex(universe);

  const runId = repository.startFetchRun(db, {
    trigger: 'test-fixture',
    endpoint: snapshot.apiBaseUrl,
    requestedStartYear: startYear,
    requestedEndYear: endYear,
    fetchedStartYear: startYear,
    fetchedEndYear: endYear,
    indicators: metricKeys.map((key) => METRICS[key].indicatorCode),
  });

  // Reason code -> ingest counter, built from the real constants so a rename
  // in domain/universe.js fails the tests instead of drifting silently.
  const REJECTION_COUNTER = Object.freeze({
    [OBSERVATION_REJECTIONS.MISSING_VALUE]: 'rowsNullSkipped',
    [OBSERVATION_REJECTIONS.NON_FINITE_VALUE]: 'rowsNonFiniteSkipped',
    [OBSERVATION_REJECTIONS.INVALID_YEAR]: 'rowsInvalidYear',
    [OBSERVATION_REJECTIONS.BLANK_ISO3]: 'rowsBlankIso3Skipped',
    [OBSERVATION_REJECTIONS.AGGREGATE_ENTITY]: 'rowsAggregateExcluded',
    [OBSERVATION_REJECTIONS.UNKNOWN_COUNTRY]: 'rowsUnknownCountry',
  });

  const yearStats = [];
  let rowsUpserted = 0;
  for (const metricKey of metricKeys) {
    const entry = snapshot.indicators[metricKey];
    repository.upsertIndicator(db, {
      ...METRICS[metricKey],
      name: entry.indicatorMetadata?.name ?? METRICS[metricKey].label,
      unit: entry.indicatorMetadata?.unit || METRICS[metricKey].unit,
      source: entry.indicatorMetadata?.source ?? 'World Development Indicators',
      sourceNote: entry.indicatorMetadata?.sourceNote ?? null,
    });
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    const perYear = new Map();
    const statsFor = (year) => {
      if (!perYear.has(year)) {
        perYear.set(year, {
          year,
          rowsReceived: 0,
          rowsWithValue: 0,
          rowsWritten: 0,
          rowsNullSkipped: 0,
          rowsNonFiniteSkipped: 0,
          rowsInvalidYear: 0,
          rowsBlankIso3Skipped: 0,
          rowsAggregateExcluded: 0,
          rowsUnknownCountry: 0,
        });
      }
      return perYear.get(year);
    };

    const rows = [];
    for (const raw of entry.rows) {
      const year = Number.parseInt(raw.date, 10);
      if (!Number.isFinite(year) || year < startYear || year > endYear) continue;
      const stats = statsFor(year);
      stats.rowsReceived += 1;
      const value = raw.value === null || raw.value === undefined ? null : Number(raw.value);
      if (value !== null && Number.isFinite(value)) stats.rowsWithValue += 1;
      const verdict = classifyObservation(
        { iso3: raw.countryiso3code, value, year },
        index.eligibleIso3Set,
        { aggregateIso3Set: index.aggregateIso3Set },
      );
      if (!verdict.eligible) {
        const counter = REJECTION_COUNTER[verdict.reason];
        if (counter) stats[counter] += 1;
        continue;
      }
      stats.rowsWritten += 1;
      // Preserve the canonical decimal string like the live ingest does:
      // keep the API lexical form when it round-trips, otherwise the
      // shortest round-trip of the parsed double. Never synthesize from
      // a formatted/display value.
      const lexical =
        typeof raw.value === 'string' ? repository.canonicalDecimalString(raw.value) : null;
      rows.push({
        countryId: verdict.iso3,
        indicatorId: indicator.id,
        year,
        value: verdict.value,
        valueRaw: lexical ?? String(verdict.value),
        wbLastUpdated: entry.lastUpdated,
      });
    }

    rowsUpserted += repository.upsertObservations(db, rows);
    for (const stats of [...perYear.values()].sort((a, b) => a.year - b.year)) {
      yearStats.push({ metricKey, indicatorCode: METRICS[metricKey].indicatorCode, ...stats });
    }
  }

  const sum = (key) => yearStats.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  repository.upsertIngestYearStats(db, runId, yearStats);
  repository.finishFetchRun(db, runId, {
    status: 'success',
    wbLastUpdated: snapshot.worldBankLastUpdated?.[metricKeys[0]] ?? null,
    countriesRows: universe.countries.length,
    rowsRetrieved: sum('rowsReceived'),
    rowsWithValue: sum('rowsWithValue'),
    rowsUpserted,
    rowsNullSkipped: sum('rowsNullSkipped'),
    rowsNonFiniteSkipped: sum('rowsNonFiniteSkipped'),
    rowsInvalidYear: sum('rowsInvalidYear'),
    rowsAggregateExcluded: sum('rowsAggregateExcluded'),
    rowsBlankIso3Skipped: sum('rowsBlankIso3Skipped'),
    rowsUnknownCountry: sum('rowsUnknownCountry'),
    pagesFetched: snapshot.indicators[metricKeys[0]]?.pagesFetched ?? 1,
    requests: snapshot.indicators[metricKeys[0]]?.requests ?? 1,
    universeSnapshot: {
      capturedAt: snapshot.generatedAt,
      wbLastUpdated: snapshot.worldBankLastUpdated?.[metricKeys[0]] ?? null,
      eligibleCount: universe.eligibleCount,
      aggregateCount: universe.aggregateCount,
      eligibleIds: universe.eligible.map((row) => row.id).sort(),
      aggregateIds: universe.aggregates.map((row) => row.id).sort(),
    },
  });

  return {
    db,
    repository,
    snapshot,
    universe,
    metricKeys,
    startYear,
    endYear,
    runId,
    yearStats,
    rowsUpserted,
  };
}

export default { createMemoryTestDb, seedEdgeCaseDb, recordSuccessRun, seedSnapshotDb };