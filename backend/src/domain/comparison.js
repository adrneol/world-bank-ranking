/**
 * RANK-MOVEMENT COMPARISON ENGINE (pure functions, no I/O).
 *
 * WHY THIS MODULE EXISTS
 * A yearly rank such as 171/209 and another year's 172/213 cannot be read as
 * "the economy moved from position 171 to position 172": the ranked population
 * itself changed between the two years. This module separates the two effects
 * exactly and verifiably.
 *
 * MODEL (one indicator, two selected years a and b)
 *   S_y        = eligible economies holding a stored valid observation in year y
 *   A = S_a, B = S_b
 *   Common = A intersect B, Exited = A minus B, Entered = B minus A
 *   rank_y(c)  = 1 + number of economies in S_y positioned before c
 *   The order is THE PROJECT'S ONLY COMPARATOR: value DESC, ISO3 ASC
 *   (compareByValueDesc from domain/ranking.js — imported here, never
 *    re-implemented, so level ordering cannot drift).
 *
 * THEOREMS (exact integer identities; proofs partition the predecessor sets)
 *   (P1) commonRankA = fullRankA − exitedAboveA
 *   (P2) commonRankB = fullRankB − enteredAboveB
 *   (D)  fullRankB − fullRankA = (commonRankB − commonRankA)
 *                               + enteredAboveB − exitedAboveA
 *
 * WHY (D) IS EXACT: the comparator is ROW-LOCAL — its keys (value, ISO3) depend
 * on the row alone, so restricting the order to a subset preserves it. If a
 * future comparator used set-level statistics (z-scores, percentiles, means),
 * restricting the order would NOT preserve it and (D) would silently become
 * false. verifyComparison() exists to fail closed if that ever happened.
 *
 * SIGN SEMANTICS (rank numbers are positions: a LOWER number is a HIGHER place)
 *   positionNumberChange = fullRankB − fullRankA
 *        positive -> the position number increased -> the economy moved DOWN
 *   placesGained         = fullRankA − fullRankB
 *        positive -> the economy moved UP
 *   commonEffect         = commonRankB − commonRankA   (same convention)
 *   observedSetEffect    = positionNumberChange − commonEffect
 *                        = enteredAboveB − exitedAboveA
 * The service passes these semantics to the UI; the frontend never infers them.
 *
 * "ABOVE THE FOCUS ECONOMY" IS POSITIONAL: an economy is above India when it is
 * positioned BEFORE India in the exact ranking order — never when it merely has
 * a larger raw value. The two differ whenever values tie, because the ISO3
 * tie-break decides those positions. A value comparison would break (D).
 *
 * WHAT THIS MODULE NEVER DOES
 *   * no SQL, no fetching, no caching, no logging
 *   * no presentation formatting and no rounding (display strings are built in
 *     the service/format layer; this module sees numbers alone)
 *   * no inference about WHY an observation is absent — it reports membership of
 *     the stored valid-observation sets and nothing else
 *   * never treats an absent observation as zero
 *   * never reuses a level universe for a YoY comparison (separate entry point
 *     with its own validity rule, built by domain/yoyRanking.js)
 */

import { compareByValueDesc, rankByValue } from './ranking.js';
import { buildYoyRows, rankByYoy } from './yoyRanking.js';
/** Which ranking concept a comparison uses. Never mixed inside one response. */
export const COMPARISON_MODE = Object.freeze({ LEVEL: 'level', YOY: 'yoy' });

/** Membership of one economy in the two selected years' observed sets. */
export const ECONOMY_STATUS = Object.freeze({
  COMMON: 'common',
  ENTERED: 'entered',
  EXITED: 'exited',
});

/** Position of one economy relative to the focus economy, by ranking position. */
export const ECONOMY_RELATION = Object.freeze({
  ABOVE: 'above',
  BELOW: 'below',
  FOCUS: 'focus',
  UNKNOWN: 'unknown',
});

/** What an entered/exited economy does to the focus economy's position. */
export const POSITION_EFFECT = Object.freeze({
  AFFECTS_POSITION: 'affects_position',
  DENOMINATOR_ONLY: 'denominator_only',
  NOT_APPLICABLE: 'not_applicable',
});

/** Machine-readable reasons why a comparison cannot be produced or decomposed. */
export const COMPARISON_REASONS = Object.freeze({
  METRIC_NOT_INGESTED: 'metric_not_ingested',
  NO_STORED_OBSERVATIONS: 'no_stored_observations_for_metric_and_year',
  FOCUS_MISSING_IN_A: 'focus_missing_in_yearA',
  FOCUS_MISSING_IN_B: 'focus_missing_in_yearB',
  FOCUS_MISSING_IN_BOTH: 'focus_missing_in_both_years',
  FOCUS_MISSING_IN_MID: 'focus_missing_in_yearMid',
  FOCUS_MISSING_IN_MULTIPLE: 'focus_missing_in_multiple_years',
  NO_YOY_PAIR_IN_A: 'no_valid_yoy_pair_in_period_A',
  NO_YOY_PAIR_IN_B: 'no_valid_yoy_pair_in_period_B',
  NO_YOY_PAIR_IN_BOTH: 'no_valid_yoy_pair_in_either_period',
});

/** Population wording reused by the service so every surface stays consistent. */
export const COMPARISON_POPULATION_LABEL =
  'eligible economies with a valid World Bank observation for this indicator and year';

/** Human-readable wording for every exposed field (presentation must not guess). */
export const COMPARISON_FIELD_MEANINGS = Object.freeze({
  setA: 'Eligible economies holding a valid World Bank observation for this indicator in year A.',
  setB: 'Eligible economies holding a valid World Bank observation for this indicator in year B.',
  setMid: 'Eligible economies holding a valid World Bank observation for this indicator in the point-breaker (middle) year.',
  common:
    'Exactly the economies observed in both selected years (the intersection of the two valid-observation sets).',
  common3:
    'Exactly the economies observed in all three selected years (the intersection of the three valid-observation sets: start, point breaker and end).',
  outside3:
    'Economies observed in at least one selected year but missing in at least one other selected year (the union minus the three-year common set).',
  exited:
    'Exactly the economies observed in year A whose valid observation is absent in year B (set difference A minus B).',
  entered:
    'Exactly the economies observed in year B whose valid observation is absent in year A (set difference B minus A).',
  fullRank:
    'Position in the full observed ranking for that year: value descending, ISO3 ascending, 1-based ordinal positions.',
  commonRank:
    'DERIVED COMPARISON POSITION: the focus economy ranked only among the economies observed in BOTH years, using that year values and the same comparator. This is neither a World Bank rank nor an observed-year rank.',
  positionNumberChange:
    'fullRankB minus fullRankA. Positive means the position number increased (a lower place); negative means the position number decreased (a higher place).',
  placesGained:
    'fullRankA minus fullRankB. Positive means the economy moved up; negative means it moved down.',
  commonEffect:
    'commonRankB minus commonRankA: movement among the economies observed in BOTH years (same sign convention as positionNumberChange).',
  observedSetEffect:
    'enteredAboveB minus exitedAboveA: the exact number of places contributed by economies entering or leaving the observed ranking ABOVE the focus economy. Entering/leaving economies below it do not change its position.',
  denominatorChange:
    'Set B size minus set A size: economies entering minus economies leaving the observed ranking.',
  relationToFocus:
    'Ranking position relative to the focus economy in the year the economy is observed (year A for exited economies, year B for entered economies, year B for common economies; both years are exposed separately).',
  positionEffect:
    'Whether the economy can change the focus economy position (entered/exited above it) or only the denominator (entered/exited below it).',
  membership:
    'Entry and exit describe VALID-OBSERVATION SET membership only. They never imply that an economy was created, dissolved, recognised or removed by the World Bank.',
});

/**
 * Build the identity of one economy's ordering position inside a ranked list.
 *
 * @param {{ iso3: string, rank: number }[]} ranked
 * @returns {{ rankByIso3: Map<string, number>, order: string[] }}
 */
function toRankIndex(ranked) {
  const rankByIso3 = new Map();
  const order = [];
  for (const row of ranked) {
    rankByIso3.set(row.iso3, row.rank);
    order.push(row.iso3);
  }
  return { rankByIso3, order };
}

/** Positional relation of one economy to the focus economy (never value based). */
function relationTo(iso3, focusIso3, rankByIso3) {
  if (!rankByIso3) return ECONOMY_RELATION.UNKNOWN;
  const focusRank = rankByIso3.get(focusIso3);
  const rank = rankByIso3.get(iso3);
  if (focusRank === undefined || rank === undefined) return ECONOMY_RELATION.UNKNOWN;
  if (iso3 === focusIso3) return ECONOMY_RELATION.FOCUS;
  return rank < focusRank ? ECONOMY_RELATION.ABOVE : ECONOMY_RELATION.BELOW;
}

/**
 * Shared core for level and YoY comparisons.
 *
 * The two modes differ only in (i) how a row's ordering key is obtained and
 * (ii) which ranking engine is authoritative. Both engines are the EXISTING
 * ones; this function never sorts or compares two values itself.
 *
 * @param {object} input
 * @param {string} input.mode COMPARISON_MODE
 * @param {string} input.focusIso3
 * @param {object[]} input.rowsA rows of set A (eligible stored rows already filtered by the repository)
 * @param {object[]} input.rowsB rows of set B
 * @param {(rows: object[]) => { ranked: object[] }} input.rank authoritative engine
 * @param {(row: object) => number} input.keyOf the ranked quantity of a row (value, or yoyPercent)
 * @param {(row: object) => object} [input.extrasOf] extra audit numbers carried through per row
 * @param {{ a: string, b: string, both: string }} input.missingReasons reason codes when the focus is absent
 */
function buildComparisonCore({
  mode,
  focusIso3,
  rowsA,
  rowsB,
  rank,
  keyOf,
  extrasOf = () => ({}),
  missingReasons,
}) {
  const sourceA = rowsA ?? [];
  const sourceB = rowsB ?? [];

  const rankedA = rank(sourceA);
  const rankedB = rank(sourceB);
  const indexA = toRankIndex(rankedA.ranked);
  const indexB = toRankIndex(rankedB.ranked);

  const rowByIso3A = new Map(sourceA.map((row) => [row.iso3, row]));
  const rowByIso3B = new Map(sourceB.map((row) => [row.iso3, row]));

  // Exact set algebra over ISO3 membership taken from the stored observations.
  const membersCommon = [...indexA.rankByIso3.keys()]
    .filter((iso3) => indexB.rankByIso3.has(iso3))
    .sort();
  const membersExited = [...indexA.rankByIso3.keys()]
    .filter((iso3) => !indexB.rankByIso3.has(iso3))
    .sort();
  const membersEntered = [...indexB.rankByIso3.keys()]
    .filter((iso3) => !indexA.rankByIso3.has(iso3))
    .sort();

  // The common universe is ranked twice with the SAME engine and comparator,
  // once per year's values. Membership never comes from count arithmetic.
  const commonIndexA = toRankIndex(rank(membersCommon.map((iso3) => rowByIso3A.get(iso3))).ranked);
  const commonIndexB = toRankIndex(rank(membersCommon.map((iso3) => rowByIso3B.get(iso3))).ranked);

  const inA = indexA.rankByIso3.has(focusIso3);
  const inB = indexB.rankByIso3.has(focusIso3);
  const focusRowA = inA ? rowByIso3A.get(focusIso3) : null;
  const focusRowB = inB ? rowByIso3B.get(focusIso3) : null;

  const baseUnavailable = {
    available: false,
    reason: !inA && !inB ? missingReasons.both : inA ? missingReasons.b : missingReasons.a,
    iso3: focusIso3,
    name: (focusRowA ?? focusRowB)?.name ?? null,
    keyA: focusRowA ? keyOf(focusRowA) : null,
    keyB: focusRowB ? keyOf(focusRowB) : null,
    fullRankA: inA ? indexA.rankByIso3.get(focusIso3) : null,
    fullRankB: inB ? indexB.rankByIso3.get(focusIso3) : null,
    denominatorA: rankedA.ranked.length,
    denominatorB: rankedB.ranked.length,
    denominatorCommon: membersCommon.length,
    commonRankA: null,
    commonRankB: null,
    exitedAboveA: null,
    exitedBelowA: null,
    enteredAboveB: null,
    enteredBelowB: null,
    positionNumberChange: null,
    commonEffect: null,
    observedSetEffect: null,
    placesGained: null,
  };

  let focus = baseUnavailable;
  if (inA && inB) {
    // Position-based counts via rank maps (O(n)): rank numbers are 1-based
    // ordinal positions from the trusted engine, so rank < focusRank is
    // exactly "positioned before the focus economy". Never compare raw values.
    const focusRankForA = indexA.rankByIso3.get(focusIso3);
    const focusRankForB = indexB.rankByIso3.get(focusIso3);
    const exitedAboveA = membersExited.filter(
      (iso3) => indexA.rankByIso3.get(iso3) < focusRankForA,
    ).length;
    const enteredAboveB = membersEntered.filter(
      (iso3) => indexB.rankByIso3.get(iso3) < focusRankForB,
    ).length;
    const fullRankA = indexA.rankByIso3.get(focusIso3);
    const fullRankB = indexB.rankByIso3.get(focusIso3);
    const commonRankA = commonIndexA.rankByIso3.get(focusIso3);
    const commonRankB = commonIndexB.rankByIso3.get(focusIso3);
    const positionNumberChange = fullRankB - fullRankA;
    const commonEffect = commonRankB - commonRankA;

    focus = {
      available: true,
      reason: null,
      iso3: focusIso3,
      name: focusRowA?.name ?? focusRowB?.name ?? null,
      keyA: keyOf(focusRowA),
      keyB: keyOf(focusRowB),
      fullRankA,
      fullRankB,
      commonRankA,
      commonRankB,
      denominatorA: rankedA.ranked.length,
      denominatorB: rankedB.ranked.length,
      denominatorCommon: membersCommon.length,
      exitedAboveA,
      exitedBelowA: membersExited.length - exitedAboveA,
      enteredAboveB,
      enteredBelowB: membersEntered.length - enteredAboveB,
      positionNumberChange,
      commonEffect,
      observedSetEffect: positionNumberChange - commonEffect,
      placesGained: fullRankA - fullRankB,
    };
  }

  const statusOf = (iso3) =>
    indexB.rankByIso3.has(iso3)
      ? indexA.rankByIso3.has(iso3)
        ? ECONOMY_STATUS.COMMON
        : ECONOMY_STATUS.ENTERED
      : ECONOMY_STATUS.EXITED;

  const union = [...new Set([...indexA.order, ...indexB.order])].sort();
  const economies = union.map((iso3) => {
    const status = statusOf(iso3);
    const rowA = rowByIso3A.get(iso3) ?? null;
    const rowB = rowByIso3B.get(iso3) ?? null;
    const relationToFocusA = relationTo(iso3, focusIso3, inA ? indexA.rankByIso3 : null);
    const relationToFocusB = relationTo(iso3, focusIso3, inB ? indexB.rankByIso3 : null);
    // The status year decides which relation drives the "effect" statement:
    // exited -> year A positions, entered -> year B positions, common -> year B.
    const relationToFocus =
      status === ECONOMY_STATUS.EXITED ? relationToFocusA : relationToFocusB;
    const affectsFocusPosition =
      status === ECONOMY_STATUS.EXITED
        ? relationToFocusA === ECONOMY_RELATION.ABOVE
        : status === ECONOMY_STATUS.ENTERED
          ? relationToFocusB === ECONOMY_RELATION.ABOVE
          : false;
    const positionEffect =
      status === ECONOMY_STATUS.COMMON
        ? POSITION_EFFECT.NOT_APPLICABLE
        : affectsFocusPosition
          ? POSITION_EFFECT.AFFECTS_POSITION
          : POSITION_EFFECT.DENOMINATOR_ONLY;

    return {
      iso3,
      name: rowA?.name ?? rowB?.name ?? null,
      status,
      relationToFocus,
      relationToFocusA,
      relationToFocusB,
      positionEffect,
      affectsFocusPosition,
      rankA: indexA.rankByIso3.get(iso3) ?? null,
      rankB: indexB.rankByIso3.get(iso3) ?? null,
      keyA: rowA ? keyOf(rowA) : null,
      keyB: rowB ? keyOf(rowB) : null,
      extrasA: rowA ? extrasOf(rowA) : null,
      extrasB: rowB ? extrasOf(rowB) : null,
      tiedWithFocusA:
        iso3 !== focusIso3 && Boolean(rowA) && Boolean(focusRowA) && keyOf(rowA) === keyOf(focusRowA),
      tiedWithFocusB:
        iso3 !== focusIso3 && Boolean(rowB) && Boolean(focusRowB) && keyOf(rowB) === keyOf(focusRowB),
    };
  });

  return {
    mode,
    focusIso3,
    members: {
      a: indexA.order.slice(),
      b: indexB.order.slice(),
      common: membersCommon,
      exited: membersExited,
      entered: membersEntered,
    },
    totals: {
      a: rankedA.ranked.length,
      b: rankedB.ranked.length,
      common: membersCommon.length,
      exited: membersExited.length,
      entered: membersEntered.length,
    },
    ranks: {
      a: indexA.rankByIso3,
      b: indexB.rankByIso3,
      commonA: commonIndexA.rankByIso3,
      commonB: commonIndexB.rankByIso3,
    },
    orders: {
      a: indexA.order,
      b: indexB.order,
      commonA: commonIndexA.order,
      commonB: commonIndexB.order,
    },
    focus,
    economies,
  };
}
/**
 * LEVEL comparison entry point: sets come from the stored level observations and
 * the level engine (value DESC, ISO3 ASC).
 *
 * @param {{ rowsA: object[], rowsB: object[], focusIso3: string }} input
 */
export function buildLevelComparison({ rowsA, rowsB, focusIso3 }) {
  return buildComparisonCore({
    mode: COMPARISON_MODE.LEVEL,
    focusIso3: String(focusIso3 ?? '').toUpperCase(),
    rowsA,
    rowsB,
    rank: rankByValue,
    keyOf: (row) => row.value,
    extrasOf: (row) => ({ valueRaw: row.valueRaw ?? String(row.value) }),
    missingReasons: {
      a: COMPARISON_REASONS.FOCUS_MISSING_IN_A,
      b: COMPARISON_REASONS.FOCUS_MISSING_IN_B,
      both: COMPARISON_REASONS.FOCUS_MISSING_IN_BOTH,
    },
  });
}

/**
 * YoY comparison entry point. Sets are economies with a CALCULABLE year-over-
 * year change for the period (both years observed, previous value strictly
 * positive), built by the existing domain/yoyRanking.buildYoyRows — never the
 * level universe.
 *
 * @param {{ currentA: object[], previousA: object[], currentB: object[],
 *           previousB: object[], focusIso3: string }} input
 */
export function buildYoyComparison({ currentA, previousA, currentB, previousB, focusIso3 }) {
  return buildComparisonCore({
    mode: COMPARISON_MODE.YOY,
    focusIso3: String(focusIso3 ?? '').toUpperCase(),
    rowsA: buildYoyRows(currentA ?? [], previousA ?? []).rows,
    rowsB: buildYoyRows(currentB ?? [], previousB ?? []).rows,
    rank: rankByYoy,
    keyOf: (row) => row.yoyPercent,
    extrasOf: (row) => ({
      previousValue: row.previousValue,
      currentValue: row.currentValue,
      previousValueRaw: row.previousValueRaw ?? String(row.previousValue),
      currentValueRaw: row.currentValueRaw ?? String(row.currentValue),
    }),
    missingReasons: {
      a: COMPARISON_REASONS.NO_YOY_PAIR_IN_A,
      b: COMPARISON_REASONS.NO_YOY_PAIR_IN_B,
      both: COMPARISON_REASONS.NO_YOY_PAIR_IN_BOTH,
    },
  });
}

/** Sorted unique copy of an ISO3 list (order-independent set comparison). */
function sortedUnique(list) {
  return [...new Set(list ?? [])].sort();
}

/** True when two ISO3 lists contain exactly the same members. */
function sameMembers(a, b) {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return left.length === right.length && left.every((iso3, index) => iso3 === right[index]);
}

/**
 * SELF-VERIFICATION (fail-closed contract).
 *
 * Every check re-derives its expectation from the comparison object's own
 * membership and ordering data — it never trusts a previously computed count.
 * A failing check means the analytical numbers must NOT be published.
 *
 * @param {object} comparison output of buildLevelComparison/buildYoyComparison
 * @returns {{ passed: boolean, checks: {check:string,status:string,detail:object|string|null}[] }}
 */
export function verifyComparison(comparison) {
  const checks = [];
  const record = (check, passed, detail = null, applicable = true) =>
    checks.push({
      check,
      status: passed ? 'pass' : 'fail',
      detail: applicable ? detail : { applicable: false, reason: detail },
    });

  const { members, totals, orders, ranks, focus } = comparison;
  const setA = sortedUnique(members.a);
  const setB = sortedUnique(members.b);
  const intersection = setA.filter((iso3) => setB.includes(iso3));
  const differenceAB = setA.filter((iso3) => !setB.includes(iso3));
  const differenceBA = setB.filter((iso3) => !setA.includes(iso3));

  record('A.set_partition', totals.a === totals.common + totals.exited, {
    setA: totals.a,
    common: totals.common,
    exited: totals.exited,
  });
  record('B.set_partition', totals.b === totals.common + totals.entered, {
    setB: totals.b,
    common: totals.common,
    entered: totals.entered,
  });
  record('common.is_exact_intersection', sameMembers(members.common, intersection), {
    reported: members.common.length,
    recomputed: intersection.length,
  });
  record('exited.is_exact_difference', sameMembers(members.exited, differenceAB), {
    reported: members.exited.length,
    recomputed: differenceAB.length,
  });
  record('entered.is_exact_difference', sameMembers(members.entered, differenceBA), {
    reported: members.entered.length,
    recomputed: differenceBA.length,
  });
  const disjoint =
    !members.common.some((iso3) => members.exited.includes(iso3)) &&
    !members.common.some((iso3) => members.entered.includes(iso3)) &&
    !members.exited.some((iso3) => members.entered.includes(iso3));
  record('members.disjoint', disjoint, {
    common: members.common.length,
    exited: members.exited.length,
    entered: members.entered.length,
  });
  record(
    'members.unique_and_partitioned',
    members.common.length + members.exited.length === setA.length &&
      members.common.length + members.entered.length === setB.length &&
      setA.length === members.a.length &&
      setB.length === members.b.length,
    {
      setA: setA.length,
      rankedA: members.a.length,
      setB: setB.length,
      rankedB: members.b.length,
    },
  );

  const orderMatchesRanks = (order, rankMap, expectedMembers) =>
    sameMembers(order, expectedMembers) &&
    order.every((iso3, index) => rankMap.get(iso3) === index + 1) &&
    rankMap.size === order.length;
  record('A.ranking_matches_engine_order', orderMatchesRanks(orders.a, ranks.a, members.a), {
    size: orders.a.length,
  });
  record('B.ranking_matches_engine_order', orderMatchesRanks(orders.b, ranks.b, members.b), {
    size: orders.b.length,
  });
  record(
    'common.ranking_A_matches_engine_order',
    orderMatchesRanks(orders.commonA, ranks.commonA, members.common),
    { size: orders.commonA.length },
  );
  record(
    'common.ranking_B_matches_engine_order',
    orderMatchesRanks(orders.commonB, ranks.commonB, members.common),
    { size: orders.commonB.length },
  );

  const focusInExited = members.exited.includes(comparison.focusIso3);
  const focusInEntered = members.entered.includes(comparison.focusIso3);
  const undefinedNote = 'decomposition undefined without the focus economy in both years';

  record(
    'exited.above_below_reconciles',
    !focus.available ||
      focus.exitedAboveA + focus.exitedBelowA + (focusInExited ? 1 : 0) === totals.exited,
    focus.available
      ? {
          above: focus.exitedAboveA,
          below: focus.exitedBelowA,
          focusInExited,
          total: totals.exited,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'entered.above_below_reconciles',
    !focus.available ||
      focus.enteredAboveB + focus.enteredBelowB + (focusInEntered ? 1 : 0) === totals.entered,
    focus.available
      ? {
          above: focus.enteredAboveB,
          below: focus.enteredBelowB,
          focusInEntered,
          total: totals.entered,
        }
      : undefinedNote,
    focus.available,
  );

  record(
    'partial_identity_A',
    !focus.available || focus.commonRankA === focus.fullRankA - focus.exitedAboveA,
    focus.available
      ? {
          commonRankA: focus.commonRankA,
          fullRankA: focus.fullRankA,
          exitedAboveA: focus.exitedAboveA,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'partial_identity_B',
    !focus.available || focus.commonRankB === focus.fullRankB - focus.enteredAboveB,
    focus.available
      ? {
          commonRankB: focus.commonRankB,
          fullRankB: focus.fullRankB,
          enteredAboveB: focus.enteredAboveB,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.identity',
    !focus.available ||
      focus.positionNumberChange === focus.commonEffect + focus.observedSetEffect,
    focus.available
      ? {
          positionNumberChange: focus.positionNumberChange,
          commonEffect: focus.commonEffect,
          observedSetEffect: focus.observedSetEffect,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.observed_set_effect_matches_counts',
    !focus.available || focus.observedSetEffect === focus.enteredAboveB - focus.exitedAboveA,
    focus.available
      ? { enteredAboveB: focus.enteredAboveB, exitedAboveA: focus.exitedAboveA }
      : undefinedNote,
    focus.available,
  );

  // Classification must follow ranking positions, never raw values.
  // The focus economy itself is skipped: its relation is FOCUS by definition,
  // not ABOVE/BELOW, and it never affects its own position.
  const focusRankA = ranks.a.get(comparison.focusIso3) ?? null;
  const focusRankB = ranks.b.get(comparison.focusIso3) ?? null;
  let classificationOk = true;
  let classificationChecked = 0;
  for (const economy of comparison.economies ?? []) {
    if (economy.iso3 === comparison.focusIso3) continue;
    const expected =
      economy.status === ECONOMY_STATUS.EXITED && focusRankA !== null
        ? economy.rankA < focusRankA
        : economy.status === ECONOMY_STATUS.ENTERED && focusRankB !== null
          ? economy.rankB < focusRankB
          : null;
    if (expected === null) continue;
    classificationChecked += 1;
    const relation =
      economy.status === ECONOMY_STATUS.EXITED
        ? economy.relationToFocusA
        : economy.relationToFocusB;
    if (relation !== (expected ? ECONOMY_RELATION.ABOVE : ECONOMY_RELATION.BELOW)) {
      classificationOk = false;
    }
    if (economy.affectsFocusPosition !== expected) classificationOk = false;
    if (expected !== (economy.positionEffect === POSITION_EFFECT.AFFECTS_POSITION)) {
      classificationOk = false;
    }
  }
  record('classification.position_based', classificationOk, { checked: classificationChecked });

  // Rank bounds: every reported rank must lie within its denominator.
  // Storage-dependent checks (aggregate membership, metadata resolution,
  // vintage coherence) intentionally live in the service layer, not here.
  const rankBoundsOk =
    (focus.fullRankA === null || (focus.fullRankA >= 1 && focus.fullRankA <= totals.a)) &&
    (focus.fullRankB === null || (focus.fullRankB >= 1 && focus.fullRankB <= totals.b)) &&
    (focus.commonRankA === null ||
      (focus.commonRankA >= 1 && focus.commonRankA <= totals.common)) &&
    (focus.commonRankB === null ||
      (focus.commonRankB >= 1 && focus.commonRankB <= totals.common)) &&
    totals.a >= 0 &&
    totals.b >= 0 &&
    totals.common >= 0 &&
    totals.exited >= 0 &&
    totals.entered >= 0;
  record('ranks.within_bounds', rankBoundsOk, {
    fullRankA: focus.fullRankA,
    denominatorA: totals.a,
    fullRankB: focus.fullRankB,
    denominatorB: totals.b,
    commonRankA: focus.commonRankA,
    commonRankB: focus.commonRankB,
    denominatorCommon: totals.common,
  });

  // Analytic outputs must be integers (or null): no rounded/float analytics.
  const integerFields = [
    focus.fullRankA,
    focus.fullRankB,
    focus.commonRankA,
    focus.commonRankB,
    focus.exitedAboveA,
    focus.exitedBelowA,
    focus.enteredAboveB,
    focus.enteredBelowB,
    focus.positionNumberChange,
    focus.commonEffect,
    focus.observedSetEffect,
    focus.placesGained,
    totals.a,
    totals.b,
    totals.common,
    totals.exited,
    totals.entered,
  ];
  record(
    'outputs.integers_only',
    integerFields.every((value) => value === null || Number.isInteger(value)),
    { fields: integerFields.length },
  );

  return { passed: checks.every((check) => check.status === 'pass'), checks };
}

/**
 * THREE-YEAR (POINT-BREAKER) COMPARISON CORE.
 *
 * Generalization of the two-year model to three selected observation years:
 *   S_a, S_m, S_b = eligible economies with a stored valid observation in
 *                   year A, year MID (point breaker) and year B.
 *   COMMON_3 = S_a ∩ S_m ∩ S_b  (the single shared comparison universe)
 *   OUTSIDE  = (S_a ∪ S_m ∪ S_b) − COMMON_3
 *
 * Ranking reuse: every ranking below uses the SAME authoritative engine
 * (rankByValue for level mode) and the SAME comparator (value DESC, ISO3 ASC).
 * Nothing here re-implements ordering.
 *
 * Focus arithmetic (exact, per year Y in {A, MID, B}):
 *   outsideAboveY = fullRankY − commonRankY
 *     = number of OUTSIDE economies present in year Y positioned before the
 *       focus economy in year Y's full ranking. This generalizes the two-year
 *       exitedAboveA / enteredAboveB counts.
 *   For any segment P → Q (both in {A, MID, B}):
 *     fullQ − fullP = (commonQ − commonP) + (outsideAboveQ − outsideAboveP)
 *   so the two-year decomposition identity is preserved per segment with the
 *   same sign convention (positive = position number increased = lower place).
 */

/** Status values used only by three-year comparisons (two-year codes untouched). */
export const THREE_YEAR_STATUS = Object.freeze({
  COMMON: 'common',
  OUTSIDE: 'outside',
});

function buildThreeYearCore({
  mode,
  focusIso3,
  rowsA,
  rowsMid,
  rowsB,
  rank,
  keyOf,
  extrasOf = () => ({}),
}) {
  const sourceA = rowsA ?? [];
  const sourceMid = rowsMid ?? [];
  const sourceB = rowsB ?? [];

  const rankedA = rank(sourceA);
  const rankedMid = rank(sourceMid);
  const rankedB = rank(sourceB);
  const indexA = toRankIndex(rankedA.ranked);
  const indexMid = toRankIndex(rankedMid.ranked);
  const indexB = toRankIndex(rankedB.ranked);

  const rowByIso3A = new Map(sourceA.map((row) => [row.iso3, row]));
  const rowByIso3Mid = new Map(sourceMid.map((row) => [row.iso3, row]));
  const rowByIso3B = new Map(sourceB.map((row) => [row.iso3, row]));

  // Exact three-way set algebra over ISO3 membership.
  const setA = [...indexA.rankByIso3.keys()];
  const setMid = [...indexMid.rankByIso3.keys()];
  const setB = [...indexB.rankByIso3.keys()];
  const inMidSet = new Set(setMid);
  const inBSet = new Set(setB);
  const membersCommon = setA.filter((iso3) => inMidSet.has(iso3) && inBSet.has(iso3)).sort();
  const commonSet = new Set(membersCommon);
  const union = [...new Set([...setA, ...setMid, ...setB])].sort();
  const membersOutside = union.filter((iso3) => !commonSet.has(iso3)).sort();
  const membersOutsideInA = setA.filter((iso3) => !commonSet.has(iso3)).sort();
  const membersOutsideInMid = setMid.filter((iso3) => !commonSet.has(iso3)).sort();
  const membersOutsideInB = setB.filter((iso3) => !commonSet.has(iso3)).sort();

  // The three-year common universe is ranked three times with the SAME engine
  // and comparator, once per year's values. Membership never comes from counts.
  const commonIndexA = toRankIndex(rank(membersCommon.map((iso3) => rowByIso3A.get(iso3))).ranked);
  const commonIndexMid = toRankIndex(rank(membersCommon.map((iso3) => rowByIso3Mid.get(iso3))).ranked);
  const commonIndexB = toRankIndex(rank(membersCommon.map((iso3) => rowByIso3B.get(iso3))).ranked);

  const inA = indexA.rankByIso3.has(focusIso3);
  const inMid = indexMid.rankByIso3.has(focusIso3);
  const inB = indexB.rankByIso3.has(focusIso3);
  const focusRowA = inA ? rowByIso3A.get(focusIso3) : null;
  const focusRowMid = inMid ? rowByIso3Mid.get(focusIso3) : null;
  const focusRowB = inB ? rowByIso3B.get(focusIso3) : null;

  const missingYears = [
    !inA ? 'A' : null,
    !inMid ? 'MID' : null,
    !inB ? 'B' : null,
  ].filter(Boolean);
  const reason =
    missingYears.length === 0
      ? null
      : missingYears.length === 3
        ? COMPARISON_REASONS.FOCUS_MISSING_IN_BOTH
        : missingYears.length === 1 && missingYears[0] === 'A'
          ? COMPARISON_REASONS.FOCUS_MISSING_IN_A
          : missingYears.length === 1 && missingYears[0] === 'B'
            ? COMPARISON_REASONS.FOCUS_MISSING_IN_B
            : missingYears.length === 1 && missingYears[0] === 'MID'
              ? COMPARISON_REASONS.FOCUS_MISSING_IN_MID
              : COMPARISON_REASONS.FOCUS_MISSING_IN_MULTIPLE;

  const baseUnavailable = {
    available: false,
    reason,
    iso3: focusIso3,
    name: (focusRowA ?? focusRowMid ?? focusRowB)?.name ?? null,
    keyA: focusRowA ? keyOf(focusRowA) : null,
    keyMid: focusRowMid ? keyOf(focusRowMid) : null,
    keyB: focusRowB ? keyOf(focusRowB) : null,
    fullRankA: inA ? indexA.rankByIso3.get(focusIso3) : null,
    fullRankMid: inMid ? indexMid.rankByIso3.get(focusIso3) : null,
    fullRankB: inB ? indexB.rankByIso3.get(focusIso3) : null,
    denominatorA: rankedA.ranked.length,
    denominatorMid: rankedMid.ranked.length,
    denominatorB: rankedB.ranked.length,
    denominatorCommon: membersCommon.length,
    commonRankA: null,
    commonRankMid: null,
    commonRankB: null,
    outsideAboveA: null,
    outsideAboveMid: null,
    outsideAboveB: null,
    outsideBelowA: null,
    outsideBelowMid: null,
    outsideBelowB: null,
    positionNumberChangeAM: null,
    positionNumberChangeMB: null,
    positionNumberChange: null,
    commonEffectAM: null,
    commonEffectMB: null,
    commonEffect: null,
    observedSetEffectAM: null,
    observedSetEffectMB: null,
    observedSetEffect: null,
    placesGainedAM: null,
    placesGainedMB: null,
    placesGained: null,
  };

  let focus = baseUnavailable;
  if (inA && inMid && inB) {
    const fullRankA = indexA.rankByIso3.get(focusIso3);
    const fullRankMid = indexMid.rankByIso3.get(focusIso3);
    const fullRankB = indexB.rankByIso3.get(focusIso3);
    const commonRankA = commonIndexA.rankByIso3.get(focusIso3);
    const commonRankMid = commonIndexMid.rankByIso3.get(focusIso3);
    const commonRankB = commonIndexB.rankByIso3.get(focusIso3);
    // Position-based counts via rank maps: rank < focusRank is exactly
    // "positioned before the focus economy". Never compare raw values.
    const outsideAboveA = membersOutsideInA.filter(
      (iso3) => indexA.rankByIso3.get(iso3) < fullRankA,
    ).length;
    const outsideAboveMid = membersOutsideInMid.filter(
      (iso3) => indexMid.rankByIso3.get(iso3) < fullRankMid,
    ).length;
    const outsideAboveB = membersOutsideInB.filter(
      (iso3) => indexB.rankByIso3.get(iso3) < fullRankB,
    ).length;
    const positionNumberChangeAM = fullRankMid - fullRankA;
    const positionNumberChangeMB = fullRankB - fullRankMid;
    const positionNumberChange = fullRankB - fullRankA;
    const commonEffectAM = commonRankMid - commonRankA;
    const commonEffectMB = commonRankB - commonRankMid;
    const commonEffect = commonRankB - commonRankA;

    focus = {
      available: true,
      reason: null,
      iso3: focusIso3,
      name: focusRowA?.name ?? focusRowMid?.name ?? focusRowB?.name ?? null,
      keyA: keyOf(focusRowA),
      keyMid: keyOf(focusRowMid),
      keyB: keyOf(focusRowB),
      fullRankA,
      fullRankMid,
      fullRankB,
      commonRankA,
      commonRankMid,
      commonRankB,
      denominatorA: rankedA.ranked.length,
      denominatorMid: rankedMid.ranked.length,
      denominatorB: rankedB.ranked.length,
      denominatorCommon: membersCommon.length,
      outsideAboveA,
      outsideAboveMid,
      outsideAboveB,
      outsideBelowA: membersOutsideInA.length - outsideAboveA,
      outsideBelowMid: membersOutsideInMid.length - outsideAboveMid,
      outsideBelowB: membersOutsideInB.length - outsideAboveB,
      positionNumberChangeAM,
      positionNumberChangeMB,
      positionNumberChange,
      commonEffectAM,
      commonEffectMB,
      commonEffect,
      observedSetEffectAM: positionNumberChangeAM - commonEffectAM,
      observedSetEffectMB: positionNumberChangeMB - commonEffectMB,
      observedSetEffect: positionNumberChange - commonEffect,
      placesGainedAM: fullRankA - fullRankMid,
      placesGainedMB: fullRankMid - fullRankB,
      placesGained: fullRankA - fullRankB,
    };
  }

  const economies = union.map((iso3) => {
    const presentA = indexA.rankByIso3.has(iso3);
    const presentMid = indexMid.rankByIso3.has(iso3);
    const presentB = indexB.rankByIso3.has(iso3);
    const isCommon = commonSet.has(iso3);
    const status = isCommon ? THREE_YEAR_STATUS.COMMON : THREE_YEAR_STATUS.OUTSIDE;
    const rowA = rowByIso3A.get(iso3) ?? null;
    const rowMid = rowByIso3Mid.get(iso3) ?? null;
    const rowB = rowByIso3B.get(iso3) ?? null;
    const relationToFocusA = relationTo(iso3, focusIso3, inA ? indexA.rankByIso3 : null);
    const relationToFocusMid = relationTo(iso3, focusIso3, inMid ? indexMid.rankByIso3 : null);
    const relationToFocusB = relationTo(iso3, focusIso3, inB ? indexB.rankByIso3 : null);
    // Primary relation for list display: year B when present there,
    // else mid, else A (mirrors the two-year "status year decides" rule).
    const relationToFocus = presentB
      ? relationToFocusB
      : presentMid
        ? relationToFocusMid
        : relationToFocusA;
    const affectsA = presentA && relationToFocusA === ECONOMY_RELATION.ABOVE;
    const affectsMid = presentMid && relationToFocusMid === ECONOMY_RELATION.ABOVE;
    const affectsB = presentB && relationToFocusB === ECONOMY_RELATION.ABOVE;
    const affectsFocusPosition = !isCommon && (affectsA || affectsMid || affectsB);
    const positionEffect = isCommon
      ? POSITION_EFFECT.NOT_APPLICABLE
      : affectsFocusPosition
        ? POSITION_EFFECT.AFFECTS_POSITION
        : POSITION_EFFECT.DENOMINATOR_ONLY;

    return {
      iso3,
      name: rowA?.name ?? rowMid?.name ?? rowB?.name ?? null,
      status,
      presentInA: presentA,
      presentInMid: presentMid,
      presentInB: presentB,
      relationToFocus,
      relationToFocusA,
      relationToFocusMid,
      relationToFocusB,
      positionEffect,
      affectsFocusPosition,
      affectsFocusPositionA: affectsA,
      affectsFocusPositionMid: affectsMid,
      affectsFocusPositionB: affectsB,
      rankA: indexA.rankByIso3.get(iso3) ?? null,
      rankMid: indexMid.rankByIso3.get(iso3) ?? null,
      rankB: indexB.rankByIso3.get(iso3) ?? null,
      keyA: rowA ? keyOf(rowA) : null,
      keyMid: rowMid ? keyOf(rowMid) : null,
      keyB: rowB ? keyOf(rowB) : null,
      extrasA: rowA ? extrasOf(rowA) : null,
      extrasMid: rowMid ? extrasOf(rowMid) : null,
      extrasB: rowB ? extrasOf(rowB) : null,
      tiedWithFocusA:
        iso3 !== focusIso3 && Boolean(rowA) && Boolean(focusRowA) && keyOf(rowA) === keyOf(focusRowA),
      tiedWithFocusMid:
        iso3 !== focusIso3 && Boolean(rowMid) && Boolean(focusRowMid) && keyOf(rowMid) === keyOf(focusRowMid),
      tiedWithFocusB:
        iso3 !== focusIso3 && Boolean(rowB) && Boolean(focusRowB) && keyOf(rowB) === keyOf(focusRowB),
    };
  });

  return {
    mode,
    focusIso3,
    members: {
      a: indexA.order.slice(),
      mid: indexMid.order.slice(),
      b: indexB.order.slice(),
      common: membersCommon,
      outside: membersOutside,
      outsideInA: membersOutsideInA,
      outsideInMid: membersOutsideInMid,
      outsideInB: membersOutsideInB,
    },
    totals: {
      a: rankedA.ranked.length,
      mid: rankedMid.ranked.length,
      b: rankedB.ranked.length,
      common: membersCommon.length,
      outside: membersOutside.length,
      outsideInA: membersOutsideInA.length,
      outsideInMid: membersOutsideInMid.length,
      outsideInB: membersOutsideInB.length,
    },
    ranks: {
      a: indexA.rankByIso3,
      mid: indexMid.rankByIso3,
      b: indexB.rankByIso3,
      commonA: commonIndexA.rankByIso3,
      commonMid: commonIndexMid.rankByIso3,
      commonB: commonIndexB.rankByIso3,
    },
    orders: {
      a: indexA.order,
      mid: indexMid.order,
      b: indexB.order,
      commonA: commonIndexA.order,
      commonMid: commonIndexMid.order,
      commonB: commonIndexB.order,
    },
    focus,
    economies,
  };
}

/**
 * LEVEL three-year comparison entry point: sets come from the stored level
 * observations of all three years and the level engine (value DESC, ISO3 ASC).
 *
 * @param {{ rowsA: object[], rowsMid: object[], rowsB: object[], focusIso3: string }} input
 */
export function buildThreeYearLevelComparison({ rowsA, rowsMid, rowsB, focusIso3 }) {
  return buildThreeYearCore({
    mode: COMPARISON_MODE.LEVEL,
    focusIso3: String(focusIso3 ?? '').toUpperCase(),
    rowsA,
    rowsMid,
    rowsB,
    rank: rankByValue,
    keyOf: (row) => row.value,
    extrasOf: (row) => ({ valueRaw: row.valueRaw ?? String(row.value) }),
  });
}

/**
 * SELF-VERIFICATION for three-year comparisons (fail-closed contract).
 *
 * Every check re-derives its expectation from the comparison object's own
 * membership and ordering data — it never trusts a previously computed count.
 *
 * @param {object} comparison output of buildThreeYearLevelComparison
 * @returns {{ passed: boolean, checks: {check:string,status:string,detail:object|string|null}[] }}
 */
export function verifyThreeYearComparison(comparison) {
  const checks = [];
  const record = (check, passed, detail = null, applicable = true) =>
    checks.push({
      check,
      status: passed ? 'pass' : 'fail',
      detail: applicable ? detail : { applicable: false, reason: detail },
    });

  const { members, totals, orders, ranks, focus } = comparison;
  const setA = sortedUnique(members.a);
  const setMid = sortedUnique(members.mid);
  const setB = sortedUnique(members.b);
  const midSet = new Set(setMid);
  const bSet = new Set(setB);
  const intersection = setA.filter((iso3) => midSet.has(iso3) && bSet.has(iso3));
  const union = [...new Set([...setA, ...setMid, ...setB])].sort();
  const outside = union.filter((iso3) => !intersection.includes(iso3));
  const outsideInA = setA.filter((iso3) => !intersection.includes(iso3));
  const outsideInMid = setMid.filter((iso3) => !intersection.includes(iso3));
  const outsideInB = setB.filter((iso3) => !intersection.includes(iso3));

  record('A.set_partition', totals.a === totals.common + totals.outsideInA, {
    setA: totals.a,
    common: totals.common,
    outsideInA: totals.outsideInA,
  });
  record('MID.set_partition', totals.mid === totals.common + totals.outsideInMid, {
    setMid: totals.mid,
    common: totals.common,
    outsideInMid: totals.outsideInMid,
  });
  record('B.set_partition', totals.b === totals.common + totals.outsideInB, {
    setB: totals.b,
    common: totals.common,
    outsideInB: totals.outsideInB,
  });
  record('common.is_exact_three_way_intersection', sameMembers(members.common, intersection), {
    reported: members.common.length,
    recomputed: intersection.length,
  });
  record('outside.is_union_minus_common', sameMembers(members.outside, outside), {
    reported: members.outside.length,
    recomputed: outside.length,
  });
  record('outsideInA.is_exact_difference', sameMembers(members.outsideInA, outsideInA), {
    reported: members.outsideInA.length,
    recomputed: outsideInA.length,
  });
  record('outsideInMid.is_exact_difference', sameMembers(members.outsideInMid, outsideInMid), {
    reported: members.outsideInMid.length,
    recomputed: outsideInMid.length,
  });
  record('outsideInB.is_exact_difference', sameMembers(members.outsideInB, outsideInB), {
    reported: members.outsideInB.length,
    recomputed: outsideInB.length,
  });
  const disjoint =
    !members.common.some((iso3) => members.outside.includes(iso3)) &&
    members.common.length + members.outside.length === union.length;
  record('members.disjoint', disjoint, {
    common: members.common.length,
    outside: members.outside.length,
    union: union.length,
  });

  const orderMatchesRanks = (order, rankMap, expectedMembers) =>
    sameMembers(order, expectedMembers) &&
    order.every((iso3, index) => rankMap.get(iso3) === index + 1) &&
    rankMap.size === order.length;
  record('A.ranking_matches_engine_order', orderMatchesRanks(orders.a, ranks.a, members.a), {
    size: orders.a.length,
  });
  record('MID.ranking_matches_engine_order', orderMatchesRanks(orders.mid, ranks.mid, members.mid), {
    size: orders.mid.length,
  });
  record('B.ranking_matches_engine_order', orderMatchesRanks(orders.b, ranks.b, members.b), {
    size: orders.b.length,
  });
  record(
    'common.ranking_A_matches_engine_order',
    orderMatchesRanks(orders.commonA, ranks.commonA, members.common),
    { size: orders.commonA.length },
  );
  record(
    'common.ranking_MID_matches_engine_order',
    orderMatchesRanks(orders.commonMid, ranks.commonMid, members.common),
    { size: orders.commonMid.length },
  );
  record(
    'common.ranking_B_matches_engine_order',
    orderMatchesRanks(orders.commonB, ranks.commonB, members.common),
    { size: orders.commonB.length },
  );
  // All three common rankings use exactly the same universe (object identity
  // aside, the member sets must be identical).
  record(
    'common.universe_consistent_across_years',
    sameMembers(orders.commonA, members.common) &&
      sameMembers(orders.commonMid, members.common) &&
      sameMembers(orders.commonB, members.common),
    { common: members.common.length },
  );

  const undefinedNote = 'decomposition undefined without the focus economy in all three years';
  record(
    'partial_identity_A',
    !focus.available || focus.commonRankA === focus.fullRankA - focus.outsideAboveA,
    focus.available
      ? { commonRankA: focus.commonRankA, fullRankA: focus.fullRankA, outsideAboveA: focus.outsideAboveA }
      : undefinedNote,
    focus.available,
  );
  record(
    'partial_identity_MID',
    !focus.available || focus.commonRankMid === focus.fullRankMid - focus.outsideAboveMid,
    focus.available
      ? {
          commonRankMid: focus.commonRankMid,
          fullRankMid: focus.fullRankMid,
          outsideAboveMid: focus.outsideAboveMid,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'partial_identity_B',
    !focus.available || focus.commonRankB === focus.fullRankB - focus.outsideAboveB,
    focus.available
      ? { commonRankB: focus.commonRankB, fullRankB: focus.fullRankB, outsideAboveB: focus.outsideAboveB }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.identity_AM',
    !focus.available ||
      focus.positionNumberChangeAM === focus.commonEffectAM + focus.observedSetEffectAM,
    focus.available
      ? {
          positionNumberChangeAM: focus.positionNumberChangeAM,
          commonEffectAM: focus.commonEffectAM,
          observedSetEffectAM: focus.observedSetEffectAM,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.identity_MB',
    !focus.available ||
      focus.positionNumberChangeMB === focus.commonEffectMB + focus.observedSetEffectMB,
    focus.available
      ? {
          positionNumberChangeMB: focus.positionNumberChangeMB,
          commonEffectMB: focus.commonEffectMB,
          observedSetEffectMB: focus.observedSetEffectMB,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.identity_AB',
    !focus.available ||
      focus.positionNumberChange === focus.commonEffect + focus.observedSetEffect,
    focus.available
      ? {
          positionNumberChange: focus.positionNumberChange,
          commonEffect: focus.commonEffect,
          observedSetEffect: focus.observedSetEffect,
        }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.observed_set_effect_matches_counts_AM',
    !focus.available || focus.observedSetEffectAM === focus.outsideAboveMid - focus.outsideAboveA,
    focus.available
      ? { outsideAboveMid: focus.outsideAboveMid, outsideAboveA: focus.outsideAboveA }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.observed_set_effect_matches_counts_MB',
    !focus.available || focus.observedSetEffectMB === focus.outsideAboveB - focus.outsideAboveMid,
    focus.available
      ? { outsideAboveB: focus.outsideAboveB, outsideAboveMid: focus.outsideAboveMid }
      : undefinedNote,
    focus.available,
  );
  record(
    'decomposition.observed_set_effect_matches_counts_AB',
    !focus.available || focus.observedSetEffect === focus.outsideAboveB - focus.outsideAboveA,
    focus.available
      ? { outsideAboveB: focus.outsideAboveB, outsideAboveA: focus.outsideAboveA }
      : undefinedNote,
    focus.available,
  );
  // Segment additivity: A→B must equal (A→MID) + (MID→B) for every effect.
  record(
    'decomposition.segments_add_up',
    !focus.available ||
      (focus.positionNumberChange === focus.positionNumberChangeAM + focus.positionNumberChangeMB &&
        focus.commonEffect === focus.commonEffectAM + focus.commonEffectMB &&
        focus.observedSetEffect === focus.observedSetEffectAM + focus.observedSetEffectMB),
    focus.available
      ? {
          full: [focus.positionNumberChangeAM, focus.positionNumberChangeMB, focus.positionNumberChange],
          common: [focus.commonEffectAM, focus.commonEffectMB, focus.commonEffect],
        }
      : undefinedNote,
    focus.available,
  );

  // Classification must follow ranking positions, never raw values, per year.
  const focusRankA = ranks.a.get(comparison.focusIso3) ?? null;
  const focusRankMid = ranks.mid.get(comparison.focusIso3) ?? null;
  const focusRankB = ranks.b.get(comparison.focusIso3) ?? null;
  let classificationOk = true;
  let classificationChecked = 0;
  for (const economy of comparison.economies ?? []) {
    if (economy.iso3 === comparison.focusIso3) continue;
    const checksPerYear = [
      { present: economy.presentInA, rank: economy.rankA, focusRank: focusRankA, relation: economy.relationToFocusA, affects: economy.affectsFocusPositionA },
      { present: economy.presentInMid, rank: economy.rankMid, focusRank: focusRankMid, relation: economy.relationToFocusMid, affects: economy.affectsFocusPositionMid },
      { present: economy.presentInB, rank: economy.rankB, focusRank: focusRankB, relation: economy.relationToFocusB, affects: economy.affectsFocusPositionB },
    ];
    for (const entry of checksPerYear) {
      if (!entry.present || entry.focusRank === null || entry.rank === null) continue;
      // Unknown relation only when focus missing that year; otherwise above/below.
      if (entry.relation === ECONOMY_RELATION.UNKNOWN) continue;
      classificationChecked += 1;
      const expectedAbove = entry.rank < entry.focusRank;
      if (entry.relation !== (expectedAbove ? ECONOMY_RELATION.ABOVE : ECONOMY_RELATION.BELOW)) {
        classificationOk = false;
      }
      if (entry.affects !== expectedAbove) classificationOk = false;
    }
  }
  record('classification.position_based', classificationOk, { checked: classificationChecked });

  const rankBoundsOk =
    (focus.fullRankA === null || (focus.fullRankA >= 1 && focus.fullRankA <= totals.a)) &&
    (focus.fullRankMid === null || (focus.fullRankMid >= 1 && focus.fullRankMid <= totals.mid)) &&
    (focus.fullRankB === null || (focus.fullRankB >= 1 && focus.fullRankB <= totals.b)) &&
    (focus.commonRankA === null || (focus.commonRankA >= 1 && focus.commonRankA <= totals.common)) &&
    (focus.commonRankMid === null || (focus.commonRankMid >= 1 && focus.commonRankMid <= totals.common)) &&
    (focus.commonRankB === null || (focus.commonRankB >= 1 && focus.commonRankB <= totals.common)) &&
    totals.a >= 0 &&
    totals.mid >= 0 &&
    totals.b >= 0 &&
    totals.common >= 0 &&
    totals.outside >= 0;
  record('ranks.within_bounds', rankBoundsOk, {
    fullRankA: focus.fullRankA,
    fullRankMid: focus.fullRankMid,
    denominatorA: totals.a,
    denominatorMid: totals.mid,
    fullRankB: focus.fullRankB,
    denominatorB: totals.b,
    commonRankA: focus.commonRankA,
    commonRankMid: focus.commonRankMid,
    commonRankB: focus.commonRankB,
    denominatorCommon: totals.common,
  });

  const integerFields = [
    focus.fullRankA,
    focus.fullRankMid,
    focus.fullRankB,
    focus.commonRankA,
    focus.commonRankMid,
    focus.commonRankB,
    focus.outsideAboveA,
    focus.outsideAboveMid,
    focus.outsideAboveB,
    focus.outsideBelowA,
    focus.outsideBelowMid,
    focus.outsideBelowB,
    focus.positionNumberChangeAM,
    focus.positionNumberChangeMB,
    focus.positionNumberChange,
    focus.commonEffectAM,
    focus.commonEffectMB,
    focus.commonEffect,
    focus.observedSetEffectAM,
    focus.observedSetEffectMB,
    focus.observedSetEffect,
    focus.placesGainedAM,
    focus.placesGainedMB,
    focus.placesGained,
    totals.a,
    totals.mid,
    totals.b,
    totals.common,
    totals.outside,
    totals.outsideInA,
    totals.outsideInMid,
    totals.outsideInB,
  ];
  record(
    'outputs.integers_only',
    integerFields.every((value) => value === null || Number.isInteger(value)),
    { fields: integerFields.length },
  );

  return { passed: checks.every((check) => check.status === 'pass'), checks };
}

/**
 * Shared small helpers, exported additively so the growth comparison module
 * can reuse the exact same set algebra, rank indexing and positional
 * relation logic instead of re-implementing them. Level behavior is
 * untouched: these were already the single implementations in this module.
 */
export { toRankIndex, relationTo, sortedUnique, sameMembers };

export default {
  COMPARISON_MODE,
  ECONOMY_STATUS,
  THREE_YEAR_STATUS,
  ECONOMY_RELATION,
  POSITION_EFFECT,
  COMPARISON_REASONS,
  COMPARISON_FIELD_MEANINGS,
  COMPARISON_POPULATION_LABEL,
  buildLevelComparison,
  buildYoyComparison,
  buildThreeYearLevelComparison,
  verifyComparison,
  verifyThreeYearComparison,
  compareByValueDesc,
  toRankIndex,
  relationTo,
  sortedUnique,
  sameMembers,
};


