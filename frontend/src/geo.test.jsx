/**
 * DEFAULT-COUNTRY GEOLOCATION TESTS, PHASE 3 (Part B, frontend).
 *
 * Precedence under test: explicit URL country > in-session user choice >
 * IP-derived default > India fallback. Detection runs once at startup,
 * never overrides, never re-polls. Failures and invalid values keep the
 * fallback silently. No test touches the network.
 */
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    { iso3: 'GBR', name: 'United Kingdom' },
    { iso3: 'JPN', name: 'Japan' },
    { iso3: 'CHN', name: 'China' },
    { iso3: 'BRA', name: 'Brazil' },
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

let activeCleanup;
function renderApp(url, strict = false) {
  window.history.replaceState(null, '', url);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(strict ? <StrictMode><App /></StrictMode> : <App />);
  });
  let mounted = true;
  const cleanup = () => { if (!mounted) return; mounted = false; act(() => root.unmount()); container.remove(); };
  activeCleanup = cleanup;
  return { container, cleanup };
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
    activeCleanup?.(); activeCleanup = null;
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses an explicit eligible shared focus for fresh Compare A without a location lookup', async () => {
    stub = stubFetch([['/api/geo/country', { iso3: 'JPN', source: 'geoip' }], ['/api/years', YEARS],
      ['/api/countries', COUNTRIES], ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { cleanup } = renderApp('/compare/?country=USA');
    await flushReact(act);
    expect(new URLSearchParams(location.search).get('cmpEntityA')).toBe('country:USA');
    expect(new URLSearchParams(location.search).get('cmpEntityB')).toBeNull();
    expect(geoCalls(stub)).toHaveLength(0);
    cleanup();
  });

  it('does not let an invalid URL country block eligible geographic initialization', async () => {
    stub = stubFetch([['/api/geo/country', { iso3: 'JPN', source: 'geoip' }], ['/api/years', YEARS],
      ['/api/countries', COUNTRIES], ['/api/indicators', INDICATORS]]);
    const { cleanup } = renderApp('/overview/?country=ZZZ');
    await flushReact(act);
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    cleanup();
  });

  it('retries an initial location failure once after the country registry recovers', async () => {
    vi.useFakeTimers();
    let release;
    const registry = new Promise(resolve => { release = resolve; });
    let attempts = 0;
    stub = stubFetch([['/api/geo/country', async () => ++attempts === 1
      ? { ok: false, status: 503, json: async () => ({ error: { code: 'DATA_SERVICE_STARTING', message: 'Starting' } }) }
      : { ok: true, status: 200, json: async () => ({ iso3: 'JPN', source: 'geoip' }) }],
      ['/api/years', YEARS], ['/api/countries', () => registry], ['/api/indicators', INDICATORS]]);
    const { cleanup } = renderApp('/overview/');
    await flushReact(act, 12);
    release({ ok: true, status: 200, json: async () => COUNTRIES });
    await flushReact(act, 12); await act(() => vi.advanceTimersByTimeAsync(600)); await flushReact(act, 12);
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    expect(attempts).toBe(2);
    cleanup();
  });

  it.each(['overview', 'data', 'rank', 'yoy', 'movement', 'coverage', 'audit', 'compare'])('initializes a direct %s entry from the same validated identity', async view => {
    stub = stubFetch([['/api/location', { iso2: 'JP', source: 'frontend-edge' }], ['/api/years', YEARS],
      ['/api/countries', { countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'JPN' ? 'JP' : null })) }],
      ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { cleanup } = renderApp('/' + view + '/'); await flushReact(act);
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    if (view === 'compare') {
      expect(new URLSearchParams(location.search).get('cmpEntityA')).toBe('country:JPN');
      expect(new URLSearchParams(location.search).get('cmpEntityB')).toBeNull();
    }
    expect(stub.calls.filter(url => url === '/api/location')).toHaveLength(1);
    expect(geoCalls(stub)).toHaveLength(0);
    cleanup();
  });

  it.each([true, false])('retains a valid early edge result while the registry loads (public API %s)', async enabled => {
    let release;
    const registry = new Promise(resolve => { release = resolve; });
    stub = stubFetch([['/api/location', { iso2: 'BR', source: 'frontend-edge' }], ['/api/capabilities', { publicReadApiEnabled: enabled }],
      ['/api/years', YEARS], ['/api/countries', () => registry], ['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderApp('/overview/'); await flushReact(act);
    expect(container.textContent).toContain('Identifying your regional economy');
    expect(container.textContent).not.toContain('Select a focus economy to open');
    release({ ok: true, status: 200, json: async () => ({ countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'BRA' ? 'BR' : null })) }) });
    await flushReact(act);
    expect(new URLSearchParams(location.search).get('country')).toBe('BRA');
    expect(stub.calls.filter(url => url === '/api/location')).toHaveLength(1);
    cleanup();
  });

  it('waits for late location, preserves manual Compare A independently, and reuses focus across pages', async () => {
    let release;
    const edge = new Promise(resolve => { release = resolve; });
    stub = stubFetch([['/api/location', () => edge], ['/api/years', YEARS], ['/api/countries', { countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'JPN' ? 'JP' : null })) }],
      ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { container, cleanup } = renderApp('/compare/'); await flushReact(act);
    expect(container.textContent).toContain('Identifying your regional economy');
    release({ ok: true, status: 200, json: async () => ({ iso2: 'JP', source: 'frontend-edge' }) }); await flushReact(act);
    act(() => container.querySelector('#cmp-a').click());
    const usa = [...document.querySelectorAll('.combo-option')].find(option => option.textContent.includes('United States'));
    act(() => usa.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await flushReact(act);
    expect(new URLSearchParams(location.search).get('cmpEntityA')).toBe('country:USA');
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    for (const label of ['Overview', 'Data', 'Rank', 'Movement', 'YoY', 'Coverage', 'Audit']) {
      drawerGo(container, label); await flushReact(act);
      expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    }
    expect(stub.calls.filter(url => url === '/api/location')).toHaveLength(1);
    cleanup();
  });

  it('keeps one location flight through development StrictMode replay', async () => {
    stub = stubFetch([['/api/location', { iso2: 'JP', source: 'frontend-edge' }], ['/api/years', YEARS],
      ['/api/countries', { countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'JPN' ? 'JP' : null })) }], ['/api/indicators', INDICATORS]]);
    const { cleanup } = renderApp('/overview/', true); await flushReact(act, 12);
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    expect(stub.calls.filter(url => url === '/api/location')).toHaveLength(1);
    cleanup();
  });

  it('normalizes automatic focus in place while deliberate workspace navigation still creates history', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    stub = stubFetch([['/api/location', { iso2: 'JP', source: 'frontend-edge' }], ['/api/years', YEARS],
      ['/api/countries', { countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'JPN' ? 'JP' : null })) }], ['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderApp('/overview/'); await flushReact(act, 12);
    expect(new URLSearchParams(location.search).get('country')).toBe('JPN');
    expect(push).not.toHaveBeenCalled();
    drawerGo(container, 'Rank'); await flushReact(act);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore(); cleanup();
  });

  it.each(['USA', 'IND', 'GBR', 'JPN', 'DEU', 'BRA', 'ZZZ', 'BAD!', null])('uses only a registered geographic result for Compare A (%s)', async (iso3) => {
    stub = stubFetch([['/api/geo/country', { iso3, source: iso3 ? 'geoip' : 'fallback' }],
      ['/api/years', YEARS], ['/api/countries', COUNTRIES], ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { cleanup } = renderApp('/compare/');
    await flushReact(act);
    const query = new URLSearchParams(window.location.search);
    expect(query.get('cmpEntityA')).toBe(COUNTRIES.countries.some(row => row.iso3 === iso3) ? `country:${iso3}` : null);
    expect(query.get('cmpEntityB')).toBeNull();
    expect(geoCalls(stub)).toHaveLength(1);
    expect(stub.calls.some(url => url.includes('/api/compare?'))).toBe(false);
    cleanup();
  });

  it('keeps a manual Compare selection when geolocation resolves later', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    stub = stubFetch([['/api/geo/country', () => pending], ['/api/years', YEARS], ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { container, cleanup } = renderApp('/compare/');
    await flushReact(act);
    act(() => container.querySelector('#cmp-a').click());
    const japan = [...document.querySelectorAll('.combo-option')].find(option => option.textContent.includes('Japan'));
    act(() => japan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    release({ ok: true, status: 200, headers: new Headers(), json: async () => ({ iso3: 'USA', source: 'geoip' }) });
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('cmpEntityA')).toBe('country:JPN');
    expect(new URLSearchParams(window.location.search).get('cmpEntityB')).toBeNull();
    cleanup();
  });

  it('initializes focus and Compare A together without selecting B', async () => {
    stub = stubFetch([['/api/geo/country', { iso3: 'JPN', source: 'geoip' }],
      ['/api/years', YEARS], ['/api/countries', { countries: COUNTRIES.countries.map(row => ({ ...row, iso2: row.iso3 === 'JPN' ? 'JP' : 'XX' })) }],
      ['/api/indicators', INDICATORS], ['/api/entities', { entities: [] }]]);
    const { cleanup } = renderApp('/compare/');
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('country')).toBe('JPN');
    expect(new URLSearchParams(window.location.search).get('cmpEntityA')).toBe('country:JPN');
    expect(new URLSearchParams(window.location.search).get('cmpEntityB')).toBeNull();
    cleanup();
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

  it('geo failure and invalid values keep a neutral manual fallback', async () => {
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
