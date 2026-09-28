/**
 * FOCUS-COUNTRY CORRECTNESS TESTS, PHASE 2 (RankMovement).
 *
 * The generic level/growth movement UI must represent the SELECTED focus
 * country — never fall back to India-specific rendering when another
 * country is active. Backend-shaped payloads carry backend values; these
 * tests assert only focus identity in the presentation layer (highlighted
 * row, focus tag, labels, narratives, placeholders, aria text) and that the
 * request itself uses the selected country. No economics are asserted here.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { flushReact, stubFetch } from '../test-utils.js';
import RankMovement from './RankMovement.jsx';

const EVIDENCE = {
  vintage: { wbLastUpdated: '2024-01-01', mixedVintage: false },
  retrieval: { runIdA: 1, runIdB: 1 },
  fingerprint: { runId: 1, observationCount: 500 },
  freshness: { fresh: true, lastRunStatus: 'ok' },
  limits: [],
};

function levelPayload(focus, rows, { withMid = false } = {}) {
  const years = withMid ? { a: 2004, mid: 2014, b: 2024 } : { a: 2004, b: 2024 };
  return {
    comparison: { available: true, mode: 'level' },
    years,
    focus,
    metric: { key: 'total_current', unit: 'current US$', indicatorCode: 'X' },
    focusMovement: {
      fullRankA: 8,
      fullRankB: 6,
      commonRankA: 9,
      commonRankB: 7,
      ...(withMid
        ? {
            fullRankMid: 7,
            commonRankMid: 8,
            denominatorMid: 181,
            positionNumberChangeAM: -1,
            positionNumberChangeMB: -1,
            commonEffectAM: -1,
            commonEffectMB: -1,
            observedSetEffectAM: 0,
            observedSetEffectMB: 0,
            placesGainedAM: 1,
            placesGainedMB: 1,
            outsideAboveA: 2,
            outsideAboveMid: 1,
            outsideAboveB: 3,
          }
        : {}),
      denominatorA: 180,
      denominatorB: 182,
      denominatorCommon: 170,
      positionNumberChange: -2,
      placesGained: 2,
      commonEffect: -2,
      observedSetEffect: 0,
      enteredAboveB: 1,
      enteredBelowB: 2,
      exitedAboveA: 1,
      exitedBelowA: 3,
    },
    universe: {
      membershipRule: 'valid observations',
      common: 170,
      setA: 180,
      setB: 182,
      entered: 3,
      exited: 4,
      ...(withMid ? { setMid: 181, outside: 12, outsideInA: 5, outsideInMid: 4, outsideInB: 6 } : {}),
    },
    economies: { rows },
    evidence: EVIDENCE,
  };
}

function growthPayload(focus, rows) {
  return {
    comparison: { available: true, mode: 'yoy' },
    years: { a: 2004, b: 2024 },
    focus,
    metric: { key: 'total_current', unit: 'current US$', indicatorCode: 'X' },
    focusMovement: {
      growth: {
        AB: {
          available: true,
          startYear: 2004,
          endYear: 2024,
          indiaGrowthPercent: 5.5,
          indiaGrowthDisplay: '+5.50%',
          fullGrowthRank: 12,
          denominatorObserved: 150,
          commonGrowthRank: 10,
          denominatorCommon: 140,
          peerAvgObservedDisplay: '+3.00%',
          peerCountObserved: 149,
          vsPeerObservedDisplay: '+2.50 pp',
          peerAvgCommonDisplay: '+3.10%',
          peerCountCommon: 139,
          vsPeerCommonDisplay: '+2.40 pp',
          startDisplay: '100',
          endDisplay: '105.5',
          absoluteDisplay: '+5.5',
          outsideAbove: 2,
          identityText: '12 − 2 = 10',
        },
      },
    },
    universe: {
      membershipRule: 'calculable growth',
      common: 140,
      intervals: ['AB'],
      AB: { observed: 150, outside: 10 },
    },
    economies: { rows },
    evidence: EVIDENCE,
    comparisonMethodology: {},
  };
}

function levelRows(focusIso, focusName, otherIso, otherName) {
  return [
    {
      iso3: focusIso,
      name: focusName,
      status: 'common',
      rankA: 8,
      rankB: 6,
      valueA: 20000,
      valueB: 24000,
      displayA: '20k',
      displayB: '24k',
      relationToFocus: 'tie',
      relationToFocusA: 'tie',
      relationToFocusB: 'tie',
      positionEffect: 'none',
      affectsFocusPosition: false,
    },
    {
      iso3: otherIso,
      name: otherName,
      status: 'entered',
      rankB: 3,
      displayB: '99k',
      relationToFocus: 'above',
      positionEffect: 'affects_position',
      affectsFocusPosition: true,
    },
    {
      iso3: 'DEU',
      name: 'Germany',
      status: 'exited',
      rankA: 200,
      displayA: '1k',
      relationToFocus: 'below',
      positionEffect: 'none',
      affectsFocusPosition: false,
    },
  ];
}

function growthRows(focusIso, focusName) {
  const interval = {
    valid: true,
    growthDisplay: '+5.50%',
    growthPercent: 5.5,
    obsRank: 12,
    commonRank: 10,
    startDisplay: '100',
    endDisplay: '105.5',
    absoluteDisplay: '+5.5',
    relObs: 'above',
    relCommon: 'above',
    affectsObs: true,
  };
  return [
    { iso3: focusIso, name: focusName, status: 'common', relationToFocus: 'above', intervals: { AB: interval } },
    {
      iso3: 'DEU',
      name: 'Germany',
      status: 'outside',
      relationToFocus: 'below',
      intervals: { AB: { ...interval, relObs: 'below', relCommon: 'below', affectsObs: false } },
    },
  ];
}

const FOCUS = {
  USA: { iso3: 'USA', name: 'United States' },
  CHN: { iso3: 'CHN', name: 'China' },
  JPN: { iso3: 'JPN', name: 'Japan' },
  IDN: { iso3: 'IDN', name: 'Indonesia' },
  IND: { iso3: 'IND', name: 'India' },
};

function renderMovement({ focus, rows, basis = 'level', withMid = false, mode = 'level' }) {
  const body = mode === 'yoy' ? growthPayload(focus, rows) : levelPayload(focus, rows, { withMid });
  const stub = stubFetch([['/api/comparison/level', body]]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const noop = () => {};
  act(() => {
    root.render(
      <RankMovement
        availableYears={[2004, 2014, 2024]}
        yearA={2004}
        yearB={2024}
        yearMid={withMid ? 2014 : null}
        metricKey="total_current"
        basis={basis}
        country={focus.iso3}
        countries={[]}
        focusName={focus.name}
        onYearA={noop}
        onYearB={noop}
        onYearMid={noop}
        onMetric={noop}
        onBasis={noop}
        onCountry={noop}
      />,
    );
  });
  return { stub, container, cleanup: () => act(() => root.unmount()) || container.remove() };
}

function openCollapsibleLists(container) {
  // Re-query the live DOM per click: each toggle re-renders, detaching the
  // previously collected button nodes.
  for (let i = 0; i < 6; i += 1) {
    const btn = [...container.querySelectorAll('button')].find((el) =>
      /^Show (entered|common|outside)/.test(el.textContent),
    );
    if (!btn) return;
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
}

async function relationOptionLabels(container, selectId) {
  const btn = container.querySelector(`#${selectId}`);
  expect(btn).toBeTruthy();
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushReact(act);
  const options = [...document.querySelectorAll('.combo-option')].map((el) => el.textContent);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushReact(act);
  return options;
}

function focusRow(container) {
  return container.querySelector('tr.row-focus');
}

const INDIA_NARRATIVES = [
  'Above India',
  'Below India',
  'Relation to India',
  "Affects India's",
  "India's position",
  'India ranking',
  'India growth',
  'India observed',
  'Crossed India',
  'vs India',
];

describe('RankMovement focus-country correctness', () => {
  let ctx = null;
  afterEach(() => {
    ctx?.stub?.restore();
    ctx?.cleanup();
    ctx = null;
    document.body.innerHTML = '';
  });

  it('TEST 1 — USA two-year: focus row, labels, narratives and request all use the United States', async () => {
    ctx = renderMovement({ focus: FOCUS.USA, rows: levelRows('USA', 'United States', 'CHN', 'China') });
    await flushReact(act);
    openCollapsibleLists(ctx.container);
    await flushReact(act);

    // Request uses the selected country.
    expect(ctx.stub.calls.some((href) => href.includes('/api/comparison/level') && href.includes('country=USA'))).toBe(true);

    // Exactly one focus row, and it is the United States.
    const row = focusRow(ctx.container);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('United States');
    expect(ctx.container.querySelector('.focus-tag').textContent).toContain('United States');

    // Dynamic labels and narratives.
    expect(ctx.container.querySelector('[aria-label="United States ranking movement summary"]')).toBeTruthy();
    for (const text of ['Above United States', 'Below United States', 'Relation to United States', "United States'"]) {
      expect(ctx.container.textContent).toContain(text);
    }
    expect(ctx.container.querySelector('#mv-q')?.placeholder).toBe('e.g. United States, USA, or #12');
    expect(ctx.container.querySelector('#mv-crel')?.getAttribute('aria-label')).toBe('Relation to United States');

    // Relation-filter option labels derive from the focus country.
    expect(await relationOptionLabels(ctx.container, 'mv-rel')).toEqual(
      expect.arrayContaining(['Above United States', 'Below United States', "Affects United States's position"]),
    );
    expect(await relationOptionLabels(ctx.container, 'mv-crel')).toEqual(
      expect.arrayContaining(['Above United States in both years', 'Crossed United States between years']),
    );

    // No generic India narrative remains anywhere in the movement view.
    for (const text of INDIA_NARRATIVES) {
      expect(ctx.container.textContent).not.toContain(text);
    }
    expect(ctx.container.textContent).not.toContain('India');
  });

  it('TEST 2 — CHN three-year: story, filters and tables use China', async () => {
    ctx = renderMovement({ focus: FOCUS.CHN, rows: levelRows('CHN', 'China', 'USA', 'United States'), withMid: true });
    await flushReact(act);
    openCollapsibleLists(ctx.container);
    await flushReact(act);

    expect(ctx.stub.calls.some((href) => href.includes('country=CHN'))).toBe(true);
    const row = focusRow(ctx.container);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('China');
    for (const text of ['Above China in 2004', 'Relation to China', "China's"]) {
      expect(ctx.container.textContent).toContain(text);
    }
    expect(ctx.container.querySelector('#mv3-q')?.placeholder).toBe('e.g. China, CHN, or #12');
    expect(await relationOptionLabels(ctx.container, 'mv3-crel')).toEqual(
      expect.arrayContaining(['Below China in 2024', 'Above China in all 3 years']),
    );
    for (const text of INDIA_NARRATIVES) {
      expect(ctx.container.textContent).not.toContain(text);
    }
    expect(ctx.container.textContent).not.toContain('India');
  });

  it('TEST 3 — JPN growth: cards, relations and intervals use Japan', async () => {
    ctx = renderMovement({ focus: FOCUS.JPN, rows: growthRows('JPN', 'Japan'), basis: 'growth', mode: 'yoy' });
    await flushReact(act);
    openCollapsibleLists(ctx.container);
    await flushReact(act);

    expect(ctx.stub.calls.some((href) => href.includes('country=JPN'))).toBe(true);
    const row = focusRow(ctx.container);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Japan');
    for (const text of ["Japan's change", 'Relation to Japan', 'Outside-common growth economies above Japan']) {
      expect(ctx.container.textContent).toContain(text);
    }
    expect(ctx.container.querySelector('#mv-gq')?.placeholder).toBe('e.g. Japan, JPN, or #12');
    expect(await relationOptionLabels(ctx.container, 'mv-gcrel')).toEqual(
      expect.arrayContaining(['Above Japan in 2004→2024', 'Crossed Japan between intervals']),
    );
    for (const text of INDIA_NARRATIVES) {
      expect(ctx.container.textContent).not.toContain(text);
    }
    expect(ctx.container.textContent).not.toContain('India');
  });

  it('IDN two-year: Indonesia is the focus with no India narrative', async () => {
    ctx = renderMovement({ focus: FOCUS.IDN, rows: levelRows('IDN', 'Indonesia', 'USA', 'United States') });
    await flushReact(act);
    openCollapsibleLists(ctx.container);
    await flushReact(act);

    expect(ctx.stub.calls.some((href) => href.includes('country=IDN'))).toBe(true);
    const row = focusRow(ctx.container);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Indonesia');
    expect(ctx.container.querySelector('.focus-tag').textContent).toContain('Indonesia');
    for (const text of ['Above Indonesia', 'Below Indonesia', 'Relation to Indonesia', "Indonesia's"]) {
      expect(ctx.container.textContent).toContain(text);
    }
    for (const text of INDIA_NARRATIVES) {
      expect(ctx.container.textContent).not.toContain(text);
    }
    expect(ctx.container.textContent).not.toContain('India');
  });

  it('TEST 4 — IND still renders India correctly when India really is selected', async () => {
    ctx = renderMovement({ focus: FOCUS.IND, rows: levelRows('IND', 'India', 'USA', 'United States') });
    await flushReact(act);
    openCollapsibleLists(ctx.container);
    await flushReact(act);

    const row = focusRow(ctx.container);
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('India');
    for (const text of ['Above India', 'Below India', 'Relation to India', "India's"]) {
      expect(ctx.container.textContent).toContain(text);
    }
  });
});
