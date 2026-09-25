# Phase 7C — Approved Methodology & Architecture Improvements

## Purpose

This file is the approved correction/design addendum to `7c-audit.txt`.

`7c-audit.txt` identifies the defects found in the current implementation.

This file records the intended methodology and architectural decisions that should guide the corrective implementation.

The implementation agent MUST:

1. Read `7c-audit.txt` completely.
2. Read this file completely.
3. Read `MajorArchitecturePlan.md`.
4. Read `ARCHITECTURE_IMPROVEMENT_GUARDRAILS.md`.
5. Read `README.md`.
6. Inspect the actual current code before editing.

The actual code remains authoritative.

If the code contradicts an assumption in this file, do not blindly implement it. Verify the discrepancy and report it before changing methodology.

This file is NOT permission to invent additional economic methodology.

---

# 1. GOLDEN RULE

The existing GDP methodology is trusted and must remain frozen.

The following eight metrics are GOLDEN REGRESSION ANCHORS:

## GDP per capita

- nominal_current
- nominal_constant
- ppp_current
- ppp_constant

## Total GDP

- total_current
- total_constant
- total_ppp_current
- total_ppp_constant

Their existing:

- raw values
- ranking
- denominator
- tie-breaking
- YoY
- period endpoint comparison
- CAGR
- Movement
- Coverage
- Like-for-like
- missing-data rules
- formatting

must remain unchanged except for corrections that are demonstrably presentation-only and do not alter the analytical result.

Any unexplained GDP analytical difference is a release blocker.

The new metric architecture must generalize around GDP without changing GDP.

---

# 2. CORE ARCHITECTURE PRINCIPLE

Do NOT create one analytical engine per indicator.

The architecture should remain:

World Bank raw observations
→ semantic metric registry
→ metric capabilities / semantic rules
→ generic transformations
→ generic entity/group aggregation
→ generic comparison
→ presentation

Metric-specific behavior should live primarily in declarative metadata/capabilities.

Avoid scattered code such as:

```js
if (metric === 'fdi_inflows') ...
if (metric === 'inflation_cpi') ...
if (metric === 'fx_official') ...

unless there is a genuinely metric-specific rule that cannot be represented declaratively.

The preferred solution is:

metric metadata
→ allowed operations
→ semantic operation
→ generic engine

3. FLOW METHODOLOGY

This is the most important correction.

Annual flows are NOT levels.

Examples:

FDI
exports
imports
current account
remittances
other annual flow metrics

must not automatically be analyzed as:

((value_B / value_A) - 1) * 100

and labelled as multi-year flow growth.

That formula answers an endpoint question:

How did the annual flow in year B differ from the annual flow in year A?

It does NOT answer:

What happened to the flow over the entire period?

These must be separate analytical operations.

4. FLOW OPERATIONS

For flow metrics, support three distinct concepts where the metric permits them.

A. Annual endpoint comparison

Example:

FDI 2004 vs FDI 2014

This is valid as:

Annual FDI in 2014 compared with annual FDI in 2004.

It may provide:

absolute change
percentage change where mathematically valid

The UI MUST call it explicitly:

Annual flow: 2014 vs 2004

or equivalent.

It must NOT call this:

FDI growth 2004→2014

because that wording implies a period statistic.

B. Period flow total

For a period:

[A, B)

calculate:

SUM(flow_A ... flow_(B-1))

Example:

2004 → 2014

means:

2004 through 2013

which is 10 annual observations.

The next adjacent period:

2014 → 2024

means:

2014 through 2023

also 10 annual observations.

This avoids double-counting the boundary year.

The result should explicitly expose:

years included
observation count
aggregate flow
coverage
missing years if any
C. Period flow average

Where mathematically appropriate:

period average = period sum / number of annual observations

This answers:

What was the typical annual flow during this period?

It must remain distinct from:

annual endpoint comparison
period total

Do not silently substitute average for sum.

5. FLOW COMPLETENESS

Never treat missing annual flow as zero.

For a strict period statistic:

If any required annual observation in [A,B) is missing:

available = false

with an explicit reason.

Do not:

zero-fill
interpolate
silently skip missing years
call an incomplete sum a complete period total

The period response should make missing coverage visible.

6. FLOW DEFAULT FOR MULTI-YEAR MOVEMENT

For a flow metric and a multi-year movement analysis:

PRIMARY:

Period total comparison

SECONDARY:

Period average comparison

SEPARATE EXPLICIT MODE:

Annual endpoint comparison

The system must never silently interpret all three as the same concept.

GDP/Total GDP retains its existing endpoint methodology.

7. RATE METHODOLOGY

Rate metrics such as:

CPI inflation
GDP deflator inflation

are already rates.

They must not automatically use GDP-style percentage-on-percentage growth.

For:

6% → 3%

the ordinary rate change is:

-3 percentage points

not:

-50%

unless a specifically supported operation explicitly requests relative change and the metric semantics permit it.

Default rate comparison should be:

B - A

in percentage points.

8. MULTI-YEAR RATE ANALYSIS

For inflation-rate metrics, distinguish:

annual rate
rate change
average annual rate
distribution over a period

Do not call a multi-year endpoint rate difference:

YoY

unless A and B are consecutive years.

Do not confuse inflation rate with cumulative price-level change.

Cumulative price-level change belongs to the CPI index.

9. CPI INDEX

CPI index is not equivalent to GDP level.

The raw index should NOT be country-ranked.

Therefore:

inflation_cpi_index
→ ranking unsupported

Cross-country raw index comparisons should not be presented as economic "higher/lower" conclusions without explicit warning/semantics.

Within one entity:

Index-point change

Valid:

B - A

Unit:

index points
Cumulative CPI index change

Valid where supported:

((B / A) - 1) * 100

Display as:

Cumulative CPI index change

Never call this:

GDP growth
YoY growth
inflation rate
10. FX METHODOLOGY

Official exchange rate uses:

LCU per US$

Therefore:

increase in quote
→ local-currency depreciation

decrease in quote
→ local-currency appreciation

Do NOT rank currencies by the raw quoted number.

Therefore:

fx_official
→ ranking unsupported

Valid operations include:

same-currency level over time
absolute quote movement
percentage movement
annual FX movement
depreciation/appreciation interpretation
cross-rate where quotation legs are compatible

Raw cross-country FX level comparison should not be presented as currency strength.

11. SIGNED FLOW METHODOLOGY

Signed flow metrics include:

FDI
current account
other signed-flow measures

A valid percent-change operation must reject:

non-positive base
sign changes
mathematically invalid bases

For example:

+10 → -5

must NOT become:

-150%

and be treated as valid growth.

The system should instead expose:

unavailable percentage change
reason
absolute change where valid
period sum where valid

A sign change is economically meaningful, but ordinary percentage growth is not the correct representation.

This rule must be enforced consistently across:

YoY
ranking
Movement
Coverage
verification
comparisons

There must not be a situation where one route rejects a sign change but another accepts it.

12. FDI % GDP

FDI % GDP is a ratio.

Do not sum percentages.

For custom groups, where the required legs are available and compatible, implement the weighted ratio:

Σ FDI net inflows
────────────────── × 100
      Σ GDP

This is preferable to:

average(member FDI % GDP)

The group ratio must use:

compatible year
compatible entity membership
compatible GDP basis
compatible vintage
complete required inputs

The derived result must be marked:

APP_DERIVED

It is not a World Bank published group value unless World Bank itself publishes that aggregate.

13. RANKING DIRECTION

Ranking direction is metric-specific.

Do not assume:

higher numeric value = higher rank

for every metric.

GDP / Total GDP / Population etc.

Existing:

DESC

must remain unchanged.

Inflation rate

Use:

ASC

Lower numerical inflation first.

Example:

-2
0
2
5
20

Negative inflation naturally comes before positive inflation.

Do NOT invent:

stability scores
desirability scores
100 - inflation
artificial transformations
CPI index
RANK_UNSUPPORTED
FX quoted rate
RANK_UNSUPPORTED

Other metrics must have their direction decided from their own semantics.

14. RANK DIRECTION THREADING

Ranking direction must be respected everywhere:

ranking
rank verification
neighbors
search
percentile
coverage focus rank
movement
YoY ranking where applicable
API
frontend

The default ranking comparator remains DESC.

ASC is an explicit metric capability.

NEUTRAL means ranking is unsupported unless an explicit semantic rule authorizes it.

15. PERIOD CHANGE VS YOY

Do not call every percentage change:

YoY

A valid YoY is specifically:

current year vs immediately previous year

For example:

2013 → 2014

is YoY.

But:

2004 → 2014

is not YoY.

For level metrics it may be:

Period change

For flow metrics it may be:

Annual endpoint comparison

For a period total it may be:

Period-total change

Terminology must match the actual calculation.

16. OPERATION SEMANTICS

Do not rely on one generic operation name such as:

PERCENT

to represent all contexts.

The architecture should distinguish semantic operations such as:

ANNUAL_YOY
ANNUAL_ENDPOINT_PERCENT_CHANGE
PERIOD_SUM
PERIOD_SUM_PERCENT_CHANGE
PERIOD_AVERAGE
RATE_PP_CHANGE
INDEX_POINT_CHANGE
INDEX_CUMULATIVE_PERCENT_CHANGE
FX_PERCENT_MOVEMENT
CAGR

These can reuse the same generic mathematical primitives internally.

The distinction is semantic, not necessarily separate mathematical engines.

17. GROUP METHODOLOGY
Total GDP

SUM.

Trade flows

SUM.

FDI

SUM.

Current account

SUM.

Remittances

SUM.

Population

SUM.

GDP per capita

Do NOT SUM.

A derived aggregate per-capita statistic would require:

Σ GDP / Σ population

only if explicitly supported by the architecture and compatible raw inputs.

Rates / inflation

Do not create fake regional rates by simple averaging.

Prefer:

official World Bank aggregate
member-level distribution

unless a defensible weighting method exists.

FX

Never SUM or average quoted exchange rates into a fake "group currency."

18. WORLD BANK AGGREGATES

Official World Bank aggregates must remain distinct from custom groups.

Never hard-code:

Africa
Asia
Europe
North Africa
etc.

Official aggregate membership must come from World Bank metadata/observations.

If World Bank does not publish the requested aggregate for a metric/year:

return unavailable.

Do not synthesize it.

Official aggregate values must never contaminate country rankings.

19. GROUP COMPARISON

The frontend must not offer an operation that the backend will reject.

Entity-aware capability filtering must happen before the user submits.

Examples:

GDP total:
group SUM allowed

GDP per capita:
group SUM disallowed

FX:
group SUM disallowed

Inflation:
fake group average disallowed

Weighted FDI/GDP:
allowed only when required numerator/denominator legs exist.

Country ↔ Group, Group ↔ Country and Group ↔ Group must work only where the metric capability permits them.

20. GROUP PROVENANCE

Every custom-group derived value must expose:

members
metric
year
operation
formula
aggregation method
coverage
source
RAW vs APP_DERIVED

A user-selected group must never be labelled as an official region.

21. FRONTEND INITIALIZATION

The Overview must expose the entire enabled metric universe on first load.

Do not require the user to visit Movement/another tab first.

Fix the stale MetricPicker registry memo/state issue.

The root cause identified in the audit must be resolved rather than worked around by remounting.

22. FRONTEND CONTROLS

The custom Phase-6 control system should be used consistently.

Replace remaining accidental native dropdowns in Movement/table filters using the existing SearchableSelect/custom control implementation.

Do not create a second select system.

Keep intentionally native controls only where accessibility or platform behavior genuinely makes them preferable.

23. CHART ARCHITECTURE

Do NOT keep the current generic two-point SVG TrendChart as the universal comparison visualization.

Use a proper React charting library.

Preferred direction:

React/Vite
+
Recharts
+
existing Node backend

Do NOT introduce Python solely for charting.

Python is not necessary for current project calculations or visualizations.

A Python service should only be reconsidered in a future phase if genuine statistical/econometric/ML computation requires it.

24. CHART TYPE BY ANALYSIS

Use the chart type that matches the meaning.

Long time series

Line chart.

Two-endpoint comparison

Slope/dumbbell chart.

Do not display two points as a misleading "trend line."

Annual flow history

Bar or line chart.

Period totals

Bar/column comparison.

Inflation

Rate time series.

Inflation + real GDP

Prefer small multiples with common time axis.

Do NOT put incompatible units on one shared y-axis.

Rank movement

Slope/rank chart.

Rank 1 should visually appear at the top.

Country vs group

Bar/dumbbell where appropriate.

Very different magnitudes

Do not silently use logarithmic scale.

Use:

small multiples
explicit indexing
separate scales
or another clearly labelled method.
25. CHART REQUIREMENTS

Every chart should expose:

title
metric
unit
period
legend where necessary
source
missing-data gaps
accessible fallback/table

Charts must consume backend-calculated numbers.

Frontend must not recalculate economic values.

26. PRECISION

Never hide meaningful information through generic rounding.

Examples:

2.43%
0.72%
83.67
227.6

must not become:

2%
1%
84
228

unless the metric's explicit display policy intentionally calls for that level of precision.

Raw database values remain untouched.

Formatting remains presentation-only.

27. NO DATA INTEGRITY REGRESSION

Never:

change raw World Bank values
replace missing with zero
interpolate
synthesize economic data
substitute another data provider
hard-code country values
hard-code region membership
overwrite RAW observations with APP_DERIVED values

All economic analysis must ultimately trace back to World Bank WDI observations.

28. IMPLEMENTATION ORDER

Do NOT implement this entire correction as one giant change.

Use the following phases.

7C-1 — Core methodology

Implement:

PERIOD_SUM
PERIOD_AVG
half-open [A,B) period rule
strict flow completeness
signed-flow sign-change guards
metric-aware operation semantics
flow/rate/index capabilities
GDP differential regression

Stop and test.

7C-2 — Groups / Compare

Implement:

weighted FDI/GDP ratio
entity-aware operation gating
group workflow
group labels
official aggregate consistency
group provenance
group LFL where valid

Stop and test.

7C-3 — Frontend state / controls / semantics

Implement:

Overview initial metric availability
remaining native dropdowns
operation labels
formula/methodology copy
FX wording
rate/index wording
unavailable/reason states

Stop and test.

7C-4 — Charts

Implement:

Recharts
endpoint slope/dumbbell
long-series line
flow bars
inflation visualization
rank movement
group comparison
mobile/accessibility behavior

Stop and test.

7C-5 — Final hardening

Perform:

full backend regression
GDP golden regression
raw WDI spot checks
frontend lint/build
browser QA
mobile QA
security
DB integrity
deployment verification
final release audit

Do not skip stages for convenience.

29. TESTING REQUIREMENTS

Every phase must retain the existing GDP golden fixtures.

Required new tests include:

Flow
PERIOD_SUM
PERIOD_AVG
[A,B) year list
correct period count
adjacent periods do not overlap
missing year → unavailable
no zero-fill
endpoint operation remains distinct
Signed flows
positive → positive valid where base allows
zero base rejected
negative base rejected
positive → negative rejected
negative → positive rejected
route consistency across YoY/coverage/movement/verification
Inflation
ASC ranking
pp change
no relative rate growth unless explicitly supported
proper precision
CPI index
no cross-country ranking
index-point change
cumulative index change
proper warnings for cross-country raw level comparison
FX
no raw cross-country ranking
depreciation direction
appreciation direction
cross-rate
correct terminology
Groups
country ↔ group
group ↔ country
group ↔ group
SUM
weighted ratio
invalid capability
incomplete group
provenance
Frontend
initial metric registry load
metric picker
movement controls
compare group
chart render
responsive behavior
a11y
30. CHANGE CONTROL

Before implementing each phase:

Inspect the actual current code.

Do not trust old line numbers.

After each phase:

run tests
inspect git diff
verify GDP regression
inspect database impact
verify no raw data changed

Never proceed to the next phase while the current one has unexplained failures.

31. STOP CONDITIONS

STOP and ask for review if:

a GDP analytical result changes unexpectedly
a methodology cannot be established from World Bank semantics
an indicator's economic meaning is ambiguous
a period operation would require fabricated/missing data handling
official aggregate semantics are unclear
a new schema change appears necessary
a Python service appears necessary
the backend contract needs a breaking change

Do not improvise.

32. APPROVED ARCHITECTURAL DIRECTION

The long-term system should remain:

World Bank WDI
→ raw observations
→ semantic registry
→ capability-aware operations
→ generic transforms
→ entity/group aggregation
→ comparison
→ API
→ frontend
→ metric-appropriate visualization

No indicator-specific analytical engines.

No separate Python analytics service.

No hard-coded economic series.

No hard-coded regions.

No generic GDP assumptions leaking into other metric families.

33. WHAT THIS FILE IS NOT

This file is NOT:

a replacement for the 7C audit
a substitute for the actual code
permission to skip tests
permission to modify GDP semantics
permission to invent unsupported World Bank data
a reason to implement everything in one giant commit

It is the approved methodology/design direction for correcting the defects identified in the audit.

34. FINAL SUCCESS CONDITION

The implementation is successful only when:

Every metric follows its actual economic semantics.
GDP and Total GDP remain unchanged.
Flow periods use actual annual observations.
Rates use rate semantics.
Indexes use index semantics.
FX uses quotation semantics.
Signed-flow sign changes cannot produce fake percentage growth.
Groups use mathematically valid aggregation.
Compare exposes only supported operations.
Charts match the analytical question.
Frontend state is deterministic from first load.
No raw World Bank data is fabricated or rewritten.
All changes remain traceable and testable.


One thing I would improve in the flow design

The audit's half-open interval [A,B) is mathematically clean:

2004 → 2014
= 2004...2013

2014 → 2024
= 2014...2023

and this avoids double-counting the boundary year. The report's reasoning is sound.

But I would not expose "2004 → 2014" in the UI as though it means the same thing for both endpoint and period modes.

That will confuse users.

Internally:

endpoint operation:
{A, B}

period operation:
[A, B)

is excellent.

But for the UI I would make it explicit:

Annual endpoint:
2014 vs 2004

Period total:
2004–2013
10 annual observations

and:

Period total:
2014–2023
10 annual observations

rather than asking users to remember what the arrow means.

This should be a mandatory design rule in implementation.

2. Signed-flow handling needs one more strict rule

The report correctly discovered another bug that 7B missed:

positive → negative can currently become -150% YoY in legacy routes even though the generic transform correctly refuses sign changes.

That's absolutely a blocker.

For signed flows like:

FDI
Current account
Trade balance

I would enforce:

base > 0 AND current >= 0
    → ordinary percentage change can be considered

base <= 0
    → no ordinary percentage-growth statistic

sign change
    → unavailable for ordinary percentage growth

And I would also not automatically calculate ordinary percent change when both values are negative. That's mathematically computable but economically awkward as "growth." A signed-flow analysis should prefer:

absolute change
period sum
period average

for negative/sign-changing cases.

The report is heading in this direction, but I would make this explicit before implementation.

3. Inflation methodology is good

The report's rate methodology is correct:

6% → 3%
= -3 percentage points

not:

-50%

unless the user explicitly requests a relative percentage change and the metric permits it.

It also correctly separates:

CPI inflation

from:

CPI index

and says cumulative price-level effects belong to the index, not the inflation-rate series.

That's exactly the distinction your site needed.

4. CPI index methodology is mostly right

The report correctly refuses to rank CPI index cross-country and allows within-entity index movement.

I agree with:

CPI index:
cross-country ranking → unsupported

same entity:
index-point change → supported

same entity:
cumulative CPI index change → supported

The one thing I'd require is very explicit UI wording:

Cumulative CPI index change

never:

GDP growth
YoY growth
Inflation

because those are different concepts.

5. FX methodology is correct

The report correctly establishes:

LCU per US$

and:

increase → depreciation
decrease → appreciation

It correctly refuses raw cross-country FX ranking.

I would go one step further: cross-country raw FX level comparison should probably be disabled rather than merely warning users, because it is almost guaranteed to be misinterpreted.

You can still allow:

INR/USD vs INR/USD through time

and:

cross-rate

where the quotation legs make mathematical sense.

6. Group methodology is strong, but one decision is pending

The audit's group matrix is mostly excellent:

Total GDP → SUM
Trade flows → SUM
FDI → SUM
Current account → SUM
Remittances → SUM
Population → SUM
GDP per capita → not summable
Inflation → official aggregate only
FX → never sum/average
FDI % GDP → weighted ratio

I recommend implementing the weighted FDI ratio, not downgrading it:

Group FDI % GDP
=
Σ FDI inflows
────────────── × 100
   Σ GDP

for the same group/year/basis.

That's much more meaningful than averaging each country's FDI/GDP percentages.

The report already identifies this as the open decision.

So I would approve:

IMPLEMENT WEIGHTED_RATIO.

7. The hidden sign-flip bug is proof that phased implementation is necessary

This is actually the strongest reason not to do everything in one giant implementation.

The audit discovered:

computeTransform()
→ refuses sign changes

legacy YoY routes
→ still accepted sign changes

So two parts of the backend were answering the same economic question differently.

That means implementation should proceed by semantic layer, then regression-test every consumer.

8. The chart recommendation is good

I agree with the rejection of the current generic TrendChart.

The audit correctly identifies that:

two points + huge magnitude difference = a visually flat "trend" that communicates almost nothing.

The recommended mapping is sensible:

Analysis	Visualization
long time series	line
two endpoints	slope/dumbbell
annual flow	bars/line
period total	bars
inflation	rate line
GDP + inflation	small multiples
rank movement	slope
country vs group	bars/dumbbell
huge magnitude differences	small multiples/indexed

The recommendation to use Recharts and stay in React/Node is also sensible.

I agree with the report's:

Keep Node. Do not add Python.

Python would add another runtime/service without solving a problem you actually have. Your calculations are already small scalar/aggregate operations; a proper React chart library is enough.

9. Overview bug is a real bug, and the diagnosis is precise

The audit found that MetricPicker memoization is stale after registry hydration, which explains why metrics only appear after entering another workspace.

That should be fixed.

It shouldn't require any architectural redesign.

10. Group failure is correctly diagnosed

The audit did not just say "Group doesn't work."

It traced the full pipeline and found:

group picker
→ offers operation
→ backend correctly rejects it

because the frontend operation picker isn't entity-aware. It also found label loss and an orphaned /groups/evaluate.

That's exactly the kind of diagnosis we want before fixing it.

What I would change in the audit before implementation

I would add three explicit rules to the design.

Rule A — Never call non-annualized endpoint change "YoY"

The audit already caught this P1:

multi-year GDP endpoint percentage change is being labelled "YoY % growth".

Even though the GDP number itself is valid, the terminology is wrong.

For:

2004 → 2014

use:

Period change

or:

Endpoint change

not:

YoY

because 10-year endpoint change is not year-over-year.

For GDP:

2004 → 2014
+X% endpoint change

is fine.

For annual:

2013 → 2014
YoY

is fine.

Rule B — Separate "analysis basis" from "comparison operation"

Your Movement UI currently mixes concepts such as:

Annual flow
YoY % growth
endpoint

into one set of controls.

I would architect the operation hierarchy as:

Metric
   ↓
Observation type
   ↓
Valid analysis modes

For example:

FDI
 ├─ Annual endpoint
 │    ├─ absolute change
 │    └─ percent change
 │
 ├─ Period total
 │    ├─ absolute change
 │    └─ percent change
 │
 └─ Period average
      ├─ absolute change
      └─ percent change

Whereas GDP:

GDP
 ├─ Level endpoint
 ├─ Annual YoY
 ├─ Period endpoint change
 └─ CAGR

This is much cleaner than making one generic Movement engine guess what "Year A → Year B" means.

Rule C — Every operation needs a semantic name

Instead of an internal operation simply called:

PERCENT

the UI/API should know the context:

ANNUAL_ENDPOINT_PERCENT_CHANGE
PERIOD_SUM_PERCENT_CHANGE
ANNUAL_YOY
RATE_PP_CHANGE
INDEX_CUMULATIVE_PERCENT_CHANGE
FX_ANNUAL_DEPRECIATION

You don't necessarily need all of those as separate mathematical functions—the underlying formulas can reuse the same generic primitives—but the semantic operation must be explicit.