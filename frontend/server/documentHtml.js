import { pagePath, publicPages } from '../src/config/publicPages.js';

export const humanPages = Object.fromEntries(Object.entries(publicPages).filter(([key]) => key !== 'public-data'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const DOCUMENT_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>try{document.documentElement.dataset.theme=localStorage.getItem('wdi-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}</script><!-- public-metadata-start --><!-- public-metadata-end --><style>body{margin:0;font:16px system-ui,sans-serif}main{max-width:76rem;margin:auto;padding:1.25rem}a,code{overflow-wrap:anywhere}</style></head><body><!-- public-body-start --><!-- public-body-end --></body></html>`;
export function siteOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Public site origin must be an HTTPS origin.');
  return url.origin;
}
const header = `<header><a href="/">WDI Research Explorer</a><button type="button" aria-label="Switch theme" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('wdi-theme',document.documentElement.dataset.theme)}catch{}">◐</button></header>`;

/** Shared server-rendered HTML for builds, Vite and the frontend-host function. */
export function publicPageHtml(template, view, origin, resources = [], apiOrigin = '', pages = humanPages, unavailable = null) {
  const [name, summary] = publicPages[view];
  const heading = unavailable ? (unavailable.includes('disabled') ? 'Public data API not published' : 'Public data service temporarily unavailable') : name;
  const description = unavailable ?? summary;
  const title = `${heading} | WDI Research Explorer`;
  const address = origin ? origin + pagePath(view) : null;
  const image = `${origin ?? ''}/research-preview.png`;
  const meta = (key, value) => `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}">`;
  const tags = [`<title>${escape(title)}</title>`, meta('description', description), meta('og:title', title), meta('og:description', description),
    meta('og:site_name', 'WDI Research Explorer'), meta('og:type', 'website'), meta('og:image', image), meta('og:image:width', '1200'), meta('og:image:height', '630'),
    meta('og:image:alt', 'WDI Research Explorer, independent analysis of World Bank development indicators'), meta('twitter:card', 'summary_large_image'), meta('twitter:title', title), meta('twitter:description', description), meta('twitter:image', image), meta('twitter:image:alt', 'WDI Research Explorer, independent analysis of World Bank development indicators')];
  if (address) tags.push(`<link rel="canonical" href="${escape(address)}">`, meta('og:url', address));
  if (unavailable) tags.push(meta('robots', 'noindex'));
  if (view === 'public-data') tags.push('<link rel="stylesheet" href="/document.css">');
  if (view === 'home') tags.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'WDI Research Explorer', description, ...(address ? { url: address } : {}) }).replaceAll('<', '\\u003c')}</script>`);
  const nav = `<nav aria-label="Research pages">${Object.entries(pages).map(([key, [label]]) => `<a href="${pagePath(key)}">${escape(label)}</a>`).join('')}</nav>`;
  const docs = view === 'public-data' && !unavailable ? `<section><h2>Read economic data</h2><p><a href="/data-catalog.json">Machine-readable catalog (JSON)</a></p>
    <p>These public resources return JSON over GET. Read registry keys, units, supported methods and availability reasons before interpreting a result. Missing observations remain null or unavailable; they are never zero-filled.</p>
    <p>Example: <a href="${escape(apiOrigin)}/api/public/focus/history?country=JPN&amp;series=total_constant&amp;startYear=2020&amp;endYear=2024"><code>/api/public/focus/history?country=JPN&amp;series=total_constant&amp;startYear=2020&amp;endYear=2024</code></a>. The JSON contains registered series, year/value/raw observations, units and recorded source vintage.</p>
    <p>Use entity specs such as <code>country:USA</code>, <code>aggregate:WLD</code> and <code>group:USA,JPN</code> with supported Compare methods. Official aggregates retain published observations. Custom groups use their declared backend calculation. Observed and like-for-like results have distinct eligible populations.</p>
    <p>Ranking responses are paginated. History is bounded to eight series and 100 years. The shared read limit is 60 requests per minute per server-resolved client address; honor <code>Retry-After</code> on HTTP 429. HTTP 400 means invalid inputs; HTTP 503 means the service is temporarily unavailable. A valid request may return an unavailable result with its reason.</p>
    <p>Public aliases are read-only: they do not schedule refreshes or persist integrity checks. Privileged refresh is separate. Disabling optional publication does not make the human-facing APIs or already-public web content private.</p>
    <p>Source: World Bank World Development Indicators, source 2. This independent application calculates ranks, changes and benchmarks. Review <a href="https://data.worldbank.org/summary-terms-of-use">World Bank data terms</a> and recorded indicator provenance before reuse.</p>
    <p>Historical examples retain their dates for reproducibility. Discover current global years through <a href="${escape(apiOrigin)}/api/public/years">published years</a> and economy/indicator-specific years through <a href="${escape(apiOrigin)}/api/public/availability?indicator=total_current&amp;entityA=country%3AUSA&amp;entityB=country%3AJPN">shared availability</a>, then construct explicit numeric-year requests. The API does not accept a literal latest year.</p>
    <p><a href="${escape(apiOrigin)}/api/public/compare?entityA=country%3AUSA&amp;entityB=country%3AJPN&amp;indicator=total_current&amp;yearA=2024&amp;yearC=2025&amp;operation=level">USA versus Japan nominal GDP, 2024–2025 →</a></p>
    <p><a href="${escape(apiOrigin)}/api/public/observations?indicator=total_current&amp;country=IND&amp;year=2024">India nominal GDP observation, 2024 →</a></p>
    </section><section><h2>Endpoint reference</h2><dl class="public-endpoints">${resources.map(resource => {
      const operation=Array.isArray(resource)?{path:resource[0],summary:resource[1],description:resource[2],parameters:[],examples:[]}:resource;
      return `<div><dt><code>${escape(operation.method??'GET')} ${escape(operation.path)}</code><strong>${escape(operation.summary)}</strong></dt><dd><p>${escape(operation.description)}</p>${operation.examples.map(example=>`<a class="document-example" href="${escape(example.url)}"><code>GET ${escape(example.url)}</code></a>`).join('')}<details><summary>Parameters (${operation.parameters.length})</summary><dl>${operation.parameters.map(parameter=>`<dt><code>${escape(parameter.name)}</code> · ${parameter.required?'required':'optional'}</dt><dd><code>${escape(parameter.definition?.type??'string')}</code> — ${escape(parameter.definition?.description??'See the catalog for the current contract.')}${parameter.definition?.enum?` Allowed: <code>${escape(parameter.definition.enum.join(', '))}</code>.`:''}${parameter.definition?.minimum!=null?` Minimum ${parameter.definition.minimum}.`:''}${parameter.definition?.maximum!=null?` Maximum ${parameter.definition.maximum}.`:''}${parameter.definition?.maxItems?` Maximum ${parameter.definition.maxItems} items.`:''}${parameter.definition?.dynamicMaximum?` Maximum: ${escape(parameter.definition.dynamicMaximum)}.`:''} <a href="/data-catalog.json">Machine definition</a>: <code>${escape(parameter.schema.$ref)}</code>.</dd>`).join('')}</dl></details></dd></div>`;
    }).join('')}</dl></section>` : '';
  const body = `<div id="root"><div class="public-document" data-public-view="${view}">${header}<main><h1>${escape(heading)}</h1><p>${escape(description)}</p>${unavailable ? '<div class="document-actions"><form method="get" action="/public-data/"><button class="document-retry" type="submit">Try again</button></form><a href="/">Return to Home →</a></div>' : nav}${docs}<p class="document-source">Independent research using World Bank WDI observations. Derived analyses are calculated by this application.</p></main></div></div>`;
  return template.replace(/<!-- public-metadata-start -->[\s\S]*?<!-- public-metadata-end -->/, `<!-- public-metadata-start -->${tags.join('\n')}<!-- public-metadata-end -->`)
    .replace(/<!-- public-body-start -->[\s\S]*?<!-- public-body-end -->/, `<!-- public-body-start -->${body}<!-- public-body-end -->`);
}

export function sitemapXml(origin, enabled) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    Object.keys(enabled ? publicPages : humanPages).map(view => `<url><loc>${escape(origin + pagePath(view))}</loc></url>`).join('') + '</urlset>';
}
