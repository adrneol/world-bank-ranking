/**
 * Shared presentational components: section shell, async-state blocks,
 * pagination controls and labeled form controls.
 */

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
      <label className="pagination-size">
        Rows
        <select value={pageSize} onChange={(event) => onPage(1, Number(event.target.value))} aria-label="Rows per page">
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
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
