/**
 * SQLite connection factory.
 *
 * Uses Node's built-in `node:sqlite` (no native compilation step). All database
 * access in this application goes through this module and `repository.js`, so
 * the storage engine can be replaced without touching domain logic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** @type {DatabaseSync|null} */
let db = null;

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
 * exists, so an existing local cache is upgraded in place here: no table, row or
 * value is ever removed. Keys are table names, values map a column to its SQL
 * definition.
 */
const ADDED_COLUMNS = Object.freeze({
  fetch_runs: Object.freeze({
    rows_with_value: 'INTEGER DEFAULT 0',
    rows_non_finite_skipped: 'INTEGER DEFAULT 0',
    rows_invalid_year: 'INTEGER DEFAULT 0',
    pages_fetched: 'INTEGER DEFAULT 0',
    requests: 'INTEGER DEFAULT 0',
    universe_snapshot: 'TEXT',
  }),
  observations: Object.freeze({
    value_raw: 'TEXT',
  }),
});

/** Column names currently present on a table (empty set for a missing table). */
function existingColumns(handle, table) {
  return new Set(handle.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

/** Add any column the current code expects but the stored table is missing. */
function applyColumnMigrations(handle) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const present = existingColumns(handle, table);
    if (present.size === 0) continue;
    for (const [column, definition] of Object.entries(columns)) {
      if (!present.has(column)) {
        handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      }
    }
  }
}

/**
 * Apply the schema, then upgrade any pre-existing table in place.
 * Idempotent: every statement uses IF NOT EXISTS / a column presence check.
 * Also backfills value_raw for rows written before the column existed.
 */
function applySchema(handle) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  handle.exec(schema);
  applyColumnMigrations(handle);
  try {
    handle.exec('UPDATE observations SET value_raw = CAST(value AS TEXT) WHERE value_raw IS NULL;');
  } catch {
    // Table may not exist yet in exotic flows; fresh schema already has values.
  }
}

/**
 * Open (once) and return the shared database handle.
 *
 * @param {{ file?: string }} [options]
 * @returns {DatabaseSync}
 */
export function getDb(options = {}) {
  const file = options.file ?? config.databaseFile;

  if (db && db.__file !== file) {
    closeDb();
  }
  if (db) return db;

  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const handle = new DatabaseSync(file);
  handle.__file = file;
  // WAL keeps reads fast while an ingest writes; memory DBs ignore it.
  if (file !== ':memory:') {
    try {
      handle.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // Non-fatal: some filesystems do not support WAL.
    }
  }
  handle.exec('PRAGMA foreign_keys = ON;');
  applySchema(handle);

  db = handle;
  return db;
}

/** Close the shared handle, if open. */
export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // Already closed.
    }
    db = null;
  }
}

/**
 * Create a brand new in-memory database with the schema applied.
 * Used by unit tests so they never touch the real cache file.
 *
 * @returns {DatabaseSync}
 */
export function createMemoryDb() {
  const handle = new DatabaseSync(':memory:');
  handle.__file = ':memory:';
  handle.exec('PRAGMA foreign_keys = ON;');
  applySchema(handle);
  return handle;
}

/**
 * Run `fn` inside a transaction. Rolls back on any thrown error.
 *
 * @template T
 * @param {DatabaseSync} handle
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(handle, fn) {
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures; the original error is what matters.
    }
    throw error;
  }
}

export { SCHEMA_PATH };
export default getDb;