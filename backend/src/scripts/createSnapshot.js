/**
 * CLI: write a VERSIONED World Bank fixture snapshot.
 *
 *   node src/scripts/createSnapshot.js [--start 2024] [--end 2025] [--out test/fixtures/wb-snapshot.json]
 *
 * Why this exists (specification section 25):
 *   Normal automated tests must NEVER depend on the live World Bank API. This
 *   command captures a deliberate, reviewable snapshot that the test suite reads
 *   instead, so tests stay deterministic while still running against real WDI
 *   rows. The snapshot records its provenance: the World Bank `lastupdated` of
 *   every payload, the retrieval timestamp, the exact indicator codes, the year
 *   range, and the pagination completeness verdict of every fetch.
 *
 * Historical ranks are deliberately NOT stored: production code must never
 * hardcode them, and the acceptance numbers are recalculated by liveAudit.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { METRIC_KEYS, METRICS } from '../config.js';
import { buildUniverse } from '../domain/universe.js';
import {
  fetchCountryMetadata,
  fetchIndicatorMetadata,
  fetchIndicatorSeries,
} from '../wb/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(__dirname, '..', '..', 'test', 'fixtures', 'wb-snapshot.json');

function parseArgs(argv) {
  const args = {
    start: Number.parseInt(process.env.SNAPSHOT_START_YEAR ?? '2024', 10),
    end: Number.parseInt(process.env.SNAPSHOT_END_YEAR ?? '2025', 10),
    out: process.env.SNAPSHOT_OUT ?? DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--start') args.start = Number.parseInt(argv[i + 1], 10);
    if (token === '--end') args.end = Number.parseInt(argv[i + 1], 10);
    if (token === '--out') args.out = argv[i + 1];
  }
  if (!Number.isFinite(args.start) || !Number.isFinite(args.end) || args.start > args.end) {
    throw new Error(`Invalid year range: ${args.start}..${args.end}`);
  }
  return args;
}

/** Keep only the country-metadata fields this application reads. */
function trimCountryRow(row) {
  return {
    id: row?.id ?? null,
    iso2Code: row?.iso2Code ?? null,
    name: row?.name ?? null,
    region: { id: row?.region?.id ?? null, value: row?.region?.value ?? null },
    adminregion: { id: row?.adminregion?.id ?? null, value: row?.adminregion?.value ?? null },
    incomeLevel: { id: row?.incomeLevel?.id ?? null, value: row?.incomeLevel?.value ?? null },
    lendingType: { id: row?.lendingType?.id ?? null, value: row?.lendingType?.value ?? null },
    capitalCity: row?.capitalCity ?? null,
  };
}

/** Keep only the observation fields this application reads. */
function trimObservationRow(row) {
  return {
    indicator: { id: row?.indicator?.id ?? null, value: row?.indicator?.value ?? null },
    country: { id: row?.country?.id ?? null, value: row?.country?.value ?? null },
    countryiso3code: row?.countryiso3code ?? '',
    date: row?.date ?? null,
    value: row?.value ?? null,
    unit: row?.unit ?? '',
    obs_status: row?.obs_status ?? '',
    decimal: row?.decimal ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('World Bank fixture snapshot');
  console.log(`  API base    : ${config.worldBank.baseUrl}`);
  console.log(`  Year range  : ${args.start} to ${args.end}`);
  console.log(`  Output      : ${args.out}`);
  console.log('');

  const metadata = await fetchCountryMetadata({});
  const universe = buildUniverse(metadata.rows);

  const indicators = {};
  const lastUpdated = { countryMetadata: metadata.lastUpdated };

  for (const metricKey of METRIC_KEYS) {
    const metric = METRICS[metricKey];
    let indicatorMetadata = null;
    try {
      indicatorMetadata = await fetchIndicatorMetadata(metric.indicatorCode);
    } catch (error) {
      console.warn(`  [warn] indicator metadata unavailable for ${metric.indicatorCode}: ${error.message}`);
    }

    const series = await fetchIndicatorSeries(metric.indicatorCode, args.start, args.end, {});
    lastUpdated[metricKey] = series.lastUpdated;

    indicators[metricKey] = {
      key: metricKey,
      indicatorCode: metric.indicatorCode,
      label: metric.label,
      unit: metric.unit,
      unitLong: metric.unitLong,
      worldBankPage: metric.worldBankPage,
      indicatorMetadata: indicatorMetadata
        ? {
            id: indicatorMetadata.id ?? null,
            name: indicatorMetadata.name ?? null,
            unit: indicatorMetadata.unit ?? '',
            source: indicatorMetadata.source?.value ?? null,
            sourceNote: indicatorMetadata.sourceNote ?? null,
          }
        : null,
      lastUpdated: series.lastUpdated,
      declaredTotal: series.declaredTotal,
      completeness: series.completeness,
      pagesFetched: series.pagesFetched,
      requests: series.requests,
      rowCount: series.rows.length,
      rows: series.rows.map(trimObservationRow),
    };

    console.log(
      `  ${metricKey.padEnd(18)} ${metric.indicatorCode.padEnd(20)} rows=${String(series.rows.length).padStart(5)} lastupdated=${series.lastUpdated} completeness=${series.completeness.status}`,
    );
  }

  const snapshot = {
    snapshotVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'src/scripts/createSnapshot.js',
    apiBaseUrl: config.worldBank.baseUrl,
    yearRange: { startYear: args.start, endYear: args.end },
    indicatorCodes: METRIC_KEYS.map((key) => METRICS[key].indicatorCode),
    metricKeys: [...METRIC_KEYS],
    worldBankLastUpdated: lastUpdated,
    counts: {
      countryMetadataRows: metadata.rows.length,
      eligibleUniverse: universe.eligibleCount,
      aggregateUniverse: universe.aggregateCount,
      observations: Object.values(indicators).reduce((sum, entry) => sum + entry.rowCount, 0),
    },
    countryMetadata: {
      lastUpdated: metadata.lastUpdated,
      declaredTotal: metadata.declaredTotal,
      completeness: metadata.completeness,
      rows: metadata.rows.map(trimCountryRow),
    },
    indicators,
    note:
      'Versioned test fixture captured from the official World Bank WDI API. No historical rank is stored: every rank is recalculated by the application.',
  };

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(snapshot)}\n`, 'utf8');

  const stats = fs.statSync(path.resolve(args.out));
  console.log('');
  console.log(`  Country rows       : ${metadata.rows.length} (eligible ${universe.eligibleCount}, aggregates ${universe.aggregateCount})`);
  console.log(`  Observation rows   : ${snapshot.counts.observations}`);
  console.log(`  Written            : ${path.resolve(args.out)} (${(stats.size / 1024).toFixed(1)} KiB)`);
}

main().catch((error) => {
  console.error('');
  console.error('Snapshot creation failed:');
  console.error(`  ${error.message}`);
  if (error.details) console.error(`  details: ${JSON.stringify(error.details)}`);
  process.exitCode = 1;
});
