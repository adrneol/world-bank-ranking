/**
 * Bootstrap connection states (cold-start UX, presentation only).
 *
 * The deployed backend runs on a free hosting tier that can take up to about
 * a minute to wake on the first request. These panels distinguish "the data
 * service is waking" from "the data service actually failed" during the
 * years bootstrap in App.jsx. They hold no timers and start no requests:
 * `elapsedSec` is real elapsed time owned by the caller, and the progress
 * bar is a decorative indeterminate indicator (aria-hidden).
 */

import { formatElapsed } from '../utils/format.js';

export function BootstrapWarmup({ elapsedSec }) {
  return (
    <div className="status status-loading warmup" role="status" aria-label="Data service starting">
      <div className="warmup-row">
        <span className="warmup-pulse" aria-hidden="true" />
        <p className="warmup-title">Starting the data service</p>
      </div>
      <p className="warmup-body">
        The server is waking up. On the free hosting tier, the first connection usually takes up to about a
        minute.
      </p>
      <p className="warmup-counter" aria-hidden="true">
        {formatElapsed(elapsedSec)}
      </p>
      <span className="visually-hidden">Elapsed time is counting while the connection attempt runs.</span>
      <div className="warmup-bar" aria-hidden="true">
        <div className="warmup-bar-fill" />
      </div>
      <p className="warmup-foot muted">Still loading your World Bank data…</p>
    </div>
  );
}

export function BootstrapStillConnecting({ elapsedSec, onRetry }) {
  return (
    <div className="status status-loading warmup" role="status" aria-label="Data service still connecting">
      <div className="warmup-row">
        <span className="warmup-pulse" aria-hidden="true" />
        <p className="warmup-title">Still connecting…</p>
      </div>
      <p className="warmup-body">
        The server is taking longer than usual. We&apos;re still waiting for your data service.
      </p>
      <p className="warmup-counter" aria-hidden="true">
        {formatElapsed(elapsedSec)}
      </p>
      <span className="visually-hidden">Elapsed time is counting while the connection attempt runs.</span>
      <div className="warmup-bar" aria-hidden="true">
        <div className="warmup-bar-fill" />
      </div>
      <p className="warmup-foot">
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Retry connection
        </button>
      </p>
    </div>
  );
}

export function BootstrapError({ message, elapsedSec, onRetry }) {
  return (
    <div className="status status-error" role="alert">
      <p>Could not load available years: {message}</p>
      {elapsedSec > 0 ? (
        <p className="muted">
          The connection attempt ran for {formatElapsed(elapsedSec)} before failing.
        </p>
      ) : null}
      <p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Retry connection
        </button>
      </p>
    </div>
  );
}
