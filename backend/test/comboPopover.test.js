/**
 * PHASE-3 TESTS: shared popover geometry (R-06/R-09/R-10).
 *
 * The frontend popover helper is dependency-free (no JSX, no Vite
 * features), imported here by relative path so the flip/bounds contract
 * every SearchableSelect relies on is pinned: open down with room, flip up
 * near the bottom edge, constrain on the roomier side when neither fits,
 * and never overflow the viewport horizontally — including 320px widths.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePopoverPlacement,
  estimatePopoverHeight,
  POPOVER_MAX_HEIGHT,
  POPOVER_MAX_WIDTH,
  POPOVER_MIN_HEIGHT,
  POPOVER_MIN_WIDTH,
  shouldUseSheet,
} from '../../frontend/src/components/popover.js';

const VIEWPORT = { viewportW: 390, viewportH: 844 };

test('opens downward with room below, anchored to the trigger', () => {
  const placement = computePopoverPlacement({
    trigger: { top: 100, bottom: 140, left: 16, width: 200 },
    ...VIEWPORT,
    contentHeight: 200,
  });
  assert.equal(placement.dir, 'down');
  assert.equal(placement.top, 144);
  assert.equal(placement.bottom, null);
  assert.ok(placement.maxHeight >= 200);
});

test('flips upward for a trigger near the bottom edge', () => {
  const placement = computePopoverPlacement({
    trigger: { top: 700, bottom: 740, left: 16, width: 200 },
    ...VIEWPORT,
    contentHeight: 300,
  });
  assert.equal(placement.dir, 'up');
  assert.equal(placement.top, null);
  assert.equal(placement.bottom, 844 - 700 + 4);
  assert.ok(placement.maxHeight <= POPOVER_MAX_HEIGHT);
});

test('when neither side fits, constrains to the roomier side with a usable minimum', () => {
  const placement = computePopoverPlacement({
    trigger: { top: 400, bottom: 440, left: 16, width: 200 },
    viewportW: 390,
    viewportH: 500,
    contentHeight: 600,
  });
  assert.ok(placement.maxHeight >= POPOVER_MIN_HEIGHT);
  assert.ok(placement.maxHeight <= POPOVER_MAX_HEIGHT);
});

test('never overflows horizontally, even at 320px', () => {
  for (const viewportW of [320, 360, 375, 390, 414]) {
    const placement = computePopoverPlacement({
      trigger: { top: 200, bottom: 240, left: viewportW - 40, width: 220 },
      viewportW,
      viewportH: 800,
      contentHeight: 200,
    });
    assert.ok(placement.width <= viewportW - 16, `width fits at ${viewportW}px`);
    assert.ok(placement.left >= 8, `left margin kept at ${viewportW}px`);
    assert.ok(placement.left + placement.width <= viewportW - 8 + 1, `right edge inside at ${viewportW}px`);
  }
});

test('width tracks the trigger within sane bounds', () => {
  const narrow = computePopoverPlacement({
    trigger: { top: 200, bottom: 240, left: 16, width: 120 },
    ...VIEWPORT,
    contentHeight: 200,
  });
  assert.ok(narrow.width >= POPOVER_MIN_WIDTH);
  const wide = computePopoverPlacement({
    trigger: { top: 200, bottom: 240, left: 16, width: 900 },
    ...VIEWPORT,
    contentHeight: 200,
  });
  assert.ok(wide.width <= POPOVER_MAX_WIDTH);
});

test('content-height estimate grows with options and caps for year-size lists', () => {
  const short = estimatePopoverHeight({ optionCount: 3, showFilter: false });
  const years = estimatePopoverHeight({ optionCount: 66, showFilter: true });
  assert.ok(years > short);
  const placement = computePopoverPlacement({
    trigger: { top: 100, bottom: 140, left: 16, width: 200 },
    ...VIEWPORT,
    contentHeight: years,
  });
  assert.ok(placement.maxHeight <= POPOVER_MAX_HEIGHT, '66-option list stays viewport-bounded');
});

test('only long lists become sheets on mobile (R-09 short-list rule)', () => {
  assert.equal(shouldUseSheet({ isMobile: true, optionCount: 66 }), true);
  assert.equal(shouldUseSheet({ isMobile: true, optionCount: 8 }), false);
  assert.equal(shouldUseSheet({ isMobile: true, optionCount: 3 }), false);
  assert.equal(shouldUseSheet({ isMobile: false, optionCount: 66 }), false);
});
