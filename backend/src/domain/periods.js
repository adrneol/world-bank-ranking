/**
 * SEMANTIC OPERATION IDENTITY (Phase 7C-1) — pure vocabulary, no I/O.
 *
 * Generic labels like PERCENT hide different economic operations. These
 * codes name the operation so methodology and provenance can distinguish
 * an annual endpoint comparison from a period-total comparison from a
 * period-average comparison. The underlying arithmetic reuses the generic
 * primitives in domain/transforms.js — the distinction is semantic, not
 * separate math engines.
 *
 * Computation lives in transforms.js (PERIOD_SUM / PERIOD_AVG /
 * PERIOD_SUM_PERCENT_CHANGE, gated by registry periodAggregation); the
 * authoritative half-open interval rule lives there beside them as
 * periodYears(). This module holds the naming layer both reference.
 */
export const SEMANTIC_OPERATIONS = Object.freeze({
  ANNUAL_YOY: 'ANNUAL_YOY',
  ANNUAL_ENDPOINT_PERCENT_CHANGE: 'ANNUAL_ENDPOINT_PERCENT_CHANGE',
  PERIOD_SUM: 'PERIOD_SUM',
  PERIOD_SUM_PERCENT_CHANGE: 'PERIOD_SUM_PERCENT_CHANGE',
  PERIOD_AVERAGE: 'PERIOD_AVERAGE',
  RATE_PP_CHANGE: 'RATE_PP_CHANGE',
  INDEX_POINT_CHANGE: 'INDEX_POINT_CHANGE',
  INDEX_CUMULATIVE_PERCENT_CHANGE: 'INDEX_CUMULATIVE_PERCENT_CHANGE',
  FX_PERCENT_MOVEMENT: 'FX_PERCENT_MOVEMENT',
  CAGR: 'CAGR',
});

/** Human labels and formulas for each semantic operation. */
export const SEMANTIC_OPERATION_INFO = Object.freeze({
  [SEMANTIC_OPERATIONS.ANNUAL_YOY]: Object.freeze({
    label: 'Annual YoY change',
    formula: '((current / previous) - 1) * 100',
    note: 'Valid only for consecutive years (current vs immediately previous year).',
  }),
  [SEMANTIC_OPERATIONS.ANNUAL_ENDPOINT_PERCENT_CHANGE]: Object.freeze({
    label: 'Annual endpoint percent change',
    formula: '((B / A) - 1) * 100',
    note: 'Compares the annual observation in year B with year A; interiors ignored.',
  }),
  [SEMANTIC_OPERATIONS.PERIOD_SUM]: Object.freeze({
    label: 'Period flow total',
    formula: 'sum(values[A..B-1])',
    note: 'Half-open [A, B); every required year must be present.',
  }),
  [SEMANTIC_OPERATIONS.PERIOD_SUM_PERCENT_CHANGE]: Object.freeze({
    label: 'Period-total percent change',
    formula: '((sumB / sumA) - 1) * 100',
    note: 'Compares two period totals; same base/sign rules as ordinary percent change.',
  }),
  [SEMANTIC_OPERATIONS.PERIOD_AVERAGE]: Object.freeze({
    label: 'Period average annual flow',
    formula: 'sum(values[A..B-1]) / N',
    note: 'Typical annual scale over the period; same completeness rule as the sum.',
  }),
  [SEMANTIC_OPERATIONS.RATE_PP_CHANGE]: Object.freeze({
    label: 'Rate change in percentage points',
    formula: 'B - A (percentage points)',
    note: 'Default change statistic for RATE/RATIO measures.',
  }),
  [SEMANTIC_OPERATIONS.INDEX_POINT_CHANGE]: Object.freeze({
    label: 'Index-point change',
    formula: 'B - A (index points)',
    note: 'Within-entity index movement; never percentage points.',
  }),
  [SEMANTIC_OPERATIONS.INDEX_CUMULATIVE_PERCENT_CHANGE]: Object.freeze({
    label: 'Cumulative index percent change',
    formula: '((B / A) - 1) * 100',
    note: 'Cumulative price-level effect on an index; never GDP/YoY/inflation-rate growth.',
  }),
  [SEMANTIC_OPERATIONS.FX_PERCENT_MOVEMENT]: Object.freeze({
    label: 'FX percent movement',
    formula: '((B / A) - 1) * 100',
    note: 'Quoted-rate movement; increase means depreciation under LCU_PER_USD.',
  }),
  [SEMANTIC_OPERATIONS.CAGR]: Object.freeze({
    label: 'Compound annual growth rate',
    formula: '((B / A) ^ (1 / years) - 1) * 100',
    note: 'Annualized endpoint change; levels/flows only, never rates/ratios/FX.',
  }),
});

export default { SEMANTIC_OPERATIONS, SEMANTIC_OPERATION_INFO };
