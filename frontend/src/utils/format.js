/**
 * Presentation-only formatting.
 *
 * These helpers format backend-provided numbers for display. They are never
 * inputs to ranking, sorting comparisons, or YoY math (the backend owns all
 * of that). Raw strings from the backend are shown verbatim in verification
 * contexts.
 */

export function formatInt(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatRank(rank, total) {
  if (rank === null || rank === undefined || total === null || total === undefined) return '—';
  return `${formatInt(rank)} / ${formatInt(total)}`;
}

export function formatYoy(percent, display) {
  if (percent === null || percent === undefined) return '—';
  if (display) return display;
  const n = Number(percent);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function formatMoneyDisplay(displayValue) {
  return displayValue ?? '—';
}

/**
 * Metric-precision display: formats a raw backend number with the registry's
 * displayDecimals for the metric. Presentation only — never an input to math.
 * Prefer a backend display string when the response already carries one
 * (indiaValueDisplay.formatted, displayValue); use this only for raw numbers
 * the backend does not pre-format (compare legs, cross-rates, effects).
 */
export function formatDecimal(value, decimals) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const d = Number.isInteger(decimals) && decimals >= 0 ? decimals : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Backend reason codes are snake_case; render them readably without inventing meaning. */
export function readableReason(reason) {
  if (!reason) return null;
  return String(reason).replace(/_/g, ' ');
}
