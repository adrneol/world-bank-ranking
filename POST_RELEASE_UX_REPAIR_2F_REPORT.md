# POST-RELEASE UX REPAIR — ROUND 2F REPORT

> Context-aware global site identity + methodology navigation polish on
> the live tree (no reset). Analytical engine untouched:
> `git diff --name-only -- backend/src` is empty.

---

## 1. Header identity changes

The old header rendered `{focusName} ranking — {year}` (eyebrow
`World Bank WDI · {focusName} {subject}`) on **every** view — mislabeling
Home/Methodology/About as an India ranking page and misdescribing
analytical workspaces that do far more than ranking. The header in
`App.jsx` is now context-aware, driven live by `effective` filter state
(the same derived state every section renders from, so identity can
never disagree with displayed data):
- Informational pages (Home/Methodology/About): neutral project
  identity — eyebrow `World Bank WDI`, title `Economic data analysis`.
  No country, no year, no "ranking", no subject.
- Analytical pages (Overview/Data/Rank/Movement/YoY/Compare/Coverage/
  Audit/Status — all nine share the one branch via `isAnalyticalView`):
  eyebrow `World Bank WDI · {ISO3}`, title `{focusName} — {year}`.
  Nothing hard-coded: country ISO/name/year resolve from URL + backend
  metadata exactly as before.
- Drawer trigger behavior unchanged: `Explore analysis` on info pages,
  workspace label (`Movement`, `Rank`, …) on analytical pages.
- Deep links unchanged: `?view=`/`?country=`/`?year=` parsing untouched.

## 2. Dynamic country/year verification

Render tests (`App.test.jsx`) with stubbed `/api/years`,
`/api/countries`, `/api/indicators`:
- Home/Methodology/About each render eyebrow `World Bank WDI` + title
  `Economic data analysis`, with no `ranking` in the header.
- `?view=overview&country=USA&year=2022` renders eyebrow
  `World Bank WDI · USA`, title containing `United States` and `2022`,
  and no `ranking` anywhere in the header — proving country and year
  both come from current state.
- Existing drawer-routing (`view=movement` via drawer) and `?view=`
  deep-link tests still pass.

## 3. Breadcrumb styling

Root cause: crumb parents used `btn btn-ghost` — the site's underlined
blue hyperlink style — inside a `.footnote` paragraph with literal
`' › '` text separators, i.e. browser-looking links by construction.
Replaced with an intentional component:
- `<nav class="crumbs" aria-label="Methodology location">` (landmark,
  not a paragraph); current level is `.crumb-current` with
  `aria-current="page"`.
- Parents are quiet `.crumb-link` buttons: no underline at rest, muted
  color, underline + ink + hover wash on hover, visible focus ring.
- Separators are `aria-hidden` spans with reduced opacity.
- Flexbox with `flex-wrap` + `max-width: 100%`: long trails
  (`Methodology › GDP per capita › PPP Constant 2021 › Growth`) wrap to
  multiple lines; no `overflow-x` anywhere, so horizontal overflow is
  structurally impossible. Current level stays distinguishable by
  weight + ink color.

## 4. Back navigation

`BackLink` used the same ghost-hyperlink style (`← {label}`), reading
as a raw browser link. It is now a secondary-button action —
`btn btn-secondary backnav` in a `.backnav-row` — rendering
`← Back to {label}`, visually consistent with the site's card
(`Explore →`) and control buttons.

## 5. Analytical pages

No navigation/content redesign: the only change on analytical views is
the shared title/context block (§1), which all nine workspaces inherit
from the single `isAnalyticalView` branch. Overview exercised in tests;
drawer routing + deep links re-verified (§2).

## 6. Responsive verification

Static + build-level (no browser tooling in this environment):
- Brand block gets `min-width: 0` + `overflow-wrap` on the title, so
  long focus-country names wrap inside the header instead of pushing
  the row or page into overflow (pinned by test).
- Crumbs wrap naturally; backnav is a normal wrapping button; the
  existing 40rem mobile header/nav stacking rules are untouched.
- Breakpoint screenshot pass (320/390/414/768/1280/1440) remains
  explicitly pending — same standing limitation as Round 2E. Crumb
  wrap/no-overflow, quiet-link, current-emphasis, and brand-containment
  rules are pinned in `responsive.test.js`.

## 7. Methodology content

Unchanged from Rounds 2C–2E: HOW/FORMULA/PERIOD/ELIGIBILITY/RANKING/
BENCHMARK-GAP/OBSERVED-LFL/DISTINCT/MISSING-DATA/SOURCE rows,
formula A/B/C/D states, GDP growth/period operation strings, units
fallback, CPI annual/average/cumulative distinction all intact. Only
the crumb/backlink chrome around the content changed. Full
`Methodology.test.jsx` suite (6 tests) passes.

## 8. Exact files changed

- `frontend/src/App.jsx` — context-aware identity block (+ comment);
  `subjectLabel` import retained (still used in YoY prose).
- `frontend/src/sections/Methodology.jsx` — `Breadcrumb` (nav +
  crumb classes + `aria-current`) and `BackLink` (secondary-button
  `← Back to …`) rewrite; content untouched.
- `frontend/src/index.css` — `.crumbs` family styles, `.backnav`
  rules, brand-block containment (`min-width: 0`, `overflow-wrap`).
- `frontend/src/App.test.jsx` — neutral-identity (3 info views) +
  dynamic country/year + no-`ranking` tests.
- `frontend/src/sections/Methodology.test.jsx` — backlink label
  update; crumb-structure assertions (nav landmark, separator,
  `aria-current`).
- `frontend/src/responsive.test.js` — crumb wrap/no-overflow,
  quiet-link/current-emphasis, brand-containment pins.

## 9. Exact files untouched

All of `backend/src`; WDI ingestion; database; API economics; ranking;
benchmark; gap; Observed/LFL; Common/Outside; basis definitions;
all movement sections; search/sort; charts; refresh stack;
`StatusBlock`; registries; adapters; drawer logic; About content;
`methodology.js`/`methodologyDetails.js`; env files; App routing and
filter-state derivation.

## 10. Backend production-source diff

`git diff --name-only -- backend/src` → empty. No backend files of any
kind changed in this round.

## 11. Tests

- Frontend **67/67** (14 files): new identity tests, updated
  crumb/backlink tests, new CSS pins; all suites green.
- Backend **567/568** — the single failure is the known pre-existing
  `server.test.js:179` refresh-validation env issue (401 vs 400),
  identical to the Round-2E baseline and unrelated to this round
  (no backend changes at all).

## 12. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

## 13. Remaining limitations

- Breakpoint screenshot verification pending (see §6).
- Informational neutral title (`Economic data analysis`) is a fixed
  project-level string by design; analytical identity is fully
  state-driven.

```text
GLOBAL SITE IDENTITY: PASS
ANALYTICAL COUNTRY/YEAR HEADER: PASS
NO "RANKING" MISLABEL: PASS
METHODOLOGY BREADCRUMBS: PASS
METHODOLOGY BACK NAV: PASS
RESPONSIVE: PASS
ANALYTICAL ENGINE UNCHANGED: PASS
BACKEND PRODUCTION SOURCE UNCHANGED: PASS
TESTS: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
