/**
 * COVERAGE + "WHY DOES THE TOTAL CHANGE?" ENGINE (pure functions, no I/O).
 *
 * Implements specification section 6 (CASE A/B/C/D) and section 22 (YoY coverage)
 * using FACTS ONLY. Every sentence produced here is assembled from counts the
 * application actually holds:
 *
 *   - the stored eligible metadata universe (countries.is_aggregate = 0)
 *   - valid observations for a metric and year (rows in observations)
 *   - the per-year ingest counters recorded per metric, i.e. exactly which rows
 *     the universe rule removed (aggregates, blank ISO3, unknown entities)
 *   - the universe snapshots stored on completed fetch runs, which allow the
 *     ACTUAL added/removed entities to be listed
 *
 * The engine never states WHY the World Bank published different coverage. It may
 * not claim a country "did not report", "did not submit data", "was forgotten" or
 * "was excluded by the World Bank", because the source data does not establish
 * any of that. containsInventedCause() exists so a test can prove it.
 */

import { buildYoyRows } from './yoyRanking.js';
import { computeYoy } from './yoy.js';

export const COVERAGE_CASES = Object.freeze({
  NONE: 'NONE',
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
});

/** Meaning of each case, for the audit panel and the tests. */
export const COVERAGE_CASE_MEANINGS = Object.freeze({
  NONE: 'No difference in the number of ranked entities between the two years.',
  A: 'The eligible metadata universe is the same; the difference is observation coverage for that indicator-year.',
  B: 'The eligible World Bank country/economy metadata universe itself changed between the observations.',
  C: 'The difference is explained by aggregate / income-group filtering, not by missing country data.',
  D: 'The observed coverage and filtering difference is established, but no cause is inferred beyond the World Bank data.',
});

/**
 * Explicit evaluation order for the coverage explanation (spec section 6).
 * B > C > A > D.
 * B first because a universe change redefines the ranked population;
 * C second because measured filtering removals explain raw-row differences;
 * A third for stable-universe coverage changes; D otherwise with facts only
 * and no inference about reporting behavior.
 */
export const COVERAGE_PRECEDENCE = Object.freeze(['B', 'C', 'A', 'D']);

/** Coverage numbers for one metric-year. */
export function summarizeCoverage({ eligibleUniverse = null, validObservations = 0 } = {}) {
  const eligible = eligibleUniverse === null ? null : Number(eligibleUniverse);
  const valid = Number(validObservations);
  return {
    eligibleUniverse: eligible,
    validObservations: valid,
    missingObservations: eligible === null ? null : Math.max(0, eligible - valid),
  };
}

/** Rows removed by the universe rule, from either a DB row or a camelCase object. */
export function excludedByUniverseRule(stats) {
  if (!stats) return null;
  return (
    Number(stats.rows_aggregate_excluded ?? stats.rowsAggregateExcluded ?? 0) +
    Number(stats.rows_blank_iso3_skipped ?? stats.rowsBlankIso3Skipped ?? 0) +
    Number(stats.rows_unknown_country ?? stats.rowsUnknownCountry ?? 0)
  );
}

/**
 * YoY coverage for one metric and year (specification section 22).
 *
 * The YoY denominator counts only entities with valid observations in BOTH years
 * that yield a calculable percentage, so it is reported separately from the level
 * denominator: the two are equal only by coincidence.
 */
export function buildYoyCoverage(input = {}) {
  const {
    metricKey,
    year,
    eligibleUniverse = null,
    currentRows = [],
    previousRows = [],
    focusIso3 = 'IND',
  } = input;

  const pairs = buildYoyRows(currentRows, previousRows);
  const currentByIso3 = new Map(currentRows.map((row) => [row.iso3, row]));
  const previousByIso3 = new Map(previousRows.map((row) => [row.iso3, row]));
  const focusCurrent = currentByIso3.get(focusIso3) ?? null;
  const focusPrevious = previousByIso3.get(focusIso3) ?? null;
  const focusYoy = computeYoy({
    current: focusCurrent?.value ?? null,
    previous: focusPrevious?.value ?? null,
  });

  return {
    metricKey,
    year,
    previousYear: year - 1,
    eligibleUniverse,
    currentValidObservations: currentRows.length,
    previousValidObservations: previousRows.length,
    validYoyPairs: pairs.pairs,
    levelDenominator: currentRows.length,
    focus: {
      iso3: focusIso3,
      currentAvailable: Boolean(focusCurrent),
      previousAvailable: Boolean(focusPrevious),
      currentValue: focusCurrent?.value ?? null,
      previousValue: focusPrevious?.value ?? null,
      yoyCalculable: focusYoy.computable,
      yoyPercent: focusYoy.yoyPercent,
      yoyReason: focusYoy.reason,
      yoyDescription: focusYoy.description,
      inYoyRanking: pairs.rows.some((row) => row.iso3 === focusIso3),
    },
    note:
      'The YoY denominator counts only entities with a valid observation in BOTH years and a calculable percentage change. It is not the current-year level denominator unless they happen to be equal.',
  };
}

/** Difference between two values, null-safe. */
function delta(from, to) {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  return Number(to) - Number(from);
}

/**
 * The observation-coverage sentence of specification section 6 CASE A, assembled
 * only from counts that were actually observed.
 */
function observationCoverageSentence({ fromYear, toYear, fromCoverage, toCoverage }) {
  return (
    `World Bank WDI has valid observations for ${toCoverage.validObservations} eligible countries/economies for this indicator in ${toYear}; ` +
    `${toCoverage.missingObservations} eligible entities do not have a usable observation for it. ` +
    `In ${fromYear} the equivalent count was ${fromCoverage.validObservations}, with ${fromCoverage.missingObservations} eligible entities without a usable observation. ` +
    `The stored eligible metadata universe used for both observations is the same (${toCoverage.eligibleUniverse} entities).`
  );
}

/**
 * Explain why the number of ranked entities differs between two years.
 *
 * Precedence of the CASE decision (documented, and covered by tests):
 *   1. the eligible metadata universe itself changed          -> CASE B, with diff
 *   2. rows removed by aggregate/income-group filtering
 *      explain the change in the raw API rows                 -> CASE C
 *   3. eligible universe unchanged, ranking denominator
 *      changed                                                -> CASE A
 *   4. coverage differs across two retrievals whose metadata
 *      universes cannot be compared, or nothing else applies  -> CASE D
 *
 * @param {{metricKey:string, focusIso3?:string,
 *   from:{year:number, coverage:object, filtering?:object|null, runId?:number|null},
 *   to:{year:number, coverage:object, filtering?:object|null, runId?:number|null},
 *   metadataChange?:object|null}} input
 */
export function explainCoverageChange(input = {}) {
  const { metricKey, from, to, metadataChange = null, focusIso3 = 'IND' } = input;

  const fromCoverage = from?.coverage ?? summarizeCoverage({});
  const toCoverage = to?.coverage ?? summarizeCoverage({});

  const eligibleDelta = delta(fromCoverage.eligibleUniverse, toCoverage.eligibleUniverse);
  const denominatorDelta = delta(fromCoverage.validObservations, toCoverage.validObservations);
  const rawRowsFrom = from?.filtering ? Number(from.filtering.rows_received ?? 0) : null;
  const rawRowsTo = to?.filtering ? Number(to.filtering.rows_received ?? 0) : null;
  const excludedFrom = excludedByUniverseRule(from?.filtering);
  const excludedTo = excludedByUniverseRule(to?.filtering);
  const comparable = Boolean(metadataChange?.comparable);

  const facts = {
    metricKey,
    focusIso3,
    years: { from: from?.year ?? null, to: to?.year ?? null },
    eligibleUniverse: {
      from: fromCoverage.eligibleUniverse,
      to: toCoverage.eligibleUniverse,
      delta: eligibleDelta,
    },
    rankedDenominator: {
      from: fromCoverage.validObservations,
      to: toCoverage.validObservations,
      delta: denominatorDelta,
    },
    missingObservations: {
      from: fromCoverage.missingObservations,
      to: toCoverage.missingObservations,
      delta: delta(fromCoverage.missingObservations, toCoverage.missingObservations),
    },
    apiRowsReceived: {
      from: rawRowsFrom,
      to: rawRowsTo,
      delta: delta(rawRowsFrom, rawRowsTo),
    },
    rowsRemovedByUniverseRule: {
      aggregate: {
        from: from?.filtering?.rows_aggregate_excluded ?? null,
        to: to?.filtering?.rows_aggregate_excluded ?? null,
      },
      blankIso3: {
        from: from?.filtering?.rows_blank_iso3_skipped ?? null,
        to: to?.filtering?.rows_blank_iso3_skipped ?? null,
      },
      unknownCountry: {
        from: from?.filtering?.rows_unknown_country ?? null,
        to: to?.filtering?.rows_unknown_country ?? null,
      },
      total: { from: excludedFrom, to: excludedTo, delta: delta(excludedFrom, excludedTo) },
    },
    metadataUniverse: {
      comparable,
      changed: comparable ? Boolean(metadataChange?.changed) : null,
      added: metadataChange?.added ?? [],
      removed: metadataChange?.removed ?? [],
      fromRunId: metadataChange?.fromRunId ?? null,
      toRunId: metadataChange?.toRunId ?? null,
    },
  };

  const warnings = [];
  if (!comparable) {
    warnings.push(
      'No comparable stored metadata snapshot exists for both observations, so a change in the eligible metadata universe can neither be confirmed nor ruled out from the stored data.',
    );
  }

  const nothingChanged =
    eligibleDelta === 0 && denominatorDelta === 0 && facts.apiRowsReceived.delta === 0;

  if (nothingChanged) {
    return {
      case: COVERAGE_CASES.NONE,
      caseMeaning: COVERAGE_CASE_MEANINGS.NONE,
      changed: false,
      statement:
        `The number of ranked entities for this indicator is the same in ${from?.year} and ${to?.year}: ` +
        `${toCoverage.validObservations} eligible entities hold a valid observation for this indicator in both years.`,
      facts,
      warnings,
    };
  }

  const metadataUniverseChanged = comparable && Boolean(metadataChange?.changed);

  // CASE B - the metadata universe itself changed; list the actual difference.
  if (metadataUniverseChanged) {
    const added = facts.metadataUniverse.added;
    const removed = facts.metadataUniverse.removed;
    return {
      case: COVERAGE_CASES.B,
      caseMeaning: COVERAGE_CASE_MEANINGS.B,
      changed: true,
      statement:
        'The eligible World Bank country/economy metadata universe changed between these observations. ' +
        `Eligible entities added: ${added.length ? added.join(', ') : 'none'}. ` +
        `Eligible entities removed: ${removed.length ? removed.join(', ') : 'none'}.`,
      facts,
      warnings,
    };
  }

  // CASE C - the difference is accounted for by rows the universe rule removes.
  const filteringExplainsRawRows =
    facts.rowsRemovedByUniverseRule.total.delta !== null &&
    facts.rowsRemovedByUniverseRule.total.delta !== 0 &&
    facts.apiRowsReceived.delta !== null &&
    facts.apiRowsReceived.delta !== 0;

  if (filteringExplainsRawRows) {
    const lines = [
      'Aggregate entities are excluded from the ranking. The World Bank response contained a different number of rows that the universe rule removes:',
      `aggregate entities: ${facts.rowsRemovedByUniverseRule.aggregate.from} in ${from?.year} vs ${facts.rowsRemovedByUniverseRule.aggregate.to} in ${to?.year};`,
      `blank ISO3 rows (income-group aggregates): ${facts.rowsRemovedByUniverseRule.blankIso3.from} vs ${facts.rowsRemovedByUniverseRule.blankIso3.to};`,
      `ISO3 codes absent from the stored metadata: ${facts.rowsRemovedByUniverseRule.unknownCountry.from} vs ${facts.rowsRemovedByUniverseRule.unknownCountry.to}.`,
    ];
    if (denominatorDelta !== 0) {
      lines.push(
        observationCoverageSentence({
          fromYear: from?.year,
          toYear: to?.year,
          fromCoverage,
          toCoverage,
        }),
      );
    }
    return {
      case: COVERAGE_CASES.C,
      caseMeaning: COVERAGE_CASE_MEANINGS.C,
      changed: true,
      statement: lines.join(' '),
      facts,
      warnings,
    };
  }

  // CASE A - same eligible universe, different observation coverage.
  if (denominatorDelta !== 0) {
    const differentUnverifiableRetrieval =
      !comparable &&
      from?.runId !== undefined &&
      to?.runId !== undefined &&
      from?.runId !== null &&
      to?.runId !== null &&
      from.runId !== to.runId;

    if (!differentUnverifiableRetrieval) {
      return {
        case: COVERAGE_CASES.A,
        caseMeaning: COVERAGE_CASE_MEANINGS.A,
        changed: true,
        statement: observationCoverageSentence({
          fromYear: from?.year,
          toYear: to?.year,
          fromCoverage,
          toCoverage,
        }),
        facts,
        warnings,
      };
    }
  }

  // CASE D - established facts only, deliberately no inference.
  return {
    case: COVERAGE_CASES.D,
    caseMeaning: COVERAGE_CASE_MEANINGS.D,
    changed: true,
    statement:
      'The number of ranked entities differs between years. The application can establish the observed data coverage and filtering difference, but does not infer a cause beyond the World Bank data. ' +
      `Observed coverage: ${fromCoverage.validObservations} eligible entities hold a valid observation for this indicator in ${from?.year} (of ${fromCoverage.eligibleUniverse} stored eligible entities) and ${toCoverage.validObservations} in ${to?.year} (of ${toCoverage.eligibleUniverse}).`,
    facts,
    warnings,
  };
}

/**
 * Phrases that assert a cause the World Bank data does not establish. A test uses
 * this to prove the explanation engine never produces them.
 */
export const FORBIDDEN_CAUSE_PHRASES = Object.freeze([
  'did not report',
  'did not submit',
  'failed to report',
  'forgot',
  'excluded by the world bank',
  'world bank excluded',
  'only has',
  'countries in the world',
]);

/** True when generated text contains a cause the data does not establish. */
export function containsInventedCause(text) {
  const haystack = String(text ?? '').toLowerCase();
  return FORBIDDEN_CAUSE_PHRASES.some((phrase) => haystack.includes(phrase));
}

export default {
  COVERAGE_CASES,
  COVERAGE_CASE_MEANINGS,
  COVERAGE_PRECEDENCE,
  summarizeCoverage,
  excludedByUniverseRule,
  buildYoyCoverage,
  explainCoverageChange,
  containsInventedCause,
};

