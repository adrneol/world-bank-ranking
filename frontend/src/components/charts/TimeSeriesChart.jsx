/**
 * Annual time-series line chart (genuine multi-year histories only).
 *
 * Consumes backend/API points verbatim ({ x: year, y: value|null }).
 * Missing years are absent from the data or null, so with
 * connectNulls={false} the line breaks instead of bridging or zeroing.
 * Never used for two-point comparisons (see SlopeChart).
 */

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { alignSeries } from './chartData.js';
import { CHART_COLORS, CHART_HEIGHT } from './chartTheme.js';
import { formatChartValue, formatTickValue } from './chartFormat.js';

const STROKES = [CHART_COLORS.primary, CHART_COLORS.secondary];
const DASHES = [undefined, '6 3'];

// Recharts entrance animation is disabled on every Line below
// (isAnimationActive={false}): the app's motion policy allows no more than
// subtle fades, prefers-reduced-motion must be trivially honored, and
// analytical charts must render deterministically.

export default function TimeSeriesChart({ series = [], unit = null, decimals = 0, zeroLine = false, height = CHART_HEIGHT }) {
  const { keys, rows, labels } = alignSeries(series);
  if (rows.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="x"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickCount={Math.min(8, rows.length)}
          tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
          tickFormatter={(x) => String(x)}
        />
        <YAxis
          width={64}
          tick={{ fontSize: 11, fill: CHART_COLORS.muted }}
          tickFormatter={(v) => formatTickValue(v, decimals)}
          domain={['auto', 'auto']}
          label={unit ? { value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: CHART_COLORS.muted } : undefined}
        />
        <Tooltip
          formatter={(value, name) => [formatChartValue(value, decimals), name]}
          labelFormatter={(x) => `Year ${x}`}
          contentStyle={{ fontSize: 12 }}
        />
        {labels.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {zeroLine ? <ReferenceLine y={0} stroke={CHART_COLORS.zero} strokeDasharray="4 3" /> : null}
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={labels[i] || `Series ${i + 1}`}
            stroke={STROKES[i % STROKES.length]}
            strokeWidth={2}
            strokeDasharray={DASHES[i % DASHES.length]}
            dot={{ r: 2, fill: STROKES[i % STROKES.length] }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
