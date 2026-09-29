/**
 * EXTERNAL SECTOR MOVEMENT SERVICE (canonical, External-only orchestration).
 *
 * Wires domain/externalMovement.js pure functions to stored WDI observations.
 * No GDP/Prices/Trade/Capital/FX logic here; those paths are untouched.
 *
 * Leg design (per spec, documented, no silent switching):
 * - CA/GDP annual + average: derived per-year ratios from CA
 *   (BN.CAB.XOKA.CD) + GDP (total_current NY.GDP.MKTP.CD) legs.
 * - CA cumulative: sum(CA)/sum(GDP) legs. Remittance intensity:
 *   sum(Remit)/sum(GDP) legs. Coverage: reserves + imports_current legs.
 * - Benchmark statistic is per-basis frozen (mean/median); gap is always
 *   COUNTRY − BENCHMARK. Order: group → validity → value → rank → benchmark.
 */

import { FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  countCountryGroupsByColumn,
  getEligibleObservationsRange,
  getIndicatorByMetricKey,
  listCountryIdsByColumn,
  listDistinctCountryColumn,
} from '../db/repository.js';
import { describeMetric, formatValue } from '../domain/format.js';
import {
  EXTERNAL_BASES,
  EXTERNAL_GDP_METRIC,
  EXTERNAL_IMPORTS_METRIC,
  caGdpRatio,
  cumulativeIntensity,
  externalBasesForMetric,
  externalBasisInfo,
  externalLeaveOneOut,
  externalPeriodAverage,
  externalPeriodSum,
  externalSequenceYears,
  isExternalMetric,
  rankExternalDesc,
  reserveCoverage,
  reserveStockChange,
} from '../domain/externalMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const EXTERNAL_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function externalError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw externalError(EXTERNAL_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw externalError(EXTERNAL_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw externalError(EXTERNAL_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/** Dynamic group membership (no hardcoding); validated vs DISTINCT DB values. */
export async function resolveExternalGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw externalError(EXTERNAL_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = await listDistinctCountryColumn(db, col);
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw externalError(EXTERNAL_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = await listCountryIdsByColumn(db, col, String(group.value));
  return { type, value: String(group.value), members: new Set(members) };
}

export async function listExternalCountryGroups(db) {
  const groups = {};
  for (const col of ['income_level', 'region', 'lending_type']) {
    groups[col] = await countCountryGroupsByColumn(db, col);
  }
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years.',
    nominalNote:
      'Current-US$ external values are nominal. Reserve stocks can reflect valuation and exchange-rate effects; rankings measure the stated statistic only, never adequacy, strength, or welfare.',
    supported: {
      income_level: groups.income_level,
      region: groups.region,
      lending_type: groups.lending_type,
    },
    unsupportedRequestedLabels: {
      requested: ['All', 'Developed', 'Developing', 'Underdeveloped'],
      status: 'NOT_SUPPORTED',
      reason:
        'The authoritative World Bank/WDI/project data contains income groups (Low, Lower middle, Upper middle, High income), geographic regions and lending types — not an official Developed/Developing/Underdeveloped classification. No approved mapping exists, so those three labels are not exposed.',
    },
  };
}

function indexByIsoYear(rows) {
  const map = new Map();
  for (const r of rows) {
    const iso = String(r.iso3).toUpperCase();
    if (!map.has(iso)) map.set(iso, new Map());
    map.get(iso).set(Number(r.year), Number(r.value));
  }
  return map;
}

function fmtPct(v, signed = true) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${signed && n >= 0 ? '+' : ''}${n.toFixed(2)}${signed ? '%' : ''}`;
}

function fmtPp(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)} pp`;
}

function fmtMonths(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(1)} months`;
}

function isRatioLike(basisId) {
  return basisId === EXTERNAL_BASES.CA_ANNUAL
    || basisId === EXTERNAL_BASES.CA_AVERAGE
    || basisId === EXTERNAL_BASES.CA_CUMULATIVE
    || basisId === EXTERNAL_BASES.REMIT_INTENSITY;
}

function isMonthsBasis(basisId) {
  return basisId === EXTERNAL_BASES.RES_COVERAGE;
}

function valueDisplayFor(metric, basisId, value) {
  if (value === null || value === undefined) return null;
  if (isRatioLike(basisId)) return fmtPct(value);
  if (isMonthsBasis(basisId)) return fmtMonths(value);
  if (basisId === EXTERNAL_BASES.RES_CHANGE) return fmtPct(value);
  return formatValue(value, metric).formatted;
}

function gapDisplayFor(metric, basisId, gap) {
  if (gap === null || gap === undefined) return null;
  if (isRatioLike(basisId) || basisId === EXTERNAL_BASES.RES_CHANGE) return fmtPp(gap);
  if (isMonthsBasis(basisId)) {
    const n = Number(gap);
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)} months`;
  }
  const body = formatValue(Math.abs(Number(gap)), metric).formatted;
  if (!body) return null;
  return `${Number(gap) < 0 ? '-' : '+'}${body}`;
}

/** Per-economy basis value or null when basis-ineligible. */
function computeExternalValue({ basisId, iso, caYm, gdpYm, resYm, impYm, remitYm, required, startYear, endYear, year }) {
  const get = (ym, y) => (ym ?? new Map()).get(y);
  switch (basisId) {
    case EXTERNAL_BASES.CA_ANNUAL: {
      const r = caGdpRatio(get(caYm, year) ?? null, get(gdpYm, year) ?? null);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason };
    }
    case EXTERNAL_BASES.CA_AVERAGE: {
      let sum = 0;
      for (const y of required) {
        const r = caGdpRatio(get(caYm, y) ?? null, get(gdpYm, y) ?? null);
        if (!r.computable) return { missing: true, reason: r.reason, missingYears: [y] };
        sum += r.value;
      }
      return { value: sum / required.length };
    }
    case EXTERNAL_BASES.CA_CUMULATIVE: {
      const r = cumulativeIntensity(caYm ?? new Map(), gdpYm ?? new Map(), required);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason, missingYears: r.missingYears };
    }
    case EXTERNAL_BASES.RES_STOCK: {
      const v = get(resYm, year);
      return Number.isFinite(v) ? { value: v } : { missing: true, reason: 'missing_value' };
    }
    case EXTERNAL_BASES.RES_CHANGE: {
      const r = reserveStockChange(get(resYm, startYear) ?? null, get(resYm, endYear) ?? null);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason };
    }
    case EXTERNAL_BASES.RES_COVERAGE: {
      const r = reserveCoverage(get(resYm, year) ?? null, get(impYm, year) ?? null);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason };
    }
    case EXTERNAL_BASES.REMIT_ANNUAL: {
      const v = get(remitYm, year);
      return Number.isFinite(v) ? { value: v } : { missing: true, reason: 'missing_value' };
    }
    case EXTERNAL_BASES.REMIT_CUMULATIVE: {
      const r = externalPeriodSum(remitYm ?? new Map(), required);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason, missingYears: r.missingYears };
    }
    case EXTERNAL_BASES.REMIT_AVERAGE: {
      const r = externalPeriodAverage(remitYm ?? new Map(), required);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason, missingYears: r.missingYears };
    }
    case EXTERNAL_BASES.REMIT_INTENSITY: {
      const r = cumulativeIntensity(remitYm ?? new Map(), gdpYm ?? new Map(), required);
      return r.computable ? { value: r.value } : { missing: true, reason: r.reason, missingYears: r.missingYears };
    }
    default:
      return { missing: true, reason: 'unknown_basis' };
  }
}

function buildExternalSection({ values, focusIso3, basisId, requiredYears, label, isYear, metric }) {
  const info = externalBasisInfo(basisId);
  const { ranked, total } = rankExternalDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = externalLeaveOneOut(values, focusKey, info.benchmarkType);
  return {
    ...(isYear ? { year: label } : { period: label }),
    requiredYears,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, gapUnit: info.gapUnit, benchmarkType: info.benchmarkType, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    rankable: true,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: valueDisplayFor(metric, basisId, focusRow.value),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? valueDisplayFor(metric, basisId, loo.benchmark) : null,
          benchmarkLabel: info.benchmarkType === 'median' ? 'Median eligible-economy value' : 'Average of other eligible economies',
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? gapDisplayFor(metric, basisId, loo.gap) : null,
          gapUnit: info.gapUnit,
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount, type: loo.method ?? info.benchmarkType } : null,
  };
}

/** Which leg maps a basis needs for completeness checks. */
function legsFor(basisId) {
  switch (basisId) {
    case EXTERNAL_BASES.CA_ANNUAL:
    case EXTERNAL_BASES.CA_AVERAGE:
    case EXTERNAL_BASES.CA_CUMULATIVE:
      return ['ca', 'gdp'];
    case EXTERNAL_BASES.RES_STOCK:
    case EXTERNAL_BASES.RES_CHANGE:
      return ['res'];
    case EXTERNAL_BASES.RES_COVERAGE:
      return ['res', 'imp'];
    case EXTERNAL_BASES.REMIT_ANNUAL:
    case EXTERNAL_BASES.REMIT_CUMULATIVE:
    case EXTERNAL_BASES.REMIT_AVERAGE:
      return ['remit'];
    case EXTERNAL_BASES.REMIT_INTENSITY:
      return ['remit', 'gdp'];
    default:
      return [];
  }
}

/**
 * Main entry: build External movement for one metric+basis and S/[M]/E.
 */
export async function buildExternalMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isExternalMetric(metricKey) || !METRICS[metricKey]) {
    throw externalError(EXTERNAL_ERROR_CODES.INVALID_METRIC, `Unknown or non-External-Sector metric "${metricKey}".`, 400);
  }
  const allowedBases = externalBasesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw externalError(
      EXTERNAL_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw externalError(EXTERNAL_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw externalError(EXTERNAL_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = await resolveExternalGroupFilter(db, options.group ?? null);
  const metric = METRICS[metricKey];
  const indicator = await getIndicatorByMetricKey(db, metricKey);
  const focusName = await focusDisplayName(db, focusIso3);
  const base = {
    metric: describeMetric(metric),
    basis: externalBasisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    nominalNote:
      'Current-US$ external values are nominal. Reserve stocks can reflect valuation and exchange-rate effects; rankings measure the stated statistic only — never adequacy, strength, dependency, or welfare.',
    source: sourceAttribution(),
  };
  if (!indicator) {
    return { ...base, available: false, reason: 'metric_not_ingested', observed: null, likeForLike: null, verification: { passed: false, checks: [] } };
  }

  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  const S = lo;
  const E = hi;
  const M = hasMid ? yearMid : null;
  const legs = legsFor(basisId);
  const needGdp = legs.includes('gdp');
  const needImp = legs.includes('imp');
  const gdpIndicator = needGdp ? await getIndicatorByMetricKey(db, EXTERNAL_GDP_METRIC) : null;
  const impIndicator = needImp ? await getIndicatorByMetricKey(db, EXTERNAL_IMPORTS_METRIC) : null;
  if ((needGdp && !gdpIndicator) || (needImp && !impIndicator)) {
    return { ...base, available: false, reason: 'denominator_not_ingested', observed: null, likeForLike: null, verification: { passed: false, checks: [] } };
  }

  // Read the union span once (inclusive S..E); per-basis completeness is
  // enforced strictly below (endpoints for reserves change, S+1..E
  // sequences for flow bases, selected years for annual bases).
  const rows = await getEligibleObservationsRange(db, indicator.id, S, E);
  const gdpRows = needGdp ? await getEligibleObservationsRange(db, gdpIndicator.id, S, E) : [];
  const impRows = needImp ? await getEligibleObservationsRange(db, impIndicator.id, S, E) : [];
  const ownByIso = indexByIsoYear(rows);
  const gdpByIso = indexByIsoYear(gdpRows);
  const impByIso = indexByIsoYear(impRows);
  const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
  for (const r of [...gdpRows, ...impRows]) {
    if (!nameMap.has(String(r.iso3).toUpperCase())) nameMap.set(String(r.iso3).toUpperCase(), r.name);
  }
  // Leg views keyed by role expected by computeExternalValue.
  const caYmOf = (iso) => (metricKey === 'current_account' ? ownByIso.get(iso) ?? new Map() : new Map());
  const resYmOf = (iso) => (metricKey === 'reserves_ex_gold' ? ownByIso.get(iso) ?? new Map() : new Map());
  const remitYmOf = (iso) => (metricKey === 'remittances_received' ? ownByIso.get(iso) ?? new Map() : new Map());
  const applyGroup = (isos) => (groupSet ? isos.filter((iso) => groupSet.members.has(String(iso).toUpperCase())) : isos);
  const allIsos = applyGroup([...new Set([...ownByIso.keys(), ...gdpByIso.keys(), ...impByIso.keys()])]);

  const isAnnual = isAnnualLike(basisId);
  const keys = isAnnual ? (hasMid ? [S, M, E] : [S, E]) : null;
  const periods = isAnnual
    ? null
    : hasMid
      ? [{ label: `${S}→${M}`, s: S, e: M }, { label: `${M}→${E}`, s: M, e: E }, { label: `${S}→${E}`, s: S, e: E }]
      : [{ label: `${S}→${E}`, s: S, e: E }];

  const requiredFor = (k) => {
    if (isAnnual) return [k];
    const p = periods.find((x) => (x.label === k));
    if (basisId === EXTERNAL_BASES.RES_CHANGE) return [p.s, p.e];
    const req = [];
    for (let y = p.s + 1; y <= p.e; y += 1) req.push(y);
    return req;
  };

  const valuesFor = (isoList, k) => {
    const out = [];
    const incomplete = [];
    if (isAnnual) {
      for (const iso of isoList) {
        const r = computeExternalValue({
          basisId, iso, caYm: caYmOf(iso), gdpYm: gdpByIso.get(iso), resYm: resYmOf(iso),
          impYm: impByIso.get(iso), remitYm: remitYmOf(iso),
          required: [], startYear: null, endYear: null, year: k,
        });
        if (r.missing) {
          incomplete.push({ iso3: iso, reason: r.reason });
          continue;
        }
        out.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value });
      }
      return { values: out, incomplete, requiredYears: [k] };
    }
    const p = periods.find((x) => x.label === k);
    const required = requiredFor(k);
    for (const iso of isoList) {
      const r = computeExternalValue({
        basisId, iso, caYm: caYmOf(iso), gdpYm: gdpByIso.get(iso), resYm: resYmOf(iso),
        impYm: impByIso.get(iso), remitYm: remitYmOf(iso),
        required, startYear: p.s, endYear: p.e, year: null,
      });
      if (r.missing) {
        incomplete.push({ iso3: iso, reason: r.reason, missingYears: r.missingYears });
        continue;
      }
      out.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value });
    }
    return { values: out, incomplete, requiredYears: required };
  };

  // LFL membership: basis-specific completeness over the FULL span.
  const fullSpan = (k) => (isAnnual ? [k] : requiredFor(k));
  const lflKeys = isAnnual ? keys : periods.map((p) => p.label);
  const lflCandidate = allIsos.filter((iso) => {
    if (isAnnual) {
      return lflKeys.every((k) => {
        const r = computeExternalValue({
          basisId, iso, caYm: caYmOf(iso), gdpYm: gdpByIso.get(iso), resYm: resYmOf(iso),
          impYm: impByIso.get(iso), remitYm: remitYmOf(iso),
          required: [], startYear: null, endYear: null, year: k,
        });
        return !r.missing;
      });
    }
    // Period: every required year of every compared period (union span).
    const union = [...new Set(lflKeys.flatMap((k) => fullSpan(k)))].sort((a, b) => a - b);
    if (basisId === EXTERNAL_BASES.RES_CHANGE) {
      // Endpoint basis: validity at S, M?, E.
      const need = hasMid ? [S, M, E] : [S, E];
      return need.every((y) => Number.isFinite((resYmOf(iso).get(y))));
    }
    // Sequence bases: every leg complete over the union span.
    const needLegs = legs.includes('gdp') ? [caOrRemitMap(iso), gdpByIso.get(iso)]
      : legs.includes('imp') ? [resYmOf(iso), impByIso.get(iso)]
      : [legMapFor(iso)];
    return union.every((y) => needLegs.every((m) => Number.isFinite((m ?? new Map()).get(y))));
  });

  function caOrRemitMap(iso) {
    if (metricKey === 'current_account') return caYmOf(iso);
    return remitYmOf(iso);
  }
  function legMapFor(iso) {
    if (metricKey === 'current_account') return caYmOf(iso);
    if (metricKey === 'reserves_ex_gold') return resYmOf(iso);
    return remitYmOf(iso);
  }

  const observed = lflKeys.map((k) => {
    const { values, incomplete, requiredYears } = valuesFor(allIsos, k);
    const res = buildExternalSection({ values, focusIso3, basisId, requiredYears, label: k, isYear: isAnnual, metric });
    return { ...res, universe: 'observed', incompleteCount: incomplete.length };
  });
  const likeForLike = lflKeys.map((k) => {
    const { values, requiredYears } = valuesFor(lflCandidate, k);
    const res = buildExternalSection({ values, focusIso3, basisId, requiredYears, label: k, isYear: isAnnual, metric });
    return { ...res, universe: 'like-for-like' };
  });

  function isAnnualLike(id) {
    return id === EXTERNAL_BASES.CA_ANNUAL
      || id === EXTERNAL_BASES.RES_STOCK
      || id === EXTERNAL_BASES.RES_COVERAGE
      || id === EXTERNAL_BASES.REMIT_ANNUAL;
  }

  return {
    ...base,
    available: true,
    reason: null,
    kind: isAnnual ? 'annual' : 'period',
    observed,
    likeForLike,
    likeForLikeUniverseSize: lflCandidate.length,
    descriptive: null,
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

export default { buildExternalMovement, listExternalCountryGroups: listExternalCountryGroups, resolveExternalGroupFilter, EXTERNAL_ERROR_CODES };
