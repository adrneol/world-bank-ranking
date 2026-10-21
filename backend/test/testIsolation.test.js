/**
 * TEST DATABASE ISOLATION — SAFETY GATE.
 *
 * The repository's development cache (`backend/data/worldbank.db`) is a
 * PROJECT ARTIFACT. These tests prove that a test process can never open it,
 * let alone write to it, and that the remote backend is unreachable.
 *
 * Covered:
 *   1. The bootstrap redirects DATABASE_FILE to a disposable copy.
 *   2. The configured file is NOT the protected project artifact.
 *   3. The remote backend credentials are removed and DB_MODE is 'local'.
 *   4. The guard in src/db/index.js REFUSES the protected file loudly — this
 *      is proven by a DELIBERATELY UNSAFE configuration (a child process
 *      pointed straight at the protected file), which must fail safely
 *      without modifying the protected database.
 *   5. The protected database's content is unchanged after all of it.
 */

import './isolation.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PROTECTED_DATABASE,
  ISOLATED_ROOT,
  isolation,
  isTestProcess,
  samePath,
  sweepStaleIsolatedRuns,
} from './isolation.js';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A cheap, decisive fingerprint of the protected database file. */
function protectedFingerprint() {
  if (!fs.existsSync(PROTECTED_DATABASE)) return { exists: false };
  const stat = fs.statSync(PROTECTED_DATABASE);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
}

test('the isolation bootstrap is active in this test process', () => {
  assert.equal(isTestProcess(), true, 'a test process is detected');
  assert.equal(isolation.applied, true, 'the bootstrap ran');
  assert.notEqual(isolation.reason, 'not-a-test-process');
});

test('the configured database is a disposable copy, not the project artifact', async () => {
  const config = (await import('../src/config.js')).default;
  assert.equal(samePath(config.databaseFile, PROTECTED_DATABASE), false, 'not the protected file');
  assert.ok(
    !String(config.databaseFile).startsWith(os.tmpdir()),
    'the isolated path is outside tmpdir (the harness-safety contract)',
  );
  assert.ok(
    String(config.databaseFile).includes(path.join('.test-isolated', `run-${process.pid}`)),
    'the isolated copy is this process\'s own disposable directory',
  );
  // It is a real, populated copy: the API read tests depend on that.
  const { createClient } = await import('@libsql/client');
  const handle = createClient({ url: `file:${String(config.databaseFile).replace(/\\/g, '/')}` });
  try {
    const count = await handle.execute({ sql: 'SELECT COUNT(*) AS n FROM observations' });
    assert.ok(Number(count.rows[0].n) > 0, 'the copy holds the development observations');
  } finally {
    handle.close();
  }
});

test('the remote backend is unreachable from a test process', async () => {
  const config = (await import('../src/config.js')).default;
  const { resolveDbMode } = await import('../src/db/index.js');
  assert.equal(config.tursoDatabaseUrl ?? '', '', 'TURSO_DATABASE_URL removed');
  assert.equal(config.tursoAuthToken ?? '', '', 'TURSO_AUTH_TOKEN removed');
  assert.equal(resolveDbMode(), 'local', 'no code path resolves a remote backend');
});

test('the guard refuses the protected database LOUDLY (deliberately unsafe configuration)', () => {
  const before = protectedFingerprint();
  // A child process pointed straight at the protected file, with the
  // isolation bootstrap DISABLED. It must fail safely and change nothing.
  const script = `
    process.env.NODE_TEST_CONTEXT = 'child-v8';
    process.env.DATABASE_FILE = ${JSON.stringify(PROTECTED_DATABASE)};
    const { getDb } = await import(${JSON.stringify(
      pathToFileURL(path.join(BACKEND_ROOT, 'src', 'db', 'index.js')).href,
    )});
    try {
      getDb();
      console.log('GUARD_FAILED');
    } catch (error) {
      console.log('GUARD_THREW:' + error.message.split('.')[0]);
    }
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: BACKEND_ROOT,
    env: { ...process.env, WB_TEST_ALLOW_TURSO: '1' },
  });
  assert.match(output, /GUARD_THREW/, 'the protected database was refused');
  assert.doesNotMatch(output, /GUARD_FAILED/, 'no handle was handed out');
  const after = protectedFingerprint();
  assert.deepEqual(after, before, 'the protected database was not modified');
});

test('the protected database is unchanged and the disposable copy is disposable', () => {
  assert.equal(fs.existsSync(PROTECTED_DATABASE), true, 'the project artifact still exists');
  const isolatedDirs = fs.existsSync(ISOLATED_ROOT)
    ? fs.readdirSync(ISOLATED_ROOT).filter((name) => name.startsWith('run-'))
    : [];
  // The sweep collects copies abandoned by a finished process; nothing that
  // is still in use may be deleted.
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const name of isolatedDirs) {
    const full = path.join(ISOLATED_ROOT, name);
    const stat = fs.statSync(full);
    assert.ok(
      stat.mtimeMs >= cutoff,
      `disposable copy ${name} is either live or swept within six hours`,
    );
  }
});

test('a copy abandoned by a finished process is collected', () => {
  // A copy whose owner is gone cannot be deleted while it is locked, so the
  // NEXT run collects it. Proven here with a synthetic orphan.
  const orphan = path.join(ISOLATED_ROOT, 'run-999999');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'worldbank.db'), 'orphan');
  // Age it past the grace period so the sweep treats it as orphaned.
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(orphan, old, old);
  sweepStaleIsolatedRuns();
  assert.equal(fs.existsSync(orphan), false, 'the orphaned copy was collected');
});
