/** Compare committed content identities; use operational fingerprints only for legacy servers. */

/** Extract the fingerprint from a data-status payload (null-safe). */
export function fingerprintOf(status) {
  const identity={...(status?.database?.provider?{provider:status.database.provider}:{}),...(status?.generation?.contentVersion!=null?{contentVersion:status.generation.contentVersion}:{})};
  const fp = status?.fingerprint ?? null;
  if (!fp) {
    // Backwards compatibility with backends predating the fingerprint field:
    // fall back to the freshness fields that always existed.
    if (status?.lastSuccessAt === undefined && identity.contentVersion==null) return null;
    return {
      ...identity,
      runId: null,
      lastSuccessAt: status.lastSuccessAt ?? null,
      maxFetchedAt: null,
      observationCount: status.observations ?? null,
    };
  }
  return {
    ...identity,
    runId: fp.runId ?? null,
    lastSuccessAt: fp.lastSuccessAt ?? null,
    maxFetchedAt: fp.maxFetchedAt ?? null,
    observationCount: fp.observationCount ?? null,
  };
}

/**
 * True when the serving identity requires data revalidation. Committed versions
 * take precedence over successful-check run IDs; provider/version changes are
 * identities, not proof of globally ordered counters.
 * A null `prev` means "first observation" (adopt silently, never revalidate).
 * Null/unknown generations never compare as newer, so a degraded status
 * payload can never trigger a revalidation loop.
 */
export function isNewerGeneration(prev, next) {
  if (!prev || !next) return false;
  if(prev.provider && next.provider && prev.provider!==next.provider)return true;
  if(prev.contentVersion==null && next.contentVersion!=null)return true;
  if(prev.contentVersion!=null && next.contentVersion!=null)return prev.contentVersion!==next.contentVersion;
  if (prev.runId !== null && prev.runId !== undefined && next.runId !== null && next.runId !== undefined) {
    return next.runId !== prev.runId && next.runId > prev.runId;
  }
  if (prev.lastSuccessAt && next.lastSuccessAt) {
    return next.lastSuccessAt !== prev.lastSuccessAt && next.lastSuccessAt > prev.lastSuccessAt;
  }
  return false;
}

export default { fingerprintOf, isNewerGeneration };
