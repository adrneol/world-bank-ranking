/**
 * Overview: the default first screen.
 *
 * Answers "What is India's position for the selected year?" with four compact
 * cards — one per World Bank indicator. All numbers come from a single
 * GET /api/india/gdp-ranking call for the selected year; cards never combine
 * the four independent series.
 */

import { api } from '../api/client.js';
import { METRICS, metricKeysForSubject, subjectLabel } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatRank, formatYoy } from '../utils/format.js';
import { StatusBlock } from '../components/ui.jsx';

export default function Overview({ year, subject = 'gdp_per_capita' }) {
  const keys = metricKeysForSubject(subject);
  const depsKey = `overview:${year ?? ''}:${subject}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.indiaRanking({ startYear: year, endYear: year, subject }, { signal }),
    depsKey,
    { enabled: year != null },
  );

  const row = data?.rows?.[0] ?? null;
  const empty = !loading && !error && !row;

  return (
    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="overview" />
      {!loading && !error && row ? (
        <>
          <h2 className="overview-year">
            India — {row.year}
            <span className="overview-context">
              {data.eligibleUniverse} eligible economies in universe · ranks among valid observations only
            </span>
          </h2>
          <div className="cards">
            {keys.map((key) => {
              const meta = METRICS[key];
              const cell = row[key];
              return (
                <article key={key} className="card" aria-label={meta.title}>
                  <h3>{meta.shortTitle}</h3>
                  <p className="card-unit">{meta.unit}</p>
                  {!cell || !cell.available ? (
                    <p className="muted">No valid observation{cell?.reason ? ` (${cell.reason.replace(/_/g, ' ')})` : ''}</p>
                  ) : (
                    <>
                      <p className="card-value" title={cell.indiaValueRaw != null ? `Raw: ${cell.indiaValueRaw}` : undefined}>
                        {cell.indiaValueDisplay?.formatted ?? '—'}
                      </p>
                      <p className="card-rank">{formatRank(cell.indiaRank, cell.total)}</p>
                      <p className="card-yoy">{formatYoy(cell.indiaYoY, cell.indiaYoYDisplay)} YoY</p>
                    </>
                  )}
                  <p className="mono card-code">{meta.indicatorCode}</p>
                </article>
              );
            })}
          </div>
          <p className="footnote">
            Rank calculated from World Bank WDI observations. The four {subjectLabel(subject)} series use different
            units and are never combined or scored against each other.
          </p>
        </>
      ) : null}
    </div>
  );
}
