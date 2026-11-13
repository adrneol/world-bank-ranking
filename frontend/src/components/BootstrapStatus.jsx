export function DataLoading({ title, children, onRetry }) {
  return <div className="status-loading data-loading" role="status">
    <span className="data-loading-columns" aria-hidden="true"><i /><i /><i /><i /></span>
    <div><strong>{title}</strong>{children ? <p>{children}</p> : null}
      {onRetry ? <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry connection</button> : null}
    </div>
  </div>;
}

export function BootstrapWarmup() {
  return <DataLoading title="Connecting to economic data">Retrieving the available dataset.</DataLoading>;
}

export function BootstrapStillConnecting({ onRetry }) {
  return <DataLoading title="Connection is taking longer than expected" onRetry={onRetry}>
    Still trying to reach the data service.
  </DataLoading>;
}

export function BootstrapError({ message, onRetry }) {
  return <div className="status status-error" role="alert">
    <strong>Unable to connect</strong>
    <p>{message}</p>
    <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry connection</button>
  </div>;
}
