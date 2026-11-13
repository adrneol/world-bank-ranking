import { isolation } from './isolation.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMemoryDb, openExistingLocalDb } from '../src/db/index.js';
import { acquireRefreshLock, releaseRefreshLock } from '../src/db/repository.js';
import { maybeRecoverPrimary, resetRecoveryConfirmation } from '../src/server.js';

process.env.WB_RECOVERY_CONFIRM_MS = '0';
process.env.WB_RECOVERY_REPROBE_MS = '0';

const vintage = '2026-07-13';
const nextVintage = '2026-08-01';
const india = [1, 'IND', 2024, 100, vintage];
const us = [1, 'USA', 2025, 200, vintage];
const population = [2, 'IND', 2025, 300, vintage];

async function seed(db, rows) {
  await db.executeMultiple(
    "INSERT INTO countries (id,name,updated_at) VALUES ('IND','India','2026-08-01'),('USA','United States','2026-08-01');" +
    "INSERT INTO indicators (id,code,metric_key,unit,source,updated_at) VALUES (1,'NY.GDP.PCAP.CD','nominal_current','current US$','World Development Indicators','2026-08-01');",
  );
  if (rows.some(([id]) => id === 2)) {
    await db.execute("INSERT INTO indicators (id,code,metric_key,unit,source,updated_at) VALUES (2,'SP.POP.TOTL','population_total','people','World Development Indicators','2026-08-01')");
  }
  await db.batch(rows.map(([indicator, country, year, value, release]) => ({
    sql: "INSERT INTO observations (indicator_id,country_id,year,value,value_raw,wb_last_updated,fetched_at) VALUES (?,?,?,?,?,?,'2026-08-02')",
    args: [indicator, country, year, value, String(value), release],
  })));
}

const cases = [
  ['identical data', [india, us], [india, us], true],
  ['complete primary with newer revision and primary-only coverage', [[1,'IND',2024,125,nextVintage], us, population], [india, us], true],
  ['newer fallback revision', [india, us], [[1,'IND',2024,125,nextVintage], us], false],
  ['equal stamps with different values', [[1,'IND',2024,125,vintage], us], [india, us], false],
  ['different year ranges', [us], [india, us], false],
  ['missing indicator', [india, us], [india, us, population], false],
  ['partial same-indicator coverage', [india, us], [india, us, [1,'USA',2024,150,vintage]], false],
  ['non-overlapping coverage', [us], [india], false],
  ['empty primary', [], [india, us], false],
  ['empty fallback cannot certify promotion', [india, us], [], false],
];

for (const [name, primaryRows, fallbackRows, promote] of cases) {
  test(name, async () => {
    const primary = await createMemoryDb();
    const fallback = await createMemoryDb();
    const shared = { current: fallback, isFallback: true, isDegraded: false };
    resetRecoveryConfirmation();
    try {
      await seed(primary, primaryRows);
      await seed(fallback, fallbackRows);
      const before = await fallback.execute('SELECT * FROM observations ORDER BY year');
      const result = await maybeRecoverPrimary(shared, {
        configuredMode: 'turso', reconcile: false, createProbe: async () => primary,
      });
      assert.equal(result.recovered, promote, JSON.stringify(result));
      assert.equal(shared.current, promote ? primary : fallback);
      assert.deepEqual((await fallback.execute('SELECT * FROM observations ORDER BY year')).rows, before.rows);
    } finally {
      primary.close();
      fallback.close();
    }
  });
}

test('fallback opening rejects corrupt files without replacing or initializing them', async () => {
  const bytes = Buffer.alloc(8192, 0x7f);
  fs.writeFileSync(isolation.databaseFile, bytes, { flag: 'wx' });
  assert.equal(await openExistingLocalDb(), null);
  assert.deepEqual(fs.readFileSync(isolation.databaseFile), bytes);
});

test('unavailable and interrupted primary checks preserve the fallback', async () => {
  const primary = await createMemoryDb();
  const fallback = await createMemoryDb();
  const shared = { current: fallback, isFallback: true, isDegraded: false };
  try {
    await seed(primary, [india, us]);
    await seed(fallback, [india, us]);
    const options = { configuredMode: 'turso', reconcile: false };
    const unreachable = await maybeRecoverPrimary(shared, { ...options, createProbe: async () => null });
    assert.equal(unreachable.reason, 'primary-unavailable');
    primary.transaction = async () => { throw new Error('synthetic read interruption'); };
    const interrupted = await maybeRecoverPrimary(shared, { ...options, createProbe: async () => primary });
    assert.equal(interrupted.reason, 'generation-unknown');
    assert.equal(shared.current, fallback);
    assert.equal((await fallback.execute('SELECT COUNT(*) AS n FROM observations')).rows[0].n, 2);
  } finally {
    primary.close();
    fallback.close();
  }
});

test('concurrent recovery shares one proof and refuses a generation that changes mid-check', async () => {
  const primary = await createMemoryDb();
  const fallback = await createMemoryDb();
  const shared = { current: fallback, isFallback: true, isDegraded: false };
  try {
    await seed(primary, [india, us]);
    await seed(fallback, [india, us]);
    let probes = 0;
    let begin;
    let resume;
    const started = new Promise((resolve) => { begin = resolve; });
    const release = new Promise((resolve) => { resume = resolve; });
    const transaction = primary.transaction.bind(primary);
    primary.transaction = async (...args) => {
      begin();
      await release;
      return transaction(...args);
    };
    const options = { configuredMode: 'turso', createProbe: async () => { probes += 1; return primary; } };
    const first = maybeRecoverPrimary(shared, options);
    await started;
    const second = maybeRecoverPrimary(shared, options);
    const manual = await maybeRecoverPrimary(shared, { ...options, reconcile: false });
    assert.equal(manual.reason, 'recovery-in-progress');
    try {
      assert.equal(await acquireRefreshLock(fallback, { holder: 'disposable-fixture' }), true);
    } finally {
      resume();
    }
    const [a, b] = await Promise.all([first, second]);
    assert.equal(probes, 1);
    assert.equal(a, b);
    assert.equal(a.reason, 'generation-changed');
    assert.equal(shared.current, fallback);
    const held = await maybeRecoverPrimary(shared, options);
    assert.equal(held.reason, 'lock-held');
    await releaseRefreshLock(fallback);
  } finally {
    primary.close();
    fallback.close();
  }
});
