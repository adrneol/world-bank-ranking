/**
 * SUBJECT & METRIC REGISTRY TESTS.
 *
 * Guards the curated registry itself:
 *   - the four GDP-per-capita keys/codes/units are FROZEN (backward compatibility)
 *   - the four Total GDP keys/codes are exactly the verified raw WDI series
 *   - economically correct terminology (constant-price GDP is never "nominal")
 *   - subjects partition the registry; unknown keys/subjects fail closed
 *   - presentation hints are presentation-only (per-capita output is unchanged)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALL_METRIC_KEYS,
  METRICS,
  METRIC_KEYS,
  SUBJECT_KEYS,
  SUBJECTS,
  TOTAL_GDP_METRIC_KEYS,
  assertRegistryIntegrity,
  describeSubjects,
  getMetric,
  getSubject,
  metricKeysForSubject,
  subjectOf,
} from '../src/config.js';
import { describeMetric, formatValue } from '../src/domain/format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');

test('the GDP-per-capita subject is frozen: same keys, same order, same codes', () => {
  assert.deepEqual(METRIC_KEYS, [
    'nominal_current',
    'nominal_constant',
    'ppp_current',
    'ppp_constant',
  ]);
  assert.equal(METRICS.nominal_current.indicatorCode, 'NY.GDP.PCAP.CD');
  assert.equal(METRICS.nominal_constant.indicatorCode, 'NY.GDP.PCAP.KD');
  assert.equal(METRICS.ppp_current.indicatorCode, 'NY.GDP.PCAP.PP.CD');
  assert.equal(METRICS.ppp_constant.indicatorCode, 'NY.GDP.PCAP.PP.KD');
  assert.equal(METRICS.nominal_current.unitLong, 'current US$');
  assert.equal(METRICS.nominal_constant.unitLong, 'constant 2015 US$');
  assert.equal(METRICS.ppp_current.unitLong, 'current international $');
  assert.equal(METRICS.ppp_constant.unitLong, 'constant 2021 international $');
  for (const key of METRIC_KEYS) {
    assert.equal(METRICS[key].subject, 'gdp_per_capita', key);
  }
});

test('the Total GDP subject has exactly the four verified raw World Bank series', () => {
  assert.deepEqual(TOTAL_GDP_METRIC_KEYS, [
    'total_current',
    'total_constant',
    'total_ppp_current',
    'total_ppp_constant',
  ]);
  assert.equal(METRICS.total_current.indicatorCode, 'NY.GDP.MKTP.CD');
  assert.equal(METRICS.total_constant.indicatorCode, 'NY.GDP.MKTP.KD');
  assert.equal(METRICS.total_ppp_current.indicatorCode, 'NY.GDP.MKTP.PP.CD');
  assert.equal(METRICS.total_ppp_constant.indicatorCode, 'NY.GDP.MKTP.PP.KD');

  assert.equal(METRICS.total_current.unitLong, 'current US$');
  assert.equal(METRICS.total_constant.unitLong, 'constant 2015 US$');
  assert.equal(METRICS.total_ppp_current.unitLong, 'current international $');
  assert.equal(METRICS.total_ppp_constant.unitLong, 'constant 2021 international $');

  // Price basis, PPP flags and base years (the reference years verified in WDI).
  assert.equal(METRICS.total_current.priceBasis, 'current');
  assert.equal(METRICS.total_constant.priceBasis, 'constant');
  assert.equal(METRICS.total_constant.baseYear, 2015);
  assert.equal(METRICS.total_ppp_constant.baseYear, 2021);
  assert.equal(METRICS.total_current.baseYear, null);
  assert.equal(METRICS.total_current.ppp, false);
  assert.equal(METRICS.total_ppp_current.ppp, true);
  assert.equal(METRICS.total_ppp_constant.ppp, true);

  for (const key of TOTAL_GDP_METRIC_KEYS) {
    assert.equal(METRICS[key].subject, 'gdp_total', key);
  }
});

test('terminology: exact economist labels — nominal is current-price, real is constant-price', () => {
  // Pinned display labels. "Nominal" may ONLY describe a current-price series;
  // "real" may ONLY describe a constant-price series. There is no current-price
  // "real GDP" series, so no label may claim one.
  assert.equal(METRICS.nominal_current.label, 'Nominal — Current US$');
  assert.equal(METRICS.nominal_constant.label, 'Real — Constant 2015 US$');
  assert.equal(METRICS.ppp_current.label, 'PPP — Current international $');
  assert.equal(METRICS.ppp_constant.label, 'PPP — Constant 2021 international $');
  assert.equal(METRICS.total_current.label, 'Total GDP — Nominal — Current US$');
  assert.equal(METRICS.total_constant.label, 'Total GDP — Real — Constant 2015 US$');
  assert.equal(METRICS.total_ppp_current.label, 'Total GDP — PPP — Current international $');
  assert.equal(METRICS.total_ppp_constant.label, 'Total GDP — PPP — Constant 2021 international $');
  for (const key of ALL_METRIC_KEYS) {
    const label = METRICS[key].label;
    const constant = METRICS[key].priceBasis === 'constant';
    if (constant) {
      assert.ok(!/nominal/i.test(label), `${key} (constant-price) label must not say "nominal"`);
    } else {
      assert.ok(!/real/i.test(label), `${key} (current-price) label must not say "real"`);
    }
    assert.ok(
      !/real.*current|current.*real/i.test(label),
      `${key} label must not invent "real GDP at current prices"`,
    );
  }
});

test('only curated, usable World Bank codes are registered', () => {
  const codes = ALL_METRIC_KEYS.map((key) => METRICS[key].indicatorCode);
  // Every code is a GDP series from the two curated families.
  for (const code of codes) {
    assert.match(code, /^NY\.GDP\.(PCAP|MKTP)\./);
  }
  // Series that exist in WDI but are NOT usable here may never be registered:
  // local-currency series are not cross-country comparable, and the growth
  // indicators are percentages that the level/YoY model must not treat as levels.
  for (const forbidden of [
    'NY.GDP.MKTP.KN',
    'NY.GDP.MKTP.CN',
    'NY.GDP.MKTP.KD.ZG',
    'NY.GDP.PCAP.KD.ZG',
    'NY.GNP.PCAP.CD',
    'FP.CPI.TOTL.ZG',
    'NV.IND.TOTL.ZS',
  ]) {
    assert.ok(!codes.includes(forbidden), `${forbidden} must not be registered`);
  }
  assert.equal(new Set(codes).size, codes.length, 'indicator codes must be unique');
});

test('subjects partition the registry: every metric belongs to exactly one subject', () => {
  assert.deepEqual(SUBJECT_KEYS, ['gdp_per_capita', 'gdp_total']);
  assert.equal(SUBJECTS.gdp_per_capita.label, 'GDP per capita');
  assert.equal(SUBJECTS.gdp_total.label, 'Total GDP');
  assert.deepEqual(metricKeysForSubject('gdp_per_capita'), [...METRIC_KEYS]);
  assert.deepEqual(metricKeysForSubject('gdp_total'), [...TOTAL_GDP_METRIC_KEYS]);

  const reachable = [...metricKeysForSubject('gdp_per_capita'), ...metricKeysForSubject('gdp_total')];
  assert.deepEqual([...reachable].sort(), [...ALL_METRIC_KEYS].sort());
  assert.equal(new Set(reachable).size, reachable.length, 'no metric may be in two subjects');
  for (const key of ALL_METRIC_KEYS) {
    assert.equal(subjectOf(key), METRICS[key].subject);
    assert.ok(SUBJECT_KEYS.includes(subjectOf(key)));
  }
  assert.deepEqual(ALL_METRIC_KEYS, [...METRIC_KEYS, ...TOTAL_GDP_METRIC_KEYS]);
  assert.equal(assertRegistryIntegrity(), true);
});

test('subject and metric resolution fail closed on anything unregistered', () => {
  assert.equal(getSubject('gdp_total').key, 'gdp_total');
  assert.throws(() => getSubject('gdp'), /Unknown subject/);
  assert.throws(() => getSubject(''), /required/);
  assert.throws(() => metricKeysForSubject('total_gdp'), /Unknown subject/);
  assert.throws(() => subjectOf('not_a_metric'), /Unknown metric/);

  // An exact registered World Bank code resolves; an unregistered one never does.
  assert.equal(getMetric('NY.GDP.MKTP.CD').key, 'total_current');
  assert.equal(getMetric('NY.GDP.MKTP.PP.KD').key, 'total_ppp_constant');
  assert.throws(() => getMetric('ny.gdp.mktp.kn'), /Unknown metric/);
  assert.throws(() => getMetric('NY.GDP.TOTAL.CD'), /Unknown metric/);
});

test('describeSubjects exposes keys, labels and metric keys for the API', () => {
  const subjects = describeSubjects();
  assert.deepEqual(
    subjects.map((s) => s.key),
    ['gdp_per_capita', 'gdp_total'],
  );
  assert.deepEqual(subjects[0].metricKeys, [...METRIC_KEYS]);
  assert.deepEqual(subjects[1].metricKeys, [...TOTAL_GDP_METRIC_KEYS]);
  assert.equal(subjects[1].label, 'Total GDP');
});

test('the new indicator environment variables are documented and optional', () => {
  const envExample = fs.readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  for (const variable of [
    'WORLD_BANK_TOTAL_CURRENT_INDICATOR',
    'WORLD_BANK_TOTAL_CONSTANT_INDICATOR',
    'WORLD_BANK_TOTAL_PPP_CURRENT_INDICATOR',
    'WORLD_BANK_TOTAL_PPP_CONSTANT_INDICATOR',
  ]) {
    assert.ok(envExample.includes(variable), `.env.example must document ${variable}`);
  }
  // Defaults exist in code, so a user never has to set them.
  assert.equal(METRICS.total_current.indicatorCode, 'NY.GDP.MKTP.CD');
  assert.equal(METRICS.total_constant.indicatorCode, 'NY.GDP.MKTP.KD');
  assert.equal(METRICS.total_ppp_current.indicatorCode, 'NY.GDP.MKTP.PP.CD');
  assert.equal(METRICS.total_ppp_constant.indicatorCode, 'NY.GDP.MKTP.PP.KD');
});

test('formatValue: GDP-per-capita output is unchanged; Total GDP uses a presentation-only scale', () => {
  // Existing per-capita behaviour, frozen (numerical.test.js also pins $2,702).
  assert.equal(formatValue(2702.49, METRICS.nominal_current).formatted, '$2,702');
  assert.equal(formatValue(2481.6, METRICS.ppp_constant).formatted, '$2,482');
  assert.equal(formatValue(2702.49, METRICS.nominal_current).decimals, 0);
  assert.equal(formatValue(2702.49, METRICS.nominal_current).displayScale, undefined);

  // Total GDP: the LIVE-verified India 2025 value, raw untouched.
  const liveValue = 3956067115771.63;
  const display = formatValue(liveValue, METRICS.total_current);
  assert.equal(display.raw, liveValue, 'raw value must never be rounded or rescaled');
  assert.equal(display.formatted, '$3.96 trillion');
  assert.equal(display.displayScale, 'trillions');
  assert.equal(display.unit, 'current US$');
});

test('describeMetric tells the API/UI which subject and unit a number belongs to', () => {
  const perCapita = describeMetric(METRICS.nominal_constant);
  assert.equal(perCapita.subject, 'gdp_per_capita');
  assert.equal(perCapita.ppp, false);
  assert.equal(perCapita.baseYear, 2015);
  assert.equal(perCapita.displayScale, null);

  const total = describeMetric(METRICS.total_ppp_constant);
  assert.equal(total.subject, 'gdp_total');
  assert.equal(total.ppp, true);
  assert.equal(total.baseYear, 2021);
  assert.equal(total.displayScale, 'trillions');
  assert.equal(total.indicatorCode, 'NY.GDP.MKTP.PP.KD');
});
