/**
 * Data status + manual refresh.
 * Freshness, vintage, lock state and integrity come from GET /api/data-status;
 * manual refresh POSTs /api/data/refresh. While a refresh runs, the section
 * polls for progress and disables duplicate submissions.
 *
 * Phase 1 reliability (R-02/R-07): the status request is bounded (a hung or
 * cold-starting backend surfaces a distinct, retryable TIMEOUT instead of
 * infinite loading); a slow first load shows a "warming up" hint with an
 * inline retry after 10 s; status polling starts the moment a manual refresh
 * is kicked off — not only after the minutes-long POST resolves — so
 * backend progress.stage streams while the refresh runs.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { Section, StatusBlock } from '../components/ui.jsx';

/** Full refreshes stream dozens of indicator payloads; bound the POST at 10 min. */
const REFRESH_POST_TIMEOUT_MS = 10 * 60 * 1000;
/** Status reads stay tolerant of cold starts, but never unbounded. */
const STATUS_TIMEOUT_MS = 45000;
/** After this long with no status response, say so instead of spinning quietly. */
const SLOW_LOAD_HINT_MS = 10000;
/** Status poll cadence while a refresh is running. */
const PROGRESS_POLL_MS = 2000;

function ageText(ageHours) {
  if (ageHours === null || ageHours === undefined) return 'unknown';
  if (ageHours < 1) return `${Math.round(ageHours * 60)} min ago`;
  if (ageHours < 48) return `${Math.round(ageHours)} h ago`;
  return `${(ageHours / 24).toFixed(1)} days ago`;
}

export default function DataStatus({ onRefreshed }) {
  const [refreshState, setRefreshState] = useState({ running: false, error: null });
  const [pollToken, setPollToken] = useState(0);
  // Slow-first-load hint (R-02): independent of the fetch itself, so a hung
  // request still explains itself instead of spinning silently forever.
  const [slowLoad, setSlowLoad] = useState(false);
  const { data, loading, error, retry } = useApi(
    (signal) => api.dataStatus({ signal, timeoutMs: STATUS_TIMEOUT_MS }),
    `datastatus:${pollToken}`,
  );

  // Bump the status poll and clear a stale slow-load hint. All pollToken
  // changes flow through here so the warming hint always restarts cleanly.
  // Called only from event/async contexts (never synchronously in an effect).
  const bumpPoll = () => {
    setSlowLoad(false);
    setPollToken((t) => t + 1);
  };
  const retryWhileLoading = () => {
    setSlowLoad(false);
    retry();
  };
  const inProgress = Boolean(data?.inProgress);
  // Poll while the backend is refreshing OR while our own manual POST is in
  // flight (R-07): the POST resolves only when the whole refresh completes,
  // so gating on `inProgress` alone would show no progress until the end.
  const polling = inProgress || refreshState.running;

  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => setSlowLoad(true), SLOW_LOAD_HINT_MS);
    return () => clearTimeout(timer);
  }, [loading, pollToken]);

  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(() => bumpPoll(), PROGRESS_POLL_MS);
    return () => clearTimeout(timer);
    // bumpPoll is stable in practice (no deps); including it would restart
    // the cadence needlessly on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, pollToken]);

  async function startRefresh() {
    if (refreshState.running) return;
    setRefreshState({ running: true, error: null });
    // Start polling immediately so backend progress.stage streams while the
    // awaited POST below runs (it resolves only at refresh completion).
    // No duplicate refresh can start: the button disables, the backend
    // serializes on its refresh lock (409), and the POST is never retried.
    bumpPoll();
    try {
      const summary = await api.refresh({}, { timeoutMs: REFRESH_POST_TIMEOUT_MS });
      setRefreshState({ running: false, error: null });
      bumpPoll();
      // The success notice lives in App state (outside the remounted <main>),
      // otherwise the data remount below would wipe it instantly.
      onRefreshed?.(summary);
    } catch (refreshError) {
      const failedNote =
        refreshError?.code === 'REFRESH_IN_PROGRESS'
          ? 'A refresh is already running — no duplicate was started.'
          : 'The previous valid dataset remains available.';
      setRefreshState({ running: false, error: `${refreshError?.message ?? 'Refresh failed.'} ${failedNote}` });
      bumpPoll();
    }
  }

  const lastRunFailed = data?.lastRun?.status === 'failed' || data?.latestRuns?.[0]?.status === 'failed';
  // Public UI must never offer an action that predictably fails: when the
  // backend requires an admin token, manual refresh is administrators-only.
  const refreshOpen = data ? !data.refreshRequiresAuth : false;

  return (
    <Section
      id="data-status"
      title="Data status & refresh"
      subtitle="Persistent World Bank cache, freshness, and refresh controls."
      aside={
        refreshOpen ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={startRefresh}
            disabled={refreshState.running || inProgress}
          >
            {refreshState.running || inProgress ? 'Refreshing…' : 'Refresh now'}
          </button>
        ) : null
      }
    >
      <StatusBlock loading={loading && !slowLoad} error={error} empty={false} onRetry={retry} sectionName="data status" />
      {loading && slowLoad && !error ? (
        <div className="status status-loading" role="status">
          <p>
            Still loading data status — the API is taking longer than expected
            (it may be warming up after a cold start). You can wait or try again;
            no data has been changed.
          </p>
          <button type="button" className="btn btn-secondary" onClick={retryWhileLoading}>
            Retry now
          </button>
        </div>
      ) : null}
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
            <div>
              <dt>Manual refresh</dt>
              <dd>
                {data.refreshRequiresAuth
                  ? 'Restricted to administrators — the cache refreshes automatically when stale.'
                  : 'Open in this environment.'}
              </dd>
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
