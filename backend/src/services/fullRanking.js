/**
 * FULL RANKING SERVICE (specification section 18).
 *
 * The complete ordered list for one year and one metric, with server-side
 * pagination and country search by name or ISO3. Ordering, ranks and the
 * denominator all come from the backend ranking engine.
 */

import { FOCUS_COUNTRY, METRICS, METRIC_KEYS } from '../config.js';
import {
  countEligibleCountries,
  getEligibleObservations,
  getIndicatorByMetricKey,
  getYearRange,
} from '../db/repository.js';
import { describeMetric, formatValue } from '../domain/format.js';
import { paginate, rankByValue, searchRanked } from '../domain/ranking.js';
import { sourceAttribution } from './attribution.js';

/**
 * @param {object} db
 * @param {{year?:number, metricKey?:string, page?:number, pageSize?:number,
 *          search?:string, focusIso3?:string}} [options]
 */
export function buildFullRanking(db, options = {}) {
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
  const { ranked, total } = year === null
    ? { ranked: [], total: 0 }
    : rankByValue(getEligibleObservations(db, indicator.id, year));

  const decorate = (row) => ({
    rank: row.rank,
    iso3: row.iso3,
    country: row.name,
    rawValue: row.value,
    rawValueText: row.valueRaw ?? String(row.value),
    displayValue: formatValue(row.value, metric).formatted,
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
    reason: ranked.length > 0 ? null : 'no_stored_observations_for_metric_and_year',
    metric: describeMetric(metric),
    year,
    total, // denominator for this metric-year
    eligibleUniverse,
    missingObservations: Math.max(0, eligibleUniverse - total),
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
    columns: ['rank', 'country', 'iso3', 'rawValue', 'displayValue'],
    source: sourceAttribution(),
    notes: [
      'Rows are ordered by the raw World Bank value descending, with ISO3 ascending as the deterministic tie-break.',
      'total is the number of eligible countries/economies holding a valid observation for this metric and year.',
    ],
  };
}

export default { buildFullRanking };