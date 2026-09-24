Architecture Proposal — Dynamic Focus-Country, Multi-Indicator World Bank Economic Analysis Platform
Plan mode — no files modified, no commits, no implementation. This is an architecture / mathematical / data-source audit only. All codebase claims traced to source lines read in this session. All World Bank codes verified live via https://api.worldbank.org/v2 on 2026-09-24 (vintage lastupdated: 2026-07-13 observed on every payload).

1. CURRENT CODEBASE AUDIT
1.1 Current backend architecture
World Bank WDI API (https://api.worldbank.org/v2, open, no key)
  → wb/client.js : fetchCountryMetadata / fetchIndicatorSeries / fetchIndicatorMetadata
     (buildUrl, getWithRetry+backoff+Retry-After, parseEnvelope, fetchAllPages,
      checkPaginationCompleteness — fails hard on page/total mismatch)
  → wb/ingest.js : refreshData() — staged in-memory fetch → validate → ONE SQLite txn publish
     (cross-process refresh_locks + in-process flag, TEMP-table stash, per-metric
      isolate-failure, startYear-1 fetch for YoY, fetch_runs + ingest_year_stats audit)
  → domain/universe.js : THE single eligibility rule (see §1.4)
  → db/schema.sql + db/repository.js : ALL SQL lives here
     (countries, indicators, observations, fetch_runs, ingest_year_stats, refresh_locks)
  → domain/* : pure, no I/O — all economics
  → services/* : orchestration + validation + evidence, NO math
  → server.js : thin validation/translation + methodologyBlock() + error contract
     400 {error:{message,code}} / 409 / 404, CORS/admin-token/rate-limit guards,
     TTL auto-refresh middleware (GET only, fire-and-forget, X-Auto-Refresh header)
Baseline state: repo is past v2.0.1. git log shows d6d533f feat: add total GDP analysis, cee078b feat: expand World Bank GDP analysis, plus YoY-growth, middle-year, hardening commits. backend/src/config.js already has 8 metrics in 2 subjects (gdp_per_capita: nominal_current, nominal_constant, ppp_current, ppp_constant; gdp_total: total_current, total_constant, total_ppp_current, total_ppp_constant), SUBJECTS, METRIC_KEYS (frozen per-capita 4), ALL_METRIC_KEYS, CANONICAL_INDICATOR_CODES with prod-substitution refusal, assertRegistryIntegrity(), FOCUS_COUNTRY = {iso3:'IND',name:'India'} (config.js:457). /api/india/gdp-ranking already accepts ?subject= + ?country= (server.js:287-302). parseCountry(value, fallback=FOCUS_COUNTRY.iso3) is already generic (server.js:147-154). So the foundation for focus-abstraction is half-built — the remaining work is removing IND defaults/copy, not inventing genericity.

1.2 Current frontend architecture
React 19 + Vite, display-only discipline (no rank/YoY/denominator math in client):

App.jsx filter state → effective{} → props → sections → useApi(fetcher,depsKey)
  → api/client.js (single URL owner, BASE_URL from VITE_API_BASE_URL) → fetch(/api/*) → render verbatim
Shell owns UI state only (App.jsx). URL params canonical: PARAMS=[startYear,endYear,year,metric,neighbors,fromYear,view,yearA,yearB,yearMid,basis] (App.jsx:35). subject = subjectOf(metric) — derived, never a URL param (App.jsx:169-171). metric accepts key or exact WB code (config/metrics.js:106-112).
Top tabs VIEWS=[overview,data,rank,movement,yoy,coverage,audit,status] (App.jsx:61-70), lazy-mount (App.jsx:348-402). Sub-tabs rankSub/yoySub are local-only, not URL-synced. Global filterbar hidden for movement|status; movement uses own MovementControls bound to same effective.*.
Metric iteration is already subject-scoped: Overview.jsx:40-61, YearlyTable.jsx:70-90, YearComparison.jsx:52-77, App.jsx:292-312, RankMovement.jsx:38-69 all use metricKeysForSubject(subject), never raw 8-key loops. Coverage.jsx iterates backend data.metrics.
Controls are native: <select> for Analysis/Metric/Year/Neighbors, <input type=search> + buttons, Tabs.jsx custom tablist (roving tabindex, arrow keys) + SubTabs. No heavy UI library.
Refresh remount: dataVersion bumps on DataStatus:onRefreshed, <main key={dataVersion:view}> forces refetch (App.jsx:90,197-211,348).
1.3 Current metric/indicator architecture
Single authoritative source: backend/src/config.js (METRICS, CANONICAL_INDICATOR_CODES, SUBJECTS, getMetric/getSubject/subjectOf/metricKeysForSubject/describeSubjects/assertRegistryIntegrity). Frontend mirrors display-only (frontend/src/config/metrics.js, header: "Display-only … nothing here participates in any calculation"). DB indicators(code UNIQUE, metric_key UNIQUE) + observations(country_id,indicator_id,year,value REAL+value_raw TEXT, PK(country,indicator,year)). Ingestion loops registry entries, calls generic fetchIndicatorSeries(metric.indicatorCode). API identity is ?indicator=<metricKey|exact WB code> via parseMetric→getMetric (server.js:117-127). domain/format.js is presentation-only (formatValue/formatPercent/formatPercentagePoints/describeMetric, plus opt-in displayScaleHint:'trillions' for Total GDP — per-capita output bit-identical).

Frozen GDP metrics (must never change meaning): nominal_current NY.GDP.PCAP.CD, nominal_constant NY.GDP.PCAP.KD, ppp_current NY.GDP.PCAP.PP.CD, ppp_constant NY.GDP.PCAP.PP.KD, total_current NY.GDP.MKTP.CD, total_constant NY.GDP.MKTP.KD, total_ppp_current NY.GDP.MKTP.PP.CD, total_ppp_constant NY.GDP.MKTP.PP.KD.

1.4 Current analytical engines
See §2 for per-engine map. Summary: domain/ranking.js (value DESC, ISO3 ASC, ordinal ranks), domain/yoy.js (((cur/prev)-1)*100, prev≤0→null+reason), domain/yoyRanking.js (valid-pair universe only), domain/comparison.js (2-yr + 3-yr level/YoY, decomposition identity, fail-closed verifiers), domain/growthComparison.js (interval-growth, like-for-like, peer-average downstream of ranking), domain/coverage.js (CASE A/B/C/D, B>C>A>D, invented-cause guard), domain/universe.js (aggregate iff region.id==="NA" OR region.value==="Aggregates" OR blank ISO3; observation needs non-null finite value + non-blank ISO3 + metadata join + non-aggregate; fixed rejection precedence). All fully metric-agnostic (inputs are {iso3,value} arrays). Services orchestrate; repository does SQL; ingestion is registry-driven; server.js validates.

1.5 Current data flow
WB API → client (paginated, validated, retried) → ingest (classifyObservation, null≠0, canonicalDecimalString, per-year counters, universeSnapshot, atomic publish, fetch_runs+ingest_year_stats) → SQLite (raw preserved) → services (eligible reads + domain engines + vintage/evidence) → Express JSON (finished numbers + methodologyBlock) → React (verbatim render + formatting only). SQLite is persistent vintage cache: refresh only on empty DB / TTL expiry / manual POST /api/data/refresh (lock + rate-limit + admin-token in prod). Failed refresh records and keeps serving previous valid dataset.

1.6 Current strengths
Proven generic numeric core (same engines serve both GDP subjects today with zero forks).
Hardened ingestion (pagination completeness, error-envelope on HTTP-200, backoff, atomic publish, partial-refresh protection, stale-observation reconciliation, success-run authority, audit history, cross-process lock).
Deterministic ranking (total order, ISO3 tie-break, ordinal positions, denominator = valid observations for that exact metric-year, missing≠0, raw-precision math).
Like-for-like / entered-exited / decomposition identity with self-verification (verification.passed===true, else COMPARISON_INVARIANT_FAILED with no numbers).
Facts-only coverage (A/B/C/D + precedence + forbidden-cause phrases).
Backend-authoritative, curated registry (typo/arbitrary-code → 400, prod substitution refusal, registry self-check at import).
Subject layer already introduced without breaking per-capita URLs.
1.7 Current limitations
Focus-country is FOCUS_COUNTRY=IND default plumbed as parseCountry(...,FOCUS_COUNTRY.iso3) in 7 routes, but frontend hard-codes country:'IND' in 7 sections, r.iso3==='IND' highlights in 5 components, and ~60 India-specific copy strings (see §1.8). Backend can serve any country; frontend cannot ask for one.
No indicator-type metadata (no level/rate/ratio/index/flow, no rankingDirection, no aggregation capability, no valid-change-types). Adding inflation/FX/FDI today would silently inherit GDP semantics (descending rank, % change) — mathematically wrong.
No entity model beyond "one focus + ranked universe" (no official-aggregate vs custom-group distinction, no group aggregation rules).
Compare is focus-vs-universe only (no entity↔entity workspace, no capability gating).
Frontend filter/tab coherence weak (global filterbar + per-section locals + movement's own controls; native <select>s feel cheap; no searchable entity/indicator pickers, no multi-select, no URL-addressable focus).
Ingestion scales linearly per indicator (8 today; dozens need batching/progress granularity but no redesign yet).
1.8 All India-specific assumptions discovered (full sweep, node_modules|dist excluded)
1. Genuinely India-specific — keep: docs/brand/history comments (README.md:1,4,20,34,69,141,144, PROJECT_REQUIREMENTS.md, audit+pruposedSolution.txt, package.json names, schema.sql:2 comment, repository.js:418, universe.js:24, format.js:80, comparison.js:41-42 comments, wb/client.js:122 User-Agent, .env.example:46 comment).

2. Analytical logic — must become generic: config.js:457 FOCUS_COUNTRY; domain/coverage.js:86,162 focusIso3='IND' defaults; domain/growthComparison.js:74,166,176,193,203,210,212 (indiaGrowthPercent, strings); services/indiaYearly.js (filename, buildIndiaYearlyRows, indiaValue/Rank/YoY fields, ??FOCUS_COUNTRY); services/integrity.js:15,149-160 (missingIndia, I.india_observations); services/comparisonService.js:159,202,230,457,525,544,566,842 (??FOCUS_COUNTRY.iso3, focus:{name:FOCUS_COUNTRY.name} without DB lookup); services/growthComparisonService.js:124,128,159,210,233,510 (methodology strings, peer-average wording); services/coverageService.js:44,117,231, rankVerification.js:4,44, yoyVerification.js:32,167, fullRanking.js:30, attribution.js:18 defaults; server.js:147,151,299,314,326,342,354,395,403,417,422,437,721 (parseCountry fallbacks, log line); scripts/liveAudit.js:5,75,132,151-166 (fields/logs).

3. Backward-compatible API — keep temporarily as aliases: server.js:50,72,287,295 (/api/india/gdp-ranking, AUTO_REFRESH_PATHS); frontend api/client.js:74-75 (indiaRanking()); Overview.jsx:6,20, YearlyTable.jsx:4,44 callers.

4. Frontend copy — must become dynamic ({focusName}/{focusIso3} from API): App.jsx:77,83,232,234,386 (Verify India, eyebrow, h1); index.html:9,10; Overview.jsx:4,34,51-55; YearlyTable.jsx:2,55,60,63; LevelVerification.jsx:2,23,44,61,71,77,85,107; YoyVerification.jsx:2,29,53,75,83,89,97; YoyRanking.jsx:36,65,68,81,142; FullRanking.jsx:38,70,135; Coverage.jsx:18,53,89; AuditSource.jsx:20,77,81; RankMovement.jsx ~50 sites (relation labels, r.iso3==='IND', placeholders, aria-labels, story sentences — full list in exploration record).

5. Tests intentionally using India as default fixture — keep + add non-IND matrix: config.test.js:161,166; fixtures/edgeCases.js:23,118; fixtures/totalGdp.js:53,96-113,141; indiaYearly.test.js, perCapitaRegression.test.js, historicalCoverage.test.js, comparison.test.js, growthComparison.test.js, comparisonApi.test.js, server.test.js:70-148, ttlRefresh.test.js, totalGdp.test.js, yoyRanking.test.js, universe.test.js, services.test.js, coverage.test.js (all IND-seeded — correct as regression anchors; must be supplemented, not replaced).

Do NOT mechanically replace "India" — class (1) and (5) stay; classes (2)–(4) become focusEntity-parameterized with IND as default.

2. CURRENT ANALYTICAL ENGINE MAP
Engine	What it does	Reuse unchanged	New capabilities it supports	MUST NOT change
domain/ranking.js	Ordinal level rank: drop non-finite/no-iso3 → sort value DESC, ISO3 ASC (compareByValueDesc) → 1-based positions; rankAndLocate/neighborWindow/paginate/parseRankQuery/searchRanked/describeRankChange	100% — input is {iso3,value}[], metric-blind	Every new level/ratio/index/flow family (exports, imports, FDI level, reserves, population, CPI level if ever used — ranking CPI level is allowed, ranking CPI change uses yoyRanking)	DESC order even when economically "worse" (high inflation ranks #1 by size — interpretation layer, not sort, handles "better"); ISO3 tie-break; ordinal (not dense/competition); null≠0; denominator=valid rows; never sort by formatted strings
domain/yoy.js	((cur/prev)-1)*100 on raw values; null+reason when missing/non-finite/prev≤0 (BOTH_ZERO special); never 0% for incalculable; buildYoySeries	100% — formula is type-agnostic	All additive positive levels/flows (GDP, exports, imports, reserves, remittances, population); correctly refuses zero/negative bases (FDI, current account)	Raw-value input; prev≤0→null rule; reason codes; no zero-fill/rounding; do NOT "fix" it for rates — pp-change is a new transform, not an edit here
domain/yoyRanking.js	Separate YoY rank: buildYoyRows pairs years (both present, finite, prev>0) → rankByYoy orders yoyPercent DESC, ISO3 ASC, ordinal; denominator=valid pairs	100%	Growth ranking for any level/flow family; interval-growth inputs to growthComparison.js	Pairing rule; prev≤0 exclusion; DESC; pair-denominator ≠ level-denominator
domain/comparison.js	Movement decomposition: A=S_a,B=S_b,Common=A∩B,Exited=A−B,Entered=B−A; K_A,K_B common-universe positions; identity F_B−F_A=(K_B−K_A)+EnteredAbove_B−ExitedAbove_A; positional above (rank<focusRank, never value-compare); 3-yr generalization (COMMON_3, per-segment identities, additivity); verifyComparison/verifyThreeYearComparison fail-closed	100% — core takes rank+keyOf+extrasOf injection, never sorts itself	Observed vs like-for-like for any level/yoy family; future group-total comparisons (group sums feed same core as "rows")	Import (never re-implement) comparator; row-local comparator assumption (no z-score/percentile comparators or (D) breaks); sign conventions (positionNumberChange=B−A, placesGained=A−B); integer-only analytics; no SQL/format/inference
domain/growthComparison.js	Interval-growth comparison (not level): per-interval observed + like-for-like YoY ranks, no inter-interval rank subtraction; unweighted peer mean excl. focus, vsPeer as pp subtraction; verifyGrowthComparison	100%	Inflation-vs-real-GDP growth panels (real-GDP YoY vs inflation pp-change side-by-side, same membership machinery, different keyOf)	Simple % change (no CAGR/annualization here — CAGR is a new transform); validity rule; averaging downstream of ranking; null-coherence
domain/coverage.js	Facts-only changing-totals: summarizeCoverage/excludedByUniverseRule/buildYoyCoverage/explainCoverageChange (B>C>A>D), containsInventedCause/FORBIDDEN_CAUSE_PHRASES	100% (metricKey is label only)	Per-indicator coverage for every new family; YoY-coverage split; group-coverage (eligible members vs valid members)	Precedence; facts-only wording; never claim reporting causes; YoY≠level denominator
domain/universe.js	Single eligibility truth: aggregate iff NA/Aggregates/blank-ISO3; observation eligible iff non-null+finite+valid-year+non-blank-ISO3+metadata-join+non-aggregate; fixed rejection precedence; describeUniverseRule	100%	Applies verbatim to every WDI series (verified: total-GDP aggregates ARB/AFE caught; FX WLD=null correctly absent; CPI WLD present but still aggregate-excluded from country ranking)	Rule text; counter separation; blank-ISO3 rule (catches XD/XN income groups); never duplicate rule elsewhere
services/* (10 files)	Orchestration: indiaYearly/fullRanking/rankVerification/yoyVerification/comparisonService/growthComparisonService/coverageService/vintage/integrity/attribution	Unchanged (pass new metricKey/scope)	New families flow through same services once registry declares them	No math in services; atomic reads; fail-closed invariants; metric_not_ingested handling
db/* + wb/*	Generic (country,indicator,year,value) store; registry-driven fetch→validate→atomic-publish	Unchanged	Dozens of indicators = new indicators rows + observation rows, no DDL	Dual value/value_raw; PK; is_aggregate SQL filter; staging invariant; pagination-completeness; retry semantics
domain/format.js is presentation-only — the only file where per-metric display hints are allowed (displayScaleHint, future percentScale, ppSuffix).

3. WORLD BANK INDICATOR INVENTORY (all codes verified live, lastupdated 2026-07-13)
Frequency for all WDI series below: annual. Source dataset for all: World Development Indicators, source id 2. Unit field in API is "" for most (meaning carried in name/sourceNote); interpretation below uses official name + sourceNote. Coverage notes are observed (2023–2024 spot-checks quoted); exact per-indicator year ranges must be recorded by the Phase-1 ingestion probe (ingest_year_stats), not hard-coded.

3.1 Inflation
Concept	Code (verified)	Official name	Unit / type	Coverage observed	Aggregates	Raw/derived	Valid transforms	Invalid transforms	Aggregation	Comparison	Direction	Caveats	Tier
CPI inflation	FP.CPI.TOTL.ZG	"Inflation, consumer prices (annual %)"	%/yr, rate (annual % change of CPI basket). SourceNote: IMF IFS.	IND 2023=5.649, 2024=4.953; WLD 2023=5.799, 2024=3.014; EAS/SAS present	Official aggregates exist (WLD/EAS/SAS returned real values)	RAW rate	LEVEL (display), PP_CHANGE (B−A), YoY-rank on pp-change, AVG over period, annual series	PERCENT_CHANGE on the rate via yoy.js is relative change of a % (e.g. 6→3 = −50%) — allowed only if explicitly labelled, never default; no SUM/AVG-custom-group-as-official	OFFICIAL_AGGREGATE_ONLY; custom groups MEMBER_LEVEL_ONLY (show member annual rates + avg-of-available with label, never "regional inflation")	Country↔country, country↔official aggregate (WB publishes both), group members side-by-side	Neutral/descriptive; "lower-first" ordering is a view option, never inherent "better"	Can be negative (deflation); base can be 0/negative → pp-change still valid, % change refused; do not CAGR a rate	Tier 1
GDP-deflator inflation	NY.GDP.DEFL.KD.ZG	"Inflation, GDP deflator (annual %)"	%/yr, rate (whole-economy price change = current-LCU/constant-LCU). NSO/WB sources.	Exists (metadata verified; values follow same vintage)	Official aggregates expected (same family as CPI)	RAW rate	Same as CPI	Same prohibitions	Same as CPI	Same as CPI; pairs with real-GDP YoY (§9)	Neutral	Conceptually closest to "GDP price" counterpart of total_constant YoY; methodology differs from CPI (basket vs whole economy) — document, don't mix	Tier 1 (second inflation leg)
3.2 Real GDP relationships (already owned — reference, not new ingestion)
total_constant NY.GDP.MKTP.KD ("GDP constant 2015 US$", IND 2025=3,693,970,992,045.56) + existing yoy.js = annual real GDP growth (already derived, correctly). NY.GDP.MKTP.KD.ZG ("GDP growth annual %") exists but must NOT be ingested as a level — it is the same concept pre-computed by WB; feeding it into yoy.js double-applies change. Keep refusing it (existing registry guard). LCU series NY.GDP.MKTP.CN/KN exist but are not cross-country comparable — keep refusing. "Real GDP at current prices" is a contradiction — NOT SUPPORTED BY WORLD BANK DATA.

3.3 Exchange rates / currency value
Concept	Code	Name	Unit/type	Coverage	Aggregates	Valid	Invalid	Aggregation	Direction	Tier
Official FX, focus vs USD	PA.NUS.FCRF	"Official exchange rate (LCU per US$, period average)"	Quoted rate: LCU per USD, period avg. IND 2023=82.599, 2024=83.669	IND present both years	WLD=null (verified) — no meaningful world FX level	LEVEL (quoted), ABS_CHANGE, PERCENT_CHANGE (depreciation % = +%), annual movement, appreciation/depreciation label	SUM/AVG across currencies; cross-currency level comparison (83 INR vs 150 JPY means nothing); "best currency" ranking	MEMBER_LEVEL_ONLY (never SUM/AVG)	Country↔country on movements (not levels); cross-rates (§10)	Quotation-bound: increase = depreciation (more LCU per USD). Store quotation:"LCU_PER_USD"; never label level better/worse
REER index	PX.REX.REER	"Real effective exchange rate index (2010=100)"	Index (trade-weighted, 2010=100)	Exists	Aggregates unlikely meaningful	LEVEL (index points), INDEX_CHANGE, pp-style point change	PERCENT_CHANGE allowed but label as index %; no cross-country level ranking (different baskets)	MEMBER_LEVEL_ONLY	Country↔country on changes	Neutral
Cross-rates (INR per EUR = (INR per USD)/(EUR per USD)): mathematically supported iff both legs are PA.NUS.FCRF observations for same year, both present, labelled APP-DERIVED with both raw legs traceable. No synthetic fallback.

3.4 Exports / imports / trade
Concept	Code	Name	Type	Valid	Invalid	Aggregation	Tier
Exports current US$	NE.EXP.GNFS.CD	"Exports of goods and services (current US$)"	Flow, current US$. IND 2023=782.6bn, 2024=829.8bn; CHN/US present	LEVEL, ABS_CHANGE, PERCENT_CHANGE, YoY-rank, share-analysis vs GDP (use WB ratio directly)	—	SUM across custom groups (same unit/freq/entity-period)	Tier 1
Imports current US$	NE.IMP.GNFS.CD	"Imports of goods and services (current US$)"	Flow, current US$	Same	—	SUM	Tier 1
Exports constant 2015 US$	NE.EXP.GNFS.KD	"Exports … (constant 2015 US$)"	Flow, constant US$	Same + real-trade growth	Don't mix current/constant in one balance	SUM	Tier 1
Imports constant 2015 US$	NE.IMP.GNFS.KD	"Imports … (constant 2015 US$)"	Flow, constant US$	Same	Same	SUM	Tier 1
Exports % GDP	NE.EXP.GNFS.ZS	"Exports … (% of GDP)"	Ratio (%). Use WB ratio directly, never reconstruct	LEVEL, PP_CHANGE	PERCENT_CHANGE on ratio (default no); SUM/AVG of ratios	WEIGHTED_RATIO (recompute from sums) or OFFICIAL_ONLY; never add percentages	Tier 1
Imports % GDP	NE.IMP.GNFS.ZS	"Imports … (% of GDP)"	Ratio	Same	Same	Same	Tier 1
Trade % GDP	NE.TRD.GNFS.ZS	"Trade (% of GDP)"	Ratio (exports+imports)/GDP	LEVEL, PP_CHANGE	SUM	Same	Tier 2 (redundant if both legs present, but convenient)
Derived trade balance (exports − imports, same price basis + same year + same entity + both valid) is allowed as APP-DERIVED (flow, can be negative → % change refused, absolute change only). Never mix current with constant legs.

3.5 FDI
Concept	Code	Name	Type	Valid	Invalid	Tier
FDI net inflows, BoP current US$	BX.KLT.DINV.CD.WD	"Foreign direct investment, net inflows (BoP, current US$)"	Flow, current US$, can be negative/zero (net = inflows−disinvestment). IND 2023=28.09bn, 2024=27.14bn; WLD present	LEVEL, ABS_CHANGE, YoY-rank where base>0; SUM across groups	PERCENT_CHANGE when base≤0 or sign-change → "unavailable + reason" (existing yoy.js already does this)	Tier 1
FDI net inflows % GDP	BX.KLT.DINV.WD.GD.ZS	"Foreign direct investment, net inflows (% of GDP)"	Ratio (%, can be negative)	LEVEL, PP_CHANGE	PERCENT_CHANGE default no; never SUM percentages	Tier 1
FDI level vs % GDP vs pp-change must be three distinct metric entries with distinct validChangeTypes — the exact trap §"FDI" warns about.

3.6 Other recommended indicators (catalog investigation)
Family	Code (verified)	Name	Why useful	Valid ops	Tier
Current account	BN.CAB.XOKA.CD	"Current account balance (BoP, current US$)"	External-sector anchor; pairs with trade+FDI+reserves	LEVEL/ABS_CHANGE; % change refused (signed); SUM valid for groups	Tier 1
Reserves ex-gold	FI.RES.XGLD.CD	"Total reserves minus gold (current US$)"	Buffer/coverage analysis (reserves vs imports — derived months-of-imports only if same-year legs)	LEVEL/ABS/PERCENT	Tier 1
Remittances received	BX.TRF.PWKR.CD.DT	"Personal remittances, received (current US$)"	Major for IND/PHL/etc.; flow	LEVEL/ABS/PERCENT/SUM	Tier 1
Population	SP.POP.TOTL	"Population, total"	Denominator audit (explains why total-GDP denominator > per-capita denominator); group SUM valid	LEVEL/PERCENT/SUM	Tier 1 (infrastructure, not headline)
Central-gov debt % GDP	GC.DOD.TOTL.GD.ZS	"Central government debt, total (% of GDP)"	Fiscal leg; stock-ratio	LEVEL/PP_CHANGE; no SUM	Tier 2 (coverage thinner, fiscal-year dating varies)
Unemployment (national est.)	SL.UEM.TOTL.NE.ZS	"Unemployment, total (% of total labor force) (national estimate)"	Labor leg	LEVEL/PP_CHANGE	Tier 3 (definitions differ by country — ILO note — cross-country rank is weak; show with caveat or defer)
NOT SUPPORTED BY WORLD BANK DATA (do not substitute): monthly/quarterly CPI (WDI is annual); bilateral non-USD FX levels (only derive cross-rates from PA.NUS.FCRF legs); "real GDP at current prices"; non-PPP constant series with base ≠2015 (rebasing forbidden); regional inflation for custom groups (no averaging into a fake official number); currency "strength" from raw levels.

4. PROPOSED INDICATOR REGISTRY ARCHITECTURE
Evolve, do not replace. Keep METRICS/METRIC_KEYS/SUBJECTS/getMetric/assertRegistryIntegrity shape; widen each entry from metric-oriented to measure-oriented. Existing 8 entries byte-identical (keys, codes, order, labels, units).

New per-metric fields (all declarative, all backend-authoritative, echoed via describeMetric + /api/metadata so frontend never hard-codes validity):

key, subject, domain, family, indicatorCode, worldBankPage,
subject-verb: subject (country-level observation subject, e.g. 'economy')
unit, unitLong, currencySymbol, priceBasis (current|constant|n/a),
  currencyBasis (USD|international-$|LCU-per-USD|percent|index|count),
  frequency (annual),
observationType: LEVEL|FLOW|RATE|RATIO|INDEX|QUOTED_RATE,
additive: true|false,                // SUM valid for custom groups?
rankingDirection: DESC|ASC|NEUTRAL,  // DESC=size/growth rank; ASC=opt-in "lower-first"; NEUTRAL=no rank UI
interpretation: MORE_IS_MORE|LOWER_PREFERRED_IN_STABILITY|NEUTRAL|CONTEXT_DEPENDENT,
validChangeTypes: [ABSOLUTE, PERCENT, PP, YOY, CAGR],
  // PERCENT = ((B/A)-1)*100 requires A>0; PP = B−A requires RATE/RATIO/INDEX-points
aggregation: SUM|WEIGHTED_RATIO|OFFICIAL_ONLY|MEMBER_ONLY|NOT_AGGREGATABLE,
comparisonCapability: [COUNTRY, OFFICIAL_AGGREGATE, CUSTOM_GROUP] per mode,
signDomain: POSITIVE_ONLY|SIGNED|NONNEGATIVE,
requiredDenominator: null | {metricKey}  (e.g. ratio needs GDP leg documented),
quotation: null | {convention:'LCU_PER_USD', base:'USD'},
  // FX only — drives appreciation/depreciation sign, §10
derivation: {kind:'RAW'} | {kind:'APP_DERIVED', formula, inputs:[codes], label},
display: {currencySymbol, displayScaleHint?, percentDecimals?, ppSuffix?},
provenance: {provider:'World Bank', dataset:'WDI', sourceNote, sourceOrg}
coverage: {expectedStartByPriceBasis, aggregatesAvailable: bool}  // recorded, not hard-coded
Rules encoded in assertRegistryIntegrity: every metric has exactly one subject/domain/family; codes unique; FOCUS default metric per subject; METRIC_KEYS (per-capita 4) order frozen; ALL_METRIC_KEYS is the only ingest/validation universe (getMetric throws otherwise — no arbitrary WDI fetch). Future metric = new frozen entry + subject wiring, zero engine changes. CANONICAL_INDICATOR_CODES + prod-substitution refusal extend to every new code; .env.example documents each with verified name.

Anti-pattern avoided: no inflationEngine.js / fdiEngine.js / currencyEngine.js — one numeric core + richer metadata + generic transforms (§5).

5. PROPOSED GENERIC MATHEMATICAL TRANSFORMATION LAYER
New domain/transforms.js (pure) + per-metric validChangeTypes gating in services. Every transform declares {inputs, formula, domain, invalidConditions, missingBehavior, outputUnit, signSemantics, provenance} and refuses with reason instead of fabricating:

LEVEL — identity (raw). Always valid when observation present.
ABSOLUTE_CHANGE — B−A. Valid for levels/flows/rates/ratios/index/quoted-rates. Unit = input unit (pp for rates/ratios).
PERCENT_CHANGE — ((B/A)−1)*100. Valid iff A>0, finite, same metric. Else null+reason (ZERO_BASE, NEGATIVE_BASE, SIGN_CHANGE). Never for rates-as-default.
PP_CHANGE — B−A with pp unit. Valid iff input is RATE/RATIO/INDEX-points. This is the default change for inflation/FDI-%-GDP/trade-%-GDP.
YOY — existing yoy.js = PERCENT_CHANGE on consecutive years (kept, not duplicated).
CAGR — (B/A)^(1/n)−1, valid iff A>0, n>0, both endpoints valid, level/flow only (never rates/ratios/FX-index). New, small, tested.
INDEX_CHANGE — point + percent pair for indices (REER), labelled as index points.
GROUP_SUM — Σ member levels/flows (same metric/year/unit). Refused for per-capita/rates/ratios/FX (see §"Group aggregation").
GROUP_RATIO_FROM_SUMS — Σnum/Σden (e.g. group exports % GDP from summed exports/GDP legs — requires both legs stored).
CROSS_RATE — (A per USD)/(B per USD) (§10), APP-DERIVED, both legs traceable.
RANK / RANK_CHANGE / OBSERVED_VS_LIKE_FOR_LIKE — existing ranking.js/comparison.js reused unchanged; RANK_CHANGE is positional (describeRankChange), never economic "better/worse".
Services check metric.validChangeTypes before dispatch; UI builds its mode list from /api/metadata (never scattered if metric==='inflation' conditionals). Unsupported → UNSUPPORTED_TRANSFORMATION {metric, transform, reason} (HTTP 400), never a silent number.

6. PROPOSED ENTITY / COUNTRY / REGION / CUSTOM-GROUP MODEL
type AnalysisEntity =
  | { kind:'country', iso3 }                          // e.g. IND, CHN, USA
  | { kind:'wb_aggregate', iso3 }                     // WLD, SAS, EAS… — ONLY if WB publishes the series
  | { kind:'custom_group', id, label, members:[iso3] } // user-selected, client-composed
Country: any countries row with is_aggregate=0. Resolved via stored metadata (name from DB, not hard-coded). Default focus IND preserved.
Official WB aggregate: the WB's own published observation (countryiso3code = WLD/SAS/…, region.id==="NA" row). Used directly when the series provides it (verified: CPI yes, FDI yes, FX-WLD no). Never computed. Labelled World Bank aggregate. Excluded from country rankings by existing universe rule (no change).
Custom group: user-picked ISO3 list (multi-select, URL-encoded ?group=IND,CHN,IDN). Computed only via valid aggregation (§"Group rules"). Labelled User-selected group (n members). Never called a "region". No hard-coded continents/regions anywhere. Groups are client state (localStorage + URL) in Phase 1; no new DB table required (server is stateless over explicit member lists, validated against metadata).
Focus is one AnalysisEntity (default {kind:'country',iso3:'IND'}). Comparison endpoints take entityA, entityB (each any kind) + metric + period. Backend validates resolvability + capability matrix (§7) and fails closed otherwise.
7. PROPOSED COMPARISON ENGINE
Extend comparisonService (same core, same verifiers) with an entity-resolution preamble: resolve each entity to {memberRows per year} then dispatch to existing buildLevelComparison / buildYoyComparison / buildThreeYearLevelComparison (for SUM-aggregatable groups, pre-aggregate to a synthetic series first, then reuse core — group totals rank/compare exactly like a country series, with APP-DERIVED provenance + member-coverage attached).

Validity matrix (enforced server-side, mirrored in UI picker disabling):

Country↔Country	Country↔OfficialAgg	Country↔CustomGroup	Group↔Group	Agg↔Agg
Total GDP / Exports / Imports / FDI-flow / Reserves / Remittances / Population (SUM-valid)	level/abs/%/rank/movement/obs-vs-lfl	level only if WB publishes agg series for that metric-year (else 400 NO_OFFICIAL_AGGREGATE)	level/abs/%/rank vs group total; obs-vs-lfl group decomposition	group totals + obs-vs-lfl both sides	level only when both legs are WB-published
GDP per capita (non-additive)	full suite	same rule	members side-by-side only (no group SUM — 400 NOT_AGGREGATABLE)	side-by-side only	same rule
Inflation / ratios / debt-% / unemployment (RATE/RATIO)	annual + pp-change + avg + inflation-vs-growth (§9)	official agg directly (CPI-WLD exists)	member levels only (no averaged "regional inflation" — 400 with reason)	member distributions only	official-vs-official only
FX quoted rate (PA.NUS.FCRF)	movements/cross-rate (§10)	unavailable (WLD=null — 400 NO_OFFICIAL_AGGREGATE)	member movements only	movements only	unavailable
Every unsupported cell returns Not available for this measure — <methodological reason> (HTTP 400 code, e.g. NOT_AGGREGATABLE, NO_OFFICIAL_AGGREGATE, UNSUPPORTED_TRANSFORMATION), never a number.

8. OBSERVED VS LIKE-FOR-LIKE ARCHITECTURE
Reuse comparison.js set algebra verbatim, generalized from "years" to "entity-year sets":

Observed group total (year Y): Σ valid member observations in Y (all eligible members available at that endpoint).
Like-for-like group total: Σ members valid in BOTH endpoints (intersection), ranked/compared with same engines.
Response carries both + memberCoverageEffect = observedChange − likeForLikeChange (separates coverage churn from within-member economics) + per-member COMMON/ENTERED/EXITED + existing decomposition identity per segment + verifyComparison (extended to group totals — same checks, synthetic series treated as one row-source).
Applies to SUM-valid families (GDP, exports, imports, FDI flows, reserves, remittances, population). Explicitly not offered for rates/ratios/FX/per-capita (picker hides it; API 400s it).
9. INFLATION + REAL GDP ANALYSIS DESIGN
Descriptive-association module (no causal language), built from owned primitives:

Inputs: total_constant annual series → existing yoy.js = annual real GDP growth; FP.CPI.TOTL.ZG (or GDP-deflator variant) = annual inflation rate. Both annual, both country-level, both backend-computed.
Alignment: common-year inner join (years where both legs valid); coverage panel shows inflationAvailable / realGrowthAvailable / pairedYears.
Outputs per paired year: {inflationRate, realGrowthYoY, inflationPPChange, growthPPChange}; period summaries: avgInflation (mean of annual rates, labelled), realTotalChange ((B/A)−1), realCAGR (where valid), high-inflation/low-growth year flags (thresholds are view params, never stored judgments), inflationChange vs growthChange scatter-table.
Guards: pp-change for inflation legs; % change for real-GDP legs; never CAGR a rate; deflation (negative CPI) handled (pp valid, % refused); missing leg → row missing with reason; header disclaimer Descriptive association — no causal inference; causal verbs (caused, drove, because of) forbidden in copy/tests (FORBIDDEN_CAUSE_PHRASES extended).
10. CURRENCY / FX ANALYSIS DESIGN
Registry: PA.NUS.FCRF with observationType:QUOTED_RATE, quotation:{convention:'LCU_PER_USD',base:'USD'}, rankingDirection:NEUTRAL, aggregation:MEMBER_ONLY, validChangeTypes:[ABSOLUTE,PERCENT].
Semantics (stored once, cannot become a sign bug): level = LCU per USD; Δ>0 → depreciation of focus currency vs USD; Δ<0 → appreciation. PERCENT_CHANGE = depreciation % (same formula, relabelled). Absolute movement in LCU. Annual movement table + period rise/fall + YoY-rank on movements (existing yoyRanking.js on FX levels is valid — it ranks movements).
Cross-rates: TARGET per FOCUS = (FOCUS per USD)/(TARGET per USD) — wait, correct: INR per EUR = (INR per USD)/(EUR per USD). Both legs same-year PA.NUS.FCRF, both valid → APP-DERIVED with {legA:{iso3,value},legB:{iso3,value},formula} traceable. Missing leg → unavailable.
Prohibitions: no SUM/AVG of rates; no level comparison across currencies ("83 vs 150" is units, not strength); no "best currency" ranking (picker offers NEUTRAL → movement-rank only); no official-aggregate FX (WLD null — engine returns NO_OFFICIAL_AGGREGATE).
11. FDI / EXPORT / IMPORT ANALYSIS DESIGN
Exports/imports (current + constant pairs): level / absolute / percent / YoY-rank / coverage — existing engines unchanged. Constant legs give real-trade growth; current legs give nominal. Never mix bases in one balance.
Trade balance (APP-DERIVED, flow, signed): exports − imports iff same price basis + same entity + same year + both valid. Valid: level, absolute change. Percent change refused when base ≤0 or sign-change (existing guard). Provenance {formula:'exports−imports', legs:[codes]}.
Ratios (NE.EXP.GNFS.ZS etc.): use WB ratio directly; level + pp-change + YoY-rank-on-pp; never add percentages; group ratio only via GROUP_RATIO_FROM_SUMS.
FDI: three distinct metrics (level flow, % GDP ratio) with distinct validChangeTypes; zero/negative/sign-change → absolute/pp + relative percent unavailable: <reason> (existing YOY_NA_REASONS extended with SIGNED_FLOW wording).
12. DYNAMIC FOCUS-COUNTRY ARCHITECTURE
One generic model: focusEntity: AnalysisEntity (default {country,IND}), not IndiaPage/ChinaPage. Backend already halfway: parseCountry(?country, default IND) + ?subject= on yearly/coverage routes; extend to all data routes (ranking/verify/yoy/comparison/observations already accept ?country= — frontend just never sends it).
URL-addressable: ?country=CHN&metric=total_current&... (ISO3 validated, 400 INVALID_COUNTRY otherwise; unknown → default IND exactly as resolveMetricKey does today). Existing India URLs (no country param) serve IND unchanged. /api/india/gdp-ranking kept as compatibility alias (same handler, deprecation header, no fork); new canonical /api/focus/yearly (identical shape, focus:{iso3,name} from DB metadata) introduced alongside.
Frontend: global searchable Focus: [India ▾] entity picker (country + WB aggregates + saved groups) in filterbar; all titles/labels/relation language/isFocus highlights/aria-labels/story sentences interpolate {focusName} from API focus block (never hard-coded). depsKeys gain country. FOCUS_COUNTRY remains the default constant, not analytical logic.
Focus is presentation/query context — never triggers ingestion (universe fetch is indicator-driven, country-agnostic).
13. API EVOLUTION (additive, backward-compatible)
Keep byte-identical: /api/years, /api/india/gdp-ranking, /api/ranking, /api/ranking/verify, /api/yoy-ranking, /api/yoy-ranking/verify, /api/comparison/level?mode=level|yoy, /api/coverage, /api/observations, /api/countries, /api/metadata, /api/data-status, /api/integrity, POST /api/data/refresh, error contract, methodologyBlock, METRIC_KEYS[0] defaults.

Add (all ?country=/?group= aware, all fail-closed with codes):

GET /api/focus/yearly?country=&subject=&startYear=&endYear=   (canonical; /api/india/gdp-ranking aliases it)
GET /api/entities?type=country|aggregate&search=              (picker source; DB metadata, paginated)
GET /api/indicators  (registry echo: key,subject,domain,family,code,unit,observationType,
                      validChangeTypes,aggregation,rankingDirection,quotation,derivation)
GET /api/groups/evaluate?members=&indicator=&yearA=&yearB=    (group totals obs-vs-lfl preview)
GET /api/compare?entityA=&entityB=&indicator=&yearA=&yearB=&mode=  (entity↔entity workspace; capability-gated)
GET /api/fx/cross?from=&to=&year=                             (cross-rate + legs)
GET /api/inflation-growth?country=&startYear=&endYear=&inflationMetric=  (§9 paired panel)
Response shape: existing fields + additive metric:{...,subject,domain,observationType,aggregation}, focus:{iso3,name,kind}, provenance:{source:'World Bank WDI'|kind:'RAW'|'APP_DERIVED',formula?,inputs?}, capabilities:[...], unavailable:{reason} where relevant. Frontend never computes economics; unsupported combos 400 with methodological reason.

14. DATABASE EVOLUTION
No migration to core tables. countries/indicators/observations/fetch_runs/ingest_year_stats/refresh_locks already generic: new indicator = new indicators row + observation rows; metric_key UNIQUE + ingest_year_stats(metric_key) PK already satisfied by namespaced keys; in-place column migrator keeps existing caches valid (new rows arrive on next refresh; old rows untouched).

Needed (all additive/optional):

No new columns on observations (analytical metadata lives in code registry, not per-row; presentation metadata in format.js).
Optional wb_indicator_metadata(code PK, name, unit, sourceNote, fetched_at) cache — avoids re-fetching indicator catalog; purely advisory (registry remains authority).
Custom groups: client-side first (URL + localStorage); server stays stateless (validates member lists per request). A saved_groups table only if accounts/sharing land later — explicitly deferred.
Indexes: existing (indicator_id,year,value DESC) + (country_id,indicator_id,year) already cover new families; add (metric_key,year) on ingest_year_stats if group-evaluate queries grow (already exists: idx_ingest_year_stats_metric_year).
Separation: raw storage (DB) / analytical metadata (registry) / presentation (format.js + frontend) stays strict.

15. FRONTEND INFORMATION ARCHITECTURE
Global, always visible: Focus: [searchable entity picker] + Analysis subject + Metric (subject-filtered) + Period. These four answer WHO / WHAT / WHICH / WHEN.
Workspaces (keep 8 tabs, re-scoped): Overview (focus cards for active subject), Data (yearly table, one row/year × subject's metrics), Rank (verify + full table subviews), Movement (level + growth + 3-yr point-breaker), YoY/Growth (ranking + verify), Compare (new serious workspace: Entity A / Entity B / Indicator / Period / Mode — mode list derived from validChangeTypes × aggregation, §7), Coverage (per-metric + YoY + group coverage), Audit (provenance, legs, vintage, methodology), Status (refresh/integrity).
Filters contextual per workspace (unrelated controls removed from tabs that ignore them); movement keeps its own MovementControls; compare owns entity/mode pickers.
Pickers: searchable combobox for focus/entities (keyboard: arrows/Enter/Escape, focus-visible, aria-activedescendant), multi-select with chips for groups, compact year selects, indicator picker grouped by subject/domain. No heavy UI lib — extend existing Tabs.jsx/ui.jsx patterns.
16. FRONTEND DESIGN SYSTEM — "quiet luxury economic research"
Evolve navy/light foundation; no rewrite. Tokens: paper #FAFAF8/ink #14213D neutrals, one restrained accent (deep navy/teal) + semantic muted green/red only for signed deltas with text labels (never color-alone); serif display (e.g. Source Serif/Fraunces) for titles + tabular-nums sans (Inter/IBM Plex Sans) for data; 4pt spacing scale, dense 12–13px tables with sticky headers, hairline rules over cards; small flat tabs with underline-active (extend Tabs.jsx); custom selects as understated bordered comboboxes (not pills); tables carry raw + display + unit + — for missing (never 0); charts sparing, monochrome line/bars with data labels, no animation beyond 120ms opacity/focus fades.

Explicitly avoid: bouncing/parallax/neon/gradients/animated counters/glassmorphism/shadows/oversized rounded cards/gimmicky transitions/decorative charts. Accessibility: keyboard/ARIA per §15, aria-live for tables/pagination, mobile table→cards switch already present (MOBILE_QUERY) extended to compare.

17. MIGRATION / BACKWARD COMPATIBILITY PLAN
OLD GDP INPUT + NEW ARCHITECTURE = EXACT SAME GDP OUTPUT enforced by: frozen 8 keys/codes/order/labels; METRIC_KEYS still per-capita-4 (defaults unchanged); domain/repository/ingest-shape byte-identical; per-capita display (no hint) unchanged; /api/india/gdp-ranking alias + unknown-?metric= fallback + ?country=-absent-means-IND.
Golden capture before any change: snapshot per-capita + total-GDP responses for acceptance years (2004,2014,2020,2021,2024,2025 × 8 metrics: value/rank/denominator/YoY/neighbors/coverage/comparison identity) into versioned fixtures; CI diffs new-arch output (differential/oracle test). Any diff = release blocker.
Staged rollout: registry fields (additive) → transforms (new file) → entity/group preamble (new code, old paths default IND) → compare/fx/inflation panels (new routes) → frontend picker/copy (IND default) → new-indicator ingestion (opt-in indicators: subset first). Each stage independently verifiable; old clients ignore additive fields.
18. TESTING / VALIDATION ARCHITECTURE
Preserve all existing suites (ranking/ties/denominators/YoY/pagination/search/pagination-completeness/refresh-lock/TTL/coverage A-D/universe/per-capita-regression/total-GDP-parity/API contracts). Two scope-guards already generalized (config allow-list, integrity H over ALL_METRIC_KEYS) — no further relaxation.
New: transformValidity matrix (percent-vs-pp, zero/negative/sign-change with reason assertions); quotation-direction (increase=depreciation) + cross-rate leg-trace tests; group SUM vs refusal matrix (per-capita/rates/FX 400s); official-vs-custom distinction; observed-vs-lfl group tests (10-vs-8 member example); focus-parameterization (same assertions for IND/CHN/USA/IDN + unknown-ISO3 400 + alias equivalence); inflation-vs-growth pairing (common-year join, avg/CAGR, no-causality copy lint); golden + invariant + differential tests (§17); independent oracles (hand-computed fixtures mirroring ranking.test.js style); live audit extension (new families report value/rank-or-unavailable/denominator/universe/lastupdated, never force old numbers).
19. PERFORMANCE PLAN
Ingestion: keep per-indicator loop + failure isolation; add batch progress (perIndicator already exists), keep WB_PER_PAGE=20000 (≈1 req/indicator/range; +N indicators ≈ +N reqs, ~2× rows for 8→16 — measured, not redesigned). Staged first-load via indicators: subset. No frontend-triggered ingestion on focus change (cache is universe-wide).
Queries: existing indexes suffice to ~dozens of indicators; group evaluation is 1 range-read × members (bounded by member count, paginated); compare payloads capped (detail=summary|full, pageSize ≤500 already enforced); frontend memoizes picker lists, depsKey prevents refetch storms, AbortController+requestId guards staleness.
Forbidden shortcut: no analytical math moves to frontend for "speed" — backend stays authoritative; perf via caching/aggregation/pagination only. Load-test gate: refresh duration + p95 /api/compare with 20-member groups before release.
20. SECURITY / DATA-PROVENANCE PLAN
Keep: no WB key; REFRESH_ADMIN_TOKEN (Bearer, constant-time, never logged/returned; prod boot refuses without it); CORS_ORIGINS allowlist (prod boot refuses without it); refresh rate-limit (manual POST only, GETs never limited); express.json({limit:'64kb'}); no stacks in prod; x-powered-by disabled; SQLite mutex + in-process flag + stale-lock recovery.
Provenance (research-grade): every derived number carries {source:'World Bank WDI', derivation:'RAW'|'APP_DERIVED', formula?, inputs?[{code,value}], vintage:{wb_lastupdated,retrieval,runId}, methodologyBlock}; UI Audit tab + per-cell attribution; derived never labelled "World Bank published"; third-party inputs stay ephemeral UI state (never persisted, never alter stored obs — existing rule preserved).
Hard rules (unchanged + extended): never invent/interpolate/zero-fill/forward-fill/substitute series-or-source/hard-code regions/fake aggregates/average incompatibles/label derived as WB/publish without valid derivation. Unsupported→unavailable+reason; missing→missing; invalid→unavailable+reason.
21. IMPLEMENTATION PHASES (dependency-ordered)
Phase 0 — Architecture lock (this document). Approve registry fields, transform list, entity model, matrix, alias strategy, Tier-1 scope. No code.
Phase 1 — Generic entity/focus abstraction. focusEntity plumbing (services + all routes accept ?country=, name from DB), /api/focus/yearly + alias, frontend picker behind default IND, golden fixtures captured. Dependency: none. Unblocks everything.
Phase 2 — Indicator registry expansion (metadata only). New fields + describeMetric//api/indicators, Tier-1 codes registered but not yet ingested, validity-matrix tests (all 400 paths) green. Depends on 1.
Phase 3 — Generic transformation layer. New domain/transforms.js (PP/CAGR/INDEX/GROUP_SUM/GROUP_RATIO/CROSS_RATE) + service gating + formatPercentagePoints wiring. GDP paths untouched. Depends on 2.
Phase 4 — Comparison engine (entity↔entity). Entity resolution + /api/compare + group-evaluate + obs-vs-lfl for groups + capability matrix. Depends on 1–3.
Phase 5 — New indicator families (Tier 1 first). Ingest CPI, deflator, exports×4, imports×4, FDI×2, FX, current-account, reserves, remittances, population (staged subsets); inflation-vs-growth + FX workspaces land. Tier 2/3 gated separately. Depends on 1–4.
Phase 6 — Frontend redesign (research-grade). IA (§15) + design system (§16) + custom controls + Compare workspace; IND-default copy sweep. Overlaps 4–5, ships after.
Phase 7 — Hardening / regression / release. Golden+differential+live-audit green, perf gates, docs (README/requirements/scope notes), release note (refresh cost, no mixing, ranks app-calculated). Depends on all.
Better than the draft phase list: focus-abstraction comes first (it de-risks every later diff), transforms precede ingestion (so new data can never render through wrong math), frontend ships last (it consumes only proven APIs).

22. RISKS / EDGE CASES
Reusing GDP %-semantics for rates → pp/percent confusion. Mitigation: validChangeTypes + default pp for RATE/RATIO + copy lint.*
Averaging inflation/FX into fake regional numbers. Mitigation: OFFICIAL_ONLY/MEMBER_ONLY + 400s + labels.*
Cross-currency level ranking ("83 vs 150"). Mitigation: NEUTRAL direction + movement-only UI + no agg endpoint.*
FX sign bug (quoting backwards). Mitigation: stored quotation + direction tests + display strings ("INR depreciated 1.3% vs USD").*
FDI/current-account zero/negative/sign-change % artifacts. Mitigation: existing guard + unavailable+reason UX.*
Custom group masquerading as official region. Mitigation: distinct labels/kinds + provenance + no group averaging for rates.*
Ratio reconstruction drift (recomputing % GDP instead of using WB ratio). Mitigation: use WB ratio; group ratio only from summed legs.*
Vintage mixing (legs from different runs). Mitigation: per-leg vintage exposed; cross-rate/balance require same-year legs, warn on mixed lastupdated.*
Refresh doubling + cache growth. Mitigation: staged subsets, isolation, measured cost (~+N reqs, linear rows).*
Scope creep into Tier 3 (unemployment comparability, REER methodology). Mitigation: Tier gates + caveat labels + deferral default.*
Causality language in inflation-growth views. Mitigation: copy rules + FORBIDDEN phrases + "descriptive association" headers.*
23. OPEN DECISIONS (genuinely requiring approval)
Tier-1 ingest scope: approve the 16-series Tier-1 list (§3) vs a smaller first tranche (e.g. CPI + FX + exports/imports-current + FDI-level only)?
Canonical URL: keep ?country= query param only, or also support /f/:iso3/... pretty URLs (extra routing/rewrite cost)?
/api/india/gdp-ranking lifespan: permanent alias vs sunset-after-N-releases (permanent recommended — zero cost, maximum back-compat)?
Group persistence: client-only (URL+localStorage) for v1 vs server-saved groups in DB (needs auth/sharing design — recommend defer)?
Inflation headline: CPI (FP.CPI.TOTL.ZG) as default inflation metric with GDP-deflator as secondary, or vice versa?
Unemployment: include Tier-3 with strong caveats, or exclude entirely until methodology review?
24. FINAL RECOMMENDATION
Recommended architecture: CURRENT PROVEN ANALYTICAL CORE + GENERIC MEASURE CAPABILITIES + GENERIC ENTITY MODEL + GENERIC GROUP/AGGREGATION MODEL + GENERIC COMPARISON ENGINE + DYNAMIC FOCUS + WB-VERIFIED REGISTRY + RESEARCH-GRADE FRONTEND.

Why this preserves strength while enabling breadth:

The math that earned trust — deterministic ordinal ranking, raw-precision YoY with fail-closed bases, like-for-like decomposition with self-verification, facts-only coverage, single universe rule, atomic curated ingestion — is reused unchanged (it is already metric-blind; the Total-GDP rollout proved it). No engine fork, no DDL, no URL breakage, golden-tested equality for all 8 GDP metrics.
All genuinely new economics lives in two small, declarative places: richer registry metadata (what each series is and allows) and a generic transform layer (percent vs pp, signed-flow guards, quotation-aware FX, group sums/ratios, cross-rates) — so the 9th indicator costs a registry entry, not a new engine, and an invalid operation is impossible to request, not merely undocumented.
Focus-country becomes a query parameter with IND default, not a rewrite: backend already resolves any ISO3, the alias preserves every existing link, and frontend dynamism is copy + picker work over proven APIs.
World Bank remains the sole raw source with per-leg provenance: every code above was verified live (names, units, IND/WLD spot values quoted), aggregates-vs-custom-groups are structurally separated, derived results are labelled APP-DERIVED, and anything unsupported returns a reason instead of a number.
This yields zero-error analysis first, feature count second — exactly the project's stated priority — and makes each future indicator an audited data decision, not an engineering project.

