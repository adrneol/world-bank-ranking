import { describe, expect, it } from 'vitest';

import { defaultMovementCommonSort, movementCommonSortOptions, sortMovementCommonRows } from './movementSort.js';

const KEYS_3 = ['2004-2014', '2009-2019', '2014-2024'];

const rowsOf = () => [
  { iso3: 'CHN', perKey: { '2004-2014': { rank: 2, value: 30 }, '2014-2024': { rank: 3, value: 10 }, '2009-2019': { rank: 1, value: 20 } } },
  { iso3: 'IND', perKey: { '2004-2014': { rank: 1, value: 50 }, '2014-2024': { rank: 1, value: 60 }, '2009-2019': { rank: 2, value: 40 } } },
  { iso3: 'USA', perKey: { '2004-2014': { rank: null, value: null }, '2014-2024': { rank: 2, value: null }, '2009-2019': { rank: null, value: 5 } } },
];

describe('movement sort engine', () => {
  it('covers rank/value × direction for every key, labeled by period', () => {
    const options = movementCommonSortOptions(KEYS_3);
    expect(options).toHaveLength(12);
    expect(options).toContainEqual({ value: 'rank-asc:0', label: '2004-2014 rank — best first' });
    expect(options).toContainEqual({ value: 'value-desc:2', label: '2014-2024 value — high to low' });
    const fx = movementCommonSortOptions(['2004-2014', '2014-2024'], 'change');
    expect(fx).toContainEqual({ value: 'value-desc:1', label: '2014-2024 change — high to low' });
    expect(movementCommonSortOptions([])).toEqual([]);
  });

  it('defaults to best-first rank of the reference comparison', () => {
    expect(defaultMovementCommonSort(KEYS_3)).toBe('rank-asc:2');
    expect(defaultMovementCommonSort(['only'])).toBe('rank-asc:0');
  });

  it('follows the selected key, not the reference period', () => {
    const rows = rowsOf();
    expect(sortMovementCommonRows(rows, 'rank-asc:0', KEYS_3).map((r) => r.iso3)).toEqual(['IND', 'CHN', 'USA']);
    expect(sortMovementCommonRows(rows, 'rank-asc:1', KEYS_3).map((r) => r.iso3)).toEqual(['CHN', 'IND', 'USA']);
    expect(sortMovementCommonRows(rows, 'value-desc:2', KEYS_3).map((r) => r.iso3)).toEqual(['IND', 'CHN', 'USA']);
  });

  it('falls back on stale ids with nulls last ascending', () => {
    const rows = rowsOf();
    expect(sortMovementCommonRows(rows, 'rank-asc', KEYS_3).map((r) => r.iso3)).toEqual(['IND', 'USA', 'CHN']);
    expect(sortMovementCommonRows(rows, 'value-asc:99', KEYS_3).map((r) => r.iso3)).toEqual(['CHN', 'IND', 'USA']);
    expect(sortMovementCommonRows(rows, 'rank-desc:0', KEYS_3)[0].iso3).toBe('CHN');
  });

  it('breaks ties by ISO3 and never mutates input', () => {
    const rows = [
      { iso3: 'ZAF', perKey: { k: { rank: 1, value: 5 } } },
      { iso3: 'AGO', perKey: { k: { rank: 1, value: 5 } } },
    ];
    expect(sortMovementCommonRows(rows, 'rank-asc:0', ['k']).map((r) => r.iso3)).toEqual(['AGO', 'ZAF']);
    expect(rows.map((r) => r.iso3)).toEqual(['ZAF', 'AGO']);
  });
});
