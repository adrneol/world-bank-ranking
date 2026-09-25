/**
 * GENERIC MATHEMATICAL TRANSFORMATION LAYER (Phase 3, pure functions, no I/O).
 *
 * One metadata-driven engine instead of per-indicator engines: the Phase-2
 * registry declares what each measure IS (observationType, signDomain,
 * validChangeTypes, aggregation, quotation) and this module enforces it.
 * There is deliberately no `if metric === "inflation"` anywhere below —
 * capability comes from the metric object passed in.
 *
 * Relationship to the proven engines (which are NEVER reimplemented here):
 *   - PERCENT_CHANGE / YOY use the exact YoY formula from domain/yoy.js.
 *     For valid inputs the number is computed by computeYoy() itself, so GDP
 *     results are identical by construction, not by coincidence. The generic
 *     layer only adds stricter pre-checks the GDP engine never needed
 *     (sign-change refusal) plus metric capability gating.
 *   - Ranking, comparison, coverage and universe logic are untouched; this
 *     module produces point values (or explicit unavailability), never ranks.
 *
 * Result shape (mirrors the yoy.js unavailable/reason convention):
 *   { transform, value, reason, description, computable, unit, provenance }
 * where provenance is always APP_DERIVED with transform, formula, inputs,
 * metricKey and outputUnit — including for unavailable results, so a UI can
 * explain WHY without ever showing a fabricated number.
 *
 * Group/entity orchestration (membership, compatible-unit checks, coverage
 * decomposition) belongs to Phase 4. GROUP_SUM, GROUP_RATIO_FROM_SUMS and
 * CROSS_RATE below are strict pure primitives over already-validated inputs:
 * every member/leg must be finite or the result is unavailable. They create
 * no group, entity or API architecture.
 */

import { computeYoy } from './yoy.js';

/** Transform codes. Point changes mirror the Phase-2 CHANGE_TYPES vocabulary;
 *  group/cross primitives are gated on aggregation/quotation metadata. */
export const TRANSFORMS = Object.freeze({
  ABSOLUTE_CHANGE: 'ABSOLUTE',
  PERCENT_CHANGE: 'PERCENT',
  PERCENTAGE_POINT_CHANGE: 'PP',
  INDEX_POINT_CHANGE: 'INDEX_POINT',
  YOY: 'YOY',
  CAGR: 'CAGR',
  GROUP_SUM: 'GROUP_SUM',
  GROUP_RATIO_FROM_SUMS: 'GROUP_RATIO_FROM_SUMS',
  CROSS_RATE: 'CROSS_RATE',
  PERIOD_SUM: 'PERIOD_SUM',
  PERIOD_AVG: 'PERIOD_AVG',
  PERIOD_SUM_PERCENT_CHANGE: 'PERIOD_SUM_PERCENT_CHANGE',
});

/** Machine-readable reasons for an unavailable transform result. */
export const TRANSFORM_NA_REASONS = Object.freeze({
  MISSING_BASE: 'missing_base_value',
  MISSING_CURRENT: 'missing_current_value',
  BOTH_MISSING: 'both_values_missing',
  NON_FINITE_VALUE: 'non_finite_value',
  ZERO_BASE: 'zero_base_for_percent_change',
  NEGATIVE_BASE: 'negative_base_for_percent_change',
  SIGN_CHANGE: 'sign_change_across_endpoints',
  INVALID_INTERVAL: 'invalid_year_interval',
  EMPTY_INPUT: 'empty_input_set',
  INCOMPLETE_PERIOD: 'incomplete_period',
  INVALID_PERIOD: 'invalid_period_interval',
  UNKNOWN_METRIC: 'unknown_metric',
  UNSUPPORTED_TRANSFORMATION: 'unsupported_transformation_for_metric',
});

/** Human-readable descriptions, used wherever unavailability is explained. */
export const TRANSFORM_NA_DESCRIPTIONS = Object.freeze({
  [TRANSFORM_NA_REASONS.MISSING_BASE]:
    'No valid base value, so no change can be calculated.',
  [TRANSFORM_NA_REASONS.MISSING_CURRENT]:
    'No valid current value, so no change can be calculated.',
  [TRANSFORM_NA_REASONS.BOTH_MISSING]:
    'Neither endpoint has a valid value.',
  [TRANSFORM_NA_REASONS.NON_FINITE_VALUE]:
    'At least one input was not a finite number, so no result can be calculated.',
  [TRANSFORM_NA_REASONS.ZERO_BASE]:
    'The base value is zero, so a percentage rate from it is undefined.',
  [TRANSFORM_NA_REASONS.NEGATIVE_BASE]:
    'The base value is negative, so an ordinary percentage change from it would be misleading.',
  [TRANSFORM_NA_REASONS.SIGN_CHANGE]:
    'The endpoints have different signs, so an ordinary percentage change would be misleading.',
  [TRANSFORM_NA_REASONS.INVALID_INTERVAL]:
    'CAGR requires two distinct years with a positive interval between them.',
  [TRANSFORM_NA_REASONS.EMPTY_INPUT]:
    'No member values were provided, so no group result can be calculated.',
  [TRANSFORM_NA_REASONS.INCOMPLETE_PERIOD]:
    'At least one required year in the period has no stored observation, so no complete period statistic can be calculated. Missing years are never treated as zero.',
  [TRANSFORM_NA_REASONS.INVALID_PERIOD]:
    'Period boundaries must be integer years with the end year after the start year ([A, B) is empty otherwise).',
  [TRANSFORM_NA_REASONS.UNKNOWN_METRIC]:
    'No measure metadata was provided, so capability cannot be validated.',
  [TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION]:
    'The measure does not declare this transformation as a valid change type.',
});

/** Exact formulas, surfaced in provenance (never recomputed from strings). */
export const TRANSFORM_FORMULAS = Object.freeze({
  [TRANSFORMS.ABSOLUTE_CHANGE]: 'B - A',
  [TRANSFORMS.PERCENT_CHANGE]: '((B / A) - 1) * 100',
  [TRANSFORMS.PERCENTAGE_POINT_CHANGE]: 'B - A (percentage points)',
  [TRANSFORMS.INDEX_POINT_CHANGE]: 'B - A (index points)',
  [TRANSFORMS.YOY]: '((current / previous) - 1) * 100',
  [TRANSFORMS.CAGR]: '((B / A) ^ (1 / years) - 1) * 100',
  [TRANSFORMS.GROUP_SUM]: 'sum(members)',
  [TRANSFORMS.GROUP_RATIO_FROM_SUMS]: 'sum(numerators) / sum(denominators)',
  [TRANSFORMS.CROSS_RATE]: 'A_per_USD / B_per_USD',
  [TRANSFORMS.PERIOD_SUM]: 'sum(values[A..B-1])',
  [TRANSFORMS.PERIOD_AVG]: 'sum(values[A..B-1]) / N',
  [TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE]: '((sumB / sumA) - 1) * 100',
});

function isMissing(value) {
  return value === null || value === undefined;
}

function isValidNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Central capability check: may `transform` be applied to `metric`?
 * Point changes consult validChangeTypes; group/cross primitives consult
 * aggregation/quotation metadata (declaring them there keeps ONE gating
 * mechanism without touching frozen validChangeTypes arrays).
 *
 * @param {object|null|undefined} metric Phase-2 registry entry (or future definition)
 * @param {string} transform one of TRANSFORMS
 * @returns {{allowed:boolean, reason:string|null}}
 */
export function canTransform(metric, transform) {
  if (!metric || typeof metric !== 'object' || !metric.key) {
    return { allowed: false, reason: TRANSFORM_NA_REASONS.UNKNOWN_METRIC };
  }
  switch (transform) {
    case TRANSFORMS.GROUP_SUM:
      return metric.aggregation === 'SUM'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    case TRANSFORMS.GROUP_RATIO_FROM_SUMS:
      return metric.aggregation === 'WEIGHTED_RATIO'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    case TRANSFORMS.CROSS_RATE:
      return metric.observationType === 'QUOTED_RATE' &&
        metric.quotation?.convention === 'LCU_PER_USD'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    case TRANSFORMS.PERIOD_SUM:
      return allowsPeriodAggregation(metric, 'SUM')
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    case TRANSFORMS.PERIOD_AVG:
      return allowsPeriodAggregation(metric, 'AVG')
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    case TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE:
      // A percent change of two period totals derives from period sums, so
      // it requires the same SUM capability as the sums themselves.
      return allowsPeriodAggregation(metric, 'SUM')
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    default: {
      const declared = Array.isArray(metric.validChangeTypes) ? metric.validChangeTypes : [];
      return declared.includes(transform)
        ? { allowed: true, reason: null }
        : { allowed: false, reason: TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION };
    }
  }
}

/** Output unit for a gated transform (never a reused generic guess). */
export function outputUnitFor(metric, transform) {
  switch (transform) {
    case TRANSFORMS.PERCENT_CHANGE:
    case TRANSFORMS.YOY:
    case TRANSFORMS.CAGR:
    case TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE:
      return '%';
    case TRANSFORMS.PERCENTAGE_POINT_CHANGE:
      return 'percentage points';
    case TRANSFORMS.INDEX_POINT_CHANGE:
      return 'index points';
    default:
      return metric?.unitLong ?? metric?.unit ?? null;
  }
}

/**
 * Whether a metric may use a period aggregation operation over time.
 * Fail-closed: unknown operations and undeclared metadata refuse. Only
 * FLOW metrics declare SUM/AVG; levels, rates, ratios, indexes and quoted
 * rates declare none, so period sums can never leak into them.
 *
 * @param {object|null|undefined} metric registry entry
 * @param {string} operation 'SUM' or 'AVG'
 */
export function allowsPeriodAggregation(metric, operation) {
  if (!metric || typeof metric !== 'object' || !metric.key) return false;
  if (operation !== 'SUM' && operation !== 'AVG') return false;
  return Array.isArray(metric.periodAggregation) && metric.periodAggregation.includes(operation);
}

function unavailable(transform, reason, metric, inputs) {
  const unit = metric ? outputUnitFor(metric, transform) : null;
  return {
    transform,
    value: null,
    reason,
    description: TRANSFORM_NA_DESCRIPTIONS[reason] ?? null,
    computable: false,
    unit,
    provenance: {
      kind: 'APP_DERIVED',
      transform,
      formula: TRANSFORM_FORMULAS[transform] ?? null,
      metricKey: metric?.key ?? null,
      inputs: { ...(inputs ?? {}) },
      outputUnit: unit,
    },
  };
}

function available(transform, value, metric, inputs) {
  const unit = outputUnitFor(metric, transform);
  return {
    transform,
    value,
    reason: null,
    description: null,
    computable: true,
    unit,
    provenance: {
      kind: 'APP_DERIVED',
      transform,
      formula: TRANSFORM_FORMULAS[transform] ?? null,
      metricKey: metric?.key ?? null,
      inputs: { ...(inputs ?? {}) },
      outputUnit: unit,
    },
  };
}

/** Shared two-point presence/finiteness gate. Returns null when clean. */
function gateTwoPoint(a, b) {
  if (isMissing(a) && isMissing(b)) return TRANSFORM_NA_REASONS.BOTH_MISSING;
  if (isMissing(a)) return TRANSFORM_NA_REASONS.MISSING_BASE;
  if (isMissing(b)) return TRANSFORM_NA_REASONS.MISSING_CURRENT;
  if (!isValidNumber(a) || !isValidNumber(b)) return TRANSFORM_NA_REASONS.NON_FINITE_VALUE;
  return null;
}

/**
 * ABSOLUTE_CHANGE: B - A. Valid for any finite pair; zero is a legitimate
 * result (equal inputs), never confused with missingness.
 */
export function absoluteChange({ a, b } = {}, metric = null) {
  const blocked = gateTwoPoint(a, b);
  if (blocked) return unavailable(TRANSFORMS.ABSOLUTE_CHANGE, blocked, metric, { a, b });
  return available(TRANSFORMS.ABSOLUTE_CHANGE, b - a, metric, { a, b });
}

/**
 * PERCENT_CHANGE: ((B / A) - 1) * 100 with metric-aware validity.
 *
 *   - missing/non-finite -> unavailable (never zero, never bridged)
 *   - base zero           -> unavailable (ZERO_BASE; both-zero included)
 *   - base negative       -> unavailable (NEGATIVE_BASE)
 *   - sign change         -> unavailable (SIGN_CHANGE), even A > 0 -> B < 0,
 *     which the legacy YoY engine would numerically compute: the generic
 *     layer is deliberately stricter for signed future flows (FDI, balances)
 *   - valid positive-base inputs delegate the arithmetic to computeYoy(),
 *     so GDP numbers are identical to the proven engine by construction
 */
export function percentChange({ a, b } = {}, metric = null) {
  const blocked = gateTwoPoint(a, b);
  if (blocked) return unavailable(TRANSFORMS.PERCENT_CHANGE, blocked, metric, { a, b });
  if (a === 0) return unavailable(TRANSFORMS.PERCENT_CHANGE, TRANSFORM_NA_REASONS.ZERO_BASE, metric, { a, b });
  if (a < 0) {
    return unavailable(TRANSFORMS.PERCENT_CHANGE, TRANSFORM_NA_REASONS.NEGATIVE_BASE, metric, { a, b });
  }
  if (b < 0) {
    return unavailable(TRANSFORMS.PERCENT_CHANGE, TRANSFORM_NA_REASONS.SIGN_CHANGE, metric, { a, b });
  }
  const yoy = computeYoy({ current: b, previous: a });
  if (!yoy.computable) {
    return unavailable(TRANSFORMS.PERCENT_CHANGE, TRANSFORM_NA_REASONS.NON_FINITE_VALUE, metric, { a, b });
  }
  return available(TRANSFORMS.PERCENT_CHANGE, yoy.yoyPercent, metric, { a, b });
}

/**
 * PERCENTAGE_POINT_CHANGE: B - A for rate/percentage-ratio measures.
 * 6% -> 3% is -3 percentage points, never -50%. Valid for any finite pair
 * including zero and negative rates (deflation); capability gating (metric
 * must declare PP) happens in canTransform/computeTransform, not here.
 */
export function percentagePointChange({ a, b } = {}, metric = null) {
  const blocked = gateTwoPoint(a, b);
  if (blocked) return unavailable(TRANSFORMS.PERCENTAGE_POINT_CHANGE, blocked, metric, { a, b });
  return available(TRANSFORMS.PERCENTAGE_POINT_CHANGE, b - a, metric, { a, b });
}

/**
 * INDEX_POINT_CHANGE: B - A for index measures. 105 -> 110 is +5 index
 * points, never "+5 percentage points". Separate code, unit and formula
 * from PP so the two can never collapse downstream.
 */
export function indexPointChange({ a, b } = {}, metric = null) {
  const blocked = gateTwoPoint(a, b);
  if (blocked) return unavailable(TRANSFORMS.INDEX_POINT_CHANGE, blocked, metric, { a, b });
  return available(TRANSFORMS.INDEX_POINT_CHANGE, b - a, metric, { a, b });
}

/**
 * CAGR: ((B / A) ^ (1 / years) - 1) * 100.
 * Requires distinct years (positive interval), finite endpoints, a strictly
 * positive base and a non-negative endpoint. Signed/negative domains return
 * explicit reasons instead of NaN or a fabricated rate.
 */
export function cagr({ a, b, years } = {}, metric = null) {
  const inputs = { a, b, years };
  const blocked = gateTwoPoint(a, b);
  if (blocked) return unavailable(TRANSFORMS.CAGR, blocked, metric, inputs);
  if (!isValidNumber(years) || !(years > 0)) {
    return unavailable(TRANSFORMS.CAGR, TRANSFORM_NA_REASONS.INVALID_INTERVAL, metric, inputs);
  }
  if (a === 0) return unavailable(TRANSFORMS.CAGR, TRANSFORM_NA_REASONS.ZERO_BASE, metric, inputs);
  if (a < 0 || b < 0) {
    return unavailable(
      TRANSFORMS.CAGR,
      a < 0 ? TRANSFORM_NA_REASONS.NEGATIVE_BASE : TRANSFORM_NA_REASONS.SIGN_CHANGE,
      metric,
      inputs,
    );
  }
  return available(TRANSFORMS.CAGR, (Math.pow(b / a, 1 / years) - 1) * 100, metric, inputs);
}

/**
 * GROUP_SUM (pure primitive): sum of already-validated compatible member
 * values. STRICT: every member must be finite — a missing member makes the
 * sum unavailable rather than silently shrinking the group. Phase 4 decides
 * which members are eligible and accounts coverage separately; this function
 * knows no entities.
 */
export function groupSum(values, metric = null) {
  const list = Array.isArray(values) ? values : [];
  if (list.length === 0) {
    return unavailable(TRANSFORMS.GROUP_SUM, TRANSFORM_NA_REASONS.EMPTY_INPUT, metric, { members: list.length });
  }
  if (!list.every(isValidNumber)) {
    const reason = list.some(isMissing) ? TRANSFORM_NA_REASONS.BOTH_MISSING : TRANSFORM_NA_REASONS.NON_FINITE_VALUE;
    return unavailable(TRANSFORMS.GROUP_SUM, reason, metric, { members: list.length });
  }
  return available(TRANSFORMS.GROUP_SUM, list.reduce((sum, v) => sum + v, 0), metric, { members: list.length });
}

/**
 * GROUP_RATIO_FROM_SUMS (pure primitive): sum(numerators) / sum(denominators).
 * Ratios are recomputed from aggregated legs, never averaged. Both leg sums
 * must be finite and the denominator sum strictly positive.
 */
export function groupRatioFromSums({ numerators, denominators } = {}, metric = null) {
  const inputs = { numerators: numerators?.length ?? 0, denominators: denominators?.length ?? 0 };
  const num = Array.isArray(numerators) ? numerators : [];
  const den = Array.isArray(denominators) ? denominators : [];
  if (num.length === 0 || den.length === 0) {
    return unavailable(TRANSFORMS.GROUP_RATIO_FROM_SUMS, TRANSFORM_NA_REASONS.EMPTY_INPUT, metric, inputs);
  }
  if (!num.every(isValidNumber) || !den.every(isValidNumber)) {
    return unavailable(TRANSFORMS.GROUP_RATIO_FROM_SUMS, TRANSFORM_NA_REASONS.NON_FINITE_VALUE, metric, inputs);
  }
  const sumNum = num.reduce((sum, v) => sum + v, 0);
  const sumDen = den.reduce((sum, v) => sum + v, 0);
  if (sumDen === 0) {
    return unavailable(TRANSFORMS.GROUP_RATIO_FROM_SUMS, TRANSFORM_NA_REASONS.ZERO_BASE, metric, inputs);
  }
  if (sumDen < 0) {
    return unavailable(TRANSFORMS.GROUP_RATIO_FROM_SUMS, TRANSFORM_NA_REASONS.NEGATIVE_BASE, metric, inputs);
  }
  return available(TRANSFORMS.GROUP_RATIO_FROM_SUMS, (sumNum / sumDen) * 100, metric, inputs);
}

/**
 * CROSS_RATE (pure primitive): A_per_USD / B_per_USD for same-period World
 * Bank FX legs under a compatible quotation convention. No entity, vintage
 * or compatibility checks here — Phase 4 validates legs; this is arithmetic.
 */
export function crossRate({ aPerUsd, bPerUsd } = {}, metric = null) {
  const inputs = { aPerUsd, bPerUsd };
  if (isMissing(aPerUsd) && isMissing(bPerUsd)) {
    return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.BOTH_MISSING, metric, inputs);
  }
  if (isMissing(aPerUsd)) return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.MISSING_BASE, metric, inputs);
  if (isMissing(bPerUsd)) {
    return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.MISSING_CURRENT, metric, inputs);
  }
  if (!isValidNumber(aPerUsd) || !isValidNumber(bPerUsd)) {
    return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.NON_FINITE_VALUE, metric, inputs);
  }
  if (bPerUsd === 0) return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.ZERO_BASE, metric, inputs);
  if (aPerUsd <= 0 || bPerUsd < 0) {
    return unavailable(TRANSFORMS.CROSS_RATE, TRANSFORM_NA_REASONS.NEGATIVE_BASE, metric, inputs);
  }
  return available(TRANSFORMS.CROSS_RATE, aPerUsd / bPerUsd, metric, inputs);
}

/**
 * AUTHORITATIVE HALF-OPEN PERIOD INTERVAL [startYear, endYear).
 *
 * Endpoint operations use exactly {A, B}; period operations use years
 * A..B-1. 2004 -> 2014 means 2004...2013 (10 annual observations);
 * 2014 -> 2024 means 2014...2023 (10 observations), so adjacent periods
 * are disjoint and the boundary year is never double-counted. No caller
 * may recreate this logic with different inclusive/exclusive behavior.
 *
 * @returns {{ startYear:number, endYear:number, years:number[], size:number }}
 * @throws {Error} with code INVALID_PERIOD for non-integer or empty intervals
 */
export function periodYears(startYear, endYear) {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || !(endYear > startYear)) {
    const error = new Error(
      `Period boundaries must be integer years with the end year after the start year ([A, B) is empty otherwise; got ${startYear}, ${endYear}).`,
    );
    error.code = TRANSFORM_NA_REASONS.INVALID_PERIOD;
    throw error;
  }
  const years = [];
  for (let year = startYear; year < endYear; year += 1) years.push(year);
  return { startYear, endYear, years, size: years.length };
}

function toPeriodYearMap(values) {
  const map = new Map();
  const list = Array.isArray(values) ? values : [];
  for (const entry of list) {
    if (entry && Number.isInteger(entry.year)) map.set(entry.year, entry.value);
  }
  return map;
}

function withPeriodMeta(result, period, missingYears) {
  return { ...result, years: period.years, size: period.size, missingYears };
}

/**
 * PERIOD_SUM (pure primitive): sum of annual observations over
 * [startYear, endYear). STRICT completeness, mirroring groupSum: EVERY
 * required year must hold a finite value. One missing year makes the
 * period unavailable with reason INCOMPLETE_PERIOD plus the missing-year
 * list. Missing is never zero, never interpolated, never silently skipped.
 *
 * @param {{ values: Array<{year:number,value:number}>, startYear:number, endYear:number }} inputs
 */
export function periodSum({ values, startYear, endYear } = {}, metric = null) {
  const inputs = { startYear, endYear, observations: Array.isArray(values) ? values.length : 0 };
  let period;
  try {
    period = periodYears(startYear, endYear);
  } catch {
    return {
      ...unavailable(TRANSFORMS.PERIOD_SUM, TRANSFORM_NA_REASONS.INVALID_PERIOD, metric, inputs),
      years: [],
      size: 0,
      missingYears: [],
    };
  }
  const byYear = toPeriodYearMap(values);
  const missingYears = [];
  let sum = 0;
  for (const year of period.years) {
    const value = byYear.has(year) ? byYear.get(year) : null;
    if (!isValidNumber(value)) {
      missingYears.push(year);
      continue;
    }
    sum += value;
  }
  if (missingYears.length > 0) {
    return withPeriodMeta(
      unavailable(TRANSFORMS.PERIOD_SUM, TRANSFORM_NA_REASONS.INCOMPLETE_PERIOD, metric, inputs),
      period,
      missingYears,
    );
  }
  return withPeriodMeta(available(TRANSFORMS.PERIOD_SUM, sum, metric, inputs), period, []);
}

/**
 * PERIOD_AVG (pure primitive): period sum / number of included annual
 * observations. Same strict completeness as the sum — an average over a
 * gappy period would silently redefine the period.
 */
export function periodAverage({ values, startYear, endYear } = {}, metric = null) {
  const summed = periodSum({ values, startYear, endYear }, metric);
  if (!summed.computable) {
    // Same failure, re-issued under the AVG code so provenance never claims
    // a sum formula for an average result; completeness evidence preserved.
    const failed = unavailable(TRANSFORMS.PERIOD_AVG, summed.reason, metric, {
      startYear,
      endYear,
      observations: summed.size,
    });
    return { ...failed, years: summed.years, size: summed.size, missingYears: summed.missingYears, average: null };
  }
  const result = available(TRANSFORMS.PERIOD_AVG, summed.value / summed.size, metric, {
    startYear,
    endYear,
    observations: summed.size,
  });
  return {
    ...result,
    years: summed.years,
    size: summed.size,
    missingYears: [],
    sum: summed.value,
    average: result.value,
  };
}

/**
 * PERIOD_SUM_PERCENT_CHANGE (pure primitive): ((sumB / sumA) - 1) * 100
 * with the same base/sign rules as ordinary percent change. Signed period
 * sums are summable, but a zero base, a negative base or a sign-changing
 * total never becomes an ordinary growth percentage.
 */
export function periodSumPercentChange({ sumA, sumB } = {}, metric = null) {
  const inputs = { sumA, sumB };
  if (isMissing(sumA) && isMissing(sumB)) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.BOTH_MISSING, metric, inputs);
  }
  if (isMissing(sumA)) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.MISSING_BASE, metric, inputs);
  }
  if (isMissing(sumB)) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.MISSING_CURRENT, metric, inputs);
  }
  if (!isValidNumber(sumA) || !isValidNumber(sumB)) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.NON_FINITE_VALUE, metric, inputs);
  }
  if (sumA === 0) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.ZERO_BASE, metric, inputs);
  }
  if (sumA < 0) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.NEGATIVE_BASE, metric, inputs);
  }
  if (sumB < 0) {
    return unavailable(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, TRANSFORM_NA_REASONS.SIGN_CHANGE, metric, inputs);
  }
  return available(TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, ((sumB / sumA) - 1) * 100, metric, inputs);
}

/**
 * Central dispatcher: validate capability first, compute second. Unsupported
 * operations return explicit unavailability — never a silent fallback to
 * another transformation.
 *
 * @param {object|null|undefined} metric Phase-2 registry entry
 * @param {string} transform one of TRANSFORMS
 * @param {object} inputs transform inputs ({a,b} | {a,b,years} | arrays)
 */
export function computeTransform(metric, transform, inputs = {}) {
  const gate = canTransform(metric, transform);
  if (!gate.allowed) {
    return unavailable(transform, gate.reason, metric ?? null, { ...(inputs ?? {}) });
  }
  switch (transform) {
    case TRANSFORMS.ABSOLUTE_CHANGE:
      return absoluteChange(inputs, metric);
    case TRANSFORMS.PERCENT_CHANGE:
      return percentChange(inputs, metric);
    case TRANSFORMS.PERCENTAGE_POINT_CHANGE:
      return percentagePointChange(inputs, metric);
    case TRANSFORMS.INDEX_POINT_CHANGE:
      return indexPointChange(inputs, metric);
    case TRANSFORMS.YOY:
      // YoY is percent change over consecutive years: same validity, same
      // engine, distinct provenance identity.
      // eslint-disable-next-line no-case-declarations
      const yoy = percentChange({ a: inputs?.previous ?? inputs?.a, b: inputs?.current ?? inputs?.b }, metric);
      return { ...yoy, transform: TRANSFORMS.YOY, provenance: { ...yoy.provenance, transform: TRANSFORMS.YOY, formula: TRANSFORM_FORMULAS[TRANSFORMS.YOY] } };
    case TRANSFORMS.CAGR:
      return cagr(inputs, metric);
    case TRANSFORMS.GROUP_SUM:
      return groupSum(inputs?.values ?? inputs, metric);
    case TRANSFORMS.GROUP_RATIO_FROM_SUMS:
      return groupRatioFromSums(inputs, metric);
    case TRANSFORMS.CROSS_RATE:
      return crossRate(inputs, metric);
    case TRANSFORMS.PERIOD_SUM:
      return periodSum(inputs, metric);
    case TRANSFORMS.PERIOD_AVG:
      return periodAverage(inputs, metric);
    case TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE:
      return periodSumPercentChange(inputs, metric);
    default:
      return unavailable(transform, TRANSFORM_NA_REASONS.UNSUPPORTED_TRANSFORMATION, metric, { ...(inputs ?? {}) });
  }
}

export default {
  TRANSFORMS,
  TRANSFORM_NA_REASONS,
  TRANSFORM_NA_DESCRIPTIONS,
  TRANSFORM_FORMULAS,
  canTransform,
  allowsPeriodAggregation,
  outputUnitFor,
  absoluteChange,
  percentChange,
  percentagePointChange,
  indexPointChange,
  cagr,
  groupSum,
  groupRatioFromSums,
  crossRate,
  periodYears,
  periodSum,
  periodAverage,
  periodSumPercentChange,
  computeTransform,
};
