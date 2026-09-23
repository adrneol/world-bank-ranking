/**
 * DATA INTEGRITY CHECKS (specification section 27).
 *
 * Explicit backend checks that fail safely (reported, never silent):
 *   A. impossible null insertion (observations.value is NOT NULL)
 *   B. unexpected aggregate insertion (no observation for is_aggregate = 1)
 *   C. unknown ISO3 insertion (no orphan country_id)
 *   D. duplicate observation (PK uniqueness)
 *   E. invalid year (null or outside the plausible WDI range)
 *   F. non-finite value (NaN / Infinity must never be stored)
 *   G. incomplete API pagination (latest success run recorded pages/requests)
 *   H. registry consistency (stored indicators == the curated registry exactly:
 *      every configured metric present, with its exact configured World Bank
 *      code, and no unexpected indicator silently accepted)
 *   I. missing India observation (IND present for every ingested indicator)
 *   J. inconsistent country metadata (blank ids, blank ISO3 on eligible rows)
 *   K. metric registry self-consistency (unique metric keys, unique World Bank
 *      codes, every metric reachable from exactly one subject)
 *
 * check() returns a report; it never throws on a failed CHECK (only on a
 * broken database connection). Callers decide whether a failure blocks
 * startup/refresh or is logged as a warning.
 */

import { ALL_METRIC_KEYS, METRICS, assertRegistryIntegrity } from '../config.js';

const EXPECTED_CODES = Object.freeze(ALL_METRIC_KEYS.map((k) => METRICS[k].indicatorCode).sort());
const EXPECTED_METRIC_KEYS = Object.freeze([...ALL_METRIC_KEYS].sort());

function result(check, passed, detail = null) {
  return { check, status: passed ? 'pass' : 'fail', detail };
}

export function runIntegrityChecks(db) {
  const checks = [];

  // A. No NULL values could be inserted (schema is NOT NULL; belt and braces).
  const nullValues = db.prepare('SELECT COUNT(*) AS n FROM observations WHERE value IS NULL').get().n;
  checks.push(result('A.null_value', nullValues === 0, { nullRows: nullValues }));

  // B. No observation may belong to an aggregate entity.
  const aggregateRows = db
    .prepare(
      `SELECT COUNT(*) AS n FROM observations o
       JOIN countries c ON c.id = o.country_id
       WHERE c.is_aggregate = 1`,
    )
    .get().n;
  checks.push(result('B.aggregate_observation', aggregateRows === 0, { aggregateRows }));

  // C. No orphan ISO3 (foreign key + ingest filter guarantee this).
  const orphanRows = db
    .prepare(
      `SELECT COUNT(*) AS n FROM observations o
       LEFT JOIN countries c ON c.id = o.country_id
       WHERE c.id IS NULL`,
    )
    .get().n;
  checks.push(result('C.unknown_iso3', orphanRows === 0, { orphanRows }));

  // D. No duplicate (country, indicator, year) beyond the primary key.
  const duplicateGroups = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT country_id, indicator_id, year, COUNT(*) AS c
         FROM observations GROUP BY country_id, indicator_id, year HAVING c > 1
       )`,
    )
    .get().n;
  checks.push(result('D.duplicate_observation', duplicateGroups === 0, { duplicateGroups }));

  // E. Years must be plausible WDI years (World Bank series start in 1960).
  const thisYear = new Date().getFullYear();
  const invalidYears = db
    .prepare('SELECT COUNT(*) AS n FROM observations WHERE year IS NULL OR year < 1960 OR year > ?')
    .get(thisYear + 2).n;
  checks.push(result('E.invalid_year', invalidYears === 0, { invalidYears }));

  // F. Every stored value must be finite (NaN/Infinity rejected at ingest).
  const stored = db.prepare('SELECT value, value_raw FROM observations').all();
  let nonFinite = 0;
  let rawMismatch = 0;
  for (const row of stored) {
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      nonFinite += 1;
      continue;
    }
    // value_raw must round-trip to the stored numeric value when present.
    if (row.value_raw !== null && row.value_raw !== undefined) {
      if (Number(row.value_raw) !== row.value) rawMismatch += 1;
    }
  }
  checks.push(result('F.non_finite_value', nonFinite === 0, { nonFinite, checked: stored.length }));
  checks.push(
    result('F.raw_round_trip', rawMismatch === 0, { rawMismatch, checked: stored.length }),
  );

  // G. Latest successful run must record pagination/provenance counters.
  const latest = db
    .prepare("SELECT * FROM fetch_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1")
    .get();
  if (!latest) {
    checks.push(result('G.pagination_provenance', true, { note: 'no successful run yet (empty database)' }));
  } else {
    const ok =
      (latest.pages_fetched ?? 0) > 0 &&
      (latest.requests ?? 0) > 0 &&
      latest.universe_snapshot !== null;
    checks.push(
      result('G.pagination_provenance', ok, {
        runId: latest.id,
        pagesFetched: latest.pages_fetched,
        requests: latest.requests,
        hasUniverseSnapshot: latest.universe_snapshot !== null,
      }),
    );
  }

  // H. Registry consistency: the stored indicators must be EXACTLY the curated
  // registry — every configured metric present, with its exact configured World
  // Bank code and metric key, and no unexpected indicator accepted. An empty
  // database passes vacuously (nothing ingested yet); a partially ingested
  // database fails loudly instead of silently ranking a subset of the subjects.
  // Generalized from the historical "exactly four indicators" rule: it is not
  // weaker, it is registry-driven (it fails on any missing OR extra series).
  const storedIndicators = db.prepare('SELECT code, metric_key FROM indicators').all();
  const codes = storedIndicators.map((r) => r.code).sort();
  const storedMetricKeys = storedIndicators.map((r) => r.metric_key).sort();
  const hPassed =
    storedIndicators.length === 0 ||
    (codes.length === EXPECTED_CODES.length &&
      JSON.stringify(codes) === JSON.stringify(EXPECTED_CODES) &&
      JSON.stringify(storedMetricKeys) === JSON.stringify(EXPECTED_METRIC_KEYS));
  checks.push(
    result('H.registry_indicators', hPassed, {
      found: codes,
      foundMetricKeys: storedMetricKeys,
      expected: [...EXPECTED_CODES],
      expectedMetricKeys: [...EXPECTED_METRIC_KEYS],
      note:
        storedIndicators.length === 0
          ? 'empty database: indicators not ingested yet'
          : storedIndicators.length !== EXPECTED_CODES.length
            ? `pending ingest: ${storedIndicators.length} of ${EXPECTED_CODES.length} configured indicators stored; run a refresh`
            : null,
    }),
  );

  // I. India must hold observations for every ingested indicator.
  const indicatorIds = db.prepare('SELECT id, metric_key FROM indicators').all();
  const missingIndia = [];
  for (const indicator of indicatorIds) {
    const n = db
      .prepare('SELECT COUNT(*) AS n FROM observations WHERE country_id = ? AND indicator_id = ?')
      .get('IND', indicator.id).n;
    if (n === 0) missingIndia.push(indicator.metric_key);
  }
  checks.push(
    result('I.india_observations', indicatorIds.length === 0 || missingIndia.length === 0, {
      missingIndia,
    }),
  );

  // J. Metadata consistency: no blank ids; eligible rows carry non-blank ISO3.
  const blankIds = db
    .prepare("SELECT COUNT(*) AS n FROM countries WHERE id IS NULL OR TRIM(id) = ''")
    .get().n;
  const eligibleBlankIso = db
    .prepare("SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 0 AND (iso3 IS NULL OR TRIM(iso3) = '')")
    .get().n;
  checks.push(
    result('J.metadata_consistency', blankIds === 0 && eligibleBlankIso === 0, {
      blankIds,
      eligibleBlankIso,
    }),
  );

  // K. Registry self-consistency: unique metric keys, unique World Bank codes,
  // and every metric reachable from exactly one subject. config.js asserts this
  // at import time; reporting it here makes a broken registry visible through
  // the API instead of only at boot.
  let registryError = null;
  try {
    assertRegistryIntegrity();
  } catch (error) {
    registryError = error.message;
  }
  checks.push(
    result('K.registry_consistency', registryError === null, {
      error: registryError,
      metrics: ALL_METRIC_KEYS.length,
    }),
  );

  return { passed: checks.every((c) => c.status === 'pass'), checks };
}

export default { runIntegrityChecks };
