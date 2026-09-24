# Architecture Improvement Guardrails

## Purpose

This document is a refinement layer for `MajorArchitecturePlan.md`.

It does NOT replace the architecture plan and does NOT require the complete architecture document to be rewritten.

The architecture plan describes the intended v3 direction.

This document records the additional correctness constraints, mathematical clarifications, implementation safeguards, and decisions that must be kept in mind when implementing that plan.

The implementation agent MUST:

1. Read `MajorArchitecturePlan.md`.
2. Read this document.
3. Inspect the actual current codebase.
4. Treat the current working implementation as authoritative for existing behavior.
5. Treat the existing GDP/Total-GDP analytical system as protected.
6. Never implement a proposal blindly when the actual current code reveals a safer or more correct approach.
7. Never solve architectural problems by silently changing existing economic semantics.

The goal is:

CURRENT PROVEN SYSTEM
+
SAFE GENERIC EXTENSIONS
=
BROADER ECONOMIC ANALYSIS PLATFORM

not:

CURRENT SYSTEM
→ rewrite everything
→ hope the old results remain identical.

---

# 1. PROTECT THE EXISTING ANALYTICAL CORE

The existing analytical engines are already proven and must not be rewritten merely because new indicator families are being introduced.

Protected existing engines include:

- ranking
- YoY
- YoY ranking
- comparison
- growth comparison
- coverage
- universe
- existing formatting/data semantics
- refresh/data publication integrity

Before changing any existing engine, prove that the new requirement genuinely cannot be implemented by adding a generic extension around it.

Prefer:

existing engine
+
generic metadata
+
generic transformation
+
new validation

over:

new indicator-specific engine.

Do NOT create:

- inflationEngine.js
- fdiEngine.js
- exportsEngine.js
- importsEngine.js
- currencyEngine.js

unless an independent mathematical domain truly cannot be represented by the generic architecture.

The existing 8 GDP metrics are regression anchors.

Their current:

- values
- ranks
- denominators
- YoY
- comparison results
- movement decomposition
- missing-data behavior
- tie-breaking
- historical behavior

must remain unchanged.

Any unexplained GDP analytical difference is a release blocker.

---

# 2. CURRENT GDP METRICS ARE FROZEN

These metric keys remain unchanged:

- `nominal_current`
- `nominal_constant`
- `ppp_current`
- `ppp_constant`
- `total_current`
- `total_constant`
- `total_ppp_current`
- `total_ppp_constant`

Their World Bank identities remain:

- `nominal_current` → `NY.GDP.PCAP.CD`
- `nominal_constant` → `NY.GDP.PCAP.KD`
- `ppp_current` → `NY.GDP.PCAP.PP.CD`
- `ppp_constant` → `NY.GDP.PCAP.PP.KD`
- `total_current` → `NY.GDP.MKTP.CD`
- `total_constant` → `NY.GDP.MKTP.KD`
- `total_ppp_current` → `NY.GDP.MKTP.PP.CD`
- `total_ppp_constant` → `NY.GDP.MKTP.PP.KD`

Do not reinterpret these metrics.

Do not introduce:

- synthetic real-current GDP
- alternate-source GDP
- GDP growth as a level metric
- substituted WDI series

The current constant-price GDP → derived YoY approach remains valid.

Do not replace it with the World Bank published GDP-growth percentage simply because it exists.

---

# 3. INDICATOR REGISTRY MUST BE SEMANTIC, NOT JUST NUMERIC

A future metric is not merely:

"some number from WDI."

The registry must describe how that number can legitimately be used.

At minimum, future indicators should distinguish:

- level
- flow
- rate
- ratio
- index
- quoted exchange rate

and should define:

- unit
- price basis
- currency basis
- sign domain
- ranking behavior
- valid transformations
- aggregation capability
- derivation/provenance
- quotation convention where applicable.

Never assume that all numeric observations share GDP's mathematics.

---

# 4. WORLD BANK INDICATOR IDENTITY

World Bank indicator codes are non-secret configuration data.

They MAY remain visible in:

- `backend/.env.example`
- documentation
- tests
- canonical backend configuration

when needed for the current project structure.

However:

PRODUCTION INDICATOR IDENTITY MUST REMAIN CANONICAL.

If indicator codes are supplied through environment variables:

1. The registry must define the canonical expected code.
2. Environment configuration may supply the configured value.
3. Production must compare the configured value against the canonical expected code.
4. A mismatch must fail closed.
5. Arbitrary production indicator substitution must remain impossible.

Do NOT return to the old unsafe behavior where changing an environment variable silently changes the economic series.

Test-only overrides may exist only behind explicit test gating.

Never weaken this rule for convenience.

---

# 5. ENVIRONMENT FILE POLICY

Keep environment-specific configuration in environment variables.

Do NOT hard-code deployment secrets into source code.

### Safe to show in `.env.example`

These are configuration values, not secrets:

- World Bank API base URL
- verified World Bank indicator codes
- default UI start/end years
- cache TTL
- pagination settings
- retry settings
- timeout settings
- local port
- database file default
- local development CORS example
- other harmless project defaults

Example:

```env
WORLD_BANK_API_BASE_URL=https://api.worldbank.org/v2

WORLD_BANK_NOMINAL_CURRENT_INDICATOR=NY.GDP.PCAP.CD
WORLD_BANK_NOMINAL_CONSTANT_INDICATOR=NY.GDP.PCAP.KD
...
Must NEVER contain real secrets in .env.example

Examples:

REFRESH_ADMIN_TOKEN
API credentials
production secrets
private keys
authentication secrets

Use placeholders/comments only:
    #REFRESH_ADMIN_TOKEN=

Deployment-specific values

Production CORS/domain configuration may be documented with a safe placeholder/example.

Never commit a secret merely to make deployment configuration convenient.

The implementation must preserve the current fail-closed production behavior for required secrets.

6. DO NOT EXPOSE ENVIRONMENT SECRETS TO FRONTEND

Server-side secrets must remain backend-only.

In particular:

REFRESH_ADMIN_TOKEN

must never appear in:

React source
Vite public environment variables
frontend/.env
public/
frontend bundles
API responses
logs
error messages

Frontend should only receive data that is explicitly intended for the browser.

7. MATHEMATICAL TRANSFORMATIONS MUST BE TYPE-AWARE

Do NOT treat all indicators as GDP-like levels.

The transformation layer should explicitly distinguish:

LEVEL

ABSOLUTE_CHANGE

PERCENT_CHANGE

PERCENTAGE_POINT_CHANGE

INDEX_POINT_CHANGE

YOY

CAGR

GROUP_SUM

GROUP_RATIO_FROM_SUMS

CROSS_RATE

RANK

RANK_CHANGE

OBSERVED_VS_LIKE_FOR_LIKE

Each transformation must have:

valid input types
formula
invalid conditions
missing-value behavior
output unit
sign semantics
provenance.

Unsupported transformations must return:

UNAVAILABLE / UNSUPPORTED

with a reason.

Never manufacture a result simply because two numeric observations exist.

8. PERCENT CHANGE VS PERCENTAGE-POINT CHANGE

This is a strict economic-semantic rule.

For ordinary positive levels/flows:

((B / A) - 1) * 100

may be valid when the metric allows it.

For rates/percentage ratios such as inflation:

B - A

is the percentage-point change.

Example:

6% → 3%

must be:

-3 percentage points

NOT:

-50%

unless a separate explicitly requested relative-change operation is mathematically justified.

Do not silently reuse the GDP/YoY transform for inflation rates.

9. INDEX POINTS ARE NOT PERCENTAGE POINTS

Do not use "percentage points" for an arbitrary index.

Example:

REER:

105 → 110

is:

+5 index points

not:

+5 percentage points.

The transformation system should distinguish:

PP_CHANGE for rates / percentage ratios
INDEX_POINT_CHANGE for index series

This distinction must remain visible in API metadata and UI wording.

10. EXISTING YOY ENGINE MUST NOT BE MISUSED

The existing YoY engine is for level/flow-style percentage change over time with its existing validity rules.

It must not be repurposed so that:

inflation 6% → 3%

becomes:

-50% YoY

when the intended economic analysis is:

-3 percentage points.

For inflation-rate change, use a separate percentage-point transformation.

Similarly, a ranking of annual inflation change should rank the derived percentage-point values using the generic ranking mechanism rather than pretending that inflation itself underwent a normal GDP-like YoY calculation.

11. RANKING DIRECTION MUST BE SEPARATE FROM EXISTING GDP RANKING SEMANTICS

Current GDP ranking behavior is:

value DESC
ISO3 ASC
ordinal positions.

Do not modify that behavior.

If new metrics require ascending ranking, add a generic directional ranking capability.

Existing GDP ranking must continue behaving exactly as before.

Examples:

GDP level:
descending by value.

Inflation:
may offer "lower first" as a user-selected descriptive ordering.

FX level:
should not automatically have a "best" ranking.

NEUTRAL metrics should not force a "better/worse" interpretation.

Ranking order is not the same as economic desirability.

12. "LOWER IS BETTER" MUST NOT BE BAKED INTO THE DATA

Inflation can often be interpreted as stability-related where lower rates are preferred, but the raw metric itself should remain descriptive.

The registry should distinguish:

numerical ranking direction
interpretation/desirability

Do not turn every indicator into an implicit policy judgment.

Do not make the analytical backend say that an economy is "better" merely because it has a lower number.

UI language should remain factual.

13. CPI INFLATION NEEDS TWO LEVELS OF ANALYSIS

Annual CPI inflation and CPI index are different concepts.

Investigate/retain both where supported:

FP.CPI.TOTL.ZG → annual CPI inflation
FP.CPI.TOTL → CPI index

Use:

annual inflation
for:

annual inflation comparisons
annual inflation changes
inflation-vs-growth panels

Use:
CPI index
for:

cumulative endpoint price-level change
index-point change
derived cumulative inflation where valid

Do not confuse:

average annual inflation

with:

cumulative price-level change.

Label them separately.

14. CPI CROSS-COUNTRY CAVEAT

Do not rank countries by raw CPI index levels as if:

higher CPI index = more expensive economy.

CPI index is primarily a within-country price-index construct.

Cross-country analysis should emphasize:

inflation rates
inflation changes
official World Bank aggregate series where available
properly labelled descriptive member statistics

Do not invent a fake cross-country "cost of living" metric from CPI index levels.

15. CUSTOM GROUP INFLATION

A custom group must NOT automatically receive a fake "regional inflation" value.

Do not simply average country inflation and label it:

"Africa inflation"

or:

"Group inflation"

unless the methodology explicitly defines it as something else.

Safe initial approach:

member-level inflation table
unweighted member mean, explicitly labelled if included
median/min/max if useful
no claim that the result is an official regional inflation rate

Official World Bank aggregates must remain distinct.

16. OFFICIAL WORLD BANK AGGREGATES VS CUSTOM GROUPS

These are two different entity types.

Official World Bank aggregate:

use World Bank's published aggregate directly
label it as World Bank aggregate
never recompute it from country members merely to imitate the World Bank

Custom group:

user-selected countries
explicitly labelled User-selected group
never called an official region
computed only when mathematically valid.

Never hard-code continents/regions into the application.

17. GROUP AGGREGATION RULES

Examples:

SUM may be valid for:

total GDP
exports
imports
signed FDI flow
reserves
remittances
population
other genuinely additive flows/levels

SUM is NOT valid for:

GDP per capita
inflation
exchange rates
ratios
arbitrary indexes.

Ratios should generally be computed through:

sum(numerator) / sum(denominator)

when both raw legs are available and compatible.

Do not average ratios and call the result a group ratio unless that exact statistic is explicitly defined.

18. COUNTRY VS CUSTOM GROUP IS A COMPARISON, NOT AUTOMATICALLY A SHARED RANKING UNIVERSE

A custom group can be compared against a country.

That does not automatically mean the group should enter the same country leaderboard.

Keep:

COUNTRY RANKING

separate from:

ENTITY COMPARISON.

A user-selected group may have a total GDP greater than a country, but that does not mean the user-defined group should automatically become "rank #1" in the country ranking.

This prevents entity-type mixing.

19. LIKE-FOR-LIKE MUST KEEP ITS ORIGINAL MEANING

The existing like-for-like logic is trusted.

Reuse it.

But do not apply it mechanically to every entity pair.

It is naturally meaningful when there is an explicit member universe, especially:

country ranking universes
custom additive groups

For an official World Bank aggregate versus an individual country, do not automatically expose the existing entered/exited/common movement decomposition as though the aggregate were a list of member countries being ranked against India.

Official aggregates are already published entities.

20. TRADE BALANCE PROVENANCE

When World Bank provides an official trade-balance series matching the desired concept, investigate/use that official WDI series as the canonical published metric.

If exports − imports is calculated by the application as a validation or derived measure:

label it APP_DERIVED
store the exact legs and formula
require same entity
same year
same frequency
same price basis
both observations valid.

Never mix current-price exports with constant-price imports.

21. FDI SIGNED-FLOW HANDLING

FDI net inflows can be zero or negative.

Do not blindly calculate:

((B/A)-1)*100

when:

A = 0
A < 0
sign changes.

Use:

level
absolute change
percentage-point change for ratios
percent change only where valid

and return an explicit unavailable reason otherwise.

Do not fabricate a growth percentage for a signed flow.

22. FX QUOTATION CONVENTION IS PART OF THE DATA MODEL

If the series is:

LCU per USD

then:

increase = local currency depreciation versus USD

decrease = local currency appreciation versus USD.

This must be stored as metadata.

Never infer the direction again at arbitrary UI call sites.

Do not say:

"currency became stronger"

without checking the quotation convention.

23. FX LEVELS MUST NOT BE CROSS-COUNTRY RANKED NAIVELY

Example:

83 INR per USD
150 JPY per USD

does not mean:

JPY is numerically "weaker" simply because 150 > 83.

Those are different currencies and units.

FX comparisons should focus on:

movement
appreciation/depreciation
percent change
cross-rates where mathematically supported

not raw quoted-rate magnitude.

24. CROSS-RATES MUST BE TRACEABLE

If a cross-rate is derived:

INR per EUR

INR per USD / EUR per USD

then:

same year
same frequency
both World Bank FX legs
compatible quotation convention
both valid

must be required.

The response must expose:

both source codes
both raw values
formula
derived value
vintage information.

Missing leg:

→ unavailable.

Never substitute another source.

25. DYNAMIC FOCUS COUNTRY

India remains the default.

But:

omitted country parameter
→ default IND

explicit valid country
→ selected country

explicit invalid country
→ 400 INVALID_COUNTRY

Never silently turn an explicitly invalid country into India.

Do not mechanically replace every "India" string.

Classify India-specific occurrences:

historical/documentation content
regression fixtures
backward-compatible API aliases
actual analytical logic
frontend hard-coded focus copy

Only categories 3–5 need genericization as appropriate.

Existing India-based tests remain as regression anchors and should be supplemented with non-India matrix tests.

26. BACKWARD-COMPATIBLE API RULE

Do not claim existing routes are "byte-identical" if you add fields to their JSON.

Choose one of:

Keep legacy route response shapes unchanged and expose richer metadata through new generic routes.

or:

Explicitly define additive fields as backward-compatible and prove existing analytical fields remain identical.

Prefer preserving legacy route shapes where practical.

New generic endpoints may carry richer:

focus
metric metadata
capabilities
provenance
derivation

without altering old clients.

27. METRIC DEFINITION VS PRODUCTION ENABLEMENT

Do not register dozens of future metrics in a way that immediately makes the current database appear invalid or incomplete.

The architecture should distinguish:

DEFINED
SUPPORTED
PRODUCTION-ENABLED
INGESTED

A future metric may exist in metadata while still being disabled for ingestion.

Only enabled metrics enter the production refresh/integrity universe.

This prevents Phase 2 metadata work from accidentally breaking the current live dataset.

28. VINTAGE / REFRESH COHERENCE

The current refresh system publishes a coherent validated dataset.

Do not accidentally create a production state where:

GDP = one World Bank vintage
CPI = another
FX = another
FDI = another

without explicitly modelling that fact.

For initial production rollout, prefer:

one enabled production metric generation
→ one coherent successful refresh

Development/testing may ingest staged subsets.

If independent per-metric vintages become necessary later, design them explicitly rather than accidentally introducing them.

29. FOCUS SELECTION MUST NOT TRIGGER INGESTION

Changing:

India
→ China
→ USA
→ Indonesia

should normally be a query/presentation change.

It must not cause a separate World Bank download when the required observations already exist.

The database remains universe-wide.

Focus country changes:

WHO is being emphasized.

It does not change:

WHAT data the backend stores.

30. FRONTEND ARCHITECTURE

The frontend should evolve around:

WHO
WHAT
WHICH
WHEN

A global layer should answer:

Focus
Analysis
Metric
Period

Workspace-specific controls should appear only where relevant.

Do not continue the current pattern of presenting unrelated controls everywhere.

31. FRONTEND DESIGN DIRECTION

The goal is:

quiet
precise
editorial
economic
luxury
research-oriented
high-trust.

Avoid:

excessive animation
neon
gradients
crypto-dashboard look
gaming look
giant rounded cards
heavy glassmorphism
decorative motion
meaningless animated numbers.

Custom controls should be:

keyboard accessible
searchable where needed
compact
understated
consistent.

Do not introduce a huge UI framework without proving it is necessary.

32. COMPARE WORKSPACE

Comparison should eventually support valid combinations such as:

Country ↔ Country

Country ↔ official World Bank aggregate

Country ↔ custom country group

Custom group ↔ custom group

Official aggregate ↔ official aggregate

BUT the capability matrix must be metric-aware.

Do not let the frontend offer operations that the backend will reject.

Prefer backend-declared capabilities exposed through metadata.

Frontend should present options based on backend capability metadata rather than scattered conditions like:

if metric === "inflation".

33. COMPARISON ERROR SEMANTICS

Unsupported analysis must not return a misleading number.

Examples:

GDP per capita SUM:
→ NOT_AGGREGATABLE

FX official aggregate when no WB aggregate exists:
→ NO_OFFICIAL_AGGREGATE

Invalid transformation:
→ UNSUPPORTED_TRANSFORMATION

Missing required input:
→ unavailable with reason

Every unsupported operation should be explicit.

34. PROVENANCE

Every derived result must be distinguishable from a raw World Bank observation.

Use concepts such as:

RAW
APP_DERIVED

For APP_DERIVED values, preserve:

formula
input metric codes
input values where practical
source vintage
retrieval/run ID
methodology.

Never label application calculations as:

"World Bank published."

35. WORLD BANK SOURCE RULE

World Bank WDI remains the site's raw economic source.

Underlying source metadata may say, for example:

IMF IFS

when World Bank's own metadata identifies that source.

That does not make the site multi-source.

The site still ingests from World Bank WDI.

Do not substitute another provider simply because WDI lacks a requested series.

If WDI does not support the desired concept:

UNSUPPORTED BY WORLD BANK DATA.

36. IMPLEMENTATION ORDER

Preferred dependency order:

Phase 0
Architecture lock

Phase 1
Generic focus/entity abstraction

Phase 2
Measure/indicator metadata

Phase 3
Generic transformations

Phase 4
Entity comparison/group mathematics

Phase 5
New indicator ingestion

Phase 6
Frontend redesign

Phase 7
Hardening/regression/release

Do not ingest new indicators before their mathematical transformations and validity rules are implemented and tested.

37. GOLDEN REGRESSION REQUIREMENT

Before modifying existing architecture, capture golden responses for representative GDP cases.

Compare old vs new:

values
ranks
denominators
YoY
comparison outputs
movement decomposition
coverage
API response fields that are part of the legacy contract.

Any unexplained GDP difference is a release blocker.

The new architecture must prove:

OLD GDP INPUT
+
NEW ARCHITECTURE

SAME GDP ANALYTICAL OUTPUT.

38. TESTING PRIORITY

Every new mathematical feature requires independent oracle tests.

Minimum future test categories:

percent change
percentage-point change
index-point change
CAGR
zero base
negative base
sign change
signed flows
FX quotation direction
cross-rate
group sum
group refusal
weighted ratio
official aggregate vs custom group
observed vs like-for-like
focus-country switching
invalid country
unsupported entity combinations
provenance
legacy GDP differential tests.

Passing a generic suite is not enough.

The tests must demonstrate the economic semantics.

39. DO NOT TRUST THE ARCHITECTURE PLAN BLINDLY

MajorArchitecturePlan.md is the current proposal, not an unquestionable specification.

When implementation begins:

Read the plan.
Read this document.
Inspect the actual source code.
Revalidate the relevant World Bank series.
Check whether the proposed design still matches the current code.
If a plan detail conflicts with the actual proven implementation or mathematical reality, stop and resolve the conflict before coding.

Do not implement a contradictory instruction simply because it appears in the plan.

Do not silently change the architecture.

Report the conflict first.

40. NO BLIND WORLD BANK INDICATOR ADDITIONS

The indicator list in the architecture plan is a starting point.

Before adding a series:

verify the exact current WDI code
verify official name
verify units
verify current availability
verify country/aggregate coverage
verify source metadata
verify whether its semantics match the intended analysis
verify transformations
verify aggregation capability.

Do not rely solely on an old inventory.

WDI can change vintages, coverage, definitions, or availability.

41. CURRENT ARCHITECTURE DOCUMENTATION HIERARCHY

Use this documentation hierarchy:

README.md
= current implemented product/documentation
MajorArchitecturePlan.md
= current approved/proposed future architecture
ARCHITECTURE_IMPROVEMENT_GUARDRAILS.md
= mandatory refinements/corrections/constraints for implementing the architecture
docs/archive/*
= historical documents only; NOT current specifications

Do not treat archived requirements as active requirements.

42. OLD PROJECT REQUIREMENTS DOCUMENT

The old PROJECT_REQUIREMENTS.md describes requirements from an earlier implementation phase.

Those requirements have already been incorporated into the current product.

It must NOT be treated as a current specification.

Preferred repository action:

MOVE it to:

docs/archive/PROJECT_REQUIREMENTS_v1.md

and add a clear header:

HISTORICAL DOCUMENT — NOT A CURRENT SPECIFICATION.
Current product behavior is defined by README.md.
Current future architecture is defined by MajorArchitecturePlan.md and ARCHITECTURE_IMPROVEMENT_GUARDRAILS.md.

If the historical document provides no useful archival value, deleting it is also acceptable.

Do not leave a stale requirements document in the active project root where a future agent may accidentally treat it as current.

43. README POLICY DURING ARCHITECTURE WORK

README.md currently describes the implemented version.

Do not rewrite it as a future-v3 specification before v3 is implemented.

During architecture work:

README remains a description of what currently works.
MajorArchitecturePlan.md describes future architecture.
This document describes refinements.

After an implementation phase is actually completed, update README to reflect what is now real.

Never document planned functionality as though it already exists.

44. FRONTEND SHOULD NOT BECOME THE ANALYTICAL ENGINE

Even after the redesign:

Frontend:

selection
presentation
filter state
UX
display formatting
charts

Backend:

raw observations
eligibility
formulas
transformations
grouping
ranking
comparison
provenance
validation

Do not move economic calculations into React merely because a frontend visualization seems easier there.

45. ZERO-ERROR RELEASE GATE

Before any new architecture phase is considered complete:

Existing GDP tests pass.
New mathematical tests pass.
World Bank source/indicator identity is verified.
No synthetic values are introduced.
Unsupported operations fail closed.
Missing values stay missing.
Raw values remain preserved.
Provenance exists for derived values.
Legacy API behavior is preserved.
No unrelated UI/backend regressions exist.
Production refresh remains atomic.
Test database and real database are not silently rewritten.
Frontend is not claiming results that backend did not actually calculate.

Any unexplained discrepancy is a blocker.

46. DEFAULT IMPLEMENTATION PHILOSOPHY

When there is a choice:

Correctness > provenance > mathematical validity > backward compatibility > clarity > performance > feature count > visual polish.

Do not sacrifice mathematical validity to make a UI feature look complete.

Do not produce a number simply because users expect a number.

"Unavailable — reason" is a valid and preferred result when the data or mathematics do not support the requested analysis.

47. FINAL PRINCIPLE

The project's long-term architecture should become:

World Bank WDI
→ curated canonical indicator registry
→ raw persistent observations
→ metric semantics
→ generic transformations
→ generic entity/group resolution
→ mathematically valid comparison
→ provenance/evidence
→ research-grade frontend.

The existing GDP/per-capita/Total-GDP system remains the protected reference implementation.

New indicators must fit the architecture.

The architecture must never be weakened to fit an indicator.


### About `PROJECT_REQUIREMENTS.md`

I would **not keep it active in the root**.

Your screenshot shows:

```text
MajorArchitecturePlan&Phas...   ← current future architecture
PROJECT_REQUIREMENTS.md         ← old requirements
README.md                       ← current implementation

That is exactly the kind of three-document ambiguity that can make a fresh coding agent make bad decisions.

My preferred final structure would be:

project/
├── backend/
├── frontend/
├── README.md
├── MajorArchitecturePlan.md
├── ARCHITECTURE_IMPROVEMENT_GUARDRAILS.md
└── docs/
    └── archive/
        └── PROJECT_REQUIREMENTS_v1.md

And the new agent should be explicitly told:

README.md
= what exists now

MajorArchitecturePlan.md
= what we are building toward

ARCHITECTURE_IMPROVEMENT_GUARDRAILS.md
= constraints/corrections that must be respected while implementing the plan

docs/archive/*
= historical, never authoritative

That gives you the double protection you wanted: the architecture plan remains the detailed master plan, while the guardrails file stays much smaller and tells the agent where not to blindly follow the plan.