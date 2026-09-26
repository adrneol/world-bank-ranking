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
    displayDecimals: 0,
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    title: 'Real GDP per capita — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.PCAP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_per_capita',
    displayDecimals: 0,
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    title: 'GDP per capita, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.PCAP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_per_capita',
    displayDecimals: 0,
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    title: 'GDP per capita, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.PCAP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_per_capita',
    displayDecimals: 0,
  }),
  total_current: Object.freeze({
    key: 'total_current',
    title: 'Total GDP — current US$',
    shortTitle: 'Nominal — Current US$',
    indicatorCode: 'NY.GDP.MKTP.CD',
    unit: 'current US$',
    subject: 'gdp_total',
    displayDecimals: 2,
  }),
  total_constant: Object.freeze({
    key: 'total_constant',
    title: 'Total GDP — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.MKTP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_total',
    displayDecimals: 2,
  }),
  total_ppp_current: Object.freeze({
    key: 'total_ppp_current',
    title: 'Total GDP, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.MKTP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_total',
    displayDecimals: 2,
  }),
  total_ppp_constant: Object.freeze({
    key: 'total_ppp_constant',
    title: 'Total GDP, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.MKTP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_total',
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
 * Compare operations derivable from a metric's declared change types.
 * Backend remains authoritative (it re-validates); this only decides which
 * actions the UI offers, so an unsupported button can never be rendered.
 */
export const COMPARE_OPERATIONS = Object.freeze([
  { id: 'level', label: 'Level', needsYears: 1 },
  { id: 'absolute_change', label: 'Absolute change', needsYears: 2 },
  { id: 'percent_change', label: 'Percent change', needsYears: 2 },
  { id: 'pp_change', label: 'Percentage-point change', needsYears: 2 },
  { id: 'index_point_change', label: 'Index-point change', needsYears: 2 },
  { id: 'cagr', label: 'CAGR', needsYears: 2 },
  { id: 'cross_rate', label: 'Cross-rate', needsYears: 1 },
]);

const OPERATION_CHANGE_TYPE = Object.freeze({
  absolute_change: 'ABSOLUTE',
  percent_change: 'PERCENT',
  pp_change: 'PP',
  index_point_change: 'INDEX_POINT',
  cagr: 'CAGR',
});

export function operationsFor(metricKey) {
  const caps = metricCapabilities(metricKey);
  // Static fallback (pre-hydration GDP registry) mirrors backend semantics:
  // level always; change ops per known GDP declarations.
  const declared = caps ? caps.validChangeTypes : ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'];
  return COMPARE_OPERATIONS.filter((op) => {
    if (op.id === 'level') return true;
    if (op.id === 'cross_rate') {
      return caps
        ? caps.observationType === 'QUOTED_RATE' && caps.quotation?.convention === 'LCU_PER_USD'
        : false;
    }
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
  return base.map((op) => {
    if (!op.available) return op;
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
