/**
 * COLD-START DATA-STATUS TESTS (Phase 6E, Part 4/6).
 *
 * A Render cold start refuses connections (fetch throws) instead of answering
 * HTTP. The status view must treat that as "starting" with controlled
 * auto-retry — not as a permanent red backend-dead error — while genuine HTTP
 * errors still render red immediately, and a failure persisting past the
 * cold-start window falls back to the explicit error.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import DataStatus from './DataStatus.jsx';

const STATUS = {
  empty: false,
  observations: 228776,
  fresh: true,
  lastSuccessAt: '2026-09-28T00:25:14.000Z',
  wbLastUpdated: '2026-07-13',
  ageHours: 5,
  ttlHours: 24,
  refreshDue: false,
  inProgress: false,
  progress: null,
  lock: { locked: false },
  integrity: { passed: true, checks: [] },
  autoRefresh: { enabled: true },
  refreshRequiresAuth: true,
  lastRun: { status: 'success' },
  latestRuns: [],
};

function okResponse() {
  return { ok: true, status: 200, headers: new Headers(), json: async () => STATUS };
}

function renderSection(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('data-status cold start', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('connection refusal shows "starting", never a red dead-backend error', async () => {
    vi.useFakeTimers();
    stub = stubFetch([
      ['/api/data-status', () => {
        throw new TypeError('fetch failed');
      }],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).not.toContain('Could not load data status');
    cleanup();
  });

  it('recovers automatically when the backend answers (no manual retry needed)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    stub = stubFetch([
      [
        '/api/data-status',
        () => {
          calls += 1;
          if (calls === 1) throw new TypeError('fetch failed');
          return okResponse();
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flushReact(act);
    expect(container.textContent).toContain('228776 observations stored');
    expect(calls).toBe(2);
    cleanup();
  });

  it('503 DATA_SERVICE_STARTING shows "starting" and recovers when ready', async () => {
    vi.useFakeTimers();
    let calls = 0;
    stub = stubFetch([
      [
        '/api/data-status',
        () => {
          calls += 1;
          if (calls === 1) {
            return {
              ok: false,
              status: 503,
              headers: new Headers(),
              json: async () => ({ error: { message: 'Data service is starting.', code: 'DATA_SERVICE_STARTING' } }),
            };
          }
          return okResponse();
        },
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    // Listen-first readiness is a normal delay, never a red failure.
    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).not.toContain('Could not load data status');
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flushReact(act);
    expect(container.textContent).toContain('228776 observations stored');
    expect(calls).toBe(2);
    cleanup();
  });

  it('genuine HTTP errors render red immediately (backend answered)', async () => {
    vi.useFakeTimers();
    stub = stubFetch([
      [
        '/api/data-status',
        () => ({
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ error: { message: 'Internal server error.', code: 'INTERNAL_ERROR' } }),
        }),
      ],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Could not load data status');
    expect(container.textContent).not.toContain('Starting the data service');
    cleanup();
  });

  it('a failure persisting past the window falls back to the explicit error', async () => {
    vi.useFakeTimers();
    stub = stubFetch([
      ['/api/data-status', () => {
        throw new TypeError('fetch failed');
      }],
    ]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');
    // Walk the whole backoff ladder past the 120 s window.
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        vi.advanceTimersByTime(30000);
      });
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
    }
    expect(container.textContent).toContain('Could not load data status');
    expect(container.textContent).not.toContain('Starting the data service');
    cleanup();
  });
});
