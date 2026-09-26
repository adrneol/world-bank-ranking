# Population Methodology Implementation Audit
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `population/pop.txt` (568 lines, read completely).

## 1. Current implementation paths
- Registry `config.js:981-1018`: `population_total=SP.POP.TOTL` (correct
  code, ingested: 17,130 obs, 1960→latest; IND 2004=1.136B, 2014=1.312B,
  2024=1.451B). LEVEL, ABSOLUTE/PERCENT/YOY/CAGR declared, DESC, NEUTRAL,
  no periodAggregation. `aggregation: SUM` retained untouched (custom-group
  path, out of scope).
- Movement today: generic `level` (raw, DESC ordinal rank, no benchmark) +
  `growth` (unannualized endpoint % via yoy mode, ordinal, peer-mean
  `india−avg`) + refused period modes. No canonical 3-basis set, no
  endpoint-change basis, no CAGR secondary display, no mean LOO gap for
  annual, generic wording, no estimate/size-sensitivity disclosures.
- Frontend: generic basis dropdown; no population wording; generic charts.

## 2. Current vs canonical 3 bases
| Canonical | Current | Match? |
|---|---|---|
| A annual size (raw, DESC, mean LOO, people gap) | level (raw, DESC ordinal, NO gap) | Partial |
| B endpoint absolute change E−S (DESC, mean, people) | — (generic ABSOLUTE compare only) | **Missing** |
| C endpoint % growth (DESC, mean, pp) + CAGR secondary display | unannualized growth (ordinal, mean peer, no CAGR) | Partial |
| No cumulative/average/S+1..E bases | refused already | OK (keep refused) |
| Net-change (not births), estimate (not headcount), size-sensitivity notes | absent | **Missing** |

## 3. Key semantic deltas
- STOCK: endpoints S/E only for B/C; never sums/averages/sequences.
- Rank formula rank_i = 1+#{P_j>P_i} = DESC competition, full precision.
- Benchmark explicitly MEAN for all 3 bases (no gate needed — spec §Benchmark
  + final table are explicit); gap = country − benchmark (people/people/pp).
- Negative change valid (decline ranks below); missing excludes.
- Wording: size/increase/growth factual; never best/strongest/adequate/
  births/welfare; estimate framing.

## 4. Files to create/change (additive; shared engines untouched)
- NEW `backend/src/domain/populationMovement.js`, `backend/src/services/populationMovementService.js`.
- `server.js`: `GET /api/movement/population`,
  `GET /api/population/country-groups`, additive `populationBases`,
  methodology paragraph, refresh paths.
- `metrics.js`: `POPULATION_BASES` 3 + `isPopulationMetricKey`;
  `client.js` transport; NEW `PopulationMovement.jsx`;
  `RankMovement.jsx` branch; `App.jsx` allow-list.
- NEW `test/populationMovement.test.js`, `test/populationApi.test.js`.
- Docs in `population/` (this audit + 3 reports).

## 5. Risks
- PERCENT/YOY/CAGR declared on the registry could tempt generic-path reuse
  — Movement must use the new module only (CAGR display-only, same rank).
- ASC leakage from Prices — new DESC-only ranking fn.
- `aggregation: SUM` left as-is (group path out of scope; not Movement).
