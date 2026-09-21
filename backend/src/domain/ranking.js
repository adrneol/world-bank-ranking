/**
 * LEVEL RANKING ENGINE (pure functions, no I/O).
 *
 * Method (identical for every metric and every year):
 *   1. take every eligible observation for that year
 *   2. drop null/missing values (they are never ranked, never treated as 0)
 *   3. sort by raw value DESCENDING
 *   4. break ties by ISO3 ASCENDING (deterministic secondary key)
 *   5. rank = 1-based position in that ordering
 *
 * Ties therefore receive DISTINCT ordinal positions ordered by ISO3, rather
 * than shared competition-style ranks. This is a deliberate, documented choice:
 * it makes every rank reproducible from the same dataset because the sort is a
 * total order. It is NOT competition ranking and NOT dense ranking.
 *
 * The denominator is the number of rows that survived step 2 - the eligible
 * countries/economies with a valid observation for that year and metric.
 */

/**
 * Deterministic comparator: value DESC, then ISO3 ASC.
 *
 * @param {{ iso3: string, value: number }} a
 * @param {{ iso3: string, value: number }} b
 */
export function compareByValueDesc(a, b) {
  if (a.value !== b.value) return b.value - a.value;
  return a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0;
}

/**
 * Rank a list of eligible observations.
 *
 * Sorting and comparison use ONLY the numeric value (never valueRaw, never a
 * formatted string). valueRaw, when present, is passed through untouched as
 * audit metadata.
 *
 * @param {{ iso3: string, name?: string, value: number, valueRaw?: string|null }[]} rows
 * @returns {{
 *   ranked: { rank:number, iso3:string, name?:string, value:number, valueRaw?:string|null }[],
 *   total: number,
 *   dropped: number
 * }}
 */
export function rankByValue(rows) {
  const valid = (rows ?? []).filter(
    (r) => r && typeof r.value === 'number' && Number.isFinite(r.value) && r.iso3,
  );
  const dropped = (rows?.length ?? 0) - valid.length;

  const ranked = [...valid].sort(compareByValueDesc).map((row, index) => ({
    rank: index + 1,
    iso3: row.iso3,
    name: row.name,
    value: row.value,
    ...(row.valueRaw !== undefined ? { valueRaw: row.valueRaw } : {}),
  }));

  return { ranked, total: ranked.length, dropped };
}

/**
 * Rank and locate one country.
 *
 * @param {{ iso3: string, name?: string, value: number }[]} rows
 * @param {string} iso3 target country
 */
export function rankAndLocate(rows, iso3) {
  const { ranked, total, dropped } = rankByValue(rows);
  const target = ranked.find((r) => r.iso3 === String(iso3).toUpperCase()) ?? null;
  return { ranked, total, dropped, target };
}

/**
 * Select the verification window around a target rank.
 *
 * @param {object[]} ranked full ranked list
 * @param {number} targetRank 1-based
 * @param {number} neighbors how many rows to show on each side
 */
export function neighborWindow(ranked, targetRank, neighbors) {
  const total = ranked.length;
  const n = Math.max(0, Math.floor(neighbors));
  const start = Math.max(1, targetRank - n);
  const end = Math.min(total, targetRank + n);
  return {
    start,
    end,
    rows: ranked.slice(start - 1, end),
  };
}

/**
 * Paginate a ranked list.
 *
 * @param {object[]} ranked
 * @param {{ page?: number, pageSize?: number }} options
 */
export function paginate(ranked, { page = 1, pageSize = 50 } = {}) {
  const total = ranked.length;
  const size = Math.max(1, Math.min(500, Math.floor(pageSize)));
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(1, Math.min(pages, Math.floor(page)));
  const start = (current - 1) * size;
  return {
    rows: ranked.slice(start, start + size),
    page: current,
    pageSize: size,
    pages,
    total,
  };
}

/**
 * Search a ranked list by country name or ISO3 (case-insensitive substring).
 *
 * @param {object[]} ranked
 * @param {string} query
 */
export function searchRanked(ranked, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return ranked.filter(
    (r) =>
      String(r.iso3 ?? '').toLowerCase().includes(q) ||
      String(r.name ?? '').toLowerCase().includes(q),
  );
}

/**
 * Rank change between two years for the same metric.
 * Purely numerical: no economic interpretation is attached.
 *
 * @param {number|null} previousRank
 * @param {number|null} currentRank
 */
export function describeRankChange(previousRank, currentRank) {
  if (previousRank === null || currentRank === null) {
    return { from: previousRank, to: currentRank, delta: null, text: null };
  }
  const delta = currentRank - previousRank;
  return {
    from: previousRank,
    to: currentRank,
    delta,
    text: `Rank position changed from ${previousRank} to ${currentRank} (difference ${delta > 0 ? '+' : ''}${delta}).`,
  };
}

export default { rankByValue, rankAndLocate, neighborWindow, paginate, searchRanked };