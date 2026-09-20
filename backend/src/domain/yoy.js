/**
 * YEAR-OVER-YEAR ENGINE (pure functions, no I/O).
 *
 * Formula, applied independently to every one of the four metrics:
 *
 *   YoY % = ((current year raw value / previous year raw value) - 1) * 100
 *
 * Rules:
 *   - uses RAW World Bank values, never rounded display values
 *   - if the current year value is missing  -> YoY is null
 *   - if the previous year value is missing -> YoY is null
 *   - if the previous value is <= 0         -> YoY is null with a reason code
 *     (a non-positive base makes the percentage change undefined or its sign
 *      misleading, so it is reported as not calculable rather than as 0%)
 *   - an incalculable YoY is NEVER reported as 0
 *   - when both years are 0, the change is reported as 0 with an explicit
 *     reason code, because no growth can be computed from a zero base
 *
 * A reason code accompanies every null result so the UI and the audit panel can
 * state WHY the value is unavailable instead of showing a bare blank.
 */

/** Machine-readable reasons for a missing or undefined YoY value. */
export const YOY_NA_REASONS = Object.freeze({
  CURRENT_MISSING: 'current_year_value_missing',
  PREVIOUS_MISSING: 'previous_year_value_missing',
  PREVIOUS_NON_POSITIVE: 'previous_year_value_not_positive',
  BOTH_ZERO: 'both_years_zero',
  BOTH_MISSING: 'both_years_missing',
});

/** Human-readable descriptions, used by the audit panel. */
export const YOY_NA_DESCRIPTIONS = Object.freeze({
  [YOY_NA_REASONS.CURRENT_MISSING]:
    'No stored World Bank observation for the current year, so no change can be calculated.',
  [YOY_NA_REASONS.PREVIOUS_MISSING]:
    'No stored World Bank observation for the previous year, so no change can be calculated.',
  [YOY_NA_REASONS.PREVIOUS_NON_POSITIVE]:
    'The previous year value is not greater than zero, so the percentage change formula is not defined for it.',
  [YOY_NA_REASONS.BOTH_ZERO]:
    'Both years are zero, so no growth can be computed from a zero base.',
  [YOY_NA_REASONS.BOTH_MISSING]:
    'Neither year has a stored World Bank observation.',
});

/**
 * Year-over-year percentage change between two raw values.
 *
 * @param {{ current: number|null|undefined, previous: number|null|undefined }} input
 * @returns {{ yoyPercent: number|null, reason: string|null, description: string|null, computable: boolean }}
 */
export function computeYoy({ current, previous }) {
  const curMissing = current === null || current === undefined;
  const prevMissing = previous === null || previous === undefined;

  const notAvailable = (reason) => ({
    yoyPercent: null,
    reason,
    description: YOY_NA_DESCRIPTIONS[reason] ?? null,
    computable: false,
  });

  if (curMissing && prevMissing) return notAvailable(YOY_NA_REASONS.BOTH_MISSING);
  if (prevMissing) return notAvailable(YOY_NA_REASONS.PREVIOUS_MISSING);
  if (curMissing) return notAvailable(YOY_NA_REASONS.CURRENT_MISSING);

  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) {
    return notAvailable(YOY_NA_REASONS.CURRENT_MISSING);
  }

  if (prev === 0) {
    if (cur === 0) {
      // Both zero: the change is zero, but no growth rate exists.
      return {
        yoyPercent: 0,
        reason: YOY_NA_REASONS.BOTH_ZERO,
        description: YOY_NA_DESCRIPTIONS[YOY_NA_REASONS.BOTH_ZERO],
        computable: false,
      };
    }
    return notAvailable(YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);
  }

  if (prev < 0) return notAvailable(YOY_NA_REASONS.PREVIOUS_NON_POSITIVE);

  return {
    yoyPercent: ((cur / prev) - 1) * 100,
    reason: null,
    description: null,
    computable: true,
  };
}

/**
 * Convenience wrapper for a series of values indexed by year.
 *
 * @param {Map<number, number>|Record<string, number>} yearToValue
 * @param {number} year
 */
export function computeYoyFromMap(yearToValue, year) {
  const get = (y) => {
    if (yearToValue instanceof Map) {
      const v = yearToValue.get(y);
      return v === undefined ? null : v;
    }
    const v = yearToValue?.[String(y)];
    return v === undefined ? null : v;
  };
  return computeYoy({ current: get(year), previous: get(year - 1) });
}

/**
 * Build the complete YoY series for one country and one metric.
 *
 * @param {{ year: number, value: number }[]} observations ascending by year
 * @param {number} startYear inclusive
 * @param {number} endYear inclusive
 */
export function buildYoySeries(observations, startYear, endYear) {
  const byYear = new Map();
  for (const obs of observations ?? []) {
    byYear.set(Number(obs.year), Number(obs.value));
  }

  const series = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const current = byYear.has(year) ? byYear.get(year) : null;
    const previous = byYear.has(year - 1) ? byYear.get(year - 1) : null;
    const yoy = computeYoy({ current, previous });
    series.push({
      year,
      value: current,
      previousValue: previous,
      yoyPercent: yoy.yoyPercent,
      reason: yoy.reason,
      description: yoy.description,
      computable: yoy.computable,
    });
  }
  return series;
}

export default { computeYoy, computeYoyFromMap, buildYoySeries, YOY_NA_REASONS };