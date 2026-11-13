import { useId } from 'react';
import { SearchableSelect } from '../controls.jsx';
import { recentWindow } from './chartData.js';

export function SegmentedControl({ label, value, options, onChange, describedBy, className = '' }) {
  return (
    <div className={'segmented-control ' + className} role="group" aria-label={label} aria-describedby={describedBy}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}

export function ChartTypeToggle({ value, onChange, lineLabel = 'Line chart' }) {
  return <SegmentedControl className="chart-type-toggle" label="Chart type" value={value} onChange={onChange}
    options={[['bar', 'Bar chart'], ['line', lineLabel]]} />;
}

const domainOptions = [['auto', 'Auto'], ['fixed', 'Fixed']];

export function AnnualRangeControl({ value, onChange }) {
  const description = useId();
  return <div className="annual-range"><span>Y-axis range</span>
    <SegmentedControl label="Y-axis range" value={value} options={domainOptions} onChange={onChange} describedBy={description} />
    <span className="sr-only" id={description}>Auto scales to the visible years. Fixed scales to the full selected period.</span>
  </div>;
}

export function HistoryWindowControls({ years, from, to, onChange, reset, idPrefix }) {
  const id = useId();
  const prefix = idPrefix ?? id;
  const full = { from: years[0], to: years.at(-1) };
  if (full.from === undefined) return null;
  const since2000 = { from: years.find((year) => year >= 2000) ?? full.from, to: full.to };
  const presets = [
    ['Recent 10 years', recentWindow(years, 10)],
    ['Recent 25 years', recentWindow(years, 25)],
    ['2000 to latest', since2000],
    ['Full history', full],
  ];
  return (
    <div className="history-controls">
      <div className="history-presets" role="group" aria-label="History presets">
        {presets.map(([label, range]) => (
          <button type="button" key={label} aria-pressed={from === range.from && to === range.to}
            onClick={() => onChange(range)}>{label}</button>
        ))}
        <button type="button" onClick={reset}>Reset range</button>
      </div>
      <div className="chart-period-controls" aria-label="Chart period filter">
        {[['from', 'From year', from, years.filter((year) => year <= to)],
          ['to', 'To year', to, years.filter((year) => year >= from)]].map(([key, label, value, options]) => {
          const change = (next) => onChange({ from, to, [key]: Number(next) });
          return <SearchableSelect key={key} id={prefix + '-' + key} label={label} value={String(value)}
            options={options.map((year) => ({ value: String(year), label: String(year) }))} onChange={change} />;
        })}
      </div>
    </div>
  );
}
