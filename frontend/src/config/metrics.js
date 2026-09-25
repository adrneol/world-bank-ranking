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

/** True when a metric can produce a summed custom-group value. */
export function supportsGroupSum(metricKey) {
  const caps = metricCapabilities(metricKey);
  if (!caps) return false;
  return caps.aggregation === 'SUM';
}

/**
 * True when a metric supports custom-group values at all (summed totals
 * or weighted ratios). Drives group-mode toggles and group-tab offers.
 */
export function supportsGroupValues(metricKey) {
  const caps = metricCapabilities(metricKey);
  if (!caps) return false;
  return caps.aggregation === 'SUM' || caps.aggregation === 'WEIGHTED_RATIO';
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
