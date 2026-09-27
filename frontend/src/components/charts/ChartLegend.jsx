/**
 * Shared HTML chart legend (Phase 2, issue R-05).
 *
 * The legend lives in normal document flow BELOW the Recharts plot shell —
 * never inside the SVG/ResponsiveContainer box — so wrapped legend content
 * grows the card instead of colliding with axes, ticks or the source line.
 * Items are presentation mirrors of backend-provided series (label text is
 * passed through verbatim); no economics, no recalculation.
 *
 * Each item: { label: string, color: string, dashed?: boolean }.
 * The swatch reuses the chart's own stroke color and dash pattern so the
 * second series stays distinguishable without color alone.
 */

export default function ChartLegend({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <ul className="chart-legend-html" aria-label="Chart legend">
      {items.map((item, index) => (
        <li key={`${item?.label ?? 'series'}-${index}`} className="chart-legend-item">
          <span
            className="chart-legend-swatch"
            aria-hidden="true"
            style={{
              borderTopColor: item?.color ?? '#101828',
              borderTopStyle: item?.dashed ? 'dashed' : 'solid',
            }}
          />
          <span>{item?.label ?? `Series ${index + 1}`}</span>
        </li>
      ))}
    </ul>
  );
}
