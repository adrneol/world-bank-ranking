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
import { BootstrapStillConnecting } from '../components/BootstrapStatus.jsx';
import IndicatorMonitor from '../components/IndicatorMonitor.jsx';
import RefreshHistory from '../components/RefreshHistory.jsx';
import { Section, StatusBlock } from '../components/ui.jsx';

/** Full refreshes stream dozens of indicator payloads; bound the POST at 10 min. */
const REFRESH_POST_TIMEOUT_MS = 10 * 60 * 1000;
/** Status reads stay tolerant of cold starts, but never unbounded. */
const STATUS_TIMEOUT_MS = 12000;
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
    (signal) => api.dataStatus({ signal, timeoutMs: STATUS_TIMEOUT_MS, recover: true }),
    `datastatus:${pollToken}`,
  );
  const bumpPoll = () => setPollToken(t => t + 1);
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
  const pollWarning = Boolean(hasData && error);

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
    activeStepByKey.get(metricKey)?.label ?? activeLabels[metricKey];
  const runningKey = (() => {
    if (!polling || !useLive) return null;
    return typeof liveStage === 'string' && liveStage.startsWith('indicator:')
      ? liveStage.slice('indicator:'.length)
      : null;
  })();
  const doneCount = activeKeys.filter((k) =>
    ['published', 'unchanged', 'failed'].includes(activeStepByKey.get(k)?.status),
  ).length;
  // Terminal outcome of the last completed run: checked / changed / unchanged /
  // failed. "checked" is deliberately NOT "changed": a successful check can
  // prove every value identical without writing anything. The backend sends
  // the normalized shape; the persisted summary counts are the fallback.
  const outcomeCounts =
    data?.refreshOutcome && typeof data.refreshOutcome === 'object'
      ? data.refreshOutcome
      : persistedSummary?.counts && typeof persistedSummary.counts === 'object'
        ? persistedSummary.counts
        : null;
  const refreshOutcomeText = (() => {
    if (!outcomeCounts) return null;
    const total = outcomeCounts.total ?? null;
    const notAttempted = outcomeCounts.notAttempted ?? 0;
    const checked =
      outcomeCounts.checked ?? (total !== null ? Math.max(0, total - notAttempted) : null);
    const parts = [];
    if (checked !== null && checked !== undefined) parts.push(`${checked} checked`);
    if (outcomeCounts.updated !== undefined) parts.push(`${outcomeCounts.updated} changed`);
    if (outcomeCounts.unchanged !== undefined) parts.push(`${outcomeCounts.unchanged} unchanged`);
    if (outcomeCounts.failed !== undefined) parts.push(`${outcomeCounts.failed} failed`);
    return parts.length > 0 ? parts.join(' · ') : null;
  })();
  // The Refresh section always exists once data exists (even with zero known
  // indicators it renders the header + empty note instead of unmounting).
  const showRefreshPanel = hasData;
  const refreshTerminalLive = useLive && liveTerminal;
  const refreshTerminalPersisted = !useLive && persistedSummary !== null;
  const refreshCompletedOk =
    (useLive && liveStage === 'complete' && data?.progress?.summary?.status === 'success') ||
    (!useLive && (persistedSummary?.status ?? data?.lastRefresh?.status) === 'success');
  const refreshRolledBack =
    (useLive && (liveStage === 'partial' || liveStage === 'failed')) ||
    (!useLive && ['partial', 'failed'].includes(persistedSummary?.status ?? data?.lastRefresh?.status));
  // Phase 8N: background database recovery is infrastructure state, not a
  // user refresh. While fallback serves and the ledger/snapshot belongs to a
  // recovery run, show one calm line instead of the 20-indicator checklist,
  // progress bar, and rollback alert. Manual refreshes reset the ledger with
  // their own trigger, so they always render the full UI below.
  const activeTrigger = useLive ? (data?.progress?.trigger ?? null) : (persistedSummary?.trigger ?? null);
  const fallbackActive = data?.database?.fallback === true;
  const showRecoveryCalm =
    activeTrigger === 'recovery' && fallbackActive && !refreshState.running;

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
    setSlowLoad(false);
    const timer = setTimeout(() => setSlowLoad(true), SLOW_LOAD_HINT_MS);
    return () => clearTimeout(timer);
  }, [loading, pollToken]);

  useEffect(() => {
    if (!polling || loading || (error && !refreshState.running)) return undefined;
    const timer = setTimeout(() => bumpPoll(), PROGRESS_POLL_MS);
    return () => clearTimeout(timer);
    // bumpPoll is stable in practice (no deps); including it would restart
    // the cadence needlessly on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, loading, error, pollToken, refreshState.running]);

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
        loading={initialLoading && !slowLoad}
        error={hasData ? null : error}
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
      {loading && hasData ? (
        <p className="status-polling" role="status" aria-live="off">
          Updating…
        </p>
      ) : null}
      {initialLoading && slowLoad ? <BootstrapStillConnecting onRetry={retry} /> : null}
      {hasData ? (
        <>
          <h3>Current dataset</h3>
          <dl className="facts facts-grid">
            <div><dt>Latest published economy year</dt><dd>{data.years?.maxYear??'Not reported'}</dd></div>
            <div><dt>Published content generation</dt><dd>{data.generation?.contentVersion!=null ? `v${data.generation.contentVersion}`:'Not reported'}</dd></div>
            <div><dt>Last refresh attempt (UTC)</dt><dd>{(data.lastRun?.completed_at??data.lastRun?.started_at) ? formatUtcDateTime(data.lastRun.completed_at??data.lastRun.started_at) : 'Not reported'}{data.lastRun?.status ? ` · ${data.lastRun.status}`:''}</dd></div>
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
              <dt>Last successful World Bank check (UTC)</dt>
              <dd>
                {data.lastSuccessAt ? (formatUtcDateTime(data.lastSuccessAt) ?? data.lastSuccessAt) : '—'}
                <span className="muted"> (the source was checked; the check may have found no changes)</span>
              </dd>
            </div>
            <div>
              <dt>Last data write (UTC)</dt>
              <dd>
                {data.lastDataChangeAt
                  ? (formatUtcDateTime(data.lastDataChangeAt) ?? data.lastDataChangeAt)
                  : '—'}
                <span className="muted">
                  {' '}
                  (observation values were last written; a metadata-only provenance update does not
                  move this)
                </span>
              </dd>
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
              <dt>Serving database</dt>
              <dd>{databaseLabel(data.database)}</dd>
            </div>
          </dl>

          {showRecoveryCalm ? (
            <p className="status status-loading" role="status">
              Using backup database while the primary recovers. Current data remain available below.
            </p>
          ) : refreshState.running || inProgress ? (
            <p className="status status-loading" role="status">
              Refresh in progress{data.progress?.stage ? ` — ${data.progress.stage}` : ''}. Current data remain
              available below; duplicate refreshes are blocked.
            </p>
          ) : null}
          {showRefreshPanel ? (
            <div className="refresh-progress" aria-live="polite">
              <h3>Latest refresh</h3>
              {showRecoveryCalm ? (
                <p>
                  Using backup database while the primary recovers.
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
              ) : polling ? (
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
                <p className="refresh-outcome" role="status">
                  Last refresh completed successfully
                </p>
              ) : refreshRolledBack ? (
                <p className="status status-error" role="alert">
                  Refresh did not publish: rolled back — the previous valid dataset remains available.
                </p>
              ) : data.lastRefresh ? (
                <p>Latest run outcome unavailable.</p>
              ) : (
                <p>No refresh recorded yet.</p>
              )}
              {!showRecoveryCalm ? (
                <>
                  {polling || !refreshOutcomeText ? <p className="refresh-count">
                    Indicators checked: {doneCount} / {activeKeys.length}
                  </p> : null}
                  {polling && activeKeys.length ? <progress aria-label="Indicator checks completed" value={doneCount} max={activeKeys.length}>
                    {doneCount} / {activeKeys.length}
                  </progress> : null}
                  {refreshOutcomeText ? (
                    <p className="refresh-count">Last run: {refreshOutcomeText}</p>
                  ) : null}
                  {polling && runningKey ? <p className="refresh-current">Current: {labelOf(runningKey) ?? runningKey}</p> : null}
                </>
              ) : null}
              {!showRecoveryCalm && !polling && (refreshTerminalLive || refreshTerminalPersisted) ? (
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
              {!showRecoveryCalm ? (
              <details
                className="refresh-details"
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.target.open)}
              >
                <summary>Indicator results and timestamps</summary>
                <IndicatorMonitor keys={activeKeys} steps={activeStepByKey} labelOf={labelOf} polling={polling} runningKey={runningKey}
                  latestYears={data.years?.perMetric}
                  publication={refreshCompletedOk ? 'completed' : refreshRolledBack ? 'not-published' : 'pending'} />
              </details>
              ) : null}
            </div>
          ) : null}
          {refreshState.error ? (
            <p className="status status-error" role="alert">
              {refreshState.error}
            </p>
          ) : null}
          {!refreshState.error && lastRunFailed && !inProgress && !showRecoveryCalm ? (
            <p className="status status-error" role="alert">
              The most recent refresh run failed. The previous valid dataset remains available.
            </p>
          ) : null}

          <RefreshHistory runs={data.latestRuns} />
        </>
      ) : null}
    </Section>
  );
}
