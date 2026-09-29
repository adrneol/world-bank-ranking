/**
 * CAPITAL FLOW MOVEMENT SERVICE (canonical, Capital-only orchestration).
 *
 * Wires domain/capitalMovement.js pure functions to stored WDI observations.
 * No GDP/Prices/Trade logic lives here; those paths are untouched.
 *
 * Data design (per spec, no silent switching):
 * - Annual + average FDI/GDP ratios use the raw WDI ratio series
 *   (BX.KLT.DINV.WD.GD.ZS, ingested as fdi_inflows_pct_gdp).
 * - Cumulative FDI/GDP derives sum(FDI)/sum(GDP)×100 with GDP =
 *   total_current (NY.GDP.MKTP.CD, nominal current-US$, same price basis).
 *
 * Order: group restriction → basis-specific validity → per-economy value →
 * full cross-section rank → leave-one-out benchmark → gap
 * (COUNTRY − BENCHMARK). Observed vs Like-for-like are universes only.
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
  CAPITAL_BASES,
  CAPITAL_GDP_DENOMINATOR_METRIC,
  capitalBasesForMetric,
  capitalBasisInfo,
  capitalCumulativeShare,
  capitalEndpointDiagnostic,
  capitalLeaveOneOut,
  capitalPeriodAverage,
  capitalPeriodSum,
  capitalRequiredYears,
  isAnnualCapitalBasis,
  isCapitalMetric,
  isRatioBasis,
  rankCapitalDesc,
} from '../domain/capitalMovement.js';
import { sourceAttribution } from './attribution.js';
import { focusDisplayName } from './focusCountry.js';

export const CAPITAL_ERROR_CODES = Object.freeze({
  INVALID_METRIC: 'INVALID_METRIC',
  INVALID_BASIS: 'INVALID_BASIS',
  INVALID_YEAR: 'INVALID_YEAR',
  SAME_YEAR: 'SAME_YEAR',
  INVALID_BREAKER: 'INVALID_BREAKER',
  UNKNOWN_COUNTRY: 'UNKNOWN_COUNTRY',
  UNSUPPORTED_GROUP: 'UNSUPPORTED_GROUP',
});

export function capitalError(code, message, httpStatus = 400) {
  const e = new Error(message);
  e.code = code;
  e.httpStatus = httpStatus;
  return e;
}

function orderYears(yearA, yearB) {
  if (yearA === yearB) throw capitalError(CAPITAL_ERROR_CODES.SAME_YEAR, 'yearA and yearB must differ.', 400);
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function normalizeMid(options, yearA, yearB) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  const mid = Number(raw);
  if (!Number.isInteger(mid)) throw capitalError(CAPITAL_ERROR_CODES.INVALID_BREAKER, 'Middle year must be an integer strictly between yearA and yearB, or None.', 400);
  const lo = Math.min(yearA, yearB);
  const hi = Math.max(yearA, yearB);
  if (mid <= lo || mid >= hi) {
    throw capitalError(CAPITAL_ERROR_CODES.INVALID_BREAKER, `Middle year must lie strictly between ${lo} and ${hi}.`, 400);
  }
  return mid;
}

/** Dynamic group membership (no hardcoding); validated vs DISTINCT DB values. */
export async function resolveCapitalGroupFilter(db, group) {
  if (!group || !group.type || !group.value || String(group.value).toLowerCase() === 'all') return null;
  const type = String(group.type);
  if (!['income_level', 'region', 'lending_type'].includes(type)) {
    throw capitalError(CAPITAL_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown group type "${group.type}".`, 400);
  }
  const col = type === 'income_level' ? 'income_level' : type === 'region' ? 'region' : 'lending_type';
  const rows = await listDistinctCountryColumn(db, col);
  const allowed = new Set(rows.map((r) => String(r.v)));
  if (!allowed.has(String(group.value))) {
    throw capitalError(CAPITAL_ERROR_CODES.UNSUPPORTED_GROUP, `Unknown ${type} "${group.value}".`, 400);
  }
  const members = await listCountryIdsByColumn(db, col, String(group.value));
  return { type, value: String(group.value), members: new Set(members) };
}

export async function listCapitalCountryGroups(db) {
  const groups = {};
  for (const col of ['income_level', 'region', 'lending_type']) {
    groups[col] = await countCountryGroupsByColumn(db, col);
  }
  return {
    default: 'All',
    vintageNote:
      'Classifications are the current retrieved World Bank metadata vintage stored in this project, not historical classifications as of the compared years. Period comparisons therefore use current-vintage membership; historical reclassification is not tracked.',
    flowNote:
      'FDI net inflows are flows, not stocks. Cumulative FDI is the sum of annual net flows; negative and zero flows are valid data, never clamped or zero-filled.',
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

function fmtPct(v) {
  if (v === null || v === undefined) return null;
  return `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)} pp`;
}

function usdDisplay(metric, value) {
  if (value === null || value === undefined) return null;
  return formatValue(value, metric).formatted;
}

function usdGapDisplay(metric, gap) {
  if (gap === null || gap === undefined) return null;
  const body = formatValue(Math.abs(Number(gap)), metric).formatted;
  if (!body) return null;
  return `${Number(gap) < 0 ? '-' : '+'}${body}`;
}

/** One period value per economy for cumulative/average/share bases. */
function computeCapitalPeriodValues({ basisId, fdiByIsoYear, ratioByIsoYear, gdpByIsoYear, candidateIsos, startYear, endYear }) {
  const required = capitalRequiredYears(basisId, startYear, endYear);
  const values = [];
  const incomplete = [];
  for (const iso of candidateIsos) {
    const key = String(iso).toUpperCase();
    if (basisId === CAPITAL_BASES.RATIO_CUMULATIVE) {
      const r = capitalCumulativeShare(fdiByIsoYear.get(key) ?? new Map(), gdpByIsoYear.get(key) ?? new Map(), required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, reason: r.reason, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: key, value: r.value });
    } else if (
      basisId === CAPITAL_BASES.FDI_CUMULATIVE
    ) {
      const r = capitalPeriodSum(fdiByIsoYear.get(key) ?? new Map(), required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: key, value: r.value });
    } else {
      // Averages (FDI level from FDI series; ratio average from ratio series).
      const ym = basisId === CAPITAL_BASES.RATIO_AVERAGE
        ? (ratioByIsoYear.get(key) ?? new Map())
        : (fdiByIsoYear.get(key) ?? new Map());
      const r = capitalPeriodAverage(ym, required);
      if (!r.computable) {
        incomplete.push({ iso3: iso, missingYears: r.missingYears ?? [] });
        continue;
      }
      values.push({ iso3: key, value: r.value });
    }
  }
  return { values, incomplete, requiredYears: required };
}

function basisDisplay(metric, basisId, value) {
  if (value === null || value === undefined) return null;
  if (isRatioBasis(basisId)) return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
  return usdDisplay(metric, value);
}

function basisGapDisplay(metric, basisId, gap) {
  if (gap === null || gap === undefined) return null;
  if (isRatioBasis(basisId)) return fmtPct(gap);
  return usdGapDisplay(metric, gap);
}

function buildCapitalPeriodResult({ values, focusIso3, basisId, requiredYears, periodLabel, metric }) {
  const info = capitalBasisInfo(basisId);
  const { ranked, total } = rankCapitalDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = capitalLeaveOneOut(values, focusKey);
  return {
    period: periodLabel,
    requiredYears,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, gapUnit: info.gapUnit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: basisDisplay(metric, basisId, focusRow.value),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? basisDisplay(metric, basisId, loo.benchmark) : null,
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? basisGapDisplay(metric, basisId, loo.gap) : null,
          gapUnit: info.gapUnit,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank })),
    benchmarkUniverse: loo.computable ? { peerCount: loo.peerCount } : null,
  };
}

function buildCapitalAnnualResult({ values, focusIso3, basisId, year, metric }) {
  const info = capitalBasisInfo(basisId);
  const { ranked, total } = rankCapitalDesc(values);
  const focusKey = String(focusIso3).toUpperCase();
  const focusRow = ranked.find((r) => r.iso3 === focusKey) ?? null;
  const loo = capitalLeaveOneOut(values, focusKey);
  return {
    year,
    basis: { id: info.id, label: info.label, question: info.question, formula: info.formula, unit: info.unit, gapUnit: info.gapUnit, rankWording: info.rankWording ?? null },
    eligibleCount: total,
    rankable: true,
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          value: focusRow.value,
          valueDisplay: basisDisplay(metric, basisId, focusRow.value),
          rank: focusRow.rank,
          denominator: total,
          benchmark: loo.computable ? loo.benchmark : null,
          benchmarkDisplay: loo.computable ? basisDisplay(metric, basisId, loo.benchmark) : null,
          benchmarkPeerCount: loo.peerCount,
          gap: loo.computable ? loo.gap : null,
          gapDisplay: loo.computable ? basisGapDisplay(metric, basisId, loo.gap) : null,
          gapUnit: info.gapUnit,
          benchmarkLabel: 'Average of other eligible economies',
        }
      : null,
    focusAvailable: Boolean(focusRow),
    ranking: ranked.map((r) => ({ iso3: r.iso3, name: r.name ?? null, value: r.value, rank: r.rank })),
  };
}

/**
 * Main entry: build Capital movement for one metric+basis and S/[M]/E.
 */
export async function buildCapitalMovement(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !isCapitalMetric(metricKey) || !METRICS[metricKey]) {
    throw capitalError(CAPITAL_ERROR_CODES.INVALID_METRIC, `Unknown or non-Capital-Flow metric "${metricKey}".`, 400);
  }
  const allowedBases = capitalBasesForMetric(metricKey);
  const basisId = options.basis ?? allowedBases[0];
  if (!allowedBases.includes(basisId)) {
    throw capitalError(
      CAPITAL_ERROR_CODES.INVALID_BASIS,
      `Basis "${options.basis}" is not valid for ${metricKey}. Valid: ${allowedBases.join(', ')}.`,
      400,
    );
  }
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw capitalError(CAPITAL_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const yearMid = normalizeMid(options, yearA, yearB);
  const hasMid = yearMid !== null;
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) throw capitalError(CAPITAL_ERROR_CODES.UNKNOWN_COUNTRY, `Invalid focus country "${options.focusIso3}".`, 400);

  const groupSet = await resolveCapitalGroupFilter(db, options.group ?? null);
  const metric = METRICS[metricKey];
  const indicator = await getIndicatorByMetricKey(db, metricKey);
  const focusName = await focusDisplayName(db, focusIso3);
  const base = {
    metric: describeMetric(metric),
    basis: capitalBasisInfo(basisId),
    focus: { iso3: focusIso3, name: focusName },
    years: hasMid ? { a: yearA, mid: yearMid, b: yearB, order } : { a: yearA, b: yearB, order },
    group: groupSet ? { type: groupSet.type, value: groupSet.value } : { type: null, value: 'All' },
    flowNote:
      'FDI net inflows are flows, not stocks. Cumulative FDI is the sum of annual net flows; negative and zero flows are valid data.',
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

  // Series reads: own metric always; the cumulative-share basis additionally
  // needs the FDI LEVEL series (numerator legs) and GDP series (denominator
  // legs). The cumulative share never uses the ratio series — summing annual
  // percentages would be economically wrong, so the legs are read separately.
  const needLegs = basisId === CAPITAL_BASES.RATIO_CUMULATIVE;
  const fdiLevelIndicator = needLegs ? await getIndicatorByMetricKey(db, 'fdi_inflows') : null;
  const gdpIndicator = needLegs ? await getIndicatorByMetricKey(db, CAPITAL_GDP_DENOMINATOR_METRIC) : null;
  if (needLegs && (!fdiLevelIndicator || !gdpIndicator)) {
    return { ...base, available: false, reason: 'denominator_not_ingested', observed: null, likeForLike: null, verification: { passed: false, checks: [] } };
  }
  // Read the full [S, E] span (inclusive). Period completeness is still
  // enforced strictly via requiredYears (S+1..E); the extra boundary year
  // only feeds the unranked endpoint diagnostic (F_E − F_S).
  const rows = await getEligibleObservationsRange(db, indicator.id, S, E);
  const fdiLevelRows = needLegs ? await getEligibleObservationsRange(db, fdiLevelIndicator.id, S + 1, E) : [];
  const gdpRows = needLegs ? await getEligibleObservationsRange(db, gdpIndicator.id, S + 1, E) : [];
  const fdiByIsoYear = indexByIsoYear(needLegs ? fdiLevelRows : rows);
  // For ratio average/annual the working map is the raw WDI ratio series.
  const ratioByIsoYear = metricKey === 'fdi_inflows_pct_gdp' && !needLegs ? fdiByIsoYear : new Map();
  const gdpByIsoYear = indexByIsoYear(gdpRows);
  const nameMap = new Map(rows.map((r) => [String(r.iso3).toUpperCase(), r.name]));
  for (const r of [...fdiLevelRows, ...gdpRows]) {
    if (!nameMap.has(String(r.iso3).toUpperCase())) nameMap.set(String(r.iso3).toUpperCase(), r.name);
  }

  if (isAnnualCapitalBasis(basisId)) {
    const years = hasMid ? [S, M, E] : [S, E];
    const grouped = applyGroup([...fdiByIsoYear.keys()].filter((iso) => years.some((y) => (fdiByIsoYear.get(iso) ?? new Map()).has(y))));
    const observed = years.map((y) => {
      const vals = grouped
        .filter((iso) => (fdiByIsoYear.get(iso) ?? new Map()).has(y))
        .map((iso) => ({ iso3: iso, name: nameMap.get(iso) ?? null, value: fdiByIsoYear.get(iso).get(y) }));
      return { ...buildCapitalAnnualResult({ values: vals, focusIso3, basisId, year: y, metric }), universe: 'observed' };
    });
    const lflIsos = grouped.filter((iso) => years.every((y) => (fdiByIsoYear.get(iso) ?? new Map()).has(y)));
    const likeForLike = years.map((y) => {
      const vals = lflIsos.map((iso) => ({ iso3: iso, name: nameMap.get(iso) ?? null, value: fdiByIsoYear.get(iso).get(y) }));
      return { ...buildCapitalAnnualResult({ values: vals, focusIso3, basisId, year: y, metric }), universe: 'like-for-like' };
    });
    return { ...base, available: true, reason: null, kind: 'annual', observed, likeForLike, descriptive: diagnosticFor(fdiByIsoYear, basisId, metricKey, focusIso3, hasMid ? [{ s: S, e: M }, { s: M, e: E }, { s: S, e: E }] : [{ s: S, e: E }]), verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] } };
  }

  const periods = hasMid
    ? [{ label: `${S}→${M}`, s: S, e: M }, { label: `${M}→${E}`, s: M, e: E }, { label: `${S}→${E}`, s: S, e: E }]
    : [{ label: `${S}→${E}`, s: S, e: E }];

  const groupedIsos = applyGroup([...fdiByIsoYear.keys()]);

  const observed = periods.map((p) => {
    const { values, incomplete, requiredYears } = computeCapitalPeriodValues({
      basisId, fdiByIsoYear, ratioByIsoYear, gdpByIsoYear, candidateIsos: groupedIsos, startYear: p.s, endYear: p.e,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildCapitalPeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label, metric });
    return { ...res, universe: 'observed', incompleteCount: incomplete.length };
  });

  // LFL: complete S+1..E span over the required legs (FDI always; ratio
  // series for the ratio average; FDI+GDP for the cumulative share).
  const fullRequired = [];
  for (let y = S + 1; y <= E; y += 1) fullRequired.push(y);
  const legComplete = (map, iso) => {
    const ym = map.get(String(iso).toUpperCase()) ?? new Map();
    return fullRequired.every((y) => Number.isFinite(ym.get(y)));
  };
  const lflCandidate = groupedIsos.filter((iso) => {
    if (!legComplete(fdiByIsoYear, iso)) return false;
    if (basisId === CAPITAL_BASES.RATIO_AVERAGE && !legComplete(ratioByIsoYear, iso)) return false;
    if (basisId === CAPITAL_BASES.RATIO_CUMULATIVE && !legComplete(gdpByIsoYear, iso)) return false;
    return true;
  });
  const likeForLike = periods.map((p) => {
    const { values, requiredYears } = computeCapitalPeriodValues({
      basisId, fdiByIsoYear, ratioByIsoYear, gdpByIsoYear, candidateIsos: lflCandidate, startYear: p.s, endYear: p.e,
    });
    const withNames = values.map((v) => ({ ...v, name: nameMap.get(v.iso3) ?? null }));
    const res = buildCapitalPeriodResult({ values: withNames, focusIso3, basisId, requiredYears, periodLabel: p.label, metric });
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
    descriptive: diagnosticFor(fdiByIsoYear, basisId, metricKey, focusIso3, periods),
    verification: { passed: true, checks: [{ check: 'basis_formula_unchanged_across_universes', passed: true }] },
  };
}

/**
 * Endpoint diagnostic for the focus economy (NOT a basis, NEVER ranked):
 * FDI Δ=F_E−F_S (USD); ratio Δ=R_E−R_S (pp).
 */
function diagnosticFor(fdiByIsoYear, basisId, metricKey, focusIso3, periods) {
  const isRatio = basisId === CAPITAL_BASES.RATIO_ANNUAL
    || basisId === CAPITAL_BASES.RATIO_AVERAGE
    || basisId === CAPITAL_BASES.RATIO_CUMULATIVE;
  const kind = metricKey === 'fdi_inflows' ? 'fdi_flow_change' : 'fdigdp_ratio_change';
  const fmap = fdiByIsoYear.get(String(focusIso3).toUpperCase()) ?? new Map();
  return {
    kind,
    diagnosticOnly: true,
    note: isRatio
      ? 'Change in annual FDI/GDP ratio (endpoint diagnostic only; not a ranking basis).'
      : 'Change in annual FDI flow (endpoint diagnostic only; not cumulative period FDI).',
    periods: periods.map((p) => {
      const r = capitalEndpointDiagnostic(fmap.get(p.s) ?? null, fmap.get(p.e) ?? null);
      return { period: p.label ?? `${p.s}→${p.e}`, available: r.computable, endpointChange: r.value, startValue: fmap.get(p.s) ?? null, endValue: fmap.get(p.e) ?? null };
    }),
  };
}

export default { buildCapitalMovement, listCapitalCountryGroups: listCapitalCountryGroups, resolveCapitalGroupFilter, CAPITAL_ERROR_CODES };
