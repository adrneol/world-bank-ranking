import { describe, expect, it } from 'vitest';

import { formatTickValue } from './chartFormat.js';

describe('formatTickValue', () => {
  it('keeps currency ticks distinct for US dollars and international dollars', () => {
    expect(formatTickValue(1_234_000_000_000, 0, 'current US$')).toBe('$1.2T');
    expect(formatTickValue(1_234_000_000_000, 0, 'international $')).toBe('Int$1.2T');
  });
});
