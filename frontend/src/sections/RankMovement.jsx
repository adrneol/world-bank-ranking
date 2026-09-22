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

function MovementControls({ availableYears, yearA, yearB, metricKey, onYearA, onYearB, onMetric, onSwap }) {
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
      <Field label="Year A (earlier)" htmlFor="mv-yearA">
        <select id="mv-yearA" value={yearA ?? ''} onChange={(e) => onYearA(Number(e.target.value))}>
          {(availableYears ?? []).map((y) => (
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

function EconomyDetails({ r, yearA, yearB }) {
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
        <div>
          <dt>Relation (A / B)</dt>
          <dd>
            {r.relationToFocusA} / {r.relationToFocusB}
          </dd>
        </div>
        <div>
          <dt>
            Rank in {yearA} / {yearB}
          </dt>
          <dd className="num">
            {r.rankA ?? '—'} / {r.rankB ?? '—'}
          </dd>
        </div>
        <div>
          <dt>Raw value A</dt>
          <dd className="mono">{r.rawTextA ?? '—'}</dd>
        </div>
        <div>
          <dt>Raw value B</dt>
          <dd className="mono">{r.rawTextB ?? '—'}</dd>
        </div>
        <div>
          <dt>Display A / B</dt>
          <dd>
            {r.displayA ?? '—'} / {r.displayB ?? '—'}
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
        {r.tiedWithFocusA || r.tiedWithFocusB ? (
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
 * Entered/exited table: economies OUTSIDE the common set.
 * The Effect column is correct here only: above → affects position,
 * below → denominator only.
 */
function EconomyTable({ rows, yearA, yearB, showStatus = true, caption }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            {showStatus ? <th scope="col">Status</th> : null}
            <th scope="col">Relation to India</th>
            <th scope="col" className="num">
              Rank
            </th>
            <th scope="col" className="num">
              Value
            </th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
              <th scope="row">
                {r.name ?? r.iso3}
                {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                <EconomyDetails r={r} yearA={yearA} yearB={yearB} />
              </th>
              <td className="mono">{r.iso3}</td>
              {showStatus ? <td>{r.status}</td> : null}
              <td>{r.relationToFocus}</td>
              <td className="num">{r.status === 'exited' ? (r.rankA ?? '—') : (r.rankB ?? '—')}</td>
              <td className="num">{r.status === 'exited' ? (r.displayA ?? '—') : (r.displayB ?? '—')}</td>
              <td>{r.positionEffect === 'affects_position' ? 'Affects position' : 'Denominator only'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Common comparison-set table: a DIFFERENT population from entered/exited.
 * No Status column (obvious from the section) and deliberately NO Effect
 * column: common economies are the fixed comparison population, not
 * observed-set effect contributors. Sorting uses backend raw numerics
 * (valueA/valueB) and backend ranks — never display strings. All
 * search/filter/sort is presentation-only.
 */
function CommonTable({ rows, yearA, yearB, caption }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  return (
    <div className="table-scroll" role="region" aria-label={caption ?? 'Common economies'} tabIndex={0}>
      <table className="table table-compact">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col">Economy</th>
            <th scope="col">ISO3</th>
            <th scope="col" className="num">
              {yearA} rank
            </th>
            <th scope="col" className="num">
              {yearB} rank
            </th>
            <th scope="col" className="num">
              {yearA} value
            </th>
            <th scope="col" className="num">
              {yearB} value
            </th>
            <th scope="col">
              {yearA} vs India
            </th>
            <th scope="col">
              {yearB} vs India
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.iso3} className={r.iso3 === 'IND' ? 'row-focus' : undefined}>
              <th scope="row">
                {r.name ?? r.iso3}
                {r.iso3 === 'IND' ? <span className="focus-tag"> India</span> : null}
                <EconomyDetails r={r} yearA={yearA} yearB={yearB} />
              </th>
              <td className="mono">{r.iso3}</td>
              <td className="num">{r.rankA ?? '—'}</td>
              <td className="num">{r.rankB ?? '—'}</td>
              <td className="num">{r.displayA ?? '—'}</td>
              <td className="num">{r.displayB ?? '—'}</td>
              <td>{r.relationToFocusA}</td>
              <td>{r.relationToFocusB}</td>
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
  const b = r.relationToFocusB;
  switch (filter) {
    case 'aboveA':
      return a === 'above';
    case 'belowA':
      return a === 'below';
    case 'aboveB':
      return b === 'above';
    case 'belowB':
      return b === 'below';
    case 'aboveBoth':
      return a === 'above' && b === 'above';
    case 'belowBoth':
      return a === 'below' && b === 'below';
    case 'crossed':
      return (a === 'above' && b === 'below') || (a === 'below' && b === 'above');
    default:
      return true;
  }
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
    case 'valueB-asc':
      return copy.sort((x, y) => (num(x.valueB) ?? Infinity) - (num(y.valueB) ?? Infinity) || byIso3(x, y));
    case 'valueB-desc':
      return copy.sort((x, y) => (num(y.valueB) ?? -Infinity) - (num(x.valueB) ?? -Infinity) || byIso3(x, y));
    case 'rankA-asc':
      return copy.sort((x, y) => (x.rankA ?? Infinity) - (y.rankA ?? Infinity) || byIso3(x, y));
    case 'rankA-desc':
      return copy.sort((x, y) => (y.rankA ?? -Infinity) - (x.rankA ?? -Infinity) || byIso3(x, y));
    case 'rankB-asc':
      return copy.sort((x, y) => (x.rankB ?? Infinity) - (y.rankB ?? Infinity) || byIso3(x, y));
    case 'rankB-desc':
      return copy.sort((x, y) => (y.rankB ?? -Infinity) - (x.rankB ?? -Infinity) || byIso3(x, y));
    case 'valueA-desc':
    default:
      return copy.sort((x, y) => (num(y.valueA) ?? -Infinity) - (num(x.valueA) ?? -Infinity) || byIso3(x, y));
  }
}

export default function RankMovement({ availableYears, yearA, yearB, metricKey, onYearA, onYearB, onMetric }) {
  const [tab, setTab] = useState('entered');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [commonOpen, setCommonOpen] = useState(false);
  const [commonQuery, setCommonQuery] = useState('');
  const [commonRelation, setCommonRelation] = useState('all');
  const [commonSort, setCommonSort] = useState('valueB-desc');
  const [commonPage, setCommonPage] = useState(1);
  const [listPage, setListPage] = useState(1);
  const [listsOpen, setListsOpen] = useState(false);

  const enabled = yearA != null && yearB != null && yearA !== yearB && metricKey != null;
  const depsKey = `movement:${metricKey}:${yearA ?? ''}:${yearB ?? ''}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.comparisonLevel(
        { indicator: metricKey, yearA, yearB, country: 'IND', detail: 'full' },
        { signal },
      ),
    depsKey,
    { enabled },
  );

  const sameYear = yearA != null && yearB != null && yearA === yearB;
  const empty = !loading && !error && !sameYear && data && !data.comparison?.available && !data.focusMovement?.fullRankA && !data.focusMovement?.fullRankB;

  const enteredExited = useMemo(() => {
    const rows = data?.economies?.rows ?? [];
    const entered = rows.filter((r) => r.status === 'entered');
    const exited = rows.filter((r) => r.status === 'exited');
    const common = rows.filter((r) => r.status === 'common');
    return { entered, exited, common };
  }, [data]);

  const filteredList = useMemo(() => {
    const base = tab === 'entered' ? enteredExited.entered : enteredExited.exited;
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
  }, [tab, query, relationFilter, enteredExited, listPage]);

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
        metricKey={metricKey}
        onYearA={(v) => {
          setListPage(1);
          setCommonPage(1);
          onYearA(v);
        }}
        onYearB={(v) => {
          setListPage(1);
          setCommonPage(1);
          onYearB(v);
        }}
        onMetric={onMetric}
        onSwap={swap}
      />
      {sameYear ? (
        <div className="status status-error" role="alert">
          <p>Select two different years. Year A and Year B must differ for a rank-movement comparison.</p>
        </div>
      ) : null}
      <StatusBlock loading={loading} error={error} empty={empty} onRetry={retry} sectionName="rank movement" />
      {!loading && !error && !sameYear && data ? (
        data.comparison?.available ? (
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
              caption={`${tab === 'entered' ? 'Economies that entered the observed ranking' : 'Economies that exited the observed ranking'} for ${data.metric.indicatorCode}, ${data.years.a} to ${data.years.b}`}
            />
            <p className="footnote" aria-live="polite">
              Showing {filteredList.slice.length} of {filteredList.filtered.length} ({tab}) · page{' '}
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
                      <option value="all">All</option>
                      <option value="aboveA">Above India in {data.years.a}</option>
                      <option value="belowA">Below India in {data.years.a}</option>
                      <option value="aboveB">Above India in {data.years.b}</option>
                      <option value="belowB">Below India in {data.years.b}</option>
                      <option value="aboveBoth">Above India in both years</option>
                      <option value="belowBoth">Below India in both years</option>
                      <option value="crossed">Crossed India between years</option>
                    </select>
                  </Field>
                  <Field label="Sort by" htmlFor="mv-csort">
                    <select
                      id="mv-csort"
                      value={commonSort}
                      onChange={(e) => setCommonSort(e.target.value)}
                    >
                      <option value="valueA-desc">Value in {data.years.a} — high to low</option>
                      <option value="valueA-asc">Value in {data.years.a} — low to high</option>
                      <option value="valueB-desc">Value in {data.years.b} — high to low</option>
                      <option value="valueB-asc">Value in {data.years.b} — low to high</option>
                      <option value="rankA-asc">Rank in {data.years.a} — best first</option>
                      <option value="rankA-desc">Rank in {data.years.a} — lowest first</option>
                      <option value="rankB-asc">Rank in {data.years.b} — best first</option>
                      <option value="rankB-desc">Rank in {data.years.b} — lowest first</option>
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
                  caption={`Common comparison-set economies for ${data.metric.indicatorCode}, ${data.years.a} to ${data.years.b}`}
                />
                <p className="footnote" aria-live="polite">
                  Showing {filteredCommon.slice.length} of {filteredCommon.base.length} · page {filteredCommon.page}{' '}
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
