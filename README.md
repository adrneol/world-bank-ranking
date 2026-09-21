# World Bank — India GDP per Capita Ranking

A data-verification application that retrieves World Bank World Development
Indicators (WDI) and independently calculates India's yearly GDP-per-capita
value, year-over-year change, rank, and denominator for four indicators.

> The World Bank provides the underlying observations. Historical country ranks
> shown by this application are calculated by this application from those
> observations.

## Overview

For each of four GDP-per-capita indicators, the application ingests official
World Bank observations, filters out aggregate entities, ranks every eligible
country/economy by raw value, and shows exactly where India stands — with the
raw numbers, the neighboring countries, and the audit trail needed to verify
each result. A React frontend presents the results; an Express API serves
backend-calculated numbers; SQLite stores the retrieved observations.

## Features

- Four World Bank GDP-per-capita indicators, ranked independently
- India yearly table: value, YoY %, rank and denominator per year and metric
- Year-range filtering and selected-year comparison
- Level rank verification with configurable neighbor windows
- Full country ranking with pagination and country/ISO3 search
- Separate YoY ranking with its own denominator, plus YoY verification
- YoY coverage (current/previous valid counts, valid pairs)
- Data coverage panels and evidence-only changing-totals explanations
- Audit/source transparency, including raw-value visibility
- Data status, integrity checks, and manual refresh with progress
- Responsive frontend (desktop, tablet, mobile)

## Indicators

| Indicator | World Bank code | Unit |
|---|---|---|
| Nominal GDP per capita | NY.GDP.PCAP.CD | current US$ |
| Nominal GDP per capita | NY.GDP.PCAP.KD | constant 2015 US$ |
| GDP per capita, PPP | NY.GDP.PCAP.PP.CD | current international $ |
| GDP per capita, PPP | NY.GDP.PCAP.PP.KD | constant 2021 international $ |

The constant-price series come directly from the corresponding World Bank
indicators. They are not derived from current-price data, price indices, or
any frontend conversion. The four series have different units and are never
averaged or combined into a score.

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

## Data Coverage

Every year × indicator reports the eligible universe, the valid-observation
count, and the missing count, so denominators are never mistaken for a world
country total. When totals change between years, the application explains why
using only stored facts (metadata-universe change, observable filtering
differences, or observation coverage), and states when evidence is
insufficient. It does not invent reasons for missing observations.

## Architecture

```
World Bank WDI API
  → ingestion (country metadata, indicator metadata, observations)
  → country metadata filtering (aggregates removed)
  → SQLite (raw values preserved)
  → backend ranking / YoY / coverage / verification services
  → Express JSON API (finished numbers only)
  → React + Vite frontend (display only)
```

- Frontend: React + Vite (`frontend/`)
- Backend: Node.js + Express 5 (`backend/src/server.js`)
- Database: SQLite via `node:sqlite` (`backend/data/worldbank.db`, created locally by ingestion)
- Data source: World Bank WDI API (open, no API key)

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

## Environment Variables

Only public, browser-visible configuration belongs in frontend environment
files. The backend needs no API key.

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | frontend | Backend base URL. Empty means relative `/api` (local proxy / same host). |
| `PORT` | backend | API listen port (default 3001). |
| `CACHE_TTL_HOURS` | backend | Cache freshness window (default 24). |
| `DATABASE_FILE` | backend | SQLite file (default `data/worldbank.db`). |

See `frontend/.env.example` and `backend/.env.example`. Real `.env` /
`.env.local` files are local-only and never committed. Never commit secrets;
this project has none to configure.

## Testing

- Backend: `npm test` in `backend/` — 141 tests covering configuration,
  country universe, ranking, ties, denominators, YoY, YoY ranking, pagination,
  World Bank client behavior (retries, pagination completeness, error
  envelopes), ingestion, refresh locking, cache TTL, coverage cases, services,
  and HTTP endpoints. All 141 pass.
- Frontend: `npm run lint` and `npm run build` in `frontend/` — both pass.
  Integration is verified against the running backend (all views, filters,
  pagination, search, verification, refresh) with headless-browser checks.

## Data / Refresh

SQLite acts as a persistent cache: the application does not query the World
Bank on every frontend request. Data is refreshed when the database is empty
(automatic on server start), when the cache exceeds its TTL (automatic
background refresh, guarded so concurrent requests share one run), or
manually via `POST /api/data/refresh`. Refresh state, lock state, and recent
runs are visible through `GET /api/data-status`. A failed refresh is recorded
and the previous valid dataset keeps serving; automatic retries back off
instead of looping.

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
  src/db/            SQLite schema and repository
  test/              backend test suite and fixtures
```

Generated files (`node_modules/`, `dist/`, `backend/data/`, local `.env`
files) are not part of the repository.

## Disclaimer / Scope

- World Bank data may be revised; retrieved vintages are recorded with every
  ingest (recent vintage: `lastupdated` 2026-07-13) and shown in the UI.
- Historical rankings are calculated from the retrieved observations for the
  recorded vintage, not published by the World Bank.
- Rank positions depend on the selected data vintage and the valid
  observations available for each year and indicator.
