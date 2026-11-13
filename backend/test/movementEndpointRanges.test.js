/**
 * PHASE 7D-1 — MOVEMENT ENDPOINT-RANGE EQUIVALENCE GATE.
 *
 * Proves that for endpoint-only movement panels,
 *   getEligibleObservationsForYears(ind, endpoints)
 * returns the identical row multiset (same rows, same order) as
 *   getEligibleObservationsRange(ind, S, E).filter(endpoints),
 * against a disposable database seeded from versioned observations and
 * deterministic historical fixture rows. No developer cache is required.
 *
 * Combined with the consumption audit (downstream code only ever selects
 * endpoint years from these maps), this proves the 7D-1 switches cannot
 * change any movement output.
 */

import { isolation, PROTECTED_DATABASE } from './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { closeDb, getDb } from '../src/db/index.js';
import { seedConfiguredDatabase } from './helpers/configuredDb.js';

test.before(seedConfiguredDatabase);
test.after(closeDb);

async function rangeFiltered(db, repository, indicatorId, years) {
  const rows = await repository.getEligibleObservationsRange(
    db,
    indicatorId,
    Math.min(...years),
    Math.max(...years),
  );
  return rows.filter((r) => years.includes(Number(r.year)));
}

const CASES = [
  { metricKey: 'fx_official', years: [2004, 2025] },
  { metricKey: 'fx_official', years: [2004, 2010, 2025] },
  { metricKey: 'exports_current', years: [2005, 2025] },
  { metricKey: 'fdi_inflows', years: [2004, 2025] },
  { metricKey: 'population_total', years: [2004, 2025] },
  { metricKey: 'nominal_current', years: [2019, 2025] },
];

for (const { metricKey, years } of CASES) {
  test(`endpoint IN-list equals filtered range: ${metricKey} [${years.join(',')}]`, async () => {
    const db = getDb();
    const repository = await import('../src/db/repository.js');
    const indicator = await repository.getIndicatorByMetricKey(db, metricKey);
    assert.ok(indicator, 'indicator exists in the fixture');
    const fromRange = await rangeFiltered(db, repository, indicator.id, years);
    const fromList = await repository.getEligibleObservationsForYears(db, indicator.id, years);
    // Same multiset in the same ORDER BY (year, country_id) — the only
    // columns the movement indexers consume are compared exactly; the
    // ForYears rows additionally carry vintage columns, which are
    // ignored downstream of the movement maps.
    const strip = (rows) =>
      rows.map((r) => [r.iso3, r.year, r.value, r.valueRaw, r.name]);
    assert.deepEqual(strip(fromList), strip(fromRange));
    assert.deepEqual([...new Set(fromList.map(({ year }) => year))], years, 'every requested endpoint is populated');
  });
}

test('annual-change predecessor pairs equal the filtered range', async () => {
  const db = getDb();
  const repository = await import('../src/db/repository.js');
  const indicator = await repository.getIndicatorByMetricKey(db, 'fx_official');
  const years = [2004, 2025];
  const needed = [...new Set(years.flatMap((y) => [y - 1, y]))].sort((a, b) => a - b);
  const fromRange = (
    await repository.getEligibleObservationsRange(db, indicator.id, Math.min(...years) - 1, Math.max(...years))
  ).filter((r) => needed.includes(Number(r.year)));
  const fromList = await repository.getEligibleObservationsForYears(db, indicator.id, needed);
  const strip = (rows) => rows.map((r) => [r.iso3, r.year, r.value, r.valueRaw, r.name]);
  assert.deepEqual(strip(fromList), strip(fromRange));
  assert.deepEqual([...new Set(fromList.map(({ year }) => year))], needed);
});

test('the gate reads an ISOLATED database, never the project artifact', async () => {
  const { default: config } = await import('../src/config.js');
  assert.equal(config.databaseFile, isolation.databaseFile);
  assert.notEqual(config.databaseFile, PROTECTED_DATABASE);
  const db = getDb();
  const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM observations' });
  assert.ok(Number(count.rows[0].n) > 0, 'the isolated database holds observations');
});
