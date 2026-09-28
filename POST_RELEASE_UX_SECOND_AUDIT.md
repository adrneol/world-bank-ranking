# POST-RELEASE UX — SECOND AUDIT (read-only, zero code changes)

> Fresh audit of CURRENT HEAD (`a596c5c`, clean tree). Nothing was modified,
> created (except this report), or tested by execution. Prior-phase code was
> re-verified in place, not trusted from reports.

---

## 1. Current baseline

- HEAD: `a596c5c docs: finalize release gate and deployment assumptions`.
- `git status`: clean. **None of the previous post-release UX code exists
  in the tree**: no `Home.jsx`/`About.jsx`/`Methodology.jsx`,
  no `InfoMenu.jsx`, no `config/site.js`, no `config/methodology.js`,
  no `SearchField.jsx`, no `movementSort.js`, no `useDebouncedValue.js`,
  no `VITE_SITE_*` variables (`.env.example` documents only
  `VITE_API_BASE_URL`).
- Navigation: exactly 9 tabs in `App.jsx` VIEWS (Overview, Data, Rank,
  Movement, YoY, Compare, Coverage, Audit, Status); stateful-tab routing
  via `?view=` with `isViewId` guard defaulting to `overview`.
- Movement, registry/domain, methodology sources, portal/popover system:
  unchanged Phase-6 state (re-verified below).

## 2. Existing search problems

- **Rank (FullRanking.jsx:61-65): submit-only confirmed.** `searchInput`
  (keystrokes) vs `search` (applied) split; backend `searchRanked`
  (`domain/ranking.js:191`) already supports case-insensitive substring on
  name/ISO3 plus exact `#rank` semantics with backend numbering. Problem is
  frontend interaction only. Focus/Common/Country searches all filter
  immediately on local data — no reusable remote-search abstraction
  exists; one should be created (debounce belongs only on the remote path).
- **YoY (YoyRanking.jsx:49-53): identical submit-only pattern**, same
  backend support (`yoyVerification.js` uses the same `searchRanked`).
- Movement/common/outside/group/candidate searches: already immediate;
  must remain untouched.

## 3. Existing Movement sort problems

- GDP RankMovement: per-year labeled sorts via `commonSortOptions`
  (`RankMovement.jsx:912+`) — rich and correct.
- All six Phase-5 families: hardcoded 4 generic ref-period options
  (`value={sort}`, `Rank — best first` etc., verified in all six files).
  Backend rows already carry per-period ranks/values (`perKey`), and each
  table already sorts client-side — so exposing per-period choices is
  presentation-only and analytically legitimate for every key present.
- Verdict: real bug (class C/D: frontend limitation, not methodology).
  Nothing is intentionally limited; FX alone needs distinct "change"
  vocabulary. GDP behavior must remain byte-identical.

## 4. Current navigation architecture

- `Tabs` (roving tabindex, arrows/Home/End, `aria-selected`) renders the 9
  views; `App` filter state + `setFilter('view', …)` is the only navigation
  mechanism; `?view=` round-trips through `readUrlState`/mirror effect.
- Header flex-wraps; mobile currently wraps tabs multi-row. No menu,
  drawer, or secondary nav exists. Phase-3 portal + `computePopoverPlacement`
  (`components/popover.js`) is available for overlays.

## 5. Sidebar proposal feasibility

The proposed HEADER (Home | Methodology | About + drawer trigger) with the
9 analytical views in a right-side drawer is **feasible with minimal
disruption**:

- **A. Tabs state preserved.** Navigation state is the `view` string;
  the drawer calls the same `setFilter('view', id)`. `Tabs` can render a
  subset or be bypassed for analytical views without modification.
- **B. No routing framework.** Selection = `setFilter` + close; `?view=`
  mirror already deep-links every view including future Home/Methodology/
  About ids (just extend the id allowlist).
- **C. Drawer preferred over popover here.** Nine labeled destinations
  (some needing active-state + descriptions) exceed comfortable popover
  capacity; a drawer gives a stable list, natural mobile full-height
  behavior, and simpler focus management than a 9-item menu.
- **D. Desktop:** right-side overlay drawer + scrim (not a permanent rail;
  preserves content width, no layout reflow).
- **E. Mobile:** same drawer, full-height, width capped (≈20rem), existing
  bottom-sheet/dvh patterns do not apply (this is nav, not a select).
- **F. Keyboard:** trigger `aria-haspopup="dialog"` + `aria-expanded`;
  focus first item on open; Escape closes and refocuses trigger; Tab
  contained or closes on leave; arrows optional (native buttons suffice,
  arrows preferred).
- **G. After selection:** navigate, auto-close, refocus trigger (matches
  existing popover/menu policy).
- **H. Closed-trigger indication:** `[☰ Analytical views]`-style trigger
  showing the current analytical view label (e.g. `[☰ Movement]`) is most
  coherent: one control, always-visible context, existing `.tab` styling.
  On Home/Methodology/About the trigger shows a neutral label.

## 6. Home page requirements

Explain: what the site is, WDI raw observations as data, investigable
areas (8 backend subjects — must be backend-driven, never hardcoded),
project reason (transparent reproducible analysis), entry CTA into the
analytical workspace, concise provenance. NOT another Overview (no ranks).
Reuse hero/card/section tokens; default landing route; preserve all
`?view=` deep links.

## 7. About page requirements

Repo contains **no author identity** (verified): any personal values must
come from public display env metadata with neutral fallbacks. Content:
developer slot, reason/motivation, transparency philosophy, generated-
(not-manual) methodology note, source transparency. Freshness/vintage
stay backend-authoritative with inline disclaimers.

## 8. Methodology source map

| Family | Metrics | Basis catalog | Formula/wording | Source files |
|---|---|---|---|---|
| GDP per capita | 4 × NY.GDP.PCAP.* | generic level/growth/period (capability-gated) | `periods.js`, `yoy.js`, block `levelRanking`/`yoyFormula` | backend code (no txt) |
| Total GDP | 4 × NY.GDP.MKTP.* | same generic set | same as above | backend code (no txt) |
| Prices | 3 | `PRICES_BASIS_INFO` (2/3/3, full descriptions/formulas/rankWording) | domain map | `prices/method-cpiindex.txt`, `cpiInflationmethodology.txt`, `gdpDeflator.txt` |
| Trade | 2 | `TRADE_BASIS_INFO` | domain map | `trade/tademethod.txt` |
| Capital flows | 2 | `CAPITAL_BASIS_INFO` | domain map | `capitalflow/capitalflowmethod.txt` |
| Exchange rates | 1 (PA.NUS.FCRF) | `FX_BASIS_INFO` (annual level unranked) | domain map | `ExchangeRate/exchangerate.txt` |
| External sector | 3 | `EXTERNAL_BASIS_INFO` (+benchmarkType) | domain map | `ExternalSector/externalsector.txt` |
| Population | 1 (SP.POP.TOTL, stock) | `POPULATION_BASIS_INFO` | domain map | `population/pop.txt` |

Shared rules (all families): `universeRule`, competition ranking (1,1,3),
Observed/LFL identical-formula universes, Common/Outside membership,
missing-data-never-zero, full-precision-then-format, per-basis
benchmark/gap — from `methodologyBlock` + per-basis `rankWording`/
`gapUnit`. No master spec file exists. `/api/indicators` exposes
subjects, production metrics, and all six family basis catalogs —
sufficient to drive the page with zero backend changes.

## 9. Methodology page architecture

Family → Metric → Basis cascade over the `/api/indicators` payload
(fail-closed on malformed/unknown), breadcrumb `Family › Metric › Basis`,
single conditional detail card (description, formula, unit, gap unit,
observation rule, ranking incl. unranked handling, benchmark pointer,
Observed/LFL, missing-data, WDI indicator, family paragraph, universe
rule), family browse cards as the opening state. Compatible with the
registry/API as audited — no new endpoints required.

## 10. GDP/GDP-per-capita traceability

No dedicated txt files (confirmed). Safely documentable from: metric
`validChangeTypes` (YOY→growth) and `periodAggregation` (SUM/AVG→period
modes), registry ranking direction, `yoyFormula`/`levelRanking` block
text, and period-operation semantics. Anything beyond that must be
flagged, not written.

## 11. Environment metadata design

Schema from the brief is sound: `VITE_SITE_AUTHOR_NAME/_ROLE`,
`_LAST_UPDATED_YEAR/_MONTH/_DAY`, `_DATA_YEAR/_MONTH`,
`VITE_SITE_SOURCE_NAME` (default "World Bank WDI"). Separate parts (no
format-string editing), optional with neutral fallbacks, display-only.
Backend-authoritative must remain: WDI vintage, latest year, indicator
availability, observation dates, freshness. Existing env architecture
(public `VITE_*` + `.env.example` + dev pinning) supports this safely;
assert the allowlist in tests.

## 12. Blank-page investigation — ROOT CAUSE IDENTIFIED

**Primary cause: the pages do not exist in this tree.** HEAD is the
Phase-6 release with a clean working tree; the prior implementation was
never committed, so no build or deployment from this tree could render
Home/About/Methodology — any route resolving to them (or any test
exercising them) would show blank/missing. This fully explains
"declared PASS but blank in actual use": static checks (lint/build) and
even unit tests cannot catch code that never reached the tree under test.

Ruled out as primary causes (verified in source): route-id support
(`isViewId` pattern extends trivially), CSS hiding (no such rules),
API-field dependence (`/api/indicators` exists since Phase 2 and carries
all required fields), lazy-mount null branches (analytical views gate on
`filtersReady`; informational views must not).

**Process lesson for the next implementation:** informational views must
not gate on data readiness; every new view needs a real browser render
check (static tests are necessary but not sufficient); implementation
must be committed before verification claims.

## 13. Shared-component opportunities

- Search: one `SearchField` (label/input/Search/Clear) + one
  `useDebouncedValue` (remote only); movement tables keep local
  immediate inputs (already standard).
- Sort: one generator `movementSortOptions({keys, valueLabel, …})` +
  one comparator (shared null/tie behavior), FX vocabulary parameterized.
- Nav: one drawer component reusing the portal mount + placement math.
- Methodology: one tree-builder + one cascade/detail page (backend-driven).

## 14. Exact files that WOULD need changing

`App.jsx` (view ids, default, drawer trigger, branches), `Tabs.jsx`
(minor active-state handling) or new `NavDrawer.jsx`, `index.css`
(drawer/hero/menu/mobile tabs), new `Home/About/Methodology.jsx` +
`methodology.js` tree builder + `site.js` env + `SearchField.jsx` +
`useDebouncedValue.js` + `movementSort.js`, `FullRanking/YoyRanking.jsx`
(search wiring), six family common tables (sort options), `.env.example`
+ README env docs, new backend test files only.

## 15. Exact files that MUST NOT be changed

Backend services/domain/registry/ingest/API/Q
...[truncated 1353 chars]