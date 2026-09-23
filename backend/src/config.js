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
    indicatorCode: str('WORLD_BANK_NOMINAL_CURRENT_INDICATOR', 'NY.GDP.PCAP.CD'),
    label: 'Nominal GDP per capita - current US$',
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
    subject: 'gdp_per_capita',
    ppp: false,
    baseYear: 2015,
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
    subject: 'gdp_per_capita',
    ppp: true,
    baseYear: null,
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
    subject: 'gdp_per_capita',
    ppp: true,
    baseYear: 2021,
    worldBankPage: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.KD',
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
    indicatorCode: str('WORLD_BANK_TOTAL_CURRENT_INDICATOR', 'NY.GDP.MKTP.CD'),
    label: 'Total GDP - current US$',
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
  }),
  total_constant: Object.freeze({
    key: 'total_constant',
    subject: 'gdp_total',
    indicatorCode: str('WORLD_BANK_TOTAL_CONSTANT_INDICATOR', 'NY.GDP.MKTP.KD'),
    label: 'Total GDP - constant 2015 US$ (real GDP)',
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
  }),
  total_ppp_current: Object.freeze({
    key: 'total_ppp_current',
    subject: 'gdp_total',
    indicatorCode: str('WORLD_BANK_TOTAL_PPP_CURRENT_INDICATOR', 'NY.GDP.MKTP.PP.CD'),
    label: 'Total GDP, PPP - current international $',
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
  }),
  total_ppp_constant: Object.freeze({
    key: 'total_ppp_constant',
    subject: 'gdp_total',
    indicatorCode: str('WORLD_BANK_TOTAL_PPP_CONSTANT_INDICATOR', 'NY.GDP.MKTP.PP.KD'),
    label: 'Total GDP, PPP - constant 2021 international $',
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
 * REGISTRY INVARIANTS (fail closed at import time).
 *
 *   1. every metric's `key` matches its registry key
 *   2. metric keys are unique (object keys are; asserted explicitly)
 *   3. World Bank indicator codes are unique — two metrics can never share a
 *      series, which would make two "different" analyses silently identical
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
    if (!metric.subject || !SUBJECTS[metric.subject]) {
      throw new Error(`Metric "${key}" declares unknown subject "${metric.subject}".`);
    }
    for (const field of ['label', 'shortLabel', 'unit', 'unitLong', 'priceBasis']) {
      if (!metric[field]) throw new Error(`Metric "${key}" is missing required field "${field}".`);
    }
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

// Fail fast: a malformed registry must never serve a number.
assertRegistryIntegrity();

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