/**
 * GENERIC ENTITY COMPARISON SERVICE (Compare tab, orchestration only).
 *
 * One comparison architecture for every entity combination: resolve entities
 * (services/entities.js), plan the analysis (domain/compareAnalysis.js),
 * check capability (entity types + metric semantics + operation), read stored
 * observations atomically, build ONE frozen comparison universe
 * (domain/compareUniverse.js), assemble entity values from it, apply the
 * approved transforms (domain/transforms.js) and attach RAW vs APP_DERIVED
 * provenance. Annual Level positions use the same family rankers as Movement;
 * pairwise differences are not turned into leaderboard ranks.
 *
 * Three structural guarantees:
 *  - official aggregates are compared as published entities (direct
 *    observations). The entered/exited/common decomposition is never
 *    attached: no member universe exists for an aggregate. A published
 *    aggregate is never reconstructed by summing countries.
 *  - custom groups never enter a ranking universe. Group values exist only
 *    inside this comparison response, labelled user-selected.
 *  - ONE universe per request. The like-for-like result of every entity and
 *    every period is derived from the same frozen complete universe under
 *    the same completeness rule; a participant never enters the peer
 *    reference set.
 *
 * Missing-data principle: a derived result is published only when every
 * observation its approved methodology requires exists. A partial observed
 * group subtotal is published ONLY with an explicit partial-coverage
 * marker, and every derived result that depends on it is blocked.
 */

import { METRICS } from '../config.js';
import {
  getEligibleObservationsForYears,
  getIndicatorByMetricKey,
  getObservationsForEntityList,
} from '../db/repository.js';
import { describeMeasure } from '../domain/format.js';
import {
  TRANSFORMS,
  TRANSFORM_FORMULAS,
  computeTransform,
  crossRate,
  groupRatioFromSums,
  groupSum,
  periodSum,
  periodAverage,
  periodSumPercentChange,
} from '../domain/transforms.js';
import { periodAverageInflation, cumulativeInflation, basesForMetric as pricesBasesForMetric } from '../domain/pricesMovement.js';
import { tradePeriodTotal, tradePeriodAverage, tradeBasesForMetric } from '../domain/tradeMovement.js';
import { capitalPeriodSum, capitalPeriodAverage, capitalBasesForMetric } from '../domain/capitalMovement.js';
import { externalPeriodSum, externalPeriodAverage, externalBasesForMetric } from '../domain/externalMovement.js';
import { fxBasesForMetric } from '../domain/fxMovement.js';
import { populationBasesForMetric } from '../domain/populationMovement.js';
import { rankByValue } from '../domain/ranking.js';
import { rankCompetitionAsc } from '../domain/pricesMovement.js';
import { rankTradeDesc } from '../domain/tradeMovement.js';
import { rankCapitalDesc } from '../domain/capitalMovement.js';
import { rankExternalDesc } from '../domain/externalMovement.js';
import { rankPopulationDesc } from '../domain/populationMovement.js';
import { rankFxDirected } from '../domain/fxMovement.js';
import { COMPARE_REASON_CODES, resolveComparePlan } from '../domain/compareAnalysis.js';
import {
  COVERAGE_BASIS,
  buildCompareUniverse,
  buildEntityCoverage,
  buildPointCoverage,
} from '../domain/compareUniverse.js';
import { sourceAttribution } from './attribution.js';
import {
  compareCacheKey,
  compareInvalidationSignals,
  getCachedCompare,
  setCachedCompare,
} from './compareCache.js';
import { buildCompareMovementBasisResponse, compareAnalysesForBasis, compareBasisMetricForAnalysis } from './compareMovementBasis.js';
import {
  COMPARE_OPERATIONS,
  ENTITY_ERROR_CODES,
  ENTITY_KINDS,
  GROUP_MODES,
  canCompare,
  comparisonCapabilityMismatch,
  entityError,
  parseEntitySpec,
  resolveEntity,
  validateCrossRateLegs,
} from './entities.js';

/** Compare-specific blocking reasons produced by this service. */
export const COMPARE_BLOCK_CODES = Object.freeze({
  COVERAGE_INCOMPLETE: 'COVERAGE_INCOMPLETE',
  AGGREGATE_COVERAGE_NOT_COMPARABLE: 'AGGREGATE_COVERAGE_NOT_COMPARABLE',
  EMPTY_COMMON_UNIVERSE: 'EMPTY_COMMON_UNIVERSE',
  MISSING_REQUIRED_DATA: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
  PARTIAL_COMPARISON: 'PARTIAL_COMPARISON',
});

function compareBasisIdsForMetric(metricKey) {
  const registered = [
    ...pricesBasesForMetric(metricKey),
    ...tradeBasesForMetric(metricKey),
    ...capitalBasesForMetric(metricKey),
    ...externalBasesForMetric(metricKey),
    ...fxBasesForMetric(metricKey),
    ...populationBasesForMetric(metricKey),
  ];
  registered.push(metricKey);

  // GDP and GDP-per-capita: every registered price/currency variant of the
  // same subject is a valid measurement basis for any variant of that subject.
  const metric = METRICS[metricKey];
  if (metric?.subject === 'gdp_total' || metric?.subject === 'gdp_per_capita') {
    const subject = metric.subject;
    return Object.keys(METRICS).filter((k) => METRICS[k].subject === subject);
  }

  if (registered.length > 1) return registered;
  if (METRICS[metricKey]?.subject === 'gdp_total' || METRICS[metricKey]?.subject === 'gdp_per_capita') return [metricKey];
  return [metricKey, 'level', 'growth', 'period_total', 'period_average'];
}

function gapUnitFor(metric) {
  if (metric.observationType === 'RATE' || metric.observationType === 'RATIO') return 'percentage points';
  if (metric.observationType === 'INDEX') return 'index points';
  return metric.unitLong ?? metric.unit ?? null;
}

/** Split rows into a year -> rows map. */
function indexRowsByYear(rows, years) {
  const map = new Map(years.map((y) => [y, []]));
  for (const row of rows ?? []) {
    if (map.has(row.year)) map.get(row.year).push(row);
  }
  return map;
}

/** Sorted unique integer years. */
function uniqueYears(...lists) {
  const out = new Set();
  for (const list of lists) {
    for (const year of list ?? []) {
      if (Number.isInteger(year)) out.add(year);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Read one country/aggregate entity's own observations over the requested
 * years (RAW provenance). Missing stays missing. Official aggregates are read
 * from the very same stored observations: their published value is used as
 * published and never recomputed from constituent countries.
 *
 * @returns {{values: Map<number, {value:number, valueRaw:string, wbLastUpdated:string|null}>, vintageLegs: string[]}}
 */
function readEntityValues(entityRowsByIso3, entity, years) {
  const values = new Map();
  const vintageLegs = [];
  for (const year of years) values.set(year, null);
  const rows = entityRowsByIso3.get(entity.iso3) ?? [];
  for (const row of rows) {
    if (!values.has(row.year)) continue;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    values.set(row.year, {
      value,
      valueRaw: row.valueRaw ?? String(row.value),
      wbLastUpdated: row.wbLastUpdated ?? null,
    });
    if (row.wbLastUpdated) vintageLegs.push(row.wbLastUpdated);
  }
  return { values, vintageLegs };
}

/**
 * Build APP_DERIVED group series for the requested years.
 *
 * observed[Y]      = sum of the members valid in Y. A year in which some
 *                    member is missing is published ONLY as an explicitly
 *                    partial subtotal (complete:false + the missing list);
 *                    every derived result that depends on it is blocked.
 * likeForLike[Y]   = sum over (members AND the frozen complete universe) —
 *                    the ONE common set, identical for every entity and
 *                    every period of the request.
 * membershipEffect = observed absolute change - like-for-like absolute
 *                    change (exact: sums decompose; never a fabricated rate)
 *
 * @param {Set<string>|null} completeSet the frozen complete universe
 */
function buildGroupSeries(entity, memberRowsByYear, years, metric, completeSet) {
  const observed = {};
  const likeForLike = {};
  const coverage = {};
  for (const year of years) {
    const rows = memberRowsByYear.get(year) ?? [];
    const valid = rows.map((r) => r.iso3).sort();
    const validSet = new Set(valid);
    const missing = entity.members.filter((iso3) => !validSet.has(iso3));
    const sum = groupSum(rows.map((r) => r.value), metric);
    const complete = missing.length === 0;
    observed[year] = {
      value: sum.value,
      valueRaw: sum.value === null ? null : String(sum.value),
      members: valid.length,
      complete,
      missingCount: missing.length,
      missingIso3: missing,
      requiredYears: [...years],
      partialReason: complete ? null : 'missing_member_observations',
      provenance: 'APP_DERIVED',
      derivation: { operation: 'GROUP_SUM', formula: 'sum(members)', metricKey: metric.key },
    };
    coverage[year] = { valid, missing, validCount: valid.length, missingCount: missing.length };
  }

  // Like-for-like: the members that satisfy the ONE frozen completeness
  // requirement (present at EVERY required observation year). Derived from
  // the shared universe, never from a per-group intersection.
  const common = completeSet
    ? entity.members.filter((iso3) => completeSet.has(iso3)).sort()
    : (() => {
        let acc = null;
        for (const year of years) {
          const set = new Set((memberRowsByYear.get(year) ?? []).map((r) => r.iso3));
          acc = acc === null ? [...set] : acc.filter((iso3) => set.has(iso3));
        }
        return [...(acc ?? [])].sort();
      })();
  const commonSet = new Set(common);
  for (const year of years) {
    const rows = (memberRowsByYear.get(year) ?? []).filter((r) => commonSet.has(r.iso3));
    const sum = groupSum(rows.map((r) => r.value), metric);
    likeForLike[year] = {
      value: sum.value,
      valueRaw: sum.value === null ? null : String(sum.value),
      members: rows.length,
      // A like-for-like value is complete BY CONSTRUCTION over the frozen
      // common set: members that could not be retained are disclosed, not
      // treated as a partial subtotal.
      complete: sum.value !== null,
      missingCount: entity.members.length - common.length,
      missingIso3: entity.members.filter((iso3) => !commonSet.has(iso3)),
      requiredYears: [...years],
      partialReason: null,
      provenance: 'APP_DERIVED',
      derivation: { operation: 'GROUP_SUM', formula: 'sum(common members)', metricKey: metric.key },
    };
  }
  coverage.common = common;
  coverage.commonCount = common.length;
  coverage.observedOnlyA = years.length > 1 ? (coverage[years[0]]?.valid.filter((iso3) => !commonSet.has(iso3)) ?? []) : [];
  coverage.observedOnlyB = years.length > 1 ? (coverage[years[years.length - 1]]?.valid.filter((iso3) => !commonSet.has(iso3)) ?? []) : [];

  let membershipEffect = null;
  if (years.length > 1) {
    const [yearA, yearB] = [years[0], years[years.length - 1]];
    const obsA = observed[yearA]?.value;
    const obsB = observed[yearB]?.value;
    const lflA = likeForLike[yearA]?.value;
    const lflB = likeForLike[yearB]?.value;
    if ([obsA, obsB, lflA, lflB].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      membershipEffect = {
        absolute: obsB - obsA - (lflB - lflA),
        unit: metric.unitLong ?? metric.unit ?? null,
        note: 'Observed absolute change minus like-for-like absolute change: the coverage/membership contribution. Within-member change is the like-for-like component.',
      };
    }
  }
  return { observed, likeForLike, coverage, membershipEffect };
}

/**
 * WEIGHTED GROUP RATIO series (Phase 7C-2): SUM(numerator legs) /
 * SUM(denominator legs) x 100 for the same group and year — e.g. group
 * FDI % GDP from member FDI inflows over member total GDP. Never
 * average(member ratios), never sum(member ratios).
 *
 * Strict per-year completeness: every member must hold BOTH legs, else the
 * whole year is unavailable with an explicit reason — never a partial ratio.
 * Basis compatibility check: numerator and denominator must share
 * priceBasis and currencyBasis, else INCOMPATIBLE_LEGS. Vintage coherence is
 * enforced WITHIN each leg family. Like-for-like restricts to the members
 * that satisfy the ONE frozen completeness requirement.
 *
 * @param {Set<string>|null} completeSet the frozen complete universe
 */
export function buildGroupRatioSeries(entity, numRowsByYear, denRowsByYear, years, metric, denMetric, completeSet) {
  const observed = {};
  const likeForLike = {};
  const coverage = {};
  const numMetric = metric.requiredDenominator?.numeratorMetric
    ? (METRICS[metric.requiredDenominator.numeratorMetric] ?? null)
    : null;
  if (!numMetric) {
    throw entityError(
      ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION,
      `Metric "${metric.key}" declares WEIGHTED_RATIO without a registered requiredDenominator.numeratorMetric linkage.`,
    );
  }
  const basisOk =
    numMetric.priceBasis === denMetric.priceBasis && numMetric.currencyBasis === denMetric.currencyBasis;
  const basisDetail =
    `numerator legs ${numMetric.key} (${numMetric.priceBasis}/${numMetric.currencyBasis}) vs ` +
    `denominator legs ${denMetric.key} (${denMetric.priceBasis}/${denMetric.currencyBasis}) ` +
    `(requiredDenominator.basis: ${metric.requiredDenominator?.basis ?? 'undeclared'})`;

  const ratioFor = (year, members) => {
    const numByIso = new Map(((numRowsByYear.get(year) ?? []).map((r) => [r.iso3, r])));
    const denByIso = new Map(((denRowsByYear.get(year) ?? []).map((r) => [r.iso3, r])));
    const valid = members.filter((iso3) => numByIso.has(iso3) && denByIso.has(iso3)).sort();
    const missingNumerators = members.filter((iso3) => !numByIso.has(iso3));
    const missingDenominators = members.filter((iso3) => !denByIso.has(iso3));
    const numVintages = new Set(valid.map((iso3) => numByIso.get(iso3).wbLastUpdated).filter((v) => v !== null && v !== undefined));
    const denVintages = new Set(valid.map((iso3) => denByIso.get(iso3).wbLastUpdated).filter((v) => v !== null && v !== undefined));
    const vintages = new Set([...numVintages, ...denVintages]);
    const derivation = {
      operation: 'GROUP_RATIO_FROM_SUMS',
      formula: 'sum(numerator legs) / sum(denominator legs) x 100',
      metricKey: metric.key,
      numeratorMetric: numMetric.key,
      denominatorMetric: denMetric.key,
    };
    const missingUnion = [...new Set([...missingNumerators, ...missingDenominators])].sort();
    const base = {
      members: valid.length,
      complete: missingUnion.length === 0,
      missingCount: missingUnion.length,
      missingIso3: missingUnion,
      provenance: 'APP_DERIVED',
      derivation,
      coverage: {
        valid,
        missing: missingUnion,
        missingNumerators,
        missingDenominators,
        validCount: valid.length,
        missingCount: missingUnion.length,
      },
    };
    if (!basisOk) {
      return {
        entry: { value: null, valueRaw: null, reason: ENTITY_ERROR_CODES.INCOMPATIBLE_LEGS, detail: basisDetail, ...base },
        vintages,
      };
    }
    if (missingNumerators.length > 0 || missingDenominators.length > 0) {
      const detail = [
        missingNumerators.length > 0 ? `missing ${metric.key} legs: ${missingNumerators.join(', ')}` : null,
        missingDenominators.length > 0 ? `missing ${denMetric.key} legs: ${missingDenominators.join(', ')}` : null,
      ].filter(Boolean).join('; ');
      return {
        entry: { value: null, valueRaw: null, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, detail, ...base },
        vintages,
      };
    }
    if (vintages.size > 1 && (numVintages.size > 1 || denVintages.size > 1)) {
      return {
        entry: {
          value: null,
          valueRaw: null,
          reason: ENTITY_ERROR_CODES.INCOMPATIBLE_LEGS,
          detail: `ratio legs carry mixed World Bank vintages within one series: numerators [${[...numVintages].sort().join(', ')}], denominators [${[...denVintages].sort().join(', ')}]`,
          ...base,
        },
        vintages,
      };
    }
    const computed = groupRatioFromSums(
      { numerators: valid.map((iso3) => numByIso.get(iso3).value), denominators: valid.map((iso3) => denByIso.get(iso3).value) },
      metric,
    );
    if (!computed.computable) {
      return {
        entry: { value: null, valueRaw: null, reason: computed.reason, detail: computed.description, ...base },
        vintages,
      };
    }
    return {
      entry: { value: computed.value, valueRaw: String(computed.value), reason: null, detail: null, ...base },
      vintages,
    };
  };

  const allVintages = new Set();
  for (const year of years) {
    const { entry, vintages } = ratioFor(year, entity.members);
    for (const vintage of vintages) allVintages.add(vintage);
    const { coverage: yearCoverage, ...rest } = entry;
    observed[year] = rest;
    coverage[year] = yearCoverage;
  }
  // Like-for-like: the members that satisfy the ONE frozen completeness rule.
  const common = completeSet
    ? entity.members.filter((iso3) => completeSet.has(iso3)).sort()
    : (() => {
        let acc = new Set(entity.members);
        for (const year of years) {
          const yearValid = new Set(coverage[year]?.valid ?? []);
          for (const iso3 of [...acc]) if (!yearValid.has(iso3)) acc.delete(iso3);
        }
        return [...acc].sort();
      })();
  const commonSet = new Set(common);
  for (const year of years) {
    const { entry } = ratioFor(year, common);
    const { coverage: _ignored, ...rest } = entry;
    likeForLike[year] = rest;
  }
  coverage.common = common;
  coverage.commonCount = common.length;
  coverage.observedOnlyA = years.length > 1 ? ((coverage[years[0]]?.valid ?? []).filter((iso3) => !commonSet.has(iso3))) : [];
  coverage.observedOnlyB = years.length > 1 ? ((coverage[years[years.length - 1]]?.valid ?? []).filter((iso3) => !commonSet.has(iso3))) : [];

  let membershipEffect = null;
  if (years.length > 1) {
    const [yearA, yearB] = [years[0], years[years.length - 1]];
    const obsA = observed[yearA]?.value;
    const obsB = observed[yearB]?.value;
    const lflA = likeForLike[yearA]?.value;
    const lflB = likeForLike[yearB]?.value;
    if ([obsA, obsB, lflA, lflB].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      membershipEffect = {
        absolute: obsB - obsA - (lflB - lflA),
        unit: metric.unitLong ?? metric.unit ?? null,
        note: 'Observed ratio change minus like-for-like ratio change: the coverage/membership contribution. Within-member change is the like-for-like component.',
      };
    }
  }
  return { observed, likeForLike, coverage, membershipEffect, vintages: [...allVintages].sort() };
}

/** Participant list for the frozen universe: country entities + group members. */
function participantsFor(entityA, entityB) {
  const participants = [];
  for (const entity of [entityA, entityB]) {
    if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
      for (const iso3 of entity.members) participants.push({ iso3, role: 'group_member' });
    } else if (entity.iso3) {
      participants.push({ iso3: entity.iso3, role: 'entity' });
    }
  }
  return participants;
}

/**
 * Overlap / nesting diagnostics for the two selected custom groups.
 * An official aggregate's membership is not stored, so an aggregate/group
 * overlap cannot be computed from stored data and is reported as such
 * instead of being silently ignored.
 */
function membershipDiagnostics(entityA, entityB) {
  const isGroup = (e) => e.kind === ENTITY_KINDS.CUSTOM_GROUP;
  const isAggregate = (e) => e.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE;
  if (isGroup(entityA) && isGroup(entityB)) {
    const a = new Set(entityA.members);
    const shared = entityB.members.filter((iso3) => a.has(iso3)).sort();
    const aOnly = entityA.members.filter((iso3) => !new Set(entityB.members).has(iso3)).sort();
    const bOnly = entityB.members.filter((iso3) => !a.has(iso3)).sort();
    let nested = null;
    if (shared.length > 0) {
      if (bOnly.length === 0 && aOnly.length > 0) nested = 'a_contains_b';
      else if (aOnly.length === 0 && bOnly.length > 0) nested = 'b_contains_a';
      else if (aOnly.length === 0 && bOnly.length === 0) nested = 'identical';
    }
    return {
      kind: 'group_group',
      shared,
      sharedCount: shared.length,
      onlyA: aOnly,
      onlyB: bOnly,
      nested,
      note: shared.length > 0
        ? 'The two groups share members; each group total still counts its own members once.'
        : 'The two groups share no members.',
    };
  }
  const group = isGroup(entityA) ? entityA : isGroup(entityB) ? entityB : null;
  const aggregate = isAggregate(entityA) ? entityA : isAggregate(entityB) ? entityB : null;
  if (group && aggregate) {
    return {
      kind: 'group_aggregate',
      shared: null,
      sharedCount: null,
      nested: null,
      note:
        'The official aggregate is compared as the published World Bank value; its member list is not stored, ' +
        'so its overlap with the selected group cannot be computed from stored data.',
    };
  }
  return { kind: 'none', shared: null, sharedCount: null, nested: null, note: null };
}

/** Build the per-entity series used by the verified charts. */
function buildSeries({ entity, mode, years, values, groupSeries, groupMembers, commonMembers }) {
  const points = [];
  const partialYears = [];
  if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
    for (const year of years) {
      const source = mode === 'like_for_like' ? groupSeries.likeForLike[year] : groupSeries.observed[year];
      const complete = source?.complete === true;
      if (!complete) partialYears.push(year);
      points.push({ year, value: complete ? source.value : null, complete });
    }
    return {
      basis: mode === 'like_for_like' ? COVERAGE_BASIS.COMMON_UNIVERSE : COVERAGE_BASIS.COMMON_UNIVERSE,
      points,
      partialYears,
      members: mode === 'like_for_like' ? (commonMembers ?? groupMembers) : groupMembers,
      note:
        'Group series points are emitted only where the group is complete for that year; a partial or missing ' +
        'year is a gap, never an interpolated or zero-filled point.',
    };
  }
  for (const year of years) {
    const entry = values.get(year);
    points.push({ year, value: entry ? entry.value : null, complete: entry !== null });
  }
  return {
    basis: entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE ? COVERAGE_BASIS.WORLD_BANK_PUBLISHED : COVERAGE_BASIS.ENTITY_OWN_OBSERVATION,
    points,
    partialYears: [],
    members: entity.iso3 ? [entity.iso3] : [],
    note:
      entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE
        ? 'The officially published World Bank aggregate series, used as published.'
        : 'The entity’s own stored World Bank observations.',
  };
}

/** Entity value at one year for the requested mode. */
function entityValueAt(slot, mode, year, modeValues) {
  if (slot.kind === ENTITY_KINDS.CUSTOM_GROUP) {
    const block = mode === 'like_for_like' ? slot.likeForLike : slot.observed;
    const entry = block?.[year];
    if (!entry) return { value: null, complete: false, entry: null };
    return { value: entry.value ?? null, complete: entry.complete === true, entry };
  }
  const entry = modeValues?.[year];
  if (!entry) return { value: null, complete: false, entry: null };
  return { value: entry.value ?? null, complete: entry.complete === true, entry };
}

/**
 * Generic entity comparison.
 *
 * @param {object} db
 * @param {{entityA:string, entityB:string, labelA?:string, labelB?:string,
 *   metricKey:string, yearA:number, yearB?:number, yearC?:number,
 *   operation?:string, groupMode?:string}} options
 */
export async function buildCompareResponse(db, options = {}) {
  const metric = METRICS[options.metricKey];
  if (!metric) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_INDICATOR, `Unknown indicator "${options.metricKey}".`);
  }
  const operation = options.operation ?? 'level';
  // `basis` is a separate, URL-shareable methodology selector. Until a
  // metric declares a different registered basis, legacy callers use the
  // metric's raw observation basis. Preserve the selected id in all outputs
  // and cache identity so methodology cannot be lost between request layers.
  const basis = options.basis ?? metric.key;
  if (typeof basis !== 'string' || basis.trim() === '') {
    throw entityError(ENTITY_ERROR_CODES.INVALID_BASIS, 'A non-empty registered basis is required.');
  }
  if (!compareBasisIdsForMetric(metric.key).includes(basis)) {
    throw entityError(
      ENTITY_ERROR_CODES.INVALID_BASIS,
      `Basis "${basis}" is not registered for metric "${metric.key}".`,
    );
  }
  const groupMode = options.groupMode ?? 'observed';
  if (!COMPARE_OPERATIONS.includes(operation)) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_OPERATION, `Unknown operation "${options.operation}". Expected one of ${COMPARE_OPERATIONS.join(', ')}.`);
  }
  const basisAnalyses = compareAnalysesForBasis(basis);
  if (basisAnalyses && !basisAnalyses.includes(operation)) {
    throw entityError(
      ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION,
      `Analysis "${operation}" is not registered for basis "${basis}". Supported analyses: ${basisAnalyses.join(', ')}.`,
    );
  }
  if (!GROUP_MODES.includes(groupMode)) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP_MODE, `Unknown group mode "${options.groupMode}". Expected "observed" or "like_for_like".`);
  }

  // GDP and GDP-per-capita basis variants: the basis id is itself a canonical
  // metric key for the same subject. Resolve to that variant so calculations
  // use the correct source series, units, and rankings.
  const gdpBasisMetric =
    basis &&
    METRICS[basis] &&
    METRICS[basis].subject === metric.subject &&
    (metric.subject === 'gdp_total' || metric.subject === 'gdp_per_capita')
      ? METRICS[basis]
      : null;
  const planMetric =
    gdpBasisMetric ?? compareBasisMetricForAnalysis(metric, basis, operation) ?? metric;
  const plan = resolveComparePlan({
    operation,
    metric: planMetric,
    yearA: options.yearA,
    yearB: options.yearB ?? null,
    yearC: options.yearC ?? null,
  });
  if (plan.error) {
    throw entityError(plan.error.code, plan.error.message);
  }

  const entityA = await resolveEntity(db, parseEntitySpec(options.entityA, options.labelA ?? null));
  const entityB = await resolveEntity(db, parseEntitySpec(options.entityB, options.labelB ?? null));

  const capability = canCompare({ entityA, entityB, metric: planMetric, operation });
  const capabilityMismatch = comparisonCapabilityMismatch(metric, entityA, entityB);
  if (!capability.allowed && !capabilityMismatch) {
    throw entityError(capability.reason, `Comparison not supported for this entity/metric/operation combination (${capability.reason}).`);
  }
  // A capability mismatch is NOT a request refusal: the entity stays
  // addressable and its published value keeps its own availability (an
  // aggregate is never invented), but no derived result may be computed over
  // a combination the approved metric registry does not support.
  const capabilityBlock = capabilityMismatch
    ? {
        allowed: false,
        reason: ENTITY_ERROR_CODES.UNSUPPORTED_ENTITY_COMBINATION,
        detail:
          `The measure "${metric.key}" does not support a comparison with ` +
          `${capabilityMismatch.token === 'OFFICIAL_AGGREGATE' ? 'an official aggregate' : capabilityMismatch.token === 'CUSTOM_GROUP' ? 'a custom group' : 'a country'}.`,
        token: capabilityMismatch.token,
      }
    : null;

  const movementBasisResponse = await buildCompareMovementBasisResponse(db, {
    metric,
    basis,
    operation,
    groupMode,
    entityA,
    entityB,
    plan,
    capability,
    capabilityMismatch,
    entitySpecA: options.entityA,
    entitySpecB: options.entityB,
    labelA: options.labelA,
    labelB: options.labelB,
  });
  if (movementBasisResponse) return movementBasisResponse;

  const indicator = await getIndicatorByMetricKey(db, options.metricKey);
  if (!indicator) {
    return {
      available: false,
      reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
      entities: { a: entityA, b: entityB },
      metric: describeMeasure(metric),
      years: { a: options.yearA, b: options.yearB ?? null, c: options.yearC ?? null },
      operation,
      basis,
      groupMode,
      mode: groupMode,
      analysis: null,
      capability,
      results: null,
      universe: null,
      diagnostics: [],
      vintage: null,
      source: sourceAttribution(),
    };
  }

  // ---- one atomic read covers every eligible country, every required year
  //      and every chart year; a concurrent refresh cannot move one side.
  const requiredYears = plan.requiredObservationYears;
  const seriesYears = plan.seriesYears;
  const allYears = uniqueYears(requiredYears, seriesYears);

  // ---- bounded Compare cache (per database) ------------------------------
  // Every input that changes the result is part of the key: dataset content
  // version, indicator, operation, mode, entity specs (a group's spec IS its
  // membership fingerprint), labels and the three years.
  const { contentVersion, signature } = await compareInvalidationSignals(db, indicator.id, allYears);
  const cacheKey = compareCacheKey({
    contentVersion,
    signature,
    metricKey: options.metricKey,
    basis,
    operation,
    mode: groupMode,
    entityA: options.entityA,
    entityB: options.entityB,
    labelA: options.labelA ?? '',
    labelB: options.labelB ?? '',
    yearA: plan.periods.a,
    yearB: plan.periods.b,
    yearC: plan.periods.c,
  });
  const cached = getCachedCompare(db, cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const eligibleRows = await getEligibleObservationsForYears(db, indicator.id, allYears);
  const eligibleByYear = indexRowsByYear(eligibleRows, allYears);
  const requiredByYear = new Map(requiredYears.map((y) => [y, eligibleByYear.get(y) ?? []]));

  // Country/aggregate observations of the two entities (aggregates are not
  // part of the eligible read by design; they are read as published).
  const entityIso3s = [entityA.iso3, entityB.iso3].filter((iso3) => typeof iso3 === 'string' && iso3);
  const entityRows = entityIso3s.length > 0
    ? await getObservationsForEntityList(db, indicator.id, entityIso3s, allYears)
    : [];
  const entityRowsByIso3 = new Map();
  for (const row of entityRows) {
    if (!entityRowsByIso3.has(row.iso3)) entityRowsByIso3.set(row.iso3, []);
    entityRowsByIso3.get(row.iso3).push(row);
  }

  // ---- ONE frozen universe for the whole request --------------------------
  const participants = participantsFor(entityA, entityB);
  const universe = buildCompareUniverse({
    rowsByYear: requiredByYear,
    requiredObservationYears: requiredYears,
    participants,
    mode: groupMode,
  });
  const completeSet = new Set(universe.complete);
  const levelRankingsByYear = {};
  if (operation === 'level') {
    for (const year of plan.requiredObservationYears) {
      const rows = (eligibleByYear.get(year) ?? [])
        .filter((row) => groupMode !== 'like_for_like' || completeSet.has(row.iso3))
        .map((row) => ({ iso3: row.iso3, name: row.name ?? null, value: Number(row.value), valueRaw: row.valueRaw ?? null }));
      const frame = rankAnnualMovementValues(metric, rows);
      if (frame) levelRankingsByYear[year] = frame;
    }
  }
  const movementRankingsByInterval = {};
  if (['movement_period_total', 'movement_period_average', 'movement_inflation_cumulative'].includes(operation)) {
    for (const interval of plan.intervals) {
      const years = interval.years ?? [];
      const rows = [];
      const candidates = new Set((eligibleByYear.get(years[0]) ?? []).map((row) => row.iso3));
      for (const iso3 of candidates) {
        if (groupMode === 'like_for_like' && !completeSet.has(iso3)) continue;
        const byYear = new Map();
        let complete = true;
        for (const year of years) {
          const row = (eligibleByYear.get(year) ?? []).find((entry) => entry.iso3 === iso3);
          if (!row || !Number.isFinite(Number(row.value))) {
            complete = false;
            break;
          }
          byYear.set(year, Number(row.value));
        }
        if (!complete) continue;
        const result = computeMovementPeriodValue(metric, operation, byYear, years);
        if (result?.computable && Number.isFinite(result.value)) rows.push({ iso3, value: result.value });
      }
      const frame = rankMovementPeriod(metric, rows);
      if (frame) movementRankingsByInterval[interval.id] = frame;
    }
  }

  // Movement endpoint-change and CAGR bases rank the transformed statistic,
  // not the raw endpoint level. Invalid pairs are excluded from the real
  // denominator, and like-for-like uses the already frozen common universe.
  const transformedRankingsByInterval = {};
  if (['absolute_change', 'percent_change', 'pp_change', 'index_point_change', 'cagr'].includes(operation)) {
    const code = operation === 'absolute_change' ? TRANSFORMS.ABSOLUTE_CHANGE
      : operation === 'percent_change' ? TRANSFORMS.PERCENT_CHANGE
        : operation === 'pp_change' ? TRANSFORMS.PERCENTAGE_POINT_CHANGE
          : operation === 'index_point_change' ? TRANSFORMS.INDEX_POINT_CHANGE : TRANSFORMS.CAGR;
    for (const interval of plan.intervals) {
      const starts = new Map((eligibleByYear.get(interval.start) ?? []).map((row) => [row.iso3, row]));
      const ends = new Map((eligibleByYear.get(interval.end) ?? []).map((row) => [row.iso3, row]));
      const rows = [];
      for (const [iso3, startRow] of starts) {
        const endRow = ends.get(iso3);
        if (!endRow || (groupMode === 'like_for_like' && !completeSet.has(iso3))) continue;
        const inputs = code === TRANSFORMS.CAGR
          ? { a: Number(startRow.value), b: Number(endRow.value), years: interval.end - interval.start }
          : { a: Number(startRow.value), b: Number(endRow.value) };
        const transformed = computeTransform(metric, code, inputs);
        if (transformed.computable && Number.isFinite(transformed.value)) rows.push({ iso3, value: transformed.value });
      }
      const frame = rankMovementPeriod(metric, rows);
      if (frame) transformedRankingsByInterval[interval.id] = frame;
    }
  }

  // ---- weighted-ratio legs ------------------------------------------------
  let denMetric = null;
  let numEligibleByYear = null;
  let denEligibleByYear = null;
  if (metric.aggregation === 'WEIGHTED_RATIO') {
    const denKey = metric.requiredDenominator?.metricKey ?? null;
    const numKey = metric.requiredDenominator?.numeratorMetric ?? null;
    if (!denKey || !METRICS[denKey] || !numKey || !METRICS[numKey]) {
      throw entityError(
        ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION,
        `Metric "${metric.key}" declares WEIGHTED_RATIO without a registered requiredDenominator linkage (numerator + denominator).`,
      );
    }
    denMetric = METRICS[denKey];
    for (const [mapKey, seriesKey] of [['num', numKey], ['den', denKey]]) {
      const seriesIndicator = await getIndicatorByMetricKey(db, seriesKey);
      const byYear = new Map(allYears.map((y) => [y, []]));
      if (seriesIndicator) {
        for (const row of await getEligibleObservationsForYears(db, seriesIndicator.id, allYears)) {
          if (byYear.has(row.year)) byYear.get(row.year).push(row);
        }
      }
      if (mapKey === 'num') numEligibleByYear = byYear;
      else denEligibleByYear = byYear;
    }
  }

  // ---- per-entity assembly ------------------------------------------------
  const results = {};
  const modeValuesBySlot = {};
  const vintageValues = new Set();
  const diagnostics = [];

  for (const [slot, entity] of [['a', entityA], ['b', entityB]]) {
    if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
      const memberRowsByYear = new Map();
      const isRatio = metric.aggregation === 'WEIGHTED_RATIO';
      const memberSet = new Set(entity.members);
      for (const year of allYears) {
        const memberRows = (eligibleByYear.get(year) ?? []).filter((r) => memberSet.has(r.iso3));
        memberRowsByYear.set(year, memberRows);
        if (!isRatio) {
          for (const row of memberRows) if (row.wbLastUpdated) vintageValues.add(row.wbLastUpdated);
        }
      }
      const series = isRatio
        ? (() => {
            const numRowsByYear = new Map();
            const denRowsByYear = new Map();
            for (const year of allYears) {
              numRowsByYear.set(year, (numEligibleByYear.get(year) ?? []).filter((r) => memberSet.has(r.iso3)));
              denRowsByYear.set(year, (denEligibleByYear.get(year) ?? []).filter((r) => memberSet.has(r.iso3)));
            }
            const ratio = buildGroupRatioSeries(entity, numRowsByYear, denRowsByYear, allYears, metric, denMetric, completeSet);
            for (const vintage of ratio.vintages) vintageValues.add(vintage);
            return ratio;
          })()
        : buildGroupSeries(entity, memberRowsByYear, allYears, metric, completeSet);

      const coverage = buildEntityCoverage({
        members: entity.members,
        requiredObservationYears: requiredYears,
        rowsByYear: requiredByYear,
        completeSet,
      });
      const commonMembers = series.coverage?.common ?? coverage.used;

      results[slot] = {
        kind: entity.kind,
        label: entity.label,
        members: [...entity.members],
        memberNames: { ...entity.memberNames },
        source: entity.source,
        observed: series.observed,
        likeForLike: series.likeForLike,
        coverage: series.coverage,
        membershipEffect: series.membershipEffect,
        coverageBasis: {
          observed: COVERAGE_BASIS.COMMON_UNIVERSE,
          like_for_like: COVERAGE_BASIS.COMMON_UNIVERSE,
          usedMembers: commonMembers,
          usedMemberCount: commonMembers.length,
          note:
            'The group value is computed over the members that satisfy the frozen completeness rule ' +
            '(present at every required observation year). Members are excluded from the peer reference universe.',
        },
        series: buildSeries({
          entity,
          mode: groupMode,
          years: seriesYears,
          values: new Map(),
          groupSeries: series,
          groupMembers: entity.members,
          commonMembers,
        }),
      };
      modeValuesBySlot[slot] = groupMode === 'like_for_like' ? series.likeForLike : series.observed;
      continue;
    }

    const { values, vintageLegs } = readEntityValues(entityRowsByIso3, entity, allYears);
    for (const vintage of vintageLegs) vintageValues.add(vintage);
    const basis =
      entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE
        ? COVERAGE_BASIS.WORLD_BANK_PUBLISHED
        : COVERAGE_BASIS.ENTITY_OWN_OBSERVATION;
    const pointCoverage = buildPointCoverage({
      iso3: entity.iso3,
      requiredObservationYears: requiredYears,
      valuesByYear: values,
      basis,
    });
    const observedMap = {};
    const likeForLikeMap = {};
    for (const year of allYears) {
      const entry = values.get(year);
      const available = entry !== null && entry !== undefined;
      observedMap[year] = available
        ? { available: true, reason: null, value: entry.value, valueRaw: entry.valueRaw, provenance: 'RAW', complete: true }
        : { available: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, value: null, valueRaw: null, provenance: 'RAW', complete: false };
      // Like-for-like for a point entity: its own observation, admitted only
      // when the entity is complete at EVERY required observation year.
      const admitted = pointCoverage.complete;
      likeForLikeMap[year] = admitted && available
        ? { available: true, reason: null, value: entry.value, valueRaw: entry.valueRaw, provenance: 'RAW', complete: true }
        : {
            available: false,
            reason: admitted ? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
            value: null,
            valueRaw: null,
            provenance: 'RAW',
            complete: false,
            missingYears: pointCoverage.missingYears,
          };
    }
    results[slot] = {
      kind: entity.kind,
      iso3: entity.iso3,
      name: entity.name,
      source: entity.source,
      values: Object.fromEntries(
        allYears.map((year) => [
          year,
          observedMap[year].available
            ? {
                available: true,
                reason: null,
                value: observedMap[year].value,
                valueRaw: observedMap[year].valueRaw,
                provenance: 'RAW',
                complete: true,
              }
            : { available: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, value: null, complete: false },
        ]),
      ),
      observed: observedMap,
      likeForLike: likeForLikeMap,
      coverageBasis: {
        observed: basis,
        like_for_like: basis,
        usedMembers: pointCoverage.used,
        usedMemberCount: pointCoverage.usedCount,
        missingYears: pointCoverage.missingYears,
        note:
          basis === COVERAGE_BASIS.WORLD_BANK_PUBLISHED
            ? 'The officially published World Bank aggregate value, used as published. It is never recomputed ' +
              'over the common universe, and its member list is not stored.'
            : 'The entity’s own stored observation, admitted only when it exists at every required observation year.',
      },
      coverage: {
        requiredObservationYears: requiredYears,
        complete: pointCoverage.complete,
        missingYears: pointCoverage.missingYears,
        byYear: pointCoverage.byYear,
      },
      series: buildSeries({
        entity,
        mode: groupMode,
        years: seriesYears,
        values,
        groupSeries: null,
        groupMembers: [],
        commonMembers: [],
      }),
    };
    // modeValues drives the operation application (mode-aware).
    modeValuesBySlot[slot] = groupMode === 'like_for_like' ? likeForLikeMap : observedMap;
  }

  const comparison = applyOperation({
    entityA,
    entityB,
    results,
    modeValuesBySlot,
    metric,
    plan,
    operation,
    groupMode,
    diagnostics,
    capabilityBlock,
    levelRankingsByYear,
    movementRankingsByInterval,
    transformedRankingsByInterval,
  });

  const lastUpdatedValues = [...vintageValues].sort();
  const vintageBlock = {
    coherent: lastUpdatedValues.length <= 1,
    lastUpdatedValues,
    warning:
      lastUpdatedValues.length > 1
        ? 'Legs used in this comparison carry different World Bank vintages; values are shown with their provenance, not silently merged across vintages.'
        : null,
  };

  const response = {
    available: true,
    reason: null,
    entities: { a: entityA, b: entityB },
    metric: describeMeasure(metric),
    years: { a: plan.periods.a, b: plan.periods.b, c: plan.periods.c },
    operation,
    basis,
    groupMode,
    mode: groupMode,
    analysis: {
      id: plan.id,
      basis,
      label: plan.label,
      kind: plan.kind,
      formula: plan.formula,
      transform: plan.transform,
      startYear: plan.startYear,
      midYear: plan.midYear,
      endYear: plan.endYear,
      endpointYears: plan.endpointYears,
      requiredObservationYears: requiredYears,
      seriesYears,
      ignoredPeriods: plan.ignoredPeriods,
      boundary: plan.boundary,
      intervals: plan.intervals,
      membership: membershipDiagnostics(entityA, entityB),
    },
    capability: capabilityBlock
      ? { ...capability, detail: capabilityBlock.detail, token: capabilityBlock.token }
      : capability,
    universe,
    results: { ...results, comparison },
    diagnostics,
    vintage: vintageBlock,
    source: sourceAttribution(),
    cached: false,
  };
  // Only a fully produced response is cached. A blocked comparison is never
  // stored, so it can never conceal observations that arrived later.
  setCachedCompare(db, cacheKey, response);
  return response;
}

/** Both endpoints of a two-point operation for one slot. */
function slotEndpoints(slot, endpointYears, valueAt) {
  const [start, end] = endpointYears;
  return { a: valueAt(slot, start), b: valueAt(slot, end) };
}

/**
 * Replace a computed transform result by an explicit "not publishable"
 * result. A partial coverage input is never allowed to keep its number.
 */
function blockedResult(result, reason, description) {
  return {
    ...result,
    value: null,
    computable: false,
    reason,
    description: description ?? result?.description ?? null,
  };
}

/** Evaluate the Movement period method for one country against its raw annual series. */
function computeMovementPeriodValue(metric, operation, valuesByYear, years) {
  if (operation === 'movement_inflation_cumulative') return cumulativeInflation(valuesByYear, years);
  if (operation === 'movement_period_average' && ['inflation_cpi', 'inflation_deflator'].includes(metric.key)) {
    return periodAverageInflation(valuesByYear, years);
  }
  if (['exports_current', 'imports_current'].includes(metric.key)) {
    return operation === 'movement_period_total'
      ? tradePeriodTotal(valuesByYear, years)
      : tradePeriodAverage(valuesByYear, years);
  }
  if (metric.key === 'fdi_inflows') {
    return operation === 'movement_period_total'
      ? capitalPeriodSum(valuesByYear, years)
      : capitalPeriodAverage(valuesByYear, years);
  }
  if (metric.key === 'fdi_inflows_pct_gdp') return capitalPeriodAverage(valuesByYear, years);
  if (metric.key === 'remittances_received') {
    return operation === 'movement_period_total'
      ? externalPeriodSum(valuesByYear, years)
      : externalPeriodAverage(valuesByYear, years);
  }
  return null;
}

/** Movement family ranking applied to the selected period-basis result. */
function rankMovementPeriod(metric, rows) {
  if (['inflation_cpi', 'inflation_deflator'].includes(metric.key)) {
    return { ...rankCompetitionAsc(rows), direction: 'ASC', methodology: 'Prices competition ranking; lower values rank first.' };
  }
  if (['exports_current', 'imports_current'].includes(metric.key)) {
    return { ...rankTradeDesc(rows), direction: 'DESC', methodology: 'Trade competition ranking; higher values rank first.' };
  }
  if (['fdi_inflows', 'fdi_inflows_pct_gdp'].includes(metric.key)) {
    return { ...rankCapitalDesc(rows), direction: 'DESC', methodology: 'Capital competition ranking; higher values rank first.' };
  }
  if (metric.key === 'population_total') {
    return { ...rankPopulationDesc(rows), direction: 'DESC', methodology: 'Population competition ranking; higher values rank first.' };
  }
  if (metric.key === 'fx_official') {
    return { ...rankFxDirected(rows, metric.rankingDirection), methodology: 'FX competition ranking follows the registered Movement direction.' };
  }
  if (metric.key === 'current_account') {
    return { ...rankExternalDesc(rows), direction: 'DESC', methodology: 'External-sector competition ranking; higher values rank first.' };
  }
  if (metric.key === 'remittances_received') {
    return { ...rankExternalDesc(rows), direction: 'DESC', methodology: 'External-sector competition ranking; higher values rank first.' };
  }
  const generic = rankAnnualMovementValues(metric, rows);
  if (generic) return generic;
  return null;
}

/** Run the same family-specific rank engine used by Movement for annual values. */
function rankAnnualMovementValues(metric, rows) {
  if (!metric || metric.rankingDirection === 'NEUTRAL' || metric.key === 'current_account' || metric.key === 'fx_official') return null;
  if (['inflation_cpi', 'inflation_deflator'].includes(metric.key)) {
    return { ...rankCompetitionAsc(rows), direction: 'ASC', methodology: 'Prices competition ranking; lower values rank first.' };
  }
  if (metric.key === 'inflation_cpi_index') return null;
  if (['exports_current', 'imports_current'].includes(metric.key)) {
    return { ...rankTradeDesc(rows), direction: 'DESC', methodology: 'Trade competition ranking; higher values rank first.' };
  }
  if (['fdi_inflows', 'fdi_inflows_pct_gdp'].includes(metric.key)) {
    return { ...rankCapitalDesc(rows), direction: 'DESC', methodology: 'Capital competition ranking; higher values rank first.' };
  }
  if (['reserves_ex_gold', 'remittances_received'].includes(metric.key)) {
    return { ...rankExternalDesc(rows), direction: 'DESC', methodology: 'External-sector competition ranking; higher values rank first.' };
  }
  if (metric.key === 'population_total') {
    return { ...rankPopulationDesc(rows), direction: 'DESC', methodology: 'Population competition ranking; higher values rank first.' };
  }
  const direction = metric.rankingDirection === 'ASC' ? 'ASC' : 'DESC';
  return { ...rankByValue(rows, direction), direction, methodology: 'Application ranking service; ties use distinct ordinal positions with ISO3 as the deterministic tie-break.' };
}

/**
 * Apply the selected operation to the (mode-aware) entity series.
 * A derived result is published only when every required input is complete.
 */
function applyOperation({ entityA, entityB, results, modeValuesBySlot, metric, plan, operation, groupMode, diagnostics, capabilityBlock, levelRankingsByYear, movementRankingsByInterval, transformedRankingsByInterval }) {
  const mode = groupMode;
  const isAggregate = (entity) => entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE;
  /** Mode-aware value of one slot at one year. */
  const valueAt = (slot, year) => entityValueAt(results[slot], mode, year, modeValuesBySlot?.[slot]);
  // A combination the approved metric registry does not support produces no
  // derived result at all — the entity values stay visible, the comparison
  // does not.
  const hardBlock = capabilityBlock ? capabilityBlock.reason : null;

  /** Records a blocking diagnostic (once per scope/code). */
  const note = (code, scope, detail, extra = {}) => {
    if (diagnostics.some((d) => d.code === code && d.scope === scope && d.entity === extra.entity)) return;
    diagnostics.push({
      code,
      scope,
      entity: extra.entity ?? null,
      metric: metric.key,
      indicatorCode: metric.indicatorCode ?? null,
      years: extra.years ?? plan.requiredObservationYears,
      detail,
      blocksOverall: extra.blocksOverall !== false,
      ...extra,
    });
  };

  const observationAt = (slot, year) => {
    const entry = valueAt(slot, year);
    // entityValueAt keeps a group's raw observation nested at `entry` so its
    // top-level value/complete pair stays uniform with countries. Carry the
    // group's member coverage through to interval observations as well;
    // otherwise the UI can show a partial subtotal but cannot say which
    // selected member/year is missing.
    const sourceEntry = entry.entry ?? entry;
    return {
      year,
      value: entry.value ?? null,
      unit: metric.unitLong ?? metric.unit,
      available: entry.value !== null && entry.value !== undefined,
      complete: entry.value !== null && entry.value !== undefined && entry.complete !== false,
      reason: entry.reason ?? sourceEntry.reason ?? null,
      members: sourceEntry.members ?? entry.members ?? null,
      missingCount: sourceEntry.missingCount ?? entry.missingCount ?? 0,
      missingIso3: sourceEntry.missingIso3 ?? entry.missingIso3 ?? [],
      coverage: sourceEntry.coverage ?? entry.coverage ?? null,
    };
  };

  const intervalLabel = (id) => ({ AB: 'A → B', AM: 'A → B', BC: 'B → C', MB: 'B → C', AC: 'A → C' })[id] ?? id;
  const lflAggregateBlocked = mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB));

  /**
   * Backend-calculated, self-contained results for each requested interval.
   * Inputs and values come from the same mode-aware series and frozen
   * eligibility universe as the summary result.
   */
  const buildIntervalResults = (kind, intervals = plan.intervals) => intervals.map((interval) => {
    const { start, end, id } = interval;
    const years = interval.years ?? [start, end];
    const observations = {
      a: years.map((year) => observationAt('a', year)),
      b: years.map((year) => observationAt('b', year)),
    };
    const blockPartial = (slot, result) => {
      const partial = observations[slot].find((entry) => entry.available && !entry.complete);
      return partial
        ? blockedResult(result, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, `The result depends on partial coverage in ${partial.year}.`)
        : result;
    };
    const finish = (aResult, bResult, gapUnit, formula, extra = {}) => {
      const aOut = blockPartial('a', aResult);
      const bOut = blockPartial('b', bResult);
      const blocked = hardBlock || lflAggregateBlocked;
      const gap = aOut.computable && bOut.computable && !blocked
        ? { value: aOut.value - bOut.value, reason: null, unit: gapUnit }
        : {
            value: null,
            reason: hardBlock ?? (lflAggregateBlocked ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE : aOut.reason ?? bOut.reason ?? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA),
            unit: gapUnit,
          };
      const transformFrame = transformedRankingsByInterval?.[id];
      const attachTransformedRank = (entity, result) => {
        if (entity.kind !== ENTITY_KINDS.COUNTRY || !transformFrame || !result.computable) return result;
        const ranked = transformFrame.ranked.find((row) => row.iso3 === entity.iso3);
        return ranked ? {
          ...result,
          rank: {
            position: ranked.rank,
            denominator: transformFrame.total,
            attribution: 'APPLICATION_DERIVED',
            direction: transformFrame.direction,
            methodology: transformFrame.methodology,
          },
        } : result;
      };
      const rankedA = attachTransformedRank(entityA, aOut);
      const rankedB = attachTransformedRank(entityB, bOut);
      return {
        id,
        label: intervalLabel(id),
        start,
        end,
        kind,
        formula,
        unit: aOut.unit ?? bOut.unit ?? gapUnit,
        gapUnit,
        observations,
        a: rankedA,
        b: rankedB,
        gap,
        available: gap.value !== null,
        reason: gap.value !== null ? null : gap.reason,
        ...extra,
      };
    };

    if (kind === 'level') {
      const attachRank = (slot, entry) => {
        const entity = slot === 'a' ? entityA : entityB;
        if (entity.kind !== ENTITY_KINDS.COUNTRY) return entry;
        const frame = levelRankingsByYear?.[entry.year];
        const ranked = frame?.ranked?.find((row) => row.iso3 === entity.iso3);
        return {
          ...entry,
          rank: ranked ? {
            position: ranked.rank,
            denominator: frame.total,
            attribution: 'APPLICATION_DERIVED',
            direction: frame.direction,
            methodology: frame.methodology,
          } : null,
        };
      };
      const atStartA = attachRank('a', observations.a.find((entry) => entry.year === start));
      const atEndA = attachRank('a', observations.a.find((entry) => entry.year === end));
      const atStartB = attachRank('b', observations.b.find((entry) => entry.year === start));
      const atEndB = attachRank('b', observations.b.find((entry) => entry.year === end));
      const rankedObservations = {
        a: observations.a.map((entry) => attachRank('a', entry)),
        b: observations.b.map((entry) => attachRank('b', entry)),
      };
      const pointGap = (left, right) => left.available && right.available && left.complete && right.complete && !hardBlock && !lflAggregateBlocked
        ? { value: left.value - right.value, unit: gapUnitFor(metric), reason: null }
        : { value: null, unit: gapUnitFor(metric), reason: hardBlock ?? (lflAggregateBlocked ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE : COMPARE_BLOCK_CODES.MISSING_REQUIRED_DATA) };
      return {
        id, label: intervalLabel(id), start, end, kind, formula: 'stored observations at the selected interval endpoints',
        unit: metric.unitLong ?? metric.unit, gapUnit: gapUnitFor(metric), observations: rankedObservations,
        a: { start: atStartA, end: atEndA }, b: { start: atStartB, end: atEndB },
        gap: { start: pointGap(atStartA, atStartB), end: pointGap(atEndA, atEndB) },
        available: pointGap(atStartA, atStartB).value !== null && pointGap(atEndA, atEndB).value !== null,
      };
    }

    if (kind === 'period' || kind === 'movement_period') {
      const summarize = (slot) => {
        const byYear = new Map(observations[slot].map(({ year, value }) => [year, value]));
        const values = years.map((year) => ({ year, value: byYear.get(year) ?? null }));
        if (kind === 'period') {
          const compute = operation === 'period_total' ? periodSum : periodAverage;
          return compute({ values, startYear: start, endYear: end }, metric);
        }
        let computed;
        if (operation === 'movement_inflation_cumulative') {
          computed = cumulativeInflation(byYear, years);
        } else if (operation === 'movement_period_average' && ['inflation_cpi', 'inflation_deflator'].includes(metric.key)) {
          computed = periodAverageInflation(byYear, years);
        } else if (['exports_current', 'imports_current'].includes(metric.key)) {
          computed = operation === 'movement_period_total'
            ? tradePeriodTotal(byYear, years)
            : tradePeriodAverage(byYear, years);
        } else if (metric.key === 'fdi_inflows') {
          computed = operation === 'movement_period_total'
            ? capitalPeriodSum(byYear, years)
            : capitalPeriodAverage(byYear, years);
        } else if (metric.key === 'fdi_inflows_pct_gdp') {
          computed = capitalPeriodAverage(byYear, years);
        } else if (metric.key === 'remittances_received') {
          computed = operation === 'movement_period_total'
            ? externalPeriodSum(byYear, years)
            : externalPeriodAverage(byYear, years);
        }
        if (!computed) return { computable: false, value: null, reason: 'UNSUPPORTED_TRANSFORMATION', unit: null };
        const unit = operation === 'movement_inflation_cumulative' || ['inflation_cpi', 'inflation_deflator', 'fdi_inflows_pct_gdp'].includes(metric.key)
          ? '%'
          : operation === 'movement_period_average'
            ? `${metric.unitLong ?? metric.unit}/year`
            : metric.unitLong ?? metric.unit;
        return {
          computable: computed.computable,
          value: computed.computable ? computed.value : null,
          reason: computed.reason ?? null,
          description: computed.computable ? null : `Required annual observations are missing${computed.missingYears?.length ? `: ${computed.missingYears.join(', ')}` : '.'}`,
          unit,
          provenance: { kind: 'APP_DERIVED', transform: plan.transform, formula: plan.formula, metricKey: metric.key, requiredObservationYears: years },
        };
      };
      const aResult = summarize('a');
      const bResult = summarize('b');
      const incompleteYears = (slot) => observations[slot].filter((entry) => !entry.available || !entry.complete).map((entry) => entry.year);
      const aMissing = incompleteYears('a');
      const bMissing = incompleteYears('b');
      const aOut = aMissing.some((year) => observations.a.find((entry) => entry.year === year)?.available)
        ? blockedResult(aResult, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period includes partial group coverage.') : aResult;
      const bOut = bMissing.some((year) => observations.b.find((entry) => entry.year === year)?.available)
        ? blockedResult(bResult, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period includes partial group coverage.') : bResult;
      const rankFrame = kind === 'movement_period' ? movementRankingsByInterval[id] : null;
      const attachPeriodRank = (entity, result) => {
        if (entity.kind !== ENTITY_KINDS.COUNTRY || !rankFrame || !result.computable) return result;
        const ranked = rankFrame.ranked.find((row) => row.iso3 === entity.iso3);
        return {
          ...result,
          rank: ranked ? {
            position: ranked.rank,
            denominator: rankFrame.total,
            attribution: 'APPLICATION_DERIVED',
            direction: rankFrame.direction,
            methodology: rankFrame.methodology,
          } : null,
        };
      };
      const rankedAOut = attachPeriodRank(entityA, aOut);
      const rankedBOut = attachPeriodRank(entityB, bOut);
      const rateGap = kind === 'movement_period' && (
        operation === 'movement_inflation_cumulative' ||
        ['inflation_cpi', 'inflation_deflator', 'fdi_inflows_pct_gdp'].includes(metric.key)
      );
      const gapUnit = rateGap ? 'percentage points' : gapUnitFor(metric);
      const gap = rankedAOut.computable && rankedBOut.computable && !hardBlock && !lflAggregateBlocked
        ? { value: rankedAOut.value - rankedBOut.value, unit: gapUnit, reason: null }
        : { value: null, unit: gapUnit, reason: hardBlock ?? (lflAggregateBlocked ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE : rankedAOut.reason ?? rankedBOut.reason ?? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA) };
      return {
        id, label: intervalLabel(id), start, end, kind, formula: plan.formula,
        unit: rankedAOut.unit ?? rankedBOut.unit ?? metric.unitLong ?? metric.unit, gapUnit, observations,
        a: rankedAOut, b: rankedBOut, gap, available: gap.value !== null,
        requiredObservationYears: years,
        boundary: interval.inclusiveStart === false
          ? { start, end, inclusiveStart: false, inclusiveEnd: true }
          : { start, end, inclusiveStart: true, inclusiveEnd: kind === 'movement_period' ? true : false },
      };
    }

    const transformCode = operation === 'absolute_change' ? TRANSFORMS.ABSOLUTE_CHANGE
      : operation === 'percent_change' || operation === 'segmented_growth' ? TRANSFORMS.PERCENT_CHANGE
        : operation === 'pp_change' ? TRANSFORMS.PERCENTAGE_POINT_CHANGE
          : operation === 'index_point_change' ? TRANSFORMS.INDEX_POINT_CHANGE : TRANSFORMS.CAGR;
    const computeFor = (slot) => {
      const aValue = observations[slot].find((entry) => entry.year === start)?.value ?? null;
      const bValue = observations[slot].find((entry) => entry.year === end)?.value ?? null;
      const inputs = transformCode === TRANSFORMS.CAGR
        ? { a: aValue, b: bValue, years: end - start }
        : { a: aValue, b: bValue };
      return computeTransform(metric, transformCode, inputs);
    };
    const aResult = computeFor('a');
    const bResult = computeFor('b');
    const gapUnit = transformCode === TRANSFORMS.ABSOLUTE_CHANGE
      ? gapUnitFor(metric)
      : transformCode === TRANSFORMS.PERCENTAGE_POINT_CHANGE || transformCode === TRANSFORMS.INDEX_POINT_CHANGE
        ? (aResult.unit ?? bResult.unit ?? gapUnitFor(metric)) : 'percentage points';
    return finish(aResult, bResult, gapUnit, plan.formula, { years: end - start });
  });

  if (hardBlock) {
    note(hardBlock, 'comparison', capabilityBlock.detail, { entity: null });
  }

  // ---- cross-rate --------------------------------------------------------
  if (operation === 'cross_rate') {
    if (hardBlock) {
      return {
        available: false,
        reason: hardBlock,
        detail: capabilityBlock.detail,
        scope: 'comparison',
        value: null,
        unit: null,
        legs: { a: { iso3: entityA.iso3, value: null }, b: { iso3: entityB.iso3, value: null } },
        provenance: { kind: 'APP_DERIVED', transform: 'CROSS_RATE', formula: 'A_per_USD / B_per_USD', metricKey: metric.key, outputUnit: null },
      };
    }
    const [yearA] = plan.requiredObservationYears;
    const legA = { value: valueAt('a', yearA).value, year: yearA, quotation: metric.quotation?.convention ?? null };
    const legB = { value: valueAt('b', yearA).value, year: yearA, quotation: metric.quotation?.convention ?? null };
    const check = validateCrossRateLegs(metric, legA, legB);
    if (!check.valid) {
      note(check.reason, 'comparison', check.detail ?? 'The cross-rate legs are not comparable.', { entity: null });
      return {
        available: false,
        reason: check.reason,
        detail: check.detail ?? null,
        scope: 'comparison',
        value: null,
        unit: null,
        legs: { a: { iso3: entityA.iso3, value: legA.value }, b: { iso3: entityB.iso3, value: legB.value } },
        provenance: { kind: 'APP_DERIVED', transform: 'CROSS_RATE', formula: 'A_per_USD / B_per_USD', metricKey: metric.key, outputUnit: null },
      };
    }
    const computed = crossRate({ aPerUsd: legA.value, bPerUsd: legB.value }, metric);
    return {
      available: computed.computable,
      reason: computed.computable ? null : computed.reason,
      detail: computed.computable ? null : computed.description,
      scope: computed.computable ? 'none' : 'comparison',
      value: computed.value,
      unit: `${entityA.iso3} per ${entityB.iso3} (local currency units, APP-derived cross-rate)`,
      legs: {
        a: { iso3: entityA.iso3, value: legA.value, valueRaw: String(legA.value) },
        b: { iso3: entityB.iso3, value: legB.value, valueRaw: String(legB.value) },
      },
      provenance: {
        kind: 'APP_DERIVED',
        transform: 'CROSS_RATE',
        formula: 'A_per_USD / B_per_USD',
        metricKey: metric.key,
        inputs: { aPerUsd: legA.value, bPerUsd: legB.value, year: yearA },
        outputUnit: `${entityA.iso3} per ${entityB.iso3}`,
      },
    };
  }

  // ---- level -------------------------------------------------------------
  if (operation === 'level') {
    const perYear = {};
    const blockedYears = [];
    const rows = plan.requiredObservationYears;
    for (const year of rows) {
      const a = valueAt('a', year);
      const b = valueAt('b', year);
      let gap = null;
      let gapReason = null;
      if (a.value === null || b.value === null) {
        gapReason = ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA;
        const missingSlot = a.value === null ? 'a' : 'b';
        const missingEntity = missingSlot === 'a' ? entityA : entityB;
        note(
          ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
          missingSlot === 'a' ? 'entity_a' : 'entity_b',
          `No stored observation for ${missingEntity.label ?? missingEntity.name ?? missingEntity.iso3} in ${year}.`,
          { entity: missingEntity.label ?? missingEntity.name ?? missingEntity.iso3, years: [year] },
        );
      } else if (hardBlock) {
        gapReason = hardBlock;
      } else if (a.complete === false || b.complete === false) {
        gapReason = COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE;
        note(COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'comparison', 'A partial coverage value cannot be differenced against another entity.', { years: [year] });
      } else if (mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB))) {
        gapReason = COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE;
        note(
          COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE,
          'comparison',
          'An official World Bank aggregate is the published value; it is not recomputed over the common universe, ' +
            'so a like-for-like gap against it cannot be established.',
          { years: [year] },
        );
      } else {
        gap = a.value - b.value;
      }
      if (gap === null) blockedYears.push(year);
      const rankFrame = levelRankingsByYear?.[year];
      const positionFor = (entity) => {
        if (entity.kind !== ENTITY_KINDS.COUNTRY || !rankFrame) return null;
        const found = rankFrame.ranked.find((row) => row.iso3 === entity.iso3);
        return found ? { position: found.rank, denominator: rankFrame.total, attribution: 'APPLICATION_DERIVED', direction: rankFrame.direction, methodology: rankFrame.methodology } : null;
      };
      perYear[year] = { a: a.value, b: b.value, gap, gapReason, unit: gapUnitFor(metric), ranks: { a: positionFor(entityA), b: positionFor(entityB) } };
    }
    const available = blockedYears.length === 0;
    return {
      available,
      reason: available ? null : COMPARE_BLOCK_CODES.PARTIAL_COMPARISON,
      detail: available ? null : `No comparable gap for: ${blockedYears.join(', ')}.`,
      scope: available ? 'none' : 'comparison',
      blockedYears,
      perYear,
      intervalResults: buildIntervalResults('level', plan.intervals),
      unit: gapUnitFor(metric),
    };
  }

  // ---- period operations -------------------------------------------------
  if (operation === 'movement_period_total' || operation === 'movement_period_average' || operation === 'movement_inflation_cumulative') {
    const intervalResults = buildIntervalResults('movement_period', plan.intervals);
    const final = intervalResults.at(-1);
    const available = Boolean(final?.available);
    return {
      available,
      reason: available ? null : final?.reason ?? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
      detail: available ? null : 'The selected Movement method needs complete annual observations for both entities.',
      scope: available ? 'none' : 'comparison',
      period: final ? { start: final.start, end: final.end, years: final.requiredObservationYears, boundary: final.boundary } : null,
      a: final?.a ?? null,
      b: final?.b ?? null,
      gap: final?.gap ?? { value: null, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, unit: gapUnitFor(metric) },
      intervalResults,
      unit: final?.gapUnit ?? gapUnitFor(metric),
    };
  }

  if (operation === 'period_total' || operation === 'period_average') {
    // The final planned interval is A → C when all three endpoints exist;
    // this remains the top-level summary while intervalResults exposes each
    // independently calculated period.
    const interval = plan.intervals.at(-1);
    const valueOf = (slot) => {
      const points = [];
      for (const year of interval.years) {
        const probe = valueAt(slot, year);
        if (probe.value === null || probe.value === undefined) {
          points.push({ year, value: null });
        } else {
          points.push({ year, value: probe.value });
        }
      }
      return points;
    };
    const rawA = valueOf('a');
    const rawB = valueOf('b');
    const compute = operation === 'period_total' ? periodSum : periodAverage;
    const sumA = compute({ values: rawA, startYear: interval.start, endYear: interval.end }, metric);
    const sumB = compute({ values: rawB, startYear: interval.start, endYear: interval.end }, metric);
    const partialSide = (slot) => {
      for (const year of interval.years) {
        const probe = valueAt(slot, year);
        if (probe.value !== null && probe.value !== undefined && probe.complete === false) return year;
      }
      return null;
    };
    const partialA = partialSide('a');
    const partialB = partialSide('b');
    const aggregateBlock = mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB));

    const block = (slotLabel, entity, missingYears) => {
      note(
        missingYears === 'partial' ? COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
        slotLabel,
        missingYears === 'partial'
          ? 'The period value depends on a partial coverage subtotal.'
          : `No stored observation for the period [${interval.start}, ${interval.end}) on: ${missingYears.join(', ')}.`,
        { entity: entity.label ?? entity.name ?? entity.iso3, years: missingYears === 'partial' ? interval.years : missingYears },
      );
    };
    if (partialA !== null) block('entity_a', entityA, 'partial');
    if (partialB !== null) block('entity_b', entityB, 'partial');

    // A partial subtotal never keeps a computed period value.
    const sumAOut = partialA !== null
      ? blockedResult(sumA, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period value depends on a partial coverage subtotal.')
      : sumA;
    const sumBOut = partialB !== null
      ? blockedResult(sumB, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period value depends on a partial coverage subtotal.')
      : sumB;

    const gap =
      sumAOut.computable && sumBOut.computable && !aggregateBlock && !hardBlock
        ? { value: sumAOut.value - sumBOut.value, reason: null, unit: gapUnitFor(metric) }
        : {
            value: null,
            reason: aggregateBlock
              ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE
              : hardBlock
                ? hardBlock
                : partialA !== null || partialB !== null
                  ? COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE
                  : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
            unit: gapUnitFor(metric),
          };
    if (aggregateBlock) {
      note(
        COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE,
        'comparison',
        'An official World Bank aggregate is the published value; it is not recomputed over the common universe, ' +
          'so a like-for-like period comparison against it cannot be established.',
        { years: interval.years },
      );
    }
    const available = gap.value !== null;
    return {
      available,
      reason: available ? null : gap.reason,
      detail: available ? null : 'The period comparison is not publishable under the selected methodology.',
      scope: available ? 'none' : 'comparison',
      period: { start: interval.start, end: interval.end, inclusiveStart: true, inclusiveEnd: false, years: interval.years },
      a: sumAOut,
      b: sumBOut,
      gap,
      intervalResults: buildIntervalResults('period', plan.intervals),
      unit: gapUnitFor(metric),
    };
  }

  // ---- period-total growth (two adjacent half-open periods) --------------
  if (operation === 'period_total_growth') {
    if (plan.periods.b === null) {
      const interval = plan.intervals[0];
      const unavailable = {
        computable: false,
        value: null,
        reason: 'MISSING_MIDDLE_YEAR',
        description: 'Period-total growth compares the totals in [A, B) and [B, C); select a middle year to define both periods.',
        unit: '%',
        provenance: { kind: 'APP_DERIVED', transform: TRANSFORMS.PERIOD_SUM_PERCENT_CHANGE, formula: plan.formula, metricKey: metric.key },
      };
      const observations = {
        a: interval.years.map((year) => observationAt('a', year)),
        b: interval.years.map((year) => observationAt('b', year)),
      };
      note('MISSING_MIDDLE_YEAR', 'comparison', unavailable.description, { years: interval.years });
      return {
        available: false,
        reason: 'MISSING_MIDDLE_YEAR',
        detail: unavailable.description,
        scope: 'comparison',
        a: unavailable,
        b: unavailable,
        gap: { value: null, reason: 'MISSING_MIDDLE_YEAR', unit: 'percentage points' },
        intervalResults: [{
          id: 'AC', label: 'A → C', start: interval.start, end: interval.end,
          kind: 'unavailable', formula: plan.formula, unit: '%', gapUnit: 'percentage points',
          observations, a: unavailable, b: unavailable,
          gap: { value: null, reason: 'MISSING_MIDDLE_YEAR', unit: 'percentage points' },
          available: false, reason: 'MISSING_MIDDLE_YEAR',
        }],
        unit: 'percentage points',
      };
    }
    const [first, second] = plan.intervals;
    const sumFor = (slot, interval) => {
      const points = interval.years.map((year) => ({ year, value: valueAt(slot, year).value }));
      return periodSum({ values: points, startYear: interval.start, endYear: interval.end }, metric);
    };
    const sumA1 = sumFor('a', first);
    const sumB1 = sumFor('b', first);
    const sumA2 = sumFor('a', second);
    const sumB2 = sumFor('b', second);
    const growthA = periodSumPercentChange({ sumA: sumA1.value, sumB: sumA2.value }, metric);
    const growthB = periodSumPercentChange({ sumA: sumB1.value, sumB: sumB2.value }, metric);
    // A partial subtotal in either period blocks the growth of that side.
    const partialIn = (slot) => {
      for (const year of plan.requiredObservationYears) {
        const probe = valueAt(slot, year);
        if (probe.value !== null && probe.value !== undefined && probe.complete === false) return year;
      }
      return null;
    };
    const partialA = partialIn('a');
    const partialB = partialIn('b');
    if (partialA !== null) {
      note(COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'entity_a', 'The period-total growth depends on a partial coverage value.', {
        entity: entityA.label ?? entityA.name ?? entityA.iso3,
        years: [partialA],
      });
    }
    if (partialB !== null) {
      note(COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'entity_b', 'The period-total growth depends on a partial coverage value.', {
        entity: entityB.label ?? entityB.name ?? entityB.iso3,
        years: [partialB],
      });
    }
    const growthAOut = partialA !== null
      ? blockedResult(growthA, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period-total growth depends on a partial coverage value.')
      : growthA;
    const growthBOut = partialB !== null
      ? blockedResult(growthB, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The period-total growth depends on a partial coverage value.')
      : growthB;
    const aggregateBlock = mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB));
    if (aggregateBlock) {
      note(
        COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE,
        'comparison',
        'An official World Bank aggregate is the published value; it is not recomputed over the common universe, ' +
          'so a like-for-like period growth comparison against it cannot be established.',
        { years: plan.requiredObservationYears },
      );
    }
    const gap =
      growthAOut.computable && growthBOut.computable && !aggregateBlock && !hardBlock
        ? { value: growthAOut.value - growthBOut.value, reason: null, unit: 'percentage points' }
        : {
            value: null,
            reason: aggregateBlock
              ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE
              : hardBlock
                ? hardBlock
                : partialA !== null || partialB !== null
                  ? COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE
                  : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
            unit: 'percentage points',
          };
    const available = gap.value !== null;
    const periodComponent = (interval, sumA, sumB) => {
      const partialInInterval = (slot) => interval.years.find((year) => {
        const probe = valueAt(slot, year);
        return probe.value !== null && probe.value !== undefined && probe.complete === false;
      }) ?? null;
      const partialAInterval = partialInInterval('a');
      const partialBInterval = partialInInterval('b');
      const aOut = partialAInterval !== null
        ? blockedResult(sumA, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, `The period total depends on partial coverage in ${partialAInterval}.`)
        : sumA;
      const bOut = partialBInterval !== null
        ? blockedResult(sumB, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, `The period total depends on partial coverage in ${partialBInterval}.`)
        : sumB;
      const gapOut = aOut.computable && bOut.computable && !hardBlock && !lflAggregateBlocked
        ? { value: aOut.value - bOut.value, reason: null, unit: gapUnitFor(metric) }
        : { value: null, reason: hardBlock ?? (lflAggregateBlocked ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE : aOut.reason ?? bOut.reason ?? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA), unit: gapUnitFor(metric) };
      return {
        id: interval.id,
        label: intervalLabel(interval.id),
        start: interval.start,
        end: interval.end,
        kind: 'period_component',
        formula: TRANSFORM_FORMULAS[TRANSFORMS.PERIOD_SUM],
        unit: metric.unitLong ?? metric.unit,
        gapUnit: gapUnitFor(metric),
        observations: {
          a: interval.years.map((year) => observationAt('a', year)),
          b: interval.years.map((year) => observationAt('b', year)),
        },
        a: aOut,
        b: bOut,
        gap: gapOut,
        requiredObservationYears: interval.years,
      };
    };
    const totalA = periodSum({ values: plan.requiredObservationYears.map((year) => ({ year, value: valueAt('a', year).value })), startYear: first.start, endYear: second.end }, metric);
    const totalB = periodSum({ values: plan.requiredObservationYears.map((year) => ({ year, value: valueAt('b', year).value })), startYear: first.start, endYear: second.end }, metric);
    const intervalResults = [
      periodComponent(first, sumA1, sumB1),
      periodComponent(second, sumA2, sumB2),
      {
        id: 'AC',
        label: 'A → C',
        start: first.start,
        end: second.end,
        kind: 'period_total_growth',
        formula: plan.formula,
        unit: '%',
        gapUnit: 'percentage points',
        observations: {
          a: plan.requiredObservationYears.map((year) => observationAt('a', year)),
          b: plan.requiredObservationYears.map((year) => observationAt('b', year)),
        },
        a: { ...growthAOut, periodStart: { ...sumA1, period: { start: first.start, end: first.end } }, periodEnd: { ...sumA2, period: { start: second.start, end: second.end } } },
        b: { ...growthBOut, periodStart: { ...sumB1, period: { start: first.start, end: first.end } }, periodEnd: { ...sumB2, period: { start: second.start, end: second.end } } },
        gap,
        componentTotals: { a: totalA, b: totalB },
        requiredObservationYears: plan.requiredObservationYears,
      },
    ];
    return {
      available,
      reason: available ? null : gap.reason,
      detail: available ? null : 'The period-total growth comparison is not publishable under the selected methodology.',
      scope: available ? 'none' : 'comparison',
      period: { start: first.start, end: second.end, inclusiveStart: true, inclusiveEnd: false },
      a: { ...growthAOut, periodStart: sumA1, periodEnd: sumA2 },
      b: { ...growthBOut, periodStart: sumB1, periodEnd: sumB2 },
      gap,
      intervalResults,
      unit: 'percentage points',
    };
  }

  // ---- segmented growth (A->B, B->C and A->C over ONE shared universe) ---
  if (operation === 'segmented_growth') {
    const aggregateBlock = mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB));
    if (aggregateBlock) {
      note(
        COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE,
        'comparison',
        'An official World Bank aggregate is the published value; it is not recomputed over the common universe, ' +
          'so a like-for-like segmented growth comparison against it cannot be established.',
        { years: plan.requiredObservationYears },
      );
    }
    const segments = {};
    let allComputable = true;
    for (const interval of plan.intervals) {
      const legOf = (slot) => {
        const a = valueAt(slot, interval.start);
        const b = valueAt(slot, interval.end);
        const leg = computeTransform(metric, TRANSFORMS.PERCENT_CHANGE, { a: a.value, b: b.value });
        const partial =
          (a.value !== null && a.value !== undefined && a.complete === false) ||
          (b.value !== null && b.value !== undefined && b.complete === false);
        return partial
          ? blockedResult(leg, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The segment depends on a partial coverage value.')
          : leg;
      };
      const legA = legOf('a');
      const legB = legOf('b');
      const gap =
        legA.computable && legB.computable && !aggregateBlock && !hardBlock
          ? { value: legA.value - legB.value, reason: null, unit: 'percentage points' }
          : {
              value: null,
              reason: aggregateBlock
                ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE
                : hardBlock
                  ? hardBlock
                  : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
              unit: 'percentage points',
            };
      if (gap.value === null) allComputable = false;
      segments[interval.id] = {
        start: interval.start,
        end: interval.end,
        a: legA,
        b: legB,
        gap,
        unit: '%',
      };
    }
    return {
      available: allComputable,
      reason: allComputable ? null : COMPARE_BLOCK_CODES.MISSING_REQUIRED_DATA,
      detail: allComputable ? null : 'One or more segments could not be computed from complete observations.',
      scope: allComputable ? 'none' : 'comparison',
      segments,
      intervalResults: buildIntervalResults('change', plan.intervals),
      unit: 'percentage points',
    };
  }

  // ---- two-point change operations ---------------------------------------
  const code =
    operation === 'absolute_change'
      ? TRANSFORMS.ABSOLUTE_CHANGE
      : operation === 'percent_change'
        ? TRANSFORMS.PERCENT_CHANGE
        : operation === 'pp_change'
          ? TRANSFORMS.PERCENTAGE_POINT_CHANGE
          : operation === 'index_point_change'
            ? TRANSFORMS.INDEX_POINT_CHANGE
            : TRANSFORMS.CAGR;
  const [startYear, endYear] = plan.endpointYears;
  const inputsFor = (slot) => {
    const endpoints = slotEndpoints(slot, plan.endpointYears, valueAt);
    if (code === TRANSFORMS.CAGR) {
      return { a: endpoints.a.value, b: endpoints.b.value, years: endYear - startYear };
    }
    return { a: endpoints.a.value, b: endpoints.b.value };
  };
  const changeA = computeTransform(metric, code, inputsFor('a'));
  const changeB = computeTransform(metric, code, inputsFor('b'));

  // A partial coverage value can never feed a derived result. A MISSING
  // value is not "partial": it is reported by the transform itself with the
  // missing-input reason.
  const partialSide = (slot) => {
    for (const year of plan.endpointYears) {
      const probe = valueAt(slot, year);
      if (probe.value !== null && probe.value !== undefined && probe.complete === false) return year;
    }
    return null;
  };
  const partialA = partialSide('a');
  const partialB = partialSide('b');
  const aggregateBlock = mode === 'like_for_like' && (isAggregate(entityA) || isAggregate(entityB));
  if (partialA !== null) {
    note(COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'entity_a', 'The change depends on a partial coverage value.', {
      entity: entityA.label ?? entityA.name ?? entityA.iso3,
      years: [partialA],
    });
  }
  if (partialB !== null) {
    note(COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'entity_b', 'The change depends on a partial coverage value.', {
      entity: entityB.label ?? entityB.name ?? entityB.iso3,
      years: [partialB],
    });
  }
  // A partial subtotal never keeps a computed change: the number would be
  // built on observations that do not exist.
  const changeAOut = partialA !== null
    ? blockedResult(changeA, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The change depends on a partial coverage value.')
    : changeA;
  const changeBOut = partialB !== null
    ? blockedResult(changeB, COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE, 'The change depends on a partial coverage value.')
    : changeB;
  if (aggregateBlock) {
    note(
      COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE,
      'comparison',
      'An official World Bank aggregate is the published value; it is not recomputed over the common universe, ' +
        'so a like-for-like change comparison against it cannot be established.',
      { years: plan.endpointYears },
    );
  }

  const gapUnit =
    code === TRANSFORMS.ABSOLUTE_CHANGE
      ? gapUnitFor(metric)
      : code === TRANSFORMS.PERCENTAGE_POINT_CHANGE || code === TRANSFORMS.INDEX_POINT_CHANGE
        ? (changeAOut.unit ?? changeBOut.unit ?? gapUnitFor(metric))
        : 'percentage points';
  const blocked = partialA !== null || partialB !== null || aggregateBlock || hardBlock;
  const gap =
    changeAOut.computable && changeBOut.computable && !blocked
      ? { value: changeAOut.value - changeBOut.value, reason: null, unit: gapUnit }
      : {
          value: null,
          reason: aggregateBlock
            ? COMPARE_BLOCK_CODES.AGGREGATE_COVERAGE_NOT_COMPARABLE
            : hardBlock
              ? hardBlock
              : blocked
                ? COMPARE_BLOCK_CODES.COVERAGE_INCOMPLETE
                : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
          unit: gapUnit,
        };
  const available = gap.value !== null;
  return {
    available,
    reason: available ? null : gap.reason,
    detail: available ? null : 'The change comparison is not publishable under the selected methodology.',
    scope: available ? 'none' : 'comparison',
    a: changeAOut,
    b: changeBOut,
    gap,
    intervalResults: buildIntervalResults('change', plan.intervals),
    unit: gapUnit,
  };
}

/**
 * Group evaluation preview (thin wrapper over resolution + capability +
 * coverage): validates a request-defined member set and reports what a
 * comparison could compute, without performing one. No persistence.
 */
export async function buildGroupEvaluation(db, options = {}) {
  const rawMembers = options.members;
  const memberText = Array.isArray(rawMembers) ? rawMembers.join(',') : (rawMembers ?? '');
  const spec = parseEntitySpec(`group:${memberText}`, options.label ?? null);
  const entity = await resolveEntity(db, spec);
  const metric = METRICS[options.metricKey];
  if (!metric) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_INDICATOR, `Unknown indicator "${options.metricKey}".`);
  }
  const canValue = metric.aggregation === 'SUM' || metric.aggregation === 'WEIGHTED_RATIO';
  const indicator = await getIndicatorByMetricKey(db, options.metricKey);
  const denMetric = metric.aggregation === 'WEIGHTED_RATIO' && metric.requiredDenominator?.metricKey
    ? (METRICS[metric.requiredDenominator.metricKey] ?? null)
    : null;
  const denIndicator = denMetric ? await getIndicatorByMetricKey(db, denMetric.key) : null;
  let coverage = null;
  if (indicator && (options.yearA !== undefined || options.yearB !== undefined || options.yearC !== undefined)) {
    const years = [options.yearA, options.yearB, options.yearC].filter((y) => Number.isInteger(y));
    if (years.length > 0) {
      const rows = await getEligibleObservationsForYears(db, indicator.id, years);
      const denRows = denIndicator ? await getEligibleObservationsForYears(db, denIndicator.id, years) : [];
      const memberSet = new Set(entity.members);
      coverage = {};
      for (const year of years) {
        const valid = rows.filter((r) => r.year === year && memberSet.has(r.iso3)).map((r) => r.iso3).sort();
        const validSet = new Set(valid);
        const yearCoverage = {
          valid,
          missing: entity.members.filter((iso3) => !validSet.has(iso3)),
          validCount: valid.length,
          missingCount: entity.members.filter((iso3) => !validSet.has(iso3)).length,
        };
        if (denMetric) {
          const denValid = denRows.filter((r) => r.year === year && memberSet.has(r.iso3)).map((r) => r.iso3).sort();
          const denValidSet = new Set(denValid);
          yearCoverage.numeratorMetric = metric.key;
          yearCoverage.denominatorMetric = denMetric.key;
          yearCoverage.denominatorValid = denValid;
          yearCoverage.missingNumerators = entity.members.filter((iso3) => !validSet.has(iso3));
          yearCoverage.missingDenominators = entity.members.filter((iso3) => !denValidSet.has(iso3));
        }
        coverage[year] = yearCoverage;
      }
    }
  }
  return {
    valid: true,
    type: ENTITY_KINDS.CUSTOM_GROUP,
    label: entity.label,
    members: entity.members.map((iso3) => ({ iso3, name: entity.memberNames[iso3] })),
    memberCount: entity.members.length,
    metric: describeMeasure(metric),
    capability: {
      canComputeGroupValue: canValue,
      aggregation: metric.aggregation,
      reason: canValue ? null : ENTITY_ERROR_CODES.NOT_AGGREGATABLE,
    },
    coverage,
    ingested: indicator !== null,
    source: sourceAttribution(),
  };
}

export default { buildCompareResponse, buildGroupEvaluation, buildGroupRatioSeries, COMPARE_BLOCK_CODES };
