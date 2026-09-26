# Trade Methodology Implementation Audit
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `trade/tademethod.txt` (1243 lines, read completely). Neither the
Prices specs nor this prompt substitute for it.

## 1. Current implementation paths
- Registry `backend/src/config.js:638-715`: `exports_current=NE.EXP.GNFS.CD`,
  `imports_current=NE.IMP.GNFS.CD` (codes correct, must be preserved).
  `observationType=FLOW`, `validChangeTypes=[ABSOLUTE,PERCENT,YOY,CAGR]`,
  `aggregation=SUM`, `rankingDirection=DESC`, `interpretation=NEUTRAL`,
  `signDomain=POSITIVE_ONLY`, `periodAggregation=[SUM,AVG]`.
- Movement bases `frontend/src/config/metrics.js:movementBases`: generic
  `level / growth('Annual flow (endpoint B vs A)') / period_total /
  period_average`, availability from `YOY` + `SUM/AVG` declarations.
- Level: `comparisonService` endpoint-validity intersections, DESC ordinal
  rank (ISO3 break), no benchmark.
- Growth (`mode=yoy`): `growthComparison` independent endpoint pairs
  `((B/A)-1)*100` (UNannualized), DESC ordinal rank, single exclude-focus
  peer mean, `vsPeer = india − peerAvg` (pp).
- Periods: `periodService` strict sums/averages over half-open `[S,E)`
  (`transforms.js:periodYears`: 2004→2014 = 2004..2013), unranked, focus-only.
- `/api/compare`: ABSOLUTE/PERCENT/YOY/CAGR ops; custom ISO3 groups summed
  (`SUM` aggregation); no classification-group restriction.
- Charts: time-series, endpoint bars, `[S,E)` period bars, growth bars —
  backend values verbatim.

## 2. Current basis list vs canonical 4+4
| Canonical basis | Current equivalent | Match? |
|---|---|---|
| Annual trade value (raw, DESC rank, USD LOO gap) | level (raw, DESC ordinal rank, NO benchmark) | Partial — rank exists but ordinal; gap missing |
| Period trade growth — CAGR (annualized, DESC, pp LOO) | growth = UNannualized endpoint % (ordinal rank, inverted-sign peer diff) | **Missing** — wrong growth concept (§45.1221-1239 explicitly redefines this) |
| Period total, inclusive S..E (11/11/21) | period_total over [S,E) (10/10/20, off by one, unranked) | **Missing** — wrong interval + no rank/benchmark |
| Period average, total/(E-S+1) | period_average over [S,E) (unranked) | **Missing** — wrong divisor + no rank/benchmark |

## 3. Current formulas vs canonical
- CAGR `((E/S)^(1/(E-S))-1)*100` with T_S>0 gate, T_E=0→−100%: NO path
  (generic `cagr()` exists in transforms but is ungated-by-registry for
  Movement and unused by the growth engine, which uses simple percent).
- Inclusive sums S..E: NO path (authoritative `periodYears` is `[S,E)`).
- LOO benchmark + gap/PP per basis with basis-specific units (USD vs pp):
  NO path (only growth-mode peer avg with opposite sign).
- Competition ranking (1,1,3): NO path (shared `rankByValue` ordinal).
- Endpoint % as *descriptive* CAGR companion (§34): NO path.
- Nominal-US$ caveat in Movement UI: absent.

## 4. Ranking / universe / benchmark gaps
- Ranking: ordinal+ISO3 vs required competition DESC on full precision.
- Universes: endpoint intersections exist for level/CAGR-shape, but no
  complete-sequence S..E universes; no positive-start gate for CAGR; no
  2004..2024 full-span LFL for totals.
- Benchmark: descriptive single peer avg in growth mode only; annual/total/
  average have none; sign convention (`india−avg`) contradicts canonical
  (`avg−focus`).
- Groups: custom member lists only; no dynamic WB-classification
  restriction (income/region/lending) with group-first ordering.

## 5. Graph gaps
No CAGR/period-total/period-average ranked comparison charts; existing
bars use `[S,E)` data or unannualized growth — all must be replaced for
Trade Movement with backend canonical values.

## 6. Files needing changes (new Trade-specific modules; shared engines untouched)
- NEW `backend/src/domain/tradeMovement.js` (8 bases, inclusive years,
  CAGR validity, DESC competition rank, LOO benchmark, display strings).
- NEW `backend/src/services/tradeMovementService.js` (group-first
  orchestration, Observed/LFL, evidence) + group discovery.
- `backend/src/server.js`: `GET /api/movement/trade`,
  `GET /api/trade/country-groups`, additive `tradeBases` on
  `/api/indicators`, trade paragraph in `methodologyBlock`, refresh paths.
- `frontend/src/config/metrics.js`: `TRADE_BASES` 4+4 + `isTradeMetricKey`;
  GDP/Prices branches byte-identical.
- `frontend/src/api/client.js`: `tradeMovement`, `tradeGroups`.
- NEW `frontend/src/sections/TradeMovement.jsx`, branch in `RankMovement.jsx`;
  `App.jsx` basis allow-list extension.
- NEW `backend/test/tradeMovement.test.js`, `tradeApi.test.js`.
- Docs: `trade/TRADE_IMPLEMENTATION_REPORT.md`,
  `trade/TRADE_FINAL_VERIFICATION_AUDIT.md` (this file is the audit).

## 7. Shared components affected + risks
- `transforms.js`, `ranking.js`, `comparison.js`, `growthComparison.js`,
  `periodService.js`, `/api/comparison/level`, `/api/periods/summary`,
  `/api/compare`, GDP + Prices paths: DO NOT MODIFY. New Trade code lives
  in new modules (Prices precedent). `rankByValue` ordinal stays for GDP.
- Risk: frontend URL `basis` guard is not metric-aware — extend allow-list
  (Prices precedent), components correct stale IDs.
- Risk: `[S,E)` reuse — forbidden for Trade; new `tradeYears(S,E)` helper.
- Risk: ASC/DESC confusion — Trade is DESC on all 4 bases (opposite of
  Prices); new ranking fn must default DESC.
- Inclusive-period double-count note: 2014 belongs to both adjacent flow
  periods by spec; document, do not "fix".

## 8. Group-filter finding (anticipated)
Same authoritative store as Prices: `income_level` (4), `region` (7),
`lending_type` (4); no Developed/Developing/Underdeveloped labels (to be
re-verified live during implementation). Dynamic discovery, no hardcoding.
