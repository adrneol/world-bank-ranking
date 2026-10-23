/**
 * COMPARE-SPECIFIC RESULT CACHE (bounded, per database).
 *
 * A comparison is a pure function of:
 *
 *   - the dataset content version (observation values + country metadata),
 *   - the indicator/metric and its measurement basis (the metric key),
 *   - the operation,
 *   - the mode (observed vs like-for-like — NEVER shared),
 *   - the two entity specs (a custom group's spec IS its membership
 *     fingerprint: members are sorted when the spec is parsed),
 *   - the group labels (they are part of the rendered output),
 *   - Year A, Year B and Year C.
 *
 * All of them are in the key, so a change to any of them produces a
 * different key and therefore a different result. The dataset content
 * version advances inside the publish transaction whenever observation
 * values or country metadata change; the per-indicator year signature adds
 * a second signal for row-count and vintage-stamp changes.
 *
 * Safety rules:
 *   - the cache is owned PER DATABASE (a WeakMap keyed by the db handle), so
 *     two databases never share entries even when they hold identical rows;
 *   - only fully produced responses are cached. A BLOCKED result is never
 *     cached, so a comparison that could not be computed can never conceal
 *     observations that arrived later;
 *   - the cache is bounded (LRU) and holds no database handle of its own.
 */

import { getDatasetState, getObservationYearSignature } from '../db/repository.js';

/** Maximum number of cached comparison responses per database. */
export const COMPARE_CACHE_MAX_ENTRIES = 64;

const perDatabase = new WeakMap();

/**
 * The (bounded, LRU) cache of one database.
 * @returns {{get:Function, set:Function, size:Function, clear:Function}}
 */
function cacheFor(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return null;
  let entry = perDatabase.get(db);
  if (entry) return entry;
  const map = new Map();
  entry = {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      // LRU: re-insert so the most recently used entry is evicted last.
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > COMPARE_CACHE_MAX_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
  perDatabase.set(db, entry);
  return entry;
}

/**
 * Build the cache key of a comparison request.
 *
 * @param {object} input
 * @returns {string}
 */
export function compareCacheKey({
  contentVersion,
  signature,
  metricKey,
  basis,
  operation,
  mode,
  entityA,
  entityB,
  labelA,
  labelB,
  yearA,
  yearB,
  yearC,
} = {}) {
  return [
    'compare',
    `content:${contentVersion ?? 'none'}`,
    `sig:${signature?.rows ?? 0}:${signature?.minVintage ?? '-'}:${signature?.maxVintage ?? '-'}`,
    `metric:${metricKey ?? ''}`,
    `basis:${basis ?? ''}`,
    `op:${operation ?? ''}`,
    `mode:${mode ?? ''}`,
    `a:${entityA ?? ''}`,
    `b:${entityB ?? ''}`,
    `la:${labelA ?? ''}`,
    `lb:${labelB ?? ''}`,
    `y:${yearA ?? ''}:${yearB ?? ''}:${yearC ?? ''}`,
  ].join('|');
}

/**
 * Resolve the invalidation signals of one database: the dataset content
 * version and the per-indicator year signature.
 *
 * @param {object} db
 * @param {number} indicatorId
 * @param {number[]} years
 * @returns {Promise<{contentVersion: string, signature: object}>}
 */
export async function compareInvalidationSignals(db, indicatorId, years) {
  const state = await getDatasetState(db);
  const signature = await getObservationYearSignature(db, indicatorId, years);
  return {
    contentVersion: String(state?.contentVersion ?? 'none'),
    signature,
  };
}

/**
 * Read a cached comparison response for one database.
 * @returns {object|undefined}
 */
export function getCachedCompare(db, key) {
  return cacheFor(db)?.get(key);
}

/**
 * Store a comparison response for one database. Only fully produced
 * responses are stored by the caller.
 */
export function setCachedCompare(db, key, value) {
  cacheFor(db)?.set(key, value);
}

/** Test seam: drop every cached comparison of one database. */
export function resetCompareCache(db) {
  if (db) {
    cacheFor(db)?.clear();
    return;
  }
  // Without a database handle the WeakMap cannot be enumerated; the process
  // is the unit of isolation in that case.
  for (const value of perDatabase.values()) value.clear();
}

export default {
  COMPARE_CACHE_MAX_ENTRIES,
  compareCacheKey,
  compareInvalidationSignals,
  getCachedCompare,
  setCachedCompare,
  resetCompareCache,
};
