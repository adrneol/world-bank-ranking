import { describe, expect, it } from 'vitest';

import { formatUtcDateTime, formatVintageDate, formatVintageMonth } from './format.js';

describe('vintage and retrieval formatters', () => {
  it('reduces an upstream vintage to month precision for the reference field', () => {
    expect(formatVintageMonth('2026-07-13')).toBe('July 2026');
    expect(formatVintageMonth('2026-11-02T00:00:00.000Z')).toBe('November 2026');
    expect(formatVintageMonth(null)).toBeNull();
    expect(formatVintageMonth('')).toBeNull();
    expect(formatVintageMonth('not-a-date')).toBeNull();
    expect(formatVintageMonth('2026-13-01')).toBeNull();
  });

  it('renders an upstream vintage date without inventing precision', () => {
    expect(formatVintageDate('2026-07-13')).toBe('13 July 2026');
    expect(formatVintageDate('garbage')).toBeNull();
  });

  it('renders retrieval timestamps explicitly in UTC, never viewer-local', () => {
    expect(formatUtcDateTime('2026-09-28T00:25:14.000Z')).toBe('28 September 2026, 00:25 UTC');
    expect(formatUtcDateTime('2026-09-27T18:54:55.007Z')).toBe('27 September 2026, 18:54 UTC');
    expect(formatUtcDateTime('nope')).toBeNull();
    expect(formatUtcDateTime(null)).toBeNull();
  });
});
