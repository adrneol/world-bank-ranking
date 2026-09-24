/**
 * Subject insight strips for the Overview workspace (Phase 6).
 *
 * GDP subjects need nothing beyond the generic cards, but rates, indexes
 * and quoted currencies have different mathematics — rendering them through
 * identical templates would mislead. Each panel pairs backend-provided
 * series only (yearly levels, YoY where declared, compare operations);
 * React aligns rows for display, it never derives economics.
 *
 * - Rates (CPI/deflator): annual levels + period percentage-point change
 *   (compare pp_change on the focus series) beside real GDP growth
 *   (constant-price GDP YoY). Descriptive association only — no causality.
 * - Index (CPI 2010=100): levels + period index-point change. Never "pp".
 * - Quoted FX: quotation convention made explicit (rise = depreciation),
 *   annual movement from the declared YoY, cross-rate handoff to Compare.
 */

import { api } from '../api/client.js';
import { metricCapabilities, metricLabel, metricTitle } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatYoy } from '../utils/format.js';
import { MethodologyPanel, ProvenanceBadge, UnavailableState } from '../components/ui.jsx';

function useYearly({ metricKey, country, startYear, endYear, subject }) {
  const depsKey = `insight:${metricKey}:${country}:${startYear ?? ''}:${endYear ?? ''}`;
  return useApi(
    (signal) => api.focusYearly({ startYear, endYear, subject, country }, { signal }),
    depsKey,
    { enabled: startYear != null && endYear != null && metricKey != null },
  );
}

function useSelfChange({ country, metricKey, operation, yearA, yearB }) {
  // Single-entity change analysis through the generic compare engine:
  // entityA and entityB are the same focus entity, so changeA is the
  // entity's own change and the gap is trivially zero (hidden). Fully
  // backend-calculated; no frontend derivation.
  const spec = `country:${country}`;
  const depsKey = `selfchange:${metricKey}:${country}:${operation}:${yearA ?? ''}:${yearB ?? ''}`;
  return useApi(
    (signal) =>
      api.compare({ entityA: spec, entityB: spec, indicator: metricKey, yearA, yearB, operation }, { signal }),
    depsKey,
    { enabled: yearA != null && yearB != null && yearA !== yearB && metricKey != null },
  );
}

function ChangeSummary({ change, unitNoun }) {
  if (!change) return null;
  if (!change.computable) {
    return <UnavailableState reason={change.reason} hint="The requested change is not defined for these values." />;
  }
  const sign = change.value > 0 ? '+' : '';
  return (
    <p className="result-value">
      {sign}
      {change.value.toFixed(2)} <span className="result-unit">{unitNoun}</span>
    </p>
  );
}

function RatePanel({ metricKey, country, focusName, startYear, endYear, realSubject }) {
  const rate = useYearly({ metricKey, country, startYear, endYear, subject: 'prices' });
  const real = useYearly({ metricKey: 'total_constant', country, startYear, endYear, subject: realSubject });
  const change = useSelfChange({ country, metricKey, operation: 'pp_change', yearA: startYear, yearB: endYear });

  const rateRows = new Map((rate.data?.rows ?? []).map((r) => [r.year, r[metricKey]]));
  const realRows = new Map((real.data?.rows ?? []).map((r) => [r.year, r.total_constant]));
  const years = [...new Set([...rateRows.keys(), ...realRows.keys()])].sort((a, b) => a - b);
  const title = metricTitle(metricKey);
  const loading = rate.loading || real.loading || change.loading;
  if (loading) return <p className="status status-loading" role="status">Loading inflation analysis…</p>;
  if (rate.error || real.error || change.error) {
    return <UnavailableState reason="inflation data could not be loaded" hint="Retry or pick another period." />;
  }
  const pp = change.data?.results?.comparison;
  return (
    <div className="insight" aria-label={`${title} and real GDP growth`}>
      <h3>
        {title} and real GDP growth <ProvenanceBadge kind="APP_DERIVED" />
      </h3>
      <p>
        {focusName} annual inflation beside annual real GDP growth (constant-price GDP year-over-year change).
        Read across a row for one year; read down a column for history.
      </p>
      <div className="table-scroll" role="region" aria-label="Inflation and real growth by year" tabIndex={0}>
        <table className="table table-compact">
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" className="num">
                {metricLabel(metricKey)} (%)
              </th>
              <th scope="col" className="num">
                Real GDP growth (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const cell = rateRows.get(year);
              const growth = realRows.get(year);
              return (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  <td className="num">{cell?.available ? cell.indiaValue.toFixed(2) : '—'}</td>
                  <td className="num">{growth?.available ? formatYoy(growth.indiaYoY, growth.indiaYoYDisplay) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        Change {startYear} → {endYear}:
      </p>
      <ChangeSummary change={pp?.a} unitNoun="percentage points" />
      <p className="footnote">
        Descriptive association only — inflation is not shown as a cause of growth. A fall from 6% to 3% reads as
        −3.0 percentage points, never −50%.
      </p>
      <MethodologyPanel
        indicatorCode={rate.data?.metricInfo?.[metricKey]?.indicatorCode}
        derived="Period change via generic compare (pp_change)"
        formula="B − A (percentage points)"
      />
    </div>
  );
}

function IndexPanel({ metricKey, country, focusName, startYear, endYear }) {
  const index = useYearly({ metricKey, country, startYear, endYear, subject: 'prices' });
  const change = useSelfChange({ country, metricKey, operation: 'index_point_change', yearA: startYear, yearB: endYear });
  const title = metricTitle(metricKey);
  if (index.loading || change.loading) return <p className="status status-loading" role="status">Loading index analysis…</p>;
  if (index.error || change.error) {
    return <UnavailableState reason="index data could not be loaded" hint="Retry or pick another period." />;
  }
  const rows = (index.data?.rows ?? []).filter((r) => r[metricKey]?.available);
  const pt = change.data?.results?.comparison;
  return (
    <div className="insight" aria-label={`${title} change`}>
      <h3>
        {title} <ProvenanceBadge kind="APP_DERIVED" />
      </h3>
      <p>
        {focusName} price level ({startYear} → {endYear}). Index movement reads in index points — never percentage
        points, never a cross-country cost-of-living rank.
      </p>
      <ChangeSummary change={pt?.a} unitNoun="index points" />
      {rows.length > 0 ? (
        <div className="table-scroll" role="region" aria-label="Index by year" tabIndex={0}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  Index (2010 = 100)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <th scope="row">{r.year}</th>
                  <td className="num">{r[metricKey].indiaValue.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <MethodologyPanel
        indicatorCode={index.data?.metricInfo?.[metricKey]?.indicatorCode}
        derived="Period change via generic compare (index_point_change)"
        formula="B − A (index points)"
      />
    </div>
  );
}

function FxPanel({ metricKey, country, focusName, startYear, endYear, onCompareEntities }) {
  const fx = useYearly({ metricKey, country, startYear, endYear, subject: 'exchange' });
  const title = metricTitle(metricKey);
  if (fx.loading) return <p className="status status-loading" role="status">Loading exchange-rate analysis…</p>;
  if (fx.error) {
    return <UnavailableState reason="exchange-rate data could not be loaded" hint="Retry or pick another period." />;
  }
  const rows = (fx.data?.rows ?? []).filter((r) => r[metricKey]?.available);
  const latest = rows[rows.length - 1]?.[metricKey] ?? null;
  return (
    <div className="insight" aria-label={`${title} movement`}>
      <h3>{title}</h3>
      <p>
        Quoted as <strong>local currency units per US$</strong>: a rise means {focusName}&rsquo;s currency{' '}
        <strong>depreciated</strong> against the dollar; a fall means it <strong>appreciated</strong>. Raw levels
        are never ranked across currencies.
      </p>
      {latest ? (
        <p className="result-value">
          {latest.indiaValueDisplay?.formatted ?? latest.indiaValue}{' '}
          <span className="result-unit">per US$ · {latest.indiaYoYDisplay ?? formatYoy(latest.indiaYoY, null)} YoY</span>
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="table-scroll" role="region" aria-label="Quoted rate by year" tabIndex={0}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  LCU per US$
                </th>
                <th scope="col" className="num">
                  Annual movement
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <th scope="row">{r.year}</th>
                  <td className="num">{r[metricKey].indiaValue.toFixed(2)}</td>
                  <td className="num">{formatYoy(r[metricKey].indiaYoY, r[metricKey].indiaYoYDisplay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onCompareEntities?.({ kind: 'country', iso3: country }, { kind: 'country', iso3: 'DEU' }, metricKey)}
        >
          Open cross-rate in Compare
        </button>
      </p>
      <MethodologyPanel
        indicatorCode={fx.data?.metricInfo?.[metricKey]?.indicatorCode}
        derived="Annual movement via declared YoY; cross-rates via generic compare (cross_rate)"
        formula="Movement: ((B / A) − 1) × 100 · Cross: A_per_USD / B_per_USD"
      />
    </div>
  );
}

export default function SubjectInsight({ metricKey, country, focusName, year, availableYears, realSubject = 'gdp_total', onCompareEntities }) {
  const caps = metricCapabilities(metricKey);
  const endYear = year;
  const startYear =
    endYear != null && Array.isArray(availableYears) && availableYears.length > 0
      ? Math.max(Math.min(...availableYears), endYear - 5)
      : endYear != null
        ? endYear - 5
        : null;
  if (!caps) return null;
  if (caps.observationType === 'RATE') {
    return <RatePanel metricKey={metricKey} country={country} focusName={focusName} startYear={startYear} endYear={endYear} realSubject={realSubject} />;
  }
  if (caps.observationType === 'INDEX') {
    return <IndexPanel metricKey={metricKey} country={country} focusName={focusName} startYear={startYear} endYear={endYear} />;
  }
  if (caps.observationType === 'QUOTED_RATE') {
    return <FxPanel metricKey={metricKey} country={country} focusName={focusName} startYear={startYear} endYear={endYear} onCompareEntities={onCompareEntities} />;
  }
  return null;
}
