/**
 * PRESENTATION-ONLY VALUE FORMATTING.
 *
 * Nothing exported from this module may be used inside a ranking, a YoY
 * calculation, a comparison, a sort or tie detection: the specification requires
 * those to use the raw World Bank value. Formatting exists so that every response
 * can carry the raw value AND a rounded, unit-labelled display value side by side
 * (raw precision is never lost, display is never used as an input).
 */

/** Group-separated number string, or null when the value is not a finite number. */
export function formatNumber(value, options = {}) {
  const { decimals = 0 } = options;
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Raw value plus its display form for one metric.
 *
 * @param {number|null} value raw World Bank value
 * @param {object} metric entry from config.js METRICS
 */
export function formatValue(value, metric) {
  const symbol = metric?.currencySymbol ?? '$';
  const unit = metric?.unitLong ?? metric?.unit ?? null;
  return {
    raw: value === null || value === undefined ? null : Number(value),
    formatted: formatNumber(value, { decimals: 0 }) === null ? null : `${symbol}${formatNumber(value, { decimals: 0 })}`,
    unit,
    currencySymbol: symbol,
    decimals: 0,
  };
}

/** Percent display for a YoY value. Never used as a calculation input. */
export function formatPercent(value, options = {}) {
  const { decimals = 2 } = options;
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, { decimals })}%`;
}

/** Public metric description used by the API and the UI (unit labels included). */
export function describeMetric(metric) {
  return {
    key: metric.key,
    indicatorCode: metric.indicatorCode,
    label: metric.label,
    shortLabel: metric.shortLabel,
    unit: metric.unit,
    unitLong: metric.unitLong,
    currencySymbol: metric.currencySymbol,
    group: metric.group,
    priceBasis: metric.priceBasis,
    worldBankPage: metric.worldBankPage,
  };
}

export default { formatNumber, formatValue, formatPercent, describeMetric };