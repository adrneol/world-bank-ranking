/**
 * Debounced value for API-backed search-as-you-type.
 *
 * Local (already-loaded) lists filter immediately with no debounce; remote
 * searches use this so each keystroke does not fire a request. The trailing
 * edge always wins; unmount/change cancels the pending update.
 */

import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default useDebouncedValue;
