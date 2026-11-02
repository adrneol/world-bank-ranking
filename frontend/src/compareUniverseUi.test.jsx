/**
 * COMPARE UI — MODE, UNIVERSE AND DIAGNOSTIC TESTS.
 *
 * The Compare tab must render the results of the SELECTED mode only, show
 * the like-for-like universe with its exclusion ledger, label a partial
 * observed subtotal as partial, and never present a blocked comparison as a
 * success. These tests drive the real component with stubbed API responses.
 */

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import Compare from './sections/Compare.jsx';
import EntityPicker from './components/EntityPicker.jsx';
import { flushReact, setInputValue, stubFetch } from './test-utils.js';
import { compareAnalysisOptions, compareMethodOptions, compareOperationForMovementBasis, hydrateRegistry, METRICS, SUBJECTS, metricKeysForSubject, movementBasisOptions } from './config/metrics.js';

const DEFAULT_REGISTRY = {
  subjects: Object.values(SUBJECTS).map(({ key, label }) => ({ key, label })),
  production: Object.values(METRICS).map((metric) => ({
    ...metric,
    label: metric.title,
    shortLabel: metric.shortTitle,
    observationType: metric.subject === 'gdp_total' ? 'FLOW' : 'LEVEL',
    validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
    periodAggregation: metric.subject === 'gdp_total' ? ['SUM', 'AVG'] : [],
    comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', ...(metric.aggregation === 'SUM' ? ['CUSTOM_GROUP'] : [])],
    rankingDirection: 'DESC',
  })),
};

const YEARS = [2004, 2005, 2006];

const COUNTRIES = {
  countries: [
    { iso3: 'IND', name: 'India' },
    { iso3: 'CHN', name: 'China' },
    { iso3: 'USA', name: 'United States' },
  ],
};

const METRIC = {
  key: 'total_current',
  label: 'Total GDP — Nominal — Current US$',
  unit: 'current US$',
  unitLong: 'current US$',
  indicatorCode: 'NY.GDP.MKTP.CD',
  displayDecimals: 2,
};

const PRICES_REGISTRY = {
  subjects: [
    { key: 'gdp_total', label: 'Total GDP' },
    { key: 'prices', label: 'Prices' },
  ],
  production: [
    {
      key: 'total_current', subject: 'gdp_total', label: 'Total GDP — current US$', shortLabel: 'Total GDP — current US$',
      unit: 'current US$', indicatorCode: 'NY.GDP.MKTP.CD', observationType: 'FLOW', aggregation: 'SUM',
      validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'], periodAggregation: ['SUM', 'AVG'],
      comparisonCapability: ['COUNTRY', 'CUSTOM_GROUP'], rankingDirection: 'DESC',
    },
    ...[
      ['inflation_cpi', 'CPI inflation', 'RATE', ['ABSOLUTE', 'PERCENT', 'PP', 'CAGR']],
      ['inflation_cpi_index', 'CPI index', 'INDEX', ['ABSOLUTE', 'PERCENT', 'INDEX_POINT', 'CAGR']],
      ['inflation_deflator', 'GDP-deflator inflation', 'RATE', ['ABSOLUTE', 'PERCENT', 'PP', 'CAGR']],
    ].map(([key, label, observationType, validChangeTypes]) => ({
      key, subject: 'prices', label, shortLabel: label, unit: observationType === 'INDEX' ? 'index' : 'annual %',
      indicatorCode: key, observationType, validChangeTypes, periodAggregation: [],
      comparisonCapability: ['COUNTRY'], rankingDirection: 'DESC',
    })),
  ],
};

/** A comparison payload whose group subtotal at 2005 is PARTIAL. */
function payload({ mode = 'observed', partial = true, blocked = false } = {}) {
  const groupObserved = {
    2004: {
      value: 1955e9 + 257e9,
      valueRaw: '2212',
      members: 2,
      complete: !partial,
      missingCount: partial ? 1 : 0,
      missingIso3: partial ? ['IDN'] : [],
      requiredYears: [2004, 2005],
      partialReason: partial ? 'missing_member_observations' : null,
      provenance: 'APP_DERIVED',
      derivation: { operation: 'GROUP_SUM', formula: 'sum(members)', metricKey: 'total_current' },
    },
    2005: {
      value: partial ? 2286e9 : 2286e9 + 280e9,
      valueRaw: '2286',
      members: partial ? 1 : 2,
      complete: !partial,
      missingCount: partial ? 1 : 0,
      missingIso3: partial ? ['IDN'] : [],
      requiredYears: [2004, 2005],
      partialReason: partial ? 'missing_member_observations' : null,
      provenance: 'APP_DERIVED',
      derivation: { operation: 'GROUP_SUM', formula: 'sum(members)', metricKey: 'total_current' },
    },
  };
  return {
    available: true,
    reason: null,
    metric: METRIC,
    years: { a: 2004, b: 2005, c: null },
    operation: 'absolute_change',
    groupMode: mode,
    mode,
    analysis: {
      id: 'absolute_change',
      label: 'Absolute change',
      requiredObservationYears: [2004, 2005],
      seriesYears: [2004, 2005],
      ignoredPeriods: [],
      boundary: { start: 2004, end: 2005, inclusiveStart: true, inclusiveEnd: true, kind: 'observation_years' },
    },
    entities: {
      a: { kind: 'country', iso3: 'IND', name: 'India' },
      b: { kind: 'custom_group', label: 'Big two', members: ['CHN', 'IDN'] },
    },
    capability: { allowed: true, reason: null },
    universe: {
      mode,
      requiredObservationYears: [2004, 2005],
      candidates: ['CHN', 'IDN', 'IND', 'USA'],
      candidateCount: 4,
      complete: ['CHN', 'IND', 'USA'],
      completeCount: 3,
      included: ['USA'],
      includedCount: 1,
      membershipHash: 'fnv1a32:0a1b2c3d',
      excluded: {
        participants: [
          { iso3: 'CHN', role: 'group_member', inCompleteSet: true },
          { iso3: 'IDN', role: 'group_member', inCompleteSet: false },
          { iso3: 'IND', role: 'entity', inCompleteSet: true },
        ],
        incomplete: [{ iso3: 'IDN', missingYears: [2005], missingCount: 1 }],
        distinct: [
          { iso3: 'CHN', reasons: ['comparison_participant'], missingYears: [] },
          { iso3: 'IDN', reasons: ['comparison_participant', 'missing_required_observation'], missingYears: [2005] },
          { iso3: 'IND', reasons: ['comparison_participant'], missingYears: [] },
        ],
      },
      counts: {
        candidates: 4,
        complete: 3,
        reference: 1,
        excludedDistinct: 3,
        excludedParticipants: 3,
        excludedIncomplete: 1,
        missingObservations: 1,
      },
      missingObservations: [{ iso3: 'IDN', year: 2005 }],
    },
    results: {
      a: {
        kind: 'country',
        iso3: 'IND',
        name: 'India',
        observed: {
          2004: { available: true, reason: null, value: 721e9, valueRaw: '721', provenance: 'RAW', complete: true },
          2005: { available: true, reason: null, value: 834e9, valueRaw: '834', provenance: 'RAW', complete: true },
        },
        likeForLike: {
          2004: { available: true, reason: null, value: 721e9, valueRaw: '721', provenance: 'RAW', complete: true },
          2005: { available: true, reason: null, value: 834e9, valueRaw: '834', provenance: 'RAW', complete: true },
        },
        coverageBasis: { observed: 'ENTITY_OWN_OBSERVATION', like_for_like: 'ENTITY_OWN_OBSERVATION', usedMembers: ['IND'], usedMemberCount: 1 },
        series: {
          basis: 'ENTITY_OWN_OBSERVATION',
          points: [
            { year: 2004, value: 721e9, complete: true },
            { year: 2005, value: 834e9, complete: true },
          ],
          partialYears: [],
        },
      },
      b: {
        kind: 'custom_group',
        label: 'Big two',
        members: ['CHN', 'IDN'],
        memberNames: { CHN: 'China', IDN: 'Indonesia' },
        source: 'USER_DEFINED',
        observed: groupObserved,
        likeForLike: {
          2004: { value: 1955e9, valueRaw: '1955', members: 1, complete: true, missingCount: 1, missingIso3: ['IDN'], requiredYears: [2004, 2005], partialReason: null, provenance: 'APP_DERIVED' },
          2005: { value: 2286e9, valueRaw: '2286', members: 1, complete: true, missingCount: 1, missingIso3: ['IDN'], requiredYears: [2004, 2005], partialReason: null, provenance: 'APP_DERIVED' },
        },
        coverage: { '2004': { valid: ['CHN', 'IDN'], missing: [], validCount: 2, missingCount: 0 }, '2005': { valid: ['CHN'], missing: ['IDN'], validCount: 1, missingCount: 1 }, common: ['CHN'], commonCount: 1 },
        coverageBasis: { observed: 'COMMON_UNIVERSE', like_for_like: 'COMMON_UNIVERSE', usedMembers: ['CHN'], usedMemberCount: 1 },
        series: {
          basis: 'COMMON_UNIVERSE',
          points: [
            { year: 2004, value: 1955e9 + 257e9, complete: true },
            { year: 2005, value: null, complete: false },
          ],
          partialYears: [2005],
        },
      },
      comparison: {
        available: !blocked,
        reason: blocked ? 'COVERAGE_INCOMPLETE' : null,
        detail: blocked ? 'The change comparison is not publishable under the selected methodology.' : null,
        scope: blocked ? 'comparison' : 'none',
        a: { computable: true, value: 113e9, unit: 'current US$' },
        b: blocked
          ? { computable: false, value: null, reason: 'COVERAGE_INCOMPLETE', unit: 'current US$' }
          : { computable: true, value: 61e9, unit: 'current US$' },
        gap: blocked
          ? { value: null, reason: 'COVERAGE_INCOMPLETE', unit: 'current US$' }
          : { value: 52e9, reason: null, unit: 'current US$' },
        intervalResults: [{
          id: 'AB', label: 'A → B', start: 2004, end: 2005, kind: 'change',
          formula: 'B − A', unit: 'current US$', gapUnit: 'current US$', available: !blocked,
          observations: {
            a: [
              { year: 2004, value: 721e9, unit: 'current US$', available: true, complete: true },
              { year: 2005, value: 834e9, unit: 'current US$', available: true, complete: true },
            ],
            b: [
              { year: 2004, value: mode === 'like_for_like' ? 1955e9 : groupObserved[2004].value, unit: 'current US$', available: true, complete: mode === 'like_for_like' || !partial, missingCount: partial && mode === 'observed' ? 1 : 0, missingIso3: partial && mode === 'observed' ? ['IDN'] : [] },
              { year: 2005, value: mode === 'like_for_like' ? 2286e9 : groupObserved[2005].value, unit: 'current US$', available: true, complete: mode === 'like_for_like' || !partial, missingCount: partial && mode === 'observed' ? 1 : 0, missingIso3: partial && mode === 'observed' ? ['IDN'] : [] },
            ],
          },
          a: { computable: true, value: 113e9, unit: 'current US$' },
          b: blocked || (partial && mode === 'observed') ? { computable: false, value: null, reason: 'COVERAGE_INCOMPLETE', unit: 'current US$' } : { computable: true, value: 61e9, unit: 'current US$' },
          gap: blocked || (partial && mode === 'observed') ? { value: null, reason: 'COVERAGE_INCOMPLETE', unit: 'current US$' } : { value: 52e9, reason: null, unit: 'current US$' },
        }],
        unit: 'current US$',
      },
    },
    diagnostics: blocked
      ? [
          {
            code: 'COVERAGE_INCOMPLETE',
            scope: 'entity_b',
            entity: 'Big two',
            metric: 'total_current',
            indicatorCode: 'NY.GDP.MKTP.CD',
            years: [2005],
            detail: 'The change depends on a partial coverage value.',
            blocksOverall: true,
          },
        ]
      : [],
    vintage: { coherent: true, lastUpdatedValues: ['2026-07-13'], warning: null },
    source: {},
  };
}

function renderCompare(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const noop = () => {};
  const operation = props.operation ?? 'absolute_change';
  const basisId = props.basisId ?? (operation === 'level' ? 'level' : `compare:${operation}`);
  act(() => {
    root.render(
      <Compare
        availableYears={YEARS}
        countries={COUNTRIES.countries}
        entityA="country:IND"
        entityB="group:CHN,IDN"
        labelA=""
        labelB="Big two"
        analysis="gdp_total"
        metricKey="total_current"
        basisId={basisId}
        yearA={2004}
        yearB={2005}
        yearC={null}
        operation={operation}
        groupMode="observed"
        onEntityA={noop}
        onEntityB={noop}
        onLabelA={noop}
        onLabelB={noop}
        onMetric={noop}
        onYearA={noop}
        onYearB={noop}
        onYearC={noop}
        onOperation={noop}
        onGroupMode={noop}
        {...props}
      />,
    );
  });
  return {
    container,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('compare UI: observed and like-for-like', () => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup?.();
    ctx = null;
    document.body.innerHTML = '';
    hydrateRegistry(DEFAULT_REGISTRY);
  });

  it('renders Analysis → Metric → Basis → Comparison mode and all three year controls', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed', partial: false })],
    ]);
    const view = renderCompare({ operation: 'level', yearA: 2004, yearB: null, yearC: null });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    for (const id of ['cmp-analysis', 'cmp-metric', 'cmp-basis', 'cmp-year-a', 'cmp-year-b', 'cmp-year-c']) {
      expect(view.container.querySelector(`#${id}`), `${id} remains visible for Level`).toBeTruthy();
    }
    const selectorIds = [...view.container.querySelector('.compare-param-row').querySelectorAll('[id^="cmp-"]')]
      .map((node) => node.id)
      .filter((id) => ['cmp-analysis', 'cmp-metric', 'cmp-basis'].includes(id));
    expect(selectorIds).toEqual(['cmp-analysis', 'cmp-metric', 'cmp-basis']);
    expect(view.container.textContent).toContain('Metric');
    expect(view.container.textContent).toContain('Basis');
    expect(view.container.textContent).toContain('Analysis');
    expect(view.container.textContent).toContain('Comparison mode');
    expect(view.container.textContent).toContain('Middle year (optional)');
    expect(view.container.textContent).toContain('Year C (later) (optional)');
    expect(view.container.textContent).not.toContain('Group value mode');
    expect(view.container.textContent).not.toContain('Focus country');
    expect(view.container.querySelector('#mv-country')).toBeNull();
  });

  it('offers GDP measurement variants as Metrics and Movement methods as Bases', async () => {
    hydrateRegistry({
      subjects: [{ key: 'gdp_total', label: 'Total GDP' }],
      production: [
        ['total_current', 'current', 'USD', null, 'current US$'],
        ['total_constant', 'constant', 'USD', 2015, 'constant 2015 US$'],
        ['total_ppp_current', 'current', 'INTERNATIONAL_DOLLAR', null, 'current international $'],
        ['total_ppp_constant', 'constant', 'INTERNATIONAL_DOLLAR', 2021, 'constant 2021 international $'],
      ].map(([key, priceBasis, currencyBasis, baseYear, unit]) => ({
        key,
        subject: 'gdp_total',
        label: key,
        shortLabel: key,
        unit,
        indicatorCode: key,
        priceBasis,
        currencyBasis,
        baseYear,
        aggregation: 'SUM',
        observationType: 'FLOW',
        validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'],
        periodAggregation: ['SUM', 'AVG'],
        comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP'],
        rankingDirection: 'DESC',
      })),
    });
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed', partial: false })],
    ]);
    const view = renderCompare({ analysis: 'gdp_total', metricKey: 'total_current', basisId: 'level', operation: 'level', yearA: 2004, yearB: null, yearC: null });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    act(() => view.container.querySelector('#cmp-metric').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushReact(act);
    const metricOptions = [...document.querySelectorAll('.combo-option')].map((node) => node.textContent);
    for (const key of ['total_current', 'total_constant', 'total_ppp_current', 'total_ppp_constant']) {
      expect(metricOptions.some((label) => label.startsWith(key))).toBe(true);
    }

    act(() => view.container.querySelector('#cmp-metric').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushReact(act);
    act(() => view.container.querySelector('#cmp-basis').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushReact(act);
    const options = [...document.querySelectorAll('.combo-option')].map((node) => node.textContent);
    expect(options.some((label) => label.includes('Total GDP level (value)'))).toBe(true);
    expect(options.some((label) => label.includes('Annual flow (endpoint B vs A)'))).toBe(true);
    expect(options).not.toContain('total_constant');
  });

  it('filters Analysis through Movement methods and backend entity applicability', () => {
    hydrateRegistry({
      subjects: [{ key: 'gdp_total', label: 'Total GDP' }],
      production: [{
        key: 'total_current', subject: 'gdp_total', label: 'Total GDP — current US$', unit: 'current US$',
        indicatorCode: 'NY.GDP.MKTP.CD', observationType: 'FLOW', aggregation: 'SUM',
        validChangeTypes: ['ABSOLUTE', 'PERCENT', 'YOY', 'CAGR'], periodAggregation: ['SUM', 'AVG'],
        comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP'], rankingDirection: 'DESC',
      }],
    });
    const options = compareAnalysisOptions('total_current', { kind: 'country', iso3: 'IND' }, { kind: 'country', iso3: 'CHN' }, 2004, 2005);
    const values = options.map((option) => option.value);
    expect(values).toContain('level');
    expect(values).toContain('percent_change');
    expect(values).toContain('absolute_change');
    expect(values).toContain('period_total');
    expect(values).toContain('period_average');
    expect(values).not.toContain('pp_change');
    expect(values).not.toContain('index_point_change');
    expect(options.every((option) => option.disabled !== true && !option.disabledReason)).toBe(true);
  });

  it('maps Movement flow and inflation bases to their period-specific Compare calculations', () => {
    hydrateRegistry({
      subjects: [
        { key: 'trade', label: 'Trade' }, { key: 'prices', label: 'Prices' },
        { key: 'capital_flows', label: 'Capital flows' }, { key: 'external', label: 'External sector' },
      ],
      production: [
        ['exports_current', 'trade', 'SUM', ['SUM', 'AVG']],
        ['inflation_cpi', 'prices', 'OFFICIAL_ONLY', []],
        ['fdi_inflows', 'capital_flows', 'SUM', ['SUM', 'AVG']],
        ['fdi_inflows_pct_gdp', 'capital_flows', 'WEIGHTED_RATIO', []],
        ['remittances_received', 'external', 'SUM', ['SUM', 'AVG']],
      ].map(([key, subject, aggregation, periodAggregation]) => ({
        key, subject, label: key, indicatorCode: `TEST.${key}`, unit: key === 'inflation_cpi' ? 'annual %' : 'current US$',
        observationType: key === 'inflation_cpi' ? 'RATE' : key === 'fdi_inflows_pct_gdp' ? 'RATIO' : 'FLOW',
        aggregation, periodAggregation, validChangeTypes: ['ABSOLUTE', 'PERCENT', 'PP', 'YOY', 'CAGR'],
        comparisonCapability: ['COUNTRY', 'OFFICIAL_AGGREGATE', 'CUSTOM_GROUP'], rankingDirection: 'DESC',
      })),
    });
    const a = { kind: 'country', iso3: 'IND' };
    const b = { kind: 'country', iso3: 'CHN' };
    const mapped = (metric, start = 2004, end = 2006) => compareAnalysisOptions(metric, a, b, start, end).map(({ value, label }) => ({ value, label }));
    expect(mapped('exports_current')).toEqual(expect.arrayContaining([
      { value: 'movement_period_total', label: 'Period total export flow' },
      { value: 'movement_period_average', label: 'Period average annual export flow' },
    ]));
    expect(mapped('inflation_cpi')).toEqual(expect.arrayContaining([
      { value: 'movement_period_average', label: 'Average annual CPI inflation (%)' },
      { value: 'movement_inflation_cumulative', label: 'Cumulative CPI inflation (%)' },
    ]));
    expect(mapped('fdi_inflows')).toEqual(expect.arrayContaining([
      { value: 'movement_period_total', label: 'Cumulative net FDI' },
      { value: 'movement_period_average', label: 'Average annual net FDI' },
    ]));
    expect(mapped('fdi_inflows_pct_gdp')).toEqual(expect.arrayContaining([
      { value: 'movement_period_average', label: 'Average annual FDI (% of GDP)' },
    ]));
    expect(mapped('remittances_received')).toEqual(expect.arrayContaining([
      { value: 'movement_period_total', label: 'Cumulative Remittances Received' },
      { value: 'movement_period_average', label: 'Average Annual Remittances' },
    ]));
    expect(compareAnalysisOptions('fx_official', a, b, 2004, 2005).map(({ label }) => label)).toContain('Annual Nominal FX Change');
    expect(compareAnalysisOptions('fx_official', a, b, 2004, 2006).map(({ label }) => label)).not.toContain('Annual Nominal FX Change');
  });

  it('renders the selected mode only and asks the backend for that mode', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/groups/evaluate', { valid: true, type: 'custom_group', members: [], memberCount: 0 }],
      [
        '/api/compare',
        (href) => ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => (href.includes('groupMode=like_for_like') ? payload({ mode: 'like_for_like' }) : payload({ mode: 'observed' })),
        }),
      ],
    ]);
    const view = renderCompare({ groupMode: 'like_for_like' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    const call = stub.calls.find((href) => href.includes('/api/compare'));
    expect(call).toBeTruthy();
    expect(call).toContain('groupMode=like_for_like');
    expect(call).toContain('basis=total_current');
    // The like-for-like universe is presented, with its counts.
    expect(view.container.textContent).toContain('Common universe');
    expect(view.container.textContent).toContain('candidate countries');
    expect(view.container.textContent).toContain('fnv1a32:0a1b2c3d');
    // The exclusion ledger is behind a disclosure, not in the default view.
    const ledger = view.container.querySelector('.universe-details');
    expect(ledger).toBeTruthy();
    expect(ledger.textContent).toContain('Exclusion ledger (3 countries)');
  });

  it('labels a partial observed subtotal as partial and blocks the dependent result', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed', partial: true, blocked: true })],
    ]);
    const view = renderCompare({ groupMode: 'observed' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    // The partial subtotal is unmistakably labelled.
    expect(view.container.textContent).toContain('Partial coverage');
    expect(view.container.textContent).toContain('IDN');
    expect(view.container.textContent).toContain('Partial coverage: IDN');
    // The blocked comparison explains itself.
    expect(view.container.textContent).toContain('Why this result is not complete');
    expect(view.container.textContent).toContain('The change depends on a partial coverage value');
    // No gap value is shown for the blocked comparison.
    expect(view.container.textContent).not.toContain('52,000,000,000');
  });

  it('names a missing country, ISO3, year and selected source while keeping independent results visible', async () => {
    const res = payload({ mode: 'observed', partial: false });
    res.years = { a: 2004, b: 2005, c: 2006 };
    res.analysis.requiredObservationYears = [2004, 2005, 2006];
    const ab = res.results.comparison.intervalResults[0];
    ab.observations.a[1] = { year: 2005, value: null, unit: 'current US$', available: false, complete: false, reason: 'MISSING_REQUIRED_DATA' };
    ab.a = { computable: false, value: null, reason: 'MISSING_REQUIRED_DATA', unit: 'current US$' };
    ab.available = false;
    const ac = structuredClone(ab);
    ac.id = 'AC';
    ac.label = 'A → C';
    ac.start = 2004;
    ac.end = 2006;
    ac.observations.a = [
      { year: 2004, value: 721e9, unit: 'current US$', available: true, complete: true },
      { year: 2006, value: 940e9, unit: 'current US$', available: true, complete: true },
    ];
    ac.observations.b = [
      { year: 2004, value: 2212e9, unit: 'current US$', available: true, complete: true },
      { year: 2006, value: 2566e9, unit: 'current US$', available: true, complete: true },
    ];
    ac.a = { computable: true, value: 219e9, unit: 'current US$' };
    ac.b = { computable: true, value: 354e9, unit: 'current US$' };
    ac.gap = { value: -135e9, unit: 'current US$' };
    ac.available = true;
    res.results.comparison.intervalResults = [ab, ac];
    const stub = stubFetch([['/api/entities', { entities: [] }], ['/api/compare', res]]);
    const view = renderCompare({ yearB: 2005, yearC: 2006, operation: 'absolute_change' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    const note = view.container.querySelector('.compare-missing-note');
    expect(note?.textContent).toContain('India (IND) — 2005');
    expect(note?.textContent).toContain('Total GDP — Nominal — Current US$ (NY.GDP.MKTP.CD)');
    expect(note?.textContent).toContain('Entity A A → C, Entity B A → C remains available');
  });

  it('shows the universe only in like-for-like mode', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed' })],
    ]);
    const view = renderCompare({ groupMode: 'observed' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);
    expect(view.container.textContent).not.toContain('Common universe');
  });

  it('sends the selected middle and later years for independent interval analysis', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      [
        '/api/compare',
        {
          ...payload({ mode: 'observed' }),
          analysis: { ...payload({ mode: 'observed' }).analysis, requiredObservationYears: [2004, 2005, 2006], ignoredPeriods: [] },
        },
      ],
    ]);
    const view = renderCompare({ groupMode: 'observed', yearC: 2006 });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    expect(view.container.querySelector('#cmp-year-c')).toBeTruthy();
    expect(view.container.textContent).toContain('A → B');
    const call = stub.calls.find((href) => href.includes('/api/compare'));
    expect(call).toContain('yearC=2006');
    expect(call).toContain('yearB=2005');
  });

  it('renders independent A→B, B→C and A→C details for both entities and charts the selected result', async () => {
    const base = payload({ mode: 'observed', partial: false });
    const intervals = [
      { id: 'AB', label: 'A → B', start: 2004, end: 2005, a: 113e9, b: 61e9, gap: 52e9 },
      { id: 'BC', label: 'B → C', start: 2005, end: 2006, a: 40e9, b: 10e9, gap: 30e9 },
      { id: 'AC', label: 'A → C', start: 2004, end: 2006, a: 153e9, b: 71e9, gap: 82e9 },
    ].map((item) => ({
      ...item,
      kind: 'change',
      formula: 'B − A',
      unit: 'current US$',
      gapUnit: 'current US$',
      available: true,
      observations: {
        a: [{ year: item.start, value: 721e9, unit: 'current US$', available: true, complete: true }, { year: item.end, value: 721e9 + item.a, unit: 'current US$', available: true, complete: true }],
        b: [{ year: item.start, value: 1955e9, unit: 'current US$', available: true, complete: true }, { year: item.end, value: 1955e9 + item.b, unit: 'current US$', available: true, complete: true }],
      },
      a: { computable: true, value: item.a, unit: 'current US$' },
      b: { computable: true, value: item.b, unit: 'current US$' },
      gap: { value: item.gap, unit: 'current US$', reason: null },
    }));
    base.analysis.requiredObservationYears = [2004, 2005, 2006];
    base.results.comparison.intervalResults = intervals;
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', base],
    ]);
    const view = renderCompare({ yearB: 2005, yearC: 2006, operation: 'absolute_change' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    for (const label of ['A → B', 'B → C', 'A → C']) expect(view.container.textContent).toContain(label);
    expect(view.container.textContent).toContain('Entity A — India');
    expect(view.container.textContent).toContain('Entity B — Big two');
    expect(view.container.textContent).toContain('52,000,000,000.00 current US$');
    expect(view.container.textContent).toContain('30,000,000,000.00 current US$');
    expect(view.container.textContent).toContain('82,000,000,000.00 current US$');
    expect(view.container.textContent).toContain('Absolute change by interval');
    expect(view.container.querySelector('details.compare-interval-inputs').open).toBe(false);
  });

  it('switches interval chart type without changing the selected calculation or refetching data', async () => {
    const res = payload({ mode: 'observed', partial: false });
    res.results.comparison.intervalResults = ['A → B', 'B → C', 'A → C'].map((label, index) => ({
      id: ['AB', 'BC', 'AC'][index], label, start: [2004, 2005, 2004][index], end: [2005, 2006, 2006][index],
      kind: 'change', formula: 'B − A', unit: 'current US$', gapUnit: 'current US$',
      observations: { a: [], b: [] },
      a: { computable: true, value: [113e9, 40e9, 153e9][index], unit: 'current US$' },
      b: { computable: true, value: [61e9, 10e9, 71e9][index], unit: 'current US$' },
      gap: { value: [52e9, 30e9, 82e9][index], unit: 'current US$' },
    }));
    const stub = stubFetch([['/api/entities', { entities: [] }], ['/api/compare', res]]);
    const view = renderCompare({ yearB: 2005, yearC: 2006, operation: 'absolute_change' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);
    const compareCalls = stub.calls.filter((href) => href.includes('/api/compare')).length;
    expect(view.container.querySelector('.chart-type-toggle [aria-pressed="true"]')?.textContent).toBe('Bar chart');
    expect(view.container.querySelector('.chart-note')).toBeNull();
    act(() => view.container.querySelector('.chart-type-toggle button:last-child').click());
    await flushReact(act);
    expect(view.container.querySelector('.chart-type-toggle [aria-pressed="true"]')?.textContent).toBe('Line chart');
    expect(view.container.querySelector('.chart-note')).toBeTruthy();
    expect(view.container.textContent).toContain('they do not represent a continuous annual trajectory');
    expect(view.container.textContent).toContain('82,000,000,000.00 current US$');
    expect(stub.calls.filter((href) => href.includes('/api/compare'))).toHaveLength(compareCalls);
  });

  it('shows only A→C when the middle year is cleared', async () => {
    const res = payload({ mode: 'observed', partial: false });
    res.years = { a: 2004, b: null, c: 2006 };
    res.analysis.requiredObservationYears = [2004, 2006];
    res.results.comparison.intervalResults = [{
      ...res.results.comparison.intervalResults[0], id: 'AC', label: 'A → C', start: 2004, end: 2006,
      observations: {
        a: [{ year: 2004, value: 721e9, unit: 'current US$', available: true, complete: true }, { year: 2006, value: 874e9, unit: 'current US$', available: true, complete: true }],
        b: [{ year: 2004, value: 1955e9, unit: 'current US$', available: true, complete: true }, { year: 2006, value: 2639e9, unit: 'current US$', available: true, complete: true }],
      },
    }];
    const stub = stubFetch([['/api/entities', { entities: [] }], ['/api/compare', res]]);
    const view = renderCompare({ yearB: null, yearC: 2006, operation: 'absolute_change' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);
    expect(view.container.textContent).toContain('A → C');
    expect(view.container.querySelectorAll('.compare-interval-card')).toHaveLength(1);
    expect(view.container.querySelector('.compare-interval-card').textContent).toContain('A → C');
    const call = stub.calls.find((href) => href.includes('/api/compare'));
    expect(call).toContain('yearC=2006');
    expect(call).not.toContain('yearB=');
  });

  it('keeps group search bounded, supports ISO search, and separates search-clear from selection-clear', async () => {
    let latest = null;
    const countries = Array.from({ length: 100 }, (_, i) => ({ iso3: `C${String(i).padStart(2, '0')}`, name: `Country ${i}` }));
    countries.push({ iso3: 'USA', name: 'United States' });
    const stub = stubFetch([['/api/groups/evaluate', { valid: true, type: 'custom_group', members: [], memberCount: 0 }]]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    latest = { kind: 'custom_group', members: ['IND'], label: 'Peers' };
    const renderPicker = () => root.render(<EntityPicker id="group-test" label="Entity A" value={latest} countries={countries} aggregates={[]} allowGroups metricKey="total_current" onChange={(next) => { latest = next; }} />);
    act(() => renderPicker());
    ctx = { stub, cleanup: () => { act(() => root.unmount()); container.remove(); } };

    expect(container.querySelector('#group-test-candidate-list')).toBeNull();
    expect(container.textContent).toContain('1 selected');
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Add countries').click());
    await flushReact(act);
    const search = container.querySelector('#group-test-group-search');
    expect(search).toBeTruthy();
    act(() => setInputValue(search, 'USA'));
    await flushReact(act);
    expect(container.querySelectorAll('#group-test-candidate-list [role="option"]')).toHaveLength(1);
    expect(container.querySelector('#group-test-candidate-list').textContent).toContain('United States');
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear search').click());
    await flushReact(act);
    expect(container.querySelector('#group-test-country-options')).toBeTruthy();
    expect(container.querySelectorAll('#group-test-candidate-list [role="option"]').length).toBeLessThanOrEqual(40);
    act(() => setInputValue(search, 'USA'));
    await flushReact(act);
    act(() => container.querySelector('#group-test-candidate-list button').click());
    expect(latest.members).toEqual(['IND', 'USA']);
    act(() => renderPicker());
    expect(container.querySelectorAll('.group-selected-chips .chip')).toHaveLength(2);
    expect(container.querySelectorAll('#group-test-candidate-list [role="option"]').length).toBeLessThanOrEqual(40);
    act(() => container.querySelector('[aria-label="Remove IND from group"]').click());
    expect(latest.members).toEqual(['USA']);
    act(() => renderPicker());
    expect(container.querySelectorAll('.group-selected-chips .chip')).toHaveLength(1);
    act(() => container.querySelector('.group-selection-heading .btn-ghost').click());
    expect(latest.members).toEqual([]);
    act(() => renderPicker());
    expect(container.querySelector('#group-test-candidate-list')).toBeNull();
    expect(container.textContent).toContain('No countries selected');
  });

  it('never issues an observations request for a chart', async () => {
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed' })],
    ]);
    const view = renderCompare({ groupMode: 'observed' });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);
    expect(stub.calls.filter((href) => href.includes('/api/observations')).length).toBe(0);
  });

  it('sends the selected CPI Basis, canonical metric and mapped calculation to Compare', async () => {
    hydrateRegistry(PRICES_REGISTRY);
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed', partial: false })],
    ]);
    const view = renderCompare({
      analysis: 'prices', metricKey: 'inflation_cpi', basisId: 'cpi_inflation_cumulative',
      entityA: 'country:IND', entityB: 'country:CHN', labelB: '',
      yearA: 2004, yearB: 2005, yearC: 2006, operation: 'level',
    });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);

    const call = stub.calls.find((href) => href.includes('/api/compare'));
    expect(call).toContain('indicator=inflation_cpi');
    expect(call).toContain('basis=cpi_inflation_cumulative');
    expect(call).toContain('operation=movement_inflation_cumulative');
  });

  it('changing Analysis and Metric recomputes only dependent Metric and Basis selections', async () => {
    hydrateRegistry(PRICES_REGISTRY);
    const stub = stubFetch([
      ['/api/entities', { entities: [] }],
      ['/api/compare', payload({ mode: 'observed', partial: false })],
    ]);
    const changes = {};
    const view = renderCompare({
      analysis: 'gdp_total', metricKey: 'total_current', basisId: 'level', operation: 'level',
      entityA: 'country:IND', entityB: 'country:CHN', labelB: '',
      onAnalysis: (value) => { changes.analysis = value; },
      onMetric: (value) => { changes.metric = value; },
      onBasis: (value) => { changes.basis = value; },
      onOperation: (value) => { changes.operation = value; },
    });
    ctx = { stub, cleanup: view.cleanup };
    await flushReact(act);
    act(() => view.container.querySelector('#cmp-analysis').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushReact(act);
    const prices = [...document.querySelectorAll('.combo-option')].find((node) => node.textContent.trim() === 'Prices');
    expect(prices).toBeTruthy();
    act(() => prices.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await flushReact(act);
    expect(changes).toMatchObject({ analysis: 'prices', metric: 'inflation_cpi', basis: 'cpi_inflation_annual', operation: 'level' });

    // With Prices selected, Metric is scoped to the three registered Prices
    // indicators. Changing to CPI index picks its first registered Basis.
    const metricChanges = {};
    const metricView = renderCompare({
      analysis: 'prices', metricKey: 'inflation_cpi', basisId: 'cpi_inflation_annual', operation: 'level',
      entityA: 'country:IND', entityB: 'country:CHN', labelB: '',
      onMetric: (value) => { metricChanges.metric = value; },
      onBasis: (value) => { metricChanges.basis = value; },
      onOperation: (value) => { metricChanges.operation = value; },
    });
    ctx.cleanup();
    ctx = { stub, cleanup: metricView.cleanup };
    await flushReact(act);
    act(() => metricView.container.querySelector('#cmp-metric').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushReact(act);
    const metricOptions = [...document.querySelectorAll('.combo-option')].map((node) => node.textContent.trim());
    expect(metricOptions.some((label) => label.startsWith('CPI inflation'))).toBe(true);
    expect(metricOptions.some((label) => label.startsWith('CPI index'))).toBe(true);
    expect(metricOptions.some((label) => label.startsWith('Total GDP'))).toBe(false);
    const cpiIndex = [...document.querySelectorAll('.combo-option')].find((node) => node.textContent.trim().startsWith('CPI index'));
    act(() => cpiIndex.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await flushReact(act);
    expect(metricChanges).toMatchObject({ metric: 'inflation_cpi_index', basis: 'cpi_index_annual', operation: 'level' });
  });

  // ---------- Selector contract tests ----------

  it('Analysis and Metric options are the exact subject registry and its members', () => {
    hydrateRegistry({
      subjects: [
        { key: 'prices', label: 'Prices' },
        { key: 'trade', label: 'Trade' },
        { key: 'gdp_total', label: 'Total GDP' },
      ],
      production: [
        ...['inflation_cpi', 'inflation_cpi_index', 'inflation_deflator'].map((key) => ({
          key, subject: 'prices', label: key, shortLabel: key, unit: '%', indicatorCode: key,
          observationType: key === 'inflation_cpi_index' ? 'INDEX' : 'RATE',
          validChangeTypes: ['ABSOLUTE', 'PERCENT', 'PP', 'CAGR'], comparisonCapability: ['COUNTRY'],
        })),
        ...['exports_current', 'imports_current'].map((key) => ({
          key, subject: 'trade', label: key, shortLabel: key, unit: 'current US$', indicatorCode: key,
          observationType: 'FLOW', validChangeTypes: ['ABSOLUTE', 'PERCENT', 'CAGR'], periodAggregation: ['SUM', 'AVG'], comparisonCapability: ['COUNTRY'],
        })),
        ...['total_current', 'total_constant'].map((key) => ({
          key, subject: 'gdp_total', label: key, shortLabel: key, unit: 'current US$', indicatorCode: key,
          observationType: 'FLOW', validChangeTypes: ['ABSOLUTE', 'PERCENT', 'CAGR'], periodAggregation: ['SUM', 'AVG'], comparisonCapability: ['COUNTRY'], aggregation: 'SUM',
        })),
      ],
    });
    expect(Object.values(SUBJECTS).map(({ key, label }) => [key, label])).toEqual([
      ['prices', 'Prices'], ['trade', 'Trade'], ['gdp_total', 'Total GDP'],
    ]);
    expect(metricKeysForSubject('prices')).toEqual(['inflation_cpi', 'inflation_cpi_index', 'inflation_deflator']);
    expect(metricKeysForSubject('trade')).toEqual(['exports_current', 'imports_current']);
    expect(metricKeysForSubject('gdp_total')).toEqual(['total_current', 'total_constant']);
  });

  it('Basis options follow Movement for CPI, and map to distinct Compare calculations', () => {
    hydrateRegistry({
      subjects: [{ key: 'prices', label: 'Prices' }],
      production: ['inflation_cpi', 'inflation_cpi_index'].map((key) => ({
        key, subject: 'prices', label: key, shortLabel: key, unit: '%', indicatorCode: key,
        observationType: key === 'inflation_cpi_index' ? 'INDEX' : 'RATE',
        validChangeTypes: ['ABSOLUTE', 'PERCENT', 'PP', 'CAGR'], comparisonCapability: ['COUNTRY'],
      })),
    });
    const annualCpi = movementBasisOptions('inflation_cpi');
    expect(annualCpi.map(({ id, label }) => [id, label])).toEqual([
      ['cpi_inflation_annual', 'Annual CPI inflation (%)'],
      ['cpi_inflation_average', 'Average annual CPI inflation (%)'],
      ['cpi_inflation_cumulative', 'Cumulative CPI inflation (%)'],
    ]);
    expect(annualCpi.map(({ id }) => compareOperationForMovementBasis(id))).toEqual([
      'level', 'movement_period_average', 'movement_inflation_cumulative',
    ]);
    expect(movementBasisOptions('inflation_cpi_index').map(({ id }) => id)).toEqual([
      'cpi_index_annual', 'cpi_index_period_change',
    ]);
  });

  it('Compare Basis retains valid CAGR and Segmented growth without placing operations in Analysis', () => {
    hydrateRegistry(DEFAULT_REGISTRY);
    const entityA = { kind: 'country', iso3: 'IND' };
    const entityB = { kind: 'country', iso3: 'CHN' };
    const basis = compareMethodOptions('total_current', entityA, entityB, 2004, 2006);
    const options = Object.values(SUBJECTS).map(({ key, label }) => ({ value: key, label }));
    expect(options.map(({ value }) => value)).toEqual(Object.keys(SUBJECTS));
    expect(options.map(({ label }) => label)).not.toContain('CAGR');
    expect(options.map(({ label }) => label)).not.toContain('Segmented growth');
    expect(basis.map(({ value }) => value)).toContain('level');
    expect(basis.map(({ value }) => value)).toContain('compare:cagr');
    expect(basis.map(({ value }) => value)).toContain('compare:segmented_growth');
    expect(basis.find(({ value }) => value === 'compare:cagr')).toMatchObject({ operation: 'cagr', requestBasis: 'total_current' });
    expect(basis.find(({ value }) => value === 'compare:segmented_growth')).toMatchObject({ operation: 'segmented_growth', requestBasis: 'total_current' });
  });

});
