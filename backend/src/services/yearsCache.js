/**
 * AVAILABLE-YEARS CACHE (Phase 4, Part A; Phase 7B metadata key).
 *
 * listAvailableYears() scans the observations table, so it is memoized per
 * database handle and keyed by the data-content generation. Failed, partial
 * and unchanged refreshes never change observation content, so the key — and
 * the cached result — stay valid across them; only a content-changing publish
 * (content_version advance) invalidates. No TTL, no second versioning
 * system: content_version is the invalidation signal, and a new process
 * starts empty.
 *
 * Phase 7B: when dataset_state is derived, the years payload itself comes
 * from the stored years_json (built by the same grouping as
 * listAvailableYears, so byte-identical); the legacy scan path runs only
 * when the row is absent. lastSuccessAt advances do NOT invalidate: an
 * unchanged refresh renews freshness without touching content.
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
import {
  countObservations,
  getDatasetState,
  getLatestFetchRun,
  listAvailableYears,
  parseDatasetYears,
} from '../db/repository.js';

let entries = new WeakMap();

/** Test seam: drop all memoized results. */
export function resetYearsCache() {
  entries = new WeakMap();
}

/**
 * Generation identity: the observation-content version when derived
 * (no table scan); legacy run-id + observation count otherwise.
 */
export async function yearsCacheKey(db) {
  const handle = db ?? getDb();
  const state = await getDatasetState(handle);
  if (state) return `cv:${state.contentVersion ?? 'none'}`;
  const run = await getLatestFetchRun(handle, { status: 'success' });
  return `run:${run?.id ?? 'none'}:${await countObservations(handle)}`;
}

/** Rebuild the listAvailableYears() shape from stored years metadata. */
function yearsFromState(state) {
  const stored = parseDatasetYears(state);
  if (!stored || !Object.values(stored.perMetric).every((years) => Array.isArray(years))) return null;
  const years = [...stored.years].sort((a, b) => a - b);
  return {
    years,
    minYear: years.length ? years[0] : null,
    maxYear: years.length ? years[years.length - 1] : null,
    perMetric: stored.perMetric,
  };
}

export async function getCachedAvailableYears(db = null) {
  const handle = db ?? getDb();
  const key = await yearsCacheKey(handle);
  const entry = entries.get(handle);
  if (entry && entry.key === key) return entry.result;
  const state = await getDatasetState(handle);
  const stored = state ? yearsFromState(state) : null;
  const result = stored ?? (await listAvailableYears(handle));
  entries.set(handle, { key, result });
  return result;
}
