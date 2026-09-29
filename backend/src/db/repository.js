/**
 * Repository layer: every SQL statement in the application lives here.
 *
 * Domain modules (ranking, YoY, coverage) never write SQL. They receive plain
 * JavaScript objects, which keeps the numerical logic independently testable
 * and makes the storage engine replaceable.
 *
 * Phase 6A: all functions are async and run through `./driver.js` against a
 * libSQL handle, so the Turso Cloud primary and the local SQLite-file
 * fallback share one code path. SQL text and result shapes are unchanged
 * from the node:sqlite implementation (SELECT rows arrive as objects keyed
 * by column/alias names); only sync→async changed.
 *
 * Numerical representation (see schema.sql design notes):
 * Raw World Bank values are stored twice: as SQLite REAL (the queryable
 * numeric used for ORDER BY, range scans, ranking comparisons and YoY
 * arithmetic — deterministic for a fixed snapshot) and as value_raw TEXT
 * (the canonical decimal string of the accepted value, for audit and
 * reproducibility). Nothing is ever rounded before calculation; formatting
 * lives in domain/format.js and is presentation-only.
 */

import { getDb } from './index.js';
import { batchRun, queryAll, queryGet, queryRun, transaction } from './driver.js';

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

export async function upsertCountry(db, row) {
  await queryRun(
    db,
    `
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
  `,
    [
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
    ],
  );
}

/** Bulk upsert metadata without opening a transaction (for use inside a publish transaction). */
export async function upsertCountriesInner(db, rows) {
  await batchRun(
    db,
    rows.map((row) => ({
      sql: `
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
  `,
      args: [
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
      ],
    })),
  );
  return rows.length;
}

/** Bulk upsert metadata inside a single transaction. */
export function upsertCountries(db, rows) {
  return transaction(db, async (tx) => upsertCountriesInner(tx, rows));
}

export async function getCountry(db, iso3) {
  return (
    (await queryGet(db, 'SELECT * FROM countries WHERE id = ? OR iso3 = ? LIMIT 1', [
      String(iso3).toUpperCase(),
      String(iso3).toUpperCase(),
    ])) ?? null
  );
}

/**
 * Country metadata by ISO 3166-1 alpha-2 code (geolocation providers return
 * alpha-2; the application reasons in ISO3). Case-insensitive. Returns null
 * for unknown codes — including World Bank aggregate rows, which carry no
 * usable iso2 and therefore never match.
 */
export async function getCountryByIso2(db, iso2) {
  const code = String(iso2 ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return (await queryGet(db, 'SELECT * FROM countries WHERE UPPER(iso2) = ? LIMIT 1', [code])) ?? null;
}

/** All metadata rows, aggregates included unless excluded. */
export async function listCountries(db, { includeAggregates = true } = {}) {
  const sql = includeAggregates
    ? 'SELECT * FROM countries ORDER BY name'
    : 'SELECT * FROM countries WHERE is_aggregate = 0 ORDER BY name';
  return queryAll(db, sql);
}

/** Non-aggregate countries/economies, sorted by ISO3. */
export async function listEligibleCountries(db) {
  return queryAll(db, 'SELECT * FROM countries WHERE is_aggregate = 0 ORDER BY id');
}

/** Entities that were flagged as aggregates. */
export async function listAggregateCountries(db) {
  return queryAll(db, 'SELECT * FROM countries WHERE is_aggregate = 1 ORDER BY id');
}

/**
 * The eligible metadata universe size.
 *
 * This is the count of countries/economies that MAY be ranked. It is NOT the
 * denominator of any ranking: the denominator is the count of those entities
 * holding a valid observation for a given year and indicator.
 */
export async function countEligibleCountries(db) {
  const row = await queryGet(db, 'SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 0');
  return row.n;
}

export async function countAllCountries(db) {
  const row = await queryGet(db, 'SELECT COUNT(*) AS n FROM countries');
  return row.n;
}

export async function countAggregateCountries(db) {
  const row = await queryGet(db, 'SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 1');
  return row.n;
}

/**
 * Country-group discovery for movement family sections (no hardcoding).
 * `col` is an internal allowlisted column name, never end-user input.
 */
const COUNTRY_GROUP_COLUMNS = Object.freeze(['income_level', 'region', 'admin_region', 'lending_type']);

function assertGroupColumn(col) {
  if (!COUNTRY_GROUP_COLUMNS.includes(col)) throw new Error(`Invalid country group column: ${col}`);
  return col;
}

/** Distinct non-null values of a metadata column across eligible countries. */
export async function listDistinctCountryColumn(db, col) {
  assertGroupColumn(col);
  return queryAll(
    db,
    `SELECT DISTINCT ${col} AS v FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL`,
  );
}

/** Eligible country ids holding one metadata value (uppercase ISO3). */
export async function listCountryIdsByColumn(db, col, value) {
  assertGroupColumn(col);
  const rows = await queryAll(db, `SELECT id FROM countries WHERE is_aggregate = 0 AND ${col} = ?`, [value]);
  return rows.map((r) => String(r.id).toUpperCase());
}

/** Per-value eligible counts of a metadata column (group catalog). */
export async function countCountryGroupsByColumn(db, col) {
  assertGroupColumn(col);
  return queryAll(
    db,
    `SELECT ${col} AS value, COUNT(*) AS eligibleCount FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY ${col}`,
  );
}

// ============================================================
// indicators
// ============================================================

export async function upsertIndicator(db, metric) {
  await queryRun(
    db,
    `
    INSERT INTO indicators (code, metric_key, name, unit, source, source_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      metric_key  = excluded.metric_key,
      name        = excluded.name,
      unit        = excluded.unit,
      source      = excluded.source,
      source_note = excluded.source_note,
      updated_at  = excluded.updated_at
  `,
    [
      metric.indicatorCode,
      metric.key,
      nz(metric.name ?? metric.label),
      nz(metric.unit),
      nz(metric.source ?? 'World Development Indicators'),
      nz(metric.sourceNote),
      nowIso(),
    ],
  );
}

export async function getIndicatorByMetricKey(db, metricKey) {
  return (await queryGet(db, 'SELECT * FROM indicators WHERE metric_key = ?', [metricKey])) ?? null;
}

export async function getIndicatorByCode(db, code) {
  return (await queryGet(db, 'SELECT * FROM indicators WHERE code = ?', [code])) ?? null;
}

export async function listIndicators(db) {
  return queryAll(db, 'SELECT * FROM indicators ORDER BY id');
}

// ============================================================
// observations
// ============================================================

/**
 * Insert or update one raw observation.
 * The numeric value is stored exactly as received (REAL, no rounding) along
 * with its canonical decimal string (value_raw TEXT, for audit). Callers may
 * omit valueRaw, in which case it defaults to String(value).
 *
 * Transport note (Phase 6A): REAL values are bound as canonical decimal
 * STRINGS, never as JSON numbers. Remote database protocols can serialize
 * JSON numbers with fewer than 17 significant digits, silently shifting
 * sub-ulp values (observed: tiny historic FX/index magnitudes drifted by
 * 1 ulp through Turso). SQLite parses the decimal text into the exact
 * nearest double, so string binding round-trips bitwise-identically on every
 * backend while storing the identical REAL. Callers must still pass the
 * numeric value (validation/type contract unchanged); only the binding form
 * differs.
 */
export async function upsertObservation(db, { countryId, indicatorId, year, value, valueRaw, wbLastUpdated }) {
  const raw = valueRaw ?? (value === null || value === undefined ? null : String(value));
  // Bind finite REALs as text; anything else passes through untouched.
  const numericBinding = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  await queryRun(
    db,
    `
    INSERT INTO observations (country_id, indicator_id, year, value, value_raw, wb_last_updated, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(country_id, indicator_id, year) DO UPDATE SET
      value           = excluded.value,
      value_raw       = excluded.value_raw,
      wb_last_updated = excluded.wb_last_updated,
      fetched_at      = excluded.fetched_at
  `,
    [countryId, indicatorId, year, numericBinding, nz(raw), nz(wbLastUpdated), nowIso()],
  );
}

/** Bulk upsert observations without opening a transaction (for use inside a publish transaction). Returns rows written. */
export async function upsertObservationsInner(db, rows) {
  await batchRun(
    db,
    rows.map((row) => {
      const raw = row.valueRaw ?? (row.value === null || row.value === undefined ? null : String(row.value));
      // REAL-as-text binding: see upsertObservation (Phase 6A transport note).
      const numericBinding =
        typeof row.value === 'number' && Number.isFinite(row.value) ? String(row.value) : row.value;
      return {
        sql: `
    INSERT INTO observations (country_id, indicator_id, year, value, value_raw, wb_last_updated, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(country_id, indicator_id, year) DO UPDATE SET
      value           = excluded.value,
      value_raw       = excluded.value_raw,
      wb_last_updated = excluded.wb_last_updated,
      fetched_at      = excluded.fetched_at
  `,
        args: [
          row.countryId,
          row.indicatorId,
          row.year,
          numericBinding,
          nz(raw),
          nz(row.wbLastUpdated),
          nowIso(),
        ],
      };
    }),
  );
  return rows.length;
}

/** Bulk upsert observations in one transaction. Returns rows written. */
export function upsertObservations(db, rows) {
  return transaction(db, async (tx) => upsertObservationsInner(tx, rows));
}

/**
 * Delete stored observations for one indicator inside an inclusive year range.
 *
 * Used ONLY by the atomic refresh publication to reconcile a refreshed
 * metric/year range against the new staged World Bank payload: a value the
 * World Bank no longer supplies must disappear instead of lingering as stale
 * data. Never deletes other metrics or years outside the refreshed range.
 * Callers must run this inside the publish transaction.
 *
 * @returns {number} deleted row count
 */
export async function deleteObservationsForIndicatorYears(db, indicatorId, startYear, endYear) {
  const info = await queryRun(
    db,
    'DELETE FROM observations WHERE indicator_id = ? AND year BETWEEN ? AND ?',
    [indicatorId, startYear, endYear],
  );
  return info.changes;
}

export async function getObservation(db, countryId, indicatorId, year) {
  return (
    (await queryGet(
      db,
      'SELECT * FROM observations WHERE country_id = ? AND indicator_id = ? AND year = ?',
      [countryId, indicatorId, year],
    )) ?? null
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
export async function getEligibleObservations(db, indicatorId, year) {
  return queryAll(
    db,
    `
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
    `,
    [indicatorId, year],
  );
}

/** Eligible observations for one indicator across a year range. */
export async function getEligibleObservationsRange(db, indicatorId, startYear, endYear) {
  return queryAll(
    db,
    `
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
    `,
    [indicatorId, startYear, endYear],
  );
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
export async function getEligibleObservationsForYears(db, indicatorId, years) {
  const unique = [...new Set((years ?? []).filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  return queryAll(
    db,
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
    [indicatorId, ...unique],
  );
}

/**
 * Bulk economy metadata for a supplied ISO3 list.
 *
 * @param {object} db
 * @param {string[]} iso3List
 */
export async function getCountriesByIso3List(db, iso3List) {
  const unique = [...new Set((iso3List ?? []).map((s) => String(s).toUpperCase()))].sort();
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => '?').join(',');
  return queryAll(db, `SELECT * FROM countries WHERE id IN (${placeholders}) ORDER BY id`, unique);
}

/**
 * Vintage summary for one indicator across explicit years (eligible rows only).
 *
 * @returns {{lastUpdatedValues:string[], fetchedAtMin:string|null, fetchedAtMax:string|null, rowCount:number}|null}
 */
export async function getVintageForIndicatorYears(db, indicatorId, years) {
  const unique = [...new Set((years ?? []).filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const placeholders = unique.map(() => '?').join(',');
  const rows = await queryAll(
    db,
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
    [indicatorId, ...unique],
  );
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
export async function getDatasetFingerprint(db) {
  const lastSuccessAt = await getLastSuccessfulFetchTime(db);
  const maxRow = await queryGet(db, 'SELECT MAX(fetched_at) AS t FROM observations');
  const maxFetched = maxRow?.t ?? null;
  const observationCount = await countObservations(db);
  const latestRun = await getLatestFetchRun(db, { status: 'success' });
  return {
    lastSuccessAt,
    maxFetchedAt: maxFetched,
    observationCount,
    runId: latestRun?.id ?? null,
  };
}

/** Observations for one country across a year range (e.g. India's timeline). */
export async function getCountryObservationsRange(db, indicatorId, iso3, startYear, endYear) {
  return queryAll(
    db,
    `
      SELECT year, value, value_raw AS valueRaw
      FROM observations
      WHERE indicator_id = ? AND country_id = ? AND year BETWEEN ? AND ?
      ORDER BY year
    `,
    [indicatorId, String(iso3).toUpperCase(), startYear, endYear],
  );
}

/** How many eligible entities hold a valid value for indicator+year. */
export async function countEligibleObservations(db, indicatorId, year) {
  const row = await queryGet(
    db,
    `
      SELECT COUNT(*) AS n
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ?
        AND o.year = ?
        AND c.is_aggregate = 0
        AND o.value IS NOT NULL
    `,
    [indicatorId, year],
  );
  return row.n;
}

/**
 * Country ids holding a stored valid observation for one indicator, any
 * entity type (aggregates included — callers decide eligibility). One batched
 * query for entity-discovery `hasData` annotation; optional year narrows to
 * that year, otherwise any stored year counts.
 *
 * @returns {Set<string>} uppercase country ids
 */
export async function getObservedCountryIds(db, indicatorId, year = null) {
  const rows =
    year === null || year === undefined
      ? await queryAll(
          db,
          'SELECT DISTINCT country_id AS id FROM observations WHERE indicator_id = ? AND value IS NOT NULL',
          [indicatorId],
        )
      : await queryAll(
          db,
          'SELECT DISTINCT country_id AS id FROM observations WHERE indicator_id = ? AND year = ? AND value IS NOT NULL',
          [indicatorId, year],
        );
  return new Set(rows.map((r) => String(r.id).toUpperCase()));
}

/** Total stored observations, optionally for one indicator. */
export async function countObservations(db, indicatorId = null) {
  if (indicatorId === null) {
    const row = await queryGet(db, 'SELECT COUNT(*) AS n FROM observations');
    return row.n;
  }
  const row = await queryGet(db, 'SELECT COUNT(*) AS n FROM observations WHERE indicator_id = ?', [indicatorId]);
  return row.n;
}

/** Available year range for the whole database or one indicator (eligible observations only). */
export async function getYearRange(db, indicatorId = null) {
  const row =
    indicatorId === null
      ? await queryGet(
          db,
          `SELECT MIN(o.year) AS minYear, MAX(o.year) AS maxYear
              FROM observations o
              JOIN countries c ON c.id = o.country_id
              WHERE c.is_aggregate = 0`,
        )
      : await queryGet(
          db,
          `SELECT MIN(o.year) AS minYear, MAX(o.year) AS maxYear
              FROM observations o
              JOIN countries c ON c.id = o.country_id
              WHERE o.indicator_id = ? AND c.is_aggregate = 0`,
          [indicatorId],
        );
  return { minYear: row?.minYear ?? null, maxYear: row?.maxYear ?? null };
}

/** Distinct years holding at least one eligible observation, ascending. */
export async function listYearsWithData(db, indicatorId) {
  const rows = await queryAll(
    db,
    `
      SELECT DISTINCT o.year AS year
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      WHERE o.indicator_id = ? AND c.is_aggregate = 0 AND o.value IS NOT NULL
      ORDER BY o.year
    `,
    [indicatorId],
  );
  return rows.map((r) => r.year);
}

/**
 * Every year that holds at least one eligible observation for ANY metric, plus
 * the same list per metric.
 *
 * The year filter must be derived from the stored data (specification section 8),
 * never from a hardcoded 2000-2025 range, so a newer World Bank vintage becomes
 * selectable as soon as it has been ingested.
 *
 * Single-statement implementation: one GROUP BY over (metric, year) replaces
 * the historical 1 + N DISTINCT queries (global plus one per indicator) with
 * byte-identical semantics — same eligible-observation predicate, same
 * ascending year order, same per-metric key order (indicator-catalog order),
 * same null min/max on empty. See test/years.test.js for the equivalence
 * proof and backend/phase4-baseline notes for measured plans.
 */
export async function listAvailableYears(db) {
  const indicators = await listIndicators(db);
  const perMetric = {};
  for (const indicator of indicators) perMetric[indicator.metric_key] = [];

  const rows = await queryAll(
    db,
    `
      SELECT i.metric_key AS metric_key, o.year AS year
      FROM observations o
      JOIN countries c ON c.id = o.country_id
      JOIN indicators i ON i.id = o.indicator_id
      WHERE c.is_aggregate = 0 AND o.value IS NOT NULL
      GROUP BY i.metric_key, o.year
      ORDER BY i.metric_key, o.year
    `,
  );

  const yearSet = new Set();
  for (const row of rows) {
    if (Object.hasOwn(perMetric, row.metric_key)) perMetric[row.metric_key].push(row.year);
    yearSet.add(row.year);
  }
  const years = [...yearSet].sort((a, b) => a - b);

  return {
    years,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    perMetric,
  };
}

/**
 * Latest upstream World Bank vintage behind the stored dataset: the maximum
 * non-null `wb_last_updated` across observations (each row carries the WDI
 * `lastupdated` metadata from its own retrieval). Null when nothing stored.
 * Read-only derivation — no ingestion semantics involved.
 */
export async function getMaxWbLastUpdated(db) {
  const row = await queryGet(
    db,
    'SELECT MAX(wb_last_updated) AS v FROM observations WHERE wb_last_updated IS NOT NULL',
  );
  return row?.v ?? null;
}

/**
 * Country-level coverage for one indicator+year:
 *   eligible universe, valid observations, entities lacking an observation.
 */
export async function getCoverageCounts(db, indicatorId, year) {
  const eligible = await countEligibleCountries(db);
  const valid = await countEligibleObservations(db, indicatorId, year);
  return {
    eligibleUniverse: eligible,
    validObservations: valid,
    missingObservations: Math.max(0, eligible - valid),
  };
}

// ============================================================
// fetch_runs
// ============================================================

export async function startFetchRun(db, meta) {
  const rows = await queryAll(
    db,
    `
    INSERT INTO fetch_runs (
      started_at, status, trigger, endpoint, requested_start_year, requested_end_year,
      fetched_start_year, fetched_end_year, indicators
    ) VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `,
    [
      nowIso(),
      nz(meta.trigger),
      nz(meta.endpoint),
      nz(meta.requestedStartYear),
      nz(meta.requestedEndYear),
      nz(meta.fetchedStartYear),
      nz(meta.fetchedEndYear),
      nz(Array.isArray(meta.indicators) ? meta.indicators.join(',') : meta.indicators),
    ],
  );
  return Number(rows[0]?.id);
}

export async function finishFetchRun(db, id, patch) {
  await queryRun(
    db,
    `
    UPDATE fetch_runs SET
      completed_at            = ?,
      status                  = ?,
      wb_last_updated         = ?,
      countries_rows          = ?,
      rows_retrieved          = ?,
      rows_upserted           = ?,
      rows_null_skipped       = ?,
      rows_aggregate_excluded = ?,
      rows_aggregate_stored   = ?,
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
  `,
    [
      nowIso(),
      patch.status ?? 'success',
      nz(patch.wbLastUpdated),
      patch.countriesRows ?? 0,
      patch.rowsRetrieved ?? 0,
      patch.rowsUpserted ?? 0,
      patch.rowsNullSkipped ?? 0,
      patch.rowsAggregateExcluded ?? 0,
      patch.rowsAggregateStored ?? 0,
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
    ],
  );
}

/**
 * Persist the per-year ingest counters for a run (replacing any earlier attempt
 * for the same run/metric/year so a retried run cannot double count).
 * Transaction-free variant for use inside the atomic publish transaction.
 *
 * @param {object} db
 * @param {number} runId
 * @param {object[]} rows one entry per metric and year
 */
export async function upsertIngestYearStatsInner(db, runId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const statements = [];
  for (const row of rows) {
    if (row?.year === null || row?.year === undefined) continue;
    statements.push({
      sql: `
    INSERT INTO ingest_year_stats (
      fetch_run_id, metric_key, indicator_code, year,
      rows_received, rows_with_value, rows_written, rows_null_skipped,
      rows_non_finite_skipped, rows_invalid_year, rows_blank_iso3_skipped,
      rows_aggregate_excluded, rows_aggregate_stored, rows_unknown_country
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      rows_aggregate_stored   = excluded.rows_aggregate_stored,
      rows_unknown_country    = excluded.rows_unknown_country
  `,
      args: [
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
        row.rowsAggregateStored ?? 0,
        row.rowsUnknownCountry ?? 0,
      ],
    });
  }
  await batchRun(db, statements);
  return statements.length;
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
  return transaction(db, async (tx) => upsertIngestYearStatsInner(tx, runId, rows));
}

/**
 * Per-year ingest counters recorded for one metric.
 *
 * Ordering is deterministic: for a single year the LATEST fetch run comes
 * first (ORDER BY fetch_run_id DESC) so callers can take index [0] as the
 * latest applicable run. The multi-year form is ordered by year ascending
 * with the latest run first within each year, for the same reason.
 */
export async function getIngestYearStats(db, metricKey, options = {}) {
  if (options.year !== undefined && options.year !== null) {
    return (
      (await queryAll(
        db,
        'SELECT * FROM ingest_year_stats WHERE metric_key = ? AND year = ? ORDER BY fetch_run_id DESC',
        [metricKey, options.year],
      )) ?? []
    );
  }
  return queryAll(db, 'SELECT * FROM ingest_year_stats WHERE metric_key = ? ORDER BY year ASC, fetch_run_id DESC', [
    metricKey,
  ]);
}

/**
 * Latest recorded ingest counters for one metric and year (latest fetch run).
 * Returns null when the year was never ingested for that metric.
 *
 * NOTE: this returns counters from ANY run status, including failed/partial
 * attempts. It is suitable for audit history, but MUST NOT be used as current
 * authoritative coverage evidence — use getLatestSuccessfulIngestYearStat.
 */
export async function getLatestIngestYearStat(db, metricKey, year) {
  if (year === null || year === undefined) return null;
  return (await getIngestYearStats(db, metricKey, { year }))[0] ?? null;
}

/**
 * Latest ingest counters for one metric and year from the latest SUCCESSFULLY
 * PUBLISHED run only. Failed/partial runs remain visible in the audit trail
 * (getIngestYearStats / listFetchRuns) but can never masquerade as current
 * authoritative coverage evidence.
 * Returns null when no successful run ingested that metric/year.
 */
export async function getLatestSuccessfulIngestYearStat(db, metricKey, year) {
  if (year === null || year === undefined) return null;
  return (
    (await queryGet(
      db,
      `SELECT s.* FROM ingest_year_stats s
          JOIN fetch_runs r ON r.id = s.fetch_run_id
          WHERE s.metric_key = ? AND s.year = ? AND r.status = 'success'
          ORDER BY s.fetch_run_id DESC LIMIT 1`,
      [metricKey, year],
    )) ?? null
  );
}

/**
 * The universe snapshot recorded by the most recent successful run (eligible and
 * aggregate entity ids as fetched from the World Bank metadata).
 *
 * @returns {{runId:number, completedAt:string|null, snapshot:object}|null}
 */
export async function getLatestUniverseSnapshot(db, options = {}) {
  const excludeRunId = options.excludeRunId ?? null;
  const row = await queryGet(
    db,
    `SELECT id, completed_at, universe_snapshot
        FROM fetch_runs
        WHERE status = 'success' AND universe_snapshot IS NOT NULL AND id != ?
        ORDER BY id DESC LIMIT 1`,
    [excludeRunId ?? -1],
  );
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
export async function getUniverseSnapshotByRun(db, runId) {
  if (runId === null || runId === undefined) return null;
  const row = await queryGet(db, 'SELECT id, completed_at, universe_snapshot FROM fetch_runs WHERE id = ? LIMIT 1', [
    runId,
  ]);
  if (!row || !row.universe_snapshot) return null;
  return {
    runId: row.id,
    completedAt: row.completed_at ?? null,
    snapshot: JSON.parse(row.universe_snapshot),
  };
}

export async function getLatestFetchRun(db, { status = 'success' } = {}) {
  if (status) {
    return (
      (await queryGet(db, 'SELECT * FROM fetch_runs WHERE status = ? ORDER BY id DESC LIMIT 1', [status])) ?? null
    );
  }
  return (await queryGet(db, 'SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 1')) ?? null;
}

export async function listFetchRuns(db, limit = 20) {
  return queryAll(db, 'SELECT * FROM fetch_runs ORDER BY id DESC LIMIT ?', [limit]);
}

export async function getLastSuccessfulFetchTime(db) {
  const row = await queryGet(db, "SELECT MAX(completed_at) AS t FROM fetch_runs WHERE status = 'success'");
  return row?.t ?? null;
}

// ============================================================
// refresh_locks: SQLite-backed cross-process mutex (see schema.sql)
// ============================================================

/** Current lock row (always id = 1). */
export async function refreshLockStatus(db) {
  return (
    (await queryGet(
      db,
      'SELECT id, locked, run_id AS runId, holder, updated_at AS updatedAt FROM refresh_locks WHERE id = 1',
    )) ?? null
  );
}

/**
 * Atomically acquire the refresh lock. Returns true when this caller won it,
 * false when another holder owns it. Exactly one concurrent acquirer can win,
 * even across processes, because the UPDATE matches only when locked = 0.
 */
export async function acquireRefreshLock(db, { runId = null, holder = null } = {}) {
  const info = await queryRun(
    db,
    'UPDATE refresh_locks SET locked = 1, run_id = ?, holder = ?, updated_at = ? WHERE id = 1 AND locked = 0',
    [nz(runId), nz(holder), nowIso()],
  );
  return info.changes === 1;
}

/** Release the lock unconditionally (idempotent). Also clears the run association. */
export async function releaseRefreshLock(db) {
  await queryRun(db, 'UPDATE refresh_locks SET locked = 0, run_id = NULL, holder = NULL, updated_at = ? WHERE id = 1', [
    nowIso(),
  ]);
}

/**
 * Associate the held refresh lock with a fetch run id.
 * Called immediately after startFetchRun so the lock row always identifies
 * the active run. Must only be called while this caller holds the lock.
 */
export async function setRefreshLockRunId(db, runId) {
  await queryRun(db, 'UPDATE refresh_locks SET run_id = ?, updated_at = ? WHERE id = 1', [nz(runId), nowIso()]);
}

/**
 * Recover a stale lock (e.g. after a crash left locked = 1 with no live
 * holder). Releases it and returns the previous row for the audit trail.
 */
export async function forceReleaseRefreshLock(db, reason = null) {
  const previous = await refreshLockStatus(db);
  await releaseRefreshLock(db);
  return { previous, reason };
}

// ============================================================
// health / status helpers
// ============================================================

/** True when no observation has been ingested yet. */
export async function isDatabaseEmpty(db) {
  return (await countObservations(db)) === 0;
}

export { getDb } from './index.js';
export { transaction } from './driver.js';
export { regionParts };
export default { getDb };
