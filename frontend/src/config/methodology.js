/**
 * Methodology documentation tree.
 *
 * Data-driven documentation of the CURRENT analytical engine — never a
 * second implementation of it. The hierarchy (family → metric → basis) is
 * built at runtime from the backend `/api/indicators` payload, which is the
 * same registry the application itself runs on:
 *   - families = backend subjects (fail-closed: unknown subjects rejected),
 *   - metrics = production registry entries (key/label/unit/indicatorCode),
 *   - bases = the per-metric canonical basis catalogs the backend exposes
 *     (`pricesBases`, `tradeBases`, … with id/label/description/formula/
 *     unit/rankable/rankDirection/rankWording/requiresSequence).
 *
 * GDP families expose no per-metric basis catalog, so their four generic
 * movement modes (level/growth/period_total/period_average) are derived
 * from each metric's OWN capability declarations (`validChangeTypes`,
 * `periodAggregation`) — availability can never show an unsupported mode.
 * Their wording documents backend-declared operations (ranking direction,
 * YoY formula, SUM/AVG period operations), never invented economics.
 *
 * Nothing here calculates: values pass through for display only.
 */

export const GDP_BASIS_IDS = Object.freeze(['level', 'growth', 'period_total', 'period_average']);

/** Source trace per family: methodology files + methodologyBlock paragraph. */
export const FAMILY_SOURCES = Object.freeze({
  gdp_per_capita: Object.freeze({
    files: Object.freeze(['backend ranking engine (level ranking)', 'backend yoy.js (YoY formula)', 'backend periods.js (SUM/AVG period operations)']),
    block: 'levelRanking',
  }),
  gdp_total: Object.freeze({
    files: Object.freeze(['backend ranking engine (level ranking)', 'backend yoy.js (YoY formula)', 'backend periods.js (SUM/AVG period operations)']),
    block: 'levelRanking',
  }),
  prices: Object.freeze({
    files: Object.freeze(['prices/method-cpiindex.txt', 'prices/cpiInflationmethodology.txt', 'prices/gdpDeflator.txt']),
    block: 'pricesMovement',
  }),
  trade: Object.freeze({
    files: Object.freeze(['trade/tademethod.txt']),
    block: 'tradeMovement',
  }),
  capital_flows: Object.freeze({
    files: Object.freeze(['capitalflow/capitalflowmethod.txt']),
    block: 'capitalMovement',
  }),
  exchange: Object.freeze({
    files: Object.freeze(['ExchangeRate/exchangerate.txt']),
    block: 'fxMovement',
  }),
  external: Object.freeze({
    files: Object.freeze(['ExternalSector/externalsector.txt']),
    block: 'externalMovement',
  }),
  population: Object.freeze({
    files: Object.freeze(['population/pop.txt']),
    block: 'populationMovement',
  }),
});

const BASIS_CATALOG_KEYS = Object.freeze([
  'pricesBases',
  'tradeBases',
  'capitalBases',
  'fxBases',
  'externalBases',
  'populationBases',
]);

function catalogBases(metric) {
  if (!metric || typeof metric !== 'object') return null;
  for (const key of BASIS_CATALOG_KEYS) {
    if (Array.isArray(metric[key]) && metric[key].length > 0) return metric[key];
  }
  return null;
}

/**
 * Generic GDP movement modes derived from a metric's own capability
 * declarations. Level is always available; growth requires declared YOY;
 * period modes require declared SUM/AVG aggregation.
 *
 * Formula states (methodology display contract — documentation only):
 * growth/period modes carry the exact operation strings declared in
 * backend periods.js; level carries no equation (category B: it IS the
 * stored observation), so `formulaAbsent` explains that explicitly instead
 * of leaving a blank formula box.
 */
export function gdpBasesForMetric(metric) {
  const declared = Array.isArray(metric?.validChangeTypes) ? metric.validChangeTypes : [];
  const period = Array.isArray(metric?.periodAggregation) ? metric.periodAggregation : [];
  const direction = metric?.rankingDirection ?? 'DESC';
  const rankNote =
    direction === 'ASC'
      ? 'Lower values rank first (registry direction ASC).'
      : direction === 'NEUTRAL'
        ? 'Not ranked across entities (registry direction NEUTRAL).'
        : 'Higher values rank first (registry direction DESC).';
  const bases = [
    {
      id: 'level',
      label: 'Level (stored value)',
      description: 'Stored World Bank observation for the selected year; no transformation.',
      formula: null,
      formulaAbsent: 'No separate formula — this basis uses the stored World Bank observation.',
      rankable: direction !== 'NEUTRAL',
      rankDirection: direction,
      rankWording: rankNote,
      requiresSequence: false,
    },
  ];
  if (declared.includes('YOY')) {
    bases.push({
      id: 'growth',
      label: 'Growth (YoY / period endpoint change)',
      description:
        'Consecutive years use the annual YoY formula; longer spans use the period endpoint percent change.',
      formula: 'YoY: ((current / previous) - 1) * 100; longer spans: ((B / A) - 1) * 100',
      rankable: true,
      rankDirection: 'DESC',
      rankWording: 'Orders economies by percentage change, not level.',
      requiresSequence: false,
    });
  }
  if (period.includes('SUM')) {
    bases.push({
      id: 'period_total',
      label: 'Period total (SUM)',
      description: 'Backend SUM period operation over the selected year span (flow semantics only).',
      formula: 'sum(values[A..B-1])',
      rankable: true,
      rankDirection: direction,
      rankWording: rankNote,
      requiresSequence: true,
    });
  }
  if (period.includes('AVG')) {
    bases.push({
      id: 'period_average',
      label: 'Period average (AVG)',
      description: 'Backend AVG period operation over the selected year span (flow semantics only).',
      formula: 'sum(values[A..B-1]) / N',
      rankable: true,
      rankDirection: direction,
      rankWording: rankNote,
      requiresSequence: true,
    });
  }
  return bases;
}

/** Bases for one metric: backend catalog when present, GDP-generic otherwise. */
export function basesForMethodMetric(familyKey, metric) {
  return catalogBases(metric) ?? (familyKey === 'gdp_per_capita' || familyKey === 'gdp_total' ? gdpBasesForMetric(metric) : []);
}

function cleanMetric(entry) {
  if (!entry || typeof entry.key !== 'string' || typeof entry.subject !== 'string') return null;
  return {
    key: entry.key,
    subject: entry.subject,
    label: entry.label ?? entry.key,
    shortLabel: entry.shortLabel ?? entry.label ?? entry.key,
    unit: entry.unit ?? '',
    unitLong: entry.unitLong ?? entry.unit ?? '',
    indicatorCode: entry.indicatorCode ?? '',
    rankingDirection: entry.rankingDirection ?? null,
    observationType: entry.observationType ?? null,
    validChangeTypes: Array.isArray(entry.validChangeTypes) ? [...entry.validChangeTypes] : [],
    periodAggregation: Array.isArray(entry.periodAggregation) ? [...entry.periodAggregation] : [],
  };
}

/**
 * Build the documentation tree from a GET /api/indicators payload.
 * Returns null on anything malformed (fail-closed: the page shows an
 * unavailable state, never a half-invented tree).
 */
export function buildMethodologyTree(payload) {
  try {
    const production = payload?.production;
    const subjects = payload?.subjects;
    const methodology = payload?.methodology ?? null;
    if (!Array.isArray(production) || production.length === 0) return null;
    if (!Array.isArray(subjects) || subjects.length === 0) return null;
    const metricsBySubject = new Map();
    for (const entry of production) {
      const metric = cleanMetric(entry);
      if (!metric) return null;
      if (!metricsBySubject.has(metric.subject)) metricsBySubject.set(metric.subject, []);
      metricsBySubject.get(metric.subject).push({ ...metric, bases: basesForMethodMetric(metric.subject, entry) });
    }
    const families = [];
    for (const subject of subjects) {
      if (!subject || typeof subject.key !== 'string') return null;
      const metrics = metricsBySubject.get(subject.key) ?? [];
      if (metrics.length === 0) continue;
      families.push({
        key: subject.key,
        label: subject.label ?? subject.key,
        metrics,
        sources: FAMILY_SOURCES[subject.key] ?? { files: [], block: null },
      });
    }
    if (families.length === 0) return null;
    return { families, methodology };
  } catch {
    return null;
  }
}

export default { buildMethodologyTree, basesForMethodMetric, gdpBasesForMetric, FAMILY_SOURCES, GDP_BASIS_IDS };
