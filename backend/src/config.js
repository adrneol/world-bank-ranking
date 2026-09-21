/**
 * Central configuration.
 *
 * Every World Bank setting (base URL, indicator codes, defaults) is read from
 * the environment here and nowhere else. No indicator code is hardcoded deeper
 * in the codebase.
 *
 * The World Bank Indicators API is OPEN: it requires NO API KEY. There is
 * deliberately no key/token handling in this application.
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
 * The FOUR primary metrics of this application.
 *
 * `key` is the API/UI identifier. `indicatorCode` is the exact World Bank WDI
 * indicator code. `unit` is the World Bank unit. Never compare values across
 * these keys: they are four independent series with four independent rankings.
 */
export const METRICS = Object.freeze({
  nominal_current: Object.freeze({
    key: 'nominal_current',
    indicatorCode: str('WORLD_BANK_NOMINAL_CURRENT_INDICATOR', 'NY.GDP.PCAP.CD'),
    label: 'Nominal GDP per capita - current US$',
    shortLabel: 'Nominal Current',
    unit: 'current US$',
    unitLong: 'current US$',
    currencySymbol: '$',
    group: 'nominal',
    priceBasis: 'current',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD',
  }),
  nominal_constant: Object.freeze({
    key: 'nominal_constant',
    indicatorCode: str('WORLD_BANK_NOMINAL_CONSTANT_INDICATOR', 'NY.GDP.PCAP.KD'),
    label: 'Nominal GDP per capita - constant 2015 US$',
    shortLabel: 'Nominal Constant 2015',
    unit: 'constant 2015 US$',
    unitLong: 'constant 2015 US$',
    currencySymbol: '$',
    group: 'nominal',
    priceBasis: 'constant',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.KD',
  }),
  ppp_current: Object.freeze({
    key: 'ppp_current',
    indicatorCode: str('WORLD_BANK_PPP_CURRENT_INDICATOR', 'NY.GDP.PCAP.PP.CD'),
    label: 'GDP per capita PPP - current international $',
    shortLabel: 'PPP Current',
    unit: 'current international $',
    unitLong: 'current international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'current',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD',
  }),
  ppp_constant: Object.freeze({
    key: 'ppp_constant',
    indicatorCode: str('WORLD_BANK_PPP_CONSTANT_INDICATOR', 'NY.GDP.PCAP.PP.KD'),
    label: 'GDP per capita PPP - constant 2021 international $',
    shortLabel: 'PPP Constant 2021',
    unit: 'constant 2021 international $',
    unitLong: 'constant 2021 international $',
    currencySymbol: '$',
    group: 'ppp',
    priceBasis: 'constant',
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.KD',
  }),
});

/** Ordered list of metric keys, in canonical display order. */
export const METRIC_KEYS = Object.freeze(Object.keys(METRICS));

/**
 * Resolve a metric by key. Throws on unknown keys so that a typo can never
 * silently fall back to a different indicator.
 */
export function getMetric(key) {
  if (!key) throw new Error('Metric key is required');
  // Accept a raw World Bank indicator code as well, for convenience.
  const byKey = METRICS[key];
  if (byKey) return byKey;
  const byCode = METRIC_KEYS.map((k) => METRICS[k]).find(
    (m) => m.indicatorCode.toUpperCase() === String(key).toUpperCase(),
  );
  if (byCode) return byCode;
  throw new Error(
    `Unknown metric "${key}". Valid keys: ${METRIC_KEYS.join(', ')} ` +
      `(or an exact World Bank indicator code).`,
  );
}

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

  defaultStartYear: int('DEFAULT_START_YEAR', 2000),
  defaultEndYear: int('DEFAULT_END_YEAR', 2025),

  cacheTtlHours: num('CACHE_TTL_HOURS', 24),
  neighborsDefault: int('RANK_NEIGHBORS_DEFAULT', 5),

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