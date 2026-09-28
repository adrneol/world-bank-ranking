# OVERVIEW CONTEXT GRAPHS REPORT

> Overview-only optional cross-metric context overlays. Presentation and
> visualization only: `git diff --name-only -- backend/src` is empty, no
> ranking/benchmark/gap/methodology/API/ingestion file of any kind
> changed, and no new endpoint was created.

---

## 1. Existing data audit

- **CPI inflation series**: `GET /api/focus/yearly?subject=prices` rows
  → `row.inflation_cpi.indiaValue` (backend unit `annual %`,
  `FP.CPI.TOTL.ZG`, verified in `backend/src/config.js`).
- **GDP-deflator inflation series**: same response →
  `row.inflation_deflator.indiaValue` (backend unit `annual %`).
- **Real GDP growth series**: `GET /api/focus/yearly?subject=gdp_total`
  rows → `row.total_constant.indiaYoY` (backend-computed constant-price
  GDP YoY, annual %). This is the exact series `SubjectInsight`'s
  `RatePanel` already tables as "Real GDP growth (%)" — no new concept.
- All three are annual-% series → one shared `annual %` axis (§10
  satisfied; no unit was changed to make the chart work).
- Overview's history already fetched its active subject over the full
  window; each context subject needs **one additional call to the same
  existing endpoint** (same country, same window), enabled only while
  its toggle is on. OFF renders zero extra requests.
- `TimeSeriesChart` already supported N series (`alignSeries`,
  null-preserving, `connectNulls={false}`), HTML `ChartLegend` below
  the plot (no in-plot Recharts legend), and Phase-2 responsive CSS.

## 2. Prices CPI overlay

`inflation_cpi` history keeps its legacy graph; a `Context series`
fieldset offers `[ ] Real GDP growth`. ON → CPI (navy solid, primary)
+ growth (teal dashed) on `annual %` with `zeroLine`, title
`CPI inflation with real GDP growth — annual %`, disclaimer footnote,
legend `[India, Real GDP growth]`. OFF → legacy graph bit-for-bit.

## 3. Prices GDP-deflator overlay

Same control for `inflation_deflator`: ON → deflator + growth, title
`GDP-deflator inflation with real GDP growth — annual %`. Missing
backend years (e.g. 2021) render as gaps/`—`, never zero-filled.

## 4. Total GDP Real GDP Growth context controls

`total_constant` history keeps its legacy **levels** graph while no
context is selected (OFF regression, §22). Two independent checkboxes —
CPI inflation, GDP-deflator inflation — switch the chart to growth
mode: primary = backend Real GDP growth YoY, plus the selected
inflation overlays, all on `annual %`. Produces None (legacy levels) /
CPI-only / deflator-only / Both. Titles follow the spec pattern
(`Real GDP growth with CPI inflation and GDP-deflator inflation —
annual %`).

## 5. Shared chart architecture

No new chart architecture: `ChartCard` → `TimeSeriesChart` →
`ChartLegend` → source, with the existing `.chart-plot` / wrapping
legend / growing-card CSS contract. Only additions: a third
stroke/dash slot and the `.context-series` chip-checkbox styles.
Toggle state lives in `OverviewHistory`, keyed by
`country:subject:metric` from Overview — switching family/metric
remounts it, so stale context can never leak (§6).

## 6. Series/color mapping

Deterministic by series order: primary navy `#101828` solid;
first context teal `#2a7f6f` dashed (`6 3`); second context vermillion
`#D55E00` dotted (`2 2`) — Okabe-Ito, color-blind-safe against
navy/teal. Never color alone: solid-vs-dash plus explicit legend
labels (`Real GDP growth`, `CPI inflation`, `GDP-deflator inflation`);
legend lists exactly the plotted series. Primary stays first and
solid; context lines keep full 2px weight (readable, not faint).

## 7. Legend behavior

Existing Phase-2 HTML legend below the plot; wraps in flow at every
width; swatches reuse each line's exact stroke color + dash.

## 8. Missing-data behavior

Backend nulls pass through (`valuePoints` → `alignSeries` null →
`connectNulls={false}` breaks the line; tables show backend display
strings or `—`). No zero-fill, no interpolation, no invented values.
Overlay points are clamped to the primary window; the primary series
is never truncated for a shorter context series.

## 9. Responsive behavior

Static + build-level (no browser tooling here): control row is
flex-wrap with 2.5rem tappable chips; legend/title/source wrap under
the existing chart CSS; plot keeps its responsive shell. Pinned in
`responsive.test.js`. Breakpoint screenshots (320–1440 incl. 390×844
etc.) remain explicitly pending — standing limitation.

## 10. Data-flow integrity

Backend responses → row/cell passthrough → chart points + table cells
using backend display strings (`indiaValueDisplay`, `indiaYoYDisplay`).
The only frontend math is axis/window plumbing (`Math.min/max` on
years) and string formatting. Growth values are backend `indiaYoY`,
never frontend-computed.

## 11. Regression verification

- OFF state reproduces the legacy chart props (title/unit/decimals/
  single series/displayName label, no zeroLine, no badge) and the
  legacy fallback table (formatted display values) exactly — verified
  by toggle on/off round-trip tests asserting identical table text.
- Full frontend suite 88/88 (incl. all pre-existing Overview-adjacent,
  methodology, drawer, header suites); backend 567/568 (only the known
  pre-existing refresh-auth failure); lint at 3-warning baseline;
  production build passes.
- One backend **test** (not source) was updated:
  `accessibilityGate.test.js` now checks `OverviewHistory.jsx`
  (where the history chart + text equivalent live) instead of
  `Overview.jsx`, plus asserts Overview delegates to it — gate intent
  preserved and documented inline.

## 12. Exact files changed

- `frontend/src/sections/OverviewHistory.jsx` (new) — context-aware
  history chart + control + disclaimer + extended fallback table.
- `frontend/src/sections/overviewContext.js` (new) — pure series
  helpers/identities (components-free per fast-refresh rule).
- `frontend/src/sections/Overview.jsx` — history block delegates to
  `OverviewHistory` (keyed remount); unused imports removed.
- `frontend/src/components/charts/TimeSeriesChart.jsx` — third
  stroke/dash slot (no other behavior change).
- `frontend/src/components/charts/chartTheme.js` — `tertiary` token.
- `frontend/src/index.css` — `.context-series` control styles.
- `frontend/src/sections/OverviewHistory.test.jsx` (new) — 7 focused
  tests; `frontend/src/responsive.test.js` — control-wrap pins.
- `backend/test/accessibilityGate.test.js` — gate follows the moved
  history block (§11).

## 13. Exact files untouched

All of `backend/src`; database; WDI ingestion; indicator registry;
methodology definitions; ranking/benchmark/gap/Observed-LFL/
Common-Outside; Movement/YoY/Compare/Rank/Data/Coverage/Audit/Status;
Methodology/About/Home; SearchableSelect; popover engine; drawer;
charts besides the stroke slot; filter-state/URL semantics.

## 14. Tests

- New: CPI default/overlay/remove; deflator overlay + gap; total
  levels default; CPI/deflator/both + deterministic swatch colors +
  removal back to legacy; remount reset; pure-helper passthrough.
- Full frontend **88/88** (16 files); backend **567/568** (known
  pre-existing failure only).

## 15. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

## 16. Browser screenshots

Unavailable in this environment (standing limitation). Substituted
with render tests for every toggle state (titles, legends, swatch
colors, tables, fetch gating) plus CSS pins. Screenshot matrix
(OFF/ON × CPI/deflator/growth × 390/414/768/1280/1440) remains
explicitly pending.

```text
CPI + REAL GDP GROWTH: PASS
GDP DEFLATOR + REAL GDP GROWTH: PASS
REAL GDP GROWTH + CPI: PASS
REAL GDP GROWTH + GDP DEFLATOR: PASS
REAL GDP GROWTH + BOTH: PASS

TOGGLES / REMOVE: PASS
COLOR DISTINCTION: PASS
LEGEND: PASS
SHARED % AXIS: PASS
MISSING DATA: PASS
RESPONSIVE: PASS

PRIMARY GRAPH REGRESSION OFF: PASS
DATA / ECONOMICS INTEGRITY: PASS
FRONTEND DOES NOT RECALCULATE: PASS
BACKEND SOURCE UNCHANGED: PASS

TESTS: PASS
LINT: PASS
BUILD: PASS

COMMIT READY: YES
```
