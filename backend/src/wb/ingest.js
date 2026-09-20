/**
 * INGESTION PIPELINE.
 *
 * Flow:
 *   World Bank API  ->  country metadata  ->  eligible universe (aggregates removed)
 *                   ->  indicator series  ->  observation filter  ->  SQLite
 *
 * Key behaviours:
 *   - fetches `startYear - 1` through `endYear`, so the FIRST selected year can
 *     still have a YoY value computed from its predecessor
 *   - applies the universe rule from domain/universe.js to every observation;
 *     aggregate rows and blank-ISO3 rows are never written to the database
 *   - never converts null to 0: null observations are counted and skipped
 *   - records one fetch_runs row per run with full audit metadata
 *   - guarded by a process-level lock so two refreshes cannot overlap
 */

import { METRICS, METRIC_KEYS, config } from '../config.js';
import { getDb, transaction } from '../db/index.js';
import {
  finishFetchRun,
  getLatestFetchRun,
  startFetchRun,
  upsertCountries,
  upsertIndicator,
  upsertObservations,
} from '../db/repository.js';
import { buildUniverse, classifyObservation, normalizeIso3 } from '../domain/universe.js';
import {
  fetchCountryMetadata,
  fetchIndicatorMetadata,
  fetchIndicatorSeries,
} from './client.js';

/** Process-level refresh lock. Prevents overlapping ingests in one process. */
let refreshInProgress = false;
/** Last progress snapshot, exposed through /api/data-status. */
let lastProgress = null;

export function isRefreshInProgress() {
  return refreshInProgress;
}

export function getIngestProgress() {
  return lastProgress;
}

/**
 * Derive the ingestion year range.
 * Always reaches back one extra year when possible so YoY is available for the
 * first selected year.
 *
 * @param {number} startYear
 * @param {number} endYear
 */
export function deriveFetchRange(startYear, endYear) {
  return { fetchedStartYear: startYear - 1, fetchedEndYear: endYear };
}

/**
 * Fetch and store country metadata.
 *
 * @returns {{ universe: object, rowsUpserted: number, lastUpdated: string|null, requests: number }}
 */
export async function ingestCountryMetadata(db, options = {}) {
  const result = await fetchCountryMetadata({
    onProgress: options.onProgress,
  });

  const universe = buildUniverse(result.rows);

  if (universe.eligibleCount === 0) {
    throw new Error(
      'Country metadata produced an empty eligible universe; refusing to continue.',
    );
  }

  const rowsUpserted = upsertCountries(db, universe.countries);

  return {
    universe,
    rowsUpserted,
    lastUpdated: result.lastUpdated,
    requests: result.requests,
    declaredTotal: result.declaredTotal,
    receivedRows: result.rows.length,
  };
}

/**
 * Fetch and store one indicator series.
 *
 * @param {object} db
 * @param {string} metricKey
 * @param {number} fetchedStartYear inclusive
 * @param {number} fetchedEndYear inclusive
 * @param {Set<string>} eligibleIso3Set
 */
export async function ingestIndicator(
  db,
  metricKey,
  fetchedStartYear,
  fetchedEndYear,
  eligibleIso3Set,
  options = {},
) {
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  // Indicator metadata (name/unit) is helpful for the audit panel; a failure
  // here must not abort the numeric ingest.
  let indicatorMeta = null;
  try {
    indicatorMeta = await fetchIndicatorMetadata(metric.indicatorCode);
  } catch (error) {
    options.onWarn?.({
      message: `Indicator metadata unavailable for ${metric.indicatorCode}: ${error.message}`,
    });
  }

  upsertIndicator(db, {
    ...metric,
    name: indicatorMeta?.name ?? metric.label,
    unit: indicatorMeta?.unit || metric.unit,
    source: indicatorMeta?.source?.value ?? 'World Development Indicators',
    sourceNote: indicatorMeta?.sourceNote ?? null,
  });

  const series = await fetchIndicatorSeries(
    metric.indicatorCode,
    fetchedStartYear,
    fetchedEndYear,
    { onProgress: options.onProgress },
  );

  const indicatorRow = db
    .prepare('SELECT id FROM indicators WHERE metric_key = ?')
    .get(metricKey);
  const indicatorId = indicatorRow.id;

  const toWrite = [];
  let rowsRetrieved = 0;
  let rowsNullSkipped = 0;
  let rowsBlankIso3Skipped = 0;
  let rowsAggregateExcluded = 0;
  let rowsUnknownCountry = 0;
  let rowsInvalidYear = 0;

  for (const raw of series.rows) {
    const iso3 = normalizeIso3(raw?.countryiso3code);

    if (raw?.value === null || raw?.value === undefined) {
      rowsNullSkipped += 1;
      continue;
    }

    const year = Number.parseInt(raw?.date, 10);
    if (!Number.isFinite(year)) {
      rowsInvalidYear += 1;
      continue;
    }

    if (!iso3) {
      // Income-group aggregates arrive with an empty ISO3 and real numbers.
      rowsBlankIso3Skipped += 1;
      continue;
    }

    const value = Number(raw.value);
    const verdict = classifyObservation({ iso3, value }, eligibleIso3Set);

    if (!verdict.eligible) {
      if (verdict.reason === 'not in eligible country universe') {
        // Present in metadata but flagged as an aggregate, OR absent entirely.
        rowsAggregateExcluded += 1;
      } else {
        rowsUnknownCountry += 1;
      }
      continue;
    }

    rowsRetrieved += 1;
    toWrite.push({
      countryId: iso3,
      indicatorId,
      year,
      value,
      wbLastUpdated: series.lastUpdated,
    });
  }

  const rowsUpserted = upsertObservations(db, toWrite);

  return {
    metricKey,
    indicatorCode: metric.indicatorCode,
    rowsRetrieved,
    rowsUpserted,
    rowsNullSkipped,
    rowsBlankIso3Skipped,
    rowsAggregateExcluded,
    rowsUnknownCountry,
    rowsInvalidYear,
    lastUpdated: series.lastUpdated,
    requests: series.requests,
    pagesFetched: series.pagesFetched,
  };
}

/**
 * Run a full refresh: metadata first, then every indicator.
 *
 * @param {{ startYear?:number, endYear?:number, trigger?:string, indicators?:string[], db?:object }} options
 */
export async function refreshData(options = {}) {
  if (refreshInProgress) {
    const error = new Error('A World Bank data refresh is already in progress.');
    error.code = 'REFRESH_IN_PROGRESS';
    throw error;
  }

  const db = options.db ?? getDb();
  const requestedStartYear = options.startYear ?? config.defaultStartYear;
  const requestedEndYear = options.endYear ?? config.defaultEndYear;
  const { fetchedStartYear, fetchedEndYear } = deriveFetchRange(
    requestedStartYear,
    requestedEndYear,
  );
  const metricKeys = options.indicators ?? METRIC_KEYS;
  const trigger = options.trigger ?? 'manual';

  refreshInProgress = true;
  lastProgress = {
    stage: 'starting',
    startedAt: new Date().toISOString(),
    trigger,
    requestedStartYear,
    requestedEndYear,
    fetchedStartYear,
    fetchedEndYear,
  };

  const runId = startFetchRun(db, {
    trigger,
    endpoint: config.worldBank.baseUrl,
    requestedStartYear,
    requestedEndYear,
    fetchedStartYear,
    fetchedEndYear,
    indicators: metricKeys.map((k) => METRICS[k].indicatorCode),
  });

  const totals = {
    countriesRows: 0,
    rowsRetrieved: 0,
    rowsUpserted: 0,
    rowsNullSkipped: 0,
    rowsAggregateExcluded: 0,
    rowsBlankIso3Skipped: 0,
    rowsUnknownCountry: 0,
  };
  let wbLastUpdated = null;
  const perIndicator = [];

  try {
    lastProgress = { ...lastProgress, stage: 'country-metadata' };
    const meta = await ingestCountryMetadata(db, {
      onProgress: (p) =>
        options.onProgress?.({ stage: 'country-metadata', ...p }),
    });
    totals.countriesRows = meta.rowsUpserted;
    wbLastUpdated = meta.lastUpdated;

    const eligibleIso3Set = new Set(meta.universe.eligible.map((c) => c.id));

    lastProgress = {
      ...lastProgress,
      stage: 'indicators',
      eligibleUniverse: meta.universe.eligibleCount,
      aggregateUniverse: meta.universe.aggregateCount,
    };

    for (const metricKey of metricKeys) {
      lastProgress = { ...lastProgress, stage: `indicator:${metricKey}` };

      // A single indicator failing must not discard the others; the failure is
      // recorded on the run and re-thrown only if every indicator failed.
      try {
        const result = await ingestIndicator(
          db,
          metricKey,
          fetchedStartYear,
          fetchedEndYear,
          eligibleIso3Set,
          {
            onProgress: (p) => options.onProgress?.({ stage: `indicator:${metricKey}`, ...p }),
            onWarn: (w) => options.onWarn?.(w),
          },
        );

        perIndicator.push(result);
        totals.rowsRetrieved += result.rowsRetrieved;
        totals.rowsUpserted += result.rowsUpserted;
        totals.rowsNullSkipped += result.rowsNullSkipped;
        totals.rowsAggregateExcluded += result.rowsAggregateExcluded;
        totals.rowsBlankIso3Skipped += result.rowsBlankIso3Skipped;
        totals.rowsUnknownCountry += result.rowsUnknownCountry;
        if (result.lastUpdated) wbLastUpdated = result.lastUpdated;
      } catch (indicatorError) {
        perIndicator.push({
          metricKey,
          indicatorCode: METRICS[metricKey].indicatorCode,
          error: indicatorError.message,
        });
        options.onWarn?.({
          message: `Indicator ${metricKey} failed: ${indicatorError.message}`,
        });
      }
    }

    const succeeded = perIndicator.filter((r) => !r.error);
    if (succeeded.length === 0) {
      throw new Error(
        `Every indicator failed during ingestion: ${perIndicator
          .map((r) => `${r.metricKey}: ${r.error}`)
          .join(' | ')}`,
      );
    }

    lastProgress = { ...lastProgress, stage: 'finalising' };
    finishFetchRun(db, runId, { status: 'success', wbLastUpdated, ...totals });

    const summary = {
      status: 'success',
      runId,
      trigger,
      requestedStartYear,
      requestedEndYear,
      fetchedStartYear,
      fetchedEndYear,
      wbLastUpdated,
      eligibleUniverse: eligibleIso3Set.size,
      ...totals,
      perIndicator,
    };
    lastProgress = { ...lastProgress, stage: 'complete', summary };
    return summary;
  } catch (error) {
    finishFetchRun(db, runId, {
      status: 'failed',
      wbLastUpdated,
      errorMessage: error.message,
      ...totals,
    });
    lastProgress = { ...lastProgress, stage: 'failed', error: error.message };
    throw error;
  } finally {
    refreshInProgress = false;
  }
}

/**
 * Ingest only when the database has no observations yet.
 * Used on boot so a fresh clone becomes usable without a manual step.
 */
export async function ensureDataPresent(db, options = {}) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  if (count > 0) return { ingested: false, observations: count };

  const summary = await refreshData({ ...options, trigger: options.trigger ?? 'boot' });
  return { ingested: true, observations: summary.rowsUpserted, summary };
}

export { getLatestFetchRun };
export default refreshData;