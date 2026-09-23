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
 * PRESENTATION-ONLY display scales.
 *
 * A metric may declare `displayScaleHint` (Total GDP values are on the order of
 * 10^12). The hint changes ONLY the human-readable string produced in this
 * module: the raw value, value_raw, ranking, growth, tie-breaking and every
 * calculation keep the untouched World Bank number. Metrics without a hint
 * render exactly as they always have (GDP-per-capita output is unchanged).
 */
const DISPLAY_SCALES = Object.freeze({
  trillions: Object.freeze({ divisor: 1e12, suffix: ' trillion', decimals: 2 }),
});

/** The display scale declared by a metric, or null when it declares none. */
export function displayScaleFor(metric) {
  const hint = metric?.displayScaleHint;
  if (!hint) return null;
  return DISPLAY_SCALES[hint] ?? null;
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
  const scale = displayScaleFor(metric);
  const plain = formatNumber(value, { decimals: 0 });
  return {
    raw: value === null || value === undefined ? null : Number(value),
    formatted:
      plain === null
        ? null
        : scale
          ? `${symbol}${formatNumber(Number(value) / scale.divisor, { decimals: scale.decimals })}${scale.suffix}`
          : `${symbol}${plain}`,
    unit,
    currencySymbol: symbol,
    decimals: scale ? scale.decimals : 0,
    ...(scale ? { displayScale: metric.displayScaleHint } : {}),
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

/**
 * Percentage-point display for a difference of two percentages (e.g. India
 * growth minus peer-average growth). Presentation only: the value must
 * already have been computed as a plain subtraction, never as a percentage
 * of a percentage. Never used as a calculation input.
 */
export function formatPercentagePoints(value, options = {}) {
  const { decimals = 2 } = options;
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, { decimals })} pp`;
}

/** Public metric description used by the API and the UI (unit labels included). */
export function describeMetric(metric) {
  return {
    key: metric.key,
    subject: metric.subject,
    indicatorCode: metric.indicatorCode,
    label: metric.label,
    shortLabel: metric.shortLabel,
    unit: metric.unit,
    unitLong: metric.unitLong,
    currencySymbol: metric.currencySymbol,
    group: metric.group,
    priceBasis: metric.priceBasis,
    ppp: metric.ppp === true,
    baseYear: metric.baseYear ?? null,
    displayScale: metric.displayScaleHint ?? null,
    worldBankPage: metric.worldBankPage,
  };
}

export default { formatNumber, formatValue, formatPercent, formatPercentagePoints, describeMetric, displayScaleFor };