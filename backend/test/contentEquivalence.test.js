/**
 * PHASE 8N — STORED-CONTENT EQUIVALENCE (recovery fast path).
 *
 * compareDatasetContent() proves two database handles hold byte-identical
 * stored content — every indicator's full observation set with O10 identity
 * semantics plus symmetric country metadata — using reads only: no
 * transaction, no World Bank fetch, no writes. Guarded recovery uses it to
 * promote an equivalent primary without a catch-up refresh. No test touches
 * the live World Bank API (stub) or Turso (memory DBs).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return db;
}

test('twin ingests compare identical with rows counted', async () => {
  const { compareDatasetContent, countObservations } = await import('../src/db/repository.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    const beforeA = await countObservations(dbA);
    const beforeB = await countObservations(dbB);
    assert.ok(beforeA > 0 && beforeA === beforeB);
    const result = await compareDatasetContent(dbA, dbB);
    assert.equal(result.identical, true);
    assert.deepEqual(result.differingIndicators, []);
    assert.equal(result.countriesMatch, true);
    assert.ok(result.comparedIndicators > 0);
    assert.equal(result.rowsCompared, beforeA + beforeB);
    // Pure reads: nothing written on either side.
    assert.equal(await countObservations(dbA), beforeA);
    assert.equal(await countObservations(dbB), beforeB);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('a single changed value names exactly its indicator', async () => {
  const { compareDatasetContent } = await import('../src/db/repository.js');
  const { queryAll } = await import('../src/db/driver.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    const [victim] = await queryAll(
      dbB,
      `SELECT o.indicator_id AS indicatorId, i.code AS code
         FROM observations o JOIN indicators i ON i.id = o.indicator_id
         ORDER BY o.rowid LIMIT 1`,
    );
    assert.ok(victim);
    await dbB.execute({
      sql: 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    const result = await compareDatasetContent(dbA, dbB);
    assert.equal(result.identical, false);
    assert.deepEqual(result.differingIndicators, [victim.code]);
    assert.equal(result.countriesMatch, true);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('a changed raw string alone counts as different', async () => {
  const { compareDatasetContent } = await import('../src/db/repository.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    await dbB.execute({
      sql: "UPDATE observations SET value_raw = 'tampered' WHERE rowid = (SELECT MIN(rowid) FROM observations)",
      args: [],
    });
    const result = await compareDatasetContent(dbA, dbB);
    assert.equal(result.identical, false);
    assert.equal(result.differingIndicators.length, 1);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('a missing row on either side counts as different', async () => {
  const { compareDatasetContent } = await import('../src/db/repository.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    await dbB.execute({
      sql: 'DELETE FROM observations WHERE rowid = (SELECT MIN(rowid) FROM observations)',
      args: [],
    });
    assert.equal((await compareDatasetContent(dbA, dbB)).identical, false);
    assert.equal((await compareDatasetContent(dbB, dbA)).identical, false);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('a missing indicator on one side counts as different', async () => {
  const { compareDatasetContent, listIndicators } = await import('../src/db/repository.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    const [first] = await listIndicators(dbB);
    await dbB.execute({ sql: 'DELETE FROM observations WHERE indicator_id = ?', args: [first.id] });
    await dbB.execute({ sql: 'DELETE FROM indicators WHERE id = ?', args: [first.id] });
    const result = await compareDatasetContent(dbA, dbB);
    assert.equal(result.identical, false);
    assert.deepEqual(result.differingIndicators, [first.code]);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('country metadata drift counts as different', async () => {
  const { compareDatasetContent } = await import('../src/db/repository.js');
  const dbA = await seedDb();
  const dbB = await seedDb();
  try {
    await dbB.execute({ sql: "UPDATE countries SET name = name || ' (edited)' WHERE id = (SELECT MIN(id) FROM countries)", args: [] });
    const renamed = await compareDatasetContent(dbA, dbB);
    assert.equal(renamed.identical, false);
    assert.equal(renamed.countriesMatch, false);
    assert.deepEqual(renamed.differingIndicators, []);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('empty database never compares identical to seeded', async () => {
  const { compareDatasetContent } = await import('../src/db/repository.js');
  const { createMemoryDb } = await import('../src/db/index.js');
  const dbA = await seedDb();
  const dbB = await createMemoryDb();
  try {
    const result = await compareDatasetContent(dbA, dbB);
    assert.equal(result.identical, false);
  } finally {
    dbA.close();
    dbB.close();
  }
});
