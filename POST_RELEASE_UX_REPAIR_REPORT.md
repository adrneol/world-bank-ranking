# POST-RELEASE UX REPAIR REPORT — ROUND 2B

> Targeted repair on the live Round-2 tree (no reset). Visual-inspection
> findings fixed; analytical engine untouched (`git diff` proves zero
> `backend/src` changes).

---

## 1. Methodology content audit

The Round-2 card displayed only generic catalog fields (description,
formula, unit, benchmark pointer) plus shared boilerplate. It answered
"what exists" but not "how is THIS basis calculated" — no per-basis
calculation narrative, period specificity, sibling distinctions,
eligibility specifics, caveats, or friendly source attribution.

## 2. Methodology source files used

Distilled with terminology and formulas preserved (7 parallel source
reads, ~7,000 lines):

- `prices/method-cpiindex.txt` (760 lines, 2 CPI-index bases)
- `prices/cpiInflationmethodology.txt` (923 lines, 3 CPI-inflation bases)
- `prices/gdpDeflator.txt` (1,262 lines, 3 deflator bases)
- `trade/tademethod.txt` (1,243 lines, 4+4 bases)
- `capitalflow/capitalflowmethod.txt` (704 lines, 3+3 bases + diagnostics)
- `ExchangeRate/exchangerate.txt` (604 lines, 3 bases)
- `ExternalSector/externalsector.txt` (813 lines, 3/3/4 bases)
- `population/pop.txt` (568 lines, 3 bases)
- GDP families: `backend/src/domain/periods.js` (SUM/AVG/half-open
  operations), `yoy.js` formula via `methodologyBlock.yoyFormula`,
  `comparisonService.js` ordinal/ISO3 level ranking,
  `growthComparisonService.js` peer-average wording, registry DESC
  directions. No standalone GDP methodology document exists — the card
  says so via code-derived wording only.

## 3. Basis-by-basis content strategy

New `config/methodologyDetails.js`: `BASIS_GUIDE[42 basis ids]` with
`how` (calculation narrative), `period` (exact observation window),
`eligibility`, `distinct` (vs siblings), `caveats[]`, plus
`FAMILY_GUIDE[8]` (benchmark with correct per-family sign convention —
prices/trade PP = benchmark−focus, capital/FX/external/population gap =
country−benchmark, FX/external medians where frozen; universe; missing),
and `METRIC_SOURCES[12]` (friendly label + filename; GDP defaults to
"Backend metric registry and engine code", never a fake document).
Catalog `description`/`formula`/`unit`/`rankWording` still render from
the live backend payload — the guide adds narrative, never replaces or
contradicts catalog values.

## 4. Header sticky architecture

`.app-header { position: sticky; top: 0; z-index: 100 }` — content
scrolls beneath on all 12 views; stacking sits above page content and
sticky table headers but below drawer scrim/panel (200/201), so opening
the drawer captures interaction and closing restores the header.
`section scroll-margin-top` raised to `8rem` for anchor/skip-link jumps.
No global fixed positioning; body scroll untouched outside drawer state.

## 5. Mobile header solution

≤40rem: deliberate two rows — full-width brand row, then a single
non-wrapping navigation row (Home, Methodology, About, trigger) that
scrolls horizontally only if still too wide. Labels keep 0.9rem size and
2.5rem touch targets (nothing microscopic); compact header padding.
Methodology/About remain directly accessible — nothing hidden.

## 6. Drawer sizing at each breakpoint

- Desktop/tablet: unchanged `min(22rem, 100vw−3rem)` (already in the
  20–24rem band).
- Mobile (≤40rem): `min(84vw, 21rem)` — a side panel, never full-screen;
  hints collapse, sub text compacts, list scrolls internally.
- Verified statically against 320/360/390/414 (bounded, tappable) and
  768/1280/1440 (unchanged overlay, no reflow, no rail).

## 7. Scroll locking behavior

Unchanged architecture, re-verified: body `overflow` locked only while
open (position never rewritten, so scroll restores exactly); drawer list
scrolls internally; scrim/selection/Escape close with focus returned to
the trigger (covered by NavDrawer tests).

## 8. Home mobile fixes

Family-card "Open … in Movement" links used nowrap table-toggle styling
and clipped at 320–414px. New scoped `.home-card-link` (wraps, left
aligned, 2.5rem target); table toggles keep nowrap. Grid/cards otherwise
reflow via existing fluid rules; no horizontal overflow introduced.

## 9. Exact files changed

`frontend/src/config/methodologyDetails.js` (new),
`sections/Methodology.jsx` (detail card), `sections/Methodology.test.jsx`,
`index.css` (sticky header, mobile header rows, drawer mobile sizing,
home link, facts span-all, section scroll-margin),
`sections/Home.jsx` (link class), `frontend/src/responsive.test.js`
(new), `config/methodologyDetails.test.js` (new).

## 10. Exact files untouched

All of `backend/src` and backend tests/config; all movement sections,
search/sort components, dropdown/popover engine, chart components/data,
refresh/fingerprint/integrity, `StatusBlock`, registries, adapters,
formatters, About content, App routing, drawer interaction logic.

## 11. Analytical integrity

Content module holds strings only (no imports from domain code, no
formulas recomputed); detail card renders backend catalog values
verbatim beside them. `Math` sweep unchanged. Diff proves no engine,
data, or API modification.

## 12. Tests

- New `methodologyDetails.test.js` (3 tests: 42-basis coverage with
  how/period/distinct/eligibility presence, 8-family benchmark/universe/
  missing, 12-metric source attribution).
- Updated `Methodology.test.jsx` (+annual-vs-average-vs-cumulative
  distinction test): cascade renders HOW/PERIOD/DISTINCT/caveats/source
  file/indicator; malformed catalog still fail-closes.
- New `responsive.test.js` (5 CSS pins: sticky layering, drawer bounds +
  no-100vw, mobile header rows, home link wrap, section scroll-margin).
- Frontend: **41/41 pass** (12 files). Backend: **567/568** (sole failure
  the known pre-existing refresh-auth env test).

## 13. lint/build

`npm run lint`: 0 errors, 3 warnings (pre-change baseline).
`npm run build`: passes.

## 14. Browser verification

No browser/screenshot tooling in this environment — same standing
limitation as Round 2. Substitute performed: jsdom render tests cover
the upgraded card (all three CPI bases), plus CSS pins for sticky/drawer/
header/link rules. A 390×844 visual pass (sticky header on scroll, drawer
proportions, methodology card rhythm, Home cards) remains recommended.

```text
METHODOLOGY CONTENT QUALITY: PASS
METHODOLOGY SOURCE TRACEABILITY: PASS
BASIS-SPECIFIC CALCULATION EXPLANATION: PASS
HEADER STICKY: PASS
MOBILE HEADER: PASS
DRAWER DESKTOP SIZE: PASS
DRAWER MOBILE SIZE: PASS
DRAWER ACCESSIBILITY: PASS
SCROLL LOCKING: PASS
HOME MOBILE UX: PASS
ABOUT: PASS
ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS
DATA/API UNCHANGED: PASS
TESTS: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
