/**
 * Bar comparison chart (period totals, group values, multi-year endpoint
 * levels). Bars show backend-provided values verbatim; a null value
 * renders no bar (missing, never zero). Never used for rates that must
 * not be summed, nor for quoted levels across currencies — callers gate
 * on backend capabilities before rendering.
 *
 * Layout contract (Phase 2 R-05): explicit-height plot shell
 * (.chart-plot, CSS-driven so media queries apply) containing the Recharts
 * plot ONLY, followed by an HTML ChartLegend in normal flow for grouped
 * (A-vs-B) comparisons. The 2-series legend no longer shares the fixed plot
 * box, so it wraps below the plot on narrow screens instead of overlapping
 * axis labels. Data mapping is unchanged (toBarEntries verbatim,
 * null-preserving, no economics).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toBarEntries } from './chartData.js';
import { CHART_COLORS, yAxisWidthFor } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';
import ChartLegend from './ChartLegend.jsx';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';

export default function BarComparisonChart({ entries = [], series = null, unit = null, decimals = 0, height = null, scrollable = false }) {
  const narrow = useIsNarrowChart();
  // Two shapes: single-series entries [{name, value}] or grouped rows
  // [{x, a, b}] with series [{key, label}] for A-vs-B comparisons.
  const isGrouped = Array.isArray(series) && series.length > 0;
  const single = isGrouped ? [] : toBarEntries(entries);
  const rows = isGrouped ? entries : single;
  if (rows.length === 0) return null;
  const fills = [CHART_COLORS.primary, CHART_COLORS.secondary];
  const legendItems = isGrouped
    ? series.map((s, i) => ({ label: s.label ?? s.key, color: fills[i % fills.length], dashed: false }))
    : null;
  return (
    <>
      <div className={scrollable ? 'chart-plot-scroll' : undefined} role={scrollable ? 'region' : undefined} aria-label={scrollable ? 'Scrollable chart plot' : undefined} tabIndex={scrollable ? 0 : undefined}>
      <div className={`chart-plot${scrollable ? ' chart-plot-wide' : ''}`} style={{ ...(Number.isFinite(height) ? { height } : {}), ...(scrollable ? { '--chart-min-width': `${Math.max(480, rows.length * 52 + 96)}px` } : {}) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap="28%">
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey={isGrouped ? 'x' : 'name'}
              tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
              tickLine={false}
              interval={0}
              angle={scrollable ? 0 : rows.length > 8 ? -28 : 0}
              textAnchor={scrollable ? 'middle' : rows.length > 8 ? 'end' : 'middle'}
              height={scrollable ? 30 : rows.length > 8 ? 52 : 30}
            />
            <YAxis
              width={yAxisWidthFor(unit, narrow)}
              tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
              tickFormatter={(v) => formatTickValue(v, decimals, unit)}
              label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
            />
            <Tooltip
              formatter={(value, name) => [formatChartValue(value, decimals), name]}
              contentStyle={{ fontSize: 12 }}
            />
            {isGrouped
              ? series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={fills[i % fills.length]} maxBarSize={scrollable ? 32 : 44} isAnimationActive={false} />
              ))
              : (
                <Bar dataKey="value" name="Value" fill={CHART_COLORS.primary} maxBarSize={64} isAnimationActive={false} />
              )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      </div>
      <ChartLegend items={legendItems} />
    </>
  );
}
