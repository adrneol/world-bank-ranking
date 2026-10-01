/**
 * EXPRESS 5 HTTP SERVER (specification sections 15, 34).
 *
 * Every route is a thin translation layer over the service modules:
 * query validation happens here, all economics happens in the services, all
 * SQL lives in the repository. Responses carry methodology/source metadata so
 * any result can be independently verified (§20).
 *
 * Error contract: validation failures → 400 { error: { message, code } };
 * refresh collisions → 409; unknown routes → 404. Production responses never
 * include stack traces.
 */

import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config, {
  ALL_METRIC_KEYS,
  FOCUS_COUNTRY,
  FUTURE_METRIC_DEFINITIONS,
  FUTURE_METRIC_KEYS,
  METRICS,
  METRIC_KEYS,
  PRODUCTION_METRIC_KEYS,
  SOURCE_INFO,
  SUBJECT_KEYS,
  describeSubjects,
  getDefinedMetric,
  getMetric,
  getSubject,
} from './config.js';
import { closeDb, createPrimaryHandle, describeDbTarget, getDb, initDatabase, openExistingLocalDb, pingDatabase, resolveDbMode } from './db/index.js';
import {
  computeDatasetState,
  countAggregateCountries,
  countAllCountries,
  countEligibleCountries,
  countObservations,
  EXPENSIVE_CHECK_NAMES,
  getCountry,
  getDatasetFingerprint,
  getDatasetState,
  getEligibleObservations,
  getIndicatorByMetricKey,
  getMaxWbLastUpdated,
  getObservation,
  getObservedCountryIds,
  insertDatasetStateIfAbsent,
  listCountries,
  listFetchRuns,
  listIndicators,
  getLatestPersistedProgress,
  markIntegrityVerified,
  parseProgressSummary,
  parseStoredIntegrityChecks,
} from './db/repository.js';
import { describeUniverseRule } from './domain/universe.js';
import { describeMeasure, describeMetric } from './domain/format.js';
import { buildLevelComparisonResponse, COMPARISON_ERROR_CODES } from './services/comparisonService.js';
import { buildCompareResponse, buildGroupEvaluation } from './services/entityCompare.js';
import { buildGrowthComparisonResponse } from './services/growthComparisonService.js';
import { buildCoveragePanel, buildYoyCoveragePanel, explainTotalChange } from './services/coverageService.js';
import { buildFullRanking } from './services/fullRanking.js';
import { buildIndiaYearlyRows } from './services/indiaYearly.js';
import { runIntegrityChecks } from './services/integrity.js';
import {
  cheapIntegrityKey,
  expensiveIntegrityKey,
  getCachedCheapIntegrity,
  getCachedExpensiveIntegrity,
  getCachedIntegrity,
  integrityCacheKey,
  resetIntegrityCache,
} from './services/statusCache.js';
import {
  mergeIntegrityChecks,
  runCheapIntegrityChecks,
  runExpensiveIntegrityChecks,
  runMetadataIntegrityChecks,
} from './services/integrity.js';
import { buildRankVerification, normalizeNeighborCount } from './services/rankVerification.js';
import { buildPeriodSummary } from './services/periodService.js';
import { buildPricesMovement, listPriceCountryGroups, PRICES_ERROR_CODES } from './services/pricesMovementService.js';
import { isPricesMetric, basesForMetric, PRICES_BASIS_INFO as PRICES_BASIS_INFO_REF } from './domain/pricesMovement.js';
import { buildTradeMovement, listTradeCountryGroups, TRADE_ERROR_CODES } from './services/tradeMovementService.js';
import { isTradeMetric, tradeBasesForMetric, TRADE_BASIS_INFO as TRADE_BASIS_INFO_REF } from './domain/tradeMovement.js';
import { buildCapitalMovement, listCapitalCountryGroups, CAPITAL_ERROR_CODES } from './services/capitalMovementService.js';
import { isCapitalMetric, capitalBasesForMetric, CAPITAL_BASIS_INFO as CAPITAL_BASIS_INFO_REF } from './domain/capitalMovement.js';
import { buildFxMovement, listFxCountryGroups, FX_ERROR_CODES } from './services/fxMovementService.js';
import { isFxMetric, fxBasesForMetric, FX_BASIS_INFO as FX_BASIS_INFO_REF } from './domain/fxMovement.js';
import { buildExternalMovement, listExternalCountryGroups, EXTERNAL_ERROR_CODES } from './services/externalMovementService.js';
import { isExternalMetric, externalBasesForMetric, EXTERNAL_BASIS_INFO as EXTERNAL_BASIS_INFO_REF } from './domain/externalMovement.js';
import { buildPopulationMovement, listPopulationCountryGroups, POPULATION_ERROR_CODES } from './services/populationMovementService.js';
import { isPopulationMetric, populationBasesForMetric, POPULATION_BASIS_INFO as POPULATION_BASIS_INFO_REF } from './domain/populationMovement.js';
import { buildFullYoyRanking, buildYoyVerification } from './services/yoyVerification.js';
import { geoCountryForRequest } from './services/geo.js';
import { getCachedAvailableYears } from './services/yearsCache.js';
import {
  ensureDataPresent,
  getCacheStatus,
  getIngestProgress,
  getRefreshLockState,
  getRefreshRetryState,
  isRefreshInProgress,
  maybeAutoRefresh,
  recoverRefreshLock,
  refreshData,
} from './wb/ingest.js';

/**
 * Data-serving GET endpoints covered by automatic TTL refresh.
 * Health, status, integrity and refresh endpoints are deliberately excluded:
 * they must stay side-effect free (or, for manual refresh, explicit).
 */
const AUTO_REFRESH_PATHS = Object.freeze([
  '/api/years',
  '/api/india/gdp-ranking',
  '/api/focus/yearly',
  '/api/ranking',
  '/api/ranking/verify',
  '/api/yoy-ranking',
  '/api/yoy-ranking/verify',
  '/api/coverage',
  '/api/comparison/level',
  '/api/observations',
  '/api/countries',
  '/api/metadata',
  '/api/indicators',
  '/api/entities',
  '/api/compare',
  '/api/groups/evaluate',
  '/api/periods/summary',
  '/api/movement/prices',
  '/api/prices/country-groups',
  '/api/movement/trade',
  '/api/trade/country-groups',
  '/api/movement/capital',
  '/api/capital/country-groups',
  '/api/movement/fx',
  '/api/fx/country-groups',
  '/api/movement/external',
  '/api/external/country-groups',
  '/api/movement/population',
  '/api/population/country-groups',
]);

/**
 * Phase 8F — ACTIVE database target (not merely configured).
 *
 * The process serves exactly one handle chosen at boot (primary, guarded
 * fallback, or degraded). `activeDbInfo` records WHICH ONE so the Status UI
 * can never display "Turso (production)" while actually serving fallback
 * SQLite. Boot sets it; primary recovery updates it on promotion. Tests may
 * set it via setActiveDbInfo() (documented seam; production paths own it).
 */
function defaultActiveDbInfo() {
  return {
    provider: resolveDbMode() === 'turso' ? 'turso' : 'sqlite',
    isFallback: false,
    isDegraded: false,
    isProduction: process.env.NODE_ENV === 'production',
  };
}
let activeDbInfo = defaultActiveDbInfo();
export function getActiveDbInfo() {
  return { ...activeDbInfo };
}
/** Test/ops seam: replace the active-target record (never a database write). */
export function setActiveDbInfo(info) {
  activeDbInfo = { ...defaultActiveDbInfo(), ...(info ?? {}) };
}

/**
 * Phase 8F — PUBLIC database descriptor for GET /api/data-status.
 * Safe logical target ONLY: provider + context + display label. Never the
 * Turso hostname/URL, never tokens or credentials (those stay in server logs
 * via describeDbTarget(), never in API responses).
 */
export function publicDatabaseTarget(info = activeDbInfo) {
  const production = info?.isProduction ?? process.env.NODE_ENV === 'production';
  if (info?.provider === 'turso') {
    return {
      provider: 'turso',
      context: production ? 'production' : 'development',
      label: production ? 'Turso (production)' : 'Turso',
      fallback: false,
    };
  }
  if (info?.isFallback) {
    return {
      provider: 'sqlite',
      context: 'production-fallback',
      label: 'Local SQLite (production fallback)',
      fallback: true,
    };
  }
  return {
    provider: 'sqlite',
    context: production ? 'production' : 'local',
    label: 'Local SQLite',
    fallback: false,
  };
}

/**
 * Phase 8F — guarded primary (Turso) recovery / switch-back.
 *
 * Current architecture (see boot()): the active handle is chosen once at boot
 * and stays until restart — there is NO live re-probe. This helper adds the
 * smallest safe promotion path WITHOUT hot-swapping under load:
 *
 *   - only when a guarded fallback is actually active (primary configured as
 *     Turso, currently serving fallback SQLite, not degraded);
 *   - at most one probe per RECOVERY_REPROBE_MS (default 15 min; tests via
 *     WB_RECOVERY_REPROBE_MS) so hot request paths never storm the primary;
 *   - never while a refresh is in progress and never while the fallback lock
 *     is held (an in-flight refresh keeps its captured handle to completion);
 *   - the candidate primary is revalidated (ping + non-empty dataset) before
 *     promotion; an empty or unreachable primary keeps fallback serving;
 *   - promotion swaps ONLY the future-handle cell (single-threaded assignment:
 *     in-flight requests keep their captured reference); the previous fallback
 *     handle is deliberately left open (never closed under live readers).
 *
 * Degraded mode (no usable fallback) intentionally has no automatic recovery
 * here: with no valid dataset to serve, recovery follows a restart. Callers:
 * the TTL middleware (fire-and-forget) and POST /api/data/refresh (awaited,
 * bounded by the probe timeout) so a recovered primary is picked up without
 * a new endpoint and without per-poll work (data-status itself never probes).
 */
export function recoveryReprobeMs() {
  const raw = process.env.WB_RECOVERY_REPROBE_MS;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(String(raw).trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 15 * 60 * 1000;
}
export function recoveryProbeTimeoutMs() {
  const raw = process.env.WB_RECOVERY_PROBE_TIMEOUT_MS;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(String(raw).trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 10 * 1000;
}
let lastRecoveryProbeAt = 0;
const withProbeTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Recovery probe timed out: ${label}`)), ms);
    }),
  ]);
async function defaultProbePrimary(timeoutMs) {
  const handle = createPrimaryHandle();
  try {
    await withProbeTimeout(pingDatabase(handle), timeoutMs, 'ping');
    const state = await withProbeTimeout(getDatasetState(handle), timeoutMs, 'dataset_state');
    const count = state
      ? state.observationCount
      : await withProbeTimeout(countObservations(handle), timeoutMs, 'count');
    if (!Number.isFinite(count) || count <= 0) {
      try {
        await handle.close?.();
      } catch {
        // Best effort.
      }
      return null;
    }
    return handle;
  } catch {
    try {
      await handle.close?.();
    } catch {
      // Best effort.
    }
    return null;
  }
}
export async function maybeRecoverPrimary(shared, { onWarn = null, createProbe = null, configuredMode = null } = {}) {
  if (!shared?.isFallback || shared?.isDegraded) {
    return { recovered: false, reason: 'not-fallback' };
  }
  // Test seam: production always resolves the real configured mode.
  const mode = configuredMode ?? resolveDbMode();
  if (mode !== 'turso') {
    return { recovered: false, reason: 'primary-not-turso' };
  }
  if (Date.now() - lastRecoveryProbeAt < recoveryReprobeMs()) {
    return { recovered: false, reason: 'cooldown' };
  }
  lastRecoveryProbeAt = Date.now();
  if (isRefreshInProgress()) {
    onWarn?.({ message: 'Primary recovery deferred: a refresh is in progress.' });
    return { recovered: false, reason: 'refresh-in-progress' };
  }
  try {
    const lock = await withProbeTimeout(
      getRefreshLockState(shared.current),
      recoveryProbeTimeoutMs(),
      'fallback-lock',
    );
    if (lock?.locked) {
      onWarn?.({ message: 'Primary recovery deferred: fallback refresh lock is held.' });
      return { recovered: false, reason: 'lock-held' };
    }
  } catch {
    onWarn?.({ message: 'Primary recovery deferred: fallback lock unreadable.' });
    return { recovered: false, reason: 'lock-unreadable' };
  }
  const probe = createProbe ?? defaultProbePrimary;
  let candidate = null;
  try {
    candidate = await probe(recoveryProbeTimeoutMs());
  } catch {
    candidate = null;
  }
  if (!candidate) {
    onWarn?.({ message: 'Primary still unavailable; staying on fallback.' });
    return { recovered: false, reason: 'primary-unavailable' };
  }
  // Promote: future handle() calls serve the revalidated primary. In-flight
  // work keeps its captured fallback reference to completion. Memos are
  // content-keyed (run/content-version) so the new generation simply misses
  // once and re-derives — no invalidation storm, no extra scan scheduled here.
  shared.current = candidate;
  shared.isFallback = false;
  setActiveDbInfo({ provider: 'turso', isFallback: false, isDegraded: false });
  console.log('Primary database recovered; promoted back to Turso (production).');
  return { recovered: true, reason: 'promoted' };
}

/** Shared methodology block for auditability (§20). */
export function methodologyBlock() {
  return {
    source: SOURCE_INFO.provider,
    dataset: SOURCE_INFO.dataset,
    rankWording: SOURCE_INFO.rankWording,
    rankDisclaimer: SOURCE_INFO.rankDisclaimer,
    levelRanking: 'value in the metric-declared direction (DESC; ASC where the registry declares lower-values-first), ISO3 ASC; rank = 1-based ordinal position. Ties are ordered deterministically by ISO3 and therefore receive distinct ordinal positions.',
    yoyFormula: '((currentRaw / previousRaw) - 1) * 100, raw values only; missing or non-positive base yields null, never 0%.',
    yoyRanking: 'YoY DESC, ISO3 ASC; denominator counts valid YoY pairs only.',
    numericalRepresentation:
      'Observations are stored as SQLite REAL (IEEE-754 double, used for all comparisons and arithmetic — deterministic for a fixed snapshot) alongside value_raw TEXT (canonical decimal string, audit only). Nothing is rounded before calculation; formatting is presentation-only.',
    universeRule: describeUniverseRule(),
    pricesMovement:
      'Prices-only canonical methodology (prices/method-cpiindex.txt, prices/cpiInflationmethodology.txt, prices/gdpDeflator.txt): CPI Index 2 bases (annual raw, no rank; period endpoint change (E/S-1)*100, ASC competition rank); CPI Inflation 3 bases (annual raw; average S+1..E; cumulative prod(S+1..E)(1+r/100)-1, all ASC competition); GDP-deflator 3 bases (same structure). Observed/Like-for-like are universes, identical formulas. Benchmark=mean(other eligible), PP=benchmark-focus, focus excluded. Full precision; competition ranking (1,1,3). Missing required years invalidate the period (never zero-filled/interpolated). Country groups are dynamic WB classifications (income/region/lending); Developed/Developing/Underdeveloped labels are not in the authoritative data and are not exposed.',
    tradeMovement:
      'Trade-only canonical methodology (trade/tademethod.txt): annual value (raw, DESC competition rank, USD gap); CAGR ((E/S)^(1/(E-S))-1, DESC, pp gap, start>0 required, end=0 valid as -100%); inclusive period total S..E (11/11/21 obs, DESC, USD gap); inclusive period average total/(E-S+1) (DESC, USD/year gap). Observed/Like-for-like are universes, identical formulas. Benchmark=mean(other eligible), gap=benchmark-focus, focus excluded. Full precision; competition ranking (1,1,3). Missing required years exclude the economy (never zero-filled/interpolated). Current-US$ values are nominal (quantities, prices, exchange rates, composition), not real-volume growth.',
    capitalMovement:
      'Capital-only canonical methodology (capitalflow/capitalflowmethod.txt): FDI annual raw, cumulative sum S+1..E, average sum/(E-S) (all DESC, USD gaps); FDI/GDP annual raw WDI ratio, average ratio S+1..E, cumulative FDI/cumulative GDP (all DESC, pp gaps); unranked endpoint diagnostics only; no % growth basis. Gap = country-focus minus other-eligible mean (positive = above). Negative/zero flows are data. Full precision; competition ranking (1,1,3). Missing required years (incl. GDP legs) exclude the economy. Cumulative FDI is summed flows, never a stock.',
    fxMovement:
      'FX-only canonical methodology (ExchangeRate/exchangerate.txt): annual level raw LCU per US$ (never ranked/benchmarked); annual change ((t/t-1)-1, DESC competition, frozen direction); period change ((E/S)-1 endpoints-only, DESC competition); CAGR display-only secondary. Benchmark = leave-one-out MEDIAN eligible-economy change; gap = country − median (pp). Positive = depreciation vs USD. Full precision. Missing t-1/t or S/E excludes. Nominal official bilateral vs USD only; no continuity metadata stored (no fabricated detectors).',
    externalMovement:
      'External-only canonical methodology (ExternalSector/externalsector.txt): CA annual/average/cumulative CA/GDP from CA+GDP legs (S+1..E, pp); reserves annual stock (USD, size-only), endpoint % change S/E (pp), annual import coverage R/Imports*12 (months); remittances annual/cumulative/average S+1..E (USD) + cumulative intensity ΣRemit/ΣGDP (pp). All DESC competition; per-basis frozen mean/median LOO benchmark (median: reserves stock/change, remittance levels; mean: ratios/coverage); gap = country − benchmark. Negative/zero are data. Full precision; strict completeness.',
    populationMovement:
      'Population-only canonical methodology (population/pop.txt): annual stock (raw, DESC, mean gap, people); endpoint absolute change E−S (DESC, mean gap, people); endpoint % growth (DESC, mean gap, pp) with display-only CAGR. Stock semantics: never summed/averaged/sequenced. Gap = country − mean (positive = above). Full precision; competition ranking (1,1,3). Missing endpoints exclude. Estimates, not headcounts; no welfare claims.',
  };
}

function httpError(status, message, code = null) {
  const error = new Error(message);
  error.httpStatus = status;
  if (code) error.code = code;
  return error;
}

function parseYear(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 1960 || n > thisYear + 1) {
    throw httpError(400, `Invalid ${name}: expected an integer year between 1960 and ${thisYear + 1}.`, 'INVALID_YEAR');
  }
  return n;
}

function parseMetric(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw httpError(400, `Missing indicator. Valid keys: ${ALL_METRIC_KEYS.join(', ')} (or an exact World Bank indicator code).`, 'INVALID_INDICATOR');
  }
  try {
    return getMetric(String(value)).key;
  } catch {
    throw httpError(400, `Unknown indicator "${value}". Valid keys: ${ALL_METRIC_KEYS.join(', ')} (or an exact World Bank indicator code).`, 'INVALID_INDICATOR');
  }
}

/**
 * Optional analysis-subject filter (additive; never required). Only curated
 * registry subjects are accepted; anything else fails closed with 400 so the
 * frontend can never invent a subject server-side.
 */
function parseOptionalSubject(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  try {
    return getSubject(String(value)).key;
  } catch {
    throw httpError(
      400,
      `Unknown analysis subject "${value}". Valid subjects: ${SUBJECT_KEYS.join(', ')}.`,
      'INVALID_SUBJECT',
    );
  }
}

function parseCountry(value, fallback = FOCUS_COUNTRY.iso3) {
  const raw = value === undefined || value === null || value === '' ? fallback : String(value);
  const iso3 = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) {
    throw httpError(400, `Invalid country "${value}". Expected a 3-letter ISO3 code (e.g. IND).`, 'INVALID_COUNTRY');
  }
  return iso3;
}

/**
 * Phase-1 focus-country resolution (generic focus abstraction).
 *
 *   - omitted/blank country parameter -> default focus (IND), no lookup
 *   - explicit valid ISO3 of an eligible country -> that ISO3
 *   - explicit invalid ISO3 (bad format, unknown code, or aggregate entity)
 *     -> 400 INVALID_COUNTRY, NEVER a silent fallback to IND
 *
 * Only an OMITTED parameter defaults to IND.
 */
async function parseFocusCountry(db, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return FOCUS_COUNTRY.iso3;
  }
  const iso3 = parseCountry(value);
  const meta = await getCountry(db, iso3);
  if (!meta) {
    throw httpError(
      400,
      `Unknown country "${value}". Expected the ISO3 code of an eligible country/economy (e.g. IND).`,
      'INVALID_COUNTRY',
    );
  }
  // Known official aggregates are addressable as entities (e.g.
  // /api/compare with entityB=aggregate:WLD), never as countries here:
  // this route serves stored country observations only, so the refusal
  // names the correct path instead of looking like a broken endpoint.
  if (meta.is_aggregate === 1) {
    throw httpError(
      400,
      `"${value}" is an official World Bank aggregate ("${meta.name ?? iso3}"), not a country. ` +
      `This route serves stored country observations only; compare aggregates via /api/compare with an aggregate: entity.`,
      'INVALID_COUNTRY',
    );
  }
  return iso3;
}

function parsePositiveInt(value, name, { fallback = null, min = 1, max = 500 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw httpError(400, `Invalid ${name}: expected an integer between ${min} and ${max}.`, 'INVALID_PAGINATION');
  }
  return n;
}

/** Wrap async handlers so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * DB-level refresh-lock signal for the cold-start gate. Never throws on the
 * read path: an unreadable lock simply means "no lock evidence".
 */
async function isRefreshLocked(db) {
  try {
    return (await getRefreshLockState(db))?.locked === true;
  } catch {
    return false;
  }
}

/**
 * Manual-refresh admin authentication.
 *
 * When REFRESH_ADMIN_TOKEN is configured, POST /api/data/refresh requires
 * `Authorization: Bearer <token>` and anything else fails closed with 401.
 * When unconfigured (local development, tests) the endpoint stays open, but
 * production boot refuses to start without the token (see boot()).
 * Comparison is constant-time; the token is never logged or returned.
 */
function requireRefreshAuth(req) {
  const token = config.refreshAdminToken;
  if (!token) return;
  const header = req.headers.authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return;
  throw httpError(401, 'Manual refresh requires a valid admin token (Authorization: Bearer <token>).', 'REFRESH_UNAUTHORIZED');
}

/**
 * Minimal refresh-specific abuse protection (manual POST /api/data/refresh
 * only — ranking/data GET endpoints are never limited). In-memory sliding
 * window per client IP; intentionally dependency-free. Returns the
 * Retry-After seconds when the caller is over budget, else null.
 */
const refreshAttemptLog = new Map();
export function resetRefreshRateLimiter() {
  refreshAttemptLog.clear();
}
function refreshRateLimitCheck(req) {
  const max = config.refreshRateLimitMax;
  const windowMs = config.refreshRateLimitWindowMs;
  if (!(max > 0) || !(windowMs > 0)) return null;
  const now = Date.now();
  const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const log = (refreshAttemptLog.get(key) ?? []).filter((t) => now - t < windowMs);
  if (log.length >= max) {
    return Math.max(1, Math.ceil((log[0] + windowMs - now) / 1000));
  }
  log.push(now);
  refreshAttemptLog.set(key, log);
  return null;
}

/**
 * CORS policy: exact-match allowlist from CORS_ORIGINS when configured;
 * permissive development default otherwise. Requests without an Origin
 * header (curl, tests, server-to-server) are always allowed. Production boot
 * refuses to start without an explicit list (see boot()).
 */
function corsOptions() {
  const origins = config.corsOrigins;
  if (!origins || origins.length === 0) return {};
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

export function createApp({ db = null, autoRefresh = null, shared = null } = {}) {
  const app = express();
  // Phase 8F: when boot passes a shared handle cell, all requests resolve
  // through it so a guarded primary recovery can promote future traffic
  // without restarting. Plain { db } keeps working exactly as before.
  const handle = shared ? () => shared.current ?? getDb() : () => db ?? getDb();
  // Test seam: server.test.js and ttlRefresh.test.js control this explicitly.
  // Production default follows WB_AUTO_REFRESH_ON_STALE (default true).
  const autoRefreshEnabled = autoRefresh ?? config.autoRefreshOnStale;

  app.disable('x-powered-by');
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '64kb' }));

  // ---------- automatic TTL refresh ----------
  // Fire-and-forget: when the cache is empty or stale, a background refresh
  // starts WITHOUT awaiting it, so the current request keeps serving the
  // current valid dataset. maybeAutoRefresh() guarantees at most one refresh
  // (in-memory flag + SQLite mutex) and backs off after failures.
  if (autoRefreshEnabled) {
    app.use((req, res, next) => {
      (async () => {
        try {
          if (req.method === 'GET' && AUTO_REFRESH_PATHS.includes(req.path)) {
            // Phase 8F: while serving fallback, opportunistically re-probe the
            // primary (cooldown-gated inside maybeRecoverPrimary: no storm, no
            // per-request work beyond a timestamp check when cooling down).
            if (shared?.isFallback) {
              maybeRecoverPrimary(shared, {
                onWarn: (w) => console.warn(`Primary recovery: ${w.message}`),
              }).catch(() => {});
            }
            const decision = await maybeAutoRefresh(handle(), {
              onWarn: (w) => console.warn(`Auto-refresh: ${w.message}`),
            });
            if (decision.triggered) res.setHeader('X-Auto-Refresh', decision.reason);
          }
        } catch {
          // Auto-refresh must never break a data request.
        }
        next();
      })();
    });
  }

  // ---------- health ----------
  // Never exposes the server filesystem path, environment values, or secrets.
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      database: 'ok',
      methodology: methodologyBlock(),
    });
  });

  // ---------- default-country geolocation ----------
  // UX default only (never analytical): resolves the requester's eligible
  // ISO3 once, or null when detection is unavailable/invalid. Always 200 —
  // provider outages must never break the frontend bootstrap. Deliberately
  // excluded from AUTO_REFRESH_PATHS (side-effect free) and carrying no
  // methodology block (nothing here is economics).
  app.get('/api/geo/country', ah(async (req, res) => {
    const iso3 = await geoCountryForRequest(handle(), req);
    res.json({ iso3, source: iso3 ? 'geoip' : 'fallback' });
  }));

  // ---------- years ----------
  app.get('/api/years', ah(async (req, res) => {
    const h = handle();
    // Cold-start seeding: the database is empty and the first ingest is
    // still running (boot or TTL-triggered empty refresh). There are no
    // years to report yet — say so explicitly instead of returning an empty
    // range the frontend could mistake for "no data". The frontend treats
    // DATA_LOADING as still-starting (warm-up continues), not as a failure.
    // Phase 7B: emptiness from dataset_state when derived (1 row, not a
    // full COUNT scan); absent row keeps the legacy scan.
    const datasetState = await getDatasetState(h);
    const observationCount = datasetState ? datasetState.observationCount : await countObservations(h);
    if (observationCount === 0 && (isRefreshInProgress() || (await isRefreshLocked(h)))) {
      res.status(503).json({
        error: {
          message: 'Data service is starting and the first dataset is not published yet. Retry shortly.',
          code: 'DATA_LOADING',
        },
      });
      return;
    }
    const available = await getCachedAvailableYears(h);
    res.json({
      ...available,
      defaults: { startYear: config.defaultStartYear, endYear: config.defaultEndYear },
      methodology: methodologyBlock(),
    });
  }));

  // ---------- yearly (canonical + legacy alias) ----------
  // GET /api/focus/yearly is the canonical generic focus-yearly route.
  // GET /api/india/gdp-ranking is a PERMANENT compatibility alias: same
  // handler, same implementation, same analytical fields. Omitted country
  // defaults to IND on both; explicit countries are validated identically.
  const handleYearly = ah(async (req, res) => {
    const h = handle();
    const startYear = parseYear(req.query.startYear, 'startYear');
    const endYear = parseYear(req.query.endYear, 'endYear');
    if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
      throw httpError(400, 'Invalid range: startYear must not exceed endYear.', 'INVALID_RANGE');
    }
    const subject = parseOptionalSubject(req.query.subject);
    const result = await buildIndiaYearlyRows(h, {
      ...(startYear !== undefined ? { startYear } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: await parseFocusCountry(h, req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  });
  app.get('/api/india/gdp-ranking', handleYearly);
  app.get('/api/focus/yearly', handleYearly);

  // ---------- full level ranking ----------
  app.get('/api/ranking', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = await buildFullRanking(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      page: parsePositiveInt(req.query.page, 'page', { fallback: 1 }),
      pageSize: parsePositiveInt(req.query.pageSize, 'pageSize', { fallback: 50 }),
      search: req.query.search ?? '',
      focusIso3: await parseFocusCountry(handle(), req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- rank verification ----------
  app.get('/api/ranking/verify', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = await buildRankVerification(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      focusIso3: await parseFocusCountry(handle(), req.query.country),
      neighbors: normalizeNeighborCount(req.query.neighbors),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- full YoY ranking ----------
  app.get('/api/yoy-ranking', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = await buildFullYoyRanking(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      page: parsePositiveInt(req.query.page, 'page', { fallback: 1 }),
      pageSize: parsePositiveInt(req.query.pageSize, 'pageSize', { fallback: 50 }),
      search: req.query.search ?? '',
      focusIso3: await parseFocusCountry(handle(), req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- YoY verification ----------
  app.get('/api/yoy-ranking/verify', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = await buildYoyVerification(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      focusIso3: await parseFocusCountry(handle(), req.query.country),
      neighbors: normalizeNeighborCount(req.query.neighbors),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- rank-movement comparison (level, separate analytical layer) ----------
  app.get('/api/comparison/level', ah(async (req, res) => {
    // No silent indicator default: the comparison must name its series.
    const metricKey = parseMetric(req.query.indicator);
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for a rank-movement comparison.', 'MISSING_YEAR');
    }
    // Optional point breaker: None (absent/empty/"none") preserves two-year mode.
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const detail = String(req.query.detail ?? 'full').toLowerCase() === 'summary' ? 'summary' : 'full';
    // Ranking basis: per-capita level (default, backward-compatible) or
    // YoY % growth. Unknown values fail cleanly under INVALID_MODE.
    const mode = String(req.query.mode ?? 'level').toLowerCase();
    if (mode !== 'level' && mode !== 'yoy') {
      throw httpError(
        400,
        `Unknown comparison mode "${req.query.mode}". Valid modes: level, yoy.`,
        COMPARISON_ERROR_CODES.INVALID_MODE,
      );
    }
    const result =
      mode === 'yoy'
        ? await buildGrowthComparisonResponse(handle(), {
            metricKey,
            yearA,
            yearB,
            ...(yearMid !== undefined ? { yearMid } : {}),
            focusIso3: await parseFocusCountry(handle(), req.query.country),
            detail,
          })
        : await buildLevelComparisonResponse(handle(), {
            metricKey,
            yearA,
            yearB,
            ...(yearMid !== undefined ? { yearMid } : {}),
            focusIso3: await parseFocusCountry(handle(), req.query.country),
            detail,
          });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- generic entity comparison (Phase 4) ----------
  // Entities are validated specs ("country:IND", "aggregate:WLD",
  // "group:IND,CHN"); capability (entity types + metric semantics +
  // operation) is enforced in the service with explicit reason codes.
  // No silent indicator default: the comparison must name its series.
  app.get('/api/compare', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator);
    const yearA = parseYear(req.query.yearA, 'yearA');
    if (yearA === undefined) {
      throw httpError(400, 'yearA is required for a comparison.', 'MISSING_YEAR');
    }
    const rawB = req.query.yearB;
    const yearB = rawB === undefined || rawB === null || String(rawB).trim() === '' ? undefined : parseYear(rawB, 'yearB');
    const result = await buildCompareResponse(handle(), {
      entityA: req.query.entityA,
      entityB: req.query.entityB,
      ...(req.query.labelA !== undefined ? { labelA: req.query.labelA } : {}),
      ...(req.query.labelB !== undefined ? { labelB: req.query.labelB } : {}),
      metricKey,
      yearA,
      ...(yearB !== undefined ? { yearB } : {}),
      ...(req.query.operation !== undefined ? { operation: String(req.query.operation) } : {}),
      ...(req.query.groupMode !== undefined ? { groupMode: String(req.query.groupMode) } : {}),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- entity discovery (Phase 4, read-only) ----------
  // Countries and official aggregates come from stored World Bank metadata —
  // never hard-coded lists. Optional indicator (+year) annotates each entity
  // with stored-data presence for capability-driven pickers.
  app.get('/api/entities', ah(async (req, res) => {
    const h = handle();
    const type = String(req.query.type ?? 'country').toLowerCase();
    if (type !== 'country' && type !== 'aggregate' && type !== 'all') {
      throw httpError(400, `Unknown entity type "${req.query.type}". Expected "country", "aggregate" or "all".`, 'INVALID_ENTITY');
    }
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const page = parsePositiveInt(req.query.page, 'page', { fallback: 1 });
    const pageSize = parsePositiveInt(req.query.pageSize, 'pageSize', { fallback: 50, max: 500 });
    let observed = null;
    if (req.query.indicator !== undefined && req.query.indicator !== null && String(req.query.indicator).trim() !== '') {
      const metricKey = parseMetric(req.query.indicator);
      const indicator = await getIndicatorByMetricKey(h, metricKey);
      if (indicator) {
        const rawYear = req.query.year;
        const year = rawYear === undefined || rawYear === null || String(rawYear).trim() === '' ? null : parseYear(rawYear, 'year');
        observed = await getObservedCountryIds(h, indicator.id, year);
      } else {
        observed = new Set();
      }
    }
    const includeAggregates = type !== 'country';
    const onlyAggregates = type === 'aggregate';
    const rows = (await listCountries(h, { includeAggregates }))
      .filter((c) => !onlyAggregates || c.is_aggregate === 1)
      .filter(
        (c) =>
          search === '' ||
          String(c.name ?? '').toLowerCase().includes(search) ||
          String(c.iso3 ?? '').toLowerCase().includes(search) ||
          String(c.id ?? '').toLowerCase().includes(search),
      )
      .map((c) => ({
        iso3: c.iso3 ?? c.id,
        name: c.name,
        kind: c.is_aggregate === 1 ? 'wb_aggregate' : 'country',
        region: c.region ?? null,
        ...(observed !== null ? { hasData: observed.has(String(c.iso3 ?? c.id).toUpperCase()) } : {}),
      }));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const current = Math.max(1, Math.min(pages, page));
    const start = (current - 1) * pageSize;
    res.json({
      type,
      search: String(req.query.search ?? ''),
      count: rows.length,
      page: current,
      pageSize,
      pages,
      entities: rows.slice(start, start + pageSize),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- custom group evaluation preview (Phase 4, read-only) ----------
  // Validates a request-defined member set and reports capability + coverage
  // without performing a comparison. Groups are never persisted.
  app.get('/api/groups/evaluate', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator);
    const rawA = req.query.yearA;
    const rawB = req.query.yearB;
    const yearA = rawA === undefined || rawA === null || String(rawA).trim() === '' ? undefined : parseYear(rawA, 'yearA');
    const yearB = rawB === undefined || rawB === null || String(rawB).trim() === '' ? undefined : parseYear(rawB, 'yearB');
    const result = await buildGroupEvaluation(handle(), {
      members: req.query.members,
      ...(req.query.label !== undefined ? { label: req.query.label } : {}),
      metricKey,
      ...(yearA !== undefined ? { yearA } : {}),
      ...(yearB !== undefined ? { yearB } : {}),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- period summary (Phase 7C-3 exposure of 7C-1 methodology) ----------
  // Thin read-only exposure of the frozen period primitives: single-period
  // SUM/AVG over [startYear, endYear) with strict completeness. No new math
  // here — buildPeriodSummary owns the contract; the route only validates
  // request shape (unknown metric/operation/years fail closed with 400).
  app.get('/api/periods/summary', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator);
    const startYear = parseYear(req.query.startYear, 'startYear');
    const endYear = parseYear(req.query.endYear, 'endYear');
    if (startYear === undefined || endYear === undefined) {
      throw httpError(400, 'startYear and endYear are required for a period summary.', 'MISSING_YEAR');
    }
    const rawOp = req.query.operation;
    const operation = rawOp === undefined || rawOp === null || String(rawOp).trim() === '' ? 'SUM' : String(rawOp).trim().toUpperCase();
    if (operation !== 'SUM' && operation !== 'AVG') {
      throw httpError(400, `Unknown period operation "${req.query.operation}". Expected SUM or AVG.`, 'INVALID_OPERATION');
    }
    const result = await buildPeriodSummary(handle(), {
      metricKey,
      startYear,
      endYear,
      operation,
      focusIso3: await parseFocusCountry(handle(), req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- Prices movement (canonical 8-basis methodology) ----------
  // Prices-only: CPI Index (2 bases), CPI Inflation (3), GDP-deflator (3).
  // Uses S+1..E for inflation/deflator average+cumulative and endpoint-only
  // for CPI period change — never the generic [S,E) flow interval.
  // GDP/GDP-per-capita paths are untouched.
  app.get('/api/movement/prices', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isPricesMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not a Prices metric. Valid Prices keys: inflation_cpi_index, inflation_cpi, inflation_deflator.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for a Prices movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !basesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown Prices basis "${rawBasis}" for ${metricKey}. Valid: ${basesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildPricesMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(PRICES_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- Prices country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/prices/country-groups', ah(async (req, res) => {
    const result = await listPriceCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- Trade movement (canonical 4+4-basis methodology) ----------
  // Trade-only: annual value, CAGR, inclusive period total (S..E),
  // inclusive period average. Never the generic [S,E) flow interval and
  // never the Prices S+1..E inflation interval. GDP/Prices paths untouched.
  app.get('/api/movement/trade', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isTradeMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not a Trade metric. Valid Trade keys: exports_current, imports_current.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for a Trade movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !tradeBasesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown Trade basis "${rawBasis}" for ${metricKey}. Valid: ${tradeBasesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildTradeMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(TRADE_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- Trade country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/trade/country-groups', ah(async (req, res) => {
    const result = await listTradeCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- Capital Flow movement (canonical 3+3-basis methodology) ----------
  // Capital-only: annual, cumulative/average over S+1..E, cumulative FDI/GDP
  // from FDI+GDP legs. Never Trade S..E, never [S,E), never % growth.
  // GDP/Prices/Trade paths untouched.
  app.get('/api/movement/capital', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isCapitalMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not a Capital Flow metric. Valid Capital keys: fdi_inflows, fdi_inflows_pct_gdp.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for a Capital Flow movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !capitalBasesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown Capital Flow basis "${rawBasis}" for ${metricKey}. Valid: ${capitalBasesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildCapitalMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(CAPITAL_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- Capital Flow country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/capital/country-groups', ah(async (req, res) => {
    const result = await listCapitalCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- Exchange Rate movement (canonical 3-basis methodology) ----------
  // FX-only: annual level (never ranked), annual change (t-1/t), period
  // change (endpoints S/E) with display-only CAGR. LOO median benchmark.
  // GDP/Prices/Trade/Capital paths untouched.
  app.get('/api/movement/fx', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isFxMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not an Exchange Rate metric. Valid Exchange Rate keys: fx_official.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for an Exchange Rate movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !fxBasesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown Exchange Rate basis "${rawBasis}" for ${metricKey}. Valid: ${fxBasesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildFxMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(FX_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- Exchange Rate country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/fx/country-groups', ah(async (req, res) => {
    const result = await listFxCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- External Sector movement (canonical 3/3/4-basis methodology) ----------
  // External-only: CA/GDP ratios from CA+GDP legs, reserves stock/endpoints/
  // coverage, remittance flows + intensity. S+1..E for flow sequences,
  // endpoints for reserve change. Other families untouched.
  app.get('/api/movement/external', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isExternalMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not an External Sector metric. Valid External keys: current_account, reserves_ex_gold, remittances_received.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for an External Sector movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !externalBasesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown External Sector basis "${rawBasis}" for ${metricKey}. Valid: ${externalBasesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildExternalMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(EXTERNAL_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- External Sector country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/external/country-groups', ah(async (req, res) => {
    const result = await listExternalCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- Population movement (canonical 3-basis methodology) ----------
  // Population-only: annual stock, endpoint absolute change, endpoint %
  // growth with display-only CAGR. Stock semantics: never summed/averaged.
  // Other families untouched.
  app.get('/api/movement/population', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator ?? req.query.metric);
    if (!isPopulationMetric(metricKey)) {
      throw httpError(
        400,
        `Metric "${metricKey}" is not a Population metric. Valid Population keys: population_total.`,
        'INVALID_METRIC',
      );
    }
    const yearA = parseYear(req.query.yearA, 'yearA');
    const yearB = parseYear(req.query.yearB, 'yearB');
    if (yearA === undefined || yearB === undefined) {
      throw httpError(400, 'Both yearA and yearB are required for a Population movement comparison.', 'MISSING_YEAR');
    }
    const rawMid = req.query.yearMid ?? req.query.breaker ?? req.query.pointBreaker ?? req.query.mid;
    let yearMid;
    if (rawMid === undefined || rawMid === null || String(rawMid).trim() === '' || String(rawMid).trim().toLowerCase() === 'none') {
      yearMid = undefined;
    } else {
      yearMid = parseYear(rawMid, 'yearMid');
    }
    const rawBasis = req.query.basis;
    const basis = rawBasis === undefined || rawBasis === null || String(rawBasis).trim() === '' ? undefined : String(rawBasis).trim();
    if (basis !== undefined && !populationBasesForMetric(metricKey).includes(basis)) {
      throw httpError(
        400,
        `Unknown Population basis "${rawBasis}" for ${metricKey}. Valid: ${populationBasesForMetric(metricKey).join(', ')}.`,
        'INVALID_BASIS',
      );
    }
    const groupType = req.query.groupType ?? req.query.group_type ?? null;
    const groupValue = req.query.group ?? req.query.groupValue ?? req.query.group_value ?? null;
    try {
      const result = await buildPopulationMovement(handle(), {
        metricKey,
        ...(basis !== undefined ? { basis } : {}),
        yearA,
        yearB,
        ...(yearMid !== undefined ? { yearMid } : {}),
        focusIso3: await parseFocusCountry(handle(), req.query.country),
        ...(groupType || groupValue ? { group: { type: groupType ? String(groupType) : null, value: groupValue ? String(groupValue) : 'All' } } : {}),
      });
      res.json({ ...result, methodology: methodologyBlock() });
    } catch (e) {
      if (e && e.code && Object.values(POPULATION_ERROR_CODES).includes(e.code)) {
        throw httpError(e.httpStatus ?? 400, e.message, e.code);
      }
      throw e;
    }
  }));

  // ---------- Population country-group discovery (dynamic, no hardcoding) ----------
  app.get('/api/population/country-groups', ah(async (req, res) => {
    const result = await listPopulationCountryGroups(handle());
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- coverage (+ changing-totals explanation) ----------
  app.get('/api/coverage', ah(async (req, res) => {
    const h = handle();
    const year = parseYear(req.query.year, 'year');
    const subject = parseOptionalSubject(req.query.subject);
    const panel = await buildCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: await parseFocusCountry(handle(), req.query.country),
    });
    const yoyPanel = await buildYoyCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: await parseFocusCountry(handle(), req.query.country),
    });

    let explanation = null;
    const fromYear = parseYear(req.query.fromYear, 'fromYear');
    const toYear = parseYear(req.query.toYear, 'toYear');
    if (fromYear !== undefined || toYear !== undefined) {
      if (fromYear === undefined || toYear === undefined) {
        throw httpError(400, 'Both fromYear and toYear are required for a changing-totals explanation.', 'INVALID_RANGE');
      }
      const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
      explanation = await explainTotalChange(h, {
        metricKey,
        fromYear,
        toYear,
        focusIso3: await parseFocusCountry(handle(), req.query.country),
      });
    }

    res.json({ ...panel, yoy: yoyPanel, explanation, methodology: methodologyBlock() });
  }));

  // ---------- raw observations with provenance ----------
  app.get('/api/observations', ah(async (req, res) => {
    const h = handle();
    const metricKey = parseMetric(req.query.indicator);
    const year = parseYear(req.query.year, 'year');
    if (year === undefined) {
      throw httpError(400, 'Missing year. Observations are addressed by indicator and year.', 'MISSING_YEAR');
    }
    const indicator = await getIndicatorByMetricKey(h, metricKey);
    if (!indicator) {
      return res.json({
        available: false,
        reason: 'metric_not_ingested',
        metric: getMetric(metricKey),
        year,
        observations: [],
        methodology: methodologyBlock(),
      });
    }

    const country = req.query.country;
    if (country !== undefined && country !== null && country !== '') {
      const iso3 = await parseFocusCountry(h, country);
      const row = await getObservation(h, iso3, indicator.id, year);
      const meta = await getCountry(h, iso3);
      return res.json({
        available: Boolean(row),
        metric: getMetric(metricKey),
        year,
        country: { iso3, name: meta?.name ?? null, isAggregate: meta ? meta.is_aggregate === 1 : null },
        observation: row
          ? {
              value: row.value,
              valueRaw: row.value_raw ?? String(row.value),
              wbLastUpdated: row.wb_last_updated ?? null,
              fetchedAt: row.fetched_at ?? null,
            }
          : null,
        provenance: {
          note: 'SOURCE OBSERVATION (World Bank WDI) — not a calculated result. Absence of a row means no stored observation; missing data is never zero.',
        },
        methodology: methodologyBlock(),
      });
    }

    const rows = (await getEligibleObservations(h, indicator.id, year)).map((r) => ({
      iso3: r.iso3,
      country: r.name,
      value: r.value,
      valueRaw: r.valueRaw ?? String(r.value),
    }));
    res.json({
      available: rows.length > 0,
      metric: getMetric(metricKey),
      year,
      count: rows.length,
      observations: rows,
      methodology: methodologyBlock(),
    });
  }));

  // ---------- countries ----------
  app.get('/api/countries', ah(async (req, res) => {
    const h = handle();
    const include = String(req.query.includeAggregates ?? 'true').toLowerCase();
    const includeAggregates = !['0', 'false', 'no'].includes(include);
    const rows = await listCountries(h, { includeAggregates });
    res.json({
      count: rows.length,
      eligibleCount: await countEligibleCountries(h),
      aggregateCount: await countAggregateCountries(h),
      totalCount: await countAllCountries(h),
      countries: rows.map((c) => ({
        id: c.id,
        iso3: c.iso3,
        name: c.name,
        region: c.region,
        regionId: c.region_id,
        isAggregate: c.is_aggregate === 1,
        aggregateReason: c.aggregate_reason ?? null,
      })),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- metadata / audit ----------
  // Legacy contract, frozen: expectedIndicators and subjects describe the
  // production-enabled universe only, so Phase-2 disabled definitions cannot
  // alter a single field of this response. Rich semantic metadata lives on
  // the new GET /api/indicators endpoint instead (guardrails §26).
  app.get('/api/metadata', ah(async (req, res) => {
    const h = handle();
    res.json({
      source: SOURCE_INFO,
      apiBaseUrl: config.worldBank.baseUrl,
      indicators: await listIndicators(h),
      expectedIndicators: PRODUCTION_METRIC_KEYS.map((k) => getMetric(k)),
      subjects: describeSubjects().map((subject) => ({
        ...subject,
        metrics: subject.metricKeys.map((key) => describeMetric(METRICS[key])),
      })),
      universe: {
        total: await countAllCountries(h),
        eligible: await countEligibleCountries(h),
        aggregates: await countAggregateCountries(h),
      },
      years: await getCachedAvailableYears(h),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- measure catalog (Phase 2: semantic metadata, read-only) ----------
  // Exposes the full DEFINED registry: production metrics plus disabled
  // future definitions with their lifecycle state. No World Bank fetching, no
  // ingestion, no calculations, no secrets — metadata display only. Future
  // capability-driven UI (Phase 4/6) gates on these flags; legacy clients
  // keep using /api/metadata, which is unchanged above.
  app.get('/api/indicators', ah(async (req, res) => {
    const h = handle();
    // One batched read for every ingested flag below (never per-metric queries).
    const ingestedKeys = new Set((await listIndicators(h)).map((r) => r.metric_key));
    const isIngested = (key) => ingestedKeys.has(key);
    const production = PRODUCTION_METRIC_KEYS.map((key) => ({
      ...describeMeasure(getDefinedMetric(key)),
      lifecycle: 'PRODUCTION',
      productionEnabled: true,
      ingested: isIngested(key),
      // Additive Prices basis catalog (does not alter frozen fields above).
      ...(isPricesMetric(key) ? { pricesBases: basesForMetric(key).map((b) => ({ ...PRICES_BASIS_INFO_REF[b] })) } : {}),
      // Additive Trade basis catalog (does not alter frozen fields above).
      ...(isTradeMetric(key) ? { tradeBases: tradeBasesForMetric(key).map((b) => ({ ...TRADE_BASIS_INFO_REF[b] })) } : {}),
      // Additive Capital Flow basis catalog (does not alter frozen fields above).
      ...(isCapitalMetric(key) ? { capitalBases: capitalBasesForMetric(key).map((b) => ({ ...CAPITAL_BASIS_INFO_REF[b] })) } : {}),
      // Additive Exchange Rate basis catalog (does not alter frozen fields above).
      ...(isFxMetric(key) ? { fxBases: fxBasesForMetric(key).map((b) => ({ ...FX_BASIS_INFO_REF[b] })) } : {}),
      // Additive External Sector basis catalog (does not alter frozen fields above).
      ...(isExternalMetric(key) ? { externalBases: externalBasesForMetric(key).map((b) => ({ ...EXTERNAL_BASIS_INFO_REF[b] })) } : {}),
      // Additive Population basis catalog (does not alter frozen fields above).
      ...(isPopulationMetric(key) ? { populationBases: populationBasesForMetric(key).map((b) => ({ ...POPULATION_BASIS_INFO_REF[b] })) } : {}),
    }));
    const defined = FUTURE_METRIC_KEYS.map((key) => ({
      ...describeMeasure(getDefinedMetric(key)),
      productionEnabled: false,
      ingested: isIngested(key),
    }));
    res.json({
      count: production.length + defined.length,
      productionCount: production.length,
      definedCount: defined.length,
      production,
      defined,
      subjects: describeSubjects(),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- data status ----------
  app.get('/api/data-status', ah(async (req, res) => {
    const h = handle();
    const cache = await getCacheStatus(h);
    let lock = null;
    try {
      lock = await getRefreshLockState(h);
    } catch {
      lock = null;
    }
    // Dataset fingerprint: identifies the published refresh generation
    // (latest success run). Additive and read-only; lets already-open UIs
    // detect a background TTL refresh completion without re-fetching data
    // blindly, and keys the integrity memo below.
    let fingerprint = null;
    try {
      fingerprint = await getDatasetFingerprint(h);
    } catch {
      fingerprint = null;
    }
    // Integrity is memoized by refresh generation (R-12): the published
    // dataset only changes inside a successful publish transaction, which
    // always advances the fingerprint. Rapid polls within one generation
    // reuse the verified report instead of rescanning full tables.
    // /api/integrity below stays uncached (explicit on-demand validation).
    //
    // Phase 7B split memo: the cheap battery (small-table checks) is keyed
    // by the latest success run; the expensive battery (observation-table
    // scans) by content_version, so unchanged refreshes reuse the verified
    // report instead of rescanning. Merged checks keep canonical order and
    // shape. Absent dataset_state falls back to the legacy single memo.
    let integrity = null;
    try {
      const state = await getDatasetState(h);
      if (state) {
        const cheap = await getCachedCheapIntegrity(
          cheapIntegrityKey(fingerprint?.runId),
          async () => {
            const checks = mergeIntegrityChecks(
              await runCheapIntegrityChecks(h),
              await runMetadataIntegrityChecks(h),
            );
            return { passed: checks.every((c) => c.status === 'pass'), checks };
          },
        );
        const expensive = await getCachedExpensiveIntegrity(
          expensiveIntegrityKey(state.contentVersion),
          async () => {
            // Restart-safe shortcut (Phase 7B Part 6): when this exact
            // content generation already passed verification in a previous
            // process lifetime, the persisted deterministic checks are the
            // exact report — no rescan. Anything unparseable falls through
            // to the live battery below.
            if (state.integrityVerifiedContentVersion === state.contentVersion) {
              const stored = parseStoredIntegrityChecks(state);
              if (stored) return { passed: stored.every((c) => c.status === 'pass'), checks: stored };
            }
            const checks = await runExpensiveIntegrityChecks(h);
            return { passed: checks.every((c) => c.status === 'pass'), checks };
          },
        );
        const checks = mergeIntegrityChecks(cheap.report.checks, expensive.report.checks);
        const passed = cheap.report.passed && expensive.report.passed;
        integrity = {
          passed,
          checks: checks.map((c) => ({ check: c.check, status: c.status })),
        };
        // Record that this exact content generation passed, conditional on
        // the version being unchanged since the verification ran. Best
        // effort: never break the status response.
        if (!expensive.fromCache && passed) {
          try {
            await markIntegrityVerified(h, state.contentVersion, expensive.report.checks);
          } catch {
            // Diagnostic write only; the verified report stands regardless.
          }
        }
      } else {
        const key = integrityCacheKey(fingerprint);
        integrity = (
          await getCachedIntegrity(key, async () => {
            const report = await runIntegrityChecks(h);
            return { passed: report.passed, checks: report.checks.map((c) => ({ check: c.check, status: c.status })) };
          })
        ).report;
      }
    } catch (error) {
      integrity = { passed: false, error: error.message };
    }
    // Phase 8E: persisted terminal refresh summary + enriched history.
    // Metadata-only (fetch_runs tiny-table reads + pure-JS derivation; no
    // observation scan, no extra write, memoization untouched).
    let persistedRefresh = null;
    try {
      persistedRefresh = await getLatestPersistedProgress(h);
    } catch {
      persistedRefresh = null;
    }
    const durationMsOf = (run) => {
      if (!run?.started_at) return null;
      const end = run.completed_at ?? null;
      if (!end) return null;
      const ms = new Date(end).getTime() - new Date(run.started_at).getTime();
      return Number.isFinite(ms) && ms >= 0 ? ms : null;
    };
    // Phase 8F: the visible history payload is EXACTLY the latest 5 runs.
    // Historical fetch_runs rows stay in the database; only this payload is
    // limited. lastRefresh above is the persisted terminal summary (separate).
    let latestRuns = [];
    try {
      const rows = await listFetchRuns(h, 5);
      latestRuns = rows.map((run) => {
        const summary = parseProgressSummary(run?.progress_summary);
        return {
          ...run,
          duration_ms: durationMsOf(run),
          summary_counts: summary?.counts ?? null,
        };
      });
    } catch {
      latestRuns = [];
    }
    let lastRefresh = null;
    if (persistedRefresh) {
      const summary = parseProgressSummary(persistedRefresh.progress_summary);
      lastRefresh = {
        runId: persistedRefresh.id,
        status: persistedRefresh.status,
        trigger: persistedRefresh.trigger ?? null,
        startedAt: persistedRefresh.started_at ?? null,
        completedAt: persistedRefresh.completed_at ?? null,
        durationMs: durationMsOf(persistedRefresh),
        error: persistedRefresh.error_message ?? null,
        rowsRetrieved: persistedRefresh.rows_retrieved ?? null,
        rowsUpserted: persistedRefresh.rows_upserted ?? null,
        rowsSkippedUnchanged: persistedRefresh.rows_skipped_unchanged ?? null,
        summary: summary ?? null,
      };
    }
    res.json({
      ...cache,
      // Authoritative upstream World Bank vintage: MAX(wb_last_updated)
      // across stored observations (each row carries the WDI `lastupdated`
      // from its own retrieval). Distinct from lastSuccessAt below, which
      // is the LOCAL retrieval timestamp. Additive, read-only, derived —
      // no ingestion semantics involved.
      wbLastUpdated: await getMaxWbLastUpdated(h),
      inProgress: isRefreshInProgress(),
      progress: getIngestProgress(),
      // Phase 8E: persisted last completed refresh (survives remount/reload;
      // live `progress` above remains the in-memory ledger during a run).
      lastRefresh,
      retry: getRefreshRetryState(),
      lock,
      integrity,
      fingerprint,
      autoRefresh: {
        enabled: autoRefreshEnabled,
        ttlHours: cache.ttlHours,
      },
      // Phase 8F: safe PUBLIC database target (logical label only — never the
      // Turso hostname/URL, tokens, or credentials) reflecting the ACTUAL
      // active handle, so fallback SQLite is never misreported as Turso.
      database: publicDatabaseTarget(),
      // Additive presentation signal (Phase 6): lets the public UI hide the
      // manual-refresh action when the backend requires an admin token.
      // Non-analytical; exposes only whether auth is required, never the token.
      refreshRequiresAuth: config.refreshAdminToken !== '',
      latestRuns,
      years: await getCachedAvailableYears(h),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- integrity ----------
  app.get('/api/integrity', ah(async (req, res) => {
    const h = handle();
    const report = await runIntegrityChecks(h);
    // An explicit on-demand validation that passes records the verified
    // content generation (conditional on the version being unchanged since
    // the scan). Best effort; the report itself is unaffected.
    if (report.passed) {
      try {
        const state = await getDatasetState(h);
        if (state) {
          const expensive = report.checks.filter((c) => EXPENSIVE_CHECK_NAMES.includes(c.check));
          await markIntegrityVerified(h, state.contentVersion, expensive);
        }
      } catch {
        // Diagnostic write only.
      }
    }
    res.json({ ...report, methodology: methodologyBlock() });
  }));

  // ---------- manual refresh ----------
  app.post('/api/data/refresh', ah(async (req, res) => {
    const retryAfter = refreshRateLimitCheck(req);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      throw httpError(429, 'Too many manual refresh requests. Please wait before retrying.', 'REFRESH_RATE_LIMITED');
    }
    requireRefreshAuth(req);
    const body = req.body ?? {};
    const startYear = body.startYear !== undefined ? parseYear(body.startYear, 'startYear') : undefined;
    const endYear = body.endYear !== undefined ? parseYear(body.endYear, 'endYear') : undefined;
    if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
      throw httpError(400, 'Invalid range: startYear must not exceed endYear.', 'INVALID_RANGE');
    }
    let indicators;
    if (body.indicators !== undefined) {
      if (!Array.isArray(body.indicators) || body.indicators.length === 0) {
        throw httpError(400, 'Invalid indicators: expected a non-empty array of metric keys.', 'INVALID_INDICATOR');
      }
      indicators = body.indicators.map((k) => parseMetric(k));
    }
    try {
      // Phase 8F: a manual refresh while serving fallback first gives the
      // recovered primary a bounded chance to take over (revalidated before
      // promotion), so production writes land on Turso again — never silently
      // on fallback SQLite. Failure to recover simply refreshes fallback.
      if (shared?.isFallback) {
        try {
          await maybeRecoverPrimary(shared, {
            onWarn: (w) => console.warn(`Primary recovery: ${w.message}`),
          });
        } catch {
          // Recovery is best-effort; the refresh below proceeds regardless.
        }
      }
      const summary = await refreshData({
        ...(startYear !== undefined ? { startYear } : {}),
        ...(endYear !== undefined ? { endYear } : {}),
        ...(indicators ? { indicators } : {}),
        trigger: 'manual',
        db: handle(),
      });
      res.json({ ...summary, methodology: methodologyBlock() });
    } catch (error) {
      if (error.code === 'REFRESH_IN_PROGRESS') {
        throw httpError(409, 'A World Bank data refresh is already in progress.', 'REFRESH_IN_PROGRESS');
      }
      throw error;
    }
  }));

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.httpStatus ?? 500;
    res.status(status).json({
      error: {
        message: status === 500 ? 'Internal server error.' : error.message,
        code: error.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
      },
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: { message: `Unknown endpoint: ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
  });

  return app;
}

async function boot() {
  // Production fail-closed: an unrestricted refresh endpoint or a blanket
  // CORS policy must never silently serve production traffic.
  if (process.env.NODE_ENV === 'production') {
    if (!config.refreshAdminToken) {
      console.error('Refusing to start: production requires REFRESH_ADMIN_TOKEN to be configured.');
      process.exit(1);
    }
    if (!config.corsOrigins || config.corsOrigins.length === 0) {
      console.error('Refusing to start: production requires CORS_ORIGINS to be configured.');
      process.exit(1);
    }
  }

  // Database backend selection (Phase 6A): Turso Cloud when configured,
  // otherwise the local SQLite file. A Turso outage never silently becomes
  // an uncontrolled full seed: with a usable non-empty local database and
  // ALLOW_LOCAL_DB_FALLBACK the server falls back loudly; otherwise
  // production serves degraded (empty, no auto-seed) and development fails
  // fast with the connection error.
  const target = describeDbTarget();
  if (process.env.NODE_ENV === 'production' && target.mode !== 'turso') {
    console.warn(
      'Production is using the local SQLite file (no TURSO_DATABASE_URL): data will not survive ephemeral restarts. Configure Turso for persistent production storage.',
    );
  }
  console.log(
    `Database backend: ${target.mode}` +
      (target.mode === 'turso' ? ` (${target.host ?? 'unknown host'})` : ` (${target.file})`),
  );

  let db = null;
  let degraded = false;
  let isFallback = false;
  const isProduction = process.env.NODE_ENV === 'production';
  // Phase 7B: derived dataset metadata (1 row) once the handle exists, so
  // boot decisions below never scan the observations table on a warm
  // database. Null = unknown (legacy database): legacy scans apply once,
  // then the row is bootstrapped below and never rescanned per restart.
  let datasetState = null;
  try {
    db = getDb();
    await initDatabase(db, { localFile: target.mode === 'local' });
    await pingDatabase(db);
    datasetState = await getDatasetState(db);
    if (target.mode === 'turso') {
      const present = datasetState ? datasetState.observationCount : await countObservations(db);
      console.log(
        present > 0
          ? `Turso database reachable with ${present} stored observations; no startup ingestion needed.`
          : 'Turso database reachable but empty; startup ingestion will seed it.',
      );
    }
    // Phase 8F: record the ACTUAL active handle for the public Status UI.
    setActiveDbInfo({
      provider: target.mode === 'turso' ? 'turso' : 'sqlite',
      isFallback: false,
      isDegraded: false,
      isProduction,
    });
  } catch (error) {
    const fallback = config.allowLocalDbFallback ? await openExistingLocalDb() : null;
    if (fallback) {
      console.warn(
        `Primary database (${target.mode}) unreachable (${error.message}); serving from the existing local database instead. This fallback hides a persistent-database outage — investigate promptly.`,
      );
      db = fallback.handle;
      isFallback = true;
      setActiveDbInfo({ provider: 'sqlite', isFallback: true, isDegraded: false, isProduction });
    } else if (process.env.NODE_ENV === 'production') {
      console.error(
        `Primary database (${target.mode}) unreachable and no usable local database exists (${error.message}). Serving DEGRADED with an empty dataset and no automatic seeding; POST /api/data/refresh once the database recovers.`,
      );
      degraded = true;
      db = getDb();
      try {
        await initDatabase(db, { localFile: target.mode === 'local' });
      } catch {
        // Degraded means best-effort; request paths already tolerate an empty store.
      }
      setActiveDbInfo({
        provider: target.mode === 'turso' ? 'turso' : 'sqlite',
        isFallback: false,
        isDegraded: true,
        isProduction,
      });
    } else {
      throw error;
    }
  }
  // A fallback handle may carry its own derived row; re-read so the boot
  // decisions below use it instead of scanning.
  if (!datasetState && db && !degraded) {
    try {
      datasetState = await getDatasetState(db);
    } catch {
      datasetState = null;
    }
  }

  // Crash recovery first: a stale SQLite lock must never wedge the server.
  try {
    const state = await getRefreshLockState(db);
    if (state?.locked) {
      const recovered = await recoverRefreshLock(db, 'server boot recovery');
      console.log(`Recovered stale refresh lock (holder: ${recovered?.previous?.holder ?? 'unknown'}).`);
    }
  } catch (error) {
    console.warn(`Refresh-lock recovery skipped: ${error.message}`);
  }

  // Accept traffic (especially /api/health) BEFORE any potentially slow
  // data work: on a cold host the service must answer readiness while the
  // first dataset is still being prepared, never block listen() on a
  // multi-minute ingest. /api/years reports DATA_LOADING (503) while the
  // seed runs; every other endpoint keeps its existing behavior.
  // Phase 8F: the shared handle cell lets a guarded primary recovery promote
  // future traffic without restarting (in-flight work keeps its reference).
  const shared = { current: db, isFallback, isDegraded: degraded };
  const app = createApp({ shared });
  const server = app.listen(config.port, () => {
    console.log(`World Bank India GDP ranking backend listening on port ${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/api/health`);
  });

  // First-run behavior: ingest on empty when enabled — now in the
  // background, after listen(), so startup never blocks availability.
  // Degraded production never seeds: a giant unattended ingest is exactly
  // the failure mode persistence exists to avoid.
  // Phase 7B: emptiness comes from dataset_state when derived (no scan);
  // a populated database without a row gets its one-time bootstrap here
  // (exact scans, once per database — never per restart).
  try {
    if (degraded) {
      console.log('Degraded mode: automatic startup ingestion is disabled until the primary database recovers.');
    } else if ((datasetState ? datasetState.observationCount : await countObservations(db)) === 0) {
      if (config.autoIngestOnEmpty) {
        console.log('Database is empty; ingesting World Bank data in the background...');
        ensureDataPresent(db, { trigger: 'boot' }).then(
          () => console.log('Startup ingestion complete.'),
          (error) => console.error(`Startup ingestion failed: ${error.message}`),
        );
      } else {
        console.log('Database is empty; WB_AUTO_INGEST_ON_EMPTY=0 so startup ingestion is skipped. POST /api/data/refresh to ingest.');
      }
    } else {
      if (!datasetState) {
        // One-time bootstrap for a legacy populated database: derive the
        // exact metadata once so every later restart serves it from 1 row.
        // INSERT-only (never overwrite): a concurrent successful publish
        // always wins over this stale-capable bootstrap.
        try {
          const computed = await computeDatasetState(db);
          const inserted = await insertDatasetStateIfAbsent(db, {
            ...computed,
            contentVersion: 1,
            integrityVerifiedContentVersion: null,
            updatedRunId: null,
          });
          datasetState = await getDatasetState(db);
          if (inserted) {
            console.log(
              `Dataset metadata bootstrapped (content v1, ${datasetState?.observationCount ?? 0} observations).`,
            );
          }
        } catch (error) {
          console.warn(`Dataset metadata bootstrap skipped: ${error.message}`);
        }
      }
      const cache = await getCacheStatus(db);
      if (cache.refreshDue) {
        // Stale cache at boot: refresh in the background while serving.
        // maybeAutoRefresh() re-checks all guards (freshness, locks,
        // post-failure cooldown), so this is safe to attempt unconditionally.
        const decision = await maybeAutoRefresh(db, {
          onWarn: (w) => console.warn(`Auto-refresh: ${w.message}`),
        });
        if (decision.triggered) {
          console.log(`Cache is stale (last success: ${cache.lastSuccessAt ?? 'never'}); automatic refresh started in the background.`);
        } else {
          console.log(`Cache is stale (last success: ${cache.lastSuccessAt ?? 'never'}); automatic refresh not started (${decision.reason}). POST /api/data/refresh to refresh manually.`);
        }
      }
    }
  } catch (error) {
    console.error(`Startup data check failed: ${error.message}`);
  }

  // Integrity report at boot (warn-only; the API exposes the full report).
  // Phase 7B: the cheap + run/metadata battery only (small tables, short
  // index probes) — the observation-table scans run on demand through
  // /api/data-status (first request per content generation) and explicit
  // /api/integrity, never on every restart. The verification state of the
  // current content generation is logged from dataset_state instead.
  try {
    const cheap = await runCheapIntegrityChecks(db);
    const meta = await runMetadataIntegrityChecks(db);
    const checks = mergeIntegrityChecks(cheap, meta);
    const failed = checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) {
      console.warn(`Integrity: ${failed.length} check(s) failing: ${failed.map((c) => c.check).join(', ')}`);
    } else {
      console.log('Integrity checks passed.');
    }
    if (datasetState) {
      const verified = datasetState.integrityVerifiedContentVersion;
      console.log(
        verified != null && verified === datasetState.contentVersion
          ? `Content v${datasetState.contentVersion} integrity-verified.`
          : `Content v${datasetState.contentVersion} not yet integrity-verified; first status request verifies it.`,
      );
    }
  } catch (error) {
    console.warn(`Integrity checks skipped: ${error.message}`);
  }

  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  boot().catch((error) => {
    console.error(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

export default createApp;
