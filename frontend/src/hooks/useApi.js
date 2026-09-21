/**
 * Data-fetching hooks with stale-response protection.
 *
 * Every in-flight request is tied to an AbortController that is aborted when
 * its inputs change or the component unmounts, so a slow earlier response
 * (e.g. year 2024) can never overwrite a newer one (e.g. year 2023) after
 * rapid filter changes. Aborts are swallowed silently; real errors surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async fetcher whenever `depsKey` changes.
 * fetcher receives an AbortSignal and must pass it to the API client.
 */
export function useApi(fetcher, depsKey, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(() => fetcher(controller.signal))
      .then((result) => {
        if (requestId.current !== id || controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (requestId.current !== id || controller.signal.aborted) return;
        if (fetchError?.name === 'AbortError') return;
        setError(fetchError);
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
    // depsKey is a caller-computed stable string of all inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, reloadToken, enabled]);

  return { data, loading, error, retry };
}
