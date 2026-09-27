/**
 * Chart figure wrapper: one title, one unit, one source line, one
 * accessible name. Every analytical chart renders inside this so
 * methodology can never be visually separated from the visual.
 *
 * Layout contract (Phase 2 R-05): header → plot shell → HTML legend →
 * source footer are separate normal-flow regions. Chart components render
 * their own explicit-height .chart-plot plus a ChartLegend as children;
 * this shell never fixes the total card height, so wrapped legends and
 * multi-line sources grow the card instead of overlapping the plot.
 */

import { ProvenanceBadge } from '../ui.jsx';

export default function ChartCard({ title, unit = null, source = 'World Bank WDI', derived = false, summary = null, children }) {
  return (
    <figure className="chart-card" aria-label={summary ?? title}>
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        {unit ? <span className="chart-unit">{unit}</span> : null}
        {derived ? <ProvenanceBadge kind="APP_DERIVED" /> : null}
      </figcaption>
      <div className="chart-body">{children}</div>
      <p className="chart-source">Source: {source}</p>
    </figure>
  );
}
