# Graph Data Integrity Report (GDP Movement)

Rule enforced: every chart value traces to the backend analytical response
that powers the adjacent cards. No hard-coded values, no mock series, no
frontend formulas.

## Level basis (Total GDP + GDP per capita)
- 2-year view: rank SlopeChart (backend ranks) + focus-values bar chart
  built from the focus economy's `valueA`/`valueB` in
  `data.economies.rows` of the SAME `/api/comparison/level` response
  (unit + decimals from backend metric metadata). Renders only when both
  points are finite — never a partial or empty chart.
- 3-year view: focus-values bar chart from `valueA/valueMid/valueB` of the
  same focus row; same guards.
- Growth basis: interval endpoint-change bars from
  `block.indiaGrowthPercent` (pre-existing, backend-derived).

## Verification method
- Code inspection of data flow (response → row lookup → chart entries);
  no arithmetic beyond null/finite guards and label formatting.
- Backend suite green (analytical responses unchanged — zero backend edits
  in this task); frontend lint 0 errors; production build succeeds.
- Charts carry basis-matching titles/units (`level value` vs `analytical
  rank` vs endpoint-change `%`); never mixed.
