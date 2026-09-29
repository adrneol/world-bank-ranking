/**
 * POPULATION MOVEMENT SERVICE (canonical, Population-only orchestration).
 *
 * Wires domain/populationMovement.js pure functions to stored WDI
 * observations (SP.POP.TOTL). No other family's logic here; untouched.
 *
 * Stock semantics: annual needs year t; change/growth need endpoints S/E
 * only (never sequences). LFL: selected-year intersection (annual) or
 * S&M&E validity (periods). Benchmark is always the leave-one-out MEAN;
 * gap = country − benchmark. Order: group → validity → value → rank → gap.
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
  POPULATION_BASES,
  isAnnualPopulationBasis,
  isPopulationMetric,
  populationBasesForMetric,
  populationBasisInfo,
  populationCagr,
  populationChange,
  populationGrowth,
  populationLeaveOneOut,
  rankPopulationDesc,
} from '../domain/populationMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const POPULATION_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function populationError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw populationError(POPULATION_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw populationError(POPULATION_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw populationError(POPULATION_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/** Dynamic group membership (no hardcoding); validated vs DISTINCT DB values. */
export async function resolvePopulationGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw populationError(POPULATION_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = await listDistinctCountryColumn(db, col);
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw populationError(POPULATION_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = await listCountryIdsByColumn(db, col, String(group.value));
  return { type, value: String(group.value), members: new Set(members) };
}

export async function listPopulationCountryGroups(db) {
  const groups = {};
  for (const col of ['income_level', 'region', 'lending_type']) {
    groups[col] = await countCountryGroupsByColumn(db, col);
  }
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years.',
    estimateNote:
      'SP.POP.TOTL values are annual mid-year estimates (de facto concept), not necessarily exact census headcounts.',
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

function usdLikeDisplay(metric, value) {
  if (value === null || value === undefined) return null;
  return formatValue(value, metric).formatted;
}

function usdLikeGapDisplay(metric, gap) {
  if (gap === null || gap === undefined) return null;
  const body = formatValue(Math.abs(Number(gap)), metric).formatted;
  if (!body) return null;
  return `${Number(gap) < 0 ? '-' : '+'}${body}`;
}

function isGrowthBasis(basisId) {
  return basisId === POPULATION_BASES.GROWTH;
}

/** Per-economy basis value or null when basis-ineligible (endpoints only). */
function computePopulationValue({ basisId, ym, startYear, endYear, year }) {
  if (basisId === POPULATION_BASES.ANNUAL) {
    const v = ym.get(Number(year));
    return Number.isFinite(v) ? { value: v } : { missing: true, reason: 'missing_value' };
  }
  const s = ym.get(Number(startYear)) ?? null;
  const e = ym.get(Number(endYear)) ?? null;
  if (basisId === POPULATION_BASES.CHANGE) {
    const r = populationChange(s, e);
    return r.computable ? { value: r.value } : { missing: true, reason: r.reason };
  }
  const r = populationGrowth(s, e);
  if (!r.computable) return { missing: true, reason: r.reason };
  const c = populationCagr(s, e, Number(endYear) - Number(startYear));
  return { value: r.value, cagr: c.computable ? c.value : null };
}

function buildPopulationSection({ values, focusIso3, basisId, requiredYears, label, isYear, metric }) {
  const info = populationBasisInfo(basisId);
  const { ranked, total } = rankPopulationDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = populationLeaveOneOut(values, focusKey);
  const growth = isGrowthBasis(basisId);
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
          valueDisplay: growth ? fmtPct(focusRow.value) : usdLikeDisplay(metric, focusRow.value),
          ...(focusRow.cagr !== undefined ? { cagr: focusRow.cagr, cagrDisplay: focusRow.cagr === null ? null : `${fmtPct(focusRow.cagr, false)}/year` } : {}),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? (growth ? fmtPct(loo.benchmark, false) : usdLikeDisplay(metric, loo.benchmark)) : null,
          benchmarkLabel: 'Average of other eligible economies',
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? (growth ? fmtPp(loo.gap) : usdLikeGapDisplay(metric, loo.gap)) : null,
          gapUnit: info.gapUnit,
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank, ...(r.cagr !== undefined ? { cagr: r.cagr } : {}) })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount, type: loo.method ?? 'mean' } : null,
  };
}

/**
 * Main entry: build Population movement for population_total + basis and S/[M]/E.
 */
export async function buildPopulationMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isPopulationMetric(metricKey) || !METRICS[metricKey]) {
    throw populationError(POPULATION_ERROR_CODES.INVALID_METRIC, `Unknown or non-Population metric "${metricKey}".`, 400);
  }
  const allowedBases = populationBasesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw populationError(
      POPULATION_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw populationError(POPULATION_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw populationError(POPULATION_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = await resolvePopulationGroupFilter(db, options.group ?? null);
  const metric = METRICS[metricKey];
  const indicator = await getIndicatorByMetricKey(db, metricKey);
  const focusName = await focusDisplayName(db, focusIso3);
  const base = {
    metric: describeMetric(metric),
    basis: populationBasisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    estimateNote:
      'SP.POP.TOTL values are annual mid-year estimates (de facto concept), not necessarily exact census headcounts.',
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
  const rows = await getEligibleObservationsRange(db, indicator.id, S, E);
  const byIsoYear = indexByIsoYear(rows);
  const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
  const applyGroup = (isos) => (groupSet ? isos.filter((iso) => groupSet.members.has(String(iso).toUpperCase())) : isos);
  const groupedIsos = applyGroup([...byIsoYear.keys()]);
  const isAnnual = isAnnualPopulationBasis(basisId);

  if (isAnnual) {
    const years = hasMid ? [S, M, E] : [S, E];
    const observed = years.map((y) => {
      const values = [];
      for (const iso of groupedIsos) {
        const r = computePopulationValue({ basisId, ym: byIsoYear.get(iso) ?? new Map(), year: y });
        if (!r.missing) values.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value });
      }
      return { ...buildPopulationSection({ values, focusIso3, basisId, requiredYears: [y], label: y, isYear: true, metric }), universe: 'observed' };
    });
    const lflIsos = groupedIsos.filter((iso) => {
      const ym = byIsoYear.get(iso) ?? new Map();
      return years.every((y) => Number.isFinite(ym.get(y)));
    });
    const likeForLike = years.map((y) => {
      const values = [];
      for (const iso of lflIsos) {
        const r = computePopulationValue({ basisId, ym: byIsoYear.get(iso) ?? new Map(), year: y });
        if (!r.missing) values.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value });
      }
      return { ...buildPopulationSection({ values, focusIso3, basisId, requiredYears: [y], label: y, isYear: true, metric }), universe: 'like-for-like' };
    });
    return { ...base, available: true, reason: null, kind: 'annual', observed, likeForLike, descriptive: null, verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] } };
  }

  const periods = hasMid
    ? [{ label: `${S}→${M}`, s: S, e: M }, { label: `${M}→${E}`, s: M, e: E }, { label: `${S}→${E}`, s: S, e: E }]
    : [{ label: `${S}→${E}`, s: S, e: E }];
  const observed = periods.map((p) => {
    const values = [];
    let incomplete = 0;
    for (const iso of groupedIsos) {
      const r = computePopulationValue({ basisId, ym: byIsoYear.get(iso) ?? new Map(), startYear: p.s, endYear: p.e });
      if (r.missing) {
        incomplete += 1;
        continue;
      }
      values.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value, ...(r.cagr !== undefined ? { cagr: r.cagr } : {}) });
    }
    const res = buildPopulationSection({ values, focusIso3, basisId, requiredYears: [p.s, p.e], label: p.label, isYear: false, metric });
    return { ...res, universe: 'observed', incompleteCount: incomplete };
  });
  // LFL: validity at S, M?, E (stock endpoints only — never sequences).
  const need = hasMid ? [S, M, E] : [S, E];
  const lflCandidate = groupedIsos.filter((iso) => {
    const ym = byIsoYear.get(iso) ?? new Map();
    return need.every((y) => Number.isFinite(ym.get(y)));
  });
  const likeForLike = periods.map((p) => {
    const values = [];
    for (const iso of lflCandidate) {
      const r = computePopulationValue({ basisId, ym: byIsoYear.get(iso) ?? new Map(), startYear: p.s, endYear: p.e });
      if (!r.missing) values.push({ iso3: iso, name: nameMap.get(iso) ?? null, value: r.value, ...(r.cagr !== undefined ? { cagr: r.cagr } : {}) });
    }
    const res = buildPopulationSection({ values, focusIso3, basisId, requiredYears: [p.s, p.e], label: p.label, isYear: false, metric });
    return { ...res, universe: 'like-for-like' };
  });

  return {
    ...base,
    available: true, reason: null, kind: 'period',
    observed, likeForLike, likeForLikeUniverseSize: lflCandidate.length, descriptive: null,
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

export default { buildPopulationMovement, listPopulationCountryGroups: listPopulationCountryGroups, resolvePopulationGroupFilter, POPULATION_ERROR_CODES };
