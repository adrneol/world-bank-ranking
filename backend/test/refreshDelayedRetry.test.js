/**
 * DELAYED REFRESH RETRIES — DO THEY ACTUALLY FIRE, AND WHAT SURVIVES A RESTART?
 *
 * The refresh ladder (5m -> 15m -> 30m -> 60m) is the application's only
 * automatic recovery path when the World Bank source is down. These tests
 * answer, explicitly:
 *
 *   1. The scheduled retry FIRES ON ITS OWN - no request, no user, no
 *      scheduler is needed to trigger the next attempt.
 *   2. The ladder is IN-PROCESS ONLY: a restart drops the pending timer.
 *   3. The timer is unref'd, so it never keeps a process alive.
 *   4. After a restart the recovery path is the BOOT STALE-CHECK, not the
 *      dropped timer.
 *   5. The post-failure cooldown prevents a hot loop, and a manual refresh is
 *      never delayed.
 *
 * No unbounded loop is added and no lock or cooldown is bypassed: the tests
 * observe the EXISTING mechanisms through the existing seams.
 */

import './isolation.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';
process.env.WB_REFRESH_RETRY_DELAYS_MS = '80,90,100';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (rel) => pathToFileURL(path.join(BACKEND_ROOT, 'src', ...rel.split('/'))).href;

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({});
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
  delete process.env.WB_REFRESH_RETRY_DELAYS_MS;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

/** Run a child process with the isolation bootstrap in place. */
function runChild(script, { env = {}, timeout = 30000 } = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: BACKEND_ROOT,
    timeout,
    env: {
      ...process.env,
      // Never let a child reach the live World Bank API or Turso.
      WORLD_BANK_API_BASE_URL: 'http://127.0.0.1:9/v2',
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
      DB_MODE: 'local',
      ...env,
    },
  });
}

test('the delayed retry fires on its own, with no request in between', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    // The source is down: the automatic refresh fails and arms the ladder.
    stub.failNext({ status: 502, times: 500 });
    const decision = await ingest.maybeAutoRefresh(db, { onWarn: () => {} });
    assert.equal(decision.triggered, true, 'the stale cache triggered an automatic refresh');

    // Wait for the FIRST attempt to be recorded.
    const start = Date.now();
    let runs = [];
    while (Date.now() - start < 20000) {
      runs = await repository.listFetchRuns(db, 10);
      if (runs.length >= 1 && runs[0].status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(runs[0]?.status, 'failed', 'the automatic attempt failed');
    assert.equal(ingest.getRefreshRetryState().scheduled, true, 'the retry ladder was armed');

    // NO request is made to the application from here on. The ONLY thing that
    // can produce a second attempt is the scheduled timer itself.
    const second = Date.now();
    let attempts = 1;
    while (Date.now() - second < 20000) {
      runs = await repository.listFetchRuns(db, 10);
      attempts = runs.length;
      if (attempts >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(attempts >= 2, 'the scheduled retry fired a second attempt with no request involved');
    assert.ok(
      Date.now() - second < 20000,
      'the retry fired on its own timer, not after a request',
    );
  } finally {
    process.env.WB_REFRESH_RETRY_DISABLED = '1';
    try {
      ingest.cancelScheduledRefreshRetry();
    } finally {
      delete process.env.WB_REFRESH_RETRY_DISABLED;
    }
    stub.reset();
    db.close();
  }
});

test('the ladder is in-process only: a restart drops the pending retry', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    ingest.scheduleRefreshRetry(db, { trigger: 'ttl' });
    assert.equal(ingest.getRefreshRetryState().scheduled, true, 'this process has a pending retry');

    // A NEW process knows nothing about the parent's timer.
    const output = runChild(`
      const { getRefreshRetryState } = await import(${JSON.stringify(SRC('wb/ingest.js'))});
      console.log(JSON.stringify(getRefreshRetryState()));
    `);
    const childState = JSON.parse(output.trim().split('\n').pop());
    assert.equal(childState.scheduled, false, 'a restarted process has no pending retry');
    assert.equal(childState.consecutiveFailures, 0, 'the failure counter is per process');
  } finally {
    ingest.cancelScheduledRefreshRetry();
    db.close();
  }
});

test('the retry timer is unref\'d: it never keeps a process alive', async () => {
  // A ten-minute ladder delay. If the timer were referenced, the child would
  // hang for ten minutes; the child must exit immediately.
  const started = Date.now();
  const output = runChild(
    `
      const { scheduleRefreshRetry, getRefreshRetryState } = await import(${JSON.stringify(
        SRC('wb/ingest.js'),
      )});
      const { createMemoryDb } = await import(${JSON.stringify(SRC('db/index.js'))});
      const db = await createMemoryDb();
      scheduleRefreshRetry(db, { trigger: 'ttl' });
      console.log(JSON.stringify(getRefreshRetryState()));
      // The process now has nothing else to do: the pending timer must not
      // keep it alive.
    `,
    { env: { WB_REFRESH_RETRY_DELAYS_MS: '600000' }, timeout: 20000 },
  );
  const elapsed = Date.now() - started;
  assert.match(output, /"scheduled":true/, 'the retry was armed in the child');
  assert.ok(elapsed < 15000, `the child exited promptly (${elapsed} ms) despite a 10-minute timer`);
});

test('after a restart the boot stale-check re-arms the refresh', async () => {
  // The boot path (server.js) calls maybeAutoRefresh() when the cache is
  // stale. That is the recovery path after a restart dropped the timer.
  const output = runChild(`
    const { createMemoryDb } = await import(${JSON.stringify(SRC('db/index.js'))});
    const { queryRun } = await import(${JSON.stringify(SRC('db/driver.js'))});
    const { maybeAutoRefresh, getRefreshRetryState } = await import(${JSON.stringify(
      SRC('wb/ingest.js'),
    )});
    const db = await createMemoryDb();
    // A populated dataset whose last successful run is older than the TTL.
    await queryRun(db, "INSERT INTO countries (id, name, is_aggregate, updated_at) VALUES ('IND','India',0,?)",
      [new Date().toISOString()]);
    await queryRun(db, "INSERT INTO indicators (id, code, metric_key, name, unit, source, updated_at) VALUES (1,'NY.GDP.PCAP.CD','nominal_current','GDP per capita','current US$','WDI',?)",
      [new Date().toISOString()]);
    await queryRun(db, "INSERT INTO observations (country_id, indicator_id, year, value, value_raw, wb_last_updated, fetched_at) VALUES ('IND',1,2024,1000,'1000','2026-07-13',?)",
      [new Date().toISOString()]);
    await queryRun(db, 'INSERT INTO fetch_runs (started_at, completed_at, status, trigger) VALUES (?,?,?,?)',
      [new Date(Date.now() - 72 * 3600 * 1000).toISOString(), new Date(Date.now() - 72 * 3600 * 1000).toISOString(), 'success', 'ttl']);
    const decision = await maybeAutoRefresh(db, { onWarn: () => {} });
    console.log(JSON.stringify({ decision, retry: getRefreshRetryState() }));
    process.exit(0);
  `);
  const line = output.trim().split('\n').pop();
  const parsed = JSON.parse(line);
  assert.equal(parsed.decision.triggered, true, 'the boot stale-check re-arms the refresh');
  assert.equal(parsed.decision.reason, 'stale', 'the reason is a stale cache');
});

test('the post-failure cooldown prevents a hot loop, and a manual refresh is never delayed', async () => {
  const ingest = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    ingest.cancelScheduledRefreshRetry();
    // Let any background attempt from an earlier test settle, so the
    // single-flight guards are not what answers here.
    const idleStart = Date.now();
    while (ingest.isRefreshInProgress() && Date.now() - idleStart < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    stub.reset();
    // Record a FAILED run: the cooldown gate must now block an automatic
    // attempt (the scheduled ladder uses ignoreCooldown, so it is not blocked).
    const runId = await repository.startFetchRun(db, { trigger: 'ttl' });
    await repository.finishFetchRun(db, runId, { status: 'failed', errorMessage: 'source down' });

    const decision = await ingest.maybeAutoRefresh(db, { onWarn: () => {} });
    assert.equal(decision.triggered, false, 'the automatic attempt is held back by the cooldown');
    assert.equal(decision.reason, 'cooldown-after-failure', 'the reason names the cooldown');

    // A manual refresh is never delayed by the cooldown.
    stub.reset();
    const manual = await ingest.refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'manual' });
    assert.equal(manual.status, 'success', 'a manual refresh runs immediately');
  } finally {
    ingest.cancelScheduledRefreshRetry();
    stub.reset();
    db.close();
  }
});
