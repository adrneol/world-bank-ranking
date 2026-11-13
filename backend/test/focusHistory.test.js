import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb } from '../src/db/index.js';
import { buildFocusHistory } from '../src/services/focusHistory.js';
import { buildIndiaYearlyRows } from '../src/services/indiaYearly.js';
import { seedConfiguredDatabase } from './helpers/configuredDb.js';

let db;
test.before(async () => { db = await seedConfiguredDatabase(); });
test.after(closeDb);

test('bounded history returns the same published values and existing backend YoY', async () => {
  const result = await buildFocusHistory(db, { country: 'IND', series: ['real_gdp_growth', 'total_constant', 'total_constant'], startYear: 2024, endYear: 2025 });
  const old = await buildIndiaYearlyRows(db, { focusIso3: 'IND', subject: 'gdp_total', startYear: 2024, endYear: 2025 });
  assert.equal(result.source, 'World Bank WDI');
  assert.equal(result.series.length, 2);
  const levels = result.series.find((series) => series.id === 'total_constant');
  const growth = result.series.find((series) => series.derived);
  assert.equal(levels.indicatorCode, 'NY.GDP.MKTP.KD');
  assert.equal(growth.indicatorCode, levels.indicatorCode);
  assert.deepEqual(levels.points.map((point) => point.value), old.rows.map((row) => row.total_constant.indiaValue));
  assert.deepEqual(levels.points.map((point) => point.raw), old.rows.map((row) => row.total_constant.indiaValueRaw));
  assert.deepEqual(growth.points.map((point) => point.value), old.rows.map((row) => row.total_constant.indiaYoY));
  assert.ok(Number.isFinite(growth.points[0].value), 'the first display year uses its predecessor');
});

test('missing years remain in the window, zero survives, and database handles do not share history', async () => {
  const { createMemoryDb } = await import('../src/db/index.js');
  const fallback = await createMemoryDb();
  const args = { country: 'IND', series: ['nominal_current'], startYear: 2023, endYear: 2025 };
  try {
    await fallback.executeMultiple(
      "INSERT INTO countries (id,name,updated_at) VALUES ('IND','India','2026-01-01');" +
      "INSERT INTO indicators (id,code,metric_key,updated_at) VALUES (1,'NY.GDP.PCAP.CD','nominal_current','2026-01-01');" +
      "INSERT INTO observations (country_id,indicator_id,year,value,value_raw,wb_last_updated,fetched_at) VALUES ('IND',1,2024,0,'0','2026-07-13','2026-08-01');",
    );
    const primary = await buildFocusHistory(db, args);
    const isolated = await buildFocusHistory(fallback, args);
    assert.notDeepEqual(isolated.series, primary.series);
    assert.deepEqual(isolated.series[0].points.map((point) => [point.year, point.value]), [[2023, null], [2024, 0], [2025, null]]);
    assert.equal(isolated.series[0].points[1].vintage, '2026-07-13');
  } finally { fallback.close(); }
});

test('rejects unsupported entities, ranges and unregistered series', async () => {
  const args = { country: 'IND', series: ['nominal_current'], startYear: 2024, endYear: 2025 };
  for (const [overrides, code] of [
    [{ country: 'WLD' }, 'INVALID_COUNTRY'],
    [{ country: 'ZZZ' }, 'INVALID_COUNTRY'],
    [{ startYear: 2025, endYear: 2024 }, 'INVALID_RANGE'],
    [{ startYear: '2024x' }, 'INVALID_RANGE'],
    [{ series: ['__proto__'] }, 'INVALID_INDICATOR'],
  ]) {
    await assert.rejects(buildFocusHistory(db, { ...args, ...overrides }), { code });
  }
});

test('Compare level trajectories preserve both backend entity identities in every supported orientation', async () => {
  const { buildCompareResponse } = await import('../src/services/entityCompare.js');
  const entities = ['country:IND', 'group:IND,USA', 'aggregate:WLD'];
  // Total GDP fixtures do not publish WLD, so seed the existing official
  // aggregate in this disposable test only, with clearly synthetic values.
  const { getIndicatorByMetricKey, upsertObservations } = await import('../src/db/repository.js');
  const indicator = await getIndicatorByMetricKey(db, 'total_current');
  await upsertObservations(db, [2024, 2025].map((year) => ({ countryId: 'WLD', indicatorId: indicator.id, year, value: 1e14 })));
  for (const [i, entityA] of entities.entries()) {
    for (const [j, entityB] of entities.entries()) {
      const response = await buildCompareResponse(db, {
        entityA, entityB: i === j && j === 1 ? 'group:DEU,PAK' : entityB,
        metricKey: 'total_current', yearA: 2024, yearC: 2025, operation: 'level', groupMode: 'observed',
      });
      assert.equal(response.available, true);
      const { a, b } = response.results;
      assert.deepEqual(a.series.points.map((point) => point.year), [2024, 2025]);
      assert.deepEqual(b.series.points.map((point) => point.year), [2024, 2025]);
      assert.equal(a.kind, ['country', 'custom_group', 'wb_aggregate'][i]);
      assert.equal(b.kind, ['country', 'custom_group', 'wb_aggregate'][j]);
      for (const point of [...a.series.points, ...b.series.points]) {
        if (point.value != null) assert.equal(Number(point.valueRaw), point.value);
      }
      if (j === 2) assert.deepEqual(b.series.points.map((point) => point.value), [1e14, 1e14]);
    }
  }
});
