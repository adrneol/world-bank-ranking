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
import { closeDb, getDb } from './db/index.js';
import {
  countAggregateCountries,
  countAllCountries,
  countEligibleCountries,
  getCountry,
  getIndicatorByMetricKey,
  getObservation,
  getObservedCountryIds,
  listAvailableYears,
  listCountries,
  listFetchRuns,
  listIndicators,
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
import { buildRankVerification, normalizeNeighborCount } from './services/rankVerification.js';
import { buildFullYoyRanking, buildYoyVerification } from './services/yoyVerification.js';
import {
  ensureDataPresent,
  getCacheStatus,
  getIngestProgress,
  getRefreshLockState,
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
]);

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
function parseFocusCountry(db, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return FOCUS_COUNTRY.iso3;
  }
  const iso3 = parseCountry(value);
  const meta = getCountry(db, iso3);
  if (!meta || meta.is_aggregate === 1) {
    throw httpError(
      400,
      `Unknown country "${value}". Expected the ISO3 code of an eligible country/economy (e.g. IND).`,
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

export function createApp({ db = null, autoRefresh = null } = {}) {
  const app = express();
  const handle = () => db ?? getDb();
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
      try {
        if (req.method === 'GET' && AUTO_REFRESH_PATHS.includes(req.path)) {
          const decision = maybeAutoRefresh(handle(), {
            onWarn: (w) => console.warn(`Auto-refresh: ${w.message}`),
          });
          if (decision.triggered) res.setHeader('X-Auto-Refresh', decision.reason);
        }
      } catch {
        // Auto-refresh must never break a data request.
      }
      next();
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

  // ---------- years ----------
  app.get('/api/years', ah(async (req, res) => {
    const available = listAvailableYears(handle());
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
    const result = buildIndiaYearlyRows(h, {
      ...(startYear !== undefined ? { startYear } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: parseFocusCountry(h, req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  });
  app.get('/api/india/gdp-ranking', handleYearly);
  app.get('/api/focus/yearly', handleYearly);

  // ---------- full level ranking ----------
  app.get('/api/ranking', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = buildFullRanking(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      page: parsePositiveInt(req.query.page, 'page', { fallback: 1 }),
      pageSize: parsePositiveInt(req.query.pageSize, 'pageSize', { fallback: 50 }),
      search: req.query.search ?? '',
      focusIso3: parseFocusCountry(handle(), req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- rank verification ----------
  app.get('/api/ranking/verify', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = buildRankVerification(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      focusIso3: parseFocusCountry(handle(), req.query.country),
      neighbors: normalizeNeighborCount(req.query.neighbors),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- full YoY ranking ----------
  app.get('/api/yoy-ranking', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = buildFullYoyRanking(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      page: parsePositiveInt(req.query.page, 'page', { fallback: 1 }),
      pageSize: parsePositiveInt(req.query.pageSize, 'pageSize', { fallback: 50 }),
      search: req.query.search ?? '',
      focusIso3: parseFocusCountry(handle(), req.query.country),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- YoY verification ----------
  app.get('/api/yoy-ranking/verify', ah(async (req, res) => {
    const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
    const year = parseYear(req.query.year, 'year');
    const result = buildYoyVerification(handle(), {
      metricKey,
      ...(year !== undefined ? { year } : {}),
      focusIso3: parseFocusCountry(handle(), req.query.country),
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
        ? buildGrowthComparisonResponse(handle(), {
            metricKey,
            yearA,
            yearB,
            ...(yearMid !== undefined ? { yearMid } : {}),
            focusIso3: parseFocusCountry(handle(), req.query.country),
            detail,
          })
        : buildLevelComparisonResponse(handle(), {
            metricKey,
            yearA,
            yearB,
            ...(yearMid !== undefined ? { yearMid } : {}),
            focusIso3: parseFocusCountry(handle(), req.query.country),
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
    const result = buildCompareResponse(handle(), {
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
      const indicator = getIndicatorByMetricKey(h, metricKey);
      if (indicator) {
        const rawYear = req.query.year;
        const year = rawYear === undefined || rawYear === null || String(rawYear).trim() === '' ? null : parseYear(rawYear, 'year');
        observed = getObservedCountryIds(h, indicator.id, year);
      } else {
        observed = new Set();
      }
    }
    const includeAggregates = type !== 'country';
    const onlyAggregates = type === 'aggregate';
    const rows = listCountries(h, { includeAggregates })
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
    const result = buildGroupEvaluation(handle(), {
      members: req.query.members,
      ...(req.query.label !== undefined ? { label: req.query.label } : {}),
      metricKey,
      ...(yearA !== undefined ? { yearA } : {}),
      ...(yearB !== undefined ? { yearB } : {}),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- coverage (+ changing-totals explanation) ----------
  app.get('/api/coverage', ah(async (req, res) => {
    const h = handle();
    const year = parseYear(req.query.year, 'year');
    const subject = parseOptionalSubject(req.query.subject);
    const panel = buildCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: parseFocusCountry(handle(), req.query.country),
    });
    const yoyPanel = buildYoyCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      ...(subject ? { subject } : {}),
      focusIso3: parseFocusCountry(handle(), req.query.country),
    });

    let explanation = null;
    const fromYear = parseYear(req.query.fromYear, 'fromYear');
    const toYear = parseYear(req.query.toYear, 'toYear');
    if (fromYear !== undefined || toYear !== undefined) {
      if (fromYear === undefined || toYear === undefined) {
        throw httpError(400, 'Both fromYear and toYear are required for a changing-totals explanation.', 'INVALID_RANGE');
      }
      const metricKey = parseMetric(req.query.indicator, METRIC_KEYS[0]);
      explanation = explainTotalChange(h, {
        metricKey,
        fromYear,
        toYear,
        focusIso3: parseFocusCountry(handle(), req.query.country),
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
    const indicator = getIndicatorByMetricKey(h, metricKey);
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
      const iso3 = parseFocusCountry(h, country);
      const row = getObservation(h, iso3, indicator.id, year);
      const meta = getCountry(h, iso3);
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

    const { getEligibleObservations } = await import('./db/repository.js');
    const rows = getEligibleObservations(h, indicator.id, year).map((r) => ({
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
    const rows = listCountries(h, { includeAggregates });
    res.json({
      count: rows.length,
      eligibleCount: countEligibleCountries(h),
      aggregateCount: countAggregateCountries(h),
      totalCount: countAllCountries(h),
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
      indicators: listIndicators(h),
      expectedIndicators: PRODUCTION_METRIC_KEYS.map((k) => getMetric(k)),
      subjects: describeSubjects().map((subject) => ({
        ...subject,
        metrics: subject.metricKeys.map((key) => describeMetric(METRICS[key])),
      })),
      universe: {
        total: countAllCountries(h),
        eligible: countEligibleCountries(h),
        aggregates: countAggregateCountries(h),
      },
      years: listAvailableYears(h),
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
    const isIngested = (key) => getIndicatorByMetricKey(h, key) !== null;
    const production = PRODUCTION_METRIC_KEYS.map((key) => ({
      ...describeMeasure(getDefinedMetric(key)),
      lifecycle: 'PRODUCTION',
      productionEnabled: true,
      ingested: isIngested(key),
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
    const cache = getCacheStatus(h);
    let lock = null;
    try {
      lock = getRefreshLockState(h);
    } catch {
      lock = null;
    }
    let integrity = null;
    try {
      const report = runIntegrityChecks(h);
      integrity = { passed: report.passed, checks: report.checks.map((c) => ({ check: c.check, status: c.status })) };
    } catch (error) {
      integrity = { passed: false, error: error.message };
    }
    res.json({
      ...cache,
      inProgress: isRefreshInProgress(),
      progress: getIngestProgress(),
      lock,
      integrity,
      autoRefresh: {
        enabled: autoRefreshEnabled,
        ttlHours: cache.ttlHours,
      },
      // Additive presentation signal (Phase 6): lets the public UI hide the
      // manual-refresh action when the backend requires an admin token.
      // Non-analytical; exposes only whether auth is required, never the token.
      refreshRequiresAuth: config.refreshAdminToken !== '',
      latestRuns: listFetchRuns(h, 5),
      years: listAvailableYears(h),
      methodology: methodologyBlock(),
    });
  }));

  // ---------- integrity ----------
  app.get('/api/integrity', ah(async (req, res) => {
    const report = runIntegrityChecks(handle());
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

  const db = getDb();

  // Crash recovery first: a stale SQLite lock must never wedge the server.
  try {
    const state = getRefreshLockState(db);
    if (state?.locked) {
      const recovered = recoverRefreshLock(db, 'server boot recovery');
      console.log(`Recovered stale refresh lock (holder: ${recovered?.previous?.holder ?? 'unknown'}).`);
    }
  } catch (error) {
    console.warn(`Refresh-lock recovery skipped: ${error.message}`);
  }

  // First-run behavior: ingest on empty when enabled.
  try {
    const { countObservations } = await import('./db/repository.js');
    if (countObservations(db) === 0) {
      if (config.autoIngestOnEmpty) {
        console.log('Database is empty; ingesting World Bank data on startup...');
        await ensureDataPresent(db, { trigger: 'boot' });
        console.log('Startup ingestion complete.');
      } else {
        console.log('Database is empty; WB_AUTO_INGEST_ON_EMPTY=0 so startup ingestion is skipped. POST /api/data/refresh to ingest.');
      }
    } else {
      const cache = getCacheStatus(db);
      if (cache.refreshDue) {
        // Stale cache at boot: refresh in the background while serving.
        // maybeAutoRefresh() re-checks all guards (freshness, locks,
        // post-failure cooldown), so this is safe to attempt unconditionally.
        const decision = maybeAutoRefresh(db, {
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
  try {
    const report = runIntegrityChecks(db);
    const failed = report.checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) {
      console.warn(`Integrity: ${failed.length} check(s) failing: ${failed.map((c) => c.check).join(', ')}`);
    } else {
      console.log('Integrity checks passed.');
    }
  } catch (error) {
    console.warn(`Integrity checks skipped: ${error.message}`);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`World Bank India GDP ranking backend listening on port ${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/api/health`);
  });

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
