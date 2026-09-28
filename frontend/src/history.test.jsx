/**
 * ANALYTICAL NAVIGATION / HISTORY TESTS, PHASE 3 (Part D).
 *
 * The URL is the canonical navigation state: primary-dimension changes
 * (view, country, metric, sub-tabs, compare entities) push history entries
 * so Back/Forward restores the application; secondary tweaks replace in
 * place. Rank/YoY sub-tabs serialize on their own views and survive
 * reload. Includes a mobile-width drawer smoke test.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from './test-utils.js';
import App from './App.jsx';

const YEARS = {
  years: [2004, 2014, 2024],
  minYear: 2004,
  maxYear: 2024,
  defaults: { startYear: 2004, endYear: 2024 },
  perMetric: {},
};

const COUNTRIES = {
  countries: [
    { iso3: 'IND', name: 'India' },
    { iso3: 'USA', name: 'United States' },
    { iso3: 'CHN', name: 'China' },
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
      key: 'total_current',
      subject: 'gdp_per_capita',
      label: 'Total GDP',
      shortLabel: 'Total',
      unit: 'current US$',
      indicatorCode: 'NY.GDP.MKTP.CD',
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

const RANK_STUBS = [
  ['/api/ranking/verify', { focus: { iso3: 'IND', name: 'India' }, rows: [] }],
  ['/api/ranking', { rows: [], page: 1, pages: 1, total: 0, pageSize: 50, search: { query: null, matchCount: 0, matches: [] } }],
];

const YOY_STUBS = [
  ['/api/yoy-ranking', { rows: [], page: 1, pages: 1, total: 0, pageSize: 50 }],
  ['/api/yoy-ranking/verify', { focus: { iso3: 'IND', name: 'India' }, rows: [] }],
];

function renderApp(url) {
  window.history.replaceState(null, '', url);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

function drawerGo(container, label) {
  act(() => {
    container.querySelector('#navdrawer-trigger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const item = [...document.querySelectorAll('.navdrawer-item')].find((el) => el.textContent.includes(label));
  expect(item).toBeTruthy();
  act(() => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function triggerLabel(container) {
  return container.querySelector('#navdrawer-trigger').textContent;
}

async function goBack() {
  await act(async () => {
    window.history.back();
    // jsdom fires popstate as a separate task; yield long enough for it.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await flushReact(act);
}

async function goForward() {
  await act(async () => {
    window.history.forward();
    // jsdom fires popstate as a separate task; yield long enough for it.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await flushReact(act);
}

async function pickCombo(container, buttonId, optionText) {
  const btn = container.querySelector(`#${buttonId}`);
  expect(btn).toBeTruthy();
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushReact(act);
  const option = [...document.querySelectorAll('.combo-option')].find((el) => el.textContent.includes(optionText));
  expect(option).toBeTruthy();
  act(() => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await flushReact(act);
}

describe('analytical navigation and history', () => {
  let stub = null;
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    if ('matchMedia' in window && window.__phase3MockMatchMedia) {
      delete window.matchMedia;
      delete window.__phase3MockMatchMedia;
    }
  });

  function baseStubs(extra = []) {
    return stubFetch([
      ['/api/geo/country', { iso3: null, source: 'fallback' }],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/entities', { entities: [] }],
      ['/api/compare', { available: false, reason: 'stub_no_data' }],
      ...RANK_STUBS,
      ...YOY_STUBS,
      ...extra,
    ]);
  }

  it('view A → B → Back restores B state, Forward restores forward state', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    drawerGo(container, 'Overview');
    await flushReact(act);
    expect(triggerLabel(container)).toContain('Overview');
    drawerGo(container, 'Rank');
    await flushReact(act);
    expect(triggerLabel(container)).toContain('Rank');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('rank');

    await goBack();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('overview');
    expect(triggerLabel(container)).toContain('Overview');

    await goForward();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('rank');
    expect(triggerLabel(container)).toContain('Rank');
    cleanup();
  });

  it('country change participates in history', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/?view=overview');
    await flushReact(act);
    await pickCombo(container, 'f-country', 'United States');
    expect(new URLSearchParams(window.location.search).get('country')).toBe('USA');
    expect(container.querySelector('.app-header h1').textContent).toContain('United States');

    await goBack();
    expect(new URLSearchParams(window.location.search).get('country')).toBeNull();
    expect(container.querySelector('.app-header h1').textContent).toContain('India');
    cleanup();
  });

  it('metric change participates in history', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/?view=overview');
    await flushReact(act);
    // Metric options are subject-scoped: switching Analysis to Prices
    // selects that subject's first metric (CPI inflation).
    await pickCombo(container, 'f-subject', 'Prices');
    expect(new URLSearchParams(window.location.search).get('metric')).toBe('inflation_cpi');

    await goBack();
    expect(new URLSearchParams(window.location.search).get('metric')).toBe('nominal_current');
    cleanup();
  });

  it('rank sub-tab persists in the URL and across reload', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/?view=rank');
    await flushReact(act);
    const tableTab = [...container.querySelectorAll('.subtab')].find((el) => el.textContent === 'Full table');
    expect(tableTab).toBeTruthy();
    act(() => {
      tableTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('rankSub')).toBe('table');
    expect(container.textContent).toContain('Full country ranking');
    cleanup();
    document.body.innerHTML = '';

    // Reload with the shared URL: sub-tab B remains selected.
    const second = renderApp(window.location.search);
    await flushReact(act);
    expect(second.container.textContent).toContain('Full country ranking');
    expect(second.container.querySelector('.subtab-active').textContent).toBe('Full table');
    second.cleanup();
  });

  it('yoy sub-tab persists in the URL and across reload', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/?view=yoy');
    await flushReact(act);
    const verifyTab = [...container.querySelectorAll('.subtab')].find((el) => el.textContent.includes('Verify'));
    expect(verifyTab).toBeTruthy();
    act(() => {
      verifyTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('yoySub')).toBe('verify');
    cleanup();
    document.body.innerHTML = '';

    const second = renderApp(window.location.search);
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('yoySub')).toBe('verify');
    expect(second.container.querySelector('.subtab-active').textContent).toContain('Verify');
    second.cleanup();
  });

  it('compare deep link survives navigation away and back', async () => {
    stub = baseStubs();
    const url = '/?view=compare&cmpEntityA=country:USA&cmpEntityB=country:CHN&cmpMetric=total_current&cmpOp=level';
    const { container, cleanup } = renderApp(url);
    await flushReact(act);
    expect(container.textContent).toContain('United States');

    drawerGo(container, 'Overview');
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('overview');

    await goBack();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('compare');
    expect(new URLSearchParams(window.location.search).get('cmpEntityA')).toBe('country:USA');
    expect(container.textContent).toContain('United States');
    expect(container.textContent).toContain('China');
    cleanup();
  });

  it('rich analytical URL reloads into identical state', async () => {
    stub = baseStubs([
      ['/api/comparison/level', { comparison: { available: false, reason: 'stub' }, years: { a: 2004, b: 2014 }, focus: { iso3: 'USA', name: 'United States' }, metric: {}, universe: {}, economies: { rows: [] }, evidence: { vintage: {}, retrieval: {}, fingerprint: {}, freshness: {}, limits: [] } }],
    ]);
    const url = '/?view=movement&country=USA&metric=total_current&yearA=2004&yearB=2014&basis=growth';
    const { container, cleanup } = renderApp(url);
    await flushReact(act);
    expect(container.querySelector('.app-header h1').textContent).toBe('United States — 2004 → 2014');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('country')).toBe('USA');
    expect(params.get('metric')).toBe('total_current');
    expect(params.get('basis')).toBe('growth');
    expect(stub.calls.some((href) => href.includes('/api/comparison/level') && href.includes('country=USA') && href.includes('indicator=total_current'))).toBe(true);
    cleanup();
  });

  it('drawer navigates correctly at mobile width', async () => {
    window.__phase3MockMatchMedia = true;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    stub = baseStubs();
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    drawerGo(container, 'Data');
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('view')).toBe('data');
    expect(triggerLabel(container)).toContain('Data');
    expect(document.querySelector('.navdrawer-panel')).toBeNull();
    cleanup();
  });
});
