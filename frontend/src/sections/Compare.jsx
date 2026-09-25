/**
 * Compare workspace (Phase 6).
 *
 * Structured comparison builder over the generic backend engine:
 * Entity A vs Entity B (country, official aggregate, or request-defined
 * group) × metric × period × capability-filtered operation. Results render
 * raw values, derived changes, gaps, coverage, membership effects and
 * provenance with RAW / World Bank aggregate / user-group distinctions
 * intact. Unsupported actions are disabled with reasons — never offered.
 * Trajectories use stored observations only (missing years break the line).
 */

import { api } from '../api/client.js';
import EntityPicker from '../components/EntityPicker.jsx';
import { entityDisplayName, entityToSpec, parseEntitySpecString } from '../components/entities.js';
import MetricPicker from '../components/MetricPicker.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { SearchableSelect } from '../components/controls.jsx';
import {
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
  metricDecimals,
  metricLabel,
  metricTitle,
  operationsForEntities,
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

function YearSelect({ id, label, years, value, onChange }) {
  return (
    <SearchableSelect
      id={id}
      label={label}
      value={value != null ? String(value) : ''}
      placeholder="Select year…"
      options={(years ?? []).map((y) => ({ value: String(y), label: String(y) }))}
      onChange={(v) => onChange(Number(v))}
    />
  );
}

function EntityResultCard({ slot, entity, countries, aggregates }) {
  const name =
    entity.kind === 'custom_group'
      ? entity.label
      : entity.kind === 'wb_aggregate'
        ? (aggregates.find((a) => a.iso3 === entity.iso3)?.name ?? entity.iso3)
        : (countries.find((c) => c.iso3 === entity.iso3)?.name ?? entity.iso3);
  return (
    <div className="compare-entity">
      <h3>
        {slot === 'a' ? 'Entity A' : 'Entity B'} — {name} <EntityBadge kind={entity.kind} />
      </h3>
      {entity.kind === 'custom_group' ? (
        <>
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
          {entity.coverage ? (
            <ul className="coverage-list">
              {Object.entries(entity.coverage)
                .filter(([year]) => /^\d+$/.test(year))
                .map(([year, cov]) => (
                  <li key={year}>
                    {year}: {cov.validCount} valid{cov.missingCount > 0 ? `, ${cov.missingCount} missing (${cov.missing.join(', ')})` : ''} — never zero-filled.
                  </li>
                ))}
            </ul>
          ) : null}
        </>
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

function ComparisonResult({ data }) {
  const { results, metric, years, operation } = data;
  const comparison = results.comparison;
  const unit = metric.unitLong ?? metric.unit;
  const metricKey = metric?.key;

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
            {formatValuePlain(comparison.legs.b.value, metricKey)} ({years.a})
          </p>
        </article>
      </div>
    );
  }

  if (operation === 'level') {
    const perYear = comparison.perYear ?? {};
    return (
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
            {Object.entries(perYear).map(([year, row]) => (
              <tr key={year}>
                <th scope="row">{year}</th>
                <td className="num">{formatValuePlain(row.a, metricKey)}</td>
                <td className="num">{formatValuePlain(row.b, metricKey)}</td>
                <td className="num" title={row.gapReason ? readableReason(row.gapReason) : undefined}>
                  {row.gap === null || row.gap === undefined ? '—' : formatValuePlain(row.gap, metricKey)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="footnote">Gap unit: {comparison.unit ?? unit}. Missing legs stay missing.</p>
      </div>
    );
  }

  // Change operations: per-entity change cards + exact gap.
  return (
    <>
      <div className="result-cards">
        <article className="card">
          <h3>Entity A change</h3>
          <ChangeBlock title={operationLabel(operation)} change={comparison.a} metricKey={metricKey} />
        </article>
        <article className="card">
          <h3>Entity B change</h3>
          <ChangeBlock title={operationLabel(operation)} change={comparison.b} metricKey={metricKey} />
        </article>
        <article className="card card-result">
          <h3>Gap</h3>
          {comparison.gap?.value === null || comparison.gap?.value === undefined ? (
            <UnavailableState reason={comparison.gap?.reason} hint="Both sides need a valid change for a gap." />
          ) : (
            <p className="result-value">
              {(comparison.gap.value > 0 ? '+' : '') + formatDecimal(comparison.gap.value, changeDecimals(comparison.gap.unit, metricKey))}{' '}
              <span className="result-unit">{comparison.gap.unit}</span>
            </p>
          )}
        </article>
      </div>
      {!comparison.available ? (
        <UnavailableState reason={comparison.reason} hint="At least one side is unavailable — see its card." />
      ) : null}
    </>
  );
}

function operationLabel(id) {
  return COMPARE_OPERATIONS.find((op) => op.id === id)?.label ?? id;
}

function GroupDetail({ entity, metricKey }) {
  if (entity.kind !== 'custom_group') return null;
  const years = Object.keys(entity.observed ?? {}).filter((y) => /^\d+$/.test(y));
  return (
    <div className="lfl-grid" aria-label={`${entity.label} observed versus like-for-like`}>
      <div className="lfl-box lfl-box-observed">
        <p className="lfl-label">Observed</p>
        {years.map((year) => (
          <p key={year}>
            {year}: <strong>{formatValuePlain(entity.observed[year]?.value, metricKey)}</strong> ({entity.observed[year]?.members ?? 0}{' '}
            members)
          </p>
        ))}
      </div>
      <div className="lfl-box lfl-box-lfl">
        <p className="lfl-label">Like-for-like</p>
        {years.map((year) => (
          <p key={year}>
            {year}: <strong>{formatValuePlain(entity.likeForLike?.[year]?.value, metricKey)}</strong> (
            {entity.likeForLike?.[year]?.members ?? 0} common members)
          </p>
        ))}
        {entity.membershipEffect ? (
          <p className="footnote">
            Membership effect: {(entity.membershipEffect.absolute > 0 ? '+' : '') +
              formatDecimal(entity.membershipEffect.absolute, metricDecimals(metricKey))}{' '}
            {entity.membershipEffect.unit} — coverage change, not within-member economics.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Trajectory({ entityA, entityB, metricKey, yearA, yearB, countryNames }) {
  // Stored-observation trajectories for point entities (never groups):
  // one batched observations fetch per entity-year through the public API.
  // Explicit unavailability instead of a silent empty chart: groups compare
  // through the result cards (no stored group series exists), aggregates
  // are served by entity comparison rather than the observations lookup,
  // and single-year operations have no span to draw.
  const pointEntity = (e) => e && (e.kind === 'country' || e.kind === 'wb_aggregate');
  const enabled = pointEntity(entityA) && pointEntity(entityB) && yearA != null && yearB != null;
  const involvesGroup = [entityA, entityB].some((e) => e?.kind === 'custom_group');
  const involvesAggregate = [entityA, entityB].some((e) => e?.kind === 'wb_aggregate');
  const lo = Math.min(yearA ?? 0, yearB ?? 0);
  const hi = Math.max(yearA ?? 0, yearB ?? 0);
  const span = enabled ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
  // Cap the request fan-out for very long spans (sample evenly, gaps stay gaps).
  const sampled = span.length > 31 ? span.filter((_, i) => i % Math.ceil(span.length / 31) === 0) : span;
  const fetchable = enabled && !involvesGroup && !involvesAggregate && sampled.length > 1;
  const depsKey = `traj:${metricKey}:${entityA?.iso3 ?? ''}:${entityB?.iso3 ?? ''}:${sampled.join(',')}`;
  // Single unconditional hook call (rules-of-hooks): fetching is gated by
  // the enabled flag, never by an early return.
  const { data, loading } = useApi(
    async (signal) => {
      const fetchOne = async (iso3, year) => {
        try {
          const res = await api.observations({ indicator: metricKey, year, country: iso3 }, { signal });
          return { year, value: res?.observation?.value ?? null };
        } catch {
          return { year, value: null };
        }
      };
      const [aRows, bRows] = await Promise.all([
        Promise.all(sampled.map((year) => fetchOne(entityA.iso3, year))),
        Promise.all(sampled.map((year) => fetchOne(entityB.iso3, year))),
      ]);
      return { aRows, bRows };
    },
    depsKey,
    { enabled: fetchable },
  );
  if (involvesGroup) {
    return (
      <UnavailableState
        reason="group_trajectory_unavailable"
        hint="Trajectories draw stored country observations. Custom groups compare through the result cards and group detail above."
      />
    );
  }
  if (involvesAggregate) {
    return (
      <UnavailableState
        reason="aggregate_trajectory_unavailable"
        hint="The observations lookup serves stored country observations only. Official aggregates compare through the result cards above."
      />
    );
  }
  if (enabled && span.length < 2) {
    return (
      <UnavailableState
        reason="single_year_no_trajectory"
        hint="This analysis covers a single year, so there is no span to draw. The result cards above hold the values."
      />
    );
  }
  if (!fetchable || loading || !data) return null;
  const labelA = countryNames(entityA);
  const labelB = countryNames(entityB);
  return (
    <TrendChart
      title={`${labelA} vs ${labelB}`}
      series={[
        { label: labelA, points: data.aRows.map((r) => ({ x: r.year, y: r.value })) },
        { label: labelB, points: data.bRows.map((r) => ({ x: r.year, y: r.value })) },
      ]}
    />
  );
}

export default function Compare({
  availableYears,
  countries = [],
  entityA,
  entityB,
  labelA,
  labelB,
  metricKey,
  yearA,
  yearB,
  operation,
  groupMode,
  onEntityA,
  onEntityB,
  onLabelA,
  onLabelB,
  onMetric,
  onYearA,
  onYearB,
  onOperation,
  onGroupMode,
}) {
  const entityObjA = parseEntitySpecString(entityA, labelA);
  const entityObjB = parseEntitySpecString(entityB, labelB);
  const opDef = COMPARE_OPERATIONS.find((op) => op.id === operation) ?? COMPARE_OPERATIONS[0];
  const needsTwoYears = opDef.needsYears === 2;
  const involvesGroup = entityObjA?.kind === 'custom_group' || entityObjB?.kind === 'custom_group';
  // Group offer + group-value mode both follow backend aggregation metadata:
  // SUM totals and WEIGHTED_RATIO (resolved from legs) only. Anything else
  // hides the toggle while the operation picker explains the refusal.
  const groupOffered = supportsGroupValues(metricKey);
  const showGroupMode = involvesGroup && groupOffered;

  const aggregatesQuery = useApi((signal) => api.entities({ type: 'aggregate', pageSize: 200 }, { signal }), 'compare:aggregates', {});
  const aggregates = aggregatesQuery.data?.entities ?? [];

  const canFetch =
    entityObjA !== null && entityObjB !== null && metricKey != null && yearA != null && (!needsTwoYears || yearB != null) &&
    // An in-progress empty group stays selectable in the builder but never
    // submits (the backend would 400 EMPTY_GROUP); the empty state below
    // keeps prompting for members instead.
    (entityObjA.kind !== 'custom_group' || entityObjA.members.length > 0) &&
    (entityObjB.kind !== 'custom_group' || entityObjB.members.length > 0);
  const depsKey = `compare:${entityA ?? ''}:${entityB ?? ''}:${labelA ?? ''}:${labelB ?? ''}:${metricKey}:${yearA ?? ''}:${yearB ?? ''}:${operation}:${groupMode}`;
  const { data, loading, error, retry } = useApi(
    (signal) =>
      api.compare(
        {
          entityA,
          entityB,
          labelA: entityObjA?.kind === 'custom_group' ? labelA : undefined,
          labelB: entityObjB?.kind === 'custom_group' ? labelB : undefined,
          indicator: metricKey,
          yearA,
          ...(needsTwoYears ? { yearB } : {}),
          operation,
          ...(showGroupMode ? { groupMode } : {}),
        },
        { signal },
      ),
    depsKey,
    { enabled: canFetch },
  );

  const countryNames = (entity) => {
    if (!entity) return '—';
    if (entity.kind === 'custom_group') return entityDisplayName(entity, countries, aggregates);
    if (entity.kind === 'wb_aggregate') return aggregates.find((a) => a.iso3 === entity.iso3)?.name ?? entity.iso3;
    return countries.find((c) => c.iso3 === entity.iso3)?.name ?? entity.iso3;
  };

  return (
    <div role="tabpanel" id="panel-compare" aria-labelledby="tab-compare">
      <Section
        id="compare-builder"
        title="Compare"
        subtitle="Two entities, one metric, one period, one analysis — every number backend-calculated with provenance."
      >
        <div className="compare-grid">
          <div className="compare-entity">
            <h3>Entity A</h3>
            <EntityPicker
              id="cmp-a"
              label="Entity A"
              value={entityObjA}
              countries={countries}
              aggregates={aggregates}
              allowGroups={groupOffered}
              metricKey={metricKey}
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
            <h3>Entity B</h3>
            <EntityPicker
              id="cmp-b"
              label="Entity B"
              value={entityObjB}
              countries={countries}
              aggregates={aggregates}
              allowGroups={groupOffered}
              metricKey={metricKey}
              onChange={(next) => {
                onEntityB(next ? entityToSpec(next) : '');
                onLabelB(next?.kind === 'custom_group' ? (next.label ?? '') : '');
              }}
            />
          </div>
        </div>
        <div className="compare-params">
          <MetricPicker
            id="cmp-metric"
            label="Metric"
            value={metricKey}
            onChange={onMetric}
          />
          <YearSelect id="cmp-year-a" label={needsTwoYears ? 'Year A' : 'Year'} years={availableYears} value={yearA} onChange={onYearA} />
          {needsTwoYears ? (
            <YearSelect id="cmp-year-b" label="Year B" years={availableYears} value={yearB} onChange={onYearB} />
          ) : null}
          <OperationSelect operation={operation} metricKey={metricKey} entityA={entityObjA} entityB={entityObjB} onOperation={onOperation} />
          {showGroupMode ? (
            <div className="field">
              <span className="field-label" id="cmp-mode-label">
                Group value
              </span>
              <div className="segmented" role="group" aria-labelledby="cmp-mode-label">
                {['observed', 'like_for_like'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={groupMode === mode}
                    className={groupMode === mode ? 'segmented-tab segmented-tab-active' : 'segmented-tab'}
                    onClick={() => onGroupMode(mode)}
                  >
                    {mode === 'observed' ? 'Observed' : 'Like-for-like'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {!canFetch ? (
          <EmptyState title="Choose two entities, a metric and a period">
            <p>Results appear here once the builder above is complete.</p>
          </EmptyState>
        ) : null}
      </Section>

      {canFetch ? (
        <Section id="compare-results" title="Result" subtitle={resultSubtitle(data, operation, metricKey)}>
          <StatusBlock loading={loading} error={null} empty={false} sectionName="comparison" />
          {error ? (
            <CompareError error={error} onRetry={retry} />
          ) : !loading && data ? (
            data.available === false ? (
              <UnavailableState reason={data.reason} code={data.reason} hint="Valid request, but the data or mathematics do not support it." />
            ) : (
              <>
                <div className="result-cards">
                  <EntityResultCard
                    slot="a"
                    entity={data.results.a}
                    countries={countries}
                    aggregates={aggregates}
                  />
                  <EntityResultCard
                    slot="b"
                    entity={data.results.b}
                    countries={countries}
                    aggregates={aggregates}
                  />
                </div>
                <GroupDetail entity={data.results.a} metricKey={metricKey} />
                <GroupDetail entity={data.results.b} metricKey={metricKey} />
                <ComparisonResult data={data} />
                <Trajectory
                  entityA={data.entities.a}
                  entityB={data.entities.b}
                  metricKey={metricKey}
                  yearA={data.years.a}
                  yearB={data.years.b ?? data.years.a}
                  countryNames={countryNames}
                />
                {data.vintage?.warning ? (
                  <p className="status status-empty" role="status">
                    Vintage note: {data.vintage.warning}
                  </p>
                ) : null}
                <MethodologyPanel
                  indicatorCode={data.metric?.indicatorCode}
                  derived={data.results.a?.kind === 'custom_group' || data.results.b?.kind === 'custom_group' ? 'Group values APP-derived from member observations' : operation === 'level' ? null : `Change via generic ${operation}`}
                  formula={data.results.comparison?.provenance?.formula ?? data.results.comparison?.a?.provenance?.formula ?? null}
                >
                  <p className="footnote">
                    {data.entities.a.kind === 'custom_group' || data.entities.b.kind === 'custom_group'
                      ? 'User-selected groups are request-defined and never official regions. '
                      : ''}
                    Source: World Bank World Development Indicators. Ranks shown nowhere here — comparison only.
                  </p>
                </MethodologyPanel>
              </>
            )
          ) : null}
          {loading ? (
            <p className="status status-loading" role="status">
              Loading comparison…
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function OperationSelect({ operation, metricKey, entityA, entityB, onOperation }) {
  // Entity-aware: metric capability metadata plus entity-kind rules, so an
  // operation the backend would reject is disabled here with its reason
  // instead of failing after submit.
  const options = operationsForEntities(metricKey, entityA, entityB).map((op) => ({
    value: op.id,
    label: op.label,
    disabled: !op.available,
    disabledReason: op.available ? undefined : op.disabledReason,
  }));
  return (
    <SearchableSelect
      id="cmp-operation"
      label="Analysis"
      value={operation}
      options={options}
      onChange={onOperation}
      placeholder="Select analysis…"
    />
  );
}

function resultSubtitle(data, operation, metricKey) {
  if (!data || data.available === false) return `${metricLabel(metricKey)} · ${operationLabel(operation)}`;
  const a = data.entities?.a;
  const b = data.entities?.b;
  const name = (e) => (e?.kind === 'custom_group' ? (e.label ?? 'group') : (e?.name ?? e?.iso3 ?? ''));
  return `${name(a)} vs ${name(b)} · ${metricTitle(metricKey)} · ${operationLabel(operation)}`;
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
