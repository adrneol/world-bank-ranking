import { describe, expect, it } from 'vitest';

import { BASIS_GUIDE, FAMILY_GUIDE, METRIC_SOURCES } from './methodologyDetails.js';

// Every basis id the backend catalogs can emit (frozen domain ids mirrored
// in frontend movementBases). If the engine adds a basis, this list — and
// the documentation — must grow with it; the test fails loudly otherwise.
const EXPECTED_BASIS_IDS = [
  'cpi_index_annual',
  'cpi_index_period_change',
  'cpi_inflation_annual',
  'cpi_inflation_average',
  'cpi_inflation_cumulative',
  'deflator_annual',
  'deflator_average',
  'deflator_cumulative',
  'exp_annual_value',
  'exp_period_cagr',
  'exp_period_total',
  'exp_period_average',
  'imp_annual_value',
  'imp_period_cagr',
  'imp_period_total',
  'imp_period_average',
  'fdi_annual_value',
  'fdi_period_cumulative',
  'fdi_period_average',
  'fdigdp_annual_value',
  'fdigdp_period_average',
  'fdigdp_period_cumulative_share',
  'fx_annual_rate',
  'fx_annual_change',
  'fx_period_change',
  'ca_annual_gdp',
  'ca_average_gdp',
  'ca_cumulative_share',
  'res_annual_stock',
  'res_period_change',
  'res_import_coverage',
  'remit_annual_value',
  'remit_period_cumulative',
  'remit_period_average',
  'remit_cumulative_intensity',
  'pop_annual_value',
  'pop_period_change',
  'pop_period_growth',
  'level',
  'growth',
  'period_total',
  'period_average',
];

describe('methodology documentation content', () => {
  it('documents every approved basis id with how/period/distinct content', () => {
    for (const id of EXPECTED_BASIS_IDS) {
      const guide = BASIS_GUIDE[id];
      expect(guide, `BASIS_GUIDE covers ${id}`).toBeTruthy();
      expect(guide.how?.length > 20, `${id} explains the calculation`).toBe(true);
      expect(guide.period?.length > 10, `${id} states the period rule`).toBe(true);
      expect(guide.distinct?.length > 10, `${id} distinguishes itself`).toBe(true);
      expect(Array.isArray(guide.caveats), `${id} caveats is a list`).toBe(true);
      expect(guide.eligibility?.length > 10, `${id} states eligibility`).toBe(true);
    }
  });

  it('covers all eight families with benchmark/universe/missing guidance', () => {
    for (const key of ['gdp_per_capita', 'gdp_total', 'prices', 'trade', 'capital_flows', 'exchange', 'external', 'population']) {
      const family = FAMILY_GUIDE[key];
      expect(family, `FAMILY_GUIDE covers ${key}`).toBeTruthy();
      expect(family.benchmark?.length > 20, `${key} benchmark`).toBe(true);
      expect(family.universe?.length > 20, `${key} universe`).toBe(true);
      expect(family.missing?.length > 10, `${key} missing-data rule`).toBe(true);
    }
  });

  it('attributes every Phase-5 metric to a friendly source file', () => {
    for (const key of [
      'inflation_cpi_index', 'inflation_cpi', 'inflation_deflator',
      'exports_current', 'imports_current',
      'fdi_inflows', 'fdi_inflows_pct_gdp', 'fx_official',
      'current_account', 'reserves_ex_gold', 'remittances_received',
      'population_total',
    ]) {
      const source = METRIC_SOURCES[key];
      expect(source?.file?.length > 0, `${key} names its methodology file`).toBe(true);
      expect(source?.label?.length > 0, `${key} has a friendly source name`).toBe(true);
    }
  });
});
