import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import BarComparisonChart from './BarComparisonChart.jsx';
import IntervalLineChart from './IntervalLineChart.jsx';

let cleanup;
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([['bars', BarComparisonChart], ['interval points', IntervalLineChart]])(
  '%s keep tap inspection through equivalent rerenders and dismiss changed values', async (_name, Chart) => {
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 220, width: 400, height: 220 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect: rect }]); }
      unobserve() {}
      disconnect() {}
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanup = () => { act(() => root.unmount()); container.remove(); };
    const render = async (value = 5) => act(async () => {
      root.render(<Chart entries={[{ x: '2004→2014', focus: value, benchmark: 3 }]}
        series={[{ key: 'focus', label: 'Japan' }, { key: 'benchmark', label: 'Other-economy average' }]} unit="%" />);
    });
    await render();
    const clickPoint = async () => {
      const chart = container.querySelector('.recharts-wrapper');
      await act(async () => chart.dispatchEvent(new MouseEvent('pointerdown', { clientX: 150, clientY: 100, bubbles: true })));
      await act(async () => chart.dispatchEvent(new MouseEvent('click', { clientX: 150, clientY: 100, bubbles: true })));
    };
    await clickPoint();
    expect(container.querySelector('.period-tooltip')?.textContent).toContain('Japan');
    await render();
    expect(container.querySelector('.period-tooltip')?.textContent).toContain('Other-economy average');
    act(() => container.querySelector('[aria-label="Close chart values"]').click());
    expect(container.querySelector('.period-tooltip')).toBeNull();
    await clickPoint();
    await render(7);
    expect(container.querySelector('.period-tooltip')).toBeNull();
  },
);
