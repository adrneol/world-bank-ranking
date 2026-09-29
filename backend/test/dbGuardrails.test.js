/**
 * PHASE 6C-1: development safety guardrails.
 *
 * The ingest CLI must refuse Turso-targeted runs without explicit --force so
 * ordinary local testing can never rewrite production data. Pure predicate
 * tests (no database, no network).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldProceed } from '../src/scripts/ingest.js';

test('local targets always proceed', () => {
  assert.equal(shouldProceed({ mode: 'local' }, { force: false }), true);
  assert.equal(shouldProceed({ mode: 'local' }, { force: true }), true);
  assert.equal(shouldProceed({ mode: 'local' }, {}), true);
});

test('turso targets require explicit --force', () => {
  assert.equal(shouldProceed({ mode: 'turso' }, { force: true }), true);
  assert.equal(shouldProceed({ mode: 'turso' }, { force: false }), false);
  assert.equal(shouldProceed({ mode: 'turso' }, {}), false);
  assert.equal(shouldProceed(null, {}), true);
  assert.equal(shouldProceed(undefined, { force: false }), true);
});
