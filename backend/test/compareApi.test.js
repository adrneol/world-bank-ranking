/**
 * COMPARE API — HTTP CONTRACT TESTS.
 *
 * The Compare endpoint is the authority for the comparison universe, the
 * analysis plan, the coverage diagnostics and the verified chart series.
 * These tests exercise the wire contract directly: request validation, the
 * three-period model, all six entity combinations in both modes, the
 * missing-data policy and the cache invalidation rules.
 *
 * Every fixture database is disposable and in memory; the production and the
 * real development database are never opened.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { METRICS } from '../src/config.js';
import { queryRun } from '../src/db/driver.js';
import { createMemoryTestDb } from './helpers/testDb.js';

const YEAR_A = 2004;
const YEAR_B = 2005;
const YEAR_C = 2006;

async function seedCompareDb() {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse } = await import('../src/domain/universe.js');
  const universe = buildUniverse([
    { id: 'IND', iso2Code: 'IN', name: 'India', region: { id: 'SAS', value: 'South Asia' } },
    { id: 'CHN', iso2Code: 'CN', name: 'China', region: { id: 'EAS', value: 'East Asia & Pacific' } },
    { id: 'USA', iso2Code: 'US', name: 'United States', region: { id: 'NAC', value: 'North America' } },
    { id: 'IDN', iso2Code: 'ID', name: 'Indonesia', region: { id: 'EAS', value: 'East Asia & Pacific' } },
    { id: 'BRA', iso2Code: 'BR', name: 'Brazil', region: { id: 'LCN', value: 'Latin America' } },
    { id: 'DEU', iso2Code: 'DE', name: 'Germany', region: { id: 'ECS', value: 'Europe & Central Asia' } },
    // A country whose stored values are genuine ZEROS (not missing data).
    { id: 'ZZZ', iso2Code: 'ZZ', name: 'Zero Value Land', region: { id: 'ECS', value: 'Europe & Central Asia' } },
    { id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA', value: 'Aggregates' } },
  ]);
  await repository.upsertCountries(db, universe.countries);
  for (const key of ['total_current', 'exports_current', 'fx_official', 'inflation_cpi', 'current_account', 'fdi_inflows', 'reserves_ex_gold', 'remittances_received', 'imports_current']) {
    await repository.upsertIndicator(db, {
      ...METRICS[key],
      name: key,
      unit: METRICS[key].unit,
      source: 'World Development Indicators',
    });
  }
  const total = await repository.getIndicatorByMetricKey(db, 'total_current');
  const exportsIndicator = await repository.getIndicatorByMetricKey(db, 'exports_current');
  const fx = await repository.getIndicatorByMetricKey(db, 'fx_official');
  const inflation = await repository.getIndicatorByMetricKey(db, 'inflation_cpi');
  const rows = [];
  const totals = {
    IND: { 2004: 721e9, 2005: 834e9, 2006: 940e9 },
    CHN: { 2004: 1955e9, 2005: 2286e9, 2006: 2700e9 },
    USA: { 2004: 11963e9, 2005: 13036e9, 2006: 14000e9 },
    // IDN holds no 2004 observation: it is complete for 2005 but not for the
    // whole period, so the observed and like-for-like group values differ.
    IDN: { 2005: 280e9, 2006: 300e9 },
    // BRA holds no 2005 observation: the second year is incomplete.
    BRA: { 2004: 800e9, 2006: 950e9 },
    DEU: { 2004: 2800e9, 2005: 2900e9, 2006: 3000e9 },
    // One country holds a genuine ZERO value (not a missing observation).
    ZZZ: { 2004: 0, 2005: 0, 2006: 0 },
  };
  for (const [iso3, years] of Object.entries(totals)) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: total.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  // IDN has no 2005 export observation: a genuine missing observation inside
  // the half-open period [2004, 2006).
  const exportsValues = {
    IND: { 2004: 100, 2005: 120, 2006: 140 },
    CHN: { 2004: 200, 2005: 240, 2006: 280 },
    USA: { 2004: 300, 2005: 320, 2006: 340 },
    IDN: { 2004: 50, 2006: 70 },
  };
  for (const [iso3, years] of Object.entries(exportsValues)) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: exportsIndicator.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  for (const [iso3, years] of Object.entries({ IND: { 2004: 83.6, 2005: 84.1, 2006: 85.0 }, USA: { 2004: 0.92, 2005: 0.9, 2006: 0.88 } })) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: fx.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  for (const [iso3, years] of Object.entries({
    IND: { 2004: 10, 2005: 20, 2006: -10 },
    CHN: { 2004: 5, 2005: 10, 2006: 15 },
    USA: { 2004: 2, 2005: 3, 2006: 4 },
  })) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: inflation.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  const basisValues = {
    current_account: {
      IND: { 2004: 72.1e9, 2005: 166.8e9, 2006: 282e9 },
      CHN: { 2004: 195.5e9, 2005: 228.6e9, 2006: 540e9 },
      USA: { 2004: -100e9, 2005: -200e9, 2006: -300e9 },
    },
    fdi_inflows: {
      IND: { 2004: 999e9, 2005: -10e9, 2006: 30e9 },
      CHN: { 2004: 888e9, 2005: 20e9, 2006: 10e9 },
      USA: { 2004: 777e9, 2005: 50e9, 2006: 60e9 },
    },
    reserves_ex_gold: {
      IND: { 2004: 50, 2005: 60, 2006: 70 },
      CHN: { 2004: 100, 2005: 120, 2006: 140 },
      USA: { 2004: 80, 2005: 100, 2006: 120 },
    },
    imports_current: {
      IND: { 2004: 100, 2005: 120, 2006: 140 },
      CHN: { 2004: 200, 2005: 240, 2006: 280 },
      USA: { 2004: 300, 2005: 320, 2006: 340 },
    },
    remittances_received: {
      IND: { 2004: 500e9, 2005: 10e9, 2006: 30e9 },
      CHN: { 2004: 400e9, 2005: 40e9, 2006: 10e9 },
      USA: { 2004: 300e9, 2005: 15e9, 2006: 25e9 },
    },
  };
  for (const [metricKey, byIso] of Object.entries(basisValues)) {
    const source = await repository.getIndicatorByMetricKey(db, metricKey);
    for (const [iso3, yearValues] of Object.entries(byIso)) {
      for (const [year, value] of Object.entries(yearValues)) {
        rows.push({ countryId: iso3, indicatorId: source.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
      }
    }
  }
  await repository.upsertObservations(db, rows);
  return { db, repository };
}

async function startApp(db) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function getJSON(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

test('compare API: the operation catalogue of the service and of the analysis planner agree', async () => {
  const { COMPARE_OPERATIONS } = await import('../src/services/entities.js');
  const { COMPARE_ANALYSIS_IDS } = await import('../src/domain/compareAnalysis.js');
  assert.deepEqual([...COMPARE_OPERATIONS].sort(), [...COMPARE_ANALYSIS_IDS].sort());
});

test('compare API: invalid requests fail closed with a specific code', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const cases = [
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current', 'MISSING_YEAR'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=NOPE&yearA=2004', 'INVALID_INDICATOR'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&operation=nope', 'INVALID_OPERATION'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&groupMode=nope', 'INVALID_GROUP_MODE'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&basis=ca_annual_gdp&yearA=2004', 'INVALID_BASIS'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2004&operation=percent_change', 'SAME_YEAR_SELECTED'],
      // A reversed interval is refused: the years must be chronological.
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2006&yearB=2004&operation=percent_change', 'INVALID_YEAR_ORDER'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2006&yearC=2004&operation=percent_change', 'INVALID_YEAR_ORDER'],
      // A partitioned analysis needs all three periods, in order.
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&operation=segmented_growth', 'MISSING_YEAR'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2006&yearC=2005&operation=segmented_growth', 'INVALID_YEAR_ORDER'],
      // A metric that does not declare the transformation refuses.
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&operation=period_total', 'UNSUPPORTED_TRANSFORMATION'],
    ];
    for (const [path, code] of cases) {
      const res = await getJSON(base, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, code, path);
      assert.equal(res.body.stack, undefined);
    }
  } finally {
    await close();
  }
});

test('compare API: the registry comparisonCapability blocks the derived result, not the entity', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    // fx_official declares ['COUNTRY', 'CUSTOM_GROUP'] — an official aggregate
    // is not a supported comparison entity for it. The entity stays
    // addressable and its published availability is reported honestly (an
    // aggregate is never invented), but no derived result is computed.
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=aggregate:WLD&indicator=fx_official&yearA=2004&yearB=2005&operation=absolute_change');
    assert.equal(res.status, 200);
    assert.equal(res.body.capability.allowed, false);
    assert.equal(res.body.capability.reason, 'UNSUPPORTED_ENTITY_COMBINATION');
    // The standalone value keeps its own availability.
    assert.equal(res.body.results.b.values['2005'].available, false);
    assert.equal(res.body.results.b.values['2005'].reason, 'MISSING_REQUIRED_DATA');
    // The derived result is blocked with the capability reason.
    assert.equal(res.body.results.comparison.available, false);
    assert.equal(res.body.results.comparison.gap.value, null);
    assert.equal(res.body.results.comparison.gap.reason, 'UNSUPPORTED_ENTITY_COMBINATION');
    assert.ok(
      res.body.diagnostics.some((d) => d.code === 'UNSUPPORTED_ENTITY_COMBINATION'),
      'the blocked comparison carries a structured diagnostic',
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// THE THREE-PERIOD MODEL
// ---------------------------------------------------------------------------

test('compare API: Year C turns a two-point analysis into an A-to-C analysis', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const two = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2006&operation=percent_change');
    assert.equal(two.status, 200);
    assert.deepEqual(two.body.analysis.requiredObservationYears, [2004, 2006]);

    const three = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&basis=total_current&yearA=2004&yearC=2006&operation=percent_change');
    assert.equal(three.status, 200);
    assert.equal(three.body.basis, 'total_current');
    assert.equal(three.body.analysis.basis, 'total_current');
    assert.deepEqual(three.body.analysis.requiredObservationYears, [2004, 2006]);
    assert.equal(three.body.analysis.startYear, 2004);
    assert.equal(three.body.analysis.endYear, 2006);
    assert.equal(three.body.analysis.midYear, null);
    assert.equal(three.body.results.comparison.a.value, ((940e9 / 721e9) - 1) * 100);
  } finally {
    await close();
  }
});

test('compare API: Level positions use the selected metric and mode-specific eligible population', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const observed = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearC=2006&operation=level&groupMode=observed');
    const observedAB = observed.body.results.comparison.intervalResults[0];
    assert.deepEqual(observedAB.a.start.rank, {
      position: 5, denominator: 6, attribution: 'APPLICATION_DERIVED', direction: 'DESC',
      methodology: 'Application ranking service; ties use distinct ordinal positions with ISO3 as the deterministic tie-break.',
    });
    assert.equal(observedAB.b.start.rank.position, 3);
    assert.equal(observedAB.a.end.rank.denominator, 7);

    const likeForLike = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearC=2006&operation=level&groupMode=like_for_like');
    const commonAB = likeForLike.body.results.comparison.intervalResults[0];
    assert.equal(commonAB.a.start.rank.position, 5);
    assert.equal(commonAB.a.start.rank.denominator, 6);
    assert.equal(commonAB.a.end.rank.denominator, 6);
    assert.equal(commonAB.a.start.rank.attribution, 'APPLICATION_DERIVED');
    assert.equal(commonAB.a.start.rank.methodology.includes('World Bank'), false);
  } finally {
    await close();
  }
});

test('compare API: a selected Year B produces independent A→B, B→C and A→C results', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&yearC=2006&operation=percent_change');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.analysis.ignoredPeriods, []);
    assert.deepEqual(res.body.analysis.requiredObservationYears, [2004, 2005, 2006]);
    const intervals = res.body.results.comparison.intervalResults;
    assert.deepEqual(intervals.map(({ id }) => id), ['AB', 'BC', 'AC']);
    const pct = (start, end) => ((end / start) - 1) * 100;
    assert.ok(Math.abs(intervals[0].a.value - pct(721e9, 834e9)) < 1e-10);
    assert.ok(Math.abs(intervals[1].a.value - pct(834e9, 940e9)) < 1e-10);
    assert.ok(Math.abs(intervals[2].a.value - pct(721e9, 940e9)) < 1e-10);
    assert.ok(Math.abs(intervals[0].b.value - pct(1955e9, 2286e9)) < 1e-10);
    assert.equal(intervals[0].observations.a.map((entry) => entry.year).join(','), '2004,2005');
    assert.equal(intervals[0].gap.unit, 'percentage points');
  } finally {
    await close();
  }
});

test('compare API: clearing the middle year leaves only the A→C interval', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearC=2006&operation=segmented_growth');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.analysis.requiredObservationYears, [2004, 2006]);
    assert.deepEqual(res.body.results.comparison.intervalResults.map(({ id }) => id), ['AC']);
    assert.ok(Math.abs(res.body.results.comparison.intervalResults[0].a.value - 40) < 1e-9);
  } finally {
    await close();
  }
});

test('compare API: a partitioned analysis uses A, B and C over one shared universe', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2005&yearC=2006&operation=segmented_growth');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.analysis.requiredObservationYears, [2004, 2005, 2006]);
    assert.deepEqual(Object.keys(res.body.results.comparison.segments), ['AM', 'MB', 'AB']);
    // AM: 100 -> 120 over one year; MB: 120 -> 140; AB: 100 -> 140.
    assert.ok(Math.abs(res.body.results.comparison.segments.AM.a.value - 20) < 1e-9);
    assert.ok(Math.abs(res.body.results.comparison.segments.MB.a.value - ((140 / 120) - 1) * 100) < 1e-9);
    assert.ok(Math.abs(res.body.results.comparison.segments.AB.a.value - 40) < 1e-9);
    // ONE universe for all three segments.
    assert.equal(res.body.universe.requiredObservationYears.length, 3);
  } finally {
    await close();
  }
});

test('compare API: a period total uses the half-open period [A, C)', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearC=2006&operation=period_total');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.analysis.boundary, { start: 2004, end: 2006, inclusiveStart: true, inclusiveEnd: false, kind: 'period_half_open' });
    // The period is 2004 + 2005 (2006 is the exclusive boundary).
    assert.equal(res.body.results.comparison.a.value, 100 + 120);
    assert.equal(res.body.results.comparison.b.value, 200 + 240);
    assert.equal(res.body.results.comparison.gap.value, 100 + 120 - (200 + 240));
  } finally {
    await close();
  }
});

test('compare API: Movement trade totals use inclusive S..E years in all three intervals and both modes', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    for (const groupMode of ['observed', 'like_for_like']) {
      const res = await getJSON(base, `/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2005&yearC=2006&operation=movement_period_total&groupMode=${groupMode}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.analysis.requiredObservationYears, [2004, 2005, 2006]);
      const intervals = res.body.results.comparison.intervalResults;
      assert.deepEqual(intervals.map(({ id }) => id), ['AB', 'BC', 'AC']);
      assert.deepEqual(intervals.map(({ a }) => a.value), [220, 260, 360]);
      assert.deepEqual(intervals.map(({ b }) => b.value), [440, 520, 720]);
      assert.deepEqual(intervals.map(({ gap }) => gap.value), [-220, -260, -360]);
      assert.deepEqual(intervals.map(({ a }) => [a.rank.position, a.rank.denominator]), [[3, 3], [3, 3], [3, 3]]);
      assert.deepEqual(intervals.map(({ b }) => [b.rank.position, b.rank.denominator]), [[2, 3], [2, 3], [2, 3]]);
      assert.ok(intervals.every(({ a, b }) => a.rank.attribution === 'APPLICATION_DERIVED' && b.rank.attribution === 'APPLICATION_DERIVED'));
      assert.ok(intervals.every((interval) => interval.boundary.inclusiveStart && interval.boundary.inclusiveEnd));
    }
  } finally {
    await close();
  }
});

test('compare API: Movement inflation uses S+1..E and compounds each interval independently', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    for (const groupMode of ['observed', 'like_for_like']) {
      const res = await getJSON(base, `/api/compare?entityA=country:IND&entityB=country:CHN&indicator=inflation_cpi&yearA=2004&yearB=2005&yearC=2006&operation=movement_inflation_cumulative&groupMode=${groupMode}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.analysis.requiredObservationYears, [2005, 2006]);
      const intervals = res.body.results.comparison.intervalResults;
      assert.deepEqual(intervals.map(({ id }) => id), ['AB', 'BC', 'AC']);
      const expectedA = [20, -10, 8];
      const expectedB = [10, 15, 26.5];
      intervals.forEach((interval, index) => {
        assert.ok(Math.abs(interval.a.value - expectedA[index]) < 1e-10);
        assert.ok(Math.abs(interval.b.value - expectedB[index]) < 1e-10);
        assert.ok(Math.abs(interval.gap.value - (expectedA[index] - expectedB[index])) < 1e-10);
        assert.equal(interval.gap.unit, 'percentage points');
      });
      assert.deepEqual(intervals[0].observations.a.map(({ year }) => year), [2005]);
      assert.deepEqual(intervals[2].observations.a.map(({ year }) => year), [2005, 2006]);
    }
  } finally {
    await close();
  }
});

test('compare API: period-total growth shows both period totals and the A→C percentage result', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2005&yearC=2006&operation=period_total_growth');
    assert.equal(res.status, 200);
    const [first, second, full] = res.body.results.comparison.intervalResults;
    assert.deepEqual([first.id, second.id, full.id], ['AB', 'BC', 'AC']);
    // AB and BC are the disjoint annual-flow totals; AC reports their growth.
    assert.equal(first.a.value, 100);
    assert.equal(second.a.value, 120);
    assert.ok(Math.abs(full.a.value - 20) < 1e-10);
    assert.equal(full.a.unit, '%');
    assert.equal(full.gap.value, 0);
    assert.equal(full.gap.unit, 'percentage points');
    const noMiddle = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearC=2006&operation=period_total_growth');
    assert.equal(noMiddle.status, 200);
    assert.deepEqual(noMiddle.body.results.comparison.intervalResults.map(({ id }) => id), ['AC']);
    assert.equal(noMiddle.body.results.comparison.intervalResults[0].available, false);
    assert.equal(noMiddle.body.results.comparison.intervalResults[0].reason, 'MISSING_MIDDLE_YEAR');
  } finally {
    await close();
  }
});

test('compare API: period totals and averages independently expose AB, BC and AC', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const total = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2005&yearC=2006&operation=period_total');
    assert.equal(total.status, 200);
    const totals = total.body.results.comparison.intervalResults;
    assert.deepEqual(totals.map(({ id }) => id), ['AB', 'BC', 'AC']);
    assert.deepEqual(totals.map(({ a }) => a.value), [100, 120, 220]);
    assert.deepEqual(totals.map(({ b }) => b.value), [200, 240, 440]);
    assert.equal(totals[0].boundary.inclusiveEnd, false);
    const average = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=exports_current&yearA=2004&yearB=2005&yearC=2006&operation=period_average');
    assert.equal(average.status, 200);
    assert.deepEqual(average.body.results.comparison.intervalResults.map(({ a }) => a.value), [100, 120, 110]);
  } finally {
    await close();
  }
});

test('compare API: a period with a missing observation is never publishable', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    // IDN has no 2006 export observation: the period [2004, 2006) is
    // complete for the country, so this checks the strict-completeness rule
    // on a group whose member is missing the LAST period year.
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:IDN,USA&indicator=exports_current&yearA=2004&yearC=2006&operation=period_total');
    assert.equal(res.status, 200);
    assert.equal(res.body.results.comparison.available, false);
    assert.equal(res.body.results.comparison.gap.value, null);
    assert.ok(
      res.body.diagnostics.some((d) => d.code === 'MISSING_REQUIRED_DATA' || d.code === 'COVERAGE_INCOMPLETE'),
      'the blocked period carries a diagnostic',
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// THE SIX ENTITY COMBINATIONS
// ---------------------------------------------------------------------------

const COMBINATIONS = [
  { name: 'country vs country', a: 'country:IND', b: 'country:CHN' },
  { name: 'country vs aggregate', a: 'country:IND', b: 'aggregate:WLD' },
  { name: 'country vs group', a: 'country:IND', b: 'group:CHN,USA' },
  { name: 'aggregate vs aggregate', a: 'aggregate:WLD', b: 'aggregate:EAS' },
  { name: 'aggregate vs group', a: 'aggregate:WLD', b: 'group:CHN,USA' },
  { name: 'group vs group', a: 'group:IND,BRA', b: 'group:CHN,DEU' },
];

test('compare API: all six entity combinations answer in both modes', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    for (const combination of COMBINATIONS) {
      for (const mode of ['observed', 'like_for_like']) {
        const path =
          `/api/compare?entityA=${combination.a}&entityB=${combination.b}` +
          `&indicator=total_current&yearA=${YEAR_A}&yearB=${YEAR_B}&operation=level&groupMode=${mode}`;
        const res = await getJSON(base, path);
        // EAS is not part of the fixture, so that one combination is refused
        // with a specific reason instead of a number.
        if (combination.name === 'aggregate vs aggregate') {
          assert.equal(res.status, 400, path);
          assert.equal(res.body.error.code, 'NO_OFFICIAL_AGGREGATE');
          continue;
        }
        assert.equal(res.status, 200, path);
        assert.equal(res.body.available, true, path);
        assert.equal(res.body.mode, mode, path);
        assert.ok(res.body.universe, `${path} carries the universe`);
        assert.ok(Array.isArray(res.body.results.a.series.points), `${path} carries the verified series`);
        // Both modes are answered; the payload differs.
        assert.ok(res.body.results.a.observed, path);
        assert.ok(res.body.results.a.likeForLike, path);
      }
    }
  } finally {
    await close();
  }
});

test('compare API: like-for-like never silently falls back to the observed values', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const observed = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=level&groupMode=observed');
    const likeForLike = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=level&groupMode=like_for_like');
    assert.equal(observed.status, 200);
    assert.equal(likeForLike.status, 200);
    // The observed group subtotal uses both members; the like-for-like value
    // uses only the member that is complete at every required year.
    assert.equal(observed.body.results.b.observed['2005'].members, 2);
    assert.equal(likeForLike.body.results.b.likeForLike['2005'].members, 1);
    assert.deepEqual(likeForLike.body.results.b.coverage.common, ['CHN']);
    assert.notEqual(observed.body.results.b.observed['2005'].value, likeForLike.body.results.b.likeForLike['2005'].value);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// MISSING DATA, ZERO AND NEGATIVE VALUES
// ---------------------------------------------------------------------------

test('compare API: a missing observation blocks the affected derived result and names the country', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,BRA&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change&groupMode=observed');
    assert.equal(res.status, 200);
    // BRA has no 2005 observation: the observed subtotal is partial.
    assert.equal(res.body.results.b.observed['2005'].complete, false);
    assert.deepEqual(res.body.results.b.observed['2005'].missingIso3, ['BRA']);
    assert.equal(res.body.results.b.observed['2005'].missingCount, 1);
    // The derived result is blocked.
    assert.equal(res.body.results.comparison.b.value, null);
    assert.equal(res.body.results.comparison.gap.value, null);
    assert.equal(res.body.results.comparison.available, false);
    const diagnostic = res.body.diagnostics.find((d) => d.code === 'COVERAGE_INCOMPLETE');
    assert.ok(diagnostic, 'a structured diagnostic explains the blockage');
    assert.equal(diagnostic.scope, 'entity_b');
    assert.deepEqual(diagnostic.years, [2005]);
  } finally {
    await close();
  }
});

test('compare API: a zero value is data, not a missing observation', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:ZZZ&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change');
    assert.equal(res.status, 200);
    assert.equal(res.body.results.b.values['2005'].value, 0);
    assert.equal(res.body.results.b.values['2005'].available, true);
    // A zero base is refused by the approved percent-change rule, and the
    // reason names the zero base rather than a missing observation.
    const pct = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:ZZZ&indicator=total_current&yearA=2004&yearB=2005&operation=percent_change');
    assert.equal(pct.body.results.comparison.b.value, null);
    assert.equal(pct.body.results.comparison.b.reason, 'zero_base_for_percent_change');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// CACHE AND DATASET VERSION
// ---------------------------------------------------------------------------

test('compare API: a new dataset content version invalidates a cached comparison', async () => {
  const { db, repository } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const path = '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change';
    const first = await getJSON(base, path);
    assert.equal(first.status, 200);
    assert.equal(first.body.cached, false);
    assert.equal(first.body.results.comparison.a.value, 834e9 - 721e9);

    const second = await getJSON(base, path);
    assert.equal(second.body.cached, true, 'the identical request is served from the cache');
    assert.equal(second.body.results.comparison.a.value, 834e9 - 721e9);

    // A publish (content version advance) makes the cached entry stale.
    await queryRun(db, "UPDATE observations SET value = 999 WHERE country_id = 'IND' AND year = 2005");
    const { upsertDatasetStateInner } = await import('../src/db/repository.js');
    await upsertDatasetStateInner(db, { contentVersion: 42, observationCount: 999 });
    const third = await getJSON(base, path);
    assert.equal(third.body.cached, false, 'a new content version recomputes');
    assert.equal(third.body.results.comparison.a.value, 999 - 721e9);
  } finally {
    await close();
  }
});

test('compare API: observed and like-for-like results are never shared', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const observed = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=level&groupMode=observed');
    const likeForLike = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=level&groupMode=like_for_like');
    assert.equal(observed.status, 200);
    assert.equal(likeForLike.status, 200);
    // The cached entry of one mode is never served for the other mode.
    assert.equal(observed.body.mode, 'observed');
    assert.equal(likeForLike.body.mode, 'like_for_like');
    assert.notEqual(observed.body.results.b.observed['2005'].members, likeForLike.body.results.b.likeForLike['2005'].members);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// THE VERIFIED CHART SERIES
// ---------------------------------------------------------------------------

test('compare API: the chart series is built from the stored observations of the response', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&operation=level');
    assert.equal(res.status, 200);
    const series = res.body.results.a.series;
    assert.equal(series.basis, 'ENTITY_OWN_OBSERVATION');
    assert.deepEqual(series.points.map((p) => p.year), [2004, 2005]);
    assert.equal(series.points[0].value, 721e9);
    assert.equal(series.points[1].value, 834e9);
    // A group series is emitted only where the group is complete.
    const group = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,BRA&indicator=total_current&yearA=2004&yearB=2005&operation=level');
    const groupSeries = group.body.results.b.series;
    assert.deepEqual(groupSeries.points.map((p) => p.year), [2004, 2005]);
    assert.equal(groupSeries.points[0].value, 1955e9 + 800e9);
    assert.equal(groupSeries.points[1].value, null, 'an incomplete year is a gap, never a partial number');
    assert.deepEqual(groupSeries.partialYears, [2005]);
  } finally {
    await close();
  }
});

test('compare API: Movement bases select their registered source legs and calculate six approved formulas', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  const query = (indicator, basis, years = 'yearA=2004&yearC=2006') =>
    `/api/compare?entityA=country:IND&entityB=country:CHN&indicator=${indicator}&basis=${basis}&${years}&operation=level`;
  try {
    const cases = [
      ['current_account', 'ca_annual_gdp', ['current_account', 'total_current'], (body) => {
        assert.equal(body.results.comparison.intervalResults[0].a.value, 30);
        assert.equal(body.results.comparison.intervalResults[0].b.value, 20);
      }],
      ['current_account', 'ca_average_gdp', ['current_account', 'total_current'], (body) => {
        assert.equal(body.results.comparison.intervalResults[0].a.value, 25);
      }],
      ['current_account', 'ca_cumulative_share', ['current_account', 'total_current'], (body) => {
        assert.ok(Math.abs(body.results.comparison.intervalResults[0].a.value - ((166.8e9 + 282e9) / (834e9 + 940e9) * 100)) < 1e-12);
      }],
      ['fdi_inflows_pct_gdp', 'fdigdp_period_cumulative_share', ['fdi_inflows', 'total_current'], (body) => {
        assert.ok(Math.abs(body.results.comparison.intervalResults[0].a.value - (20e9 / (834e9 + 940e9) * 100)) < 1e-12);
      }],
      ['reserves_ex_gold', 'res_import_coverage', ['reserves_ex_gold', 'imports_current'], (body) => {
        assert.equal(body.results.comparison.intervalResults[0].a.value, 6);
      }],
      ['remittances_received', 'remit_cumulative_intensity', ['remittances_received', 'total_current'], (body) => {
        assert.ok(Math.abs(body.results.comparison.intervalResults[0].a.value - (40e9 / (834e9 + 940e9) * 100)) < 1e-12);
      }],
    ];
    for (const [indicator, basis, expectedLegs, check] of cases) {
      const res = await getJSON(base, query(indicator, basis));
      assert.equal(res.status, 200, `${indicator} / ${basis}`);
      assert.equal(res.body.basis, basis);
      assert.deepEqual(res.body.sourceSeries.map((leg) => leg.metricKey), expectedLegs);
      assert.ok(res.body.sourceSeries.every((leg) => leg.indicatorCode), 'source codes are disclosed');
      assert.equal(res.body.analysis.basisMethod.id, basis);
      check(res.body);
    }
  } finally {
    await close();
  }
});

test('compare API: a selected Movement basis validates independent analysis and group mode inputs', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const invalid = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=current_account&basis=ca_cumulative_share&yearA=2004&yearC=2006&operation=pp_change');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'UNSUPPORTED_TRANSFORMATION');
    const groupObserved = await getJSON(base, '/api/compare?entityA=group:IND,CHN&entityB=country:USA&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearC=2006&operation=level&groupMode=observed');
    const groupLfl = await getJSON(base, '/api/compare?entityA=group:IND,CHN&entityB=country:USA&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearC=2006&operation=level&groupMode=like_for_like');
    assert.equal(groupObserved.body.results.a.values['2006'].value, (282e9 + 540e9) / (940e9 + 2700e9) * 100);
    assert.equal(groupLfl.body.mode, 'like_for_like');
    assert.notEqual(groupObserved.body.results.a.values['2006'].value, null);
    assert.notEqual(groupLfl.body.results.a.values['2006'].value, null);
    const changedAnalysis = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearC=2006&operation=pp_change');
    assert.equal(changedAnalysis.status, 200, JSON.stringify(changedAnalysis.body));
    assert.equal(changedAnalysis.body.metric.key, 'current_account');
    assert.equal(changedAnalysis.body.basis, 'ca_annual_gdp');
    assert.equal(changedAnalysis.body.results.comparison.intervalResults[0].a.value, 20);
    assert.equal(changedAnalysis.body.results.comparison.intervalResults[0].gap.unit, 'percentage points');
  } finally {
    await close();
  }
});

test('compare API: Movement bases calculate AB, BC and AC from their own interval source rows and enforce common legs', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const three = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearB=2005&yearC=2006&operation=pp_change');
    assert.equal(three.status, 200);
    const intervals = three.body.results.comparison.intervalResults;
    assert.deepEqual(intervals.map((interval) => interval.id), ['AB', 'BC', 'AC']);
    assert.deepEqual(intervals.map((interval) => interval.a.value), [10, 10, 20]);
    assert.deepEqual(intervals.map((interval) => interval.b.value), [0, 10, 10]);
    assert.equal(intervals[0].gap.value, 10);
    assert.equal(intervals[1].gap.value, 0);
    assert.equal(intervals[2].gap.value, 10);
    assert.deepEqual(intervals[0].observations.a[0].sourceValues.current_account.map((row) => row.value), [72.1e9]);
    const observed = await getJSON(base, '/api/compare?entityA=group:IND,IDN&entityB=country:USA&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearC=2006&operation=level&groupMode=observed');
    const common = await getJSON(base, '/api/compare?entityA=group:IND,IDN&entityB=country:USA&indicator=current_account&basis=ca_annual_gdp&yearA=2004&yearC=2006&operation=level&groupMode=like_for_like');
    assert.equal(observed.body.results.a.values['2006'].available, false);
    assert.equal(common.body.results.a.values['2006'].available, true);
    assert.deepEqual(common.body.results.a.coverage.excludedMembers, ['IDN']);
  } finally {
    await close();
  }
});

test('compare API: coverage discovery — every registered Movement basis is implemented or explicitly excluded', async () => {
  const { db } = await seedCompareDb();
  const { base, close } = await startApp(db);
  try {
    const { basesForMetric: pricesBasesForMetric } = await import('../src/domain/pricesMovement.js');
    const { tradeBasesForMetric } = await import('../src/domain/tradeMovement.js');
    const { capitalBasesForMetric } = await import('../src/domain/capitalMovement.js');
    const { externalBasesForMetric } = await import('../src/domain/externalMovement.js');
    const { fxBasesForMetric } = await import('../src/domain/fxMovement.js');
    const { populationBasesForMetric } = await import('../src/domain/populationMovement.js');
    const { compareAnalysesForBasis } = await import('../src/services/compareMovementBasis.js');
    const { METRICS } = await import('../src/config.js');

    const basesByMetric = new Map();
    for (const metricKey of Object.keys(METRICS)) {
      const bases = [
        ...pricesBasesForMetric(metricKey),
        ...tradeBasesForMetric(metricKey),
        ...capitalBasesForMetric(metricKey),
        ...externalBasesForMetric(metricKey),
        ...fxBasesForMetric(metricKey),
        ...populationBasesForMetric(metricKey),
      ];
      if (bases.length > 0) basesByMetric.set(metricKey, bases);
    }

    let total = 0;
    let accepted = 0;
    let explicitlyExcluded = 0;
    const exclusions = [];
    for (const [metricKey, bases] of basesByMetric) {
      for (const basis of bases) {
        total += 1;
        const validAnalyses = compareAnalysesForBasis(basis) ?? [];
        const analysis = validAnalyses[0] ?? 'level';
        const res = await getJSON(
          base,
          `/api/compare?entityA=country:IND&entityB=country:CHN&indicator=${metricKey}&basis=${basis}&yearA=2004&yearC=2006&operation=${analysis}`,
        );
        if (res.status === 200) {
          accepted += 1;
        } else if (res.status === 400) {
          explicitlyExcluded += 1;
          exclusions.push(`${metricKey}/${basis}: ${res.body.error.code}`);
        } else {
          throw new Error(`Unexpected status ${res.status} for ${metricKey}/${basis}`);
        }
      }
    }

    const specialized = [
      ['current_account', 'ca_annual_gdp'],
      ['current_account', 'ca_average_gdp'],
      ['current_account', 'ca_cumulative_share'],
      ['fdi_inflows_pct_gdp', 'fdigdp_period_cumulative_share'],
      ['reserves_ex_gold', 'res_import_coverage'],
      ['remittances_received', 'remit_cumulative_intensity'],
    ];
    for (const [mk, bs] of specialized) {
      const res = await getJSON(
        base,
        `/api/compare?entityA=country:IND&entityB=country:CHN&indicator=${mk}&basis=${bs}&yearA=2004&yearC=2006&operation=level`,
      );
      assert.equal(res.status, 200, `${mk}/${bs} should be accepted`);
    }

    // eslint-disable-next-line no-console
    console.log(`Compare coverage: ${accepted}/${total} bases accepted, ${explicitlyExcluded} explicitly excluded`);
    for (const exclusion of exclusions) {
      // eslint-disable-next-line no-console
      console.log(`  excluded: ${exclusion}`);
    }
  } finally {
    await close();
  }
});