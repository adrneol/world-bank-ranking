/**
 * Per-comparison sort options for movement common tables. Pure functions —
 * no JSX — so the sort contract is unit-testable.
 *
 * GDP-family tables expose per-year rank/value sorts; the Phase-5 families
 * historically offered only four generic ref-period sorts although every
 * compared period carries its own backend rank/value in `perKey`. These
 * options expose the complete valid set: rank/value × direction for EACH
 * compared key, labeled with the period. Sorting stays presentation-only
 * over backend ranks/values with shared null placement and ISO3 tie-break.
 */

/**
 * @param {string[]} keys compared period/year labels, in display order
 * @param {string} valueNoun display noun for values ("value", or "change" for FX)
 */
export function movementCommonSortOptions(keys, valueNoun = 'value') {
  const options = [];
  (keys ?? []).forEach((k, i) => {
    options.push(
      { value: `rank-asc:${i}`, label: `${k} rank — best first` },
      { value: `rank-desc:${i}`, label: `${k} rank — lowest first` },
      { value: `value-desc:${i}`, label: `${k} ${valueNoun} — high to low` },
      { value: `value-asc:${i}`, label: `${k} ${valueNoun} — low to high` },
    );
  });
  return options;
}

/** Default sort id: best-first rank of the reference (last) comparison. */
export function defaultMovementCommonSort(keys) {
  return `rank-asc:${Math.max(0, (keys ?? []).length - 1)}`;
}

/**
 * Sort common-table base rows (each carrying backend `perKey`) by one
 * per-key option. Unknown/stale ids fall back to the reference comparison;
 * nulls sort last in ascending modes (and first-ignored in descending,
 * mirroring the tables' long-standing placement).
 */
export function sortMovementCommonRows(rows, sort, keys) {
  const list = Array.isArray(keys) ? keys : [];
  const sep = String(sort ?? '').lastIndexOf(':');
  const mode = sep >= 0 ? String(sort).slice(0, sep) : 'rank-asc';
  const parsed = sep >= 0 ? Number.parseInt(String(sort).slice(sep + 1), 10) : list.length - 1;
  const key = list[Number.isInteger(parsed) && parsed >= 0 && parsed < list.length ? parsed : Math.max(0, list.length - 1)];
  const rankOf = (r) => r?.perKey?.[key]?.rank ?? null;
  const numOf = (r) => {
    const v = r?.perKey?.[key]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const byIso = (x, y) => (x.iso3 < y.iso3 ? -1 : x.iso3 > y.iso3 ? 1 : 0);
  const copy = [...(rows ?? [])];
  switch (mode) {
    case 'rank-desc':
      return copy.sort((x, y) => (rankOf(y) ?? -Infinity) - (rankOf(x) ?? -Infinity) || byIso(x, y));
    case 'value-asc':
      return copy.sort((x, y) => (numOf(x) ?? Infinity) - (numOf(y) ?? Infinity) || byIso(x, y));
    case 'value-desc':
      return copy.sort((x, y) => (numOf(y) ?? -Infinity) - (numOf(x) ?? -Infinity) || byIso(x, y));
    case 'rank-asc':
    default:
      return copy.sort((x, y) => (rankOf(x) ?? Infinity) - (rankOf(y) ?? Infinity) || byIso(x, y));
  }
}

export default { movementCommonSortOptions, defaultMovementCommonSort, sortMovementCommonRows };
