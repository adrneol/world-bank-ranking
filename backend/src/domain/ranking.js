/**
 * LEVEL RANKING ENGINE (pure functions, no I/O).
 *
 * Method (identical for every metric and every year, modulo direction):
 *   1. take every eligible observation for that year
 *   2. drop null/missing values (they are never ranked, never treated as 0)
 *   3. sort by raw value in the metric's declared direction
 *      (DESCENDING for GDP-like size ordering, ASCENDING e.g. for inflation
 *      where lower numeric values come first; NEUTRAL metrics are refused by
 *      the calling service and never reach this engine)
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
 *
 * Direction defaults to DESC (frozen GDP behavior). Any value other than the
 * exact string 'ASC' resolves to DESC, so an unknown direction can never
 * silently invert a ranking.
 */

/** Ranking directions supported by this engine. NEUTRAL is refused upstream. */
export const RANK_DIRECTIONS = Object.freeze({ DESC: 'DESC', ASC: 'ASC' });

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
 * Deterministic comparator: value ASCENDING (lower numeric values first),
 * then ISO3 ASC. Negative values naturally precede positive values; no
 * desirability score is fabricated — this is ordinary numeric order.
 *
 * @param {{ iso3: string, value: number }} a
 * @param {{ iso3: string, value: number }} b
 */
export function compareByValueAsc(a, b) {
  if (a.value !== b.value) return a.value - b.value;
  return a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0;
}

/**
 * Resolve the comparator for a direction. Anything but exact 'ASC' yields
 * the frozen DESC comparator.
 *
 * @param {string} [direction]
 */
export function comparatorFor(direction = 'DESC') {
  return direction === RANK_DIRECTIONS.ASC ? compareByValueAsc : compareByValueDesc;
}

/**
 * Resolve the ranking direction declared by a metric registry entry.
 *
 * Returns 'DESC', 'ASC', or null when ranking is unsupported (NEUTRAL or
 * undeclared). Calling services refuse null with RANK_UNSUPPORTED — they
 * never fall back to a different direction silently, and they never rank
 * NEUTRAL metrics.
 *
 * @param {object} metric registry entry (or null)
 */
export function directionFor(metric) {
  const declared = metric?.rankingDirection;
  if (declared === RANK_DIRECTIONS.ASC) return RANK_DIRECTIONS.ASC;
  if (declared === RANK_DIRECTIONS.DESC) return RANK_DIRECTIONS.DESC;
  return null;
}

/**
 * Rank a list of eligible observations.
 *
 * Sorting and comparison use ONLY the numeric value (never valueRaw, never a
 * formatted string). valueRaw, when present, is passed through untouched as
 * audit metadata.
 *
 * @param {{ iso3: string, name?: string, value: number, valueRaw?: string|null }[]} rows
 * @param {string} [direction] 'DESC' (default, frozen) or 'ASC'
 * @returns {{
 *   ranked: { rank:number, iso3:string, name?:string, value:number, valueRaw?:string|null }[],
 *   total: number,
 *   dropped: number
 * }}
 */
export function rankByValue(rows, direction = 'DESC') {
  const resolved = direction === RANK_DIRECTIONS.ASC ? RANK_DIRECTIONS.ASC : RANK_DIRECTIONS.DESC;
  const valid = (rows ?? []).filter(
    (r) => r && typeof r.value === 'number' && Number.isFinite(r.value) && r.iso3,
  );
  const dropped = (rows?.length ?? 0) - valid.length;

  const ranked = [...valid].sort(comparatorFor(resolved)).map((row, index) => ({
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
 * @param {string} [direction] 'DESC' (default, frozen) or 'ASC'
 */
export function rankAndLocate(rows, iso3, direction = 'DESC') {
  const { ranked, total, dropped } = rankByValue(rows, direction);
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
 * Parse an exact-rank search ("100", "#100", " 100 ") to a rank number.
 * Anything else (names, ISO3 codes, mixed text) yields null so the caller
 * keeps the existing substring behavior. Pure-numeric input is ALWAYS a rank
 * lookup, never a substring — "10" must not match ranks 100, 101 or 210.
 *
 * @param {string} query
 * @returns {number|null} exact 1-based rank, or null when not a rank query
 */
export function parseRankQuery(query) {
  const m = /^#?(\d+)$/.exec(String(query ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Search a ranked list by country name, ISO3 (case-insensitive substring),
 * or exact analytical rank ("100" / "#100" match rank #100 only).
 * Filtering never renumbers: matched rows keep their backend rank.
 *
 * @param {object[]} ranked
 * @param {string} query
 */
export function searchRanked(ranked, query) {
  const raw = String(query ?? '').trim();
  if (!raw) return [];
  const wanted = parseRankQuery(raw);
  if (wanted !== null) return ranked.filter((r) => r.rank === wanted);
  const q = raw.toLowerCase();
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

export default { rankByValue, rankAndLocate, neighborWindow, paginate, parseRankQuery, searchRanked, compareByValueDesc, compareByValueAsc, comparatorFor, directionFor, RANK_DIRECTIONS };