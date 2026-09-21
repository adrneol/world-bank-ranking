/**
 * HAND-AUTHORED EDGE-CASE FIXTURES.
 *
 * The versioned snapshot (wb-snapshot.json) holds real World Bank rows. These
 * rows are synthetic on purpose so that every edge case the specification cares
 * about is present deterministically in one tiny dataset:
 *
 *   - a value tie between two countries (ISO3 tie-break)
 *   - a zero observation (valid for ranking, invalid as a YoY base)
 *   - a missing value (null) observation
 *   - an income-group style row with a BLANK ISO3 code
 *   - aggregate entities (region.id "NA" / region.value "Aggregates")
 *   - an ISO3 that is absent from the country metadata entirely
 *   - a country with no previous-year observation (YoY not calculable)
 */

/** Metric used by the synthetic dataset. */
export const EDGE_METRIC_KEY = 'nominal_current';
export const EDGE_INDICATOR_CODE = 'NY.GDP.PCAP.CD';

/** Country metadata rows in the World Bank /country shape. */
export const EDGE_METADATA = [
  { id: 'IND', iso2Code: 'IN', name: 'India', region: { id: 'SAS', value: 'South Asia' }, incomeLevel: { id: 'LMC', value: 'Lower middle income' } },
  { id: 'USA', iso2Code: 'US', name: 'United States', region: { id: 'NAC', value: 'North America' }, incomeLevel: { id: 'HIC', value: 'High income' } },
  { id: 'BRA', iso2Code: 'BR', name: 'Brazil', region: { id: 'LAC', value: 'Latin America & Caribbean' } },
  { id: 'CIV', iso2Code: 'CI', name: "Cote d'Ivoire", region: { id: 'SSF', value: 'Sub-Saharan Africa' } },
  { id: 'TUV', iso2Code: 'TV', name: 'Tuvalu', region: { id: 'EAS', value: 'East Asia & Pacific' } },
  { id: 'PSE', iso2Code: 'PS', name: 'West Bank and Gaza', region: { id: 'MEA', value: 'Middle East & North Africa' } },
  { id: 'XKX', iso2Code: 'XK', name: 'Kosovo', region: { id: 'ECS', value: 'Europe & Central Asia' } },
  { id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA', value: 'Aggregates' } },
  { id: 'HIC', iso2Code: 'XD', name: 'High income', region: { id: 'NA', value: 'Aggregates' } },
];

/** Aggregate metadata whose ISO3 is blank, which must also be excluded. */
export const EDGE_BLANK_METADATA = [
  { id: '   ', iso2Code: '', name: 'Entity without an ISO3 code', region: { id: 'NA', value: 'Aggregates' } },
];

/**
 * Synthetic observations: { iso3, year, value }.
 * `value: null` means the World Bank published no value for that country-year.
 */
export const EDGE_OBSERVATIONS = [
  // USA: full series, no gaps
  { iso3: 'USA', year: 2002, value: 38000.111111 },
  { iso3: 'USA', year: 2003, value: 40000.111111 },
  { iso3: 'USA', year: 2004, value: 42000.222222 },
  { iso3: 'USA', year: 2005, value: 43000.333333 },
  // IND: tie with BRA in 2003 and 2005, no 2002 value
  { iso3: 'IND', year: 2003, value: 600.5 },
  { iso3: 'IND', year: 2004, value: 700.75 },
  { iso3: 'IND', year: 2005, value: 800.125 },
  // BRA: tie partner, no 2002 value
  { iso3: 'BRA', year: 2003, value: 600.5 },
  { iso3: 'BRA', year: 2004, value: 800.25 },
  { iso3: 'BRA', year: 2005, value: 800.125 },
  // CIV: zero values (valid for ranking, never a valid YoY base)
  { iso3: 'CIV', year: 2004, value: 0 },
  { iso3: 'CIV', year: 2005, value: 0 },
  // TUV: no 2003 value, and a NULL 2005 value
  { iso3: 'TUV', year: 2004, value: 2200.5 },
  { iso3: 'TUV', year: 2005, value: null },
  // PSE / XKX: legitimate economies that must survive the universe rule
  { iso3: 'PSE', year: 2004, value: 3373.5 },
  { iso3: 'PSE', year: 2005, value: 3500.25 },
  { iso3: 'XKX', year: 2004, value: 5943.2 },
  { iso3: 'XKX', year: 2005, value: 6100.75 },
  // Aggregates published WITH an ISO3 code -> excluded via the metadata verdict
  { iso3: 'WLD', year: 2004, value: 13313.8575826001 },
  { iso3: 'WLD', year: 2005, value: 13500.5 },
  { iso3: 'HIC', year: 2004, value: 64354.5 },
  { iso3: 'HIC', year: 2005, value: 65100.25 },
  // Income-group rows published with a BLANK ISO3 code -> excluded
  { iso3: '', year: 2004, value: 45545.9 },
  { iso3: '', year: 2005, value: 46000.75 },
  // An ISO3 that is not in the metadata at all -> unknown country
  { iso3: 'ZZZ', year: 2004, value: 999.5 },
  { iso3: 'ZZZ', year: 2005, value: 1000.5 },
];

/** The same rows in the World Bank observation shape (as the API returns them). */
export function edgeObservationRows(indicatorCode = EDGE_INDICATOR_CODE) {
  return EDGE_OBSERVATIONS.map((entry) => ({
    indicator: { id: indicatorCode, value: 'GDP per capita (current US$)' },
    country: { id: entry.iso3 || 'XD', value: entry.iso3 || 'High income' },
    countryiso3code: entry.iso3,
    date: String(entry.year),
    value: entry.value,
    unit: 'current US$',
    obs_status: '',
    decimal: 15,
  }));
}

/** Expected counts for the synthetic dataset, used by several tests. */
export const EDGE_EXPECTATIONS = Object.freeze({
  // IND, USA, BRA, CIV, TUV, PSE, XKX. The blank-ISO3 metadata entity has no
  // usable identifier at all, so it is dropped instead of being rankable.
  eligibleUniverse: 7,
  // WLD and HIC carry region.id "NA" (aggregates); the blank-ISO3 entity is dropped.
  aggregateUniverse: 2,
  // Rows with a valid value for that year among eligible entities (TUV 2005 is null).
  levelDenominator: { 2003: 3, 2004: 7, 2005: 6 },
  // Ties: BRA and IND share 600.5 in 2003 and 800.125 in 2005, and ISO3 ascending
  // puts BRA before IND (B < I).
  indiaRank: { 2003: 3, 2004: 6, 2005: 5 },
  indiaValue: { 2003: 600.5, 2004: 700.75, 2005: 800.125 },
  // Descending order of the eligible rows for each year (raw values).
  levelOrder: {
    2003: ['USA', 'BRA', 'IND'],
    2004: ['USA', 'XKX', 'PSE', 'TUV', 'BRA', 'IND', 'CIV'],
    2005: ['USA', 'XKX', 'PSE', 'BRA', 'IND', 'CIV'],
  },
  // Pairs require both years AND a positive base: CIV has a zero base in 2005 and
  // TUV has no current value, so both drop out of the YoY denominator.
  yoyPairs: { 2003: 1, 2004: 3, 2005: 5 },
  indiaYoyPercent: {
    2003: null, // India has no 2002 observation in this dataset
    2004: 16.694421315570352,
    2005: 14.181234391723162,
  },
});

export default { edgeObservationRows, EDGE_METADATA, EDGE_OBSERVATIONS, EDGE_EXPECTATIONS };