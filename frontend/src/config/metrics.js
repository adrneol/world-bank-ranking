/**
 * Centralized metric presentation metadata (ONE definition).
 *
 * Display-only: titles, indicator codes and unit labels. Values, ranks, YoY
 * percentages and denominators always come from backend responses — nothing
 * here participates in any calculation.
 */

export const METRICS = Object.freeze({
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
    title: 'Nominal GDP per capita — constant 2015 US$',
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
export const METRIC_KEYS = Object.freeze(['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant']);

/** Every known metric key, in registry order (registry-wide use only). */
export const ALL_METRIC_KEYS = Object.freeze(Object.keys(METRICS));

/**
 * Analysis subjects (display grouping only — never a second metric identity).
 * The metric key stays the single source of truth; the subject is always
 * derived from it, so the two can never disagree.
 */
export const SUBJECTS = Object.freeze({
  gdp_per_capita: Object.freeze({
    key: 'gdp_per_capita',
    label: 'GDP per capita',
    metricKeys: METRIC_KEYS,
  }),
  gdp_total: Object.freeze({
    key: 'gdp_total',
    label: 'Total GDP',
    metricKeys: Object.freeze(['total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant']),
  }),
});

export const SUBJECT_KEYS = Object.freeze(Object.keys(SUBJECTS));

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
