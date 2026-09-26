# External Sector Final Verification Audit (independent)
Branch: `methodology-redesign` | Date: 2026-09-26
Method: spec SHOULD vs live DOES; independent SQL/math oracles (Temp,
outside repo) for IND/USA/CHN rebuilt VALUE → UNIVERSE → RANK →
BENCHMARK → GAP; BEL-style negative checks; full suite read-only.

## 1. Canonical methodology read
`externalsector.txt` (813 lines) fully read: stock/flow split, 3/3/4
bases, S+1..E flows, endpoints-only reserve change, annual coverage,
legs-derived ratios, DESC competition, frozen SPLIT benchmark,
country−benchmark gaps, strict completeness, group-first, wording rules.

## 2. Exact basis count
CA 3, reserves 3, remittances 4 (diagnostics: none — every basis ranked);
generic growth/period_total/CAGR rejected 400; other families gain no
`externalBases`. PASS.

## 3. Formula verification (diff 0 vs oracle)
IND CA annual 2004 +0.11%, avg 04→14 −2.31%, cum −2.51%; reserves change
+139.71%, coverage 2014 6.88mo; remit cum $512.0B, avg = cum/10, intensity
3.47%; USA/CHN spot values match; spec oracles (−0.2%, 1.27%, +50%/−20%,
6/2mo, 66, 10%) all PASS.

## 4. Period-year verification
requiredYears S+1..E (10/10/20); reserve change [S,E]; annual [t];
coverage NOT averaged over periods. PASS.

## 5–6. Observed / LFL verification
CA cum 169/162/151, LFL 151; reserve change 170/163, LFL 158; coverage
146/155/143; remit cum 160/154/142, LFL 142; intensity LFL 141; annual LFLs
140/158/130/139 — all match independent SQL. PASS.

## 7. Exact ISO3 verification
Cross-sections rebuilt (CA cum n=169 IND #69, top KWT/BRN/MAC; reserve
change n=170 IND #99, top COG/SAU); coverage/remit sets equal (146/155/
143, 160/154). PASS.

## 8. Ranking verification
DESC everywhere; competition ties unit-proven (no natural ties found in
scanned universes — all values distinct); full precision; signed values
(+6>+2>0>−3>−8) ordered. PASS.

## 9–10. Benchmark / gap verification
Frozen split honored live (median stock bench recomputed; mean CA bench
recomputed); USA/CHN/grouped benches exact; N−1 peers; USD/pp/months
units; positive = above. PASS.

## 11. Negative-value verification
Deficit CA ratios, negative reserve changes preserved and ranked; never
abs/clamped/dropped. PASS.

## 12. Missing-data verification
Missing legs exclude with reasons (+missing-year lists); single-economy
benchmark unavailable; unknown group/basis/metric 400; zero denominators
guarded (GDP/imports/base > 0). PASS.

## 13. Group-filter verification
Dynamic discovery; Developed 400s; group-first order; filtered-universe
benches exact (USA/High-income CA); non-member focus null. PASS.

## 14–16. API / frontend / graph verification
All 10 endpoints return full schema (basis/formula/unit/rank/N/
benchmark+method/gap/requiredYears/reasons/Observed/LFL); UI renders
backend displays verbatim with basis-specific wording, correct units,
stock/flow caveats, no welfare/adequacy/dependency language, no frontend
math (grep: formatting/pagination only); charts are backend-value grouped
bars with per-basis units (USD, %, months, pp gaps in cards). PASS.

## 17. Responsive verification
Zero new CSS; family class reuse; mobile order preserved. PASS.

## 18. Regression verification
Full suite 505/506 (sole failure = pre-existing refresh-auth env test);
lint 0 errors; build OK; all prior families green. PASS.

## 19. Specification gaps
GDP denominator unnamed → `total_current` via same-basis rule + registry
linkage (documented). Raw-vs-derived ratio fixed per basis (documented).
Benchmark ambiguity → frozen SPLIT by owner (recorded). No other gaps.

## 20. Commit readiness
Every checklist box holds: indicators confirmed; 3/3/4 bases; scale-vs-
performance separation; stock never summed; endpoint S/E change;
coverage legs correct; flow accumulation correct; intensity from legs;
no summed percentages; S+1..E; LFL; completeness; safeguards; dynamic
groups; group-first; full-precision competition; full cross-section
oracles; benchmark/gap oracles; common/outside integrity (backend ranks
verbatim, search on backend rank); no frontend math; backend-value charts
with correct units; negatives correct; Observed/LFL clear; disclosures
present; responsive desktop/tablet/mobile (class reuse + stacked order);
suites green.

COMMIT READY: YES
