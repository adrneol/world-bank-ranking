import { api } from '../api/client.js';

/** Country-only hints; never interpret a localhost address as a public location. */
export async function resolveEconomyLocation(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 2500);
  try {
    const response = await fetch('/api/location', {
      signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const result = response.ok ? await response.json() : null;
    if (result?.source === 'frontend-edge' && /^[A-Z]{2}$/.test(result.iso2)) return { iso2: result.iso2 };
  } catch { if (signal.aborted) throw new DOMException('Location lookup cancelled', 'AbortError'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  if (signal.aborted) throw new DOMException('Location lookup cancelled', 'AbortError');
  const result = await api.geoCountry({ signal, timeoutMs: 4000, passive: true });
  const iso3 = typeof result?.iso3 === 'string' ? result.iso3.trim().toUpperCase() : '';
  return result?.source === 'geoip' && /^[A-Z]{3}$/.test(iso3) ? { iso3 } : null;
}

export function eligibleLocationCountry(candidate, countries) {
  if (!candidate) return null;
  const iso3 = typeof candidate.iso3 === 'string' && /^[A-Z]{3}$/.test(candidate.iso3) ? candidate.iso3 : null;
  const iso2 = typeof candidate.iso2 === 'string' && /^[A-Z]{2}$/.test(candidate.iso2) ? candidate.iso2 : null;
  if (!iso3 && !iso2) return null;
  return countries.find(row => !row.isAggregate && Number(row.is_aggregate ?? 0) === 0 &&
    (iso3 ? row.iso3 === iso3 : typeof row.iso2 === 'string' && row.iso2.toUpperCase() === iso2)) ?? null;
}
