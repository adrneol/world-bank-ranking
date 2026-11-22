/**
 * Application shell: compact header, tab navigation, global filter bar and
 * one focused view at a time. Filter state lives here (mirrored to the URL
 * query string); every section receives the active filter values as props, so
 * displayed results can never disagree with the visible filter labels.
 *
 * Views lazy-mount: only the active tab fetches and renders. All data shown
 * is backend-calculated; this shell holds UI state only.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/client.js';
import { fingerprintOf, isNewerGeneration } from './utils/refreshGeneration.js';
import {
  COMPARE_OPERATIONS,
  METRIC_FAMILIES,
  SUBJECTS,
  hydrateRegistry,
  metricKeysForSubject,
  resolveMetricKey,
  subjectOf,
} from './config/metrics.js';
import { entityToSpec } from './components/entities.js';
import MetricPicker from './components/MetricPicker.jsx';
import { SearchableSelect } from './components/controls.jsx';
import { Field } from './components/ui.jsx';
import FocusPicker from './components/FocusPicker.jsx';
import Tabs, { SubTabs } from './components/Tabs.jsx';
import NavDrawer, { NavDrawerTrigger } from './components/NavDrawer.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import MouseScrollSupport from './components/MouseScrollSupport.jsx';
import { BootstrapError, BootstrapStillConnecting, BootstrapWarmup } from './components/BootstrapStatus.jsx';
import { siteMetadata } from './config/site.js';
import { pagePath, publicPages, viewAtPath } from './config/publicPages.js';
import { usePublicApiAvailability } from './hooks/usePublicApiAvailability.js';
import { useEconomyInitialization } from './hooks/useEconomyInitialization.js';
import { useYearAvailability } from './hooks/useYearAvailability.js';
import { ResearchPreferences } from './hooks/researchPreferences.jsx';
import { automaticYear, latestPeriod, selectedPeriod, selectedYear } from './utils/yearSelection.js';
import { getHeaderContext } from './utils/headerContext.js';
import Home from './sections/Home.jsx';
import About from './sections/About.jsx';
import Methodology from './sections/Methodology.jsx';
const Compare = lazy(() => import('./sections/Compare.jsx'));
const Overview = lazy(() => import('./sections/Overview.jsx'));
const YearlyTable = lazy(() => import('./sections/YearlyTable.jsx'));
const YearComparison = lazy(() => import('./sections/YearComparison.jsx'));
const RankMovement = lazy(() => import('./sections/RankMovement.jsx'));
const LevelVerification = lazy(() => import('./sections/LevelVerification.jsx'));
const FullRanking = lazy(() => import('./sections/FullRanking.jsx'));
const YoyRanking = lazy(() => import('./sections/YoyRanking.jsx'));
const YoyVerification = lazy(() => import('./sections/YoyVerification.jsx'));
const Coverage = lazy(() => import('./sections/Coverage.jsx'));
const AuditSource = lazy(() => import('./sections/AuditSource.jsx'));
const DataStatus = lazy(() => import('./sections/DataStatus.jsx'));

const PARAMS = ['startYear', 'endYear', 'year', 'metric', 'neighbors', 'fromYear', 'view', 'yearA', 'yearB', 'yearMid', 'basis', 'country', 'cmpEntityA', 'cmpEntityB', 'cmpLabelA', 'cmpLabelB', 'cmpAnalysis', 'cmpMetric', 'cmpBasis', 'cmpYearA', 'cmpYearB', 'cmpYearC', 'cmpOp', 'cmpMode', 'rankSub', 'yoySub'];

function readUrlState() {
  const query = new URLSearchParams(window.location.search);
  const state = {};
  for (const key of PARAMS) {
    const value = query.get(key);
    if (value !== null && value !== '') state[key] = value;
  }
  return state;
}

// Rank/YoY workspace sub-tabs are URL state (shareable, reload-stable).
// Unknown values fall back to the existing defaults.
function readRankSub() {
  const value = new URLSearchParams(window.location.search).get('rankSub');
  return value === 'verify' ? 'verify' : 'table';
}

function readYoySub() {
  const value = new URLSearchParams(window.location.search).get('yoySub');
  return value === 'verify' ? 'verify' : 'ranking';
}

// Primary navigation dimensions: changes to these push a browser history
// entry; all other filter tweaks replace the current entry in place.
function navKey(effective, rankSub, yoySub) {
  return [
    effective.view,
    effective.country,
    effective.metric,
    rankSub,
    yoySub,
    effective.cmpEntityA,
    effective.cmpEntityB,
    effective.cmpAnalysis,
    effective.cmpMetric,
  ].join('|');
}

// Canonical initial filter state: product defaults overlaid once with the
// URL at startup. popstate restores use the same constructor so an omitted
// parameter (e.g. an unselected country) resets to its default
// instead of leaking the previous state's value.
function defaultFilters() {
  const url = readUrlState();
  return {
    startYear: null,
    endYear: null,
    year: null,
    metric: 'nominal_current',
    neighbors: 5,
    fromYear: '',
    view: viewAtPath(window.location.pathname),
    country: '',
    cmpEntityA: '',
    cmpEntityB: '',
    cmpLabelA: '',
    cmpLabelB: '',
    cmpMetric: 'total_current',
    cmpBasis: 'level',
    cmpYearA: null,
    cmpYearC: null,
    cmpOp: 'level',
    cmpMode: 'observed',
    ...url,
    countrySource: String(url.country ?? '').trim() ? 'explicit' : 'unset',
  };
}

function YearOptions({ years = [], id, value, onChange, label, allowLatest = false, automatic = false, latestYear = years.at(-1) }) {
  const options=(years??[]).map(y=>({value:String(y),label:String(y)}));
  if (value != null && !years.includes(value)) options.unshift({value:String(value),label:`${value} · unavailable`});
  if (allowLatest) options.unshift({value:'latest',label:`Latest available${latestYear != null ? ' · '+latestYear : ''}`});
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={allowLatest && automatic ? 'latest' : value != null ? String(value) : ''}
      placeholder="Select year…"
      options={options}
      onChange={v=>onChange(v==='latest'?'latest':v===''?'':Number(v))}
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

// Global header identity: thin presentational wrapper over the
// view-aware header-context resolver (no business logic here).
function HeaderIdentity({ view, country, focusName, year, yearA, yearB }) {
  const { primary, secondary } = getHeaderContext({ view, country, focusName, year, yearA, yearB });
  return (
    <div>
      <p className="eyebrow">{primary}</p>
      <h1>{secondary}</h1>
    </div>
  );
}

// Header tabs: informational pages always visible. The nine analytical
// workspaces live in the NavDrawer (same view ids, same setFilter routing).
const INFO_VIEWS = Object.freeze([
  { id: 'home', label: 'Home' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'about', label: 'About' },
]);

const ANALYTICAL_VIEWS = Object.freeze([
  { id: 'overview', label: 'Overview', hint: 'Focus-country cards and history' },
  { id: 'data', label: 'Data', hint: 'Yearly tables over a range' },
  { id: 'rank', label: 'Rank', hint: 'Verify rank and full table' },
  { id: 'movement', label: 'Movement', hint: 'Rank and value movement' },
  { id: 'yoy', label: 'YoY', hint: 'Year-over-year ranking' },
  { id: 'compare', label: 'Compare', hint: 'Entity comparison workspace' },
  { id: 'coverage', label: 'Coverage', hint: 'Data coverage and denominators' },
  { id: 'audit', label: 'Audit', hint: 'Source verification' },
  { id: 'status', label: 'Status', hint: 'Data status and refresh' },
]);

function isViewId(value) {
  return (
    INFO_VIEWS.some((v) => v.id === value) || ANALYTICAL_VIEWS.some((v) => v.id === value)
  );
}

function isAnalyticalView(value) {
  return ANALYTICAL_VIEWS.some((v) => v.id === value);
}

const CONNECTION_HINT_SECONDS = 10;

export default function App() {
  const [yearsData, setYearsData] = useState(null);
  const [yearsError, setYearsError] = useState(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  // Real elapsed seconds for the in-flight years attempt (drives the
  // warm-up/still-connecting UI; stops when the request settles).
  const [yearsElapsed, setYearsElapsed] = useState(0);
  // Controlled-retry trigger: bumped only by the Retry connection action so
  // a retry re-runs the years gate WITHOUT refetching countries/indicators.
  const [yearsToken, setYearsToken] = useState(0);
  const yearsRequestId = useRef(0);
  const yearsController = useRef(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [refreshNotice, setRefreshNotice] = useState(null);

  const [filters, setFilters] = useState(defaultFilters);
  const [rankSub, setRankSub] = useState(readRankSub);
  const [yoySub, setYoySub] = useState(readYoySub);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerTriggerRef = useRef(null);
  const compareChoiceRef = useRef(false);
  // History sync (Phase 3, Part D): last pushed URL + the key fields that
  // earn a history entry. popSuppressRef skips one mirror sync after a
  // popstate restore so normalization never rewrites the history stack.
  const lastUrlRef = useRef(null);
  const lastNavRef = useRef(null);
  const lastCountryRef = useRef(null);
  const popSuppressRef = useRef(false);

  // Public site display metadata (About/Home labels only; analytical data
  // always comes from the backend). Resolved once per render from Vite env.
  const site = useMemo(() => siteMetadata(), []);

  // Home entry points: plain view switches, plus subject-aware Movement
  // entry (first metric of the subject — the same rule the Analysis
  // selector uses, so Home links can never invent a metric).
  const openSubjectInMovement = useCallback((subjectKey) => {
    const keys = metricKeysForSubject(subjectKey);
    setFilters((prev) => ({
      ...prev,
      metric: keys.includes(prev.metric) ? prev.metric : (keys[0] ?? prev.metric),
      view: 'movement',
    }));
  }, []);

  const passiveBootstrap = filters.view === 'status' || filters.view === 'audit';

  // Lifecycle-aware years bootstrap: single-flight, abortable, real clock.
  // Exactly one attempt runs at a time. A newer attempt (manual retry,
  // post-refresh revalidation) or unmount aborts the previous controller,
  // and stale responses can never overwrite newer state (request id +
  // aborted-signal guards). The elapsed clock drives the warm-up UI: it
  // ticks while the attempt is in flight, stops on settle, and resets only
  // when a fresh attempt starts.
  useEffect(() => {
    const id = yearsRequestId.current + 1;
    yearsRequestId.current = id;
    const controller = new AbortController();
    yearsController.current = controller;
    const clockStart = Date.now();
    let timer = null;

    const stillCurrent = () => yearsRequestId.current === id && !controller.signal.aborted;

    setYearsLoading(true);
    setYearsError(null);
    setYearsElapsed(0);
    timer = setInterval(() => {
      if (!stillCurrent()) return;
      setYearsElapsed(Math.floor((Date.now() - clockStart) / 1000));
    }, 500);

    const settle = () => {
      if (timer !== null) clearInterval(timer);

      timer = null;

      if (yearsController.current === controller) yearsController.current = null;
    };

    const runAttempt = () => {
      api
        .years({ signal: controller.signal, timeoutMs: 12000, recover: true, passive: true })
        .then((result) => {
          if (!stillCurrent()) return;
          settle();
          setYearsData(result);
          setYearsLoading(false);
        })
        .catch((error) => {
          if (!stillCurrent()) return;
          if (error?.name === 'AbortError') return;
          settle();
          setYearsError(error);
          setYearsLoading(false);
        });
    };
    runAttempt();

    return () => {
      controller.abort();
      if (timer !== null) clearInterval(timer);

    };
  }, [dataVersion, yearsToken]);

  // Controlled retry ("Try connecting to the backend again"): abort any
  // in-flight attempt, then start exactly one fresh attempt with a reset
  // clock. Rapid clicks only supersede — concurrent attempts are impossible.
  const retryBootstrap = useCallback(() => {
    yearsController.current?.abort();
    setYearsToken((t) => t + 1);
  }, []);

  // Eligible countries for the focus picker (backend metadata is the
  // authority for names; the picker lists countries only — no aggregates,
  // regions or custom groups until Phase 4).
  const [countriesData, setCountriesData] = useState(null);
  const [countriesState, setCountriesState] = useState('loading');
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCountriesState('loading');
    api
      .countries({ includeAggregates: false }, { signal: controller.signal, recover: true, passive: true, timeoutMs: 12000 })
      .then((result) => {
        if (cancelled) return;
        setCountriesData(result);
        setCountriesState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setCountriesData(previous => previous ?? { countries: [] });
        setCountriesState('unavailable');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataVersion, yearsToken]);

  // Metric/subject discovery (Phase 5): the backend /api/indicators catalog
  // is authoritative for which metrics and subjects exist. Hydration swaps
  // the display registry; failure keeps the static fallback (fail-safe).
  // A registry version bump re-renders every section through the same state.
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api
      .indicators({ signal: controller.signal, recover: true, passive: true, timeoutMs: 12000 })
      .then((result) => {
        if (cancelled) return;
        if (hydrateRegistry(result)) setRegistryVersion((v) => v + 1);
      })
      .catch(() => {
        // Static fallback stays active; views keep working with GDP metrics.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataVersion, yearsToken]);

  const eligibleCountries = useMemo(() => (countriesData?.countries ?? []).filter(row =>
    /^[A-Z]{3}$/.test(row.iso3 ?? '') && !row.isAggregate && Number(row.is_aggregate ?? 0) === 0), [countriesData]);
  const economyInitialization = useEconomyInitialization({ countries: eligibleCountries, registryState: countriesState,
    bootstrapReady: Boolean(yearsData?.years?.length), country: filters.country, explicit: filters.countrySource === 'explicit' });
  useEffect(() => {
    const detected = economyInitialization.country;
    if (!detected) return;
    setFilters(previous => eligibleCountries.some(row => row.iso3 === String(previous.country ?? '').trim().toUpperCase())
      ? previous : { ...previous, country: detected, countrySource: 'geo' });
  }, [eligibleCountries, economyInitialization.country]);
  const availableYears = useMemo(() => yearsData?.years ?? [], [yearsData]);
  const minYear = yearsData?.minYear ?? null;
  const defaultStart = yearsData?.defaults?.startYear ?? minYear;
  const compareView=filters.view==='compare';
  const selectedMetric=resolveMetricKey(filters.metric)??'nominal_current';
  const legacyCompareFamily=METRIC_FAMILIES[filters.cmpMetric];
  const availabilityMetric=compareView ? resolveMetricKey(filters.cmpMetric) ??
    (legacyCompareFamily?.metricKeys.includes(filters.cmpBasis) ? filters.cmpBasis : legacyCompareFamily?.metricKeys[0]) ?? 'total_current' : selectedMetric;
  const validatedCountry=eligibleCountries.some(row=>row.iso3===String(filters.country??'').toUpperCase())?String(filters.country).toUpperCase():null;
  const availabilityParams=compareView ? {indicator:availabilityMetric,
    entityA:filters.cmpEntityA|| (validatedCountry?`country:${validatedCountry}`:undefined),entityB:filters.cmpEntityB||undefined,basis:filters.cmpBasis} :
    {indicator:availabilityMetric,country:validatedCountry||undefined};
  const availabilityEnabled=availableYears.length>0 && !['home','about','methodology','status'].includes(filters.view) &&
    Boolean(validatedCountry || (compareView && filters.cmpEntityA && !String(filters.cmpEntityA).endsWith(':'))) &&
    (!compareView || [filters.cmpEntityA,filters.cmpEntityB].every(spec=>!spec||!String(spec).endsWith(':')));
  const yearAvailability=useYearAvailability(availabilityParams,{token:dataVersion,contentVersion:yearsData?.generation?.contentVersion??null,provider:yearsData?.database?.provider??null},availabilityEnabled);
  const scopedYears=yearAvailability.data?.years ?? yearsData?.perMetric?.[availabilityMetric] ?? availableYears;
  const countryYears=yearAvailability.data?.countryYears ?? scopedYears;
  const comparisonYears=yearAvailability.data?.commonYears ?? scopedYears;

  // Resolve effective filters against actually-available years.
  const effective = useMemo(() => {
    // Metric/subject resolution reads the module-level display registry,
    // which hydrateRegistry() swaps when /api/indicators loads: reference
    // the version so filters re-resolve against backend metadata.
    void registryVersion;
    const pick=selectedYear;
    const metricLatest=scopedYears.at(-1)??null;
    const focusLatest=countryYears.at(-1)??null;
    const latestForView=filters.view==='overview' ? focusLatest : filters.view==='yoy' && yearAvailability.data?.yoySupported ? yearAvailability.data.latestYoyYear : metricLatest;
    const endYear = pick(filters.endYear, metricLatest);
    let startYear = pick(filters.startYear, defaultStart);
    if (startYear != null && endYear != null && startYear > endYear) startYear = endYear;
    const year = pick(filters.year, yearAvailability.pending ? null : latestForView);
    const metric = resolveMetricKey(filters.metric) ?? 'nominal_current';
    const neighborsRaw = Number.parseInt(filters.neighbors, 10);
    const neighbors = Number.isInteger(neighborsRaw) ? Math.max(0, Math.min(50, neighborsRaw)) : 5;
    const fromYear = filters.fromYear !== '' && filters.fromYear != null ? pick(filters.fromYear, null) : null;
    const view = isViewId(filters.view) ? filters.view : 'home';
    // Rank-movement years default to a decade-like pair when available,
    // otherwise the stored extremes. Never hardcoded to a fixed range.
    const period=selectedPeriod(countryYears,filters.yearA,filters.yearB);
    const defaultYearA = period.start;
    const defaultYearB = period.end;
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
    // Resolve the focus and its display name from the economy registry.
    const rawCountry = String(filters.country ?? '').trim().toUpperCase();
    const selectedCountry = eligibleCountries.find((c) => c.iso3 === rawCountry);
    const country = selectedCountry?.iso3 ?? '';
    const focusName = selectedCountry?.name ?? '';
    // The analysis subject is derived from the metric key (single source of
    // truth): nominal_* metrics imply GDP per capita, total_* imply Total GDP.
    const subject = subjectOf(metric);
    // Compare workspace state (single source of truth, URL-shareable).
    // Entity specs are validated strictly by the backend; here they only
    // need to be non-empty. Defaults are NOT derived here: they initialize
    // once when Compare is first entered (see the lazy-init effect below),
    // so later focus-country changes can never silently rewrite an
    // existing Compare configuration.
    const cmpEntityA = filters.cmpEntityA != null ? String(filters.cmpEntityA).trim() : '';
    const cmpEntityB = filters.cmpEntityB != null ? String(filters.cmpEntityB).trim() : '';
    const cmpLabelA = filters.cmpLabelA != null ? String(filters.cmpLabelA) : '';
    const cmpLabelB = filters.cmpLabelB != null ? String(filters.cmpLabelB) : '';
    const cmpMetricInput = typeof filters.cmpMetric === 'string' ? filters.cmpMetric : '';
    const legacyBasis = typeof filters.cmpBasis === 'string' ? filters.cmpBasis : '';
    const legacyFamily = METRIC_FAMILIES[cmpMetricInput] ?? null;
    const rawMetric = resolveMetricKey(cmpMetricInput);
    const legacyMetric = legacyFamily
      ? legacyFamily.metricKeys.includes(legacyBasis) ? legacyBasis : legacyFamily.metricKeys[0]
      : null;
    const explicitAnalysis = typeof filters.cmpAnalysis === 'string' ? filters.cmpAnalysis : '';
    const cmpAnalysis = explicitAnalysis
      ? explicitAnalysis
      : legacyMetric
        ? subjectOf(legacyMetric)
        : rawMetric
          ? subjectOf(rawMetric)
          : 'gdp_total';
    const metricKeys = metricKeysForSubject(cmpAnalysis);
    const cmpMetric = legacyMetric ?? rawMetric ?? (cmpMetricInput ? cmpMetricInput : metricKeys[0] ?? null);
    const cmpBasis = legacyFamily
      ? (legacyFamily.metricKeys.includes(legacyBasis) ? 'level' : legacyBasis || 'level')
      : legacyBasis || 'level';
    // An omitted URL value retains the historical latest-year default.
    // The explicit 'none' sentinel lets optional Compare periods be cleared
    // and survive URL sharing/reload without changing Movement year state.
    const cmpStart=pick(filters.cmpYearA,latestPeriod(comparisonYears).start??comparisonYears[0]??null);
    const cmpEnd=!automaticYear(filters.cmpYearC) ? null : comparisonYears.filter(year=>year>cmpStart).at(-1)??null;
    const cmpYearB = filters.cmpYearB === 'none' ? null : pick(filters.cmpYearB, cmpEnd);
    // Year C is the optional END year of the three-period model. It has no
    // default: without it a two-point analysis uses the documented A->B pair.
    const cmpYearCText = filters.cmpYearC != null ? String(filters.cmpYearC).trim() : '';
    const cmpYearCNumber = cmpYearCText === '' ? null : Number(cmpYearCText);
    const cmpYearC = Number.isInteger(cmpYearCNumber) ? cmpYearCNumber : null;
    const cmpYearA = cmpStart;
    const cmpOp = COMPARE_OPERATIONS.some((op) => op.id === filters.cmpOp) ? filters.cmpOp : 'level';
    const cmpMode = filters.cmpMode === 'like_for_like' ? 'like_for_like' : 'observed';
    return { startYear, endYear, year, latestYear:latestForView, metric, subject, neighbors, fromYear, view, yearA, yearB, yearMid, basis, country, focusName, cmpEntityA, cmpEntityB, cmpLabelA, cmpLabelB, cmpAnalysis, cmpMetric, cmpBasis, cmpYearA, cmpYearB, cmpYearC, cmpOp, cmpMode };
  }, [filters, availableYears, defaultStart, eligibleCountries, registryVersion,scopedYears,countryYears,comparisonYears,yearAvailability.data,yearAvailability.pending]);

  const rankSubs = useMemo(
    () => [
      { id: 'table', label: 'Full ranking' },
      { id: 'verify', label: `Verify ${effective.focusName}` },
    ],
    [effective.focusName],
  );
  const yoySubs = useMemo(
    () => [
      { id: 'ranking', label: 'YoY ranking' },
      { id: 'verify', label: `Verify ${effective.focusName}` },
    ],
    [effective.focusName],
  );

  useEffect(() => {
    if (effective.view !== 'compare' || compareChoiceRef.current || effective.cmpEntityA || !effective.country) return;
    setFilters(prev => prev.cmpEntityA ? prev : { ...prev, cmpEntityA: `country:${effective.country}` });
  }, [effective.view, effective.cmpEntityA, effective.country]);

  useEffect(() => {
    const [title, description] = publicPages[effective.view] ?? publicPages.home;
    document.title = `${title} | WDI Research Explorer`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [effective.view]);

  // Mirror effective state to the URL (UI state only, never business logic).
  // History model (Phase 3, Part D): the first sync replaces (normalizing
  // legacy URLs); afterwards, changes to the primary navigation dimensions
  // (view, country, metric, rank/yoy sub-tab, compare entities) push a new
  // history entry so Back/Forward restores state, while secondary tweaks
  // (years, neighbors, basis, labels, modes) replace in place.
  // Compare entity state serializes whenever non-empty — on any view — so a
  // URL copied anywhere reconstructs the Compare workspace. Rank/YoY
  // sub-tabs serialize on their own views so shared links reproduce them.
  useEffect(() => {
    if (popSuppressRef.current) {
      popSuppressRef.current = false;
      lastUrlRef.current = window.location.search;
      lastNavRef.current = navKey(effective, rankSub, yoySub);
      lastCountryRef.current = effective.country;
      return;
    }
    const query = new URLSearchParams();
    if (effective.startYear != null) query.set('startYear', effective.startYear);
    query.set('endYear', automaticYear(filters.endYear)?'latest':filters.endYear);
    query.set('year', automaticYear(filters.year)?'latest':filters.year);
    query.set('metric', effective.metric);
    query.set('neighbors', effective.neighbors);
    if (effective.fromYear != null) query.set('fromYear', effective.fromYear);
    query.set('yearA', automaticYear(filters.yearA)?'auto':filters.yearA);
    query.set('yearB', automaticYear(filters.yearB)?'latest':filters.yearB);
    if (effective.yearMid != null) query.set('yearMid', effective.yearMid);
    if (effective.basis !== 'level') query.set('basis', effective.basis);
    if (effective.country) query.set('country', effective.country);
    query.set('view', effective.view);
    if (effective.cmpEntityA !== '') query.set('cmpEntityA', effective.cmpEntityA);
    if (effective.cmpEntityB !== '') query.set('cmpEntityB', effective.cmpEntityB);
    if (effective.cmpLabelA !== '') query.set('cmpLabelA', effective.cmpLabelA);
    if (effective.cmpLabelB !== '') query.set('cmpLabelB', effective.cmpLabelB);
    query.set('cmpAnalysis', effective.cmpAnalysis);
    query.set('cmpMetric', effective.cmpMetric);
    query.set('cmpBasis', effective.cmpBasis);
    if (effective.cmpYearA != null) query.set('cmpYearA', automaticYear(filters.cmpYearA)?'auto':filters.cmpYearA);
    if (filters.cmpYearB === 'none') query.set('cmpYearB', 'none');
    else if (effective.cmpYearB != null) query.set('cmpYearB', automaticYear(filters.cmpYearB)?'latest':filters.cmpYearB);
    if (effective.cmpYearC != null) query.set('cmpYearC', effective.cmpYearC);
    query.set('cmpOp', effective.cmpOp);
    if (effective.cmpMode !== 'observed') query.set('cmpMode', effective.cmpMode);
    if (effective.view === 'rank') query.set('rankSub', rankSub);
    if (effective.view === 'yoy') query.set('yoySub', yoySub);
    const next = `${pagePath(effective.view)}?${query.toString()}`;
    if (`${window.location.pathname}${window.location.search}` === next) {
      lastUrlRef.current = next;
      lastNavRef.current = navKey(effective, rankSub, yoySub);
      lastCountryRef.current = effective.country;
      return;
    }
    const nav = navKey(effective, rankSub, yoySub);
    const automaticCountry = filters.countrySource === 'geo' && !lastCountryRef.current && effective.country;
    if (lastUrlRef.current !== null && lastNavRef.current !== nav && !automaticCountry) {
      window.history.pushState(null, '', next);
    } else {
      window.history.replaceState(null, '', next);
    }
    lastUrlRef.current = next;
    lastNavRef.current = nav;
    lastCountryRef.current = effective.country;
  }, [effective, filters.cmpYearA, filters.cmpYearB, filters.countrySource, filters.year, filters.yearA, filters.yearB, filters.endYear, rankSub, yoySub]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Explicit user country choice: marks the session as user-directed (IP
  // detection must never override it afterwards) and stores the value.
  // Every country picker in the app routes through here.
  const setCountry = useCallback(value => {
    setFilters(previous => ({ ...previous, country: value, countrySource: String(value ?? '').trim() ? 'explicit' : 'unset' }));
  }, []);

  // Browser history restore: popstate (Back/Forward) replaces the whole
  // filter state from the URL, including sub-tabs. The mirror effect skips
  // its next sync (popSuppressRef) so URL normalization cannot rewrite the
  // entry the user just navigated to. A URL country always counts as
  // explicit, so Back/Forward can never resurrect a stale geo default.
  useEffect(() => {
    const onPopState = () => {
      popSuppressRef.current = true;
      setFilters(defaultFilters());
      setRankSub(readRankSub());
      setYoySub(readYoySub());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
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

  // Adopted refresh generation (R-04): the fingerprint of the dataset the
  // visible views were built from. Declared before handleRefreshed so the
  // manual-refresh path can adopt the new generation without rediscovery.
  const knownGeneration = useRef(null);
  const yearSnapshot=useRef(null);
  useEffect(()=>{yearSnapshot.current={contentVersion:yearsData?.generation?.contentVersion??null,provider:yearsData?.database?.provider??null};},[yearsData]);

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
      // A successful manual refresh advances the published generation: adopt
      // it so the background watcher below does not "rediscover" it.
      if (summary.status === 'success' && summary.runId != null) {
        knownGeneration.current = { ...knownGeneration.current, runId: summary.runId, lastSuccessAt: null, maxFetchedAt: null, observationCount: null };
      }
    }
    setDataVersion((v) => v + 1);
  }, []);

  // Background TTL-refresh revalidation (R-04): GET /api/data-status is
  // side-effect free (excluded from auto-refresh triggers), so polling it can
  // never start a refresh or duplicate one. When its fingerprint advances
  // past the adopted generation — i.e. an automatic background refresh
  // published a newer dataset while this tab was open — remount data views
  // exactly like a manual refresh does. No economics here: the fingerprint is
  // a backend-provided identity, and revalidation re-reads backend results.
  const filtersReady = availableYears.length > 0;
  const researchReady = filtersReady && !yearAvailability.pending;
  const view = effective.view;
  const { enabled: publicReadApiEnabled, observe: observePublication } = usePublicApiAvailability(view);

  // Background TTL-refresh revalidation (R-04): GET /api/data-status is
  // side-effect free (excluded from auto-refresh triggers), so polling it can
  // never start a refresh or duplicate one. When its fingerprint advances
  // past the adopted generation — i.e. an automatic background refresh
  // published a newer dataset while this tab was open — remount data views
  // exactly like a manual refresh does. No economics here: the fingerprint is
  // a backend-provided identity, and revalidation re-reads backend results.
  useEffect(() => {
    // Adopt, don't revalidate, until the app has real data on screen: the
    // first observation only records the baseline generation.
    if (!filtersReady) return undefined;
    let cancelled = false;
    let timer = null;
    const check = async () => {
      if (cancelled || document.hidden) return;
      const started = performance.now();
      let status = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          status = await api.dataStatus({ signal: controller.signal, timeoutMs: 15000 });
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        if (!cancelled) observePublication(null, started);
        return; // Background watcher never surfaces errors; the views' own fetches report them.
      }
      if (cancelled) return;
      observePublication(status?.capabilities, started);
      const next = fingerprintOf(status);
      if (!next || (!next.provider && next.runId === null && !next.lastSuccessAt && next.contentVersion==null)) return;
      const prev = knownGeneration.current;
      if (!prev) {
        knownGeneration.current = next;
        const previousYears=yearSnapshot.current;
        if(previousYears && ((previousYears.contentVersion!=null && status.generation?.contentVersion!=null && previousYears.contentVersion!==status.generation.contentVersion) ||
          (previousYears.provider && next.provider && previousYears.provider!==next.provider)))setDataVersion(value=>value+1);
      } else if (isNewerGeneration(prev, next) || (prev.contentVersion!=null && next.contentVersion!=null && prev.contentVersion!==next.contentVersion) || (prev.provider && next.provider && prev.provider !== next.provider)) {
        knownGeneration.current = next;
        setRefreshNotice(
          prev.provider && next.provider && prev.provider !== next.provider
            ? 'The serving database changed. Analytical views were reloaded.'
            : `Published dataset changed${next.runId != null ? ` (run #${next.runId})` : ''} — analytical views were updated automatically.`,
        );
        setDataVersion((v) => v + 1);
        return;
      } else if (!prev.provider && next.provider) {
        knownGeneration.current = { ...prev, provider: next.provider };
      }
      // Phase 8E narrow TTL engagement: /api/data-status is deliberately
      // side-effect free, so a tab sitting only on the Status page would
      // otherwise never trigger the server's TTL middleware. When the backend
      // reports refreshDue and nothing is running, issue one lightweight
      // GET /api/years (an AUTO_REFRESH_PATHS member) so the server's existing
      // fire-and-forget maybeAutoRefresh engages. No new endpoint, no status
      // write, same 60 s watcher cadence — never a storm.
      if (!passiveBootstrap && status?.refreshDue && !status?.inProgress) {
        try {
          const yController = new AbortController();
          const yTimeout = setTimeout(() => yController.abort(), 15000);
          try {
            await api.years({ signal: yController.signal, timeoutMs: 15000 });
          } finally {
            clearTimeout(yTimeout);
          }
        } catch {
          // Watcher never surfaces errors.
        }
      }
    };
    // Stagger the first check so it never races initial page-load fetches.
    timer = setTimeout(function tick() {
      if (cancelled) return;
      check().finally(() => {
        if (!cancelled) timer = setTimeout(tick, 60000);
      });
    }, 30000);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [filtersReady, passiveBootstrap, observePublication]);

  return (
    <div className="app">
      <MouseScrollSupport />
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
            {/* Site identity is view-aware (Round 2G): the header-context
                resolver maps each view to its meaningful identity —
                neutral for info/compare/status pages, the period endpoints
                for Movement, focus country + year for single-year
                workspaces. Presentation only; all values come from the
                already-resolved effective filter state. */}
            <HeaderIdentity
              view={view}
              country={effective.country}
              focusName={effective.focusName}
              year={effective.year}
              yearA={effective.yearA}
              yearB={effective.yearB}
            />
          </div>
          <div className="header-actions">
            <nav className="mainnav" aria-label="Site navigation">
              <Tabs views={INFO_VIEWS} active={view} onChange={(v) => setFilter('view', v)} />
              <NavDrawerTrigger
                buttonRef={drawerTriggerRef}
                label={
                  isAnalyticalView(view)
                    ? (ANALYTICAL_VIEWS.find((v) => v.id === view)?.label ?? 'Analysis')
                    : 'Explore analysis'
                }
                expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              />
            </nav>
            <ThemeToggle />
          </div>
          <NavDrawer
            open={drawerOpen}
            destinations={[...INFO_VIEWS, ...ANALYTICAL_VIEWS]}
            active={view}
            triggerLabel={
              isAnalyticalView(view)
                ? (ANALYTICAL_VIEWS.find((v) => v.id === view)?.label ?? 'Analysis')
                : 'Explore analysis'
            }
            returnFocusRef={drawerTriggerRef}
            onSelect={(v) => setFilter('view', v)}
            onClose={() => setDrawerOpen(false)}
          />
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
        {view !== 'status' && (yearsLoading || yearsError) && !availableYears.length ? (
          <div className="filterbar filterbar-compact" role="region" aria-label="Data service status">
            {yearsLoading && yearsElapsed < CONNECTION_HINT_SECONDS ? (
              <BootstrapWarmup />
            ) : null}
            {yearsLoading && yearsElapsed >= CONNECTION_HINT_SECONDS ? (
              <BootstrapStillConnecting onRetry={retryBootstrap} />
            ) : null}
            {!yearsLoading && yearsError ? (
              <BootstrapError message={yearsError.message} onRetry={retryBootstrap} />
            ) : null}
          </div>
        ) : null}
        {filtersReady && view !== 'movement' && view !== 'status' && view !== 'compare' && view !== 'home' && view !== 'methodology' && view !== 'about' ? (
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
                  <YearOptions years={scopedYears} id="f-end" label="Period end" allowLatest automatic={automaticYear(filters.endYear)} value={effective.endYear} onChange={(v) => setFilter('endYear', v)} />
                </>
              ) : null}
              <FocusPicker
                countries={eligibleCountries}
                value={effective.country}
                onChange={(v) => setCountry(v)}
              />
              <YearOptions years={view==='overview'?countryYears:scopedYears} id="f-year" label="Year" allowLatest latestYear={yearAvailability.pending?null:effective.latestYear} automatic={automaticYear(filters.year)} value={effective.year} onChange={(v) => setFilter('year', v)} />
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
                subject={effective.subject}
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

        <ResearchPreferences scope={`${view}:${view==='compare'?'entities':effective.country}`}>
        <main id="main" key={`${dataVersion}:${view}`}>
          {availabilityEnabled && yearAvailability.error ? <p className="status" role="status">Economy-specific year availability could not be confirmed. Published indicator years remain available. <button className="btn btn-secondary" onClick={yearAvailability.retry}>Retry year discovery</button></p> : null}
          {yearAvailability.pending ? <p className="status" role="status">Checking published year availability…</p> : null}
          {!automaticYear(filters.year) && yearAvailability.data && !(view==='overview'?countryYears:scopedYears).includes(Number(filters.year)) ? <p className="status" role="status">No published observations for the requested year {filters.year}. <button className="btn btn-secondary" onClick={()=>setFilter('year','latest')}>Use latest available</button></p> : null}
          {view==='overview' && !yearAvailability.pending && yearAvailability.data && !countryYears.length ? <p className="status" role="status">No published observations for this economy and indicator.</p> : null}
          <Suspense fallback={<p className="status" role="status">Loading research view…</p>}>
          {!effective.country && ['overview', 'data', 'rank', 'yoy', 'movement', 'coverage', 'audit', 'compare'].includes(view) &&
            ['resolving', 'waiting-for-registry'].includes(economyInitialization.status) ?
            <p className="status" role="status">{filters.countrySource === 'explicit' && economyInitialization.status === 'waiting-for-registry' ? 'Preparing your selected economy…' : 'Identifying your regional economy…'}</p> : null}
          {filtersReady && !effective.country && ['overview', 'data', 'rank', 'yoy', 'movement', 'coverage', 'audit'].includes(view) &&
            economyInitialization.status === 'unavailable' ?
            <p className="status" role="status">Select a focus economy to open this research view.</p> : null}
          {filtersReady && !effective.country && view === 'movement' ?
            <FocusPicker countries={eligibleCountries} value={effective.country} onChange={setCountry} /> : null}
          {view === 'home' ? (
            <Home
              sourceName={site.sourceName}
              onOpenView={(v) => setFilter('view', v)}
              onOpenSubject={openSubjectInMovement}
            />
          ) : null}
          {view === 'methodology' ? <Methodology /> : null}
          {view === 'about' ? (
            <About site={site} onOpenView={(v) => setFilter('view', v)} />
          ) : null}
          {researchReady && effective.country && view === 'overview' ? (
            <>
              <Overview year={effective.year} subject={effective.subject} metricKey={effective.metric} country={effective.country} focusName={effective.focusName} availableYears={countryYears} metricYears={{...yearsData?.perMetric,[effective.metric]:countryYears}} yearDomain={yearAvailability.data?.yearDomain} onCompareEntities={openCompareWith} />
              <YearComparison year={effective.year} subject={effective.subject} country={effective.country} />
            </>
          ) : null}
          {researchReady && effective.country && view === 'data' ? (
            <YearlyTable startYear={effective.startYear} endYear={effective.endYear} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
          ) : null}
          {researchReady && effective.country && view === 'rank' ? (
            <div role="tabpanel" id="panel-rank" aria-labelledby="tab-rank">
              <SubTabs options={rankSubs} active={rankSub} onChange={setRankSub} label="Rank workspace views" />
              {rankSub === 'verify' ? (
                <LevelVerification year={effective.year} metricKey={effective.metric} neighbors={effective.neighbors} country={effective.country} focusName={effective.focusName} />
              ) : (
                <FullRanking year={effective.year} metricKey={effective.metric} country={effective.country} focusName={effective.focusName} />
              )}
            </div>
          ) : null}
          {researchReady && effective.country && view === 'movement' ? (
            <RankMovement
              availableYears={scopedYears}
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
              onCountry={(v) => setCountry(v)}
            />
          ) : null}
          {researchReady && effective.country && view === 'yoy' ? (
            <div role="tabpanel" id="panel-yoy" aria-labelledby="tab-yoy">
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
              availabilityPending={yearAvailability.pending}
              availableYears={comparisonYears}
              countries={eligibleCountries}
              entityA={effective.cmpEntityA}
              entityB={effective.cmpEntityB}
              labelA={effective.cmpLabelA}
              labelB={effective.cmpLabelB}
              analysis={effective.cmpAnalysis}
              metricKey={effective.cmpMetric}
              basisId={effective.cmpBasis}
              yearA={effective.cmpYearA}
              yearB={effective.cmpYearB}
              yearC={effective.cmpYearC}
              operation={effective.cmpOp}
              groupMode={effective.cmpMode}
              onEntityA={(v) => { compareChoiceRef.current = true; setFilter('cmpEntityA', v); }}
              onEntityB={(v) => setFilter('cmpEntityB', v)}
              onLabelA={(v) => setFilter('cmpLabelA', v)}
              onLabelB={(v) => setFilter('cmpLabelB', v)}
              onAnalysis={(v) => setFilter('cmpAnalysis', v)}
              onMetric={(v) => setFilter('cmpMetric', v)}
              onBasis={(v) => setFilter('cmpBasis', v)}
              onYearA={(v) => setFilter('cmpYearA', v)}
              onYearB={(v) => setFilter('cmpYearB', v ?? 'none')}
              onYearC={(v) => setFilter('cmpYearC', v)}
              onOperation={(v) => setFilter('cmpOp', v)}
              onGroupMode={(v) => setFilter('cmpMode', v)}
            />
          ) : null}
          {researchReady && effective.country && view === 'coverage' ? (
            <Coverage year={effective.year} metricKey={effective.metric} fromYear={effective.fromYear} toYear={effective.year} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
          ) : null}
          {researchReady && effective.country && view === 'audit' ? (
            <AuditSource year={effective.year} metricKey={effective.metric} subject={effective.subject} country={effective.country} focusName={effective.focusName} />
          ) : null}
          {view === 'status' ? <DataStatus onRefreshed={handleRefreshed} /> : null}
          </Suspense>
        </main>
        </ResearchPreferences>

        <footer className="app-footer">
          <p>
            Source data: World Bank World Development Indicators. All ranks shown here are calculated by this
            application — the World Bank does not publish them.
          </p>
          <nav aria-label="Data sources and documentation">
            <a href="https://data.worldbank.org/">Official World Bank data</a>
            <a href="https://datahelpdesk.worldbank.org/knowledgebase/articles/889392">World Bank Indicators API</a>
            {publicReadApiEnabled ? <a href="/public-data/">This project’s public API</a> : null}
            <a href="/methodology/">Methodology</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
