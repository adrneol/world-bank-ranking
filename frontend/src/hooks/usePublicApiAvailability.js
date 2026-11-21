import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { hasPublicReadApi } from '../config/publicAccess.js';

/** One bounded read per visit/focus/return online, never a polling loop. */
export function usePublicApiAvailability(view) {
  const [enabled, setEnabled] = useState(false);
  const acceptedRequest = useRef(-Infinity);
  const observe = useCallback((result, started = performance.now()) => {
    if (started < acceptedRequest.current) return;
    acceptedRequest.current = started;
    setEnabled(hasPublicReadApi(result));
  }, []);
  useEffect(() => {
    let controller;
    let disposed = false;
    const check = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const started = performance.now();
      observe(null, started);
      api.capabilities({ signal, timeoutMs: 4000 }).then(result => {
        if (!disposed && !signal.aborted) observe(result, started);
      }).catch(() => { /* Optional discovery fails closed; normal analysis continues. */ });
    };
    const visible = () => { if (!document.hidden) check(); };
    check();
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [view, observe]);
  return { enabled, observe };
}
