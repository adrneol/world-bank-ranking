import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import PricesMovement from './PricesMovement.jsx';

function section(period, indRank, indValue, usaRank, usaValue) {
  return {
    focus: { value: null, rank: null, denominator: null, benchmark: null, benchmarkPeerCount: 0, pp: null },
    ranking: [
      { iso3: 'IND', name: 'India', rank: indRank, value: indValue },
      { iso3: 'USA', name: 'United States', rank: usaRank, value: usaValue },
    ],
    eligibleCount: 2,
  };
}

const MOVEMENT = {
  available: true,
  kind: 'period',
  basis: { id: 'cpi_inflation_cumulative', label: 'Cumulative CPI inflation (%)', unit: '%' },
  metric: { key: 'inflation_cpi', label: 'CPI inflation', unit: 'annual %', indicatorCode: 'FP.CPI.TOTL.ZG' },
  focus: { iso3: 'IND', name: 'India' },
  observed: [
    { period: '2004-2014', ...section('2004-2014', 1, 50, 2, 30) },
    { period: '2014-2024', ...section('2014-2024', 2, 40, 1, 70) },
  ],
  // Like-for-like mirrors observed here so the common set is {IND, USA}.
  likeForLike: [
    { period: '2004-2014', ...section('2004-2014', 1, 50, 2, 30) },
    { period: '2014-2024', ...section('2014-2024', 2, 40, 1, 70) },
  ],
};

function renderPrices() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const noop = () => {};
  act(() => {
    root.render(
      <PricesMovement
        availableYears={[2004, 2014, 2024]}
        yearA={2004}
        yearB={2024}
        metricKey="inflation_cpi"
        basis="cpi_inflation_cumulative"
        country="IND"
        countries={[]}
        focusName="India"
        onYearA={noop}
        onYearB={noop}
        onYearMid={noop}
        onMetric={noop}
        onBasis={noop}
        onCountry={noop}
      />,
    );
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('PricesMovement common sort', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('exposes per-period rank/value sorts and reorders by the selected key', async () => {
    stub = stubFetch([
      ['/api/prices/country-groups', { supported: {} }],
      ['/api/movement/prices', MOVEMENT],
    ]);
    const { container, cleanup } = renderPrices();
    await flushReact(act);

    const showCommon = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Show common economies'),
    );
    expect(showCommon).toBeTruthy();
    act(() => {
      showCommon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);

    const sortButton = document.querySelector('button[aria-label="Sort"]');
    expect(sortButton).toBeTruthy();
    act(() => {
      sortButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const options = [...document.querySelectorAll('.combo-option')].map((el) => el.textContent);
    // 2 compared periods × 4 directions — the complete valid set.
    expect(options).toHaveLength(8);
    expect(options).toContain('2004-2014 rank — best first');
    expect(options).toContain('2014-2024 value — high to low');

    // Default: reference-period rank best-first → USA (#1) before India (#2).
    let firstRow = container.querySelector('tbody tr');
    expect(firstRow.textContent).toContain('USA');
    expect(firstRow.textContent).toContain('#1');

    // Select 2004-2014 value high-to-low → India (50) before USA (30),
    // with backend ranks preserved (#2 for India in the reference period).
    const target = [...document.querySelectorAll('.combo-option')].find((el) =>
      el.textContent.includes('2004-2014 value — high to low'),
    );
    act(() => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushReact(act);
    firstRow = container.querySelector('tbody tr');
    expect(firstRow.textContent).toContain('India');
    expect(firstRow.textContent).toContain('#2');
    cleanup();
  });
});
