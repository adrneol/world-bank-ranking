# PHASE 4 — MOVEMENT STATE CONTRACT REPAIR + REFRESH REGRESSION GATE

> Primary: R-01 (StatusBlock contract, six Phase-5 Movement families).
> Secondary: regression-verify Phase-1 R-07/R-12 against CURRENT code.
> Status presentation only. No backend, methodology, ranking, benchmark,
> chart, or dropdown changes.

---

## 1. Scope

- Repair all invalid `StatusBlock` invocations in Prices, Trade, Capital
  Flow, Exchange Rate, External Sector, Population movement views.
- Verify (not rebuild) manual-refresh progress streaming (R-07) and
  generation-keyed integrity caching (R-12) as implemented by Phase 1.
- Add a lightweight contract guard against R-01 recurrence plus focused
  R-07/R-12 regression tests.
- Full regression: backend suite, frontend lint, frontend build.

## 2. Current-state inspection

- Working tree was clean at Phase-3 commit `d92d0ea`; audit/report files
  (`FULL_CODEBASE_FORENSIC_AUDIT.md`, Phase 2/3 reports) read first.
- `StatusBlock` API in `frontend/src/components/ui.jsx` is unchanged:
  `{ loading, error, empty, emptyText, onRetry, sectionName }` — renders
  loading text, error + Retry, or empty text. No `title/message/action`.
- Global grep found exactly the 18 invalid call sites from the audit (3 per
  family file), all still present; every other `StatusBlock` usage in the
  app was already contract-correct.
- R-07/R-12 implementation files (`DataStatus.jsx`, `api/client.js`,
  `hooks/useApi.js`, `services/statusCache.js`, `server.js` data-status
  route) are byte-identical to the Phase-1 commit — Phases 2–3 touched only
  charts/controls. No Phase 1–3 regressions found.

## 3. R-01 root cause confirmation

Confirmed live: each family rendered three `StatusBlock` calls with
nonexistent `title`/`message`/`action` props. Since `StatusBlock`
destructures only its six real props, all three branches evaluated to
`null` — same-year guidance, loading spinners, and API errors with Retry
were invisible in all six families. No other defect was involved.

## 4. Exact files/call sites changed

One identical pattern per family (3 dead sites → 1 contract-correct block):

| File | Lines | Section name |
|---|---|---|
| `frontend/src/sections/PricesMovement.jsx` | ~840 | Prices analysis |
| `frontend/src/sections/TradeMovement.jsx` | ~771 | Trade analysis |
| `frontend/src/sections/CapitalMovement.jsx` | ~831 | Capital Flow analysis |
| `frontend/src/sections/FxMovement.jsx` | ~820 | Exchange Rate analysis |
| `frontend/src/sections/ExternalMovement.jsx` | ~867 | External Sector analysis |
| `frontend/src/sections/PopulationMovement.jsx` | ~844 | Population analysis |

## 5. R-01 implementation

Per family, the three dead calls became one shared-component block —
no new visual language, no duplicated status implementation:

```jsx
{sameYear ? (
  <StatusBlock
    empty
    emptyText="Start and end years must differ for a Movement comparison."
    sectionName="<Family> analysis"
  />
) : (
  <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="<Family> analysis" />
)}
```

- Loading renders `Loading <Family> analysis…`; errors render
  `Could not load <Family> analysis: …` with a working Retry (`onRetry`).
- Same-year/invalid-period renders the intended guidance through the
  existing `empty`/`emptyText` style (a distinct status surface, not an
  error).
- `UnavailableState` for `!data.available`, all controls, charts, basis
  catalogues, Observed/LFL logic, and year handling are untouched.

## 6. R-07 verification result — ALREADY FIXED (PASS, no rewrite)

Verified against current code, then pinned with tests:

- `startRefresh` bumps the status poll **before** awaiting the POST, and
  polling continues while `inProgress || refreshState.running` — progress
  is independent of any first payload.
- `refreshData()` publishes `lastProgress` synchronously on entry
  (`starting → country-metadata → … → complete`); new test observes a
  real stage on the same tick the refresh starts.
- POST bounded at 10 min, status reads at 45 s, slow-load hint + Retry at
  10 s; duplicate submissions blocked (button state + 409 lock + no POST
  retry); auth/429/409 paths intact; success advances `runId`/`dataVersion`
  (asserted live: post-refresh `fingerprint.runId === summary.runId`);
  failed/partial runs publish nothing (existing `ttlRefresh` coverage).
- No code changes made.

## 7. R-12 verification result — ALREADY FIXED (PASS, no redesign)

- `GET /api/data-status` memoizes integrity by refresh-generation key
  (`runId/lastSuccessAt/observationCount`); `/api/integrity` stays
  uncached on-demand validation. Rapid polls in one generation reuse the
  report; only a successful publish (which always advances the key)
  recomputes.
- New test proves failed runs move neither the fingerprint nor the memo
  (memo hit preserved, scan count unchanged).
- No code changes made.

## 8. Tests added/updated

- `backend/test/statusBlockContract.test.js` (new, 3 tests): StatusBlock
  declares exactly the six-prop contract; zero unsupported
  (`title/message/action`/unknown) props on any `StatusBlock` usage
  frontend-wide; each movement family wires `empty/emptyText`,
  `loading/error/onRetry`, and its section name.
- `backend/test/refreshProgressGate.test.js` (new, 3 tests): same-tick
  progress observability on refresh start; live `inProgress` + stage
  streaming via `GET /api/data-status` mid-flight with generation advance
  on completion; failed runs advance neither fingerprint nor memo.
- No existing tests modified. No frontend framework introduced (static +
  backend-level gates, per scope).

## 9. Full test results

- Backend suite: **555/556 pass**. Sole failure is the documented
  pre-existing environment-dependent `server.test.js:179` refresh-auth
  expectation (expects an open endpoint while local `.env` configures
  `REFRESH_ADMIN_TOKEN`) — unrelated, unchanged, still documented.
- New Phase-4 tests: **6/6 pass**. Prior Phase-1/3 backend tests unaffected.

## 10. lint/build results

- Frontend `npm run lint`: **0 errors**, 3 warnings (identical pre-change
  baseline, all pre-existing).
- Frontend `npm run build`: **passes**.

## 11. Regression findings

- None. `git diff` contains only the six movement section files (plus the
  two new test files and this report). No backend source, chart, dropdown,
  methodology, ranking, benchmark, or option-set changes.
- Global searches confirm: no remaining invalid `StatusBlock` props, no
  duplicate refresh implementation, no Phase-3 dropdown or Phase-2 chart
  modifications, no economic calculations introduced, no hard-coded
  analytical values.

## 12. Files changed

```text
M frontend/src/sections/PricesMovement.jsx
M frontend/src/sections/TradeMovement.jsx
M frontend/src/sections/CapitalMovement.jsx
M frontend/src/sections/FxMovement.jsx
M frontend/src/sections/ExternalMovement.jsx
M frontend/src/sections/PopulationMovement.jsx
?? backend/test/statusBlockContract.test.js
?? backend/test/refreshProgressGate.test.js
?? PHASE_4_MOVEMENT_STATE_REFRESH_GATE_REPORT.md
```

## 13. Files intentionally untouched

Backend (`server.js`, `statusCache.js`, services, domain, db), refresh
client/hook (`api/client.js`, `hooks/useApi.js`, `DataStatus.jsx`),
`ui.jsx` contract, all charts, all dropdown/popover code and styles,
registries, methodologies.

## 14. Remaining known limitations

- No browser/DOM tooling exists here, so movement loading/error/same-year
  states were verified statically (JSX + contract gate) rather than by
  screenshot; recommend a visual pass (force each state per family) when
  browser tooling is available.
- `Compare.jsx` deliberately passes `error={null}` with a separate
  `CompareError` surface — works, but remains a contract split to unify
  in a later phase if desired (out of R-01 scope: it was never broken).
- When `sameYear` is selected while a previous error/data exists,
  `useApi`'s disabled path retains them (pre-existing hook behavior,
  unchanged by this phase).

## 15. Final acceptance matrix

- Prices/Trade/CapitalFlow/ExchangeRate/External/Population loading,
  error, unavailable (`UnavailableState` retained), same-year: all reach
  visible shared-design UI — verified per file + gate test.
- Shared contract: no invalid props remain (global grep + gate test).
- Refresh: timeout/recovery, immediate polling, mid-flight progress,
  generation advance, failed/partial preservation — verified + tested.
- Integrity: same-generation reuse, publish invalidation, failed/partial
  stability — verified + tested.

```text
R-01 MOVEMENT STATUS CONTRACT: PASS
R-07 MANUAL REFRESH PROGRESS: ALREADY FIXED
R-12 INTEGRITY CACHE: ALREADY FIXED
REGRESSION: PASS
LINT: PASS
BUILD: PASS
COMMIT READY: YES
```
