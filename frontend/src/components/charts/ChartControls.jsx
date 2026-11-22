import { useId, useState } from 'react';
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
  const [custom, setCustom] = useState(false);
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
  const active = presets.find(([, range]) => from === range.from && to === range.to)?.[0];
  return (
    <div className="history-controls">
      <SearchableSelect id={prefix + '-period'} label="Period" value={custom ? 'custom' : active ?? 'custom'}
        options={[...presets.map(([label]) => ({ value: label, label })), { value: 'custom', label: 'Custom range' }, { value: 'reset', label: 'Reset range' }]}
        onChange={choice => {
          setCustom(choice === 'custom');
          if (choice === 'reset') reset();
          else if (choice === 'custom') onChange({from,to,preset:null});
          else if (choice !== 'custom') onChange({...presets.find(([label]) => label === choice)[1],preset:choice});
        }} />
      {custom || !active ? <div className="chart-period-controls" aria-label="Chart period filter">
        {[['from', 'From year', from, years.filter((year) => year <= to)],
          ['to', 'To year', to, years.filter((year) => year >= from)]].map(([key, label, value, options]) => {
          const change = (next) => onChange({ from, to, [key]: Number(next),preset:null });
          return <SearchableSelect key={key} id={prefix + '-' + key} label={label} value={String(value)}
            options={[...(!options.includes(value)?[{value:String(value),label:`${value} · no stored observation`}]:[]),...options.map((year) => ({ value: String(year), label: String(year) }))]} onChange={change} />;
        })}
      </div> : null}
    </div>
  );
}
