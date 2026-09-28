/**
 * Methodology documentation content (Round 2B repair).
 *
 * Concise per-basis documentation distilled from the repository's
 * methodology source files and the backend domain catalogs — terminology
 * and formulas preserved, prose compressed for a 20–40 second read.
 * DOCUMENTATION ONLY: nothing here calculates; the detail card displays
 * these strings alongside the live backend catalog values (description,
 * formula, unit, rank wording). Where the catalog already states a fact,
 * this module does not repeat it.
 *
 * Schema:
 *   FAMILY_GUIDE[familyKey] = { benchmark, universe, missing, ranking }
 *   BASIS_GUIDE[basisId] = { how, period, eligibility, distinct, caveats[] }
 *   METRIC_SOURCES[metricKey] = { file, label } (friendly source names)
 */

export const FAMILY_GUIDE = Object.freeze({
  gdp_per_capita: Object.freeze({
    benchmark:
      'Growth mode reports an unweighted peer average (full-precision growth percent, focus excluded) with plain-subtraction percentage-point gaps. Level movement publishes ranks, denominators and position changes without a peer benchmark.',
    universe:
      'Eligible economies holding the required World Bank observations; level ranks a single year, growth compares valid pairs, periods require complete spans.',
    missing: 'Missing or invalid required observations exclude the economy — never zero-filled or interpolated.',
    ranking: 'Registry direction (DESC for GDP): 1-based ordinal positions, ties broken deterministically by ISO3.',
  }),
  gdp_total: Object.freeze({
    benchmark:
      'Growth mode reports an unweighted peer average (full-precision growth percent, focus excluded) with plain-subtraction percentage-point gaps. Level movement publishes ranks, denominators and position changes without a peer benchmark.',
    universe:
      'Eligible economies holding the required World Bank observations; level ranks a single year, growth compares valid pairs, periods require complete spans.',
    missing: 'Missing or invalid required observations exclude the economy — never zero-filled or interpolated.',
    ranking: 'Registry direction (DESC for GDP): 1-based ordinal positions, ties broken deterministically by ISO3.',
  }),
  prices: Object.freeze({
    benchmark:
      'Leave-one-out mean of other eligible economies; gap = benchmark − focus, in percentage points. Positive means lower than the average; negative means higher. The focus economy is always excluded from its own benchmark.',
    universe:
      'Observed sets are basis-specific (single years for annual bases; complete S+1..E sequences for average/cumulative). Like-for-like intersects the required sets so compared periods share one universe.',
    missing:
      'Any missing required year excludes the economy. Never average only the years that exist; never interpolate or substitute.',
    ranking: 'Lower value ranks first (ASC), competition ranking (1, 1, 3), full backend precision.',
  }),
  trade: Object.freeze({
    benchmark:
      'Leave-one-out mean of other eligible economies; gap = benchmark − focus. USD gaps for level bases, percentage-point gaps for CAGR. Never label monetary gaps as percentage points.',
    universe:
      'Annual: single-year validity. CAGR: valid endpoints with start > 0. Total/average: every year S..E inclusive. Like-for-like intersects the required sets; group restriction applies before eligibility.',
    missing:
      'Any missing required observation excludes the economy. No interpolation, no zero substitution, no partial-period averaging.',
    ranking: 'Higher value ranks first (DESC), competition ranking (1, 1, 3), full backend precision.',
  }),
  capital_flows: Object.freeze({
    benchmark:
      'Leave-one-out mean of other eligible economies; gap = country − benchmark (positive = above average). USD gaps for flow bases, percentage-point gaps for ratio bases.',
    universe:
      'Annual: single-year validity. Period bases: complete S+1..E sequences (plus GDP legs where required). Like-for-like intersects complete spans (e.g. 2005–2024).',
    missing:
      'Incomplete sequences are never prorated. Negative and zero flows are legitimate data, never dropped or zeroed.',
    ranking: 'Higher value ranks first (DESC), competition ranking (1, 1, 3). Endpoint diagnostics are unranked.',
  }),
  exchange: Object.freeze({
    benchmark:
      'Leave-one-out MEDIAN of eligible-economy change (skew-resistant: single extreme depreciations must not dominate); gap = country − median, in percentage points. Positive = depreciated more than the peer median.',
    universe:
      'Annual change needs consecutive years t−1 and t. Period change needs endpoints S and E only — no intermediates. Like-for-like intersects the required endpoint sets.',
    missing: 'Missing t−1/t or S/E excludes the economy. A break in currency-unit continuity suppresses the comparison rather than fabricating one.',
    ranking:
      'Ranked bases use the frozen DESC direction (higher value = rank 1, i.e. greater depreciation). The annual level is never ranked or benchmarked.',
  }),
  external: Object.freeze({
    benchmark:
      'Leave-one-out statistic frozen per basis: median for skewed raw-scale bases (reserve stock/change, remittance levels), mean for normalized ratios and coverage. Gap = country − benchmark.',
    universe:
      'Flow and ratio bases need complete S+1..E sequences (plus GDP/imports legs where required); reserve change needs endpoints S and E; annual bases need the selected year. Like-for-like intersects complete spans.',
    missing:
      'Strict completeness: any missing required leg excludes the economy. Never drop years silently or treat missing as zero.',
    ranking: 'Higher value ranks first (DESC), competition ranking (1, 1, 3). Raw scale values are size descriptors, never performance judgments.',
  }),
  population: Object.freeze({
    benchmark:
      'Leave-one-out mean of other eligible economies; gap = country − benchmark. People gaps for stock/change bases, percentage-point gaps for growth.',
    universe:
      'Annual: selected year only. Change and growth: endpoints S and E only — intermediates are mathematically unnecessary for stocks. Like-for-like intersects the required endpoint sets.',
    missing: 'Missing endpoints exclude the economy. Stocks are never summed, averaged, or sequenced to fill gaps.',
    ranking:
      'Largest ranks first (DESC), competition ranking (1, 1, 3). Higher means larger/faster — never "better".',
  }),
});

export const METRIC_SOURCES = Object.freeze({
  inflation_cpi_index: Object.freeze({ file: 'prices/method-cpiindex.txt', label: 'CPI index methodology' }),
  inflation_cpi: Object.freeze({ file: 'prices/cpiInflationmethodology.txt', label: 'CPI inflation methodology' }),
  inflation_deflator: Object.freeze({ file: 'prices/gdpDeflator.txt', label: 'GDP-deflator methodology' }),
  exports_current: Object.freeze({ file: 'trade/tademethod.txt', label: 'Trade methodology' }),
  imports_current: Object.freeze({ file: 'trade/tademethod.txt', label: 'Trade methodology' }),
  fdi_inflows: Object.freeze({ file: 'capitalflow/capitalflowmethod.txt', label: 'Capital flow methodology' }),
  fdi_inflows_pct_gdp: Object.freeze({ file: 'capitalflow/capitalflowmethod.txt', label: 'Capital flow methodology' }),
  fx_official: Object.freeze({ file: 'ExchangeRate/exchangerate.txt', label: 'Exchange rate methodology' }),
  current_account: Object.freeze({ file: 'ExternalSector/externalsector.txt', label: 'External sector methodology' }),
  reserves_ex_gold: Object.freeze({ file: 'ExternalSector/externalsector.txt', label: 'External sector methodology' }),
  remittances_received: Object.freeze({ file: 'ExternalSector/externalsector.txt', label: 'External sector methodology' }),
  population_total: Object.freeze({ file: 'population/pop.txt', label: 'Population methodology' }),
});

export const BASIS_GUIDE = Object.freeze({
  // ---------------- Prices: CPI index ----------------
  cpi_index_annual: Object.freeze({
    how: 'Reports the raw CPI index level (2010 = 100) for the selected year, with descriptive index-point changes between selected years. No transformation, no cross-country rank.',
    period: 'Single selected year; Start/Middle/End years display as separate raw values (e.g. 63.4 → 139.9 → 227.6).',
    eligibility: 'Valid CPI observation in the selected year. No cross-country universe required.',
    distinct: 'The only Prices basis with no rank: pure level description, while the period-change basis converts levels into ranked change.',
    caveats: Object.freeze([
      'Index levels are not comparable across countries — the index measures within-country change over time.',
      'Never average raw index levels across countries into a "world CPI".',
    ]),
  }),
  cpi_index_period_change: Object.freeze({
    how: 'Endpoint percentage change between two CPI observations: cumulative over the interval, never annualized.',
    period: 'Endpoints S and E only (e.g. 2004→2014, 2014→2024, 2004→2024); intermediates unused. The two-decade results are primary, the full span is context.',
    eligibility: 'Both endpoints valid (observed); all selected years valid (like-for-like).',
    distinct: 'The main analytical and ranking basis for the CPI index: turns levels into comparable period change.',
    caveats: Object.freeze(['Not annualized; do not annualize the period change.']),
  }),
  // ---------------- Prices: CPI inflation ----------------
  cpi_inflation_annual: Object.freeze({
    how: 'Uses the published annual CPI inflation observation directly: the annual percentage change in consumer prices. No transformation.',
    period: 'Single selected year. Each year gets its own cross-sectional ranking; no 2004→2014 movement is computed from two annual rates.',
    eligibility: 'Valid annual inflation observation in the selected year.',
    distinct: 'Snapshot rate for one year — not a period average and not a total increase. Do not subtract two annual rates to make a period change.',
    caveats: Object.freeze([]),
  }),
  cpi_inflation_average: Object.freeze({
    how: 'Arithmetic mean of the annual inflation rates over the interval, denominator E−S (the number of annual transitions).',
    period: 'Full sequence S+1 through E (e.g. 2005–2014 for 2004→2014). Year S itself is excluded: its inflation describes the transition into S, not out of it.',
    eligibility: 'Every year S+1..E valid. Never average only the years that happen to exist.',
    distinct: 'Answers the typical annual rate (e.g. 6.67%), not the total increase (21% in the classic 10/0/10 example) — that is the cumulative basis.',
    caveats: Object.freeze(['An average of 8.27% does not mean prices rose 8.27% in total.']),
  }),
  cpi_inflation_cumulative: Object.freeze({
    how: 'Compounds the annual inflation rates over the interval: Π(1+r/100)−1. Inflation compounds — annual rates are never summed.',
    period: 'Full sequence S+1 through E; every transition is required for the compounding.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Total price-level increase (e.g. ~120.88% for India 2004→2014), vs the average basis which reports the typical annual rate.',
    caveats: Object.freeze([
      'Do not compute cumulative inflation by adding annual rates.',
      'Calculated from the inflation series itself, not by substituting the CPI index series.',
    ]),
  }),
  // ---------------- Prices: GDP deflator ----------------
  deflator_annual: Object.freeze({
    how: 'Uses the published annual GDP-deflator inflation observation directly: the annual growth rate of the economy-wide GDP implicit price level. No transformation.',
    period: 'Single selected year; independent annual observations.',
    eligibility: 'Valid annual observation in the selected year.',
    distinct: 'Single-year economy-wide rate — not a period average or a total price-level increase.',
    caveats: Object.freeze(['GDP-deflator inflation is economy-wide price change, not household (CPI) inflation; the two legitimately differ.']),
  }),
  deflator_average: Object.freeze({
    how: 'Arithmetic mean of annual deflator inflation rates over the interval, denominator E−S.',
    period: 'Full sequence S+1 through E (e.g. 2005–2014 for 2004→2014).',
    eligibility: 'Every year S+1..E valid; no partial-period averaging.',
    distinct: 'Typical annual rate over the period, vs the cumulative basis which totals the price-level increase.',
    caveats: Object.freeze([]),
  }),
  deflator_cumulative: Object.freeze({
    how: 'Compounds annual deflator rates over the interval: Π(1+r/100)−1. Negative annual rates compound normally (×0.98).',
    period: 'Full sequence S+1 through E.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Total increase in the GDP implicit price level — not average inflation, and not real-output growth.',
    caveats: Object.freeze(['Do not sum annual rates to cumulate.']),
  }),
  // ---------------- Trade ----------------
  exp_annual_value: Object.freeze({
    how: 'Raw annual export flow in current US$, no transformation: how large was the flow in that year.',
    period: 'Single selected year; no intermediate years involved.',
    eligibility: 'Valid selected-year observation.',
    distinct: 'Snapshot scale in one year — not growth and not multi-year accumulation. Larger means larger scale, never "better".',
    caveats: Object.freeze(['Current US$ is nominal: quantities, prices, exchange rates and composition — not real-volume growth.']),
  }),
  exp_period_cagr: Object.freeze({
    how: 'Compound annual growth rate from endpoints, annualized so different interval lengths compare apples-to-apples. Not the endpoint percent change.',
    period: 'Endpoints S and E only; intermediates are not required.',
    eligibility: 'Both endpoints valid with start strictly greater than zero; end = 0 is valid as −100%.',
    distinct: 'The only annualized basis; total and average use all inclusive years and are not annualized.',
    caveats: Object.freeze(['Nominal trade-value CAGR, never real export-volume growth.']),
  }),
  exp_period_total: Object.freeze({
    how: 'Sums every annual flow across the period: a cumulative nominal total, because flows accumulate and stocks do not apply here.',
    period: 'All years S..E inclusive (11/11/21 observations). Start year is included: each year is a real annual flow.',
    eligibility: 'Every year S..E valid.',
    distinct: 'Cumulative total vs the average basis (typical annual scale); rankings coincide for fixed spans but meanings differ.',
    caveats: Object.freeze([]),
  }),
  exp_period_average: Object.freeze({
    how: 'Period total divided by the year count (E−S+1): typical annual flow in USD/year.',
    period: 'Same inclusive S..E span as the total.',
    eligibility: 'Every year S..E valid.',
    distinct: 'Typical per-year scale; same ordering as the total for a fixed span, different unit and question.',
    caveats: Object.freeze([]),
  }),
  imp_annual_value: Object.freeze({
    how: 'Raw annual import flow in current US$, no transformation.',
    period: 'Single selected year.',
    eligibility: 'Valid selected-year observation.',
    distinct: 'Snapshot scale; a larger import value is scale, never automatically preferable.',
    caveats: Object.freeze(['Nominal values; larger imports do not mean a worse economy.']),
  }),
  imp_period_cagr: Object.freeze({
    how: 'Compound annual growth rate from endpoints, annualized across interval lengths.',
    period: 'Endpoints S and E only.',
    eligibility: 'Both endpoints valid with start strictly greater than zero; end = 0 is valid as −100%.',
    distinct: 'Annualized growth vs the all-years total/average bases.',
    caveats: Object.freeze(['Nominal trade-value CAGR, never real import-volume growth.']),
  }),
  imp_period_total: Object.freeze({
    how: 'Sums every annual import flow across the inclusive period.',
    period: 'All years S..E inclusive.',
    eligibility: 'Every year S..E valid.',
    distinct: 'Cumulative total vs typical-year average.',
    caveats: Object.freeze([]),
  }),
  imp_period_average: Object.freeze({
    how: 'Period total divided by the year count: typical annual import flow in USD/year.',
    period: 'Same inclusive S..E span.',
    eligibility: 'Every year S..E valid.',
    distinct: 'Typical scale; same ordering as the total for a fixed span.',
    caveats: Object.freeze([]),
  }),
  // ---------------- Capital flow ----------------
  fdi_annual_value: Object.freeze({
    how: 'Raw annual FDI net inflow in current US$, directly as reported. Signed: negative means disinvestment.',
    period: 'Single selected year.',
    eligibility: 'Valid FDI observation in the year.',
    distinct: 'One-year snapshot; does not sum or average the period. Larger means larger inflow, never "best".',
    caveats: Object.freeze(['Negative and zero flows are legitimate data, never dropped or zeroed.']),
  }),
  fdi_period_cumulative: Object.freeze({
    how: 'Sums all annual net flows over the period: the total net FDI transacted. Summed flows are never a stock.',
    period: 'Full sequence S+1..E (10 observations per decade); prevents double-counting the breakpoint year.',
    eligibility: 'Every year S+1..E valid — never total only the years that exist.',
    distinct: 'Total received across the period vs the average basis (typical annual amount).',
    caveats: Object.freeze(['Do not call cumulative flows an FDI stock.', 'No endpoint % growth basis exists: FDI can be zero/negative.']),
  }),
  fdi_period_average: Object.freeze({
    how: 'Cumulative sum divided by N: typical annual net FDI in USD/year, comparable across period lengths.',
    period: 'Same complete S+1..E sequence.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Typical-year scale; identical ranking to the cumulative for fixed spans, different question.',
    caveats: Object.freeze([]),
  }),
  fdigdp_annual_value: Object.freeze({
    how: 'World Bank FDI-net-inflows-to-GDP ratio for the year, used directly: annual intensity relative to economy size.',
    period: 'Single selected year.',
    eligibility: 'Valid ratio (or valid FDI and GDP inputs) in the year.',
    distinct: 'Single-year intensity vs period average and cumulative share.',
    caveats: Object.freeze([]),
  }),
  fdigdp_period_average: Object.freeze({
    how: 'Arithmetic mean of the annual ratios: typical yearly intensity, each year equally weighted.',
    period: 'Full sequence S+1..E.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Mean of ratios vs the cumulative-share basis, which weights by GDP instead.',
    caveats: Object.freeze(['Equal-weighted years despite different GDP denominators.']),
  }),
  fdigdp_period_cumulative_share: Object.freeze({
    how: 'Cumulative FDI divided by cumulative GDP over the same span (×100): the coherent cumulative intensity measure.',
    period: 'S+1..E for both numerator and denominator legs.',
    eligibility: 'Complete FDI and GDP legs for every year S+1..E.',
    distinct: 'GDP-weighted cumulative share — never computed by adding annual percentages, which have different denominators.',
    caveats: Object.freeze(['Do not sum annual percentages.']),
  }),
  // ---------------- Exchange rate ----------------
  fx_annual_rate: Object.freeze({
    how: 'Annual-average official rate, local currency per US$, displayed for the selected economy and charts only.',
    period: 'Single selected year.',
    eligibility: 'Valid observation in the year, for display only — no ranking universe.',
    distinct: 'The only level basis, in currency units; the change bases are dimensionless percentages and rankable.',
    caveats: Object.freeze([
      'Raw levels must never be ranked across currencies: magnitudes reflect denomination, not strength.',
      'Redenomination breaks comparability (100 old units = 1 new unit changes nothing real).',
    ]),
  }),
  fx_annual_change: Object.freeze({
    how: 'Year-over-year percentage change of the LCU-per-USD level. Because of the quotation, a rise means depreciation.',
    period: 'Exactly the consecutive pair t−1 and t.',
    eligibility: 'Both consecutive observations valid.',
    distinct: 'Single-year movement vs the multi-year endpoint period change.',
    caveats: Object.freeze(['Nominal bilateral vs USD only — not real, PPP, or competitiveness movement.']),
  }),
  fx_period_change: Object.freeze({
    how: 'Endpoint percentage change S→E. Exchange rates are prices, so endpoints are used directly: no summing, no averaging, no intermediates.',
    period: 'Endpoints S and E only — explicitly not the S+1..E flow rule.',
    eligibility: 'Valid S and E observations with an established continuous unit basis.',
    distinct: 'Long-period comparison; the annualized CAGR shown alongside is display-only with identical ordering, never a separate rank.',
    caveats: Object.freeze(['Never describe rank position as currency strength; it is nominal movement vs USD.']),
  }),
  // ---------------- External sector ----------------
  ca_annual_gdp: Object.freeze({
    how: 'Current-account balance as % of GDP for the year (WDI ratio or CA/GDP legs): cross-country external position, not raw dollars.',
    period: 'Single selected year.',
    eligibility: 'Valid CA and GDP legs in the year.',
    distinct: 'Normalized position vs raw scale; a surplus is not automatically superior.',
    caveats: Object.freeze(['Do not rank raw US$ balances as external performance.', 'Never use absolute |CA|.']),
  }),
  ca_average_gdp: Object.freeze({
    how: 'Equal-weighted mean of the annual CA/GDP ratios over the period: typical yearly position.',
    period: 'Full sequence S+1..E.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Equal-weighted years vs the cumulative basis, which weights by GDP size.',
    caveats: Object.freeze([]),
  }),
  ca_cumulative_share: Object.freeze({
    how: 'Cumulative dollar CA divided by cumulative dollar GDP (×100): aggregate balance relative to aggregate economy size.',
    period: 'Full sequence S+1..E for both legs.',
    eligibility: 'Complete CA and GDP legs every year.',
    distinct: 'GDP-weighted aggregate intensity — never computed by summing annual percentages.',
    caveats: Object.freeze(['Do not sum annual CA/GDP percentages.']),
  }),
  res_annual_stock: Object.freeze({
    how: 'Reserve stock excluding gold, in current US$, reported as a size level.',
    period: 'Single selected year.',
    eligibility: 'Valid reserve-stock observation in the year.',
    distinct: 'Nominal size only — not adequacy and not a flow; never summed across years.',
    caveats: Object.freeze(['Size reflects country scale and financing needs, not reserve strength.']),
  }),
  res_period_change: Object.freeze({
    how: 'Endpoint percentage change of the reserve stock. A change in level, not accumulation.',
    period: 'Endpoints S and E only.',
    eligibility: 'Valid observations at both endpoints.',
    distinct: 'Level movement vs stock size vs import-normalized coverage.',
    caveats: Object.freeze(['USD valuation and exchange-rate effects apply; this is not cumulative reserve purchases.']),
  }),
  res_import_coverage: Object.freeze({
    how: 'Reserves divided by annual imports, ×12: months of import coverage from ex-gold reserves.',
    period: 'Selected year (reserves and imports of the same year).',
    eligibility: 'Valid reserves ex-gold and imports legs in the year.',
    distinct: 'The only normalized adequacy proxy — which is why raw stock ranking alone can mislead.',
    caveats: Object.freeze(['Adequacy also depends on debt, regime and financing access — coverage is a proxy, not a verdict.']),
  }),
  remit_annual_value: Object.freeze({
    how: 'Personal remittances received in current US$ for the year: a flow level.',
    period: 'Single selected year.',
    eligibility: 'Valid remittance observation in the year.',
    distinct: 'Single-year flow vs cumulative total, typical scale, and GDP-normalized intensity.',
    caveats: Object.freeze(['Scale reflects population and migration, not economic performance.']),
  }),
  remit_period_cumulative: Object.freeze({
    how: 'Sums every annual remittance flow: total received across the period. Flows legitimately aggregate.',
    period: 'Full sequence S+1..E.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Period total vs typical-year average (identical ranking, different question).',
    caveats: Object.freeze([]),
  }),
  remit_period_average: Object.freeze({
    how: 'Cumulative sum divided by N: typical annual remittance scale in USD/year.',
    period: 'Same complete S+1..E sequence.',
    eligibility: 'Every year S+1..E valid.',
    distinct: 'Typical scale; same ordering as the cumulative for fixed spans.',
    caveats: Object.freeze([]),
  }),
  remit_cumulative_intensity: Object.freeze({
    how: 'Cumulative remittances divided by cumulative GDP (×100): structural intensity, consistently dollar-based.',
    period: 'Full sequence S+1..E for both legs.',
    eligibility: 'Complete remittance and GDP legs every year.',
    distinct: 'The only GDP-normalized remittance basis — dollars alone cannot show dependence.',
    caveats: Object.freeze(['Do not sum annual percentages; do not read totals as dependence.']),
  }),
  // ---------------- Population ----------------
  pop_annual_value: Object.freeze({
    how: 'Mid-year de-facto population estimate for the selected year: a stock snapshot, valid for cross-country size comparison.',
    period: 'Single selected year.',
    eligibility: 'Valid estimate in the year.',
    distinct: 'Stock snapshot; annual stocks are never summed or averaged across years.',
    caveats: Object.freeze(['Estimates involve modeling — not exact headcounts. Larger is larger, never "better".']),
  }),
  pop_period_change: Object.freeze({
    how: 'Endpoint difference in people: net population added or lost. For stocks, endpoints are the correct comparison.',
    period: 'Endpoints S and E only (e.g. 2004 and 2014, not 2005–2014).',
    eligibility: 'Valid S and E observations.',
    distinct: 'Absolute people added (size-sensitive) vs the scale-neutral growth basis.',
    caveats: Object.freeze(['Net change only — never label it births or natural increase; it includes migration and mortality.']),
  }),
  pop_period_growth: Object.freeze({
    how: 'Endpoint ratio minus one: scale-neutral percent growth, comparable across countries of any size.',
    period: 'Endpoints S and E only.',
    eligibility: 'Valid S and E observations.',
    distinct: 'Relative growth vs absolute change; the annualized CAGR shown alongside shares its ordering and is display-only, never a fourth basis.',
    caveats: Object.freeze(['No welfare or performance claims follow from faster growth.']),
  }),
  // ---------------- GDP families (documented from backend code) ----------------
  level: Object.freeze({
    how: 'Stored World Bank observation for the selected year, ranked with no transformation.',
    period: 'Single selected year.',
    eligibility: 'Valid observation in the year.',
    distinct: 'Level answers how large; growth answers how fast it changed; period modes aggregate flows across spans.',
    caveats: Object.freeze([]),
  }),
  growth: Object.freeze({
    how: 'Consecutive years use the YoY formula on raw values; longer spans compare endpoints ((B/A) − 1) × 100 with interiors ignored.',
    period: 'Year pair (t−1, t) for YoY; endpoints A and B for longer spans. A non-positive YoY base yields no value, never 0%.',
    eligibility: 'Valid pair observations; YoY additionally requires a positive base year.',
    distinct: 'Orders economies by percentage change (rank 1 = highest growth), not by level — with a peer average for context.',
    caveats: Object.freeze([]),
  }),
  period_total: Object.freeze({
    how: 'Backend SUM operation over the half-open span [A, B): adds the annual values. Flow semantics only.',
    period: 'Every year A..B−1 must be present.',
    eligibility: 'Complete span required; gaps exclude the economy.',
    distinct: 'Cumulative span total vs typical-year average; ordered under the registry direction.',
    caveats: Object.freeze([]),
  }),
  period_average: Object.freeze({
    how: 'Backend AVG operation: span sum divided by N. Typical annual scale over the period.',
    period: 'Every year A..B−1 must be present.',
    eligibility: 'Complete span required; gaps exclude the economy.',
    distinct: 'Typical-year scale vs cumulative total.',
    caveats: Object.freeze([]),
  }),
});

export default { FAMILY_GUIDE, METRIC_SOURCES, BASIS_GUIDE };
