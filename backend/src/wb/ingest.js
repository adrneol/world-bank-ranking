/**
 * INGESTION PIPELINE — FETCH → VALIDATE → ATOMIC PUBLISH.
 *
 * Flow:
 *   World Bank API  ->  STAGED country metadata (memory only)
 *                   ->  eligible universe, validated in memory
 *                   ->  STAGED indicator series (memory only, all requested)
 *                   ->  all-or-nothing validation
 *                   ->  ONE SQLite transaction publishes the complete snapshot
 *
 * The live countries/indicators/observations tables are NEVER written until
 * every requested indicator has been fetched and validated. A partial or
 * failed refresh publishes nothing: the previous dataset stays exactly as it
 * was, and only audit rows (fetch_runs, ingest_year_stats) record the attempt.
 *
 * Key behaviours:
 *   - fetches `startYear - 1` through `endYear`, so the FIRST selected year can
 *     still have a YoY value computed from its predecessor
 *   - applies the universe rule from domain/universe.js to every observation;
 *     aggregate rows and blank-ISO3 rows are never written to the database
 *   - never converts null to 0: null observations are counted and skipped
 *   - records one fetch_runs row per run with full audit metadata, including the
 *     eligible/aggregate universe snapshot and the per-year counters
 *   - guarded by TWO locks so two refreshes cannot overlap: a fast in-memory
 *     flag for the common same-process case, and a SQLite-backed mutex
 *     (refresh_locks row id = 1) that is atomic across processes. Both are
 *     released in a `finally`, so a failure while STARTING a run (for example
 *     a database error inside startFetchRun) can never leave them stuck. A
 *     stale SQLite lock (crash between acquire and release) is recovered
 *     explicitly via recoverRefreshLock(), called on server boot.
 *
 * Audit counters - each name has exactly ONE meaning, no conflated totals:
 *   rowsRetrieved          every row RECEIVED from the API for the series
 *   rowsWithValue          rows that carried a usable number
 *   rowsUpserted           rows written to observations
 *   rowsNullSkipped        rows with a missing value
 *   rowsNonFiniteSkipped   rows whose value was not a finite number
 *   rowsInvalidYear        rows without a usable year
 *   rowsBlankIso3Skipped   rows with a blank ISO3 (income-group aggregates)
 *   rowsAggregateExcluded  rows whose ISO3 is a metadata entity flagged aggregate
 *   rowsUnknownCountry     rows whose ISO3 is absent from the metadata entirely
 */

import { ALL_METRIC_KEYS, METRICS, config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  acquireRefreshLock,
  canonicalDecimalString,
  countObservations,
  deleteObservationsForIndicatorYears,
  finishFetchRun,
  forceReleaseRefreshLock,
  getIndicatorByMetricKey,
  getLastSuccessfulFetchTime,
  getLatestFetchRun,
  refreshLockStatus,
  releaseRefreshLock,
  setRefreshLockRunId,
  startFetchRun,
  transaction,
  upsertCountriesInner,
  upsertIndicator,
  upsertIngestYearStats,
  upsertIngestYearStatsInner,
  upsertObservationsInner,
} from '../db/repository.js';
import {
  buildUniverse,
  classifyObservation,
  createUniverseIndex,
  OBSERVATION_REJECTIONS,
} from '../domain/universe.js';
import {
  fetchCountryMetadata,
  fetchIndicatorMetadata,
  fetchIndicatorSeries,
} from './client.js';

/** Process-level refresh lock. Prevents overlapping ingests in one process. */
let refreshInProgress = false;
/** Last progress snapshot, exposed through /api/data-status. */
let lastProgress = null;

/**
 * Cooldown between automatic refresh attempts after a recorded failure.
 * Manual refreshes (POST /api/data/refresh) always attempt immediately;
 * only automatic triggers back off, so a down World Bank API cannot cause a
 * refresh loop while still allowing recovery on the next window.
 */
export const AUTO_REFRESH_FAIL_COOLDOWN_MS = 15 * 60 * 1000;

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
 * Fetch country metadata into a STAGED payload (no database writes).
 *
 * Staging rule: everything fetched from the World Bank lives in memory until
 * the atomic publish step. A failed refresh therefore cannot leave a
 * half-written mix behind — the previous dataset is never touched first.
 *
 * @returns {{ universe: object, countries: object[], lastUpdated: string|null, requests: number }}
 */
export async function fetchCountryMetadataPayload(options = {}) {
  const result = await fetchCountryMetadata({
    onProgress: options.onProgress,
  });

  const universe = buildUniverse(result.rows);

  if (universe.eligibleCount === 0) {
    throw new Error(
      'Country metadata produced an empty eligible universe; refusing to continue.',
    );
  }

  return {
    universe,
    countries: universe.countries,
    lastUpdated: result.lastUpdated,
    requests: result.requests,
    declaredTotal: result.declaredTotal,
    receivedRows: result.rows.length,
  };
}

/**
 * Fetch one indicator series into a STAGED payload (no database writes).
 *
 * Same classification, counters, and raw-value handling as the historical
 * ingest path; the only difference is destination: staged rows carry the
 * metric key and are resolved to indicator ids inside the publish
 * transaction, after every requested indicator has been validated.
 *
 * @param {string} metricKey
 * @param {number} fetchedStartYear inclusive
 * @param {number} fetchedEndYear inclusive
 * @param {{eligibleIso3Set: Set<string>, aggregateIso3Set: Set<string>}} universeIndex
 *        indexes built by domain/universe.js createUniverseIndex()
 * @param {{onProgress?: Function, onWarn?: Function}} [options]
 */
export async function fetchIndicatorPayload(
  metricKey,
  fetchedStartYear,
  fetchedEndYear,
  universeIndex,
  options = {},
) {
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  const { eligibleIso3Set, aggregateIso3Set = new Set() } = universeIndex ?? {};

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

  const series = await fetchIndicatorSeries(
    metric.indicatorCode,
    fetchedStartYear,
    fetchedEndYear,
    { onProgress: options.onProgress },
  );

  const stagedRows = [];

  // One counter per meaning; the map below is the ONLY place that translates a
  // rejection code from domain/universe.js into an audit counter.
  const counters = {
    rowsRetrieved: series.rows.length, // every row RECEIVED from the API
    rowsWithValue: 0,
    rowsUpserted: 0,
    rowsNullSkipped: 0,
    rowsNonFiniteSkipped: 0,
    rowsInvalidYear: 0,
    rowsBlankIso3Skipped: 0,
    rowsAggregateExcluded: 0,
    rowsUnknownCountry: 0,
  };

  const REJECTION_COUNTER = {
    [OBSERVATION_REJECTIONS.MISSING_VALUE]: 'rowsNullSkipped',
    [OBSERVATION_REJECTIONS.NON_FINITE_VALUE]: 'rowsNonFiniteSkipped',
    [OBSERVATION_REJECTIONS.INVALID_YEAR]: 'rowsInvalidYear',
    [OBSERVATION_REJECTIONS.BLANK_ISO3]: 'rowsBlankIso3Skipped',
    [OBSERVATION_REJECTIONS.AGGREGATE_ENTITY]: 'rowsAggregateExcluded',
    [OBSERVATION_REJECTIONS.UNKNOWN_COUNTRY]: 'rowsUnknownCountry',
  };

  // Per-year split of the same counters. This is what lets the coverage
  // explanation show which years lost rows to the universe rule, as a fact,
  // instead of guessing why a yearly total changed.
  const yearStats = new Map();
  const statsForYear = (year) => {
    const key = Number.isFinite(year) ? year : null;
    if (!yearStats.has(key)) {
      yearStats.set(key, {
        year: key,
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
    return yearStats.get(key);
  };

  for (const raw of series.rows) {
    const year = Number.parseInt(raw?.date, 10);
    const rawValue = raw?.value === null || raw?.value === undefined ? null : Number(raw.value);
    const perYear = statsForYear(year);
    perYear.rowsReceived += 1;

    if (rawValue !== null && Number.isFinite(rawValue) && Number.isFinite(year)) {
      counters.rowsWithValue += 1;
      perYear.rowsWithValue += 1;
    }

    const verdict = classifyObservation(
      { iso3: raw?.countryiso3code, value: rawValue, year },
      eligibleIso3Set,
      { aggregateIso3Set },
    );

    if (!verdict.eligible) {
      const counter = REJECTION_COUNTER[verdict.reason];
      if (counter) {
        counters[counter] += 1;
        perYear[counter] += 1;
      }
      continue;
    }

    perYear.rowsWritten += 1;
    // Preserve the canonical decimal string alongside the numeric value.
    // When the API sent a string decimal that round-trips, keep its lexical
    // form; otherwise store the shortest round-trip of the parsed double.
    const lexical = typeof raw?.value === 'string' ? canonicalDecimalString(raw.value) : null;
    stagedRows.push({
      metricKey,
      countryId: verdict.iso3,
      year,
      value: verdict.value,
      valueRaw: lexical ?? String(verdict.value),
      wbLastUpdated: series.lastUpdated,
    });
  }

  // Staged, not yet written: rowsUpserted here counts rows validated for
  // publication. They reach the observations table only inside the atomic
  // publish transaction, after every requested indicator has succeeded.
  counters.rowsUpserted = stagedRows.length;

  return {
    metricKey,
    indicatorCode: metric.indicatorCode,
    indicatorName: indicatorMeta?.name ?? metric.label,
    indicatorUnit: indicatorMeta?.unit || metric.unit,
    indicatorSource: indicatorMeta?.source?.value ?? 'World Development Indicators',
    indicatorSourceNote: indicatorMeta?.sourceNote ?? null,
    stagedRows,
    ...counters,
    yearStats: [...yearStats.values()].sort((a, b) => (a.year ?? -1) - (b.year ?? -1)),
    lastUpdated: series.lastUpdated,
    requests: series.requests,
    pagesFetched: series.pagesFetched,
    declaredTotal: series.declaredTotal,
    completeness: series.completeness,
  };
}

/**
 * Run a full refresh: metadata first, then every indicator.
 *
 * @param {{ startYear?:number, endYear?:number, trigger?:string, indicators?:string[], db?:object }} options
 */
/**
 * Inspect the cross-process refresh lock without acquiring it.
 * Used by the status endpoint and by boot recovery.
 */
export function getRefreshLockState(db) {
  const handle = db ?? getDb();
  const row = refreshLockStatus(handle);
  return { locked: Boolean(row?.locked), runId: row?.runId ?? null, holder: row?.holder ?? null, updatedAt: row?.updatedAt ?? null };
}

/**
 * Recover a stale SQLite refresh lock left behind by a crashed holder.
 * Releases it and returns the previous state for the audit trail. Never
 * releases the in-memory flag of a live refresh in this process.
 */
export function recoverRefreshLock(db, reason = 'boot recovery') {
  const handle = db ?? getDb();
  return forceReleaseRefreshLock(handle, reason);
}

/**
 * Publish ONE fully staged and validated refresh in a single transaction.
 *
 * This is the ONLY place that mutates the published dataset during a
 * refresh. Everything it writes was already fetched and validated in memory,
 * so a crash during fetching can never leave a half-written mix behind, and
 * a crash during publication is contained by the SQLite transaction.
 *
 * Within the transaction, in order:
 *   1. upsert country metadata (global; same universe the payload used)
 *   2. per refreshed metric: upsert indicator metadata, reconcile that
 *      metric's fetched year range (DELETE old rows, INSERT staged rows so a
 *      newly absent World Bank value removes stale data instead of lingering),
 *      then persist that metric's per-year counters
 *   3. mark the fetch run "success" with the universe snapshot + counters
 *
 * Metrics and year ranges NOT part of this refresh are never touched.
 * fetch_runs rows for failed/partial attempts are audit history and are
 * written outside this transaction (they must survive failures).
 */
function publishStagedRefresh(db, {
  runId,
  stagedCountries,
  stagedMetrics,
  yearStats,
  totals,
  universeSnapshot,
  wbLastUpdated,
  fetchedStartYear,
  fetchedEndYear,
}) {
  transaction(db, () => {
    upsertCountriesInner(db, stagedCountries);
    for (const staged of stagedMetrics) {
      const metric = METRICS[staged.metricKey];
      upsertIndicator(db, {
        ...metric,
        name: staged.indicatorName,
        unit: staged.indicatorUnit,
        source: staged.indicatorSource,
        sourceNote: staged.indicatorSourceNote,
      });
      const indicator = getIndicatorByMetricKey(db, staged.metricKey);
      deleteObservationsForIndicatorYears(db, indicator.id, fetchedStartYear, fetchedEndYear);
      upsertObservationsInner(
        db,
        staged.stagedRows.map((row) => ({ ...row, indicatorId: indicator.id })),
      );
    }
    upsertIngestYearStatsInner(db, runId, yearStats);
    finishFetchRun(db, runId, {
      status: 'success',
      wbLastUpdated,
      universeSnapshot,
      ...totals,
    });
  });
}

export async function refreshData(options = {}) {
  if (refreshInProgress) {
    const error = new Error('A World Bank data refresh is already in progress.');
    error.code = 'REFRESH_IN_PROGRESS';
    throw error;
  }

  const db = options.db ?? getDb();
  const holder = `${options.trigger ?? 'manual'}:pid-${process.pid}`;

  // Cross-process authority: exactly one acquirer wins the atomic UPDATE.
  let dbLockHeld = false;
  try {
    dbLockHeld = acquireRefreshLock(db, { holder });
  } catch {
    dbLockHeld = false;
  }
  if (!dbLockHeld) {
    let lockedBy = null;
    try {
      lockedBy = refreshLockStatus(db);
    } catch {
      lockedBy = null;
    }
    const error = new Error('A World Bank data refresh is already in progress.');
    error.code = 'REFRESH_IN_PROGRESS';
    error.lockedBy = lockedBy;
    throw error;
  }
  const requestedStartYear = options.startYear ?? config.ingestStartYear;
  const requestedEndYear = options.endYear ?? config.ingestEndYear;
  const { fetchedStartYear, fetchedEndYear } = deriveFetchRange(
    requestedStartYear,
    requestedEndYear,
  );
  const metricKeys = options.indicators ?? ALL_METRIC_KEYS;
  const trigger = options.trigger ?? 'manual';

  const totals = {
    countriesRows: 0,
    rowsRetrieved: 0,
    rowsWithValue: 0,
    rowsUpserted: 0,
    rowsNullSkipped: 0,
    rowsNonFiniteSkipped: 0,
    rowsInvalidYear: 0,
    rowsAggregateExcluded: 0,
    rowsBlankIso3Skipped: 0,
    rowsUnknownCountry: 0,
    pagesFetched: 0,
    requests: 0,
  };
  const perIndicator = [];
  const yearStats = [];
  let wbLastUpdated = null;
  let runId = null;
  let universeSnapshot = null;
  let eligibleUniverseSize = 0;
  let aggregateUniverseSize = 0;
  let countriesRows = 0;

  // EVERYTHING that can fail - including creating the fetch_runs row - happens
  // inside this try, so the `finally` below always releases the refresh lock.
  // Regression: the lock used to be acquired before the try and could stay stuck
  // forever when startFetchRun() threw.
  //
  // STAGING INVARIANT: until publishStagedRefresh runs, this function performs
  // ZERO writes to countries/indicators/observations. fetch_runs rows and
  // ingest_year_stats for the attempt are audit history (written outside the
  // publish transaction) and must survive failures. A failed or partial
  // refresh therefore cannot publish a mixed dataset: the previous dataset
  // stays exactly as it was.
  try {
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

    runId = startFetchRun(db, {
      trigger,
      endpoint: config.worldBank.baseUrl,
      requestedStartYear,
      requestedEndYear,
      fetchedStartYear,
      fetchedEndYear,
      indicators: metricKeys.map((k) => METRICS[k].indicatorCode),
    });
    // Associate the held SQLite lock with the real run id (P7). A failure
    // here flows through the generic catch below: the run is marked failed
    // and the lock is released; nothing staged has been published.
    setRefreshLockRunId(db, runId);

    lastProgress = { ...lastProgress, stage: 'country-metadata', runId };
    const meta = await fetchCountryMetadataPayload({
      onProgress: (p) => options.onProgress?.({ stage: 'country-metadata', ...p }),
    });
    countriesRows = meta.countries.length;
    wbLastUpdated = meta.lastUpdated;

    const { eligibleIso3Set, aggregateIso3Set } = createUniverseIndex(meta.universe);
    eligibleUniverseSize = eligibleIso3Set.size;
    aggregateUniverseSize = aggregateIso3Set.size;

    // Snapshot the universe this run ranked against. It is stored on the run so a
    // later run can show the ACTUAL added/removed entities (spec CASE B) instead
    // of speculating about why a historical total changed.
    universeSnapshot = {
      capturedAt: new Date().toISOString(),
      wbLastUpdated: meta.lastUpdated,
      eligibleCount: meta.universe.eligibleCount,
      aggregateCount: meta.universe.aggregateCount,
      eligibleIds: [...eligibleIso3Set].sort(),
      aggregateIds: [...aggregateIso3Set].sort(),
    };

    lastProgress = {
      ...lastProgress,
      stage: 'indicators',
      eligibleUniverse: meta.universe.eligibleCount,
      aggregateUniverse: meta.universe.aggregateCount,
    };

    const stagedMetrics = [];
    for (const metricKey of metricKeys) {
      lastProgress = { ...lastProgress, stage: `indicator:${metricKey}` };

      // A single indicator failing must not discard the others; the failure is
      // recorded and publication is refused unless EVERY requested indicator
      // succeeded (all-or-nothing publish).
      try {
        const result = await fetchIndicatorPayload(
          metricKey,
          fetchedStartYear,
          fetchedEndYear,
          { eligibleIso3Set, aggregateIso3Set },
          {
            onProgress: (p) => options.onProgress?.({ stage: `indicator:${metricKey}`, ...p }),
            onWarn: (w) => options.onWarn?.(w),
          },
        );

        stagedMetrics.push(result);
        perIndicator.push(result);
        totals.rowsRetrieved += result.rowsRetrieved;
        totals.rowsWithValue += result.rowsWithValue;
        totals.rowsUpserted += result.rowsUpserted;
        totals.rowsNullSkipped += result.rowsNullSkipped;
        totals.rowsNonFiniteSkipped += result.rowsNonFiniteSkipped;
        totals.rowsInvalidYear += result.rowsInvalidYear;
        totals.rowsAggregateExcluded += result.rowsAggregateExcluded;
        totals.rowsBlankIso3Skipped += result.rowsBlankIso3Skipped;
        totals.rowsUnknownCountry += result.rowsUnknownCountry;
        totals.pagesFetched += result.pagesFetched;
        totals.requests += result.requests;
        for (const entry of result.yearStats) {
          yearStats.push({
            metricKey,
            indicatorCode: result.indicatorCode,
            ...entry,
          });
        }
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

    const failedMetrics = perIndicator.filter((r) => r.error);
    if (stagedMetrics.length === 0) {
      throw new Error(
        `Every indicator failed during ingestion: ${perIndicator
          .map((r) => `${r.metricKey}: ${r.error}`)
          .join(' | ')}`,
      );
    }

    if (failedMetrics.length > 0) {
      // PARTIAL refresh: publish NOTHING. The previous dataset stays exactly
      // as it was; the attempt is recorded with its per-indicator failures so
      // the audit trail shows what happened. Last-success freshness does not
      // advance (only 'success' runs move it). Per-year counters below describe
      // this attempt only; authoritative coverage reads use successful runs.
      lastProgress = { ...lastProgress, stage: 'partial' };
      const failureSummary =
        `Partial refresh: ${stagedMetrics.length} of ${perIndicator.length} indicators staged; ` +
        `failures: ${failedMetrics.map((r) => `${r.metricKey}: ${r.error}`).join(' | ')}`;
      upsertIngestYearStats(db, runId, yearStats);
      finishFetchRun(db, runId, {
        status: 'partial',
        wbLastUpdated,
        universeSnapshot,
        errorMessage: failureSummary,
        ...totals,
      });
      const summary = {
        status: 'partial',
        runId,
        trigger,
        requestedStartYear,
        requestedEndYear,
        fetchedStartYear,
        fetchedEndYear,
        wbLastUpdated,
        eligibleUniverse: eligibleUniverseSize,
        aggregateUniverse: aggregateUniverseSize,
        universeSnapshot,
        yearStats,
        errorMessage: failureSummary,
        ...totals,
        perIndicator,
      };
      lastProgress = { ...lastProgress, stage: 'complete', summary };
      return summary;
    }

    lastProgress = { ...lastProgress, stage: 'publishing' };
    totals.countriesRows = countriesRows;
    publishStagedRefresh(db, {
      runId,
      stagedCountries: meta.countries,
      stagedMetrics,
      yearStats,
      totals,
      universeSnapshot,
      wbLastUpdated,
      fetchedStartYear,
      fetchedEndYear,
    });

    const summary = {
      status: 'success',
      runId,
      trigger,
      requestedStartYear,
      requestedEndYear,
      fetchedStartYear,
      fetchedEndYear,
      wbLastUpdated,
      eligibleUniverse: eligibleUniverseSize,
      aggregateUniverse: aggregateUniverseSize,
      universeSnapshot,
      yearStats,
      ...totals,
      perIndicator,
    };
    lastProgress = { ...lastProgress, stage: 'complete', summary };
    return summary;
  } catch (error) {
    lastProgress = { ...lastProgress, stage: 'failed', error: error.message };

    // Total failure (zero indicators staged, or metadata/bootstrapping
    // failed, or the publish transaction itself failed): NOTHING from this
    // refresh was ever published to the live tables — staging keeps all
    // writes behind the single publish transaction, which rolls back on
    // error. The previous dataset is therefore intact by construction.
    //
    // error.datasetPreserved states that accurately: no restore of a
    // destroyed dataset took place because the live dataset was never
    // mutated. error.datasetRestored is ALSO set to preserve its historical
    // contract ("previous dataset intact", asserted by ttlRefresh.test.js);
    // under the staged architecture both flags mean the same observable
    // fact, but only datasetPreserved describes the mechanism truthfully.
    error.datasetPreserved = true;
    error.datasetRestored = true;

    if (runId !== null) {
      // Recording the failure must never mask the original error.
      try {
        upsertIngestYearStats(db, runId, yearStats);
      } catch (statsError) {
        options.onWarn?.({ message: `Could not record per-year counters: ${statsError.message}` });
      }
      try {
        finishFetchRun(db, runId, {
          status: 'failed',
          wbLastUpdated,
          universeSnapshot,
          errorMessage: error.message,
          ...totals,
        });
      } catch (recordError) {
        options.onWarn?.({ message: `Could not record the failed run: ${recordError.message}` });
      }
    }

    throw error;
  } finally {
    // ALWAYS released - including when startFetchRun() or the run bookkeeping
    // throws, and including when the caller aborts. Both the in-memory flag
    // and the SQLite mutex are cleared; release failures are swallowed so a
    // lock-release problem can never mask the original ingest error.
    // releaseRefreshLock also clears the run_id association (P7).
    refreshInProgress = false;
    if (dbLockHeld) {
      try {
        releaseRefreshLock(db);
      } catch {
        // Best effort; the stale row is recoverable via recoverRefreshLock().
      }
    }
  }
}

/**
 * Ingest only when the database has no observations yet.
 * Used on boot so a fresh clone becomes usable without a manual step.
 */
export async function ensureDataPresent(db, options = {}) {
  const handle = db ?? getDb();
  const count = handle.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  if (count > 0) return { ingested: false, observations: count };

  // NOTE: db must be forwarded so callers with an explicit handle (tests,
  // embedded use) never ingest into the shared singleton by accident.
  const summary = await refreshData({ db: handle, ...options, trigger: options.trigger ?? 'boot' });
  return { ingested: true, observations: summary.rowsUpserted, summary };
}

/**
 * Automatic refresh trigger for request serving and server boot.
 *
 * Synchronous decision, fire-and-forget execution: when the cache is empty
 * (and empty auto-ingest is enabled) or stale per CACHE_TTL_HOURS (and stale
 * auto-refresh is enabled), and no refresh is already running or locked, a
 * background refreshData() is launched WITHOUT awaiting it, so requests stay
 * fast and keep serving the current valid dataset while the refresh runs.
 *
 * Safety properties:
 *   - fresh cache → never triggers (no refresh on every request);
 *   - running/locked refresh → never starts a second one;
 *   - a failed run stays recorded in fetch_runs, the previous dataset is
 *     untouched (staged fetch publishes nothing on failure — see
 *     refreshData), and automatic retries back off for
 *     AUTO_REFRESH_FAIL_COOLDOWN_MS so a down API cannot loop refreshes.
 *    Manual refreshes are unaffected by the cooldown.
 *
 * @param {object} [db]
 * @param {{ ttlHours?:number, autoStale?:boolean, autoEmpty?:boolean, onWarn?:Function }} [options]
 * @returns {{ triggered:boolean, reason:string }}
 */
export function maybeAutoRefresh(db, options = {}) {
  const handle = db ?? getDb();
  const ttlHours = options.ttlHours ?? config.cacheTtlHours;
  const autoStale = options.autoStale ?? config.autoRefreshOnStale;
  const autoEmpty = options.autoEmpty ?? config.autoIngestOnEmpty;

  let status;
  try {
    status = getCacheStatus(handle, { ttlHours });
  } catch {
    return { triggered: false, reason: 'status-unavailable' };
  }

  if (!status.refreshDue) return { triggered: false, reason: 'fresh' };
  if (status.empty && !autoEmpty) return { triggered: false, reason: 'empty-auto-ingest-disabled' };
  if (!status.empty && !autoStale) return { triggered: false, reason: 'stale-auto-refresh-disabled' };
  if (isRefreshInProgress()) return { triggered: false, reason: 'already-running' };
  try {
    if (refreshLockStatus(handle)?.locked) return { triggered: false, reason: 'already-running' };
  } catch {
    return { triggered: false, reason: 'status-unavailable' };
  }

  // Post-failure cooldown (automatic triggers only): the failed run is already
  // in fetch_runs, so consult it instead of hammering a down API.
  const lastRun = status.lastRun;
  if (lastRun && lastRun.status === 'failed') {
    const startedAt = new Date(lastRun.started_at).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt < AUTO_REFRESH_FAIL_COOLDOWN_MS) {
      return { triggered: false, reason: 'cooldown-after-failure' };
    }
  }

  const trigger = status.empty ? 'boot' : 'ttl';
  refreshData({ db: handle, trigger, onWarn: options.onWarn }).then(
    () => {},
    (error) => {
      // Recorded in fetch_runs by refreshData itself; log without crashing.
      options.onWarn?.({ message: `Automatic ${trigger} refresh failed: ${error.message}` });
    },
  );
  return { triggered: true, reason: status.empty ? 'empty' : 'stale' };
}

/**
 * Persistent-cache status: how old the last successful retrieval is, whether it
 * is still inside the configured freshness window, and whether the database holds
 * any observation at all.
 *
 * The World Bank data is cached in SQLite between runs; this is the single place
 * that decides whether a refresh is due because of the TTL (specification
 * section 34 - refresh system).
 *
 * @param {object} db
 * @param {{ttlHours?:number, now?:number}} [options]
 */
export function getCacheStatus(db, options = {}) {
  const ttlHours = Number(options.ttlHours ?? config.cacheTtlHours);
  const now = options.now ?? Date.now();
  const lastSuccessAt = getLastSuccessfulFetchTime(db);
  const observations = countObservations(db);

  let ageHours = null;
  if (lastSuccessAt) {
    const timestamp = new Date(lastSuccessAt).getTime();
    if (Number.isFinite(timestamp)) ageHours = (now - timestamp) / 3_600_000;
  }

  const fresh =
    observations > 0 &&
    ageHours !== null &&
    Number.isFinite(ttlHours) &&
    ttlHours > 0 &&
    ageHours < ttlHours;

  return {
    empty: observations === 0,
    observations,
    lastSuccessAt,
    ageHours,
    ttlHours: Number.isFinite(ttlHours) ? ttlHours : null,
    fresh,
    refreshDue: !fresh,
    lastRun: getLatestFetchRun(db, { status: null }),
  };
}

export { getLatestFetchRun };
export default refreshData;