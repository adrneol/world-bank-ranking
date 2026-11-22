# World Bank Economic Research Platform

An independent economic research application built on World Bank World Development
Indicators (WDI), source 2. Explore eligible economies, official aggregates and
custom groups with inspectable observations, calculations, coverage and provenance.

## Live website

[Open the research platform](https://world-bank-ranking.vercel.app/).
Public analytical requests use this same website origin. Publication is an optional
backend-authorized feature; a deployment may serve the human application without it.

## Economic research capabilities

Overview and historical charts, annual evidence, level and YoY rankings, two-entity
comparison, observed and like-for-like Movement, coverage, Audit, and Data Status.
The selected economy follows explicit URL/user choices before geolocation defaults.
Compare initializes its first entity from shared context and leaves its second empty.

## Supported indicator families

Twenty raw WDI indicators cover GDP per capita and total GDP (current US$, constant
2015 US$, current PPP international $, constant 2021 PPP international $), CPI
inflation, CPI index, GDP-deflator inflation, exports, imports, FDI inflows and
FDI/GDP, official exchange rate, current account, reserves excluding gold,
remittances, and population. The backend registry declares units, valid operations,
ranking direction and group aggregation. Unsupported calculations remain unavailable.

## Architecture

React renders backend-calculated results. Express validates bounded requests and
provides the same analytical handlers to human and optional public routes. WDI
retrieval validates source identity, complete pagination and vintage before an
atomic publication. libSQL supports a Turso primary and a local SQLite fallback.
Vercel functions forward explicitly allowed requests and render public documents.

## Technology stack

Node.js, Express, libSQL, SQLite/Turso, React, Vite, Recharts, Vitest and Node's test
runner. Use the committed lockfiles; no additional API gateway is required.

## Prerequisites

Node.js 22.12 or newer and npm. Use a supported Node release compatible with the
locked Vite version (Node 24 is used for verification). Network access to the
public World Bank API is needed for ingestion, not for isolated fixture tests.

## Installation

```powershell
cd backend
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
cd ../frontend
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Configure private values locally; never commit active ENV files or databases.
A public checkout needs no internal engineering notes, benchmark data or agent files.

## Local development

In separate terminals run `npm run dev` in backend and frontend. The frontend
uses Vite's local `/api` proxy to port 3001. Its location endpoint retains the
existing local/production trust boundary. `VITE_API_BASE_URL` is an optional
**development-only** override; production browser requests always use `/api`.

## Environment configuration

Both application `.env.example` files document actual supported settings. Existing
credentials and database targets must be supplied by the operator. All `VITE_`
values are public; never place a credential or private service address there.

For production, configure server-only `BACKEND_API_ORIGIN` on the frontend function
runtime to the existing private upstream service origin, without `/api`. Configure
an owner-provisioned `API_PROXY_SECRET` identically on frontend functions and backend.
These settings authenticate forwarded client identity; they do not authorize public
publication or replace the refresh bearer token. Missing forwarding settings fail
closed with 503. They are unnecessary for Vite's ordinary local proxy.

Public display metadata is optional. Site update date, source vintage and economic
observation years have separate meanings. Do not edit display metadata to imply
that a dataset is freshly verified.

## Database setup

`DB_MODE=local` uses a generic repository-relative SQLite file by default. Configure
Turso with server-only `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` if required.
Backend startup initializes its supported schema. Do not point tests at live data.
Never copy a fallback into primary merely because it has a larger generation number.

## World Bank ingestion and automatic years

`npm run ingest` in backend performs explicit ingestion; consult the script's
supported arguments before use. `WB_AUTO_INGEST_ON_EMPTY` and
`WB_AUTO_REFRESH_ON_STALE` control the existing startup/freshness mechanism.
`CACHE_TTL_HOURS` defaults to 24. One controlled maintenance scheduler shares the
same refresh locks and cooldowns; no ordinary public GET authorizes ingestion.

`INGEST_START_YEAR` defaults to 1960. Unset, blank or `auto` `INGEST_END_YEAR`
resolves the UTC year when each refresh begins, including across New Year without
restart. A numeric year remains an intentional acquisition cap. The legacy
`DEFAULT_END_YEAR` is an analysis preset, not an acquisition cap. Historical ranges
remain necessary because WDI revises and removes older observations.

Only validated published observations appear in availability. Indicators and
economies can publish at different times. Automatic selections follow the actual
metric/country/YoY/common-entity inputs; explicit historical URLs remain pinned.
History requests are bounded to 100 years and eight series.

## Analytical methodology and provenance

The application calculates ranks and derived results; the World Bank supplies the
underlying observations. Ranks exclude official aggregates. Missing data remains
missing; genuine zeros and negative values retain indicator-specific semantics.
Stored unrounded values drive arithmetic; raw decimal strings provide audit evidence.

GDP growth peers use the arithmetic mean of valid non-focus economy growth,
excluding the selected focus only when it belongs to the relevant population.
Observed intervals use their own eligible coverage; like-for-like uses the declared
shared universe. Neither is an official World aggregate or a weighted growth series.
Group aggregation and official aggregate observations remain distinct.

## Public read-only API

Only exact backend `PUBLIC_READ_API_ENABLED=1` enables optional public aliases.
New-installation templates default to disabled. The deprecated frontend publication
flag has no authority. Enabled discovery is available at `/public-data/` and
`/data-catalog.json`, with 31 typed operations and complete GET examples.

Discover years before constructing explicit numerical requests:

```text
https://world-bank-ranking.vercel.app/api/public/years
https://world-bank-ranking.vercel.app/api/public/availability?indicator=total_current&country=JPN
https://world-bank-ranking.vercel.app/api/public/focus/history?country=JPN&series=total_constant&startYear=2023&endYear=2025
https://world-bank-ranking.vercel.app/api/public/compare?entityA=country%3AUSA&entityB=country%3AJPN&indicator=total_current&yearA=2024&yearC=2025&operation=level
```

Examples are historical, not claims of current coverage. The API accepts explicit
numeric years, not the frontend `latest` sentinel. Documentation is server-readable
without JavaScript. Disabled publication returns 404; uncertain authority returns
retryable 503. Human pages and sitemap remain usable. Successful HTTP retrieval
cannot guarantee access through every AI vendor's URL-fetch client or search index.

## Performance architecture

Overview reads are batched; identical work shares active flights. Generation-aware
bounded caches retain analytical identity. Exact delta persistence avoids rewriting
unchanged observations. Provenance-only changes still perform required writes.
Analytical workspaces and chart code are lazy-loaded. Local resource measurements
are not provider billing estimates.

## Fault tolerance and recovery

A failed or incomplete refresh preserves the last validated published dataset.
Transient source failures receive bounded immediate retries and later guarded
automatic recovery; permanent upstream outages cannot be made successful locally.
Candidate publications and dataset generation advance atomically. Unchanged complete
checks advance freshness without changing content generation. Source-vintage and
metadata changes advance generation according to the publication contract.

Generation is persisted in `dataset_state.content_version`, starts at 1 on first
publication and is formatted as `vN`. It is not an ENV value, application version
or count of successful checks. Recovery requires content/coverage/provenance proof;
a higher or equal counter alone is insufficient. Fallback durability depends on
actual hosting storage, not on the existence of a local file in development.

## Security and access controls

The forwarding layer has a fixed route allowlist, fixed server-configured origin,
restricted methods, no redirect following and no cookie forwarding. Signed,
short-lived method/path-bound client identity uses Vercel's platform-overwritten
client IP header. Backend limits remain authoritative. When the shared key is configured, unsigned
analytical ingress is denied, preventing a separate direct-service read budget.
Health and capability checks remain available. Invalid forwarding claims never
become client identity.
Publication and human aliases share the same backend read budget for that identity.
Forwarded GET/HEAD requests remain passive even through human aliases; source
synchronization belongs to startup and maintenance. The only forwarded POST is the existing explicit refresh action, which retains its
backend bearer authorization and abuse limit. No development/admin route is exposed.

Production backend boot requires its existing `REFRESH_ADMIN_TOKEN` and explicit
`CORS_ORIGINS`. Public aliases are bounded, parameterized and rate-limited. Robots
policies guide discovery and never grant authorization. Moving URLs does not make
a previously public upstream address secret or revoke historical cached copies.

## Testing, lint and build

```powershell
cd backend
npm test
npm audit
cd ../frontend
npm test -- --pool=threads --maxWorkers=2
npm run lint
npm run build
npm audit
```

Backend isolation uses disposable databases and controlled WDI HTTP fixtures;
it clears remote credentials. Do not run tests against production credentials.
No internal ignored documentation or benchmark fixture is needed for normal tests.

## Deployment guidance

Release matched backend/frontend source through the owner's deployment workflow.
Set Vercel's project root to `frontend`, output to `dist`, and retain the explicit
function asset include and rewrites. Supply server-only origin and shared identity
key at function runtime; remove private origins from production `VITE_` settings.
Rebuild and redeploy after changing build configuration; restart services after
changing runtime configuration. Never publish secrets in dashboard screenshots.

Verify same-origin capability, documentation, catalog, an actual Overview and
Compare request, disabled/unavailable behavior in an isolated deployment, metadata,
location initialization and application navigation. Do not use a live refresh as a
smoke test. Deployment and remote settings are owner-controlled actions.

## Project structure

```text
backend/src/config.js      Registry and configuration
backend/src/wb/            Retrieval, validation and atomic ingestion
backend/src/db/            Schema, repository and libSQL access
backend/src/domain/        Economic calculation contracts
backend/src/services/      Analytical caches, availability and recovery
backend/test/              Disposable fixture regressions
frontend/api/              Hosting functions and same-origin forwarding
frontend/server/           Publication rendering and transport policy
frontend/src/              React workspaces, controls, charts and evidence
```

## Known limitations

Maintenance runs only while the hosting process executes. Suspension prevents
scheduled checks; startup restores stale-data eligibility. Continuously scheduled
execution requires owner-selected hosting capabilities. No keep-alive traffic or
paid external scheduler is assumed. Long upstream outages can leave valid but stale
data; Status distinguishes failed attempts from successful verification. Audit
retains deliberate historical selections and inspects the actual serving evidence.

## Data attribution and terms

Source: [World Bank WDI](https://databank.worldbank.org/source/world-development-indicators),
[Indicators API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581)
and [World Bank dataset terms](https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets).
Review indicator-specific provenance and licensing before reuse. This independent
application does not represent the World Bank.
