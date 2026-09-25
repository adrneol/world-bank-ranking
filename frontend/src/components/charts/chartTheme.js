/**
 * Shared chart theme (no components — react-refresh rule requires
 * components-only modules for fast refresh).
 *
 * Monochrome quiet-luxury palette drawn from the app CSS tokens
 * (--navy #101828, --muted, --line). Two series stay distinguishable
 * without color alone (second series renders dashed with its own legend
 * label); charts never use color as the sole meaning carrier.
 */

export const CHART_COLORS = Object.freeze({
  primary: '#101828',
  secondary: '#2a7f6f',
  grid: '#e2e2df',
  zero: '#9aa0a6',
  muted: '#5f6368',
});

export const CHART_HEIGHT = 260;

export default { CHART_COLORS, CHART_HEIGHT };
