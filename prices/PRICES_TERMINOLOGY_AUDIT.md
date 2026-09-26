# Prices Terminology Audit (presentation/wording only)
Branch: `methodology-redesign` | Date: 2026-09-26 | File audited:
`frontend/src/sections/PricesMovement.jsx` (every heading, card label,
chart title/legend, explanation, methodology note, empty state, table
column, filter label, placeholder). No backend file modified in this pass.

## Terminology audit table

| # | Current wording | Proposed wording (applied) | Reason | Affected basis | Example |
|---|---|---|---|---|---|
| 1 | "Economies ranked" (universe statBox, incl. missing-focus branch) | "Eligible economies" | The number is `eligibleCount`: economies satisfying the basis-specific data requirements (the comparison universe), not the narrower "actually receiving a rank" concept | All period + rankable annual sections | Eligible economies — 177 |
| 2a | "Required annual observations: 2004…2014 (2)" on CPI period change | "Required endpoint observations: 2004, 2014 (2)" | CPI change uses endpoints only (`requiredYears=[S,E]`); "annual observations" falsely implies a sequence | `cpi_index_period_change` (2014→2024, 2004→2024 likewise) | Required endpoint observations: 2014, 2024 (2) |
| 2b | "Required annual observations: …" on average/cumulative | Kept, standardized to `2005–2014 (10)` form | These bases genuinely consume the S+1…E annual sequence | Inflation/deflator average + cumulative | Required annual observations: 2005–2014 (10) |
| 3 | PP value with interpretation as a separate following sentence | Interpretation attached in the same PP line: "−37.92 percentage points (higher than the other-economy average)" | Visually connects result to meaning; sign logic unchanged (PP = average − focus; negative = focus higher) | All rankable bases (cards + glance) | −37.92 percentage points (higher than the other-economy average) |
| 4 | Section heading "Period results — Observed and Like-for-like" on annual bases | Basis-aware: annual → "Selected-year results — Observed and Like-for-like" (period bases unchanged) | Annual bases are year-specific snapshots, not period-growth analyses | `cpi_index_annual`, `cpi_inflation_annual`, `deflator_annual` | Selected-year results |
| 5 | Generic " focus" focus-tag in common table | Dynamic focus-country name in tag | "Focus" is internal terminology; tag now matches GDP style (name in tag) | Common table | " India" tag for IND |
| 6 | "Other-economy average" | Kept (already precise) + peer count now always suffixed with economy/economies | Confirms leave-one-out mean (177 eligible incl. focus → 176 others); no world/global language anywhere in Prices UI (verified by search) | All rankable bases | 82.94% · 176 economies |
| 7 | "Ranked by lower …" | Kept verbatim from backend `rankWording` (basis-specific per canonical file) | Wording describes the actual basis; never generic "growth" | All rankable bases | Ranked by lower cumulative consumer-price increase |
| 8a | Missing-focus statBox "… value" | "`[Country]`'s {basis label}" (e.g. "India's period CPI change") | Metric-specific precision without clutter; dynamic per country | All bases, missing-focus branch | India's average annual CPI inflation — n/a |
| 8b | Common-table "{k} value" column headers | Kept deliberately | Space-constrained; basis context is in the section title and per-row details show the unit. Precision-without-clutter trade-off documented here | Common table | 2004→2014 value (details: unit shown) |
| 9 | Observed / Like-for-like / Common / Outside explanations | Kept (already exact); partition labels use period/year keys from backend (`2004→2014 observed set`) | Concepts never mixed; outside never called entered/exited/new/left | All | 177 = 166 + 11 |
| 10 | "What changed outside the common comparison set?" + "missing … at least one other required comparison" | Kept | Matches GDP pattern while stating the data-eligibility reason, no economic-event implication | Partition section | — |
| 11 | Period formatting | Already uniformly `2004→2014` (backend keys rendered verbatim; required-lines use `–` only inside year spans) | Consistent; matches GDP arrow style | All | 2004→2014 |
| 12 | CPI-annual universe/rank language | "Eligible economies" count kept (accurately: economies with valid CPI data that year); rank shows "n/a (no rank for this basis)" + rankNote footnote; no `#X/N` ever rendered for raw index | Describes why the count exists without implying a ranking occurred | `cpi_index_annual` | Eligible economies — 177; rank n/a |
| 13 | Search placeholder "e.g. India, IND, or #12" | Dynamic: "e.g. {focusName}, {focusIso}, or #12" | No hardcoded country in UX chrome | Common + outside tables | e.g. Japan, JPN, or #12 |
| 14 | Value display "63.4 index points (2010 = 100)" | "63.4 index points" (new `displayUnit` strips the repeated qualifier for `cpi_index_annual` only) | Final cleanup as instructed: value-only display. Backend metadata, metric label, methodology, and calculations untouched | `cpi_index_annual` cards, tables, charts | 2004 — 63.4 index points |

Deliberately unchanged: backend `rankWording` strings (canonical), "World Bank WDI" source labels (true source), "Derived comparison positions — not World Bank ranks" (true), "Observed"/"Like-for-like" terms (canonical), methodology indicator line `FP.CPI.TOTL — …` (identifier, not a value display).

## Confirmation of no analytical change
- Backend: zero files modified in this pass (`git status`: only frontend + this report).
- Live-API oracle re-run: CPI change 120.86252714248134 (#141/177, bench 82.94449798093909, PP −37.91802916154225); inflation avg 8.271108373486545; cumulative 120.86252714248111; all Ns/ranks/benchmarks/PPs identical to baseline (diffs 0); invalid/legacy/fake-group requests still 400.
- Tests: backend Prices 37/37 green; frontend `npm run lint` 0 errors (3 pre-existing warnings); `npm run build` succeeds.

METHODOLOGY CHANGED: NO

ANALYTICAL VALUES CHANGED: NO

RANKS CHANGED: NO

UNIVERSES CHANGED: NO

BENCHMARKS CHANGED: NO

PP VALUES CHANGED: NO

TERMINOLOGY AUDIT COMPLETE: YES
