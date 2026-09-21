/**
 * Selected-year four-metric comparison.
 * Reuses the yearly endpoint for a single year so the numbers are identical
 * to the yearly table. No combined/overall score is ever derived.
 */

import { api } from '../api/client.js';
import { METRIC_KEYS, METRICS } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatRank, formatYoy } from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

export default function YearComparison({ year }) {
  const depsKey = `compare:${year ?? ''}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.indiaRanking({ startYear: year, endYear: year }, { signal }),
    depsKey,
    { enabled: year != null },
  );

  const row = data?.rows?.[0] ?? null;
  const empty = !loading && !error && !row;

  return (
    <Section
      id="comparison"
      title={`Selected year: ${year ?? '—'}`}
      subtitle="One row per metric. Separate series with different units — never combined, never scored."
    >
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="year comparison" />
      {!loading && !error && row ? (
        <div className="table-scroll" role="region" aria-label="Four-metric comparison" tabIndex={0}>
          <table className="table">
            <caption className="sr-only">Four-metric comparison for {year}</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Indicator</th>
                <th scope="col" className="num">
                  Value
                </th>
                <th scope="col" className="num">
                  YoY
                </th>
                <th scope="col" className="num">
                  Rank
                </th>
              </tr>
            </thead>
            <tbody>
              {METRIC_KEYS.map((key) => {
                const cell = row[key];
                const meta = METRICS[key];
                return (
                  <tr key={key}>
                    <th scope="row">
                      {meta.shortTitle}
                      <span className="unit">{meta.unit}</span>
                    </th>
                    <td className="mono">{meta.indicatorCode}</td>
                    {!cell || !cell.available ? (
                      <td colSpan={3} className="muted">
                        No valid observation{cell?.reason ? ` (${cell.reason.replace(/_/g, ' ')})` : ''}
                      </td>
                    ) : (
                      <>
                        <td className="num" title={cell.indiaValueRaw != null ? `Raw: ${cell.indiaValueRaw}` : undefined}>
                          {cell.indiaValueDisplay?.formatted ?? '—'}
                        </td>
                        <td className="num">{formatYoy(cell.indiaYoY, cell.indiaYoYDisplay)}</td>
                        <td className="num">{formatRank(cell.indiaRank, cell.total)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Section>
  );
}
