/**
 * DEFAULT-COUNTRY GEOLOCATION TESTS, PHASE 3 (Part B, frontend).
 *
 * Precedence under test: explicit URL country > in-session user choice >
 * IP-derived default > India fallback. Detection runs once at startup,
 * never overrides, never re-polls. Failures and invalid values keep the
 * fallback silently. No test touches the network.
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
    { iso3: 'DEU', name: 'Germany' },
    { iso3: 'JPN', name: 'Japan' },
    { iso3: 'CHN', name: 'China' },
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

function geoCalls(stub) {
  return stub.calls.filter((href) => href.includes('/api/geo/country'));
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

async function pickFocusCountry(container, name) {
  const btn = container.querySelector('#f-country');
  expect(btn).toBeTruthy();
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushReact(act);
  const option = [...document.querySelectorAll('.combo-option')].find((el) => el.textContent.includes(name));
  expect(option).toBeTruthy();
  act(() => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await flushReact(act);
}

describe('default-country geolocation precedence', () => {
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

  it('geo USA becomes the initial default', async () => {
    stub = stubFetch([
      ['/api/geo/country', { iso3: 'USA', source: 'geoip' }],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    expect(geoCalls(stub)).toHaveLength(1);
    expect(new URLSearchParams(window.location.search).get('country')).toBe('USA');
    drawerGo(container, 'Overview');
    await flushReact(act);
    expect(container.querySelector('.app-header h1').textContent).toContain('United States');
    cleanup();
  });

  it('geo DEU and JPN resolve to their countries', async () => {
    for (const [iso3] of [['DEU'], ['JPN']]) {
      stub = stubFetch([
        ['/api/geo/country', { iso3, source: 'geoip' }],
        ['/api/years', YEARS],
        ['/api/countries', COUNTRIES],
        ['/api/indicators', INDICATORS],
      ]);
      const { cleanup } = renderApp('/');
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
      expect(new URLSearchParams(window.location.search).get('country')).toBe(iso3);
      expect(geoCalls(stub)).toHaveLength(1);
      cleanup();
      stub.restore();
      stub = null;
      document.body.innerHTML = '';
      window.history.replaceState(null, '', '/');
    }
  });

  it('geo failure and invalid values keep the India fallback silently', async () => {
    for (const geo of [{ iso3: null, source: 'fallback' }, { iso3: 'XX', source: 'geoip' }, { iso3: '', source: 'geoip' }]) {
      stub = stubFetch([
        ['/api/geo/country', geo],
        ['/api/years', YEARS],
        ['/api/countries', COUNTRIES],
        ['/api/indicators', INDICATORS],
      ]);
      const { container, cleanup } = renderApp('/');
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
      expect(new URLSearchParams(window.location.search).get('country')).toBeNull();
      expect(container.textContent).toContain('Quality analysis of World Bank raw data');
      cleanup();
      stub.restore();
      stub = null;
      document.body.innerHTML = '';
      window.history.replaceState(null, '', '/');
    }
  });

  it('explicit URL country wins over geo and geo is never consulted', async () => {
    stub = stubFetch([
      ['/api/geo/country', { iso3: 'IND', source: 'geoip' }],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp('/?view=overview&country=USA');
    await flushReact(act);
    expect(geoCalls(stub)).toHaveLength(0);
    expect(container.querySelector('.app-header h1').textContent).toContain('United States');
    cleanup();
  });

  it('in-flight geo never overrides a faster manual choice', async () => {
    let resolveGeo = null;
    const gate = new Promise((resolve) => {
      resolveGeo = resolve;
    });
    stub = stubFetch([
      ['/api/geo/country', () => gate.then(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ iso3: 'USA', source: 'geoip' }) }))],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
    ]);
    const { container, cleanup } = renderApp('/?view=overview');
    await flushReact(act);
    await pickFocusCountry(container, 'China');
    await act(async () => {
      resolveGeo();
    });
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('country')).toBe('CHN');
    expect(container.querySelector('.app-header h1').textContent).toContain('China');
    cleanup();
  });

  it('manual choice survives navigation with no geo re-poll', async () => {
    stub = stubFetch([
      ['/api/geo/country', { iso3: 'USA', source: 'geoip' }],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/comparison/level', () => ({ error: { message: 'stub', code: 'STUB' } })],
    ]);
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('country')).toBe('USA');
    drawerGo(container, 'Overview');
    await flushReact(act);
    await pickFocusCountry(container, 'China');
    expect(new URLSearchParams(window.location.search).get('country')).toBe('CHN');
    for (const label of ['Rank', 'Movement', 'Data']) {
      drawerGo(container, label);
      // eslint-disable-next-line no-await-in-loop
      await flushReact(act);
      expect(new URLSearchParams(window.location.search).get('country')).toBe('CHN');
    }
    expect(geoCalls(stub)).toHaveLength(1);
    cleanup();
  });
});
