# Prices Visual Enhancement Report
Branch: `methodology-redesign` | Date: 2026-09-26 | Scope: frontend presentation ONLY.

## 1. Existing UI problems identified
1. **Charts rendered empty.** `PricesMovement.jsx` passed a `data={...}` prop to
   `BarComparisonChart`, which only accepts `entries`/`series` — so every Prices
   chart returned `null` and the page showed large titled-but-empty chart areas.
2. **Wrong props on shared components.** `MethodologyPanel` was called with
   `{title, indicator, derivation}` instead of `{indicatorCode, derived, ...}`,
   so only the Source row rendered. `UnavailableState` was called with a
   `message` prop it ignores, so unavailability showed a bare reason code.
3. **No common/outside economy presentation.** Ranking lists arrived from the
   backend but were never displayed; Observed-vs-LFL set differences were
   described in one sentence with no explorable data.
4. **Flat hierarchy.** Period cards repeated long labels; Observed and
   Like-for-like were visually near-identical stacked blocks; no story
   sentence, no hero numbers, no partition-style explanation.
5. **Backend withheld display names.** `ranking[]` entries carried
   `{iso3, value, rank}` only (the resolved names sat in a `Map` that
   serializes to `{}`), so economy tables could not show names.
6. **Missing Swap control** in Prices controls (generic Movement has one).

## 2. GDP/GDP-per-capita frontend patterns reused
- `cards` / `card` / `card-rank` / `card-result-value` hero hierarchy
  (`SummaryCards`, `GrowthIntervalCard`).
- `facts-group growth-section` Observed / Like-for-like compare blocks with
  `denominators` stat boxes (from `GrowthIntervalCard.compareSection`).
- `partition`-style explanatory text and `facts`/`dgrid` detail grids.
- Outside tabs as `btn`/`btn-primary` `role=tablist` with per-tab counts
  (`ThreeYearResults`), `filter-grid` search + `SearchableSelect` relation
  filter, `Pagination`, numeric-rank search semantics (`matchesTextOrRank`,
  `parseRankQuery`), `rankCell` em-dash, `row-focus` + `focus-tag`,
  `details-row` expanders, `footnote` presentation-only notes.
- `ChartCard` + `BarComparisonChart` grouped `entries`/`series` shape.
- `MethodologyPanel`, `UnavailableState`, `StatusBlock`, `Field` contracts.
- Responsive strategy: fluid grids, `table-scroll` with sticky first column,
  `.economy-cards` mobile shells, no fixed widths (all CSS reused, zero new
  stylesheet rules).

## 3. Components reused (no GDP file modified)
`BarComparisonChart`, `ChartCard`, `MethodologyPanel`, `Pagination`,
`StatusBlock`, `UnavailableState`, `Field`, `SearchableSelect`,
`FocusPicker`, `MetricPicker`, plus every CSS class listed above.
GDP/GDP-per-capita sections render byte-identical output (no edits).

## 4. Components created (all inside `frontend/src/sections/PricesMovement.jsx`)
- `PricesStory` — one sentence per period from backend fields only.
- `PricesResultCard` — per-period card with Observed + Like-for-like
  `facts-group` blocks (focus value hero, universe, rank, other-economy
  average, PP with interpretation, required-years line).
- `PriceCommonTable` — like-for-like universe table (per-period rank/value
  columns, `#` = full-period backend rank), search + above/below-focus
  relation filter + sort + pagination + row details.
- `PriceOutsideSection` — All / Outside-in-period tabs with backend-set
  counts, search + relation filter + pagination.
- Fixed `PricesMovementControls` (added Swap start/end; group selects
  unchanged in meaning).

## 5. Common/outside economy presentation
- **Common** = intersection of the backend like-for-like ranking sets
  (verifiably one universe: e.g. 166/166/166 for CPI change); table shows
  each economy's backend per-period ranks/values and vs-focus position.
- **Outside** = backend observed ranking minus the common set, per period,
  under All / Outside-in-{period} tabs with counts — the Prices analogue of
  GDP's entered/exited views (Prices has no created/dissolved semantics, so
  labels say "outside", never "entered/exited").
- All filtering/sorting/pagination is presentation-only over backend ranks;
  `#` always shows the backend analytical rank; missing ranks show `—`.

## 6. Filter behavior
Unchanged in meaning: Analysis / Metric / Basis (exactly 2/3/3 canonical
IDs) / Start / Middle / End / Focus / Country-group (All + dynamic WB
classifications, no hardcoding, no Developed mapping). Stale basis IDs
still reset to the first valid basis on metric switch; invalid bases still
400 at the backend. Added: Swap start/end button (parity with GDP
controls). Common/outside tables use the GDP filter UX (search incl.
exact-rank `#n`, relation filter, sort, paged 25/50/100).

## 7. Chart changes
- Fixed the `data` → `entries`/`series` prop bug: observed and like-for-like
  grouped bars now render (period/year × focus vs other-economy average).
- CPI-index-annual (unranked) renders a focus-only trajectory bar set.
- Charts render only when at least one backend point exists (no empty
  chart areas); each chart carries WHAT/WHEN/WHO/UNIT/UNIVERSE in its
  title, legend, and unit label; single unit per chart.
- Zero client-side economics: charts map `focus.value`/`focus.benchmark`
  verbatim; only formatting.

## 8. Responsive changes
No stylesheet changes. New markup exclusively reuses responsive classes
(`cards`, `filter-grid`, `facts-group`, `table-scroll`, `pagination`,
`details`); tables scroll horizontally with sticky first column on narrow
screens exactly like GDP tables. Mobile order: story → period cards →
observed chart → LFL chart → common → outside → verification.

## 9. Backend methodology: unchanged except one additive display field
- `pricesMovementService.js`: `ranking[]` entries now also carry `name`
  (already resolved server-side; previously dropped during mapping).
- No formula, rank, direction, tie-break, benchmark, PP, universe,
  completeness, interval, indicator, group-logic, or missing-data change.
- Justification: exposing already-existing analytical data required by the
  frontend tables; the only backend change in this task.

## 10. Before/after analytical-value regression comparison
Live-API oracle re-run after all changes (2004/2014/2024, IND):
CPI change 120.86252714248134 / 62.66155375656837 / 259.2584183159826;
ranks 141/177, 124/173, 129/166; LFL 166/166/166; inflation avg 8.271108373486545
(#140/177), cumulative 120.86252714248111; deflator Ns 202/199/193 —
every value, rank, denominator, benchmark, PP, observed N and LFL N
identical to the pre-change audited baseline (diffs 0). Invalid-basis,
legacy-basis, non-Prices, and fake-group requests still 400.

## 11. Tests
- Backend: full suite 396/397 — the single failure is the known
  pre-existing environment-dependent `POST /api/data/refresh` auth test
  (401 vs 400; local `.env` sets `REFRESH_ADMIN_TOKEN`), identical before
  and after. All 37 Prices tests green (values + universes + groups).
- Frontend: no test runner configured; verification via lint + build.

## 12. Build/lint status
- `npm run lint`: 0 errors (3 pre-existing `set-state-in-effect`
  warnings in untouched files).
- `npm run build`: succeeds.

## 13. Remaining UX issues
- Common-table mobile view uses the desktop table with horizontal scroll
  (same as GDP tables) rather than a separate card shell — consistent with
  the reference, acceptable.
- Hyperinflation-outlier benchmarks (e.g. deflator cumulative mean ≈1.6e11
  from genuine VEN/ZWE rows) are displayed verbatim per the verified
  unweighted-mean rule; a future methodology note may add a median —
  explicitly out of scope here.

METHODOLOGY CHANGED: NO

ANALYTICAL VALUES CHANGED: NO

RANKS CHANGED: NO

OBSERVED/LFL UNIVERSES CHANGED: NO

BENCHMARKS CHANGED: NO

PP VALUES CHANGED: NO

VISUAL/UX ENHANCEMENT COMPLETE: YES
