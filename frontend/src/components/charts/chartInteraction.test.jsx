/**
 * CHART INTERACTION VISUAL FIX — REGRESSION TESTS.
 *
 * Root cause (proven in Chrome via DevTools protocol): clicking/tapping a
 * chart moves DOM focus onto Recharts' portal `<g tabindex="-1"
 * class="recharts-zIndex-layer_*">` elements, and the browser then draws
 * its default large black focus outline around the layer's bounding box.
 * The app already suppressed outlines on `.recharts-wrapper` and
 * `.recharts-surface`; only the portal layers were uncovered.
 *
 * These tests pin: (1) the scoped CSS contract, (2) unchanged rendering +
 * data + tooltip behavior, (3) the intact keyboard-accessibility layer
 * (no `accessibilityLayer={false}` shortcut), (4) line-chart no-regression.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BarComparisonChart from './BarComparisonChart.jsx';
import SlopeChart from './SlopeChart.jsx';
import TimeSeriesChart from './TimeSeriesChart.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'index.css'), 'utf8');

function renderChart(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

// jsdom reports zero-size containers, so Recharts renders nothing without
// a measured box. Report a fixed plot size like a real layout would.
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

describe('chart focus styling contract', () => {
  it('suppresses pointer-focus outlines on every Recharts surface layer', () => {
    // The portal <g> layers are the previously uncovered selector.
    expect(css).toContain("g[class*='recharts-zIndex-layer']");
    expect(css).toContain(':focus:not(:focus-visible)');
    // Scoped to chart plots only — never a global reset.
    expect(css).not.toMatch(/\*\s*{[^}]*outline\s*:\s*none/);
    expect(css).not.toContain('outline: none !important');
  });

  it('keeps a calm keyboard focus ring instead of removing all indication', () => {
    expect(css).toContain('.chart-plot .recharts-surface:focus-visible');
    expect(css).toContain('2px solid var(--accent)');
  });
});

describe('bar chart behavior is otherwise unchanged', () => {
  beforeEach(() => {
    stubPlotSize();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('renders bars verbatim with the keyboard-accessibility layer intact', () => {
    const { container, cleanup } = renderChart(
      <BarComparisonChart entries={[{ name: '2004', value: 624 }, { name: '2014', value: 1554 }]} unit="current US$" decimals={0} />,
    );
    try {
      const bars = container.querySelectorAll('.chart-plot .recharts-bar-rectangle path');
      expect(bars).toHaveLength(2);
      // Accessibility layer NOT disabled: the surface stays keyboard-focusable
      // with its application role (arrow-key tooltip navigation preserved).
      const svg = container.querySelector('.chart-plot svg.recharts-surface');
      expect(svg?.getAttribute('tabindex')).toBe('0');
      expect(svg?.getAttribute('role')).toBe('application');
    } finally {
      cleanup();
    }
  });

  it('pointer interaction does not break the chart (tooltip fill proven in-browser)', () => {
    // jsdom lacks the geometry Recharts needs to resolve a hovered payload,
    // so filled-tooltip contents are verified with real Chrome (probe:
    // hover shows "2004 / Value : 624" unchanged). Here we pin that pointer
    // interaction is still wired and harmless: no crash, bars intact.
    const { container, cleanup } = renderChart(
      <BarComparisonChart entries={[{ name: '2004', value: 624 }, { name: '2014', value: 1554 }]} unit="current US$" decimals={0} />,
    );
    try {
      const wrapper = container.querySelector('.chart-plot .recharts-wrapper');
      expect(wrapper).toBeTruthy();
      act(() => {
        wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        wrapper.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
        wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelectorAll('.chart-plot .recharts-bar-rectangle path')).toHaveLength(2);
    } finally {
      cleanup();
    }
  });
});

describe('line charts are not regressed', () => {
  beforeEach(() => {
    stubPlotSize();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('time-series line chart renders with intact accessibility surface', () => {
    const { container, cleanup } = renderChart(
      <TimeSeriesChart
        series={[{ label: 'India', points: [{ x: 2004, y: 624 }, { x: 2014, y: 1554 }] }]}
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      expect(container.querySelector('.chart-plot .recharts-line')).toBeTruthy();
      const svg = container.querySelector('.chart-plot svg.recharts-surface');
      expect(svg?.getAttribute('tabindex')).toBe('0');
    } finally {
      cleanup();
    }
  });

  it('slope chart renders endpoint segments unchanged', () => {
    const { container, cleanup } = renderChart(
      <SlopeChart
        items={[{ label: 'India', start: 624, end: 1554 }]}
        startLabel="2004"
        endLabel="2014"
        unit="current US$"
        decimals={0}
      />,
    );
    try {
      expect(container.querySelector('.chart-plot .recharts-line')).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
