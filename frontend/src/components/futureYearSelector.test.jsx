/**
 * FRONTEND YEAR SELECTION WITH A NEWLY PUBLISHED YEAR.
 *
 * Verifies that the year selector, the default selection and the API calls
 * are driven by the AVAILABLE YEARS the backend reports - not by a fixed
 * year. The fixture payload simply contains 2026; the 2026 rows in the
 * backend database are exercised by the backend test
 * `futureYearPropagation.test.js`.
 *
 * No World Bank data is involved: this is a synthetic /api/years payload.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import App from '../App.jsx';

/** The same shape the backend serves, with 2026 as the newest stored year. */
const YEARS_WITH_2026 = {
  years: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
  minYear: 2020,
  maxYear: 2026,
  // The CONFIGURED default end year stays 2025 (it is a default, not a cap).
  defaults: { startYear: 2020, endYear: 2025 },
  perMetric: {
    nominal_current: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
    remittances_received: [2020, 2021, 2022, 2023, 2024, 2025],
  },
};

const COUNTRIES = {
  countries: [
    { iso3: 'IND', name: 'India' },
    { iso3: 'USA', name: 'United States' },
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

const RANKING = {
  available: true,
  metric: { key: 'nominal_current' },
  year: 2026,
  total: 2,
  eligibleUniverse: 2,
  page: 1,
  pageSize: 50,
  pages: 1,
  rows: [
    { rank: 1, iso3: 'USA', country: 'United States', rawValue: 80000, displayValue: '80,000' },
    { rank: 2, iso3: 'IND', country: 'India', rawValue: 2700, displayValue: '2,700' },
  ],
  search: { query: null, matchCount: 0, matches: [] },
  focus: null,
  columns: ['rank', 'country', 'iso3', 'rawValue', 'displayValue'],
  source: {},
  notes: [],
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

/** A catch-all so the analytical view's other requests do not fail the test. */
const CATCH_ALL = ['/api/', () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({}) })];

/** The option labels, with the "selected" marker removed. */
function optionTexts() {
  return [...document.querySelectorAll('.combo-option')].map((el) => el.textContent.replace('✓', '').trim());
}

describe('frontend year selection follows the available years', () => {
  let stub = null;
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=rank');
  });
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('offers 2026 in the year selector and selects it by default', async () => {
    stub = stubFetch([
      ['/api/years', YEARS_WITH_2026],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/ranking', RANKING],
      CATCH_ALL,
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    // The default selected year is the NEWEST AVAILABLE year (2026), even
    // though the configured default end year is still 2025.
    const trigger = container.querySelector('#f-year');
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('2026');

    // The API is asked for 2026.
    const rankingCall = stub.calls.find((c) => c.includes('/api/ranking'));
    expect(rankingCall).toBeTruthy();
    expect(rankingCall).toContain('year=2026');

    // The option list contains 2026 AND the historical years.
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    const options = optionTexts();
    expect(options).toContain('2026');
    expect(options).toContain('2025');
    expect(options).toContain('2020');
    cleanup();
  });

  it('still allows a historical year to be selected', async () => {
    stub = stubFetch([
      ['/api/years', YEARS_WITH_2026],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/ranking', RANKING],
      CATCH_ALL,
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    const trigger = container.querySelector('#f-year');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    const target = [...document.querySelectorAll('.combo-option')].find((el) => el.textContent === '2021');
    expect(target).toBeTruthy();
    act(() => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushReact(act);

    expect(container.querySelector('#f-year').textContent).toContain('2021');
    const rankingCall = stub.calls.filter((c) => c.includes('/api/ranking')).pop();
    expect(rankingCall).toContain('year=2021');
    cleanup();
  });

  it('does not offer a year the backend did not report', async () => {
    stub = stubFetch([
      [
        '/api/years',
        {
          years: [2020, 2021, 2022, 2023, 2024, 2025],
          minYear: 2020,
          maxYear: 2025,
          defaults: { startYear: 2020, endYear: 2025 },
          perMetric: {},
        },
      ],
      ['/api/countries', COUNTRIES],
      ['/api/indicators', INDICATORS],
      ['/api/ranking', RANKING],
      CATCH_ALL,
    ]);
    const { container, cleanup } = renderApp();
    await flushReact(act);

    const trigger = container.querySelector('#f-year');
    expect(trigger.textContent).toContain('2025');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    const options = optionTexts();
    expect(options).not.toContain('2026');
    cleanup();
  });

  it('an already-open page picks up a newly published year through the status watcher', async () => {
    // The App's background watcher polls the side-effect-free status endpoint
    // and re-reads the data when the dataset fingerprint advances. This is
    // the existing design (App.jsx, "Background TTL-refresh revalidation");
    // no new polling or scheduler is introduced.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const YEARS_2025 = {
        years: [2020, 2021, 2022, 2023, 2024, 2025],
        minYear: 2020,
        maxYear: 2025,
        defaults: { startYear: 2020, endYear: 2025 },
        perMetric: {},
      };
      const YEARS_2026 = {
        years: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
        minYear: 2020,
        maxYear: 2026,
        defaults: { startYear: 2020, endYear: 2025 },
        perMetric: {},
      };
      let published = false;
      const statusPayload = (runId) => ({
        empty: false,
        observations: published ? 230115 : 228776,
        fresh: true,
        lastSuccessAt: published ? '2026-10-09T21:20:43.768Z' : '2026-07-13T00:00:00.000Z',
        lastDataChangeAt: published ? '2026-10-09T21:20:43.768Z' : '2026-07-13T00:00:00.000Z',
        wbLastUpdated: published ? '2026-10-08' : '2026-07-13',
        ageHours: 1,
        ttlHours: 24,
        refreshDue: false,
        inProgress: false,
        progress: null,
        lock: { locked: false },
        integrity: { passed: true, checks: [] },
        autoRefresh: { enabled: true },
        refreshRequiresAuth: true,
        fingerprint: {
          runId,
          lastSuccessAt: published ? '2026-10-09T21:20:43.768Z' : '2026-07-13T00:00:00.000Z',
          maxFetchedAt: published ? '2026-10-09T21:20:43.768Z' : '2026-07-13T00:00:00.000Z',
          observationCount: published ? 230115 : 228776,
        },
        refreshOutcome: { checked: 20, updated: published ? 20 : 0, unchanged: published ? 0 : 20, failed: 0, notAttempted: 0, total: 20 },
        lastRefresh: { status: 'success' },
        latestRuns: [],
        years: { years: published ? YEARS_2026.years : YEARS_2025.years, minYear: 2020, maxYear: published ? 2026 : 2025, perMetric: {}, defaults: { startYear: 2020, endYear: 2025 } },
      });

      stub = stubFetch([
        // NOTE: a function route must return a FULL response object (the
        // stub does not wrap function results).
        [
          '/api/years',
          () => ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => (published ? YEARS_2026 : YEARS_2025),
          }),
        ],
        [
          '/api/data-status',
          () => ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => statusPayload(published ? 2 : 1),
          }),
        ],
        ['/api/countries', COUNTRIES],
        ['/api/indicators', INDICATORS],
        ['/api/ranking', RANKING],
        CATCH_ALL,
      ]);
      const { container, cleanup } = renderApp();
      await flushReact(act);

      // Before the new release: 2026 is not offered.
      expect(container.querySelector('#f-year')?.textContent).toContain('2025');

      // The watcher's first check adopts the CURRENT generation (it never
      // revalidates on the first observation).
      await vi.advanceTimersByTimeAsync(31_000);
      await flushReact(act);
      expect(container.querySelector('#f-year')?.textContent).toContain('2025');

      // A background refresh publishes the new release (a NEW fingerprint).
      published = true;
      await vi.advanceTimersByTimeAsync(61_000);
      await flushReact(act);

      // The open page now offers the new year and asks the backend for it.
      expect(container.querySelector('#f-year')?.textContent).toContain('2026');
      const rankingCall = stub.calls.filter((c) => c.includes('/api/ranking')).pop();
      expect(rankingCall).toContain('year=2026');
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
