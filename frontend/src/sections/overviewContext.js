import { seriesColor } from '../components/charts/annualGeometry.js';
import { isPercentageUnit } from '../components/charts/chartFormat.js';
import { METRICS, metricKeysForSubject } from '../config/metrics.js';

export const REAL_GROWTH_ID = 'real_gdp_growth';
const PRICE_RATES = ['inflation_cpi', 'inflation_deflator', REAL_GROWTH_ID];
const MULTI_SERIES_SUBJECTS = new Set(['gdp_total', 'gdp_per_capita', 'trade']);
const HISTORY_LABELS = {
  total_current: 'Nominal GDP',
  total_constant: 'Real GDP',
  total_ppp_current: 'PPP GDP',
  total_ppp_constant: 'Real PPP GDP',
  exports_current: 'Exports',
  imports_current: 'Imports',
};

export function historySeries(id) {
  const derived = id === REAL_GROWTH_ID;
  const metric = METRICS[derived ? 'total_constant' : id];
  if (!metric) return null;
  const { subject, title, shortTitle, indicatorCode, displayDecimals } = metric;
  const unit = derived ? 'annual %' : metric.unitLong ?? metric.unit;
  const label = derived ? 'Real GDP growth' : HISTORY_LABELS[id] ?? shortTitle.split(' — ')[0];
  const name = derived ? label : title.split(' — ')[0];
  const annualRate = PRICE_RATES.includes(id);
  const colorIndex = annualRate ? 4 + PRICE_RATES.indexOf(id) : metricKeysForSubject(subject).indexOf(id);
  return {
    id, metricKey: metric.key, label, name, subject, colorIndex, color: seriesColor(Math.max(0, colorIndex)), title: derived ? label : title, indicatorCode, unit, derived,
    decimals: derived ? 2 : displayDecimals,
    percentage: isPercentageUnit(unit),
    basis: subject === 'gdp_per_capita' && !derived ? unit + ' per person' : unit,
    axis: annualRate ? 'annual-percentage' : JSON.stringify([subject, metric.priceBasis, metric.currencyBasis, metric.baseYear, unit]),
  };
}

export function relatedHistorySeries(primary) {
  const metric = METRICS[primary];
  if (!metric) return [];
  let ids = MULTI_SERIES_SUBJECTS.has(metric.subject) ? metricKeysForSubject(metric.subject) : [];
  if (primary === 'total_constant') ids = [...ids, ...PRICE_RATES];
  if (PRICE_RATES.includes(primary) && primary !== REAL_GROWTH_ID) ids = PRICE_RATES;
  return ids.filter((id) => id !== primary).map(historySeries).filter(Boolean);
}
