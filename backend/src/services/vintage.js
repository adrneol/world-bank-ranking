/**
 * VINTAGE / CONSISTENCY EVIDENCE (comparison support).
 *
 * Read-only helpers that describe WHICH retrieval generation a comparison was
 * computed from. No ranking, no comparison math, no writes.
 *
 * The two-year comparison must be internally coherent: both sides come from
 * one repository read (getEligibleObservationsForYears), and this module
 * reports whether the rows share a single World Bank vintage or are mixed.
 */

import {
  countObservations,
  getDatasetFingerprint,
  getLatestFetchRun,
  getLatestIngestYearStat,
  getLastSuccessfulFetchTime,
  getVintageForIndicatorYears,
} from '../db/repository.js';
import { getCacheStatus } from '../wb/ingest.js';

/**
 * Build the vintage/evidence block for one indicator and two years,
 * or three years when a point breaker is active.
 *
 * All inputs are already-validated integers; missing stats are represented
 * explicitly rather than invented. When yearMid is absent the return shape is
 * identical to the original two-year version.
 *
 * @param {object} db
 * @param {{metricKey:string, indicatorId:number, yearA:number, yearB:number, yearMid?:number|null}} options
 */
export function buildComparisonVintage(db, { metricKey, indicatorId, yearA, yearB, yearMid = null }) {
  const statA = getLatestIngestYearStat(db, metricKey, yearA);
  const statB = getLatestIngestYearStat(db, metricKey, yearB);
  const hasMid = Number.isInteger(yearMid);
  const statMid = hasMid ? getLatestIngestYearStat(db, metricKey, yearMid) : null;
  const vintageYears = hasMid ? [yearA, yearMid, yearB] : [yearA, yearB];
  const vintageRows = getVintageForIndicatorYears(db, indicatorId, vintageYears);
  const cache = getCacheStatus(db);
  const fingerprint = getDatasetFingerprint(db);
  const lastRun = getLatestFetchRun(db, { status: null });

  const lastUpdatedValues = vintageRows?.lastUpdatedValues ?? [];
  const distinctVintages = [...new Set(lastUpdatedValues.filter((v) => v !== null))];
  const wbLastUpdated = distinctVintages.length === 1 ? distinctVintages[0] : null;
  const mixedVintage = distinctVintages.length > 1;

  const perYear = {
    a: statA
      ? {
          fetchRunId: statA.fetch_run_id ?? null,
          indicatorCode: statA.indicator_code ?? null,
          rowsReceived: statA.rows_received ?? 0,
          rowsWithValue: statA.rows_with_value ?? 0,
          rowsWritten: statA.rows_written ?? 0,
          rowsNullSkipped: statA.rows_null_skipped ?? 0,
          rowsAggregateExcluded: statA.rows_aggregate_excluded ?? 0,
          rowsBlankIso3Skipped: statA.rows_blank_iso3_skipped ?? 0,
          rowsUnknownCountry: statA.rows_unknown_country ?? 0,
        }
      : null,
    b: statB
      ? {
          fetchRunId: statB.fetch_run_id ?? null,
          indicatorCode: statB.indicator_code ?? null,
          rowsReceived: statB.rows_received ?? 0,
          rowsWithValue: statB.rows_with_value ?? 0,
          rowsWritten: statB.rows_written ?? 0,
          rowsNullSkipped: statB.rows_null_skipped ?? 0,
          rowsAggregateExcluded: statB.rows_aggregate_excluded ?? 0,
          rowsBlankIso3Skipped: statB.rows_blank_iso3_skipped ?? 0,
          rowsUnknownCountry: statB.rows_unknown_country ?? 0,
        }
      : null,
  };
  if (hasMid) {
    perYear.mid = statMid
      ? {
          fetchRunId: statMid.fetch_run_id ?? null,
          indicatorCode: statMid.indicator_code ?? null,
          rowsReceived: statMid.rows_received ?? 0,
          rowsWithValue: statMid.rows_with_value ?? 0,
          rowsWritten: statMid.rows_written ?? 0,
          rowsNullSkipped: statMid.rows_null_skipped ?? 0,
          rowsAggregateExcluded: statMid.rows_aggregate_excluded ?? 0,
          rowsBlankIso3Skipped: statMid.rows_blank_iso3_skipped ?? 0,
          rowsUnknownCountry: statMid.rows_unknown_country ?? 0,
        }
      : null;
  }

  return {
    vintage: {
      wbLastUpdated,
      mixedVintage,
      lastUpdatedValues,
      note: mixedVintage
        ? 'The rows used span more than one World Bank vintage; interpret the comparison with caution.'
        : 'All rows used share one World Bank vintage.',
    },
    retrieval: {
      lastSuccessAt: getLastSuccessfulFetchTime(db),
      runIdA: statA?.fetch_run_id ?? null,
      runIdB: statB?.fetch_run_id ?? null,
      ...(hasMid ? { runIdMid: statMid?.fetch_run_id ?? null } : {}),
      fetchedAtMin: vintageRows?.fetchedAtMin ?? null,
      fetchedAtMax: vintageRows?.fetchedAtMax ?? null,
    },
    freshness: {
      fresh: Boolean(cache.fresh),
      ageHours: cache.ageHours ?? null,
      ttlHours: cache.ttlHours ?? null,
      refreshDue: Boolean(cache.refreshDue),
      lastRunStatus: lastRun?.status ?? null,
    },
    fingerprint: {
      lastSuccessAt: fingerprint.lastSuccessAt,
      maxFetchedAt: fingerprint.maxFetchedAt,
      observationCount: fingerprint.observationCount ?? countObservations(db),
      runId: fingerprint.runId,
    },
    perYear,
  };
}

export default { buildComparisonVintage };
