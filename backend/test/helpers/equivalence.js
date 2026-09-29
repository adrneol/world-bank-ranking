/**
 * DATASET EQUIVALENCE HARNESS (Phase 6C-2).
 *
 * Compares two independently ingested databases for EXACT equivalence:
 * canonical ordered dumps hashed with SHA-256, plus a fixed analytical
 * output matrix. Only intentionally runtime-specific fields are normalized
 * (fetch/completion timestamps); every analytical/data value — including
 * upstream vintages, decimals, run ids and generation metadata — compares
 * exactly. A single differing row, value, decimal, year, country, vintage
 * or generation field fails the comparison.
 *
 * Used to prove (a) the current pipeline is deterministic against itself
 * (self-proof gate before any optimization), and (b) each optimized
 * pipeline produces a byte-equivalent dataset and identical analytics.
 */

import crypto from 'node:crypto';
import { queryAll } from '../../src/db/driver.js';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** Runtime timestamps vary run to run; upstream date-only vintages must not. */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function normalizeTimestamps(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATETIME_RE.test(trimmed)) return '<TS>';
    // Embedded JSON documents (e.g. universe_snapshot) carry their own
    // timestamps; normalize inside them rather than hashing raw text.
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return normalizeTimestamps(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalizeTimestamps(value[key]);
    return out;
  }
  return value;
}

function digestRows(rows) {
  return sha256(JSON.stringify(rows));
}

/**
 * Canonical dataset digest: ordered dumps of every data table.
 * Timestamps from the refresh event itself are normalized; everything else
 * (values, decimals, vintages, counters, snapshots, run ids, statuses)
 * hashes exactly.
 */
export async function canonicalDatasetDigest(db) {
  const observations = await queryAll(
    db,
    `SELECT country_id, indicator_id, year, value, value_raw, wb_last_updated
     FROM observations ORDER BY country_id, indicator_id, year`,
  );
  const countries = await queryAll(
    db,
    `SELECT id, iso2, iso3, name, region, region_id, admin_region, income_level,
            lending_type, capital_city, is_aggregate, aggregate_reason
     FROM countries ORDER BY id`,
  );
  const indicators = await queryAll(
    db,
    `SELECT code, metric_key, name, unit, source, source_note
     FROM indicators ORDER BY id`,
  );
  const stats = await queryAll(
    db,
    `SELECT fetch_run_id, metric_key, indicator_code, year, rows_received,
            rows_with_value, rows_written, rows_null_skipped,
            rows_non_finite_skipped, rows_invalid_year, rows_blank_iso3_skipped,
            rows_aggregate_excluded, rows_aggregate_stored, rows_unknown_country
     FROM ingest_year_stats ORDER BY fetch_run_id, metric_key, year`,
  );
  const runsRaw = await queryAll(
    db,
    `SELECT trigger, endpoint, requested_start_year, requested_end_year,
            fetched_start_year, fetched_end_year, indicators, status,
            wb_last_updated, countries_rows, rows_retrieved, rows_upserted,
            rows_null_skipped, rows_aggregate_excluded, rows_aggregate_stored,
            rows_blank_iso3_skipped, rows_unknown_country, rows_with_value,
            rows_non_finite_skipped, rows_invalid_year, pages_fetched, requests,
            universe_snapshot, error_message
     FROM fetch_runs ORDER BY id`,
  );
  const tables = {
    observations: digestRows(observations),
    countries: digestRows(countries),
    indicators: digestRows(indicators),
    ingest_year_stats: digestRows(stats),
    fetch_runs: digestRows(normalizeTimestamps(runsRaw)),
  };
  return {
    tables,
    combined: sha256(Object.entries(tables).map(([k, v]) => `${k}:${v}`).join('\n')),
    counts: {
      observations: observations.length,
      countries: countries.length,
      indicators: indicators.length,
      stats: stats.length,
      runs: runsRaw.length,
    },
  };
}

/**
 * Fixed analytical output matrix over one database. Responses are timestamp-
 * normalized (retrieval/fingerprint times) but vintages, values, ranks and
 * reason codes compare exactly.
 */
export async function analyticalSnapshot(db) {
  const [
    { buildFullRanking },
    { buildYoyVerification },
    { buildLevelComparisonResponse },
    { buildCompareResponse },
    { buildCoveragePanel },
    { buildCapitalMovement },
    { getCachedAvailableYears },
    { getMaxWbLastUpdated },
    { getDatasetFingerprint },
  ] = await Promise.all([
    import('../../src/services/fullRanking.js'),
    import('../../src/services/yoyVerification.js'),
    import('../../src/services/comparisonService.js'),
    import('../../src/services/entityCompare.js'),
    import('../../src/services/coverageService.js'),
    import('../../src/services/capitalMovementService.js'),
    import('../../src/services/yearsCache.js'),
    import('../../src/db/repository.js'),
    import('../../src/db/repository.js'),
  ]);
  const outputs = {
    years: await getCachedAvailableYears(db),
    ranking: await buildFullRanking(db, { metricKey: 'nominal_current', year: 2025, pageSize: 50 }),
    yoyVerify: await buildYoyVerification(db, { metricKey: 'nominal_current', year: 2025, neighbors: 2 }),
    comparison: await buildLevelComparisonResponse(db, {
      metricKey: 'nominal_current', yearA: 2024, yearB: 2025, focusIso3: 'USA', detail: 'full',
    }),
    movement: await buildCapitalMovement(db, {
      metricKey: 'fdi_inflows', basis: 'fdi_annual_value', yearA: 2024, yearB: 2025, focusIso3: 'USA',
    }),
    compare: await buildCompareResponse(db, {
      entityA: 'country:USA', entityB: 'country:CHN', metricKey: 'total_current', yearA: 2024, yearB: 2025, operation: 'level',
    }),
    coverage: await buildCoveragePanel(db, { year: 2025 }),
    vintage: await getMaxWbLastUpdated(db),
    fingerprint: await getDatasetFingerprint(db),
  };
  return normalizeTimestamps(outputs);
}

export function digestSnapshot(snapshot) {
  return sha256(JSON.stringify(snapshot));
}

/**
 * Wall-clock-derived cache age is inherently call-time dependent (it embeds
 * Date.now()), so it cannot participate in cross-run equivalence. Freshness
 * *state* (fresh/refreshDue booleans, derived from stored timestamps) still
 * compares exactly; the exact age boundary is pinned separately by the TTL
 * boundary test with an injected clock.
 */
export function stripVolatileAge(snapshot) {
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const out = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'ageHours') continue;
        out[key] = walk(entry);
      }
      return out;
    }
    return value;
  };
  return walk(snapshot);
}
