/**
 * HISTORICAL COVERAGE TESTS (raw World Bank data only — never invented).
 *
 * The stub World Bank API is extended here with synthetic 1960–1962 rows so the
 * real ingestion pipeline can prove:
 *   - a 1960 observation is stored; a missing 1961 stays missing (never zero);
 *     a resumed 1962 series stores normally;
 *   - /api/years reflects stored years with no hard-coded floor;
 *   - YoY needs the immediate previous year (gaps are never bridged);
 *   - ranks exclude missing economies; India-missing years are explicit;
 *   - endpoint growth needs both endpoints; like-for-like uses real availability;
 *   - a future observation appears automatically; subjects stay separate.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

const wbRow = (code, name, iso3, countryName, year, value) => ({
  indicator: { id: code, value: name },
  country: { id: iso3, value: countryName },
  countryiso3code: iso3,
  date: String(year),
  value,
  unit: '',
  obs_status: '',
  decimal: 2,
});

const PCAP_CODE = 'NY.GDP.PCAP.CD';
const TOTAL_CODE = 'NY.GDP.MKTP.CD';

// Deliberate gap: nominal 1961 has NO India row (USA only). Total is continuous.
const HISTORICAL_ROWS = {
  nominal_current: [
    wbRow(PCAP_CODE, 'GDP per capita (current US$)', 'IND', 'India', 1960, 500.25),
    wbRow(PCAP_CODE, 'GDP per capita (current US$)', 'USA', 'United States', 1960, 3000.5),
    wbRow(PCAP_CODE, 'GDP per capita (current US$)', 'USA', 'United States', 1961, 3200.0),
    wbRow(PCAP_CODE, 'GDP per capita (current US$)', 'IND', 'India', 1962, 600.75),
    wbRow(PCAP_CODE, 'GDP per capita (current US$)', 'USA', 'United States', 1962, 3300.25),
  ],
  total_current: [
    wbRow(TOTAL_CODE, 'GDP (current US$)', 'IND', 'India', 1960, 200000000000),
    wbRow(TOTAL_CODE, 'GDP (current US$)', 'USA', 'United States', 1960, 3000000000000),
    wbRow(TOTAL_CODE, 'GDP (current US$)', 'IND', 'India', 1961, 210000000000),
    wbRow(TOTAL_CODE, 'GDP (current US$)', 'IND', 'India', 1962, 231000000000),
    wbRow(TOTAL_CODE, 'GDP (current US$)', 'USA', 'United States', 1962, 3300000000000),
  ],
};

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      HISTORICAL_ROWS[metricKey] ? [...baseRows, ...HISTORICAL_ROWS[metricKey]] : baseRows,
  });
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function seedHistoricalDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  const summary = await refreshData({
    db,
    startYear: 1960,
    endYear: 1962,
    indicators: ['nominal_current', 'total_current'],
    trigger: 'test-historical',
  });
  assert.equal(summary.status, 'success');
  return { db, repository };
}

function storedValues(db, repository, metricKey, year) {
  const indicator = repository.getIndicatorByMetricKey(db, metricKey);
  return repository.getEligibleObservations(db, indicator.id, year);
}

test('A. historical ingestion stores 1960, skips missing 1961, resumes 1962 (never zero)', async () => {
  const { db, repository } = await seedHistoricalDb();
  const v1960 = storedValues(db, repository, 'nominal_current', 1960);
  assert.deepEqual(
    v1960.map((r) => [r.iso3, r.value]).sort(),
    [['IND', 500.25], ['USA', 3000.5]],
  );
  const v1961 = storedValues(db, repository, 'nominal_current', 1961);
  assert.deepEqual(v1961.map((r) => [r.iso3, r.value]), [['USA', 3200.0]]);
  assert.ok(!v1961.some((r) => r.iso3 === 'IND'), 'missing India must stay missing, never 0');
  assert.ok(!v1961.some((r) => r.value === 0), 'no zero may be stored for a missing observation');
  const v1962 = storedValues(db, repository, 'nominal_current', 1962);
  assert.deepEqual(
    v1962.map((r) => [r.iso3, r.value]).sort(),
    [['IND', 600.75], ['USA', 3300.25]],
  );
  // The continuous Total GDP series stores all three years.
  assert.equal(storedValues(db, repository, 'total_current', 1961).length, 1);
  db.close();
});

test('A2. refreshData with no explicit years defaults to the historical ingest range', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const repository = await import('../src/db/repository.js');
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = createMemoryDb();
  const summary = await refreshData({ db, indicators: ['nominal_current'], trigger: 'test-default-range' });
  assert.equal(summary.status, 'success');
  const run = repository.getLatestFetchRun(db, { status: 'success' });
  assert.equal(run.requested_start_year, 1960);
  assert.equal(run.requested_end_year, new Date().getFullYear());
  assert.equal(run.fetched_start_year, 1959);
  db.close();
});

test('B. /api/years reflects stored historical years with no hard-coded floor', async () => {
  const { db } = await seedHistoricalDb();
  const { listAvailableYears } = await import('../src/db/repository.js');
  assert.deepEqual(listAvailableYears(db).years, [1960, 1961, 1962]);

  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/years`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.years, [1960, 1961, 1962]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
});

test('C. YoY needs the immediate previous year: first year null, gaps never bridged', async () => {
  const { db } = await seedHistoricalDb();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
  const result = buildIndiaYearlyRows(db, { startYear: 1960, endYear: 1962 });
  const row1960 = result.rows.find((r) => r.year === 1960);
  const row1962 = result.rows.find((r) => r.year === 1962);

  // 1960: level valid, YoY unavailable with an explicit reason (no 1959 base).
  assert.equal(row1960.nominal_current.indiaValue, 500.25);
  assert.equal(row1960.nominal_current.indiaYoY, null);
  assert.equal(typeof row1960.nominal_current.indiaYoYReason, 'string');

  // 1962 over a 1961 gap: unavailable — 1961 must not be bridged from 1960.
  assert.equal(row1962.nominal_current.indiaValue, 600.75);
  assert.equal(row1962.nominal_current.indiaYoY, null);
  assert.equal(typeof row1962.nominal_current.indiaYoYReason, 'string');

  // Continuous Total GDP series computes normally on raw values.
  const totalRows = buildIndiaYearlyRows(db, { startYear: 1960, endYear: 1962, subject: 'gdp_total' });
  const t1961 = totalRows.rows.find((r) => r.year === 1961).total_current;
  assert.equal(t1961.indiaYoY, ((210000000000 / 200000000000) - 1) * 100);
  const t1962 = totalRows.rows.find((r) => r.year === 1962).total_current;
  assert.equal(t1962.indiaYoY, ((231000000000 / 210000000000) - 1) * 100);
  db.close();
});

test('D+G. ranks exclude missing economies; missing India is explicit, never faked', async () => {
  const { db } = await seedHistoricalDb();
  const { buildFullRanking } = await import('../src/services/fullRanking.js');
  const { buildRankVerification } = await import('../src/services/rankVerification.js');

  // 1961 nominal holds USA only: denominator 1, no India row anywhere.
  const ranking = buildFullRanking(db, { metricKey: 'nominal_current', year: 1961 });
  assert.equal(ranking.total, 1);
  assert.deepEqual(ranking.rows.map((r) => r.iso3), ['USA']);

  const verify = buildRankVerification(db, { metricKey: 'nominal_current', year: 1961, neighbors: 5 });
  assert.equal(verify.available, false);
  assert.equal(verify.focus, null);
  db.close();
});

test('E+F. endpoint growth needs both endpoints; like-for-like uses real availability', async () => {
  const { db } = await seedHistoricalDb();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');
  const { buildGrowthComparisonResponse } = await import('../src/services/growthComparisonService.js');

  // 1960 -> 1962 nominal: common universe is exactly the two endpoint-present
  // economies (IND, USA); nothing is invented to enlarge it.
  const level = buildLevelComparisonResponse(db, { metricKey: 'nominal_current', yearA: 1960, yearB: 1962 });
  assert.equal(level.comparison.available, true);
  assert.equal(level.universe.common, 2);
  assert.equal(level.universe.entered, 0);
  assert.equal(level.universe.exited, 0);
  const commonMembers = level.economies.rows.filter((r) => r.status === 'common').map((r) => r.iso3).sort();
  assert.deepEqual(commonMembers, ['IND', 'USA']);
  // India held rank 2 in both years (USA above): movement 0, identity holds.
  assert.equal(level.focusMovement.fullRankA, 2);
  assert.equal(level.focusMovement.fullRankB, 2);

  // Endpoint growth 1960 -> 1962 for India uses both endpoints only.
  const growth = buildGrowthComparisonResponse(db, { metricKey: 'nominal_current', yearA: 1960, yearB: 1962 });
  assert.equal(growth.comparison.available, true);
  const indRow = growth.economies.rows.find((r) => r.iso3 === 'IND');
  assert.equal(indRow.intervals.AB.valid, true);
  assert.equal(indRow.intervals.AB.growthPercent, ((600.75 / 500.25) - 1) * 100);

  // A year with no stored observations fails closed with an explicit reason.
  const missing = buildLevelComparisonResponse(db, { metricKey: 'nominal_current', yearA: 1962, yearB: 1963 });
  assert.equal(missing.comparison.available, false);
  assert.equal(missing.comparison.reason, 'no_stored_observations_for_metric_and_year');
  const growthMissing = buildGrowthComparisonResponse(db, { metricKey: 'nominal_current', yearA: 1962, yearB: 1963 });
  assert.equal(growthMissing.comparison.available, false);
  assert.equal(growthMissing.comparison.reason, 'no_stored_observations_for_metric_and_year');
  db.close();
});

test('H. a future observation appears automatically through /api/years', async () => {
  const { db, repository } = await seedHistoricalDb();
  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  repository.upsertObservations(db, [{ countryId: 'IND', indicatorId: indicator.id, year: 2026, value: 2800.5 }]);

  const { listAvailableYears } = await import('../src/db/repository.js');
  assert.ok(listAvailableYears(db).years.includes(2026));

  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/years`);
    const body = await res.json();
    assert.ok(body.years.includes(2026), 'a newly stored future year is selectable with no code change');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
});

test('I. historical coverage stays per-metric and per-subject', async () => {
  const { db, repository } = await seedHistoricalDb();
  const { listYearsWithData } = await import('../src/db/repository.js');
  const nominal = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const total = repository.getIndicatorByMetricKey(db, 'total_current');
  assert.deepEqual(listYearsWithData(db, nominal.id), [1960, 1961, 1962]);
  assert.deepEqual(listYearsWithData(db, total.id), [1960, 1961, 1962]);
  // Same year list, different membership: nominal 1961 holds USA only while
  // total 1961 holds IND only. Nothing is fabricated to symmetrize metrics.
  const isos = (metricId, year) =>
    repository.getEligibleObservations(db, metricId, year).map((r) => r.iso3).sort();
  assert.deepEqual(isos(nominal.id, 1961), ['USA']);
  assert.deepEqual(isos(total.id, 1961), ['IND']);

  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
  const totalRows = buildIndiaYearlyRows(db, { startYear: 1960, endYear: 1960, subject: 'gdp_total' });
  assert.equal(totalRows.subject, 'gdp_total');
  assert.equal(totalRows.rows[0].total_current.indiaValue, 200000000000);
  assert.ok(!('nominal_current' in totalRows.rows[0]), 'no per-capita cell leaks into a Total GDP row');
  db.close();
});
