/**
 * Prices Movement (canonical 8-basis methodology).
 *
 * Prices-only analytical layer: QUESTION → ANALYSIS → EXPLANATION → EVIDENCE.
 * Display-only: every value, rank, benchmark, PP, count, ranking list and
 * universe comes from GET /api/movement/prices. No economics in React —
 * only decimal formatting, labels, set-presentation joins of
 * backend-provided ranking lists, and layout.
 *
 * Visual language mirrors the Total GDP / GDP-per-capita Movement
 * interface (summary blocks, cards, facts-groups, Observed vs
 * Like-for-like sections, common/outside economy tables with tabs +
 * search + relation filter + sort + pagination, hide/show disclosures,
 * methodology panels). GDP methodology and GDP components are untouched.
 */

import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import BarComparisonChart from '../components/charts/BarComparisonChart.jsx';
import ChartCard from '../components/charts/ChartCard.jsx';
import { isPricesMetricKey } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal } from '../utils/format.js';
import { Field, MethodologyPanel, Pagination, StatusBlock, UnavailableState } from '../components/ui.jsx';
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

function decimalsFor(basisId) {
  if (basisId === 'cpi_index_annual') return 1;
  return 2;
}

/** Researcher-oriented possessive for any focus country (never hardcoded). */
function possessive(name) {
  const n = String(name ?? 'Focus').trim() || 'Focus';
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
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

function gapInterpretation(pp) {
  if (pp === null || pp === undefined) return '';
  if (pp > 0) return 'Lower than the other-economy average';
  if (pp < 0) return 'Higher than the other-economy average';
  return 'Equal to the other-economy average';
}

function lowerFirst(s) {
  const t = String(s ?? '');
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/**
 * User-facing unit for a backend unit string. Display-only: backend
 * metadata is untouched. For the annual CPI index basis the repeated
 * "(2010 = 100)" qualifier is dropped so the card shows e.g.
 * "63.4 index points" instead of "63.4 index points (2010 = 100)".
 */
function displayUnit(basisId, unit) {
  if (basisId === 'cpi_index_annual' && typeof unit === 'string') {
    const stripped = unit.replace(/\s*\(\s*2010\s*=\s*100\s*\)\s*/g, '').trim();
    return stripped || 'index points';
  }
  return unit;
}

/**
 * Basis-aware required-observations line. Endpoint-only bases (CPI period
 * change) name their two endpoint years; sequence bases (inflation /
 * deflator average, cumulative) name the S+1…E annual span. Pure display
 * of the backend `requiredYears` array — never a recalculation.
 */
function requiredLine(section) {
  const yrs = section?.requiredYears ?? [];
  if (!yrs.length) return null;
  if (section?.basis?.id === 'cpi_index_period_change') {
    return `Required endpoint observations: ${yrs.join(', ')} (${yrs.length})`;
  }
  return `Required annual observations: ${yrs[0]}–${yrs[yrs.length - 1]} (${yrs.length})`;
}

/* ------------------------------------------------------------------ */
/* Controls (same filter-grid hierarchy as GDP Movement + group filter) */
/* ------------------------------------------------------------------ */

export function PricesMovementControls({ availableYears, yearA, yearB, yearMid, metricKey, basis, country, countries, groupType, groupValue, groupOptions, onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry, onGroupType, onGroupValue, onSwap }) {
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
    <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Prices comparison controls">
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
/* At-a-glance period summary: compact headline blocks (no paragraphs). */
/* Every figure is a backend field; only formatting happens here.       */
/* ------------------------------------------------------------------ */

function GlanceBlock({ label, observed, likeForLike, focusName }) {
  const f = observed?.focus;
  const lf = likeForLike?.focus;
  const basisId = observed?.basis?.id ?? likeForLike?.basis?.id;
  const decimals = decimalsFor(basisId);
  const unit = displayUnit(basisId, observed?.basis?.unit ?? likeForLike?.basis?.unit ?? '');
  const basisLabel = observed?.basis?.label ?? likeForLike?.basis?.label ?? '';
  if (!f) {
    return (
      <div className="card">
        <h3>{label}</h3>
        <p className="card-unit">{basisLabel}</p>
        <p className="card-rank">n/a</p>
        <p className="card-unit">Missing required World Bank observations for {focusName}.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>{label}</h3>
      <p className="card-unit">{possessive(focusName)} {lowerFirst(basisLabel)}</p>
      <p className="card-result-value" aria-label={`${focusName} ${basisLabel} ${fmt(f.value, decimals)} in ${label}`}>
        {fmt(f.value, decimals)}{unit ? ` ${unit}` : ''}
      </p>
      <dl className="facts">
        <div>
          <dt>Observed</dt>
          <dd className="num">{f.rank != null ? `#${f.rank} / ${f.denominator}` : 'n/a'}</dd>
        </div>
        <div>
          <dt>Like-for-like</dt>
          <dd className="num">{lf && lf.rank != null ? `#${lf.rank} / ${lf.denominator}` : 'n/a'}</dd>
        </div>
        <div>
          <dt>Other-economy average</dt>
          <dd className="num">{f.benchmark != null ? `${fmt(f.benchmark, decimals)}${unit ? ` ${unit}` : ''} · ${f.benchmarkPeerCount} ${f.benchmarkPeerCount === 1 ? 'economy' : 'economies'}` : 'n/a'}</dd>
        </div>
        <div>
          <dt>Gap</dt>
          <dd className="num">{f.pp != null ? `${fmtSigned(f.pp, decimals)} pp (${gapInterpretation(f.pp).charAt(0).toLowerCase() + gapInterpretation(f.pp).slice(1)})` : 'n/a'}</dd>
        </div>
      </dl>
    </div>
  );
}

function PricesGlance({ data, focusName }) {
  const obs = data?.observed ?? [];
  const lfl = data?.likeForLike ?? [];
  if (!data?.available || obs.length === 0) return null;
  const keyOf = (s) => s.period ?? String(s.year);
  const lflByKey = new Map(lfl.map((s) => [keyOf(s), s]));
  return (
    <div className="cards" role="region" aria-label="Period summary at a glance">
      {obs.map((s) => (
        <GlanceBlock key={keyOf(s)} label={keyOf(s)} observed={s} likeForLike={lflByKey.get(keyOf(s))} focusName={focusName} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Period / annual result card: header → hero → compact grid → gap.     */
/* GDP GrowthIntervalCard pattern with Prices backend fields.           */
/* ------------------------------------------------------------------ */

function statBox(label, value, valueClass, key) {
  return (
    <div key={key} className="denominators">
      <p className="card-unit">{label}</p>
      <div className={valueClass}>{value}</div>
    </div>
  );
}

function sectionFacts(section, focusName, decimals, heading, groupLabel) {
  const f = section?.focus;
  const basisId = section?.basis?.id;
  const unit = displayUnit(basisId, section?.basis?.unit) ? ` ${displayUnit(basisId, section?.basis?.unit)}` : '';
  const basisLabel = section?.basis?.label ?? '';
  const req = requiredLine(section);
  if (!f) {
    return (
      <div className="facts-group growth-section" role="group" aria-label={groupLabel}>
        <h4 className="facts-group-title">{heading}</h4>
        {statBox(`${possessive(focusName)} ${lowerFirst(basisLabel)}`, 'n/a', 'card-rank', 'value')}
        {statBox('Eligible economies', `${section?.eligibleCount ?? 0}`, 'card-rank', 'universe')}
        <p className="card-unit">Analysis unavailable for {focusName}: missing required World Bank observations.</p>
        {req ? <p className="card-unit">{req}</p> : null}
      </div>
    );
  }
  return (
    <div className="facts-group growth-section" role="group" aria-label={groupLabel}>
      <h4 className="facts-group-title">{heading}</h4>
      {statBox(`${possessive(focusName)} rank`, f.rank != null ? `#${f.rank} / ${f.denominator}` : 'n/a (no rank for this basis)', 'card-rank', 'rank')}
      {statBox('Eligible economies', `${section.eligibleCount}`, 'card-rank', 'universe')}
      {statBox(
        'Other-economy average',
        f.benchmark != null ? `${fmt(f.benchmark, decimals)}${unit} · ${f.benchmarkPeerCount} ${f.benchmarkPeerCount === 1 ? 'economy' : 'economies'}` : 'n/a (no comparison universe)',
        'card-rank',
        'average',
      )}
      {statBox(
        `${focusName} vs other-economy average`,
        f.pp != null ? `${fmtSigned(f.pp, decimals)} percentage points (${gapInterpretation(f.pp).charAt(0).toLowerCase() + gapInterpretation(f.pp).slice(1)})` : 'n/a',
        'duo-rank',
        'difference',
      )}
      {req ? <p className="card-unit">{req}</p> : null}
    </div>
  );
}

function PricesResultCard({ observed, likeForLike, focusName }) {
  const key = observed ? (observed.period ?? String(observed.year)) : '?';
  const basisId = observed?.basis?.id ?? likeForLike?.basis?.id;
  const basisLabel = observed?.basis?.label ?? likeForLike?.basis?.label ?? '';
  const unit = displayUnit(basisId, observed?.basis?.unit ?? likeForLike?.basis?.unit ?? '');
  const rankWording = observed?.basis?.rankWording ?? likeForLike?.basis?.rankWording;
  const f = observed?.focus;
  const decimals = decimalsFor(basisId);
  return (
    <div className="card">
      <h3>{key} <span className="card-unit">{basisLabel}</span></h3>
      <p className="card-unit">{possessive(focusName)} {lowerFirst(basisLabel)}</p>
      <p className="card-result-value" aria-label={`${possessive(focusName)} ${lowerFirst(basisLabel)} ${f ? fmt(f.value, decimals) : 'unavailable'} in ${key}`}>
        {f ? `${fmt(f.value, decimals)}${unit ? ` ${unit}` : ''}` : 'n/a'}
      </p>
      <p className="card-unit">{rankWording ?? 'Index level — descriptive, no cross-country rank.'}</p>
      {observed ? sectionFacts(observed, focusName, decimals, 'Observed', `Observed comparison for ${key}`) : null}
      {likeForLike ? sectionFacts(likeForLike, focusName, decimals, 'Like-for-like', `Like-for-like comparison for ${key}`) : null}
      <p className="footnote">The average excludes {focusName} and never affects ranking.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Common / outside presentation built from backend ranking lists.     */
/* Common = intersection of the like-for-like ranking sets; outside =  */
/* observed-minus-common per section. No economics recomputed: ranks,  */
/* values, counts and focus positions are backend-provided; only       */
/* display joins, search, sort and pagination happen here.              */
/* ------------------------------------------------------------------ */

function buildPriceSets(data) {
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
    outsideByKey.set(
      k,
      (s.ranking ?? []).filter((r) => !commonSet.has(r.iso3)),
    );
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

function PriceCommonTable({ sets, focusIso, focusName, decimals, unit }) {
  const tableId = useId();
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [sort, setSort] = useState('rank-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { keys, lflByKey, commonRows } = sets;
  const refKey = keys[keys.length - 1];
  const refSection = lflByKey.get(refKey);
  const refFocusRank = focusRankOf(refSection, focusIso);
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
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const byIso = (x, y) => (x.iso3 < y.iso3 ? -1 : x.iso3 > y.iso3 ? 1 : 0);
    const sorted = [...related];
    switch (sort) {
      case 'rank-desc':
        sorted.sort((x, y) => (y.refRank ?? -Infinity) - (x.refRank ?? -Infinity) || byIso(x, y));
        break;
      case 'value-asc':
        sorted.sort((x, y) => (num(x.refValue) ?? Infinity) - (num(y.refValue) ?? Infinity) || byIso(x, y));
        break;
      case 'value-desc':
        sorted.sort((x, y) => (num(y.refValue) ?? -Infinity) - (num(x.refValue) ?? -Infinity) || byIso(x, y));
        break;
      case 'rank-asc':
      default:
        sorted.sort((x, y) => (x.refRank ?? Infinity) - (y.refRank ?? Infinity) || byIso(x, y));
    }
    return sorted;
  }, [commonRows, query, relationFilter, sort, refKey, refFocusRank]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const slice = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const onPage = (p, size) => {
    if (size && size !== pageSize) { setPageSize(size); setPage(1); return; }
    setPage(p);
  };
  const [openIso, setOpenIso] = useState(null);
  const colCount = 4 + 2 * keys.length;
  return (
    <div>
      <form className="filter-grid" onSubmit={(e) => e.preventDefault()} aria-label="Common economy filters">
        <Field label="Search name, ISO3, or rank" htmlFor={`pc-q-${tableId}`}>
          <input
            id={`pc-q-${tableId}`}
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={`e.g. ${focusName}, ${focusIso}, or #12`}
          />
        </Field>
        <SearchableSelect
          id={`pc-rel-${tableId}`}
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
          id={`pc-sort-${tableId}`}
          label="Sort"
          value={sort}
          searchable={false}
          options={[
            { value: 'rank-asc', label: 'Rank — best first' },
            { value: 'rank-desc', label: 'Rank — lowest first' },
            { value: 'value-asc', label: 'Value — low to high' },
            { value: 'value-desc', label: 'Value — high to low' },
          ]}
          onChange={(v) => { setSort(v); setPage(1); }}
        />
      </form>
      <p className="footnote">Filtering is presentation-only. Ranks and universes always come from the backend.</p>
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
                <th key={`value-${k}`} scope="col" className="num">{k} value</th>
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
                      <td key={`value-${k}`} className="num">
                        {r.perKey[k]?.value != null ? `${fmt(r.perKey[k].value, decimals)}` : '—'}
                      </td>
                    ))}
                    <td>{r.relation}</td>
                  </tr>
                  {open ? (
                    <tr className="details-row">
                      <td colSpan={colCount} id={detailId}>
                        <dl className="dgrid">
                          {keys.map((k) => (
                            <Fragment key={k}>
                              <div>
                                <dt>{k} rank</dt>
                                <dd className="num">{rankCell(r.perKey[k]?.rank)}</dd>
                              </div>
                              <div>
                                <dt>{k} value</dt>
                                <dd className="num">{r.perKey[k]?.value != null ? `${fmt(r.perKey[k].value, decimals)}${unit ? ` ${unit}` : ''}` : '—'}</dd>
                              </div>
                            </Fragment>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footnote" aria-live="polite">
        Showing {slice.length} of {rows.length} ({commonRows.length} common economies) · page {safePage} of {pages}.
      </p>
      <Pagination page={safePage} pages={pages} total={rows.length} pageSize={pageSize} onPage={onPage} />
    </div>
  );
}

function PriceOutsideSection({ sets, focusIso, focusName, decimals, unit }) {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
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
        <Field label="Search name, ISO3, or rank" htmlFor="po-q">
          <input
            id="po-q"
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={`e.g. ${focusName}, ${focusIso}, or #12`}
          />
        </Field>
        <SearchableSelect
          id="po-rel"
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
              <th scope="col" className="num">Observed value{unit ? ` (${unit})` : ''}</th>
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
                <td className="num">{r.value != null ? fmt(r.value, decimals) : '—'}</td>
                {activeTab.key ? <td>{r.relation}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote" aria-live="polite">
        Showing {slice.length} of {rows.length} ({activeTab.label}) · page {safePage} of {pages}.
      </p>
      <Pagination page={safePage} pages={pages} total={rows.length} pageSize={pageSize} onPage={onPage} />
    </div>
  );
}

/**
 * Year-by-year (annual kind) or period-by-period outside-common-set
 * partition. GDP partition pattern: each row shows one observed set as
 * common + outside. All counts come from backend ranking lists.
 */
function PriceSetPartition({ sets }) {
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
/* Main Prices Movement view                                           */
/* ------------------------------------------------------------------ */

export default function PricesMovement({ availableYears, yearA, yearB, yearMid = null, metricKey, basis, country = 'IND', countries = [], focusName = 'India', onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry }) {
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
  const groupsKey = 'price-groups';
  const { data: groups } = useApi((signal) => api.priceGroups({ signal }), groupsKey, { enabled: true });
  const depsKey = `prices:${metricKey}:${effectiveBasis}:${yearA ?? ''}:${yearB ?? ''}:${breakerActive ? yearMid : 'none'}:${country}:${groupType ?? 'all'}:${groupValue ?? 'All'}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.pricesMovement(
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
    { enabled: yearA != null && yearB != null && yearA !== yearB && isPricesMetricKey(metricKey) },
  );

  const decimals = decimalsFor(effectiveBasis);
  const sameYear = yearA != null && yearB != null && yearA === yearB;
  const isAnnual = data?.kind === 'annual';
  const focusIso = data?.focus?.iso3 ?? String(country).toUpperCase();
  const unit = displayUnit(effectiveBasis, data?.basis?.unit ?? null);

  const sets = useMemo(() => (data?.available ? buildPriceSets(data) : null), [data]);

  const observedChart = useMemo(() => {
    if (!data?.available || !sets) return null;
    const rows = (data.observed ?? []).filter((s) => s.focus?.value != null || s.focus?.benchmark != null);
    if (rows.length === 0) return null;
    return {
      entries: rows.map((s) => ({
        x: s.period ?? String(s.year),
        focus: s.focus?.value ?? null,
        benchmark: s.focus?.benchmark ?? null,
      })),
    };
  }, [data, sets]);

  const lflChart = useMemo(() => {
    if (!data?.available || !sets) return null;
    const rows = (data.likeForLike ?? []).filter((s) => s.focus?.value != null || s.focus?.benchmark != null);
    if (rows.length === 0) return null;
    return {
      entries: rows.map((s) => ({
        x: s.period ?? String(s.year),
        focus: s.focus?.value ?? null,
        benchmark: s.focus?.benchmark ?? null,
      })),
    };
  }, [data, sets]);

  const series = useMemo(() => ([
    { key: 'focus', label: focusName },
    { key: 'benchmark', label: 'Other-economy average' },
  ]), [focusName]);

  const keyOf = (s) => s.period ?? String(s.year);

  return (
    <div>
      <PricesMovementControls
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
      {sameYear ? (
        <StatusBlock
          empty
          emptyText="Start and end years must differ for a Movement comparison."
          sectionName="Prices analysis"
        />
      ) : (
        <StatusBlock loading={loading} error={error} empty={false} onRetry={retry} sectionName="Prices analysis" />
      )}
      {!loading && !error && data && !data.available ? (
        <UnavailableState reason={data.reason} hint="Required World Bank data are incomplete for the selected period." />
      ) : null}
      {!loading && !error && data?.available ? (
        <>
          <h3 className="subhead">At a glance</h3>
          <PricesGlance data={data} focusName={focusName} />
          {data.descriptive ? (
            <div className="card">
              <h3>Index-point changes <span className="card-unit">descriptive, no rank</span></h3>
              <dl className="facts">
                {data.descriptive.periods.map((p) => (
                  <div key={p.period}>
                    <dt>{p.period}</dt>
                    <dd className="num">
                      {p.available ? `${fmtSigned(p.indexPointChange, 1)} index points (${fmt(p.startValue, 1)} → ${fmt(p.endValue, 1)})` : 'unavailable (missing observation)'}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <h3 className="subhead">{isAnnual ? 'Selected-year results — Observed and Like-for-like' : 'Period results — Observed and Like-for-like'}</h3>
          <div className="cards" role="region" aria-label={isAnnual ? 'Prices selected-year results' : 'Prices period results'}>
            {(data.observed ?? []).map((s) => (
              <PricesResultCard
                key={keyOf(s)}
                observed={s}
                likeForLike={(data.likeForLike ?? []).find((l) => keyOf(l) === keyOf(s))}
                focusName={focusName}
              />
            ))}
          </div>

          <h3 className="subhead">Observed comparison</h3>
          <p>
            Each {isAnnual ? 'year' : 'period'} uses the economies satisfying that comparison&apos;s
            basis-specific data requirement. Universes may differ between {isAnnual ? 'years' : 'periods'}.
          </p>
          {observedChart ? (
            <ChartCard
              title={`${data.basis?.label} — comparison (observed)`}
              unit={unit}
              source="World Bank WDI; calculated by this application"
            >
              <BarComparisonChart entries={observedChart.entries} series={series} unit={unit} decimals={decimals} />
            </ChartCard>
          ) : null}

          <h3 className="subhead">Like-for-like comparison</h3>
          <p>
            The same {sets?.commonRows?.length ?? 0} economies across all {isAnnual ? 'years' : 'periods'}
            (intersection of the basis-specific requirements). Directly comparable {isAnnual ? 'years' : 'decades'}.
          </p>
          {lflChart ? (
            <ChartCard
              title={`${data.basis?.label} — comparison (like-for-like)`}
              unit={unit}
              source="World Bank WDI; calculated by this application"
            >
              <BarComparisonChart entries={lflChart.entries} series={series} unit={unit} decimals={decimals} />
            </ChartCard>
          ) : null}

          {sets ? (
            <>
              <h3 className="subhead">What changed outside the common comparison set?</h3>
              <p>
                Common: economies present in every selected comparison required for the like-for-like
                universe. Outside: economies in that {isAnnual ? 'year' : 'period'}&apos;s observed set but
                missing from at least one other required comparison.
              </p>
              <PriceSetPartition sets={sets} />

              <h3 className="subhead">Common economies — the like-for-like universe</h3>
              <p>
                These {sets.commonRows.length} economies satisfy every comparison&apos;s data requirement and
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
                {commonOpen ? 'Hide common economies' : `Show common economies (${sets.commonRows.length})`}
              </button>
              {commonOpen ? (
                <PriceCommonTable sets={sets} focusIso={focusIso} focusName={focusName} decimals={decimals} unit={unit} />
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
                  : `Show outside economy details (outside ${sets.allOutside.length})`}
              </button>
              {listsOpen ? (
                <PriceOutsideSection sets={sets} focusIso={focusIso} focusName={focusName} decimals={decimals} unit={unit} />
              ) : null}
            </>
          ) : null}

          <MethodologyPanel
            source={isAnnual && !data.observed?.[0]?.rankable ? 'Raw observation (no cross-country rank for index levels)' : 'App-derived'}
            indicatorCode={`${data.metric?.indicatorCode} — ${data.metric?.label}`}
            derived={data.basis?.label}
            formula={data.basis?.formula}
          >
            <p className="card-unit">
              Observed and like-for-like use identical formulas; only the economy universe differs.
              Ranks use full backend precision with competition ranking (1,1,3); lower values rank first.
              The other-economy average is the unweighted mean of other eligible economies ({focusName} excluded);
              PP = average − {possessive(focusName)} value.
              A missing required year invalidates the comparison (never zero-filled or interpolated).
              {requiredLine(data.observed?.[0]) ? ` ${requiredLine(data.observed[0])} for the first comparison.` : ''}
              Country group: {data.group?.value ?? 'All'}
              {groupType ? ` (${groupType})` : ''} — applied before data-validity checks.
              Classifications are the current retrieved vintage, not historical fact.
            </p>
            <p className="card-unit">
              Requested Developed/Developing/Underdeveloped filters are not exposed: the authoritative
              classification data contains income groups, regions and lending types only (see Country group
              selector and /api/prices/country-groups).
            </p>
          </MethodologyPanel>
        </>
      ) : null}
    </div>
  );
}
