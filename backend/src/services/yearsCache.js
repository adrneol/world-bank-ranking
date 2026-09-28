/**
 * AVAILABLE-YEARS CACHE (Phase 4, Part A).
 *
 * listAvailableYears() scans the observations table, so it is memoized per
 * database handle and keyed by the published dataset generation — the latest
 * successful fetch-run id plus the observation count. Both advance if and
 * only if a refresh successfully publishes (staged, single-transaction
 * publish in wb/ingest.js); failed or partial refreshes write no success
 * row and touch no observations, so the key — and the cached result — stay
 * valid. No TTL, no second versioning system: the existing refresh
 * generation is the invalidation signal, and a new process starts empty.
 *
 * Entries live in a WeakMap keyed by database handle: distinct handles
 * (tests, CLI scripts) can never share a result, while the server's single
 * shared handle keeps serving its generation.
 *
 * Concurrency: Node serves requests on one thread and SQLite publishes
 * atomically, so a cached result can never mix generations; at most one
 * recompute happens per published generation.
 */

import { getDb } from '../db/index.js';
import { countObservations, getLatestFetchRun, listAvailableYears } from '../db/repository.js';

let entries = new WeakMap();

/** Test seam: drop all memoized results. */
export function resetYearsCache() {
  entries = new WeakMap();
}

/** Generation identity: cheap, indexed reads only (no table scans). */
export function yearsCacheKey(db) {
  const handle = db ?? getDb();
  const run = getLatestFetchRun(handle, { status: 'success' });
  return `${run?.id ?? 'none'}:${countObservations(handle)}`;
}

export function getCachedAvailableYears(db = null) {
  const handle = db ?? getDb();
  const key = yearsCacheKey(handle);
  const entry = entries.get(handle);
  if (entry && entry.key === key) return entry.result;
  const result = listAvailableYears(handle);
  entries.set(handle, { key, result });
  return result;
}
