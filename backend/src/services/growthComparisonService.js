/**
 * GROWTH RANK-MOVEMENT COMPARISON SERVICE (YoY % growth mode, V1).
 *
 * Orchestration only: validation, one atomic read, trusted domain engines,
 * service-level integrity checks, evidence assembly. No growth math lives
 * here — that belongs to domain/yoyRanking.js (pairing + ranking) and
 * domain/growthComparison.js (intervals, shared universe, peer averages).
 *
 * Mirrors services/comparisonService.js structurally so reviewers can audit
 * the two side by side, but shares no response-building code with it: level
 * responses must remain byte-identical, so growth has its own decorator.
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
import { comparisonError, COMPARISON_ERROR_CODES } from './comparisonService.js';
import { COMPARISON_POPULATION_LABEL } from '../domain/comparison.js';
import {
  GROWTH_POPULATION_LABEL,
  GROWTH_REASON_DESCRIPTIONS,
  buildGrowthComparison,
  verifyGrowthComparison,
} from '../domain/growthComparison.js';
import { describeMetric, formatPercentagePoints, formatPercent, formatValue } from '../domain/format.js';
import { sourceAttribution } from './attribution.js';
import { buildMetadataChange } from './coverageService.js';
import { buildComparisonVintage } from './vintage.js';

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

/** Normalize the optional middle-year input (same contract as level mode). */
function normalizeBreakerInput(options = {}) {
  const raw = options.yearMid ?? options.breaker ?? options.pointBreaker ?? options.mid ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'none')) return null;
  return raw;
}

function signedValueDisplay(value, metric) {
  if (value === null || value === undefined) return null;
  const base = formatValue(value, metric).formatted;
  if (base === null) return null;
  return Number(value) > 0 ? `+${base}` : base;
}

function buildGrowthIdentityText(iv) {
  if (!iv.available) return null;
  return (
    `#${iv.fullGrowthRank} − ${iv.outsideAbove} = #${iv.commonGrowthRank} ` +
    `(observed growth rank minus outside-above equals like-for-like growth rank; ` +
    `same interval growth universe throughout)`
  );
}

function buildLimits({ mixedVintage, commonSize, focusAvailable, hasMid }) {
  const limits = [
    'Growth-universe membership describes calculability only: an economy belongs to an interval when both endpoint levels are present and finite and the start value is strictly positive. It never implies anything about economic performance.',
    'Economies observed at the selected years but without calculable growth are listed with per-interval reasons. They are not ranked and change neither growth positions nor growth denominators.',
    'Growth values, peer averages and percentage-point differences are derived by this application from stored World Bank observations. The World Bank does not publish them.',
    'Reason not established from stored evidence: the application records per-year counts of rows without a usable value, but does not store per-economy causes for a missing observation.',
    'Region, income level and lending type are World Bank classifications in the retrieved metadata vintage, not historical classifications as of the compared years.',
    'Like-for-like growth positions are derived comparison positions, not official World Bank ranks and not observed-year ranks.',
    'Growth is the simple percentage change between the two selected observations. It is not annualized.',
  ];
  if (hasMid) {
    limits.push(
      'All three intervals share one like-for-like growth universe; interval growth ranks are not subtracted from one another.',
    );
  } else {
    limits.push(
      'With a single interval the observed and like-for-like growth populations coincide; both ranks describe the same population and are therefore equal.',
    );
  }
  if (mixedVintage) {
    limits.push(
      'Mixed World Bank vintage detected across the rows used; interpret the comparison with caution.',
    );
  }
  if (Number.isInteger(commonSize) && commonSize < 10) {
    limits.push(
      `The like-for-like growth universe is very small (${commonSize} economies); ranks should be read as counts, never as percentages.`,
    );
  }
  if (!focusAvailable) {
    limits.push(
      'The focus economy lacks a calculable growth observation for at least one interval, so no comparison is published for that interval.',
    );
  }
  return limits;
}

function growthMethodology(hasMid) {
  return {
    ranking: 'growthPercent DESC, ISO3 ASC; rank = 1-based ordinal position. Ties receive distinct positions ordered by ISO3. Rank 1 is the highest growth.',
    growth:
      'Simple percentage change between the two selected observations: ((endValue / startValue) - 1) * 100 on raw values. Not annualized; no CAGR.',
    absoluteChange:
      'endValue minus startValue on raw values. Displayed for context only; it never affects rank, sorting, universe membership, relations or decomposition.',
    sets: hasMid
      ? 'Common = economies with calculable growth in ALL THREE intervals (AM, MB, AB); Outside per interval = growth-valid for that interval but missing calculable growth in at least one other interval.'
      : 'Common = economies with calculable growth for the single interval; observed and like-for-like populations coincide.',
    aboveBelow:
      'Above/below the focus economy is determined by growth-ranking position within the relevant ranking (observed or like-for-like), never by level values or by raw growth comparison. Country growth % > India growth % means above India only insofar as ranking position decides it under the ISO3 tie-break.',
    identity:
      'Per interval: fullGrowthRank − outsideAbove = commonGrowthRank. Inter-interval rank subtraction is not performed.',
    peerAverage:
      'Unweighted arithmetic mean of full-precision growthPercent over the interval population excluding the focus economy. Peer average (excluding India) over N peers; India-minus-average is plain subtraction displayed as percentage points (pp). Averages never affect ranking.',
    validity:
      'Growth is calculable only when both endpoint levels are present and finite and the start value is strictly positive; otherwise growthPercent is null with a reason and the economy is not ranked for that interval.',
    membership: 'Growth-universe membership describes calculability only.',
  };
}

/**
 * Build a YoY % growth rank-movement comparison for one metric and two or
 * three years. Intervals always run chronologically earlier → later, so a
 * swapped A/B yields identical growth numbers.
 *
 * @param {object} db
 * @param {{metricKey:string, yearA:number, yearB:number, yearMid?:number, focusIso3?:string, detail?:string}} options
 */
export function buildGrowthComparisonResponse(db, options = {}) {
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

  // Optional middle year: same strictly-between contract as level mode.
  let yearMid = null;
  const breakerRaw = normalizeBreakerInput(options);
  if (breakerRaw !== null && breakerRaw !== undefined) {
    const mid = Number(breakerRaw);
    if (!Number.isInteger(mid)) {
      throw comparisonError(
        COMPARISON_ERROR_CODES.INVALID_BREAKER,
        'Middle year must be an integer year strictly between yearA and yearB, or None.',
        400,
      );
    }
    const lo = Math.min(yearA, yearB);
    const hi = Math.max(yearA, yearB);
    if (mid <= lo || mid >= hi) {
      throw comparisonError(
        COMPARISON_ERROR_CODES.INVALID_BREAKER,
        `Middle year must lie strictly between the two endpoint years (${lo} < middle < ${hi}).`,
        400,
      );
    }
    yearMid = mid;
  }
  const hasMid = yearMid !== null;

  const indicator = getIndicatorByMetricKey(db, metricKey);
  const eligibleUniverse = countEligibleCountries(db);
  const emptyUniverse = (intervals) => ({
    intervals,
    common: 0,
    AB: { observed: 0, outside: 0 },
    AM: hasMid ? { observed: 0, outside: 0 } : null,
    MB: hasMid ? { observed: 0, outside: 0 } : null,
    membershipRule: GROWTH_POPULATION_LABEL,
  });
  const intervals = hasMid ? ['AM', 'MB', 'AB'] : ['AB'];
  if (!indicator) {
    return {
      comparison: {
        available: false,
        reason: 'metric_not_ingested',
        mode: 'yoy',
        ...(hasMid ? { pointBreaker: { active: true, yearMid } } : {}),
      },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, b: yearB, ...(hasMid ? { mid: yearMid } : {}), order },
      universe: emptyUniverse(intervals),
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  const yearsWithData = new Set(listYearsWithData(db, indicator.id));
  const requiredYears = hasMid ? [yearA, yearMid, yearB] : [yearA, yearB];
  if (!requiredYears.every((y) => yearsWithData.has(y))) {
    return {
      comparison: {
        available: false,
        reason: 'no_stored_observations_for_metric_and_year',
        mode: 'yoy',
        ...(hasMid ? { pointBreaker: { active: true, yearMid } } : {}),
      },
      metric: describeMetric(metric),
      focus: { iso3: focusIso3, name: FOCUS_COUNTRY.name },
      years: { a: yearA, b: yearB, ...(hasMid ? { mid: yearMid } : {}), order },
      universe: emptyUniverse(intervals),
      focusMovement: null,
      economies: { counts: null, rows: [], truncated: false, totalRows: 0 },
      denominatorExplanation: null,
      evidence: null,
      verification: { passed: false, checks: [] },
      source: sourceAttribution(),
    };
  }

  // One atomic read for all selected years (no year-1 fetch: interval bases
  // are the selected endpoints themselves).
  const allRows = getEligibleObservationsForYears(db, indicator.id, requiredYears);
  const rowsFor = (y) => allRows.filter((r) => r.year === y);
  const toDomain = (rows) =>
    rows.map((r) => ({ iso3: r.iso3, name: r.name, value: r.value, valueRaw: r.valueRaw }));

  const comparison = buildGrowthComparison({
    rowsA: toDomain(rowsFor(yearA)),
    rowsMid: hasMid ? toDomain(rowsFor(yearMid)) : null,
    rowsB: toDomain(rowsFor(yearB)),
    focusIso3,
    yearA,
    yearMid,
    yearB,
  });
  const verification = verifyGrowthComparison(comparison);

  // Service-level checks (storage-dependent; kept out of the pure domain).
  const serviceChecks = [];
  const serviceRecord = (check, passed, detailInfo = null) =>
    serviceChecks.push({ check, status: passed ? 'pass' : 'fail', detail: detailInfo });

  // Every ranked member resolves to stored non-aggregate metadata. The growth
  // row universe is a subset of the level-observed union, so membership is
  // checked against the level rows actually read.
  const levelIso3 = [...new Set(allRows.map((r) => r.iso3))].sort();
  const metaRows = getCountriesByIso3List(db, levelIso3);
  const metaById = new Map(metaRows.map((m) => [m.id, m]));
  let membershipOk = metaRows.length === levelIso3.length;
  if (membershipOk) {
    for (const iso3 of levelIso3) {
      const meta = metaById.get(iso3);
      if (!meta || meta.is_aggregate === 1) {
        membershipOk = false;
        break;
      }
    }
  }
  serviceRecord('service.membershipInStorage', membershipOk, {
    union: levelIso3.length,
    resolved: metaRows.length,
  });

  const allChecks = [...verification.checks, ...serviceChecks];
  const passed = allChecks.every((c) => c.status === 'pass');
  if (!passed) {
    throw comparisonError(
      COMPARISON_ERROR_CODES.INVARIANT_FAILED,
      'Growth rank-movement comparison failed self-verification; no analytical numbers are published.',
      500,
    );
  }

  const vintage = buildComparisonVintage(db, {
    metricKey,
    indicatorId: indicator.id,
    yearA,
    yearB,
    ...(hasMid ? { yearMid } : {}),
  });
  const statA = vintage.perYear.a;
  const statB = vintage.perYear.b;
  const statMid = vintage.perYear.mid;
  const metadataUniverseComparison = hasMid
    ? {
        aToMid: buildMetadataChange(db, statA?.fetchRunId ?? null, statMid?.fetchRunId ?? null),
        midToB: buildMetadataChange(db, statMid?.fetchRunId ?? null, statB?.fetchRunId ?? null),
        aToB: buildMetadataChange(db, statA?.fetchRunId ?? null, statB?.fetchRunId ?? null),
      }
    : buildMetadataChange(db, statA?.fetchRunId ?? null, statB?.fetchRunId ?? null);

  const latestRun = getLatestFetchRun(db, { status: 'success' });
  const completeness = {
    a: statA ? { fetchRunId: statA.fetchRunId, status: latestRun?.status ?? null } : null,
    ...(hasMid
      ? { mid: statMid ? { fetchRunId: statMid.fetchRunId, status: latestRun?.status ?? null } : null }
      : {}),
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

  const reasonText = (reason) =>
    GROWTH_REASON_DESCRIPTIONS[reason] ??
    ({
      focus_missing_in_yearA: 'No stored World Bank observation for the focus economy in year A.',
      focus_missing_in_yearB: 'No stored World Bank observation for the focus economy in year B.',
    }[reason] ??
      null);

  // Decorate economies: metadata + per-interval growth displays. Display
  // strings are presentation only; ranks, growth values and averages travel
  // as full-precision numbers alongside them. Level endpoint values (with
  // displays) are attached for the Start/Middle/End value columns.
  const levelByYear = new Map();
  for (const r of allRows) {
    if (!levelByYear.has(r.iso3)) levelByYear.set(r.iso3, {});
    levelByYear.get(r.iso3)[r.year] = r;
  }
  const levelDisplay = (iso3, year) => {
    const row = levelByYear.get(iso3)?.[year] ?? null;
    if (!row || row.value === null || row.value === undefined) {
      return { value: null, display: null, text: null };
    }
    return {
      value: row.value,
      display: formatValue(row.value, metric).formatted,
      text: row.valueRaw ?? String(row.value),
    };
  };
  const decorated = comparison.economies.map((e) => {
    const meta = metaById.get(e.iso3);
    const levelA = levelDisplay(e.iso3, yearA);
    const levelMid = hasMid ? levelDisplay(e.iso3, yearMid) : { value: null, display: null, text: null };
    const levelB = levelDisplay(e.iso3, yearB);
    const intervals = {};
    for (const key of ['AM', 'MB', 'AB']) {
      const block = e.intervals?.[key] ?? null;
      if (!block) {
        intervals[key] = null;
        continue;
      }
      intervals[key] = {
        valid: block.valid,
        reason: block.reason,
        reasonText: block.reason ? (GROWTH_REASON_DESCRIPTIONS[block.reason] ?? null) : null,
        growthPercent: block.growthPercent,
        growthDisplay: formatPercent(block.growthPercent),
        absoluteChange: block.absoluteChange,
        absoluteDisplay: signedValueDisplay(block.absoluteChange, metric),
        startValue: block.startValue,
        startDisplay: block.startValue === null ? null : formatValue(block.startValue, metric).formatted,
        startText: block.startValue === null ? null : String(block.startValue),
        endValue: block.endValue,
        endDisplay: block.endValue === null ? null : formatValue(block.endValue, metric).formatted,
        endText: block.endValue === null ? null : String(block.endValue),
        obsRank: block.obsRank,
        commonRank: block.commonRank,
        relObs: block.relObs,
        relCommon: block.relCommon,
        affectsObs: block.affectsObs,
        affectsCommon: block.affectsCommon,
        tiedWithFocus: block.tiedWithFocus,
      };
    }
    return {
      iso3: e.iso3,
      name: e.name,
      region: meta?.region ?? null,
      regionId: meta?.region_id ?? null,
      incomeLevel: meta?.income_level ?? null,
      lendingType: meta?.lending_type ?? null,
      metadataVintageNote: 'World Bank classification in the retrieved metadata vintage.',
      status: e.status,
      presentInAM: e.presentInAM,
      presentInMB: e.presentInMB,
      presentInAB: e.presentInAB,
      relationToFocus: e.relationToFocus,
      relationToFocusAM: e.relationToFocusAM,
      relationToFocusMB: e.relationToFocusMB,
      relationToFocusAB: e.relationToFocusAB,
      positionEffect: e.positionEffect,
      affectsFocusPosition: e.affectsFocusPosition,
      valueA: levelA.value,
      displayA: levelA.display,
      rawTextA: levelA.text,
      valueMid: levelMid.value,
      displayMid: levelMid.display,
      rawTextMid: levelMid.text,
      valueB: levelB.value,
      displayB: levelB.display,
      rawTextB: levelB.text,
      intervals,
    };
  });

  const counts = {
    total: decorated.length,
    common: comparison.totals.common,
    outside: decorated.filter((r) => r.status !== 'common').length,
    tiedWithFocus: decorated.filter((r) =>
      ['AM', 'MB', 'AB'].some((k) => r.intervals?.[k]?.tiedWithFocus === true),
    ).length,
  };

  let rows = decorated;
  if (detail === 'summary') {
    rows = decorated.filter((r) => r.status !== 'common' || r.iso3 === focusIso3);
  }

  const decorateInterval = (iv) => {
    if (!iv) return null;
    const base = {
      available: iv.available,
      reason: iv.reason,
      reasonText: iv.reason ? (GROWTH_REASON_DESCRIPTIONS[iv.reason] ?? reasonText(iv.reason)) : null,
      startYear: iv.startYear,
      endYear: iv.endYear,
      indiaGrowthPercent: iv.indiaGrowthPercent,
      indiaGrowthDisplay: formatPercent(iv.indiaGrowthPercent),
      startValue: iv.startValue,
      startDisplay: iv.startValue === null ? null : formatValue(iv.startValue, metric).formatted,
      endValue: iv.endValue,
      endDisplay: iv.endValue === null ? null : formatValue(iv.endValue, metric).formatted,
      absoluteChange: iv.absoluteChange,
      absoluteDisplay: signedValueDisplay(iv.absoluteChange, metric),
      fullGrowthRank: iv.fullGrowthRank,
      commonGrowthRank: iv.commonGrowthRank,
      denominatorObserved: iv.denominatorObserved,
      denominatorCommon: iv.denominatorCommon,
      outsideAbove: iv.outsideAbove,
      outsideBelow: iv.outsideBelow,
      peerAvgObserved: iv.peerAvgObserved,
      peerAvgObservedDisplay: formatPercent(iv.peerAvgObserved),
      peerCountObserved: iv.peerCountObserved,
      peerAvgReasonObserved: iv.peerAvgReasonObserved,
      peerAvgReasonTextObserved: iv.peerAvgReasonObserved
        ? (GROWTH_REASON_DESCRIPTIONS[iv.peerAvgReasonObserved] ?? null)
        : null,
      peerAvgCommon: iv.peerAvgCommon,
      peerAvgCommonDisplay: formatPercent(iv.peerAvgCommon),
      peerCountCommon: iv.peerCountCommon,
      peerAvgReasonCommon: iv.peerAvgReasonCommon,
      peerAvgReasonTextCommon: iv.peerAvgReasonCommon
        ? (GROWTH_REASON_DESCRIPTIONS[iv.peerAvgReasonCommon] ?? null)
        : null,
      vsPeerObservedPp: iv.vsPeerObservedPp,
      vsPeerObservedDisplay: formatPercentagePoints(iv.vsPeerObservedPp),
      vsPeerReasonObserved: iv.vsPeerReasonObserved,
      vsPeerReasonTextObserved: iv.vsPeerReasonObserved
        ? (GROWTH_REASON_DESCRIPTIONS[iv.vsPeerReasonObserved] ?? reasonText(iv.vsPeerReasonObserved))
        : null,
      vsPeerCommonPp: iv.vsPeerCommonPp,
      vsPeerCommonDisplay: formatPercentagePoints(iv.vsPeerCommonPp),
      vsPeerReasonCommon: iv.vsPeerReasonCommon,
      vsPeerReasonTextCommon: iv.vsPeerReasonCommon
        ? (GROWTH_REASON_DESCRIPTIONS[iv.vsPeerReasonCommon] ?? reasonText(iv.vsPeerReasonCommon))
        : null,
      identityText: buildGrowthIdentityText(iv),
    };
    return base;
  };

  const growth = {
    AM: decorateInterval(comparison.intervals.AM),
    MB: decorateInterval(comparison.intervals.MB),
    AB: decorateInterval(comparison.intervals.AB),
  };
  const abAvailable = comparison.intervals.AB.available;

  return {
    comparison: {
      available: abAvailable,
      reason: abAvailable ? null : comparison.intervals.AB.reason,
      mode: 'yoy',
      ...(hasMid ? { pointBreaker: { active: true, yearMid } } : {}),
    },
    metric: describeMetric(metric),
    focus: { iso3: focusIso3, name: allRows.find((r) => r.iso3 === focusIso3)?.name ?? FOCUS_COUNTRY.name },
    years: { a: yearA, b: yearB, ...(hasMid ? { mid: yearMid } : {}), order },
    universe: {
      intervals,
      common: comparison.totals.common,
      AB: { observed: comparison.totals.AB, outside: comparison.totals.outsideAB },
      AM: hasMid ? { observed: comparison.totals.AM, outside: comparison.totals.outsideAM } : null,
      MB: hasMid ? { observed: comparison.totals.MB, outside: comparison.totals.outsideMB } : null,
      membershipRule: GROWTH_POPULATION_LABEL,
      levelMembershipRule: COMPARISON_POPULATION_LABEL,
    },
    focusMovement: {
      growth,
      rankMeaning: 'rank_1_is_highest_growth',
      signConvention: {
        growthValues: 'positive_means_the_value_increased_over_the_interval',
        absoluteChange: 'positive_means_the_value_increased_over_the_interval',
        vsPeer: 'positive_means_india_grew_faster_than_peers_by_that_many_percentage_points',
      },
    },
    economies: {
      counts,
      rows,
      truncated: false,
      totalRows: decorated.length,
    },
    denominatorExplanation: null,
    evidence: {
      vintage: vintage.vintage,
      retrieval: vintage.retrieval,
      freshness: vintage.freshness,
      perYear: vintage.perYear,
      metadataUniverseComparison,
      completeness,
      fingerprint: vintage.fingerprint,
      eligibleUniverse,
      limits: buildLimits({
        mixedVintage: vintage.vintage.mixedVintage,
        commonSize: comparison.totals.common,
        focusAvailable: abAvailable,
        hasMid,
      }),
    },
    verification: { passed: true, checks: allChecks },
    source: sourceAttribution(),
    comparisonMethodology: growthMethodology(hasMid),
  };
}

export default { buildGrowthComparisonResponse };
