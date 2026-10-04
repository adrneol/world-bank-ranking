/**
 * REFRESH PROGRESS CHECKLIST TESTS (Phase 8B ledger, Phase 8E persistence).
 *
 * The persistent Refresh section always exists once data exists: live
 * per-indicator execution progress from the backend's in-memory ledger (no
 * extra requests) during a run, the persisted fetch_runs summary across
 * remount/reload after completion — running/waiting ticks,
 * unchanged-vs-published distinction, failure states with rollback note,
 * progress count/bar, UTC timestamps + duration, database target, and the
 * enriched Recent runs history. Polling must never blank mounted content.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import DataStatus from './DataStatus.jsx';

const BASE = {
  empty: false,
  observations: 228776,
  fresh: false,
  lastSuccessAt: '2026-09-28T00:25:14.000Z',
  wbLastUpdated: '2026-07-13',
  ageHours: 30,
  ttlHours: 24,
  refreshDue: true,
  lock: { locked: true },
  integrity: { passed: true, checks: [] },
  autoRefresh: { enabled: true },
  refreshRequiresAuth: true,
  lastRun: { status: 'running' },
  latestRuns: [],
  years: { years: [2024, 2025], minYear: 2024, maxYear: 2025, perMetric: {} },
};

const KEYS = ['nominal_current', 'nominal_constant', 'fdi_inflows'];
const step = (metricKey, status, extra = {}) => ({
  metricKey,
  label: `Label ${metricKey}`,
  status,
  at: '2026-09-30T12:00:00.000Z',
  ...extra,
});
const LABELS = { nominal_current: 'Label nominal_current', nominal_constant: 'Label nominal_constant', fdi_inflows: 'Label fdi_inflows' };

function renderSection(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('refresh progress checklist', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('shows running/waiting rows, count and bar while refreshing', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: true,
          progress: {
            stage: 'indicator:nominal_constant',
            startedAt: '2026-10-01T13:17:02.000Z',
            metricKeys: KEYS,
            labels: LABELS,
            steps: [step('nominal_current', 'unchanged')],
          },
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Refresh in progress');
    expect(container.textContent).toContain('Started: 1 October 2026, 13:17:02 UTC');
    expect(container.textContent).toContain('Progress: 1 / 3 indicators');
    expect(container.textContent).toContain('Current: Label nominal_constant');
    expect(container.textContent).toContain('Label nominal_current');
    expect(container.textContent).toContain('up to date');
    expect(container.textContent).toContain('refreshing');
    expect(container.textContent).toContain('waiting');
    expect(container.querySelectorAll('.step-done')).toHaveLength(1);
    expect(container.querySelectorAll('.step-active')).toHaveLength(1);
    expect(container.querySelectorAll('.step-waiting')).toHaveLength(1);
    // Live runs auto-open the details disclosure.
    expect(container.querySelector('details.refresh-details').open).toBe(true);
    expect(container.querySelector('progress').getAttribute('value')).toBe('1');
    expect(container.querySelector('progress').getAttribute('max')).toBe('3');
    cleanup();
  });

  it('distinguishes published rows from unchanged rows', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: true,
          progress: {
            stage: 'indicator:fdi_inflows',
            metricKeys: KEYS,
            labels: LABELS,
            steps: [step('nominal_current', 'published', { rows: 10 }), step('nominal_constant', 'unchanged')],
          },
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Label nominal_current');
    expect(container.textContent).toContain('updated');
    expect(container.textContent).toContain('Label nominal_constant');
    expect(container.textContent).toContain('up to date');
    expect(container.querySelectorAll('.step-done')).toHaveLength(2);
    cleanup();
  });

  it('shows failed rows with the rollback note and keeps run history', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          progress: {
            stage: 'partial',
            metricKeys: KEYS,
            labels: LABELS,
            steps: [
              step('nominal_current', 'unchanged'),
              step('nominal_constant', 'failed', { error: 'boom' }),
            ],
          },
          latestRuns: [{ id: 9, status: 'partial', trigger: 'ttl', rows_upserted: 0, completed_at: '2026-09-30T12:00:00.000Z' }],
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Label nominal_constant');
    expect(container.textContent).toContain('failed: boom');
    expect(container.textContent).toContain('waiting');
    expect(container.querySelectorAll('.step-failed')).toHaveLength(1);
    expect(container.textContent).toContain('rolled back — the previous valid dataset remains available');
    expect(container.textContent).toContain('Recent refresh runs (1)');
    cleanup();
  });

  it('collapses terminal details by default and expands on demand', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          progress: { stage: 'complete', metricKeys: KEYS, steps: KEYS.map((k) => step(k, 'unchanged')), summary: { status: 'success' } },
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    const details = container.querySelector('details.refresh-details');
    expect(details.open).toBe(false);
    expect(container.textContent).toContain('Show refresh details');
    expect(container.textContent).toContain('Last refresh completed successfully');
    expect(container.textContent).toContain('Progress: 3 / 3 indicators');
    // Disclosure is presentation only: expanding reveals all indicators.
    await act(async () => {
      details.querySelector('summary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(container.querySelectorAll('.step-done')).toHaveLength(3);
    cleanup();
  });

  it('shows completion with UTC timestamps and duration', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          progress: { stage: 'complete', metricKeys: KEYS, steps: KEYS.map((k) => step(k, 'unchanged')), summary: { status: 'success' } },
        },
      ],
    ]);
    const done = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(done.container.textContent).toContain('Last refresh completed successfully');
    expect(done.container.textContent).toContain('Progress: 3 / 3 indicators');
    done.cleanup();
    document.body.innerHTML = '';

    stub.restore();
    // Phase 8E persistence: without live progress the persisted fetch_runs
    // summary keeps the same section mounted (never blank).
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          progress: null,
          lastRefresh: {
            runId: 12,
            status: 'success',
            trigger: 'ttl',
            startedAt: '2026-10-01T13:17:02.000Z',
            completedAt: '2026-10-01T13:17:16.000Z',
            durationMs: 14000,
            summary: {
              status: 'success',
              metricKeys: KEYS,
              labels: LABELS,
              steps: KEYS.map((k) => step(k, 'unchanged')),
              counts: { total: 3, updated: 0, unchanged: 3, failed: 0, notAttempted: 0 },
            },
          },
        },
      ],
    ]);
    const plain = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(plain.container.textContent).toContain('Refresh');
    expect(plain.container.textContent).toContain('Last refresh completed successfully');
    expect(plain.container.textContent).toContain('Started UTC');
    expect(plain.container.textContent).toContain('1 October 2026, 13:17:02 UTC');
    expect(plain.container.textContent).toContain('1 October 2026, 13:17:16 UTC');
    expect(plain.container.textContent).toContain('Label nominal_current');
    expect(plain.container.textContent).toContain('up to date');
    expect(plain.container.querySelectorAll('.step-done')).toHaveLength(3);
    plain.cleanup();
  });

  it('keeps mounted content visible while a poll is in flight (no flicker)', async () => {
    const idlePayload = {
      ...BASE,
      refreshRequiresAuth: false,
      inProgress: false,
      progress: null,
      lastRefresh: {
        runId: 12,
        status: 'success',
        trigger: 'ttl',
        startedAt: '2026-10-01T13:17:02.000Z',
        completedAt: '2026-10-01T13:17:16.000Z',
        durationMs: 14000,
        summary: {
          status: 'success',
          metricKeys: KEYS,
          labels: LABELS,
          steps: KEYS.map((k) => step(k, 'unchanged')),
          counts: { total: 3, updated: 0, unchanged: 3, failed: 0, notAttempted: 0 },
        },
      },
    };
    const pendingStatusResolvers = [];
    let statusCalls = 0;
    let releaseRefreshPost = null;
    stub = stubFetch([
      [
        '/api/data-status',
        () => {
          statusCalls += 1;
          if (statusCalls === 1) {
            return { ok: true, status: 200, headers: new Headers(), json: async () => idlePayload };
          }
          // Polls stay in flight so the test observes loading+data; every
          // pending poll is released before cleanup so nothing leaks.
          return new Promise((resolve) => {
            pendingStatusResolvers.push(() =>
              resolve({ ok: true, status: 200, headers: new Headers(), json: async () => idlePayload }),
            );
          });
        },
      ],
      [
        '/api/data/refresh',
        () =>
          new Promise((resolve) => {
            releaseRefreshPost = () =>
              resolve({
                ok: true,
                status: 200,
                headers: new Headers(),
                json: async () => ({ status: 'success', runId: 13, rowsUpserted: 0 }),
              });
          }),
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Last refresh completed successfully');
    const button = container.querySelector('button.btn-primary');
    expect(button).not.toBeNull();
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act, 2);
    // Poll in flight + POST in flight: previous content stays mounted (the
    // same section transitions to in-progress instead of blanking).
    expect(container.textContent).toContain('Refresh in progress');
    expect(container.textContent).toContain('Label nominal_current');
    expect(container.textContent).toContain('up to date');
    expect(container.textContent).toContain('Updating…');
    expect(container.textContent).not.toContain('Loading data status');
    releaseRefreshPost?.();
    await flushReact(act, 2);
    for (const release of pendingStatusResolvers.splice(0)) release();
    await flushReact(act);
    expect(container.textContent).toContain('Last refresh completed successfully');
    cleanup();
  });

  it('renders the enriched history with UTC timestamps and the database target', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          progress: null,
          database: { provider: 'sqlite', context: 'local', label: 'Local SQLite', fallback: false },
          lastRefresh: null,
          latestRuns: [
            {
              id: 12,
              status: 'success',
              trigger: 'ttl',
              started_at: '2026-10-01T13:17:02.000Z',
              completed_at: '2026-10-01T13:17:16.000Z',
              duration_ms: 14000,
              rows_retrieved: 100,
              rows_upserted: 0,
              rows_skipped_unchanged: 100,
              summary_counts: { total: 20, updated: 0, unchanged: 20, failed: 0, notAttempted: 0 },
              error_message: null,
            },
          ],
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('● Local SQLite');
    expect(container.textContent).toContain('Started UTC');
    expect(container.textContent).toContain('1 October 2026, 13:17:02 UTC');
    expect(container.textContent).toContain('1 October 2026, 13:17:16 UTC');
    expect(container.textContent).toContain('Recent refresh runs (1)');
    // No browser-local timestamp rendering anywhere in the section.
    expect(container.innerHTML).not.toContain('toLocaleString');
    cleanup();
  });

  it('shows a calm line instead of the checklist while background recovery runs', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: true,
          database: { provider: 'sqlite', context: 'production-fallback', label: 'Local SQLite (production fallback)', fallback: true },
          progress: {
            trigger: 'recovery',
            stage: 'indicator:nominal_constant',
            startedAt: '2026-10-01T13:17:02.000Z',
            metricKeys: KEYS,
            labels: LABELS,
            steps: [step('nominal_current', 'unchanged')],
          },
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Using backup database while the primary recovers.');
    expect(container.textContent).toContain('Current data remain available below.');
    // No per-indicator recovery progress for ordinary users.
    expect(container.querySelector('.checklist')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.textContent).not.toContain('Refresh did not publish');
    // The dataset itself stays rendered.
    expect(container.textContent).toContain('228776 observations stored');
    expect(container.textContent).toContain('● Local SQLite (production fallback)');
    cleanup();
  });

  it('hides the red banner for a failed background recovery run', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          database: { provider: 'sqlite', context: 'production-fallback', label: 'Local SQLite (production fallback)', fallback: true },
          progress: {
            trigger: 'recovery',
            stage: 'failed',
            startedAt: '2026-10-01T13:17:02.000Z',
            metricKeys: KEYS,
            labels: LABELS,
            steps: [step('nominal_current', 'failed', { error: 'boom' })],
          },
          lastRun: { status: 'failed', trigger: 'recovery' },
          latestRuns: [{ id: 13, status: 'failed', trigger: 'recovery', rows_upserted: 0, completed_at: '2026-10-01T13:17:16.000Z' }],
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Using backup database while the primary recovers.');
    expect(container.textContent).not.toContain('Refresh did not publish');
    expect(container.textContent).not.toContain('The most recent refresh run failed');
    expect(container.querySelector('.checklist')).toBeNull();
    // History still records the failed recovery run for diagnostics.
    expect(container.textContent).toContain('Recent refresh runs (1)');
    cleanup();
  });

  it('renders the normal panel once recovery promoted back to the primary', async () => {
    stub = stubFetch([
      [
        '/api/data-status',
        {
          ...BASE,
          inProgress: false,
          database: { provider: 'turso', context: 'production', label: 'Turso (production)', fallback: false },
          progress: null,
          lastRefresh: {
            runId: 14,
            status: 'success',
            trigger: 'recovery',
            startedAt: '2026-10-01T13:17:02.000Z',
            completedAt: '2026-10-01T13:17:16.000Z',
            durationMs: 14000,
            summary: {
              status: 'success',
              trigger: 'recovery',
              metricKeys: KEYS,
              labels: LABELS,
              steps: KEYS.map((k) => step(k, 'unchanged')),
              counts: { total: 3, updated: 0, unchanged: 3, failed: 0, notAttempted: 0 },
            },
          },
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).not.toContain('Using backup database while the primary recovers.');
    expect(container.textContent).toContain('Last refresh completed successfully');
    expect(container.textContent).toContain('● Turso (production)');
    cleanup();
  });

  it('shows safe production labels without hostnames for every target state', async () => {
    const cases = [
      [{ provider: 'turso', context: 'production', label: 'Turso (production)', fallback: false }, '● Turso (production)'],
      [{ provider: 'sqlite', context: 'local', label: 'Local SQLite', fallback: false }, '● Local SQLite'],
      [
        { provider: 'sqlite', context: 'production-fallback', label: 'Local SQLite (production fallback)', fallback: true },
        '● Local SQLite (production fallback)',
      ],
    ];
    for (const [database, expected] of cases) {
      stub = stubFetch([['/api/data-status', { ...BASE, database }]]);
      const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
      await flushReact(act);
      expect(container.textContent).toContain(expected);
      expect(container.innerHTML).not.toContain('turso.io');
      cleanup();
      document.body.innerHTML = '';
      stub.restore();
      stub = null;
    }
  });
});

describe('recent refresh runs display numbering (Phase 8Q)', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  // Internal persistent run ids (newest-first, as the backend serves them).
  const historyRun = (id, extra = {}) => ({
    id,
    status: 'success',
    trigger: 'manual',
    started_at: '2026-10-04T13:15:39.000Z',
    completed_at: '2026-10-04T13:15:55.000Z',
    rows_retrieved: 15900,
    rows_upserted: 0,
    rows_skipped_unchanged: 12817,
    ...extra,
  });

  // Visible Run-column labels, newest row first.
  const runNumbers = (container) =>
    [...container.querySelectorAll('tbody th[scope="row"]')].map((cell) => cell.textContent.trim());

  async function renderRuns(latestRuns, extra = {}) {
    stub = stubFetch([['/api/data-status', { ...BASE, inProgress: false, latestRuns, ...extra }]]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    return { container, cleanup };
  }

  it('numbers five visible runs 5 (newest) to 1 (oldest), never the internal ids', async () => {
    const { container, cleanup } = await renderRuns([30, 29, 28, 27, 26].map((id) => historyRun(id)));
    expect(container.textContent).toContain('Recent refresh runs (5)');
    expect(runNumbers(container)).toEqual(['#5', '#4', '#3', '#2', '#1']);
    expect(container.textContent).not.toContain('#30');
    expect(container.textContent).not.toContain('#26');
    cleanup();
  });

  it('numbers four visible runs 4 to 1', async () => {
    const { container, cleanup } = await renderRuns([41, 40, 39, 38].map((id) => historyRun(id)));
    expect(container.textContent).toContain('Recent refresh runs (4)');
    expect(runNumbers(container)).toEqual(['#4', '#3', '#2', '#1']);
    cleanup();
  });

  it('numbers three visible runs 3 to 1', async () => {
    const { container, cleanup } = await renderRuns([12, 11, 10].map((id) => historyRun(id)));
    expect(container.textContent).toContain('Recent refresh runs (3)');
    expect(runNumbers(container)).toEqual(['#3', '#2', '#1']);
    cleanup();
  });

  it('numbers a single visible run 1', async () => {
    const { container, cleanup } = await renderRuns([historyRun(7)]);
    expect(container.textContent).toContain('Recent refresh runs (1)');
    expect(runNumbers(container)).toEqual(['#1']);
    cleanup();
  });

  it('shifts positions when a new run enters and drops the oldest', async () => {
    const before = [30, 29, 28, 27, 26].map((id) => historyRun(id));
    const first = await renderRuns(before);
    expect(runNumbers(first.container)).toEqual(['#5', '#4', '#3', '#2', '#1']);
    first.cleanup();
    document.body.innerHTML = '';
    stub.restore();
    stub = null;
    const after = [31, 30, 29, 28, 27].map((id) => historyRun(id));
    const second = await renderRuns(after);
    expect(runNumbers(second.container)).toEqual(['#5', '#4', '#3', '#2', '#1']);
    expect(second.container.textContent).not.toContain('#26');
    second.cleanup();
  });

  it('leaves the internal run ids unchanged in the served data', async () => {
    const latestRuns = [30, 29, 28, 27, 26].map((id) => historyRun(id));
    const snapshot = JSON.stringify(latestRuns.map((run) => run.id));
    const { cleanup } = await renderRuns(latestRuns);
    expect(JSON.stringify(latestRuns.map((run) => run.id))).toBe(snapshot);
    expect(snapshot).toBe('[30,29,28,27,26]');
    cleanup();
  });

  it('uses the same numbering for Turso, local, and fallback targets', async () => {
    const databases = [
      { provider: 'turso', context: 'production', label: 'Turso (production)', fallback: false },
      { provider: 'sqlite', context: 'local', label: 'Local SQLite', fallback: false },
      {
        provider: 'sqlite',
        context: 'production-fallback',
        label: 'Local SQLite (production fallback)',
        fallback: true,
      },
    ];
    for (const database of databases) {
      const { container, cleanup } = await renderRuns([50, 49, 48].map((id) => historyRun(id)), { database });
      expect(runNumbers(container)).toEqual(['#3', '#2', '#1']);
      cleanup();
      document.body.innerHTML = '';
      stub.restore();
      stub = null;
    }
  });

  it('issues no mutating requests while rendering history', async () => {
    const methods = [];
    stub = stubFetch([
      [
        '/api/data-status',
        (href, options) => {
          methods.push(options?.method ?? 'GET');
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ ...BASE, inProgress: false, latestRuns: [30, 29].map((id) => historyRun(id)) }),
          };
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(runNumbers(container)).toEqual(['#2', '#1']);
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls.every((href) => href.includes('/api/data-status'))).toBe(true);
    expect(methods.every((method) => method === 'GET')).toBe(true);
    cleanup();
  });
});
