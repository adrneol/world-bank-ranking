/**
 * CLI: ingest World Bank data into the local SQLite cache.
 *
 * Usage:
 *   node src/scripts/ingest.js [--start 2000] [--end 2025] [--force]
 *
 * Without --force the script still refreshes (it is an explicit command), but
 * it reports clearly what it is about to do.
 */

import config, { ALL_METRIC_KEYS, METRICS } from '../config.js';
import { closeDb, getDb } from '../db/index.js';
import { countObservations, getYearRange } from '../db/repository.js';
import { refreshData } from '../wb/ingest.js';

function parseArgs(argv) {
  const args = { start: config.defaultStartYear, end: config.defaultEndYear };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--start') args.start = Number.parseInt(argv[i + 1], 10);
    if (token === '--end') args.end = Number.parseInt(argv[i + 1], 10);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('World Bank WDI ingestion');
  console.log(`  API base        : ${config.worldBank.baseUrl}`);
  console.log(`  Requested range : ${args.start} to ${args.end}`);
  console.log(`  Fetched range   : ${args.start - 1} to ${args.end} (one extra year for YoY)`);
  console.log(`  Database        : ${config.databaseFile}`);
  console.log('  Indicators      :');
  for (const key of ALL_METRIC_KEYS) {
    const metric = METRICS[key];
    console.log(`    ${metric.subject.padEnd(16)} ${key.padEnd(22)} ${metric.indicatorCode}  (${metric.unit})`);
  }
  console.log('');

  const db = getDb();
  const before = countObservations(db);

  const summary = await refreshData({
    startYear: args.start,
    endYear: args.end,
    trigger: 'script',
    db,
    onWarn: (w) => console.warn(`  [warn] ${w.message}`),
  });

  const after = countObservations(db);
  const range = getYearRange(db);

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

main().catch((error) => {
  console.error('');
  console.error('Ingestion failed:');
  console.error(`  ${error.message}`);
  if (error.details) console.error(`  details: ${JSON.stringify(error.details)}`);
  closeDb();
  process.exitCode = 1;
});