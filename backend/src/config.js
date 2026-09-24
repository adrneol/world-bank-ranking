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
export const CHANGE_TYPES = Object.freeze(['ABSOLUTE', 'PERCENT', 'PP', 'INDEX_POINT', 'YOY', 'CAGR']);
export const RANKING_DIRECTIONS = Object.freeze(['DESC', 'ASC', 'NEUTRAL']);
export const MEASURE_INTERPRETATIONS = Object.freeze([
  'MORE_IS_MORE',
  'LOWER_PREFERRED_IN_STABILITY',
  'NEUTRAL',
  'CONTEXT_DEPENDENT',
]);
export const AGGREGATION_MODES = Object.freeze(['SUM', 'WEIGHTED_RATIO', 'OFFICIAL_ONLY', 'MEMBER_ONLY', 'NOT_AGGREGATABLE']);
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

/** The complete registry: four GDP-per-capita metrics + four Total GDP metrics. */
export const METRICS = Object.freeze({
  ...GDP_PER_CAPITA_METRICS,
  ...TOTAL_GDP_METRICS,
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
});

/** Ordered list of subject keys, in canonical display order. */
export const SUBJECT_KEYS = Object.freeze(Object.keys(SUBJECTS));

/**
 * DEFINED-BUT-DISABLED FUTURE MEASURE DEFINITIONS (Phase 2).
 *
 * Every entry below was verified live via GET /v2/indicator/{code}?format=json
 * on 2026-09-24 (WDI source id 2); the official name recorded in `verified`
 * matches the live payload verbatim. They are SUPPORTED (code + semantics
 * known) but NOT production-enabled: they resolve through getDefinedMetric()
 * for metadata display only, never through getMetric(), never in SUBJECTS,
 * never in ingestion, never in integrity. Promotion to production (Phase 5)
 * means moving the entry into METRICS with subject wiring — an explicit,
 * reviewed step, never an automatic one.
 *
 * No new observations are ingested for these keys in Phase 2. No database
 * indicator rows may exist for them in production.
 */
export const FUTURE_METRIC_DEFINITIONS = Object.freeze({
  inflation_cpi: Object.freeze({
    key: 'inflation_cpi',
    indicatorCode: 'FP.CPI.TOTL.ZG',
    label: 'Inflation, consumer prices (annual %)',
    shortLabel: 'CPI inflation',
    unit: 'annual %',
    unitLong: 'annual %',
    currencySymbol: '%',
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    // Prospective subject: not in SUBJECTS until promotion. The validator
    // requires future subjects to stay prospective so the subject partition
    // invariant (every METRICS entry in exactly one subject) cannot drift.
    subject: 'prices',
    domain: 'PRICES',
    family: 'INFLATION_CPI',
    observationType: 'RATE',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    // PP (B-A) is the default change for a rate. PERCENT (relative change of
    // a percentage) is deliberately NOT declared: 6% -> 3% is -3 pp, not -50%.
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PP']),
    // Group inflation is never computed from members; only the World Bank's
    // own published aggregates may serve as a regional value (Phase 4).
    aggregation: 'OFFICIAL_ONLY',
    // ASC declares the available descriptive "lower-first" ordering. It
    // enables nothing until Phase 3/4 implement directional ranking; GDP
    // behaviour (DESC) is untouched.
    rankingDirection: 'ASC',
    interpretation: 'LOWER_PREFERRED_IN_STABILITY',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/FP.CPI.TOTL.ZG?format=json',
      name: 'Inflation, consumer prices (annual %)',
    }),
  }),
  inflation_cpi_index: Object.freeze({
    key: 'inflation_cpi_index',
    indicatorCode: 'FP.CPI.TOTL',
    label: 'Consumer price index (2010 = 100)',
    shortLabel: 'CPI index',
    unit: 'index (2010 = 100)',
    unitLong: 'index points (2010 = 100)',
    currencySymbol: null,
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    subject: 'prices',
    domain: 'PRICES',
    family: 'INFLATION_CPI',
    observationType: 'INDEX',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    // Index movement is INDEX_POINT change, never "percentage points".
    validChangeTypes: Object.freeze(['ABSOLUTE', 'INDEX_POINT']),
    aggregation: 'OFFICIAL_ONLY',
    // NEUTRAL: raw CPI index levels must never be cross-country ranked as a
    // "cost of living" metric (within-country construct; guardrails §14).
    rankingDirection: 'NEUTRAL',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: 2010,
    worldBankPage: 'https://data.worldbank.org/indicator/FP.CPI.TOTL',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/FP.CPI.TOTL?format=json',
      name: 'Consumer price index (2010 = 100)',
    }),
  }),
  inflation_deflator: Object.freeze({
    key: 'inflation_deflator',
    indicatorCode: 'NY.GDP.DEFL.KD.ZG',
    label: 'Inflation, GDP deflator (annual %)',
    shortLabel: 'GDP-deflator inflation',
    unit: 'annual %',
    unitLong: 'annual %',
    currencySymbol: '%',
    group: 'prices',
    priceBasis: NOT_APPLICABLE,
    subject: 'prices',
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
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.DEFL.KD.ZG',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NY.GDP.DEFL.KD.ZG?format=json',
      name: 'Inflation, GDP deflator (annual %)',
    }),
  }),
  fx_official: Object.freeze({
    key: 'fx_official',
    indicatorCode: 'PA.NUS.FCRF',
    label: 'Official exchange rate (LCU per US$, period average)',
    shortLabel: 'Official FX vs USD',
    unit: 'LCU per US$',
    unitLong: 'local currency units per US$ (period average)',
    currencySymbol: null,
    group: 'fx',
    priceBasis: NOT_APPLICABLE,
    subject: 'exchange',
    domain: 'FINANCIAL',
    family: 'EXCHANGE_RATE',
    observationType: 'QUOTED_RATE',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PERCENT']),
    // No World Bank world aggregate exists for this series (WLD is null);
    // members are displayable but never summed, averaged or ranked by level.
    aggregation: 'MEMBER_ONLY',
    // NEUTRAL: 83 INR/USD vs 150 JPY/USD is units, not strength. Movement
    // and cross-rates only (Phases 3-4).
    rankingDirection: 'NEUTRAL',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'CUSTOM_GROUP']),
    signDomain: 'POSITIVE_ONLY',
    requiredDenominator: null,
    // Quotation is stored once so appreciation/depreciation can never become
    // a sign bug at UI call sites: increase = local depreciation vs USD.
    quotation: Object.freeze({ convention: 'LCU_PER_USD', base: 'USD' }),
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/PA.NUS.FCRF',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/PA.NUS.FCRF?format=json',
      name: 'Official exchange rate (LCU per US$, period average)',
    }),
  }),
  exports_current: Object.freeze({
    key: 'exports_current',
    indicatorCode: 'NE.EXP.GNFS.CD',
    label: 'Exports of goods and services (current US$)',
    shortLabel: 'Exports, current US$',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'trade',
    priceBasis: 'current',
    subject: 'trade',
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
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NE.EXP.GNFS.CD',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NE.EXP.GNFS.CD?format=json',
      name: 'Exports of goods and services (current US$)',
    }),
  }),
  imports_current: Object.freeze({
    key: 'imports_current',
    indicatorCode: 'NE.IMP.GNFS.CD',
    label: 'Imports of goods and services (current US$)',
    shortLabel: 'Imports, current US$',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'trade',
    priceBasis: 'current',
    subject: 'trade',
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
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/NE.IMP.GNFS.CD',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/NE.IMP.GNFS.CD?format=json',
      name: 'Imports of goods and services (current US$)',
    }),
  }),
  fdi_inflows: Object.freeze({
    key: 'fdi_inflows',
    indicatorCode: 'BX.KLT.DINV.CD.WD',
    label: 'Foreign direct investment, net inflows (BoP, current US$)',
    shortLabel: 'FDI net inflows',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'flows',
    priceBasis: 'current',
    subject: 'capital_flows',
    domain: 'EXTERNAL',
    family: 'FDI',
    // Net flow: inflows minus disinvestment. Zero and negative values are
    // legitimate, so PERCENT is NOT declared; YOY stays engine-gated later.
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
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/BX.KLT.DINV.CD.WD',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BX.KLT.DINV.CD.WD?format=json',
      name: 'Foreign direct investment, net inflows (BoP, current US$)',
    }),
  }),
  fdi_inflows_pct_gdp: Object.freeze({
    key: 'fdi_inflows_pct_gdp',
    indicatorCode: 'BX.KLT.DINV.WD.GD.ZS',
    label: 'Foreign direct investment, net inflows (% of GDP)',
    shortLabel: 'FDI net inflows, % of GDP',
    unit: '% of GDP',
    unitLong: '% of GDP',
    currencySymbol: '%',
    group: 'flows',
    priceBasis: NOT_APPLICABLE,
    subject: 'capital_flows',
    domain: 'EXTERNAL',
    family: 'FDI',
    // World Bank ratio: use directly, never reconstruct. Change is PP, never
    // a percentage of a percentage; country percentages are never summed.
    observationType: 'RATIO',
    currencyBasis: NOT_APPLICABLE,
    frequency: 'ANNUAL',
    validChangeTypes: Object.freeze(['ABSOLUTE', 'PP']),
    aggregation: 'WEIGHTED_RATIO',
    rankingDirection: 'DESC',
    interpretation: 'NEUTRAL',
    comparisonCapability: Object.freeze(['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP']),
    signDomain: 'SIGNED',
    requiredDenominator: null,
    quotation: null,
    derivation: Object.freeze({ kind: 'RAW' }),
    lifecycle: 'SUPPORTED',
    ppp: false,
    baseYear: null,
    worldBankPage: 'https://data.worldbank.org/indicator/BX.KLT.DINV.WD.GD.ZS',
    verified: Object.freeze({
      date: '2026-09-24',
      method: 'GET /v2/indicator/BX.KLT.DINV.WD.GD.ZS?format=json',
      name: 'Foreign direct investment, net inflows (% of GDP)',
    }),
  }),
});

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