import { publicPages } from '../src/config/publicPages.js';
import { DOCUMENT_SHELL, humanPages, publicPageHtml, sitemapXml } from './documentHtml.js';
import { bindCatalog } from './apiCatalog.js';

const flights = new Map();
export function backendOrigin(value) {
  try {
    const url = new URL(value?.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

export const publicationResource = path => {
  if (['/public-data', '/public-data/', '/public-data/index.html'].includes(path)) return 'docs';
  if (path === '/data-catalog.json') return 'catalog';
  if (path === '/sitemap.xml') return 'sitemap';
  return null;
};

export async function publicationState(backend, fetcher = fetch, scope = null) {
  const origin = backendOrigin(backend);
  if (!origin) return 'unavailable';
  // Concurrent requests share only an active check, never a cached permission.
  const key = scope ? origin+':'+scope : fetcher === fetch ? origin : null;
  if (key && flights.has(key)) return flights.get(key);
  const work = (async () => {
    for (const timeoutMs of [2500, 1500]) {
      try {
        const response = await fetcher(origin + '/api/capabilities', { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (response.ok) {
          const body = await response.json().catch(() => null);
          return body?.publicReadApiEnabled === true ? 'enabled' : body?.publicReadApiEnabled === false ? 'disabled' : 'unavailable';
        }
        if (![502, 503, 504].includes(response.status)) return 'unavailable';
      } catch { /* One bounded retry for a transient read failure. */ }
    }
    return 'unavailable';
  })();
  if (key && flights.size<64) { flights.set(key, work); const clear = () => flights.delete(key); work.then(clear, clear); }
  return work;
}

export function publicationFailure(req, res, { resource, origin = null, disabled = false, rendering = false } = {}) {
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) res.setHeader(name, 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = disabled ? 404 : 503;
  if (!disabled) res.setHeader('Retry-After', '5');
  const message = disabled ? 'The data service has disabled optional public API publication.' : rendering ? 'Public documentation could not be loaded. Please try again.' : 'We could not verify public API availability. Please try again.';
  const json = resource === 'catalog';
  res.setHeader('Content-Type', json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
  const body = json ? JSON.stringify({ error: { code: disabled ? 'PUBLIC_API_DISABLED' : 'PUBLICATION_UNAVAILABLE', message } }) : publicPageHtml(DOCUMENT_SHELL, 'public-data', origin, [], '', humanPages, message);
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** No analytical proxy: only render local documents after a fresh capability read. */
export async function respondPublication(req, res, { resource, backend, origin, catalog, template, fetcher, authorityScope }) {
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) res.setHeader(name, 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; res.end(); return;
  }
  if (!['home','docs', 'catalog', 'sitemap'].includes(resource)) { res.statusCode = 404; res.end(); return; }
  const state = await publicationState(backend, fetcher, authorityScope);
  const enabled = state === 'enabled';
  if (resource !== 'home' && resource !== 'sitemap' && !enabled) return publicationFailure(req, res, { resource, origin, disabled: state === 'disabled' });
  let body;
  if(resource==='home') {
    res.setHeader('Content-Type','text/html; charset=utf-8');res.statusCode=200;
    body=publicPageHtml(await template(),'home',origin,[], '',enabled?publicPages:humanPages);
  } else if (resource === 'sitemap' && origin) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    body = sitemapXml(origin, enabled);
  } else if (resource === 'sitemap') {
    res.statusCode = 404; body = 'Sitemap requires a configured production origin.';
  } else if (resource === 'catalog') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = enabled ? 200 : state === 'disabled' ? 404 : 503;
    body = JSON.stringify(bindCatalog(catalog, origin ?? ''));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = enabled ? 200 : state === 'disabled' ? 404 : 503;
    const unavailable = enabled ? null : state === 'disabled' ? 'The data service has disabled optional public API publication.' : 'Public API availability could not be confirmed. Try again when the data service is reachable.';
    const html = (await template()).replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '');
    body = publicPageHtml(html, 'public-data', origin, bindCatalog(catalog, origin ?? '').operations, origin ?? '', enabled ? publicPages : humanPages, unavailable);
  }
  res.end(req.method === 'HEAD' ? undefined : body);
}
