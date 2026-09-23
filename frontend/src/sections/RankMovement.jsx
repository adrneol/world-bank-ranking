/**
 * Rank-movement comparison (level mode, V1).
 *
 * Separate analytical layer: QUESTION → ANALYSIS → EXPLANATION → EVIDENCE.
 * Display-only: every rank, delta, count and sentence comes from
 * GET /api/comparison/level. Client-side search/filter/pagination never
 * recalculates the universe or the decomposition.
 */

import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { METRIC_KEYS, METRICS, metricLabel } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { Field, Section, StatusBlock } from '../components/ui.jsx';

function formatSigned(n) {
  if (n === null || n === undefined) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

/** “1 place” vs “N places”; backend integers only, grammar fixed here. */
function formatPlaces(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  return `${abs} ${abs === 1 ? 'place' : 'places'}`;
}

/** Immediate sign meaning; canonical backend convention, never inferred. */
function signMeaning(n) {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'position number increased; lower place';
  if (n < 0) return 'position number decreased; higher place';
  return 'no change in position number';
}

const RANKING_BASIS = Object.freeze({ LEVEL: 'level', GROWTH: 'growth' });

function MovementControls({ availableYears, yearA, yearB, yearMid, metricKey, basis = 'level', onYearA, onYearB, onYearMid, onMetric, onBasis, onSwap }) {
  const validMidYears = (availableYears ?? []).filter(
    (y) => yearA != null && yearB != null && y > Math.min(yearA, yearB) && y < Math.max(yearA, yearB),
  );
  return (
    <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Comparison controls">
      <Field label="Metric" htmlFor="mv-metric">
        <select id="mv-metric" value={metricKey} onChange={(e) => onMetric(e.target.value)}>
          {METRIC_KEYS.map((key) => (
            <option key={key} value={key}>
              {metricLabel(key)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Basis" htmlFor="mv-basis">
        <select id="mv-basis" value={basis} onChange={(e) => onBasis(e.target.value)}>
          <option value={RANKING_BASIS.LEVEL}>Per-capita level</option>
          <option value={RANKING_BASIS.GROWTH}>YoY % growth</option>
        </select>
      </Field>
      <Field label="Year A (earlier)" htmlFor="mv-yearA">
        <select id="mv-yearA" value={yearA ?? ''} onChange={(e) => onYearA(Number(e.target.value))}>
          {(availableYears ?? []).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Middle year" htmlFor="mv-yearMid">
        <select
          id="mv-yearMid"
          value={yearMid ?? ''}
          onChange={(e) => onYearMid(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">None</option>
          {validMidYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Year B (later)" htmlFor="mv-yearB">
        <select id="mv-yearB" value={yearB ?? ''} onChange={(e) => onYearB(Number(e.target.value))}>
          {(availableYears ?? []).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Swap" htmlFor="mv-swap">
        <button id="mv-swap" type="button" className="btn btn-secondary" onClick={onSwap} aria-label="Swap year A and year B">
          ⇄ Swap A/B
        </button>
      </Field>
    </form>
  );
}

function SummaryCards({ data }) {
  const fm = data.focusMovement;
  const years = data.years;
  const metric = data.metric;
  if (!fm) return null;
  return (
    <div className="cards" role="region" aria-label="India ranking movement summary">
      <div className="card">
        <h3>
          Earlier · {years.a} <span className="card-unit">observed ranking</span>
        </h3>
        <p className="card-rank">
          {fm.fullRankA != null ? `#${fm.fullRankA} / ${fm.denominatorA}` : 'n/a'}
        </p>
        <p className="card-unit">
          {fm.denominatorA != null
            ? `${fm.denominatorA} economies with valid observations in ${years.a}`
            : 'Denominator unavailable.'}
        </p>
        <p className="card-code mono">
          {metric.indicatorCode} · {metric.unit}
        </p>
      </div>
      <div className="card">
        <h3>
          Later · {years.b} <span className="card-unit">observed ranking</span>
        </h3>
        <p className="card-rank">
          {fm.fullRankB != null ? `#${fm.fullRankB} / ${fm.denominatorB}` : 'n/a'}
        </p>
        <p className="card-unit">
          {fm.denominatorB != null
            ? `${fm.denominatorB} economies with valid observations in ${years.b}`
            : 'Denominator unavailable.'}
        </p>
        <p className="card-code mono">
          {metric.indicatorCode} · {metric.unit}
        </p>
      </div>
      <div className="card card-result">
        <h3>Result · position number change</h3>
        <p className="card-result-value" aria-label={`Position number changed by ${fm.positionNumberChange}`}>
          {fm.positionNumberChange != null ? formatSigned(fm.positionNumberChange) : 'n/a'}
        </p>
        <p className="card-unit">
          {fm.positionNumberChange != null ? signMeaning(fm.positionNumberChange) : 'Decomposition unavailable.'}
        </p>
        <p className="card-unit">
          {fm.placesGained != null
            ? `${fm.placesGained > 0 ? `${formatPlaces(fm.placesGained)} gained` : fm.placesGained < 0 ? `${formatPlaces(fm.placesGained)} lost` : 'No change in places'} (places gained = ${formatSigned(fm.placesGained)})`
            : ''}
        </p>
      </div>
    </div>
  );
}

function StorySentence({ data }) {
  // Human-readable story composed ONLY from backend-provided integers.
  // No recalculation: wording selects among precomputed backend fields.
  const fm = data.focusMovement;
  const u = data.universe;
  const y = data.years;
  if (!fm || fm.positionNumberChange == null) return null;
  const dF = fm.positionNumberChange;
  const dK = fm.commonEffect;
  const pool = fm.observedSetEffect;
  const direction =
    dF > 0
      ? `increased by ${dF} (a lower place)`
      : dF < 0
        ? `decreased by ${-dF} (a higher place)`
        : 'did not change';
  const commonDirection =
    dK > 0
      ? `moved down ${dK} among the same economies`
      : dK < 0
        ? `moved up ${-dK} among the same economies`
        : 'held the same position among the same economies';
  return (
    <div>
      <p>
        India&apos;s observed position number {direction}: #{fm.fullRankA}/{fm.denominatorA} in {y.a} → #
        {fm.fullRankB}/{fm.denominatorB} in {y.b}.
      </p>
      <p>
        Among the {u.common} economies observed in both years, India {commonDirection} (#{fm.commonRankA} → #
        {fm.commonRankB}).
      </p>
      <p>
        {fm.enteredAboveB} {fm.enteredAboveB === 1 ? 'economy' : 'economies'} entered the {y.b} observed
        ranking above India. {fm.exitedAboveA} {fm.exitedAboveA === 1 ? 'economy that ranked' : 'economies that ranked'}{' '}
        above India in {y.a} {fm.exitedAboveA === 1 ? 'is' : 'are'} no longer in the observed ranking. Under
        the ranking definition, these outside-common-set changes contributed{' '}
        {pool > 0 ? `+${pool}` : `${pool}`} to India&apos;s position number.
      </p>
    </div>
  );
}

function SummaryCards3({ data }) {
  const fm = data.focusMovement;
  const years = data.years;
  const metric = data.metric;
  if (!fm) return null;
  const card = (title, rank, denom, year) => (
    <div className="card">
      <h3>
        {title} · {year} <span className="card-unit">observed ranking</span>
      </h3>
      <p className="card-rank">{rank != null ? `#${rank} / ${denom}` : 'n/a'}</p>
      <p className="card-unit">
        {denom != null ? `${denom} economies with valid observations in ${year}` : 'Denominator unavailable.'}
      </p>
      <p className="card-code mono">
        {metric.indicatorCode} · {metric.unit}
      </p>
    </div>
  );
  const seg = (label, change, gained) => (
    <div className="card card-result">
      <h3>{label}</h3>
      <p className="card-result-value">{change != null ? formatSigned(change) : 'n/a'}</p>
      <p className="card-unit">{change != null ? signMeaning(change) : 'Decomposition unavailable.'}</p>
      <p className="card-unit">
        {gained != null
          ? `${gained > 0 ? `${formatPlaces(gained)} gained` : gained < 0 ? `${formatPlaces(gained)} lost` : 'No change in places'} (places gained = ${formatSigned(gained)})`
          : ''}
      </p>
    </div>
  );
  return (
    <div>
      <div className="cards" role="region" aria-label="India observed ranking at three points">
        {card('Start', fm.fullRankA, fm.denominatorA, years.a)}
        {card('Middle year', fm.fullRankMid, fm.denominatorMid, years.mid)}
        {card('End', fm.fullRankB, fm.denominatorB, years.b)}
      </div>
      <div className="cards" role="region" aria-label="Observed position number changes">
        {seg(`${years.a} → ${years.mid} · observed`, fm.positionNumberChangeAM, fm.placesGainedAM)}
        {seg(`${years.mid} → ${years.b} · observed`, fm.positionNumberChangeMB, fm.placesGainedMB)}
        {seg(`${years.a} → ${years.b} · observed`, fm.positionNumberChange, fm.placesGained)}
      </div>
    </div>
  );
}

function StorySentence3({ data }) {
  const fm = data.focusMovement;
  const u = data.universe;
  const y = data.years;
  if (!fm || fm.positionNumberChange == null) return null;
  return (
    <div>
      <p>
        India&apos;s observed position numbers: #{fm.fullRankA}/{fm.denominatorA} in {y.a} → #
        {fm.fullRankMid}/{fm.denominatorMid} in {y.mid} → #{fm.fullRankB}/{fm.denominatorB} in {y.b}.
      </p>
      <p>
        Among the {u.common} economies with valid observations in {y.a}, {y.mid} and {y.b}, India&apos;s
        derived comparison positions are #{fm.commonRankA} → #{fm.commonRankMid} → #{fm.commonRankB} (
        {formatSigned(fm.commonEffectAM)} then {formatSigned(fm.commonEffectMB)}; overall{' '}
        {formatSigned(fm.commonEffect)}).
      </p>
      <p>
        Outside the three-year common set, {fm.outsideAboveA} {fm.outsideAboveA === 1 ? 'economy' : 'economies'}{' '}
        ranked above India in {y.a}, {fm.outsideAboveMid} in {y.mid}, and {fm.outsideAboveB} in {y.b}. Under
        the ranking definition these contributed {formatSigned(fm.observedSetEffectAM)} ({y.a}→{y.mid}),{' '}
        {formatSigned(fm.observedSetEffectMB)} ({y.mid}→{y.b}) and {formatSigned(fm.observedSetEffect)} ({y.a}
        →{y.b}) to India&apos;s position number.
      </p>
    </div>
  );
}

function EconomyDetails({ r, yearA, yearB, yearMid = null }) {
  const isThreeYear = yearMid != null && (r.rankMid !== undefined || r.presentInMid !== undefined);
  return (
    <details className="details">
      <summary>Details</summary>
      <dl className="facts">
        <div>
          <dt>ISO3</dt>
          <dd className="mono">{r.iso3}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{r.status}</dd>
        </div>
        {isThreeYear && (r.presentInA !== undefined) ? (
          <div>
            <dt>Present in</dt>
            <dd>
              {[r.presentInA ? yearA : null, r.presentInMid ? yearMid : null, r.presentInB ? yearB : null]
                .filter((v) => v !== null)
                .join(', ') || '—'}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Relation (A{isThreeYear ? ' / MID / B' : ' / B'})</dt>
          <dd>
            {isThreeYear ? `${r.relationToFocusA} / ${r.relationToFocusMid} / ${r.relationToFocusB}` : `${r.relationToFocusA} / ${r.relationToFocusB}`}
          </dd>
        </div>
        <div>
          <dt>
            Rank in {yearA}{isThreeYear ? ` / ${yearMid} / ${yearB}` : ` / ${yearB}`}
          </dt>
          <dd className="num">
            {isThreeYear ? `${r.rankA ?? '—'} / ${r.rankMid ?? '—'} / ${r.rankB ?? '—'}` : `${r.rankA ?? '—'} / ${r.rankB ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt>Raw value A</dt>
          <dd className="mono">{r.rawTextA ?? '—'}</dd>
        </div>
        {isThreeYear ? (
          <div>
            <dt>Raw value MID</dt>
            <dd className="mono">{r.rawTextMid ?? '—'}</dd>
          </div>
        ) : null}
        <div>
          <dt>Raw value B</dt>
          <dd className="mono">{r.rawTextB ?? '—'}</dd>
        </div>
        <div>
          <dt>Display A{isThreeYear ? ' / MID / B' : ' / B'}</dt>
          <dd>
            {isThreeYear ? `${r.displayA ?? '—'} / ${r.displayMid ?? '—'} / ${r.displayB ?? '—'}` : `${r.displayA ?? '—'} / ${r.displayB ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{r.region ?? '—'}</dd>
        </div>
        <div>
          <dt>Income level</dt>
          <dd>{r.incomeLevel ?? '—'}</dd>
        </div>
        <div>
          <dt>Lending type</dt>
          <dd>{r.lendingType ?? '—'}</dd>
        </div>
        <div>
          <dt>Metadata note</dt>
          <dd>{r.metadataVintageNote}</dd>
        </div>
        {r.tiedWithFocusA || r.tiedWithFocusMid || r.tiedWithFocusB ? (
          <div>
            <dt>Tie</dt>
            <dd>Tied value with India; ISO3 order decides the position.</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

/**
 * Entered/exited (two-year) / outside-per-year (three-year) table: economies
 * OUTSIDE the common set. The Effect column is correct here only: above →
 * affects position, below → denominator only.
 *
 * Without a middle year this renders exactly the original entered/exited
 * table (each row's own status decides its rank/value year, so a mixed All
 * tab renders correctly row by row). With a middle year plus focusYear it
 * renders the same interaction model for one year's outside slice of the
 * three-year common universe: presence, relation/rank/value in that year, and
 * whether the economy affects India's position in that year (backend
 * per-year fields). With a middle year and no focusYear (the All tab) it
 * shows the full outside dataset with combined per-year rank/value cells and
 * the backend overall relation/effect fields.
 */
function EconomyTable({ rows, yearA, yearB, yearMid = null, focusYear = null, showStatus = true, caption, serialBase = 0 }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  const hasMid = yearMid != null;
  const isYearTab = hasMid && focusYear != null;
  const isAllTab = hasMid && focusYear == null;
  const keys = isYearTab ? yearColumnKeys([yearA, yearMid, yearB], focusYear) : null;
  const affectsKey = keys ? `affectsFocusPosition${keys.rank.replace('rank', '')}` : null;
  const presenceOf = (r) =>
    [r.presentInA ? yearA : null, r.presentInMid ? yearMid : null, r.presentInB ? yearB : null]
      .filter((v) => v !== null)
      .join(' · ') || '—';
  const combined = (r, prefix) =>
    [r[`${prefix}A`] ?? '—', r[`${prefix}Mid`] ?? '—', r[`${prefix}B`] ?? '—'].join(' / ');
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            {showStatus ? <th scope="col">{hasMid ? 'Present in' : 'Status'}</th> : null}
            <th scope="col">Relation to India{isYearTab ? ` in ${focusYear}` : ''}</th>
            <th scope="col" className="num">
              {isAllTab ? `Rank ${yearA} / ${yearMid} / ${yearB}` : `Rank${isYearTab ? ` in ${focusYear}` : ''}`}
            </th>
            <th scope="col" className="num">
              {isAllTab ? `Value ${yearA} / ${yearMid} / ${yearB}` : `Value${isYearTab ? ` in ${focusYear}` : ''}`}
            </th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
              <td className="num">{serialBase + i + 1}</td>
              <th scope="row">
                {r.name ?? r.iso3}
                {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                <EconomyDetails r={r} yearA={yearA} yearB={yearB} yearMid={yearMid} />
              </th>
              <td className="mono">{r.iso3}</td>
              {showStatus ? <td>{hasMid ? presenceOf(r) : r.status}</td> : null}
              <td>{isYearTab ? (r[keys.relation] ?? r.relationToFocus) : r.relationToFocus}</td>
              <td className="num">
                {isAllTab
                  ? combined(r, 'rank')
                  : isYearTab
                    ? (r[keys.rank] ?? '—')
                    : r.status === 'exited' ? (r.rankA ?? '—') : (r.rankB ?? '—')}
              </td>
              <td className="num">
                {isAllTab
                  ? combined(r, 'display')
                  : isYearTab
                    ? (r[keys.display] ?? '—')
                    : r.status === 'exited' ? (r.displayA ?? '—') : (r.displayB ?? '—')}
              </td>
              <td>
                {hasMid
                  ? (isYearTab ? r[affectsKey] : r.affectsFocusPosition)
                    ? 'Affects position'
                    : 'Denominator only'
                  : r.positionEffect === 'affects_position'
                    ? 'Affects position'
                    : 'Denominator only'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Column keys for one comparison year, derived from its position in the
 * selected comparisonYears = [start, ...(middle ? [middle] : []), end].
 * Backend rows carry per-year fields with A/Mid/B suffixes.
 */
function yearColumnKeys(years, year) {
  const index = years.indexOf(year);
  const suffix = index === 0 ? 'A' : index === years.length - 1 ? 'B' : 'Mid';
  return {
    year,
    rank: `rank${suffix}`,
    display: `display${suffix}`,
    relation: `relationToFocus${suffix}`,
  };
}

/**
 * Common comparison-set table: a DIFFERENT population from entered/exited.
 * No Status column (obvious from the section) and deliberately NO Effect
 * column: common economies are the fixed comparison population, not
 * observed-set effect contributors. Sorting uses backend raw numerics
 * (valueA/valueMid/valueB) and backend ranks — never display strings. All
 * search/filter/sort is presentation-only.
 *
 * Year columns derive from comparisonYears: [yearA, yearB] renders exactly
 * the original two-year table; [yearA, yearMid, yearB] extends it with the
 * middle-year rank, value and vs-India columns.
 */
function CommonTable({ rows, yearA, yearB, yearMid = null, caption, serialBase = 0 }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  const years = yearMid != null ? [yearA, yearMid, yearB] : [yearA, yearB];
  const cols = years.map((y) => yearColumnKeys(years, y));
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Common economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            {cols.map((c) => (
              <th key={`rank-${c.year}`} scope="col" className="num">
                {c.year} rank
              </th>
            ))}
            {cols.map((c) => (
              <th key={`value-${c.year}`} scope="col" className="num">
                {c.year} value
              </th>
            ))}
            {cols.map((c) => (
              <th key={`vs-${c.year}`} scope="col">
                {c.year} vs India
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
              <td className="num">{serialBase + i + 1}</td>
              <th scope="row">
                {r.name ?? r.iso3}
                {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                <EconomyDetails r={r} yearA={yearA} yearB={yearB} yearMid={yearMid} />
              </th>
              <td className="mono">{r.iso3}</td>
              {cols.map((c) => (
                <td key={`rank-${c.year}`} className="num">
                  {r[c.rank] ?? '—'}
                </td>
              ))}
              {cols.map((c) => (
                <td key={`value-${c.year}`} className="num">
                  {r[c.display] ?? '—'}
                </td>
              ))}
              {cols.map((c) => (
                <td key={`vs-${c.year}`}>{r[c.relation]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Relation filter predicate for the common table (backend relations only). */
function matchesCommonRelation(r, filter) {
  const a = r.relationToFocusA;
  const m = r.relationToFocusMid;
  const b = r.relationToFocusB;
  const hasMid = m === 'above' || m === 'below';
  switch (filter) {
    case 'aboveA':
      return a === 'above';
    case 'belowA':
      return a === 'below';
    case 'aboveMid':
      return m === 'above';
    case 'belowMid':
      return m === 'below';
    case 'aboveB':
      return b === 'above';
    case 'belowB':
      return b === 'below';
    case 'aboveBoth':
      return a === 'above' && b === 'above';
    case 'belowBoth':
      return a === 'below' && b === 'below';
    case 'aboveAll':
      return hasMid ? a === 'above' && m === 'above' && b === 'above' : a === 'above' && b === 'above';
    case 'belowAll':
      return hasMid ? a === 'below' && m === 'below' && b === 'below' : a === 'below' && b === 'below';
    case 'crossed': {
      const rels = [a, ...(hasMid ? [m] : []), b].filter((v) => v === 'above' || v === 'below');
      return new Set(rels).size > 1;
    }
    default:
      return true;
  }
}

/**
 * Relation-filter options derived from the selected comparison years.
 * comparisonYears = [start, ...(middle ? [middle] : []), end].
 * Two years yield exactly the original option set; three years extend it.
 */
function commonRelationOptions(years) {
  const [a, ...rest] = years;
  const b = rest[rest.length - 1];
  const mid = rest.length > 1 ? rest[0] : null;
  const options = [
    { value: 'all', label: 'All' },
    { value: 'aboveA', label: `Above India in ${a}` },
    { value: 'belowA', label: `Below India in ${a}` },
  ];
  if (mid != null) {
    options.push(
      { value: 'aboveMid', label: `Above India in ${mid}` },
      { value: 'belowMid', label: `Below India in ${mid}` },
    );
  }
  options.push(
    { value: 'aboveB', label: `Above India in ${b}` },
    { value: 'belowB', label: `Below India in ${b}` },
  );
  if (mid != null) {
    options.push(
      { value: 'aboveAll', label: 'Above India in all 3 years' },
      { value: 'belowAll', label: 'Below India in all 3 years' },
    );
  } else {
    options.push(
      { value: 'aboveBoth', label: 'Above India in both years' },
      { value: 'belowBoth', label: 'Below India in both years' },
    );
  }
  options.push({ value: 'crossed', label: 'Crossed India between years' });
  return options;
}

/**
 * Sort options derived from the selected comparison years.
 * Two years yield exactly the original option set; three years add the
 * equivalent middle-year entries.
 */
function commonSortOptions(years) {
  const [a, ...rest] = years;
  const b = rest[rest.length - 1];
  const mid = rest.length > 1 ? rest[0] : null;
  const options = [
    { value: 'valueA-desc', label: `Value in ${a} — high to low` },
    { value: 'valueA-asc', label: `Value in ${a} — low to high` },
  ];
  if (mid != null) {
    options.push(
      { value: 'valueMid-desc', label: `Value in ${mid} — high to low` },
      { value: 'valueMid-asc', label: `Value in ${mid} — low to high` },
    );
  }
  options.push(
    { value: 'valueB-desc', label: `Value in ${b} — high to low` },
    { value: 'valueB-asc', label: `Value in ${b} — low to high` },
    { value: 'rankA-asc', label: `Rank in ${a} — best first` },
    { value: 'rankA-desc', label: `Rank in ${a} — lowest first` },
  );
  if (mid != null) {
    options.push(
      { value: 'rankMid-asc', label: `Rank in ${mid} — best first` },
      { value: 'rankMid-desc', label: `Rank in ${mid} — lowest first` },
    );
  }
  options.push(
    { value: 'rankB-asc', label: `Rank in ${b} — best first` },
    { value: 'rankB-desc', label: `Rank in ${b} — lowest first` },
  );
  return options;
}

/**
 * Sort with backend semantics: numeric values sort by the raw backend
 * number (never the display string); ranks sort by backend rank; ties keep
 * backend order via ISO3 (rows arrive in ISO3 order within equal keys only
 * if the comparator is stable — so re-apply ISO3 as the deterministic
 * tie-break, mirroring the ranking rule).
 */
function sortCommonRows(rows, sort) {
  const copy = [...rows];
  const byIso3 = (x, y) => (x.iso3 < y.iso3 ? -1 : x.iso3 > y.iso3 ? 1 : 0);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (sort) {
    case 'valueA-asc':
      return copy.sort((x, y) => (num(x.valueA) ?? Infinity) - (num(y.valueA) ?? Infinity) || byIso3(x, y));
    case 'valueMid-asc':
      return copy.sort((x, y) => (num(x.valueMid) ?? Infinity) - (num(y.valueMid) ?? Infinity) || byIso3(x, y));
    case 'valueMid-desc':
      return copy.sort((x, y) => (num(y.valueMid) ?? -Infinity) - (num(x.valueMid) ?? -Infinity) || byIso3(x, y));
    case 'valueB-asc':
      return copy.sort((x, y) => (num(x.valueB) ?? Infinity) - (num(y.valueB) ?? Infinity) || byIso3(x, y));
    case 'valueB-desc':
      return copy.sort((x, y) => (num(y.valueB) ?? -Infinity) - (num(x.valueB) ?? -Infinity) || byIso3(x, y));
    case 'rankA-asc':
      return copy.sort((x, y) => (x.rankA ?? Infinity) - (y.rankA ?? Infinity) || byIso3(x, y));
    case 'rankA-desc':
      return copy.sort((x, y) => (y.rankA ?? -Infinity) - (x.rankA ?? -Infinity) || byIso3(x, y));
    case 'rankMid-asc':
      return copy.sort((x, y) => (x.rankMid ?? Infinity) - (y.rankMid ?? Infinity) || byIso3(x, y));
    case 'rankMid-desc':
      return copy.sort((x, y) => (y.rankMid ?? -Infinity) - (x.rankMid ?? -Infinity) || byIso3(x, y));
    case 'rankB-asc':
      return copy.sort((x, y) => (x.rankB ?? Infinity) - (y.rankB ?? Infinity) || byIso3(x, y));
    case 'rankB-desc':
      return copy.sort((x, y) => (y.rankB ?? -Infinity) - (x.rankB ?? -Infinity) || byIso3(x, y));
    case 'valueA-desc':
    default:
      return copy.sort((x, y) => (num(y.valueA) ?? -Infinity) - (num(x.valueA) ?? -Infinity) || byIso3(x, y));
  }
}

function ThreeYearResults({ data }) {
  const fm = data.focusMovement;
  const u = data.universe;
  const y = data.years;
  // Tab selection remembers its year so a config change that removes that
  // year falls back to All (render-phase adjustment, no effect needed).
  const comparisonKey = `${y.a}|${y.mid}|${y.b}|${data.metric.indicatorCode}`;
  const [tabState, setTabState] = useState({ id: 'all', year: null, key: comparisonKey });
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [outsidePage, setOutsidePage] = useState(1);
  const [listsOpen, setListsOpen] = useState(false);
  const [commonOpen, setCommonOpen] = useState(false);
  const [commonQuery, setCommonQuery] = useState('');
  const [commonRelation, setCommonRelation] = useState('all');
  const [commonSort, setCommonSort] = useState('valueB-desc');
  const [commonPage, setCommonPage] = useState(1);

  // comparisonYears drives every year-aware control below:
  // [start, middle, end] with a middle year, [start, end] without.
  const comparisonYears = [y.a, y.mid, y.b];
  const rows = data.economies?.rows ?? [];
  const commonRows = rows.filter((r) => r.status === 'common');
  const allOutside = rows.filter((r) => r.status !== 'common');
  // All (the full outside-common-set dataset) plus one outside slice per
  // selected year: economies holding a valid observation that year but missing
  // in at least one of the other two selected years. Tab counts come from the
  // backend decomposition before any presentation-only search/filter.
  const outsideTabs = [
    { id: 'all', year: null, label: 'All', count: u.outside, rows: allOutside },
    { id: 'outA', year: y.a, label: `Outside in ${y.a}`, count: u.outsideInA, rows: rows.filter((r) => r.status !== 'common' && r.presentInA) },
    { id: 'outMid', year: y.mid, label: `Outside in ${y.mid}`, count: u.outsideInMid, rows: rows.filter((r) => r.status !== 'common' && r.presentInMid) },
    { id: 'outB', year: y.b, label: `Outside in ${y.b}`, count: u.outsideInB, rows: rows.filter((r) => r.status !== 'common' && r.presentInB) },
  ];
  let outsideTab = tabState.id;
  if (tabState.key !== comparisonKey) {
    const stillValid = tabState.id === 'all' || comparisonYears.includes(tabState.year);
    outsideTab = stillValid ? tabState.id : 'all';
    setTabState({ id: outsideTab, year: stillValid ? tabState.year : null, key: comparisonKey });
    setOutsidePage(1);
  }
  const selectTab = (t) => {
    setTabState({ id: t.id, year: t.year, key: comparisonKey });
    setOutsidePage(1);
  };
  const activeTab = outsideTabs.find((t) => t.id === outsideTab) ?? outsideTabs[0];
  const tabSuffix = activeTab.id === 'outA' ? 'A' : activeTab.id === 'outMid' ? 'Mid' : activeTab.id === 'outB' ? 'B' : null;

  const filteredList = (() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (r) =>
      !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q);
    // Relation and effect are decided by ranking position, never by raw-value
    // comparison: the tab year's backend per-year fields, or the backend
    // overall fields on the All tab.
    const matchesRelation = (r) => {
      if (relationFilter === 'all') return true;
      if (tabSuffix) {
        if (relationFilter === 'above') return r[`relationToFocus${tabSuffix}`] === 'above';
        if (relationFilter === 'below') return r[`relationToFocus${tabSuffix}`] === 'below';
        if (relationFilter === 'affects') return r[`affectsFocusPosition${tabSuffix}`] === true;
        return true;
      }
      if (relationFilter === 'above') return r.relationToFocus === 'above';
      if (relationFilter === 'below') return r.relationToFocus === 'below';
      if (relationFilter === 'affects') return r.affectsFocusPosition === true;
      return true;
    };
    const filtered = activeTab.rows.filter((r) => matchesQuery(r) && matchesRelation(r));
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(1, outsidePage), pages);
    return { filtered, page, pages, pageSize, slice: filtered.slice((page - 1) * pageSize, page * pageSize) };
  })();

  const filteredCommon = (() => {
    const q = commonQuery.trim().toLowerCase();
    const searched = commonRows.filter(
      (r) => !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q),
    );
    // Relation filter uses the backend-provided yearly relations, so an
    // economy above India in one year and below in another stays explicit.
    const related = searched.filter((r) => matchesCommonRelation(r, commonRelation));
    const sorted = sortCommonRows(related, commonSort);
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, commonPage), pages);
    return { base: sorted, page, pages, pageSize, slice: sorted.slice((page - 1) * pageSize, page * pageSize) };
  })();

  return (
    <>
      <h3 className="subhead">What happened to India&apos;s position number?</h3>
      <SummaryCards3 data={data} />
      <div className="explanation" role="note" aria-label="Result in words">
        <StorySentence3 data={data} />
      </div>
      <p className="footnote">
        Position numbers: lower is a higher place. Denominators count {data.universe.membershipRule}: #
        {fm.fullRankA}/{fm.denominatorA} in {y.a}, #{fm.fullRankMid}/{fm.denominatorMid} in {y.mid} and #
        {fm.fullRankB}/{fm.denominatorB} in {y.b}.
      </p>

      <h3 className="subhead">Like-for-like comparison</h3>
      <p className="section-sub">
        {u.common} economies have valid observations in {y.a}, {y.mid} and {y.b}.
      </p>
      <div className="duo" role="group" aria-label={`Like-for-like comparison, ${u.common} economies observed in all three years`}>
        <div className="duo-box">
          <span className="duo-year">Start · {y.a}</span>
          <span className="duo-rank">
            #{fm.commonRankA} / {fm.denominatorCommon}
          </span>
        </div>
        <span className="duo-arrow" aria-hidden="true">
          →
        </span>
        <div className="duo-box">
          <span className="duo-year">Middle year · {y.mid}</span>
          <span className="duo-rank">
            #{fm.commonRankMid} / {fm.denominatorCommon}
          </span>
        </div>
        <span className="duo-arrow" aria-hidden="true">
          →
        </span>
        <div className="duo-box">
          <span className="duo-year">End · {y.b}</span>
          <span className="duo-rank">
            #{fm.commonRankB} / {fm.denominatorCommon}
          </span>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>
            {y.a} → {y.mid} · common movement
          </dt>
          <dd className="num">
            {formatSigned(fm.commonEffectAM)} positions ({signMeaning(fm.commonEffectAM)})
          </dd>
        </div>
        <div>
          <dt>
            {y.mid} → {y.b} · common movement
          </dt>
          <dd className="num">
            {formatSigned(fm.commonEffectMB)} positions ({signMeaning(fm.commonEffectMB)})
          </dd>
        </div>
        <div>
          <dt>
            {y.a} → {y.b} · common movement
          </dt>
          <dd className="num">
            {formatSigned(fm.commonEffect)} positions ({signMeaning(fm.commonEffect)})
          </dd>
        </div>
      </dl>
      <p>
        These {u.common} economies are the only economies used to calculate the like-for-like movement. All
        three positions use the same comparison population.
      </p>
      <p className="footnote">
        <strong>Derived comparison positions — not World Bank ranks.</strong> Common comparison positions rank
        India only among the economies observed in all three years, with the same ordering rule. They are
        neither official ranks nor observed-year ranks.
      </p>
      <p className="footnote">The other economies shown below are outside this three-year common comparison set.</p>

      <h3 className="subhead">What changed outside the common comparison set?</h3>
      <p>
        Economies outside the three-year common set are missing in at least one of {y.a}, {y.mid} or {y.b}.
        They explain the difference between each full observed population and the shared common universe.
      </p>
      <div className="partition" role="group" aria-label="Observed-set partitions">
        {[
          { year: y.a, set: u.setA, out: u.outsideInA, label: 'outside in this year' },
          { year: y.mid, set: u.setMid, out: u.outsideInMid, label: 'outside in this year' },
          { year: y.b, set: u.setB, out: u.outsideInB, label: 'outside in this year' },
        ].map((row) => (
          <div className="partition-row" key={row.year}>
            <span className="partition-year">{row.year} observed set</span>
            <span className="partition-bar" aria-label={`${row.year} observed set: ${u.common} common plus ${row.out} outside equals ${row.set}`}>
              <span className="partition-common">{u.common} common</span>
              <span className="partition-delta">
                {row.out} {row.label}
              </span>
            </span>
            <span className="partition-total num">
              {row.set} = {u.common} + {row.out}
            </span>
          </div>
        ))}
      </div>
      <p className="footnote">
        Common means the same member economies in all three years. Outside means missing in at least one
        selected year.
      </p>

      <h3 className="subhead">Outside-common-set economies above India</h3>
      <dl className="facts">
        <div>
          <dt>Above India in {y.a}</dt>
          <dd className="num">{fm.outsideAboveA}</dd>
        </div>
        <div>
          <dt>Above India in {y.mid}</dt>
          <dd className="num">{fm.outsideAboveMid}</dd>
        </div>
        <div>
          <dt>Above India in {y.b}</dt>
          <dd className="num">{fm.outsideAboveB}</dd>
        </div>
        <div>
          <dt>Observed-set effect {y.a}→{y.mid}</dt>
          <dd className="num">
            {formatSigned(fm.observedSetEffectAM)} positions ({signMeaning(fm.observedSetEffectAM)})
          </dd>
        </div>
        <div>
          <dt>Observed-set effect {y.mid}→{y.b}</dt>
          <dd className="num">
            {formatSigned(fm.observedSetEffectMB)} positions ({signMeaning(fm.observedSetEffectMB)})
          </dd>
        </div>
        <div>
          <dt>Observed-set effect {y.a}→{y.b}</dt>
          <dd className="num">
            {formatSigned(fm.observedSetEffect)} positions ({signMeaning(fm.observedSetEffect)})
          </dd>
        </div>
      </dl>

      <h3 className="subhead">Rank-movement decomposition (same universe throughout)</h3>
      <dl className="facts">
        <div>
          <dt>
            {y.a}→{y.mid}: full = common + outside
          </dt>
          <dd className="num mono">
            {formatSigned(fm.positionNumberChangeAM)} = {formatSigned(fm.commonEffectAM)} + {formatSigned(fm.observedSetEffectAM)}
          </dd>
        </div>
        <div>
          <dt>
            {y.mid}→{y.b}: full = common + outside
          </dt>
          <dd className="num mono">
            {formatSigned(fm.positionNumberChangeMB)} = {formatSigned(fm.commonEffectMB)} + {formatSigned(fm.observedSetEffectMB)}
          </dd>
        </div>
        <div>
          <dt>
            {y.a}→{y.b}: full = common + outside
          </dt>
          <dd className="num mono">
            {formatSigned(fm.positionNumberChange)} = {formatSigned(fm.commonEffect)} + {formatSigned(fm.observedSetEffect)}
          </dd>
        </div>
      </dl>
      <div className="explanation" role="note" aria-label={fm.identityText ?? 'Decomposition'}>
        <p className="mono footnote">Backend verification: {fm.identityText}</p>
        <p>
          Each segment uses the same {u.common}-economy universe. Common-set movement is change among the
          same economies; outside-common-set effect is the effect of economies outside Common entering or
          exiting each full observed set above India.
        </p>
      </div>

      <h3 className="subhead">Economies outside the common comparison set</h3>
      <p>
        The tables below list only economies outside the common comparison set. They are a different
        population from the {u.common} common economies above. Each tab shows one selected year&apos;s
        outside slice — economies with a valid observation that year but missing in at least one of the
        other two selected years.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setListsOpen((v) => !v)}
        aria-expanded={listsOpen}
      >
        {listsOpen
          ? 'Hide outside economy details'
          : `Show outside economy details (outside ${u.outside})`}
      </button>
      {listsOpen ? (
        <>
          <div role="tablist" aria-label="Outside the common set in each selected year">
            {outsideTabs.flatMap((t, index) => [
              ...(index > 0 ? [' '] : []),
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={outsideTab === t.id}
                aria-label={
                  t.id === 'all'
                    ? `All economies outside the common comparison set, ${t.count} economies`
                    : `${t.label} the common comparison set, ${t.count} economies`
                }
                className={`btn ${outsideTab === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => selectTab(t)}
              >
                {t.label} ({t.count})
              </button>,
            ])}
          </div>
          <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Outside filters">
            <Field label="Search name or ISO3" htmlFor="mv3-q">
              <input
                id="mv3-q"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOutsidePage(1);
                }}
                placeholder="e.g. India, IND"
              />
            </Field>
            <Field label="Relation filter" htmlFor="mv3-rel">
              <select
                id="mv3-rel"
                value={relationFilter}
                onChange={(e) => {
                  setRelationFilter(e.target.value);
                  setOutsidePage(1);
                }}
              >
                <option value="all">All</option>
                <option value="above">Above India</option>
                <option value="below">Below India</option>
                <option value="affects">Affects India&apos;s position</option>
              </select>
            </Field>
          </form>
          <p className="footnote">Filtering is presentation-only. The decomposition always uses the full universe.</p>
          <EconomyTable
            rows={filteredList.slice}
            yearA={y.a}
            yearB={y.b}
            yearMid={y.mid}
            focusYear={activeTab.year}
            serialBase={(filteredList.page - 1) * filteredList.pageSize}
            caption={
              activeTab.id === 'all'
                ? `All economies outside the common comparison set for ${data.metric.indicatorCode}, ${y.a} to ${y.mid} to ${y.b}`
                : `Economies outside the common set in ${activeTab.year} for ${data.metric.indicatorCode}, ${y.a} to ${y.mid} to ${y.b}`
            }
          />
          <p className="footnote" aria-live="polite">
            Showing {filteredList.slice.length} of {activeTab.count} ({activeTab.label}) · page{' '}
            {filteredList.page} of {filteredList.pages}
          </p>
          <div className="pagination" role="navigation" aria-label="Outside pages">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredList.page <= 1}
              onClick={() => setOutsidePage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredList.page >= filteredList.pages}
              onClick={() => setOutsidePage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : null}

      <h3 className="subhead">
        {u.common} economies in the common comparison set
      </h3>
      <p>
        Every economy in this table has a valid observation in {y.a}, {y.mid} and {y.b}. This is a completely
        different population from the outside economies above.
      </p>
      <p className="footnote">
        The summary and decomposition above are already complete. Open this only to inspect the like-for-like
        economies.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setCommonOpen((v) => !v)}
        aria-expanded={commonOpen}
      >
        {commonOpen ? 'Hide common economies' : `Show common economies (${u.common})`}
      </button>
      {commonOpen ? (
        <>
          <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Common filters">
            <Field label="Search common" htmlFor="mv3-cq">
              <input
                id="mv3-cq"
                type="search"
                value={commonQuery}
                onChange={(e) => {
                  setCommonQuery(e.target.value);
                  setCommonPage(1);
                }}
                placeholder="e.g. United, USA"
              />
            </Field>
            <Field label="Relation to India" htmlFor="mv3-crel">
              <select
                id="mv3-crel"
                value={commonRelation}
                onChange={(e) => {
                  setCommonRelation(e.target.value);
                  setCommonPage(1);
                }}
              >
                {commonRelationOptions(comparisonYears).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sort by" htmlFor="mv3-csort">
              <select id="mv3-csort" value={commonSort} onChange={(e) => setCommonSort(e.target.value)}>
                {commonSortOptions(comparisonYears).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </form>
          <p className="footnote">
            Sorting uses backend raw values and ranks. It never changes the comparison summary above.
          </p>
          <CommonTable
            rows={filteredCommon.slice}
            yearA={y.a}
            yearB={y.b}
            yearMid={y.mid}
            serialBase={(filteredCommon.page - 1) * filteredCommon.pageSize}
            caption={`Common comparison-set economies for ${data.metric.indicatorCode}, ${y.a} to ${y.mid} to ${y.b}`}
          />
          <p className="footnote" aria-live="polite">
            Showing {filteredCommon.slice.length} of {u.common} · page {filteredCommon.page} of{' '}
            {filteredCommon.pages}
          </p>
          <div className="pagination" role="navigation" aria-label="Common pages">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredCommon.page <= 1}
              onClick={() => setCommonPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredCommon.page >= filteredCommon.pages}
              onClick={() => setCommonPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : null}

      <h3 className="subhead">Evidence &amp; provenance</h3>
      <details className="details">
        <summary>Evidence &amp; provenance (vintage, runs, counters, limits)</summary>
        <dl className="facts">
          <div>
            <dt>World Bank vintage</dt>
            <dd className="mono">{data.evidence.vintage.wbLastUpdated ?? 'mixed/unknown'}</dd>
          </div>
          <div>
            <dt>Mixed vintage</dt>
            <dd>{data.evidence.vintage.mixedVintage ? 'Yes — interpret with caution' : 'No'}</dd>
          </div>
          <div>
            <dt>Producing runs</dt>
            <dd className="mono">
              A: {data.evidence.retrieval.runIdA ?? '—'} · MID: {data.evidence.retrieval.runIdMid ?? '—'} · B:{' '}
              {data.evidence.retrieval.runIdB ?? '—'}
            </dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd className="mono">
              run {data.evidence.fingerprint.runId ?? '—'} · {data.evidence.fingerprint.observationCount} observations
            </dd>
          </div>
          <div>
            <dt>Denominator explanation</dt>
            <dd>{data.denominatorExplanation?.explanation?.statement ?? data.denominatorExplanation?.statement ?? '—'}</dd>
          </div>
        </dl>
        <h4 className="subhead">Limits (what is not established)</h4>
        <ul>
          {(data.evidence.limits ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="footnote">
          Metric: {data.metric?.title ?? ''} ({data.metric?.indicatorCode}) · {data.metric?.unit}. Ranks calculated by
          this application from World Bank observations.
        </p>
      </details>
    </>
  );
}

/**
 * YoY % growth mode helpers and results.
 *
 * Display-only: every growth value, rank, average, difference, count and
 * sentence comes from GET /api/comparison/level&mode=yoy. Client-side
 * search/filter/sort/pagination never recalculates growth or averages.
 * Ranking variable is ALWAYS growthPercent; absolute change and level values
 * are context and never influence rank, sort-by-growth, relations or counts.
 */

/** Short label for one growth interval, e.g. "2004→2014". */
function growthIntervalLabel(g) {
  if (!g) return '—';
  return `${g.startYear}→${g.endYear}`;
}

/** Interval descriptors (key + label) from a growth response, in AM/MB/AB order. */
function growthIntervalsOf(data) {
  const keys = data?.universe?.intervals ?? ['AB'];
  const growth = data?.focusMovement?.growth ?? {};
  return keys
    .map((key) => ({ key, block: growth[key] ?? null }))
    .filter((entry) => entry.block !== null)
    .map((entry) => ({ ...entry, label: growthIntervalLabel(entry.block) }));
}

function GrowthDetails({ r, intervals }) {
  return (
    <details className="details">
      <summary>Details</summary>
      <dl className="facts">
        <div>
          <dt>ISO3</dt>
          <dd className="mono">{r.iso3}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{r.status}</dd>
        </div>
        {(intervals ?? []).map(({ key, label }) => {
          const b = r.intervals?.[key];
          if (!b) return null;
          return (
            <div key={key}>
              <dt>Growth {label}</dt>
              <dd className="num">
                {b.valid
                  ? `${b.growthDisplay} (rank ${b.obsRank} observed / ${b.commonRank ?? '—'} like-for-like; ${b.startDisplay} → ${b.endDisplay}; abs ${b.absoluteDisplay})`
                  : `n/a (${b.reasonText ?? b.reason ?? 'no calculable growth'})`}
              </dd>
            </div>
          );
        })}
        <div>
          <dt>Raw start/end</dt>
          <dd className="mono">
            {(intervals ?? [])
              .map(({ key, label }) => {
                const b = r.intervals?.[key];
                return b && b.valid ? `${label}: ${b.startValue} → ${b.endValue}` : null;
              })
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{r.region ?? '—'}</dd>
        </div>
        <div>
          <dt>Income level</dt>
          <dd>{r.incomeLevel ?? '—'}</dd>
        </div>
        <div>
          <dt>Lending type</dt>
          <dd>{r.lendingType ?? '—'}</dd>
        </div>
        <div>
          <dt>Metadata note</dt>
          <dd>{r.metadataVintageNote}</dd>
        </div>
      </dl>
    </details>
  );
}

/**
 * Outside/excluded table in growth mode. Columns are per displayed interval
 * (the active tab's interval, or every interval on the All tab):
 * growth %, absolute change, observed growth rank, relation and effect.
 * Level values live in Details; ranks come only from growthPercent.
 */
function GrowthEconomyTable({ rows, intervals, activeInterval = null, caption, serialBase = 0 }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  const shown = activeInterval ? [activeInterval] : intervals;
  const presenceOf = (r) =>
    (intervals ?? [])
      .filter(({ key }) => r.intervals?.[key]?.valid === true)
      .map(({ label }) => label)
      .join(' · ') || '—';
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            <th scope="col">Present in</th>
            <th scope="col">Relation to India{activeInterval ? ` in ${activeInterval.label}` : ''}</th>
            {shown.map(({ key, label }) => (
              <th key={`g-${key}`} scope="col" className="num">
                Growth {label}
              </th>
            ))}
            {shown.map(({ key, label }) => (
              <th key={`a-${key}`} scope="col" className="num">
                Abs change {label}
              </th>
            ))}
            {activeInterval ? (
              <th scope="col" className="num">
                Growth rank in {activeInterval.label}
              </th>
            ) : null}
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rel = activeInterval
              ? (r.intervals?.[activeInterval.key]?.relObs ?? r.relationToFocus)
              : r.relationToFocus;
            return (
              <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
                <td className="num">{serialBase + i + 1}</td>
                <th scope="row">
                  {r.name ?? r.iso3}
                  {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                  <GrowthDetails r={r} intervals={intervals} />
                </th>
                <td className="mono">{r.iso3}</td>
                <td>{presenceOf(r)}</td>
                <td>{rel}</td>
                {shown.map(({ key }) => (
                  <td key={`g-${key}`} className="num">
                    {r.intervals?.[key]?.growthDisplay ?? '—'}
                  </td>
                ))}
                {shown.map(({ key }) => (
                  <td key={`a-${key}`} className="num">
                    {r.intervals?.[key]?.absoluteDisplay ?? '—'}
                  </td>
                ))}
                {activeInterval ? (
                  <td className="num">{r.intervals?.[activeInterval.key]?.obsRank ?? '—'}</td>
                ) : null}
                <td>{r.positionEffect === 'affects_position' ? 'Affects position' : 'Denominator only'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Like-for-like growth table. One shared universe ranked per interval:
 * growth %, absolute change, start/middle/end level values and the
 * like-for-like relation per interval. No Effect column (fixed population).
 */
function GrowthCommonTable({ rows, intervals, yearA, yearB, yearMid = null, caption, serialBase = 0 }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  const levelYears = yearMid != null ? [yearA, yearMid, yearB] : [yearA, yearB];
  const levelOf = (r, y) => {
    if (y === yearA) return r.displayA;
    if (y === yearB) return r.displayB;
    return r.displayMid;
  };
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Common economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            {intervals.map(({ key, label }) => (
              <th key={`g-${key}`} scope="col" className="num">
                Growth {label}
              </th>
            ))}
            {intervals.map(({ key, label }) => (
              <th key={`a-${key}`} scope="col" className="num">
                Abs change {label}
              </th>
            ))}
            {levelYears.map((y) => (
              <th key={`v-${y}`} scope="col" className="num">
                {y} value
              </th>
            ))}
            {intervals.map(({ key, label }) => (
              <th key={`vs-${key}`} scope="col">
                {label} vs India
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
              <td className="num">{serialBase + i + 1}</td>
              <th scope="row">
                {r.name ?? r.iso3}
                {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                <GrowthDetails r={r} intervals={intervals} />
              </th>
              <td className="mono">{r.iso3}</td>
              {intervals.map(({ key }) => (
                <td key={`g-${key}`} className="num">
                  {r.intervals?.[key]?.growthDisplay ?? '—'}
                </td>
              ))}
              {intervals.map(({ key }) => (
                <td key={`a-${key}`} className="num">
                  {r.intervals?.[key]?.absoluteDisplay ?? '—'}
                </td>
              ))}
              {levelYears.map((y) => (
                <td key={`v-${y}`} className="num">
                  {levelOf(r, y) ?? '—'}
                </td>
              ))}
              {intervals.map(({ key }) => (
                <td key={`vs-${key}`}>{r.intervals?.[key]?.relCommon ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Relation filter predicate for growth tables (growth positions only). */
function matchesGrowthRelation(r, filter, intervals, which = 'common') {
  const relOf = (key) =>
    which === 'common' ? r.intervals?.[key]?.relCommon : r.intervals?.[key]?.relObs;
  const rels = (intervals ?? [])
    .map(({ key }) => relOf(key))
    .filter((v) => v === 'above' || v === 'below');
  const byKey = (key, want) => relOf(key) === want;
  switch (filter) {
    case 'all':
      return true;
    case 'aboveAll':
      return rels.length > 0 && rels.every((v) => v === 'above');
    case 'belowAll':
      return rels.length > 0 && rels.every((v) => v === 'below');
    case 'crossed': {
      return new Set(rels).size > 1;
    }
    default:
      if (filter.startsWith('above:')) return byKey(filter.slice('above:'.length), 'above');
      if (filter.startsWith('below:')) return byKey(filter.slice('below:'.length), 'below');
      return true;
  }
}

/** Relation-filter options derived from the growth intervals. */
function growthRelationOptions(intervals) {
  const options = [{ value: 'all', label: 'All' }];
  for (const { key, label } of intervals ?? []) {
    options.push({ value: `above:${key}`, label: `Above India in ${label}` });
    options.push({ value: `below:${key}`, label: `Below India in ${label}` });
  }
  options.push({ value: 'aboveAll', label: 'Above India in all intervals' });
  options.push({ value: 'belowAll', label: 'Below India in all intervals' });
  options.push({ value: 'crossed', label: 'Crossed India between intervals' });
  return options;
}

/** Sort options for growth tables: growth %, growth rank, absolute change. */
function growthSortOptions(intervals) {
  const options = [];
  for (const { key, label } of intervals ?? []) {
    options.push({ value: `growth:${key}:desc`, label: `Growth ${label} — high to low` });
    options.push({ value: `growth:${key}:asc`, label: `Growth ${label} — low to high` });
  }
  for (const { key, label } of intervals ?? []) {
    options.push({ value: `rank:${key}:asc`, label: `Growth rank ${label} — best first` });
    options.push({ value: `rank:${key}:desc`, label: `Growth rank ${label} — lowest first` });
  }
  for (const { key, label } of intervals ?? []) {
    options.push({ value: `abs:${key}:desc`, label: `Absolute change ${label} — high to low` });
    options.push({ value: `abs:${key}:asc`, label: `Absolute change ${label} — low to high` });
  }
  return options;
}

/**
 * Sort with backend semantics: growth percent, like-for-like growth rank and
 * absolute change sort by backend numerics (never display strings); ties keep
 * backend order via ISO3. Absolute change is explicitly named and never
 * masquerades as growth ranking.
 */
function sortGrowthRows(rows, sort) {
  const copy = [...rows];
  const byIso3 = (x, y) => (x.iso3 < y.iso3 ? -1 : x.iso3 > y.iso3 ? 1 : 0);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const m = /^(growth|rank|abs):(AM|MB|AB):(asc|desc)$/.exec(sort ?? '');
  if (!m) {
    return copy.sort(
      (x, y) => (num(y.intervals?.AB?.growthPercent) ?? -Infinity) - (num(x.intervals?.AB?.growthPercent) ?? -Infinity) || byIso3(x, y),
    );
  }
  const [, kind, key, dir] = m;
  const val = (r) => {
    const b = r.intervals?.[key];
    if (!b) return null;
    if (kind === 'growth') return num(b.growthPercent);
    if (kind === 'abs') return num(b.absoluteChange);
    return typeof b.commonRank === 'number' ? b.commonRank : null;
  };
  const asc = dir === 'asc';
  return copy.sort((x, y) => {
    const vx = val(x);
    const vy = val(y);
    if (vx === null && vy === null) return byIso3(x, y);
    if (vx === null) return 1;
    if (vy === null) return -1;
    return (asc ? vx - vy : vy - vx) || byIso3(x, y);
  });
}

function GrowthPeerLines({ iv }) {
  const peerLine = (avgDisplay, count, scope) => (
    <div>
      <dt>
        {scope} peer average (excluding India)
      </dt>
      <dd className="num">
        {avgDisplay != null ? (
          <>
            {avgDisplay} ({count} {count === 1 ? 'peer' : 'peers'})
          </>
        ) : (
          'n/a (no other economies with calculable growth)'
        )}
      </dd>
    </div>
  );
  const diffLine = (diffDisplay, scope) => (
    <div>
      <dt>{scope} difference</dt>
      <dd className="num">{diffDisplay != null ? diffDisplay : 'n/a'}</dd>
    </div>
  );
  return (
    <>
      <h4 className="facts-group-title">Observed</h4>
      <dl className="facts">
        {peerLine(iv.peerAvgObservedDisplay, iv.peerCountObserved, 'Observed')}
        {diffLine(iv.vsPeerObservedDisplay, 'Observed')}
      </dl>
      <h4 className="facts-group-title">Like-for-like</h4>
      <dl className="facts">
        {peerLine(iv.peerAvgCommonDisplay, iv.peerCountCommon, 'Like-for-like')}
        {diffLine(iv.vsPeerCommonDisplay, 'Like-for-like')}
      </dl>
      <p className="footnote">
        Peer average (excluding India) is an unweighted mean of peer growth values. Differences are
        percentage-point subtractions and never affect ranking.
      </p>
    </>
  );
}

function GrowthIntervalCard({ iv, metric }) {
  if (!iv || !iv.available) {
    return (
      <div className="card">
        <h3>
          Growth {iv ? growthIntervalLabel(iv) : '—'} <span className="card-unit">unavailable</span>
        </h3>
        <p className="card-rank">n/a</p>
        <p className="card-unit">{iv?.reasonText ?? iv?.reason ?? 'Decomposition unavailable.'}</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>
        Growth {growthIntervalLabel(iv)} <span className="card-unit">YoY % growth</span>
      </h3>
      <p className="card-rank" aria-label={`India growth ${iv.indiaGrowthDisplay} in ${growthIntervalLabel(iv)}`}>
        {iv.indiaGrowthDisplay ?? 'n/a'}
      </p>
      <p className="card-unit">
        Per-capita: {iv.startDisplay ?? '—'} → {iv.endDisplay ?? '—'}
      </p>
      <p className="card-unit">Absolute change: {iv.absoluteDisplay ?? 'n/a'}</p>
      <p className="card-unit">
        Growth rank: {iv.fullGrowthRank != null ? `#${iv.fullGrowthRank} / ${iv.denominatorObserved}` : 'n/a'}{' '}
        (observed)
      </p>
      <p className="card-unit">
        Like-for-like: {iv.commonGrowthRank != null ? `#${iv.commonGrowthRank} / ${iv.denominatorCommon}` : 'n/a'}
      </p>
      <p className="card-code mono">
        {metric.indicatorCode} · {metric.unit}
      </p>
    </div>
  );
}

function GrowthStory({ data, intervals }) {
  const growth = data.focusMovement?.growth ?? {};
  const parts = (intervals ?? [])
    .map(({ key }) => growth[key])
    .filter((iv) => iv && iv.available)
    .map((iv) => `${growthIntervalLabel(iv)} ${iv.indiaGrowthDisplay} (growth rank #${iv.fullGrowthRank}/${iv.denominatorObserved})`);
  if (parts.length === 0) return null;
  return (
    <div>
      <p>
        India&apos;s per-capita growth by interval: {parts.join(' · ')}. Ranks order economies by growth
        percentage alone; absolute per-capita change never affects rank.
      </p>
      <p>
        Like-for-like growth ranks use one shared universe of {data.universe.common} economies with calculable
        growth in every interval shown.
      </p>
    </div>
  );
}

function GrowthResults({ data }) {
  const u = data.universe;
  const y = data.years;
  const metric = data.metric;
  const growth = data.focusMovement?.growth ?? {};
  const intervals = growthIntervalsOf(data);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [commonOpen, setCommonOpen] = useState(false);
  const [commonQuery, setCommonQuery] = useState('');
  const [commonRelation, setCommonRelation] = useState('all');
  const [commonSort, setCommonSort] = useState(
    intervals.length > 0 ? `growth:${intervals[intervals.length - 1].key}:desc` : 'growth:AB:desc',
  );
  const [commonPage, setCommonPage] = useState(1);
  const [listPage, setListPage] = useState(1);
  const [listsOpen, setListsOpen] = useState(false);

  const rows = data.economies?.rows ?? [];
  const commonRows = rows.filter((r) => r.status === 'common');
  const allOutside = rows.filter((r) => r.status !== 'common');
  // Outside tabs: All plus one tab per growth interval. Tab counts come from
  // the backend decomposition before any presentation-only search/filter.
  const outsideTabs = [
    { id: 'all', label: 'All', count: allOutside.length, rows: allOutside, interval: null },
    ...intervals.map(({ key, label }) => ({
      id: `out:${key}`,
      label: `Outside ${label}`,
      count: u[key]?.outside ?? 0,
      rows: allOutside.filter((r) => r.intervals?.[key]?.valid === true),
      interval: { key, label },
    })),
  ];
  const activeTab = outsideTabs.find((t) => t.id === tab) ?? outsideTabs[0];

  const filteredList = (() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (r) =>
      !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q);
    // Relation and effect follow growth-ranking position in the tab interval
    // (or the backend overall fields on the All tab) — never level values.
    const matchesRelation = (r) => {
      if (relationFilter === 'all') return true;
      if (activeTab.interval) {
        const b = r.intervals?.[activeTab.interval.key];
        if (relationFilter === 'above') return b?.relObs === 'above';
        if (relationFilter === 'below') return b?.relObs === 'below';
        if (relationFilter === 'affects') return b?.affectsObs === true;
        return true;
      }
      if (relationFilter === 'above') return r.relationToFocus === 'above';
      if (relationFilter === 'below') return r.relationToFocus === 'below';
      if (relationFilter === 'affects') return r.affectsFocusPosition === true;
      return true;
    };
    const filtered = activeTab.rows.filter((r) => matchesQuery(r) && matchesRelation(r));
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(1, listPage), pages);
    return { filtered, page, pages, pageSize, slice: filtered.slice((page - 1) * pageSize, page * pageSize) };
  })();

  const filteredCommon = (() => {
    const q = commonQuery.trim().toLowerCase();
    const searched = commonRows.filter(
      (r) => !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q),
    );
    // Relation filter uses backend like-for-like growth relations per
    // interval, so an economy above India in one interval and below in
    // another stays explicit.
    const related = searched.filter((r) => matchesGrowthRelation(r, commonRelation, intervals, 'common'));
    const sorted = sortGrowthRows(related, commonSort);
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, commonPage), pages);
    return { base: sorted, page, pages, pageSize, slice: sorted.slice((page - 1) * pageSize, page * pageSize) };
  })();

  return (
    <>
      <h3 className="subhead">What happened to India&apos;s growth?</h3>
      <div className="cards" role="region" aria-label="India growth by interval">
        {intervals.map(({ key }) => (
          <GrowthIntervalCard key={key} iv={growth[key]} metric={metric} />
        ))}
      </div>
      {intervals.map(({ key }) => {
        const iv = growth[key];
        if (!iv || !iv.available) return null;
        return (
          <div key={key} className="explanation" role="note" aria-label={`Result in words for ${growthIntervalLabel(iv)}`}>
            <GrowthPeerLines iv={iv} />
            <p className="mono footnote">Backend verification: {iv.identityText}</p>
          </div>
        );
      })}
      <div className="explanation" role="note" aria-label="Growth story">
        <GrowthStory data={data} intervals={intervals} />
      </div>
      <p className="footnote">
        Growth ranks order economies by growth percentage alone (rank 1 is the highest growth). Denominators
        count {u.membershipRule}.
      </p>

      <h3 className="subhead">Like-for-like comparison</h3>
      <p className="section-sub">
        {u.common} economies have calculable growth in every interval shown. Each interval&apos;s like-for-like
        growth ranking uses this same universe.
      </p>
      {u.intervals?.length === 1 ? (
        <p>
          With a single interval the observed and like-for-like growth populations coincide; both growth ranks
          describe the same population and are therefore equal.
        </p>
      ) : null}
      <p className="footnote">
        <strong>Derived comparison position — not a World Bank rank.</strong> Like-for-like growth positions
        rank India only among the economies with calculable growth in every interval, ordered by growth
        percentage. They are neither official ranks nor observed-year ranks.
      </p>
      <p className="footnote">The other economies shown below are outside this like-for-like growth universe.</p>

      <h3 className="subhead">Economies outside the like-for-like growth universe</h3>
      <p>
        The tables below list only economies outside the like-for-like growth universe: economies with
        calculable growth in at least one interval but missing it in another, or without calculable growth
        where shown. They are a different population from the {u.common} like-for-like economies.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setListsOpen((v) => !v)}
        aria-expanded={listsOpen}
      >
        {listsOpen
          ? 'Hide outside economy details'
          : `Show outside economy details (outside ${allOutside.length})`}
      </button>
      {listsOpen ? (
        <>
          <div role="tablist" aria-label="Outside the like-for-like growth universe">
            {outsideTabs.flatMap((t, index) => [
              ...(index > 0 ? [' '] : []),
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-label={`${t.label} the like-for-like growth universe, ${t.count} economies`}
                className={`btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab(t.id);
                  setListPage(1);
                }}
              >
                {t.label} ({t.count})
              </button>,
            ])}
          </div>
          <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Outside growth filters">
            <Field label="Search name or ISO3" htmlFor="mv-gq">
              <input
                id="mv-gq"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListPage(1);
                }}
                placeholder="e.g. India, IND"
              />
            </Field>
            <Field label="Relation filter" htmlFor="mv-grel">
              <select
                id="mv-grel"
                value={relationFilter}
                onChange={(e) => {
                  setRelationFilter(e.target.value);
                  setListPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="above">Above India</option>
                <option value="below">Below India</option>
                <option value="affects">Affects India&apos;s position</option>
              </select>
            </Field>
          </form>
          <p className="footnote">Filtering is presentation-only. The decomposition always uses the full universe.</p>
          <GrowthEconomyTable
            rows={filteredList.slice}
            intervals={intervals}
            activeInterval={activeTab.interval}
            serialBase={(filteredList.page - 1) * filteredList.pageSize}
            caption={`Economies outside the like-for-like growth universe, ${activeTab.label}`}
          />
          <p className="footnote" aria-live="polite">
            Showing {filteredList.slice.length} of {activeTab.count} ({activeTab.label}) · page{' '}
            {filteredList.page} of {filteredList.pages}
          </p>
          <div className="pagination" role="navigation" aria-label="Outside growth pages">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredList.page <= 1}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredList.page >= filteredList.pages}
              onClick={() => setListPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : null}

      <h3 className="subhead">
        {u.common} economies in the like-for-like growth universe
      </h3>
      <p>
        Every economy in this table has calculable growth in every interval shown. Ranking is by growth
        percentage alone; absolute per-capita change is shown for context and never affects rank.
      </p>
      <p className="footnote">
        The summary above is already complete. Open this only to inspect the like-for-like economies.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setCommonOpen((v) => !v)}
        aria-expanded={commonOpen}
      >
        {commonOpen ? 'Hide common economies' : `Show common economies (${u.common})`}
      </button>
      {commonOpen ? (
        <>
          <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Common growth filters">
            <Field label="Search common" htmlFor="mv-gcq">
              <input
                id="mv-gcq"
                type="search"
                value={commonQuery}
                onChange={(e) => {
                  setCommonQuery(e.target.value);
                  setCommonPage(1);
                }}
                placeholder="e.g. United, USA"
              />
            </Field>
            <Field label="Relation to India" htmlFor="mv-gcrel">
              <select
                id="mv-gcrel"
                value={commonRelation}
                onChange={(e) => {
                  setCommonRelation(e.target.value);
                  setCommonPage(1);
                }}
              >
                {growthRelationOptions(intervals).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sort by" htmlFor="mv-gcsort">
              <select id="mv-gcsort" value={commonSort} onChange={(e) => setCommonSort(e.target.value)}>
                {growthSortOptions(intervals).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </form>
          <p className="footnote">
            Sorting uses backend growth values and growth ranks. Absolute change is labeled explicitly and never
            masquerades as growth ranking. Sorting never changes the comparison summary above.
          </p>
          <GrowthCommonTable
            rows={filteredCommon.slice}
            intervals={intervals}
            yearA={y.a}
            yearB={y.b}
            yearMid={y.mid ?? null}
            serialBase={(filteredCommon.page - 1) * filteredCommon.pageSize}
            caption="Like-for-like growth economies"
          />
          <p className="footnote" aria-live="polite">
            Showing {filteredCommon.slice.length} of {u.common} · page {filteredCommon.page} of{' '}
            {filteredCommon.pages}
          </p>
          <div className="pagination" role="navigation" aria-label="Common growth pages">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredCommon.page <= 1}
              onClick={() => setCommonPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={filteredCommon.page >= filteredCommon.pages}
              onClick={() => setCommonPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : null}

      <h3 className="subhead">Evidence &amp; provenance</h3>
      <details className="details">
        <summary>Evidence &amp; provenance (vintage, runs, counters, limits)</summary>
        <dl className="facts">
          <div>
            <dt>World Bank vintage</dt>
            <dd className="mono">{data.evidence.vintage.wbLastUpdated ?? 'mixed/unknown'}</dd>
          </div>
          <div>
            <dt>Mixed vintage</dt>
            <dd>{data.evidence.vintage.mixedVintage ? 'Yes — interpret with caution' : 'No'}</dd>
          </div>
          <div>
            <dt>Producing runs</dt>
            <dd className="mono">
              A: {data.evidence.retrieval.runIdA ?? '—'}
              {y.mid != null ? ` · MID: ${data.evidence.retrieval.runIdMid ?? '—'}` : ''} · B:{' '}
              {data.evidence.retrieval.runIdB ?? '—'}
            </dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>
              {data.evidence.freshness.fresh ? 'Fresh' : 'Stale/due'} · last success{' '}
              {data.evidence.freshness.lastRunStatus ?? data.evidence.retrieval.lastSuccessAt ?? 'unknown'}
            </dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd className="mono">
              run {data.evidence.fingerprint.runId ?? '—'} · {data.evidence.fingerprint.observationCount}{' '}
              observations
            </dd>
          </div>
          <div>
            <dt>Growth denominators</dt>
            <dd>
              Observed and like-for-like denominators count economies with calculable growth for each interval
              — not World Bank ranks and not level-ranking populations.
            </dd>
          </div>
        </dl>
        <h4 className="subhead">Methodology</h4>
        <dl className="facts">
          {Object.entries(data.comparisonMethodology ?? {}).map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{String(text)}</dd>
            </div>
          ))}
        </dl>
        <h4 className="subhead">Limits (what is not established)</h4>
        <ul>
          {(data.evidence.limits ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="footnote">
          Metric: {data.metric?.title ?? ''} ({data.metric?.indicatorCode}) · {data.metric?.unit}. Growth values,
          ranks, peer averages and percentage-point differences are calculated by this application from World
          Bank observations.
        </p>
      </details>
    </>
  );
}

export default function RankMovement({ availableYears, yearA, yearB, yearMid = null, metricKey, basis = 'level', onYearA, onYearB, onYearMid = null, onMetric, onBasis }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [commonOpen, setCommonOpen] = useState(false);
  const [commonQuery, setCommonQuery] = useState('');
  const [commonRelation, setCommonRelation] = useState('all');
  const [commonSort, setCommonSort] = useState('valueB-desc');
  const [commonPage, setCommonPage] = useState(1);
  const [listPage, setListPage] = useState(1);
  const [listsOpen, setListsOpen] = useState(false);

  const breakerActive = yearMid != null && yearA != null && yearB != null && yearMid > Math.min(yearA, yearB) && yearMid < Math.max(yearA, yearB);
  const growthActive = basis === RANKING_BASIS.GROWTH;
  const enabled = yearA != null && yearB != null && yearA !== yearB && metricKey != null;
  const depsKey = `movement:${metricKey}:${yearA ?? ''}:${yearB ?? ''}:${breakerActive ? yearMid : 'none'}:${growthActive ? 'growth' : 'level'}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.comparisonLevel(
        {
          indicator: metricKey,
          yearA,
          yearB,
          ...(breakerActive ? { yearMid } : {}),
          country: 'IND',
          detail: 'full',
          ...(growthActive ? { mode: 'yoy' } : {}),
        },
        { signal },
      ),
    depsKey,
    { enabled },
  );
  const isThreeYear = breakerActive && data?.years?.mid != null;
  // Backend-driven mode: the response declares its own ranking basis, so the
  // UI can never render growth numbers with level logic or vice versa.
  const isGrowth = data?.comparison?.mode === 'yoy';

  const sameYear = yearA != null && yearB != null && yearA === yearB;
  const empty =
    !loading &&
    !error &&
    !sameYear &&
    data &&
    !data.comparison?.available &&
    (isGrowth
      ? !data.focusMovement?.growth?.AB?.available
      : !data.focusMovement?.fullRankA && !data.focusMovement?.fullRankB);

  const enteredExited = useMemo(() => {
    const rows = data?.economies?.rows ?? [];
    const entered = rows.filter((r) => r.status === 'entered');
    const exited = rows.filter((r) => r.status === 'exited');
    const common = rows.filter((r) => r.status === 'common');
    return { entered, exited, common };
  }, [data]);

  // Outside tabs: All (the full outside-common-set dataset) plus one tab per
  // decomposition group. Tab counts come from the dataset before any
  // presentation-only search/filter; the "Showing" line below reports the
  // currently visible filtered rows against that stable tab count.
  const outsideTabs = useMemo(() => {
    const all = [...enteredExited.entered, ...enteredExited.exited];
    return [
      { id: 'all', label: 'All', count: all.length, rows: all },
      { id: 'entered', label: `Entered in ${data?.years?.b}`, count: enteredExited.entered.length, rows: enteredExited.entered },
      { id: 'exited', label: `Exited from ${data?.years?.a}`, count: enteredExited.exited.length, rows: enteredExited.exited },
    ];
  }, [data, enteredExited]);
  const activeTab = outsideTabs.find((t) => t.id === tab) ?? outsideTabs[0];

  const filteredList = useMemo(() => {
    const base = activeTab.rows;
    const q = query.trim().toLowerCase();
    const matchesQuery = (r) =>
      !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q);
    const matchesRelation = (r) => {
      if (relationFilter === 'all') return true;
      if (relationFilter === 'above') return r.relationToFocus === 'above';
      if (relationFilter === 'below') return r.relationToFocus === 'below';
      if (relationFilter === 'affects') return r.affectsFocusPosition === true;
      return true;
    };
    const filtered = base.filter((r) => matchesQuery(r) && matchesRelation(r));
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(1, listPage), pages);
    return { filtered, page, pages, pageSize, slice: filtered.slice((page - 1) * pageSize, page * pageSize) };
  }, [activeTab, query, relationFilter, listPage]);

  const filteredCommon = useMemo(() => {
    const q = commonQuery.trim().toLowerCase();
    const searched = enteredExited.common.filter(
      (r) => !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q),
    );
    // Relation filter uses the two backend-provided yearly relations, so an
    // economy above India in one year and below in the other stays explicit.
    const related = searched.filter((r) => matchesCommonRelation(r, commonRelation));
    const sorted = sortCommonRows(related, commonSort);
    const pageSize = 25;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, commonPage), pages);
    return { base: sorted, page, pages, pageSize, slice: sorted.slice((page - 1) * pageSize, page * pageSize) };
  }, [enteredExited.common, commonQuery, commonRelation, commonSort, commonPage]);

  const swap = () => {
    if (yearA == null || yearB == null) return;
    onYearA(yearB);
    onYearB(yearA);
  };

  const meta = data?.metric ?? METRICS[metricKey];

  return (
    <Section
      id="rank-movement"
      title="Rank movement comparison"
      subtitle="Did India's position number change because India moved among the same economies, or because the observed ranking population changed? This separate analysis answers that with a like-for-like universe."
    >
      <MovementControls
        availableYears={availableYears}
        yearA={yearA}
        yearB={yearB}
        yearMid={breakerActive ? yearMid : null}
        metricKey={metricKey}
        onYearA={(v) => {
          setTab('all');
          setListPage(1);
          setCommonPage(1);
          onYearA(v);
        }}
        onYearB={(v) => {
          setTab('all');
          setListPage(1);
          setCommonPage(1);
          onYearB(v);
        }}
        onYearMid={(v) => {
          setTab('all');
          setListPage(1);
          setCommonPage(1);
          if (onYearMid) onYearMid(v);
        }}
        onMetric={(v) => {
          setTab('all');
          onMetric(v);
        }}
        basis={growthActive ? RANKING_BASIS.GROWTH : RANKING_BASIS.LEVEL}
        onBasis={(v) => {
          setTab('all');
          setListPage(1);
          setCommonPage(1);
          if (onBasis) onBasis(v);
        }}
        onSwap={() => {
          setTab('all');
          swap();
        }}
      />
      {sameYear ? (
        <div className="status status-error" role="alert">
          <p>Select two different years. Year A and Year B must differ for a rank-movement comparison.</p>
        </div>
      ) : null}
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="rank movement" />
      {!loading && !error && !sameYear && data ? (
        data.comparison?.available ? (
          isGrowth ? (
            <GrowthResults data={data} />
          ) : isThreeYear ? (
            <ThreeYearResults data={data} />
          ) : (
          <>
            <h3 className="subhead">What happened to India&apos;s position number?</h3>
            <SummaryCards data={data} />
            <div className="explanation" role="note" aria-label="Result in words">
              <StorySentence data={data} />
            </div>
            <p className="footnote">
              Position numbers: lower is a higher place. Denominators count {data.universe.membershipRule}:
              #{data.focusMovement.fullRankA}/{data.focusMovement.denominatorA} in {data.years.a} and #
              {data.focusMovement.fullRankB}/{data.focusMovement.denominatorB} in {data.years.b}.
            </p>

            <h3 className="subhead">Like-for-like comparison</h3>
            <p className="section-sub">
              {data.universe.common} economies had valid observations in both {data.years.a} and {data.years.b}.
            </p>
            <div className="duo" role="group" aria-label={`Like-for-like comparison, ${data.universe.common} economies observed in both years`}>
              <div className="duo-box">
                <span className="duo-year">{data.years.a}</span>
                <span className="duo-rank">
                  #{data.focusMovement.commonRankA} / {data.focusMovement.denominatorCommon}
                </span>
              </div>
              <span className="duo-arrow" aria-hidden="true">
                →
              </span>
              <div className="duo-box">
                <span className="duo-year">{data.years.b}</span>
                <span className="duo-rank">
                  #{data.focusMovement.commonRankB} / {data.focusMovement.denominatorCommon}
                </span>
              </div>
              <span className="duo-delta num">
                {formatSigned(data.focusMovement.commonEffect)} positions ({signMeaning(data.focusMovement.commonEffect)})
              </span>
            </div>
            <p>
              These {data.universe.common} economies are the only economies used to calculate the like-for-like
              movement.
            </p>
            <p className="footnote">
              <strong>Derived comparison position — not a World Bank rank.</strong> Common comparison positions
              rank India only among the economies observed in both years, with the same ordering rule. They are
              neither official ranks nor observed-year ranks.
            </p>
            <p className="footnote">The other economies shown below are outside this common comparison set.</p>

            <h3 className="subhead">What changed outside the common comparison set?</h3>
            <p>
              Entered and exited economies are not part of the common comparison set. They explain the difference
              between the two full observed ranking populations.
            </p>
            <div className="partition" role="group" aria-label="Observed-set partitions">
              <div className="partition-row">
                <span className="partition-year">{data.years.a} observed set</span>
                <span className="partition-bar" aria-label={`${data.years.a} observed set: ${data.universe.common} common plus ${data.universe.exited} exited equals ${data.universe.setA}`}>
                  <span className="partition-common">{data.universe.common} common</span>
                  <span className="partition-delta">
                    {data.universe.exited} exited
                  </span>
                </span>
                <span className="partition-total num">
                  {data.universe.setA} = {data.universe.common} + {data.universe.exited}
                </span>
              </div>
              <div className="partition-row">
                <span className="partition-year">{data.years.b} observed set</span>
                <span className="partition-bar" aria-label={`${data.years.b} observed set: ${data.universe.common} common plus ${data.universe.entered} entered equals ${data.universe.setB}`}>
                  <span className="partition-common">{data.universe.common} common</span>
                  <span className="partition-delta">
                    {data.universe.entered} entered
                  </span>
                </span>
                <span className="partition-total num">
                  {data.universe.setB} = {data.universe.common} + {data.universe.entered}
                </span>
              </div>
            </div>
            <p className="footnote">
              Common means the same member economies in both years. Entered and exited are members outside that
              common set.
            </p>

            <h3 className="subhead">Entered and exited relative to India&apos;s position</h3>
            <div className="facts facts-grouped">
              <div className="facts-group">
                <h4 className="facts-group-title">
                  Entered in {data.years.b} · {data.universe.entered} total
                </h4>
                <dl className="facts">
                  <div>
                    <dt>Above India</dt>
                    <dd className="num">{data.focusMovement.enteredAboveB}</dd>
                  </div>
                  <div>
                    <dt>Below India</dt>
                    <dd className="num">{data.focusMovement.enteredBelowB}</dd>
                  </div>
                </dl>
              </div>
              <div className="facts-group">
                <h4 className="facts-group-title">
                  Exited from {data.years.a} · {data.universe.exited} total
                </h4>
                <dl className="facts">
                  <div>
                    <dt>Above India</dt>
                    <dd className="num">{data.focusMovement.exitedAboveA}</dd>
                  </div>
                  <div>
                    <dt>Below India</dt>
                    <dd className="num">{data.focusMovement.exitedBelowA}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <h3 className="subhead">Outside-common-set effect on India&apos;s position number</h3>
            <dl className="facts">
              <div>
                <dt>Entered in {data.years.b} above India</dt>
                <dd className="num">{data.focusMovement.enteredAboveB}</dd>
              </div>
              <div>
                <dt>Exited from {data.years.a} above India</dt>
                <dd className="num">{data.focusMovement.exitedAboveA}</dd>
              </div>
              <div>
                <dt>Observed-set effect</dt>
                <dd className="num">
                  {formatSigned(data.focusMovement.observedSetEffect)} positions (
                  {signMeaning(data.focusMovement.observedSetEffect)})
                </dd>
              </div>
            </dl>
            <div className="explanation" role="note" aria-label="Observed-set effect in words">
              <p>
                {data.focusMovement.enteredAboveB} {data.focusMovement.enteredAboveB === 1 ? 'economy' : 'economies'}{' '}
                entered the {data.years.b} observed ranking above India. {data.focusMovement.exitedAboveA}{' '}
                {data.focusMovement.exitedAboveA === 1 ? 'economy that ranked' : 'economies that ranked'} above
                India in {data.years.a} {data.focusMovement.exitedAboveA === 1 ? 'is' : 'are'} no longer in the
                observed ranking. Under the ranking definition, these outside-common-set changes contributed{' '}
                {formatSigned(data.focusMovement.observedSetEffect)} to India&apos;s position number.
              </p>
            </div>

            <h4 className="subhead subhead-secondary">Other outside-common-set economies</h4>
            <p className="muted">
              Entered in {data.years.b} below India: {data.focusMovement.enteredBelowB} · Exited from{' '}
              {data.years.a} below India: {data.focusMovement.exitedBelowA}. These affect the size of the
              observed ranking population, not India&apos;s position number.
            </p>

            <h3 className="subhead">Rank-movement decomposition</h3>
            <dl className="facts">
              <div>
                <dt>Full position-number change</dt>
                <dd className="num">
                  {formatSigned(data.focusMovement.positionNumberChange)} positions (
                  {signMeaning(data.focusMovement.positionNumberChange)})
                </dd>
              </div>
              <div>
                <dt>Common-set movement</dt>
                <dd className="num">
                  {formatSigned(data.focusMovement.commonEffect)} positions ({signMeaning(data.focusMovement.commonEffect)})
                </dd>
              </div>
              <div>
                <dt>Outside-common-set effect</dt>
                <dd className="num">
                  {formatSigned(data.focusMovement.observedSetEffect)} positions (
                  {signMeaning(data.focusMovement.observedSetEffect)})
                </dd>
              </div>
            </dl>
            <div className="explanation" role="note" aria-label={data.focusMovement.identityText ?? 'Decomposition'}>
              <p className="mono" aria-label="Clean verification equation">
                {formatSigned(data.focusMovement.positionNumberChange)} ={' '}
                {formatSigned(data.focusMovement.commonEffect)} + {data.focusMovement.enteredAboveB} −{' '}
                {data.focusMovement.exitedAboveA}
              </p>
              <p className="mono footnote">Backend verification: {data.focusMovement.identityText}</p>
              <p>Full position-number change = common-set movement + observed-set effect.</p>
              <p>
                Here, India&apos;s position number changed by {formatSigned(data.focusMovement.positionNumberChange)}{' '}
                overall: {formatSigned(data.focusMovement.commonEffect)} within the {data.universe.common}{' '}
                common economies, and {formatSigned(data.focusMovement.observedSetEffect)} from economies outside
                the common set entering or exiting above India.
              </p>
              <p className="footnote">
                Common-set movement is change among the same economies. Outside-common-set effect is the effect
                of economies outside Common entering or exiting the full observed sets. This describes arithmetic
                under the ranking definition — not economic performance.
              </p>
            </div>

            <h3 className="subhead">Economies outside the common comparison set</h3>
            <p>
              The tables below list only economies outside the common comparison set. They are a different
              population from the {data.universe.common} common economies above.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setListsOpen((v) => !v)}
              aria-expanded={listsOpen}
            >
              {listsOpen
                ? 'Hide entered/exited economy details'
                : `Show entered/exited economy details (entered ${enteredExited.entered.length}, exited ${enteredExited.exited.length})`}
            </button>
            {listsOpen ? (
              <>
            <div role="tablist" aria-label="Entered or exited the observed ranking">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'all'}
                aria-label={`All economies outside the common comparison set, ${outsideTabs[0].count} economies`}
                className={`btn ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab('all');
                  setListPage(1);
                }}
              >
                All ({outsideTabs[0].count})
              </button>{' '}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'entered'}
                aria-label={`Entered the observed ranking in ${data.years.b}, ${enteredExited.entered.length} economies`}
                className={`btn ${tab === 'entered' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab('entered');
                  setListPage(1);
                }}
              >
                Entered in {data.years.b} ({enteredExited.entered.length})
              </button>{' '}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'exited'}
                aria-label={`Exited the observed ranking from ${data.years.a}, ${enteredExited.exited.length} economies`}
                className={`btn ${tab === 'exited' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab('exited');
                  setListPage(1);
                }}
              >
                Exited from {data.years.a} ({enteredExited.exited.length})
              </button>
            </div>
            <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Entered exited filters">
              <Field label="Search name or ISO3" htmlFor="mv-q">
                <input
                  id="mv-q"
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setListPage(1);
                  }}
                  placeholder="e.g. India, IND"
                />
              </Field>
              <Field label="Relation filter" htmlFor="mv-rel">
                <select id="mv-rel" value={relationFilter} onChange={(e) => {
                  setRelationFilter(e.target.value);
                  setListPage(1);
                }}>
                  <option value="all">All</option>
                  <option value="above">Above India</option>
                  <option value="below">Below India</option>
                  <option value="affects">Affects India&apos;s position</option>
                </select>
              </Field>
            </form>
            <p className="footnote">
              Filtering is presentation-only. The decomposition always uses the full universe.
            </p>
            <EconomyTable
              rows={filteredList.slice}
              yearA={data.years.a}
              yearB={data.years.b}
              serialBase={(filteredList.page - 1) * filteredList.pageSize}
              caption={`${tab === 'all' ? 'All economies outside the common comparison set' : tab === 'entered' ? 'Economies that entered the observed ranking' : 'Economies that exited the observed ranking'} for ${data.metric.indicatorCode}, ${data.years.a} to ${data.years.b}`}
            />
            <p className="footnote" aria-live="polite">
              Showing {filteredList.slice.length} of {activeTab.count} ({tab}) · page{' '}
              {filteredList.page} of {filteredList.pages}
            </p>
            <div className="pagination" role="navigation" aria-label="Entered exited pages">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={filteredList.page <= 1}
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={filteredList.page >= filteredList.pages}
                onClick={() => setListPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
              </>
            ) : null}

            <h3 className="subhead">
              {data.universe.common} economies in the common comparison set
            </h3>
            <p>
              Every economy in this table has a valid observation in both selected years. This is a completely
              different population from the entered and exited economies above.
            </p>
            <p className="footnote">
              The summary and decomposition above are already complete. Open this only to inspect the like-for-like
              economies.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCommonOpen((v) => !v)}
              aria-expanded={commonOpen}
            >
              {commonOpen ? 'Hide common economies' : `Show common economies (${data.universe.common})`}
            </button>
            {commonOpen ? (
              <>
                <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Common filters">
                  <Field label="Search common" htmlFor="mv-cq">
                    <input
                      id="mv-cq"
                      type="search"
                      value={commonQuery}
                      onChange={(e) => {
                        setCommonQuery(e.target.value);
                        setCommonPage(1);
                      }}
                      placeholder="e.g. United, USA"
                    />
                  </Field>
                  <Field label="Relation to India" htmlFor="mv-crel">
                    <select
                      id="mv-crel"
                      value={commonRelation}
                      onChange={(e) => {
                        setCommonRelation(e.target.value);
                        setCommonPage(1);
                      }}
                    >
                      {commonRelationOptions([data.years.a, data.years.b]).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sort by" htmlFor="mv-csort">
                    <select
                      id="mv-csort"
                      value={commonSort}
                      onChange={(e) => setCommonSort(e.target.value)}
                    >
                      {commonSortOptions([data.years.a, data.years.b]).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </form>
                <p className="footnote">
                  Sorting uses backend raw values and ranks. It never changes the comparison summary above.
                </p>
                <CommonTable
                  rows={filteredCommon.slice}
                  yearA={data.years.a}
                  yearB={data.years.b}
                  serialBase={(filteredCommon.page - 1) * filteredCommon.pageSize}
                  caption={`Common comparison-set economies for ${data.metric.indicatorCode}, ${data.years.a} to ${data.years.b}`}
                />
                <p className="footnote" aria-live="polite">
                  Showing {filteredCommon.slice.length} of {data.universe.common} · page {filteredCommon.page}{' '}
                  of {filteredCommon.pages}
                </p>
                <div className="pagination" role="navigation" aria-label="Common pages">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={filteredCommon.page <= 1}
                    onClick={() => setCommonPage((p) => Math.max(1, p - 1))}
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={filteredCommon.page >= filteredCommon.pages}
                    onClick={() => setCommonPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              </>
            ) : null}

            <h3 className="subhead">Evidence &amp; provenance</h3>
            <details className="details">
              <summary>Evidence &amp; provenance (vintage, runs, counters, limits)</summary>
              <dl className="facts">
                <div>
                  <dt>World Bank vintage</dt>
                  <dd className="mono">{data.evidence.vintage.wbLastUpdated ?? 'mixed/unknown'}</dd>
                </div>
                <div>
                  <dt>Mixed vintage</dt>
                  <dd>{data.evidence.vintage.mixedVintage ? 'Yes — interpret with caution' : 'No'}</dd>
                </div>
                <div>
                  <dt>Producing runs</dt>
                  <dd className="mono">
                    A: {data.evidence.retrieval.runIdA ?? '—'} · B: {data.evidence.retrieval.runIdB ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>Freshness</dt>
                  <dd>
                    {data.evidence.freshness.fresh ? 'Fresh' : 'Stale/due'} · last success{' '}
                    {data.evidence.freshness.lastRunStatus ?? data.evidence.retrieval.lastSuccessAt ?? 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd className="mono">
                    run {data.evidence.fingerprint.runId ?? '—'} · {data.evidence.fingerprint.observationCount}{' '}
                    observations
                  </dd>
                </div>
                <div>
                  <dt>Denominator explanation</dt>
                  <dd>{data.denominatorExplanation?.explanation?.statement ?? data.denominatorExplanation?.statement ?? '—'}</dd>
                </div>
              </dl>
              <h4 className="subhead">Limits (what is not established)</h4>
              <ul>
                {(data.evidence.limits ?? []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="footnote">
                Metric: {meta?.title ?? metricKey} ({meta?.indicatorCode}) · {meta?.unit}. Ranks calculated by
                this application from World Bank observations.
              </p>
            </details>
          </>
          )
        ) : (
          <div className="status status-empty" role="status">
            <p>
              No decomposition available{data.comparison?.reason ? ` (${String(data.comparison.reason).replace(/_/g, ' ')})` : ''}.
              The observed sets and denominators are still reported where available.
            </p>
          </div>
        )
      ) : null}
    </Section>
  );
}
