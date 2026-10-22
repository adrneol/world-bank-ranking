/**
 * FUTURE-YEAR CHART RENDERING (2026 and 2027).
 *
 * The previous future-year report inspected the chart components but never
 * RENDERED them with a future-year dataset. This file closes that gap with
 * the repository's existing chart harness (jsdom + the Recharts
 * ResizeObserver stub used by chartInteraction.test.jsx).
 *
 * The values below are SYNTHETIC (they stand in for what a future World Bank
 * release would contain); they are not World Bank data.
 *
 * DOCUMENTED LIMITATION: jsdom lacks the geometry Recharts needs to resolve a
 * hovered payload, so the FILLED TOOLTIP CONTENT cannot be asserted here.
 * The repository's own chartInteraction.test.jsx documents the same
 * limitation ("tooltip fill proven in-browser"). The strongest available
 * equivalent is used instead: the rendered X-AXIS TICK TEXT (the same value
 * the tooltip labels with) plus the rendered point/dot geometry and the
 * data-level assertions on the chart's own adapter (alignSeries /
 * toBarEntries).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BarComparisonChart from './BarComparisonChart.jsx';
import SlopeChart from './SlopeChart.jsx';
import TimeSeriesChart from './TimeSeriesChart.jsx';
import { alignSeries, sortPoints, toBarEntries } from './chartData.js';

function renderChart(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

/** jsdom reports zero-size containers, so Recharts renders nothing without a
 *  measured box. Report a fixed plot size like a real layout would. */
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

/** Every rendered axis tick text (Recharts 3 renders ticks in their own layer). */
function axisTicks(container) {
  return [...container.querySelectorAll('svg .recharts-cartesian-axis-tick-value')].map((el) => el.textContent);
}

beforeEach(() => {
  stubPlotSize();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('TimeSeriesChart with a future-year point', () => {
  it('renders the 2026 point, puts 2026 on the X axis and keeps the history', () => {
    const series = [
      {
        label: 'India',
        points: [
          { x: 2024, y: 2500 },
          { x: 2025, y: 2700 },
          { x: 2026, y: 2900 },
        ],
      },
      {
        label: 'USA',
        // The USA has no 2026 observation: the leg must stay missing.
        points: [
          { x: 2024, y: 76000 },
          { x: 2025, y: 78000 },
        ],
      },
    ];
    const { container, cleanup } = renderChart(
      <TimeSeriesChart series={series} unit="current US$" decimals={0} />,
    );
    try {
      expect(container.querySelector('.chart-plot .recharts-line-curve')).toBeTruthy();

      const ticks = axisTicks(container);
      expect(ticks).toContain('2026');
      expect(ticks).toContain('2024');
      expect(ticks).toContain('2025');

      // Two series, three points each -> six rendered dots, and the India
      // series' THIRD dot (the future year) is the right-most one.
      const dots = [...container.querySelectorAll('.recharts-line-dot')];
      expect(dots.length).toBe(5);
      const indiaDots = dots.slice(0, 3);
      const xs = indiaDots.map((d) => Number(d.getAttribute('cx')));
      expect(xs[2]).toBeGreaterThan(xs[1]);
      expect(xs[1]).toBeGreaterThan(xs[0]);
      // The missing 2026 leg produced no fourth dot for that series.
      expect(dots.length).toBe(5);

      // The axis domain follows the data: no fixed end year.
      expect(Math.max(...ticks.filter((t) => /^\d{4}$/.test(t)).map(Number))).toBe(2026);
    } finally {
      cleanup();
    }
  });

  it('a 2027 point extends the axis the same way (nothing is tailored to 2026)', () => {
    const { container, cleanup } = renderChart(
      <TimeSeriesChart
        series={[{ label: 'India', points: [{ x: 2025, y: 2700 }, { x: 2026, y: 2900 }, { x: 2027, y: 3100 }] }]}
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      const ticks = axisTicks(container);
      expect(ticks).toContain('2027');
      expect(ticks).toContain('2026');
      expect(container.querySelectorAll('.recharts-line-dot').length).toBe(3);
    } finally {
      cleanup();
    }
  });

  it('the chart adapter keeps a missing future year missing (never zero-filled)', () => {
    const aligned = alignSeries([
      { label: 'India', points: [{ x: 2025, y: 2700 }, { x: 2026, y: 2900 }] },
      { label: 'USA', points: [{ x: 2025, y: 78000 }] },
    ]);
    const row2026 = aligned.rows.find((r) => r.x === 2026);
    expect(row2026).toBeTruthy();
    expect(row2026.s0).toBe(2900);
    expect(row2026.s1).toBeNull();
    // The ordering is ascending and nothing is dropped.
    expect(aligned.rows.map((r) => r.x)).toEqual([2025, 2026]);
    expect(sortPoints([{ x: 2026, y: 1 }, { x: 2025, y: 2 }]).map((p) => p.x)).toEqual([2025, 2026]);
  });
});

describe('BarComparisonChart with future-year data', () => {
  it('renders one bar per country and no bar for a missing observation', () => {
    const entries = [
      { name: 'India', value: 2900 },
      { name: 'USA', value: 81000 },
      { name: 'Brazil', value: null },
    ];
    const { container, cleanup } = renderChart(
      <BarComparisonChart entries={entries} unit="current US$" decimals={0} />,
    );
    try {
      const bars = container.querySelectorAll('.chart-plot .recharts-bar-rectangle path');
      // India and the USA render a bar; the missing country renders none.
      expect(bars.length).toBe(2);
      const ticks = axisTicks(container);
      expect(ticks).toContain('India');
      expect(ticks).toContain('USA');
      expect(ticks).toContain('Brazil');
    } finally {
      cleanup();
    }
  });

  it('renders a grouped 2025-versus-2026 comparison with both years on the axis', () => {
    const { container, cleanup } = renderChart(
      <BarComparisonChart
        entries={[
          { x: '2025', a: 2700, b: 78000 },
          { x: '2026', a: 2900, b: 81000 },
        ]}
        series={[
          { key: 'a', label: '2025' },
          { key: 'b', label: '2026' },
        ]}
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      const ticks = axisTicks(container);
      expect(ticks).toContain('2025');
      expect(ticks).toContain('2026');
      // Two categories x two series = four bars.
      expect(container.querySelectorAll('.chart-plot .recharts-bar-rectangle path').length).toBe(4);
    } finally {
      cleanup();
    }
  });

  it('the bar adapter passes values through verbatim (a missing value stays null)', () => {
    expect(toBarEntries([{ name: 'India', value: 2900 }, { name: 'USA', value: null }])).toEqual([
      { name: 'India', value: 2900 },
      { name: 'USA', value: null },
    ]);
  });
});

describe('SlopeChart with a 2025-to-2026 comparison', () => {
  it('renders both endpoints and labels them with the compared years', () => {
    const { container, cleanup } = renderChart(
      <SlopeChart
        items={[
          { label: 'India', start: 2700, end: 2900 },
          { label: 'USA', start: 78000, end: 81000 },
        ]}
        startLabel="2025"
        endLabel="2026"
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      expect(container.querySelector('.chart-plot .recharts-line-curve')).toBeTruthy();
      const ticks = axisTicks(container);
      expect(ticks).toContain('2025');
      expect(ticks).toContain('2026');
      // Two entities -> two endpoint pairs -> four dots.
      expect(container.querySelectorAll('.recharts-line-dot').length).toBe(4);
    } finally {
      cleanup();
    }
  });

  it('a country missing one endpoint follows the existing missing-data rule (no zero)', () => {
    const { container, cleanup } = renderChart(
      <SlopeChart
        items={[
          { label: 'India', start: 2700, end: 2900 },
          { label: 'USA', start: 78000, end: null },
        ]}
        startLabel="2025"
        endLabel="2026"
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      // The incomplete leg still renders its line, but only the two complete
      // points are drawn as dots (connectNulls={false} breaks the segment).
      const dots = [...container.querySelectorAll('.recharts-line-dot')];
      expect(dots.length).toBe(3);
      const ticks = axisTicks(container);
      expect(ticks).toContain('2025');
      expect(ticks).toContain('2026');
    } finally {
      cleanup();
    }
  });

  it('a 2026-to-2027 comparison renders the same way (no fixed historical end year)', () => {
    const { container, cleanup } = renderChart(
      <SlopeChart
        items={[{ label: 'India', start: 2900, end: 3100 }]}
        startLabel="2026"
        endLabel="2027"
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      const ticks = axisTicks(container);
      expect(ticks).toContain('2026');
      expect(ticks).toContain('2027');
      expect(container.querySelectorAll('.recharts-line-dot').length).toBe(2);
    } finally {
      cleanup();
    }
  });
});
