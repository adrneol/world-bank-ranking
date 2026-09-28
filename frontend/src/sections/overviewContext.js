/**
 * Overview context-series data helpers (pure, no JSX — react-refresh
 * requires components-only modules for fast refresh).
 *
 * These reshape backend-provided yearly rows into overlay points. They
 * NEVER calculate economics: values pass through untouched (including
 * null); only field selection, year windowing, and eligibility happen
 * here. Missing stays missing so overlay lines break instead of
 * fabricating zeros.
 */

// Stable internal series identities (never display text).
export const CONTEXT_SERIES = Object.freeze({
  realGdpGrowth: Object.freeze({ id: 'realGdpGrowth', label: 'Real GDP growth' }),
  cpiInflation: Object.freeze({ id: 'cpiInflation', label: 'CPI inflation' }),
  gdpDeflatorInflation: Object.freeze({ id: 'gdpDeflatorInflation', label: 'GDP-deflator inflation' }),
});

// Backend metric keys behind each context identity.
export const CONTEXT_METRIC_KEY = Object.freeze({
  realGdpGrowth: 'total_constant',
  cpiInflation: 'inflation_cpi',
  gdpDeflatorInflation: 'inflation_deflator',
});

// Backend cell field behind each context identity: inflation metrics are
// annual-% levels (indiaValue); real growth is constant-price GDP YoY
// (indiaYoY) — the same backend-provided series SubjectInsight tables as
// "Real GDP growth (%)". No frontend derivation anywhere.
export const CONTEXT_FIELD = Object.freeze({
  realGdpGrowth: 'indiaYoY',
  cpiInflation: 'indiaValue',
  gdpDeflatorInflation: 'indiaValue',
});

// Which context options each primary history metric offers. Only the
// spec'd views: Prices CPI/deflator inflation and Total GDP real levels
// (whose overlay mode switches the primary to backend YoY growth).
export function contextOptionsFor(historyKey) {
  if (historyKey === 'inflation_cpi' || historyKey === 'inflation_deflator') return ['realGdpGrowth'];
  if (historyKey === 'total_constant') return ['cpiInflation', 'gdpDeflatorInflation'];
  return [];
}

/** Map backend rows to year points for one metric cell field (pure passthrough; missing stays null). */
export function valuePoints(rows, metricKey, field) {
  return (rows ?? []).map((r) => ({ x: r?.year, y: r?.[metricKey]?.[field] ?? null }));
}

/** Restrict overlay points to the primary series' displayed window (pure; primary never truncated). */
export function clampToWindow(points, lo, hi) {
  if (lo == null || hi == null) return points ?? [];
  return (points ?? []).filter((p) => Number.isFinite(p?.x) && p.x >= lo && p.x <= hi);
}

/** Min/max year present in primary points (the displayed window). */
export function primaryWindow(points) {
  const xs = (points ?? []).map((p) => p?.x).filter((x) => Number.isFinite(x));
  if (xs.length === 0) return null;
  return { lo: Math.min(...xs), hi: Math.max(...xs) };
}

export default { CONTEXT_SERIES, CONTEXT_METRIC_KEY, CONTEXT_FIELD, contextOptionsFor, valuePoints, clampToWindow, primaryWindow };
