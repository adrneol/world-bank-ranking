import { FOCUS_COUNTRY, METRICS } from '../config.js';
import { getCountry, getDatasetState, getLatestFetchRun, getFocusHistoryRows } from '../db/repository.js';
import { formatPercent, formatValue } from '../domain/format.js';
import { buildYoySeries } from '../domain/yoy.js';

export const REAL_GROWTH_ID = 'real_gdp_growth';
export const MAX_HISTORY_YEARS = 100;
export const MAX_HISTORY_SERIES = 8;

function historyError(message, code) {
  return Object.assign(new Error(message), { httpStatus: 400, code });
}

export async function buildFocusHistory(db, { country = FOCUS_COUNTRY.iso3, series, startYear, endYear }) {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1960
      || endYear > new Date().getFullYear() + 1 || startYear > endYear
      || endYear - startYear + 1 > MAX_HISTORY_YEARS) {
    throw historyError('Choose an ordered annual history window of up to 100 years.', 'INVALID_RANGE');
  }
  if (!Array.isArray(series) || series.length === 0 || series.length > MAX_HISTORY_SERIES
      || series.some((id) => id !== REAL_GROWTH_ID && !Object.hasOwn(METRICS, id))) {
    throw historyError('Choose up to eight registered history series.', 'INVALID_INDICATOR');
  }
  if (typeof country !== 'string' || !/^[A-Z]{3}$/.test(country)) {
    throw historyError('Choose a valid economy ISO3 code.', 'INVALID_COUNTRY');
  }
  const ids = [...new Set(series)].sort();
  const needsPredecessor = ids.includes(REAL_GROWTH_ID);
  const metricKeys = [...new Set(ids.map((id) => id === REAL_GROWTH_ID ? 'total_constant' : id))];

  // Capture one committed snapshot on the already selected serving handle.
  // No refresh, writes or shared cross-target cache are involved.
  const tx = await db.transaction('read');
  let focus;
  let rows;
  let generation;
  try {
    focus = await getCountry(tx, country);
    if (!focus || focus.is_aggregate) {
      throw historyError('Choose an eligible economy for country history.', 'INVALID_COUNTRY');
    }
    rows = await getFocusHistoryRows(tx, country, metricKeys, startYear, endYear, needsPredecessor);
    const state = await getDatasetState(tx);
    const run = state ? null : await getLatestFetchRun(tx);
    generation = { contentVersion: state?.contentVersion ?? null, runId: state?.updatedRunId ?? run?.id ?? null };
  } finally {
    tx.close();
  }

  const byMetric = new Map(metricKeys.map((key) => [key, new Map()]));
  for (const row of rows) {
    // A registry mismatch cannot be attributed to the requested WDI series.
    if (row.code === METRICS[row.metricKey].indicatorCode) byMetric.get(row.metricKey).set(row.year, row);
  }

  const annualYears = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  const results = ids.map((id) => {
    const derived = id === REAL_GROWTH_ID;
    const metric = METRICS[derived ? 'total_constant' : id];
    const observations = byMetric.get(metric.key);
    const growth = derived ? buildYoySeries([...observations.values()], startYear, endYear) : null;
    const points = annualYears.map((year, index) => {
      const row = observations.get(year);
      const value = derived ? growth[index].yoyPercent : row?.value ?? null;
      return {
        year,
        value,
        display: derived ? formatPercent(value) : formatValue(value, metric).formatted,
        raw: derived ? null : row?.valueRaw ?? (row ? String(row.value) : null),
        vintage: row?.vintage ?? null,
        ...(derived ? { reason: growth[index].reason, previousVintage: observations.get(year - 1)?.vintage ?? null } : {}),
      };
    });
    return {
      id, metricKey: metric.key, indicatorCode: metric.indicatorCode,
      unit: derived ? 'annual %' : metric.unitLong ?? metric.unit,
      derived,
      ...(derived ? { method: 'Year-over-year percentage change in constant 2015 US$ GDP' } : {}),
      points,
    };
  });
  return { country, startYear, endYear, generation, source: 'World Bank WDI', series: results };
}
