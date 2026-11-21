import { useId, useRef, useState } from 'react';

/** Bounded diagnostic dialog leaves the table and its scroll position intact. */
export default function FailureDetails({ title, text, children, record }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const label = useId();
  const [copyStatus, setCopyStatus] = useState('idle');
  return <>
    <button ref={trigger} type="button" className="btn btn-secondary failure-details-trigger" aria-haspopup="dialog" aria-controls={label}
      onClick={() => { setCopyStatus('idle'); dialog.current.showModal(); }}>{children ?? 'View failure details'}</button>
    <dialog ref={dialog} id={label} className="failure-details" aria-labelledby={label + '-title'}
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <header><h3 id={label + '-title'}>{title}</h3><button type="button" className="btn btn-secondary" autoFocus onClick={() => dialog.current.close()}>Close</button></header>
      <div className="failure-details-scroll" role="region" aria-label="Full failure details" tabIndex={0}>
        <pre>{text || 'No detailed error was recorded.'}</pre>
        {record ? <details><summary>Recorded run fields</summary><pre>{JSON.stringify(record, null, 2)}</pre></details> : null}
      </div>
      {typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function' ? <button type="button" className="btn btn-secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(text ?? ''); setCopyStatus('copied'); } catch { setCopyStatus('failed'); }
      }}>{copyStatus === 'copied' ? 'Copied' : 'Copy full error text'}</button> : <p className="chart-note">Select the full text above to copy it.</p>}
      {copyStatus === 'failed' ? <p role="status">Automatic copying is unavailable. Select the full text above to copy it.</p> : null}
    </dialog>
  </>;
}
