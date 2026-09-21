/**
 * Data coverage: per-metric valid/missing counts, YoY pair counts, and the
 * backend's evidence-only changing-totals explanation (CASE A/B/C/D).
 * Explanations are displayed verbatim — never invented in the frontend.
 */

import { api } from '../api/client.js';
import { METRIC_KEYS, metricLabel } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { Section, StatusBlock } from '../components/ui.jsx';

export default function Coverage({ year, metricKey, fromYear, toYear }) {
  // The backend requires fromYear AND toYear together for an explanation;
  // omit both when no comparison year is selected.
  const compare = fromYear != null && toYear != null ? { fromYear, toYear } : {};
  const depsKey = `coverage:${year ?? ''}:${metricKey}:${fromYear ?? ''}:${toYear ?? ''}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.coverage({ year, ...compare, indicator: metricKey, country: 'IND' }, { signal }),
    depsKey,
    { enabled: year != null },
  );

  const metrics = data?.metrics ?? [];
  const yoyMetrics = data?.yoy?.metrics ?? [];
  const explanation = data?.explanation ?? null;
  const empty = !loading && !error && data && metrics.length === 0;

  return (
    <Section
      id="coverage"
      title="Data coverage"
      subtitle={`Eligible universe vs valid observations for ${year ?? '—'}. Denominators count eligible countries with a valid observation — not all countries in the world.`}
    >
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="coverage" />
      {!loading && !error && data ? (
        <>
          <div className="table-scroll" role="region" aria-label="Coverage by metric" tabIndex={0}>
            <table className="table">
              <caption className="sr-only">Coverage per metric for {year}</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">
                    Eligible universe
                  </th>
                  <th scope="col" className="num">
                    Valid
                  </th>
                  <th scope="col" className="num">
                    Missing
                  </th>
                  <th scope="col" className="num">
                    India rank
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.metric.key}>
                    <th scope="row">{metricLabel(m.metric.key)}</th>
                    <td className="num">{m.eligibleUniverse}</td>
                    <td className="num">{m.validObservations}</td>
                    <td className="num">{m.missingObservations}</td>
                    <td className="num">
                      {m.focus?.available ? `${m.focus.rank} / ${m.focus.total}` : <span className="muted">n/a</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="subhead">YoY coverage</h3>
          <div className="table-scroll" role="region" aria-label="YoY coverage by metric" tabIndex={0}>
            <table className="table">
              <caption className="sr-only">YoY coverage per metric for {year}</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">
                    Current valid
                  </th>
                  <th scope="col" className="num">
                    Previous valid
                  </th>
                  <th scope="col" className="num">
                    Valid YoY pairs
                  </th>
                  <th scope="col">India YoY calculable</th>
                </tr>
              </thead>
              <tbody>
                {yoyMetrics.map((m) => (
                  <tr key={m.metric.key}>
                    <th scope="row">{metricLabel(m.metric.key)}</th>
                    <td className="num">{m.currentValidObservations}</td>
                    <td className="num">{m.previousValidObservations}</td>
                    <td className="num">{m.validYoyPairs}</td>
                    <td>{m.focus?.yoyCalculable ? `Yes (${m.focus.yoyPercent?.toFixed?.(2) ?? ''}%)` : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {explanation ? (
            <div className="explanation" aria-live="polite">
              <h3 className="subhead">
                Why does the total change? {fromYear} → {toYear} · {metricLabel(metricKey)}
              </h3>
              <p>
                <strong>Case {explanation.case}:</strong> {explanation.caseMeaning}
              </p>
              <p>{explanation.statement}</p>
              {explanation.warnings?.length > 0 ? (
                <ul className="warnings">
                  {explanation.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="footnote">Tip: set a “compare from” year in the filter bar to explain a denominator change.</p>
          )}
          <p className="footnote">
            Known metrics: {METRIC_KEYS.map(metricLabel).join(' · ')}. Coverage can differ between metrics and years.
          </p>
        </>
      ) : null}
    </Section>
  );
}
