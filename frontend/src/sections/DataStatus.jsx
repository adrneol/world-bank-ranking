/**
 * Data status + manual refresh.
 * Freshness, vintage, lock state and integrity come from GET /api/data-status;
 * manual refresh POSTs /api/data/refresh. While a refresh runs, the section
 * polls for progress and disables duplicate submissions.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { Section, StatusBlock } from '../components/ui.jsx';

function ageText(ageHours) {
  if (ageHours === null || ageHours === undefined) return 'unknown';
  if (ageHours < 1) return `${Math.round(ageHours * 60)} min ago`;
  if (ageHours < 48) return `${Math.round(ageHours)} h ago`;
  return `${(ageHours / 24).toFixed(1)} days ago`;
}

export default function DataStatus({ onRefreshed }) {
  const [refreshState, setRefreshState] = useState({ running: false, error: null });
  const [pollToken, setPollToken] = useState(0);
  const { data, loading, error, retry } = useApi((signal) => api.dataStatus({ signal }), `datastatus:${pollToken}`);

  const inProgress = Boolean(data?.inProgress);

  useEffect(() => {
    if (!inProgress) return undefined;
    const timer = setTimeout(() => setPollToken((t) => t + 1), 2000);
    return () => clearTimeout(timer);
  }, [inProgress, pollToken]);

  async function startRefresh() {
    if (refreshState.running) return;
    setRefreshState({ running: true, error: null });
    try {
      const summary = await api.refresh({});
      setRefreshState({ running: false, error: null });
      setPollToken((t) => t + 1);
      // The success notice lives in App state (outside the remounted <main>),
      // otherwise the data remount below would wipe it instantly.
      onRefreshed?.(summary);
    } catch (refreshError) {
      const failedNote =
        refreshError?.code === 'REFRESH_IN_PROGRESS'
          ? 'A refresh is already running — no duplicate was started.'
          : 'The previous valid dataset remains available.';
      setRefreshState({ running: false, error: `${refreshError?.message ?? 'Refresh failed.'} ${failedNote}` });
      setPollToken((t) => t + 1);
    }
  }

  const lastRunFailed = data?.lastRun?.status === 'failed' || data?.latestRuns?.[0]?.status === 'failed';

  return (
    <Section
      id="data-status"
      title="Data status & refresh"
      subtitle="Persistent World Bank cache, freshness, and refresh controls."
      aside={
        <button
          type="button"
          className="btn btn-primary"
          onClick={startRefresh}
          disabled={refreshState.running || inProgress}
        >
          {refreshState.running || inProgress ? 'Refreshing…' : 'Refresh now'}
        </button>
      }
    >
      <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="data status" />
      {!loading && !error && data ? (
        <>
          <dl className="facts facts-grid">
            <div>
              <dt>Dataset</dt>
              <dd>
                {data.empty ? 'Empty — no observations stored' : `${data.observations} observations stored`}
                {data.fresh ? ' (fresh)' : ' (stale)'}
              </dd>
            </div>
            <div>
              <dt>World Bank vintage</dt>
              <dd>{data.lastSuccessAt ? `${new Date(data.lastSuccessAt).toLocaleString()} (retrieved)` : '—'}</dd>
            </div>
            <div>
              <dt>Cache age / TTL</dt>
              <dd>
                {ageText(data.ageHours)} · TTL {data.ttlHours} h · {data.refreshDue ? 'refresh due' : 'within TTL'}
              </dd>
            </div>
            <div>
              <dt>Refresh state</dt>
              <dd>
                {inProgress
                  ? `Running${data.progress?.stage ? ` — ${data.progress.stage}` : ''}`
                  : `Idle (lock ${data.lock?.locked ? 'held' : 'free'})`}
              </dd>
            </div>
            <div>
              <dt>Integrity</dt>
              <dd>
                {data.integrity?.passed
                  ? 'All checks pass'
                  : `Failing: ${data.integrity?.checks?.filter((c) => c.status !== 'pass').map((c) => c.check).join(', ') || data.integrity?.error || 'unknown'}`}
              </dd>
            </div>
            <div>
              <dt>Auto-refresh</dt>
              <dd>{data.autoRefresh ? (data.autoRefresh.enabled ? 'Enabled on stale cache' : 'Disabled') : 'Managed by backend'}</dd>
            </div>
          </dl>

          {refreshState.running || inProgress ? (
            <p className="status status-loading" role="status">
              Refresh in progress{data.progress?.stage ? ` — ${data.progress.stage}` : ''}. Current data remain
              available below; duplicate refreshes are blocked.
            </p>
          ) : null}
          {refreshState.error ? (
            <p className="status status-error" role="alert">
              {refreshState.error}
            </p>
          ) : null}
          {!refreshState.error && lastRunFailed && !inProgress ? (
            <p className="status status-error" role="alert">
              The most recent refresh run failed. The previous valid dataset remains available.
            </p>
          ) : null}

          {data.latestRuns?.length > 0 ? (
            <details className="details">
              <summary>Recent refresh runs ({data.latestRuns.length})</summary>
              <div className="table-scroll" role="region" aria-label="Recent refresh runs" tabIndex={0}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Run</th>
                      <th scope="col">Status</th>
                      <th scope="col">Trigger</th>
                      <th scope="col" className="num">
                        Upserted
                      </th>
                      <th scope="col">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestRuns.map((run) => (
                      <tr key={run.id}>
                        <th scope="row" className="num">
                          #{run.id}
                        </th>
                        <td>{run.status}</td>
                        <td>{run.trigger ?? '—'}</td>
                        <td className="num">{run.rows_upserted ?? '—'}</td>
                        <td>{run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
