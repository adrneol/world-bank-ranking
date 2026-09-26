# GDP Capability + UI Audit (Movement basis options, metric scoping, graphs)

Date: 2026-09-26. Scope: Total GDP + GDP per capita Movement UI.
No methodology change (formulas, ranking, universes, benchmarks untouched;
zero backend edits in this task).

## 1. Audit findings

### Basis dropdown
- BEFORE (reported symptom): four options with two disabled placeholders.
- ACTUAL CURRENT STATE: `movementBasisOptions()` (available-only filter over
  the capability-driven `movementBases()`) is already consumed by all seven
  Movement-family controls including generic `MovementControls`, so Total
  GDP / GDP per capita show exactly **level + growth** (growth is available
  because every GDP metric declares `YOY`; `period_total`/`period_average`
  are correctly unavailable — no `SUM`/`AVG` declared). Verified in code;
  no `disabled: !b.available` remains in any Movement basis select.
- Stale/invalid basis (URL deep-link, metric switch) resets to the first
  available option via control-level effect; backend fail-closes otherwise.

### Metric dropdown leakage
- `MetricPicker` listed all subjects. Fixed by prior work + this task:
  all 7 Movement controls pass `subject={subject}` (data-driven via
  `SUBJECTS` registry); global filterbar in `App.jsx` now also passes
  `subject={effective.subject}` (fixed in this task — it was the last
  unscoped instance). `Compare.jsx` intentionally unscoped (entity/
  operation-driven, metric-agnostic by design).

### Graph availability (all from backend analytical responses, zero new math)
- Level 2-yr: rank SlopeChart + focus-values bar chart (focus row
  `valueA/valueB` from `/api/comparison/level` rows).
- Level 3-yr: focus-values bar chart (`valueA/valueMid/valueB`).
- Growth: interval endpoint-change bars (pre-existing).
- Period bases: unavailable for GDP by methodology; correctly absent.
- Charts render only when the focus economy holds finite backend values
  for every plotted point (no partial/empty charts).

### Late-render feel
- Root causes found: (a) unmemoized option rebuilds per render,
  (b) registry-hydration list swap (GDP-only fallback → full registry).
- State: `MetricPicker` memoizes on `activeRegistryVersion()`;
  `SearchableSelect` flattens once per options identity; generic
  `MovementControls` memoizes basis options on registry version. Remaining
  hydration swap is inherent (async catalog) and correct.

## 2. Files changed in this task
- `frontend/src/App.jsx` — subject-scoped global MetricPicker.
- `frontend/src/index.css` — open-state affordance
  (`.combo-button[aria-expanded]` navy ring).
- Prior commit d80bf44 (basis filtering, scoping, charts, dropdown
  system, memoization) verified intact and adopted as the base.

## 3. Verification
- Backend suite: untouched code, full run green except the known
  pre-existing refresh-auth env failure.
- Frontend: `npm run lint` 0 errors; `npm run build` succeeds.
- Capability chain: Analysis → SUBJECTS → metrics → movementBasisOptions
  → valid-only dropdown → backend fail-closed; single authoritative
  definition (`metrics.js`), no parallel lists.
