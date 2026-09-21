/**
 * Loader for the VERSIONED World Bank fixture snapshot.
 *
 * The test suite reads this file and never calls the live API (specification
 * section 25). The snapshot itself is produced by src/scripts/createSnapshot.js
 * and committed, so a test run is reproducible and does not depend on the network
 * or on World Bank revisions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = path.join(here, 'wb-snapshot.json');

function load() {
  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  if (parsed.snapshotVersion !== 1) {
    throw new Error(`Unsupported fixture snapshot version: ${parsed.snapshotVersion}`);
  }
  return parsed;
}

export const snapshot = load();

/** Provenance of the snapshot: what was retrieved, when, and from where. */
export const provenance = Object.freeze({
  generatedAt: snapshot.generatedAt,
  apiBaseUrl: snapshot.apiBaseUrl,
  yearRange: snapshot.yearRange,
  indicatorCodes: snapshot.indicatorCodes,
  metricKeys: snapshot.metricKeys,
  worldBankLastUpdated: snapshot.worldBankLastUpdated,
  counts: snapshot.counts,
});

/** A World Bank collection envelope: [meta, rows]. */
export function envelope(rows, meta = {}) {
  return [
    {
      page: 1,
      pages: 1,
      per_page: rows.length,
      total: rows.length,
      sourceid: '2',
      lastupdated: null,
      ...meta,
    },
    rows,
  ];
}

export function countryMetadataEnvelope(meta = {}) {
  return envelope(snapshot.countryMetadata.rows, {
    lastupdated: snapshot.countryMetadata.lastUpdated,
    ...meta,
  });
}

export function seriesEnvelope(metricKey, meta = {}) {
  const indicator = snapshot.indicators[metricKey];
  if (!indicator) throw new Error(`Unknown fixture metric: ${metricKey}`);
  return envelope(indicator.rows, { lastupdated: indicator.lastUpdated, ...meta });
}

/** Fixture observation rows for a metric, optionally filtered to one year. */
export function seriesRows(metricKey, year = null) {
  const indicator = snapshot.indicators[metricKey];
  if (!indicator) throw new Error(`Unknown fixture metric: ${metricKey}`);
  if (year === null) return indicator.rows;
  return indicator.rows.filter((row) => Number.parseInt(row.date, 10) === Number(year));
}

/** Indicator metadata row in the World Bank /indicator shape. */
export function indicatorMetadataRow(metricKey) {
  const indicator = snapshot.indicators[metricKey];
  if (!indicator) throw new Error(`Unknown fixture metric: ${metricKey}`);
  return {
    id: indicator.indicatorCode,
    name: indicator.indicatorMetadata?.name ?? indicator.label,
    unit: indicator.indicatorMetadata?.unit ?? '',
    source: { id: '2', value: indicator.indicatorMetadata?.source ?? 'World Development Indicators' },
    sourceNote: indicator.indicatorMetadata?.sourceNote ?? null,
  };
}

export default { snapshot, provenance, envelope, seriesEnvelope, countryMetadataEnvelope, seriesRows };