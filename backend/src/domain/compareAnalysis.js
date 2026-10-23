/**
 * COMPARE ANALYSIS PLAN (pure, no I/O, no database).
 *
 * One place decides, for a requested comparison:
 *
 *   - which operation is being run and whether the metric may run it,
 *   - which YEARS are required and what each year MEANS (start / partition /
 *     end),
 *   - which observation years must exist for the result to be publishable,
 *   - which period boundaries apply (inclusive/exclusive), and
 *   - whether a selected year is used at all (never silently ignored).
 *
 * The plan is the input of the comparison universe: the universe is built
 * over exactly the observation years this module declares, so a country can
 * only enter the complete universe when it satisfies the completeness
 * requirement of the SELECTED analysis (not of some other analysis).
 *
 * Every formula is taken from domain/transforms.js — this module never
 * re-implements arithmetic, it only decides which approved transform runs
 * over which approved period. The period boundary convention is the
 * authoritative one from transforms.js:
 *
 *     periodYears(startYear, endYear) -> [startYear, endYear)
 *
 * i.e. 2004 -> 2014 means 2004..2013 (10 annual observations) and the end
 * year is the EXCLUSIVE boundary of a period operation.
 *
 * Year roles (Compare):
 *   Year A — starting year.
 *   Year B — optional intermediate / partition year.
 *   Year C — ending year.
 *
 * A two-point analysis (absolute/percent/pp/index/CAGR) uses A and C when C
 * is supplied, and falls back to the documented A and B pair when C is
 * absent (the pre-existing Compare API contract). A selected Year B that a
 * two-point analysis does not use is reported through `ignoredPeriods` with
 * a reason — it is never dropped without a trace.
 */

import {
  TRANSFORMS,
  TRANSFORM_FORMULAS,
  canTransform,
  allowsPeriodAggregation,
} from './transforms.js';

/**
 * Compare-specific reason codes raised by the analysis planner.
 * services/entities.js re-exports them as ENTITY_ERROR_CODES so the HTTP
 * layer and the service layer speak one vocabulary.
 */
export const COMPARE_REASON_CODES = Object.freeze({
  INVALID_OPERATION: 'INVALID_OPERATION',
  MISSING_YEAR: 'MISSING_YEAR',
  SAME_YEAR_SELECTED: 'SAME_YEAR_SELECTED',
  INVALID_YEAR_ORDER: 'INVALID_YEAR_ORDER',
  UNSUPPORTED_TRANSFORMATION: 'UNSUPPORTED_TRANSFORMATION',
  NOT_AGGREGATABLE: 'NOT_AGGREGATABLE',
});

/**
 * The two-point change operations, mapped onto the approved transforms.
 * `transform` is the Phase-3 code; `changeType` is the registry
 * `validChangeTypes` entry that gates it.
 */
const TWO_POINT_ANALYSES = Object.freeze({
  absolute_change: Object.freeze({
    id: 'absolute_change',
    label: 'Absolute change',
    kind: 'two_point',
    transform: TRANSFORMS.ABSOLUTE_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.ABSOLUTE_CHANGE],
    unitKind: 'metric',
  }),
  percent_change: Object.freeze({
    id: 'percent_change',
    label: 'Percent change',
    kind: 'two_point',
    transform: TRANSFORMS.PERCENT_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERCENT_CHANGE],
    unitKind: 'percent',
  }),
  pp_change: Object.freeze({
    id: 'pp_change',
    label: 'Percentage-point change',
    kind: 'two_point',
    transform: TRANSFORMS.PERCENTAGE_POINT_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERCENTAGE_POINT_CHANGE],
    unitKind: 'percentage points',
  }),
  index_point_change: Object.freeze({
    id: 'index_point_change',
    label: 'Index-point change',
    kind: 'two_point',
    transform: TRANSFORMS.INDEX_POINT_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.INDEX_POINT_CHANGE],
    unitKind: 'index points',
  }),
  cagr: Object.freeze({
    id: 'cagr',
    label: 'CAGR',
    kind: 'two_point',
    transform: TRANSFORMS.CAGR,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.CAGR],
    unitKind: 'percent',
  }),
});

/**
 * The full Compare operation catalogue. Every entry names the approved
 * transform that produces its number, so no operation can drift away from
 * the project's formulas.
 */
export const COMPARE_ANALYSES = Object.freeze({
  level: Object.freeze({
    id: 'level',
    label: 'Level',
    kind: 'point',
    transform: null,
    formula: 'stored observation at the selected period(s)',
    unitKind: 'metric',
  }),
  ...TWO_POINT_ANALYSES,
  cross_rate: Object.freeze({
    id: 'cross_rate',
    label: 'Cross-rate',
    kind: 'single',
    transform: TRANSFORMS.CROSS_RATE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.CROSS_RATE],
    unitKind: 'rate',
  }),
  period_total: Object.freeze({
    id: 'period_total',
    label: 'Period total',
    kind: 'period',
    transform: TRANSFORMS.PERIOD_SUM,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERIOD_SUM],
    unitKind: 'metric',
  }),
  period_average: Object.freeze({
    id: 'period_average',
    label: 'Period average',
    kind: 'period',
    transform: TRANSFORMS.PERIOD_AVG,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERIOD_AVG],
    unitKind: 'metric',
  }),
  movement_period_total: Object.freeze({
    id: 'movement_period_total',
    label: 'Movement period total',
    kind: 'movement_period',
    transform: 'MOVEMENT_PERIOD_TOTAL',
    formula: 'sum of every required annual flow observation under the selected Movement basis',
    unitKind: 'metric',
  }),
  movement_period_average: Object.freeze({
    id: 'movement_period_average',
    label: 'Movement period average',
    kind: 'movement_period',
    transform: 'MOVEMENT_PERIOD_AVERAGE',
    formula: 'arithmetic mean of every required annual observation under the selected Movement basis',
    unitKind: 'metric',
  }),
  movement_inflation_cumulative: Object.freeze({
    id: 'movement_inflation_cumulative',
    label: 'Cumulative inflation',
    kind: 'movement_period',
    transform: 'MOVEMENT_CUMULATIVE_INFLATION',
    formula: '((product(1 + annual inflation(t)/100)) - 1) × 100 over required years',
    unitKind: 'percent',
  }),
  period_total_growth: Object.freeze({
    id: 'period_total_growth',
    label: 'Period-total growth',
    kind: 'partitioned_period',
    transform: TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE],
    unitKind: 'percent',
  }),
  segmented_growth: Object.freeze({
    id: 'segmented_growth',
    label: 'Segmented growth',
    kind: 'partitioned',
    transform: TRANSFORMS.PERCENT_CHANGE,
    formula: TRANSFORM_FORMULAS[TRANSFORMS.PERCENT_CHANGE],
    unitKind: 'percent',
  }),
});

/** Ordered operation ids (stable UI ordering). */
export const COMPARE_ANALYSIS_IDS = Object.freeze(Object.keys(COMPARE_ANALYSES));

/** Inclusive integer range [from, to]. */
function inclusiveRange(from, to) {
  const out = [];
  for (let y = from; y <= to; y += 1) out.push(y);
  return out;
}

/** Exclusive integer range [from, to) — the authoritative period convention. */
function exclusiveRange(from, to) {
  const out = [];
  for (let y = from; y < to; y += 1) out.push(y);
  return out;
}

/** Selected endpoint comparisons used by analyses that accept any period pair. */
function endpointIntervals(a, b, c) {
  if (b !== null && c !== null) {
    return [
      { id: 'AB', start: a, end: b },
      { id: 'BC', start: b, end: c },
      { id: 'AC', start: a, end: c },
    ];
  }
  const end = c ?? b;
  return end === null ? [] : [{ id: c !== null ? 'AC' : 'AB', start: a, end }];
}

function planError(code, message) {
  return { error: { code, message } };
}

/**
 * Capability gate for one analysis against one metric.
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function gateCompareAnalysis(analysisId, metric) {
  const def = COMPARE_ANALYSES[analysisId];
  if (!def) return { allowed: false, reason: COMPARE_REASON_CODES.INVALID_OPERATION };
  if (!metric || !metric.key) return { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
  switch (def.id) {
    case 'level':
      return { allowed: true, reason: null };
    case 'cross_rate': {
      const gate = canTransform(metric, TRANSFORMS.CROSS_RATE);
      return gate.allowed ? { allowed: true, reason: null } : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    }
    case 'period_total':
    case 'period_total_growth': {
      const ok = allowsPeriodAggregation(metric, 'SUM');
      return ok ? { allowed: true, reason: null } : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    }
    case 'period_average': {
      const ok = allowsPeriodAggregation(metric, 'AVG');
      return ok ? { allowed: true, reason: null } : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    }
    case 'movement_period_total':
      return ['exports_current', 'imports_current', 'fdi_inflows', 'remittances_received'].includes(metric.key)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    case 'movement_period_average':
      return ['exports_current', 'imports_current', 'fdi_inflows', 'fdi_inflows_pct_gdp', 'remittances_received', 'inflation_cpi', 'inflation_deflator'].includes(metric.key)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    case 'movement_inflation_cumulative':
      return ['inflation_cpi', 'inflation_deflator'].includes(metric.key)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    case 'segmented_growth': {
      const gate = canTransform(metric, TRANSFORMS.PERCENT_CHANGE);
      return gate.allowed ? { allowed: true, reason: null } : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    }
    default: {
      const gate = canTransform(metric, def.transform);
      return gate.allowed ? { allowed: true, reason: null } : { allowed: false, reason: COMPARE_REASON_CODES.UNSUPPORTED_TRANSFORMATION };
    }
  }
}

/**
 * Resolve the full analysis plan for a request.
 *
 * @param {object} input
 * @param {string} input.operation one of COMPARE_ANALYSIS_IDS
 * @param {object} input.metric registry entry
 * @param {number|null} input.yearA
 * @param {number|null} [input.yearB]
 * @param {number|null} [input.yearC]
 * @returns {object} plan (or {error: {code, message}})
 */
export function resolveComparePlan({ operation, metric, yearA, yearB = null, yearC = null } = {}) {
  const def = COMPARE_ANALYSES[operation];
  if (!def) {
    return planError(
      COMPARE_REASON_CODES.INVALID_OPERATION,
      `Unknown operation "${operation}". Expected one of ${COMPARE_ANALYSIS_IDS.join(', ')}.`,
    );
  }
  if (!Number.isInteger(yearA)) {
    return planError(COMPARE_REASON_CODES.MISSING_YEAR, 'yearA is required for a comparison.');
  }
  const gate = gateCompareAnalysis(operation, metric);
  if (!gate.allowed) {
    return planError(
      gate.reason,
      `Operation "${def.label}" is not supported for metric "${metric?.key ?? 'unknown'}" (${gate.reason}).`,
    );
  }

  const a = yearA;
  const b = Number.isInteger(yearB) ? yearB : null;
  const c = Number.isInteger(yearC) ? yearC : null;
  const ignoredPeriods = [];

  /** Shared plan skeleton. */
  const base = {
    id: def.id,
    label: def.label,
    kind: def.kind,
    transform: def.transform,
    formula: def.formula,
    unitKind: def.unitKind,
    periods: { a, b, c },
    startYear: a,
    midYear: null,
    endYear: null,
    endpointYears: null,
    requiredObservationYears: [],
    seriesYears: [],
    intervals: [],
    ignoredPeriods,
    boundary: null,
    error: null,
  };

  // ---- cross_rate: one year only -----------------------------------------
  if (def.id === 'cross_rate') {
    if (b !== null || c !== null) {
      return planError(
        COMPARE_REASON_CODES.INVALID_OPERATION,
        'cross_rate compares one year only; omit yearB and yearC.',
      );
    }
    base.requiredObservationYears = [a];
    base.seriesYears = [a];
    return base;
  }

  // ---- level: every supplied period is a comparison row -------------------
  if (def.id === 'level') {
    const supplied = [a, b, c].filter((y) => y !== null);
    if (new Set(supplied).size !== supplied.length) {
      return planError(
        COMPARE_REASON_CODES.SAME_YEAR_SELECTED,
        'Year A, Year B and Year C must be distinct for a level comparison.',
      );
    }
    if (supplied.some((year, index) => index > 0 && year <= supplied[index - 1])) {
      return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, 'Level periods must be selected in chronological order: A < B < C.');
    }
    base.requiredObservationYears = [...supplied].sort((x, y) => x - y);
    base.intervals = endpointIntervals(a, b, c).map((interval) => ({
      ...interval,
      years: [interval.start, interval.end],
      inclusiveStart: true,
      inclusiveEnd: true,
    }));
    base.seriesYears = inclusiveRange(Math.min(...supplied), Math.max(...supplied));
    base.endYear = base.seriesYears[base.seriesYears.length - 1];
    base.midYear = supplied.length > 1 ? [...supplied].sort((x, y) => x - y)[supplied.length - 2] : null;
    base.boundary = { start: a, end: base.endYear, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' };
    return base;
  }

  // ---- two-point change analyses ------------------------------------------
  if (def.kind === 'two_point') {
    // Every selected endpoint participates in the interval set and in the
    // frozen like-for-like eligibility universe. With no middle year, C is
    // the direct endpoint; B remains the backward-compatible two-year end.
    const end = c !== null ? c : b;
    if (end === null) {
      return planError(
        COMPARE_REASON_CODES.MISSING_YEAR,
        `Operation "${def.label}" requires a start year (A) and an end year (C, or B when C is not selected).`,
      );
    }
    if (end === a) {
      return planError(
        COMPARE_REASON_CODES.SAME_YEAR_SELECTED,
        `The start and end years of "${def.label}" must differ.`,
      );
    }
    if (end < a) {
      return planError(
        COMPARE_REASON_CODES.INVALID_YEAR_ORDER,
        `The end year (${end}) of "${def.label}" must be after the start year (${a}).`,
      );
    }
    if (b !== null && c !== null && !(a < b && b < c)) {
      return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, `"${def.label}" requires Year A < Year B < Year C (received ${a}, ${b}, ${c}).`);
    }
    base.endYear = end;
    base.endpointYears = [a, end];
    base.intervals = endpointIntervals(a, b, c).map((interval) => ({
      ...interval,
      years: [interval.start, interval.end],
      inclusiveStart: true,
      inclusiveEnd: true,
    }));
    base.requiredObservationYears = [...new Set(base.intervals.flatMap((interval) => interval.years))].sort((x, y) => x - y);
    base.seriesYears = inclusiveRange(a, end);
    base.boundary = { start: a, end, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' };
    return base;
  }

  // ---- period analyses over [start, end) ---------------------------------
  if (def.kind === 'period') {
    const end = c !== null ? c : b;
    if (end === null) {
      return planError(
        COMPARE_REASON_CODES.MISSING_YEAR,
        `Operation "${def.label}" requires a start year (A) and a period end year (C, or B when C is not selected).`,
      );
    }
    if (end <= a) {
      return planError(
        COMPARE_REASON_CODES.INVALID_YEAR_ORDER,
        `The period end year (${end}) of "${def.label}" must be after the start year (${a}).`,
      );
    }
    if (b !== null && c !== null && !(a < b && b < c)) {
      return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, `"${def.label}" requires Year A < Year B < Year C (received ${a}, ${b}, ${c}).`);
    }
    base.endYear = end;
    base.intervals = endpointIntervals(a, b, c).map((interval) => ({
      ...interval,
      inclusiveStart: true,
      inclusiveEnd: false,
      years: exclusiveRange(interval.start, interval.end),
    }));
    base.requiredObservationYears = [...new Set(base.intervals.flatMap((interval) => interval.years))].sort((x, y) => x - y);
    base.seriesYears = inclusiveRange(a, end);
    base.boundary = { start: a, end, inclusiveStart: true, inclusiveEnd: false, kind: 'period_half_open' };
    return base;
  }

  // Movement flow and rate bases have distinct, approved boundary rules:
  // Trade totals/averages use S..E; Capital, remittances and inflation use
  // S+1..E. Each selected interval applies the rule independently.
  if (def.kind === 'movement_period') {
    const end = c ?? b;
    if (end === null) {
      return planError(COMPARE_REASON_CODES.MISSING_YEAR, `Operation "${def.label}" requires Year A and an end year.`);
    }
    if (end <= a) return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, `Operation "${def.label}" requires the end year after Year A.`);
    if (b !== null && c !== null && !(a < b && b < c)) {
      return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, `"${def.label}" requires Year A < Year B < Year C.`);
    }
    const tradeInclusive = ['exports_current', 'imports_current'].includes(metric.key);
    const endpoints = endpointIntervals(a, b, c);
    const intervals = endpoints.map((interval) => {
      const years = tradeInclusive
        ? inclusiveRange(interval.start, interval.end)
        : exclusiveRange(interval.start + 1, interval.end + 1);
      return { ...interval, years, inclusiveStart: tradeInclusive, inclusiveEnd: true };
    });
    base.endYear = end;
    base.intervals = intervals;
    base.requiredObservationYears = [...new Set(intervals.flatMap((interval) => interval.years))].sort((x, y) => x - y);
    base.seriesYears = inclusiveRange(a, end);
    base.boundary = {
      start: a,
      end,
      inclusiveStart: tradeInclusive,
      inclusiveEnd: true,
      kind: tradeInclusive ? 'movement_inclusive' : 'movement_start_excluded_end_included',
    };
    return base;
  }

  // Partitioned methods can still provide one direct A → C result when the
  // optional middle year is cleared. A period-total growth comparison is
  // undefined without a split point, so it stays explicitly unavailable.
  if (c !== null && b === null && def.id === 'segmented_growth') {
    if (c <= a) return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, 'Segmented growth requires Year A < Year C.');
    base.endYear = c;
    base.endpointYears = [a, c];
    base.requiredObservationYears = [a, c];
    base.seriesYears = inclusiveRange(a, c);
    base.boundary = { start: a, end: c, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' };
    base.intervals = [{ id: 'AC', start: a, end: c, inclusiveStart: true, inclusiveEnd: true, years: [a, c] }];
    return base;
  }
  if (c !== null && b === null && def.id === 'period_total_growth') {
    if (c <= a) return planError(COMPARE_REASON_CODES.INVALID_YEAR_ORDER, 'Period-total growth requires Year A < Year C.');
    base.endYear = c;
    base.requiredObservationYears = exclusiveRange(a, c);
    base.seriesYears = inclusiveRange(a, c);
    base.boundary = { start: a, end: c, inclusiveStart: true, inclusiveEnd: false, kind: 'period_half_open' };
    base.intervals = [{ id: 'AC', start: a, end: c, inclusiveStart: true, inclusiveEnd: false, years: exclusiveRange(a, c) }];
    return base;
  }

  // ---- partitioned analyses: A < B < C ------------------------------------
  if (b === null || c === null) {
    return planError(
      COMPARE_REASON_CODES.MISSING_YEAR,
      `Operation "${def.label}" requires Year A, Year B and Year C.`,
    );
  }
  if (!(a < b && b < c)) {
    return planError(
      COMPARE_REASON_CODES.INVALID_YEAR_ORDER,
      `"${def.label}" requires Year A < Year B < Year C (received ${a}, ${b}, ${c}).`,
    );
  }
  base.midYear = b;
  base.endYear = c;

  if (def.id === 'period_total_growth') {
    // Two adjacent half-open periods: [A, B) against [B, C).
    base.requiredObservationYears = exclusiveRange(a, c);
    base.seriesYears = inclusiveRange(a, c);
    base.boundary = { start: a, end: c, inclusiveStart: true, inclusiveEnd: false, kind: 'period_half_open' };
    base.intervals = [
      { id: 'AB', start: a, end: b, inclusiveStart: true, inclusiveEnd: false, years: exclusiveRange(a, b) },
      { id: 'BC', start: b, end: c, inclusiveStart: true, inclusiveEnd: false, years: exclusiveRange(b, c) },
    ];
    return base;
  }

  // segmented_growth: three observation points, one shared universe.
  base.requiredObservationYears = [a, b, c];
  base.seriesYears = inclusiveRange(a, c);
  base.boundary = { start: a, end: c, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' };
  base.intervals = [
    { id: 'AM', start: a, end: b, inclusiveStart: true, inclusiveEnd: true, years: [a, b] },
    { id: 'MB', start: b, end: c, inclusiveStart: true, inclusiveEnd: true, years: [b, c] },
    { id: 'AB', start: a, end: c, inclusiveStart: true, inclusiveEnd: true, years: [a, c] },
  ];
  return base;
}

export default {
  COMPARE_ANALYSES,
  COMPARE_ANALYSIS_IDS,
  COMPARE_REASON_CODES,
  gateCompareAnalysis,
  resolveComparePlan,
};
