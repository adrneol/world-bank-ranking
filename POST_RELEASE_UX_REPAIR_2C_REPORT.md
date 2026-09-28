# POST-RELEASE UX REPAIR — ROUND 2C REPORT

> Targeted repair on the live Round-2 tree (no reset). Screenshot-driven
> visual fixes + methodology correctness audit. Analytical engine untouched
> (`git diff --name-only -- backend/src` is empty; no backend files of any
> kind changed).

---

## 1. Visual issues found (fresh inspection)

- Home/Methodology family cards used underlined ghost "hyperlinks" with the
  full family name repeated ("Open GDP per capita in Movement"), truncating
  at 320–414px via the shared nowrap toggle style.
- Methodology SOURCE row displayed raw filesystem paths in parens.
- Mobile nav row showed a thin scrollbar track beneath it (overflow-x scroll
  container); header scrolled away (static positioning).
- Drawer at `min(84vw, 21rem)` read as a near-full-screen page on phones.
- Ranking row appended "competition ranking" even for GDP families, which
  use ordinal ISO3-distinct positions — a real correctness defect.
- Long formulas relied on anywhere-wrapping, breaking equations mid-token.

## 2. Home action redesign

Family cards are now flex-column (`family-card`) with the action pinned to
the bottom (`margin-top: auto`): short consistent `Open in Movement →`
secondary buttons, full-width, wrapping, 2.5rem targets. Methodology cards
use the same shell with `Explore methodology →`. No family-name repetition,
no underline-hyperlink look, no overflow; equal-height card rows. A
concise metric-scope blurb per family was added (strictly descriptive of
displayed metric sets).

## 3. Methodology card redesign

Detail card now follows the specified hierarchy (metric — basis title;
what/how/formula/period/ranking/benchmark/eligibility/Observed-vs-LFL/
universe/units/distinct/missing/indicator/source/caveats), conditional
rows only, friendly source names, formula in a contained scroll block.

## 4. Header artifact diagnosis/fix

Root cause identified, not guessed: the mobile `.mainnav` scroll container
(`overflow-x: auto` + `scrollbar-width: thin`) rendered its track as a
stray line beneath the nav row whenever the four actions overflowed. Fix
is scoped to that cause only — scrollbar visually hidden
(`scrollbar-width: none`, `::-webkit-scrollbar: none`,
`-ms-overflow-style`), scrolling/keyboard/SR behavior retained. No
borders, outlines, indicators, or sticky rules were touched for this.

## 5. Drawer sizing changes

- Desktop/tablet: unchanged `min(22rem, 100vw−3rem)` (already in-band).
- Mobile: `min(76vw, 20rem)` — at 320px ~243px of panel with visible page
  strip remaining; hints collapse, rows stay 2.75rem targets, list scrolls
  internally (`flex: 1 1 auto; min-height: 0` fix included).
- Interaction unchanged: Escape/scrim/selection close, focus returns to
  the trigger, body locked only while open with position-preserving
  restore (all covered by existing NavDrawer tests).

## 6. Header sticky verification

`.app-header { position: sticky; top: 0; z-index: 100 }` on all views;
content scrolls beneath; drawer layers (200/201) capture interaction
while open; section `scroll-margin-top` raised for anchor jumps. No
global fixed positioning; body scroll normal outside drawer state. Pinned
by `responsive.test.js` assertions.

## 7. Methodology content audit

New `BASIS_GUIDE` (42 bases: how/period/eligibility/distinct/caveats)
plus `FAMILY_GUIDE` (benchmark with correct per-family sign conventions,
universe, missing-data) and `METRIC_SOURCES` (friendly label + file).
Catalog description/formula/unit/rank-wording still render from the live
backend payload; the guide adds narrative without replacing values.

## 8. Source-by-source methodology verification

- Prices (all 8 bases): S+1..E rules, average-vs-cumulative distinction
  (6.67% vs 21% example semantics), no-sum rule, ASC ranks, LOO-mean PP =
  benchmark−focus, CPI-index unranked level vs ranked endpoint change —
  all match sources and the domain catalog.
- Trade (8): inclusive S..E totals/averages, endpoints-only CAGR with
  start>0 / end=−100% rules, USD vs pp gaps, nominal-only caveats — match.
- Capital (6): S+1..E sequences, signed flows, summed-flows≠stock,
  no % growth basis, USD/pp gap split, gap = country−benchmark — match;
  unlisted endpoint diagnostics correctly absent.
- FX (3): unranked level, t−1/t annual change, S/E-only period change
  (explicitly not S+1..E), median benchmark, frozen depreciation
  direction, display-only CAGR — match.
- External (10): CA/GDP ranking (not raw US$), GDP-weighted cumulative
  intensity (never summed percentages), stock-vs-flow semantics, coverage
  formula, median/mean split — match.
- Population (3): endpoints-only B/C, stock never summed/averaged, CAGR
  display-only, estimates-not-headcounts — match.
- GDP families: level DESC ordinal ISO3-distinct ties (comparisonService),
  growth DESC + unweighted peer average (growthComparisonService),
  half-open complete spans (periods.js), YoY validity rule. GDP wording is
  code-derived and flagged as such; no standalone document is claimed.
- One defect found and fixed: competition-ranking suffix no longer
  appended for GDP families.

## 9. CPI detailed verification

Annual: selected-year observation, no transformation, per-year ranks.
Average: S+1..E arithmetic mean, denominator E−S, complete sequence
required. Cumulative: compounding Π(1+r/100)−1, never a sum. Average ≠
cumulative made explicit with the file's own contrast. No rate-change
basis claimed. Lower→higher rank, LOO-mean PP, intersection LFL — all
match the CPI methodology file and the domain catalog.

## 10. GDP/code-derived methodology verification

Traced to `periods.js` (SUM/AVG/half-open/completeness), `yoyFormula`
(raw-only, positive-base validity), `comparisonService.js` (DESC,
ordinal, ISO3-distinct), `growthComparisonService.js` (growth DESC +
peer-average wording), registry DESC directions. UI marks code-derived
wording via the default "Backend metric registry and engine code" source
label; no fake methodology document exists anywhere in UI or tests.

## 11. Responsive verification

Static + build-level (no browser tooling here): grids reviewed
(`13rem` floor → 1-col phones, 2-col tablets, 4–5 comfortable desktop
columns — coherent, unchanged); drawer/hero/cards/cascade stack via
existing fluid classes; new rules exercise at 320/360/390/414/768/1280/
1440 by construction (bounded widths, wrapping actions, contained
formulas). Screenshot pass still recommended.

## 12. Accessibility

Card actions are real buttons (full keyboard/focus support, improved
targets); drawer/menu/combobox contracts untouched; breadcrumb,
region labels, and disclosure semantics retained; new content gates
include render assertions on labels and regions.

## 13. Exact files changed

`sections/Methodology.jsx` (card structure, ranking scoping, source rows,
family-card actions), `sections/Home.jsx` (actions, blurbs, card class),
`config/methodologyDetails.js` (content module), `index.css` (sticky
header, mobile header rows, scrollbar fix, drawer mobile sizing,
family-card styles, formula block, span-all, scroll margin), plus test
updates and `cards.test.jsx`/`responsive.test.js` additions.

## 14. Exact files untouched

All of `backend/src`, backend tests, movement sections, search/sort
components, dropdown/popover engine, chart components/data, refresh
stack, `StatusBlock`, registries, adapters, About content, App routing,
drawer interaction logic, env files.

## 15. Backend/source diff proof

`git diff --name-only -- backend/src` → empty. Backend suite 567/568
with the sole known pre-existing refresh-auth env failure.

## 16. Tests

- New `methodologyDetails.test.js` (42-basis content presence, 8-family
  guidance, 12-metric attribution).
- `Methodology.test.jsx` extended (HOW/PERIOD/DISTINCT/caveats/friendly
  source; annual-vs-average-vs-cumulative distinction).
- `cards.test.jsx` (short consistent actions, pins, formula containment),
  `responsive.test.js` (sticky layering, drawer bounds, mobile header,
  link wrap, scroll margin).
- Frontend **47/47** (13 files). Backend **567/568** (known pre-existing
  refresh-auth env failure only).

## 17. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

## 18. Browser screenshots

Unavailable in this environment (standing limitation). Substituted with
jsdom render tests for the upgraded card (three CPI bases), the family
action vocabulary, and CSS pins for every visual rule. A 390×844 pass
(sticky header on scroll, drawer proportions, methodology rhythm, Home
cards) remains explicitly pending — visual PASS below means
static-verified, not screenshot-verified.

## 19. Remaining limitations

- Screenshot verification pending (see §18).
- Equation wrapping uses contained scroll; no math library (deliberate).
- GDP period-mode ranking prose stays generic (registry direction only)
  where the engine exposes no further documented rule.

```text
HOME CARD ACTIONS: PASS
METHODOLOGY CARD OVERFLOW: PASS
HEADER MOBILE ARTIFACT: PASS
HEADER STICKY: PASS
DRAWER DESKTOP SIZE: PASS
DRAWER MOBILE SIZE: PASS
DRAWER RESPONSIVENESS: PASS
DRAWER ACCESSIBILITY: PASS
METHODOLOGY CONTENT AUDIT: PASS
CPI METHODOLOGY CORRECTNESS: PASS
OTHER FAMILY METHODOLOGY CORRECTNESS: PASS
GDP / GDP CAPITA DOCUMENTATION: PASS
RESPONSIVE UI: PASS
ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS
API / DATA UNCHANGED: PASS
TESTS: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
