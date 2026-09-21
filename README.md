# World Bank — India GDP per Capita Ranking (Verification Tool)

A backend application that retrieves World Bank World Development Indicators
(WDI) data and **independently calculates** India's yearly GDP-per-capita
value, YoY change, rank, and denominator for exactly four indicators.

> The World Bank provides the underlying observations. Historical country ranks
> shown by this application are calculated by this application from those
> observations.

Rank wording used throughout the API: *"Rank calculated from World Bank WDI
observations."*

## Architecture

```
WORLD BANK WDI API
        ↓
RAW OBSERVATIONS (SQLite, backend/data/worldbank.db)
        ↓
COUNTRY METADATA → REMOVE AGGREGATES → REMOVE BLANK ISO3
        ↓
MATCH OBSERVATION TO ELIGIBLE COUNTRY → KEEP RAW VALUES
        ↓
YEAR × INDICATOR → VALID OBSERVATIONS
        ↓
SORT VALUE DESC + ISO3 ASC → INDIA'S LEVEL RANK
        ↓
CALCULATE YOY FROM RAW VALUES → INDIA'S YOY → OPTIONAL YOY RANK
        ↓
SHOW VALID-COUNTRY DENOMINATOR → ABOVE / INDIA / BELOW
        ↓
SHOW COVERAGE EXPLANATION → FULL AUDITABLE RESULT (HTTP API)
```

No frontend is required for correctness. All calculations happen in
`backend/src/`; the Express API serves finished numbers.

## The four indicators (only)

| Key | World Bank code | Unit |
|---|---|---|
| `nominal_current` | NY.GDP.PCAP.CD | current US$ |
| `nominal_constant` | NY.GDP.PCAP.KD | constant 2015 US$ |
| `ppp_current` | NY.GDP.PCAP.PP.CD | current international $ |
| `ppp_constant` | NY.GDP.PCAP.PP.KD | constant 2021 international $ |

Each indicator is ranked independently with its own denominator. Constant-price
series come directly from the World Bank indicators above — never derived from
current-price data, CPI, or any index. Values across metrics must never be
compared as though they share a unit.

## Installation

Requires Node.js 24+ (uses `node:sqlite`, no native compilation).

```powershell
cd backend
npm install
```

Configuration lives in `backend/.env` (see `backend/.env.example`; the API
needs **no key**). Key variables: `WORLD_BANK_API_BASE_URL`,
`WORLD_BANK_*_INDICATOR` (4), `DEFAULT_START_YEAR`/`DEFAULT_END_YEAR`
(2000/2025), `CACHE_TTL_HOURS` (24), `RANK_NEIGHBORS_DEFAULT` (5),
`DATABASE_FILE` (`data/worldbank.db`), `WB_AUTO_INGEST_ON_EMPTY` (1),
`WB_AUTO_REFRESH_ON_STALE` (1).

## Backend startup

```powershell
cd backend
npm start            # listens on PORT (default 3001)
```

On boot the server: recovers a stale SQLite refresh lock (crash safety),
auto-ingests from the World Bank API when the database is empty (unless
`WB_AUTO_INGEST_ON_EMPTY=0`), reports cache staleness, and runs integrity
checks (warn-only; full report at `GET /api/integrity`).

Verify: `GET http://localhost:3001/api/health`.

## Database (SQLite, behind repository.js)

File: `backend/data/worldbank.db` (WAL mode). All SQL lives in
`backend/src/db/repository.js`. Tables:

- `countries` — World Bank metadata; `is_aggregate` + `aggregate_reason`
  carry the centralized universe verdict.
- `indicators` — exactly the four series above (`code`/`metric_key` UNIQUE).
- `observations` — **only valid non-null observations**; absence of a row
  means "no stored observation". Primary key
  `(country_id, indicator_id, year)`.
- `fetch_runs` — one row per ingestion with endpoint, requested/fetched year
  ranges, indicator codes, `lastupdated`, rows received/upserted, per-meaning
  rejection counters, pages/requests, universe snapshot, status/error.
- `ingest_year_stats` — per-run, per-metric, per-year counter split (powers
  the "why does the total change?" explanation with facts only).
- `refresh_locks` — single-row (`id = 1`) cross-process refresh mutex.

## Numerical representation

- `observations.value` REAL (IEEE-754 double): the **queryable numeric** used
  for `ORDER BY`, ranking comparisons, and YoY arithmetic. Deterministic for
  a fixed snapshot: identical observations always yield identical ranks.
- `observations.value_raw` TEXT: the **canonical decimal string** of the
  accepted value, preserved for audit and reproducibility
  (`Number(value_raw) === value` for every row; enforced by integrity check F).
- Honest limitation: the API returns JSON numbers, which `JSON.parse`
  converts to doubles before application code sees them. `value_raw`
  preserves the canonical post-parse decimal (round-trip stable), not
  necessarily the original wire bytes. A lossless JSON parser was
  deliberately not added: it would change the fetch layer for no material
  gain on values within double precision.
- Never rounded before calculation; never compared as formatted strings
  (`"$2,702"` is presentation only, via `domain/format.js`).

## World Bank API

Base: `https://api.worldbank.org/v2` (open, no key). Client
(`src/wb/client.js`): validates the `[meta, rows]` envelope (including the
HTTP-200 `{ message }` error shape), follows `pages`/`per_page`/`total`,
fails hard on pagination incompleteness, retries transient failures with
exponential backoff + jitter, honors `Retry-After`, times out hung requests.

Ingestion (`src/wb/ingest.js`) fetches `startYear − 1 → endYear` so the first
selected year still gets a YoY value; the API result range stays
`startYear → endYear`. Every payload records `lastupdated`, pages, requests,
and completeness.

## Country-universe filtering

Excluded as aggregates when `region.id === "NA"`, or
`region.value === "Aggregates"`, or the metadata identity/id is blank/missing
(single rule in `src/domain/universe.js`). An observation is ranked only when
its value is present and finite, its `countryiso3code` is non-blank, the code
joins to stored metadata, and that entity is non-aggregate. Blank-`countryiso3code`
income-group rows and `WLD`-style aggregates are excluded with distinct audit
counters. Legitimate economies (e.g. XKX Kosovo, PSE West Bank and Gaza) are
retained. Missing data is never zero, never estimated, never carried forward.

## Level ranking

Per year × indicator: drop missing values, sort raw value DESC with ISO3 ASC
as the deterministic tie-break, rank = 1-based ordinal position.
Ties are ordered deterministically by ISO3 and therefore receive distinct
ordinal positions (not competition/dense ranks). The denominator is the number
of eligible entities with a valid observation for that exact year and
indicator — never "all countries in the world".

## YoY

`YoY % = ((currentRaw / previousRaw) − 1) × 100` on raw values, per indicator
independently. Missing current/previous → null; previous ≤ 0 (including both
zero) → null with an explicit reason code; invalid YoY is never 0%. A genuine
`0%` (equal values > 0) remains valid. YoY ranking (YoY DESC, ISO3 ASC) is a
separate concept with its own denominator counting only valid YoY pairs.

## Coverage and changing totals

Every year × indicator exposes eligible universe, valid count, and missing
count (plus current/previous/pairs for YoY). "Why does the total change?"
uses CASE precedence **B > C > A > D** on stored facts only: (B) metadata
universe changed between comparable run snapshots with the actual added/removed
list; (C) observable aggregate/filtering differences; (A) stable universe with
different observation coverage; (D) insufficient evidence, no inferred cause.
Historical comparisons use each run's own universe snapshot, never the current
count. The engine never claims a country "did not report" or was "excluded".

## Cache / refresh

SQLite is the persistent cache. Refresh triggers — all three required
behaviors are implemented:

1. **Empty database**: auto-ingested on boot when `WB_AUTO_INGEST_ON_EMPTY=1`
   (default), via `ensureDataPresent()`.
2. **Expired TTL**: when the cache is stale per `CACHE_TTL_HOURS` (default 24),
   the next data-serving GET request (or server boot with a stale cache)
   starts a **background refresh automatically** and answers with an
   `X-Auto-Refresh: stale` header. The current request keeps serving the
   current valid dataset; it never waits for the refresh.
3. **Manual refresh**: `POST /api/data/refresh` (always attempts immediately,
   bypassing the failure cooldown below).

Fresh-cache requests never trigger anything. Health, status, integrity, and
refresh endpoints never trigger automatic refreshes.

Protection: in-memory flag (fast path) plus the SQLite `refresh_locks` mutex
(cross-process authority, atomic acquire, `409 REFRESH_IN_PROGRESS` on
collision, always released in `finally`, stale-lock recovery on boot).
Concurrent stale requests share exactly one refresh; `GET /api/data-status`
reports `inProgress`, the SQLite `lock` row, and live `progress` while a
refresh runs.

Failure safety: before any write, the current dataset (countries, indicators,
observations) is stashed to TEMP tables. On **total** failure the previous
dataset is restored atomically (`error.datasetRestored`), the failed run
stays recorded in `fetch_runs` with its error, and the old rankings keep
serving. Partial success (≥ 1 indicator) keeps its valid rows by design and
is recorded as success with per-indicator errors. Automatic triggers back off
for 15 minutes after a recorded failure (`AUTO_REFRESH_FAIL_COOLDOWN_MS`), so
a down World Bank API cannot cause a refresh loop; manual refreshes are
unaffected. Disable stale auto-refresh with `WB_AUTO_REFRESH_ON_STALE=0`.

Every refresh is logged in `fetch_runs` with full provenance.

## HTTP API

| Method & path | Purpose |
|---|---|
| GET `/api/health` | liveness + methodology |
| GET `/api/years` | available year range (from stored data) |
| GET `/api/india/gdp-ranking?startYear=&endYear=` | one row per year × four metric groups |
| GET `/api/ranking?indicator=&year=&page=&pageSize=&search=` | full level ranking, paginated, searchable (search never renumbers) |
| GET `/api/ranking/verify?indicator=&year=&country=&neighbors=` | focus + N above/below from the same ranked array |
| GET `/api/yoy-ranking?...` | full YoY ranking, paginated, searchable |
| GET `/api/yoy-ranking/verify?...` | YoY focus + neighbors + coverage block |
| GET `/api/coverage?year=&fromYear=&toYear=&indicator=` | coverage panels + CASE A/B/C/D explanation |
| GET `/api/observations?indicator=&year=&country=` | source rows with `value`, `valueRaw`, `wbLastUpdated`, `fetchedAt` |
| GET `/api/countries?includeAggregates=` | metadata with aggregate flags |
| GET `/api/metadata` | indicators, universe counts, methodology |
| GET `/api/data-status` | cache age/TTL, lock, integrity summary, recent runs |
| GET `/api/integrity` | full A–J integrity report |
| POST `/api/data/refresh` | manual refresh `{startYear, endYear, indicators}` |

Validation: unknown indicators/years → 400; inverted ranges → 400;
concurrent refresh → 409; unknown routes → 404. Error responses are JSON
without stack traces. Calculated responses embed methodology/source metadata.

## Test fixtures and live audit

- `backend/test/fixtures/wb-snapshot.json` — versioned World Bank source rows
  (test/audit fixture, **not** production data; stores no ranks).
  Covers 2004–2025 and all four indicators plus metadata and provenance.
- `backend/test/fixtures/edgeCases.js` — tiny synthetic dataset (ties, zero,
  null, blank-ISO3, aggregates, unknown ISO3) for deterministic edge tests.
- `npm test` — full suite (unit + stub-API integration + HTTP API tests);
  never touches the live API or the real database (in-memory DBs + local stub).
- `node src/scripts/createSnapshot.js --start 2004 --end 2025` — regenerate
  the versioned snapshot from the live API.
- `node src/scripts/liveAudit.js --years 2004,2014,2020,2021,2024,2025` —
  recalculate acceptance ranks from the live API (comparison only; never
  hardcoded into ranking logic).

## Data vintage and acceptance results

Current vintage: World Bank `lastupdated = 2026-07-13` (all four series).

Current-price audit references (same-vintage reproduction expected; never
forced — report new results if the vintage changes):

| Year | Nominal current | PPP current |
|---|---|---|
| 2004 | 171/209 | 148/195 |
| 2014 | 172/213 | 146/199 |
| 2020 | 169/210 | 140/199 |
| 2021 | 167/210 | 138/199 |
| 2024 | 155/200 | 133/195 |
| 2025 | 144/186 | 124/185 |

Constant-series ranks (same vintage, independently calculated):

| Year | Nominal constant 2015 | PPP constant 2021 |
|---|---|---|
| 2004 | 173/203 | 154/193 |
| 2014 | 167/210 | 145/199 |
| 2020 | 164/208 | 140/199 |
| 2021 | 162/208 | 138/199 |
| 2024 | 148/199 | 133/195 |
| 2025 | 135/186 | 124/185 |

## Data integrity checks (查 A–J)

`GET /api/integrity` (and boot log) report: A null insertion, B aggregate
insertion, C unknown ISO3, D duplicates, E invalid years, F non-finite values
and `value_raw` round-trip, G pagination provenance, H exactly-four
indicators, I India observations per indicator, J metadata consistency.
Empty databases pass vacuously; partial ingestion fails loudly.

## Provenance

Every production value traces to a World Bank observation via `fetch_runs`
(endpoint, requested/fetched ranges, indicators, timestamps, `lastupdated`,
rows received/accepted/rejected per meaning, pages/requests, universe
snapshot, run id) plus per-row `wb_last_updated`/`fetched_at`. No synthetic,
interpolated, third-party, or hardcoded production values exist; `A=100`-style
fixtures live only in isolated tests and never enter `backend/data/worldbank.db`.
