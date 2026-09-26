# Trade Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `trade/tademethod.txt` (left untouched). Prices implementation
used as the technical reference (architecture only — no Prices formula
was copied into Trade).

## 1. Files changed / created
- NEW `backend/src/domain/tradeMovement.js` — 8 metric-specific bases,
  inclusive `tradeYears(S,E)`, CAGR validity gates, DESC competition
  ranking, leave-one-out benchmark.
- NEW `backend/src/services/tradeMovementService.js` — group-first
  orchestration, Observed/LFL, USD/pp display strings, evidence.
- `backend/src/server.js` — `GET /api/movement/trade`,
  `GET /api/trade/country-groups`, additive `tradeBases` on
  `/api/indicators`, `tradeMovement` methodology paragraph,
  AUTO_REFRESH entries. No existing route touched.
- `frontend/src/config/metrics.js` — `TRADE_BASES` 4+4 + `isTradeMetricKey`;
  GDP/Prices branches byte-identical.
- `frontend/src/api/client.js` — `tradeMovement`, `tradeGroups`
  (transport only).
- NEW `frontend/src/sections/TradeMovement.jsx` — glance blocks, period
  cards, Observed/LFL charts, partition, common/outside tables,
  methodology with nominal caveat.
- `frontend/src/sections/RankMovement.jsx` — Trade branch (hooks
  unconditional; generic fetch disabled for Trade); GDP/Prices untouched.
- `frontend/src/App.jsx` — URL basis allow-list extended with 8 Trade IDs.
- NEW `backend/test/tradeMovement.test.js` (17), `tradeApi.test.js` (9).
- Docs: `trade/TRADE_METHODOLOGY_IMPLEMENTATION_AUDIT.md`,
  `trade/TRADE_FINAL_VERIFICATION_AUDIT.md`, this report.

## 2. Methodology before → after
Before: generic level (ordinal DESC rank, no benchmark) + unannualized
"Annual flow B vs A" growth + unranked `[S,E)` period sums/averages.
After: canonical 4 bases per metric with DESC competition ranks, LOO
benchmark/gap in basis units, inclusive S..E flows, CAGR growth basis
with endpoint-% descriptive companion, nominal-US$ caveat surfaced.

## 3-4. Exact bases
Exports (`NE.EXP.GNFS.CD`): `exp_annual_value`, `exp_period_cagr`,
`exp_period_total`, `exp_period_average`. Imports (`NE.IMP.GNFS.CD`):
`imp_annual_value`, `imp_period_cagr`, `imp_period_total`,
`imp_period_average`. Each metric exposes only its own 4.

## 5. Observed implementation
Annual: valid in year t. CAGR: valid endpoints + start > 0 (end = 0
valid as −100%). Total/average: every year S..E valid. Group restriction
first, then validity. One gap → excluded, never partial/zero-filled.

## 6. Like-for-like implementation
Annual: U_S∩U_M∩U_E. CAGR: valid S&M&E with positive starts at each
sub-period start. Total/average: complete S..E full span (2004..2024 for
the three-year comparison). Same N across periods within one LFL view.

## 7. Country-group filter
Dynamic DISTINCT `income_level`/`region`/`lending_type` from the same
authoritative store as Prices; no hardcoding; Developed labels
NOT_SUPPORTED (same finding as Prices, re-verified live). Group-first
ordering; benchmark labeled for the selected group when active
(frontend shows group name; service restricts universe first).

## 8. Inclusive-period note (per spec)
Flow bases are inclusive calendar-year periods, so 2014 belongs to both
2004→2014 and 2014→2024 (11/11/21 observations). Documented in UI
(required-lines) and methodology text; methodology unchanged by request.

## 9-11. Ranking / benchmark / missing-data
DESC competition (1,1,3) on full precision for all 4 bases; LOO
unweighted mean with focus excluded; gap = benchmark − focus (USD for
annual/total, USD/year for average, pp for CAGR); missing-data states
with reasons (`missing_endpoint`, `zero_base_for_cagr`,
`incomplete_period` + missing years, `insufficient_comparison_universe`).

## 12. Graphs
Per-basis grouped bars (focus vs other-economy average) for Observed and
Like-for-like from backend values only; USD and % never mixed on one
chart; CAGR chart carries the descriptive endpoint companion in cards.

## 13. Responsive
Zero new CSS; reuses Prices/GDP classes (cards, filter-grid, facts-group,
table-scroll, pagination). Mobile order: glance → results → charts →
partition → common → outside → verification.

## 14. Tests
26 new (17 domain + 9 API/service); independent SQL/math oracles for
India exports/imports (all periods/bases) + USA/CHN alternates; all green.

## 15. Regression
Full suite 422/423; sole failure is the pre-existing environment
refresh-auth test, byte-identical before/after. GDP, GDP-per-capita and
Prices suites all green; their code paths untouched.

## 16. Limitations
- Classification vintage is current-retrieved (documented in API + UI).
- Total and average share rank ordering by construction (§33 noted in UI
  via distinct questions/units, both retained).
- Hyperinflation-style outliers affect unweighted means by design (same
  documented property as Prices); ranks unaffected.
