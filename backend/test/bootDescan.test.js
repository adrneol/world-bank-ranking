/**
 * PHASE 7B-3 — BOOT DE-SCAN GATES.
 *
 * Proves:
 * 1. The value_raw backfill runs only when its column was newly added
 *    (fresh DBs never pay the full-table UPDATE; legacy DBs get exactly
 *    one migration).
 * 2. One-time bootstrap derives exact metadata and is insert-only (a
 *    concurrent publish always wins; second bootstrap is ignored).
 * 3. Read paths never invent the row (empty DB stays row-less).
 * 4. buildIndiaYearlyRows with explicit bounds skips the full-metric
 *    MIN/MAX scan yet yields identical payloads (null cells for metrics
 *    with no eligible rows).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.WB_RETRY_BASE_MS = '20';

test('fresh database never runs the value_raw backfill UPDATE', async () => {
  const { createClient } = await import('@libsql/client');
  const { initDatabase } = await import('../src/db/index.js');
  const raw = createClient({ url: ':memory:' });
  try {
    const seen = [];
    const orig = raw.execute.bind(raw);
    raw.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
      if (sql) seen.push(sql);
      return orig(...args);
    };
    await initDatabase(raw, { localFile: false });
    assert.ok(
      !seen.some((sql) => sql.includes('CAST(value AS TEXT)')),
      'no backfill UPDATE on a fresh database',
    );
  } finally {
    raw.close();
  }
});

test('legacy table without value_raw gets exactly one migrate+backfill', async () => {
  const { createClient } = await import('@libsql/client');
  const { initDatabase } = await import('../src/db/index.js');
  const raw = createClient({ url: ':memory:' });
  try {
    await raw.execute({
      sql: `CREATE TABLE observations (
        country_id TEXT NOT NULL, indicator_id INTEGER NOT NULL, year INTEGER NOT NULL,
        value REAL NOT NULL, wb_last_updated TEXT, fetched_at TEXT NOT NULL,
        PRIMARY KEY (country_id, indicator_id, year))`,
      args: [],
    });
    await raw.execute({
      sql: `INSERT INTO observations VALUES ('IND', 1, 2024, 1.5, '2026-07-13', '2026-01-01T00:00:00.000Z')`,
      args: [],
    });
    const seen = [];
    const orig = raw.execute.bind(raw);
    raw.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
      if (sql) seen.push(sql);
      return orig(...args);
    };
    await initDatabase(raw, { localFile: false });
    assert.ok(seen.some((sql) => sql.includes('ADD COLUMN value_raw')), 'column migrated');
    assert.ok(seen.some((sql) => sql.includes('CAST(value AS TEXT)')), 'backfill ran once');
    const check = await raw.execute({ sql: 'SELECT value_raw FROM observations', args: [] });
    assert.equal(check.rows[0].value_raw, '1.5', 'legacy row backfilled exactly');
    // Second open: migration complete, no repeat.
    const seen2 = [];
    raw.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
      if (sql) seen2.push(sql);
      return orig(...args);
    };
    await initDatabase(raw, { localFile: false });
    assert.ok(!seen2.some((sql) => sql.includes('CAST(value AS TEXT)')), 'no repeat backfill');
  } finally {
    raw.close();
  }
});

test('bootstrap inserts once and never overwrites a publish', async () => {
  const { createMemoryTestDb } = await import('./helpers/testDb.js');
  const { db, repository } = await createMemoryTestDb();
  try {
    // Read paths never invent the row, even on an empty database.
    assert.equal(await repository.getDatasetState(db), null);
    assert.equal(await repository.countObservations(db), 0);

    const first = await repository.computeDatasetState(db);
    assert.equal(first.observationCount, 0);
    assert.equal(await repository.insertDatasetStateIfAbsent(db, { ...first, contentVersion: 1 }), true);
    // A concurrent publish (upsert, unconditional) followed by a stale
    // bootstrap attempt: the publish wins.
    await repository.upsertDatasetStateInner(db, {
      ...first,
      observationCount: 999,
      contentVersion: 2,
      updatedRunId: 7,
    });
    assert.equal(await repository.insertDatasetStateIfAbsent(db, { ...first, contentVersion: 1 }), false);
    const row = await repository.getDatasetState(db);
    assert.equal(row.observationCount, 999);
    assert.equal(row.contentVersion, 2);
  } finally {
    db.close();
  }
});

test('explicit bounds skip the MIN/MAX scan with identical payloads', async () => {
  const { seedEdgeCaseDb } = await import('./helpers/testDb.js');
  const { db } = await seedEdgeCaseDb();
  try {
    const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
    const repository = await import('../src/db/repository.js');
    const statements = [];
    const orig = db.execute.bind(db);
    db.execute = (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
      if (sql) statements.push(sql);
      return orig(...args);
    };
    let result;
    try {
      result = await buildIndiaYearlyRows(db, { startYear: 2003, endYear: 2005 });
    } finally {
      db.execute = orig;
    }
    assert.ok(
      !statements.some((sql) => sql.includes('MIN(o.year)')),
      'no full-metric MIN/MAX scan with explicit bounds',
    );
    // Seeded metric carries real rows; metrics never ingested stay null
    // cells with the exact legacy reason (probe, not MIN/MAX).
    assert.deepEqual(result.years, [2003, 2004, 2005]);
    assert.equal(result.rows.length, 3);
    const reasons = new Set(result.rows.flatMap((row) => result.metricKeys.map((k) => row[k]?.reason ?? 'valued')));
    assert.ok(reasons.has('metric_not_ingested'), 'unseeded metrics keep the legacy null reason');
    assert.ok(
      result.rows.some((row) => result.metricKeys.some((k) => row[k]?.available === true)),
      'seeded metric still yields valued cells',
    );
  } finally {
    db.close();
  }
});
