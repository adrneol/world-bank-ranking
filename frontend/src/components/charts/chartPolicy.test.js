import { describe, expect, it } from 'vitest';
import { annualSeries, alignSeries, plotMinWidth, scaleDetailFor } from './chartData.js';
import { formatAnnualReadout, formatTickValue } from './chartFormat.js';

describe('economic chart policies', () => {
  it.each([
    [[1, 1_000], 'log'],
    [[1, 1_000_000], 'log'],
    [[1e6, 1e12], 'log'],
    [[0, 10], 'detail'],
    [[0, 1, 1e6], 'signed-detail'],
    [[-1, 1e6], 'signed-detail'],
    [[-1, -1e6], 'signed-detail'],
    [[1e12, 1e12 + 1], 'detail'],
    [[0.00001, 25], 'log'],
    [[null, 0, null], null],
  ])('chooses a readable, honest option for %j', (values, expected) => {
    expect(scaleDetailFor(values.map((value) => ({ value })), ['value'])).toBe(expected);
  });

  it('retains zero and explicit gaps on a calendar axis with a bounded render width', () => {
    const plots = annualSeries([{ name: '2019', value: 0 }, { name: '2021', value: 3.5 }], [{ key: 'value', label: 'Economy' }]);
    expect(alignSeries(plots).rows).toEqual([{ x: 2019, s0: 0 }, { x: 2020, s0: null }, { x: 2021, s0: 3.5 }]);
    expect(plotMinWidth(100)).toBe(3600);
  });

  it('keeps small values visible and does not label FX rates as currency amounts', () => {
    expect(formatTickValue(0.00003, 2, 'annual %')).not.toBe('0.00');
    expect(formatTickValue(1234, 2, 'LCU per US$')).toBe('1.2k');
    expect(formatTickValue(1234, 2, 'current US$ per person')).toBe('$1.2k');
  });

  it('formats a readout in the actual measurement units with compact display precision', () => {
    expect(formatAnnualReadout(708_271_234_567, 'constant 2015 US$')).toBe('$708.27B');
    expect(formatAnnualReadout(1_831_234_567_890, 'current international $')).toBe('Int$1.83T');
    expect(formatAnnualReadout(1_230, 'constant 2015 US$ per person')).toBe('$1.23K/person');
    expect(formatAnnualReadout(-6.18347213, 'annual %')).toBe('-6.18%');
    expect(formatAnnualReadout(0, 'annual %')).toBe('0.00%');
    expect(formatAnnualReadout(null, 'annual %')).toBe('Missing');
  });
});

describe('unified plot geometry', () => {
  it('allocates grouped bars from the largest compatible group', async () => {
    const { annualGeometry } = await import('./annualGeometry.js');
    const line = annualGeometry(66, 5, 'line', 320);
    const bars = annualGeometry(66, 5, 'bar', 320);
    expect(bars.step).toBeGreaterThan(line.step);
    expect(bars.barWidth).toBeGreaterThanOrEqual(9);
    expect(5 * (bars.barWidth + 2)).toBeLessThan(bars.step);
  });

  it('preserves a zero baseline and terminates paths at missing years', async () => {
    const { annualSegments, valueAxis } = await import('./annualGeometry.js');
    const axis = valueAxis([-1e6, 0, 3], 160, { includeZero: true });
    expect(axis.y(-1e6)).toBeGreaterThan(axis.y(0));
    expect(axis.y(3)).toBeLessThan(axis.y(0));
    expect(annualSegments([10, null, 20, 0], (x) => x, (y) => y)).toBe('M0,10  M2,20 L3,0');
  });

  it('aligns dual-axis bar zeros while preserving linear heights and extreme observations', async () => {
    const { barAxes } = await import('./annualGeometry.js');
    const [levels, rates] = barAxes([[1e12, Number.MAX_VALUE], [-50, 0, 25, 50]], 264);
    expect(levels.y(0)).toBe(rates.y(0));
    expect(levels.y(Number.MAX_VALUE)).toBeGreaterThanOrEqual(12);
    expect(rates.y(-50)).toBeLessThanOrEqual(250);
    expect(rates.y(0) - rates.y(50)).toBeCloseTo(2 * (rates.y(0) - rates.y(25)));
    expect(rates.y(-50) - rates.y(0)).toBeCloseTo(rates.y(0) - rates.y(50));
  });
});

describe('viewport domains', () => {
  it('uses low and high visible windows while leaving points unchanged', async () => {
    const { annualGeometry, visibleValues, valueAxis } = await import('./annualGeometry.js');
    const geometry = annualGeometry(6, 1, 'line', 50);
    const values = [1, 2, 3, 100, 200, 300];
    const series = [{ values }];
    const early = valueAxis(visibleValues(series, geometry, 0, 40, 'linear'), 300);
    const later = valueAxis(visibleValues(series, geometry, 105, 150, 'linear'), 300);
    expect(early.hi).toBeLessThan(later.lo);
    expect(early.lo).toBeGreaterThan(0);
    expect(values).toEqual([1, 2, 3, 100, 200, 300]);
  });

  it('includes boundary crossings and partially visible bars without spanning a gap', async () => {
    const { annualGeometry, visibleSegments, visibleValues, barCenter } = await import('./annualGeometry.js');
    expect(visibleSegments([0, 100, null, 200], i => i * 10, 3, 23)).toEqual([[3, 30, 10, 100]]);
    const geometry = annualGeometry(4, 2, 'bar', 60);
    const center = barCenter(geometry, 1, 1, 2);
    const group = [{ bars: true, barSlot: 1, barCount: 2, values: [null, -1e6] }];
    expect(visibleValues(group, geometry, center + 2, center + 5, 'linear')).toEqual([-1e6]);
  });

  it.each([
    [[-Number.MAX_VALUE, Number.MAX_VALUE], false],
    [[1e12, 1e12 + 0.001], false],
    [[Number.MIN_VALUE], false],
    [[-100, -3], true],
    [[0, 0], true],
    [[null, undefined, NaN, Infinity], false],
  ])('keeps finite display coordinates for %j (zero baseline %s)', async (values, includeZero) => {
    const { valueAxis } = await import('./annualGeometry.js');
    const axis = valueAxis(values, 350, { includeZero });
    expect(Number.isFinite(axis.lo)).toBe(true);
    expect(Number.isFinite(axis.hi)).toBe(true);
    expect(axis.lo).toBeLessThan(axis.hi);
    if (includeZero) expect(axis.y(0)).toBeGreaterThanOrEqual(12);
    for (const value of values.filter(Number.isFinite)) {
      expect(axis.y(value)).toBeGreaterThanOrEqual(11.99);
      expect(axis.y(value)).toBeLessThanOrEqual(336.01);
    }
  });
});
