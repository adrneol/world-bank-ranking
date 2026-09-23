/**
 * TOTAL GDP TEST SERIES (synthetic, deterministic, offline).
 *
 * Why this exists:
 *   The versioned `wb-snapshot.json` fixture was generated for the four
 *   GDP-per-capita indicators and is intentionally NOT regenerated (that would
 *   rewrite committed expectations). The Total GDP subject therefore has its own
 *   offline series so the stub World Bank API can serve it and the ingestion
 *   pipeline can be tested without the live API (specification section 25).
 *
 * Data honesty:
 *   - The 2025 INDIA values below are the exact values observed on the LIVE
 *     World Bank API for vintage 2026-07-13 (verified during implementation):
 *       NY.GDP.MKTP.CD    -> 3956067115771.63
 *       NY.GDP.MKTP.KD    -> 3693970992045.56
 *       NY.GDP.MKTP.PP.CD -> 17197369286822
 *       NY.GDP.MKTP.PP.KD -> 14695849780451.9
 *     They are used so tests can prove a raw value survives ingestion, storage
 *     and the API unchanged.
 *   - Every OTHER value/entity is SYNTHETIC and clearly non-numeric-realistic in
 *     intent (fixed multipliers). It exists only to exercise the pipeline; it is
 *     never presented as World Bank data.
 *   - The aggregate / blank-ISO3 / unknown-country / null rows exist on purpose
 *     so the universe rule can be proven against the Total GDP series too.
 */

export const TOTAL_GDP_LAST_UPDATED = '2026-07-13';

export const TOTAL_GDP_METRIC_KEYS = Object.freeze([
  'total_current',
  'total_constant',
  'total_ppp_current',
  'total_ppp_constant',
]);

export const TOTAL_GDP_INDICATOR_CODES = Object.freeze({
  total_current: 'NY.GDP.MKTP.CD',
  total_constant: 'NY.GDP.MKTP.KD',
  total_ppp_current: 'NY.GDP.MKTP.PP.CD',
  total_ppp_constant: 'NY.GDP.MKTP.PP.KD',
});

/** Distinct, deterministic year/entity multipliers (synthetic except IND 2025). */
const IND_2025 = Object.freeze({
  total_current: 3956067115771.63,
  total_constant: 3693970992045.56,
  total_ppp_current: 17197369286822,
  total_ppp_constant: 14695849780451.9,
});

/** Eligible economies in the fixture and their synthetic size multiplier. */
const ECONOMIES = Object.freeze({
  IND: { name: 'India', factor: 1 },
  USA: { name: 'United States', factor: 7.6 },
  DEU: { name: 'Germany', factor: 1.15 },
  PAK: { name: 'Pakistan', factor: 0.09 },
  XKX: { name: 'Kosovo', factor: 0.0025 },
});

/** Year multipliers keep the two years distinct and growth non-trivial. */
const YEAR_FACTOR = Object.freeze({ 2024: 0.95, 2025: 1 });

/** Rows that must be rejected by the universe / value rules. */
const REJECTED_ROWS = Object.freeze([
  // Aggregate entity published WITH an ISO3 code (region.id === "NA" in metadata).
  { metricKey: 'total_current', iso3: 'AFE', countryId: 'ZH', countryName: 'Africa Eastern and Southern', year: 2024, value: 1252564134751.16 },
  // Income-group aggregate published with a BLANK ISO3 code.
  { metricKey: 'total_current', iso3: '', countryId: 'XD', countryName: 'High income', year: 2024, value: 45545.9 },
  // ISO3 absent from the World Bank country metadata entirely.
  { metricKey: 'total_current', iso3: 'ZZZ', countryId: 'ZZ', countryName: 'Nowhere', year: 2024, value: 999 },
  // Null value: missing data must be skipped, never stored as 0.
  { metricKey: 'total_current', iso3: 'PAK', countryId: 'PK', countryName: 'Pakistan', year: 2024, value: null },
]);

function row(metricKey, iso3, countryId, countryName, year, value) {
  return {
    indicator: { id: TOTAL_GDP_INDICATOR_CODES[metricKey], value: `Total GDP fixture (${metricKey})` },
    country: { id: countryId, value: countryName },
    countryiso3code: iso3,
    date: String(year),
    value,
    unit: '',
    obs_status: '',
    decimal: 0,
  };
}

/** World-Bank-shaped observation rows for one Total GDP metric. */
export function totalGdpRows(metricKey) {
  if (!TOTAL_GDP_METRIC_KEYS.includes(metricKey)) {
    throw new Error(`Unknown Total GDP fixture metric: ${metricKey}`);
  }
  const rows = [];
  for (const [iso3, economy] of Object.entries(ECONOMIES)) {
    for (const year of Object.keys(YEAR_FACTOR).map(Number)) {
      const isLiveIndia2025 = iso3 === 'IND' && year === 2025;
      const value = isLiveIndia2025
        ? IND_2025[metricKey]
        : IND_2025[metricKey] * economy.factor * YEAR_FACTOR[year];
      rows.push(row(metricKey, iso3, iso3 === 'USA' ? 'US' : iso3, economy.name, year, value));
    }
  }
  for (const rejected of REJECTED_ROWS) {
    if (rejected.metricKey !== metricKey) continue;
    rows.push(
      row(metricKey, rejected.iso3, rejected.countryId, rejected.countryName, rejected.year, rejected.value),
    );
  }
  return rows;
}

/** The live-verified IND 2025 value for a metric (test expectations). */
export function liveIndia2025(metricKey) {
  if (!IND_2025[metricKey]) throw new Error(`No live fixture value for ${metricKey}`);
  return IND_2025[metricKey];
}

/** metric key for an exact indicator code, or null when not a Total GDP code. */
export function totalGdpMetricKeyForCode(code) {
  const upper = String(code).toUpperCase();
  return TOTAL_GDP_METRIC_KEYS.find((key) => TOTAL_GDP_INDICATOR_CODES[key] === upper) ?? null;
}

/** World Bank /indicator metadata row for a Total GDP metric. */
export function totalGdpIndicatorMetadataRow(metricKey) {
  const names = {
    total_current: 'GDP (current US$)',
    total_constant: 'GDP (constant 2015 US$)',
    total_ppp_current: 'GDP, PPP (current international $)',
    total_ppp_constant: 'GDP, PPP (constant 2021 international $)',
  };
  return {
    id: TOTAL_GDP_INDICATOR_CODES[metricKey],
    name: names[metricKey],
    unit: '',
    source: { id: '2', value: 'World Development Indicators' },
    sourceNote: 'Fixture metadata row for the Total GDP subject.',
  };
}

export default { totalGdpRows, liveIndia2025, totalGdpMetricKeyForCode, totalGdpIndicatorMetadataRow };
