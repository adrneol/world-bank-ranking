# Population Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `population/pop.txt` (untouched). Other families used as
architectural reference only — no formula copied.

## 1. Files changed / created
- NEW `backend/src/domain/populationMovement.js` — 3 bases, endpoint-only
  change/growth, DESC competition, mean LOO, country−benchmark gaps.
- NEW `backend/src/services/populationMovementService.js` — year/endpoint
  validity, Observed/LFL, people/pp displays, CAGR secondary field.
- `backend/src/server.js` — `GET /api/movement/population`,
  `GET /api/population/country-groups`, additive `populationBases`,
  methodology paragraph, refresh paths. No existing route touched.
- `frontend/src/config/metrics.js` — `POPULATION_BASES` 3 +
  `isPopulationMetricKey`; `client.js` — `populationMovement`,
  `populationGroups`; NEW `PopulationMovement.jsx`; `RankMovement.jsx`
  branch; `App.jsx` allow-list + 3 IDs.
- NEW `test/populationMovement.test.js` (15), `test/populationApi.test.js` (8).
- Docs in `population/` (audit, final verification, rank gate, this report).

## 2. Before → after
Before: generic level (ordinal DESC, no gap) + unannualized growth +
refused periods. After: canonical annual/change/%-growth with DESC
competition ranks, mean LOO gaps (people/people/pp), display-only CAGR,
stock-only wording, estimate framing, no cumulative/average bases.

## 3. Bases
`population_total` (SP.POP.TOTL, 17,130 obs): annual raw; change E−S;
growth (E/S−1)*100 + CAGR secondary (same rank, never a basis).
Each metric exposes only its 3 (single-metric family).

## 4. Key semantics
STOCK: endpoints S/E only (never sums/averages/sequences — verified by
grep: no S+1..E helper exists in Population code). Negative change valid
(decline ranks below). Missing excludes. Gap = country − mean. Higher =
larger/faster — never better. Net change ≠ births; estimates ≠ headcounts;
change is size-sensitive, growth scale-neutral (both stated in UI).

## 5–8. Universes / ranking / benchmark / missing-data
Annual: year-valid; LFL = selected-year intersection. Periods: S&M&E
validity; LFL = three-endpoint intersection. DESC competition
(rank_i = 1+#{>}), full precision. Mean LOO, focus excluded, gap in basis
units. Strict completeness with reasons; no zero-fill/interpolation.

## 9. Groups
Dynamic income/region/lending; Developed NOT_SUPPORTED; group-first
ordering; non-member focus null.

## 10. Tests / regression
23 new tests green (incl. spec oracles +200M, +25%, +2.25%/yr, ties,
mean gap +1.28B, pp gap +8); full suite 528/529 (sole failure =
pre-existing refresh-auth env test, byte-identical); frontend lint 0
errors, build OK; all prior families green, paths untouched.

## 11. Specification checks
SP.POP.TOTL confirmed; stock enforced; 3 bases; CAGR secondary-only;
no cumulative/average/sequence contamination; endpoint logic; LFL
intersection; dynamic groups; DESC competition; full precision; mean
benchmark; focus excluded; gaps exact; missing≠zero; declines preserved;
N=1/N=2 correct (unit); oracles green.
