/**
 * INDIA YEARLY SERVICE TESTS (specification sections 10, 15, 30).
 *
 * Regression coverage for the `stored is not defined` ReferenceError: the
 * default range (no startYear/endYear) must derive per-metric ranges from the
 * stored observations instead of throwing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE_EXPECTATIONS } from './fixtures/edgeCases.js';
import { seedEdgeCaseDb, createMemoryTestDb } from './helpers/testDb.js';

test('default range derives years from stored data instead of throwing', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  // Would previously throw `ReferenceError: stored is not defined`.
  // Edge dataset minimum is 2002 (USA only); India has no 2002 observation.
  const result = buildIndiaYearlyRows(db, {});

  assert.deepEqual(result.years, [2002, 2003, 2004, 2005]);
  assert.equal(result.startYear, 2002);
  assert.equal(result.endYear, 2005);
  assert.equal(result.rows.length, 4);
  assert.equal(result.eligibleUniverse, EDGE_EXPECTATIONS.eligibleUniverse);
});

test('default range carries correct India values, ranks and totals', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  const result = buildIndiaYearlyRows(db, {});
  const byYear = new Map(result.rows.map((row) => [row.year, row]));

  for (const year of [2003, 2004, 2005]) {
    const cell = byYear.get(year).nominal_current;
    assert.equal(cell.indiaValue, EDGE_EXPECTATIONS.indiaValue[year], `value ${year}`);
    assert.equal(cell.indiaRank, EDGE_EXPECTATIONS.indiaRank[year], `rank ${year}`);
    assert.equal(cell.total, EDGE_EXPECTATIONS.levelDenominator[year], `total ${year}`);
    assert.equal(cell.available, true);
  }
});

test('default range YoY uses the extra preceding year', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  const result = buildIndiaYearlyRows(db, {});
  const byYear = new Map(result.rows.map((row) => [row.year, row]));

  // 2003 has no 2002 India observation in the edge dataset.
  assert.equal(byYear.get(2003).nominal_current.indiaYoY, null);
  assert.ok(byYear.get(2003).nominal_current.indiaYoYReason);
  assert.equal(
    byYear.get(2004).nominal_current.indiaYoY,
    EDGE_EXPECTATIONS.indiaYoyPercent[2004],
  );
  assert.equal(
    byYear.get(2005).nominal_current.indiaYoY,
    EDGE_EXPECTATIONS.indiaYoyPercent[2005],
  );
});

test('explicit range still works and matches the default for the same years', async () => {
  const { db } = await seedEdgeCaseDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  const explicit = buildIndiaYearlyRows(db, { startYear: 2003, endYear: 2005 });
  const implicit = buildIndiaYearlyRows(db, {});

  assert.deepEqual(
    explicit.rows.map((r) => r.nominal_current.indiaRank),
    implicit.rows.filter((r) => r.year >= 2003).map((r) => r.nominal_current.indiaRank),
  );
  // 2002 exists in the default range with India unavailable (no 2002 observation).
  const y2002 = implicit.rows.find((r) => r.year === 2002).nominal_current;
  assert.equal(y2002.available, false);
  assert.equal(y2002.indiaRank, null);
});

test('empty database returns no rows without throwing', async () => {
  const { db } = await createMemoryTestDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  const result = buildIndiaYearlyRows(db, {});
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.years, []);
});
