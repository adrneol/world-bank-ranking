import { describe, expect, it } from 'vitest';
import { formatCompareResult } from './compareFormat.js';

describe('Compare result presentation', () => {
  it.each([
    [25, '%', 0, '25.00%'],
    [-2.125, '%', 0, '-2.13%'],
    [0, '%', 0, '0.00%'],
    [15, 'percentage points', 0, '15.00 percentage points'],
    [5.125, 'index points', 1, '5.13 index points'],
    [201.2, 'index points (2010 = 100)', 1, '201.2 index points (2010 = 100)'],
    [3.5, '% of GDP', 2, '3.50% of GDP'],
    [4, 'months', 2, '4.00 months'],
    [1_234.56, 'local currency units per US$ (period average)', 2, '1,234.56 local currency units per US$ (period average)'],
    [12.5, 'INR per JPN (local currency units, APP-derived cross-rate)', 2, '12.50 INR per JPN (local currency units, APP-derived cross-rate)'],
    [15_000, 'people', 0, '15,000 people'],
    [25, null, 0, '25'],
    [null, '%', 2, '—'],
  ])('formats %s in %s', (value, unit, decimals, expected) => {
    expect(formatCompareResult(value, unit, decimals, { compact: true })).toBe(expected);
  });

  it.each([
    ['current US$', '$'],
    ['constant 2015 US$', '$'],
    ['current international $', 'Int$'],
    ['constant 2021 international $', 'Int$'],
  ])('keeps the %s monetary basis when compacting', (unit, symbol) => {
    expect(formatCompareResult(-2_500_000, unit, 2, { compact: true })).toBe(`−${symbol}2.50M ${unit}`);
    expect(formatCompareResult(2_500_000, unit, 2)).toBe(`2,500,000.00 ${unit}`);
  });
});
