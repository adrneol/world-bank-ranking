/**
 * INGESTION PIPELINE — FETCH → VALIDATE → ATOMIC PUBLISH.
 *
 * Flow (Phase 8O):
 *   World Bank API  ->  STAGED country metadata (memory only, tiny)
 *                   ->  eligible universe, validated in memory
 *                   ->  PER INDICATOR, with NO transaction open:
 *                        fetch series -> validate -> O10 compare ->
 *                        unchanged: release rows immediately
 *                        changed: spill staged rows to a temp staging file,
 *                                 release rows immediately
 *                   ->  SHORT publish transaction (DB writes only, no network):
 *                        replay each spilled indicator -> COMMIT once
 *
 * Peak memory is one indicator, not all twenty (changed payloads rest on
 * local disk, never in JS heaps together). A failure anywhere publishes
 * nothing: acquisition writes nothing to live tables at all, and the short
 * publish transaction rolls back as one unit. Failed/partial attempts are
 * recorded as audit history outside the transaction, exactly as before. The
 * previous dataset stays exactly as it was, and only audit rows
 * (fetch_runs, ingest_year_stats) record the attempt.
 *
 * Why the split (Phase 8O root cause): the pre-8O pipeline held ONE
 * Turso/Hrana interactive transaction open across all twenty World Bank
 * fetches (tens of seconds of network idle between DB statements). Turso
 * invalidates such long-idle server-side statement/transaction state
 * (`stored sql reference is invalid`, `TRANSACTION_CLOSED`) while local
 * SQLite tolerates it. The publish transaction below therefore performs
 * zero network I/O: it opens, writes, and commits in one short DB-only
 * sequence. See the Phase 8O report for the full proof.
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

import { METRICS, PRODUCTION_METRIC_KEYS, config, isProductionMetric } from '../config.js';
import { getDb } from '../db/index.js';
import { batchGet, isTransportError } from '../db/driver.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Local sleep (driver keeps its own private copy for read retries). */
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Inline transport-retry delays between refresh attempts (Phase 8D, bounded
 * by Phase 8E audit below).
 * Override in tests with WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS="10,20";
 * "off"/"none"/"disabled" disables inline retries (explicit ladder only).
 *
 * BOUNDED RETRY HIERARCHY (Phase 8E, exact maximums):
 *   1. World Bank HTTP per request: WB_MAX_RETRIES (default 5) inside
 *      wb/client.js getWithRetry — per-request only, never a full refresh.
 *   2. Turso/libSQL idempotent SELECT: exactly 1 retry in driver.js
 *      withReadRetry (queryAll/queryGet only; writes/transactions never).
 *   3. Refresh-level transport retry (this file): at most
 *      refreshTransportRetryDelays().length inline retries, i.e. at most
 *      delays.length + 1 complete refresh attempts per refreshData() call
 *      (default 2 delays → max 3 attempts). Each attempt is a full fresh
 *      refresh from the beginning (O10 re-evaluated, new O7 transaction);
 *      a broken transaction object is NEVER resumed or continued.
 *   4. Background TTL retry ladder: REFRESH_RETRY_DELAYS_MS rungs
 *      (default 4: 5m/15m/30m/60m), single-flight, in-process, automatic
 *      triggers only — fires once per failed refreshData() call, so there is
 *      NO multiplication: worst case per TTL trigger = (delays8D + 1) ×
 *      (ladder rungs until success, capped by process lifetime/boot check).
 *      Manual/script callers never schedule the ladder.
 *
 * CLIENT REUSE (Phase 8E): @libsql/client Turso handles are stateless
 * HTTPS clients; a transport failure fails the in-flight statement/transaction
 * (which is rolled back and discarded by driver.js transaction()), never the
 * shared handle. The shared handle from getDb() is therefore reused across
 * inline attempts WITHOUT close/reconnect — closeDb() is never called here
 * so active Express status/analysis reads are unaffected. A fresh transaction
 * object is created per attempt by transaction().
 */
export const REFRESH_TRANSPORT_RETRY_DELAYS_MS = Object.freeze([5000, 15000]);
export function refreshTransportRetryDelays() {
  const raw = process.env.WB_REFRESH_TRANSPORT_RETRY_DELAYS_MS;
  if (raw === undefined || raw === null) return [...REFRESH_TRANSPORT_RETRY_DELAYS_MS];
  const text = String(raw).trim().toLowerCase();
  if (text === '' ) return [...REFRESH_TRANSPORT_RETRY_DELAYS_MS];
  if (text === 'off' || text === 'none' || text === 'disabled') return [];
  const parsed = String(raw)
    .split(',')
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : [...REFRESH_TRANSPORT_RETRY_DELAYS_MS];
}
import {
  acquireRefreshLock,
  canonicalDecimalString,
  computeDatasetState,
  countObservations,
  deleteObservationsForIndicatorYears,
  finishFetchRun,
  forceReleaseRefreshLock,
  getDatasetState,
  getIndicatorByMetricKey,
  getLatestFetchRun,
  getObservationsForCompare,
  listCountries,
  refreshLockStatus,
  releaseRefreshLock,
  setRefreshLockRunId,
  startFetchRun,
  transaction,
  upsertCountriesInner,
  upsertDatasetStateInner,
  upsertIndicatorInner,
  upsertIngestYearStats,
  upsertIngestYearStatsInner,
  upsertObservationsInner,
} from '../db/repository.js';
import {
  buildUniverse,
  classifyObservation,
  createUniverseIndex,
  normalizeIso3,
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

/** Shared tombstone for released staged-row arrays (Phase 6C O2). */
const EMPTY_RELEASED_ROWS = Object.freeze([]);

/**
 * Cooldown between automatic refresh attempts after a recorded failure.
 * Manual refreshes (POST /api/data/refresh) always attempt immediately;
 * only automatic triggers back off, so a down World Bank API cannot cause a
 * refresh loop while still allowing recovery on the next window.
 */
export const AUTO_REFRESH_FAIL_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Conservative retry schedule for FAILED automatic refreshes (Phase 6C,
 * Part 7). Delays grow 5m → 15m → 30m → 60m and stay at 60m afterwards.
 * Override in tests with WB_REFRESH_RETRY_DELAYS_MS="100,200" (comma-separated ms).
 *
 * Semantics (separate from the 24h TTL):
 *   TTL   decides when a refresh/check becomes DUE (getCacheStatus).
 *   Retry decides when a FAILED automatic attempt gets another opportunity.
 * A retry fires only through maybeAutoRefresh(), so all single-flight guards
 * (fresh cache, in-process flag, SQLite lock) still apply: a retry can never
 * overlap another refresh, and if the cache became fresh meanwhile the retry
 * is a no-op. lastSuccessAt advances only on fully successful runs.
 *
 * Durability: IN-PROCESS ONLY. A Render restart drops the timer; recovery
 * then comes from the boot stale-check (maybeAutoRefresh on stale cache),
 * never from a duplicated loop — at most one timer exists per process
 * (scheduleRefreshRetry is a no-op while one is pending).
 */
export const REFRESH_RETRY_DELAYS_MS = Object.freeze([5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000]);
let refreshRetryTimer = null;
let consecutiveAutoFailures = 0;

/** Parse the retry schedule: env override (tests) or the default ladder. */
export function refreshRetryDelays() {
  const raw = process.env.WB_REFRESH_RETRY_DELAYS_MS;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const parsed = String(raw)
      .split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (parsed.length > 0) return parsed;
  }
  return [...REFRESH_RETRY_DELAYS_MS];
}

/** Delay before the Nth consecutive-failure retry (0-based; capped at the last rung). */
export function getRefreshRetryDelayMs(failureIndex) {
  const ladder = refreshRetryDelays();
  const i = Math.max(0, Math.min(Number(failureIndex) || 0, ladder.length - 1));
  return ladder[i];
}

/** Observable retry state (for /api/data-status futures and tests). */
export function getRefreshRetryState() {
  return {
    scheduled: refreshRetryTimer !== null,
    consecutiveFailures: consecutiveAutoFailures,
    nextDelayMs: refreshRetryTimer !== null ? getRefreshRetryDelayMs(consecutiveAutoFailures) : null,
  };
}

/** Cancel a pending retry, if any. Idempotent. */
export function cancelScheduledRefreshRetry() {
  if (refreshRetryTimer !== null) {
    clearTimeout(refreshRetryTimer);
    refreshRetryTimer = null;
  }
}

/**
 * Reset the consecutive-failure count (called on every successful refresh)
 * and drop any pending retry: fresh data needs no retry.
 */
export function noteRefreshSuccess() {
  consecutiveAutoFailures = 0;
  cancelScheduledRefreshRetry();
}

/**
 * Schedule one background retry of a failed AUTOMATIC refresh. Single-flight:
 * at most one timer per process; overlapping fires re-enter through
 * maybeAutoRefresh() guards. Manual/script callers never schedule (their
 * caller owns retrying); tests can force tiny delays via
 * WB_REFRESH_RETRY_DELAYS_MS.
 *
 * @returns the retry state after scheduling (or the existing pending state).
 */
export function scheduleRefreshRetry(db, { trigger = 'ttl', onWarn = null } = {}) {
  // Test kill-switch (teardown only): never set in production.
  if (process.env.WB_REFRESH_RETRY_DISABLED === '1') return getRefreshRetryState();
  if (refreshRetryTimer !== null) return getRefreshRetryState();
  const delay = getRefreshRetryDelayMs(consecutiveAutoFailures);
  consecutiveAutoFailures += 1;
  refreshRetryTimer = setTimeout(() => {
    refreshRetryTimer = null;
    maybeAutoRefresh(db, { onWarn, ignoreCooldown: true }).then(
      () => {},
      (error) => {
        onWarn?.({ message: `Scheduled refresh retry failed to launch: ${error.message}` });
      },
    );
  }, delay);
  if (typeof refreshRetryTimer.unref === 'function') refreshRetryTimer.unref();
  return getRefreshRetryState();
}

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
    rowsAggregateStored: 0,
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
          rowsAggregateStored: 0,
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
      // Official aggregate observations are STORED (Phase 5), typed by
      // countries.is_aggregate and never ranked. The AGGREGATE_ENTITY verdict
      // already guarantees a finite value, a valid year and membership in the
      // aggregate set (rejection precedence), so the row is staged identically
      // to a country observation and flows through the same atomic publish.
      if (verdict.reason === OBSERVATION_REJECTIONS.AGGREGATE_ENTITY) {
        const aggregateIso3 = normalizeIso3(raw?.countryiso3code);
        if (aggregateIso3 && aggregateIso3Set?.has(aggregateIso3)) {
          counters.rowsAggregateStored += 1;
          perYear.rowsAggregateStored += 1;
          perYear.rowsWritten += 1;
          const aggregateLexical = typeof raw?.value === 'string' ? canonicalDecimalString(raw.value) : null;
          stagedRows.push({
            metricKey,
            countryId: aggregateIso3,
            year,
            value: rawValue,
            valueRaw: aggregateLexical ?? String(rawValue),
            wbLastUpdated: series.lastUpdated,
          });
          continue;
        }
      }
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
export async function getRefreshLockState(db) {
  const handle = db ?? getDb();
  const row = await refreshLockStatus(handle);
  return { locked: Boolean(row?.locked), runId: row?.runId ?? null, holder: row?.holder ?? null, updatedAt: row?.updatedAt ?? null };
}

/**
 * Recover a stale SQLite refresh lock left behind by a crashed holder.
 * Releases it and returns the previous state for the audit trail. Never
 * releases the in-memory flag of a live refresh in this process.
 */
export async function recoverRefreshLock(db, reason = 'boot recovery') {
  const handle = db ?? getDb();
  return await forceReleaseRefreshLock(handle, reason);
}

/**
 * Phase 6C O10: exact unchanged-indicator proof.
 *
 * Compares the freshly fetched+validated staged rows against what is already
 * stored for the same indicator and year range. Returns true ONLY when the
 * two sets are element-identical: same row count, same (country, year)
 * identities, same numeric value AND same value_raw string on every row.
 *
 * False-positive direction is safe by construction: ANY doubt (count
 * mismatch, missing row, extra row, changed value, changed raw string,
 * non-string raw forms) returns false, i.e. "cannot prove unchanged" means
 * PROCESS THE INDICATOR. Only an exact match skips the delete+upsert writes.
 *
 * What this evidence proves: the World Bank payload for this indicator and
 * range, after the canonical classification/normalization in
 * fetchIndicatorPayload, is byte-identical to the stored dataset — so
 * rewriting it would be a no-op (same rows, same values; a delete+reinsert
 * of identical rows included). It does NOT rely on the `lastupdated`
 * metadata string, which alone can never prove content equality.
 *
 * @param {{countryId:string, year:number, value:number, valueRaw:string|null}[]} stored
 * @param {{countryId:string, year:number, value:number, valueRaw:string|null}[]} staged
 */
export function isIndicatorPayloadUnchanged(stored, staged) {
  if (!Array.isArray(stored) || !Array.isArray(staged)) return false;
  if (stored.length !== staged.length) return false;
  const byKey = new Map();
  for (const row of stored) {
    const key = `${row.countryId}\n${row.year}`;
    if (byKey.has(key)) return false; // stored duplicates: cannot prove; process.
    byKey.set(key, row);
  }
  for (const row of staged) {
    const key = `${row.countryId}\n${row.year}`;
    const match = byKey.get(key);
    if (!match) return false;
    if (!Object.is(match.value, row.value) && match.value !== row.value) return false;
    if ((match.valueRaw ?? null) !== (row.valueRaw ?? null)) return false;
    byKey.delete(key);
  }
  return byKey.size === 0;
}

/**
 * Phase 7D-2: exact country-metadata unchanged proof.
 *
 * Compares staged country rows against stored rows with the EXACT
 * normalization the publish builder (upsertCountriesInner) applies, so a
 * skip means the upsert would rewrite identical values. `updated_at` is
 * excluded: it is write-time bookkeeping, not source data (comparing it
 * would force a rewrite every refresh).
 *
 * False-positive direction is safe by construction: ANY doubt (missing
 * row, extra staged row, changed source field, non-array input) returns
 * false, i.e. "cannot prove unchanged" means WRITE. Extra stored rows
 * (entities the source no longer lists) are left untouched by both paths —
 * the upsert never deletes — so they never force a write.
 */
export function isCountriesPayloadUnchanged(stored, staged) {
  if (!Array.isArray(stored) || !Array.isArray(staged)) return false;
  const norm = (row, fallbackIso) => [
    row.id,
    row.iso2 ?? null,
    row.iso3 ?? fallbackIso ?? row.id ?? null,
    row.name ?? null,
    row.region ?? null,
    row.regionId ?? row.region_id ?? null,
    row.adminRegion ?? row.admin_region ?? null,
    row.incomeLevel ?? row.income_level ?? null,
    row.lendingType ?? row.lending_type ?? null,
    row.capitalCity ?? row.capital_city ?? null,
    row.isAggregate !== undefined ? (row.isAggregate ? 1 : 0) : (row.is_aggregate ?? 0),
    row.aggregateReason ?? row.aggregate_reason ?? null,
  ];
  const byId = new Map();
  for (const row of stored) {
    if (row == null || row.id == null) return false;
    if (byId.has(row.id)) return false; // stored duplicates: process.
    byId.set(row.id, norm(row));
  }
  for (const row of staged) {
    if (row == null || row.id == null) return false;
    const match = byId.get(row.id);
    if (!match) return false;
    const stagedNorm = norm(row, row.iso3 ?? row.id);
    if (stagedNorm.length !== match.length) return false;
    for (let i = 0; i < stagedNorm.length; i += 1) {
      if (!Object.is(match[i], stagedNorm[i]) && match[i] !== stagedNorm[i]) return false;
    }
    byId.delete(row.id);
  }
  return true;
}
/**
 * Phase 8O — temp-file staging for changed indicator payloads.
 *
 * The acquisition loop (no transaction open) spills each CHANGED indicator's
 * staged rows to one JSONL file and immediately releases the in-memory rows,
 * so peak memory stays at one indicator even when many indicators changed.
 * Unchanged indicators never touch disk (their rows are released outright).
 * The short publish transaction replays the files one indicator at a time.
 *
 * Zero Turso cost: these files live on local ephemeral disk (os.tmpdir),
 * never in the production database. JSON numbers round-trip finite doubles
 * exactly, and value_raw strings pass through verbatim, so replayed rows
 * are element-identical to the validated staged rows (the O10 proof itself
 * always runs on the in-memory rows before any spill).
 */
function sanitizeStagingName(metricKey) {
  return String(metricKey ?? 'indicator').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Create a unique per-attempt staging directory. Throws on failure. */
async function createStagingDir(runId) {
  const prefix = `wb-refresh-staging-p${process.pid}-r${runId ?? 'norun'}-`;
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Spill one indicator's staged rows to `<dir>/<metricKey>.jsonl`. Returns the file path. */
async function spillStagedRows(dir, metricKey, rows) {
  const file = path.join(dir, `${sanitizeStagingName(metricKey)}.jsonl`);
  const lines = rows.map((row) =>
    JSON.stringify({
      countryId: row.countryId,
      year: row.year,
      value: row.value,
      valueRaw: row.valueRaw ?? null,
      wbLastUpdated: row.wbLastUpdated ?? null,
    }),
  );
  await fs.promises.writeFile(file, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  return file;
}

/** Replay one spilled file back into staged-row objects (one indicator at a time). */
async function readSpilledRows(file) {
  const text = await fs.promises.readFile(file, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = JSON.parse(line);
    rows.push({
      countryId: parsed.countryId,
      year: parsed.year,
      value: parsed.value,
      valueRaw: parsed.valueRaw ?? null,
      wbLastUpdated: parsed.wbLastUpdated ?? null,
    });
  }
  return rows;
}

/** Best-effort staging cleanup (never throws; the OS reclaims tmp eventually). */
async function cleanupStagingDir(dir) {
  if (!dir) return;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

/**
 * Phase 8B: append one per-indicator execution record to the in-memory
 * progress ledger (no database writes, bounded to one entry per requested
 * metric key). Statuses: 'published' (rows rewritten), 'unchanged' (O10
 * proved identical, zero writes), 'failed' (fetch error, with message).
 * Execution progress, NOT publication state: entries recorded before a
 * rollback describe work that was rolled back.
 */
function recordStep(metricKey, status, extra = {}) {
  if (!Array.isArray(lastProgress.steps)) lastProgress.steps = [];
  const entry = {
    metricKey,
    label: METRICS[metricKey]?.label ?? metricKey,
    status,
    at: new Date().toISOString(),
    ...extra,
  };
  const index = lastProgress.steps.findIndex((s) => s.metricKey === metricKey);
  if (index >= 0) lastProgress.steps[index] = entry;
  else lastProgress.steps.push(entry);
}

/**
 * Phase 8E: build the ONE terminal persisted indicator summary for a refresh.
 * Snapshot of the in-memory ledger at completion: every requested metric key,
 * display labels, per-indicator terminal status (published = updated,
 * unchanged = up to date, failed + error), rows where known, plus counts and
 * the completion timestamp. Metadata only — never observation rows — and
 * written ONCE as part of the existing finishFetchRun UPDATE (no extra
 * statement, no per-indicator writes). O10/O7/O8 unaffected: this never
 * influences publish decisions, transaction boundaries, or verification.
 */
export function buildFinalProgressSummary({ stage, status, trigger } = {}) {
  const metricKeys = Array.isArray(lastProgress?.metricKeys)
    ? [...lastProgress.metricKeys]
    : [...PRODUCTION_METRIC_KEYS];
  const labels =
    lastProgress?.labels && typeof lastProgress.labels === 'object'
      ? { ...lastProgress.labels }
      : Object.fromEntries(metricKeys.map((k) => [k, METRICS[k]?.label ?? k]));
  const steps = metricKeys.map((metricKey) => {
    const found = Array.isArray(lastProgress?.steps)
      ? lastProgress.steps.find((s) => s?.metricKey === metricKey)
      : null;
    if (found) {
      return {
        metricKey,
        label: found.label ?? labels[metricKey] ?? metricKey,
        status: found.status,
        ...(Number.isFinite(found.rows) ? { rows: found.rows } : {}),
        ...(found.error ? { error: String(found.error).slice(0, 500) } : {}),
        ...(found.at ? { at: found.at } : {}),
      };
    }
    return { metricKey, label: labels[metricKey] ?? metricKey, status: 'not_attempted' };
  });
  const count = (s) => steps.filter((x) => x.status === s).length;
  return {
    version: 1,
    stage: stage ?? lastProgress?.stage ?? null,
    status: status ?? lastProgress?.summary?.status ?? null,
    trigger: trigger ?? lastProgress?.trigger ?? null,
    startedAt: lastProgress?.startedAt ?? null,
    completedAt: new Date().toISOString(),
    metricKeys,
    labels,
    steps,
    counts: {
      total: steps.length,
      updated: count('published'),
      unchanged: count('unchanged'),
      failed: count('failed'),
      notAttempted: count('not_attempted'),
    },
  };
}

export async function refreshData(options = {}) {
  if (isRefreshInProgress()) {
    const error = new Error('A World Bank data refresh is already in progress.');
    error.code = 'REFRESH_IN_PROGRESS';
    throw error;
  }
  // Phase 8D: bounded inline retries for transient TRANSPORT failures only
  // (e.g. Turso/Hrana HTTP-layer blips mid-refresh). Each attempt is a full,
  // independent refresh: the previous attempt always failed definitively and
  // released everything in `finally` (O7 rolled back, locks cleared), so a
  // retry starts from a clean slate — never from the middle of a broken
  // transaction. Validation, auth, World Bank semantic and integrity errors
  // never retry (see isTransportError). The existing retry ladder still
  // applies afterwards if all inline attempts fail: no multiplication,
  // because the ladder fires once per failed refreshData() call.
  const transportDelays = refreshTransportRetryDelays();
  for (let attempt = 0; ; attempt += 1) {
  // Same-tick visibility: mark the attempt synchronously so a concurrent
  // caller in this process observes it immediately (the atomic SQLite lock
  // below remains the cross-process authority). Reaching past this point
  // proves no in-process refresh was flagged, so if lock acquisition fails
  // the mark below is ours alone to clear.
  refreshInProgress = true;
  // Publish the initial progress synchronously on entry (stage 'starting'):
  // status polling must observe a refresh the same tick it starts, never
  // gated on the first database round-trip. Detail fields available without
  // I/O go here; run-bound fields join as the refresh proceeds.
  lastProgress = {
    stage: 'starting',
    startedAt: new Date().toISOString(),
    trigger: options.trigger ?? 'manual',
    requestedStartYear: options.startYear ?? config.ingestStartYear,
    requestedEndYear: options.endYear ?? config.ingestEndYear,
    ...deriveFetchRange(
      options.startYear ?? config.ingestStartYear,
      options.endYear ?? config.ingestEndYear,
    ),
    // Phase 8B: per-indicator execution ledger for the progress UI.
    // In-memory only (never a database write): each entry records what the
    // refresh loop actually did — published (rows rewritten), unchanged
    // (O10 proved identical, zero writes), or failed (error message).
    // Execution progress, NOT publication state: on rollback nothing here
    // was published. Reset on every attempt; survives completion so the UI
    // can render the final checklist without extra polling.
    metricKeys: [...(Array.isArray(options.indicators) ? options.indicators : PRODUCTION_METRIC_KEYS)],
    // Display labels for every requested key (including not-yet-attempted
    // ones, which never get a step entry). Registry display metadata only.
    labels: Object.fromEntries(
      (Array.isArray(options.indicators) ? options.indicators : PRODUCTION_METRIC_KEYS).map((k) => [
        k,
        METRICS[k]?.label ?? k,
      ]),
    ),
    steps: [],
  };

  const db = options.db ?? getDb();
  const holder = `${options.trigger ?? 'manual'}:pid-${process.pid}`;

  // Cross-process authority: exactly one acquirer wins the atomic UPDATE.
  // Phase 8E: lock acquisition lives INSIDE the attempt try below so a
  // transport failure here flows through the same bounded inline-retry +
  // finally-release path as any other transport error (previously the throw
  // escaped before the try, leaking the in-process flag and skipping the
  // retry). Genuine contention still surfaces as REFRESH_IN_PROGRESS, which
  // never retries. The finally releases only when dbLockHeld is true, so a
  // contention rejection can never release another holder's lock.
  let dbLockHeld = false;
  const requestedStartYear = options.startYear ?? config.ingestStartYear;
  const requestedEndYear = options.endYear ?? config.ingestEndYear;
  const { fetchedStartYear, fetchedEndYear } = deriveFetchRange(
    requestedStartYear,
    requestedEndYear,
  );
  const metricKeys = options.indicators ?? PRODUCTION_METRIC_KEYS;
  const trigger = options.trigger ?? 'manual';

  const totals = {
    countriesRows: 0,
    rowsRetrieved: 0,
    rowsWithValue: 0,
    rowsUpserted: 0,
    rowsSkippedUnchanged: 0,
    rowsNullSkipped: 0,
    rowsNonFiniteSkipped: 0,
    rowsInvalidYear: 0,
    rowsAggregateExcluded: 0,
    rowsAggregateStored: 0,
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
  // PUBLISH INVARIANT (Phase 6C O7): all dataset writes happen inside ONE
  // outer transaction spanning the per-indicator loop below. fetch_runs rows
  // and ingest_year_stats for non-published attempts are audit history
  // (written outside the transaction) and must survive failures. A failed or
  // partial refresh therefore cannot publish a mixed dataset: the outer
  // transaction rolls back and the previous dataset stays exactly as it was.
  // Set when the catch below schedules another attempt (cleared per attempt).
  let pendingRetryDelay = null;
  // Phase 8O per-attempt temp staging directory (null until the first
  // changed indicator spills; always cleaned in the finally below).
  let stagingDir = null;
  try {
    // (Attempt flag and initial 'starting' progress were published
    // synchronously on entry, above.)
    try {
      dbLockHeld = await acquireRefreshLock(db, { holder });
    } catch (lockError) {
      if (isTransportError(lockError)) throw lockError;
      dbLockHeld = false;
    }
    if (!dbLockHeld) {
      let lockedBy = null;
      try {
        lockedBy = await refreshLockStatus(db);
      } catch {
        lockedBy = null;
      }
      const contention = new Error('A World Bank data refresh is already in progress.');
      contention.code = 'REFRESH_IN_PROGRESS';
      contention.lockedBy = lockedBy;
      throw contention;
    }
    const metricKeys = options.indicators ?? PRODUCTION_METRIC_KEYS;

    // Lifecycle enforcement (inside the try so the finally below always
    // releases the refresh lock): only production-enabled metrics may be
    // ingested. Disabled future definitions fail closed here instead of
    // crashing on a missing METRICS entry or silently widening the refresh.
    for (const key of metricKeys) {
      if (!isProductionMetric(key)) {
        const error = new Error(
          `Refresh supports production metrics only: "${key}" is not production-enabled.`,
        );
        error.code = 'INVALID_INDICATOR';
        error.httpStatus = 400;
        throw error;
      }
    }

    runId = await startFetchRun(db, {
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
    await setRefreshLockRunId(db, runId);

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

    // Phase 8O — ACQUISITION (no transaction open): per-indicator
    // fetch → validate → O10 compare → release-or-spill. Peak memory is a
    // single indicator: unchanged payloads are released outright, changed
    // payloads are spilled to temp staging files and released. No live
    // table is touched here, so a failure cannot publish a partial mix by
    // construction. All reads are autocommit; the single-writer refresh
    // lock is held throughout, so the O10 evidence cannot change under us
    // before publication.
    //
    // PUBLISH INVARIANT (O7): all dataset writes happen inside ONE short
    // publish transaction below (DB writes only, zero network I/O), so it
    // opens, writes, and commits before Turso can invalidate its
    // server-side statement/transaction state. fetch_runs rows and
    // ingest_year_stats for non-published attempts are audit history
    // (written outside the transaction) and must survive failures. A failed
    // or partial refresh therefore publishes nothing and the previous
    // dataset stays exactly as it was.
    lastProgress = { ...lastProgress, stage: 'indicators' };
    totals.countriesRows = countriesRows;
    // Phase 7D-2: country metadata is rewritten only when it actually
    // differs. The staged payload is compared against stored rows with the
    // exact publish normalization; a skip leaves every byte untouched
    // (extra stored entities are left in place by both paths — the upsert
    // never deletes). totals.countriesRows keeps counting staged rows.
    // The outcome (written vs skipped) drives content_version below: a
    // metadata-only change is still a content change for every
    // version-keyed consumer (years universe, aggregate typing).
    const storedCountries = await listCountries(db);
    const metadataChanged = !isCountriesPayloadUnchanged(storedCountries, meta.countries);
    if (!metadataChanged) {
      // Proven identical; the staged copy is now provably unneeded.
      meta.countries = EMPTY_RELEASED_ROWS;
    }
    let succeededCount = 0;
    // Phase 7B/7D: true once this attempt staged observation rewrites
    // (contentChanged) or country metadata changes (metadataChanged).
    // Either one advances content_version exactly once: value mutations
    // with a stable row count still advance it, while a fully-unchanged
    // attempt provably leaves every byte untouched. Metadata counts as
    // content because version-keyed consumers (years universe, aggregate
    // typing) depend on flags and membership, not just observation rows.
    let contentChanged = false;
    // Changed-indicator publish plans, in request order. Each holds a temp
    // staging file path (rows on disk) plus tiny indicator metadata —
    // never the staged rows themselves, so memory stays bounded no matter
    // how many indicators changed.
    const changedPlans = [];
    for (const metricKey of metricKeys) {
        lastProgress = { ...lastProgress, stage: `indicator:${metricKey}` };

        // A single indicator failing must not discard the others; the
        // failure is recorded and publication is refused unless EVERY
        // requested indicator succeeded (the partial branch below records
        // the attempt without publishing anything).
        let result = null;
        try {
          result = await fetchIndicatorPayload(
            metricKey,
            fetchedStartYear,
            fetchedEndYear,
            { eligibleIso3Set, aggregateIso3Set },
            {
              onProgress: (p) => options.onProgress?.({ stage: `indicator:${metricKey}`, ...p }),
              onWarn: (w) => options.onWarn?.(w),
            },
          );
        } catch (indicatorError) {
          perIndicator.push({
            metricKey,
            indicatorCode: METRICS[metricKey].indicatorCode,
            error: indicatorError.message,
          });
          recordStep(metricKey, 'failed', { error: indicatorError.message });
          options.onWarn?.({
            message: `Indicator ${metricKey} failed: ${indicatorError.message}`,
          });
          continue;
        }

        perIndicator.push(result);
        totals.rowsRetrieved += result.rowsRetrieved;
        totals.rowsWithValue += result.rowsWithValue;
        totals.rowsNullSkipped += result.rowsNullSkipped;
        totals.rowsNonFiniteSkipped += result.rowsNonFiniteSkipped;
        totals.rowsInvalidYear += result.rowsInvalidYear;
        totals.rowsAggregateExcluded += result.rowsAggregateExcluded;
        totals.rowsAggregateStored += result.rowsAggregateStored ?? 0;
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

        // Phase 6C O10: skip the delete+upsert writes when the staged payload
        // is proven element-identical to what is already stored. The run is
        // still a SUCCESS (freshness advances via finishFetchRun below); only
        // the redundant observation writes are omitted. rowsUpserted counts
        // rows physically written; rowsSkippedUnchanged counts rows proven
        // identical and left untouched.
        const existingIndicator = await getIndicatorByMetricKey(db, metricKey);
        let unchanged = false;
        if (existingIndicator) {
          const stored = await getObservationsForCompare(
            db,
            existingIndicator.id,
            fetchedStartYear,
            fetchedEndYear,
          );
          unchanged = isIndicatorPayloadUnchanged(stored, result.stagedRows);
        }
        if (unchanged) {
          result.skippedUnchanged = true;
          totals.rowsSkippedUnchanged += result.rowsUpserted;
          result.stagedRows = EMPTY_RELEASED_ROWS;
          recordStep(metricKey, 'unchanged', { rows: result.rowsUpserted });
          succeededCount += 1;
          continue;
        }

        // Changed: spill the staged rows to the per-attempt temp staging
        // directory and release them immediately (O2) — the publish step
        // below replays the file one indicator at a time, so memory never
        // holds more than one indicator even when all twenty changed.
        // rowsUpserted counts rows a successful publish WILL write
        // (all-or-nothing: a failed publish records a failed run and writes
        // nothing). The 'published' ledger step is recorded only after the
        // publish transaction actually writes them.
        totals.rowsUpserted += result.rowsUpserted;
        contentChanged = true;
        if (!stagingDir) stagingDir = await createStagingDir(runId);
        const stagedFile = await spillStagedRows(stagingDir, metricKey, result.stagedRows);
        changedPlans.push({
          metricKey,
          indicatorCode: result.indicatorCode,
          indicatorName: result.indicatorName,
          indicatorUnit: result.indicatorUnit,
          indicatorSource: result.indicatorSource,
          indicatorSourceNote: result.indicatorSourceNote,
          stagedFile,
          rows: result.rowsUpserted,
        });
        result.stagedRows = EMPTY_RELEASED_ROWS;
        succeededCount += 1;
      }

      const failedMetrics = perIndicator.filter((r) => r.error);
      if (succeededCount === 0) {
        throw new Error(
          `Every indicator failed during ingestion: ${perIndicator
            .map((r) => `${r.metricKey}: ${r.error}`)
            .join(' | ')}`,
        );
      }

      if (failedMetrics.length > 0) {
        // PARTIAL refresh: some indicators failed during acquisition, so
        // nothing is published at all (the publish transaction below never
        // opens) — identical observable outcome to the pre-8O rollback.
        // The attempt is recorded exactly as before: per-indicator
        // failures, no live-table changes, previous dataset intact,
        // last-success freshness unmoved.
        const failureSummary =
          `Partial refresh: ${succeededCount} of ${perIndicator.length} indicators staged; ` +
          `failures: ${failedMetrics.map((r) => `${r.metricKey}: ${r.error}`).join(' | ')}`;
        lastProgress = { ...lastProgress, stage: 'partial' };
        await upsertIngestYearStats(db, runId, yearStats);
        await finishFetchRun(db, runId, {
          status: 'partial',
          wbLastUpdated,
          universeSnapshot,
          errorMessage: failureSummary,
          ...totals,
          // Phase 8E: persisted terminal summary rides the existing UPDATE.
          progressSummary: buildFinalProgressSummary({ stage: 'partial', status: 'partial', trigger }),
        });
        const partialSummary = {
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
        lastProgress = { ...lastProgress, stage: 'complete', summary: partialSummary };
        return partialSummary;
      }

      // Phase 8O — PUBLICATION: ONE short atomic transaction with DB writes
      // only. No World Bank fetch, no network wait, no idle gap between
      // statements: it opens, writes, and commits back-to-back, so Turso's
      // server-side transaction/statement state stays valid. Spilled rows
      // stream back one indicator at a time (bounded memory, O2 intact).
      lastProgress = { ...lastProgress, stage: 'publishing' };
      await transaction(db, async (tx) => {
        if (metadataChanged) {
          await upsertCountriesInner(tx, meta.countries);
        }
        // Countries are published (or were proven identical above); the
        // staged copy is now provably unneeded.
        meta.countries = EMPTY_RELEASED_ROWS;
        for (const plan of changedPlans) {
          const stagedRows = await readSpilledRows(plan.stagedFile);
          await upsertIndicatorInner(tx, {
            ...METRICS[plan.metricKey],
            name: plan.indicatorName,
            unit: plan.indicatorUnit,
            source: plan.indicatorSource,
            sourceNote: plan.indicatorSourceNote,
          });
          const indicator = await getIndicatorByMetricKey(tx, plan.metricKey);
          await deleteObservationsForIndicatorYears(tx, indicator.id, fetchedStartYear, fetchedEndYear);
          await upsertObservationsInner(tx, stagedRows, (row) => ({ ...row, indicatorId: indicator.id }));
          recordStep(plan.metricKey, 'published', { rows: plan.rows });
        }
        await upsertIngestYearStatsInner(tx, runId, yearStats);
        // Phase 7B dataset_state: maintained INSIDE the same atomic publish
        // transaction, so observations and metadata commit or roll back
        // together — a partial/failed attempt can never leave a half-updated
        // row behind. A content change (observations rewritten OR country
        // metadata rewritten) recomputes the exact scan-derived values (rare:
        // only on real change) and advances content_version exactly once; an
        // all-unchanged attempt leaves every field untouched (freshness still
        // advances via the success run below). A missing row (legacy database)
        // is bootstrapped once, starting at content_version 1.
        {
          const previous = await getDatasetState(tx);
          if (contentChanged || metadataChanged || !previous) {
            const computed = await computeDatasetState(tx);
            await upsertDatasetStateInner(tx, {
              ...computed,
              contentVersion: (previous?.contentVersion ?? 0) + 1,
              integrityVerifiedContentVersion: null,
              updatedRunId: runId,
            });
          }
        }
        await finishFetchRun(tx, runId, {
          status: 'success',
          wbLastUpdated,
          universeSnapshot,
          ...totals,
          // Phase 8E: persisted terminal summary rides the existing UPDATE.
          progressSummary: buildFinalProgressSummary({ stage: 'complete', status: 'success', trigger }),
        });
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
    // Any fully successful refresh/check ends the stale state: the
    // consecutive-failure chain resets and no retry is needed — including an
    // all-unchanged success (zero writes still renews lastSuccessAt via the
    // success run recorded above, so the 24h TTL restarts here).
    noteRefreshSuccess();
    return summary;
  } catch (error) {
    lastProgress = { ...lastProgress, stage: 'failed', error: error.message };

    // Total failure (zero indicators staged, acquisition/publish failure, or
    // the publish transaction itself failed): NOTHING from this refresh was
    // ever published to the live tables — acquisition writes nothing to live
    // tables at all, and the single short publish transaction rolls back on
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
        await upsertIngestYearStats(db, runId, yearStats);
      } catch (statsError) {
        options.onWarn?.({ message: `Could not record per-year counters: ${statsError.message}` });
      }
      try {
        await finishFetchRun(db, runId, {
          status: 'failed',
          wbLastUpdated,
          universeSnapshot,
          errorMessage: error.message,
          ...totals,
          // Phase 8E: persisted terminal summary rides the existing UPDATE.
          progressSummary: buildFinalProgressSummary({ stage: 'failed', status: 'failed', trigger }),
        });
      } catch (recordError) {
        options.onWarn?.({ message: `Could not record the failed run: ${recordError.message}` });
      }
    }

    // Phase 8D diagnostic (no semantic change): name the progress stage the
    // attempt died in, so background-failure logs identify it without
    // guessing. The recorded fetch_runs message above keeps the original
    // error text verbatim.
    if (error && typeof error === 'object' && error.refreshStage == null) {
      error.refreshStage = lastProgress?.stage ?? null;
    }

    // Phase 8D inline retry: transport-class failures get bounded fresh
    // attempts (the failed attempt is fully recorded above and its locks
    // release in `finally` before the sleep). Anything else rethrows.
    if (isTransportError(error) && attempt < transportDelays.length) {
      const delay = transportDelays[attempt];
      options.onWarn?.({
        message:
          `Refresh attempt ${attempt + 1} failed with a transient transport error` +
          ` during ${error.refreshStage ?? 'unknown stage'} (${error.message}); ` +
          `retrying in ${delay} ms.`,
      });
      pendingRetryDelay = delay;
    } else {
      throw error;
    }
  } finally {
    // ALWAYS released - including when startFetchRun() or the run bookkeeping
    // throws, and including when the caller aborts. Both the in-memory flag
    // and the SQLite mutex are cleared; release failures are swallowed so a
    // lock-release problem can never mask the original ingest error.
    // releaseRefreshLock also clears the run_id association (P7).
    refreshInProgress = false;
    if (dbLockHeld) {
      try {
        await releaseRefreshLock(db);
      } catch {
        // Best effort; the stale row is recoverable via recoverRefreshLock().
      }
    }
    // Phase 8O: the per-attempt temp staging directory (if any) is removed
    // on every path — success, partial, failure, retry. Spilled rows are
    // replayed inside the publish above or never needed again.
    if (stagingDir) {
      try {
        await cleanupStagingDir(stagingDir);
      } catch {
        // Best effort; the OS reclaims tmp eventually.
      }
      stagingDir = null;
    }
  }
  // Reached only when retrying (success and partial returned above, other
  // failures rethrew). The next iteration re-initializes progress state,
  // re-acquires locks and starts a completely fresh attempt.
  await sleepMs(pendingRetryDelay);
  }
}

/**
 * Ingest only when the database has no observations yet.
 * Used on boot so a fresh clone becomes usable without a manual step.
 */
export async function ensureDataPresent(db, options = {}) {
  const handle = db ?? getDb();
  const count = await countObservations(handle);
  if (count > 0) return { ingested: false, observations: count };

  // NOTE: db must be forwarded so callers with an explicit handle (tests,
  // embedded use) never ingest into the shared singleton by accident.
  const summary = await refreshData({ db: handle, ...options, trigger: options.trigger ?? 'boot' });
  return { ingested: true, observations: summary.rowsUpserted, summary };
}

/**
 * Automatic refresh trigger for request serving and server boot.
 *
 * Async decision, fire-and-forget execution: when the cache is empty
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
  * @param {{ ttlHours?:number, autoStale?:boolean, autoEmpty?:boolean, onWarn?:Function, ignoreCooldown?:boolean, onTransportFailure?:Function }} [options]
  * `ignoreCooldown` is for the scheduled-retry timer only: the retry ladder
  * already spaces attempts, so the post-failure cooldown must not block it.
  * `onTransportFailure(error)` fires when the background attempt dies with a
  * transport-class error (after the bounded inline retries): server wiring
  * uses it to trigger runtime fallback without changing any retry semantics.
 * @returns {Promise<{ triggered:boolean, reason:string }>}
 */
export async function maybeAutoRefresh(db, options = {}) {
  const handle = db ?? getDb();
  const ttlHours = options.ttlHours ?? config.cacheTtlHours;
  const autoStale = options.autoStale ?? config.autoRefreshOnStale;
  const autoEmpty = options.autoEmpty ?? config.autoIngestOnEmpty;

  let status;
  try {
    status = await getCacheStatus(handle, { ttlHours });
  } catch {
    return { triggered: false, reason: 'status-unavailable' };
  }

  if (!status.refreshDue) return { triggered: false, reason: 'fresh' };
  if (status.empty && !autoEmpty) return { triggered: false, reason: 'empty-auto-ingest-disabled' };
  if (!status.empty && !autoStale) return { triggered: false, reason: 'stale-auto-refresh-disabled' };
  if (isRefreshInProgress()) return { triggered: false, reason: 'already-running' };
  try {
    if ((await refreshLockStatus(handle))?.locked) return { triggered: false, reason: 'already-running' };
  } catch {
    return { triggered: false, reason: 'status-unavailable' };
  }

  // Post-failure cooldown (automatic triggers only): the failed run is already
  // in fetch_runs, so consult it instead of hammering a down API. The
  // scheduled-retry timer bypasses this via ignoreCooldown: the retry ladder
  // itself is the backoff, and re-applying the cooldown would wedge the
  // first 5-minute retry behind a 15-minute gate.
  const lastRun = status.lastRun;
  if (!options.ignoreCooldown && lastRun && lastRun.status === 'failed') {
    const startedAt = new Date(lastRun.started_at).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt < AUTO_REFRESH_FAIL_COOLDOWN_MS) {
      return { triggered: false, reason: 'cooldown-after-failure' };
    }
  }

  const trigger = status.empty ? 'boot' : 'ttl';
  refreshData({ db: handle, trigger, onWarn: options.onWarn }).then(
    (summary) => {
      // A partial run publishes nothing, so the stale state persists: give
      // the failure a timed second chance (single-flight, backed off).
      if (summary?.status !== 'success') {
        scheduleRefreshRetry(handle, { trigger, onWarn: options.onWarn });
      }
    },
    (error) => {
      // Recorded in fetch_runs by refreshData itself; log without crashing,
      // then schedule the backed-off retry.
      options.onWarn?.({ message: `Automatic ${trigger} refresh failed: ${error.message}` });
      // Phase 8K: a transport-class death means the database itself may be
      // gone (not just the data source): offer failover a chance. All other
      // error classes skip it by classifier construction. Never throws.
      if (isTransportError(error)) {
        try {
          options.onTransportFailure?.(error);
        } catch {
          // Best effort; the retry below proceeds regardless.
        }
      }
      scheduleRefreshRetry(handle, { trigger, onWarn: options.onWarn });
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
export async function getCacheStatus(db, options = {}) {
  const ttlHours = Number(options.ttlHours ?? config.cacheTtlHours);
  const now = options.now ?? Date.now();
  // Phase 7D-4: the two independent fetch_runs reads share one round trip
  // (same values as the sequential version).
  const [[lastSuccessRow], [lastRunRow]] = await batchGet(db, [
    { sql: "SELECT MAX(completed_at) AS t FROM fetch_runs WHERE status = 'success'" },
    { sql: 'SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 1' },
  ]);
  const lastSuccessAt = lastSuccessRow?.t ?? null;
  // Phase 7B: the observation count is metadata when derived (1 row read);
  // absent row falls back to the legacy COUNT(*) scan. TTL arithmetic is
  // unchanged: strict ageHours < ttlHours on the success-run timestamp.
  const datasetState = await getDatasetState(db);
  const observations = datasetState ? datasetState.observationCount : await countObservations(db);

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
    lastRun: lastRunRow ?? null,
  };
}

export { getLatestFetchRun };
export default refreshData;