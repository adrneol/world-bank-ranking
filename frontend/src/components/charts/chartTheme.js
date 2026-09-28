/**
 * Shared chart theme (no components — react-refresh rule requires
 * components-only modules for fast refresh).
 *
 * Monochrome quiet-luxury palette drawn from the app CSS tokens
 * (--navy #101828, --muted, --line). Two series stay distinguishable
 * without color alone (second series renders dashed with its own legend
 * label); charts never use color as the sole meaning carrier. A third
 * slot exists for optional context overlays: vermillion (Okabe-Ito,
 * color-blind-safe against navy/teal) rendered dotted, again paired with
 * its own legend label.
 */
export const CHART_COLORS = Object.freeze({
  primary: '#101828',
  secondary: '#2a7f6f',
  tertiary: '#D55E00',
  grid: '#e2e2df',
  zero: '#9aa0a6',
  muted: '#5f6368',
});

export const CHART_HEIGHT = 260;

/**
 * Responsive Y-axis width (presentation only, Phase 2 R-05/Phase 11).
 *
 * The rotated unit label and compacted tick text share this width. Long
 * backend unit strings (e.g. "local currency units per US$ (period
 * average)") get a wider axis instead of squeezing the plot; narrow screens
 * get a tighter axis since ticks are already compacted (1.2T/3.4B/…). The
 * unit text itself is never altered — only the space reserved for it.
 */
export function yAxisWidthFor(unit, narrow) {
  const long = typeof unit === 'string' && unit.length > 20;
  if (narrow) return long ? 72 : 60;
  return long ? 88 : 72;
}

export default { CHART_COLORS, CHART_HEIGHT, yAxisWidthFor };
