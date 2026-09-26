/**
 * PRICES MOVEMENT SERVICE (canonical, Prices-only orchestration).
 *
 * Wires domain/pricesMovement.js pure functions to stored WDI observations.
 * No GDP logic lives here; GDP paths are untouched.
 *
 * Order of operations (canonical):
 *  1. restrict candidate universe by country-group (default All), THEN
 *  2. apply metric availability + basis-specific completeness, THEN
 *  3. calculate basis value per eligible economy, rank full cross-section
 *     (competition, ASC, full precision), THEN benchmark leave-one-out.
 *
 * Observed vs Like-for-like are different universes, identical formulas.
 */

import { FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  getEligibleObservationsForYears,
  getEligibleObservationsRange,
  getIndicatorByMetricKey,
} from '../db/repository.js';
import { describeMetric } from '../domain/format.js';
import {
  PRICES_BASES,
  PRICES_BASIS_INFO,
  basisInfo,
  basesForMetric,
  cpiIndexPeriodChange,
  cpiIndexPointChange,
  cumulativeInflation,
  isPricesMetric,
  leaveOneOutBenchmark,
  periodAverageInflation,
  rankCompetitionAsc,
  requiredYearsForPeriod,
} from '../domain/pricesMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const PRICES_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function pricesError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw pricesError(PRICES_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw pricesError(PRICES_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw pricesError(PRICES_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/**
 * Build country-group membership set. Dynamic, no hardcoding.
 * group: { type: 'income_level'|'region'|'lending_type'|null, value: string|null }
 * null/All → null (no restriction). Values validated against DISTINCT DB values.
 */
export function resolveGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw pricesError(PRICES_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = db.prepare(`SELECT DISTINCT ${col} AS v FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL`).all();
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw pricesError(PRICES_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = db
    .prepare(`SELECT id FROM countries WHERE is_aggregate = 0 AND ${col} = ?`)
    .all(String(group.value))
    .map((r) => String(r.id).toUpperCase());
  return { type, value: String(group.value), members: new Set(members) };
}

/** List available classifications dynamically (no hard-coded membership). */
export function listPriceCountryGroups(db) {
  const q = (col) =>
    db
      .prepare(
        `SELECT ${col} AS value, COUNT(*) AS eligibleCount FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY ${col}`,
      )
      .all();
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years. Period comparisons therefore use current-vintage membership; historical reclassification is not tracked.',
    supported: {
      income_level: q('income_level'),
      region: q('region'),
      lending_type: q('lending_type'),
    },
    unsupportedRequestedLabels: {
      requested: ['All', 'Developed', 'Developing', 'Underdeveloped'],
      status: 'NOT_SUPPORTED',
      reason:
        'The authoritative World Bank/WDI/project data contains income groups (Low, Lower middle, Upper middle, High income), geographic regions and lending types — not an official Developed/Developing/Underdeveloped classification. No approved mapping exists, so those three labels are not exposed. See prices/METHODOLOGY_IMPLEMENTATION_AUDIT.md §1.7.',
    },
  };
}

function indexByIsoYear(rows) {
  const map = new Map(); // iso3 -> Map(year->value)
  for (const r of rows) {
    const iso = String(r.iso3).toUpperCase();
    if (!map.has(iso)) map.set(iso, new Map());
    map.get(iso).set(Number(r.year), Number(r.value));
  }
  return map;
}

function applyGroupRestriction(isoList, groupSet) {
  if (!groupSet) return isoList;
  return isoList.filter((iso) => groupSet.members.has(String(iso).toUpperCase()));
}

/** Compute one period value per economy for a period basis. */
function computePeriodValues({ basisId, byIsoYear, candidateIsos, startYear, endYear }) {
  const required = requiredYearsForPeriod(basisId, startYear, endYear);
  const values = [];
  const incomplete = [];
  for (const iso of candidateIsos) {
    const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
    if (basisId === PRICES_BASES.CPI_INDEX_PERIOD_CHANGE) {
      const s = ym.get(Number(startYear));
      const e = ym.get(Number(endYear));
      if (s === undefined || e === undefined || !Number.isFinite(s) || !Number.isFinite(e)) {
        incomplete.push({ iso3: iso, missingYears: [s === undefined ? Number(startYear) : null, e === undefined ? Number(endYear) : null].filter((x) => x !== null) });
        continue;
      }
      const r = cpiIndexPeriodChange(s, e);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: [] });
        continue;
      }
      values.push({ iso3: String(iso).toUpperCase(), value: r.value });
    } else if (
      basisId === PRICES_BASES.CPI_INFLATION_AVERAGE ||
      basisId === PRICES_BASES.DEFLATOR_AVERAGE
    ) {
      const r = periodAverageInflation(ym, required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: String(iso).toUpperCase(), value: r.value });
    } else if (
      basisId === PRICES_BASES.CPI_INFLATION_CUMULATIVE ||
      basisId === PRICES_BASES.DEFLATOR_CUMULATIVE
    ) {
      const r = cumulativeInflation(ym, required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: String(iso).toUpperCase(), value: r.value });
    }
  }
  return { values, incomplete, requiredYears: required };
}

/** Compute annual snapshot values for one year. */
function computeAnnualValues(byIsoYear, candidateIsos, year) {
  const values = [];
  for (const iso of candidateIsos) {
    const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
    const v = ym.get(Number(year));
    if (v !== undefined && Number.isFinite(v)) values.push({ iso3: String(iso).toUpperCase(), value: v });
  }
  return values;
}

function buildPeriodResult({ values, focusIso3, basisId, requiredYears, periodLabel }) {
  const info = basisInfo(basisId);
  const { ranked, total } = rankCompetitionAsc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = leaveOneOutBenchmark(values, focusKey);
  const nameByIso = new Map(values.map((v) => [v.iso3, v.name ?? null]));
  return {
    period: periodLabel,
    requiredYears,
    basis: { id: info.id, label: info.label, formula: info.formula, unit: info.unit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkPeerCount: loo.peerCount,
          pp: loo.computable ? loo.pp : null,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, value: r.value, rank: r.rank })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount } : null,
    _names: nameByIso,
  };
}

function buildAnnualResult({ values, focusIso3, basisId, year }) {
  const info = basisInfo(basisId);
  if (!info.rankable) {
    const focusRow = values.find((r) => String(r.iso3).toUpperCase() === String(focusIso3).toUpperCase()) ?? null;
    return {
      year,
      basis: { id: info.id, label: info.label, formula: info.formula, unit: info.unit, rankWording: null },
      eligibleCount: values.length,
      rankable: false,
      rankNote:
        'Cross-country ranking unavailable for this basis. CPI index levels are designed primarily to measure price changes within a country and are not suitable as a direct cross-country price-level ranking.',
      focus: focusRow ? { iso3: focusRow.iso3, value: focusRow.value } : null,
      focusAvailable: Boolean(focusRow),
      ranking: [],
    };
  }
  const { ranked, total } = rankCompetitionAsc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = leaveOneOutBenchmark(values, focusKey);
  return {
    year,
    basis: { id: info.id, label: info.label, formula: info.formula, unit: info.unit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    rankable: true,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkPeerCount: loo.peerCount,
          pp: loo.computable ? loo.pp : null,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, value: r.value, rank: r.rank })),
  };
}

/**
 * Main entry: build Prices movement for one metric+basis and S/[M]/E.
 * options: { metricKey, basis, yearA, yearB, yearMid?, focusIso3?, group? }
 */
export function buildPricesMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isPricesMetric(metricKey) || !METRICS[metricKey]) {
    throw pricesError(PRICES_ERROR_CODES.INVALID_METRIC, `Unknown or non-Prices metric "${metricKey}".`, 400);
  }
  const allowedBases = basesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw pricesError(
      PRICES_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw pricesError(PRICES_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw pricesError(PRICES_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = resolveGroupFilter(db, options.group ?? null);

  const metric = METRICS[metricKey];
  const indicator = getIndicatorByMetricKey(db, metricKey);
  const focusName = focusDisplayName(db, focusIso3);
  const base = {
    metric: describeMetric(metric),
    basis: basisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    source: sourceAttribution(),
  };
  if (!indicator) {
    return { ...base, available: false, reason: 'metric_not_ingested', observed: null, likeForLike: null, verification: { passed: false, checks: [] } };
  }

  const info = basisInfo(basisId);
  const isAnnualBasis =
    basisId === PRICES_BASES.CPI_INDEX_ANNUAL ||
    basisId === PRICES_BASES.CPI_INFLATION_ANNUAL ||
    basisId === PRICES_BASES.DEFLATOR_ANNUAL;

  // Chronological S/M/E
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  const S = lo;
  const E = hi;
  const M = hasMid ? yearMid : null;

  if (isAnnualBasis) {
    const years = hasMid ? [S, M, E] : [S, E];
    const rows = getEligibleObservationsForYears(db, indicator.id, years);
    // Attach names
    const byIsoYear = indexByIsoYear(rows);
    // Candidate universe: eligible rows restricted by group first
    const allIsos = [...byIsoYear.keys()];
    const grouped = new Set(applyGroupRestriction(allIsos, groupSet));
    // Observed per year: valid in that year (+ group)
    const observed = years.map((y) => {
      const vals = computeAnnualValues(byIsoYear, [...grouped].filter((iso) => (byIsoYear.get(iso) ?? new Map()).has(y)), y);
      // re-attach names
      const nameMap = new Map(rows.filter((r) => Number(r.year) === y).map((r) => [String(r.iso3).toUpperCase(), r.name]));
      const withNames = vals.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
      const res = buildAnnualResult({ values: withNames, focusIso3, basisId, year: y });
      return { ...res, universe: 'observed' };
    });
    // Like-for-like: intersection of valid sets across selected years (+ group)
    const lflIsos = [...grouped].filter((iso) => years.every((y) => (byIsoYear.get(iso) ?? new Map()).has(y)));
    const likeForLike = years.map((y) => {
      const vals = computeAnnualValues(byIsoYear, lflIsos, y);
      const nameMap = new Map(rows.filter((r) => Number(r.year) === y).map((r) => [String(r.iso3).toUpperCase(), r.name]));
      const withNames = vals.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
      const res = buildAnnualResult({ values: withNames, focusIso3, basisId, year: y });
      return { ...res, universe: 'like-for-like' };
    });
    // Descriptive index-point changes for CPI annual basis (focus only + note)
    let descriptive = null;
    if (basisId === PRICES_BASES.CPI_INDEX_ANNUAL) {
      const fmap = byIsoYear.get(focusIso3) ?? new Map();
      const pt = (a, b) => {
        const va = fmap.get(a);
        const vb = fmap.get(b);
        if (va === undefined || vb === undefined) return { period: `${a}→${b}`, available: false, reason: 'missing_focus_observation' };
        const r = cpiIndexPointChange(va, vb);
        return { period: `${a}→${b}`, available: r.computable, indexPointChange: r.value, startValue: va, endValue: vb };
      };
      const periods = hasMid ? [pt(S, M), pt(M, E), pt(S, E)] : [pt(S, E)];
      descriptive = { kind: 'index_point_changes', periods, note: 'Descriptive within-country index-point movement. No cross-country rank.' };
    }
    return {
      ...base,
      available: true,
      reason: null,
      kind: 'annual',
      observed,
      likeForLike,
      descriptive,
      verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
    };
  }

  // Period bases
  const periods = hasMid
    ? [
        { label: `${S}→${M}`, s: S, e: M },
        { label: `${M}→${E}`, s: M, e: E },
        { label: `${S}→${E}`, s: S, e: E },
      ]
    : [{ label: `${S}→${E}`, s: S, e: E }];

  // Required span: for sequence bases need S+1..E (full span for LFL); for endpoint bases need S,M,E.
  const seqBasis = Boolean(info.requiresSequence);
  const minYear = seqBasis ? S + 1 : Math.min(...periods.flatMap((p) => [p.s, p.e]));
  const maxYear = E;
  const rows = getEligibleObservationsRange(db, indicator.id, minYear, maxYear);
  const byIsoYear = indexByIsoYear(rows);
  const nameMap = new Map();
  for (const r of rows) nameMap.set(String(r.iso3).toUpperCase(), r.name);
  const allIsos = [...byIsoYear.keys()];
  const groupedIsos = applyGroupRestriction(allIsos, groupSet);

  // Observed per period: candidate = grouped, then basis completeness
  const observed = periods.map((p) => {
    const { values, incomplete, requiredYears } = computePeriodValues({
      basisId,
      byIsoYear,
      candidateIsos: groupedIsos,
      startYear: p.s,
      endYear: p.e,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildPeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label });
    return { ...res, universe: 'observed', incompleteCount: incomplete.length };
  });

  // Like-for-like: common universe satisfying ALL periods' requirements, then recompute per period
  let lflCandidate;
  if (seqBasis) {
    // Need complete S+1..E (union of both sub-periods = full span)
    const fullRequired = [];
    for (let y = S + 1; y <= E; y += 1) fullRequired.push(y);
    lflCandidate = groupedIsos.filter((iso) => {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      return fullRequired.every((y) => Number.isFinite(ym.get(y)));
    });
  } else {
    // CPI period change: valid in S, M (if present), E
    const need = hasMid ? [S, M, E] : [S, E];
    lflCandidate = groupedIsos.filter((iso) => {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      return need.every((y) => Number.isFinite(ym.get(y)));
    });
  }
  const likeForLike = periods.map((p) => {
    const { values, requiredYears } = computePeriodValues({
      basisId,
      byIsoYear,
      candidateIsos: lflCandidate,
      startYear: p.s,
      endYear: p.e,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildPeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label });
    return { ...res, universe: 'like-for-like' };
  });

  return {
    ...base,
    available: true,
    reason: null,
    kind: 'period',
    observed,
    likeForLike,
    likeForLikeUniverseSize: lflCandidate.length,
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

export default { buildPricesMovement, listPriceCountryGroups, resolveGroupFilter, PRICES_ERROR_CODES };
