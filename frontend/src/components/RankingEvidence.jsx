import { AnalyticalTable } from './AnalyticalTable.jsx';

export function RankingTable({ label, children }) {
  return <AnalyticalTable label={label} className="ranking-evidence" freezeYear={false}>{children}</AnalyticalTable>;
}

export function RankedObservation({ display, exact }) {
  if (exact == null) return display ?? '—';
  if (display == null || String(display) === String(exact)) return exact;
  return <details className="rank-observation">
    <summary>{display}</summary>
    <span>Exact observation <span className="mono">{exact}</span></span>
  </details>;
}

export function RankingSummary({ country, rank, denominator, denominatorLabel, value, previous, current }) {
  return <dl className="ranking-summary">
    <div><dt>{country || 'Selected economy'}</dt><dd>{value ?? 'Unavailable'}</dd></div>
    <div><dt>Position</dt><dd>{rank != null ? `#${rank}` : '—'}</dd></div>
    <div><dt>{denominatorLabel}</dt><dd>{denominator ?? '—'}</dd></div>
    {previous != null ? <div><dt>Previous observation</dt><dd>{previous}</dd></div> : null}
    {current != null ? <div><dt>Current observation</dt><dd>{current}</dd></div> : null}
  </dl>;
}
