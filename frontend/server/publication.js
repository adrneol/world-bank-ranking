import { publicPages } from '../src/config/publicPages.js';
import { humanPages, publicPageHtml, sitemapXml } from './documentHtml.js';

export const publicationResource = path => {
  if (['/public-data', '/public-data/', '/public-data/index.html'].includes(path)) return 'docs';
  if (path === '/data-catalog.json') return 'catalog';
  if (path === '/sitemap.xml') return 'sitemap';
  return null;
};

export async function publicationState(backend, fetcher = fetch) {
  try {
    const url = new URL(backend);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'unavailable';
    const response = await fetcher(backend.replace(/\/+$/, '') + '/api/capabilities', { signal: AbortSignal.timeout(2500), cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return 'unavailable';
    const body = await response.json();
    return body?.publicReadApiEnabled === true ? 'enabled' : body?.publicReadApiEnabled === false ? 'disabled' : 'unavailable';
  } catch { return 'unavailable'; }
}

/** No analytical proxy: only render local documents after a fresh capability read. */
export async function respondPublication(req, res, { resource, backend, origin, catalog, template, fetcher }) {
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) res.setHeader(name, 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; res.end(); return;
  }
  if (!['docs', 'catalog', 'sitemap'].includes(resource)) { res.statusCode = 404; res.end(); return; }
  const state = await publicationState(backend, fetcher);
  const enabled = state === 'enabled';
  let body;
  if (resource === 'sitemap' && origin) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    body = sitemapXml(origin, enabled);
  } else if (resource === 'sitemap') {
    res.statusCode = 404; body = 'Sitemap requires a configured production origin.';
  } else if (resource === 'catalog') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = enabled ? 200 : state === 'disabled' ? 404 : 503;
    body = JSON.stringify(enabled ? { ...catalog, apiOrigin: backend } : { error: { code: 'PUBLICATION_UNAVAILABLE', message: 'Optional public API publication is unavailable.' } });
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = enabled ? 200 : state === 'disabled' ? 404 : 503;
    const unavailable = enabled ? null : state === 'disabled' ? 'The data service has disabled optional public API publication.' : 'Public API availability could not be confirmed. Try again when the data service is reachable.';
    const html = (await template()).replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g, '');
    body = publicPageHtml(html, 'public-data', origin, catalog.resources, backend, enabled ? publicPages : humanPages, unavailable);
  }
  res.end(req.method === 'HEAD' ? undefined : body);
}
