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
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    title: 'Real GDP per capita — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.PCAP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_per_capita',
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    title: 'GDP per capita, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.PCAP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_per_capita',
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    title: 'GDP per capita, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.PCAP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_per_capita',
  }),
  total_current: Object.freeze({
    key: 'total_current',
    title: 'Total GDP — current US$',
    shortTitle: 'Nominal — Current US$',
    indicatorCode: 'NY.GDP.MKTP.CD',
    unit: 'current US$',
    subject: 'gdp_total',
  }),
  total_constant: Object.freeze({
    key: 'total_constant',
    title: 'Total GDP — constant 2015 US$',
    shortTitle: 'Real — Constant 2015 US$',
    indicatorCode: 'NY.GDP.MKTP.KD',
    unit: 'constant 2015 US$',
    subject: 'gdp_total',
  }),
  total_ppp_current: Object.freeze({
    key: 'total_ppp_current',
    title: 'Total GDP, PPP — current international $',
    shortTitle: 'PPP — Current international $',
    indicatorCode: 'NY.GDP.MKTP.PP.CD',
    unit: 'current international $',
    subject: 'gdp_total',
  }),
  total_ppp_constant: Object.freeze({
    key: 'total_ppp_constant',
    title: 'Total GDP, PPP — constant 2021 international $',
    shortTitle: 'PPP — Constant 2021 international $',
    indicatorCode: 'NY.GDP.MKTP.PP.KD',
    unit: 'constant 2021 international $',
    subject: 'gdp_total',
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
        subject: entry.subject,
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
