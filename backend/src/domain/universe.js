/**
 * COUNTRY UNIVERSE - the single source of truth for which entities may be ranked.
 *
 * THE RULE (must not be duplicated elsewhere):
 * An entity from World Bank country metadata is an AGGREGATE, and therefore
 * permanently excluded from every ranking, if ANY of the following hold:
 *
 *   1. region.id === "NA"            (the World Bank's own aggregate marker)
 *   2. region.value === "Aggregates" (same marker, human-readable form)
 *   3. its ISO3 code is blank/missing
 *
 * An OBSERVATION is eligible for ranking only when ALL hold:
 *
 *   1. its value is not null            (missing data is never zero)
 *   2. its ISO3 is not blank            (income groups come back iso3 = "")
 *   3. its ISO3 resolves to a metadata entity
 *   4. that entity is not an aggregate
 *
 * Why the blank-ISO3 rule matters:
 * The API returns rows such as
 *   { country: { id: "XD", value: "High income" },       countryiso3code: "", value: 45545.9 }
 *   { country: { id: "XN", value: "Lower middle income" }, countryiso3code: "", value: 2251.1 }
 * These carry real numbers but are income-group aggregates. A filter that only
 * checks `value !== null` would rank "High income" above India and
 * "Lower middle income" below it. Matching on `countryiso3code` alone cannot
 * catch them, because their ISO3 is empty - hence the blank-ISO3 rule.
 *
 * Consequence for the denominator:
 * Because aggregates are removed, the denominator is the number of ELIGIBLE
 * countries/economies with a valid observation - never "all countries in the
 * world", and never "every row the API returned".
 */

/** Reason codes recorded on each country row, for auditability. */
export const AGGREGATE_REASONS = Object.freeze({
  REGION_ID_NA: 'region.id is "NA"',
  REGION_VALUE_AGGREGATES: 'region.value is "Aggregates"',
  BLANK_ISO3: 'blank or missing ISO3 code',
  UNKNOWN_METADATA_SHAPE: 'country metadata was missing or malformed',
});

/** Trim and upper-case an ISO3 code; empty string becomes null. */
export function normalizeIso3(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Decide whether a World Bank metadata entity is an aggregate.
 *
 * @param {object} meta A record from GET /v2/country
 * @returns {{ isAggregate: boolean, reason: string|null }}
 */
export function classifyEntity(meta) {
  if (!meta || typeof meta !== 'object') {
    return { isAggregate: true, reason: AGGREGATE_REASONS.UNKNOWN_METADATA_SHAPE };
  }

  const regionId = meta?.region?.id;
  const regionValue = meta?.region?.value;
  const iso3 = normalizeIso3(meta.id ?? meta.iso3 ?? meta.iso3Code);

  if (regionId === 'NA') {
    return { isAggregate: true, reason: AGGREGATE_REASONS.REGION_ID_NA };
  }
  if (regionValue === 'Aggregates') {
    return { isAggregate: true, reason: AGGREGATE_REASONS.REGION_VALUE_AGGREGATES };
  }
  if (!iso3) {
    return { isAggregate: true, reason: AGGREGATE_REASONS.BLANK_ISO3 };
  }

  return { isAggregate: false, reason: null };
}

/**
 * Convert one World Bank metadata record into the shape the repository stores.
 *
 * @param {object} meta
 * @returns {object}
 */
export function toCountryRow(meta) {
  const { isAggregate, reason } = classifyEntity(meta);
  const iso3 = normalizeIso3(meta?.id ?? meta?.iso3);

  return {
    id: iso3 ?? String(meta?.id ?? '').trim(),
    iso2: meta?.iso2Code ?? null,
    iso3,
    name: String(meta?.name ?? '').trim(),
    region: meta?.region?.value ?? null,
    regionId: meta?.region?.id ?? null,
    adminRegion: meta?.adminregion?.value ?? null,
    incomeLevel: meta?.incomeLevel?.value ?? null,
    lendingType: meta?.lendingType?.value ?? null,
    capitalCity: meta?.capitalCity ?? null,
    isAggregate,
    aggregateReason: reason,
  };
}

/**
 * Build the eligible universe from raw metadata records.
 *
 * @param {object[]} metaRows records from GET /v2/country
 */
export function buildUniverse(metaRows) {
  const countries = [];
  const seen = new Set();

  for (const meta of metaRows ?? []) {
    const row = toCountryRow(meta);
    if (!row.id) continue; // Unusable without any identifier.
    if (seen.has(row.id)) continue; // First definition wins; keeps results stable.
    seen.add(row.id);
    countries.push(row);
  }

  const eligible = countries.filter((c) => !c.isAggregate);
  const aggregates = countries.filter((c) => c.isAggregate);

  return {
    countries,
    eligible,
    aggregates,
    eligibleCount: eligible.length,
    aggregateCount: aggregates.length,
    totalCount: countries.length,
  };
}

/**
 * Machine-readable reasons why an observation cannot be ranked.
 *
 * These are the ONLY rejection codes in the application. The ingestion pipeline
 * imports them instead of hardcoding strings, so two different causes can never
 * be silently merged into one audit counter.
 */
export const OBSERVATION_REJECTIONS = Object.freeze({
  MISSING_VALUE: 'missing_value',
  NON_FINITE_VALUE: 'non_finite_value',
  INVALID_YEAR: 'invalid_year',
  BLANK_ISO3: 'blank_iso3',
  AGGREGATE_ENTITY: 'aggregate_entity',
  UNKNOWN_COUNTRY: 'unknown_country',
});

/** Human-readable meaning of each rejection code, used by audit output. */
export const OBSERVATION_REJECTION_DESCRIPTIONS = Object.freeze({
  [OBSERVATION_REJECTIONS.MISSING_VALUE]:
    'The World Bank returned no value for this country-year. Missing data is never treated as zero.',
  [OBSERVATION_REJECTIONS.NON_FINITE_VALUE]:
    'The World Bank value was not a finite number.',
  [OBSERVATION_REJECTIONS.INVALID_YEAR]:
    'The observation did not carry a usable year.',
  [OBSERVATION_REJECTIONS.BLANK_ISO3]:
    'The observation carried a blank ISO3 code. World Bank income-group aggregates arrive this way.',
  [OBSERVATION_REJECTIONS.AGGREGATE_ENTITY]:
    'The ISO3 code matches a World Bank entity flagged as an aggregate (for example "World" / "WLD").',
  [OBSERVATION_REJECTIONS.UNKNOWN_COUNTRY]:
    'The ISO3 code is absent from the stored World Bank country metadata, so it cannot be ranked.',
});

/** True when `key` is present in a Set, Map or array collection. */
export function isMember(collection, key) {
  if (!collection || !key) return false;
  if (collection instanceof Map) return collection.has(key);
  if (collection instanceof Set) return collection.has(key);
  if (Array.isArray(collection)) return collection.includes(key);
  if (typeof collection.has === 'function') return Boolean(collection.has(key));
  return false;
}

/**
 * Build the two lookup indexes used to classify observations from a universe
 * object returned by buildUniverse(). Defined once so the ingestion pipeline and
 * every service apply exactly the same rule.
 *
 * @param {{eligible: object[], aggregates: object[]}} universe
 * @returns {{eligibleIso3Set: Set<string>, aggregateIso3Set: Set<string>}}
 */
export function createUniverseIndex(universe) {
  const eligibleIso3Set = new Set((universe?.eligible ?? []).map((c) => c.id).filter(Boolean));
  const aggregateIso3Set = new Set(
    (universe?.aggregates ?? [])
      .flatMap((c) => [c.id, c.iso3, c.iso3Code])
      .filter(Boolean),
  );
  return { eligibleIso3Set, aggregateIso3Set };
}

/**
 * Eligibility test for a single observation, used by the ingestion pipeline so
 * that ineligible rows never reach the database in the first place.
 *
 * Precedence of rejection reasons (first match wins) is fixed and documented so
 * each audit counter has exactly one meaning:
 *   1. missing value    2. non-finite value   3. invalid year
 *   4. blank ISO3       5. aggregate entity   6. unknown country
 *
 * @param {{ iso3?: string|null, value?: number|null, year?: number|null }} observation
 * @param {Set<string>|Map<string, unknown>} eligibleIso3Set non-aggregate ISO3 codes
 * @param {{ aggregateIso3Set?: Set<string>, year?: number }} [context]
 * @returns {{ eligible: boolean, reason: string|null, iso3?: string, value?: number }}
 */
export function classifyObservation(observation, eligibleIso3Set, context = {}) {
  const { aggregateIso3Set } = context;
  const year = context.year ?? observation?.year ?? null;
  const value = observation?.value;

  if (value === null || value === undefined) {
    return { eligible: false, reason: OBSERVATION_REJECTIONS.MISSING_VALUE };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { eligible: false, reason: OBSERVATION_REJECTIONS.NON_FINITE_VALUE };
  }
  if (year !== null && !Number.isFinite(Number(year))) {
    return { eligible: false, reason: OBSERVATION_REJECTIONS.INVALID_YEAR };
  }

  const iso3 = normalizeIso3(observation?.iso3);
  if (!iso3) {
    return { eligible: false, reason: OBSERVATION_REJECTIONS.BLANK_ISO3 };
  }

  if (!isMember(eligibleIso3Set, iso3)) {
    // Two different unrankable cases, kept apart in the counters: a known
    // aggregate entity (e.g. WLD) versus an ISO3 absent from the metadata.
    if (isMember(aggregateIso3Set, iso3)) {
      return { eligible: false, reason: OBSERVATION_REJECTIONS.AGGREGATE_ENTITY };
    }
    return { eligible: false, reason: OBSERVATION_REJECTIONS.UNKNOWN_COUNTRY };
  }

  return { eligible: true, reason: null, iso3, value: Number(value) };
}

/**
 * Human-readable explanation of the universe rule, surfaced through the API
 * and the UI so the filtering is never hidden behaviour.
 */
export function describeUniverseRule() {
  return {
    eligibleDefinition:
      'A country/economy is eligible when its World Bank metadata does not mark it as an aggregate.',
    aggregateRule:
      'Excluded when region.id is "NA", or region.value is "Aggregates", or the ISO3 code is blank.',
    observationRule:
      'An observation is ranked only when its value is non-null, its ISO3 is non-blank, its ISO3 exists in the metadata, and that entity is not an aggregate.',
    denominatorMeaning:
      'The denominator is the number of eligible countries/economies holding a valid World Bank observation for that indicator and year. It changes between years because observation availability differs. It does not mean the number of countries in the world.',
    blankIso3Note:
      'World Bank income-group aggregates (for example "High income", "Lower middle income") are returned with an empty countryiso3code and are excluded by the blank-ISO3 rule. Excluding them is required for a country-level ranking.',
  };
}

export default buildUniverse;