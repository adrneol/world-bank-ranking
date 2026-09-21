/**
 * YoY VERIFICATION SERVICE (specification sections 20, 21 and 22).
 *
 * Kept strictly separate from level ranking: the ordering here is by percentage
 * change, not by value, and the denominator counts only entities with valid
 * observations in BOTH years that produce a calculable percentage.
 */

import { FOCUS_COUNTRY, METRICS, METRIC_KEYS, config } from '../config.js';
import {
  countEligibleCountries,
  getEligibleObservations,
  getIndicatorByMetricKey,
  getYearRange,
} from '../db/repository.js';
import { buildYoyCoverage } from '../domain/coverage.js';
import { describeMetric, formatPercent, formatValue } from '../domain/format.js';
import { neighborWindow, paginate, searchRanked } from '../domain/ranking.js';
import { rankByYoyAndLocate, rankByYoy, buildYoyRows } from '../domain/yoyRanking.js';
import { sourceAttribution } from './attribution.js';
import { normalizeNeighborCount } from './rankVerification.js';

/**
 * @param {object} db
 * @param {{year?:number, metricKey?:string, neighbors?:number, focusIso3?:string}} [options]
 */
export function buildYoyVerification(db, options = {}) {
  const metricKey = options.metricKey ?? METRIC_KEYS[0];
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const neighbors = normalizeNeighborCount(options.neighbors);
  const indicator = getIndicatorByMetricKey(db, metricKey);
  const eligibleUniverse = countEligibleCountries(db);

  if (!indicator) {
    return {
      available: false,
      reason: 'metric_not_ingested',
      metric: describeMetric(metric),
      year: options.year ?? null,
      neighbors,
      focus: null,
      coverage: null,
      above: [],
      below: [],
      denominator: 0,
      source: sourceAttribution(),
    };
  }

  const year = options.year ?? getYearRange(db, indicator.id).maxYear;
  if (year === null || year === undefined) {
    return {
      available: false,
      reason: 'no_stored_data',
      metric: describeMetric(metric),
      year: null,
      neighbors,
      focus: null,
      coverage: null,
      above: [],
      below: [],
      denominator: 0,
      source: sourceAttribution(),
    };
  }

  const currentRows = getEligibleObservations(db, indicator.id, year);
  const previousRows = getEligibleObservations(db, indicator.id, year - 1);

  const coverage = buildYoyCoverage({
    metricKey,
    year,
    eligibleUniverse,
    currentRows,
    previousRows,
    focusIso3,
  });

  const { ranked, total, target } = rankByYoyAndLocate(
    buildYoyRows(currentRows, previousRows).rows,
    focusIso3,
  );

  const decorate = (row) => ({
    rank: row.rank,
    iso3: row.iso3,
    country: row.name,
    previousValue: row.previousValue,
    currentValue: row.currentValue,
    previousValueText: row.previousValueRaw ?? String(row.previousValue),
    currentValueText: row.currentValueRaw ?? String(row.currentValue),
    previousValueDisplay: formatValue(row.previousValue, metric).formatted,
    currentValueDisplay: formatValue(row.currentValue, metric).formatted,
    yoyPercent: row.yoyPercent,
    yoyDisplay: formatPercent(row.yoyPercent),
    isFocus: row.iso3 === focusIso3,
  });

  const focusIndex = target ? ranked.findIndex((row) => row.iso3 === focusIso3) : -1;
  const window = target ? neighborWindow(ranked, target.rank, neighbors) : null;
  const above = target ? ranked.slice(Math.max(0, focusIndex - neighbors), focusIndex) : [];
  const below = target ? ranked.slice(focusIndex + 1, focusIndex + 1 + neighbors) : [];

  return {
    available: Boolean(target),
    reason: target ? null : 'focus_country_has_no_valid_yoy_for_metric_and_year',
    metric: describeMetric(metric),
    year,
    previousYear: year - 1,
    neighbors,
    neighborsDefault: config.neighborsDefault,
    denominator: total, // YoY denominator: valid pairs only
    levelDenominatorForComparison: coverage.currentValidObservations,
    coverage,
    focus: target
      ? {
          iso3: target.iso3,
          country: target.name,
          previousValue: target.previousValue,
          currentValue: target.currentValue,
          previousValueText: target.previousValueRaw ?? String(target.previousValue),
          currentValueText: target.currentValueRaw ?? String(target.currentValue),
          previousValueDisplay: formatValue(target.previousValue, metric).formatted,
          currentValueDisplay: formatValue(target.currentValue, metric).formatted,
          yoyPercent: target.yoyPercent,
          yoyDisplay: formatPercent(target.yoyPercent),
          rank: target.rank,
          total,
          rowsAbove: target.rank - 1,
          rowsBelow: total - target.rank,
          unit: metric.unitLong ?? metric.unit,
        }
      : null,
    above: above.map(decorate),
    below: below.map(decorate),
    window: window
      ? { start: window.start, end: window.end, size: window.rows.length, rows: window.rows.map(decorate) }
      : null,
    columns: ['rank', 'country', 'iso3', 'previousValue', 'currentValue', 'yoyPercent'],
    source: sourceAttribution(),
    notes: [
      'YoY ranking is ordered by percentage change and is never mixed with level ranking.',
      'The YoY denominator can be smaller than the level denominator for the same year and metric.',
    ],
  };
}

/**
 * FULL YoY RANKING (specification section 20).
 *
 * The complete YoY-ordered list for one year and one metric, with server-side
 * pagination and country search. Ordering, ranks and the denominator all come
 * from the YoY ranking engine; search never renumbers ranks.
 *
 * @param {object} db
 * @param {{year?:number, metricKey?:string, page?:number, pageSize?:number,
 *          search?:string, focusIso3?:string}} [options]
 */
export function buildFullYoyRanking(db, options = {}) {
  const metricKey = options.metricKey ?? METRIC_KEYS[0];
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const indicator = getIndicatorByMetricKey(db, metricKey);
  const eligibleUniverse = countEligibleCountries(db);

  if (!indicator) {
    return {
      available: false,
      reason: 'metric_not_ingested',
      metric: describeMetric(metric),
      year: options.year ?? null,
      rows: [],
      total: 0,
      eligibleUniverse,
      source: sourceAttribution(),
    };
  }

  const year = options.year ?? getYearRange(db, indicator.id).maxYear;
  const built =
    year === null || year === undefined
      ? { rows: [], pairs: 0 }
      : buildYoyRows(
          getEligibleObservations(db, indicator.id, year),
          getEligibleObservations(db, indicator.id, year - 1),
        );
  const { ranked, total } = rankByYoy(built.rows);

  const decorate = (row) => ({
    rank: row.rank,
    iso3: row.iso3,
    country: row.name,
    previousValue: row.previousValue,
    currentValue: row.currentValue,
    previousValueText: row.previousValueRaw ?? String(row.previousValue),
    currentValueText: row.currentValueRaw ?? String(row.currentValue),
    previousValueDisplay: formatValue(row.previousValue, metric).formatted,
    currentValueDisplay: formatValue(row.currentValue, metric).formatted,
    yoyPercent: row.yoyPercent,
    yoyDisplay: formatPercent(row.yoyPercent),
    isFocus: row.iso3 === focusIso3,
  });

  const search = String(options.search ?? '').trim();
  const searchMatches = search ? searchRanked(ranked, search).map(decorate) : [];

  const page = paginate(ranked, {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
  });

  const focusRow = ranked.find((row) => row.iso3 === focusIso3) ?? null;

  return {
    available: ranked.length > 0,
    reason: ranked.length > 0 ? null : 'no_stored_yoy_pairs_for_metric_and_year',
    metric: describeMetric(metric),
    year,
    previousYear: year === null ? null : year - 1,
    total, // YoY denominator: valid pairs only
    eligibleUniverse,
    page: page.page,
    pageSize: page.pageSize,
    pages: page.pages,
    rows: page.rows.map(decorate),
    search: {
      query: search || null,
      matchCount: searchMatches.length,
      matches: searchMatches,
    },
    focus: focusRow ? decorate(focusRow) : null,
    columns: ['rank', 'country', 'iso3', 'previousValue', 'currentValue', 'yoyPercent'],
    source: sourceAttribution(),
    notes: [
      'Rows are ordered by YoY percentage change descending, with ISO3 ascending as the deterministic tie-break.',
      'total counts only entities with a valid observation in BOTH years and a calculable percentage.',
    ],
  };
}

export default { buildYoyVerification, buildFullYoyRanking };