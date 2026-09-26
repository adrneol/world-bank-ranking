# Exchange Rate Methodology Implementation Audit
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `ExchangeRate/exchangerate.txt` (604 lines, read completely).

## 1. Current implementation (audited, not yet changed)
- Registry `config.js:814-852`: `fx_official=PA.NUS.FCRF` (correct code,
  ingested: 12,630 obs, 1960–2025; IND 2004=45.316, 2014=61.030,
  2024=83.669). `QUOTED_RATE` + `LCU_PER_USD`, `NEUTRAL` (levels unranked —
  matches Basis A), `YOY` declared, no periodAggregation.
- Movement today: generic `level` (raw, correctly refused rank) +
  `growth` via `mode=yoy` (unannualized endpoint %, DESC ordinal rank,
  exclude-India peer mean) + refused period totals. No S+1..E / S..E
  contamination (endpoint pairs only) — but also: no CAGR display, no
  median benchmark, no LFL median logic, ordinal (not competition) rank,
  generic "Period endpoint change" wording, no nominal/bilateral/USD
  caveats in Movement.
- `/api/compare`: absolute_change, yoy, cross_rate legs (kept as-is).
- FxPanel (`SubjectInsight.jsx:211-289`): levels + YoY table + time series,
  correct "Raw levels are never ranked" + rise/fall wording. Basis-A
  presentation already exists here; Movement branch does not.
- Tests: phase5 FX movement semantics (polarity only, no rank order).

## 2. Gaps vs canonical 3 bases (A level unranked; B annual change; C period change)
| Canonical | Current | Match? |
|---|---|---|
| A: raw level, NO rank/benchmark/gap | level unranked, no benchmark | YES (keep) |
| B: (t/t−1−1)*100, t−1&t eligibility, ranked, LOO median, gap=country−median pp | YoY exists but DESC-ordinal rank, mean peer, no LFL-median | Partial |
| C: (E/S−1)*100 endpoints-only, ranked, LOO median, CAGR display-only | unannualized growth, ordinal, mean, no CAGR | Partial |
| LFL: endpoint intersections (incl. t−1/t pairs for annual) | level/growth LFL exists via generic engines | Partial (median missing) |
| Median (not mean) benchmark, "Median eligible-economy FX change" | mean peer avg | **Missing** |
| Continuity policy, nominal/bilateral/USD disclosure | absent in Movement | **Missing** |

## 3. Files to create/change (additive; shared engines untouched)
- NEW `backend/src/domain/fxMovement.js`, `backend/src/services/fxMovementService.js`.
- `server.js`: `GET /api/movement/fx`, `GET /api/fx/country-groups`,
  additive `fxBases`, methodology paragraph, refresh paths.
- `metrics.js`: `FX_BASES` 3 + `isFxMetricKey`; `client.js` transport;
  NEW `FxMovement.jsx`; `RankMovement.jsx` branch; `App.jsx` allow-list.
- NEW `test/fxMovement.test.js`, `test/fxApi.test.js`.
- Docs in `ExchangeRate/` (this audit + 3 reports).

## 4. Methodology gate (Phase 1)
- Indicator: PA.NUS.FCRF confirmed (registry + DB). No substitution.
- Rank direction: NO explicit frozen decision exists anywhere (spec
  §"greatest appreciation → greatest depreciation, or vice versa";
  registry NEUTRAL covers levels only; generic DESC is a cross-family
  default, not an FX decision; tests assert polarity only). See
  `EXCHANGE_RATE_RANK_DIRECTION_DECISION.md` — implementation of ranking
  is STOPPED until the direction is frozen by the methodology owner.
- Continuity: no authoritative redenomination metadata in project storage
  (schema has vintage `lastupdated` only); policy = calculate from stored
  WDI values, no detector, documented caveat (no fabrication).
- All other rules are executable as specified (endpoint-only changes,
  t−1/t and S/E eligibility, LFL intersections, LOO median, pp gaps,
  competition ranking once direction is frozen, group-first ordering).
