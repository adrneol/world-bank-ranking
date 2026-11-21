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

const defaultScope = {};
let caches = new WeakMap();

function memoFor(scope) {
  let memo = caches.get(scope);
  if (!memo) {
    memo = { legacy: {}, cheap: {}, expensive: {} };
    caches.set(scope, memo);
  }
  return memo;
}

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
 * shaped `{ passed, checks }` / `{ passed: false, error }` payload. It may
 * be async.
 */
export async function getCachedIntegrity(key, compute, scope = defaultScope) {
  return getCachedSlot(memoFor(scope).legacy, key, compute);
}

/** Test seam: clear the memo. */
export function resetIntegrityCache() {
  caches = new WeakMap();
}

/**
 * Phase 7B split memo.
 *
 * The integrity report has two independent freshness dimensions, so one slot
 * cannot memoize it without either rescanning or going stale:
 * - cheap battery (null guard, aggregate typing, run/metadata/registry
 *   checks): inputs change only inside a successful publish, so the latest
 *   success run id is the exact key. Recomputes ~once per success run.
 * - expensive battery (orphan/duplicate/year/value full scans): inputs are
 *   the observations table alone, so content_version is the exact key.
 *   Unchanged refreshes (new run, same content) reuse the verified report.
 */
 /** Exact key for the cheap battery: the latest successful publish. */
export function cheapIntegrityKey(runId) {
  return `cheap:success:${String(runId ?? 'none')}`;
}

/**
 * Exact key for the expensive battery: the observation-content generation AND
 * the derived dataset vintage the report was produced against.
 *
 * The vintage is part of the key because the battery now contains the
 * L.vintage_provenance check, whose inputs are the observations (content) AND
 * the derived dataset_state row. The derived row can change WITHOUT the
 * observations changing (a correction, or an out-of-band edit), so a key built
 * from the content generation alone would serve a memoized report that no
 * longer describes the current state — exactly the class of bug the
 * L.vintage_provenance check exists to detect.
 */
export function expensiveIntegrityKey(contentVersion, vintage) {
  return `expensive:content:${String(contentVersion ?? 'none')}:vintage:${String(vintage ?? 'none')}`;
}

/**
 * Whether a PERSISTED expensive report may be reused for the current derived
 * vintage.
 *
 * The report is only valid for the derived vintage it was produced against:
 * its L.vintage_provenance detail records that vintage. A corrected (or
 * corrupted) dataset_state row must be re-verified, never served from the
 * memo.
 */
export function storedReportMatchesCurrentVintage(checks, currentVintage) {
  if (!Array.isArray(checks)) return false;
  const check = checks.find((c) => c?.check === 'L.vintage_provenance');
  if (!check || !check.detail || typeof check.detail !== 'object') return false;
  return (check.detail.cachedVintage ?? null) === (currentVintage ?? null);
}

async function getCachedSlot(slot, key, compute) {
  if (slot.key === key && slot.value !== undefined) {
    return { report: slot.value, fromCache: true };
  }
  if (slot.pendingKey === key && slot.pending) return { report: await slot.pending, fromCache: true };
  const pending = Promise.resolve().then(compute);
  slot.pendingKey = key;
  slot.pending = pending;
  try {
    const report = await pending;
    // An older generation finishing late must not replace a newer slot.
    if (slot.pending === pending) { slot.key = key; slot.value = report; }
    return { report, fromCache: false };
  } finally {
    if (slot.pending === pending) { slot.pending = null; slot.pendingKey = null; }
  }
}

export async function getCachedCheapIntegrity(key, compute, scope = defaultScope) {
  return getCachedSlot(memoFor(scope).cheap, key, compute);
}

export async function getCachedExpensiveIntegrity(key, compute, scope = defaultScope) {
  return getCachedSlot(memoFor(scope).expensive, key, compute);
}

export default { integrityCacheKey, getCachedIntegrity, resetIntegrityCache };
