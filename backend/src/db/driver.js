/**
 * DATABASE DRIVER HELPERS (Phase 6A).
 *
 * Single query surface over @libsql/client handles, used for BOTH the Turso
 * Cloud primary and the local SQLite-file fallback (both speak the same
 * libSQL/SQLite dialect through this client). Repository and service code
 * must use these helpers instead of driver calls so neither backend knows
 * which physical database answers.
 *
 * Row shape: @libsql/client returns SELECT rows as objects keyed by column
 * (alias) names — identical to the previous node:sqlite shape — so SQL text
 * and result handling elsewhere are unchanged. Only sync→async changes.
 */

/**
 * TRANSPORT-ERROR CLASSIFIER (Phase 8D).
 *
 * Narrow by design: only errors that prove themselves to be
 * infrastructure-class (Turso/Hrana HTTP-layer failures, network failures)
 * qualify for bounded retries. Everything else — validation, auth, SQL and
 * constraint errors, World Bank semantic errors and timeouts (the WB client
 * has its own retry policy), application bugs — fails fast exactly as
 * before. In particular a 404 here means ONLY the Hrana transport shape
 * observed in production (`SERVER_ERROR: Server returned HTTP status ...`),
 * never an application-level 404 (those carry httpStatus and are excluded).
 * Conversely an Hrana 400/401/403 inside the same envelope is auth-shaped
 * (verified live: a wrong token yields HTTP status 400) and is excluded.
 */
const NEVER_TRANSPORT_CODES = new Set([
  'INVALID_INDICATOR',
  'INVALID_RANGE',
  'INVALID_YEAR',
  'INVALID_COUNTRY',
  'INVALID_SUBJECT',
  'INVALID_PAGINATION',
  'INVALID_ENTITY',
  'INVALID_BASIS',
  'MISSING_YEAR',
  'REFRESH_IN_PROGRESS',
  'REFRESH_PARTIAL_ROLLBACK',
  'REFRESH_UNAUTHORIZED',
  'REFRESH_RATE_LIMITED',
  'NOT_FOUND',
  'REQUEST_ERROR',
  'INTERNAL_ERROR',
  'BAD_RESPONSE',
]);

const TRANSPORT_MESSAGE_PATTERN =
  /SERVER_ERROR|HTTP status (5\d\d|429)|timeout|timed out|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|terminated|socket hang up|network|fetch failed|stream/i;

export function isTransportError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.httpStatus) return false;
  if (typeof error.code === 'string' && NEVER_TRANSPORT_CODES.has(error.code)) return false;
  if (error.name === 'WorldBankApiError' || error.name === 'WorldBankPayloadError') return false;
  if (error.timeout === true) return false;
  if (error.status !== undefined && error.status !== null) return false;
  if (error.name === 'LibsqlError') {
    if (error.code === 'SERVER_ERROR') {
      // Phase 8M: Hrana wraps auth/client failures (HTTP 400/401/403, e.g. a
      // wrong or revoked token — verified live against @libsql/client) in the
      // same SERVER_ERROR envelope as genuine transport death (HTTP 404/5xx,
      // the observed DNS-death shape). Auth-shaped failures must fail fast:
      // they never retry and never trigger database failover.
      if (/HTTP status 40[013]\b/.test(error.message ?? '')) return false;
      return true;
    }
    return TRANSPORT_MESSAGE_PATTERN.test(error.message ?? '');
  }
  return error.name === 'TypeError' || TRANSPORT_MESSAGE_PATTERN.test(error.message ?? '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before a read retry (tests override with WB_READ_RETRY_DELAY_MS). */
export function readRetryDelayMs() {
  const raw = process.env.WB_READ_RETRY_DELAY_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1000;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

/**
 * Run one idempotent read with a single bounded retry on transport-class
 * failures. The retry re-issues the identical statement; any second failure
 * (whatever its class) propagates. Non-transport errors never retry.
 */
async function withReadRetry(fn) {
  try {
    return await fn();
  } catch (error) {
    if (!isTransportError(error)) throw error;
    await sleep(readRetryDelayMs());
    return await fn();
  }
}

export async function queryAll(handle, sql, args = []) {
  return withReadRetry(async () => (await handle.execute({ sql, args })).rows);
}

export async function queryGet(handle, sql, args = []) {
  return withReadRetry(async () => {
    const result = await handle.execute({ sql, args });
    return result.rows.length > 0 ? result.rows[0] : null;
  });
}

export async function queryRun(handle, sql, args = []) {
  const result = await handle.execute({ sql, args });
  return {
    changes: Number(result.rowsAffected ?? 0),
    lastInsertRowid: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid),
  };
}

export async function queryExec(handle, sql) {
  await handle.executeMultiple(sql);
}

/**
 * Batched writes for bulk paths (ingest publication).
 *
 * One network round-trip per chunk instead of one per row: against a remote
 * database, per-row executes turn a 230k-row publish into hundreds of
 * thousands of round-trips (hours); chunked batches complete in minutes.
 * Statements run SEQUENTIALLY in array order on any handle — including an
 * explicit transaction object, so atomic-publish semantics are unchanged.
 * SQL text is untouched; only the transport batching differs.
 *
 * Phase 6C O1: with the `{ sql, build }` form, callers pass source ROWS and
 * a per-row args builder, so statement objects exist only for the chunk in
 * flight — never a 230k-entry statement array. The legacy `{sql, args}`
 * entry form remains supported (used by tests).
 */
export async function batchRun(handle, rows, { chunkSize = 500, sql = null, build = null } = {}) {
  const total = Array.isArray(rows) ? rows.length : 0;
  let n = 0;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = [];
    const end = Math.min(i + chunkSize, total);
    for (let j = i; j < end; j += 1) {
      const entry = rows[j];
      if (build) {
        const args = build(entry, j);
        // A null build result skips the row (e.g. year-less stat rows):
        // independent upserts, order of the rest preserved.
        if (args === null || args === undefined) continue;
        chunk.push({ sql, args });
      } else {
        chunk.push({ sql: entry.sql, args: entry.args ?? [] });
      }
    }
    if (chunk.length > 0) {
      await handle.batch(chunk);
      n += chunk.length;
    }
  }
  return n;
}

/**
 * Batched reads for independent SELECTs (Phase 7D-4).
 *
 * One network round trip for the whole list instead of one per statement:
 * against a remote database, a dozen tiny metadata reads cost a dozen
 * latencies. Statements MUST be independent (no statement may depend on
 * another's rows) and read-only in intent; results return in input order
 * with the identical row shape as queryAll/queryGet (rows as objects keyed
 * by column/alias names — verified same on local SQLite and Turso).
 *
 * @param {object} handle libSQL client or transaction
 * @param {{sql:string, args?:unknown[]}[]} statements
 * @returns {Promise<object[][]>} rows per statement, in order
 */
export async function batchGet(handle, statements) {
  const list = statements.map(({ sql, args = [] }) => ({ sql, args }));
  // Handles without batch support (exotic test doubles) degrade to the
  // equivalent sequential reads — same statements, same order, same shapes.
  if (typeof handle.batch !== 'function') {
    const out = [];
    for (const { sql, args } of list) {
      const result = await handle.execute({ sql, args });
      out.push(result.rows);
    }
    return out;
  }
  const results = await handle.batch(list);
  return results.map((result) => result.rows);
}

/**
 * Run `fn` inside a transaction on any handle (database or explicit
 * transaction-capable object is NOT re-wrapped: callers inside a publish
 * transaction must use the Inner repository variants, as before).
 */
export async function transaction(handle, fn) {
  const tx = await handle.transaction();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // Ignore rollback failures; the original error is what matters.
    }
    throw error;
  }
}
