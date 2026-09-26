/**
 * CAPITAL FLOW MOVEMENT DOMAIN (canonical, Capital-only, pure functions, no I/O).
 *
 * Authority: capitalflow/capitalflowmethod.txt. FDI net inflows
 * (BX.KLT.DINV.CD.WD) and FDI/GDP ratio (BX.KLT.DINV.WD.GD.ZS) are annual
 * flows. Three canonical bases per metric plus one unranked endpoint
 * diagnostic each (6 ranked bases total):
 *   FDI: annual raw; cumulative sum S+1..E; average sum/(E-S);
 *        diagnostic endpoint change (NOT ranked, NOT a basis).
 *   FDI/GDP: annual raw ratio; average ratio S+1..E; cumulative FDI /
 *        cumulative GDP ×100 over S+1..E (never summed percentages);
 *        diagnostic endpoint pp change (NOT ranked, NOT a basis).
 *
 * Deliberately NOT shared with Trade/Prices/generic engines:
 * - Periods use S+1..E (10/10/20 obs), not Trade S..E, not [S,E).
 * - Gap = COUNTRY − BENCHMARK (opposite of Prices), USD or pp per basis.
 * - Ranking is DESCENDING competition (highest first) on full precision.
 * - Negative and zero are DATA (never clamped); missing excludes.
 * - No % growth / CAGR / percent-change basis exists here by design.
 * Shared GDP/Prices/Trade/generic engines are NEVER modified by this module.
 */

export const CAPITAL_METRIC_KEYS = Object.freeze(['fdi_inflows', 'fdi_inflows_pct_gdp']);

/** GDP denominator for the cumulative FDI/GDP basis: nominal current-US$ GDP. */
export const CAPITAL_GDP_DENOMINATOR_METRIC = 'total_current';

/** The 6 canonical ranked basis IDs (diagnostics are NOT bases). */
export const CAPITAL_BASES = Object.freeze({
  FDI_ANNUAL: 'fdi_annual_value',
  FDI_CUMULATIVE: 'fdi_period_cumulative',
  FDI_AVERAGE: 'fdi_period_average',
  RATIO_ANNUAL: 'fdigdp_annual_value',
  RATIO_AVERAGE: 'fdigdp_period_average',
  RATIO_CUMULATIVE: 'fdigdp_period_cumulative_share',
});

function basisEntry(id, metricKey, label, question, formula, unit, gapUnit, rankWording, requiresSequence) {
  return Object.freeze({
    id, metricKey, label, question, formula, unit, gapUnit, rankWording,
    rankable: true, rankDirection: 'DESC', requiresSequence,
  });
}

export const CAPITAL_BASIS_INFO = Object.freeze({
  [CAPITAL_BASES.FDI_ANNUAL]: basisEntry(
    CAPITAL_BASES.FDI_ANNUAL, 'fdi_inflows', 'Annual net FDI',
    'How much net FDI entered the economy during the selected year?',
    'F(i,t) = raw WDI BX.KLT.DINV.CD.WD', 'current US$', 'current US$',
    'Ranked by largest annual net FDI inflow', false,
  ),
  [CAPITAL_BASES.FDI_CUMULATIVE]: basisEntry(
    CAPITAL_BASES.FDI_CUMULATIVE, 'fdi_inflows', 'Cumulative net FDI',
    'How much cumulative net FDI flowed into this economy during the selected period?',
    'sum(t=S+1..E) F(t)', 'current US$', 'current US$',
    'Ranked by largest cumulative net FDI inflow', true,
  ),
  [CAPITAL_BASES.FDI_AVERAGE]: basisEntry(
    CAPITAL_BASES.FDI_AVERAGE, 'fdi_inflows', 'Average annual net FDI',
    'What was the typical annual net FDI inflow during the period?',
    'sum(t=S+1..E) F(t) / (E-S)', 'current US$/year', 'current US$/year',
    'Ranked by largest average annual net FDI inflow', true,
  ),
  [CAPITAL_BASES.RATIO_ANNUAL]: basisEntry(
    CAPITAL_BASES.RATIO_ANNUAL, 'fdi_inflows_pct_gdp', 'Annual FDI (% of GDP)',
    'How large were net FDI inflows relative to the size of the economy in this year?',
    'R(i,t) = raw WDI BX.KLT.DINV.WD.GD.ZS', '% of GDP', 'percentage points',
    'Ranked by higher net FDI inflows relative to GDP', false,
  ),
  [CAPITAL_BASES.RATIO_AVERAGE]: basisEntry(
    CAPITAL_BASES.RATIO_AVERAGE, 'fdi_inflows_pct_gdp', 'Average annual FDI (% of GDP)',
    'What was the typical annual FDI inflow relative to GDP during the period?',
    'sum(t=S+1..E) R(t) / (E-S)', '% of GDP', 'percentage points',
    'Ranked by higher average annual FDI relative to GDP', true,
  ),
  [CAPITAL_BASES.RATIO_CUMULATIVE]: basisEntry(
    CAPITAL_BASES.RATIO_CUMULATIVE, 'fdi_inflows_pct_gdp', 'Cumulative FDI / cumulative GDP',
    'How large was cumulative net FDI relative to cumulative GDP over the same period?',
    '[sum(t=S+1..E) FDI(t) / sum(t=S+1..E) GDP(t)] * 100 (GDP = NY.GDP.MKTP.CD)', '% of GDP', 'percentage points',
    'Ranked by higher cumulative FDI relative to cumulative GDP', true,
  ),
});

/** Metric → its own approved subset (diagnostics never listed). */
export const CAPITAL_BASES_BY_METRIC = Object.freeze({
  fdi_inflows: Object.freeze([
    CAPITAL_BASES.FDI_ANNUAL, CAPITAL_BASES.FDI_CUMULATIVE, CAPITAL_BASES.FDI_AVERAGE,
  ]),
  fdi_inflows_pct_gdp: Object.freeze([
    CAPITAL_BASES.RATIO_ANNUAL, CAPITAL_BASES.RATIO_AVERAGE, CAPITAL_BASES.RATIO_CUMULATIVE,
  ]),
});

export function isCapitalMetric(metricKey) {
  return CAPITAL_METRIC_KEYS.includes(metricKey);
}

export function capitalBasesForMetric(metricKey) {
  return CAPITAL_BASES_BY_METRIC[metricKey] ? [...CAPITAL_BASES_BY_METRIC[metricKey]] : [];
}

export function capitalBasisInfo(basisId) {
  return CAPITAL_BASIS_INFO[basisId] ?? null;
}

export function isRatioBasis(basisId) {
  return basisId === CAPITAL_BASES.RATIO_ANNUAL
    || basisId === CAPITAL_BASES.RATIO_AVERAGE
    || basisId === CAPITAL_BASES.RATIO_CUMULATIVE;
}

export function isAnnualCapitalBasis(basisId) {
  return basisId === CAPITAL_BASES.FDI_ANNUAL || basisId === CAPITAL_BASES.RATIO_ANNUAL;
}

/**
 * Capital period expansion S+1..E (NOT S..E, NOT [S,E)).
 * 2004→2014 = 10 obs; 2004→2024 = 20. Boundary year in exactly one period.
 */
export function capitalYears(startYear, endYear) {
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

/** Required annual observations for one period S→E under a basis. */
export function capitalRequiredYears(basisId, startYear, endYear) {
  const info = capitalBasisInfo(basisId);
  if (!info) {
    const err = new Error(`Unknown Capital basis "${basisId}".`);
    err.code = 'UNKNOWN_BASIS';
    throw err;
  }
  if (basisId === CAPITAL_BASES.FDI_CUMULATIVE
    || basisId === CAPITAL_BASES.FDI_AVERAGE
    || basisId === CAPITAL_BASES.RATIO_AVERAGE
    || basisId === CAPITAL_BASES.RATIO_CUMULATIVE) {
    return capitalYears(startYear, endYear);
  }
  return [Number(startYear), Number(endYear)];
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Strict inclusive-of-requirement sum over requiredYears.
 * Negative and zero are DATA (summed normally); missing excludes.
 */
export function capitalPeriodSum(valuesByYear, requiredYears) {
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

/** Average = sum / (E-S). Same strict completeness. */
export function capitalPeriodAverage(valuesByYear, requiredYears) {
  const total = capitalPeriodSum(valuesByYear, requiredYears);
  if (!total.computable) return { ...total, average: null };
  const value = total.value / requiredYears.length;
  return { computable: true, value, reason: null, missingYears: [], sum: total.value, average: value };
}

/**
 * Cumulative FDI/GDP share: sum(FDI)/sum(GDP)*100 over S+1..E.
 * Both legs required every year. Never the sum of annual percentages.
 */
export function capitalCumulativeShare(fdiByYear, gdpByYear, requiredYears) {
  const fdi = capitalPeriodSum(fdiByYear, requiredYears);
  const gdp = capitalPeriodSum(gdpByYear, requiredYears);
  if (!fdi.computable || !gdp.computable) {
    const missing = [...new Set([...(fdi.missingYears ?? []), ...(gdp.missingYears ?? [])])].sort((a, b) => a - b);
    return {
      computable: false, value: null,
      reason: !fdi.computable && fdi.reason !== 'incomplete_period' ? fdi.reason : (!gdp.computable && gdp.reason !== 'incomplete_period' ? gdp.reason : 'incomplete_period'),
      missingYears: missing,
      missingFdiYears: fdi.missingYears ?? [],
      missingGdpYears: gdp.missingYears ?? [],
    };
  }
  if (gdp.value === 0) return { computable: false, value: null, reason: 'zero_gdp_base', missingYears: [] };
  if (gdp.value < 0) return { computable: false, value: null, reason: 'negative_gdp_base', missingYears: [] };
  return { computable: true, value: (fdi.value / gdp.value) * 100, reason: null, missingYears: [], sumFdi: fdi.value, sumGdp: gdp.value };
}

/**
 * Endpoint diagnostic (NOT a basis, NEVER ranked):
 * FDI: F_E − F_S (USD); ratio: R_E − R_S (pp). Missing → unavailable.
 */
export function capitalEndpointDiagnostic(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  return { computable: true, value: endValue - startValue, reason: null };
}

/**
 * Competition ranking DESCENDING (higher value = rank 1), full precision.
 * Rank_i = 1 + #{j : X_j > X_i}. Ties share rank; next skips.
 * Negative/zero rank naturally below positives. Capital-specific.
 */
export function rankCapitalDesc(rows) {
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
 * Leave-one-out benchmark (unweighted mean of OTHER eligible values) with
 * the Capital sign convention: gap = COUNTRY − BENCHMARK.
 * Positive = country above the other-economy average.
 */
export function capitalLeaveOneOut(allValues, focusIso3) {
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
  return { computable: true, benchmark, gap: focusValue - benchmark, peerCount: others.length, reason: null };
}

export default {
  CAPITAL_METRIC_KEYS,
  CAPITAL_GDP_DENOMINATOR_METRIC,
  CAPITAL_BASES,
  CAPITAL_BASIS_INFO,
  CAPITAL_BASES_BY_METRIC,
  isCapitalMetric,
  capitalBasesForMetric,
  capitalBasisInfo,
  isRatioBasis,
  isAnnualCapitalBasis,
  capitalYears,
  capitalRequiredYears,
  capitalPeriodSum,
  capitalPeriodAverage,
  capitalCumulativeShare,
  capitalEndpointDiagnostic,
  rankCapitalDesc,
  capitalLeaveOneOut,
};
