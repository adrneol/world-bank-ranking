/**
 * DEFAULT-COUNTRY GEOLOCATION (Phase 3 UX default only, never analytical).
 *
 * Resolves the requester's ISO3 country ONCE per lookup through a keyless
 * external IP geolocation provider, validated against the stored World Bank
 * country metadata. Unknown codes and aggregates resolve to null.
 *
 * - the client IP is used transiently for the single provider call only;
 * - it is never logged, never persisted, and only an ISO3 (or null) is
 *   returned — no IP, city, coordinates or other location ever leaves;
 * - loopback/private/reserved addresses are never sent to the provider;
 * - validated successes are cached in memory (salted digest, bounded) so repeated
 *   loads do not hammer the provider;
 * - every failure mode (timeout, provider error, malformed payload,
 *   unknown/aggregate country, disabled provider) resolves to null —
 *   geolocation can never break normal application functionality.
 */

import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import config from '../config.js';
import { verifiedProxyIdentity } from './proxyIdentity.js';
import { getDb } from '../db/index.js';
import { getCountryByIso2 } from '../db/repository.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map();
const cacheSalt = randomBytes(32);

/** Test seam: drop all cached lookups. */
export function resetGeoCache() {
  cache.clear();
}

function cacheGet(ip) {
  const entry = cache.get(ip);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    cache.delete(ip);
    return undefined;
  }
  return entry.iso3;
}

function cacheSet(ip, iso3) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(ip, { iso3, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Accept a direct peer, or Express's resolved client address when the
 * application has explicitly configured a trusted proxy boundary.
 */
export function clientIpFromRequest(req) {
  const trusted = req?.app?.get('trust proxy');
  const signed=req?.headers?verifiedProxyIdentity(req):null;
  if (!signed && req?.headers?.['x-forwarded-for'] && !trusted) return null;
  let raw = signed ?? (trusted ? req?.ip : req?.socket?.remoteAddress);
  raw = String(raw ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'unknown') return null;
  // Normalize: strip brackets, zone ids and IPv4-mapped IPv6 prefixes.
  let ip = raw.replace(/^\[(.*)\]$/, '$1').split('%')[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  return isIP(ip) ? ip : null;
}

function v4Octets(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return null;
  return octets;
}

/**
 * True only for globally routable addresses. Loopback, private, link-local,
 * unspecified, multicast and reserved ranges (v4 and v6) are never sent to
 * the geolocation provider — development/CI traffic included.
 */
export function isRoutableIp(ip) {
  if (typeof ip !== 'string' || !isIP(ip)) return false;
  const v4 = v4Octets(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 127 || a >= 224) return false;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && v4[2] === 100))) return false;
    if ((a === 192 && b === 0 && (v4[2] === 0 || v4[2] === 2)) || (a === 203 && b === 0 && v4[2] === 113)) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false;
  if (lower.startsWith('fe80:')) return false;
  if (lower === 'fc00::' || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return /^[23][0-9a-f]{3}:/.test(lower) && !/^2001:db8:/.test(lower);
}

/**
 * Resolve one IP to an eligible ISO3 country, or null. `options.fetchImpl`
 * is a test seam (defaults to global fetch). Exactly one provider attempt
 * with a bounded timeout — no retries: slowness fails fast to the fallback.
 */
export async function lookupCountryForIp(db, ip, options = {}) {
  if (!isRoutableIp(ip)) return null;
  const cacheKey = createHash('sha256').update(cacheSalt).update(ip).digest('hex');
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const providerUrl = options.providerUrl ?? config.geo.providerUrl;
  const timeoutMs = options.timeoutMs ?? config.geo.timeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  let iso3 = null;

  if (typeof providerUrl === 'string' && providerUrl !== '') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = providerUrl.includes('{ip}')
        ? providerUrl.replace('{ip}', encodeURIComponent(ip))
        : `${providerUrl.replace(/\/+$/, '')}/${encodeURIComponent(ip)}`;
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (response?.ok) {
        const body = await response.json().catch(() => null);
        const alpha2 = body?.country_code ?? body?.countryCode ?? null;
        if (typeof alpha2 === 'string' && /^[A-Za-z]{2}$/.test(alpha2.trim())) {
          const row = await getCountryByIso2(db ?? getDb(), alpha2);
          if (row && Number(row.is_aggregate) === 0 && typeof row.iso3 === 'string' && row.iso3 !== '') {
            iso3 = row.iso3;
          }
        }
      }
    } catch {
      iso3 = null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Do not poison subsequent visits/recovery with a cached timeout or null lookup.
  if (iso3) cacheSet(cacheKey, iso3);
  return iso3;
}

/** Request-level orchestration for GET /api/geo/country. Never throws. */
export async function geoCountryForRequest(db, req, options = {}) {
  try {
    const ip = clientIpFromRequest(req);
    if (!ip) return null;
    return await lookupCountryForIp(db, ip, options);
  } catch {
    return null;
  }
}
