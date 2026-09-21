/**
 * BACKEND SERVICE TESTS (specification sections 7, 15-22).
 *
 * Every service is exercised against the seeded edge-case database:
 * full ranking (pagination + search without renumbering), rank verification
 * (windows + boundaries), YoY verification, full YoY ranking, coverage panels
 * and the changing-totals explanation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE_EXPECTATIONS } from './fixtures/edgeCases.js';
import { seedEdgeCaseDb } from './helpers/testDb.js';

test('buildFullRanking paginates without renumbering and searches without recalculation', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildFullRanking } = await import('../src/services/fullRanking.js');

  const page1 = buildFullRanking(db, { metricKey: 'nominal_current', year: 2005, page: 1, pageSize: 4 });
  assert.equal(page1.total, 6);
  assert.equal(page1.pages, 2);
  assert.deepEqual(page1.rows.map((r) => r.rank), [1, 2, 3, 4]);

  const page2 = buildFullRanking(db, { metricKey: 'nominal_current', year: 2005, page: 2, pageSize: 4 });
  assert.deepEqual(page2.rows.map((r) => r.rank), [5, 6]);

  const searched = buildFullRanking(db, { metricKey: 'nominal_current', year: 2005, search: 'indi' });
  assert.equal(searched.search.matchCount, 1);
  assert.equal(searched.search.matches[0].iso3, 'IND');
  assert.equal(searched.search.matches[0].rank, 5, 'search preserves the original rank number');
  assert.equal(searched.total, 6, 'search never changes the denominator');
});

test('buildRankVerification returns focus, neighbors and exact window', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildRankVerification } = await import('../src/services/rankVerification.js');

  const result = buildRankVerification(db, { metricKey: 'nominal_current', year: 2005, neighbors: 2 });
  assert.equal(result.available, true);
  assert.equal(result.focus.iso3, 'IND');
  assert.equal(result.focus.rank, 5);
  assert.equal(result.focus.total, 6);
  assert.equal(result.focus.rowsAbove, 4);
  assert.equal(result.focus.rowsBelow, 1);
  assert.equal(result.focus.rawValueText, '800.125');
  assert.deepEqual(result.above.map((r) => r.iso3), ['PSE', 'BRA']);
  assert.deepEqual(result.below.map((r) => r.iso3), ['CIV']);
  assert.equal(result.window.start, 3);
  assert.equal(result.window.end, 6);
});

test('buildRankVerification boundaries: rank 1 and N=0 and unknown country', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildRankVerification } = await import('../src/services/rankVerification.js');

  const first = buildRankVerification(db, { metricKey: 'nominal_current', year: 2005, neighbors: 5, focusIso3: 'USA' });
  assert.equal(first.focus.rank, 1);
  assert.equal(first.above.length, 0);
  assert.equal(first.window.start, 1);

  const zero = buildRankVerification(db, { metricKey: 'nominal_current', year: 2005, neighbors: 0 });
  assert.deepEqual(zero.above, []);
  assert.deepEqual(zero.below, []);
  assert.equal(zero.window.rows.length, 1);

  const missing = buildRankVerification(db, { metricKey: 'nominal_current', year: 2005, focusIso3: 'ZZZ' });
  assert.equal(missing.available, false);
  assert.equal(missing.focus, null);
});

test('buildYoyVerification separates the YoY denominator from the level denominator', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildYoyVerification } = await import('../src/services/yoyVerification.js');

  const result = buildYoyVerification(db, { metricKey: 'nominal_current', year: 2005, neighbors: 2 });
  assert.equal(result.available, true);
  assert.equal(result.focus.iso3, 'IND');
  assert.equal(result.focus.rank, 1);
  assert.equal(result.denominator, EDGE_EXPECTATIONS.yoyPairs[2005]);
  assert.equal(result.levelDenominatorForComparison, EDGE_EXPECTATIONS.levelDenominator[2005]);
  assert.notEqual(result.denominator, result.levelDenominatorForComparison);
  assert.equal(result.focus.yoyPercent, EDGE_EXPECTATIONS.indiaYoyPercent[2005]);
  assert.ok(result.coverage, 'coverage block present');
  assert.equal(result.coverage.validYoyPairs, EDGE_EXPECTATIONS.yoyPairs[2005]);
});

test('buildFullYoyRanking paginates YoY rows and keeps ranks stable under search', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildFullYoyRanking } = await import('../src/services/yoyVerification.js');

  const full = buildFullYoyRanking(db, { metricKey: 'nominal_current', year: 2005, page: 1, pageSize: 2 });
  assert.equal(full.total, EDGE_EXPECTATIONS.yoyPairs[2005]);
  assert.deepEqual(full.rows.map((r) => r.rank), [1, 2]);

  const searched = buildFullYoyRanking(db, { metricKey: 'nominal_current', year: 2005, search: 'IND' });
  assert.equal(searched.search.matchCount, 1);
  assert.equal(searched.search.matches[0].rank, 1);
});

test('coverage panels expose eligible/valid/missing per metric and YoY pairs', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildCoveragePanel, buildYoyCoveragePanel } = await import('../src/services/coverageService.js');

  const panel = buildCoveragePanel(db, { year: 2005 });
  const nominal = panel.metrics.find((m) => m.metric.key === 'nominal_current');
  assert.equal(nominal.eligibleUniverse, 7);
  assert.equal(nominal.validObservations, 6);
  assert.equal(nominal.missingObservations, 1);
  assert.equal(nominal.focus.rank, 5);

  const yoy = buildYoyCoveragePanel(db, { year: 2005 });
  const yoyNominal = yoy.metrics.find((m) => m.metric.key === 'nominal_current');
  assert.equal(yoyNominal.currentValidObservations, 6);
  assert.equal(yoyNominal.previousValidObservations, 7);
  assert.equal(yoyNominal.validYoyPairs, 5);
});
