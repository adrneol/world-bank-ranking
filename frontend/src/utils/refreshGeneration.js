/**
 * Refresh-generation comparison (Phase 1, issue R-04).
 *
 * The backend publishes at most one dataset generation at a time: every
 * successful refresh advances `GET /api/data-status` → `fingerprint`
 * (`{ runId, lastSuccessAt, maxFetchedAt, observationCount }`), while
 * failed/partial attempts leave it untouched. Already-open data views poll
 * this fingerprint and revalidate only when it advances — no economics here,
 * just identity comparison of backend-provided values.
 */

/** Extract the fingerprint from a data-status payload (null-safe). */
export function fingerprintOf(status) {
  const fp = status?.fingerprint ?? null;
  if (!fp) {
    // Backwards compatibility with backends predating the fingerprint field:
    // fall back to the freshness fields that always existed.
    if (status?.lastSuccessAt === undefined) return null;
    return {
      runId: null,
      lastSuccessAt: status.lastSuccessAt ?? null,
      maxFetchedAt: null,
      observationCount: status.observations ?? null,
    };
  }
  return {
    runId: fp.runId ?? null,
    lastSuccessAt: fp.lastSuccessAt ?? null,
    maxFetchedAt: fp.maxFetchedAt ?? null,
    observationCount: fp.observationCount ?? null,
  };
}

/**
 * True when `next` describes a strictly newer published dataset than `prev`.
 * A null `prev` means "first observation" (adopt silently, never revalidate).
 * Null/unknown generations never compare as newer, so a degraded status
 * payload can never trigger a revalidation loop.
 */
export function isNewerGeneration(prev, next) {
  if (!prev || !next) return false;
  if (prev.runId !== null && prev.runId !== undefined && next.runId !== null && next.runId !== undefined) {
    return next.runId !== prev.runId && next.runId > prev.runId;
  }
  if (prev.lastSuccessAt && next.lastSuccessAt) {
    return next.lastSuccessAt !== prev.lastSuccessAt && next.lastSuccessAt > prev.lastSuccessAt;
  }
  return false;
}

export default { fingerprintOf, isNewerGeneration };
