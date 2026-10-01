/**
 * DATABASE CONNECTION FACTORY (Phase 6A).
 *
 * One libSQL client serves BOTH backends through the helpers in
 * `./driver.js`, so repository/service code never knows which physical
 * database answers:
 *
 *   Turso Cloud primary  — TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN)
 *   Local SQLite fallback — backend/data/worldbank.db (`file:` URL)
 *
 * Selection: explicit DB_MODE wins ('turso' | 'local'); otherwise Turso is
 * used whenever TURSO_DATABASE_URL is configured. `getDb()` stays
 * synchronous (client construction is lazy — no I/O happens here);
 * `initDatabase()` performs the async schema/pragma setup exactly once per
 * handle. Credentials are never logged; use describeDbTarget() for logs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { queryExec } from './driver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let dbDescriptor = null;

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
 * exists, so an existing database is upgraded in place here: no table, row
 * or value is ever removed. Keys are table names, values map a column to
 * its SQL definition.
 */
const ADDED_COLUMNS = Object.freeze({
  dataset_state: Object.freeze({
    integrity_checks_json: 'TEXT',
  }),
  fetch_runs: Object.freeze({    rows_with_value: 'INTEGER DEFAULT 0',
    rows_non_finite_skipped: 'INTEGER DEFAULT 0',
    rows_invalid_year: 'INTEGER DEFAULT 0',
    pages_fetched: 'INTEGER DEFAULT 0',
    requests: 'INTEGER DEFAULT 0',
    universe_snapshot: 'TEXT',
    rows_aggregate_stored: 'INTEGER DEFAULT 0',
    rows_skipped_unchanged: 'INTEGER DEFAULT 0',
    progress_summary: 'TEXT',
  }),
  ingest_year_stats: Object.freeze({
    rows_aggregate_stored: 'INTEGER NOT NULL DEFAULT 0',
  }),
  observations: Object.freeze({
    value_raw: 'TEXT',
  }),
});

/** Resolved backend: 'turso' or 'local'. Explicit DB_MODE wins. */
export function resolveDbMode() {
  if (config.dbMode === 'turso' || config.dbMode === 'local') return config.dbMode;
  return config.tursoDatabaseUrl !== '' ? 'turso' : 'local';
}

/** Log-safe target description (host only for Turso — never credentials). */
export function describeDbTarget() {
  if (resolveDbMode() === 'turso') {
    let host = '(unparseable)';
    try {
      host = new URL(config.tursoDatabaseUrl).host;
    } catch {
      // Keep the placeholder.
    }
    return { mode: 'turso', host };
  }
  return { mode: 'local', file: config.databaseFile };
}

/** Column names currently present on a table (empty set for a missing table). */
async function existingColumns(handle, table) {
  const rows = await handle.execute(`PRAGMA table_info(${table})`);
  return new Set(rows.rows.map((row) => row.name));
}

/** Add any column the current code expects but the stored table is missing. Returns the set of added "table.column" names. */
async function applyColumnMigrations(handle) {
  const added = new Set();
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const present = await existingColumns(handle, table);
    if (present.size === 0) continue;
    for (const [column, definition] of Object.entries(columns)) {
      if (!present.has(column)) {
        await handle.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
        added.add(`${table}.${column}`);
      }
    }
  }
  return added;
}

/**
 * Apply the schema, then upgrade any pre-existing table in place.
 * Idempotent: every statement uses IF NOT EXISTS / a column presence check.
 * The value_raw backfill runs ONLY when the column was newly added by the
 * migration above (Phase 7B): it is a completed one-time migration, not a
 * startup operation — running it unconditionally rescans the observations
 * table on every process start for zero matching rows.
 */
async function applySchema(handle) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await queryExec(handle, schema);
  const added = await applyColumnMigrations(handle);
  if (added.has('observations.value_raw')) {
    try {
      await handle.execute('UPDATE observations SET value_raw = CAST(value AS TEXT) WHERE value_raw IS NULL;');
    } catch {
      // Table may not exist yet in exotic flows; fresh schema already has values.
    }
  }
}

/**
 * Async one-time setup for a handle: pragmas (local file only — remote
 * databases manage their own journaling) plus the idempotent schema.
 */
export async function initDatabase(handle, { localFile = false } = {}) {
  if (localFile) {
    try {
      await handle.execute('PRAGMA journal_mode = WAL;');
    } catch {
      // Non-fatal: some filesystems do not support WAL.
    }
  }
  try {
    await handle.execute('PRAGMA foreign_keys = ON;');
  } catch {
    // Non-fatal: enforced explicitly by publish logic regardless.
  }
  await applySchema(handle);
}

/**
 * Open (once) and return the shared database handle. Synchronous:
 * construction performs no I/O — call `initDatabase()` before serving.
 */
export function getDb() {
  if (db) return db;
  const mode = resolveDbMode();
  if (mode === 'turso') {
    if (config.tursoDatabaseUrl === '') {
      throw new Error('DB_MODE=turso but TURSO_DATABASE_URL is not set.');
    }
    db = createClient({ url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken || undefined });
    dbDescriptor = { mode: 'turso' };
    return db;
  }
  const file = config.databaseFile;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = createClient({ url: file === ':memory:' ? ':memory:' : `file:${file}` });
  dbDescriptor = { mode: 'local', file };
  return db;
}

/** Which backend the shared handle serves (null before first open). */
export function getDbDescriptor() {
  return dbDescriptor;
}

/** Lightweight reachability check (used at boot for fallback decisions). */
export async function pingDatabase(handle) {
  await handle.execute('SELECT 1;');
}

/** Close the shared handle, if open. */
export function closeDb() {
  if (db) {
    try {
      const result = db.close();
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {
      // Already closed.
    }
    db = null;
    dbDescriptor = null;
  }
}

/**
 * Open the local SQLite file ONLY if it already exists and already holds
 * observations. Returns `{ handle, file }` or null. Never creates, seeds,
 * or fabricates data: missing/empty/unreadable files all resolve to null
 * so callers can distinguish "usable fallback" from "nothing to serve".
 * The idempotent schema upgrade still applies (additive columns only).
 */
export async function openExistingLocalDb() {
  const file = config.databaseFile;
  try {
    if (file === ':memory:') return null;
    if (!fs.existsSync(file)) return null;
    const handle = createClient({ url: `file:${file}` });
    await initDatabase(handle, { localFile: true });
    const count = await handle.execute('SELECT COUNT(*) AS n FROM observations');
    if (!count.rows[0] || Number(count.rows[0].n) === 0) {
      try {
        handle.close();
      } catch {
        // Already closed.
      }
      return null;
    }
    return { handle, file };
  } catch {
    return null;
  }
}

/**
 * Create a brand new isolated scratch database with the schema applied.
 * Used by unit tests so they never touch the real cache file.
 *
 * Backed by a temp FILE (deleted on close), not `:memory:`: the in-memory
 * libSQL client holds a single connection, so any read on the shared handle
 * while a write transaction is open throws TRANSACTION_ACTIVE. Temp files
 * (like Turso remote) serve pre-commit snapshots to concurrent readers, so
 * tests exercise the same read-during-refresh semantics as production.
 */
export async function createMemoryDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
  const file = path.join(dir, 'test.db');
  const handle = createClient({ url: `file:${file.replace(/\\/g, '/')}` });
  await initDatabase(handle, { localFile: true });
  const origClose = handle.close.bind(handle);
  handle.close = () => {
    try {
      origClose();
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort temp cleanup; OS reclaims tmp eventually.
      }
    }
  };
  return handle;
}

export { SCHEMA_PATH };
export default getDb;
