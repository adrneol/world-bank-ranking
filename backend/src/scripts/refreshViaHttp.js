/**
 * HTTP refresh client (Phase 8E — preferred local workflow while the backend
 * server is already running).
 *
 * Usage:
 *   npm run refresh:http
 *   node src/scripts/refreshViaHttp.js [--url http://localhost:3001] [--start 1960] [--end 2026]
 *
 * Why HTTP while the server runs: exactly one process (the running server)
 * owns the local SQLite refresh transaction. A second process opening the
 * same SQLite file for a direct CLI refresh would contend on the database
 * lock; the HTTP endpoint serializes on the server's refresh lock (409 when
 * busy) and streams progress through GET /api/data-status, so the Status
 * page stays connected and the server never collapses.
 *
 * Auth: sends `Authorization: Bearer <token>` when REFRESH_ADMIN_TOKEN is
 * set (read from process.env or from backend/.env as a fallback). When the
 * backend has no token configured the endpoint is open (local dev only).
 * The token is never logged.
 *
 * Exit codes: 0 success (including partial — details printed), 1 failure or
 * server unreachable, 2 refresh already in progress (no duplicate started).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { url: 'http://localhost:3001', start: undefined, end: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--url') args.url = String(argv[i + 1] ?? args.url).replace(/\/+$/, '');
    if (token === '--start') args.start = Number.parseInt(argv[i + 1], 10);
    if (token === '--end') args.end = Number.parseInt(argv[i + 1], 10);
  }
  return args;
}

function readTokenFromDotEnv() {
  try {
    const text = fs.readFileSync(path.join(BACKEND_ROOT, '.env'), 'utf8');
    const match = /^REFRESH_ADMIN_TOKEN=(.*)$/m.exec(text);
    if (!match) return '';
    return String(match[1] ?? '').trim();
  } catch {
    return '';
  }
}

function resolveToken() {
  const fromEnv = String(process.env.REFRESH_ADMIN_TOKEN ?? '').trim();
  if (fromEnv !== '') return fromEnv;
  return readTokenFromDotEnv();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  const body = {};
  if (Number.isFinite(args.start)) body.startYear = args.start;
  if (Number.isFinite(args.end)) body.endYear = args.end;

  console.log('Refresh via running backend (HTTP)');
  console.log(`  POST ${args.url}/api/data/refresh`);
  console.log(`  Auth: ${token !== '' ? 'Bearer token supplied' : 'open (no token configured)'}`);
  console.log('  This touches ONLY the database owned by that server process.');
  console.log('');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let response;
  try {
    response = await fetch(`${args.url}/api/data/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token !== '' ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    console.error('');
    console.error('  Server unreachable — is the backend running?');
    console.error(`  Start it first: cd backend; npm run dev  (${error.message})`);
    process.exitCode = 1;
    return;
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 409) {
    console.error('  REFUSED: a refresh is already running — no duplicate was started.');
    process.exitCode = 2;
    return;
  }
  if (!response.ok) {
    console.error(`  Refresh request failed: HTTP ${response.status}`);
    if (payload?.error?.message) console.error(`  ${payload.error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  Status   : ${payload?.status ?? 'unknown'}`);
  console.log(`  Run      : #${payload?.runId ?? '?'}`);
  console.log(`  Retrieved: ${payload?.rowsRetrieved ?? '?'}`);
  console.log(`  Upserted : ${payload?.rowsUpserted ?? '?'}`);
  console.log(`  Skipped  : ${payload?.rowsSkippedUnchanged ?? '?'}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`  Refresh via HTTP failed: ${error.message}`);
    process.exitCode = 1;
  });
}
