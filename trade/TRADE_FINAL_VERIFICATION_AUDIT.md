# Trade Final Verification Audit (independent, read-only where noted)
Branch: `methodology-redesign` | Date: 2026-09-26
Method: `trade/tademethod.txt` = SHOULD; live source + live API + live DB
= DOES. Independent SQL/math oracles (Temp scripts, outside repo) rebuilt
VALUE → UNIVERSE → RANK → BENCHMARK → GAP for India (all bases/periods)
plus USA/CHN alternates, then compared to live API.

## 1. Canonical methodology read
`tademethod.txt` (1243 lines, §§1–45 + frozen §45 table) fully read:
4 bases per metric, DESC everywhere, inclusive S..E flows (11/11/21),
CAGR endpoints-only with start>0 (end=0 → −100%), endpoint-% descriptive
companion, LOO benchmark, gap units USD/USD/year/pp, competition ties,
full precision, strict completeness, nominal-US$ caveat, group-first
ordering. No "better/worse", no "world average".

## 2. Exact 4/4 basis count
`/api/indicators`: exports → `exp_annual_value, exp_period_cagr,
exp_period_total, exp_period_average`; imports → `imp_*` equivalents.
GDP/Prices entries gain no `tradeBases`. Legacy `growth/period_total`
rejected 400. PASS.

## 3. Formula verification (India exports; imports spot-checked)
| Basis | 04→14 oracle | API | Diff |
|---|---|---|---|
| Annual 2004 | 126648472020.752 | identical | 0 |
| CAGR 04→14/14→24/04→24 | 13.971606239535683 / 5.886331873203665 / 9.85460992785676 | identical | 0 |
| Total 04→14 (11 obs) | 3514856846562.086 | identical | 0 |
| Average 04→14 (=total/11) | 319532440596.5533 | identical | 0 |
| Imports CAGR 04→14 | 14.279077337713897 | identical | 0 |
| USA exports CAGR 04→14 | 7.294386687209853 | identical | 0 |
Spec oracles: 100→300/10y = 11.61% ✓; 120→480/10y = 14.87% ✓;
100+110+120+130 = 460 ✓; 460/4 = 115 ✓; 450 vs 300 → −150 USD ✓;
8 − 11.61 = −3.61 pp ✓. Zero/negative-start exclusion, end=0 → −100%,
descriptive +200% companion all verified. Total rank = average rank (17)
as §33 predicts. PASS.

## 4. Observed universe verification (SQL vs API)
Exports annual 172/183/171; CAGR 166/168/155; total=average 167/168/155;
imports CAGR 166, total 167 — all match. PASS.

## 5. Like-for-like universe verification
Exports total LFL 155/155/155 (= complete 2004..2024 set, IND member);
CAGR LFL 154/154/154 (endpoints + positive starts, IND member); annual
LFL 155 (independently confirmed: every 04&14&24-valid economy also has
the full span — empty set difference, genuine coincidence, not a bug).
PASS.

## 6. Exact ISO3 set verification
CAGR LFL (n=154) and total LFL (n=155) sets reconstructed via independent
SQL intersections; IND member of both; observed-minus-common partitions
recomputed. PASS.

## 7. Rank verification
DESC competition on full precision: IND exports CAGR 04→14 #29/166
(oracle rebuilt cross-section identical, top TKM 28.17/LAO 24.82/AZE
22.63); totals #17/167 (imports #14/167); annual 23/172 → 15/183 →
11/171. No ASC leakage from Prices. PASS.

## 8. Competition tie verification
Synthetic 100/100/90/80 → 1/1/3/4 (unit); no natural tie in live
exports-CAGR cross-section; strict-equality code path inspected. Shared
GDP ordinal engine untouched. PASS.

## 9. Benchmark verification
Exports CAGR 04→14: oracle mean-others 9.138929031329878 vs API
9.138929031329878 (diff 0); N−1 peers; same universe/values; IND
excluded. PASS.

## 10. Gap/PP verification
CAGR gap −4.832677208205805 (diff 0), pp unit, sign = higher-than-average;
USD gaps (annual −62983389796.67 for 2004) in USD, never pp. PASS.

## 11. Missing-data verification
Zero/negative start → excluded with reasons; missing year → excluded
with missing-year list; single-economy benchmark unavailable; unknown
group/basis/metric → 400. No interpolation/zero-fill/partials. PASS.

## 12. Start/Middle/End verification
2004/2014/2024 → 04→14, 14→24, 04→24 with 10/10/20y CAGR exponents and
11/11/21y inclusive flows; annual snapshots 2004/2014/2024. PASS.

## 13. Current-US$ caveat
Present in API (`nominalCaveat`), glance line, and methodology panel;
never "real/volume growth". PASS.

## 14. API verification
`/api/movement/trade` (all 8 bases), `/api/trade/country-groups`
(dynamic, no `members` table), `/api/indicators` additive `tradeBases`
— all live, schemas carry basis/formula/focus/rank/benchmark/gap/
requiredYears/reasons. PASS.

## 15. Frontend/backend consistency
TradeMovement renders backend `valueDisplay/benchmarkDisplay/gapDisplay`
verbatim; tables sort on raw values with compact USD presentation only;
charts map focus/benchmark verbatim with per-basis units; basis dropdown
exactly 4+4; group selectors from live discovery. PASS.

## 16. Graph verification
Grouped focus-vs-average bars per universe; USD vs % never mixed;
CAGR companion shown as text (not ranked); no recomputation; responsive
via reused classes. PASS (code inspection + successful build).

## 17. Regression results
Full backend suite 422/423 (sole failure = pre-existing refresh-auth env
test, identical before/after); frontend lint 0 errors, build succeeds;
GDP, GDP-per-capita, Prices suites green; their files untouched except
additive registry/route/wiring lines. PASS.

## 18. Limitations
Classification vintage is current-retrieved (documented); total/average
share ordering by construction (both retained per spec); inclusive
middle-year double-count is per spec (documented).

## 19. Methodology ambiguity discovered
None blocking. T_E<0 for CAGR is unspecified by the file (flows are
non-negative in practice); implementation excludes it as
`negative_endpoint_for_cagr` rather than producing NaN — documented here
as a fail-closed gap-fill, no spec contradiction.

METHODOLOGY CHANGED FROM SPEC: NO

FORMULAS VERIFIED: PASS

OBSERVED UNIVERSES VERIFIED: PASS

LIKE-FOR-LIKE UNIVERSES VERIFIED: PASS

RANKING VERIFIED: PASS

BENCHMARKS VERIFIED: PASS

FRONTEND VERIFIED: PASS

REGRESSION VERIFIED: PASS

COMMIT READY: YES
