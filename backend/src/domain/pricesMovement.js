/**
 * PRICES MOVEMENT DOMAIN (canonical, Prices-only, pure functions, no I/O).
 *
 * Authority: prices/method-cpiindex.txt, prices/cpiInflationmethodology.txt,
 * prices/gdpDeflator.txt. These three files are the methodology decisions;
 * this module aligns implementation to them and NOTHING else.
 *
 * Deliberately NOT a shared generic engine:
 * - CPI Index has exactly 2 bases and explicitly rejects period totals /
 *   period averages / annualization / raw-level ranking.
 * - CPI Inflation has exactly 3 bases (annual, average S+1..E, cumulative
 *   compound S+1..E).
 * - GDP-deflator inflation has exactly 3 bases with the same structure on
 *   its own indicator.
 * - CPI Index period change uses SELECTED ENDPOINT VALUES ONLY.
 * - Inflation/deflator average+cumulative use S+1 THROUGH E (E-S observations).
 *   The generic half-open [S,E) (= S..E-1) in domain/transforms.js MUST NOT
 *   be reused here — it would be off-by-one and economically wrong.
 *
 * Shared GDP/GDP-per-capita engines are NEVER modified by this module.
 * Ranking here is competition ranking (1,1,3) ascending (lower first) on
 * full-precision values, per canonical files. The shared ranking.js ordinal
 * (distinct positions, ISO3 break) is preserved untouched for GDP.
 */

export const PRICES_METRIC_KEYS = Object.freeze([
  'inflation_cpi_index',
  'inflation_cpi',
  'inflation_deflator',
]);

/** The 8 canonical metric-specific basis IDs. NOT one shared list of 8. */
export const PRICES_BASES = Object.freeze({
  // CPI Index (FP.CPI.TOTL) — exactly 2
  CPI_INDEX_ANNUAL: 'cpi_index_annual',
  CPI_INDEX_PERIOD_CHANGE: 'cpi_index_period_change',
  // CPI Inflation (FP.CPI.TOTL.ZG) — exactly 3
  CPI_INFLATION_ANNUAL: 'cpi_inflation_annual',
  CPI_INFLATION_AVERAGE: 'cpi_inflation_average',
  CPI_INFLATION_CUMULATIVE: 'cpi_inflation_cumulative',
  // GDP-deflator inflation (NY.GDP.DEFL.KD.ZG) — exactly 3
  DEFLATOR_ANNUAL: 'deflator_annual',
  DEFLATOR_AVERAGE: 'deflator_average',
  DEFLATOR_CUMULATIVE: 'deflator_cumulative',
});

export const PRICES_BASIS_INFO = Object.freeze({
  [PRICES_BASES.CPI_INDEX_ANNUAL]: Object.freeze({
    id: PRICES_BASES.CPI_INDEX_ANNUAL,
    metricKey: 'inflation_cpi_index',
    label: 'Annual CPI index',
    description:
      'Consumer price index for the selected year, 2010 = 100. Index level, not a currency amount. Primarily for observing change within a country, not for cross-country ranking.',
    formula: 'CPILevel(i,t) = CPI(i,t)',
    unit: 'index points (2010 = 100)',
    rankable: false,
    rankDirection: null,
    requiresSequence: false,
  }),
  [PRICES_BASES.CPI_INDEX_PERIOD_CHANGE]: Object.freeze({
    id: PRICES_BASES.CPI_INDEX_PERIOD_CHANGE,
    metricKey: 'inflation_cpi_index',
    label: 'Period CPI change (%)',
    description:
      'Percentage change in the consumer price index between the selected start and end years; not annualized. Lower values mean a smaller increase in consumer prices.',
    formula: '(CPI_E / CPI_S - 1) * 100',
    unit: '%',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower cumulative consumer-price increase',
    requiresSequence: false,
  }),
  [PRICES_BASES.CPI_INFLATION_ANNUAL]: Object.freeze({
    id: PRICES_BASES.CPI_INFLATION_ANNUAL,
    metricKey: 'inflation_cpi',
    label: 'Annual CPI inflation (%)',
    description: 'Annual CPI inflation rate in the selected year.',
    formula: 'A(i,t) = Inflation(i,t)',
    unit: 'annual %',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower annual CPI inflation',
    requiresSequence: false,
  }),
  [PRICES_BASES.CPI_INFLATION_AVERAGE]: Object.freeze({
    id: PRICES_BASES.CPI_INFLATION_AVERAGE,
    metricKey: 'inflation_cpi',
    label: 'Average annual CPI inflation (%)',
    description:
      'Arithmetic average of annual CPI inflation rates over S+1 through E. Average annual rate, not total price increase.',
    formula: '(1/(E-S)) * sum(t=S+1..E) Inflation(t)',
    unit: 'annual %',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower average annual CPI inflation',
    requiresSequence: true,
  }),
  [PRICES_BASES.CPI_INFLATION_CUMULATIVE]: Object.freeze({
    id: PRICES_BASES.CPI_INFLATION_CUMULATIVE,
    metricKey: 'inflation_cpi',
    label: 'Cumulative CPI inflation (%)',
    description:
      'Compounded total consumer-price increase over S+1 through E. Inflation compounds; annual rates are never summed.',
    formula: '[prod(t=S+1..E)(1+Inflation(t)/100) - 1] * 100',
    unit: '%',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower cumulative consumer-price increase',
    requiresSequence: true,
  }),
  [PRICES_BASES.DEFLATOR_ANNUAL]: Object.freeze({
    id: PRICES_BASES.DEFLATOR_ANNUAL,
    metricKey: 'inflation_deflator',
    label: 'Annual GDP-deflator inflation (%)',
    description: 'Annual GDP-deflator inflation rate in the selected year.',
    formula: 'A(i,t) = D(i,t)',
    unit: 'annual %',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower annual GDP-deflator inflation',
    requiresSequence: false,
  }),
  [PRICES_BASES.DEFLATOR_AVERAGE]: Object.freeze({
    id: PRICES_BASES.DEFLATOR_AVERAGE,
    metricKey: 'inflation_deflator',
    label: 'Average annual GDP-deflator inflation (%)',
    description:
      'Arithmetic average of annual GDP-deflator inflation rates over S+1 through E.',
    formula: '(1/(E-S)) * sum(t=S+1..E) D(t)',
    unit: 'annual %',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower average annual GDP-deflator inflation',
    requiresSequence: true,
  }),
  [PRICES_BASES.DEFLATOR_CUMULATIVE]: Object.freeze({
    id: PRICES_BASES.DEFLATOR_CUMULATIVE,
    metricKey: 'inflation_deflator',
    label: 'Cumulative GDP-deflator inflation (%)',
    description:
      'Compounded total increase in the GDP implicit price level over S+1 through E.',
    formula: '[prod(t=S+1..E)(1+D(t)/100) - 1] * 100',
    unit: '%',
    rankable: true,
    rankDirection: 'ASC',
    rankWording: 'Ranked by lower cumulative GDP-deflator inflation',
    requiresSequence: true,
  }),
});

/** Metric → its own approved subset (never a shared list of 8). */
export const PRICES_BASES_BY_METRIC = Object.freeze({
  inflation_cpi_index: Object.freeze([
    PRICES_BASES.CPI_INDEX_ANNUAL,
    PRICES_BASES.CPI_INDEX_PERIOD_CHANGE,
  ]),
  inflation_cpi: Object.freeze([
    PRICES_BASES.CPI_INFLATION_ANNUAL,
    PRICES_BASES.CPI_INFLATION_AVERAGE,
    PRICES_BASES.CPI_INFLATION_CUMULATIVE,
  ]),
  inflation_deflator: Object.freeze([
    PRICES_BASES.DEFLATOR_ANNUAL,
    PRICES_BASES.DEFLATOR_AVERAGE,
    PRICES_BASES.DEFLATOR_CUMULATIVE,
  ]),
});

export function isPricesMetric(metricKey) {
  return PRICES_METRIC_KEYS.includes(metricKey);
}

export function basesForMetric(metricKey) {
  return PRICES_BASES_BY_METRIC[metricKey] ? [...PRICES_BASES_BY_METRIC[metricKey]] : [];
}

export function basisInfo(basisId) {
  return PRICES_BASIS_INFO[basisId] ?? null;
}

/**
 * Required annual observations for one period S→E under a basis.
 * - Endpoint bases (CPI period change): [S, E] only.
 * - Sequence bases (inflation/deflator average+cumulative): S+1..E inclusive.
 * - Annual bases: caller passes single year; this helper is for periods.
 */
export function requiredYearsForPeriod(basisId, startYear, endYear) {
  const s = Number(startYear);
  const e = Number(endYear);
  if (!Number.isInteger(s) || !Number.isInteger(e) || !(e > s)) {
    const err = new Error(`Invalid period ${startYear}→${endYear}: need integer S<E.`);
    err.code = 'INVALID_PERIOD';
    throw err;
  }
  const info = basisInfo(basisId);
  if (!info) {
    const err = new Error(`Unknown Prices basis "${basisId}".`);
    err.code = 'UNKNOWN_BASIS';
    throw err;
  }
  if (info.requiresSequence) {
    const years = [];
    for (let y = s + 1; y <= e; y += 1) years.push(y);
    return years;
  }
  return [s, e];
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** CPI Index period change: (E/S-1)*100. CPI is positive-only; zero base undefined. */
export function cpiIndexPeriodChange(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (startValue === 0) return { computable: false, value: null, reason: 'zero_base' };
  if (startValue < 0) return { computable: false, value: null, reason: 'negative_base' };
  return { computable: true, value: (endValue / startValue - 1) * 100, reason: null };
}

/** Index-point change (descriptive, Basis 1): E - S. */
export function cpiIndexPointChange(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  return { computable: true, value: endValue - startValue, reason: null };
}

/**
 * Period average over S+1..E. STRICT: every required year must be present.
 * valuesByYear: Map year→value (full precision). requiredYears: array.
 */
export function periodAverageInflation(valuesByYear, requiredYears) {
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
  return { computable: true, value: sum / requiredYears.length, reason: null, missingYears: [] };
}

/**
 * Cumulative (compounded) inflation over S+1..E. STRICT completeness.
 * Negative annual rates (deflation) are valid; factors (1+r/100) compound normally.
 */
export function cumulativeInflation(valuesByYear, requiredYears) {
  const missing = [];
  let factor = 1;
  for (const y of requiredYears) {
    const v = valuesByYear instanceof Map ? valuesByYear.get(y) : valuesByYear?.[y];
    if (!isValidNumber(v)) {
      missing.push(y);
      continue;
    }
    factor *= 1 + v / 100;
  }
  if (missing.length > 0) {
    return { computable: false, value: null, reason: 'incomplete_period', missingYears: missing };
  }
  if (requiredYears.length === 0) {
    return { computable: false, value: null, reason: 'invalid_period', missingYears: [] };
  }
  return { computable: true, value: (factor - 1) * 100, reason: null, missingYears: [] };
}

/**
 * Competition ranking ascending (lower value = rank 1), full precision.
 * Ties share rank; next rank skips (1,1,3). Denominator = eligible count.
 * Input rows: [{iso3, value}] with finite values only. Does NOT break ties
 * by ISO3 (differs deliberately from shared ranking.js ordinal for GDP).
 */
export function rankCompetitionAsc(rows) {
  const valid = (rows ?? []).filter((r) => r && r.iso3 && isValidNumber(r.value));
  const sorted = [...valid].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
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
 * Leave-one-out benchmark: mean of all OTHER eligible values (unweighted
 * arithmetic mean, full precision). Returns {benchmark, pp} where
 * pp = benchmark - focusValue. Positive PP = focus lower than benchmark.
 */
export function leaveOneOutBenchmark(allValues, focusIso3) {
  const focus = String(focusIso3).toUpperCase();
  const others = (allValues ?? []).filter(
    (r) => String(r.iso3).toUpperCase() !== focus && isValidNumber(r.value),
  );
  const focusRow = (allValues ?? []).find((r) => String(r.iso3).toUpperCase() === focus);
  const focusValue = focusRow && isValidNumber(focusRow.value) ? focusRow.value : null;
  if (focusValue === null) {
    return { computable: false, benchmark: null, pp: null, peerCount: others.length, reason: 'missing_focus_value' };
  }
  if (others.length === 0) {
    return { computable: false, benchmark: null, pp: null, peerCount: 0, reason: 'insufficient_comparison_universe' };
  }
  const sum = others.reduce((s, r) => s + r.value, 0);
  const benchmark = sum / others.length;
  return { computable: true, benchmark, pp: benchmark - focusValue, peerCount: others.length, reason: null };
}

export default {
  PRICES_METRIC_KEYS,
  PRICES_BASES,
  PRICES_BASIS_INFO,
  PRICES_BASES_BY_METRIC,
  isPricesMetric,
  basesForMetric,
  basisInfo,
  requiredYearsForPeriod,
  cpiIndexPeriodChange,
  cpiIndexPointChange,
  periodAverageInflation,
  cumulativeInflation,
  rankCompetitionAsc,
  leaveOneOutBenchmark,
};
