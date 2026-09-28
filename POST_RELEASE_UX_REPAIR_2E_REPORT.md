# POST-RELEASE UX REPAIR — ROUND 2E REPORT

> Targeted visual/interaction repair on the live tree (no reset).
> Analytical engine untouched: `git diff --name-only -- backend/src` is
> empty, and no backend files of any kind changed except the
> `comboPopover.test.js` sheet-behavior block (updated for the authorized
> anchored-only change; all placement/flip assertions preserved).

---

## 1. Global page-shell fix

Screenshots showed content starting flush under the sticky header. Root
cause: `.wrap` has no top spacing and sections only carry bottom margins.
Fix is a single global rule — `#main { padding-top: 1rem }` (0.75rem on
mobile) — so every current and future view gets the gap with no per-page
margin hacks. Anchor scroll-margins on sections remain authoritative.

## 2. Rounded surface fix

Audit found all major surfaces already share one radius language
(`--radius` sections/cards/filterbar, 6px table-scroll/insight/chart
wrappers), so no blanket re-wrapping was needed (that would have created
card-in-card). The shell gap above was the actual defect; verified by
reading every top-level container rule.

## 3. Empty-formula fix

Root cause: GDP generic bases (`level/growth/period_total/period_average`
built in `gdpBasesForMetric`) carry no `formula`, while `Methodology.jsx`
wrapped `basis.formula` in a `<span>` that always renders — an empty
bordered box. Every basis now falls into exactly one state:
- A (equation): all 30+ catalog bases plus GDP growth/period modes, whose
  formulas are the exact backend-declared operation strings
  (`((current / previous) - 1) * 100`, `((B / A) - 1) * 100`,
  `sum(values[A..B-1])`, `sum(values[A..B-1]) / N` from `periods.js`);
- B (stored observation): GDP level renders "No separate formula — this
  basis uses the stored World Bank observation.";
- C/D: descriptive-annual and code-operation bases render their equation;
  any hypothetical future basis without either renders explicit generic
  prose — never a blank box.
Units additionally fall back to the metric unit instead of vanishing.

## 4. Dropdown root cause

The mobile bottom sheet (`combo-popover-sheet`: bottom-anchored,
edge-to-edge surface for all 66-option lists) is what read as a
browser/native picker, and its page-width geometry covered surrounding
content. No native `<select>` path, `appearance` conflict, or portal bug
was found — the styled system was simply bypassed on mobile by design.

## 5. Dropdown visual/width fix

Sheet mode removed from `SearchableSelect`: mobile uses the same anchored
portal popover (flip-aware, visual-viewport-clamped, dvh-capped) as
desktop, so year lists stay recognizably anchored to their trigger at
320–414px. Supporting changes: popover becomes a flex column so the
filter pins while the list absorbs height constraints internally;
`shouldUseSheet`/threshold removed from `popover.js`; stale sheet CSS and
the FocusPicker comment updated. No new z-index escalation beyond the
documented layer fix below.

## 6. Desktop dropdown behavior

Unchanged engine (same placement math, flip, clamping, theme); the only
behavioral delta is the shared flex-column list scrolling, which is
identical at desktop heights.

## 7. Mobile dropdown behavior

Anchored, trigger-width-based (192–384px clamped to viewport−16px),
flip-up near edges, filter pinned, internal scroll, selected-year scroll,
Escape/focus/click-outside preserved. Verified by new render tests at a
simulated 390px viewport.

## 8. Layer/z-index behavior

Audited layers: table headers (1–2) < sticky header (100) < popovers
< drawer (200/201). Found and fixed a real defect: portalled popovers at
z-60 slid *beneath* the sticky header when flipped upward over it.
`.combo-popover-portal` now sits at the documented layer 150 — above the
header, below the drawer. Pinned by test.

## 9. Methodology regression

All Round-2C depth retained (HOW/PERIOD/DISTINCT/caveats/friendly
sources, GDP code-derived wording, CPI annual/average/cumulative
distinction). Only additions: formula-state coverage and units fallback.

## 10. Analytical regression

None: no economics, ranking, benchmark, gap, universe, availability, or
response-shape code touched. Frontend `Math` usage remains
pagination/clamp/format-only (re-verified by grep during inspection).

## 11. Responsive verification

Static + build-level (no browser tooling here): shell gap, anchored
menus at 320–414, contained formulas, stacking grids, scrollable nav.
Screenshot pass remains explicitly pending — visual PASS below means
static-verified, not screenshot-verified.

## 12. Exact files changed

`config/methodology.js` (GDP formulas/prose), `sections/Methodology.jsx`
(formula states, units fallback), `components/controls.jsx` (sheet
removal), `components/popover.js` (helper removal), `components/
FocusPicker.jsx` (comment), `index.css` (shell gap, portal flex/z-index),
`backend/test/comboPopover.test.js` (sheet block → anchored block),
plus test additions/updates (`methodology.test.js`,
`Methodology.test.jsx`, new `SearchableSelect.test.jsx`,
`responsive.test.js` pins).

## 13. Exact files untouched

All of `backend/src`; all movement sections; search/sort components;
chart components/data; refresh stack; `StatusBlock`; registries;
adapters; App routing; drawer logic; About content; env files.

## 14. Tests

- Frontend **62/62** (14 files): new anchored-popover render suite
  (portal class, no sheet, 390px clamps, select/Escape/click-outside),
  GDP formula-state unit + render tests, layering/shell CSS pins.
- Backend **567/568** (known pre-existing refresh-auth env failure only);
  Phase-3 flip/bounds/scroll tests preserved.

## 15. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

## 16. Browser screenshots

Unavailable in this environment (standing limitation). Substituted with
jsdom render tests for every changed surface plus CSS pins for each
visual rule. A 320–1440 screenshot pass (shell gap, formula states,
anchored year menu, drawer, header scroll) remains explicitly pending.

## 17. Remaining limitations

- Screenshot verification pending (see §16).
- `shouldUseSheet` removal is a deliberate, authorized behavior change
  from Phase 3 (documented here, covered by updated tests).
- GDP period-mode ranking prose stays generic where the engine exposes
  no further documented rule.

```text
GLOBAL PAGE GAP: PASS
GLOBAL ROUNDED SURFACES: PASS
FORMULA EMPTY STATES: PASS
METHODOLOGY CONTENT: PASS
DROPDOWN STYLING: PASS
DROPDOWN MOBILE WIDTH: PASS
DROPDOWN DESKTOP WIDTH: PASS
DROPDOWN ANCHORING: PASS
DROPDOWN SCROLL: PASS
DROPDOWN ACCESSIBILITY: PASS
DROPDOWN LAYERING: PASS
HOME: PASS
METHODOLOGY: PASS
ABOUT: PASS
ANALYTICAL WORKSPACES REGRESSION: PASS
ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS
API / DATA UNCHANGED: PASS
TESTS: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
