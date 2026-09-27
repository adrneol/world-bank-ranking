/**
 * Subscription-based media-query hook (no setState-in-effect).
 *
 * Matches the stylesheet's own chart breakpoint (`@media (max-width: 40rem)`
 * in index.css) so JS-driven chart geometry and CSS-driven rules switch at
 * the same width. Safe when matchMedia is unavailable (renders desktop
 * geometry).
 */

import { useCallback, useSyncExternalStore } from 'react';

export const NARROW_CHART_QUERY = '(max-width: 40rem)';

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsNarrowChart() {
  return useMediaQuery(NARROW_CHART_QUERY);
}

export default useMediaQuery;
