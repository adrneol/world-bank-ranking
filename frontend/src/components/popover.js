/**
 * Shared popover geometry (Phase 3, issues R-06/R-09/R-10).
 *
 * Pure functions — no DOM, no React — so the flip/bounds contract is
 * unit-testable. The single SearchableSelect consumes these; no page owns
 * its own positioning math.
 *
 * Compute bounds in visual-viewport pixels, then translate them back into
 * the fixed-position coordinate system used by the portalled element.
 */

export const POPOVER_EDGE_MARGIN = 8;
export const POPOVER_GAP = 4;
export const POPOVER_MAX_WIDTH = 384; // 24rem — matches the desktop cap
export const POPOVER_MIN_WIDTH = 192; // 12rem — stays tappable/readable
export const POPOVER_MAX_HEIGHT = 336; // anchored popovers never exceed this
export const POPOVER_MIN_HEIGHT = 120; // constrained side still shows content

/**
 * Singleton portal mount shared by overlay UI (combo popovers, nav drawer).
 * Mounted inside the React root element (not document.body) so synthetic
 * events keep working, with body fallback. `position: fixed` children still
 * lay out against the visual viewport because no ancestor creates a
 * transform/filter/contain context. Layout-neutral via display: contents.
 */
let portalNode = null;
export function getPortalMount() {
  if (typeof document === 'undefined') return null;
  if (!portalNode || !portalNode.isConnected) {
    portalNode = document.createElement('div');
    portalNode.className = 'combo-portal';
    const mount = document.getElementById('root') ?? document.body;
    mount.appendChild(portalNode);
  }
  return portalNode;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Read the current visual viewport size. Falls back to the layout viewport
 * where visualViewport is unavailable (desktop, older browsers, tests).
 */
export function viewportSize() {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  const vv = window.visualViewport ?? null;
  return {
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
    offsetLeft: vv?.offsetLeft ?? 0,
    offsetTop: vv?.offsetTop ?? 0,
  };
}

export function anchoredPlacement(rect, contentHeight) {
  const viewport = viewportSize();
  const x = viewport.offsetLeft ?? 0;
  const y = viewport.offsetTop ?? 0;
  const placement = computePopoverPlacement({
    trigger: { top: rect.top - y, bottom: rect.bottom - y, left: rect.left - x, width: rect.width },
    viewportW: viewport.width, viewportH: viewport.height, contentHeight,
  });
  return { ...placement, left: placement.left + x,
    top: placement.top == null ? null : placement.top + y,
    bottom: placement.bottom == null ? null : window.innerHeight - y - viewport.height + placement.bottom };
}

/**
 * Estimate the popover's natural content height before it is mounted, so the
 * flip decision can be made synchronously on open (no measure-then-flash).
 * Row/filter metrics mirror the combo CSS rhythm (~34px rows, ~46px filter).
 */
export function estimatePopoverHeight({ optionCount = 0, showFilter = false } = {}) {
  const rows = Math.max(optionCount, 1);
  const listHeight = Math.min(rows, 10) * 34 + 12;
  return Math.round((showFilter ? 46 : 0) + listHeight);
}

/**
 * Viewport-aware placement for an anchored popover.
 *
 *   enough space below → open downward (top-anchored to the trigger)
 *   else enough space above → open upward (bottom-anchored to the trigger)
 *   else → the roomier side, height-constrained (still scrolls internally)
 *
 * Never hard-codes `top: 100%`: every edge is clamped to the viewport with
 * an 8px margin, and width can never exceed the viewport (no horizontal
 * page scroll at 320px).
 *
 * @param {{trigger:{top:number,bottom:number,left:number,width:number},
 *          viewportW:number, viewportH:number, contentHeight:number,
 *          margin?:number}} input
 * @returns {{dir:'down'|'up', top:number|null, bottom:number|null,
 *           left:number, width:number, maxHeight:number}}
 */
export function computePopoverPlacement({
  trigger,
  viewportW,
  viewportH,
  contentHeight,
  margin = POPOVER_EDGE_MARGIN,
} = {}) {
  const t = {
    top: trigger?.top ?? 0,
    bottom: trigger?.bottom ?? 0,
    left: trigger?.left ?? 0,
    width: trigger?.width ?? 0,
  };
  const viewW = Math.max(viewportW ?? 0, 1);
  const viewH = Math.max(viewportH ?? 0, 1);
  const need = Math.min(Math.max(contentHeight ?? 0, 1), POPOVER_MAX_HEIGHT);

  const usableWidth = Math.max(viewW - margin * 2, 1);
  const width = Math.round(Math.min(Math.max(t.width, POPOVER_MIN_WIDTH), Math.min(POPOVER_MAX_WIDTH, usableWidth)));
  const left = Math.round(clamp(t.left, margin, Math.max(margin, viewW - margin - width)));

  const below = viewH - t.bottom - margin - POPOVER_GAP;
  const above = t.top - margin - POPOVER_GAP;
  let dir = 'down';
  if (below >= need) {
    dir = 'down';
  } else if (above >= need) {
    dir = 'up';
  } else {
    dir = below >= above ? 'down' : 'up';
  }
  const space = dir === 'down' ? below : above;
  const usableHeight = Math.max(1, viewH - margin * 2);
  const maxHeight = Math.round(Math.min(usableHeight, POPOVER_MAX_HEIGHT, Math.max(space, POPOVER_MIN_HEIGHT)));
  const edge = dir === 'down' ? t.bottom + POPOVER_GAP : viewH - t.top + POPOVER_GAP;
  const inset = Math.round(clamp(edge, Math.min(margin, viewH - maxHeight), Math.max(0, viewH - maxHeight - margin)));

  if (dir === 'down') {
    return { dir, top: inset, bottom: null, left, width, maxHeight };
  }
  return { dir, top: null, bottom: inset, left, width, maxHeight };
}

export default {
  computePopoverPlacement,
  estimatePopoverHeight,
  viewportSize,
};
