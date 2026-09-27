/**
 * Overview: the default first screen.
 *
 * Answers "What is the focus country's position for the selected year?" with
 * one compact card per metric of the active subject — one per World Bank
 * indicator. All numbers come from a single GET /api/focus/yearly call for
 * the selected year; cards never combine the independent series.
 */

import { api } from '../api/client.js';
import ChartCard from '../components/charts/ChartCard.jsx';
import TimeSeriesChart from '../components/charts/TimeSeriesChart.jsx';
import { METRICS, metricDecimals, metricKeysForSubject, subjectLabel } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal, formatRank, formatYoy } from '../utils/format.js';
import { ChartDataFallback, StatusBlock } from '../components/ui.jsx';
import SubjectInsight from './SubjectInsight.jsx';

export default function Overview({ year, subject = 'gdp_per_capita', metricKey = null, country = 'IND', focusName = 'India', availableYears = [], onCompareEntities = null }) {
  const keys = metricKeysForSubject(subject);
  const depsKey = `overview:${year ?? ''}:${subject}:${country}`;
  const { data, loading, error, retry } = useApi(
    (signal) => api.focusYearly({ startYear: year, endYear: year, subject, country }, { signal }),
    depsKey,
    { enabled: year != null },
  );

  const row = data?.rows?.[0] ?? null;
  const empty = !loading && !error && !row;
  const displayName = data?.focus?.name ?? focusName;
  // History line for the primary metric over all stored years (existing
  // focus/yearly range — raw annual values verbatim, gaps stay gaps).
  const historyKey = metricKey ?? keys[0];
  const historyYears = [...(availableYears ?? [])].sort((a, b) => a - b);
  const histDepsKey = `overview-hist:${historyKey}:${subject}:${country}:${historyYears[0] ?? ''}:${historyYears[historyYears.length - 1] ?? ''}`;
  const hist = useApi(
    (signal) =>
      api.focusYearly(
        { startYear: historyYears[0], endYear: historyYears[historyYears.length - 1], subject, country },
        { signal },
      ),
    histDepsKey,
    { enabled: historyYears.length > 1 && historyKey != null },
  );
  const historyMeta = METRICS[historyKey];
  const historyPoints = (hist.data?.rows ?? []).map((r) => ({ x: r.year, y: r[historyKey]?.indiaValue ?? null }));
  const historyHasData = historyPoints.some((p) => Number.isFinite(p.y));
  const historySummary = `Annual ${historyMeta?.shortTitle ?? historyKey} for ${displayName}, ${historyYears[0] ?? '—'} to ${historyYears[historyYears.length - 1] ?? '—'}`;

  return (
    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="overview" />
      {!loading && !error && row ? (
        <>
          <h2 className="overview-year">
            {displayName} — {row.year}
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
            Rank calculated from World Bank WDI observations. The {keys.length} {subjectLabel(subject)} series use different
            units and are never combined or scored against each other.
          </p>
          {historyHasData ? (
            <>
              <ChartCard
                title={`${historyMeta?.shortTitle ?? historyKey} — history`}
                unit={historyMeta?.unitLong ?? historyMeta?.unit}
                summary={historySummary}
              >
                <TimeSeriesChart
                  series={[{ label: displayName, points: historyPoints }]}
                  unit={historyMeta?.unitLong ?? historyMeta?.unit}
                  decimals={metricDecimals(historyKey)}
                />
              </ChartCard>
              <ChartDataFallback
                label="annual values"
                regionName="Annual history values"
                columns={[{ header: 'Year' }, { header: historyMeta?.shortTitle ?? historyKey }]}
                rows={(hist.data?.rows ?? []).map((r) => [
                  String(r.year),
                  r[historyKey]?.indiaValueDisplay?.formatted ??
                    formatDecimal(r[historyKey]?.indiaValue, metricDecimals(historyKey)),
                ])}
              />
            </>
          ) : null}
          <SubjectInsight
            metricKey={metricKey ?? keys[0]}
            country={country}
            focusName={displayName}
            year={row.year}
            availableYears={availableYears}
            onCompareEntities={onCompareEntities}
          />
        </>
      ) : null}
    </div>
  );
}
