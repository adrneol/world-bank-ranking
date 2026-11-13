import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTooltipStyle, CHART_COLORS, yAxisWidthFor } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';
import ChartLegend from './ChartLegend.jsx';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';

/** Point view for categorical interval results. Uses the line renderer without connecting categories. */
export default function IntervalLineChart({ entries = [], series = [], unit = null, decimals = 0, formatTooltip = null }) {
  const narrow = useIsNarrowChart();
  if (entries.length === 0) return null;
  const colors = [CHART_COLORS.primary, CHART_COLORS.secondary];
  return (
    <>
      <div className="chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={entries} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="x" interval={0} padding={{ left: 18, right: 30 }} tick={{ fontSize: 11, fill: CHART_COLORS.muted }} tickLine={false} />
            <YAxis
              width={yAxisWidthFor(unit, narrow)}
              tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
              tickFormatter={(value) => formatTickValue(value, decimals, unit)}
              label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
            />
            <Tooltip
              formatter={(value, name) => [formatTooltip ? formatTooltip(value) : formatChartValue(value, decimals), name]}
              contentStyle={chartTooltipStyle}
            />
            {series.map((item, index) => (
              <Line
                key={item.key}
                type="linear"
                dataKey={item.key}
                name={item.label ?? item.key}
                stroke={colors[index % colors.length]}
                strokeWidth={0}
                dot={{ r: 4, fill: colors[index % colors.length] }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend type="point" items={series.map((item, index) => ({ label: item.label ?? item.key, color: colors[index % colors.length] }))} />
      <p className="chart-note">Intervals are separate categories. The markers are unconnected because they do not represent a continuous annual trajectory.</p>
    </>
  );
}
