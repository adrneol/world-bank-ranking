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

const VINTAGE_MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

function vintageParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!(year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  return { year, month, day };
}

/**
 * Upstream WDI vintage month for the About reference field: '2026-07-13'
 * (or a datetime starting the same way) becomes 'July 2026'. Presentation
 * only; null for anything that is not an ISO-like date — never invented.
 */
export function formatVintageMonth(value) {
  const parts = vintageParts(value);
  if (!parts) return null;
  return `${VINTAGE_MONTHS[parts.month - 1]} ${parts.year}`;
}

/**
 * Upstream WDI vintage date for Status/Audit display: '2026-07-13' becomes
 * '13 July 2026'. Presentation only; null when unparseable.
 */
export function formatVintageDate(value) {
  const parts = vintageParts(value);
  if (!parts) return null;
  return `${parts.day} ${VINTAGE_MONTHS[parts.month - 1]} ${parts.year}`;
}

/**
 * Local retrieval timestamps render explicitly in UTC ('28 September 2026,
 * 00:25 UTC'), formatted with UTC getters so the text never depends on the
 * viewer's timezone. The stored canonical value stays UTC ISO; null when
 * unparseable.
 */
export function formatUtcDateTime(value) {
  const time = new Date(String(value ?? '').trim()).getTime();
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCDate()} ${VINTAGE_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** Real elapsed seconds for the cold-start bootstrap clock (presentation only). */
export function formatElapsed(sec) {
  const n = Math.max(0, Math.floor(sec ?? 0));
  return `${n} second${n === 1 ? '' : 's'}`;
}
