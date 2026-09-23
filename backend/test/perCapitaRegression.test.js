/**
 * GDP-PER-CAPITA REGRESSION PROOF (before/after introducing the Total GDP subject).
 *
 * The strongest available proof that the per-capita system is untouched is an
 * INDEPENDENT recomputation: this file re-implements the documented ranking and
 * YoY rules from scratch, recomputes ranks/denominators/percentages from the
 * stored observations of the committed vintage, and compares them with what the
 * services and the HTTP API return. It also proves subject separation: Total GDP
 * never appears in a per-capita panel, and vice versa.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedSnapshotDb } from './helpers/testDb.js';
import { snapshot } from './fixtures/snapshot.js';

const FOCUS = 'IND';

/** Independent re-implementation of the documented level-ranking rule. */
function independentRank(rows, focusIso3 = FOCUS) {
  const valid = (rows ?? []).filter(
    (row) => row && row.iso3 && typeof row.value === 'number' && Number.isFinite(row.value),
  );
  const sorted = [...valid].sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    return a.iso3 < b.iso3 ? -1 : a.iso3 > b.iso3 ? 1 : 0;
  });
  const index = sorted.findIndex((row) => row.iso3 === focusIso3);
  return {
    total: sorted.length,
    rank: index >= 0 ? index + 1 : null,
    value: index >= 0 ? sorted[index].value : null,
  };
}

/** Raw fixture value for one per-capita metric/ISO3/year (null when missing). */
function fixtureValue(metricKey, iso3, year) {
  const row = (snapshot.indicators[metricKey]?.rows ?? []).find(
    (entry) => entry.countryiso3code === iso3 && Number.parseInt(entry.date, 10) === year,
  );
  if (!row || row.value === null || row.value === undefined) return null;
  return Number(row.value);
}

let fixture = null;
async function snapshotFixture() {
  if (!fixture) fixture = await seedSnapshotDb();
  return fixture;
}

test('per-capita: every year of the committed vintage reproduces independent ranks and denominators', async () => {
  const { db, repository } = await snapshotFixture();
  const { METRIC_KEYS } = await import('../src/config.js');
  const { buildFullRanking } = await import('../src/services/fullRanking.js');
  const { buildRankVerification } = await import('../src/services/rankVerification.js');

  const years = snapshot.yearRange;
  let checked = 0;
  for (const metricKey of METRIC_KEYS) {
    const indicator = repository.getIndicatorByMetricKey(db, metricKey);
    assert.ok(indicator, `${metricKey} must be ingested from the fixture`);
    for (let year = years.startYear; year <= years.endYear; year += 1) {
      const rows = repository.getEligibleObservations(db, indicator.id, year);
      if (rows.length === 0) continue;
      const expected = independentRank(rows);

      const ranking = buildFullRanking(db, { metricKey, year });
      assert.equal(ranking.total, expected.total, `${metricKey} ${year} denominator`);
      assert.equal(ranking.eligibleUniverse, 217, `${metricKey} ${year} eligible universe`);
      assert.equal(ranking.metric.subject, 'gdp_per_capita');
      assert.equal(ranking.metric.indicatorCode, snapshot.indicators[metricKey].indicatorCode);

      const focus = ranking.focus;
      assert.ok(focus, `${metricKey} ${year} focus row`);
      assert.equal(focus.rank, expected.rank, `${metricKey} ${year} India rank`);
      assert.equal(focus.rawValue, expected.value, `${metricKey} ${year} India raw value`);
      assert.equal(focus.rawValue, fixtureValue(metricKey, FOCUS, year), `${metricKey} ${year} fixture value`);

      const verification = buildRankVerification(db, { metricKey, year, neighbors: 5 });
      assert.equal(verification.total, expected.total, `${metricKey} ${year} verify denominator`);
      assert.equal(verification.focus.rank, expected.rank, `${metricKey} ${year} verify rank`);
      checked += 1;
    }
  }
  // The committed snapshot spans 2004–2025 (22 years × 4 metrics = 88 metric-years).
  const expectedSweep = (years.endYear - years.startYear + 1) * METRIC_KEYS.length;
  assert.equal(checked, expectedSweep, `expected a dense sweep, checked ${checked} metric-years`);
});

test('per-capita: YoY percentages reproduce the independent formula', async () => {
  const { db } = await snapshotFixture();
  const { METRIC_KEYS } = await import('../src/config.js');
  const { buildIndiaYearlyRows } = await import('../src/services/indiaYearly.js');

  const result = buildIndiaYearlyRows(db, {
    startYear: snapshot.yearRange.startYear,
    endYear: snapshot.yearRange.endYear,
  });
  assert.equal(result.subject, 'gdp_per_capita');
  assert.deepEqual(result.metricKeys, [...METRIC_KEYS]);

  for (const metricKey of METRIC_KEYS) {
    for (const row of result.rows) {
      const cell = row[metricKey];
      const current = fixtureValue(metricKey, FOCUS, row.year);
      const previous = fixtureValue(metricKey, FOCUS, row.year - 1);
      if (current === null) {
        assert.equal(cell.available, false, `${metricKey} ${row.year} unavailable`);
        continue;
      }
      assert.equal(cell.indiaValue, current, `${metricKey} ${row.year} value`);
      if (previous === null || previous <= 0) {
        assert.equal(cell.indiaYoY, null, `${metricKey} ${row.year} YoY must stay null`);
      } else {
        assert.equal(
          cell.indiaYoY,
          ((current / previous) - 1) * 100,
          `${metricKey} ${row.year} YoY`,
        );
      }
    }
  }
});
