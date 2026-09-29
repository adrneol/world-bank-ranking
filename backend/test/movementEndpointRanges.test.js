/**
 * PHASE 7D-1 — MOVEMENT ENDPOINT-RANGE EQUIVALENCE GATE.
 *
 * Proves that for endpoint-only movement panels,
 *   getEligibleObservationsForYears(ind, endpoints)
 * returns the identical row multiset (same rows, same order) as
 *   getEligibleObservationsRange(ind, S, E).filter(endpoints),
 * against the real 228k-observation database (read-only: no writes, no
 * refresh, no seed — the file is opened directly and only SELECTed).
 *
 * Combined with the consumption audit (downstream code only ever selects
 * endpoint years from these maps), this proves the 7D-1 switches cannot
 * change any movement output.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@libsql/client';

const DB_URL = 'file:E:/world bank ranking/project/backend/data/worldbank.db';

async function openReadDb() {
  const { initDatabase } = await import('../src/db/index.js');
  const db = createClient({ url: DB_URL });
  await initDatabase(db, { localFile: true });
  return db;
}

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
  { metricKey: 'fx_official', years: [2000, 2025] },
  { metricKey: 'fx_official', years: [2000, 2010, 2025] },
  { metricKey: 'exports_current', years: [2005, 2025] },
  { metricKey: 'fdi_inflows', years: [2000, 2025] },
  { metricKey: 'population_total', years: [1990, 2025] },
  { metricKey: 'nominal_current', years: [2019, 2025] },
];

for (const { metricKey, years } of CASES) {
  test(`endpoint IN-list equals filtered range: ${metricKey} [${years.join(',')}]`, async () => {
    const db = await openReadDb();
    try {
      const repository = await import('../src/db/repository.js');
      const indicator = await repository.getIndicatorByMetricKey(db, metricKey);
      assert.ok(indicator, 'indicator exists in real DB');
      const fromRange = await rangeFiltered(db, repository, indicator.id, years);
      const fromList = await repository.getEligibleObservationsForYears(db, indicator.id, years);
      // Same multiset in the same ORDER BY (year, country_id) — the only
      // columns the movement indexers consume are compared exactly; the
      // ForYears rows additionally carry vintage columns, which are
      // ignored downstream of the movement maps.
      const strip = (rows) =>
        rows.map((r) => [r.iso3, r.year, r.value, r.valueRaw, r.name]);
      assert.deepEqual(strip(fromList), strip(fromRange));
      assert.ok(fromList.length > 0, 'non-empty comparison');
    } finally {
      db.close();
    }
  });
}

test('annual-change predecessor pairs equal the filtered range', async () => {
  const db = await openReadDb();
  try {
    const repository = await import('../src/db/repository.js');
    const indicator = await repository.getIndicatorByMetricKey(db, 'fx_official');
    const years = [2000, 2025];
    const needed = [...new Set(years.flatMap((y) => [y - 1, y]))].sort((a, b) => a - b);
    const fromRange = (
      await repository.getEligibleObservationsRange(db, indicator.id, Math.min(...years) - 1, Math.max(...years))
    ).filter((r) => needed.includes(Number(r.year)));
    const fromList = await repository.getEligibleObservationsForYears(db, indicator.id, needed);
    const strip = (rows) => rows.map((r) => [r.iso3, r.year, r.value, r.valueRaw, r.name]);
    assert.deepEqual(strip(fromList), strip(fromRange));
  } finally {
    db.close();
  }
});
