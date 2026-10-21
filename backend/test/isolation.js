/**
 * TEST DATABASE ISOLATION (bootstrap).
 *
 * The repository's development cache — `backend/data/worldbank.db` — is a
 * PROJECT ARTIFACT. A test run must never open it, and above all must never
 * WRITE to it: a boot-time or TTL refresh issued by the application under test
 * would republish live World Bank data into the developer's working database
 * (this happened once: a stray 'ttl' run rewrote 230,115 rows and the file
 * had to be restored by hand).
 *
 * This module is the single place that makes that impossible:
 *
 *   1. It REDIRECTS the configured database to a DISPOSABLE per-process copy
 *      of the development cache, so tests keep seeing realistic, populated
 *      data (the API read tests need it) while every write lands in a
 *      throw-away file that is removed when the process exits.
 *   2. It DISABLES the remote backend: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
 *      are removed and DB_MODE is forced to 'local', so a routine local test
 *      process can never reach production Turso (and the existing '8P harness'
 *      safety test in divergentRecovery.test.js keeps asserting exactly that).
 *   3. The copy lives OUTSIDE os.tmpdir() on purpose: the repository's own
 *      harness-safety test requires the configured "real local file" to be a
 *      distinct, non-temporary path.
 *
 * It is wired into the suite twice, and the redundancy is deliberate:
 *   - `backend/package.json` runs the suite with `--import ./test/isolation.js`
 *     so the isolation is in place BEFORE any `src/` module (and therefore
 *     `src/config.js`, which freezes DATABASE_FILE at import time) is loaded;
 *   - the test files that touch the configured database import this module
 *     directly, so a single file run (`node --test test/x.test.js`) is
 *     isolated as well.
 *
 * A module is evaluated once per process and both entry points resolve to the
 * same file URL, so the work happens exactly once per test process.
 *
 * Opt-outs (deliberate, explicit):
 *   WB_TEST_ALLOW_TURSO=1   keeps the Turso credentials and DB_MODE.
 *   DATABASE_FILE=<path>    is honoured when it already points somewhere else
 *                           (an explicit choice by the caller).
 *
 * The companion guard lives in `src/db/index.js`: even if this bootstrap never
 * ran, a test process that resolves the protected file fails LOUDLY instead of
 * opening it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** backend/ (the package root of this workspace). */
const BACKEND_ROOT = path.resolve(__dirname, '..');

/** The PROJECT ARTIFACT that must never be opened by a test process. */
export const PROTECTED_DATABASE = path.join(BACKEND_ROOT, 'data', 'worldbank.db');
/** Disposable per-process copies live here (git-ignored: backend/data/ is). */
export const ISOLATED_ROOT = path.join(BACKEND_ROOT, 'data', '.test-isolated');

/** True when this process is a test process (node --test child or NODE_ENV=test). */
export function isTestProcess() {
  return process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test';
}

/** Path comparison that is case-insensitive on Windows. */
export function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

/** Copy a file when it exists; missing sidecars are simply absent. */
function copyIfPresent(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, target);
  return true;
}

/** True when a process with this id is currently running. */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not ours; anything else means it
    // is gone.
    return error?.code === 'EPERM';
  }
}

/**
 * Remove disposable copies left behind by finished processes.
 *
 * A copy cannot be deleted while its owner holds the SQLite file open
 * (Windows file locking), so the exit-time delete usually fails and the
 * copy is collected by the NEXT run instead. A copy whose owning process is
 * gone is garbage; a 60-second grace period protects a process that has
 * just started, and anything older than six hours is collected regardless.
 */
export function sweepStaleIsolatedRuns() {
  try {
    if (!fs.existsSync(ISOLATED_ROOT)) return;
    const now = Date.now();
    const cutoff = now - 6 * 60 * 60 * 1000;
    const grace = now - 60 * 1000;
    for (const entry of fs.readdirSync(ISOLATED_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue;
      const full = path.join(ISOLATED_ROOT, entry.name);
      try {
        const stat = fs.statSync(full);
        const pid = Number(entry.name.slice('run-'.length));
        const old = stat.mtimeMs < cutoff;
        const orphaned = stat.mtimeMs < grace && !processAlive(pid);
        if (old || orphaned) fs.rmSync(full, { recursive: true, force: true });
      } catch {
        // Best effort: another process may own it.
      }
    }
  } catch {
    // Best effort only.
  }
}

/**
 * Point DATABASE_FILE at a disposable copy of the development cache and
 * disable the remote backend. Returns a description of what was done (used
 * by the isolation test); a no-op outside a test process.
 */
export function isolateTestDatabase() {
  if (!isTestProcess()) return { applied: false, reason: 'not-a-test-process' };

  const notes = { applied: true, reason: 'test-process', copied: false, directory: null };

  // 1. The remote backend must be unreachable from a routine test process.
  //    The variables are EMPTIED rather than deleted: `src/config.js` loads
  //    backend/.env with process.loadEnvFile(), and an ABSENT variable would
  //    simply be re-supplied from that file. An empty value is "already
  //    defined" and therefore wins.
  if (process.env.WB_TEST_ALLOW_TURSO !== '1') {
    process.env.TURSO_DATABASE_URL = '';
    process.env.TURSO_AUTH_TOKEN = '';
    process.env.DB_MODE = 'local';
  }

  // 2. The configured database must not be the protected project artifact.
  const configured = process.env.DATABASE_FILE;
  if (configured && !samePath(path.resolve(configured), PROTECTED_DATABASE)) {
    notes.reason = 'explicit-database-file';
    return notes;
  }

  sweepStaleIsolatedRuns();
  const directory = path.join(ISOLATED_ROOT, `run-${process.pid}`);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'worldbank.db');
  // The main file plus its write-ahead log is a consistent pair; the -shm
  // index is transient and is rebuilt by SQLite on first open.
  notes.copied = copyIfPresent(PROTECTED_DATABASE, target);
  copyIfPresent(`${PROTECTED_DATABASE}-wal`, `${target}-wal`);
  process.env.DATABASE_FILE = target;
  notes.directory = directory;

  // Remove the disposable copy when this process ends.
  const cleanup = () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // Best effort: a stale copy is swept by the next run.
    }
  };
  process.on('exit', cleanup);

  return notes;
}

// Applied on import: this module IS the bootstrap.
export const isolation = isolateTestDatabase();

export default isolation;
