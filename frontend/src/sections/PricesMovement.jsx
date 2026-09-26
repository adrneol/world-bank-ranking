/**
 * Prices Movement (canonical 8-basis methodology).
 *
 * Prices-only analytical layer: QUESTION → ANALYSIS → EXPLANATION → EVIDENCE.
 * Display-only: every value, rank, benchmark, PP and count comes from
 * GET /api/movement/prices. No economics in React.
 *
 * Preserves the organized Movement architecture (Focus / Analysis / Metric /
 * Basis / Start / Middle / End / period cards / Observed / Like-for-like /
 * verification) without dumping raw tables.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import BarComparisonChart from '../components/charts/BarComparisonChart.jsx';
import ChartCard from '../components/charts/ChartCard.jsx';
import { isPricesMetricKey } from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal } from '../utils/format.js';
import { MethodologyPanel, StatusBlock, UnavailableState } from '../components/ui.jsx';
import FocusPicker from '../components/FocusPicker.jsx';
import MetricPicker from '../components/MetricPicker.jsx';
import { SearchableSelect } from '../components/controls.jsx';
import { metricKeysForSubject, movementBases, subjectOf } from '../config/metrics.js';
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

function PeriodCard({ section, focusName, decimals }) {
  const f = section?.focus;
  const basis = section?.basis;
  if (!section) return null;
  if (!f) {
    return (
      <div className="card">
        <h3>{section.period} <span className="card-unit">{basis?.label}</span></h3>
        <UnavailableState reason="missing_focus_value" message="Analysis unavailable: the focus economy lacks the required World Bank observations for this period." />
        <p className="card-unit">Eligible economies: {section.eligibleCount ?? 0} · Required: {(section.requiredYears ?? []).join(', ')}</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>{section.period} <span className="card-unit">{basis?.label}</span></h3>
      <p className="card-rank">{fmt(f.value, decimals)}{basis?.unit ? ` ${basis.unit}` : ''}</p>
      <p className="card-unit">{focusName}: {fmt(f.value, decimals)} · Rank #{f.rank} / {f.denominator}</p>
      <p className="card-unit">Average of other eligible economies: {fmt(f.benchmark, decimals)} (n={f.benchmarkPeerCount})</p>
      <p className="card-unit">Relative gap: {fmtSigned(f.pp, decimals)} percentage points
        {f.pp == null ? '' : f.pp > 0 ? ' (lower than benchmark)' : f.pp < 0 ? ' (higher than benchmark)' : ' (equals benchmark)'}
      </p>
      <p className="card-unit">Universe: {section.universe} · Eligible: {section.eligibleCount} · Required years: {(section.requiredYears ?? []).join(', ')}</p>
      <p className="card-unit">{basis?.rankWording ?? ''}</p>
    </div>
  );
}

function AnnualCard({ section, focusName, decimals }) {
  const f = section?.focus;
  const basis = section?.basis;
  if (!section) return null;
  if (!section.rankable) {
    return (
      <div className="card">
        <h3>{section.year} <span className="card-unit">{basis?.label}</span></h3>
        <p className="card-rank">{f ? `${fmt(f.value, decimals)} ${basis?.unit ?? ''}` : 'n/a'}</p>
        <p className="card-unit">{section.rankNote}</p>
        <p className="card-unit">Eligible economies with a value: {section.eligibleCount}</p>
      </div>
    );
  }
  if (!f) {
    return (
      <div className="card">
        <h3>{section.year} <span className="card-unit">{basis?.label}</span></h3>
        <UnavailableState reason="missing_focus_value" message="Analysis unavailable: the focus economy lacks a valid observation for this year." />
      </div>
    );
  }
  return (
    <div className="card">
      <h3>{section.year} <span className="card-unit">{basis?.label}</span></h3>
      <p className="card-rank">{fmt(f.value, decimals)}{basis?.unit ? ` ${basis.unit}` : ''}</p>
      <p className="card-unit">{focusName}: {fmt(f.value, decimals)} · Rank #{f.rank} / {f.denominator}</p>
      <p className="card-unit">Average of other eligible economies: {fmt(f.benchmark, decimals)} (n={f.benchmarkPeerCount})</p>
      <p className="card-unit">Relative gap: {fmtSigned(f.pp, decimals)} percentage points</p>
      <p className="card-unit">{basis?.rankWording ?? ''}</p>
    </div>
  );
}

export function PricesMovementControls({ availableYears, yearA, yearB, yearMid, metricKey, basis, country, countries, groupType, groupValue, groupOptions, onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry, onGroupType, onGroupValue }) {
  const validMidYears = (availableYears ?? []).filter(
    (y) => yearA != null && yearB != null && y > Math.min(yearA, yearB) && y < Math.max(yearA, yearB),
  );
  const subject = subjectOf(metricKey);
  const basisOptions = movementBases(metricKey, yearA, yearB);
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
      <MetricPicker id="mv-metric" label="Metric" value={metricKey} onChange={onMetric} />
      <SearchableSelect
        id="mv-basis"
        label="Basis"
        value={basis}
        options={basisOptions.map((b) => ({ value: b.id, label: b.label, disabled: !b.available, disabledReason: b.available ? undefined : b.disabledReason }))}
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

export default function PricesMovement({ availableYears, yearA, yearB, yearMid = null, metricKey, basis, country = 'IND', countries = [], focusName = 'India', onYearA, onYearB, onYearMid, onMetric, onBasis, onCountry }) {
  const [groupType, setGroupType] = useState(null);
  const [groupValue, setGroupValue] = useState('All');
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
  const chartData = useMemo(() => {
    if (!data?.available) return null;
    if (isAnnual) {
      // Annual time-series is rendered from observed snapshots (focus values).
      return null;
    }
    const sections = data?.observed ?? [];
    return sections.map((s) => ({ x: s.period, focus: s.focus?.value ?? null, benchmark: s.focus?.benchmark ?? null }));
  }, [data, isAnnual]);

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
      {sameYear ? <StatusBlock title="Select two different years" message="Start and end years must differ for a Movement comparison." /> : null}
      {loading ? <StatusBlock title="Loading Prices analysis…" message="Fetching backend-calculated values." /> : null}
      {error ? (
        <StatusBlock title="Prices analysis unavailable" message={error.message} action={{ label: 'Retry', onClick: retry }} />
      ) : null}
      {!loading && !error && data && !data.available ? (
        <UnavailableState reason={data.reason} message="Analysis unavailable: required World Bank data are incomplete for the selected period." />
      ) : null}
      {!loading && !error && data?.available ? (
        <>
          <div className="cards" role="region" aria-label="Prices focus summary">
            {(isAnnual ? data.observed : data.observed)?.map((s) =>
              isAnnual
                ? <AnnualCard key={`obs-${s.year}`} section={s} focusName={focusName} decimals={decimals} />
                : <PeriodCard key={`obs-${s.period}`} section={s} focusName={focusName} decimals={decimals} />,
            )}
          </div>
          {data.descriptive ? (
            <div className="card">
              <h3>Index-point changes <span className="card-unit">descriptive, no rank</span></h3>
              {data.descriptive.periods.map((p) => (
                <p className="card-unit" key={p.period}>
                  {p.period}: {p.available ? `${fmtSigned(p.indexPointChange, 1)} index points (${fmt(p.startValue, 1)} → ${fmt(p.endValue, 1)})` : 'unavailable (missing observation)'}
                </p>
              ))}
            </div>
          ) : null}
          <h3>Observed comparison</h3>
          <p className="card-unit">Each period uses the economies satisfying that period&apos;s basis-specific data requirement. Universes may differ between periods.</p>
          {!isAnnual && chartData ? (
            <ChartCard
              title={`${data.basis?.label} — period comparison (observed)`}
              unit={data.basis?.unit}
              source="World Bank WDI; calculated by this application"
            >
              <BarComparisonChart
                data={chartData.map((d) => ({ label: d.x, focus: d.focus, benchmark: d.benchmark }))}
                unit={data.basis?.unit}
                decimals={decimals}
              />
            </ChartCard>
          ) : null}
          {isAnnual ? (
            <ChartCard title={`${data.basis?.label} — selected years`} unit={data.basis?.unit} source="World Bank WDI; calculated by this application">
              <BarComparisonChart
                data={(data.observed ?? []).map((s) => ({ label: String(s.year), focus: s.focus?.value ?? null, benchmark: s.focus?.benchmark ?? null }))}
                unit={data.basis?.unit}
                decimals={decimals}
              />
            </ChartCard>
          ) : null}
          <h3>Like-for-like comparison</h3>
          <p className="card-unit">Same economies across all periods (intersection of basis-specific requirements). Directly comparable decades.</p>
          <div className="cards" role="region" aria-label="Prices like-for-like summary">
            {(isAnnual ? data.likeForLike : data.likeForLike)?.map((s) =>
              isAnnual
                ? <AnnualCard key={`lfl-${s.year}`} section={s} focusName={focusName} decimals={decimals} />
                : <PeriodCard key={`lfl-${s.period}`} section={s} focusName={focusName} decimals={decimals} />,
            )}
          </div>
          {!isAnnual ? (
            <ChartCard
              title={`${data.basis?.label} — period comparison (like-for-like)`}
              unit={data.basis?.unit}
              source="World Bank WDI; calculated by this application"
            >
              <BarComparisonChart
                data={(data.likeForLike ?? []).map((s) => ({ label: s.period, focus: s.focus?.value ?? null, benchmark: s.focus?.benchmark ?? null }))}
                unit={data.basis?.unit}
                decimals={decimals}
              />
            </ChartCard>
          ) : null}
          <details>
            <summary>Methodology &amp; verification</summary>
            <MethodologyPanel
              title={data.basis?.label}
              source="World Bank WDI"
              indicator={`${data.metric?.indicatorCode} — ${data.metric?.label}`}
              derivation={isAnnual && !data.observed?.[0]?.rankable ? 'Raw observation (no cross-country rank for index levels)' : 'APP_DERIVED'}
              formula={data.basis?.formula}
            />
            <p className="card-unit">
              Observed and like-for-like use identical formulas; only the economy universe differs.
              Ranks use full backend precision with competition ranking (1,1,3); lower values rank first.
              Benchmark is the unweighted mean of other eligible economies (focus excluded); PP = benchmark − focus.
              A missing required year invalidates the period (never zero-filled or interpolated).
              Country group: {data.group?.value ?? 'All'}
              {groupType ? ` (${groupType})` : ''} — applied before data-validity checks.
              Classifications are the current retrieved vintage, not historical fact.
            </p>
            <p className="card-unit">
              Requested Developed/Developing/Underdeveloped filters are not exposed: the authoritative
              classification data contains income groups, regions and lending types only (see Country group
              selector and /api/prices/country-groups).
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}
