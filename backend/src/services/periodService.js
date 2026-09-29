/**
 * PERIOD SUMMARY SERVICE (Phase 7C-1).
 *
 * Orchestration only: validation, one range read for the focus entity,
 * capability-gated generic transforms, evidence assembly. No period math
 * lives here — that belongs to domain/transforms.js (periodSum /
 * periodAverage / periodSumPercentChange over the authoritative half-open
 * interval) gated by registry periodAggregation metadata.
 *
 * Scope: single-period summary for one entity (focus country by default).
 * Period-vs-period movement wiring lands with the Movement work (7C-3);
 * this module establishes the reusable contract: operation identity,
 * boundaries, included years, observation count, completeness evidence,
 * APP_DERIVED provenance. Not routed yet by design (Phase 7C-1 stops at
 * primitives + contracts; no Movement redesign, no frontend).
 */

import { FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  getCountryObservationsRange,
  getIndicatorByMetricKey,
} from '../db/repository.js';
import { describeMetric, formatValue } from '../domain/format.js';
import { SEMANTIC_OPERATION_INFO, SEMANTIC_OPERATIONS } from '../domain/periods.js';
import { TRANSFORMS, computeTransform } from '../domain/transforms.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

const OPERATION_BY_REQUEST = Object.freeze({ SUM: 'SUM', AVG: 'AVG' });

const TRANSFORM_BY_OPERATION = Object.freeze({
  SUM: TRANSFORMS.PERIOD_SUM,
  AVG: TRANSFORMS.PERIOD_AVG,
});

const SEMANTIC_BY_OPERATION = Object.freeze({
  SUM: SEMANTIC_OPERATIONS.PERIOD_SUM,
  AVG: SEMANTIC_OPERATIONS.PERIOD_AVERAGE,
});

function baseShape({ metric, focusIso3, focusName, startYear, endYear, operation }) {
  return {
    metric: describeMetric(metric),
    focus: { iso3: focusIso3, name: focusName },
    period: { startYear, endYear, years: [], size: 0 },
    operation,
    semantic: null,
    sum: null,
    sumDisplay: null,
    average: null,
    averageDisplay: null,
    missingYears: [],
    coverage: null,
    unit: metric.unitLong ?? metric.unit ?? null,
    provenance: null,
    source: sourceAttribution(),
  };
}

/**
 * Build a strict period summary for one metric, one entity and one
 * half-open period [startYear, endYear).
 *
 * @param {object} db
 * @param {{metricKey:string, startYear:number, endYear:number, operation?:'SUM'|'AVG', focusIso3?:string}} options
 */
export async function buildPeriodSummary(db, options = {}) {
  const { metricKey } = options;
  const metric = metricKey ? METRICS[metricKey] : null;
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);
  const operation = String(options.operation ?? 'SUM').toUpperCase();
  if (!OPERATION_BY_REQUEST[operation]) {
    const error = new Error(`Unknown period operation "${options.operation}". Expected SUM or AVG.`);
    error.code = 'INVALID_OPERATION';
    throw error;
  }
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const startYear = Number(options.startYear);
  const endYear = Number(options.endYear);
  const focusName = await focusDisplayName(db, focusIso3);
  // The response operation is the transform identity (PERIOD_SUM /
  // PERIOD_AVG), never the bare request word — methodology and provenance
  // distinguish the semantic operation everywhere downstream.
  const shape = baseShape({ metric, focusIso3, focusName, startYear, endYear, operation: TRANSFORM_BY_OPERATION[operation] });
  const semanticCode = SEMANTIC_BY_OPERATION[operation];
  shape.semantic = { code: semanticCode, ...(SEMANTIC_OPERATION_INFO[semanticCode] ?? {}) };

  const indicator = await getIndicatorByMetricKey(db, metricKey);
  if (!indicator) {
    return { ...shape, available: false, reason: 'metric_not_ingested' };
  }

  // One range read for the focus entity's stored annual observations.
  // The interval end is exclusive ([A, B)), so read through B - 1.
  const rows = Number.isInteger(startYear) && Number.isInteger(endYear) && endYear > startYear
    ? await getCountryObservationsRange(db, indicator.id, focusIso3, startYear, endYear - 1)
    : [];
  const values = rows.map((row) => ({ year: row.year, value: row.value }));
  const result = computeTransform(metric, TRANSFORM_BY_OPERATION[operation], {
    values,
    startYear,
    endYear,
  });

  shape.period = {
    startYear,
    endYear,
    years: result.years ?? [],
    size: result.size ?? 0,
  };
  shape.missingYears = result.missingYears ?? [];
  const requiredYears = result.years ?? [];
  shape.coverage = {
    requiredYears,
    validYears: requiredYears.filter((year) => !(shape.missingYears.includes(year))),
    missingYears: shape.missingYears,
  };
  // Methodology/provenance travels on the transform result; the service
  // only attaches it, never recomputes it.
  shape.provenance = result.provenance ?? null;

  if (!result.computable) {
    return { ...shape, available: false, reason: result.reason };
  }
  const sum = operation === 'AVG' ? (result.sum ?? null) : result.value;
  const average = operation === 'AVG' ? result.value : null;
  return {
    ...shape,
    available: true,
    reason: null,
    sum,
    sumDisplay: sum === null ? null : formatValue(sum, metric).formatted,
    average,
    averageDisplay: average === null ? null : formatValue(average, metric).formatted,
  };
}

export default { buildPeriodSummary };
