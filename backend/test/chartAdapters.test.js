/**
 * CHART ADAPTER TESTS (Phase 7C-4).
 *
 * The chart layer must never calculate economics: adapters reshape
 * backend-provided values only (ordering, null preservation). These tests
 * pin that contract — exact value passthrough, nulls never zero-filled,
 * missing years never bridged by the adapter, full tooltip precision.
 *
 * Frontend chartData/chartFormat are pure ESM with no React dependency,
 * so they import directly (same pattern as the gating tests).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignSeries,
  hasAnyPoint,
  sortPoints,
  toBarEntries,
} from '../../frontend/src/components/charts/chartData.js';
import { formatChartValue, formatTickValue } from '../../frontend/src/components/charts/chartFormat.js';

test('Phase 7C-4.1: points pass through exactly, sorted by year, nulls kept', () => {
  const points = [
    { x: 2014, y: 34576643694.1382 },
    { x: 2004, y: 5429250989.85717 },
    { x: 2009, y: null },
    { x: 2019, y: 0 },
  ];
  assert.deepEqual(sortPoints(points), [
    { x: 2004, y: 5429250989.85717 },
    { x: 2009, y: null },
    { x: 2014, y: 34576643694.1382 },
    { x: 2019, y: 0 },
  ]);
  // Zero is a value (kept); null stays null (never zero-filled).
  assert.equal(sortPoints([{ x: 2020, y: 0 }])[0].y, 0);
  assert.equal(sortPoints([{ x: 2020, y: null }])[0].y, null);
  // Rows without a finite year are dropped (axis requirement, not data loss).
  assert.deepEqual(sortPoints([{ x: null, y: 5 }, { x: 2020, y: 5 }]), [{ x: 2020, y: 5 }]);
});

test('Phase 7C-4.2: series alignment merges years with null gaps, never bridges', () => {
  const { keys, rows, labels } = alignSeries([
    { label: 'India', points: [{ x: 2004, y: 100 }, { x: 2006, y: 120 }] },
    { label: 'USA', points: [{ x: 2005, y: 200 }] },
  ]);
  assert.deepEqual(keys, ['s0', 's1']);
  assert.deepEqual(labels, ['India', 'USA']);
  assert.deepEqual(rows, [
    { x: 2004, s0: 100, s1: null },
    { x: 2005, s0: null, s1: 200 },
    { x: 2006, s0: 120, s1: null },
  ]);
  assert.equal(hasAnyPoint([{ points: [{ x: 2004, y: null }] }]), false);
  assert.equal(hasAnyPoint([{ points: [{ x: 2004, y: 0 }] }]), true);
});

test('Phase 7C-4.3: bar entries preserve totals exactly (no adapter math)', () => {
  const entries = [
    { name: '2004', value: 252987424290.94495 },
    { name: '2005', value: null },
    { name: '2006', value: 0 },
  ];
  assert.deepEqual(toBarEntries(entries), entries);
  const finite = entries.filter((e) => Number.isFinite(e.value)).reduce((s, e) => s + e.value, 0);
  const adapted = toBarEntries(entries).filter((e) => Number.isFinite(e.value)).reduce((s, e) => s + e.value, 0);
  assert.equal(adapted, finite, 'adapter neither adds nor loses value');
});

test('Phase 7C-4.4: tooltips keep full precision; ticks may compact', () => {
  assert.equal(formatChartValue(2.43, 2), '2.43');
  assert.equal(formatChartValue(0.721648483526777, 2), '0.72');
  assert.equal(formatChartValue(83.669281580941, 2), '83.67');
  assert.equal(formatChartValue(null, 2), '—');
  assert.equal(formatTickValue(3956067115771.63, 0), '4.0T');
  assert.equal(formatTickValue(2.43, 2), '2.43');
});
