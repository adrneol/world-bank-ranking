/**
 * RANK VERIFICATION SERVICE (specification sections 16, 17 and 19).
 *
 * For one year and one metric it returns the focus country (India) plus a
 * configurable window of neighbours (default 5 above, 5 below) taken from the
 * SAME metric's ranking, with raw and formatted values. The window comes from the
 * backend ranking engine, so a neighbour list can never be produced from another
 * metric's ordering.
 */

import { FOCUS_COUNTRY, METRICS, METRIC_KEYS, config } from '../config.js';
import {
  countEligibleCountries,
  getCountry,
  getEligibleObservations,
  getIndicatorByMetricKey,
  getYearRange,
} from '../db/repository.js';
import { describeMetric, formatValue } from '../domain/format.js';
import { neighborWindow, rankByValue } from '../domain/ranking.js';
import { sourceAttribution } from './attribution.js';

/** Clamp a neighbour count into a sane, documented range. */
export function normalizeNeighborCount(value, fallback = config.neighborsDefault) {
  const raw = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(50, Math.floor(raw)));
}

/** Latest year with stored data for an indicator (or the whole database). */
export function resolveLatestYear(db, indicatorId = null) {
  return getYearRange(db, indicatorId).maxYear;
}

/**
 * @param {object} db
 * @param {{year?:number, metricKey?:string, neighbors?:number, focusIso3?:string}} [options]
 */
export function buildRankVerification(db, options = {}) {
  const metricKey = options.metricKey ?? METRIC_KEYS[0];
  const metric = METRICS[metricKey];
  if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);

  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const neighbors = normalizeNeighborCount(options.neighbors);
  const indicator = getIndicatorByMetricKey(db, metricKey);

  if (!indicator) {
    return {
      available: false,
      reason: 'metric_not_ingested',
      metric: describeMetric(metric),
      year: options.year ?? null,
      neighbors,
      focus: null,
      above: [],
      below: [],
      total: 0,
      eligibleUniverse: countEligibleCountries(db),
      source: sourceAttribution(),
    };
  }

  const year = options.year ?? resolveLatestYear(db, indicator.id);
  const eligibleUniverse = countEligibleCountries(db);

  if (year === null || year === undefined) {
    return {
      available: false,
      reason: 'no_stored_data',
      metric: describeMetric(metric),
      year: null,
      neighbors,
      focus: null,
      above: [],
      below: [],
      total: 0,
      eligibleUniverse,
      source: sourceAttribution(),
    };
  }

  const { ranked, total } = rankByValue(getEligibleObservations(db, indicator.id, year));
  const focusIndex = ranked.findIndex((row) => row.iso3 === focusIso3);
  const focusRow = focusIndex >= 0 ? ranked[focusIndex] : null;

  const decorate = (row) => ({
    rank: row.rank,
    iso3: row.iso3,
    country: row.name,
    rawValue: row.value,
    rawValueText: row.valueRaw ?? String(row.value),
    displayValue: formatValue(row.value, metric).formatted,
    isFocus: row.iso3 === focusIso3,
  });

  const window = focusRow ? neighborWindow(ranked, focusRow.rank, neighbors) : null;
  const above = focusRow ? ranked.slice(Math.max(0, focusIndex - neighbors), focusIndex) : [];
  const below = focusRow ? ranked.slice(focusIndex + 1, focusIndex + 1 + neighbors) : [];

  return {
    available: Boolean(focusRow),
    reason: focusRow ? null : 'focus_country_has_no_valid_observation_for_metric_and_year',
    metric: describeMetric(metric),
    year,
    neighbors,
    neighborsDefault: config.neighborsDefault,
    total, // denominator: eligible entities with a valid observation for this metric-year
    eligibleUniverse,
    missingObservations: Math.max(0, eligibleUniverse - total),
    focus: focusRow
      ? {
          iso3: focusRow.iso3,
          country: focusRow.name,
          rawValue: focusRow.value,
          rawValueText: focusRow.valueRaw ?? String(focusRow.value),
          displayValue: formatValue(focusRow.value, metric).formatted,
          unit: metric.unitLong ?? metric.unit,
          rank: focusRow.rank,
          total,
          rowsAbove: focusRow.rank - 1,
          rowsBelow: total - focusRow.rank,
          percentilePosition: total > 1 ? (focusRow.rank - 1) / (total - 1) : null,
        }
      : null,
    above: above.map(decorate),
    below: below.map(decorate),
    window: window
      ? { start: window.start, end: window.end, size: window.rows.length, rows: window.rows.map(decorate) }
      : null,
    columns: ['rank', 'country', 'iso3', 'rawValue', 'displayValue'],
    source: sourceAttribution(),
    notes: [
      'Neighbours are taken from the same metric and year as the focus row; a rank can never be mixed across metrics.',
      `Exactly ${focusRow ? focusRow.rank - 1 : 0} rows with a valid value for this metric precede the focus country in ${year}.`,
    ],
  };
}

export default { buildRankVerification, normalizeNeighborCount, resolveLatestYear };