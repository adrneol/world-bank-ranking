# FULL CODEBASE FORENSIC AUDIT — READ ONLY

> No production changes made. No code, CSS, API, methodology, TTL, database,
> or behavior was modified. This file is a diagnosis artifact only.
> Audit date (UTC): 2026-09-27. Local DB inspected live (read-only queries);
> backend/frontend source traced statically; tests read, not run (except
> read-only DB introspection via a temp script outside the repo).

---

## 1. Executive summary

- The **backend refresh/TTL pipeline is healthy on the local machine**: the
  SQLite cache holds 228,776 observations across 20 indicators (years
  1960–2025), the last three `fetch_runs` are `status='success'` with
  `trigger='ttl'` on three consecutive days
  (2026-09-25/26/27), and `refresh_locks` is free
  (`locked=0`, `updated_at=2026-09-27T18:55:15Z`). The staged
  fetch→validate→atomic-publish design, dual locking, boot recovery, and
  TTL tests are sound.
- The **"Loading data status…" symptom is a frontend resilience +
  cross-layer notification gap, not a broken backend pipeline** (locally).
  The string is rendered by `StatusBlock` (`frontend/src/components/ui.jsx:21`)
  with `sectionName="data status"` (`DataStatus.jsx:76`) while
  `useApi` `loading=true`. That flag clears **only when the single-shot
  `GET /api/data-status` fetch settles** (`hooks/useApi.js`, `api/client.js`
  `request()`). There is **no fetch timeout, no retry-while-loading, and no
  polling until `data?.inProgress` is already known** — which itself requires
  the first fetch to have completed. Any hung/slow first request (Render cold
  start, stalled network, hung backend) leaves the UI in `Loading…` forever
  with no self-recovery path except unmount.
- The **highest-density defect is a shared `StatusBlock` contract misuse in
  all six Phase-5 movement families** (Prices, Trade, Capital, FX, External,
  Population — 18 call sites): they pass `title/message/action` props that
  `StatusBlock` does not accept, so same-year notices, loading spinners, and
  error panels all render `null`. Users see blank space instead of state.
- **Charts share one fixed-height architecture** (`.chart-body 260px`,
  `220px ≤40rem`, Recharts `ResponsiveContainer height={260}` number) with the
  Recharts `Legend` rendered **inside** the fixed plot area plus an
  `insideLeft` Y-axis unit label and a footer source line outside the body.
  On narrow screens / long units / multi-series legends this produces the
  observed legend/source/plot collisions and clipping. It is architectural
  (shared `ChartCard` + 3 chart components), not family-specific.
- **Dropdowns share one always-down, non-portalled popover** (`.combo-popover
  top: calc(100% + 4px)`, no flip, no viewport-space calculation, `z-index 60`
  inside whatever stacking/overflow context the trigger lives in). Near the
  bottom of a mobile viewport it opens downward off-screen; inside
  `.table-scroll` (`overflow-x:auto`) or other overflow ancestors it can clip.
  The 1960–2025 year list (66 options) relies on a `16rem`/`50vh` inner scroll
  inside a `70vh` bottom sheet — functional but sheet-sized, with no
  virtualization and no scroll-to-selected on open.
- **Stale-data notification is missing cross-layer**: background TTL refresh
  sets only an `X-Auto-Refresh` response header that the frontend never reads
  (`api/client.js` discards headers), and open data pages never revalidate
  after a background refresh completes. Only a manual Status-page refresh
  bumps `dataVersion` and remounts sections.
- **Deployment config is contradictory**: tracked `frontend/.env` bakes
  `VITE_API_BASE_URL=https://world-bank-ranking.onrender.com` into production
  builds despite the repo's own comments saying never to commit that file,
  while `backend/.env` sets `CORS_ORIGINS=http://localhost:5173` only — any
  real deployed frontend origin would fail CORS, and Render free-tier cold
  starts add tens of seconds of first-request latency with no frontend timeout
  messaging to explain it.

---

## 2. Architecture map

### 2.1 Repository layout (actual, verified)

```text
backend/
  src/server.js            Express 5 app factory createApp(), routes, boot()
  src/config.js            single env reader + canonical metric registry (frozen)
  src/db/index.js          node:sqlite singleton + WAL + column migrations
  src/db/repository.js     ALL SQL (countries/indicators/observations/
                           fetch_runs/ingest_year_stats/refresh_locks)
  src/db/schema.sql        5 tables (no cache/TTL table; TTL is derived)
  src/wb/client.js         World Bank HTTP client (pagination, retry, timeout)
  src/wb/ingest.js         refresh pipeline (staged publish, locks, TTL decision)
  src/domain/*             universe, ranking, yoy, movement bases, periods…
  src/services/*           response builders (backend owns ALL economics)
  src/scripts/ingest.js, liveAudit.js, createSnapshot.js
  test/*.test.js           ~45 suites (stub-WB, memory-DB; no browser/e2e)
  data/worldbank.db        live SQLite cache (WAL sidecars present)
frontend/
  src/main.jsx → App.jsx   shell: header, Tabs, global filter bar, lazy-mounted views
  src/api/client.js        ONLY place knowing URLs; fetch + ApiError, no timeout
  src/hooks/useApi.js      AbortController + requestId guard, no timeout/retry
  src/config/metrics.js    display registry + hydrateRegistry() from /api/indicators
  src/components/controls.jsx  SearchableSelect (single custom dropdown)
  src/components/ui.jsx    Section, StatusBlock, Pagination, Field, badges…
  src/components/charts/   ChartCard, TimeSeries/BarComparison/Slope,
                           chartData (adapters), chartFormat, chartTheme
  src/sections/            Overview, YearlyTable, YearComparison, RankMovement,
                           YoyRanking, YoyVerification, Compare, Coverage,
                           AuditSource, DataStatus, *Movement ×6, etc.
  vite.config.js           dev proxy /api → localhost:3001; no prod proxy
  .env (TRACKED)           VITE_API_BASE_URL=https://world-bank-ranking.onrender.com
  .env.development (TRACKED) pins VITE_API_BASE_URL= empty for `vite dev`
  .env.local (UNTRACKED per comment, but present) empty
  dist/                    stale production bundle (index-D6LLhlj6.js)
```

### 2.2 Request/serving paths (traced)

- Backend entry: `node src/server.js` → `boot()` (`server.js:1290`) →
  lock recovery → empty/stale check → `createApp()` → `app.listen(3001)`.
- `createApp({db, autoRefresh})` (`server.js:320`): test seam; production
  default `autoRefresh = config.autoRefreshOnStale` (`WB_AUTO_REFRESH_ON_STALE`,
  default true).
- Auto-refresh middleware (`server.js:336-350`): for `GET` on 29
  `AUTO_REFRESH_PATHS`, calls `maybeAutoRefresh(handle())` fire-and-forget;
  sets `X-Auto-Refresh` header when triggered. Status/integrity/refresh/health
  deliberately excluded.
- Data routes: thin validation (`parseYear/parseMetric/parseFocusCountry/…`)
  → service builders → `{...result, methodology: methodologyBlock()}`.
  Error contract: 400 `{error:{message,code}}`, 409 refresh collision, 404
  unknown, 500 sanitized.
- Frontend entry: `main.jsx` → `App.jsx`: loads `api.years()`,
  `api.countries({includeAggregates:false})`, `api.indicators()` (hydration)
  on `dataVersion`; derives `effective` filters; lazy-mounts one view in
  `<main key={dataVersion:view:country}>`; `handleRefreshed` bumps
  `dataVersion` only after manual Status refresh.

### 2.3 Component inventory (frontend shared)

| Shared element | File | Notes |
|---|---|---|
| `SearchableSelect` | `components/controls.jsx` | all dropdowns; button+popover+listbox, no portal |
| `Field` | `components/ui.jsx:81` | label wrapper (note: `label htmlFor` wrapping non-input button — a11y smell) |
| `StatusBlock` | `components/ui.jsx:21` | props `{loading,error,empty,emptyText,onRetry,sectionName}` ONLY |
| `Section`, `Pagination`, badges, `MethodologyPanel` | `components/ui.jsx` | — |
| `ChartCard` | `components/charts/ChartCard.jsx` | title/unit/source shell, fixed `.chart-body` |
| `TimeSeriesChart` | `components/charts/TimeSeriesChart.jsx` | Recharts, height 260 |
| `BarComparisonChart` | `components/charts/BarComparisonChart.jsx` | single + grouped, height 260 |
| `SlopeChart` | `components/charts/SlopeChart.jsx` | 2-point, height 260 |
| `chartData.js` | adapters | pass-through, null-preserving, no economics |
| `chartTheme.js` | `CHART_HEIGHT=260`, navy/teal palette | single height constant |
| `Tabs`/`SubTabs` | `components/Tabs.jsx` | WAI-ARIA tabs, roving tabindex |
| `FocusPicker`/`MetricPicker`/`EntityPicker` | pickers | thin over `SearchableSelect` + registry |
| `useApi` | `hooks/useApi.js` | abort+requestId, no timeout |
| `api` | `api/client.js` | no timeout, no retry, headers discarded |

---

## 3. Data lifecycle map

```text
World Bank API (api.worldbank.org/v2, open, no key)
 → wb/client.js: fetchAllPages (meta.pages-driven, perPage 20000,
    30s timeout per request, 5 retries exponential+jitter, Retry-After honored,
    completeness asserted vs meta.total, mismatch = hard WorldBankPayloadError)
 → ingest.js STAGING (memory only):
      fetchCountryMetadataPayload → buildUniverse (eligible/aggregate split)
      per metric fetchIndicatorPayload → classifyObservation verdicts
        (eligible | aggregate-stored | null/non-finite/year/blank/unknown…)
      counters: rowsRetrieved/WithValue/Upserted/NullSkipped/NonFinite/
                InvalidYear/BlankIso3/AggregateExcluded/AggregateStored/
                UnknownCountry + per-year ingest_year_stats + pages/requests
 → ATOMIC PUBLISH (single SQLite transaction, publishStagedRefresh):
      upsertCountries → per metric: upsertIndicator →
      deleteObservationsForIndicatorYears(range) → upsertObservations →
      upsertIngestYearStats → finishFetchRun(status='success',
        universe_snapshot JSON, wb_last_updated)
      Partial (any indicator failed): publishes NOTHING; records
        status='partial' + per-indicator errors; previous dataset intact.
      Total failure: nothing published; status='failed'; error.datasetPreserved.
 → SQLite tables (countries/indicators/observations/fetch_runs/…)
 → repository.js readers (eligible-only SQL joins, single-statement year reads)
 → services/* (ranking/yoy/coverage/movement/vintage/attribution…)
 → server.js routes (+ methodologyBlock on every response)
 → frontend api/client.js (transport only) → useApi state
 → section components → ChartCard/charts/tables/cards
```

Refresh lifecycle:

```text
boot: recoverRefreshLock (unconditional release if locked)
 → count observations: 0 + autoIngestOnEmpty → ensureDataPresent (AWAITED boot ingest)
 → else getCacheStatus: stale → maybeAutoRefresh (background, guarded)
request (data GET in AUTO_REFRESH_PATHS): maybeAutoRefresh decision
 → fresh → serve current data, no header
 → stale/empty + guards pass → refreshData({trigger:'ttl'|'boot'}) launched
    WITHOUT await; current request serves current dataset + X-Auto-Refresh
 → frontend ignores header; open pages keep showing old data indefinitely
manual: POST /api/data/refresh (auth? rate-limit?) → AWAITED full refreshData
 → summary JSON → DataStatus onRefreshed → App dataVersion++ → remount all
```

Per-stage file/function/trigger/state table:

| Stage | File:function | Trigger | Success | Failure | Timeout/retry/cache |
|---|---|---|---|---|---|
| WB page fetch | `wb/client.js:fetchJson/getWithRetry` | ingest per indicator | 2xx valid JSON envelope | typed errors; payload errors fail fast | 30s timeout; ≤5 retries + jitter; Retry-After |
| Pagination | `wb/client.js:fetchAllPages` | per series | rows == meta.total | `WorldBankPayloadError` mismatch | per-page progress cb |
| Metadata stage | `ingest.js:fetchCountryMetadataPayload` | refresh start | eligibleCount>0 | throw, run marked failed | — |
| Indicator stage | `ingest.js:fetchIndicatorPayload` | per metric | staged rows | per-metric catch → partial path | warn cb |
| Publish | `ingest.js:publishStagedRefresh` | all staged | transaction commit, run success | rollback, run failed/partial | atomic; reconcile DELETE removes withdrawn WB values |
| Lock acquire | `repository.js:acquireRefreshLock` + mem flag | refresh entry | exactly one winner | `REFRESH_IN_PROGRESS` | finally releases both; boot recovers stale |
| TTL decision | `ingest.js:getCacheStatus/maybeAutoRefresh` | boot + data GETs | `{triggered,reason}` | `status-unavailable` safe | 15-min post-failure cooldown (auto only) |
| Status API | `server.js:1191 GET /api/data-status` | frontend poll/manual | 200 with cache+lock+integrity+runs | 500 sanitized (getCacheStatus throws unwrapped) | no cache headers |
| Frontend fetch | `api/client.js:request` | `useApi` effect | `response.ok` JSON | `ApiError` NETWORK/BAD/REQUEST | **no timeout, no retry** |
| Frontend state | `hooks/useApi.js` | depsKey change | data+loading=false | error+loading=false | abort on change/unmount; stale guard by requestId |

---

## 4. Refresh/TTL lifecycle (detail)

- **TTL definition**: `CACHE_TTL_HOURS` (`config.js:1491`, default 24,
  `backend/.env:45` sets 24). Numeric hours, wall-clock.
- **Authoritative timestamp**: `fetch_runs.completed_at` of latest
  `status='success'` row (`repository.js:getLastSuccessfulFetchTime`).
  NOT `observations.fetched_at`, NOT `wb_last_updated` (vintage), NOT
  `started_at`. Verified live: runs #20/#21/#22 success daily.
- **Evaluation**: server-side only (`getCacheStatus`). Formula
  (`ingest.js:837`): `fresh = obs>0 && ageHours!=null && ttl>0 &&
  ageHours<ttl`; `refreshDue = !fresh`. `ageHours=(now-completed_at)/3.6M`.
  Timezone-safe (ISO-8601 UTC vs `Date.now()`); boundary is strict `<`
  (exactly 24h00m00s counts stale — negligible).
- **After expiry**: next data-GET (or boot) triggers one background
  `refreshData(trigger='ttl')`; current request still serves stale data
  (stale-while-revalidate-like, but **without any frontend revalidation**).
- **Page load after expiry**: same — first data GET triggers background
  refresh; user sees old data with no indicator (header ignored).
- **Simultaneous triggers**: serialized by mem flag + atomic SQLite
  `UPDATE … WHERE locked=0` (`repository.js:840`); losers get
  `REFRESH_IN_PROGRESS`/409 or `already-running` decision. Tests prove single
  refresh under 5 concurrent stale requests (`ttlRefresh.test.js:c`).
- **Refresh failure**: run recorded `failed`/`partial`; published dataset
  untouched; auto triggers cool down 15 min
  (`AUTO_REFRESH_FAIL_COOLDOWN_MS`); manual always retries immediately.
- **WB unavailable**: per-request retry then per-indicator failure → partial
  (publish nothing) or total failure; old data keeps serving.
- **Partial data**: all-or-nothing publish — a partially-fetched refresh
  never becomes the active dataset (`partial` publishes nothing).
- **Fresh again**: only when a `success` run commits (advances
  `MAX(completed_at)`).
- **Frontend notified?**: NO for background refreshes. DataStatus polling
  exists but only reflects `isRefreshInProgress()` while that page is open and
  already loaded; data pages have no polling/subscription.
- **Mismatchodox**: TTL clock (retrieval time) vs WB vintage
  (`wb_last_updated`, per-observation `wb_last_updated`/`fetched_at`): a new
  WB vintage published inside the 24h window is ignored until TTL expiry by
  design (no vintage comparison). No circular logic found; it is a plain
  wall-clock TTL with retrieval-time authority.

---

## 5. Refresh state machine (actual)

Backend states (`fetch_runs.status` + locks + `lastProgress.stage`):

```text
(no row / 0 observations) EMPTY
 → boot with autoIngestOnEmpty → refreshData(trigger='boot') → RUNNING
 → success → FRESH (lastSuccessAt=now)
FRESH --(ageHours>=ttlHours on next data GET / boot)--> STALE (refreshDue=true)
STALE --(maybeAutoRefresh guards pass)--> REFRESHING
      (in-memory refreshInProgress=true + SQLite locked=1 + run 'running'
       + lastProgress.stage: starting→country-metadata→indicator:*→publishing)
REFRESHING → SUCCESS (publish commit, locks released, lastProgress complete)
REFRESHING → PARTIAL (nothing published, locks released, recorded)
REFRESHING → FAILED (nothing published, locks released, recorded, cooldown armed)
FAILED/PARTIAL --(15 min auto cooldown, manual exempt)--> STALE (retry allowed)
SUCCESS → FRESH
```

Frontend `DataStatus` states:

```text
UNKNOWN (loading=true, data=null) --(fetch settles ok)--> IDLE/FRESH-OR-STALE display
UNKNOWN --(fetch settles err)--> ERROR (Retry button)
UNKNOWN --(fetch never settles)--> *** NO EXIT (stuck "Loading data status…") ***
IDLE --(data.inProgress true)--> POLLING (2s timer → pollToken++ → re-fetch)
POLLING --(inProgress false)--> IDLE
manual startRefresh: running=true --(await POST settles)--> running=false + onRefreshed
```

Missing/dead transitions found:

- **UNKNOWN→CHECKING has no timeout exit**: no `setTimeout`, no
  `AbortSignal.timeout`, fetch can pend forever (`client.js:36-48`).
- **No retry-while-loading**: `retry` is only rendered in error state;
  loading state offers no action.
- **Polling gate requires data**: `useEffect([inProgress, pollToken])`
  returns early when `!inProgress`, but `inProgress` comes from `data` — with
  `data=null` (initial hang) no timer ever starts.
- **Manual-refresh progress never streams**: `pollToken` is bumped only
  AFTER the awaited POST resolves; during a minutes-long manual refresh the
  status panel does not poll backend `progress.stage`.
- Data pages (Overview/Rank/Movement/…) have **no STALE→REFRESHING→FRESH
  subscription at all** — the completion event exists only as an ignored
  response header.

---

## 6. Root cause of "Loading data status…"

Exact call chain page-load → text:

```text
App view='status' → <DataStatus onRefreshed> (App.jsx:573)
 → useApi(signal => api.dataStatus({signal}), 'datastatus:0') (DataStatus.jsx:23)
 → api/client.js request('/api/data-status') → fetch(buildUrl(...))
 → useApi: setLoading(true) (hooks/useApi.js:33)
 → StatusBlock loading={true} → <p class="status status-loading">
      "Loading data status…" (ui.jsx:24-26 + DataStatus.jsx:76)
 → clears ONLY in .then/.catch when requestId matches and not aborted
```

Classification (options A–M from the brief):

- **Primary: I (a promise never settles from the UI's perspective) + G
  (frontend polling stops / never starts) + cross-layer notification gap.**
  `request()` has no timeout (`client.js` — no `AbortSignal.timeout`, no
  `timeoutMs` option); `useApi` has no timeout either; the DataStatus poll
  timer is gated on `data?.inProgress`, which is unknowable until the first
  fetch completes. A slow/hung first `GET /api/data-status` (Render cold
  start routinely 30–60s on free tier; any stalled socket; a backend blocked
  in synchronous SQLite/integrity work) therefore pins `loading=true`
  indefinitely with no Retry affordance (Retry renders only on `error`).
- **NOT A** (locally): backend `/api/data-status` completes — local DB is
  fresh, lock free, endpoint is side-effect-free, and `ttlRefresh`/`server`
  tests cover it. Production Render completion could not be verified from
  here (no live probe in a read-only audit) — cold-start latency and the
  CORS mismatch below are the leading production-specific suspects.
- **NOT B** (parse): response schema matches what DataStatus reads
  (`empty/observations/fresh/lastSuccessAt/ageHours/ttlHours/refreshDue/
  inProgress/progress/lock/integrity/autoRefresh/refreshRequiresAuth/
  latestRuns` all present in `server.js:1207-1224`).
- **C/D/E/F/H/J/K also excluded locally**: refresh completes daily
  (runs #20–22), TTL math is correct, auto-trigger works, no stuck lock
  (`locked=0`), no failed-run wedge. The `finally` in `refreshData`
  (`ingest.js:727`) correctly releases both locks even when `startFetchRun`
  throws (regression fix present).
- **Contributing environment factor (L)**: tracked `frontend/.env` bakes the
  Render API URL into builds while the backend allowlists only
  `http://localhost:5173` for CORS. A deployed frontend on any other origin
  gets a CORS-rejected fetch → but that surfaces as `error` (NETWORK_ERROR),
  not infinite loading — unless the preflight itself stalls. The hang path
  and the CORS path are distinct; both are reported below.

Determinism: the **missing-timeout/polling gap is deterministic** (any
sufficiently slow first response reproduces it); whether a given user hits it
is environment-dependent (cold start vs warm backend, network stall vs fast
LAN). No race in the status fetch itself (`requestId` guard is correct).

Root-cause files/functions:

- `frontend/src/api/client.js:request()` — no timeout option, discards
  response headers (kills `X-Auto-Refresh`).
- `frontend/src/hooks/useApi.js` — no timeout, no retry-while-loading,
  `setLoading(false)` only on settle.
- `frontend/src/sections/DataStatus.jsx:27-31` — poll effect gated on
  already-loaded `inProgress`; `refreshOpen` gated on `data` (button hidden
  until load); manual `startRefresh` awaits POST with no timeout/signal.
- `frontend/src/components/ui.jsx:21` — the literal `"Loading data status…"`
  renderer (no timeout fallback).

---

## 7. Cache/TTL findings

- No dedicated cache table; "cache" = live SQLite tables + derived freshness
  from `fetch_runs`. Clean and auditable; no TTL-unit bug (hours consistently,
  `CACHE_TTL_HOURS=24` both `.env` and default).
- `getCacheStatus` is the single freshness decider (spec §34) — good; but its
  throw path in `GET /api/data-status` (`server.js:1193` outside try) turns a
  DB error into 500 rather than a degraded status payload.
- `lastRun: getLatestFetchRun(db,{status:null})` exposes the latest attempt of
  ANY status for the cooldown check — correct.
- Cooldown consults only the single latest run; interleaved success/failure
  histories resolve correctly (success resets).
- Frontend displays `ageHours`/`ttlHours`/`refreshDue` faithfully; never
  decides freshness itself — correct split.

---

## 8. Backend refresh findings

Strengths (verified by reading + live DB + tests): staged all-or-nothing
publish with reconcile DELETE (withdrawn WB values disappear instead of going
stale); per-indicator isolation with `partial` non-publish; universe snapshot
per success run; per-year counters; dual lock with `finally` release; boot
stale-lock recovery; post-failure auto cooldown; rate-limited + optionally
authed manual refresh; `AUTO_REFRESH_PATHS` correctly excludes
health/status/integrity/refresh.

Issues (see §22 for IDs):

- Boot `recoverRefreshLock` releases unconditionally — correct for
  crash recovery on a single host, but unsafe if two live processes share one
  DB file (second host's active lock would be cleared). No fencing token.
- `POST /api/data/refresh` is fully synchronous-awaited full refresh (all 20
  indicators, `WB_PER_PAGE=20000`, 30s×5 per request): minutes-long request
  with no server-sent progress stream; client must hold the connection.
- Rate limiter is in-memory per process (`refreshAttemptLog`) — multi-instance
  deployments enforce per-instance budgets, not global.
- `GET /api/data-status` runs `runIntegrityChecks` synchronously on every
  poll (full-table scans incl. snapshot JSON parse + per-country flag loop);
  on a 228k-row DB this is the heaviest part of the status call and runs
  inside the request handler with no caching. Not a hang locally, but the
  slowest synchronous segment and the likeliest contributor to status latency
  spikes under load or cold page-cache.

---

## 9. Frontend refresh findings

- `X-Auto-Refresh` (`server.js:343`) is set but never consumed anywhere in
  `frontend/src` (grep: zero readers) — the only server→client refresh signal
  is dead on arrival.
- No background-refresh subscription on any data view; `dataVersion` remount
  happens only via manual Status refresh. After a TTL auto-refresh commits,
  open tabs show the previous vintage with no notice until navigation/remount.
- `GET /api/years`, `/api/countries`, `/api/indicators` in `App.jsx` fetch
  once per `dataVersion` with no refresh awareness.
- Manual refresh UX: button hidden until `data` loads (`refreshOpen` false
  while loading); during the awaited POST no status polling occurs
  (pollToken bump post-completion only); `REFRESH_IN_PROGRESS` (409) and 429
  paths are handled with messages — good — but a hung POST has no timeout or
  cancel.
- `handleRefreshed` remounts `<main key>` — correct and complete for manual
  flow; nothing equivalent exists for the automatic flow.

---

## 10. Chart layout findings

Shared architecture (all families, all chart types):

- `ChartCard` (`ChartCard.jsx:9-20`): `figcaption.chart-head` (title+unit+
  badge) → `div.chart-body` (fixed height) → `p.chart-source` footer.
  Intended order title→chart→source is correct in DOM; **legend is NOT in
  this DOM order** — Recharts `<Legend>` renders **inside** the
  `ResponsiveContainer`/SVG area, i.e., inside the fixed-height `.chart-body`.
- `.chart-body{height:260px}` (`index.css:1647`), `220px ≤40rem`
  (`index.css:1670`); charts pass `height={CHART_HEIGHT=260}` (number) to
  `ResponsiveContainer width="100%"`. Fixed pixel plot + in-plot legend +
  `XAxis height 30/52` (bar, angled when >8 rows) + `YAxis width 64` +
  `insideLeft` rotated unit label + `CartesianGrid` + tooltip: as legend wraps
  (2 series on 320–390px), available plot height shrinks inside the fixed
  260/220px box → axis ticks/legend/source crowd and visually collide; long
  `unitLong` strings (e.g. "constant 2021 international $", "local currency
  units per US$ (period average)") widen the Y-axis demand beyond 64px and
  squeeze the plot.
- `overflow:hidden` on `.combo-popover`/`partition` areas does not apply to
  charts, but `.chart-body` has no overflow rule while Recharts clips SVG
  internally — the perceived "text intersecting the plot" is legend/tick/unit
  content laid out inside the fixed SVG viewport, plus the source `<p>`
  sitting 0.35rem below a body that is too short for wrapped head content.
- `BarComparisonChart` grouped mode (`entries=[{x,focus,benchmark}]`,
  `series=[{key:'focus'},{key:'benchmark'}]`) is wired correctly in Prices et
  al.; single mode uses `toBarEntries` null-preserving — data mapping sound.
- `TimeSeriesChart`: `alignSeries` + `connectNulls={false}` correctly breaks
  lines at missing years; `YAxis domain auto/auto`; `tickCount min(8,n)`.
- `SlopeChart`: 2-row LineChart, `reversed={invertY}` for ranks — correct.
- No `height:100%`-without-parent bug (numeric heights used); no portal charts;
  `isAnimationActive={false}` everywhere (deterministic, reduced-motion safe).
- Mobile: 220px body is short for any 2-series legend + angled X labels;
  `.chart-legend` (HTML, `index.css:1596`) is only used by the legacy SVG trend
  chart, not the Recharts cards — inconsistent legend placement between old
  and new charts.

---

## 11. Dropdown findings

`SearchableSelect` (`controls.jsx:36-251`) + `.combo*` CSS:

- Positioning: `.combo-popover{position:absolute; top:calc(100% + 4px);
  left:0; width:max-content; max-width:min(24rem,100vw-2rem)}` — **always
  opens downward**, no flip, no available-space measurement, no portal
  (`rootRef`-relative). Near viewport bottom (the reported mobile case) it
  extends past the viewport; `width:max-content` can also overflow
  horizontally on 320px screens (clamped only by `max-width`).
- Clipping: no portal means any overflow ancestor clips it. Known
  `overflow-x:auto` ancestors: `.table-scroll` (tables), plus
  `overflow:hidden` on `.sr-only/.partition-bar/.partition-common/.combo-value`
  etc. Triggers inside table-heavy movement sections inherit those contexts;
  `z-index:60` beats table sticky cols (`z 1–2`) but loses to `.skip-link`
  (`z 100`) and any transformed ancestor stacking context.
- Mobile sheet (`index.css:1800-1816`, ≤40rem): `position:fixed;
  left/right .75rem; bottom .75rem; max-height:70vh; .combo-list max-height
  50vh`. This is the "dropdown fills the screen" behavior — by design a bottom
  sheet, but for a 66-option year list it is sheet-sized with no
  virtualization; `document.getElementById(activeId)?.scrollIntoView` keeps
  keyboard nav visible, but there is **no scroll-to-selected on open** and no
  `100dvh/svh` handling (see §16).
- Interaction: mousedown-commit-before-blur is correct; click-outside via
  `mousedown` correct; `Escape` handled only in list/input keydown (button
  keydown opens but never closes); no focus trap, no portal focus return
  issues (focus returns to button on commit — good); `Tab` leaves naturally.
- Filter: `showFilter = searchable && count>minFilter(7)` — year/metric lists
  get a filter box (good); short Basis lists don't (good). `minFilter` is
  per-instance, fine.
- Inventory of every dropdown (all `SearchableSelect` unless noted):
  global filter bar (Year start/end, Year, Analysis, Metric via
  `MetricPicker`, Compare-from year-or-empty, Focus via `FocusPicker`);
  Movement controls per family (Focus, Analysis, Metric, Basis, Start/Middle/
  End year, Country-group type/value where supported); Compare workspace
  (EntityPicker country/aggregate selects, operation/mode segmented — not
  dropdowns); relation/sort selects in common/outside tables; native
  `<input type=number>` Neighbors; pagination segmented 25/50/100.
  Keyboard/mobile/collision behavior is identical everywhere (shared
  component) except option-list length and whether a filter box appears.

---

## 12. Mobile responsiveness findings

- Breakpoints are coarse: only `40rem` (640px) and `55rem` (880px). The
  320/360/375/390/414/480 widths all share one rule set; 640–834 share
  another; 1024+ share the base. No 360/390-specific tuning exists, so
  crowding seen at 375px (legend wrap, duo-box stacking, facts 2-col squeeze)
  has no finer remedy in CSS.
- What changes at `40rem`: `.wrap` padding shrinks, `.section` padding
  shrinks, table font/padding shrink, `.facts` → 2 cols, `.section-head`
  column, `.partition-row` single col, `.chart-body` 260→220px, combo →
  bottom sheet, segmented full-width, group-builder chip-list 9→7rem.
  At `55rem`: `.compare-grid` 3-col → 1-col; `.details-panel .dgrid`
  5→2 cols (2→1 at 40rem).
- Tables: all wide tables scroll in `.table-scroll` (correct); sticky first
  col + sticky header have correct z-index; `white-space:nowrap` on `thead th`
  and `.num` forces horizontal scroll rather than wrapping — acceptable and
  deliberate, but numeric relation/effect columns on Prices/Trade common
  tables make those tables the widest on phones.
- Only `RankMovement` tables have a `MobileCardList` card shell
  (`RankMovement.jsx:459`); the six Phase-5 movement families render
  `table-scroll` tables at all widths — phones get full-width scrolled tables
  with no card alternative (inconsistent mobile architecture).
- `.filter-grid` uses `repeat(auto-fit,minmax(8.5–11rem,1fr))` — wraps
  correctly; Movement `filter-grid` forms hold 7–10 controls, so phones stack
  them vertically (long scroll before results, but functional).
- Header/tabs wrap (`flex-wrap`) — tabs scroll-wrap under the title on 320px;
  usable, slightly tall.

---

## 13. All shared component findings

- `StatusBlock` contract is `{loading,error,empty,emptyText,onRetry,
  sectionName}`; the six movement families pass `title/message/action`
  (a different, nonexistent API) — 18 dead call sites (§6/§22 ID
  FAM-STATUS-01). `RankMovement` (both usages), Overview, Coverage, Data,
  Rank, YoY, Compare-loading, Audit use it correctly.
- `Compare.jsx:560` passes `error={null}` deliberately and renders
  `CompareError` separately — works, but splits the error contract and hides
  errors from any future `StatusBlock`-level handling.
- `Field` renders `<label htmlFor>` wrapping arbitrary children including
  `SearchableSelect`'s `<button>` — label-control association is invalid HTML
  when the child isn't the labelled input; screen readers may announce oddly.
- `Pagination` rows-per-page is segmented buttons (good, no dropdown); prev/
  next disable correctly.
- `ProvenanceBadge`/`EntityBadge`/`MethodologyPanel`/`AnalysisHeader` are
  consistent and correct.
- `Tabs` roving-tabindex + arrow keys correct; `SubTabs` lacks arrow-key
  handling (click-only keyboard path beyond Tab) — minor inconsistency.

---

## 14. Family-specific findings

| Family | Metric keys | Basis count | StatusBlock bug | Mobile cards | Notes |
|---|---|---|---|---|---|
| Total GDP / GDP per cap (RankMovement level/growth/period) | 4+4 | 4 generic | No (correct) | Yes (`MobileCardList`) | Reference implementation; charts correct |
| Prices | 3 | 2+3+3 metric-specific | **Yes (3 dead sites)** | No | `displayUnit` strips "(2010=100)" — display-only, fine |
| Trade | 2 | 4+4 | **Yes** | No | Same dead pattern |
| Capital Flow | 2 | 3+3 ranked | **Yes** | No | Same |
| Exchange Rate | 1 | 3 | **Yes** | No | NEUTRAL level correctly unranked; cross-rate offer gated |
| External Sector | 3 | 3/3/4 | **Yes** | No | Same |
| Population | 1 | 3 | **Yes** | No | Stock semantics respected |

Responsive/chart/dropdown problems are **shared, not family-specific**; the
only family-specific divergence is RankMovement's mobile card shell (present)
vs the six families' tables-only mobile (absent), and basis-catalog sizes
(which are correct per methodology).

---

## 15. API/network findings

- Endpoint inventory: ~30 GETs + `POST /api/data/refresh`; all traced in
  `server.js`. No endpoint mismatch: frontend `api.*` paths match backend
  routes exactly (including `/api/focus/yearly` alias + `/api/india/gdp-ranking`
  compat, `/api/prices|trade|capital|fx|external|population/country-groups`).
- No response-schema mismatch on the status path (verified field-by-field);
  movement responses carry `available/reason` + `observed/likeForLike` sets —
  frontend guards `data?.available` correctly.
- No fetch loops: `useApi` depsKeys are stable strings; `App` effects keyed on
  `dataVersion`; DataStatus polls only while `inProgress` (under-polling, not
  looping). Duplicate manual submissions blocked via `refreshState.running`
  + backend 409 + rate limiter.
- Missing: request timeouts everywhere (frontend), `Retry-After` propagation
  to UI on 429 (header set server-side, message generic client-side),
  `X-Auto-Refresh` consumption, `Cache-Control`/ETag on polling endpoints.
- CORS: permissive dev default vs exact-allowlist prod; misconfiguration fails
  closed at boot in production (good) but the committed `frontend/.env` +
  restrictive `backend/.env` pair guarantees a mismatch in any environment
  other than the author's laptop + Render defaults.

---

## 16. Database findings

- Schema (`schema.sql`, 5 tables): `countries` (universe flags),
  `indicators` (registry mirror), `observations` (REAL + `value_raw` TEXT +
  `wb_last_updated` + `fetched_at`), `fetch_runs` (audit trail incl.
  `universe_snapshot` JSON), `ingest_year_stats` (per-run/metric/year
  counters), `refresh_locks` (single-row mutex). Design notes honest about
  double-precision limits. Indexes present on hot paths.
- Freshness authority: latest `success` row's `completed_at`. Lock authority:
  `refresh_locks.locked` + `run_id`/`holder`. Completion record:
  `finishFetchRun` inside the publish transaction (success) or outside it
  (partial/failed audit rows). Crash during fetch → `running` row stays
  forever as audit history (no sweeper), but the **lock** is recovered at boot
  while the orphan `running` row remains — `listFetchRuns` can show a stale
  `running` entry indefinitely (cosmetic; `getCacheStatus` ignores it since it
  keys on `success`).
- `isDatabaseEmpty` = `countObservations===0` — correct.
- WAL mode with fallback try/catch; `applyColumnMigrations` upgrades old DBs
  in place; `value_raw` backfill present. `worldbank.db.pre-phase5` artifact
  and `-shm/-wal` sidecars present in repo dir (live DB files committed
  alongside code — deployment hygiene note, not a runtime bug).
- Can TTL expire mid-refresh? Yes by design: expiry only *starts* a refresh;
  a second trigger while running hits `already-running` and skips. No
  duplicate WB downloads (single-flight proven by test c).
- Can DB freshness advance without frontend notice? Yes — every background
  success does exactly this (see §9).

---

## 17. Concurrency findings

- Two browser tabs / N requests / boot+manual / expiry+request / failure+retry:
  all serialize on the dual lock; losers get 409/`already-running`/cooldown.
  No duplicate downloads; consistent reads (single-statement year reads;
  publish is one transaction).
- Restart mid-refresh: in-memory flag dies with the process; SQLite lock
  recovered at next boot with a log line; staged (unpublished) work is lost
  (correct — nothing published); the `running` audit row orphans (cosmetic).
- Multi-process sharing one DB file: atomic `UPDATE…WHERE locked=0` keeps
  mutual exclusion, but boot recovery on host B can clear host A's live lock
  (no fencing/lease). Single-host deployments (documented setup) unaffected.
- Rate limiter is per-process memory: N instances → N× budget. Noted for
  scaled deployments only.

---

## 18. Accessibility findings

- `SearchableSelect`: `aria-haspopup=listbox`, `aria-expanded`, labelled
  input/listbox, `aria-activedescendant`, keyboard contract mostly complete;
  gaps: popover `role="presentation"` wrapper, no focus trap (acceptable for
  non-modal), Escape-to-close missing on the trigger button, no
  scroll-to-selected on open, `Field` label-wrapping-button invalid
  association, `combo-option-note` truncation (`max-width:45%`, ellipsis)
  hides hint text from sighted users (still in DOM for SR).
- Charts: `ChartCard` has `aria-label` summary (good); Recharts SVG content
  has no data table fallback except Overview's history table — movement
  charts expose values only via tooltip (pointer-only). Low-vision/keyboard
  users get cards + tables, which carry the same backend numbers — acceptable
  but chart-only insights (slope shape) have no textual equivalent.
- `SubTabs` keyboard: Tab-focusable but no arrow-key model (unlike `Tabs`).
- Status/loading regions use `role=status/alert` correctly; `aria-live`
  footnotes present on paginated tables.

---

## 19. Graph-data integrity findings — HEALTHY

Traced backend response → adapter → chart props → render for all three chart
components and all families:

- No hard-coded series, no mock data, no frontend economic math. Adapters
  (`chartData.js`) sort/reshape only; nulls preserved; `connectNulls={false}`;
  bars vanish for null (never zero); formatting (`chartFormat.js` +
  registry `displayDecimals`) is presentation-only.
- Basis/unit/rank/benchmark/Observed-vs-LFL values all arrive precomputed;
  frontend joins/filters/sorts presentation-only with backend ranks preserved
  (`rankOf` helpers never renumber; numeric search matches displayed backend
  rank; sort tie-breaks mirror ISO3 rule).
- Evidence: `TimeSeriesChart.jsx:23-25`, `BarComparisonChart.jsx:14-20`,
  `SlopeChart.jsx:17-24`, `chartData.js:13-68`, movement `build*Sets`
  functions (backend-list joins only).

---

## 20. Error/loading-state findings

- `useApi` correctly resets `error` on new fetch, guards stale responses by
  `requestId`, swallows `AbortError`, cleans up on unmount. Missing
  `finally` is not a bug (both settle branches clear loading) — the hole is
  *no settle at all* (no timeout), plus `enabled=false` path sets
  `loading=false` without clearing stale `data`/`error` (minor: switching to
  a disabled state can show previous data briefly).
- Every data view except the six movement families wires
  `loading/error/retry` correctly. The six families' movement views show
  **nothing** during load/error/same-year (renders `null`) — the most
  user-visible loading-state defect in the app.
- `App.jsx` years-load failure shows error + Retry (good); countries failure
  silently falls back to `{countries:[]}` then `FocusPicker` degrades to a
  raw ISO3 input (good fail-safe); indicators failure keeps static registry
  (good).
- Errors swallowed: `maybeAutoRefresh` middleware try/catch (deliberate —
  logged via `onWarn`); `App` countries/indicators catches (deliberate
  fallbacks); `Compare` splits error display (deliberate but inconsistent).

---

## 21. Breakpoint findings

Matrix (only two breakpoints exist: `40rem`, `55rem`):

| Width | Behavior | Verdict |
|---|---|---|
| 320/360/375/390/414 | `40rem` rules: bottom-sheet dropdowns, 220px charts, 2-col facts, stacked section heads, scrolled tables | Crowded but functional; chart legend+unit+source collision most visible here |
| 480/640 | Same `40rem` set until 640 | Filters wrap 2–3 across; duo-boxes wrap |
| 768/834 | Base + `55rem` compare collapse | Comfortable; tables still scroll |
| 1024/1280/1440 | Base layout, `76rem` max-width wrap | Healthy |

No suspicious *wrong* breakpoint (nothing triggers at an absurd width); the
finding is coarseness + the 220px chart height interacting with in-plot
legends at the smallest widths.

---

## 22. Prioritized issue list

For every issue: `Production change made: NO`.

### ISSUE R-01 — Movement loading/error states render nothing (shared, 6 families)

- Severity: **HIGH**
- Component/file: `PricesMovement.jsx:840-843`, `TradeMovement.jsx:771-774`,
  `CapitalMovement.jsx:831-834`, `FxMovement.jsx:820-823`,
  `ExternalMovement.jsx:867-870`, `PopulationMovement.jsx:844-847` (18 sites)
  vs `StatusBlock` contract `components/ui.jsx:21`.
- Observed symptom: same-year selection, loading spinner, and error panel
  never appear in any Phase-5 movement view; blank space instead.
- Root cause: props `title/message/action` do not exist on `StatusBlock`
  (accepts `loading/error/empty/emptyText/onRetry/sectionName`); all three
  conditionals evaluate to `null`.
- Evidence: grep `StatusBlock title=` hits exactly those 6 files × 3;
  `RankMovement`/`Overview`/others use the correct props and render.
- Affected pages: Movement view for Prices, Trade, Capital Flow, Exchange
  Rate, External Sector, Population.
- Affected families: prices, trade, capital_flows, exchange, external,
  population. Shared.
- Confidence: Certain (static prop mismatch, no runtime path renders).
- Recommended fix direction: replace with correct-props `StatusBlock`
  (loading/error/empty + sectionName) or a dedicated movement state
  component; add a lint/test asserting no unknown `StatusBlock` props.
- Production change made: NO.

### ISSUE R-02 — "Loading data status…" can persist indefinitely (no timeout/poll/retry-while-loading)

- Severity: **HIGH**
- Component/file: `frontend/src/api/client.js:36-48` (`request`, no timeout,
  headers discarded); `frontend/src/hooks/useApi.js:16-57` (no timeout, clears
  loading only on settle); `frontend/src/sections/DataStatus.jsx:23-31`
  (poll gated on loaded `inProgress`; button hidden until `data`).
- Observed symptom: Status page stuck on "Loading data status…" with no
  recovery action.
- Root cause: single-shot fetch with no deadline + polling that requires the
  very data it waits for + Retry rendered only in error state.
- Evidence: code paths traced end-to-end (§6); local backend completes, so any
  observed hang is this frontend gap meeting a slow first response.
- Affected pages: Status (and, in slow-network cases, first paint of every
  `useApi` view — others at least offer Retry on error).
- Affected families: all (infrastructure). Shared.
- Confidence: High.
- Recommended fix direction: `AbortSignal.timeout` (e.g. 15–20s) + timed
  re-poll while `loading` + inline Retry-while-loading + surface HTTP status
  in the loading hint; keep backend unchanged.
- Production change made: NO.

### ISSUE R-03 — Production API URL baked in + CORS allowlist mismatch + cold-start latency

- Severity: **HIGH**
- Component/file: `frontend/.env:7` (tracked, contradicts its own header
  comment + `.env.development` design); `backend/.env:59`
  (`CORS_ORIGINS=http://localhost:5173`); `backend/src/config.js:1502`;
  `frontend/src/api/client.js:15` (build-time `VITE_API_BASE_URL`).
- Observed symptom: deployed frontend either calls the wrong backend or is
  CORS-rejected; first status load hangs through Render cold start with no
  explanatory UI.
- Root cause: build-time base URL committed to VCS; allowlist covers dev only.
- Evidence: file contents; `dist/` bundle ships the Render URL; boot
  fail-closed requires explicit prod env that the repo does not document per
  environment.
- Affected pages: all (production only). Shared.
- Confidence: High (config) / Medium (cold-start contribution unprobed live).
- Recommended fix direction: untrack `frontend/.env`, inject
  `VITE_API_BASE_URL` per environment at build/deploy, set `CORS_ORIGINS` per
  environment, add first-load "warming up the API…" messaging with timeout.
- Production change made: NO.

### ISSUE R-04 — Background auto-refresh completion never reaches open UI (dead header, no revalidation)

- Severity: **HIGH**
- Component/file: `backend/src/server.js:343` (sets `X-Auto-Refresh`);
  `frontend/src/api/client.js:36-67` (headers discarded); `App.jsx:352-366`
  (`dataVersion` only bumped by manual refresh).
- Observed symptom: after TTL auto-refresh commits, open tabs keep showing
  the previous vintage indefinitely with no notice.
- Root cause: the sole server→client refresh signal is ignored; no
  polling/subscription/revalidation exists on data views.
- Evidence: zero readers of `X-Auto-Refresh` in `frontend/src` (grep);
  `ttlRefresh.test.js` proves server-side freshness restores while frontend
  has no hook for it.
- Affected pages: Overview/Data/Rank/Movement/YoY/Compare/Coverage/Audit.
  Shared. Confidence: Certain.
- Recommended fix direction: expose refresh generation in a lightweight
  pollable field (`GET /api/data-status` fingerprint already exists:
  `runId/maxFetchedAt`) and revalidate `years`/view queries when it advances;
  or return the header via the client and handle it per response.
- Production change made: NO.

### ISSUE R-05 — Fixed-height chart cards collide legend/ticks/source on narrow screens

- Severity: **HIGH**
- Component/file: `frontend/src/index.css:1647-1674` (`.chart-body` 260/220px);
  `chartTheme.js:19`; `TimeSeries/BarComparison/SlopeChart.jsx`
  (`ResponsiveContainer height={260}` + in-plot `<Legend>` + `insideLeft` unit
  + `YAxis width 64`).
- Observed symptom: text/source/legend intersecting the plot area (screenshots
  A/B); clipped wrapped legends on 320–414px.
- Root cause: fixed pixel plot box shared by plot + legend + axis chrome, with
  the source footer outside the box; wrapping content has nowhere to go.
- Evidence: DOM order (`ChartCard.jsx`) vs Recharts legend mounting;
  single height constant for all types; `barCategoryGap`, angled `XAxis`
  heights, long `unitLong` strings.
- Affected pages: every view rendering `ChartCard` (Overview history, all
  Movement observed/LFL charts, Compare trajectories). Shared.
- Confidence: High.
- Recommended fix direction: measure-and-grow card (legend-aware heights,
  `min-height` + auto), move legend to HTML below the body (like
  `.chart-legend`), shorten/ellipsize axis units with full text in tooltip.
- Production change made: NO.

### ISSUE R-06 — Dropdown popover always opens downward, unflipped, unportalled

- Severity: **HIGH**
- Component/file: `components/controls.jsx:160-247`; `index.css:1211-1246`
  (absolute `top:100%`), `1800-1816` (mobile fixed sheet).
- Observed symptom: bottom-of-viewport dropdowns open off-screen (screenshot
  C); clipping inside scrolled ancestors; year list sheet-fills mobile
  (screenshot D).
- Root cause: no available-space/flip logic, no portal, `width:max-content`.
- Evidence: zero viewport-measurement code in `controls.jsx`; `position` grep
  hits only the two rules above; `z-index:60` inside local stacking contexts.
- Affected pages: all filter/control surfaces (global bar, Movement controls,
  Compare builders, table relation/sort selects). Shared.
- Confidence: High.
- Recommended fix direction: flip-aware positioning (open up when space
  below < needed), portal to `body` with focus management, `max-height`
  relative to visual viewport, scroll-selected-into-view on open.
- Production change made: NO.

### ISSUE R-07 — Manual refresh is a minutes-long awaited POST with no progress streaming

- Severity: **MEDIUM**
- Component/file: `backend/src/server.js:1234` (`await refreshData` full 20
  indicators); `DataStatus.jsx:33-51` (awaits POST, bumps poll only after).
- Observed symptom: "Refreshing…" with no stage updates; connection must be
  held open; browser/proxy timeouts possible on slow networks.
- Root cause: no progress channel wired during the awaited call
  (`progress.stage` exists server-side via `getIngestProgress` but is polled
  only when `inProgress` already known).
- Evidence: `refreshData` publishes `lastProgress` per stage; DataStatus poll
  effect cannot run pre-first-load or mid-POST.
- Affected pages: Status. All families (full refresh). Shared.
- Confidence: High.
- Recommended fix direction: start-polling immediately on click (independent
  of `data`), poll `GET /api/data-status` for `progress.stage` during POST,
  add client timeout + cancel; optionally make POST return 202 + poll.
- Production change made: NO.

### ISSUE R-08 — Phase-5 movement tables have no mobile card shell (RankMovement does)

- Severity: **MEDIUM**
- Component/file: `RankMovement.jsx:459 MobileCardList` + `useIsMobile`
  vs `Prices/Trade/Capital/Fx/External/PopulationMovement.jsx` common/outside
  tables (always `table-scroll`).
- Observed symptom: phones get wide scrolled tables with no card alternative
  in six families; `RankMovement` degrades gracefully.
- Root cause: mobile shell built once for level-movement tables, never
  generalized.
- Evidence: `useIsMobile`/`MobileCardList` defined only in `RankMovement.jsx`;
  no imports elsewhere.
- Affected families: prices, trade, capital_flows, exchange, external,
  population. Shared omission.
- Confidence: High.
- Recommended fix direction: extract `MobileCardList` + breakpoint hook to
  shared components; adopt per family.
- Production change made: NO.

### ISSUE R-09 — 66-option year lists: no virtualization, no scroll-to-selected, vh-based sheet

- Severity: **MEDIUM**
- Component/file: `controls.jsx:238-246` (`.combo-list max-height:16rem`,
  full render of all options); `index.css:1809-1815` (`70vh`/`50vh`).
- Observed symptom: year selector dominates mobile viewport; long scroll to
  reach 2025 from 1960 ordering.
- Root cause: full-list render + sheet-sized container + no initial scroll
  position management.
- Evidence: `(years??[]).map(...)` in `App.jsx:60`/`RankMovement.jsx:103` etc.;
  no virtualization dependency in `package.json`.
- Affected pages: every year/start/middle/end picker. Shared.
- Confidence: High.
- Recommended fix direction: scroll selected into view on open, consider
  descending order or type-ahead emphasis for years, cap sheet with
  `dvh`-aware units.
- Production change made: NO.

### ISSUE R-10 — Viewport units ignore mobile browser chrome (`vh` without `dvh`/`svh`)

- Severity: **MEDIUM**
- Component/file: `index.css:1809` (`max-height:70vh`), `1815` (`50vh`).
  No `dvh/svh/lvh`/visual-viewport code anywhere (grep: zero hits).
- Observed symptom: bottom sheet height mismeasured as the address bar
  shows/hides; keyboard-open states can push the sheet off-screen.
- Root cause: layout viewport units used for an overlay anchored to the
  visual viewport.
- Evidence: grep `100vh|100dvh|100svh` hits only the two `vh` rules above.
- Affected pages: mobile dropdown sheets. Shared.
- Confidence: Medium.
- Recommended fix direction: `dvh` with `vh` fallback + `visualViewport`
  resize handling + body scroll-lock scoping.
- Production change made: NO.

### ISSUE R-11 — Boot lock recovery is unconditional (multi-instance hazard)

- Severity: **MEDIUM**
- Component/file: `backend/src/server.js:1306-1315`;
  `db/repository.js:865 forceReleaseRefreshLock`; `wb/ingest.js:347`.
- Observed symptom (latent): two live processes sharing one DB file — one's
  boot clears the other's active refresh lock; both fetch from WB.
- Root cause: no fencing token/lease/expiry check; any `locked=1` at boot is
  assumed stale.
- Evidence: recovery path reads `holder` for logging only, never validates
  liveness or age.
- Affected: scaled/multi-instance deployments only. Architectural.
- Confidence: Medium.
- Recommended fix direction: lease with heartbeat + stale-age threshold, or
  document single-writer requirement and refuse second writer.
- Production change made: NO.

### ISSUE R-12 — `GET /api/data-status` does synchronous full integrity scan per call

- Severity: **MEDIUM**
- Component/file: `server.js:1200-1206` → `services/integrity.js:37+`
  (full-table counts, snapshot parse, per-country flag loop) on every status
  poll.
- Observed symptom: status latency spikes (contributes to R-02 hangs under
  load/cold cache); wasted work on 2s polls during refresh.
- Root cause: no caching/memoization of the integrity report within a refresh
  generation.
- Evidence: synchronous `DatabaseSync` calls in request handler; heaviest
  synchronous segment of the status route.
- Affected pages: Status. Shared.
- Confidence: Medium.
- Recommended fix direction: cache integrity per `runId`/generation with short
  TTL, or move to a dedicated endpoint polled less often.
- Production change made: NO.

### ISSUE R-13 — Accessibility gaps in shared controls

- Severity: **MEDIUM**
- Component/file: `controls.jsx`, `ui.jsx:81 Field`, `Tabs.jsx:66 SubTabs`,
  movement charts (tooltip-only values).
- Observed symptom: label-association invalidity, trigger-Escape gap, subtabs
  without arrow-key model, chart shape with no textual equivalent.
- Root cause: additive feature work without shared a11y contract tests; no
  frontend tests exist at all (`package.json` has no test script).
- Evidence: static code read; zero frontend test files (glob).
- Affected pages: all. Shared.
- Confidence: Medium.
- Recommended fix direction: fix `Field` association, add trigger-Escape,
  unify tab keyboard models, add chart data-table fallbacks, add component
  tests.
- Production change made: NO.

### ISSUE R-14 — Wall-clock TTL ignores World Bank vintage (up to 24h stale by design)

- Severity: **LOW**
- Component/file: `wb/ingest.js:837 getCacheStatus`; `config.js:1491`.
- Observed symptom: new WB vintage published mid-window is not picked up until
  TTL expiry; UI "vintage" line shows retrieval time (correctly labelled).
- Root cause: no lightweight vintage check (e.g. HEAD/indicator `lastupdated`
  probe); TTL is the only signal — a deliberate simplicity trade-off.
- Evidence: no `lastupdated` comparison outside full refresh; runs show daily
  cadence regardless of WB publishing.
- Affected: all families. Shared. Confidence: High.
- Recommended fix direction (optional): cheap vintage probe to trigger early
  refresh; keep TTL as backstop.
- Production change made: NO.

### ISSUE R-15 — Coarse breakpoints + minor visual inconsistencies

- Severity: **LOW**
- Component/file: `index.css` (`40rem`/`55rem` only); `Compare.jsx:560`
  (`error={null}` split); `.table .num nowrap`; `dist/` stale bundle.
- Observed symptom: no 360/390-specific tuning; Compare error path diverges
  from the shared contract; `dist/` may not match `src`.
- Root cause: minimal breakpoint set; one-off error handling; checked-in build
  output.
- Evidence: media-query grep; `dist/assets/index-D6LLhlj6.js` vs current src.
- Affected: all (cosmetic). Shared. Confidence: Medium.
- Recommended fix direction: add 26rem/48rem tuning points if needed after
  R-05/R-06 fixes; unify Compare error display; stop tracking `dist/`
  (or rebuild on release).
- Production change made: NO.

---

## 23. Recommended repair order (technical impact first)

1. **R-01** movement `StatusBlock` props (18 sites, one pattern — restores all
   loading/error visibility; cheapest, highest UX yield).
2. **R-02** status-fetch timeout + loading poll + retry-while-loading (kills
   the reported stuck state deterministically).
3. **R-06** dropdown flip + portal + viewport-aware max-height (fixes mobile
   usability for every picker including years).
4. **R-05** legend-aware chart heights + HTML legend below plot (fixes both
   screenshot collision classes at the shared root).
5. **R-04** refresh-generation revalidation (consume fingerprint/`X-Auto-Refresh`;
   ends silent staleness after background TTL runs).
6. **R-03** deployment config (untrack `frontend/.env`, per-env API URL +
   CORS, cold-start messaging).
7. **R-07** manual-refresh progress polling + POST timeout/cancel.
8. **R-12** integrity-scan caching for the status route (reduces the latency
   that feeds R-02).
9. **R-08** generalize `MobileCardList` to the six families.
10. **R-09 + R-10** year-list scroll-to-selected + `dvh`-aware sheet.
11. **R-11** lock fencing/lease (only if multi-instance is ever planned).
12. **R-13** a11y contract fixes + first frontend component tests.
13. **R-14/R-15** vintage-aware TTL + breakpoint polish (optional, last).

---

## Appendix A — TTL semantics answers (one-line)

- TTL means: wall-clock freshness window (24h) since last **successful**
  retrieval commit. Defined in `backend/.env:45` → `config.js:1491`.
  Authoritative timestamp: `fetch_runs.completed_at` (latest `success`).
  Evaluated server-side only. Auto-refresh begins on the next data-GET/boot
  after expiry (background, single-flight). Page load after expiry serves
  stale data + triggers background refresh. Concurrent triggers share one
  run. Failure/partial publishes nothing; previous dataset stays; auto
  retries cool down 15 min. Fresh again only on next `success`. Frontend is
  NOT notified of background completion. No blocking refresh (stale served).
  No vintage comparison — TTL clock and WB vintage can disagree by design.

## Appendix B — State machine (ASCII)

```text
[EMPTY] --boot ingest--> [RUNNING] --success--> [FRESH]
[FRESH] --age>=TTL--> [STALE] --trigger--> [RUNNING] --success--> [FRESH]
[RUNNING] --partial/fail--> [STALE'] (recorded, cooldown)
UI: [LOADING] --settle ok--> [SHOW] / --settle err--> [ERROR]
    [LOADING] --never settles--> [LOADING] (STUCK: no timeout edge)
```

## Appendix C — "Loading data status…" verdict (13 questions)

1. Why the text? `StatusBlock loading=true` while `useApi` pending (§6 chain).
2. Backend completing? Locally yes (fresh DB, free lock, covered by tests).
3. Frontend request completing? Only if network/backend deliver promptly;
   no timeout means hangs surface as infinite loading.
4. TTL expiry detected? Yes, server-side (`getCacheStatus`).
5. Expiry triggers refresh? Yes (`maybeAutoRefresh`, guarded, proven daily).
6. Refresh executes? Yes (runs #20–22 `ttl/success`).
7. Completes? Yes locally.
8. Persisted? Yes (`fetch_runs` + 228,776 observations).
9. Frontend notified? **No** (header ignored, no revalidation).
10. Missing/stuck transition? `LOADING` has no timeout exit; background
    completion has no UI edge.
11. Layer? **Cross-layer**: healthy backend pipeline + fragile frontend
    waiting/notification.
12. Deterministic or race? Deterministic gaps; environment-dependent trigger.
13. Exact root files? `frontend/src/api/client.js:request`,
    `frontend/src/hooks/useApi.js`, `frontend/src/sections/DataStatus.jsx:27`,
    `frontend/src/components/ui.jsx:21`.

## Appendix D — Counts & health board

- Backend suites present: ~45 files incl. `ttlRefresh`, `refreshLock`,
  `refreshHardening`, `refreshRateLimit`, `refreshSecurity`, `wbClient`,
  `ingest`, `server`, per-family API/movement suites. No browser/e2e tests.
  Frontend tests: none.
- Live local DB (read-only): 228,776 obs · 20 indicators · years 1960–2025 ·
  last success run #22 `2026-09-27T18:55:14Z` (`ttl`) · lock free.

---

## FINAL SUMMARY

```text
CODEBASE AUDIT: COMPLETE
CRITICAL ISSUES: 0
HIGH ISSUES: 6
MEDIUM ISSUES: 7
LOW ISSUES: 2
REFRESH/TTL: PROBLEM FOUND (frontend waiting/notification + deploy config;
             backend pipeline itself HEALTHY locally)
FRONTEND RESPONSIVENESS: PROBLEMS FOUND
CHART SYSTEM: PROBLEMS FOUND
DROPDOWN SYSTEM: PROBLEMS FOUND
API/DATA FLOW: PROBLEMS FOUND (stale-notification gap; contracts otherwise healthy)
CACHE: HEALTHY (local verification)
CONCURRENCY: HEALTHY (single-host; multi-instance lease noted)
GRAPH DATA INTEGRITY: HEALTHY
NO PRODUCTION CHANGES MADE: YES
```

**TOP 10 issues to fix first (technical impact order):**

1. R-01 — Movement `StatusBlock` prop mismatch (18 dead loading/error sites).
2. R-02 — Status fetch timeout + loading poll + retry (ends stuck "Loading…").
3. R-06 — Dropdown flip/portal/viewport-aware sizing (mobile usability).
4. R-05 — Legend-aware chart heights + HTML legend (overlap collisions).
5. R-04 — Background-refresh revalidation (ends silent staleness).
6. R-03 — Per-env API URL + CORS + cold-start messaging.
7. R-07 — Manual-refresh progress polling + POST timeout/cancel.
8. R-12 — Cache the status-route integrity scan.
9. R-08 — Generalize mobile card lists to all movement families.
10. R-09/R-10 — Year-list scroll-to-selected + `dvh`-aware bottom sheet.

*None of the above were fixed in this task. The next implementation phase
should take them in this order; R-01 + R-02 alone resolve the two most
user-visible symptom classes (blank movement states, stuck status).*
