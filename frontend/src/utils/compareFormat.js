import { formatDecimal } from './format.js';

const monetaryUnit = /^(?:(?:current|constant \d{4}) )?(US\$|international \$)(?:\/year)?$/i;

export function compareCurrencySymbol(unit) {
  const currency = unit?.match(monetaryUnit)?.[1];
  return currency ? (currency.toLowerCase() === 'us$' ? '$' : 'Int$') : '';
}

export function compareResultDecimals(unit, metricPrecision) {
  return unit?.includes('%') || unit === 'percentage points' || unit === 'index points' ? 2 : metricPrecision;
}

/** Format a backend result without deriving a value or borrowing the source unit. */
export function compareResultParts(value, unit, metricPrecision, { compact = false, signed = false } = {}) {
  const decimals = compareResultDecimals(unit, metricPrecision);
  const formatted = formatDecimal(value, decimals);
  if (formatted === '—') return { amount: formatted, suffix: '' };

  const sign = signed && value > 0 ? '+' : '';
  const symbol = compact ? compareCurrencySymbol(unit) : '';
  const unitSuffix = unit ? (unit.startsWith('%') ? unit : ` ${unit}`) : '';
  if (symbol) {
    const absolute = Math.abs(value);
    const [scale, suffix] = absolute >= 1e12 ? [1e12, 'T'] : absolute >= 1e9 ? [1e9, 'B'] : absolute >= 1e6 ? [1e6, 'M'] : [1, ''];
    const amount = `${value < 0 ? '−' : sign}${symbol}${formatDecimal(absolute / scale, Math.min(decimals, 2))}${suffix}`;
    return { amount, suffix: unitSuffix };
  }
  return { amount: sign + formatted, suffix: unitSuffix };
}

export function formatCompareResult(value, unit, metricPrecision, options) {
  const { amount, suffix } = compareResultParts(value, unit, metricPrecision, options);
  return amount + suffix;
}
