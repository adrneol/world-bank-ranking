# Exchange Rate Final Verification Audit (independent)
Branch: `methodology-redesign` | Date: 2026-09-26
Method: spec SHOULD vs live DOES; independent SQL/math oracles (Temp,
outside repo) for IND/USA/JPN/DEU rebuilt VALUE → UNIVERSE → RANK →
BENCHMARK → GAP; full suite read-only.

## 1. Canonical methodology read
`exchangerate.txt` (604 lines) fully read: price (not flow) semantics,
3 bases (A unranked; B/C ranked), endpoint-only changes, t−1/t and S/E
eligibility, LFL intersections, LOO median, country−median pp gaps,
competition ranking, strict completeness, continuity policy, nominal/
bilateral/USD disclosure, no strength language.

## 2. Exact basis count
`fx_official`: annual rate, annual change, period change. CAGR never a
basis (400s for `fx_cagr`, `growth`, `period_total`); GDP/Prices/Trade/
Capital gain no `fxBases`. PASS.

## 3. Formula verification (diff 0 vs oracle)
IND annual 2004 −2.7195% (45.316/46.583); period 04→14 +34.6740%,
14→24 +37.0964%, 04→24 +84.6333%; CAGR secondaries exact; spec oracles
+2.5%, −4.54545%, +35.555%, −20%, +25%/+2.26% all PASS; JPN/DEU/USA
(zeros) match.

## 4. Period-year verification
Annual requiredYears [t−1,t]; period [S,E]; no S+1..E / S..E / [S,E)
contamination (grep + live). PASS.

## 5–6. Observed / LFL verification
Annual N 203/210/198 (t−1/t SQL match); period N 203/196/192; level N
204/210/198; LFL annual 190, period 191 (both = independent SQL),
common sets identical across periods. PASS.

## 7. Exact ISO3 verification
Full 04→14 cross-section rebuilt (n=203); IND #40; top MMR/SYR/BLR.
PASS.

## 8. Ranking verification
DESC competition (frozen, owner-recorded); no ASC leakage; full precision;
10 natural tie groups incl. 32 economies at exactly 0 sharing one rank
(pegged currencies) and IND tied with BTN at #40 — shared rank, correct
skip, ISO3-ordered within groups. PASS.

## 9–10. Benchmark / gap verification
LOO median recomputed (04→14 median = 0 vs mean 106.44 — choice
validated); USA/CHN/JPN recomputed; gaps = country − median in pp with
correct polarity language. PASS.

## 11. Negative-value verification
Appreciation (negative %) preserved, ranked, interpreted; never clamped.
PASS.

## 12. Missing-data verification
Missing t−1/t/S/E exclude with reasons; single-economy median
unavailable (unit); N=2 median = other value (unit); no zero-fill/
interpolation; unknown group/basis/metric 400. PASS.

## 13. Group-filter verification
Dynamic discovery; Developed 400s; group-first order; non-member focus
null. PASS.

## 14–16. API / frontend / graph verification
All 3 endpoints return full schema (Basis A carries no rank/benchmark/
gap fields by construction); UI renders backend values verbatim with
polarity wording, median/gap units, CAGR labeled secondary, 18-point
disclosure, no strength language, no frontend math (grep); charts are
backend-value bars/levels with correct units and polarity titles. PASS.

## 17. Responsive verification
Zero new CSS; family class reuse; mobile order preserved. PASS.

## 18. Regression verification
Full suite 475/476 (sole failure = pre-existing refresh-auth env test);
lint 0 errors; build OK; all prior families green. PASS.

## 19. Specification gaps
Rank direction was unspecified → frozen DESCENDING by owner (recorded,
encoded, tested). Continuity metadata absent → documented policy, no
fabrication. No other gaps.

## 20. Commit readiness
All acceptance boxes hold (PA.NUS.FCRF; levels never ranked; 3 bases;
exact formulas; CAGR secondary; t−1/t and S/E eligibility; LFL; no
interval contamination; group-first; frozen DESC; full-precision
competition; verified universes/sequences/medians/gaps/units; negatives
preserved; no mean; no strength language; caveats visible; no frontend
math; ranks never renumbered; rank search on backend rank; correct chart
units/polarity; responsive; disclosure; oracles; rank gate; suites).

COMMIT READY: YES
