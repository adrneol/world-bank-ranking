/**
 * GROWTH COMPARISON ENGINE (pure functions, no I/O).
 *
 * Rank-movement by YoY % growth instead of per-capita level, for the
 * Movement section's "YoY % growth" ranking basis.
 *
 * MODEL (one metric, selected years, intervals between them)
 *   G(I)       = economies with a CALCULABLE growth observation for interval
 *                I = (start → end): both endpoint levels present and finite,
 *                start value strictly positive. Built by the EXISTING
 *                domain/yoyRanking.buildYoyRows — never re-implemented here.
 *   U          = G(AB) in two-year mode;
 *                G(AM) ∩ G(MB) ∩ G(AB) in three-year mode (one shared
 *                like-for-like universe for all three intervals).
 *   growthRank = 1-based ordinal position in growthPercent DESC, ISO3 ASC
 *                (the EXISTING domain/yoyRanking.rankByYoy engine).
 *
 * WHAT "MOVEMENT" MEANS HERE
 *   Unlike level mode there are no rank deltas across time points: each
 *   interval IS one growth ranking. Per interval the engine reports the
 *   observed growth ranking, the like-for-like growth ranking within U, and
 *   the outside decomposition (partial identity
 *   fullRank − outsideAbove = commonRank). Inter-interval rank subtraction
 *   is deliberately NOT produced: growth ranks of different intervals measure
 *   different quantities and are not comparable by subtraction.
 *
 * PEER AVERAGES (descriptive context only, never a ranking input)
 *   peerAvgObserved(I) = unweighted arithmetic mean of growthPercent over
 *                        G(I) excluding the focus economy.
 *   peerAvgCommon(I)   = unweighted arithmetic mean over U excluding focus.
 *   vsPeer*            = indiaGrowth − peerAvg (percentage points, plain
 *                        subtraction — never a percentage of a percentage).
 *   Summation is full-precision in canonical sorted-ISO3 order, so the same
 *   input always yields the same output. Averages are computed downstream of
 *   ranking; ranks never depend on them (asserted by the verifier).
 *
 * WHAT THIS MODULE NEVER DOES
 *   * no SQL, no fetching, no caching, no logging
 *   * no presentation formatting and no rounding (display strings are built
 *     in the service/format layer)
 *   * no annualization and no CAGR: every interval is the project's existing
 *     simple percentage change between its two selected observations
 *   * never treats an absent/invalid growth observation as zero
 *   * never averages interval averages
 */

import { buildYoyRows, rankByYoy } from './yoyRanking.js';
import { computeYoy, YOY_NA_REASONS } from './yoy.js';
import {
  COMPARISON_MODE,
  ECONOMY_RELATION,
  POSITION_EFFECT,
  THREE_YEAR_STATUS,
  relationTo,
  sortedUnique,
  sameMembers,
  toRankIndex,
} from './comparison.js';

/** Machine-readable reasons for growth-comparison outcomes. */
export const GROWTH_REASONS = Object.freeze({
  NO_GROWTH_IN_INTERVAL: 'no_calculable_growth_for_focus_in_interval',
  NO_PEER_ECONOMIES: 'no_peer_economies_after_excluding_focus',
  PEER_AVERAGE_UNAVAILABLE: 'peer_average_unavailable',
});

/** Human-readable descriptions for growth-specific reasons. */
export const GROWTH_REASON_DESCRIPTIONS = Object.freeze({
  [GROWTH_REASONS.NO_GROWTH_IN_INTERVAL]:
    'The focus economy has no calculable growth observation for this interval (a level observation is missing at one endpoint or the start value is not greater than zero).',
  [GROWTH_REASONS.NO_PEER_ECONOMIES]:
    'Only the focus economy holds a calculable growth value for this interval, so no peer average can be computed.',
  [GROWTH_REASONS.PEER_AVERAGE_UNAVAILABLE]:
    'The peer average is unavailable, so no India-minus-average difference can be computed.',
});

/** Population wording for the growth ranking universe. */
export const GROWTH_POPULATION_LABEL =
  'eligible economies with a calculable growth observation for this indicator and interval (both endpoint levels present and finite, start value strictly positive)';

/** Interval keys used throughout the growth comparison. */
export const GROWTH_INTERVALS = Object.freeze({
  AM: 'AM',
  MB: 'MB',
  AB: 'AB',
});

/**
 * Unweighted arithmetic mean of growthPercent over rows, excluding focusIso3.
 * Rows MUST all carry finite yoyPercent; summation order is canonical
 * sorted-ISO3 so results are deterministic.
 *
 * @param {{ iso3: string, yoyPercent: number }[]} rows
 * @param {string} focusIso3
 * @returns {{ mean: number|null, count: number }}
 */
export function peerAverageGrowth(rows, focusIso3) {
  const peers = (rows ?? [])
    .filter((r) => r && r.iso3 !== focusIso3 && Number.isFinite(r.yoyPercent))
    .sort((a, b) => (a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0));
  if (peers.length === 0) return { mean: null, count: 0 };
  let sum = 0;
  for (const r of peers) sum += r.yoyPercent;
  return { mean: sum / peers.length, count: peers.length };
}

/**
 * Pair one interval's growth rows from stored level observations.
 *
 * Uses the EXISTING buildYoyRows (same formula, same validity rule) for the
 * valid set, and the EXISTING computeYoy for per-economy exclusion reasons —
 * no growth math is re-implemented here.
 *
 * @param {object[]} startRows level rows at the interval start {iso3,name,value,valueRaw}
 * @param {object[]} endRows level rows at the interval end
 * @returns {{ valid: object[], reasonsByIso3: Map<string,string>, startByIso3: Map, endByIso3: Map }}
 */
function pairIntervalGrowth(startRows, endRows) {
  const { rows: valid } = buildYoyRows(endRows ?? [], startRows ?? []);
  const validSet = new Set(valid.map((r) => r.iso3));
  const startByIso3 = new Map((startRows ?? []).map((r) => [r.iso3, r]));
  const endByIso3 = new Map((endRows ?? []).map((r) => [r.iso3, r]));
  const reasonsByIso3 = new Map();
  for (const iso3 of new Set([...startByIso3.keys(), ...endByIso3.keys()])) {
    if (validSet.has(iso3)) continue;
    const start = startByIso3.get(iso3);
    const end = endByIso3.get(iso3);
    const verdict = computeYoy({
      current: end ? end.value : null,
      previous: start ? start.value : null,
    });
    reasonsByIso3.set(iso3, verdict.reason ?? YOY_NA_REASONS.BOTH_MISSING);
  }
  return { valid, reasonsByIso3, startByIso3, endByIso3 };
}

/**
 * Build one interval's growth comparison against a fixed common universe.
 *
 * @param {object} input
 * @param {object[]} input.valid growth-valid rows for the interval (buildYoyRows output)
 * @param {string[]} input.commonIso3 shared universe U members for this comparison
 * @param {string} input.focusIso3
 * @param {number} input.startYear chronological interval start
 * @param {number} input.endYear chronological interval end
 * @param {string} input.intervalKey 'AM' | 'MB' | 'AB'
 */
function buildGrowthInterval({ valid, commonIso3, focusIso3, startYear, endYear, intervalKey }) {
  const commonSet = new Set(commonIso3 ?? []);
  const observed = valid ?? [];
  const observedSet = new Set(observed.map((r) => r.iso3));
  const commonRows = observed.filter((r) => commonSet.has(r.iso3));

  const rankedObserved = rankByYoy(observed);
  const rankedCommon = rankByYoy(commonRows);
  const indexObserved = toRankIndex(rankedObserved.ranked);
  const indexCommon = toRankIndex(rankedCommon.ranked);

  const inObserved = indexObserved.rankByIso3.has(focusIso3);
  const inCommon = indexCommon.rankByIso3.has(focusIso3);
  const focusRow = inObserved ? observed.find((r) => r.iso3 === focusIso3) : null;

  const outside = observed.filter((r) => !commonSet.has(r.iso3)).map((r) => r.iso3).sort();

  // Peer averages: descriptive only, computed downstream of ranking from the
  // same ranked row sets. India excluded in both (vacuous when absent).
  const peerObserved = peerAverageGrowth(rankedObserved.ranked, focusIso3);
  const peerCommon = peerAverageGrowth(rankedCommon.ranked, focusIso3);

  const unavailable = (reason) => ({
    available: false,
    reason,
    intervalKey,
    startYear,
    endYear,
    indiaGrowthPercent: focusRow ? focusRow.yoyPercent : null,
    absoluteChange: focusRow ? focusRow.currentValue - focusRow.previousValue : null,
    startValue: focusRow ? focusRow.previousValue : null,
    endValue: focusRow ? focusRow.currentValue : null,
    fullGrowthRank: inObserved ? indexObserved.rankByIso3.get(focusIso3) : null,
    commonGrowthRank: null,
    denominatorObserved: rankedObserved.total,
    denominatorCommon: rankedCommon.total,
    outsideAbove: null,
    outsideBelow: null,
    peerAvgObserved: peerObserved.mean,
    peerCountObserved: peerObserved.count,
    peerAvgReasonObserved: peerObserved.mean === null ? GROWTH_REASONS.NO_PEER_ECONOMIES : null,
    peerAvgCommon: peerCommon.mean,
    peerCountCommon: peerCommon.count,
    peerAvgReasonCommon: peerCommon.mean === null ? GROWTH_REASONS.NO_PEER_ECONOMIES : null,
    vsPeerObservedPp: null,
    // No India growth exists for the interval, so no difference may be
    // published; the reason names the blocking side honestly.
    vsPeerReasonObserved:
      peerObserved.mean === null ? GROWTH_REASONS.PEER_AVERAGE_UNAVAILABLE : reason,
    vsPeerCommonPp: null,
    vsPeerReasonCommon:
      peerCommon.mean === null ? GROWTH_REASONS.PEER_AVERAGE_UNAVAILABLE : reason,
  });

  // Focus must hold calculable growth for the interval; otherwise nothing
  // about India's interval result may be published (no fabrication).
  if (!inObserved) {
    return { interval: unavailable(GROWTH_REASONS.NO_GROWTH_IN_INTERVAL), observed, commonRows, outside };
  }

  const fullGrowthRank = indexObserved.rankByIso3.get(focusIso3);
  const outsideAbove = outside.filter((iso3) => indexObserved.rankByIso3.get(iso3) < fullGrowthRank).length;
  const indiaGrowthPercent = focusRow.yoyPercent;

  // Like-for-like fields require India in the shared universe; when India
  // holds interval growth but sits outside U, only observed fields publish.
  const commonGrowthRank = inCommon ? indexCommon.rankByIso3.get(focusIso3) : null;

  const vsPeerObservedPp =
    peerObserved.mean === null ? null : indiaGrowthPercent - peerObserved.mean;
  const vsPeerCommonPp =
    !inCommon || peerCommon.mean === null ? null : indiaGrowthPercent - peerCommon.mean;

  const interval = {
    available: true,
    reason: null,
    intervalKey,
    startYear,
    endYear,
    indiaGrowthPercent,
    absoluteChange: focusRow.currentValue - focusRow.previousValue,
    startValue: focusRow.previousValue,
    endValue: focusRow.currentValue,
    fullGrowthRank,
    commonGrowthRank,
    denominatorObserved: rankedObserved.total,
    denominatorCommon: rankedCommon.total,
    outsideAbove,
    outsideBelow: outside.length - outsideAbove,
    peerAvgObserved: peerObserved.mean,
    peerCountObserved: peerObserved.count,
    peerAvgReasonObserved: peerObserved.mean === null ? GROWTH_REASONS.NO_PEER_ECONOMIES : null,
    peerAvgCommon: peerCommon.mean,
    peerCountCommon: peerCommon.count,
    peerAvgReasonCommon: peerCommon.mean === null ? GROWTH_REASONS.NO_PEER_ECONOMIES : null,
    vsPeerObservedPp,
    vsPeerReasonObserved:
      vsPeerObservedPp === null ? GROWTH_REASONS.PEER_AVERAGE_UNAVAILABLE : null,
    vsPeerCommonPp,
    vsPeerReasonCommon:
      vsPeerCommonPp === null ? GROWTH_REASONS.PEER_AVERAGE_UNAVAILABLE : null,
  };

  return { interval, observed, commonRows, outside };
}

/**
 * Build a growth rank-movement comparison for one metric and two or three
 * years. Years are ordered chronologically for computation; intervals are
 * always earlier → later, so swapped A/B yields identical growth numbers.
 *
 * Two-year: single interval AB with U = G(AB) (observed and like-for-like
 * coincide; stated explicitly, never faked into a distinction).
 * Three-year: intervals AM, MB, AB with one shared U = G(AM)∩G(MB)∩G(AB).
 *
 * @param {{ rowsA: object[], rowsMid: object[]|null, rowsB: object[], focusIso3: string,
 *           yearA: number, yearMid: number|null, yearB: number }} input
 *           (rows* are stored level observations {iso3,name,value,valueRaw})
 */
export function buildGrowthComparison({ rowsA, rowsMid, rowsB, focusIso3, yearA, yearMid, yearB }) {
  const focus = String(focusIso3 ?? '').toUpperCase();
  const hasMid = Number.isInteger(yearMid) && rowsMid !== null && rowsMid !== undefined;

  // Chronological computation order: intervals always run earlier → later.
  const points = hasMid
    ? [
        { year: yearA, rows: rowsA ?? [] },
        { year: yearMid, rows: rowsMid ?? [] },
        { year: yearB, rows: rowsB ?? [] },
      ].sort((p, q) => p.year - q.year)
    : [
        { year: yearA, rows: rowsA ?? [] },
        { year: yearB, rows: rowsB ?? [] },
      ].sort((p, q) => p.year - q.year);
  const [p0, p1, p2] = points;

  const pairedAB = hasMid
    ? pairIntervalGrowth(p0.rows, p2.rows)
    : pairIntervalGrowth(p0.rows, p1.rows);
  const pairedAM = hasMid ? pairIntervalGrowth(p0.rows, p1.rows) : null;
  const pairedMB = hasMid ? pairIntervalGrowth(p1.rows, p2.rows) : null;

  const setOf = (paired) => new Set(paired.valid.map((r) => r.iso3));
  const setAB = setOf(pairedAB);
  let common;
  if (!hasMid) {
    common = [...setAB].sort();
  } else {
    const setAM = setOf(pairedAM);
    const setMB = setOf(pairedMB);
    common = [...setAB].filter((iso3) => setAM.has(iso3) && setMB.has(iso3)).sort();
  }
  const commonSet = new Set(common);

  const builtAB = buildGrowthInterval({
    valid: pairedAB.valid,
    commonIso3: common,
    focusIso3: focus,
    startYear: hasMid ? p0.year : p0.year,
    endYear: hasMid ? p2.year : p1.year,
    intervalKey: GROWTH_INTERVALS.AB,
  });
  const builtAM = hasMid
    ? buildGrowthInterval({
        valid: pairedAM.valid,
        commonIso3: common,
        focusIso3: focus,
        startYear: p0.year,
        endYear: p1.year,
        intervalKey: GROWTH_INTERVALS.AM,
      })
    : null;
  const builtMB = hasMid
    ? buildGrowthInterval({
        valid: pairedMB.valid,
        commonIso3: common,
        focusIso3: focus,
        startYear: p1.year,
        endYear: p2.year,
        intervalKey: GROWTH_INTERVALS.MB,
      })
    : null;

  // Row universe: every economy observed at the selected years' levels that
  // holds calculable growth in at least one interval, PLUS every economy
  // holding a level observation for an interval endpoint but no calculable
  // growth anywhere (listed with per-interval reasons for audit, never
  // ranked). Each row carries per-interval growth blocks (null + reason
  // where incalculable) so tables, relations and Details stay honest.
  const pairedByInterval = { AB: pairedAB, AM: pairedAM, MB: pairedMB };
  const levelIso3 = new Set();
  for (const paired of [pairedAB, pairedAM, pairedMB]) {
    if (!paired) continue;
    for (const k of paired.startByIso3.keys()) levelIso3.add(k);
    for (const k of paired.endByIso3.keys()) levelIso3.add(k);
  }
  const unionIso3 = sortedUnique([
    ...pairedAB.valid.map((r) => r.iso3),
    ...(hasMid ? pairedAM.valid.map((r) => r.iso3) : []),
    ...(hasMid ? pairedMB.valid.map((r) => r.iso3) : []),
    ...levelIso3,
  ]);

  const validByIntervalIso3 = {
    AB: new Map(pairedAB.valid.map((r) => [r.iso3, r])),
    AM: hasMid ? new Map(pairedAM.valid.map((r) => [r.iso3, r])) : new Map(),
    MB: hasMid ? new Map(pairedMB.valid.map((r) => [r.iso3, r])) : new Map(),
  };
  const nameByIso3 = new Map();
  const rememberNames = (rows) => {
    for (const r of rows ?? []) {
      if (!nameByIso3.has(r.iso3) && r.name) nameByIso3.set(r.iso3, r.name);
    }
  };
  for (const paired of [pairedAB, pairedAM, pairedMB]) {
    if (!paired) continue;
    rememberNames(paired.valid);
    rememberNames([...paired.startByIso3.values()]);
    rememberNames([...paired.endByIso3.values()]);
  }

  // Per-interval observed/common rank indexes for positional relations.
  const intervalIndex = {};
  for (const key of ['AM', 'MB', 'AB']) {
    const built = key === 'AM' ? builtAM : key === 'MB' ? builtMB : builtAB;
    if (!built) continue;
    intervalIndex[key] = {
      observed: toRankIndex(rankByYoy(built.observed).ranked),
      common: toRankIndex(rankByYoy(built.commonRows).ranked),
    };
  }
  const focusInObserved = (key) => intervalIndex[key]?.observed.rankByIso3.has(focus) ?? false;

  const economies = unionIso3.map((iso3) => {
    const isCommon = commonSet.has(iso3);
    const intervals = {};
    for (const key of ['AM', 'MB', 'AB']) {
      const paired = pairedByInterval[key];
      if (!paired) {
        intervals[key] = null;
        continue;
      }
      const growthRow = validByIntervalIso3[key].get(iso3) ?? null;
      const idx = intervalIndex[key];
      if (!growthRow) {
        const verdict = (() => {
          const start = paired.startByIso3.get(iso3);
          const end = paired.endByIso3.get(iso3);
          return computeYoy({
            current: end ? end.value : null,
            previous: start ? start.value : null,
          });
        })();
        intervals[key] = {
          valid: false,
          reason: verdict.reason ?? YOY_NA_REASONS.BOTH_MISSING,
          growthPercent: null,
          absoluteChange: null,
          startValue: paired.startByIso3.get(iso3)?.value ?? null,
          endValue: paired.endByIso3.get(iso3)?.value ?? null,
          obsRank: null,
          commonRank: null,
          relObs: ECONOMY_RELATION.UNKNOWN,
          relCommon: ECONOMY_RELATION.UNKNOWN,
          affectsObs: false,
          affectsCommon: false,
          tiedWithFocus: false,
        };
        continue;
      }
      const obsRank = idx.observed.rankByIso3.get(iso3) ?? null;
      const commonRank = idx.common.rankByIso3.get(iso3) ?? null;
      const relObs = relationTo(iso3, focus, focusInObserved(key) ? idx.observed.rankByIso3 : null);
      const relCommon =
        commonRank === null
          ? ECONOMY_RELATION.UNKNOWN
          : relationTo(iso3, focus, idx.common.rankByIso3.has(focus) ? idx.common.rankByIso3 : null);
      intervals[key] = {
        valid: true,
        reason: null,
        growthPercent: growthRow.yoyPercent,
        absoluteChange: growthRow.currentValue - growthRow.previousValue,
        startValue: growthRow.previousValue,
        endValue: growthRow.currentValue,
        obsRank,
        commonRank,
        relObs,
        relCommon,
        affectsObs: relObs === ECONOMY_RELATION.ABOVE,
        affectsCommon: relCommon === ECONOMY_RELATION.ABOVE,
        tiedWithFocus:
          iso3 !== focus &&
          focusInObserved(key) &&
          growthRow.yoyPercent ===
            validByIntervalIso3[key].get(focus)?.yoyPercent,
      };
    }
    // Primary relation for list display: the overall AB interval when valid
    // there, else the first valid interval (mirrors the level "status year
    // decides" rule in spirit: the displayed interval decides).
    const primaryKey = intervals.AB?.valid ? 'AB' : intervals.MB?.valid ? 'MB' : intervals.AM?.valid ? 'AM' : null;
    const relationToFocus = primaryKey ? intervals[primaryKey].relObs : ECONOMY_RELATION.UNKNOWN;
    const affectsFocusPosition = ['AM', 'MB', 'AB'].some((k) => intervals[k]?.affectsObs === true);
    return {
      iso3,
      name: nameByIso3.get(iso3) ?? null,
      status: isCommon ? THREE_YEAR_STATUS.COMMON : THREE_YEAR_STATUS.OUTSIDE,
      presentInAM: validByIntervalIso3.AM.has(iso3),
      presentInMB: validByIntervalIso3.MB.has(iso3),
      presentInAB: validByIntervalIso3.AB.has(iso3),
      relationToFocus,
      relationToFocusAM: intervals.AM?.relObs ?? ECONOMY_RELATION.UNKNOWN,
      relationToFocusMB: intervals.MB?.relObs ?? ECONOMY_RELATION.UNKNOWN,
      relationToFocusAB: intervals.AB?.relObs ?? ECONOMY_RELATION.UNKNOWN,
      positionEffect: isCommon
        ? POSITION_EFFECT.NOT_APPLICABLE
        : affectsFocusPosition
          ? POSITION_EFFECT.AFFECTS_POSITION
          : POSITION_EFFECT.DENOMINATOR_ONLY,
      affectsFocusPosition,
      intervals,
    };
  });

  // Per-interval observed member lists and outside slices (for the verifier
  // and for exact counts — never derived from counts elsewhere).
  const membersFor = (paired, built) => ({
    observed: paired.valid.map((r) => r.iso3).sort(),
    outside: built.outside.slice(),
  });
  const members = {
    AB: membersFor(pairedAB, builtAB),
    AM: hasMid ? membersFor(pairedAM, builtAM) : { observed: [], outside: [] },
    MB: hasMid ? membersFor(pairedMB, builtMB) : { observed: [], outside: [] },
    common,
  };
  const totals = {
    AB: pairedAB.valid.length,
    AM: hasMid ? pairedAM.valid.length : 0,
    MB: hasMid ? pairedMB.valid.length : 0,
    common: common.length,
    outsideAB: builtAB.outside.length,
    outsideAM: hasMid ? builtAM.outside.length : 0,
    outsideMB: hasMid ? builtMB.outside.length : 0,
  };

  return {
    mode: COMPARISON_MODE.YOY,
    focusIso3: focus,
    hasMid,
    intervals: {
      AM: builtAM ? builtAM.interval : null,
      MB: builtMB ? builtMB.interval : null,
      AB: builtAB.interval,
    },
    members,
    totals,
    economies,
  };
}

/**
 * SELF-VERIFICATION for growth comparisons (fail-closed contract).
 *
 * Every check re-derives its expectation from the comparison object's own
 * membership and ranking data. Averages are re-derived from the ranked rows
 * (focus excluded, canonical order); ranks are re-derived from growth
 * percentages alone, proving the averages cannot affect ranking.
 *
 * @param {object} comparison output of buildGrowthComparison
 * @returns {{ passed: boolean, checks: {check:string,status:string,detail:object|string|null}[] }}
 */
export function verifyGrowthComparison(comparison) {
  const checks = [];
  const record = (check, passed, detail = null, applicable = true) =>
    checks.push({
      check,
      status: passed ? 'pass' : 'fail',
      detail: applicable ? detail : { applicable: false, reason: detail },
    });

  const { members, totals, intervals, economies, focusIso3 } = comparison;
  const intervalKeys = ['AM', 'MB', 'AB'].filter((k) => intervals[k] !== null && intervals[k] !== undefined);

  // Map interval -> ranked growth rows, rebuilt from the economies' interval
  // blocks (the same numbers the response carries, regrouped independently).
  const rowsFor = (key) =>
    (economies ?? [])
      .filter((e) => e.intervals?.[key]?.valid === true)
      .map((e) => ({
        iso3: e.iso3,
        name: e.name,
        previousValue: e.intervals[key].startValue,
        currentValue: e.intervals[key].endValue,
        yoyPercent: e.intervals[key].growthPercent,
      }));
  const commonSet = new Set(members.common ?? []);

  for (const key of intervalKeys) {
    const iv = intervals[key];
    const observed = rowsFor(key);
    const observedSet = new Set(observed.map((r) => r.iso3));
    const commonRows = observed.filter((r) => commonSet.has(r.iso3));
    const outside = observed.filter((r) => !commonSet.has(r.iso3)).map((r) => r.iso3).sort();

    // Set partitions: G(I) = U ∪ outside(I), disjoint.
    record(
      `${key}.set_partition`,
      observed.length === commonRows.length + outside.length &&
        sameMembers(
          observed.map((r) => r.iso3),
          [...commonRows.map((r) => r.iso3), ...outside],
        ) &&
        !commonRows.some((r) => outside.includes(r.iso3)),
      { observed: observed.length, common: commonRows.length, outside: outside.length },
    );
    record(`${key}.outside_matches_members`, sameMembers(outside, members[key]?.outside ?? []), {
      recomputed: outside.length,
    });
    record(
      `${key}.common_subset_of_observed`,
      commonRows.every((r) => observedSet.has(r.iso3)),
      { common: commonRows.length },
    );

    // Ranking: recompute from growth percentages ALONE (no average fields
    // involved) and require exact agreement — this is both the engine
    // cross-check and the rank-independence-of-average proof.
    const reObserved = rankByYoy(observed);
    const reCommon = rankByYoy(commonRows);
    const reObsByIso3 = new Map(reObserved.ranked.map((r) => [r.iso3, r.rank]));
    const reCommonByIso3 = new Map(reCommon.ranked.map((r) => [r.iso3, r.rank]));
    const reportedObsRanks = new Map();
    const reportedCommonRanks = new Map();
    for (const e of economies ?? []) {
      if (e.intervals?.[key]?.valid) {
        reportedObsRanks.set(e.iso3, e.intervals[key].obsRank);
        if (e.intervals[key].commonRank !== null) {
          reportedCommonRanks.set(e.iso3, e.intervals[key].commonRank);
        }
      }
    }
    const ranksAgree =
      reObserved.total === iv.denominatorObserved &&
      reCommon.total === iv.denominatorCommon &&
      [...reObsByIso3.entries()].every(([iso3, rank]) => reportedObsRanks.get(iso3) === rank) &&
      [...reCommonByIso3.entries()].every(([iso3, rank]) => reportedCommonRanks.get(iso3) === rank);
    record(`${key}.ranks_match_engine_recomputed_from_growth_only`, ranksAgree, {
      observed: reObserved.total,
      common: reCommon.total,
    });
    record(`${key}.ranks_independent_of_averages`, ranksAgree, {
      note: 'recomputation consumes growthPercent values only; average fields are not inputs',
    });

    // Denominators equal actual population sizes.
    record(
      `${key}.denominators_equal_population_sizes`,
      iv.denominatorObserved === observed.length && iv.denominatorCommon === commonRows.length,
      { denominatorObserved: iv.denominatorObserved, denominatorCommon: iv.denominatorCommon },
    );

    // Partial identity: fullRank − outsideAbove = commonRank.
    const focusObsRank = reObsByIso3.get(focusIso3) ?? null;
    const focusCommonRank = reCommonByIso3.get(focusIso3) ?? null;
    const outsideAbove =
      focusObsRank === null
        ? null
        : outside.filter((iso3) => (reObsByIso3.get(iso3) ?? Infinity) < focusObsRank).length;
    record(
      `${key}.partial_identity`,
      !iv.available ||
        (iv.fullGrowthRank === focusObsRank &&
          iv.commonGrowthRank === focusCommonRank &&
          (focusCommonRank === null || iv.fullGrowthRank - (outsideAbove ?? 0) === focusCommonRank)),
      iv.available
        ? { fullGrowthRank: iv.fullGrowthRank, commonGrowthRank: iv.commonGrowthRank, outsideAbove }
        : 'decomposition undefined without focus growth for the interval',
      iv.available,
    );
    if (iv.available) {
      record(`${key}.outside_counts_reconcile`, iv.outsideAbove === outsideAbove, {
        reported: iv.outsideAbove,
        recomputed: outsideAbove,
      });
    } else {
      record(`${key}.outside_counts_reconcile`, true, 'not applicable without focus growth', false);
    }

    // Peer averages: recompute (focus excluded, canonical ISO3 order).
    const peerObs = peerAverageGrowth(reObserved.ranked, focusIso3);
    const peerCommon = peerAverageGrowth(reCommon.ranked, focusIso3);
    record(`${key}.peer_avg_observed_matches_recomputation`, peerObs.mean === iv.peerAvgObserved, {
      recomputed: peerObs.mean,
      reported: iv.peerAvgObserved,
    });
    record(`${key}.peer_avg_common_matches_recomputation`, peerCommon.mean === iv.peerAvgCommon, {
      recomputed: peerCommon.mean,
      reported: iv.peerAvgCommon,
    });
    record(
      `${key}.peer_counts_reconcile`,
      iv.peerCountObserved === peerObs.count && iv.peerCountCommon === peerCommon.count,
      { peerCountObserved: iv.peerCountObserved, peerCountCommon: iv.peerCountCommon },
    );

    // Differences: plain subtraction when both sides exist.
    const diffObsOk =
      (iv.vsPeerObservedPp === null) ===
        (iv.indiaGrowthPercent === null || iv.peerAvgObserved === null) &&
      (iv.vsPeerObservedPp === null ||
        iv.vsPeerObservedPp === iv.indiaGrowthPercent - iv.peerAvgObserved);
    const diffCommonOk =
      (iv.vsPeerCommonPp === null) ===
        (iv.indiaGrowthPercent === null || iv.peerAvgCommon === null || iv.commonGrowthRank === null) &&
      (iv.vsPeerCommonPp === null || iv.vsPeerCommonPp === iv.indiaGrowthPercent - iv.peerAvgCommon);
    record(`${key}.diff_observed_matches_subtraction`, diffObsOk, {
      vsPeerObservedPp: iv.vsPeerObservedPp,
    });
    record(`${key}.diff_common_matches_subtraction`, diffCommonOk, {
      vsPeerCommonPp: iv.vsPeerCommonPp,
    });

    // Null coherence.
    record(
      `${key}.null_coherence`,
      (iv.peerAvgObserved === null) === (iv.peerCountObserved === 0) &&
        (iv.peerAvgCommon === null) === (iv.peerCountCommon === 0) &&
        (iv.peerAvgObserved === null || iv.peerAvgReasonObserved === null) &&
        (iv.peerAvgCommon === null || iv.peerAvgReasonCommon === null) &&
        (iv.vsPeerObservedPp === null || iv.vsPeerReasonObserved === null) &&
        (iv.vsPeerCommonPp === null || iv.vsPeerReasonCommon === null),
      {
        peerAvgObserved: iv.peerAvgObserved,
        peerCountObserved: iv.peerCountObserved,
        peerAvgCommon: iv.peerAvgCommon,
        peerCountCommon: iv.peerCountCommon,
      },
    );

    // Rank bounds.
    record(
      `${key}.ranks_within_bounds`,
      (iv.fullGrowthRank === null || (iv.fullGrowthRank >= 1 && iv.fullGrowthRank <= iv.denominatorObserved)) &&
        (iv.commonGrowthRank === null || (iv.commonGrowthRank >= 1 && iv.commonGrowthRank <= iv.denominatorCommon)),
      {
        fullGrowthRank: iv.fullGrowthRank,
        denominatorObserved: iv.denominatorObserved,
        commonGrowthRank: iv.commonGrowthRank,
        denominatorCommon: iv.denominatorCommon,
      },
    );

    // Every ranked row holds finite growth (no invalid row was ranked).
    const allFinite =
      observed.every((r) => Number.isFinite(r.yoyPercent)) &&
      commonRows.every((r) => Number.isFinite(r.yoyPercent));
    record(`${key}.ranked_rows_hold_finite_growth`, allFinite, {
      observed: observed.length,
      common: commonRows.length,
    });
  }

  // Shared universe: identical U underlies every interval's like-for-like
  // ranking (three-year mode); two-year mode has a single interval.
  const commonSorted = sortedUnique(members.common ?? []);
  record('common.universe_identical_across_intervals', sameMembers(members.common ?? [], commonSorted), {
    common: commonSorted.length,
  });
  if (comparison.hasMid) {
    const everyCommonValidEverywhere = commonSorted.every((iso3) =>
      ['AM', 'MB', 'AB'].every((key) =>
        (economies ?? []).some((e) => e.iso3 === iso3 && e.intervals?.[key]?.valid === true),
      ),
    );
    record('common.members_valid_in_every_interval', everyCommonValidEverywhere, {
      common: commonSorted.length,
    });
  } else {
    record('common.members_valid_in_every_interval', true, 'single interval mode', false);
  }

  // Integer-only analytic outputs (growth percents/averages/diffs are floats
  // by design and are excluded here; display rounding happens in the service).
  const integerFields = [];
  for (const key of intervalKeys) {
    const iv = intervals[key];
    integerFields.push(
      iv.fullGrowthRank,
      iv.commonGrowthRank,
      iv.denominatorObserved,
      iv.denominatorCommon,
      iv.outsideAbove,
      iv.outsideBelow,
      iv.peerCountObserved,
      iv.peerCountCommon,
    );
  }
  integerFields.push(totals.AB, totals.AM, totals.MB, totals.common, totals.outsideAB, totals.outsideAM, totals.outsideMB);
  record(
    'outputs.integers_only',
    integerFields.every((value) => value === null || Number.isInteger(value)),
    { fields: integerFields.length },
  );

  return { passed: checks.every((check) => check.status === 'pass'), checks };
}

export default {
  GROWTH_REASONS,
  GROWTH_REASON_DESCRIPTIONS,
  GROWTH_POPULATION_LABEL,
  GROWTH_INTERVALS,
  peerAverageGrowth,
  buildGrowthComparison,
  verifyGrowthComparison,
};
