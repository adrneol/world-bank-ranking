# Population Final Verification Audit (independent)
Branch: `methodology-redesign` | Date: 2026-09-26
Method: spec SHOULD vs live DOES; independent SQL/math oracles (Temp,
outside repo) for IND/USA/CHN rebuilt VALUE → UNIVERSE → RANK →
BENCHMARK → GAP; full suite read-only.

## 1. Canonical methodology read
`pop.txt` (568 lines) fully read: stock semantics, 3 bases, endpoints-only
change/growth, CAGR secondary, DESC competition (rank_i = 1+#{>}), mean
LOO, country−benchmark gaps (people/people/pp), strict completeness,
group-first, wording guards (size/increase/growth factual; estimate
framing; net-change ≠ births).

## 2. Exact basis count
`population_total`: annual, change, growth. CAGR rejected 400 as basis;
cumulative/average/growth rejected 400; other families gain no
`populationBases`. PASS.

## 3. Formula verification (diff 0 vs oracle)
IND change 04→14 176285678 (=1312277191−1135991513); growth +15.5182%,
CAGR +1.4530%; USA +26.45M/+9.03%; CHN +75.79M/+5.85%; spec oracles +200M,
+25%, +2.25%/yr all PASS.

## 4. Period-year verification
requiredYears [S,E] (never sequences); annual [t]; no S+1..E helper in
Population code (grep). PASS.

## 5–6. Observed / LFL verification
All universes N=217 (annual 217/217/217; periods 217/217/217; LFL 217);
LFL = endpoint intersection, sets identical. PASS.

## 7. Exact ISO3 verification
Full cross-sections rebuilt per basis/period; IND annual #2, change #1,
growth #93 (04→14); USA #134 / CHN #154 growth. PASS.

## 8. Ranking verification
DESC everywhere; competition ties unit-proven (no natural ties in N=217
universes — all values distinct); full precision; declines rank below.
PASS.

## 9–10. Benchmark / gap verification
Mean LOO recomputed (all bases incl. grouped USA/High-income); N−1 peers;
people/pp units; positive = above. PASS.

## 11. Negative-value verification
Declines preserved and ranked (unit + live USA/CHN positive cases;
negative-change unit oracle). PASS.

## 12. Missing-data verification
Missing endpoints exclude with reasons; single-economy benchmark
unavailable (unit); unknown group/basis/metric 400; zero-base guarded.
PASS.

## 13. Group-filter verification
Dynamic discovery; Developed 400s; group-first order; filtered-universe
bench exact (N=86); non-member focus null. PASS.

## 14–16. API / frontend / graph verification
All 3 endpoints return full schema (incl. CAGR secondary field, never a
rank); UI renders backend displays verbatim with stock wording, estimate
framing, size-sensitivity + scale-neutral notes, net-change guard, no
welfare language, no frontend math (grep clean); charts are backend-value
grouped bars with per-basis units (people vs %). PASS.

## 17. Responsive verification
Zero new CSS; family class reuse; mobile order preserved. PASS.

## 18. Regression verification
Full suite 528/529 (sole failure = pre-existing refresh-auth env test);
lint 0 errors; build OK; all prior families green. PASS.

## 19. Specification gaps
None. Benchmark explicitly mean; direction explicitly DESC; no
continuity-type issue exists for population stocks.

## 20. Commit readiness
Every checklist box holds: SP.POP.TOTL; stock enforced; 3 bases; annual/
change/growth correct; CAGR secondary; no cumulative/average/sequence;
endpoints; annual eligibility; LFL intersection; dynamic groups;
group-first; DESC competition; full precision; mean benchmark; focus
excluded; gaps exact; missing≠zero; declines preserved; N=1/N=2 correct;
full oracles green; rank order green; max rank diff 0; LFL green; group
green; ranks never renumbered; backend-rank search; no frontend math;
backend-value charts; correct units; concepts visually distinct; CAGR
secondary-labeled; no better/worse language; no performance claims;
net-change wording; estimate wording; disclosure present; responsive
desktop/tablet/mobile (class reuse); suites green.

COMMIT READY: YES
