/**
 * CLI: live audit against the current World Bank API (spec sections 26, 39).
 *
 * Recalculates, for the acceptance years and ALL FOUR indicators:
 *   India raw value, India rank, denominator, eligible universe,
 *   valid observation count, neighboring countries, World Bank lastupdated.
 *
 * Usage:
 *   node src/scripts/liveAudit.js [--years 2004,2014,2020,2021,2024,2025] [--neighbors 5]
 *
 * This command NEVER hardcodes ranks into production: the EXPECTED table below
 * is an audit comparison only (current-price series from the reconnaissance
 * snapshot). Constant-series ranks have no hardcoded expectation; they are
 * reported independently. If live data differ, the script reports both and
 * exits 0 — it never alters the ranking algorithm to reproduce old values.
 */

import config, { ALL_METRIC_KEYS, FOCUS_COUNTRY, METRICS } from '../config.js';
import {
  buildUniverse,
  classifyObservation,
  createUniverseIndex,
} from '../domain/universe.js';
import { neighborWindow, rankByValue } from '../domain/ranking.js';
import { fetchCountryMetadata, fetchIndicatorSeries } from '../wb/client.js';

const ACCEPTANCE_YEARS = [2004, 2014, 2020, 2021, 2024, 2025];

// Audit expectations for the current-price series only, at lastupdated
// 2026-07-13. Comparison only — never an input to ranking.
const EXPECTED_CURRENT = Object.freeze({
  nominal_current: Object.freeze({
    2004: { rank: 171, total: 209 },
    2014: { rank: 172, total: 213 },
    2020: { rank: 169, total: 210 },
    2021: { rank: 167, total: 210 },
    2024: { rank: 155, total: 200 },
    2025: { rank: 144, total: 186 },
  }),
  ppp_current: Object.freeze({
    2004: { rank: 148, total: 195 },
    2014: { rank: 146, total: 199 },
    2020: { rank: 140, total: 199 },
    2021: { rank: 138, total: 199 },
    2024: { rank: 133, total: 195 },
    2025: { rank: 124, total: 185 },
  }),
});

function parseArgs(argv) {
  const args = { years: [...ACCEPTANCE_YEARS], neighbors: config.neighborsDefault };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--years' && argv[i + 1]) {
      args.years = argv[i + 1]
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    }
    if (token === '--neighbors' && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n)) args.neighbors = Math.max(0, Math.min(50, n));
    }
  }
  if (args.years.length === 0) args.years = [...ACCEPTANCE_YEARS];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const minYear = Math.min(...args.years);
  const maxYear = Math.max(...args.years);

  console.log('World Bank live audit — India GDP per capita ranking');
  console.log(`  API base : ${config.worldBank.baseUrl}`);
  console.log(`  Years    : ${args.years.join(', ')}`);
  console.log(`  Metrics  : ${ALL_METRIC_KEYS.map((k) => METRICS[k].indicatorCode).join(', ')}`);
  console.log('');

  const metadata = await fetchCountryMetadata({});
  const universe = buildUniverse(metadata.rows);
  const index = createUniverseIndex(universe);
  console.log(`  Metadata rows      : ${universe.totalCount}`);
  console.log(`  Eligible universe  : ${universe.eligibleCount}`);
  console.log(`  Aggregate entities : ${universe.aggregateCount}`);
  console.log(`  Metadata lastupdated: ${metadata.lastUpdated ?? 'unknown'}`);
  console.log('');

  if (universe.eligibleCount === 0) {
    throw new Error('Empty eligible universe; refusing to audit.');
  }

  // Fetch each indicator once for the full span (fewer requests, same rows).
  const seriesByMetric = {};
  for (const metricKey of ALL_METRIC_KEYS) {
    const metric = METRICS[metricKey];
    const series = await fetchIndicatorSeries(metric.indicatorCode, minYear, maxYear, {});
    seriesByMetric[metricKey] = series;
    console.log(
      `  ${metricKey.padEnd(18)} ${metric.indicatorCode.padEnd(20)} rows=${String(series.rows.length).padStart(6)} lastupdated=${series.lastUpdated} completeness=${series.completeness.status}`,
    );
  }
  console.log('');

  const results = [];
  let mismatches = 0;

  for (const metricKey of ALL_METRIC_KEYS) {
    const metric = METRICS[metricKey];
    const series = seriesByMetric[metricKey];
    const rowsByYear = new Map();
    for (const raw of series.rows) {
      const year = Number.parseInt(raw?.date, 10);
      if (!args.years.includes(year)) continue;
      const rawValue =
        raw?.value === null || raw?.value === undefined ? null : Number(raw.value);
      const verdict = classifyObservation(
        { iso3: raw?.countryiso3code, value: rawValue, year },
        index.eligibleIso3Set,
        { aggregateIso3Set: index.aggregateIso3Set },
      );
      if (!verdict.eligible) continue;
      if (!rowsByYear.has(year)) rowsByYear.set(year, []);
      const name = raw?.country?.value ?? verdict.iso3;
      rowsByYear.get(year).push({ iso3: verdict.iso3, name, value: verdict.value });
    }

    for (const year of args.years) {
      const rows = rowsByYear.get(year) ?? [];
      const { ranked, total } = rankByValue(rows);
      const focusIndex = ranked.findIndex((r) => r.iso3 === FOCUS_COUNTRY.iso3);
      const focus = focusIndex >= 0 ? ranked[focusIndex] : null;
      const window = focus ? neighborWindow(ranked, focus.rank, args.neighbors) : null;

      const expected = EXPECTED_CURRENT[metricKey]?.[year] ?? null;
      const match =
        expected === null
          ? null
          : focus !== null && focus.rank === expected.rank && total === expected.total;
      if (match === false) mismatches += 1;

      const entry = {
        metricKey,
        indicatorCode: metric.indicatorCode,
        unit: metric.unitLong ?? metric.unit,
        year,
        eligibleUniverse: universe.eligibleCount,
        validObservations: total,
        missingObservations: Math.max(0, universe.eligibleCount - total),
        indiaAvailable: Boolean(focus),
        indiaValue: focus ? focus.value : null,
        indiaRank: focus ? focus.rank : null,
        total,
        neighbors: window
          ? { start: window.start, end: window.end, rows: window.rows }
          : null,
        wbLastUpdated: series.lastUpdated,
        expected,
        match,
      };
      results.push(entry);

      const status = match === null ? '(no hardcoded expectation)' : match ? 'MATCH' : 'DIFF';
      console.log(
        `  ${String(year)} ${metricKey.padEnd(18)} IND ${focus ? `${focus.rank}/${total} value=${focus.value}` : 'missing'}  ${status}`,
      );
    }
  }

  console.log('');
  if (mismatches > 0) {
    console.log(
      `Audit complete with ${mismatches} difference(s) vs the current-price expectations. ` +
        'This does NOT mean the algorithm is wrong: World Bank data can be revised. ' +
        'Compare lastupdated/retrieval metadata before concluding.',
    );
  } else {
    console.log('Audit complete: all hardcoded current-price expectations match the live API at this vintage.');
  }
  console.log('Full JSON follows on stdout (pipe to a file to archive this vintage).');
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    apiBaseUrl: config.worldBank.baseUrl,
    years: args.years,
    eligibleUniverse: universe.eligibleCount,
    aggregateCount: universe.aggregateCount,
    metadataLastUpdated: metadata.lastUpdated,
    results,
    mismatches,
    note: 'Ranks calculated from World Bank WDI observations. The World Bank does not publish these ranks.',
  }, null, 2));
}

main().catch((error) => {
  console.error('');
  console.error('Live audit failed:');
  console.error(`  ${error.message}`);
  if (error.details) console.error(`  details: ${JSON.stringify(error.details)}`);
  process.exitCode = 1;
});
