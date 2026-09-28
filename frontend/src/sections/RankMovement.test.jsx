import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import RankMovement from './RankMovement.jsx';

// Backend-shaped comparison/level payload. Ranks, universes and modes are
// backend values; the tests assert only which graphs render for each
// (family, basis, middle-year) combination — never the values themselves.
function payload({ mode = 'level', withMid = false, metricKey = 'total_current' }) {
  return {
    comparison: { available: true, mode },
    years: withMid ? { a: 2004, mid: 2014, b: 2025 } : { a: 2004, b: 2025 },
    focus: { iso3: 'ITA', name: 'Italy' },
    metric: { key: metricKey, unit: 'current US$', indicatorCode: 'X' },
    focusMovement: {
      fullRankA: 8,
      fullRankB: 6,
      commonRankA: 9,
      commonRankB: 7,
      fullRankMid: 7,
      commonRankMid: 8,
      denominatorA: 180,
      denominatorB: 182,
      denominatorMid: 181,
      denominatorCommon: 170,
      positionNumberChange: -2,
      commonEffect: -2,
      observedSetEffect: 0,
      enteredAboveB: 0,
      enteredBelowB: 1,
      exitedAboveA: 1,
      exitedBelowA: 0,
      growth: {
        AB: { available: true, startYear: 2004, endYear: 2025, indiaGrowthPercent: 5.5, indiaGrowthDisplay: '+5.50%' },
      },
    },
    universe: {
      membershipRule: 'valid observations',
      common: 170,
      setA: 180,
      setB: 182,
      entered: 2,
      exited: 1,
      outside: 12,
      intervals: ['AB'],
      AB: { outside: 2 },
    },
    economies: {
      rows: [
        { iso3: 'ITA', name: 'Italy', status: 'common', valueA: 20000, valueMid: 22000, valueB: 24000 },
      ],
    },
    evidence: {
      vintage: { wbLastUpdated: '2024-01-01', mixedVintage: false },
      retrieval: { runIdA: 1, runIdMid: 1, runIdB: 1 },
      fingerprint: { runId: 1, observationCount: 500 },
      freshness: { fresh: true, lastRunStatus: 'ok' },
      limits: [],
    },
  };
}

function renderMovement({ metricKey = 'total_current', basis = 'level', yearMid = null, mode = 'level', withMid = false }) {
  const routes = [[`/api/comparison/level`, payload({ mode, withMid, metricKey })]];
  if (basis === 'period_total' || basis === 'period_average') {
    routes.push(['period-summary', { available: false, reason: 'stub_no_period_data' }]);
    routes.push(['/api/focus/yearly', { rows: [] }]);
  }
  const stub = stubFetch(routes);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <RankMovement
        availableYears={[2004, 2014, 2025]}
        yearA={2004}
        yearB={2025}
        yearMid={yearMid}
        metricKey={metricKey}
        basis={basis}
        country="ITA"
        countries={[{ iso3: 'ITA', name: 'Italy' }]}
        focusName="Italy"
        onYearA={() => {}}
        onYearB={() => {}}
        onYearMid={() => {}}
        onMetric={() => {}}
        onBasis={() => {}}
        onCountry={() => {}}
      />,
    );
  });
  return {
    stub,
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// The removed legacy visualization: position slope title, legends, lines.
function assertNoLegacyPositionGraph(container) {
  expect(container.textContent).not.toContain('position movement');
  expect(container.textContent).not.toContain('Observed position');
  expect(container.textContent).not.toContain('Like-for-like position');
  expect(container.querySelector('.recharts-line')).toBeNull();
}

function levelCards(container) {
  return [...container.querySelectorAll('.chart-card')].filter((el) => el.textContent.includes('level value'));
}

describe('RankMovement legacy position-graph removal', () => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  it('Total GDP level + no middle: no position graph, level-value graph remains', async () => {
    ctx = renderMovement({ metricKey: 'total_current', basis: 'level' });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
    expect(levelCards(ctx.container)).toHaveLength(1);
    // Tables and analytical cards remain.
    expect(ctx.container.textContent).toContain('Like-for-like comparison');
  });

  it('GDP per capita level + no middle: no position graph, level-value graph remains', async () => {
    ctx = renderMovement({ metricKey: 'nominal_current', basis: 'level' });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
    expect(levelCards(ctx.container)).toHaveLength(1);
  });

  it('Total GDP level + middle selected: current three-year presentation, no position graph', async () => {
    ctx = renderMovement({ metricKey: 'total_current', basis: 'level', yearMid: 2014, withMid: true });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
    expect(levelCards(ctx.container)).toHaveLength(1);
  });

  it('GDP per capita level + middle selected: no position graph', async () => {
    ctx = renderMovement({ metricKey: 'nominal_current', basis: 'level', yearMid: 2014, withMid: true });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
    expect(levelCards(ctx.container)).toHaveLength(1);
  });

  it('Total GDP growth + no middle: current growth presentation, no position graph', async () => {
    ctx = renderMovement({ metricKey: 'total_current', basis: 'growth', mode: 'yoy' });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
    expect(ctx.container.textContent).toContain('endpoint change');
  });

  it('Total GDP growth + middle selected: no position graph', async () => {
    ctx = renderMovement({ metricKey: 'total_current', basis: 'growth', mode: 'yoy', yearMid: 2014, withMid: true });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
  });

  it('GDP per capita growth + no middle: no position graph', async () => {
    ctx = renderMovement({ metricKey: 'nominal_current', basis: 'growth', mode: 'yoy' });
    await flushReact(act);
    assertNoLegacyPositionGraph(ctx.container);
  });

  it('Total GDP period bases: no position graph, period presentation remains', async () => {
    for (const basis of ['period_total', 'period_average']) {
      ctx = renderMovement({ metricKey: 'total_current', basis });
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
      assertNoLegacyPositionGraph(ctx.container);
      expect(ctx.container.textContent).toContain(basis === 'period_total' ? 'Period total' : 'Period average');
      ctx.stub.restore();
      ctx.cleanup();
      document.body.innerHTML = '';
      ctx = null;
    }
  });
});
