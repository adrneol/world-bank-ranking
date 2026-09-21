/**
 * YoY RANKING ENGINE (pure functions, no I/O).
 *
 * This is a SEPARATE concept from level ranking and must never be mixed with it:
 *
 *   LEVEL RANK : countries ordered by GDP-per-capita VALUE.
 *   YoY RANK   : countries ordered by GDP-per-capita PERCENTAGE CHANGE.
 *
 * A country can hold a low level rank and a high YoY rank; the two numbers
 * answer different questions and are never averaged or combined.
 *
 * Universe for a YoY ranking (differs from the level-ranking universe):
 * only countries for which BOTH the previous year and the current year hold a
 * valid eligible observation AND the percentage is actually calculable.
 * Countries without a usable pair are excluded, so the YoY denominator can be
 * smaller than the level-ranking denominator for the same year and metric.
 *
 * Ordering is deterministic: YoY percent DESCENDING, then ISO3 ASCENDING.
 * As with level ranking, ties receive distinct ordinal positions ordered by
 * ISO3 rather than shared ranks.
 */

/**
 * Rank a list of countries by YoY percentage change.
 *
 * @param {{ iso3:string, name?:string, previousValue:number, currentValue:number, yoyPercent:number }[]} rows
 * @returns {{ ranked: object[], total: number, excluded: number }}
 */
export function rankByYoy(rows) {
  const valid = (rows ?? []).filter(
    (r) =>
      r &&
      r.iso3 &&
      Number.isFinite(r.yoyPercent) &&
      Number.isFinite(r.previousValue) &&
      Number.isFinite(r.currentValue),
  );
  const excluded = (rows?.length ?? 0) - valid.length;

  const ranked = [...valid]
    .sort((a, b) => {
      if (a.yoyPercent !== b.yoyPercent) return b.yoyPercent - a.yoyPercent;
      return a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0;
    })
    .map((row, index) => ({
      rank: index + 1,
      iso3: row.iso3,
      name: row.name,
      previousValue: row.previousValue,
      currentValue: row.currentValue,
      yoyPercent: row.yoyPercent,
    }));

  return { ranked, total: ranked.length, excluded };
}

/**
 * Rank by YoY and locate a target country.
 *
 * @param {object[]} rows
 * @param {string} iso3
 */
export function rankByYoyAndLocate(rows, iso3) {
  const { ranked, total, excluded } = rankByYoy(rows);
  const target = ranked.find((r) => r.iso3 === String(iso3).toUpperCase()) ?? null;
  return { ranked, total, excluded, target };
}

/**
 * Build YoY rows for every country that has both years available.
 *
 * @param {{ iso3:string, name?:string, value:number }[]} currentRows eligible values for `year`
 * @param {{ iso3:string, name?:string, value:number }[]} previousRows eligible values for `year - 1`
 * @returns {{ rows: object[], consideredCurrent:number, consideredPrevious:number, pairs:number }}
 */
export function buildYoyRows(currentRows, previousRows) {
  const previousByIso3 = new Map();
  for (const row of previousRows ?? []) {
    previousByIso3.set(row.iso3, row);
  }

  const rows = [];
  for (const current of currentRows ?? []) {
    const previous = previousByIso3.get(current.iso3);
    if (!previous) continue; // No previous observation -> not YoY-rankable.
    if (!Number.isFinite(previous.value) || !Number.isFinite(current.value)) continue;
    // A non-positive base yields no defined growth rate; excluded explicitly.
    if (previous.value <= 0) continue;

    rows.push({
      iso3: current.iso3,
      name: current.name ?? previous.name,
      previousValue: previous.value,
      currentValue: current.value,
      // Audit-only decimal strings; the percentage itself is computed from
      // the numeric values above, never from these strings.
      ...(previous.valueRaw !== undefined ? { previousValueRaw: previous.valueRaw } : {}),
      ...(current.valueRaw !== undefined ? { currentValueRaw: current.valueRaw } : {}),
      yoyPercent: ((current.value / previous.value) - 1) * 100,
    });
  }

  return {
    rows,
    consideredCurrent: (currentRows ?? []).length,
    consideredPrevious: (previousRows ?? []).length,
    pairs: rows.length,
  };
}

export default { rankByYoy, rankByYoyAndLocate, buildYoyRows };