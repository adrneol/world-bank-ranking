# Trade Methodology Conformance Audit (READ-ONLY)
Date: 2026-09-26 | Branch: `methodology-redesign`
Authority: `trade/tademethod.txt` SHOULD; live code + API + DB DOES.
Nothing was modified during this audit (one new doc file excepted).

## 0. Executive verdict: CONFORMANCE WITH SPECIFICATION GAP (NON-BLOCKING)

All material rules conform. The single ambiguity — negative END value for
CAGR, on which the file is silent — is classified below as
SPECIFICATION GAP — NON-BLOCKING (fail-closed exclusion, economically
consistent with the WDI non-negative flow domain). One non-blocking UX
note (sort label "best first"). COMMIT READY = YES.

## 1. Conformance matrix (section/rule → implementation → test → verdict)

| Spec § / Rule | Expected | Location | Actual | Independent test | Verdict |
|---|---|---|---|---|---|
| §§1,45 indicators | NE.EXP.GNFS.CD / NE.IMP.GNFS.CD, WDI-only | `config.js:75-97`, service reads `observations` only | Exact codes; no other source import in Trade path | API codes match; WDI-only | PASS |
| §2 nominal semantics | Current-US$ = nominal, not real/volume | API `nominalCaveat`, UI glance + methodology | Caveat visible in 3 places | String search | PASS |
| §§3,45 4+4 bases | Annual, CAGR, total, average per metric | `tradeMovement.js:33-45`, `metrics.js:TRADE_BASES`, `/api/indicators` | Exactly 4+4 IDs; GDP/Prices gain no `tradeBases` | Live catalog | PASS |
| No generic bases | No generic growth/YoY/period_total for Trade | `server.js` movement/trade (400s), `movementBases` Trade branch | `growth`, `period_total`, non-Trade metric → 400 | Live 400s | PASS |
| §4 annual = raw | No transformation | service annual path (direct map) | Raw passthrough | Oracle diff 0 | PASS |
| §§5,22 annual rank | DESC, highest first, competition, full precision | `rankTradeDesc` (b−a, strict equality) | DESC 1,1,3,4; IND 23/172→15/183→11/171 | Oracle rebuild | PASS |
| §6 annual benchmark | LOO mean, gap=bench−focus, USD, descriptive | `tradeLeaveOneOut` + service `gapUnit` | −62983389796.67 for 2004; recomputed exactly | Oracle | PASS |
| §7 CAGR formula + exponents | ((E/S)^(1/(E−S))−1)×100; 1/10,1/10,1/20 | `tradeCagr` | 13.9716/5.8863/9.8546, diff 0 | Oracle | PASS |
| §7 endpoints only | Interiors never required | `tradeRequiredYears`→`[S,E]`; CAGR branch reads only `ym.get(S/E)` | requiredYears `[2004,2014]`; N 166 = endpoint-intersection count | SQL + code | PASS |
| §§12,39 start>0; end=0→−100% | start=0/<0 excluded; end=0 valid | `tradeCagr` gates | All 5 synthetic cases PASS | Domain tests | PASS |
| Negative END | file silent | `tradeCagr` excludes (`negative_endpoint_for_cagr`) | Fail-closed | Domain test | SPEC GAP (non-blocking) |
| §§10,22 CAGR rank | DESC competition | `rankTradeDesc` | IND #29/166; top TKM/LAO/AZE | Oracle | PASS |
| §11 CAGR PP | bench−focus, pp, sign (11.61 vs 8 → −3.61) | LOO + gapUnit pp | −4.832677208205805 diff 0 | Oracle | PASS |
| §§13–16 total | Inclusive S..E sum; DESC; USD gap | `tradePeriodTotal` + `tradeYears` (≤) | 11/11/21 obs; $3.515T #17 | Oracle | PASS |
| §§17–20 average | sum/(E−S+1); DESC; USD/year gap | `tradePeriodAverage` | /11,/11,/21; rank 17 = total rank | Oracle | PASS |
| §33 total≡average ordering | Same order, distinct statistics | Both retained; UI distinct labels/units | Ranks identical, values differ | API | PASS |
| §34 endpoint companion | Descriptive only, never ranked | `tradeEndpointChange` + footnote text | +269.80% shown; rank from CAGR | API | PASS |
| §35 gap units | USD/USD/pp/USD | `gapUnit` per basis + display strings | Verified in payloads + UI | API + strings | PASS |
| §§36–37 full examples | 11.61%, 14.87%, gaps | — | 11.61/14.87 oracles PASS | Domain | PASS |
| §38 no welfare claims | No best/worse; imports neutral | rankWording "largest/highest"; caveat text | String search clean (sort-label note N1) | Strings | PASS |
| §39 missing data | Exclude all; no interpolation/zero/partial | Gates + `incomplete_period` + missingYears | Unit + live verified | Tests | PASS |
| §§40–41 precision/ties | Full precision; 1,1,3 | Strict-equality compare on REALs | 7.431827≠7.432102 distinct | Tests | PASS |
| §42 groups | Group-first; dynamic; no world-average | `resolveTradeGroupFilter` + service order | IDA/High-income benches exact | Live | PASS |
| §43 benchmark | LOO per basis, N−1, same universe | `tradeLeaveOneOut` per section | USA/CHN/ETH recomputed exactly | Live | PASS |
| §44 table | Question/input/formula/units/validity per basis | Basis info + API payloads | All match | API | PASS |
| §§23–26 Observed/LFL | Annual: year; CAGR: endpoints+positive starts; total/avg: full S..E span | Service branches | N/sets match SQL (incl. 154 vs 155 split) | SQL | PASS |
| §§27–31 S/M/E | 3 periods; 10/10/20y CAGR; 11/11/21y flows | Period builders | Verified live | API | PASS |
| §32 inflation distinction | S..E not S+1..E; no `[S,E)` reuse | Own `tradeYears`; zero imports of generic helpers (grep) | 11/11/21 live | Grep+API | PASS |
| 2014 overlap | In both adjacent flow periods | Inclusive expansion; required-lines document | 2014 in both; UI states inclusive spans | API+UI | PASS |

## 2. 4-basis × 2-metric test matrix (2004/2014/2024, IND + USA/CHN/ETH)
Exports annual/CAGR/total/average and imports annual/CAGR/total/average:
all values diff 0 vs oracle; all Ns match SQL; USA exports CAGR 7.2944,
CHN 15.0268; USA/CHN imports-total benches exact; ETH IDA grouped bench
exact; non-member (IND in IDA) focus correctly null. PASS.

## 3–6. Formula / Observed / LFL / ISO3 verification
Recorded above (§1 rows + §2). Imports-total 04→14 ISO3 set equality:
167/167 exact. CAGR LFL set (154, IND member) and total LFL set (155)
rebuilt via independent SQL. Annual LFL = total LFL = 155 as sets
(empty difference — genuine data property, independently confirmed).
PASS.

## 7. Ranking verification
DESC everywhere (no ASC leakage); competition ties unit-proven;
full-precision live pair distinctness established in Prices audit method
and Trade unit tests; top-3 and around-focus rows reproduced from oracle
cross-section. PASS.

## 8–9. Benchmark / gap verification
N−1 LOO, focus excluded, same universe/values, full precision, for
IND/USA/CHN/ETH across bases; USD gaps never labeled pp; CAGR gaps in
pp with correct sign. PASS.

## 10. S/M/E + 2014-overlap verification
Exponents 10/10/20; spans 11/11/21; snapshots year-only; 2014 in both
adjacent flow periods per spec; UI required-lines + methodology state
inclusive spans. PASS.

## 11. Missing-data verification (11 cases)
Annual-missing, CAGR-missing-start/end, start=0, start<0, interior-missing
total/average, single-economy benchmark, unknown group/basis/metric —
all exclude/fail-closed with reasons; no interpolation/zero/partial.
PASS. (No real-DB interior-missing CAGR case exists — endpoint-valid
economies are gap-free — so inclusion-with-missing-interior is proven by
code path + requiredYears + unit tests rather than live rows; noted.)

## 12. Group-filter verification
Order group→validity→value→rank→benchmark (code); dynamic discovery
(income 86/25/47/59 etc.); Developed 400s; filtered benches exact;
non-member focus null. PASS.

## 13. API verification
All 8 endpoints return metric/basis/formula/unit/focus/value(+display)/
rank/denominator/benchmark(+display)/gap(+display)/requiredYears/
reasons/observed/LFL/descriptive/caveat. PASS.

## 14. Frontend semantic verification
Basis labels ("Annual export value", "Nominal…" via rankWording +
caveat), benchmark/gap units (USD strings vs pp), required lines
(endpoint vs annual vs selected-year), inclusive wording, nominal caveat
in 3 surfaces, Observed/LFL/Common/Outside language exact, no real/
volume/best/world-average claims. PASS with note N1.

## 15. Graph verification
Grouped focus-vs-average bars per universe from backend values only;
USD/% never mixed; no `[S,E)` data; no unannualized growth; no frontend
math (grep: zero arithmetic beyond formatting). PASS (inspection + build).

## 16. Regression verification
Full suite 422/423; only the pre-existing refresh-auth env failure
(identical before/after); frontend lint 0 errors, build OK; GDP,
GDP-per-capita, Prices suites green. PASS.

## 17. Specification gaps
G1 (non-blocking): negative END value for CAGR unspecified; implementation
fail-closes (`negative_endpoint_for_cagr`), consistent with the
non-negative WDI flow domain. No spec text contradicts this.

## 18. Non-blocking documentation/UX issues
N1: common-table sort option reads "Rank — best first" (GDP-shared
wording for rank order, not an economy-welfare claim). Acceptable; no change.

## 19. Section-level rule coverage (§§1–45)
All material rules IMPLEMENTED AND TESTED except: G1 (implemented,
fail-closed; untestable against live rows since no negative trade flows
exist in the vintage — unit-covered) and the intermediate-missing CAGR
inclusion (implemented; live rows absent — code-path + unit-covered).
No VIOLATION.

## 20. Commit readiness
All decision-rule conditions met (formulas, 8 bases, semantics,
intervals, universes, ranks, ties, benchmarks, units, missing-data,
groups, API, frontend, regression; G1 explicitly classified non-blocking).

COMMIT READY: YES
