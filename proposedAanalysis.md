I now have a complete, evidence-backed picture. Here is the audit and architecture report.

WORLD BANK INDIA GDP-PER-CAPITA RANKING — COMPARABILITY / RANK-MOVEMENT ANALYSIS
Phase 1 deliverable: full audit, mathematical derivation, and architecture blueprint (no code written, no files changed)
1. Executive summary
Verdict on the four questions posed at the start:

Does the current backend/data model already contain everything the new analysis needs? — Almost. Every input the new analysis requires is already stored and already queryable with existing repository functions (getEligibleObservations, getEligibleObservationsRange, getYoyRows/buildYoyRows, ingest_year_stats, fetch_runs.universe_snapshot, countries). There is no data-model change required and no missing observation data. What is missing is (a) a new pure domain computation (set algebra + rank-movement decomposition), (b) a service that assembles it, (c) two new read-only endpoints, (d) server-side self-verification with fail-closed behaviour, and (e) a new frontend view. The task is therefore predominantly a "mathematical transformation + presentation architecture" problem — but not only math: two required outputs are genuinely not currently available (per-economy cause of a missing observation; metadata/code-change history).

Is the proposed decomposition mathematically valid for this project's ranking definition? — Yes, and I verified it empirically against the stored dataset using the project's exact comparator (value DESC, ISO3 ASC) and 1-based ordinal ranks: for 12 level cases (4 indicators × 3 year-pairs) and 8 YoY cases (4 indicators × 2 period-pairs), the identity, both partial identities, and both set partitions held exactly (integer equality). See §7.3–7.4.

What is the single most important methodological finding? — In the currently stored vintage (World Bank lastupdated = 2026‑07‑13), every economy that "entered" or "exited" the observed ranking set in the pairs examined corresponds to a World Bank API row that was returned with no usable value (null) in the missing year — not an absent row, not a metadata change, not an aggregate-filtering artifact (verified against test/fixtures/wb-snapshot.json). However, the application does not store the identity of those null rows, only per-year counts. So the app can state the aggregate fact ("the response for this indicator-year contained N rows without a usable value") but must not claim a per-economy cause. This is exactly the epistemic boundary the new feature must respect.

Two documentation discrepancies must be corrected before any UI copy is written:

The brief's illustration "2004: India = 155/209; 2014: India = 145/200" does not match this project's stored vintage. For nominal_current the stored/audited values are 2004 = 171/209 and 2014 = 172/213 (backend/src/scripts/liveAudit.js hardcodes exactly these as its expectations, and my independent recomputation from the SQLite cache reproduces them). 155/200 is the stored 2024 nominal_current value; 144/186 is 2025. Example numbers used in design documents must be taken from the stored vintage, never invented.
The SQLite cache currently spans 1999–2025 (27 years), while the versioned test fixture (test/fixtures/wb-snapshot.json) spans 2004–2025. Both are legitimate (the cache was ingested with the startYear − 1 reach-back rule); the comparison UI must derive selectable years from stored data (GET /api/years), never from a hardcoded or documented range.
Deliverable shape recommended: a separate analytical layer — new pure domain module → new service → new read-only endpoints → new top-level frontend view with its own local controls — leaving the current ranking/data/verification/coverage experience byte-identical.

2. Complete understanding of the current project
2.1 Stack and layout (verified)

e:\world bank ranking\project
├─ README.md                      public documentation (228 lines)
├─ PROJECT_REQUIREMENTS.md        the specification (1,710 lines)
├─ backend/  Node 24+, Express 5, SQLite via node:sqlite, zero runtime deps beyond express+cors
│   ├─ src/config.js              the ONLY place indicator codes / env config live
│   ├─ src/db/{index.js,schema.sql,repository.js}   ALL SQL lives in repository.js
│   ├─ src/domain/{universe,ranking,yoy,yoyRanking,coverage,format}.js   pure functions, no I/O
│   ├─ src/services/{indiaYearly,fullRanking,rankVerification,yoyVerification,coverageService,integrity,attribution}.js
│   ├─ src/wb/{client.js,ingest.js}   API client (pagination, retries, envelope validation) + ingest pipeline
│   ├─ src/scripts/{ingest,createSnapshot,liveAudit}.js
│   ├─ src/server.js              routes + methodology block + error contract
│   └─ test/                      node:test (no test dependencies), edge-case fixture + 5.6 MB real WB snapshot
└─ frontend/ React 19 + Vite 8 + oxlint, display-only
    ├─ src/App.jsx                tab shell, global filter bar, URL-state mirroring
    ├─ src/api/client.js          the only place that knows endpoint URLs
    ├─ src/sections/*.jsx         10 sections (Overview, YearlyTable, YearComparison, LevelVerification,
    │                             FullRanking, YoyRanking, YoyVerification, Coverage, AuditSource, DataStatus)
    ├─ src/components/{ui.jsx,Tabs.jsx}
    ├─ src/hooks/useApi.js        abortable fetch with stale-response protection
    └─ src/config/metrics.js, src/utils/format.js, src/index.css
2.2 What the application actually stores (measured, read-only inspection of backend/data/worldbank.db)
Fact	Value
Eligible economies (is_aggregate = 0)	217 (217 distinct ids, all exactly 3 uppercase letters)
Aggregate entities	78 (295 metadata rows total, matching the World Bank /country list)
Stored observations	21,785 rows, all four indicators, all with non-null value and non-null value_raw
Stored years	1999–2025 (27 distinct years); India holds all 27 years for all four indicators
Value range	min 96.3192243479286, max 288001.574856495; zero non-positive values
Duplicate (country, indicator, year) rows	0
World Bank lastupdated on every stored row	2026-07-13 (single vintage)
fetched_at on every stored row	all inside 2026‑09‑21T13:50:40–13:50:42Z → the whole dataset is one write generation
fetch_runs	12 successful runs, ids 1, 4…14 (ids 2–3 absent), latest = 14, with universe_snapshot (eligibleCount: 217, eligibleIds), pages_fetched = 4, requests = 4
ingest_year_stats	1,296 rows = 4 metrics × 27 years × 12 runs; per-year counters available for every metric-year
Exact-value ties in any metric-year	0 (a tie census across all 4 × 27 year-sets found none)
Example per-year counters (run 14, nominal_current): 2004 → received 265, with value 256, written 209, null-skipped 9, aggregate-excluded 43, blank-ISO3 4, unknown 0; 2014 → written 213, null 5; 2024 → written 200, null 18. (These reconcile exactly with the API payload: 265 rows/year = 5 blank-ISO3 income-group rows + 43 aggregates + 217 eligible rows, of which 8–18 carry null values; the blank-ISO3 row that is also null is counted under rows_null_skipped because rejection codes follow a fixed precedence.)

2.3 Stored per-metric denominators and India's rank (computed with the project's comparator)
Metric	2004	2014	2024	2025
nominal_current (NY.GDP.PCAP.CD)	171 / 209	172 / 213	155 / 200	144 / 186
nominal_constant (NY.GDP.PCAP.KD)	173 / 203	167 / 210	148 / 199	135 / 186
ppp_current (NY.GDP.PCAP.PP.CD)	148 / 195	146 / 199	133 / 195	124 / 185
ppp_constant (NY.GDP.PCAP.PP.KD)	154 / 193	145 / 199	133 / 195	124 / 185
These reproduce liveAudit.js's audit expectations and the specification's acceptance table (spec §26/§39) exactly, which is a strong consistency signal between specification, implementation, and stored data.

3. Current ranking/data architecture (authoritative sources of each fact)
Fact	Authoritative location	Notes
Metric definitions, units, indicator codes	backend/src/config.js → METRICS, getMetric()	Never hardcoded deeper; unknown keys throw
Aggregate/eligibility rule	backend/src/domain/universe.js → classifyEntity, classifyObservation, AGGREGATE_REASONS, OBSERVATION_REJECTIONS	Single source of truth; mirrored at SQL level by c.is_aggregate = 0
Valid-observation set for (indicator, year)	repository.getEligibleObservations(db, indicatorId, year)	One SQL statement, joins countries, excludes aggregates, value IS NOT NULL
Ranking order & rank	domain/ranking.js → compareByValueDesc, rankByValue	value DESC, iso3 ASC, 1-based position; ties get distinct positions
India's yearly value/YoY/rank/denominator	services/indiaYearly.js → buildIndiaYearlyRows	Recomputes per year from getEligibleObservationsRange
YoY formula + NA reasons	domain/yoy.js → computeYoy, YOY_NA_REASONS/DESCRIPTIONS	Missing current/previous → null; previous ≤ 0 → null + reason; never 0%
YoY-valid pairs & YoY ranking	domain/yoyRanking.js → buildYoyRows, rankByYoy	Pair requires both years, finite, previous > 0; order yoy DESC, iso3 ASC
Coverage counts & CASE A/B/C/D explanation	domain/coverage.js + services/coverageService.js	Precedence B > C > A > D; containsInventedCause() + FORBIDDEN_CAUSE_PHRASES guard invented causality
Metadata-universe change between runs	services/coverageService.js → buildMetadataChange + repository.getUniverseSnapshotByRun	comparable:false when a snapshot is missing
Integrity checks	services/integrity.js → runIntegrityChecks (A–J)	{check, status, detail} report shape
Vintage / staleness / lock state	observations.wb_last_updated, fetch_runs, wb/ingest.js → getCacheStatus, getRefreshLockState	TTL default 24 h; SQLite-backed cross-process mutex
Method/attribution text	server.js → methodologyBlock(), services/attribution.js	Per-response, so no result can be presented as a World Bank publication
Frontend state	frontend/src/App.jsx (VIEWS, PARAMS, filter state, URL mirroring)	Sections are lazy-mounted; all numbers come from the API
Key architectural properties already guaranteed (these are assets for the new feature):

One comparator, one ranking engine, one universe rule — used by level ranking, YoY ranking, verification, coverage, yearly table.
Raw precision preserved everywhere; formatting lives only in domain/format.js / frontend/src/utils/format.js and is never an input to a calculation.
Missing data is never stored, never zero, and never estimated.
Every rank-producing response carries the "calculated by this application" disclaimer.
The frontend performs no ranking/derivation arithmetic.
4. Current data flow

World Bank WDI API (/country, /country/all/indicator/<code>?date=…)
   → wb/client.js  (pagination by meta.pages/per_page/total; completeness check THROWS on incomplete;
                    retries + backoff + Retry-After; HTTP-200 error envelopes detected)
   → wb/ingest.js  (metadata → buildUniverse → eligible/aggregate ISO3 sets → per indicator:
                    classifyObservation per row with a FIXED rejection precedence
                    (missing value → non-finite → invalid year → blank ISO3 → aggregate → unknown),
                    counters written per run and per (metric, year); observations upserted in one transaction;
                    universe_snapshot stored on the run)
   → SQLite (countries, indicators, observations, fetch_runs, ingest_year_stats, refresh_locks)
   → services (indiaYearly | fullRanking | rankVerification | yoyVerification | coverageService | integrity)
   → domain (universe | ranking | yoy | yoyRanking | coverage | format)     ← pure, I/O-free
   → Express routes (thin: parse/validate query → service → res.json({...result, methodology}))
   → React frontend (display only; metrics metadata for labels/units; formatters for presentation)
Refresh semantics: SQLite is a persistent cache. Refresh happens on empty DB at boot, on stale TTL (background, guarded by an in-memory flag and a SQLite mutex, with a 15-minute post-failure cooldown), or manually via POST /api/data/refresh. A total refresh failure restores a pre-refresh stash of countries/indicators/observations — the audit trail (fetch_runs, ingest_year_stats) is deliberately preserved.

5. Existing backend capability assessment (what exists vs. what the new feature must add)
Exists and is directly reusable, unchanged:

Capability	Existing artefact
Exact valid-observation set for (indicator, year), with values, raw strings, names	repository.getEligibleObservations
Same, for a year range in one SQL statement (atomic read)	repository.getEligibleObservationsRange
Exact ranking + rank of any economy	domain/ranking.rankByValue / rankAndLocate
Exact comparator (the only permitted one)	domain/ranking.compareByValueDesc
YoY-valid pair construction for a period	domain/yoyRanking.buildYoyRows
YoY coverage/diagnostic block for a year	domain/coverage.buildYoyCoverage
Denominator + coverage counts for (indicator, year)	repository.countEligibleObservations, getCoverageCounts
"Why does the total change?" CASE A/B/C/D with facts	services/coverageService.explainTotalChange (+ domain/coverage.explainCoverageChange)
Metadata-universe added/removed between two runs	services/coverageService.buildMetadataChange
Per-year ingest counters (received / with value / written / null / aggregate / blank ISO3 / unknown)	repository.getLatestIngestYearStat, getIngestYearStats
Year → producing fetch run mapping	ingest_year_stats.fetch_run_id
Vintage, cache freshness, lock state, recent runs	getCacheStatus, listFetchRuns, getRefreshLockState
Economy metadata (region, regionId, adminRegion, incomeLevel, lendingType, capitalCity, aggregate flag+reason)	countries table; getCountry(iso3), listEligibleCountries()
Report shape convention for self-checks	services/integrity.js {check, status, detail}
Presentation conventions (display strings alongside raw)	domain/format.js
Does not exist anywhere in the codebase (verified by searching every service/domain/route):

No set-intersection/difference over two years' valid-observation sets.
No notion of "common comparison universe", "entered/exited observed ranking", or "above/below India within a movable set".
No rank-movement decomposition, and therefore no self-verification of one.
No route that accepts two years for ranking purposes (/api/coverage accepts fromYear/toYear, but only to explain denominator changes — it does not compute sets or ranks).
No dataset fingerprint in any response (so a client cannot tell whether two successive responses came from the same retrieval generation).
No stored identity of API rows that carried no usable value.
No country-metadata history (upserts overwrite; only per-run eligibleIds/aggregateIds snapshots survive).
Answering the specific audit questions from the brief:

Question	Answer
Is ranking recalculated from raw DB values or stored?	Always recalculated from observations.value (REAL) at request time. No rank is stored anywhere.
Is the complete valid-observation set directly queryable?	Yes — one call returns all rows for (indicator, year). A single range call returns several years atomically.
Can the backend obtain all ISO3s for a year/indicator?	Yes, same call.
Is ISO3 guaranteed unique?	Yes per (indicator, year) — PK (country_id, indicator_id, year); and 217 eligible ids are distinct.
Can it reliably distinguish aggregate entities?	Yes — centrally computed is_aggregate + reason code, enforced again in SQL.
Can it reconstruct ranking order identically to the current system?	Yes, but only if the new code uses the existing comparator/engine — this is an architectural constraint, not a given (§8).
Can it determine the position of an entered/exited economy relative to India?	Yes, by position index inside the two rankings (must not be done by raw-value comparison — §8.3).
Can it determine whether India is in the common universe?	Yes trivially: India ∈ A ∩ B ⟺ India has a stored valid observation in both years.
Is there already a service that could be reused?	Several: comparators/rankers, YoY pair builder, coverage explanation, per-year counters, universe-snapshot diff. No service needs modification.
Do existing queries already return most of the information?	Yes — getEligibleObservations(Range) + getLatestIngestYearStat + getUniverseSnapshotByRun cover ~95 % of the required inputs.
Does the feature require a new SQL query, service, domain function, endpoint?	New domain function(s), new service, new read-only endpoints; SQL optional (only for a single-statement atomic two-year read).
Is this "just math"?	Mostly, but not entirely: the per-economy cause of entry/exit and any historical classification/metadata are not recoverable from stored evidence (§12, §25).
6. Mathematical model for common-universe comparison
Notation. Fix one indicator i (one of the four). Let C be the eligible universe (countries.is_aggregate = 0).

Definition 6.1 (valid-observation set). For year y, S_y = { c ∈ C : a stored finite observation exists for (c, i, y) }, with value v_y(c) (the stored REAL).

Definition 6.2 (order). On S_y: c ≺_y c′ ⟺ v_y(c) > v_y(c′) , or ( v_y(c) = v_y(c′) and c < c′ ) where < on ISO3 is plain ascending string order (the project uses a.iso3 < b.iso3). Because each economy appears at most once per (indicator, year), ≺_y is a strict total order on S_y.

Definition 6.3 (rank). rank_y(c) = 1 + |{ c′ ∈ S_y : c′ ≺_y c }|. (1-based ordinal position; ties receive distinct positions — this matches rankByValue exactly.)

Definition 6.4 (row-local comparator / restriction property). The comparison keys (v_y(c), c) are properties of the row alone. Therefore for any T ⊆ S_y, the order obtained by ranking T on its own is the restriction of ≺_y to T. Formally: c ≺_T c′ ⟺ c ≺_y c′ for all c, c′ ∈ T. This property is what makes the decomposition below exact, and it holds only because the comparator never uses set-level statistics (no z-scores, no percentiles, no "rank relative to the year's mean"). It is a hard architectural constraint (§13.4).

Lemma 6.5 (restriction lemma). For T ⊆ S_y and c ∈ T: rank_T(c) = rank_y(c) − |{ c′ ∈ S_y \ T : c′ ≺_y c }|. Proof. {c′ ∈ S_y : c′ ≺ c} = {c′ ∈ T : c′ ≺ c} ⊔ {c′ ∈ S_y\T : c′ ≺ c}; take cardinalities and add 1. ∎

Two-year comparison. For years a ≠ b let A = S_a, B = S_b, and define Common = A ∩ B, Exited = A \ B, Entered = B \ A. Then A = Common ⊔ Exited and B = Common ⊔ Entered (disjoint unions).

Definition 6.6 (full observed ranks). F_a = rank_a(IND), F_b = rank_b(IND) (defined only if IND ∈ A or B respectively).

Definition 6.7 (position within the common comparison set). K_a = rank_Common(IND) computed with year-a values; K_b = rank_Common(IND) computed with year-b values. Both defined iff IND ∈ Common. K_a is not any observed-year rank; it is a derived counterfactual position. This must be named and explained as such, always.

Definition 6.8 (above/below classification — position-based). Above_y(X) = |{ c ∈ X : c ≺_y IND }|, Below_y(X) = |{ c ∈ X : IND ≺_y c }| for X ⊆ S_y. Classification is by position in the ranking, i.e. by ≺_y, never by a raw value comparison (v > v_IND), because those differ exactly when values tie (§8.3).

Denominator relations (exact, integer):

|A| = |Common| + |Exited|, |B| = |Common| + |Entered|
Δ|S| = |B| − |A| = |Entered| − |Exited| = (EnteredAbove + EnteredBelow) − (ExitedAbove + ExitedBelow)
Sign convention (must be stated in the API and the UI). Rank numbers are positions: smaller = higher/better. Therefore:

ΔF := F_b − F_a; ΔF > 0 ⇒ India's position number rose ⇒ India moved down ΔF places.
PlacesGained := F_a − F_b = −ΔF; positive ⇒ India moved up. Both are mathematically identical; the architecture must pick one canonical sign per field and label it in words ("position number change" vs "places gained") so the UI never has to infer semantics.
7. Mathematical model for entered/exited rank effects (derivation + verification)
7.1 The identity
Assume IND ∈ Common (i.e., India has a stored valid observation for the indicator in both years).

By definition, F_a = 1 + Above_a(A). Since A = Common ⊔ Exited, Above_a(A) = Above_a(Common) + Above_a(Exited), hence F_a = 1 + Above_a(Common) + ExitedAbove_a = K_a + ExitedAbove_a because K_a = 1 + Above_a(Common). → (P1) K_a = F_a − ExitedAbove_a

Likewise → (P2) K_b = F_b − EnteredAbove_b

Subtracting: F_b − F_a = (K_b − K_a) + EnteredAbove_b − ExitedAbove_a. → (D) the decomposition identity

Equivalently in "places gained" form: PlacesGained = (K_a − K_b) + (ExitedAbove_a − EnteredAbove_b)

Interpretation of the three terms (verbatim-safe wording):

Term	Meaning (lower-number = better)
ΔF = F_b − F_a	change in India's position number in the full observed ranking for this indicator
ΔK = K_b − K_a	change in India's position within the economies observed in both years (like-for-like)
PoolEffect = EnteredAbove_b − ExitedAbove_a	how much the change in the observed set moved India's position number: +1 per economy that entered above India, −1 per economy that was above India in year a and left
Corollaries that must be asserted as invariants:

EnteredBelow_b and ExitedBelow_a contribute 0 to India's position change; they change only the denominator.
|Exited| = ExitedAbove_a + ExitedBelow_a + [IND ∈ Exited], |Entered| = EnteredAbove_b + EnteredBelow_b + [IND ∈ Entered].
All quantities are integers ⇒ the identity is exact, and no floating-point arithmetic is involved anywhere in the decomposition (floating point is used only inside the comparator, exactly as the existing engine does).
F_a, F_b must equal the ranks produced by the existing engine on the same inputs; K_a, K_b must equal rankByValue on the intersection filtered from the two years' rows.
7.2 Edge cases where (D) is undefined or needs special handling
Situation	Status of (D)
IND ∈ A and IND ∈ B	(D) valid; the normal case
IND ∈ A, IND ∉ B	F_b, K_b undefined ⇒ no decomposition. Permitted statements: India's last observed position F_a, that no valid observation is stored for year b, the full Entered/Exited sets, both denominators
IND ∉ A, IND ∈ B	mirror of the above
IND ∉ A ∪ B	no India comparison at all
Common = {IND}	K_a = K_b = 1 ⇒ ΔF = PoolEffect entirely
Ties involving IND or an entered/exited economy	(D) still valid iff "above" is position-based (≺_y), not value-based (§8.3)
Zero or negative values	Valid for level sets (they are rankable observations); excluded only from YoY sets via the previous > 0 rule
Non-finite / null	Cannot occur in S_y (ingest rejects; value NOT NULL; integrity checks E/F)
Duplicate ISO3 in a year	Cannot occur (PK; integrity check D)
Aggregate entity inside a set	Cannot occur (SQL filter + integrity check B) — if it ever did, the identity would still hold but the population definition would be violated, so the feature must fail closed
7.3 Empirical verification — LEVEL ranking (stored vintage, WB lastupdated 2026‑07‑13)
Computed with the project's exact comparator and 1-based ranks; ΔF, ΔK, Pool are as defined above; the last column is the integer identity check.

Metric	A	rank/total A	B	rank/total B	Common	Exited	Entered	K_a	K_b	ExAbove	EnAbove	ΔF	ΔK	Pool	Identity
nominal_current	2004	171/209	2014	172/213	208	1	5	171	168	0	4	+1	−3	+4	✅
nominal_current	2014	172/213	2024	155/200	200	13	0	162	155	10	0	−17	−7	−10	✅
nominal_current	1999	167/202	2025	144/186	184	18	2	151	142	16	2	−23	−9	−14	✅
nominal_constant	2004	173/203	2014	167/210	202	1	8	173	160	0	7	−6	−13	+7	✅
nominal_constant	2014	167/210	2024	148/199	199	11	0	158	148	9	0	−19	−10	−9	✅
ppp_current	2004	148/195	2014	146/199	192	3	7	146	141	2	5	−2	−5	+3	✅
ppp_current	2014	146/199	2024	133/195	195	4	0	143	133	3	0	−13	−10	−3	✅
ppp_constant	2004	154/193	2014	145/199	193	0	6	154	140	0	5	−9	−14	+5	✅
ppp_constant	2014	145/199	2024	133/195	195	4	0	142	133	3	0	−12	−9	−3	✅
nominal_constant	1999	169/197	2025	135/186	183	14	3	155	132	14	3	−34	−23	−11	✅
ppp_current	1999	153/192	2025	124/185	182	10	3	144	122	9	2	−29	−22	−7	✅
ppp_constant	1999	157/190	2025	124/185	182	8	3	149	122	8	2	−33	−27	−6	✅
(P1) K_a = F_a − ExAbove, (P2) K_b = F_b − EnAbove, and both partitions |A| = |Common| + |Exited|, |B| = |Common| + |Entered| also held in all 12 cases.

Why this matters for the brief's central worry. Row 1 is the exact rebuttal case: nominal_current 2004→2014 shows ΔF = +1 (India's position number rose by one) while the like-for-like movement is ΔK = −3 (three places better), because 4 economies entered the observed ranking above India. A naive "155 → 145 means ten places better" reading is wrong, and so is the reverse reading; only the decomposition distinguishes the two effects.

7.4 Empirical verification — YoY ranking (period A = yA−1→yA, period B = yB−1→yB)
Metric	Period A	rank/total A	Period B	rank/total B	Common	Exited	Entered	K_a	K_b	ExAbove	EnAbove	ΔF	ΔK	Pool	Identity
nominal_current	2003→2004	91/209	2013→2014	23/212	208	1	4	90	22	1	1	−68	−68	0	✅
nominal_current	2013→2014	23/212	2023→2024	78/200	200	12	0	20	78	3	0	+55	+58	−3	✅
ppp_current	2003→2004	46/195	2013→2014	96/199	192	3	7	45	92	1	4	+50	+47	+3	✅
ppp_current	2013→2014	96/199	2023→2024	14/195	195	4	0	94	14	2	0	−82	−80	−2	✅
nominal_constant	2003→2004	47/203	2013→2014	13/210	202	1	8	47	13	0	0	−34	−34	0	✅
nominal_constant	2013→2014	13/210	2023→2024	14/199	199	11	0	13	14	0	0	+1	+1	0	✅
ppp_constant	2003→2004	46/193	2013→2014	13/199	193	0	6	46	13	0	0	−33	−33	0	✅
ppp_constant	2013→2014	13/199	2023→2024	13/195	195	4	0	13	13	0	0	0	0	0	✅
The identity holds for YoY as well because the YoY comparator (yoyPercent DESC, ISO3 ASC) is row-local in exactly the same sense as the level comparator. Note the YoY denominators differ from the level denominators (e.g. nominal_current 2014: YoY 212 vs level 213 — one economy had no usable base-year value), which is precisely why the two universes must never be interchanged.

7.5 What the decomposition does not claim (must be encoded as text)
It does not say an economy "appeared", "was added", "was created", or "was removed from the world"; only that a valid observation is/is not stored for that indicator and year in the retrieved vintage.
It does not assign a cause to any entry/exit.
It does not claim India's welfare, policies, or economy improved/declined.
It does not say the observed-set change is "the reason India's rank changed" in a causal sense; it says the arithmetic effect of the observed-set change is PoolEffect places, given the fixed ranking definition.
It does not treat the common-set position as an official ranks; it is a derived counterfactual.
8. Tie-breaking and ordering analysis
8.1 What the code does today
compareByValueDesc(a,b): if a.value !== b.value return b.value − a.value; else compare a.iso3 / b.iso3 with < / >. rankByValue filters non-finite/blank-ISO3 rows, sorts with that comparator, and assigns index + 1. Consequences: ties are not shared ranks; positions are distinct and deterministic; the denominator counts only surviving rows.

8.2 Properties (verified by reasoning + tests + data)
The comparator defines a strict total order on any year's set (unique iso3, one row per economy-year) ⇒ the sort result is independent of input order and of sort stability.
Zero exact ties exist in the stored dataset (all 4 metrics × 27 years). Therefore any implementation that (incorrectly) ignored the ISO3 tie-break would produce identical output today and diverge only after a future revision introduces a tie — a latent, silent-failure class the architecture must exclude structurally.
b.value − a.value is a double subtraction; for the magnitudes present (≤ 2.9 × 10⁵) this is exact for distinct values. It is theoretically possible for two distinct doubles to subtract to exactly 0 only in extreme denormal cases that cannot occur for GDP-per-capita magnitudes; the recommendation is nonetheless to reuse the existing comparator rather than re-derive it, so any such quirk is inherited identically rather than diverging.
Tie-break is plain ascending string comparison on already-uppercased ISO3 (all 217 eligible ids are exactly 3 uppercase letters, verified) — not locale collation. Any new code that used localeCompare could theoretically order differently for exotic codes; forbid it.
8.3 Rule for "above/below India" (the single most error-prone point)
Classification must use the ranked order (indices/positions), never a value comparison. Example: if India and an entered economy have exactly equal values, the ISO3 order decides who is above; a value-based rule would classify the entered economy as "not above" and the identity would then be broken by exactly 1 place. Recommended implementation rule for reviewers: above ⟺ index_in_ranking < index_of_IND, evaluated on the ranking of the full year set (for EnteredAbove_b/ExitedAbove_a) and on the common-set ranking for ΔK.

8.4 Additional ordering constraints
ExitedAbove_a uses year-a values in the year-a set; EnteredAbove_b uses year-b values in the year-b set. Mixing (e.g. using year-b values for the exited economies) breaks (D) and must be impossible by construction (different functions/parameters).
K_a and K_b must be computed on the same Common membership with the two years' values — not on two different intersections.
YoY comparisons must use yoyPercent values (period-specific), never level values; and the pair validity rule must be the existing one (both years present, finite, previous > 0).
9. Level vs YoY universe analysis (kept strictly separate)
Aspect	LEVEL comparison	YoY comparison
Set definition	S_y = eligible economies with a stored valid observation for (indicator, y)	P_y = eligible economies with a valid YoY pair for period (y−1 → y): both years stored, both finite, previous > 0
Ordering key	value_y DESC, ISO3 ASC	yoyPercent_y DESC, ISO3 ASC
Ranked quantity	GDP per capita level	percentage change
Denominator	countEligibleObservations(indicator, y)	buildYoyRows(...).pairs = buildYoyCoverage(...).validYoyPairs
Entry/exit meaning	"entered/exited the observed level ranking for this indicator-year"	"entered/exited the observed YoY ranking for this period" (i.e. gained/lost a calculable change, which can also happen when the base-year value is missing or ≤ 0)
Comparison universe	Common = S_a ∩ S_b	Common_yoy = P_A ∩ P_B, where A and B are periods, not years
Existing implementation to reuse	getEligibleObservations + rankByValue	buildYoyRows + rankByYoy (already used by /api/yoy-ranking[/verify])
Observable sample sizes (real data)	186–214	193–212
Verified behavioural difference	identical-year sets coincide by construction	nominal_current 2014: level 213 vs YoY 212; ppp_* sets differ too
Confirmed against the implementation: the YoY comparison universe must be P_A ∩ P_B (built by buildYoyRows, whose validity rules are exactly those above); the level universe must not be reused. My verified YoY runs in §7.4 used exactly this definition.

Interpretation warning that must be visible in the UI: YoY ranks order annual growth rates, which are volatile and can reorder dramatically between adjacent periods (verified example: nominal_current India's YoY rank 91 → 23 → 78 across three decade-ends). A change in YoY rank is not a change in level position, and a decade-apart comparison of growth-rate ranks is only meaningful with that caveat displayed.

10. Data-integrity risks (each mapped to existing and proposed safeguards)
#	Risk	Existing safeguard	New safeguard required
1	Different denominators compared naively	Both denominators returned everywhere; denominatorMeaning text; coverage panels	Always return & display both denominators + Common size; the decomposition must be shown with all three
2	Mixing indicators	Single indicator parameter; unknown keys throw; describeMetric echoed	New endpoints require an explicit indicator (no implicit default), and echo the metric + unit in every block
3	Missing values	Not stored at all; documented "absence = no stored observation"	Sets derived only from stored rows; reason codes name the condition
4	Zero values	Valid for level ranking (fixtures prove it); invalid as a YoY base	Set membership rules reused from existing modules; tests must include zeros
5	Non-positive YoY base	computeYoy/buildYoyRows exclude with reason	YoY universe reuse (never re-implement the rule)
6	Aggregate entities	is_aggregate + SQL filter + integrity check B	Self-check that every set member joins to is_aggregate = 0
7	Duplicate ISO3 observations	PK + integrity check D (0 duplicates verified)	Self-check: set sizes equal distinct-member counts
8	Metadata mismatch (observation without metadata)	FK + integrity check C/J	Self-check that every listed economy resolves in countries
9	Country identity/code changes	None (upserts overwrite; only per-run eligibleIds snapshots)	Not solvable now — disclose as "not established"; never infer a code change (§25)
10	Ties	ISO3 tie-break; fixtures test it	Position-based above/below classification + explicit tie marker in the UI
11	ISO3 tie-break drift	One comparator in domain/ranking.js	New code must import it; a cross-check test must compare new output against existing engine output
12	India missing in one year	Existing services return available:false + reason	Explicit "decomposition undefined" state and reason codes; never a partial decomposition
13	Different World Bank vintages	wb_last_updated per row + per run; lastupdated in audit panel	Detect mixed vintages across the rows used (all rows currently 2026‑07‑13) and mark the comparison "mixed vintage" if not
14	Stale cached data	TTL, freshness, lock state, manual refresh	Response carries retrieval time, freshness, and last-run status
15	Inconsistent snapshots between two requests (e.g. refresh completes mid-session)	None exposed to clients	Compute both years in a single request from one read; return a dataset fingerprint so the UI can detect a change between requests
16	Incomplete pagination	Client throws on incomplete pagination; completeness recorded per indicator	Echo recorded completeness (declaredTotal/pagesFetched) in the evidence block
17	Ranking-order mismatch between services	Single engine today	A test that the new full ranks equal buildFullRanking/buildRankVerification ranks for the same (metric, year)
18	Frontend recalculation	Frontend does none today	Contract rule: the equation, deltas, and sign semantics arrive as data; the frontend formats only
19	Rounding before comparison	All comparisons use REAL; display is a separate field	Same for new code; explicitly forbid toFixed/rounding inside the new domain module
20	Comparing rounded/displayed values	rawValueText shown in verification views	Per-economy detail must show the raw text and raw numeric; never derive above/below from a display string
21	Country counts treated as geopolitical totals	denominatorMeaning text; README; UI footnotes	Fixed vocabulary ("eligible economies with a valid observation for this indicator and year") in all new labels
22	Availability confused with entry/exit	FORBIDDEN_CAUSE_PHRASES + containsInventedCause test	Extend the forbidden-phrase guard to the new generated sentences and tests
23	Level universe used for YoY	Separate engines/endpoints	Separate endpoints and separate set builders; a test asserting the YoY universe is not the level universe
24	Accidentally mixing metrics	Separate rankings per metric; no cross-metric arithmetic	One metric per comparison response; no aggregate/composite score anywhere
25	Comparing periods across inconsistent vintages	Vintage recorded per row/run	Fingerprint + per-year producing-run ids + "mixed vintage" flag
11. World Bank research findings (categories kept strictly separate)
(1) What the project's code does — as documented throughout §3–§5. Notably: ranks are application-derived; the app states this in SOURCE_INFO.rankWording / rankDisclaimer and repeats it in methodologyBlock() on every response; the World Bank API rows it ingests contain no rank field (payload fields are indicator, country, countryiso3code, date, value, unit, obs_status, decimal — corroborated by the fixture's trimming list and by the API documentation).

(2) What World Bank documentation says (retrieved during this audit):

Indicator identity/units. NY.GDP.PCAP.CD = "GDP per capita (current US$)"; NY.GDP.PCAP.PP.KD = "GDP per capita, PPP (constant 2021 international $)", whose source note states the series "is expressed in constant prices … The reference year for this adjustment is 2021" and that PPPs are "a currency conversion factor and a spatial price deflator"; source organizations are ICP/Eurostat/OECD/IMF/WB staff estimates. This corroborates the project's decision to treat the four series as independent and never to derive constant series from current series (spec §28).
Aggregates and income groups. The World Bank's own country metadata marks aggregates with region.id = "NA" / region.value = "Aggregates" (verified in the stored DB for all 78 aggregate ids, e.g. AFE, ARB, WLD), and the API returns income-group rows whose countryiso3code is empty (XD High income, XM Low income, XN Lower middle income, XT Upper middle income, XY Not classified). The project's blank-ISO3 rule is therefore required for a country-level ranking, exactly as documented in domain/universe.js.
Missing data. The World Bank Data Help Desk ("Why are some data not available?") states that data may be missing because some indicators come from sporadic surveys, because a series only starts in a later year, because some countries do not report regularly ("conflict, lack of statistical capacity, or other reasons"), because some countries did not exist in earlier years, and because coverage generally focuses on countries with population ≥ 30,000 or World Bank membership. These are general statements about WDI as a whole — not per-economy-year facts. They may be quoted as source context, never applied as the cause of a specific missing observation.
Revisions/vintages. WDI is updated on a quarterly cycle with published release notes ("WDI Quarterly Update"); the July 2026 release note (the vintage the app ingested, lastupdated 2026‑07‑13) describes national-accounts/population updates, new indicators, and PPP benchmark-year handling. WDI history includes explicit errata (e.g. previously published values removed when found misleading). Consequence: any stored rank is vintage-specific, and cross-vintage rank comparison is not possible from this database (only the latest upsert is retained).
Published rankings (important nuance). The World Bank publishes a Data Catalog dataset titled "GDP ranking" (version 13, last updated 15 Jul 2026, annual, "Gross domestic product ranking table", CC‑BY 4.0). So the statement "the World Bank publishes no ranking at all" would be too strong; the accurate statement is: the World Bank's indicator API publishes no rank, and this application's per-capita ranks are its own calculation. If the new section wants to reference "the World Bank publishes a GDP ranking table", it must be precise about what is ranked (total GDP, an annual table) and must not imply the app's per-capita ranks come from it.
Statistics on the stored data corroborating the null-row behaviour: the captured API snapshot contains, for nominal_current, 265 rows per year of which ~5 are blank-ISO3 income groups, 43 are aggregates, and the remainder are eligible economies of which 5–18 carry value: null per year. Every entered/exited economy in the examined pairs corresponds to such a null-valued row (2004↔2014 and 2014↔2024, all four indicators; e.g. ERI exited into a null row in 2014; CYM, XKX, SXM, SSD, MAF entered out of null rows in 2004; 2014→2024 exits ASM, CHI, CUB, GRL, GUM, IMN, MNP, SMR, SSD, MAF, SYR, VIR, YEM all null in 2024) — no case of "no API row at all" and no case of metadata-driven exclusion was found.
(3) What is mathematically derived (not sourced, not documented by the World Bank): everything in §6–§9 — the sets, the ordering restriction lemma, the identity (D), the partial identities (P1)/(P2), the pool/common split, and the denominator arithmetic. These follow from the project's own ranking definition and are provable; they are not World Bank method.

(4) Architectural recommendations (judgement, not fact): §13–§19.

12. Capability matrix
Legend: AD = available directly · DED = derivable from existing data · DNT = derivable but requires new query/transformation · NCA = not currently available · UNSAFE = unsafe/ambiguous to assert · DMCH = requires data-model change.

#	Required output	Class	Why
1	India full observed rank, level, year A	AD	Already produced by rankByValue(getEligibleObservations(...)); exposed by /api/ranking/verify (focus.rank) and /api/india/gdp-ranking
2	India full observed rank, level, year B	AD	Same code path, second year
3	Set A / Set B (ISO3 + value + raw + name)	DED	getEligibleObservations already returns exactly this for one (indicator, year)
4	Common set	DNT	Needs set intersection in a new pure function (no SQL change)
5	Exited set / Entered set	DNT	Set difference, same as above
6	India's position within the common set, A and B	DNT	Requires ranking the intersection twice (existing rankByValue, new orchestration)
7	Entered/Exited above India, entered/exited below India	DNT	Requires position indices from the two rankings; must be position-based, not value-based (§8.3)
8	Common effect, pool effect, total movement	DNT	Integer arithmetic on (6)/(7) + both full ranks
9	Denominators (	A	,
10	Per-economy rank in each year (detail panel)	DED	Positions come from the same ranking objects already computed
11	Per-economy value, raw decimal string, display string	AD	value, valueRaw, formatValue
12	Economy name	AD	Returned by getEligibleObservations (c.name)
13	Region / income level / lending type per economy	DED (new accessor)	Stored in countries; getCountry exists for one row, listEligibleCountries for all; /api/countries exposes only a subset
14	Per-year producing fetch-run id and vintage	DED	getLatestIngestYearStat(db, metric, year).fetch_run_id; observations.wb_last_updated
15	Dataset fingerprint (retrieval generation, staleness)	DED (small new helper)	getLastSuccessfulFetchTime, countObservations, MAX(fetched_at), getCacheStatus
16	Aggregate-level reason facts for a denominator change	AD	explainTotalChange (CASE A/B/C/D) + ingest_year_stats counters, already surfaced by /api/coverage
17	Metadata-universe added/removed entities	AD (conditional)	buildMetadataChange + universe_snapshot; only meaningful across different runs and only when both snapshots exist. In the current dataset all compared years come from one run ⇒ "comparable, unchanged"
18	Per-economy cause of a missing observation (no row vs. null row)	NCA / UNSAFE	Only per-year counts of null rows are stored; the identities are discarded after ingestion. Any per-economy claim would be invented
19	Historical metadata universe "as of" a historical year	NCA	WB metadata is a current snapshot; the app stores per-run snapshots only
20	Historical income classification for a historical year	NCA / UNSAFE	Only the current vintage's income_level is stored; presenting it as "in 2004" would be wrong
21	Country-code/identity change history	NCA	Upserts overwrite; no history table. Also no way to detect a WB code reassignment from stored data
22	YoY comparison universe and YoY ranks	DNT	buildYoyRows + rankByYoy exist; needs period-pair orchestration and its own sets
23	YoY valid-pair denominators & availability reasons	AD	buildYoyCoverage (already exposed via /api/coverage?year=…)
24	Self-verification of the decomposition (invariants)	NCA	New: must be implemented and fail closed
25	Multi-year (decade-to-decade) movement sequences	DED	Compose pairwise comparisons; no new backend capability needed (and no new data model)
26	Confidence/uncertainty statements ("reason not established")	DED	Compose from existing counters/snapshot evidence + the WB documentation context
Conclusion: 2 of the 26 outputs are genuinely unavailable and must be represented as explicit unknowns; the rest are already in the data or are pure derivations. No schema change is required.

13. Proposed new analytical architecture (additive layer only)

World Bank raw data (SQLite, single vintage generation)
   → existing trusted domain logic (universe rule, comparator, rankers, YoY pair rule)
   → NEW: comparison domain module (pure):  set algebra, position-based above/below,
                                            decomposition, invariant verifier
   → NEW: comparison service:  reads two years (single read), reuses coverage explanation,
                               vintage fingerprint, assembles the response, fails closed
   → NEW: two read-only API endpoints (level comparison; YoY comparison) + methodology text
   → NEW: frontend analytical view (display + formatting only; no arithmetic)
13.1 Domain model (conceptual)
ComparisonRequest — { indicator, yearA, yearB, mode ∈ {level, yoy}, focusIso3, detailLevel }.
ComparisonUniverse — { setIdA, setIdB, setCommon, setExited, setEntered, counts{...}, membershipSource }.
RankedYear — { year, rows: [{iso3, name, value, valueRaw, position, rank}], denominator } (positions and ranks from the existing engine only).
FocusMovement — { fullRankA, fullRankB, commonRankA, commonRankB, exitedAboveA, exitedBelowA, enteredAboveB, enteredBelowB, totalMovement, commonEffect, poolEffect, signConvention }.
EconomyMovement — per economy: { iso3, name, region, incomeLevel, status ∈ {common, entered, exited}, relationToFocus ∈ {above, below, focus}, valueA, valueB, rawTextA/B, rankA, rankB, rankWithinStatus, tiedWithFocus }.
EvidenceBlock — { vintage{...}, fingerprint{...}, perYearCounters{...}, metadataUniverseComparison{...}, completeness{...} }.
VerificationReport — { passed, checks: [{check, status, detail}] } — reusing the existing integrity.js report shape so it reads consistently in the audit UI.
13.2 Comparison service responsibilities
Resolve metric/indicator (explicit; no silent default) and validate the two years against stored data (listYearsWithData per metric).
Read both years' eligible rows in one repository read (range call, or a new precise year-pair read).
Build the level sets and (in YoY mode) the YoY pair sets using the existing domain functions.
Rank the full sets and the common set with the existing engine.
Compute the decomposition; classify entered/exited economies by position.
Run the invariant verifier (§19.1); on failure, throw a coded error (fail closed).
Attach vintage/fingerprint/evidence; attach the "reason not established" statements where applicable.
Emit the attribution + methodology blocks.
13.3 Required queries
Reuse: getIndicatorByMetricKey, getEligibleObservationsRange (one statement covering both years; also used for YoY base years), getYearRange, listYearsWithData, getLatestIngestYearStat, getUniverseSnapshotByRun, countEligibleCountries, listEligibleCountries/getCountry.
Recommended additions (small, additive):
a year-pair (or small year-list) eligible-observation read that returns year alongside iso3/value/valueRaw/name — guarantees a single atomic snapshot and avoids over-reading wide ranges;
a bulk economy-metadata read for a supplied ISO3 list (region/income/lending) to avoid N single lookups.
Not needed: any write, any new table, any migration.
13.4 Architectural constraints that make the identity provable (must be treated as invariants of the codebase)
Exactly one comparator implementation (domain/ranking.compareByValueDesc) and one YoY comparator; the new module must import, never re-implement.
Comparators must stay row-local (keys (value, iso3) / (yoyPercent, iso3)). Any future "normalize against the set" idea invalidates the restriction lemma and therefore the whole decomposition — this must be recorded in the code comments of the new module.
Above/below classification is position-based.
Both years are read in one statement (or one transaction) and ranked from that same read.
The new endpoints return the decomposition as data, never as frontend-computed text.
14. Proposed domain/service boundaries
Layer	New artefact	Existing analogues to mirror	Must/must-not
Domain (pure, no I/O)	domain/comparison.js — set algebra, position-based above/below, decomposition, invariant checks	domain/ranking.js, domain/coverage.js, domain/yoyRanking.js	Must import the existing comparator and ranker; must not contain SQL, fetching, formatting-for-display, or rounding
Service (orchestration)	services/comparisonService.js — builds the response for level and YoY modes; reuses coverageService.explainTotalChange, buildMetadataChange, and a new services/vintage.js	services/rankVerification.js, services/yoyVerification.js, services/coverageService.js	Must fail closed if invariants fail; must not modify other services
Repository	optional getEligibleObservationsForYears, getCountriesByIso3List	repository.js conventions (all SQL here)	Must not change existing queries' semantics
HTTP	two routes (level comparison, YoY comparison) + error mapping + method block	server.js route style, AUTO_REFRESH_PATHS, httpError	Must not alter existing routes' payloads
Frontend	new view + components; new api methods; URL params	sections/*, components/ui.jsx, hooks/useApi.js	Must not import/alter existing section components; must not compute
Naming note (deliberately deferred): the brief defers section naming, so this report uses functional names only ("rank-movement comparison", "common comparison set", "observed-set effect"). The final UI labels must be agreed with the user; the API names should be functional and unambiguous.

15. Proposed API / data contract (conceptual, not implementation code)
Endpoints (recommended):


GET /api/comparison/level?indicator=<metricKey>&yearA=<int>&yearB=<int>&country=IND[&detail=summary|full]
GET /api/comparison/yoy?indicator=<metricKey>&yearA=<int>&yearB=<int>&country=IND[&detail=summary|full]
      where for the YoY form yearA/yearB denote the period END years (period = year−1 → year),
      and the response states the derived period explicitly.
Both are read-only GETs and should join the existing AUTO_REFRESH_PATHS set so TTL behaviour is consistent.

Response structure (field tree; every field must be sourced or omitted):


comparison
  available: boolean
  reason: null | 'metric_not_ingested' | 'no_stored_observations_for_metric_and_year'
          | 'focus_missing_in_yearA' | 'focus_missing_in_yearB' | 'focus_missing_in_both_years'
          | 'same_year_selected' | 'not_a_valid_yoy_period'
  mode: 'level' | 'yoy'
  metric: { key, indicatorCode, label, shortLabel, unit, unitLong, group, priceBasis, worldBankPage }
  focus: { iso3, name }
  years: { a, b, order: 'a_is_earlier'|'a_is_later', yoyPeriods: {a:{from,to}, b:{from,to}} | null }
  universe
    setIdA, setIdB, setCommon, setExited, setEntered:  counts (integers)
    membershipRule: string   // exact words describing the set definition used (level vs YoY)
  focusMovement
    fullRankA, fullRankB, commonRankA, commonRankB: integers | null
    denominatorA, denominatorB, denominatorCommon: integers | null
    exitedAboveA, exitedBelowA, enteredAboveB, enteredBelowB: integers | null
    totalMovement, commonEffect, poolEffect: integers | null
    placesGained: integer | null                  // = −totalMovement, provided for presentation
    signConvention: { positionNumbers: 'lower_is_better',
                      totalMovement: 'positive_means_position_number_increased',
                      placesGained: 'positive_means_moved_up' }
    identityText: string                          // the equation with this response's integers, server-generated
  economies
    counts: { total: n, aboveFocus: n, belowFocus: n, tiedWithFocus: n }
    rows: [ { iso3, name, region, regionId, incomeLevel, lendingType,
              status: 'common'|'entered'|'exited',
              relationToFocus: 'above'|'below'|'focus',
              valueA, valueB, rawTextA, rawTextB, displayA, displayB,
              rankA, rankB, positionInStatusList: n, tiedWithFocus: boolean,
              affectsFocusPosition: boolean           // true only for entered/exited-above
            } ]   // unpaginated but capped; if capped: { truncated: true, totalRows: n }
  denominatorExplanation                                // reuse of explainTotalChange output for (metric, yearA, yearB)
    case: 'A'|'B'|'C'|'D'|'NONE', caseMeaning, statement, facts, warnings
  evidence
    vintage: { wbLastUpdated, retrieval: { lastSuccessAt, runId, fetchedAtMin, fetchedAtMax },
               freshness: { fresh, ageHours, ttlHours, refreshDue, lastRunStatus } }
    perYear: { a: { fetchRunId, indicatorCode, rowsReceived, rowsWithValue, rowsWritten,
                    rowsNullSkipped, rowsAggregateExcluded, rowsBlankIso3Skipped, rowsUnknownCountry },
               b: { ... } }
    metadataUniverseComparison: { comparable, changed, added[], removed[], fromRunId, toRunId }
    completeness: { a: {declaredTotal, pagesFetched, requests, status}, b: { ... } }
    fingerprint: { lastSuccessAt, maxFetchedAt, observationCount, runId }   // for cross-request consistency
    limits: [ strings describing what is NOT established from stored evidence ]
  verification
    passed: boolean
    checks: [ { check: 'set_partition_A', status: 'pass'|'fail', detail: {...} }, ... ]   // integrity.js shape
  source: { provider, dataset, apiDocumentation, wording, disclaimer, focusCountry, apiBaseUrl }
  methodology: <existing methodologyBlock> + comparison-specific method statements for THIS endpoint only
Contract rules (enforced):

Every rank/count is an integer or null; null is always accompanied by a machine-readable reason.
No field may be derived on the client. identityText, signConvention, and all deltas are server-produced.
Both denominators and the common-set size are mandatory fields (never optional in practice) — they are interpretation-critical.
rawText* (canonical decimal strings) accompany numeric values so verification never doubles as rounding.
verification.passed must be true for a 200 response; a failed invariant produces an error response, not a partially-correct body.
The response is self-describing about its population ("eligible economies with a valid observation for this indicator and year in the retrieved vintage") and about vintage.
Error states: 400 for missing/unknown indicator, invalid or equal years, invalid YoY period; 404-equivalent available:false bodies for missing data; 500 with code COMPARISON_INVARIANT_FAILED for self-check failure; existing 409 semantics untouched.

16. Proposed information architecture (questions in the required order)
#	User question	Placement	Disclosure level
1	What happened to India's position?	Summary card at the top: yearA rank/total → yearB rank/total, "position number changed by ±Δ", "places gained/lost", both denominators, metric+unit, vintage line	always visible
2	Is the movement comparable across the same economies?	Like-for-like panel: common-set size (of A: x, of B: y), India's position within it in each year, common effect	always visible
3	How large was the common comparison universe?	Same panel + a compact universe table: Set A / Set B / Common / Exited / Entered counts	always visible
4	Which economies entered/exited the observed ranking?	Two lists (tabs or side-by-side): entered (year B) and exited (year A), each row: name, ISO3, region, position that year, relation to India, value (display; raw on demand)	collapsed by default, counts visible
5	How did that affect India's full rank?	Rank-movement decomposition card: the identity rendered with this response's integers, with an explicit sign legend and "what this does not say" line	always visible
6	Which specific economies caused that effect?	Filtered sublists inside #4: "entered above India" / "exited above India" (highlighted); a note that entered/exited-below economies changed the denominator but not India's position	one click / default filter option
7	What evidence supports the classification?	Evidence panel (<details> styled like the existing DataStatus details): producing run ids, per-year counters, metadata-universe comparison or "not comparable", completeness, fingerprint, and the explicit "not established from stored evidence" list	collapsed by default, one summary line visible
8	What are the underlying values/ranks?	Per-economy detail (inline expansion or drawer): raw numeric, canonical raw string, display string, rank in each year, unit, indicator code, link to the existing Rank verification view for that year/metric	fully collapsed by default
Always visible (interpretation-critical, per the brief): both denominators; common-set size; number of above-India entries/exits; vintage/retrieval date; the "observation availability ≠ geopolitical existence" statement; the sign legend; the metric/unit; the statement that the common-set position is a derived comparison position, not an official rank.

Searchable/filterable: the entered/exited lists (by name/ISO3, by region, by relation to India, by "affects India's position"). Never render the full 200-economy common set by default; offer it only behind an explicit "show all common economies" action with the existing pagination pattern if needed.

Explicitly avoided: composite scores, colour-only meaning, "improved/declined" prose, any statement that an economy "was added/removed", any implied cause, any chart that mixes the four indicators.

17. Proposed country-detail architecture
Fields to expose per economy (all verified available except where flagged):

name, ISO3 (from countries/observation join) — available;
region, regionId, adminRegion — available (current vintage; label as "current metadata vintage");
income level, lending type — available but must be labelled "World Bank classification in the retrieved metadata vintage", because the app does not store historical classifications;
selected indicator + unit — available;
value in year A / year B (numeric + raw string + display string) — available;
rank/position in each year, plus position within the entered/exited list — available;
relation to India (above/below/focus) and affectsFocusPosition (only entered/exited-above) — derived;
status: common / entered / exited — derived;
tiedWithFocus marker with an explanation of the ISO3 tie-break — derived (defensive; no ties exist in the current vintage);
reason classification — only where evidence supports it: permitted statements are (i) "no valid observation is stored for this economy for this indicator and year in the retrieved vintage", (ii) aggregate-level: "the World Bank response recorded for this indicator-year contained N rows without a usable value" (from ingest_year_stats), (iii) source documentation context from the Data Help Desk, explicitly labelled as general World Bank guidance and not as the cause for this economy-year. Anything else must render as "reason not established from the stored evidence".
Progressive disclosure: summary → key comparison → decomposition → expandable lists → per-economy detail → raw/evidence panel. This mirrors the existing <details> + .facts + .table vocabulary so no new visual language is introduced.

18. Edge-case rules (behaviour must be defined, never implied)
Case	Required behaviour
India missing in year A only	available:false, reason:'focus_missing_in_yearA'; still return Set A/B sizes, entered/exited lists, denominators, and India's rank in year B; no decomposition fields (null)
India missing in year B only	mirror image
India missing in both	available:false, reason:'focus_missing_in_both_years'; return universe counts only
India present in both	decomposition valid; all invariants asserted
Common set = {IND}	commonRankA = commonRankB = 1; movement attributed entirely to the pool effect; a note that no other economy is comparable
No entered economies / no exited economies	Empty lists rendered with an explicit "none" (never hidden); pool effect computed with 0
Very small common set (< 10)	Warning line with the raw counts; never express the movement as a percentage
One year with dramatically fewer observations (2025 is 186 vs 200 in 2024 for nominal_current)	Pool effect will be strongly negative; the UI must label it as an observed-set contraction, not an achievement
Zero-valued observations	Valid set members (level); excluded from YoY sets when they are the base year; never treated as missing
Exact ties (incl. economy tied with India)	Classification by position; tiedWithFocus shown; the tie-break rule stated in-context
Non-positive YoY base	Economy excluded from the YoY universe with the existing reason code surfaced
Same year selected twice	400 SAME_YEAR_SELECTED
Year with no stored observations for the metric	available:false, reason:'no_stored_observations_for_metric_and_year'
Metric not ingested	available:false, reason:'metric_not_ingested'
YoY period where either year lacks the pair base	reason:'not_a_valid_yoy_period'; level mode unaffected
Different metric coverage across the two years	Normal; each metric computed independently; never reuse another metric's sets
Mixed vintages detected across the rows used	Comparison still returned but flagged mixed_vintage with the distinct lastupdated values; a warning is mandatory
Stale cache / failed last refresh	Vintage + freshness + last-run status in evidence; a visible staleness/last-failure note
Invariant check failure	Fail closed: error response with code COMPARISON_INVARIANT_FAILED, no numbers shown
Duplicate/malformed stored rows (should be impossible)	Covered by existing integrity checks A–D/J; the new verifier also rejects duplicates within a set
Aggregate entity inside a set (should be impossible)	Verifier rejects; response fails closed; the existing integrity endpoint already reports check B
19. Validation / test architecture (designed before implementation)
19.1 Server-side invariant verifier (runs inside the service; fail closed)
setPartitionA: |SetA| = |Common| + |Exited|; setPartitionB: |SetB| = |Common| + |Entered|.
disjointAndUnique: Common ∩ Exited = ∅, Common ∩ Entered = ∅, Exited ∩ Entered = ∅; every set has unique ISO3; set sizes equal distinct-member counts.
membershipInStorage: every member resolves to a stored observation row for that (indicator, year) and to a non-aggregate countries row.
fullRankMatchesEngine: F_a, F_b equal the ranks produced by the existing engine for those (indicator, year) rankings (independent recomputation, same code path used by the current services).
partialIdentityA/B: commonRankA = fullRankA − exitedAboveA; commonRankB = fullRankB − enteredAboveB.
decompositionReconciles: totalMovement = commonEffect + poolEffect (exact integer equality).
aboveBelowReconcile: exitedAbove + exitedBelow + (focusInExited ? 1 : 0) = |Exited|, and the same for entered.
rangeAndTypeChecks: every count ≥ 0 and integral; every rank within [1, denominator].
noRoundedInputs: assert that no display string or formatted value participated (structural: the domain module receives only numeric/rawText values).
Report as {check, status, detail}[] (existing integrity-report shape).
19.2 Test layers (all with node:test + assert/strict, no new dependencies)
Unit (pure domain) — synthetic fixtures in the style of test/fixtures/edgeCases.js: ties (including a tie with the focus economy), focus absent from A, absent from B, absent from both, one-element common set, empty entered/exited, zero values, YoY base zero/negative, duplicate-free guarantee.
Invariant sweep over the real snapshot — build an in-memory DB from test/fixtures/wb-snapshot.json (existing helper style in test/helpers/testDb.js), then for every metric and every ordered pair of years assert every invariant in §19.1. (~4 × 378 pairs ≈ 1.5 k cases; fast, deterministic, and it is the strongest available proof that the decomposition is exact for the project's real data.)
Cross-check against the existing services — for the same (metric, year): new service's full ranks must equal buildFullRanking(...).rows[].rank and buildRankVerification(...).focus.rank; YoY ranks must equal buildFullYoyRanking(...)/buildYoyVerification(...) ranks; the new denominator must equal countEligibleObservations / validYoyPairs. This is the "no comparator drift" guarantee.
Fixture-frozen regression — freeze the decomposition output for a small set of real cases (e.g. nominal_current 2004→2014 and 2014→2024, all four metrics) as explicit expected integers, with a documented procedure: when snapshot:create regenerates the fixture, expectations are updated deliberately (never silently).
API-level — follow test/server.test.js (app on an ephemeral port against a seeded in-memory DB, autoRefresh:false): valid requests, each error state (missing indicator, equal years, unknown indicator, year without data, YoY invalid period), and the presence of verification.passed === true, source, and methodology.
Property-style (deterministic, no new deps) — a seeded LCG generating random synthetic universes (random presence, random values including forced ties and equal-to-focus values); assert the invariants for ≥ 1 000 cases, and compare against an independent oracle implementation (a deliberately different formulation, e.g. ranking via a sort key string) to catch self-consistent-but-wrong logic.
Negative tests — assert the forbidden vocabulary never appears (extend the existing FORBIDDEN_CAUSE_PHRASES/containsInventedCause pattern to the new generated sentences) and that no new endpoint can emit a decomposition with a null side.
Frontend — npm run lint + npm run build, plus a documented manual/headless verification checklist against the running backend (the repo's current frontend practice): the displayed equation integers must equal the API's; list counts must equal the API's; both denominators visible; vintage line present.
Opt-in live probe — keep live checks out of the default suite (existing test/_probe/real.test.js precedent + npm run audit:live), because the stored vintage may be revised.
20. What can be reused unchanged
All of domain/universe.js (aggregate rule, rejection reasons, describeUniverseRule).
All of domain/ranking.js (comparator, rankByValue, rankAndLocate, neighborWindow, paginate, searchRanked, describeRankChange — the last is currently unused by services but is a natural fit for movement phrasing).
All of domain/yoy.js, domain/yoyRanking.js (pair validity, YoY ordering).
All of domain/coverage.js + services/coverageService.js (CASE A–D explanation, metadata-universe diff, YoY coverage).
All repository reads needed as inputs; services/integrity.js report format; services/attribution.js; domain/format.js; config.js metric definitions; the whole ingestion/client layer; the refresh/TTL/lock machinery; the existing routes and their payload shapes; the whole frontend shell, sections, hooks, components and CSS vocabulary.
21. What requires new backend capability
New pure comparison domain module (set algebra, position-based classification, decomposition, verifier).
New comparison service (level + YoY orchestration, evidence assembly, fail-closed behaviour).
New vintage/fingerprint helper (retrieval generation + mixed-vintage detection).
Optionally two small repository reads (atomic year-pair eligible rows; bulk economy metadata).
Two new read-only routes (+ AUTO_REFRESH_PATHS entry) and comparison-specific methodology text (attached only to the new endpoints, so existing responses stay unchanged).
New tests (domain, invariant sweep, cross-checks, API, regression) and a documented fixture-refresh procedure.
Not required: schema change, migration, new table, new dependency, modification of any existing service or route.
22. What requires new frontend capability
New top-level analytical view (separate from Overview/Data/Rank/YoY/Coverage/Audit/Status), with its own local control panel (indicator, Year A, Year B, mode), its own sub-tabs, and its own URL parameters for deep-linking.
New components: movement summary, like-for-like/common-set panel, decomposition equation card with sign legend, universe table, entered/exited lists with search + filters, per-economy detail expansion, evidence panel, uncertainty/limits banner, empty/error states.
New api client methods (two endpoints) and reuse of useApi for abort/stale protection.
Accessibility: the equation must have a readable text equivalent (aria-label with the sentence), tables need captions, direction must not be colour-only, and expandable detail must use the existing <details> pattern.
Additive CSS only (a few classes for the equation and delta signs), reusing .cards, .facts, .table, .details, .explanation, .warnings, .footnote, .mono, .num, .row-focus, .focus-tag.
23. What should NOT be changed in the existing section (frozen)
The four indicator codes/units/config and the "independent series" rule.
The universe rule and its reason codes; the ingest rejection precedence; the "missing is never zero" rule.
compareByValueDesc / rankByValue semantics (distinct ordinal positions, ISO3 tie-break) and the YoY validity rules.
Every existing endpoint's URL, query parameters, response fields, and methodologyBlock() content.
The existing tabs/sections/UX, the global filter bar, and the URL parameter set (additive, non-breaking additions only).
The DB schema, integrity checks, refresh/lock/TTL behaviour, and the audit trail tables' append-only intent.
The "calculated by this application" wording; no new surface may imply a World Bank-published rank.
24. Recommended implementation sequence (still no code)
Phase	Content	Exit criteria
P0 — Freeze vocabulary & contract	Agree terminology, sign convention, denominator wording, "not established" phrases; freeze the response field tree and error codes	Written glossary + contract review; no code
P1 — Pure domain	domain/comparison.js + unit tests incl. ties, missing focus, empty sets, zero values	All unit tests pass; module imports the existing comparator (no duplicate ordering logic)
P2 — Service + verifier	services/comparisonService.js, services/vintage.js, invariant verifier; invariant sweep + cross-checks against existing services	Sweep over the whole snapshot passes; cross-check equality with existing ranks holds; verifier fails closed on injected faults
P3 — API	Two routes, validation, error mapping, comparison methodology text, AUTO_REFRESH_PATHS; API-level tests	Contract tests pass; existing endpoint payload tests still pass unchanged
P4 — Frontend (level mode only)	New view + components + URL state + api methods; lint + build; headless verification against the running backend	Displayed integers equal API integers on every screen; both denominators visible; vintage line present; no arithmetic in the frontend
P5 — Documentation	README section (method, terminology, provenance, limits), audit-panel entries	A reviewer can reproduce a decomposition by hand from the API response alone
P6 — YoY mode	Same architecture with its own universe/validity rules and its own volatility warning	Separate sets proven ≠ level sets; invariants pass for YoY too
P7 — Optional, separate decision	Per-entity "no usable value" evidence (requires ingest + schema change and only applies to future ingests)	Explicit product decision; must not be smuggled into P1–P6
25. Open questions / unresolved evidence
Example numbers in the brief are not reproducible (2004 = 155/209, 2014 = 145/200). Confirm whether these came from an older vintage or a different indicator; the design must use stored-vintage numbers only.
Reason attribution — do you want the aggregate-level fact ("the response for this indicator-year contained N rows without a usable value") surfaced as evidence, even though per-economy attribution is impossible today? (Recommended: yes, as aggregate evidence with explicit limits.)
Optional data-model enhancement — should a future ingest store the identities of entity-years returned without a usable value (new column/table, prospective only, contradicts the current "absence = no stored observation" invariant if done carelessly)? This is the only way to ever state per-economy evidence. Recommend deferring.
Historical metadata — is it acceptable that region/income/lending are shown as "current metadata vintage" rather than as of the compared years? (Any alternative requires storing metadata history from now on.)
Direction/sign presentation — one canonical convention (position number change, positive = worse) is recommended; confirm you don't want places gained as the primary number.
Scope of v1 — level comparison only (recommended), or level + YoY together? And should "four metrics at a glance" be a summary strip (each metric's own numbers, no arithmetic) or omitted entirely in v1?
Comparison year selection — derived from stored years per metric (recommended), with optional convenience presets (e.g. "a decade") computed from data rather than hardcoded?
Audit-trail anomaly — fetch_runs contains ids 1 and 4–14 (ids 2–3 absent) and a failed run's row is not present; is that expected from development-time database resets? The new evidence panel will display run ids, so gaps should be understood.
Direct relationship between this section and the existing "Coverage → why does the total change?" panel — should the new section embed the same explanation (single source of truth, recommended) or reference it, to avoid two explanatory surfaces drifting apart?
Whether the new endpoints should be added to the automatic TTL-refresh path (recommended yes, for consistency) or left out so the analysis is never silently computed against freshly-changed data.
Reviewer's falsification checklist (the challenges in the brief, and the architectural answers)
Challenge	Answer built into the architecture
"Your rank only increased because the number of countries changed."	Every response exposes both denominators, the common-set size, and the exact split totalMovement = commonEffect + poolEffect; the identified economies above India are listed.
"Those countries weren't added or removed; you only know their observations were available or not."	Terminology is observation-set membership only; forbidden-phrase guard extended; causes are stated as not established.
"Your common-universe rank differs because you changed the tie-break."	The new module imports the single existing comparator; invariant fullRankMatchesEngine and cross-check tests against the existing engines; tests fail if a second ordering ever appears.
"Your YoY comparison uses a different population than the YoY rankings."	YoY sets are built by buildYoyRows (the exact rule used by /api/yoy-ranking), with the pairing validity rule tested explicitly; separate endpoint, separate universe, cross-checked denominators.
"You calculated the explanation from rounded values."	Comparisons consume only stored REAL values and canonical decimal strings; display strings are separate fields; the decomposition is integer-only; a structural test asserts no formatted value can enter the domain module.
"The World Bank revised the data after your calculation."	Vintage is recorded per observation and per run, surfaced in every new response with the fingerprint and the producing run ids; mixed vintages are flagged; the frozen regression fixture can only change deliberately.
Status: this was an analysis-only phase — no files were created or modified, and no code was generated. All numeric claims above were produced by read-only queries against backend/data/worldbank.db (opened with readOnly: true) and backend/test/fixtures/wb-snapshot.json, using the project's exact comparator (value DESC, ISO3 ASC, 1-based ordinal ranks), and are labelled with the vintage they belong to (lastupdated 2026‑07‑13; retrieval 2026‑09‑21).

If you want to proceed, the next step is a decision on the open questions in §25 (I recommend 2→yes, 3→defer, 6→level-only for v1, 10→yes) — then toggle to 
Act Mode (⌘⇧A) and I can implement P1→P4 in the sequence above without touching the existing ranking/data experience.

