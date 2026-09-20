/**
 * Repository layer: every SQL statement in the application lives here.
 *
 * Domain modules (ranking, YoY, coverage) never write SQL. They receive plain
 * JavaScript objects, which keeps the numerical logic independently testable
 * and makes the storage engine replaceable.
 *
 * Raw World Bank values are passed through as SQLite REAL with no rounding.
 */

import { getDb, transaction } from './index.js';

const nowIso = () => new Date().toISOString();

/** Null out undefined so bound parameters stay valid. */
const nz = (v) => (v === undefined ? null : v);

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
 * The value is stored exactly as received from the World Bank.
 */
export function upsertObservation(db, { countryId, indicatorId, year, value, wbLastUpdated }) {
  db.prepare(`
    INSERT INTO observations (country_id, indicator_id, year, value, wb_last_updated, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(country_id, indicator_id, year) DO UPDATE SET
      value           = excluded.value,
      wb_last_updated = excluded.wb_last_updated,
      fetched_at      = excluded.fetched_at
  `).run(countryId, indicatorId, year, value, nz(wbLastUpdated), nowIso());
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
 *
 * @returns {{iso3:string, name:string, value:number}[]}
 */
export function getEligibleObservations(db, indicatorId, year) {
  return db
    .prepare(`
      SELECT o.country_id AS iso3,
             c.name       AS name,
             o.value      AS value
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
             o.value      AS value
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

/** Observations for one country across a year range (e.g. India's timeline). */
export function getCountryObservationsRange(db, indicatorId, iso3, startYear, endYear) {
  return db
    .prepare(`
      SELECT year, value
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
    nz(patch.errorMessage),
    id,
  );
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
// health / status helpers
// ============================================================

/** True when no observation has been ingested yet. */
export function isDatabaseEmpty(db) {
  return countObservations(db) === 0;
}

export { getDb, transaction, regionParts };
export default { getDb };