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
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config, { FOCUS_COUNTRY, METRIC_KEYS, SOURCE_INFO, getMetric } from './config.js';
import { closeDb, getDb } from './db/index.js';
import {
  countAggregateCountries,
  countAllCountries,
  countEligibleCountries,
  getCountry,
  getIndicatorByMetricKey,
  getObservation,
  listAvailableYears,
  listCountries,
  listFetchRuns,
  listIndicators,
} from './db/repository.js';
import { describeUniverseRule } from './domain/universe.js';
import { buildLevelComparisonResponse, COMPARISON_ERROR_CODES } from './services/comparisonService.js';
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
  '/api/ranking',
  '/api/ranking/verify',
  '/api/yoy-ranking',
  '/api/yoy-ranking/verify',
  '/api/coverage',
  '/api/comparison/level',
  '/api/observations',
  '/api/countries',
  '/api/metadata',
]);

/** Shared methodology block for auditability (§20). */
export function methodologyBlock() {
  return {
    source: SOURCE_INFO.provider,
    dataset: SOURCE_INFO.dataset,
    rankWording: SOURCE_INFO.rankWording,
    rankDisclaimer: SOURCE_INFO.rankDisclaimer,
    levelRanking: 'value DESC, ISO3 ASC; rank = 1-based ordinal position. Ties are ordered deterministically by ISO3 and therefore receive distinct ordinal positions.',
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
    throw httpError(400, `Missing indicator. Valid keys: ${METRIC_KEYS.join(', ')} (or an exact World Bank indicator code).`, 'INVALID_INDICATOR');
  }
  try {
    return getMetric(String(value)).key;
  } catch {
    throw httpError(400, `Unknown indicator "${value}". Valid keys: ${METRIC_KEYS.join(', ')} (or an exact World Bank indicator code).`, 'INVALID_INDICATOR');
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

export function createApp({ db = null, autoRefresh = null } = {}) {
  const app = express();
  const handle = () => db ?? getDb();
  // Test seam: server.test.js and ttlRefresh.test.js control this explicitly.
  // Production default follows WB_AUTO_REFRESH_ON_STALE (default true).
  const autoRefreshEnabled = autoRefresh ?? config.autoRefreshOnStale;

  app.disable('x-powered-by');
  app.use(cors());
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
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      databaseFile: config.databaseFile,
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

  // ---------- india yearly ----------
  app.get('/api/india/gdp-ranking', ah(async (req, res) => {
    const h = handle();
    const startYear = parseYear(req.query.startYear, 'startYear');
    const endYear = parseYear(req.query.endYear, 'endYear');
    if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
      throw httpError(400, 'Invalid range: startYear must not exceed endYear.', 'INVALID_RANGE');
    }
    const result = buildIndiaYearlyRows(h, {
      ...(startYear !== undefined ? { startYear } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
    });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

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
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
            focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
            detail,
          })
        : buildLevelComparisonResponse(handle(), {
            metricKey,
            yearA,
            yearB,
            ...(yearMid !== undefined ? { yearMid } : {}),
            focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
            detail,
          });
    res.json({ ...result, methodology: methodologyBlock() });
  }));

  // ---------- coverage (+ changing-totals explanation) ----------
  app.get('/api/coverage', ah(async (req, res) => {
    const h = handle();
    const year = parseYear(req.query.year, 'year');
    const panel = buildCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
    });
    const yoyPanel = buildYoyCoveragePanel(h, {
      ...(year !== undefined ? { year } : {}),
      focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
        focusIso3: parseCountry(req.query.country, FOCUS_COUNTRY.iso3),
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
      const iso3 = parseCountry(country);
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
  app.get('/api/metadata', ah(async (req, res) => {
    const h = handle();
    res.json({
      source: SOURCE_INFO,
      apiBaseUrl: config.worldBank.baseUrl,
      indicators: listIndicators(h),
      expectedIndicators: METRIC_KEYS.map((k) => getMetric(k)),
      universe: {
        total: countAllCountries(h),
        eligible: countEligibleCountries(h),
        aggregates: countAggregateCountries(h),
      },
      years: listAvailableYears(h),
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
