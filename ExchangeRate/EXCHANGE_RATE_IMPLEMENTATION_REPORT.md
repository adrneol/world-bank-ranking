# Exchange Rate Implementation Report
Branch: `methodology-redesign` | Date: 2026-09-26
Authority: `ExchangeRate/exchangerate.txt` (untouched). GDP/Prices/Trade/
Capital used as architectural reference only — no formula copied.

## 1. Files changed / created
- NEW `backend/src/domain/fxMovement.js` — 3 bases, endpoint-only changes,
  DESC competition (frozen direction), LOO median, country−median pp gaps.
- NEW `backend/src/services/fxMovementService.js` — t−1/t and S/E validity,
  LFL intersections, group-first ordering, no benchmark for Basis A.
- `backend/src/server.js` — `GET /api/movement/fx`,
  `GET /api/fx/country-groups`, additive `fxBases`, methodology paragraph,
  refresh paths. No existing route touched.
- `frontend/src/config/metrics.js` — `FX_BASES` 3 + `isFxMetricKey`;
  `client.js` — `fxMovement`, `fxGroups`; NEW `FxMovement.jsx`;
  `RankMovement.jsx` branch; `App.jsx` allow-list + 3 IDs.
- NEW `test/fxMovement.test.js` (15), `test/fxApi.test.js` (11).
- Docs in `ExchangeRate/` (audit, rank-direction decision, final
  verification, rank gate, this report).

## 2. Methodology gate outcome
The spec permits both rank orders; no frozen direction existed anywhere
(registry NEUTRAL covers levels only; generic DESC is a cross-family
default; tests assert polarity only). Implementation of ranking was
STOPPED per the gate rule; the owner froze DESCENDING (greatest nominal
depreciation → rank 1), recorded in
`EXCHANGE_RATE_RANK_DIRECTION_DECISION.md` with the full search trail.
Median/gap math is direction-independent.

## 3. Bases
`fx_official` (PA.NUS.FCRF, 12,630 obs, 1960–2025): A raw LCU/US$ level
(never ranked/benchmarked/gapped); B annual change t−1/t; C period change
S/E endpoints-only with display-only CAGR. Each metric exposes only its 3.

## 4. Key semantics
Positive % = depreciation, negative = appreciation (LCU-per-US$).
Median (never mean) LOO benchmark — live median is 0 (pegged currencies)
vs mean 106.44 for 2004→2014, validating the choice. Gap = country −
median (pp). Continuity: no project redenomination metadata exists; values
calculated as published with documented caveat; no fabricated detector.
Nominal official bilateral vs USD only (18-point disclosure in UI).

## 5–8. Universes / ranking / benchmark / missing-data
Annual: t−1&t valid; LFL = pair-intersections. Period: S&E valid;
LFL = S&M&E intersection. DESC competition, full precision. Strict
completeness with reasons; missing ≠ zero; no division by zero.
Groups: dynamic income/region/lending, Developed NOT_SUPPORTED,
group-first, non-member focus null.

## 9. Bug found by verification
Benchmarks of exactly 0.0 in several sections investigated and proven
correct (genuine zero-median from pegged-currency clusters), not a defect.

## 10. Tests / regression
26 new tests green (incl. denomination invariance 45→61 ≡ 4.5→6.1,
median-vs-mean synthetic, N=1/N=2 universes); full suite 475/476 (sole
failure = pre-existing refresh-auth env test, byte-identical); frontend
lint 0 errors, build OK; GDP/GDP-per-capita/Prices/Trade/Capital suites
green, paths untouched.
