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
import { isWdiVintage } from './vintage.js';

const WDI_SOURCE = '2';
export const WDI_SOURCE_NAME = 'World Development Indicators';

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

/** Retry-After supports both delay seconds and an HTTP date. */
export function retryAfterDelayMs(value, now = Date.now()) {
 const text=String(value??'').trim();if(!text)return 0;
 if(/^\d+(?:\.\d+)?$/.test(text))return Number(text)*1000;
 const time=Date.parse(text);return Number.isFinite(time)?Math.max(0,time-now):0;
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
      { context },
    );
  }

  // Error envelope: [{ message: [...] }] - returned with HTTP 200.
  if (json.length === 1 && json[0] && typeof json[0] === 'object' && 'message' in json[0]) {
    const rawMessage = json[0].message;
    const id = Array.isArray(rawMessage) && /^\d+$/.test(String(rawMessage[0]?.id)) ? rawMessage[0].id : null;
    throw new WorldBankApiError(
      `World Bank API error${context ? ` (${context})` : ''}: ${id === null ? 'request rejected' : `error ${id}`}`,
      { context, id },
    );
  }

  if (json.length < 2 || !json[0] || (!Array.isArray(json[1]) && !(json[1] === null && pageInteger(json[0].total) === 0))) {
    throw new WorldBankPayloadError(
      `Malformed World Bank payload${context ? ` (${context})` : ''}: expected [meta, rows[]].`,
      { context },
    );
  }

  const meta = json[0];
  const rows = json[1] ?? [];

  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new WorldBankPayloadError(
      `Malformed World Bank meta block${context ? ` (${context})` : ''}.`,
      { context },
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
      const error = new Error(`HTTP ${response.status} from World Bank`);
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new WorldBankPayloadError('World Bank response was not valid JSON.');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms while reading World Bank`);
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
 * @param {{ maxRetries?: number, baseMs?: number, timeoutMs?: number, onRetry?: Function, context?: string }} options
 */
export async function getWithRetry(url, options = {}) {
  const maxRetries = options.maxRetries ?? config.worldBank.maxRetries;
  const baseMs = options.baseMs ?? config.worldBank.retryBaseMs;
  const timeoutMs = options.timeoutMs ?? config.worldBank.timeoutMs;
  const context = options.context ?? url;
  void context;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJson(url, { timeoutMs });
    } catch (error) {
      lastError = error;

      // Payload errors will not fix themselves: fail fast.
      if (error instanceof WorldBankPayloadError) throw error;

      // An API error envelope is an application-level error; retrying is
      // pointless unless it is clearly a rate-limit style rejection.
      if (error instanceof WorldBankApiError) throw error;

      const retryable =
        error.timeout === true ||
        error.status === 408 ||
        error.status === 429 ||
        (typeof error.status === 'number' && error.status >= 500) ||
        error.status === undefined; // network-level failure

      if (!retryable || attempt === maxRetries) break;

      // Honour Retry-After when present, otherwise back off exponentially.
      const retryAfterHeader = error.retryAfter;
      let waitMs = backoffDelay(attempt, baseMs);
      if (retryAfterHeader) {
        waitMs = Math.max(waitMs, retryAfterDelayMs(retryAfterHeader));
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
 * Compare the reconstructed row count with the total the World Bank declared.
 *
 * API semantics used here (verified against the live API):
 *   `meta.total` counts every row the API will return for the request,
 *   independent of `per_page`. A correct reconstruction across all `meta.pages`
 *   pages therefore has to reconstruct exactly `meta.total` rows.
 * If `meta.total` is absent the check cannot be asserted: the status is reported
 * as `unknown` (and surfaced to the caller) rather than being called complete.
 *
 * @param {{declaredTotal?: number|string|null, receivedRows?: number, declaredPages?: number,
 *          pagesFetched?: number, url?: string}} input
 * @returns {{complete: boolean, status: 'complete'|'mismatch'|'unknown', declaredTotal: number|null,
 *            receivedRows: number, missingRows: number|null, message: string|null}}
 */
export function checkPaginationCompleteness(input = {}) {
  const { declaredTotal, receivedRows, declaredPages = null, pagesFetched = null, url = '' } = input;

  const total =
    declaredTotal === undefined || declaredTotal === null ? null : Number(declaredTotal);
  const received = Number(receivedRows ?? 0);

  if (total === null || !Number.isFinite(total)) {
    return {
      complete: true,
      status: 'unknown',
      declaredTotal: null,
      receivedRows: received,
      missingRows: null,
      message:
        'The World Bank response did not declare meta.total, so pagination completeness could not be asserted.',
      declaredPages,
      pagesFetched,
      url,
    };
  }

  const difference = total - received;
  const complete = received === total;

  return {
    complete,
    status: complete ? 'complete' : 'mismatch',
    declaredTotal: total,
    receivedRows: received,
    missingRows: complete ? 0 : difference,
    message: complete
      ? null
      : `World Bank pagination completeness check failed: meta.total declared ${total} row(s) but ${received} were reconstructed ` +
        `(${difference > 0 ? `${difference} missing` : `${Math.abs(difference)} extra`}) ` +
        `over ${pagesFetched ?? '?'} page(s) of ${declaredPages ?? '?'} declared.`,
    declaredPages,
    pagesFetched,
    url,
  };
}

function pageInteger(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function checkWdiSource(source, context) {
  if (source != null && source !== WDI_SOURCE && source !== Number(WDI_SOURCE)) {
    throw new WorldBankPayloadError(`Unexpected World Bank source in ${context}. Expected WDI source 2.`);
  }
}

function validatePage({ meta, rows }, page, source) {
  const pages = pageInteger(meta.pages);
  const total = pageInteger(meta.total);
  const perPage = pageInteger(meta.per_page);
  const vintage = meta.lastupdated === '' ? null : meta.lastupdated ?? null;
  if (source === WDI_SOURCE) checkWdiSource(meta.sourceid, `page ${page}`);
  if (vintage !== null && !isWdiVintage(vintage)) {
    throw new WorldBankPayloadError(`Invalid World Bank vintage on page ${page}.`);
  }
  const expectedPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
  const expectedRows = perPage === null ? null : Math.min(perPage, total - (page - 1) * perPage);
  if (
    pageInteger(meta.page) !== page || pages === null || total === null ||
    (total === 0 ? page !== 1 || pages > 1 || rows.length !== 0
      : pages < page || rows.length === 0 || rows.length > total ||
        (perPage !== null && (pages !== expectedPages || rows.length !== expectedRows)))
    || (meta.per_page != null && perPage === null)
  ) {
    throw new WorldBankPayloadError(`World Bank pagination completeness check failed on page ${page}.`);
  }
  // An empty response can legitimately declare zero pages, but the first
  // envelope was fetched and still counts as a request.
  return { pages: Math.max(pages, 1), total, perPage, vintage };
}

/**
 * Fetch EVERY page of a World Bank collection endpoint.
 *
 * Pagination is driven strictly by the response metadata:
 *   - `pages`   total number of pages
 *   - `per_page` page size the server actually used
 *   - `total`   total record count, used as a completeness assertion
 *
 * The first response decides the total page count; subsequent pages are
 * requested until all are collected. Page 1 is never assumed to be complete.
 *
 * The reconstruction is then checked against `meta.total`. A mismatch is a hard
 * failure (WorldBankPayloadError) instead of silently returning a partial
 * series, because a short series would produce a wrong ranking denominator.
 *
 * @returns {{ rows: object[], meta: object, pagesFetched: number, requests: number,
 *             declaredTotal: number|null, completeness: object }}
 */
export async function fetchAllPages(pathname, params = {}, options = {}) {
  const perPage = options.perPage ?? config.worldBank.perPage;
  const onProgress = options.onProgress;

  const first = await fetchPage(pathname, { ...params, page: 1, per_page: perPage }, options);

  const initial = validatePage(first, 1, params.source);
  const { pages: totalPages, total: declaredTotal } = initial;
  const rows = [...first.rows];
  const lastUpdated = initial.vintage;
  if (options.indicatorCode) validateSeriesPage(first.rows, options.indicatorCode, 1);

  onProgress?.({ page: 1, totalPages, rows: rows.length, declaredTotal });

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(pathname, { ...params, page, per_page: perPage }, options);
    const header = validatePage(next, page, params.source);
    if (header.pages !== totalPages || header.total !== declaredTotal
        || (header.perPage !== null && initial.perPage !== null && header.perPage !== initial.perPage)) {
      throw new WorldBankPayloadError(`Inconsistent World Bank pagination on page ${page}.`);
    }
    if (header.vintage !== lastUpdated) {
      throw new WorldBankPayloadError(`Inconsistent World Bank vintage on page ${page}.`);
    }
    if (options.indicatorCode) validateSeriesPage(next.rows, options.indicatorCode, page);
    rows.push(...next.rows);
    onProgress?.({ page, totalPages, rows: rows.length, declaredTotal });
  }

  const completeness = checkPaginationCompleteness({
    declaredTotal,
    receivedRows: rows.length,
    declaredPages: totalPages,
    pagesFetched: totalPages,
    url: first.url,
  });

  if (!completeness.complete) {
    throw new WorldBankPayloadError(completeness.message, {
      pathname,
      declaredTotal,
      receivedRows: rows.length,
    });
  }

  return {
    rows,
    meta: first.meta,
    lastUpdated,
    pagesFetched: totalPages,
    requests: totalPages,
    declaredTotal,
    completeness,
  };
}

/**
 * Fetch World Bank country metadata (all entities, aggregates included).
 * Aggregates are removed later by domain/universe.js, not here.
 */
export async function fetchCountryMetadata(options = {}) {
  return fetchAllPages('/country', {}, options);
}

function validateSeriesPage(rows, indicatorCode, page) {
  for (const [index, row] of rows.entries()) {
    if (row?.indicator?.id !== indicatorCode) {
      throw new WorldBankPayloadError(`Invalid World Bank indicator identity for ${indicatorCode} on page ${page}, row ${index + 1}.`);
    }
    checkWdiSource(row.sourceid ?? row.source?.id, `page ${page}, row ${index + 1}`);
  }
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
    { date: `${startYear}:${endYear}`, source: WDI_SOURCE },
    { ...options, indicatorCode },
  );
}

/**
 * Fetch indicator metadata (name/unit/source) for one indicator code.
 *
 * @returns {object|null} the indicator record, or null when not found
 */
export async function fetchIndicatorMetadata(indicatorCode, options = {}) {
  // The source-scoped metadata endpoint is documented separately from
  // the observation endpoint's source query parameter.
  const { rows } = await fetchAllPages(
    `/source/${WDI_SOURCE}/indicator/${encodeURIComponent(indicatorCode)}`,
    { source: WDI_SOURCE },
    { ...options, perPage: options.perPage ?? 5 },
  );
  if (rows.length === 0) return null;
  const [row] = rows;
  if (rows.length !== 1 || row?.id !== indicatorCode || typeof row.name !== 'string' || !row.name.trim()
      || (row.unit != null && typeof row.unit !== 'string')
      || (row.sourceNote != null && typeof row.sourceNote !== 'string')
      || (row.source != null && (typeof row.source !== 'object' || Array.isArray(row.source)))
      || (row.source?.value != null && typeof row.source.value !== 'string')) {
    throw new WorldBankPayloadError(`Invalid World Bank indicator metadata for ${indicatorCode}.`);
  }
  checkWdiSource(row.source?.id, `indicator metadata for ${indicatorCode}`);
  if (row.source?.value?.trim() && row.source.value.trim() !== WDI_SOURCE_NAME) {
    throw new WorldBankPayloadError(`Unexpected source name in World Bank indicator metadata for ${indicatorCode}.`);
  }
  return row;
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