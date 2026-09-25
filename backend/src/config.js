/**
 * Central configuration.
 *
 * Every World Bank setting (base URL, indicator codes, defaults) is read from
 * the environment here and nowhere else. No indicator code is hardcoded deeper
 * in the codebase.
 *
 * The World Bank Indicators API is OPEN: it requires NO API KEY. The only
 * secret this application knows is the optional manual-refresh admin token
 * (REFRESH_ADMIN_TOKEN), which is never logged and never sent to clients.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** backend/ directory (the package root of this workspace). */
export const BACKEND_ROOT = path.resolve(__dirname, '..');

// Load backend/.env if present. Node >=20.12 provides process.loadEnvFile.
// Absence of the file is fine: real environment variables take precedence and
// the defaults below are used.
try {
  process.loadEnvFile(path.join(BACKEND_ROOT, '.env'));
} catch {
  // No .env file - fall back to defaults / real environment variables.
}

function str(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  return String(raw).trim();
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be an integer, received: ${raw}`);
  }
  return n;
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number, received: ${raw}`);
  }
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`Environment variable ${name} must be a boolean, received: ${raw}`);
}

/**
 * CANONICAL WORLD BANK INDICATOR CODES — IMMUTABLE IN PRODUCTION.
 *
 * This map is the single source of truth for which World Bank series each
 * metric key means. Production ALWAYS uses these exact codes: environment
 * variables can NEVER substitute a different series in production (see
 * indicatorCodeFor below). Test-only overrides exist solely so tests can
 * prove the fail-closed behavior, gated behind NODE_ENV=test AND an explicit
 * opt-in flag.
 */
export const CANONICAL_INDICATOR_CODES = Object.freeze({
  nominal_current: 'NY.GDP.PCAP.CD',
  nominal_constant: 'NY.GDP.PCAP.KD',
  ppp_current: 'NY.GDP.PCAP.PP.CD',
  ppp_constant: 'NY.GDP.PCAP.PP.KD',
  total_current: 'NY.GDP.MKTP.CD',
  total_constant: 'NY.GDP.MKTP.KD',
  total_ppp_current: 'NY.GDP.MKTP.PP.CD',
  total_ppp_constant: 'NY.GDP.MKTP.PP.KD',
  // Phase-5 promotions (each live-verified; see verified evidence on entries).
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

/** Historical environment variable name per metric (test-override channel only). */
const INDICATOR_ENV_VARS = Object.freeze({
  nominal_current: 'WORLD_BANK_NOMINAL_CURRENT_INDICATOR',
  nominal_constant: 'WORLD_BANK_NOMINAL_CONSTANT_INDICATOR',
  ppp_current: 'WORLD_BANK_PPP_CURRENT_INDICATOR',
  ppp_constant: 'WORLD_BANK_PPP_CONSTANT_INDICATOR',
  total_current: 'WORLD_BANK_TOTAL_CURRENT_INDICATOR',
  total_constant: 'WORLD_BANK_TOTAL_CONSTANT_INDICATOR',
  total_ppp_current: 'WORLD_BANK_TOTAL_PPP_CURRENT_INDICATOR',
  total_ppp_constant: 'WORLD_BANK_TOTAL_PPP_CONSTANT_INDICATOR',
  inflation_cpi: 'WORLD_BANK_INFLATION_CPI_INDICATOR',
  inflation_cpi_index: 'WORLD_BANK_INFLATION_CPI_INDEX_INDICATOR',
  inflation_deflator: 'WORLD_BANK_INFLATION_DEFLATOR_INDICATOR',
  fx_official: 'WORLD_BANK_FX_OFFICIAL_INDICATOR',
  exports_current: 'WORLD_BANK_EXPORTS_CURRENT_INDICATOR',
  imports_current: 'WORLD_BANK_IMPORTS_CURRENT_INDICATOR',
  fdi_inflows: 'WORLD_BANK_FDI_INFLOWS_INDICATOR',
  fdi_inflows_pct_gdp: 'WORLD_BANK_FDI_INFLOWS_PCT_GDP_INDICATOR',
  current_account: 'WORLD_BANK_CURRENT_ACCOUNT_INDICATOR',
  reserves_ex_gold: 'WORLD_BANK_RESERVES_EX_GOLD_INDICATOR',
  remittances_received: 'WORLD_BANK_REMITTANCES_RECEIVED_INDICATOR',
  population_total: 'WORLD_BANK_POPULATION_TOTAL_INDICATOR',
});

/**
 * Whether test-only indicator-code overrides are permitted. BOTH conditions
 * are required: running under NODE_ENV=test AND the explicit opt-in flag.
 * Production (and any non-test process) always takes the canonical branch.
 */
export function testIndicatorOverridesEnabled() {
  return process.env.NODE_ENV === 'test' && process.env.WB_ALLOW_TEST_INDICATOR_OVERRIDES === '1';
}

/**
 * Resolve the World Bank indicator code for a metric key.
 *
 * Production path: ALWAYS the canonical code. If the corresponding
 * environment variable is set to anything else, throw loudly instead of
 * silently pointing the registry at the wrong World Bank series.
 */
export function indicatorCodeFor(metricKey) {
  const canonical = CANONICAL_INDICATOR_CODES[metricKey];
  if (!canonical) throw new Error(`No canonical World Bank indicator for metric "${metricKey}".`);
  if (!testIndicatorOverridesEnabled()) {
    const attempted = process.env[INDICATOR_ENV_VARS[metricKey]];
    if (attempted !== undefined && attempted !== null && String(attempted).trim() !== '' && String(attempted).trim() !== canonical) {
      throw new Error(
        `Refusing to substitute the World Bank indicator for "${metricKey}": ` +
        `production registry is canonical (${canonical}); ` +
        `overrides require NODE_ENV=test and WB_ALLOW_TEST_INDICATOR_OVERRIDES=1.`,
      );
    }
    return canonical;
  }
  return str(INDICATOR_ENV_VARS[metricKey], canonical);
}

/**
 * SEMANTIC MEASURE VOCABULARIES (Phase 2: metadata foundation for future
 * indicator families). Every value below is a closed vocabulary validated at
 * import time by assertRegistryIntegrity()/assertFutureDefinitions().
 *
 * These describe what a number IS and what may later be done with it. They
 * change no calculation today: Phase 3 consumes validChangeTypes,
 * rankingDirection and aggregation; Phase 4 consumes comparisonCapability.
 * Declaring ASC or PP here enables nothing until those phases implement it.
 */
export const OBSERVATION_TYPES = Object.freeze(['LEVEL', 'FLOW', 'RATE', 'RATIO', 'INDEX', 'QUOTED_RATE']);
export const CHANGE_TYPES = Object.freeze([
  'ABSOLUTE',
  'PERCENT',
  'PP',
  'INDEX_POINT',
  'YOY',
  'CAGR',
  // Group/cross primitives (Phase 3): declared in validChangeTypes only if a
  // future measure needs point-level gating; group orchestration gates on
  // aggregation/quotation metadata instead (see canTransform).
  'GROUP_SUM',
  'GROUP_RATIO_FROM_SUMS',
  'CROSS_RATE',
]);
export const RANKING_DIRECTIONS = Object.freeze(['DESC', 'ASC', 'NEUTRAL']);
export const MEASURE_INTERPRETATIONS = Object.freeze([
  'MORE_IS_MORE',
  'LOWER_PREFERRED_IN_STABILITY',
  'NEUTRAL',
  'CONTEXT_DEPENDENT',
]);
export const AGGREGATION_MODES = Object.freeze(['SUM', 'WEIGHTED_RATIO', 'OFFICIAL_ONLY', 'MEMBER_ONLY', 'NOT_AGGREGATABLE']);
// Period aggregation over time (Phase 7C-1): which multi-year period
// statistics may be computed from a metric's annual observations. SUM and
// AVG apply to FLOW semantics (summing annual flows over [A,B)); every
// other family declares none. An empty list means NONE — levels never sum
// over time, rates/ratios/indexes/quoted rates never inherit flow periods.
export const PERIOD_AGGREGATION_MODES = Object.freeze(['SUM', 'AVG']);
export const ENTITY_KINDS = Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']);
export const SIGN_DOMAINS = Object.freeze(['POSITIVE_ONLY', 'NON_NEGATIVE', 'SIGNED']);
export const LIFECYCLE_STATES = Object.freeze(['PRODUCTION', 'SUPPORTED', 'DEFINED']);
// priceBasis/currencyBasis predate Phase 2 ('current'/'constant', units); the
// NOT_APPLICABLE sentinel covers measures where the concept is meaningless
// (rates, ratios, indexes, quoted rates have no price basis; non-monetary
// measures have no currency basis). Explicit is better than null here.
export const NOT_APPLICABLE = 'NOT_APPLICABLE';

/**
 * SUBJECT-AWARE METRIC REGISTRY (one authoritative source for the backend).
 *
 * `key` is the API/UI identifier. `indicatorCode` is the exact World Bank WDI
 * indicator code. `unit` is the World Bank unit. `subject` places each metric in
 * exactly one analysis subject (see SUBJECTS below). Never compare values across
 * metrics: each is an independent series with its own ranking and denominator.
 *
 * Subject: GDP PER CAPITA — the four original metrics.
 * Their keys, World Bank codes, environment variables, ordering and semantics
 * are FROZEN for backward compatibility.
 */
const GDP_PER_CAPITA_METRICS = Object.freeze({
  nominal_current: Object.freeze({
    key: 'nominal_current',
    indicatorCode: indicatorCodeFor('nominal_current'),
    label: 'Nominal — Current US$',
    shortLabel: 'Nominal Current',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'nominal',
    priceBasis: 'current',
    subject: 'gdp_per_capita',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD',
    displayDecimals: 0,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_PER_CAPITA',
    observationType: 'LEVEL',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'NOT_AGGREGATABLE',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    indicatorCode: indicatorCodeFor('nominal_constant'),
    label: 'Real — Constant 2015 US$',
    shortLabel: 'Nominal Constant 2015',
    unit: 'constant 2015 US$',
    unitLong: 'constant 2015 US$',
    currencySymbol: '$',
    group: 'nominal',
    priceBasis: 'constant',
    subject: 'gdp_per_capita',
    ppp: false,
    baseYear: 2015,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.KD',
    displayDecimals: 0,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_PER_CAPITA',
    observationType: 'LEVEL',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'NOT_AGGREGATABLE',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    indicatorCode: indicatorCodeFor('ppp_current'),
    label: 'PPP — Current international $',
    shortLabel: 'PPP Current',
    unit: 'current international $',
    unitLong: 'current international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'current',
    subject: 'gdp_per_capita',
    ppp: true,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD',
    displayDecimals: 0,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_PER_CAPITA',
    observationType: 'LEVEL',
    currencyBasis: 'INTERNATIONAL_DOLLAR',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'NOT_AGGREGATABLE',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    indicatorCode: indicatorCodeFor('ppp_constant'),
    label: 'PPP — Constant 2021 international $',
    shortLabel: 'PPP Constant 2021',
    unit: 'constant 2021 international $',
    unitLong: 'constant 2021 international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'constant',
    subject: 'gdp_per_capita',
    ppp: true,
    baseYear: 2021,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.KD',
    displayDecimals: 0,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_PER_CAPITA',
    observationType: 'LEVEL',
    currencyBasis: 'INTERNATIONAL_DOLLAR',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'NOT_AGGREGATABLE',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
});

/**
 * Subject: TOTAL GDP — four additional VERIFIED raw World Bank series.
 *
 * Terminology (economically exact):
 *   current  = current-price GDP ("GDP (current US$)")          -> never "real"
 *   constant = constant-price GDP, i.e. WDI's real GDP          -> never "nominal"
 *   ppp_*    = PPP-converted series (purchasing power parities)
 *
 * Every code below was verified against https://api.worldbank.org/v2/indicator.
 * No synthetic, rebased, deflated or derived series may ever be registered here.
 * Total GDP values are on the order of 10^12-10^13 US$; `displayScaleHint` is a
 * PRESENTATION-ONLY hint (domain/format.js) and never touches a calculation.
 */
const TOTAL_GDP_METRICS = Object.freeze({
  total_current: Object.freeze({
    key: 'total_current',
    subject: 'gdp_total',
    indicatorCode: indicatorCodeFor('total_current'),
    label: 'Total GDP — Nominal — Current US$',
    shortLabel: 'Current US$',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'usd',
    priceBasis: 'current',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_TOTAL',
    observationType: 'LEVEL',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  total_constant: Object.freeze({
    key: 'total_constant',
    subject: 'gdp_total',
    indicatorCode: indicatorCodeFor('total_constant'),
    label: 'Total GDP — Real — Constant 2015 US$',
    shortLabel: 'Constant 2015 US$',
    unit: 'constant 2015 US$',
    unitLong: 'constant 2015 US$',
    currencySymbol: '$',
    group: 'usd',
    priceBasis: 'constant',
    ppp: false,
    baseYear: 2015,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_TOTAL',
    observationType: 'LEVEL',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  total_ppp_current: Object.freeze({
    key: 'total_ppp_current',
    subject: 'gdp_total',
    indicatorCode: indicatorCodeFor('total_ppp_current'),
    label: 'Total GDP — PPP — Current international $',
    shortLabel: 'PPP Current',
    unit: 'current international $',
    unitLong: 'current international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'current',
    ppp: true,
    baseYear: null,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.PP.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_TOTAL',
    observationType: 'LEVEL',
    currencyBasis: 'INTERNATIONAL_DOLLAR',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
  total_ppp_constant: Object.freeze({
    key: 'total_ppp_constant',
    subject: 'gdp_total',
    indicatorCode: indicatorCodeFor('total_ppp_constant'),
    label: 'Total GDP — PPP — Constant 2021 international $',
    shortLabel: 'PPP Constant 2021',
    unit: 'constant 2021 international $',
    unitLong: 'constant 2021 international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'constant',
    ppp: true,
    baseYear: 2021,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.PP.KD',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    domain: 'NATIONAL_ACCOUNTS',
    family: 'GDP_TOTAL',
    observationType: 'LEVEL',
    currencyBasis: 'INTERNATIONAL_DOLLAR',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    // MORE_IS_MORE describes rank ordering by magnitude (higher value ranks
    // first). It is NOT an economic-welfare judgment about countries.
    interpretation: 'MORE_IS_MORE',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
  }),
});

/**
 * Subject: PRICES — CPI inflation (rate), CPI index and GDP-deflator inflation.
 *
 * All three verified live 2026-09-24 and re-verified unchanged at Phase-5
 * promotion. Annual rate vs cumulative index vs whole-economy deflator are
 * different concepts sharing a subject grouping only: no cross-metric math.
 * Rate changes are percentage-point changes (PERCENT deliberately undeclared);
 * index movement is index points, never percentage points.
 */
const PRICES_METRICS = Object.freeze({
  inflation_cpi: Object.freeze({
    key: 'inflation_cpi',
    subject: 'prices',
    indicatorCode: indicatorCodeFor('inflation_cpi'),
    label: 'CPI inflation — annual %',
    shortLabel: 'CPI inflation',
    unit: 'annual %',
    unitLong: 'annual %',
    currencySymbol: null,
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    domain: 'PRICES',
    family: 'INFLATION_CPI',
    observationType: 'RATE',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PP']),
    aggregation: 'OFFICIAL_ONLY',
    rankingDirection: 'ASC',
    interpretation: 'LOWER_PREFERRED_IN_STABILITY',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/FP.CPI.TOTL.ZG?format=json (re-verified unchanged at promotion)',
      name: 'Inflation, consumer prices (annual %)',
    }),
  }),
  inflation_cpi_index: Object.freeze({
    key: 'inflation_cpi_index',
    subject: 'prices',
    indicatorCode: indicatorCodeFor('inflation_cpi_index'),
    label: 'CPI index — 2010 = 100',
    shortLabel: 'CPI index',
    unit: 'index (2010 = 100)',
    unitLong: 'index points (2010 = 100)',
    currencySymbol: null,
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    domain: 'PRICES',
    family: 'INFLATION_CPI',
    observationType: 'INDEX',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'INDEX_POINT']),
    aggregation: 'OFFICIAL_ONLY',
    rankingDirection: 'NEUTRAL',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: 2010,
    worldBankPage: 'https://data.worldbank.org/indicator/FP.CPI.TOTL',
    displayDecimals: 1,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/FP.CPI.TOTL?format=json (re-verified unchanged at promotion)',
      name: 'Consumer price index (2010 = 100)',
    }),
  }),
  inflation_deflator: Object.freeze({
    key: 'inflation_deflator',
    subject: 'prices',
    indicatorCode: indicatorCodeFor('inflation_deflator'),
    label: 'GDP-deflator inflation — annual %',
    shortLabel: 'GDP-deflator inflation',
    unit: 'annual %',
    unitLong: 'annual %',
    currencySymbol: null,
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    domain: 'PRICES',
    family: 'INFLATION_DEFLATOR',
    observationType: 'RATE',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PP']),
    aggregation: 'OFFICIAL_ONLY',
    rankingDirection: 'ASC',
    interpretation: 'LOWER_PREFERRED_IN_STABILITY',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.DEFL.KD.ZG',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NY.GDP.DEFL.KD.ZG?format=json (re-verified unchanged at promotion)',
      name: 'Inflation, GDP deflator (annual %)',
    }),
  }),
});

/**
 * Subject: TRADE — current-US$ goods-and-services flows.
 * Additive flows: group SUM valid; never mixed across price bases.
 */
const TRADE_METRICS = Object.freeze({
  exports_current: Object.freeze({
    key: 'exports_current',
    subject: 'trade',
    indicatorCode: indicatorCodeFor('exports_current'),
    label: 'Exports — current US$',
    shortLabel: 'Exports, current US$',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'trade',
    priceBasis: 'current',
    domain: 'TRADE',
    family: 'EXPORTS',
    observationType: 'FLOW',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NE.EXP.GNFS.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze(['SUM', 'AVG']),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NE.EXP.GNFS.CD?format=json (re-verified unchanged at promotion)',
      name: 'Exports of goods and services (current US$)',
    }),
  }),
  imports_current: Object.freeze({
    key: 'imports_current',
    subject: 'trade',
    indicatorCode: indicatorCodeFor('imports_current'),
    label: 'Imports — current US$',
    shortLabel: 'Imports, current US$',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'trade',
    priceBasis: 'current',
    domain: 'TRADE',
    family: 'IMPORTS',
    observationType: 'FLOW',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'trillions',
    worldBankPage: 'https://data.worldbank.org/indicator/NE.IMP.GNFS.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze(['SUM', 'AVG']),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NE.IMP.GNFS.CD?format=json (re-verified unchanged at promotion)',
      name: 'Imports of goods and services (current US$)',
    }),
  }),
});

/**
 * Subject: CAPITAL FLOWS — signed FDI level plus the official FDI/GDP ratio.
 * Net flows may be zero/negative: PERCENT is undeclared for the level (Phase-3
 * validity), and the ratio changes in percentage points via the World Bank
 * ratio directly (never reconstructed, never summed).
 */
const CAPITAL_FLOWS_METRICS = Object.freeze({
  fdi_inflows: Object.freeze({
    key: 'fdi_inflows',
    subject: 'capital_flows',
    indicatorCode: indicatorCodeFor('fdi_inflows'),
    label: 'FDI net inflows — current US$',
    shortLabel: 'FDI net inflows',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'flows',
    priceBasis: 'current',
    domain: 'EXTERNAL',
    family: 'FDI',
    observationType: 'FLOW',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'YOY']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'billions',
    worldBankPage: 'https://data.worldbank.org/indicator/BX.KLT.DINV.CD.WD',
    displayDecimals: 2,
    periodAggregation: Object.freeze(['SUM', 'AVG']),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BX.KLT.DINV.CD.WD?format=json (re-verified unchanged at promotion)',
      name: 'Foreign direct investment, net inflows (BoP, current US$)',
    }),
  }),
  fdi_inflows_pct_gdp: Object.freeze({
    key: 'fdi_inflows_pct_gdp',
    subject: 'capital_flows',
    indicatorCode: indicatorCodeFor('fdi_inflows_pct_gdp'),
    label: 'FDI net inflows — % of GDP',
    shortLabel: 'FDI net inflows, % of GDP',
    unit: '% of GDP',
    unitLong: '% of GDP',
    currencySymbol: null,
    group: 'flows',
    priceBasis: NOT_APPLICABLE,
    domain: 'EXTERNAL',
    family: 'FDI',
    observationType: 'RATIO',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PP']),
    aggregation: 'WEIGHTED_RATIO',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    // Canonical denominator linkage for the approved weighted group ratio
    // (Phase 7C-2): current-price FDI numerator (BX.KLT.DINV.CD.WD,
    // priceBasis 'current', currencyBasis 'USD') over current-price total
    // GDP (total_current, NY.GDP.MKTP.CD — same basis by construction).
    // Group ratio = SUM(FDI legs) / SUM(GDP legs) x 100 for the same
    // group/year; never average(member %) nor sum(member %). Declared
    // here so no service hard-codes a GDP series.
    requiredDenominator: Object.freeze({ metricKey: 'total_current', numeratorMetric: 'fdi_inflows', basis: 'current-price USD' }),
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/BX.KLT.DINV.WD.GD.ZS',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BX.KLT.DINV.WD.GD.ZS?format=json (re-verified unchanged at promotion)',
      name: 'Foreign direct investment, net inflows (% of GDP)',
    }),
  }),
});

/**
 * Subject: EXCHANGE RATES — official LCU-per-USD rate.
 * Increase = local depreciation, decrease = appreciation (quotation stored
 * once). No official world aggregate exists (WLD is null): MEMBER_ONLY.
 * YOY here means annual movement (percent), the valid FX change semantic.
 */
const EXCHANGE_METRICS = Object.freeze({
  fx_official: Object.freeze({
    key: 'fx_official',
    subject: 'exchange',
    indicatorCode: indicatorCodeFor('fx_official'),
    label: 'Official exchange rate — LCU per US$',
    shortLabel: 'Official FX vs USD',
    unit: 'LCU per US$',
    unitLong: 'local currency units per US$ (period average)',
    currencySymbol: null,
    group: 'fx',
    priceBasis: NOT_APPLICABLE,
    domain: 'FINANCIAL',
    family: 'EXCHANGE_RATE',
    observationType: 'QUOTED_RATE',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY']),
    aggregation: 'MEMBER_ONLY',
    rankingDirection: 'NEUTRAL',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: Object.freeze({ convention: 'LCU_PER_USD', base: 'USD' }),
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/PA.NUS.FCRF',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/PA.NUS.FCRF?format=json (re-verified unchanged at promotion)',
      name: 'Official exchange rate (LCU per US$, period average)',
    }),
  }),
});

/**
 * Subject: EXTERNAL SECTOR — signed current-account flow, reserve stock and
 * remittance flow. Current account is signed (live-verified negative for
 * India); reserves are a stock level, not a flow.
 */
const EXTERNAL_METRICS = Object.freeze({
  current_account: Object.freeze({
    key: 'current_account',
    subject: 'external',
    indicatorCode: indicatorCodeFor('current_account'),
    label: 'Current account balance — current US$',
    shortLabel: 'Current account',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'external',
    priceBasis: 'current',
    domain: 'EXTERNAL',
    family: 'CURRENT_ACCOUNT',
    observationType: 'FLOW',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'YOY']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'billions',
    worldBankPage: 'https://data.worldbank.org/indicator/BN.CAB.XOKA.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze(['SUM', 'AVG']),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BN.CAB.XOKA.CD?format=json (live-verified at promotion; signed flow)',
      name: 'Current account balance (BoP, current US$)',
    }),
  }),
  reserves_ex_gold: Object.freeze({
    key: 'reserves_ex_gold',
    subject: 'external',
    indicatorCode: indicatorCodeFor('reserves_ex_gold'),
    label: 'Reserves minus gold — current US$',
    shortLabel: 'Reserves ex-gold',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'external',
    priceBasis: 'current',
    domain: 'EXTERNAL',
    family: 'RESERVES',
    observationType: 'LEVEL',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'billions',
    worldBankPage: 'https://data.worldbank.org/indicator/FI.RES.XGLD.CD',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/FI.RES.XGLD.CD?format=json (live-verified at promotion)',
      name: 'Total reserves minus gold (current US$)',
    }),
  }),
  remittances_received: Object.freeze({
    key: 'remittances_received',
    subject: 'external',
    indicatorCode: indicatorCodeFor('remittances_received'),
    label: 'Remittances received — current US$',
    shortLabel: 'Remittances received',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'external',
    priceBasis: 'current',
    domain: 'EXTERNAL',
    family: 'REMITTANCES',
    observationType: 'FLOW',
    currencyBasis: 'USD',
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'billions',
    worldBankPage: 'https://data.worldbank.org/indicator/BX.TRF.PWKR.CD.DT',
    displayDecimals: 2,
    periodAggregation: Object.freeze(['SUM', 'AVG']),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BX.TRF.PWKR.CD.DT?format=json (live-verified at promotion)',
      name: 'Personal remittances, received (current US$)',
    }),
  }),
});

/**
 * Subject: POPULATION — midyear de-facto count level. Denominator
 * infrastructure for future per-capita derivation (no derivation in Phase 5).
 */
const POPULATION_METRICS = Object.freeze({
  population_total: Object.freeze({
    key: 'population_total',
    subject: 'population',
    indicatorCode: indicatorCodeFor('population_total'),
    label: 'Population — total',
    shortLabel: 'Population',
    unit: 'people',
    unitLong: 'people',
    currencySymbol: null,
    group: 'population',
    priceBasis: NOT_APPLICABLE,
    domain: 'DEMOGRAPHICS',
    family: 'POPULATION',
    observationType: 'LEVEL',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR']),
    aggregation: 'SUM',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'PRODUCTION',
    ppp: false,
    baseYear: null,
    displayScaleHint: 'billions',
    worldBankPage: 'https://data.worldbank.org/indicator/SP.POP.TOTL',
    displayDecimals: 2,
    periodAggregation: Object.freeze([]),
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/SP.POP.TOTL?format=json (live-verified at promotion)',
      name: 'Population, total',
    }),
  }),
});

/** The complete production registry: GDP subjects plus Phase-5 families. */
export const METRICS = Object.freeze({
  ...GDP_PER_CAPITA_METRICS,
  ...TOTAL_GDP_METRICS,
  ...PRICES_METRICS,
  ...TRADE_METRICS,
  ...CAPITAL_FLOWS_METRICS,
  ...EXCHANGE_METRICS,
  ...EXTERNAL_METRICS,
  ...POPULATION_METRICS,
});

/**
 * Ordered list of metric keys of the GDP-PER-CAPITA subject, in canonical
 * display order. This is the historical default used by the levels/years/yoy
 * endpoints and MUST keep exactly these four keys: existing URLs and clients
 * depend on it, and no per-capita view may silently expand to eight metrics.
 */
export const METRIC_KEYS = Object.freeze(Object.keys(GDP_PER_CAPITA_METRICS));

/** Ordered list of the Total GDP subject's metric keys. */
export const TOTAL_GDP_METRIC_KEYS = Object.freeze(Object.keys(TOTAL_GDP_METRICS));

/** Ordered metric keys per Phase-5 subject, in canonical display order. */
export const PRICES_METRIC_KEYS = Object.freeze(Object.keys(PRICES_METRICS));
export const TRADE_METRIC_KEYS = Object.freeze(Object.keys(TRADE_METRICS));
export const CAPITAL_FLOWS_METRIC_KEYS = Object.freeze(Object.keys(CAPITAL_FLOWS_METRICS));
export const EXCHANGE_METRIC_KEYS = Object.freeze(Object.keys(EXCHANGE_METRICS));
export const EXTERNAL_METRIC_KEYS = Object.freeze(Object.keys(EXTERNAL_METRICS));
export const POPULATION_METRIC_KEYS = Object.freeze(Object.keys(POPULATION_METRICS));

/** Every configured metric, in registry order (registry-wide operations only). */
export const ALL_METRIC_KEYS = Object.freeze(Object.keys(METRICS));

/**
 * PRODUCTION-ENABLED METRIC KEYS (Phase 2 lifecycle).
 *
 * DEFINED (in METRICS or FUTURE_METRIC_DEFINITIONS) vs SUPPORTED (verified
 * code + declared semantics) vs PRODUCTION (ingested by refresh, required by
 * integrity) vs INGESTED (indicator row actually present in the database,
 * derived at runtime) are four different states. Only PRODUCTION metrics
 * enter the production refresh/integrity universe. ALL_METRIC_KEYS keeps its
 * historical meaning (every metric in the production registry); disabled
 * future definitions live in FUTURE_METRIC_DEFINITIONS and can never widen
 * it until an explicit promotion moves them into METRICS (Phase 5).
 */
export const PRODUCTION_METRIC_KEYS = Object.freeze(
  ALL_METRIC_KEYS.filter((key) => METRICS[key].lifecycle === 'PRODUCTION'),
);

/** True when a metric key belongs to the production-enabled set. */
export function isProductionMetric(key) {
  return PRODUCTION_METRIC_KEYS.includes(key);
}

/**
 * ANALYSIS SUBJECTS. A subject is purely a grouping: no subject-level
 * arithmetic exists. Each metric belongs to exactly one subject, so the subject
 * is always derivable from a metric key (single source of truth).
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
    metricKeys: TOTAL_GDP_METRIC_KEYS,
  }),
  prices: Object.freeze({
    key: 'prices',
    label: 'Prices',
    metricKeys: PRICES_METRIC_KEYS,
  }),
  trade: Object.freeze({
    key: 'trade',
    label: 'Trade',
    metricKeys: TRADE_METRIC_KEYS,
  }),
  capital_flows: Object.freeze({
    key: 'capital_flows',
    label: 'Capital flows',
    metricKeys: CAPITAL_FLOWS_METRIC_KEYS,
  }),
  exchange: Object.freeze({
    key: 'exchange',
    label: 'Exchange rates',
    metricKeys: EXCHANGE_METRIC_KEYS,
  }),
  external: Object.freeze({
    key: 'external',
    label: 'External sector',
    metricKeys: EXTERNAL_METRIC_KEYS,
  }),
  population: Object.freeze({
    key: 'population',
    label: 'Population',
    metricKeys: POPULATION_METRIC_KEYS,
  }),
});

/** Ordered list of subject keys, in canonical display order. */
export const SUBJECT_KEYS = Object.freeze(Object.keys(SUBJECTS));

/**
 * DEFINED-BUT-DISABLED FUTURE MEASURE DEFINITIONS.
 *
 * Phase 5 promoted every verified Phase-2 definition into METRICS, so this
 * map is intentionally empty. The mechanism is retained: a future measure
 * is SUPPORTED here (verified code + declared semantics, validated by
 * assertFutureDefinitions) while staying out of getMetric(), SUBJECTS,
 * ingestion and integrity until an explicit promotion moves it into METRICS.
 */
export const FUTURE_METRIC_DEFINITIONS = Object.freeze({});

/** Ordered keys of the defined-but-disabled future measures. */
export const FUTURE_METRIC_KEYS = Object.freeze(Object.keys(FUTURE_METRIC_DEFINITIONS));

/**
 * Resolve a metric by key. Throws on unknown keys so that a typo can never
 * silently fall back to a different indicator. Accepts an exact, REGISTERED
 * World Bank indicator code as well — an unregistered code can never resolve,
 * so the curated registry stays the only source of valid identities.
 */
export function getMetric(key) {
  if (!key) throw new Error('Metric key is required');
  const byKey = METRICS[key];
  if (byKey) return byKey;
  const byCode = ALL_METRIC_KEYS.map((k) => METRICS[k]).find(
    (m) => m.indicatorCode.toUpperCase() === String(key).toUpperCase(),
  );
  if (byCode) return byCode;
  throw new Error(
    `Unknown metric "${key}". Valid keys: ${ALL_METRIC_KEYS.join(', ')} ` +
      `(or an exact World Bank indicator code).`,
  );
}

/**
 * Resolve any DEFINED measure: production metrics plus disabled future
 * definitions. Metadata display only (registry catalog, /api/indicators):
 * routes, ingestion and integrity must keep using getMetric(), which sees
 * production metrics alone, so disabled keys stay 400/unknown everywhere
 * analytical until an explicit promotion.
 */
export function getDefinedMetric(key) {
  if (!key) throw new Error('Measure key is required');
  const direct = METRICS[key] ?? FUTURE_METRIC_DEFINITIONS[key];
  if (direct) return direct;
  const byCode = [...ALL_METRIC_KEYS.map((k) => METRICS[k]), ...FUTURE_METRIC_KEYS.map((k) => FUTURE_METRIC_DEFINITIONS[k])].find(
    (m) => m.indicatorCode.toUpperCase() === String(key).toUpperCase(),
  );
  if (byCode) return byCode;
  throw new Error(`Unknown measure "${key}".`);
}

/** Resolve a subject by key. Throws on unknown subjects (fail closed). */
export function getSubject(key) {
  if (!key) throw new Error('Subject key is required');
  const subject = SUBJECTS[key];
  if (!subject) {
    throw new Error(
      `Unknown subject "${key}". Valid subjects: ${SUBJECT_KEYS.join(', ')}.`,
    );
  }
  return subject;
}

/** The subject a metric belongs to. Throws when the metric is unknown. */
export function subjectOf(metricKey) {
  return getMetric(metricKey).subject;
}

/** The metric keys of one subject, in canonical order. Throws when unknown. */
export function metricKeysForSubject(subjectKey) {
  return getSubject(subjectKey).metricKeys;
}

/**
 * Subject metadata for the API and the audit panel: key, label and the metric
 * keys belonging to each subject. No numbers, no calculations.
 */
export function describeSubjects() {
  return SUBJECT_KEYS.map((subjectKey) => {
    const subject = SUBJECTS[subjectKey];
    return {
      key: subject.key,
      label: subject.label,
      metricKeys: [...subject.metricKeys],
    };
  });
}

/**
 * Shared semantic-field validation for one measure entry (production metrics
 * and disabled future definitions alike). Throws on the first violation so a
 * malformed measure can never serve metadata, let alone numbers.
 *
 * @param {string} key registry key of the entry
 * @param {object} metric the frozen entry
 * @param {{prospectiveSubject:boolean}} options disabled definitions declare
 *        subjects that must NOT exist yet (wired only at promotion)
 */
export function assertSemanticFields(key, metric, { prospectiveSubject = false } = {}) {
  const fail = (message) => {
    throw new Error(`Measure "${key}": ${message}.`);
  };
  for (const field of ['domain', 'family', 'frequency']) {
    if (!metric[field] || typeof metric[field] !== 'string') fail(`missing required field "${field}"`);
  }
  if (!OBSERVATION_TYPES.includes(metric.observationType)) {
    fail(`unknown observationType "${metric.observationType}" (expected one of ${OBSERVATION_TYPES.join(', ')})`);
  }
  if (!Array.isArray(metric.validChangeTypes) || metric.validChangeTypes.length === 0) {
    fail('validChangeTypes must be a non-empty list');
  }
  for (const change of metric.validChangeTypes) {
    if (!CHANGE_TYPES.includes(change)) fail(`unknown change type "${change}" (expected one of ${CHANGE_TYPES.join(', ')})`);
  }
  if (!RANKING_DIRECTIONS.includes(metric.rankingDirection)) {
    fail(`unknown rankingDirection "${metric.rankingDirection}"`);
  }
  if (!MEASURE_INTERPRETATIONS.includes(metric.interpretation)) {
    fail(`unknown interpretation "${metric.interpretation}"`);
  }
  if (!AGGREGATION_MODES.includes(metric.aggregation)) {
    fail(`unknown aggregation "${metric.aggregation}"`);
  }
  if (!Array.isArray(metric.comparisonCapability) || metric.comparisonCapability.length === 0) {
    fail('comparisonCapability must be a non-empty list');
  }
  for (const kind of metric.comparisonCapability) {
    if (!ENTITY_KINDS.includes(kind)) fail(`unknown entity kind "${kind}"`);
  }
  if (!SIGN_DOMAINS.includes(metric.signDomain)) fail(`unknown signDomain "${metric.signDomain}"`);
  if (!LIFECYCLE_STATES.includes(metric.lifecycle)) fail(`unknown lifecycle "${metric.lifecycle}"`);
  if (metric.requiredDenominator !== null && typeof metric.requiredDenominator !== 'object') {
    fail('requiredDenominator must be null or a descriptor object');
  }
  // Weighted-ratio linkage (Phase 7C-2): a declared denominator must name a
  // registered metric key so group-ratio legs resolve canonically.
  if (metric.requiredDenominator !== null) {
    if (typeof metric.requiredDenominator.metricKey !== 'string' || !metric.requiredDenominator.metricKey) {
      fail('requiredDenominator must declare a metricKey');
    }
    // A declared numerator leg must also resolve: basis compatibility is
    // checked between the two leg series, never against the ratio itself
    // (a ratio has no price basis of its own).
    if (metric.requiredDenominator.numeratorMetric !== undefined) {
      if (typeof metric.requiredDenominator.numeratorMetric !== 'string' || !metric.requiredDenominator.numeratorMetric) {
        fail('requiredDenominator.numeratorMetric must be a metric key string when present');
      }
    }
  }
  // Quotation convention is stored exactly once, on quoted rates only, so
  // appreciation/depreciation can never be re-inferred at call sites.
  if (metric.observationType === 'QUOTED_RATE') {
    if (!metric.quotation || metric.quotation.convention !== 'LCU_PER_USD' || !metric.quotation.base) {
      fail('QUOTED_RATE measures must declare quotation { convention: LCU_PER_USD, base }');
    }
  } else if (metric.quotation !== null) {
    fail('only QUOTED_RATE measures may declare a quotation convention');
  }
  if (!metric.derivation || !['RAW', 'APP_DERIVED'].includes(metric.derivation.kind)) {
    fail('derivation.kind must be RAW or APP_DERIVED');
  }
  if (metric.derivation.kind === 'APP_DERIVED' && (!metric.derivation.formula || !metric.derivation.inputs)) {
    fail('APP_DERIVED measures must record formula and inputs');
  }
  if (!metric.subject || typeof metric.subject !== 'string') fail('missing subject');
  // Display precision is a registry contract, not a call-site guess: a
  // non-negative integer every formatter (backend + frontend) honors.
  if (!Number.isInteger(metric.displayDecimals) || metric.displayDecimals < 0) {
    fail('displayDecimals must be a non-negative integer');
  }
  // Period aggregation over time (Phase 7C-1): a closed list of allowed
  // period statistics. Only FLOW metrics declare SUM/AVG; every other
  // family declares none, so period sums can never leak into levels,
  // rates, ratios, indexes or quoted rates. Fail closed on unknown entries.
  if (!Array.isArray(metric.periodAggregation)) {
    fail('periodAggregation must be a list (possibly empty)');
  }
  for (const op of metric.periodAggregation) {
    if (!PERIOD_AGGREGATION_MODES.includes(op)) {
      fail(`unknown periodAggregation "${op}" (expected one of ${PERIOD_AGGREGATION_MODES.join(', ')})`);
    }
  }
  if (prospectiveSubject && SUBJECTS[metric.subject]) {
    fail(`prospective subject "${metric.subject}" already exists; promote the measure instead`);
  }
  if (!prospectiveSubject && !SUBJECTS[metric.subject]) {
    fail(`unknown subject "${metric.subject}"`);
  }
}

/**
 * REGISTRY INVARIANTS (fail closed at import time).
 *
 *   1. every metric's `key` matches its registry key
 *   2. metric keys are unique (object keys are; asserted explicitly)
 *   3. World Bank indicator codes are unique — two metrics can never share a
 *      series, which would make two "different" analyses silently identical
 *   3b. every metric's code equals the CANONICAL code for its key — a
 *      substituted series fails loudly instead of becoming "registry-valid"
 *   4. every metric declares a subject that exists
 *   5. every subject references only registered metrics whose subject matches
 *   6. every metric is reachable from exactly one subject
 *   7. each metric declares the fields the response formatter needs
 */
export function assertRegistryIntegrity() {
  const seenCodes = new Map();
  for (const [key, metric] of Object.entries(METRICS)) {
    if (metric.key !== key) {
      throw new Error(`Registry mismatch: entry "${key}" declares key "${metric.key}".`);
    }
    const code = String(metric.indicatorCode ?? '').toUpperCase();
    if (!code) throw new Error(`Metric "${key}" has no World Bank indicator code.`);
    if (seenCodes.has(code)) {
      throw new Error(
        `Duplicate World Bank indicator code "${metric.indicatorCode}" used by "${key}" and "${seenCodes.get(code)}".`,
      );
    }
    seenCodes.set(code, key);
    if (!testIndicatorOverridesEnabled() && metric.indicatorCode !== CANONICAL_INDICATOR_CODES[key]) {
      throw new Error(
        `Metric "${key}" does not use its canonical World Bank indicator ` +
        `("${CANONICAL_INDICATOR_CODES[key]}"). Refusing a substituted series.`,
      );
    }
    if (!metric.subject || !SUBJECTS[metric.subject]) {
      throw new Error(`Metric "${key}" declares unknown subject "${metric.subject}".`);
    }
    // Weighted-ratio linkage must resolve to a registered metric so leg
    // resolution can never point at an unregistered series.
    if (metric.requiredDenominator !== null && metric.requiredDenominator !== undefined) {
      const denKey = metric.requiredDenominator.metricKey;
      if (!denKey || !METRICS[denKey]) {
        throw new Error(`Metric "${key}" declares unknown denominator metric "${denKey}".`);
      }
      const numKey = metric.requiredDenominator.numeratorMetric;
      if (numKey !== undefined && !METRICS[numKey]) {
        throw new Error(`Metric "${key}" declares unknown numerator metric "${numKey}".`);
      }
    }
    for (const field of ['label', 'shortLabel', 'unit', 'unitLong', 'priceBasis']) {
      if (!metric[field]) throw new Error(`Metric "${key}" is missing required field "${field}".`);
    }
    if (metric.lifecycle !== 'PRODUCTION') {
      throw new Error(`Production metric "${key}" must declare lifecycle "PRODUCTION".`);
    }
    // Semantic contract consumed by Phase 3 (transforms) and Phase 4
    // (comparison). Declaring it changes no calculation in Phase 2.
    assertSemanticFields(key, metric);
  }

  const reachable = [];
  for (const subjectKey of SUBJECT_KEYS) {
    const subject = SUBJECTS[subjectKey];
    if (subject.key !== subjectKey) {
      throw new Error(`Subject registry mismatch: entry "${subjectKey}".`);
    }
    if (!Array.isArray(subject.metricKeys) || subject.metricKeys.length === 0) {
      throw new Error(`Subject "${subjectKey}" has no metrics.`);
    }
    for (const metricKey of subject.metricKeys) {
      const metric = METRICS[metricKey];
      if (!metric) throw new Error(`Subject "${subjectKey}" references unknown metric "${metricKey}".`);
      if (metric.subject !== subjectKey) {
        throw new Error(`Metric "${metricKey}" declared under "${subjectKey}" belongs to "${metric.subject}".`);
      }
      reachable.push(metricKey);
    }
  }
  if (new Set(reachable).size !== reachable.length) {
    throw new Error('A metric is referenced by more than one subject.');
  }
  if (reachable.length !== ALL_METRIC_KEYS.length) {
    throw new Error('Every registered metric must belong to exactly one subject.');
  }
  return true;
}

/**
 * DISABLED-DEFINITION INVARIANTS (fail closed at import time).
 *
 *   1. every definition's `key` matches its map key
 *   2. keys and World Bank codes are unique — including against the
 *      production registry (a future code may never shadow a live series)
 *   3. every code is a verified literal: production substitution machinery
 *      (CANONICAL_INDICATOR_CODES / indicatorCodeFor) is production-only, so
 *      disabled definitions carry no env-var channel at all
 *   4. lifecycle is SUPPORTED or DEFINED — never PRODUCTION (promotion is an
 *      explicit move into METRICS, never a flag flip in place)
 *   5. subjects stay prospective (not in SUBJECTS) so the subject partition
 *      invariant cannot drift before promotion
 *   6. full semantic contract validated, so Phase 3 can trust the metadata
 */
export function assertFutureDefinitions() {
  const productionCodes = new Set(ALL_METRIC_KEYS.map((k) => METRICS[k].indicatorCode.toUpperCase()));
  const seenCodes = new Map();
  for (const [key, def] of Object.entries(FUTURE_METRIC_DEFINITIONS)) {
    if (def.key !== key) {
      throw new Error(`Future definition "${key}" declares key "${def.key}".`);
    }
    const code = String(def.indicatorCode ?? '').toUpperCase();
    if (!code) throw new Error(`Future definition "${key}" has no World Bank indicator code.`);
    if (productionCodes.has(code)) {
      throw new Error(`Future definition "${key}" reuses production code "${def.indicatorCode}".`);
    }
    if (seenCodes.has(code)) {
      throw new Error(
        `Duplicate future indicator code "${def.indicatorCode}" used by "${key}" and "${seenCodes.get(code)}".`,
      );
    }
    seenCodes.set(code, key);
    if (def.lifecycle === 'PRODUCTION' || def.productionEnabled === true) {
      throw new Error(`Future definition "${key}" must not be production-enabled.`);
    }
    if (!['SUPPORTED', 'DEFINED'].includes(def.lifecycle)) {
      throw new Error(`Future definition "${key}" must declare lifecycle SUPPORTED or DEFINED.`);
    }
    if (def.lifecycle === 'SUPPORTED' && (!def.verified || !def.verified.date || !def.verified.method || !def.verified.name)) {
      throw new Error(`Future definition "${key}" claims SUPPORTED without verification evidence.`);
    }
    for (const field of ['label', 'shortLabel', 'unit', 'unitLong']) {
      if (!def[field]) throw new Error(`Future definition "${key}" is missing required field "${field}".`);
    }
    assertSemanticFields(key, def, { prospectiveSubject: true });
  }
  return true;
}

// Fail fast: a malformed registry must never serve a number.
assertRegistryIntegrity();
assertFutureDefinitions();

/** Country used as the subject of this application. */
export const FOCUS_COUNTRY = Object.freeze({ iso3: 'IND', name: 'India' });

export const config = Object.freeze({
  port: int('PORT', 3001),

  worldBank: Object.freeze({
    baseUrl: str('WORLD_BANK_API_BASE_URL', 'https://api.worldbank.org/v2').replace(/\/+$/, ''),
    perPage: int('WB_PER_PAGE', 20000),
    maxRetries: int('WB_MAX_RETRIES', 5),
    retryBaseMs: num('WB_RETRY_BASE_MS', 500),
    timeoutMs: int('WB_TIMEOUT_MS', 30000),
  }),

  databaseFile: path.isAbsolute(str('DATABASE_FILE', 'data/worldbank.db'))
    ? str('DATABASE_FILE', 'data/worldbank.db')
    : path.join(BACKEND_ROOT, str('DATABASE_FILE', 'data/worldbank.db')),

  // Default ANALYSIS range (UI default view). Kept at 2000 → latest stored so
  // the default user experience is unchanged by historical coverage work.
  defaultStartYear: int('DEFAULT_START_YEAR', 2000),
  defaultEndYear: int('DEFAULT_END_YEAR', 2025),

  // Default INGESTION range (what a refresh fetches when no explicit years are
  // given). Reaches the earliest relevant World Bank observations (≈1960 for
  // the non-PPP series, 1990 for PPP) and the current calendar year, so newly
  // published World Bank years are picked up automatically. The pipeline stores
  // only what the World Bank returns; missing years stay missing. Per-metric
  // availability is preserved — no common start year is fabricated.
  ingestStartYear: int('INGEST_START_YEAR', 1960),
  ingestEndYear: int('INGEST_END_YEAR', new Date().getFullYear()),

  cacheTtlHours: num('CACHE_TTL_HOURS', 24),
  neighborsDefault: int('RANK_NEIGHBORS_DEFAULT', 5),

  // Manual-refresh admin token. Empty (default) means the refresh endpoint is
  // open, for local development and tests. NEVER logged or returned in API
  // responses. Production boot refuses to start without it (see server.js).
  refreshAdminToken: str('REFRESH_ADMIN_TOKEN', ''),

  // Allowed CORS origins (comma-separated, exact match). Null/empty means the
  // permissive development default; production boot refuses to start without
  // an explicit list (see server.js).
  corsOrigins: (() => {
    const raw = process.env.CORS_ORIGINS;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    return Object.freeze(String(raw).split(',').map((s) => s.trim()).filter((s) => s !== ''));
  })(),

  // Refresh-specific abuse protection (manual POST /api/data/refresh only;
  // ranking/data GET endpoints are never rate-limited). In-memory sliding
  // window per client IP: at most refreshRateLimitMax attempts per
  // refreshRateLimitWindowMs. Non-positive values disable the limiter.
  refreshRateLimitMax: int('REFRESH_RATE_LIMIT_MAX', 10),
  refreshRateLimitWindowMs: int('REFRESH_RATE_LIMIT_WINDOW_MS', 60000),

  autoIngestOnEmpty: bool('WB_AUTO_INGEST_ON_EMPTY', true),

  // Automatic background refresh when the cache is stale per CACHE_TTL_HOURS.
  // Manual refreshes always attempt immediately; only automatic triggers honor
  // the post-failure cooldown in AUTO_REFRESH_FAIL_COOLDOWN_MS.
  autoRefreshOnStale: bool('WB_AUTO_REFRESH_ON_STALE', true),
});

/** Data-source attribution used throughout API responses and the UI. */
export const SOURCE_INFO = Object.freeze({
  provider: 'World Bank',
  dataset: 'World Development Indicators (WDI)',
  apiDocumentation: [
    'https://datahelpdesk.worldbank.org/knowledgebase/articles/898581',
    'https://datahelpdesk.worldbank.org/knowledgebase/articles/898599',
  ],
  rankDisclaimer:
    'The World Bank provides the underlying observations. Historical country ranks shown by this application are calculated by this application from those observations. The World Bank does not publish the rank values produced here.',
  rankWording: 'Rank calculated from World Bank WDI observations.',
});

export default config;