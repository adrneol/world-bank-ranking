/**
 * FOCUS-COUNTRY CORRECTNESS TESTS, PHASE 2 (application level).
 *
 * TEST 7 — omitted focus props fall back to the legitimate product default
 * (India), never to a wrong country.
 * TEST 8 — the application's default (no ?country=) movement view is India.
 * TEST 9 — deep links (?country=USA / ?country=CHN) drive the generic
 * movement UI to the selected focus with no India narrative.
 *
 * Note: the global FocusPicker legitimately lists every country (including
 * India) as an option, so these tests assert on narrative/relation strings,
 * not on a blanket absence of the word "India".
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from './test-utils.js';
import App from './App.jsx';
import RankMovement from './sections/RankMovement.jsx';

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

function movementPayload(focus, otherIso, otherName) {
  return {
    comparison: { available: true, mode: 'level' },
    years: { a: 2004, b: 2014 },
    focus,
    metric: { key: 'nominal_current', unit: 'current US$', indicatorCode: 'NY.GDP.PCAP.CD' },
    focusMovement: {
      fullRankA: 8,
      fullRankB: 6,
      commonRankA: 9,
      commonRankB: 7,
      denominatorA: 180,
      denominatorB: 182,
      denominatorCommon: 170,
      positionNumberChange: -2,
      placesGained: 2,
      commonEffect: -2,
      observedSetEffect: 0,
      enteredAboveB: 1,
      enteredBelowB: 2,
      exitedAboveA: 1,
      exitedBelowA: 3,
    },
    universe: { membershipRule: 'valid observations', common: 170, setA: 180, setB: 182, entered: 3, exited: 4 },
    economies: {
      rows: [
        {
          iso3: focus.iso3, name: focus.name, status: 'common',
          rankA: 8, rankB: 6, valueA: 1, valueB: 2, displayA: 'a', displayB: 'b',
          relationToFocus: 'tie', relationToFocusA: 'tie', relationToFocusB: 'tie',
        },
        {
          iso3: otherIso, name: otherName, status: 'entered',
          rankB: 3, displayB: 'z', relationToFocus: 'above', affectsFocusPosition: true,
        },
      ],
    },
    evidence: {
      vintage: {}, retrieval: {}, fingerprint: {}, freshness: {}, limits: [],
    },
  };
}

const INDIA_NARRATIVES = [
  'Above India',
  'Below India',
  'Relation to India',
  "Affects India's",
  "India's position",
  'India ranking',
  'Crossed India',
  'vs India',
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

function openCollapsibleLists(container) {
  for (let i = 0; i < 6; i += 1) {
    const btn = [...container.querySelectorAll('button')].find((el) =>
      /^Show (entered|common|outside)/.test(el.textContent),
    );
    if (!btn) return;
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
}

describe('application focus-country behavior', () => {
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

  it('TEST 7 — omitted focus props resolve to the India product default', async () => {
    stub = stubFetch([[`/api/comparison/level`, movementPayload({ iso3: 'IND', name: 'India' }, 'USA', 'United States')]]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = () => {};
    act(() => {
      root.render(
        <RankMovement
          availableYears={[2004, 2014]}
          yearA={2004}
          yearB={2014}
          metricKey="nominal_current"
          basis="level"
          onYearA={noop}
          onYearB={noop}
          onYearMid={noop}
          onMetric={noop}
          onBasis={noop}
          onCountry={noop}
        />,
      );
    });
    await flushReact(act);
    // No country/focusName props: the documented default contract is India,
    // requested as IND — never a different country.
    expect(stub.calls.some((href) => href.includes('country=IND'))).toBe(true);
    expect(container.textContent).toContain('Above India');
    openCollapsibleLists(container);
    await flushReact(act);
    expect(container.querySelector('tr.row-focus')?.textContent).toContain('India');
    act(() => root.unmount());
    container.remove();
  });

  it('TEST 8 — default movement view (no ?country=) is India', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/comparison/level', movementPayload({ iso3: 'IND', name: 'India' }, 'USA', 'United States')],
    ]);
    const { container, cleanup } = renderApp('/?view=movement');
    await flushReact(act);
    const header = container.querySelector('.app-header');
    expect(header.querySelector('h1').textContent).toBe('India — 2004 → 2014');
    expect(container.textContent).toContain('Above India');
    openCollapsibleLists(container);
    await flushReact(act);
    expect(container.querySelector('tr.row-focus')?.textContent).toContain('India');
    cleanup();
  });

  it('TEST 9 — deep link ?country=USA drives movement to the United States', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/comparison/level', movementPayload({ iso3: 'USA', name: 'United States' }, 'CHN', 'China')],
    ]);
    const { container, cleanup } = renderApp('/?view=movement&country=USA');
    await flushReact(act);
    expect(stub.calls.some((href) => href.includes('/api/comparison/level') && href.includes('country=USA'))).toBe(true);
    const header = container.querySelector('.app-header');
    expect(header.querySelector('.eyebrow').textContent).toBe('World Bank WDI · USA');
    expect(header.querySelector('h1').textContent).toBe('United States — 2004 → 2014');
    expect(container.textContent).toContain('Above United States');
    openCollapsibleLists(container);
    await flushReact(act);
    expect(container.querySelector('tr.row-focus')?.textContent).toContain('United States');
    for (const text of INDIA_NARRATIVES) {
      expect(container.textContent).not.toContain(text);
    }
    cleanup();
  });

  it('TEST 9 — deep link ?country=CHN drives movement to China', async () => {
    stub = stubFetch([
      ['/api/years', YEARS],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/comparison/level', movementPayload({ iso3: 'CHN', name: 'China' }, 'USA', 'United States')],
    ]);
    const { container, cleanup } = renderApp('/?view=movement&country=CHN');
    await flushReact(act);
    expect(stub.calls.some((href) => href.includes('/api/comparison/level') && href.includes('country=CHN'))).toBe(true);
    const header = container.querySelector('.app-header');
    expect(header.querySelector('h1').textContent).toBe('China — 2004 → 2014');
    expect(container.textContent).toContain('Above China');
    openCollapsibleLists(container);
    await flushReact(act);
    expect(container.querySelector('tr.row-focus')?.textContent).toContain('China');
    for (const text of INDIA_NARRATIVES) {
      expect(container.textContent).not.toContain(text);
    }
    cleanup();
  });
});
