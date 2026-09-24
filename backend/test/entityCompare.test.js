/**
 * PHASE-4 ENTITY / GROUP COMPARISON TESTS.
 *
 * One generic architecture for every entity combination, verified against
 * isolated in-memory databases (never live WDI, never the real cache):
 *
 *   ENTITY RESOLUTION — countries, official aggregates, strict custom groups
 *   COUNTRY<->COUNTRY, COUNTRY<->AGGREGATE, COUNTRY<->GROUP, GROUP<->GROUP
 *   OBSERVED vs LIKE-FOR-LIKE with exact membership-effect decomposition
 *   Capability matrix refusals (NOT_AGGREGATABLE, NO_OFFICIAL_AGGREGATE, ...)
 *   RAW vs APP_DERIVED provenance, vintage coherence, legacy regression
 *
 * Production metrics only (the 8 GDP series): disabled future definitions
 * exercise the capability matrix at unit level; their HTTP paths stay 400
 * until Phase 5 promotion. No ranking/leaderboard mixing is possible — the
 * compare response carries no ranks by construction.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { METRICS } from '../src/config.js';
import { createMemoryTestDb, seedEdgeCaseDb } from './helpers/testDb.js';
import {
  ENTITY_ERROR_CODES,
  MAX_GROUP_MEMBERS,
  canCompare,
  parseEntitySpec,
  resolveEntity,
  validateCrossRateLegs,
} from '../src/services/entities.js';
import { buildCompareResponse, buildGroupEvaluation } from '../src/services/entityCompare.js';

// ---------------------------------------------------------------------------
// Fixture: SUM-capable dataset (total_current + nominal_current for four
// eligible countries; IDN missing in 2005 to prove strict coverage handling).
// ---------------------------------------------------------------------------
async function seedSumDb() {
  const { db, repository } = await createMemoryTestDb();
  const { buildUniverse } = await import('../src/domain/universe.js');
  const universe = buildUniverse([
    { id: 'IND', iso2Code: 'IN', name: 'India', region: { id: 'SAS', value: 'South Asia' } },
    { id: 'CHN', iso2Code: 'CN', name: 'China', region: { id: 'EAS', value: 'East Asia & Pacific' } },
    { id: 'USA', iso2Code: 'US', name: 'United States', region: { id: 'NAC', value: 'North America' } },
    { id: 'IDN', iso2Code: 'ID', name: 'Indonesia', region: { id: 'EAS', value: 'East Asia & Pacific' } },
    { id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA', value: 'Aggregates' } },
  ]);
  repository.upsertCountries(db, universe.countries);
  for (const key of ['total_current', 'nominal_current']) {
    repository.upsertIndicator(db, {
      ...METRICS[key],
      name: key,
      unit: METRICS[key].unit,
      source: 'World Development Indicators',
    });
  }
  const total = repository.getIndicatorByMetricKey(db, 'total_current');
  const perCapita = repository.getIndicatorByMetricKey(db, 'nominal_current');
  const rows = [];
  const totalValues = {
    IND: { 2004: 721e9, 2005: 834e9 },
    CHN: { 2004: 1955e9, 2005: 2286e9 },
    USA: { 2004: 11963e9, 2005: 13036e9 },
    IDN: { 2004: 257e9 },
  };
  const perCapitaValues = {
    IND: { 2004: 700.75, 2005: 800.125 },
    CHN: { 2004: 2000, 2005: 2200 },
    USA: { 2004: 42000.222222, 2005: 43000.333333 },
    IDN: { 2004: 1000, 2005: 1100 },
  };
  for (const [iso3, years] of Object.entries(totalValues)) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: total.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  for (const [iso3, years] of Object.entries(perCapitaValues)) {
    for (const [year, value] of Object.entries(years)) {
      rows.push({ countryId: iso3, indicatorId: perCapita.id, year: Number(year), value, wbLastUpdated: '2026-07-13' });
    }
  }
  repository.upsertObservations(db, rows);
  return { db, repository };
}

async function startApp(db) {
  const { createApp } = await import('../src/server.js');
  const app = createApp({ db, autoRefresh: false });
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function getJSON(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

/** assert.throws matching error.code (messages carry human text, codes are exact). */
function throwsCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

// ---------------------------------------------------------------------------
// ENTITY RESOLUTION (items 1-8)
// ---------------------------------------------------------------------------
test('Phase 4.1: country entities resolve from database metadata', async () => {
  const { db } = await seedEdgeCaseDb();
  assert.deepEqual(parseEntitySpec('country:IND'), { kind: 'country', iso3: 'IND' });
  assert.deepEqual(parseEntitySpec('country:ind'), { kind: 'country', iso3: 'IND' });
  const resolved = resolveEntity(db, parseEntitySpec('country:USA'));
  assert.deepEqual(resolved, { kind: 'country', iso3: 'USA', name: 'United States', source: 'WORLD_BANK' });
});

test('Phase 4.2: invalid countries are rejected, never defaulted', async () => {
  const { db } = await seedEdgeCaseDb();
  throwsCode(() => parseEntitySpec('country:ZZ'), 'INVALID_ENTITY');
  throwsCode(() => parseEntitySpec('country:'), 'INVALID_ENTITY');
  throwsCode(() => resolveEntity(db, parseEntitySpec('country:XYZ')), 'INVALID_COUNTRY');
  // No silent India substitution anywhere in the resolution path.
  throwsCode(() => resolveEntity(db, parseEntitySpec('country:WLD')), 'INVALID_COUNTRY');
});

test('Phase 4.3: official aggregates resolve only when World Bank publishes them', async () => {
  const { db } = await seedEdgeCaseDb();
  const resolved = resolveEntity(db, parseEntitySpec('aggregate:WLD'));
  assert.equal(resolved.kind, 'wb_aggregate');
  assert.equal(resolved.name, 'World');
  assert.equal(resolved.source, 'WORLD_BANK');
});

test('Phase 4.4: unavailable aggregates and kind mismatches fail explicitly', async () => {
  const { db } = await seedEdgeCaseDb();
  throwsCode(() => resolveEntity(db, parseEntitySpec('aggregate:XXX')), 'NO_OFFICIAL_AGGREGATE');
  throwsCode(() => resolveEntity(db, parseEntitySpec('aggregate:IND')), 'INVALID_ENTITY');
  throwsCode(() => parseEntitySpec('continent:AFR'), 'INVALID_ENTITY');
  throwsCode(() => parseEntitySpec('IND'), 'INVALID_ENTITY');
  throwsCode(() => parseEntitySpec(''), 'INVALID_ENTITY');
});

test('Phase 4.5: custom groups validate strictly (no silent drops)', async () => {
  const { db } = await seedEdgeCaseDb();
  const resolved = resolveEntity(db, parseEntitySpec('group:IND,USA,BRA'));
  assert.equal(resolved.kind, 'custom_group');
  assert.equal(resolved.source, 'USER_DEFINED');
  assert.deepEqual(resolved.members, ['BRA', 'IND', 'USA']);
  assert.match(resolved.label, /User-selected group/);
  const labelled = resolveEntity(db, parseEntitySpec('group:USA,BRA', 'Rivals'));
  assert.equal(labelled.label, 'Rivals');
  assert.deepEqual(labelled.memberNames.USA, 'United States');
});

test('Phase 4.6-8: duplicates, invalid members, empty and oversize groups fail', async () => {
  const { db } = await seedEdgeCaseDb();
  throwsCode(() => parseEntitySpec('group:IND,IND'), 'INVALID_GROUP');
  throwsCode(() => parseEntitySpec('group:IND,ind'), 'INVALID_GROUP');
  throwsCode(() => resolveEntity(db, parseEntitySpec('group:IND,XYZ')), 'INVALID_GROUP_MEMBER');
  throwsCode(() => resolveEntity(db, parseEntitySpec('group:IND,WLD')), 'INVALID_GROUP_MEMBER');
  throwsCode(() => parseEntitySpec('group:'), 'EMPTY_GROUP');
  throwsCode(() => parseEntitySpec('group:  , '), 'EMPTY_GROUP');
  const tooMany = `group:${Array.from({ length: MAX_GROUP_MEMBERS + 1 }, (_, i) => `A${String(i).padStart(2, '0')}`).join(',')}`;
  throwsCode(() => parseEntitySpec(tooMany), 'INVALID_GROUP');
  throwsCode(() => parseEntitySpec('group:IND,ZZ'), 'INVALID_GROUP_MEMBER');
  throwsCode(() => parseEntitySpec('country:IND', 'Custom'), 'INVALID_ENTITY');
});

// ---------------------------------------------------------------------------
// COUNTRY <-> COUNTRY (items 9-13)
// ---------------------------------------------------------------------------
test('Phase 4.9-10: country level comparison for Total GDP and per-capita', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const total = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&operation=level');
    assert.equal(total.status, 200);
    assert.equal(total.body.available, true);
    assert.equal(total.body.results.a.values['2005'].value, 834e9);
    assert.equal(total.body.results.b.values['2005'].value, 2286e9);
    assert.equal(total.body.results.comparison.perYear['2005'].gap, 834e9 - 2286e9);
    assert.equal(total.body.results.a.values['2005'].provenance, 'RAW');

    const perCapita = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:USA&indicator=nominal_current&yearA=2004&yearB=2005&operation=level');
    assert.equal(perCapita.status, 200);
    assert.equal(perCapita.body.results.a.values['2004'].value, 700.75);
    assert.equal(perCapita.body.results.comparison.perYear['2004'].gap, 700.75 - 42000.222222);
  } finally {
    await close();
  }
});

test('Phase 4.11-12: percent and absolute change operations', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const pct = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&operation=percent_change');
    assert.equal(pct.status, 200);
    const expectedIND = ((834e9 / 721e9 - 1) * 100);
    const expectedCHN = ((2286e9 / 1955e9 - 1) * 100);
    assert.ok(Math.abs(pct.body.results.comparison.a.value - expectedIND) < 1e-9);
    assert.ok(Math.abs(pct.body.results.comparison.b.value - expectedCHN) < 1e-9);
    assert.ok(Math.abs(pct.body.results.comparison.gap.value - (expectedIND - expectedCHN)) < 1e-9);
    assert.equal(pct.body.results.comparison.gap.unit, 'percentage points');

    const abs = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change');
    assert.equal(abs.status, 200);
    assert.equal(abs.body.results.comparison.a.value, 834e9 - 721e9);
    assert.equal(abs.body.results.comparison.gap.value, (834e9 - 721e9) - (2286e9 - 1955e9));

    const cagr = await getJSON(base, '/api/compare?entityA=country:USA&entityB=country:IND&indicator=total_current&yearA=2004&yearB=2005&operation=cagr');
    assert.equal(cagr.status, 200);
    assert.ok(Math.abs(cagr.body.results.comparison.a.value - ((13036e9 / 11963e9 - 1) * 100)) < 1e-9);
  } finally {
    await close();
  }
});

test('Phase 4.13: compare carries no focus semantics and legacy focus is intact', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const body = (await getJSON(base, '/api/compare?entityA=country:CHN&entityB=country:USA&indicator=total_current&yearA=2005')).body;
    assert.ok(!('focus' in body), 'compare must not treat any entity as a focus');
    assert.equal(body.entities.a.iso3, 'CHN');
    // Legacy focus routes still default to IND (Phase 1 intact). Note:
    // search=IND also matches Indonesia by substring, so locate IND exactly.
    const legacy = await getJSON(base, '/api/ranking?indicator=nominal_current&year=2005&search=IND');
    const indMatch = legacy.body.search.matches.find((m) => m.iso3 === 'IND');
    assert.equal(indMatch.rank, 4);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// COUNTRY <-> OFFICIAL AGGREGATE (items 14-16)
// ---------------------------------------------------------------------------
test('Phase 4.14: official aggregate compares as a published entity (RAW)', async () => {
  const { db } = await seedEdgeCaseDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=aggregate:WLD&indicator=nominal_current&yearA=2005&operation=level');
    assert.equal(res.status, 200);
    assert.equal(res.body.available, true);
    assert.equal(res.body.entities.b.kind, 'wb_aggregate');
    assert.equal(res.body.results.b.values['2005'].value, 13500.5);
    assert.equal(res.body.results.b.values['2005'].provenance, 'RAW');
    assert.equal(res.body.results.comparison.perYear['2005'].gap, 800.125 - 13500.5);
  } finally {
    await close();
  }
});

test('Phase 4.15-16: missing aggregate data is explicit; no member decomposition', async () => {
  const { db } = await seedEdgeCaseDb();
  const { base, close } = await startApp(db);
  try {
    // WLD has no 2003 observation in the fixture: valid request, missing data.
    const res = await getJSON(base, '/api/compare?entityA=country:USA&entityB=aggregate:WLD&indicator=nominal_current&yearA=2003&operation=level');
    assert.equal(res.status, 200);
    assert.equal(res.body.results.b.values['2003'].available, false);
    assert.equal(res.body.results.b.values['2003'].reason, 'MISSING_REQUIRED_DATA');
    assert.equal(res.body.results.comparison.perYear['2003'].gap, null);
    // The movement entered/exited/common decomposition must never appear for
    // official aggregates: no member universe exists.
    const payload = JSON.stringify(res.body);
    assert.ok(!/entered|exited|commonRank|observedSetEffect/.test(payload));
    // Unknown aggregates are refused, never invented.
    const missing = await getJSON(base, '/api/compare?entityA=country:IND&entityB=aggregate:XXX&indicator=nominal_current&yearA=2005');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'NO_OFFICIAL_AGGREGATE');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// COUNTRY <-> GROUP, GROUP <-> GROUP, LIKE-FOR-LIKE (items 17-25)
// ---------------------------------------------------------------------------
test('Phase 4.17: country vs SUM group totals with provenance', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,USA&indicator=total_current&yearA=2005&operation=level&labelB=Big+two');
    assert.equal(res.status, 200);
    const group = res.body.results.b;
    assert.equal(group.kind, 'custom_group');
    assert.equal(group.label, 'Big two');
    assert.deepEqual(group.members, ['CHN', 'USA']);
    assert.equal(group.source, 'USER_DEFINED');
    assert.equal(group.observed['2005'].value, 2286e9 + 13036e9);
    assert.equal(group.observed['2005'].provenance, 'APP_DERIVED');
    assert.match(JSON.stringify(res.body), /World Bank/);
    assert.ok(!/official region|Region/.test(group.label));
  } finally {
    await close();
  }
});

test('Phase 4.18/24: strict missing-member coverage (never zero-filled)', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    // IDN has no 2005 total_current observation.
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change');
    assert.equal(res.status, 200);
    const group = res.body.results.b;
    assert.deepEqual(group.coverage['2004'].valid, ['CHN', 'IDN']);
    assert.deepEqual(group.coverage['2005'].valid, ['CHN']);
    assert.deepEqual(group.coverage['2005'].missing, ['IDN']);
    assert.equal(group.observed['2005'].value, 2286e9, 'observed uses valid members only, IDN not zero-filled');
    assert.equal(group.observed['2005'].members, 1);
  } finally {
    await close();
  }
});

test('Phase 4.20-21: group vs group totals and determinism', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const path = '/api/compare?entityA=group:IND,CHN&entityB=group:USA,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=percent_change';
    const first = await getJSON(base, path);
    const shuffled = await getJSON(base, '/api/compare?entityA=group:CHN,IND&entityB=group:IDN,USA&indicator=total_current&yearA=2004&yearB=2005&operation=percent_change');
    assert.equal(first.status, 200);
    assert.equal(shuffled.status, 200);
    assert.deepEqual(shuffled.body.results, first.body.results, 'member order must not affect results');
    assert.equal(first.body.results.a.observed['2005'].value, 834e9 + 2286e9);
    assert.ok(first.body.results.comparison.a.value !== null);
    assert.ok(first.body.results.comparison.b.value !== null);
  } finally {
    await close();
  }
});

test('Phase 4.22-23/25: like-for-like intersection and membership effect', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:USA&entityB=group:CHN,IDN&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change&groupMode=like_for_like');
    assert.equal(res.status, 200);
    const group = res.body.results.b;
    assert.deepEqual(group.coverage.common, ['CHN']);
    assert.deepEqual(group.coverage.observedOnlyA, ['IDN']);
    assert.deepEqual(group.coverage.observedOnlyB, []);
    assert.equal(group.likeForLike['2004'].value, 1955e9);
    assert.equal(group.likeForLike['2005'].value, 2286e9);
    // Exact decomposition: observedAbs - lflAbs = membership effect.
    const observedAbs = (2286e9 - (1955e9 + 257e9));
    const lflAbs = (2286e9 - 1955e9);
    assert.equal(group.membershipEffect.absolute, observedAbs - lflAbs);
    assert.equal(group.membershipEffect.absolute, -257e9);
    // The operation itself ran on the like-for-like series.
    assert.equal(res.body.results.comparison.b.value, lflAbs);
  } finally {
    await close();
  }
});

test('Phase 4: like-for-like without a group is rejected explicitly', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&groupMode=like_for_like');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'LIKE_FOR_LIKE_REQUIRES_GROUP');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// RATIO / PER-CAPITA / INFLATION / FX capability (items 26-32, unit + HTTP)
// ---------------------------------------------------------------------------
test('Phase 4.26-28: ratio and per-capita group rules', () => {
  // WEIGHTED_RATIO refuses plain group sums; per-capita refuses all sums.
  // (Phase-5 note: the FDI ratio is now a production metric; the capability
  // rule is unchanged, only the registry address moved.)
  assert.deepEqual(canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'custom_group' }, metric: METRICS.fdi_inflows_pct_gdp, operation: 'level' }), {
    allowed: false,
    reason: 'NOT_AGGREGATABLE',
  });
  assert.deepEqual(canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'custom_group' }, metric: METRICS.nominal_current, operation: 'level' }), {
    allowed: false,
    reason: 'NOT_AGGREGATABLE',
  });
  assert.deepEqual(canCompare({ entityA: { kind: 'custom_group' }, entityB: { kind: 'custom_group' }, metric: METRICS.total_current, operation: 'level' }), {
    allowed: true,
    reason: null,
  });
});

test('Phase 4.28: GDP per-capita group compare fails closed over HTTP', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,USA&indicator=nominal_current&yearA=2005');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'NOT_AGGREGATABLE');
  } finally {
    await close();
  }
});

test('Phase 4.29-30: inflation never becomes fake regional inflation', () => {
  const cpi = METRICS.inflation_cpi;
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'custom_group' }, metric: cpi, operation: 'level' }),
    { allowed: false, reason: 'NOT_AGGREGATABLE' },
  );
  // Official aggregates use the published series: capability allows the pair;
  // values come from stored WB observations, never member averages.
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'wb_aggregate' }, metric: cpi, operation: 'level' }),
    { allowed: true, reason: null },
  );
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'custom_group' }, metric: cpi, operation: 'percent_change' }),
    { allowed: false, reason: 'NOT_AGGREGATABLE' },
  );
});

test('Phase 4.31-32: exchange rates are never summed; cross-rate legs validate', () => {
  const fx = METRICS.fx_official;
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'custom_group' }, metric: fx, operation: 'level' }),
    { allowed: false, reason: 'NOT_AGGREGATABLE' },
  );
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'country' }, metric: fx, operation: 'cross_rate' }),
    { allowed: true, reason: null },
  );
  assert.deepEqual(
    canCompare({ entityA: { kind: 'country' }, entityB: { kind: 'country' }, metric: METRICS.total_current, operation: 'cross_rate' }),
    { allowed: false, reason: 'UNSUPPORTED_TRANSFORMATION' },
  );
  // Leg orchestration: valid, missing, non-positive and mixed quotation.
  assert.deepEqual(validateCrossRateLegs(fx, { value: 83.669, year: 2024 }, { value: 0.92, year: 2024 }), { valid: true, reason: null });
  assert.deepEqual(validateCrossRateLegs(fx, { value: null, year: 2024 }, { value: 0.92, year: 2024 }).reason, 'MISSING_REQUIRED_DATA');
  assert.deepEqual(validateCrossRateLegs(fx, { value: 83.669, year: 2024 }, { value: 0.92, year: 2023 }).reason, 'MISSING_REQUIRED_DATA');
  assert.deepEqual(
    validateCrossRateLegs(fx, { value: 83.669, year: 2024, quotation: 'LCU_PER_USD' }, { value: 0.92, year: 2024, quotation: 'USD_PER_LCU' }).reason,
    'INCOMPATIBLE_QUOTATION',
  );
  assert.deepEqual(validateCrossRateLegs(METRICS.total_current, { value: 1, year: 2024 }, { value: 2, year: 2024 }).reason, 'UNSUPPORTED_TRANSFORMATION');
});

test('Phase 4.32b: cross-rate on a non-FX production metric fails closed over HTTP', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:USA&indicator=total_current&yearA=2005&operation=cross_rate');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'UNSUPPORTED_TRANSFORMATION');
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// PROVENANCE, CAPABILITY ERRORS, VINTAGE, ENTITIES, GROUPS (items 33-37)
// ---------------------------------------------------------------------------
test('Phase 4.33-35: RAW vs APP_DERIVED provenance with members and formula', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const res = await getJSON(base, '/api/compare?entityA=country:IND&entityB=group:CHN,USA&indicator=total_current&yearA=2004&yearB=2005&operation=percent_change');
    assert.equal(res.status, 200);
    assert.equal(res.body.results.a.values['2005'].provenance, 'RAW');
    const group = res.body.results.b;
    assert.equal(group.observed['2005'].provenance, 'APP_DERIVED');
    assert.equal(group.observed['2005'].derivation.operation, 'GROUP_SUM');
    assert.equal(group.observed['2005'].derivation.metricKey, 'total_current');
    assert.deepEqual(group.members, ['CHN', 'USA']);
    assert.equal(group.memberNames.CHN, 'China');
    // Change provenance records the gated transform + inputs.
    assert.equal(res.body.results.comparison.b.provenance.kind, 'APP_DERIVED');
    assert.equal(res.body.results.comparison.b.provenance.transform, 'PERCENT');
    assert.equal(res.body.metric.key, 'total_current');
    assert.equal(res.body.metric.observationType, 'LEVEL');
  } finally {
    await close();
  }
});

test('Phase 4.36: capability errors are explicit and distinguished', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const cases = [
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&operation=bogus', 'INVALID_OPERATION'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=NOPE&yearA=2005', 'INVALID_INDICATOR'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current', 'MISSING_YEAR'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&yearB=2005&operation=percent_change', 'SAME_YEAR_SELECTED'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&operation=percent_change', 'MISSING_YEAR'],
      ['/api/compare?entityA=nonsense&entityB=country:CHN&indicator=total_current&yearA=2005', 'INVALID_ENTITY'],
      ['/api/compare?entityA=country:IND&entityB=group:&indicator=total_current&yearA=2005', 'EMPTY_GROUP'],
      ['/api/compare?entityA=country:IND&entityB=group:IND,XYZ&indicator=total_current&yearA=2005', 'INVALID_GROUP_MEMBER'],
      ['/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&groupMode=weird', 'INVALID_GROUP_MODE'],
    ];
    for (const [path, code] of cases) {
      const res = await getJSON(base, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, code, path);
      assert.equal(res.body.stack, undefined);
    }
    // Phase-5 note: inflation_cpi is now a promoted metric, so it resolves;
    // on this fixture DB it is simply un-ingested (valid request, missing
    // data) instead of INVALID_INDICATOR.
    const promoted = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=inflation_cpi&yearA=2005');
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.available, false);
    assert.equal(promoted.body.reason, 'MISSING_REQUIRED_DATA');
    // Labels on non-group entities are rejected, not silently ignored.
    const labelled = await getJSON(base, '/api/compare?entityA=country:IND&labelA=X&entityB=country:CHN&indicator=total_current&yearA=2005');
    assert.equal(labelled.status, 400);
    assert.equal(labelled.body.error.code, 'INVALID_ENTITY');
  } finally {
    await close();
  }
});

test('Phase 4.37: vintage coherence is measured over used legs only', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const coherent = await getJSON(base, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2004&yearB=2005&operation=absolute_change');
    assert.equal(coherent.status, 200);
    assert.equal(coherent.body.vintage.coherent, true);
    assert.deepEqual(coherent.body.vintage.lastUpdatedValues, ['2026-07-13']);
    assert.equal(coherent.body.vintage.warning, null);
  } finally {
    await close();
  }
  // Mixed vintage across legs: values still served, warning attached, never silent.
  db.prepare("UPDATE observations SET wb_last_updated = '2025-01-01' WHERE country_id = 'CHN'").run();
  const { base: base2, close: close2 } = await startApp(db);
  try {
    const mixed = await getJSON(base2, '/api/compare?entityA=country:IND&entityB=country:CHN&indicator=total_current&yearA=2005&operation=level');
    assert.equal(mixed.status, 200);
    assert.equal(mixed.body.vintage.coherent, false);
    assert.deepEqual(mixed.body.vintage.lastUpdatedValues, ['2025-01-01', '2026-07-13']);
    assert.match(mixed.body.vintage.warning, /different World Bank vintages/);
    assert.equal(mixed.body.results.a.values['2005'].value, 834e9);
  } finally {
    await close2();
  }
});

test('Phase 4 entities: discovery without hard-coded regions', async () => {
  const { db } = await seedEdgeCaseDb();
  const { base, close } = await startApp(db);
  try {
    const countries = await getJSON(base, '/api/entities');
    assert.equal(countries.status, 200);
    assert.ok(countries.body.entities.every((e) => e.kind === 'country'));
    assert.ok(countries.body.entities.some((e) => e.iso3 === 'IND' && e.name === 'India'));
    assert.ok(!countries.body.entities.some((e) => e.iso3 === 'WLD'));

    const search = await getJSON(base, '/api/entities?search=united');
    assert.ok(search.body.entities.some((e) => e.iso3 === 'USA'));

    const aggregates = await getJSON(base, '/api/entities?type=aggregate');
    assert.ok(aggregates.body.entities.some((e) => e.iso3 === 'WLD' && e.kind === 'wb_aggregate'));

    const all = await getJSON(base, '/api/entities?type=all&page=1&pageSize=3');
    assert.equal(all.body.entities.length, 3);
    assert.ok(all.body.pages >= 3);

    const annotated = await getJSON(base, '/api/entities?type=all&indicator=nominal_current&year=2005');
    const ind = annotated.body.entities.find((e) => e.iso3 === 'IND');
    assert.equal(ind.hasData, true);
    const tuv = annotated.body.entities.find((e) => e.iso3 === 'TUV');
    assert.equal(tuv.hasData, false);

    const bad = await getJSON(base, '/api/entities?type=continent');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_ENTITY');
  } finally {
    await close();
  }
});

test('Phase 4 groups/evaluate: validation, capability and coverage preview', async () => {
  const { db } = await seedSumDb();
  const { base, close } = await startApp(db);
  try {
    const ok = await getJSON(base, '/api/groups/evaluate?members=IND,CHN,IDN&indicator=total_current&yearA=2004&yearB=2005');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.valid, true);
    assert.equal(ok.body.type, 'custom_group');
    assert.equal(ok.body.memberCount, 3);
    assert.deepEqual(ok.body.members.map((m) => m.iso3), ['CHN', 'IDN', 'IND']);
    assert.equal(ok.body.capability.canComputeGroupValue, true);
    assert.equal(ok.body.capability.aggregation, 'SUM');
    assert.deepEqual(ok.body.coverage['2005'].valid, ['CHN', 'IND']);
    assert.deepEqual(ok.body.coverage['2005'].missing, ['IDN']);

    const perCapita = await getJSON(base, '/api/groups/evaluate?members=IND,CHN&indicator=nominal_current&yearA=2005');
    assert.equal(perCapita.body.capability.canComputeGroupValue, false);
    assert.equal(perCapita.body.capability.reason, 'NOT_AGGREGATABLE');

    const bad = await getJSON(base, '/api/groups/evaluate?members=IND,XYZ&indicator=total_current');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_GROUP_MEMBER');

    const empty = await getJSON(base, '/api/groups/evaluate?members=&indicator=total_current');
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'EMPTY_GROUP');
  } finally {
    await close();
  }
});

test('Phase 4 service-level: buildCompareResponse and buildGroupEvaluation without HTTP', async () => {
  const { db } = await seedSumDb();
  const direct = buildCompareResponse(db, {
    entityA: 'country:USA',
    entityB: 'group:IND,CHN',
    metricKey: 'total_current',
    yearA: 2004,
    yearB: 2005,
    operation: 'absolute_change',
  });
  assert.equal(direct.available, true);
  assert.equal(direct.results.a.values['2005'].value, 13036e9);
  assert.equal(direct.results.b.observed['2005'].value, 834e9 + 2286e9);
  assert.equal(direct.results.comparison.a.value, 13036e9 - 11963e9);

  const evaluation = buildGroupEvaluation(db, { members: 'IND,CHN', metricKey: 'total_current', yearA: 2005 });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.coverage['2005'].missingCount, 0);
});

// ---------------------------------------------------------------------------
// LEGACY REGRESSION (items 38-42): compare adds; ranking/YoY/movement stay.
// ---------------------------------------------------------------------------
test('Phase 4.38-42: legacy country analytics unchanged beside the new routes', async () => {
  const { db } = await seedEdgeCaseDb();
  const { base, close } = await startApp(db);
  try {
    // Edge-case golden anchors (mirror server.test.js expectations).
    const ranking = await getJSON(base, '/api/ranking?indicator=nominal_current&year=2005&search=IND');
    assert.equal(ranking.body.search.matches[0].rank, 5);
    const verify = await getJSON(base, '/api/ranking/verify?indicator=nominal_current&year=2005&country=IND&neighbors=2');
    assert.equal(verify.body.focus.rank, 5);
    const yearly = await getJSON(base, '/api/india/gdp-ranking?startYear=2003&endYear=2005');
    const y2005 = yearly.body.rows.find((r) => r.year === 2005);
    assert.equal(y2005.nominal_current.indiaRank, 5);
    assert.equal(y2005.nominal_current.total, 6);
    const movement = await getJSON(base, '/api/comparison/level?indicator=nominal_current&yearA=2004&yearB=2005&country=IND&detail=full');
    assert.equal(movement.body.verification.passed, true);
    const coverage = await getJSON(base, '/api/coverage?year=2005');
    assert.ok(coverage.body.metrics.length > 0);
  } finally {
    await close();
  }
});
