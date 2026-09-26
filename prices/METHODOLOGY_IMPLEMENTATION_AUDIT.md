# Prices Methodology Implementation Audit
Branch: `methodology-redesign` (base commit 9199974)
Date: 2026-09-26
Authority for this audit: the three canonical files under `prices/` + live codebase inspection. `backup/old-master` methodology is NOT authoritative.

Canonical sources read completely:
- `prices/method-cpiindex.txt` (760 lines)
- `prices/cpiInflationmethodology.txt` (923 lines)
- `prices/gdpDeflator.txt` (1262 lines)

## 1. Current implementation paths (backend)

### 1.1 Metric registry — `backend/src/config.js`
- `CANONICAL_INDICATOR_CODES:75-97`: `inflation_cpi=FP.CPI.TOTL.ZG`, `inflation_cpi_index=FP.CPI.TOTL`, `inflation_deflator=NY.GDP.DEFL.KD.ZG`. Correct codes, must be preserved.
- `PRICES_METRICS:520-632`:
  - `inflation_cpi`: `observationType=RATE`, `validChangeTypes=[ABSOLUTE,PP]`, `rankingDirection=ASC`, `periodAggregation=[]`, `aggregation=OFFICIAL_ONLY`, `signDomain=SIGNED`.
  - `inflation_cpi_index`: `observationType=INDEX`, `validChangeTypes=[ABSOLUTE,INDEX_POINT]`, `rankingDirection=NEUTRAL`, `periodAggregation=[]`, `signDomain=POSITIVE_ONLY`, `baseYear=2010`.
  - `inflation_deflator`: same shape as `inflation_cpi` (RATE, ABSOLUTE+PP, ASC).
- Consequence: `PERCENT`, `YOY`, `CAGR`, `PERIOD_SUM/AVG` are all refused for Prices by `canTransform`. This is economically correct as a guard against generic flow math, but it also means **none of the 8 canonical Prices bases exist yet** except raw annual values + `B-A` differences.

### 1.2 Generic transformation layer — `backend/src/domain/transforms.js`
- Codes `36-49`: ABSOLUTE, PERCENT, PP, INDEX_POINT, YOY, CAGR, GROUP_SUM, GROUP_RATIO_FROM_SUMS, CROSS_RATE, PERIOD_SUM, PERIOD_AVG, PERIOD_SUM_PERCENT_CHANGE.
- Formulas `99-112`: `PERIOD_SUM=sum(values[A..B-1])`, `PERIOD_AVG=sum/N`. Authoritative interval `periodYears():422-432`: half-open `[startYear,endYear)` via `for(year=startYear; year<endYear)`. Doc example `2004→2014 = 2004..2013`.
- `percentChange():276-291` delegates to `computeYoy()` (GDP engine) after zero/negative/sign guards.
- `canTransform():132-171` gates point ops via `validChangeTypes`, period ops via `periodAggregation`. Prices declare neither, so period paths fail closed with `unsupported_transformation_for_metric`.
- **No function** for: CPI endpoint percent change `((E/S)-1)*100` as a ranked basis, inflation period average over `S+1..E`, inflation cumulative compounding `prod(1+r/100)-1`. `periods.js:INDEX_CUMULATIVE_PERCENT_CHANGE` exists as an unwired label only.

### 1.3 Period / movement engines
- Level endpoints only: `services/comparisonService.js:277-284`, `domain/comparison.js:386-402,1020-1032`. Reads `[A,B]` or `[A,M,B]`, interiors ignored.
- Growth intervals: `domain/growthComparison.js:118-135,267-309` — each interval is an independent endpoint pair `((end/start)-1)*100`, AB uses A,B only. Refused for Prices (`growthComparisonService.js:175-194` returns `unsupported_transformation_for_metric` because no `YOY` declared).
- Single-period summary: `services/periodService.js:93-103` reads `[A,B-1]` then `PERIOD_SUM/AVG`. Refused for Prices (`periodAggregation=[]`).
- `/api/compare` ops: `level,absolute_change,pp_change/index_point_change` work for Prices (correct `B-A` with pp vs index-point units); `percent_change,cagr` refused. `operationsForEntities` correctly refuses `NEUTRAL level` across countries for CPI index.

### 1.4 Ranking — `backend/src/domain/ranking.js`
- `rankByValue():96-112`: sorts by full-precision `value` (SQLite REAL), direction `DESC` default / `ASC` when declared, tie-break `ISO3 ASC`, `rank=index+1` → **distinct ordinal positions, NOT competition ranking**.
- Doc `1-24` explicitly says NOT competition/dense. `directionFor():74-79` returns null for NEUTRAL → callers refuse with `RANK_UNSUPPORTED` (`services/fullRanking.js:51-68`, `comparisonService.js:169-225`).
- Current Prices behavior: inflation rates rank ASC ordinal where allowed; CPI index never ranks. Canonical requires: CPI annual raw **no rank**, CPI period change **ASC competition ranking**, inflation/deflator all three bases **ASC competition ranking**, full-precision, ties share rank (`1,1,3`).

### 1.5 Observed vs Like-for-like — `domain/comparison.js`, `domain/growthComparison.js`, `services/entityCompare.js`
- Level 2-yr: `Common=A∩B`, `Exited=A-B`, `Entered=B-A` (`183-379`); 3-yr: `COMMON3=A∩M∩B` (`733-1011`). Verified identity `F_B-F_A=(K_B-K_A)+enteredAbove-exitedAbove`.
- Growth 3-yr: `U=G(AM)∩G(MB)∩G(AB)` (`growthComparison.js:296-298`).
- Entity groups: `observed[Y]=sum(valid in Y)`, `likeForLike[Y]=sum(valid in EVERY year)` (`entityCompare.js:86-146`).
- **All are endpoint-validity intersections.** No basis requires a full annual sequence `S+1..E`. Canonical requires:
  - CPI index period change: endpoints only (compatible with current level logic).
  - Inflation/deflator average+cumulative: complete `S+1..E` sequence; LFL across `2004/2014/2024` effectively requires `2005..2024` complete. Current code cannot express this; applying `[S,E)` (=`S..E-1`) would be off-by-one and economically wrong.

### 1.6 Benchmark / PP
- No `/benchmark` route, no per-country leave-one-out. Closest: `growthComparison.js:97-105,148-252` `peerAvgObserved/Common = mean(growthPercent over population minus focus IND)`, `vsPeer=indiaGrowth-peerAvg` (pp). Single exclude-focus average, descriptive only, ranks never depend on it.
- Canonical requires for every Prices basis: `benchmark=mean(other eligible values)`, `PP=benchmark-focus`, focus excluded, unweighted arithmetic mean, same universe, rank by value (monotonic with PP). Current peer logic is structurally similar but only exists in refused growth mode and is not exposed for Prices.

### 1.7 Country metadata / classification — `domain/universe.js`, `db/schema.sql`, `db/repository.js`
- Stored per entity: `region, region_id, admin_region, income_level, lending_type, capital_city, iso2/iso3` (`universe.js:83-101`, `schema.sql:26-40`).
- Aggregate rule only filter: `region.id==NA || region.value==Aggregates || blank ISO3` (`universe.js:56-75`). No income/region/group filtering in backend (`server.js` has no `?income=`/`?region=` param).
- Live DB (`backend/data/worldbank.db`, 2026-09-26) distinct values:
  - `income_level`: `High income, Upper middle income, Lower middle income, Low income` (+`Aggregates` rows).
  - `region`: 7 geographic regions (+Aggregates).
  - `lending_type`: `IBRD, IDA, Blend, Not classified` (+Aggregates).
  - Example: IND=`Lower middle income`, USA/DEU=`High income`, CHN=`Upper middle income`.
- **There is NO `Developed/Developing/Underdeveloped` classification in the authoritative data.** No mapping is approved. Hard-coding `high income=developed` is explicitly prohibited by the task. Vintage: classifications are the retrieved current vintage (`growthComparisonService.js:83`, `comparisonService.js:373-406` label them as such, not historical fact). This vintage limitation must be documented for period comparisons.

### 1.8 Current basis list (what UI offers today)
- Frontend `config/metrics.js:movementBases():348-388` returns 4 generic IDs for every metric: `level, growth, period_total, period_average`, availability from `validChangeTypes` (`YOY`) and `periodAggregation` (`SUM/AVG`).
- For Prices: `level` always available (label `Level (value)`); `growth, period_total, period_average` all disabled with reasons (`Growth analysis is not declared…`, `Period totals/averages are not defined…`). No CPI-specific labels exist in frontend; Prices appear only post-`hydrateRegistry`.
- Backend refuses the disabled modes with `400 + reason` (fail-closed). So today Prices Movement is effectively: raw annual values + `B-A` pp/index-point diffs + ASC level ranks for rates. **Missing: all 8 canonical bases as ranked movement analyses.**

## 2. Current formulas vs canonical

| Canonical basis | Canonical formula | Current code | Match? |
|---|---|---|---|
| CPI Index annual | raw `CPI_t`, no rank, index-point diff `E-S` descriptive | raw served; `INDEX_POINT B-A`; rank refused (NEUTRAL) | Partial — descriptive part exists, but no Movement period card structure |
| CPI Index period change | `(CPI_E/CPI_S-1)*100`, endpoints S,E, ASC competition rank, LOO benchmark, PP=bench-focus | No path: PERCENT undeclared, growth refused, periods refused | **Missing** |
| CPI Inflation annual | raw `I_t`, ASC competition rank, LOO PP | raw + ASC ordinal rank (where level rank allowed) + `PP B-A` compare | Partial — rank exists but ordinal not competition; no Movement annual cards |
| CPI Inflation average | `sum(S+1..E)/(E-S)`, complete sequence, ASC competition | No path (PERIOD_AVG refused; `[S,E)` would be wrong interval anyway) | **Missing** |
| CPI Inflation cumulative | `prod(S+1..E)(1+I/100)-1`, complete, ASC competition | No path | **Missing** |
| Deflator annual/average/cumulative | same structure on `D_t` | same as inflation row | Partial/Missing as above |
| Prohibited: period total CPI, period avg CPI as primary basis, annualized CPI change, raw CPI rank, global avg raw CPI, `D_E-D_S` as deflator basis, `(D_E-D_S)/D_S`, sum of inflation rates, partial periods, interpolation, zero-fill | — | Current guards already refuse most (PERCENT/YOY/CAGR/periods undeclared; missing never zero) | Guards preserve; must keep |

Critical interval distinction (per task note):
- CPI Inflation / Deflator average+cumulative **must use `S+1..E`** (10 obs for 2004→2014). Current generic `periodYears()` uses `[S,E)` = `S..E-1` — off-by-one for inflation and must NOT be reused.
- CPI Index period change **uses selected endpoint values only** (no annual accumulation). Must NOT apply `[S,E)` summation logic.

## 3. Ranking / universe / graph gaps
- Ranking: ordinal+ISO3-break vs required competition; NEUTRAL refusal vs required ASC rank for CPI period change only (annual raw must stay unranked).
- Universe: endpoint intersection vs required sequence-completeness for 4 of 8 bases.
- Benchmark: single descriptive peer avg in refused mode vs required per-basis LOO benchmark+PP for all 8 bases (annual index excluded from rank but still shows descriptive diffs, no cross-country mean).
- Graphs: `recharts` only, verbatim backend values (`chartData.js: NEVER calculate economics`, nulls preserved, gaps break lines). Current charts: time-series for histories, endpoint slopes, bars for `[A,B)` totals, rank slopes. **No Prices basis-specific period-comparison charts** (period change / average / cumulative bars driven by new backend values). Risk: reusing `[A,B)` bars or endpoint slopes with wrong interval/units.

## 4. Files that need changes
- NEW `backend/src/domain/pricesMovement.js` — pure: 8-basis value fns, `S+1..E` year expansion, completeness, competition ranking, LOO benchmark/PP.
- NEW `backend/src/services/pricesMovementService.js` — orchestration: validation, atomic reads, group-first-then-validity, Observed/LFL, evidence.
- NEW/EXTEND classification: `backend/src/services/priceGroups.js` (or inside movement service) + repo query `listClassifications` (DISTINCT income_level/region/lending_type among eligible) — dynamic, no hardcoding.
- `backend/src/server.js` — add `GET /api/movement/prices`, `GET /api/prices/country-groups` (or `/api/meta/classifications`); add to `AUTO_REFRESH_PATHS`; extend `methodologyBlock` with Prices wording (additive, GDP text unchanged).
- `backend/src/config.js` — add `PRICES_BASES` export (8 metric-specific definitions, formulas, rank direction, required years) + `describePricesBasis`; expose via `/api/indicators` additively (do not alter existing fields).
- `backend/src/db/repository.js` — add `getEligibleObservationsForYearRange` / reuse `getEligibleObservationsForYears` with explicit year lists; add `listDistinctClassifications`.
- `frontend/src/config/metrics.js` — extend `movementBases()` to return metric-specific Prices lists (2 / 3 / 3) when metric is Prices; keep GDP 4-generic list byte-identical.
- `frontend/src/api/client.js` — add `pricesMovement()`, `priceGroups()` transport fns.
- NEW `frontend/src/sections/PricesMovement.jsx` — Prices-only Movement UI (basis-aware cards, Observed/LFL, verification, responsive, no data dump); wire into `RankMovement.jsx` as branch or `App.jsx` view switch (preserve Movement architecture: Focus/Analysis/Metric/Basis/Start/Middle/End).
- `frontend/src/components/charts/*` — reuse `BarComparisonChart`/`TimeSeriesChart`/`SlopeChart` with new backend values; ensure units (`%`, `pp`, `index points`) never mixed; responsive already OK (`index.css` 260→220px, no overflow).
- Tests: NEW `backend/test/pricesMovement.test.js`, `backend/test/pricesApi.test.js`, extend `frontend` lint/build; hand-verify India examples (CPI 120.66%/62.62%/258.99%; inflation avg 8.27%, cum 120.88%; deflator avg 7.39%, cum 103.67%).
- Docs: `prices/OUT_OF_SCOPE_METHODOLOGY_FINDINGS.md`, `prices/PRICES_IMPLEMENTATION_REPORT.md` (required), plus this audit.

## 5. Shared components affected + regression risks
- `transforms.js`, `ranking.js`, `comparison.js`, `growthComparison.js`, `periodService.js`, `/api/comparison/level`, `/api/periods/summary`, `/api/compare` are shared with GDP/Total GDP/GDP-per-capita (declared correct, must stay regression-identical). **Do NOT modify their formulas, intervals, or ranking.** New Prices code must live in new modules and call new ranking fn, never change `rankByValue` behavior.
- `config.js` `METRICS` objects for GDP must not change; only add new exports.
- `server.js` `methodologyBlock` text for GDP must not change; append Prices section.
- `metrics.js` `movementBases` GDP branch must stay identical; add Prices branch.
- `RankMovement.jsx` generic branches must stay; add Prices branch that does not alter GDP rendering.
- Risk: frontend URL `basis` guard (`App.jsx:233-238`) is not metric-aware (falls back to `level`); Prices basis IDs must be allow-listed there or deep-links break. Risk: `periodYears()` reuse — must NOT reuse for inflation; new `pricesPeriodYears(S,E)=S+1..E`.
- Risk: competition ranking vs ordinal — changing shared `ranking.js` would break GDP regression tests (359 tests). Must implement `rankCompetition` in new module only.

## 6. Country-group filter — authoritative finding
- Requested `All/Developed/Developing/Underdeveloped` are **not supported** by authoritative WB/WDI/project data. Distinct values contain no such labels; no approved mapping exists. Per absolute rule: do NOT hard-code, do NOT map income→development, do NOT add fake filters.
- Implement instead: dynamic classification discovery (`income_level`: 4 groups, `region`: 7, `lending_type`: 4) + `All economies` default. Filter order: group membership first, then basis-specific completeness. Classification vintage = current retrieved vintage; historical membership is NOT tracked — document as limitation for period comparisons (Observed vs LFL interacts with current-vintage membership, not year-specific membership).
- Frontend must ask backend for available groups; no frontend constants for membership.

## 7. What NOT to change in this task
- Total GDP / GDP-per-capita formulas, ranking, API contracts.
- Trade, FDI, exchange, current account, reserves, remittances, population (record suspicions in OUT_OF_SCOPE file only).
- WDI as sole raw source; no IMF/OECD substitution; no interpolation/zero-fill.
