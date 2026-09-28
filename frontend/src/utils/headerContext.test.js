import { describe, expect, it } from 'vitest';

import { getHeaderContext } from './headerContext.js';

// Round 2G header-context cases: the resolver is presentation-only, so the
// cases run directly against already-resolved state (no fetch stubs).

describe('getHeaderContext', () => {
  it('CASE 1: overview shows focus country and single year', () => {
    expect(
      getHeaderContext({ view: 'overview', country: 'IND', focusName: 'India', year: 2025, yearA: 2004, yearB: 2014 }),
    ).toEqual({ primary: 'World Bank WDI · IND', secondary: 'India — 2025' });
  });

  it('CASE 2: movement shows endpoints, never the global year', () => {
    expect(
      getHeaderContext({ view: 'movement', country: 'IND', focusName: 'India', year: 2025, yearA: 2004, yearB: 2014 }),
    ).toEqual({ primary: 'World Bank WDI · IND', secondary: 'India — 2004 → 2014' });
  });

  it('CASE 3: movement follows its own start/end pair', () => {
    expect(
      getHeaderContext({ view: 'movement', country: 'IND', focusName: 'India', year: 2025, yearA: 2014, yearB: 2024 }),
    ).toEqual({ primary: 'World Bank WDI · IND', secondary: 'India — 2014 → 2024' });
  });

  it('CASE 4: movement middle year stays out of the header', () => {
    // yearMid is not even an input: endpoints only, by construction.
    const ctx = getHeaderContext({ view: 'movement', country: 'IND', focusName: 'India', year: 2024, yearA: 2004, yearB: 2024 });
    expect(ctx.secondary).toBe('India — 2004 → 2024');
    expect(ctx.secondary).not.toContain('2014');
  });

  it('CASE 5: compare is neutral regardless of entities or year', () => {
    const ctx = getHeaderContext({ view: 'compare', country: 'SWE', focusName: 'Sweden', year: 2015, yearA: 2004, yearB: 2014 });
    expect(ctx).toEqual({ primary: 'World Bank WDI', secondary: 'Entity comparison' });
    expect(ctx.primary).not.toContain('SWE');
    expect(ctx.secondary).not.toContain('Sweden');
    expect(ctx.secondary).not.toContain('USA');
    expect(ctx.secondary).not.toContain('2015');
  });

  it('CASE 6: status is neutral regardless of global state', () => {
    const ctx = getHeaderContext({ view: 'status', country: 'SWE', focusName: 'Sweden', year: 2004, yearA: null, yearB: null });
    expect(ctx).toEqual({ primary: 'World Bank WDI', secondary: 'Data status & refresh' });
    expect(`${ctx.primary} ${ctx.secondary}`).not.toContain('SWE');
    expect(`${ctx.primary} ${ctx.secondary}`).not.toContain('Sweden');
    expect(`${ctx.primary} ${ctx.secondary}`).not.toContain('2004');
  });

  it.each(['home', 'methodology', 'about'])('CASE 7/8/9: %s is neutral', (view) => {
    const ctx = getHeaderContext({ view, country: 'IND', focusName: 'India', year: 2025, yearA: 2004, yearB: 2014 });
    expect(ctx).toEqual({ primary: 'World Bank WDI', secondary: 'Economic data analysis' });
  });

  it('CASE 10: single-year analytical view shows its country and year', () => {
    expect(
      getHeaderContext({ view: 'overview', country: 'ALB', focusName: 'Albania', year: 2023, yearA: null, yearB: null }),
    ).toEqual({ primary: 'World Bank WDI · ALB', secondary: 'Albania — 2023' });
  });

  it('movement without a valid period uses a truthful fallback, not a stale year', () => {
    expect(
      getHeaderContext({ view: 'movement', country: 'IND', focusName: 'India', year: 2025, yearA: null, yearB: null }),
    ).toEqual({ primary: 'World Bank WDI · IND', secondary: 'India — Select period' });
  });
});
