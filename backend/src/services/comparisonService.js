/**
 * RANK-MOVEMENT COMPARISON SERVICE (level mode, V1).
 *
 * Orchestration only: validation, one atomic read, trusted domain engines,
 * service-level integrity checks, evidence assembly. No ranking math lives
 * here — that belongs to domain/ranking.js and domain/comparison.js.
 *
 * Fail-closed: any invariant failure throws a coded error; the route maps it
 * to a 500 with code COMPARISON_INVARIANT_FAILED and never returns partial
 * analytical numbers as successful.
 */

import { FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  countEligibleCountries,
  getCountriesByIso3List,
  getEligibleObservationsForYears,
  getIndicatorByMetricKey,
  getLatestFetchRun,
  listYearsWithData,
} from '../db/repository.js';
import {
  COMPARISON_POPULATION_LABEL,
  buildLevelComparison,
  buildThreeYearLevelComparison,
  verifyComparison,
  verifyThreeYearComparison,
} from '../domain/comparison.js';
import { describeMetric, formatValue } from '../domain/format.js';
import { rankByValue } from '../domain/ranking.js';
import { sourceAttribution } from './attribution.js';
import { buildMetadataChange, explainTotalChange } from './coverageService.js';
import { buildComparisonVintage } from './vintage.js';

export const COMPARISON_ERROR_CODES = Object.freeze({
  INVARIANT_FAILED: 'COMPARISON_INVARIANT_FAILED',
  SAME_YEAR: 'SAME_YEAR_SELECTED',
  INVALID_YEAR: 'INVALID_YEAR',
  INVALID_INDICATOR: 'INVALID_INDICATOR',
  INVALID_BREAKER: 'INVALID_POINT_BREAKER',
  INVALID_MODE: 'INVALID_COMPARISON_MODE',
});

export function comparisonError(code, message, httpStatus = 500) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

/** Order years chronologically but remember the requested direction. */
function orderYears(yearA, yearB) {
  if (yearA === yearB) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.SAME_YEAR,
      'yearA and yearB must differ for a rank-movement comparison.',
      400,
    );
  }
  return { a: yearA, b: yearB, order: yearA < yearB ? 'a_is_earlier' : 'a_is_later' };
}

function buildIdentityText(focus) {
  if (!focus.available) return null;
  const dF = focus.positionNumberChange;
  const dK = focus.commonEffect;
  const pool = focus.observedSetEffect;
  const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    `${fmt(dF)} = ${fmt(dK)} + ${fmt(focus.enteredAboveB)} - ${fmt(focus.exitedAboveA)} ` +
    `(full position change = common-universe movement + entered-above minus exited-above; ` +
    `observed-set effect ${fmt(pool)})`
  );
}

function buildThreeYearIdentityText(f) {
  if (!f.available) return null;
  const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    `A→MID ${fmt(f.positionNumberChangeAM)} = ${fmt(f.commonEffectAM)} + ${fmt(f.outsideAboveMid)} - ${fmt(f.outsideAboveA)}; ` +
    `MID→B ${fmt(f.positionNumberChangeMB)} = ${fmt(f.commonEffectMB)} + ${fmt(f.outsideAboveB)} - ${fmt(f.outsideAboveMid)}; ` +
    `A→B ${fmt(f.positionNumberChange)} = ${fmt(f.commonEffect)} + ${fmt(f.outsideAboveB)} - ${fmt(f.outsideAboveA)} ` +
    `(full position change = common-universe movement + outside-above difference; same three-year universe throughout)`
  );
}

/**
 * Normalize the optional point-breaker input. Accepts yearMid (canonical),
 * breaker and pointBreaker aliases. The strings "none"/"" mean no breaker.
 * Returns null for no-breaker mode, otherwise the raw value for validation.
 */
function normalizeBreakerInput(options = {}) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  return raw;
}

function buildLimits({ mixedVintage, commonSize, focusAvailable, threeYear = false }) {
  const limits = threeYear
    ? [
        'Outside-common-set membership describes valid-observation set membership only (present in at least one selected year but missing in at least one other). It never implies that an economy was created, dissolved, recognised or removed by the World Bank.',
        'Reason not established from stored evidence: the application records per-year counts of rows without a usable value, but does not store per-economy causes for a missing observation.',
        'Region, income level and lending type are World Bank classifications in the retrieved metadata vintage, not historical classifications as of the compared years.',
        'Common-universe positions are derived comparison positions among the economies observed in ALL THREE selected years, not official World Bank ranks and not observed-year ranks.',
      ]
    : [
        'Entry and exit describe valid-observation set membership only. They never imply that an economy was created, dissolved, recognised or removed by the World Bank.',
        'Reason not established from stored evidence: the application records per-year counts of rows without a usable value, but does not store per-economy causes for a missing observation.',
        'Region, income level and lending type are World Bank classifications in the retrieved metadata vintage, not historical classifications as of the compared years.',
        'Common-universe positions are derived comparison positions, not official World Bank ranks and not observed-year ranks.',
      ];
  if (mixedVintage) {
    limits.push(
      'Mixed World Bank vintage detected across the rows used; interpret the comparison with caution.',
    );
  }
  if (Number.isInteger(commonSize) && commonSize < 10) {
    limits.push(
      `The common comparison universe is very small (${commonSize} economies); movement should be read as counts, never as percentages.`,
    );
  }
  if (!focusAvailable) {
    limits.push(
      'The focus economy lacks a valid observation in at least one selected year, so no decomposition is produced.',
    );
  }
  return limits;
}

/**
 * Build a level rank-movement comparison for one metric and two years,
 * with an optional point-breaker middle year.
 *
 * When no point breaker is supplied (None) the function behaves exactly as
 * the original two-year implementation. When yearMid/breaker/pointBreaker is
 * supplied it must lie strictly between yearA and yearB and the comparison
 * uses the three-year common universe VALID(A) ∩ VALID(MID) ∩ VALID(B).
 *
 * @param {object} db
 * @param {{metricKey:string, yearA:number, yearB:number, yearMid?:number, breaker?:number, pointBreaker?:number, focusIso3?:string, detail?:string}} options
 */
export function buildLevelComparisonResponse(db, options = {}) {
  const { metricKey } = options;
  if (!metricKey || !METRICS[metricKey]) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.INVALID_INDICATOR,
      `Unknown indicator "${metricKey}". Valid keys: ${Object.keys(METRICS).join(', ')}.`,
      400,
    );
  }
  const metric = METRICS[metricKey];
  const yearA = Number(options.yearA);
  const yearB = Number(options.yearB);
  if (!Number.isInteger(yearA) || !Number.isInteger(yearB)) {
    throw comparisonError(COMPARISON_ERROR_CODES.INVALID_YEAR, 'yearA and yearB must be integer years.', 400);
  }
  const { order } = orderYears(yearA, yearB);
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(focusIso3)) {
    throw comparisonError(COMPARISON_ERROR_CODES.INVALID_YEAR, `Invalid focus country "${options.focusIso3}".`, 400);
  }
  const detail = options.detail === 'summary' ? 'summary' : 'full';

  // Optional point breaker: None (null) preserves the exact two-year path.
  const breakerRaw = normalizeBreakerInput(options);
  if (breakerRaw !== null && breakerRaw !== undefined) {
    const yearMid = Number(breakerRaw);
    if (!Number.isInteger(yearMid)) {
      throw comparisonError(
        COMPARISON_ERROR_CODES.INVALID_BREAKER,
        'Point breaker must be an integer year strictly between yearA and yearB, or None.',
        400,
      );
    }
    const lo = Math.min(yearA, yearB);
    const hi = Math.max(yearA, yearB);
    if (yearMid <= lo || yearMid >= hi) {
      throw comparisonError(
        COMPARISON_ERROR_CODES.INVALID_BREAKER,
        `Point breaker must lie strictly between the two endpoint years (${lo} < breaker < ${hi}).`,
        400,
      );
    }
    return buildThreeYearComparisonResponse(db, {
      metricKey,
      yearA,
      yearMid,
      yearB,
      order,
      focusIso3,
      detail,
    });
  }

  const indicator = getIndicatorByMetricKey(db, metricKey);
  const eligibleUniverse = countEligibleCountries(db);
  if (!indicator) {
    return {
      comparison: { available: false, reason: 'metric_not_ingested', mode: 'level' },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, b: yearB, order },
      universe: {
        setA: 0,
        setB: 0,
        common: 0,
        exited: 0,
        entered: 0,
        membershipRule: COMPARISON_POPULATION_LABEL,
      },
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  const yearsWithData = new Set(listYearsWithData(db, indicator.id));
  if (!yearsWithData.has(yearA) || !yearsWithData.has(yearB)) {
    return {
      comparison: {
        available: false,
        reason: 'no_stored_observations_for_metric_and_year',
        mode: 'level',
      },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, b: yearB, order },
      universe: {
        setA: 0,
        setB: 0,
        common: 0,
        exited: 0,
        entered: 0,
        membershipRule: COMPARISON_POPULATION_LABEL,
      },
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  // One atomic read for both years: a concurrent refresh cannot move one side.
  const allRows = getEligibleObservationsForYears(db, indicator.id, [yearA, yearB]);
  const rowsA = allRows.filter((r) => r.year === yearA);
  const rowsB = allRows.filter((r) => r.year === yearB);

  const domainInputA = rowsA.map((r) => ({ iso3: r.iso3, name: r.name, value: r.value, valueRaw: r.valueRaw }));
  const domainInputB = rowsB.map((r) => ({ iso3: r.iso3, name: r.name, value: r.value, valueRaw: r.valueRaw }));
  const comparison = buildLevelComparison({ rowsA: domainInputA, rowsB: domainInputB, focusIso3 });
  const verification = verifyComparison(comparison);

  // Service-level checks (storage-dependent; kept out of the pure domain).
  const serviceChecks = [];
  const serviceRecord = (check, passed, detail = null) =>
    serviceChecks.push({ check, status: passed ? 'pass' : 'fail', detail });

  // 1. Full ranks match an independent recomputation with the trusted engine.
  const engineA = rankByValue(domainInputA);
  const engineB = rankByValue(domainInputB);
  const engineFocusA = engineA.ranked.find((r) => r.iso3 === focusIso3) ?? null;
  const engineFocusB = engineB.ranked.find((r) => r.iso3 === focusIso3) ?? null;
  serviceRecord(
    'service.fullRankMatchesEngine',
    (engineFocusA?.rank ?? null) === comparison.focus.fullRankA &&
      (engineFocusB?.rank ?? null) === comparison.focus.fullRankB &&
      engineA.total === comparison.totals.a &&
      engineB.total === comparison.totals.b,
    {
      engineRankA: engineFocusA?.rank ?? null,
      focusRankA: comparison.focus.fullRankA,
      engineRankB: engineFocusB?.rank ?? null,
      focusRankB: comparison.focus.fullRankB,
    },
  );

  // 2. Every member resolves to stored non-aggregate metadata.
  const unionIso3 = [...new Set([...comparison.members.a, ...comparison.members.b])].sort();
  const metaRows = getCountriesByIso3List(db, unionIso3);
  const metaById = new Map(metaRows.map((m) => [m.id, m]));
  let membershipOk = metaRows.length === unionIso3.length;
  if (membershipOk) {
    for (const iso3 of unionIso3) {
      const meta = metaById.get(iso3);
      if (!meta || meta.is_aggregate === 1) {
        membershipOk = false;
        break;
      }
    }
  }
  serviceRecord('service.membershipInStorage', membershipOk, {
    union: unionIso3.length,
    resolved: metaRows.length,
  });

  const allChecks = [...verification.checks, ...serviceChecks];
  const passed = allChecks.every((c) => c.status === 'pass');
  if (!passed) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.INVARIANT_FAILED,
      'Rank-movement comparison failed self-verification; no analytical numbers are published.',
      500,
    );
  }

  const vintage = buildComparisonVintage(db, { metricKey, indicatorId: indicator.id, yearA, yearB });
  const statA = vintage.perYear.a;
  const statB = vintage.perYear.b;
  const metadataUniverseComparison = buildMetadataChange(
    db,
    statA?.fetchRunId ?? null,
    statB?.fetchRunId ?? null,
  );
  const denominatorExplanation = explainTotalChange(db, {
    metricKey,
    fromYear: yearA,
    toYear: yearB,
    focusIso3,
  });

  // Completeness from the latest successful run (declared totals are not
  // stored per year; never fabricate them).
  const latestRun = getLatestFetchRun(db, { status: 'success' });
  const completeness = {
    a: statA ? { fetchRunId: statA.fetchRunId, status: latestRun?.status ?? null } : null,
    b: statB ? { fetchRunId: statB.fetchRunId, status: latestRun?.status ?? null } : null,
    latestRun: latestRun
      ? {
          runId: latestRun.id,
          pagesFetched: latestRun.pages_fetched ?? null,
          requests: latestRun.requests ?? null,
          status: latestRun.status,
        }
      : null,
  };

  // Decorate economies with current-vintage metadata + display values.
  const statusRankCounter = new Map();
  const decorated = comparison.economies.map((e) => {
    const meta = metaById.get(e.iso3);
    const rowA = rowsA.find((r) => r.iso3 === e.iso3) ?? null;
    const rowB = rowsB.find((r) => r.iso3 === e.iso3) ?? null;
    const key = `${e.status}`;
    const positionInStatusList = (statusRankCounter.get(key) ?? 0) + 1;
    statusRankCounter.set(key, positionInStatusList);
    return {
      iso3: e.iso3,
      name: e.name,
      region: meta?.region ?? null,
      regionId: meta?.region_id ?? null,
      incomeLevel: meta?.income_level ?? null,
      lendingType: meta?.lending_type ?? null,
      metadataVintageNote: 'World Bank classification in the retrieved metadata vintage.',
      status: e.status,
      relationToFocus: e.relationToFocus,
      relationToFocusA: e.relationToFocusA,
      relationToFocusB: e.relationToFocusB,
      valueA: e.keyA,
      valueB: e.keyB,
      rawTextA: rowA?.valueRaw ?? (e.keyA === null || e.keyA === undefined ? null : String(e.keyA)),
      rawTextB: rowB?.valueRaw ?? (e.keyB === null || e.keyB === undefined ? null : String(e.keyB)),
      displayA: e.keyA === null || e.keyA === undefined ? null : formatValue(e.keyA, metric).formatted,
      displayB: e.keyB === null || e.keyB === undefined ? null : formatValue(e.keyB, metric).formatted,
      rankA: e.rankA,
      rankB: e.rankB,
      positionInStatusList,
      tiedWithFocusA: e.tiedWithFocusA,
      tiedWithFocusB: e.tiedWithFocusB,
      affectsFocusPosition: e.affectsFocusPosition,
      positionEffect: e.positionEffect,
    };
  });

  const counts = {
    total: decorated.length,
    aboveFocus: decorated.filter((r) => r.relationToFocus === 'above').length,
    belowFocus: decorated.filter((r) => r.relationToFocus === 'below').length,
    tiedWithFocus: decorated.filter((r) => r.tiedWithFocusA || r.tiedWithFocusB).length,
    common: comparison.totals.common,
    exited: comparison.totals.exited,
    entered: comparison.totals.entered,
  };

  let rows = decorated;
  if (detail === 'summary') {
    rows = decorated.filter((r) => r.status !== 'common' || r.iso3 === focusIso3);
  }

  const f = comparison.focus;
  const focusMovement = f.available
    ? {
        fullRankA: f.fullRankA,
        fullRankB: f.fullRankB,
        commonRankA: f.commonRankA,
        commonRankB: f.commonRankB,
        denominatorA: f.denominatorA,
        denominatorB: f.denominatorB,
        denominatorCommon: f.denominatorCommon,
        exitedAboveA: f.exitedAboveA,
        exitedBelowA: f.exitedBelowA,
        enteredAboveB: f.enteredAboveB,
        enteredBelowB: f.enteredBelowB,
        totalMovement: f.positionNumberChange,
        positionNumberChange: f.positionNumberChange,
        commonEffect: f.commonEffect,
        poolEffect: f.observedSetEffect,
        observedSetEffect: f.observedSetEffect,
        placesGained: f.placesGained,
        denominatorChange: comparison.totals.b - comparison.totals.a,
        signConvention: {
          positionNumbers: 'lower_is_better',
          totalMovement: 'positive_means_position_number_increased',
          placesGained: 'positive_means_moved_up',
        },
        identityText: buildIdentityText(f),
      }
    : {
        fullRankA: f.fullRankA,
        fullRankB: f.fullRankB,
        commonRankA: null,
        commonRankB: null,
        denominatorA: f.denominatorA,
        denominatorB: f.denominatorB,
        denominatorCommon: f.denominatorCommon,
        exitedAboveA: null,
        exitedBelowA: null,
        enteredAboveB: null,
        enteredBelowB: null,
        totalMovement: null,
        positionNumberChange: null,
        commonEffect: null,
        poolEffect: null,
        observedSetEffect: null,
        placesGained: null,
        denominatorChange: comparison.totals.b - comparison.totals.a,
        signConvention: {
          positionNumbers: 'lower_is_better',
          totalMovement: 'positive_means_position_number_increased',
          placesGained: 'positive_means_moved_up',
        },
        identityText: null,
      };

  return {
    comparison: {
      available: f.available,
      reason: f.available ? null : comparison.focus.reason,
      mode: 'level',
    },
    metric: describeMetric(metric),
    focus: { iso3: focusIso3, name: f.name ?? FOCUS_COUNTRY.name },
    years: { a: yearA, b: yearB, order },
    universe: {
      setA: comparison.totals.a,
      setB: comparison.totals.b,
      common: comparison.totals.common,
      exited: comparison.totals.exited,
      entered: comparison.totals.entered,
      membershipRule: COMPARISON_POPULATION_LABEL,
    },
    focusMovement,
    economies: {
      counts,
      rows,
      truncated: false,
      totalRows: decorated.length,
    },
    denominatorExplanation,
    evidence: {
      vintage: vintage.vintage,
      retrieval: vintage.retrieval,
      freshness: vintage.freshness,
      perYear: vintage.perYear,
      metadataUniverseComparison,
      completeness,
      fingerprint: vintage.fingerprint,
      limits: buildLimits({
        mixedVintage: vintage.vintage.mixedVintage,
        commonSize: comparison.totals.common,
        focusAvailable: f.available,
      }),
    },
    verification: { passed: true, checks: allChecks },
    source: sourceAttribution(),
    comparisonMethodology: {
      ranking: 'value DESC, ISO3 ASC; rank = 1-based ordinal position. Ties receive distinct positions ordered by ISO3.',
      sets: 'Common = economies observed in both years; Exited = observed in year A only; Entered = observed in year B only.',
      aboveBelow: 'Above/below the focus economy is determined by ranking position, never by raw-value comparison.',
      identity: 'F_B - F_A = (K_B - K_A) + EnteredAbove_B - ExitedAbove_A.',
      sign: 'positionNumberChange = F_B - F_A (positive means the position number increased); placesGained = F_A - F_B (positive means moved up).',
      membership: 'Entered/exited describe valid-observation set membership only.',
    },
  };
}

/**
 * Build a level rank-movement comparison for one metric and THREE years:
 * yearA, yearMid (point breaker) and yearB.
 *
 * Central rule: COMMON_3 = VALID(A) ∩ VALID(MID) ∩ VALID(B). Every ranking
 * for A, MID and B is calculated among exactly those same economies with the
 * existing ranking engine. Segment movements (A→MID, MID→B, A→B) all use that
 * one shared universe — never pairwise intersections.
 *
 * @param {object} db
 * @param {{metricKey:string, yearA:number, yearMid:number, yearB:number, order?:string, focusIso3?:string, detail?:string}} options
 */
export function buildThreeYearComparisonResponse(db, options = {}) {
  const { metricKey, yearA, yearMid, yearB } = options;
  const metric = METRICS[metricKey];
  if (!metric) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.INVALID_INDICATOR,
      `Unknown indicator "${metricKey}".`,
      400,
    );
  }
  const order = options.order ?? (yearA < yearB ? 'a_is_earlier' : 'a_is_later');
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const detail = options.detail === 'summary' ? 'summary' : 'full';

  const indicator = getIndicatorByMetricKey(db, metricKey);
  const emptyUniverse = {
    setA: 0,
    setMid: 0,
    setB: 0,
    common: 0,
    outside: 0,
    outsideInA: 0,
    outsideInMid: 0,
    outsideInB: 0,
    membershipRule: COMPARISON_POPULATION_LABEL,
  };
  if (!indicator) {
    return {
      comparison: { available: false, reason: 'metric_not_ingested', mode: 'level', pointBreaker: { active: true, yearMid } },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, mid: yearMid, b: yearB, order },
      universe: emptyUniverse,
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  const yearsWithData = new Set(listYearsWithData(db, indicator.id));
  if (!yearsWithData.has(yearA) || !yearsWithData.has(yearMid) || !yearsWithData.has(yearB)) {
    return {
      comparison: {
        available: false,
        reason: 'no_stored_observations_for_metric_and_year',
        mode: 'level',
        pointBreaker: { active: true, yearMid },
      },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, mid: yearMid, b: yearB, order },
      universe: emptyUniverse,
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  // One atomic read for all three years.
  const allRows = getEligibleObservationsForYears(db, indicator.id, [yearA, yearMid, yearB]);
  const rowsA = allRows.filter((r) => r.year === yearA);
  const rowsMid = allRows.filter((r) => r.year === yearMid);
  const rowsB = allRows.filter((r) => r.year === yearB);

  const toDomain = (rows) =>
    rows.map((r) => ({ iso3: r.iso3, name: r.name, value: r.value, valueRaw: r.valueRaw }));
  const comparison = buildThreeYearLevelComparison({
    rowsA: toDomain(rowsA),
    rowsMid: toDomain(rowsMid),
    rowsB: toDomain(rowsB),
    focusIso3,
  });
  const verification = verifyThreeYearComparison(comparison);

  const serviceChecks = [];
  const serviceRecord = (check, passed, detailInfo = null) =>
    serviceChecks.push({ check, status: passed ? 'pass' : 'fail', detail: detailInfo });

  const engineA = rankByValue(toDomain(rowsA));
  const engineMid = rankByValue(toDomain(rowsMid));
  const engineB = rankByValue(toDomain(rowsB));
  const engineFocusA = engineA.ranked.find((r) => r.iso3 === focusIso3) ?? null;
  const engineFocusMid = engineMid.ranked.find((r) => r.iso3 === focusIso3) ?? null;
  const engineFocusB = engineB.ranked.find((r) => r.iso3 === focusIso3) ?? null;
  serviceRecord(
    'service.fullRankMatchesEngine',
    (engineFocusA?.rank ?? null) === comparison.focus.fullRankA &&
      (engineFocusMid?.rank ?? null) === comparison.focus.fullRankMid &&
      (engineFocusB?.rank ?? null) === comparison.focus.fullRankB &&
      engineA.total === comparison.totals.a &&
      engineMid.total === comparison.totals.mid &&
      engineB.total === comparison.totals.b,
    {
      engineRankA: engineFocusA?.rank ?? null,
      focusRankA: comparison.focus.fullRankA,
      engineRankMid: engineFocusMid?.rank ?? null,
      focusRankMid: comparison.focus.fullRankMid,
      engineRankB: engineFocusB?.rank ?? null,
      focusRankB: comparison.focus.fullRankB,
    },
  );

  const unionIso3 = [...new Set([...comparison.members.a, ...comparison.members.mid, ...comparison.members.b])].sort();
  const metaRows = getCountriesByIso3List(db, unionIso3);
  const metaById = new Map(metaRows.map((m) => [m.id, m]));
  let membershipOk = metaRows.length === unionIso3.length;
  if (membershipOk) {
    for (const iso3 of unionIso3) {
      const meta = metaById.get(iso3);
      if (!meta || meta.is_aggregate === 1) {
        membershipOk = false;
        break;
      }
    }
  }
  serviceRecord('service.membershipInStorage', membershipOk, {
    union: unionIso3.length,
    resolved: metaRows.length,
  });

  const allChecks = [...verification.checks, ...serviceChecks];
  const passed = allChecks.every((c) => c.status === 'pass');
  if (!passed) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.INVARIANT_FAILED,
      'Rank-movement comparison (point breaker) failed self-verification; no analytical numbers are published.',
      500,
    );
  }

  const vintage = buildComparisonVintage(db, { metricKey, indicatorId: indicator.id, yearA, yearB, yearMid });
  const statA = vintage.perYear.a;
  const statMid = vintage.perYear.mid;
  const statB = vintage.perYear.b;
  const metadataUniverseComparison = {
    aToMid: buildMetadataChange(db, statA?.fetchRunId ?? null, statMid?.fetchRunId ?? null),
    midToB: buildMetadataChange(db, statMid?.fetchRunId ?? null, statB?.fetchRunId ?? null),
    aToB: buildMetadataChange(db, statA?.fetchRunId ?? null, statB?.fetchRunId ?? null),
  };
  const denominatorExplanationOverall = explainTotalChange(db, {
    metricKey,
    fromYear: yearA,
    toYear: yearB,
    focusIso3,
  });
  // Observed-coverage explanations per segment (about full observed sets, not
  // the common universe). The common universe itself is defined above.
  let denominatorExplanations = null;
  try {
    denominatorExplanations = {
      overall: denominatorExplanationOverall,
      aToMid: explainTotalChange(db, { metricKey, fromYear: yearA, toYear: yearMid, focusIso3 }),
      midToB: explainTotalChange(db, { metricKey, fromYear: yearMid, toYear: yearB, focusIso3 }),
    };
  } catch {
    denominatorExplanations = { overall: denominatorExplanationOverall, aToMid: null, midToB: null };
  }

  const latestRun = getLatestFetchRun(db, { status: 'success' });
  const completeness = {
    a: statA ? { fetchRunId: statA.fetchRunId, status: latestRun?.status ?? null } : null,
    mid: statMid ? { fetchRunId: statMid.fetchRunId, status: latestRun?.status ?? null } : null,
    b: statB ? { fetchRunId: statB.fetchRunId, status: latestRun?.status ?? null } : null,
    latestRun: latestRun
      ? {
          runId: latestRun.id,
          pagesFetched: latestRun.pages_fetched ?? null,
          requests: latestRun.requests ?? null,
          status: latestRun.status,
        }
      : null,
  };

  const decorated = comparison.economies.map((e) => {
    const meta = metaById.get(e.iso3);
    const rowA = rowsA.find((r) => r.iso3 === e.iso3) ?? null;
    const rowMid = rowsMid.find((r) => r.iso3 === e.iso3) ?? null;
    const rowB = rowsB.find((r) => r.iso3 === e.iso3) ?? null;
    return {
      iso3: e.iso3,
      name: e.name,
      region: meta?.region ?? null,
      regionId: meta?.region_id ?? null,
      incomeLevel: meta?.income_level ?? null,
      lendingType: meta?.lending_type ?? null,
      metadataVintageNote: 'World Bank classification in the retrieved metadata vintage.',
      status: e.status,
      presentInA: e.presentInA,
      presentInMid: e.presentInMid,
      presentInB: e.presentInB,
      relationToFocus: e.relationToFocus,
      relationToFocusA: e.relationToFocusA,
      relationToFocusMid: e.relationToFocusMid,
      relationToFocusB: e.relationToFocusB,
      valueA: e.keyA,
      valueMid: e.keyMid,
      valueB: e.keyB,
      rawTextA: rowA?.valueRaw ?? (e.keyA === null || e.keyA === undefined ? null : String(e.keyA)),
      rawTextMid: rowMid?.valueRaw ?? (e.keyMid === null || e.keyMid === undefined ? null : String(e.keyMid)),
      rawTextB: rowB?.valueRaw ?? (e.keyB === null || e.keyB === undefined ? null : String(e.keyB)),
      displayA: e.keyA === null || e.keyA === undefined ? null : formatValue(e.keyA, metric).formatted,
      displayMid: e.keyMid === null || e.keyMid === undefined ? null : formatValue(e.keyMid, metric).formatted,
      displayB: e.keyB === null || e.keyB === undefined ? null : formatValue(e.keyB, metric).formatted,
      rankA: e.rankA,
      rankMid: e.rankMid,
      rankB: e.rankB,
      tiedWithFocusA: e.tiedWithFocusA,
      tiedWithFocusMid: e.tiedWithFocusMid,
      tiedWithFocusB: e.tiedWithFocusB,
      affectsFocusPosition: e.affectsFocusPosition,
      affectsFocusPositionA: e.affectsFocusPositionA,
      affectsFocusPositionMid: e.affectsFocusPositionMid,
      affectsFocusPositionB: e.affectsFocusPositionB,
      positionEffect: e.positionEffect,
    };
  });

  const counts = {
    total: decorated.length,
    common: comparison.totals.common,
    outside: comparison.totals.outside,
    outsideInA: comparison.totals.outsideInA,
    outsideInMid: comparison.totals.outsideInMid,
    outsideInB: comparison.totals.outsideInB,
    tiedWithFocus:
      decorated.filter((r) => r.tiedWithFocusA || r.tiedWithFocusMid || r.tiedWithFocusB).length,
  };

  let rows = decorated;
  if (detail === 'summary') {
    rows = decorated.filter((r) => r.status !== 'common' || r.iso3 === focusIso3);
  }

  const f = comparison.focus;
  const signConvention = {
    positionNumbers: 'lower_is_better',
    totalMovement: 'positive_means_position_number_increased',
    placesGained: 'positive_means_moved_up',
  };
  const focusMovement = f.available
    ? {
        fullRankA: f.fullRankA,
        fullRankMid: f.fullRankMid,
        fullRankB: f.fullRankB,
        commonRankA: f.commonRankA,
        commonRankMid: f.commonRankMid,
        commonRankB: f.commonRankB,
        denominatorA: f.denominatorA,
        denominatorMid: f.denominatorMid,
        denominatorB: f.denominatorB,
        denominatorCommon: f.denominatorCommon,
        outsideAboveA: f.outsideAboveA,
        outsideAboveMid: f.outsideAboveMid,
        outsideAboveB: f.outsideAboveB,
        outsideBelowA: f.outsideBelowA,
        outsideBelowMid: f.outsideBelowMid,
        outsideBelowB: f.outsideBelowB,
        // Overall A→B (same convention as the two-year mode).
        totalMovement: f.positionNumberChange,
        positionNumberChange: f.positionNumberChange,
        commonEffect: f.commonEffect,
        poolEffect: f.observedSetEffect,
        observedSetEffect: f.observedSetEffect,
        placesGained: f.placesGained,
        // First segment A→MID.
        positionNumberChangeAM: f.positionNumberChangeAM,
        commonEffectAM: f.commonEffectAM,
        observedSetEffectAM: f.observedSetEffectAM,
        placesGainedAM: f.placesGainedAM,
        // Second segment MID→B.
        positionNumberChangeMB: f.positionNumberChangeMB,
        commonEffectMB: f.commonEffectMB,
        observedSetEffectMB: f.observedSetEffectMB,
        placesGainedMB: f.placesGainedMB,
        denominatorChange: comparison.totals.b - comparison.totals.a,
        signConvention,
        identityText: buildThreeYearIdentityText(f),
      }
    : {
        fullRankA: f.fullRankA,
        fullRankMid: f.fullRankMid,
        fullRankB: f.fullRankB,
        commonRankA: null,
        commonRankMid: null,
        commonRankB: null,
        denominatorA: f.denominatorA,
        denominatorMid: f.denominatorMid,
        denominatorB: f.denominatorB,
        denominatorCommon: f.denominatorCommon,
        outsideAboveA: null,
        outsideAboveMid: null,
        outsideAboveB: null,
        outsideBelowA: null,
        outsideBelowMid: null,
        outsideBelowB: null,
        totalMovement: null,
        positionNumberChange: null,
        commonEffect: null,
        poolEffect: null,
        observedSetEffect: null,
        placesGained: null,
        positionNumberChangeAM: null,
        commonEffectAM: null,
        observedSetEffectAM: null,
        placesGainedAM: null,
        positionNumberChangeMB: null,
        commonEffectMB: null,
        observedSetEffectMB: null,
        placesGainedMB: null,
        denominatorChange: comparison.totals.b - comparison.totals.a,
        signConvention,
        identityText: null,
      };

  return {
    comparison: {
      available: f.available,
      reason: f.available ? null : comparison.focus.reason,
      mode: 'level',
      pointBreaker: { active: true, yearMid },
    },
    metric: describeMetric(metric),
    focus: { iso3: focusIso3, name: f.name ?? FOCUS_COUNTRY.name },
    years: { a: yearA, mid: yearMid, b: yearB, order },
    universe: {
      setA: comparison.totals.a,
      setMid: comparison.totals.mid,
      setB: comparison.totals.b,
      common: comparison.totals.common,
      outside: comparison.totals.outside,
      outsideInA: comparison.totals.outsideInA,
      outsideInMid: comparison.totals.outsideInMid,
      outsideInB: comparison.totals.outsideInB,
      membershipRule: COMPARISON_POPULATION_LABEL,
    },
    focusMovement,
    economies: {
      counts,
      rows,
      truncated: false,
      totalRows: decorated.length,
    },
    denominatorExplanation: denominatorExplanationOverall,
    denominatorExplanations,
    evidence: {
      vintage: vintage.vintage,
      retrieval: vintage.retrieval,
      freshness: vintage.freshness,
      perYear: vintage.perYear,
      metadataUniverseComparison,
      completeness,
      fingerprint: vintage.fingerprint,
      limits: buildLimits({
        mixedVintage: vintage.vintage.mixedVintage,
        commonSize: comparison.totals.common,
        focusAvailable: f.available,
        threeYear: true,
      }),
    },
    verification: { passed: true, checks: allChecks },
    source: sourceAttribution(),
    comparisonMethodology: {
      ranking: 'value DESC, ISO3 ASC; rank = 1-based ordinal position. Ties receive distinct positions ordered by ISO3.',
      sets: 'Common = economies observed in all three selected years (start, point breaker, end); Outside = observed in at least one year but missing in at least one other year.',
      aboveBelow: 'Above/below the focus economy is determined by ranking position, never by raw-value comparison.',
      identity:
        'For every segment P→Q sharing the same three-year common universe: F_Q - F_P = (K_Q - K_P) + OutsideAbove_Q - OutsideAbove_P.',
      sign: 'positionNumberChange = later minus earlier (positive means the position number increased); placesGained = earlier minus later (positive means moved up).',
      membership: 'Outside-common-set membership describes valid-observation set membership only.',
    },
  };
}

export default { buildLevelComparisonResponse, buildThreeYearComparisonResponse, COMPARISON_ERROR_CODES, comparisonError };
