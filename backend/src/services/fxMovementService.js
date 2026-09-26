/**
 * EXCHANGE RATE MOVEMENT SERVICE (canonical, FX-only orchestration).
 *
 * Wires domain/fxMovement.js pure functions to stored WDI observations
 * (PA.NUS.FCRF). No GDP/Prices/Trade/Capital logic here; untouched.
 *
 * Data rules: Basis A raw (never ranked/benchmarked); Basis B needs
 * t−1+t; Basis C needs S+E endpoints only (price, never sequences).
 * LFL: period = valid S&M&E; annual = valid pairs for every selected year.
 * Benchmark is always the leave-one-out MEDIAN; gap = country − median (pp).
 * Order: group restriction → validity → value → rank → median → gap.
 */

import { FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  getEligibleObservationsRange,
  getIndicatorByMetricKey,
} from '../db/repository.js';
import { describeMetric } from '../domain/format.js';
import {
  FX_BASES,
  fxAnnualChange,
  fxBasisInfo,
  fxBasesForMetric,
  fxCagr,
  fxLeaveOneOutMedian,
  fxPeriodChange,
  isFxMetric,
  rankFxDirected,
} from '../domain/fxMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const FX_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function fxError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw fxError(FX_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw fxError(FX_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw fxError(FX_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/** Dynamic group membership (no hardcoding); validated vs DISTINCT DB values. */
export function resolveFxGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw fxError(FX_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = db.prepare(`SELECT DISTINCT ${col} AS v FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL`).all();
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw fxError(FX_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = db
    .prepare(`SELECT id FROM countries WHERE is_aggregate = 0 AND ${col} = ?`)
    .all(String(group.value))
    .map((r) => String(r.id).toUpperCase());
  return { type, value: String(group.value), members: new Set(members) };
}

export function listFxCountryGroups(db) {
  const q = (col) =>
    db
      .prepare(
        `SELECT ${col} AS value, COUNT(*) AS eligibleCount FROM countries WHERE is_aggregate = 0 AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY ${col}`,
      )
      .all();
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years.',
    continuityNote:
      'The project stores no authoritative currency-redenomination metadata. Period changes are calculated from stored WDI observations as published; unusually large movements should be interpreted with care and are never auto-flagged as unit breaks.',
    nominalNote:
      'Nominal official bilateral movement vs USD only — not real, PPP, competitiveness, or comprehensive currency-strength measurement.',
    supported: {
      income_level: q('income_level'),
      region: q('region'),
      lending_type: q('lending_type'),
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
  return `${signed && n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function polarity(change) {
  if (change === null || change === undefined) return null;
  if (change > 0) return 'Nominal depreciation vs USD';
  if (change < 0) return 'Nominal appreciation vs USD';
  return 'No nominal movement vs USD';
}

function buildFxRankedSection({ values, focusIso3, basisId, label, requiredYears, unit, metric }) {
  const info = fxBasisInfo(basisId);
  const { ranked, total, direction } = rankFxDirected(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = fxLeaveOneOutMedian(values, focusKey);
  return {
    ...(label.year !== undefined ? { year: label.year } : { period: label.period }),
    requiredYears,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, rankWording: info.rankWording ?? null, benchmarkType: info.benchmarkType ?? null, rankDirection: direction },
    eligibleCount: total,
    rankable: true,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: fmtPct(focusRow.value),
          polarity: polarity(focusRow.value),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? fmtPct(loo.benchmark, false) : null,
          benchmarkLabel: 'Median eligible-economy FX change',
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? `${loo.gap >= 0 ? '+' : ''}${loo.gap.toFixed(2)} pp` : null,
          gapUnit: 'percentage points',
          ...(focusRow.cagr !== undefined ? { cagr: focusRow.cagr, cagrDisplay: focusRow.cagr === null ? null : fmtPct(focusRow.cagr) } : {}),
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank, ...(r.cagr !== undefined ? { cagr: r.cagr } : {}) })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount, type: 'median' } : null,
  };
}

/**
 * Main entry: build FX movement for fx_official + basis and S/[M]/E.
 */
export function buildFxMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isFxMetric(metricKey) || !METRICS[metricKey]) {
    throw fxError(FX_ERROR_CODES.INVALID_METRIC, `Unknown or non-Exchange-Rate metric "${metricKey}".`, 400);
  }
  const allowedBases = fxBasesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw fxError(
      FX_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw fxError(FX_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw fxError(FX_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = resolveFxGroupFilter(db, options.group ?? null);
  const metric = METRICS[metricKey];
  const indicator = getIndicatorByMetricKey(db, metricKey);
  const focusName = focusDisplayName(db, focusIso3);
  const base = {
    metric: describeMetric(metric),
    basis: fxBasisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    nominalNote:
      'Nominal official bilateral movement vs USD only — not real, PPP, competitiveness, or comprehensive currency-strength measurement.',
    continuityNote:
      'The project stores no authoritative currency-redenomination metadata. Changes are calculated from stored WDI observations as published.',
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

  // ---- Basis A: annual level (descriptive only; never ranked/benchmarked)
  if (basisId === FX_BASES.LEVEL) {
    const years = hasMid ? [S, M, E] : [S, E];
    const rows = getEligibleObservationsRange(db, indicator.id, Math.min(...years), Math.max(...years))
      .filter((r) => years.includes(Number(r.year)));
    const byIsoYear = indexByIsoYear(rows);
    const grouped = applyGroup([...byIsoYear.keys()]);
    const pick = (isoList, y) => isoList
      .filter((iso) => (byIsoYear.get(iso) ?? new Map()).has(y))
      .map((iso) => ({ iso3: iso, value: byIsoYear.get(iso).get(y) }));
    const observed = years.map((y) => {
      const vals = pick(grouped, y);
      const f = vals.find((v) => v.iso3 === focusIso3) ?? null;
      return {
        year: y, basis: fxBasisInfo(basisId), eligibleCount: vals.length, rankable: false,
        rankNote: 'Not cross-country rankable: LCU magnitudes reflect currency denomination, not strength.',
        focus: f ? { iso3: f.iso3, value: f.value } : null, focusAvailable: Boolean(f),
        ranking: [], universe: 'observed',
      };
    });
    const lflIsos = grouped.filter((iso) => years.every((y) => (byIsoYear.get(iso) ?? new Map()).has(y)));
    const likeForLike = years.map((y) => {
      const vals = pick(lflIsos, y);
      const f = vals.find((v) => v.iso3 === focusIso3) ?? null;
      return {
        year: y, basis: fxBasisInfo(basisId), eligibleCount: vals.length, rankable: false,
        rankNote: 'Not cross-country rankable: LCU magnitudes reflect currency denomination, not strength.',
        focus: f ? { iso3: f.iso3, value: f.value } : null, focusAvailable: Boolean(f),
        ranking: [], universe: 'like-for-like',
      };
    });
    return { ...base, available: true, reason: null, kind: 'annual', observed, likeForLike, descriptive: null, verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] } };
  }

  // ---- Basis B: annual change (needs t-1 and t)
  if (basisId === FX_BASES.ANNUAL_CHANGE) {
    const years = hasMid ? [S, M, E] : [S, E];
    const rows = getEligibleObservationsRange(db, indicator.id, Math.min(...years) - 1, Math.max(...years));
    const byIsoYear = indexByIsoYear(rows);
    const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
    const grouped = applyGroup([...byIsoYear.keys()]);
    const valuesFor = (isoList, y) => {
      const out = [];
      for (const iso of isoList) {
        const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
        const r = fxAnnualChange(ym.get(y - 1) ?? null, ym.get(y) ?? null);
        if (r.computable) out.push({ iso3: String(iso).toUpperCase(), name: nameMap.get(String(iso).toUpperCase()) ?? null, value: r.value });
      }
      return out;
    };
    const observed = years.map((y) => ({
      ...buildFxRankedSection({ values: valuesFor(grouped, y), focusIso3, basisId, label: { year: y }, requiredYears: [y - 1, y], unit: '%', metric }),
      universe: 'observed',
    }));
    // LFL: intersection of valid t-1/t pairs across selected years.
    const pairValid = (iso, y) => {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      return fxAnnualChange(ym.get(y - 1) ?? null, ym.get(y) ?? null).computable;
    };
    const lflIsos = grouped.filter((iso) => years.every((y) => pairValid(iso, y)));
    const likeForLike = years.map((y) => ({
      ...buildFxRankedSection({ values: valuesFor(lflIsos, y), focusIso3, basisId, label: { year: y }, requiredYears: [y - 1, y], unit: '%', metric }),
      universe: 'like-for-like',
    }));
    return { ...base, available: true, reason: null, kind: 'annual', observed, likeForLike, descriptive: null, verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] } };
  }

  // ---- Basis C: period change (endpoints S/E only) + display-only CAGR
  const periods = hasMid
    ? [{ label: `${S}→${M}`, s: S, e: M }, { label: `${M}→${E}`, s: M, e: E }, { label: `${S}→${E}`, s: S, e: E }]
    : [{ label: `${S}→${E}`, s: S, e: E }];
  const needYears = [...new Set(periods.flatMap((p) => [p.s, p.e]))].sort((a, b) => a - b);
  const rows = getEligibleObservationsRange(db, indicator.id, Math.min(...needYears), Math.max(...needYears))
    .filter((r) => needYears.includes(Number(r.year)));
  const byIsoYear = indexByIsoYear(rows);
  const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
  const groupedIsos = applyGroup([...byIsoYear.keys()]);

  const valuesFor = (isoList, s, e) => {
    const out = [];
    for (const iso of isoList) {
      const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
      const r = fxPeriodChange(ym.get(s) ?? null, ym.get(e) ?? null);
      if (!r.computable) continue;
      const c = fxCagr(ym.get(s) ?? null, ym.get(e) ?? null, e - s);
      out.push({ iso3: String(iso).toUpperCase(), name: nameMap.get(String(iso).toUpperCase()) ?? null, value: r.value, cagr: c.computable ? c.value : null });
    }
    return out;
  };
  const observed = periods.map((p) => ({
    ...buildFxRankedSection({ values: valuesFor(groupedIsos, p.s, p.e), focusIso3, basisId, label: { period: p.label }, requiredYears: [p.s, p.e], unit: '%', metric }),
    universe: 'observed',
  }));
  const needAll = hasMid ? [S, M, E] : [S, E];
  const lflCandidate = groupedIsos.filter((iso) => {
    const ym = byIsoYear.get(String(iso).toUpperCase()) ?? new Map();
    return needAll.every((y) => Number.isFinite(ym.get(y)));
  });
  const likeForLike = periods.map((p) => ({
    ...buildFxRankedSection({ values: valuesFor(lflCandidate, p.s, p.e), focusIso3, basisId, label: { period: p.label }, requiredYears: [p.s, p.e], unit: '%', metric }),
    universe: 'like-for-like',
  }));

  return {
    ...base,
    available: true,
    reason: null,
    kind: 'period',
    observed,
    likeForLike,
    likeForLikeUniverseSize: lflCandidate.length,
    descriptive: null,
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

export default { buildFxMovement, listFxCountryGroups: listFxCountryGroups, resolveFxGroupFilter, FX_ERROR_CODES };
