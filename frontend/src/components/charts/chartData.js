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

export function recentWindow(years, count) {
  const to = years.at(-1);
  return { from: years.find((year) => year >= to - count + 1) ?? years[0], to };
}

export function historyPreset(years,name) {
  if(name==='Recent 10 years')return recentWindow(years,10);
  if(name==='Recent 25 years')return recentWindow(years,25);
  if(name==='2000 to latest')return {from:years.find(year=>year>=2000)??years[0],to:years.at(-1)};
  if(name==='Full history')return {from:years[0],to:years.at(-1)};
  return null;
}
export function validHistoryRange(range,domain) {
  return range && Number.isInteger(range.from) && Number.isInteger(range.to) &&
    range.from>=(domain?.min??1960) && range.to<=(domain?.max??9999) && range.from<=range.to &&
    range.to-range.from+1<=(domain?.historyMaxYears??100);
}

export function calendarYears(from, to) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => from + offset);
}

export function annualSeries(entries, measures) {
  const byYear = new Map(entries.map((entry) => [Number(entry.x ?? entry.name), entry]));
  const years = [...byYear.keys()];
  const calendar = years.length ? calendarYears(Math.min(...years), Math.max(...years)) : [];
  return measures.map(({ key, label }) => ({
    id: key, label, points: calendar.map((x) => ({ x, y: byYear.get(x)?.[key] ?? null })),
  }));
}

export function scaleDetailFor(rows, keys) {
  const values = rows.flatMap((row) => keys.map((key) => row[key])).filter(Number.isFinite);
  if (values.length < 2) return null;
  const nonzero = values.filter((value) => value !== 0).map(Math.abs);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const largest = Math.max(Math.abs(low), Math.abs(high));
  if (nonzero.length && largest / Math.min(...nonzero) >= 1000) return low > 0 ? 'log' : 'signed-detail';
  if (low !== high && (high - low) / largest < 0.01) return 'detail';
  if (low <= 0 && high >= 0 && low !== high && (low === 0 || high === 0)) return 'detail';
  return null;
}

export function plotMinWidth(count) {
  return Math.min(3600, Math.max(420, count * 42 + 96));
}

export default { sortPoints, alignSeries, hasAnyPoint, toBarEntries };
