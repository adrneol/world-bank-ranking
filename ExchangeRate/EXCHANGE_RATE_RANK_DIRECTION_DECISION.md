# Exchange Rate Rank-Direction Decision (METHODOLOGY GATE — RESOLVED)
Status: FROZEN by methodology owner on 2026-09-26: DESCENDING.
Greatest nominal depreciation vs USD → rank 1. Neutral wording only
("Ranked by greatest nominal depreciation vs USD"). Median benchmark and
country−median gap are direction-independent and unaffected.
Rule: NO production ranking code may be written until the owner freezes one
direction below. This document records the search, the options, and the
recommendation. It invents nothing.

## Search performed (all negative for an explicit FX decision)
1. `ExchangeRate/exchangerate.txt:154-158` — explicitly permits BOTH
   orderings ("greatest appreciation → greatest depreciation, or vice
   versa"). Not a decision.
2. `backend/src/config.js:833` — `rankingDirection: 'NEUTRAL'` governs raw
   LEVELS only (Basis A, correctly unranked). Says nothing about changes.
3. Generic engines (`ranking.js`, `growthComparison.js`, yoy ranking) —
   default DESC is a cross-family default for GDP/flows, not an
   Exchange-Rate-specific frozen rule. Adopting it silently is exactly what
   the methodology gate forbids.
4. Tests (`phase5.test.js:250-268`) — assert polarity (+1.5% =
   depreciation) only, never rank order.
5. Frontend (`FxPanel`, movement labels) — "Annual movement"/"Period
   endpoint change" wording only, never rank order.

## Options
- (D) DESCENDING: greatest nominal depreciation → rank 1.
  For: continuity with every existing FX ordering in the app (YoY ranking
  DESC, growth movement DESC); spec's own competition illustration lists
  100/90/90/70 → 1/2/2/4 in descending form; median/gap math is
  direction-independent so either choice is safe.
- (A) ASCENDING: greatest nominal appreciation → rank 1.
  For: mirrors Prices' "lower-first" stability framing. Against: breaks
  continuity with current FX displays; appreciation-first is unusual for
  LCU-per-USD quoted series (IMF presents depreciation as the positive).

## Recommendation
(D) DESCENDING — greatest depreciation first — frozen with neutral
wording ("Ranked by greatest nominal depreciation vs USD", never "best/
strongest currency"). Median benchmark and country−median gap are
unaffected by this choice.

## Resolution required
Owner: freeze (D) or (A), or supply an alternative with source. On
resolution, encode in `domain/fxMovement.js`, registry metadata, tests,
frontend labels, and all four reports — then implement.
