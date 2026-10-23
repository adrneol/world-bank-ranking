import assert from 'node:assert/strict';
import test from 'node:test';

import { compareCacheKey } from '../src/services/compareCache.js';

test('Compare cache distinguishes metric, basis and analysis independently', () => {
  const request = {
    contentVersion: 'v1',
    signature: { rows: 2, minVintage: '2026', maxVintage: '2026' },
    metricKey: 'current_account',
    basis: 'ca_annual_gdp',
    operation: 'level',
    mode: 'observed',
    entityA: 'country:IND',
    entityB: 'country:USA',
    yearA: 2024,
  };
  const key = compareCacheKey(request);
  assert.notEqual(key, compareCacheKey({ ...request, basis: 'ca_cumulative_share' }));
  assert.notEqual(key, compareCacheKey({ ...request, operation: 'absolute_change' }));
  assert.notEqual(key, compareCacheKey({ ...request, metricKey: 'remittances_received' }));
});
