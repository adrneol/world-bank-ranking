/**
 * Application shell: compact header, tab navigation, global filter bar and
 * one focused view at a time. Filter state lives here (mirrored to the URL
 * query string); every section receives the active filter values as props, so
 * displayed results can never disagree with the visible filter labels.
 *
 * Views lazy-mount: only the active tab fetches and renders. All data shown
 * is backend-calculated; this shell holds UI state only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api/client.js';
import { fingerprintOf, isNewerGeneration } from './utils/refreshGeneration.js';
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
import NavDrawer, { NavDrawerTrigger } from './components/NavDrawer.jsx';
import { BootstrapError, BootstrapStillConnecting, BootstrapWarmup } from './components/BootstrapStatus.jsx';
import { siteMetadata } from './config/site.js';
import { getHeaderContext } from './utils/headerContext.js';
import Home from './sections/Home.jsx';
import About from './sections/About.jsx';
import Methodology from './sections/Methodology.jsx';
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

const PARAMS = ['startYear', 'endYear', 'year', 'metric', 'neighbors', 'fromYear', 'view', 'yearA', 'yearB', 'yearMid', 'basis', 'country', 'cmpEntityA', 'cmpEntityB', 'cmpLabelA', 'cmpLabelB', 'cmpMetric', 'cmpYearA', 'cmpYearB', 'cmpOp', 'cmpMode', 'rankSub', 'yoySub'];

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
  return value === 'table' ? 'table' : 'verify';
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
  ].join('|');
}

// Canonical initial filter state: product defaults overlaid once with the
// URL at startup. popstate restores use the same constructor so an omitted
// parameter (e.g. country for the IND default) resets to its default
// instead of leaking the previous state's value.
function defaultFilters() {
  return {
    startYear: null,
    endYear: null,
    year: null,
    metric: 'nominal_current',
    neighbors: 5,
    fromYear: '',
    view: 'home',
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
  };
}

// Default-country geolocation policy (Phase 3, Part B): one mount-only
// lookup, applied solely as the INITIAL default when no explicit country
// exists (URL or in-session user choice). Never polled, never re-applied,
// never an override. Bounded so a slow provider cannot delay the app.
const GEO_TIMEOUT_MS = 4000;

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

// Cold-start bootstrap policy: GET /api/years is the cold-start gate, and a
// free-tier backend wake can take up to about a minute. This ONE request
// therefore carries a longer per-call bound (the shared 30 s
// DEFAULT_REQUEST_TIMEOUT_MS is unchanged for every other request). The UI
// shows the warm-up state below 60 s, the still-connecting state with a
// controlled retry at/above 60 s, and a genuine error only when the request
// actually fails.
const YEARS_BOOTSTRAP_TIMEOUT_MS = 120000;
const WARMUP_THRESHOLD_S = 60;
// Re-check delay while the backend explicitly reports DATA_LOADING (empty
// database with the first ingest still running): not a failure, so the
// warm-up clock keeps running and a single follow-up attempt is scheduled.
const SEED_FOLLOWUP_MS = 10000;

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
  // Default-country precedence (Phase 3, Part B): explicit URL country >
  // in-session user choice > IP-derived default > India fallback. The ref
  // records the first two; geolocation may only fill the gap before either
  // exists. popstate-driven URL countries count as explicit.
  const countryExplicitRef = useRef(
    new URLSearchParams(window.location.search).get('country') != null &&
      new URLSearchParams(window.location.search).get('country') !== '',
  );
  // History sync (Phase 3, Part D): last pushed URL + the key fields that
  // earn a history entry. popSuppressRef skips one mirror sync after a
  // popstate restore so normalization never rewrites the history stack.
  const lastUrlRef = useRef(null);
  const lastNavRef = useRef(null);
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
    let followup = null;
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
      if (followup !== null) clearTimeout(followup);
      timer = null;
      followup = null;
      if (yearsController.current === controller) yearsController.current = null;
    };

    const runAttempt = () => {
      api
        .years({ signal: controller.signal, timeoutMs: YEARS_BOOTSTRAP_TIMEOUT_MS })
        .then((result) => {
          if (!stillCurrent()) return;
          settle();
          setYearsData(result);
          setYearsLoading(false);
        })
        .catch((error) => {
          if (!stillCurrent()) return;
          if (error?.name === 'AbortError') return;
          // Backend is seeding its first dataset (empty database, ingest
          // running): not a failure. Stay in warm-up on the original clock
          // and schedule a single follow-up attempt.
          if (error?.code === 'DATA_LOADING') {
            followup = setTimeout(() => {
              if (!stillCurrent()) return;
              runAttempt();
            }, SEED_FOLLOWUP_MS);
            return;
          }
          settle();
          setYearsError(error);
          setYearsLoading(false);
        });
    };
    runAttempt();

    return () => {
      controller.abort();
      if (timer !== null) clearInterval(timer);
      if (followup !== null) clearTimeout(followup);
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
    const view = isViewId(filters.view) ? filters.view : 'home';
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
    // need to be non-empty. Defaults are NOT derived here: they initialize
    // once when Compare is first entered (see the lazy-init effect below),
    // so later focus-country changes can never silently rewrite an
    // existing Compare configuration.
    const cmpEntityA = filters.cmpEntityA != null ? String(filters.cmpEntityA).trim() : '';
    const cmpEntityB = filters.cmpEntityB != null ? String(filters.cmpEntityB).trim() : '';
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

  // Compare defaults lazy-init (Phase 3, Part C): exactly one canonical
  // rule. When the Compare workspace becomes active with an empty entity
  // slot, that slot initializes from the CURRENT focus country
  // (A = focus, B = USA unless focus is USA, then CHN). Non-empty slots —
  // user selections, explicit URL params, deep-link prefills — are never
  // touched, so focus changes elsewhere never rewrite Compare.
  useEffect(() => {
    if (effective.view !== 'compare') return;
    setFilters((prev) => {
      const a = prev.cmpEntityA != null ? String(prev.cmpEntityA).trim() : '';
      const b = prev.cmpEntityB != null ? String(prev.cmpEntityB).trim() : '';
      if (a !== '' && b !== '') return prev;
      const focus = String(effective.country ?? 'IND').trim().toUpperCase() || 'IND';
      return {
        ...prev,
        cmpEntityA: a !== '' ? prev.cmpEntityA : `country:${focus}`,
        cmpEntityB: b !== '' ? prev.cmpEntityB : `country:${focus === 'USA' ? 'CHN' : 'USA'}`,
      };
    });
    // Runs when Compare activates or when its slots/focus change while
    // active; filling one slot never clears the other.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective.view, filters.cmpEntityA, filters.cmpEntityB, effective.country]);

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
      return;
    }
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
    if (effective.cmpEntityA !== '') query.set('cmpEntityA', effective.cmpEntityA);
    if (effective.cmpEntityB !== '') query.set('cmpEntityB', effective.cmpEntityB);
    if (effective.cmpLabelA !== '') query.set('cmpLabelA', effective.cmpLabelA);
    if (effective.cmpLabelB !== '') query.set('cmpLabelB', effective.cmpLabelB);
    query.set('cmpMetric', effective.cmpMetric);
    if (effective.cmpYearA != null) query.set('cmpYearA', effective.cmpYearA);
    if (effective.cmpYearB != null) query.set('cmpYearB', effective.cmpYearB);
    query.set('cmpOp', effective.cmpOp);
    if (effective.cmpMode !== 'observed') query.set('cmpMode', effective.cmpMode);
    if (effective.view === 'rank') query.set('rankSub', rankSub);
    if (effective.view === 'yoy') query.set('yoySub', yoySub);
    const next = `?${query.toString()}`;
    if (window.location.search === next) {
      lastUrlRef.current = next;
      lastNavRef.current = navKey(effective, rankSub, yoySub);
      return;
    }
    const nav = navKey(effective, rankSub, yoySub);
    if (lastUrlRef.current === null || lastNavRef.current !== nav) {
      window.history.pushState(null, '', next);
    } else {
      window.history.replaceState(null, '', next);
    }
    lastUrlRef.current = next;
    lastNavRef.current = nav;
  }, [effective, rankSub, yoySub]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Explicit user country choice: marks the session as user-directed (IP
  // detection must never override it afterwards) and stores the value.
  // Every country picker in the app routes through here.
  const setCountry = useCallback(
    (value) => {
      countryExplicitRef.current = true;
      setFilter('country', value);
    },
    [setFilter],
  );

  // IP-derived initial default (mount-only): when the URL carries no
  // explicit country, ask the backend once for a validated ISO3. Applied
  // only if the user has not chosen explicitly in the meantime; any
  // failure, invalid value or unknown country keeps the India fallback.
  // Runs in parallel with the years bootstrap (which gates first paint),
  // so no India→detected flash is visible in the normal case.
  useEffect(() => {
    if (countryExplicitRef.current) return undefined;
    const controller = new AbortController();
    let settled = false;
    api
      .geoCountry({ signal: controller.signal, timeoutMs: GEO_TIMEOUT_MS })
      .then((result) => {
        if (settled || controller.signal.aborted) return;
        settled = true;
        const iso3 = String(result?.iso3 ?? '').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(iso3)) return;
        if (countryExplicitRef.current) return;
        setFilters((prev) => {
          const current = String(prev.country ?? 'IND').trim().toUpperCase();
          if (current !== 'IND') return prev;
          return { ...prev, country: iso3 };
        });
      })
      .catch(() => {
        // Silent: fallback country stays active.
      });
    return () => {
      settled = true;
      controller.abort();
    };
  }, []);

  // Browser history restore: popstate (Back/Forward) replaces the whole
  // filter state from the URL, including sub-tabs. The mirror effect skips
  // its next sync (popSuppressRef) so URL normalization cannot rewrite the
  // entry the user just navigated to. A URL country always counts as
  // explicit, so Back/Forward can never resurrect a stale geo default.
  useEffect(() => {
    const onPopState = () => {
      const query = new URLSearchParams(window.location.search);
      if (query.get('country') !== null && query.get('country') !== '') {
        countryExplicitRef.current = true;
      }
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
        knownGeneration.current = { runId: summary.runId, lastSuccessAt: null, maxFetchedAt: null, observationCount: null };
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
  const filtersReady = !yearsLoading && !yearsError && availableYears.length > 0;
  const view = effective.view;

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
        return; // Background watcher never surfaces errors; the views' own fetches report them.
      }
      if (cancelled) return;
      const next = fingerprintOf(status);
      if (!next || (next.runId === null && !next.lastSuccessAt)) return;
      const prev = knownGeneration.current;
      if (!prev) {
        knownGeneration.current = next;
        return;
      }
      if (isNewerGeneration(prev, next)) {
        knownGeneration.current = next;
        setRefreshNotice(
          `Background refresh published a newer dataset${next.runId != null ? ` (run #${next.runId})` : ''} — all views were updated automatically.`,
        );
        setDataVersion((v) => v + 1);
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
  }, [filtersReady]);

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
          <NavDrawer
            open={drawerOpen}
            destinations={ANALYTICAL_VIEWS}
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
        {yearsLoading || yearsError ? (
          <div className="filterbar filterbar-compact" role="region" aria-label="Data service status">
            {yearsLoading && yearsElapsed < WARMUP_THRESHOLD_S ? (
              <BootstrapWarmup elapsedSec={yearsElapsed} />
            ) : null}
            {yearsLoading && yearsElapsed >= WARMUP_THRESHOLD_S ? (
              <BootstrapStillConnecting elapsedSec={yearsElapsed} onRetry={retryBootstrap} />
            ) : null}
            {!yearsLoading && yearsError ? (
              <BootstrapError message={yearsError.message} elapsedSec={yearsElapsed} onRetry={retryBootstrap} />
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
                  <YearOptions years={availableYears} id="f-end" label="Period end" value={effective.endYear} onChange={(v) => setFilter('endYear', v)} />
                </>
              ) : null}
              <FocusPicker
                countries={eligibleCountries}
                value={effective.country}
                onChange={(v) => setCountry(v)}
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

        <main id="main" key={`${dataVersion}:${view}:${effective.country}`}>
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
              onCountry={(v) => setCountry(v)}
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
