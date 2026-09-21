/**
 * COUNTRY UNIVERSE TESTS (specification sections 4 and 44).
 *
 * The universe rule is the reason a ranking can be trusted, so every branch is
 * asserted: aggregate markers, blank ISO3, income-group rows, legitimate
 * economies such as XKX/PSE, and the exact rejection reason each row receives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE_BLANK_METADATA, EDGE_METADATA } from './fixtures/edgeCases.js';
import {
  AGGREGATE_REASONS,
  OBSERVATION_REJECTIONS,
  buildUniverse,
  classifyEntity,
  classifyObservation,
  createUniverseIndex,
  describeUniverseRule,
  isMember,
  normalizeIso3,
  toCountryRow,
} from '../src/domain/universe.js';

const universe = buildUniverse([...EDGE_METADATA, ...EDGE_BLANK_METADATA]);
const index = createUniverseIndex(universe);

test('aggregate exclusion: region.id "NA"', () => {
  const verdict = classifyEntity({ id: 'WLD', name: 'World', region: { id: 'NA', value: 'Aggregates' } });
  assert.equal(verdict.isAggregate, true);
  assert.equal(verdict.reason, AGGREGATE_REASONS.REGION_ID_NA);
});

test('aggregate exclusion: region.value "Aggregates"', () => {
  const verdict = classifyEntity({ id: 'EAS', name: 'East Asia', region: { id: 'EAS', value: 'Aggregates' } });
  assert.equal(verdict.isAggregate, true);
  assert.equal(verdict.reason, AGGREGATE_REASONS.REGION_VALUE_AGGREGATES);
});

test('aggregate exclusion: blank or missing ISO3 and malformed metadata', () => {
  assert.equal(
    classifyEntity({ id: '   ', region: { id: 'SAS', value: 'South Asia' } }).reason,
    AGGREGATE_REASONS.BLANK_ISO3,
  );
  assert.equal(
    classifyEntity({ region: { id: 'SAS', value: 'South Asia' } }).reason,
    AGGREGATE_REASONS.BLANK_ISO3,
  );
  assert.equal(classifyEntity(null).isAggregate, true);
  assert.equal(classifyEntity(null).reason, AGGREGATE_REASONS.UNKNOWN_METADATA_SHAPE);
});

test('real countries and economies are eligible, including XKX and PSE', () => {
  assert.deepEqual(
    universe.eligible.map((row) => row.id).sort(),
    ['BRA', 'CIV', 'IND', 'PSE', 'TUV', 'USA', 'XKX'],
  );
  assert.equal(universe.eligibleCount, 7);
  assert.equal(universe.aggregates.some((row) => row.id === 'XKX'), false);
  assert.equal(universe.aggregates.some((row) => row.id === 'PSE'), false);
});

test('aggregates are counted separately and never eligible', () => {
  assert.deepEqual(universe.aggregates.map((row) => row.id).sort(), ['HIC', 'WLD']);
  assert.equal(universe.aggregateCount, 2);
  for (const row of universe.aggregates) assert.equal(row.isAggregate, true);
});

test('a metadata entity without any usable identifier is dropped, not ranked', () => {
  assert.equal(universe.totalCount, 9);
  assert.equal(universe.countries.some((row) => row.id === ''), false);
  assert.equal(universe.eligible.some((row) => !row.id), false);
});

test('duplicate metadata entries keep the first definition', () => {
  const duplicated = buildUniverse([
    { id: 'IND', name: 'India', region: { id: 'SAS', value: 'South Asia' } },
    { id: 'IND', name: 'India (second definition)', region: { id: 'SAS', value: 'South Asia' } },
  ]);
  assert.equal(duplicated.totalCount, 1);
  assert.equal(duplicated.eligible[0].name, 'India');
});

test('normalizeIso3 trims, upper-cases and maps blank to null', () => {
  assert.equal(normalizeIso3(' ind '), 'IND');
  assert.equal(normalizeIso3(''), null);
  assert.equal(normalizeIso3('   '), null);
  assert.equal(normalizeIso3(null), null);
  assert.equal(normalizeIso3(undefined), null);
});

test('toCountryRow records the aggregate verdict and reason', () => {
  const row = toCountryRow({ id: 'WLD', name: 'World', region: { id: 'NA', value: 'Aggregates' } });
  assert.equal(row.isAggregate, true);
  assert.equal(row.aggregateReason, AGGREGATE_REASONS.REGION_ID_NA);
  assert.equal(row.id, 'WLD');
});

test('observation rejection codes are distinct', () => {
  assert.deepEqual(Object.values(OBSERVATION_REJECTIONS).sort(), [
    'aggregate_entity',
    'blank_iso3',
    'invalid_year',
    'missing_value',
    'non_finite_value',
    'unknown_country',
  ]);
  assert.equal(new Set(Object.values(OBSERVATION_REJECTIONS)).size, 6);
});

test('classifyObservation: null and non-finite values are never eligible', () => {
  assert.equal(
    classifyObservation({ iso3: 'IND', value: null, year: 2005 }, index.eligibleIso3Set, index).reason,
    OBSERVATION_REJECTIONS.MISSING_VALUE,
  );
  assert.equal(
    classifyObservation({ iso3: 'IND', value: Number.NaN, year: 2005 }, index.eligibleIso3Set, index).reason,
    OBSERVATION_REJECTIONS.NON_FINITE_VALUE,
  );
  assert.equal(
    classifyObservation({ iso3: 'IND', value: Number.POSITIVE_INFINITY, year: 2005 }, index.eligibleIso3Set, index)
      .reason,
    OBSERVATION_REJECTIONS.NON_FINITE_VALUE,
  );
});

test('classifyObservation: blank ISO3 income-group rows are rejected', () => {
  const verdict = classifyObservation({ iso3: '', value: 45545.9, year: 2004 }, index.eligibleIso3Set, index);
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reason, OBSERVATION_REJECTIONS.BLANK_ISO3);
});

test('classifyObservation separates aggregate entities from unknown countries', () => {
  const aggregate = classifyObservation({ iso3: 'WLD', value: 13313.86, year: 2004 }, index.eligibleIso3Set, index);
  assert.equal(aggregate.reason, OBSERVATION_REJECTIONS.AGGREGATE_ENTITY);

  const unknown = classifyObservation({ iso3: 'ZZZ', value: 999.5, year: 2004 }, index.eligibleIso3Set, index);
  assert.equal(unknown.reason, OBSERVATION_REJECTIONS.UNKNOWN_COUNTRY);
});

test('classifyObservation: an invalid year is reported separately', () => {
  const verdict = classifyObservation({ iso3: 'IND', value: 1, year: Number.NaN }, index.eligibleIso3Set, index);
  assert.equal(verdict.reason, OBSERVATION_REJECTIONS.INVALID_YEAR);
});

test('classifyObservation: a valid row returns the normalized ISO3 and raw value', () => {
  const verdict = classifyObservation({ iso3: ' ind ', value: 700.75, year: 2004 }, index.eligibleIso3Set, index);
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.iso3, 'IND');
  assert.equal(verdict.value, 700.75);
  assert.equal(verdict.reason, null);
});

test('isMember understands Set, Map and array collections', () => {
  assert.equal(isMember(new Set(['IND']), 'IND'), true);
  assert.equal(isMember(new Map([['IND', true]]), 'IND'), true);
  assert.equal(isMember(['IND'], 'IND'), true);
  assert.equal(isMember(new Set(['IND']), 'USA'), false);
  assert.equal(isMember(null, 'IND'), false);
});

test('the documented universe rule covers every exclusion and the denominator meaning', () => {
  const rule = describeUniverseRule();
  assert.match(rule.aggregateRule, /region\.id is "NA"/);
  assert.match(rule.aggregateRule, /region\.value is "Aggregates"/);
  assert.match(rule.aggregateRule, /ISO3 code is blank/);
  assert.match(rule.observationRule, /value is non-null/);
  assert.match(rule.observationRule, /ISO3 is non-blank/);
  assert.match(
    rule.denominatorMeaning,
    /number of eligible countries\/economies holding a valid World Bank observation/,
  );
  assert.match(rule.denominatorMeaning, /does not mean the number of countries in the world/);
  assert.match(rule.blankIso3Note, /income-group aggregates/);
});