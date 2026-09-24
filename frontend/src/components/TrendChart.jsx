/**
 * Minimal SVG trend chart (Phase 6, no dependencies).
 *
 * Renders backend-provided series only — it never calculates economics.
 * Points are { x: number, y: number|null }; null gaps break the line (missing
 * stays missing, never bridged). Every chart is paired with a visible data
 * table by its caller, which doubles as the accessible fallback; the svg
 * itself carries a text summary via role="img" + aria-label.
 */

import { useId, useMemo } from 'react';

const WIDTH = 560;
const HEIGHT = 220;
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const step = (max - min) / count;
  const ticks = [];
  for (let i = 0; i <= count; i += 1) ticks.push(min + step * i);
  return ticks;
}

function formatTick(v) {
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (abs >= 100 || abs === 0) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function TrendChart({ series = [], xLabel = null, title = null }) {
  const clipId = useId();
  const model = useMemo(() => {
    const xs = [];
    const ys = [];
    for (const s of series) {
      for (const p of s.points ?? []) {
        if (Number.isFinite(p?.x)) xs.push(p.x);
        if (Number.isFinite(p?.y)) ys.push(p.y);
      }
    }
    if (xs.length === 0 || ys.length === 0) return null;
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yMin === yMax) {
      yMin -= Math.abs(yMin) * 0.05 || 1;
      yMax += Math.abs(yMax) * 0.05 || 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const scaleX = (x) => PAD_LEFT + ((x - xMin) / (xMax - xMin || 1)) * innerW;
    const scaleY = (y) => PAD_TOP + innerH - ((y - yMin) / (yMax - yMin || 1)) * innerH;
    return {
      xMin, xMax, yMin, yMax, scaleX, scaleY,
      yTicks: niceTicks(yMin, yMax),
      xTicks: [...new Set(xs)].sort((a, b) => a - b).filter((_, i, arr) => i % Math.ceil(arr.length / 6) === 0),
    };
  }, [series]);

  const summary = useMemo(() => {
    const parts = series.map((s) => {
      const valid = (s.points ?? []).filter((p) => Number.isFinite(p?.y));
      if (valid.length === 0) return `${s.label}: no data`;
      return `${s.label}: ${valid[0].y} to ${valid[valid.length - 1].y}`;
    });
    return `${title ?? 'Trend'} — ${parts.join('; ')}`;
  }, [series, title]);

  if (!model) return null;

  return (
    <figure className="trend-figure">
      <svg className="trend-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_LEFT} y={PAD_TOP} width={WIDTH - PAD_LEFT - PAD_RIGHT} height={HEIGHT - PAD_TOP - PAD_BOTTOM} />
          </clipPath>
        </defs>
        {model.yTicks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={model.scaleY(t)} y2={model.scaleY(t)} />
            <text x={PAD_LEFT - 6} y={model.scaleY(t) + 3} textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {model.xTicks.map((t) => (
          <text key={t} x={model.scaleX(t)} y={HEIGHT - 8} textAnchor="middle">
            {t}
          </text>
        ))}
        <line className="axis" x1={PAD_LEFT} x2={PAD_LEFT} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} />
        <line className="axis" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={HEIGHT - PAD_BOTTOM} y2={HEIGHT - PAD_BOTTOM} />
        <g clipPath={`url(#${clipId})`}>
          {series.map((s, si) => {
            // Split into contiguous runs so missing years break the line.
            const runs = [];
            let current = [];
            for (const p of s.points ?? []) {
              if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
                current.push(`${model.scaleX(p.x).toFixed(1)},${model.scaleY(p.y).toFixed(1)}`);
              } else if (current.length > 0) {
                runs.push(current);
                current = [];
              }
            }
            if (current.length > 0) runs.push(current);
            return runs.map((run, ri) => (
              <polyline key={`${si}-${ri}`} className={si === 0 ? 'series-a' : 'series-b'} points={run.join(' ')} />
            ));
          })}
        </g>
      </svg>
      <figcaption className="chart-legend">
        {series.map((s, si) => (
          <span key={s.label}>
            <span className={si === 0 ? 'chart-swatch' : 'chart-swatch chart-swatch-b'} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        {xLabel ? <span>{xLabel}</span> : null}
      </figcaption>
    </figure>
  );
}
