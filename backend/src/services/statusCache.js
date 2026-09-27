/**
 * STATUS-ROUTE INTEGRITY MEMO (Phase 1, issue R-12).
 *
 * GET /api/data-status is polled every few seconds while a refresh runs, and
 * runIntegrityChecks() performs full-table scans on every call. The published
 * dataset — the only thing integrity inspects — changes exclusively inside
 * the atomic publish transaction of a successful refresh, which always
 * advances the refresh generation (latest success run id / lastSuccessAt).
 * Failed/partial attempts write audit rows only and cannot change integrity
 * outcomes, so memoizing the report by generation is safe: a new generation
 * always recomputes, anything else reuses the verified result.
 *
 * /api/integrity stays uncached (explicit on-demand validation).
 * Integrity semantics are untouched: this memoizes, never skips, validation.
 */

let cached = { key: null, value: null };

/**
 * Refresh-generation key for the memo. Both parts advance only when a new
 * successful refresh is published.
 */
export function integrityCacheKey(fingerprint) {
  const runId = fingerprint?.runId ?? 'none';
  const lastSuccessAt = fingerprint?.lastSuccessAt ?? 'none';
  const observationCount = fingerprint?.observationCount ?? 'none';
  return `success:${String(runId)}:${String(lastSuccessAt)}:obs:${String(observationCount)}`;
}

/**
 * Return the cached report for `key`, computing (and caching) it on a miss.
 * `compute` performs the real integrity scan and must return the already
 * shaped `{ passed, checks }` / `{ passed: false, error }` payload.
 */
export function getCachedIntegrity(key, compute) {
  if (cached.key === key && cached.value !== null) {
    return { report: cached.value, fromCache: true };
  }
  const report = compute();
  cached = { key, value: report };
  return { report, fromCache: false };
}

/** Test seam: clear the memo (also used if the process ever needs it). */
export function resetIntegrityCache() {
  cached = { key: null, value: null };
}

export default { integrityCacheKey, getCachedIntegrity, resetIntegrityCache };
