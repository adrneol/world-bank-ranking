/**
 * Application shell: header, global filter bar, section navigation and all
 * data sections. Filter state lives here (mirrored to the URL query string);
 * every section receives the active filter values as props, so displayed
 * results can never disagree with the visible filter labels.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api/client.js';
import { METRIC_KEYS, metricLabel, resolveMetricKey } from './config/metrics.js';
import { Field } from './components/ui.jsx';
import YearlyTable from './sections/YearlyTable.jsx';
import YearComparison from './sections/YearComparison.jsx';
import LevelVerification from './sections/LevelVerification.jsx';
import FullRanking from './sections/FullRanking.jsx';
import YoyRanking from './sections/YoyRanking.jsx';
import YoyVerification from './sections/YoyVerification.jsx';
import Coverage from './sections/Coverage.jsx';
import AuditSource from './sections/AuditSource.jsx';
import DataStatus from './sections/DataStatus.jsx';

const PARAMS = ['startYear', 'endYear', 'year', 'metric', 'neighbors', 'fromYear'];

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
    ...readUrlState(),
  }));

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
    return { startYear, endYear, year, metric, neighbors, fromYear };
  }, [filters, availableYears, maxYear, defaultStart]);

  // Mirror effective state to the URL (UI state only, never business logic).
  useEffect(() => {
    const query = new URLSearchParams();
    if (effective.startYear != null) query.set('startYear', effective.startYear);
    if (effective.endYear != null) query.set('endYear', effective.endYear);
    if (effective.year != null) query.set('year', effective.year);
    query.set('metric', effective.metric);
    query.set('neighbors', effective.neighbors);
    if (effective.fromYear != null) query.set('fromYear', effective.fromYear);
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

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to data
      </a>
      <header className="app-header">
        <div className="wrap">
          <p className="eyebrow">World Bank World Development Indicators</p>
          <h1>India GDP per capita ranking</h1>
          <p className="lede">
            Independently calculated ranks from World Bank observations. Rank calculated from World Bank WDI
            observations.
          </p>
          <nav className="section-nav" aria-label="Sections">
            {[
              ['yearly', 'Yearly data'],
              ['comparison', 'Year comparison'],
              ['verify', 'Verify rank'],
              ['full-ranking', 'Full ranking'],
              ['yoy-ranking', 'YoY ranking'],
              ['yoy-verify', 'Verify YoY'],
              ['coverage', 'Coverage'],
              ['audit', 'Audit'],
              ['data-status', 'Status'],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="wrap">
        <div className="filterbar" role="region" aria-label="Global filters">
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
              <YearOptions years={availableYears} id="f-start" label="Start year" value={effective.startYear} onChange={(v) => setFilter('startYear', v)} />
              <YearOptions years={availableYears} id="f-end" label="End year" value={effective.endYear} onChange={(v) => setFilter('endYear', v)} />
              <YearOptions years={availableYears} id="f-year" label="Selected year" value={effective.year} onChange={(v) => setFilter('year', v)} />
              <Field label="Metric" htmlFor="f-metric" hint="Yearly table and comparison always show all four.">
                <select id="f-metric" value={effective.metric} onChange={(e) => setFilter('metric', e.target.value)}>
                  {METRIC_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {metricLabel(key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Neighbors" htmlFor="f-neighbors" hint="0–50 rows above/below India.">
                <input
                  id="f-neighbors"
                  type="number"
                  min={0}
                  max={50}
                  value={effective.neighbors}
                  onChange={(e) => setFilter('neighbors', e.target.value)}
                />
              </Field>
              <Field label="Compare from year" htmlFor="f-from" hint="Empty hides the change explanation.">
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

        <main id="main" key={dataVersion}>
          {filtersReady ? (
            <>
              <YearlyTable startYear={effective.startYear} endYear={effective.endYear} />
              <YearComparison year={effective.year} />
              <LevelVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} />
              <FullRanking year={effective.year} metricKey={effective.metric} />
              <YoyRanking year={effective.year} metricKey={effective.metric} />
              <YoyVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} />
              <Coverage year={effective.year} metricKey={effective.metric} fromYear={effective.fromYear} toYear={effective.year} />
              <AuditSource year={effective.year} metricKey={effective.metric} />
              <DataStatus onRefreshed={handleRefreshed} />
            </>
          ) : null}
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
