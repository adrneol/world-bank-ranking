/**
 * ENTITY MODEL + RESOLUTION + CAPABILITY MATRIX (Phase 4, no I/O except DB reads).
 *
 * Three entity kinds, structurally distinguished so they can never be mixed:
 *
 *   COUNTRY            a single eligible World Bank country/economy
 *                      spec: "country:IND" · source WORLD_BANK · names from DB
 *   OFFICIAL_AGGREGATE a World Bank published aggregate (WLD, SAS, HIC, ...)
 *                      spec: "aggregate:WLD" · source WORLD_BANK · NEVER
 *                      reconstructed from members, NEVER hard-coded; a code
 *                      the metadata does not know fails with
 *                      NO_OFFICIAL_AGGREGATE rather than becoming a fake region
 *   CUSTOM_GROUP       an explicit user-submitted ISO3 list
 *                      spec: "group:IND,CHN,IDN" · source USER_DEFINED ·
 *                      request-defined only (never persisted), strictly
 *                      validated, always labelled as user-selected
 *
 * Capability (canCompare) depends on entity types AND metric semantics AND
 * the requested operation — never on metric-name branches. Phase-3
 * canTransform is reused for operation gating.
 *
 * Ranking is deliberately absent here: entities are compared, never merged
 * into a leaderboard (guardrails: country ranking vs entity comparison stay
 * separate; the existing movement decomposition is never applied to
 * official aggregates).
 */

import { getCountriesByIso3List, getCountry } from '../db/repository.js';
import { TRANSFORMS, canTransform } from '../domain/transforms.js';
import { COMPARE_REASON_CODES, gateCompareAnalysis } from '../domain/compareAnalysis.js';

/** Entity kinds (wire + internal). */
export const ENTITY_KINDS = Object.freeze({
  COUNTRY: 'country',
  OFFICIAL_AGGREGATE: 'wb_aggregate',
  CUSTOM_GROUP: 'custom_group',
});

/** Provenance sources for resolved entities. */
export const ENTITY_SOURCES = Object.freeze({
  WORLD_BANK: 'WORLD_BANK',
  USER_DEFINED: 'USER_DEFINED',
});

/** Machine-readable Phase-4 error/reason codes. */
export const ENTITY_ERROR_CODES = Object.freeze({
  INVALID_ENTITY: 'INVALID_ENTITY',
  INVALID_COUNTRY: 'INVALID_COUNTRY',
  INVALID_GROUP: 'INVALID_GROUP',
  EMPTY_GROUP: 'EMPTY_GROUP',
  INVALID_GROUP_MEMBER: 'INVALID_GROUP_MEMBER',
  NOT_AGGREGATABLE: 'NOT_AGGREGATABLE',
  NO_OFFICIAL_AGGREGATE: 'NO_OFFICIAL_AGGREGATE',
  UNSUPPORTED_ENTITY_COMBINATION: 'UNSUPPORTED_ENTITY_COMBINATION',
  UNSUPPORTED_TRANSFORMATION: 'UNSUPPORTED_TRANSFORMATION',
  INCOMPATIBLE_LEGS: 'INCOMPATIBLE_LEGS',
  MISSING_REQUIRED_DATA: 'MISSING_REQUIRED_DATA',
  INCOMPATIBLE_QUOTATION: 'INCOMPATIBLE_QUOTATION',
  LIKE_FOR_LIKE_REQUIRES_GROUP: 'LIKE_FOR_LIKE_REQUIRES_GROUP',
  INVALID_GROUP_MODE: 'INVALID_GROUP_MODE',
  INVALID_INDICATOR: 'INVALID_INDICATOR',
  INVALID_BASIS: 'INVALID_BASIS',
  MISSING_YEAR: 'MISSING_YEAR',
  SAME_YEAR_SELECTED: 'SAME_YEAR_SELECTED',
  INVALID_OPERATION: 'INVALID_OPERATION',
  // Compare-specific blocking reasons (analysis plan + coverage).
  INVALID_YEAR_ORDER: COMPARE_REASON_CODES.INVALID_YEAR_ORDER,
  COVERAGE_INCOMPLETE: 'COVERAGE_INCOMPLETE',
  AGGREGATE_COVERAGE_NOT_COMPARABLE: 'AGGREGATE_COVERAGE_NOT_COMPARABLE',
  EMPTY_COMMON_UNIVERSE: 'EMPTY_COMMON_UNIVERSE',
  PARTIAL_COMPARISON: 'PARTIAL_COMPARISON',
});

/**
 * Capability token of an entity kind, as declared by the metric registry
 * (`comparisonCapability`).
 */
const CAPABILITY_TOKEN_BY_KIND = Object.freeze({
  [ENTITY_KINDS.COUNTRY]: 'COUNTRY',
  [ENTITY_KINDS.OFFICIAL_AGGREGATE]: 'OFFICIAL_AGGREGATE',
  [ENTITY_KINDS.CUSTOM_GROUP]: 'CUSTOM_GROUP',
});

/**
 * Compare operations include annual Level positions and value/change results.
 * The period analyses reuse the project's approved strict period transforms
 * (PERIOD_SUM, PERIOD_AVG, PERIOD_SUM_PERCENT_CHANGE) and the segmented
 * growth reuses the approved percent-change transform over one shared
 * universe.
 */
export const COMPARE_OPERATIONS = Object.freeze([
  'level',
  'absolute_change',
  'percent_change',
  'pp_change',
  'index_point_change',
  'cagr',
  'cross_rate',
  'period_total',
  'period_average',
  'movement_period_total',
  'movement_period_average',
  'movement_inflation_cumulative',
  'period_total_growth',
  'segmented_growth',
]);

/** Group value modes for SUM-capable metrics. */
export const GROUP_MODES = Object.freeze(['observed', 'like_for_like']);

/** Hard cap on request-defined group size (abuse + determinism guard). */
export const MAX_GROUP_MEMBERS = 50;

export function entityError(code, message, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function normalizeIso3(raw) {
  if (raw === undefined || raw === null) return null;
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Parse one entity spec from its wire form:
 *   "country:IND" | "aggregate:WLD" | "group:IND,CHN,IDN"
 *
 * @param {string} raw wire value
 * @param {string|null} label optional label (custom groups only)
 */
export function parseEntitySpec(raw, label = null) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, 'An entity spec is required (e.g. "country:IND").');
  }
  const text = String(raw).trim();
  const colon = text.indexOf(':');
  if (colon < 0) {
    throw entityError(
      ENTITY_ERROR_CODES.INVALID_ENTITY,
      `Invalid entity "${text}". Expected "country:ISO3", "aggregate:CODE" or "group:ISO3,ISO3".`,
    );
  }
  const kind = text.slice(0, colon).trim().toLowerCase();
  const payload = text.slice(colon + 1).trim();
  if (kind === 'country') {
    const iso3 = normalizeIso3(payload);
    if (!iso3) {
      throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, `Invalid country entity "${text}". Expected a 3-letter ISO3 code.`);
    }
    if (label !== null && label !== undefined && String(label).trim() !== '') {
      throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, 'Labels are only accepted for custom groups; country names come from World Bank metadata.');
    }
    return { kind: ENTITY_KINDS.COUNTRY, iso3 };
  }
  if (kind === 'aggregate') {
    const code = normalizeIso3(payload);
    if (!code) {
      throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, `Invalid aggregate entity "${text}". Expected a 3-letter code.`);
    }
    if (label !== null && label !== undefined && String(label).trim() !== '') {
      throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, 'Labels are only accepted for custom groups; aggregate names come from World Bank metadata.');
    }
    return { kind: ENTITY_KINDS.OFFICIAL_AGGREGATE, iso3: code };
  }
  if (kind === 'group' || kind === 'custom_group') {
    const parts = payload.split(',').map((s) => s.trim()).filter((s) => s !== '');
    if (parts.length === 0) {
      throw entityError(ENTITY_ERROR_CODES.EMPTY_GROUP, 'A custom group needs at least one member ISO3 code (e.g. "group:IND,CHN").');
    }
    if (parts.length > MAX_GROUP_MEMBERS) {
      throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP, `A custom group holds at most ${MAX_GROUP_MEMBERS} members.`);
    }
    const members = [];
    for (const part of parts) {
      const iso3 = normalizeIso3(part);
      if (!iso3) {
        throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP_MEMBER, `Invalid group member "${part}". Expected 3-letter ISO3 codes.`);
      }
      members.push(iso3);
    }
    const duplicates = members.filter((m, i) => members.indexOf(m) !== i);
    if (duplicates.length > 0) {
      throw entityError(
        ENTITY_ERROR_CODES.INVALID_GROUP,
        `Duplicate group member(s): ${[...new Set(duplicates)].join(', ')}. Members must be unique.`,
      );
    }
    const cleanLabel = label === null || label === undefined || String(label).trim() === '' ? null : String(label).trim();
    if (cleanLabel !== null && cleanLabel.length > 80) {
      throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP, 'Group labels hold at most 80 characters.');
    }
    members.sort();
    return { kind: ENTITY_KINDS.CUSTOM_GROUP, members, label: cleanLabel };
  }
  throw entityError(
    ENTITY_ERROR_CODES.INVALID_ENTITY,
    `Unknown entity kind in "${text}". Expected "country", "aggregate" or "group".`,
  );
}

/**
 * Resolve a parsed spec against stored metadata (names + eligibility from DB).
 * Countries must be eligible (aggregates rejected as members/focus here);
 * aggregates must exist AND be flagged aggregate (never invented, never
 * hard-coded); group members must each be known eligible countries — the
 * first invalid member fails the whole group (strict mode, no silent drops).
 */
export async function resolveEntity(db, spec) {
  if (spec.kind === ENTITY_KINDS.COUNTRY) {
    const meta = await getCountry(db, spec.iso3);
    if (!meta || meta.is_aggregate === 1) {
      throw entityError(ENTITY_ERROR_CODES.INVALID_COUNTRY, `Unknown country "${spec.iso3}".`);
    }
    return {
      kind: ENTITY_KINDS.COUNTRY,
      iso3: spec.iso3,
      name: meta.name,
      source: ENTITY_SOURCES.WORLD_BANK,
    };
  }
  if (spec.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE) {
    const meta = await getCountry(db, spec.iso3);
    if (!meta) {
      throw entityError(
        ENTITY_ERROR_CODES.NO_OFFICIAL_AGGREGATE,
        `No official World Bank aggregate "${spec.iso3}". Aggregates are never invented.`,
      );
    }
    if (meta.is_aggregate !== 1) {
      throw entityError(
        ENTITY_ERROR_CODES.INVALID_ENTITY,
        `"${spec.iso3}" is an eligible country, not an official aggregate. Use "country:${spec.iso3}".`,
      );
    }
    return {
      kind: ENTITY_KINDS.OFFICIAL_AGGREGATE,
      iso3: spec.iso3,
      name: meta.name,
      source: ENTITY_SOURCES.WORLD_BANK,
    };
  }
  if (spec.kind === ENTITY_KINDS.CUSTOM_GROUP) {
    const rows = await getCountriesByIso3List(db, spec.members);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const iso3 of spec.members) {
      const meta = byId.get(iso3);
      if (!meta) {
        throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP_MEMBER, `Unknown group member "${iso3}".`);
      }
      if (meta.is_aggregate === 1) {
        throw entityError(
          ENTITY_ERROR_CODES.INVALID_GROUP_MEMBER,
          `Group member "${iso3}" is an official aggregate, not a country. Aggregates cannot be group members.`,
        );
      }
    }
    const label = spec.label ?? `User-selected group (${spec.members.length})`;
    return {
      kind: ENTITY_KINDS.CUSTOM_GROUP,
      label,
      members: [...spec.members],
      memberNames: Object.fromEntries(spec.members.map((iso3) => [iso3, byId.get(iso3).name])),
      source: ENTITY_SOURCES.USER_DEFINED,
    };
  }
  throw entityError(ENTITY_ERROR_CODES.INVALID_ENTITY, 'Unknown entity kind.');
}

/**
 * Capability matrix: entity types + metric semantics + operation.
 * Returns {allowed, reason} — never throws for capability outcomes (parse/
 * resolution errors throw above; those are invalid requests, not unsupported
 * combinations).
 *
 * Rules:
 *  - cross_rate: both entities must be countries; metric must allow
 *    CROSS_RATE via quotation metadata (Phase-3 canTransform).
 *  - raw level comparison of NEUTRAL metrics (quoted FX, index levels)
 *    between two different countries is disabled: cross-currency quote
 *    magnitudes and cross-basket index points are not comparable
 *    quantities. Same-entity identity and movement operations are
 *    unaffected.
 *  - any custom group value: metric aggregation must be SUM or
 *    WEIGHTED_RATIO (the latter resolves numerator/denominator legs via
 *    requiredDenominator); per-capita/rates/FX/index refuse via
 *    NOT_AGGREGATABLE.
 *  - change operations (absolute/percent/cagr): metric must declare them
 *    (Phase-3 canTransform on validChangeTypes).
 *  - official aggregates: always comparable as published entities; the
 *    movement entered/exited decomposition is NEVER attached (no member
 *    universe exists) — enforced structurally by the compare service,
 *    which has no decomposition path for aggregates.
 */
/**
 * The metric registry declares which entity kinds may take part in a
 * comparison. It is authoritative: the frontend's option list is a
 * convenience, never the validation.
 *
 * The mismatch is reported separately from the capability verdict so the
 * service can distinguish a COMPARISON refusal (the pair may be addressed,
 * but no derived result may be computed over it) from a request refusal
 * (the request itself is not answerable). An entity whose published series
 * does not exist is still reported as explicitly unavailable — an aggregate
 * is never invented — but no gap, change or growth may be derived against
 * an entity kind the metric does not support.
 *
 * @param {object} metric registry entry
 * @param {object} entityA
 * @param {object} entityB
 * @returns {{token:string, kind:string}|null}
 */
export function comparisonCapabilityMismatch(metric, entityA, entityB) {
  const declared = Array.isArray(metric?.comparisonCapability) ? metric.comparisonCapability : [];
  if (declared.length === 0) return null;
  for (const entity of [entityA, entityB]) {
    const token = CAPABILITY_TOKEN_BY_KIND[entity?.kind];
    if (token && !declared.includes(token)) return { token, kind: entity.kind };
  }
  return null;
}

export function canCompare({ entityA, entityB, metric, operation }) {
  if (!COMPARE_OPERATIONS.includes(operation)) {
    return { allowed: false, reason: ENTITY_ERROR_CODES.INVALID_OPERATION };
  }
  if (!metric || !metric.key) {
    return { allowed: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION };
  }
  const kinds = [entityA.kind, entityB.kind];
  const hasGroup = kinds.includes(ENTITY_KINDS.CUSTOM_GROUP);

  if (comparisonCapabilityMismatch(metric, entityA, entityB)) {
    return { allowed: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_ENTITY_COMBINATION };
  }

  if (operation === TRANSFORMS.CROSS_RATE || operation === 'cross_rate') {
    if (entityA.kind !== ENTITY_KINDS.COUNTRY || entityB.kind !== ENTITY_KINDS.COUNTRY) {
      return { allowed: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_ENTITY_COMBINATION };
    }
    const gate = canTransform(metric, TRANSFORMS.CROSS_RATE);
    return gate.allowed
      ? { allowed: true, reason: null }
      : { allowed: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION };
  }

  // NEUTRAL metrics (quoted exchange rates, index levels) have no
  // meaningful cross-entity level ordering: 83 INR/USD vs 150 JPY/USD are
  // different units, and index points live in different country baskets.
  // Disabled by default per approved FX/index semantics; movement and
  // cross-rate operations are unaffected.
  if (
    operation === 'level' &&
    metric.rankingDirection === 'NEUTRAL' &&
    entityA.kind === ENTITY_KINDS.COUNTRY &&
    entityB.kind === ENTITY_KINDS.COUNTRY &&
    entityA.iso3 !== entityB.iso3
  ) {
    return { allowed: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_ENTITY_COMBINATION };
  }

  if (hasGroup) {
    if (metric.aggregation === 'SUM' || metric.aggregation === 'WEIGHTED_RATIO') {
      return checkPointOperation(metric, operation);
    }
    return { allowed: false, reason: ENTITY_ERROR_CODES.NOT_AGGREGATABLE };
  }
  return checkPointOperation(metric, operation);
}

/**
 * Point-operation capability: the analysis planner owns the metric gate for
 * every operation (change types, period aggregation, cross-rate quotation),
 * so this layer never re-implements the metadata rules.
 */
function checkPointOperation(metric, operation) {
  const gate = gateCompareAnalysis(operation, metric);
  return gate.allowed
    ? { allowed: true, reason: null }
    : { allowed: false, reason: gate.reason };
}

/**
 * Cross-rate leg validation (orchestration-level, no DB): same year, both
 * legs present/finite/positive, compatible quotation conventions.
 * Pure rows in, explicit reason out — Phase 5 wires stored legs through this.
 */
export function validateCrossRateLegs(metric, legA, legB) {
  if (!metric || metric.observationType !== 'QUOTED_RATE' || metric.quotation?.convention !== 'LCU_PER_USD') {
    return { valid: false, reason: ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION };
  }
  for (const [name, leg] of [['A', legA], ['B', legB]]) {
    if (!leg || leg.value === null || leg.value === undefined) {
      return { valid: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, detail: `leg ${name} has no observation` };
    }
    if (typeof leg.value !== 'number' || !Number.isFinite(leg.value)) {
      return { valid: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, detail: `leg ${name} is not finite` };
    }
    if (leg.value <= 0) {
      return { valid: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, detail: `leg ${name} is not positive` };
    }
  }
  if (legA.year !== legB.year) {
    return { valid: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, detail: 'legs are from different years' };
  }
  if (legA.quotation && legB.quotation && legA.quotation !== legB.quotation) {
    return { valid: false, reason: ENTITY_ERROR_CODES.INCOMPATIBLE_QUOTATION, detail: `${legA.quotation} vs ${legB.quotation}` };
  }
  return { valid: true, reason: null };
}

export default {
  ENTITY_KINDS,
  ENTITY_SOURCES,
  ENTITY_ERROR_CODES,
  COMPARE_OPERATIONS,
  GROUP_MODES,
  MAX_GROUP_MEMBERS,
  entityError,
  parseEntitySpec,
  resolveEntity,
  canCompare,
  comparisonCapabilityMismatch,
  validateCrossRateLegs,
};
