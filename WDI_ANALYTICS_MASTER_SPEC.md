All reconnaissance and arithmetic verification is complete. Below is the complete design specification, built on verified code behavior, the project's PDF evidence, and real WDI observations from this project's own vintage (2026-07-13).

WORLD BANK WDI ANALYTICS — COMPLETE PROPOSED SYSTEM DESIGN
(Design/review stage — no code modified)

1. EXECUTIVE SUMMARY
The application already has a strong foundation: a declarative metric registry (backend/src/config.js, 20 metrics / 8 subjects), a generic transformation layer with sign/base guards (domain/transforms.js), a semantic-operation vocabulary (domain/periods.js), guarded YoY (domain/yoy.js), direction-aware ranking with ISO3 tie-breaks (domain/ranking.js), a verified rank-movement decomposition (domain/comparison.js, domain/growthComparison.js), a three-kind entity model with capability gating (services/entities.js, services/entityCompare.js), strict half-open period arithmetic (periodSum, periodAverage), and chart components that render backend numbers verbatim.

The audit found that the economics are correct wherever the system computes a result, and the defects are almost entirely defects of coverage, semantics and presentation — operations that exist are correctly guarded, but the correct metric-specific operations are often missing, unreachable, or mislabeled. Concretely:

Endpoint-vs-period confusion (high severity): FDI's decade basis is an annual endpoint percent change (India 2004→2014 = +536.86%), while the economically meaningful decade statistic — period-total change — is +75.05% (Period A $252.99B → Period B $442.85B). The data for the correct statistic already exists; the operation is not routed.
Missing metric-appropriate bases (high severity): RATE metrics offer only a level rank (no PP change, no period-average rate in Movement); INDEX metrics offer no index-point/cumulative-change basis and collapse to a generic "no data" state; RATIO metrics (FDI % GDP) offer only an annual level; STOCK metrics lack CAGR in Movement.
False "no data" (high severity): NEUTRAL metrics (CPI index, FX quote levels) are refused by the level-comparison engine with RANK_UNSUPPORTED, which the UI renders as "No data available for this selection" (PDF pages 3 and 18) instead of a typed "unsupported for this metric — supported alternatives: …" state.
Boundary-year loss (medium-high): period totals use [A,B) correctly, but the period chart filters year < endYear, so 2024 disappears from every period visualization (PDF page 9: "But why year 2024 missing in many graphs?").
Period machinery incomplete (high severity): PERIOD_SUM_PERCENT_CHANGE exists and is tested but is not routed; there is no period ranking, no cross-period LFL universe, and no peer mean/median for period statistics.
Charts and responsiveness (medium-high): all charts are ResponsiveContainer full-width with no per-observation minimum width, no internal horizontal scrolling and no sticky Y-axis; 20–66-year series become unreadable on narrow screens.
Peer statistics (medium): only the arithmetic mean exists ("Average growth of other economies"); no median, percentile or skew warning.
The proposed system keeps every correct GDP/GDP-per-capita analytical output byte-identical (frozen regression anchors), keeps all existing guards, and adds the missing coverage through one declarative capability model, one operation vocabulary, one shared guard layer, one period/LFL/ranking engine, and typed availability states — used identically by Movement and Compare.

2. CURRENT SYSTEM UNDERSTANDING
A. Architecture
World Bank WDI API → ingestion (client.js, ingest.js: retries, pagination, TTL refresh, SQLite lock) → SQLite (schema.sql: countries, indicators, observations [value REAL + value_raw TEXT], fetch_runs, ingest_year_stats, refresh_locks) → domain (pure math) → services (orchestration) → Express JSON API (server.js, 919 lines) → React 19 + Vite + Recharts 3 frontend (display only). Node 24 / node:sqlite; Express 5; 36 backend test files; snapshot fixture backend/test/fixtures/wb-snapshot.json.

B. Metric registry (verified, config.js)
20 metrics, 8 subjects, each entry declaring: indicatorCode (canonical, substitution-proof), observationType, family, domain, unit/unitLong, currencyBasis, validChangeTypes, aggregation, rankingDirection, interpretation, comparisonCapability, signDomain, requiredDenominator, quotation, derivation, lifecycle, baseYear, periodAggregation, displayDecimals, verified.

C. Metric families (verified)
GDP per capita (4), Total GDP (4) — frozen; Prices (3); Trade (2); Capital flows (2); Exchange (1); External (3); Population (1).

D. Current bases (verified: frontend/src/config/metrics.js → movementBases)
Level (always offered; NEUTRAL metrics then refused at runtime).
Growth: offered only if validChangeTypes includes YOY; label = Annual flow (endpoint B vs A) for FLOW, Annual YoY when years are consecutive, Period endpoint change otherwise. This is the endpoint percent change for multi-year spans.
Period total / Period average: offered only if periodAggregation declares SUM/AVG (flows only). Focus-entity only; no ranks; no peers.
E. Current operations (transforms.js)
ABSOLUTE, PERCENT, PP, INDEX_POINT, YOY, CAGR, GROUP_SUM, GROUP_RATIO_FROM_SUMS, CROSS_RATE, PERIOD_SUM, PERIOD_AVG, PERIOD_SUM_PERCENT_CHANGE (routed: all except the last). Guards: zero base, negative base, sign change, non-finite, missing, INCOMPLETE_PERIOD with missingYears, INVALID_PERIOD.

F. Current Movement behavior
Basis picker → three engines: (i) level rank-movement (/api/comparison/level, optional yearMid point breaker, entered/exited/common decomposition, LFL = intersection of endpoint-year observed sets); (ii) growth rank-movement (mode=yoy: intervals A→Mid, Mid→B, A→B; LFL universe = G(AM)∩G(MB)∩G(AB); growth requires both levels present and a strictly positive base, so signed flows with non-positive bases are silently absent, though the endpoint values themselves remain valid), rank DESC; peer mean only; (iii) single-period focus summary (/api/periods/summary, strict completeness, annual bars A…B−1).

G. Current Compare behavior
/api/compare over entityA/entityB specs (country:IND, aggregate:WLD, group:IND,CHN) × metric × year(s) × operation {level, absolute_change, percent_change, pp_change, index_point_change, cagr, cross_rate} × groupMode {observed, like_for_like}. Groups: SUM families summed; FDI/GDP as ΣFDI/ΣGDP (WEIGHTED_RATIO with requiredDenominator: total_current); per-capita/inflation/index/FX groups refused with codes. NEUTRAL×country↔country level refused (UNSUPPORTED_ENTITY_COMBINATION). Provenance: RAW vs APP_DERIVED, member lists, coverage, vintage, per-year level table, LFL boxes, membership effect, trajectories.

H. Current LFL behavior
Endpoint level: common = observed(A) ∩ observed(B), common ranks recomputed inside the intersection, exact decomposition fullRankB − fullRankA = commonEffect + enteredAbove − exitedAbove (row-local comparator theorem, self-verified). Growth: LFL over intervals. Groups: observed vs all-years-valid members. Period summary: strict completeness for the focus entity only — no multi-entity period universe exists.

I. Current group behavior
SUM for additive families; weighted ratio for FDI % GDP; refusal reasons NOT_AGGREGATABLE; groups never enter country rankings; observed vs like-for-like split with membership effect.

J. Official aggregates
Read as published observations (aggregate:WLD); never synthesized; absent where WDI has none (verified: no WLD for inflation_cpi_index and fx_official) → must fail with NO_OFFICIAL_AGGREGATE.

K. Ranking behavior
Direction from registry (DESC default; ASC for inflation family; NEUTRAL refused); ISO3 ASC tie-break with distinct ordinal positions; denominator = valid observations that year; YoY rankings have their own pair-based denominator; search by exact rank preserved under filtering.

L. Missing-data behavior
Never zero; observations.value is NOT NULL; period operations require every year; YoY returns null + reason; missing bars/lines drop out.

M. Methodology disclosure
Server methodologyBlock() attached to responses (source, dataset, rank wording/disclaimer, level-ranking rule, YoY formula, YoY ranking, numerical representation, universe rule); frontend MethodologyPanel (collapsible), Movement's "Evidence & provenance" and "Methodology" blocks, Compare's panel, ChartCard source/derived labels.

N. Chart behavior (verified)
TimeSeriesChart (line, connectNulls={false}, 100%-width container, ≤8 ticks), BarComparisonChart (bars; labels angled past 8 categories), SlopeChart (two endpoints; reversed axis for ranks), ChartCard (title/unit/APP_DERIVED/source), pure chartData adapters (nulls preserved, no economics).

O. Responsive behavior
Fluid CSS grids (repeat(auto-fit, minmax(...))), media queries at 55rem/40rem, .table-scroll internal overflow for tables, viewport meta present. No per-chart min width, no sticky Y-axis, no chart scroll container → long series squeeze; several fixed grid templates (partition-row: minmax(7rem,11rem) 1fr auto) are overflow suspects at 320px.

Data coverage (read-only DB probe)
All 20 metrics ingested; India has no missing year from 2004–2024 for any metric; data extends to 2025; anchors used in this design: FDI 2004 $5.429B / 2014 $34.577B / 2024 $27.140B; CPI inflation 2004 3.77% / 2014 6.67%; CPI index 2004 63.35 / 2014 139.92; FX 45.32 / 61.03 / 83.67 LCU/USD; CA 2004 +$0.78B / 2024 −$32.02B; reserves 2004 $126.59B / 2014 $303.45B; population 1,135,991,513 / 1,450,935,791.

3. VERIFIED CURRENT DEFECTS
#	Defect	Current behavior / formula	Why it is wrong or misleading	Affected metrics	Affected UI	Affected code	Severity	Correction
D1	Decade "growth" is an annual endpoint percent	Growth basis over multi-year span computes (FDI_2014/FDI_2004 −1)×100 = +536.86% for India	It compares two annual flow observations; it is not cumulative decade FDI performance. Label "Annual flow (endpoint B vs A)" still sits where a growth statistic is expected	FDI, exports, imports, remittances (all flows)	Movement "growth" basis cards/tables	growthComparisonService.js, yoyRanking.buildYoyRows, config.validChangeTypes	HIGH	Make PERIOD_TOTAL_CHANGE ((ΣB/ΣA −1)×100 = +75.05%) the decade statistic; keep endpoint as explicitly labeled "Annual endpoint change — not a period statistic"
D2	RATE metrics offer only a level rank	inflation_cpi validChangeTypes ['ABSOLUTE','PP'], periodAggregation [] → Movement offers level only (growth disabled)	PP change is the primary rate movement; period-average inflation is a standard statistic. Users see no way to ask "how did inflation change 2004→2014?" (answer: +2.90 pp) or "average 2004–2013" (7.98%)	inflation_cpi, inflation_deflator	Movement basis picker, results	config.js, metrics.js movementBases, comparisonService	HIGH	Add RATE_PP_CHANGE, RATE_PERIOD_AVERAGE, min/max; ASC descriptive rank with neutral wording
D3	INDEX metric collapses to "no data"	CPI index rankingDirection:'NEUTRAL'; level comparison returns RANK_UNSUPPORTED; UI shows generic empty state (PDF p3)	Index levels are not cross-country rankable — correct — but index-point change and cumulative index change (real: +76.57 index points; +120.86%) are valid and missing; the refusal reason is hidden	inflation_cpi_index	Movement	comparisonService.js:166-208, RankMovement.jsx empty logic	HIGH	Typed unsupported state + INDEX_POINT_CHANGE, INDEX_CUMULATIVE_CHANGE; no level ranking
D4	FX level "no data", quote semantics absent	NEUTRAL refusal (PDF p18); growth basis reuses generic YoY/percent labels	FX has valid operations (annual/endpoint quote movement; period-average quote) and an explicit quotation convention (LCU per USD, increase = depreciation) that is not surfaced per-operation	fx_official	Movement	comparisonService.js, config.quotation, periods.js vocabulary (unused)	HIGH	FX_QUOTE_LEVEL, FX_ANNUAL_MOVEMENT, FX_ENDPOINT_MOVEMENT, FX_PERIOD_AVERAGE_QUOTE; typed states; no cross-country level rank, no group FX
D5	Signed-flow change bases missing	CA offers growth but India's gauge fails guards (2004 +$0.78B → 2024 −$32.02B = sign change; period A total negative) and shows empty; PDF p19 "annual flow not available"	The valid statistics exist: annual absolute change, period totals, period absolute change (+$34.55B toward smaller deficit); percent change on −$341.66B base is correctly refused (−10.11% would mislead)	current_account, fdi_inflows	Movement	growthComparisonService (YOY gating), config.js	HIGH	Signed-flow bases: absolute/period absolute always; percent only with positive base and no sign change; deficit/surplus wording
D6	PERIOD_SUM_PERCENT_CHANGE unreachable	Implemented + unit-tested; no route, no service, no UI	The economically central period-change statistic cannot be requested, so the endpoint defect D1 has no counterweight	flows	Movement, Compare	transforms.js:523-553, periodService.js	HIGH	Route it via period-comparison service (strict LFL), expose in Movement/Compare with period labels
D7	No period ranking / period LFL / period peers	/api/periods/summary is focus-only, unranked, no mean/median	"Cumulative FDI rank 2004–2013" and peer gaps are required outputs; ranks must show universe (X/N) and 10-observation completeness	all flows	Movement period bases	periodService.js	HIGH	New period-comparison service: per-period ranks (U3), strict cross-period LFL (U4), peer mean/median/percentile
D8	2024 boundary year vanishes from visuals	Period bars filter year >= startYear && year < endYear; chart title states 2004–2013; nothing marks 2024 (PDF p9)	Computational [A,B) is correct; visual context loss is not	all period bases	Movement period charts	RankMovement.jsx PeriodSummary (2765-2767, 2807-2819)	MEDIUM-HIGH	Render boundary year as a distinct context marker with tooltip "excluded from period total"
D9	Mean-only peers, ambiguous label	peerAverageGrowth; UI label "Average growth of other economies"	Label can read as "world average"; skewed flow distributions need median/percentile	all growth bases	Movement growth cards	domain/growthComparison.js, RankMovement.jsx:2148-2166	MEDIUM	Add median + percentile + skew note; labels "Mean/Median across eligible economies"
D10	FDI % GDP: annual level only in Movement	RATIO validChangeTypes ['ABSOLUTE','PP'], periodAggregation [] (PDF p16)	Valid ratio operations missing: PP change, period-average ratio, cumulative ratio (real: A 1.89% → B 1.63%), period PP change	fdi_inflows_pct_gdp	Movement	config.js, movementBases	MEDIUM-HIGH	Add RATIO ops; never sum ratios; group ratio already correct (ΣFDI/ΣGDP)
D11	STOCK metrics lack CAGR/endpoint bases in Movement	Reserves/population: level + endpoint growth only (PDF p22-27)	CAGR is standard for stocks (reserves 2004–2014 CAGR 9.14%; population 2004–2024 CAGR 1.23%)	reserves_ex_gold, population_total	Movement	movementBases (no CAGR concept)	MEDIUM	Add CAGR and explicit endpoint absolute/percent bases; optional period-average stock/population (never summed as growth)
D12	Charts have no scroll/sticky axis; long series crammed	ResponsiveContainer width 100%; tickCount min(8,n); no overflow container	20–66-point series unreadable at ≤430px; ticks/clipped labels degrade; violates §31/§32	all	all chart surfaces	TimeSeriesChart.jsx, BarComparisonChart.jsx, index.css	MEDIUM-HIGH	ScrollableChart wrapper: one chart, plotWidth = max(container, n × minStep), internal overflow-x, sticky Y-axis overlay, keyboard/touch
D13	Compare lacks period operations and typed states	Ops list has no period ops; some refusals rendered generically	Same engine must power both tabs (§31); "no data" vs "unsupported" vs "insufficient" must be distinguishable	all	Compare	entities.js COMPARE_OPERATIONS, Compare.jsx	MEDIUM-HIGH	Add period ops + typed availability envelope + reason codes rendered verbatim
D14	No operation-scoped rank labels	Rank labels say "Level (value)" / "Annual YoY" but rank statistics like "cumulative FDI rank" or "period-average inflation rank" don't exist	§21/§26 require the rank statistic to be named exactly	all	Movement, Rank	ranking labels, fullRanking	MEDIUM	Operation-scoped rank labels + universe lines (#X/N, universe rule)
D15	Minor housekeeping	backend/full7c2.log stray file; one env-dependent test fails because local .env sets REFRESH_ADMIN_TOKEN while the test expects an open endpoint (documented in README)	Repo hygiene + deterministic test runs	—	—	repo root	LOW	Remove stray log (implementation phase); keep documented test caveat or neutralize in test harness
Code vs PDF discrepancies (explicit): (1) PDF p3 says "only basis level is available" for CPI inflation; code renders a disabled growth option with reason "Growth analysis is not declared for this metric" — effectively the same UX, but the PDF omits the disabled option. (2) PDF p3/p18 "no data" states are not data absence: the backend returns a precise RANK_UNSUPPORTED refusal that the UI collapses into "No data available for this selection" — verified at comparisonService.js:204-207 and RankMovement empty-state logic. (3) PDF p7 correctly describes the endpoint basis; the code label is "Annual flow (endpoint B vs A)", matching the PDF behavior but remaining economically misleading in a growth slot (D1). (4) PDF p19 "annual flow not available" for current account is the sign-guard/shortfall of a positive base for the selected endpoints, not missing data (verified: 2004 positive → 2024 negative).

4. ECONOMIC SEMANTIC TAXONOMY
Type	Economic meaning	Valid operations	Invalid operations (and why)
LEVEL / STOCK	A quantity measured at a point/period end or an instantaneous state (population, reserves, an index level, GDP generated during a year but conventionally treated as a level)	Level + rank; endpoint absolute/percent change; CAGR; optional period-average level (labelled as a level, not growth); group SUM where additive	Period SUM of stocks presented as growth; summing indexes
FLOW	A quantity accumulated over a year (exports, imports, remittances)	Annual level + rank; annual YoY %; period total; period average; period-total absolute/percent change; group SUM	Endpoint percent change presented as period growth; averaging sums of incompatible years
SIGNED FLOW / BALANCE	A flow that can be negative and whose sign is economically meaningful (FDI net inflows, current account balance)	Annual level + rank (algebraic, descriptive); annual absolute change; annual percent only with positive base and no sign change; period total; period average; period absolute change; period percent only with positive base and no sign change; group SUM	Ordinary percent change from zero/negative/sign-changing bases; calling a smaller deficit "−10% growth"
RATE	A percentage that is already a ratio-of-a-year quantity (CPI inflation, GDP-deflator inflation)	Annual rate + descriptive rank; percentage-point change; period-average rate (mean of annual rates); min/max/distribution	Summation; CAGR; ordinary relative percent growth as primary result
RATIO	A dimensionless quotient (FDI % of GDP)	Annual ratio + rank; PP change; period-average ratio (mean of annual ratios, labelled); cumulative ratio Σnum/Σden (period-economic aggregate); period PP change; group ratio-of-sums	Summing ratios; averaging ratios for group aggregates where ratio-of-sums is the economic quantity
INDEX	A normalized level with a fixed base (CPI index, 2010=100)	Within-entity level; index-point change; cumulative index % change; cross-entity comparison of changes only	Cross-country level ranking; summing indexes; calling cumulative index change "inflation rate" or "GDP growth"
QUOTED EXCHANGE RATE	A price of one currency in another under a declared convention (LCU per USD, period average)	Quote level (within-entity); annual quote movement; endpoint quote movement; period-average quote; cross-entity comparison of movements	Summing quotes; group-average quotes; cross-country level ranking; calling movement "currency growth"
5. CORE ANALYTICAL PRINCIPLES
Capability-driven, declarative. Behavior derives from registry declarations (semantic type, operations, sign policy, period rules, ranking, aggregation); no if metric === 'fdi' branching.
Semantics before arithmetic. Every transform is selected by semantic operation identity (ANNUAL_YOY ≠ PERIOD_TOTAL_CHANGE ≠ ANNUAL_ENDPOINT_PERCENT), even when two operations share a primitive.
Interval discipline. Period operations use [A,B) with 10 observations for 2004→2014→2024 (2004–2013, 2014–2023); endpoints use the selected years themselves (2014 vs 2004). The UI states both, never an arrow alone.
Sign/base discipline (shared guards). Percent change refused for zero base, negative base, or sign change; absolute change always available; period percent change requires positive period-A total and non-negative period-B total.
Missing ≠ zero, ever. Strict completeness; UNAVAILABLE with exact missing years; no interpolation/fill/silence.
Operation-specific LFL. Endpoint intersection; period-complete universe; strict cross-period universe; group observed vs like-for-like.
Backend-authoritative numbers. The frontend formats and presents; it never computes economics.
Provenance is data. RAW vs APP_DERIVED, official aggregate vs custom group, legs, formulas, universes, vintages travel with every result.
Label = calculation. The rank statistic and the change statistic are named exactly ("Cumulative net FDI inflow rank, 2004–2013", "Period-total change · 2014–2023 vs 2004–2013").
Economically misleading is a defect even when arithmetically valid. The D1 contrast (+536.86% endpoint vs +75.05% period) is the canonical regression case.
6. COMPLETE METRIC METHODOLOGY
Notation: A,B = selected endpoint years; PA=[A,M), PB=[M,B); IND values are from this project's WDI vintage (2026-07-13). GDP/GDP-per-capita blocks are frozen (identical outputs required); only disclosure/presentation may change.

6.1 GDP per capita family (FROZEN)
Metrics: nominal_current NY.GDP.PCAP.CD (current US$); nominal_constant NY.GDP.PCAP.KD (constant 2015 US$); ppp_current NY.GDP.PCAP.PP.CD (current int'l $); ppp_constant NY.GDP.PCAP.PP.KD (constant 2021 int'l $).

Item	Specification (frozen)
Type / unit	LEVEL, derived per-person; US$ / int'l $ per person
Raw meaning	WDI GDP per capita; raw value used unrounded
Bases	Annual level + rank (DESC); annual YoY % ((v_t/v_{t−1})−1)×100 (positive base; existing rules); annual endpoint percent ((B/A−1)×100, base>0); CAGR ((B/A)^(1/n)−1)×100; rank-movement + LFL (existing)
Invalid	Period SUM/AVG (undeclared, refused); group SUM; conventional percent from zero/negative base (never occurs; guard stays)
Ranking statistic / direction / universe	Annual per-capita value; DESC; eligible economies with a valid stored observation that year; ties ISO3 ordinal
LFL	Endpoint intersection (existing, unchanged); growth universe (existing)
Missing	Observation absent → no rank, no YoY, no CAGR; gaps break lines
Sign/base	POSITIVE_ONLY guard
Aggregation	Country level; official aggregate read as published; custom group refused (NOT_AGGREGATABLE); optional new APP_DERIVED ΣGDP/ΣPopulation for groups (open question O7)
Compare	Existing capability set, unchanged
Chart	Line (history), slope (endpoint), rank slope (movement)
Wording	"Level (value)", "Annual YoY · 2024 vs 2023", "Period endpoint change · 2024 vs 2004", "CAGR · 2004→2024"
Worked example (real)	Nominal per capita 2004 = 624.2588, 2024 = 2591.9917 → endpoint (2591.9917/624.2588 −1)×100 = +315.21%; CAGR (2591.9917/624.2588)^(1/20) − 1 = +7.38% per year
Interpretation	Nominal per-capita level change in current dollars; CAGR is the smoothed annual rate
Misconception	Current-US$ change ≠ real purchasing-power change (use nominal_constant/PPP variants); CAGR ≠ each year's actual growth
6.2 Total GDP family (FROZEN)
total_current NY.GDP.MKTP.CD; total_constant NY.GDP.MKTP.KD; total_ppp_current NY.GDP.MKTP.PP.CD; total_ppp_constant NY.GDP.MKTP.PP.KD.

Same frozen bases as 6.1 (annual level/rank DESC, YoY, endpoint %, CAGR, movement/LFL); group SUM allowed (existing); period operations remain undeclared. Worked example (real): total current GDP 2004 = $709.153B → 2024 = $3,760.813B; endpoint +430.31%; CAGR +8.70%/yr. (Computed from the same vintage; endpoint 430.31 = (3760.813/709.153 −1)×100.) Misconception: current-dollar doubling is not real output doubling; group SUM of GDP is nominal unless constant-price series are summed.

6.3 CPI inflation, annual % (inflation_cpi, FP.CPI.TOTL.ZG) — RATE
Item	Specification
Type/unit	RATE; annual % (percentage points when differenced)
Bases	RATE_ANNUAL (level value; descriptive rank ASC); RATE_PP_CHANGE B − A (percentage points); RATE_PERIOD_AVERAGE mean(annual rates over [A,B)) (annual %, strict completeness); min/max (display-only facts)
Invalid (refused with reason)	Summation; PERCENT relative change as primary; CAGR; period SUM
Ranking	Statistic: annual rate (and period-average rate for RATE_PERIOD_AVERAGE); direction ASC (lower first), never worded "better"; universe = valid observations for the operation's required years
LFL	Annual rank: valid that year; period-average rank: U3 (all years in the period)
Period	[A,B), e.g. 2004–2013 · 10 annual observations
Missing	One missing year → period average unavailable (incomplete_period + missing years); missing year means no annual rank that year
Sign/base	Rate values may be negative; PP change unrestricted; no percent-change path exists
Aggregation	OFFICIAL_ONLY; group mean of member rates refused; use WDI aggregate when present (WLD exists)
Compare	level, pp_change (existing); add period-average rate
Chart	Rate time series (line), zero reference; PP change as labelled bar/card
Wording	"Annual inflation rate · 2014", "Inflation change · 2014 vs 2004 · percentage points", "Average annual inflation · 2004–2013"
Worked example (real)	2004 = 3.77%, 2014 = 6.67% → PP +2.90 pp (NOT +76.94%); average 2004–2013 = 7.98% (10 obs) vs 2014–2023 = 5.16%; range 2004–2023: min 3.33%, max 11.99%
Interpretation	Inflation fell/rose in percentage points; period average is the typical annual rate
Misconception	"Inflation rose 76.94%" is a relative ratio of rates, not the standard movement; a period average is not cumulative price change (that is the CPI index)
6.4 GDP-deflator inflation (inflation_deflator, NY.GDP.DEFL.KD.ZG) — RATE
Identical to 6.3. Worked example (real): 2004 = 5.73% → 2014 = 3.33% → −2.39 pp; averages 2004–2013 = 7.63%, 2014–2023 = 3.86%. Ranking ASC descriptive. Misconception: it is an economy-wide deflator, not consumer inflation; never compare it with CPI as the same price measure.

6.5 CPI index (2010 = 100) (inflation_cpi_index, FP.CPI.TOTL) — INDEX
Item	Specification
Type/unit	INDEX; index points (base 2010 = 100)
Bases	INDEX_LEVEL (within-entity only); INDEX_POINT_CHANGE B − A (index points); INDEX_CUMULATIVE_CHANGE ((B/A)−1)×100 (%, only base > 0)
Invalid (refused)	Cross-country level rankings (NEUTRAL); summation; CAGR; PP change; calling cumulative change "inflation rate"
Ranking	No level rank. Optional descriptive ranking of cumulative index change across countries (same 2010=100 base; open question O4)
LFL	Comparison of cumulative changes uses endpoint intersection; within-entity operations need both endpoint years
Missing	Endpoint missing → change unavailable; no interpolation
Sign/base	Index positive by construction; guard retained
Aggregation	OFFICIAL_ONLY for aggregates; no WLD aggregate exists (verified) → NO_OFFICIAL_AGGREGATE; custom groups refused (NOT_AGGREGATABLE)
Compare	index_point_change (existing) + index_cumulative_change (new); level only entity-vs-self
Chart	Line (index history); change cards/bars for point/cumulative change
Wording	"Index level · 2014", "Index-point change · 2014 vs 2004 · 76.57 index points", "Cumulative CPI index change · 2014 vs 2004 · +120.86%"
Worked example (real)	63.3536 → 139.9244: +76.57 index points; (139.9244/63.3536 −1)×100 = +120.86%
Interpretation	Prices measured by this index were 120.86% higher; index points express the same movement on the index scale
Misconception	"+120.86% index change" ≠ "120.86% inflation in one year" and ≠ "GDP growth"; index levels are not comparable across countries without a common base and basket assumptions
6.6 Exports (exports_current, NE.EXP.GNFS.CD) — FLOW
Item	Specification
Type/unit	FLOW; current US$
Bases	ANNUAL_LEVEL (+rank DESC); ANNUAL_YOY %; PERIOD_TOTAL Σ[A,B); PERIOD_AVERAGE Σ/N; PERIOD_TOTAL_PERCENT_CHANGE (ΣB/ΣA−1)×100 (ΣA>0); PERIOD_TOTAL_ABSOLUTE_CHANGE ΣB−ΣA
Invalid	Endpoint percent presented as period growth; real-volume claims (no volume series ingested → unsupported)
Ranking	Annual level DESC ("largest export value"); period total DESC ("cumulative export value rank"); period average DESC; period-total change ranked only when computable; universes U1/U3/U4
LFL	Period total/avg ranks: U3; period-total change: U4 (2004–2023 all years)
Period	[A,B); 2004→2013 = 10 obs; disclose includedYears, excludedBoundaryYears:[2024]
Missing	Strict; one missing year → period operation unavailable with exact list
Sign/base	POSITIVE_ONLY
Aggregation	Group SUM (existing); official aggregate read as published (WLD exists)
Compare	level, absolute change, YoY/percent (existing) + period total/average/change (new)
Chart	Bars (annual flows), bars (period totals), bars/rate cards (changes)
Wording	"Export value, current US$ · 2014", "Period total in export value · 2004–2013", "Period-total change in export value · 2014–2023 vs 2004–2013"
Worked example (real)	Σ A = $3,046.511B; Σ B = $5,632.325B → +84.88%; label "Period-total change in export value (current US$): +84.88%"
Interpretation	Cumulative current-dollar export value nearly doubled across the two decades
Misconception	This is not real export volume growth; price and exchange-rate effects are embedded
(Imports imports_current, NE.IMP.GNFS.CD: identical structure. Real example: Σ A = $3,669.415B; Σ B = $6,275.751B → +71.03%.)

6.7 FDI net inflows (fdi_inflows, BX.KLT.DINV.CD.WD) — SIGNED FLOW
Item	Specification
Type/unit	SIGNED FLOW; current US$
Bases	ANNUAL_LEVEL (+rank DESC, wording "largest annual net inflow"); ANNUAL_ABSOLUTE_CHANGE; ANNUAL_YOY only when base > 0 and no sign change, else unavailable with reason; PERIOD_TOTAL Σ[A,B); PERIOD_AVERAGE Σ/N; PERIOD_TOTAL_ABSOLUTE_CHANGE; PERIOD_TOTAL_PERCENT_CHANGE only when ΣA > 0 and ΣB ≥ 0; optional ANNUAL_ENDPOINT (absolute always; percent guarded) labelled "not a period statistic"
Invalid	Endpoint percent as decade statistic; percent from zero/negative/sign-changing base; period percent with negative ΣA
Ranking	Annual: DESC by yearly value ("Annual net FDI inflow rank — 2014"); Period total: DESC by Σ ("Cumulative net FDI inflow rank — 2004–2013"); Period average: DESC ("Average annual net FDI inflow rank — 2004–2013"); Change rank only when the percent exists, else "absolute period change rank"; universes U1/U3/U4
LFL	U4 for change comparisons; U3 for period ranks; disclose eligible, ranked, excluded counts with reasons
Period	[A,B); 10 obs each; boundary years shown as context
Missing	Strict; unavailable + exact years
Sign/base	SIGNED; central guard tests
Aggregation	Group SUM (existing); official aggregate WLD exists; group weighted-ratio only for the % variant
Compare	level, absolute (existing) + period total/avg/change, endpoint absolute (new)
Chart	Bars (annual, zero line), bars (period totals), change card/bars
Wording	"Annual net FDI inflow · 2014", "Period total · 2004–2013 · 10 annual observations", "Period average · 2004–2013", "Period-total change · 2014–2023 vs 2004–2013", "Annual endpoint change · 2014 vs 2004 (not a period statistic)"
Worked example (real)	Σ A = $252.987B; Σ B = $442.855B → +75.05%; endpoint 2014 vs 2004 = +536.86% (annual values 5.4293B → 34.5766B) — same underlying data, two different questions, only the first is "decade FDI performance"
Interpretation	Cumulative net FDI inflows rose ~75% between the two decades; annual endpoint jumped because 2004 was a small base year
Misconception	"+536.86%" is not a decade total; "rank 3 of 151" is not "3rd best performer" — it is the 3rd-largest cumulative inflow
Peer benchmark	India Σ = $252.99B vs peer mean $X → absolute gap in US$ ("$Y below peer mean"), relative gap only when mean > 0, plus median, percentile, rank
6.8 FDI net inflows, % of GDP (fdi_inflows_pct_gdp, BX.KLT.DINV.WD.GD.ZS) — RATIO
Item	Specification
Type/unit	RATIO; % of GDP
Bases	RATIO_ANNUAL (+rank DESC); RATIO_PP_CHANGE; RATIO_PERIOD_AVERAGE (mean of annual ratios — "typical annual ratio", strict completeness); RATIO_CUMULATIVE ΣFDI/ΣGDP×100 (APP_DERIVED, legs shown); RATIO_PERIOD_PP_CHANGE (cumB − cumA) in pp
Invalid	Summing annual percentages; using the mean when the cumulative ratio is the economic aggregate (and vice versa) without labels
Ranking	Annual ratio DESC ("FDI/GDP ratio rank — 2013"); cumulative ratio DESC; period-average ratio DESC; universes U1/U3
LFL	U4 for period PP change; U3 for cumulative ratio ranks; group ratio uses same-year, same-group legs
Missing	Either leg missing for a year → that year's ratio unavailable; period ratio requires both legs complete
Sign/base	SIGNED numerator; GDP denominator > 0 guard
Aggregation	WEIGHTED_RATIO: Σ member FDI / Σ member GDP × 100 (existing, correct); never mean of member ratios; official aggregate read as published (WLD exists)
Compare	annual/PP (existing) + period average, cumulative, period PP change (new)
Chart	Line (annual ratio), bars (cumulative ratio per period), PP change cards
Wording	"FDI net inflows, % of GDP · 2014", "FDI/GDP change · 2014 vs 2004 · percentage points", "Average annual FDI/GDP · 2004–2013", "Cumulative FDI/GDP · 2004–2013 · ΣFDI ÷ ΣGDP × 100"
Worked example (real)	Annual 2014: 34.5766B/2,039.126B×100 = 1.70% (WDI 1.6957%); cumulative A = 252.987/13,410.342×100 = 1.89%; cumulative B = 442.855/27,220.489×100 = 1.63% → period PP change −0.26 pp
Interpretation	Relative to the size of the economy, net FDI intensity was slightly lower in the second decade despite higher absolute inflows
Misconception	"FDI/GDP fell" here is a ratio statement (pp), not a dollar decline; the cumulative ratio is not the average of annual ratios
6.9 Official exchange rate (fx_official, PA.NUS.FCRF) — QUOTED RATE
Item	Specification
Type/unit	QUOTED RATE, LCU per US$ (period average); increase = local-currency depreciation under this convention
Bases	FX_QUOTE_LEVEL (within-entity); FX_ANNUAL_MOVEMENT ((q_t/q_{t−1})−1)×100 ("quote movement"); FX_ENDPOINT_MOVEMENT ((q_B/q_A)−1)×100; FX_PERIOD_AVERAGE_QUOTE mean(annual quotes over [A,B)) (APP_DERIVED, labelled "average annual quote — not a growth rate")
Invalid	Summing quotes; group-average quote; cross-country level ranking; CAGR on the quote; "currency growth"
Ranking	NEUTRAL — no level rank; movement comparison across countries allowed with explicit depreciation wording (open question O3)
LFL	Endpoint intersection for movement comparison; U3 for period-average quote
Missing	Strict; period quote unavailable if any year missing
Sign/base	Quote > 0 guard
Aggregation	MEMBER_ONLY (existing); no official aggregate exists (verified) → NO_OFFICIAL_AGGREGATE; custom groups refused
Compare	level (self), percent movement, period average quote; movement comparison country↔country; no group quotes
Chart	Line of quote with caption "a rise is depreciation against the US$"; movement bars
Wording	"Exchange-rate quote · 2024 · LCU per US$", "Quote movement · 2024 vs 2004 · +84.63% (depreciation of the rupee under LCU/USD)"
Worked example (real)	45.3165 → 83.6693: (83.6693/45.3165 −1)×100 = +84.63% → the rupee required 84.63% more LCU per USD; average quote 2004–2013 = 47.24, 2014–2023 = 70.55
Interpretation	Nominal quote movement under a declared convention
Misconception	A rising quote is depreciation, not economic growth; quotes are not comparable levels across countries
6.10 Current account balance (current_account, BN.CAB.XOKA.CD) — SIGNED FLOW/BALANCE
Item	Specification
Type/unit	SIGNED FLOW; current US$ (surplus > 0, deficit < 0)
Bases	ANNUAL_BALANCE (+rank DESC algebraic, wording "largest surplus"); ANNUAL_ABSOLUTE_CHANGE; PERIOD_TOTAL; PERIOD_AVERAGE; PERIOD_TOTAL_ABSOLUTE_CHANGE; PERIOD_TOTAL_PERCENT_CHANGE only when ΣA > 0 and ΣB ≥ 0 (typically refused); ANNUAL_YOY only under guards
Invalid	Ordinary growth from zero/negative/sign-changing bases ("−10.11%" is computed nowhere)
Ranking	Annual algebraic value DESC descriptive; period algebraic total DESC; universes U1/U3
LFL	U4 for period change; U3 for period total
Missing	Strict
Sign/base	SIGNED; deficit wording mandatory
Aggregation	Group SUM (existing); official aggregate read as published; group totals are cumulative net balances
Compare	level, absolute (existing) + period total/average/absolute change (new)
Chart	Bars with zero line (annual balance), bars (period totals), absolute-change cards
Wording	"Current account balance · 2014 · current US$", "Period total · 2004–2013 (cumulative balance)", "Absolute period change · 2014–2023 vs 2004–2013 · +$34.55B (toward a smaller deficit)"
Worked example (real)	Σ A = −$341.664B; Σ B = −$307.114B → absolute change +$34.550B (deficit shrank); percent change unavailable (negative_base_for_percent_change); annual 2004 +$0.780B → 2024 −$32.015B → YoY percent unavailable (sign_change_across_endpoints)
Interpretation	The cumulative external position moved toward a smaller deficit, by $34.55B across the two decades
Misconception	A smaller deficit is not "−10% growth"; sign changes invalidate ordinary percentages
6.11 Reserves excluding gold (reserves_ex_gold, FI.RES.XGLD.CD) — STOCK/LEVEL
Item	Specification
Type/unit	STOCK/LEVEL; current US$
Bases	ANNUAL_LEVEL (+rank DESC); ENDPOINT_ABSOLUTE_CHANGE; ENDPOINT_PERCENT_CHANGE (both > 0); CAGR; optional PERIOD_AVERAGE_STOCK (mean of annual stocks, labelled "average stock level — not growth")
Invalid	Period SUM as "reserve growth"; CAGR with non-positive endpoint
Ranking	Annual stock DESC; period-average stock DESC (descriptive level rank); universes U1/U3
LFL	U1 for endpoint, U3 for period-average stock
Missing	Strict; endpoint change unavailable if either endpoint missing
Sign/base	POSITIVE_ONLY
Aggregation	Group SUM (existing; aggregate reserve stock); official aggregate WLD exists
Compare	level, absolute, percent, CAGR (existing) + period-average stock (new)
Chart	Line (stock history), slope/endpoint cards, bars for period-average stock
Wording	"Reserves minus gold · 2004 · $126.59B", "Endpoint change · 2014 vs 2004 · +$176.86B (+139.71%)", "CAGR · 2004→2014 · 9.14%/yr"
Worked example (real)	126.593B → 303.455B: absolute +$176.862B; percent +139.71%; CAGR (303.455/126.593)^(1/10)−1 = 9.14%/yr
Interpretation	Stock accumulation rate, annualized
Misconception	Summing stocks across years is meaningless; CAGR is a smoothed rate, not a yearly guarantee
6.12 Remittances received (remittances_received, BX.TRF.PWKR.CD.DT) — FLOW
Verified WDI semantics: "Personal remittances, received (current US$)" — a credits flow, non-negative in the data; keep the POSITIVE_ONLY declaration and the shared sign guard (defensive; if a negative ever appears, percent operations refuse rather than mislabel). Bases, ranking, LFL, period, missing, aggregation, Compare and wording follow exports (6.6). Real example: Σ A = $460.377B; Σ B = $836.404B → period-total change +81.68%. Misconception: current-dollar flow growth ≠ real inflow growth; remittances are household transfers, not investment.

6.13 Population (population_total, SP.POP.TOTL) — STOCK/LEVEL
Item	Specification
Type/unit	STOCK/LEVEL; people (midyear de-facto)
Bases	ANNUAL_LEVEL (+rank DESC); ANNUAL_YOY % (growth); ENDPOINT_PERCENT_CHANGE; CAGR; optional PERIOD_AVERAGE_POPULATION (mean of annual counts, "average population during the period")
Invalid	Summing annual population as "population growth"; CAGR with non-positive endpoint (guard)
Ranking	Annual population DESC; period-average population DESC descriptive; universes U1/U3
LFL	U1 endpoint; U3 period average
Missing	Strict
Sign/base	POSITIVE_ONLY
Aggregation	Group SUM = aggregate population (existing, explicitly defined demographic quantity); official aggregate WLD exists
Compare	level, absolute, percent, CAGR (existing) + period average (new)
Chart	Line (history), growth line, endpoint/CAGR cards
Wording	"Population · 2024", "Annual growth · 2024 vs 2023", "CAGR · 2004→2024"
Worked example (real)	1,135,991,513 → 1,450,935,791: +27.72%; CAGR (1450935791/1135991513)^(1/20)−1 = 1.23%/yr
Interpretation	Demographic accumulation over two decades
Misconception	Population sums are population totals over time, not growth; CAGR is smoothed
6.14 Group per-capita (proposed, open question O7)
GROUP_PER_CAPITA: Σ member GDP / Σ member population — only when both legs exist for the same members, years and bases; labelled APP_DERIVED with both legs, member list, coverage and vintage; refused otherwise. This does not alter any existing country/aggregate per-capita result.

7. COMPLETE BASIS MATRIX (master table)
Family	Metric	Type	Basis (operation)	Question answered	Formula (unit)	Years used	Rank?	Rank statistic & universe	LFL	Group aggregation	Compare	Primary chart	Label	Caveat
GDP pc (×4)	nominal_current, nominal_constant, ppp_current, ppp_constant	LEVEL	ANNUAL_LEVEL	Value per person that year	raw (US$/pers)	1 year	Yes, DESC	annual value; U1-year	—	✗	✓	line	"Level (value)"	current vs constant vs PPP differ
GDP pc	—	LEVEL	ANNUAL_YOY	Year-on-year change	(v_t/v_{t−1}−1)×100 (%)	t−1,t	Yes	YoY DESC; pair universe	pair	✗	✓	line	"Annual YoY"	base > 0
GDP pc	—	LEVEL	ANNUAL_ENDPOINT_PERCENT	Change between selected years	(B/A−1)×100 (%)	2	Yes	endpoint observed sets; U1	U1	✗	✓	slope	"Period endpoint change · B vs A"	endpoints only
GDP pc	—	LEVEL	CAGR	Smoothed annual rate	((B/A)^(1/n)−1)×100 (%/yr)	2	✗	—	—	✗	✓	cards	"CAGR"	both > 0
GDP pc	—	LEVEL	MOVEMENT/LFL	Rank change decomposition	rank math	2–3	Yes	existing	U1	✗	✗	rank slope	"Rank movement"	frozen
GDP pc	—	LEVEL	GROUP_PER_CAPITA (new, O7)	Group average income	ΣGDP/ΣPOP (US$/pers)	1	✗	—	group LFL	APP_DERIVED	✓	bar	"Group GDP per capita (derived)"	APP_DERIVED
Total GDP (×4)	total_*	LEVEL	ANNUAL_LEVEL / YOY / ENDPOINT / CAGR / movement	as above	as above	1–3	Yes DESC	annual value; U1	U1	SUM	✓	line/slope	as above	nominal vs real vs PPP
Prices	inflation_cpi, inflation_deflator	RATE	RATE_ANNUAL	Inflation that year	raw (%)	1	Yes, ASC descr.	annual rate; valid-year	—	OFFICIAL_ONLY	✓	line	"Annual inflation rate"	lower ≠ "better"
Prices	idem	RATE	RATE_PP_CHANGE	Movement in the rate	B−A (pp)	2	✗	—	U1	✗	✓	bars	"Inflation change · percentage points"	not a % of %
Prices	idem	RATE	RATE_PERIOD_AVERAGE	Typical annual rate	mean(rates[A,B)) (%)	10	Yes ASC descr.	period-average rate; U3	U3	✗	✓	bar	"Average annual inflation · A–B"	not cumulative price change
Prices	inflation_cpi_index	INDEX	INDEX_LEVEL	Index value that year	raw (index pts)	1	✗ (NEUTRAL)	—	—	OFFICIAL_ONLY (none exists)	✓ (self)	line	"Index level"	not cross-country comparable
Prices	idem	INDEX	INDEX_POINT_CHANGE	Movement on index scale	B−A (index pts)	2	✗	—	U1	✗	✓	cards	"Index-point change"	not pp
Prices	idem	INDEX	INDEX_CUMULATIVE_CHANGE	Cumulative price-level change	(B/A−1)×100 (%)	2	optional (O4)	cumulative change; U1	U1	✗	✓	bars	"Cumulative CPI index change"	not inflation rate
Trade	exports_current, imports_current	FLOW	ANNUAL_LEVEL	Flow that year	raw (US$)	1	Yes DESC	annual value; valid-year	—	SUM	✓	bars	"Export/import value · current US$"	nominal
Trade	idem	FLOW	ANNUAL_YOY	Year-on-year flow change	(v_t/v_{t−1}−1)×100 (%)	t−1,t	Yes	YoY DESC; pair	pair	SUM	✓	bars	"Annual YoY"	nominal
Trade	idem	FLOW	PERIOD_TOTAL	Cumulative flow	Σ[A,B) (US$)	10	Yes DESC	period sum; U3	U3	SUM	✓	bars	"Period total · A–B"	≠ endpoint
Trade	idem	FLOW	PERIOD_AVERAGE	Typical annual flow	Σ/N (US$/yr)	10	Yes DESC	period average; U3	U3	SUM	✓	bars	"Period average · A–B"	≠ total
Trade	idem	FLOW	PERIOD_TOTAL_PERCENT_CHANGE	Period-over-period growth	(ΣB/ΣA−1)×100 (%)	20	Yes, valid only	change; U4	U4	✗ (derived from sums)	✓	bars	"Period-total change · B vs A"	ΣA > 0
Trade	idem	FLOW	PERIOD_TOTAL_ABSOLUTE_CHANGE	Absolute period movement	ΣB−ΣA (US$)	20	Yes DESC	absolute change; U4	U4	✗	✓	bars	"Absolute period change"	always available
Capital	fdi_inflows	SIGNED FLOW	ANNUAL_LEVEL	Net inflow that year	raw (US$)	1	Yes DESC	annual value; valid-year	—	SUM	✓	bars (zero line)	"Annual net FDI inflow"	negatives possible
Capital	idem	SIGNED FLOW	ANNUAL_ABSOLUTE_CHANGE	Dollar change	v_t−v_{t−1} (US$)	t−1,t	Yes DESC	abs change; pair	pair	✗	✓	bars	"Annual absolute change"	always valid
Capital	idem	SIGNED FLOW	ANNUAL_YOY	% change (guarded)	(v_t/v_{t−1}−1)×100 (%)	t−1,t	Yes, valid only	YoY; computable pairs	pair	✗	✓	bars	"Annual YoY"	refuses zero/neg/sign change
Capital	idem	SIGNED FLOW	PERIOD_TOTAL / AVERAGE	Cumulative/typical inflow	Σ / Σ/N (US$, US$/yr)	10	Yes DESC	sum/avg; U3	U3	SUM	✓	bars	"Period total/Period average · A–B"	completeness strict
Capital	idem	SIGNED FLOW	PERIOD_TOTAL_ABSOLUTE_CHANGE	Decade dollar movement	ΣB−ΣA (US$)	20	Yes DESC	abs period change; U4	U4	✗	✓	bars	"Absolute period change"	sign-agnostic
Capital	idem	SIGNED FLOW	PERIOD_TOTAL_PERCENT_CHANGE	Decade relative movement	(ΣB/ΣA−1)×100 (%)	20	Yes, valid only	change; U4	U4	—	✓	bars	"Period-total change · B vs A"	ΣA > 0, ΣB ≥ 0
Capital	idem	SIGNED FLOW	ANNUAL_ENDPOINT (opt.)	Endpoint annual comparison	B−A (US$); (B/A−1)×100 if valid (%)	2	optional	endpoint; U1	U1	—	✓	slope	"Annual endpoint change (not a period statistic)"	clearly labelled
Capital	fdi_inflows_pct_gdp	RATIO	RATIO_ANNUAL	Ratio that year	raw (% GDP)	1	Yes DESC	annual ratio; valid-year	—	Σnum/Σden	✓	line	"FDI/GDP ratio"	not comparable as level across time bases? (ratio is fine)
Capital	idem	RATIO	RATIO_PP_CHANGE	Movement of the ratio	B−A (pp)	2	✗	—	U1	✗	✓	bars	"FDI/GDP change · percentage points"	ratios differenced in pp
Capital	idem	RATIO	RATIO_PERIOD_AVERAGE	Typical annual ratio	mean(ratios[A,B)) (% GDP)	10	Yes DESC	period-average ratio; U3	U3	✗	✓	bar	"Average annual FDI/GDP · A–B"	≠ cumulative
Capital	idem	RATIO	RATIO_CUMULATIVE	Period-economic aggregate ratio	ΣFDI/ΣGDP×100 (% GDP)	10	Yes DESC	cumulative ratio; U3	U3 (legs)	group ratio-of-sums	✓	bar	"Cumulative FDI/GDP · A–B"	APP_DERIVED from legs
Capital	idem	RATIO	RATIO_PERIOD_PP_CHANGE	Decade change in intensity	(cumB−cumA) (pp)	20	✗	—	U4	✗	✓	cards	"Cumulative FDI/GDP change · pp"	ratio-of-sums difference
Exchange	fx_official	QUOTED RATE	FX_QUOTE_LEVEL	Quote that year	raw (LCU/US$)	1	✗ (NEUTRAL)	—	—	MEMBER_ONLY	✓ (self)	line	"Exchange-rate quote · LCU per US$"	rise = depreciation
Exchange	idem	QUOTED RATE	FX_ANNUAL_MOVEMENT	Quote movement	(q_t/q_{t−1}−1)×100 (%)	t−1,t	optional (O3)	movement; pair	pair	✗	✓	bars	"Quote movement · annual"	not "currency growth"
Exchange	idem	QUOTED RATE	FX_ENDPOINT_MOVEMENT	Endpoint quote movement	(q_B/q_A−1)×100 (%)	2	optional (O3)	movement; U1	U1	✗	✓	slope	"Quote movement · B vs A"	same convention
Exchange	idem	QUOTED RATE	FX_PERIOD_AVERAGE_QUOTE	Average annual quote	mean(quotes[A,B)) (LCU/US$)	10	✗	—	U3	✗	✓	line/bar	"Average annual quote · A–B"	level, not growth
External	current_account	SIGNED FLOW	ANNUAL_BALANCE	Balance that year	raw (US$)	1	Yes DESC	algebraic value; valid-year	—	SUM	✓	bars (zero line)	"Current account balance"	deficit < 0
External	idem	SIGNED FLOW	ANNUAL_ABSOLUTE_CHANGE	Dollar change	v_t−v_{t−1} (US$)	t−1,t	Yes DESC	abs change; pair	pair	✗	✓	bars	"Annual absolute change"	deficit wording
External	idem	SIGNED FLOW	PERIOD_TOTAL / AVERAGE	Cumulative/typical balance	Σ / Σ/N	10	Yes DESC	sum/avg; U3	U3	SUM	✓	bars	"Period total · A–B (cumulative balance)"	sign-aware
External	idem	SIGNED FLOW	PERIOD_TOTAL_ABSOLUTE_CHANGE	Decade movement	ΣB−ΣA (US$)	20	Yes DESC	abs period change; U4	U4	✗	✓	bars	"Absolute period change"	toward smaller/larger deficit
External	idem	SIGNED FLOW	PERIOD_TOTAL_PERCENT_CHANGE	decade % (rarely valid)	(ΣB/ΣA−1)×100 (%)	20	conditional	change; U4	U4	✗	✓	bars	"Period-total change"	needs ΣA > 0
External	reserves_ex_gold	STOCK	ANNUAL_LEVEL	Stock that year	raw (US$)	1	Yes DESC	level; valid-year	—	SUM	✓	line	"Reserves minus gold"	stock
External	idem	STOCK	ENDPOINT_ABSOLUTE_CHANGE	Dollar change	B−A (US$)	2	✗	—	U1	✗	✓	cards	"Endpoint change"	—
External	idem	STOCK	ENDPOINT_PERCENT_CHANGE	Relative change	(B/A−1)×100 (%)	2	✗	—	U1	✗	✓	cards	"Endpoint percent change"	A > 0
External	idem	STOCK	CAGR	Annualized rate	((B/A)^(1/n)−1)×100 (%/yr)	2	✗	—	—	✗	✓	cards	"CAGR"	A,B > 0
External	idem	STOCK	PERIOD_AVERAGE_STOCK (opt.)	Average stock level	mean(stocks[A,B)) (US$)	10	Yes DESC descr.	avg stock; U3	U3	✗ (SUM used for groups)	✓	bar	"Average stock level · A–B"	not growth
External	remittances_received	FLOW	as exports	as exports	as exports	as exports	as exports	as exports	as exports	SUM	✓	bars	"Remittances received"	nominal
Population	population_total	STOCK	ANNUAL_LEVEL	Count that year	raw (people)	1	Yes DESC	level; valid-year	—	SUM (= aggregate pop)	✓	line	"Population"	midyear count
Population	idem	STOCK	ANNUAL_YOY	Annual growth	(v_t/v_{t−1}−1)×100 (%)	t−1,t	Yes DESC	growth; pair	pair	✗	✓	line	"Annual growth"	growth ≠ level
Population	idem	STOCK	ENDPOINT_PERCENT_CHANGE / CAGR	Multi-year movement	(B/A−1)×100; ((B/A)^(1/n)−1)×100 (% / %/yr)	2	✗	—	U1	✗	✓	cards	"Endpoint change / CAGR"	smoothed
Population	idem	STOCK	PERIOD_AVERAGE_POPULATION (opt.)	Average population	mean(counts[A,B)) (people)	10	Yes DESC descr.	avg pop; U3	U3	✗	✓	bar	"Average population · A–B"	not growth
8. COMPLETE OPERATION MATRIX
Operation	Meaning	Valid types	Invalid types (reason)	Formula (unit)	Base restriction	Missing rule	Ranking behavior	Period behavior	Example (real vintage)
ANNUAL_LEVEL	Value in one year	all	—	raw	none	absent → unavailable	DESC/ASC per metric; valid-year universe	n/a	FDI 2014 = $34.577B
ANNUAL_YOY	Consecutive-year %	LEVEL, FLOW, POSITIVE STOCK, SIGNED only when valid	RATE, INDEX, RATIO	(v_t/v_{t−1}−1)×100 (%)	base > 0, no sign change	either year missing → null+reason	YoY rank DESC; pair universe	n/a	FDI 2024 vs 2023 = (27.140/28.086−1)×100 = −3.37%
ANNUAL_ABSOLUTE_CHANGE	Consecutive-year difference	SIGNED FLOW, LEVEL, STOCK	—	v_t−v_{t−1} (metric unit)	none	either missing → unavailable	optional rank by change	n/a	CA 2005 vs 2004: −10.284B − 0.780B = −$11.06B
ANNUAL_ENDPOINT_ABSOLUTE	Difference between selected years	all	—	B−A	none	endpoint missing → unavailable	optional	endpoint	Reserves 2014−2004 = +$176.862B
ANNUAL_ENDPOINT_PERCENT / ENDPOINT_PERCENT	Relative change between selected years	LEVEL, FLOW, POSITIVE, SIGNED only when valid	RATE, INDEX, RATIO as primary; any zero/negative/sign-change base	(B/A−1)×100 (%)	A > 0, B ≥ 0	endpoint missing → unavailable	optional; universe U1	endpoint only (label!)	Per capita 2004→2024 = +315.21%
CAGR	Annualized endpoint rate	LEVEL, FLOW, STOCK	RATE, INDEX, RATIO, QUOTED	((B/A)^(1/n)−1)×100 (%/yr)	A,B > 0	endpoints missing → unavailable	no rank	endpoint	Reserves 2004→2014 = 9.14%/yr
PERIOD_TOTAL	Cumulative flow	FLOW, SIGNED FLOW	LEVEL, STOCK, RATE, RATIO, INDEX, FX	Σ[A,B) (metric unit)	none (sign allowed)	every year required; else incomplete_period	optional; U3	[A,B), N obs	FDI 2004–2013 = $252.987B
PERIOD_AVERAGE	Typical annual flow	FLOW, SIGNED FLOW; RATE (as rate-average); STOCK (as level-average, labelled)	never SUM semantics for rates	Σ/N	completeness	same strict rule	optional; U3	[A,B)	Exports 2004–2013 = $304.651B/yr
PERIOD_TOTAL_ABSOLUTE_CHANGE	Period-to-period difference	FLOW, SIGNED FLOW, RATIO (in pp variant)	RATE requires PP wording	ΣB−ΣA	none	U4 completeness	rank by absolute change	two periods	CA: +$34.550B toward smaller deficit
PERIOD_TOTAL_PERCENT_CHANGE	Period-to-period %	FLOW, SIGNED FLOW	RATE, INDEX, RATIO, QUOTED	(ΣB/ΣA−1)×100 (%)	ΣA > 0 and ΣB ≥ 0	U4 completeness	rank if valid; excluded units listed	two periods	FDI: +75.05% (NOT +536.86%)
RATE_PP_CHANGE	Movement of a rate	RATE	all others	B−A (pp)	none	endpoint missing → unavailable	no rank	endpoint	CPI 2004→2014 = +2.90 pp
RATE_PERIOD_AVERAGE	Mean annual rate	RATE	all others	mean(rates[A,B)) (%)	completeness	strict	optional ASC descr.; U3	[A,B)	CPI 2004–2013 = 7.98%
RATIO_ANNUAL / RATIO_PP_CHANGE / RATIO_PERIOD_AVERAGE / RATIO_CUMULATIVE / RATIO_PERIOD_PP_CHANGE	Ratio operations	RATIO	SUM of ratios (never)	see §6.8	GDP denominator > 0	both legs per year	optional DESC; U3/U4	as specified	cumulative A 1.89% → B 1.63% = −0.26 pp
INDEX_POINT_CHANGE	Index-scale movement	INDEX	others	B−A (index pts)	none	endpoints required	no level rank	endpoint	+76.57 index points
INDEX_CUMULATIVE_CHANGE	Cumulative index %	INDEX	others; never called inflation/GDP growth	(B/A−1)×100 (%)	A > 0	endpoints required	optional; U1	endpoint	+120.86%
FX_QUOTE_LEVEL / FX_ANNUAL_MOVEMENT / FX_ENDPOINT_MOVEMENT / FX_PERIOD_AVERAGE_QUOTE	Quote operations	QUOTED RATE	SUM/AVG across entities; CAGR	see §6.9	quote > 0	strict for period average	movement only (optional, O3)	as specified	45.32 → 83.67 = +84.63%
GROUP_SUM	Sum valid members	additive types	per-capita, rates, ratios, indexes, FX	Σ members	same-year/legs	observed vs like-for-like	never ranked	single year/period sums	group exports sum
GROUP_RATIO_FROM_SUMS	Σnum/Σden	RATIO	others	ΣFDI/ΣGDP×100 (% GDP)	same year/vintage/basis	missing member → excluded + reported	never ranked	per-year or period	group FDI/GDP
GROUP_PER_CAPITA (new, O7)	ΣGDP/ΣPOP	LEVEL per-capita + TOTAL GDP legs	others	ΣGDP/ΣPOP (US$/person)	both legs	both legs required	never ranked	single year	—
CROSS_RATE	Currency cross conversion	QUOTED RATE legs	others	legA/legB (LCU_A per LCU_B)	both > 0, same year, same convention	legs required	no rank	single year	INR/USD ÷ JPY/USD
9. RANKING METHODOLOGY
Attached statistic. Every ranking names its statistic and universe:

Annual: Annual <metric> rank — <year>; statistic = annual raw value; universe = eligible economies with a valid stored observation that year (U1-year); direction from registry (DESC; ASC for inflation family; NEUTRAL refused).
Period total: Cumulative net FDI inflow rank — 2004–2013; statistic = Σ over the period; universe = U3 (every required year present); direction DESC.
Period average: Average annual net FDI inflow rank — 2004–2013; statistic = Σ/N; U3.
Period-total change: Period-total change rank — 2014–2023 vs 2004–2013; statistic = (ΣB/ΣA−1)×100; universe = U4; economies without a valid percent (zero/negative base) are excluded and counted in the methodology block; no fabricated ranks.
Absolute period change: Absolute period change rank — …; statistic = ΣB−ΣA; U4; sign-aware DESC.
Rates: annual/period-average rate ranks ASC with wording "lowest first (descriptive — not a welfare ranking)"; never "best".
Ratios: annual/cumulative ratio ranks DESC ("highest ratio first").
FX: no level ranks (NEUTRAL). Movement ranking country-wide is opt-in (O3) and worded "largest quote increase (depreciation) first".
Index: no level ranks; cumulative-change ranking opt-in (O4).
Ties. Existing rule retained: value DESC/ASC then ISO3 ASC, distinct ordinal positions (not competition ranking) — documented in methodology and unchanged (frozen for GDP).

Universe visibility. Every rank renders Rank X / N plus Eligible economies: N, Universe rule: …, and for period ranks the completeness rule; where universes differ between panels they are stated side-by-side. Filters and pagination never renumber.

No fabricated evaluations. No composite scores, stability scores, "100 − inflation", or performance indices.

10. LIKE-FOR-LIKE METHODOLOGY
Five universes, all disclosed:

Universe	Rule	Used by
U1 Endpoint-common	valid(A) ∩ valid(B)	endpoint comparisons, endpoint LFL ranks, cumulative-change comparisons
U2 Annual-pair	valid(t) ∩ valid(t−1) ∧ computable percent	annual YoY rankings, growth movement (existing)
U3 Period-complete	every required year of the period valid	single-period totals/averages (focus and ranking), cumulative ratios, period-average rates, average stock/population
U4 Cross-period strict	every required year of both periods valid	period-total change, ratio period PP change, period-vs-period ranking; for 2004–2013 vs 2014–2023 this means all years 2004–2023 (20 observations)
U5 Group modes	observed (members valid that year) vs like-for-like (valid in every requested year)	group comparisons (existing)
Distinction U3 vs U4 is exposed explicitly: a country may hold a complete Period A (and receive a Period A rank) while being excluded from the cross-period change ranking; both counts and the excluded ISO3 list with reasons (missing_2008, etc.) are returned. Universes are never silently changed; every response carries universe.rule, eligible, ranked, excluded[].

11. PEER BENCHMARK METHODOLOGY
For each operation instance the backend returns, over the operation's eligible universe excluding the focus entity:

Mean (peerMean) — labelled "Mean across eligible economies"; skew warning when |mean − median| / median > 0.5 for FLOW/STOCK.
Median (peerMedian) — labelled "Median across eligible economies".
Percentile (focusPercentile) — share of eligible economies with value ≤ focus value (0–100).
Rank — operation-scoped rank with rankDenominator.
Absolute gap (focus − reference) in the metric's own unit: "$5B below peer mean" for flows/levels.
Relative gap ((focus − reference)/reference)×100 in % — computed only when reference > 0 (never with a negative/zero reference).
PP gap for RATE and RATIO operations (focus − reference in percentage points). Units are never mixed: dollars stay dollars, percents stay percents, pp stay pp, index points stay index points. The mean is never called "World Average"; WDI official aggregates are a separate entity type.
Worked example (real): India FDI Period A total = $252.99B. If peer mean = $250B and median = $40B → absolute gap +$2.99B ("$3.0B above peer mean"), relative gap +1.20%, percentile computed over the ranked universe, rank shown as X/N; the mean–median divergence signals heavy skew and triggers the caveat.

12. GROUP AGGREGATION METHODOLOGY
Metric type	Group capability	Formula	Legs / rules
Total GDP (any price basis)	SUM	Σ member GDP	same basis/price vintage; no mixing current/constant/PPP
Exports, imports	SUM	Σ member flows	current US$
FDI net inflows	SUM	Σ member FDI	signed; observed vs LFL variants
Current account	SUM	Σ member balances	signed; cumulative balance
Remittances	SUM	Σ member flows	current US$
Population	SUM	Σ member population = aggregate population	explicitly defined demographic quantity
FDI % of GDP	WEIGHTED_RATIO	ΣFDI / ΣGDP × 100	same group, same year, same vintage; never mean of member ratios
GDP per capita	(existing) refused; (proposed GROUP_PER_CAPITA ΣGDP/ΣPOP — O7)	as stated	both legs required
Rates (CPI, deflator)	OFFICIAL_ONLY	use WDI aggregate when published; no custom means	WLD exists
CPI index	NONE (OFFICIAL_ONLY, none exists)	refused NOT_AGGREGATABLE / NO_OFFICIAL_AGGREGATE	index baskets are country-specific
FX	NONE (MEMBER_ONLY)	refused	no meaningful group quote
All custom-group results are APP_DERIVED with member list, per-year coverage (valid/missing), formula, source indicators, vintage; official aggregates are read as published and labelled "World Bank aggregate"; groups never enter country leaderboards and are never presented as World Bank-published.

13. COMPARE METHODOLOGY
One engine, same operations as Movement. Supported combinations and failure taxonomy:

Entity A	Entity B	Types supported	Operations	Aggregation	Universe / LFL	Source	APP_DERIVED?	Failure reasons
country	country	all	level, YoY/percent (guarded), absolute, endpoint, CAGR (levels/flows/stocks), period total/avg/change, PP/index/FX ops	none	U1/U3/U4 per operation	RAW	no	UNSUPPORTED_ENTITY_COMBINATION (NEUTRAL×NEUTRAL levels), UNSUPPORTED_TRANSFORMATION, MISSING_REQUIRED_DATA
country	official aggregate	all with published aggregate	same	read as published	U1/U3/U4	WDI aggregate	no	NO_OFFICIAL_AGGREGATE (verified for CPI index, FX), UNSUPPORTED_TRANSFORMATION
country	custom group	SUM/WEIGHTED_RATIO types (+ proposed per-capita)	same + group ops	Σ / Σnum/Σden	U5 observed & LFL disclosed	RAW members	yes (group side)	NOT_AGGREGATABLE (per-capita currently; rates/index/FX), INVALID_GROUP*, MISSING_REQUIRED_DATA
official aggregate	country	as above	same	—	—	—	no	as above
official aggregate	custom group	SUM/WEIGHTED_RATIO types	same	mixed: published vs derived	U5	mixed	group side	same; labels distinct on both cards
group	group	SUM/WEIGHTED_RATIO types	same	Σ vs Σ	U5 (each group)	RAW members	yes (both)	NOT_AGGREGATABLE, coverage shortfalls
aggregate	aggregate	all with published aggregates	same	—	—	WDI	no	NO_OFFICIAL_AGGREGATE
Typed states (end-to-end): every Compare response distinguishes:

available: true (valid result; result + provenance + universe),
available: false, category: UNSUPPORTED_OPERATION (with reason, supportedAlternatives[]),
available: false, category: INSUFFICIENT_DATA (with missingYears[], missingLegs[], coverage counts),
category: SYSTEM_ERROR (transport/HTTP/verification failure — retryable presentation). The frontend renders these distinctly; "No data available for this selection" is reserved for genuine empty result sets and never used for 2 or 3.
False-no-data fixes (verified causes): CPI index and FX level (NEUTRAL refusals) become typed UNSUPPORTED_OPERATION with alternatives; missing WLD aggregates (CPI index, FX) become NO_OFFICIAL_AGGREGATE with the note that WDI publishes no aggregate for the series; signed-flow guard failures become INSUFFICIENT/UNSUPPORTED with the guard name and the valid alternatives (absolute change, period totals).

14. PROVENANCE / RAW WDI RULES
Every analytical payload carries: metric, indicatorCode, metricType, operation, basis, startYear, middleYear, endYear, includedYears, excludedBoundaryYears, observationCount, entity{kind,iso3,label,members?}, universe{rule,eligible,ranked,excluded[]}, result{value,display,unit}, formula, coverage{validYears,missingYears}, aggregation{method,legs[]}, provenance{kind: RAW|APP_DERIVED, legs, formula}, source, vintage, reason, methodologyId, rank/rankDenominator, peerMean/peerMedian/focusPercentile. Rules: RAW values are never modified; APP_DERIVED always carries its legs (ΣFDI/ΣGDP etc.); official aggregates are quarantined from derivation; vintages are recorded and mismatches surfaced (mixedVintage); no third-party values anywhere; value_raw accompanies displayed values on request/audit surfaces.

15. MISSING-DATA / SIGN GUARDS
Central guard module (shared by YoY, Movement, Compare, coverage, verification, yearly table, period services): functions guardPercentChange(a,b), guardPeriodChange(sumA,sumB), guardCagr(a,b,n), guardRatioLegs(num,den), guardQuote(q), with machine codes: missing_base_value, missing_current_value, both_values_missing, non_finite_value, zero_base_for_percent_change, negative_base_for_percent_change, sign_change_across_endpoints, incomplete_period, invalid_period_interval, invalid_year_interval, unsupported_transformation_for_metric, no_official_aggregate, not_aggregatable, incompatible_legs, incompatible_quotation, missing_required_data, same_year_selected, invalid_operation.

Missing-data rules: absence of a row = no observation; never zero; strict period completeness (incomplete_period + exact missingYears); endpoint operations require both endpoints; YoY requires both years with a positive, sign-consistent base; coverage lines always shown (7 of 10 observations; complete period total unavailable — missing 2008).

Sign/base rules: percent family refuses zero base, negative base, and sign change; period percent additionally refuses negative ΣA and negative ΣB; absolute change, period totals/averages and absolute period changes always remain available for signed flows; rate/ratio operations use PP, never relative percents; FX uses quote semantics only.

16. METHODOLOGY UI
Reuse the existing collapsible MethodologyPanel pattern and the Movement "Evidence & provenance" block; generalize one MethodologyBlock component fed by methodologyId. Expanded content (15 required items): meaning; formula (unit-labelled); included years and observation count; endpoint-vs-period semantics; denominator/base; rank universe (X/N + rule); LFL rule; missing-data rule; RAW vs APP_DERIVED; indicator code(s); unit; aggregation formula with legs; worked example; misinterpretation warning. Exact labels per basis (examples):

Period total · 2004–2013 · 10 annual observations
Period average · 2004–2013 · typical annual flow
Period-total change · 2014–2023 vs 2004–2013
Annual YoY · 2024 vs 2023
Annual endpoint change · 2014 vs 2004 (not a period statistic)
Inflation change · 2014 vs 2004 · percentage points
Average annual inflation · 2004–2013
Index-point change · 2014 vs 2004
Cumulative CPI index change · 2014 vs 2004
Exchange-rate quote movement · 2024 vs 2004 · rise = depreciation (LCU per US$)
CAGR · 2004→2024
Cumulative FDI/GDP · 2004–2013 · ΣFDI ÷ ΣGDP × 100 (APP_DERIVED)
17. CHART DESIGN
Operation	Chart	X	Y (unit)	Endpoint/period behavior	Missing	Boundary year	Mobile	Tooltip	Methodology access
ANNUAL_LEVEL (long series)	line	year	value (metric unit)	history	gaps break line	n/a	ScrollableChart	year, value, unit, source	ChartCard + MethodologyBlock
ANNUAL_YOY	bars or line	year	%	history	no bar where unavailable (never 0)	n/a	scroll	reason shown when null	same
PERIOD_TOTAL / AVERAGE	bars (one per period)	period label 2004–2013	metric unit	two/three bars; included years listed	unavailable bar absent + reason	boundary year rendered as a ghost/context marker (lighter fill, dashed) with tooltip "2024 — period boundary; excluded from 2014–2023 period total"	scroll	includes N obs	same
PERIOD_TOTAL_CHANGE	bars (change % or absolute)	B vs A	% (or unit)	change only, no implied continuity	unavailable → reason card	boundary marker on the annual context strip	scroll	formula + universes	same
ENDPOINT	slope/dumbbell or endpoint cards	A, B	metric unit	two points only — never a trend line	one side missing → unavailable	both endpoints always shown	scroll if long labels	values + delta	same
RANK MOVEMENT	rank slope (rank 1 top)	A, B	rank	two points	—	—	scroll	ranks + denominators	same
RATE_ANNUAL / RATE_PERIOD_AVERAGE	rate line + zero reference; average as labelled bar	year	annual %	history	gaps	—	scroll	"annual rate, %"	same
RATE_PP_CHANGE	bars	A vs B	pp	two bars + delta	guard reason when invalid	—	scroll	"percentage points"	same
INDEX / INDEX_POINT / INDEX_CUMULATIVE	line (index); bars (changes)	year / A vs B	index points / %	history / two points	gaps; null change → reason	—	scroll	"index points" vs "%" explicit	same
RATIO_CUMULATIVE	bars per period	period	% of GDP	two bars	legs missing → reason	boundary marker	scroll	shows Σ legs	same
FX	line (quote) with caption "a rise is depreciation"; movement bars	year	LCU/US$; % for movement	history; movement two-point	gaps	—	scroll	convention stated	same
GROUP values	bars (entities side by side)	entity	metric unit	group vs group/aggregate only	missing legs → reason	—	scroll	APP_DERIVED + legs	same
Guardrails: no trend lines for two-point operations; no mixed units on one axis; every chart has title, metric, unit, period, legend where needed, source, gaps, tooltip, accessible fallback table, and a methodology link.

18. RESPONSIVE DESIGN
Chart wrapper (ScrollableChart). One chart, never split: plotWidth = max(containerWidth − yAxisWidth, observationCount × minStep) where minStep ≈ 30px (bars) / 24px (lines), yAxisWidth = 64px. Structure: outer .chart-shell (position relative; min-width:0) → sticky Y-axis overlay (.chart-sticky-y, position:sticky; left:0; z-index:2, same tick values, aria-hidden) → .chart-scroll (overflow-x:auto; overflow-y:hidden; -webkit-overflow-scrolling:touch; scroll-snap-type:x proximity) containing a fixed-pixel Recharts chart (width={plotWidth}). Plot's margin.left reserves the axis space so data never hides under the overlay. Keyboard: .chart-scroll[tabindex=0] with Left/Right/Home/End key scrolling; touch scrolling native; no duplicated DOM chart; text sizes fixed (11–12px) regardless of width.

Page-level: no page-wide horizontal overflow at any width; min-width:0 on grid/flex children; overflow-wrap:anywhere for long labels; tables keep .table-scroll with sticky header (position:sticky; top:0) and sticky first column where keyed; result cards single-column under 40rem; partition-row switches to stacked layout under 40rem; control grids already collapse via auto-fit (verify minmax lower bounds ≤ viewport/2 at 320px); dropdown popovers constrained max-width:min(22rem, 92vw); methodology <details> never overflows.

Test widths: 320, 360, 390, 430, 768, 1024, 1280+; series lengths: 10, 20, 30, 50+ years; acceptance: no clipped labels, tooltips readable, sticky axis visible while scrolling, no page-level horizontal scrollbar, touch scroll works, keyboard scrolling works.

19. BACKEND ARCHITECTURE
Modified

backend/src/config.js — add declarative operations, rankingByOperation, signPolicy, periodPolicy per metric (semantic type promoted to include SIGNED_FLOW); keep all existing fields and GDP declarations byte-stable.
backend/src/domain/transforms.js — add RATE_PERIOD_AVG, RATIO_PERIOD_AVG, RATIO_CUMULATIVE (registered as pure primitives; gated by new capabilities), wire PERIOD_SUM_PERCENT_CHANGE (existing) into the operation dispatcher; add PERIOD_TOTAL_ABSOLUTE_CHANGE; add INDEX_CUMULATIVE_CHANGE (index-gated percent math).
backend/src/domain/periods.js — extend the semantic-operation vocabulary with the final names and formulas/units (labels become methodology strings).
backend/src/services/periodService.js — extend to period-comparison (Period A vs B), ranks (U3/U4), peer mean/median/percentile, boundary-year metadata, per-operation availability envelope.
backend/src/services/comparisonService.js — unchanged for GDP paths; add an operation-routed entry that delegates non-level operations to the new analysis service (no duplicated math).
backend/src/services/entityCompare.js / entities.js — add period operations and typed availability envelope; keep GDP compare responses identical.
backend/src/server.js — new routes only (/api/analysis/point, /api/analysis/rank, /api/analysis/period, /api/analysis/compare), plus additive fields on /api/indicators (operations, signPolicy, periodPolicy, ranking); existing routes preserved.
New

backend/src/domain/guards.js — centralized guard functions + reason vocabulary.
backend/src/domain/operations.js — operation registry: identity, transform binding, capability gate, units, labels, formulas, rank statistic/universe, LFL class, chart hint.
backend/src/domain/universes.js — U1–U5 builders + excluded-with-reason lists.
backend/src/services/analysisService.js — one orchestrator for point/rank/period/compare operations.
backend/src/services/peerBenchmarks.js — mean/median/percentile/gaps with unit discipline.
Preserved (frozen)

GDP/GDP-per-capita math: domain/yoy.js, domain/yoyRanking.js, domain/ranking.js, GDP branches in comparisonService.js, fullRanking.js, indiaYearly.js, coverageService.js, rankVerification.js, yoyVerification.js, ingestion and repository.
transforms.js existing primitives keep their exact arithmetic (YoY delegation to computeYoy).
db/schema.sql — no schema changes required (all new statistics are computed from stored raw observations).
Deprecated

frontend/src/config/metrics.js movementBases heuristic (superseded by backend operations); keep as fallback until hydration ships.
20. FRONTEND ARCHITECTURE
Modified

frontend/src/config/metrics.js — hydrate operations, signPolicy, periodPolicy; replace movementBases with operationsForMetric(metricKey) reading backend declarations (fallback preserved).
frontend/src/sections/RankMovement.jsx — keep structure; extract basis rendering into BasisPanel components: LevelPanel (existing), GrowthPanel (existing, with new peer stats), PeriodPanel (totals/averages/changes + ranks + boundary markers), RatePanel (annual/PP/average), IndexPanel, FxPanel, StockPanel (endpoint/CAGR). No economic math in any panel; displays backend values/units/labels.
frontend/src/sections/Compare.jsx — operation list from capabilities incl. period ops; typed states; provenance additions (universes, legs, peers).
frontend/src/components/charts/* — TimeSeriesChart/BarComparisonChart/SlopeChart accept fixed width/height and are wrapped by the new ScrollableChart; boundary markers as series/reference points.
frontend/src/components/ui.jsx — UnavailableState gains category (UNSUPPORTED_OPERATION | INSUFFICIENT_DATA | SYSTEM_ERROR) with distinct styling and supportedAlternatives list; MethodologyPanel extended to the 15-item block driven by methodologyId.
frontend/src/api/client.js — new /api/analysis/* methods; existing methods untouched.
frontend/src/index.css — chart shell/scroll/sticky rules; responsive fixes (§18); no page-level overflow.
New

frontend/src/components/charts/ScrollableChart.jsx (single-chart scroll wrapper + sticky Y overlay + accessibility).
frontend/src/components/MethodologyBlock.jsx (data-driven disclosure).
frontend/src/components/BasisPanels/* (per semantic type).
frontend/src/utils/availability.js (category → presentation mapping).
Preserved

Backend-authoritative rendering; chart data adapters (chartData.js) unchanged (nulls preserved); GDP panels' numbers and layout behavior.
21. API CONTRACT CHANGES
New endpoints (all additive; existing routes unchanged):

GET /api/analysis/point?metric=&entity=&operation=&yearA=&yearB=&startYear=&endYear= — single-entity operations (rate PP, index change, CAGR, endpoint, period statistics).
GET /api/analysis/rank?metric=&entityType=&operation=&year=|startYear&endYear=&universe= — operation ranking with universe/denominators/peer stats.
GET /api/analysis/period?metric=&entity=&startYear=&middleYear=&endYear=&operation= — Period A vs B comparison (totals/averages/changes), U3/U4 universes, boundary metadata.
GET /api/analysis/compare?entityA=&entityB=&metric=&operation=&yearA=&yearB=|startYear=&endYear=&groupMode= — unified compare (period ops included).
/api/indicators extended per metric with: operations[] (each: id, label, formula, unit, rank: {supported,direction,statistic,universe}, period: {mode, completeRequired}, lfl, signPolicy).
Response envelope (example — real data):


{
  "metric": { "key": "fdi_inflows", "indicatorCode": "BX.KLT.DINV.CD.WD",
              "metricType": "SIGNED_FLOW", "unit": "current US$" },
  "operation": "PERIOD_TOTAL_PERCENT_CHANGE",
  "basis": "period_total_change",
  "years": { "start": 2004, "middle": 2014, "end": 2024 },
  "periods": { "A": { "includedYears": [2004,…], "count": 10, "value": 252987424290.94 },
               "B": { "includedYears": [2014,…], "count": 10, "value": 442854991310.98 } },
  "excludedBoundaryYears": [2024],
  "result": { "absolute": 189867567020.04, "percent": 75.05,
              "percentDisplay": "+75.05%", "unit": "%", "formula": "((sumB / sumA) - 1) * 100" },
  "ranks": { "annual": {"supported": true, "direction": "DESC"},
             "periodTotal": { "value": 3, "denominator": 151, "universe": "PERIOD_COMPLETE" },
             "periodTotalChange": { "value": 12, "denominator": 140, "universe": "CROSS_PERIOD_STRICT" } },
  "peers": { "meanA": …, "medianA": …, "meanB": …, "medianB": …, "focusPercentileA": … },
  "universe": { "rule": "all required years in both periods",
                "eligible": 151, "ranked": 140,
                "excluded": [{ "iso3": "XYZ", "reason": "missing_2008" }] },
  "provenance": { "kind": "APP_DERIVED", "formula": "((sumB / sumA) - 1) * 100",
                  "inputs": { "sumA": …, "sumB": … },
                  "legs": [{ "indicator": "BX.KLT.DINV.CD.WD", "entity": "IND", "years": ["2004","…"] }] },
  "source": "World Bank World Development Indicators", "vintage": "2026-07-13",
  "reason": null, "methodologyId": "FDI_PERIOD_TOTAL_PERCENT_CHANGE"
}
Failure envelope: { available:false, category:"UNSUPPORTED_OPERATION"|"INSUFFICIENT_DATA"|"SYSTEM_ERROR", reason, description, missingYears[], missingLegs[], supportedAlternatives[] }. The frontend never recomputes economics and never invents percentages, ranks, or universes.

22. TEST ARCHITECTURE
Existing suites (36 files, node --test, in-memory DB) are extended; no test may weaken GDP assertions.

Category	Cases (per §52)	New/extended files
FLOW	period sum/avg/count; [A,B); adjacent non-overlap; 2024 boundary excluded from computation but present in metadata; missing-year refusal; no zero-fill; endpoint≠period; period-total change	transforms.test.js, phase7c1.test.js extended; new periodCompare.test.js
SIGNED FLOW	pos→pos; zero base; negative base; pos→neg; neg→pos; neg→neg; period-total sign change	new signedFlow.test.js (uses FDI/CA fixtures, real anchors)
RATE	PP change; average rate; no relative-growth leak; missing year	new rateOps.test.js
INDEX	point change; cumulative change; cross-country level refusal; cumulative change comparison	new indexOps.test.js
RATIO	annual; average; ratio-of-sums; PP difference; no summation; legs mismatch	new ratioOps.test.js; existing entityCompare.test.js extended
FX	quote movement; direction; no group averaging; no raw ranking; period average quote	new fxOps.test.js
STOCK	endpoint; CAGR validity; period sum refused	new stockOps.test.js
RANK	exact universe; denominators; ties; period rank; growth rank; unavailable growth base excluded with reason	ranking.test.js, yoyRanking.test.js + new periodRank.test.js
LFL	U1; U3; U4; excluded lists	new lfl.test.js
GROUP	country↔country; country↔aggregate; country↔group; group↔group; SUM; ratio-of-sums; unsupported aggregation; missing member; provenance	entityCompare.test.js, comparisonApi.test.js extended
COMPARE	all combos; valid op; unsupported op; insufficient data; false-no-data regressions (CPI index/FX)	entityCompare.test.js extended
API/HTTP	new endpoints; envelope fields; typed categories; GDP routes unchanged	server.test.js, phase7c*.test.js extended
Frontend	lint/build; methodology dropdown; chart scroll; sticky axis; boundary year visible; no page overflow; typed states	existing lint/build; new DOM-level checks where feasible
GDP regression	golden fixture equality (see §24)	new gdpGolden.test.js + fixture JSON
23. PHASED IMPLEMENTATION PLAN
PHASE 0 — Design (this document). No code. Stop gate: design approval.

PHASE 1 — Golden regression freeze. Objective: capture GDP/GDP-per-capita analytics before anything changes. Scope: fixtures + test for all 8 GDP metrics: per-year values, ranks, denominators, YoY, endpoint %, CAGR, movement/LFL outputs, compare responses. Backend: new backend/test/fixtures/gdp-golden.json + gdpGolden.test.js; no production code changes. Frontend: none. Tests: golden equality on recorded vintage. Migration: none. Risk: fixture must be generated from the frozen vintage; snapshot fixture already exists. Stop gate: golden tests green on untouched code.

PHASE 2 — Semantic registry + capability model. Objective: declarative operations/capabilities. Scope: config.js extensions (operations, signPolicy, periodPolicy, rankingByOperation), operations.js, /api/indicators additive fields. Backend only + tests. Frontend: hydrated registry reads new fields (no UI change yet). Tests: registry invariants, no GDP declaration drift, operation/capability consistency. Risk: registry validation must fail closed; GDP entries untouched. Stop gate: all existing tests + registry tests green; /api/indicators diff contains only additive fields.

PHASE 3 — Core analytical engine (guards + new primitives). Objective: guards.js, RATE_PERIOD_AVG, RATIO_PERIOD_AVG, RATIO_CUMULATIVE, PERIOD_TOTAL_ABSOLUTE_CHANGE, INDEX_CUMULATIVE_CHANGE, routed PERIOD_SUM_PERCENT_CHANGE. Tests: signed/rate/ratio/index/stock matrices; guard parity across routes. Risk: primitive reuse must not alter existing YoY outputs (asserted by delegation). Stop gate: primitive + guard suites green; GDP golden green.

PHASE 4 — Period & ranking engine (LFL U3/U4, period ranks, peers). Objective: periodService period-comparison, universes.js, periodRank, peer mean/median/percentile, boundary metadata. Tests: period ranks, U4 exclusion lists, boundary-year metadata, peer units. Risk: universe definitions must be explicit and stable; no silent shrinkage. Stop gate: period/LFL/rank suites green.

PHASE 5 — Movement wiring. Objective: capability-driven basis lists; new panels (Rate/Index/FX/Stock/PeriodComparison); rank/universe lines; boundary markers; peer stats; typed states. Tests: HTTP for each basis; UI smoke via build. Risk: GDP Movement panels must render identical numbers (golden UI assertions on values). Stop gate: end-to-end Movement acceptance for all 20 metrics; GDP regression green.

PHASE 6 — Compare rebuild. Objective: same engine in Compare; period ops; all entity combos; typed failures; provenance. Tests: compare matrix incl. false-no-data regressions. Risk: not duplicating math; group legs correctness. Stop gate: compare matrix green; GDP compare outputs unchanged.

PHASE 7 — Methodology UI/provenance. Objective: MethodologyBlock (15 items) on every result; exact labels; supported-alternatives surfaces. Tests: label/formula presence per operation; snapshot checks. Risk: content accuracy — driven from methodologyId tables, not ad-hoc strings. Stop gate: every operation exposes meaning/formula/years/unit/universe/LFL/missing rule/worked example.

PHASE 8 — Charts + responsive. Objective: ScrollableChart (single chart, sticky Y, internal scroll), boundary markers, operation-appropriate chart types, responsive fixes. Tests: 10/20/30/50-year series at 320/360/390/430/768/1024/1280; no page overflow; keyboard/touch. Risk: Recharts fixed-width tooltips and overlay alignment. Stop gate: responsive checklist green at all widths.

PHASE 9 — Complete QA / regression / release audit. Objective: full suites, lint/build, golden fixtures, real-WDI spot checks (hand-derived anchors in §6), compare matrix, every worked example, final report. Risk: any unexplained discrepancy blocks release. Stop gate: FINAL_METHODOLOGY_REPORT.md signed off; zero unexplained diffs.

Dependencies: P1 blocks all analytical change; P2 before P3–P6; P3–P4 before P5–P6; P7–P8 after P5–P6; P9 last. Explanation for ordering: the master prompt's order (Movement before charts) is retained; Compare is placed after Movement because both consume the same engine built in P3–P4, and methodology UI (P7) is placed after the result shapes stabilize so labels/formulas bind to final methodologyIds.

24. REGRESSION STRATEGY
Golden GDP fixtures generated pre-change from the recorded vintage; byte-equal assertions for values, ranks, denominators, YoY, CAGR, endpoint, movement, compare.
Frozen-file rule: yoy.js, yoyRanking.js, ranking.js, GDP branches, ingestion/repository/schema are treated as frozen; diffs require explicit justification and a passing golden suite.
Primitive invariants: percent/YoY arithmetic continues to delegate to computeYoy; period math continues to use periodYears(); no duplicated formula paths.
Universe invariants: every rank response must satisfy ranked + excluded = eligible with reason codes; verifier assertions extended.
API compatibility: existing endpoints keep identical envelopes; new endpoints additive; frontend hydration tolerant of absent fields.
Real-data anchors: the §6 worked examples become integration assertions against the snapshot fixture and the local vintage DB (FDI period change 75.05%, CA absolute +34.550B, CPI PP +2.90 pp, index +76.57 pts/+120.86%, FX +84.63%, reserves CAGR 9.14%, population CAGR 1.23%, per-capita CAGR 7.38%).
Discrepancy protocol: any mismatch stops the phase; root cause must be classified (formula, source, vintage, universe, missing, rounding, aggregation) and fixed methodologically — never by patching a displayed number.
25. RELEASE GATES
Every metric has ≥2 economically justified bases with exact semantics and units.
No endpoint operation presented as a period statistic; no YoY mislabeling.
Rates/ratios/indexes/FX use their own semantics; no summing of rates/ratios/indexes/quotes.
Signed-flow percentages guarded everywhere; absolute/period statistics available instead.
Missing data never zero-filled/interpolated/shortened; exact reasons everywhere.
All ranks name statistic + universe + denominator; period ranks require complete periods; change ranks disclose exclusions.
LFL universes operation-specific and visible.
Group aggregation: SUM only where additive; ratio-of-sums for FDI/GDP; refusals explicit.
Official aggregates ≠ custom groups; APP_DERIVED labelled with legs.
Boundary year visible in period visuals with exclusion tooltip; single scrollable chart with sticky Y-axis; no page-wide horizontal overflow at 320–1280+.
All backend tests, frontend lint/build pass; GDP golden fixtures unchanged; every worked example reproduces against real WDI data.
FINAL_METHODOLOGY_REPORT.md complete (17 required outputs).
26. OPEN METHODOLOGICAL QUESTIONS
#	Issue	Options	Economic consequence	Mathematical consequence	Recommendation & reason	If the other option is chosen
O1	Expose both mean and median by default?	mean+median / mean only	Prevents skewed-flow misinterpretation ("typical country")	None (descriptive only)	mean + median + percentile by default for flows/stocks; mean only for levels where skew is negligible	If mean-only: retain skew warning; risk of misleading "average country"
O2	Period-average of a RATE (mean of annual rates)	allow / refuse	Standard "average annual inflation" statistic	Mean ≠ cumulative price change; must be labelled	Allow, labelled "Average annual inflation", completeness strict	If refused: users lose the standard rate summary; PP-only remains
O3	Cross-country ranking of FX quote movement	allow (descriptive) / compare-only	Describes relative depreciation; baskets differ	Same formula, direction caveat	Allow with explicit "quote increase = depreciation"; no level ranks	If refused: movement visible in Compare only; no relative-depreciation leaderboard
O4	Cross-country ranking of cumulative INDEX change	allow / within-country only	Same 2010=100 base makes cumulative inflation comparable	Percent-of-index math valid	Allow for cumulative change only; never index levels	If refused: index analyses stay within-country; lose inflation-over-period comparisons
O5	Inflation level rank direction	ASC only / ASC+DESC / none	"Lowest first" is descriptive, not welfare	Numeric order only	Keep ASC, add neutral wording; never "better"	If none: lose descriptive ordering; if dual: risk "best/worst" reading
O6	Period-average quote for FX	allow / refuse	WDI series is itself a period average; averaging annual averages is meaningful	Mean of quotes, not a growth rate	Allow, labelled "average annual quote"	If refused: only movement operations for FX
O7	Group GDP per capita ΣGDP/ΣPOP	implement / defer / refuse	Enables group average-income comparison	Requires both legs; watch base consistency	Implement, APP_DERIVED, opt-in; does not alter existing country/aggregate per-capita outputs	If deferred: group per-capita stays refused (NOT_AGGREGATABLE)
O8	Period-complete universe per period vs strict cross-period LFL	both exposed / strict only	Strict change universe excludes partial countries; per-period ranks may use more countries	Two denominators coexist	Both, labelled separately; change statistics default to strict	If strict-only: fewer ranks available; if single-universe only: ambiguous comparisons
O9	Where period totals appear in Compare	all flows / Movement only	Consistent engine, fewer surprises	Same math either way	All flows and ratio legs, operation-labelled	If Movement-only: Compare stays endpoint/point-based
O10	CAGR availability	levels/flows/stocks only / also ratios	CAGR on a ratio is not standard	Ratio-of-ratios compounding misleading	Refuse for RATE/RATIO/INDEX/FX; allow for LEVEL/FLOW/STOCK	If allowed: risk of "FDI/GDP CAGR" misread as economic growth
O11	Design documents location at implementation	docs/ / repo root	Process only	None	docs/ for new audit/report files	If root: files sit beside README
O12	Remove backend/full7c2.log + normalize the env-dependent refresh test	clean / leave	Repo hygiene, deterministic tests	None	Clean in Phase 9	If left: documented caveat persists
27. FINAL RECOMMENDED SYSTEM
One declarative registry drives one generic engine: semantic types (LEVEL/STOCK, FLOW, SIGNED FLOW, RATE, RATIO, INDEX, QUOTED RATE) → declared operations (level/rank, YoY, endpoint absolute/percent, CAGR, period total/average, period absolute/percent change, rate PP/average, ratio PP/average/cumulative/period-PP, index point/cumulative, FX quote movement/average quote, group sum/ratio-of-sums/per-capita) → shared guards → operation-specific LFL universes (U1–U5) → operation-scoped ranking (statistic named, universe named, denominator shown, exclusions explained) → peer benchmarks (mean/median/percentile/gaps with exact units) → typed API envelopes with full provenance → a frontend that formats and presents, with collapsible methodology, boundary-year markers, and one scrollable chart per series with a sticky Y-axis. GDP and GDP-per-capita analytics remain frozen and fixture-verified. The canonical regression contrast — FDI decade +75.05% (period-total change) versus +536.86% (annual endpoint, explicitly labelled as not a period statistic) — is embedded in tests, documentation, and UI wording so the defect the user identified can never return.

DESIGN COMPLETE — NO CODE MODIFIED.

Consolidated implementation recap (as required by the brief)
Phases & dependencies: P0 design (now) → P1 golden freeze (blocks all) → P2 registry → P3 engine → P4 period/ranking/LFL → P5 Movement → P6 Compare → P7 methodology UI → P8 charts/responsive → P9 QA/release audit. P3–P4 gate P5–P6; P5–P6 gate P7–P8.
Stop gates: after P0 (design approval), P1 (golden green on untouched code), P2 (registry invariants + additive-only API), P3–P4 (guard/LFL/rank suites), P5 (Movement acceptance + GDP regression), P6 (compare matrix + GDP compare unchanged), P7 (methodology coverage per operation), P8 (responsive checklist at all widths), P9 (final report + zero unexplained discrepancies).
Major risks: (1) GDP regression drift — mitigated by P1 fixtures and frozen files; (2) primitive reuse altering existing YoY/period math — mitigated by delegation to existing functions and dedicated parity tests; (3) universe ambiguity — mitigated by explicit U1–U5 definitions and eligible/ranked/excluded payloads; (4) chart overlay/alignment complexity — mitigated by fixed-width plot + sticky axis overlay with shared tick array; (5) scope creep into GDP family — bounded to disclosure/presentation and opt-in group per-capita (O7).
Open decisions awaiting review: O1–O12 above (mean+median default, rate period average, FX movement ranking, index cumulative-change ranking, inflation direction wording, FX period-average quote, group per-capita, dual period universes, Compare period ops, CAGR exclusions, doc location, housekeeping).