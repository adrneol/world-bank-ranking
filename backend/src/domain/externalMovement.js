/**
 * EXTERNAL SECTOR MOVEMENT DOMAIN (canonical, External-only, pure functions, no I/O).
 *
 * Authority: ExternalSector/externalsector.txt. Three economically different
 * metrics — current account (balance/flow), reserves ex-gold (STOCK),
 * remittances received (flow) — with NON-identical bases:
 *   CA (3): annual CA/GDP; average annual CA/GDP (S+1..E); cumulative
 *           CA / cumulative GDP (S+1..E legs). All pp gaps.
 *   Reserves (3): annual stock (USD, size-only wording); endpoint % change
 *           S/E (pp); annual import coverage R/Imports*12 (months).
 *           NEVER summed across years.
 *   Remittances (4): annual; cumulative S+1..E; average; cumulative
 *           intensity ΣRemit/ΣGDP (never summed percentages).
 *
 * Frozen methodology decisions (see EXTERNAL_SECTOR_BENCHMARK_DECISION.md):
 * - Benchmark: leave-one-out, per-basis statistic — MEDIAN for raw-scale
 *   bases (reserves stock/change, remittance annual/cumulative/average),
 *   MEAN for normalized ratio bases (CA ×3, intensity, coverage).
 * - Gap = COUNTRY − BENCHMARK in basis units. Ranking DESC competition.
 * - CA/GDP derived from CA + total_current GDP legs (no GD.ZS in project).
 * - Negative/zero are DATA; missing excludes. Full precision.
 * Shared GDP/Prices/Trade/Capital/FX/generic engines NEVER modified here.
 */

export const EXTERNAL_METRIC_KEYS = Object.freeze(['current_account', 'reserves_ex_gold', 'remittances_received']);

/** GDP denominator (nominal current-US$) for CA/GDP and intensity legs. */
export const EXTERNAL_GDP_METRIC = 'total_current';
/** Imports denominator for reserve coverage. */
export const EXTERNAL_IMPORTS_METRIC = 'imports_current';

/** The 10 canonical ranked basis IDs (3 + 3 + 4). */
export const EXTERNAL_BASES = Object.freeze({
  CA_ANNUAL: 'ca_annual_gdp',
  CA_AVERAGE: 'ca_average_gdp',
  CA_CUMULATIVE: 'ca_cumulative_share',
  RES_STOCK: 'res_annual_stock',
  RES_CHANGE: 'res_period_change',
  RES_COVERAGE: 'res_import_coverage',
  REMIT_ANNUAL: 'remit_annual_value',
  REMIT_CUMULATIVE: 'remit_period_cumulative',
  REMIT_AVERAGE: 'remit_period_average',
  REMIT_INTENSITY: 'remit_cumulative_intensity',
});

function basisEntry(id, metricKey, label, question, formula, unit, gapUnit, benchmarkType, rankWording, requiresSequence) {
  return Object.freeze({
    id, metricKey, label, question, formula, unit, gapUnit, benchmarkType, rankWording,
    rankable: true, rankDirection: 'DESC', requiresSequence,
  });
}

const MEAN = 'mean';
const MEDIAN = 'median';

export const EXTERNAL_BASIS_INFO = Object.freeze({
  [EXTERNAL_BASES.CA_ANNUAL]: basisEntry(
    EXTERNAL_BASES.CA_ANNUAL, 'current_account', 'Annual CA / GDP',
    'What was the current-account balance relative to GDP in the selected year?',
    '(CA(t)/GDP(t)) * 100 from BN.CAB.XOKA.CD + NY.GDP.MKTP.CD legs', '% of GDP', 'percentage points', MEAN,
    'Ranked by higher current-account balance relative to GDP', false,
  ),
  [EXTERNAL_BASES.CA_AVERAGE]: basisEntry(
    EXTERNAL_BASES.CA_AVERAGE, 'current_account', 'Average Annual CA / GDP',
    'What was the typical annual current-account position relative to GDP during the period?',
    'sum(t=S+1..E) CA(t)/GDP(t) / (E-S)', '% of GDP', 'percentage points', MEAN,
    'Ranked by higher average annual CA relative to GDP', true,
  ),
  [EXTERNAL_BASES.CA_CUMULATIVE]: basisEntry(
    EXTERNAL_BASES.CA_CUMULATIVE, 'current_account', 'Cumulative CA / Cumulative GDP',
    'How large was cumulative net CA flow relative to cumulative GDP (GDP-weighted intensity)?',
    '[sum(t=S+1..E) CA(t) / sum(t=S+1..E) GDP(t)] * 100', '% of GDP', 'percentage points', MEAN,
    'Ranked by higher cumulative CA relative to cumulative GDP', true,
  ),
  [EXTERNAL_BASES.RES_STOCK]: basisEntry(
    EXTERNAL_BASES.RES_STOCK, 'reserves_ex_gold', 'Annual Reserve Stock',
    'What was the nominal ex-gold reserve stock at the selected date?',
    'R(t) = raw WDI FI.RES.XGLD.CD', 'current US$', 'current US$', MEDIAN,
    'Ranked by largest nominal reserve stock (size only)', false,
  ),
  [EXTERNAL_BASES.RES_CHANGE]: basisEntry(
    EXTERNAL_BASES.RES_CHANGE, 'reserves_ex_gold', 'Period Reserve-Stock Change',
    'How did the nominal reserve stock change between the selected endpoints?',
    '((R(E)/R(S)) - 1) * 100, endpoints only', '%', 'percentage points', MEDIAN,
    'Ranked by largest reserve-stock percentage change', false,
  ),
  [EXTERNAL_BASES.RES_COVERAGE]: basisEntry(
    EXTERNAL_BASES.RES_COVERAGE, 'reserves_ex_gold', 'Ex-Gold Reserve Import Coverage',
    'How many months of annual goods-and-services imports do ex-gold reserves cover?',
    '(Reserves(t)/Imports(t)) * 12', 'months', 'months', MEAN,
    'Ranked by higher ex-gold reserve import coverage', false,
  ),
  [EXTERNAL_BASES.REMIT_ANNUAL]: basisEntry(
    EXTERNAL_BASES.REMIT_ANNUAL, 'remittances_received', 'Annual Remittances Received',
    'How much personal remittance flow was received during the selected year?',
    'Remit(t) = raw WDI BX.TRF.PWKR.CD.DT', 'current US$', 'current US$', MEDIAN,
    'Ranked by largest annual remittance inflow', false,
  ),
  [EXTERNAL_BASES.REMIT_CUMULATIVE]: basisEntry(
    EXTERNAL_BASES.REMIT_CUMULATIVE, 'remittances_received', 'Cumulative Remittances Received',
    'How much remittance flow was received across the entire period?',
    'sum(t=S+1..E) Remit(t)', 'current US$', 'current US$', MEDIAN,
    'Ranked by largest cumulative remittance inflow', true,
  ),
  [EXTERNAL_BASES.REMIT_AVERAGE]: basisEntry(
    EXTERNAL_BASES.REMIT_AVERAGE, 'remittances_received', 'Average Annual Remittances',
    'What was the typical annual remittance flow scale during the period?',
    'sum(t=S+1..E) Remit(t) / (E-S)', 'current US$/year', 'current US$/year', MEDIAN,
    'Ranked by largest average annual remittance inflow', true,
  ),
  [EXTERNAL_BASES.REMIT_INTENSITY]: basisEntry(
    EXTERNAL_BASES.REMIT_INTENSITY, 'remittances_received', 'Cumulative Remittance Intensity',
    'How large were cumulative remittances relative to cumulative GDP?',
    '[sum(t=S+1..E) Remit(t) / sum(t=S+1..E) GDP(t)] * 100', '% of GDP', 'percentage points', MEAN,
    'Ranked by higher cumulative remittances relative to cumulative GDP', true,
  ),
});

/** Metric → its own approved subset (3 / 3 / 4, never forced symmetric). */
export const EXTERNAL_BASES_BY_METRIC = Object.freeze({
  current_account: Object.freeze([
    EXTERNAL_BASES.CA_ANNUAL, EXTERNAL_BASES.CA_AVERAGE, EXTERNAL_BASES.CA_CUMULATIVE,
  ]),
  reserves_ex_gold: Object.freeze([
    EXTERNAL_BASES.RES_STOCK, EXTERNAL_BASES.RES_CHANGE, EXTERNAL_BASES.RES_COVERAGE,
  ]),
  remittances_received: Object.freeze([
    EXTERNAL_BASES.REMIT_ANNUAL, EXTERNAL_BASES.REMIT_CUMULATIVE,
    EXTERNAL_BASES.REMIT_AVERAGE, EXTERNAL_BASES.REMIT_INTENSITY,
  ]),
});

export function isExternalMetric(metricKey) {
  return EXTERNAL_METRIC_KEYS.includes(metricKey);
}

export function externalBasesForMetric(metricKey) {
  return EXTERNAL_BASES_BY_METRIC[metricKey] ? [...EXTERNAL_BASES_BY_METRIC[metricKey]] : [];
}

export function externalBasisInfo(basisId) {
  return EXTERNAL_BASIS_INFO[basisId] ?? null;
}

/** Flow/balance sequence bases use S+1..E (NOT Trade S..E). */
export function externalSequenceYears(startYear, endYear) {
  const s = Number(startYear);
  const e = Number(endYear);
  if (!Number.isInteger(s) || !Number.isInteger(e) || !(e > s)) {
    const err = new Error(`Invalid period ${startYear}→${endYear}: need integer S<E.`);
    err.code = 'INVALID_PERIOD';
    throw err;
  }
  const years = [];
  for (let y = s + 1; y <= e; y += 1) years.push(y);
  return years;
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Strict sum over requiredYears. Negative/zero are DATA; missing excludes. */
export function externalPeriodSum(valuesByYear, requiredYears) {
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

export function externalPeriodAverage(valuesByYear, requiredYears) {
  const total = externalPeriodSum(valuesByYear, requiredYears);
  if (!total.computable) return { ...total, average: null };
  const value = total.value / requiredYears.length;
  return { computable: true, value, reason: null, missingYears: [], sum: total.value, average: value };
}

/** Annual CA/GDP ratio from CA+GDP legs (GDP must be strictly positive). */
export function caGdpRatio(caValue, gdpValue) {
  if (caValue === null || caValue === undefined || gdpValue === null || gdpValue === undefined) {
    return { computable: false, value: null, reason: 'missing_leg' };
  }
  if (!isValidNumber(caValue) || !isValidNumber(gdpValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (gdpValue <= 0) return { computable: false, value: null, reason: 'non_positive_gdp_base' };
  return { computable: true, value: (caValue / gdpValue) * 100, reason: null };
}

/**
 * Cumulative intensity: sum(flow)/sum(GDP)*100 over S+1..E.
 * Both legs required every year. Never summed percentages.
 */
export function cumulativeIntensity(flowByYear, gdpByYear, requiredYears) {
  const flow = externalPeriodSum(flowByYear, requiredYears);
  const gdp = externalPeriodSum(gdpByYear, requiredYears);
  if (!flow.computable || !gdp.computable) {
    const missing = [...new Set([...(flow.missingYears ?? []), ...(gdp.missingYears ?? [])])].sort((a, b) => a - b);
    return {
      computable: false, value: null,
      reason: 'incomplete_period', missingYears: missing,
      missingFlowYears: flow.missingYears ?? [], missingGdpYears: gdp.missingYears ?? [],
    };
  }
  if (gdp.value <= 0) return { computable: false, value: null, reason: 'non_positive_gdp_base', missingYears: [] };
  return { computable: true, value: (flow.value / gdp.value) * 100, reason: null, missingYears: [], sumFlow: flow.value, sumGdp: gdp.value };
}

/** Reserve endpoint % change (stock positions S/E only, S must be positive). */
export function reserveStockChange(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (startValue <= 0) return { computable: false, value: null, reason: 'non_positive_base' };
  return { computable: true, value: (endValue / startValue - 1) * 100, reason: null };
}

/** Import coverage months = reserves/imports*12 (imports must be positive). */
export function reserveCoverage(reservesValue, importsValue) {
  if (reservesValue === null || reservesValue === undefined || importsValue === null || importsValue === undefined) {
    return { computable: false, value: null, reason: 'missing_leg' };
  }
  if (!isValidNumber(reservesValue) || !isValidNumber(importsValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  if (importsValue <= 0) return { computable: false, value: null, reason: 'non_positive_imports_base' };
  return { computable: true, value: (reservesValue / importsValue) * 12, reason: null };
}

/**
 * Competition ranking DESCENDING (higher value = rank 1), full precision.
 * Rank_i = 1 + #{j : X_j > X_i}. Ties share; next skips. External-specific.
 */
export function rankExternalDesc(rows) {
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

/** Median of finite numbers (null when empty). */
export function median(values) {
  const sorted = (values ?? []).filter(isValidNumber).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  const list = (values ?? []).filter(isValidNumber);
  if (list.length === 0) return null;
  return list.reduce((s, v) => s + v, 0) / list.length;
}

/**
 * Leave-one-out benchmark with the FROZEN per-basis statistic
 * (benchmarkType 'mean' or 'median'), gap = COUNTRY − BENCHMARK.
 */
export function externalLeaveOneOut(allValues, focusIso3, benchmarkType) {
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
  const benchmark = benchmarkType === 'median' ? median(others.map((r) => r.value)) : mean(others.map((r) => r.value));
  return { computable: true, benchmark, gap: focusValue - benchmark, peerCount: others.length, reason: null, method: benchmarkType };
}

export default {
  EXTERNAL_METRIC_KEYS,
  EXTERNAL_GDP_METRIC,
  EXTERNAL_IMPORTS_METRIC,
  EXTERNAL_BASES,
  EXTERNAL_BASIS_INFO,
  EXTERNAL_BASES_BY_METRIC,
  isExternalMetric,
  externalBasesForMetric,
  externalBasisInfo,
  externalSequenceYears,
  externalPeriodSum,
  externalPeriodAverage,
  caGdpRatio,
  cumulativeIntensity,
  reserveStockChange,
  reserveCoverage,
  rankExternalDesc,
  median,
  externalLeaveOneOut,
};
