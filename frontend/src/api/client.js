/**
 * Centralized backend API client.
 *
 * The ONLY place that knows endpoint URLs. It handles the base URL
 * (VITE_API_BASE_URL, same-origin fallback), JSON parsing, HTTP errors and
 * abort signals. It never calculates ranks, YoY values, denominators or
 * coverage — it only transports backend-calculated results.
 */

// Precedence: explicit VITE_API_BASE_URL (local override or production)
// wins; empty/absent falls back to relative /api (Vite dev proxy locally,
// same-origin API in deployments that serve both from one host). Trailing
// slashes and surrounding whitespace are stripped so neither
// "<base>//api/years" nor "<base>api/years" can be constructed.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

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
  return `${BASE_URL}${path}${suffix ? `?${suffix}` : ''}`;
}

async function request(path, { params = {}, signal = null, method = 'GET', body = null } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, method === 'GET' ? params : {}), {
      method,
      signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the backend. Is the API server running?', { code: 'NETWORK_ERROR' });
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
  indiaRanking: ({ startYear, endYear, country } = {}, options) =>
    get('/api/india/gdp-ranking', { startYear, endYear, country }, options),
  ranking: ({ indicator, year, page, pageSize, search, country } = {}, options) =>
    get('/api/ranking', { indicator, year, page, pageSize, search, country }, options),
  rankVerify: ({ indicator, year, country, neighbors } = {}, options) =>
    get('/api/ranking/verify', { indicator, year, country, neighbors }, options),
  yoyRanking: ({ indicator, year, page, pageSize, search, country } = {}, options) =>
    get('/api/yoy-ranking', { indicator, year, page, pageSize, search, country }, options),
  yoyVerify: ({ indicator, year, country, neighbors } = {}, options) =>
    get('/api/yoy-ranking/verify', { indicator, year, country, neighbors }, options),
  coverage: ({ year, country, fromYear, toYear, indicator } = {}, options) =>
    get('/api/coverage', { year, country, fromYear, toYear, indicator }, options),
  observations: ({ indicator, year, country } = {}, options) =>
    get('/api/observations', { indicator, year, country }, options),
  countries: ({ includeAggregates } = {}, options) =>
    get('/api/countries', { includeAggregates }, options),
  metadata: (options) => get('/api/metadata', {}, options),
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
