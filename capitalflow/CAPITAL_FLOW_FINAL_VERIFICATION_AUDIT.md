# Capital Flow Final Verification Audit (independent)
Branch: `methodology-redesign` | Date: 2026-09-26
Method: spec SHOULD vs live DOES; independent SQL/math oracles (Temp,
outside repo) for IND/USA/CHN rebuilt VALUE → UNIVERSE → RANK →
BENCHMARK → GAP; BEL negative-rank check; full suite read-only.

## 1. Canonical methodology read
`capitalflowmethod.txt` (704 lines) fully read: 3+3 ranked bases +
2 unranked diagnostics; S+1..E; DESC competition (Rank_i = 1+#{F_j>F_i});
gap = country − benchmark; negative/zero are data; cumulative share from
legs; no % growth; no stock language; group-first; strict completeness.

## 2. Exact basis count
`fdi_inflows`: annual, cumulative, average. `fdi_inflows_pct_gdp`:
annual, average, cumulative-share. Diagnostics excluded from dropdown
and `/api/indicators`; generic growth/period_total/CAGR rejected 400.
PASS.

## 3. Formula verification (diff 0 vs oracle throughout)
IND FDI annual 2004 5429250989.85717; cumulative 04→14 282134816995.23
(28213481699.52 avg, rank 18 both); share 04→14 1.914035042875123
(legs-verified, ≠ summed percentages); USA cum 2607463000000 (#2);
CHN cum 2011046902270.73 (#3); USA share 1.7158 (#145); spec oracles
5%, +0.7pp, ties all PASS.

## 4. Period-year verification
requiredYears S+1..E (10/10/20); annual = selected years; boundary year
in exactly one adjacent period. PASS.

## 5–6. Observed / LFL universe verification
FDI annual 192/198/195, LFL 186; cumulative 190/193/186, LFL 186;
share 186/190/182, LFL 182; ratio-avg LFL 182 — all match independent
SQL (share LFL = FDI∩GDP-complete sets). PASS.

## 7. Exact ISO3 verification
Cross-section rebuilt (FDI cum 04→14 n=190, IND #18, top NLD/USA/CHN);
LFL sets rebuilt (186/182, IND member). PASS.

## 8. Ranking verification
DESC everywhere (no ASC leakage); competition ties unit-proven;
full precision; BEL −$15.2B ranked #198/198 naturally. PASS.

## 9–10. Benchmark / gap verification
LOO N−1, focus excluded, same universe/values: IND cum gap
+171672702584.66 (diff 0); USA/CHN/ETH recomputed; USD gaps in USD,
ratio gaps in pp; positive = above. PASS.

## 11. Negative-value verification
Negatives preserved in DB, sums, ranks, ratios; never clamped/dropped.
PASS.

## 12. Missing-data verification
Missing legs exclude with reasons (+missing-year lists); single-economy
benchmark unavailable; unknown group/basis/metric 400. PASS.

## 13. Group-filter verification
Dynamic discovery; Developed 400s; group-first order; filtered-universe
benches exact; non-member focus null. PASS.

## 14–16. API / frontend / graph verification
All 6 endpoints return full schema; UI renders backend displays verbatim
(basis-specific wording, correct units, diagnostics labeled unranked,
flow-not-stock + nominal caveats); charts are backend-value grouped bars
with per-basis units; no frontend math (grep); responsive via reused
classes. PASS (inspection + build).

## 17. Responsive verification
Zero new CSS; Prices/GDP class reuse; mobile order preserved. PASS.

## 18. Regression verification
Full suite 449/450 (sole failure = pre-existing refresh-auth env test,
identical before/after); lint 0 errors; build OK; GDP/GDP-per-capita/
Prices/Trade suites green. PASS.

## 19. Specification gaps
None blocking. GDP denominator unnamed in spec → resolved to
`total_current` (NY.GDP.MKTP.CD) via same-price-basis rule + existing
registry linkage, documented. Raw-ratio vs derived approach fixed per
basis and documented (no silent switching).

## 20. Commit readiness
All 20 required items verified above.

COMMIT READY: YES
