# Exchange Rate Rank-Integrity Gate (READ-ONLY)
Date: 2026-09-26 | Frozen direction: DESCENDING (owner-recorded).
Rule: rank = 1 + #{strictly greater}; median LOO benchmark; gap =
country − median. Zero production changes made.

Method: independent oracle rebuilt every eligible cross-section from raw
DB rows; compared FULL ordered ISO3 sequences, every rank, benchmarks,
gaps vs live API (B + C bases × 04→14/14→24/04→24 × Observed + LFL).

## Matrix (focus IND; diffs 0 throughout)
- Annual change: obs N 203/210/198, IND −2.7195%/+4.1498%/+1.2954%
  ranks #99/#57/#47, medians −2.9822/0/0; LFL N 190 ×3.
- Period change: obs N 203/196/192, IND +34.6740% #40, +37.0964% #59,
  +84.6333% #47; medians 0/22.8023/14.9823; LFL N 191 ×3.
- Full order exact (first-difference scan clean; intra-tie ISO3 secondary
  key deterministic); every rank exact (~1,200 economy-ranks, max abs
  difference 0); USA 0% #82 (in 32-way zero tie); JPN −2.08% #117.

## Gate items
- Ties: 10 natural groups (32 at 0.0 sharing one rank; IND∼BTN at #40);
  shared rank + correct skip + ISO3 order verified — PASS.
- Precision: full REAL compare; synthetic 1e-9 pair distinct (unit) — PASS.
- Negatives: appreciation values ranked normally — PASS.
- Benchmarks: LOO medians recomputed (IND/USA/JPN/CHN); N−1 peers — PASS.
- Gaps: country−median, pp, polarity-correct — PASS.
- Groups: filtered-universe ranking/benchmark verified pattern (service +
  tests) — PASS.
- Common/outside: LFL sets identical; UI renders backend `rank` verbatim,
  no `index+1`/`displayPosition`, search matches displayed rank,
  pagination slices only — PASS (code inspection).
- India independently confirmed in every cell — YES.

EXCHANGE RATE RANK-INTEGRITY GATE: PASS

Safe to commit from a ranking-integrity perspective.
