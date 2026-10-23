/**
 * COMPARE UNIVERSE — MANDATED REGRESSION (200 / 4 / 1 / 195).
 *
 * The scenario required by the methodology brief:
 *
 *   - an initial eligible candidate universe of 200 countries,
 *   - four comparison participants that must be excluded from the peer
 *     reference universe,
 *   - one further country that lacks a required observation,
 *   - and therefore a final common universe of exactly 195 countries.
 *
 * Every expectation is rebuilt INDEPENDENTLY from the seeded fixture data
 * (a plain loop over the rows this test inserted), never by calling the
 * implementation under test. The count 195 is never written into application
 * logic: it is the outcome of the data, and the test asserts that outcome.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { METRICS } from '../src/config.js';
import { createMemoryTestDb } from './helpers/testDb.js';
import { buildCompareResponse } from '../src/services/entityCompare.js';

const YEAR_A = 2004;
const YEAR_B = 2014;
const CANDIDATE_COUNT = 200;

/** Deterministic, distinct 3-letter codes: CAA, CAB, ... CHR. */
function iso3(index) {
  return `C${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
}

const ALL_ISO3 = Array.from({ length: CANDIDATE_COUNT }, (_, i) => iso3(i));
/** The four comparison participants: one country entity + three group members. */
const PARTICIPANT_ENTITY = ALL_ISO3[0];
const PARTICIPANT_GROUP = [ALL_ISO3[1], ALL_ISO3[2], ALL_ISO3[3]];
/** The country that holds the first year but not the second. */
const INCOMPLETE_ISO3 = ALL_ISO3[199];

/**
 * Seed the fixture: 200 eligible countries with observations in both years,
 * except the incomplete country, plus one official aggregate.
 */
async function seedUniverseDb() {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse } = await import('../src/domain/universe.js');
  const metadata = ALL_ISO3.map((code) => ({
    id: code,
    iso2Code: code.slice(0, 2),
    name: `Country ${code}`,
    region: { id: 'ECS', value: 'Europe & Central Asia' },
  }));
  metadata.push({ id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA', value: 'Aggregates' } });
  const universe = buildUniverse(metadata);
  await repository.upsertCountries(db, universe.countries);
  await repository.upsertIndicator(db, {
    ...METRICS.total_current,
    name: 'total_current',
    unit: METRICS.total_current.unit,
    source: 'World Development Indicators',
  });
  const indicator = await repository.getIndicatorByMetricKey(db, 'total_current');
  const rows = [];
  for (const code of ALL_ISO3) {
    rows.push({ countryId: code, indicatorId: indicator.id, year: YEAR_A, value: 1000, wbLastUpdated: '2026-07-13' });
    if (code !== INCOMPLETE_ISO3) {
      rows.push({ countryId: code, indicatorId: indicator.id, year: YEAR_B, value: 2000, wbLastUpdated: '2026-07-13' });
    }
  }
  // The published World Bank aggregate (never reconstructed from countries).
  rows.push({ countryId: 'WLD', indicatorId: indicator.id, year: YEAR_A, value: 500000, wbLastUpdated: '2026-07-13' });
  rows.push({ countryId: 'WLD', indicatorId: indicator.id, year: YEAR_B, value: 900000, wbLastUpdated: '2026-07-13' });
  await repository.upsertObservations(db, rows);
  return { db, repository, indicator };
}

/**
 * INDEPENDENT ORACLE: rebuild the expected reference universe directly from
 * the fixture definition, without touching the implementation.
 */
function oracleReferenceUniverse() {
  const participants = new Set([PARTICIPANT_ENTITY, ...PARTICIPANT_GROUP]);
  const complete = ALL_ISO3.filter((code) => code !== INCOMPLETE_ISO3);
  return {
    candidates: [...ALL_ISO3].sort(),
    complete: [...complete].sort(),
    reference: complete.filter((code) => !participants.has(code)).sort(),
    incomplete: { iso3: INCOMPLETE_ISO3, missingYears: [YEAR_B] },
  };
}

test('regression: the common universe is exactly the 195 eligible countries the data implies', async () => {
  const { db } = await seedUniverseDb();
  const expected = oracleReferenceUniverse();

  const response = await buildCompareResponse(db, {
    entityA: `country:${PARTICIPANT_ENTITY}`,
    entityB: `group:${PARTICIPANT_GROUP.join(',')}`,
    labelB: 'Participants group',
    metricKey: 'total_current',
    yearA: YEAR_A,
    yearB: YEAR_B,
    operation: 'percent_change',
    groupMode: 'like_for_like',
  });

  const universe = response.universe;
  assert.ok(universe, 'the response carries the authoritative universe');

  // The counts are derived from the data, never asserted into the code.
  assert.equal(universe.counts.candidates, CANDIDATE_COUNT);
  assert.equal(universe.counts.complete, expected.complete.length);
  assert.equal(universe.counts.reference, expected.reference.length);
  assert.equal(universe.counts.reference, 195, '200 candidates − 4 participants − 1 incomplete = 195');
  assert.equal(universe.included.length, 195);

  // The included list is exactly the independently rebuilt membership.
  assert.deepEqual(universe.included, expected.reference);
  // The complete set holds the participants too: they are excluded from the
  // PEER set, not from the completeness rule.
  assert.deepEqual(universe.complete, expected.complete);

  // Every participant is absent from the reference universe.
  for (const participant of [PARTICIPANT_ENTITY, ...PARTICIPANT_GROUP]) {
    assert.ok(!universe.included.includes(participant), `${participant} must not be a peer`);
  }
  assert.equal(universe.excluded.participants.length, 4);

  // The incomplete country is identified with its missing year and counted
  // once, and the missing observation is listed.
  assert.equal(universe.counts.excludedIncomplete, 1);
  assert.equal(universe.counts.excludedDistinct, 5, '4 participants + 1 incomplete country');
  assert.equal(universe.counts.missingObservations, 1);
  const incomplete = universe.excluded.incomplete.find((entry) => entry.iso3 === INCOMPLETE_ISO3);
  assert.ok(incomplete, 'the incomplete country is named');
  assert.deepEqual(incomplete.missingYears, [YEAR_B]);
  assert.deepEqual(universe.missingObservations, [{ iso3: INCOMPLETE_ISO3, year: YEAR_B }]);
});

test('regression: every like-for-like result uses the same frozen universe, never a 200 or 199 basis', async () => {
  const { db } = await seedUniverseDb();
  const response = await buildCompareResponse(db, {
    entityA: `country:${PARTICIPANT_ENTITY}`,
    entityB: `group:${PARTICIPANT_GROUP.join(',')}`,
    labelB: 'Participants group',
    metricKey: 'total_current',
    yearA: YEAR_A,
    yearB: YEAR_B,
    operation: 'percent_change',
    groupMode: 'like_for_like',
  });

  const universe = response.universe;
  // The group's like-for-like value is the sum over the members that satisfy
  // the ONE frozen completeness rule — the very same rule that produced the
  // complete universe of the response.
  const group = response.results.b;
  assert.equal(group.kind, 'custom_group');
  assert.equal(group.likeForLike[String(YEAR_A)].members, 3);
  assert.equal(group.likeForLike[String(YEAR_A)].value, 3000);
  assert.equal(group.likeForLike[String(YEAR_B)].value, 6000);
  assert.deepEqual(group.coverageBasis.usedMembers, [...PARTICIPANT_GROUP].sort());
  // The country entity is its own complete observation.
  assert.equal(response.results.a.likeForLike[String(YEAR_A)].value, 1000);
  assert.equal(response.results.a.likeForLike[String(YEAR_B)].value, 2000);
  // The published change is the approved percent change of the two sides.
  assert.equal(response.results.comparison.a.value, 100);
  assert.equal(response.results.comparison.b.value, 100);

  // The universe the results were computed over is the one exposed, not a
  // different one: the membership hash identifies the exact peer set.
  assert.equal(universe.counts.reference, 195);
  assert.equal(universe.counts.complete, 199);
  assert.equal(universe.counts.candidates, 200);
  assert.match(universe.membershipHash, /^fnv1a32:[0-9a-f]{8}$/);
  // The group value is never computed over the candidates (200) nor over the
  // complete set (199): it uses the three members it declares.
  assert.equal(group.likeForLike[String(YEAR_B)].members, 3);
});

test('regression: the same request always yields the same universe and the same result', async () => {
  const { db } = await seedUniverseDb();
  const request = {
    entityA: `country:${PARTICIPANT_ENTITY}`,
    entityB: `group:${PARTICIPANT_GROUP.join(',')}`,
    labelB: 'Participants group',
    metricKey: 'total_current',
    yearA: YEAR_A,
    yearB: YEAR_B,
    operation: 'percent_change',
    groupMode: 'like_for_like',
  };
  const first = await buildCompareResponse(db, request);
  const second = await buildCompareResponse(db, request);
  assert.deepEqual(second.universe.included, first.universe.included);
  assert.equal(second.universe.membershipHash, first.universe.membershipHash);
  assert.deepEqual(second.results.comparison, first.results.comparison);
});

test('regression: an official aggregate keeps its published path and blocks the like-for-like gap', async () => {
  const { db } = await seedUniverseDb();
  const response = await buildCompareResponse(db, {
    entityA: 'aggregate:WLD',
    entityB: `group:${PARTICIPANT_GROUP.join(',')}`,
    labelB: 'Participants group',
    metricKey: 'total_current',
    yearA: YEAR_A,
    yearB: YEAR_B,
    operation: 'percent_change',
    groupMode: 'like_for_like',
  });

  // The published aggregate value is used as published — never recomputed
  // over the common universe, and never relabelled as such.
  assert.equal(response.results.a.coverageBasis.observed, 'WORLD_BANK_PUBLISHED');
  assert.equal(response.results.a.likeForLike[String(YEAR_A)].value, 500000);
  assert.equal(response.results.a.likeForLike[String(YEAR_B)].value, 900000);

  // The derived comparison is blocked, with a specific reason.
  assert.equal(response.results.comparison.available, false);
  assert.equal(response.results.comparison.gap.value, null);
  assert.equal(response.results.comparison.gap.reason, 'AGGREGATE_COVERAGE_NOT_COMPARABLE');
  assert.ok(
    response.diagnostics.some((d) => d.code === 'AGGREGATE_COVERAGE_NOT_COMPARABLE'),
    'the blocked comparison carries a structured diagnostic',
  );

  // The same comparison in OBSERVED mode is publishable: observed mode makes
  // no common-universe claim, and both sides are complete for the period.
  const observed = await buildCompareResponse(db, {
    entityA: 'aggregate:WLD',
    entityB: `group:${PARTICIPANT_GROUP.join(',')}`,
    labelB: 'Participants group',
    metricKey: 'total_current',
    yearA: YEAR_A,
    yearB: YEAR_B,
    operation: 'percent_change',
    groupMode: 'observed',
  });
  assert.equal(observed.results.comparison.available, true);
  assert.equal(observed.results.comparison.a.value, 80);
  assert.equal(observed.results.comparison.b.value, 100);
  assert.equal(observed.results.comparison.gap.value, -20);
});
