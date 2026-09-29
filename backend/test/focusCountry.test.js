/**
 * PHASE-1 FOCUS-COUNTRY TESTS (generic focus abstraction).
 *
 * Covers the Phase-1 matrix against in-memory databases (never the live
 * World Bank API, never the real cache file):
 *
 *   1. omitted country        -> IND default, unchanged India behavior
 *   2. ?country=IND           -> identical analytical result to the default
 *   3. ?country=CHN/USA/IDN   -> correct non-India focus (names from the DB)
 *   4. ?country=XYZ / ZZ/WLD  -> 400 INVALID_COUNTRY, never silent IND fallback
 *   5. /api/focus/yearly      -> canonical route, same implementation as alias
 *   6. /api/india/gdp-ranking -> permanent alias, legacy analytical fields intact
 *   7. focus switch           -> no ingestion side effects (no fetch_runs rows,
 *                                no observation writes)
 *   8. golden regression      -> IND analytical outputs match hand-computed
 *                                edge-case expectations (values, ranks,
 *                                denominators, YoY, neighbors, comparison)
 *
 * No domain engine is modified by Phase 1; these tests prove the plumbing
 * only re-addresses the same calculations to a different focus country.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EDGE_EXPECTATIONS } from './fixtures/edgeCases.js';
import { queryGet } from '../src/db/driver.js';
import { createMemoryTestDb, seedEdgeCaseDb } from './helpers/testDb.js';

let baseUrl = null;
let server = null;
let db = null;
let repository = null;

test.before(async () => {
  const seeded = await seedEdgeCaseDb();
  db = seeded.db;
  repository = seeded.repository;
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

/** Analytical fields of one yearly metric cell (legacy contract, Phase-1 frozen). */
function cellFields(cell) {
  return {
    available: cell.available,
    indiaValue: cell.indiaValue,
    indiaValueRaw: cell.indiaValueRaw,
    indiaRank: cell.indiaRank,
    total: cell.total,
    indiaYoY: cell.indiaYoY,
    indiaYoYReason: cell.indiaYoYReason,
    previousYearValue: cell.previousYearValue,
  };
}

test('Phase 1: omitted country behaves exactly like explicit ?country=IND', async () => {
  const omitted = await get('/api/india/gdp-ranking?startYear=2003&endYear=2005');
  const explicit = await get('/api/india/gdp-ranking?startYear=2003&endYear=2005&country=IND');
  assert.equal(omitted.status, 200);
  assert.equal(explicit.status, 200);
  assert.deepEqual(omitted.body.focus, { iso3: 'IND', name: 'India', kind: 'country' });
  assert.deepEqual(explicit.body.focus, omitted.body.focus);
  assert.deepEqual(explicit.body.rows, omitted.body.rows);
  assert.deepEqual(explicit.body.metricKeys, omitted.body.metricKeys);
});

test('Phase 1: canonical /api/focus/yearly matches the legacy alias for IND', async () => {
  const alias = await get('/api/india/gdp-ranking?startYear=2003&endYear=2005');
  const canonical = await get('/api/focus/yearly?startYear=2003&endYear=2005&country=IND');
  assert.equal(canonical.status, 200);
  assert.deepEqual(canonical.body.focus, alias.body.focus);
  assert.deepEqual(canonical.body.rows, alias.body.rows);
  assert.deepEqual(canonical.body.metricKeys, alias.body.metricKeys);
  // Analytical cells are identical field-by-field (golden anchor).
  for (const row of canonical.body.rows) {
    const legacy = alias.body.rows.find((r) => r.year === row.year);
    assert.deepEqual(cellFields(row.nominal_current), cellFields(legacy.nominal_current));
  }
});

test('Phase 1: golden IND outputs are unchanged (value, rank, denominator, YoY)', async () => {
  const { body } = await get('/api/india/gdp-ranking?startYear=2003&endYear=2005');
  const byYear = new Map(body.rows.map((r) => [r.year, r]));
  for (const year of [2003, 2004, 2005]) {
    const cell = byYear.get(year).nominal_current;
    assert.equal(cell.indiaValue, EDGE_EXPECTATIONS.indiaValue[year]);
    assert.equal(cell.indiaRank, EDGE_EXPECTATIONS.indiaRank[year]);
    assert.equal(cell.total, EDGE_EXPECTATIONS.levelDenominator[year]);
    assert.equal(cell.indiaYoY, EDGE_EXPECTATIONS.indiaYoyPercent[year]);
  }
});

test('Phase 1: ?country=USA resolves the US focus from database metadata', async () => {
  const { status, body } = await get('/api/focus/yearly?startYear=2003&endYear=2005&country=USA');
  assert.equal(status, 200);
  assert.deepEqual(body.focus, { iso3: 'USA', name: 'United States', kind: 'country' });
  const byYear = new Map(body.rows.map((r) => [r.year, r]));
  // USA holds rank 1 in every edge-case year with its own values and denominators.
  assert.equal(byYear.get(2005).nominal_current.indiaValue, 43000.333333);
  assert.equal(byYear.get(2005).nominal_current.indiaRank, 1);
  assert.equal(byYear.get(2005).nominal_current.total, 6);
  assert.equal(byYear.get(2004).nominal_current.indiaRank, 1);
  assert.equal(byYear.get(2003).nominal_current.indiaRank, 1);
});

test('Phase 1: lowercase ?country=usa normalizes to USA', async () => {
  const { status, body } = await get('/api/focus/yearly?startYear=2005&endYear=2005&country=usa');
  assert.equal(status, 200);
  assert.equal(body.focus.iso3, 'USA');
  assert.equal(body.focus.name, 'United States');
});

test('Phase 1: ?country=BRA honors tie ordering against IND', async () => {
  const { status, body } = await get('/api/focus/yearly?startYear=2005&endYear=2005&country=BRA');
  assert.equal(status, 200);
  assert.deepEqual(body.focus, { iso3: 'BRA', name: 'Brazil', kind: 'country' });
  // 2005 order USA, XKX, PSE, BRA, IND, CIV: BRA rank 4, IND rank 5 (ISO3 tie-break).
  assert.equal(body.rows[0].nominal_current.indiaRank, 4);
  assert.equal(body.rows[0].nominal_current.indiaValue, 800.125);
});

test('Phase 1: unknown ?country=XYZ fails closed with INVALID_COUNTRY', async () => {
  for (const path of [
    '/api/focus/yearly?startYear=2005&endYear=2005&country=XYZ',
    '/api/india/gdp-ranking?startYear=2005&endYear=2005&country=XYZ',
    '/api/ranking?indicator=nominal_current&year=2005&country=XYZ',
    '/api/ranking/verify?indicator=nominal_current&year=2005&country=XYZ',
    '/api/yoy-ranking?indicator=nominal_current&year=2005&country=XYZ',
    '/api/yoy-ranking/verify?indicator=nominal_current&year=2005&country=XYZ',
    '/api/coverage?year=2005&country=XYZ',
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2005&country=XYZ',
    '/api/observations?indicator=nominal_current&year=2005&country=XYZ',
  ]) {
    const { status, body } = await get(path);
    assert.equal(status, 400, `expected 400 for ${path}`);
    assert.equal(body.error.code, 'INVALID_COUNTRY', `expected INVALID_COUNTRY for ${path}`);
    assert.equal(body.stack, undefined, 'no stack traces in error responses');
  }
});

test('Phase 1: malformed ?country=ZZ and aggregate ?country=WLD fail closed', async () => {
  const malformed = await get('/api/focus/yearly?country=ZZ');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_COUNTRY');
  // WLD is a World Bank aggregate, not an eligible focus country in Phase 1.
  const aggregate = await get('/api/focus/yearly?country=WLD');
  assert.equal(aggregate.status, 400);
  assert.equal(aggregate.body.error.code, 'INVALID_COUNTRY');
});

test('Phase 1: non-IND focus flows through ranking, verification and comparison', async () => {
  const ranking = await get('/api/ranking?indicator=nominal_current&year=2005&country=USA&search=USA');
  assert.equal(ranking.status, 200);
  assert.equal(ranking.body.search.matches[0].rank, 1);
  assert.equal(ranking.body.search.matches[0].isFocus, true);

  const verify = await get('/api/ranking/verify?indicator=nominal_current&year=2005&country=USA&neighbors=1');
  assert.equal(verify.status, 200);
  assert.equal(verify.body.focus.rank, 1);
  assert.equal(verify.body.focus.country, 'United States');

  const yoy = await get('/api/yoy-ranking/verify?indicator=nominal_current&year=2005&country=USA&neighbors=1');
  assert.equal(yoy.status, 200);
  assert.equal(yoy.body.focus.iso3, 'USA');

  const comparison = await get(
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2005&country=USA&detail=full',
  );
  assert.equal(comparison.status, 200);
  assert.equal(comparison.body.focus.iso3, 'USA');
  assert.equal(comparison.body.focus.name, 'United States');

  const coverage = await get('/api/coverage?year=2005&country=USA');
  assert.equal(coverage.status, 200);
  const nominal = coverage.body.metrics.find((m) => m.metric.key === 'nominal_current');
  assert.equal(nominal.focus.iso3, 'USA');
  assert.equal(nominal.focus.rank, 1);
});

test('Phase 1: focus-country requests trigger no ingestion side effects', async () => {
  const countRuns = async () => (await queryGet(db, 'SELECT COUNT(*) AS n FROM fetch_runs')).n;
  const countObs = async () => (await queryGet(db, 'SELECT COUNT(*) AS n FROM observations')).n;
  const runsBefore = await countRuns();
  const obsBefore = await countObs();
  for (const path of [
    '/api/focus/yearly?startYear=2002&endYear=2005&country=USA',
    '/api/focus/yearly?startYear=2002&endYear=2005&country=BRA',
    '/api/ranking?indicator=nominal_current&year=2005&country=USA',
    '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2005&country=USA',
    '/api/coverage?year=2005&country=BRA',
  ]) {
    const { status } = await get(path);
    assert.equal(status, 200);
  }
  assert.equal(await countRuns(), runsBefore, 'focus switches must not record fetch runs');
  assert.equal(await countObs(), obsBefore, 'focus switches must not write observations');
});

test('Phase 1: CHN/USA/IDN matrix on a dedicated four-country dataset', async () => {
  const { db: matrixDb, repository: matrixRepo } = await createMemoryTestDb();
  const { buildUniverse } = await import('../src/domain/universe.js');
  const { METRICS } = await import('../src/config.js');
  const universe = buildUniverse([
    { id: 'IND', iso2Code: 'IN', name: 'India', region: { id: 'SAS', value: 'South Asia' } },
    { id: 'CHN', iso2Code: 'CN', name: 'China', region: { id: 'EAS', value: 'East Asia & Pacific' } },
    { id: 'USA', iso2Code: 'US', name: 'United States', region: { id: 'NAC', value: 'North America' } },
    { id: 'IDN', iso2Code: 'ID', name: 'Indonesia', region: { id: 'EAS', value: 'East Asia & Pacific' } },
  ]);
  await matrixRepo.upsertCountries(matrixDb, universe.countries);
  await matrixRepo.upsertIndicator(matrixDb, {
    ...METRICS.nominal_current,
    name: 'GDP per capita (current US$)',
    unit: 'current US$',
    source: 'World Development Indicators',
  });
  const indicator = await matrixRepo.getIndicatorByMetricKey(matrixDb, 'nominal_current');
  await matrixRepo.upsertObservations(matrixDb, [
    { countryId: 'IND', indicatorId: indicator.id, year: 2004, value: 700.75 },
    { countryId: 'IND', indicatorId: indicator.id, year: 2005, value: 800.125 },
    { countryId: 'CHN', indicatorId: indicator.id, year: 2004, value: 2000 },
    { countryId: 'CHN', indicatorId: indicator.id, year: 2005, value: 2200 },
    { countryId: 'USA', indicatorId: indicator.id, year: 2004, value: 42000.222222 },
    { countryId: 'USA', indicatorId: indicator.id, year: 2005, value: 43000.333333 },
    { countryId: 'IDN', indicatorId: indicator.id, year: 2004, value: 1000 },
    { countryId: 'IDN', indicatorId: indicator.id, year: 2005, value: 1100 },
  ]);

  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
  const expectations = {
    CHN: { name: 'China', rank2005: 2, value2005: 2200 },
    USA: { name: 'United States', rank2005: 1, value2005: 43000.333333 },
    IDN: { name: 'Indonesia', rank2005: 3, value2005: 1100 },
    IND: { name: 'India', rank2005: 4, value2005: 800.125 },
  };
  for (const [iso3, expected] of Object.entries(expectations)) {
    const result = await buildIndiaYearlyRows(matrixDb, { startYear: 2005, endYear: 2005, focusIso3: iso3 });
    assert.equal(result.focus.iso3, iso3);
    assert.equal(result.focus.name, expected.name, `focus name for ${iso3} comes from the database`);
    assert.equal(result.focus.kind, 'country');
    const cell = result.rows[0].nominal_current;
    assert.equal(cell.indiaRank, expected.rank2005, `2005 rank for ${iso3}`);
    assert.equal(cell.indiaValue, expected.value2005, `2005 value for ${iso3}`);
    assert.equal(cell.total, 4);
  }
});
