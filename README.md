# World Bank WDI Economic Data Analysis

> **Release line: v3.1.0** (previous release: v3.0.1). See `RELEASE_v3.1.0.md`
> for the release record, verified performance numbers, and the production
> operator checklist.

A data-verification application that retrieves World Bank World Development
Indicators (WDI) and independently calculates yearly values,
year-over-year change, rank, and denominator for twenty indicators grouped
into eight analysis subjects: GDP per capita (four indicators), Total GDP
(four indicators), Prices (three), Trade (two), Capital flows (two), Exchange
rates (one), External sector (three) and Population (one). The default focus
country is India, but any eligible country, official World Bank aggregate, or
user-defined group can be analyzed — the product identity is generic, not
country-specific. Every subject flows
through the same generic ranking / YoY / comparison engines; each metric keeps
its own independent ranking and denominator, and subjects are never mixed in
one panel. Non-GDP families carry explicit semantic metadata (rate vs
percentage-point change, index points, signed flows, quotation conventions)
so different economics never inherit GDP mathematics.

> The World Bank provides the underlying observations. Historical country ranks
> shown by this application are calculated by this application from those
> observations.

## Overview

For each of twenty World Bank indicators (four GDP-per-capita, four Total GDP,
three Prices, two Trade, two Capital flows, one Exchange rate, three External
sector, one Population), the application ingests official World Bank
observations — country observations plus officially published World Bank
aggregate observations, typed by metadata and never mixed — ranks every
eligible country/economy by raw value, and
shows exactly where India stands — with the raw numbers, the neighboring
countries, and the audit trail needed to verify each result. Official
aggregates never enter country rankings; they are comparable as published
entities through the generic entity-compare API. A React frontend
presents the results; an Express API serves backend-calculated numbers;
Turso Cloud stores the retrieved observations in production, with local
SQLite as the development and controlled-fallback database. The frontend's Analysis selector
switches the active subject (metric/subject lists hydrate from backend
metadata); the metric key
(`?metric=…`) remains the single source of truth, so existing per-capita URLs
keep working unchanged. Stored coverage reaches back to 1960 for non-PPP
series (1990 for PPP series) and the year selector is always derived from
actually stored World Bank years, so a newly published World Bank year becomes
selectable after refresh with no code change.

## Features

- Twenty World Bank indicators in eight subjects (GDP per capita, Total GDP, Prices, Trade, Capital flows, Exchange rates, External sector, Population), each ranked independently
- India yearly table: value, YoY % (only where the metric declares it), rank and denominator per year and metric
- Year-range filtering and selected-year comparison
- Level rank verification with configurable neighbor windows
- Full country ranking with pagination and search by country, ISO3, or exact analytical rank
- Separate YoY ranking with its own denominator, plus YoY verification (numeric search uses YoY rank)
- Historical coverage back to 1960 (non-PPP) / 1990 (PPP) with a data-driven year selector
- Movement-table search, relation filters, sorting, and pagination that never renumber backend ranks
- YoY coverage (current/previous valid counts, valid pairs)
- Data coverage panels and evidence-only changing-totals explanations
- Rank movement comparison (Movement tab): like-for-like common universe, entered/exited analysis, verified decomposition; metric-aware bases — level endpoint, annual YoY / period endpoint change, and for annual flows annual endpoint vs period total vs period average
- Entity comparison (Compare tab): country, official World Bank aggregate, or user-selected group on either side; capability-filtered operations (level, change, CAGR, cross-rate); observed vs like-for-like group values with provenance; named groups with member counts, URL persistence, and server-validated previews
- Flow period analysis: annual endpoint comparison ("Annual flow: B vs A") kept distinct from half-open period totals ([A, B)) and period averages, with strict completeness (a missing year makes the period unavailable, never zero-filled)
- Group methodology: additive families sum member observations (Total GDP, trade flows, FDI, current account, remittances, population); FDI % GDP for groups resolves as ΣFDI / ΣGDP × 100 from compatible legs (never averaged member percentages); per-capita, inflation, index and FX groups are refused with explicit reasons
- Analytical charts (Recharts): time-series lines for histories, endpoint slopes (never fake trend lines), bars for period totals and group levels, rank-1-on-top movement slopes — every value rendered verbatim from backend responses with units, source, and APP_DERIVED labelling where applicable
- Subject-aware analysis: inflation in percentage points (never relative percent by default), CPI index in index points, exchange rates with explicit LCU-per-US$ quotation semantics
- Audit/source transparency, including raw-value visibility
- Data status, integrity checks, and manual refresh with progress
- Responsive frontend (desktop, tablet, mobile)

## Indicators

| Subject | Indicator | Metric key | World Bank code | Unit |
|---|---|---|---|---|
| GDP per capita | Nominal GDP per capita | `nominal_current` | NY.GDP.PCAP.CD | current US$ |
| GDP per capita | Nominal GDP per capita | `nominal_constant` | NY.GDP.PCAP.KD | constant 2015 US$ |
| GDP per capita | GDP per capita, PPP | `ppp_current` | NY.GDP.PCAP.PP.CD | current international $ |
| GDP per capita | GDP per capita, PPP | `ppp_constant` | NY.GDP.PCAP.PP.KD | constant 2021 international $ |
| Total GDP | Total GDP | `total_current` | NY.GDP.MKTP.CD | current US$ |
| Total GDP | Total GDP (real GDP) | `total_constant` | NY.GDP.MKTP.KD | constant 2015 US$ |
| Total GDP | Total GDP, PPP | `total_ppp_current` | NY.GDP.MKTP.PP.CD | current international $ |
| Total GDP | Total GDP, PPP | `total_ppp_constant` | NY.GDP.MKTP.PP.KD | constant 2021 international $ |
| Prices | CPI inflation, annual % | `inflation_cpi` | FP.CPI.TOTL.ZG | annual % |
| Prices | CPI index, 2010 = 100 | `inflation_cpi_index` | FP.CPI.TOTL | index (2010 = 100) |
| Prices | GDP-deflator inflation, annual % | `inflation_deflator` | NY.GDP.DEFL.KD.ZG | annual % |
| Trade | Exports, current US$ | `exports_current` | NE.EXP.GNFS.CD | current US$ |
| Trade | Imports, current US$ | `imports_current` | NE.IMP.GNFS.CD | current US$ |
| Capital flows | FDI net inflows, BoP current US$ | `fdi_inflows` | BX.KLT.DINV.CD.WD | current US$ |
| Capital flows | FDI net inflows, % of GDP | `fdi_inflows_pct_gdp` | BX.KLT.DINV.WD.GD.ZS | % of GDP |
| Exchange rates | Official exchange rate, LCU per US$ | `fx_official` | PA.NUS.FCRF | LCU per US$ |
| External sector | Current account balance, BoP current US$ | `current_account` | BN.CAB.XOKA.CD | current US$ |
| External sector | Total reserves minus gold, current US$ | `reserves_ex_gold` | FI.RES.XGLD.CD | current US$ |
| External sector | Personal remittances received, current US$ | `remittances_received` | BX.TRF.PWKR.CD.DT | current US$ |
| Population | Population, total | `population_total` | SP.POP.TOTL | people |

The constant-price series come directly from the corresponding World Bank
indicators. They are not derived from current-price data, price indices, or
any frontend conversion. In World Bank terminology, constant-price GDP *is*
real GDP; there is no separate "real GDP at current prices" series, and the
application never synthesizes one. The series have different units and are
never averaged or combined into a score — not within a subject, and never
across subjects.

Total GDP values are on the order of trillions of US$ (e.g. India 2025
`NY.GDP.MKTP.CD` = 3,956,067,115,771.63). They are displayed scaled
(e.g. `$3.96 trillion`) only at presentation time; ranking, YoY, comparison,
tie detection, and audit always use the untouched raw value.

Terminology used in the UI: *nominal* means the current-price series and
*real* means the constant-price series (constant-price GDP is what the World
Bank calls real GDP). Current-price data is never labelled real, and no
"real GDP at current prices" series exists or is created. PPP values are
converted via purchasing power parities (constant PPP series use a 2021
reference year; constant non-PPP series use 2015). Historical availability
differs by indicator family: non-PPP series reach back to 1960 while PPP
series begin in 1990 — each metric keeps its own actual coverage and no
common start year is fabricated.

## How Ranking Works

- The eligible universe is built from World Bank country metadata.
  Aggregates are excluded when `region.id` is `"NA"`, `region.value` is
  `"Aggregates"`, or the metadata identity is blank.
- An observation counts only when its value is present and finite, its
  `countryiso3code` is non-blank, the code matches stored metadata, and the
  matched entity is not an aggregate. Missing values stay missing; they are
  never treated as zero or estimated.
- Each year × indicator is sorted by raw value descending with ISO3 ascending
  as the deterministic tie-break. Rank is the 1-based ordinal position, so
  tied values receive distinct positions ordered by ISO3.
- The denominator is the number of eligible economies holding a valid
  observation for that exact year and indicator.
- YoY % is `((currentRaw / previousRaw) − 1) × 100` on raw values. Missing or
  non-positive bases yield no value (never 0%). YoY ranking orders countries
  by percentage change with its own denominator of valid pairs.

## Historical Data Coverage

Stored coverage follows what the World Bank actually returns — it is not a
hard-coded range:

- Non-PPP indicators: 1960 → latest stored year (currently 2025).
- PPP indicators: 1990 → latest stored year (currently 2025).
- Missing years stay missing: no interpolation, no forward-fill, no zeros.
- A newly published World Bank year becomes selectable after a refresh; no
  frontend year list needs editing.

Distinguish *available historical data* from the *default analysis range*:
the UI opens at 2000 → latest stored year, but any stored year (back to 1960
where available) is directly selectable, including for movement intervals
such as 1960 → 1970. The first stored year of a series has level values but
no YoY (there is no previous-year base); a YoY is also unavailable across any
gap — the response carries an explicit reason code instead of bridging years.
Long-period growth (e.g. 1960 → 2025) needs only both endpoints to be valid.

## Data Coverage

Every year × indicator reports the eligible universe, the valid-observation
count, and the missing count, so denominators are never mistaken for a world
country total. When totals change between years, the application explains why
using only stored facts (metadata-universe change, observable filtering
differences, or observation coverage), and states when evidence is
insufficient. It does not invent reasons for missing observations.

## Rank Movement Comparison (Movement Tab)

Yearly ranks such as `171/209` and `172/213` cannot be read as “moved one
place”: each denominator counts a different observed population. The Movement
tab is a separate analytical layer that explains the change without touching
the existing ranking tables.

For one indicator and two years (`GET /api/comparison/level`):

- `A` / `B`: eligible economies with a valid observation in Year A / Year B.
- `Common = A ∩ B`, `Exited = A − B`, `Entered = B − A` (exact ISO3 sets).
- `F_A` / `F_B`: India full observed ranks; `K_A` / `K_B`: India positions
  inside Common using each year values (derived comparison positions, not
  World Bank ranks).
- Above/below India is decided by ranking position (metric-declared direction,
  `DESC` for GDP and `ASC` where the registry declares lower-values-first,
  `ISO3 ASC` tie-break, 1-based), never by raw-value comparison, so ISO3
  tie-breaks are exact.
- Verified identity: `F_B − F_A = (K_B − K_A) + EnteredAbove_B − ExitedAbove_A`.
  `positionNumberChange = F_B − F_A` (positive = position number increased);
  `placesGained = F_A − F_B` (positive = moved up). The frontend displays
  backend-provided numbers only.
- Entered/exited means valid-observation set membership only — never that an
  economy was created, dissolved, or politically added/removed. Per-economy
  causes are reported as “Reason not established from stored evidence” unless
  stored counters establish an aggregate fact.
- Every 200 response carries `verification.passed === true` (domain + service
  checks, integer-only, rank bounds, engine cross-check, metadata membership).
  A failed invariant returns `COMPARISON_INVARIANT_FAILED` with no analytical
  numbers.
- Evidence includes World Bank vintage, producing runs, per-year ingest
  counters, metadata-universe comparison, completeness, fingerprint, limits,
  and the denominator explanation. Region/income metadata is labelled as the
  retrieved vintage, not as historical fact.

## Flow Periods, Groups, and Charts

Annual flows (exports, imports, FDI, current account, remittances) are not
levels, so a multi-year span is never reduced to endpoint percentage growth:

- **Annual endpoint** compares the annual flow in year B with year A
  (“Annual flow: B vs A”), interiors ignored.
- **Period total** sums the annual observations over the half-open interval
  `[A, B)` — 2004 → 2014 means 2004…2013 (10 observations), 2014 → 2024
  means 2014…2023, so adjacent periods never double-count a boundary year.
- **Period average** is the total divided by the observation count (typical
  annual scale), always shown beside — never substituted for — the total.
- Strict completeness: one missing year makes the period unavailable with
  reason `incomplete_period` plus the missing-year list. Missing is never
  zero, never interpolated, never silently skipped.
- Signed flows refuse sign-flipping percentages everywhere (`+10 → −5`
  is unavailable with reason `sign_change_across_endpoints`, never −150%);
  absolute change and period sums stay valid.

Custom groups are request-scoped ISO3 lists, never regions and never ranked
in country leaderboards. Additive families (Total GDP, trade flows, FDI,
current account, remittances, population) sum valid member observations;
FDI % GDP resolves as Σ member FDI ÷ Σ member total-GDP × 100 from
same-year, same-vintage, same-basis legs (never averaged member ratios).
Per-capita, inflation, CPI index and FX groups are refused with explicit
machine-readable reasons (`NOT_AGGREGATABLE`, `UNSUPPORTED_TRANSFORMATION`,
`UNSUPPORTED_ENTITY_COMBINATION`). Official World Bank aggregates are read
as published observations, never synthesized; missing aggregates stay
missing with a reason.

Charts (Recharts) visualize backend numbers only and never calculate
economics: time-series lines for genuine histories (gaps break lines),
endpoint slopes for two-point comparisons (never fake trend lines), bars
for period totals and group levels, rank slopes with rank 1 at the top.
Every chart carries title, unit, source, and APP_DERIVED labelling where
applicable; tooltips keep full registry precision; missing values render
gaps, never zeros.

## Search and Filtering

Filtering changes visibility only — it never recomputes ranks, denominators,
universes, or growth values:

- Text search matches country name or ISO3 (case-insensitive substring).
- A purely numeric search (e.g. `100`, `#100`, ` 100 `) means the **exact**
  analytical rank #100 in the table being viewed — never a substring, so
  `10` does not match #100 or #101. A requested rank with no row shows an
  explicit empty state naming the missing rank.
- In Movement tables the `#` column always shows the row's backend analytical
  rank (end-year rank, year-specific rank, or interval growth rank depending
  on the table), so searching, relation filters, sorting, and pagination never
  renumber what is displayed. Rows without a rank in the shown context display
  an em-dash rather than a fabricated number.
- On the YoY page, numeric search uses the **YoY rank**, not the level rank.
- Backend `/api/ranking` and `/api/yoy-ranking` searches behave the same way:
  the full ranked list is computed first, then filtered, so matches keep
  authoritative ranks on any page.

## What This Project Does Not Calculate

- No GDP growth-percentage series is treated as a level series
  (`NY.GDP.MKTP.KD.ZG`, `NY.GDP.PCAP.KD.ZG` and local-currency codes are
  rejected by the metric registry).
- No synthetic, rebased, deflated, or otherwise derived series are generated;
  constant-price observations come only from the World Bank.
- No external forecasts or projections are ingested. The application uses data
  published through the selected World Bank WDI indicators and does not
  substitute IMF, government, or other external forecasts/projections.
- No cross-unit comparison: per-capita and Total GDP values are never mixed,
  and PPP, current-price, and constant-price values are never combined.

## Architecture

```
World Bank WDI API (sole raw-data source)
  → wb/client.js (paged fetch, retry/backoff, envelope validation)
  → wb/ingest.js (normalize, classify, validate)
  → O10 exact unchanged comparison (per indicator)
  → O7 single outer transaction, indicator by indicator
  → O1 lazy per-chunk batch writes (only changed indicators)
  → O2 staged-memory release after each indicator
  → O8 streaming integrity scan
  → COMMIT (success) / ROLLBACK (failure, partial)
  → Turso Cloud (production) / local SQLite file (development, fallback)
  → db/repository.js (all SQL lives here)
  → backend services (ranking, YoY, movement, compare, coverage, years)
  → Express JSON API (finished numbers only)
  → React + Vite frontend (display only)
```

- Frontend: React + Vite (`frontend/`). Transport and presentation only:
  it never queries Turso, never calls the World Bank API, and performs no
  ranking, YoY, or denominator calculations.
- Backend: Node.js + Express 5 (`backend/src/server.js`). Sole calculation
  authority for every analytical number.
- Database: Turso Cloud primary in production; local SQLite file
  (`backend/data/worldbank.db`) for development and as a guarded fallback.
  Both backends are served through one libSQL driver (`backend/src/db/`),
  so repository and service code never knows which physical database
  answers. Raw values are stored twice: numeric `REAL` for calculation and
  canonical decimal `value_raw` text for audit.
- Data source: World Bank WDI API (open, no API key) — the only raw-data
  source. No forecasts, no third-party rankings, no synthesized series.

## Refresh Optimization (O1 / O2 / O7 / O8 / O10)

The refresh pipeline produces byte-identical data with less RAM and fewer
database rewrites. It changes no metric, ranking, movement, comparison,
analysis, missing-data rule, precision, or source data:

- **O1 — lazy per-chunk batch construction**: bulk-write statements exist
  only for the chunk in flight (500 rows), never a 230k-entry array.
- **O2 — progressive staged-data release**: each indicator's staged rows are
  released immediately after publishing; peak memory is one indicator.
- **O7 — one outer transaction**: fetch → validate → publish → release runs
  per indicator inside a single atomic transaction. A failure anywhere rolls
  everything back; readers always see the previous committed snapshot.
- **O8 — streaming integrity scan**: value/finiteness validation streams in
  rowid-ordered batches with a `checked === COUNT(*)` completeness gate —
  never a full-table in-memory array.
- **O10 — exact unchanged detection**: each indicator's staged payload is
  compared element-by-element (identity, value, `value_raw`) against stored
  rows. Only a proven-identical indicator skips its DELETE/upsert writes.
  The World Bank `lastupdated` string alone is never treated as proof.

## Refresh Lifecycle

- **Fresh cache**: serve existing data; no refresh is triggered.
- **TTL expiry** (default 24 h from the last *successful check*): a
  background refresh/check starts fire-and-forget while current data keeps
  serving. Concurrent requests share the single run (in-memory flag +
  database mutex).
- **Changed indicator**: its year-range DELETE + upserts run; only that
  indicator is rewritten.
- **Unchanged indicator**: proven identical, zero observation writes.
- **All unchanged**: still a successful refresh — `lastSuccessAt` advances
  and the next 24 h TTL starts at completion. Unchanged data is not failure.
- **Partial failure** (some indicators fail): the outer transaction rolls
  back, old data remains byte-identical, `lastSuccessAt` does not advance,
  the attempt is recorded as `partial`, and (for background refreshes) a
  retry is scheduled.
- **Automatic retry** (background refreshes only): 5 min → 15 min → 30 min
  → 60 min, single-flight, in-process. Any success resets the chain.
  Manual-refresh failures never schedule automatic retries.
- **Process crash mid-refresh**: uncommitted writes roll back; the stale
  refresh lock is recovered on the next boot; the next refresh starts clean.

## Performance (full-scale isolated verification)

Measured against the complete real dataset (349,800 rows retrieved,
228,776 observations, 20 indicators, 295 entities, 78 aggregates) on an
isolated scratch database — not on production Render:

- Unchanged full refresh: peak RSS ≈ 244.7 MB, peak heap ≈ 83.2 MB
  (≈ 10.3 MB retained post-GC), ≈ 12–14 s, zero observation writes.
- One-indicator rewrite: ≈ 26–28 s (14,481 rows rewritten, rest skipped).
- Streaming integrity scan: 12/12 checks in ≈ 4 s over 228,776 rows.
- Previous Phase 6A baseline for comparison: ≈ 275.8 MB RSS, ≈ 141.7 MB
  heap, ≈ 243 s full refresh.

The worst-case all-20-indicator remote-write run was not directly measured
against production billing; row-level write accounting is derived from code
(see `RELEASE_v3.1.0.md`).

## Cold Start, PWA Identity, Geolocation

- **Cold start**: the backend `listen()`s before any data work; `/api/years`
  answers 503 `DATA_LOADING` while the first dataset seeds. The DataStatus
  view treats connection refusal/timeout as "Starting the data service…"
  with controlled auto-retry inside a 120 s window, then falls back to an
  explicit error with manual retry. Genuine HTTP errors render red at once.
- **PWA identity** is generic: `World Bank WDI Economic Data Analysis`
  (`WDI Analysis`), pinned by `frontend/src/identity.test.js`. An
  already-installed old copy may retain stale install metadata — uninstall
  and fresh-install from the deployed build.
- **Focus country**: URL `?country=` > manual/session selection > one-time
  IP geolocation (`GEO_PROVIDER_URL`, `GEO_TIMEOUT_MS=3000`) > India
  fallback. Geolocation is a UX default only, never analytical.

## Local Development

Requirements: Node.js 24+.

Backend (port 3001 by default):

```powershell
cd backend
npm install
npm start
```

Frontend (port 5173 by default, proxies `/api` to the local backend):

```powershell
cd frontend
npm install
npm run dev
```

Local API behavior: the browser calls relative `/api/...` on
`http://localhost:5173`, and the Vite dev proxy forwards to
`http://localhost:3001`. The backend serves the frontend's data; the
frontend performs no ranking, YoY, or denominator calculations.

Useful backend commands (`backend/`):

```powershell
npm test                    # backend test suite
node src/scripts/ingest.js  # manual World Bank ingestion
node src/scripts/liveAudit.js  # live acceptance audit against the World Bank API
```

Frontend commands (`frontend/`):

```powershell
npm run lint    # static checks
npm run build   # production build
```

## Production Deployment

Deploy the backend first, then point the frontend at it. The frontend
receives the API base URL through `VITE_API_BASE_URL` in deployed
environments:

```text
VITE_API_BASE_URL=https://your-backend.example.com
```

(The value above is a documentation placeholder, not a real deployment.
Configure the actual backend URL as a build/deploy environment variable,
e.g. in Vercel for both Preview and Production.) No source-code change is
needed to switch between the local backend and a deployed backend.
Do not commit a real backend URL to any tracked file: local-only
`frontend/.env` / `frontend/.env.local` are git-ignored conveniences, and
`vite dev` always uses the local proxy regardless (see below).

The backend refuses to start in `NODE_ENV=production` unless the deployment
environment provides:

```text
REFRESH_ADMIN_TOKEN=<random-secret>   # required: locks POST /api/data/refresh
CORS_ORIGINS=https://your-frontend.example.com  # required: exact-match allowlist, comma-separated, no wildcards
```

CORS is never `*`: only exact origins listed in `CORS_ORIGINS` receive
`Access-Control-Allow-Origin`, and requests without an `Origin` header
(curl, server-to-server) keep working. Serve the frontend and backend from
one host when a separate CORS setup is unwanted — an empty
`VITE_API_BASE_URL` (relative `/api`) then needs no allowlist entry.

## Environment Variables

Only public, browser-visible configuration belongs in frontend environment
files. The backend needs no API key.

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | frontend | Backend base URL. Empty means relative `/api` (local proxy / same host). |
| `VITE_SITE_AUTHOR_NAME` / `VITE_SITE_AUTHOR_ROLE` | frontend | Public About-page author labels. Optional; empty renders a documented neutral fallback. Display only — never analytical. |
| `VITE_SITE_LAST_UPDATED_YEAR` / `_MONTH` / `_DAY` | frontend | Site-content update date as separate parts (e.g. year+month renders "July 2026"). Optional. Display only — dataset freshness always comes from the backend. |
| `VITE_SITE_DATA_YEAR` / `VITE_SITE_DATA_MONTH` | frontend | Informational reference vintage named by site content. Optional. The authoritative vintage always comes from API responses. |
| `VITE_SITE_SOURCE_NAME` | frontend | Public dataset name (default "World Bank WDI"). |
| `VITE_SITE_CONTACT_EMAIL` | frontend | Public contact email for the About page Contact section. Optional; empty omits the address. Display only — never a secret. |

Frontend environment files (`frontend/`): `VITE_API_BASE_URL` is read with
Vite's file precedence. `vite dev` additionally loads the tracked
`.env.development`, which pins the variable to empty, so local development
always uses the Vite `/api` proxy even when a local (untracked)
`frontend/.env` holds a deployment URL. Production builds ignore
`.env.development`; they use deployment-provided `VITE_API_BASE_URL`, falling
back to a local untracked `frontend/.env` and then to relative `/api`.
Local-only files (`.env`, `.env.local`) are never committed.
| `PORT` | backend | API listen port (default 3001). |
| `REFRESH_ADMIN_TOKEN` | backend | Bearer token for `POST /api/data/refresh`. Empty = open (local dev/tests only). Production refuses to start without it. Never logged or returned. |
| `CORS_ORIGINS` | backend | Exact-match allowed frontend origins, comma-separated, no wildcards. Unset = permissive dev default. Production refuses to start without it. |
| `CACHE_TTL_HOURS` | backend | Cache freshness window in hours from the last successful check (default 24). Unchanged successful refreshes renew it. |
| `DATABASE_FILE` | backend | Local SQLite file (default `data/worldbank.db`). Development database and guarded production fallback. |
| `DB_MODE` | backend | `turso` or `local` to force the backend; empty = automatic (Turso when configured). Local development sets `DB_MODE=local` so dev work can never touch production Turso. |
| `TURSO_DATABASE_URL` | backend | Turso Cloud database URL. Secret deployment value — never commit, never log (only the host is logged). |
| `TURSO_AUTH_TOKEN` | backend | Turso auth token. Secret — never commit, log, or return from any endpoint. |
| `ALLOW_LOCAL_DB_FALLBACK` | backend | When Turso is unreachable at boot and a valid non-empty local DB exists, serve from it with a loud warning (default true). Never masks an outage with an empty database and never triggers an unattended seed. A genuine mid-serving Turso transport failure also fails over to the validated fallback immediately (see below). |
| `REFRESH_RATE_LIMIT_MAX` / `REFRESH_RATE_LIMIT_WINDOW_MS` | backend | Manual-refresh abuse protection (defaults 10 per 60 s per IP; GET endpoints never limited). |
| `WB_AUTO_INGEST_ON_EMPTY` / `WB_AUTO_REFRESH_ON_STALE` | backend | Boot empty-ingest and stale-cache background refresh (defaults 1/1; set 0 to require manual refresh). |
| `WB_PER_PAGE` / `WB_MAX_RETRIES` / `WB_RETRY_BASE_MS` / `WB_TIMEOUT_MS` | backend | World Bank client tuning (defaults 20000 / 5 / 500 ms / 30000 ms). |
| `GEO_PROVIDER_URL` / `GEO_TIMEOUT_MS` | backend | Keyless IP-geolocation endpoint with `{ip}` placeholder (default `https://ipwho.is/{ip}?fields=country_code`) and single-attempt bound (default 3000 ms). UX default only. |
| `DEFAULT_START_YEAR` / `DEFAULT_END_YEAR` | backend | Default analysis parameters (currently 2000 / 2025). The available-year selector remains data-driven and is derived from stored World Bank observations. |
| `INGEST_START_YEAR` / `INGEST_END_YEAR` | backend | Default refresh fetch range (defaults 1960 / current calendar year, so future World Bank years are picked up). |
| `WB_FAILOVER_COOLDOWN_MS` | backend | Minimum interval between runtime fallback validations (default 5 min). Failover itself is immediate after a confirmed transport failure; this only bounds repeat validations. |
| `WB_RECOVERY_REPROBE_MS` | backend | How often a fallback-serving process asks whether Turso is back (default 15 min). Never per-request; data-status never probes. |
| `WB_RECOVERY_CONFIRM_MS` | backend | How long Turso must remain continuously healthy before promotion back from fallback (default 60 s). One healthy probe starts the window but never promotes alone; 0 promotes on first healthy probe. |
| `WB_RECOVERY_PROBE_TIMEOUT_MS` | backend | Bound for one recovery probe round-trip (default 10 s). |
| `WB_RECOVERY_RECONCILE_COOLDOWN_MS` | backend | Cooldown between Turso catch-up refreshes when fallback holds newer data (default 30 min). A failed catch-up never hot-loops. |

Backend `.env` is read once at process start and never hot-reloaded: changing any
variable above requires a backend restart. In particular, editing `.env` while
the server runs does not change its database target — use the Status page's
reported target (which always reflects the actual active handle) to verify
failover and recovery, not the file on disk.

See `frontend/.env.example` and `backend/.env.example`. Real `.env` /
`.env.local` files are local-only and never committed. `backend/.env.example`
covers every code-consumed key (production keys, safe defaults, empty secret
placeholders, test-only seams); an automated check enforces
`inCodeNotExample = ∅`. Secrets (`TURSO_AUTH_TOKEN`, `REFRESH_ADMIN_TOKEN`,
passwords, credentials) are never committed, logged, or embedded in the
frontend bundle.

## Testing

- Backend: `node --test --test-concurrency=1 test/*.test.js` in `backend/` —
  **609 pass / 0 fail**, covering configuration, registry, universe, ranking,
  YoY, pagination, search, World Bank client behavior, ingestion, O10
  unchanged skipping, retry/backoff, failure positions, TTL, cold start,
  refresh hardening/locks/progress, guardrails, Turso selection, integrity,
  and HTTP endpoints — plus the `test/equivalence.test.js` harness (3/3:
  determinism self-proof, sensitivity witness, cross-run equivalence).
- Frontend: `npm run test` in `frontend/` — **165/165** (vitest), including
  product-identity pins and data-status cold-start behavior.
- Lint/build: `oxlint` 0 errors; `vite build` green.
- Full-scale zero-loss validation (isolated scratch DB, live WDI data):
  unchanged/mutated/dropped-indicator runs, indicator-17 failure rollback
  after real writes, 76 clean concurrent reads, SIGKILL-crash rollback with
  lock recovery — see `RELEASE_v3.1.0.md`.

## Data / Refresh

Turso (production) or the local SQLite file (development/fallback) acts as a
persistent cache: the application does not query the World
Bank on every frontend request. Data is refreshed when the database is empty
(automatic on server start), when the cache exceeds its TTL (automatic
background refresh, guarded so concurrent requests share one run), or
manually via `POST /api/data/refresh` (admin-token protected when
configured). Without explicit years a refresh
fetches the historical ingest range (defaults 1960 through the current
calendar year) for all production metrics, storing only what the World Bank
returns. Refresh state, lock state, retry state, and recent runs are visible
through `GET /api/data-status`. A failed refresh is recorded
and the previous valid dataset keeps serving; automatic retries back off
(5/15/30/60 min) instead of looping.

Deployment model: one backend writer service owns refreshes; a database-backed
refresh lock serializes them across processes (the CLI ingest scripts are the
only other writer and must never run concurrently with the server), and server
boot recovers a lock left behind by a crashed holder. With a populated Turso
database, a Render restart reconnects and serves existing rows with no startup
reseed; only an empty database seeds, and production degraded mode (primary
unreachable, no usable local database) explicitly never seeds.

Freshness is successful-check time, not vintage time: the TTL window
(default 24 h via `CACHE_TTL_HOURS`) runs from the last successful
retrieval — including successful unchanged checks, which renew it with zero
observation writes. A newly published World Bank vintage is picked up by the
next refresh after TTL expiry, or immediately via manual refresh. The actual
World Bank vintage behind each analysis is always visible in API responses
(`vintage` / `wbLastUpdated` evidence) and in the UI next to every result.

Runtime failover and guarded recovery: a genuine mid-serving Turso transport
failure (after the bounded retries) validates the existing local database and
swaps future traffic to `Local SQLite (production fallback)` immediately, with
the Status page reporting the actual active handle. While on fallback, TTL
refresh continues normally against it. When Turso is reachable again,
recovery first compares stored content directly (reads only, no World Bank
fetch, no writes): identical content promotes through a short health
confirmation window with zero fetch and zero writes, and only genuinely
diverged content triggers a full catch-up refresh — which, like every
refresh, publishes atomically or rolls back, never partially. Background
recovery never drives the user-facing 20-indicator progress UI; the Status
page shows a calm backup notice instead, and manual refreshes keep their
detailed progress display.

## Source / Methodology

Data source: World Bank World Development Indicators (WDI), retrieved through
the official WDI API. Ranks, YoY values, denominators, and coverage
classifications are calculated by this application and labeled as such
("Rank calculated from World Bank WDI observations."). No third-party
rankings are used or imported.

## Project Structure

```text
README.md            public project documentation
frontend/            React + Vite UI (display only)
  src/api/           centralized backend client
  src/sections/      yearly table, verification, ranking, coverage, audit, status
backend/             Express API + ingestion + ranking engine
  src/server.js      HTTP routes
  src/services/      ranking, YoY, coverage, verification, integrity
  src/domain/        pure calculation and filtering logic
  src/wb/            World Bank client and ingestion pipeline
  src/db/            libSQL schema and repository (Turso + SQLite file)
  test/              backend test suite and fixtures
```

Generated files (`node_modules/`, `dist/`, `backend/data/`, local `.env`
files) are not part of the repository.

## Production Operator Checklist (v3.1.0)

Operator-side verification (not yet performed — do not claim production
verification until observed):

1. Confirm Render runs with `DB_MODE=turso`.
2. Confirm the Turso connection log at boot.
3. Confirm startup recognizes existing rows ("no startup ingestion needed").
4. Confirm no startup reseed occurs.
5. Restart Render and confirm data persistence across the restart.
6. Test cold-start UI ("Starting the data service…" → automatic recovery).
7. Fresh-install the PWA after uninstalling any old copy; confirm the
   generic identity.
8. Observe the first real automatic 24 h refresh (status, writes, TTL).
9. Observe Render memory metrics during/after refresh.
10. Verify production status/data pages serve correct numbers.

## Known Limitations (v3.1.0)

- The worst-case all-20-indicator remote write path was not directly
  measured against Turso billing; write accounting is row-level from code.
- A live Turso outage was deliberately never induced; fallback/degraded
  behavior is verified by code trace and selection tests.
- Long retry intervals (15/30/60 min) were verified via an accelerated
  timing seam on the identical code path, not by literal waiting.
- Production operator verification (above) is pending.

## Disclaimer / Scope

- World Bank data may be revised; retrieved vintages are recorded with every
  ingest (recent vintage: `lastupdated` 2026-07-13) and shown in the UI.
- Historical rankings are calculated from the retrieved observations for the
  recorded vintage, not published by the World Bank.
- Rank positions depend on the selected data vintage and the valid
  observations available for each year and indicator.
