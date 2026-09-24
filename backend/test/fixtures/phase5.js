/**
 * PHASE-5 TEST SERIES (synthetic, deterministic, offline).
 *
 * Covers the twelve promoted Phase-5 metrics so the stub World Bank API can
 * serve them and the ingestion pipeline (including official-aggregate storage)
 * can be tested without the live API.
 *
 * Data honesty:
 *   - The IND 2024 values below are the exact values observed on the LIVE
 *     World Bank API for vintage 2026-07-13 (verified during the Phase-5
 *     audit, including WLD aggregates where World Bank publishes them).
 *     They prove a raw value survives ingestion, storage and the API
 *     unchanged — including a SIGNED negative current-account flow and
 *     explicit null WLD rows where World Bank publishes no aggregate.
 *   - Every OTHER value/entity/year is SYNTHETIC (fixed multipliers). It
 *     exists only to exercise the pipeline; it is never presented as World
 *     Bank data.
 *   - Aggregate / blank-ISO3 / unknown-country / null rows exist on purpose
 *     so aggregate storage vs universe exclusion can be proven per series.
 */

export const PHASE5_LAST_UPDATED = '2026-07-13';

export const PHASE5_METRIC_KEYS = Object.freeze([
  'inflation_cpi',
  'inflation_cpi_index',
  'inflation_deflator',
  'fx_official',
  'exports_current',
  'imports_current',
  'fdi_inflows',
  'fdi_inflows_pct_gdp',
  'current_account',
  'reserves_ex_gold',
  'remittances_received',
  'population_total',
]);

export const PHASE5_INDICATOR_CODES = Object.freeze({
  inflation_cpi: 'FP.CPI.TOTL.ZG',
  inflation_cpi_index: 'FP.CPI.TOTL',
  inflation_deflator: 'NY.GDP.DEFL.KD.ZG',
  fx_official: 'PA.NUS.FCRF',
  exports_current: 'NE.EXP.GNFS.CD',
  imports_current: 'NE.IMP.GNFS.CD',
  fdi_inflows: 'BX.KLT.DINV.CD.WD',
  fdi_inflows_pct_gdp: 'BX.KLT.DINV.WD.GD.ZS',
  current_account: 'BN.CAB.XOKA.CD',
  reserves_ex_gold: 'FI.RES.XGLD.CD',
  remittances_received: 'BX.TRF.PWKR.CD.DT',
  population_total: 'SP.POP.TOTL',
});

export const PHASE5_INDICATOR_NAMES = Object.freeze({
  inflation_cpi: 'Inflation, consumer prices (annual %)',
  inflation_cpi_index: 'Consumer price index (2010 = 100)',
  inflation_deflator: 'Inflation, GDP deflator (annual %)',
  fx_official: 'Official exchange rate (LCU per US$, period average)',
  exports_current: 'Exports of goods and services (current US$)',
  imports_current: 'Imports of goods and services (current US$)',
  fdi_inflows: 'Foreign direct investment, net inflows (BoP, current US$)',
  fdi_inflows_pct_gdp: 'Foreign direct investment, net inflows (% of GDP)',
  current_account: 'Current account balance (BoP, current US$)',
  reserves_ex_gold: 'Total reserves minus gold (current US$)',
  remittances_received: 'Personal remittances, received (current US$)',
  population_total: 'Population, total',
});

/** Live-verified IND 2024 values (vintage 2026-07-13). */
const IND_2024 = Object.freeze({
  inflation_cpi: 4.95303550973661,
  inflation_cpi_index: 227.603278134168,
  inflation_deflator: 2.46685658180814,
  fx_official: 83.669281580941,
  exports_current: 829785193474.459,
  imports_current: 897055898132,
  fdi_inflows: 27139853378.1402,
  fdi_inflows_pct_gdp: 0.721648483526777,
  current_account: -32015418428.3174,
  reserves_ex_gold: 569544279505.316,
  remittances_received: 137674533895.686,
  population_total: 1450935791,
});

/** Live-verified WLD 2024 values where World Bank publishes an aggregate. */
const WLD_2024 = Object.freeze({
  inflation_cpi: 3.01447576977999,
  inflation_deflator: 4.08757566272939,
  exports_current: 32471017522322.1,
  imports_current: 31392679664388.6,
  fdi_inflows: 1570606386034.38,
  fdi_inflows_pct_gdp: 1.36470917779216,
  remittances_received: 856609714692.509,
  population_total: 8140897523,
  // CPI index, FX, current account and reserves publish NO world aggregate
  // (live-verified null): callers must expect null WLD rows for these.
  inflation_cpi_index: null,
  fx_official: null,
  current_account: null,
  reserves_ex_gold: null,
});

/** Eligible economies in the fixture and their synthetic size multiplier. */
const ECONOMIES = Object.freeze({
  IND: { name: 'India', factor: 1, countryId: 'IN' },
  USA: { name: 'United States', factor: 7.6, countryId: 'US' },
  DEU: { name: 'Germany', factor: 1.15, countryId: 'DE' },
  PAK: { name: 'Pakistan', factor: 0.09, countryId: 'PK' },
  XKX: { name: 'Kosovo', factor: 0.0025, countryId: 'XK' },
});

/** Synthetic 2025 drift per metric (IND 2025 is synthetic by construction). */
const DRIFT_2025 = Object.freeze({
  inflation_cpi: 0.92,
  inflation_cpi_index: 1.048,
  inflation_deflator: 1.12,
  fx_official: 1.015,
  exports_current: 1.06,
  imports_current: 1.04,
  fdi_inflows: 0.97,
  fdi_inflows_pct_gdp: 0.9,
  current_account: 1.1,
  reserves_ex_gold: 0.99,
  remittances_received: 1.15,
  population_total: 1.009,
});

/** Signed-flow factors: current account has surplus and deficit members. */
const CA_FACTOR = Object.freeze({ IND: 1, USA: 30, DEU: -5, PAK: 0.1, XKX: 0.001 });

function row(metricKey, iso3, countryId, countryName, year, value) {
  return {
    indicator: { id: PHASE5_INDICATOR_CODES[metricKey], value: `Phase-5 fixture (${metricKey})` },
    country: { id: countryId, value: countryName },
    countryiso3code: iso3,
    date: String(year),
    value,
    unit: '',
    obs_status: '',
    decimal: 6,
  };
}

/** World-Bank-shaped observation rows for one Phase-5 metric. */
export function phase5Rows(metricKey) {
  if (!PHASE5_METRIC_KEYS.includes(metricKey)) {
    throw new Error(`Unknown Phase-5 fixture metric: ${metricKey}`);
  }
  const rows = [];
  for (const [iso3, economy] of Object.entries(ECONOMIES)) {
    const factor = metricKey === 'current_account' ? CA_FACTOR[iso3] : economy.factor;
    const base2024 = iso3 === 'IND' ? IND_2024[metricKey] : IND_2024[metricKey] * factor;
    rows.push(row(metricKey, iso3, economy.countryId, economy.name, 2024, base2024));
    // PAK 2025 exports are null on purpose (missing-data handling per series).
    const value2025 = metricKey === 'exports_current' && iso3 === 'PAK'
      ? null
      : base2024 * DRIFT_2025[metricKey];
    rows.push(row(metricKey, iso3, economy.countryId, economy.name, 2025, value2025));
  }
  // Official WLD aggregate: a real value where published, an explicit null
  // where World Bank publishes none (both cases must be handled, not stored
  // as zero and never reconstructed).
  const wld2024 = WLD_2024[metricKey];
  rows.push(row(metricKey, 'WLD', '1W', 'World', 2024, wld2024));
  rows.push(row(metricKey, 'WLD', '1W', 'World', 2025, wld2024 === null ? null : wld2024 * 1.02));
  // Income-group aggregate published with a BLANK ISO3 code (excluded).
  rows.push(row(metricKey, '', 'XD', 'High income', 2024, 45545.9));
  // ISO3 absent from country metadata entirely (excluded).
  rows.push(row(metricKey, 'ZZZ', 'ZZ', 'Nowhere', 2024, 999));
  return rows;
}

/** The live-verified IND 2024 value for a metric (test expectations). */
export function liveIndia2024(metricKey) {
  if (IND_2024[metricKey] === undefined) throw new Error(`No live fixture value for ${metricKey}`);
  return IND_2024[metricKey];
}

/** The live-verified WLD 2024 value (null where WB publishes none). */
export function liveWorld2024(metricKey) {
  if (!(metricKey in WLD_2024)) throw new Error(`No live fixture aggregate for ${metricKey}`);
  return WLD_2024[metricKey];
}

/** metric key for an exact indicator code, or null when not a Phase-5 code. */
export function phase5MetricKeyForCode(code) {
  const upper = String(code).toUpperCase();
  return PHASE5_METRIC_KEYS.find((key) => PHASE5_INDICATOR_CODES[key].toUpperCase() === upper) ?? null;
}

/** Indicator metadata row shaped like the World Bank /indicator response. */
export function phase5IndicatorMetadataRow(metricKey) {
  return {
    id: PHASE5_INDICATOR_CODES[metricKey],
    name: PHASE5_INDICATOR_NAMES[metricKey],
    unit: '',
    source: { id: '2', value: 'World Development Indicators' },
    sourceNote: `Phase-5 fixture metadata for ${metricKey}`,
    sourceOrganization: 'Stub (offline fixture)',
  };
}

export default { phase5Rows, liveIndia2024, liveWorld2024, phase5MetricKeyForCode, phase5IndicatorMetadataRow };
