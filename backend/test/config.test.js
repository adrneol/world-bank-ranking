/**
 * CONFIGURATION TESTS (specification sections 1, 2, 28, 29, 41).
 *
 * The four indicators are fixed. A test that lets a substituted series (GNI, GDP
 * growth, inflation, another PPP series) or a manually derived constant series slip
 * in is the single most dangerous regression this application can have, so the
 * codes are asserted exactly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALL_METRIC_KEYS, CANONICAL_INDICATOR_CODES, FOCUS_COUNTRY, METRICS, METRIC_KEYS, SOURCE_INFO, config, getMetric, indicatorCodeFor } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

test('exactly four primary metrics are configured', () => {
  assert.deepEqual(METRIC_KEYS, [
    'nominal_current',
    'nominal_constant',
    'ppp_current',
    'ppp_constant',
  ]);
});

test('the four World Bank indicator codes are exact and never substituted', () => {
  // The GDP-per-capita subject is frozen: same keys, same codes, same order.
  // (Deliberate generalization, see plan §16C: the old blanket ban on the
  // substring 'NY.GDP.MKTP' existed to prevent unverified substitution. Four
  // MKTP codes are now verified members of the curated registry, so the guard
  // is an exact allow-list plus an explicit forbid-list instead of a substring
  // ban. Unverified expansion is still rejected.)
  assert.equal(METRICS.nominal_current.indicatorCode, 'NY.GDP.PCAP.CD');
  assert.equal(METRICS.nominal_constant.indicatorCode, 'NY.GDP.PCAP.KD');
  assert.equal(METRICS.ppp_current.indicatorCode, 'NY.GDP.PCAP.PP.CD');
  assert.equal(METRICS.ppp_constant.indicatorCode, 'NY.GDP.PCAP.PP.KD');

  // The Total GDP subject is exactly the four verified raw WDI series.
  assert.equal(METRICS.total_current.indicatorCode, 'NY.GDP.MKTP.CD');
  assert.equal(METRICS.total_constant.indicatorCode, 'NY.GDP.MKTP.KD');
  assert.equal(METRICS.total_ppp_current.indicatorCode, 'NY.GDP.MKTP.PP.CD');
  assert.equal(METRICS.total_ppp_constant.indicatorCode, 'NY.GDP.MKTP.PP.KD');

  // Phase-5 promotions: twelve live-verified WDI series across six subjects.
  assert.equal(METRICS.inflation_cpi.indicatorCode, 'FP.CPI.TOTL.ZG');
  assert.equal(METRICS.inflation_cpi_index.indicatorCode, 'FP.CPI.TOTL');
  assert.equal(METRICS.inflation_deflator.indicatorCode, 'NY.GDP.DEFL.KD.ZG');
  assert.equal(METRICS.fx_official.indicatorCode, 'PA.NUS.FCRF');
  assert.equal(METRICS.exports_current.indicatorCode, 'NE.EXP.GNFS.CD');
  assert.equal(METRICS.imports_current.indicatorCode, 'NE.IMP.GNFS.CD');
  assert.equal(METRICS.fdi_inflows.indicatorCode, 'BX.KLT.DINV.CD.WD');
  assert.equal(METRICS.fdi_inflows_pct_gdp.indicatorCode, 'BX.KLT.DINV.WD.GD.ZS');
  assert.equal(METRICS.current_account.indicatorCode, 'BN.CAB.XOKA.CD');
  assert.equal(METRICS.reserves_ex_gold.indicatorCode, 'FI.RES.XGLD.CD');
  assert.equal(METRICS.remittances_received.indicatorCode, 'BX.TRF.PWKR.CD.DT');
  assert.equal(METRICS.population_total.indicatorCode, 'SP.POP.TOTL');

  // The curated registry is exactly these twenty codes — no more, no fewer.
  const allowed = [
    'NY.GDP.PCAP.CD',
    'NY.GDP.PCAP.KD',
    'NY.GDP.PCAP.PP.CD',
    'NY.GDP.PCAP.PP.KD',
    'NY.GDP.MKTP.CD',
    'NY.GDP.MKTP.KD',
    'NY.GDP.MKTP.PP.CD',
    'NY.GDP.MKTP.PP.KD',
    'FP.CPI.TOTL.ZG',
    'FP.CPI.TOTL',
    'NY.GDP.DEFL.KD.ZG',
    'PA.NUS.FCRF',
    'NE.EXP.GNFS.CD',
    'NE.IMP.GNFS.CD',
    'BX.KLT.DINV.CD.WD',
    'BX.KLT.DINV.WD.GD.ZS',
    'BN.CAB.XOKA.CD',
    'FI.RES.XGLD.CD',
    'BX.TRF.PWKR.CD.DT',
    'SP.POP.TOTL',
  ];
  const codes = ALL_METRIC_KEYS.map((key) => METRICS[key].indicatorCode);
  assert.equal(ALL_METRIC_KEYS.length, 20);
  assert.equal(new Set(codes).size, 20, 'each metric must use its own indicator code');
  assert.deepEqual([...codes].sort(), [...allowed].sort());

  // Series that exist in WDI but are NOT usable here may never be registered:
  // local-currency levels are not cross-country comparable, growth percentages
  // must never enter the level/YoY engine, and unrelated families (GNI,
  // industry share) are out of scope. (FP.CPI.TOTL.ZG left this forbid-list
  // at Phase-5 promotion: CPI inflation is now a verified production metric.)
  for (const forbidden of [
    'NY.GDP.MKTP.KN',
    'NY.GDP.MKTP.CN',
    'NY.GDP.MKTP.KD.ZG',
    'NY.GDP.PCAP.KD.ZG',
    'NY.GNP.PCAP.CD',
    'NV.IND.TOTL.ZS',
    'NY.GDP.TOTAL.CD',
  ]) {
    assert.ok(!codes.includes(forbidden), `${forbidden} must not be registered`);
  }
});

test('units and base years are declared for every metric', () => {
  assert.equal(METRICS.nominal_current.unitLong, 'current US$');
  assert.equal(METRICS.nominal_constant.unitLong, 'constant 2015 US$');
  assert.equal(METRICS.ppp_current.unitLong, 'current international $');
  assert.equal(METRICS.ppp_constant.unitLong, 'constant 2021 international $');

  // A constant series must never be derived from a current series at runtime.
  assert.equal(METRICS.nominal_current.priceBasis, 'current');
  assert.equal(METRICS.nominal_constant.priceBasis, 'constant');
  assert.equal(METRICS.ppp_current.priceBasis, 'current');
  assert.equal(METRICS.ppp_constant.priceBasis, 'constant');
});

test('getMetric accepts a metric key and an exact indicator code only', () => {
  assert.equal(getMetric('ppp_constant').indicatorCode, 'NY.GDP.PCAP.PP.KD');
  assert.equal(getMetric('NY.GDP.PCAP.PP.KD').key, 'ppp_constant');
  assert.throws(() => getMetric('ny.gnp.pcap.cd'), /Unknown metric/);
  assert.throws(() => getMetric('nominal'), /Unknown metric/);
  assert.throws(() => getMetric(''), /required/);
});

test('the World Bank API base URL and the no-API-key rule', () => {
  assert.match(config.worldBank.baseUrl, /^https?:\/\//);
  assert.equal(config.worldBank.baseUrl.endsWith('/'), false);
  const envExample = fs.readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  assert.ok(!/api[_-]?key/i.test(envExample), '.env.example must not invent an API key');
  assert.match(envExample, /NO API KEY/i);
});

test('.env.example documents the indicator variables and the defaults', () => {
  const envExample = fs.readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  for (const variable of [
    'WORLD_BANK_API_BASE_URL',
    'WORLD_BANK_NOMINAL_CURRENT_INDICATOR',
    'WORLD_BANK_NOMINAL_CONSTANT_INDICATOR',
    'WORLD_BANK_PPP_CURRENT_INDICATOR',
    'WORLD_BANK_PPP_CONSTANT_INDICATOR',
    'WORLD_BANK_TOTAL_CURRENT_INDICATOR',
    'WORLD_BANK_TOTAL_CONSTANT_INDICATOR',
    'WORLD_BANK_TOTAL_PPP_CURRENT_INDICATOR',
    'WORLD_BANK_TOTAL_PPP_CONSTANT_INDICATOR',
    'WORLD_BANK_INFLATION_CPI_INDICATOR',
    'WORLD_BANK_INFLATION_CPI_INDEX_INDICATOR',
    'WORLD_BANK_INFLATION_DEFLATOR_INDICATOR',
    'WORLD_BANK_FX_OFFICIAL_INDICATOR',
    'WORLD_BANK_EXPORTS_CURRENT_INDICATOR',
    'WORLD_BANK_IMPORTS_CURRENT_INDICATOR',
    'WORLD_BANK_FDI_INFLOWS_INDICATOR',
    'WORLD_BANK_FDI_INFLOWS_PCT_GDP_INDICATOR',
    'WORLD_BANK_CURRENT_ACCOUNT_INDICATOR',
    'WORLD_BANK_RESERVES_EX_GOLD_INDICATOR',
    'WORLD_BANK_REMITTANCES_RECEIVED_INDICATOR',
    'WORLD_BANK_POPULATION_TOTAL_INDICATOR',
    'DEFAULT_START_YEAR',
    'DEFAULT_END_YEAR',
    'INGEST_START_YEAR',
    'INGEST_END_YEAR',
    'REFRESH_ADMIN_TOKEN',
    'CORS_ORIGINS',
    'REFRESH_RATE_LIMIT_MAX',
    'REFRESH_RATE_LIMIT_WINDOW_MS',
    'CACHE_TTL_HOURS',
    'RANK_NEIGHBORS_DEFAULT',
  ]) {
    assert.ok(envExample.includes(variable), `.env.example must document ${variable}`);
  }
});

test('ingestion range reaches historical World Bank data while UI defaults stay put', () => {
  // The default ANALYSIS view still opens at 2000; only ingestion reaches back.
  assert.equal(config.ingestStartYear, 1960);
  assert.equal(config.ingestEndYear, new Date().getFullYear());
});

test('canonical indicator codes are frozen and every metric resolves to its own', () => {
  assert.deepEqual(CANONICAL_INDICATOR_CODES, {
    nominal_current: 'NY.GDP.PCAP.CD',
    nominal_constant: 'NY.GDP.PCAP.KD',
    ppp_current: 'NY.GDP.PCAP.PP.CD',
    ppp_constant: 'NY.GDP.PCAP.PP.KD',
    total_current: 'NY.GDP.MKTP.CD',
    total_constant: 'NY.GDP.MKTP.KD',
    total_ppp_current: 'NY.GDP.MKTP.PP.CD',
    total_ppp_constant: 'NY.GDP.MKTP.PP.KD',
    inflation_cpi: 'FP.CPI.TOTL.ZG',
    inflation_cpi_index: 'FP.CPI.TOTL',
    inflation_deflator: 'NY.GDP.DEFL.KD.ZG',
    fx_official: 'PA.NUS.FCRF',
    exports_current: 'NE.EXP.GNFS.CD',
    imports_current: 'NE.IMP.GNFS.CD',
    fdi_inflows: 'BX.KLT.DINV.CD.WD',
    fdi_inflows_pct_gdp: 'BX.KLT.DINV.WD.GD.ZS',
    current_account: 'BN.CAB.XOKA.CD',
    reserves_ex_gold: 'FI.RES.XGLD.CD',
    remittances_received: 'BX.TRF.PWKR.CD.DT',
    population_total: 'SP.POP.TOTL',
  });
  for (const key of ALL_METRIC_KEYS) {
    assert.equal(indicatorCodeFor(key), CANONICAL_INDICATOR_CODES[key]);
    assert.equal(METRICS[key].indicatorCode, CANONICAL_INDICATOR_CODES[key]);
  }
});

test('defaults match the specification and the focus country is India', () => {
  assert.equal(config.defaultStartYear, 2000);
  assert.equal(config.defaultEndYear, 2025);
  assert.ok(config.cacheTtlHours > 0);
  assert.ok(Number.isInteger(config.neighborsDefault) && config.neighborsDefault >= 1);
  assert.deepEqual(FOCUS_COUNTRY, { iso3: 'IND', name: 'India' });
});

test('rank attribution never claims the World Bank publishes the rank', () => {
  assert.match(SOURCE_INFO.rankWording, /Rank calculated from World Bank WDI observations\./);
  assert.match(SOURCE_INFO.rankDisclaimer, /calculated by this application/);
  assert.match(SOURCE_INFO.rankDisclaimer, /does not publish the rank/);
  assert.equal(SOURCE_INFO.provider, 'World Bank');
});

test('source attribution links to the official World Bank documentation', () => {
  assert.equal(SOURCE_INFO.apiDocumentation.length >= 2, true);
  for (const url of SOURCE_INFO.apiDocumentation) {
    assert.match(url, /^https:\/\/datahelpdesk\.worldbank\.org\//);
  }
  for (const key of METRIC_KEYS) {
    assert.match(METRICS[key].worldBankPage, /^https:\/\/data\.worldbank\.org\/indicator\//);
  }
});