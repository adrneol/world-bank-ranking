// Display geometry only. Source observations never pass through these helpers for storage or calculation.
export const seriesColor = (index) => `var(--chart-series-${index % 8})`;
export const plotInsets = { top: 12, bottom: 14, timeline: 29 };

export function annualGeometry(yearCount, maxGroup, type, viewportWidth) {
  const minimumStep = type === 'bar' ? Math.max(30, maxGroup * 11 + 12) : 25;
  const width = Math.max(viewportWidth, minimumStep * yearCount);
  const step = width / Math.max(yearCount, 1);
  return { width, step, x: (index) => (index + 0.5) * step,
    barWidth: Math.min(29, (step - 10) / Math.max(maxGroup, 1) - 2),
    tickEvery: Math.max(1, Math.ceil(62 / step), Math.ceil(yearCount / 24)) };
}

const transforms = {
  linear: [value => value, value => value],
  log: [Math.log10, value => Math.max(Number.MIN_VALUE, Math.min(Number.MAX_VALUE, 10 ** value))],
  symlog: [value => Math.sign(value) * Math.log1p(Math.abs(value)),
    value => Math.sign(value) * Math.min(Number.MAX_VALUE, Math.expm1(Math.abs(value)))],
};

export function barCenter(geometry, index, slot, count) {
  return geometry.x(index) + (slot - (count - 1) / 2) * (geometry.barWidth + 2);
}

// Intersect each segment in X before projecting it in Y. A null endpoint
// breaks the line. These intersections are pixels, never new observations.
export function visibleSegments(points, x, from, to, mode = 'linear') {
  const [transform, inverse] = transforms[mode];
  const segments = [];
  const step = x(1) - x(0);
  const first = Math.max(1, Math.ceil((from - x(0)) / step));
  const last = Math.min(points.length - 1, Math.floor((to - x(0)) / step) + 1);
  for (let index = first; index <= last; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const left = x(index - 1);
    const right = x(index);
    if (!Number.isFinite(a) || !Number.isFinite(b) || right < from || left > to) continue;
    const start = Math.max(from, left);
    const end = Math.min(to, right);
    const at = (position) => {
      if (position === left) return a;
      if (position === right) return b;
      const t = (position - left) / (right - left);
      return inverse((1 - t) * transform(a) + t * transform(b));
    };
    segments.push([start, at(start), end, at(end)]);
  }
  return segments;
}

export function visibleValues(series, geometry, from, to, mode) {
  const values = [];
  series.forEach((item, slot) => {
    const radius = item.bars ? geometry.barWidth / 2 : 4;
    const start = item.bars ? barCenter(geometry, 0, item.barSlot ?? slot, item.barCount ?? series.length) : geometry.x(0);
    const first = Math.max(0, Math.ceil((from - radius - start) / geometry.step));
    const last = Math.min(item.values.length - 1, Math.floor((to + radius - start) / geometry.step));
    for (let index = first; index <= last; index += 1) {
      if (Number.isFinite(item.values[index])) values.push(item.values[index]);
    }
    if (!item.bars) {
      for (const [, a, , b] of visibleSegments(item.values, geometry.x, from, to, mode)) values.push(a, b);
    }
  });
  return values;
}

const limit = value => Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, value));

function axisTicks(lo, hi, y, zero, fallback, linear = true) {
  const rawStep = hi / 5 - lo / 5;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(value => value >= rawStep);
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  const candidates = linear && Number.isSafeInteger(first) && Number.isSafeInteger(last) && last - first >= 2 && last - first < 7
    ? Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step) : fallback;
  const ticks = zero ? [0] : [];
  for (const tick of candidates) {
    if (Number.isFinite(tick) && ticks.every(existing => Math.abs(y(existing) - y(tick)) >= 19)) ticks.push(tick);
  }
  return ticks.sort((a, b) => a - b);
}

// Each axis gets its own units per pixel, with one shared fraction below zero.
export function barAxes(groups, height) {
  const extents = groups.map(values => {
    let min = 0;
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    const magnitude = Math.max(Math.abs(min), max) || 1;
    return { magnitude, negative: -min / magnitude, positive: max / magnitude };
  });
  const negative = Math.max(...extents.map(extent => extent.negative));
  const positive = Math.max(...extents.map(extent => extent.positive));
  const below = negative && positive ? Math.max(0.04, Math.min(0.96, negative / (negative + positive))) : Number(!!negative);
  const above = 1 - below;
  const space = height - plotInsets.top - plotInsets.bottom;
  const baseline = plotInsets.top + space * above;
  return extents.map(({ magnitude, negative, positive }) => {
    const span = 1.05 * (Math.max(below ? negative / below : 0, above ? positive / above : 0) || 1);
    const lo = limit(-below * span * magnitude);
    const hi = limit(above * span * magnitude);
    const y = value => baseline - (value / magnitude / span) * space;
    const fallback = Array.from({ length: 5 }, (_, index) => limit((index / 4 - below) * span * magnitude));
    return { lo, hi, y, ticks: axisTicks(lo, hi, y, true, fallback) };
  });
}

export function valueAxis(values, height, { includeZero = false, mode = 'linear' } = {}) {
  const valid = values.filter(Number.isFinite);
  let lo = valid.length ? Math.min(...valid) : mode === 'log' ? 1 : 0;
  let hi = valid.length ? Math.max(...valid) : mode === 'log' ? 10 : 1;
  if (includeZero && mode !== 'log') {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const [transform, inverse] = transforms[mode];
  let lower = transform(lo);
  let upper = transform(hi);
  // Work in a normalized coordinate space for opposite-sign extremes,
  // which can otherwise overflow when computing a span.
  const maxAbs = Math.max(Math.abs(lower), Math.abs(upper));
  const magnitude = maxAbs ? Math.max(maxAbs, 2 ** -1022) : 1;
  lower /= magnitude;
  upper /= magnitude;
  const span = upper - lower;
  if (span < Number.EPSILON * 4) {
    const padding = span === 0 ? 0.025 : Number.EPSILON * 8;
    lower -= padding;
    upper += padding;
    if (includeZero && lo === 0) lower = 0;
    if (includeZero && hi === 0 && lo < 0) upper = 0;
  } else if (!includeZero) {
    lower -= span * 0.045;
    upper += span * 0.045;
  }
  lower = Math.max(lower, -Number.MAX_VALUE / magnitude);
  upper = Math.min(upper, Number.MAX_VALUE / magnitude);
  const space = height - plotInsets.top - plotInsets.bottom;
  const y = (value) => plotInsets.top + space * (1 - (transform(value) / magnitude - lower) / (upper - lower));
  const at = (ratio) => inverse(limit((lower * (1 - ratio) + upper * ratio) * magnitude));
  const bounds = [at(0), at(1)];
  const ticks = axisTicks(bounds[0], bounds[1], y, includeZero && bounds[0] <= 0 && bounds[1] >= 0,
    Array.from({ length: 5 }, (_, index) => at(index / 4)), mode === 'linear');
  return { y, ticks, lo: bounds[0], hi: bounds[1] };
}

export function annualSegments(points, x, y) {
  let penDown = false;
  return points.map((value, index) => {
    if (!Number.isFinite(value)) { penDown = false; return ''; }
    const command = penDown ? 'L' : 'M';
    penDown = true;
    return command + x(index) + ',' + y(value);
  }).join(' ');
}
