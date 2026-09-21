/**
 * YoY RANKING TESTS (specification sections 20, 21, 22).
 *
 * YoY ranking is a different question from level ranking: countries are ordered by
 * percentage change, the universe requires BOTH years, and the denominator counts
 * only calculable pairs - so it can be smaller than the level denominator.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYoyRows, rankByYoy, rankByYoyAndLocate } from '../src/domain/yoyRanking.js';
import { rankByValue } from '../src/domain/ranking.js';

const current = [
  { iso3: 'IND', name: 'India', value: 800.125 },
  { iso3: 'BRA', name: 'Brazil', value: 800.125 },
  { iso3: 'USA', name: 'United States', value: 43000.333333 },
  { iso3: 'CIV', name: "Cote d'Ivoire", value: 0 },
  { iso3: 'XKX', name: 'Kosovo', value: 6100.75 },
  { iso3: 'TUV', name: 'Tuvalu', value: null },
];

const previous = [
  { iso3: 'IND', name: 'India', value: 700.75 },
  { iso3: 'BRA', name: 'Brazil', value: 800.25 },
  { iso3: 'USA', name: 'United States', value: 42000.222222 },
  { iso3: 'CIV', name: "Cote d'Ivoire", value: 0 },
  { iso3: 'PSE', name: 'West Bank and Gaza', value: 3373.5 },
];

test('buildYoyRows requires both years and a positive base', () => {
  const built = buildYoyRows(current, previous);
  assert.deepEqual(built.rows.map((row) => row.iso3).sort(), ['BRA', 'IND', 'USA']);
  assert.equal(built.pairs, 3);
  assert.equal(built.consideredCurrent, 6);
  assert.equal(built.consideredPrevious, 5);

  const civ = built.rows.find((row) => row.iso3 === 'CIV');
  assert.equal(civ, undefined, 'a zero base can never produce a YoY percentage');
});

test('the YoY percentage uses raw values', () => {
  const built = buildYoyRows(current, previous);
  const india = built.rows.find((row) => row.iso3 === 'IND');
  assert.equal(india.yoyPercent, ((800.125 / 700.75) - 1) * 100);
  assert.equal(india.previousValue, 700.75);
  assert.equal(india.currentValue, 800.125);
});

test('a country missing either year is excluded from the YoY universe', () => {
  const built = buildYoyRows(current, previous);
  assert.equal(built.rows.some((row) => row.iso3 === 'XKX'), false, 'no previous year');
  assert.equal(built.rows.some((row) => row.iso3 === 'TUV'), false, 'no current value');
  assert.equal(built.rows.some((row) => row.iso3 === 'PSE'), false, 'no current year');
});

test('YoY ranking is ordered by percentage change descending', () => {
  const built = buildYoyRows(current, previous);
  const { ranked } = rankByYoy(built.rows);
  assert.deepEqual(ranked.map((row) => row.iso3), ['IND', 'USA', 'BRA']);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 3]);
});

test('YoY ties are broken by ISO3 ascending', () => {
  const { ranked } = rankByYoy([
    { iso3: 'ZZZ', previousValue: 100, currentValue: 110, yoyPercent: 10 },
    { iso3: 'AAA', previousValue: 100, currentValue: 110, yoyPercent: 10 },
  ]);
  assert.deepEqual(ranked.map((row) => row.iso3), ['AAA', 'ZZZ']);
});

test('rows without an ISO3 code or without a finite percentage are excluded', () => {
  const { ranked, excluded } = rankByYoy([
    { iso3: 'IND', previousValue: 100, currentValue: 110, yoyPercent: 10 },
    { iso3: '', previousValue: 100, currentValue: 110, yoyPercent: 10 },
    { iso3: 'USA', previousValue: 100, currentValue: 110, yoyPercent: Number.NaN },
    { iso3: 'BRA', previousValue: null, currentValue: 110, yoyPercent: 10 },
  ]);
  assert.deepEqual(ranked.map((row) => row.iso3), ['IND']);
  assert.equal(excluded, 3);
});

test('lower percentage changes rank below (a negative change is still ranked)', () => {
  const { ranked } = rankByYoy([
    { iso3: 'AAA', previousValue: 100, currentValue: 120, yoyPercent: 20 },
    { iso3: 'BBB', previousValue: 100, currentValue: 80, yoyPercent: -20 },
  ]);
  assert.deepEqual(ranked.map((row) => row.iso3), ['AAA', 'BBB']);
  assert.equal(ranked[1].yoyPercent, -20);
});

test('rankByYoyAndLocate reports the focus rank and the YoY denominator', () => {
  const built = buildYoyRows(current, previous);
  const located = rankByYoyAndLocate(built.rows, 'ind');
  assert.equal(located.target.iso3, 'IND');
  assert.equal(located.target.rank, 1);
  assert.equal(located.total, 3, 'the YoY denominator counts calculable pairs only');
});

test('the YoY denominator is separate from, and can differ from, the level denominator', () => {
  const level = rankByValue(current);
  const built = buildYoyRows(current, previous);
  const yoy = rankByYoy(built.rows);

  assert.equal(level.total, 5, 'level denominator: eligible rows with a value');
  assert.equal(yoy.total, 3, 'YoY denominator: calculable pairs');
  assert.notEqual(level.total, yoy.total);
});

test('a country can hold a different level rank and YoY rank', () => {
  const level = rankByValue(current);
  const built = buildYoyRows(current, previous);
  const yoy = rankByYoyAndLocate(built.rows, 'IND');

  const levelRank = level.ranked.find((row) => row.iso3 === 'IND').rank;
  // current[] holds 5 valid rows (USA, XKX, BRA, IND, CIV; TUV is null and
  // PSE has no current-year row), so IND sorts 4th: USA, XKX, BRA before it.
  assert.equal(levelRank, 4);
  assert.equal(yoy.target.rank, 1);
  assert.notEqual(levelRank, yoy.target.rank);
});

test('an empty YoY input yields an empty ranking and a zero denominator', () => {
  const { ranked, total } = rankByYoy([]);
  assert.deepEqual(ranked, []);
  assert.equal(total, 0);
  assert.deepEqual(rankByYoy(null).ranked, []);
});