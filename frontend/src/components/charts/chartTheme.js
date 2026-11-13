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
  primary: 'var(--chart-series-0)',
  secondary: 'var(--chart-secondary)',
  tertiary: 'var(--chart-tertiary)',
  grid: 'var(--chart-grid)',
  zero: 'var(--chart-zero)',
  muted: 'var(--muted)',
});

export const CHART_HEIGHT = 260;
export const chartTooltipStyle = { fontSize: 12, backgroundColor: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' };

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

const percentageDashes = ['6 4', '2 4', '10 4'];

export function annualStroke({ percentage, colorIndex = 0, primary }) {
  return {
    strokeWidth: primary ? 2.5 : percentage ? 2 : 1.8,
    strokeDasharray: percentage ? percentageDashes[colorIndex % percentageDashes.length] : undefined,
    strokeLinecap: 'round',
  };
}

export default { CHART_COLORS, CHART_HEIGHT, yAxisWidthFor };
