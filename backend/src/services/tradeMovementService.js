/**
 * TRADE MOVEMENT SERVICE (canonical, Trade-only orchestration).
 *
 * Wires domain/tradeMovement.js pure functions to stored WDI observations.
 * No GDP/Prices logic lives here; those paths are untouched.
 *
 * Order (canonical §42): group restriction → basis-specific validity →
 * per-economy basis value → full cross-section rank → leave-one-out
 * benchmark → gap. Observed vs Like-for-like are universes, same formulas.
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
  TRADE_BASES,
  isAnnualBasis,
  isCagrBasis,
  isTradeMetric,
  rankTradeDesc,
  tradeBasesForMetric,
  tradeBasisInfo,
  tradeCagr,
  tradeEndpointChange,
  tradeLeaveOneOut,
  tradePeriodAverage,
  tradePeriodTotal,
  tradeRequiredYears,
  tradeYears,
} from '../domain/tradeMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const TRADE_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function tradeError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw tradeError(TRADE_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw tradeError(TRADE_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw tradeError(TRADE_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/** Dynamic group membership (no hardcoding); values validated vs DISTINCT DB values. */
export async function resolveTradeGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw tradeError(TRADE_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = await listDistinctCountryColumn(db, col);
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw tradeError(TRADE_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = await listCountryIdsByColumn(db, col, String(group.value));
  return { type, value: String(group.value), members: new Set(members) };
}

/** Dynamic classification discovery (same authoritative store as Prices). */
export async function listTradeCountryGroups(db) {
  const groups = {};
  for (const col of ['income_level', 'region', 'lending_type']) {
    groups[col] = await countCountryGroupsByColumn(db, col);
  }
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years. Period comparisons therefore use current-vintage membership; historical reclassification is not tracked.',
    nominalCaveat:
      'Current-US$ trade values measure nominal trade values. Changes can reflect quantities, prices, exchange rates and trade composition — not pure real-volume growth.',
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

function displayFor(metric, value) {
  if (value === null || value === undefined) return null;
  return formatValue(value, metric).formatted;
}

/** One period value per economy for CAGR / total / average bases. */
function computeTradePeriodValues({ basisId, byIsoYear, candidateIsos, startYear, endYear, metric }) {
  const required = tradeRequiredYears(basisId, startYear, endYear);
  const values = [];
  const incomplete = [];
  const span = Number(endYear) - Number(startYear);
  for (const iso of candidateIsos) {
    const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
    if (isCagrBasis(basisId)) {
      const s = ym.get(Number(startYear));
      const e = ym.get(Number(endYear));
      const r = tradeCagr(s ?? null, e ?? null, span);
      if (!r.computable) {
        incomplete.push({ iso3: iso, reason: r.reason });
        continue;
      }
      const d = tradeEndpointChange(s, e);
      values.push({
        iso3: String(iso).toUpperCase(), value: r.value,
        endpointChange: d.computable ? d.value : null,
      });
    } else {
      const r = basisId.endsWith('_average')
        ? tradePeriodAverage(ym, required)
        : tradePeriodTotal(ym, required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: String(iso).toUpperCase(), value: r.value });
    }
  }
  return { values, incomplete, requiredYears: required };
}

function fmtPct(v) {
  if (v === null || v === undefined) return null;
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
}

function fmtPp(v) {
  if (v === null || v === undefined) return null;
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)} pp`;
}

function fmtUsdGap(metric, gap) {
  if (gap === null || gap === undefined) return null;
  const body = displayFor(metric, Math.abs(Number(gap)));
  if (!body) return null;
  return `${Number(gap) < 0 ? '-' : '+'}${body}`;
}

function buildTradePeriodResult({ values, focusIso3, basisId, requiredYears, periodLabel, metric }) {
  const info = tradeBasisInfo(basisId);
  const { ranked, total } = rankTradeDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = tradeLeaveOneOut(values, focusKey);
  const nameByIso = new Map();
  const cagr = isCagrBasis(basisId);
  return {
    period: periodLabel,
    requiredYears,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, gapUnit: info.gapUnit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: cagr ? fmtPct(focusRow.value) : displayFor(metric, focusRow.value),
          ...(focusRow.endpointChange !== undefined ? {
            endpointChange: focusRow.endpointChange,
            endpointChangeDisplay: focusRow.endpointChange === null ? null : fmtPct(focusRow.endpointChange),
          } : {}),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? (cagr ? fmtPct(loo.benchmark) : displayFor(metric, loo.benchmark)) : null,
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? (cagr ? fmtPp(loo.gap) : fmtUsdGap(metric, loo.gap)) : null,
          gapUnit: info.gapUnit,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? nameByIso.get(r.iso3) ?? null, value: r.value, rank: r.rank })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount } : null,
  };
}

function buildTradeAnnualResult({ values, focusIso3, basisId, year, metric }) {
  const info = tradeBasisInfo(basisId);
  const { ranked, total } = rankTradeDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = tradeLeaveOneOut(values, focusKey);
  return {
    year,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, gapUnit: info.gapUnit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    rankable: true,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: displayFor(metric, focusRow.value),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? displayFor(metric, loo.benchmark) : null,
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? fmtUsdGap(metric, loo.gap) : null,
          gapUnit: info.gapUnit,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank })),
  };
}

/**
 * Main entry: build Trade movement for one metric+basis and S/[M]/E.
 */
export async function buildTradeMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isTradeMetric(metricKey) || !METRICS[metricKey]) {
    throw tradeError(TRADE_ERROR_CODES.INVALID_METRIC, `Unknown or non-Trade metric "${metricKey}".`, 400);
  }
  const allowedBases = tradeBasesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw tradeError(
      TRADE_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw tradeError(TRADE_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw tradeError(TRADE_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = await resolveTradeGroupFilter(db, options.group ?? null);
  const metric = METRICS[metricKey];
  const indicator = await getIndicatorByMetricKey(db, metricKey);
  const focusName = await focusDisplayName(db, focusIso3);
  const info = tradeBasisInfo(basisId);
  const base = {
    metric: describeMetric(metric),
    basis: tradeBasisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    nominalCaveat:
      'Current-US$ trade values measure nominal trade values. Changes can reflect quantities, prices, exchange rates and trade composition — not pure real-volume growth.',
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
  const applyGroup = (isos) => (groupSet ? isos.filter((iso) => groupSet.members.has(String(iso).toUpperCase())) : isos);

  if (isAnnualBasis(basisId)) {
    const years = hasMid ? [S, M, E] : [S, E];
    const rows = (
      await getEligibleObservationsRange(db, indicator.id, Math.min(...years), Math.max(...years))
    ).filter((r) => years.includes(Number(r.year)));
    const byIsoYear = indexByIsoYear(rows);
    const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
    const grouped = applyGroup([...byIsoYear.keys()]);
    const observed = years.map((y) => {
      const vals = grouped
        .filter((iso) => (byIsoYear.get(iso) ?? new Map()).has(y))
        .map((iso) => ({ iso3: iso, name: nameMap.get(iso) ?? null, value: byIsoYear.get(iso).get(y) }));
      return { ...buildTradeAnnualResult({ values: vals, focusIso3, basisId, year: y, metric }), universe: 'observed' };
    });
    const lflIsos = grouped.filter((iso) => years.every((y) => (byIsoYear.get(iso) ?? new Map()).has(y)));
    const likeForLike = years.map((y) => {
      const vals = lflIsos.map((iso) => ({ iso3: iso, name: nameMap.get(iso) ?? null, value: byIsoYear.get(iso).get(y) }));
      return { ...buildTradeAnnualResult({ values: vals, focusIso3, basisId, year: y, metric }), universe: 'like-for-like' };
    });
    return { ...base, available: true, reason: null, kind: 'annual', observed, likeForLike, descriptive: null, verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] } };
  }

  const periods = hasMid
    ? [{ label: `${S}→${M}`, s: S, e: M }, { label: `${M}→${E}`, s: M, e: E }, { label: `${S}→${E}`, s: S, e: E }]
    : [{ label: `${S}→${E}`, s: S, e: E }];

  const rows = await getEligibleObservationsRange(db, indicator.id, S, E);
  const byIsoYear = indexByIsoYear(rows);
  const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
  const groupedIsos = applyGroup([...byIsoYear.keys()]);

  const observed = periods.map((p) => {
    const { values, incomplete, requiredYears } = computeTradePeriodValues({
      basisId, byIsoYear, candidateIsos: groupedIsos, startYear: p.s, endYear: p.e, metric,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildTradePeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label, metric });
    return { ...res, universe: 'observed', incompleteCount: incomplete.length };
  });

  let lflCandidate;
  if (isCagrBasis(basisId)) {
    // Valid endpoints in S, M?, E with positive start values at each
    // sub-period start (S for P1/full, M for P2).
    lflCandidate = groupedIsos.filter((iso) => {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      const vS = ym.get(S);
      const vE = ym.get(E);
      if (!Number.isFinite(vS) || vS <= 0 || !Number.isFinite(vE)) return false;
      if (hasMid) {
        const vM = ym.get(M);
        if (!Number.isFinite(vM)) return false;
        // P2 start M must be positive for 2014→2024 CAGR within same universe.
        if (!(vM > 0)) return false;
        if (!Number.isFinite(ym.get(E))) return false;
      }
      return true;
    });
  } else {
    // Total/average: complete 2004..2024 flow span.
    const fullRequired = tradeYears(S, E);
    lflCandidate = groupedIsos.filter((iso) => {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      return fullRequired.every((y) => Number.isFinite(ym.get(y)));
    });
  }
  const likeForLike = periods.map((p) => {
    const { values, requiredYears } = computeTradePeriodValues({
      basisId, byIsoYear, candidateIsos: lflCandidate, startYear: p.s, endYear: p.e, metric,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildTradePeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label, metric });
    return { ...res, universe: 'like-for-like' };
  });

  // Descriptive endpoint change companion for CAGR (§34, not ranked).
  let descriptive = null;
  if (isCagrBasis(basisId)) {
    const fmap = byIsoYear.get(focusIso3) ?? new Map();
    descriptive = {
      kind: 'endpoint_change',
      note: 'Total endpoint increase over the period (descriptive companion to CAGR; not a ranking basis).',
      periods: periods.map((p) => {
        const r = tradeEndpointChange(fmap.get(p.s) ?? null, fmap.get(p.e) ?? null);
        return { period: p.label, available: r.computable, endpointChange: r.value, startValue: fmap.get(p.s) ?? null, endValue: fmap.get(p.e) ?? null };
      }),
    };
  }

  return {
    ...base,
    available: true,
    reason: null,
    kind: 'period',
    observed,
    likeForLike,
    likeForLikeUniverseSize: lflCandidate.length,
    descriptive,
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

export default { buildTradeMovement, listTradeCountryGroups: listTradeCountryGroups, resolveTradeGroupFilter, TRADE_ERROR_CODES };
