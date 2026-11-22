import { AnalyticalTable } from './AnalyticalTable.jsx';
import { METRICS } from '../config/metrics.js';
import { formatUtcDateTimeSeconds } from '../utils/format.js';
import FailureDetails from './FailureDetails.jsx';

const results = { published: 'Updated', unchanged: 'Checked · unchanged', failed: 'Failed' };

export default function IndicatorMonitor({ keys, steps, labelOf, polling, runningKey, publication = 'pending',latestYears = null }) {
  const indicators = [...new Set([...Object.keys(METRICS), ...keys])];
  const attempted = new Set(keys);
  return <AnalyticalTable label="Indicator monitoring" freezeYear={false} className="indicator-monitor">
    <table className="table">
      <thead><tr><th scope="col">Indicator</th><th scope="col">Measurement basis</th><th scope="col">Run result</th><th scope="col">Latest economy year</th></tr></thead>
      <tbody>{indicators.map(key => {
        const step = steps.get(key);
        const metric = METRICS[key];
        const state = results[step?.status] ? step.status : runningKey === key ? 'checking' : attempted.has(key) ? 'waiting' : 'outside';
        const result = state === 'published' && publication !== 'completed' ? 'Changed · staged' : results[state] ?? (state === 'checking' ? 'Checking' : state === 'waiting' ? (polling ? 'Waiting' : 'No result recorded') : 'Outside reported run');
        return <tr key={key} data-run-state={state}>
          <th scope="row">{labelOf(key) ?? metric?.title ?? key}{metric?.indicatorCode ? <small className="monitor-code">{metric.indicatorCode}</small> : null}</th>
          <td>{metric?.unitLong ?? metric?.unit ?? '—'}</td>
          <td className={step?.status === 'failed' ? 'monitor-error' : undefined}>{result}{step?.error ? <FailureDetails title={`${labelOf(key) ?? metric?.title ?? key} — failure details`} text={typeof step.error === 'string' ? step.error : JSON.stringify(step.error, null, 2)} /> : null}
            {step?.at ? <small className="monitor-code"><time dateTime={step.at}>{formatUtcDateTimeSeconds(step.at) ?? step.at}</time></small> : null}</td>
          <td>{latestYears?.[key]?.at(-1)??(latestYears?'No eligible observations':'Not reported')}</td>
        </tr>;
      })}</tbody>
    </table>
  </AnalyticalTable>;
}
