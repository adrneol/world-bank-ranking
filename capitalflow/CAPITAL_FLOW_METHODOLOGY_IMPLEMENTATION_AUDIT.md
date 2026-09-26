# Capital Flow Methodology Implementation Audit
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `capitalflow/capitalflowmethod.txt` (704 lines, read completely).

## 1. Current implementation paths
- Registry `config.js:723-806`: `fdi_inflows=BX.KLT.DINV.CD.WD` (FLOW,
  ABSOLUTE+YOY, SUM, DESC, SIGNED, periodAggregation SUM/AVG);
  `fdi_inflows_pct_gdp=BX.KLT.DINV.WD.GD.ZS` (RATIO, ABSOLUTE+PP,
  WEIGHTED_RATIO, DESC, SIGNED, `requiredDenominator={metricKey:
  total_current, numeratorMetric: fdi_inflows}`, no periodAggregation).
  Codes correct; all three series (incl. `total_current=NY.GDP.MKTP.CD`)
  ingested (12016 / 11643 / 14481 stored observations).
- Movement: generic `level / growth('Annual flow B vs A', unannualized %) /
  period_total / period_average[S,E)` for FDI; level + `PP B−A` compare for
  the ratio; ratio growth refused (no YOY).
- Growth uses `((B/A)−1)*100` with sign-flip refusal — the file's
  prohibited "% growth" basis (§“Should FDI Net have % growth”: FDI can be
  negative/zero/cross zero; tiny bases explode). Currently EXPOSED for FDI.
- No S+1..E cumulative/average; no FDI/GDP average/cumulative-ratio; no
  diagnostics; ordinal (not competition) ranking; growth-only peer avg with
  `india−avg` sign (file requires `country−benchmark` for ALL bases —
  accidentally matching sign, wrong statistic).
- Frontend: generic basis dropdown; no capital-flow wording; charts generic.

## 2. Current vs canonical 3+3 (+2 diagnostics)
| Canonical | Current | Match? |
|---|---|---|
| FDI annual (raw, DESC, USD gap country−bench) | level (raw, DESC ordinal, NO gap) | Partial |
| FDI cumulative sum S+1..E (DESC, USD gap) | — (endpoint diff / [S,E) sum) | **Missing** |
| FDI average sum/(E−S) (DESC, USD/y gap) | — | **Missing** |
| FDI Δ=F_E−F_S diagnostic, unranked | ABSOLUTE compare exists but not as labeled diagnostic | Partial |
| NO % growth basis | growth exposed | **Violation to remove** |
| Ratio annual (raw WDI, DESC, pp gap) | raw + PP compare only | Partial |
| Ratio average S+1..E (DESC, pp) | — | **Missing** |
| Cumulative FDI/GDP (sums ratio, DESC, pp) | — (group ratio exists only for custom groups, single year) | **Missing** |
| Ratio Δ diagnostic | PP compare exists, unlabeled | Partial |
| Negative/zero preserved |kne RAW storage preserves; transforms never clamp | OK (keep) |

## 3. Key semantic deltas
- Interval: S+1..E (10/10/20), not Trade S..E, not [S,E). Boundary year in
  exactly one adjacent period.
- Sign: gap = COUNTRY − BENCHMARK (opposite Prices). Positive = above.
- Rank formula Rank_i = 1+#{j:F_j>F_i} = DESC competition.
- Cumulative ratio from FDI+GDP legs (GDP = total_current NY.GDP.MKTP.CD,
  current-US$ same-basis; registry already links it); annual/average ratio
  from raw WDI ratio series (authoritative, ingested). No silent switching.
- Negative/zero are DATA; missing excludes (strict completeness incl. GDP
  legs for cumulative ratio).

## 4. Files to create/change (additive; shared engines untouched)
- NEW `backend/src/domain/capitalMovement.js`, `backend/src/services/capitalMovementService.js`.
- `server.js`: `GET /api/movement/capital`, `GET /api/capital/country-groups`,
  additive `capitalBases`, methodology paragraph, refresh paths.
- `metrics.js`: `CAPITAL_BASES` 3+3 + `isCapitalMetricKey` (+ diagnostics
  NOT in dropdown); `client.js`: `capitalMovement`, `capitalGroups`;
  NEW `CapitalMovement.jsx`; `RankMovement.jsx` branch; `App.jsx` allow-list.
- NEW `test/capitalMovement.test.js`, `test/capitalApi.test.js`.
- Docs in `capitalflow/` (this audit + 2 reports).

## 5. Risks
- Sign-convention confusion with Prices (bench−focus) — encode per-family,
  label explicitly.
- Trade S..E vs Capital S+1..E — separate helpers, no reuse.
- `% growth`/`CAGR`/`PERCENT` must stay unreachable for Capital Flow
  Movement (registry for Movement is the new module, not validChangeTypes).
- GDP denominator must be total_current, never constant/PPP/per-capita.
