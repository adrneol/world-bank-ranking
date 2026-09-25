/**
 * Chart data adapters (pure functions, no JSX, no Recharts import).
 *
 * These reshape backend-provided values into chart-ready rows. They NEVER
 * calculate economics: no sums, averages, growth rates, ratios, ranks or
 * percentage changes. Values pass through untouched (including null);
 * only ordering (by year/name) and structural reshaping happen here.
 * Missing stays missing so lines break and bars vanish instead of
 * fabricating zeros.
 */

/** Sort points by x ascending; drop rows without a usable year. y untouched. */
export function sortPoints(points) {
  const rows = [];
  for (const p of points ?? []) {
    // Explicit presence check first: Number(null) is 0, which would invent
    // a year-0 point — null/undefined/blank years are dropped instead.
    if (p?.x === null || p?.x === undefined || p?.x === '') continue;
    const x = Number(p.x);
    if (!Number.isFinite(x)) continue;
    rows.push({ x, y: p.y ?? null });
  }
  return rows.sort((a, b) => a.x - b.x);
}

/**
 * Align several year-keyed series onto one row list for multi-series
 * charts: [{ x, [key0]: y|null, [key1]: y|null }]. A year present in any
 * series gets a row; absent legs stay null (gap, never zero-fill).
 */
export function alignSeries(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList : [];
  const keys = list.map((_, i) => `s${i}`);
  const byX = new Map();
  list.forEach((series, i) => {
    for (const p of sortPoints(series?.points)) {
      if (!byX.has(p.x)) {
        const row = { x: p.x };
        for (const key of keys) row[key] = null;
        byX.set(p.x, row);
      }
      byX.get(p.x)[keys[i]] = Number.isFinite(p.y) ? p.y : null;
    }
  });
  return {
    keys,
    rows: [...byX.values()].sort((a, b) => a.x - b.x),
    labels: list.map((s) => s?.label ?? ''),
  };
}

/** True when at least one finite value exists anywhere in the series. */
export function hasAnyPoint(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList : [];
  return list.some((s) => (s?.points ?? []).some((p) => Number.isFinite(p?.y)));
}

/**
 * Bar entries pass through verbatim: [{ name, value }] with null kept so
 * missing categories render no bar instead of a zero bar.
 */
export function toBarEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((e) => ({
    name: e?.name ?? '',
    value: e?.value ?? null,
  }));
}

export default { sortPoints, alignSeries, hasAnyPoint, toBarEntries };
