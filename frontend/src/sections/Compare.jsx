/**
 * Compare workspace.
 *
 * Entity A vs Entity B (country, official aggregate, or request-defined
 * group) × metric × period × capability-filtered operation.
 *
 * The backend is authoritative: every number, every coverage statement and
 * every chart series comes from one authoritative /api/compare response. The
 * UI never recomputes an analytical value, never re-fetches observations for
 * a chart and never shows observed and like-for-like results side by side —
 * the selected mode decides which result set is rendered.
 *
 * Three-year model: Year A (start), Year B (optional partition), Year C
 * (end). A selected year that the chosen analysis does not use is reported
 * by the backend (analysis.ignoredPeriods) and explained here — never
 * silently dropped.
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import CompareUniversePanel from '../components/CompareUniversePanel.jsx';
import EntityPicker from '../components/EntityPicker.jsx';
import BarComparisonChart from '../components/charts/BarComparisonChart.jsx';
import ChartCard from '../components/charts/ChartCard.jsx';
import IntervalLineChart from '../components/charts/IntervalLineChart.jsx';
import AnnualChart from '../components/charts/AnnualChart.jsx';
import { ChartTypeToggle, HistoryWindowControls } from '../components/charts/ChartControls.jsx';
import { calendarYears, scaleDetailFor } from '../components/charts/chartData.js';
import { formatAnnualReadout } from '../components/charts/chartFormat.js';
import { AnalyticalTable, MeasurementHeading } from '../components/AnalyticalTable.jsx';
import { entityDisplayName, entityToSpec, parseEntitySpecString } from '../components/entities.js';
import { SearchableSelect } from '../components/controls.jsx';
import MetricPicker from '../components/MetricPicker.jsx';
import {
  ChartDataFallback,
  EmptyState,
  EntityBadge,
  MethodologyPanel,
  ProvenanceBadge,
  Section,
  StatusBlock,
  UnavailableState,
} from '../components/ui.jsx';
import {
  COMPARE_OPERATIONS,
  comparePeriodRequirements,
  resolveCanonicalMetric,
  SUBJECTS,
  metricKeysForSubject,
  subjectOf,
  subjectLabel,
  metricLabel,
  compareMethodOptions,
  metricDecimals,
  supportsGroupValues,
} from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal, readableReason } from '../utils/format.js';
import { compareCurrencySymbol, compareResultDecimals, compareResultParts, formatCompareResult } from '../utils/compareFormat.js';

/**
 * Raw backend number in metric units → registry displayDecimals. GDP
 * per-capita pins 0, RATE/RATIO/FX pin 2, INDEX pins 1. Presentation only.
 */
function isTotalGdp(metricKey) {
  return subjectOf(metricKey) === 'gdp_total';
}

function formatValuePlain(value, metricKey) {
  return formatDecimal(value, metricDecimals(metricKey));
}

function resultAmount(value, unit, metricKey, options) {
  return formatCompareResult(value, unit, metricDecimals(metricKey), options);
}

function changeDecimals(unit, metricKey) {
  return compareResultDecimals(unit, metricDecimals(metricKey));
}

function YearSelect({ id, label, years, value, onChange, hint, optional = false, disabled = false }) {
  return (
    <SearchableSelect
      id={id}
      label={label}
      hint={hint}
      value={value != null ? String(value) : ''}
      placeholder="Select year…"
      disabled={disabled}
      options={[
        ...(optional ? [{ value: '', label: 'Not selected' }] : []),
        ...(years ?? []).map((y) => ({ value: String(y), label: String(y) })),
      ]}
      onChange={(v) => onChange(v === '' ? null : Number(v))}
    />
  );
}

function yearControlInfo(operation, role, yearC = null) {
  const periods = comparePeriodRequirements(operation);
  if (operation === 'cross_rate') {
    return { optional: role !== 'a', disabled: role !== 'a', hint: role === 'a' ? 'Required by this analysis.' : 'Cross-rate uses the start year only.' };
  }
  if (operation === 'level') {
    return { optional: role !== 'a', disabled: false, hint: role === 'a' ? 'Required. Additional selected years are compared in chronological order.' : 'Optional. Selected periods appear in the level table and trajectory.' };
  }
  if (role === 'a') return { optional: false, disabled: false, hint: 'Required start year.' };
  if (role === 'c') return { optional: !periods.requiresEnd, disabled: false, hint: 'Endpoint used by the analysis.' };
  const hint = operation === 'period_total_growth'
    ? 'Splits the full span into adjacent periods. Growth compares the two period totals.'
    : periods.usesMid || periods.showOptionalMid
      ? yearC == null && !periods.requiresEnd ? 'Used as the end year until an explicit end year is selected.' : 'Adds first-period and second-period results where supported.'
      : 'This method uses the start and end years.';
  return { optional: true, disabled: false, hint };
}

const intervalPeriod = ({ start, end }) => start === end ? String(start) : `${start}–${end}`;
const yearTerms = { a: 'Start year', b: 'Middle year', c: 'End year' };
const chronology = (text) => typeof text === 'string' ? text.replace(/Year ([ABC])\b/g, (_, slot) => yearTerms[slot.toLowerCase()]) : text;

function operationLabel(id) {
  return COMPARE_OPERATIONS.find((op) => op.id === id)?.label ?? id;
}

/** Mode-aware value map of one entity slot. */
function modeValueMap(slot, mode) {
  if (!slot) return {};
  if (mode === 'like_for_like' && slot.likeForLike) return slot.likeForLike;
  if (mode === 'observed' && slot.observed) return slot.observed;
  return slot.values ?? {};
}

/** The value of one entity at one year, or null when it is not published. */
function slotValue(entry) {
  if (!entry) return null;
  if (typeof entry.available === 'boolean') return entry.available ? entry.value : null;
  return entry.value ?? null;
}

/** Whether the published value is complete under the selected methodology. */
function slotComplete(entry) {
  if (!entry) return false;
  if (typeof entry.complete === 'boolean') return entry.complete;
  if (typeof entry.available === 'boolean') return entry.available;
  return false;
}

/** Reason a value is not publishable, when it is not. */
function slotReason(entry) {
  if (!entry) return 'MISSING_REQUIRED_DATA';
  if (slotComplete(entry)) return null;
  return entry.reason ?? 'MISSING_REQUIRED_DATA';
}

function entityDisplayNameFor(entity, countries, aggregates) {
  if (!entity) return '—';
  if (entity.kind === 'custom_group') return entity.label ?? entityDisplayName(entity, countries, aggregates);
  if (entity.kind === 'wb_aggregate') return aggregates.find((a) => a.iso3 === entity.iso3)?.name ?? entity.name ?? entity.iso3;
  return countries.find((c) => c.iso3 === entity.iso3)?.name ?? entity.name ?? entity.iso3;
}

function EntityResultCard({ slot, entity, countries, aggregates, mode, metricKey, years }) {
  const name = entityDisplayNameFor(entity, countries, aggregates);
  const values = modeValueMap(entity, mode);
  const list = (years ?? []).map(String).filter((year) => values[year] !== undefined);
  return (
    <div className="compare-entity">
      <h3>
        {slot === 'a' ? 'Entity A' : 'Entity B'} — {name} <EntityBadge kind={entity.kind} />
      </h3>
      <p className="footnote">
        {mode === 'like_for_like' ? 'Like-for-like value' : 'Observed value'}
        {entity.coverageBasis?.note ? ` — ${entity.coverageBasis.note}` : ''}
      </p>
      {entity.kind === 'custom_group' ? (
        <ul className="chip-list" aria-label={`${name} members`}>
          {entity.members.map((iso3) => (
            <li key={iso3} className="chip">
              <span>
                {entity.memberNames?.[iso3] ?? countries.find((c) => c.iso3 === iso3)?.name ?? iso3}{' '}
                <span className="mono muted">{iso3}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="coverage-list">
        {list.map((year) => {
          const entry = values[year];
          const value = slotValue(entry);
          const complete = slotComplete(entry);
          return (
            <li key={year}>
              {year}: {complete ? (
                <>
                  <strong>{formatValuePlain(value, metricKey)}</strong>
                  {entry.members !== undefined ? ` (${entry.members} members)` : ''}
                </>
              ) : (
                <>
                  <span className="partial-badge">Partial coverage</span>{' '}
                  {entry.missingCount > 0
                    ? `${entry.missingCount} member${entry.missingCount === 1 ? '' : 's'} without an observation (${(entry.missingIso3 ?? []).join(', ')})`
                    : `No publishable value — ${readableReason(slotReason(entry))}`}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {entity.coverageBasis?.usedMemberCount !== undefined ? (
        <p className="footnote">
          Countries used: {entity.coverageBasis.usedMemberCount}
          {entity.coverageBasis.usedMembers?.length ? ` (${entity.coverageBasis.usedMembers.join(', ')})` : ''}
        </p>
      ) : null}
    </div>
  );
}

function ResultValue({ value, unit, metricKey, signed = false }) {
  const { amount, suffix } = compareResultParts(value, unit, metricDecimals(metricKey), { compact: isTotalGdp(metricKey), signed });
  return <p className="result-value">{amount}{suffix && <span className="result-unit">{suffix}</span>}</p>;
}

function ChangeBlock({ title, change, metricKey }) {
  if (!change) return null;
  if (!change.computable) {
    return (
      <div>
        <p className="lfl-label">{title}</p>
        <UnavailableState reason={change.reason} hint="The other side may still be valid — see its card." />
      </div>
    );
  }
  return (
    <div>
      <p className="lfl-label">{title}</p>
      <ResultValue value={change.value} unit={change.unit} metricKey={metricKey} signed />
    </div>
  );
}

/** Structured, backend-generated diagnostics for a blocked calculation. */
function DiagnosticsPanel({ diagnostics }) {
  if (!diagnostics || diagnostics.length === 0) return null;
  return (
    <section className="compare-diagnostics" aria-label="Calculation diagnostics">
      <h3>Why this result is not complete</h3>
      <ul className="diagnostic-list">
        {diagnostics.map((d, index) => (
          <li key={`${d.code}-${d.scope}-${index}`} className="diagnostic-item">
            <span className="partial-badge">{readableReason(d.code)}</span>{' '}
            <span className="muted">
              {d.scope === 'entity_a' ? 'Entity A' : d.scope === 'entity_b' ? 'Entity B' : 'The comparison'}
              {d.entity ? ` — ${d.entity}` : ''}
              {d.years?.length ? ` — ${d.years.join(', ')}` : ''}
            </span>
            {d.detail ? <p className="footnote">{chronology(d.detail)}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ComparisonResult({ data, metricKey }) {
  const { results, metric, operation } = data;
  const comparison = results.comparison;
  const unit = metric.unitLong ?? metric.unit;
  const nameOf = (e) => (e?.kind === 'custom_group' ? (e?.label ?? 'group') : (e?.name ?? e?.iso3 ?? ''));

  if (operation === 'cross_rate') {
    if (!comparison.available) {
      return <UnavailableState reason={comparison.reason} code={comparison.reason} hint={comparison.detail ?? undefined} />;
    }
    return (
      <div className="result-cards">
        <article className="card card-result">
          <h3>
            Cross-rate <ProvenanceBadge kind="APP_DERIVED" />
          </h3>
          <ResultValue value={comparison.value} unit={comparison.provenance?.outputUnit ?? comparison.unit} metricKey={metricKey} />
          <p className="footnote">
            {comparison.legs.a.iso3}: {formatValuePlain(comparison.legs.a.value, metricKey)} · {comparison.legs.b.iso3}:{' '}
            {formatValuePlain(comparison.legs.b.value, metricKey)} ({data.years.a})
          </p>
        </article>
      </div>
    );
  }

  if (operation === 'level') {
    const perYear = comparison.perYear ?? {};
    const years = Object.keys(perYear).sort();
    const barRows = years.map((year) => ({ x: year, A: perYear[year]?.a ?? null, B: perYear[year]?.b ?? null }));
    const involvesDerived = [results.a, results.b].some((e) => e?.kind === 'custom_group');
    return (
      <>
      <details className="compare-evidence">
        <summary>Observations and calculations</summary>
      <AnalyticalTable label="Level comparison by year">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  <MeasurementHeading label="A" unit={unit} />
                </th>
                <th scope="col" className="num">
                  <MeasurementHeading label="B" unit={unit} />
                </th>
                <th scope="col" className="num">
                  <MeasurementHeading label="Gap (A − B)" unit={comparison.unit ?? unit} />
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => {
                const row = perYear[year];
                return (
                  <tr key={year}>
                    <th scope="row">{year}</th>
                    <td className="num"><CompareObservationValue value={row.a} metricKey={metricKey} /></td>
                    <td className="num"><CompareObservationValue value={row.b} metricKey={metricKey} /></td>
                    <td className="num" title={row.gapReason ? readableReason(row.gapReason) : undefined}>
                      {row.gap === null || row.gap === undefined ? '—' : resultAmount(row.gap, row.unit ?? comparison.unit, metricKey)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="footnote">Gap unit: {comparison.unit ?? unit}. Missing legs stay missing.</p>
        </AnalyticalTable>
        </details>
        {years.length === 1 ? (
          <ChartCard
            title={`Level values — ${nameOf(results.a)} vs ${nameOf(results.b)}`}
            unit={unit}
            derived={involvesDerived}
            summary={`${nameOf(results.a)} vs ${nameOf(results.b)} level values by year`}
          >
            <BarComparisonChart
              entries={barRows}
              series={[
                { key: 'A', label: nameOf(results.a) },
                { key: 'B', label: nameOf(results.b) },
              ]}
              unit={unit}
              decimals={metricDecimals(metricKey)}
              formatTooltip={(value) => formatAnnualReadout(value, unit, metricDecimals(metricKey))}
            />
            <CompareScaleDetail entries={barRows} labelA={nameOf(results.a)} labelB={nameOf(results.b)} unit={unit} />
          </ChartCard>
        ) : null}
      </>
    );
  }

  if (operation === 'segmented_growth') {
    const segments = comparison.segments ?? {};
    const ids = Object.keys(segments);
    return (
      <AnalyticalTable label="Segmented growth" freezeYear={false}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col" className="num">A</th>
              <th scope="col" className="num">B</th>
              <th scope="col" className="num">Gap (A − B)</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const segment = segments[id];
              return (
                <tr key={id}>
                  <th scope="row">
                    {id} ({segment.start} → {segment.end})
                  </th>
                  <td className="num">{segment.a?.computable ? resultAmount(segment.a.value, segment.a.unit ?? '%', metricKey) : '—'}</td>
                  <td className="num">{segment.b?.computable ? resultAmount(segment.b.value, segment.b.unit ?? '%', metricKey) : '—'}</td>
                  <td className="num" title={segment.gap?.reason ? readableReason(segment.gap.reason) : undefined}>
                    {segment.gap?.value === null || segment.gap?.value === undefined
                      ? '—'
                      : resultAmount(segment.gap.value, segment.gap.unit ?? comparison.unit ?? 'percentage points', metricKey)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="footnote">
          Gap unit: {comparison.unit ?? 'percentage points'}. Every segment uses the same universe and the same required years.
        </p>
      </AnalyticalTable>
    );
  }

  // Change, period and period-growth operations: per-entity cards + exact gap.
  const gap = comparison.gap;
  return (
    <>
      <div className="result-cards">
        <article className="card">
          <h3>Entity A {operationLabel(operation).toLowerCase()}</h3>
          <ChangeBlock title={operationLabel(operation)} change={comparison.a} metricKey={metricKey} />
        </article>
        <article className="card">
          <h3>Entity B {operationLabel(operation).toLowerCase()}</h3>
          <ChangeBlock title={operationLabel(operation)} change={comparison.b} metricKey={metricKey} />
        </article>
        <article className={`card ${gap?.value === null || gap?.value === undefined ? '' : 'card-result'}`}>
          <h3>Gap</h3>
          {gap?.value === null || gap?.value === undefined ? (
            <UnavailableState reason={gap?.reason} hint="Both sides need a valid, complete result for a gap." />
          ) : (
            <ResultValue value={gap.value} unit={gap.unit ?? comparison.unit} metricKey={metricKey} signed />
          )}
        </article>
      </div>
      {!comparison.available ? (
        <UnavailableState
          reason={comparison.reason}
          code={comparison.reason}
          hint={comparison.detail ?? 'At least one side is unavailable or incomplete — see its card and the diagnostics.'}
        />
      ) : null}
    </>
  );
}

function intervalObservationCell(entry, metricKey, compact = false) {
  if (!entry?.available) return 'Missing';
  const value = compact ? resultAmount(entry.value, entry.unit, metricKey, { compact: isTotalGdp(metricKey) }) : formatValuePlain(entry.value, metricKey);
  if (!entry.complete) {
    const missing = entry.missingIso3?.length ? `: ${entry.missingIso3.join(', ')}` : entry.missingCount ? `: ${entry.missingCount} member${entry.missingCount === 1 ? '' : 's'} missing` : '';
    return `${value} · Partial coverage${missing}`;
  }
  return value;
}

function intervalEntityResultAvailable(interval, slot) {
  if (interval?.kind === 'level') {
    const observations = interval.observations?.[slot] ?? [];
    return observations.length > 0 && observations.every((entry) => entry.available && entry.complete !== false);
  }
  const result = interval?.[slot];
  if (typeof result?.computable === 'boolean') return result.computable;
  return result?.value !== null && result?.value !== undefined;
}

function MissingObservationSummary({ interval, allIntervals, entities, metric }) {
  const missing = ['a', 'b'].flatMap((slot) => (interval.observations?.[slot] ?? [])
    .filter((entry) => !entry.available)
    .map((entry) => ({ slot, year: entry.year })));
  if (missing.length === 0) return null;
  const details = missing.map(({ slot, year }) => {
    const entity = entities?.[slot];
    const name = entity?.label ?? entity?.name ?? entity?.iso3 ?? (slot === 'a' ? 'Entity A' : 'Entity B');
    const code = entity?.iso3 ? ` (${entity.iso3})` : '';
    return `${name}${code} — ${year} — ${metric?.title ?? metric?.label ?? metric?.key ?? 'selected metric'}${metric?.indicatorCode ? ` (${metric.indicatorCode})` : ''}. The ${intervalPeriod(interval)} result is unavailable because the required observation is missing.`;
  });
  const retained = allIntervals
    .filter((candidate) => candidate.id !== interval.id)
    .flatMap((candidate) => ['a', 'b']
      .filter((slot) => intervalEntityResultAvailable(candidate, slot))
      .map((slot) => `${entities?.[slot]?.label ?? entities?.[slot]?.name ?? entities?.[slot]?.iso3 ?? `Entity ${slot.toUpperCase()}`} ${intervalPeriod(candidate)}`));
  return (
    <p className="compare-missing-note" role="status">
      {details.join(' ')}{' '}
      {retained.length > 0
        ? `${retained.join(', ')} remains available from its own required observations.`
        : 'Each other entity and interval is evaluated independently from its own required observations.'}
    </p>
  );
}

function IntervalObservations({ interval, metricKey, labelA, labelB }) {
  const years = [...new Set([...(interval.observations?.a ?? []), ...(interval.observations?.b ?? [])].map((entry) => entry.year))]
    .sort((a, b) => a - b);
  if (years.length === 0) return null;
  const aByYear = new Map((interval.observations?.a ?? []).map((entry) => [entry.year, entry]));
  const bByYear = new Map((interval.observations?.b ?? []).map((entry) => [entry.year, entry]));
  return (
    <details className="compare-interval-inputs">
      <summary>Show {years.length} required annual observation{years.length === 1 ? '' : 's'} and coverage</summary>
      <AnalyticalTable className="compare-interval-table" label={`${intervalPeriod(interval)} annual observations`}>
        <table className="table">
          <thead><tr><th scope="col">Year</th><th scope="col"><MeasurementHeading label={labelA} unit={aByYear.values().next().value?.unit} /></th><th scope="col"><MeasurementHeading label={labelB} unit={bByYear.values().next().value?.unit} /></th></tr></thead>
          <tbody>{years.map((year) => (
            <tr key={year}>
              <th scope="row">{year}</th>
              <td>{intervalObservationCell(aByYear.get(year), metricKey)}</td>
              <td>{intervalObservationCell(bByYear.get(year), metricKey)}</td>
            </tr>
          ))}</tbody>
        </table>
      </AnalyticalTable>
      <p className="footnote">Missing observations remain missing; partial group coverage is identified and blocks derived results.</p>
    </details>
  );
}

function IntervalEntityDetail({ slot, entity, result, interval, metricKey, label, operation }) {
  const isLevel = interval.kind === 'level';
  const isPeriodGrowth = interval.kind === 'period_total_growth';
  const isPeriodComponent = interval.kind === 'period_component';
  const isPeriodStatistic = interval.kind === 'period' || interval.kind === 'movement_period';
  const isUnavailablePeriodGrowth = interval.kind === 'unavailable' && operation === 'period_total_growth';
  const startObservation = interval.observations?.[slot]?.find((entry) => entry.year === interval.start);
  const endObservation = interval.observations?.[slot]?.find((entry) => entry.year === interval.end);
  const showResult = (value, unit) => resultAmount(value, unit, metricKey, { compact: isTotalGdp(metricKey) });
  const periodInputs = isPeriodGrowth ? result : null;
  return (
    <section className="compare-interval-entity" aria-label={`${label} interval details`}>
      <h4>{label} <EntityBadge kind={entity?.kind} /></h4>
      {interval.basisPeriod ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>{interval.start} → {interval.end} result</dt><dd>{result?.computable ? showResult(result.value, result.unit ?? interval.unit) : 'Unavailable'}</dd></div>
            <div><dt>Required observations</dt><dd>{(interval.requiredObservationYears ?? []).join(', ') || 'None'}</dd></div>
            {result?.rank ? <div><dt>Application-derived position</dt><dd>{rankText(result, entity)}</dd></div> : null}
          </dl>
          <details className="compare-evidence">
            <summary>Source observations</summary>
            <div className="compare-evidence-body">
              {Object.entries(interval.observations?.[slot]?.[0]?.sourceValues ?? {}).map(([source, values]) => (
                <p key={source}><strong>{source}</strong>: {values.map((entry) => `${entry.year}: ${entry.value ?? 'missing'}`).join(' · ')}</p>
              ))}
            </div>
          </details>
        </>
      ) : isLevel ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>{interval.start} observation</dt><dd>{intervalObservationCell(startObservation, metricKey, true)}</dd></div>
            <div><dt>{interval.start} application-derived position</dt><dd>{rankText(startObservation, entity)}</dd></div>
            <div><dt>{interval.end} observation</dt><dd>{intervalObservationCell(endObservation, metricKey, true)}</dd></div>
            <div><dt>{interval.end} application-derived position</dt><dd>{rankText(endObservation, entity)}</dd></div>
          </dl>
          <p className="footnote">Level reports the selected-series observation and application-derived country position at each endpoint. These positions are not official World Bank ranks.</p>
        </>
      ) : isPeriodGrowth ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>Earlier period total {periodInputs?.periodStart?.period ? `[${periodInputs.periodStart.period.start}, ${periodInputs.periodStart.period.end})` : ''}</dt><dd>{showResult(periodInputs?.periodStart?.value, periodInputs?.periodStart?.unit)}</dd></div>
            <div><dt>Later period total {periodInputs?.periodEnd?.period ? `[${periodInputs.periodEnd.period.start}, ${periodInputs.periodEnd.period.end})` : ''}</dt><dd>{showResult(periodInputs?.periodEnd?.value, periodInputs?.periodEnd?.unit)}</dd></div>
            <div><dt>Period-total growth</dt><dd>{result?.computable ? showResult(result.value, result.unit ?? interval.unit) : 'Unavailable'}</dd></div>
          </dl>
          {!result?.computable ? <UnavailableState reason={result?.reason} hint={result?.description ?? 'A valid split-period total is required.'} /> : null}
          {result?.computable ? <p className="footnote">{describeIntervalResult(result, interval, operation, metricKey)}</p> : null}
          <p className="footnote">This method compares the first and second period totals. Each total excludes its end year. The result is growth between the totals.</p>
        </>
      ) : isUnavailablePeriodGrowth ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>Period-total growth</dt><dd>Unavailable — a middle year is needed to define the two periods.</dd></div>
            <div><dt>Selected range</dt><dd>{interval.start} to {interval.end}</dd></div>
          </dl>
          <UnavailableState reason={result?.reason} hint={chronology(result?.description) ?? 'Select a middle year to define the first and second periods. Each period excludes its end year.'} />
        </>
      ) : isPeriodStatistic ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>{interval.start} beginning observation</dt><dd>{intervalObservationCell(startObservation, metricKey)} {startObservation?.unit ?? ''}</dd></div>
            <div><dt>{interval.end} ending observation</dt><dd>{intervalObservationCell(endObservation, metricKey)} {endObservation?.unit ?? ''}</dd></div>
            <div><dt>{operationLabel(operation)}</dt><dd>{result?.computable ? showResult(result.value, result.unit ?? interval.unit) : 'Unavailable'}</dd></div>
            {interval.kind === 'movement_period' ? <div><dt>Application-derived position</dt><dd>{rankText(result, entity)}</dd></div> : null}
            <div><dt>Required annual observations</dt><dd>{(interval.requiredObservationYears ?? interval.observations?.[slot]?.map((entry) => entry.year) ?? []).join(', ') || 'None'}</dd></div>
          </dl>
          {!result?.computable ? <UnavailableState reason={result?.reason} hint={result?.description ?? 'The period requires complete annual observations.'} /> : null}
          {result?.computable ? <p className="footnote">{describeIntervalResult(result, interval, operation, metricKey)}</p> : null}
        </>
      ) : (
        <>
          <dl className="compare-detail-list">
            <div><dt>{isPeriodComponent ? `Period total [${interval.start}, ${interval.end})` : `${interval.start} observation`}</dt><dd>{isPeriodComponent ? (result?.computable ? showResult(result.value, result.unit ?? interval.unit) : 'Unavailable') : `${intervalObservationCell(startObservation, metricKey)} ${startObservation?.unit ?? ''}`}</dd></div>
            {!isPeriodComponent ? <div><dt>{interval.end} observation</dt><dd>{`${intervalObservationCell(endObservation, metricKey)} ${endObservation?.unit ?? ''}`}</dd></div> : null}
            <div><dt>{isPeriodComponent ? 'Period-total component' : operationLabelFromInterval(interval.kind)}</dt><dd>{result?.computable ? showResult(result.value, result.unit ?? interval.unit) : 'Unavailable'}</dd></div>
          </dl>
          {!result?.computable ? <UnavailableState reason={result?.reason} hint={result?.description ?? 'The required observations are incomplete or the formula is not valid for these values.'} /> : null}
          {result?.computable ? <p className="footnote">{describeIntervalResult(result, interval, operation, metricKey)}</p> : null}
          {isPeriodComponent ? <p className="footnote">This is one input to period-total growth. The full-period result compares two adjacent totals, each excluding its end year.</p> : null}
        </>
      )}
    </section>
  );
}

function rankText(observation, entity) {
  if (entity?.kind !== 'country') return 'Not ranked for this entity type';
  if (!observation?.available) return 'Unavailable for this year';
  if (!observation?.rank) return 'No cross-country rank is approved for this measurement basis';
  return `#${observation.rank.position} / ${observation.rank.denominator}`;
}

function describeIntervalResult(result, interval, operation, metricKey) {
  const amount = formatDecimal(result.value, changeDecimals(result.unit, metricKey));
  const absolute = Math.abs(result.value);
  if (operation === 'cagr') {
    return result.value > 0 ? `The annualized compound rate was ${amount}% per year across ${interval.end - interval.start} years.`
      : result.value < 0 ? `The annualized compound rate was ${amount}% per year across ${interval.end - interval.start} years.`
        : 'The annualized compound rate was 0% per year.';
  }
  if (operation === 'percent_change' || operation === 'segmented_growth') {
    return result.value > 0 ? `The value increased ${amount}% from ${interval.start} to ${interval.end}.`
      : result.value < 0 ? `The value decreased ${formatDecimal(absolute, 2)}% from ${interval.start} to ${interval.end}.`
        : `The value was unchanged between ${interval.start} and ${interval.end}.`;
  }
  if (operation === 'pp_change' || operation === 'index_point_change') {
    const noun = result.unit ?? 'points';
    return result.value > 0 ? `The measure rose by ${amount} ${noun} from ${interval.start} to ${interval.end}.`
      : result.value < 0 ? `The measure fell by ${formatDecimal(absolute, changeDecimals(result.unit, metricKey))} ${noun} from ${interval.start} to ${interval.end}.`
        : `The measure was unchanged between ${interval.start} and ${interval.end}.`;
  }
  if (operation === 'absolute_change') {
    const unit = result.unit ?? metricKey;
    return result.value > 0 ? `The measure increased by ${amount} ${unit} from ${interval.start} to ${interval.end}.`
      : result.value < 0 ? `The measure decreased by ${formatDecimal(absolute, changeDecimals(result.unit, metricKey))} ${unit} from ${interval.start} to ${interval.end}.`
        : `The measure was unchanged between ${interval.start} and ${interval.end}.`;
  }
  if (operation === 'period_total' || operation === 'period_average') {
    return operation === 'period_total'
      ? `This is the sum of complete annual observations in [${interval.start}, ${interval.end}).`
      : `This is the mean of complete annual observations in [${interval.start}, ${interval.end}).`;
  }
  if (operation.startsWith('movement_')) {
    const years = interval.requiredObservationYears ?? [];
    return `Calculated from the Movement method's required annual observations${years.length ? ` (${years.join(', ')})` : ''}; missing observations are never treated as zero.`;
  }
  return `Calculated for ${interval.start} to ${interval.end} using the selected analysis.`;
}

function operationLabelFromInterval(kind) {
  return kind === 'change' ? 'Calculated interval result' : 'Analysis result';
}

function IntervalAnalysis({ data, metricKey, countryNames, analysisLabel, chartType, onChartType }) {
  const intervals = data.results?.comparison?.intervalResults ?? [];
  const metric = data.metric ?? {};
  const labelA = countryNames(data.entities?.a);
  const labelB = countryNames(data.entities?.b);
  if (intervals.length === 0) return <ComparisonResult data={data} metricKey={metricKey} />;
  return (
    <div className="compare-intervals" aria-label="Interval-by-interval results">
      {intervals.map((interval) => {
        const gap = interval.gap;
        const gapUnit = gap?.unit ?? interval.gapUnit;
        const gapText = interval.kind === 'level' && gap?.start
          ? `${interval.start}: ${gap?.start?.value == null ? 'unavailable' : showIntervalGap(gap.start, metricKey, gapUnit)} · ${interval.end}: ${gap?.end?.value == null ? 'unavailable' : showIntervalGap(gap.end, metricKey, gapUnit)}`
          : gap?.value == null ? 'Unavailable' : showIntervalGap(gap, metricKey, gapUnit);
        const compareMethod = interval.kind === 'period_component'
          ? 'Period-total input for the selected growth analysis'
          : interval.kind === 'period_total_growth'
            ? 'Growth between the two adjacent period totals'
            : interval.kind === 'level'
              ? 'Endpoint level comparison'
              : `${analysisLabel ?? data.analysis?.label ?? operationLabel(data.operation)} over the selected endpoints`;
        return (
          <article className="card compare-interval-card" key={interval.id}>
            <header className="compare-interval-header">
              <div><p className="lfl-label">{interval.kind === 'period_component' ? 'Period total' : 'Selected period'}</p><h3>{intervalPeriod(interval)}</h3></div>
            </header>
            <MissingObservationSummary interval={interval} allIntervals={intervals} entities={data.entities} metric={metric} />
            <div className="compare-interval-entities">
              <IntervalEntityDetail slot="a" entity={data.entities?.a} result={interval.a} interval={interval} metricKey={metricKey} operation={data.operation} label={`Entity A — ${labelA}`} />
              <IntervalEntityDetail slot="b" entity={data.entities?.b} result={interval.b} interval={interval} metricKey={metricKey} operation={data.operation} label={`Entity B — ${labelB}`} />
            </div>
            <section className="compare-interval-gap" aria-label={`${intervalPeriod(interval)} comparison`}>
              <h4>Entity comparison</h4>
              {interval.kind === 'level' ? (
                <p>{gapText}</p>
              ) : (
                <p><strong>{gapText}</strong></p>
              )}
              {gap?.value != null && interval.kind !== 'level' ? (
                <p className="footnote">{gap.value > 0 ? `Entity A's result is higher by ${resultAmount(Math.abs(gap.value), gapUnit, metricKey)}.` : gap.value < 0 ? `Entity B's result is higher by ${resultAmount(Math.abs(gap.value), gapUnit, metricKey)}.` : 'The entity results are equal.'} This describes the selected measure only; it does not imply overall economic superiority.</p>
              ) : gap?.value == null && interval.kind !== 'level' ? <p className="footnote">No gap is calculated unless both entity results are valid and complete.</p> : null}
            </section>
            <IntervalObservations interval={interval} metricKey={metricKey} labelA={labelA} labelB={labelB} />
            <details className="compare-evidence">
              <summary>Methodology and source</summary>
              <div className="compare-evidence-body">
                <p>{data.basisMethod?.label ? `Measurement basis: ${data.basisMethod.label}. ` : ''}Indicator {metric.indicatorCode ?? 'not provided'} · Source: {data.source?.label ?? data.source?.name ?? 'World Bank World Development Indicators'}.</p>
                <p>{compareMethod}. {interval.boundary?.inclusiveStart === false
                  ? `Required annual observations exclude ${interval.start} and include ${interval.end}.`
                  : interval.boundary?.inclusiveEnd === false
                    ? `Annual observations use [${interval.start}, ${interval.end}) (end year excluded).`
                    : interval.boundary?.inclusiveEnd === true
                      ? `Required annual observations include both ${interval.start} and ${interval.end}.`
                      : ''}</p>
                {interval.formula ? <p>Formula: {interval.formula}{interval.kind === 'period_total_growth' ? '. Entity result is ((later period total ÷ earlier period total) − 1) × 100; the gap is in percentage points' : ''}. Missing annual observations are never treated as zero.</p> : null}
                <p>Inputs and calculations use {data.mode === 'like_for_like' ? 'the selected common universe' : 'observed entity values'}.</p>
              </div>
            </details>
          </article>
        );
      })}
      <IntervalResultChart intervals={intervals} operation={data.operation} analysisLabel={analysisLabel} labelA={labelA} labelB={labelB} metricKey={metricKey} mode={data.mode} chartType={chartType} onChartType={onChartType} />
    </div>
  );
}

function showIntervalGap(gap, metricKey, fallbackUnit) {
  if (gap?.value == null) return 'unavailable';
  return resultAmount(gap.value, gap.unit ?? fallbackUnit, metricKey, { compact: isTotalGdp(metricKey) });
}

function IntervalResultChart({ intervals, operation, analysisLabel, labelA, labelB, metricKey, mode, chartType, onChartType }) {
  const chartIntervals = intervals.filter((interval) => {
    if (interval.kind === 'level') return false;
    if (operation === 'period_total_growth') return interval.kind === 'period_total_growth';
    return interval.kind !== 'unavailable';
  });
  if (chartIntervals.length === 0) return null;
  const units = new Set(chartIntervals.flatMap((interval) => [interval.a?.unit ?? interval.unit, interval.b?.unit ?? interval.unit]).filter(Boolean));
  if (units.size > 1) return null;
  const unit = units.values().next().value ?? chartIntervals[0].unit ?? null;
  const decimals = changeDecimals(unit, metricKey);
  const formatTooltip = (value) => formatAnnualReadout(value, unit, decimals);
  const title = analysisLabel ?? operationLabel(operation);
  const entries = chartIntervals.map((interval) => ({
    x: intervalPeriod(interval),
    A: interval.a?.computable ? interval.a.value : null,
    B: interval.b?.computable ? interval.b.value : null,
  }));
  return (
    <ChartCard
      title={`${title} by interval`}
      unit={unit}
      summary={`${title} for ${labelA} and ${labelB}, ${mode === 'like_for_like' ? 'like-for-like' : 'observed'}, by interval`}
    >
      <ChartTypeToggle value={chartType} onChange={onChartType} lineLabel="Point chart" />
      {chartType === 'line'
        ? <IntervalLineChart entries={entries} series={[{ key: 'A', label: labelA }, { key: 'B', label: labelB }]} unit={unit} decimals={decimals} formatTooltip={formatTooltip} />
        : <BarComparisonChart entries={entries} series={[{ key: 'A', label: labelA }, { key: 'B', label: labelB }]} unit={unit} decimals={decimals} formatTooltip={formatTooltip} tickUnit={compareCurrencySymbol(unit) ? unit : null} />}
      <CompareScaleDetail entries={entries} labelA={labelA} labelB={labelB} unit={unit} />
      <ChartDataFallback label="interval values" columns={[{ header: 'Interval' },
        { header: labelA, unit }, { header: labelB, unit }]}
        rows={entries.map(({ x, A, B }) => [x, exactChartValue(A), exactChartValue(B)])} />
    </ChartCard>
  );
}

/**
 * Chart series straight from the verified backend payload. No client-side
 * refetching, no recalculation: the plotted points ARE the result.
 */
function ResultChart({ data, metricKey, countryNames, chartType, onChartType }) {
  const [chartRange, setChartRange] = useState(null);
  const seriesA = data.results?.a?.series?.points ?? [];
  const seriesB = data.results?.b?.series?.points ?? [];
  if (seriesA.length < 2 && seriesB.length < 2) return null;
  const metric = data.metric ?? {};
  const unit = metric.unitLong ?? metric.unit ?? null;
  const basis = subjectOf(metricKey) === 'gdp_per_capita' ? `${unit} per person` : unit;
  const decimals = metricDecimals(metricKey);
  const mode = data.mode ?? data.groupMode ?? 'observed';
  const labelA = countryNames(data.entities?.a);
  const labelB = countryNames(data.entities?.b);
  const observedYears = [...new Set([...seriesA, ...seriesB].map((point) => point.year))].filter(Number.isInteger).sort((a, b) => a - b);
  const first = observedYears[0];
  const last = observedYears.at(-1);
  if (first == null || first === last) return null;
  const allYears = calendarYears(first, last);
  const requestedYears = [data.years?.a, data.years?.b, data.years?.c].filter(Number.isInteger);
  const defaultFrom = requestedYears.length ? Math.min(last, Math.max(first, Math.min(...requestedYears))) : first;
  const defaultTo = requestedYears.length ? Math.max(first, Math.min(last, Math.max(...requestedYears))) : last;
  const rangeKey = JSON.stringify([data.entities?.a?.id ?? data.entities?.a?.iso3, data.entities?.b?.id ?? data.entities?.b?.iso3, data.metric?.key, data.basis, mode, data.years]);
  const activeRange = chartRange?.key === rangeKey ? chartRange : { from: defaultFrom, to: defaultTo };
  const { from, to } = activeRange;
  const visibleYears = calendarYears(from, to);
  const mapA = new Map(seriesA.map((point) => [point.year, point]));
  const mapB = new Map(seriesB.map((point) => [point.year, point]));
  const title = `${labelA} vs ${labelB}`;
  const summary = `${title} — stored observations, ${from} to ${to} (${mode === 'like_for_like' ? 'like-for-like' : 'observed'})`;
  const plots = [{ id: 'A', label: labelA, map: mapA }, { id: 'B', label: labelB, map: mapB }]
    .map(({ id, label, map }) => ({ id, label, points: visibleYears.map((x) => ({ x, y: map.get(x)?.value ?? null })) }));
  const rows = visibleYears.map((year) => [String(year), ...[mapA, mapB].map((map, index) => {
    const value = map.get(year)?.value;
    if (!Number.isFinite(value)) return <span key={index} className="trajectory-missing" aria-label="Missing observation">—</span>;
    const point = map.get(year);
    return <details key={index} className="trajectory-value">
      <summary><span>{formatAnnualReadout(value, basis, decimals)}</span><span className="sr-only">Exact value for {index === 0 ? labelA : labelB}, {year}</span></summary>
      <span className="trajectory-exact">{point.valueRaw ?? exactChartValue(value)} {basis}</span>
      {point.complete === false ? <span className="trajectory-exact">Incomplete coverage{point.missingIso3?.length ? ` · Missing ${point.missingIso3.join(', ')}` : ''}</span> : null}
      {point.members != null ? <span className="trajectory-exact">{point.members} members</span> : null}
    </details>;
  })]);
  return (
    <>
      <ChartCard title={title} unit={basis} summary={summary}>
        <HistoryWindowControls years={allYears} from={from} to={to} idPrefix="cmp-chart"
          onChange={(next) => setChartRange({ key: rangeKey, ...next })} reset={() => setChartRange(null)} />
        <p className="chart-period-caption">Displayed period: {from}–{to}. This window changes the chart and its evidence only.</p>
        <AnnualChart series={plots} unit={basis} decimals={decimals} chartType={chartType} onChartType={onChartType}
          />
      </ChartCard>
      <ChartDataFallback label="trajectory values" className="trajectory-evidence" regionName="Trajectory stored observations by year"
        columns={[{ header: 'Year' }, { header: labelA, unit: basis }, { header: labelB, unit: basis }]} rows={rows} />
    </>
  );
}

function CompareObservationValue({ value, metricKey }) {
  const rounded = formatValuePlain(value, metricKey);
  if (!Number.isFinite(value) || Number(value.toFixed(metricDecimals(metricKey))) === value) return rounded;
  return <details className="history-value"><summary>{rounded}</summary><span>Exact value: {exactChartValue(value)}</span></details>;
}

function CompareScaleDetail({ entries, labelA, labelB, unit }) {
  if (!scaleDetailFor(entries, ['A', 'B'])) return null;
  return (
    <details className="chart-scale-detail">
      <summary>Inspect exact comparison values</summary>
      <p className="chart-note">The chart uses a common scale. The table gives the exact amounts, including values
        too small to distinguish on a zero-based bar chart.</p>
      <ChartDataFallback label="exact comparison values"
        columns={[{ header: 'Period' }, { header: labelA, unit }, { header: labelB, unit }]}
        rows={entries.map(({ x, A, B }) => [x, exactChartValue(A), exactChartValue(B)])} />
    </details>
  );
}

function exactChartValue(value) {
  return value == null ? '—' : Number(value).toLocaleString('en-US', { maximumSignificantDigits: 21 });
}

export default function Compare({
  availableYears,
  countries = [],
  entityA,
  entityB,
  labelA,
  labelB,
  analysis,
  metricFamily,
  metricKey,
  basisId,
  yearA,
  yearB,
  yearC,
  operation,
  groupMode,
  onEntityA,
  onEntityB,
  onLabelA,
  onLabelB,
  onAnalysis,
  onMetric,
  onBasis = () => {},
  onYearA,
  onYearB,
  onYearC,
  onOperation,
  onGroupMode,
}) {
  const entityObjA = parseEntitySpecString(entityA, labelA);
  const entityObjB = parseEntitySpecString(entityB, labelB);
  const canonicalMetricKey = metricKey ?? resolveCanonicalMetric(metricFamily, basisId);
  const selectedAnalysis = analysis ?? (SUBJECTS[metricFamily] ? metricFamily : subjectOf(canonicalMetricKey));
  const validMetricKeys = metricKeysForSubject(selectedAnalysis);
  const metricBelongsToAnalysis = Boolean(SUBJECTS[selectedAnalysis] && canonicalMetricKey && validMetricKeys.includes(canonicalMetricKey));
  const basisOptions = metricBelongsToAnalysis
    ? compareMethodOptions(canonicalMetricKey, entityObjA, entityObjB, yearA, yearC ?? yearB)
    : [];
  const selectedBasis = basisOptions.find((basis) => basis.value === basisId) ?? null;
  const effectiveBasis = basisId;
  const effectiveOperation = selectedBasis?.operation ?? null;
  const requestBasis = selectedBasis?.requestBasis ?? null;
  const selectionError = !SUBJECTS[selectedAnalysis]
    ? 'Choose a registered Analysis family.'
    : !metricBelongsToAnalysis
      ? `Choose a Metric registered under ${subjectLabel(selectedAnalysis)}.`
      : !selectedBasis
        ? 'Choose a registered Basis for the selected Metric.'
        : selectedBasis.disabled
          ? selectedBasis.disabledReason ?? 'This Basis is not available for the selected entities.'
          : '';
  const [chartTypeChoice, setChartTypeChoice] = useState(null);
  const defaultChartType = effectiveOperation === 'level' ? 'line' : 'bar';
  const chartType = chartTypeChoice ?? defaultChartType;
  const setChartType = (type) => setChartTypeChoice(type);
  const availableBasisFor = (nextMetric, keep = basisId) => {
    const options = compareMethodOptions(nextMetric, entityObjA, entityObjB, yearA, yearC ?? yearB);
    const kept = options.find((entry) => entry.value === keep && !entry.disabled);
    return kept ?? options.find((entry) => !entry.disabled) ?? null;
  };
  const chooseMetric = (nextMetric) => {
    const nextBasis = availableBasisFor(nextMetric);
    onMetric?.(nextMetric);
    onBasis?.(nextBasis?.value ?? '');
    onOperation?.(nextBasis?.operation ?? '');
  };
  useEffect(() => {
    if (effectiveOperation && operation !== effectiveOperation) onOperation?.(effectiveOperation);
    // operation is URL state derived from the selected Basis; the callback is
    // stable in effect, and intentionally omitted to avoid identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOperation, operation]);
  const opDef = COMPARE_OPERATIONS.find((op) => op.id === effectiveOperation) ?? COMPARE_OPERATIONS[0];
  const periods = comparePeriodRequirements(opDef.id);
  // Group offer follows backend aggregation metadata: SUM totals and
  // WEIGHTED_RATIO (resolved from legs) only.
  const groupOffered = supportsGroupValues(canonicalMetricKey);

  const aggregatesQuery = useApi((signal) => api.entities({ type: 'aggregate', pageSize: 500, indicator: canonicalMetricKey }, {
    signal, recover: true, passive: true, timeoutMs: 12000,
  }), 'compare:aggregates:' + canonicalMetricKey);
  const aggregates = aggregatesQuery.data?.entities ?? [];

  // Every visible selection is sent when the chosen analysis can use it.
  // For endpoint/period operations, Year B is a documented fallback and is
  // reported unused by the backend when Year C is also supplied.
  const isLevel = opDef.id === 'level';
  const sendYearB = yearB != null && (isLevel || periods.usesMid || periods.showOptionalMid);
  const sendYearC = yearC != null && (isLevel || periods.usesEnd);
  const missingRequiredYear = periods.requiresEnd
    ? yearC == null
    : periods.usesEnd && yearC == null && yearB == null;

  const canFetch =
    !selectionError && entityObjA !== null && entityObjB !== null && canonicalMetricKey != null && effectiveOperation != null && yearA != null && !missingRequiredYear &&
    (periods.usesEnd ? sendYearC || (!periods.requiresEnd && sendYearB) : true) &&
    // An in-progress empty group stays selectable in the builder but never
    // submits (the backend would 400 EMPTY_GROUP).
    (entityObjA.kind !== 'custom_group' || entityObjA.members.length > 0) &&
    (entityObjB.kind !== 'custom_group' || entityObjB.members.length > 0);
  const depsKey = `compare:${entityA ?? ''}:${entityB ?? ''}:${labelA ?? ''}:${labelB ?? ''}:${selectedAnalysis}:${canonicalMetricKey}:${requestBasis}:${effectiveBasis}:${yearA ?? ''}:${yearB ?? ''}:${yearC ?? ''}:${effectiveOperation}:${groupMode}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.compare(
        {
          entityA,
          entityB,
          labelA: entityObjA?.kind === 'custom_group' ? labelA : undefined,
          labelB: entityObjB?.kind === 'custom_group' ? labelB : undefined,
          indicator: canonicalMetricKey,
          basis: requestBasis,
          yearA,
          ...(sendYearB ? { yearB } : {}),
          ...(sendYearC ? { yearC } : {}),
          operation: effectiveOperation,
          groupMode,
        },
        { signal, recover: true, passive: true, timeoutMs: 12000 },
      ),
    depsKey,
    { enabled: canFetch },
  );

  const countryNames = (entity) => entityDisplayNameFor(entity, countries, aggregates);

  const analysisYears = data?.analysis?.requiredObservationYears ?? [];
  const ignoredPeriods = data?.analysis?.ignoredPeriods ?? [];
  const resultMode = data?.mode ?? data?.groupMode ?? groupMode;

  return (
    <div role="tabpanel" id="panel-compare" aria-labelledby="tab-compare">
      <Section
        id="compare-builder"
        title="Compare"
        subtitle="Compare two entities across one or more periods. Every analytical result comes from the selected metric, basis and backend methodology."
      >
        <div className="compare-grid">
          <div className="compare-entity">
            <EntityPicker
              id="cmp-a"
              label="Entity A"
              value={entityObjA}
              countries={countries}
              aggregates={aggregates}
              aggregateError={aggregatesQuery.error}
              allowGroups={groupOffered}
              metricKey={canonicalMetricKey}
              onChange={(next) => {
                onEntityA(next ? entityToSpec(next) : '');
                onLabelA(next?.kind === 'custom_group' ? (next.label ?? '') : '');
              }}
            />
          </div>
          <div className="compare-vs" aria-hidden="true">
            vs
          </div>
          <div className="compare-entity">
            <EntityPicker
              id="cmp-b"
              label="Entity B"
              value={entityObjB}
              countries={countries}
              aggregates={aggregates}
              aggregateError={aggregatesQuery.error}
              allowGroups={groupOffered}
              metricKey={canonicalMetricKey}
              onChange={(next) => {
                onEntityB(next ? entityToSpec(next) : '');
                onLabelB(next?.kind === 'custom_group' ? (next.label ?? '') : '');
              }}
            />
          </div>
        </div>
        <div className="compare-params">
          <div className="compare-param-row">
            <SearchableSelect
              id="cmp-analysis"
              label="Analysis"
              value={selectedAnalysis}
              options={Object.values(SUBJECTS).map((subject) => ({ value: subject.key, label: subject.label }))}
              onChange={(nextAnalysis) => {
                const nextMetrics = metricKeysForSubject(nextAnalysis);
                const nextMetric = nextMetrics.includes(canonicalMetricKey) ? canonicalMetricKey : nextMetrics[0];
                const nextBasis = availableBasisFor(nextMetric);
                onAnalysis?.(nextAnalysis);
                onMetric?.(nextMetric);
                onBasis?.(nextBasis?.value ?? '');
                onOperation?.(nextBasis?.operation ?? '');
              }}
              placeholder="Select an analysis family…"
              hint="Economic family registered by Movement."
            />
            <MetricPicker
              id="cmp-metric"
              label="Metric"
              value={canonicalMetricKey}
              subject={selectedAnalysis}
              onChange={chooseMetric}
              hint="Indicator registered within the selected family."
            />
            <SearchableSelect
              id="cmp-basis"
              label="Basis"
              value={effectiveBasis ?? ''}
              options={basisOptions.map((basis) => ({ value: basis.value, label: basis.label, disabled: basis.disabled, disabledReason: basis.disabledReason }))}
              disabled={!metricBelongsToAnalysis || basisOptions.length === 0}
              hint="Movement methods and valid Compare calculations for this metric."
              onChange={(value) => {
                const nextBasis = basisOptions.find((entry) => entry.value === value);
                onBasis?.(value);
                onOperation?.(nextBasis?.operation ?? '');
              }}
              placeholder="Select a basis…"
            />
            <div className="field mode-selector">
              <span className="field-label" id="cmp-mode-label">
                Comparison mode
              </span>
              <div className="segmented" role="group" aria-labelledby="cmp-mode-label">
                {[
                  { id: 'observed', label: 'Observed', hint: 'What each entity reports for the selected period.' },
                  { id: 'like_for_like', label: 'Like-for-like', hint: 'One frozen universe and one completeness rule for both sides.' },
                ].map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={groupMode === entry.id}
                    title={entry.hint}
                    className={groupMode === entry.id ? 'segmented-tab segmented-tab-active' : 'segmented-tab'}
                    onClick={() => onGroupMode(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="footnote mode-hint">
                {groupMode === 'like_for_like'
                  ? 'One frozen set of complete country observations.'
                  : 'Each entity’s stored values for the selected periods.'}
              </p>
              <details className="compare-mode-evidence">
                <summary>How coverage is handled</summary>
                <div className="compare-evidence-body">
                  <p>Like-for-like admits a country only when its required observations are complete for every selected interval. Official aggregates retain their published World Bank values; their comparison to a common country universe is marked unavailable when the populations are not comparable.</p>
                  <p>Observed uses each entity’s stored values. A custom-group subtotal with missing members is labelled partial coverage, and dependent calculations are blocked.</p>
                </div>
              </details>
            </div>
          </div>
          <div className="compare-period-row">
            {[
              { id: 'cmp-year-a', label: 'Start year', role: 'a', value: yearA, onChange: onYearA },
              { id: 'cmp-year-b', label: 'Middle year', role: 'b', value: yearB, onChange: onYearB },
              { id: 'cmp-year-c', label: 'End year', role: 'c', value: yearC, onChange: onYearC },
            ].map((control) => {
              const info = yearControlInfo(opDef.id, control.role, yearC);
              return (
                <YearSelect
                  key={control.id}
                  id={control.id}
                  label={`${control.label}${info.optional ? ' (optional)' : ''}`}
                  hint={info.hint}
                  years={availableYears}
                  value={control.value}
                  onChange={control.onChange}
                  optional={info.optional}
                  disabled={info.disabled}
                />
              );
            })}
          </div>
        </div>
        {selectionError ? (
          <EmptyState title="Review the Compare selections">
            <p>{selectionError}</p>
          </EmptyState>
        ) : null}
        {!selectionError && missingRequiredYear ? (
          <EmptyState title="This analysis needs a start and end year">
            <p>Select an earlier year and a later year to run {selectedBasis?.label ?? 'the selected method'}. The middle year is optional and adds interval results when selected.</p>
          </EmptyState>
        ) : null}
        {!selectionError && !canFetch && !missingRequiredYear ? (
          <EmptyState title="Choose two entities, a metric and a period">
            <p>Results appear here once the builder above is complete.</p>
          </EmptyState>
        ) : null}
      </Section>

      {canFetch ? (
        <Section id="compare-results" title="Result" subtitle="Selected comparison results and supporting evidence.">
          <StatusBlock loading={loading} error={null} empty={false} sectionName="comparison" />
          {error ? (
            <CompareError error={error} onRetry={retry} />
          ) : !loading && data ? (
            data.available === false ? (
              <UnavailableState reason={data.reason} code={data.reason} hint="Valid request, but the data or mathematics do not support it." />
            ) : (
              <>
                <div className="compare-analysis-note">
                  <p><strong>{data.entities?.a?.name ?? data.entities?.a?.label ?? 'Entity A'} vs {data.entities?.b?.name ?? data.entities?.b?.label ?? 'Entity B'}</strong> · Analysis: {subjectLabel(selectedAnalysis)} · Metric: {metricLabel(canonicalMetricKey)} · Basis: {selectedBasis?.label ?? data.basisMethod?.label ?? effectiveBasis} · {resultMode === 'like_for_like' ? 'Like-for-like' : 'Observed'} · Years: {[data.years?.a, data.years?.b, data.years?.c].filter(Number.isInteger).join(' → ')}</p>
                  <details className="compare-evidence">
                    <summary>Analysis inputs and coverage rules</summary>
                    <div className="compare-evidence-body">
                      <p>Required observation years: {data.analysis?.requiredObservationYears?.join(', ') ?? 'as selected'}{data.analysis?.boundary?.kind === 'period_half_open' ? ` · period [${data.analysis.boundary.start}, ${data.analysis.boundary.end})` : ''}.</p>
                      {data.analysis?.formula ? <p>Formula: {data.analysis.formula}</p> : null}
                      {ignoredPeriods.length > 0 ? <p>{ignoredPeriods.map((entry) => `${yearTerms[entry.period] ?? 'Selected year'} (${entry.year}) is not used. ${chronology(entry.detail)}`).join(' ')}</p> : null}
                    </div>
                  </details>
                </div>
                {resultMode === 'like_for_like' ? <CompareUniversePanel universe={data.universe} /> : null}
                <DiagnosticsPanel diagnostics={data.diagnostics} />
                {effectiveOperation === 'cross_rate' ? (
                  <>
                    <div className="result-cards">
                      <EntityResultCard slot="a" entity={data.results.a} countries={countries} aggregates={aggregates} mode={resultMode} metricKey={canonicalMetricKey} years={analysisYears} />
                      <EntityResultCard slot="b" entity={data.results.b} countries={countries} aggregates={aggregates} mode={resultMode} metricKey={canonicalMetricKey} years={analysisYears} />
                    </div>
                    <ComparisonResult data={data} metricKey={canonicalMetricKey} />
                  </>
                ) : <IntervalAnalysis data={data} metricKey={canonicalMetricKey} countryNames={countryNames} analysisLabel={selectedBasis?.label} chartType={chartType} onChartType={setChartType} />}
                {effectiveOperation === 'level' ? <ResultChart data={data} metricKey={canonicalMetricKey} countryNames={countryNames} chartType={chartType} onChartType={setChartType} /> : null}
                {data.vintage?.warning ? (
                  <p className="status status-empty" role="status">
                    Vintage note: {data.vintage.warning}
                  </p>
                ) : null}
                <MethodologyPanel
                  indicatorCode={data.metric?.indicatorCode}
                  derived={data.results.a?.kind === 'custom_group' || data.results.b?.kind === 'custom_group' ? 'Group values APP-derived from member observations' : effectiveOperation === 'level' ? null : `Change via approved ${selectedBasis?.label ?? effectiveOperation} method`}
                  formula={data.results.comparison?.provenance?.formula ?? data.results.comparison?.a?.provenance?.formula ?? data.analysis?.formula ?? null}
                >
                  <p className="footnote">
                    {data.entities.a.kind === 'custom_group' || data.entities.b.kind === 'custom_group'
                      ? 'User-selected groups are request-defined and never official regions. '
                      : ''}
                    Source: World Bank World Development Indicators. Country ranks shown for Level analysis are application-derived positions for this metric and year, never official published World Bank ranks.
                  </p>
                </MethodologyPanel>
              </>
            )
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function CompareError({ error, onRetry }) {
  const code = error?.code ?? 'REQUEST_ERROR';
  const unsupported = /UNSUPPORTED|NOT_AGGREGATABLE|NO_OFFICIAL_AGGREGATE|INVALID/.test(code);
  return (
    <>
      <UnavailableState
        reason={chronology(error?.message ?? 'Comparison failed.')}
        code={code}
        hint={
          unsupported
            ? 'This combination is not mathematically supported. Adjust the entities, metric or analysis above.'
            : 'Check the builder selections or retry.'
        }
      />
      {onRetry ? (
        <p>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
    </>
  );
}
