/**
 * Chart presentation formatting (presentation only, never economics).
 *
 * Ticks may compact large magnitudes for axis readability; tooltip and data
 * values always use full registry precision via formatDecimal. No function
 * here derives an economic statistic — scaling for pixels happens inside
 * Recharts itself.
 */

import { formatDecimal } from '../../utils/format.js';

/** Compact axis tick: 1.2T / 3.4B / 5.6M / 7.8k, else registry precision. */
export function formatTickValue(value, decimals = 0) {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatDecimal(n, decimals);
}

/** Tooltip / data-label value: full precision, never compacted. */
export function formatChartValue(value, decimals = 0) {
  if (value === null || value === undefined) return '—';
  return formatDecimal(value, decimals);
}

export default { formatTickValue, formatChartValue };
