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
          {years.a} <span className="card-unit">observed ranking</span>
        </h3>
        <p className="card-rank">
          {fm.fullRankA != null ? `#${fm.fullRankA} / ${fm.denominatorA}` : 'n/a'}
        </p>
        <p className="card-code mono">
          {metric.indicatorCode} · {metric.unit}
        </p>
      </div>
      <div className="card">
        <h3>
          {years.b} <span className="card-unit">observed ranking</span>
        </h3>
        <p className="card-rank">
          {fm.fullRankB != null ? `#${fm.fullRankB} / ${fm.denominatorB}` : 'n/a'}
        </p>
        <p className="card-code mono">
          {metric.indicatorCode} · {metric.unit}
        </p>
      </div>
      <div className="card">
        <h3>Position number change</h3>
        <p className="card-rank" aria-label={`Position number changed by ${fm.positionNumberChange}`}>
          {fm.positionNumberChange != null ? formatSigned(fm.positionNumberChange) : 'n/a'}
        </p>
        <p className="card-unit">
          {fm.placesGained != null
            ? `${fm.placesGained > 0 ? `${fm.placesGained} places gained` : fm.placesGained < 0 ? `${-fm.placesGained} places lost` : 'No change in places'} (places gained = ${formatSigned(fm.placesGained)})`
            : 'Decomposition unavailable.'}
        </p>
      </div>
    </div>
  );
}

function EconomyTable({ rows, yearA, yearB, showStatus = true }) {
  if (!rows || rows.length === 0) {
    return <p className="muted">None.</p>;
  }
  return (
    <div className="table-scroll" role="region" aria-label="Economies" tabIndex={0}>
      <table className="table">
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

export default function RankMovement({ availableYears, yearA, yearB, metricKey, onYearA, onYearB, onMetric }) {
  const [tab, setTab] = useState('entered');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [commonOpen, setCommonOpen] = useState(false);
  const [commonQuery, setCommonQuery] = useState('');
  const [commonPage, setCommonPage] = useState(1);
  const [listPage, setListPage] = useState(1);

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
    const base = enteredExited.common.filter(
      (r) => !q || String(r.name ?? '').toLowerCase().includes(q) || String(r.iso3 ?? '').toLowerCase().includes(q),
    );
    const pageSize = 50;
    const pages = Math.max(1, Math.ceil(base.length / pageSize));
    const page = Math.min(Math.max(1, commonPage), pages);
    return { base, page, pages, pageSize, slice: base.slice((page - 1) * pageSize, page * pageSize) };
  }, [enteredExited.common, commonQuery, commonPage]);

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
            <p className="footnote">
              Position numbers: lower is a higher place. Both denominators are shown because each year ranks only
              the eligible economies with a valid observation for this indicator and year.
            </p>

            <h3 className="subhead">Is the movement comparable? The common universe</h3>
            <dl className="facts">
              <div>
                <dt>Common observed economies</dt>
                <dd className="num">
                  {data.universe.common} of {data.universe.setA} in {data.years.a}, of {data.universe.setB} in{' '}
                  {data.years.b}
                </dd>
              </div>
              <div>
                <dt>India among common economies</dt>
                <dd className="num">
                  #{data.focusMovement.commonRankA} → #{data.focusMovement.commonRankB} / {data.focusMovement.denominatorCommon}
                </dd>
              </div>
              <div>
                <dt>Common-universe movement</dt>
                <dd className="num">{formatSigned(data.focusMovement.commonEffect)} positions</dd>
              </div>
            </dl>
            <p className="footnote">
              Common-universe positions are derived comparison positions, not official World Bank ranks and not
              observed-year ranks.
            </p>

            <h3 className="subhead">How did the changing observed population affect it?</h3>
            <dl className="facts">
              <div>
                <dt>Entered above India</dt>
                <dd className="num">{data.focusMovement.enteredAboveB}</dd>
              </div>
              <div>
                <dt>Exited above India</dt>
                <dd className="num">{data.focusMovement.exitedAboveA}</dd>
              </div>
              <div>
                <dt>Observed-set effect</dt>
                <dd className="num">{formatSigned(data.focusMovement.observedSetEffect)} positions</dd>
              </div>
              <div>
                <dt>Entered below / exited below</dt>
                <dd className="num">
                  {data.focusMovement.enteredBelowB} / {data.focusMovement.exitedBelowA} (denominator only)
                </dd>
              </div>
            </dl>
            <p className="footnote">
              Economies entering or leaving below India change the denominator but not India&apos;s position
              number. Only entries/exits above India move the position arithmetically.
            </p>

            <h3 className="subhead">Rank-movement decomposition</h3>
            <div className="explanation" role="note" aria-label={data.focusMovement.identityText ?? 'Decomposition'}>
              <p className="mono">{data.focusMovement.identityText}</p>
              <p>
                Full position change ({formatSigned(data.focusMovement.positionNumberChange)}) = common-universe
                movement ({formatSigned(data.focusMovement.commonEffect)}) + observed-set effect (
                {formatSigned(data.focusMovement.observedSetEffect)}).
              </p>
              <p className="footnote">
                Sign: positive means the position number increased (a lower place); places gained positive means
                India moved up. This describes arithmetic under the ranking definition — not economic performance.
              </p>
            </div>

            <h3 className="subhead">Which economies entered or exited the observed ranking?</h3>
            <div role="tablist" aria-label="Entered or exited economies">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'entered'}
                className={`btn ${tab === 'entered' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab('entered');
                  setListPage(1);
                }}
              >
                Entered ({enteredExited.entered.length})
              </button>{' '}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'exited'}
                className={`btn ${tab === 'exited' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTab('exited');
                  setListPage(1);
                }}
              >
                Exited ({enteredExited.exited.length})
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
            <EconomyTable rows={filteredList.slice} yearA={data.years.a} yearB={data.years.b} />
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

            <h3 className="subhead">Common economies</h3>
            <p className="footnote">
              The summary and decomposition above are already complete. Open this only to inspect the {data.universe.common}{' '}
              like-for-like economies.
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
                </form>
                <EconomyTable rows={filteredCommon.slice} yearA={data.years.a} yearB={data.years.b} />
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
