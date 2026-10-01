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
 *
 * Phase 8E persistent refresh: the Refresh section ALWAYS EXISTS once data
 * exists. Distinct state concepts (initialLoading vs polling vs
 * refreshRunning) keep content visible: polling updates the existing UI in
 * place and never swaps the card to "Loading...". The completed indicator
 * checklist is resolved live (in-memory ledger during a run) or persisted
 * (fetch_runs progress_summary across remount/reload), so TTL re-entry,
 * navigation, and page reload all recover the same section.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import {
  formatDurationMs,
  formatDurationMsValue,
  formatUtcDateTime,
  formatUtcDateTimeSeconds,
  formatVintageDate,
} from '../utils/format.js';
import { Section, StatusBlock } from '../components/ui.jsx';

/** Full refreshes stream dozens of indicator payloads; bound the POST at 10 min. */
const REFRESH_POST_TIMEOUT_MS = 10 * 60 * 1000;
/** Status reads stay tolerant of cold starts, but never unbounded. */
const STATUS_TIMEOUT_MS = 45000;
/** After this long with no status response, say so instead of spinning quietly. */
const SLOW_LOAD_HINT_MS = 10000;
/** Status poll cadence while a refresh is running. */
const PROGRESS_POLL_MS = 2000;
/**
 * Cold-start window (R-02b): a status failure with no HTTP response at all
 * (connection refused / timeout while Render wakes) is treated as "starting",
 * not "dead". Auto-retry stays inside this window; a failure that persists
 * past it falls back to the explicit red error with manual retry.
 * Matches the years-bootstrap tolerance (120 s).
 */
const CONNECT_RETRY_WINDOW_MS = 120000;
/** Controlled auto-retry cadence inside the cold-start window (no storm). */
const CONNECT_RETRY_DELAYS_MS = [3000, 5000, 10000, 15000, 30000];

/** True when the backend never answered at all (cold start), as opposed to an HTTP error it returned. */
function isConnectivityError(error) {
  return Boolean(error) && !error.status && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
}

/**
 * Phase 8G: the backend answers liveness but is still initializing
 * (HTTP 503 DATA_SERVICE_STARTING). Like a refused connection this is a
 * normal readiness delay — never a red failure — so it shares the neutral
 * "starting" presentation and the controlled auto-retry window.
 */
function isBackendStarting(error) {
  return Boolean(error) && error.status === 503 && error.code === 'DATA_SERVICE_STARTING';
}

function ageText(ageHours) {
  if (ageHours === null || ageHours === undefined) return 'unknown';
  if (ageHours < 1) return `${Math.round(ageHours * 60)} min ago`;
  if (ageHours < 48) return `${Math.round(ageHours)} h ago`;
  return `${(ageHours / 24).toFixed(1)} days ago`;
}

/**
 * Phase 8F: database target comes from the backend's safe logical label
 * ("Turso (production)" / "Local SQLite" / "Local SQLite (production
 * fallback)") — the public page never sees hostnames, URLs, or secrets.
 * The legacy mode/file derivation stays as a fallback for mixed-version
 * payloads during rolling deploys.
 */
function databaseLabel(database) {
  if (!database || typeof database !== 'object') return '—';
  if (typeof database.label === 'string' && database.label.trim() !== '') {
    return `● ${database.label}`;
  }
  if (database.mode === 'turso') return '● Turso (production)';
  if (database.mode === 'local') return '● Local SQLite';
  return '—';
}

export default function DataStatus({ onRefreshed }) {
  const [refreshState, setRefreshState] = useState({ running: false, error: null });
  const [pollToken, setPollToken] = useState(0);
  // Slow-first-load hint (R-02): independent of the fetch itself, so a hung
  // request still explains itself instead of spinning silently forever.
  const [slowLoad, setSlowLoad] = useState(false);
  // Phase 8F: refresh-details disclosure is presentation only (never stored
  // in the database). It opens automatically when a run starts so live
  // progress is visible, and stays user-controlled otherwise.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const wasPollingRef = useRef(false);
  const { data, loading, error, retry } = useApi(
    (signal) => api.dataStatus({ signal, timeoutMs: STATUS_TIMEOUT_MS }),
    `datastatus:${pollToken}`,
  );
  // Cold-start retry state: attempts + first-failure timestamp for
  // connectivity errors only. HTTP errors (backend answered) bypass this and
  // render red immediately. `expired` flips the panel from the neutral
  // "starting" state to the explicit error once the window passes.
  const connectStartRef = useRef(null);
  const connectAttemptsRef = useRef(0);
  const [connectExpired, setConnectExpired] = useState(false);
  const connectivityFailure = isConnectivityError(error);
  const backendStarting = isBackendStarting(error);
  const startingFailure = Boolean(connectivityFailure || backendStarting);
  const showStarting = Boolean(startingFailure && !connectExpired);

  const resetConnectRetry = () => {
    connectStartRef.current = null;
    connectAttemptsRef.current = 0;
    setConnectExpired(false);
  };

  // Bump the status poll and clear a stale slow-load hint. All pollToken
  // changes flow through here so the warming hint always restarts cleanly.
  // Called only from event/async contexts (never synchronously in an effect).
  const bumpPoll = () => {
    setSlowLoad(false);
    resetConnectRetry();
    setPollToken((t) => t + 1);
  };
  const retryWhileLoading = () => {
    setSlowLoad(false);
    retry();
  };
  // Manual retry from the starting/error panels restarts the backoff cleanly.
  const retryConnectivity = () => {
    resetConnectRetry();
    retry();
  };
  const inProgress = Boolean(data?.inProgress);
  // Poll while the backend is refreshing OR while our own manual POST is in
  // flight (R-07): the POST resolves only when the whole refresh completes,
  // so gating on `inProgress` alone would show no progress until the end.
  const polling = inProgress || refreshState.running;
  // Auto-open the details disclosure when a run starts (stays user-controlled
  // afterwards; presentation only, never stored in the database).
  useEffect(() => {
    if (polling && !wasPollingRef.current) setDetailsOpen(true);
    wasPollingRef.current = polling;
  }, [polling]);

  // Phase 8E flicker fix: distinct loading concepts. `initialLoading` covers
  // only the very first fetch (no data yet). Once usable data exists it stays
  // mounted: polls update it in place, and poll failures keep the last
  // known-good payload with a non-destructive warning.
  const hasData = data !== null && data !== undefined;
  const initialLoading = Boolean(loading && !hasData);
  const pollWarning = Boolean(hasData && error && !showStarting);

  // Live progress ledger (in-memory, during a run) vs persisted terminal
  // summary (fetch_runs progress_summary, survives remount/reload).
  const liveSteps = Array.isArray(data?.progress?.steps) ? data.progress.steps : [];
  const liveKeys = Array.isArray(data?.progress?.metricKeys) ? data.progress.metricKeys : [];
  const liveLabels =
    data?.progress?.labels && typeof data.progress.labels === 'object' ? data.progress.labels : {};
  const liveStage = typeof data?.progress?.stage === 'string' ? data.progress.stage : null;
  const liveTerminal = ['complete', 'partial', 'failed'].includes(liveStage);
  const persistedSummary =
    data?.lastRefresh?.summary && typeof data.lastRefresh.summary === 'object'
      ? data.lastRefresh.summary
      : null;
  const persistedKeys = Array.isArray(persistedSummary?.metricKeys) ? persistedSummary.metricKeys : [];
  // Prefer live while a run is active or when it holds the only terminal
  // record; otherwise the persisted snapshot (identical content, durable).
  const useLive =
    liveKeys.length > 0 && (polling || liveTerminal || persistedKeys.length === 0);
  const activeKeys = useLive ? liveKeys : persistedKeys;
  const activeLabels = useLive
    ? liveLabels
    : persistedSummary?.labels && typeof persistedSummary.labels === 'object'
      ? persistedSummary.labels
      : {};
  const activeStepByKey = new Map(
    (useLive ? liveSteps : Array.isArray(persistedSummary?.steps) ? persistedSummary.steps : []).map((s) => [
      s.metricKey,
      s,
    ]),
  );
  const labelOf = (metricKey) =>
    activeStepByKey.get(metricKey)?.label ?? activeLabels[metricKey] ?? metricKey;
  const runningKey = (() => {
    if (!polling || !useLive) return null;
    return typeof liveStage === 'string' && liveStage.startsWith('indicator:')
      ? liveStage.slice('indicator:'.length)
      : null;
  })();
  const doneCount = activeKeys.filter((k) =>
    ['published', 'unchanged', 'failed'].includes(activeStepByKey.get(k)?.status),
  ).length;
  // The Refresh section always exists once data exists (even with zero known
  // indicators it renders the header + empty note instead of unmounting).
  const showRefreshPanel = hasData;
  const refreshTerminalLive = useLive && liveTerminal;
  const refreshTerminalPersisted = !useLive && persistedSummary !== null;
  const refreshCompletedOk =
    (useLive && liveStage === 'complete' && data?.progress?.summary?.status === 'success') ||
    (!useLive && persistedSummary?.status === 'success');
  const refreshRolledBack =
    (useLive && (liveStage === 'partial' || liveStage === 'failed')) ||
    (!useLive && (persistedSummary?.status === 'partial' || persistedSummary?.status === 'failed'));

  // Resolved refresh timestamps (UTC ISO from the backend; never fabricated).
  const refreshStartedAt =
    (useLive ? data?.progress?.startedAt : null) ?? data?.lastRefresh?.startedAt ?? null;
  const refreshCompletedAt = !useLive
    ? data?.lastRefresh?.completedAt ?? null
    : (() => {
        if (liveTerminal) {
          const atTimes = liveSteps.map((s) => s?.at).filter(Boolean);
          return atTimes.length > 0 ? atTimes.sort()[atTimes.length - 1] : null;
        }
        return null;
      })();
  const refreshDurationText = (() => {
    if (!useLive && data?.lastRefresh?.durationMs !== null && data?.lastRefresh?.durationMs !== undefined) {
      return formatDurationMsValue(data.lastRefresh.durationMs);
    }
    if (refreshStartedAt && refreshCompletedAt) return formatDurationMs(refreshStartedAt, refreshCompletedAt);
    return '—';
  })();

  // Live elapsed ticker (running refresh only; 1 s cadence, display only).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!polling || !refreshStartedAt) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [polling, refreshStartedAt]);
  const refreshElapsedText =
    polling && refreshStartedAt ? formatDurationMsValue(Math.max(0, nowMs - new Date(refreshStartedAt).getTime())) : null;

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

  // Cold-start auto-retry: while the backend never answers (Render waking)
  // or answers "still starting" (listen-first readiness), retry on a
  // controlled backoff inside CONNECT_RETRY_WINDOW_MS. The timer belongs to
  // this effect only (single outstanding retry); success, polling bumps and
  // unmount clear it via cleanup. Past the window, mark expired so the
  // explicit red error renders instead of retrying forever.
  useEffect(() => {
    if (!startingFailure || data) {
      if (data) resetConnectRetry();
      return undefined;
    }
    if (connectStartRef.current === null) connectStartRef.current = Date.now();
    const elapsed = Date.now() - connectStartRef.current;
    if (elapsed >= CONNECT_RETRY_WINDOW_MS) {
      setConnectExpired(true);
      return undefined;
    }
    const attempt = connectAttemptsRef.current;
    const delay = CONNECT_RETRY_DELAYS_MS[Math.min(attempt, CONNECT_RETRY_DELAYS_MS.length - 1)];
    const timer = setTimeout(() => {
      connectAttemptsRef.current += 1;
      retry();
    }, delay);
    return () => clearTimeout(timer);
    // retry is stable (useCallback []); error identity changes per attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingFailure, error, data, pollToken]);

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
      <StatusBlock
        loading={initialLoading && !slowLoad && !showStarting}
        error={showStarting ? null : hasData ? null : error}
        empty={false}
        onRetry={retry}
        sectionName="data status"
      />
      {pollWarning ? (
        <p className="status status-warning" role="status">
          Status update failed ({error?.message ?? 'unknown error'}) — showing the last known data.
          <button type="button" className="btn btn-secondary" onClick={retry}>
            Retry now
          </button>
        </p>
      ) : null}
      {loading && hasData && !showStarting ? (
        <p className="status-polling" role="status" aria-live="off">
          Updating…
        </p>
      ) : null}
      {showStarting ? (
        <div className="status status-loading" role="status">
          <p>
            Starting the data service — connecting now. This may take a little longer after a period
            of inactivity. No data has been changed; this view continues automatically.
          </p>
          <button type="button" className="btn btn-secondary" onClick={retryConnectivity}>
            Retry now
          </button>
        </div>
      ) : null}
      {initialLoading && slowLoad && !error ? (
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
      {hasData ? (
        <>
          <h3>Data status</h3>
          <dl className="facts facts-grid">
            <div>
              <dt>Dataset</dt>
              <dd>
                {data.empty ? 'Empty — no observations stored' : `${data.observations} observations stored`}
                {data.fresh ? ' (fresh)' : ' (stale)'}
              </dd>
            </div>
            <div>
              <dt>World Bank data vintage</dt>
              <dd>{data.wbLastUpdated ? (formatVintageDate(data.wbLastUpdated) ?? data.wbLastUpdated) : '—'}</dd>
            </div>
            <div>
              <dt>Data retrieved UTC</dt>
              <dd>{data.lastSuccessAt ? (formatUtcDateTime(data.lastSuccessAt) ?? data.lastSuccessAt) : '—'}</dd>
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
            <div>
              <dt>Database</dt>
              <dd>{databaseLabel(data.database)}</dd>
            </div>
          </dl>

          {refreshState.running || inProgress ? (
            <p className="status status-loading" role="status">
              Refresh in progress{data.progress?.stage ? ` — ${data.progress.stage}` : ''}. Current data remain
              available below; duplicate refreshes are blocked.
            </p>
          ) : null}
          {showRefreshPanel ? (
            <div className="refresh-progress" aria-live="polite">
              <h3>Refresh</h3>
              {polling ? (
                <p>
                  Refresh in progress
                  {refreshStartedAt ? (
                    <>
                      <br />
                      Started: {formatUtcDateTimeSeconds(refreshStartedAt) ?? refreshStartedAt}
                    </>
                  ) : null}
                  {refreshElapsedText ? (
                    <>
                      <br />
                      Elapsed: {refreshElapsedText}
                    </>
                  ) : null}
                </p>
              ) : refreshCompletedOk ? (
                <p className="status status-ok" role="status">
                  Last refresh completed successfully
                </p>
              ) : refreshRolledBack ? (
                <p className="status status-error" role="alert">
                  Refresh did not publish: rolled back — the previous valid dataset remains available.
                </p>
              ) : (
                <p>No refresh recorded yet.</p>
              )}
              <p className="refresh-count">
                Progress: {doneCount} / {activeKeys.length} indicators
              </p>
              <progress value={doneCount} max={Math.max(activeKeys.length, 1)}>
                {doneCount} / {activeKeys.length}
              </progress>
              {polling && runningKey ? <p className="refresh-current">Current: {labelOf(runningKey)}</p> : null}
              <details
                className="refresh-details"
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.target.open)}
              >
                <summary>{detailsOpen ? 'Hide refresh details ▲' : 'Show refresh details ▼'}</summary>
                {activeKeys.length > 0 ? (
                  <ul className="checklist">
                    {activeKeys.map((metricKey) => {
                      const step = activeStepByKey.get(metricKey);
                      const label = labelOf(metricKey);
                      if (step?.status === 'published') {
                        return (
                          <li key={metricKey} className="step step-done">
                            <span className="step-icon" aria-hidden="true">
                              ✓
                            </span>
                            <span className="step-label">{label}</span>
                            <span className="step-state">updated</span>
                          </li>
                        );
                      }
                      if (step?.status === 'unchanged') {
                        return (
                          <li key={metricKey} className="step step-done">
                            <span className="step-icon" aria-hidden="true">
                              ✓
                            </span>
                            <span className="step-label">{label}</span>
                            <span className="step-state">up to date</span>
                          </li>
                        );
                      }
                      if (step?.status === 'failed') {
                        return (
                          <li key={metricKey} className="step step-failed">
                            <span className="step-icon" aria-hidden="true">
                              ✗
                            </span>
                            <span className="step-label">{label}</span>
                            <span className="step-state">failed{step.error ? `: ${step.error}` : ''}</span>
                          </li>
                        );
                      }
                      if (polling && runningKey === metricKey) {
                        return (
                          <li key={metricKey} className="step step-active">
                            <span className="step-icon" aria-hidden="true">
                              →
                            </span>
                            <span className="step-label">{label}</span>
                            <span className="step-state">refreshing</span>
                          </li>
                        );
                      }
                      return (
                        <li key={metricKey} className="step step-waiting">
                          <span className="step-icon" aria-hidden="true">
                            □
                          </span>
                          <span className="step-label">{label}</span>
                          <span className="step-state">waiting</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {!polling && (refreshTerminalLive || refreshTerminalPersisted) ? (
                  <dl className="facts facts-grid refresh-times">
                    <div>
                      <dt>Started UTC</dt>
                      <dd>{refreshStartedAt ? (formatUtcDateTimeSeconds(refreshStartedAt) ?? refreshStartedAt) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Completed UTC</dt>
                      <dd>
                        {refreshCompletedAt ? (formatUtcDateTimeSeconds(refreshCompletedAt) ?? refreshCompletedAt) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{refreshDurationText}</dd>
                    </div>
                  </dl>
                ) : null}
              </details>
            </div>
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
                      <th scope="col">Started UTC</th>
                      <th scope="col">Completed UTC</th>
                      <th scope="col">Duration</th>
                      <th scope="col" className="num">
                        Retrieved
                      </th>
                      <th scope="col" className="num">
                        Upserted
                      </th>
                      <th scope="col" className="num">
                        Skipped
                      </th>
                      <th scope="col" className="num">
                        Updated
                      </th>
                      <th scope="col" className="num">
                        Unchanged
                      </th>
                      <th scope="col">Error</th>
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
                        <td>{run.started_at ? (formatUtcDateTimeSeconds(run.started_at) ?? run.started_at) : '—'}</td>
                        <td>
                          {run.completed_at ? (formatUtcDateTimeSeconds(run.completed_at) ?? run.completed_at) : '—'}
                        </td>
                        <td>
                          {run.duration_ms !== null && run.duration_ms !== undefined
                            ? formatDurationMsValue(run.duration_ms)
                            : formatDurationMs(run.started_at, run.completed_at)}
                        </td>
                        <td className="num">{run.rows_retrieved ?? '—'}</td>
                        <td className="num">{run.rows_upserted ?? '—'}</td>
                        <td className="num">{run.rows_skipped_unchanged ?? '—'}</td>
                        <td className="num">{run.summary_counts?.updated ?? '—'}</td>
                        <td className="num">{run.summary_counts?.unchanged ?? '—'}</td>
                        <td>{run.error_message ?? '—'}</td>
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
