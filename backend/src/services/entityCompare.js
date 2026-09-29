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
  groupRatioFromSums,
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
async function readEntityValues(db, entity, indicator, years) {
  const values = {};
  const vintageLegs = [];
  for (const year of years) values[year] = null;

  for (const year of years) {
    const row = await getObservation(db, entity.iso3, indicator.id, year);
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
 * WEIGHTED GROUP RATIO series (Phase 7C-2): SUM(numerator legs) /
 * SUM(denominator legs) x 100 for the same group and year — e.g. group
 * FDI % GDP from member FDI inflows over member total GDP. Never
 * average(member ratios), never sum(member ratios).
 *
 * Strict per-year completeness: every member must hold BOTH legs; legs of
 * the same series must share one World Bank vintage (cross-series vintage
 * differences surface as warnings, as with group sums); numerator and
 * denominator bases must match the registry linkage. One violation makes
 * that year unavailable with an explicit reason — never a partial ratio.
 * Like-for-like restricts to members fully legged in EVERY year.
 *
 * Exported for unit tests (basis/vintage branches); production calls flow
 * through buildCompareResponse so capability gating always applies first.
 */
export function buildGroupRatioSeries(entity, numRowsByYear, denRowsByYear, years, metric, denMetric) {
  const observed = {};
  const likeForLike = {};
  const coverage = {};
  // Basis compatibility is declarative and leg-to-leg: the numerator series
  // (from requiredDenominator.numeratorMetric) and the denominator series
  // must share price and currency basis — current-price FDI over
  // current-price GDP. The ratio itself carries no basis and is never one
  // side of the comparison. A missing linkage fails closed (registry
  // misconfiguration), never silently.
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
    // Vintage coherence is enforced WITHIN each leg family: member rows of
    // the same series must share one World Bank vintage, otherwise the set
    // is incoherent. Across families (FDI series vs GDP series) different
    // last-updated stamps are legitimate — series update on their own
    // cycles — and surface through the response vintage warning instead
    // of refusing (same tolerance as group sums across members).
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
    // `missing` mirrors the SUM-series coverage shape (union of members
    // lacking any leg) so shared renderers never branch on aggregation.
    const missingUnion = [...new Set([...missingNumerators, ...missingDenominators])].sort();
    const base = {
      members: valid.length,
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
  // Like-for-like: members fully legged in EVERY requested year.
  const commonSet = new Set(entity.members);
  for (const year of years) {
    const yearValid = new Set(coverage[year]?.valid ?? []);
    for (const iso3 of [...commonSet]) {
      if (!yearValid.has(iso3)) commonSet.delete(iso3);
    }
  }
  const common = [...commonSet].sort();
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

/**
 * Generic entity comparison.
 *
 * @param {object} db
 * @param {{entityA:string, entityB:string, labelA?:string, labelB?:string,
 *   metricKey:string, yearA:number, yearB?:number,
 *   operation?:string, groupMode?:string}} options
 */
export async function buildCompareResponse(db, options = {}) {
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

  const entityA = await resolveEntity(db, parseEntitySpec(options.entityA, options.labelA ?? null));
  const entityB = await resolveEntity(db, parseEntitySpec(options.entityB, options.labelB ?? null));
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

  const indicator = await getIndicatorByMetricKey(db, options.metricKey);
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
  // reads by the universe rule, by design). Weighted-ratio metrics additionally
  // resolve their canonical denominator legs (requiredDenominator linkage).
  const eligibleRows = await getEligibleObservationsForYears(db, indicator.id, years);
  const eligibleByYear = new Map(years.map((y) => [y, []]));
  for (const row of eligibleRows) {
    if (eligibleByYear.has(row.year)) {
      eligibleByYear.get(row.year).push(row);
    }
  }
  let denMetric = null;
  let denEligibleByYear = null;
  let numEligibleByYear = null;
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
    // Numerator legs come from the numerator SERIES (e.g. FDI net inflows),
    // never from the ratio indicator itself: averaging or summing the
    // published member ratios would reconstruct the forbidden statistic.
    for (const [mapKey, seriesKey] of [['num', numKey], ['den', denKey]]) {
      const seriesIndicator = await getIndicatorByMetricKey(db, seriesKey);
      const byYear = new Map(years.map((y) => [y, []]));
      if (seriesIndicator) {
        for (const row of await getEligibleObservationsForYears(db, seriesIndicator.id, years)) {
          if (byYear.has(row.year)) {
            byYear.get(row.year).push(row);
          }
        }
      }
      if (mapKey === 'num') numEligibleByYear = byYear;
      else denEligibleByYear = byYear;
    }
  }

  // Vintage coherence is measured over legs actually used (entity
  // observations + group member rows), never the whole universe.
  const results = {};
  const vintageValues = new Set();

  for (const [slot, entity] of [['a', entityA], ['b', entityB]]) {
    if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
      const memberRowsByYear = new Map();
      const isRatio = metric.aggregation === 'WEIGHTED_RATIO';
      for (const year of years) {
        const all = eligibleByYear.get(year) ?? [];
        const memberSet = new Set(entity.members);
        const memberRows = all.filter((r) => memberSet.has(r.iso3));
        memberRowsByYear.set(year, memberRows);
        // Ratio groups resolve their own numerator/denominator legs below;
        // only actually-used rows may contribute to vintage coherence.
        if (!isRatio) {
          for (const row of memberRows) {
            if (row.wbLastUpdated) vintageValues.add(row.wbLastUpdated);
          }
        }
      }
      // WEIGHTED_RATIO groups resolve numerator + denominator legs per
      // member/year (requiredDenominator linkage); every other group sums.
      const series = isRatio
        ? (() => {
          const memberSet = new Set(entity.members);
          const numRowsByYear = new Map();
          const denRowsByYear = new Map();
          for (const year of years) {
            numRowsByYear.set(year, (numEligibleByYear.get(year) ?? []).filter((r) => memberSet.has(r.iso3)));
            denRowsByYear.set(year, (denEligibleByYear.get(year) ?? []).filter((r) => memberSet.has(r.iso3)));
          }
          const ratio = buildGroupRatioSeries(entity, numRowsByYear, denRowsByYear, years, metric, denMetric);
          for (const vintage of ratio.vintages) vintageValues.add(vintage);
          return ratio;
        })()
        : buildGroupSeries(entity, memberRowsByYear, years, metric);
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
    const { values, vintageLegs } = await readEntityValues(db, entity, indicator, years);
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
  const changeInputs = (slot) =>
    code === TRANSFORMS.CAGR
      ? { a: valueOf(slot, yearA), b: valueOf(slot, yearB), years: Math.abs(yearB - yearA) }
      : { a: valueOf(slot, yearA), b: valueOf(slot, yearB) };
  const changeA = computeTransform(metric, code, changeInputs('a'));
  const changeB = computeTransform(metric, code, changeInputs('b'));
  // Gap units: absolute gaps carry the metric unit; gaps of two percentage
  // rates are percentage-point differences (never a percent); gaps of two
  // point changes (pp/index) carry the same point unit.
  const gapUnit =
    code === TRANSFORMS.ABSOLUTE_CHANGE
      ? gapUnitFor(metric)
      : code === TRANSFORMS.PERCENTAGE_POINT_CHANGE || code === TRANSFORMS.INDEX_POINT_CHANGE
        ? (changeA.unit ?? changeB.unit ?? gapUnitFor(metric))
        : 'percentage points';
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
  // Weighted-ratio preview additionally resolves denominator legs so the
  // evaluation shows numerator AND denominator coverage per year.
  const denMetric = metric.aggregation === 'WEIGHTED_RATIO' && metric.requiredDenominator?.metricKey
    ? (METRICS[metric.requiredDenominator.metricKey] ?? null)
    : null;
  const denIndicator = denMetric ? await getIndicatorByMetricKey(db, denMetric.key) : null;
  let coverage = null;
  if (indicator && (options.yearA !== undefined || options.yearB !== undefined)) {
    const years = [options.yearA, options.yearB].filter((y) => Number.isInteger(y));
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

export default { buildCompareResponse, buildGroupEvaluation };
