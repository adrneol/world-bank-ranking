import { describe, expect, it } from 'vitest';

import { formatTickValue } from './chartFormat.js';

describe('formatTickValue', () => {
  it('keeps currency ticks distinct for US dollars and international dollars', () => {
    expect(formatTickValue(1_234_000_000_000, 0, 'current US$')).toBe('$1.2T');
    expect(formatTickValue(1_234_000_000_000, 0, 'international $')).toBe('Int$1.2T');
  });
  it('keeps scale suffixes and exponent notation separate', () => {
    expect(formatTickValue(20e12, 2, 'constant 2015 US$')).toBe('$20T');
    expect(formatTickValue(-15e12, 2, 'international $')).toBe('−Int$15T');
    expect(formatTickValue(5, 2, 'annual %')).toBe('+5%');
    expect(formatTickValue(0, 2, 'annual %')).toBe('0%');
    expect(formatTickValue(1e30, 0, 'current US$')).toBe('$1e+30');
    expect(formatTickValue(Infinity, 0, 'current US$')).toBe('');
  });
});
