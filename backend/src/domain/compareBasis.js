/**
 * Source-leg definitions and calculations for Movement measurement bases in
 * Compare. The Movement domain remains the formula authority; this adapter
 * gives Compare a pure interface for its frozen, mode-specific observations.
 */
import {
  EXTERNAL_BASES,
  caGdpRatio,
  cumulativeIntensity,
  externalPeriodAverage,
  externalPeriodSum,
  reserveCoverage,
} from './externalMovement.js';
import {
  CAPITAL_BASES,
  capitalCumulativeShare,
  capitalPeriodSum,
} from './capitalMovement.js';

export const COMPARE_BASIS_LEGS = Object.freeze({
  [EXTERNAL_BASES.CA_ANNUAL]: Object.freeze(['current_account', 'total_current']),
  [EXTERNAL_BASES.CA_AVERAGE]: Object.freeze(['current_account', 'total_current']),
  [EXTERNAL_BASES.CA_CUMULATIVE]: Object.freeze(['current_account', 'total_current']),
  [CAPITAL_BASES.RATIO_CUMULATIVE]: Object.freeze(['fdi_inflows', 'total_current']),
  [EXTERNAL_BASES.RES_COVERAGE]: Object.freeze(['reserves_ex_gold', 'imports_current']),
  [EXTERNAL_BASES.REMIT_INTENSITY]: Object.freeze(['remittances_received', 'total_current']),
});

const numberAt = (series, year) => {
  const value = series instanceof Map ? series.get(year) : series?.[year];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

function sumMemberLegs(legByIso, members, year) {
  let sum = 0;
  for (const iso3 of members) {
    const value = numberAt(legByIso?.get(iso3), year);
    if (value === null) return null;
    sum += value;
  }
  return members.length ? sum : null;
}

/**
 * Calculate one basis for a single country/aggregate or a custom group.
 * `legs` maps metric key -> Map(ISO3 -> Map(year -> numeric observation)).
 * Groups are calculated from summed source legs, never from member ratios.
 */
export function calculateCompareBasis({ basis, legs, iso3 = null, members = null, year = null, startYear = null, endYear = null }) {
  const group = Array.isArray(members);
  const read = (metricKey, y) => {
    if (group) return sumMemberLegs(legs?.[metricKey], members, y);
    return numberAt(legs?.[metricKey]?.get(iso3), y);
  };
  const ratio = (numeratorKey, denominatorKey, y) => {
    const n = read(numeratorKey, y);
    const d = read(denominatorKey, y);
    if (n === null || d === null) return { computable: false, value: null, reason: 'missing_leg' };
    if (numeratorKey === 'current_account' && denominatorKey === 'total_current') return caGdpRatio(n, d);
    if (numeratorKey === 'reserves_ex_gold' && denominatorKey === 'imports_current') return reserveCoverage(n, d);
    return null;
  };
  if (basis === EXTERNAL_BASES.CA_ANNUAL || basis === EXTERNAL_BASES.RES_COVERAGE) {
    return ratio(COMPARE_BASIS_LEGS[basis][0], COMPARE_BASIS_LEGS[basis][1], year);
  }
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear <= startYear) {
    return { computable: false, value: null, reason: 'invalid_period', missingYears: [] };
  }
  const requiredYears = Array.from({ length: endYear - startYear }, (_v, i) => startYear + i + 1);
  const annualRatioSeries = (numKey, denKey) => {
    const values = new Map();
    for (const y of requiredYears) {
      const result = ratio(numKey, denKey, y);
      if (!result.computable) return { computable: false, value: null, reason: result.reason, missingYears: [y] };
      values.set(y, result.value);
    }
    return values;
  };
  if (basis === EXTERNAL_BASES.CA_AVERAGE) {
    const annual = annualRatioSeries('current_account', 'total_current');
    if (!(annual instanceof Map)) return annual;
    return externalPeriodAverage(annual, requiredYears);
  }
  if (basis === EXTERNAL_BASES.CA_CUMULATIVE) {
    const ca = new Map(requiredYears.map((y) => [y, read('current_account', y)]));
    const gdp = new Map(requiredYears.map((y) => [y, read('total_current', y)]));
    return cumulativeIntensity(ca, gdp, requiredYears);
  }
  if (basis === CAPITAL_BASES.RATIO_CUMULATIVE) {
    const fdi = new Map(requiredYears.map((y) => [y, read('fdi_inflows', y)]));
    const gdp = new Map(requiredYears.map((y) => [y, read('total_current', y)]));
    return capitalCumulativeShare(fdi, gdp, requiredYears);
  }
  if (basis === EXTERNAL_BASES.REMIT_INTENSITY) {
    const remit = new Map(requiredYears.map((y) => [y, read('remittances_received', y)]));
    const gdp = new Map(requiredYears.map((y) => [y, read('total_current', y)]));
    return cumulativeIntensity(remit, gdp, requiredYears);
  }
  if (basis === CAPITAL_BASES.FDI_CUMULATIVE) {
    const fdi = new Map(requiredYears.map((y) => [y, read('fdi_inflows', y)]));
    return capitalPeriodSum(fdi, requiredYears);
  }
  if (basis === EXTERNAL_BASES.REMIT_CUMULATIVE) {
    const remit = new Map(requiredYears.map((y) => [y, read('remittances_received', y)]));
    return externalPeriodSum(remit, requiredYears);
  }
  return { computable: false, value: null, reason: 'unsupported_basis', missingYears: [] };
}

export default { COMPARE_BASIS_LEGS, calculateCompareBasis };
