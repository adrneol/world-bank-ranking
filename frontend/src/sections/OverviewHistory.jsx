import { useId, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal } from '../utils/format.js';
import { compareCurrencySymbol } from '../utils/compareFormat.js';
import { ChartDataFallback, StatusBlock } from '../components/ui.jsx';
import { SearchableSelect } from '../components/controls.jsx';
import ChartCard from '../components/charts/ChartCard.jsx';
import { AnnualRangeControl, ChartTypeToggle, HistoryWindowControls } from '../components/charts/ChartControls.jsx';
import AnnualSeriesMarker from '../components/charts/AnnualSeriesMarker.jsx';
import { recentWindow } from '../components/charts/chartData.js';
import UnifiedAnnualPlot from '../components/charts/UnifiedAnnualPlot.jsx';
import { subjectLabel } from '../config/metrics.js';
import { historySeries, relatedHistorySeries, REAL_GROWTH_ID } from './overviewContext.js';

export default function OverviewHistory({ country, displayName, historyKey, availableYears, metricYears }) {
  const [selection, setSelection] = useState([]);
  const [windowChoice, setWindowChoice] = useState(null);
  const [chartType, setChartType] = useState('line');
  const [domainMode, setDomainMode] = useState('auto');
  const controlId = useId();
  const seriesControl = useRef(null);
  const primary = historySeries(historyKey);
  if (!primary) return null;
  const related = relatedHistorySeries(historyKey);
  const visible = [{ ...primary, primary: true }, ...related.filter(({ id }) => selection.includes(id))];
  const available = related.filter(({ id }) => !selection.includes(id));
  const years = [...new Set(visible.flatMap(({ metricKey }) => metricYears?.[metricKey] ?? availableYears))]
    .sort((a, b) => a - b);
  if (!years.length) return <p className="footnote">No stored history for this indicator.</p>;
  const defaultRange = recentWindow(years, 25);
  const range = windowChoice && years.includes(windowChoice.from) && years.includes(windowChoice.to)
    ? windowChoice : defaultRange;
  const ids = visible.map(({ id }) => id).sort();
  const requestKey = JSON.stringify([country, range, ids]);
  const remove = (id) => {
    seriesControl.current?.querySelector('button')?.focus({ preventScroll: true });
    setSelection(previous => previous.filter(value => value !== id));
  };
  const heading = subjectLabel(primary.subject);
  const period = range.from + '–' + range.to;

  return (
    <section className="overview-history" aria-label="Historical analysis">
      <ChartCard title={heading + ' · ' + primary.name} unit={primary.basis + ' · ' + period}
        summary={displayName + ' ' + heading + ', ' + primary.title + ', ' + period}>
        <div className="annual-toolbar">
          <HistoryWindowControls years={years} {...range} onChange={setWindowChoice}
            idPrefix={'history-year-' + controlId} reset={() => setWindowChoice(null)} />
          <ChartTypeToggle value={chartType} onChange={setChartType} />
          <AnnualRangeControl value={domainMode} onChange={setDomainMode} />
          {related.length ? (
            <div className="annual-series-menu" ref={seriesControl}>
              <SearchableSelect id={controlId + '-series'} ariaLabel="Add series" placeholder="Add series"
                options={available.length ? available.map(({ id, label, basis }) => ({ value: id, label, hint: basis })) :
                  [{ value: 'all', label: 'All series shown', disabled: true }]}
                onChange={id => setSelection(previous => [...previous, id])} />
            </div>
          ) : null}
        </div>
        <ul className="annual-legend" aria-label="Chart legend">
          {visible.map((item) => {
            const swatch = <AnnualSeriesMarker type={chartType} {...item} />;
            return <li key={item.id} title={item.basis}>
              {item.primary ? <strong>{swatch}{item.label} <small>Primary</small><span className="sr-only"> · {item.basis}</span></strong> :
                <button type="button" onClick={() => remove(item.id)} aria-label={'Remove ' + item.label + ' (' + item.basis + ')'}>
                  {swatch}{item.label}<span className="annual-legend-remove" aria-hidden="true">×</span>
                </button>}
            </li>;
          })}
        </ul>
        <div className="history-results">
          <HistoryResults key={requestKey} country={country} ids={ids} range={range} visible={visible} chartType={chartType} domainMode={domainMode} />
        </div>
      </ChartCard>
    </section>
  );
}

function HistoryResults({ country, ids, range, visible, chartType, domainMode }) {
  const { data, loading, error, retry } = useApi(
    (signal) => api.focusHistory({ country, series: ids, startYear: range.from, endYear: range.to }, { signal }),
    JSON.stringify([country, ids, range]),
  );
  if (!data || loading || error) return <StatusBlock loading={loading} error={error} empty={!loading && !error}
    onRetry={retry} sectionName="historical observations" />;

  const returned = new Map((data.series ?? []).map((item) => [item.id, item]));
  const years = Array.from({ length: range.to - range.from + 1 }, (_, index) => range.from + index);
  const series = visible.map((descriptor) => {
    const item = returned.get(descriptor.id);
    const byYear = new Map((item?.points ?? []).map((point) => [point.year, point]));
    const points = years.map((year) => byYear.get(year) ?? { year, value: null });
    return { ...descriptor, ...item, points, values: points.map(({ value }) => value) };
  });
  const levels = series.filter((item) => item.axis !== 'annual-percentage');
  const rates = series.filter((item) => item.axis === 'annual-percentage');
  const bases = new Set(levels.map((item) => item.basis));
  const regions = [];
  if (levels.length) {
    const currencies = new Set(levels.map(({ basis }) => compareCurrencySymbol(basis.replace(/ per person$/, '')) === 'Int$' ? 'Int$' : 'US$'));
    const mixedBasis = (levels[0].subject === 'gdp_per_capita' ? 'GDP per person' : 'GDP') + ' · ' + [...currencies].sort().reverse().join(' / ');
    regions.push({ id: 'levels', unit: bases.size > 1 ? mixedBasis : levels[0].basis,
      decimals: Math.max(...levels.map((item) => item.decimals)),
      series: levels.map((item) => ({ ...item, unit: item.basis })) });
  }
  if (rates.length) regions.push({ id: 'rates', unit: 'Annual %', decimals: 2, zeroLine: true,
    series: rates.map((item) => ({ ...item, unit: item.basis })) });
  return (
    <>
      <UnifiedAnnualPlot years={years} regions={regions} type={chartType} domainMode={domainMode} label="Scrollable chart plot" />
      {bases.size > 1 ? <p className="footnote">The left axis shows numerical magnitudes across valuation bases.
        Check each series’ valuation basis in the annual values table.</p> : null}
      {series.every((item) => item.values.every((value) => value == null)) ?
        <p className="footnote">No observations in the selected period.</p> : null}
      <div className="annual-evidence">
        <ChartDataFallback label="annual values" regionName="Annual history values"
          columns={[{ header: 'Year' }, ...series.map((item) => ({
            header: item.name, unit: item.derived ? item.basis + ' · derived' : item.basis, color: item.color,
          }))]}
          rows={years.map((year, index) => [String(year), ...series.map((item) => (
            <HistoryValue key={item.id} item={item} point={item.points[index]} />
          ))])} />
      </div>
      <details className="chart-data-fallback">
        <summary>Sources and methods</summary>
        <ul>{series.map((item) => (
          <li key={item.id}>{item.name} · {item.basis} · {item.indicatorCode}
            {item.method ? ' · ' + item.method : ' · World Bank WDI observation'}</li>
        ))}</ul>
        {ids.includes(REAL_GROWTH_ID) ? <p className="footnote">Real GDP growth is economic context, calculated by the
          application from consecutive constant-2015-US$ GDP observations. Price and growth series show descriptive associations.</p> : null}
      </details>
    </>
  );
}

function HistoryValue({ item, point }) {
  if (point.value == null) return <span aria-label={point.reason
    ? 'Missing observation: ' + point.reason.replaceAll('_', ' ') : 'Missing observation'}>—</span>;
  return (
    <details className="history-value">
      <summary>{point.display ?? formatDecimal(point.value, item.decimals)}</summary>
      <span>Exact value: {point.raw ?? String(point.value)}</span>
      <span>{item.derived ? 'Source indicator' : 'Indicator'}: {item.indicatorCode}</span>
      <span>WDI vintage: {point.vintage ?? 'unreported'}</span>
      {item.derived ? <span>Preceding year vintage: {point.previousVintage ?? 'unreported'}</span> : null}
    </details>
  );
}
