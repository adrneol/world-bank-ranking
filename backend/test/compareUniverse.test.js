/**
 * COMPARE UNIVERSE — PURE DOMAIN TESTS.
 *
 * The comparison universe is the backbone of the Compare tab: one frozen
 * set of eligible countries, one completeness rule, one auditable exclusion
 * ledger. These tests exercise the pure builder with hand-built fixtures.
 *
 * The expected values are rebuilt INDEPENDENTLY here (plain loops over the
 * fixture rows, no call into the implementation under test), so the test can
 * only pass if the implementation is right — not if it merely agrees with
 * itself.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COVERAGE_BASIS,
  buildCompareUniverse,
  buildEntityCoverage,
  buildPointCoverage,
  membershipHash,
  UNIVERSE_REASON_CODES,
} from '../src/domain/compareUniverse.js';

/**
 * INDEPENDENT ORACLE: rebuild the expected universe from the fixture rows
 * with a different implementation (explicit loops, no shared helper).
 */
function oracleUniverse(rows, requiredYears, participants) {
  const years = [...requiredYears].sort();
  const present = new Map();
  for (const row of rows) {
    if (!years.includes(row.year)) continue;
    if (!present.has(row.iso3)) present.set(row.iso3, new Set());
    present.get(row.iso3).add(row.year);
  }
  const candidates = [...present.keys()].sort();
  const complete = candidates
    .filter((iso3) => {
      const held = present.get(iso3);
      return years.every((year) => held.has(year));
    })
    .sort();
  const participantSet = new Set(participants);
  const reference = complete.filter((iso3) => !participantSet.has(iso3)).sort();
  const incomplete = candidates
    .filter((iso3) => !complete.includes(iso3))
    .map((iso3) => {
      const held = present.get(iso3);
      return { iso3, missingYears: years.filter((year) => !held.has(year)) };
    });
  return { candidates, complete, reference, incomplete };
}

const YEARS = [2004, 2014];

/** Fixture rows: value 1 for every country/year unless stated otherwise. */
function rowsFor(countries, years = YEARS, value = 100) {
  const rows = [];
  for (const iso3 of countries) {
    for (const year of years) rows.push({ iso3, year, value });
  }
  return rows;
}

test('compare universe: candidates, complete set and reference set are the three documented sets', () => {
  const countries = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
  const rows = rowsFor(countries);
  // EEE holds no observation in 2014 -> candidate but not complete.
  rows.splice(rows.findIndex((r) => r.iso3 === 'EEE' && r.year === 2014), 1);

  const participants = [
    { iso3: 'AAA', role: 'entity' },
    { iso3: 'BBB', role: 'group_member' },
  ];
  const universe = buildCompareUniverse({
    rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
    requiredObservationYears: YEARS,
    participants,
    mode: 'like_for_like',
  });

  const expected = oracleUniverse(rows, YEARS, ['AAA', 'BBB']);
  assert.deepEqual(universe.candidates, expected.candidates);
  assert.deepEqual(universe.complete, expected.complete);
  assert.deepEqual(universe.included, expected.reference);

  assert.equal(universe.candidateCount, 5);
  assert.equal(universe.completeCount, 4);
  assert.equal(universe.includedCount, 2);
  // AAA and BBB are participants: they are complete, but they are NOT peers.
  assert.ok(universe.complete.includes('AAA') && universe.complete.includes('BBB'));
  assert.ok(!universe.included.includes('AAA') && !universe.included.includes('BBB'));
});

test('compare universe: the exclusion ledger names every excluded country exactly once', () => {
  const countries = ['AAA', 'BBB', 'CCC'];
  const rows = rowsFor(countries);
  rows.splice(rows.findIndex((r) => r.iso3 === 'CCC' && r.year === 2014), 1);
  const participants = [{ iso3: 'AAA', role: 'entity' }];

  const universe = buildCompareUniverse({
    rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
    requiredObservationYears: YEARS,
    participants,
  });

  // AAA is a participant AND complete; CCC is incomplete. Each appears once.
  const distinct = universe.excluded.distinct;
  assert.equal(distinct.length, 2);
  assert.equal(distinct.filter((e) => e.iso3 === 'AAA').length, 1);
  assert.equal(distinct.filter((e) => e.iso3 === 'CCC').length, 1);
  assert.deepEqual(
    distinct.find((e) => e.iso3 === 'AAA').reasons,
    [UNIVERSE_REASON_CODES.COMPARISON_PARTICIPANT],
  );
  assert.deepEqual(
    distinct.find((e) => e.iso3 === 'CCC').reasons,
    [UNIVERSE_REASON_CODES.MISSING_REQUIRED_OBSERVATION],
  );
  assert.deepEqual(distinct.find((e) => e.iso3 === 'CCC').missingYears, [2014]);
  // A country that is BOTH a participant and incomplete carries both reasons.
  assert.equal(universe.counts.excludedDistinct, distinct.length);
  assert.equal(universe.counts.excludedIncomplete, 1);
  assert.equal(universe.counts.excludedParticipants, 1);
  assert.equal(universe.counts.missingObservations, 1);
});

test('compare universe: a country missing two years counts once but reports both observations', () => {
  // Three required years: a country that holds only the first one is a
  // candidate (it holds an observation in a required year) but is incomplete.
  const threeYears = [2004, 2009, 2014];
  const rows = rowsFor(['AAA', 'BBB', 'CCC'], threeYears);
  rows.splice(rows.findIndex((r) => r.iso3 === 'CCC' && r.year === 2014), 1);
  rows.splice(rows.findIndex((r) => r.iso3 === 'CCC' && r.year === 2009), 1);
  const universe = buildCompareUniverse({
    rowsByYear: new Map(threeYears.map((y) => [y, rows.filter((r) => r.year === y)])),
    requiredObservationYears: threeYears,
    participants: [],
  });
  assert.equal(universe.counts.excludedIncomplete, 1, 'one distinct country');
  assert.equal(universe.counts.missingObservations, 2, 'two missing observations');
  assert.deepEqual(
    universe.excluded.incomplete.find((e) => e.iso3 === 'CCC').missingYears,
    [2009, 2014],
  );
  assert.deepEqual(
    universe.missingObservations.map((m) => `${m.iso3}:${m.year}`),
    ['CCC:2009', 'CCC:2014'],
  );
});

test('compare universe: a country without any observation never becomes a candidate', () => {
  const rows = rowsFor(['AAA', 'BBB']);
  const universe = buildCompareUniverse({
    rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
    requiredObservationYears: YEARS,
    participants: [],
  });
  assert.ok(!universe.candidates.includes('ZZZ'));
  assert.equal(universe.candidateCount, 2);
});

test('compare universe: the membership hash is order independent and content dependent', () => {
  const a = membershipHash(['AAA', 'BBB', 'CCC']);
  const b = membershipHash(['CCC', 'AAA', 'BBB']);
  const c = membershipHash(['AAA', 'BBB']);
  assert.equal(a, b, 'the hash depends on the set, not on the order');
  assert.notEqual(a, c, 'a different set has a different hash');
  assert.match(a, /^fnv1a32:[0-9a-f]{8}$/);
});

test('compare universe: the same inputs always produce the same universe', () => {
  const rows = rowsFor(['AAA', 'BBB', 'CCC']);
  const build = () =>
    buildCompareUniverse({
      rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
      requiredObservationYears: YEARS,
      participants: [{ iso3: 'AAA', role: 'entity' }],
    });
  const first = build();
  const second = build();
  assert.deepEqual(first.candidates, second.candidates);
  assert.deepEqual(first.complete, second.complete);
  assert.deepEqual(first.included, second.included);
  assert.equal(first.membershipHash, second.membershipHash);
});

test('entity coverage: a group uses only the members that satisfy the frozen completeness rule', () => {
  const rows = rowsFor(['AAA', 'BBB', 'CCC']);
  rows.splice(rows.findIndex((r) => r.iso3 === 'CCC' && r.year === 2014), 1);
  const universe = buildCompareUniverse({
    rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
    requiredObservationYears: YEARS,
    participants: [{ iso3: 'AAA', role: 'group_member' }, { iso3: 'BBB', role: 'group_member' }, { iso3: 'CCC', role: 'group_member' }],
  });
  const coverage = buildEntityCoverage({
    members: ['AAA', 'BBB', 'CCC'],
    requiredObservationYears: YEARS,
    rowsByYear: new Map(YEARS.map((y) => [y, rows.filter((r) => r.year === y)])),
    completeSet: new Set(universe.complete),
  });
  assert.equal(coverage.basis, COVERAGE_BASIS.COMMON_UNIVERSE);
  assert.deepEqual(coverage.used, ['AAA', 'BBB']);
  assert.equal(coverage.usedCount, 2);
  assert.equal(coverage.complete, false, 'CCC could not be retained');
  assert.deepEqual(coverage.missingMembers, ['CCC']);
  assert.equal(coverage.byYear[2014].missingCount, 1);
  assert.deepEqual(coverage.byYear[2014].missing, ['CCC']);
});

test('point coverage: a country missing a required year is not complete', () => {
  const valuesByYear = new Map([
    [2004, { value: 10 }],
    [2014, null],
  ]);
  const coverage = buildPointCoverage({
    iso3: 'AAA',
    requiredObservationYears: YEARS,
    valuesByYear,
    basis: COVERAGE_BASIS.ENTITY_OWN_OBSERVATION,
  });
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missingYears, [2014]);
  assert.equal(coverage.usedCount, 0);
  assert.equal(coverage.byYear[2004].available, true);
  assert.equal(coverage.byYear[2014].available, false);
});

test('point coverage: an official aggregate keeps its published semantics', () => {
  const valuesByYear = new Map([
    [2004, { value: 1000 }],
    [2014, { value: 1200 }],
  ]);
  const coverage = buildPointCoverage({
    iso3: 'WLD',
    requiredObservationYears: YEARS,
    valuesByYear,
    basis: COVERAGE_BASIS.WORLD_BANK_PUBLISHED,
  });
  assert.equal(coverage.basis, COVERAGE_BASIS.WORLD_BANK_PUBLISHED);
  assert.equal(coverage.complete, true);
  assert.deepEqual(coverage.used, ['WLD']);
});
