IMPLEMENT THE APPLICATION NOW.

You have already completed reconnaissance against the live World Bank API. Build the application according to the architecture and rules below.

The application is specifically a World Bank data/ranking verification tool for INDIA'S GDP PER CAPITA.

Do not broaden the scope into a general economic dashboard.

============================================================
1. CORE OBJECTIVE
============================================================

Build a full-stack application that retrieves World Bank World Development Indicators (WDI) data and independently calculates India's yearly:

- GDP per capita value
- YoY change
- rank
- total number of eligible countries/economies with valid data

for EXACTLY FOUR indicators:

1. Nominal GDP per capita — CURRENT
   Code: NY.GDP.PCAP.CD
   Unit: current US$

2. Nominal GDP per capita — CONSTANT
   Code: NY.GDP.PCAP.KD
   Unit: constant 2015 US$

3. GDP per capita PPP — CURRENT
   Code: NY.GDP.PCAP.PP.CD
   Unit: current international $

4. GDP per capita PPP — CONSTANT
   Code: NY.GDP.PCAP.PP.KD
   Unit: constant 2021 international $

These are the ONLY four primary metrics in this application.

Do NOT add:
- GNI
- total GDP
- GDP growth
- inflation
- unemployment
- exports
- imports
- FDI
- any composite score
- any third-party ranking

unless explicitly requested later.

============================================================
2. WORLD BANK IS THE SOURCE OF THE DATA
============================================================

Use the official World Bank WDI API.

API base:

https://api.worldbank.org/v2

Indicators:

NY.GDP.PCAP.CD
NY.GDP.PCAP.KD
NY.GDP.PCAP.PP.CD
NY.GDP.PCAP.PP.KD

Official indicator pages:

https://data.worldbank.org/indicator/NY.GDP.PCAP.CD
https://data.worldbank.org/indicator/NY.GDP.PCAP.KD
https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD
https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.KD

The application must clearly distinguish:

SOURCE DATA
from
CALCULATED RESULTS.

World Bank provides the observations.

This application calculates the rankings.

Never claim that the World Bank itself publishes India's historical rank unless the actual World Bank source explicitly provides such a rank.

Use wording:

"Rank calculated from World Bank WDI observations."

============================================================
3. IMPORTANT: FOUR SERIES ARE FOUR INDEPENDENT RANKINGS
============================================================

For every year, calculate FOUR separate rankings.

Example for 2025:

A. Nominal current rank
B. Nominal constant-2015 rank
C. PPP current rank
D. PPP constant-2021 rank

Do NOT combine the four metrics into a single ranking.

Do NOT average the four rankings.

Do NOT compare the numerical values across these four metrics as though they have the same unit.

Each metric has its own:

- value
- country universe with valid data
- denominator
- rank
- neighboring countries
- YoY calculation

============================================================
4. COUNTRY UNIVERSE
============================================================

This is one of the most important parts of the application.

The World Bank API contains both actual countries/economies and aggregate entities.

Do NOT rank every row returned by country/all.

Use World Bank country metadata to build the eligible universe.

An entity should be treated as an aggregate if:

- region.id === "NA"
OR
- region.value === "Aggregates"
OR
- ISO3 is blank

Observation eligibility:

1. observation value must not be null
2. ISO3 must not be blank
3. ISO3 must correspond to a country/economy in the metadata
4. matched metadata entity must not be an aggregate

Never convert null to zero.

Never rank:

- World
- regions
- income groups
- lending groups
- IDA totals
- OECD totals
- South Asia aggregate
- EU aggregate
- other aggregate entities

The implementation must retain the exclusion logic in one clearly named module.

============================================================
5. IMPORTANT DISTINCTION:
COUNTRY UNIVERSE VS VALID DATA COUNT
============================================================

Do NOT call every denominator "number of countries in the world."

For every YEAR + METRIC, distinguish:

A. eligible country/economy universe
B. eligible entities with a valid observation
C. eligible entities without a valid observation

Example:

Metadata universe:
217 eligible countries/economies

2025 nominal:
186 have valid data
31 have no observation

Therefore:

India rank = 144 / 186

The denominator means:

"India's position among 186 eligible countries/economies with a valid World Bank observation for this indicator in 2025."

It does NOT mean:

"India is ranked 144 out of all countries in the world."

============================================================
6. CHANGING COUNTRY TOTALS — VERY IMPORTANT
============================================================

The UI must explicitly explain why the denominator can change from year to year.

For example:

2004:
Nominal valid observations = X

2014:
Nominal valid observations = Y

2025:
Nominal valid observations = Z

The application must NOT silently treat this as an error.

Create a "Why does the total change?" explanation.

But this explanation must ONLY state reasons supported by the actual data.

DO NOT make assumptions.

Use the following logic:

CASE A:
If the eligible metadata universe is stable but some eligible countries have no observation for a given year/indicator:

State:

"World Bank WDI has valid observations for X eligible countries/economies for this indicator in this year. Y eligible entities do not have a usable observation."

This can be described as data availability/coverage for that indicator-year.

DO NOT say:
"World Bank only has X countries in the world."

CASE B:
If the underlying eligible metadata universe itself changes between years:

Show:

"The eligible World Bank country/economy metadata universe changed between these observations."

Then show the actual metadata difference.

Do NOT speculate why the metadata changed.

CASE C:
If the difference comes from aggregate filtering:

State that aggregate entities are excluded from the ranking.

Do not attribute the change to missing country data.

CASE D:
If there is insufficient evidence to establish the reason:

State:

"The number of ranked entities differs between years. The application can establish the observed data coverage and filtering difference, but does not infer a cause beyond the World Bank data."

This rule is extremely important.

Never invent explanations such as:

- "The country did not report"
- "World Bank forgot the country"
- "The country was excluded by World Bank"
- "The country did not submit data"

unless the actual source explicitly establishes that fact.

============================================================
7. COVERAGE PANEL
============================================================

Create a coverage panel for every metric.

For each selected year show:

METRIC
Year
Eligible metadata universe
Valid observations
Missing observations
India available? yes/no
India rank denominator

Example:

2025 — Nominal Current

Eligible universe: 217
Valid observations: 186
No usable observation: 31
India available: Yes
India rank: 144 / 186

Then show the same for:

Nominal Constant 2015
PPP Current
PPP Constant 2021

The four coverage counts may differ.

Do not assume they are identical.

============================================================
8. YEAR FILTER
============================================================

The user must be able to select:

Start Year
End Year

Example:

2000 → 2025

Other valid ranges:

2004 → 2014
2014 → 2025
2010 → 2020

Years must be dynamically determined from available database observations/metadata.

Do not hardcode only 2000–2025.

If the database has newer data available, expose it.

Default:
2000 → latest available year.

============================================================
9. IMPORTANT YEAR-BOUNDARY RULE FOR YoY
============================================================

Suppose the user selects:

2010 → 2025

The application still needs 2009 data in the backend so that:

2010 YoY =
((2010 value / 2009 value) - 1) × 100

Therefore ingestion must fetch:

startYear - 1

through

endYear

when YoY is required.

The UI should still show only:

2010 → 2025

Do not display 2009 as a selected result year unless the user explicitly requests it.

============================================================
10. INDIA'S MAIN YEARLY TABLE
============================================================

Create the primary India table.

ONE ROW PER YEAR.

Columns:

Year

NOMINAL CURRENT
- Value
- YoY %
- Rank
- Total

NOMINAL CONSTANT 2015
- Value
- YoY %
- Rank
- Total

PPP CURRENT
- Value
- YoY %
- Rank
- Total

PPP CONSTANT 2021
- Value
- YoY %
- Rank
- Total

Example structure:

Year |
Nominal Current Value |
Nominal Current YoY |
Nominal Current Rank |
Nominal Current Total |
Nominal Constant Value |
Nominal Constant YoY |
Nominal Constant Rank |
Nominal Constant Total |
PPP Current Value |
PPP Current YoY |
PPP Current Rank |
PPP Current Total |
PPP Constant Value |
PPP Constant YoY |
PPP Constant Rank |
PPP Constant Total

Make the four metric groups visually distinct.

============================================================
11. RAW PRECISION
============================================================

All calculations must use the raw World Bank numerical value.

Example:

Raw:
2702.47987141553

Display:
$2,702

Ranking uses:

2702.47987141553

NOT:

2702

Do not round before:

- ranking
- YoY
- comparisons
- sorting
- tie detection

Only format/round at presentation time.

============================================================
12. VALUE FORMATTING
============================================================

Display:

Nominal current:
$2,702

Nominal constant:
$2,523

PPP current:
$11,748

PPP constant:
$10,039

But these are merely examples of formatting.

Use actual data.

Clearly label units:

current US$

constant 2015 US$

current international $

constant 2021 international $

Never display "$" alone when the metric is actually international dollars if that could create ambiguity.

============================================================
13. YoY CALCULATION
============================================================

For every metric independently:

YoY % =
((current_year_raw_value / previous_year_raw_value) - 1) * 100

Use raw values.

If current year or previous year is missing:

YoY = null

If previous value <= 0:

Do not calculate the normal percentage.

Return null and an explicit reason in audit/debug information.

Do not convert invalid YoY into 0%.

============================================================
14. LEVEL RANKING
============================================================

For every year and every one of the four indicators:

1. retrieve every eligible country observation
2. remove missing/null observations
3. sort descending by raw value
4. use ISO3 as deterministic secondary ordering key
5. assign a 1-based position

Sort:

value DESC
ISO3 ASC

Rank:

1-based array position

This produces deterministic ordinal positions.

Document:

"Ties are ordered deterministically by ISO3; tied values therefore receive distinct ordinal positions rather than shared ranks."

Do not use:
- competition ranking
- dense ranking
- arbitrary API order

unless explicitly changed later.

============================================================
15. FOUR INDIA RANKS PER YEAR
============================================================

For each year expose:

nominalCurrent:
  indiaValue
  indiaYoY
  indiaRank
  total

nominalConstant:
  indiaValue
  indiaYoY
  indiaRank
  total

pppCurrent:
  indiaValue
  indiaYoY
  indiaRank
  total

pppConstant:
  indiaValue
  indiaYoY
  indiaRank
  total

The frontend must never calculate these itself.

Backend is the source of truth.

============================================================
16. RANK VERIFICATION
============================================================

For every year and each of the four metrics, the user must be able to open:

"Verify ranking"

Example:

YEAR:
2025

METRIC:
Nominal GDP per capita — current US$

India:
Rank 144 / 186
Raw value: 2702.47987141553
Displayed value: $2,702

Then show:

Rank | Country | ISO3 | Raw Value | Display Value

139 | ...
140 | ...
141 | ...
142 | ...
143 | ...
144 | India | IND | 2702.47987141553 | $2,702
145 | ...
146 | ...
147 | ...
148 | ...
149 | ...

Default:
5 countries above
India
5 countries below

Make neighbor count configurable.

============================================================
17. DO THIS FOR ALL FOUR METRICS
============================================================

The verification interface must have a metric selector:

[Nominal Current]
[Nominal Constant 2015]
[PPP Current]
[PPP Constant 2021]

The selected metric controls:

- ranking
- denominator
- neighboring countries
- raw value
- unit

Never accidentally display neighboring countries from another metric.

============================================================
18. FULL RANKING VIEW
============================================================

Provide a full ranking view for a selected:

Year
Metric

Example:

Year: 2025
Metric: PPP constant 2021

Rank | Country | ISO3 | Value

1
2
3
...
124 India
...
185

Implement pagination.

Also allow:

Search country by:
- country name
- ISO3

The selected country's rank and raw value should be visible.

============================================================
19. INDIA NEIGHBOR VERIFICATION
============================================================

Make India visually distinct in the verification ranking.

If:

India rank = 144
Total = 186

show:

139
140
141
142
143
144 INDIA
145
146
147
148
149

The user should immediately be able to verify that exactly 143 valid rows occur before India.

============================================================
20. YOY RANKING — SEPARATE FROM LEVEL RANKING
============================================================

Keep these two concepts completely separate.

LEVEL RANK:
Countries sorted by GDP-per-capita value.

YOY RANK:
Countries sorted by GDP-per-capita percentage change.

Do not mix them.

Add a separate:

"YoY ranking"

view.

For selected:

Year
Metric

show:

Rank
Country
ISO3
Previous-year raw value
Current-year raw value
YoY %

For example:

2025
Nominal Current

Rank | Country | Previous | Current | YoY %

...

India | ... | ... | ... | ...%

...

India's YoY rank must be calculated against all eligible countries for which BOTH previous and current observations exist and YoY can be validly calculated.

The denominator for YoY ranking may therefore differ from the denominator for level ranking.

Show that denominator explicitly.

============================================================
21. YOY RANK VERIFICATION
============================================================

The same neighbor verification should exist for YoY ranking.

For India:

5 countries above
India
5 countries below

Display:

Rank
Country
Previous value
Current value
YoY %

Do this independently for all four metrics.

============================================================
22. COVERAGE FOR YOY
============================================================

For each year + metric:

Show:

Eligible universe
Current-year valid observations
Previous-year valid observations
Valid YoY observations

Example:

2025 PPP Current

Eligible universe: 217
2024 valid observations: X
2025 valid observations: Y
Valid YoY pairs: Z

India:
Current value available: Yes
Previous value available: Yes
YoY calculable: Yes

Do not use current-year denominator as the YoY denominator unless they happen to be equal.

============================================================
23. LIVE WORLD BANK DATA
============================================================

Data ingestion must:

- use official WDI API
- handle pagination
- follow API metadata
- validate response structure
- support year ranges
- retry failures
- use exponential backoff
- honor Retry-After
- validate HTTP-200 error-shaped API responses
- never silently accept malformed data
- never treat null as zero

Never assume page 1 is the complete dataset.

Pagination must be driven by:
- pages
- total
- per_page

not by an arbitrary hardcoded page count.

============================================================
24. DATABASE
============================================================

Use:

Node.js 24+
Express 5
SQLite via node:sqlite

Keep:

backend/
frontend/

Database structure:

countries
indicators
observations
fetch_runs

observations:

PRIMARY KEY:
(country_id, indicator_id, year)

Keep raw numeric values at full precision.

Only valid non-null observations need to be stored.

Absence of a row means no stored observation.

Do NOT insert zero for missing data.

============================================================
25. DATA SNAPSHOT / TESTING
============================================================

Normal automated tests must NOT depend on the live World Bank API.

Create versioned test fixtures/snapshots generated from the current WDI data.

Record:

- API lastupdated
- retrieval timestamp
- indicator codes
- relevant country metadata
- relevant observations

Run deterministic tests against those fixtures.

Also create a separate explicitly invoked live audit/smoke test.

============================================================
26. CURRENT LIVE ACCEPTANCE CHECK
============================================================

The reconnaissance produced the following current World Bank ground truth using:

metadata join
aggregate filtering
blank ISO3 exclusion
value DESC
ISO3 ASC

Current expected results:

Year | Nominal Rank/Total | PPP Rank/Total

2004 | 171/209 | 148/195
2014 | 172/213 | 146/199
2020 | 169/210 | 140/199
2021 | 167/210 | 138/199
2024 | 155/200 | 133/195
2025 | 144/186 | 124/185

These are acceptance/audit values for the current retrieved dataset, NOT permanent universal truths.

World Bank data can be revised.

The live audit command should recalculate them from the current API rather than hardcoding them into production.

The snapshot tests can use a versioned copy of the data that produced these results.

============================================================
27. EXPECTED INDIA RAW VALUES
============================================================

Current live reconnaissance:

2025 nominal current:
2702.47987141553

Display:
$2,702

2025 PPP current:
11747.9160436011

Display:
$11,748

Use these only as current audit expectations for the current World Bank dataset.

Do not hardcode them into ranking logic.

============================================================
28. CONSTANT SERIES
============================================================

The constant-price series must come DIRECTLY from the World Bank indicators:

NY.GDP.PCAP.KD

and:

NY.GDP.PCAP.PP.KD

Do NOT calculate constant GDP per capita yourself from the current-price series.

Do NOT use CPI.

Do NOT divide current GDP by an inflation index.

Do NOT derive constant 2015 dollars manually.

Do NOT derive constant 2021 international dollars manually.

The World Bank's published constant-price observations are the source data.

============================================================
29. CURRENT VS CONSTANT
============================================================

The UI must make clear that:

Nominal current:
current US$

Nominal constant:
constant 2015 US$

PPP current:
current international $

PPP constant:
constant 2021 international $

Do not imply that the constant and current series are the same measure expressed differently through a simple frontend conversion.

They are separate World Bank indicator series.

============================================================
30. FOUR-METRIC COMPARISON
============================================================

Provide an optional compact India comparison section for a selected year:

Metric | India value | YoY | Rank | Total

Nominal current
Nominal constant 2015
PPP current
PPP constant 2021

This allows the user to compare India's four positions for the same year.

Do not create an overall score.

============================================================
31. PERIOD FILTER
============================================================

Support year ranges such as:

2000–2025
2004–2014
2014–2025

The table should show EVERY year in the selected interval for which the relevant data can be calculated.

Do not compress the results into only start and end years.

The user must be able to inspect year-by-year movements.

============================================================
32. RANK CHANGE
============================================================

Optionally show:

Rank change from previous year

Example:

2024 rank:
X

2025 rank:
Y

Rank movement:
Y - X

Be explicit about the direction.

For example:

"Rank position changed from 160 to 144."

Do not describe that as economically "better" or "worse."

Apply this independently to all four level rankings.

Do not confuse a numerical rank movement with economic performance.

============================================================
33. DATA AUDIT PANEL
============================================================

Create an audit panel showing:

Source:
World Bank World Development Indicators

API base URL

Indicator code

Indicator name

Unit

World Bank lastupdated

Local retrieval timestamp

Selected year

Eligible metadata universe

Valid observations

Missing observations

Rank methodology

Tie-break methodology

India raw value

India displayed value

Previous-year raw value

YoY formula

YoY denominator

This is a verification application, so transparency is more important than decorative UI.

============================================================
34. REFRESH SYSTEM
============================================================

Use SQLite as persistent cache.

Do NOT query World Bank on every frontend request.

Refresh:

- when database is empty
- when TTL expires
- manually through refresh button/API

Implement a refresh lock.

Do not allow two simultaneous refreshes to ingest the same dataset.

Record each refresh in:

fetch_runs

Include:

- started_at
- completed_at
- endpoint
- requested date range
- indicators
- World Bank lastupdated
- rows retrieved
- rows upserted
- status
- error message if applicable

============================================================
35. API ENDPOINTS
============================================================

Implement clean backend APIs.

Suggested:

GET /api/years

GET /api/india/gdp-ranking?startYear=2000&endYear=2025

GET /api/ranking?indicator=nominal_current&year=2025

GET /api/ranking?indicator=nominal_constant&year=2025

GET /api/ranking?indicator=ppp_current&year=2025

GET /api/ranking?indicator=ppp_constant&year=2025

GET /api/ranking/verify?indicator=...&year=2025&country=IND&neighbors=5

GET /api/yoy-ranking?indicator=...&year=2025

GET /api/yoy-ranking/verify?indicator=...&year=2025&country=IND&neighbors=5

GET /api/coverage?year=2025

GET /api/observations?indicator=...&year=2025&country=IND

GET /api/countries

GET /api/metadata

GET /api/data-status

GET /api/health

POST /api/data/refresh

Improve endpoint names if needed, but maintain the separation between:

- raw observations
- level ranking
- YoY ranking
- coverage
- verification

============================================================
36. FRONTEND
============================================================

Keep the frontend simple.

No need for elaborate graphics or animation.

Main structure:

WORLD BANK — INDIA GDP PER CAPITA RANKING

Year range:
[2000] → [2025]

Metric:
[All four] / individual metric selector

--------------------------------------------------

INDIA YEARLY DATA

Year
Nominal Current
Nominal Constant
PPP Current
PPP Constant

Each metric contains:
Value
YoY
Rank / Total

--------------------------------------------------

SELECTED YEAR

2025

Four metric cards or rows:

Nominal Current
Nominal Constant 2015
PPP Current
PPP Constant 2021

--------------------------------------------------

VERIFY INDIA'S RANK

Metric selector

Countries above
India
Countries below

--------------------------------------------------

FULL COUNTRY RANKING

Search
Pagination

--------------------------------------------------

YOY RANKING

Metric
Year

Full YoY ranking
India position
Neighbor verification

--------------------------------------------------

DATA COVERAGE

Explain denominator changes using ONLY verified facts.

--------------------------------------------------

AUDIT / SOURCE

World Bank
indicator codes
retrieval information
methodology

============================================================
37. NO ECONOMIC INTERPRETATION
============================================================

The application should present data and calculations.

Do not generate statements such as:

"India improved economically."

"India performed better."

"India became stronger."

"India overtook weaker countries."

"India is doing well."

Instead use precise factual language:

"India's rank changed from 172 to 155."

"India's GDP per capita increased from X to Y."

"Valid World Bank observations increased from X to Y."

Keep numerical interpretation separate from subjective economic judgment.

============================================================
38. TESTS
============================================================

Create comprehensive tests for:

- API pagination
- malformed API response
- retry behavior
- country metadata filtering
- aggregate exclusion
- blank ISO3 exclusion
- country/economy inclusion
- null handling
- four-indicator configuration
- raw precision
- level ranking
- ISO3 tie-breaking
- denominator calculation
- YoY
- YoY missing-data handling
- YoY ranking
- neighbor calculation
- rank 1 boundary
- final rank boundary
- N=0
- N > available
- year boundary
- refresh lock
- cache behavior

Create small artificial fixture:

Country A = 100
Country B = 90
India = 80
Country C = 70

Expected:
India rank = 3 / 4

Create tie fixture and verify deterministic ISO3 ordering.

============================================================
39. ACCEPTANCE TESTS
============================================================

Before frontend completion, run the backend tests.

Then run the live audit against current World Bank data.

Verify at minimum:

2004
2014
2020
2021
2024
2025

for the four indicators.

For every year/indicator verify:

- India raw value
- India rank
- denominator
- neighboring countries
- valid observation count

Also verify the following current live rank results where the same dataset/version is being used:

2004:
Nominal current = 171/209
PPP current = 148/195

2014:
Nominal current = 172/213
PPP current = 146/199

2020:
Nominal current = 169/210
PPP current = 140/199

2021:
Nominal current = 167/210
PPP current = 138/199

2024:
Nominal current = 155/200
PPP current = 133/195

2025:
Nominal current = 144/186
PPP current = 124/185

If the live World Bank dataset has changed from the reconnaissance snapshot, DO NOT force the old values.

Instead report:

- current World Bank result
- snapshot result
- World Bank lastupdated/retrieval metadata
- reason the two versions differ, if the data themselves establish one

Never alter the ranking algorithm simply to reproduce an older value.

============================================================
40. IMPORTANT: USER'S ORIGINAL THIRD-PARTY RANKING COMPARISON
============================================================

This application is intended partly to verify third-party tables such as Worldometer.

Therefore make it easy to answer:

"Why does this site's rank differ from another site's rank?"

Provide an audit summary containing:

Our World Bank calculated rank:
X / Y

Third-party claimed rank:
[optional user-entered value]

Our eligible universe:
Y

Third-party denominator:
[if entered]

And explain only objectively observable differences such as:

- different World Bank data vintage
- different indicator
- different year
- aggregate inclusion/exclusion
- different missing-data treatment
- different country universe
- different tie treatment
- different source

Do not automatically claim which methodology is correct merely because the ranks differ.

============================================================
41. ENVIRONMENT
============================================================

Create:

backend/.env.example

containing:

WORLD_BANK_API_BASE_URL=https://api.worldbank.org/v2

WORLD_BANK_NOMINAL_CURRENT_INDICATOR=NY.GDP.PCAP.CD
WORLD_BANK_NOMINAL_CONSTANT_INDICATOR=NY.GDP.PCAP.KD
WORLD_BANK_PPP_CURRENT_INDICATOR=NY.GDP.PCAP.PP.CD
WORLD_BANK_PPP_CONSTANT_INDICATOR=NY.GDP.PCAP.PP.KD

DEFAULT_START_YEAR=2000
DEFAULT_END_YEAR=2025
CACHE_TTL_HOURS=24
RANK_NEIGHBORS_DEFAULT=5

Do not create a fake World Bank API key.

Put .env in .gitignore.

============================================================
42. README
============================================================

Document:

- architecture
- installation
- frontend startup
- backend startup
- database
- World Bank API
- exact four indicators
- country-universe filtering
- aggregate handling
- missing-data handling
- denominator definition
- level ranking formula
- tie-break
- YoY formula
- YoY denominator
- cache
- refresh process
- data vintage
- test fixtures
- live audit command
- current acceptance/audit results

Explicitly state:

"The World Bank provides the underlying observations. Historical country ranks shown by this application are calculated by this application from those observations."

============================================================
43. IMPLEMENTATION ORDER
============================================================

Implement in this order:

PHASE 1
Configuration
Environment
Database schema
Repository layer

PHASE 2
World Bank API client
Pagination
Validation
Retries
Metadata ingestion
Four-indicator ingestion

PHASE 3
Country universe
Aggregate filtering
Coverage calculations

PHASE 4
Pure ranking engine
Four independent metric rankings
Tie-breaking
Denominators

PHASE 5
YoY engine
YoY ranking engine

PHASE 6
Verification engine
Neighbor selection
Full ranking pagination

PHASE 7
Tests
Fixture snapshots
Current live audit command

PHASE 8
Backend services/routes

PHASE 9
Frontend

PHASE 10
End-to-end testing
README
Final audit

============================================================
44. DO NOT MOVE ON PREMATURELY
============================================================

After each phase:

- run tests
- inspect results
- fix errors
- do not silently ignore failures

Most importantly:

DO NOT BUILD THE FRONTEND UNTIL:

1. all four indicators can be ingested,
2. aggregate filtering works,
3. missing-data handling works,
4. ranking calculations pass,
5. YoY calculations pass,
6. India rank tests pass,
7. the verification window works,
8. live audit calculations are reproducible.

The correctness of the backend ranking engine is more important than UI polish.

============================================================
45. FINAL PRINCIPLE
============================================================

The entire system must follow:

WORLD BANK RAW DATA
        ↓
COUNTRY METADATA
        ↓
REMOVE AGGREGATES
        ↓
REMOVE BLANK ISO3
        ↓
MATCH OBSERVATION TO ELIGIBLE COUNTRY
        ↓
KEEP RAW VALUES
        ↓
YEAR + INDICATOR
        ↓
VALID OBSERVATIONS
        ↓
SORT VALUE DESC + ISO3 ASC
        ↓
INDIA'S LEVEL RANK
        ↓
CALCULATE YOY FROM RAW VALUES
        ↓
CALCULATE INDIA'S YOY
        ↓
OPTIONAL YOY COUNTRY RANK
        ↓
SHOW VALID-COUNTRY DENOMINATOR
        ↓
SHOW ABOVE/INDIA/BELOW
        ↓
SHOW COVERAGE EXPLANATION
        ↓
FULL AUDITABLE RESULT

Build this now in Act mode.