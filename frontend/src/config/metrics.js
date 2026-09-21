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
    shortTitle: 'Nominal Current',
    indicatorCode: 'NY.GDP.PCAP.CD',
    unit: 'current US$',
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    title: 'Nominal GDP per capita — constant 2015 US$',
    shortTitle: 'Nominal Constant 2015',
    indicatorCode: 'NY.GDP.PCAP.KD',
    unit: 'constant 2015 US$',
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    title: 'GDP per capita, PPP — current international $',
    shortTitle: 'PPP Current',
    indicatorCode: 'NY.GDP.PCAP.PP.CD',
    unit: 'current international $',
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    title: 'GDP per capita, PPP — constant 2021 international $',
    shortTitle: 'PPP Constant 2021',
    indicatorCode: 'NY.GDP.PCAP.PP.KD',
    unit: 'constant 2021 international $',
  }),
});

export const METRIC_KEYS = Object.freeze(Object.keys(METRICS));

export function resolveMetricKey(input) {
  if (!input) return null;
  if (METRICS[input]) return input;
  const upper = String(input).toUpperCase();
  const found = METRIC_KEYS.find((key) => METRICS[key].indicatorCode.toUpperCase() === upper);
  return found ?? null;
}

export function metricLabel(key) {
  return METRICS[key]?.shortTitle ?? key;
}

export function metricTitle(key) {
  return METRICS[key]?.title ?? key;
}
