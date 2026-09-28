# MOVEMENT POSITION GRAPH — FINAL REMOVAL REPORT

> Complete removal of the old position-movement SlopeChart from Total
> GDP / GDP-per-capita Movement, from the current tree (no reset).
> Presentation-only: `git diff --name-only -- backend/src` is empty.

---

## 1. Why the previous fix was insufficient

The previous cleanup gated the position `SlopeChart` on
`basis === RANKING_BASIS.LEVEL`, deliberately preserving the
level-basis version. The requirement is explicit: the level case is
NOT an exception — no old position slope graph for ANY Total GDP /
GDP-per-capita case. The basis condition has been removed along
with the entire render block.

## 2. Exact legacy render block

`frontend/src/sections/RankMovement.jsx`, generic two-year branch:
the `ChartCard` titled `{focus} position movement, {a} to {b}`
(unit "analytical rank (1 at top)") rendering `SlopeChart` with
`Observed position` (fullRankA→B) and `Like-for-like position`
(commonRankA→B) items, `invertY`. The full conditional block
(including the previous basis gate and its comment) is deleted;
the now-unused `SlopeChart` import is removed from this file.

## 3. Exact current graphs preserved

- Two-year: `BarComparisonChart` level-value chart (same props/data),
  `SummaryCards`, `StorySentence`, duo/partition/facts, tables/cards.
- Growth: `GrowthResults` interval presentation, unchanged.
- Middle-selected: `ThreeYearResults`, unchanged.
- Period: `PeriodSummary`, unchanged.

## 4. Total GDP cases

level/mid-None, level/mid-selected, growth/mid-None,
growth/mid-selected, period_total, period_average — all tested:
no position title/legends/lines; level bar, growth text, and
period headings present where previously supported.

## 5. GDP-per-capita cases

level/mid-None, level/mid-selected, growth/mid-None — all tested
with the same assertions.

## 6. Middle=None behavior

Affected cases render their current graph(s) with zero position
slope: level → bar chart + tables/cards; growth → growth results;
period → period presentation.

## 7. Middle-selected behavior

Unchanged: three-year bar presentation, growth results; no
replacement slope introduced.

## 8. Level-basis verification

Regression tests prove for Total GDP + level + mid-None (and GDP
per capita): no "position movement" text, no Observed/LFL legends,
no `.recharts-line` DOM — while the level-value graph remains.
This is the exact case the previous fix preserved.

## 9. Shared SlopeChart usage elsewhere

`SlopeChart.jsx` is KEPT (not deleted): it remains legitimately
used by `Compare.jsx` (two-point entity trajectory) with its own
title/legend. No other production usage exists.

## 10. Exact files changed

- `frontend/src/sections/RankMovement.jsx` — legacy block +
  import removed (only change).
- `frontend/src/sections/RankMovement.test.jsx` (new) — 8-case
  matrix.

## 11. Exact files untouched

Everything else: `SlopeChart.jsx` and all chart code/theme/CSS,
all subject movement sections, Compare, all other pages, App
shell, config/registry, backend in full (src AND tests), and the
prior round's reports.

## 12. Frontend tests

**96/96** (17 files): 8 new removal-matrix tests (legacy-absent
+ current-present per case).

## 13. Backend diff proof

`git diff --name-only -- backend/src` → empty. Backend suite
**567/568** — single failure is the known pre-existing
`server.test.js:179` refresh-validation env issue.

## 14. lint/build

0 errors, 3 warnings (pre-change baseline); production build passes.

```text
OLD POSITION GRAPH REMOVED COMPLETELY: PASS
TOTAL GDP LEVEL MID-NONE: PASS
GDP PER CAPITA LEVEL MID-NONE: PASS
NON-LEVEL CASES: PASS

CURRENT LEVEL GRAPH PRESERVED: PASS
CURRENT GROWTH GRAPH PRESERVED: PASS
CURRENT PERIOD GRAPH PRESERVED: PASS
MIDDLE-YEAR GRAPH PRESERVED: PASS

OTHER FAMILIES UNCHANGED: PASS
COMPARE UNCHANGED: PASS

ANALYTICAL DATA UNCHANGED: PASS
BACKEND SOURCE UNCHANGED: PASS

TESTS: PASS
LINT: PASS
BUILD: PASS

COMMIT READY: YES
```
