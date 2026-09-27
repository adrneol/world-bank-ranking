/**
 * Shared presentational components: section shell, async-state blocks,
 * pagination controls and labeled form controls.
 */

import { Children, cloneElement, isValidElement } from 'react';

export function Section({ id, title, subtitle, children, aside }) {
  return (
    <section id={id} className="section" aria-labelledby={`${id}-heading`}>
      <div className="section-head">
        <div>
          <h2 id={`${id}-heading`}>{title}</h2>
          {subtitle ? <p className="section-sub">{subtitle}</p> : null}
        </div>
        {aside ? <div className="section-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatusBlock({ loading, error, empty, emptyText, onRetry, sectionName }) {
  if (loading) {
    return (
      <p className="status status-loading" role="status">
        Loading{sectionName ? ` ${sectionName}` : ''}…
      </p>
    );
  }
  if (error) {
    return (
      <div className="status status-error" role="alert">
        <p>
          Could not load{sectionName ? ` ${sectionName}` : ''}: {error?.message ?? 'Unknown error.'}
        </p>
        {onRetry ? (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (empty) {
    return <p className="status status-empty">{emptyText ?? 'No data available for this selection.'}</p>;
  }
  return null;
}

export function Pagination({ page, pages, total, pageSize, onPage }) {
  if (!pages || pages < 1) return null;
  // Rows-per-page as segmented buttons (existing design-system pattern):
  // three fixed options need no dropdown, custom or native.
  return (
    <div className="pagination" role="navigation" aria-label="Ranking pages">
      <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span className="pagination-info" aria-live="polite">
        Page {page} of {pages} · {total} ranked countries
      </span>
      <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
      <div className="segmented" role="group" aria-label="Rows per page">
        {[25, 50, 100].map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={pageSize === size}
            className={pageSize === size ? 'segmented-tab segmented-tab-active' : 'segmented-tab'}
            onClick={() => onPage(1, size)}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Labeled form control (Phase 5 R-13 labeling repair).
 *
 * Previously a `<label htmlFor>` wrapping arbitrary children — invalid
 * whenever the child was a SearchableSelect (whose popover contains its own
 * labelable filter input) and misleading for composite children. Now a
 * neutral grouping with a real label association that always reaches the
 * actual interactive control:
 *   - native input/select/textarea child with a matching id is explicitly
 *     tied via aria-labelledby (cloned in place; existing props preserved),
 *   - component children (SearchableSelect) already expose their own
 *     accessible name on the trigger button; the visible text is no longer
 *     wrapped in a label element, so the association cannot be invalid.
 */
const NATIVE_LABELED_ELEMENTS = new Set(['input', 'select', 'textarea']);

export function Field({ label, htmlFor, children, hint }) {
  const labelId = htmlFor ? `${htmlFor}-label` : undefined;
  const associated = Children.map(children, (child) => {
    if (
      labelId &&
      isValidElement(child) &&
      typeof child.type === 'string' &&
      NATIVE_LABELED_ELEMENTS.has(child.type) &&
      child.props?.id === htmlFor &&
      child.props?.['aria-labelledby'] === undefined
    ) {
      return cloneElement(child, { 'aria-labelledby': labelId });
    }
    return child;
  });
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      {associated}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Renders backend reason text only when the value itself is unavailable. */
export function Unavailable({ reason }) {
  if (!reason) return <span className="muted">—</span>;
  return (
    <span className="muted" title={reason}>
      n/a
    </span>
  );
}

/**
 * Provenance badge: RAW (World Bank observation) vs APP_DERIVED, plus entity
 * provenance for aggregates and user-defined groups. Quiet by design —
 * precision without clutter.
 */
export function ProvenanceBadge({ kind }) {
  if (kind === 'APP_DERIVED') {
    return <span className="badge badge-derived">App-derived</span>;
  }
  if (kind === 'wb_aggregate') {
    return <span className="badge badge-aggregate">World Bank aggregate</span>;
  }
  if (kind === 'custom_group') {
    return <span className="badge badge-group">User-selected group</span>;
  }
  return <span className="badge badge-raw">World Bank observation</span>;
}

/** Entity-type badge used in compare headers and result cards. */
export function EntityBadge({ kind }) {
  if (kind === 'wb_aggregate') return <ProvenanceBadge kind="wb_aggregate" />;
  if (kind === 'custom_group') return <ProvenanceBadge kind="custom_group" />;
  return null;
}

/**
 * Differentiated empty/unavailable/error states (Phase 6): missing data,
 * unsupported operations and failures each read distinctly. Never a blank
 * card, never a zero standing in for "not supported".
 */
export function EmptyState({ title = 'Nothing to show', children }) {
  return (
    <div className="state state-empty" role="status">
      <p className="state-title">{title}</p>
      {children ? <div className="state-body">{children}</div> : null}
    </div>
  );
}

export function UnavailableState({ reason, code, hint }) {
  return (
    <div className="state state-unavailable" role="status">
      <p className="state-title">Not available for this selection</p>
      {reason ? <p className="state-body">{String(reason).replace(/_/g, ' ')}</p> : null}
      {code ? <p className="mono state-code">{code}</p> : null}
      {hint ? <p className="state-body muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Collapsible methodology/source surface. Primary screens stay clean;
 * provenance lives one disclosure away.
 */
export function MethodologyPanel({ source, indicatorCode, derived, formula, children }) {
  return (
    <details className="details methodology">
      <summary>Methodology &amp; source</summary>
      <dl className="facts">
        <div>
          <dt>Source</dt>
          <dd>World Bank World Development Indicators</dd>
        </div>
        {indicatorCode ? (
          <div>
            <dt>Indicator</dt>
            <dd className="mono">{indicatorCode}</dd>
          </div>
        ) : null}
        {source ? (
          <div>
            <dt>Derivation</dt>
            <dd>{source}</dd>
          </div>
        ) : null}
        {derived ? (
          <div>
            <dt>Derived</dt>
            <dd>{derived}</dd>
          </div>
        ) : null}
        {formula ? (
          <div>
            <dt>Formula</dt>
            <dd className="mono">{formula}</dd>
          </div>
        ) : null}
      </dl>
      {children}
    </details>
  );
}

/**
 * Metric hero: human-readable name, unit, subject, code and source in one
 * compact editorial block. Secondary information only — never the analysis.
 */
export function AnalysisHeader({ title, unit, subjectLabel: subject, indicatorCode, observationTypeLabel, children }) {
  return (
    <div className="analysis-header">
      <div>
        <p className="eyebrow eyebrow-dark">{subject}</p>
        <h2 className="analysis-title">{title}</h2>
        <p className="analysis-meta">
          {unit ? <span>{unit}</span> : null}
          {observationTypeLabel ? <span> · {observationTypeLabel}</span> : null}
          {indicatorCode ? <span className="mono"> · {indicatorCode}</span> : null}
        </p>
      </div>
      {children ? <div className="analysis-header-side">{children}</div> : null}
    </div>
  );
}

/**
 * Accessible textual equivalent for an analytical chart (Phase 5 R-13).
 *
 * Charts expose values through hover tooltips; this disclosure carries the
 * SAME backend-provided values as an ordinary data table so keyboard and
 * screen-reader users obtain them without hovering. Cells arrive
 * pre-formatted by the caller from backend responses — this component never
 * calculates, only lays out. Reuses the existing `chart-data-fallback`
 * disclosure pattern (same classes, same visual language).
 *
 * @param {string} label table subject, e.g. "annual values"
 * @param {string} regionName accessible region label
 * @param {{header:string, numeric?:boolean}[]} columns
 * @param {string[][]} rows pre-formatted cell strings (missing stays '—')
 */
export function ChartDataFallback({ label = 'chart values', regionName = null, columns = [], rows = [] }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <details className="chart-data-fallback">
      <summary>View {label} as a table</summary>
      <div className="table-scroll" role="region" aria-label={regionName ?? label} tabIndex={0}>
        <table className="table table-compact">
          <thead>
            <tr>
              {columns.map((col, i) =>
                i === 0 ? (
                  <th key={i} scope="col">
                    {col.header}
                  </th>
                ) : (
                  <th key={i} scope="col" className={col.numeric === false ? undefined : 'num'}>
                    {col.header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r}>
                {cells.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={c} className="num">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
