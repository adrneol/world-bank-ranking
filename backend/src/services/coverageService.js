/**
 * COVERAGE SERVICE (specification sections 6, 7 and 22).
 *
 * Three responsibilities, all built from stored data:
 *   1. the per-metric coverage panel for a selected year (section 7)
 *   2. the YoY coverage block: eligible universe, current/previous valid
 *      observations, valid YoY pairs and the focus country's availability
 *      (section 22)
 *   3. the "Why does the total change?" explanation between two years, in the
 *      specification's CASE A/B/C/D form, with FACTS ONLY (section 6)
 */

import { FOCUS_COUNTRY, METRICS, METRIC_KEYS } from '../config.js';
import {
  countEligibleCountries,
  countEligibleObservations,
  getEligibleObservations,
  getIndicatorByMetricKey,
  getLatestIngestYearStat,
  getUniverseSnapshotByRun,
  getYearRange,
  listAvailableYears,
} from '../db/repository.js';
import { buildYoyCoverage, explainCoverageChange, summarizeCoverage } from '../domain/coverage.js';
import { describeMetric } from '../domain/format.js';
import { rankByValue } from '../domain/ranking.js';
import { sourceAttribution } from './attribution.js';

/** Coverage counters for one metric and year, from stored observations only. */
export function coverageForMetricYear(db, indicatorId, year, eligibleUniverse) {
  return summarizeCoverage({
    eligibleUniverse,
    validObservations: countEligibleObservations(db, indicatorId, year),
  });
}

/**
 * Coverage panel (section 7): one entry per metric for the selected year.
 *
 * @param {object} db
 * @param {{year?:number, metricKeys?:string[], focusIso3?:string}} [options]
 */
export function buildCoveragePanel(db, options = {}) {
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const metricKeys = options.metricKeys ?? METRIC_KEYS;
  const available = listAvailableYears(db);
  const eligibleUniverse = countEligibleCountries(db);
  const year = options.year ?? available.maxYear;

  const metrics = metricKeys.map((metricKey) => {
    const metric = METRICS[metricKey];
    const indicator = getIndicatorByMetricKey(db, metricKey);
    if (!indicator || year === null) {
      return {
        metric: describeMetric(metric),
        year,
        available: false,
        reason: indicator ? 'no_stored_data' : 'metric_not_ingested',
        eligibleUniverse,
        validObservations: 0,
        missingObservations: eligibleUniverse,
        focus: { iso3: focusIso3, available: false, rank: null, total: 0 },
      };
    }

    const coverage = coverageForMetricYear(db, indicator.id, year, eligibleUniverse);
    const { ranked } = rankByValue(getEligibleObservations(db, indicator.id, year));
    const focusRow = ranked.find((row) => row.iso3 === focusIso3) ?? null;

    return {
      metric: describeMetric(metric),
      year,
      available: coverage.validObservations > 0,
      reason: null,
      eligibleUniverse: coverage.eligibleUniverse,
      validObservations: coverage.validObservations,
      missingObservations: coverage.missingObservations,
      focus: {
        iso3: focusIso3,
        available: Boolean(focusRow),
        rank: focusRow ? focusRow.rank : null,
        total: coverage.validObservations,
      },
      // Explicit reminder of what the two numbers mean (specification section 5).
      meanings: {
        eligibleUniverse:
          'Eligible World Bank country/economy metadata entities: those the universe rule does not classify as aggregates.',
        validObservations:
          'Ranking denominator: eligible entities holding a valid World Bank observation for this metric and year.',
      },
    };
  });

  return {
    year,
    minYear: available.minYear,
    maxYear: available.maxYear,
    availableYears: available.years,
    eligibleUniverse,
    metrics,
    source: sourceAttribution(),
  };
}

/**
 * YoY coverage for every metric at the selected year (section 22).
 *
 * The YoY denominator is reported separately from the level denominator: the two
 * can only ever be equal by coincidence.
 */
export function buildYoyCoveragePanel(db, options = {}) {
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const metricKeys = options.metricKeys ?? METRIC_KEYS;
  const eligibleUniverse = countEligibleCountries(db);

  const metrics = metricKeys.map((metricKey) => {
    const metric = METRICS[metricKey];
    const indicator = getIndicatorByMetricKey(db, metricKey);
    if (!indicator) {
      return {
        metric: describeMetric(metric),
        available: false,
        reason: 'metric_not_ingested',
        year: options.year ?? null,
      };
    }

    const year = options.year ?? getYearRange(db, indicator.id).maxYear;
    if (year === null || year === undefined) {
      return {
        metric: describeMetric(metric),
        available: false,
        reason: 'no_stored_data',
        year: null,
      };
    }

    const coverage = buildYoyCoverage({
      metricKey,
      year,
      eligibleUniverse,
      currentRows: getEligibleObservations(db, indicator.id, year),
      previousRows: getEligibleObservations(db, indicator.id, year - 1),
      focusIso3,
    });

    return {
      metric: describeMetric(metric),
      available: coverage.currentValidObservations > 0,
      reason: null,
      ...coverage,
    };
  });

  return {
    year: options.year ?? null,
    eligibleUniverse,
    metrics,
    source: sourceAttribution(),
  };
}

/**
 * Compare the eligible metadata universe between the runs that produced two years'
 * data. Returns comparable=false when a snapshot is missing, in which case a
 * change can neither be confirmed nor ruled out from the stored data.
 */
export function buildMetadataChange(db, fromRunId, toRunId) {
  if (
    fromRunId === null ||
    fromRunId === undefined ||
    toRunId === null ||
    toRunId === undefined
  ) {
    return {
      comparable: false,
      added: [],
      removed: [],
      fromRunId: fromRunId ?? null,
      toRunId: toRunId ?? null,
    };
  }

  if (fromRunId === toRunId) {
    // Same retrieval: by construction both years were ranked against one snapshot.
    return { comparable: true, changed: false, added: [], removed: [], fromRunId, toRunId };
  }

  const fromSnapshot = getUniverseSnapshotByRun(db, fromRunId);
  const toSnapshot = getUniverseSnapshotByRun(db, toRunId);
  if (!fromSnapshot || !toSnapshot) {
    return { comparable: false, added: [], removed: [], fromRunId, toRunId };
  }

  const fromIds = new Set(fromSnapshot.snapshot.eligibleIds ?? []);
  const toIds = new Set(toSnapshot.snapshot.eligibleIds ?? []);
  const added = [...toIds].filter((id) => !fromIds.has(id)).sort();
  const removed = [...fromIds].filter((id) => !toIds.has(id)).sort();

  return {
    comparable: true,
    changed: added.length > 0 || removed.length > 0,
    added,
    removed,
    fromRunId,
    toRunId,
  };
}

/**
 * "Why does the total change?" for one metric between two years (section 6).
 *
 * @param {object} db
 * @param {{metricKey?:string, fromYear?:number, toYear?:number, focusIso3?:string}} [options]
 */
export function explainTotalChange(db, options = {}) {
  const metricKey = options.metricKey ?? METRIC_KEYS[0];
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const indicator = getIndicatorByMetricKey(db, metricKey);
  const eligibleUniverse = countEligibleCountries(db);

  if (!indicator) {
    return {
      available: false,
      reason: 'metric_not_ingested',
      metric: describeMetric(metric),
      explanation: null,
      source: sourceAttribution(),
    };
  }

  const stored = getYearRange(db, indicator.id);
  const fromYear = options.fromYear ?? stored.minYear;
  const toYear = options.toYear ?? stored.maxYear;

  if (fromYear === null || toYear === null || fromYear === undefined || toYear === undefined) {
    return {
      available: false,
      reason: 'no_stored_data',
      metric: describeMetric(metric),
      explanation: null,
      source: sourceAttribution(),
    };
  }

  // Latest recorded ingest counters for each year and metric (latest run wins,
  // deterministically via getLatestIngestYearStat).
  const fromStats = getLatestIngestYearStat(db, metricKey, fromYear);
  const toStats = getLatestIngestYearStat(db, metricKey, toYear);

  // Historical universe rule (spec section 6): each year's coverage must be
  // explained against the universe snapshot recorded on the fetch run that
  // produced that year's data — never against the current countries table.
  // When a snapshot is missing, fall back to the current count and mark the
  // comparison as not comparable (CASE D) rather than rewriting history.
  const fromSnapshot = getUniverseSnapshotByRun(db, fromStats?.fetch_run_id ?? null);
  const toSnapshot = getUniverseSnapshotByRun(db, toStats?.fetch_run_id ?? null);
  const fromEligibleUniverse =
    Number.isFinite(Number(fromSnapshot?.snapshot?.eligibleCount))
      ? Number(fromSnapshot.snapshot.eligibleCount)
      : eligibleUniverse;
  const toEligibleUniverse =
    Number.isFinite(Number(toSnapshot?.snapshot?.eligibleCount))
      ? Number(toSnapshot.snapshot.eligibleCount)
      : eligibleUniverse;

  const explanation = explainCoverageChange({
    metricKey,
    focusIso3,
    from: {
      year: fromYear,
      coverage: coverageForMetricYear(db, indicator.id, fromYear, fromEligibleUniverse),
      filtering: fromStats,
      runId: fromStats?.fetch_run_id ?? null,
    },
    to: {
      year: toYear,
      coverage: coverageForMetricYear(db, indicator.id, toYear, toEligibleUniverse),
      filtering: toStats,
      runId: toStats?.fetch_run_id ?? null,
    },
    metadataChange: buildMetadataChange(
      db,
      fromStats?.fetch_run_id ?? null,
      toStats?.fetch_run_id ?? null,
    ),
  });

  return {
    available: true,
    reason: null,
    metric: describeMetric(metric),
    fromYear,
    toYear,
    eligibleUniverse,
    fromEligibleUniverse,
    toEligibleUniverse,
    universeSource: {
      from:
        fromSnapshot?.snapshot?.eligibleCount !== undefined
          ? { fetchRunId: fromStats?.fetch_run_id ?? null, eligibleCount: fromEligibleUniverse }
          : { fetchRunId: fromStats?.fetch_run_id ?? null, fallback: 'current_count' },
      to:
        toSnapshot?.snapshot?.eligibleCount !== undefined
          ? { fetchRunId: toStats?.fetch_run_id ?? null, eligibleCount: toEligibleUniverse }
          : { fetchRunId: toStats?.fetch_run_id ?? null, fallback: 'current_count' },
      note: 'Each year uses its own run universe snapshot when available; otherwise the current count with comparable=false (CASE D).',
    },
    countersSource: {
      from: fromStats
        ? { fetchRunId: fromStats.fetch_run_id, indicatorCode: fromStats.indicator_code }
        : null,
      to: toStats
        ? { fetchRunId: toStats.fetch_run_id, indicatorCode: toStats.indicator_code }
        : null,
      note:
        'Per-year filtering counters come from the ingest that fetched that year. If a year has no recorded counters, only coverage facts are reported and no cause is inferred.',
    },
    ...explanation,
    source: sourceAttribution(),
  };
}

export default {
  coverageForMetricYear,
  buildCoveragePanel,
  buildYoyCoveragePanel,
  buildMetadataChange,
  explainTotalChange,
};
