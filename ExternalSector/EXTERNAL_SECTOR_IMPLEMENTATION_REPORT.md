# External Sector Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `ExternalSector/externalsector.txt` (untouched). GDP/Prices/
Trade/Capital/FX used as architectural reference only — no formula copied.

## 1. Files changed / created
- NEW `backend/src/domain/externalMovement.js` — 10 bases (3/3/4), S+1..E
  sequences, endpoint-only reserve change, DESC competition, per-basis
  frozen mean/median LOO, country−benchmark gaps.
- NEW `backend/src/services/externalMovementService.js` — leg-based
  orchestration (CA+GDP, reserves+imports, remit+GDP), Observed/LFL,
  USD/pp/months displays.
- `backend/src/server.js` — `GET /api/movement/external`,
  `GET /api/external/country-groups`, additive `externalBases`,
  methodology paragraph, refresh paths. No existing route touched.
- `frontend/src/config/metrics.js` — `EXTERNAL_BASES` 3/3/4 +
  `isExternalMetricKey`; `client.js` — `externalMovement`,
  `externalGroups`; NEW `ExternalMovement.jsx`; `RankMovement.jsx`
  branch; `App.jsx` allow-list + 10 IDs.
- NEW `test/externalMovement.test.js` (17), `test/externalApi.test.js` (13).
- Docs in `ExternalSector/` (audit, benchmark decision, final
  verification, rank gate, this report).

## 2. Before → after
Before: generic level + prohibited unannualized growth + unranked `[S,E)`
sums for all three metrics (reserves treated as a flow). After: canonical
3/3/4 bases with DESC competition ranks, frozen per-basis mean/median
benchmarks, country−benchmark gaps in basis units, S+1..E flow sequences,
endpoints-only reserve change, annual coverage, no % growth basis.

## 3. Bases and legs
CA (`BN.CAB.XOKA.CD` + `total_current` NY.GDP.MKTP.CD legs; no GD.ZS in
project): annual/average/cumulative CA/GDP, pp gaps, MEAN benchmark.
Reserves (`FI.RES.XGLD.CD`, ex-gold only): annual stock (USD, size-only,
MEDIAN); endpoint % change S/E (pp, MEDIAN, valuation caveat); annual
coverage R/imports×12 with `imports_current` (months, MEAN).
Remittances (`BX.TRF.PWKR.CD.DT`): annual/cumulative/average S+1..E (USD,
MEDIAN); cumulative intensity ΣRemit/ΣGDP (pp, MEAN). Never summed
percentages; reserves never summed; raw CA never performance-ranked.

## 4. Benchmark freeze applied
SPLIT (owner-frozen, recorded): median for reserves stock/change and
remittance annual/cumulative/average (live 12×/5× skew + spec example);
mean for CA×3, intensity, coverage. Encoded per basis, tested, exposed in
API (`benchmarkType`), labeled in UI ("Peer median" vs "Other-economy
average").

## 5–8. Universes / ranking / benchmark / missing-data
Annual: year-valid legs; LFL = selected-year intersection. Flow periods:
complete S+1..E legs (both legs for derived); LFL = complete 2005..2024
legs. Reserve change: S&M&E validity. DESC competition, full precision.
LOO, focus excluded, gap in basis units. Strict completeness with reasons;
missing ≠ zero; negative/zero are data.

## 9. Groups
Dynamic income/region/lending; Developed NOT_SUPPORTED; group-first
ordering; non-member focus null.

## 10. Bug found by tests during implementation
Cumulative-share numerator initially read the ratio series (≈1e-10);
fixed to separate FDI legs before UI work (Capital precedent applied
proactively here — legs separated from the start; oracles confirm).

## 11. Tests / regression
30 new tests green (incl. spec oracles −0.2%, 1.27%, +50%/−20%, 6/2
months, 66, 10%, ties, freeze); full suite 505/506 (sole failure =
pre-existing refresh-auth env test, byte-identical); frontend lint 0
errors, build OK; all prior families green, paths untouched.

## 12. Specification checks
GD.ZS absent → derived legs documented; raw-ratio vs derived fixed per
basis; negatives preserved; diagnostics n/a (External has none — all 10
bases ranked); annual vs period LFL distinct; sign country−benchmark;
vintage groups documented.
