import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import Methodology from './Methodology.jsx';

const INDICATORS = {
  subjects: [{ key: 'prices', label: 'Prices' }],
  production: [
    {
      key: 'inflation_cpi',
      subject: 'prices',
      label: 'CPI inflation',
      shortLabel: 'CPI inflation',
      unit: 'annual %',
      indicatorCode: 'FP.CPI.TOTL.ZG',
      rankingDirection: 'ASC',
      pricesBases: [
        {
          id: 'cpi_inflation_annual',
          label: 'Annual CPI inflation (%)',
          description: 'Annual CPI inflation rate in the selected year.',
          formula: 'A(i,t) = Inflation(i,t)',
          unit: 'annual %',
          rankable: true,
          rankDirection: 'ASC',
          rankWording: 'Ranked by lower annual CPI inflation',
          requiresSequence: false,
        },
        {
          id: 'cpi_inflation_cumulative',
          label: 'Cumulative CPI inflation (%)',
          description: 'Compounded total increase over S+1 through E.',
          formula: '[prod(t=S+1..E)(1+Inflation(t)/100) - 1] * 100',
          unit: '%',
          rankable: true,
          rankDirection: 'ASC',
          rankWording: 'Ranked by lower cumulative increase',
          requiresSequence: true,
        },
      ],
    },
  ],
  methodology: { universeRule: 'eligible only', pricesMovement: 'Prices paragraph.' },
};

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Methodology />);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

function clickButton(container, text) {
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent.includes(text));
  if (!button) throw new Error(`button not found: ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickReadForBasis(container, basisLabel) {
  const card = [...container.querySelectorAll('article.card')].find((el) =>
    [...el.querySelectorAll('h3')].some((h) => h.textContent === basisLabel),
  );
  const button = card?.querySelector('button');
  if (!button) throw new Error(`read button not found for basis: ${basisLabel}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickBreadcrumb(container, text) {
  const region = container.querySelector('[aria-label="Methodology location"]');
  const button = [...(region?.querySelectorAll('button') ?? [])].find((el) => el.textContent === text);
  if (!button) throw new Error(`breadcrumb button not found: ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Methodology page', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('opens on family cards with no dropdown filter bar', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderPage();
    expect(container.textContent).toContain('Loading methodology catalog');
    await flushReact(act);
    expect(container.querySelector('#m-family')).toBeNull();
    expect(container.querySelector('#m-metric')).toBeNull();
    expect(container.querySelector('#m-basis')).toBeNull();
    expect(container.textContent).toContain('Prices');
    expect(container.textContent).toContain('1 metric');
    cleanup();
  });

  it('browses family to metric to basis cards and shows traced detail', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderPage();
    await flushReact(act);

    clickButton(container, 'Explore →');
    await flushReact(act);
    // Metric level: only this family's metrics.
    expect(container.textContent).toContain('Prices metrics');
    expect(container.textContent).toContain('CPI inflation');
    clickButton(container, 'Explore →');
    await flushReact(act);

    // Basis level: only this metric's bases.
    expect(container.textContent).toContain('Annual CPI inflation (%)');
    expect(container.textContent).toContain('Cumulative CPI inflation (%)');
    clickReadForBasis(container, 'Cumulative CPI inflation (%)');
    await flushReact(act);

    const crumbs = container.querySelector('nav.crumbs[aria-label="Methodology location"]');
    expect(crumbs).not.toBeNull();
    expect(crumbs.querySelector('.crumb-sep').textContent).toBe('›');
    expect(crumbs.querySelector('.crumb-current').textContent).toBe('Cumulative CPI inflation (%)');
    expect(crumbs.textContent).toContain('Prices');
    expect(container.textContent).toContain('[prod(t=S+1..E)(1+Inflation(t)/100) - 1] * 100');
    expect(container.textContent).toContain('Ranked by lower cumulative increase');
    // Substantive per-basis content (not generic catalog text).
    expect(container.textContent).toContain('How it is calculated');
    expect(container.textContent).toContain('Full sequence S+1 through E');
    expect(container.textContent).toContain('Why this basis is distinct');
    expect(container.textContent).toContain('Do not compute cumulative inflation by adding annual rates');
    // Source attribution names the friendly methodology source (no raw paths).
    expect(container.textContent).toContain('CPI inflation methodology');
    expect(container.textContent).not.toContain('cpiInflationmethodology.txt');
    expect(container.textContent).toContain('FP.CPI.TOTL.ZG');
    cleanup();
  });

  it('navigates back through breadcrumbs and back links', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderPage();
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    clickReadForBasis(container, 'Cumulative CPI inflation (%)');
    await flushReact(act);
    expect(container.textContent).toContain('Cumulative CPI inflation (%)');

    // Breadcrumb parent navigates to the metric level.
    clickBreadcrumb(container, 'CPI inflation');
    await flushReact(act);
    expect(container.textContent).toContain('CPI inflation bases');
    expect(container.textContent).not.toContain('How it is calculated');

    // Back link returns to the family level.
    clickButton(container, '← Back to Prices');
    await flushReact(act);
    expect(container.textContent).toContain('Prices metrics');

    // Breadcrumb root returns to all families.
    clickBreadcrumb(container, 'Methodology');
    await flushReact(act);
    expect(container.textContent).toContain('1 metric');
    cleanup();
  });

  it('explains annual vs cumulative distinctly per basis', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, cleanup } = renderPage();
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    // Two basis cards; choose the annual one (first in catalog order).
    const reads = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Read methodology →');
    expect(reads).toHaveLength(2);
    act(() => {
      reads[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushReact(act);
    expect(container.textContent).toContain('No transformation');
    expect(container.textContent).toContain('Single selected year');
    cleanup();
  });

  it('fails closed with a truthful fallback when the catalog is malformed', async () => {
    stub = stubFetch([['/api/indicators', { production: [], subjects: [] }]]);
    const { container, cleanup } = renderPage();
    await flushReact(act);
    expect(container.textContent).toContain('methodology unavailable');
    expect(container.textContent).toContain('could not be loaded');
    expect(container.querySelector('#m-family')).toBeNull();
    cleanup();
  });

  it('renders explicit formula states for GDP bases (equation vs prose, never blank)', async () => {
    stub = stubFetch([
      [
        '/api/indicators',
        {
          subjects: [{ key: 'gdp_total', label: 'Total GDP' }],
          production: [
            {
              key: 'total_current',
              subject: 'gdp_total',
              label: 'Total GDP nominal',
              shortLabel: 'Nominal',
              unit: 'current US$',
              indicatorCode: 'NY.GDP.MKTP.CD',
              rankingDirection: 'DESC',
              observationType: 'LEVEL',
              validChangeTypes: ['ABSOLUTE', 'YOY'],
              periodAggregation: ['SUM', 'AVG'],
            },
          ],
          methodology: {},
        },
      ],
    ]);
    const { container, cleanup } = renderPage();
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    // Level: stored observation, explicit prose, no equation box.
    clickReadForBasis(container, 'Level (stored value)');
    await flushReact(act);
    expect(container.textContent).toContain('No separate formula');
    expect(container.textContent).toContain('stored World Bank observation');
    expect(container.querySelector('.formula-scroll')).toBeNull();
    // Back out and open growth: documented operation equation renders.
    clickBreadcrumb(container, 'Total GDP');
    await flushReact(act);
    clickButton(container, 'Explore →');
    await flushReact(act);
    clickReadForBasis(container, 'Growth (YoY / period endpoint change)');
    await flushReact(act);
    const formula = container.querySelector('.formula-scroll');
    expect(formula).toBeTruthy();
    expect(formula.textContent).toContain('((current / previous) - 1) * 100');
    // Units fall back to the metric unit rather than vanishing.
    expect(container.textContent).toContain('current US$');
    cleanup();
  });
});
