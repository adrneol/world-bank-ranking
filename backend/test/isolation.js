/** Test-only bootstrap. The configured path belongs to this process. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
export const PROTECTED_DATABASE = path.join(backendRoot, 'data', 'worldbank.db');

export function isTestProcess() {
  return process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test';
}

function isolateTestDatabase() {
  if (!isTestProcess()) return { applied: false };

  // A runner's ambient database path and remote settings are never test inputs.
  // Individual tests may choose another disposable path before importing config.
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.REFRESH_ADMIN_TOKEN = '';
  process.env.DB_MODE = 'local';
  process.env.WORLD_BANK_API_BASE_URL = 'http://127.0.0.1:9/v2';
  process.env.GEO_PROVIDER_URL = 'http://127.0.0.1:9/{ip}';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wdi-fixture-'));
  const databaseFile = path.join(directory, 'fixture.db');
  process.env.DATABASE_FILE = databaseFile;

  process.on('exit', () => {
    // Remove only the three known files this process can create. A locked
    // native SQLite handle can defer cleanup until the OS reclaims temp files.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { fs.rmSync(databaseFile + suffix, { force: true }); } catch { /* best effort */ }
    }
    try { fs.rmdirSync(directory); } catch { /* best effort */ }
  });

  return { applied: true, directory, databaseFile };
}

export const isolation = isolateTestDatabase();
export default isolation;
