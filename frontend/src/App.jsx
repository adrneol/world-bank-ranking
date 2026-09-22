/**
 * Application shell: compact header, tab navigation, global filter bar and
 * one focused view at a time. Filter state lives here (mirrored to the URL
 * query string); every section receives the active filter values as props, so
 * displayed results can never disagree with the visible filter labels.
 *
 * Views lazy-mount: only the active tab fetches and renders. All data shown
 * is backend-calculated; this shell holds UI state only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api/client.js';
import { METRIC_KEYS, metricLabel, resolveMetricKey } from './config/metrics.js';
import { Field } from './components/ui.jsx';
import Tabs, { SubTabs } from './components/Tabs.jsx';
import Overview from './sections/Overview.jsx';
import YearlyTable from './sections/YearlyTable.jsx';
import YearComparison from './sections/YearComparison.jsx';
import RankMovement from './sections/RankMovement.jsx';
import LevelVerification from './sections/LevelVerification.jsx';
import FullRanking from './sections/FullRanking.jsx';
import YoyRanking from './sections/YoyRanking.jsx';
import YoyVerification from './sections/YoyVerification.jsx';
import Coverage from './sections/Coverage.jsx';
import AuditSource from './sections/AuditSource.jsx';
import DataStatus from './sections/DataStatus.jsx';

const PARAMS = ['startYear', 'endYear', 'year', 'metric', 'neighbors', 'fromYear', 'view', 'yearA', 'yearB', 'yearMid'];

function readUrlState() {
  const query = new URLSearchParams(window.location.search);
  const state = {};
  for (const key of PARAMS) {
    const value = query.get(key);
    if (value !== null && value !== '') state[key] = value;
  }
  return state;
}

function YearOptions({ years, id, value, onChange, label }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {(years ?? []).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </Field>
  );
}

const VIEWS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'data', label: 'Data' },
  { id: 'rank', label: 'Rank' },
  { id: 'movement', label: 'Movement' },
  { id: 'yoy', label: 'YoY' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'audit', label: 'Audit' },
  { id: 'status', label: 'Status' },
]);

function isViewId(value) {
  return VIEWS.some((v) => v.id === value);
}

const RANK_SUBS = Object.freeze([
  { id: 'verify', label: 'Verify India' },
  { id: 'table', label: 'Full table' },
]);

const YOY_SUBS = Object.freeze([
  { id: 'ranking', label: 'Ranking' },
  { id: 'verify', label: 'Verify India' },
]);

export default function App() {
  const [yearsData, setYearsData] = useState(null);
  const [yearsError, setYearsError] = useState(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  const [refreshNotice, setRefreshNotice] = useState(null);

  const [filters, setFilters] = useState(() => ({
    startYear: null,
    endYear: null,
    year: null,
    metric: 'nominal_current',
    neighbors: 5,
    fromYear: '',
    view: 'overview',
    ...readUrlState(),
  }));
  const [rankSub, setRankSub] = useState('verify');
  const [yoySub, setYoySub] = useState('ranking');

  // Load available years once (plus reload after a successful refresh).
  useEffect(() => {
    let cancelled = false;
    setYearsLoading(true);
    setYearsError(null);
    api
      .years()
      .then((result) => {
        if (cancelled) return;
        setYearsData(result);
        setYearsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setYearsError(error);
        setYearsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const availableYears = useMemo(() => yearsData?.years ?? [], [yearsData]);
  const minYear = yearsData?.minYear ?? null;
  const maxYear = yearsData?.maxYear ?? null;
  const defaultStart = yearsData?.defaults?.startYear ?? minYear;

  // Resolve effective filters against actually-available years.
  const effective = useMemo(() => {
    const pick = (value, fallback) => {
      const n = Number.parseInt(value, 10);
      if (Number.isInteger(n) && availableYears.includes(n)) return n;
      return fallback;
    };
    const endYear = pick(filters.endYear, maxYear);
    let startYear = pick(filters.startYear, defaultStart);
    if (startYear != null && endYear != null && startYear > endYear) startYear = endYear;
    const year = pick(filters.year, maxYear);
    const metric = resolveMetricKey(filters.metric) ?? 'nominal_current';
    const neighborsRaw = Number.parseInt(filters.neighbors, 10);
    const neighbors = Number.isInteger(neighborsRaw) ? Math.max(0, Math.min(50, neighborsRaw)) : 5;
    const fromYear = filters.fromYear !== '' && filters.fromYear != null ? pick(filters.fromYear, null) : null;
    const view = isViewId(filters.view) ? filters.view : 'overview';
    // Rank-movement years default to a decade-like pair when available,
    // otherwise the stored extremes. Never hardcoded to a fixed range.
    const defaultYearA = availableYears.includes(2004) ? 2004 : minYear;
    const defaultYearB = availableYears.includes(2014) ? 2014 : maxYear;
    const yearA = pick(filters.yearA, defaultYearA);
    const yearB = pick(filters.yearB, defaultYearB);
    // Optional point breaker: strictly between the two endpoints, else None.
    // Invalid states (equal to an endpoint, outside the interval, unknown year)
    // resolve to null so they are impossible to select or share via URL.
    let yearMid = null;
    if (yearA != null && yearB != null) {
      const rawMid = Number.parseInt(filters.yearMid, 10);
      if (Number.isInteger(rawMid) && availableYears.includes(rawMid)) {
        const lo = Math.min(yearA, yearB);
        const hi = Math.max(yearA, yearB);
        if (rawMid > lo && rawMid < hi) yearMid = rawMid;
      }
    }
    return { startYear, endYear, year, metric, neighbors, fromYear, view, yearA, yearB, yearMid };
  }, [filters, availableYears, maxYear, minYear, defaultStart]);

  // Mirror effective state to the URL (UI state only, never business logic).
  useEffect(() => {
    const query = new URLSearchParams();
    if (effective.startYear != null) query.set('startYear', effective.startYear);
    if (effective.endYear != null) query.set('endYear', effective.endYear);
    if (effective.year != null) query.set('year', effective.year);
    query.set('metric', effective.metric);
    query.set('neighbors', effective.neighbors);
    if (effective.fromYear != null) query.set('fromYear', effective.fromYear);
    if (effective.yearA != null) query.set('yearA', effective.yearA);
    if (effective.yearB != null) query.set('yearB', effective.yearB);
    if (effective.yearMid != null) query.set('yearMid', effective.yearMid);
    query.set('view', effective.view);
    const next = `?${query.toString()}`;
    if (window.location.search !== next) window.history.replaceState(null, '', next);
  }, [effective]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleRefreshed = useCallback((summary) => {
    // The notice lives here (above the remounted <main>) so it survives the
    // data remount. Re-derive years (a newer vintage may extend the range)
    // and remount all data sections so every table re-reads the backend.
    if (summary) {
      setRefreshNotice(
        `Refresh #${summary.runId} succeeded — ${summary.rowsUpserted} observations upserted (World Bank vintage ${summary.wbLastUpdated ?? 'unknown'}).`,
      );
    }
    setDataVersion((v) => v + 1);
  }, []);

  const filtersReady = !yearsLoading && !yearsError && availableYears.length > 0;
  const view = effective.view;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to data
      </a>
      <header className="app-header app-header-compact">
        <div className="wrap header-row">
          <div>
            <p className="eyebrow">World Bank WDI · India GDP per capita</p>
            <h1>
              India ranking{effective.year != null ? <span className="header-year"> — {effective.year}</span> : null}
            </h1>
          </div>
          <Tabs views={VIEWS} active={view} onChange={(v) => setFilter('view', v)} />
        </div>
      </header>

      <div className="wrap">
        <div className="filterbar filterbar-compact" role="region" aria-label="Global filters">
          {yearsLoading ? (
            <p className="status status-loading" role="status">
              Loading available years…
            </p>
          ) : null}
          {yearsError ? (
            <div className="status status-error" role="alert">
              <p>Could not load available years: {yearsError.message}</p>
              <button type="button" className="btn btn-secondary" onClick={() => setDataVersion((v) => v + 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {filtersReady ? (
            <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Data filters">
              <YearOptions years={availableYears} id="f-start" label="Period start" value={effective.startYear} onChange={(v) => setFilter('startYear', v)} />
              <YearOptions years={availableYears} id="f-end" label="Period end" value={effective.endYear} onChange={(v) => setFilter('endYear', v)} />
              <YearOptions years={availableYears} id="f-year" label="Year" value={effective.year} onChange={(v) => setFilter('year', v)} />
              <Field label="Metric" htmlFor="f-metric">
                <select id="f-metric" value={effective.metric} onChange={(e) => setFilter('metric', e.target.value)}>
                  {METRIC_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {metricLabel(key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Neighbors" htmlFor="f-neighbors">
                <input
                  id="f-neighbors"
                  type="number"
                  min={0}
                  max={50}
                  value={effective.neighbors}
                  onChange={(e) => setFilter('neighbors', e.target.value)}
                />
              </Field>
              <Field label="Compare from" htmlFor="f-from">
                <select id="f-from" value={effective.fromYear ?? ''} onChange={(e) => setFilter('fromYear', e.target.value)}>
                  <option value="">—</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </Field>
            </form>
          ) : null}
        </div>

        {refreshNotice ? (
          <p className="status status-ok" role="status">
            {refreshNotice}{' '}
            <button type="button" className="btn btn-ghost" onClick={() => setRefreshNotice(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <main id="main" key={`${dataVersion}:${view}`}>
          {filtersReady && view === 'overview' ? (
            <>
              <Overview year={effective.year} />
              <YearComparison year={effective.year} />
            </>
          ) : null}
          {filtersReady && view === 'data' ? (
            <YearlyTable startYear={effective.startYear} endYear={effective.endYear} />
          ) : null}
          {filtersReady && view === 'rank' ? (
            <div role="tabpanel" id="panel-rank" aria-labelledby="tab-rank">
              <SubTabs options={RANK_SUBS} active={rankSub} onChange={setRankSub} label="Rank workspace views" />
              {rankSub === 'verify' ? (
                <LevelVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} />
              ) : (
                <FullRanking year={effective.year} metricKey={effective.metric} />
              )}
            </div>
          ) : null}
          {filtersReady && view === 'movement' ? (
            <RankMovement
              availableYears={availableYears}
              yearA={effective.yearA}
              yearB={effective.yearB}
              yearMid={effective.yearMid}
              metricKey={effective.metric}
              onYearA={(v) => setFilter('yearA', v)}
              onYearB={(v) => setFilter('yearB', v)}
              onYearMid={(v) => setFilter('yearMid', v ?? '')}
              onMetric={(v) => setFilter('metric', v)}
            />
          ) : null}
          {filtersReady && view === 'yoy' ? (
            <div role="tabpanel" id="panel-yoy" aria-labelledby="tab-yoy">
              <p className="denominators">
                YoY ranking orders countries by <strong>percentage change</strong>, not GDP-per-capita level.
              </p>
              <SubTabs options={YOY_SUBS} active={yoySub} onChange={setYoySub} label="YoY workspace views" />
              {yoySub === 'ranking' ? (
                <YoyRanking year={effective.year} metricKey={effective.metric} />
              ) : (
                <YoyVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} />
              )}
            </div>
          ) : null}
          {filtersReady && view === 'coverage' ? (
            <Coverage year={effective.year} metricKey={effective.metric} fromYear={effective.fromYear} toYear={effective.year} />
          ) : null}
          {filtersReady && view === 'audit' ? (
            <AuditSource year={effective.year} metricKey={effective.metric} />
          ) : null}
          {filtersReady && view === 'status' ? <DataStatus onRefreshed={handleRefreshed} /> : null}
        </main>

        <footer className="app-footer">
          <p>
            Source data: World Bank World Development Indicators. All ranks shown here are calculated by this
            application — the World Bank does not publish them.
          </p>
        </footer>
      </div>
    </div>
  );
}
