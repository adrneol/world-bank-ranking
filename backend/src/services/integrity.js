/**
 * DATA INTEGRITY CHECKS (specification section 27).
 *
 * Explicit backend checks that fail safely (reported, never silent):
 *   A. impossible null insertion (observations.value is NOT NULL)
 *   B. aggregate typing consistency (stored aggregate observations reference
 *      aggregate-flagged metadata exactly as the latest successful run's
 *      universe snapshot recorded it; the ranking universe stays
 *      eligible-only by query construction, proven by ranking tests)
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
 *
 * Phase 6A: async over the shared driver (Turso primary, local fallback).
 * Check semantics are unchanged.
 */

import { ALL_METRIC_KEYS, METRICS, PRODUCTION_METRIC_KEYS, assertRegistryIntegrity } from '../config.js';
import { batchGet, queryAll, queryGet } from '../db/driver.js';

const EXPECTED_CODES = Object.freeze(PRODUCTION_METRIC_KEYS.map((k) => METRICS[k].indicatorCode).sort());
const EXPECTED_METRIC_KEYS = Object.freeze([...PRODUCTION_METRIC_KEYS].sort());

function result(check, passed, detail = null) {
  return { check, status: passed ? 'pass' : 'fail', detail };
}

/**
 * CHEAP battery (Phase 7B): checks whose reads are bounded to small tables
 * and short index probes (A null-constraint, B aggregate typing + snapshot,
 * G run provenance, H registry, I India presence, J metadata, K registry
 * self-check). Safe to run per success run; merged with the expensive
 * battery for the full report.
 */
export async function runCheapIntegrityChecks(db) {
  const checks = [];

  // Phase 7D-4: the four independent reads share one round trip; all
  // check-building logic below is unchanged.
  const [[nullRow], [aggRow], [latestSnapshotRow], flagRows] = await batchGet(db, [
    { sql: 'SELECT COUNT(*) AS n FROM observations WHERE value IS NULL' },
    {
      sql: `SELECT COUNT(*) AS n FROM observations o
       JOIN countries c ON c.id = o.country_id
       WHERE c.is_aggregate = 1`,
    },
    {
      sql: "SELECT universe_snapshot FROM fetch_runs WHERE status = 'success' AND universe_snapshot IS NOT NULL ORDER BY id DESC LIMIT 1",
    },
    { sql: 'SELECT id, is_aggregate FROM countries' },
  ]);

  // A. No NULL values could be inserted (schema is NOT NULL; belt and braces).
  const nullValues = nullRow?.n ?? 0;
  checks.push(result('A.null_value', nullValues === 0, { nullRows: nullValues }));

  // B. Aggregate typing consistency (Phase 5 stores official World Bank
  // aggregate observations, typed by countries.is_aggregate, never ranked).
  // Proves current metadata flags match the latest successful run's universe
  // snapshot: a flipped flag would silently move rows into or out of every
  // ranking universe. Aggregate/eligible row counts ride along as facts.
  // NOTE: the flags list is fetched unconditionally (1 batched read) and
  // only consumed when a comparable snapshot exists — identical outcomes,
  // one fewer round trip on the common path.
  const aggregateRows = aggRow?.n ?? 0;
  let typingMismatches = [];
  let snapshotComparable = false;
  if (latestSnapshotRow?.universe_snapshot) {
    try {
      const snapshot = JSON.parse(latestSnapshotRow.universe_snapshot);
      const eligibleIds = new Set(snapshot.eligibleIds ?? []);
      const aggregateIds = new Set(snapshot.aggregateIds ?? []);
      if (eligibleIds.size > 0 || aggregateIds.size > 0) {
        snapshotComparable = true;
        const flags = flagRows;
        for (const row of flags) {
          const inEligible = eligibleIds.has(row.id);
          const inAggregate = aggregateIds.has(row.id);
          if (!inEligible && !inAggregate) continue; // newer than the snapshot: nothing to judge
          const shouldBeAggregate = inAggregate && !inEligible;
          if ((row.is_aggregate === 1) !== shouldBeAggregate) {
            typingMismatches.push(row.id);
          }
        }
      }
    } catch {
      snapshotComparable = false;
    }
  }
  checks.push(
    result('B.aggregate_typing', typingMismatches.length === 0, {
      aggregateRows,
      mismatches: typingMismatches.slice(0, 20),
      mismatchCount: typingMismatches.length,
      snapshotComparable,
      note: snapshotComparable
        ? 'current is_aggregate flags vs latest successful run snapshot'
        : 'no comparable universe snapshot yet; typing unchecked',
    }),
  );

  return checks;
}

/**
 * EXPENSIVE battery (Phase 7B): full observation-table scans (C orphans,
 * D duplicates, E years, F/O8 value scan + completeness COUNT). Required
 * when explicitly requested and when the observation content generation is
 * new; memoized by content_version otherwise. Never weakened: O8 keeps its
 * `checked === COUNT(*)` gate.
 */
export async function runExpensiveIntegrityChecks(db) {
  const checks = [];

  // C. No orphan ISO3 (foreign key + ingest filter guarantee this).
  const orphanRows = (
    await queryGet(
      db,
      `SELECT COUNT(*) AS n FROM observations o
       LEFT JOIN countries c ON c.id = o.country_id
       WHERE c.id IS NULL`,
    )
  ).n;
  checks.push(result('C.unknown_iso3', orphanRows === 0, { orphanRows }));

  // D. No duplicate (country, indicator, year) beyond the primary key.
  const duplicateGroups = (
    await queryGet(
      db,
      `SELECT COUNT(*) AS n FROM (
         SELECT country_id, indicator_id, year, COUNT(*) AS c
         FROM observations GROUP BY country_id, indicator_id, year HAVING c > 1
       )`,
    )
  ).n;
  checks.push(result('D.duplicate_observation', duplicateGroups === 0, { duplicateGroups }));

  // E. Years must be plausible WDI years (World Bank series start in 1960).
  const thisYear = new Date().getFullYear();
  const invalidYears = (
    await queryGet(db, 'SELECT COUNT(*) AS n FROM observations WHERE year IS NULL OR year < 1960 OR year > ?', [
      thisYear + 2,
    ])
  ).n;
  checks.push(result('E.invalid_year', invalidYears === 0, { invalidYears }));

  // F. Every stored value must be finite (NaN/Infinity rejected at ingest).
  // Phase 6C O8: streamed in rowid-ordered batches (never a full-table array),
  // so the check holds a bounded chunk plus three counters regardless of
  // dataset size. Deterministic and exact: batches tile the table with no
  // gaps and no overlap (rowid > lastSeen is monotonic under concurrent
  // inserts only for HIGHER rowids, which a later batch still visits; a
  // concurrent successful publish replaces the dataset and advances the
  // integrity memo key, so a mixed-generation scan cannot be mistaken for
  // the published generation). Completeness: the loop ends only on a
  // short/empty batch, and `checked` must equal COUNT(*) afterwards —
  // otherwise the scan is reported, not silently trusted.
  const O8_BATCH = 20000;
  let nonFinite = 0;
  let rawMismatch = 0;
  let checked = 0;
  let lastRowid = 0;
  for (;;) {
    const chunk = await queryAll(
      db,
      'SELECT rowid AS rowid, value, value_raw FROM observations WHERE rowid > ? ORDER BY rowid LIMIT ?',
      [lastRowid, O8_BATCH],
    );
    if (chunk.length === 0) break;
    for (const row of chunk) {
      if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
        nonFinite += 1;
        continue;
      }
      // value_raw must round-trip to the stored numeric value when present.
      if (row.value_raw !== null && row.value_raw !== undefined) {
        if (Number(row.value_raw) !== row.value) rawMismatch += 1;
      }
    }
    checked += chunk.length;
    lastRowid = chunk[chunk.length - 1].rowid;
    if (chunk.length < O8_BATCH) break;
  }
  const totalObservations = (await queryGet(db, 'SELECT COUNT(*) AS n FROM observations')).n;
  const scanComplete = checked === totalObservations;
  checks.push(
    result('F.non_finite_value', scanComplete && nonFinite === 0, {
      nonFinite,
      checked,
      total: totalObservations,
      scanComplete,
      batched: true,
    }),
  );
  checks.push(
    result('F.raw_round_trip', scanComplete && rawMismatch === 0, {
      rawMismatch,
      checked,
      total: totalObservations,
      scanComplete,
      batched: true,
    }),
  );

  return checks;
}

/**
 * RUN/METADATA battery (Phase 7B): checks over fetch_runs, indicators,
 * countries and the registry (G provenance, H registry, I India, J
 * metadata, K self-consistency). Small-table reads; runs with the cheap
 * battery per success run.
 */
export async function runMetadataIntegrityChecks(db) {
  const checks = [];

  // Phase 7D-4: the independent singles share one round trip; the
  // per-indicator counts share a second. All check-building logic below is
  // unchanged (same values, same order, same details).
  const [[latestRow], storedIndicators, indicatorIds, [blankIdsRow], [eligibleBlankRow]] = await batchGet(db, [
    { sql: "SELECT * FROM fetch_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1" },
    { sql: 'SELECT code, metric_key FROM indicators' },
    { sql: 'SELECT id, metric_key FROM indicators' },
    { sql: "SELECT COUNT(*) AS n FROM countries WHERE id IS NULL OR TRIM(id) = ''" },
    { sql: "SELECT COUNT(*) AS n FROM countries WHERE is_aggregate = 0 AND (iso3 IS NULL OR TRIM(iso3) = '')" },
  ]);
  const latest = latestRow ?? null;

  // G. Latest successful run must record pagination/provenance counters.
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
  // One batched round trip for all per-indicator counts (same values).
  const missingIndia = [];
  if (indicatorIds.length > 0) {
    const countRows = await batchGet(
      db,
      indicatorIds.map((indicator) => ({
        sql: 'SELECT COUNT(*) AS n FROM observations WHERE country_id = ? AND indicator_id = ?',
        args: ['IND', indicator.id],
      })),
    );
    indicatorIds.forEach((indicator, index) => {
      if ((countRows[index]?.[0]?.n ?? 0) === 0) missingIndia.push(indicator.metric_key);
    });
  }
  checks.push(
    result('I.india_observations', indicatorIds.length === 0 || missingIndia.length === 0, {
      missingIndia,
    }),
  );

  // J. Metadata consistency: no blank ids; eligible rows carry non-blank ISO3.
  const blankIds = blankIdsRow?.n ?? 0;
  const eligibleBlankIso = eligibleBlankRow?.n ?? 0;
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

  return checks;
}

/** Canonical check order (data-status merges memoized batteries into this shape). */
export const INTEGRITY_CHECK_ORDER = Object.freeze([
  'A.null_value',
  'B.aggregate_typing',
  'C.unknown_iso3',
  'D.duplicate_observation',
  'E.invalid_year',
  'F.non_finite_value',
  'F.raw_round_trip',
  'G.pagination_provenance',
  'H.registry_indicators',
  'I.india_observations',
  'J.metadata_consistency',
  'K.registry_consistency',
]);

/**
 * Merge check arrays into canonical order (duplicates resolve last-wins;
 * unknown names append after the known order so no check is ever dropped).
 */
export function mergeIntegrityChecks(...parts) {
  const byName = new Map();
  for (const part of parts) {
    for (const check of part ?? []) byName.set(check.check, check);
  }
  const ordered = [];
  for (const name of INTEGRITY_CHECK_ORDER) {
    if (byName.has(name)) {
      ordered.push(byName.get(name));
      byName.delete(name);
    }
  }
  for (const check of byName.values()) ordered.push(check);
  return ordered;
}

/** Full report: all batteries in canonical order (byte-shape unchanged). */
export async function runIntegrityChecks(db) {
  const checks = mergeIntegrityChecks(
    await runCheapIntegrityChecks(db),
    await runExpensiveIntegrityChecks(db),
    await runMetadataIntegrityChecks(db),
  );
  return { passed: checks.every((c) => c.status === 'pass'), checks };
}

export default { runIntegrityChecks };
