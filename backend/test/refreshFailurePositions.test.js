/**
 * EDGE MATRIX — FAILURE POSITION INDEPENDENCE.
 *
 * The O7 per-indicator loop is position-agnostic: whether the FIRST or the
 * LAST of the 20 indicators fails, the outcome must be identical —
 * status partial, zero live-table changes, previous dataset exact,
 * lastSuccessAt unmoved, lock released.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';
import { queryAll } from '../src/db/driver.js';

process.env.WB_RETRY_BASE_MS = '20';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedFullDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return { db, repository };
}

async function datasetDigest(db) {
  const rows = await queryAll(
    db,
    `SELECT o.country_id AS c, o.indicator_id AS i, o.year AS y, o.value AS v, o.value_raw AS r
     FROM observations o ORDER BY 1, 2, 3`,
  );
  return JSON.stringify(rows);
}

for (const [name, code, metricKey] of [
  ['first indicator fails', 'NY.GDP.PCAP.CD', 'nominal_current'],
  ['last indicator fails', 'SP.POP.TOTL', 'population_total'],
]) {
  test(`${name}: partial, nothing published, freshness unmoved`, async () => {
    const { db, repository } = await seedFullDb();
    const { refreshData } = await import('../src/wb/ingest.js');
    try {
      stub.reset();
      const before = await datasetDigest(db);
      const lastSuccessBefore = await repository.getLastSuccessfulFetchTime(db);
      stub.failNextMatching({ status: 500, times: 50, substring: `/country/all/indicator/${code}` });

      const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-position' });

      assert.equal(summary.status, 'partial');
      assert.deepEqual(summary.perIndicator.filter((r) => r.error).map((r) => r.metricKey), [metricKey]);
      assert.equal(await datasetDigest(db), before, 'live tables byte-identical');
      assert.equal(await repository.getLastSuccessfulFetchTime(db), lastSuccessBefore);
      const lock = await repository.refreshLockStatus(db);
      assert.equal(Boolean(lock.locked), false);
    } finally {
      stub.reset();
      db.close();
    }
  });
}
