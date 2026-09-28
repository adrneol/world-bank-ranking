/**
 * Overview history chart with optional cross-metric context series.
 *
 * Presentation-only visualization enhancement: the primary series always
 * remains the selected Overview metric, and optional contextual series
 * (backend-provided values from the same country and year window) render
 * as additional overlay lines. Context series never affect ranking,
 * benchmarks, gaps, the selected basis, or the primary metric — they are
 * display-only companions on a shared annual-% axis.
 *
 * Data flow: existing GET /api/focus/yearly responses only. The primary
 * rows arrive as props (Overview's own history fetch); each context
 * subject is fetched with the same endpoint, country and window, enabled
 * only while its toggle is on — so OFF renders zero extra requests and
 * the identical primary graph as before this feature.
 *
 * Toggle state lives in this component, which Overview keys by
 * country:subject:metric — switching family/metric remounts it, so stale
 * context can never leak across views.
 */

import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import ChartCard from '../components/charts/ChartCard.jsx';
import TimeSeriesChart from '../components/charts/TimeSeriesChart.jsx';
import { metricDecimals } from '../config/metrics.js';
import { formatDecimal } from '../utils/format.js';
import { ChartDataFallback } from '../components/ui.jsx';
import {
  CONTEXT_FIELD,
  CONTEXT_METRIC_KEY,
  CONTEXT_SERIES,
  clampToWindow,
  contextOptionsFor,
  primaryWindow,
  valuePoints,
} from './overviewContext.js';

function ContextControl({ options, selected, onToggle }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="context-series">
      <legend>Context series</legend>
      {options.map((id) => (
        <label key={id} className="context-toggle">
          <input
            type="checkbox"
            checked={selected.includes(id)}
            onChange={() => onToggle(id)}
            aria-label={`Show ${CONTEXT_SERIES[id].label} alongside the selected metric`}
          />
          <span>{CONTEXT_SERIES[id].label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function OverviewHistory({
  country,
  displayName,
  historyKey,
  historyMeta,
  historyRows,
  windowStart,
  windowEnd,
  summary,
}) {
  const options = contextOptionsFor(historyKey);
  const [selected, setSelected] = useState([]);
  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  const active = options.filter((id) => selected.includes(id));

  // Context subject fetches: same endpoint/country/window as the primary
  // history, enabled only while a context from that subject is selected.
  const needsPrices = active.some((id) => id !== 'realGdpGrowth');
  const needsGrowth = active.includes('realGdpGrowth');
  const windowValid = windowStart != null && windowEnd != null && windowStart <= windowEnd;
  const prices = useApi(
    (signal) => api.focusYearly({ startYear: windowStart, endYear: windowEnd, subject: 'prices', country }, { signal }),
    `overview-ctx:prices:${country}:${windowStart ?? ''}:${windowEnd ?? ''}`,
    { enabled: needsPrices && windowValid },
  );
  const growth = useApi(
    (signal) => api.focusYearly({ startYear: windowStart, endYear: windowEnd, subject: 'gdp_total', country }, { signal }),
    `overview-ctx:gdp_total:${country}:${windowStart ?? ''}:${windowEnd ?? ''}`,
    { enabled: needsGrowth && windowValid },
  );
  const ctxLoading = (needsPrices && prices.loading) || (needsGrowth && growth.loading);
  const ctxError = (needsPrices && prices.error) || (needsGrowth && growth.error);

  const primaryTitle = historyMeta?.shortTitle ?? historyKey;
  const pricesRows = prices.data?.rows ?? [];
  const growthRows = growth.data?.rows ?? [];

  // Growth-mode primary (Total GDP with context): backend YoY of constant
  // GDP on the shared annual-% axis. OFF (no context) keeps the legacy
  // levels graph bit-for-bit below.
  const growthMode = historyKey === 'total_constant' && active.length > 0;
  const primaryPoints = growthMode
    ? valuePoints(historyRows, 'total_constant', 'indiaYoY')
    : (historyRows ?? []).map((r) => ({ x: r.year, y: r[historyKey]?.indiaValue ?? null }));
  const window = primaryWindow(primaryPoints);

  const contextPoints = (id) => {
    const rows = id === 'realGdpGrowth' ? growthRows : pricesRows;
    return clampToWindow(valuePoints(rows, CONTEXT_METRIC_KEY[id], CONTEXT_FIELD[id]), window?.lo, window?.hi);
  };

  let title;
  let unit;
  let decimals;
  let series;
  if (!growthMode && active.length === 0) {
    // Legacy OFF state: identical primary graph as before this feature.
    title = `${primaryTitle} — history`;
    unit = historyMeta?.unitLong ?? historyMeta?.unit;
    decimals = metricDecimals(historyKey);
    series = [{ label: displayName, points: primaryPoints }];
  } else if (historyKey === 'total_constant') {
    const withLabels = active.map((id) => CONTEXT_SERIES[id].label);
    title = `Real GDP growth with ${withLabels.join(' and ')} — annual %`;
    unit = 'annual %';
    decimals = 2;
    series = [
      { label: CONTEXT_SERIES.realGdpGrowth.label, points: primaryPoints },
      ...active.map((id) => ({ label: CONTEXT_SERIES[id].label, points: contextPoints(id) })),
    ];
  } else {
    title = `${primaryTitle} with real GDP growth — annual %`;
    unit = 'annual %';
    decimals = 2;
    series = [
      { label: displayName, points: primaryPoints },
      { label: CONTEXT_SERIES.realGdpGrowth.label, points: contextPoints('realGdpGrowth') },
    ];
  }

  // Accessible data table mirrors the plotted series with backend display
  // strings (never recomputed here). Legacy OFF state reproduces the
  // previous table exactly: formatted display values, '—' fallback via
  // formatDecimal of the raw value.
  const historyByYear = new Map((historyRows ?? []).map((r) => [r?.year, r]));
  const pricesByYear = new Map(pricesRows.map((r) => [r?.year, r]));
  const growthByYear = new Map(growthRows.map((r) => [r?.year, r]));
  const formatLevelCell = (row, metricKey) => {
    const cell = row?.[metricKey];
    return cell?.indiaValueDisplay?.formatted ?? formatDecimal(cell?.indiaValue, metricDecimals(metricKey));
  };
  const formatGrowthCell = (row) => {
    const cell = row?.total_constant;
    if (cell?.indiaYoYDisplay) return cell.indiaYoYDisplay;
    const y = cell?.indiaYoY;
    return Number.isFinite(y) ? `${y > 0 ? '+' : ''}${Number(y).toFixed(2)}%` : '—';
  };
  let tableColumns;
  let tableRows;
  if (!growthMode && active.length === 0) {
    tableColumns = [{ header: 'Year' }, { header: primaryTitle }];
    tableRows = (historyRows ?? []).map((r) => [String(r.year), formatLevelCell(r, historyKey)]);
  } else {
    const yearSet = new Set(series.flatMap((s) => s.points.map((p) => p.x)));
    const tableYears = [...yearSet].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const columnFor = (label) => {
      if (label === CONTEXT_SERIES.realGdpGrowth.label) {
        return (year) => {
          const row = growthMode ? historyByYear.get(year) : growthByYear.get(year);
          return formatGrowthCell(row);
        };
      }
      if (label === CONTEXT_SERIES.cpiInflation.label) {
        return (year) => formatLevelCell(pricesByYear.get(year), 'inflation_cpi');
      }
      if (label === CONTEXT_SERIES.gdpDeflatorInflation.label) {
        return (year) => formatLevelCell(pricesByYear.get(year), 'inflation_deflator');
      }
      return (year) => formatLevelCell(historyByYear.get(year), historyKey);
    };
    tableColumns = [{ header: 'Year' }, ...series.map((s) => ({ header: s.label }))];
    const formatters = series.map((s) => columnFor(s.label));
    tableRows = tableYears.map((year) => [String(year), ...formatters.map((f) => f(year))]);
  }

  return (
    <>
      <ContextControl options={options} selected={selected} onToggle={toggle} />
      {ctxLoading ? (
        <p className="status status-loading" role="status">
          Loading context series…
        </p>
      ) : null}
      {ctxError ? (
        <p className="status status-error" role="alert">
          Context series could not be loaded — showing the selected metric only.
        </p>
      ) : null}
      <ChartCard title={title} unit={unit} summary={summary} derived={growthMode || active.length > 0}>
        <TimeSeriesChart series={series} unit={unit} decimals={decimals} zeroLine={growthMode || active.length > 0} />
      </ChartCard>
      {growthMode || active.length > 0 ? (
        <p className="footnote">
          Context series are shown alongside the selected metric for visual comparison on the same annual percentage
          scale; they are not combined into a single calculation. {displayName} real GDP growth is constant-price GDP
          year-over-year change from backend observations — descriptive overlay only, no causality is implied.
        </p>
      ) : null}
      <ChartDataFallback
        label="annual values"
        regionName="Annual history values"
        columns={tableColumns}
        rows={tableRows}
      />
    </>
  );
}
