/**
 * TRADE MOVEMENT DOMAIN (canonical, Trade-only, pure functions, no I/O).
 *
 * Authority: trade/tademethod.txt (§§45 frozen spec). Exports
 * (NE.EXP.GNFS.CD) and imports (NE.IMP.GNFS.CD) are annual nominal
 * (current-US$) FLOWS. Four bases per metric:
 *   1. Annual trade value (raw, DESC rank, USD LOO gap)
 *   2. Period trade growth — CAGR ((E/S)^(1/(E-S))-1)*100, DESC, pp LOO
 *   3. Period total — inclusive sum S..E, DESC, USD LOO gap
 *   4. Period average — inclusive sum/(E-S+1), DESC, USD/year LOO gap
 *
 * Deliberately NOT shared with Prices or generic flow engines:
 * - Totals/averages use INCLUSIVE S..E (11/11/21 obs), never [S,E).
 * - CAGR uses endpoints only with T_S>0 gate (T_E=0 → -100%).
 * - Ranking is DESCENDING competition (highest first) on full precision.
 * - Gap = benchmark − focus (USD for levels, pp for CAGR).
 * Shared GDP/Prices/generic engines are NEVER modified by this module.
 */

export const TRADE_METRIC_KEYS = Object.freeze(['exports_current', 'imports_current']);

/** The 8 canonical metric-specific basis IDs. NOT one shared list of 8. */
export const TRADE_BASES = Object.freeze({
  EXP_ANNUAL: 'exp_annual_value',
  EXP_CAGR: 'exp_period_cagr',
  EXP_TOTAL: 'exp_period_total',
  EXP_AVERAGE: 'exp_period_average',
  IMP_ANNUAL: 'imp_annual_value',
  IMP_CAGR: 'imp_period_cagr',
  IMP_TOTAL: 'imp_period_total',
  IMP_AVERAGE: 'imp_period_average',
});

function basisEntry(id, metricKey, label, question, formula, unit, gapUnit, rankWording, requiresSequence) {
  return Object.freeze({
    id, metricKey, label, question, formula, unit, gapUnit, rankWording,
    rankable: true, rankDirection: 'DESC', requiresSequence,
  });
}

export const TRADE_BASIS_INFO = Object.freeze({
  [TRADE_BASES.EXP_ANNUAL]: basisEntry(
    TRADE_BASES.EXP_ANNUAL, 'exports_current', 'Annual export value',
    'How large was this country\u2019s export flow in the selected year?',
    'T(i,t) = raw WDI NE.EXP.GNFS.CD', 'current US$', 'current US$',
    'Ranked by largest annual export value', false,
  ),
  [TRADE_BASES.EXP_CAGR]: basisEntry(
    TRADE_BASES.EXP_CAGR, 'exports_current', 'Period export growth — CAGR',
    'At what average annual rate did nominal export value grow between the selected endpoints?',
    '((T_E/T_S)^(1/(E-S)) - 1) * 100', '%', 'percentage points',
    'Ranked by highest nominal export CAGR', false,
  ),
  [TRADE_BASES.EXP_TOTAL]: basisEntry(
    TRADE_BASES.EXP_TOTAL, 'exports_current', 'Period total export flow',
    'What was the total nominal value of exports across all years in the selected period?',
    'sum(t=S..E) T(t)', 'current US$', 'current US$',
    'Ranked by largest cumulative export flow', true,
  ),
  [TRADE_BASES.EXP_AVERAGE]: basisEntry(
    TRADE_BASES.EXP_AVERAGE, 'exports_current', 'Period average annual export flow',
    'What was the average annual nominal value of exports during the selected period?',
    'sum(t=S..E) T(t) / (E-S+1)', 'current US$/year', 'current US$/year',
    'Ranked by largest average annual export flow', true,
  ),
  [TRADE_BASES.IMP_ANNUAL]: basisEntry(
    TRADE_BASES.IMP_ANNUAL, 'imports_current', 'Annual import value',
    'How large was this country\u2019s import flow in the selected year?',
    'T(i,t) = raw WDI NE.IMP.GNFS.CD', 'current US$', 'current US$',
    'Ranked by largest annual import value', false,
  ),
  [TRADE_BASES.IMP_CAGR]: basisEntry(
    TRADE_BASES.IMP_CAGR, 'imports_current', 'Period import growth — CAGR',
    'At what average annual rate did nominal import value grow between the selected endpoints?',
    '((T_E/T_S)^(1/(E-S)) - 1) * 100', '%', 'percentage points',
    'Ranked by highest nominal import CAGR', false,
  ),
  [TRADE_BASES.IMP_TOTAL]: basisEntry(
    TRADE_BASES.IMP_TOTAL, 'imports_current', 'Period total import flow',
    'What was the total nominal value of imports across all years in the selected period?',
    'sum(t=S..E) T(t)', 'current US$', 'current US$',
    'Ranked by largest cumulative import flow', true,
  ),
  [TRADE_BASES.IMP_AVERAGE]: basisEntry(
    TRADE_BASES.IMP_AVERAGE, 'imports_current', 'Period average annual import flow',
    'What was the average annual nominal value of imports during the selected period?',
    'sum(t=S..E) T(t) / (E-S+1)', 'current US$/year', 'current US$/year',
    'Ranked by largest average annual import flow', true,
  ),
});

/** Metric → its own approved subset (never a shared list of 8). */
export const TRADE_BASES_BY_METRIC = Object.freeze({
  exports_current: Object.freeze([
    TRADE_BASES.EXP_ANNUAL, TRADE_BASES.EXP_CAGR, TRADE_BASES.EXP_TOTAL, TRADE_BASES.EXP_AVERAGE,
  ]),
  imports_current: Object.freeze([
    TRADE_BASES.IMP_ANNUAL, TRADE_BASES.IMP_CAGR, TRADE_BASES.IMP_TOTAL, TRADE_BASES.IMP_AVERAGE,
  ]),
});

export function isTradeMetric(metricKey) {
  return TRADE_METRIC_KEYS.includes(metricKey);
}

export function tradeBasesForMetric(metricKey) {
  return TRADE_BASES_BY_METRIC[metricKey] ? [...TRADE_BASES_BY_METRIC[metricKey]] : [];
}

export function tradeBasisInfo(basisId) {
  return TRADE_BASIS_INFO[basisId] ?? null;
}

export function isCagrBasis(basisId) {
  return basisId === TRADE_BASES.EXP_CAGR || basisId === TRADE_BASES.IMP_CAGR;
}

export function isAnnualBasis(basisId) {
  return basisId === TRADE_BASES.EXP_ANNUAL || basisId === TRADE_BASES.IMP_ANNUAL;
}

/**
 * INCLUSIVE calendar-year expansion S..E (NOT [S,E), NOT S+1..E).
 * 2004→2014 = 11 observations; 2004→2024 = 21.
 */
export function tradeYears(startYear, endYear) {
  const s = Number(startYear);
  const e = Number(endYear);
  if (!Number.isInteger(s) || !Number.isInteger(e) || !(e > s)) {
    const err = new Error(`Invalid period ${startYear}→${endYear}: need integer S<E.`);
    err.code = 'INVALID_PERIOD';
    throw err;
  }
  const years = [];
  for (let y = s; y <= e; y += 1) years.push(y);
  return years;
}

/** Required annual observations for one period S→E under a basis. */
export function tradeRequiredYears(basisId, startYear, endYear) {
  const info = tradeBasisInfo(basisId);
  if (!info) {
    const err = new Error(`Unknown Trade basis "${basisId}".`);
    err.code = 'UNKNOWN_BASIS';
    throw err;
  }
  if (isAnnualBasis(basisId)) return [Number(startYear), Number(endYear)].filter((y, i, a) => a.indexOf(y) === i);
  if (isCagrBasis(basisId)) return [Number(startYear), Number(endYear)];
  return tradeYears(startYear, endYear);
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * CAGR in percent. Validity (§§12,39): T_S must be strictly positive;
 * T_E must be valid and non-negative (T_E=0 → -100%, valid).
 */
export function tradeCagr(startValue, endValue, years) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (!(years > 0)) return { computable: false, value: null, reason: 'invalid_period' };
  if (startValue === 0) return { computable: false, value: null, reason: 'zero_base_for_cagr' };
  if (startValue < 0) return { computable: false, value: null, reason: 'negative_base_for_cagr' };
  if (endValue < 0) return { computable: false, value: null, reason: 'negative_endpoint_for_cagr' };
  return { computable: true, value: (Math.pow(endValue / startValue, 1 / years) - 1) * 100, reason: null };
}

/** Descriptive endpoint percent change (§34 companion to CAGR, not ranked). */
export function tradeEndpointChange(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (startValue <= 0) return { computable: false, value: null, reason: 'non_positive_base' };
  return { computable: true, value: (endValue / startValue - 1) * 100, reason: null };
}

/**
 * Inclusive period total S..E. STRICT: every required year must be present.
 */
export function tradePeriodTotal(valuesByYear, requiredYears) {
  const missing = [];
  let sum = 0;
  for (const y of requiredYears) {
    const v = valuesByYear instanceof Map ? valuesByYear.get(y) : valuesByYear?.[y];
    if (!isValidNumber(v)) {
      missing.push(y);
      continue;
    }
    sum += v;
  }
  if (missing.length > 0) {
    return { computable: false, value: null, reason: 'incomplete_period', missingYears: missing };
  }
  if (requiredYears.length === 0) {
    return { computable: false, value: null, reason: 'invalid_period', missingYears: [] };
  }
  return { computable: true, value: sum, reason: null, missingYears: [] };
}

/** Inclusive period average = total / (E-S+1). Same strict completeness. */
export function tradePeriodAverage(valuesByYear, requiredYears) {
  const total = tradePeriodTotal(valuesByYear, requiredYears);
  if (!total.computable) return { ...total, average: null };
  const value = total.value / requiredYears.length;
  return { computable: true, value, reason: null, missingYears: [], sum: total.value, average: value };
}

/**
 * Competition ranking DESCENDING (higher value = rank 1), full precision.
 * Ties share rank; next rank skips (1,1,3). Trade-specific: never reuse the
 * shared ordinal engine or the Prices ASC engine.
 */
export function rankTradeDesc(rows) {
  const valid = (rows ?? []).filter((r) => r && r.iso3 && isValidNumber(r.value));
  const sorted = [...valid].sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    return String(a.iso3) < String(b.iso3) ? -1 : String(a.iso3) > String(b.iso3) ? 1 : 0;
  });
  const ranked = [];
  let lastValue = null;
  let lastRank = 0;
  sorted.forEach((row, idx) => {
    const rank = idx === 0 || row.value !== lastValue ? idx + 1 : lastRank;
    lastValue = row.value;
    lastRank = rank;
    ranked.push({ ...row, rank });
  });
  return { ranked, total: ranked.length };
}

/**
 * Leave-one-out benchmark: unweighted mean of all OTHER eligible
 * basis-specific values (full precision). Gap = benchmark − focus.
 * For CAGR the gap unit is percentage points; for USD bases it is USD.
 */
export function tradeLeaveOneOut(allValues, focusIso3) {
  const focus = String(focusIso3).toUpperCase();
  const others = (allValues ?? []).filter(
    (r) => String(r.iso3).toUpperCase() !== focus && isValidNumber(r.value),
  );
  const focusRow = (allValues ?? []).find((r) => String(r.iso3).toUpperCase() === focus);
  const focusValue = focusRow && isValidNumber(focusRow.value) ? focusRow.value : null;
  if (focusValue === null) {
    return { computable: false, benchmark: null, gap: null, peerCount: others.length, reason: 'missing_focus_value' };
  }
  if (others.length === 0) {
    return { computable: false, benchmark: null, gap: null, peerCount: 0, reason: 'insufficient_comparison_universe' };
  }
  const sum = others.reduce((s, r) => s + r.value, 0);
  const benchmark = sum / others.length;
  return { computable: true, benchmark, gap: benchmark - focusValue, peerCount: others.length, reason: null };
}

export default {
  TRADE_METRIC_KEYS,
  TRADE_BASES,
  TRADE_BASIS_INFO,
  TRADE_BASES_BY_METRIC,
  isTradeMetric,
  tradeBasesForMetric,
  tradeBasisInfo,
  isCagrBasis,
  isAnnualBasis,
  tradeYears,
  tradeRequiredYears,
  tradeCagr,
  tradeEndpointChange,
  tradePeriodTotal,
  tradePeriodAverage,
  rankTradeDesc,
  tradeLeaveOneOut,
};
