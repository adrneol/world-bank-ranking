# External Sector Benchmark Freeze Decision (METHODOLOGY GATE — STOP)
Status: FROZEN by methodology owner on 2026-09-26: SPLIT.
MEDIAN for raw-scale bases (reserves stock, reserve change, remittance
annual/cumulative/average); MEAN for normalized ratio bases (CA annual/
average/cumulative, remittance intensity, reserve coverage). Encoded per
basis as `benchmarkType` in domain metadata, tests, API, and UI.

## Search performed (all negative for a frozen per-basis External rule)
1. `externalsector.txt:702-724` — LOO benchmark; mean default; median
   allowed for "highly skewed raw-value/change bases where appropriate"
   (remittance-US$ example only). Judgment language, not a per-basis freeze.
2. Registry/tests/code — median exists ONLY in FX (frozen by the FX spec);
   Prices/Trade/Capital use mean. No External per-basis rule anywhere.
3. Live skew (2024 cross-sections): reserves stock mean $74.3B vs median
   $6.2B (12×, max $3.3T); remittances mean $5.4B vs median $1.1B (5×, max
   $138B); CA/GDP mean −1.19 vs median −1.23 (well-behaved, ±38 range).

## Options
- (A) SPLIT (Recommended): MEDIAN for raw-scale/change bases — reserves
  stock, reserve change, remittance annual/cumulative/average (12×/5× skew
  plus the spec's own remittance example); MEAN for normalized ratio bases
  — CA annual/average/cumulative, remittance intensity, reserve coverage.
  Follows the spec's example and its "reasonably behaved → mean" logic.
- (B) ALL MEAN: simplest; follows the default only. Risk: benchmarks for
  reserves/remittance levels dominated by China-scale outliers.
- (C) ALL MEDIAN: most robust; deviates from the default for well-behaved
  ratios without spec support.

## Resolution required
Owner: freeze (A), (B), (C), or a per-basis variant with source. On
resolution, encode per-basis `benchmarkType` in domain metadata, tests,
API schema, frontend wording, and all four reports — then implement.
