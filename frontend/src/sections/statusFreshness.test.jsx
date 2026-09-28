/**
 * FRESHNESS SEMANTICS TESTS, PHASE 4 (Parts F/G/J).
 *
 * Status must separate the upstream World Bank vintage (date-only,
 * retrieval-independent) from the local retrieval timestamp (explicit UTC,
 * stable across page views). Audit must label the upstream field
 * accurately. Timestamps must not move merely because a page renders.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import AuditSource from './AuditSource.jsx';
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

const AUDIT = {
  metadata: {
    apiBaseUrl: 'https://api.worldbank.org/v2',
    indicators: [{ metric_key: 'nominal_current', name: 'GDP per capita' }],
    universe: { eligible: 200, total: 265 },
    methodology: {
      levelRanking: 'value DESC',
      rankWording: 'Rank calculated.',
      rankDisclaimer: 'Calculated here.',
    },
  },
  observation: {
    wbLastUpdated: '2026-07-13',
    fetchedAt: '2026-09-27T18:54:55.007Z',
    valueRaw: '123.45',
    country: { name: 'India' },
  },
  yearly: {
    focus: { iso3: 'IND', name: 'India' },
    rows: [
      {
        nominal_current: {
          indiaRank: 100,
          total: 200,
          indiaValueRaw: '123.45',
          indiaValueDisplay: { formatted: '123.45' },
          indiaYoY: 5,
          previousYearValue: '100',
        },
      },
    ],
  },
};

function renderSection(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('status and audit freshness semantics', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('status separates upstream vintage from local retrieval in explicit UTC', async () => {
    stub = stubFetch([['/api/data-status', STATUS]]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('World Bank data vintage');
    expect(container.textContent).toContain('13 July 2026');
    expect(container.textContent).toContain('Data retrieved');
    expect(container.textContent).toContain('28 September 2026, 00:25 UTC');
    // The old mislabel (retrieval time presented AS the vintage) is gone.
    expect(container.textContent).not.toContain('(retrieved)');
    expect(container.textContent).toContain('5 h ago');
    cleanup();
  });

  it('status timestamps do not move across re-renders', async () => {
    stub = stubFetch([['/api/data-status', STATUS]]);
    const first = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    const text = first.container.textContent;
    first.cleanup();
    document.body.innerHTML = '';
    const second = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(second.container.textContent).toContain('13 July 2026');
    expect(second.container.textContent).toContain('28 September 2026, 00:25 UTC');
    expect(second.container.textContent).toBe(text);
    second.cleanup();
  });

  it('audit labels the upstream field and the retrieval timestamp distinctly', async () => {
    stub = stubFetch([
      ['/api/metadata', AUDIT.metadata],
      ['/api/observations', { observation: AUDIT.observation }],
      ['/api/focus/yearly', AUDIT.yearly],
    ]);
    const { container, cleanup } = renderSection(
      <AuditSource year={2024} metricKey="nominal_current" subject="gdp_per_capita" country="IND" focusName="India" />,
    );
    await flushReact(act);
    expect(container.textContent).toContain('World Bank data last updated');
    expect(container.textContent).toContain('2026-07-13');
    expect(container.textContent).toContain('Local retrieval timestamp');
    expect(container.textContent).toContain('2026-09-27T18:54:55.007Z');
    cleanup();
  });
});
