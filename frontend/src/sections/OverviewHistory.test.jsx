import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import OverviewHistory from './OverviewHistory.jsx';
import { clampToWindow, contextOptionsFor, valuePoints } from './overviewContext.js';

// Backend-shaped yearly rows: inflation values are annual-% levels,
// real growth is backend YoY on constant GDP. 2021 deflator and 2020
// growth are missing (gaps, never zeros).
const PRICES_ROWS = [
  { year: 2020, inflation_cpi: { indiaValue: 6.62, indiaValueDisplay: { formatted: '6.62%' }, available: true }, inflation_deflator: { indiaValue: 4.41, indiaValueDisplay: { formatted: '4.41%' }, available: true } },
  { year: 2021, inflation_cpi: { indiaValue: 5.13, indiaValueDisplay: { formatted: '5.13%' }, available: true }, inflation_deflator: { indiaValue: null, available: false } },
  { year: 2022, inflation_cpi: { indiaValue: 6.65, indiaValueDisplay: { formatted: '6.65%' }, available: true }, inflation_deflator: { indiaValue: 8.45, indiaValueDisplay: { formatted: '8.45%' }, available: true } },
];

const GDP_ROWS = [
  { year: 2020, total_constant: { indiaValue: 2657148000000, indiaYoY: null, available: true } },
  { year: 2021, total_constant: { indiaValue: 2878700000000, indiaYoY: 8.72, indiaYoYDisplay: '+8.72%', available: true } },
  { year: 2022, total_constant: { indiaValue: 3087800000000, indiaYoY: 7.26, indiaYoYDisplay: '+7.26%', available: true } },
];

function stubContext() {
  return stubFetch([
    [
      '/api/focus/yearly',
      (href) => {
        const subject = new URL(href, 'http://localhost').searchParams.get('subject');
        if (subject === 'prices') return { ok: true, status: 200, headers: new Headers(), json: async () => ({ rows: PRICES_ROWS }) };
        if (subject === 'gdp_total') return { ok: true, status: 200, headers: new Headers(), json: async () => ({ rows: GDP_ROWS }) };
        throw new Error(`unexpected subject: ${subject}`);
      },
    ],
  ]);
}

function renderHistory(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const base = {
    country: 'IND',
    displayName: 'India',
    windowStart: 2020,
    windowEnd: 2022,
    summary: 'history summary',
  };
  act(() => {
    root.render(<OverviewHistory {...base} {...props} />);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function legendLabels(container) {
  return [...container.querySelectorAll('.chart-legend-item')].map((el) => el.textContent);
}

function tableHeaders(container) {
  return [...container.querySelectorAll('[aria-label="Annual history values"] thead th')].map((el) => el.textContent);
}

function toggleContext(container, name) {
  const input = container.querySelector(`input[aria-label="Show ${name} alongside the selected metric"]`);
  if (!input) throw new Error(`context toggle not found: ${name}`);
  act(() => {
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const CPI_META = { shortTitle: 'CPI inflation', unitLong: 'annual %', unit: 'annual %' };
const DEFLATOR_META = { shortTitle: 'GDP-deflator inflation', unitLong: 'annual %', unit: 'annual %' };
const REAL_META = { shortTitle: 'Real — Constant 2015 US$', unitLong: 'constant 2015 US$', unit: 'constant 2015 US$' };

describe('OverviewHistory context series', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('prices CPI defaults to the legacy single-series graph with no extra fetch', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'inflation_cpi', historyMeta: CPI_META, historyRows: PRICES_ROWS });
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toBe('CPI inflation — history');
    expect(container.querySelector('.chart-legend-html')).toBeNull();
    expect(tableHeaders(container)).toEqual(['Year', 'CPI inflation']);
    expect(stub.calls).toHaveLength(0);
    cleanup();
  });

  it('prices CPI overlays backend real GDP growth on toggle, and removes it', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'inflation_cpi', historyMeta: CPI_META, historyRows: PRICES_ROWS });
    await flushReact(act);
    const primaryBefore = container.querySelector('[aria-label="Annual history values"]').textContent;

    toggleContext(container, 'Real GDP growth');
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toContain('with real GDP growth');
    expect(legendLabels(container)).toEqual(['India', 'Real GDP growth']);
    expect(tableHeaders(container)).toEqual(['Year', 'India', 'Real GDP growth']);
    // Context values are backend display strings verbatim; primary untouched.
    const table = container.querySelector('[aria-label="Annual history values"]').textContent;
    expect(table).toContain('+8.72%');
    expect(table).toContain('+7.26%');
    expect(table).toContain('6.62%');
    expect(stub.calls.some((c) => c.includes('subject=gdp_total'))).toBe(true);
    expect(stub.calls.some((c) => c.includes('subject=prices'))).toBe(false);

    toggleContext(container, 'Real GDP growth');
    await flushReact(act);
    expect(container.querySelector('.chart-legend-html')).toBeNull();
    expect(container.querySelector('[aria-label="Annual history values"]').textContent).toBe(primaryBefore);
    cleanup();
  });

  it('prices deflator overlays growth with gaps preserved', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'inflation_deflator', historyMeta: DEFLATOR_META, historyRows: PRICES_ROWS });
    await flushReact(act);
    toggleContext(container, 'Real GDP growth');
    await flushReact(act);
    expect(legendLabels(container)).toEqual(['India', 'Real GDP growth']);
    // 2021 deflator is missing backend-side: renders as a gap marker, never zero.
    const rows = [...container.querySelectorAll('[aria-label="Annual history values"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td, th')].map((c) => c.textContent),
    );
    expect(rows.find((r) => r[0] === '2021')[1]).toBe('—');
    expect(rows.find((r) => r[0] === '2022')[1]).toBe('8.45%');
    cleanup();
  });

  it('total constant defaults to the legacy levels graph', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'total_constant', historyMeta: REAL_META, historyRows: GDP_ROWS });
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toBe('Real — Constant 2015 US$ — history');
    expect(container.querySelector('.chart-unit').textContent).toBe('constant 2015 US$');
    expect(container.querySelector('.chart-legend-html')).toBeNull();
    expect(stub.calls).toHaveLength(0);
    cleanup();
  });

  it('total constant offers CPI, deflator, and both with deterministic colors', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'total_constant', historyMeta: REAL_META, historyRows: GDP_ROWS });
    await flushReact(act);

    toggleContext(container, 'CPI inflation');
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toBe('Real GDP growth with CPI inflation — annual %');
    expect(legendLabels(container)).toEqual(['Real GDP growth', 'CPI inflation']);

    toggleContext(container, 'GDP-deflator inflation');
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toBe(
      'Real GDP growth with CPI inflation and GDP-deflator inflation — annual %',
    );
    expect(legendLabels(container)).toEqual(['Real GDP growth', 'CPI inflation', 'GDP-deflator inflation']);
    const swatches = [...container.querySelectorAll('.chart-legend-swatch')].map((el) => el.style.borderTopColor);
    expect(swatches[0]).toBe('rgb(16, 24, 40)');
    expect(swatches[1]).toBe('rgb(42, 127, 111)');
    expect(swatches[2]).toBe('rgb(213, 94, 0)');
    // Growth primary uses backend YoY (2020 has no YoY: gap, not zero).
    const table = container.querySelector('[aria-label="Annual history values"]').textContent;
    expect(table).toContain('+8.72%');
    expect(table).toContain('+7.26%');

    toggleContext(container, 'CPI inflation');
    await flushReact(act);
    expect(legendLabels(container)).toEqual(['Real GDP growth', 'GDP-deflator inflation']);
    toggleContext(container, 'GDP-deflator inflation');
    await flushReact(act);
    expect(container.querySelector('.chart-title').textContent).toBe('Real — Constant 2015 US$ — history');
    expect(container.querySelector('.chart-legend-html')).toBeNull();
    cleanup();
  });

  it('context toggles reset when the metric changes', async () => {
    stub = stubContext();
    const { container, cleanup } = renderHistory({ historyKey: 'total_constant', historyMeta: REAL_META, historyRows: GDP_ROWS });
    await flushReact(act);
    toggleContext(container, 'CPI inflation');
    await flushReact(act);
    expect(legendLabels(container)).toHaveLength(2);
    // Overview remounts history per country:subject:metric key; a remount
    // must not carry the previous metric's context selection.
    const fresh = document.createElement('div');
    document.body.appendChild(fresh);
    const { createRoot: second } = await import('react-dom/client');
    const root2 = second(fresh);
    act(() => {
      root2.render(
        <OverviewHistory
          country="IND"
          displayName="India"
          historyKey="inflation_cpi"
          historyMeta={CPI_META}
          historyRows={PRICES_ROWS}
          windowStart={2020}
          windowEnd={2022}
          summary="history summary"
        />,
      );
    });
    await flushReact(act);
    expect(fresh.querySelector('.chart-legend-html')).toBeNull();
    expect(fresh.querySelector('.chart-title').textContent).toBe('CPI inflation — history');
    act(() => root2.unmount());
    fresh.remove();
    cleanup();
  });

  it('pure helpers pass values through and clamp overlays to the primary window', () => {
    expect(contextOptionsFor('inflation_cpi')).toEqual(['realGdpGrowth']);
    expect(contextOptionsFor('inflation_deflator')).toEqual(['realGdpGrowth']);
    expect(contextOptionsFor('total_constant')).toEqual(['cpiInflation', 'gdpDeflatorInflation']);
    expect(contextOptionsFor('nominal_current')).toEqual([]);
    const pts = valuePoints(GDP_ROWS, 'total_constant', 'indiaYoY');
    expect(pts).toEqual([
      { x: 2020, y: null },
      { x: 2021, y: 8.72 },
      { x: 2022, y: 7.26 },
    ]);
    expect(clampToWindow([{ x: 2019, y: 1 }, { x: 2021, y: 2 }], 2020, 2022)).toEqual([{ x: 2021, y: 2 }]);
  });
});
