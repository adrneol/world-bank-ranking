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
