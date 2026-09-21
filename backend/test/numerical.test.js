/**
 * NUMERICAL INTEGRITY TESTS (specification section 3).
 *
 * Zero-error-margin means: for a fixed snapshot, identical raw observations
 * always produce identical ranks and derived results. Calculations use the
 * numeric REAL value only — never valueRaw strings, never "$2,702" display
 * strings. valueRaw TEXT exists for audit/reproducibility and must round-trip:
 * Number(valueRaw) === value for every stored row.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { rankByValue } from '../src/domain/ranking.js';
import { formatValue } from '../src/domain/format.js';
import { METRICS } from '../src/config.js';
import { seedEdgeCaseDb } from './helpers/testDb.js';

test('canonicalDecimalString round-trips every finite number', async () => {
  const { canonicalDecimalString } = await import('../src/db/repository.js');
  for (const n of [0, 1, -1.5, 2702.47987141553, 11747.9160436011, 1e21, 0.1]) {
    const s = canonicalDecimalString(n);
    assert.equal(typeof s, 'string');
    assert.equal(Number(s), n, `round-trip for ${n}`);
  }
  assert.equal(canonicalDecimalString('  2702.47987141553 '), '2702.47987141553');
  assert.equal(canonicalDecimalString(null), null);
  assert.equal(canonicalDecimalString(undefined), null);
  assert.equal(canonicalDecimalString(Number.NaN), null);
  assert.equal(canonicalDecimalString(Number.POSITIVE_INFINITY), null);
  assert.equal(canonicalDecimalString(''), null);
  assert.equal(canonicalDecimalString('not a number'), null);
});

test('stored rows carry a valueRaw that round-trips to the numeric value', async () => {
  const { db, repository } = await seedEdgeCaseDb();
  const rows = db.prepare('SELECT value, value_raw FROM observations').all();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(typeof row.value, 'number');
    assert.ok(Number.isFinite(row.value));
    assert.equal(typeof row.value_raw, 'string', 'every row preserves its decimal string');
    assert.equal(Number(row.value_raw), row.value, 'round-trip: Number(valueRaw) === value');
  }
  void repository;
});

test('ranking uses numeric values, not display strings', async () => {
  const metric = METRICS.nominal_current;
  // Both display as $2,702 / $2,703 at 0 decimals but must not tie.
  const a = 2702.49;
  const b = 2702.51;
  assert.equal(formatValue(a, metric).formatted, '$2,702');
  assert.notEqual(formatValue(a, metric).formatted, formatValue(b, metric).formatted);
  const { ranked } = rankByValue([
    { iso3: 'AAA', value: a },
    { iso3: 'BBB', value: b },
  ]);
  assert.deepEqual(ranked.map((r) => r.iso3), ['BBB', 'AAA']);
  assert.notEqual(ranked[0].rank, ranked[1].rank);
});

test('identical inputs always produce identical rankings (determinism)', async () => {
  const { db, repository } = await seedEdgeCaseDb();
  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const { rankByValue: rank } = await import('../src/domain/ranking.js');
  const first = rank(repository.getEligibleObservations(db, indicator.id, 2005));
  const second = rank(repository.getEligibleObservations(db, indicator.id, 2005));
  assert.deepEqual(first, second);
});

test('valueRaw is audit-only: stripping it never changes a rank', async () => {
  const { db, repository } = await seedEdgeCaseDb();
  const indicator = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const rows = repository.getEligibleObservations(db, indicator.id, 2005);
  assert.ok(rows.every((r) => typeof r.valueRaw === 'string' || r.valueRaw === null));
  const withRaw = rankByValue(rows);
  const stripped = rankByValue(rows.map(({ valueRaw, ...rest }) => rest));
  assert.deepEqual(
    withRaw.ranked.map(({ valueRaw, ...rest }) => rest),
    stripped.ranked.map(({ valueRaw, ...rest }) => rest),
  );
});
