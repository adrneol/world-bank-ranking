/**
 * POPULATION MOVEMENT DOMAIN (canonical, Population-only, pure functions, no I/O).
 *
 * Authority: population/pop.txt. Total population (SP.POP.TOTL) is an annual
 * mid-year STOCK estimate. Three canonical bases, all endpoints-only:
 *   A. Annual population (raw, DESC rank, mean LOO gap in people).
 *   B. Period population change (E−S, DESC, mean LOO gap in people).
 *   C. Period population growth ((E/S−1)*100, DESC, mean LOO gap in pp)
 *      with CAGR as display-only secondary (identical ordering, never ranked).
 *
 * Hard rules: NEVER sum population across years (no cumulative/average/
 * S+1..E bases exist here). Negative change is valid data. Gap =
 * COUNTRY − BENCHMARK. Full precision DESC competition ranking.
 * Shared GDP/Prices/Trade/Capital/FX/External/generic engines NEVER modified.
 */

export const POPULATION_METRIC_KEYS = Object.freeze(['population_total']);

/** The 3 canonical basis IDs (CAGR is display-only, never a basis). */
export const POPULATION_BASES = Object.freeze({
  ANNUAL: 'pop_annual_value',
  CHANGE: 'pop_period_change',
  GROWTH: 'pop_period_growth',
});

function basisEntry(id, label, question, formula, unit, gapUnit, rankWording) {
  return Object.freeze({
    id, metricKey: 'population_total', label, question, formula, unit, gapUnit, rankWording,
    rankable: true, rankDirection: 'DESC', benchmarkType: 'mean', requiresSequence: false,
  });
}

export const POPULATION_BASIS_INFO = Object.freeze({
  [POPULATION_BASES.ANNUAL]: basisEntry(
    POPULATION_BASES.ANNUAL, 'Annual Population',
    'How large was the estimated population in the selected year?',
    'P(i,t) = raw WDI SP.POP.TOTL', 'people', 'people',
    'Ranked by largest population size',
  ),
  [POPULATION_BASES.CHANGE]: basisEntry(
    POPULATION_BASES.CHANGE, 'Period Population Change',
    'How many people were added/lost between the selected endpoints?',
    'P(i,E) - P(i,S), endpoints only', 'people', 'people',
    'Ranked by largest absolute population increase',
  ),
  [POPULATION_BASES.GROWTH]: basisEntry(
    POPULATION_BASES.GROWTH, 'Period Population Growth',
    'What percentage did population change by between the selected endpoints?',
    '((P(i,E)/P(i,S)) - 1) * 100, endpoints only', '%', 'percentage points',
    'Ranked by highest population growth percentage',
  ),
});

/** The single metric exposes exactly its 3 approved bases. */
export const POPULATION_BASES_BY_METRIC = Object.freeze({
  population_total: Object.freeze([
    POPULATION_BASES.ANNUAL, POPULATION_BASES.CHANGE, POPULATION_BASES.GROWTH,
  ]),
});

export function isPopulationMetric(metricKey) {
  return POPULATION_METRIC_KEYS.includes(metricKey);
}

export function populationBasesForMetric(metricKey) {
  return POPULATION_BASES_BY_METRIC[metricKey] ? [...POPULATION_BASES_BY_METRIC[metricKey]] : [];
}

export function populationBasisInfo(basisId) {
  return POPULATION_BASIS_INFO[basisId] ?? null;
}

export function isAnnualPopulationBasis(basisId) {
  return basisId === POPULATION_BASES.ANNUAL;
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Absolute endpoint change E−S (people). Negative change (decline) is valid
 * data and ranks naturally below increases. Endpoints only.
 */
export function populationChange(startValue, endValue) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) {
    return { computable: false, value: null, reason: 'missing_endpoint' };
  }
  if (!isValidNumber(startValue) || !isValidNumber(endValue)) {
    return { computable: false, value: null, reason: 'non_finite_value' };
  }
  return { computable: true, value: endValue - startValue, reason: null };
}

/**
 * Endpoint percentage growth (E/S−1)*100. Base must be strictly positive
 * (populations are positive counts); zero/negative base is unavailable,
 * never bridged or zero-filled.
 */
export function populationGrowth(startValue, endValue) {
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
 * Annualized secondary display (CAGR, %/year). Display-only: monotonic in
 * the cumulative change for a fixed period, so ordering is identical and it
 * is NEVER a separate rank, universe, or benchmark.
 */
export function populationCagr(startValue, endValue, years) {
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
 * Competition ranking DESCENDING (higher value = rank 1), full precision.
 * Rank_i = 1 + #{j : X_j > X_i}. Ties share rank; next skips.
 * Population-specific: never the shared ordinal engine.
 */
export function rankPopulationDesc(rows) {
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
 * Leave-one-out ARITHMETIC MEAN benchmark (explicit per spec for all three
 * bases). Gap = COUNTRY − BENCHMARK (people for A/B, pp for C).
 */
export function populationLeaveOneOut(allValues, focusIso3) {
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
  return { computable: true, benchmark, gap: focusValue - benchmark, peerCount: others.length, reason: null, method: 'mean' };
}

export default {
  POPULATION_METRIC_KEYS,
  POPULATION_BASES,
  POPULATION_BASIS_INFO,
  POPULATION_BASES_BY_METRIC,
  isPopulationMetric,
  populationBasesForMetric,
  populationBasisInfo,
  isAnnualPopulationBasis,
  populationChange,
  populationGrowth,
  populationCagr,
  rankPopulationDesc,
  populationLeaveOneOut,
};
