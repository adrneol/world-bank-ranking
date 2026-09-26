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
import {
  COMPARE_OPERATIONS,
  SUBJECTS,
  hydrateRegistry,
  metricKeysForSubject,
  resolveMetricKey,
  subjectLabel,
  subjectOf,
} from './config/metrics.js';
import { entityToSpec } from './components/entities.js';
import MetricPicker from './components/MetricPicker.jsx';
import { SearchableSelect } from './components/controls.jsx';
import { Field } from './components/ui.jsx';
import FocusPicker from './components/FocusPicker.jsx';
import Tabs, { SubTabs } from './components/Tabs.jsx';
import Compare from './sections/Compare.jsx';
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

const PARAMS = ['startYear', 'endYear', 'year', 'metric', 'neighbors', 'fromYear', 'view', 'yearA', 'yearB', 'yearMid', 'basis', 'country', 'cmpEntityA', 'cmpEntityB', 'cmpLabelA', 'cmpLabelB', 'cmpMetric', 'cmpYearA', 'cmpYearB', 'cmpOp', 'cmpMode'];

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
    <SearchableSelect
      id={id}
      label={label}
      value={value != null ? String(value) : ''}
      placeholder="Select year…"
      options={(years ?? []).map((y) => ({ value: String(y), label: String(y) }))}
      onChange={(v) => onChange(v === '' ? '' : Number(v))}
    />
  );
}

function YearOrEmpty({ years, id, value, onChange, label, emptyLabel = '—' }) {
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value ?? ''}
      placeholder={emptyLabel}
      options={[{ value: '', label: emptyLabel }, ...((years ?? []).map((y) => ({ value: String(y), label: String(y) })))]}
      onChange={(v) => onChange(v === '' ? '' : Number(v))}
    />
  );
}

const VIEWS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'data', label: 'Data' },
  { id: 'rank', label: 'Rank' },
  { id: 'movement', label: 'Movement' },
  { id: 'yoy', label: 'YoY' },
  { id: 'compare', label: 'Compare' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'audit', label: 'Audit' },
  { id: 'status', label: 'Status' },
]);

function isViewId(value) {
  return VIEWS.some((v) => v.id === value);
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
    view: 'overview',
    country: 'IND',
    cmpEntityA: '',
    cmpEntityB: '',
    cmpLabelA: '',
    cmpLabelB: '',
    cmpMetric: 'total_current',
    cmpYearA: null,
    cmpYearB: null,
    cmpOp: 'level',
    cmpMode: 'observed',
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

  // Eligible countries for the focus picker (backend metadata is the
  // authority for names; the picker lists countries only — no aggregates,
  // regions or custom groups until Phase 4).
  const [countriesData, setCountriesData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api
      .countries({ includeAggregates: false })
      .then((result) => {
        if (cancelled) return;
        setCountriesData(result);
      })
      .catch(() => {
        if (cancelled) return;
        setCountriesData({ countries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  // Metric/subject discovery (Phase 5): the backend /api/indicators catalog
  // is authoritative for which metrics and subjects exist. Hydration swaps
  // the display registry; failure keeps the static fallback (fail-safe).
  // A registry version bump re-renders every section through the same state.
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .indicators()
      .then((result) => {
        if (cancelled) return;
        if (hydrateRegistry(result)) setRegistryVersion((v) => v + 1);
      })
      .catch(() => {
        // Static fallback stays active; views keep working with GDP metrics.
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const eligibleCountries = useMemo(() => countriesData?.countries ?? [], [countriesData]);
  const availableYears = useMemo(() => yearsData?.years ?? [], [yearsData]);
  const minYear = yearsData?.minYear ?? null;
  const maxYear = yearsData?.maxYear ?? null;
  const defaultStart = yearsData?.defaults?.startYear ?? minYear;

  // Resolve effective filters against actually-available years.
  const effective = useMemo(() => {
    // Metric/subject resolution reads the module-level display registry,
    // which hydrateRegistry() swaps when /api/indicators loads: reference
    // the version so filters re-resolve against backend metadata.
    void registryVersion;
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
    // Optional middle year: strictly between the two endpoints, else None.
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
    // Rank-movement analysis basis: generic level/growth/period for GDP
    // and flows; canonical Prices bases (2+3+3 metric-specific) for Prices.
    // Unknown values fall back to level; unsupported combinations fail
    // closed at the backend with a reason instead of wrong numbers.
    const PRICES_BASIS_IDS = [
      'cpi_index_annual', 'cpi_index_period_change',
      'cpi_inflation_annual', 'cpi_inflation_average', 'cpi_inflation_cumulative',
      'deflator_annual', 'deflator_average', 'deflator_cumulative',
    ];
    const TRADE_BASIS_IDS = [
      'exp_annual_value', 'exp_period_cagr', 'exp_period_total', 'exp_period_average',
      'imp_annual_value', 'imp_period_cagr', 'imp_period_total', 'imp_period_average',
    ];
    const CAPITAL_BASIS_IDS = [
      'fdi_annual_value', 'fdi_period_cumulative', 'fdi_period_average',
      'fdigdp_annual_value', 'fdigdp_period_average', 'fdigdp_period_cumulative_share',
    ];
    const FX_BASIS_IDS = ['fx_annual_rate', 'fx_annual_change', 'fx_period_change'];
    const EXTERNAL_BASIS_IDS = [
      'ca_annual_gdp', 'ca_average_gdp', 'ca_cumulative_share',
      'res_annual_stock', 'res_period_change', 'res_import_coverage',
      'remit_annual_value', 'remit_period_cumulative', 'remit_period_average', 'remit_cumulative_intensity',
    ];
    const POPULATION_BASIS_IDS = ['pop_annual_value', 'pop_period_change', 'pop_period_growth'];
    const basis = ['growth', 'period_total', 'period_average', ...PRICES_BASIS_IDS, ...TRADE_BASIS_IDS, ...CAPITAL_BASIS_IDS, ...FX_BASIS_IDS, ...EXTERNAL_BASIS_IDS, ...POPULATION_BASIS_IDS].includes(filters.basis)
      ? filters.basis
      : 'level';
    // Focus country (Phase 1: generic focus abstraction, IND default).
    // Omitted/invalid URL values resolve to IND; only a valid explicit ISO3
    // selects another country. The display name comes from backend metadata.
    const rawCountry = String(filters.country ?? 'IND').trim().toUpperCase();
    const country = /^[A-Z]{3}$/.test(rawCountry) ? rawCountry : 'IND';
    const focusName =
      eligibleCountries.find((c) => c.iso3 === country)?.name ?? (country === 'IND' ? 'India' : country);
    // The analysis subject is derived from the metric key (single source of
    // truth): nominal_* metrics imply GDP per capita, total_* imply Total GDP.
    const subject = subjectOf(metric);
    // Compare workspace state (single source of truth, URL-shareable).
    // Entity specs are validated strictly by the backend; here they only
    // need to be non-empty, with focus/country-aware defaults.
    const cmpEntityA = filters.cmpEntityA != null && String(filters.cmpEntityA).trim() !== '' ? String(filters.cmpEntityA).trim() : `country:${country}`;
    const defaultB = `country:${country === 'USA' ? 'CHN' : 'USA'}`;
    const cmpEntityB = filters.cmpEntityB != null && String(filters.cmpEntityB).trim() !== '' ? String(filters.cmpEntityB).trim() : defaultB;
    const cmpLabelA = filters.cmpLabelA != null ? String(filters.cmpLabelA) : '';
    const cmpLabelB = filters.cmpLabelB != null ? String(filters.cmpLabelB) : '';
    const cmpMetric = resolveMetricKey(filters.cmpMetric) ?? 'total_current';
    const cmpYearB = pick(filters.cmpYearB, maxYear);
    const cmpDecade = maxYear != null && availableYears.includes(maxYear - 10) ? maxYear - 10 : minYear;
    const cmpYearA = pick(filters.cmpYearA, cmpDecade);
    const cmpOp = COMPARE_OPERATIONS.some((op) => op.id === filters.cmpOp) ? filters.cmpOp : 'level';
    const cmpMode = filters.cmpMode === 'like_for_like' ? 'like_for_like' : 'observed';
    return { startYear, endYear, year, metric, subject, neighbors, fromYear, view, yearA, yearB, yearMid, basis, country, focusName, cmpEntityA, cmpEntityB, cmpLabelA, cmpLabelB, cmpMetric, cmpYearA, cmpYearB, cmpOp, cmpMode };
  }, [filters, availableYears, maxYear, minYear, defaultStart, eligibleCountries, registryVersion]);

  const rankSubs = useMemo(
    () => [
      { id: 'verify', label: `Verify ${effective.focusName}` },
      { id: 'table', label: 'Full table' },
    ],
    [effective.focusName],
  );
  const yoySubs = useMemo(
    () => [
      { id: 'ranking', label: 'Ranking' },
      { id: 'verify', label: `Verify ${effective.focusName}` },
    ],
    [effective.focusName],
  );

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
    if (effective.basis !== 'level') query.set('basis', effective.basis);
    // Country is addressable but omitted for the IND default, so existing
    // India links keep working unchanged and stay clean.
    if (effective.country !== 'IND') query.set('country', effective.country);
    query.set('view', effective.view);
    if (effective.view === 'compare') {
      query.set('cmpEntityA', effective.cmpEntityA);
      query.set('cmpEntityB', effective.cmpEntityB);
      if (effective.cmpLabelA !== '') query.set('cmpLabelA', effective.cmpLabelA);
      if (effective.cmpLabelB !== '') query.set('cmpLabelB', effective.cmpLabelB);
      query.set('cmpMetric', effective.cmpMetric);
      if (effective.cmpYearA != null) query.set('cmpYearA', effective.cmpYearA);
      if (effective.cmpYearB != null) query.set('cmpYearB', effective.cmpYearB);
      query.set('cmpOp', effective.cmpOp);
      if (effective.cmpMode !== 'observed') query.set('cmpMode', effective.cmpMode);
    }
    const next = `?${query.toString()}`;
    if (window.location.search !== next) window.history.replaceState(null, '', next);
  }, [effective]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Deep link from subject views (e.g. FX cross-rate): prefill the Compare
  // builder with two entities and a metric, then switch to the workspace.
  const openCompareWith = useCallback((entityAObj, entityBObj, metric) => {
    setFilters((prev) => ({
      ...prev,
      cmpEntityA: entityToSpec(entityAObj) || prev.cmpEntityA,
      cmpEntityB: entityToSpec(entityBObj) || prev.cmpEntityB,
      cmpLabelA: entityAObj?.kind === 'custom_group' ? (entityAObj.label ?? '') : '',
      cmpLabelB: entityBObj?.kind === 'custom_group' ? (entityBObj.label ?? '') : '',
      ...(metric ? { cmpMetric: metric } : {}),
      view: 'compare',
    }));
  }, []);

  const handleRefreshed = useCallback((summary) => {
    // The notice lives here (above the remounted <main>) so it survives the
    // data remount. Re-derive years (a newer vintage may extend the range)
    // and remount all data sections so every table re-reads the backend.
    if (summary) {
      // A partial refresh publishes nothing: report staged counts only on
      // success, and say explicitly that the previous dataset remains active.
      setRefreshNotice(
        summary.status === 'partial'
          ? `Refresh #${summary.runId} partially completed — some indicators failed, so nothing was published. The previous dataset remains active.`
          : `Refresh #${summary.runId} succeeded — ${summary.rowsUpserted} observations upserted (World Bank vintage ${summary.wbLastUpdated ?? 'unknown'}).`,
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
          <div className="brand-row">
            <img
              src="/world-data-rankings-icon.png"
              alt="World Data Rankings"
              className="brand-icon"
              width="56"
              height="56"
            />
            <div>
              <p className="eyebrow">World Bank WDI · {effective.focusName} {subjectLabel(effective.subject)}</p>
              <h1>
                {effective.focusName} ranking{effective.year != null ? <span className="header-year"> — {effective.year}</span> : null}
              </h1>
            </div>
          </div>
          <Tabs views={VIEWS} active={view} onChange={(v) => setFilter('view', v)} />
        </div>
      </header>

      <div className="wrap">
        {/*
          The Movement and Status views are not shown the global filter bar:
          Movement consumes none of Period start / Period end / Year /
          Neighbors / Compare from (its Metric comes from its own comparison
          controls bound to the same filter state), and Status
          (DataStatus, refresh-only) consumes none of them either. Hiding
          only the rendering — the shared filter state stays intact for the
          views that use it. Loading/error notices still render everywhere.
        */}
        {yearsLoading || yearsError ? (
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
          </div>
        ) : null}
        {filtersReady && view !== 'movement' && view !== 'status' && view !== 'compare' ? (
          <div className="filterbar filterbar-compact" role="region" aria-label="Global filters">
            <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Data filters">
              {/*
                Period start / Period end are relevant only to the Data tab
                (yearly table over a range). Every other tab works from a
                single selected Year, so rendering them there only confuses.
                Presentation-only: the shared filter state, URL parameters,
                backend requests and analytical results are unchanged — the
                controls are simply not rendered outside Data.
              */}
              {view === 'data' ? (
                <>
                  <YearOptions years={availableYears} id="f-start" label="Period start" value={effective.startYear} onChange={(v) => setFilter('startYear', v)} />
                  <YearOptions years={availableYears} id="f-end" label="Period end" value={effective.endYear} onChange={(v) => setFilter('endYear', v)} />
                </>
              ) : null}
              <FocusPicker
                countries={eligibleCountries}
                value={effective.country}
                onChange={(v) => setFilter('country', v)}
              />
              <YearOptions years={availableYears} id="f-year" label="Year" value={effective.year} onChange={(v) => setFilter('year', v)} />
              <SearchableSelect
                id="f-subject"
                label="Analysis"
                value={effective.subject}
                options={Object.values(SUBJECTS).map((subject) => ({ value: subject.key, label: subject.label }))}
                onChange={(nextSubject) => {
                  const next = metricKeysForSubject(nextSubject);
                  // The metric key is the single state: switching analysis
                  // selects that subject's first metric (or keeps the
                  // current one when it already belongs to the subject).
                  setFilter('metric', next.includes(effective.metric) ? effective.metric : next[0]);
                }}
              />
              <MetricPicker
                id="f-metric"
                label="Metric"
                value={effective.metric}
                onChange={(v) => setFilter('metric', v)}
              />
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
              <YearOrEmpty years={availableYears} id="f-from" label="Compare from" value={effective.fromYear ?? ''} onChange={(v) => setFilter('fromYear', v)} />
            </form>
          </div>
        ) : null}

        {refreshNotice ? (
          <p className="status status-ok" role="status">
            {refreshNotice}{' '}
            <button type="button" className="btn btn-ghost" onClick={() => setRefreshNotice(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <main id="main" key={`${dataVersion}:${view}:${effective.country}`}>
          {filtersReady && view === 'overview' ? (
            <>
              <Overview year={effective.year} subject={effective.subject} metricKey={effective.metric} country={effective.country} focusName={effective.focusName} availableYears={availableYears} onCompareEntities={openCompareWith} />
              <YearComparison year={effective.year} subject={effective.subject} country={effective.country} />
            </>
          ) : null}
          {filtersReady && view === 'data' ? (
            <YearlyTable startYear={effective.startYear} endYear={effective.endYear} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
          ) : null}
          {filtersReady && view === 'rank' ? (
            <div role="tabpanel" id="panel-rank" aria-labelledby="tab-rank">
              <SubTabs options={rankSubs} active={rankSub} onChange={setRankSub} label="Rank workspace views" />
              {rankSub === 'verify' ? (
                <LevelVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} country={effective.country} focusName={effective.focusName} />
              ) : (
                <FullRanking year={effective.year} metricKey={effective.metric} country={effective.country} />
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
              basis={effective.basis}
              country={effective.country}
              countries={eligibleCountries}
              focusName={effective.focusName}
              onYearA={(v) => setFilter('yearA', v)}
              onYearB={(v) => setFilter('yearB', v)}
              onYearMid={(v) => setFilter('yearMid', v ?? '')}
              onMetric={(v) => setFilter('metric', v)}
              onBasis={(v) => setFilter('basis', v)}
              onCountry={(v) => setFilter('country', v)}
            />
          ) : null}
          {filtersReady && view === 'yoy' ? (
            <div role="tabpanel" id="panel-yoy" aria-labelledby="tab-yoy">
              <p className="denominators">
                YoY ranking orders countries by <strong>percentage change</strong>, not {subjectLabel(effective.subject)} level.
              </p>
              <SubTabs options={yoySubs} active={yoySub} onChange={setYoySub} label="YoY workspace views" />
              {yoySub === 'ranking' ? (
                <YoyRanking year={effective.year} metricKey={effective.metric} country={effective.country} focusName={effective.focusName} />
              ) : (
                <YoyVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} country={effective.country} focusName={effective.focusName} />
              )}
            </div>
          ) : null}
          {filtersReady && view === 'compare' ? (
            <Compare
              availableYears={availableYears}
              countries={eligibleCountries}
              entityA={effective.cmpEntityA}
              entityB={effective.cmpEntityB}
              labelA={effective.cmpLabelA}
              labelB={effective.cmpLabelB}
              metricKey={effective.cmpMetric}
              yearA={effective.cmpYearA}
              yearB={effective.cmpYearB}
              operation={effective.cmpOp}
              groupMode={effective.cmpMode}
              onEntityA={(v) => setFilter('cmpEntityA', v)}
              onEntityB={(v) => setFilter('cmpEntityB', v)}
              onLabelA={(v) => setFilter('cmpLabelA', v)}
              onLabelB={(v) => setFilter('cmpLabelB', v)}
              onMetric={(v) => setFilter('cmpMetric', v)}
              onYearA={(v) => setFilter('cmpYearA', v)}
              onYearB={(v) => setFilter('cmpYearB', v)}
              onOperation={(v) => setFilter('cmpOp', v)}
              onGroupMode={(v) => setFilter('cmpMode', v)}
            />
          ) : null}
          {filtersReady && view === 'coverage' ? (
            <Coverage year={effective.year} metricKey={effective.metric} fromYear={effective.fromYear} toYear={effective.year} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
          ) : null}
          {filtersReady && view === 'audit' ? (
            <AuditSource year={effective.year} metricKey={effective.metric} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
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
