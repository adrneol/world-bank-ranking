/**
 * INDIA YEARLY RESULT BUILDER (specification sections 15 and 30).
 *
 * Produces ONE row per year. For each of the four metrics the row carries:
 *
 *   indiaValue   raw World Bank value, full precision
 *   indiaYoY     percentage change from the previous year, or null + a reason
 *   indiaRank    1-based position among eligible entities with valid data
 *   total        the denominator: eligible entities with valid data that year
 *
 * Everything is computed here, from stored World Bank observations, with the
 * backend ranking engine. The frontend receives finished numbers and must never
 * recompute value, YoY, rank or denominator (specification section 15).
 */

import { FOCUS_COUNTRY, METRICS, METRIC_KEYS } from '../config.js';
import {
  countEligibleCountries,
  getCountry,
  getCountryObservationsRange,
  getEligibleObservationsRange,
  getIndicatorByMetricKey,
  getYearRange,
} from '../db/repository.js';
import { describeMetric, formatPercent, formatValue } from '../domain/format.js';
import { rankByValue } from '../domain/ranking.js';
import { buildYoySeries } from '../domain/yoy.js';

/** A metric cell for a year when the metric has no stored series for that year. */
function emptyCell(metric, reason, eligibleUniverse) {
  return {
    available: false,
    reason,
    indiaValue: null,
    indiaValueRaw: null,
    indiaValueDisplay: null,
    indiaRank: null,
    total: 0,
    missingObservations: eligibleUniverse,
    indiaYoY: null,
    indiaYoYDisplay: null,
    indiaYoYReason: reason,
    previousYearValue: null,
    unit: metric.unitLong ?? metric.unit,
  };
}

/**
 * @param {object} db
 * @param {{startYear?:number, endYear?:number, metricKeys?:string[], focusIso3?:string}} [options]
 */
export function buildIndiaYearlyRows(db, options = {}) {
  const focusIso3 = String(options.focusIso3 ?? FOCUS_COUNTRY.iso3).toUpperCase();
  const metricKeys = options.metricKeys ?? METRIC_KEYS;
  const eligibleUniverse = countEligibleCountries(db);

  const metricInfo = {};
  const cellsByMetric = {};
  const overallRange = { minYear: null, maxYear: null };

  for (const metricKey of metricKeys) {
    const metric = METRICS[metricKey];
    if (!metric) throw new Error(`Unknown metric key: ${metricKey}`);
    metricInfo[metricKey] = describeMetric(metric);

    const indicator = getIndicatorByMetricKey(db, metricKey);
    if (!indicator) {
      cellsByMetric[metricKey] = null;
      continue;
    }

    const stored = getYearRange(db, indicator.id);
    const startYear = options.startYear ?? stored.minYear;
    const endYear = options.endYear ?? stored.maxYear;
    if (startYear === null || startYear === undefined || endYear === null || endYear === undefined) {
      cellsByMetric[metricKey] = null;
      continue;
    }
    overallRange.minYear =
      overallRange.minYear === null ? startYear : Math.min(overallRange.minYear, startYear);
    overallRange.maxYear =
      overallRange.maxYear === null ? endYear : Math.max(overallRange.maxYear, endYear);

    const eligibleRows = getEligibleObservationsRange(db, indicator.id, startYear, endYear);
    const rowsByYear = new Map();
    for (const row of eligibleRows) {
      if (!rowsByYear.has(row.year)) rowsByYear.set(row.year, []);
      rowsByYear.get(row.year).push(row);
    }

    // One extra year is read so the first selected year can still carry a YoY value.
    const focusSeries = getCountryObservationsRange(
      db,
      indicator.id,
      focusIso3,
      startYear - 1,
      endYear,
    );
    const yoyByYear = new Map(
      buildYoySeries(focusSeries, startYear, endYear).map((entry) => [entry.year, entry]),
    );

    const cells = new Map();
    for (let year = startYear; year <= endYear; year += 1) {
      const yearRows = rowsByYear.get(year) ?? [];
      const { ranked, total } = rankByValue(yearRows);
      const focusRow = ranked.find((row) => row.iso3 === focusIso3) ?? null;
      const yoy = yoyByYear.get(year) ?? null;

      cells.set(year, {
        available: Boolean(focusRow),
        reason: focusRow ? null : 'no_valid_observation_for_focus_country_in_this_metric_year',
        indiaValue: focusRow ? focusRow.value : null,
        indiaValueRaw: focusRow ? (focusRow.valueRaw ?? String(focusRow.value)) : null,
        indiaValueDisplay: focusRow ? formatValue(focusRow.value, metric) : null,
        indiaRank: focusRow ? focusRow.rank : null,
        total,
        missingObservations: Math.max(0, eligibleUniverse - total),
        indiaYoY: yoy ? yoy.yoyPercent : null,
        indiaYoYDisplay: yoy ? formatPercent(yoy.yoyPercent) : null,
        indiaYoYReason: yoy ? yoy.reason : 'year_outside_selected_range',
        previousYearValue: yoy ? yoy.previousValue : null,
        unit: metric.unitLong ?? metric.unit,
      });
    }

    cellsByMetric[metricKey] = { startYear, endYear, cells };
  }

  const years = [];
  if (overallRange.minYear !== null) {
    for (let year = overallRange.minYear; year <= overallRange.maxYear; year += 1) years.push(year);
  }

  const rows = years.map((year) => {
    const row = { year };
    for (const metricKey of metricKeys) {
      const holder = cellsByMetric[metricKey];
      if (!holder) {
        row[metricKey] = emptyCell(METRICS[metricKey], 'metric_not_ingested', eligibleUniverse);
      } else if (!holder.cells.has(year)) {
        row[metricKey] = emptyCell(METRICS[metricKey], 'year_outside_metric_range', eligibleUniverse);
      } else {
        row[metricKey] = holder.cells.get(year);
      }
    }
    return row;
  });

  const focusCountry = getCountry(db, focusIso3);

  return {
    focus: { iso3: focusIso3, name: focusCountry?.name ?? FOCUS_COUNTRY.name },
    eligibleUniverse,
    startYear: overallRange.minYear,
    endYear: overallRange.maxYear,
    years,
    metricKeys,
    metricInfo,
    metricRanges: Object.fromEntries(
      metricKeys.map((key) => [
        key,
        cellsByMetric[key]
          ? { startYear: cellsByMetric[key].startYear, endYear: cellsByMetric[key].endYear }
          : null,
      ]),
    ),
    rows,
    notes: [
      'indiaValue is the raw World Bank value; indiaValueDisplay is formatted for presentation only and is never an input to a calculation.',
      'total is the number of eligible countries/economies holding a valid observation for that metric and year, so it can differ between metrics and years.',
      'indiaYoY is null when either year has no stored observation or the previous value is not greater than zero; indiaYoYReason states which case applies.',
    ],
  };
}

export default { buildIndiaYearlyRows };