/**
 * Centralized backend API client.
 *
 * The ONLY place that knows endpoint URLs. It handles the base URL
 * (VITE_API_BASE_URL, same-origin fallback), JSON parsing, HTTP errors,
 * abort signals and bounded request timeouts. It never calculates ranks,
 * YoY values, denominators or coverage — it only transports
 * backend-calculated results.
 *
 * Every request is bounded (default 30 s, per-call `timeoutMs` override):
 * a hung backend produces a distinct retryable TIMEOUT ApiError, never an
 * eternally pending promise. Caller aborts (filter changes, unmount, manual
 * retry) keep native AbortError semantics.
 */

// Precedence: explicit VITE_API_BASE_URL (local override or production)
// wins; empty/absent falls back to relative /api (Vite dev proxy locally,
// same-origin API in deployments that serve both from one host). Trailing
// slashes and surrounding whitespace are stripped so neither
// "<base>//api/years" nor "<base>api/years" can be constructed.
// The optional chaining keeps this module importable outside Vite (e.g.
// Node-based contract tests where import.meta.env is undefined); browser
// behavior is unchanged.
let baseUrlOverride = null;
const BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

function resolveBaseUrl() {
  return baseUrlOverride ?? BASE_URL;
}

/**
 * Test seam (and advanced embedding override): point the client at an
 * explicit base URL. Production code never calls this; the build-time
 * VITE_API_BASE_URL remains the only production mechanism.
 */
export function setApiBaseUrl(url) {
  baseUrlOverride = typeof url === 'string' && url.trim() !== '' ? url.trim().replace(/\/+$/, '') : null;
}

/**
 * Default bound for one backend request (ms). Slow first responses
 * (cold-starting hosts, saturated networks) must surface as a distinct,
 * retryable TIMEOUT error — never as infinite loading.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function buildUrl(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return `${resolveBaseUrl()}${path}${suffix ? `?${suffix}` : ''}`;
}

async function request(
  path,
  { params = {}, signal = null, method = 'GET', body = null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  // Compose the caller's AbortSignal (filter changes, unmount, manual retry)
  // with a bounded timeout so a hung backend can never leave the UI in
  // loading forever. Caller aborts keep AbortError semantics; only the
  // timeout produces the distinct TIMEOUT ApiError.
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else if (typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  }
  let response;
  try {
    response = await fetch(buildUrl(path, method === 'GET' ? params : {}), {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (timedOut || error?.name === 'TimeoutError') {
      throw new ApiError(
        `The backend is taking longer than expected (HTTP ${method} ${path} exceeded ${timeoutMs} ms). It may be warming up — retry shortly.`,
        { code: 'TIMEOUT' },
      );
    }
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the backend. Is the API server running?', { code: 'NETWORK_ERROR' });
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Backend returned an unreadable response (HTTP ${response.status}).`, {
      status: response.status,
      code: 'BAD_RESPONSE',
    });
  }

  if (!response.ok) {
    throw new ApiError(payload?.error?.message ?? `Backend request failed (HTTP ${response.status}).`, {
      status: response.status,
      code: payload?.error?.code ?? 'REQUEST_ERROR',
    });
  }
  return payload;
}

const get = (path, params, options) => request(path, { ...options, params });

export const api = {
  health: (options) => get('/api/health', {}, options),
  years: (options) => get('/api/years', {}, options),
  indiaRanking: ({ startYear, endYear, country, subject } = {}, options) =>
    get('/api/india/gdp-ranking', { startYear, endYear, country, subject }, options),
  // Canonical generic focus-yearly route (Phase 1). Same handler and same
  // analytical fields as /api/india/gdp-ranking, which remains as an alias.
  focusYearly: ({ startYear, endYear, country, subject } = {}, options) =>
    get('/api/focus/yearly', { startYear, endYear, country, subject }, options),
  ranking: ({ indicator, year, page, pageSize, search, country } = {}, options) =>
    get('/api/ranking', { indicator, year, page, pageSize, search, country }, options),
  rankVerify: ({ indicator, year, country, neighbors } = {}, options) =>
    get('/api/ranking/verify', { indicator, year, country, neighbors }, options),
  yoyRanking: ({ indicator, year, page, pageSize, search, country } = {}, options) =>
    get('/api/yoy-ranking', { indicator, year, page, pageSize, search, country }, options),
  yoyVerify: ({ indicator, year, country, neighbors } = {}, options) =>
    get('/api/yoy-ranking/verify', { indicator, year, country, neighbors }, options),
  coverage: ({ year, country, fromYear, toYear, indicator, subject } = {}, options) =>
    get('/api/coverage', { year, country, fromYear, toYear, indicator, subject }, options),
  comparisonLevel: ({ indicator, yearA, yearB, yearMid, country, detail, mode } = {}, options) =>
    get(
      '/api/comparison/level',
      {
        indicator,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none'
          ? { yearMid }
          : {}),
        country,
        detail,
        ...(mode !== undefined && mode !== null && String(mode).trim() !== '' ? { mode } : {}),
      },
      options,
    ),
  observations: ({ indicator, year, country } = {}, options) =>
    get('/api/observations', { indicator, year, country }, options),
  countries: ({ includeAggregates } = {}, options) =>
    get('/api/countries', { includeAggregates }, options),
  metadata: (options) => get('/api/metadata', {}, options),
  indicators: (options) => get('/api/indicators', {}, options),
  // Phase-4 entity comparison (backend-authoritative; no economics in React).
  entities: ({ type, search, page, pageSize, indicator, year } = {}, options) =>
    get('/api/entities', { type, search, page, pageSize, indicator, year }, options),
  compare: ({ entityA, entityB, labelA, labelB, indicator, yearA, yearB, operation, groupMode } = {}, options) =>
    get('/api/compare', { entityA, entityB, labelA, labelB, indicator, yearA, yearB, operation, groupMode }, options),
  groupsEvaluate: ({ members, label, indicator, yearA, yearB } = {}, options) =>
    get('/api/groups/evaluate', { members: Array.isArray(members) ? members.join(',') : members, label, indicator, yearA, yearB }, options),
  // Phase-7C period summary (7C-1 methodology, read-only exposure): single
  // strict SUM/AVG over [startYear, endYear) for the focus entity.
  periodSummary: ({ indicator, startYear, endYear, operation, country } = {}, options) =>
    get('/api/periods/summary', { indicator, startYear, endYear, operation, country }, options),
  // Canonical Prices movement (8 metric-specific bases; backend-authoritative).
  pricesMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/prices',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  priceGroups: (options) => get('/api/prices/country-groups', {}, options),
  // Canonical Trade movement (4+4 metric-specific bases; backend-authoritative).
  tradeMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/trade',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  tradeGroups: (options) => get('/api/trade/country-groups', {}, options),
  // Canonical Capital Flow movement (3+3 ranked bases; backend-authoritative).
  capitalMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/capital',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  capitalGroups: (options) => get('/api/capital/country-groups', {}, options),
  // Canonical Exchange Rate movement (3 bases; backend-authoritative).
  fxMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/fx',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  fxGroups: (options) => get('/api/fx/country-groups', {}, options),
  // Canonical External Sector movement (3/3/4 bases; backend-authoritative).
  externalMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/external',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  externalGroups: (options) => get('/api/external/country-groups', {}, options),
  // Canonical Population movement (3 bases; backend-authoritative).
  populationMovement: ({ indicator, metric, basis, yearA, yearB, yearMid, country, groupType, group } = {}, options) =>
    get(
      '/api/movement/population',
      {
        indicator: indicator ?? metric,
        basis,
        yearA,
        yearB,
        ...(yearMid !== undefined && yearMid !== null && String(yearMid).toLowerCase() !== 'none' ? { yearMid } : {}),
        country,
        ...(groupType ? { groupType } : {}),
        ...(group ? { group } : {}),
      },
      options,
    ),
  populationGroups: (options) => get('/api/population/country-groups', {}, options),
  dataStatus: (options) => get('/api/data-status', {}, options),
  integrity: (options) => get('/api/integrity', {}, options),
  refresh: ({ startYear, endYear, indicators } = {}, options) =>
    request('/api/data/refresh', {
      ...options,
      method: 'POST',
      body: { ...(startYear !== undefined ? { startYear } : {}), ...(endYear !== undefined ? { endYear } : {}), ...(indicators ? { indicators } : {}) },
    }),
};

export { BASE_URL };
