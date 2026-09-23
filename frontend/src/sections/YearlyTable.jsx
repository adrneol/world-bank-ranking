/**
 * India's yearly table: ONE ROW PER YEAR with all four metric groups.
 * Every value, YoY, rank and total is backend-calculated; this component only
 * renders what GET /api/india/gdp-ranking returns.
 */

import { Fragment } from 'react';
import { api } from '../api/client.js';
import { metricKeysForSubject, metricLabel, subjectLabel } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatRank, formatYoy } from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

function MetricCell({ cell }) {
  if (!cell || !cell.available) {
    return (
      <>
        <td className="num muted" title={cell?.reason ?? 'No data'}>
          —
        </td>
        <td className="num muted">—</td>
        <td className="num muted">—</td>
      </>
    );
  }
  const display = cell.indiaValueDisplay?.formatted ?? '—';
  return (
    <>
      <td className="num" title={cell.indiaValueRaw != null ? `Raw: ${cell.indiaValueRaw} ${cell.unit ?? ''}` : undefined}>
        {display}
      </td>
      <td className="num" title={cell.indiaYoYReason ?? undefined}>
        {formatYoy(cell.indiaYoY, cell.indiaYoYDisplay)}
      </td>
      <td className="num">{formatRank(cell.indiaRank, cell.total)}</td>
    </>
  );
}

export default function YearlyTable({ startYear, endYear, subject = 'gdp_per_capita' }) {
  const keys = metricKeysForSubject(subject);
  const depsKey = `yearly:${startYear ?? ''}:${endYear ?? ''}:${subject}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.indiaRanking({ startYear, endYear, subject }, { signal }),
    depsKey,
    { enabled: startYear != null && endYear != null },
  );

  const rows = data?.rows ?? [];
  const empty = !loading && !error && rows.length === 0;

  return (
    <Section
      id="yearly"
      title="India yearly data"
      subtitle="One row per year. Values, YoY changes, ranks and totals are calculated by the backend from World Bank observations."
    >
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="yearly data" />
      {!loading && !error && rows.length > 0 ? (
        <div className="table-scroll" role="region" aria-label="India yearly data table" tabIndex={0}>
          <table className="table table-yearly">
            <caption className="sr-only">
              India {subjectLabel(subject)} by year for all four World Bank indicators
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky-col">
                  Year
                </th>
                {keys.map((key) => (
                  <th scope="colgroup" colSpan={3} key={key} className="metric-group">
                    {metricLabel(key)}
                  </th>
                ))}
              </tr>
              <tr>
                <th scope="col" className="sticky-col" aria-label="Year" />
                {keys.map((key) => (
                  <Fragment key={key}>
                    <th scope="col" className="num">
                      Value
                    </th>
                    <th scope="col" className="num">
                      YoY
                    </th>
                    <th scope="col" className="num">
                      Rank
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <th scope="row" className="sticky-col">
                    {row.year}
                  </th>
                  {keys.map((key) => (
                    <MetricCell key={key} cell={row[key]} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!loading && !error && rows.length > 0 ? (
        <p className="footnote">
          Ranks read as “position among eligible countries with a valid observation for that year and indicator” — not
          “out of all countries in the world”. Hover a value for its full raw precision.
        </p>
      ) : null}
    </Section>
  );
}
