/**
 * Centralized metric presentation metadata.
 *
 * Display-only: titles, indicator codes and unit labels. Values, ranks, YoY
 * percentages and denominators always come from backend responses — nothing
 * here participates in any calculation.
 *
 * Phase-5 discovery: the static tables below are the fallback. When the
 * backend /api/indicators catalog loads, hydrateRegistry() replaces the
 * active maps (same shapes, backend order), so promoted metrics become
 * selectable without a frontend change. Helpers always read the active maps;
 * unknown keys degrade to safe fallbacks and never crash a view.
 */

export const STATIC_METRICS = Object.freeze({
  nominal_current: Object.freeze({
    key: 'nominal_current',
    title: 'Nominal GDP per capita — current US$',
    shortTitle: 'Nominal — Current US$',
    indicatorCode: 'NY.GDP.PCAP.CD',
    unit: 'current US$',
    subject: 'gdp_per_capita',
    aggregation: 'NOT_AGGREGATABLE',
    displayDecimals: 0,
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    title: 'Real GDP per capita — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.PCAP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_per_capita',
    aggregation: 'NOT_AGGREGATABLE',
    displayDecimals: 0,
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    title: 'GDP per capita, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.PCAP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_per_capita',
    aggregation: 'NOT_AGGREGATABLE',
    displayDecimals: 0,
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    title: 'GDP per capita, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.PCAP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_per_capita',
    aggregation: 'NOT_AGGREGATABLE',
    displayDecimals: 0,
  }),
  total_current: Object.freeze({
    key: 'total_current',
    title: 'Total GDP — current US$',
    shortTitle: 'Nominal — Current US$',
    indicatorCode: 'NY.GDP.MKTP.CD',
    unit: 'current US$',
    subject: 'gdp_total',
    aggregation: 'SUM',
    displayDecimals: 2,
  }),
  total_constant: Object.freeze({
    key: 'total_constant',
    title: 'Total GDP — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.MKTP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_total',
    aggregation: 'SUM',
    displayDecimals: 2,
  }),
  total_ppp_current: Object.freeze({
    key: 'total_ppp_current',
    title: 'Total GDP, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.MKTP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_total',
    aggregation: 'SUM',
    displayDecimals: 2,
  }),
  total_ppp_constant: Object.freeze({
    key: 'total_ppp_constant',
    title: 'Total GDP, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.MKTP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_total',
    aggregation: 'SUM',
    displayDecimals: 2,
  }),
});

/**
 * GDP-per-capita keys in canonical order. This is the historical default:
 * existing URLs and views resolve against it, so per-capita pages render
 * exactly as before.
 */
export const STATIC_METRIC_KEYS = Object.freeze(['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant']);

/** Every known metric key, in registry order (registry-wide use only). */
export const STATIC_ALL_METRIC_KEYS = Object.freeze(Object.keys(STATIC_METRICS));

/**
 * Analysis subjects (display grouping only — never a second metric identity).
 * The metric key stays the single source of truth; the subject is always
 * derived from it, so the two can never disagree.
 */
export const STATIC_SUBJECTS = Object.freeze({
  gdp_per_capita: Object.freeze({
    key: 'gdp_per_capita',
    label: 'GDP per capita',
    metricKeys: STATIC_METRIC_KEYS,
  }),
  gdp_total: Object.freeze({
    key: 'gdp_total',
    label: 'Total GDP',
    metricKeys: Object.freeze(['total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant']),
  }),
});

export const STATIC_SUBJECT_KEYS = Object.freeze(Object.keys(STATIC_SUBJECTS));

/**
 * User-facing metric families: economic concepts selected as the "Metric"
 * dimension. Each family groups one or more registered canonical metric keys
 * (measurement variants) that share the same economic concept.
 *
 * For GDP and GDP per capita, the family has multiple bases (price/currency
 * variants). For all other metrics, the family has a single canonical key.
 *
 * This is frontend display metadata only; it does not duplicate the backend
 * calculation registry. The canonical metric key resolved from a family +
 * basis drives the API `indicator` parameter and all calculations.
 */
export const METRIC_FAMILIES = Object.freeze({
  total_gdp: Object.freeze({
    key: 'total_gdp',
    label: 'Total GDP',
    metricKeys: Object.freeze(['total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant']),
    defaultBasis: 'total_current',
  }),
  gdp_per_capita: Object.freeze({
    key: 'gdp_per_capita',
    label: 'GDP per capita',
    metricKeys: Object.freeze(['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant']),
    defaultBasis: 'nominal_current',
  }),
  inflation_cpi: Object.freeze({
    key: 'inflation_cpi',
    label: 'CPI inflation',
    metricKeys: Object.freeze(['inflation_cpi']),
    defaultBasis: 'inflation_cpi',
  }),
  inflation_cpi_index: Object.freeze({
    key: 'inflation_cpi_index',
    label: 'CPI index',
    metricKeys: Object.freeze(['inflation_cpi_index']),
    defaultBasis: 'inflation_cpi_index',
  }),
  inflation_deflator: Object.freeze({
    key: 'inflation_deflator',
    label: 'GDP-deflator inflation',
    metricKeys: Object.freeze(['inflation_deflator']),
    defaultBasis: 'inflation_deflator',
  }),
  exports_current: Object.freeze({
    key: 'exports_current',
    label: 'Exports',
    metricKeys: Object.freeze(['exports_current']),
    defaultBasis: 'exports_current',
  }),
  imports_current: Object.freeze({
    key: 'imports_current',
    label: 'Imports',
    metricKeys: Object.freeze(['imports_current']),
    defaultBasis: 'imports_current',
  }),
  fdi_inflows: Object.freeze({
    key: 'fdi_inflows',
    label: 'Foreign direct investment',
    metricKeys: Object.freeze(['fdi_inflows', 'fdi_inflows_pct_gdp']),
    defaultBasis: 'fdi_inflows',
  }),
  fx_official: Object.freeze({
    key: 'fx_official',
    label: 'Exchange rates',
    metricKeys: Object.freeze(['fx_official']),
    defaultBasis: 'fx_official',
  }),
  current_account: Object.freeze({
    key: 'current_account',
    label: 'Current account',
    metricKeys: Object.freeze(['current_account']),
    defaultBasis: 'current_account',
  }),
  reserves_ex_gold: Object.freeze({
    key: 'reserves_ex_gold',
    label: 'Reserves',
    metricKeys: Object.freeze(['reserves_ex_gold']),
    defaultBasis: 'reserves_ex_gold',
  }),
  remittances_received: Object.freeze({
    key: 'remittances_received',
    label: 'Remittances',
    metricKeys: Object.freeze(['remittances_received']),
    defaultBasis: 'remittances_received',
  }),
  population_total: Object.freeze({
    key: 'population_total',
    label: 'Population',
    metricKeys: Object.freeze(['population_total']),
    defaultBasis: 'population_total',
  }),
});

export const METRIC_FAMILY_KEYS = Object.freeze(Object.keys(METRIC_FAMILIES));

/**
 * Active registry (live bindings: importers always see the hydrated maps).
 * Starts as the static fallback; hydrateRegistry() swaps in backend data.
 */
export let METRICS = STATIC_METRICS;
export let METRIC_KEYS = STATIC_METRIC_KEYS;
export let ALL_METRIC_KEYS = STATIC_ALL_METRIC_KEYS;
export let SUBJECTS = STATIC_SUBJECTS;
export let SUBJECT_KEYS = STATIC_SUBJECT_KEYS;

/**
 * Monotonic registry generation: 0 for the static fallback, bumped by
 * every successful hydrateRegistry(). Memoized readers (pickers, option
 * lists) must include activeRegistryVersion() in their dependency lists
 * so hydrated titles/units/capabilities replace the fallback instead of
 * going stale until an unrelated remount. Reads are cheap; correctness
 * is not memoizable.
 */
let registryGeneration = 0;
export function activeRegistryVersion() {
  return registryGeneration;
}

/**
 * Replace the active display registry from a GET /api/indicators payload
 * ({ production: [{ key, label, shortLabel, indicatorCode, unit, subject,
 * ... }], subjects: [{ key, label }] }). Returns true on success; anything
 * malformed keeps the previous registry (fail-safe, never half-applied).
 */
export function hydrateRegistry(payload) {
  try {
    const production = payload?.production;
    if (!Array.isArray(production) || production.length === 0) return false;
    const backendLabels = {};
    for (const subject of payload?.subjects ?? []) {
      if (subject && typeof subject.key === 'string' && typeof subject.label === 'string') {
        backendLabels[subject.key] = subject.label;
      }
    }
    const metrics = {};
    const subjectOrder = [];
    const subjectKeys = {};
    for (const entry of production) {
      if (!entry || typeof entry.key !== 'string' || typeof entry.subject !== 'string') return false;
      metrics[entry.key] = Object.freeze({
        key: entry.key,
        title: entry.label ?? entry.key,
        shortTitle: entry.shortLabel ?? entry.label ?? entry.key,
        indicatorCode: entry.indicatorCode ?? '',
        unit: entry.unit ?? '',
        unitLong: entry.unitLong ?? entry.unit ?? '',
        subject: entry.subject,
        domain: entry.domain ?? null,
        family: entry.family ?? null,
        // Capability metadata for capability-driven UI (Compare operations,
        // group support, change semantics). Display-only mirrors: the backend
        // remains authoritative; these only decide which actions are offered.
        observationType: entry.observationType ?? null,
        validChangeTypes: Object.freeze([...(entry.validChangeTypes ?? [])]),
        aggregation: entry.aggregation ?? null,
        rankingDirection: entry.rankingDirection ?? null,
        interpretation: entry.interpretation ?? null,
        comparisonCapability: Object.freeze([...(entry.comparisonCapability ?? [])]),
        signDomain: entry.signDomain ?? null,
        quotation: entry.quotation ? Object.freeze({ ...entry.quotation }) : null,
        priceBasis: entry.priceBasis ?? null,
        currencyBasis: entry.currencyBasis ?? null,
        baseYear: entry.baseYear ?? null,
        // Registry display precision: every raw-number format site reads this,
        // never a hardcoded toFixed. Falls back to 0 only if the backend
        // predates the contract (fail-safe display, backend stays authoritative).
        displayDecimals: Number.isInteger(entry.displayDecimals) && entry.displayDecimals >= 0
          ? entry.displayDecimals
          : 0,
        // Period aggregation over time (Phase 7C-1): SUM/AVG declared for
        // FLOW metrics only; empty means NONE. Drives Movement period modes.
        periodAggregation: Object.freeze([...(entry.periodAggregation ?? [])]),
      });
      if (!subjectKeys[entry.subject]) {
        subjectKeys[entry.subject] = [];
        subjectOrder.push(entry.subject);
      }
      subjectKeys[entry.subject].push(entry.key);
    }
    if (subjectOrder.length === 0) return false;
    const subjects = {};
    for (const key of subjectOrder) {
      subjects[key] = Object.freeze({
        key,
        label: backendLabels[key] ?? key,
        metricKeys: Object.freeze([...subjectKeys[key]]),
      });
    }
    METRICS = Object.freeze(metrics);
    SUBJECTS = Object.freeze(subjects);
    SUBJECT_KEYS = Object.freeze([...subjectOrder]);
    ALL_METRIC_KEYS = Object.freeze(Object.keys(metrics));
    // Historical default: per-capita keys when present, else the first subject.
    METRIC_KEYS = Object.freeze(
      subjects.gdp_per_capita ? [...subjects.gdp_per_capita.metricKeys] : [...subjects[subjectOrder[0]].metricKeys],
    );
    registryGeneration += 1;
    return true;
  } catch {
    return false;
  }
}

export function resolveMetricKey(input) {
  if (!input) return null;
  if (METRICS[input]) return input;
  const upper = String(input).toUpperCase();
  const found = ALL_METRIC_KEYS.find((key) => METRICS[key].indicatorCode.toUpperCase() === upper);
  return found ?? null;
}

/** The analysis subject a metric belongs to (per-capita when unknown). */
export function subjectOf(metricKey) {
  return METRICS[metricKey]?.subject ?? 'gdp_per_capita';
}

/** Display label of a subject. */
export function subjectLabel(subjectKey) {
  return SUBJECTS[subjectKey]?.label ?? SUBJECTS.gdp_per_capita.label;
}

/** Metric keys of one subject, in canonical order. */
export function metricKeysForSubject(subjectKey) {
  return SUBJECTS[subjectKey]?.metricKeys ?? METRIC_KEYS;
}

export function metricLabel(key) {
  return METRICS[key]?.shortTitle ?? key;
}

export function metricTitle(key) {
  return METRICS[key]?.title ?? key;
}

/** Display precision for one metric (registry displayDecimals; 0 when unknown). */
export function metricDecimals(key) {
  const d = METRICS[key]?.displayDecimals;
  return Number.isInteger(d) && d >= 0 ? d : 0;
}

/** Capability metadata mirror for one metric (null when unknown). */
export function metricCapabilities(key) {
  const m = METRICS[key];
  if (!m) return null;
  return {
    observationType: m.observationType ?? null,
    validChangeTypes: [...(m.validChangeTypes ?? [])],
    aggregation: m.aggregation ?? null,
    rankingDirection: m.rankingDirection ?? null,
    interpretation: m.interpretation ?? null,
    comparisonCapability: [...(m.comparisonCapability ?? [])],
    signDomain: m.signDomain ?? null,
    quotation: m.quotation ? { ...m.quotation } : null,
    periodAggregation: [...(m.periodAggregation ?? [])],
  };
}

/**
 * Display label for a measurement basis (metric key), derived from registry
 * metadata (priceBasis / currencyBasis / baseYear / unit). Never hardcodes
 * price-base semantics from a generic label.
 */
export function basisLabelForMetric(key) {
  const metric = METRICS[key] ?? {};
  const currency = metric.currencyBasis;
  const prices = metric.priceBasis;
  if (prices === 'current' || prices === 'constant') {
    const priceLabel = prices === 'current' ? 'Current prices' : `Constant prices${metric.baseYear ? ` (${metric.baseYear})` : ''}`;
    const currencyLabel = currency === 'INTERNATIONAL_DOLLAR' ? 'PPP international dollars' : currency === 'USD' ? 'US dollars' : null;
    return [priceLabel, currencyLabel].filter(Boolean).join(' · ');
  }
  return `Registry-defined · ${metric.unitLong ?? metric.unit ?? metricTitle(key)}`;
}

/**
 * Family options for the Compare Metric selector: economic concepts only,
 * never individual series variants or analytical operations.
 */
export function metricFamilyOptions() {
  return Object.values(METRIC_FAMILIES).map((family) => ({
    value: family.key,
    label: family.label,
  }));
}

/**
 * Resolve the metric family that contains a canonical metric key.
 * Returns null when the key belongs to no family.
 */
export function familyForMetricKey(metricKey) {
  for (const family of Object.values(METRIC_FAMILIES)) {
    if (family.metricKeys.includes(metricKey)) return family.key;
  }
  return null;
}

/**
 * Basis options for one metric family. For multi-variant families (GDP, GDP
 * per capita) each canonical metric key is a basis. For single-key families
 * the movement bases of the sole metric are offered.
 */
export function basisOptionsForFamily(familyKey, yearA = null, yearEnd = null) {
  const family = METRIC_FAMILIES[familyKey];
  if (!family) return [];
  if (family.metricKeys.length > 1) {
    return family.metricKeys.map((key) => ({
      id: key,
      label: basisLabelForMetric(key),
      metricKey: key,
      available: true,
    }));
  }
  const metricKey = family.metricKeys[0];
  const movementOptions = movementBasisOptions(metricKey, yearA, yearEnd);
  // The metric key itself is always a valid basis (the base measurement);
  // movement bases are additional compatible definitions.
  return [
    { id: metricKey, label: basisLabelForMetric(metricKey), metricKey, available: true },
    ...movementOptions.map((basis) => ({
      id: basis.id,
      label: basis.label,
      metricKey,
      available: basis.available,
    })),
  ];
}

/**
 * Resolve the canonical metric key (API `indicator`) from a family + basis.
 * For multi-variant families the basis id IS the canonical key; for
 * single-key families the family's metric key is used regardless of basis.
 */
export function resolveCanonicalMetric(familyKey, basisId) {
  const family = METRIC_FAMILIES[familyKey];
  if (!family) return null;
  if (family.metricKeys.length > 1) {
    return family.metricKeys.includes(basisId) ? basisId : null;
  }
  return family.metricKeys[0];
}

/**
 * Default basis id for one metric family.
 */
export function defaultBasisForFamily(familyKey) {
  const family = METRIC_FAMILIES[familyKey];
  return family ? family.defaultBasis : null;
}

/**
 * Compare operations derivable from a metric's declared change types.
 * Backend remains authoritative (it re-validates); this only decides which
 * actions the UI offers, so an unsupported button can never be rendered.
 *
 * `periods` describes the year roles the operation uses:
 *   'start'        Year A only.
 *   'start-end'    Year A plus an end year (Year C, or Year B as the
 *                  two-year fallback); Year B partitions the analysis when
 *                  both B and C are supplied.
 *   'start-optional-mid-end' Year A and C, with an optional middle point B.
 */
export const COMPARE_OPERATIONS = Object.freeze([
  { id: 'level', label: 'Level', needsYears: 1, periods: 'start' },
  { id: 'absolute_change', label: 'Absolute change', needsYears: 2, periods: 'start-end' },
  { id: 'percent_change', label: 'Percent change', needsYears: 2, periods: 'start-end' },
  { id: 'pp_change', label: 'Percentage-point change', needsYears: 2, periods: 'start-end' },
  { id: 'index_point_change', label: 'Index-point change', needsYears: 2, periods: 'start-end' },
  { id: 'cagr', label: 'CAGR', needsYears: 2, periods: 'start-end' },
  { id: 'cross_rate', label: 'Cross-rate', needsYears: 1, periods: 'start' },
  { id: 'period_total', label: 'Period total', needsYears: 2, periods: 'start-end' },
  { id: 'period_average', label: 'Period average', needsYears: 2, periods: 'start-end' },
  { id: 'movement_period_total', label: 'Movement period total', needsYears: 2, periods: 'start-end' },
  { id: 'movement_period_average', label: 'Movement period average', needsYears: 2, periods: 'start-end' },
  { id: 'movement_inflation_cumulative', label: 'Cumulative inflation', needsYears: 2, periods: 'start-end' },
  { id: 'period_total_growth', label: 'Period-total growth', needsYears: 2, periods: 'start-optional-mid-end' },
  { id: 'segmented_growth', label: 'Segmented growth', needsYears: 2, periods: 'start-optional-mid-end' },
]);

/**
 * Which year roles an operation uses, and which controls the builder shows.
 * Mirrors the backend analysis planner (domain/compareAnalysis.js); the
 * backend remains authoritative and reports the periods it actually used.
 */
export function comparePeriodRequirements(operation) {
  const def = COMPARE_OPERATIONS.find((op) => op.id === operation);
  const periods = def?.periods ?? 'start';
  return {
    periods,
    usesStart: true,
    usesEnd: periods !== 'start',
    usesMid: false,
    showOptionalMid: periods === 'start-end' || periods === 'start-optional-mid-end',
    requiresEnd: periods === 'start-optional-mid-end',
  };
}

const OPERATION_CHANGE_TYPE = Object.freeze({
  absolute_change: 'ABSOLUTE',
  percent_change: 'PERCENT',
  pp_change: 'PP',
  index_point_change: 'INDEX_POINT',
  cagr: 'CAGR',
  segmented_growth: 'PERCENT',
});

/** Period-aggregation capability each period operation needs. */
const OPERATION_PERIOD_TYPE = Object.freeze({
  period_total: 'SUM',
  period_average: 'AVG',
  period_total_growth: 'SUM',
});

export function operationsFor(metricKey) {
  const caps = metricCapabilities(metricKey);
  // Static fallback (pre-hydration GDP registry) mirrors backend semantics:
  // level always; change ops per known GDP declarations.
  const declared = caps ? caps.validChangeTypes : ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'];
  const periodAggregation = caps ? (caps.periodAggregation ?? []) : [];
  return COMPARE_OPERATIONS.filter((op) => {
    if (op.id === 'level') return true;
    if (op.id === 'cross_rate') {
      return caps
        ? caps.observationType === 'QUOTED_RATE' && caps.quotation?.convention === 'LCU_PER_USD'
        : false;
    }
    const periodType = OPERATION_PERIOD_TYPE[op.id];
    if (periodType) return periodAggregation.includes(periodType);
    return declared.includes(OPERATION_CHANGE_TYPE[op.id]);
  });
}

/** All operations with availability flags for one metric (for disabled UI). */
export function operationsWithAvailability(metricKey) {
  const allowed = new Set(operationsFor(metricKey).map((op) => op.id));
  return COMPARE_OPERATIONS.map((op) => ({
    ...op,
    available: allowed.has(op.id),
    disabledReason: allowed.has(op.id) ? null : 'Not declared for this metric',
  }));
}

/** True when a metric supports custom-group values at all (summed totals
 * or weighted ratios). Drives group-mode toggles and group-tab offers.
 */
export function supportsGroupValues(metricKey) {
  const caps = metricCapabilities(metricKey);
  if (!caps) return false;
  return caps.aggregation === 'SUM' || caps.aggregation === 'WEIGHTED_RATIO';
}

/**
 * Movement analysis bases derivable from backend metric capabilities.
 * Backend remains authoritative (it computes or refuses); this only decides
 * which analysis modes the UI offers, so terminology always matches the
 * actual calculation (Rule A/B): consecutive-year growth is Annual YoY,
 * multi-year endpoint percent is Period endpoint change, flows get
 * endpoint/period-total/period-average as distinct modes.
 */
/** Canonical Prices bases (metric-specific, never a shared list of 8). */
export const PRICES_BASES = Object.freeze({
  inflation_cpi_index: Object.freeze([
    Object.freeze({ id: 'cpi_index_annual', label: 'Annual CPI index', available: true, disabledReason: null }),
    Object.freeze({ id: 'cpi_index_period_change', label: 'Period CPI change (%)', available: true, disabledReason: null }),
  ]),
  inflation_cpi: Object.freeze([
    Object.freeze({ id: 'cpi_inflation_annual', label: 'Annual CPI inflation (%)', available: true, disabledReason: null }),
    Object.freeze({ id: 'cpi_inflation_average', label: 'Average annual CPI inflation (%)', available: true, disabledReason: null }),
    Object.freeze({ id: 'cpi_inflation_cumulative', label: 'Cumulative CPI inflation (%)', available: true, disabledReason: null }),
  ]),
  inflation_deflator: Object.freeze([
    Object.freeze({ id: 'deflator_annual', label: 'Annual GDP-deflator inflation (%)', available: true, disabledReason: null }),
    Object.freeze({ id: 'deflator_average', label: 'Average annual GDP-deflator inflation (%)', available: true, disabledReason: null }),
    Object.freeze({ id: 'deflator_cumulative', label: 'Cumulative GDP-deflator inflation (%)', available: true, disabledReason: null }),
  ]),
});

export function isPricesMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(PRICES_BASES, metricKey);
}

/** Canonical Trade bases (metric-specific, never a shared list of 8). */
export const TRADE_BASES = Object.freeze({
  exports_current: Object.freeze([
    Object.freeze({ id: 'exp_annual_value', label: 'Annual export value', available: true, disabledReason: null }),
    Object.freeze({ id: 'exp_period_cagr', label: 'Period export growth — CAGR', available: true, disabledReason: null }),
    Object.freeze({ id: 'exp_period_total', label: 'Period total export flow', available: true, disabledReason: null }),
    Object.freeze({ id: 'exp_period_average', label: 'Period average annual export flow', available: true, disabledReason: null }),
  ]),
  imports_current: Object.freeze([
    Object.freeze({ id: 'imp_annual_value', label: 'Annual import value', available: true, disabledReason: null }),
    Object.freeze({ id: 'imp_period_cagr', label: 'Period import growth — CAGR', available: true, disabledReason: null }),
    Object.freeze({ id: 'imp_period_total', label: 'Period total import flow', available: true, disabledReason: null }),
    Object.freeze({ id: 'imp_period_average', label: 'Period average annual import flow', available: true, disabledReason: null }),
  ]),
});

export function isTradeMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(TRADE_BASES, metricKey);
}

/**
 * Canonical Capital Flow bases (metric-specific, 3 + 3 ranked).
 * Endpoint diagnostics (Δ flow, Δ ratio) are intentionally NOT listed:
 * they are unranked descriptive companions, never primary bases.
 */
export const CAPITAL_BASES = Object.freeze({
  fdi_inflows: Object.freeze([
    Object.freeze({ id: 'fdi_annual_value', label: 'Annual net FDI', available: true, disabledReason: null }),
    Object.freeze({ id: 'fdi_period_cumulative', label: 'Cumulative net FDI', available: true, disabledReason: null }),
    Object.freeze({ id: 'fdi_period_average', label: 'Average annual net FDI', available: true, disabledReason: null }),
  ]),
  fdi_inflows_pct_gdp: Object.freeze([
    Object.freeze({ id: 'fdigdp_annual_value', label: 'Annual FDI (% of GDP)', available: true, disabledReason: null }),
    Object.freeze({ id: 'fdigdp_period_average', label: 'Average annual FDI (% of GDP)', available: true, disabledReason: null }),
    Object.freeze({ id: 'fdigdp_period_cumulative_share', label: 'Cumulative FDI / cumulative GDP', available: true, disabledReason: null }),
  ]),
});

export function isCapitalMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(CAPITAL_BASES, metricKey);
}

/**
 * Canonical Exchange Rate bases (3 user-facing; CAGR is display-only and
 * intentionally NOT listed). Basis A is descriptive-only (never ranked).
 */
export const FX_BASES = Object.freeze({
  fx_official: Object.freeze([
    Object.freeze({ id: 'fx_annual_rate', label: 'Annual Official FX Rate', available: true, disabledReason: null }),
    Object.freeze({ id: 'fx_annual_change', label: 'Annual Nominal FX Change', available: true, disabledReason: null }),
    Object.freeze({ id: 'fx_period_change', label: 'Period Nominal FX Change', available: true, disabledReason: null }),
  ]),
});

export function isFxMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(FX_BASES, metricKey);
}

/**
 * Canonical External Sector bases (metric-specific, 3 / 3 / 4 — never
 * forced symmetric). Benchmark statistic frozen per basis (median for
 * raw-scale bases, mean for normalized ratios).
 */
export const EXTERNAL_BASES = Object.freeze({
  current_account: Object.freeze([
    Object.freeze({ id: 'ca_annual_gdp', label: 'Annual CA / GDP', available: true, disabledReason: null }),
    Object.freeze({ id: 'ca_average_gdp', label: 'Average Annual CA / GDP', available: true, disabledReason: null }),
    Object.freeze({ id: 'ca_cumulative_share', label: 'Cumulative CA / Cumulative GDP', available: true, disabledReason: null }),
  ]),
  reserves_ex_gold: Object.freeze([
    Object.freeze({ id: 'res_annual_stock', label: 'Annual Reserve Stock', available: true, disabledReason: null }),
    Object.freeze({ id: 'res_period_change', label: 'Period Reserve-Stock Change', available: true, disabledReason: null }),
    Object.freeze({ id: 'res_import_coverage', label: 'Ex-Gold Reserve Import Coverage', available: true, disabledReason: null }),
  ]),
  remittances_received: Object.freeze([
    Object.freeze({ id: 'remit_annual_value', label: 'Annual Remittances Received', available: true, disabledReason: null }),
    Object.freeze({ id: 'remit_period_cumulative', label: 'Cumulative Remittances Received', available: true, disabledReason: null }),
    Object.freeze({ id: 'remit_period_average', label: 'Average Annual Remittances', available: true, disabledReason: null }),
    Object.freeze({ id: 'remit_cumulative_intensity', label: 'Cumulative Remittance Intensity', available: true, disabledReason: null }),
  ]),
});

export function isExternalMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(EXTERNAL_BASES, metricKey);
}

/**
 * Canonical Population bases (exactly 3; CAGR is display-only and
 * intentionally NOT listed; no cumulative/average bases exist).
 */
export const POPULATION_BASES = Object.freeze({
  population_total: Object.freeze([
    Object.freeze({ id: 'pop_annual_value', label: 'Annual Population', available: true, disabledReason: null }),
    Object.freeze({ id: 'pop_period_change', label: 'Period Population Change', available: true, disabledReason: null }),
    Object.freeze({ id: 'pop_period_growth', label: 'Period Population Growth', available: true, disabledReason: null }),
  ]),
});

export function isPopulationMetricKey(metricKey) {
  return Object.prototype.hasOwnProperty.call(POPULATION_BASES, metricKey);
}

/**
 * Selectable Movement bases for one metric: ONLY the bases the backend
 * capability metadata declares as available. Unsupported options are never
 * rendered (no disabled placeholders, no "not defined" rows) — an invalid
 * combination can still arrive via URL/deep-link, and the backend remains
 * authoritative by failing closed with a reason. Data-driven: option
 * availability derives from the hydrated backend registry, never from
 * per-component conditionals.
 */
export function movementBasisOptions(metricKey, yearA = null, yearB = null) {
  return movementBases(metricKey, yearA, yearB).filter((b) => b.available);
}

/** True when `basis` is a selectable Movement basis for `metricKey`. */
export function isMovementBasisAvailable(metricKey, basis, yearA = null, yearB = null) {
  return movementBasisOptions(metricKey, yearA, yearB).some((b) => b.id === basis);
}

export function movementBases(metricKey, yearA = null, yearB = null) {
  // Prices metrics expose ONLY their own approved subset (2 / 3 / 3).
  if (isPricesMetricKey(metricKey)) return PRICES_BASES[metricKey];
  // Trade metrics expose ONLY their own approved subset (4 / 4).
  if (isTradeMetricKey(metricKey)) return TRADE_BASES[metricKey];
  // Capital Flow metrics expose ONLY their own approved subset (3 / 3 ranked).
  if (isCapitalMetricKey(metricKey)) return CAPITAL_BASES[metricKey];
  // Exchange Rate exposes ONLY its 3 canonical bases (CAGR never listed).
  if (isFxMetricKey(metricKey)) return FX_BASES[metricKey];
  // External Sector exposes ONLY its canonical subsets (3 / 3 / 4).
  if (isExternalMetricKey(metricKey)) return EXTERNAL_BASES[metricKey];
  // Population exposes ONLY its 3 canonical bases (CAGR never listed).
  if (isPopulationMetricKey(metricKey)) return POPULATION_BASES[metricKey];
  const caps = metricCapabilities(metricKey);
  const subject = subjectOf(metricKey);
  const isFlow = caps?.observationType === 'FLOW';
  const declared = Array.isArray(caps?.validChangeTypes) ? caps.validChangeTypes : null;
  const yoyOffered = declared ? declared.includes('YOY') : true;
  const period = Array.isArray(caps?.periodAggregation) ? caps.periodAggregation : [];
  const consecutive = yearA != null && yearB != null && Math.abs(Number(yearB) - Number(yearA)) === 1;
  const growthLabel = isFlow
    ? 'Annual flow (endpoint B vs A)'
    : consecutive
      ? 'Annual YoY'
      : 'Period endpoint change';
  const levelLabel =
    subject === 'gdp_total'
      ? 'Total GDP level (value)'
      : subject === 'gdp_per_capita'
        ? 'Per-capita level (value)'
        : 'Level (value)';
  return Object.freeze([
    { id: 'level', label: levelLabel, available: true, disabledReason: null },
    {
      id: 'growth',
      label: growthLabel,
      available: yoyOffered,
      disabledReason: yoyOffered ? null : 'Growth analysis is not declared for this metric',
    },
    {
      id: 'period_total',
      label: 'Period total',
      available: period.includes('SUM'),
      disabledReason: period.includes('SUM') ? null : 'Period totals are not defined for this metric',
    },
    {
      id: 'period_average',
      label: 'Period average',
      available: period.includes('AVG'),
      disabledReason: period.includes('AVG') ? null : 'Period averages are not defined for this metric',
    },
  ]);
}

/**
 * Entity-aware operation availability: metric capability metadata PLUS
 * entity-kind rules, mirroring backend canCompare so the UI never offers
 * an operation the backend will reject with HTTP 400. Backend remains
 * authoritative (it re-validates); this only decides offers.
 *
 * @param {string} metricKey
 * @param {{kind:string, iso3?:string}|null} entityA
 * @param {{kind:string, iso3?:string}|null} entityB
 * @returns {{id, label, needsYears, available, disabledReason}[]}
 */
export function operationsForEntities(metricKey, entityA, entityB) {
  const caps = metricCapabilities(metricKey);
  const base = operationsWithAvailability(metricKey);
  // Entities unknown (builder incomplete): metric rules only; entity rules
  // apply once both sides are selected.
  if (!entityA || !entityB) return base;
  const kinds = [entityA.kind, entityB.kind];
  const involvesGroup = kinds.includes('custom_group');
  const groupSupported = supportsGroupValues(metricKey);
  const bothCountries = entityA.kind === 'country' && entityB.kind === 'country';
  // The metric registry declares which entity kinds may take part in a
  // comparison. The backend enforces it; the UI mirrors it so an
  // unsupported combination is never offered as if it were valid.
  const capability = caps?.comparisonCapability ?? [];
  const capabilityToken = (kind) =>
    kind === 'country' ? 'COUNTRY' : kind === 'wb_aggregate' ? 'OFFICIAL_AGGREGATE' : 'CUSTOM_GROUP';
  const capabilityLabel = (kind) =>
    kind === 'country' ? 'a country' : kind === 'wb_aggregate' ? 'an official aggregate' : 'a custom group';
  return base.map((op) => {
    if (!op.available) return op;
    if (capability.length > 0) {
      for (const kind of kinds) {
        if (!capability.includes(capabilityToken(kind))) {
          return { ...op, available: false, disabledReason: `This metric cannot be compared with ${capabilityLabel(kind)}` };
        }
      }
    }
    // Cross-rates need two country legs with compatible quotations.
    if (op.id === 'cross_rate' && !bothCountries) {
      return { ...op, available: false, disabledReason: 'Cross-rate needs two countries' };
    }
    // Groups need a group-capable aggregation (SUM totals or weighted ratio).
    if (involvesGroup && !groupSupported) {
      return { ...op, available: false, disabledReason: 'This metric has no group aggregation' };
    }
    // NEUTRAL metrics (quoted FX, index levels) have no cross-entity level
    // ordering: raw magnitudes across countries are not comparable.
    if (
      op.id === 'level' &&
      caps?.rankingDirection === 'NEUTRAL' &&
      bothCountries &&
      entityA.iso3 !== entityB.iso3
    ) {
      return { ...op, available: false, disabledReason: 'Raw levels are not comparable across countries for this metric' };
    }
    return op;
  });
}

/**
 * Compare's Analysis menu is a method picker, not a dump of every transform
 * the backend can theoretically calculate. Start with the methods Movement
 * approves for this metric, map those methods to the verified Compare API
 * operation, then add only a small set of Compare-specific calculations
 * whose measurement types make their units unambiguous.
 *
 * A missing mapping is deliberately omitted: a mathematical transform is
 * not sufficient evidence that it is the approved Movement method.
 */
const MOVEMENT_BASIS_COMPARE_OPERATION = Object.freeze({
  level: 'level',
  growth: 'percent_change',
  period_total: 'period_total',
  period_average: 'period_average',
  cpi_index_annual: 'level',
  cpi_index_period_change: 'percent_change',
  cpi_inflation_annual: 'level',
  deflator_annual: 'level',
  exp_annual_value: 'level',
  imp_annual_value: 'level',
  exp_period_cagr: 'cagr',
  imp_period_cagr: 'cagr',
  fdi_annual_value: 'level',
  fdigdp_annual_value: 'level',
  fdigdp_period_cumulative_share: 'level',
  fx_annual_rate: 'level',
  fx_annual_change: 'percent_change',
  fx_period_change: 'percent_change',
  res_annual_stock: 'level',
  res_period_change: 'absolute_change',
  res_import_coverage: 'level',
  ca_annual_gdp: 'level',
  ca_average_gdp: 'level',
  ca_cumulative_share: 'level',
  remit_annual_value: 'level',
  remit_cumulative_intensity: 'level',
  fdi_period_cumulative: 'movement_period_total',
  fdi_period_average: 'movement_period_average',
  fdigdp_period_average: 'movement_period_average',
  cpi_inflation_average: 'movement_period_average',
  deflator_average: 'movement_period_average',
  cpi_inflation_cumulative: 'movement_inflation_cumulative',
  deflator_cumulative: 'movement_inflation_cumulative',
  exp_period_total: 'movement_period_total',
  imp_period_total: 'movement_period_total',
  exp_period_average: 'movement_period_average',
  imp_period_average: 'movement_period_average',
  remit_period_cumulative: 'movement_period_total',
  remit_period_average: 'movement_period_average',
  pop_annual_value: 'level',
  pop_period_change: 'absolute_change',
  pop_period_growth: 'percent_change',
});

/** Operation selected internally for a registered Movement Basis choice. */
export function compareOperationForMovementBasis(basisId) {
  return MOVEMENT_BASIS_COMPARE_OPERATION[basisId] ?? null;
}

/** Available, method-aligned analyses for one Compare request. */
export function compareAnalysisOptions(metricKey, entityA, entityB, yearA = null, yearEnd = null) {
  const available = operationsForEntities(metricKey, entityA, entityB).filter((option) => option.available);
  const byId = new Map(available.map((option) => [option.id, option]));
  const options = [];
  const used = new Set();

  for (const basis of movementBasisOptions(metricKey, yearA, yearEnd)) {
    if (basis.id === 'fx_annual_change' && !(yearA != null && yearEnd != null && Number(yearEnd) - Number(yearA) === 1)) continue;
    const operation = MOVEMENT_BASIS_COMPARE_OPERATION[basis.id];
    if (!operation || used.has(operation)) continue;
    if (!byId.has(operation)) {
      const caps = metricCapabilities(metricKey);
      const entityKinds = [entityA?.kind, entityB?.kind].filter(Boolean);
      const capabilityToken = (kind) => kind === 'country' ? 'COUNTRY' : kind === 'wb_aggregate' ? 'OFFICIAL_AGGREGATE' : 'CUSTOM_GROUP';
      const supportsEntities = !caps?.comparisonCapability?.length || entityKinds.every((kind) => caps.comparisonCapability.includes(capabilityToken(kind)));
      const supportsGroups = !entityKinds.includes('custom_group') || supportsGroupValues(metricKey);
      if (!['movement_period_total', 'movement_period_average', 'movement_inflation_cumulative'].includes(operation) || !supportsEntities || !supportsGroups) continue;
    }
    const label = basis.id === 'fx_annual_change' ? 'Annual Nominal FX Change' : basis.label;
    options.push({ value: operation, label, methodId: basis.id, source: 'movement' });
    used.add(operation);
  }

  // Absolute endpoint differences are a meaningful Compare-specific method
  // for additive or level measures; unlike rank change, the unit is retained.
  if (byId.has('absolute_change') && !used.has('absolute_change')) {
    options.push({ value: 'absolute_change', label: 'Absolute change', source: 'compare' });
    used.add('absolute_change');
  }
  for (const [operation, label] of [
    ['cagr', 'CAGR'],
    ['segmented_growth', 'Segmented growth'],
  ]) {
    if (byId.has(operation) && !used.has(operation)) {
      options.push({ value: operation, label, source: 'compare' });
      used.add(operation);
    }
  }
  if (byId.has('period_total_growth') && !used.has('period_total_growth')) {
    options.push({ value: 'period_total_growth', label: 'Growth in adjacent period totals', source: 'compare' });
    used.add('period_total_growth');
  }
  // Percentage-point and index-point differences are only offered for their
  // declared measurement types, where those units have a clear meaning.
  const type = metricCapabilities(metricKey)?.observationType;
  for (const [operation, validType, label] of [
    ['pp_change', 'RATE', 'Percentage-point change'],
    ['index_point_change', 'INDEX', 'Index-point change'],
  ]) {
    if (type === validType && byId.has(operation) && !used.has(operation)) {
      options.push({ value: operation, label, source: 'compare' });
      used.add(operation);
    }
  }
  // Cross-rate is a Compare-only operation with explicit country-leg rules.
  if (byId.has('cross_rate') && !used.has('cross_rate')) {
    options.push({ value: 'cross_rate', label: 'Cross-rate', source: 'compare' });
    used.add('cross_rate');
  }
  return options;
}

/**
 * Basis choices for Compare: every available Movement method for this metric,
 * plus capability-approved Compare-only operations. Movement choices keep
 * their registered ids; Compare-only choices use a namespaced id so their
 * UI selection cannot be confused with a source series or Movement method.
 */
export function compareMethodOptions(metricKey, entityA, entityB, yearA = null, yearEnd = null) {
  if (!metricKey) return [];
  const caps = metricCapabilities(metricKey);
  const entities = [entityA, entityB].filter(Boolean);
  const capabilityToken = (kind) => kind === 'country' ? 'COUNTRY' : kind === 'wb_aggregate' ? 'OFFICIAL_AGGREGATE' : 'CUSTOM_GROUP';
  const entitiesCompatible = (!caps?.comparisonCapability?.length || entities.every((entity) => caps.comparisonCapability.includes(capabilityToken(entity.kind))))
    && (!entities.some((entity) => entity.kind === 'custom_group') || supportsGroupValues(metricKey));
  const available = new Set(
    operationsForEntities(metricKey, entityA, entityB)
      .filter((option) => option.available)
      .map((option) => option.id),
  );
  const movement = movementBasisOptions(metricKey, yearA, yearEnd).map((basis) => {
    const operation = compareOperationForMovementBasis(basis.id);
    const movementOnlyOperation = ['movement_period_total', 'movement_period_average', 'movement_inflation_cumulative'].includes(operation);
    // Generic Movement methods (level, growth, period total/average) describe
    // the calculation, not a source-series basis. GDP Compare validates its
    // `basis` request field against canonical metric keys, so keep the chosen
    // metric as the series identity while passing the method as `operation`.
    // Specialized Movement bases remain their own registered IDs because
    // they resolve one or more source legs in the backend.
    const genericMethod = ['level', 'growth', 'period_total', 'period_average'].includes(basis.id);
    return {
      value: basis.id,
      label: basis.label,
      operation,
      requestBasis: genericMethod ? metricKey : basis.id,
      source: 'movement',
      disabled: !operation || !entitiesCompatible || (!available.has(operation) && !movementOnlyOperation),
      disabledReason: !operation
        ? 'No Compare calculation is registered for this Movement method.'
        : !entitiesCompatible
          ? 'This metric does not support the selected entity types.'
          : null,
    };
  });
  const coveredOperations = new Set(movement.filter((entry) => !entry.disabled).map((entry) => entry.operation));
  const extras = compareAnalysisOptions(metricKey, entityA, entityB, yearA, yearEnd)
    .filter((option) => option.source === 'compare' && !coveredOperations.has(option.value))
    .map((option) => ({
      value: `compare:${option.value}`,
      label: option.label,
      operation: option.value,
      requestBasis: metricKey,
      source: 'compare',
      disabled: false,
      disabledReason: null,
    }));
  return [...movement, ...extras];
}

/** Human-readable observation-type label for metric headers. */
export function observationTypeLabel(type) {
  switch (type) {
    case 'LEVEL': return 'Level';
    case 'FLOW': return 'Flow';
    case 'RATE': return 'Rate (annual %)';
    case 'RATIO': return 'Ratio';
    case 'INDEX': return 'Index';
    case 'QUOTED_RATE': return 'Quoted rate';
    default: return null;
  }
}
