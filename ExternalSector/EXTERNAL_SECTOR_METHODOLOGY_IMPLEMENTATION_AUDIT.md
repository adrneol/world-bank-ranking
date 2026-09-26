# External Sector Methodology Implementation Audit
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `ExternalSector/externalsector.txt` (813 lines, read completely).

## 1. Current implementation paths
- Registry (`config.js`): `current_account=BN.CAB.XOKA.CD` (FLOW/SIGNED,
  ABSOLUTE+YOY, SUM, DESC); `reserves_ex_gold=FI.RES.XGLD.CD`
  (FLOW-like handling today — see §3); `remittances_received=
  BX.TRF.PWKR.CD.DT` (FLOW, ABSOLUTE+YOY, SUM, DESC). NO GD.ZS ratio
  series exists in registry or DB — CA/GDP and intensity bases MUST derive
  from legs: CA + `total_current` (NY.GDP.MKTP.CD, current-US$), remittances
  + `total_current`, reserves + `imports_current` (NE.IMP.GNFS.CD). All
  present and ingested (CA 7808 / reserves 9491 / remittances 9497 /
  imports 11238 / total GDP 14481 obs).
- Movement today: generic `level / growth('Annual flow B vs A',
  unannualized %) / period_total+period_average[S,E)` for all three
  metrics (FLOW treatment, incl. reserves — a STOCK). No S+1..E bases, no
  CA/GDP or intensity ratios, no coverage, no endpoint-change basis,
  ordinal DESC ranks, growth-only peer mean (`india−avg`), single-year
  custom groups only.
- Frontend: generic basis dropdown; no external wording; generic charts.

## 2. Current vs canonical (CA 3 / reserves 3 / remittances 4)
| Canonical | Current | Match? |
|---|---|---|
| CA annual/average/cumulative CA/GDP (S+1..E legs, DESC, pp) | raw CA level + unannualized growth | **Missing** |
| Reserves annual stock (DESC, USD, size-only wording) | level (DESC ordinal, no gap) | Partial |
| Reserves endpoint % change S/E (DESC, pp) | unannualized growth (ordinal, mean peer) | Partial (wrong benchmark/wording) |
| Reserves coverage R/imports*12 months (DESC) | — | **Missing** |
| Remit annual/cumulative/average S+1..E (DESC, USD) | level + growth + [S,E) sums | Partial |
| Remit cumulative intensity ΣR/ΣGDP (DESC, pp) | — (single-year group ratio only) | **Missing** |
| No % growth / no summed percentages / no summed reserves / ex-gold only | growth exposed for CA/remit; sums possible via generic periods | **Violations to remove** |

## 3. Key semantic deltas
- Stock vs flow: reserves NEVER summed; endpoint S/E change; coverage is
  ANNUAL (R_t/Imports_t×12) — no period-average coverage (spec mentions it
  only conditionally; not canonical → not implemented).
- CA/GDP derived from CA+GDP legs (no GD.ZS in project); cumulative =
  ΣCA/ΣGDP (GDP-weighted), average = mean of annual ratios (equal-weighted).
- Remittance intensity = ΣRemit/ΣGDP; never summed percentages.
- Negative/zero CA valid; missing excludes (strict, incl. denominator legs).
- Gap = country − benchmark (matches Capital sign; opposite Prices).
- Ranking DESC everywhere ("higher numerical value → rank 1"), competition,
  full precision. No welfare/adequacy/dependency language.

## 4. Benchmark gate — STOPPED (see below)
Spec: LOO benchmark; mean default; median allowed for highly skewed
raw-value/change bases "where appropriate" (remittance-US$ example);
per-basis registry specification required; never silent switching. Repo
search: NO frozen per-basis External rule exists (median exists only in
FX, frozen by FX spec; Prices/Trade/Capital use mean). Live skew check:
reserves stock mean $74.3B vs median $6.2B (12×); remittances mean $5.4B
vs median $1.1B (5×); CA/GDP mean −1.19 vs median −1.23 (well-behaved).
Implementation of ranking/benchmark code is STOPPED until the owner
freezes per-basis mean/median (recommendation in gate file).

## 5. Files to create/change (after freeze; additive; shared untouched)
- NEW `backend/src/domain/externalMovement.js`, `backend/src/services/externalMovementService.js`.
- `server.js`: `GET /api/movement/external`, `GET /api/external/country-groups`,
  additive `externalBases`, methodology paragraph, refresh paths.
- `metrics.js`: `EXTERNAL_BASES` (3/3/4) + `isExternalMetricKey`;
  `client.js` transport; NEW `ExternalMovement.jsx`; `RankMovement.jsx`
  branch; `App.jsx` allow-list.
- NEW `test/externalMovement.test.js`, `test/externalApi.test.js`.
- Docs in `ExternalSector/` (this audit + 3 reports).
