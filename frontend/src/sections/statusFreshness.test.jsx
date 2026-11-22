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
  lastDataChangeAt: '2026-09-24T11:02:00.000Z',
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
  refreshOutcome: { checked: 20, updated: 0, unchanged: 20, failed: 0, notAttempted: 0, total: 20 },
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
  return { container, rerender:element=>act(()=>root.render(element)), cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('status and audit freshness semantics', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('reuses a newer shared operational snapshot without fetching again or advancing generation',async()=>{
    stub=stubFetch([['/api/data-status',{...STATUS,generation:{contentVersion:1}}]]);
    const rendered=renderSection(<DataStatus />);await flushReact(act);const count=stub.calls.length;
    rendered.rerender(<DataStatus observedStatus={{receivedAt:performance.now()+1,data:{...STATUS,generation:{contentVersion:1},fresh:false,lastRun:{status:'partial'},refreshOutcome:{checked:19,updated:0,unchanged:19,failed:1,notAttempted:0,total:20}}}} />);
    await flushReact(act);expect(rendered.container.textContent).toContain('1 failed');expect(rendered.container.textContent).toContain('v1');expect(stub.calls.length).toBe(count);rendered.cleanup();
  });

  it('Audit renders one authoritative snapshot and its generation without split evidence requests',async()=>{
    stub=stubFetch([['/api/observations',{...AUDIT,auditSnapshot:true,generation:{contentVersion:7}}]]);
    const rendered=renderSection(<AuditSource year={2024} metricKey="nominal_current" country="JPN" />);await flushReact(act);
    expect(rendered.container.textContent).toContain('Source snapshot generation');expect(rendered.container.textContent).toContain('v7');expect(stub.calls).toHaveLength(1);expect(stub.calls[0]).toContain('audit=1');rendered.cleanup();
  });

  it('status separates upstream vintage from local retrieval in explicit UTC', async () => {
    stub = stubFetch([['/api/data-status', STATUS]]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('World Bank data vintage');
    expect(container.textContent).toContain('13 July 2026');
    // The successful CHECK time and the last DATA WRITE are distinct facts.
    expect(container.textContent).toContain('Last successful World Bank check');
    expect(container.textContent).toContain('28 September 2026, 00:25 UTC');
    expect(container.textContent).toContain('Last data write');
    expect(container.textContent).toContain('24 September 2026, 11:02 UTC');
    // The data-write timestamp must not claim to cover every write: a
    // metadata-only provenance update does not move it.
    expect(container.textContent).toContain('provenance update does not');
    // The old mislabel (retrieval time presented AS the vintage) is gone.
    expect(container.textContent).not.toContain('(retrieved)');
    expect(container.textContent).toContain('5 h ago');
    cleanup();
  });

  it('status reports the refresh outcome without calling unchanged work "changed"', async () => {
    stub = stubFetch([['/api/data-status', STATUS]]);
    const { container, cleanup } = renderSection(<DataStatus onRefreshed={() => {}} />);
    await flushReact(act);
    expect(container.textContent).toContain('20 checked');
    expect(container.textContent).toContain('0 changed');
    expect(container.textContent).toContain('20 unchanged');
    expect(container.textContent).toContain('0 failed');
    // "20/20" must never be presented as "20/20 rewritten".
    expect(container.textContent).not.toContain('20 rewritten');
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
