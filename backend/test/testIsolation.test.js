import './isolation.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROTECTED_DATABASE, isolation, isTestProcess } from './isolation.js';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));

function protectedFingerprint() {
  const stat = fs.statSync(PROTECTED_DATABASE, { throwIfNoEntry: false });
  return stat ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
}

test('bootstrap uses a fresh per-process file and does not need the development cache', async () => {
  assert.equal(isTestProcess(), true);
  assert.equal(isolation.applied, true);
  const { default: config } = await import('../src/config.js');
  assert.equal(config.databaseFile, isolation.databaseFile);
  assert.notEqual(config.databaseFile, PROTECTED_DATABASE);
  assert.equal(fs.existsSync(config.databaseFile), false, 'the bootstrap copied no database');

  const before = protectedFingerprint();
  const { seedConfiguredDatabase } = await import('./helpers/configuredDb.js');
  const { closeDb } = await import('../src/db/index.js');
  try {
    const db = await seedConfiguredDatabase();
    const { rows } = await db.execute('SELECT COUNT(*) AS n FROM observations');
    assert.ok(Number(rows[0].n) > 0, 'the configured database holds tracked fixture observations');
  } finally {
    closeDb();
  }
  assert.deepEqual(protectedFingerprint(), before);
});

test('bootstrap ignores ambient database configuration and never loads dotenv', () => {
  const fixture = path.join(isolation.directory, 'ambient.db');
  const script = `
    const assert = (await import('node:assert/strict')).default;
    const fs = (await import('node:fs')).default;
    process.loadEnvFile = () => { throw new Error('Do not load dotenv'); };
    let attempted = false;
    const rejectEnvRead = process.loadEnvFile;
    process.loadEnvFile = () => { attempted = true; rejectEnvRead(); };
    const { isolation } = await import('./test/isolation.js');
    const { default: config } = await import('./src/config.js');
    assert.equal(attempted, false);
    assert.equal(config.databaseFile, isolation.databaseFile);
    assert.notEqual(config.databaseFile, process.argv[1]);
    assert.equal(fs.existsSync(process.argv[1]), false);
    assert.equal(config.tursoDatabaseUrl, '');
    assert.equal(config.tursoAuthToken, '');
    assert.equal(config.dbMode, 'local');
    assert.equal(config.worldBank.baseUrl, 'http://127.0.0.1:9/v2');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, fixture], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_FILE: fixture,
      DB_MODE: 'turso',
      TURSO_DATABASE_URL: 'libsql://unused.example.invalid',
      TURSO_AUTH_TOKEN: 'unused-fixture-token',
      WB_TEST_ALLOW_TURSO: '1',
    },
  });
});

test('the database factory refuses the protected path even without the preload', () => {
  const before = protectedFingerprint();
  const script = `
    const assert = (await import('node:assert/strict')).default;
    const { getDb } = await import('./src/db/index.js');
    assert.throws(getDb, /Refusing to open the protected development database/);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_FILE: PROTECTED_DATABASE },
  });
  assert.deepEqual(protectedFingerprint(), before);
});

test('file-backed fixtures and fallback support paths with spaces, # and %', async () => {
  const script = `
    const assert = (await import('node:assert/strict')).default;
    const { getDb, closeDb, initDatabase, openExistingLocalDb } = await import('./src/db/index.js');
    const db = getDb();
    await initDatabase(db, { localFile: true });
    const fallback = await openExistingLocalDb();
    assert.equal(fallback, null, 'empty fallback is ineligible');
    const { seedConfiguredDatabase } = await import('./test/helpers/configuredDb.js');
    await seedConfiguredDatabase();
    closeDb();
    const opened = await openExistingLocalDb();
    assert.ok(opened, 'populated fixture is eligible at the encoded path');
    try {
      const { rows } = await opened.handle.execute('SELECT COUNT(*) AS n FROM observations');
      assert.ok(Number(rows[0].n) > 0);
    } finally {
      opened.handle.close();
    }
  `;
  const temp = fs.mkdtempSync(path.join(isolation.directory, 'encoded # 100%-'));
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backendRoot,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_FILE: path.join(temp, 'test #%.db') },
    });
  } finally {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      fs.rmSync(path.join(temp, 'test #%.db') + suffix, { force: true });
    }
    fs.rmdirSync(temp);
  }
});
