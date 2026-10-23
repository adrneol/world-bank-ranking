import assert from 'node:assert/strict';
import test from 'node:test';
import { EXTERNAL_BASES } from '../src/domain/externalMovement.js';
import { CAPITAL_BASES } from '../src/domain/capitalMovement.js';
import { COMPARE_BASIS_LEGS, calculateCompareBasis } from '../src/domain/compareBasis.js';

const map = (entries) => new Map(entries);
const fixtures = () => ({
  current_account: map([
    ['AAA', map([[2004, 10], [2005, -20], [2006, 30]])],
    ['BBB', map([[2004, 30], [2005, 20], [2006, -10]])],
  ]),
  total_current: map([
    ['AAA', map([[2004, 100], [2005, 200], [2006, 300]])],
    ['BBB', map([[2004, 300], [2005, 100], [2006, 100]])],
  ]),
  fdi_inflows: map([
    ['AAA', map([[2004, 999], [2005, -10], [2006, 30]])],
    ['BBB', map([[2004, 888], [2005, 20], [2006, 10]])],
  ]),
  reserves_ex_gold: map([
    ['AAA', map([[2004, 50], [2005, 60], [2006, 70]])],
    ['BBB', map([[2004, 30], [2005, 40], [2006, 50]])],
  ]),
  imports_current: map([
    ['AAA', map([[2004, 100], [2005, 120], [2006, 140]])],
    ['BBB', map([[2004, 90], [2005, 80], [2006, 100]])],
  ]),
  remittances_received: map([
    ['AAA', map([[2004, 500], [2005, 10], [2006, 30]])],
    ['BBB', map([[2004, 400], [2005, 40], [2006, 10]])],
  ]),
});

test('Compare basis registry declares the exact source legs for the six missing bases', () => {
  assert.deepEqual(COMPARE_BASIS_LEGS[EXTERNAL_BASES.CA_ANNUAL], ['current_account', 'total_current']);
  assert.deepEqual(COMPARE_BASIS_LEGS[EXTERNAL_BASES.CA_AVERAGE], ['current_account', 'total_current']);
  assert.deepEqual(COMPARE_BASIS_LEGS[EXTERNAL_BASES.CA_CUMULATIVE], ['current_account', 'total_current']);
  assert.deepEqual(COMPARE_BASIS_LEGS[CAPITAL_BASES.RATIO_CUMULATIVE], ['fdi_inflows', 'total_current']);
  assert.deepEqual(COMPARE_BASIS_LEGS[EXTERNAL_BASES.RES_COVERAGE], ['reserves_ex_gold', 'imports_current']);
  assert.deepEqual(COMPARE_BASIS_LEGS[EXTERNAL_BASES.REMIT_INTENSITY], ['remittances_received', 'total_current']);
});

test('annual CA/GDP and reserve coverage use the selected source legs', () => {
  const legs = fixtures();
  assert.deepEqual(calculateCompareBasis({ basis: EXTERNAL_BASES.CA_ANNUAL, legs, iso3: 'AAA', year: 2005 }), {
    computable: true, value: -10, reason: null,
  });
  assert.deepEqual(calculateCompareBasis({ basis: EXTERNAL_BASES.RES_COVERAGE, legs, iso3: 'AAA', year: 2005 }), {
    computable: true, value: 6, reason: null,
  });
  // A group's ratio is based on sums, not the mean of member ratios.
  const group = calculateCompareBasis({ basis: EXTERNAL_BASES.CA_ANNUAL, legs, members: ['AAA', 'BBB'], year: 2005 });
  assert.equal(group.value, 0);
});

test('period CA and FDI / GDP bases follow the approved S+1..E formulas', () => {
  const legs = fixtures();
  const period = { startYear: 2004, endYear: 2006 };
  assert.equal(calculateCompareBasis({ basis: EXTERNAL_BASES.CA_AVERAGE, legs, iso3: 'AAA', ...period }).value, 0);
  assert.equal(calculateCompareBasis({ basis: EXTERNAL_BASES.CA_CUMULATIVE, legs, iso3: 'AAA', ...period }).value, 2);
  assert.equal(calculateCompareBasis({ basis: CAPITAL_BASES.RATIO_CUMULATIVE, legs, iso3: 'AAA', ...period }).value, 4);
  assert.equal(calculateCompareBasis({ basis: EXTERNAL_BASES.REMIT_INTENSITY, legs, iso3: 'AAA', ...period }).value, 8);
});

test('period basis rejects missing required years and non-positive GDP', () => {
  const legs = fixtures();
  legs.current_account.get('AAA').delete(2005);
  const missing = calculateCompareBasis({ basis: EXTERNAL_BASES.CA_CUMULATIVE, legs, iso3: 'AAA', startYear: 2004, endYear: 2006 });
  assert.equal(missing.computable, false);
  assert.deepEqual(missing.missingYears, [2005]);
  legs.total_current.get('AAA').set(2005, 0);
  legs.current_account.get('AAA').set(2005, -20);
  const average = calculateCompareBasis({ basis: EXTERNAL_BASES.CA_AVERAGE, legs, iso3: 'AAA', startYear: 2004, endYear: 2006 });
  assert.equal(average.computable, false);
  assert.equal(average.reason, 'non_positive_gdp_base');
});

test('group period ratios use sums of member legs and preserve negative flows', () => {
  const legs = fixtures();
  const result = calculateCompareBasis({ basis: CAPITAL_BASES.RATIO_CUMULATIVE, legs, members: ['AAA', 'BBB'], startYear: 2004, endYear: 2006 });
  // (−10 + 20 + 30 + 10) / (200 + 100 + 300 + 100) * 100
  assert.ok(Math.abs(result.value - (50 / 700 * 100)) < 1e-12);
});
