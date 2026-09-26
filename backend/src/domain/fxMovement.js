/**
 * EXCHANGE RATE MOVEMENT DOMAIN (canonical, FX-only, pure functions, no I/O).
 *
 * Authority: ExchangeRate/exchangerate.txt. Official exchange rate
 * (PA.NUS.FCRF, LCU per US$, period average) is a PRICE. Three bases:
 *   A. Annual official FX rate (raw, NEVER ranked/benchmarked).
 *   B. Annual nominal FX change ((t/t-1)-1)*100, DESC competition rank,
 *      leave-one-out MEDIAN benchmark, pp gap = country − median.
 *   C. Period nominal FX change ((E/S)-1)*100 endpoints-only, same rank/
 *      benchmark architecture; CAGR display-only secondary (same ordering).
 *
 * Frozen methodology decisions (see EXCHANGE_RATE_RANK_DIRECTION_DECISION.md):
 * - Rank direction: DESCENDING (greatest nominal depreciation → rank 1),
 *   frozen by the methodology owner. Positive % = depreciation, negative % =
 *   appreciation under LCU-per-US$ quotation. Never "best/strongest".
 * - Benchmark: leave-one-out MEDIAN (never mean — skewed distributions).
 * - Continuity: the project stores no redenomination metadata; values are
 *   calculated from stored WDI observations with a documented caveat. No
 *   fabricated detector (a large move can be economically real).
 * Shared GDP/Prices/Trade/Capital/generic engines are NEVER modified here.
 */

export const FX_METRIC_KEYS = Object.freeze(['fx_official']);

/** Rank direction frozen by the methodology owner (DESCENDING). */
export const FX_RANK_DIRECTION = 'DESC';

/** The 3 canonical bases (CAGR is display-only, never a basis). */
export const FX_BASES = Object.freeze({
  LEVEL: 'fx_annual_rate',
  ANNUAL_CHANGE: 'fx_annual_change',
  PERIOD_CHANGE: 'fx_period_change',
});

export const FX_BASIS_INFO = Object.freeze({
  [FX_BASES.LEVEL]: Object.freeze({
    id: FX_BASES.LEVEL,
    metricKey: 'fx_official',
    label: 'Annual Official FX Rate',
    question: 'What was the official annual-average exchange rate (LCU per US$)?',
    formula: 'A(i,t) = ER(i,t)',
    unit: 'LCU per US$',
    rankable: false,
    rankDirection: null,
    rankWording: null,
    benchmarkType: null,
    note: 'Not cross-country rankable: LCU magnitudes reflect currency denomination, not strength.',
  }),
  [FX_BASES.ANNUAL_CHANGE]: Object.freeze({
    id: FX_BASES.ANNUAL_CHANGE,
    metricKey: 'fx_official',
    label: 'Annual Nominal FX Change',
    question: 'How did the official nominal exchange rate move against the USD over the year?',
    formula: '((ER(t)/ER(t-1)) - 1) * 100',
    unit: '%',
    rankable: true,
    rankDirection: FX_RANK_DIRECTION,
    rankWording: 'Ranked by greatest nominal depreciation vs USD',
    benchmarkType: 'median',
    note: 'Positive = nominal depreciation vs USD; negative = nominal appreciation vs USD.',
  }),
  [FX_BASES.PERIOD_CHANGE]: Object.freeze({
    id: FX_BASES.PERIOD_CHANGE,
    metricKey: 'fx_official',
    label: 'Period Nominal FX Change',
    question: 'How did the official nominal exchange rate move against the USD between the selected endpoints?',
    formula: '((ER(E)/ER(S)) - 1) * 100',
    unit: '%',
    rankable: true,
    rankDirection: FX_RANK_DIRECTION,
    rankWording: 'Ranked by greatest nominal depreciation vs USD',
    benchmarkType: 'median',
    note: 'Endpoints only (price, not flow). CAGR shown as secondary annualized display with identical ordering.',
  }),
});

export const FX_BASES_BY_METRIC = Object.freeze({
  fx_official: Object.freeze([FX_BASES.LEVEL, FX_BASES.ANNUAL_CHANGE, FX_BASES.PERIOD_CHANGE]),
});

export function isFxMetric(metricKey) {
  return FX_METRIC_KEYS.includes(metricKey);
}

export function fxBasesForMetric(metricKey) {
  return FX_BASES_BY_METRIC[metricKey] ? [...FX_BASES_BY_METRIC[metricKey]] : [];
}

export function fxBasisInfo(basisId) {
  return FX_BASIS_INFO[basisId] ?? null;
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Annual nominal FX change (%). Requires ER(t-1) and ER(t), both valid;
 * base must be strictly positive (FX levels are positive; zero guards
 * division). Negative change (appreciation) is valid data.
 */
export function fxAnnualChange(prevValue, currentValue) {
  if (prevValue === null || prevValue === undefined || currentValue === null || currentValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(prevValue) || !isValidNumber(currentValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (prevValue <= 0) return { computable: false, value: null, reason: 'non_positive_base' };
  return { computable: true, value: (currentValue / prevValue - 1) * 100, reason: null };
}

/**
 * Period nominal FX change (%) — endpoints only. Interiors never required.
 */
export function fxPeriodChange(startValue, endValue) {
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
 * Annualized secondary display (CAGR, %). Display-only: same ordering as
 * the cumulative change for a fixed period, never a separate rank.
 */
export function fxCagr(startValue, endValue, years) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (!(years > 0)) return { computable: false, value: null, reason: 'invalid_period' };
  if (startValue <= 0) return { computable: false, value: null, reason: 'non_positive_base' };
  if (endValue < 0) return { computable: false, value: null, reason: 'negative_endpoint' };
  if (endValue === 0) return { computable: true, value: -100, reason: null };
  return { computable: true, value: (Math.pow(endValue / startValue, 1 / years) - 1) * 100, reason: null };
}

/**
 * Competition ranking in the FROZEN direction (DESC: higher value = rank 1),
 * full precision. Ties share rank; next skips (1,1,3 / spec 100/90/90/70).
 * FX-specific: never the shared ordinal engine, never Prices ASC.
 */
export function rankFxDirected(rows, direction = FX_RANK_DIRECTION) {
  const valid = (rows ?? []).filter((r) => r && r.iso3 && isValidNumber(r.value));
  const desc = direction !== 'ASC';
  const sorted = [...valid].sort((a, b) => {
    if (a.value !== b.value) return desc ? b.value - a.value : a.value - b.value;
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
  return { ranked, total: ranked.length, direction: desc ? 'DESC' : 'ASC' };
}

/** Median of finite numbers (null when empty). Pure helper, no economics. */
export function median(values) {
  const sorted = (values ?? []).filter(isValidNumber).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Leave-one-out MEDIAN benchmark (never mean): median of all OTHER eligible
 * values. Gap = COUNTRY − BENCHMARK in percentage points.
 * Positive = depreciated more than the peer median.
 */
export function fxLeaveOneOutMedian(allValues, focusIso3) {
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
  const benchmark = median(others.map((r) => r.value));
  return { computable: true, benchmark, gap: focusValue - benchmark, peerCount: others.length, reason: null };
}

export default {
  FX_METRIC_KEYS,
  FX_RANK_DIRECTION,
  FX_BASES,
  FX_BASIS_INFO,
  FX_BASES_BY_METRIC,
  isFxMetric,
  fxBasesForMetric,
  fxBasisInfo,
  fxAnnualChange,
  fxPeriodChange,
  fxCagr,
  rankFxDirected,
  median,
  fxLeaveOneOutMedian,
};
