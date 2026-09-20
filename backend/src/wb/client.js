/**
 * World Bank Indicators API client.
 *
 * Responsibilities:
 *   - build requests against the configured base URL
 *   - follow the API's own pagination metadata (page / pages / per_page / total)
 *   - retry transient failures with exponential backoff + jitter
 *   - honour Retry-After when the API supplies it
 *   - validate response STRUCTURE before the payload is trusted
 *   - time out hung requests
 *
 * The World Bank Indicators API requires NO API KEY.
 *
 * Response shapes handled:
 *   Success: [ { page, pages, per_page, total, lastupdated, ... }, [ ...rows ] ]
 *   Error:   [ { message: [ { id, key, value } ] } ]   <-- still HTTP 200!
 * The error shape is detected explicitly and thrown, never parsed as data.
 */

import config from '../config.js';

/** Error raised when the World Bank API returns its error envelope. */
export class WorldBankApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WorldBankApiError';
    this.details = details;
  }
}

/** Error raised when a payload is structurally invalid. */
export class WorldBankPayloadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WorldBankPayloadError';
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter, so parallel callers do not synchronise. */
export function backoffDelay(attempt, baseMs) {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, 30_000);
}

/** Build a fully-qualified URL, preserving the base path. */
export function buildUrl(pathname, params = {}) {
  const base = config.worldBank.baseUrl;
  const url = new URL(`${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Validate the outer World Bank envelope.
 *
 * @param {unknown} json
 * @returns {{ meta: object, rows: object[] }}
 */
export function parseEnvelope(json, context = '') {
  if (!Array.isArray(json)) {
    throw new WorldBankPayloadError(
      `Expected a JSON array from the World Bank API${context ? ` (${context})` : ''}, received ${typeof json}.`,
      { context, received: json },
    );
  }

  // Error envelope: [{ message: [...] }] - returned with HTTP 200.
  if (json.length === 1 && json[0] && typeof json[0] === 'object' && 'message' in json[0]) {
    const rawMessage = json[0].message;
    const text = Array.isArray(rawMessage)
      ? rawMessage.map((m) => m?.value ?? JSON.stringify(m)).join('; ')
      : String(rawMessage);
    throw new WorldBankApiError(
      `World Bank API error${context ? ` (${context})` : ''}: ${text}`,
      { context, message: rawMessage },
    );
  }

  if (json.length < 2 || !json[0] || !Array.isArray(json[1])) {
    throw new WorldBankPayloadError(
      `Malformed World Bank payload${context ? ` (${context})` : ''}: expected [meta, rows[]].`,
      { context, received: json },
    );
  }

  const meta = json[0];
  const rows = json[1];

  if (typeof meta !== 'object') {
    throw new WorldBankPayloadError(
      `Malformed World Bank meta block${context ? ` (${context})` : ''}.`,
      { context, meta },
    );
  }

  return { meta, rows };
}

/**
 * Perform one HTTP GET with timeout, mapping failures to typed errors.
 *
 * @returns {Promise<unknown>} parsed JSON
 */
async function fetchJson(url, { timeoutMs = config.worldBank.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // The API is open; no credential is sent.
        'User-Agent': 'worldbank-india-gdp-ranking/1.0 (data verification tool)',
      },
    });

    const body = await response.text();

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      error.body = body.slice(0, 500);
      throw error;
    }

    try {
      return JSON.parse(body);
    } catch (parseError) {
      throw new WorldBankPayloadError(`Response was not valid JSON: ${url}`, {
        cause: parseError.message,
        body: body.slice(0, 500),
      });
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      timeoutError.timeout = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET with retries.
 *
 * @param {string} url
 * @param {{ maxRetries?: number, baseMs?: number, onRetry?: Function, context?: string }} options
 */
export async function getWithRetry(url, options = {}) {
  const maxRetries = options.maxRetries ?? config.worldBank.maxRetries;
  const baseMs = options.baseMs ?? config.worldBank.retryBaseMs;
  const context = options.context ?? url;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;

      // Payload errors will not fix themselves: fail fast.
      if (error instanceof WorldBankPayloadError) throw error;

      // An API error envelope is an application-level error; retrying is
      // pointless unless it is clearly a rate-limit style rejection.
      if (error instanceof WorldBankApiError) throw error;

      const retryable =
        error.timeout === true ||
        error.status === 429 ||
        (typeof error.status === 'number' && error.status >= 500) ||
        error.status === undefined; // network-level failure

      if (!retryable || attempt === maxRetries) break;

      // Honour Retry-After when present, otherwise back off exponentially.
      const retryAfterHeader = error.retryAfter;
      let waitMs = backoffDelay(attempt, baseMs);
      if (retryAfterHeader) {
        const seconds = Number(retryAfterHeader);
        if (Number.isFinite(seconds) && seconds >= 0) {
          waitMs = Math.max(waitMs, seconds * 1000);
        }
      }

      if (typeof options.onRetry === 'function') {
        options.onRetry({ attempt: attempt + 1, maxRetries, waitMs, error, url });
      }

      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Fetch one page of a World Bank collection endpoint.
 *
 * @returns {{ meta: object, rows: object[] }}
 */
export async function fetchPage(pathname, params = {}, options = {}) {
  const url = buildUrl(pathname, params);
  const json = await getWithRetry(url, { ...options, context: pathname });
  const { meta, rows } = parseEnvelope(json, pathname);
  return { meta, rows, url };
}

/**
 * Fetch EVERY page of a World Bank collection endpoint.
 *
 * Pagination is driven strictly by the response metadata:
 *   - `pages`   total number of pages
 *   - `per_page` page size the server actually used
 *   - `total`   total record count, used as a completeness check
 *
 * The first response decides the total page count; subsequent pages are
 * requested until all are collected. Page 1 is never assumed to be complete.
 *
 * @returns {{ rows: object[], meta: object, pagesFetched: number, requests: number }}
 */
export async function fetchAllPages(pathname, params = {}, options = {}) {
  const perPage = options.perPage ?? config.worldBank.perPage;
  const onProgress = options.onProgress;

  const first = await fetchPage(pathname, { ...params, page: 1, per_page: perPage }, options);

  const totalPages = Number(first.meta?.pages ?? 1);
  const declaredTotal = Number(first.meta?.total ?? first.rows.length);

  if (!Number.isFinite(totalPages) || totalPages < 1) {
    throw new WorldBankPayloadError(
      `World Bank meta.pages was not a positive number for ${pathname}.`,
      { meta: first.meta },
    );
  }

  const rows = [...first.rows];
  let requests = 1;

  if (onProgress) {
    onProgress({ page: 1, totalPages, rows: rows.length, declaredTotal });
  }

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(
      pathname,
      { ...params, page, per_page: perPage },
      options,
    );
    rows.push(...next.rows);
    requests += 1;
    if (onProgress) {
      onProgress({ page, totalPages, rows: rows.length, declaredTotal });
    }
  }

  return {
    rows,
    meta: first.meta,
    lastUpdated: first.meta?.lastupdated ?? null,
    pagesFetched: totalPages,
    requests,
    declaredTotal,
  };
}

/**
 * Fetch World Bank country metadata (all entities, aggregates included).
 * Aggregates are removed later by domain/universe.js, not here.
 */
export async function fetchCountryMetadata(options = {}) {
  return fetchAllPages('/country', {}, options);
}

/**
 * Fetch a full indicator series for a year range.
 *
 * `country/all` is used deliberately: this application must see every entity
 * the World Bank publishes, then filter aggregates itself so the exclusion is
 * explicit and auditable.
 *
 * @param {string} indicatorCode e.g. NY.GDP.PCAP.CD
 * @param {number} startYear inclusive
 * @param {number} endYear inclusive
 */
export async function fetchIndicatorSeries(indicatorCode, startYear, endYear, options = {}) {
  return fetchAllPages(
    `/country/all/indicator/${encodeURIComponent(indicatorCode)}`,
    { date: `${startYear}:${endYear}` },
    options,
  );
}

/**
 * Fetch indicator metadata (name/unit/source) for one indicator code.
 *
 * @returns {object|null} the indicator record, or null when not found
 */
export async function fetchIndicatorMetadata(indicatorCode, options = {}) {
  const { rows } = await fetchPage(
    `/indicator/${encodeURIComponent(indicatorCode)}`,
    { per_page: 5 },
    options,
  );
  return rows.length ? rows[0] : null;
}

export default {
  fetchAllPages,
  fetchPage,
  fetchCountryMetadata,
  fetchIndicatorSeries,
  fetchIndicatorMetadata,
  getWithRetry,
  buildUrl,
  parseEnvelope,
};