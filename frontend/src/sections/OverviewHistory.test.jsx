import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushReact, stubFetch } from '../test-utils.js';
import { hydrateRegistry, STATIC_METRICS } from '../config/metrics.js';
import { historySeries, relatedHistorySeries } from './overviewContext.js';
import OverviewHistory from './OverviewHistory.jsx';

const years = Array.from({ length: 66 }, (_, index) => 1960 + index);
const extended = [
  ['inflation_cpi', 'CPI inflation', 'prices', 'annual %'],
  ['inflation_deflator', 'GDP-deflator inflation', 'prices', 'annual %'],
  ['inflation_cpi_index', 'CPI index', 'prices', 'index (2010 = 100)'],
  ['exports_current', 'Exports', 'trade', 'current US$'],
  ['imports_current', 'Imports', 'trade', 'current US$'],
];

function apiResponse(href) {
  const params = new URL(href, 'http://localhost').searchParams;
  const from = Number(params.get('startYear'));
  const to = Number(params.get('endYear'));
  return {
    source: 'World Bank WDI',
    series: params.get('series').split(',').map((id) => ({
      id, indicatorCode: historySeries(id).indicatorCode, derived: id === 'real_gdp_growth',
      points: Array.from({ length: to - from + 1 }, (_, offset) => ({
        year: from + offset, value: offset === 1 ? null : historySeries(id).axis === 'annual-percentage' ? offset - 5.123456 : offset * 1234567891,
        raw: String(offset), vintage: '2026-07-13',
      })),
    })),
  };
}

function renderHistory(primary) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (historyKey) => act(() => root.render(<OverviewHistory
    country="IND" displayName="India" historyKey={historyKey} availableYears={years} />));
  render(primary);
  return { container, render, cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

const tableHeaders = (node) => [...node.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const pick = (node, label) => [...node.querySelectorAll('button')].find((b) => b.textContent === label);
const period = (node, label) => {
  act(() => node.querySelector('[aria-label="Period"]').click());
  const option = [...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('.combo-label')?.textContent === label);
  act(() => option.click());
};
const toggle = (node, label) => {
  const remove = node.querySelector('[aria-label^="Remove ' + label + ' ("]');
  if (remove) {
    act(() => remove.click());
    return;
  }
  act(() => node.querySelector('[aria-label="Add series"]').click());
  const option = [...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('.combo-label')?.textContent === label);
  expect(option).toBeTruthy();
  act(() => option.click());
};

describe('bounded Overview histories', () => {
  let stub;
  let view;
  beforeEach(() => {
    hydrateRegistry({ production: [
      ...Object.values(STATIC_METRICS).map((m) => ({ ...m, label: m.title, shortLabel: m.shortTitle })),
      ...extended.map(([key, label, subject, unit]) => ({ key, label, subject, unit, indicatorCode: key, displayDecimals: 2 })),
    ] });
    stub = stubFetch([['/api/focus/history', (href) => ({ ok: true, status: 200, headers: new Headers(), json: async () => apiResponse(href) })]]);
  });
  afterEach(() => { view?.cleanup(); stub?.restore(); view = null; });

  it('keeps real GDP levels visible and puts rate context on its own axis', async () => {
    view = renderHistory('total_constant');
    await flushReact(act);
    expect(stub.calls).toHaveLength(1);
    expect(view.container.textContent).toContain('constant 2015 US$');
    toggle(view.container, 'Real GDP growth');
    toggle(view.container, 'CPI inflation');
    toggle(view.container, 'GDP-deflator inflation');
    await flushReact(act);
    expect(view.container.querySelectorAll('figure')).toHaveLength(1);
    expect(view.container.querySelectorAll('[aria-label="Annual history values"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('.annual-region-svg')).toHaveLength(1);
    expect(view.container.querySelector('.annual-axis-right')).toBeTruthy();
    expect(tableHeaders(view.container)).toEqual(expect.arrayContaining([
      expect.stringContaining('constant 2015 US$'), 'CPI inflationannual %',
      'GDP-deflator inflationannual %', 'Real GDP growthannual % · derived',
    ]));
    expect(view.container.textContent).not.toContain('CPI index');
    expect(view.container.textContent).toContain('WDI vintage: 2026-07-13');
    expect(view.container.querySelector('[aria-label="Missing observation"]')).toBeTruthy();
  });

  it('reuses one bounded response when chart type changes, and updates chart and table with presets', async () => {
    view = renderHistory('exports_current');
    await flushReact(act);
    toggle(view.container, 'Imports');
    await flushReact(act);
    expect(view.container.querySelector('.chart-period-controls select')).toBeNull();
    const count = stub.calls.length;
    act(() => pick(view.container, 'Bar chart').click());
    await flushReact(act);
    expect(stub.calls).toHaveLength(count);
    period(view.container, 'Recent 10 years');
    await flushReact(act);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(stub.calls.at(-1)).toContain('startYear=2016');
    expect(tableHeaders(view.container)).toEqual(['Year', 'Exportscurrent US$', 'Importscurrent US$']);
    period(view.container, 'Full history');
    await flushReact(act);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(66);
    period(view.container, 'Reset range');
    await flushReact(act);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(25);
  });

  it('offers registered alternatives in every permitted family and keeps index independent', () => {
    for (const key of ['total_current', 'total_ppp_constant', 'nominal_constant', 'ppp_current']) {
      expect(relatedHistorySeries(key)).toHaveLength(3);
      expect(new Set([historySeries(key), ...relatedHistorySeries(key)].map((item) => item.axis)).size).toBe(4);
    }
    expect(relatedHistorySeries('inflation_cpi').map(({ id }) => id)).toEqual(['inflation_deflator', 'real_gdp_growth']);
    expect(relatedHistorySeries('inflation_deflator').map(({ id }) => id)).toEqual(['inflation_cpi', 'real_gdp_growth']);
    expect(relatedHistorySeries('inflation_cpi_index')).toEqual([]);
    expect(relatedHistorySeries('imports_current').map(({ id }) => id)).toEqual(['exports_current']);
    expect(historySeries('nominal_current').basis).toContain('per person');
  });

  it('keeps compatible choices when the primary changes and removes deselected columns', async () => {
    view = renderHistory('total_current');
    await flushReact(act);
    toggle(view.container, 'Real PPP GDP');
    await flushReact(act);
    view.render('total_constant');
    await flushReact(act);
    expect(tableHeaders(view.container).some((header) => header.includes('constant 2021 international'))).toBe(true);
    toggle(view.container, 'Real PPP GDP');
    await flushReact(act);
    expect(tableHeaders(view.container).some((header) => header.includes('constant 2021 international'))).toBe(false);
  });

  it('renders all seven series in the chosen mode and keeps concise and exact evidence accessible', async () => {
    view = renderHistory('total_constant');
    await flushReact(act);
    const { container } = view;
    const height = () => container.querySelector('.annual-region-svg').getAttribute('height');
    const initialHeight = height();
    expect(container.querySelectorAll('.annual-legend li')).toHaveLength(1);
    for (const label of ['Nominal GDP', 'PPP GDP', 'Real PPP GDP', 'CPI inflation', 'GDP-deflator inflation', 'Real GDP growth']) {
      toggle(container, label);
    }
    await flushReact(act);
    expect(container.querySelectorAll('.annual-legend li')).toHaveLength(7);
    const addSeries = container.querySelector('[aria-label="Add series"]');
    act(() => addSeries.click());
    expect(document.querySelectorAll('[role="option"]:not([aria-disabled="true"])')).toHaveLength(0);
    act(() => document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(addSeries);
    expect(container.querySelectorAll('[data-series-id] path')).toHaveLength(7);
    expect(container.querySelectorAll('[data-series-id] rect')).toHaveLength(0);
    expect(container.querySelector('.annual-axis-key').textContent).toContain('Dashed lines = Annual % · Right axis');
    const legendMarks = [...container.querySelectorAll('.annual-legend .annual-series-marker')];
    const lineMarks = [...container.querySelectorAll('[data-series-id] path')];
    lineMarks.forEach((mark, index) => {
      const dash = mark.getAttribute('stroke-dasharray');
      expect(Boolean(dash)).toBe(index >= 4);
      expect(legendMarks[index].querySelector('line').getAttribute('stroke-dasharray')).toBe(dash);
      expect(legendMarks[index].querySelector('line').getAttribute('stroke')).toBe(mark.getAttribute('stroke'));
    });
    const calls = stub.calls.length;
    act(() => pick(container, 'Fixed').click());
    act(() => pick(container, 'Bar chart').click());
    expect(container.querySelector('.annual-range button[aria-pressed="true"]').textContent).toBe('Fixed');
    expect(stub.calls).toHaveLength(calls);
    expect(container.querySelectorAll('select, [data-series-id] :is(path, circle, line)')).toHaveLength(0);
    expect(height()).toBe(initialHeight);
    expect(container.querySelector('.annual-axis-key').textContent).toContain('Patterned bars = Annual % · Right axis');
    expect(container.querySelectorAll('.annual-legend pattern')).toHaveLength(3);
    expect(container.querySelectorAll('.annual-region-svg pattern')).toHaveLength(3);
    expect(container.querySelectorAll('.annual-zero-line')).toHaveLength(1);
    const baseline = Number(container.querySelector('.annual-zero-line').getAttribute('y1'));
    const positive = container.querySelector('[data-series-id="total_constant"][data-axis="levels"] rect:nth-child(2)');
    expect(Number(positive.getAttribute('y')) + Number(positive.getAttribute('height'))).toBeCloseTo(baseline);
    expect(positive.getAttribute('fill')).toBe(container.querySelector('.annual-legend rect').getAttribute('fill'));
    for (const id of ['inflation_cpi', 'inflation_deflator', 'real_gdp_growth']) {
      const negative = container.querySelector(`[data-series-id="${id}"][data-axis="rates"] rect`);
      expect(Number(negative.getAttribute('y'))).toBeCloseTo(baseline);
      expect(Number(negative.getAttribute('height'))).toBeGreaterThan(0);
      expect(negative.getAttribute('fill')).toMatch(/^url\(#/);
    }
    const railTicks = [...container.querySelectorAll('.annual-axis-left text')].map(tick => tick.getAttribute('y'));
    expect([...container.querySelectorAll('.annual-grid-line')].every(line => railTicks.includes(line.getAttribute('y1')))).toBe(true);
    expect([...container.querySelectorAll('.annual-axis-right text')].every(tick => tick.lastChild.textContent.endsWith('%'))).toBe(true);
    expect(tableHeaders(container)).toHaveLength(8);
    expect(container.textContent).toContain(historySeries('total_constant').indicatorCode);
  });
});
