/**
 * Chart presentation formatting (presentation only, never economics).
 *
 * Ticks and annual readouts may compact magnitudes. Evidence uses the
 * source precision. No function here derives an economic statistic.
 */

import { compareCurrencySymbol } from '../../utils/compareFormat.js';
import { formatDecimal } from '../../utils/format.js';

const tickScales = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** Choose the magnitude before formatting and never combine exponent and scale suffix. */
export function formatTickValue(value, decimals = 0, unit = null, { precision = 1, scientific = false } = {}) {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const percentage = isPercentageUnit(unit);
  const prefix = compareCurrencySymbol(unit?.replace(/ per person$/, ''));
  const sign = n < 0 ? '−' : percentage && n > 0 ? '+' : '';
  const suffix = percentage ? '%' : '';
  const [scale, compact] = (!scientific && !percentage && tickScales.find(([factor]) => abs >= factor)) || [1, ''];
  const amount = abs / scale;
  const places = compact ? precision : Math.max(precision, Math.min(decimals, 2));
  if (abs && (scientific || amount >= 1e6 || amount < 1e-4)) {
    return sign + prefix + abs.toExponential(precision).replace(/\.0+(?=e)/, '') + suffix;
  }
  const digits = amount && amount < 1 ? Math.max(places, Math.ceil(-Math.log10(amount)) + precision - 1) : places;
  return sign + prefix + amount.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: digits }) + compact + suffix;
}

/** Tooltip / data-label value: full precision, never compacted. */
export function formatChartValue(value, decimals = 0) {
  if (value === null || value === undefined) return '—';
  return formatDecimal(value, decimals);
}

export const isPercentageUnit = (unit) => typeof unit === 'string' && unit.includes('%');

const compactScales = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'], [1, '']];
const readoutNumber = (value, decimals) => {
  const magnitude = Math.abs(value);
  return magnitude >= 1e9 || (magnitude > 0 && magnitude < 0.5 * 10 ** -decimals)
    ? value.toExponential(2) : formatDecimal(value, decimals);
};

export function formatAnnualReadout(value, unit, decimals = 2) {
  if (!Number.isFinite(value)) return 'Missing';
  if (isPercentageUnit(unit)) {
    const amount = readoutNumber(value, 2);
    return amount + (unit.startsWith('% of ') ? unit : '%');
  }
  const perPerson = unit?.endsWith(' per person');
  const currency = compareCurrencySymbol(unit?.replace(/ per person$/, ''));
  const abs = Math.abs(value);
  if (currency) {
    const [scale, suffix] = compactScales.find(([scale]) => abs >= scale) ?? compactScales.at(-1);
    const scaled = abs / scale;
    const amount = readoutNumber(scaled >= 1e9 ? abs : scaled, 2);
    return `${value < 0 ? '−' : ''}${currency}${amount}${scaled >= 1e9 ? '' : suffix}${perPerson ? '/person' : ''}`;
  }
  const amount = readoutNumber(value, Math.min(decimals, 2));
  const shortUnit = /^(?:index points|index)\s*\(/i.test(unit) ? 'index pts'
    : unit?.startsWith('local currency units per US$') ? 'LCU/US$' : unit;
  return shortUnit ? `${amount} ${shortUnit}` : amount;
}

export default { formatTickValue, formatChartValue };
