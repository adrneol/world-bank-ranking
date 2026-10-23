import { METRICS } from '../config.js';
import { getEligibleObservationsForYears, getIndicatorByMetricKey, getObservationsForEntityList } from '../db/repository.js';
import { COMPARE_BASIS_LEGS, calculateCompareBasis } from '../domain/compareBasis.js';
import { EXTERNAL_BASIS_INFO, rankExternalDesc } from '../domain/externalMovement.js';
import { CAPITAL_BASIS_INFO, rankCapitalDesc } from '../domain/capitalMovement.js';
import { computeTransform, TRANSFORMS } from '../domain/transforms.js';
import { describeMeasure } from '../domain/format.js';
import { sourceAttribution } from './attribution.js';
import { buildCompareUniverse, membershipHash } from '../domain/compareUniverse.js';
import { compareCacheKey, compareInvalidationSignals, getCachedCompare, setCachedCompare } from './compareCache.js';
import { ENTITY_KINDS, ENTITY_ERROR_CODES, entityError } from './entities.js';

const BASIS_INFO = Object.freeze({ ...EXTERNAL_BASIS_INFO, ...CAPITAL_BASIS_INFO });
const PERIOD_BASES = new Set(['ca_average_gdp', 'ca_cumulative_share', 'fdigdp_period_cumulative_share', 'remit_cumulative_intensity']);
const ANALYSES_BY_BASIS = Object.freeze({
  ca_annual_gdp: ['level', 'pp_change'],
  ca_average_gdp: ['level'],
  ca_cumulative_share: ['level'],
  fdigdp_period_cumulative_share: ['level'],
  res_import_coverage: ['level', 'absolute_change'],
  remit_cumulative_intensity: ['level'],
});

export function compareAnalysesForBasis(basis) {
  return ANALYSES_BY_BASIS[basis] ? [...ANALYSES_BY_BASIS[basis]] : null;
}

const indexRows = (rows) => {
  const result = new Map();
  for (const row of rows ?? []) {
    const iso = String(row.iso3).toUpperCase();
    if (!result.has(iso)) result.set(iso, new Map());
    result.get(iso).set(Number(row.year), Number(row.value));
  }
  return result;
};

const span = (start, end) => Array.from({ length: Math.max(0, end - start + 1) }, (_v, i) => start + i);
const unique = (values) => [...new Set(values)].sort((a, b) => a - b);

export function compareBasisMetricForAnalysis(metric, basis, analysis) {
  const info = BASIS_INFO[basis];
  if (!info || !COMPARE_BASIS_LEGS[basis]) return null;
  const ratio = info.unit === '% of GDP';
  const rateTransform = ratio ? [TRANSFORMS.PERCENTAGE_POINT_CHANGE] : [];
  const absoluteTransform = analysis === 'absolute_change' ? [TRANSFORMS.ABSOLUTE_CHANGE] : [];
  return {
    ...metric,
    key: metric.key,
    unit: info.unit,
    unitLong: info.unit,
    observationType: ratio ? 'RATE' : metric.observationType,
    validChangeTypes: Object.freeze([...rateTransform, ...absoluteTransform]),
    periodAggregation: Object.freeze([]),
  };
}

function valueForEntity({ entity, legs, basis, year, startYear, endYear, mode, commonMembers }) {
  if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
    const members = mode === 'like_for_like' ? commonMembers : entity.members;
    if (mode === 'observed' && members.length !== entity.members.length) {
      return { available: false, value: null, complete: false, reason: 'MISSING_REQUIRED_DATA', missingMembers: entity.members.filter((iso) => !members.includes(iso)) };
    }
    const calculated = calculateCompareBasis({ basis, legs, members, year, startYear, endYear });
    return { available: calculated.computable, value: calculated.value, complete: calculated.computable, reason: calculated.reason, missingYears: calculated.missingYears ?? [], members: members.length, provenance: 'APP_DERIVED' };
  }
  if (mode === 'like_for_like' && entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE) {
    return { available: false, value: null, complete: false, reason: 'AGGREGATE_COVERAGE_NOT_COMPARABLE' };
  }
  const calculated = calculateCompareBasis({ basis, legs, iso3: entity.iso3, year, startYear, endYear });
  return { available: calculated.computable, value: calculated.value, complete: calculated.computable, reason: calculated.reason, missingYears: calculated.missingYears ?? [], provenance: 'APP_DERIVED' };
}

function completeCountries(legs, years) {
  const universe = new Set();
  for (const map of Object.values(legs)) for (const iso3 of map.keys()) universe.add(iso3);
  return [...universe].filter((iso3) => Object.values(legs).every((byIso) => {
    const values = byIso.get(iso3);
    return values && years.every((year) => Number.isFinite(values.get(year)));
  })).sort();
}

function candidateRows(legs, years) {
  return new Map(years.map((year) => [year, [...new Set(Object.values(legs).flatMap((byIso) => [...byIso.keys()]))]
    .filter((iso3) => Object.values(legs).every((byIso) => Number.isFinite(byIso.get(iso3)?.get(year))))
    .map((iso3) => ({ iso3, value: 1 }))]));
}

function operationTransform(operation) {
  if (operation === 'pp_change') return TRANSFORMS.PERCENTAGE_POINT_CHANGE;
  if (operation === 'absolute_change') return TRANSFORMS.ABSOLUTE_CHANGE;
  return null;
}

/** Build a Compare response for a registered Movement basis with extra legs. */
export async function buildCompareMovementBasisResponse(db, {
  metric, basis, operation, groupMode, entityA, entityB, plan, capability, capabilityMismatch,
  entitySpecA, entitySpecB, labelA, labelB,
}) {
  const info = BASIS_INFO[basis];
  const legsNeeded = COMPARE_BASIS_LEGS[basis];
  if (!info || !legsNeeded) return null;
  const validAnalyses = compareAnalysesForBasis(basis);
  if (!validAnalyses.includes(operation)) {
    throw entityError(ENTITY_ERROR_CODES.UNSUPPORTED_TRANSFORMATION,
      `Analysis "${operation}" is not registered for basis "${basis}". Supported analyses: ${validAnalyses.join(', ')}.`);
  }
  const actualMetric = METRICS[info.metricKey] ?? metric;
  const operationMetric = compareBasisMetricForAnalysis(actualMetric, basis, operation);
  const responsePlanYears = unique(plan.requiredObservationYears);
  const allCalculationYears = unique([
    ...responsePlanYears,
    ...plan.seriesYears,
    ...plan.intervals.flatMap(({ start, end }) => PERIOD_BASES.has(basis) ? span(start + 1, end) : [start, end]),
  ]);
  const legIndicators = {};
  const legs = {};
  const signatures = [];
  const vintageValues = new Set();
  let contentVersion = 'none';
  for (const key of legsNeeded) {
    const indicator = await getIndicatorByMetricKey(db, key);
    if (!indicator) {
      throw entityError(ENTITY_ERROR_CODES.MISSING_REQUIRED_DATA, `Required source series "${key}" is not ingested for basis "${basis}".`);
    }
    legIndicators[key] = indicator;
    const signals = await compareInvalidationSignals(db, indicator.id, allCalculationYears);
    contentVersion = signals.contentVersion;
    signatures.push(`${key}:${signals.signature.rows}:${signals.signature.minVintage ?? '-'}:${signals.signature.maxVintage ?? '-'}`);
    const rows = await getEligibleObservationsForYears(db, indicator.id, allCalculationYears);
    for (const row of rows) if (row.wbLastUpdated) vintageValues.add(row.wbLastUpdated);
    legs[key] = indexRows(rows);
  }
  const selectedIso = [entityA.iso3, entityB.iso3].filter(Boolean);
  for (const [key, indicator] of Object.entries(legIndicators)) {
    const explicit = selectedIso.length ? await getObservationsForEntityList(db, indicator.id, selectedIso, allCalculationYears) : [];
    for (const row of explicit) if (row.wbLastUpdated) vintageValues.add(row.wbLastUpdated);
    for (const [iso, values] of indexRows(explicit)) legs[key].set(iso, values);
  }
  const cacheKey = compareCacheKey({
    contentVersion,
    signature: { rows: signatures.join('|'), minVintage: null, maxVintage: null },
    metricKey: metric.key, basis, operation, mode: groupMode,
    entityA: entitySpecA, entityB: entitySpecB, labelA: labelA ?? '', labelB: labelB ?? '',
    yearA: plan.periods.a, yearB: plan.periods.b, yearC: plan.periods.c,
  });
  const cached = getCachedCompare(db, cacheKey);
  if (cached) return { ...cached, cached: true };

  const completeYears = PERIOD_BASES.has(basis)
    ? unique(plan.intervals.flatMap(({ start, end }) => span(start + 1, end)))
    : responsePlanYears;
  const mode = groupMode;
  const rawComplete = completeCountries(legs, completeYears);
  // Freeze one basis-specific universe: countries must be calculable for every
  // selected interval/endpoint, including the Movement denominator rules.
  const isCountryCalculable = (iso3) => {
    if (PERIOD_BASES.has(basis)) {
      return plan.intervals.every(({ start, end }) => calculateCompareBasis({ basis, legs, iso3, startYear: start, endYear: end }).computable);
    }
    if (operation === 'level') return responsePlanYears.every((year) => calculateCompareBasis({ basis, legs, iso3, year }).computable);
    return plan.intervals.every(({ start, end }) => {
      const first = calculateCompareBasis({ basis, legs, iso3, year: start });
      const last = calculateCompareBasis({ basis, legs, iso3, year: end });
      return first.computable && last.computable && computeTransform(operationMetric, operationTransform(operation), { a: first.value, b: last.value }).computable;
    });
  };
  const commonCountries = rawComplete.filter(isCountryCalculable);
  const participants = [entityA, entityB].flatMap((entity) => entity.kind === ENTITY_KINDS.CUSTOM_GROUP
    ? entity.members.map((iso3) => ({ iso3, role: 'group_member' }))
    : entity.iso3 ? [{ iso3: entity.iso3, role: 'entity' }] : []);
  const universeRows = candidateRows(legs, completeYears);
  const baseUniverse = buildCompareUniverse({ rowsByYear: universeRows, requiredObservationYears: completeYears, participants, mode });
  const nonComputable = rawComplete.filter((iso3) => !isCountryCalculable(iso3)).map((iso3) => ({
    iso3,
    reason: 'basis_formula_not_computable',
  }));
  const distinct = new Map((baseUniverse.excluded.distinct ?? []).map((entry) => [entry.iso3, entry]));
  for (const entry of nonComputable) {
    const existing = distinct.get(entry.iso3);
    distinct.set(entry.iso3, existing
      ? { ...existing, reasons: [...new Set([...existing.reasons, entry.reason])] }
      : { iso3: entry.iso3, reasons: [entry.reason], missingYears: [] });
  }
  const excludedDistinct = [...distinct.values()].sort((left, right) => left.iso3.localeCompare(right.iso3));
  const includedCountries = commonCountries.filter((iso3) => !participants.some((participant) => participant.iso3 === iso3));
  const universe = {
    ...baseUniverse,
    complete: commonCountries,
    completeCount: commonCountries.length,
    included: includedCountries,
    membershipHash: membershipHash(includedCountries),
    completeMembershipHash: membershipHash(commonCountries),
    excluded: { ...baseUniverse.excluded, distinct: excludedDistinct, nonComputable },
    counts: {
      ...baseUniverse.counts,
      complete: commonCountries.length,
      reference: includedCountries.length,
      excludedDistinct: excludedDistinct.length,
      nonComputable: nonComputable.length,
    },
  };
  const commonSet = new Set(commonCountries);
  const groupCommon = (entity) => entity.kind === ENTITY_KINDS.CUSTOM_GROUP
    ? entity.members.filter((iso) => commonSet.has(iso))
    : [];
  const blockedCapability = capabilityMismatch ? ENTITY_ERROR_CODES.UNSUPPORTED_ENTITY_COMBINATION : null;
  const entities = { a: entityA, b: entityB };
  const rowsForRanking = (basis, interval, annualYear = null) => {
    const candidates = mode === 'like_for_like' ? commonCountries : [...new Set(Object.values(legs)[0].keys())];
    const rows = [];
    for (const iso3 of candidates) {
      const value = annualYear !== null
        ? valueForEntity({ entity: { kind: ENTITY_KINDS.COUNTRY, iso3 }, legs, basis, year: annualYear, mode: 'observed' })
        : valueForEntity({ entity: { kind: ENTITY_KINDS.COUNTRY, iso3 }, legs, basis, startYear: interval.start, endYear: interval.end, mode: 'observed' });
      if (value.available) rows.push({ iso3, value: value.value });
    }
    return basis.startsWith('fdigdp_') ? rankCapitalDesc(rows) : rankExternalDesc(rows);
  };
  const getValue = (entity, interval, year = null) => {
    const commonMembers = groupCommon(entity);
    const result = year !== null
      ? valueForEntity({ entity, legs, basis, year, mode, commonMembers })
      : valueForEntity({ entity, legs, basis, startYear: interval.start, endYear: interval.end, mode, commonMembers });
    return {
      ...result,
      provenance: result.provenance ?? (entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE ? 'APP_DERIVED_FROM_PUBLISHED_LEGS' : 'APP_DERIVED'),
      derivation: {
        operation: 'COMPARE_MOVEMENT_BASIS',
        basisId: basis,
        formula: info.formula,
        sourceMetrics: legsNeeded,
        requiredYears: year !== null ? [year] : span(interval.start + 1, interval.end),
      },
    };
  };
  const sourceObservations = (entity, sourceYears) => Object.fromEntries(legsNeeded.map((key) => {
    const values = sourceYears.map((year) => {
      let value = legs[key].get(entity.iso3)?.get(year) ?? null;
      if (entity.kind === ENTITY_KINDS.CUSTOM_GROUP) {
        let sum = 0;
        let complete = true;
        const members = mode === 'like_for_like' ? groupCommon(entity) : entity.members;
        for (const iso3 of members) {
          const memberValue = legs[key].get(iso3)?.get(year);
          if (!Number.isFinite(memberValue)) { complete = false; break; }
          sum += memberValue;
        }
        value = complete && members.length ? sum : null;
      }
      return { year, value, available: value !== null };
    });
    return [key, values];
  }));
  const operationCode = operationTransform(operation);
  const intervals = operation === 'level'
    ? plan.intervals
    : plan.intervals;
  const intervalResults = [];
  for (const interval of intervals) {
    const isPeriodBasis = PERIOD_BASES.has(basis);
    const startValue = isPeriodBasis ? null : getValue(entityA, interval, interval.start);
    const endValue = isPeriodBasis ? null : getValue(entityA, interval, interval.end);
    const otherStart = isPeriodBasis ? null : getValue(entityB, interval, interval.start);
    const otherEnd = isPeriodBasis ? null : getValue(entityB, interval, interval.end);
    let aValue;
    let bValue;
    let aObs = [];
    let bObs = [];
    if (isPeriodBasis) {
      aValue = getValue(entityA, interval);
      bValue = getValue(entityB, interval);
      const required = span(interval.start + 1, interval.end);
      aObs = [{ interval: `${interval.start}→${interval.end}`, requiredYears: required, formula: info.formula, value: aValue.value, available: aValue.available, unit: info.unit, sourceValues: sourceObservations(entityA, required) }];
      bObs = [{ interval: `${interval.start}→${interval.end}`, requiredYears: required, formula: info.formula, value: bValue.value, available: bValue.available, unit: info.unit, sourceValues: sourceObservations(entityB, required) }];
    } else {
      aObs = [
        { year: interval.start, value: startValue.value, available: startValue.available, unit: info.unit, sourceValues: sourceObservations(entityA, [interval.start]) },
        { year: interval.end, value: endValue.value, available: endValue.available, unit: info.unit, sourceValues: sourceObservations(entityA, [interval.end]) },
      ];
      bObs = [
        { year: interval.start, value: otherStart.value, available: otherStart.available, unit: info.unit, sourceValues: sourceObservations(entityB, [interval.start]) },
        { year: interval.end, value: otherEnd.value, available: otherEnd.available, unit: info.unit, sourceValues: sourceObservations(entityB, [interval.end]) },
      ];
      if (operation === 'level') {
        aValue = endValue;
        bValue = otherEnd;
      } else {
        const transform = (first, last) => first.available && last.available
          ? computeTransform(operationMetric, operationCode, { a: first.value, b: last.value })
          : { computable: false, value: null, reason: first.reason ?? last.reason ?? 'MISSING_REQUIRED_DATA', unit: operationMetric.unit };
        aValue = transform(startValue, endValue);
        bValue = transform(otherStart, otherEnd);
      }
    }
    const rankFrame = isPeriodBasis
      ? rowsForRanking(basis, interval)
      : operation === 'level'
        ? rowsForRanking(basis, interval, interval.end)
        : (() => {
            const candidates = mode === 'like_for_like' ? commonCountries : [...new Set(Object.values(legs)[0].keys())];
            const rows = [];
            for (const iso3 of candidates) {
              const first = valueForEntity({ entity: { kind: ENTITY_KINDS.COUNTRY, iso3 }, legs, basis, year: interval.start, mode: 'observed' });
              const last = valueForEntity({ entity: { kind: ENTITY_KINDS.COUNTRY, iso3 }, legs, basis, year: interval.end, mode: 'observed' });
              if (first.available && last.available) {
                const result = computeTransform(operationMetric, operationCode, { a: first.value, b: last.value });
                if (result.computable) rows.push({ iso3, value: result.value });
              }
            }
            return basis.startsWith('fdigdp_') ? rankCapitalDesc(rows) : rankExternalDesc(rows);
          })();
    if (operation === 'level' && !isPeriodBasis) {
      const rankAtYear = (entity, year) => {
        if (entity.kind !== ENTITY_KINDS.COUNTRY) return null;
        const frame = rowsForRanking(basis, interval, year);
        const row = frame.ranked.find((item) => item.iso3 === entity.iso3);
        return row ? { position: row.rank, denominator: frame.total, attribution: 'APPLICATION_DERIVED', direction: 'DESC', methodology: 'Movement competition ranking over countries with complete selected-basis observations.' } : null;
      };
      aObs = aObs.map((entry) => ({ ...entry, rank: rankAtYear(entityA, entry.year) }));
      bObs = bObs.map((entry) => ({ ...entry, rank: rankAtYear(entityB, entry.year) }));
    }
    const rankFor = (entity, value) => entity.kind !== ENTITY_KINDS.COUNTRY || !value?.computable && value?.available === false
      ? null
      : rankFrame.ranked.find((row) => row.iso3 === entity.iso3)?.rank ?? null;
    const aRank = rankFor(entityA, aValue);
    const bRank = rankFor(entityB, bValue);
    const aOut = { ...aValue, computable: aValue.available ?? aValue.computable, unit: operation === 'level' ? info.unit : operationMetric.unit, rank: aRank === null ? null : { position: aRank, denominator: rankFrame.total, direction: 'DESC', attribution: 'APPLICATION_DERIVED', methodology: 'Movement competition ranking over countries with complete selected-basis observations.' } };
    const bOut = { ...bValue, computable: bValue.available ?? bValue.computable, unit: operation === 'level' ? info.unit : operationMetric.unit, rank: bRank === null ? null : { position: bRank, denominator: rankFrame.total, direction: 'DESC', attribution: 'APPLICATION_DERIVED', methodology: 'Movement competition ranking over countries with complete selected-basis observations.' } };
    const comparisonBlocked = blockedCapability || (mode === 'like_for_like' && (entityA.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE || entityB.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE));
    const gapUnit = operation === 'level' ? info.gapUnit : operation === 'absolute_change' ? info.gapUnit : 'percentage points';
    const gapValue = aOut.computable && bOut.computable && !comparisonBlocked ? aOut.value - bOut.value : null;
    const gap = operation === 'level' && !isPeriodBasis
      ? {
          start: { value: startValue.available && otherStart.available && !comparisonBlocked ? startValue.value - otherStart.value : null, unit: info.gapUnit },
          end: { value: endValue.available && otherEnd.available && !comparisonBlocked ? endValue.value - otherEnd.value : null, unit: info.gapUnit },
          value: gapValue, unit: info.gapUnit,
          reason: comparisonBlocked ?? (gapValue === null ? aOut.reason ?? bOut.reason ?? 'MISSING_REQUIRED_DATA' : null),
        }
      : { value: gapValue, unit: gapUnit, reason: gapValue === null ? comparisonBlocked ?? aOut.reason ?? bOut.reason ?? 'MISSING_REQUIRED_DATA' : null };
    intervalResults.push({
      id: interval.id, label: interval.label ?? interval.id, start: interval.start, end: interval.end,
      kind: isPeriodBasis ? 'movement_period' : operation === 'level' ? 'level' : 'change',
      basisDriven: true, basisPeriod: isPeriodBasis, requiredObservationYears: isPeriodBasis ? span(interval.start + 1, interval.end) : [interval.start, interval.end],
      formula: isPeriodBasis ? info.formula : operation === 'level' ? info.formula : `${operationMetric.key}: ${operation}`,
      unit: aOut.unit, gapUnit, observations: { a: aObs, b: bObs }, a: aOut, b: bOut, gap,
      available: gapValue !== null,
    });
  }
  const chosenYears = unique([...responsePlanYears, ...(plan.periods.c !== null ? [plan.periods.c] : [])]);
  const pointValues = (entity) => Object.fromEntries(chosenYears.map((year) => {
    const value = PERIOD_BASES.has(basis) ? { available: false, value: null, reason: 'period_basis' } : getValue(entity, null, year);
    return [year, { ...value, unit: info.unit, year }];
  }));
  const results = {};
  for (const slot of ['a', 'b']) {
    const entity = entities[slot];
    const values = pointValues(entity);
    const usedMembers = entity.kind === ENTITY_KINDS.CUSTOM_GROUP ? (mode === 'like_for_like' ? groupCommon(entity) : entity.members) : [];
    const usedMemberSet = new Set(usedMembers);
    results[slot] = {
      kind: entity.kind, iso3: entity.iso3, name: entity.name, label: entity.label,
      members: entity.members, memberNames: entity.memberNames,
      values, observed: values, likeForLike: values,
      coverageBasis: { observed: entity.kind === ENTITY_KINDS.OFFICIAL_AGGREGATE ? 'WORLD_BANK_PUBLISHED' : 'COMPARE_SOURCE_LEGS', like_for_like: 'COMMON_UNIVERSE', usedMembers, usedMemberCount: usedMembers.length },
      coverage: {
        requiredObservationYears: completeYears,
        complete: entity.kind === ENTITY_KINDS.CUSTOM_GROUP ? usedMembers.length === entity.members.length : chosenYears.every((year) => values[year]?.available),
        missingYears: entity.kind === ENTITY_KINDS.CUSTOM_GROUP ? completeYears.filter((year) => entity.members.some((iso) => !completeCountries(legs, [year]).includes(iso))) : chosenYears.filter((year) => !values[year]?.available),
        excludedMembers: entity.kind === ENTITY_KINDS.CUSTOM_GROUP ? entity.members.filter((iso) => !usedMemberSet.has(iso)) : [],
      },
      series: { points: PERIOD_BASES.has(basis) ? [] : chosenYears.map((year) => ({ year, value: values[year]?.value ?? null })) },
    };
  }
  const analysis = {
    id: operation, label: operation.replaceAll('_', ' '), kind: operation === 'level' ? 'point' : 'two_point',
    formula: operation === 'level' ? info.formula : operationMetric.validChangeTypes.length ? operationMetric.validChangeTypes[0] : info.formula,
    transform: operationCode, basis, basisMethod: info,
    startYear: plan.startYear, midYear: plan.midYear, endYear: plan.endYear,
    endpointYears: plan.endpointYears, requiredObservationYears: plan.requiredObservationYears,
    seriesYears: plan.seriesYears, ignoredPeriods: plan.ignoredPeriods, boundary: plan.boundary,
    intervals: plan.intervals,
  };
  const comparison = {
    available: intervalResults.some((item) => item.available),
    reason: intervalResults.some((item) => item.available) ? null : intervalResults[0]?.gap.reason ?? 'MISSING_REQUIRED_DATA',
    a: intervalResults[intervalResults.length - 1]?.a ?? null,
    b: intervalResults[intervalResults.length - 1]?.b ?? null,
    gap: intervalResults[intervalResults.length - 1]?.gap ?? null,
    intervalResults,
    unit: intervalResults[0]?.gapUnit ?? info.gapUnit,
  };
  const vintages = [...vintageValues].sort();
  const response = {
    available: true, reason: null, entities, metric: { ...describeMeasure(actualMetric), key: actualMetric.key, label: actualMetric.label ?? actualMetric.title ?? actualMetric.name, unit: info.unit, unitLong: info.unit },
    years: { a: plan.periods.a, b: plan.periods.b, c: plan.periods.c },
    operation, basis, basisMethod: info, sourceSeries: legsNeeded.map((key) => ({ metricKey: key, indicatorCode: legIndicators[key].code ?? legIndicators[key].indicatorCode, unit: legIndicators[key].unit })),
    groupMode, mode: groupMode, analysis, capability: blockedCapability ? { ...capability, allowed: false, reason: blockedCapability, detail: 'The selected entity combination is unavailable for the chosen Movement measurement basis.' } : capability,
    universe,
    results: { ...results, comparison }, diagnostics: [], vintage: {
      coherent: vintages.length <= 1,
      lastUpdatedValues: vintages,
      warning: vintages.length > 1 ? 'Source legs carry different World Bank vintages; the derived result combines those stored vintages.' : null,
    }, source: sourceAttribution(), cached: false,
  };
  setCachedCompare(db, cacheKey, response);
  return response;
}
