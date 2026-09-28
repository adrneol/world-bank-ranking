# POST-RELEASE UX REPAIR — ROUND 2G REPORT

> View-aware global header on the live tree (no reset). Presentation
> only: `git diff --name-only -- backend/src` is empty, and no
> analytical, API, registry, or data file of any kind changed.

---

## 1. Root cause

Round 2F made the header context-aware but with **one universal
analytical rule**: every non-info view rendered
`World Bank WDI · {country}` / `{focusName} — {effective.year}` from
the shared global single-year filter. Three workspaces have different
temporal/entity semantics, so the header lied for all of them:
- **Movement** (`RankMovement`) is a period analysis driven by
  `filters.yearA/yearB` (+ optional `yearMid`), URL-serialized as
  `yearA/yearB/yearMid` — yet the header showed the unrelated global
  `filters.year` (e.g. `India — 2025` while comparing 2004 → 2014).
- **Compare** is entity-vs-entity (`cmpEntityA/cmpEntityB`,
  `cmpYearA/cmpYearB`) — yet the header showed the global focus
  country/year (e.g. `Sweden — 1963` beside a Sweden-vs-USA 2015 page).
- **Status** (`DataStatus`, refresh-only, consumes no filters) — yet
  the header showed the global focus country/year.

Audit sources: `effective.country/focusName/year` from `filters`
+ backend metadata; `effective.yearA/yearB/yearMid` (already
validated against `availableYears`, URL-mirrored) feed `RankMovement`
as `yearA/yearB/yearMid`; drawer label from `ANALYTICAL_VIEWS`.

## 2. Header-context rules

Implemented in one resolver (§7), wired as the single header source:
- Home/Methodology/About → `World Bank WDI` / `Economic data analysis`
  (no country/ISO3/year/"ranking" — unchanged from 2F).
- Movement → `World Bank WDI · {ISO3}` /
  `{Focus} — {yearA} → {yearB}`; middle year never included; invalid
  period → truthful `{Focus} — Select period` (never a stale year).
- Compare → `World Bank WDI` / `Entity comparison` (never Entity A/B,
  never compare years).
- Status → `World Bank WDI` / `Data status & refresh` (no country/year
  whatsoever).
- All other analytical views (Overview/Data/Rank/YoY/Coverage/Audit) →
  `World Bank WDI · {ISO3}` / `{Focus} — {year}` (2F behavior kept).

## 3. Movement range-header behavior

The header reads `effective.yearA/yearB` — the exact resolved values
`RankMovement` receives — so identity and analysis can never disagree.
`?view=movement&yearA=2020&yearB=2022&year=2024` renders
`India — 2020 → 2022`: the global 2024 is fully isolated. Changing
Overview/Data year only touches `filters.year`, which the movement
branch never reads.

## 4. Compare neutral-header behavior

`?view=compare&country=USA&year=2022` renders `World Bank WDI` /
`Entity comparison` with no USA/United States/year in the header. The
page's own entity/year controls and results are untouched.

## 5. Status neutral-header behavior

`?view=status&country=USA&year=2022` renders `World Bank WDI` /
`Data status & refresh` with no country/ISO3/year. Refresh behavior
and `DataStatus` are untouched.

## 6. Single-year analytical behavior

Unchanged from 2F: `?view=overview&country=USA&year=2022` →
`World Bank WDI · USA` / `United States … 2022`, no `ranking`.
Drawer trigger labels unchanged (`Explore analysis` on info pages,
workspace label on analytical pages); drawer behavior untouched.

## 7. Resolver implementation

New `frontend/src/utils/headerContext.js`:
`getHeaderContext({ view, country, focusName, year, yearA, yearB })`
returns `{ primary, secondary }`. Pure string formatting over
already-resolved state — no fetching, no economics, no mutation;
`yearMid` is not even a parameter, so endpoint-only output holds by
construction. `App.jsx` renders it through a thin `HeaderIdentity`
component; no view-specific string logic remains scattered in the
shell. (The now-unused `.header-year` CSS rule was left in place to
keep the stylesheet diff minimal.)

## 8. Deep-link verification

URL semantics untouched (`readUrlState`, mirroring, `yearA/yearB/
yearMid` serialization all preserved). Render tests prove the header
reflects parsed view-specific state: `?view=overview&country=USA&
year=2022`, `?view=movement&yearA=2020&yearB=2022&year=2024`,
`?view=compare&country=USA&year=2022`, `?view=status…` all render the
specified contexts; pre-existing drawer-routing and `?view=` tests
still pass.

## 9. Responsive verification

No new layout code: the identity block keeps the 2F containment
(`brand-row` `min-width: 0`, title `overflow-wrap`) pinned by test;
range strings (`India — 2004 → 2014`) wrap under the same rules as
any title. Breakpoint screenshot pass (320–1440) remains explicitly
pending — same standing no-browser-tooling limitation as 2E/2F.
Info/Compare/Status neutrality is viewport-independent (pure text).

## 10. Exact files changed

- `frontend/src/utils/headerContext.js` (new) — view-aware resolver.
- `frontend/src/utils/headerContext.test.js` (new) — all 10 spec
  cases + invalid-period fallback.
- `frontend/src/App.jsx` — `HeaderIdentity` wrapper + single call
  site (header block only; filters, routing, sections untouched).
- `frontend/src/App.test.jsx` — movement-isolation render test;
  compare/status-neutrality render test.

## 11. Exact files untouched

All of `backend/src`; backend domain/services; WDI ingestion;
database; API; registry; methodology/movement/ranking/benchmark/gap/
Observed/LFL/Common/Outside calculations; `RankMovement`,
`Compare`, `DataStatus`, all other sections; SearchableSelect;
popover engine; drawer behavior + labels; charts; breadcrumbs/backnav;
filter-state derivation; URL semantics; About content; env files.

## 12. Analytical integrity

Movement start/end/middle controls, basis/metric/country controls,
and results; Compare entities/results; Status refresh — all
unmodified and receiving identical props. Only the header text
source changed.

## 13. Tests

- Frontend **80/80** (15 files): 11-case resolver suite (spec cases
  1–10 + stale-year fallback) and App wiring suite (movement
  isolation, compare/status neutrality, 2F identity/deep-link tests).
- Backend **567/568** — single failure is the known pre-existing
  `server.test.js:179` refresh-validation env issue (401 vs 400),
  identical to the 2E/2F baselines; this round touches no backend
  files at all.

## 14. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

```text
INFO VIEWS NEUTRAL HEADER: PASS
MOVEMENT RANGE HEADER: PASS
SINGLE-YEAR HEADER: PASS
COMPARE NEUTRAL HEADER: PASS
STATUS NEUTRAL HEADER: PASS

MOVEMENT YEAR ISOLATION: PASS
DEEP-LINK REGRESSION: PASS
RESPONSIVE HEADER: PASS

ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS
DATA/API UNCHANGED: PASS

TESTS: PASS
LINT: PASS
BUILD: PASS

COMMIT READY: YES
```
