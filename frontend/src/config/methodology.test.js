import { describe, expect, it } from 'vitest';

import { basesForMethodMetric, buildMethodologyTree, FAMILY_SOURCES, gdpBasesForMetric } from './methodology.js';

function metric(overrides = {}) {
  return {
    key: 'inflation_cpi',
    subject: 'prices',
    label: 'CPI inflation',
    shortLabel: 'CPI inflation',
    unit: 'annual %',
    indicatorCode: 'FP.CPI.TOTL.ZG',
    rankingDirection: 'ASC',
    observationType: 'RATE',
    validChangeTypes: ['ABSOLUTE', 'PP'],
    periodAggregation: [],
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    subjects: [
      { key: 'prices', label: 'Prices' },
      { key: 'gdp_total', label: 'Total GDP' },
    ],
    production: [
      {
        ...metric(),
        pricesBases: [
          { id: 'cpi_inflation_annual', label: 'Annual CPI inflation (%)', formula: 'A(i,t)', unit: 'annual %', rankable: true, rankDirection: 'ASC' },
        ],
      },
      {
        ...metric({
          key: 'total_current',
          subject: 'gdp_total',
          label: 'Total GDP nominal',
          unit: 'current US$',
          indicatorCode: 'NY.GDP.MKTP.CD',
          rankingDirection: 'DESC',
          observationType: 'LEVEL',
          validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
          periodAggregation: [],
        }),
      },
    ],
    methodology: { universeRule: 'eligible only', pricesMovement: 'prices paragraph' },
    ...overrides,
  };
}

describe('methodology tree', () => {
  it('fails closed to null on malformed payloads', () => {
    expect(buildMethodologyTree(null)).toBeNull();
    expect(buildMethodologyTree({})).toBeNull();
    expect(buildMethodologyTree({ production: [], subjects: [] })).toBeNull();
    expect(buildMethodologyTree({ production: [{ key: 'x' }], subjects: [{ key: 'prices' }] })).toBeNull();
    expect(buildMethodologyTree(payload({ subjects: [{ label: 'no key' }] }))).toBeNull();
  });

  it('mirrors subjects, metrics and backend basis catalogs', () => {
    const tree = buildMethodologyTree(payload());
    expect(tree).not.toBeNull();
    expect(tree.families).toHaveLength(2);
    const prices = tree.families.find((f) => f.key === 'prices');
    expect(prices.label).toBe('Prices');
    expect(prices.metrics).toHaveLength(1);
    expect(prices.metrics[0].bases).toHaveLength(1);
    expect(prices.metrics[0].bases[0].id).toBe('cpi_inflation_annual');
    expect(tree.methodology.pricesMovement).toBe('prices paragraph');
  });

  it('derives GDP modes from the metric’s own capability declarations', () => {
    const flow = gdpBasesForMetric(metric({ validChangeTypes: ['ABSOLUTE', 'YOY'], periodAggregation: ['SUM', 'AVG'] }));
    expect(flow.map((b) => b.id)).toEqual(['level', 'growth', 'period_total', 'period_average']);
    const level = gdpBasesForMetric(metric({ validChangeTypes: ['ABSOLUTE'], periodAggregation: [] }));
    expect(level.map((b) => b.id)).toEqual(['level']);
    const neutral = gdpBasesForMetric(metric({ rankingDirection: 'NEUTRAL' }));
    expect(neutral[0].rankable).toBe(false);
  });

  it('gives every GDP basis a formula or an explicit no-formula statement (never blank)', () => {
    const bases = gdpBasesForMetric(
      metric({ validChangeTypes: ['ABSOLUTE', 'YOY'], periodAggregation: ['SUM', 'AVG'] }),
    );
    for (const basis of bases) {
      const hasEquation = typeof basis.formula === 'string' && basis.formula.trim() !== '';
      const hasProse = typeof basis.formulaAbsent === 'string' && basis.formulaAbsent.trim() !== '';
      expect(hasEquation || hasProse, `${basis.id} must render a formula or explicit prose`).toBe(true);
    }
    const byId = Object.fromEntries(bases.map((b) => [b.id, b]));
    expect(byId.level.formula).toBeNull();
    expect(byId.level.formulaAbsent).toMatch(/stored World Bank observation/);
    expect(byId.growth.formula).toMatch(/current \/ previous/);
    expect(byId.period_total.formula).toMatch(/sum\(values\[A\.\.B-1\]\)/);
    expect(byId.period_average.formula).toMatch(/sum\(values\[A\.\.B-1\]\) \/ N/);
  });

  it('traces every subject family to source files', () => {
    for (const key of ['gdp_per_capita', 'gdp_total', 'prices', 'trade', 'capital_flows', 'exchange', 'external', 'population']) {
      expect(Array.isArray(FAMILY_SOURCES[key]?.files) && FAMILY_SOURCES[key].files.length > 0).toBe(true);
      expect(typeof FAMILY_SOURCES[key].block).toBe('string');
    }
  });

  it('prefers catalogs and never invents family bases', () => {
    const entry = { ...metric(), pricesBases: [{ id: 'x', label: 'X' }] };
    expect(basesForMethodMetric('prices', entry)).toEqual([{ id: 'x', label: 'X' }]);
    expect(basesForMethodMetric('prices', metric())).toEqual([]);
    expect(basesForMethodMetric('gdp_total', metric({ key: 't', subject: 'gdp_total' })).length).toBeGreaterThanOrEqual(1);
  });
});
