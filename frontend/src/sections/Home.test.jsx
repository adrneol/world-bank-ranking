import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import Home from './Home.jsx';

const INDICATORS = {
  subjects: [
    { key: 'prices', label: 'Prices' },
    { key: 'trade', label: 'Trade' },
  ],
  production: [
    { key: 'inflation_cpi', subject: 'prices', label: 'CPI inflation', shortLabel: 'CPI inflation', unit: 'annual %', indicatorCode: 'FP.CPI.TOTL.ZG' },
    { key: 'exports_current', subject: 'trade', label: 'Exports', shortLabel: 'Exports', unit: 'current US$', indicatorCode: 'NE.EXP.GNFS.CD' },
  ],
  methodology: {},
};

function renderHome(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const merged = { sourceName: 'World Bank WDI', onOpenView: vi.fn(), onOpenSubject: vi.fn(), ...props };
  act(() => {
    root.render(<Home {...merged} />);
  });
  return { container, root, props: merged, cleanup: () => act(() => root.unmount()) || container.remove() };
}

describe('Home page', () => {
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
    document.body.innerHTML = '';
  });

  it('renders hero, provenance and backend-driven family cards', async () => {
    stub = stubFetch([['/api/indicators', INDICATORS]]);
    const { container, props, cleanup } = renderHome({});
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    expect(container.textContent).toContain('Prices');
    expect(container.textContent).toContain('Trade');
    expect(container.textContent).not.toContain('nominal_current');
    const explore = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Explore analysis');
    act(() => {
      explore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.onOpenView).toHaveBeenCalledWith('overview');
    const openPrices = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Open in Movement'));
    expect(openPrices.className).toContain('home-card-link');
    act(() => {
      openPrices.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.onOpenSubject).toHaveBeenCalledWith('prices');
    cleanup();
  });

  it('shows static content plus a truthful fallback when metadata fails', async () => {
    stub = stubFetch([['/api/indicators', () => Promise.reject(new Error('down'))]]);
    const { container, cleanup } = renderHome({});
    await flushReact(act);
    expect(container.textContent).toContain('Quality analysis of World Bank raw data');
    expect(container.textContent).toContain('Source and provenance');
    expect(container.textContent).toMatch(/unavailable|Could not load/);
    cleanup();
  });
});
