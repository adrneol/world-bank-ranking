/**
 * PHASE 8B — IN-MEMORY PROGRESS STEPS (no database writes).
 *
 * Proves the progress ledger records per-indicator execution outcomes
 * (published / unchanged / failed) for success, partial and failed runs,
 * and that recording itself performs no observation writes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';

let rowsTransform = null;
let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      rowsTransform ? rowsTransform(metricKey, baseRows) : baseRows,
  });
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const { refreshData, getIngestProgress } = await import('../src/wb/ingest.js');
  stub.reset();
  rowsTransform = null;
  const db = await createMemoryDb();
  const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-seed' });
  assert.equal(summary.status, 'success');
  return { db, refreshData, getIngestProgress };
}

test('successful refresh records one step per indicator with unchanged semantics', async () => {
  const { db, refreshData, getIngestProgress } = await seedDb();
  try {
    stub.reset();
    rowsTransform = null;
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-steps' });
    assert.equal(summary.status, 'success');
    const progress = getIngestProgress();
    assert.equal(progress.stage, 'complete');
    assert.equal(progress.metricKeys.length, 20);
    assert.equal(progress.steps.length, 20);
    for (const step of progress.steps) {
      assert.equal(step.status, 'unchanged');
      assert.ok(typeof step.label === 'string' && step.label.length > 0);
      assert.ok(typeof step.at === 'string');
    }
    // Steps follow the requested metric order.
    assert.deepEqual(
      progress.steps.map((s) => s.metricKey),
      progress.metricKeys,
    );
  } finally {
    db.close();
  }
});

test('partial refresh records failed steps and keeps them after rollback', async () => {
  const { db, refreshData, getIngestProgress } = await seedDb();
  try {
    stub.reset();
    stub.failNextMatching({ status: 500, times: 50, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-steps-partial' });
    assert.equal(summary.status, 'partial');
    const progress = getIngestProgress();
    assert.equal(progress.stage, 'complete');
    assert.equal(progress.summary.status, 'partial');
    const failed = progress.steps.filter((s) => s.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].metricKey, 'total_constant');
    assert.ok(failed[0].error);
    assert.equal(progress.steps.filter((s) => s.status === 'unchanged').length, 19);
  } finally {
    stub.reset();
    db.close();
  }
});

test('changed indicator records a published step', async () => {
  const { db, refreshData, getIngestProgress } = await seedDb();
  try {
    stub.reset();
    rowsTransform = (metricKey, baseRows) => {
      if (metricKey !== 'nominal_current') return baseRows;
      let bumped = false;
      return baseRows.map((row) => {
        if (!bumped && row.value !== null && row.value !== undefined) {
          bumped = true;
          const n = Number(row.value);
          return { ...row, value: typeof row.value === 'string' ? String(n + 1) : n + 1 };
        }
        return row;
      });
    };
    const summary = await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test-steps-changed' });
    assert.equal(summary.status, 'success');
    const steps = getIngestProgress().steps;
    const changed = steps.find((s) => s.metricKey === 'nominal_current');
    assert.equal(changed.status, 'published');
    assert.ok(changed.rows > 0);
    assert.ok(steps.filter((s) => s.status === 'unchanged').length === 19);
  } finally {
    rowsTransform = null;
    stub.reset();
    db.close();
  }
});
