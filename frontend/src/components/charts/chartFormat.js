/**
 * Chart presentation formatting (presentation only, never economics).
 *
 * Ticks and annual readouts may compact magnitudes. Evidence uses the
 * source precision. No function here derives an economic statistic.
 */

import { compareCurrencySymbol } from '../../utils/compareFormat.js';
import { formatDecimal } from '../../utils/format.js';

/** Compact axis tick: 1.2T / 3.4B / 5.6M / 7.8k, else registry precision. */
export function formatTickValue(value, decimals = 0, unit = null) {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const prefix = compareCurrencySymbol(unit?.replace(/ per person$/, ''));
  if (abs >= 1e12) return `${prefix}${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${prefix}${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${prefix}${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `${prefix}${(n / 1000).toFixed(1)}k`;
  if (abs > 0 && abs < 10 ** -decimals) return n.toPrecision(2);
  return formatDecimal(n, decimals);
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
    const amount = readoutNumber(abs / scale, 2);
    return `${value < 0 ? '−' : ''}${currency}${amount}${suffix}${perPerson ? '/person' : ''}`;
  }
  const amount = readoutNumber(value, Math.min(decimals, 2));
  const shortUnit = /^(?:index points|index)\s*\(/i.test(unit) ? 'index pts'
    : unit?.startsWith('local currency units per US$') ? 'LCU/US$' : unit;
  return shortUnit ? `${amount} ${shortUnit}` : amount;
}

export default { formatTickValue, formatChartValue };
