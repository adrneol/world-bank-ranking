/**
 * FUTURE-YEAR SECTION RENDERING (movement, comparison, coverage).
 *
 * The previous future-year report verified the backing APIs with 2026 but
 * never RENDERED the React sections. This file closes that gap using the
 * repository's existing section harness (the same one movementFocus.test.jsx
 * and compareState.test.jsx use).
 *
 * The payloads are SYNTHETIC: the committed movement fixture is re-dated from
 * 2004/2014 to 2025/2026 so the sections receive a future-year payload
 * exactly as the backend would deliver one after a future release. They are
 * not World Bank data.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import CapitalMovement from './CapitalMovement.jsx';
import Compare from './Compare.jsx';
import Coverage from './Coverage.jsx';
import ExternalMovement from './ExternalMovement.jsx';
import FxMovement from './FxMovement.jsx';
import PopulationMovement from './PopulationMovement.jsx';
import PricesMovement from './PricesMovement.jsx';
import TradeMovement from './TradeMovement.jsx';
import fixtures from './movementUsaFixtures.json';
import { hydrateRegistry, METRICS, SUBJECTS } from '../config/metrics.js';

/**
 * jsdom reports zero-size containers, so Recharts renders nothing without a
 * measured box. Report a fixed plot size like a real layout would (the same
 * stub the chart harness uses).
 */
function stubPlotSize() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target) {
        this.callback([{ target, contentRect: { width: 600, height: 260 } }], this);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

beforeEach(() => {
  stubPlotSize();
  hydrateRegistry({
    subjects: Object.values(SUBJECTS).map(({ key, label }) => ({ key, label })),
    production: Object.values(METRICS).map((metric) => ({
      ...metric,
      label: metric.title,
      shortLabel: metric.shortTitle,
      observationType: metric.subject === 'gdp_total' ? 'FLOW' : 'LEVEL',
      validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
      periodAggregation: metric.subject === 'gdp_total' ? ['SUM', 'AVG'] : [],
      comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', ...(metric.aggregation === 'SUM' ? ['CUSTOM_GROUP'] : [])],
      rankingDirection: 'DESC',
    })),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  hydrateRegistry({
    subjects: Object.values(SUBJECTS).map(({ key, label }) => ({ key, label })),
    production: Object.values(METRICS).map((metric) => ({
      ...metric,
      label: metric.title,
      shortLabel: metric.shortTitle,
      observationType: metric.subject === 'gdp_total' ? 'FLOW' : 'LEVEL',
      validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
      periodAggregation: metric.subject === 'gdp_total' ? ['SUM', 'AVG'] : [],
      comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', ...(metric.aggregation === 'SUM' ? ['CUSTOM_GROUP'] : [])],
      rankingDirection: 'DESC',
    })),
  });
});

const FAMILIES = [
  { id: 'prices', Component: PricesMovement, endpoint: '/api/movement/prices', groups: '/api/prices/country-groups', metricKey: 'inflation_cpi', basis: 'cpi_inflation_cumulative' },
  { id: 'capital', Component: CapitalMovement, endpoint: '/api/movement/capital', groups: '/api/capital/country-groups', metricKey: 'fdi_inflows', basis: 'fdi_annual_value' },
  { id: 'fx', Component: FxMovement, endpoint: '/api/movement/fx', groups: '/api/fx/country-groups', metricKey: 'fx_official', basis: 'fx_annual_change' },
  { id: 'trade', Component: TradeMovement, endpoint: '/api/movement/trade', groups: '/api/trade/country-groups', metricKey: 'exports_current', basis: 'exp_annual_value' },
  { id: 'external', Component: ExternalMovement, endpoint: '/api/movement/external', groups: '/api/external/country-groups', metricKey: 'current_account', basis: 'ca_annual_gdp' },
  { id: 'population', Component: PopulationMovement, endpoint: '/api/movement/population', groups: '/api/population/country-groups', metricKey: 'population_total', basis: 'pop_annual_value' },
];

/** Re-date a payload from the fixture's 2004/2014 to the future years. */
function toFutureYears(payload, a, b) {
  const clone = structuredClone(payload);
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'year' && value === 2004) node[key] = a;
      else if (key === 'year' && value === 2014) node[key] = b;
      else walk(value);
    }
  };
  walk(clone);
  clone.years = { a, b, order: 'a_is_earlier' };
  return clone;
}

/** The option labels of an open year selector, with the selection marker removed. */
function optionTexts() {
  return [...document.querySelectorAll('.combo-option')].map((el) => el.textContent.replace('✓', '').trim());
}

function openSelector(container, id) {
  const trigger = container.querySelector(`#${id}`);
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return trigger;
}

describe.each(FAMILIES)('movement family with a future year ($id)', ({ Component, endpoint, groups, metricKey, basis, id }) => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  it('requests 2025 and 2026, offers 2026 and renders the future years', async () => {
    const payload = toFutureYears(fixtures[id], 2025, 2026);
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
          availableYears={[2004, 2014, 2025, 2026]}
          yearA={2025}
          yearB={2026}
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
    ctx = { stub, cleanup: () => act(() => root.unmount()) || container.remove() };
    await flushReact(act);

    // 1. The request carries the future years.
    const call = stub.calls.find((href) => href.includes(endpoint));
    expect(call).toBeTruthy();
    expect(call).toContain('yearA=2025');
    expect(call).toContain('yearB=2026');

    // 2. The year selector offers the future year (it is data-driven).
    const trigger = container.querySelector('#mv-yearB');
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('2026');
    openSelector(container, 'mv-yearB');
    await flushReact(act);
    expect(optionTexts()).toContain('2026');
    expect(optionTexts()).toContain('2025');
    act(() => {
      document.querySelector('.combo-filter')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // 3. The rendered movement payload uses the future years.
    expect(container.textContent).toContain('2026');
  });
});

describe('comparison section with a future year', () => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  /** A SYNTHETIC 2025-to-2026 comparison payload (2026 values are synthetic).
   *  A two-year comparison requires a change operation ('level' takes one
   *  year), so the payload uses the absolute-change shape. Interval results
   *  are part of the response: the UI never refetches or recalculates values. */
  const COMPARE_2026 = {
    available: true,
    metric: {
      key: 'nominal_current',
      label: 'Nominal — Current US$',
      unit: 'current US$',
      unitLong: 'current US$',
      indicatorCode: 'NY.GDP.PCAP.CD',
    },
    years: { a: 2025, b: 2026, c: null },
    operation: 'absolute_change',
    groupMode: 'observed',
    mode: 'observed',
    analysis: {
      id: 'absolute_change',
      label: 'Absolute change',
      requiredObservationYears: [2025, 2026],
      seriesYears: [2025, 2026],
      ignoredPeriods: [],
      boundary: { start: 2025, end: 2026, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' },
    },
    entities: {
      a: { kind: 'country', iso3: 'USA', name: 'United States' },
      b: { kind: 'country', iso3: 'IND', name: 'India' },
    },
    results: {
      a: {
        kind: 'country',
        iso3: 'USA',
        name: 'United States',
        observed: {
          2025: { available: true, reason: null, value: 78000, valueRaw: '78000', provenance: 'RAW', complete: true },
          2026: { available: true, reason: null, value: 81000, valueRaw: '81000', provenance: 'RAW', complete: true },
        },
        likeForLike: {
          2025: { available: true, reason: null, value: 78000, valueRaw: '78000', provenance: 'RAW', complete: true },
          2026: { available: true, reason: null, value: 81000, valueRaw: '81000', provenance: 'RAW', complete: true },
        },
        series: {
          basis: 'ENTITY_OWN_OBSERVATION',
          points: [
            { year: 2025, value: 78000, complete: true },
            { year: 2026, value: 81000, complete: true },
          ],
          partialYears: [],
        },
      },
      b: {
        kind: 'country',
        iso3: 'IND',
        name: 'India',
        observed: {
          2025: { available: true, reason: null, value: 2700, valueRaw: '2700', provenance: 'RAW', complete: true },
          2026: { available: true, reason: null, value: 2900, valueRaw: '2900', provenance: 'RAW', complete: true },
        },
        likeForLike: {
          2025: { available: true, reason: null, value: 2700, valueRaw: '2700', provenance: 'RAW', complete: true },
          2026: { available: true, reason: null, value: 2900, valueRaw: '2900', provenance: 'RAW', complete: true },
        },
        series: {
          basis: 'ENTITY_OWN_OBSERVATION',
          points: [
            { year: 2025, value: 2700, complete: true },
            { year: 2026, value: 2900, complete: true },
          ],
          partialYears: [],
        },
      },
      comparison: {
        available: true,
        reason: null,
        unit: 'current US$',
        a: { computable: true, value: 3000, unit: 'current US$' },
        b: { computable: true, value: 200, unit: 'current US$' },
        gap: { value: 2800, unit: 'current US$' },
        intervalResults: [{
          id: 'AB', label: 'A → B', start: 2025, end: 2026, kind: 'change',
          formula: 'B − A', unit: 'current US$', gapUnit: 'current US$', available: true,
          observations: {
            a: [{ year: 2025, value: 78000, unit: 'current US$', available: true, complete: true }, { year: 2026, value: 81000, unit: 'current US$', available: true, complete: true }],
            b: [{ year: 2025, value: 2700, unit: 'current US$', available: true, complete: true }, { year: 2026, value: 2900, unit: 'current US$', available: true, complete: true }],
          },
          a: { computable: true, value: 3000, unit: 'current US$' },
          b: { computable: true, value: 200, unit: 'current US$' },
          gap: { value: 2800, unit: 'current US$', reason: null },
        }],
        provenance: { kind: 'RAW' },
      },
    },
    universe: { counts: { candidates: 2, complete: 2, reference: 0 }, included: [], excluded: { participants: [], incomplete: [], distinct: [] } },
    diagnostics: [],
    vintage: { wbLastUpdated: '2026-10-08', mixedVintage: false },
    source: {},
  };

  it('requests the future year, offers it and renders the 2025-to-2026 result', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      [
        '/api/observations',
        { available: true, observation: { value: 2900, valueRaw: '2900', wbLastUpdated: '2026-10-08' } },
      ],
      ['/api/compare', COMPARE_2026],
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = () => {};
    act(() => {
      root.render(
        <Compare
          availableYears={[2004, 2014, 2025, 2026]}
          countries={[]}
          entityA="country:USA"
          entityB="country:IND"
          labelA=""
          labelB=""
          metricKey="nominal_current"
          yearA={2025}
          yearB={2026}
          yearC={null}
          operation="absolute_change"
          groupMode="observed"
          onEntityA={noop}
          onEntityB={noop}
          onLabelA={noop}
          onLabelB={noop}
          onMetric={noop}
          onYearA={noop}
          onYearB={noop}
          onYearC={noop}
          onOperation={noop}
          onGroupMode={noop}
        />,
      );
    });
    ctx = { stub, cleanup: () => act(() => root.unmount()) || container.remove() };
    await flushReact(act);

    // 1. The comparison request itself carries the future year, and the chart
    //    series comes from that response: no observations request is issued.
    const observationCalls = stub.calls.filter((href) => href.includes('/api/observations'));
    expect(observationCalls.length).toBe(0);
    const compareCall = stub.calls.find((href) => href.includes('/api/compare'));
    expect(compareCall).toBeTruthy();
    expect(compareCall).toContain('yearA=2025');
    expect(compareCall).toContain('yearB=2026');

    // 2. The year selectors offer the future year and show it as selected.
    const trigger = container.querySelector('#cmp-year-b');
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('2026');
    openSelector(container, 'cmp-year-b');
    await flushReact(act);
    expect(optionTexts()).toContain('2026');
    act(() => {
      document.querySelector('.combo-filter')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // 3. The result panel carries the future endpoint and charts the selected
    //    absolute-change result on an interval axis.
    expect(container.textContent).toContain('2026');
    const chartTicks = [...container.querySelectorAll('svg .recharts-cartesian-axis-tick-value')].map(
      (el) => el.textContent,
    );
    expect(container.textContent).toContain('Absolute change by interval');
    expect(container.textContent).toContain('3,000 current US$');
    expect(chartTicks).toContain('A → B');
  });
});

describe('coverage section with a future year', () => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  it('requests the future year and renders its counts', async () => {
    const stub = stubFetch([
      [
        '/api/coverage',
        {
          metrics: [
            {
              metric: { key: 'nominal_current' },
              eligibleUniverse: 217,
              validObservations: 230,
              missingObservations: 12,
              focus: { available: true, rank: 4, total: 217 },
            },
          ],
          yoy: { metrics: [] },
          explanation: null,
        },
      ],
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <Coverage year={2026} metricKey="nominal_current" subject="gdp_per_capita" country="IND" focusName="India" />,
      );
    });
    ctx = { stub, cleanup: () => act(() => root.unmount()) || container.remove() };
    await flushReact(act);

    const call = stub.calls.find((href) => href.includes('/api/coverage'));
    expect(call).toBeTruthy();
    expect(call).toContain('year=2026');
    // The section header names the year it covers.
    expect(container.textContent).toContain('2026');
    // The stored counts are rendered.
    expect(container.textContent).toContain('217');
    expect(container.textContent).toContain('230');
  });
});
