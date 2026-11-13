import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pagePath, publicPages } from './src/config/publicPages.js';

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const site = 'WDI Research Explorer';
const imageAlt = 'WDI Research Explorer, independent analysis of World Bank development indicators';

function originOf(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Public site origin must be an HTTPS origin.');
  }
  return url.origin;
}

export function publicPageHtml(template, view, origin, resources, apiOrigin = '') {
  const [heading, description] = publicPages[view];
  const title = `${heading} | ${site}`;
  const address = origin ? `${origin}${pagePath(view)}` : null;
  const image = `${origin ?? ''}/research-preview.png`;
  const meta = (key, value) => `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}">`;
  const tags = [`<title>${escape(title)}</title>`, meta('description', description), meta('og:title', title),
    meta('og:description', description), meta('og:site_name', site), meta('og:type', 'website'), meta('og:image', image),
    meta('og:image:width', '1200'), meta('og:image:height', '630'), meta('og:image:alt', imageAlt),
    meta('twitter:card', 'summary_large_image'), meta('twitter:title', title), meta('twitter:description', description),
    meta('twitter:image', image), meta('twitter:image:alt', imageAlt)];
  if (address) tags.push(`<link rel="canonical" href="${escape(address)}">`, meta('og:url', address));
  const nav = `<nav aria-label="Research pages">${Object.entries(publicPages).map(([key, [name]]) => `<a href="${pagePath(key)}">${escape(name)}</a>`).join(' · ')}</nav>`;
  const catalog = view === 'public-data' ? `<p><a href="/data-catalog.json">Machine-readable catalog (JSON)</a></p>
    <p>Public resources return JSON over GET. Check availability and reason fields before using a result. Missing observations are null or absent. Registry keys identify measures and ISO3 identifies economies.</p>
    <p>For ranked results, request one metric and year at a time and follow the returned pagination. Observed and like-for-like comparisons retain their own eligible universes. The public API allows 60 requests per minute per server-resolved client address. Honor Retry-After on HTTP 429.</p>
    <p>Example request shape, without a live value: <code>/api/public/observations?indicator=total_constant&amp;year=2020&amp;country=JPN</code>.</p>
    <dl>${resources.map(([path, name, params]) => `<dt><a href="${escape(apiOrigin + path)}"><code>${escape(path)}</code></a> · ${escape(name)}</dt><dd>${escape(params)}</dd>`).join('')}</dl>` : '';
  return template.replace(/\s*<!-- public-metadata-start -->[\s\S]*?<!-- public-metadata-end -->/, tags.join('\n    '))
    .replace('<div id="root"></div>', `<div id="root"><main><h1>${escape(heading)}</h1><p>${escape(description)}</p>
    <p>Independent research using World Bank World Development Indicators. Rankings and derived analyses are calculated by this application.</p>
    ${nav}${catalog}</main></div>`);
}

export function publicDocuments({ origin, catalog }) {
  let outDir;
  let root;
  let apiOrigin;
  const base = originOf(origin);
  return {
    name: 'public-research-documents',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = join(root, config.build.outDir);
      const api = config.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
      apiOrigin = /^https?:\/\//.test(api) ? api : '';
    },
    async closeBundle() {
      const template = await readFile(join(outDir, 'index.html'), 'utf8');
      for (const view of Object.keys(publicPages)) {
        const folder = join(outDir, pagePath(view));
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'index.html'), publicPageHtml(template, view, base, catalog.resources, apiOrigin));
      }
      await writeFile(join(outDir, 'data-catalog.json'), JSON.stringify({ ...catalog, apiOrigin: apiOrigin || base }, null, 2) + '\n');
      const robots = `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`;
      await writeFile(join(outDir, 'robots.txt'), robots);
      if (base) await writeFile(join(outDir, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + Object.keys(publicPages).map(view =>
          `<url><loc>${escape(base + pagePath(view))}</loc></url>`).join('') + '</urlset>');
    },
  };
}
