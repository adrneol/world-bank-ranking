/**
 * LEVEL RANKING TESTS (specification sections 14, 15, 18, 19).
 *
 * Method under test: raw value descending, ISO3 ascending as the deterministic
 * tie-break, 1-based ordinal positions, nulls dropped, denominator = surviving
 * rows (eligible entities with a valid observation).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareByValueDesc,
  describeRankChange,
  neighborWindow,
  paginate,
  rankAndLocate,
  rankByValue,
  searchRanked,
} from '../src/domain/ranking.js';

/** Rows exactly as the repository returns them (the fields the engine reads). */
const rows = [
  { iso3: 'IND', name: 'India', value: 800.125 },
  { iso3: 'BRA', name: 'Brazil', value: 800.125 }, // tie with IND
  { iso3: 'USA', name: 'United States', value: 43000.333333 },
  { iso3: 'CIV', name: "Cote d'Ivoire", value: 0 }, // zero is a valid value
  { iso3: 'PSE', name: 'West Bank and Gaza', value: 3500.25 },
  { iso3: 'XKX', name: 'Kosovo', value: 6100.75 },
  { iso3: 'TUV', name: 'Tuvalu', value: null }, // missing data: never ranked
];

test('ordering is raw value descending', () => {
  const { ranked } = rankByValue(rows);
  assert.deepEqual(ranked.map((row) => row.iso3), ['USA', 'XKX', 'PSE', 'BRA', 'IND', 'CIV']);
});

test('ties are broken by ISO3 ascending and receive distinct ordinal ranks', () => {
  const { ranked } = rankByValue(rows);
  const bra = ranked.find((row) => row.iso3 === 'BRA');
  const ind = ranked.find((row) => row.iso3 === 'IND');
  assert.equal(bra.rank, 4);
  assert.equal(ind.rank, 5);
  assert.ok(bra.rank < ind.rank);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 3, 4, 5, 6]);
});

test('the denominator is the number of surviving rows, not the input length', () => {
  const { total, dropped, ranked } = rankByValue(rows);
  assert.equal(rows.length, 7);
  assert.equal(total, 6);
  assert.equal(ranked.length, 6);
  assert.equal(dropped, 1, 'the null observation is dropped, never treated as zero');
});

test('null, undefined and non-finite values are excluded from the ranking', () => {
  const { ranked, total } = rankByValue([
    { iso3: 'IND', value: 100 },
    { iso3: 'USA', value: null },
    { iso3: 'BRA', value: undefined },
    { iso3: 'PSE', value: Number.NaN },
    { iso3: 'XKX', value: Number.POSITIVE_INFINITY },
  ]);
  assert.deepEqual(ranked.map((row) => row.iso3), ['IND']);
  assert.equal(total, 1);
});

test('a row without an ISO3 code can never be ranked', () => {
  const { ranked, total } = rankByValue([
    { iso3: '', value: 100 },
    { iso3: null, value: 200 },
    { iso3: 'IND', value: 50 },
  ]);
  assert.deepEqual(ranked.map((row) => row.iso3), ['IND']);
  assert.equal(total, 1);
});

test('raw precision is preserved: a 1e-9 difference is not a tie', () => {
  const nearlyEqual = [
    { iso3: 'AAA', value: 800.125 },
    { iso3: 'BBB', value: 800.125000001 },
  ];
  const { ranked } = rankByValue(nearlyEqual);
  assert.equal(ranked[0].iso3, 'BBB');
  assert.equal(ranked[0].value, 800.125000001);
  assert.equal(compareByValueDesc(nearlyEqual[0], nearlyEqual[1]) > 0, true);
});

test('an empty input yields an empty ranking and a zero denominator', () => {
  const { ranked, total, dropped } = rankByValue([]);
  assert.deepEqual(ranked, []);
  assert.equal(total, 0);
  assert.equal(dropped, 0);
  assert.deepEqual(rankByValue(null), { ranked: [], total: 0, dropped: 0 });
});

test('rankAndLocate finds the focus row and reports its rank and denominator', () => {
  const located = rankAndLocate(rows, 'ind');
  assert.equal(located.target.iso3, 'IND');
  assert.equal(located.target.rank, 5);
  assert.equal(located.target.value, 800.125);
  assert.equal(located.total, 6);
});

test('rankAndLocate returns null when the focus country has no valid observation', () => {
  const located = rankAndLocate(rows, 'TUV');
  assert.equal(located.target, null);
  assert.equal(located.total, 6);
});

test('neighborWindow: configurable counts around a middle rank', () => {
  const { ranked } = rankByValue(rows);
  const window = neighborWindow(ranked, 4, 2);
  assert.deepEqual(window.rows.map((row) => row.iso3), ['XKX', 'PSE', 'BRA', 'IND', 'CIV']);
  assert.equal(window.start, 2);
  assert.equal(window.end, 6);
});

test('neighborWindow boundaries: rank 1 and the last rank never overflow', () => {
  const { ranked } = rankByValue(rows);
  const first = neighborWindow(ranked, 1, 5);
  assert.equal(first.start, 1);
  assert.deepEqual(first.rows.map((row) => row.iso3), ['USA', 'XKX', 'PSE', 'BRA', 'IND', 'CIV']);

  const last = neighborWindow(ranked, ranked.length, 5);
  assert.equal(last.end, ranked.length);
  assert.equal(last.rows.length, ranked.length);
});

test('neighborWindow with 0 neighbours returns exactly the focus rank', () => {
  const { ranked } = rankByValue(rows);
  const window = neighborWindow(ranked, 3, 0);
  assert.deepEqual(window.rows.map((row) => row.iso3), ['PSE']);
  assert.equal(window.start, 3);
  assert.equal(window.end, 3);
});

test('pagination is 1-based, clamped and reports its own total', () => {
  const { ranked } = rankByValue(rows);
  const first = paginate(ranked, { page: 1, pageSize: 4 });
  assert.deepEqual(first.rows.map((row) => row.rank), [1, 2, 3, 4]);
  assert.equal(first.pages, 2);
  assert.equal(first.total, 6);

  const second = paginate(ranked, { page: 2, pageSize: 4 });
  assert.deepEqual(second.rows.map((row) => row.rank), [5, 6]);

  const clamped = paginate(ranked, { page: 99, pageSize: 4 });
  assert.equal(clamped.page, 2, 'a page beyond the end clamps to the last page');
});

test('country search matches ISO3 and name, case-insensitively', () => {
  const { ranked } = rankByValue(rows);
  assert.deepEqual(searchRanked(ranked, 'ind').map((row) => row.iso3), ['IND']);
  assert.deepEqual(searchRanked(ranked, 'gaza').map((row) => row.iso3), ['PSE']);
  assert.deepEqual(searchRanked(ranked, ''), []);
});

test('rank change is reported numerically only, never with economic interpretation', () => {
  const change = describeRankChange(100, 95);
  assert.equal(change.delta, -5);
  assert.match(change.text, /Rank position changed from 100 to 95/);
  assert.equal(describeRankChange(null, 95).delta, null);
  assert.equal(describeRankChange(100, null).text, null);
});