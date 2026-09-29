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

export async function queryAll(handle, sql, args = []) {
  const result = await handle.execute({ sql, args });
  return result.rows;
}

export async function queryGet(handle, sql, args = []) {
  const result = await handle.execute({ sql, args });
  return result.rows.length > 0 ? result.rows[0] : null;
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
 */
export async function batchRun(handle, statements, { chunkSize = 500 } = {}) {
  const list = Array.isArray(statements) ? statements : [];
  let n = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize).map((s) => ({ sql: s.sql, args: s.args ?? [] }));
    if (chunk.length > 0) {
      await handle.batch(chunk);
      n += chunk.length;
    }
  }
  return n;
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
