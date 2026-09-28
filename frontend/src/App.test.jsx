import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch, errorResponse } from './test-utils.js';
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
  subjects: [
    { key: 'gdp_per_capita', label: 'GDP per capita' },
    { key: 'prices', label: 'Prices' },
  ],
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
    {
      key: 'inflation_cpi',
      subject: 'prices',
      label: 'CPI inflation',
      shortLabel: 'CPI inflation',
      unit: 'annual %',
      indicatorCode: 'FP.CPI.TOTL.ZG',
      rankingDirection: 'ASC',
      observationType: 'RATE',
      validChangeTypes: ['ABSOLUTE', 'PP'],
      periodAggregation: [],
    },
  ],
  methodology: {},
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

describe('App navigation', () => {
  let stub = null;
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('lands on Home by default with header tabs and drawer trigger', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    const tabs = [...container.querySelectorAll('.tab')].map((el) => el.textContent);
    expect(tabs).toEqual(expect.arrayContaining(['Home', 'Methodology', 'About']));
    expect(container.querySelector('#navdrawer-trigger').textContent).toContain('Explore analysis');
    cleanup();
  });

  it('drawer navigates to analytical views, closes, and deep-links via ?view=', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/comparison/level', () => errorResponse(400, 'INVALID_BASIS', 'no data in stub')],
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    act(() => {
      container.querySelector('#navdrawer-trigger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const items = [...document.querySelectorAll('.navdrawer-item')];
    expect(items).toHaveLength(9);
    act(() => {
      items.find((el) => el.textContent.includes('Movement')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(document.querySelector('.navdrawer-panel')).toBeNull();
    expect(window.location.search).toContain('view=movement');
    expect(container.querySelector('#navdrawer-trigger').textContent).toContain('Movement');
    cleanup();
  });

  it('preserves existing ?view= deep links', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/ranking', { rows: [], page: 1, pages: 1, total: 0, pageSize: 50, search: { query: null, matchCount: 0, matches: [] } }],
    ]);
    window.history.replaceState(null, '', '/?view=status');
    const { container, cleanup } = renderApp();
    await flushReact(act);
    expect(container.textContent).toContain('Data status');
    cleanup();
  });

  it('shows a neutral project identity on informational pages', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    for (const view of ['home', 'methodology', 'about']) {
      window.history.replaceState(null, '', `/?view=${view}`);
      const { container, cleanup } = renderApp();
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
      const header = container.querySelector('.app-header');
      expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI');
      expect(header.querySelector('h1').textContent).toBe('Economic data analysis');
      expect(header.querySelector('h1').textContent).not.toContain('ranking');
      cleanup();
      document.body.innerHTML = '';
    }
  });

  it('shows the current focus country and year on analytical pages', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    window.history.replaceState(null, '', '/?view=overview&country=USA&year=2022');
    const { container, cleanup } = renderApp();
    await flushReact(act);
    const header = container.querySelector('.app-header');
    expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI · USA');
    expect(header.querySelector('h1').textContent).toContain('United States');
    expect(header.querySelector('h1').textContent).toContain('2022');
    expect(header.textContent).not.toMatch(/ranking/i);
    expect(container.querySelector('#navdrawer-trigger').textContent).toContain('Overview');
    cleanup();
  });

  it('shows the movement period endpoints, isolated from the global year', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    window.history.replaceState(null, '', '/?view=movement&yearA=2020&yearB=2022&year=2024');
    const { container, cleanup } = renderApp();
    await flushReact(act);
    const header = container.querySelector('.app-header');
    expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI · IND');
    expect(header.querySelector('h1').textContent).toBe('India — 2020 → 2022');
    expect(header.querySelector('h1').textContent).not.toContain('2024');
    expect(container.querySelector('#navdrawer-trigger').textContent).toContain('Movement');
    cleanup();
  });

  it('keeps compare and status headers neutral regardless of focus state', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    window.history.replaceState(null, '', '/?view=compare&country=USA&year=2022');
    const first = renderApp();
    await flushReact(act);
    let header = first.container.querySelector('.app-header');
    expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI');
    expect(header.querySelector('h1').textContent).toBe('Entity comparison');
    expect(header.textContent).not.toContain('USA');
    expect(header.textContent).not.toContain('United States');
    first.cleanup();
    document.body.innerHTML = '';

    window.history.replaceState(null, '', '/?view=status&country=USA&year=2022');
    const second = renderApp();
    await flushReact(act);
    header = second.container.querySelector('.app-header');
    expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI');
    expect(header.querySelector('h1').textContent).toBe('Data status & refresh');
    expect(header.textContent).not.toContain('USA');
    expect(header.textContent).not.toContain('2022');
    second.cleanup();
  });
});
