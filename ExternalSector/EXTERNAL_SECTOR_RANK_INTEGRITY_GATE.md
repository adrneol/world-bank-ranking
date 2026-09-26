# External Sector Rank-Integrity Gate (READ-ONLY)
Date: 2026-09-26 | Rule: higher numerical value → rank 1 (DESC competition:
rank = 1 + #{strictly greater}); gap = country − LOO benchmark (frozen
per-basis mean/median). Zero production changes made.

Method: independent oracle rebuilt every eligible cross-section from raw
DB rows; compared FULL ordered ISO3 sequences, every rank/value,
benchmarks, gaps vs live API (all 10 bases; 04→14/14→24/04→24 × Observed;
LFL sets verified).

## Matrix (focus IND unless noted)
- CA annual 2004/2014: sets N=160/189 exact; every value+rank exact.
- CA average/cumulative 04→14: N=169 exact; values+ranks exact.
- Reserves stock 2004/2014: N=171/176 exact.
- Reserves change 04→14: N=170 exact; IND #99; top COG +4018%/SAU +2582%.
- Coverage 2004/2014/2024: N=146/155/143 exact; every value+rank exact.
- Remit annual 2004/2014: N=164/181 exact.
- Remit cumulative/average 04→14: N=160 exact; ranks identical (avg=cum/N).
- Remit intensity 04→14: N=159 exact.
- USA/CHN spot ranks/values/benchmarks exact; grouped (USA/High-income CA)
  benchmark = filtered mean exact; non-member focus null.

## Gate items
- Ties: no natural exact-duplicates in scanned universes (all distinct);
  synthetic 100/90/90/70 → 1/2/2/4 unit-proven; strict full-precision
  compare in code — PASS (by construction + units).
- Precision: 1e-9 synthetic pair distinct (unit); oracle/API diffs 0 at
  1e-9 relative tolerance — PASS.
- Negatives/zeros: deficit ratios and negative changes ranked naturally
  (no abs/clamp/drop) — PASS.
- Benchmarks: N−1 peers, focus excluded, same universe/values, frozen
  statistic honored per basis — PASS.
- Gaps: country−benchmark, USD/USD-year/pp/months per basis — PASS.
- Groups: filtered-universe ranking/benchmark exact; no leakage — PASS.
- Common/outside: LFL sets identical across periods; UI renders backend
  `rank` verbatim (`rankCell` on backend fields; search matches displayed
  rank; pagination slices only; no `index+1`/`displayPosition`) — PASS
  (code inspection).
- India independently confirmed in every cell — YES.
- Maximum absolute rank difference — 0. First mismatch — none.

EXTERNAL SECTOR RANK-INTEGRITY GATE: PASS

Safe to commit from a ranking-integrity perspective.
