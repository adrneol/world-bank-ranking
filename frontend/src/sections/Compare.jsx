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
import SlopeChart from '../components/charts/SlopeChart.jsx';
import TimeSeriesChart from '../components/charts/TimeSeriesChart.jsx';
import { entityDisplayName, entityToSpec, parseEntitySpecString } from '../components/entities.js';
import { SearchableSelect } from '../components/controls.jsx';
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
  operationsForEntities,
  METRIC_FAMILIES,
  metricFamilyOptions,
  basisOptionsForFamily,
  resolveCanonicalMetric,
  defaultBasisForFamily,
  familyForMetricKey,
  basisLabelForMetric,
  metricDecimals,
  metricLabel,
  supportsGroupValues,
} from '../config/metrics.js';
import { useApi } from '../hooks/useApi.js';
import { formatDecimal, readableReason } from '../utils/format.js';

/**
 * Raw backend number in metric units → registry displayDecimals. GDP
 * per-capita pins 0, RATE/RATIO/FX pin 2, INDEX pins 1. Presentation only.
 */
function formatValuePlain(value, metricKey) {
  return formatDecimal(value, metricDecimals(metricKey));
}

/**
 * Decimals for a change/gap value: derived units (%, percentage points,
 * index points) pin 2 per backend convention; absolute changes reuse the
 * metric's own registry precision.
 */
function changeDecimals(unit, metricKey) {
  if (unit === '%' || unit === 'percentage points' || unit === 'index points') return 2;
  return metricDecimals(metricKey);
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
  if (operation === 'cross_rate') {
    return { optional: true, disabled: role !== 'a', hint: role === 'a' ? 'Required by this analysis.' : 'Cross-rate uses Year A only; this period is not used.' };
  }
  if (operation === 'level') {
    return { optional: role !== 'a', disabled: false, hint: role === 'a' ? 'Required. Additional selected years are compared in chronological order.' : 'Optional. Selected periods appear in the level table and trajectory.' };
  }
  if (['segmented_growth', 'period_total_growth'].includes(operation)) {
    return { optional: true, disabled: false, hint: 'Optional partition point. With Year C selected, this enables A → B, B → C and A → C results.' };
  }
  if (role === 'a') return { optional: false, disabled: false, hint: 'Required start period.' };
  if (role === 'b') return { optional: true, disabled: false, hint: yearC != null ? 'With Year C selected, Year B is the middle year and adds A → B, B → C and A → C interval results.' : 'Optional end-period fallback when Year C is not selected.' };
  return { optional: true, disabled: false, hint: 'Optional end period. If selected, this is the endpoint used by the analysis.' };
}

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
  const sign = change.value > 0 ? '+' : '';
  return (
    <div>
      <p className="lfl-label">{title}</p>
      <p className="result-value">
        {sign}
        {formatDecimal(change.value, changeDecimals(change.unit, metricKey))} <span className="result-unit">{change.unit}</span>
      </p>
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
            {d.detail ? <p className="footnote">{d.detail}</p> : null}
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
          <p className="result-value">
            {formatDecimal(comparison.value, metricDecimals(metricKey))}{' '}
            <span className="result-unit">{comparison.provenance?.outputUnit}</span>
          </p>
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
        <div className="table-scroll" role="region" aria-label="Level comparison by year" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  A
                </th>
                <th scope="col" className="num">
                  B
                </th>
                <th scope="col" className="num">
                  Gap (A − B)
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => {
                const row = perYear[year];
                return (
                  <tr key={year}>
                    <th scope="row">{year}</th>
                    <td className="num">{formatValuePlain(row.a, metricKey)}</td>
                    <td className="num">{formatValuePlain(row.b, metricKey)}</td>
                    <td className="num" title={row.gapReason ? readableReason(row.gapReason) : undefined}>
                      {row.gap === null || row.gap === undefined ? '—' : formatValuePlain(row.gap, metricKey)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="footnote">Gap unit: {comparison.unit ?? unit}. Missing legs stay missing.</p>
        </div>
        {years.length === 1 ? (
          <ChartCard
            title={`Level values — ${nameOf(results.a)} vs ${nameOf(results.b)}`}
            unit={comparison.unit ?? unit}
            derived={involvesDerived}
            summary={`${nameOf(results.a)} vs ${nameOf(results.b)} level values by year`}
          >
            <BarComparisonChart
              entries={barRows}
              series={[
                { key: 'A', label: nameOf(results.a) },
                { key: 'B', label: nameOf(results.b) },
              ]}
              unit={comparison.unit ?? unit}
              decimals={metricDecimals(metricKey)}
            />
          </ChartCard>
        ) : null}
      </>
    );
  }

  if (operation === 'segmented_growth') {
    const segments = comparison.segments ?? {};
    const ids = Object.keys(segments);
    return (
      <div className="table-scroll" role="region" aria-label="Segmented growth" tabIndex={0}>
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
                  <td className="num">{segment.a?.computable ? formatValuePlain(segment.a.value, metricKey) : '—'}</td>
                  <td className="num">{segment.b?.computable ? formatValuePlain(segment.b.value, metricKey) : '—'}</td>
                  <td className="num" title={segment.gap?.reason ? readableReason(segment.gap.reason) : undefined}>
                    {segment.gap?.value === null || segment.gap?.value === undefined
                      ? '—'
                      : formatValuePlain(segment.gap.value, metricKey)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="footnote">
          Gap unit: {comparison.unit ?? 'percentage points'}. Every segment uses the same universe and the same required years.
        </p>
      </div>
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
            <p className="result-value">
              {(gap.value > 0 ? '+' : '') + formatDecimal(gap.value, changeDecimals(gap.unit, metricKey))}{' '}
              <span className="result-unit">{gap.unit}</span>
            </p>
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

function intervalObservationCell(entry, metricKey) {
  if (!entry?.available) return 'Missing';
  const value = formatValuePlain(entry.value, metricKey);
  if (!entry.complete) {
    const missing = entry.missingIso3?.length ? `: ${entry.missingIso3.join(', ')}` : entry.missingCount ? `: ${entry.missingCount} member${entry.missingCount === 1 ? '' : 's'} missing` : '';
    return `${value} · Partial coverage${missing}`;
  }
  return value;
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
      <div className="table-scroll compare-interval-table" role="region" aria-label={`${interval.label} annual observations`} tabIndex={0}>
        <table className="table">
          <thead><tr><th scope="col">Year</th><th scope="col">{labelA}</th><th scope="col">{labelB}</th></tr></thead>
          <tbody>{years.map((year) => (
            <tr key={year}>
              <th scope="row">{year}</th>
              <td>{intervalObservationCell(aByYear.get(year), metricKey)}</td>
              <td>{intervalObservationCell(bByYear.get(year), metricKey)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
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
  const showResult = (value, unit) => value === null || value === undefined
    ? '—'
    : `${formatDecimal(value, changeDecimals(unit, metricKey))} ${unit ?? ''}`.trim();
  const periodInputs = isPeriodGrowth ? result : null;
  return (
    <section className="compare-interval-entity" aria-label={`${label} interval details`}>
      <h4>{label} <EntityBadge kind={entity?.kind} /></h4>
      {interval.basisPeriod ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>{interval.start} → {interval.end} result</dt><dd>{result?.computable ? showResult(result.value, result.unit) : 'Unavailable'}</dd></div>
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
            <div><dt>{interval.start} observation</dt><dd>{intervalObservationCell(startObservation, metricKey)} {startObservation?.unit ?? ''}</dd></div>
            <div><dt>{interval.start} application-derived position</dt><dd>{rankText(startObservation, entity)}</dd></div>
            <div><dt>{interval.end} observation</dt><dd>{intervalObservationCell(endObservation, metricKey)} {endObservation?.unit ?? ''}</dd></div>
            <div><dt>{interval.end} application-derived position</dt><dd>{rankText(endObservation, entity)}</dd></div>
          </dl>
          <p className="footnote">Level reports the selected-series observation and application-derived country position at each endpoint. These positions are not official World Bank ranks.</p>
        </>
      ) : isPeriodGrowth ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>Earlier period total {periodInputs?.periodStart?.period ? `[${periodInputs.periodStart.period.start}, ${periodInputs.periodStart.period.end})` : ''}</dt><dd>{showResult(periodInputs?.periodStart?.value, periodInputs?.periodStart?.unit ?? interval.unit)}</dd></div>
            <div><dt>Later period total {periodInputs?.periodEnd?.period ? `[${periodInputs.periodEnd.period.start}, ${periodInputs.periodEnd.period.end})` : ''}</dt><dd>{showResult(periodInputs?.periodEnd?.value, periodInputs?.periodEnd?.unit ?? interval.unit)}</dd></div>
            <div><dt>Period-total growth</dt><dd>{result?.computable ? showResult(result.value, result.unit) : 'Unavailable'}</dd></div>
          </dl>
          {!result?.computable ? <UnavailableState reason={result?.reason} hint={result?.description ?? 'A valid split-period total is required.'} /> : null}
          {result?.computable ? <p className="footnote">{describeIntervalResult(result, interval, operation, metricKey)}</p> : null}
          <p className="footnote">This method compares the total in [A, B) with the total in [B, C); it is a growth rate of period totals, not annual GDP growth.</p>
        </>
      ) : isUnavailablePeriodGrowth ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>Period-total growth</dt><dd>Unavailable — a middle year is needed to define the two periods.</dd></div>
            <div><dt>Selected range</dt><dd>{interval.start} to {interval.end}</dd></div>
          </dl>
          <UnavailableState reason={result?.reason} hint={result?.description ?? 'Select a middle year to define [A, B) and [B, C).' } />
        </>
      ) : isPeriodStatistic ? (
        <>
          <dl className="compare-detail-list">
            <div><dt>{interval.start} beginning observation</dt><dd>{intervalObservationCell(startObservation, metricKey)} {startObservation?.unit ?? ''}</dd></div>
            <div><dt>{interval.end} ending observation</dt><dd>{intervalObservationCell(endObservation, metricKey)} {endObservation?.unit ?? ''}</dd></div>
            <div><dt>{operationLabel(operation)}</dt><dd>{result?.computable ? showResult(result.value, result.unit) : 'Unavailable'}</dd></div>
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
            <div><dt>{isPeriodComponent ? 'Period-total component' : operationLabelFromInterval(interval.kind)}</dt><dd>{result?.computable ? showResult(result.value, result.unit) : 'Unavailable'}</dd></div>
          </dl>
          {!result?.computable ? <UnavailableState reason={result?.reason} hint={result?.description ?? 'The required observations are incomplete or the formula is not valid for these values.'} /> : null}
          {result?.computable ? <p className="footnote">{describeIntervalResult(result, interval, operation, metricKey)}</p> : null}
          {isPeriodComponent ? <p className="footnote">This is one period-total input to the selected period-total-growth analysis. Growth is reported for A → C when both half-open periods are defined.</p> : null}
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
        const gap = interval.kind === 'level' ? interval.gap : interval.gap;
        const gapText = interval.kind === 'level' && gap?.start
          ? `${interval.start}: ${gap?.start?.value == null ? 'unavailable' : showIntervalGap(gap.start, metricKey)} · ${interval.end}: ${gap?.end?.value == null ? 'unavailable' : showIntervalGap(gap.end, metricKey)}`
          : gap?.value == null ? 'Unavailable' : showIntervalGap(gap, metricKey);
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
              <div><p className="lfl-label">Interval</p><h3>{interval.label} <span className="muted">({interval.start} → {interval.end})</span></h3></div>
              <span className="compare-interval-mode">{data.mode === 'like_for_like' ? 'Like-for-like' : 'Observed'}</span>
            </header>
            {data.basisMethod?.label ? <p className="compare-interval-context">{data.basisMethod.label}</p> : null}
            <div className="compare-interval-entities">
              <IntervalEntityDetail slot="a" entity={data.entities?.a} result={interval.a} interval={interval} metricKey={metricKey} operation={data.operation} label={`Entity A — ${labelA}`} />
              <IntervalEntityDetail slot="b" entity={data.entities?.b} result={interval.b} interval={interval} metricKey={metricKey} operation={data.operation} label={`Entity B — ${labelB}`} />
            </div>
            <section className="compare-interval-gap" aria-label={`${interval.label} comparison`}>
              <h4>Entity comparison</h4>
              {interval.kind === 'level' ? (
                <p>{gapText} <span className="muted">({gap?.start?.unit ?? interval.gapUnit})</span></p>
              ) : (
                <p><strong>{gapText}</strong> <span className="muted">({interval.gapUnit ?? gap?.unit ?? ''})</span></p>
              )}
              {gap?.value != null && interval.kind !== 'level' ? (
                <p className="footnote">{gap.value > 0 ? `Entity A's result is higher by ${formatDecimal(Math.abs(gap.value), changeDecimals(interval.gapUnit, metricKey))} ${interval.gapUnit}.` : gap.value < 0 ? `Entity B's result is higher by ${formatDecimal(Math.abs(gap.value), changeDecimals(interval.gapUnit, metricKey))} ${interval.gapUnit}.` : 'The entity results are equal.'} This describes the selected measure only; it does not imply overall economic superiority.</p>
              ) : gap?.value == null && interval.kind !== 'level' ? <p className="footnote">No gap is calculated unless both entity results are valid and complete.</p> : null}
            </section>
            <IntervalObservations interval={interval} metricKey={metricKey} labelA={labelA} labelB={labelB} />
            <details className="compare-evidence">
              <summary>Methodology and source</summary>
              <div className="compare-evidence-body">
                <p>Indicator {metric.indicatorCode ?? 'not provided'} · Source: {data.source?.label ?? data.source?.name ?? 'World Bank World Development Indicators'}.</p>
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
      <IntervalResultChart intervals={intervals} operation={data.operation} analysisLabel={analysisLabel} labelA={labelA} labelB={labelB} metric={metric} metricKey={metricKey} mode={data.mode} chartType={chartType} onChartType={onChartType} />
    </div>
  );
}

function showIntervalGap(gap, metricKey) {
  return gap?.value == null ? 'unavailable' : `${formatDecimal(gap.value, changeDecimals(gap.unit, metricKey))} ${gap.unit ?? ''}`.trim();
}

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="chart-type-toggle" role="group" aria-label="Chart type">
      {[
        { id: 'bar', label: 'Bar chart' },
        { id: 'line', label: 'Line chart' },
      ].map((item) => (
        <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function IntervalResultChart({ intervals, operation, analysisLabel, labelA, labelB, metric, metricKey, mode, chartType, onChartType }) {
  const chartIntervals = intervals.filter((interval) => {
    if (interval.kind === 'level') return false;
    if (operation === 'period_total_growth') return interval.kind === 'period_total_growth';
    return interval.kind !== 'unavailable';
  });
  if (chartIntervals.length === 0) return null;
  const units = new Set(chartIntervals.flatMap((interval) => [interval.a?.unit, interval.b?.unit]).filter(Boolean));
  if (units.size > 1) return null;
  const unit = chartIntervals[0].a?.unit ?? chartIntervals[0].unit ?? metric.unitLong ?? metric.unit;
  const title = analysisLabel ?? operationLabel(operation);
  const entries = chartIntervals.map((interval) => ({
    x: interval.label,
    A: interval.a?.computable ? interval.a.value : null,
    B: interval.b?.computable ? interval.b.value : null,
  }));
  return (
    <ChartCard
      title={`${title} by interval`}
      unit={unit}
      summary={`${title} for ${labelA} and ${labelB}, ${mode === 'like_for_like' ? 'like-for-like' : 'observed'}, by interval`}
    >
      <ChartTypeToggle value={chartType} onChange={onChartType} />
      {chartType === 'line'
        ? <IntervalLineChart entries={entries} series={[{ key: 'A', label: labelA }, { key: 'B', label: labelB }]} unit={unit} decimals={unit === '%' ? 2 : metricDecimals(metricKey)} />
        : <BarComparisonChart entries={entries} series={[{ key: 'A', label: labelA }, { key: 'B', label: labelB }]} unit={unit} decimals={unit === '%' ? 2 : metricDecimals(metricKey)} />}
    </ChartCard>
  );
}

/**
 * Chart series straight from the verified backend payload. No client-side
 * refetching, no recalculation: the plotted points ARE the result.
 */
function ResultChart({ data, metricKey, countryNames, chartType, onChartType }) {
  const seriesA = data.results?.a?.series?.points ?? [];
  const seriesB = data.results?.b?.series?.points ?? [];
  if (seriesA.length < 2 && seriesB.length < 2) return null;
  const metric = data.metric ?? {};
  const unit = metric.unitLong ?? metric.unit ?? null;
  const decimals = metricDecimals(metricKey);
  const mode = data.mode ?? data.groupMode ?? 'observed';
  const labelA = countryNames(data.entities?.a);
  const labelB = countryNames(data.entities?.b);
  const first = seriesA[0]?.year ?? seriesB[0]?.year;
  const last = seriesA[seriesA.length - 1]?.year ?? seriesB[seriesB.length - 1]?.year;
  const title = `${labelA} vs ${labelB}`;
  const summary = `${title} — stored observations, ${first} to ${last} (${mode === 'like_for_like' ? 'like-for-like' : 'observed'})`;
  const toSeries = (points) => points.map((p) => ({ x: p.year, y: p.value === null || p.value === undefined ? null : p.value }));
  const cell = (v) => (v === null || v === undefined ? '—' : formatValuePlain(v, metricKey));
  const rows = Array.from(new Set([...seriesA, ...seriesB].map((p) => p.year)))
    .sort((l, r) => l - r)
    .map((year) => [
      String(year),
      cell(seriesA.find((p) => p.year === year)?.value ?? null),
      cell(seriesB.find((p) => p.year === year)?.value ?? null),
    ]);

  if (seriesA.length === 2 && seriesB.length === 2 && data.operation !== 'level') {
    const at = (points, year) => points.find((p) => p.year === year)?.value ?? null;
    return (
      <>
        <ChartCard title={title} unit={unit} summary={summary}>
          <SlopeChart
            items={[
              { label: labelA, start: at(seriesA, first), end: at(seriesA, last) },
              { label: labelB, start: at(seriesB, first), end: at(seriesB, last) },
            ]}
            startLabel={String(first)}
            endLabel={String(last)}
            unit={unit}
            decimals={decimals}
          />
        </ChartCard>
        <ChartDataFallback
          label="trajectory endpoint values"
          regionName="Trajectory endpoint stored observations"
          columns={[{ header: 'Year' }, { header: labelA }, { header: labelB }]}
          rows={rows}
        />
      </>
    );
  }

  const entries = [...new Set([...seriesA, ...seriesB].map((point) => point.year))]
    .sort((a, b) => a - b)
    .map((year) => ({
      x: String(year),
      A: seriesA.find((point) => point.year === year)?.value ?? null,
      B: seriesB.find((point) => point.year === year)?.value ?? null,
    }));
  return (
    <>
      <ChartCard title={title} unit={unit} summary={summary}>
        <ChartTypeToggle value={chartType} onChange={onChartType} />
        {chartType === 'line'
          ? <TimeSeriesChart
            series={[
              { label: labelA, points: toSeries(seriesA) },
              { label: labelB, points: toSeries(seriesB) },
            ]}
            unit={unit}
            decimals={decimals}
          />
          : <BarComparisonChart entries={entries} series={[{ key: 'A', label: labelA }, { key: 'B', label: labelB }]} unit={unit} decimals={decimals} />}
      </ChartCard>
      <ChartDataFallback
        label="trajectory values"
        regionName="Trajectory stored observations by year"
        columns={[{ header: 'Year' }, { header: labelA }, { header: labelB }]}
        rows={rows}
      />
    </>
  );
}

export default function Compare({
  availableYears,
  countries = [],
  entityA,
  entityB,
  labelA,
  labelB,
  metricFamily,
  // Deprecated: canonical metric key, resolved to a family internally.
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

  // Metric is a family (economic concept); Basis is the measurement
  // definition within that family. `metricFamily` is the canonical prop;
  // `metricKey` is accepted as a deprecated fallback for callers that still
  // pass a canonical series key.
  const resolvedFamily = metricFamily ?? familyForMetricKey(metricKey ?? '');
  const family = METRIC_FAMILIES[resolvedFamily] ?? null;
  const defaultBasis = family ? defaultBasisForFamily(resolvedFamily) : null;
  const basisOptions = family
    ? basisOptionsForFamily(resolvedFamily, yearA, yearC ?? yearB)
    : [];
  const effectiveBasis = basisOptions.some((basis) => basis.id === basisId)
    ? basisId
    : defaultBasis ?? basisOptions[0]?.id ?? null;
  const canonicalMetricKey = resolveCanonicalMetric(resolvedFamily, effectiveBasis);

  const registeredAnalysisOptions = operationsForEntities(canonicalMetricKey, entityObjA, entityObjB)
    .filter((option) => option.available)
    .map((option) => ({ value: option.id, label: option.label, source: 'analysis' }));
  const analysisOptions = registeredAnalysisOptions;
  const effectiveOperation = analysisOptions.some((option) => option.value === operation)
    ? operation
    : analysisOptions[0]?.value ?? null;
  const selectedAnalysis = analysisOptions.find((option) => option.value === effectiveOperation);
  const [chartTypeChoice, setChartTypeChoice] = useState(null);
  const defaultChartType = effectiveOperation === 'level' ? 'line' : 'bar';
  const chartType = chartTypeChoice ?? defaultChartType;
  const setChartType = (type) => setChartTypeChoice(type);
  useEffect(() => {
    if (effectiveBasis && basisId !== effectiveBasis) onBasis(effectiveBasis);
  }, [effectiveBasis, basisId, onBasis]);
  useEffect(() => {
    if (effectiveOperation && operation !== effectiveOperation) onOperation(effectiveOperation);
  }, [effectiveOperation, onOperation, operation]);
  const opDef = COMPARE_OPERATIONS.find((op) => op.id === effectiveOperation) ?? COMPARE_OPERATIONS[0];
  const periods = comparePeriodRequirements(opDef.id);
  // Group offer follows backend aggregation metadata: SUM totals and
  // WEIGHTED_RATIO (resolved from legs) only.
  const groupOffered = supportsGroupValues(canonicalMetricKey);

  const aggregatesQuery = useApi((signal) => api.entities({ type: 'aggregate', pageSize: 200 }, { signal }), 'compare:aggregates', {});
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
    entityObjA !== null && entityObjB !== null && canonicalMetricKey != null && effectiveOperation != null && yearA != null && !missingRequiredYear &&
    (periods.usesEnd ? sendYearC || (!periods.requiresEnd && sendYearB) : true) &&
    // An in-progress empty group stays selectable in the builder but never
    // submits (the backend would 400 EMPTY_GROUP).
    (entityObjA.kind !== 'custom_group' || entityObjA.members.length > 0) &&
    (entityObjB.kind !== 'custom_group' || entityObjB.members.length > 0);
  const depsKey = `compare:${entityA ?? ''}:${entityB ?? ''}:${labelA ?? ''}:${labelB ?? ''}:${resolvedFamily}:${effectiveBasis}:${yearA ?? ''}:${yearB ?? ''}:${yearC ?? ''}:${effectiveOperation}:${groupMode}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.compare(
        {
          entityA,
          entityB,
          labelA: entityObjA?.kind === 'custom_group' ? labelA : undefined,
          labelB: entityObjB?.kind === 'custom_group' ? labelB : undefined,
          indicator: canonicalMetricKey,
          basis: effectiveBasis,
          yearA,
          ...(sendYearB ? { yearB } : {}),
          ...(sendYearC ? { yearC } : {}),
          operation: effectiveOperation,
          groupMode,
        },
        { signal },
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
            <OperationSelect operation={effectiveOperation} options={analysisOptions} onOperation={onOperation} />
            <SearchableSelect
              id="cmp-metric"
              label="Metric"
              value={metricFamily}
              options={metricFamilyOptions()}
              onChange={(choice) => {
                onMetric(choice);
                // Reset basis to the default for the new family.
                const nextDefault = defaultBasisForFamily(choice);
                if (nextDefault) onBasis(nextDefault);
              }}
              placeholder="Select a metric…"
            />
            <SearchableSelect
              id="cmp-basis"
              label="Basis"
              value={effectiveBasis}
              options={basisOptions.map((basis) => ({ value: basis.id, label: basis.label }))}
              disabled={basisOptions.length <= 1}
              hint={basisOptions.length <= 1 ? 'One registry-defined basis.' : 'Registered measurement basis for this metric.'}
              onChange={onBasis}
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
              { id: 'cmp-year-a', label: 'Year A (earlier)', role: 'a', value: yearA, onChange: onYearA },
              { id: 'cmp-year-b', label: 'Middle year', role: 'b', value: yearB, onChange: onYearB },
              { id: 'cmp-year-c', label: 'Year C (later)', role: 'c', value: yearC, onChange: onYearC },
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
        {analysisOptions.length === 0 ? (
          <EmptyState title="No supported analysis for this combination">
            <p>The selected metric, measurement basis and entity types have no registered Compare method.</p>
          </EmptyState>
        ) : null}
        {analysisOptions.length > 0 && missingRequiredYear ? (
          <EmptyState title="This analysis needs Year A and Year C">
            <p>Select an earlier year and a later year to run {selectedAnalysis?.label ?? operationLabel(opDef.id)}. The middle year is optional and adds interval results when selected.</p>
          </EmptyState>
        ) : null}
        {analysisOptions.length > 0 && !canFetch && !missingRequiredYear ? (
          <EmptyState title="Choose two entities, a metric and a period">
            <p>Results appear here once the builder above is complete.</p>
          </EmptyState>
        ) : null}
      </Section>

      {canFetch ? (
        <Section id="compare-results" title="Result" subtitle={resultSubtitle(data, effectiveOperation, canonicalMetricKey, resultMode)}>
          <StatusBlock loading={loading} error={null} empty={false} sectionName="comparison" />
          {error ? (
            <CompareError error={error} onRetry={retry} />
          ) : !loading && data ? (
            data.available === false ? (
              <UnavailableState reason={data.reason} code={data.reason} hint="Valid request, but the data or mathematics do not support it." />
            ) : (
              <>
                <div className="compare-analysis-note">
                  <p><strong>{data.entities?.a?.name ?? data.entities?.a?.label ?? 'Entity A'} vs {data.entities?.b?.name ?? data.entities?.b?.label ?? 'Entity B'}</strong> · Analysis: {selectedAnalysis?.label ?? data.analysis?.label ?? operationLabel(effectiveOperation)} · Metric: {family ? family.label : metricFamily} · Basis: {data.basisMethod?.label ?? basisLabelForMetric(canonicalMetricKey)} · {resultMode === 'like_for_like' ? 'Like-for-like' : 'Observed'} · Years: {[data.years?.a, data.years?.b, data.years?.c].filter(Number.isInteger).join(' → ')}</p>
                  <details className="compare-evidence">
                    <summary>Analysis inputs and coverage rules</summary>
                    <div className="compare-evidence-body">
                      <p>Required observation years: {data.analysis?.requiredObservationYears?.join(', ') ?? 'as selected'}{data.analysis?.boundary?.kind === 'period_half_open' ? ` · period [${data.analysis.boundary.start}, ${data.analysis.boundary.end})` : ''}.</p>
                      {data.analysis?.formula ? <p>Formula: {data.analysis.formula}</p> : null}
                      {ignoredPeriods.length > 0 ? <p>{ignoredPeriods.map((entry) => `Year ${entry.period.toUpperCase()} (${entry.year}) is not used — ${entry.detail}`).join(' ')}</p> : null}
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
                ) : <IntervalAnalysis data={data} metricKey={canonicalMetricKey} countryNames={countryNames} analysisLabel={selectedAnalysis?.label} chartType={chartType} onChartType={setChartType} />}
                {effectiveOperation === 'level' ? <ResultChart data={data} metricKey={canonicalMetricKey} countryNames={countryNames} chartType={chartType} onChartType={setChartType} /> : null}
                {data.vintage?.warning ? (
                  <p className="status status-empty" role="status">
                    Vintage note: {data.vintage.warning}
                  </p>
                ) : null}
                <MethodologyPanel
                  indicatorCode={data.metric?.indicatorCode}
                  derived={data.results.a?.kind === 'custom_group' || data.results.b?.kind === 'custom_group' ? 'Group values APP-derived from member observations' : effectiveOperation === 'level' ? null : `Change via approved ${selectedAnalysis?.label ?? effectiveOperation} method`}
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

function OperationSelect({ operation, options, onOperation }) {
  return (
    <SearchableSelect
      id="cmp-operation"
      label="Analysis"
      value={operation}
      options={options}
      onChange={onOperation}
      placeholder={options.length ? 'Select analysis…' : 'No supported analysis'}
      hint="Choose the calculation to apply to the selected metric and basis."
    />
  );
}

function resultSubtitle(data, operation, metricKey, groupMode) {
  const modeLabel = groupMode === 'like_for_like' ? 'like-for-like' : 'observed';
  if (!data || data.available === false) return `${metricLabel(metricKey)} · ${operationLabel(operation)} · ${modeLabel}`;
  const a = data.entities?.a;
  const b = data.entities?.b;
  const name = (e) => (e?.kind === 'custom_group' ? (e.label ?? 'group') : (e?.name ?? e?.iso3 ?? ''));
  const years = [data.years?.a, data.years?.b, data.years?.c].filter(Number.isInteger).join(' → ');
  return `${name(a)} vs ${name(b)} · ${years || operationLabel(operation)} · ${modeLabel}`;
}

function CompareError({ error, onRetry }) {
  const code = error?.code ?? 'REQUEST_ERROR';
  const unsupported = /UNSUPPORTED|NOT_AGGREGATABLE|NO_OFFICIAL_AGGREGATE|INVALID/.test(code);
  return (
    <>
      <UnavailableState
        reason={error?.message ?? 'Comparison failed.'}
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
