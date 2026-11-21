import { AnalyticalTable } from './AnalyticalTable.jsx';
import FailureDetails from './FailureDetails.jsx';
import { formatDurationMs, formatDurationMsValue, formatUtcDateTimeSeconds } from '../utils/format.js';

function failureSummary(run) {
  const failed = run.summary_counts?.failed;
  const error = run.error_message ?? '';
  const kind = /timeout|timed out/i.test(error) ? 'Request timeout' : /HTTP\s*502/i.test(error) ? 'Upstream HTTP 502' : /HTTP\s*\d{3}/i.exec(error)?.[0];
  const count = Number.isInteger(failed) && failed > 0 ? `${failed} indicator${failed === 1 ? '' : 's'} failed` : null;
  return [count, kind].filter(Boolean).join(' · ') || (error || run.status === 'failed' || run.status === 'partial' ? 'Recorded retrieval failure' : '—');
}
function recordedFailures(run) {
  let summary;
  try { summary = typeof run.progress_summary === 'string' ? JSON.parse(run.progress_summary) : run.progress_summary; } catch { /* Historical malformed summary remains available in recorded fields. */ }
  return [run.error_message, ...(summary?.steps ?? []).filter(step => step.status === 'failed').map(step =>
    `${step.label ?? step.metricKey}: ${typeof step.error === 'string' ? step.error : JSON.stringify(step.error ?? step)}`)].filter(Boolean).join('\n\n');
}
const time = value => value ? <time dateTime={value}>{formatUtcDateTimeSeconds(value) ?? value}</time> : '—';

export default function RefreshHistory({ runs }) {
  if (!runs?.length) return null;
  return <details className="details refresh-history">
    <summary>Run history ({runs.length})</summary>
    <p className="chart-note">Changed counts can describe staged checks. Partial or failed runs do not replace the previous valid dataset. A successful unchanged check does not imply new observations.</p>
    <AnalyticalTable label="Recent refresh runs" className="refresh-history-table" freezeYear={false}>
      <table className="table"><thead><tr>
        <th scope="col" data-column-kind="rank">Run</th><th scope="col">Outcome</th><th scope="col">Trigger</th>
        <th scope="col">Started UTC</th><th scope="col">Finished UTC</th><th scope="col">Duration</th>
        {['Checked', 'Changed / staged', 'Unchanged', 'Failed', 'Retrieved', 'Upserted', 'Skipped'].map(label => <th scope="col" className="num" key={label}>{label}</th>)}
        <th scope="col">Publication</th><th scope="col" data-column-kind="status">Failure</th>
      </tr></thead><tbody>{runs.map((run, index) => {
        const counts = run.summary_counts;
        const checked = counts?.checked ?? (counts?.total != null ? Math.max(0, counts.total - (counts.notAttempted ?? 0)) : null);
        const failure = failureSummary(run);
        return <tr key={run.id}>
          <th scope="row" className="run-identity">#{runs.length - index}</th>
          <td>{run.status ?? '—'}<small className="monitor-code">Run id {run.id}</small></td><td>{run.trigger ?? '—'}</td><td>{time(run.started_at)}</td><td>{time(run.completed_at)}</td>
          <td>{run.duration_ms != null ? formatDurationMsValue(run.duration_ms) : formatDurationMs(run.started_at, run.completed_at)}</td>
          {[checked, counts?.updated, counts?.unchanged, counts?.failed, run.rows_retrieved, run.rows_upserted, run.rows_skipped_unchanged].map((value, col) => <td className="num" key={col}>{value ?? '—'}</td>)}
          <td>{['partial', 'failed'].includes(run.status) ? 'Not published' : run.status === 'success' ? 'Check completed' : '—'}</td>
          <td>{failure !== '—' ? <><span className="failure-summary">{failure}</span><FailureDetails title={`Run id ${run.id} — failure details`} text={recordedFailures(run)} record={run} /></> : '—'}</td>
        </tr>;
      })}</tbody></table>
    </AnalyticalTable>
  </details>;
}
