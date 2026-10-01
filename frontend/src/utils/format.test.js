import { describe, expect, it } from 'vitest';

import {
  formatDurationMs,
  formatDurationMsValue,
  formatUtcDateTime,
  formatUtcDateTimeSeconds,
  formatVintageDate,
  formatVintageMonth,
} from './format.js';

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

  it('renders refresh timestamps with UTC seconds, never browser-local', () => {
    expect(formatUtcDateTimeSeconds('2026-10-01T13:17:02.000Z')).toBe('1 October 2026, 13:17:02 UTC');
    expect(formatUtcDateTimeSeconds('2026-10-01T13:17:16.000Z')).toBe('1 October 2026, 13:17:16 UTC');
    expect(formatUtcDateTimeSeconds('garbage')).toBeNull();
    expect(formatUtcDateTimeSeconds(null)).toBeNull();
  });

  it('derives refresh duration from backend timestamps without fabricating time', () => {
    expect(formatDurationMs('2026-10-01T13:17:02.000Z', '2026-10-01T13:17:16.000Z')).toBe('14.0 s');
    expect(formatDurationMsValue(14000)).toBe('14.0 s');
    expect(formatDurationMs('2026-10-01T13:17:02.000Z', null)).toBe('—');
    expect(formatDurationMs(null, '2026-10-01T13:17:16.000Z')).toBe('—');
    expect(formatDurationMsValue(-1)).toBe('—');
  });
});
