import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useRef, useState } from 'react';
import { chartTooltipStyle, CHART_COLORS, yAxisWidthFor } from './chartTheme.js';
import { formatAnnualReadout, formatTickValue } from './chartFormat.js';
import ChartLegend from './ChartLegend.jsx';
import { useIsNarrowChart } from '../../hooks/useMediaQuery.js';

/** Point view for categorical interval results. Uses the line renderer without connecting categories. */
export default function IntervalLineChart({ entries = [], series = [], unit = null, decimals = 0, formatTooltip = null }) {
  const narrow = useIsNarrowChart();
  const chart = useRef(null);
  const [dismissed, setDismissed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const inspectionKey = JSON.stringify([entries, series, unit]);
  useEffect(() => {
    const outside = event => {
      if (!event.composedPath?.().includes(chart.current) && !chart.current?.contains(event.target)) {
        setDismissed(true); setPinned(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => { setDismissed(true); setPinned(false); }, [inspectionKey]);
  const dismiss = () => {
    setDismissed(true);
    setPinned(false);
    chart.current?.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  };
  if (entries.length === 0) return null;
  const colors = [CHART_COLORS.primary, CHART_COLORS.secondary];
  return (
    <>
      <div ref={chart} className="chart-plot"
        onClick={event => { if (!event.target.closest('button')) { setDismissed(false); setPinned(true); } }}
        onPointerMove={event => { if (event.pointerType === 'mouse' && !pinned && !event.target.closest('button')) setDismissed(false); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse' && !pinned) setDismissed(true); }}
        onKeyDown={event => { if (event.key === 'Escape') { setDismissed(true); setPinned(false); } else if (event.key.startsWith('Arrow')) setDismissed(false); }}>
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
              trigger={pinned ? 'click' : 'hover'}
              active={dismissed ? false : undefined}
              wrapperStyle={{ pointerEvents: 'auto' }}
              content={({ active, label, payload }) => active && payload?.length ? <div className="period-tooltip" style={chartTooltipStyle}>
                <strong>{label}</strong><button type="button" aria-label="Close chart values" onClick={dismiss}>×</button>
                <dl>{payload.map(item => <div key={item.dataKey}><dt>{item.name}</dt><dd>{formatTooltip ? formatTooltip(item.value) : formatAnnualReadout(item.value, unit, decimals)}</dd></div>)}</dl>
              </div> : null}
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
