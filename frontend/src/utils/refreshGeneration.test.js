import { describe, expect, it } from 'vitest';

import { fingerprintOf, isNewerGeneration } from './refreshGeneration.js';

describe('fingerprintOf', () => {
  it('returns null for missing/degraded payloads so they can never trigger revalidation', () => {
    expect(fingerprintOf(null)).toBeNull();
    expect(fingerprintOf(undefined)).toBeNull();
    expect(fingerprintOf({})).toBeNull();
    expect(fingerprintOf({ fresh: true })).toBeNull();
  });

  it('falls back to freshness fields for backends predating the fingerprint', () => {
    expect(fingerprintOf({ lastSuccessAt: '2026-01-01T00:00:00.000Z', observations: 10 })).toEqual({
      runId: null,
      lastSuccessAt: '2026-01-01T00:00:00.000Z',
      maxFetchedAt: null,
      observationCount: 10,
    });
  });

  it('extracts the fingerprint fields null-safely', () => {
    expect(
      fingerprintOf({
        fingerprint: { runId: 7, lastSuccessAt: 'a', maxFetchedAt: 'b', observationCount: 5 },
      }),
    ).toEqual({ runId: 7, lastSuccessAt: 'a', maxFetchedAt: 'b', observationCount: 5 });
    expect(fingerprintOf({ fingerprint: {} })).toEqual({
      runId: null,
      lastSuccessAt: null,
      maxFetchedAt: null,
      observationCount: null,
    });
  });
});

describe('isNewerGeneration', () => {
  it('never treats null/unknown generations as newer (no revalidation loops)', () => {
    expect(isNewerGeneration(null, { runId: 2 })).toBe(false);
    expect(isNewerGeneration({ runId: 1 }, null)).toBe(false);
    expect(isNewerGeneration(null, null)).toBe(false);
    expect(isNewerGeneration({ runId: null }, { runId: null })).toBe(false);
  });

  it('advances only on a strictly greater run id', () => {
    expect(isNewerGeneration({ runId: 7 }, { runId: 8 })).toBe(true);
    expect(isNewerGeneration({ runId: 7 }, { runId: 7 })).toBe(false);
    expect(isNewerGeneration({ runId: 8 }, { runId: 7 })).toBe(false);
  });

  it('falls back to lastSuccessAt comparison when run ids are absent', () => {
    const prev = { runId: null, lastSuccessAt: '2026-01-01T00:00:00.000Z' };
    const next = { runId: null, lastSuccessAt: '2026-01-02T00:00:00.000Z' };
    expect(isNewerGeneration(prev, next)).toBe(true);
    expect(isNewerGeneration(next, prev)).toBe(false);
    expect(isNewerGeneration(prev, { ...prev })).toBe(false);
  });
});
