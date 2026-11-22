import { useResearchPreference } from '../../hooks/researchPreferences.js';
import { alignSeries, annualSeries, scaleDetailFor } from './chartData.js';
import { AnnualRangeControl, ChartTypeToggle, SegmentedControl } from './ChartControls.jsx';
import AnnualSeriesMarker from './AnnualSeriesMarker.jsx';
import BarComparisonChart from './BarComparisonChart.jsx';
import UnifiedAnnualPlot from './UnifiedAnnualPlot.jsx';
import { seriesColor } from './annualGeometry.js';
import { isPercentageUnit } from './chartFormat.js';
import { ChartDataFallback } from '../ui.jsx';

export default function AnnualChart({
  series, unit, decimals, zeroLine = false, chartType, onChartType, initialType = 'line',
  showTypeControl = true,
}) {
  const scope=`annual:${unit}:${(series??[]).map(item=>item.label).join('|')}`;
  const [choice, setChoice] = useResearchPreference(scope+':type',initialType);
  const [scaleChoice, setScaleChoice] = useResearchPreference(scope+':scale','linear');
  const [domainMode, setDomainMode] = useResearchPreference(scope+':axes','auto');
  const type = chartType ?? choice;
  const aligned = alignSeries(series);
  const years = aligned.rows.map((row) => row.x);
  const percentage = isPercentageUnit(unit);
  const plotSeries = aligned.keys.map((key, index) => ({
    id: series[index].id ?? key, label: aligned.labels[index], primary: index === 0,
    color: seriesColor(index), colorIndex: index, percentage, values: aligned.rows.map((row) => row[key]),
  }));
  const region = { id: 'main', unit, decimals, zeroLine, series: plotSeries };
  const scaleDetail = scaleDetailFor(aligned.rows, aligned.keys);
  const supportedScale = scaleDetail === 'log' ? 'log' : scaleDetail === 'signed-detail' ? 'symlog' : null;
  const scale = type === 'line' && scaleChoice === supportedScale ? supportedScale : 'linear';
  return (
    <>
      <div className="annual-toolbar">
        {showTypeControl ? <ChartTypeToggle value={type} onChange={onChartType ?? setChoice} /> : null}
        <AnnualRangeControl value={domainMode} onChange={setDomainMode} />
      </div>
      {supportedScale && type === 'line' ? (
        <div className="history-scale"><span>Vertical scale</span>
          <SegmentedControl label="Vertical scale" value={scale} onChange={setScaleChoice}
            options={[[ 'linear', 'Linear' ], [supportedScale, supportedScale === 'log' ? 'Logarithmic' : 'Signed logarithmic']]} />
        </div>
      ) : null}
      {scale === 'log' ? <p className="chart-note">Logarithmic axis. Equal distances show equal ratios.</p> : null}
      {scale === 'symlog' ? <p className="chart-note">Signed logarithmic axis. Zero and both signs stay visible.
        The scale compresses large magnitudes. Tooltips and tables give the original amounts.</p> : null}
      {plotSeries.length > 1 ? <ul className="annual-legend" aria-label="Chart legend">
        {plotSeries.map((item) => <li key={item.id}><AnnualSeriesMarker type={type} {...item} />{item.label}</li>)}
      </ul> : null}
      <UnifiedAnnualPlot years={years} regions={[region]} type={type} scale={scale} domainMode={domainMode} label="Scrollable chart plot" />
      {(scaleDetail && scale === 'linear') ? (
        <details className="chart-scale-detail">
          <summary>Inspect values on a closer scale</summary>
          <p className="chart-note">The annual evidence table provides exact amounts. Use the scale control in Line mode when a logarithmic option is available.</p>
        </details>
      ) : null}
    </>
  );
}

/** Existing annual Movement charts reuse the same line/bar presentation. */
export function AnnualOrCategoricalChart({ entries, series, ...format }) {
  const years = entries.map((row) => String(row.x ?? row.name));
  if (years.length < 2 || years.some((year) => !/^\d{4}$/.test(year)) || new Set(years).size !== years.length) {
    return <>
      <BarComparisonChart entries={entries} series={series} {...format} />
      <ChartDataFallback label="plotted period values" className="period-chart-evidence" columns={[{ header: 'Period' }, ...(series?.length ? series : [{ key: 'value', label: 'Value' }]).map(item => ({ header: item.label, unit: format.unit }))]}
        rows={entries.map(row => [String(row.x ?? row.name), ...(series?.length ? series : [{ key: 'value' }]).map(item => row[item.key] == null ? '—' : String(row[item.key]))])} />
    </>;
  }
  const measures = series?.length ? series : [{ key: 'value', label: 'Value' }];
  const plots = annualSeries(entries, measures);
  return (
    <>
      <AnnualChart series={plots} initialType="bar" {...format} />
      <ChartDataFallback label="plotted annual values"
        columns={[{ header: 'Year' }, ...measures.map(({ label }) => ({ header: label, unit: format.unit }))]}
        rows={plots[0].points.map(({ x }, index) => [String(x),
          ...plots.map(({ points }) => points[index].y == null ? '—' : String(points[index].y))])} />
    </>
  );
}
