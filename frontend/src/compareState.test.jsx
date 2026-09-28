/**
 * COMPARE STATE TESTS, PHASE 3 (Part C).
 *
 * Canonical rule under test: Compare entity slots initialize ONCE from the
 * current focus when Compare is first entered with an empty slot; filled
 * slots (user selections, explicit URL params) are never rewritten by
 * focus changes elsewhere. cmp* URL params always round-trip, so any copied
 * URL reconstructs the workspace; malformed specs fail safe. Also pins the
 * Trajectory fan-out cap (≤31 sampled years per entity).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from './test-utils.js';
import App from './App.jsx';
import Compare from './sections/Compare.jsx';
import trajectoryFixture from './compareTrajectoryFixture.json';

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
    { iso3: 'JPN', name: 'Japan' },
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
  ],
  methodology: {},
};

const MOVEMENT_IND = {
  comparison: { available: true, mode: 'level' },
  years: { a: 2004, b: 2014 },
  focus: { iso3: 'IND', name: 'India' },
  metric: { key: 'nominal_current', unit: 'current US$', indicatorCode: 'NY.GDP.PCAP.CD' },
  focusMovement: {
    fullRankA: 8, fullRankB: 6, commonRankA: 9, commonRankB: 7,
    denominatorA: 180, denominatorB: 182, denominatorCommon: 170,
    positionNumberChange: -2, placesGained: 2, commonEffect: -2, observedSetEffect: 0,
    enteredAboveB: 1, enteredBelowB: 2, exitedAboveA: 1, exitedBelowA: 3,
  },
  universe: { membershipRule: 'valid observations', common: 170, setA: 180, setB: 182, entered: 3, exited: 4 },
  economies: { rows: [] },
  evidence: { vintage: {}, retrieval: {}, fingerprint: {}, freshness: {}, limits: [] },
};

const COMPARE_EMPTY = { available: false, reason: 'stub_no_data' };
const ENTITIES_EMPTY = { entities: [] };

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

function cmpParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

describe('compare state decoupling and URL reconstruction', () => {
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

  function baseStubs(extra = []) {
    return stubFetch([
      ['/api/geo/country', { iso3: null, source: 'fallback' }],
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/entities', ENTITIES_EMPTY],
      ['/api/compare', COMPARE_EMPTY],
      ['/api/comparison/level', MOVEMENT_IND],
      ...extra,
    ]);
  }

  it('compare defaults initialize once from the entry focus (India vs USA)', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    drawerGo(container, 'Compare');
    await flushReact(act);
    expect(cmpParam('cmpEntityA')).toBe('country:IND');
    expect(cmpParam('cmpEntityB')).toBe('country:USA');
    expect(container.textContent).toContain('India');
    cleanup();
  });

  it('changing focus elsewhere does not rewrite configured compare entities', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/');
    await flushReact(act);
    drawerGo(container, 'Compare');
    await flushReact(act);
    expect(cmpParam('cmpEntityA')).toBe('country:IND');

    // Leave Compare, change the global focus to Japan, return.
    drawerGo(container, 'Movement');
    await flushReact(act);
    const picker = container.querySelector('#mv-country');
    expect(picker).toBeTruthy();
    act(() => {
      picker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    const japan = [...document.querySelectorAll('.combo-option')].find((el) => el.textContent.includes('Japan'));
    expect(japan).toBeTruthy();
    act(() => {
      japan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushReact(act);
    expect(new URLSearchParams(window.location.search).get('country')).toBe('JPN');

    drawerGo(container, 'Compare');
    await flushReact(act);
    expect(cmpParam('cmpEntityA')).toBe('country:IND');
    expect(cmpParam('cmpEntityB')).toBe('country:USA');
    expect(container.textContent).toContain('India');
    cleanup();
  });

  it('explicit cmp params win and reload reconstructs the exact workspace', async () => {
    const url = '/?view=compare&cmpEntityA=country:USA&cmpEntityB=country:CHN&cmpMetric=total_current&cmpOp=level';
    stub = baseStubs();
    const first = renderApp(url);
    await flushReact(act);
    expect(first.container.textContent).toContain('United States');
    expect(first.container.textContent).toContain('China');
    expect(cmpParam('cmpEntityA')).toBe('country:USA');
    expect(cmpParam('cmpEntityB')).toBe('country:CHN');
    first.cleanup();
    document.body.innerHTML = '';

    // Fresh load of the same URL reconstructs identically.
    const second = renderApp(url);
    await flushReact(act);
    expect(second.container.textContent).toContain('United States');
    expect(second.container.textContent).toContain('China');
    // Explicit entities survive alongside a different focus country.
    expect(cmpParam('cmpEntityA')).toBe('country:USA');
    second.cleanup();
  });

  it('malformed cmp params fail safe without touching valid state', async () => {
    stub = baseStubs();
    const { container, cleanup } = renderApp('/?view=compare&cmpEntityA=garbage!!!&cmpEntityB=');
    await flushReact(act);
    // Builder renders its empty state; the malformed spec is preserved
    // verbatim (never reinterpreted), the empty slot fills deterministically.
    expect(container.textContent).toContain('Choose two entities');
    expect(cmpParam('cmpEntityA')).toBe('garbage!!!');
    expect(cmpParam('cmpEntityB')).toBe('country:USA');
    cleanup();
  });

  it('partially specified cmp state fills only the empty slot', async () => {
    stub = baseStubs();
    const { cleanup } = renderApp('/?view=compare&cmpEntityA=country:USA');
    await flushReact(act);
    expect(cmpParam('cmpEntityA')).toBe('country:USA');
    expect(cmpParam('cmpEntityB')).toBe('country:USA');
    cleanup();
  });

  it('trajectory fan-out stays capped for a 66-year span', async () => {
    const fullYears = Array.from({ length: 66 }, (_, i) => 1960 + i);
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, _options) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/api/observations')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ observation: { value: 1 } }) };
      }
      if (href.includes('/api/compare')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => trajectoryFixture };
      }
      if (href.includes('/api/entities')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ENTITIES_EMPTY };
      }
      throw new Error(`Unmocked fetch: ${href}`);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = () => {};
    try {
      act(() => {
        root.render(
          <Compare
            availableYears={fullYears}
            countries={COUNTRIES.countries}
            entityA="country:USA"
            entityB="country:CHN"
            labelA=""
            labelB=""
            metricKey="total_current"
            yearA={1960}
            yearB={2025}
            operation="level"
            groupMode="observed"
            onEntityA={noop}
            onEntityB={noop}
            onLabelA={noop}
            onLabelB={noop}
            onMetric={noop}
            onYearA={noop}
            onYearB={noop}
            onOperation={noop}
            onGroupMode={noop}
          />,
        );
      });
      await flushReact(act);
      const obsCalls = calls.filter((href) => href.includes('/api/observations'));
      // 66-year span samples to ≤31 years per entity, fetched in parallel.
      expect(obsCalls.length).toBeGreaterThan(0);
      expect(obsCalls.length).toBeLessThanOrEqual(62);
    } finally {
      globalThis.fetch = original;
      act(() => root.unmount());
      container.remove();
    }
  });
});
