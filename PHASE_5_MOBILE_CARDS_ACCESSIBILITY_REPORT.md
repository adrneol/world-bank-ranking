# PHASE 5 — MOBILE MOVEMENT CARDS + ACCESSIBILITY HARDENING

> Scope: R-08 (mobile cards for six Phase-5 Movement families) and R-13
> (shared accessibility hardening). Presentation only. No methodology,
> ranking, benchmark, database, refresh, dropdown-placement, or chart-data
> changes.

---

## 1. Scope

- Generalize RankMovement's mobile-card pattern into one shared shell and
  adopt it in Prices, Trade, Capital Flow, Exchange Rate, External Sector,
  Population (common + outside lists each).
- Repair shared a11y defects: `Field` label association, `SubTabs`
  keyboard model, chart text equivalents for hover-only values.
- Regression-gate all of it; verify Phases 1–4 intact.

## 2. Current architecture

- RankMovement owned a private `MobileCardList` + private `useIsMobile`
  (40rem) + private `rankCell`; mobile branches in `EconomyTable`,
  `CommonTable`, and two growth tables. Six Phase-5 families rendered
  `table-scroll` tables at all widths (identical skeletons, family-local
  value formatters, `{focusName}` focus tags; RankMovement hardcodes
  IND/India).
- `Field` was `<label htmlFor>` wrapping arbitrary children (invalid once
  a SearchableSelect popover contributes its own filter input).
- `SubTabs` had roving tabindex but no arrow-key model (unlike `Tabs`).
- Chart values were hover-only in exactly three places: Compare
  trajectories, RankMovement 3-year focus bars, RankMovement annual
  period bars. All other charts already sit beside full tables/cards with
  the same backend values (verified per view, including movement
  observed/LFL bars whose focus/benchmark numbers appear in adjacent
  result cards, and SubjectInsight/Overview tables).

## 3. R-08 root cause

No shared mobile presentation existed outside RankMovement's private
shell, so the six families kept desktop-geometry tables on phones. Not a
data problem: the backend rows, ranks, and order were already correct.

## 4. Shared mobile-card architecture

New `frontend/src/components/MovementCards.jsx`:

- `EconomyMobileList({rows, rankOf, caption, focusIso='IND',
  focusName='India', renderSummary, renderDetails=null})` — byte-equivalent
  DOM/CSS to RankMovement's shell (`economy-cards/card`, head with rank +
  name + ISO3 + focus tag, `dl.facts` summary, Details disclosure, one-open
  accordion). `renderDetails` optional: lists without desktop expandable
  details (all outside sections) pass none and get no toggle.
- `CardField` (dt/dd display field), private `movementRankCell`
  (`#n`/em-dash, never renumbering).
- No new CSS: existing card classes reused, so the visual language is
  identical by construction.
- `useIsMobile` lives in `hooks/useMediaQuery.js` (40rem, shared with the
  stylesheet); RankMovement keeps its private hook untouched to avoid
  churning the 3.7k-line file, and now renders its four lists through the
  shared shell with defaults (output identical: IND/India).

## 5. Family-by-family adoption

Each family: `*CommonTable` + `*OutsideSection` branch on `isMobile`,
replacing only the `.table-scroll` div with cards over the same paginated
`slice`, keeping filters, footnotes, and `Pagination` shared:

| Family | Common summary | Common details | Outside summary | Value formatter reused |
|---|---|---|---|---|
| Prices | per-key rank/value + relation | shared `renderKeyDetails` | In-presence/rank/value/relation | `fmt`/`decimals` |
| Trade | same | shared renderer | same | `cellValue` |
| Capital Flow | same | shared renderer | same | `cellValue` |
| Exchange Rate | per-key rank/change% + relation | shared renderer | same (`Observed change %`) | `fmtSigned` |
| External Sector | same | shared renderer | same | `cellValue` |
| Population | same | shared renderer | same | `cellValue` |

`rankOf` is `(r) => r.refRank` (common) and `(r) => r.showRank`
(outside) — the exact desktop `#` values. Desktop details rows now call
the same `renderKeyDetails` as mobile disclosures (parity by
construction, not by review).

## 6. Desktop/mobile parity verification

- Same entities/order: cards map the same filtered/sorted/paginated
  `slice` (common) / `slice` (outside) arrays as the desktop `tbody`.
- Same rank/value/benchmark/gap: summary/detail expressions are the
  desktop cell expressions verbatim (same formatter functions, same
  null→`—` behavior, unit suffixes only where the desktop details show
  them).
- Same missing/null behavior: nulls render `—`, never zero; empty lists
  render `None.` with counts in the retained footnote.
- Focus highlighting: `focusIso`/`focusName` props; focus tag text matches
  each file's desktop tag.
- Static gate (`movementCards.test.js`, 8 tests) pins adoption,
  `refRank`/`showRank` parity, shared details renderer, and desktop
  preservation per family.

## 7. Common/Outside and Observed/LFL parity

- Common cards use like-for-like `perKey` ranks/values and the `refKey`
  relation — the desktop table's exact columns.
- Outside cards use observed `showRank`/`value`/`relation` plus `In {k}`
  presence from the same `obsByKey` lookups as the desktop `In` columns.
- No rank recomputation, no re-sorting, no membership changes, no
  Observed↔LFL transformation anywhere in the card layer.

## 8. R-13 accessibility changes

- **Field** (`ui.jsx`): `<label>` → neutral `div.field` + `span.field-label
  #${htmlFor}-label`; native input/select/textarea children with matching
  ids are cloned with `aria-labelledby` (props preserved, call sites
  untouched); component children keep their own accessible names. Class
  names unchanged, so styling is identical.
- **SearchableSelect**: contract preserved (verified by gate); Escape from
  the trigger (Phase 3) pinned against regression.
- **SubTabs** (`Tabs.jsx`): full Tabs keyboard model (ArrowLeft/Right,
  Home/End, roving refs/tabindex); selection, routing, styling, ARIA
  unchanged.
- **Charts**: new shared `ChartDataFallback` (details + table, existing
  `chart-data-fallback` pattern) inserted for Compare trajectories
  (slope + time-series), RankMovement 3-year focus bars, and RankMovement
  annual period bars — all using caller-preformatted backend values, zero
  new math. Overview history refactored onto it (identical text/classes).

## 9. Keyboard/accessibility verification

- Gate (`accessibilityGate.test.js`, 4 tests): Field structure/association,
  SearchableSelect roles/Escape/focus/portal preservation, SubTabs keys +
  semantics, fallback existence + adoption + layout-only behavior.
- Card toggles reuse the proven `aria-expanded`/`aria-controls` pattern;
  lists keep `role=list/listitem` with captions; tables keep `tabIndex`
  regions on desktop.

## 10. Chart accessibility approach

Text equivalents only where values were hover-exclusive (§2, three sites).
Everywhere else the audit concern was already answered by adjacent
tables/cards carrying the same backend numbers — documented, not
duplicated.

## 11. Data-integrity checks

- Grep + review: no new economic formulas, no frontend ranking/benchmark/
  gap computation, no hard-coded numbers, no analytical-value edits; mobile
  summaries call the desktop's own formatter functions on the desktop's
  own row objects.
- `git diff` contains no backend, methodology, ranking, refresh, chart-data,
  or dropdown-placement changes.

## 12. Tests

- New `backend/test/movementCards.test.js` (8 tests) and
  `backend/test/accessibilityGate.test.js` (4 tests): **12/12 pass**.
- No existing tests modified.

## 13. Full suite

- Backend: **567/568 pass**. Sole failure is the documented pre-existing
  environment-dependent `server.test.js:179` refresh-auth expectation
  (expects an open endpoint while local `.env` sets a token). Phase-4
  count was 555/556; +12 new, same single known failure.

## 14. lint/build

- Frontend `npm run lint`: **0 errors**, 3 warnings (identical pre-change
  baseline; new files add none).
- Frontend `npm run build`: **passes**.

## 15. Browser/screenshot verification

Not performed — no browser/screenshot tooling exists in this environment
(established Phase 1). Static verification instead: shared-shell DOM/CSS
identity with the proven RankMovement cards, per-family expression parity
review, gate tests, and the 320–414px reflow properties of the reused
card classes (`width/max-width 100%`, `min-width 0`, wrapping facts).
Recommend a 390×844 visual pass over one common + one outside list per
family when tooling is available. Desktop stability follows from
untouched desktop JSX (only wrapped in a width-conditional).

## 16. Files changed

```text
M frontend/src/sections/{Prices,Trade,CapitalFlow,Fx,ExternalSector,Population}Movement.jsx
M frontend/src/sections/RankMovement.jsx        (shared shell adoption only)
M frontend/src/sections/Compare.jsx             (trajectory fallbacks)
M frontend/src/sections/Overview.jsx            (fallback refactor onto shared)
M frontend/src/components/ui.jsx                (Field, ChartDataFallback)
M frontend/src/components/Tabs.jsx              (SubTabs keyboard)
M frontend/src/hooks/useMediaQuery.js           (useIsMobile)
?? frontend/src/components/MovementCards.jsx
?? backend/test/movementCards.test.js
?? backend/test/accessibilityGate.test.js
```

## 17. Files intentionally untouched

Backend in full; `controls.jsx`/`popover.js` + combo styles (Phase 3);
chart geometry/data (Phase 2); refresh/fingerprint/integrity (Phase 1);
`StatusBlock` contract (Phase 4); methodologies, registries, adapters,
formatters.

## 18. Remaining limitations

- Static (not screenshot) verification of card layouts — see §15.
- RankMovement retains its private `useIsMobile`/`rankCell`/`DetailField`
  (still used by its desktop tables); only the list shell was generalized.
- `Compare.jsx` `error={null}` + separate `CompareError` split left as-is
  (works; noted in Phase 4).
- Outside mobile cards omit expandable details (desktop has none) — full
  row data is in the summary + paginated footnote.

## 19. Final acceptance matrix

```text
R-08 MOBILE MOVEMENT CARDS: PASS
PRICES: PASS
TRADE: PASS
CAPITAL FLOW: PASS
EXCHANGE RATE: PASS
EXTERNAL SECTOR: PASS
POPULATION: PASS
TABLE/CARD DATA PARITY: PASS
R-13 FIELD LABELING: PASS
R-13 SEARCHABLESELECT: PASS
R-13 SUBTABS KEYBOARD: PASS
R-13 CHART ACCESSIBILITY: PASS
ACCESSIBILITY REGRESSION: PASS
ANALYTICAL DATA INTEGRITY: PASS
PHASE 1 REGRESSION: PASS
PHASE 2 REGRESSION: PASS
PHASE 3 REGRESSION: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
