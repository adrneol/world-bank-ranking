# Prices Visual Refinement Pass 2 Report
Branch: `methodology-redesign` | Date: 2026-09-26 | Scope: frontend presentation ONLY.
Reference: GDP / GDP-per-capita Movement frontend (visual/UX only; their methodology untouched).

## 1. Text-summary visual changes (Issue 1 + 6 + 9)
- Deleted the three long story paragraphs (`PricesStory` removed).
- New **At-a-glance** `cards` grid: one compact block per period/year with
  hero focus value, Observed `#rank/N`, Like-for-like `#rank/N`,
  Other-economy average (with peer count), Gap `±pp`, and a one-line
  interpretation. Same backend fields, mini-stat layout, no prose.
- Detail now lives once in the period result cards; headings shortened
  where context is obvious (e.g. chart titles "comparison (observed)").

## 2. Wording changes (Issue 2 + 7)
- "Focus value" → "`[Country]`'s {basis label lowered}" (hero subheader).
- "Focus rank" → "`[Country]`'s rank".
- "Eligible universe" → "Economies ranked".
- "Average of other eligible economies" → "Other-economy average" (+ peer count).
- "Focus vs average" → "`[Country]` vs other-economy average".
- Gap interpretation: "Lower/Higher/Equal to the other-economy average"
  (PP-sign consistent; never "better/worse"). Rank keeps metric-specific
  wording ("Ranked by lower …"). Never "world inflation/score/performance".

## 3. Dynamic country naming (Issue 8)
- New `possessive(name)` helper (`India's`, `Japan's`, `United States'`)
  applied to every former "Focus …" label, story/glance text, table
  relation filters (`Above ${focusName}`), focus-tag, methodology note
  ("average excludes {focusName}"), and chart series label (focus series
  now carries the country name instead of a generic key).
- Verified by code path: all labels derive from the `focusName` prop /
  `data.focus.name`; nothing hardcoded. USA/Japan render through the same
  branch (USA cumulative verified live in prior audit).

## 4. Common hide/show control (Issue 3)
- Matches GDP exactly: `useState(false)` default-hidden,
  `Show common economies (N)` / `Hide common economies`, `aria-expanded`,
  table/filter state preserved across reopen. Same `btn btn-secondary` control.

## 5. Year-by-year outside-common-set explanation (Issue 4 + 10)
- New `PriceSetPartition`: GDP `partition` markup (`partition-row/bar/
  common/delta/total`) with one row per observed period/year:
  `N observed = C common + O outside` (e.g. 177 = 166 + 11).
- Common = same members across every required comparison; Outside =
  in that observed set but missing elsewhere. Wording keeps "outside";
  no entered/exited/creation language. Counts come from backend ranking
  lists (`eligibleCount` + set differences), no economic recalculation.
- This visually answers why Observed N ≠ Like-for-like N.

## 6. Outside tabs (Outside section)
- Kept: All / Outside in {period|year} tabs with backend-set counts,
  search, relation filter, pagination — same component family as GDP
  outside views, Prices "outside" semantics preserved.

## 7. Common table UX
- Kept GDP-style tools (name/ISO3/`#rank` search, above/below-focus
  relation filter, rank/value sort, 25/50/100 pagination, details rows);
  now behind the GDP-style hide/show control. Backend ranks/values only.

## 8. Responsive changes
- Zero new CSS. Glance blocks reuse `cards`/`card` (stack on mobile);
  tables reuse `table-scroll`; controls reuse `filter-grid`. No fixed
  widths; mobile order: glance → results → observed → LFL → partition →
  common → outside → verification.

## 9. GDP/GDP-per-capita components/patterns reused
`cards`, `card-result-value`, `facts`, `facts-group growth-section`,
`denominators`, `partition-*`, `table-scroll`, `table table-compact`,
`row-focus`, `focus-tag`, `details-row`, `dgrid`, `btn/btn-primary/
btn-secondary`, `filter-grid`, `footnote`, `subhead`, `Pagination`,
`MethodologyPanel`, `UnavailableState`, `StatusBlock`, `Field`,
`BarComparisonChart` (grouped entries/series), `ChartCard`. No GDP file
modified.

## 10. Analytical values: NO CHANGE (Issues: no-analytical-change)
- This pass made zero backend edits (the `name` display field came from
  the prior pass). Live-API oracle re-run: CPI change 120.86252714248134
  (#141/177, bench 82.94449798093909), inflation avg 8.271108373486545,
  cumulative 120.86252714248111, all Ns/ranks/benchmarks/PPs identical to
  the audited baseline (diffs 0); invalid/legacy/fake-group requests still
  400; basis registry still exactly 2/3/3.

## 11. Methodology: NO CHANGE
No formula, basis, indicator, interval, universe, rank, direction,
tie-break, benchmark, PP, group-logic, or missing-data edit.

## 12. Lint/build/test status
- `npm run lint`: 0 errors (3 pre-existing warnings in untouched files).
- `npm run build`: succeeds.
- Backend `npm test`: 396/397 — sole failure is the known pre-existing
  environment-dependent refresh-auth test (401 vs 400), identical before
  and after.

METHODOLOGY CHANGED: NO

ANALYTICAL VALUES CHANGED: NO

RANKS CHANGED: NO

OBSERVED/LFL UNIVERSES CHANGED: NO

BENCHMARKS CHANGED: NO

PP VALUES CHANGED: NO

COMMON/OUTSIDE MEMBERSHIP LOGIC CHANGED: NO

VISUAL REFINEMENT COMPLETE: YES
