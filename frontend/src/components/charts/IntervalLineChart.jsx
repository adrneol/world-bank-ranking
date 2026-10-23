import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_COLORS, yAxisWidthFor } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';
import ChartLegend from './ChartLegend.jsx';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';

/** Line view for a small set of categorical interval results. */
export default function IntervalLineChart({ entries = [], series = [], unit = null, decimals = 0 }) {
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
              tickFormatter={(value) => formatTickValue(value, decimals)}
              label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
            />
            <Tooltip
              labelFormatter={(label) => `Selected interval: ${label}`}
              formatter={(value, name) => [formatChartValue(value, decimals), name]}
              contentStyle={{ fontSize: 12 }}
            />
            {series.map((item, index) => (
              <Line
                key={item.key}
                type="linear"
                dataKey={item.key}
                name={item.label ?? item.key}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                strokeDasharray={index === 1 ? '6 3' : undefined}
                dot={{ r: 4, fill: colors[index % colors.length] }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={series.map((item, index) => ({ label: item.label ?? item.key, color: colors[index % colors.length], dashed: index === 1 }))} />
      <p className="chart-note">Intervals are separate categories. Connecting marks compare their results; they do not represent a continuous annual trajectory.</p>
    </>
  );
}
