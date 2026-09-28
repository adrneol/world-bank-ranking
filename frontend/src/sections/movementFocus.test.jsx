/**
 * FOCUS-COUNTRY CORRECTNESS TESTS, PHASE 2 (movement families).
 *
 * The six metric-family movement sections already used the canonical
 * focusIso/focusName pattern. These tests pin that contract for an
 * arbitrary non-India focus (USA): the focus name renders, exactly the
 * focus row carries focus styling, the request uses the selected country,
 * and no India fallback appears. Payloads are authentic backend responses
 * (locally retrieved, rows trimmed to the focus plus two peers).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import CapitalMovement from './CapitalMovement.jsx';
import ExternalMovement from './ExternalMovement.jsx';
import FxMovement from './FxMovement.jsx';
import PopulationMovement from './PopulationMovement.jsx';
import PricesMovement from './PricesMovement.jsx';
import TradeMovement from './TradeMovement.jsx';
import fixtures from './movementUsaFixtures.json';

const FAMILIES = [
  { id: 'prices', Component: PricesMovement, endpoint: '/api/movement/prices', groups: '/api/prices/country-groups', metricKey: 'inflation_cpi', basis: 'cpi_inflation_cumulative' },
  { id: 'capital', Component: CapitalMovement, endpoint: '/api/movement/capital', groups: '/api/capital/country-groups', metricKey: 'fdi_inflows', basis: 'fdi_annual_value' },
  { id: 'fx', Component: FxMovement, endpoint: '/api/movement/fx', groups: '/api/fx/country-groups', metricKey: 'fx_official', basis: 'fx_annual_change' },
  { id: 'trade', Component: TradeMovement, endpoint: '/api/movement/trade', groups: '/api/trade/country-groups', metricKey: 'exports_current', basis: 'exp_annual_value' },
  { id: 'external', Component: ExternalMovement, endpoint: '/api/movement/external', groups: '/api/external/country-groups', metricKey: 'current_account', basis: 'ca_annual_gdp' },
  { id: 'population', Component: PopulationMovement, endpoint: '/api/movement/population', groups: '/api/population/country-groups', metricKey: 'population_total', basis: 'pop_annual_value' },
];

function renderFamily(Component, { metricKey, basis, endpoint, groups, payload }) {
  const stub = stubFetch([
    [groups, { supported: {} }],
    [endpoint, payload],
  ]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const noop = () => {};
  act(() => {
    root.render(
      <Component
        availableYears={[2004, 2014]}
        yearA={2004}
        yearB={2014}
        metricKey={metricKey}
        basis={basis}
        country="USA"
        countries={[]}
        focusName="United States"
        onYearA={noop}
        onYearB={noop}
        onYearMid={noop}
        onMetric={noop}
        onBasis={noop}
        onCountry={noop}
      />,
    );
  });
  return { stub, container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe.each(FAMILIES)('movement family focus ($id)', ({ Component, endpoint, groups, metricKey, basis, id }) => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  it('represents the USA focus with no India fallback', async () => {
    ctx = renderFamily(Component, { metricKey, basis, endpoint, groups, payload: fixtures[id] });
    await flushReact(act);

    // The request uses the selected country.
    expect(ctx.stub.calls.some((href) => href.includes(endpoint) && href.includes('country=USA'))).toBe(true);

    // The focus name renders even before tables are opened.
    expect(ctx.container.textContent).toContain('United States');

    // Open collapsed tables (re-query per click: toggles detach old nodes).
    for (let i = 0; i < 6; i += 1) {
      const btn = [...ctx.container.querySelectorAll('button')].find((el) => /^Show /.test(el.textContent));
      if (!btn) break;
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    await flushReact(act);

    // Exactly the focus row carries focus styling.
    const focusRows = [...ctx.container.querySelectorAll('tr.row-focus')];
    expect(focusRows.length).toBeGreaterThan(0);
    for (const row of focusRows) expect(row.textContent).toContain('USA');
    const tag = ctx.container.querySelector('.focus-tag');
    expect(tag?.textContent).toContain('United States');

    // No India focus signals anywhere: labels, narratives, tags and
    // highlighted rows all follow the selected focus. (India may still
    // appear as an ordinary peer row, e.g. population rank #1.)
    for (const row of focusRows) expect(row.textContent).not.toContain('India');
    for (const el of [...ctx.container.querySelectorAll('.focus-tag')]) {
      expect(el.textContent).not.toContain('India');
    }
    for (const text of [
      'Above India',
      'Below India',
      'Relation to India',
      "Affects India's",
      "India's position",
      'India ranking',
      'India growth',
      'India observed',
      'Crossed India',
      'vs India',
    ]) {
      expect(ctx.container.textContent).not.toContain(text);
    }
  });
});
