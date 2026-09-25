# WDI ANALYTICS MASTER SPEC — ADDENDUM
## Methodological Corrections, Clarifications, Decisions, and Additional Safeguards

**Status:** Supplemental / binding review specification  
**Relationship:** Read together with `WDI_ANALYTICS_MASTER_SPEC.md`  
**Scope:** Economic methodology, statistical semantics, ranking integrity, period analysis, signed flows, CAGR, LFL, peer comparison, aggregation, Compare, methodology disclosure, charts, testing, and implementation safeguards.

---

# 1. PURPOSE OF THIS ADDENDUM

This document supplements:

`WDI_ANALYTICS_MASTER_SPEC.md`

The Master Spec contains the complete proposed architecture and analytical design.

This Addendum records additional methodological corrections and clarifications identified during review of that design.

These are not optional stylistic preferences.

They exist to prevent an analytically correct-looking implementation from introducing subtle economic or statistical errors.

## Precedence rule

When this Addendum explicitly modifies or clarifies a topic covered by the Master Spec:

> THIS ADDENDUM TAKES PRECEDENCE FOR THAT SPECIFIC TOPIC.

For all other topics:

> `WDI_ANALYTICS_MASTER_SPEC.md` remains authoritative.

No implementation should begin until both documents have been read together.

---

# 2. CORE PRINCIPLE

The project is not merely a mathematical calculator.

It is an economic-analysis system.

Therefore:

> A number being mathematically computable does not mean that it is economically meaningful to present it as a statistic.

Every operation must pass four independent tests:

1. Mathematical validity
2. Economic validity
3. Semantic validity
4. Communication validity

A result fails if any one of these fails.

For example:

```text
FDI 2004 = $5.43B
FDI 2014 = $34.58B

The following is mathematically valid:

(34.58 / 5.43 - 1) × 100
= +536.86%

But that statistic is NOT the correct measure of:

FDI performance during the 2004–2014 decade.

It compares two annual flow observations.

The proper decade-flow analysis uses all annual flow observations in the interval.

This distinction must remain a permanent design principle.

3. RANKING INTEGRITY — ADDITIONAL HARD RULE
3.1 One ranking = one statistic

A ranking must always rank one explicitly defined statistic.

Never mix different statistics inside a single ranking.

For example, this is INVALID:

Country A → ranked by period-total %
Country B → ranked by absolute period change
Country C → ranked by cumulative period total

These are different statistics and therefore require different rankings.

Correct design

Use separate rankings:

Cumulative period rank

Rank by:

Σ annual flow values

Label:

Cumulative net FDI inflow rank — 2004–2013

Period-average rank

Rank by:

Σ annual flow / N

Label:

Average annual net FDI inflow rank — 2004–2013

Period-total percentage-change rank

Rank by:

(B period total / A period total - 1) × 100

only for entities for which the percentage change is valid.

Label:

Period-total change rank — 2014–2023 vs 2004–2013

Absolute period-change rank

Rank by:

B period total - A period total

Label:

Absolute period change rank — 2014–2023 vs 2004–2013

These must remain separate rankings.

3.2 Never substitute an alternative statistic silently

If an entity cannot receive a percentage-change statistic because:

its denominator is zero,
its denominator is negative,
or the flow changes sign,

DO NOT silently rank that entity using absolute change instead.

Instead:

Percentage-change ranking

Exclude it from the percentage-change ranking and show:

Excluded from percentage-change ranking:
reason = negative_period_base
Absolute-change ranking

Offer a separately labelled ranking that includes it if its absolute change is available.

This preserves ranking integrity.

4. RANKING TIES

The existing GDP ranking/tie behavior is frozen.

Do not change GDP ranking semantics.

For newly redesigned metrics, the ranking policy must be explicit.

Preferred approach:

Statistical rank

Use competition ranking when exact ties occur:

1
1
3
4

rather than pretending tied values have distinct economic positions.

A deterministic secondary sort such as ISO3 may still be used for table ordering, but it must NOT falsely imply that one tied entity economically outranks another.

Therefore distinguish:

rank = statistical rank
order = deterministic display order

Example:

Rank 1 — Country A
Rank 1 — Country B
Rank 3 — Country C

If the existing non-GDP implementation already relies on distinct ordinal positions and changing it would create unnecessary compatibility risk, document that behavior explicitly as:

"Display position with deterministic ISO3 tie-break"

rather than describing it as a strict statistical rank.

5. GDP SEMANTIC CLARIFICATION

The Master Spec groups GDP under LEVEL/STOCK semantics.

That wording requires clarification.

GDP is not a stock.

GDP is a measure of production generated over a period, normally a year.

Economically it is a production flow measured over a reporting period.

However, within this application:

annual GDP is treated as an annual macroeconomic level/aggregate observation for endpoint comparison and annual growth analysis.

Therefore:

GDP ≠ stock

but:

GDP annual observation = annual macroeconomic aggregate
Why this matters

Do NOT generalize GDP's analytical treatment to every other annual flow.

The fact that endpoint GDP growth is meaningful does not mean endpoint growth of FDI, exports, imports, or current-account balances is automatically the correct decade statistic.

The GDP family's existing methodology remains frozen as required by the Master Spec.

The semantic registry should therefore allow:

metricType = GDP_ANNUAL_AGGREGATE

or an equivalent capability representation,

while still allowing the existing GDP logic to remain unchanged.

Do not force GDP into stock semantics merely for programming convenience.

6. FLOW CAGR — RESTRICTED

The Master Spec lists CAGR among possible operations for LEVEL, FLOW, and STOCK.

This must be narrowed.

General rule

CAGR should be a core operation for:

positive level/stock series,
GDP/GDP-per-capita where already established and frozen.

For ordinary annual flow series such as:

FDI,
exports,
imports,
remittances,
current account,

CAGR must NOT become a default basis for multi-year economic performance.

Why

Consider:

FDI 2004 = $5B
FDI 2014 = $35B

A CAGR can be mathematically calculated.

But it represents:

the annualized endpoint growth of the annual FDI observation.

It does NOT represent:

the annualized growth of cumulative FDI received during the decade.

Those are completely different concepts.

Therefore:

Recommended core FDI operations

Use:

Annual level
Annual YoY
Period total
Period average
Period absolute change
Period-total percentage change

Do not add generic:

CAGR

to FDI as a normal basis.

If an endpoint CAGR is ever retained for research purposes, its operation name must explicitly be:

ANNUAL_FLOW_ENDPOINT_CAGR

and its UI label must explicitly say:

CAGR of annual endpoint flow values — NOT cumulative period flow growth

It must never replace:

PERIOD_TOTAL
PERIOD_TOTAL_CHANGE
7. FLOW ENDPOINT CHANGE — DO NOT EXPOSE AS "GROWTH"

For FLOW and SIGNED_FLOW metrics:

Do not expose this:

(B annual flow / A annual flow - 1) × 100

under a generic:

Growth

basis.

Especially in Movement, where the user is comparing decades.

Required terminology

If retained:

Annual endpoint change — B vs A

or:

Endpoint change in annual flow — B vs A

and include:

Not a period statistic.

Preferred Movement design

For flows:

Annual level / rank
Annual YoY
Period total
Period average
Period-total change

The endpoint annual-flow comparison should not be part of the primary "Growth" basis.

This directly prevents the original FDI defect from returning.

8. EXACT FDI DECADE METHODOLOGY

For:

Start = 2004
Middle = 2014
End = 2024

define:

Period A = 2004–2013
Period B = 2014–2023
Period total
A_total = FDI2004 + FDI2005 + ... + FDI2013

B_total = FDI2014 + FDI2015 + ... + FDI2023
Period average
A_average = A_total / 10

B_average = B_total / 10
Period absolute change
B_total - A_total
Period percentage change

Use:

(B_total / A_total - 1) × 100

ONLY when the base-period total is an economically interpretable positive denominator.

Preferred guard:

A_total > 0
AND
B_total >= 0

If:

A_total <= 0

do not produce a conventional period growth percentage.

If:

B_total < 0

do not describe the resulting arithmetic as ordinary growth.

Instead show:

Absolute period change

and explain the sign/reversal.

9. SIGNED-FLOW PERCENTAGE RULE

This applies consistently to:

FDI net inflows
current account
any future signed flow.
Conventional percentage change is allowed only when:
base > 0
AND
current >= 0

with no sign reversal.

Therefore:
Positive → positive
valid percentage change
Positive → zero
valid = -100%
Positive → negative
percentage change unavailable
sign reversal
Zero → anything
percentage change unavailable
zero base
Negative → positive
percentage change unavailable
negative base / sign reversal
Negative → negative

Do NOT present the arithmetic quotient as conventional economic growth.

Use:

absolute change

and sign-aware interpretation.

Important

The same rule must be implemented centrally and identically in:

YoY
Movement
Compare
ranking
period statistics
verification
methodology
yearly tables.

No route may use different rules.

10. CURRENT ACCOUNT — SPECIAL SIGN INTERPRETATION

Current account is a balance.

For example:

Period A = -$100B
Period B = -$50B

Absolute change:

+$50B

Interpretation:

cumulative current-account balance moved toward a smaller deficit.

Do NOT display:

-50% current-account growth

as the primary economic description.

Similarly:

+$20B → -$10B

means:

moved from surplus to deficit by $30B

not:

-150% growth

The UI must use:

surplus
deficit
smaller deficit
larger deficit
toward surplus
toward deficit

where appropriate.

11. PERIOD TOTAL VS PERIOD AVERAGE

For equal-length periods:

2004–2013 = 10 observations
2014–2023 = 10 observations

the percentage change in total and average is mathematically identical.

Example:

A_total = $200B
B_total = $300B

A_average = $20B/year
B_average = $30B/year

Both give:

+50%

However, they answer different descriptive questions.

Period total

How much flowed in cumulatively during the period?

Period average

What was the average annual flow during the period?

Therefore both can be displayed, but they must not be represented as duplicate statistics.

For unequal-length periods, total and average are especially important to distinguish.

12. RATE METRICS

For:

CPI inflation
GDP-deflator inflation

the metric is already a rate.

Primary operations
Annual rate
Percentage-point change
Period-average annual rate
Minimum
Maximum
Distribution statistics where useful

Do not make ordinary relative percentage change of the rate the primary "growth" statistic.

Example:

6% → 3%

Correct primary change:

-3 percentage points

not:

-50%

The latter is mathematically possible as a relative change in the rate, but is not the preferred economic representation of inflation-rate movement.

Period average

Arithmetic mean:

Σ annual rates / N

Label:

Average annual inflation

Do NOT call this:

cumulative inflation

and do NOT sum annual inflation rates.

13. CPI INFLATION VS CPI INDEX

These must remain separate.

CPI inflation

Answers:

How quickly consumer prices changed during a year.

CPI index

Answers:

What level of the CPI index was observed.

Example:

CPI index:
75 → 120

Index-point change:

+45 index points

Cumulative index change:

(120 / 75 - 1) × 100
= +60%

That means the index is 60% higher than at the starting point.

It does NOT mean:

60% inflation in one year.

It does NOT mean:

GDP grew 60%.

14. CPI INDEX CROSS-COUNTRY CHANGE

Do not rank countries by raw CPI index LEVEL.

However, cumulative percentage change in CPI between the same endpoints may be used descriptively because the calculation is based on each country's own index movement.

If enabled:

label it:

Cumulative CPI index change — 2004 to 2014

not:

CPI level rank

and not:

Cost-of-living rank.

The methodology must state that this is a descriptive comparison of index movement, not a direct comparison of absolute price levels or cost of living.

This operation should remain separately distinguishable from CPI index level.

15. EXCHANGE RATE MOVEMENT

For:

LCU per US$

an increase means more local currency is required to obtain one US dollar.

Under this quotation:

quote increase = local-currency depreciation against USD
quote decrease = local-currency appreciation against USD

Example:

45 LCU/USD → 60 LCU/USD

quote movement:

(60/45 - 1) × 100
= +33.33%

Interpretation:

the quoted exchange rate increased by 33.33%; under LCU/USD quotation this represents depreciation against USD.

Do NOT call this:

currency growth.

Do NOT rank by raw exchange-rate LEVEL across countries.

Cross-country FX movement ranking

If implemented:

make it:

descriptive quote-movement ranking

and not:

strongest/weakest economy.

This should be optional, not an automatic default ranking.

16. FX PERIOD AVERAGE

The WDI FX series itself is an annual period-average quote.

A multi-year:

mean(annual FX observations)

is therefore an average of annual period-average observations.

This is acceptable as a descriptive statistic.

Label:

Average annual exchange-rate quote — 2004–2013

Do NOT label it:

FX growth

and do not confuse it with endpoint movement.

17. FDI/GDP RATIO

FDI/GDP is a ratio.

Annual ratio
FDI_y / GDP_y × 100
Annual percentage-point change
ratio_B - ratio_A
Average annual ratio
mean(annual FDI/GDP ratios)
Cumulative period ratio
ΣFDI / ΣGDP × 100

These statistics must remain separate.

Do NOT calculate:

sum(annual FDI/GDP percentages)

Do NOT use the arithmetic average when the analytical question is explicitly:

cumulative FDI relative to cumulative GDP.

Conversely, do not present the cumulative ratio as though it were the arithmetic mean of annual ratios.

18. GROUP FDI/GDP

For a group:

Group FDI/GDP
=
Σ member FDI
---------------- × 100
Σ member GDP

Requirements:

same group membership,
same year or same period,
same WDI vintage,
compatible numerator and denominator,
complete required legs.

Never calculate:

mean(member FDI/GDP)

as the group's primary FDI/GDP ratio.

That would answer a different question.

Mark the derived value:

APP_DERIVED

and expose both raw legs.

19. PEER BENCHMARKS

Peer benchmarks must always have an explicitly defined universe.

For a focus country:

Rank

Uses the full eligible universe.

Peer mean

Excludes the focus country.

Peer median

Excludes the focus country.

Percentile

Use a precisely defined universe and formula.

Recommended:

Percentile =
100 × (# eligible entities with statistic <= focus statistic) / N

if using a cumulative distribution representation.

The UI must state the convention.

Relative gap

For:

India = 20
peer mean = 25

absolute gap:

20 - 25 = -5 units

relative gap:

(20 - 25) / 25 × 100
= -20%

Relative gap is available only when the reference denominator is positive and economically meaningful.

For rates/ratios:

use percentage-point gaps.

For index values:

use index points where applicable.

Never mix:

dollars,
percentages,
percentage points,
index points.
20. MEAN VS MEDIAN

For skewed economic-flow distributions such as:

FDI,
exports,
imports,
remittances,
reserves,

mean and median can differ dramatically.

The methodology should therefore expose:

Mean across eligible economies
Median across eligible economies
Percentile

where useful.

If:

mean >> median

the methodology panel may include:

Distribution is strongly right-skewed; the mean is influenced by large economies.

Do not call the arithmetic mean:

World Average

unless it is actually the World Bank WDI official aggregate.

21. PERIOD LFL UNIVERSES

The proposed U1–U5 universe system is approved, with the following interpretation.

U1 — Endpoint-common

Valid in both selected endpoint years.

Used for:

endpoint comparisons,
endpoint rank movement,
endpoint changes.
U2 — Consecutive-pair / YoY

Valid for the two required annual observations.

Used for:

annual YoY,
annual absolute change.
U3 — Period-complete

Valid for every required year inside one period.

Example:

2004–2013

requires all 10 observations.

Used for:

period total,
period average,
period ranking.
U4 — Cross-period strict

Valid for every required year in both periods.

Example:

2004–2013
+
2014–2023

requires all 20 annual observations.

Used for:

period-total change,
cross-period change ranking,
period-vs-period LFL.
U5 — Group universe

Explicitly defined custom-group membership with:

observed mode,
like-for-like mode.

Every response must carry:

universe.rule
eligible
ranked
excluded
exclusion reasons

Never silently change the universe.

22. PERIOD-COMPLETE VS CROSS-PERIOD LFL

These are intentionally different.

Example:

Country X has:

all years 2004–2013

but is missing:

2017

Then:

Period A rank

Country X may qualify for U3.

Period B rank

Country X does not qualify for U3.

Cross-period change rank

Country X does not qualify for U4.

This is correct.

The UI must not imply:

Country X was removed because it was economically inferior.

It was removed because:

it lacked complete observations for the requested operation.

23. GROUP PER-CAPITA — SCOPE CONTROL

A derived:

Group GDP per capita
=
ΣGDP / ΣPopulation

is economically defensible.

However:

This is NOT required for the core methodology redesign.

Therefore:

GROUP_PER_CAPITA should remain an optional/deferred capability unless explicitly approved.

Do not let it expand the scope of the current project or accidentally alter the frozen country/official-aggregate GDP-per-capita behavior.

If later implemented:

APP_DERIVED,
same member set,
same year,
same GDP basis,
same population basis,
same vintage,
full provenance.
24. OFFICIAL AGGREGATE VS CUSTOM GROUP

These must never be conflated.

Official WDI aggregate

Use the actual WDI-published aggregate observation.

Label:

World Bank aggregate

Custom group

Calculated from member-country observations.

Label:

APP-DERIVED CUSTOM GROUP

Include:

member list,
source indicators,
formula,
coverage,
vintage.

Never say:

World Bank reports...

for an APP_DERIVED custom group.

25. COMPARE — OPERATION CONSISTENCY

Movement and Compare must use the same semantic calculation engine.

There must NOT be:

Movement formula A
Compare formula B

for the same operation.

A requested operation should resolve through:

metric capability
→ operation
→ entity capability
→ aggregation rules
→ LFL/universe
→ transformation
→ result

The Compare UI must not perform economics in React.

26. COMPARE AVAILABILITY STATES

Use explicit machine-readable result states.

Available
available: true

with result and provenance.

Unsupported
available: false
category: UNSUPPORTED_OPERATION

Include:

reason
supportedAlternatives
Insufficient data
available: false
category: INSUFFICIENT_DATA

Include:

missingYears
missingLegs
validYears
requiredYears
coverage
System error
category: SYSTEM_ERROR

Only genuine transport/system failures belong here.

Do NOT use:

No data available

as a generic replacement for unsupported operations.

27. METHODOLOGY UI — LABEL INTEGRITY

Every displayed result must have a methodology label that exactly describes the statistic.

Examples:

FDI
Annual net FDI inflow · 2014

Annual YoY · 2014 vs 2013

Period total · 2004–2013 · 10 annual observations

Period average · 2004–2013

Period-total change · 2014–2023 vs 2004–2013

Annual endpoint change · 2014 vs 2004
(Not a period statistic)
CPI
Annual inflation rate · 2014

Inflation change · 2014 vs 2004 · percentage points

Average annual inflation · 2004–2013
CPI index
Index-point change · 2014 vs 2004

Cumulative CPI index change · 2014 vs 2004
FX
Exchange-rate quote · LCU per US$

Annual quote movement

Quote movement · 2014 vs 2004

Avoid generic labels such as:

Growth
Change
Performance
World average

when the underlying statistic is more specific.

28. 2024 BOUNDARY-YEAR RULE

For:

Start = 2004
Middle = 2014
End = 2024

period calculation is:

2004–2013
2014–2023

However, 2024 must remain visually visible as a boundary/context year whenever the chart represents the broader selected interval.

Example tooltip:

2024 — period boundary; excluded from the 2014–2023 period total.

Do not make the user think the application simply lost 2024 data.

The computational rule and the visual context rule are separate.

29. CHART SEMANTICS

Chart type must follow the analytical object.

Annual time series

Use:

line,
or bar where a flow is more naturally represented by annual columns.
Annual flow

Prefer:

bars,
zero line where signed,
visible positive/negative direction.
Period totals

Use:

separate period bars.
Endpoint comparison

Use:

slope/dumbbell,
or clearly separated endpoint cards.
Rank movement

Use:

rank slope.
Rate

Use:

rate time series,
zero reference where useful.
Index

Use:

index history,
change card/bar.
FX

Use:

quote history,
movement comparison.

Never use a trend line to suggest continuous dynamics when only two endpoints exist.

30. RESPONSIVE CHART ARCHITECTURE

The intended architecture is:

chart-shell
    ├── sticky Y-axis
    └── horizontally scrollable plot

One chart only.

Never split a single annual series into:

Chart A
Chart B

just because the viewport is narrow.

The plot width expands based on observation count.

Conceptually:

plotWidth =
max(
  availablePlotWidth,
  observationCount × minimumObservationWidth
)

Use:

overflow-x: auto

inside the chart only.

The Y-axis remains visible while the plot scrolls.

Page-level horizontal overflow must remain disabled.

Test:

320px
360px
390px
430px
768px
1024px
1280px+

and:

10 years
20 years
30 years
50+ years
31. FRONTEND ECONOMIC-MATH PROHIBITION

The frontend may:

format values,
format units,
render formulas already supplied by backend,
display methodology,
display provenance,
display unavailable states.

The frontend must NOT:

calculate percentage change,
calculate CAGR,
sum flows,
calculate ratios,
determine ranking,
determine LFL,
calculate group aggregates,
independently determine missing-data validity.

Backend/domain logic remains authoritative.

32. PROVENANCE REQUIREMENT

Every APP_DERIVED result must preserve:

source
indicatorCode(s)
entity/entities
years
includedYears
excludedBoundaryYears
operation
formula
raw input legs
aggregation method
universe
coverage
vintage

Examples:

APP_DERIVED
ΣFDI / ΣGDP × 100

or:

APP_DERIVED
ΣGDP / ΣPopulation

Never hide derived status.

33. RAW DATA INTEGRITY

Never:

null → 0

Never:

missing year → interpolation

Never:

missing year → nearby-year substitution

Never:

incomplete period → silently shorten period

Never:

unsupported operation → substitute another operation

Never mix incompatible WDI vintages.

Never merge indicators with different definitions merely because their names appear similar.

34. RELEASE-LEVEL ECONOMIC TEST

Before implementation is accepted, ask:

A. Mathematical

Is the formula correct?

B. Unit

Is the result expressed in the correct unit?

C. Denominator

Is the denominator economically appropriate?

D. Period

Are exactly the intended years used?

E. Coverage

Are required observations present?

F. Semantic type

Is the operation appropriate for:

level,
flow,
signed flow,
rate,
ratio,
index,
quote?
G. Ranking

Is the ranking based on one statistic and one universe?

H. Aggregation

Is the group operation economically valid?

I. Interpretation

Could a mathematically correct result nevertheless mislead the user?

J. Label

Does the UI label exactly match what was calculated?

A failure on any item blocks release.

35. MANDATORY FDI REGRESSION CASE

This must become a permanent regression fixture.

Using the project's captured WDI vintage:

India FDI:

2004 = $5.429B
2014 = $34.577B

Old endpoint statistic:

(34.577 / 5.429 - 1) × 100
= +536.86%

This must remain recognizable as:

Annual endpoint change — 2014 vs 2004
NOT a period statistic.

Period totals:

2004–2013 = $252.987B
2014–2023 = $442.855B

Correct period-total change:

(442.855 / 252.987 - 1) × 100
= +75.05%

This must remain the canonical regression example:

FDI decade performance: +75.05%

and:

annual endpoint flow change: +536.86%

These two numbers must never be presented as interchangeable.

36. MANDATORY PERIOD EXAMPLE

For any flow:

2004 = 10
2005 = 12
2006 = 8
2007 = 15
...
2013 = 20

the application must include every required annual observation when calculating:

Period total
Period average

It must NOT calculate:

2013 - 2004

and call that the period flow.

This test should be present in the automated suite.

37. MANDATORY RATE EXAMPLE

For:

2004 inflation = 6%
2014 inflation = 3%

required result:

-3 percentage points

not:

-50%

Both may be arithmetically computable, but only the percentage-point movement is the default economic representation.

38. MANDATORY RATIO EXAMPLE

For:

FDI = $20B
GDP = $500B

annual ratio:

20 / 500 × 100
= 4%

For a period:

ΣFDI = $200B
ΣGDP = $10,000B

cumulative FDI/GDP:

200 / 10000 × 100
= 2%

Do NOT call the second number:

average annual FDI/GDP

unless it was actually calculated as the arithmetic mean of annual ratios.

39. MANDATORY GROUP EXAMPLE

Suppose:

Country A:
FDI = $20B
GDP = $500B

Country B:
FDI = $30B
GDP = $1000B

Correct group FDI:

20 + 30
= $50B

Correct group GDP:

500 + 1000
= $1500B

Correct group FDI/GDP:

50 / 1500 × 100
= 3.33%

Do NOT calculate:

mean(4%, 3%)
= 3.5%

as the primary group ratio.

The ratio-of-sums is the aggregate economic ratio.

40. MANDATORY COMPARE EXAMPLE

Country vs country:

India vs China
FDI
Period total
2004–2013

compare:

ΣIndia FDI
vs
ΣChina FDI

Country vs official aggregate:

India vs World Bank aggregate

use the WDI-published aggregate observation where it exists.

Country vs custom group:

derive from group member WDI observations only where aggregation is valid.

Label group result:

APP_DERIVED CUSTOM GROUP

Do not convert it into a fake WDI aggregate.

41. METHODOLOGY FILE PRECEDENCE

The implementation agent must read:

WDI_ANALYTICS_MASTER_SPEC.md
WDI_ANALYTICS_MASTER_SPEC_ADDENDUM.md

in that order.

Then:

understand the Master Spec,
apply Addendum corrections,
do not silently resolve conflicts,
if a real conflict remains, STOP and report it.

The Addendum is not a replacement for the Master Spec.

It is a correction/clarification layer.

42. DECISIONS RECOMMENDED FROM THE OPEN QUESTIONS

The previous Master Spec contains O1–O12.

Recommended status:

Decision	Recommended status
O1 Mean + median + percentile	APPROVE
O2 Period-average rates	APPROVE
O3 FX movement ranking	SUPPORT AS OPTIONAL/DESCRIPTIVE
O4 CPI cumulative-change ranking	SUPPORT AS OPTIONAL/DESCRIPTIVE
O5 Inflation ranking direction	ASC descriptive; never "best"
O6 FX period-average quote	APPROVE
O7 Group GDP per capita	DEFER / OUT OF CORE SCOPE
O8 U3 + U4 universes	APPROVE
O9 Period operations in Compare	APPROVE
O10 Generic CAGR for rates/ratios/index/FX	REFUSE
O10 CAGR for ordinary flows	NOT CORE; endpoint-flow CAGR only if explicitly justified
O11 New design documents	docs/ for generated audit/report outputs; master/addendum remain at root
O12 Cleanup/test normalization	APPROVE in final QA phase
43. FINAL REQUIRED BASIS PHILOSOPHY

The application must NOT think:

Every metric needs a "Level" and a "% Growth" basis.

Instead:

Every metric needs the set of analytical operations that are economically valid for that metric.

Examples:

LEVEL / STOCK
Annual level
Endpoint change
CAGR
FLOW
Annual level
Annual YoY
Period total
Period average
Period-total change
SIGNED FLOW
Annual level
Absolute change
Guarded YoY
Period total
Period average
Absolute period change
Guarded period-total change
RATE
Annual rate
Percentage-point change
Period-average rate
Distribution
RATIO
Annual ratio
Percentage-point change
Average annual ratio
Cumulative ratio
Period ratio change
INDEX
Index level
Index-point change
Cumulative index change
QUOTED FX
Quote level
Annual quote movement
Endpoint quote movement
Period-average quote

The basis selector should be generated from these capabilities.

44. FINAL IMPLEMENTATION PRINCIPLE

Implementation must follow the approved methodology.

Do NOT allow implementation constraints to redefine economic methodology.

Correct order:

Economic meaning
        ↓
Statistical operation
        ↓
Formula
        ↓
Data requirements
        ↓
Ranking / LFL / aggregation
        ↓
Backend implementation
        ↓
API
        ↓
UI
        ↓
Chart

Never:

existing UI control
        ↓
force metric into available formula

The UI must adapt to the correct methodology.

45. FINAL RELEASE GATES

The implementation cannot be considered complete until:

every non-GDP metric has at least two economically meaningful bases,
no endpoint flow calculation is labelled period growth,
annual YoY is always consecutive-year,
period flow operations use all required annual observations,
period intervals are explicitly [A,B),
FDI period-total change is distinct from annual endpoint change,
signed-flow percentage changes have centralized guards,
rates use percentage-point semantics,
ratios are never summed,
aggregate ratios use ratio-of-sums where appropriate,
indexes are not treated as rates,
FX quote movement uses quotation semantics,
no cross-country FX level ranking exists,
no invalid CPI-index level ranking exists,
ranking never mixes statistics,
ranking universe is always visible,
LFL universe is operation-specific,
U3 and U4 are distinguishable,
peer mean/median/percentile semantics are explicit,
official WDI aggregates are never reconstructed,
custom groups are marked APP_DERIVED,
missing is never zero,
unsupported ≠ insufficient data,
Compare and Movement use the same analytical engine,
methodology is available through the existing collapsible UI,
every supported operation has a worked example,
2024 remains visible as a period boundary/context year,
long charts remain one chart with internal horizontal scrolling,
Y-axis reference remains visible,
no page-wide horizontal overflow exists,
mobile/tablet/desktop layouts remain usable,
GDP and GDP-per-capita outputs remain regression-identical,
every real-data worked example reproduces from the project's WDI vintage,
no unexplained discrepancy remains.
46. FINAL INSTRUCTION TO THE IMPLEMENTATION AGENT

Before modifying source code:

Read WDI_ANALYTICS_MASTER_SPEC.md.
Read this Addendum completely.
Reconcile the two specifications.
Mark each Addendum correction as:
incorporated,
rejected with explicit justification,
or requiring human decision.
Do NOT silently override an Addendum rule.
Do NOT begin implementation if an unresolved economic contradiction remains.

The implementation agent must preserve this principle:

The application exists to perform economically correct analysis from World Bank WDI raw observations, not merely to produce mathematically computable numbers.

END OF ADDENDUM


So the project root becomes:

project/
├── backend/
├── frontend/
├── .gitignore
├── methodlogyAppliedForall.pdf
├── README.md
├── WDI_ANALYTICS_MASTER_SPEC.md
└── WDI_ANALYTICS_MASTER_SPEC_ADDENDUM.md

The Master Spec remains the big architecture/methodology blueprint; the Addendum becomes the guardrail document that captures the corrections we identified during review, especially the important distinctions around ranking integrity, GDP's economic nature, and flow CAGR.