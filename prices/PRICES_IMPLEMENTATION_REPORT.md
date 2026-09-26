# Prices Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26

## 1. Files changed
- NEW `backend/src/domain/pricesMovement.js` — pure canonical engine (8 bases, S+1..E vs endpoints, competition ranking, LOO benchmark).
- NEW `backend/src/services/pricesMovementService.js` — orchestration (group-first-then-validity, Observed/LFL, evidence) + `listPriceCountryGroups`.
- `backend/src/server.js` — `GET /api/movement/prices`, `GET /api/prices/country-groups`, additive `pricesBases` on `/api/indicators`, Prices paragraph in `methodologyBlock`, AUTO_REFRESH entries.
- `frontend/src/config/metrics.js` — `PRICES_BASES` (2/3/3), `isPricesMetricKey`, metric-aware `movementBases` (GDP branch byte-identical).
- `frontend/src/api/client.js` — `pricesMovement`, `priceGroups` transport (no calculation).
- NEW `frontend/src/sections/PricesMovement.jsx` — Prices Movement UI (controls, period/annual cards, Observed/LFL, basis-specific bar charts, verification).
- `frontend/src/sections/RankMovement.jsx` — Prices branch (hooks run unconditionally; generic fetch disabled for Prices; GDP rendering untouched).
- `frontend/src/App.jsx` — URL basis allow-list extended with the 8 Prices IDs.
- NEW `backend/test/pricesMovement.test.js` (22 tests), `backend/test/pricesApi.test.js` (15 tests).
- `prices/METHODOLOGY_IMPLEMENTATION_AUDIT.md`, `prices/OUT_OF_SCOPE_METHODOLOGY_FINDINGS.md`, this report.

## 2. Current Prices methodology before
Raw annual values + `B−A` pp/index-point diffs + ASC ordinal level ranks for
rates; CPI index never ranked (NEUTRAL). No period-change, no average, no
cumulative; growth/period modes refused with `unsupported_transformation_for_metric`.
Generic 4-option basis list (`level/growth/period_total/period_average`).

## 3. New Prices methodology after
Separate Prices-only engine; generic `[S,E)` flow logic never reused:
- CPI Index period change: endpoint-only `(E/S−1)*100`, no annualization.
- Inflation/deflator average: `sum(S+1..E)/(E−S)`; cumulative: `prod(S+1..E)(1+r/100)−1`, strict completeness.
- Full precision throughout; rounding presentation-only.
- Competition ranking ASC (1,1,3); benchmark = unweighted mean of other eligible; PP = benchmark − focus.

## 4. CPI Index: exact 2 bases
1. `cpi_index_annual` — raw WDI `FP.CPI.TOTL`, no rank, index-point diffs descriptive.
2. `cpi_index_period_change` — `(CPI_E/CPI_S−1)*100`, ASC competition rank. No period total / average / annualization / raw-level rank / global mean.

## 5. CPI Inflation: exact 3 bases (`FP.CPI.TOTL.ZG`)
1. `cpi_inflation_annual` — `I_t`, ASC competition rank + LOO PP.
2. `cpi_inflation_average` — `sum(S+1..E)/(E−S)`, complete sequence only.
3. `cpi_inflation_cumulative` — `prod(S+1..E)(1+I/100)−1`, compounding (never summed).
No endpoint-difference or inflation-rate-growth basis.

## 6. GDP-deflator: exact 3 bases (`NY.GDP.DEFL.KD.ZG`)
1. `deflator_annual` 2. `deflator_average` 3. `deflator_cumulative` — same structure on `D_t`, incl. negative-rate compounding. No `D_E−D_S` basis.

## 7. Observed implementation
Per-period basis-specific completeness: CPI period change = valid endpoints;
inflation/deflator average+cumulative = every year `S+1..E` valid; annual = valid in year `t`. Group restriction applied first, then validity. One missing required year → unavailable with reason (never partial/skipped/zero/interpolated).

## 8. Like-for-like implementation
Same formulas, intersected universe: annual = `U_S∩U_M∩U_E`; CPI change = valid in S+M+E; sequence bases = complete `S+1..E` full span (e.g. 2005..2024 for 2004/2014/2024). Same N across all periods within one LFL comparison.

## 9. Country-group filter implementation
Dynamic discovery, no hardcoding: `GET /api/prices/country-groups` returns DISTINCT `income_level` (4), `region` (7), `lending_type` (4) with eligible counts, derived live from `countries` (aggregates excluded). UI renders group-type/value selectors from that payload; membership resolved server-side via SQL. Order: group → validity → calculation → rank → benchmark.

## 10. Developed/Developing/Underdeveloped supported?
NO. The authoritative WB/WDI/project data contains no such labels and no approved mapping. Per the absolute rule they are NOT exposed, NOT mapped from income groups, NOT hardcoded. The endpoint documents `unsupportedRequestedLabels.status=NOT_SUPPORTED` with the reason; the UI states this in the verification section. Only `All` + the three dynamic WB classifications are available.

## 11. Why unsupported (exact)
Distinct `income_level`: High / Upper middle / Lower middle / Low (+Aggregates rows, excluded). Distinct `region`: 7 geographic regions. Distinct `lending_type`: IBRD / IDA / Blend / Not classified. None equals Developed/Developing/Underdeveloped; inventing a mapping (e.g. high income = developed) is explicitly prohibited without an approved methodology, so no mapping was created.

## 12. Ranking behavior
Per-basis full cross-section, ASC (lower first), full-precision values, competition ranking (ties share, next skips), denominator = eligible count of that exact universe. CPI annual raw: no rank with explicit explanation. Ranks never derived from rounded display values or from India-vs-average alone.

## 13. Benchmark/PP behavior
For every rankable basis: benchmark = unweighted arithmetic mean of all OTHER eligible values in the same universe; PP = benchmark − focus. Positive = focus lower than benchmark. Labeled "Average of other eligible economies" (never "world inflation"). Focus always excluded.

## 14. Missing-data behavior
States: valid / missing focus data (`focusAvailable=false`, no fabrication) / incomplete period (`incomplete_period` + missing-year list) / insufficient universe (single-economy benchmark unavailable) / ranking not applicable (annual index) / unsupported basis-group (400 + reason). UI shows `UnavailableState` with the actual reason and required years.

## 15. Graph changes
Reused `BarComparisonChart` (period comparison: focus vs benchmark per period, Observed and LFL separately) and annual snapshot bars; units from backend basis (`%`, `annual %`, `index points`), never mixed on one chart. Charts render backend analytical values verbatim (nulls → gaps, no recalculation). Time-series histories for Prices remain in the Overview `RatePanel`/`IndexPanel` (annual `%` with zero-line / index points); Movement charts no longer use `[A,B)` flow bars or endpoint slopes for Prices.

## 16. Responsive changes
No CSS changes needed: existing fluid layout (`--max-width:76rem`, auto-fit cards, `chart-body` 260→220px at 40rem, horizontal-scroll tables with sticky first col) already constrains the new cards/charts. New components reuse `.cards/.card/.card-unit` and `ChartCard`, so mobile behavior (wrap, no overflow, bottom-sheet pickers) is inherited. Verified via `npm run build`; no overflow introduces new fixed widths.

## 17. Tests added/updated
- `pricesMovement.test.js` (22): registry 2/3/3, unranked annual index, CPI change + point-change oracles (120.66% / 76.5 / 87.7 / 164.2), S+1..E expansion, avg 8.27% / cum 120.88% / deflator avg 7.39% / cum 103.67% oracles, compound-vs-sum (21% vs 20%, 15.5% vs 15%), strict incompleteness, deflation compounding, competition ties (1,1,3), 1e-9 precision, LOO benchmark + PP sign, single-economy refusal, prohibited-basis absence.
- `pricesApi.test.js` (15): invalid-basis/non-Prices 400s, CPI 2004→2024 full-precision (259.2584%), annual unranked shape, avg/cum oracles, cum≈index validation, LFL common-N, missing-data shape, group discovery (no Developed labels), group restriction ordering, unknown-group fail-closed, HTTP movement/groups/indicators (additive `pricesBases`, GDP untouched), GDP level regression.
- Full suite: 396/397 pass; sole failure is the pre-existing environment-dependent `POST /api/data/refresh` auth test (expects open endpoint while local `.env` sets `REFRESH_ADMIN_TOKEN`; documented in README, unrelated to this change).
- Frontend: `npm run lint` 0 errors, `npm run build` succeeds.

## 18. Regression status for Total GDP and GDP per capita
Identical by construction + test: shared `transforms.js`, `ranking.js`, `comparison.js`, `growthComparison.js`, `periodService.js`, `/api/comparison/level`, `/api/periods/summary`, `/api/compare`, `METRICS` GDP entries, `movementBases` GDP branch, and generic `RankMovement` rendering were not modified (only additive imports/branches elsewhere). Evidence: all GDP/per-capita/Total-GDP tests pass unchanged (per-capita vintage, Total-GDP math parity, Phase 7C-1 GDP oracle, 7B.6, 5.28), plus the new GDP-regression test in `pricesApi.test.js`.

## 19. Remaining limitations
1. Classification vintage is current-retrieved, not historical — period group comparisons use current membership (documented in API + UI).
2. Prices annual time-series in Movement uses snapshot bars; a full-history line chart for the focus country remains in Overview, not duplicated here.
3. No per-economy full ranking tables in Prices Movement (focus + counts + benchmark by design; full cross-section available via `/api/ranking` level endpoints where rankable).
4. Other families (trade/FDI/FX/external/population) unchanged pending their own canonical specs (see OUT_OF_SCOPE file).
