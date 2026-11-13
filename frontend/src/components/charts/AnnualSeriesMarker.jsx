import { useId } from 'react';
import { annualStroke } from './chartTheme.js';

export function AnnualPercentagePattern({ id, color }) {
  return <pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5}>
    <rect width={5} height={5} fill={color} fillOpacity={0.16} />
    <path d="M-1 1 1 -1 M-1 6 6 -1 M4 6 6 4" stroke={color} strokeWidth={1.25} />
  </pattern>;
}

export default function AnnualSeriesMarker({ type, color = 'currentColor', percentage, colorIndex, primary }) {
  const pattern = useId();
  return <svg className="annual-series-marker" width={28} height={12} viewBox="0 0 28 12" aria-hidden="true" focusable="false">
    {type === 'bar' ? <>
      {percentage ? <defs><AnnualPercentagePattern id={pattern} color={color} /></defs> : null}
      <rect x={4} y={1} width={20} height={10} fill={percentage ? `url(#${pattern})` : color} />
    </> : type === 'point' ? <circle cx={14} cy={6} r={4} fill={color} stroke={color} /> :
      <line x1={1.5} x2={26.5} y1={6} y2={6} stroke={color} {...annualStroke({ percentage, colorIndex, primary })} />}
  </svg>;
}
