/**
 * PHASE 7C-2 TESTS — groups / compare methodology + entity capability.
 *
 * Covers the §29 matrix: country↔country, country↔group, group↔country,
 * group↔group, weighted FDI/GDP ratio (complete/missing/basis/vintage),
 * SUM matrix, non-additive refusals, official aggregates, labels, member
 * validation, LFL, frontend capability gating, GDP regression.
 *
 * Import discipline: no static src/* imports (config freezes env at
 * import); backend src modules dynamic after the stub. Frontend gating
 * helpers are pure ESM and hydrate from backend metadata in-test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { liveIndia2024 } from './fixtures/phase5.js';
import { startStubWorldBank, useStubBaseUrl } from './helpers/stubWorldBank.js';

let stub = null;

test.before(async () => {
  stub = await startStubWorldBank();
  useStubBaseUrl(stub.baseUrl);
  process.env.WB_RETRY_BASE_MS = '5';
  process.env.WB_MAX_RETRIES = '2';
});

test.after(async () => {
  await stub?.close();
  stub = null;
});

async function freshDb() {
  const { createMemoryDb } = await import('../src/db/index.js');
  return await createMemoryDb();
}

async function ingestFull(db, years = { startYear: 2024, endYear: 2025 }) {
  const { refreshData } = await import('../src/wb/ingest.js');
  stub.reset();
  return await refreshData({ db, startYear: years.startYear, endYear: years.endYear, trigger: 'test' });
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

async function hydrateFrontendFromBackend() {
  const config = await import('../src/config.js');
  const { describeMeasure } = await import('../src/domain/format.js');
  const frontend = await import('../../frontend/src/config/metrics.js');
  const production = config.PRODUCTION_METRIC_KEYS.map((key) => describeMeasure(config.getDefinedMetric(key)));
  const subjects = config.SUBJECT_KEYS.map((key) => ({ key, label: config.SUBJECTS[key].label }));
  assert.equal(frontend.hydrateRegistry({ production, subjects }), true);
  return frontend;
}

async function obsValue(db, metricKey, iso3, year) {
  const repository = await import('../src/db/repository.js');
  const indicator = await repository.getIndicatorByMetricKey(db, metricKey);
  const row = await repository.getObservation(db, iso3, indicator.id, year);
  return row ? row.value : null;
}

// ---------------------------------------------------------------------------
// 7C2.1 Country x Country (incl. NEUTRAL level refusal)
// ---------------------------------------------------------------------------
test('Phase 7C-2.1: country pairs — level/change work; NEUTRAL level refuses', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const level = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=total_current&yearA=2024&operation=level`)
    ).json();
    assert.equal(level.results.comparison.available, true);
    assert.equal(level.results.a.source, 'WORLD_BANK', 'country legs stay RAW observations');
    // Raw cross-currency FX level: disabled, not ranked-as-strength.
    for (const indicator of ['fx_official', 'inflation_cpi_index']) {
      const res = await fetch(
        `${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=${indicator}&yearA=2024&operation=level`,
      );
      assert.equal(res.status, 400, indicator);
      assert.equal((await res.json()).error.code, 'UNSUPPORTED_ENTITY_COMBINATION', indicator);
    }
    // Same-entity identity remains allowed (no cross-entity claim involved).
    const self = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:IND&indicator=fx_official&yearA=2024&operation=level`)
    ).json();
    assert.equal(self.results.comparison.available, true);
    // Declared FX movement still computes country to country.
    const move = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=country:USA&indicator=fx_official&yearA=2024&yearB=2025&operation=percent_change`)
    ).json();
    assert.equal(move.results.comparison.a.computable, true);
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.2/7C2.3 SUM matrix + all group directions
// ---------------------------------------------------------------------------
test('Phase 7C-2.2: SUM matrix and Country<->Group<->Group directions', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // SUM matrix over group IND,XKX (factor 0.0025; CA factor 0.001).
    const cases = [
      ['exports_current', 1.0025],
      ['imports_current', 1.0025],
      ['fdi_inflows', 1.0025],
      ['current_account', 1.001],
      ['remittances_received', 1.0025],
      ['population_total', 1.0025],
      ['reserves_ex_gold', 1.0025],
    ];
    for (const [metricKey, factor] of cases) {
      const res = await (
        await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,XKX&indicator=${metricKey}&yearA=2024&operation=level`)
      ).json();
      const expected = liveIndia2024(metricKey) * factor;
      const got = res.results.b.observed['2024'].value;
      assert.ok(Math.abs(got - expected) < Math.abs(expected) * 1e-9 + 1, `${metricKey}: ${got} vs ${expected}`);
      assert.equal(res.results.b.source, 'USER_DEFINED');
      assert.equal(res.results.b.observed['2024'].provenance, 'APP_DERIVED');
    }
    // Total GDP group SUM unchanged (legacy SUM path intact).
    const gdp = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,XKX&indicator=total_current&yearA=2024&operation=level`)
    ).json();
    const [gInd, gXkx] = await Promise.all([obsValue(db, 'total_current', 'IND', 2024), obsValue(db, 'total_current', 'XKX', 2024)]);
    assert.ok(Math.abs(gdp.results.b.observed['2024'].value - (gInd + gXkx)) < 1);
    assert.equal(gdp.results.b.observed['2024'].derivation.operation, 'GROUP_SUM');
    // All three group directions agree on the same group value.
    const ab = await (
      await fetch(`${base}/api/compare?entityA=country:USA&entityB=group:IND,XKX&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    const ba = await (
      await fetch(`${base}/api/compare?entityA=group:IND,XKX&entityB=country:USA&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    const gg = await (
      await fetch(`${base}/api/compare?entityA=group:IND,XKX&entityB=group:USA,DEU&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    assert.equal(ab.results.b.observed['2024'].value, ba.results.a.observed['2024'].value);
    assert.equal(gg.results.a.observed['2024'].value, ab.results.b.observed['2024'].value);
    assert.ok(gg.results.b.observed['2024'].value > 0, 'Group x Group computes both sides');
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.3 Non-additive refusals (defense in depth: UI gates + API 400s)
// ---------------------------------------------------------------------------
test('Phase 7C-2.3: per-capita, inflation, index and FX groups refuse cleanly', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    for (const [indicator, code] of [
      ['nominal_current', 'NOT_AGGREGATABLE'],
      ['inflation_cpi', 'NOT_AGGREGATABLE'],
      ['inflation_cpi_index', 'NOT_AGGREGATABLE'],
      ['fx_official', 'NOT_AGGREGATABLE'],
    ]) {
      const res = await fetch(
        `${base}/api/compare?entityA=country:IND&entityB=group:IND,CHN&indicator=${indicator}&yearA=2024&operation=level`,
      );
      assert.equal(res.status, 400, indicator);
      assert.equal((await res.json()).error.code, code, indicator);
    }
    // Cross-rate with any non-country entity refuses before legs validate.
    const cross = await fetch(
      `${base}/api/compare?entityA=country:IND&entityB=group:IND,CHN&indicator=fx_official&yearA=2024&operation=cross_rate`,
    );
    assert.equal(cross.status, 400);
    assert.equal((await cross.json()).error.code, 'UNSUPPORTED_ENTITY_COMBINATION');
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.4 Weighted FDI/GDP ratio (complete group, exact formula)
// ---------------------------------------------------------------------------
test('Phase 7C-2.4: weighted group ratio uses legs, never member-mean', async () => {
  const db = await freshDb();
  // Break cross-fixture proportionality (DEU FDI x2) so weighted-mean and
  // simple-mean provably differ; GDP legs untouched.
  stub.reset();
  const repository = await import('../src/db/repository.js');
  void repository;
  stub.state.seriesRowsFor = (metricKey, baseRows) =>
    metricKey === 'fdi_inflows'
      ? baseRows.map((row) =>
        row.countryiso3code === 'DEU' && row.date === '2024' ? { ...row, value: row.value * 2 } : row,
      )
      : baseRows;
  const { refreshData } = await import('../src/wb/ingest.js');
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  stub.state.seriesRowsFor = null;
  const { base, close } = await startApp(db);
  try {
    const res = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&indicator=fdi_inflows_pct_gdp&yearA=2024&operation=level`)
    ).json();
    const group = res.results.b;
    const fdiInd = await obsValue(db, 'fdi_inflows', 'IND', 2024);
    const fdiDeu = await obsValue(db, 'fdi_inflows', 'DEU', 2024);
    const gdpInd = await obsValue(db, 'total_current', 'IND', 2024);
    const gdpDeu = await obsValue(db, 'total_current', 'DEU', 2024);
    const weighted = ((fdiInd + fdiDeu) / (gdpInd + gdpDeu)) * 100;
    assert.ok(Math.abs(group.observed['2024'].value - weighted) < 1e-9, `weighted legs, got ${group.observed['2024'].value} vs ${weighted}`);
    assert.equal(group.observed['2024'].provenance, 'APP_DERIVED');
    assert.equal(group.observed['2024'].derivation.operation, 'GROUP_RATIO_FROM_SUMS');
    assert.equal(group.observed['2024'].derivation.numeratorMetric, 'fdi_inflows');
    assert.equal(group.observed['2024'].derivation.denominatorMetric, 'total_current');
    // The forbidden computation provably differs here — and was not used.
    const ratioInd = await obsValue(db, 'fdi_inflows_pct_gdp', 'IND', 2024);
    const ratioDeu = await obsValue(db, 'fdi_inflows_pct_gdp', 'DEU', 2024);
    const simpleMean = (ratioInd + ratioDeu) / 2;
    assert.ok(Math.abs(weighted - simpleMean) > 1e-9, 'fixture distinguishes weighted from mean');
    assert.ok(Math.abs(group.observed['2024'].value - simpleMean) > 1e-9, 'response is not the member mean');
    assert.deepEqual(group.coverage['2024'].missingNumerators, []);
    assert.deepEqual(group.coverage['2024'].missingDenominators, []);
  } finally {
    await close();
  }
  db.close();
  stub.reset();
});

// ---------------------------------------------------------------------------
// 7C2.5 Missing legs refuse with affected members
// ---------------------------------------------------------------------------
test('Phase 7C-2.5: missing numerator/denominator legs refuse, never partial', async () => {
  const db = await freshDb();
  stub.reset();
  stub.state.seriesRowsFor = (metricKey, baseRows) =>
    metricKey === 'fdi_inflows'
      ? baseRows.map((row) =>
        row.countryiso3code === 'DEU' && row.date === '2024' ? { ...row, value: null } : row,
      )
      : baseRows;
  const { refreshData } = await import('../src/wb/ingest.js');
  await refreshData({ db, startYear: 2024, endYear: 2025, trigger: 'test' });
  stub.state.seriesRowsFor = null;
  const { base, close } = await startApp(db);
  try {
    const res = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&indicator=fdi_inflows_pct_gdp&yearA=2024&operation=level`)
    ).json();
    const observed = res.results.b.observed['2024'];
    assert.equal(observed.value, null, 'no partial ratio from one leg');
    assert.equal(observed.reason, 'MISSING_REQUIRED_DATA');
    assert.deepEqual(res.results.b.coverage['2024'].missingNumerators, ['DEU']);
    assert.deepEqual(res.results.b.coverage['2024'].missingDenominators, []);
  } finally {
    await close();
  }
  db.close();
  stub.reset();
  // Denominator-missing mirror.
  const db2 = await freshDb();
  stub.reset();
  stub.state.seriesRowsFor = (metricKey, baseRows) =>
    metricKey === 'total_current'
      ? baseRows.map((row) =>
        row.countryiso3code === 'DEU' && row.date === '2024' ? { ...row, value: null } : row,
      )
      : baseRows;
  const { refreshData: refresh2 } = await import('../src/wb/ingest.js');
  await refresh2({ db: db2, startYear: 2024, endYear: 2025, trigger: 'test' });
  stub.state.seriesRowsFor = null;
  const app2 = await startApp(db2);
  try {
    const res = await (
      await fetch(`${app2.base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&indicator=fdi_inflows_pct_gdp&yearA=2024&operation=level`)
    ).json();
    assert.equal(res.results.b.observed['2024'].value, null);
    assert.equal(res.results.b.observed['2024'].reason, 'MISSING_REQUIRED_DATA');
    assert.deepEqual(res.results.b.coverage['2024'].missingDenominators, ['DEU']);
  } finally {
    await app2.close();
  }
  db2.close();
  stub.reset();
});

// ---------------------------------------------------------------------------
// 7C2.6 Basis + vintage branches (unit, via exported builder)
// ---------------------------------------------------------------------------
test('Phase 7C-2.6: weighted-ratio basis and vintage incompatibility refuse', async () => {
  const { METRICS } = await import('../src/config.js');
  const { buildGroupRatioSeries } = await import('../src/services/entityCompare.js');
  const metric = METRICS.fdi_inflows_pct_gdp;
  const denMetric = METRICS.total_current;
  const byYear = (rows) => new Map([[2024, rows]]);
  const entity = { members: ['DEU', 'IND'] };
  const legs = (vint) => [
    { iso3: 'IND', value: 10, wbLastUpdated: vint },
    { iso3: 'DEU', value: 20, wbLastUpdated: vint },
  ];
  const gdp = (vint) => [
    { iso3: 'IND', value: 1000, wbLastUpdated: vint },
    { iso3: 'DEU', value: 2000, wbLastUpdated: vint },
  ];
  // Happy path: (10+20)/(1000+2000)*100 = 1.
  const ok = buildGroupRatioSeries(entity, byYear(legs('2024-01-01')), byYear(gdp('2024-01-01')), [2024], metric, denMetric);
  assert.equal(ok.observed['2024'].value, 1);
  assert.equal(ok.observed['2024'].reason, null);
  // Mixed vintage across legs refuses.
  const mixedDen = [
    { iso3: 'IND', value: 1000, wbLastUpdated: '2024-01-01' },
    { iso3: 'DEU', value: 2000, wbLastUpdated: '2025-06-01' },
  ];
  const mixed = buildGroupRatioSeries(entity, byYear(legs('2024-01-01')), byYear(mixedDen), [2024], metric, denMetric);
  assert.equal(mixed.observed['2024'].value, null);
  assert.equal(mixed.observed['2024'].reason, 'INCOMPATIBLE_LEGS');
  assert.match(mixed.observed['2024'].detail, /vintage/);
  // Mismatched basis refuses (declared linkage, not hard-coded series).
  const wrongBasis = { ...denMetric, priceBasis: 'constant' };
  const basis = buildGroupRatioSeries(entity, byYear(legs('2024-01-01')), byYear(gdp('2024-01-01')), [2024], metric, wrongBasis);
  assert.equal(basis.observed['2024'].value, null);
  assert.equal(basis.observed['2024'].reason, 'INCOMPATIBLE_LEGS');
  assert.match(basis.observed['2024'].detail, /basis/);
});

// ---------------------------------------------------------------------------
// 7C2.7 LFL: SUM gap decomposition + ratio consistency
// ---------------------------------------------------------------------------
test('Phase 7C-2.7: like-for-like common/entered/exited and membership effect', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // Exports: PAK 2025 is null in-fixture — a real coverage gap.
    const res = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,PAK&indicator=exports_current&yearA=2024&yearB=2025&operation=absolute_change&groupMode=like_for_like`)
    ).json();
    const group = res.results.b;
    const E = liveIndia2024('exports_current');
    assert.deepEqual(group.coverage.common, ['IND']);
    assert.deepEqual(group.coverage.observedOnlyA, ['PAK']);
    assert.deepEqual(group.coverage.observedOnlyB, []);
    // Membership effect equals the removed member's 2024 flow (exact).
    assert.ok(Math.abs(group.membershipEffect.absolute - -0.09 * E) < 1, `effect ${group.membershipEffect.absolute} vs ${-0.09 * E}`);
    // Ratio group, full common membership: observed == LFL, effect zero.
    const ratio = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&indicator=fdi_inflows_pct_gdp&yearA=2024&yearB=2025&operation=pp_change&groupMode=like_for_like`)
    ).json();
    assert.deepEqual(ratio.results.b.coverage.common.sort(), ['DEU', 'IND']);
    assert.ok(Math.abs(ratio.results.b.membershipEffect.absolute) < 1e-9, 'full-common ratio effect is zero');
    assert.ok(Number.isFinite(ratio.results.comparison.a.value), 'pp change on ratio group computes');
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.8 Labels end-to-end + member validation
// ---------------------------------------------------------------------------
test('Phase 7C-2.8: labels survive; member validation fails closed', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const labeled = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&labelB=${encodeURIComponent('Test Peers')}&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    assert.equal(labeled.entities.b.label, 'Test Peers');
    assert.equal(labeled.results.b.label, 'Test Peers');
    assert.match(labeled.results.b.label, /^(?!.*(Asia|Africa|region)).*$/i, 'custom label never masquerades');
    const unlabeled = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=group:IND,DEU&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    assert.equal(unlabeled.entities.b.label, 'User-selected group (2)');
    // Over-long label refused; labels on countries refused.
    for (const [query, code] of [
      [`entityA=country:IND&entityB=group:IND,DEU&labelB=${'x'.repeat(81)}`, 'INVALID_GROUP'],
      [`entityA=country:IND&labelA=Nope&entityB=country:USA`, 'INVALID_ENTITY'],
      [`entityA=country:IND&entityB=group:`, 'EMPTY_GROUP'],
      [`entityA=country:IND&entityB=group:IND,IND`, 'INVALID_GROUP'],
      [`entityA=country:IND&entityB=group:IND,XX`, 'INVALID_GROUP_MEMBER'],
      [`entityA=country:IND&entityB=group:IND,XYZ`, 'INVALID_GROUP_MEMBER'],
      [`entityA=country:IND&entityB=group:IND,WLD`, 'INVALID_GROUP_MEMBER'],
    ]) {
      const res = await fetch(`${base}/api/compare?${query}&indicator=exports_current&yearA=2024&operation=level`);
      assert.equal(res.status, 400, query);
      assert.equal((await res.json()).error.code, code, query);
    }
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.9 Official aggregates: published use, no synthesis, explicit messages
// ---------------------------------------------------------------------------
test('Phase 7C-2.9: aggregates read published values; gaps stay gaps', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    // WLD exports: the published aggregate, not a member sum.
    const agg = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=aggregate:WLD&indicator=exports_current&yearA=2024&operation=level`)
    ).json();
    assert.equal(agg.results.b.source, 'WORLD_BANK');
    assert.equal(agg.results.b.values['2024'].value, 32471017522322.1);
    assert.ok(agg.results.b.values['2024'].value > liveIndia2024('exports_current') * 30, 'world total dwarfs any member sum');
    // FX has no published WLD: unavailable, never invented.
    const fx = await (
      await fetch(`${base}/api/compare?entityA=country:IND&entityB=aggregate:WLD&indicator=fx_official&yearA=2024&operation=level`)
    ).json();
    assert.equal(fx.results.b.values['2024'].available, false);
    assert.equal(fx.results.b.values['2024'].reason, 'MISSING_REQUIRED_DATA');
    // Observations route names the aggregate path instead of "unknown".
    const obs = await fetch(`${base}/api/observations?indicator=exports_current&year=2024&country=WLD`);
    assert.equal(obs.status, 400);
    const body = await obs.json();
    assert.equal(body.error.code, 'INVALID_COUNTRY');
    assert.match(body.error.message, /aggregate/i);
  } finally {
    await close();
  }
  db.close();
});

// ---------------------------------------------------------------------------
// 7C2.10 Frontend capability gating (hydrated from backend metadata)
// ---------------------------------------------------------------------------
test('Phase 7C-2.10: UI offers only backend-valid entity/operation combos', async () => {
  const frontend = await hydrateFrontendFromBackend();
  const { operationsForEntities, supportsGroupValues } = frontend;
  const { parseEntitySpecString } = await import('../../frontend/src/components/entities.js');
  const country = (iso3) => ({ kind: 'country', iso3 });
  const group = (members) => ({ kind: 'custom_group', members });
  const avail = (list) => Object.fromEntries(list.map((op) => [op.id, op.available]));
  // Per-capita + group: nothing offered (backend 400s all of them).
  const pc = avail(operationsForEntities('nominal_current', country('IND'), group(['IND', 'CHN'])));
  assert.ok(Object.values(pc).every((v) => v === false), 'per-capita group offers nothing');
  // FX + group + cross_rate: refused; FX country-country percent: offered.
  const fxg = avail(operationsForEntities('fx_official', country('IND'), group(['IND', 'CHN'])));
  assert.equal(fxg.cross_rate, false);
  assert.equal(fxg.level, false);
  const fxp = avail(operationsForEntities('fx_official', country('IND'), country('USA')));
  assert.equal(fxp.percent_change, true, 'FX movement stays offered');
  assert.equal(fxp.level, false, 'NEUTRAL cross-country level hidden');
  assert.equal(fxp.cross_rate, true);
  // Index country-country level hidden; pp endpoint change stays.
  const idx = avail(operationsForEntities('inflation_cpi_index', country('IND'), country('USA')));
  assert.equal(idx.level, false);
  assert.equal(idx.index_point_change, true);
  // Exports group level offered; weighted-ratio group level offered.
  assert.equal(avail(operationsForEntities('exports_current', country('IND'), group(['IND', 'DEU']))).level, true);
  assert.equal(avail(operationsForEntities('fdi_inflows_pct_gdp', country('IND'), group(['IND', 'DEU']))).level, true);
  assert.equal(avail(operationsForEntities('fdi_inflows_pct_gdp', country('IND'), group(['IND', 'DEU']))).pp_change, true);
  assert.equal(avail(operationsForEntities('fdi_inflows_pct_gdp', country('IND'), group(['IND', 'DEU']))).percent_change, false);
  // Group offer follows aggregation metadata.
  assert.equal(supportsGroupValues('total_current'), true);
  assert.equal(supportsGroupValues('nominal_current'), false);
  assert.equal(supportsGroupValues('fdi_inflows_pct_gdp'), true);
  assert.equal(supportsGroupValues('fx_official'), false);
  assert.equal(supportsGroupValues('inflation_cpi'), false);
  // Label round-trips beside the wire spec.
  assert.deepEqual(parseEntitySpecString('group:CHN,IND', 'Peers').label, 'Peers');
  assert.equal(parseEntitySpecString('group:CHN,IND').label, null);
  assert.equal(parseEntitySpecString('group:CHN,IND', '  ').label, null);
});

// ---------------------------------------------------------------------------
// 7C2.12 Empty-group spec round-trip (browser-found: picker snapped back)
// ---------------------------------------------------------------------------
test('Phase 7C-2.12: empty group spec stays a group (builder never strands)', async () => {
  const { parseEntitySpecString, entityToSpec } = await import('../../frontend/src/components/entities.js');
  // 'group:' is an in-progress empty group, not a malformed spec.
  assert.deepEqual(parseEntitySpecString('group:'), { kind: 'custom_group', members: [], label: null });
  assert.deepEqual(parseEntitySpecString('group:', 'Peers'), { kind: 'custom_group', members: [], label: 'Peers' });
  // Emitting an empty group round-trips (stays selectable, never submits).
  assert.equal(entityToSpec({ kind: 'custom_group', members: [], label: null }), 'group:');
  assert.deepEqual(parseEntitySpecString(entityToSpec({ kind: 'custom_group', members: [], label: null })), {
    kind: 'custom_group',
    members: [],
    label: null,
  });
  // Malformed specs still fail closed.
  assert.equal(parseEntitySpecString(''), null);
  assert.equal(parseEntitySpecString('nonsense'), null);
  assert.equal(parseEntitySpecString(null), null);
});

// ---------------------------------------------------------------------------
// 7C2.11 groups/evaluate: preview incl. ratio legs (now wired by the UI)
// ---------------------------------------------------------------------------
test('Phase 7C-2.11: group evaluation validates, gates and previews legs', async () => {
  const db = await freshDb();
  await ingestFull(db);
  const { base, close } = await startApp(db);
  try {
    const ok = await (
      await fetch(`${base}/api/groups/evaluate?members=IND,DEU&indicator=exports_current&yearA=2024`)
    ).json();
    assert.equal(ok.valid, true);
    assert.equal(ok.capability.canComputeGroupValue, true);
    assert.equal(ok.coverage['2024'].validCount, 2);
    const ratio = await (
      await fetch(`${base}/api/groups/evaluate?members=IND,DEU&indicator=fdi_inflows_pct_gdp&yearA=2024`)
    ).json();
    assert.equal(ratio.capability.canComputeGroupValue, true);
    assert.equal(ratio.capability.aggregation, 'WEIGHTED_RATIO');
    assert.deepEqual(ratio.coverage['2024'].missingNumerators, []);
    assert.deepEqual(ratio.coverage['2024'].missingDenominators, []);
    assert.equal(ratio.coverage['2024'].denominatorMetric, 'total_current');
    const perCapita = await (
      await fetch(`${base}/api/groups/evaluate?members=IND,DEU&indicator=nominal_current&yearA=2024`)
    ).json();
    assert.equal(perCapita.capability.canComputeGroupValue, false);
    assert.equal(perCapita.capability.reason, 'NOT_AGGREGATABLE');
    const labeled = await (
      await fetch(`${base}/api/groups/evaluate?members=IND,DEU&label=${encodeURIComponent('Peers')}&indicator=exports_current&yearA=2024`)
    ).json();
    assert.equal(labeled.label, 'Peers');
  } finally {
    await close();
  }
  db.close();
});
