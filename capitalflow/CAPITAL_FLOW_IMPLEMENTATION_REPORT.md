# Capital Flow Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `capitalflow/capitalflowmethod.txt` (untouched). Prices/Trade
used as architectural reference only — no formula copied.

## 1. Files changed / created
- NEW `backend/src/domain/capitalMovement.js` — 6 canonical bases,
  S+1..E expansion, DESC competition rank, country−benchmark gaps.
- NEW `backend/src/services/capitalMovementService.js` — group-first
  orchestration, Observed/LFL, USD/pp displays, unranked diagnostics.
- `backend/src/server.js` — `GET /api/movement/capital`,
  `GET /api/capital/country-groups`, additive `capitalBases`,
  methodology paragraph, refresh paths. No existing route touched.
- `frontend/src/config/metrics.js` — `CAPITAL_BASES` 3+3 (diagnostics
  excluded); other branches byte-identical.
- `frontend/src/api/client.js` — `capitalMovement`, `capitalGroups`.
- NEW `frontend/src/sections/CapitalMovement.jsx` — glance, period cards
  with diagnostics, Observed/LFL charts, partition, common/outside tables.
- `RankMovement.jsx` — Capital branch; GDP/Prices/Trade untouched.
- `App.jsx` — URL allow-list + 6 Capital IDs.
- NEW `test/capitalMovement.test.js` (17), `test/capitalApi.test.js` (10).
- Docs in `capitalflow/` (audit, final verification, this report).

## 2. Before → after
Before: generic level + prohibited unannualized "% growth" + unranked
`[S,E)` sums. After: 3 canonical ranked bases per metric over S+1..E,
DESC competition, country−benchmark gaps, unranked endpoint diagnostics,
no % growth basis anywhere in Capital Flow UI/API.

## 3. Bases
FDI (`BX.KLT.DINV.CD.WD`): annual raw; cumulative sum S+1..E;
average sum/(E−S); diagnostic Δ=F_E−F_S (unranked).
FDI/GDP (`BX.KLT.DINV.WD.GD.ZS` raw series for annual/average):
annual raw; average S+1..E; cumulative sum(FDI)/sum(GDP)×100 with GDP =
`total_current` (NY.GDP.MKTP.CD, current-US$); diagnostic ΔR (unranked).
Diagnostics never ranked, never define universes, never in dropdown.

## 4. Key semantics
S+1..E (10/10/20; boundary in exactly one adjacent period) — not Trade
S..E, not [S,E). Gap = country − benchmark (opposite Prices) with
per-basis units. Negative/zero preserved as data. Cumulative FDI is
summed flows, never a stock. No welfare claims. Nominal (non-real)
framing surfaced in API + glance + methodology.

## 5–8. Universes / ranking / benchmark / missing-data
Annual: year-valid; LFL = selected-year intersection. Period: complete
S+1..E per required legs (FDI always; ratio series for ratio average;
FDI+GDP for cumulative share); LFL = complete 2005..2024 legs. DESC
competition, full precision. LOO mean, focus excluded, gap in
basis units. Strict completeness with reasons; missing ≠ zero.

## 9. Groups
Dynamic income/region/lending; Developed NOT_SUPPORTED; group-first
ordering; non-member focus correctly null.

## 10. Bug found by tests during implementation
Cumulative-share numerator initially read the ratio series (≈1e-10
output); fixed to separate FDI legs before any UI work; oracles confirm
plausible shares (IND 1.91%/1.50%/1.64%).

## 11. Tests / regression
27 new tests green; full suite 449/450 (sole failure = pre-existing
refresh-auth env test, byte-identical); frontend lint 0 errors, build OK;
GDP/GDP-per-capita/Prices/Trade suites green, paths untouched.

## 12. Specification checks (§7 of task)
1. GDP code: `total_current` = NY.GDP.MKTP.CD (current-US$, same basis as
   FDI; registry already links it). 2. Annual/average ratios use the raw
   WDI ratio (ingested, authoritative); cumulative derives from legs —
   documented, no silent switching. 3. Negative ratios preserved
   (spec-explicit). 4. Diagnostics unranked/display-only. 5. Annual LFL =
   year intersection; period LFL = complete-span legs. 6. Gap =
   country − benchmark everywhere. 7. Current-vintage groups (documented).
