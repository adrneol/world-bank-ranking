/**
 * TURSO SELECTION + DRIVER CONTRACT TESTS (Phase 6A).
 *
 * Pins the new database-layer contracts without requiring a live Turso
 * database: batch-write ordering/chunking, REAL-as-text binding
 * round-trip (the Turso float-transit fix), local-fallback file probing,
 * and default backend selection. Live Turso behavior (seed, TTL, degraded
 * boot) is verified manually against the real database; see the Phase 6A
 * report for measurements.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Missing-file probe target: must not exist.
process.env.DATABASE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wdi-probe-')), 'wb.db');
// Hermetic DB-selection fixture: this file must observe "no Turso
// configured" even when the developer's ambient backend/.env points at
// production Turso. config.js loads .env at first import without overriding
// preset variables and treats '' as unset, so clearing here — before any
// dynamic import below — restores the intended precondition deterministically.
process.env.TURSO_DATABASE_URL = '';
process.env.DB_MODE = '';

test('driver batchRun preserves statement order across chunks', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { batchRun } = await import('../src/db/driver.js');
  const { queryAll } = await import('../src/db/driver.js');
  const db = await createMemoryDb();
  try {
    await db.execute({ sql: 'CREATE TABLE probe (id INTEGER PRIMARY KEY, v INTEGER)', args: [] });
    const statements = Array.from({ length: 1200 }, (_, i) => ({
      sql: 'INSERT INTO probe (v) VALUES (?)',
      args: [i],
    }));
    const n = await batchRun(db, statements, { chunkSize: 500 });
    assert.equal(n, 1200);
    const rows = await queryAll(db, 'SELECT v FROM probe ORDER BY id');
    assert.deepEqual(
      rows.map((r) => r.v),
      Array.from({ length: 1200 }, (_, i) => i),
    );
  } finally {
    db.close();
  }
});

test('REAL values bound as text round-trip bitwise-identically', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { upsertIndicator, upsertCountry, upsertObservation, getIndicatorByMetricKey } =
    await import('../src/db/repository.js');
  const { queryGet } = await import('../src/db/driver.js');
  const db = await createMemoryDb();
  try {
    await upsertCountry(db, { id: 'AAA', iso2: 'AA', iso3: 'AAA', name: 'Alpha', isAggregate: false });
    await upsertIndicator(db, { indicatorCode: 'X.A', key: 'm', name: 'M', unit: 'u' });
    const indicatorId = (await getIndicatorByMetricKey(db, 'm')).id;
    // 15-significant-digit decimal whose nearest double needs 17 digits:
    // the exact case that drifted by 1 ulp through remote JSON numbers.
    const lexical = '1.44505532582099e-9';
    await upsertObservation(db, { countryId: 'AAA', indicatorId, year: 2000, value: Number(lexical), valueRaw: lexical });
    const row = await queryGet(db, 'SELECT value, value_raw FROM observations');
    assert.equal(row.value, Number(lexical), 'stored double equals the parsed lexical exactly');
    assert.equal(Number(row.value_raw), row.value, 'audit round-trip holds');
  } finally {
    db.close();
  }
});

test('openExistingLocalDb returns null when no local file exists', async () => {
  const { openExistingLocalDb, resolveDbMode } = await import('../src/db/index.js');
  assert.equal(resolveDbMode(), 'local', 'no TURSO_DATABASE_URL means local backend');
  assert.equal(await openExistingLocalDb(), null);
});

test('years cache key advances only on successful publishes', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { yearsCacheKey, resetYearsCache } = await import('../src/services/yearsCache.js');
  const { upsertCountry, upsertIndicator, upsertObservation, getIndicatorByMetricKey, startFetchRun, finishFetchRun } =
    await import('../src/db/repository.js');
  resetYearsCache();
  const db = await createMemoryDb();
  try {
    const before = await yearsCacheKey(db);
    await upsertCountry(db, { id: 'AAA', iso2: 'AA', iso3: 'AAA', name: 'Alpha', isAggregate: false });
    await upsertIndicator(db, { indicatorCode: 'X.A', key: 'm', name: 'M', unit: 'u' });
    const indicatorId = (await getIndicatorByMetricKey(db, 'm')).id;
    await upsertObservation(db, { countryId: 'AAA', indicatorId, year: 2000, value: 1 });
    // Key is stable across repeated reads of the same generation…
    assert.equal(await yearsCacheKey(db), await yearsCacheKey(db));
    const runId = await startFetchRun(db, {
      trigger: 't', endpoint: 't', requestedStartYear: 2000, requestedEndYear: 2000,
      fetchedStartYear: 2000, fetchedEndYear: 2000, indicators: 'X.A',
    });
    await finishFetchRun(db, runId, { status: 'success' });
    // …a recorded success run advances it.
    assert.notEqual(await yearsCacheKey(db), before);
  } finally {
    db.close();
    resetYearsCache();
  }
});
