/**
 * BOOTSTRAP COLD-START TESTS (Phase 1).
 *
 * The years bootstrap is the cold-start gate: a free-tier backend wake can
 * take up to about a minute, so the UI must show a warm-up state with a
 * REAL elapsed clock (<60 s), a still-connecting state with a controlled
 * single-flight retry (>=60 s), and a genuine error state only for real
 * failures. Fake timers drive the clock; deferred fetch stubs drive the
 * request lifecycle. No test touches the network.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorResponse, flushReact, stubFetch } from './test-utils.js';
import App from './App.jsx';

const YEARS = {
  years: [2020, 2021, 2022, 2023, 2024],
  minYear: 2020,
  maxYear: 2024,
  defaults: { startYear: 2020, endYear: 2024 },
  perMetric: {},
};

const COUNTRIES = {
  countries: [
    { iso3: 'IND', name: 'India' },
    { iso3: 'USA', name: 'United States' },
  ],
};

const INDICATORS = {
  subjects: [{ key: 'gdp_per_capita', label: 'GDP per capita' }],
  production: [
    {
      key: 'nominal_current',
      subject: 'gdp_per_capita',
      label: 'Nominal GDP per capita',
      shortLabel: 'Nominal',
      unit: 'current US$',
      indicatorCode: 'NY.GDP.PCAP.CD',
      rankingDirection: 'DESC',
      observationType: 'LEVEL',
      validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
      periodAggregation: [],
    },
  ],
  methodology: {},
};

const STATUS = {
  fresh: true,
  inProgress: false,
  fingerprint: {
    runId: 7,
    lastSuccessAt: '2026-01-01T00:00:00.000Z',
    maxFetchedAt: '2026-01-02T00:00:00.000Z',
    observationCount: 228776,
  },
};

function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

function yearsCalls(stub) {
  return stub.calls.filter((href) => href.includes('/api/years'));
}

function clickRetry(container) {
  const button = [...container.querySelectorAll('.warmup-foot button, .status-error button')].find((el) =>
    el.textContent.includes('Retry'),
  );
  expect(button).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('bootstrap cold-start UX', () => {
  let stub = null;
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
  });

  it('shows the warm-up state with a live counter while years are slow, then loads normally', async () => {
    let resolveYears = null;
    const gate = new Promise((resolve) => {
      resolveYears = resolve;
    });
    stub = stubFetch([
      ['/api/years', () => gate.then(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => YEARS }))],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).toContain('usually takes up to about a minute');
    expect(container.textContent).toContain('0 seconds');

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flushReact(act);
    expect(container.textContent).toContain('5 seconds');
    expect(container.textContent).not.toContain('Still connecting');

    await act(async () => {
      resolveYears();
    });
    await flushReact(act);
    expect(container.textContent).not.toContain('Starting the data service');
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    cleanup();
  });

  it('transitions to still-connecting after ~60s without creating extra requests', async () => {
    stub = stubFetch([
      ['/api/years', () => new Promise(() => {})],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');

    await act(async () => {
      vi.advanceTimersByTime(59000);
    });
    await flushReact(act);
    expect(container.textContent).not.toContain('Still connecting');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await flushReact(act);
    expect(container.textContent).toContain('Still connecting');
    expect(container.textContent).toContain('taking longer than usual');
    expect(container.textContent).toContain('61 seconds');
    expect(container.textContent).toContain('Retry connection');
    // Still exactly one bootstrap attempt: the UI waited, it did not storm.
    expect(yearsCalls(stub)).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(1);
    cleanup();
  });

  it('retry starts a fresh attempt with a reset clock and never overlaps requests', async () => {
    let resolveYears = null;
    const gate = new Promise((resolve) => {
      resolveYears = resolve;
    });
    stub = stubFetch([
      ['/api/years', () => gate.then(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => YEARS }))],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    // Baseline: the Home view fetches indicators on its own mount alongside
    // the bootstrap hydration — retry must add no further fetches.
    const indicatorsBaseline = stub.calls.filter((href) => href.includes('/api/indicators')).length;
    await act(async () => {
      vi.advanceTimersByTime(61000);
    });
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(1);

    // First retry: exactly one new attempt, clock resets to warm-up.
    clickRetry(container);
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(2);
    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).toContain('0 seconds');

    // The fresh attempt re-arms the 60 s threshold on its own clock.
    await act(async () => {
      vi.advanceTimersByTime(61000);
    });
    await flushReact(act);
    expect(container.textContent).toContain('Still connecting');

    // Second retry supersedes the still-pending attempt: still single-flight.
    clickRetry(container);
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(3);
    // Retry re-runs only the years gate: countries/indicators call counts are
    // unchanged from the pre-retry baseline.
    expect(stub.calls.filter((href) => href.includes('/api/countries'))).toHaveLength(1);
    expect(stub.calls.filter((href) => href.includes('/api/indicators'))).toHaveLength(indicatorsBaseline);

    await act(async () => {
      resolveYears();
    });
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    cleanup();
  });

  it('genuine failures surface the error state, and retry recovers', async () => {
    let fail = true;
    stub = stubFetch([
      [
        '/api/years',
        () => (fail ? errorResponse(500, 'INTERNAL', 'backend exploded') : YEARS),
      ],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    expect(container.textContent).toContain('Could not load available years');
    expect(container.textContent).toContain('backend exploded');
    expect(container.textContent).not.toContain('Starting the data service');

    fail = false;
    clickRetry(container);
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    expect(yearsCalls(stub)).toHaveLength(2);
    cleanup();
  });

  it('DATA_LOADING stays in warm-up and follows up automatically without resetting the clock', async () => {
    let calls = 0;
    stub = stubFetch([
      [
        '/api/years',
        () => {
          calls += 1;
          return calls === 1 ? errorResponse(503, 'DATA_LOADING', 'seeding') : YEARS;
        },
      ],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).not.toContain('Could not load available years');

    // The single follow-up fires after the seed delay; the original clock continues.
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await flushReact(act);
    expect(calls).toBe(2);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    cleanup();
  });

  it('DATA_SERVICE_STARTING stays in warm-up like DATA_LOADING (readiness, not failure)', async () => {
    let calls = 0;
    stub = stubFetch([
      [
        '/api/years',
        () => {
          calls += 1;
          return calls === 1 ? errorResponse(503, 'DATA_SERVICE_STARTING', 'starting') : YEARS;
        },
      ],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Starting the data service');
    expect(container.textContent).not.toContain('Could not load available years');

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await flushReact(act);
    expect(calls).toBe(2);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    cleanup();
  });

  it('unmount during a pending bootstrap leaves no stale update and no extra request', async () => {
    let resolveYears = null;
    const gate = new Promise((resolve) => {
      resolveYears = resolve;
    });
    stub = stubFetch([
      ['/api/years', () => gate.then(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => YEARS }))],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { cleanup } = renderApp();
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(1);
    cleanup();
    await act(async () => {
      resolveYears();
    });
    await flushReact(act);
    expect(yearsCalls(stub)).toHaveLength(1);
  });

  it('the background refresh watcher polls without storms and never refetches years', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/data-status', STATUS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await flushReact(act);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    await flushReact(act);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    await flushReact(act);

    // One staggered check plus one per 60 s tick: steady cadence, no loop.
    expect(stub.calls.filter((href) => href.includes('/api/data-status'))).toHaveLength(3);
    expect(yearsCalls(stub)).toHaveLength(1);
    expect(container.textContent).not.toContain('Background refresh');
    cleanup();
  });
});
