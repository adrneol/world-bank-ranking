/**
 * Exchange Rate Movement (canonical 3-basis methodology).
 *
 * FX-only analytical layer: QUESTION → ANALYSIS → EXPLANATION → EVIDENCE.
 * Display-only: every value, rank, median benchmark, gap, count, ranking
 * list and universe comes from GET /api/movement/fx. No economics in React.
 *
 * Frozen rule: rank direction DESCENDING (greatest nominal depreciation →
 * rank 1). Raw LCU-per-US$ levels are never ranked, benchmarked, or gapped.
 * Benchmark is always the leave-one-out MEDIAN; gap = country − median (pp).
 * Visual language mirrors the GDP/Prices/Trade/Capital Movement interface.
 */

import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import BarComparisonChart from '../components/charts/BarComparisonChart.jsx';
import ChartCard from '../components/charts/ChartCard.jsx';
import { isFxMetricKey } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal } from '../utils/format.js';
import { Field, MethodologyPanel, Pagination, StatusBlock, UnavailableState } from '../components/ui.jsx';
import { defaultMovementCommonSort, movementCommonSortOptions, sortMovementCommonRows } from '../components/movementSort.js';
import { CardField, EconomyMobileList } from '../components/MovementCards.jsx';
import { useIsMobile } from '../hooks/useMediaQuery.js';
import FocusPicker from '../components/FocusPicker.jsx';
import MetricPicker from '../components/MetricPicker.jsx';
import { SearchableSelect } from '../components/controls.jsx';
import { metricKeysForSubject, movementBases, movementBasisOptions, subjectOf } from '../config/metrics.js';
import { SUBJECTS } from '../config/metrics.js';

function fmt(v, decimals) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return formatDecimal(Number(v), decimals ?? 2);
}

function fmtSigned(v, decimals) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${formatDecimal(n, decimals ?? 2)}`;
}

/** Researcher-oriented possessive for any focus country (never hardcoded). */
function possessive(name) {
  const n = String(name ?? 'Focus').trim() || 'Focus';
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

function lowerFirst(s) {
  const t = String(s ?? '');
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function rankCell(rank) {
  return rank === null || rank === undefined ? '—' : `#${rank}`;
}

function parseRankQuery(input) {
  const m = /^#?(\d+)$/.exec(String(input ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function matchesTextOrRank(rawQuery, rank, row) {
  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!q) return true;
  const wanted = parseRankQuery(rawQuery);
  if (wanted !== null) return rank === wanted;
  return String(row.name ?? '').toLowerCase().includes(q) || String(row.iso3 ?? '').toLowerCase().includes(q);
}

function polarity(change) {
  if (change === null || change === undefined) return null;
  if (change > 0) return 'Nominal depreciation vs USD';
  if (change < 0) return 'Nominal appreciation vs USD';
  return 'No nominal movement vs USD';
}

function gapInterpretation(gap) {
  if (gap === null || gap === undefined) return '';
  if (gap > 0) return 'depreciated more than the peer median';
  if (gap < 0) return 'depreciated less than the peer median';
  return 'moved with the peer median';
}

/**
 * Basis-aware required-observations line from backend `requiredYears`.
 * Annual change names the t−1/t pair; period change names endpoints S, E.
 */
function requiredLine(section) {
  const yrs = section?.requiredYears ?? [];
  const id = section?.basis?.id ?? '';
  if (id === 'fx_annual_rate') return yrs.length ? `Selected year: ${yrs.join(', ')}` : null;
  if (id === 'fx_annual_change') return yrs.length ? `Required consecutive observations: ${yrs.join(', ')} (${yrs.length})` : null;
  if (id === 'fx_period_change') return yrs.length ? `Required endpoint observations: ${yrs.join(', ')} (${yrs.length})` : null;
  return null;
}

/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */

export function FxMovementControls({ availableYears, yearA, yearB, yearMid, metricKey, basis, country, countries, groupType, groupValue, groupOptions, onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry, onGroupType, onGroupValue, onSwap }) {
  const validMidYears = (availableYears ?? []).filter(
    (y) => yearA != null && yearB != null && y > Math.min(yearA, yearB) && y < Math.max(yearA, yearB),
  );
  const subject = subjectOf(metricKey);
  const basisOptions = movementBasisOptions(metricKey, yearA, yearB);
  useEffect(() => {
    if (!basisOptions.some((b) => b.id === basis)) {
      onBasis?.(basisOptions[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKey]);
  const groupTypeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'All economies' }];
    if (groupOptions?.supported) {
      if (groupOptions.supported.income_level?.length) opts.push({ value: 'income_level', label: 'Income group (World Bank)' });
      if (groupOptions.supported.region?.length) opts.push({ value: 'region', label: 'Region (World Bank)' });
      if (groupOptions.supported.lending_type?.length) opts.push({ value: 'lending_type', label: 'Lending type (World Bank)' });
    }
    return opts;
  }, [groupOptions]);
  const groupValueOptions = useMemo(() => {
    if (!groupType || !groupOptions?.supported?.[groupType]) return [{ value: 'All', label: 'All' }];
    return [
      { value: 'All', label: 'All' },
      ...groupOptions.supported[groupType].map((r) => ({ value: String(r.value), label: `${r.value} (${r.eligibleCount})` })),
    ];
  }, [groupType, groupOptions]);
  return (
    <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Exchange Rate comparison controls">
      <FocusPicker countries={countries} value={country} onChange={(v) => onCountry?.(v)} id="mv-country" />
      <SearchableSelect
        id="mv-subject"
        label="Analysis"
        value={subject}
        options={Object.values(SUBJECTS).map((s) => ({ value: s.key, label: s.label }))}
        onChange={(nextSubject) => {
          const next = metricKeysForSubject(nextSubject);
          onMetric(next.includes(metricKey) ? metricKey : next[0]);
        }}
      />
      <MetricPicker id="mv-metric" label="Metric" value={metricKey} onChange={onMetric} subject={subject} />
      <SearchableSelect
        id="mv-basis"
        label="Basis"
        value={basis}
        options={basisOptions.map((b) => ({ value: b.id, label: b.label }))}
        onChange={onBasis}
      />
      <SearchableSelect
        id="mv-yearA"
        label="Start year"
        value={yearA != null ? String(yearA) : ''}
        placeholder="Select year…"
        options={(availableYears ?? []).map((y) => ({ value: String(y), label: String(y) }))}
        onChange={(v) => onYearA(Number(v))}
      />
      <SearchableSelect
        id="mv-yearMid"
        label="Middle year"
        value={yearMid != null ? String(yearMid) : ''}
        placeholder="None"
        options={[{ value: '', label: 'None' }, ...validMidYears.map((y) => ({ value: String(y), label: String(y) }))]}
        onChange={(v) => onYearMid(v === '' ? null : Number(v))}
      />
      <SearchableSelect
        id="mv-yearB"
        label="End year"
        value={yearB != null ? String(yearB) : ''}
        placeholder="Select year…"
        options={(availableYears ?? []).map((y) => ({ value: String(y), label: String(y) }))}
        onChange={(v) => onYearB(Number(v))}
      />
      <Field label="Swap" htmlFor="mv-swap">
        <button id="mv-swap" type="button" className="btn btn-secondary" onClick={onSwap} aria-label="Swap start and end years">
          ⇄ Swap start/end
        </button>
      </Field>
      <SearchableSelect
        id="mv-group-type"
        label="Country group"
        value={groupType ?? ''}
        options={groupTypeOptions}
        onChange={(v) => { onGroupType?.(v === '' ? null : v); onGroupValue?.('All'); }}
      />
      {groupType ? (
        <SearchableSelect
          id="mv-group-value"
          label={groupType === 'income_level' ? 'Income group' : groupType === 'region' ? 'Region' : 'Lending type'}
          value={groupValue ?? 'All'}
          options={groupValueOptions}
          onChange={(v) => onGroupValue?.(v)}
        />
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* At-a-glance summary blocks                                           */
/* ------------------------------------------------------------------ */

function FxGlance({ data, focusName }) {
  const obs = data?.observed ?? [];
  const lfl = data?.likeForLike ?? [];
  if (!data?.available || obs.length === 0) return null;
  const isLevel = data?.basis?.id === 'fx_annual_rate';
  const keyOf = (s) => s.period ?? String(s.year);
  const lflByKey = new Map(lfl.map((s) => [keyOf(s), s]));
  return (
    <div className="cards" role="region" aria-label="Summary at a glance">
      {obs.map((s) => {
        const l = lflByKey.get(keyOf(s));
        const f = s.focus;
        const lf = l?.focus;
        const basisLabel = s.basis?.label ?? '';
        if (!f) {
          return (
            <div className="card" key={keyOf(s)}>
              <h3>{keyOf(s)}</h3>
              <p className="card-unit">{basisLabel}</p>
              <p className="card-rank">n/a</p>
              <p className="card-unit">Missing required World Bank observations for {focusName}.</p>
            </div>
          );
        }
        return (
          <div className="card" key={keyOf(s)}>
            <h3>{keyOf(s)}</h3>
            <p className="card-unit">{possessive(focusName)} {lowerFirst(basisLabel)}</p>
            <p className="card-result-value" aria-label={`${focusName} ${basisLabel} ${f.valueDisplay ?? f.value} in ${keyOf(s)}`}>
              {f.valueDisplay ?? (isLevel ? `${fmt(f.value, 2)} LCU per US$` : `${fmtSigned(f.value, 2)}%`)}
            </p>
            {!isLevel && f.value != null ? <p className="card-unit">{polarity(f.value)}</p> : null}
            {isLevel ? (
              <p className="card-unit">Not cross-country rankable · {s.eligibleCount} economies with valid data</p>
            ) : (
              <dl className="facts">
                <div>
                  <dt>Observed</dt>
                  <dd className="num">{`#${f.rank} / ${f.denominator}`}</dd>
                </div>
                <div>
                  <dt>Like-for-like</dt>
                  <dd className="num">{lf ? `#${lf.rank} / ${lf.denominator}` : 'n/a'}</dd>
                </div>
                <div>
                  <dt>Peer median</dt>
                  <dd className="num">{f.benchmark != null ? `${f.benchmarkDisplay ?? fmtSigned(f.benchmark, 2)}% · ${f.benchmarkPeerCount} ${f.benchmarkPeerCount === 1 ? 'economy' : 'economies'}` : 'n/a'}</dd>
                </div>
                <div>
                  <dt>Gap</dt>
                  <dd className="num">{f.gapDisplay ?? `${fmtSigned(f.gap, 2)} pp`}</dd>
                </div>
              </dl>
            )}
            {!isLevel && f.gap != null ? <p className="card-unit">({gapInterpretation(f.gap)})</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result cards                                                         */
/* ------------------------------------------------------------------ */

function statBox(label, value, valueClass, key) {
  return (
    <div key={key} className="denominators">
      <p className="card-unit">{label}</p>
      <div className={valueClass}>{value}</div>
    </div>
  );
}

function sectionFacts(section, focusName, heading, groupLabel) {
  const f = section?.focus;
  const req = requiredLine(section);
  if (!f) {
    return (
      <div className="facts-group growth-section" role="group" aria-label={groupLabel}>
        <h4 className="facts-group-title">{heading}</h4>
        {statBox(`${possessive(focusName)} ${lowerFirst(section?.basis?.label ?? 'value')}`, 'n/a', 'card-rank', 'value')}
        {statBox('Eligible economies', `${section?.eligibleCount ?? 0}`, 'card-rank', 'universe')}
        <p className="card-unit">Analysis unavailable for {focusName}: missing required World Bank observations.</p>
        {req ? <p className="card-unit">{req}</p> : null}
      </div>
    );
  }
  return (
    <div className="facts-group growth-section" role="group" aria-label={groupLabel}>
      <h4 className="facts-group-title">{heading}</h4>
      {statBox(`${possessive(focusName)} rank`, `#${f.rank} / ${f.denominator}`, 'card-rank', 'rank')}
      {statBox('Eligible economies', `${section.eligibleCount}`, 'card-rank', 'universe')}
      {statBox(
        'Peer median',
        f.benchmark != null ? `${f.benchmarkDisplay ?? fmtSigned(f.benchmark, 2)}% · ${f.benchmarkPeerCount} ${f.benchmarkPeerCount === 1 ? 'economy' : 'economies'}` : 'n/a (no comparison universe)',
        'card-rank',
        'average',
      )}
      {statBox(
        `${focusName} vs peer median`,
        f.gap != null ? `${f.gapDisplay ?? `${fmtSigned(f.gap, 2)} pp`} (${gapInterpretation(f.gap)})` : 'n/a',
        'duo-rank',
        'difference',
      )}
      {req ? <p className="card-unit">{req}</p> : null}
    </div>
  );
}

function FxResultCard({ observed, likeForLike, focusName }) {
  const key = observed ? (observed.period ?? String(observed.year)) : '?';
  const basisLabel = observed?.basis?.label ?? likeForLike?.basis?.label ?? '';
  const isLevel = (observed?.basis?.id ?? likeForLike?.basis?.id) === 'fx_annual_rate';
  const rankWording = observed?.basis?.rankWording ?? likeForLike?.basis?.rankWording;
  const f = observed?.focus;
  return (
    <div className="card">
      <h3>{key} <span className="card-unit">{basisLabel}</span></h3>
      <p className="card-unit">{possessive(focusName)} {lowerFirst(basisLabel)}</p>
      <p className="card-result-value" aria-label={`${possessive(focusName)} ${lowerFirst(basisLabel)} ${f ? (f.valueDisplay ?? f.value) : 'unavailable'} in ${key}`}>
        {f ? (f.valueDisplay ?? (isLevel ? `${fmt(f.value, 2)} LCU per US$` : `${fmtSigned(f.value, 2)}%`)) : 'n/a'}
      </p>
      {!isLevel && f ? <p className="card-unit">{polarity(f.value)}</p> : null}
      <p className="card-unit">{rankWording ?? 'Official rate — descriptive, no cross-country rank.'}</p>
      {isLevel ? (
        <p className="card-unit">Eligible economies with valid data: {observed?.eligibleCount ?? 0}. Raw LCU magnitudes reflect denomination, not strength.</p>
      ) : (
        <>
          {observed ? sectionFacts(observed, focusName, 'Observed', `Observed comparison for ${key}`) : null}
          {likeForLike ? sectionFacts(likeForLike, focusName, 'Like-for-like', `Like-for-like comparison for ${key}`) : null}
          {f && f.cagr != null ? (
            <p className="footnote">
              Annualized {fmtSigned(f.cagr, 2)}% (display-only secondary representation; same ordering, no separate rank).
            </p>
          ) : null}
          <p className="footnote">The median excludes {focusName} and never affects ranking.</p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Common / outside presentation from backend ranking lists (display    */
/* joins only; ranks, values, counts are backend-provided).             */
/* ------------------------------------------------------------------ */

function buildFxSets(data) {
  const obs = data?.observed ?? [];
  const lfl = data?.likeForLike ?? [];
  const keyOf = (s) => s.period ?? String(s.year);
  const lflMaps = lfl.map((s) => new Map((s.ranking ?? []).map((r) => [r.iso3, r])));
  const commonIsos = lflMaps.length
    ? [...lflMaps[0].keys()].filter((iso) => lflMaps.every((m) => m.has(iso)))
    : [];
  const lflByKey = new Map(lfl.map((s) => [keyOf(s), s]));
  const obsByKey = new Map(obs.map((s) => [keyOf(s), s]));
  const keys = obs.map(keyOf);
  const commonSet = new Set(commonIsos);
  const commonRows = commonIsos.map((iso) => {
    const perKey = {};
    for (const s of lfl) {
      const r = lflByKey.get(keyOf(s)).ranking.find((x) => x.iso3 === iso);
      perKey[keyOf(s)] = r ?? null;
    }
    const first = perKey[keys[0]];
    return { iso3: iso, name: first?.name ?? iso, perKey };
  });
  const outsideByKey = new Map();
  for (const s of obs) {
    const k = keyOf(s);
    outsideByKey.set(k, (s.ranking ?? []).filter((r) => !commonSet.has(r.iso3)));
  }
  const seenOutside = new Map();
  for (const rows of outsideByKey.values()) for (const r of rows) if (!seenOutside.has(r.iso3)) seenOutside.set(r.iso3, r);
  return { obs, lfl, keys, obsByKey, lflByKey, commonRows, commonSet, outsideByKey, allOutside: [...seenOutside.values()] };
}

function focusRankOf(section, focusIso) {
  return section?.focus?.rank ?? section?.ranking?.find((r) => r.iso3 === focusIso)?.rank ?? null;
}

function relationOf(rank, focusRank) {
  if (rank == null || focusRank == null) return '—';
  if (rank < focusRank) return 'above';
  if (rank > focusRank) return 'below';
  return 'tied';
}

function FxCommonTable({ sets, focusIso, focusName }) {
  const tableId = useId();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [sort, setSort] = useState('rank-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openIso, setOpenIso] = useState(null);
  const { keys, lflByKey, commonRows } = sets;
  const refKey = keys[keys.length - 1];
  const refSection = lflByKey.get(refKey);
  const refFocusRank = focusRankOf(refSection, focusIso);
  // Per-comparison sort (rank/change × direction for every compared period),
  // normalized to a valid option: a stale id (e.g. after toggling the middle
  // year) falls back to the reference comparison instead of sorting wrongly.
  const effectiveSort = movementCommonSortOptions(keys, 'change').some((o) => o.value === sort)
    ? sort
    : defaultMovementCommonSort(keys);
  const rows = useMemo(() => {
    const base = commonRows.map((r) => {
      const ref = r.perKey[refKey];
      return { ...r, refRank: ref?.rank ?? null, refValue: ref?.value ?? null, relation: relationOf(ref?.rank, refFocusRank) };
    });
    const searched = base.filter((r) => matchesTextOrRank(query, r.refRank, r));
    const related = searched.filter((r) => {
      if (relationFilter === 'all') return true;
      if (relationFilter === 'above') return r.relation === 'above';
      if (relationFilter === 'below') return r.relation === 'below';
      return true;
    });
    return sortMovementCommonRows(related, effectiveSort, keys);
  }, [commonRows, query, relationFilter, effectiveSort, refKey, refFocusRank, keys]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const onPage = (p, size) => {
    if (size && size !== pageSize) { setPageSize(size); setPage(1); return; }
    setPage(p);
  };
  const colCount = 4 + 2 * keys.length;
  // Per-comparison rank/change details, shared verbatim by the desktop
  // expandable row and the mobile card disclosure: one code path means the
  // two presentations can never disagree on backend values.
  const renderKeyDetails = (r) => (
    <>
      {keys.map((k) => (
        <Fragment key={k}>
          <div>
            <dt>{k} rank</dt>
            <dd className="num">{rankCell(r.perKey[k]?.rank)}</dd>
          </div>
          <div>
            <dt>{k} change</dt>
            <dd className="num">{r.perKey[k]?.value != null ? `${fmtSigned(r.perKey[k].value, 2)}%` : '—'}</dd>
          </div>
        </Fragment>
      ))}
    </>
  );
  return (
    <div>
      <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Common economy filters">
        <Field label="Search name, ISO3, or rank" htmlFor={`fx-q-${tableId}`}>
          <input
            id={`fx-q-${tableId}`}
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={`e.g. ${focusName}, ${focusIso}, or #12`}
          />
        </Field>
        <SearchableSelect
          id={`fx-rel-${tableId}`}
          label="Relation filter"
          value={relationFilter}
          searchable={false}
          options={[
            { value: 'all', label: 'All' },
            { value: 'above', label: `Above ${focusName}` },
            { value: 'below', label: `Below ${focusName}` },
          ]}
          onChange={(v) => { setRelationFilter(v); setPage(1); }}
        />
        <SearchableSelect
          id={`fx-sort-${tableId}`}
          label="Sort"
          value={effectiveSort}
          searchable={false}
          options={movementCommonSortOptions(keys, 'change').map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => { setSort(v); setPage(1); }}
        />
      </form>
      <p className="footnote">Filtering is presentation-only. Ranks and universes always come from the backend.</p>
      {isMobile ? (
        slice.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <EconomyMobileList
            rows={slice}
            rankOf={(r) => r.refRank}
            caption="Common economies with like-for-like ranks and values"
            focusIso={focusIso}
            focusName={focusName}
            renderSummary={(r) => (
              <>
                {keys.map((k) => (
                  <Fragment key={k}>
                    <CardField label={`${k} rank`} num>
                      {rankCell(r.perKey[k]?.rank)}
                    </CardField>
                    <CardField label={`${k} change %`} num>
                      {r.perKey[k]?.value != null ? fmtSigned(r.perKey[k].value, 2) : '—'}
                    </CardField>
                  </Fragment>
                ))}
                <CardField label={`vs ${focusName} (${refKey})`}>{r.relation}</CardField>
              </>
            )}
            renderDetails={(r) => <dl className="dgrid">{renderKeyDetails(r)}</dl>}
          />
        )
      ) : (
        <div className="table-scroll" role="region" aria-label="Common economies" tabIndex={0}>
        <table className="table table-compact">
          <caption className="sr-only">Common economies with like-for-like ranks and values</caption>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Economy</th>
              <th scope="col">ISO3</th>
              {keys.map((k) => (
                <th key={`rank-${k}`} scope="col" className="num">{k} rank</th>
              ))}
              {keys.map((k) => (
                <th key={`value-${k}`} scope="col" className="num">{k} change %</th>
              ))}
              <th scope="col">vs {focusName} ({refKey})</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const open = openIso === r.iso3;
              const detailId = `${tableId}-${r.iso3}-details`;
              return (
                <Fragment key={r.iso3}>
                  <tr className={r.iso3 === focusIso ? 'row-focus' : undefined}>
                    <td className="num">{rankCell(r.refRank)}</td>
                    <th scope="row">
                      {r.name ?? r.iso3}
                      {r.iso3 === focusIso ? <span className="focus-tag"> {focusName}</span> : null}{' '}
                      <button
                        type="button"
                        className="btn btn-ghost details-toggle"
                        aria-expanded={open}
                        aria-controls={detailId}
                        onClick={() => setOpenIso(open ? null : r.iso3)}
                      >
                        {open ? 'Hide details' : 'Details'}
                      </button>
                    </th>
                    <td className="mono">{r.iso3}</td>
                    {keys.map((k) => (
                      <td key={`rank-${k}`} className="num">{rankCell(r.perKey[k]?.rank)}</td>
                    ))}
                    {keys.map((k) => (
                      <td key={`value-${k}`} className="num">{r.perKey[k]?.value != null ? fmtSigned(r.perKey[k].value, 2) : '—'}</td>
                    ))}
                    <td>{r.relation}</td>
                  </tr>
                  {open ? (
                    <tr className="details-row">
                      <td colSpan={colCount} id={detailId}>
                        <dl className="dgrid">{renderKeyDetails(r)}</dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      <p className="footnote" aria-live="polite">
        Showing {slice.length} of {rows.length} ({commonRows.length} common economies) · page {safePage} of {pages}.
      </p>
      <Pagination page={safePage} pages={pages} total={rows.length} pageSize={pageSize} onPage={onPage} />
    </div>
  );
}

function FxOutsideSection({ sets, focusIso, focusName }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const isMobile = useIsMobile();
  const { keys, obsByKey, outsideByKey, allOutside } = sets;
  const tabs = useMemo(() => ([
    { id: 'all', label: 'All', rows: allOutside },
    ...keys.map((k) => ({ id: `out-${k}`, label: `Outside in ${k}`, key: k, rows: outsideByKey.get(k) ?? [] })),
  ]), [keys, outsideByKey, allOutside]);
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const rows = useMemo(() => {
    const focusRank = activeTab.key ? focusRankOf(obsByKey.get(activeTab.key), focusIso) : null;
    return activeTab.rows
      .map((r) => {
        const rank = activeTab.key
          ? r.rank
          : (keys.map((k) => obsByKey.get(k)?.ranking?.find((x) => x.iso3 === r.iso3)?.rank).find((x) => x != null) ?? null);
        return { ...r, showRank: rank, relation: activeTab.key ? relationOf(r.rank, focusRank) : '—' };
      })
      .filter((r) => matchesTextOrRank(query, r.showRank, r))
      .filter((r) => {
        if (relationFilter === 'all') return true;
        if (relationFilter === 'above') return r.relation === 'above';
        if (relationFilter === 'below') return r.relation === 'below';
        return true;
      });
  }, [activeTab, query, relationFilter, obsByKey, keys, focusIso]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const onPage = (p, size) => {
    if (size && size !== pageSize) { setPageSize(size); setPage(1); return; }
    setPage(p);
  };
  const selectTab = (id) => { setTab(id); setPage(1); setQuery(''); setRelationFilter('all'); };
  return (
    <div>
      <div role="tablist" aria-label="Outside the common comparison set">
        {tabs.flatMap((t, index) => [
          ...(index > 0 ? [' '] : []),
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label} ({t.rows.length})
          </button>,
        ])}
      </div>
      <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Outside filters">
        <Field label="Search name, ISO3, or rank" htmlFor="fxo-q">
          <input
            id="fxo-q"
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={`e.g. ${focusName}, ${focusIso}, or #12`}
          />
        </Field>
        <SearchableSelect
          id="fxo-rel"
          label="Relation filter"
          value={relationFilter}
          searchable={false}
          options={[
            { value: 'all', label: 'All' },
            { value: 'above', label: `Above ${focusName}` },
            { value: 'below', label: `Below ${focusName}` },
          ]}
          onChange={(v) => { setRelationFilter(v); setPage(1); }}
        />
      </form>
      <p className="footnote">Filtering is presentation-only. Outside means present in an observed universe but missing from the common set.</p>
      {isMobile ? (
        slice.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <EconomyMobileList
            rows={slice}
            rankOf={(r) => r.showRank}
            caption="Economies outside the common comparison set"
            focusIso={focusIso}
            focusName={focusName}
            renderSummary={(r) => (
              <>
                {activeTab.key ? null : keys.map((k) => (
                  <CardField key={`in-${k}`} label={`In ${k}`}>
                    {(obsByKey.get(k)?.ranking?.some((x) => x.iso3 === r.iso3)) ? 'yes' : '—'}
                  </CardField>
                ))}
                <CardField label="Observed rank" num>
                  {rankCell(r.showRank)}
                </CardField>
                <CardField label="Observed change %" num>
                  {r.value != null ? fmtSigned(r.value, 2) : '—'}
                </CardField>
                {activeTab.key ? <CardField label={`vs ${focusName}`}>{r.relation}</CardField> : null}
              </>
            )}
          />
        )
      ) : (
        <div className="table-scroll" role="region" aria-label="Outside economies" tabIndex={0}>
        <table className="table table-compact">
          <caption className="sr-only">Economies outside the common comparison set</caption>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Economy</th>
              <th scope="col">ISO3</th>
              {activeTab.key ? null : keys.map((k) => (
                <th key={`in-${k}`} scope="col">In {k}</th>
              ))}
              <th scope="col" className="num">Observed rank</th>
              <th scope="col" className="num">Observed change %</th>
              {activeTab.key ? <th scope="col">vs {focusName}</th> : null}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.iso3} className={r.iso3 === focusIso ? 'row-focus' : undefined}>
                <td className="num">{rankCell(r.showRank)}</td>
                <th scope="row">{r.name ?? r.iso3}</th>
                <td className="mono">{r.iso3}</td>
                {activeTab.key ? null : keys.map((k) => (
                  <td key={`in-${k}`}>{(obsByKey.get(k)?.ranking?.some((x) => x.iso3 === r.iso3)) ? 'yes' : '—'}</td>
                ))}
                <td className="num">{rankCell(r.showRank)}</td>
                <td className="num">{r.value != null ? fmtSigned(r.value, 2) : '—'}</td>
                {activeTab.key ? <td>{r.relation}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <p className="footnote" aria-live="polite">
        Showing {slice.length} of {rows.length} ({activeTab.label}) · page {safePage} of {pages}.
      </p>
      <Pagination page={safePage} pages={pages} total={rows.length} pageSize={pageSize} onPage={onPage} />
    </div>
  );
}

function FxSetPartition({ sets }) {
  const { keys, obsByKey, outsideByKey, commonRows } = sets;
  const common = commonRows.length;
  return (
    <div>
      <div className="partition" role="group" aria-label="Observed-set partitions">
        {keys.map((k) => {
          const observed = obsByKey.get(k)?.eligibleCount ?? obsByKey.get(k)?.ranking?.length ?? 0;
          const outside = outsideByKey.get(k)?.length ?? Math.max(0, observed - common);
          return (
            <div className="partition-row" key={k}>
              <span className="partition-year">{k} observed set</span>
              <span className="partition-bar" aria-label={`${k} observed set: ${common} common plus ${outside} outside equals ${observed}`}>
                <span className="partition-common">{common} common</span>
                <span className="partition-delta">{outside} outside</span>
              </span>
              <span className="partition-total num">
                {observed} = {common} + {outside}
              </span>
            </div>
          );
        })}
      </div>
      <p className="footnote">
        Common means the same member economies across every selected comparison. Outside means present in
        that observed set but missing from at least one other required comparison — a membership
        difference, never a claim about economic entry, exit, or country creation.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Exchange Rate Movement view                                     */
/* ------------------------------------------------------------------ */

export default function FxMovement({ availableYears, yearA, yearB, yearMid = null, metricKey, basis, country = 'IND', countries = [], focusName = 'India', onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry }) {
  const [groupType, setGroupType] = useState(null);
  const [groupValue, setGroupValue] = useState('All');
  const [commonOpen, setCommonOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const breakerActive = yearMid != null && yearA != null && yearB != null && yearMid > Math.min(yearA, yearB) && yearMid < Math.max(yearA, yearB);
  const effectiveBasis = useMemo(() => {
    const opts = movementBases(metricKey, yearA, yearB);
    if (opts.some((b) => b.id === basis)) return basis;
    return opts[0]?.id;
  }, [metricKey, basis, yearA, yearB]);
  const groupsKey = 'fx-groups';
  const { data: groups } = useApi((signal) => api.fxGroups({ signal }), groupsKey, { enabled: true });
  const depsKey = `fx:${metricKey}:${effectiveBasis}:${yearA ?? ''}:${yearB ?? ''}:${breakerActive ? yearMid : 'none'}:${country}:${groupType ?? 'all'}:${groupValue ?? 'All'}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.fxMovement(
        {
          indicator: metricKey,
          basis: effectiveBasis,
          yearA,
          yearB,
          ...(breakerActive ? { yearMid } : {}),
          country,
          ...(groupType && groupValue && groupValue !== 'All' ? { groupType, group: groupValue } : {}),
        },
        { signal },
      ),
    depsKey,
    { enabled: yearA != null && yearB != null && yearA !== yearB && isFxMetricKey(metricKey) },
  );

  const sameYear = yearA != null && yearB != null && yearA === yearB;
  const isLevel = effectiveBasis === 'fx_annual_rate';
  const isAnnual = data?.kind === 'annual';
  const focusIso = data?.focus?.iso3 ?? String(country).toUpperCase();
  const unit = data?.basis?.unit ?? (isLevel ? 'LCU per US$' : '%');
  const sets = useMemo(() => (data?.available ? buildFxSets(data) : null), [data]);
  const rankableSets = useMemo(() => {
    if (!sets) return null;
    const hasRank = (sets.obs ?? []).some((s) => (s.ranking ?? []).length > 0);
    return hasRank ? sets : null;
  }, [sets]);

  const observedChart = useMemo(() => {
    if (!data?.available || !sets || isLevel) return null;
    const rows = (data.observed ?? []).filter((s) => s.focus?.value != null || s.focus?.benchmark != null);
    if (rows.length === 0) return null;
    return { entries: rows.map((s) => ({ x: s.period ?? String(s.year), focus: s.focus?.value ?? null, benchmark: s.focus?.benchmark ?? null })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sets]);

  const lflChart = useMemo(() => {
    if (!data?.available || !sets || isLevel) return null;
    const rows = (data.likeForLike ?? []).filter((s) => s.focus?.value != null || s.focus?.benchmark != null);
    if (rows.length === 0) return null;
    return { entries: rows.map((s) => ({ x: s.period ?? String(s.year), focus: s.focus?.value ?? null, benchmark: s.focus?.benchmark ?? null })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sets]);

  const levelChart = useMemo(() => {
    if (!data?.available || !isLevel) return null;
    const rows = (data.observed ?? []).filter((s) => s.focus?.value != null);
    if (rows.length === 0) return null;
    return rows.map((s) => ({ name: String(s.year), value: s.focus.value }));
  }, [data, isLevel]);

  const series = useMemo(() => ([
    { key: 'focus', label: focusName },
    { key: 'benchmark', label: 'Peer median' },
  ]), [focusName]);

  const keyOf = (s) => s.period ?? String(s.year);

  return (
    <div>
      <FxMovementControls
        availableYears={availableYears}
        yearA={yearA}
        yearB={yearB}
        yearMid={yearMid}
        metricKey={metricKey}
        basis={effectiveBasis}
        country={country}
        countries={countries}
        groupType={groupType}
        groupValue={groupValue}
        groupOptions={groups}
        onYearA={onYearA}
        onYearB={onYearB}
        onYearMid={onYearMid}
        onMetric={onMetric}
        onBasis={onBasis}
        onCountry={onCountry}
        onGroupType={setGroupType}
        onGroupValue={setGroupValue}
        onSwap={() => { if (yearA != null && yearB != null) { onYearA(yearB); onYearB(yearA); } }}
      />
      <p className="card-unit">
        Exchange Rate · Official FX vs USD · Nominal official exchange-rate movement vs USD.
      </p>
      {sameYear ? (
        <StatusBlock
          empty
          emptyText="Start and end years must differ for a Movement comparison."
          sectionName="Exchange Rate analysis"
        />
      ) : (
        <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="Exchange Rate analysis" />
      )}
      {!loading && !error && data && !data.available ? (
        <UnavailableState reason={data.reason} hint="Required World Bank data are incomplete for the selected comparison." />
      ) : null}
      {!loading && !error && data?.available ? (
        <>
          <h3 className="subhead">At a glance</h3>
          <FxGlance data={data} focusName={focusName} />

          <h3 className="subhead">{isAnnual ? 'Selected-year results — Observed and Like-for-like' : 'Period results — Observed and Like-for-like'}</h3>
          <div className="cards" role="region" aria-label={isAnnual ? 'FX selected-year results' : 'FX period results'}>
            {(data.observed ?? []).map((s) => (
              <FxResultCard
                key={keyOf(s)}
                observed={s}
                likeForLike={(data.likeForLike ?? []).find((l) => keyOf(l) === keyOf(s))}
                focusName={focusName}
              />
            ))}
          </div>

          {isLevel && levelChart ? (
            <ChartCard
              title="Official FX rate — selected years"
              unit={unit}
              source="World Bank WDI"
            >
              <BarComparisonChart entries={levelChart.map((e) => ({ name: e.name, value: e.value }))} unit={unit} decimals={2} />
            </ChartCard>
          ) : null}

          {!isLevel ? (
            <>
              <h3 className="subhead">Observed comparison</h3>
              <p>
                Each {isAnnual ? 'year' : 'period'} uses the economies satisfying that comparison&apos;s
                basis-specific data requirement. Universes may differ between {isAnnual ? 'years' : 'periods'}.
              </p>
              {observedChart ? (
                <ChartCard
                  title={`${data.basis?.label} — comparison (observed)`}
                  unit="Nominal FX change vs USD (%)"
                  source="World Bank WDI; calculated by this application"
                >
                  <BarComparisonChart entries={observedChart.entries} series={series} unit="Nominal FX change vs USD (%)" decimals={2} />
                </ChartCard>
              ) : null}

              <h3 className="subhead">Like-for-like comparison</h3>
              <p>
                The same {sets?.commonRows?.length ?? 0} economies across all {isAnnual ? 'years' : 'periods'}
                (intersection of the basis-specific requirements).
              </p>
              {lflChart ? (
                <ChartCard
                  title={`${data.basis?.label} — comparison (like-for-like)`}
                  unit="Nominal FX change vs USD (%)"
                  source="World Bank WDI; calculated by this application"
                >
                  <BarComparisonChart entries={lflChart.entries} series={series} unit="Nominal FX change vs USD (%)" decimals={2} />
                </ChartCard>
              ) : null}
            </>
          ) : null}

          {rankableSets ? (
            <>
              <h3 className="subhead">What changed outside the common comparison set?</h3>
              <p>
                Common: economies present in every selected comparison required for the like-for-like
                universe. Outside: economies in that {isAnnual ? 'year' : 'period'}&apos;s observed set but
                missing from at least one other required comparison.
              </p>
              <FxSetPartition sets={rankableSets} />

              <h3 className="subhead">Common economies — the like-for-like universe</h3>
              <p>
                These {rankableSets.commonRows.length} economies satisfy every comparison&apos;s data requirement and
                are the only economies used in the like-for-like comparison. Ranks and values below are the
                backend like-for-like results.
              </p>
              <p className="footnote">
                <strong>Derived comparison positions — not World Bank ranks.</strong> Like-for-like ranks
                order {focusName} only among the common economies under the same ordering rule.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCommonOpen((v) => !v)}
                aria-expanded={commonOpen}
              >
                {commonOpen ? 'Hide common economies' : `Show common economies (${rankableSets.commonRows.length})`}
              </button>
              {commonOpen ? (
                <FxCommonTable sets={rankableSets} focusIso={focusIso} focusName={focusName} />
              ) : null}

              <h3 className="subhead">Outside the common comparison set</h3>
              <p>
                Economies below are present in an observed universe but missing from the common set.
                They explain why observed and like-for-like universes differ.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setListsOpen((v) => !v)}
                aria-expanded={listsOpen}
              >
                {listsOpen
                  ? 'Hide outside economy details'
                  : `Show outside economy details (outside ${rankableSets.allOutside.length})`}
              </button>
              {listsOpen ? (
                <FxOutsideSection sets={rankableSets} focusIso={focusIso} focusName={focusName} />
              ) : null}
            </>
          ) : null}

          <MethodologyPanel
            source="App-derived"
            indicatorCode={`${data.metric?.indicatorCode} — ${data.metric?.label}`}
            derived={data.basis?.label}
            formula={data.basis?.formula}
          >
            <p className="card-unit">
              Raw series: PA.NUS.FCRF, official annual-average LCU per US$. Raw levels are country-specific
              currency units and are never globally ranked. Percentage changes are dimensionless and
              invariant to currency denomination, so they can be compared across countries.
            </p>
            <p className="card-unit">
              {isLevel
                ? 'Annual level only: selected-country values with no cross-country rank, benchmark, or gap.'
                : 'Observed and like-for-like use identical formulas; only the economy universe differs. Ranks use full backend precision with competition ranking (frozen direction: greatest nominal depreciation first). Benchmark is the leave-one-out median eligible-economy change; gap = country − median (pp). Positive = depreciated more than the peer median.'}
              {data.observed?.[0]?.requiredYears?.length
                ? ` ${requiredLine(data.observed[0])} for the first comparison.`
                : ''}
              Country group: {data.group?.value ?? 'All'}
              {groupType ? ` (${groupType})` : ''} — applied before data-validity checks.
              Classifications are the current retrieved vintage, not historical fact.
            </p>
            <p className="card-unit">
              Nominal official bilateral movement vs USD only — not real, PPP, competitiveness, or
              comprehensive currency-strength measurement. The project stores no authoritative
              currency-redenomination metadata; changes are calculated from stored WDI observations as
              published.
            </p>
          </MethodologyPanel>
        </>
      ) : null}
    </div>
  );
}
