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

/** Backend reason codes are snake_case; render them readably without inventing meaning. */
export function readableReason(reason) {
  if (!reason) return null;
  return String(reason).replace(/_/g, ' ');
}
