/**
 * PHASE-5 R-13 REGRESSION GATE: shared accessibility hardening.
 *
 * Static gates over the frontend sources (no DOM framework in the repo):
 * Field label association, SearchableSelect Escape/focus contract (Phase-3
 * preservation), SubTabs keyboard parity with Tabs, and chart text
 * equivalents reusing backend values.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('Field associates labels without an invalid label/button relationship', () => {
  const ui = read('components/ui.jsx');
  const fieldBlock = /export function Field\([\s\S]*?\n\}/.exec(ui)?.[0] ?? '';
  assert.ok(fieldBlock.length > 0, 'Field found');
  assert.ok(!fieldBlock.includes('<label'), 'no label element wrapping arbitrary controls');
  assert.ok(fieldBlock.includes('<div className="field">'), 'neutral grouping retained with .field styling');
  assert.ok(fieldBlock.includes('`${htmlFor}-label`'), 'visible label gets a stable id');
  assert.ok(fieldBlock.includes('aria-labelledby'), 'native inputs are explicitly tied to the visible label');
  assert.ok(fieldBlock.includes('cloneElement'), 'association applied without touching call sites');
});

test('SearchableSelect keeps its accessible contract (Phase-3 preservation)', () => {
  const controls = read('components/controls.jsx');
  assert.ok(controls.includes('aria-haspopup="listbox"'), 'combobox role signaling kept');
  assert.ok(controls.includes('aria-expanded={open}'), 'expanded state announced');
  assert.ok(controls.includes('aria-activedescendant={activeId}'), 'active option announced');
  assert.ok(
    controls.includes("event.key === 'Escape' && open"),
    'Escape closes from the trigger button',
  );
  assert.ok(controls.includes('buttonRef.current?.focus()'), 'focus returns to the trigger');
  // Phase-3 architecture must not have been restored to inline popovers.
  assert.ok(controls.includes('createPortal'), 'portal rendering retained');
  assert.ok(read('components/popover.js').includes('computePopoverPlacement'), 'flip placement retained');
});

test('SubTabs matches the Tabs keyboard model', () => {
  const tabs = read('components/Tabs.jsx');
  const subTabs = /export function SubTabs\([\s\S]*$/.exec(tabs)?.[0] ?? '';
  assert.ok(subTabs.length > 0, 'SubTabs found');
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(subTabs.includes(`'${key}'`) || subTabs.includes(`"${key}"`), `SubTabs handles ${key}`);
  }
  assert.ok(subTabs.includes('tabRefs'), 'roving focus refs present');
  assert.ok(subTabs.includes('tabIndex={selected ? 0 : -1}'), 'roving tabindex kept');
  assert.ok(subTabs.includes('role="tab"') && subTabs.includes('aria-selected'), 'tab semantics kept');
});

test('chart text equivalents reuse backend values without new economics', () => {
  const ui = read('components/ui.jsx');
  assert.ok(ui.includes('export function ChartDataFallback'), 'shared fallback exported');
  const fallback = /export function ChartDataFallback\([\s\S]*?\n\}/.exec(ui)?.[0] ?? '';
  assert.ok(fallback.includes('chart-data-fallback'), 'existing disclosure pattern reused');
  assert.ok(!fallback.includes('useApi') && !fallback.includes('api.'), 'fallback lays out caller-provided cells only');
  for (const file of ['sections/Compare.jsx', 'sections/RankMovement.jsx', 'sections/Overview.jsx']) {
    assert.ok(read(file).includes('ChartDataFallback'), `${file} exposes chart values as a table`);
  }
});
