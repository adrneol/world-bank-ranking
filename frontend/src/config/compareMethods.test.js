import { describe, expect, it } from 'vitest';
import { compareMethodOptions } from './metrics.js';

describe('Compare method request mapping', () => {
  it('keeps the GDP source series separate from the selected Level operation', () => {
    for (const metricKey of [
      'total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant',
      'nominal_current', 'nominal_constant', 'ppp_current', 'ppp_constant',
    ]) {
      const level = compareMethodOptions(metricKey, { kind: 'country', iso3: 'IND' }, { kind: 'country', iso3: 'USA' })
        .find((option) => option.value === 'level');
      expect(level).toMatchObject({
        value: 'level',
        operation: 'level',
        requestBasis: metricKey,
        disabled: false,
      });
    }
  });

  it('keeps a specialized multi-series Movement basis registered as the request basis', () => {
    const basis = compareMethodOptions('current_account', { kind: 'country', iso3: 'IND' }, { kind: 'country', iso3: 'USA' })
      .find((option) => option.value === 'ca_annual_gdp');
    expect(basis).toMatchObject({
      value: 'ca_annual_gdp',
      operation: 'level',
      requestBasis: 'ca_annual_gdp',
    });
  });
});
