/**
 * CLI: ingest World Bank data into the configured database.
 *
 * Usage:
 *   node src/scripts/ingest.js [--start 1960] [--end 2026] [--force]
 *
 * Without explicit years the historical ingest range applies
 * (INGEST_START_YEAR..INGEST_END_YEAR, defaults 1960..current year).
 *
 * Without --force the script still refreshes (it is an explicit command), but
 * it reports clearly what it is about to do.
 *
 * Safety: when the resolved backend is Turso Cloud, the ingest refuses to
 * run unless --force is passed, so local testing cannot accidentally rewrite
 * production data. Use DB_MODE=local for ordinary development.
 *
 * Phase 8E concurrency rule: STOP the local backend server before running
 * this direct CLI against the same local SQLite file. While a server is
 * running, prefer the HTTP mode instead (same refreshData semantics, owned
 * by the running server, progress visible on the Status page):
 *   npm run refresh:http
 * A concurrent direct CLI is safely serialized-or-rejected via the database
 * refresh lock (never silent corruption), but the HTTP mode is the supported
 * second-terminal workflow.
 */

import config, { METRICS, PRODUCTION_METRIC_KEYS } from '../config.js';
import { closeDb, describeDbTarget, getDb, initDatabase, pingDatabase } from '../db/index.js';
import { countObservations, getYearRange } from '../db/repository.js';
import { refreshData } from '../wb/ingest.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = { start: config.ingestStartYear, end: config.ingestEndYear, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--start') args.start = Number.parseInt(argv[i + 1], 10);
    if (token === '--end') args.end = Number.parseInt(argv[i + 1], 10);
    if (token === '--force') args.force = true;
  }
  return args;
}

/**
 * Destructive-target guard (Phase 6C-1): a CLI ingest aimed at the Turso
 * Cloud database refuses to run without explicit `--force`, so ordinary
 * local testing can never accidentally rewrite production data. Local
 * SQLite targets always proceed. Pure predicate for direct unit testing.
 */
export function shouldProceed(target, args) {
  if (target?.mode === 'turso' && args?.force !== true) return false;
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('World Bank WDI ingestion');
  console.log(`  API base        : ${config.worldBank.baseUrl}`);
  console.log(`  Requested range : ${args.start} to ${args.end}`);
  console.log(`  Fetched range   : ${args.start - 1} to ${args.end} (one extra year for YoY)`);
  console.log(`  Database        : ${config.databaseFile}`);
  console.log('  Indicators      :');
  for (const key of PRODUCTION_METRIC_KEYS) {
    const metric = METRICS[key];
    console.log(`    ${metric.subject.padEnd(16)} ${key.padEnd(22)} ${metric.indicatorCode}  (${metric.unit})`);
  }
  console.log('');

  const db = getDb();
  const target = describeDbTarget();
  console.log(
    `  Database backend: ${target.mode}` +
      (target.mode === 'turso' ? ` (${target.host ?? 'unknown host'})` : ` (${target.file})`),
  );
  if (!shouldProceed(target, args)) {
    console.error('');
    console.error('  REFUSED: this ingest targets the Turso Cloud database.');
    console.error('  Re-run with --force to confirm a production write, or set DB_MODE=local.');
    closeDb();
    process.exitCode = 2;
    return;
  }
  await initDatabase(db, { localFile: target.mode === 'local' });
  await pingDatabase(db);
  const before = await countObservations(db);

  const summary = await refreshData({
    startYear: args.start,
    endYear: args.end,
    trigger: 'script',
    db,
    onWarn: (w) => console.warn(`  [warn] ${w.message}`),
  });

  const after = await countObservations(db);
  const range = await getYearRange(db);

  console.log('');
  console.log(`Refresh status        : ${summary.status}`);
  console.log(`World Bank lastupdated: ${summary.wbLastUpdated ?? 'unknown'}`);
  console.log(`Eligible universe     : ${summary.eligibleUniverse} countries/economies`);
  console.log(`Country metadata rows : ${summary.countriesRows}`);
  console.log(`Observation rows read : ${summary.rowsRetrieved}`);
  console.log(`Observation rows saved: ${summary.rowsUpserted}`);
  console.log('');
  console.log('Rows excluded by rule:');
  console.log(`  null values           : ${summary.rowsNullSkipped}`);
  console.log(`  blank ISO3 (aggregates): ${summary.rowsBlankIso3Skipped}`);
  console.log(`  aggregate entities    : ${summary.rowsAggregateExcluded}`);
  console.log(`  unknown country       : ${summary.rowsUnknownCountry}`);
  console.log('');
  console.log(`Observations before   : ${before}`);
  console.log(`Observations after    : ${after}`);
  console.log(`Stored year range     : ${range.minYear} to ${range.maxYear}`);

  closeDb();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error('');
    console.error('Ingestion failed:');
    console.error(`  ${error.message}`);
    if (error.details) console.error(`  details: ${JSON.stringify(error.details)}`);
    if (error?.code === 'REFRESH_IN_PROGRESS') {
      console.error('  Another refresh holds the lock (likely the running server).');
      console.error('  While the server runs, use the HTTP mode instead: npm run refresh:http');
    }
    closeDb();
    process.exitCode = 1;
  });
}