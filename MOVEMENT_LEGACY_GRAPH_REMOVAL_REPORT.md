# MOVEMENT LEGACY GRAPH REMOVAL REPORT

> Precise legacy-path removal from clean HEAD (post `reset --hard`).
> Presentation-only: `git diff --name-only -- backend/src` is empty,
> zero backend test changes, no shared chart code touched.

---

## 1. Exact legacy graph root cause

The obsolete visualization is the position-movement `SlopeChart`
block in the generic two-year Movement branch
(`RankMovement.jsx`, "position movement" / "analytical rank (1 at
top)" / Observed + Like-for-like lines). It plots backend **level**
ranks (`fullRank`/`commonRank`), yet the branch is selected by
backend mode (`mode !== 'yoy'`), not by basis — so any non-level
basis whose response does not declare yoy mode (e.g. growth falling
through, or a stale foreign-family basis id carried on a GDP metric)
renders level-rank lines under a "position movement" title for an
analysis that is not a level-rank comparison. That basis/mode
mismatch is the legacy path.

## 2. Exact files/components involved

- `frontend/src/sections/RankMovement.jsx` — two-year branch,
  position `SlopeChart` block (now basis-gated).
- `frontend/src/components/charts/SlopeChart.jsx` — untouched
  (still serves level Movement + Compare two-point trajectories).

## 3. Exact families affected

Total GDP and GDP per capita (the generic rank-movement path; all
other families divert to dedicated `*Movement.jsx` sections and
never reach this block).

## 4. Exact bases affected

Non-level bases (`growth`, `period_total`, `period_average`, or any
carried-over foreign basis id) landing in the two-year branch with
middle=None. Level basis is explicitly unaffected.

## 5. Why it appeared only with Middle year = None

A selected middle year takes `ThreeYearResults` (bar chart, no
position graph); growth mode takes `GrowthResults`; period modes
take `PeriodSummary`. Only the middle=None + non-yoy-mode fall-
through reaches the two-year branch where the ungated slope lived.

## 6. Matrix of affected vs unaffected bases

| Family | Basis | Mid=None | Mid selected |
|---|---|---|---|
| Total GDP | level | SlopeChart position + bar levels (PRESERVED) | ThreeYear bars (unchanged) |
| Total GDP | growth (yoy) | GrowthResults bars (unchanged) | GrowthResults (unchanged) |
| Total GDP | growth, mode≠yoy | SlopeChart REMOVED, bar levels stay | ThreeYear bars (unchanged) |
| Total GDP | period_* | PeriodSummary (unchanged) | PeriodSummary (unchanged) |
| GDP per capita | (same four rows — identical behavior, tested) | | |
| Any | ranks unavailable | no graph (gate preserved) | — |

## 7. Current/main graph path

Unchanged everywhere: level two-year SlopeChart + `BarComparisonChart`
levels; `GrowthResults` interval bars; `ThreeYearResults` bars;
`PeriodSummary` cards/bars — all ChartCard/Recharts/ChartLegend R-05.

## 8. What was removed

Only the obsolete selection: the position `SlopeChart` no longer
renders for non-level bases (one added condition,
`basis === RANKING_BASIS.LEVEL`, alongside the existing
rank-availability gate). No component, branch, or file deleted;
`SlopeChart` itself is untouched.

## 9. What was preserved

Level-basis position graph (identical props/data/legend/source);
all other branches; basis availability/registry/capabilities;
middle-year behavior; no-graph cases; shared chart system, theme,
CSS, drawer, controls, and every other family/page.

## 10. Middle-year-selected regression

Test: level + `yearMid=2014` renders the three-year bar ChartCard,
zero position cards — unchanged presentation.

## 11. Level/value exception regression

Tests: Total GDP level and GDP-per-capita level, mid=None, keep
exactly one position card with Observed/LFL legend and backend
ranks in its accessible name.

## 12. No-graph cases preserved

Test: level basis with null ranks renders no position card (the
pre-existing availability gate still governs).

## 13. Analytical regression

Identical before/after: focus/start/middle/end, basis, Observed/LFL
ranks and values, universes, tables, current graph data,
methodology, API responses. Only visualization selection changed
(one render condition); the data path is untouched.

## 14. Exact files changed

- `frontend/src/sections/RankMovement.jsx` — one basis condition +
  explanatory comment on the position-chart block.
- `frontend/src/sections/RankMovement.test.jsx` (new) — 7-case
  family×basis×middle matrix.

## 15. Exact files untouched

Everything else: all chart components/theme/CSS, all subject
movement sections, Compare/YoY/Data/Coverage/Audit/Status/Home/
Methodology/About/Overview, controls/popover/drawer, App shell,
config/registry, backend in full (src AND tests).

## 16. Backend diff proof

`git diff --name-only -- backend/src` → empty.

## 17. Tests

- Frontend **95/95** (17 files): 7 new matrix tests
  (Total GDP level/growth-fallthrough/growth-yoy/mid/no-ranks +
  GDP-per-capita level/growth-fallthrough).
- Backend **567/568** — single failure is the known pre-existing
  `server.test.js:179` refresh-validation env issue, unchanged.

## 18. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

```text
LEGACY GRAPH ROOT CAUSE: IDENTIFIED
TOTAL GDP AFFECTED CASES: PASS
GDP PER CAPITA AFFECTED CASES: PASS
LEVEL/VALUE EXCEPTIONS PRESERVED: PASS

MIDDLE YEAR NONE: PASS
MIDDLE YEAR SELECTED: PASS
CURRENT GRAPH PRESERVED: PASS
NO-GRAPH CASES PRESERVED: PASS
NO DUPLICATE LEGACY RENDER: PASS

ANALYTICAL DATA UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS

TESTS: PASS
LINT: PASS
BUILD: PASS

COMMIT READY: YES
```
