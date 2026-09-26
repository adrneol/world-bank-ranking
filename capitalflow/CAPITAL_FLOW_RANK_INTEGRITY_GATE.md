# Capital Flow Rank-Integrity Gate (READ-ONLY)
Date: 2026-09-26 | Rule: Rank_i = 1 + #{F_j > F_i} (DESC competition);
gap = country − leave-one-out benchmark. Zero production changes made.

Method: independent oracle (own SQL + own math, Temp scripts outside repo)
rebuilt every eligible cross-section from raw `worldbank.db` rows and
compared FULL ordered sequences, every rank, benchmarks, and gaps against
live `GET /api/movement/capital` responses. 126 + 11 checks, 0 failures.

## Per-basis × period matrix (Observed; S=2004/M=2014/E=2024, focus IND)

| Basis | Period | N | ISO3 set | Full order | Every rank | IND rank | Bench | Gap |
|---|---|---|---|---|---|---|---|---|
| FDI annual | 04→14 / 14→24 / 04→24 | 192/198/192 | YES | YES | YES | #28/#14/#28 | YES | YES |
| FDI cumulative | 04→14 / 14→24 / 04→24 | 190/193/186 | YES | YES | YES | #18/#13/#15 | YES | YES |
| FDI average | 04→14 / 14→24 / 04→24 | 190/193/186 | YES | YES | YES | #18/#13/#15 | YES | YES |
| Ratio annual | 04→14 / 14→24 / 04→24 | 189/196/189 | YES | YES | YES | #151/#133/#151 | YES | YES |
| Ratio average | 04→14 / 14→24 / 04→24 | 186/190/182 | YES | YES | YES | #136/#136/#134 | YES | YES |
| Cumul. share | 04→14 / 14→24 / 04→24 | 186/190/182 | YES | YES | YES | #134/#140/#138 | YES | YES |

LFL (all 6 bases): common N identical across periods (186/186/182…);
LFL ranking sets byte-identical across periods; LFL ranks equal oracle
ranks recomputed on the common universe (N=186 checked row-by-row).
USA/CHN benchmarks: N−1 peers, exact; gaps = country−bench exact.

## Gate items
1. Basis — all 6 above. 2. Period — 04→14, 14→24, 04→24.
3. Universe size — every N matches (§matrix). 4. ISO3 set exact — YES (18/18).
5. Full ordered cross-section exact — YES (18/18; first-difference scan clean).
6. Every rank exact — YES (all ~3,300 economy-ranks; max abs rank difference: 0).
7. Ties — no natural exact-duplicate exists in live cross-sections
   (scanned 4 universes, 0 groups); synthetic 100/90/90/70 → 1/2/2/4 and
   1,1,3 unit proofs green; code uses strict full-precision inequality —
   PASS (by construction + units).
8. Negative/zero — 3 negatives in FDI-cum universe (IRQ/SUR/AGO), all
   present, AGO lowest #190/190; zeros: none in this universe, unit-covered
   as data — PASS.
9. Full precision — min-gap live pair (PYF/SLB, $13,523 apart) distinctly
   ranked; 1e-9 synthetic pair distinctly ranked (unit) — PASS.
10. Benchmark exact — YES (IND all bases + USA/CHN/ETH; peers = N−1).
11. Gap exact — YES (USD, USD/year, pp per basis; sign = country−bench).
12. Group filter — High-income FDI-cum full order exact (N=68), zero
    out-of-group leakage; order is group→eligibility→value→rank→benchmark —
    PASS.
13. Common/outside integrity — LFL sets identical; outside = observed−common;
    UI renders backend `rank` verbatim in every `#` cell (common, outside,
    details), search matches displayed rank, pagination slices without
    renumbering; no `index+1`/`displayPosition` anywhere in CapitalMovement
    — PASS (code inspection).
14. India independently confirmed — YES (every cell of §matrix; e.g. FDI
    cum 04→14 #18/190, gap +171672702584.66 diff 0).
15. Maximum absolute rank difference — 0.
16. First mismatch — none (FAILURES: 0 across 137 checks).

CAPITAL FLOW RANK-INTEGRITY GATE: PASS

The implementation is safe to commit from a ranking-integrity perspective:
complete membership, DESC competition ordering, full-precision ranks,
LOO benchmarks, and country−benchmark gaps are exact across all 6 bases,
all periods, both universes, grouped universes, and the common/outside
presentation layer.
