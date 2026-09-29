/**
 * EQUIVALENCE HARNESS TESTS (Phase 6C-2).
 *
 * Gate 1 (self-proof): the current pipeline ingested twice independently
 * must produce byte-identical datasets and analytical outputs. If this
 * fails, the harness or pipeline is nondeterministic and no optimization
 * may proceed.
 * Gate 2 (sensitivity): a single mutated value must break equivalence,
 * proving the harness detects one-row/one-value divergence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { analyticalSnapshot, canonicalDatasetDigest, digestSnapshot, stripVolatileAge } from './helpers/equivalence.js';

process.env.WB_RETRY_BASE_MS = '20';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function ingestFresh() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await createMemoryDb();
  stub.reset();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-equivalence' });
  assert.equal(summary.status, 'success');
  return db;
}

test('SELF-PROOF: independent ingests produce identical datasets', async () => {
  const dbA = await ingestFresh();
  const dbB = await ingestFresh();
  try {
    const digestA = await canonicalDatasetDigest(dbA);
    const digestB = await canonicalDatasetDigest(dbB);
    assert.ok(digestA.counts.observations > 0, 'seeded observations exist');
    assert.deepEqual(digestB, digestA);
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('SELF-PROOF: independent ingests produce identical analytical outputs', async () => {
  const dbA = await ingestFresh();
  const dbB = await ingestFresh();
  try {
    const snapA = stripVolatileAge(await analyticalSnapshot(dbA));
    const snapB = stripVolatileAge(await analyticalSnapshot(dbB));
    assert.equal(digestSnapshot(snapB), digestSnapshot(snapA));
  } finally {
    dbA.close();
    dbB.close();
  }
});

test('SENSITIVITY: one mutated value breaks dataset equivalence', async () => {
  const dbA = await ingestFresh();
  const dbB = await ingestFresh();
  try {
    const before = await canonicalDatasetDigest(dbB);
    const { queryRun } = await import('../src/db/driver.js');
    await queryRun(dbB, 'UPDATE observations SET value = value + 1 WHERE rowid = (SELECT MIN(rowid) FROM observations)');
    const after = await canonicalDatasetDigest(dbB);
    assert.notEqual(after.combined, before.combined, 'single-value mutation must be detected');
    assert.notEqual(after.tables.observations, before.tables.observations);
    assert.equal(after.tables.countries, before.tables.countries, 'untouched tables stay identical');
    const control = await canonicalDatasetDigest(dbA);
    assert.equal(control.combined, before.combined, 'unmutated twin is unaffected');
  } finally {
    dbA.close();
    dbB.close();
  }
});
