# Out-of-Scope Methodology Findings (recorded, NOT implemented)

Branch: `methodology-redesign`. Task scope is PRICES ONLY. The following were
noticed during the full-codebase audit and are recorded here for separate
methodology decisions. No code was changed for any of them.

## 1. Trade / FDI / Exchange / Current account / Reserves / Remittances / Population
- Current behavior: shared generic engine (`transforms.js` PERIOD_SUM/AVG over
  half-open `[S,E)`, endpoint percent change, ordinal ranking with ISO3
  tie-break, single exclude-focus peer average in growth mode).
- Suspected issue: each family may need its own basis validation exactly as
  Prices did (e.g. signed flows already refuse sign-flip percents correctly,
  but whether period totals vs averages vs endpoint comparisons are the right
  Movement questions per family has no frozen per-family spec in this repo).
- Why separate decision: requires its own canonical file per family (like the
  three Prices files), not an assumption that flow logic generalizes.
- No implementation in this task.

## 2. Shared ordinal ranking (`ranking.js` rank=index+1, ISO3 break)
- Current: GDP and all legacy paths use distinct ordinal positions.
- Canonical Prices requires competition ranking (1,1,3). Implemented ONLY in
  the new Prices module (`pricesMovement.js:rankCompetitionAsc`).
- Whether other families should also move to competition ranking needs its
  own methodology decision; changing the shared engine now would break GDP
  regression (396 passing tests).

## 3. Generic `[S,E)` period interval (`transforms.js:periodYears`)
- Correct for additive flows (disjoint adjacent periods, no double-count).
- Economically wrong for inflation average/cumulative (needs `S+1..E`).
  Prices now uses its own `requiredYearsForPeriod` and never calls
  `periodYears`. Other families keep `[S,E)` pending their own specs.

## 4. Benchmark scope
- Current growth peer average is a single exclude-focus mean, descriptive
  only. Prices now computes per-basis leave-one-out benchmark + PP for every
  eligible economy (ranked), focus excluded, same universe.
- Whether GDP/flows should adopt per-economy LOO context is out of scope.

## 5. Classification vintage
- All group metadata is current retrieved vintage, not historical. Applies
  to any future family-specific group work as well.

## 6. Deleted files in working tree
- `git status` shows `D WDI_ANALYTICS_MASTER_SPEC.md` and
  `D WDI_ANALYTICS_MASTER_SPEC_ADDENDUM.md` (pre-existing working-tree
  deletions vs HEAD, unrelated to this task). Left untouched.
