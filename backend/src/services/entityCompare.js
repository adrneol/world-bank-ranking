/**
 * GENERIC ENTITY COMPARISON SERVICE (Phase 4, orchestration only).
 *
 * One comparison architecture for every entity combination: resolve entities
 * (services/entities.js), check capability (entity types + metric semantics +
 * operation), read raw observations atomically, aggregate custom groups per
 * metric metadata with Phase-3 primitives, apply Phase-3 change transforms,
 * attach RAW vs APP_DERIVED provenance. No ranking math, no movement
 * decomposition, no leaderboard mixing lives here.
 *
 * Two structural guarantees:
 *  - official aggregates are compared as published entities (direct
 *    observations). The entered/exited/common decomposition is never
 *    attached: no member universe exists for an aggregate.
 *  - custom groups never enter a ranking universe. Group values exist only
 *    inside this comparison response, labelled user-selected.
 */

import { METRICS, getMetric } from '../config.js';
import {
  getEligibleObservationsForYears,
  getIndicatorByMetricKey,
  getObservation,
} from '../db/repository.js';
import { describeMeasure } from '../domain/format.js';
import {
  TRANSFORMS,
  computeTransform,
  crossRate,
  groupSum,
} from '../domain/transforms.js';
import { sourceAttribution } from './attribution.js';
import {
  COMPARE_OPERATIONS,
  ENTITY_ERROR_CODES,
  ENTITY_KINDS,
  GROUP_MODES,
  canCompare,
  entityError,
  parseEntitySpec,
  resolveEntity,
  validateCrossRateLegs,
} from './entities.js';

function gapUnitFor(metric) {
  if (metric.observationType === 'RATE' || metric.observationType === 'RATIO') return 'percentage points';
  if (metric.observationType === 'INDEX') return 'index points';
  return metric.unitLong ?? metric.unit ?? null;
}

/**
 * Read one country/aggregate entity's per-year values as direct observations
 * (RAW provenance). Missing stays missing. Custom groups are assembled by
 * buildGroupSeries, not here.
 *
 * @returns {{values: Record<number, object|null>, vintageLegs: string[]}}
 */
function readEntityValues(db, entity, indicator, years) {
  const values = {};
  const vintageLegs = [];
  for (const year of years) values[year] = null;

  for (const year of years) {
    const row = getObservation(db, entity.iso3, indicator.id, year);
    if (row && row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value))) {
      values[year] = {
        value: Number(row.value),
        valueRaw: row.value_raw ?? String(row.value),
        provenance: 'RAW',
      };
      if (row.wb_last_updated) vintageLegs.push(row.wb_last_updated);
    }
  }
  return { values, vintageLegs };
}

/**
 * Build APP_DERIVED group series for the requested years.
 *
 * observed[Y]      = sum of members valid in Y (+ coverage lists)
 * likeForLike[Y]   = sum of members valid in EVERY requested year
 * membershipEffect = observed absolute change - like-for-like absolute
 *                    change (exact: sums decompose; never a fabricated rate)
 */
function buildGroupSeries(entity, memberRowsByYear, years, metric) {
  const observed = {};
  const likeForLike = {};
  const coverage = {};
  for (const year of years) {
    const rows = memberRowsByYear.get(year) ?? [];
    const valid = rows.map((r) => r.iso3).sort();
    const validSet = new Set(valid);
    const missing = entity.members.filter((iso3) => !validSet.has(iso3));
    const sum = groupSum(rows.map((r) => r.value), metric);
    observed[year] = {
      value: sum.value,
      valueRaw: sum.value === null ? null : String(sum.value),
      members: valid.length,
      provenance: 'APP_DERIVED',
      derivation: { operation: 'GROUP_SUM', formula: 'sum(members)', metricKey: metric.key },
    };
    coverage[year] = { valid, missing, validCount: valid.length, missingCount: missing.length };
  }
  const commonSet = (() => {
    let acc = null;
    for (const year of years) {
      const set = new Set((memberRowsByYear.get(year) ?? []).map((r) => r.iso3));
      acc = acc === null ? [...set] : acc.filter((iso3) => set.has(iso3));
    }
    return new Set(acc ?? []);
  })();
  const common = [...commonSet].sort();
  for (const year of years) {
    const rows = (memberRowsByYear.get(year) ?? []).filter((r) => commonSet.has(r.iso3));
    const sum = groupSum(rows.map((r) => r.value), metric);
    likeForLike[year] = {
      value: sum.value,
      valueRaw: sum.value === null ? null : String(sum.value),
      members: rows.length,
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
 * Generic entity comparison.
 *
 * @param {object} db
 * @param {{entityA:string, entityB:string, labelA?:string, labelB?:string,
 *   metricKey:string, yearA:number, yearB?:number,
 *   operation?:string, groupMode?:string}} options
 */
export function buildCompareResponse(db, options = {}) {
  const metric = METRICS[options.metricKey];
  if (!metric) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_INDICATOR, `Unknown indicator "${options.metricKey}".`);
  }
  const operation = options.operation ?? 'level';
  const groupMode = options.groupMode ?? 'observed';
  if (!COMPARE_OPERATIONS.includes(operation)) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_OPERATION, `Unknown operation "${options.operation}". Expected one of ${COMPARE_OPERATIONS.join(', ')}.`);
  }
  if (!GROUP_MODES.includes(groupMode)) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_GROUP_MODE, `Unknown group mode "${options.groupMode}". Expected "observed" or "like_for_like".`);
  }
  const yearA = options.yearA;
  if (!Number.isInteger(yearA)) {
    throw entityError(ENTITY_ERROR_CODES.MISSING_YEAR, 'yearA is required for a comparison.');
  }
  const yearB = options.yearB ?? null;
  if (yearB !== null && !Number.isInteger(yearB)) {
    throw entityError(ENTITY_ERROR_CODES.MISSING_YEAR, 'yearB must be an integer year.');
  }

  const entityA = resolveEntity(db, parseEntitySpec(options.entityA, options.labelA ?? null));
  const entityB = resolveEntity(db, parseEntitySpec(options.entityB, options.labelB ?? null));
  const hasGroup = [entityA.kind, entityB.kind].includes(ENTITY_KINDS.CUSTOM_GROUP);

  if (groupMode === 'like_for_like' && !hasGroup) {
    throw entityError(
      ENTITY_ERROR_CODES.LIKE_FOR_LIKE_REQUIRES_GROUP,
      'Like-for-like mode requires at least one custom group entity.',
    );
  }
  if (operation === 'cross_rate' && yearB !== null) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_OPERATION, 'cross_rate compares one year only; omit yearB.');
  }
  if (operation !== 'level' && operation !== 'cross_rate' && yearB === null) {
    throw entityError(ENTITY_ERROR_CODES.MISSING_YEAR, `Operation "${operation}" requires yearA and yearB.`);
  }
  if (yearB !== null && yearB === yearA && operation !== 'level' && operation !== 'cross_rate') {
    throw entityError(ENTITY_ERROR_CODES.SAME_YEAR_SELECTED, 'yearA and yearB must differ for a change comparison.');
  }

  const capability = canCompare({ entityA, entityB, metric, operation });
  if (!capability.allowed) {
    throw entityError(capability.reason, `Comparison not supported for this entity/metric/operation combination (${capability.reason}).`);
  }

  const indicator = getIndicatorByMetricKey(db, options.metricKey);
  const years = yearB === null || yearB === yearA ? [yearA] : [yearA, yearB];
  if (!indicator) {
    return {
      available: false,
      reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
      entities: { a: entityA, b: entityB },
      metric: describeMeasure(metric),
      years: { a: yearA, b: yearB },
      operation,
      groupMode,
      capability,
      results: null,
      vintage: null,
      source: sourceAttribution(),
    };
  }

  // One atomic eligible read covers every country and group member. Official
  // aggregates are read directly per year (they are excluded from eligible
  // reads by the universe rule, by design).
  const eligibleRows = getEligibleObservationsForYears(db, indicator.id, years);
  const eligibleByYear = new Map(years.map((y) => [y, []]));
  for (const row of eligibleRows) {
    if (eligibleByYear.has(row.year)) {
      eligibleByYear.get(row.year).push(row);
    }
  }

  // Vintage coherence is measured over legs actually used (entity
  // observations + group member rows), never the whole universe.
  const results = {};
  const vintageValues = new Set();

  for (const [slot, entity] of [['a', entityA], ['b', entityB]]) {
    if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
      const memberRowsByYear = new Map();
      for (const year of years) {
        const all = eligibleByYear.get(year) ?? [];
        const memberSet = new Set(entity.members);
        const memberRows = all.filter((r) => memberSet.has(r.iso3));
        memberRowsByYear.set(year, memberRows);
        for (const row of memberRows) {
          if (row.wbLastUpdated) vintageValues.add(row.wbLastUpdated);
        }
      }
      const series = buildGroupSeries(entity, memberRowsByYear, years, metric);
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
      };
      continue;
    }
    const { values, vintageLegs } = readEntityValues(db, entity, indicator, years);
    for (const vintage of vintageLegs) vintageValues.add(vintage);
    results[slot] = {
      kind: entity.kind,
      iso3: entity.iso3,
      name: entity.name,
      source: entity.source,
      values: Object.fromEntries(
        years.map((year) => [
          year,
          values[year] === null
            ? { available: false, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, value: null }
            : { available: true, reason: null, ...values[year] },
        ]),
      ),
    };
  }

  // Apply the requested operation to the selected series.
  const comparison = applyOperation({ entityA, entityB, results, metric, years, yearA, yearB, operation, groupMode });

  const lastUpdatedValues = [...vintageValues].sort();
  const vintageBlock = {
    coherent: lastUpdatedValues.length <= 1,
    lastUpdatedValues,
    warning:
      lastUpdatedValues.length > 1
        ? 'Legs used in this comparison carry different World Bank vintages; values are shown with their provenance, not silently merged across vintages.'
        : null,
  };

  return {
    available: true,
    reason: null,
    entities: { a: entityA, b: entityB },
    metric: describeMeasure(metric),
    years: { a: yearA, b: yearB },
    operation,
    groupMode,
    capability,
    results: { ...results, comparison },
    vintage: vintageBlock,
    source: sourceAttribution(),
  };
}

function entityPointValue(slotResult, groupMode, year) {
  if (slotResult.kind === ENTITY_KINDS.CUSTOM_GROUP) {
    const block = groupMode === 'like_for_like' ? slotResult.likeForLike : slotResult.observed;
    return block?.[year]?.value ?? null;
  }
  return slotResult.values?.[year]?.value ?? null;
}

function applyOperation({ entityA, entityB, results, metric, years, yearA, yearB, operation, groupMode }) {
  const valueOf = (slot, year) => entityPointValue(results[slot], groupMode, year);

  if (operation === 'cross_rate') {
    const legA = { value: valueOf('a', yearA), year: yearA, quotation: metric.quotation?.convention ?? null };
    const legB = { value: valueOf('b', yearA), year: yearA, quotation: metric.quotation?.convention ?? null };
    const check = validateCrossRateLegs(metric, legA, legB);
    if (!check.valid) {
      return {
        available: false,
        reason: check.reason,
        detail: check.detail ?? null,
        value: null,
        unit: null,
        legs: {
          a: { iso3: entityA.iso3, value: legA.value },
          b: { iso3: entityB.iso3, value: legB.value },
        },
        provenance: { kind: 'APP_DERIVED', transform: 'CROSS_RATE', formula: 'A_per_USD / B_per_USD', metricKey: metric.key, outputUnit: null },
      };
    }
    const computed = crossRate({ aPerUsd: legA.value, bPerUsd: legB.value }, metric);
    return {
      available: true,
      reason: null,
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

  if (operation === 'level') {
    const perYear = {};
    for (const year of years) {
      const a = valueOf('a', year);
      const b = valueOf('b', year);
      perYear[year] = {
        a,
        b,
        gap: a === null || b === null ? null : a - b,
        gapReason: a === null || b === null ? ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA : null,
        unit: gapUnitFor(metric),
      };
    }
    return { available: true, reason: null, perYear, unit: gapUnitFor(metric) };
  }

  // Change operations: per-entity Phase-3 transforms, then an exact gap.
  const code = operation === 'absolute_change' ? TRANSFORMS.ABSOLUTE_CHANGE : operation === 'percent_change' ? TRANSFORMS.PERCENT_CHANGE : TRANSFORMS.CAGR;
  const changeInputs = (slot) =>
    code === TRANSFORMS.CAGR
      ? { a: valueOf(slot, yearA), b: valueOf(slot, yearB), years: Math.abs(yearB - yearA) }
      : { a: valueOf(slot, yearA), b: valueOf(slot, yearB) };
  const changeA = computeTransform(metric, code, changeInputs('a'));
  const changeB = computeTransform(metric, code, changeInputs('b'));
  const gapUnit = code === TRANSFORMS.ABSOLUTE_CHANGE ? gapUnitFor(metric) : 'percentage points';
  // A gap of two absolute changes carries the metric unit; a gap of two
  // percentage rates is a percentage-point difference — never a percent.
  const gap =
    changeA.computable && changeB.computable
      ? { value: changeA.value - changeB.value, reason: null, unit: gapUnit }
      : { value: null, reason: ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, unit: gapUnit };
  return {
    available: changeA.computable || changeB.computable,
    reason: changeA.computable || changeB.computable ? null : ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA,
    a: changeA,
    b: changeB,
    gap,
    unit: gapUnit,
  };
}

/**
 * Group evaluation preview (thin wrapper over resolution + capability +
 * coverage): validates a request-defined member set and reports what a
 * comparison could compute, without performing one. No persistence.
 */
export function buildGroupEvaluation(db, options = {}) {
  const rawMembers = options.members;
  const memberText = Array.isArray(rawMembers) ? rawMembers.join(',') : (rawMembers ?? '');
  const spec = parseEntitySpec(`group:${memberText}`, options.label ?? null);
  const entity = resolveEntity(db, spec);
  const metric = METRICS[options.metricKey];
  if (!metric) {
    throw entityError(ENTITY_ERROR_CODES.INVALID_INDICATOR, `Unknown indicator "${options.metricKey}".`);
  }
  const canValue = metric.aggregation === 'SUM';
  const indicator = getIndicatorByMetricKey(db, options.metricKey);
  let coverage = null;
  if (indicator && (options.yearA !== undefined || options.yearB !== undefined)) {
    const years = [options.yearA, options.yearB].filter((y) => Number.isInteger(y));
    if (years.length > 0) {
      const rows = getEligibleObservationsForYears(db, indicator.id, years);
      const memberSet = new Set(entity.members);
      coverage = {};
      for (const year of years) {
        const valid = rows.filter((r) => r.year === year && memberSet.has(r.iso3)).map((r) => r.iso3).sort();
        const validSet = new Set(valid);
        coverage[year] = {
          valid,
          missing: entity.members.filter((iso3) => !validSet.has(iso3)),
          validCount: valid.length,
          missingCount: entity.members.filter((iso3) => !validSet.has(iso3)).length,
        };
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

export default { buildCompareResponse, buildGroupEvaluation };
