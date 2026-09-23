/**
 * TOTAL GDP TESTS (level ranking, YoY, comparison, API, guards).
 *
 * The Total GDP subject must flow through the SAME generic engines as GDP per
 * capita (domain/ranking, domain/yoy, domain/comparison, ...) with no
 * Total-GDP-specific calculation code. These tests prove that at Total GDP
 * magnitudes (~1e12–1e13):
 *
 *   - ranking order, ISO3 tie-breaks, denominators and missing-data rules hold
 *   - YoY percentages use raw values; non-positive bases stay null
 *   - like-for-like / entered / exited / outside universes are computed on the
 *     Total GDP series independently of the per-capita series
 *   - the HTTP API serves the four total_* metrics and rejects everything else
 *   - the GDP-growth percentage series can never enter the level/YoY system
 *
 * Subjects are never compared numerically against each other: every assertion
 * below stays inside one subject.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { rankByValue } from '../src/domain/ranking.js';
import { computeYoy } from '../src/domain/yoy.js';
import { buildYoyRows, rankByYoy } from '../src/domain/yoyRanking.js';
import { buildLevelComparison } from '../src/domain/comparison.js';
import { createMemoryTestDb } from './helpers/testDb.js';
import { liveIndia2025 } from './fixtures/totalGdp.js';

// ---------------------------------------------------------------------------
// Synthetic Total-GDP-scale rows (trillions). IND 2025 anchors on the
// live-verified World Bank value; every other number is synthetic.
// ---------------------------------------------------------------------------

const T = 1e12;
const IND_2025 = liveIndia2025('total_current'); // 3956067115771.63

const row = (iso3, value) => ({ iso3, name: iso3, value, valueRaw: String(value) });

test('ranking at Total GDP scale: value DESC, ISO3 ASC ties, null-safe denominator', async () => {
  const rows = [
    row('USA', 28.18 * T),
    row('DEU', 4.55 * T),
    row('FRA', 4.55 * T), // exact tie with DEU -> ISO3 order decides
    row('IND', IND_2025),
    row('PAK', 0.34 * T),
    row('XKX', null), // missing data is absent, never zero
    { iso3: 'ZZZ', name: 'ZZZ', value: Number.NaN }, // non-finite excluded
    { iso3: null, name: '?', value: 99 * T }, // no ISO3: never ranked
  ];
  const { ranked, total } = rankByValue(rows);
  assert.equal(total, 5);
  assert.deepEqual(ranked.map((r) => r.iso3), ['USA', 'DEU', 'FRA', 'IND', 'PAK']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('ranking at Total GDP scale never rounds before comparing', async () => {
  // A difference of 1 US$ at ~3.9e12 is exactly representable in a double and
  // must decide the order: the display scale ("trillions") is presentation-only.
  const rows = [row('IND', IND_2025), row('DEU', IND_2025 + 1)];
  const { ranked, total } = rankByValue(rows);
  assert.equal(total, 2);
  assert.equal(ranked[0].iso3, 'DEU');
  assert.equal(ranked[1].iso3, 'IND');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test('YoY at Total GDP scale uses raw values; non-positive bases stay null', async () => {
  const good = computeYoy({ current: IND_2025, previous: 3.7e12 });
  assert.equal(good.computable, true);
  assert.equal(good.yoyPercent, ((IND_2025 / 3.7e12) - 1) * 100);

  for (const previous of [0, -100]) {
    const bad = computeYoy({ current: IND_2025, previous });
    assert.equal(bad.yoyPercent, null, `base ${previous} must not produce a percentage`);
    assert.equal(bad.computable, false);
  }
  const missing = computeYoy({ current: IND_2025, previous: null });
  assert.equal(missing.yoyPercent, null);
  assert.equal(missing.computable, false);
});

test('YoY ranking at Total GDP scale: order, ties, missing-year exclusion', async () => {
  const currentRows = [row('USA', 28.18 * T), row('IND', IND_2025), row('DEU', 4.55 * T)];
  const previousRows = [row('USA', 27.36 * T), row('IND', 3.7e12)]; // DEU missing -> excluded
  const built = buildYoyRows(currentRows, previousRows);
  assert.equal(built.pairs, 2);

  // Crafted tie: identical percentages break by ISO3.
  const tied = rankByYoy([
    { iso3: 'IND', previousValue: 100, currentValue: 110, yoyPercent: 10 },
    { iso3: 'DEU', previousValue: 200, currentValue: 220, yoyPercent: 10 },
  ]);
  assert.deepEqual(tied.ranked.map((r) => r.iso3), ['DEU', 'IND']);

  // Zero-base rows never reach the YoY ranking.
  const withZeroBase = buildYoyRows([row('CIV', 5)], [row('CIV', 0)]);
  assert.equal(withZeroBase.pairs, 0);
});

test('like-for-like universes at Total GDP scale: common/entered/exited', async () => {
  const rowsA = [row('USA', 27.36 * T), row('DEU', 4.46 * T), row('IND', 3.7e12), row('XKX', 10e9)];
  const rowsB = [row('USA', 28.18 * T), row('DEU', 4.55 * T), row('IND', IND_2025), row('PAK', 0.34 * T)];
  const result = buildLevelComparison({ rowsA, rowsB, focusIso3: 'IND' });
  assert.deepEqual(result.members.common, ['DEU', 'IND', 'USA']);
  assert.deepEqual(result.members.exited, ['XKX']);
  assert.deepEqual(result.members.entered, ['PAK']);
  assert.equal(result.totals.a, result.totals.common + result.totals.exited);
  assert.equal(result.totals.b, result.totals.common + result.totals.entered);
});

// ---------------------------------------------------------------------------
// Service + storage isolation: one seeded DB holding BOTH subjects.
// Per-capita holds 3 economies in 2025; Total GDP holds 4. Denominators must
// be independent and neither series may leak into the other subject's panels.
// ---------------------------------------------------------------------------

const GDP_METADATA = [
  { id: 'IND', name: 'India', region: { id: 'SAS', value: 'South Asia' } },
  { id: 'USA', name: 'United States', region: { id: 'NAC', value: 'North America' } },
  { id: 'DEU', name: 'Germany', region: { id: 'ECS', value: 'Europe & Central Asia' } },
  { id: 'PAK', name: 'Pakistan', region: { id: 'SAS', value: 'South Asia' } },
  { id: 'XKX', name: 'Kosovo', region: { id: 'ECS', value: 'Europe & Central Asia' } },
  { id: 'AFE', name: 'Africa Eastern and Southern', region: { id: 'NA', value: 'Aggregates' } },
];

const TOTAL_2024 = { USA: 27.36e12, DEU: 4.46e12, IND: 3.7e12, XKX: 10e9 };
const TOTAL_2025 = { USA: 28.18e12, DEU: 4.55e12, IND: IND_2025, PAK: 0.34e12 };
const PCAP_2025 = { USA: 85000.5, DEU: 55000.25, IND: 2700.75 };

async function seedBothSubjects() {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse } = await import('../src/domain/universe.js');
  const { METRICS } = await import('../src/config.js');

  const universe = buildUniverse(GDP_METADATA);
  repository.upsertCountries(db, universe.countries);

  const seedMetric = (metricKey, valuesByYear) => {
    repository.upsertIndicator(db, {
      ...METRICS[metricKey],
      name: METRICS[metricKey].label,
      unit: METRICS[metricKey].unit,
      source: 'World Development Indicators',
    });
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    const rows = [];
    for (const [year, values] of Object.entries(valuesByYear)) {
      for (const [iso3, value] of Object.entries(values)) {
        rows.push({ countryId: iso3, indicatorId: indicator.id, year: Number(year), value });
      }
    }
    // The aggregate row must be rejected by the universe rule, never stored.
    repository.upsertObservations(db, rows);
    return indicator;
  };

  seedMetric('total_current', { 2024: TOTAL_2024, 2025: TOTAL_2025 });
  seedMetric('nominal_current', { 2025: PCAP_2025 });
  return { db, repository };
}

test('denominators are independent per metric; aggregates never stored', async () => {
  const { db, repository } = await seedBothSubjects();
  const { buildFullRanking } = await import('../src/services/fullRanking.js');

  const total = buildFullRanking(db, { metricKey: 'total_current', year: 2025 });
  assert.equal(total.total, 4);
  assert.equal(total.metric.subject, 'gdp_total');
  assert.deepEqual(total.rows.map((r) => r.iso3), ['USA', 'DEU', 'IND', 'PAK']);

  const perCapita = buildFullRanking(db, { metricKey: 'nominal_current', year: 2025 });
  assert.equal(perCapita.total, 3);
  assert.equal(perCapita.metric.subject, 'gdp_per_capita');

  // The aggregate entity holds no observation under either indicator.
  for (const key of ['total_current', 'nominal_current']) {
    const indicator = repository.getIndicatorByMetricKey(db, key);
    const agg = repository.getEligibleObservations(db, indicator.id, 2025).filter((r) => r.iso3 === 'AFE');
    assert.equal(agg.length, 0, `${key}: aggregate must be excluded`);
  }
});

test('per-capita panels never show Total GDP and vice versa', async () => {
  const { db } = await seedBothSubjects();
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');
  const { buildCoveragePanel } = await import('../src/services/coverageService.js');

  const perCapita = buildIndiaYearlyRows(db, { startYear: 2025, endYear: 2025 });
  assert.equal(perCapita.subject, 'gdp_per_capita');
  assert.deepEqual(perCapita.metricKeys, ['nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant']);
  assert.ok(!('total_current' in perCapita.rows[0]), 'no Total GDP cell in a per-capita row');

  const total = buildIndiaYearlyRows(db, { startYear: 2024, endYear: 2025, subject: 'gdp_total' });
  assert.equal(total.subject, 'gdp_total');
  const row2025 = total.rows.find((r) => r.year === 2025);
  assert.equal(row2025.total_current.indiaValue, IND_2025);
  assert.equal(
    row2025.total_current.indiaYoY,
    ((TOTAL_2025.IND / TOTAL_2024.IND) - 1) * 100,
    'Total GDP YoY computed on the Total GDP series',
  );
  assert.ok(!('nominal_current' in row2025), 'no per-capita cell in a Total GDP row');

  const coverageDefault = buildCoveragePanel(db, { year: 2025 });
  assert.deepEqual(coverageDefault.metrics.map((m) => m.metric.key), [
    'nominal_current',
    'nominal_constant',
    'ppp_current',
    'ppp_constant',
  ]);
  const coverageTotal = buildCoveragePanel(db, { year: 2025, subject: 'gdp_total' });
  assert.deepEqual(coverageTotal.metrics.map((m) => m.metric.key), [
    'total_current',
    'total_constant',
    'total_ppp_current',
    'total_ppp_constant',
  ]);
});

test('Total GDP comparison: entered/exited/outside with above/below India by position', async () => {
  const { db } = await seedBothSubjects();
  const { buildLevelComparisonResponse } = await import('../src/services/comparisonService.js');

  const response = buildLevelComparisonResponse(db, {
    metricKey: 'total_current',
    yearA: 2024,
    yearB: 2025,
  });
  assert.equal(response.comparison.available, true);
  assert.equal(response.universe.setA, 4);
  assert.equal(response.universe.setB, 4);
  assert.equal(response.universe.common, 3);
  assert.equal(response.universe.exited, 1);
  assert.equal(response.universe.entered, 1);
  const byStatus = (status) =>
    response.economies.rows.filter((r) => r.status === status).map((r) => r.iso3);
  assert.deepEqual(byStatus('entered'), ['PAK']);
  assert.deepEqual(byStatus('exited'), ['XKX']);
  // India ranks 3rd of 4 in both years (USA, DEU above; XKX/PAK below).
  assert.equal(response.focusMovement.fullRankA, 3);
  assert.equal(response.focusMovement.fullRankB, 3);
  assert.equal(response.metric.subject, 'gdp_total');
  const relations = new Map(response.economies.rows.map((r) => [r.iso3, r.relationToFocus]));
  assert.equal(relations.get('USA'), 'above');
  assert.equal(relations.get('DEU'), 'above');
  assert.equal(relations.get('PAK'), 'below');
});

test('partial Total GDP ingest fails integrity loudly (missing series, not silent subset)', async () => {
  const { db } = await seedBothSubjects(); // only 2 of 8 indicators stored
  const { runIntegrityChecks } = await import('../src/services/integrity.js');
  const report = runIntegrityChecks(db);
  const check = report.checks.find((c) => c.check === 'H.registry_indicators');
  assert.equal(check.status, 'fail');
  assert.match(JSON.stringify(check.detail.expectedMetricKeys), /total_ppp_constant/);
  assert.equal(report.passed, false);
});

test('growth percentages and unregistered codes are never valid level metrics', async () => {
  const { getMetric } = await import('../src/config.js');
  for (const code of ['NY.GDP.MKTP.KD.ZG', 'NY.GDP.PCAP.KD.ZG', 'NY.GDP.MKTP.KN', 'NY.GDP.MKTP.CN', 'NY.GDP.TOTAL.CD']) {
    assert.throws(() => getMetric(code), /Unknown metric/, `${code} must be rejected`);
  }
  // Exact registered codes (any case) still resolve to the Total GDP subject.
  assert.equal(getMetric('ny.gdp.mktp.cd').key, 'total_current');
  assert.equal(getMetric('NY.GDP.MKTP.PP.KD').subject, 'gdp_total');
});

// ---------------------------------------------------------------------------
// HTTP API for the Total GDP subject (seeded DB, no live calls).
// ---------------------------------------------------------------------------

let baseUrl = null;
let server = null;

test.before(async () => {
  const { db } = await seedBothSubjects();
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

test('API: Total GDP ranking, code-form identity, and 400 guards', async () => {
  const ranking = await get('/api/ranking?indicator=total_current&year=2025');
  assert.equal(ranking.status, 200);
  assert.equal(ranking.body.total, 4);
  assert.equal(ranking.body.metric.subject, 'gdp_total');
  assert.equal(ranking.body.rows[0].iso3, 'USA');
  assert.equal(ranking.body.rows.find((r) => r.iso3 === 'IND').rawValue, IND_2025);

  const byCode = await get('/api/ranking?indicator=NY.GDP.MKTP.CD&year=2025');
  assert.equal(byCode.status, 200);
  assert.equal(byCode.body.metric.key, 'total_current');

  for (const bad of ['NOPE', 'NY.GDP.MKTP.KD.ZG', 'NY.GDP.MKTP.KN']) {
    const res = await get(`/api/ranking?indicator=${bad}&year=2025`);
    assert.equal(res.status, 400, `${bad} must fail closed`);
    assert.equal(res.body.error.code, 'INVALID_INDICATOR');
  }
});

test('API: Total GDP YoY ranking uses the YoY pair universe', async () => {
  const full = await get('/api/yoy-ranking?indicator=total_current&year=2025');
  assert.equal(full.status, 200);
  // Pairs: IND, USA, DEU (PAK entered in 2025, XKX exited after 2024).
  assert.equal(full.body.total, 3);

  const verify = await get('/api/yoy-ranking/verify?indicator=total_current&year=2025&country=IND&neighbors=5');
  assert.equal(verify.status, 200);
  assert.equal(verify.body.denominator, 3);
});

test('API: Total GDP comparison, observations, subject-scoped yearly and metadata', async () => {
  const comparison = await get('/api/comparison/level?indicator=total_current&yearA=2024&yearB=2025');
  assert.equal(comparison.status, 200);
  assert.equal(comparison.body.universe.entered, 1);
  assert.equal(comparison.body.universe.exited, 1);
  assert.equal(comparison.body.universe.common, 3);
  const byStatus = (status) =>
    comparison.body.economies.rows.filter((r) => r.status === status).map((r) => r.iso3);
  assert.deepEqual(byStatus('entered'), ['PAK']);
  assert.deepEqual(byStatus('exited'), ['XKX']);

  const obs = await get('/api/observations?indicator=total_current&year=2025&country=IND');
  assert.equal(obs.status, 200);
  assert.equal(obs.body.observation.value, IND_2025);

  const yearly = await get('/api/india/gdp-ranking?subject=gdp_total&startYear=2024&endYear=2025');
  assert.equal(yearly.status, 200);
  assert.equal(yearly.body.subject, 'gdp_total');
  assert.equal(yearly.body.rows.find((r) => r.year === 2025).total_current.indiaValue, IND_2025);

  const perCapitaYearly = await get('/api/india/gdp-ranking?startYear=2025&endYear=2025');
  assert.equal(perCapitaYearly.status, 200);
  assert.equal(perCapitaYearly.body.subject, 'gdp_per_capita');
  assert.ok(!('total_current' in perCapitaYearly.body.rows[0]));

  const coverage = await get('/api/coverage?year=2025&subject=gdp_total');
  assert.equal(coverage.status, 200);
  assert.equal(coverage.body.subject, 'gdp_total');
  assert.equal(coverage.body.metrics.length, 4);

  const metadata = await get('/api/metadata');
  assert.equal(metadata.status, 200);
  assert.deepEqual(metadata.body.subjects.map((s) => s.key), ['gdp_per_capita', 'gdp_total']);
  assert.equal(metadata.body.expectedIndicators.length, 8);

  const badSubject = await get('/api/india/gdp-ranking?subject=gdp');
  assert.equal(badSubject.status, 400);
  assert.equal(badSubject.body.error.code, 'INVALID_SUBJECT');
});
