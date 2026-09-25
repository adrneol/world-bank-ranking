/**
 * Bar comparison chart (period totals, group values, multi-year endpoint
 * levels). Bars show backend-provided values verbatim; a null value
 * renders no bar (missing, never zero). Never used for rates that must
 * not be summed, nor for quoted levels across currencies — callers gate
 * on backend capabilities before rendering.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toBarEntries } from './chartData.js';
import { CHART_COLORS, CHART_HEIGHT } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';

export default function BarComparisonChart({ entries = [], series = null, unit = null, decimals = 0, height = CHART_HEIGHT }) {
  // Two shapes: single-series entries [{name, value}] or grouped rows
  // [{x, a, b}] with series [{key, label}] for A-vs-B comparisons.
  const isGrouped = Array.isArray(series) && series.length > 0;
  const single = isGrouped ? [] : toBarEntries(entries);
  const rows = isGrouped ? entries : single;
  if (rows.length === 0) return null;
  const fills = [CHART_COLORS.primary, CHART_COLORS.secondary];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap="28%">
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={isGrouped ? 'x' : 'name'}
          tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
          tickLine={false}
          interval={0}
          angle={rows.length > 8 ? -28 : 0}
          textAnchor={rows.length > 8 ? 'end' : 'middle'}
          height={rows.length > 8 ? 52 : 30}
        />
        <YAxis
          width={64}
          tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
          tickFormatter={(v) => formatTickValue(v, decimals)}
          label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
        />
        <Tooltip
          formatter={(value, name) => [formatChartValue(value, decimals), name]}
          contentStyle={{ fontSize: 12 }}
        />
        {isGrouped ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {isGrouped
          ? series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={fills[i % fills.length]} maxBarSize={44} isAnimationActive={false} />
          ))
          : (
            <Bar dataKey="value" name="Value" fill={CHART_COLORS.primary} maxBarSize={64} isAnimationActive={false} />
          )}
      </BarChart>
    </ResponsiveContainer>
  );
}
