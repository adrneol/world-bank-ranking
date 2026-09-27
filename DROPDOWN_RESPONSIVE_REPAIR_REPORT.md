# DROPDOWN RESPONSIVE REPAIR REPORT — PHASE 3 (R-06 / R-09 / R-10)

> Scope: shared dropdown/popover architecture only. No backend, database,
> API, methodology, ranking, benchmark, chart, or mobile-card changes.
> Presentation/interaction only; option sets, availability, and committed
> values are untouched.

---

## 1. Original root causes

`FULL_CODEBASE_FORENSIC_AUDIT.md` §11 / R-06, R-09, R-10 — all verified
against live code before editing (no staleness found):

- R-06: `.combo-popover` used `position: absolute; top: calc(100% + 4px)`
  inside the trigger's stacking context — always downward, no flip, no
  viewport measurement, no portal. Near the bottom of a mobile viewport the
  menu extended off-screen; inside `.table-scroll` (`overflow-x: auto`) or
  other overflow ancestors it clipped.
- R-09: the 1960–2025 year list (66 options) rendered fully inside a
  `70vh` bottom sheet with a `50vh` list, opened at the top (active index
  always reset to 0), with no scroll-to-selected.
- R-10: sheet/list sizing used `vh` only — no `dvh`/`svh`, no
  visual-viewport awareness, no body scroll lock.

## 2. Shared architecture before

```text
SearchableSelect (controls.jsx, single implementation for ~90 usages)
└── div.combo (position: relative)
    ├── button.combo-button
    └── div.combo-popover (absolute, top: 100%+4px, in-flow stacking context)
        ├── input.combo-filter (lists > 7 options)
        └── ul.combo-list (max-height: 16rem, internal scroll)
Mobile ≤40rem: EVERY popover became a fixed 70vh bottom sheet.
```

## 3. Shared architecture after

```text
SearchableSelect (same single implementation, same props — zero call-site changes)
├── button (unchanged contract: combobox/listbox/expanded/labels)
└── portal → div.combo-portal (display: contents, inside #root; body fallback)
    ├── ANCHORED (default; all short lists + desktop long lists)
    │   └── div.combo-popover.combo-popover-portal[.combo-popover-up]
    │       position: fixed; top/bottom/left/width/maxHeight from
    │       computePopoverPlacement() against the VISUAL viewport
    └── SHEET (mobile + >8 options only)
        └── div.combo-popover.combo-popover-sheet
            fixed bottom sheet, dvh-capped, body scroll locked
```

`FocusPicker`, `MetricPicker`, `EntityPicker`, and all ~90 direct usages
(global filter bar, all 8 Movement families' controls, Compare builders,
relation/sort selects) inherit the behavior with no changes — verified by
grep: every dropdown renders through this one component.

## 4. Positioning algorithm

`frontend/src/components/popover.js` (pure, unit-tested):

- Inputs: trigger `getBoundingClientRect`, visual-viewport size
  (`visualViewport` → `innerWidth/Height` fallback), synchronously
  estimated content height (row/filter rhythm mirrors CSS), 8px edge margin.
- `below >= need` → **down** (`top = trigger.bottom + 4`).
- Else `above >= need` → **up** (`bottom = viewportH − trigger.top + 4`,
  so the menu hugs the trigger whatever its clamped height is).
- Else the roomier side, `maxHeight` clamped to [120, 336]px — still
  internally scrollable, never a full-screen trap.
- Width tracks the trigger within [192, 384]px, always clamped to
  viewport − margins (no horizontal overflow at 320px).
- Measured in `useLayoutEffect` on open (no flash), recomputed on
  `resize` + `visualViewport resize` (rAF-throttled), menu **closes** on
  outside scroll (capture listener, trigger/popover scrolls ignored) so no
  stale position can survive.

## 5. Portal behavior

- Singleton `div.combo-portal` (`display: contents`, zero layout impact)
  mounted inside `#root` (verified: `main.jsx` uses `createRoot`), so
  React synthetic events (option `onMouseDown`, filter `onChange`,
  keyboard) keep working and no overflow/transform/filter ancestor can
  clip the menu — including triggers inside `.table-scroll` tables and
  Movement filter grids.
- `z-index` deliberately unchanged at 60: the portal escapes trapping
  contexts, so no escalation was needed.
- Click-outside now excludes both trigger root and popover refs.

## 6. Mobile-sheet behavior

- Sheets apply **only** to long lists on mobile (`shouldUseSheet`:
  `isMobile && optionCount > 8`, counted on the stable option set so
  typing never swaps the surface). Basis / short metric / small group
  selectors stay compact anchored popovers on mobile too.
- Sheet: `left/right/bottom .75rem`, `max-height: 70vh; 70dvh`, list
  `50vh; 50dvh` with independent internal scroll, filter pinned
  (`flex: none`) so search never scrolls away.
- Body scroll locked (`overflow: hidden`) only while a sheet is open;
  only `overflow` is restored on close — scroll position is never
  rewritten, so the Movement page cannot jump.

## 7. Year-list behavior

- 66-option lists open viewport-bounded (anchored `maxHeight` ≤336px on
  desktop; dvh-capped sheet on mobile) with internal scrolling only —
  the page is never the scroller.
- Structure matches the required concept: pinned search/filter header +
  scrollable options region + usable empty state.

## 8. Scroll-to-selected behavior

- Opening any menu starts keyboard navigation at the **selected** option
  (computed in the opening event, not an effect), so the existing
  `scrollIntoView({block:'nearest'})` brings e.g. End Year 2024 into view
  instead of stranding the user at 1960. Keyboard flow and the active-row
  mechanism are otherwise unchanged.

## 9. Viewport-unit changes

- `70vh → 70vh; 70dvh` and `50vh → 50vh; 50dvh` (progressive enhancement;
  older browsers keep `vh` behavior). Anchored geometry is computed from
  `visualViewport` height directly, so address-bar show/hide, keyboard,
  and rotation re-resolve via the reposition path. No fixed full-screen
  surfaces remain.

## 10. Accessibility preservation

- Unchanged: `combobox`/`listbox`/`option` roles, `aria-expanded`,
  `aria-activedescendant`, labelled filter/list, Arrow/Home/End/Enter,
  Tab-to-leave, click-outside, focus-visible rings, muted
  selected/disabled styling, screen-reader group semantics.
- Improved without expanding scope: **Escape now also closes from the
  trigger button** (previously list/input only); focus still moves to the
  filter on open (after portal mount) and returns to the trigger on
  selection/Escape. No focus trap added (non-modal menu, as before).

## 11. Every shared component changed

```text
M frontend/src/components/controls.jsx   (portal, placement, sheet, scroll-to-selected, Escape)
M frontend/src/index.css                  (portal/sheet/dvh rules; combo theme untouched)
?? frontend/src/components/popover.js     (new: pure placement/sheet/estimate helpers)
```

Call-site files changed: **none** (props and option shapes identical).
Backend files changed: **none**. Chart files changed: **none**.

## 12. Every frontend usage inspected

All render through `SearchableSelect` (grep-verified ~90 sites): global
filter bar (start/end/year/analysis/metric/focus/compare-from),
`FocusPicker`, `MetricPicker`, `EntityPicker` (country/aggregate),
Movement controls for Total GDP, GDP per capita, Prices, Trade, Capital
Flow, Exchange Rate, External Sector, Population (focus/analysis/metric/
basis/start/middle/end/group-type/group-value), Compare operations,
common/outside relation/sort selects. Analytical availability (metrics,
bases, years, registry) is untouched — only presentation/interaction.

## 13. Breakpoints tested

No browser tooling exists in this environment (established Phase 1), so
verification is unit + static + build-level:

- Unit (7/7 pass): down/up/constrained placement, 320–414px horizontal
  safety, trigger-width tracking, 66-option capping, sheet threshold.
- Static: portal mount point, event flow, effect deps, CSS cascade
  (sheet rules apply only to `.combo-popover-sheet`; short-list mobile
  keeps anchored geometry via inline styles).
- Matrix reasoning: 320–414 (flip/sheet/dvh paths), 480–768 (anchored,
  clamped), 1024–1440 (pixel-equivalent to old anchored popover except
  viewport clamping + portal).

## 14. Browser/screenshot verification

Not performed — no browser/screenshot tooling available. Explicitly
recommended post-commit: screenshot classes A (bottom-edge Analysis
flip), B (Start/End year bounds), C (66-option internal scroll), D
(table-context clipping), plus Metric/Basis/Country/Group spot checks at
390×844 and 1280×800.

## 15. Remaining limitations

- Reposition (not close) on resize/viewport change; close on outside
  scroll — a deliberate asymmetry to avoid stale positions without
  resize loops.
- Body lock uses `overflow: hidden` (no scrollbar compensation); a
  1-frame gutter shift is possible on desktop-width viewports, none on
  overlay-scrollbar mobile.
- `width: max-content` desktop theme retained under the portal with a
  `100vw − 1rem` backstop; extremely long labels still ellipsize per the
  existing premium design.
- R-08 (mobile cards), R-13 (a11y expansion), R-11/R-14/R-15 explicitly
  untouched per phase scope.

---

## Tests

- New `backend/test/comboPopover.test.js`: **7/7 pass** (flip, bounds,
  320–414px width safety, year-list capping, sheet threshold).
- Full backend suite: **549/550** — sole failure is the known pre-existing
  environment-dependent `server.test.js:179` refresh-auth expectation
  (expects an open endpoint while local `.env` sets a token); no backend
  files changed.
- `npm run lint`: **0 errors**, 3 warnings (identical pre-change baseline).
- `npm run build`: **passes**; bundle CSS verified (`combo-popover-portal`,
  `70dvh` present; old generic mobile-sheet rule gone).

## Final acceptance

- [x] Dropdown no longer always opens downward (flip up near bottom edge)
- [x] Popover stays within viewport (clamped edges + constrained maxHeight)
- [x] No horizontal overflow (width clamp incl. 320px, tested)
- [x] Not clipped by overflow ancestors (portal inside #root)
- [x] Short desktop lists remain compact (anchored theme unchanged)
- [x] Long lists internally scrollable (list maxHeight + scroll)
- [x] Year selector viewport-bounded (336px cap / dvh sheet)
- [x] Selected option scrolls into view on open
- [x] Search field pinned and accessible in sheets
- [x] Mobile sheet uses dvh with vh fallback
- [x] No page scroll jumps (overflow-only lock, position never rewritten)
- [x] Resize/orientation reposition; outside scroll closes
- [x] Keyboard/Escape/click-outside/focus preserved
- [x] All SearchableSelect usages consistent (single implementation)
- [x] No methodology/data/API/backend changes
- [x] lint + build pass; browser verification pending (no tooling)

```text
FINAL STATUS:

DROPDOWN RESPONSIVENESS:
PASS (unit/static/build-verified; screenshots pending)

MOBILE SHEET:
PASS (unit/static/build-verified; screenshots pending)

YEAR SELECTOR:
PASS

VIEWPORT POSITIONING:
PASS

ACCESSIBILITY:
PASS (contract preserved)

REGRESSION:
PASS

COMMIT READY:
YES
```
