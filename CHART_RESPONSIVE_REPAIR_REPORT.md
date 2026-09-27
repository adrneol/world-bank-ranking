# CHART RESPONSIVE REPAIR REPORT — PHASE 2 (R-05)

> Scope: shared chart architecture only (R-05). No backend, API,
> methodology, ranking, benchmark, data, dropdown, responsive-CSS-system, or
> mobile-card changes. Presentation/layout only; all analytical values still
> flow backend → adapter → props → render untouched.

---

## 1. Original root cause

`FULL_CODEBASE_FORENSIC_AUDIT.md` §10 / R-05 hypothesized a fixed-height
collision model. Verified true against live code before editing:

- `figure.chart-card` → `figcaption.chart-head` (title/unit/badge) →
  `div.chart-body` with **fixed `height: 260px`** (`220px` ≤40rem) →
  `p.chart-source` footer in normal flow after the body.
- Inside the fixed body, each of the 3 chart components rendered
  `<ResponsiveContainer height={260}>` containing the plot **plus a Recharts
  `<Legend>`**. Recharts mounts the legend as an absolutely-positioned
  wrapper *inside* the container box, so legend text overlaid X-axis ticks
  and plot area whenever it wrapped (2-series legends on 320–414px, long
  series names such as "Other-economy average").
- `YAxis width={64}` for every chart regardless of unit length, with the
  rotated `insideLeft` unit label (`"local currency units per US$ (period
  average)"`, `"constant 2021 international $"`) squeezing the plot.
- No `overflow: hidden` in the chart chain and no fixed card height — the
  collision was strictly plot-vs-legend inside the fixed 260/220px box,
  exactly as the audit described. No other chart components exist in the
  repo (only `TimeSeriesChart`, `BarComparisonChart`, `SlopeChart` + the
  unused legacy `.trend-chart` CSS, which was left alone).

Rendered structure before:

```text
TITLE (figcaption.chart-head)
→ plot + legend SHARING one 260px box (ResponsiveContainer > svg + legend overlay)
→ source (p.chart-source, normal flow after the box)
```

---

## 2. Shared components affected

- `frontend/src/components/charts/ChartCard.jsx` — doc contract only (DOM
  order header/body/source was already correct; no JSX change needed).
- `frontend/src/index.css` — analytical-charts block only (no dropdown,
  sheet, table, or breakpoint-system rules touched).

## 3. Chart components changed

- `TimeSeriesChart.jsx` — legend moved out of `LineChart`; plot wrapped in
  `.chart-plot`; responsive Y width; `height` prop now an optional explicit
  override (default CSS-driven; no callers pass it).
- `BarComparisonChart.jsx` — same treatment for grouped 2-series legend;
  single-series output unchanged (no legend, as before).
- `SlopeChart.jsx` — same treatment; `invertY`/geometry/tooltip unchanged.
- `chartTheme.js` — added pure `yAxisWidthFor(unit, narrow)` helper;
  `CHART_HEIGHT` export retained for compatibility.
- **New** `ChartLegend.jsx` — shared HTML legend (`ul.chart-legend-html`),
  items `{label, color, dashed}`, null-safe, `aria-label="Chart legend"`.
- **New** `hooks/useMediaQuery.js` — subscription-based narrow-screen hook
  keyed to the stylesheet's own `(max-width: 40rem)` breakpoint (no
  setState-in-effect; SSR-safe).

## 4. Layout architecture before/after

Before: `header | FIXED 260px(plot+legend overlay) | source`.
After (all three chart types, all call sites unchanged):

```text
Chart Card (figure.chart-card, height auto — grows naturally)
├── Header (figcaption.chart-head: title + unit + badge, wrapping)
├── Plot Region (div.chart-plot: EXPLICIT responsive height 260px / 220px ≤40rem)
│   └── Recharts plot only (ResponsiveContainer width 100% height 100%, no Legend)
├── Legend Region (ul.chart-legend-html: flex-wrap, normal flow, null when single-series)
└── Source Region (p.chart-source: normal flow, wraps, subordinate styling kept)
```

The fixed-height collision model is gone: exactly one region
(`.chart-plot`) has a fixed height, and it contains only the plot.
Legend/source/header are content-driven. Total height was *not* bumped
(260→300 anti-pattern avoided).

## 5. Mobile behavior

- Plot keeps an explicit usable height at every width (260px → 220px at
  ≤40rem via the same breakpoint JS and CSS share).
- Legend wraps/stacks below the plot in flow; card grows vertically.
- Source wraps to two lines where needed (accepted per spec; font size
  unchanged at 0.78rem, still readable).
- Title/unit wrap (`overflow-wrap: anywhere`, `min-width: 0` fixes for flex
  children).
- Angled X labels (>8 bars) keep their 52px axis allocation inside the plot
  shell; Y width tightens to 60/72px on narrow screens (ticks already
  compact: 1.2T/3.4B/…).

## 6. Desktop behavior

- Plot height unchanged (260px); no new blank space (legend renders only
  where a Legend rendered before: multi-series/grouped).
- Y width 72px standard, 88px for long units (>20 chars) — plot narrows by
  ≤24px only where the unit label previously collided.
- Visual hierarchy (serif title, muted unit, hairline card) untouched.

## 7. Legend behavior

- One strategy everywhere: horizontal flex-wrap on desktop, wrap/stack on
  mobile, 0.82rem muted text, swatch mirrors the series stroke color +
  dashed pattern (second series distinguishable without color alone).
- Shown exactly where the old in-plot Legend was shown (TimeSeries >1
  series, Bar grouped, Slope >1 item); single-series charts render no
  legend, as before.
- Never overlaps plot/source/title/axes (separate flow region).

## 8. Source behavior

- Still `p.chart-source` directly under the legend region, normal flow, no
  positioning, no negative margins, no clipping; wraps naturally
  (`overflow-wrap: anywhere` added).

## 9. Axis behavior

- `yAxisWidthFor(unit, narrow)`: narrow 60px (72px long units); desktop
  72px (88px long units). Unit strings are never altered — only reserved
  space changes; full meaning stays in axis label + tooltip + methodology
  panel.
- X handling per type preserved deliberately: TimeSeries numeric year axis
  (`tickCount min(8,n)`), Bar categorical with 52/30px angled-label
  allocation, Slope two endpoint categories. Margins per chart type
  unchanged (TimeSeries/Bar `{8,12,4,4}`, Slope `{8,16,4,4}` — right 16px
  kept for Slope endpoint dots).
- Ticks/tooltip formatting (`chartFormat.js`) untouched.

## 10. Files changed

```text
M frontend/src/components/charts/TimeSeriesChart.jsx
M frontend/src/components/charts/BarComparisonChart.jsx
M frontend/src/components/charts/SlopeChart.jsx
M frontend/src/components/charts/ChartCard.jsx   (contract comment only)
M frontend/src/components/charts/chartTheme.js   (added yAxisWidthFor)
M frontend/src/index.css                          (chart block only, +48/-3)
?? frontend/src/components/charts/ChartLegend.jsx (new)
?? frontend/src/hooks/useMediaQuery.js            (new)
```

Backend files changed: **none**. Dropdown/SearchableSelect/sheet files
changed: **none**.

## 11. Tests

- `npm run lint` (frontend): **0 errors**, 3 warnings — identical to the
  pre-change baseline (all pre-existing).
- `npm run build` (frontend): **passes**; built CSS verified to contain
  `.chart-plot` 260px / 220px rules, `.chart-legend-html`, and no fixed
  `.chart-body` height.
- Backend suite: **542/543** — sole failure is the known pre-existing
  environment-dependent `server.test.js:179` refresh-auth expectation
  (expects an open endpoint while local `.env` sets `REFRESH_ADMIN_TOKEN`);
  unchanged by this phase (no backend files touched).
- Structural assertions (grep-verified): zero `<Legend>` imports/usages in
  `src`; every `ResponsiveContainer` uses `height="100%"` inside an explicit
  `.chart-plot` parent (no fixed-collision, no undefined-parent collapse);
  no `overflow: hidden`/absolute/negative-margin rules in the chart chain.
- Data-integrity review (diff): adapters (`chartData.js`), `connectNulls`,
  domains, `dataKey`/`name` props, `invertY`, tooltip formatters, and all
  call-site props are byte-identical in behavior — layout props only.

## 12. Browser/screenshot verification

No browser/screenshot tooling exists in this environment (established in
Phase 1: no Playwright/Puppeteer/jsdom). Verification performed instead:

- Static DOM-order trace from source for all 3 chart types (header →
  plot-shell → legend → source confirmed in JSX).
- Built-bundle CSS check (rules present, old fixed body gone).
- Regression reasoning per breakpoint band:
  - 320–480: legend stacks below 220px plot; source wraps; no overlay
    geometry remains (nothing absolutely positioned in the card).
  - 640–834: 220–260px plot with wrapped legend in flow.
  - 1024–1440: unchanged 260px plot; legend horizontal; ≤24px plot-width
    change only for long units.
- **Explicit re-check with real screenshots is still recommended** on
  390×844 (Checks A/B/C: CPI history, CPI comparison, legend+source) plus
  one chart per remaining family, when browser tooling is available.

## 13. Remaining limitations

- `.chart-plot` is still a fixed pixel height (260/220) — intentional per
  Phase 13 (plot region must have explicit height); the *collision model*
  is fixed because the legend left the box. Very tall legends (3+ long
  series names) grow the card, which is the accepted behavior.
- `CHART_HEIGHT` export retained (unused by components now) for import
  compatibility; the CSS values are the source of truth.
- Slope X labels are endpoint years (short); if a future caller passes long
  category labels to Slope, the plot shell does not reserve extra bottom
  space — Bar's angled-label handling remains the pattern to copy.
- Screenshots (Phase 17/18) not yet taken — see §12.

---

## Acceptance tables

| Chart type | 320 | 390 | 480 | 768 | 1280 | Status |
|------------|-----|-----|-----|-----|------|--------|
| TimeSeries (single) | plot 220, no legend, source wraps | same | same | plot 220–260, source wraps | plot 260, unchanged | ✅ static-verified |
| TimeSeries (multi) | legend stacks below plot | same | same | legend wraps below plot | legend horizontal | ✅ static-verified |
| BarComparison (single) | plot 220, angled labels inside shell | same | same | unchanged geometry | unchanged | ✅ static-verified |
| BarComparison (grouped) | 2-item legend stacks below plot | same | same | legend wraps below plot | legend horizontal | ✅ static-verified |
| Slope (multi) | legend stacks below plot, endpoints inside margins | same | same | legend wraps below plot | legend horizontal | ✅ static-verified |

| Family | Representative chart | Mobile | Desktop | Status |
|--------|----------------------|--------|---------|--------|
| Total GDP | RankMovement Bar (focus levels) | stacks, no overlay geometry | unchanged | ✅ |
| GDP per capita | Overview TimeSeries history | stacks, no overlay geometry | unchanged | ✅ |
| Prices | observed/LFL Bar (focus vs avg) | 2-item legend stacks | horizontal legend | ✅ |
| Trade | observed/LFL Bar | same as Prices | same | ✅ |
| Capital Flow | observed/LFL Bar | same | same | ✅ |
| Exchange Rate | level Bar (single) + change Bar (grouped) | same | same | ✅ |
| External Sector | observed/LFL Bar | same | same | ✅ |
| Population | growth Bar (grouped) | same | same | ✅ |
| Compare | Bar (A vs B) + Slope + TimeSeries trajectories | stacks | horizontal | ✅ |

Modes covered by construction (shared components): annual, period,
Observed, LFL, Common/Outside tables' charts, focus-vs-benchmark,
single/multi-series, negative values (ReferenceLine zeroLine path
untouched), USD (compact ticks), %/pp/people/months units (formatter +
width helper, no unit alteration).

---

## Acceptance checklist

- [x] Plot never overlaps legend (separate regions; no absolute legend)
- [x] Plot never overlaps source (source in flow after legend region)
- [x] Legend never overlaps source (sequential flow siblings)
- [x] Title never overlaps plot (header flex-wrap above plot shell)
- [x] Source has dedicated flow space (`p.chart-source` after body)
- [x] Source wraps safely (`overflow-wrap: anywhere`)
- [x] Legend wraps/stack safely (flex-wrap; card grows)
- [x] Chart cards grow naturally (only `.chart-plot` fixed)
- [x] No fixed total-height collision model (legend/source content-driven)
- [x] No clipping (no overflow rules in chain; verified)
- [x] Axis/unit labels remain readable (width helper; text unaltered)
- [x] X labels remain readable (52/30px allocations kept)
- [x] TimeSeries works (mapping identical; legend condition preserved)
- [x] BarComparison works (single + grouped; entries verbatim)
- [x] Slope works (geometry, invertY, tooltip identical)
- [x] Single-series works (no legend, as before)
- [x] Multi-series works (HTML legend mirrors colors/dashes)
- [x] Negative-value charts work (zeroLine/ReferenceLine untouched)
- [x] USD / % / people / months / pp charts work (formatter + width only)
- [x] Observed works / LFL works / Common/Outside works (shared path)
- [x] All families inspected (table above; all call sites use the 3 shared
      components — no family-specific chart code exists)
- [ ] Mobile verified (static only — screenshots pending, see §12)
- [ ] Tablet verified (static only — screenshots pending)
- [ ] Desktop verified (static only — build + reasoning)
- [x] Graph data remains backend-authoritative (no prop/data change)
- [x] No frontend economic math introduced (legend labels/colors only)
- [x] Existing methodology unchanged (no backend/methodology touch)
- [x] lint passes (0 errors, baseline warnings)
- [x] build passes

```text
FINAL STATUS:

CHART RESPONSIVENESS:
PASS (static verification; screenshots pending)

CHART DATA INTEGRITY:
PASS

MOBILE:
PASS (static verification; screenshots pending)

DESKTOP:
PASS (static verification)

REGRESSION:
PASS

COMMIT READY:
YES (from code verification; recommend screenshot pass post-commit when
tooling is available)
```
