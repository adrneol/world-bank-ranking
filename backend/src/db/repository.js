/**
 * Repository layer: every SQL statement in the application lives here.
 *
 * Domain modules (ranking, YoY, coverage) never write SQL. They receive plain
 * JavaScript objects, which keeps the numerical logic independently testable
 * and makes the storage engine replaceable.
 *
 * Numerical representation (see schema.sql design notes):
 * Raw World Bank values are stored twice: as SQLite REAL (the queryable
 * numeric used for ORDER BY, range scans, ranking comparisons and YoY
 * arithmetic — deterministic for a fixed snapshot) and as value_raw TEXT
 * (the canonical decimal string of the accepted value, for audit and
 * reproducibility). Nothing is ever rounded before calculation; formatting
 * lives in domain/format.js and is presentation-only.
 */

import { getDb, transaction } from './index.js';

const nowIso = () => new Date().toISOString();

/** Null out undefined so bound parameters stay valid. */
const nz = (v) => (v === undefined ? null : v);

/**
 * Canonical decimal string for a finite numeric value.
 *
 * If the input is a string holding a valid decimal, its trimmed form is kept
 * (preserving the sender's lexical form when it round-trips). If it is a
 * number, String(value) is the shortest round-trip representation, which is
 * lossless with respect to the parsed IEEE-754 double:
 * Number(canonicalDecimalString(x)) === x for every finite x.
 * Returns null for null/undefined/non-finite input.
 */
export function canonicalDecimalString(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return null;
    if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return trimmed;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return String(input);
  }
  return null;
}

/** Coerce a World Bank region object into id/value parts. */
function regionParts(region) {
  return {
    regionId: region?.id ?? null,
    regionName: region?.value ?? null,
  };
}

// ============================================================
// countries
// ============================================================

export function upsertCountry(db, row) {
  db.prepare(`
    INSERT INTO countries (
      id, iso2, iso3, name, region, region_id, admin_region, income_level,
      lending_type, capital_city, is_aggregate, aggregate_reason, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      iso2             = excluded.iso2,
      iso3             = excluded.iso3,
      name             = excluded.name,
      region           = excluded.region,
      region_id        = excluded.region_id,
      admin_region     = excluded.admin_region,
      income_level     = excluded.income_level,
      lending_type     = excluded.lending_type,
      capital_city     = excluded.capital_city,
      is_aggregate     = excluded.is_aggregate,
      aggregate_reason = excluded.aggregate_reason,
      updated_at       = excluded.updated_at
  `).run(
    row.id,
    nz(row.iso2),
    nz(row.iso3 ?? row.id),
    row.name,
    nz(row.region),
    nz(row.regionId),
    nz(row.adminRegion),
    nz(row.incomeLevel),
    nz(row.lendingType),
    nz(row.capitalCity),
    row.isAggregate ? 1 : 0,
    nz(row.aggregateReason),
    nowIso(),
  );
}

/** Bulk upsert metadata inside a single transaction. */
export function upsertCountries(db, rows) {
  return transaction(db, () => {
    for (const row of rows) upsertCountry(db, row);
    return rows.length;
  });
}

export function getCountry(db, iso3) {
  return (
    db
      .prepare('SELECT * FROM countries WHERE id = ? OR iso3 = ? LIMIT 1')
      .get(String(iso3).toUpperCase(), String(iso3).toUpperCase()) ?? null
  );
}

/** All metadata rows, aggregates included unless excluded. */
export function listCountries(db, { includeAggregates = true } = {}) {
  const sql = includeAggregates
    ? 'SELECT * FROM countries ORDER BY name'
    : 'SELECT * FROM countries WHERE is_aggregate = 0 ORDER BY name';
  return db.prepare(sql).all();
}

/** Non-aggregate countries/economies, sorted by ISO3. */
export function listEligibleCountries(db) {
  return db.prepare('SELECT * FROM countries WHERE is_aggregate = 0 ORDER BY id').all();
}

/** Entities that were flagged as aggregates. */
export function listAggregateCountries(db) {
  return db.prepare('SELECT * FROM countries WHERE is_aggregate = 1 ORDER BY id').all();
}

/**
 * The eligible metadata universe size.
 *
 * This is the count of countries/economies that MAY be ranked. It is NOT the
 * denominator of any ranking: the denominator is the count of those entities
 * holding a valid observation for a given year and indicator.
 */
export function countEligibleCountries(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 0').get().n;
}

export function countAllCountries(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM countries').get().n;
}

export function countAggregateCountries(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 1').get().n;
}

// ============================================================
// indicators
// ============================================================

export function upsertIndicator(db, metric) {
  db.prepare(`
    INSERT INTO indicators (code, metric_key, name, unit, source, source_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      metric_key  = excluded.metric_key,
      name        = excluded.name,
      unit        = excluded.unit,
      source      = excluded.source,
      source_note = excluded.source_note,
      updated_at  = excluded.updated_at
  `).run(
    metric.indicatorCode,
    metric.key,
    nz(metric.name ?? metric.label),
    nz(metric.unit),
    nz(metric.source ?? 'World Development Indicators'),
    nz(metric.sourceNote),
    nowIso(),
  );
}

export function getIndicatorByMetricKey(db, metricKey) {
  return db.prepare('SELECT * FROM indicators WHERE metric_key = ?').get(metricKey) ?? null;
}

export function getIndicatorByCode(db, code) {
  return db.prepare('SELECT * FROM indicators WHERE code = ?').get(code) ?? null;
}

export function listIndicators(db) {
  return db.prepare('SELECT * FROM indicators ORDER BY id').all();
}

// ============================================================
// observations
// ============================================================

/**
 * Insert or update one raw observation.
 * The numeric value is stored exactly as received (REAL, no rounding) along
 * with its canonical decimal string (value_raw TEXT, for audit). Callers may
 * omit valueRaw, in which case it defaults to String(value).
 */
export function upsertObservation(db, { countryId, indicatorId, year, value, valueRaw, wbLastUpdated }) {
  const raw = valueRaw ?? (value === null || value === undefined ? null : String(value));
  db.prepare(`
    INSERT INTO observations (country_id, indicator_id, year, value, value_raw, wb_last_updated, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(country_id, indicator_id, year) DO UPDATE SET
      value           = excluded.value,
      value_raw       = excluded.value_raw,
      wb_last_updated = excluded.wb_last_updated,
      fetched_at      = excluded.fetched_at
  `).run(countryId, indicatorId, year, value, nz(raw), nz(wbLastUpdated), nowIso());
}

/** Bulk upsert observations in one transaction. Returns rows written. */
export function upsertObservations(db, rows) {
  return transaction(db, () => {
    let n = 0;
    for (const row of rows) {
      upsertObservation(db, row);
      n += 1;
    }
    return n;
  });
}

export function getObservation(db, countryId, indicatorId, year) {
  return (
    db
      .prepare(
        'SELECT * FROM observations WHERE country_id = ? AND indicator_id = ? AND year = ?',
      )
      .get(countryId, indicatorId, year) ?? null
  );
}

/**
 * Every eligible (non-aggregate) observation for one indicator and year.
 *
 * This is the exact input to a level ranking. Aggregates are excluded here at
 * the SQL level, mirroring the single filtering rule in domain/universe.js.
 * valueRaw is audit-only: calculations must use the numeric value.
 *
 * @returns {{iso3:string, name:string, value:number, valueRaw:string|null}[]}
 */
export function getEligibleObservations(db, indicatorId, year) {
  return db
    .prepare(`
      SELECT o.country_id AS iso3,
              c.name       AS name,
              o.value      AS value,
              o.value_raw  AS valueRaw
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year = ?
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
    `)
    .all(indicatorId, year);
}

/** Eligible observations for one indicator across a year range. */
export function getEligibleObservationsRange(db, indicatorId, startYear, endYear) {
  return db
    .prepare(`
      SELECT o.country_id AS iso3,
              c.name       AS name,
              o.year       AS year,
              o.value      AS value,
              o.value_raw  AS valueRaw
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year BETWEEN ? AND ?
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
      ORDER BY o.year, o.country_id
    `)
    .all(indicatorId, startYear, endYear);
}

/**
 * Eligible observations for one indicator across an explicit year list.
 *
 * Single-statement atomic read for comparisons: both years come from one
 * query so a concurrent refresh cannot change one side halfway through the
 * assembly. Rows carry the vintage columns so the service can detect mixed
 * vintages without a second query.
 *
 * @param {object} db
 * @param {number} indicatorId
 * @param {number[]} years e.g. [yearA, yearB]
 * @returns {{iso3:string, name:string, year:number, value:number, valueRaw:string|null, wbLastUpdated:string|null, fetchedAt:string|null}[]}
 */
export function getEligibleObservationsForYears(db, indicatorId, years) {
  const unique = [...new Set((years ?? []).filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  return db
    .prepare(
      `
      SELECT o.country_id AS iso3,
             c.name       AS name,
             o.year       AS year,
             o.value      AS value,
             o.value_raw  AS valueRaw,
             o.wb_last_updated AS wbLastUpdated,
             o.fetched_at AS fetchedAt
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year IN (${placeholders})
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
      ORDER BY o.year, o.country_id
    `,
    )
    .all(indicatorId, ...unique);
}

/**
 * Bulk economy metadata for a supplied ISO3 list.
 *
 * @param {object} db
 * @param {string[]} iso3List
 */
export function getCountriesByIso3List(db, iso3List) {
  const unique = [...new Set((iso3List ?? []).map((s) => String(s).toUpperCase()))].sort();
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM countries WHERE id IN (${placeholders}) ORDER BY id`)
    .all(...unique);
}

/**
 * Vintage summary for one indicator across explicit years (eligible rows only).
 *
 * @returns {{lastUpdatedValues:string[], fetchedAtMin:string|null, fetchedAtMax:string|null, rowCount:number}|null}
 */
export function getVintageForIndicatorYears(db, indicatorId, years) {
  const unique = [...new Set((years ?? []).filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(
      `
      SELECT o.wb_last_updated AS wbLastUpdated,
             MIN(o.fetched_at) AS fetchedAtMin,
             MAX(o.fetched_at) AS fetchedAtMax,
             COUNT(*) AS rowCount
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year IN (${placeholders})
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
      GROUP BY o.wb_last_updated
    `,
    )
    .all(indicatorId, ...unique);
  if (!rows || rows.length === 0) return null;
  let fetchedAtMin = null;
  let fetchedAtMax = null;
  let rowCount = 0;
  const lastUpdatedValues = [];
  for (const r of rows) {
    lastUpdatedValues.push(r.wbLastUpdated ?? null);
    if (r.fetchedAtMin && (!fetchedAtMin || r.fetchedAtMin < fetchedAtMin)) fetchedAtMin = r.fetchedAtMin;
    if (r.fetchedAtMax && (!fetchedAtMax || r.fetchedAtMax > fetchedAtMax)) fetchedAtMax = r.fetchedAtMax;
    rowCount += r.rowCount ?? 0;
  }
  lastUpdatedValues.sort();
  return { lastUpdatedValues, fetchedAtMin, fetchedAtMax, rowCount };
}

/**
 * Dataset fingerprint for cross-request consistency.
 *
 * Lets the frontend detect whether two successive responses came from the
 * same retrieval generation.
 */
export function getDatasetFingerprint(db) {
  const lastSuccessAt = getLastSuccessfulFetchTime(db);
  const maxFetched = db.prepare('SELECT MAX(fetched_at) AS t FROM observations').get()?.t ?? null;
  const observationCount = countObservations(db);
  const latestRun = getLatestFetchRun(db, { status: 'success' });
  return {
    lastSuccessAt,
    maxFetchedAt: maxFetched,
    observationCount,
    runId: latestRun?.id ?? null,
  };
}

/** Observations for one country across a year range (e.g. India's timeline). */
export function getCountryObservationsRange(db, indicatorId, iso3, startYear, endYear) {
  return db
    .prepare(`
      SELECT year, value, value_raw AS valueRaw
      FROM observations
      WHERE indicator_id = ? AND country_id = ? AND year BETWEEN ? AND ?
      ORDER BY year
    `)
    .all(indicatorId, String(iso3).toUpperCase(), startYear, endYear);
}

/** How many eligible entities hold a valid value for indicator+year. */
export function countEligibleObservations(db, indicatorId, year) {
  return db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year = ?
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
    `)
    .get(indicatorId, year).n;
}

/** Total stored observations, optionally for one indicator. */
export function countObservations(db, indicatorId = null) {
  if (indicatorId === null) {
    return db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  }
  return db
    .prepare('SELECT COUNT(*) AS n FROM observations WHERE indicator_id = ?')
    .get(indicatorId).n;
}

/** Available year range for the whole database or one indicator. */
export function getYearRange(db, indicatorId = null) {
  const row =
    indicatorId === null
      ? db.prepare('SELECT MIN(year) AS minYear, MAX(year) AS maxYear FROM observations').get()
      : db
          .prepare(
            'SELECT MIN(year) AS minYear, MAX(year) AS maxYear FROM observations WHERE indicator_id = ?',
          )
          .get(indicatorId);
  return { minYear: row?.minYear ?? null, maxYear: row?.maxYear ?? null };
}

/** Distinct years holding at least one eligible observation, ascending. */
export function listYearsWithData(db, indicatorId) {
  return db
    .prepare(`
      SELECT DISTINCT o.year AS year
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ? AND c.is_aggregate = 0 AND o.value IS NOT NULL
      ORDER BY o.year
    `)
    .all(indicatorId)
    .map((r) => r.year);
}

/**
 * Every year that holds at least one eligible observation for ANY metric, plus
 * the same list per metric.
 *
 * The year filter must be derived from the stored data (specification section 8),
 * never from a hardcoded 2000-2025 range, so a newer World Bank vintage becomes
 * selectable as soon as it has been ingested.
 */
export function listAvailableYears(db) {
  const years = db
    .prepare(`
      SELECT DISTINCT o.year AS year
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE c.is_aggregate = 0 AND o.value IS NOT NULL
      ORDER BY o.year
    `)
    .all()
    .map((r) => r.year);

  const perMetric = {};
  for (const indicator of listIndicators(db)) {
    perMetric[indicator.metric_key] = listYearsWithData(db, indicator.id);
  }

  return {
    years,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    perMetric,
  };
}

/**
 * Country-level coverage for one indicator+year:
 *   eligible universe, valid observations, entities lacking an observation.
 */
export function getCoverageCounts(db, indicatorId, year) {
  const eligible = countEligibleCountries(db);
  const valid = countEligibleObservations(db, indicatorId, year);
  return {
    eligibleUniverse: eligible,
    validObservations: valid,
    missingObservations: Math.max(0, eligible - valid),
  };
}

// ============================================================
// fetch_runs
// ============================================================

export function startFetchRun(db, meta) {
  const info = db.prepare(`
    INSERT INTO fetch_runs (
      started_at, status, trigger, endpoint, requested_start_year, requested_end_year,
      fetched_start_year, fetched_end_year, indicators
    ) VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nowIso(),
    nz(meta.trigger),
    nz(meta.endpoint),
    nz(meta.requestedStartYear),
    nz(meta.requestedEndYear),
    nz(meta.fetchedStartYear),
    nz(meta.fetchedEndYear),
    nz(Array.isArray(meta.indicators) ? meta.indicators.join(',') : meta.indicators),
  );
  return Number(info.lastInsertRowid);
}

export function finishFetchRun(db, id, patch) {
  db.prepare(`
    UPDATE fetch_runs SET
      completed_at            = ?,
      status                  = ?,
      wb_last_updated         = ?,
      countries_rows          = ?,
      rows_retrieved          = ?,
      rows_upserted           = ?,
      rows_null_skipped       = ?,
      rows_aggregate_excluded = ?,
      rows_blank_iso3_skipped = ?,
      rows_unknown_country    = ?,
      rows_with_value         = ?,
      rows_non_finite_skipped = ?,
      rows_invalid_year       = ?,
      pages_fetched           = ?,
      requests                = ?,
      universe_snapshot       = ?,
      error_message           = ?
    WHERE id = ?
  `).run(
    nowIso(),
    patch.status ?? 'success',
    nz(patch.wbLastUpdated),
    patch.countriesRows ?? 0,
    patch.rowsRetrieved ?? 0,
    patch.rowsUpserted ?? 0,
    patch.rowsNullSkipped ?? 0,
    patch.rowsAggregateExcluded ?? 0,
    patch.rowsBlankIso3Skipped ?? 0,
    patch.rowsUnknownCountry ?? 0,
    patch.rowsWithValue ?? 0,
    patch.rowsNonFiniteSkipped ?? 0,
    patch.rowsInvalidYear ?? 0,
    patch.pagesFetched ?? 0,
    patch.requests ?? 0,
    patch.universeSnapshot ? JSON.stringify(patch.universeSnapshot) : null,
    nz(patch.errorMessage),
    id,
  );
}

/**
 * Persist the per-year ingest counters for a run (replacing any earlier attempt
 * for the same run/metric/year so a retried run cannot double count).
 *
 * @param {object} db
 * @param {number} runId
 * @param {object[]} rows one entry per metric and year
 */
export function upsertIngestYearStats(db, runId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const statement = db.prepare(`
    INSERT INTO ingest_year_stats (
      fetch_run_id, metric_key, indicator_code, year,
      rows_received, rows_with_value, rows_written, rows_null_skipped,
      rows_non_finite_skipped, rows_invalid_year, rows_blank_iso3_skipped,
      rows_aggregate_excluded, rows_unknown_country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fetch_run_id, metric_key, year) DO UPDATE SET
      indicator_code          = excluded.indicator_code,
      rows_received           = excluded.rows_received,
      rows_with_value         = excluded.rows_with_value,
      rows_written            = excluded.rows_written,
      rows_null_skipped       = excluded.rows_null_skipped,
      rows_non_finite_skipped = excluded.rows_non_finite_skipped,
      rows_invalid_year       = excluded.rows_invalid_year,
      rows_blank_iso3_skipped = excluded.rows_blank_iso3_skipped,
      rows_aggregate_excluded = excluded.rows_aggregate_excluded,
      rows_unknown_country    = excluded.rows_unknown_country
  `);
  return transaction(db, () => {
    let n = 0;
    for (const row of rows) {
      if (row?.year === null || row?.year === undefined) continue;
      statement.run(
        runId,
        row.metricKey,
        nz(row.indicatorCode),
        row.year,
        row.rowsReceived ?? 0,
        row.rowsWithValue ?? 0,
        row.rowsWritten ?? 0,
        row.rowsNullSkipped ?? 0,
        row.rowsNonFiniteSkipped ?? 0,
        row.rowsInvalidYear ?? 0,
        row.rowsBlankIso3Skipped ?? 0,
        row.rowsAggregateExcluded ?? 0,
        row.rowsUnknownCountry ?? 0,
      );
      n += 1;
    }
    return n;
  });
}

/**
 * Per-year ingest counters recorded for one metric.
 *
 * Ordering is deterministic: for a single year the LATEST fetch run comes
 * first (ORDER BY fetch_run_id DESC) so callers can take index [0] as the
 * latest applicable run. The multi-year form is ordered by year ascending
 * with the latest run first within each year, for the same reason.
 */
export function getIngestYearStats(db, metricKey, options = {}) {
  if (options.year !== undefined && options.year !== null) {
    return (
      db
        .prepare(
          'SELECT * FROM ingest_year_stats WHERE metric_key = ? AND year = ? ORDER BY fetch_run_id DESC',
        )
        .all(metricKey, options.year) ?? []
    );
  }
  return db
    .prepare(
      'SELECT * FROM ingest_year_stats WHERE metric_key = ? ORDER BY year ASC, fetch_run_id DESC',
    )
    .all(metricKey);
}

/**
 * Latest recorded ingest counters for one metric and year (latest fetch run).
 * Returns null when the year was never ingested for that metric.
 */
export function getLatestIngestYearStat(db, metricKey, year) {
  if (year === null || year === undefined) return null;
  return getIngestYearStats(db, metricKey, { year })[0] ?? null;
}

/**
 * The universe snapshot recorded by the most recent successful run (eligible and
 * aggregate entity ids as fetched from the World Bank metadata).
 *
 * @returns {{runId:number, completedAt:string|null, snapshot:object}|null}
 */
export function getLatestUniverseSnapshot(db, options = {}) {
  const excludeRunId = options.excludeRunId ?? null;
  const row = db
    .prepare(
      `SELECT id, completed_at, universe_snapshot
       FROM fetch_runs
       WHERE status = 'success' AND universe_snapshot IS NOT NULL AND id != ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(excludeRunId ?? -1);
  if (!row || !row.universe_snapshot) return null;
  return {
    runId: row.id,
    completedAt: row.completed_at ?? null,
    snapshot: JSON.parse(row.universe_snapshot),
  };
}

/**
 * The universe snapshot recorded by ONE specific run, used to compare the
 * eligible metadata universe between two different retrievals.
 *
 * @returns {{runId:number, completedAt:string|null, snapshot:object}|null}
 */
export function getUniverseSnapshotByRun(db, runId) {
  if (runId === null || runId === undefined) return null;
  const row = db
    .prepare(
      'SELECT id, completed_at, universe_snapshot FROM fetch_runs WHERE id = ? LIMIT 1',
    )
    .get(runId);
  if (!row || !row.universe_snapshot) return null;
  return {
    runId: row.id,
    completedAt: row.completed_at ?? null,
    snapshot: JSON.parse(row.universe_snapshot),
  };
}

export function getLatestFetchRun(db, { status = 'success' } = {}) {
  if (status) {
    return (
      db
        .prepare('SELECT * FROM fetch_runs WHERE status = ? ORDER BY id DESC LIMIT 1')
        .get(status) ?? null
    );
  }
  return db.prepare('SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 1').get() ?? null;
}

export function listFetchRuns(db, limit = 20) {
  return db.prepare('SELECT * FROM fetch_runs ORDER BY id DESC LIMIT ?').all(limit);
}

export function getLastSuccessfulFetchTime(db) {
  const row = db
    .prepare("SELECT MAX(completed_at) AS t FROM fetch_runs WHERE status = 'success'")
    .get();
  return row?.t ?? null;
}

// ============================================================
// refresh_locks: SQLite-backed cross-process mutex (see schema.sql)
// ============================================================

/** Current lock row (always id = 1). */
export function refreshLockStatus(db) {
  return (
    db.prepare('SELECT id, locked, run_id AS runId, holder, updated_at AS updatedAt FROM refresh_locks WHERE id = 1').get() ?? null
  );
}

/**
 * Atomically acquire the refresh lock. Returns true when this caller won it,
 * false when another holder owns it. Exactly one concurrent acquirer can win,
 * even across processes, because the UPDATE matches only when locked = 0.
 */
export function acquireRefreshLock(db, { runId = null, holder = null } = {}) {
  const info = db
    .prepare('UPDATE refresh_locks SET locked = 1, run_id = ?, holder = ?, updated_at = ? WHERE id = 1 AND locked = 0')
    .run(nz(runId), nz(holder), nowIso());
  return info.changes === 1;
}

/** Release the lock unconditionally (idempotent). */
export function releaseRefreshLock(db) {
  db.prepare("UPDATE refresh_locks SET locked = 0, run_id = NULL, holder = NULL, updated_at = ? WHERE id = 1").run(nowIso());
}

/**
 * Recover a stale lock (e.g. after a crash left locked = 1 with no live
 * holder). Releases it and returns the previous row for the audit trail.
 */
export function forceReleaseRefreshLock(db, reason = null) {
  const previous = refreshLockStatus(db);
  releaseRefreshLock(db);
  return { previous, reason };
}

// ============================================================
// health / status helpers
// ============================================================

/** True when no observation has been ingested yet. */
export function isDatabaseEmpty(db) {
  return countObservations(db) === 0;
}

export { getDb, transaction, regionParts };
export default { getDb };