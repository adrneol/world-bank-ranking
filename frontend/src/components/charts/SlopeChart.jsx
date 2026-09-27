/**
 * Two-endpoint slope chart (endpoint comparisons only — never a trend).
 *
 * Each item draws one segment from its start value to its end value
 * (per-entity endpoint levels, or per-entity ranks). Change magnitudes
 * shown alongside come from backend responses, never recomputed here.
 * For rank movement pass invertY so rank #1 renders at the top.
 *
 * Layout contract (Phase 2 R-05): explicit-height plot shell
 * (.chart-plot, CSS-driven so media queries apply) containing the Recharts
 * plot ONLY, followed by an HTML ChartLegend in normal flow. Endpoint axis
 * labels stay inside the plot margins; the legend wraps below on narrow
 * screens instead of clipping. Line geometry and rank direction are
 * unchanged (backend ranks pass through verbatim).
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_COLORS, yAxisWidthFor } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';
import ChartLegend from './ChartLegend.jsx';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';

const STROKES = [CHART_COLORS.primary, CHART_COLORS.secondary];
const DASHES = [undefined, '6 3'];

export default function SlopeChart({ items = [], startLabel = 'A', endLabel = 'B', unit = null, decimals = 0, invertY = false, height = null }) {
  const narrow = useIsNarrowChart();
  const rows = [{ x: startLabel }, { x: endLabel }];
  const keys = items.map((_, i) => `s${i}`);
  items.forEach((item, i) => {
    rows[0][keys[i]] = item?.start ?? null;
    rows[1][keys[i]] = item?.end ?? null;
  });
  if (items.length === 0) return null;
  const legendItems =
    items.length > 1
      ? items.map((item, i) => ({
          label: item?.label ?? `Series ${i + 1}`,
          color: STROKES[i % STROKES.length],
          dashed: DASHES[i % DASHES.length] !== undefined,
        }))
      : null;
  return (
    <>
      <div className="chart-plot" style={Number.isFinite(height) ? { height } : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="x" tick={{ fontSize: 12, fill: CHART_COLORS.primary }} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
            <YAxis
              width={yAxisWidthFor(unit, narrow)}
              tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
              tickFormatter={(v) => formatTickValue(v, decimals)}
              domain={['auto', 'auto']}
              reversed={invertY}
              label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
            />
            <Tooltip
              formatter={(value, name) => [formatChartValue(value, decimals), name]}
              contentStyle={{ fontSize: 12 }}
            />
            {keys.map((key, i) => (
              <Line
                key={key}
                type="linear"
                dataKey={key}
                name={items[i]?.label ?? `Series ${i + 1}`}
                stroke={STROKES[i % STROKES.length]}
                strokeWidth={2.5}
                strokeDasharray={DASHES[i % DASHES.length]}
                dot={{ r: 4, fill: STROKES[i % STROKES.length] }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={legendItems} />
    </>
  );
}
