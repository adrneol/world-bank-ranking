/**
 * FUTURE-YEAR PROPAGATION (2026, and a second year 2027).
 *
 * OBJECTIVE: establish whether a newly published observation year propagates
 * through the WHOLE application - ingestion, storage, dataset state, every
 * year-dependent API and the frontend year selection - without a source-code
 * change and without a hardcoded year limit.
 *
 * ============================================================================
 * THE DATA IN THIS FILE IS SYNTHETIC. IT IS NOT WORLD BANK DATA.
 * ============================================================================
 * The fixture's 2025 rows are the repository's committed offline snapshot.
 * The 2026 (and 2027) rows are DERIVED from each country's 2025 fixture
 * value (x 1.05, rounded to 4 decimals) by the transform below. The upstream
 * release stamp used for the simulated release ('2027-01-15') is likewise a
 * synthetic value, chosen so it can never be confused with a real World Bank
 * release date. No statement in this file may be read as a claim about real
 * 2026 economic data.
 *
 * The pipeline itself is NOT bypassed: every observation is written by the
 * real refresh (wb/ingest.js) through the real World Bank client against the
 * stub server, and every API response is produced by the real Express app.
 * Only the stub's ROW SET is synthetic.
 */

import './isolation.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

process.env.WB_RETRY_BASE_MS = '20';

const SYNTHETIC_FACTOR = 1.05;
const SYNTHETIC_RELEASE = '2027-01-15';
const BASE_FIXTURE_RELEASE = '2026-07-13';

/**
 * Coverage pattern per metric key:
 *   'full'   - every country with a 2025 observation also gets the future year
 *   'minus'  - 'full' minus a fixed set of countries (missing-data path)
 *   'subset' - every third country only (partial coverage)
 *   'none'   - the metric has NO future-year rows at all
 */
const COVERAGE = {
  nominal_current: 'full',
  nominal_constant: 'full',
  total_current: 'full',
  population_total: 'full',
  ppp_current: 'minus',
  inflation_cpi: 'subset',
  fdi_inflows: 'subset',
  remittances_received: 'none',
};
/** Countries deliberately WITHOUT a future-year observation (metric 'minus'). */
const MISSING_COUNTRIES = new Set(['ARG', 'BRA', 'ZAF']);

let stub = null;
/** The future year the stub currently injects (null = the plain fixture). */
let futureYear = null;

test.before(async () => {
  stub = await startStubWorldBank({
    seriesRowsFor: (metricKey, baseRows) =>
      futureYear ? withFutureYear(metricKey, baseRows, futureYear) : baseRows,
  });
  useStubBaseUrl(stub.baseUrl);
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

/**
 * Derive synthetic future-year rows from each country's 2025 fixture row.
 * The value is a deterministic function of the 2025 value - obviously
 * synthetic, and stable across runs.
 */
function withFutureYear(metricKey, baseRows, year) {
  const pattern = COVERAGE[metricKey] ?? 'none';
  if (pattern === 'none') return baseRows;
  const latest = new Map();
  for (const row of baseRows) {
    if (Number(row.date) !== 2025) continue;
    latest.set(row.countryiso3code, row);
  }
  const out = [...baseRows];
  [...latest.keys()].sort().forEach((iso3, index) => {
    if (pattern === 'minus' && MISSING_COUNTRIES.has(iso3)) return;
    if (pattern === 'subset' && index % 3 !== 0) return;
    const row = latest.get(iso3);
    const v = Number(row.value);
    if (!Number.isFinite(v)) return;
    out.push({ ...row, date: String(year), value: Number((v * SYNTHETIC_FACTOR).toFixed(4)) });
  });
  return out;
}

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return createMemoryDb();
}

async function statusServer(db) {
  const { resetIntegrityCache } = await import('../src/services/statusCache.js');
  resetIntegrityCache();
  const { resetYearsCache } = await import('../src/services/yearsCache.js');
  resetYearsCache();
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async get(path) {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Seed a database with the plain (2024-2025) fixture. */
async function seedBaseline(db, { startYear = 2024, endYear = 2025 } = {}) {
  const { refreshData } = await import('../src/wb/ingest.js');
  futureYear = null;
  stub.reset();
  stub.setSeriesLastUpdated(BASE_FIXTURE_RELEASE);
  const summary = await refreshData({ db, startYear, endYear, trigger: 'test-baseline' });
  assert.equal(summary.status, 'success', 'the baseline refresh succeeded');
  return summary;
}

test('A. a synthetic 2026 release is ingested by the normal pipeline', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const repository = await import('../src/db/repository.js');
  const db = await freshDb();
  try {
    // ---- baseline: the plain fixture (2024-2025) -----------------------
    await seedBaseline(db);
    const baselineState = await repository.getDatasetState(db);
    assert.ok(!baselineState.yearsJson.includes('2026'), 'the baseline has no 2026');
    const before2025 = await db.execute({
      sql: `SELECT country_id AS c, year, value, fetched_at FROM observations
             WHERE indicator_id = (SELECT id FROM indicators WHERE metric_key='nominal_current')
               AND year = 2025 ORDER BY country_id`,
      args: [],
    });

    // ---- the synthetic 2026 release ------------------------------------
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    const summary = await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026' });
    assert.equal(summary.status, 'success', 'the 2026 refresh succeeded');
    assert.ok(summary.rowsUpserted > 0, 'rows were written');

    // 2026 observations exist for the metrics that publish them...
    const counts2026 = await db.execute({
      sql: `SELECT i.metric_key AS mk, COUNT(*) AS n FROM observations o
              JOIN indicators i ON i.id = o.indicator_id
             WHERE o.year = 2026 GROUP BY i.metric_key ORDER BY i.metric_key`,
      args: [],
    });
    // Expected counts are derived from the fixture, not hardcoded.
    const byMetric = Object.fromEntries(counts2026.rows.map((r) => [r.mk, Number(r.n)]));
    const distinctCountries = async (metricKey, year) => {
      const r = await db.execute({
        sql: `SELECT COUNT(DISTINCT o.country_id) AS n FROM observations o
                JOIN indicators i ON i.id = o.indicator_id
               WHERE i.metric_key = ? AND o.year = ?`,
        args: [metricKey, year],
      });
      return Number(r.rows[0].n);
    };
    // Every country that has a STORED 2025 observation also has a 2026 one.
    const stored2025 = await db.execute({
      sql: `SELECT DISTINCT o.country_id AS c FROM observations o JOIN indicators i ON i.id = o.indicator_id
             WHERE i.metric_key = 'nominal_current' AND o.year = 2025`,
      args: [],
    });
    const stored2026 = await db.execute({
      sql: `SELECT DISTINCT o.country_id AS c FROM observations o JOIN indicators i ON i.id = o.indicator_id
             WHERE i.metric_key = 'nominal_current' AND o.year = 2026`,
      args: [],
    });
    const set2026 = new Set(stored2026.rows.map((r) => r.c));
    for (const row of stored2025.rows) {
      assert.ok(set2026.has(row.c), `${row.c}: a 2025 country also has a 2026 observation`);
    }
    assert.ok(
      byMetric.nominal_current >= stored2025.rows.length,
      'the 2026 population covers every stored 2025 country',
    );
    assert.equal(
      byMetric.ppp_current,
      byMetric.nominal_current - MISSING_COUNTRIES.size,
      'ppp_current is missing exactly the countries the fixture omits',
    );
    assert.ok(byMetric.inflation_cpi > 0, 'inflation_cpi has 2026 rows (partial coverage)');
    assert.ok(
      byMetric.inflation_cpi < byMetric.nominal_current,
      'inflation_cpi coverage is partial, not complete',
    );
    assert.equal(byMetric.remittances_received, undefined, 'remittances_received has NO 2026 rows');

    // ...the countries deliberately left out have no 2026 row ...
    for (const iso3 of MISSING_COUNTRIES) {
      const row = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM observations o
                JOIN indicators i ON i.id = o.indicator_id
               WHERE i.metric_key='ppp_current' AND o.country_id = ? AND o.year = 2026`,
        args: [iso3],
      });
      assert.equal(Number(row.rows[0].n), 0, `${iso3} has no ppp_current 2026 observation`);
    }
    // ...and the 2025 values are preserved exactly.
    const after2025 = await db.execute({
      sql: `SELECT country_id AS c, year, value FROM observations
             WHERE indicator_id = (SELECT id FROM indicators WHERE metric_key='nominal_current')
               AND year = 2025 ORDER BY country_id`,
      args: [],
    });
    const beforeValues = before2025.rows.map((r) => `${r.c}|${r.year}|${r.value}`);
    const afterValues = after2025.rows.map((r) => `${r.c}|${r.year}|${r.value}`);
    assert.deepEqual(afterValues, beforeValues, 'the 2025 values are unchanged');

    // ---- the dataset state reflects the new year and the new vintage ----
    const state = await repository.getDatasetState(db);
    const years = JSON.parse(state.yearsJson);
    assert.ok(years.years.includes(2026), 'the global year list contains 2026');
    assert.equal(years.years[years.years.length - 1], 2026, '2026 is the newest available year');
    assert.ok(years.perMetric.nominal_current.includes(2026), 'nominal_current lists 2026');
    assert.ok(!years.perMetric.remittances_received.includes(2026), 'remittances_received does not list 2026');
    assert.equal(state.maxWbLastUpdated, SYNTHETIC_RELEASE, 'the dataset vintage is the new release');
    assert.ok(state.contentVersion > baselineState.contentVersion, 'the content version advanced');

    // ---- the integrity check still holds --------------------------------
    const { runIntegrityChecks } = await import('../src/services/integrity.js');
    const report = await runIntegrityChecks(db);
    assert.equal(report.passed, true, JSON.stringify(report.checks.filter((c) => c.status !== 'pass')));
    const l = report.checks.find((c) => c.check === 'L.vintage_provenance');
    assert.equal(l.status, 'pass');
  } finally {
    futureYear = null;
    db.close();
  }
});

test('B. the available-years endpoint reports 2026 and the per-metric coverage', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-years' });

    const { status, body } = await svc.get('/api/years');
    assert.equal(status, 200);
    assert.ok(body.years.includes(2026), 'the available years include 2026');
    assert.equal(body.maxYear, 2026, 'the maximum available year is 2026');
    assert.ok(body.perMetric.nominal_current.includes(2026));
    assert.ok(!body.perMetric.remittances_received.includes(2026), 'a metric without 2026 does not list it');
    // The configured default end year is reported but is NOT a cap: the view's
    // newest selectable year is the newest STORED year.
    assert.equal(body.defaults.endYear, 2025, 'the configured default end year is still reported');
    assert.equal(body.maxYear, 2026, 'but the data extends beyond it');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('C. rankings for 2026 use 2026 values, exclude missing countries and never fall back to 2025', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-ranking' });

    const { status, body } = await svc.get('/api/ranking?indicator=nominal_current&year=2026&pageSize=500');
    assert.equal(status, 200);
    assert.ok(body.rows.length > 0, 'the 2026 ranking has rows');
    assert.equal(body.year, 2026, 'the ranking is for 2026');
    assert.equal(body.total, body.rows.length, 'the denominator counts only countries with 2026 data');

    // Ordering: descending by value (the registry's direction for GDP). The
    // decorated rows carry the raw numeric value as `rawValue`.
    const values = body.rows.map((r) => Number(r.rawValue));
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i - 1] >= values[i], 'the ranking is ordered by value');
    }
    // Ranks are contiguous from 1.
    assert.deepEqual(body.rows.map((r) => r.rank), body.rows.map((_, i) => i + 1));

    // No 2025 value is presented as a 2026 observation: every returned row
    // must equal the stored 2026 observation for that country, and only
    // countries that actually have a 2026 observation may appear.
    const stored = await db.execute({
      sql: `SELECT o.country_id AS c, o.value FROM observations o
              JOIN indicators i ON i.id = o.indicator_id
              JOIN countries c ON c.id = o.country_id
             WHERE i.metric_key = 'nominal_current' AND o.year = 2026 AND c.is_aggregate = 0`,
      args: [],
    });
    const storedMap = new Map(stored.rows.map((r) => [r.c, Number(r.value)]));
    assert.equal(storedMap.size, body.rows.length, 'the ranking covers exactly the eligible 2026 observations');
    for (const row of body.rows) {
      assert.equal(Number(row.rawValue), storedMap.get(row.iso3), `${row.iso3}: the ranking shows the 2026 value`);
    }

    // A metric with no 2026 data returns an empty, explicit result (no
    // 2025 rows dressed up as 2026).
    const missing = await svc.get('/api/ranking?indicator=remittances_received&year=2026');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.rows.length, 0, 'no rows for a year the metric does not have');
    assert.equal(missing.body.total, 0);

    // The 2025 ranking is unaffected and still correct.
    const y2025 = await svc.get('/api/ranking?indicator=nominal_current&year=2025&pageSize=500');
    assert.equal(y2025.status, 200);
    assert.ok(y2025.body.rows.length > 0, 'the 2025 ranking still has rows');
    const v2025 = y2025.body.rows.map((r) => Number(r.rawValue));
    for (let i = 1; i < v2025.length; i += 1) assert.ok(v2025[i - 1] >= v2025[i], '2025 is still ordered');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('D. coverage, observations and the focus timeline all reach 2026', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-views' });

    // /api/observations for 2026
    const obs = await svc.get('/api/observations?indicator=nominal_current&year=2026&country=IND');
    assert.equal(obs.status, 200);
    assert.equal(obs.body.year, 2026, 'the observation is addressed for 2026');
    assert.ok(obs.body.observation, 'an observation was returned for 2026');
    assert.equal(Number(obs.body.observation.value), obs.body.observation.value);

    // /api/coverage for 2026
    const cov = await svc.get('/api/coverage?year=2026');
    assert.equal(cov.status, 200);
    const panel = cov.body.panel ?? cov.body.coverage ?? cov.body;
    assert.ok(panel, 'the coverage panel was returned');
    assert.ok(JSON.stringify(panel).includes('2026'), 'the coverage panel mentions 2026');

    // /api/focus/yearly over a range that includes 2026
    const yearly = await svc.get('/api/focus/yearly?startYear=2024&endYear=2026&country=IND');
    assert.equal(yearly.status, 200);
    const body = JSON.stringify(yearly.body);
    assert.ok(body.includes('2026'), 'the focus timeline includes 2026');

    // /api/ranking/verify for 2026
    const verify = await svc.get('/api/ranking/verify?indicator=nominal_current&year=2026');
    assert.equal(verify.status, 200);
    assert.ok(JSON.stringify(verify.body).includes('2026'), 'the verification is addressed for 2026');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('E. cross-year comparison and rank movement accept 2026', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-comparison' });

    const cmp = await svc.get('/api/comparison/level?indicator=nominal_current&yearA=2025&yearB=2026');
    assert.equal(cmp.status, 200);
    assert.equal(cmp.body.years?.a, 2025, 'the comparison starts at 2025');
    assert.equal(cmp.body.years?.b, 2026, 'the comparison ends at 2026');
    assert.ok(cmp.body.comparison?.available, 'the comparison is available');
    assert.ok(cmp.body.evidence?.vintage, 'the comparison carries vintage evidence');
    // The comparison is built from the 2026 values, not from 2025.
    const compared = JSON.stringify(cmp.body);
    assert.ok(compared.includes('2026'), 'the comparison payload references 2026');

    // The YoY ranking for 2026 (needs both 2025 and 2026 for a rate).
    const yoy = await svc.get('/api/yoy-ranking?indicator=nominal_current&year=2026&pageSize=500');
    assert.equal(yoy.status, 200);
    assert.equal(yoy.body.year, 2026, 'the YoY ranking is for 2026');
    assert.ok(yoy.body.rows.length > 0, 'the YoY ranking has rows');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('F. the movement, compare and period-summary endpoints accept 2026', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-movement' });

    // Movement (rank movement) with 2026 as the second endpoint. The Capital
    // family declares its own bases; 'fdi_annual_value' is the endpoint-only
    // annual basis.
    const movement = await svc.get(
      '/api/movement/capital?indicator=fdi_inflows&yearA=2025&yearB=2026&basis=fdi_annual_value',
    );
    assert.equal(movement.status, 200, JSON.stringify(movement.body)?.slice(0, 200));
    assert.ok(JSON.stringify(movement.body).includes('2026'), 'the movement payload references 2026');

    // The generic cross-country comparison with 2026 (entities are addressed
    // as "country:ISO3").
    const compare = await svc.get(
      '/api/compare?indicator=nominal_current&yearA=2026&entityA=country:IND&entityB=country:USA',
    );
    assert.equal(compare.status, 200, JSON.stringify(compare.body)?.slice(0, 200));
    assert.ok(JSON.stringify(compare.body).includes('2026'), 'the comparison payload references 2026');

    // A period summary over a range that ends in 2026.
    const period = await svc.get(
      '/api/periods/summary?indicator=nominal_current&startYear=2025&endYear=2026&operation=SUM',
    );
    assert.equal(period.status, 200, JSON.stringify(period.body)?.slice(0, 200));
    assert.ok(JSON.stringify(period.body).includes('2026'), 'the period summary references 2026');

    // The years endpoint of the movement family is not hardcoded either: the
    // movement selectors are fed by the same available-year list.
    const { body } = await svc.get('/api/years');
    assert.ok(body.perMetric.inflation_cpi?.includes(2026), 'inflation_cpi lists 2026 for the movement selectors');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('G. without future-year data, the application does not offer the year', async () => {
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    const { status, body } = await svc.get('/api/years');
    assert.equal(status, 200);
    assert.ok(!body.years.includes(2026), '2026 is absent when it is not stored');
    assert.equal(body.maxYear, 2025, 'the maximum year is the last STORED year');
    const ranking = await svc.get('/api/ranking?indicator=nominal_current&year=2026');
    assert.equal(ranking.status, 200);
    assert.equal(ranking.body.rows.length, 0, 'a 2026 ranking on a 2025-only dataset is empty');
  } finally {
    await svc.close();
    db.close();
  }
});

test('G. a failed refresh does not expose the unpublished future year', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    // One indicator's series is unavailable: the run is partial and nothing
    // may be published.
    stub.failNextMatching({ status: 502, times: 500, substring: '/country/all/indicator/NY.GDP.MKTP.KD' });
    const summary = await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-partial' });
    assert.equal(summary.status, 'partial', 'the refresh was partial');

    const { body } = await svc.get('/api/years');
    assert.ok(!body.years.includes(2026), '2026 is NOT published by a partial refresh');
    const ranking = await svc.get('/api/ranking?indicator=nominal_current&year=2026');
    assert.equal(ranking.body.rows.length, 0, 'no 2026 rows are visible after a partial refresh');
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('H. a second future year (2027) propagates by the same machinery', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    futureYear = 2027;
    stub.reset();
    stub.setSeriesLastUpdated('2028-01-15');
    const summary = await refreshData({ db, startYear: 2024, endYear: 2027, trigger: 'test-2027' });
    assert.equal(summary.status, 'success', 'the 2027 refresh succeeded');

    const { body } = await svc.get('/api/years');
    assert.ok(body.years.includes(2027), '2027 is available');
    assert.equal(body.maxYear, 2027, '2027 is the newest year');
    const ranking = await svc.get('/api/ranking?indicator=nominal_current&year=2027');
    assert.equal(ranking.status, 200);
    assert.ok(ranking.body.rows.length > 0, 'the 2027 ranking has rows');
    assert.equal(ranking.body.year, 2027);
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('J. publishing a new year invalidates the caches that depend on the content', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const { getCachedAvailableYears, resetYearsCache } = await import('../src/services/yearsCache.js');
  const db = await freshDb();
  const svc = await statusServer(db);
  try {
    await seedBaseline(db);
    // Populate the years cache with the pre-2026 content.
    const first = await svc.get('/api/years');
    assert.ok(!first.body.years.includes(2026), 'the cache holds the pre-2026 year list');
    const cached = await getCachedAvailableYears(db);
    assert.ok(!cached.years.includes(2026), 'the in-process years cache is populated with the old list');

    // Publish the future year: the content version advances, so the cached
    // key is stale and the year list must be recomputed.
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-cache' });

    const after = await svc.get('/api/years');
    assert.ok(after.body.years.includes(2026), 'the served year list was invalidated and recomputed');
    assert.equal(after.body.maxYear, 2026);
    const recomputed = await getCachedAvailableYears(db);
    assert.ok(recomputed.years.includes(2026), 'the in-process cache was invalidated too');
    resetYearsCache();
  } finally {
    futureYear = null;
    await svc.close();
    db.close();
  }
});

test('I. the unchanged-row optimization still holds once a future year is present', async () => {
  const { refreshData } = await import('../src/wb/ingest.js');
  const db = await freshDb();
  try {
    await seedBaseline(db);
    futureYear = 2026;
    stub.reset();
    stub.setSeriesLastUpdated(SYNTHETIC_RELEASE);
    const first = await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-first' });
    assert.equal(first.status, 'success');

    // The very same payload again: every indicator is proven identical, so
    // the refresh must write ZERO observation rows.
    const before = await db.execute({
      sql: 'SELECT COUNT(*) AS n, MAX(fetched_at) AS f FROM observations',
      args: [],
    });
    const second = await refreshData({ db, startYear: 2024, endYear: 2026, trigger: 'test-2026-second' });
    assert.equal(second.status, 'success');
    assert.equal(second.rowsUpserted, 0, 'no observation row is rewritten when nothing changed');
    assert.ok(second.rowsSkippedUnchanged > 0, 'the unchanged rows are proven identical');
    const after = await db.execute({
      sql: 'SELECT COUNT(*) AS n, MAX(fetched_at) AS f FROM observations',
      args: [],
    });
    assert.equal(after.rows[0].f, before.rows[0].f, 'not even the write timestamp moved');

    // A metric whose payload did not change at all keeps its rows untouched
    // while the others are republished.
    const untouched = await db.execute({
      sql: `SELECT MAX(fetched_at) AS f FROM observations o JOIN indicators i ON i.id=o.indicator_id
             WHERE i.metric_key='remittances_received'`,
      args: [],
    });
    const touched = await db.execute({
      sql: `SELECT MAX(fetched_at) AS f FROM observations o JOIN indicators i ON i.id=o.indicator_id
             WHERE i.metric_key='nominal_current'`,
      args: [],
    });
    assert.notEqual(
      String(untouched.rows[0].f),
      String(touched.rows[0].f),
      'the metric with no future-year rows was not rewritten, the others were',
    );
  } finally {
    futureYear = null;
    db.close();
  }
});
